import type { Presence } from "@/lib/realtime/types";
import { cn } from "@/lib/utils";

/**
 * Il pallino di presence (PLAN §7): verde chi ha la pagina aperta e davanti,
 * ambra chi l'ha in background, grigio chi non batte più il colpo.
 *
 * Il colore da solo non basta — «nessun hover come unico canale informativo»
 * vale anche per il colore, e in TV la differenza fra ambra e verde a tre metri
 * è opinabile. Da qui il `title` e l'etichetta testuale accanto, che chi
 * mostra il pallino può decidere di rendere.
 */

export const PRESENCE_LABELS: Record<Presence, string> = {
  LIVE: "collegato",
  IDLE: "in secondo piano",
  OFFLINE: "non collegato",
};

const PRESENCE_CLASSES: Record<Presence, string> = {
  LIVE: "bg-emerald-500",
  IDLE: "bg-amber-500",
  OFFLINE: "bg-muted-foreground/40",
};

export function PresenceDot({
  presence,
  className,
}: {
  presence: Presence;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block size-2.5 shrink-0 rounded-full",
        PRESENCE_CLASSES[presence],
        className,
      )}
      title={PRESENCE_LABELS[presence]}
      role="img"
      aria-label={PRESENCE_LABELS[presence]}
    />
  );
}
