import { describe, expect, it } from "vitest";

import { transition } from "@/lib/engine/machine";
import type { AuctionEvent, AuctionState, Millis } from "@/lib/engine/types";

import { T0, assignment, makeState, player, sec } from "./helpers";

/**
 * La macchina a stati (F2-09 …): `transition(state, event, now)` è l'unico
 * modo in cui un'asta cambia. Qui si prova il regolamento di PLAN §0 caso per
 * caso — i numeri §12.n sono i test obbligatori del piano.
 *
 * Convenzione dei fixture: 4 membri (m0…m3, seat = indice), 1 slot per ruolo,
 * ruolo corrente P, di turno m0. I giocatori P si chiamano q0…q3 con fvm
 * decrescente (q0 il migliore).
 */

function stateInWaitingPick(
  overrides: Parameters<typeof makeState>[0] = {},
): AuctionState {
  return makeState({
    players: [
      player("q0", "P", { fvm: 90, extId: 100 }),
      player("q1", "P", { fvm: 80, extId: 101 }),
      player("q2", "P", { fvm: 70, extId: 102 }),
      player("q3", "P", { fvm: 60, extId: 103 }),
      player("d0", "D", { fvm: 50, extId: 200 }),
      player("fl", "P", { fvm: 99, extId: 300, outOfList: true }),
    ],
    ...overrides,
  });
}

/** Applica una sequenza di (evento, istante) pretendendo che ogni passo passi. */
function run(
  state: AuctionState,
  steps: Array<[AuctionEvent, Millis]>,
): AuctionState {
  let current = state;
  for (const [event, now] of steps) {
    const result = transition(current, event, now);
    if (!result.ok) {
      throw new Error(
        `transition ${event.type} fallita: ${result.error.code} — ${result.error.message}`,
      );
    }
    current = result.value;
  }
  return current;
}

function pick(memberId: string, playerId: string): AuctionEvent {
  return { type: "PICK", memberId, playerId };
}
function bidEvent(memberId: string, amount: number): AuctionEvent {
  return { type: "PLACE_BID", memberId, amount };
}

function expectFail(
  state: AuctionState,
  event: AuctionEvent,
  now: Millis,
  code: string,
) {
  const result = transition(state, event, now);
  expect(result.ok, `${event.type} doveva fallire con ${code}`).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}

