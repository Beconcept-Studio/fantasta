import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { assignments, auctions, events, ledger } from "@/lib/db/schema";
import {
  advancePhase,
  pauseAuction,
  pickPlayer,
  placeBid,
  startAuction,
} from "@/lib/engine/actions";
import { setBroadcastHook } from "@/lib/engine/mutate";
import { adjustBudget, manualAssign, voidAssignment } from "@/lib/engine/override";
import { credits, ownedByRole } from "@/lib/engine/rules";
import { loadForSnapshot } from "@/lib/engine/snapshot";
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
 * F7-01…F7-04 — gli override del manager, e la suite §12.35–40.
 *
 * Sono le uniche azioni che riscrivono un fatto già accaduto, e la loro prova
 * non è «la funzione restituisce ok»: è **cosa resta a database**. Un void che
 * cancellasse la riga passerebbe qualunque test scritto sui crediti, e sarebbe
 * comunque la violazione della regola 5 — quindi qui si guardano le righe, non
 * solo i numeri.
 *
 * L'asta di prova è quella di `makeGameAuction`: 8 posti, 1 slot per ruolo,
 * budget 100. Con 4 slot totali, `max_bid` di partenza è 100 − 3 = 97, e i
 * conti di I3 si fanno a mente.
 */

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn(
    "\n⚠ Postgres non raggiungibile: i test degli override sono saltati.\n",
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

/** Lo stato del motore riletto da database, per interrogare crediti e rose. */
async function stateOf(auctionId: string): Promise<AuctionState> {
  const loaded = await loadForSnapshot(auctionId);
  if (!loaded) throw new Error("asta sparita");
  return loaded.state;
}

async function versionOf(auctionId: string): Promise<number> {
  const row = await db.query.auctions.findFirst({
    where: eq(auctions.id, auctionId),
  });
  if (!row) throw new Error("asta sparita");
  return row.stateVersion;
}

async function eventTypes(auctionId: string): Promise<string[]> {
  const rows = await db
    .select({ type: events.type })
    .from(events)
    .where(eq(events.auctionId, auctionId))
    .orderBy(asc(events.id));
  return rows.map((r) => r.type);
}

async function assignmentRows(auctionId: string) {
  return db
    .select()
    .from(assignments)
    .where(eq(assignments.auctionId, auctionId))
    .orderBy(asc(assignments.createdAt), asc(assignments.id));
}

/** LIVE, lotto P aperto dal seat 0 e nessuno ha ancora offerto: LOT_OPEN. */
async function withOpenLot(
  now: number,
): Promise<GameAuction & { state: AuctionState; goalkeeperId: string }> {
  const game = await gameAuction();
  unwrap(await startAuction(game.ownerId, game.auctionId, 0, now));
  const started = unwrap(await advancePhase(game.auctionId, now));
  const goalkeeper = started.state.players.find((p) => p.role === "P")!;
  const picked = unwrap(
    await pickPlayer(game.userIds[0], game.auctionId, goalkeeper.id, now + 500),
  );
  return { ...game, state: picked.state, goalkeeperId: goalkeeper.id };
}

/**
 * Il lotto è stato assegnato al seat 1 per 10 crediti e siamo in LOT_REVEAL,
 * cioè nel momento in cui l'errore si vede sullo schermo e il manager lo
 * corregge. Restituisce anche l'assegnazione appena nata.
 */
async function withResolvedLot(now: number): Promise<
  GameAuction & { goalkeeperId: string; assignmentId: string }
> {
  const game = await withOpenLot(now);
  unwrap(await placeBid(game.userIds[1], game.auctionId, 10, now + 1000));
  const closed = unwrap(await advancePhase(game.auctionId, now + 500 + 3000));
  expect(closed.state.phase).toBe("LOT_REVEAL");

  const rows = await assignmentRows(game.auctionId);
  expect(rows).toHaveLength(1);
  return { ...game, assignmentId: rows[0].id };
}

/** Due offerte pari sul lotto aperto → dopo l'advance siamo in LOT_TIE_PREP. */
async function withTiePrep(now: number): Promise<GameAuction> {
  const game = await withOpenLot(now);
  unwrap(await placeBid(game.userIds[1], game.auctionId, 20, now + 1000));
  unwrap(await placeBid(game.userIds[2], game.auctionId, 20, now + 1100));
  const tie = unwrap(await advancePhase(game.auctionId, now + 500 + 3000));
  expect(tie.state.phase).toBe("LOT_TIE_PREP");
  return game;
}

// ─────────────────────────────────────────────────────────────────────────────

describe.runIf(dbUp)("F7-01 — manualAssign", () => {
  beforeEach(() => {
    vi.useRealTimers(); // pg fa I/O vero
    setBroadcastHook(() => {});
  });

  it("scrive un'assegnazione MANUAL senza lotto, e i crediti scendono", async () => {
    const now = Date.now();
    const game = await gameAuction();
    const state = await stateOf(game.auctionId);
    const striker = state.players.find((p) => p.role === "A")!;

    const { assignmentId } = unwrap(
      await manualAssign(
        game.ownerId,
        game.auctionId,
        { memberId: game.memberIds[3], playerId: striker.id, price: 25 },
        now,
      ),
    );

    const rows = await assignmentRows(game.auctionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: assignmentId,
      memberId: game.memberIds[3],
      playerId: striker.id,
      price: 25,
      source: "MANUAL",
      lotId: null,
      voidedAt: null,
    });

    const after = await stateOf(game.auctionId);
    expect(credits(after, game.memberIds[3])).toBe(75);
    expect(ownedByRole(after, game.memberIds[3]).A).toBe(1);
    expect(await eventTypes(game.auctionId)).toContain("MANUAL_ASSIGN");
  });

  it("§12.35 — con un lotto in contesa è rifiutata (LOT_OPEN, anche in pausa)", async () => {
    const now = Date.now();
    const game = await withOpenLot(now);
    const state = await stateOf(game.auctionId);
    const striker = state.players.find((p) => p.role === "A")!;
    const versionBefore = await versionOf(game.auctionId);

    const inCorso = await manualAssign(
      game.ownerId,
      game.auctionId,
      { memberId: game.memberIds[3], playerId: striker.id, price: 5 },
      now + 1000,
    );
    expect(inCorso).toMatchObject({ ok: false, error: { code: "WRONG_PHASE" } });

    // ⚠ P1 — la pausa congela la fase, non la azzera: il rifiuto resta.
    unwrap(await pauseAuction(game.ownerId, game.auctionId, now + 1200));
    const inPausa = await manualAssign(
      game.ownerId,
      game.auctionId,
      { memberId: game.memberIds[3], playerId: striker.id, price: 5 },
      now + 1300,
    );
    expect(inPausa).toMatchObject({ ok: false, error: { code: "WRONG_PHASE" } });

    // Niente scritto, e nessun bump oltre a quello della pausa.
    expect(await assignmentRows(game.auctionId)).toHaveLength(0);
    expect(await versionOf(game.auctionId)).toBe(versionBefore + 1);
  });

  it("§12.35 — rifiutata anche in LOT_TIE_PREP", async () => {
    const now = Date.now();
    const game = await withTiePrep(now);
    const state = await stateOf(game.auctionId);
    const striker = state.players.find((p) => p.role === "A")!;

    const result = await manualAssign(
      game.ownerId,
      game.auctionId,
      { memberId: game.memberIds[3], playerId: striker.id, price: 5 },
      now + 5000,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "WRONG_PHASE" } });
  });

  it("§12.40 — giocatore già assegnato: rifiutata, e `force` non deroga a I2", async () => {
    const now = Date.now();
    const game = await withResolvedLot(now);
    const rows = await assignmentRows(game.auctionId);
    const playerId = rows[0].playerId;

    for (const force of [false, true]) {
      const result = await manualAssign(
        game.ownerId,
        game.auctionId,
        { memberId: game.memberIds[5], playerId, price: 3, force },
        now + 6000,
      );
      expect(result).toMatchObject({
        ok: false,
        error: { code: "PLAYER_ASSIGNED" },
      });
    }
    // Il giocatore ha ancora un solo proprietario (I2).
    expect(await assignmentRows(game.auctionId)).toHaveLength(1);
  });

  it("ruolo pieno: rifiutata senza force (I4), accettata con force", async () => {
    const now = Date.now();
    const game = await gameAuction();
    const state = await stateOf(game.auctionId);
    const [p1, p2] = state.players.filter((p) => p.role === "P");

    unwrap(
      await manualAssign(
        game.ownerId,
        game.auctionId,
        { memberId: game.memberIds[2], playerId: p1.id, price: 5 },
        now,
      ),
    );

    const senza = await manualAssign(
      game.ownerId,
      game.auctionId,
      { memberId: game.memberIds[2], playerId: p2.id, price: 5 },
      now + 10,
    );
    expect(senza).toMatchObject({
      ok: false,
      error: { code: "ASSIGN_VIOLATES_I4" },
    });

    unwrap(
      await manualAssign(
        game.ownerId,
        game.auctionId,
        { memberId: game.memberIds[2], playerId: p2.id, price: 5, force: true },
        now + 20,
      ),
    );
    const after = await stateOf(game.auctionId);
    expect(ownedByRole(after, game.memberIds[2]).P).toBe(2);
    // ⚠ P2 — con un ruolo in overflow `max_bid` non deve gonfiarsi: restano
    // 3 slot residui (D, C, A) e 90 crediti → 90 − 2 = 88.
    expect(credits(after, game.memberIds[2])).toBe(90);
  });

  it("I3 non è derogabile nemmeno con force", async () => {
    const now = Date.now();
    const game = await gameAuction();
    const state = await stateOf(game.auctionId);
    const keeper = state.players.find((p) => p.role === "P")!;

    // 100 crediti, 4 slot: comprando il P restano 3 slot → prezzo max 97.
    for (const force of [false, true]) {
      const result = await manualAssign(
        game.ownerId,
        game.auctionId,
        { memberId: game.memberIds[1], playerId: keeper.id, price: 98, force },
        now,
      );
      expect(result).toMatchObject({
        ok: false,
        error: { code: "ADJUST_VIOLATES_I3" },
      });
    }
    unwrap(
      await manualAssign(
        game.ownerId,
        game.auctionId,
        { memberId: game.memberIds[1], playerId: keeper.id, price: 97 },
        now,
      ),
    );
  });

  it("solo l'owner, e mai con id inventati", async () => {
    const now = Date.now();
    const game = await gameAuction();
    const state = await stateOf(game.auctionId);
    const keeper = state.players.find((p) => p.role === "P")!;

    const intruso = await manualAssign(
      game.userIds[4],
      game.auctionId,
      { memberId: game.memberIds[4], playerId: keeper.id, price: 5 },
      now,
    );
    expect(intruso).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });

    const idFinto = await manualAssign(
      game.ownerId,
      game.auctionId,
      { memberId: "undefined", playerId: keeper.id, price: 5 },
      now,
    );
    expect(idFinto).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });

    expect(await assignmentRows(game.auctionId)).toHaveLength(0);
  });
});

