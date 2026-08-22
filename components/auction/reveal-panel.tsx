import { Badge } from "@/components/ui/badge";
import type { Snapshot, SnapshotReveal } from "@/lib/realtime/types";
import { memberLabel, memberById } from "@/lib/realtime/portal";
import { cn } from "@/lib/utils";

/**
 * L'apertura delle buste (F5-09).
 *
 * È l'unico momento in cui gli importi sono pubblici, e lo sono perché lo
 * snapshot li porta solo qui (`currentLot.reveal`, popolato in `LOT_REVEAL` e
 * mai prima — I8 e M1). Il pannello non nasconde e non riassume niente: tutte
 * le offerte di tutti i round, perché è la trasparenza che rende accettabile
 * un'asta a busta chiusa fatta fra amici, e perché per trenta secondi prima non
 * si era saputo niente di niente.
 *
 * Due dettagli che servono a capire un esito contestato:
 *
 * - le offerte **ritirate** restano in elenco, barrate: chi si è tirato indietro
 *   non sparisce dalla storia;
 * - accanto a ogni cifra c'è il momento in cui è stata fissata, in secondi
 *   dalla prima offerta del round. Nello spareggio è quel numero a decidere
 *   (a parità di importo vince `MIN(amount_set_at)`, e il timestamp è quello
 *   ereditato dal round 1), quindi è l'unico modo di leggere il risultato senza
 *   fidarsi sulla parola.
 *
 * Qui c'è solo l'elenco: il vincitore, il prezzo e la cornice sono di
 * `LotClosedCard`, che è la schermata di cui questo è il corpo.
 */

function relativeLabel(amountSetAt: string, baseMs: number): string {
  const delta = Math.round((Date.parse(amountSetAt) - baseMs) / 1000);
  if (delta <= 0) return "+0s";
  return `+${delta}s`;
}

export function RevealBids({
  reveal,
  snapshot,
  myMemberId,
  className,
}: {
  reveal: SnapshotReveal;
  snapshot: Snapshot;
  myMemberId: string | null;
  className?: string;
}) {
  return (
    <div className={cn("space-y-4", className)}>
      {reveal.rounds.map((round) => {
        const base = Math.min(
          ...round.bids.map((bid) => Date.parse(bid.amountSetAt)),
        );
        const ordered = [...round.bids].sort(
          (a, b) =>
            b.amount - a.amount ||
            Date.parse(a.amountSetAt) - Date.parse(b.amountSetAt),
        );
        return (
          <div key={round.roundNo} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">
                {round.roundNo === 1 ? "Buste" : "Spareggio"}
              </h3>
              {round.roundNo === 2 && (
                <span className="text-muted-foreground text-xs tabular-nums">
                  da {round.minAmount}
                </span>
              )}
            </div>
            <ul className="space-y-1">
              {ordered.map((bid) => {
                const member = memberById(snapshot, bid.memberId);
                // ⚠ **Lettore, e resta** (M16): da qui in avanti `withdrawnAt`
                // è sempre `null` perché il ritiro non esiste più, ma le aste
                // già giocate hanno delle buste ritirate dentro e il reveal
                // deve continuare a mostrarle per quello che erano — barrate,
                // con «ritirata» al posto dell'orario. Toglierlo non
                // semplificherebbe niente: riscriverebbe il passato.
                const withdrawn = bid.withdrawnAt !== null;
                const isWinner =
                  bid.memberId === reveal.winnerMemberId &&
                  round.roundNo === reveal.rounds.length;
                return (
                  <li
                    key={`${round.roundNo}-${bid.memberId}`}
                    className={cn(
                      "bg-background flex items-baseline gap-2 rounded-md border px-2.5 py-1.5 text-sm",
                      isWinner && "border-emerald-600/50 bg-emerald-600/10",
                      withdrawn && "text-muted-foreground",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {memberLabel(member)}
                      {bid.memberId === myMemberId && (
                        <span className="text-muted-foreground"> · tu</span>
                      )}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {withdrawn ? "ritirata" : relativeLabel(bid.amountSetAt, base)}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-medium tabular-nums",
                        isWinner && "text-emerald-700",
                        withdrawn && "line-through",
                      )}
                    >
                      {bid.amount}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** L'annuncio dello spareggio (F5-08), nei secondi fra il round 1 e il round 2. */
export function TiePanel({
  amount,
  amInTie,
  className,
}: {
  amount: number;
  amInTie: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border p-4 text-center",
        amInTie
          ? "border-amber-500/50 bg-amber-500/10"
          : "bg-muted/40 border-transparent",
        className,
      )}
    >
      <Badge variant={amInTie ? "default" : "secondary"}>Spareggio</Badge>
      <p className="text-2xl font-semibold tabular-nums">{amount}</p>
      <p className="text-sm">
        {amInTie ? (
          <>
            <strong>Sei nello spareggio.</strong> Fra un attimo si riapre: la tua
            offerta resta a {amount} se non fai niente, e a parità vince chi ci
            era arrivato prima.
          </>
        ) : (
          <>
            Pareggio a {amount} fra altri: tu <strong>sei fuori</strong> da questo
            lotto.
          </>
        )}
      </p>
    </div>
  );
}
