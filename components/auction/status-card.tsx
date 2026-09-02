"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/domain";
import { managerControls } from "@/lib/realtime/manage";
import {
  memberById,
  memberLabel,
  phaseLabelIgnoringPause,
  statusLabel,
} from "@/lib/realtime/portal";
import type { Snapshot } from "@/lib/realtime/types";

/**
 * **La card di stato** (M17 §5): la prima cosa della colonna 3, presente in ogni
 * fase e in ogni stato dell'asta.
 *
 * È l'unica card del portale che **non sparisce mai**, e serve precisamente a
 * questo: la card di scena sotto di lei cambia forma con la fase, e senza un
 * punto fisso sopra un cambio di scena si legge come «la pagina è diventata
 * un'altra».
 *
 * ⚠ **Da qui è alta due righe, e l'altezza è il requisito** (richiesta
 * dell'owner del 2026-08-23): sotto c'è la card delle offerte, che è la ragione
 * per cui si tiene il telefono in mano, e ogni pixel speso qui è un pixel che
 * quella non ha. La versione precedente ne prendeva ~125px ad asta in corso e
 * ~195px in pausa, con un occhiello, un titolo da 18px, una lista di
 * definizioni a due righe e un paragrafo da tre. Le quattro informazioni sono
 * ancora tutte qui, in metà spazio:
 *
 * - la **fase** nel titolo, con le frasi che esistono già
 *   (`phaseLabelIgnoringPause`);
 * - lo **stato** dell'asta nel badge in alto a destra — lo stesso angolo in cui
 *   il badge sta in tutte le altre card della colonna;
 * - il **ruolo** in gioco e **di chi è il turno**, due badge in linea sulla
 *   seconda riga.
 *
 * ⚠ **L'occhiello «Asta» è stato tolto** e non è una perdita: era l'unica cosa
 * scritta identica in tutti gli stati della card, cioè l'unica che non
 * distingueva mai niente da niente. Quello che dice — che questa card parla
 * dell'asta — lo dicono la sua posizione e tutto il resto della pagina.
 *
 * ⚠ **La fase usa `phaseLabelIgnoringPause` e non `phaseLabel`**, e il perché sta
 * su quella funzione: in pausa `phaseLabel` restituisce «in pausa», che è già
 * quello che dice il badge due centimetri a destra. Così invece la card dice
 * entrambe le cose — in pausa, *durante un round di offerte* — che è ciò che
 * significa «la pausa congela la fase, non la azzera».
 */