describe("machine: PICK — F2-09", () => {
  it("un pick valido apre il lotto: round 1, eligibility, auto-bid a 1 del chiamante", () => {
    const state = stateInWaitingPick();
    const next = run(state, [[pick("m0", "q1"), T0 + sec(5)]]);

    expect(next.phase).toBe("LOT_OPEN");
    expect(next.lots).toHaveLength(1);
    const lot = next.lots[0];
    expect(lot.seq).toBe(1);
    expect(lot.playerId).toBe("q1");
    expect(lot.calledByMemberId).toBe("m0");
    expect(lot.autoCalled).toBe(false);
    expect(lot.status).toBe("OPEN");
    expect(lot.currentRound).toBe(1);
    expect(next.currentLotId).toBe(lot.id);

    expect(lot.rounds).toHaveLength(1);
    const round = lot.rounds[0];
    expect(round.roundNo).toBe(1);
    expect(round.minAmount).toBe(1);
    expect(round.endsAt).toBe(T0 + sec(5) + sec(30));
    expect(next.phaseDeadline).toBe(round.endsAt);
    // Tutti hanno slot libero e crediti: tutti idonei.
    expect(round.eligibleMemberIds).toEqual(["m0", "m1", "m2", "m3"]);
    // L'auto-bid del chiamante: vincolato a 1, con il timestamp del pick.
    expect(round.bids).toHaveLength(1);
    expect(round.bids[0]).toMatchObject({
      memberId: "m0",
      amount: 1,
      amountSetAt: T0 + sec(5),
      withdrawnAt: null,
    });

    // Lo stato di partenza non è stato mutato.
    expect(state.lots).toHaveLength(0);
    expect(state.phase).toBe("WAITING_PICK");
  });

  it("l'eligibility del lotto esclude chi ha il ruolo pieno (§12.19)", () => {
    const state = stateInWaitingPick({
      players: [
        player("q0", "P", { fvm: 90 }),
        player("q1", "P", { fvm: 80 }),
        player("owned", "P", { fvm: 10 }),
      ],
      assignments: [assignment(90, "m2", "owned", 5)],
      nextId: 91,
    });
    const next = run(state, [[pick("m0", "q0"), T0]]);
    expect(next.lots[0].rounds[0].eligibleMemberIds).toEqual([
      "m0",
      "m1",
      "m3",
    ]);
  });

  it("rifiuta il pick di chi non è di turno", () => {
    expectFail(stateInWaitingPick(), pick("m1", "q1"), T0, "NOT_YOUR_TURN");
  });

  /**
   * Il buco che la Fase 7 rende raggiungibile: nella rotazione normale chi è
   * di turno ha sempre uno slot libero (ci pensa `nextSeat`), ma una
   * `manualAssign` può riempirgli il ruolo mentre sta aspettando di chiamare.
   * Senza la guardia il lotto si apriva con il chiamante fuori
   * dall'eligibility e la sua auto-offerta a 1 dentro il round: non
   * rilanciava nessuno e si ritrovava due portieri su uno slot — I4 rotta
   * senza che nessuno avesse forzato niente.
   */
  it("rifiuta il pick di chi ha già il ruolo pieno (F7, §12.19)", () => {
    const state = stateInWaitingPick({
      assignments: [assignment(90, "m0", "q3", 5)],
      nextId: 91,
    });
    expectFail(state, pick("m0", "q1"), T0, "NOT_ELIGIBLE");
  });

  it("rifiuta il ruolo sbagliato", () => {
    expectFail(stateInWaitingPick(), pick("m0", "d0"), T0, "WRONG_ROLE");
  });

  it("rifiuta un giocatore già assegnato (ma non se l'assegnazione è annullata)", () => {
    const base = stateInWaitingPick();
    const taken = {
      ...base,
      assignments: [assignment(90, "m3", "q1", 5)],
      nextId: 91,
    };
    expectFail(taken, pick("m0", "q1"), T0, "PLAYER_ASSIGNED");

    const voided = {
      ...base,
      assignments: [assignment(90, "m3", "q1", 5, { voidedAt: T0 - 1 })],
      nextId: 91,
    };
    expect(transition(voided, pick("m0", "q1"), T0).ok).toBe(true);
  });

  it("rifiuta un fuori lista, a meno che il toggle non lo includa (⚠ P7)", () => {
    expectFail(stateInWaitingPick(), pick("m0", "fl"), T0, "PLAYER_OUT_OF_LIST");
    const withToggle = stateInWaitingPick({
      config: { includeOutOfList: true },
    });
    expect(transition(withToggle, pick("m0", "fl"), T0).ok).toBe(true);
  });

  it("rifiuta un giocatore inesistente e le fasi sbagliate", () => {
    expectFail(stateInWaitingPick(), pick("m0", "boh"), T0, "PLAYER_NOT_FOUND");

    const inLot = run(stateInWaitingPick(), [[pick("m0", "q0"), T0]]);
    expectFail(inLot, pick("m0", "q1"), T0 + sec(1), "WRONG_PHASE");

    const ready = makeState({ status: "READY", phase: null });
    expectFail(ready, pick("m0", "q0"), T0, "WRONG_STATUS");
  });
});

describe("machine: timeout del pick → auto-pick — F2-10", () => {
  it("§12.3 — alla scadenza chiama il miglior fvm del ruolo, auto_called, auto-bid a 1", () => {
    const state = stateInWaitingPick();
    const deadline = state.phaseDeadline!;
    const next = run(state, [[{ type: "ADVANCE" }, deadline]]);

    expect(next.phase).toBe("LOT_OPEN");
    const lot = next.lots[0];
    // Il fuori lista ha fvm 99 ma è escluso: vince q0 (fvm 90).
    expect(lot.playerId).toBe("q0");
    expect(lot.autoCalled).toBe(true);
    expect(lot.calledByMemberId).toBe("m0");
    expect(lot.rounds[0].bids[0]).toMatchObject({ memberId: "m0", amount: 1 });
  });

  it("prima della scadenza è un no-op (I7)", () => {
    const state = stateInWaitingPick();
    const result = transition(state, { type: "ADVANCE" }, T0 + sec(10));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(state);
  });

  it("se un override ha riempito il ruolo di chi è di turno, il turno passa (F7)", () => {
    const state = stateInWaitingPick({
      assignments: [assignment(90, "m0", "q3", 5)],
      nextId: 91,
    });
    const next = run(state, [[{ type: "ADVANCE" }, state.phaseDeadline!]]);

    // Nessun lotto aperto a nome di chi non poteva vincerlo: solo il turno
    // che avanza al primo seat con uno slot libero nel ruolo.
    expect(next.lots).toHaveLength(0);
    expect(next.phase).toBe("WAITING_PICK");
    expect(next.currentSeatIndex).toBe(1);
    expect(next.currentRole).toBe("P");
  });

  it("se il ruolo si è riempito per tutti, si passa al ruolo successivo (F7, ⚠ P9)", () => {
    const state = stateInWaitingPick({
      assignments: [
        assignment(90, "m0", "q0", 5),
        assignment(91, "m1", "q1", 5),
        assignment(92, "m2", "q2", 5),
        assignment(93, "m3", "q3", 5),
      ],
      nextId: 94,
    });
    const next = run(state, [[{ type: "ADVANCE" }, state.phaseDeadline!]]);

    expect(next.lots).toHaveLength(0);
    expect(next.phase).toBe("WAITING_PICK");
    expect(next.currentRole).toBe("D");
  });
});

