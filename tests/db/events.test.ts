import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
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
 * F3-09 — la memoria dell'asta: ogni transizione scrive una riga in `events`
 * e una riga JSON su stdout (PLAN §17). Quando qualcosa andrà storto in
 * diretta, quella tabella sarà l'unica cosa che permette di capire cosa è
 * successo — quindi la sequenza va provata, non solo l'esistenza.
 */

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn(
    "\n⚠ Postgres non raggiungibile: i test sugli eventi sono saltati.\n",
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

describe.runIf(dbUp)("F3-09 — events e log strutturato", () => {
  beforeEach(() => {
    vi.useRealTimers();
    setBroadcastHook(() => {});
  });

  it("un lotto completo produce la sequenza di eventi attesa", async () => {
    const game = await gameAuction();
    const t0 = Date.now();

    unwrap(await startAuction(game.ownerId, game.auctionId, 0, t0));
    const state = unwrap(await advancePhase(game.auctionId, t0)).state;
    const goalkeeper = state.players.find((p) => p.role === "P")!;
    unwrap(
      await pickPlayer(game.userIds[0], game.auctionId, goalkeeper.id, t0 + 500),
    );
    unwrap(await placeBid(game.userIds[1], game.auctionId, 10, t0 + 1000));
    unwrap(await advancePhase(game.auctionId, t0 + 500 + 3000)); // chiude il round
    unwrap(await advancePhase(game.auctionId, t0 + 500 + 3000 + 1000)); // fine reveal

    const rows = await db
      .select()
      .from(events)
      .where(eq(events.auctionId, game.auctionId))
      .orderBy(asc(events.id));

    expect(rows.map((r) => r.type)).toEqual([
      "START",
      "PICK",
      "PLACE_BID",
      "ADVANCE",
      "ADVANCE",
    ]);

    const payloads = rows.map((r) => r.payload as Record<string, unknown>);
    // START: da READY a LIVE/WAITING_PICK, per mano dell'owner.
    expect(payloads[0]).toMatchObject({
      from: "READY",
      to: "LIVE/WAITING_PICK",
      actor: game.ownerId,
    });
    // PICK: apre il lotto — il payload ne porta l'uuid.
    expect(payloads[1]).toMatchObject({ to: "LIVE/LOT_OPEN" });
    expect(payloads[1].lotId).toBeTruthy();
    // La chiusura del round è opera del tempo, non di un utente.
    expect(payloads[3]).toMatchObject({
      from: "LIVE/LOT_OPEN",
      to: "LIVE/LOT_REVEAL",
      actor: "system",
    });
    expect(payloads[4]).toMatchObject({
      from: "LIVE/LOT_REVEAL",
      to: "LIVE/WAITING_PICK",
      actor: "system",
    });
    // Il lotto resta riferito anche nell'evento che lo archivia.
    expect(payloads[4].lotId).toBe(payloads[1].lotId);
  });

  it("un no-op non scrive eventi", async () => {
    const game = await gameAuction();
    const t0 = Date.now();
    unwrap(await startAuction(game.ownerId, game.auctionId, 0, t0));

    // ADVANCE in anticipo: no-op, nessuna riga nuova.
    unwrap(await advancePhase(game.auctionId, t0 + 100));

    const rows = await db
      .select()
      .from(events)
      .where(eq(events.auctionId, game.auctionId));
    expect(rows.map((r) => r.type)).toEqual(["START"]);
  });

  it("ogni transizione emette la riga JSON su stdout (§17)", async () => {
    const game = await gameAuction();
    const t0 = Date.now();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    unwrap(await startAuction(game.ownerId, game.auctionId, 0, t0));

    const lines = log.mock.calls
      .map((c) => c[0])
      .filter((l): l is string => typeof l === "string")
      .filter((l) => l.includes(game.auctionId));
    log.mockRestore();

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      auctionId: game.auctionId,
      type: "START",
      from: "READY",
      to: "LIVE/WAITING_PICK",
      actor: game.ownerId,
    });
    expect(parsed.ts).toBe(new Date(t0).toISOString());
  });
});
