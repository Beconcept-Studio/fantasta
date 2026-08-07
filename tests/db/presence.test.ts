import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { auctions, members } from "@/lib/db/schema";
import { startAuction } from "@/lib/engine/actions";
import { setBroadcastHook } from "@/lib/engine/mutate";
import {
  PRESENCE_WINDOW_MS,
  readPresence,
  recordHeartbeat,
  resetPresenceMemory,
} from "@/lib/engine/presence";
import { loadForSnapshot, serializeSnapshot } from "@/lib/engine/snapshot";

import { type GameAuction, makeGameAuction, markAllPresent } from "./game-helpers";
import {
  closeDatabase,
  databaseAvailable,
  dropAuctions,
  dropUsers,
} from "./helpers";

/**
 * F4-05/F4-06 — heartbeat, presence e il cancello di avvio.
 *
 * Due proprietà da tenere insieme: l'heartbeat **non è una mutazione** (⚠ P8 —
 * niente lock, niente bump di `state_version`, niente snapshot per
 * invocazione), e però la presence che ne deriva è ciò che decide se l'asta
 * può partire (PLAN §7).
 */

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn("\n⚠ Postgres non raggiungibile: i test sulla presence sono saltati.\n");
}

const createdAuctions: string[] = [];
const createdUsers: string[] = [];

beforeEach(() => {
  vi.useRealTimers();
  resetPresenceMemory();
});

afterEach(() => {
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

async function gameAuction(): Promise<GameAuction> {
  const game = await makeGameAuction();
  createdAuctions.push(game.auctionId);
  createdUsers.push(...game.userIds);
  return game;
}

describe.runIf(dbUp)("F4-05 — heartbeat", () => {
  it("scrive la telemetria senza toccare state_version (⚠ P8)", async () => {
    const game = await gameAuction();
    const before = await db.query.auctions.findFirst({
      where: eq(auctions.id, game.auctionId),
    });

    const now = Date.now();
    await recordHeartbeat(game.auctionId, game.memberIds[0], true, now);
    await recordHeartbeat(game.auctionId, game.memberIds[0], false, now + 100);

    const after = await db.query.auctions.findFirst({
      where: eq(auctions.id, game.auctionId),
    });
    expect(after!.stateVersion).toBe(before!.stateVersion);

    const [row] = await db
      .select({ lastSeenAt: members.lastSeenAt, isVisible: members.isVisible })
      .from(members)
      .where(eq(members.id, game.memberIds[0]));
    expect(row.lastSeenAt?.getTime()).toBe(now + 100);
    expect(row.isVisible).toBe(false);
  });

  it("segnala un cambio solo quando la presence cambia davvero", async () => {
    const game = await gameAuction();
    const now = Date.now();
    resetPresenceMemory(); // l'asta nasce già con tutti presenti (markAllPresent)

    // La prima lettura è sempre un cambio: prima non si era annunciato niente.
    expect((await readPresence(game.auctionId, now)).changed).toBe(true);
    // Battere il colpo di chi era già LIVE non cambia niente per nessuno.
    const again = await recordHeartbeat(game.auctionId, game.memberIds[0], true, now);
    expect(again.changed).toBe(false);
    // Lo stesso membro che passa in background sì.
    const idle = await recordHeartbeat(game.auctionId, game.memberIds[0], false, now);
    expect(idle.changed).toBe(true);
    expect(idle.presence.get(game.memberIds[0])).toBe("IDLE");
  });

  it("si accorge di chi ha smesso di battere, al primo heartbeat altrui", async () => {
    const game = await gameAuction();
    const now = Date.now();
    await markAllPresent(game.auctionId, game.memberIds, now);
    await readPresence(game.auctionId, now); // stato annunciato: tutti LIVE

    // Passano 20 secondi; solo il seat 1 batte ancora il colpo.
    const later = now + 20_000;
    const outcome = await recordHeartbeat(
      game.auctionId,
      game.memberIds[1],
      true,
      later,
    );

    expect(outcome.changed).toBe(true);
    expect(outcome.presence.get(game.memberIds[1])).toBe("LIVE");
    expect(outcome.presence.get(game.memberIds[0])).toBe("OFFLINE");
  });

  it("la presence derivata finisce nello snapshot", async () => {
    const game = await gameAuction();
    const now = Date.now();
    await recordHeartbeat(game.auctionId, game.memberIds[0], true, now);
    await recordHeartbeat(game.auctionId, game.memberIds[1], false, now);
    await recordHeartbeat(
      game.auctionId,
      game.memberIds[2],
      true,
      now - PRESENCE_WINDOW_MS,
    );

    const loaded = await loadForSnapshot(game.auctionId);
    const snap = serializeSnapshot(loaded!, null, now);
    const presenceOf = (id: string) =>
      snap.members.find((m) => m.id === id)?.presence;

    expect(presenceOf(game.memberIds[0])).toBe("LIVE");
    expect(presenceOf(game.memberIds[1])).toBe("IDLE");
    expect(presenceOf(game.memberIds[2])).toBe("OFFLINE");
  });
});

describe.runIf(dbUp)("F4-06 — gate presence su startAuction (⚠ P11)", () => {
  it("con un membro non collegato l'asta non parte", async () => {
    const game = await gameAuction();
    const now = Date.now();
    // Tutti presenti tranne il seat 3, visto venti secondi fa.
    await markAllPresent(game.auctionId, game.memberIds, now);
    await recordHeartbeat(game.auctionId, game.memberIds[3], true, now - 20_000);

    const result = await startAuction(game.ownerId, game.auctionId, 0, now);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MEMBERS_NOT_READY");
    // Il messaggio nomina chi manca: in lobby "membri non pronti" non basta.
    expect(result.error.message).toContain("game-3");

    const row = await db.query.auctions.findFirst({
      where: eq(auctions.id, game.auctionId),
    });
    expect(row!.status).toBe("READY");
  });

  it("un membro con il tab in background (IDLE) non basta", async () => {
    const game = await gameAuction();
    const now = Date.now();
    await markAllPresent(game.auctionId, game.memberIds, now);
    await recordHeartbeat(game.auctionId, game.memberIds[5], false, now);

    const result = await startAuction(game.ownerId, game.auctionId, 0, now);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("MEMBERS_NOT_READY");
  });

  it("con tutti LIVE l'asta parte", async () => {
    const game = await gameAuction();
    const now = Date.now();
    await markAllPresent(game.auctionId, game.memberIds, now);

    const started = unwrap(await startAuction(game.ownerId, game.auctionId, 0, now));

    expect(started.state.status).toBe("LIVE");
    expect(started.state.phase).toBe("WAITING_PICK");
  });
});