describe("machine: placeBid — F2-11 (⚠ P3)", () => {
  const opened = run(stateInWaitingPick(), [[pick("m0", "q0"), T0]]);
  const myBid = (s: AuctionState, memberId: string) =>
    s.lots[0].rounds[0].bids.find((b) => b.memberId === memberId);

  it("§12.5 — offro 30 poi 50: vale 50 con amount_set_at del secondo submit", () => {
    const next = run(opened, [
      [bidEvent("m1", 30), T0 + sec(5)],
      [bidEvent("m1", 50), T0 + sec(20)],
    ]);
    const b = myBid(next, "m1");
    expect(b).toMatchObject({ amount: 50, amountSetAt: T0 + sec(20) });
    // L'override è un UPDATE, non una nuova riga (PLAN §3).
    expect(next.lots[0].rounds[0].bids).toHaveLength(2);
  });

  it("ri-submit della stessa cifra: no-op, il timestamp resta (⚠ P3)", () => {
    const first = run(opened, [[bidEvent("m1", 30), T0 + sec(5)]]);
    const result = transition(first, bidEvent("m1", 30), T0 + sec(20));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(first); // stesso riferimento: nessuna mutazione
      expect(myBid(result.value, "m1")!.amountSetAt).toBe(T0 + sec(5));
    }
  });

  it("§12.18 — offerta oltre max_bid rifiutata lato server", () => {
    // 500 crediti, 4 slot, 0 posseduti → max_bid = 497.
    expectFail(opened, bidEvent("m1", 498), T0 + sec(5), "BID_TOO_HIGH");
    expect(transition(opened, bidEvent("m1", 497), T0 + sec(5)).ok).toBe(true);
  });

  it("rifiuta sotto il minimo del round e importi non interi", () => {
    expectFail(opened, bidEvent("m1", 0), T0 + sec(5), "BID_TOO_LOW");
    expectFail(opened, bidEvent("m1", 10.5), T0 + sec(5), "INVALID_AMOUNT");
  });

  it("§12.30 — offerta 200ms dopo ends_at rifiutata", () => {
    const endsAt = opened.lots[0].rounds[0].endsAt;
    expectFail(opened, bidEvent("m1", 10), endsAt + 200, "ROUND_CLOSED");
    // Sul filo invece passa: la chiusura è di chi fa scattare ADVANCE.
    expect(transition(opened, bidEvent("m1", 10), endsAt).ok).toBe(true);
  });

  it("rifiuta chi non è idoneo al round", () => {
    const state = stateInWaitingPick({
      players: [
        player("q0", "P", { fvm: 90 }),
        player("owned", "P", { fvm: 10 }),
      ],
      assignments: [assignment(90, "m2", "owned", 5)],
      nextId: 91,
    });
    const inLot = run(state, [[pick("m0", "q0"), T0]]);
    expectFail(inLot, bidEvent("m2", 10), T0 + sec(5), "NOT_ELIGIBLE");
  });

  it("il chiamante può rilanciare sopra il proprio auto-bid", () => {
    const next = run(opened, [[bidEvent("m0", 25), T0 + sec(9)]]);
    expect(myBid(next, "m0")).toMatchObject({
      amount: 25,
      amountSetAt: T0 + sec(9),
    });
  });
});

describe("machine: withdrawBid — F2-12 (⚠ P10)", () => {
  const opened = run(stateInWaitingPick(), [
    [pick("m0", "q0"), T0],
    [bidEvent("m1", 30), T0 + sec(5)],
  ]);

  it("§12.7 — il ritiro esclude dalla risoluzione, la riga resta con withdrawn_at", () => {
    const next = run(opened, [[{ type: "WITHDRAW_BID", memberId: "m1" }, T0 + sec(10)]]);
    const b = next.lots[0].rounds[0].bids.find((b) => b.memberId === "m1");
    expect(b).toMatchObject({ amount: 30, withdrawnAt: T0 + sec(10) });
  });

  it("§12.8 — il chiamante non può ritirare", () => {
    expectFail(
      opened,
      { type: "WITHDRAW_BID", memberId: "m0" },
      T0 + sec(10),
      "WITHDRAW_FORBIDDEN",
    );
  });

  it("senza un'offerta non c'è niente da ritirare", () => {
    expectFail(
      opened,
      { type: "WITHDRAW_BID", memberId: "m2" },
      T0 + sec(10),
      "WITHDRAW_FORBIDDEN",
    );
  });

  it("a round chiuso non si ritira più: l'esito è quello delle buste a DB", () => {
    const endsAt = opened.lots[0].rounds[0].endsAt;
    expectFail(
      opened,
      { type: "WITHDRAW_BID", memberId: "m1" },
      endsAt + 200,
      "ROUND_CLOSED",
    );
  });

  it("il ritiro è irreversibile: un placeBid successivo è rifiutato", () => {
    const withdrawn = run(opened, [
      [{ type: "WITHDRAW_BID", memberId: "m1" }, T0 + sec(10)],
    ]);
    expectFail(withdrawn, bidEvent("m1", 40), T0 + sec(12), "BID_WITHDRAWN");
  });
});

