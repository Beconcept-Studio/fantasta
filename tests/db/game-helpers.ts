import * as XLSX from "xlsx";

import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { recordHeartbeat } from "@/lib/engine/presence";
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
  /** Con `ownerPlays: false` è un nono utente, che non ha una riga `members`. */
  ownerId: string;
  /** Gli utenti seduti ai posti, in ordine di seat (0..7). */
  userIds: string[];
  /** In ordine di seat (0..7). */
  memberIds: string[];
};

export type GameAuctionOptions = {
  /** Campi di configurazione da sovrascrivere in `createAuction`. */
  config?: Record<string, unknown>;
  /**
   * ⚠ P11 — l'owner tipicamente gioca, ma non è obbligato. Con `false` l'asta
   * ha un organizzatore che non è membro: è il "manager" della vista di F4-08.
   */
  ownerPlays?: boolean;
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

export async function makeGameAuction({
  config = {},
  ownerPlays = true,
}: GameAuctionOptions = {}): Promise<GameAuction> {
  const userIds: string[] = [];
  for (let i = 0; i < 8; i += 1) userIds.push(await makeUser(`game-${i}`));
  const ownerId = ownerPlays ? userIds[0] : await makeUser("game-owner");

  const { auctionId } = unwrap(
    await createAuction(ownerId, {
      name: "Asta di gioco",
      seats: 8,
      budgetDefault: 100,
      bidSeconds: 3,
      pickSeconds: 3,
      tiePrepSeconds: 2,
      revealSeconds: 1,
      // ⚠ **Il cancello dei risultati spento, e serve dirlo qui** (M14). `createAuction`
      // valida contro `DEFAULT_CONFIG`, che lo propone a 10: senza questa riga ogni
      // asta di test nascerebbe con il cancello acceso e i test scritti prima di M14
      // troverebbero `LOT_SEALED` dove si aspettano `LOT_REVEAL` — 28 rossi, tutti
      // per una fase in più e nessuno per un bug.
      //
      // Ed è anche la scelta giusta e non solo la comoda: così **tutti i test già
      // scritti restano la prova che con `X = 0` l'asta si comporta come a v1.14.0**
      // (verifica 10 della spec), dimostrata dalle asserzioni che esistevano invece
      // che da un test nuovo che lo racconta. Chi vuole il cancello lo chiede:
      // `makeGameAuction({ config: { resultGateSeconds: 10 } })`.
      resultGateSeconds: 0,
      slots: { P: 1, D: 1, C: 1, A: 1 },
      roleOrder: ["P", "D", "C", "A"],
      ...config,
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
  const memberIds = rows.map((r) => r.id);

  // F4-06: senza presence l'asta non parte. Un test che vuole verificare il
  // gate spegne un membro con `markPresent` su un `now` abbastanza vecchio.
  await markAllPresent(auctionId, memberIds);

  return { auctionId, ownerId, userIds, memberIds };
}

/** Simula l'heartbeat di tutti i membri: è ciò che in diretta fa il browser. */
export async function markAllPresent(
  auctionId: string,
  memberIds: string[],
  now: number = Date.now(),
): Promise<void> {
  for (const memberId of memberIds) {
    await recordHeartbeat(auctionId, memberId, true, now);
  }
}