describe.runIf(dbUp)("F7-02 — voidAssignment", () => {
  beforeEach(() => {
    vi.useRealTimers();
    setBroadcastHook(() => {});
  });

  it("§12.36 — il giocatore torna disponibile, i crediti risalgono, la riga resta con voided_at", async () => {
    const now = Date.now();
    const game = await withResolvedLot(now);
    const winner = game.memberIds[1];

    const before = await stateOf(game.auctionId);
    expect(credits(before, winner)).toBe(90); // 100 − 10
    expect(ownedByRole(before, winner).P).toBe(1);
    const rows = await assignmentRows(game.auctionId);
    const playerId = rows[0].playerId;

    const voidedAt = now + 9000;
    expect(
      unwrap(
        await voidAssignment(
          game.ownerId,
          game.auctionId,
          game.assignmentId,
          voidedAt,
        ),
      ),
    ).toEqual({ voided: true });

    // La riga **resta**: regola 5, mai un DELETE.
    const after = await assignmentRows(game.auctionId);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(game.assignmentId);
    expect(after[0].price).toBe(10);
    expect(after[0].voidedAt?.getTime()).toBe(voidedAt);

    // I crediti risalgono e lo slot si riapre, senza nessuna riga di ledger:
    // il credito è una formula, non una colonna da rimettere a posto.
    const state = await stateOf(game.auctionId);
    expect(credits(state, winner)).toBe(100);
    expect(ownedByRole(state, winner).P).toBe(0);
    expect(
      await db.select().from(ledger).where(eq(ledger.auctionId, game.auctionId)),
    ).toHaveLength(0);

    // E il giocatore è di nuovo assegnabile: nessun proprietario vivo (I2).
    const vivi = await db
      .select()
      .from(assignments)
      .where(
        and(
          eq(assignments.auctionId, game.auctionId),
          eq(assignments.playerId, playerId),
        ),
      );
    expect(vivi.filter((a) => a.voidedAt === null)).toHaveLength(0);
    expect(await eventTypes(game.auctionId)).toContain("VOID_ASSIGNMENT");
  });

  it("§12.38 — con un lotto in contesa è rifiutata (LOT_OPEN e LOT_TIE_PREP)", async () => {
    const now = Date.now();
    const game = await withResolvedLot(now);

    // Il reveal finisce, si riparte: seat successivo, chiamata, buste aperte.
    const waiting = unwrap(await advancePhase(game.auctionId, now + 4500));
    expect(waiting.state.phase).toBe("WAITING_PICK");
    const seat = waiting.state.currentSeatIndex!;
    const keeper = waiting.state.players.find(
      (p) =>
        p.role === "P" &&
        !waiting.state.assignments.some(
          (a) => a.playerId === p.id && a.voidedAt === null,
        ),
    )!;
    unwrap(
      await pickPlayer(game.userIds[seat], game.auctionId, keeper.id, now + 5000),
    );

    const inContesa = await voidAssignment(
      game.ownerId,
      game.auctionId,
      game.assignmentId,
      now + 5100,
    );
    expect(inContesa).toMatchObject({
      ok: false,
      error: { code: "WRONG_PHASE" },
    });

    // Anche in pausa: la fase resta LOT_OPEN.
    unwrap(await pauseAuction(game.ownerId, game.auctionId, now + 5200));
    expect(
      await voidAssignment(
        game.ownerId,
        game.auctionId,
        game.assignmentId,
        now + 5300,
      ),
    ).toMatchObject({ ok: false, error: { code: "WRONG_PHASE" } });

    // L'assegnazione del primo lotto è ancora viva.
    const rows = await assignmentRows(game.auctionId);
    expect(rows.find((r) => r.id === game.assignmentId)!.voidedAt).toBeNull();
  });

  it("ripetuta è un no-op: nessun bump, nessun secondo evento", async () => {
    const now = Date.now();
    const game = await withResolvedLot(now);
    unwrap(
      await voidAssignment(
        game.ownerId,
        game.auctionId,
        game.assignmentId,
        now + 9000,
      ),
    );
    const version = await versionOf(game.auctionId);
    const eventi = await eventTypes(game.auctionId);

    const again = unwrap(
      await voidAssignment(
        game.ownerId,
        game.auctionId,
        game.assignmentId,
        now + 9500,
      ),
    );
    expect(again).toEqual({ voided: false });
    expect(await versionOf(game.auctionId)).toBe(version);
    expect(await eventTypes(game.auctionId)).toEqual(eventi);
  });

  it("un'assegnazione di un'altra asta o inesistente → ASSIGNMENT_NOT_FOUND", async () => {
    const now = Date.now();
    const mia = await withResolvedLot(now);
    const altra = await withResolvedLot(now);

    expect(
      await voidAssignment(mia.ownerId, mia.auctionId, altra.assignmentId, now),
    ).toMatchObject({ ok: false, error: { code: "ASSIGNMENT_NOT_FOUND" } });

    expect(
      await voidAssignment(mia.ownerId, mia.auctionId, "undefined", now),
    ).toMatchObject({ ok: false, error: { code: "ASSIGNMENT_NOT_FOUND" } });
  });

  it("solo l'owner", async () => {
    const now = Date.now();
    const game = await withResolvedLot(now);
    expect(
      await voidAssignment(
        game.userIds[1],
        game.auctionId,
        game.assignmentId,
        now,
      ),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});

describe.runIf(dbUp)("F7-03 — adjustBudget", () => {
  beforeEach(() => {
    vi.useRealTimers();
    setBroadcastHook(() => {});
  });

  it("scrive una riga di ledger con motivo e autore, e i crediti cambiano", async () => {
    const now = Date.now();
    const game = await gameAuction();

    const out = unwrap(
      await adjustBudget(
        game.ownerId,
        game.auctionId,
        game.memberIds[2],
        -12,
        "Penalità per ritardo",
        now,
      ),
    );
    expect(out.credits).toBe(88);

    const rows = await db
      .select()
      .from(ledger)
      .where(eq(ledger.auctionId, game.auctionId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      memberId: game.memberIds[2],
      delta: -12,
      reason: "Penalità per ritardo",
      actorUserId: game.ownerId,
    });

    const state = await stateOf(game.auctionId);
    expect(credits(state, game.memberIds[2])).toBe(88);
    expect(await eventTypes(game.auctionId)).toContain("ADJUST_BUDGET");
  });

  it("§12.39/§12.20 — il delta che porta i crediti sotto gli slot residui è rifiutato (I3)", async () => {
    const now = Date.now();
    const game = await gameAuction();
    // 100 crediti, 4 slot residui: −97 lascia 3 (ok), −98 lascia 2 (no).
    const troppo = await adjustBudget(
      game.ownerId,
      game.auctionId,
      game.memberIds[0],
      -97,
      "Troppo",
      now,
    );
    expect(troppo).toMatchObject({
      ok: false,
      error: { code: "ADJUST_VIOLATES_I3" },
    });
    expect(
      await db.select().from(ledger).where(eq(ledger.auctionId, game.auctionId)),
    ).toHaveLength(0);

    unwrap(
      await adjustBudget(
        game.ownerId,
        game.auctionId,
        game.memberIds[0],
        -96,
        "Il massimo ammesso",
        now,
      ),
    );
    const state = await stateOf(game.auctionId);
    expect(credits(state, game.memberIds[0])).toBe(4);
  });

  it("una rettifica in più tiene conto di quelle già scritte", async () => {
    const now = Date.now();
    const game = await gameAuction();
    unwrap(
      await adjustBudget(
        game.ownerId,
        game.auctionId,
        game.memberIds[0],
        -50,
        "Prima",
        now,
      ),
    );
    // Restano 50 crediti e 4 slot: −47 è il massimo.
    expect(
      await adjustBudget(
        game.ownerId,
        game.auctionId,
        game.memberIds[0],
        -47,
        "Seconda",
        now + 10,
      ),
    ).toMatchObject({ ok: false, error: { code: "ADJUST_VIOLATES_I3" } });
    unwrap(
      await adjustBudget(
        game.ownerId,
        game.auctionId,
        game.memberIds[0],
        -46,
        "Seconda",
        now + 10,
      ),
    );
    expect(credits(await stateOf(game.auctionId), game.memberIds[0])).toBe(4);
  });

  it("rifiuta delta nullo, non intero e motivo vuoto", async () => {
    const now = Date.now();
    const game = await gameAuction();
    const m = game.memberIds[0];

    for (const delta of [0, 1.5]) {
      expect(
        await adjustBudget(game.ownerId, game.auctionId, m, delta, "x", now),
      ).toMatchObject({ ok: false, error: { code: "INVALID_AMOUNT" } });
    }
    expect(
      await adjustBudget(game.ownerId, game.auctionId, m, 10, "   ", now),
    ).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(
      await db.select().from(ledger).where(eq(ledger.auctionId, game.auctionId)),
    ).toHaveLength(0);
  });

  it("con un lotto in contesa è rifiutata, e solo l'owner la può fare", async () => {
    const now = Date.now();
    const game = await withOpenLot(now);
    expect(
      await adjustBudget(
        game.ownerId,
        game.auctionId,
        game.memberIds[3],
        +10,
        "Regalo",
        now + 1000,
      ),
    ).toMatchObject({ ok: false, error: { code: "WRONG_PHASE" } });

    const altro = await makeUser("non-owner");
    createdUsers.push(altro);
    expect(
      await adjustBudget(
        altro,
        game.auctionId,
        game.memberIds[3],
        +10,
        "Regalo",
        now + 1000,
      ),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("un membro di un'altra asta → MEMBER_NOT_FOUND", async () => {
    const now = Date.now();
    const mia = await gameAuction();
    const altra = await gameAuction();
    expect(
      await adjustBudget(
        mia.ownerId,
        mia.auctionId,
        altra.memberIds[0],
        +5,
        "x",
        now,
      ),
    ).toMatchObject({ ok: false, error: { code: "MEMBER_NOT_FOUND" } });
  });
});

describe.runIf(dbUp)("F7-04 — la correzione senza undo (§12.37)", () => {
  beforeEach(() => {
    vi.useRealTimers();
    setBroadcastHook(() => {});
  });

  it("void + manualAssign: rose e crediti coerenti, nessun doppio assegnamento", async () => {
    const now = Date.now();
    // Il lotto è stato aggiudicato al seat 1 per 10, ma era sbagliato:
    // andava al seat 4 per 30. Non esiste un undo — si annulla e si riassegna.
    const game = await withResolvedLot(now);
    const sbagliato = game.memberIds[1];
    const giusto = game.memberIds[4];
    const rows = await assignmentRows(game.auctionId);
    const playerId = rows[0].playerId;

    unwrap(
      await voidAssignment(
        game.ownerId,
        game.auctionId,
        game.assignmentId,
        now + 9000,
      ),
    );
    const nuovo = unwrap(
      await manualAssign(
        game.ownerId,
        game.auctionId,
        { memberId: giusto, playerId, price: 30 },
        now + 9100,
      ),
    );

    const state = await stateOf(game.auctionId);

    // I crediti tornano coerenti da soli, senza nessuna riga compensativa.
    expect(credits(state, sbagliato)).toBe(100);
    expect(credits(state, giusto)).toBe(70);
    expect(ownedByRole(state, sbagliato).P).toBe(0);
    expect(ownedByRole(state, giusto).P).toBe(1);

    // I2 — il giocatore ha **un solo** proprietario vivo, e la riga annullata
    // resta a database con il suo prezzo e il suo `voided_at`.
    const dopo = await assignmentRows(game.auctionId);
    expect(dopo).toHaveLength(2);
    const vive = dopo.filter((a) => a.voidedAt === null);
    expect(vive).toHaveLength(1);
    expect(vive[0]).toMatchObject({
      id: nuovo.assignmentId,
      memberId: giusto,
      price: 30,
      source: "MANUAL",
      lotId: null,
    });
    const annullata = dopo.find((a) => a.voidedAt !== null)!;
    expect(annullata).toMatchObject({ memberId: sbagliato, price: 10, source: "AUCTION" });
    expect(annullata.lotId).not.toBeNull();

    // ⚠ P1 — il lotto resta com'era: la rotazione non torna indietro, e la
    // storia dice che quel lotto lo aveva vinto l'altro.
    const events = await eventTypes(game.auctionId);
    expect(events.filter((t) => t === "VOID_ASSIGNMENT")).toHaveLength(1);
    expect(events.filter((t) => t === "MANUAL_ASSIGN")).toHaveLength(1);
  });

  /**
   * Il caso che ha fatto aggiungere una guardia al motore in Fase 7 (vedi
   * DECISIONS 2026-08-08). Prima: il seat di turno riceveva a mano il suo
   * unico portiere, chiamava lo stesso un altro portiere — il pick non
   * controllava nulla — e siccome la sua auto-offerta a 1 restava nel round
   * mentre lui era fuori dall'eligibility, se ne portava a casa **due** su
   * uno slot. I4 rotta senza nessun `force`.
   */
  it("un override sul membro di turno non gli fa vincere un giocatore fuori slot (I4)", async () => {
    const now = Date.now();
    const game = await gameAuction();
    unwrap(await startAuction(game.ownerId, game.auctionId, 0, now));
    const state = await stateOf(game.auctionId);
    const keepers = state.players.filter((p) => p.role === "P");

    // Il seat 0 è di turno sui portieri e il manager gliene assegna uno.
    unwrap(
      await manualAssign(
        game.ownerId,
        game.auctionId,
        { memberId: game.memberIds[0], playerId: keepers[0].id, price: 5 },
        now + 100,
      ),
    );

    // Adesso non può più chiamare un portiere.
    const rifiutato = await pickPlayer(
      game.userIds[0],
      game.auctionId,
      keepers[1].id,
      now + 200,
    );
    expect(rifiutato).toMatchObject({
      ok: false,
      error: { code: "NOT_ELIGIBLE" },
    });

    // E allo scadere del pick timer il turno passa, senza aprire un lotto.
    const dopo = unwrap(await advancePhase(game.auctionId, now + 3000));
    expect(dopo.state.phase).toBe("WAITING_PICK");
    expect(dopo.state.currentSeatIndex).toBe(1);
    expect(dopo.state.lots).toHaveLength(0);

    const finale = await stateOf(game.auctionId);
    expect(ownedByRole(finale, game.memberIds[0]).P).toBe(1);
  });

  it("il giocatore annullato si può riassegnare anche allo stesso membro", async () => {
    const now = Date.now();
    const game = await withResolvedLot(now);
    const stesso = game.memberIds[1];
    const rows = await assignmentRows(game.auctionId);

    unwrap(
      await voidAssignment(
        game.ownerId,
        game.auctionId,
        game.assignmentId,
        now + 9000,
      ),
    );
    // Il prezzo era sbagliato: 10 invece di 42.
    unwrap(
      await manualAssign(
        game.ownerId,
        game.auctionId,
        { memberId: stesso, playerId: rows[0].playerId, price: 42 },
        now + 9100,
      ),
    );

    const state = await stateOf(game.auctionId);
    expect(credits(state, stesso)).toBe(58);
    expect(ownedByRole(state, stesso).P).toBe(1);
  });

  it("ogni override fa scattare uno snapshot: un void arriva sui telefoni come un'offerta", async () => {
    const now = Date.now();
    const game = await withResolvedLot(now);
    const broadcasts: string[] = [];
    setBroadcastHook((id) => broadcasts.push(id));

    const versionBefore = await versionOf(game.auctionId);
    unwrap(
      await voidAssignment(
        game.ownerId,
        game.auctionId,
        game.assignmentId,
        now + 9000,
      ),
    );
    expect(broadcasts).toEqual([game.auctionId]);
    expect(await versionOf(game.auctionId)).toBe(versionBefore + 1);
  });
});