describe("machine: chiusura del round 1 — F2-13", () => {
  // Lotto aperto a T0 su q0, chiamato da m0 (auto-bid a 1). Round: [T0, T0+30s].
  const opened = run(stateInWaitingPick(), [[pick("m0", "q0"), T0]]);
  const endsAt = opened.lots[0].rounds[0].endsAt;

  it("§12.1 — tre offerte diverse → vince la più alta, assegnazione già committata", () => {
    const closed = run(opened, [
      [bidEvent("m1", 30), T0 + sec(5)],
      [bidEvent("m2", 20), T0 + sec(6)],
      [{ type: "ADVANCE" }, endsAt],
    ]);
    expect(closed.phase).toBe("LOT_REVEAL");
    expect(closed.phaseDeadline).toBe(endsAt + sec(10));
    const lot = closed.lots[0];
    expect(lot.status).toBe("RESOLVED");
    expect(lot.winnerMemberId).toBe("m1");
    expect(lot.finalPrice).toBe(30);
    expect(lot.rounds[0].closedAt).toBe(endsAt);
    // Committata all'INGRESSO del reveal (PLAN §4), non alla sua scadenza.
    expect(closed.assignments).toHaveLength(1);
    expect(closed.assignments[0]).toMatchObject({
      memberId: "m1",
      playerId: "q0",
      price: 30,
      lotId: lot.id,
      source: "AUCTION",
      voidedAt: null,
    });
  });

  it("§12.2 — nessuno offre oltre il chiamante → assegnato al chiamante a 1", () => {
    const closed = run(opened, [[{ type: "ADVANCE" }, endsAt]]);
    expect(closed.phase).toBe("LOT_REVEAL");
    expect(closed.lots[0].winnerMemberId).toBe("m0");
    expect(closed.lots[0].finalPrice).toBe(1);
  });

  it("un'offerta ritirata non conta nella risoluzione (§12.7)", () => {
    const closed = run(opened, [
      [bidEvent("m1", 30), T0 + sec(5)],
      [{ type: "WITHDRAW_BID", memberId: "m1" }, T0 + sec(8)],
      [{ type: "ADVANCE" }, endsAt],
    ]);
    expect(closed.lots[0].winnerMemberId).toBe("m0");
  });

  it("§12.9 — pareggio sul massimo → LOT_TIE_PREP con deadline tie_prep_seconds", () => {
    const tied = run(opened, [
      [bidEvent("m1", 50), T0 + sec(2)],
      [bidEvent("m2", 50), T0 + sec(9)],
      [{ type: "ADVANCE" }, endsAt],
    ]);
    expect(tied.phase).toBe("LOT_TIE_PREP");
    expect(tied.phaseDeadline).toBe(endsAt + sec(10));
    expect(tied.lots[0].status).toBe("OPEN");
    expect(tied.assignments).toHaveLength(0);
  });
});

