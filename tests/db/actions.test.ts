import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { auctions, bids, lotRounds, lots } from "@/lib/db/schema";
import {
  advancePhase,
  pauseAuction,
  pickPlayer,
  placeBid,
  resumeAuction,
  skipReveal,
  startAuction,
  withdrawBid,
} from "@/lib/engine/actions";
import { setBroadcastHook } from "@/lib/engine/mutate";
import type { AuctionState } from "@/lib/engine/types";

import { type GameAuction, makeGameAuction } from "./game-helpers";
import {
  closeDatabase,
  databaseAvailable,
  dropAuctions,
  dropUsers,
  makeUser,
} from "./helpers";

/**
 * F3-03/04/05/06/07 — le azioni di gioco sul database.
 *
 * Ogni azione carica lo stato, chiama il motore puro e persiste, tutto dentro
 * `withAuctionLock`. Il tempo si inietta (`now` opzionale): un test che deve
 * "aspettare 5 minuti" passa un numero, non dorme — è la stessa disciplina
 * del motore, portata alle azioni.
 */

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn(
    "\n⚠ Postgres non raggiungibile: i test delle azioni sono saltati.\n",
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

async function auctionRow(auctionId: string) {
  const row = await db.query.auctions.findFirst({
    where: eq(auctions.id, auctionId),
  });
  if (!row) throw new Error("asta sparita");
  return row;
}

function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** Un'asta LIVE con un lotto P aperto dal seat 0, per i test sulle offerte. */
async function liveWithOpenLot(now: number): Promise<
  GameAuction & { state: AuctionState; goalkeeperId: string }
> {
  const game = await gameAuction();
  unwrap(await startAuction(game.ownerId, game.auctionId, 0, now));
  const started = unwrap(await advancePhase(game.auctionId, now)); // no-op, ma torna lo stato
  const goalkeeper = started.state.players.find((p) => p.role === "P")!;
  const picked = unwrap(
    await pickPlayer(game.userIds[0], game.auctionId, goalkeeper.id, now + 500),
  );
  return { ...game, state: picked.state, goalkeeperId: goalkeeper.id };
}

describe.runIf(dbUp)("F3-04 — startAuction", () => {
  beforeEach(() => {
    vi.useRealTimers(); // pg fa I/O vero
    setBroadcastHook(() => {});
  });

  it("porta un'asta READY in LIVE su WAITING_PICK con la deadline armata", async () => {
    const game = await gameAuction();
    const now = Date.now();

    const result = unwrap(
      await startAuction(game.ownerId, game.auctionId, 2, now),
    );
    expect(result.state.status).toBe("LIVE");
    expect(result.state.phase).toBe("WAITING_PICK");
    expect(result.state.currentRole).toBe("P");
    expect(result.state.currentSeatIndex).toBe(2);
    expect(result.state.phaseDeadline).toBe(now + 3000);

    const row = await auctionRow(game.auctionId);
    expect(row.status).toBe("LIVE");
    expect(row.phase).toBe("WAITING_PICK");
    expect(row.phaseDeadline!.getTime()).toBe(now + 3000);
    expect(row.stateVersion).toBe(1);
  });

  it("rifiuta chi non è l'owner, senza toccare l'asta", async () => {
    const game = await gameAuction();
    const result = await startAuction(game.userIds[3], game.auctionId, 0);
    expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect((await auctionRow(game.auctionId)).status).toBe("READY");
  });

  it("rifiuta un'asta non pronta con WRONG_STATUS", async () => {
    const game = await gameAuction();
    const now = Date.now();
    unwrap(await startAuction(game.ownerId, game.auctionId, 0, now));
    const again = await startAuction(game.ownerId, game.auctionId, 0, now);
    expect(again).toMatchObject({ ok: false, error: { code: "WRONG_STATUS" } });
  });
});

describe.runIf(dbUp)("F3-03 — errori tipizzati dalle azioni", () => {
  beforeEach(() => {
    vi.useRealTimers();
    setBroadcastHook(() => {});
  });

  it("pick fuori turno → NOT_YOUR_TURN", async () => {
    const game = await gameAuction();
    const now = Date.now();
    unwrap(await startAuction(game.ownerId, game.auctionId, 0, now));
    const state = unwrap(await advancePhase(game.auctionId, now)).state;
    const goalkeeper = state.players.find((p) => p.role === "P")!;

    const result = await pickPlayer(
      game.userIds[1],
      game.auctionId,
      goalkeeper.id,
      now + 100,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "NOT_YOUR_TURN" },
    });
  });

  it("offerta oltre max_bid → BID_TOO_HIGH", async () => {
    const now = Date.now();
    const game = await liveWithOpenLot(now);
    // Budget 100, 4 slot: max_bid = 100 − 3 = 97.
    const result = await placeBid(
      game.userIds[1],
      game.auctionId,
      98,
      now + 1000,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "BID_TOO_HIGH" } });
  });

  it("chi non è membro dell'asta → MEMBER_NOT_FOUND", async () => {
    const now = Date.now();
    const game = await liveWithOpenLot(now);
    const intruso = await makeUser("intruso");
    createdUsers.push(intruso);
    const result = await placeBid(intruso, game.auctionId, 10, now + 1000);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "MEMBER_NOT_FOUND" },
    });
  });
});

