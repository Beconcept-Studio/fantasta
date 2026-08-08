/**
 * Il vocabolario dell'asta: ruoli, stati, tagli di partecipanti.
 *
 * Sta in un file suo, e non dentro `lib/db/schema.ts`, per due ragioni che si
 * sono manifestate insieme:
 *
 * 1. **La regola ESLint su `lib/db` è assoluta e deve restarlo.** Una pagina che
 *    scrive `import { ROLES } from "@/lib/db/schema"` non sta facendo niente di
 *    male, ma nessun linter sa distinguerla da una che apre una query — e la
 *    regola vale proprio perché non ammette eccezioni discrezionali.
 * 2. **Il bundle del client.** `schema.ts` tira dentro `drizzle-orm/pg-core`:
 *    importarlo da un componente `"use client"` per quattro stringhe farebbe
 *    viaggiare fino al telefono un ORM che al telefono non serve.
 *
 * Qui dentro non c'è nessuna dipendenza: sono i nomi delle cose.
 */

export const ROLES = ["P", "D", "C", "A"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  P: "Portieri",
  D: "Difensori",
  C: "Centrocampisti",
  A: "Attaccanti",
};

/** Il singolare, per le frasi: «chiama un portiere», non «chiama un Portieri». */
export const ROLE_LABELS_ONE: Record<Role, string> = {
  P: "portiere",
  D: "difensore",
  C: "centrocampista",
  A: "attaccante",
};

export const AUCTION_STATUSES = [
  "DRAFT",
  "READY",
  "LIVE",
  "PAUSED",
  "COMPLETED",
] as const;
export type AuctionStatus = (typeof AUCTION_STATUSES)[number];

export const AUCTION_PHASES = [
  "WAITING_PICK",
  "LOT_OPEN",
  "LOT_TIE_PREP",
  "LOT_REVEAL",
] as const;
export type AuctionPhase = (typeof AUCTION_PHASES)[number];

/** I tagli ammessi di partecipanti: segmented control, mai input libero. */
export const SEAT_OPTIONS = [8, 10, 12] as const;
export type SeatCount = (typeof SEAT_OPTIONS)[number];