describe("machine: TIE_PREP → round 2 con carry-forward — F2-14", () => {
  const opened = run(stateInWaitingPick(), [[pick("m0", "q0"), T0]]);
  const r1End = opened.lots[0].rounds[0].endsAt;
  // §12.6 — A (m1) arriva a 50 per prima; B (m2) parte da 30 e ci arriva dopo.
  const tied = run(opened, [
    [bidEvent("m1", 50), T0 + sec(2)],
    [bidEvent("m2", 30), T0 + sec(1)],
    [bidEvent("m2", 50), T0 + sec(25)],
    [{ type: "ADVANCE" }, r1End],
  ]);
  const tieDeadline = tied.phaseDeadline!;
  const inRound2 = run(tied, [[{ type: "ADVANCE" }, tieDeadline]]);

  it("apre il round 2 con min_amount pari all'importo pareggiato e i soli pareggianti", () => {
    expect(inRound2.phase).toBe("LOT_OPEN");
    const lot = inRound2.lots[0];
    expect(lot.currentRound).toBe(2);
    expect(lot.rounds).toHaveLength(2);
    const r2 = lot.rounds[1];
    expect(r2.roundNo).toBe(2);
    expect(r2.minAmount).toBe(50);
    expect(r2.endsAt).toBe(tieDeadline + sec(30));
    expect(inRound2.phaseDeadline).toBe(r2.endsAt);
    expect(r2.eligibleMemberIds.sort()).toEqual(["m1", "m2"]);
  });

  it("il carry-forward copia le offerte preservando amount_set_at (§12.15 sul round 1)", () => {
    const r1 = inRound2.lots[0].rounds[0];
    const r2 = inRound2.lots[0].rounds[1];
    expect(r2.bids).toHaveLength(2);
    const carried1 = r2.bids.find((b) => b.memberId === "m1")!;
    const carried2 = r2.bids.find((b) => b.memberId === "m2")!;
    expect(carried1).toMatchObject({ amount: 50, amountSetAt: T0 + sec(2) });
    expect(carried2).toMatchObject({ amount: 50, amountSetAt: T0 + sec(25) });
    // Righe nuove, non le stesse del round 1.
    expect(r1.bids.map((b) => b.id)).not.toContain(carried1.id);
  });

  it("§12.13 — pareggio a 3 → tutti e tre nel round 2", () => {
    const threeWay = run(opened, [
      [bidEvent("m1", 40), T0 + sec(2)],
      [bidEvent("m2", 40), T0 + sec(3)],
      [bidEvent("m3", 40), T0 + sec(4)],
      [{ type: "ADVANCE" }, r1End],
      [{ type: "ADVANCE" }, r1End + sec(10)],
    ]);
    const r2 = threeWay.lots[0].rounds[1];
    expect(r2.eligibleMemberIds.sort()).toEqual(["m1", "m2", "m3"]);
    expect(r2.minAmount).toBe(40);
  });

  it("§12.14 — offrire sotto min_amount nel round 2 è rifiutato (I6)", () => {
    expectFail(inRound2, bidEvent("m1", 49), tieDeadline + sec(1), "BID_TOO_LOW");
  });

  it("§12.15 — un non-pareggiante non può offrire nel round 2", () => {
    expectFail(inRound2, bidEvent("m3", 60), tieDeadline + sec(1), "NOT_ELIGIBLE");
  });

  it("nel round 2 il ritiro è vietato anche ai non-chiamanti (⚠ P10)", () => {
    expectFail(
      inRound2,
      { type: "WITHDRAW_BID", memberId: "m2" },
      tieDeadline + sec(1),
      "WITHDRAW_FORBIDDEN",
    );
  });
});

describe("machine: risoluzione del round 2 — F2-15", () => {
  const opened = run(stateInWaitingPick(), [[pick("m0", "q0"), T0]]);
  const r1End = opened.lots[0].rounds[0].endsAt;
  const inRound2 = run(opened, [
    [bidEvent("m1", 50), T0 + sec(2)], // m1 fissa 50 per prima
    [bidEvent("m2", 30), T0 + sec(1)],
    [bidEvent("m2", 50), T0 + sec(25)],
    [{ type: "ADVANCE" }, r1End],
    [{ type: "ADVANCE" }, r1End + sec(10)],
  ]);
  const r2End = inRound2.lots[0].rounds[1].endsAt;

  it("§12.10 — uno rilancia → vince lui", () => {
    const closed = run(inRound2, [
      [bidEvent("m2", 60), r2End - sec(5)],
      [{ type: "ADVANCE" }, r2End],
    ]);
    expect(closed.phase).toBe("LOT_REVEAL");
    expect(closed.lots[0].winnerMemberId).toBe("m2");
    expect(closed.lots[0].finalPrice).toBe(60);
  });

  it("§12.6, §12.11 — stallo: vince il carry-forward con amount_set_at più vecchio", () => {
    const closed = run(inRound2, [[{ type: "ADVANCE" }, r2End]]);
    expect(closed.lots[0].winnerMemberId).toBe("m1");
    expect(closed.lots[0].finalPrice).toBe(50);
  });

  it("§12.12 — entrambi rilanciano allo stesso importo → vince chi ha submittato prima nel round 2", () => {
    const closed = run(inRound2, [
      [bidEvent("m2", 70), r2End - sec(8)], // m2 arriva a 70 per primo…
      [bidEvent("m1", 70), r2End - sec(3)], // …m1 lo raggiunge dopo
      [{ type: "ADVANCE" }, r2End],
    ]);
    expect(closed.lots[0].winnerMemberId).toBe("m2");
    expect(closed.lots[0].finalPrice).toBe(70);
  });

  it("confermare la propria cifra nel round 2 non peggiora la posizione (⚠ P3)", () => {
    const closed = run(inRound2, [
      // m1 "conferma" ansiosamente i suoi 50: il timestamp resta T0+2s…
      [bidEvent("m1", 50), r2End - sec(2)],
      [{ type: "ADVANCE" }, r2End],
    ]);
    // …quindi nello stallo vince comunque lei.
    expect(closed.lots[0].winnerMemberId).toBe("m1");
  });
});

