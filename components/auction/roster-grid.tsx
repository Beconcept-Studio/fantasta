import { ROLES, ROLE_LABELS, type Role } from "@/lib/domain";
import type { SnapshotMember } from "@/lib/realtime/types";
import { cn } from "@/lib/utils";

/**
 * La propria rosa, ruolo per ruolo, con gli slot ancora vuoti disegnati come
 * caselle: a metà asta la domanda che uno si fa non è «chi ho preso» ma
 * «quanti me ne mancano», e la risposta deve essere una cosa che si conta con
 * gli occhi.
 *
 * Tutto viene dallo snapshot: `member.roster` sono le assegnazioni non
 * annullate, `slots` la configurazione dell'asta.
 */
export function RosterGrid({
  member,
  slots,
  className,
}: {
  member: SnapshotMember;
  slots: Record<Role, number>;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      {ROLES.map((role) => {
        const owned = member.roster
          .filter((entry) => entry.role === role)
          .sort((a, b) => b.price - a.price);
        const empty = Math.max(0, slots[role] - owned.length);
        return (
          <div key={role} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">{ROLE_LABELS[role]}</h3>
              <span className="text-muted-foreground text-xs tabular-nums">
                {owned.length}/{slots[role]}
              </span>
            </div>
            <ul className="space-y-1">
              {owned.map((entry) => (
                <li
                  key={entry.playerId}
                  className="flex items-baseline gap-2 rounded-md border px-2.5 py-1.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {entry.name}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {entry.team}
                  </span>
                  <span className="shrink-0 tabular-nums">{entry.price}</span>
                </li>
              ))}
            </ul>
            {/* Gli slot vuoti come caselline in fila, non come righe intere:
                otto righe tratteggiate per i difensori sarebbero mezzo schermo
                di telefono per dire «me ne mancano otto». */}
            {empty > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                {Array.from({ length: empty }, (_, i) => (
                  <span
                    key={`empty-${role}-${i}`}
                    className="border-muted-foreground/30 size-6 rounded border border-dashed"
                    aria-hidden
                  />
                ))}
                <span className="text-muted-foreground ml-1 text-xs">
                  {empty === 1 ? "1 da comprare" : `${empty} da comprare`}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Gli slot di un membro in una riga sola: `1/3 · 4/8 · 2/8 · 0/6`. */
export function SlotsSummary({
  slotsFilled,
  slots,
  className,
}: {
  slotsFilled: Record<Role, number>;
  slots: Record<Role, number>;
  className?: string;
}) {
  return (
    <span className={cn("text-xs tabular-nums", className)}>
      {ROLES.map((role) => (
        <span key={role} className="after:text-muted-foreground/50 after:content-['_·_'] last:after:content-none">
          <span className="text-muted-foreground">{role}</span>{" "}
          {slotsFilled[role]}/{slots[role]}
        </span>
      ))}
    </span>
  );
}