export function StatusCard({
  snapshot,
  viewerIsOwner,
  pausePending,
  onPause,
  onResume,
}: {
  snapshot: Snapshot;
  /**
   * Chi possiede l'asta, cioè chi la conduce: è la sola persona a cui compare il
   * comando di pausa. Arriva come prop e non dallo snapshot perché nasce col
   * link e non è stato di gioco — la stessa ragione per cui `SceneAction` la
   * riceve nello stesso modo.
   *
   * ⚠ Chi conduce **senza giocare** non passa da qui: non è membro, quindi non
   * ha un portale (⚠ P11) e il suo posto è la Regia. Questo pulsante serve al
   * caso opposto, che è anche quello normale — l'owner che gioca e che finora
   * doveva uscire dal portale per fermare l'asta.
   */
  viewerIsOwner: boolean;
  pausePending: boolean;
  onPause: () => void;
  onResume: () => void;
}) {
  const { status, currentRole, currentMemberId } = snapshot.auction;
  const live = status === "LIVE" || status === "PAUSED";
  const turn = memberById(snapshot, currentMemberId);
  /**
   * Le stesse condizioni della regia, dalla stessa funzione pura: `canPause` è
   * `status = LIVE`, `canResume` è `status = PAUSED`. Riusarla invece di
   * riscrivere due confronti qui è ciò che garantisce che il pulsante del
   * portale e quello della regia non possano divergere — e i test di
   * `managerControls` coprono già entrambe.
   *
   * **Disabilitare non è autorizzare** (regola 6): `pauseAuction` e
   * `resumeAuction` ricontrollano da sé la proprietà dell'asta, quindi questo
   * `viewerIsOwner` decide cosa si vede, non cosa si può fare.
   */
  const controls = managerControls(snapshot);
  const canToggle = viewerIsOwner && (controls.canPause || controls.canResume);

  return (
    <section
      className="bg-card space-y-2 rounded-xl border p-3"
      aria-label="Stato dell'asta"
    >
      {/* ── Riga 1: la fase e lo stato ─────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        {/*
          Il titolo è la **fase** ad asta in corso e una frase breve fuori.

          ⚠ Non è `statusLabel` due volte: il badge dice già «non iniziata», e
          un titolo che ripete la parola del badge fa girare a vuoto la card
          proprio nei due stati in cui è l'unica cosa che si legge. Il titolo
          dice la stessa notizia in forma di frase, il badge in forma di
          etichetta, e insieme non si ripetono.
        */}
        <p className="min-w-0 truncate text-base leading-snug font-semibold">
          {live
            ? phaseLabelIgnoringPause(snapshot)
            : status === "COMPLETED"
              ? "Le rose sono chiuse"
              : "Non è ancora iniziata"}
        </p>
        <Badge
          variant={status === "PAUSED" ? "destructive" : "secondary"}
          className="shrink-0"
        >
          {statusLabel(status)}
        </Badge>
      </div>

      {/*
        ── Riga 2: ruolo, turno e il comando di pausa ─────────────────────

        Esiste solo ad asta in corso, e `canToggle` non la fa comparire altrove:
        `canPause` e `canResume` sono falsi in tutti gli altri stati.

        ⚠ **Il pulsante condivide questa riga invece di prendersene una**, ed è il
        motivo per cui la pausa nel portale costa zero pixel di altezza: la riga
        è alta quanto il pulsante (h-7) e i due badge le stavano dentro comunque.
      */}
      {live && (
        <div className="flex flex-wrap items-center gap-1.5">
          {/*
            ⚠ **Due badge nudi, e le etichette diventano `sr-only`.** A schermo
            «Difensori» e «Real Panchina» si distinguono da soli — uno è un ruolo,
            l'altro un nome squadra — e la lista di definizioni che li etichettava
            costava due righe per dire due parole già chiare. Ma chi ascolta la
            pagina non ha la posizione né la forma: senza queste due parole
            nascoste sentirebbe due nomi propri di fila senza sapere cosa sono.
            L'informazione non è stata tolta, è stata tolta dalla vista.
          */}
          <Badge variant="outline">
            <span className="sr-only">Ruolo:&nbsp;</span>
            {currentRole === null ? "—" : ROLE_LABELS[currentRole]}
          </Badge>
          <Badge variant="outline" className="max-w-40">
            <span className="sr-only">Turno:&nbsp;</span>
            <span className="truncate">{memberLabel(turn)}</span>
          </Badge>

          {canToggle && (
            <Button
              type="button"
              size="sm"
              variant={controls.canResume ? "default" : "outline"}
              className="ml-auto"
              disabled={pausePending}
              onClick={controls.canResume ? onResume : onPause}
            >
              {controls.canResume
                ? pausePending
                  ? "Riprendo…"
                  : "Riprendi"
                : pausePending
                  ? "Metto in pausa…"
                  : "Pausa"}
            </Button>
          )}
        </div>
      )}

      {/*
        ⚠ Il testo della pausa, che prima era un banner suo in cima al `<main>` e
        poi un paragrafo di tre righe qui dentro. Adesso è una riga sola, e la
        ragione è che accanto c'è «Riprendi»: chi legge questa frase ha il rimedio
        sotto il pollice, e non ha bisogno che gli si spieghi chi ha messo in
        pausa. La cosa che serve sapere è **una**, e non è ovvia — alla ripresa il
        tempo riparte da dov'era, non da capo.
      */}
      {status === "PAUSED" && (
        <p role="status" className="text-muted-foreground text-xs">
          Countdown congelati: alla ripresa il tempo riparte da dov&apos;era.
        </p>
      )}

      {/*
        ⚠ Ad asta non iniziata e ad asta conclusa qui c'è **una riga sola**, e non
        è una card incompleta: cosa fare mentre si aspetta, e il collegamento alla
        lobby, stanno nella card di scena sotto — che in quei due stati è l'unica
        altra cosa in colonna. Scriverlo in tutte due vorrebbe dire lo stesso
        paragrafo due volte a dieci pixel di distanza.
      */}
    </section>
  );
}
