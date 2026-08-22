import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { auctions } from "@/lib/db/schema";
import { transition } from "@/lib/engine/machine";
import { loadAuctionState, persistTransition } from "@/lib/engine/mutate";
import type { AuctionState } from "@/lib/engine/types";

import { makeGameAuction } from "./game-helpers";
import { closeDatabase, databaseAvailable, dropAuctions, dropUsers } from "./helpers";

/**
 * F3-01 — il roundtrip load → transition → persist → load.
 *
 * Il motore di Fase 2 lavora su uno stato in memoria con id numerici; il
 * database ha righe con uuid. Questi test verificano che il mapping nei due
 * sensi non perda niente: dopo ogni transizione persistita, ricaricare lo
 * stato da zero produce **lo stesso identico oggetto** che il motore aveva
 * in mano (id compresi, perché l'assegnazione degli id di caricamento segue
 * l'ordine di creazione).
 */

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn(
    "\n⚠ Postgres non raggiungibile: i test di persistenza sono saltati.\n",
  );
}

const createdAuctions: string[] = [];
const createdUsers: string[] = [];

afterAll(async () => {
  if (!dbUp) return;
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

async function auctionRow(auctionId: string) {
  const row = await db.query.auctions.findFirst({
    where: eq(auctions.id, auctionId),
  });
  if (!row) throw new Error("asta sparita");
  return row;
}

/**
 * La forma confrontabile di uno stato: gli id del motore sono etichette di
 * caricamento (contatore in ordine di lettura), non identità persistite —
 * due load dello stesso DB li assegnano uguali, ma il load dopo una
 * transizione no. Qui si sostituiscono con identità stabili: il lotto è il
 * suo `seq`, l'offerta il suo `memberId` (UNIQUE per round), e gli ordini
 * non persistiti (bids, eligibility) si normalizzano.
 */
function comparable(state: AuctionState) {
  const seqByLotId = new Map(state.lots.map((l) => [l.id, l.seq]));
  return {
    ...state,
    nextId: null,
    currentLotId:
      state.currentLotId === null ? null : seqByLotId.get(state.currentLotId),
    lots: state.lots.map((l) => ({
      ...l,
      id: null,
      rounds: l.rounds.map((r) => ({
        ...r,
        eligibleMemberIds: [...r.eligibleMemberIds].sort(),
        bids: [...r.bids]
          .sort((a, b) => a.memberId.localeCompare(b.memberId))
          .map((b) => ({ ...b, id: null })),
      })),
    })),
    assignments: [...state.assignments]
      .sort(
        (a, b) =>
          a.createdAt - b.createdAt || a.playerId.localeCompare(b.playerId),
      )
      .map((a) => ({
        ...a,
        id: null,
        lotId: a.lotId === null ? null : seqByLotId.get(a.lotId),
      })),
  };
}

/** Applica una transizione al DB e verifica il roundtrip di ricarica. */
async function applyAndReload(
  auctionId: string,
  state: AuctionState,
  event: Parameters<typeof transition>[1],
  now: number,
): Promise<AuctionState> {
  const loaded = await loadAuctionState(db, await auctionRow(auctionId));
  // Due load consecutivi dello stesso DB sono identici, id compresi.
  expect(loaded.state).toEqual(state);

  const result = transition(loaded.state, event, now);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.value).not.toBe(loaded.state);

  await persistTransition(db, loaded, result.value, now);

  const reloaded = await loadAuctionState(db, await auctionRow(auctionId));
  expect(comparable(reloaded.state)).toEqual(comparable(result.value));
  return reloaded.state;
}

describe.runIf(dbUp)("F3-01 — load/persist dello stato", () => {
  beforeEach(() => {
    vi.useRealTimers(); // pg fa I/O vero
  });

  it("roundtrip: load → START → persist → load produce stati equivalenti", async () => {
    const { auctionId } = await gameAuction();
    const t0 = Date.now();

    const loaded = await loadAuctionState(db, await auctionRow(auctionId));
    expect(loaded.state.status).toBe("READY");
    expect(loaded.state.members).toHaveLength(8);
    expect(loaded.state.players).toHaveLength(40);
    expect(loaded.state.config.slots).toEqual({ P: 1, D: 1, C: 1, A: 1 });

    const started = transition(
      loaded.state,
      { type: "START", startSeatIndex: 0 },
      t0,
    );
    if (!started.ok) throw new Error(started.error.message);

    await persistTransition(db, loaded, started.value, t0);

    const reloaded = await loadAuctionState(db, await auctionRow(auctionId));
    expect(reloaded.state).toEqual(started.value);
    expect(reloaded.state.status).toBe("LIVE");
    expect(reloaded.state.phase).toBe("WAITING_PICK");
    expect(reloaded.state.currentRole).toBe("P");
    expect(reloaded.state.phaseDeadline).toBe(t0 + 3000);

    // La riga a DB riflette la transizione, compreso `started_at`.
    const row = await auctionRow(auctionId);
    expect(row.status).toBe("LIVE");
    expect(row.startedAt).not.toBeNull();
  });

  it("roundtrip di un lotto intero: pick, offerte, reveal, avanzamento", async () => {
    const { auctionId } = await gameAuction();
    const t0 = Date.now();

    let state = await applyAndReload(
      auctionId,
      (await loadAuctionState(db, await auctionRow(auctionId))).state,
      { type: "START", startSeatIndex: 0 },
      t0,
    );
    const [m0, m1, m2] = state.members.map((m) => m.id);
    const goalkeeper = state.players.find((p) => p.role === "P")!;

    // PICK: nasce il lotto, il round 1 e l'auto-bid a 1 del chiamante.
    state = await applyAndReload(
      auctionId,
      state,
      { type: "PICK", memberId: m0, playerId: goalkeeper.id },
      t0 + 1000,
    );
    expect(state.phase).toBe("LOT_OPEN");
    expect(state.lots).toHaveLength(1);
    expect(state.lots[0].rounds[0].bids).toHaveLength(1);

    // Offerta nuova (INSERT) e rilancio (UPDATE). ⚠ Il terzo passo era un
    // ritiro, tolto da M16: `withdrawn_at` continua a fare il round-trip in
    // `mutate.ts` per le righe vecchie, ma non c'è più un evento che la scriva.
    state = await applyAndReload(
      auctionId,
      state,
      { type: "PLACE_BID", memberId: m1, amount: 10 },
      t0 + 1500,
    );
    state = await applyAndReload(
      auctionId,
      state,
      { type: "PLACE_BID", memberId: m1, amount: 20 },
      t0 + 1700,
    );
    state = await applyAndReload(
      auctionId,
      state,
      { type: "PLACE_BID", memberId: m2, amount: 5 },
      t0 + 1900,
    );

    // Chiusura del round: assegnazione committata all'ingresso del reveal.
    state = await applyAndReload(
      auctionId,
      state,
      { type: "ADVANCE" },
      t0 + 1000 + 3000,
    );
    expect(state.phase).toBe("LOT_REVEAL");
    expect(state.lots[0].status).toBe("RESOLVED");
    expect(state.lots[0].winnerMemberId).toBe(m1);
    expect(state.lots[0].finalPrice).toBe(20);
    expect(state.assignments).toHaveLength(1);

    // Fine del reveal: si torna a WAITING_PICK sul seat successivo con uno
    // slot P libero — il seat 1 (m1) ha appena vinto il portiere, si salta a 2.
    state = await applyAndReload(
      auctionId,
      state,
      { type: "ADVANCE" },
      t0 + 1000 + 3000 + 1000,
    );
    expect(state.phase).toBe("WAITING_PICK");
    expect(state.currentSeatIndex).toBe(2);
    expect(state.currentLotId).toBeNull();
  });

  it("roundtrip dello spareggio: TIE_PREP, round 2 con carry-forward, stallo", async () => {
    const { auctionId } = await gameAuction();
    const t0 = Date.now();

    let state = await applyAndReload(
      auctionId,
      (await loadAuctionState(db, await auctionRow(auctionId))).state,
      { type: "START", startSeatIndex: 0 },
      t0,
    );
    const [m0, m1, m2] = state.members.map((m) => m.id);
    const goalkeeper = state.players.find((p) => p.role === "P")!;

    state = await applyAndReload(
      auctionId,
      state,
      { type: "PICK", memberId: m0, playerId: goalkeeper.id },
      t0 + 1000,
    );
    state = await applyAndReload(
      auctionId,
      state,
      { type: "PLACE_BID", memberId: m1, amount: 30 },
      t0 + 1200,
    );
    state = await applyAndReload(
      auctionId,
      state,
      { type: "PLACE_BID", memberId: m2, amount: 30 },
      t0 + 1400,
    );

    // Pareggio → LOT_TIE_PREP.
    state = await applyAndReload(
      auctionId,
      state,
      { type: "ADVANCE" },
      t0 + 1000 + 3000,
    );
    expect(state.phase).toBe("LOT_TIE_PREP");

    // TIE_PREP scade → round 2 con i soli pareggianti e carry-forward.
    state = await applyAndReload(
      auctionId,
      state,
      { type: "ADVANCE" },
      t0 + 1000 + 3000 + 2000,
    );
    expect(state.phase).toBe("LOT_OPEN");
    expect(state.lots[0].currentRound).toBe(2);
    const round2 = state.lots[0].rounds[1];
    expect(round2.minAmount).toBe(30);
    expect([...round2.eligibleMemberIds].sort()).toEqual([m1, m2].sort());
    // Il carry-forward preserva l'`amount_set_at` del round 1.
    expect(round2.bids.find((b) => b.memberId === m1)!.amountSetAt).toBe(
      t0 + 1200,
    );
    expect(round2.bids.find((b) => b.memberId === m2)!.amountSetAt).toBe(
      t0 + 1400,
    );

    // Stallo: nessuno rilancia → vince il carry-forward più vecchio (m1).
    state = await applyAndReload(
      auctionId,
      state,
      { type: "ADVANCE" },
      t0 + 1000 + 3000 + 2000 + 3000,
    );
    expect(state.phase).toBe("LOT_REVEAL");
    expect(state.lots[0].winnerMemberId).toBe(m1);
    expect(state.lots[0].finalPrice).toBe(30);
  });

  it("roundtrip di pause/resume: la deadline e l'ends_at traslano", async () => {
    const { auctionId } = await gameAuction();
    const t0 = Date.now();

    let state = await applyAndReload(
      auctionId,
      (await loadAuctionState(db, await auctionRow(auctionId))).state,
      { type: "START", startSeatIndex: 0 },
      t0,
    );
    const [m0] = state.members.map((m) => m.id);
    const goalkeeper = state.players.find((p) => p.role === "P")!;

    state = await applyAndReload(
      auctionId,
      state,
      { type: "PICK", memberId: m0, playerId: goalkeeper.id },
      t0 + 1000,
    );
    const endsAtBefore = state.lots[0].rounds[0].endsAt;

    state = await applyAndReload(auctionId, state, { type: "PAUSE" }, t0 + 2000);
    expect(state.status).toBe("PAUSED");
    expect(state.pausedAt).toBe(t0 + 2000);

    // Resume dopo 5 minuti: tutto trasla di 5 minuti.
    state = await applyAndReload(
      auctionId,
      state,
      { type: "RESUME" },
      t0 + 2000 + 300_000,
    );
    expect(state.status).toBe("LIVE");
    expect(state.pausedAt).toBeNull();
    expect(state.lots[0].rounds[0].endsAt).toBe(endsAtBefore + 300_000);
  });
});
