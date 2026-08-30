"use client";

import { ROLE_LABELS, type Role } from "@/lib/domain";
import type { Alternative, Scatto, Temperatura } from "@/lib/stats-plus";
import { pct } from "@/lib/stats-plus";

/**
 * Stats+ nel modale d'offerta: **una riga sola**, sotto il campo (M22 §5.1).
 *
 * ## ⚠ Perché sta in un file suo, come `prezzo-consigliato.tsx`
 *
 * Perché è l'unico punto di Stats+ che tocca il modale d'offerta, cioè il posto
 * in cui la decisione del 2026-08-12 aveva **tolto** un numero. Quella decisione
 * non si applica a Stats+ (§5.3: qui non c'è nessuna cifra da offrire — c'è un
 * rapporto misurato su lotti già chiusi), ma la forma di allora si tiene: **una
 * costante sola, con tutte le forme scritte**, così spegnere Stats+ in tutta
 * l'applicazione costa una riga e non una rimozione di codice.
 */

/**
 * Dove compare Stats+, o se non compare affatto.
 *
 * - `campo` — solo nel modale d'offerta: la riga sotto l'input e, da `sm:` in
 *   su, la colonna destra.
 * - `tab` — solo la linguetta Stats+ del portale.
 * - `entrambi` — tutti e due i posti.
 * - `spento` — non compare da nessuna parte. Il calcolo resta, e tace.
 */
export const POSIZIONI_STATS = ["campo", "tab", "entrambi", "spento"] as const;
export type PosizioneStats = (typeof POSIZIONI_STATS)[number];

/**
 * ⚠ **La posizione scelta: `entrambi`.**
 *
 * Spegnere Stats+ in tutta l'applicazione vuol dire scrivere `"spento"` qui, e
 * **non** togliere del codice: i punti d'innesto restano scritti e tacciono da
 * soli, come quello di `PrezzoConsigliato dove="campo"` in `bid-modal.tsx`.
 */
export const POSIZIONE_STATS: PosizioneStats = "entrambi";

/**
 * ⚠ **Il budget di caratteri della riga, e non è un'intenzione: è misurato**
 * (mock del 2026-08-29). A 384px, con `text-xs`, oltre ~45 caratteri la riga va
 * a capo e il blocco passa da **31px a 49px** — cioè rimette esattamente i 44px
 * che M16 aveva restituito al campo, senza che nessuno l'abbia deciso.
 *
 * ⚠ **E l'esempio scritto in §5.1 non ci stava**: «Scatto: D da −25% a +14% · 5
 * pari livello, 2 tuoi» sono **49 caratteri**, cioè quattro oltre il limite che
 * la spec misura cinque righe più sotto. Trovato scrivendo il codice, ed è lo
 * stesso genere di difetto che i mock avevano già trovato tre volte: una forma
 * *scritta a mano* non si contraddice da sé, va **contata**. Per questo la riga
 * qui non è una stringa ma una **composizione che si misura** — e il test di
 * §9.1 la conta su tutte le combinazioni, non su una.
 */
export const MAX_CARATTERI_RIGA = 45;

/** `−25%` / `+14%`, col segno sempre: senza, `14%` si legge come un livello. */
function segnato(rapporto: number): string {
  const n = pct(rapporto);
  return `${n > 0 ? "+" : ""}${n}%`;
}

/**
 * La riga del modale, o `null` se non c'è niente da dire.
 *
 * ⚠ **Si compone dal più informativo al meno, e si tiene la prima forma che
 * sta nel budget.** Non è una furbizia: i nomi dei ruoli hanno lunghezze diverse
 * — `Portieri` sono 8 caratteri e `Centrocampisti` 14 — e una forma sola andrebbe
 * a capo su un ruolo e non sugli altri. Il caso peggiore è quello che decide, e
 * il caso peggiore non è quello che si guarda scrivendo la spec.
 */
export function rigaStatsPlus({
  role,
  temperatura,
  scatto,
  alternative,
}: {
  role: Role;
  temperatura: Temperatura | null;
  scatto: Scatto | null;
  alternative: Alternative | null;
}): string | null {
  const ruolo = ROLE_LABELS[role];

  if (temperatura === null) {
    // Uno stato normale con la sua frase, non un `—` muto (§8).
    return `${ruolo}: ancora nessun lotto`;
  }

  // La testa dice il livello, e lo scatto quando c'è: due regimi valgono più di
  // un livello solo, perché è il cambiamento a decidere.
  const testa =
    scatto === null
      ? `${ruolo} ${segnato(temperatura.mediana)} su ${temperatura.n}`
      : `${ruolo}: da ${segnato(scatto.prima)} a ${segnato(scatto.adesso)}`;

  // La coda conta chi resta, e i propri obiettivi dentro quel conto: è la
  // domanda «posso lasciarlo andare?» ridotta a due numeri.
  const pari = alternative?.pariLivello ?? [];
  const coda =
    pari.length === 0
      ? ""
      : ` · ${pari.length} pari, ${pari.filter((x) => x.obiettivo).length} tuoi`;

  const intera = `${testa}${coda}`;
  return intera.length <= MAX_CARATTERI_RIGA ? intera : testa;
}

/**
 * La riga, disegnata. `null` quando `POSIZIONE_STATS` non la vuole qui.
 *
 * ⚠ **Sotto l'input e non sopra, e non è layout: è la risposta all'obiezione del
 * 2026-08-12** (§5.3). Sopra il campo, un'informazione arriva **prima** della
 * decisione e la sostituisce; sotto, l'ordine di lettura si inverte — prima vedi
 * la cifra che stai scrivendo, poi il contesto. Chi lo vuole lo trova, chi ha
 * già deciso ha già digitato.
 *
 * ⚠ **E una riga sola, non due.** Il commento di M16 in `bid-modal.tsx` dice
 * perché la riga dei valori suggeriti è stata tolta: *«i ~44px che la riga
 * occupava sono altezza restituita al campo, che con la tastiera aperta è la
 * risorsa scarsa»*. Una seconda riga rimetterebbe quell'altezza, in mezzo fra il
 * campo e il suo verdetto, disfacendo una decisione presa apposta.
 */
export function RigaStatsPlus({
  role,
  temperatura,
  scatto,
  alternative,
  posizione = POSIZIONE_STATS,
}: {
  role: Role | null;
  temperatura: Temperatura | null;
  scatto: Scatto | null;
  alternative: Alternative | null;
  /**
   * L'override esiste solo per guardare le forme una accanto all'altra. In
   * applicazione non si passa: la posizione la decide `POSIZIONE_STATS`, in un
   * posto solo.
   */
  posizione?: PosizioneStats;
}) {
  if (posizione !== "campo" && posizione !== "entrambi") return null;
  if (role === null) return null;

  const testo = rigaStatsPlus({ role, temperatura, scatto, alternative });
  if (testo === null) return null;

  return (
    <p className="text-muted-foreground text-xs tabular-nums">{testo}</p>
  );
}