describe("machine: REVEAL e avanzamento del turno — F2-16", () => {
  // m0 vince q0 a 1 (nessun rilancio); il reveal dura 10s.
  const opened = run(stateInWaitingPick(), [[pick("m0", "q0"), T0]]);
  const r1End = opened.lots[0].rounds[0].endsAt;
  const revealed = run(opened, [[{ type: "ADVANCE" }, r1End]]);
  const revealEnd = revealed.phaseDeadline!;

  it("alla scadenza del reveal torna WAITING_PICK sul seat successivo", () => {
    const next = run(revealed, [[{ type: "ADVANCE" }, revealEnd]]);
    expect(next.phase).toBe("WAITING_PICK");
    expect(next.currentRole).toBe("P");
    expect(next.currentSeatIndex).toBe(1);
    expect(next.currentLotId).toBeNull();
    expect(next.phaseDeadline).toBe(revealEnd + sec(30));
    expect(next.status).toBe("LIVE");
  });

  it("la rotazione è indipendente da chi ha vinto il lotto", () => {
    // Vince m2 con un rilancio: il turno passa comunque a m1.
    const wonByM2 = run(opened, [
      [bidEvent("m2", 40), T0 + sec(3)],
      [{ type: "ADVANCE" }, r1End],
      [{ type: "ADVANCE" }, r1End + sec(10)],
    ]);
    expect(wonByM2.lots[0].winnerMemberId).toBe("m2");
    expect(wonByM2.currentSeatIndex).toBe(1);
  });

  it("§12.23 — il seat successivo salta chi ha il ruolo pieno, con wrap-around", () => {
    // m1 e m2 hanno già il P: dopo il lotto vinto da m0, tocca a m3.
    const state = stateInWaitingPick({
      assignments: [
        assignment(90, "m1", "q2", 5),
        assignment(91, "m2", "q3", 5),
      ],
      nextId: 92,
    });
    const next = run(state, [
      [pick("m0", "q0"), T0],
      [{ type: "ADVANCE" }, T0 + sec(30)],
      [{ type: "ADVANCE" }, T0 + sec(40)],
    ]);
    expect(next.currentSeatIndex).toBe(3);
    expect(next.currentRole).toBe("P");
  });

  it("§12.22 — ultimo slot del ruolo riempito → si passa al ruolo successivo", () => {
    // Tutti tranne m0 hanno già il P: il lotto di m0 chiude il ruolo.
    const state = stateInWaitingPick({
      assignments: [
        assignment(90, "m1", "q1", 5),
        assignment(91, "m2", "q2", 5),
        assignment(92, "m3", "q3", 5),
      ],
      nextId: 93,
    });
    const next = run(state, [
      [pick("m0", "q0"), T0],
      [{ type: "ADVANCE" }, T0 + sec(10)], // unico idoneo → reveal immediato
    ]);
    expect(next.currentRole).toBe("D");
    expect(next.phase).toBe("WAITING_PICK");
  });
});

