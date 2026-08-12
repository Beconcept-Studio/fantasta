"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import type { CarmyJudgement } from "@/lib/domain";
import { cn } from "@/lib/utils";

/**
 * Il prezzo consigliato del foglio di Carmy, nel modale d'offerta (M10B §6).
 *
 * ## ⚠ Perché ha un file suo, e perché la ragione va lasciata scritta
 *
 * **Si scrive** (owner, 2026-08-12: «scrivila comunque, poi io decido come
 * gestirla»), ed è la cosa più delicata della macro. La ragione non è tecnica:
 * **una cifra suggerita accanto a una cifra da digitare è un suggerimento che
 * qualcuno segue senza pensarci**, e a differenza di ogni altro numero di questa
 * macro non descrive un giocatore — **propone un'azione**.
 *
 * E c'è un secondo effetto, che riguarda l'asta e non l'interfaccia: se otto
 * persone su otto hanno il file, il prezzo consigliato **smette di essere un
 * vantaggio informativo e diventa un prezzo di listino**. L'asta converge lì, e la
 * contesa che rende interessante la serata si sposta sui pochi nomi in cui qualcuno
 * decide di scostarsene.
 *
 * Per questo sta in un componente suo, con **un posto solo** da cui si decide se e
 * dove compare: `POSIZIONE_PREZZO`. Le tre forme sono tutte scritte, così cambiare
 * idea — o spegnerlo — costa una riga e non tre riscritture.
 */

/**
 * Dove compare, o se non compare affatto.
 *
 * - `campo` — accanto al campo dell'offerta. È la più utile e la più pericolosa: è
 *   letteralmente un numero suggerito a due centimetri dal numero da scrivere.
 * - `macro` — sotto le macro, in fila con fascia, affidabilità e integrità. Lo
 *   rende **un giudizio fra i giudizi** invece di un'istruzione: si legge insieme
 *   agli altri, non al posto della propria decisione.
 * - `tocco` — dietro un tocco su «prezzo consigliato». Chi lo vuole lo chiede;
 *   chi non lo vuole non lo vede mai. ⚠ È l'unica forma in cui il numero **non**
 *   sta davanti agli occhi di chi non l'ha cercato.
 * - `spento` — non compare. Il dato resta a database e nel Centro dati.
 */
export const POSIZIONI_PREZZO = ["campo", "macro", "tocco", "spento"] as const;
export type PosizionePrezzo = (typeof POSIZIONI_PREZZO)[number];

/**
 * ⚠ **La posizione scelta dall'owner, 2026-08-12, guardandola**: **`macro`**.
 *
 * Cioè: il prezzo consigliato **c'è**, ma non accanto al campo — sta in fila con
 * fascia, affidabilità e integrità, dove si legge come un giudizio fra i giudizi
 * invece che come un'istruzione a due centimetri dalla cifra da digitare.
 *
 * La riga è questa. Spegnere il prezzo consigliato in tutta l'applicazione vuol dire
 * scrivere `"spento"` qui, e **non** togliere del codice: il punto d'innesto accanto
 * al campo resta scritto in `bid-modal.tsx` e tace da sé.
 */
export const POSIZIONE_PREZZO: PosizionePrezzo = "macro";

/**
 * Il prezzo consigliato, disegnato secondo `POSIZIONE_PREZZO`.
 *
 * `dove` dice **da quale dei due posti del modale** viene la chiamata: il
 * componente compare solo se la posizione scelta è quella. Così i due punti di
 * innesto restano entrambi nel codice, e la scelta di quale sia attivo resta una
 * riga sola — che è esattamente ciò che la spec chiedeva.
 *
 * `null` quando non c'è nulla da dire: nessun giudizio, oppure un prezzo che il
 * foglio scrive `0` — che il parser traduce in assente, perché **zero non è
 * nemmeno un'offerta valida**.
 */
export function PrezzoConsigliato({
  carmy,
  dove,
  posizione = POSIZIONE_PREZZO,
}: {
  carmy: CarmyJudgement | undefined;
  dove: "campo" | "macro";
  /**
   * L'override esiste **solo** per guardare le tre forme una accanto all'altra
   * sulla pagina di prova. In applicazione non si passa: la posizione la decide
   * `POSIZIONE_PREZZO`, in un posto solo, altrimenti tornano a esistere tre
   * decisioni sparse fra i chiamanti.
   */
  posizione?: PosizionePrezzo;
}) {
  const [aperto, setAperto] = useState(false);

  const prezzo = carmy?.prezzo ?? null;
  if (prezzo === null) return null;

  // Il tocco vive accanto al campo: è lì che serve, ed è lì che chi lo vuole va a
  // cercarlo. Se la posizione è un'altra, questo punto d'innesto tace.
  if (posizione === "tocco") {
    if (dove !== "campo") return null;
    return (
      <div className="text-xs">
        {aperto ? (
          <p className="text-muted-foreground tabular-nums">
            Prezzo consigliato dal foglio: <strong>{prezzo}</strong> crediti.
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setAperto(true)}
            className="text-muted-foreground hover:text-foreground underline transition"
          >
            Mostra il prezzo consigliato
          </button>
        )}
      </div>
    );
  }

  if (posizione !== dove) return null;

  // Accanto al campo: si scrive per esteso, perché un numero nudo lì accanto si
  // confonde con il credito residuo e con il rilancio minimo.
  if (dove === "campo") {
    return (
      <p className="text-muted-foreground text-xs tabular-nums">
        Prezzo consigliato dal foglio: <strong>{prezzo}</strong> crediti.
      </p>
    );
  }

  // Fra le macro: un badge come gli altri, per essere letto **insieme** agli altri
  // giudizi e non al posto della propria decisione.
  return (
    <Badge variant="secondary" className={cn("tabular-nums", "h-4.5 px-1.5 py-0 text-[10px]")}>
      consigliato {prezzo}
    </Badge>
  );
}
