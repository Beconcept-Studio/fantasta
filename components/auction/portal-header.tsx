import { SlotsSummary } from "@/components/auction/roster-grid";
import { Badge } from "@/components/ui/badge";
import { phaseLabel } from "@/lib/realtime/portal";
import type { Snapshot, SnapshotMember } from "@/lib/realtime/types";
import { cn } from "@/lib/utils";

/**
 * L'intestazione fissa del portale: **crediti e offerta massima non escono mai
 * dallo schermo**.
 *
 * È il requisito mobile-first di PLAN §15 preso alla lettera. `max_bid` è il
 * numero che decide ogni offerta — è il tetto che il server applica (I5) — e
 * cercarlo con uno scroll mentre restano otto secondi è esattamente il tipo di
 * attrito che fa perdere un lotto. Insieme ci sono i crediti (da cui il tetto
 * discende) e gli slot riempiti (che spiegano la differenza fra i due).
 */
export function PortalHeader({
  snapshot,
  me,
  connected,
}: {
  snapshot: Snapshot;
  me: SnapshotMember | null;
  connected: boolean;
}) {
  const { auction } = snapshot;
  return (
    <header className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto w-full max-w-6xl px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
        <div className="flex items-center gap-2">
          {!connected && (
            <Badge variant="outline" className="border-amber-500/50">
              riconnessione…
            </Badge>
          )}
          {/* <Badge variant={auction.status === "PAUSED" ? "destructive" : "secondary"}>
            {phaseLabel(snapshot)}
          </Badge> */}
        </div>

        {me !== null && (
          <div className="mt-1.5 flex items-end justify-between gap-3">
            <div>
              <p className="truncate text-sm font-medium">{me.teamName}</p>
              <SlotsSummary
                slotsFilled={me.slotsFilled}
                slots={auction.slots}
                className="text-muted-foreground"
              />
            </div>
            <div className="flex shrink-0 items-end gap-4 text-right">
              <Figure label="crediti" value={me.credits} />
              <Figure label="max" value={me.maxBid} />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

function Figure({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-[0.65rem] tracking-wide uppercase">
        {label}
      </p>
      <p
        className={cn(
          "leading-none tabular-nums",
          strong ? "text-2xl font-semibold" : "text-xl font-medium",
        )}
      >
        {value}
      </p>
    </div>
  );
}
