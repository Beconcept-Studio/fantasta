import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { assignments, auctions, members, players } from "@/lib/db/schema";
import {
  type ExportPlayer,
  buildListoneXlsx,
  exportFileName,
} from "@/lib/import/exportListone";
import { buildRoseCsv } from "@/lib/rose-csv";

import { type Result, fail, ok } from "./errors";
import { isUuid } from "./ids";

/**
 * `exportXlsx(auctionId)` (PLAN §9, F7-06): il listone dell'asta con dentro le
 * rose, nel formato che Fantacalcio.it sa reimportare.
 *
 * È il compagno a database di `lib/import/exportListone.ts`, che il layout lo
 * costruisce ma non può leggere niente (la regola ESLint su `lib/db` vale
 * anche per `lib/import/`, e giustamente: un parser che apre query è un parser
 * che non si prova senza Postgres).
 *
 * Una sola query oltre a quella dell'asta, con due join dal lato giusto: si
 * parte dai **giocatori** — tutti, anche quelli che nessuno ha comprato,
 * perché il file è il listone e non l'elenco delle rose — e si attacca
 * l'assegnazione **non annullata**, se c'è. È l'unico posto in cui il filtro
 * `voided_at IS NULL` decide cosa finisce in un file che qualcuno caricherà
 * altrove: una riga annullata che riapparisse qui sarebbe la correzione della
 * sera dell'asta buttata via.
 */

export type ExportedFile = {
  fileName: string;
  bytes: Uint8Array;
  /** Quanti giocatori risultano assegnati: il numero che si legge a video. */
  assigned: number;
};

export async function exportXlsx(
  actorUserId: string,
  auctionId: string,
): Promise<Result<ExportedFile>> {
  if (!isUuid(auctionId)) {
    return fail("NOT_FOUND", "Questa asta non esiste.");
  }

  const auction = await db.query.auctions.findFirst({
    where: eq(auctions.id, auctionId),
  });
  if (!auction) return fail("NOT_FOUND", "Questa asta non esiste.");
  if (auction.ownerUserId !== actorUserId) {
    return fail("FORBIDDEN", "Solo chi ha creato l'asta può esportarla.");
  }

  const rows = await db
    .select({
      extId: players.extId,
      name: players.name,
      team: players.team,
      role: players.role,
      roleMantra: players.roleMantra,
      fvm: players.fvm,
      quot: players.quot,
      outOfList: players.outOfList,
      teamName: members.teamName,
      price: assignments.price,
    })
    .from(players)
    .leftJoin(
      assignments,
      and(
        eq(assignments.playerId, players.id),
        isNull(assignments.voidedAt), // regola 5: le annullate non esistono più
      ),
    )
    .leftJoin(members, eq(members.id, assignments.memberId))
    .where(eq(players.auctionId, auctionId))
    .orderBy(asc(players.extId));

  if (rows.length === 0) {
    return fail(
      "LISTONE_MISSING",
      "Quest'asta non ha un listone: non c'è niente da esportare.",
    );
  }

  const list: ExportPlayer[] = rows.map((r) => ({
    extId: r.extId,
    name: r.name,
    team: r.team,
    role: r.role,
    roleMantra: r.roleMantra,
    fvm: r.fvm,
    quot: r.quot,
    outOfList: r.outOfList,
    teamName: r.teamName,
    price: r.price,
  }));

  return ok({
    fileName: exportFileName(auction.name, "listone.xlsx"),
    bytes: buildListoneXlsx(list),
    assigned: list.filter((p) => p.price !== null).length,
  });
}

/**
 * `exportRoseCsv(auctionId)` (M3 §1): il verbale delle rose — chi ha comprato
 * chi, e a quanto. Tre colonne, solo gli assegnati.
 *
 * Convive con `exportXlsx` e non lo sostituisce, perché rispondono a due
 * domande diverse: quello serve a **rimettere** il risultato su Fantacalcio.it,
 * questo a **leggerlo**. Il primo parte dai giocatori, perché deve portarsi
 * dietro anche gli invenduti; questo parte dalle **assegnazioni**, che è la
 * differenza fra un listone e una rosa.
 *
 * Il `voided_at IS NULL` è il secondo posto in cui la regola 5 decide cosa
 * finisce in un file che qualcuno guarderà altrove: un'assegnazione annullata
 * che riapparisse qui sarebbe la correzione della sera dell'asta buttata via.
 *
 * L'ordinamento **non** è qui: sta in `roseCsvRows`, dove si collauda senza un
 * Postgres acceso. `seat_index` viaggia fino là per quello.
 */
export async function exportRoseCsv(
  actorUserId: string,
  auctionId: string,
): Promise<Result<ExportedFile>> {
  if (!isUuid(auctionId)) {
    return fail("NOT_FOUND", "Questa asta non esiste.");
  }

  const auction = await db.query.auctions.findFirst({
    where: eq(auctions.id, auctionId),
  });
  if (!auction) return fail("NOT_FOUND", "Questa asta non esiste.");
  if (auction.ownerUserId !== actorUserId) {
    return fail("FORBIDDEN", "Solo chi ha creato l'asta può esportarla.");
  }

  const rows = await db
    .select({
      seatIndex: members.seatIndex,
      teamName: members.teamName,
      extId: players.extId,
      price: assignments.price,
    })
    .from(assignments)
    .innerJoin(members, eq(members.id, assignments.memberId))
    .innerJoin(players, eq(players.id, assignments.playerId))
    .where(
      and(
        eq(assignments.auctionId, auctionId),
        isNull(assignments.voidedAt), // regola 5: le annullate non esistono più
      ),
    );

  return ok({
    fileName: exportFileName(auction.name, "rose.csv"),
    bytes: new TextEncoder().encode(buildRoseCsv(rows)),
    assigned: rows.length,
  });
}
