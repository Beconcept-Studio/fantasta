import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pickPlayer, placeBid, startAuction } from "@/lib/engine/actions";
import { setBroadcastHook } from "@/lib/engine/mutate";
import { loadForSnapshot } from "@/lib/engine/snapshot";
import {
  PRESENCE_COALESCE_MS,
  broadcastSnapshot,
  connectionCount,
  presenceScheduled,
  resetBroadcast,
  schedulePresenceSnapshot,
  scheduleSnapshot,
  subscribe,
} from "@/lib/realtime/broadcast";
import type { Snapshot } from "@/lib/realtime/types";

import { type GameAuction, makeGameAuction } from "./game-helpers";
import {
  closeDatabase,
  databaseAvailable,
  dropAuctions,
  dropUsers,
} from "./helpers";

/**
 * F4-03 — il registro delle connessioni e l'invio degli snapshot.
 *
 * La proprietà che conta è una sola: **da una mutazione sola escono snapshot
 * diversi**, uno per viewer. Se il broadcast serializzasse una volta per
 * tutti, il `myBid` di qualcuno finirebbe sullo schermo di qualcun altro — e
 * sarebbe I8 rotta dal canale invece che dalla funzione di serializzazione.
 */

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn("\n⚠ Postgres non raggiungibile: i test sul broadcast sono saltati.\n");
}

const createdAuctions: string[] = [];
const createdUsers: string[] = [];

afterEach(() => {
  resetBroadcast();
  setBroadcastHook(() => {});
});

afterAll(async () => {
  if (!dbUp) return;
  await dropAuctions(createdAuctions);
  await dropUsers(createdUsers);
  await closeDatabase();
});

function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** Un'asta con un lotto aperto e due offerte diverse già a database. */
async function auctionWithTwoBids(): Promise<GameAuction & { t0: number }> {
  const game = await makeGameAuction();
  createdAuctions.push(game.auctionId);
  createdUsers.push(...game.userIds);

  const t0 = Date.now();
  unwrap(await startAuction(game.ownerId, game.auctionId, 0, t0));
  const loaded = await loadForSnapshot(game.auctionId);
  const gk = loaded!.state.players.find((p) => p.role === "P")!;
  unwrap(await pickPlayer(game.userIds[0], game.auctionId, gk.id, t0 + 500));
  unwrap(await placeBid(game.userIds[1], game.auctionId, 11, t0 + 600));
  unwrap(await placeBid(game.userIds[2], game.auctionId, 22, t0 + 700));
  return { ...game, t0 };
}

describe.runIf(dbUp)("F4-03 — broadcast per viewer", () => {
  // `pg` fa I/O vero: qui i timer finti di default non servono e darebbero
  // fastidio a `vi.waitFor` (stessa scelta degli altri test di integrazione).
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("due connessioni con membri diversi ricevono myBid diversi", async () => {
    const game = await auctionWithTwoBids();
    const received: Record<string, Snapshot[]> = { uno: [], due: [], tv: [] };

    subscribe(game.auctionId, {
      viewerMemberId: game.memberIds[1],
      send: (s) => received.uno.push(s),
    });
    subscribe(game.auctionId, {
      viewerMemberId: game.memberIds[2],
      send: (s) => received.due.push(s),
    });
    subscribe(game.auctionId, {
      viewerMemberId: null,
      send: (s) => received.tv.push(s),
    });

    await broadcastSnapshot(game.auctionId);

    expect(received.uno).toHaveLength(1);
    expect(received.due).toHaveLength(1);
    expect(received.tv).toHaveLength(1);
    expect(received.uno[0].myBid?.amount).toBe(11);
    expect(received.due[0].myBid?.amount).toBe(22);
    expect(received.tv[0].myBid).toBeNull();
    // Nessuno dei tre vede la cifra dell'altro.
    expect(JSON.stringify(received.uno[0])).not.toContain('"amount":22');
    expect(JSON.stringify(received.due[0])).not.toContain('"amount":11');
    expect(JSON.stringify(received.tv[0])).not.toContain('"amount"');
  });

  it("un'asta senza connessioni non carica niente, e la disiscrizione svuota la mappa", async () => {
    const game = await auctionWithTwoBids();
    expect(connectionCount(game.auctionId)).toBe(0);
    await broadcastSnapshot(game.auctionId); // non deve esplodere

    const unsubscribe = subscribe(game.auctionId, {
      viewerMemberId: null,
      send: () => {},
    });
    expect(connectionCount(game.auctionId)).toBe(1);
    unsubscribe();
    expect(connectionCount(game.auctionId)).toBe(0);
    expect(connectionCount()).toBe(0);
  });

  it("una connessione morta non impedisce la consegna alle altre", async () => {
    const game = await auctionWithTwoBids();
    const arrivati: Snapshot[] = [];
    subscribe(game.auctionId, {
      viewerMemberId: null,
      send: () => {
        throw new Error("controller chiuso");
      },
    });
    subscribe(game.auctionId, {
      viewerMemberId: game.memberIds[1],
      send: (s) => arrivati.push(s),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await broadcastSnapshot(game.auctionId);

    expect(arrivati).toHaveLength(1);
  });

  it("l'hook di mutate fa partire un broadcast a ogni mutazione effettiva", async () => {
    const game = await auctionWithTwoBids();
    const arrivati: Snapshot[] = [];
    subscribe(game.auctionId, {
      viewerMemberId: game.memberIds[3],
      send: (s) => arrivati.push(s),
    });
    setBroadcastHook(scheduleSnapshot);

    unwrap(await placeBid(game.userIds[3], game.auctionId, 5, game.t0 + 800));
    // Il broadcast parte dopo il commit, senza far aspettare l'azione.
    await vi.waitFor(() => expect(arrivati).toHaveLength(1));

    expect(arrivati[0].myBid?.amount).toBe(5);
  });
});

describe("F4-03 — coalescing dei cambi di presence (⚠ P8)", () => {
  beforeEach(() => {
    resetBroadcast();
  });

  it("cinque cambi nella stessa finestra producono un solo invio in coda", () => {
    const auctionId = "asta-finta";
    for (let i = 0; i < 5; i += 1) schedulePresenceSnapshot(auctionId);

    expect(presenceScheduled(auctionId)).toBe(true);

    vi.advanceTimersByTime(PRESENCE_COALESCE_MS - 1);
    expect(presenceScheduled(auctionId)).toBe(true);

    vi.advanceTimersByTime(1);
    expect(presenceScheduled(auctionId)).toBe(false);

    // Passata la finestra, il cambio successivo riparte.
    schedulePresenceSnapshot(auctionId);
    expect(presenceScheduled(auctionId)).toBe(true);
  });
});