describe("machine: pause/resume — F2-17", () => {
  const opened = run(stateInWaitingPick(), [[pick("m0", "q0"), T0]]);

  it("§12.29 — pausa a metà round e resume dopo 5 minuti → il residuo è intatto", () => {
    // Round [T0, T0+30s]; pausa a T0+10s (residuo 20s), resume a T0+310s.
    const paused = run(opened, [[{ type: "PAUSE" }, T0 + sec(10)]]);
    expect(paused.status).toBe("PAUSED");
    expect(paused.pausedAt).toBe(T0 + sec(10));
    expect(paused.phase).toBe("LOT_OPEN"); // la pausa congela la fase

    const resumed = run(paused, [[{ type: "RESUME" }, T0 + sec(310)]]);
    expect(resumed.status).toBe("LIVE");
    expect(resumed.pausedAt).toBeNull();
    expect(resumed.phaseDeadline).toBe(T0 + sec(330)); // 20s residui
    // Anche la scadenza del round è traslata: un'offerta nel residuo passa…
    const bidAfter = transition(resumed, bidEvent("m1", 10), T0 + sec(325));
    expect(bidAfter.ok).toBe(true);
    // …e il round non risulta scaduto alla vecchia deadline.
    const advanceEarly = transition(resumed, { type: "ADVANCE" }, T0 + sec(311));
    expect(advanceEarly.ok).toBe(true);
    if (advanceEarly.ok) expect(advanceEarly.value).toBe(resumed);
  });

  it("in pausa le azioni di gioco sono rifiutate e ADVANCE è un no-op", () => {
    const paused = run(opened, [[{ type: "PAUSE" }, T0 + sec(10)]]);
    expectFail(paused, bidEvent("m1", 10), T0 + sec(11), "WRONG_STATUS");
    expectFail(
      paused,
      { type: "WITHDRAW_BID", memberId: "m1" },
      T0 + sec(11),
      "WRONG_STATUS",
    );
    // Neanche il tempo fa avanzare un'asta in pausa.
    const advanced = transition(paused, { type: "ADVANCE" }, T0 + sec(999));
    expect(advanced.ok).toBe(true);
    if (advanced.ok) expect(advanced.value).toBe(paused);
  });

  it("pause e resume ripetuti sono no-op; la pausa fuori da LIVE è rifiutata", () => {
    const paused = run(opened, [[{ type: "PAUSE" }, T0 + sec(10)]]);
    const rePaused = transition(paused, { type: "PAUSE" }, T0 + sec(12));
    expect(rePaused.ok).toBe(true);
    if (rePaused.ok) expect(rePaused.value).toBe(paused);

    const reResumed = transition(opened, { type: "RESUME" }, T0 + sec(12));
    expect(reResumed.ok).toBe(true);
    if (reResumed.ok) expect(reResumed.value).toBe(opened);

    const ready = makeState({ status: "READY", phase: null });
    expectFail(ready, { type: "PAUSE" }, T0, "WRONG_STATUS");
  });
});

describe("machine: idempotenza e unico idoneo — F2-18", () => {
  it("§12.26 — ADVANCE due volte sullo stesso deadline → un solo effetto (I7)", () => {
    const opened = run(stateInWaitingPick(), [[pick("m0", "q0"), T0]]);
    const deadline = opened.phaseDeadline!;
    const first = transition(opened, { type: "ADVANCE" }, deadline);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.phase).toBe("LOT_REVEAL");

    const second = transition(first.value, { type: "ADVANCE" }, deadline);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value).toBe(first.value); // stesso riferimento
  });

  it("§12.41 — unico idoneo è il chiamante → reveal immediato a 1, senza countdown", () => {
    const state = stateInWaitingPick({
      assignments: [
        assignment(90, "m1", "q1", 5),
        assignment(91, "m2", "q2", 5),
        assignment(92, "m3", "q3", 5),
      ],
      nextId: 93,
    });
    const next = run(state, [[pick("m0", "q0"), T0 + sec(3)]]);
    expect(next.phase).toBe("LOT_REVEAL");
    expect(next.phaseDeadline).toBe(T0 + sec(3) + sec(10)); // solo il reveal
    const lot = next.lots[0];
    expect(lot.status).toBe("RESOLVED");
    expect(lot.winnerMemberId).toBe("m0");
    expect(lot.finalPrice).toBe(1);
    expect(next.assignments.at(-1)).toMatchObject({
      memberId: "m0",
      playerId: "q0",
      price: 1,
    });
    // Il round esiste per il pannello di reveal, ma è già chiuso.
    expect(lot.rounds[0].closedAt).toBe(T0 + sec(3));
  });

  it("§12.41 via timeout — anche l'auto-pick con unico idoneo chiude subito", () => {
    const state = stateInWaitingPick({
      assignments: [
        assignment(90, "m1", "q1", 5),
        assignment(91, "m2", "q2", 5),
        assignment(92, "m3", "q3", 5),
      ],
      nextId: 93,
    });
    const next = run(state, [[{ type: "ADVANCE" }, state.phaseDeadline!]]);
    expect(next.phase).toBe("LOT_REVEAL");
    expect(next.lots[0].autoCalled).toBe(true);
    expect(next.lots[0].finalPrice).toBe(1);
  });
});

