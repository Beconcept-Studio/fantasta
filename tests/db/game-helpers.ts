import * as XLSX from "xlsx";

import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import {
  createAuction,
  createInvite,
  importPlayers,
  joinAuction,
} from "@/lib/engine/setup";
import { SHEET_NAME } from "@/lib/import/parseListone";
import { asc, eq } from "drizzle-orm";

import { makeUser } from "./helpers";

/**
 * Un'asta pronta a giocare, per i test della Fase 3.
 *
 * Costruita passando dalle stesse funzioni dell'applicazione (come il seed:
 * uno stato che l'app sa produrre), ma **piccola apposta**: 8 posti — il
 * minimo ammesso — con 1 slot per ruolo, così un test può percorrere un'asta
 * intera in poche transizioni invece che in duecento. Il listone è sintetico:
 * 10 giocatori per ruolo bastano a I9 (1 slot × 8 seats).
 */

export type GameAuction = {
  auctionId: string;
  ownerId: string;
  userIds: string[];
  /** In ordine di seat (0..7). */
  memberIds: string[];
};

export function syntheticListone(
  counts: Record<"P" | "D" | "C" | "A", number> = { P: 10, D: 10, C: 10, A: 10 },
): ArrayBuffer {
  let id = 0;
  const rows = (["P", "D", "C", "A"] as const).flatMap((role) =>
    Array.from({ length: counts[role] }, () => {
      id += 1;
      return {
        "#": id,
        Nome: `Giocatore ${id}`,
        "Fuori lista": "",
        "Sq.": "Test",
        "R.": role,
        "R.MANTRA": role,
        // fvm decrescente dentro il ruolo: l'auto-pick è prevedibile.
        "FVM/1000": 1000 - id,
        "QUOT.": 10,
      };
    }),
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), SHEET_NAME);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export async function makeGameAuction(
  overrides: Record<string, unknown> = {},
): Promise<GameAuction> {
  const userIds: string[] = [];
  for (let i = 0; i < 8; i += 1) userIds.push(await makeUser(`game-${i}`));
  const ownerId = userIds[0];

  const { auctionId } = unwrap(
    await createAuction(ownerId, {
      name: "Asta di gioco",
      seats: 8,
      budgetDefault: 100,
      bidSeconds: 3,
      pickSeconds: 3,
      tiePrepSeconds: 2,
      revealSeconds: 1,
      slots: { P: 1, D: 1, C: 1, A: 1 },
      roleOrder: ["P", "D", "C", "A"],
      ...overrides,
    }),
  );

  unwrap(await importPlayers(ownerId, auctionId, syntheticListone()));
  const { token } = unwrap(await createInvite(ownerId, auctionId));
  for (const [i, userId] of userIds.entries()) {
    unwrap(await joinAuction(userId, token, `Squadra ${i}`));
  }

  const rows = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.auctionId, auctionId))
    .orderBy(asc(members.seatIndex));

  return { auctionId, ownerId, userIds, memberIds: rows.map((r) => r.id) };
}