describe.runIf(dbUp)("F3-05 — pick, bid e withdraw scrivono le righe attese", () => {
  beforeEach(() => {
    vi.useRealTimers();
    setBroadcastHook(() => {});
  });

  it("pick → bid × N → withdraw produce lots/lot_rounds/bids coerenti", async () => {
    const now = Date.now();
    const game = await liveWithOpenLot(now);

    unwrap(await placeBid(game.userIds[1], game.auctionId, 10, now + 1000));
    unwrap(await placeBid(game.userIds[2], game.auctionId, 15, now + 1100));
    unwrap(await placeBid(game.userIds[1], game.auctionId, 20, now + 1200));
    unwrap(await withdrawBid(game.userIds[2], game.auctionId, now + 1300));

    const lotRows = await db
      .select()
      .from(lots)
      .where(eq(lots.auctionId, game.auctionId));
    expect(lotRows).toHaveLength(1);
    expect(lotRows[0].status).toBe("OPEN");
    expect(lotRows[0].autoCalled).toBe(false);

    const roundRows = await db
      .select()
      .from(lotRounds)
      .where(eq(lotRounds.lotId, lotRows[0].id));
    expect(roundRows).toHaveLength(1);
    expect(roundRows[0].minAmount).toBe(1);
    expect(roundRows[0].endsAt.getTime()).toBe(now + 500 + 3000);

    const bidRows = await db
      .select()
      .from(bids)
      .where(eq(bids.lotRoundId, roundRows[0].id))
      .orderBy(asc(bids.createdAt));
    expect(bidRows).toHaveLength(3);
    // L'auto-bid a 1 del chiamante, nato col pick.
    expect(bidRows[0].amount).toBe(1);
    expect(bidRows[0].amountSetAt.getTime()).toBe(now + 500);
    // L'override è un UPDATE della stessa riga, non una riga nuova.
    expect(bidRows[1].amount).toBe(20);
    expect(bidRows[1].amountSetAt.getTime()).toBe(now + 1200);
    // Il ritiro resta a DB, marcato.
    expect(bidRows[2].amount).toBe(15);
    expect(bidRows[2].withdrawnAt?.getTime()).toBe(now + 1300);

    // 1 start + 1 pick + 3 bid + 1 withdraw = 6 mutazioni effettive.
    expect((await auctionRow(game.auctionId)).stateVersion).toBe(6);
  });

  it("confermare la stessa cifra è un no-op: niente bump di versione (P3/P14)", async () => {
    const now = Date.now();
    const game = await liveWithOpenLot(now);
    unwrap(await placeBid(game.userIds[1], game.auctionId, 10, now + 1000));
    const versionBefore = (await auctionRow(game.auctionId)).stateVersion;

    unwrap(await placeBid(game.userIds[1], game.auctionId, 10, now + 2000));

    const row = await auctionRow(game.auctionId);
    expect(row.stateVersion).toBe(versionBefore);
  });
});

