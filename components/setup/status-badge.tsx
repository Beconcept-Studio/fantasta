import { Badge } from "@/components/ui/badge";
import type { AuctionStatus } from "@/lib/domain";

/**
 * Lo stato dell'asta in una parola.
 *
 * DRAFT e READY non si impostano a mano: sono derivati da «posti pieni +
 * listone importato + I9 valida», ricalcolati a ogni modifica del setup.
 */
const LABELS: Record<AuctionStatus, string> = {
  DRAFT: "In preparazione",
  READY: "Pronta",
  LIVE: "In corso",
  PAUSED: "In pausa",
  COMPLETED: "Conclusa",
};

const VARIANTS: Record<
  AuctionStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  DRAFT: "outline",
  READY: "default",
  LIVE: "default",
  PAUSED: "secondary",
  COMPLETED: "secondary",
};

export function StatusBadge({ status }: { status: AuctionStatus }) {
  return <Badge variant={VARIANTS[status]}>{LABELS[status]}</Badge>;
}

export function statusLabel(status: AuctionStatus): string {
  return LABELS[status];
}
