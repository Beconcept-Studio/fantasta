import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS } from "@/lib/domain";
import {
  memberById,
  memberLabel,
  phaseLabelIgnoringPause,
  statusLabel,
} from "@/lib/realtime/portal";
import type { Snapshot } from "@/lib/realtime/types";

/**
 * **La card di stato** (M17 §5): la prima cosa della colonna 3, presente in ogni
 * fase e in ogni stato dell'asta, sempre alla stessa altezza.
 *
 * È l'unica card del portale che **non sparisce mai**, e serve precisamente a
 * questo: la card di scena sotto di lei cambia forma con la fase, e senza un
 * punto fisso sopra un cambio di scena si legge come «la pagina è diventata
 * un'altra». Qui invece cambiano quattro parole in quattro posti noti.
 *
 * Dice quattro cose e nient'altro:
 *
 * - lo **stato** dell'asta, nel badge in alto a destra — che è lo stesso angolo
 *   in cui il badge sta in tutte le altre card della colonna;
 * - la **fase**, con le frasi che esistono già (`phaseLabelIgnoringPause`);
 * - il **ruolo** in gioco;
 * - **di chi è il turno**.
 *
 * ⚠ **Il badge dello stato torna acceso qui**, e viene da `portal-header.tsx`
 * dove era commentato via: in una barra che dice crediti e `max_bid` uno stato
 * dell'asta era un'informazione di un altro genere, appoggiata dove capitava.
 * Qui ha accanto la fase, il ruolo e il turno — le tre cose che lo qualificano.
 *
 * ⚠ **La fase usa `phaseLabelIgnoringPause` e non `phaseLabel`**, e il perché sta
 * su quella funzione: in pausa `phaseLabel` restituisce «in pausa», che è già
 * quello che dice il badge due centimetri a destra. Così invece la card dice
 * entrambe le cose — in pausa, *durante un round di offerte* — che è ciò che
 * significa «la pausa congela la fase, non la azzera».
 *
 * ⚠ **Assorbe il banner della pausa** che stava in cima al `<main>` (M17 §2). Due
 * avvisi di pausa uno sopra l'altro sono un avviso che si ignora, e il posto
 * giusto per «l'asta è ferma» è la card che esiste per dire come sta l'asta.
 */
export function StatusCard({ snapshot }: { snapshot: Snapshot }) {
  const { status, currentRole, currentMemberId } = snapshot.auction;
  const live = status === "LIVE" || status === "PAUSED";
  const turn = memberById(snapshot, currentMemberId);

  return (
    <section
      className="bg-card space-y-3 rounded-xl border p-4 shadow-sm"
      aria-label="Stato dell'asta"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-[0.6875rem] tracking-wide uppercase">
            Asta
          </p>
          {/*
            Il titolo è la **fase** ad asta in corso e una frase breve fuori.

            ⚠ Non è `statusLabel` due volte: il badge dice già «non iniziata», e
            un titolo che ripete la parola del badge fa girare a vuoto la card
            proprio nei due stati in cui è l'unica cosa che si legge. Il titolo
            dice la stessa notizia in forma di frase, il badge in forma di
            etichetta, e insieme non si ripetono.
          */}
          <p className="mt-0.5 text-lg leading-tight font-semibold">
            {live
              ? phaseLabelIgnoringPause(snapshot)
              : status === "COMPLETED"
                ? "Le rose sono chiuse"
                : "Non è ancora iniziata"}
          </p>
        </div>
        <Badge
          variant={status === "PAUSED" ? "destructive" : "secondary"}
          className="shrink-0"
        >
          {statusLabel(status)}
        </Badge>
      </div>

      {/* ── Ruolo e turno: due righe che ci sono solo ad asta in corso ── */}
      {live && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5">
          <dt className="text-muted-foreground self-center text-xs tracking-wide uppercase">
            Ruolo
          </dt>
          <dd className="truncate text-sm font-medium">
            {currentRole === null ? "—" : ROLE_LABELS[currentRole]}
          </dd>
          {/*
            Il turno c'è anche durante un lotto, e non è un residuo: `current_seat`
            non avanza fino alla chiusura del reveal, quindi «di chi è il turno»
            durante le offerte vuol dire «chi ha chiamato questo lotto» — che è
            l'informazione giusta, ed è quella che la regia mostra nello stesso
            momento.
          */}
          <dt className="text-muted-foreground self-center text-xs tracking-wide uppercase">
            Turno
          </dt>
          <dd className="truncate text-sm font-medium">{memberLabel(turn)}</dd>
        </dl>
      )}

      {/*
        ⚠ Il testo della pausa, che prima era un banner suo in cima al `<main>`.
        Sta qui sotto e non sopra le due righe di proposito: è la spiegazione di
        una cosa che il badge ha già detto, non la notizia.
      */}
      {status === "PAUSED" && (
        <p role="status" className="text-sm">
          Chi gestisce l&apos;asta l&apos;ha messa in pausa. I countdown sono
          congelati e le offerte sospese: quando riprende, il tempo che restava
          riparte da dov&apos;era.
        </p>
      )}

      {/*
        ⚠ Ad asta non iniziata e ad asta conclusa qui **non c'è nient'altro**, e
        non è una card incompleta: cosa fare mentre si aspetta, e il collegamento
        alla lobby, stanno nella card di scena sotto — che in quei due stati è
        l'unica altra cosa in colonna. Scriverlo in tutte due vorrebbe dire lo
        stesso paragrafo due volte a dieci pixel di distanza.
      */}
    </section>
  );
}
