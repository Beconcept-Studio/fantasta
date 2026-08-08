import { PresenceDot } from "@/components/auction/presence-dot";
import { SlotsSummary } from "@/components/auction/roster-grid";
import type { Snapshot } from "@/lib/realtime/types";
import { cn } from "@/lib/utils";

/**
 * Gli altri partecipanti: crediti, offerta massima, slot riempiti, presence.
 *
 * `maxBid` altrui è informazione pubblica, e deve esserlo: sapere che il vicino
 * può arrivare a 12 e non a 120 è metà del gioco. Non è una deroga a I8 — I8
 * riguarda **l'importo di un'offerta in busta chiusa**, che è un'altra cosa: il
 * tetto si calcola da crediti e slot, entrambi già pubblici (PLAN §5, I5).
 */
export function MembersPanel({
  snapshot,
  myMemberId,
}: {
  snapshot: Snapshot;
  myMemberId: string | null;
}) {
  const { slots, currentMemberId } = snapshot.auction;
  return (
    <ul className="space-y-1.5">
      {snapshot.members.map((member) => {
        const isMe = member.id === myMemberId;
        return (
          <li
            key={member.id}
            className={cn(
              "flex items-center gap-2.5 rounded-lg border px-3 py-2",
              isMe && "border-foreground/30 bg-muted/40",
              member.id === currentMemberId && "border-amber-500/50",
            )}
          >
            <PresenceDot presence={member.presence} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {member.teamName}
                {isMe && <span className="text-muted-foreground"> · tu</span>}
              </p>
              <SlotsSummary
                slotsFilled={member.slotsFilled}
                slots={slots}
                className="text-muted-foreground"
              />
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold tabular-nums">
                {member.credits}
              </p>
              <p className="text-muted-foreground text-xs tabular-nums">
                max {member.maxBid}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