describe("machine: START e percorso completo — §12.21, §12.22, §12.24", () => {
  function readyState() {
    return makeState({
      status: "READY",
      phase: null,
      currentRole: null,
      currentSeatIndex: null,
      phaseDeadline: null,
      config: { seats: 2, roleOrder: ["C", "A", "P", "D"] },
      players: (["P", "D", "C", "A"] as const).flatMap((r, ri) => [
        player(`${r}0`, r, { fvm: 90, extId: ri * 10 }),
        player(`${r}1`, r, { fvm: 80, extId: ri * 10 + 1 }),
        player(`${r}2`, r, { fvm: 70, extId: ri * 10 + 2 }),
      ]),
    });
  }

  it("§12.21 — start su READY: parte dal primo ruolo di role_order e dal seat scelto", () => {
    const started = run(readyState(), [
      [{ type: "START", startSeatIndex: 1 }, T0],
    ]);
    expect(started.status).toBe("LIVE");
    expect(started.phase).toBe("WAITING_PICK");
    expect(started.currentRole).toBe("C");
    expect(started.currentSeatIndex).toBe(1);
    expect(started.phaseDeadline).toBe(T0 + sec(30));
  });

  it("rifiuta lo start fuori da READY e su un seat inesistente", () => {
    expectFail(
      stateInWaitingPick(),
      { type: "START", startSeatIndex: 0 },
      T0,
      "WRONG_STATUS",
    );
    expectFail(
      readyState(),
      { type: "START", startSeatIndex: 2 },
      T0,
      "INVALID_SEAT",
    );
  });

  it("§12.21/22/24 — l'asta percorre C, A, P, D e finisce COMPLETED", () => {
    let state = run(readyState(), [[{ type: "START", startSeatIndex: 0 }, T0]]);
    const rolesSeen: string[] = [];
    let guard = 0;
    while (state.status === "LIVE") {
      if ((guard += 1) > 100) throw new Error("l'asta non converge");
      if (state.phase === "WAITING_PICK") rolesSeen.push(state.currentRole!);
      // Nessuno agisce: pick e round scadono, l'asta si gioca da sola.
      state = run(state, [[{ type: "ADVANCE" }, state.phaseDeadline!]]);
    }
    expect(state.status).toBe("COMPLETED");
    expect(state.phase).toBeNull();
    expect(state.currentLotId).toBeNull();
    // Un WAITING_PICK per lotto, nell'ordine dei ruoli scelto a creazione.
    expect(rolesSeen).toEqual(["C", "C", "A", "A", "P", "P", "D", "D"]);
    // Rose complete: 4 giocatori a testa, tutti pagati 1.
    expect(state.assignments).toHaveLength(8);
    for (const m of ["m0", "m1"]) {
      expect(
        state.assignments.filter((a) => a.memberId === m),
      ).toHaveLength(4);
    }
    expect(new Set(state.assignments.map((a) => a.playerId)).size).toBe(8);
  });
});

describe("machine: SKIP_REVEAL — la regia taglia l'attesa delle buste aperte", () => {
  /** Un lotto chiuso e assegnato: siamo in LOT_REVEAL, con la sua deadline. */
  function inReveal(): AuctionState {
    const opened = run(stateInWaitingPick(), [[pick("m0", "q1"), T0]]);
    const endsAt = opened.lots[0].rounds[0].endsAt;
    return run(opened, [
      [bidEvent("m1", 30), T0 + sec(5)],
      [{ type: "ADVANCE" }, endsAt],
    ]);
  }

  it("salta l'attesa e lascia lo stesso stato che avrebbe prodotto la scadenza", () => {
    const reveal = inReveal();
    expect(reveal.phase).toBe("LOT_REVEAL");
    const deadline = reveal.phaseDeadline!;
    const early = deadline - sec(7);

    const skipped = run(reveal, [[{ type: "SKIP_REVEAL" }, early]]);
    const expired = run(reveal, [[{ type: "ADVANCE" }, deadline]]);

    // Il turno passa esattamente come sarebbe passato da solo: cambia solo
    // *quando*, e la deadline nuova nasce dall'istante in cui si preme.
    expect(skipped.phase).toBe("WAITING_PICK");
    expect(skipped.currentSeatIndex).toBe(expired.currentSeatIndex);
    expect(skipped.currentRole).toBe(expired.currentRole);
    expect(skipped.currentLotId).toBeNull();
    expect(skipped.assignments).toEqual(expired.assignments);
    expect(skipped.phaseDeadline).toBe(early + sec(30));
  });

  it("è rifiutato in ogni fase che non sia il reveal", () => {
    const waiting = stateInWaitingPick();
    expectFail(waiting, { type: "SKIP_REVEAL" }, T0, "WRONG_PHASE");

    const open = run(waiting, [[pick("m0", "q1"), T0]]);
    expectFail(open, { type: "SKIP_REVEAL" }, T0 + sec(1), "WRONG_PHASE");
  });

  it("premuto due volte non salta due lotti (I7)", () => {
    const reveal = inReveal();
    const now = reveal.phaseDeadline! - sec(7);
    const once = run(reveal, [[{ type: "SKIP_REVEAL" }, now]]);
    expectFail(once, { type: "SKIP_REVEAL" }, now + 50, "WRONG_PHASE");
  });

  it("non tocca un'asta in pausa: la pausa congela la fase", () => {
    const paused = run(inReveal(), [[{ type: "PAUSE" }, T0 + sec(31)]]);
    expectFail(paused, { type: "SKIP_REVEAL" }, T0 + sec(32), "WRONG_PHASE");
  });
});
