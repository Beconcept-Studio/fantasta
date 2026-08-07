import { eq, isNull, and } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { assignments, lots } from "@/lib/db/schema";
import {
  advancePhase,
  pickPlayer,
  placeBid,
  startAuction,
} from "@/lib/engine/actions";
import { setBroadcastHook } from "@/lib/engine/mutate";

import { type GameAuction, makeGameAuction } from "./game-helpers";
import {
  closeDatabase,
  databaseAvailable,
  dropAuctions,
  dropUsers,
} from "./helpers";

/**
 * F3-10 — i due test di concorrenza di §12 che la Fase 2 non poteva coprire:
 * qui non c'è motore da provare ma il **lock**, quindi serve Postgres vero e
 * chiamate davvero simultanee (`Promise.all` su connessioni distinte del
 * pool). Il criterio del backlog è la stabilità su 20 run consecutivi.
 */

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn(
    "\n⚠ Postgres non raggiungibile: i test di concorrenza sono saltati.\n",
  );
}

const createdAuctions: string[] = [];
const createdUsers: string[] = [];

afterAll(async () => {
  if (!dbUp) return;
  setBroadcastHook(() => {});
  await dropAuctions(createdAuctions);
  await dropUsers(createdUsers);
  await closeDatabase();
});

async function gameAuction(): Promise<GameAuction> {
  const game = await makeGameAuction();
  createdAuctions.push(game.auctionId);
  createdUsers.push(...game.userIds);
  return game;
}

function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe.runIf(dbUp)("F3-10 — concorrenza su Postgres vero", () => {
  beforeEach(() => {
    vi.useRealTimers();
    setBroadcastHook(() => {});
  });

  it("§12.27 — due pickPlayer concorrenti: uno solo apre il lotto", async () => {
    const game = await gameAuction();
    const now = Date.now();
    unwrap(await startAuction(game.ownerId, game.auctionId, 0, now));
    const state = unwrap(await advancePhase(game.auctionId, now)).state;
    const [p1, p2] = state.players.filter((p) => p.role === "P");

    // Il doppio click del chiamante: due pick simultanei su giocatori diversi.
    const [r1, r2] = await Promise.all([
      pickPlayer(game.userIds[0], game.auctionId, p1.id, now + 100),
      pickPlayer(game.userIds[0], game.auctionId, p2.id, now + 100),
    ]);

    const outcomes = [r1, r2];
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    const rejected = outcomes.find((r) => !r.ok)!;
    if (rejected.ok) throw new Error("impossibile");
    // Il secondo trova la fase già avanzata a LOT_OPEN.
    expect(rejected.error.code).toBe("WRONG_PHASE");

    // I1: un solo lotto, aperto.
    const lotRows = await db
      .select()
      .from(lots)
      .where(eq(lots.auctionId, game.auctionId));
    expect(lotRows).toHaveLength(1);
    expect(lotRows[0].status).toBe("OPEN");
  });

  it("§12.28 — offerte nello stesso millisecondo: nessun doppio assegnamento", async () => {
    const game = await gameAuction();
    const now = Date.now();
    unwrap(await startAuction(game.ownerId, game.auctionId, 0, now));
    const state = unwrap(await advancePhase(game.auctionId, now)).state;
    const goalkeeper = state.players.find((p) => p.role === "P")!;
    unwrap(
      await pickPlayer(game.userIds[0], game.auctionId, goalkeeper.id, now + 100),
    );

    // Stesso importo, stesso identico millisecondo.
    const tb = now + 1000;
    const [b1, b2] = await Promise.all([
      placeBid(game.userIds[1], game.auctionId, 50, tb),
      placeBid(game.userIds[2], game.auctionId, 50, tb),
    ]);
    expect(b1.ok).toBe(true);
    expect(b2.ok).toBe(true);

    // Round 1 scade: pareggio → TIE_PREP → round 2 → stallo → risoluzione.
    const round1End = now + 100 + 3000;
    expect(
      unwrap(await advancePhase(game.auctionId, round1End)).state.phase,
    ).toBe("LOT_TIE_PREP");
    const round2Start = round1End + 2000;
    expect(
      unwrap(await advancePhase(game.auctionId, round2Start)).state.phase,
    ).toBe("LOT_OPEN");
    const resolved = unwrap(
      await advancePhase(game.auctionId, round2Start + 3000),
    ).state;
    expect(resolved.phase).toBe("LOT_REVEAL");

    // Un vincitore solo, fra i due pareggianti, a 50 — e una sola riga di
    // assegnazione non annullata per il giocatore (I2).
    const lot = resolved.lots[0];
    expect([game.memberIds[1], game.memberIds[2]]).toContain(
      lot.winnerMemberId,
    );
    expect(lot.finalPrice).toBe(50);

    const owners = await db
      .select()
      .from(assignments)
      .where(
        and(
          eq(assignments.auctionId, game.auctionId),
          eq(assignments.playerId, goalkeeper.id),
          isNull(assignments.voidedAt),
        ),
      );
    expect(owners).toHaveLength(1);
    expect(owners[0].price).toBe(50);
  });
});