describe.runIf(dbUp)("F3-06 — advancePhase guardata (§12.26 su DB)", () => {
  beforeEach(() => {
    vi.useRealTimers();
    setBroadcastHook(() => {});
  });

  it("due chiamate sulla stessa deadline: un solo effetto", async () => {
    const now = Date.now();
    const game = await liveWithOpenLot(now);
    unwrap(await placeBid(game.userIds[1], game.auctionId, 10, now + 1000));
    const deadline = now + 500 + 3000;

    const first = unwrap(await advancePhase(game.auctionId, deadline));
    expect(first.state.phase).toBe("LOT_REVEAL");
    const versionAfterFirst = (await auctionRow(game.auctionId)).stateVersion;

    const second = unwrap(await advancePhase(game.auctionId, deadline));
    expect(second.state.phase).toBe("LOT_REVEAL");
    expect((await auctionRow(game.auctionId)).stateVersion).toBe(
      versionAfterFirst,
    );

    const lotRows = await db
      .select()
      .from(lots)
      .where(eq(lots.auctionId, game.auctionId));
    expect(lotRows).toHaveLength(1);
    expect(lotRows[0].status).toBe("RESOLVED");
    expect(lotRows[0].winnerMemberId).toBe(game.memberIds[1]);
  });

  it("in anticipo sulla deadline è un no-op", async () => {
    const now = Date.now();
    const game = await liveWithOpenLot(now);
    const versionBefore = (await auctionRow(game.auctionId)).stateVersion;

    const result = unwrap(await advancePhase(game.auctionId, now + 1000));
    expect(result.state.phase).toBe("LOT_OPEN");
    expect((await auctionRow(game.auctionId)).stateVersion).toBe(versionBefore);
  });
});

