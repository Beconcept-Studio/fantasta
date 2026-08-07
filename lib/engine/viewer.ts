import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { auctions, members } from "@/lib/db/schema";

import { type Result, fail, ok } from "./errors";

/**
 * Chi sta guardando un'asta, e con quali diritti (F4-04).
 *
 * Tre tipi di spettatore, e la differenza fra loro è tutta in una cosa:
 * **il viewer**, cioè il membro per cui `serializeSnapshot` sanifica.
 *
 * - `MEMBER` — un partecipante. Ha un `memberId`: vede la propria offerta.
 * - `MANAGER` — l'owner che non gioca (⚠ P11: joinare è facoltativo). Vede
 *   tutta l'asta ma **nessun** importo durante `LOT_OPEN`, nemmeno il proprio:
 *   non ne ha. Un owner che gioca è un `MEMBER` come tutti.
 * - `TV` — la vista proiettabile, senza login, autenticata dal `public_token`
 *   dell'asta nell'URL. Nessun viewer, quindi nessun `myBid`.
 *
 * Sta qui, in `lib/engine/`, perché è l'unico posto da cui si può interrogare
 * il database (regola ESLint): i route handler ricevono la risposta, non
 * fanno la query.
 */

export type ViewerKind = "MEMBER" | "MANAGER" | "TV";

export type Viewer = {
  auctionId: string;
  kind: ViewerKind;
  /** Il membro per cui sanificare lo snapshot; `null` per manager e TV. */
  memberId: string | null;
};

export async function resolveViewer(
  auctionId: string,
  userId: string | null,
  publicToken: string | null,
): Promise<Result<Viewer>> {
  const [auction] = await db
    .select({ id: auctions.id, ownerUserId: auctions.ownerUserId, publicToken: auctions.publicToken })
    .from(auctions)
    .where(eq(auctions.id, auctionId));
  if (!auction) return fail("NOT_FOUND", "Questa asta non esiste.");

  // La TV non ha una sessione: il token nell'URL *è* la sua autenticazione.
  if (publicToken !== null) {
    if (publicToken !== auction.publicToken) {
      return fail("FORBIDDEN", "Il link della vista TV non è valido.");
    }
    return ok({ auctionId, kind: "TV", memberId: null });
  }

  if (userId === null) {
    return fail("NOT_AUTHENTICATED", "Devi essere autenticato per seguire l'asta.");
  }

  const [member] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.auctionId, auctionId), eq(members.userId, userId)));
  if (member) return ok({ auctionId, kind: "MEMBER", memberId: member.id });

  if (auction.ownerUserId === userId) {
    return ok({ auctionId, kind: "MANAGER", memberId: null });
  }

  return fail("FORBIDDEN", "Non partecipi a quest'asta.");
}
