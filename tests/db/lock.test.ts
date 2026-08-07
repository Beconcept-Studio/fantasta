import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { auctions } from "@/lib/db/schema";
import { ok } from "@/lib/engine/errors";
import { setBroadcastHook, withAuctionLock } from "@/lib/engine/mutate";

import { makeGameAuction } from "./game-helpers";
import {
  closeDatabase,
  databaseAvailable,
  dropAuctions,
  dropUsers,
} from "./helpers";

/**
 * F3-02 — `withAuctionLock` (PLAN §6, ⚠ P14).
 *
 * La prova di serializzazione non usa sleep: due mutazioni concorrenti
 * leggono `state_version` dalla riga bloccata e la incrementano. Se il
 * `FOR UPDATE` serializza davvero, la seconda transazione può leggere solo
 * DOPO il commit della prima, quindi le due versioni osservate sono
 * necessariamente diverse. Senza lock leggerebbero lo stesso valore.
 */

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn("\n⚠ Postgres non raggiungibile: i test del lock sono saltati.\n");
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

async function gameAuction() {
  const game = await makeGameAuction();
  createdAuctions.push(game.auctionId);
  createdUsers.push(...game.userIds);
  return game;
}

async function stateVersionOf(auctionId: string): Promise<number> {
  const row = await db.query.auctions.findFirst({
    where: eq(auctions.id, auctionId),
  });
  return row!.stateVersion;
}

describe.runIf(dbUp)("F3-02 — withAuctionLock", () => {
  beforeEach(() => {
    vi.useRealTimers(); // pg fa I/O vero
    setBroadcastHook(() => {});
  });

  it("serializza due mutazioni concorrenti sulla stessa asta", async () => {
    const { auctionId } = await gameAuction();

    const observed = await Promise.all([
      withAuctionLock(auctionId, async (_tx, loaded) => ({
        result: ok(loaded.auction.stateVersion),
        mutated: true,
      })),
      withAuctionLock(auctionId, async (_tx, loaded) => ({
        result: ok(loaded.auction.stateVersion),
        mutated: true,
      })),
    ]);

    const versions = observed.map((r) => {
      if (!r.ok) throw new Error(r.error.message);
      return r.value;
    });
    // Serializzate: la seconda vede il bump della prima.
    expect(versions.sort()).toEqual([0, 1]);
    expect(await stateVersionOf(auctionId)).toBe(2);
  });

  it("una mutazione effettiva incrementa state_version e fa broadcast", async () => {
    const { auctionId } = await gameAuction();
    const broadcasts: string[] = [];
    setBroadcastHook((id) => broadcasts.push(id));

    const result = await withAuctionLock(auctionId, async () => ({
      result: ok("fatto"),
      mutated: true,
    }));

    expect(result).toEqual({ ok: true, value: "fatto" });
    expect(await stateVersionOf(auctionId)).toBe(1);
    expect(broadcasts).toEqual([auctionId]);
  });

  it("un no-op non incrementa state_version e non fa broadcast (P14)", async () => {
    const { auctionId } = await gameAuction();
    const broadcasts: string[] = [];
    setBroadcastHook((id) => broadcasts.push(id));

    const result = await withAuctionLock(auctionId, async () => ({
      result: ok("niente da fare"),
      mutated: false,
    }));

    expect(result).toEqual({ ok: true, value: "niente da fare" });
    expect(await stateVersionOf(auctionId)).toBe(0);
    expect(broadcasts).toEqual([]);
  });

  it("un rifiuto del corpo non incrementa la versione", async () => {
    const { auctionId } = await gameAuction();

    const result = await withAuctionLock(auctionId, async () => ({
      result: {
        ok: false as const,
        error: { code: "WRONG_STATUS" as const, message: "no" },
      },
      mutated: false,
    }));

    expect(result.ok).toBe(false);
    expect(await stateVersionOf(auctionId)).toBe(0);
  });

  it("asta inesistente → NOT_FOUND", async () => {
    const result = await withAuctionLock(
      "00000000-0000-0000-0000-000000000000",
      async () => ({ result: ok(null), mutated: false }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
});