describe.runIf(dbUp)("F3-07 — pause e resume (§12.29 su DB)", () => {
  beforeEach(() => {
    vi.useRealTimers();
    setBroadcastHook(() => {});
  });

  it("resume dopo 5 minuti di pausa: il countdown riprende dal residuo", async () => {
    const now = Date.now();
    const game = await liveWithOpenLot(now);
    // Round aperto a now+500, scade a now+3500. Pausa a now+2000: residuo 1.5s.
    unwrap(await pauseAuction(game.ownerId, game.auctionId, now + 2000));
    expect((await auctionRow(game.auctionId)).status).toBe("PAUSED");

    // Un'offerta in pausa è rifiutata.
    const inPause = await placeBid(game.userIds[1], game.auctionId, 5, now + 2500);
    expect(inPause).toMatchObject({ ok: false, error: { code: "WRONG_STATUS" } });

    const resumeAt = now + 2000 + 300_000;
    const resumed = unwrap(
      await resumeAuction(game.ownerId, game.auctionId, resumeAt),
    );
    expect(resumed.state.status).toBe("LIVE");
    expect(resumed.state.phaseDeadline).toBe(resumeAt + 1500);

    // Il round NON risulta scaduto: un'offerta dentro il residuo passa...
    const bid = await placeBid(
      game.userIds[1],
      game.auctionId,
      5,
      resumeAt + 1000,
    );
    expect(bid.ok).toBe(true);

    // ...e advancePhase alla vecchia deadline è un no-op.
    const early = unwrap(await advancePhase(game.auctionId, now + 3500));
    expect(early.state.phase).toBe("LOT_OPEN");
    expect(early.state.status).toBe("LIVE");
  });

  it("pause e resume sono dell'owner", async () => {
    const now = Date.now();
    const game = await liveWithOpenLot(now);
    const result = await pauseAuction(game.userIds[1], game.auctionId, now + 100);
    expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("doppia pausa: la seconda è un no-op senza bump", async () => {
    const now = Date.now();
    const game = await liveWithOpenLot(now);
    unwrap(await pauseAuction(game.ownerId, game.auctionId, now + 1000));
    const version = (await auctionRow(game.auctionId)).stateVersion;

    unwrap(await pauseAuction(game.ownerId, game.auctionId, now + 1500));
    expect((await auctionRow(game.auctionId)).stateVersion).toBe(version);
    // `paused_at` resta quello della prima pausa.
    expect((await auctionRow(game.auctionId)).pausedAt!.getTime()).toBe(
      now + 1000,
    );
  });
});

describe.runIf(dbUp)("«Prosegui asta» — la regia chiude il reveal in anticipo", () => {
  beforeEach(() => {
    vi.useRealTimers();
    setBroadcastHook(() => {});
  });

  /** Un lotto già assegnato: l'asta è in LOT_REVEAL con la sua deadline. */
  async function inReveal(now: number) {
    const game = await liveWithOpenLot(now);
    const roundEnds = game.state.lots[0].rounds[0].endsAt;
    const revealed = unwrap(await advancePhase(game.auctionId, roundEnds));
    expect(revealed.state.phase).toBe("LOT_REVEAL");
    return { ...game, revealEndsAt: revealed.state.phaseDeadline! };
  }

  it("passa il turno subito e riarma la deadline sull'istante del click", async () => {
    const now = Date.now();
    const game = await inReveal(now);
    const clickAt = game.revealEndsAt - 4000;

    const after = unwrap(
      await skipReveal(game.ownerId, game.auctionId, clickAt),
    );

    expect(after.state.phase).toBe("WAITING_PICK");
    // La deadline nasce dall'istante del click, non da quella del reveal che
    // stiamo saltando: è la differenza fra «prosegui» e «fai finta che sia
    // scaduto». Legata alla config, non a un numero: i fixture hanno timer
    // corti e un 30_000 scritto qui sarebbe verde per caso.
    expect(after.state.phaseDeadline).toBe(
      clickAt + after.state.config.pickSeconds * 1000,
    );
    expect(after.state.phaseDeadline).toBeLessThan(game.revealEndsAt + 30_000);
    const row = await auctionRow(game.auctionId);
    expect(row.phase).toBe("WAITING_PICK");
    // L'assegnazione era già committata all'ingresso del reveal: saltare
    // l'attesa non deve toccarla.
    expect(after.state.assignments).toHaveLength(1);
  });

  it("è dell'owner: a un partecipante è rifiutato", async () => {
    const now = Date.now();
    const game = await inReveal(now);
    const result = await skipReveal(
      game.userIds[1],
      game.auctionId,
      game.revealEndsAt - 4000,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("fuori dal reveal è rifiutato e non bumpa state_version", async () => {
    const now = Date.now();
    const game = await liveWithOpenLot(now); // siamo in LOT_OPEN
    const version = (await auctionRow(game.auctionId)).stateVersion;

    const result = await skipReveal(game.ownerId, game.auctionId, now + 1000);
    expect(result).toMatchObject({ ok: false, error: { code: "WRONG_PHASE" } });
    expect((await auctionRow(game.auctionId)).stateVersion).toBe(version);
  });

  it("ad asta in pausa è rifiutato: prima si riprende", async () => {
    const now = Date.now();
    const game = await inReveal(now);
    const pauseAt = game.revealEndsAt - 5000;
    unwrap(await pauseAuction(game.ownerId, game.auctionId, pauseAt));

    const result = await skipReveal(game.ownerId, game.auctionId, pauseAt + 100);
    expect(result).toMatchObject({ ok: false, error: { code: "WRONG_PHASE" } });
  });
});
