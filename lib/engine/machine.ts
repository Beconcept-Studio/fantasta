import { type Result, fail, ok } from "./errors";
import {
  autoPick,
  eligibleMemberIds,
  maxBid,
  nextRole,
  nextSeat,
  ownedByRole,
  resolveRound,
} from "./rules";
import type {
  AuctionEvent,
  AuctionState,
  Lot,
  LotRound,
  Millis,
} from "./types";

/**
 * La macchina a stati dell'asta (PLAN §4), come funzione pura:
 * `transition(state, event, now)` restituisce il nuovo stato o un rifiuto
 * tipizzato. Niente database, niente `Date.now()`: il tempo arriva da fuori,
 * e chi chiama (le action di Fase 3) decide cosa farne del risultato.
 *
 * Due convenzioni che il resto del sistema sfrutta:
 *
 * - **Un no-op restituisce lo stesso riferimento** (`ok(state)`). È così che
 *   I7 (idempotenza) diventa osservabile e che Fase 3 saprà distinguere "la
 *   mutazione ha avuto effetto" (bump di `state_version` e broadcast) da "non
 *   è successo niente" (⚠ P14).
 * - **I rifiuti previsti sono `Result`, i bug sono eccezioni.** Un pick fuori
 *   turno è un rifiuto; un round senza offerte attive è un'invariante rotta e
 *   deve esplodere, non diventare un messaggio gentile.
 */

export function transition(
  state: AuctionState,
  event: AuctionEvent,
  now: Millis,
): Result<AuctionState> {
  switch (event.type) {
    case "START":
      return start(state, event.startSeatIndex, now);
    case "PICK":
      return pick(state, event.memberId, event.playerId, now);
    case "PLACE_BID":
      return placeBid(state, event.memberId, event.amount, now);
    case "WITHDRAW_BID":
      return withdrawBid(state, event.memberId, now);
    case "ADVANCE":
      return advance(state, now);
    case "PAUSE":
      return pause(state, now);
    case "RESUME":
      return resume(state, now);
  }
}

// ─── START ───────────────────────────────────────────────────────────────────

/**
 * `READY → LIVE` (PLAN §4): il primo elemento di `role_order` **è** il ruolo
 * iniziale — all'avvio si sceglie solo il seat di partenza. Il gate presence
 * ("tutti i membri LIVE") è un fatto di heartbeat, non di macchina a stati:
 * lo aggiunge F4-06 nell'action.
 */
function start(
  state: AuctionState,
  startSeatIndex: number,
  now: Millis,
): Result<AuctionState> {
  if (state.status !== "READY") {
    return fail("WRONG_STATUS", "Si avvia solo un'asta pronta (READY).");
  }
  const seatExists = state.members.some((m) => m.seatIndex === startSeatIndex);
  if (!seatExists) {
    return fail("INVALID_SEAT", `Nessun membro al seat ${startSeatIndex}.`);
  }
  return ok({
    ...state,
    status: "LIVE",
    phase: "WAITING_PICK",
    currentRole: state.config.roleOrder[0],
    currentSeatIndex: startSeatIndex,
    phaseDeadline: now + state.config.pickSeconds * 1000,
  });
}

// ─── Accessori ───────────────────────────────────────────────────────────────

function openLotOf(state: AuctionState): Lot {
  const lot = state.lots.find((l) => l.id === state.currentLotId);
  if (!lot || lot.status !== "OPEN") {
    throw new Error("fase di lotto senza un lotto OPEN: invariante I1 rotta");
  }
  return lot;
}

function currentRoundOf(lot: Lot): LotRound {
  const round = lot.rounds[lot.rounds.length - 1];
  if (!round || round.roundNo !== lot.currentRound) {
    throw new Error("lotto senza il round corrente");
  }
  return round;
}

/** Rimpiazza il lotto corrente (per id) in una copia dello stato. */
function withLot(state: AuctionState, lot: Lot): AuctionState {
  return {
    ...state,
    lots: state.lots.map((l) => (l.id === lot.id ? lot : l)),
  };
}

function withCurrentRound(lot: Lot, round: LotRound): Lot {
  return {
    ...lot,
    rounds: lot.rounds.map((r) => (r.roundNo === round.roundNo ? round : r)),
  };
}

// ─── PICK ────────────────────────────────────────────────────────────────────

function pick(
  state: AuctionState,
  memberId: string,
  playerId: string,
  now: Millis,
): Result<AuctionState> {
  if (state.status !== "LIVE") {
    return fail("WRONG_STATUS", "L'asta non è in corso.");
  }
  if (state.phase !== "WAITING_PICK") {
    return fail("WRONG_PHASE", "Non è il momento di chiamare un giocatore.");
  }
  const member = state.members.find((m) => m.id === memberId);
  if (!member) {
    return fail("MEMBER_NOT_FOUND", "Membro sconosciuto per questa asta.");
  }
  if (member.seatIndex !== state.currentSeatIndex) {
    return fail("NOT_YOUR_TURN", "Non è il tuo turno di chiamata.");
  }
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    return fail("PLAYER_NOT_FOUND", "Giocatore non presente nel listone.");
  }
  if (player.role !== state.currentRole) {
    return fail(
      "WRONG_ROLE",
      `In questo momento si chiamano i ${state.currentRole}, non i ${player.role}.`,
    );
  }
  const assigned = state.assignments.some(
    (a) => a.playerId === playerId && a.voidedAt === null,
  );
  if (assigned) {
    return fail("PLAYER_ASSIGNED", "Il giocatore è già in una rosa.");
  }
  if (player.outOfList && !state.config.includeOutOfList) {
    return fail(
      "PLAYER_OUT_OF_LIST",
      "Il giocatore è fuori lista e il pool di quest'asta li esclude.",
    );
  }
  return ok(openLot(state, playerId, memberId, false, now));
}

/**
 * L'apertura di un lotto (PLAN §4, `WAITING_PICK → LOT_OPEN`): round 1 con
 * `min_amount = 1`, eligibility calcolata adesso, e **l'auto-bid a 1 del
 * chiamante** — che da qui in poi è vincolato: può solo rilanciare.
 *
 * Caso speciale (DECISIONS 2026-08-06, test §12.41): se l'unico idoneo è il
 * chiamante, l'esito è già scritto — niente countdown, il lotto passa dritto
 * a LOT_REVEAL assegnato a 1. A fine ruolo questi lotti possono essere molti
 * di fila, e trenta secondi ciascuno sarebbero minuti persi in diretta.
 */
function openLot(
  state: AuctionState,
  playerId: string,
  calledByMemberId: string,
  autoCalled: boolean,
  now: Millis,
): AuctionState {
  const role = state.currentRole!;
  const eligible = eligibleMemberIds(state, role);
  const soleEligible = eligible.length === 1 && eligible[0] === calledByMemberId;
  const endsAt = soleEligible ? now : now + state.config.bidSeconds * 1000;
  const lotId = state.nextId;
  const bidId = state.nextId + 1;
  const lot: Lot = {
    id: lotId,
    seq: state.lots.length + 1,
    playerId,
    calledByMemberId,
    autoCalled,
    status: "OPEN",
    currentRound: 1,
    winnerMemberId: null,
    finalPrice: null,
    openedAt: now,
    resolvedAt: null,
    rounds: [
      {
        roundNo: 1,
        minAmount: 1,
        startsAt: now,
        endsAt,
        closedAt: soleEligible ? now : null,
        eligibleMemberIds: eligible,
        bids: [
          {
            id: bidId,
            memberId: calledByMemberId,
            amount: 1,
            amountSetAt: now,
            createdAt: now,
            withdrawnAt: null,
          },
        ],
      },
    ],
  };
  const opened: AuctionState = {
    ...state,
    phase: "LOT_OPEN",
    phaseDeadline: endsAt,
    currentLotId: lotId,
    lots: [...state.lots, lot],
    nextId: state.nextId + 2,
  };
  if (soleEligible) {
    return enterReveal(opened, lot, calledByMemberId, 1, now);
  }
  return opened;
}

// ─── Offerte ─────────────────────────────────────────────────────────────────

function placeBid(
  state: AuctionState,
  memberId: string,
  amount: number,
  now: Millis,
): Result<AuctionState> {
  if (state.status !== "LIVE") {
    return fail("WRONG_STATUS", "L'asta non è in corso.");
  }
  if (state.phase !== "LOT_OPEN") {
    return fail("WRONG_PHASE", "Non c'è un round di offerte aperto.");
  }
  const lot = openLotOf(state);
  const round = currentRoundOf(lot);
  if (now > round.endsAt) {
    return fail("ROUND_CLOSED", "Il round è chiuso: offerta arrivata tardi.");
  }
  if (!round.eligibleMemberIds.includes(memberId)) {
    return fail("NOT_ELIGIBLE", "Non sei fra gli idonei di questo round.");
  }
  const existing = round.bids.find((b) => b.memberId === memberId);
  if (existing?.withdrawnAt != null) {
    return fail(
      "BID_WITHDRAWN",
      "Hai ritirato l'offerta su questo lotto: il ritiro è definitivo.",
    );
  }
  if (!Number.isInteger(amount)) {
    return fail("INVALID_AMOUNT", "L'offerta deve essere un numero intero.");
  }
  if (amount < round.minAmount) {
    return fail(
      "BID_TOO_LOW",
      `L'offerta minima di questo round è ${round.minAmount}.`,
    );
  }
  const cap = maxBid(state, memberId);
  if (amount > cap) {
    return fail(
      "BID_TOO_HIGH",
      `Puoi offrire al massimo ${cap}: il resto dei crediti serve agli slot rimanenti.`,
    );
  }
  // ⚠ P3 — confermare la stessa cifra è un no-op: il timestamp resta quello
  // del primo submit, e nel round 2 è la posizione in coda che conta.
  if (existing && existing.amount === amount) {
    return ok(state);
  }
  const bids = existing
    ? round.bids.map((b) =>
        b.memberId === memberId ? { ...b, amount, amountSetAt: now } : b,
      )
    : [
        ...round.bids,
        {
          id: state.nextId,
          memberId,
          amount,
          amountSetAt: now,
          createdAt: now,
          withdrawnAt: null,
        },
      ];
  const next = withLot(state, withCurrentRound(lot, { ...round, bids }));
  return ok(existing ? next : { ...next, nextId: state.nextId + 1 });
}

function withdrawBid(
  state: AuctionState,
  memberId: string,
  now: Millis,
): Result<AuctionState> {
  if (state.status !== "LIVE") {
    return fail("WRONG_STATUS", "L'asta non è in corso.");
  }
  if (state.phase !== "LOT_OPEN") {
    return fail("WRONG_PHASE", "Non c'è un round di offerte aperto.");
  }
  const lot = openLotOf(state);
  const round = currentRoundOf(lot);
  if (now > round.endsAt) {
    return fail("ROUND_CLOSED", "Il round è chiuso: il ritiro è arrivato tardi.");
  }
  if (memberId === lot.calledByMemberId) {
    return fail(
      "WITHDRAW_FORBIDDEN",
      "Il chiamante non può ritirare: può solo rilanciare.",
    );
  }
  if (round.roundNo === 2) {
    return fail(
      "WITHDRAW_FORBIDDEN",
      "Nello spareggio il ritiro non è ammesso.",
    );
  }
  const existing = round.bids.find((b) => b.memberId === memberId);
  if (!existing) {
    return fail("WITHDRAW_FORBIDDEN", "Non hai un'offerta da ritirare.");
  }
  if (existing.withdrawnAt !== null) {
    return ok(state); // già ritirata: ripetere non cambia niente
  }
  const bids = round.bids.map((b) =>
    b.memberId === memberId ? { ...b, withdrawnAt: now } : b,
  );
  return ok(withLot(state, withCurrentRound(lot, { ...round, bids })));
}

// ─── ADVANCE — l'unico evento del tempo ──────────────────────────────────────

/**
 * La transizione temporale, **guardata** (I7): se la deadline non è arrivata,
 * o non c'è niente da far avanzare, restituisce lo stesso stato. I timer e lo
 * sweep di Fase 3 possono chiamarla quante volte vogliono.
 */
function advance(state: AuctionState, now: Millis): Result<AuctionState> {
  if (state.status !== "LIVE") return ok(state);
  if (state.phase === null || state.phaseDeadline === null) return ok(state);
  if (now < state.phaseDeadline) return ok(state);

  switch (state.phase) {
    case "WAITING_PICK":
      return ok(advanceWaitingPick(state, now));
    case "LOT_OPEN":
      return ok(advanceLotOpen(state, now));
    case "LOT_TIE_PREP":
      return ok(advanceTiePrep(state, now));
    case "LOT_REVEAL":
      return ok(advanceReveal(state, now));
  }
}

/**
 * Fine del reveal (PLAN §4, `LOT_REVEAL → WAITING_PICK | COMPLETED`): si
 * avanza il turno. Ruolo pieno per tutti → prossimo ruolo di `role_order`
 * (saltando quelli già pieni, ⚠ P9); nessun ruolo residuo → COMPLETED.
 * Il seat successivo è il prossimo in ordine circolare con uno slot libero,
 * indipendente da chi ha vinto.
 */
function advanceReveal(state: AuctionState, now: Millis): AuctionState {
  const base = { ...state, currentLotId: null };
  let role = state.currentRole!;
  const roleFull = state.members.every(
    (m) => ownedByRole(state, m.id)[role] >= state.config.slots[role],
  );
  if (roleFull) {
    const next = nextRole(state, role);
    if (next === null) {
      return {
        ...base,
        status: "COMPLETED",
        phase: null,
        currentRole: null,
        currentSeatIndex: null,
        phaseDeadline: null,
      };
    }
    role = next;
  }
  const seat = nextSeat(state, role, state.currentSeatIndex!);
  if (seat === null) {
    throw new Error(`nessun seat con slot liberi nel ruolo ${role}`);
  }
  return {
    ...base,
    phase: "WAITING_PICK",
    currentRole: role,
    currentSeatIndex: seat,
    phaseDeadline: now + state.config.pickSeconds * 1000,
  };
}

// ─── Pause / resume ──────────────────────────────────────────────────────────

/**
 * `LIVE ↔ PAUSED` (PLAN §4): la pausa congela la fase, non la azzera. Ripetere
 * la pausa (o il resume) è un no-op — il doppio click dell'owner non deve
 * poter fare danni; fuori da LIVE/PAUSED invece è un errore.
 */
function pause(state: AuctionState, now: Millis): Result<AuctionState> {
  if (state.status === "PAUSED") return ok(state);
  if (state.status !== "LIVE") {
    return fail("WRONG_STATUS", "Si mette in pausa solo un'asta in corso.");
  }
  return ok({ ...state, status: "PAUSED", pausedAt: now });
}

/**
 * Il resume trasla ogni scadenza del tempo passato in pausa: la deadline di
 * fase e, se c'è un round di offerte aperto, anche il suo `ends_at` — è la
 * scadenza contro cui `placeBid` valida. **La pausa non deve mai far scadere
 * silenziosamente un countdown in corso.**
 */
function resume(state: AuctionState, now: Millis): Result<AuctionState> {
  if (state.status === "LIVE") return ok(state);
  if (state.status !== "PAUSED" || state.pausedAt === null) {
    return fail("WRONG_STATUS", "Si riprende solo un'asta in pausa.");
  }
  const shift = now - state.pausedAt;
  let next: AuctionState = {
    ...state,
    status: "LIVE",
    pausedAt: null,
    phaseDeadline:
      state.phaseDeadline === null ? null : state.phaseDeadline + shift,
  };
  if (state.phase === "LOT_OPEN") {
    const lot = openLotOf(state);
    const round = currentRoundOf(lot);
    next = withLot(
      next,
      withCurrentRound(lot, { ...round, endsAt: round.endsAt + shift }),
    );
  }
  return ok(next);
}

/**
 * Timeout del round di offerte (PLAN §4, `LOT_OPEN → …`): si aprono le buste.
 * Massimo unico → reveal; pareggio nel round 1 → preparazione dello
 * spareggio; pareggio nel round 2 → lo risolve `resolveRound` per
 * `amount_set_at`, quindi comunque reveal.
 */
function advanceLotOpen(state: AuctionState, now: Millis): AuctionState {
  const lot = openLotOf(state);
  const round = currentRoundOf(lot);
  const outcome = resolveRound(round);
  const closed = withCurrentRound(lot, { ...round, closedAt: now });

  if (outcome.kind === "WINNER") {
    return enterReveal(state, closed, outcome.bid.memberId, outcome.bid.amount, now);
  }
  return {
    ...withLot(state, closed),
    phase: "LOT_TIE_PREP",
    phaseDeadline: now + state.config.tiePrepSeconds * 1000,
  };
}

/**
 * Fine della preparazione allo spareggio (PLAN §4, `LOT_TIE_PREP → LOT_OPEN`):
 * round 2 con `min_amount` = importo pareggiato, idonei i soli pareggianti, e
 * il **carry-forward** delle loro offerte con l'`amount_set_at` originale —
 * chi non fa nulla "sta" sulla propria cifra, e nello stallo vince chi c'era
 * arrivato per primo.
 */
function advanceTiePrep(state: AuctionState, now: Millis): AuctionState {
  const lot = openLotOf(state);
  const round1 = currentRoundOf(lot);
  const outcome = resolveRound(round1);
  if (outcome.kind !== "TIE") {
    throw new Error("LOT_TIE_PREP senza un pareggio nel round 1");
  }
  const endsAt = now + state.config.bidSeconds * 1000;
  let nextId = state.nextId;
  const round2: LotRound = {
    roundNo: 2,
    minAmount: outcome.amount,
    startsAt: now,
    endsAt,
    closedAt: null,
    eligibleMemberIds: outcome.bids.map((b) => b.memberId),
    bids: outcome.bids.map((b) => ({
      id: nextId++,
      memberId: b.memberId,
      amount: b.amount,
      amountSetAt: b.amountSetAt, // il timestamp del round 1, preservato
      createdAt: now,
      withdrawnAt: null,
    })),
  };
  const withRound2: Lot = {
    ...lot,
    currentRound: 2,
    rounds: [...lot.rounds, round2],
  };
  return {
    ...withLot(state, withRound2),
    phase: "LOT_OPEN",
    phaseDeadline: endsAt,
    nextId,
  };
}

/**
 * L'ingresso in LOT_REVEAL (PLAN §4): l'assegnazione è **committata qui**,
 * non alla fine del reveal — i secondi di reveal sono presentazionali, e un
 * crash durante il reveal non deve poter perdere un lotto già deciso.
 */
function enterReveal(
  state: AuctionState,
  lot: Lot,
  winnerMemberId: string,
  price: number,
  now: Millis,
): AuctionState {
  const resolved: Lot = {
    ...lot,
    status: "RESOLVED",
    winnerMemberId,
    finalPrice: price,
    resolvedAt: now,
  };
  return {
    ...withLot(state, resolved),
    phase: "LOT_REVEAL",
    phaseDeadline: now + state.config.revealSeconds * 1000,
    assignments: [
      ...state.assignments,
      {
        id: state.nextId,
        memberId: winnerMemberId,
        playerId: lot.playerId,
        price,
        lotId: lot.id,
        source: "AUCTION",
        createdAt: now,
        voidedAt: null,
      },
    ],
    nextId: state.nextId + 1,
  };
}

/**
 * Timeout del pick → auto-pick (PLAN §4): chiama il miglior disponibile del
 * ruolo, `auto_called = true`, e l'auto-bid a 1 resta a nome del membro di
 * turno — il regolamento non fa sconti a chi si distrae.
 */
function advanceWaitingPick(state: AuctionState, now: Millis): AuctionState {
  const player = autoPick(state, state.currentRole!);
  if (!player) {
    // ⚠ P20 — pool esaurito dopo l'import: deliberatamente non gestito.
    throw new Error(
      `auto-pick senza giocatori disponibili nel ruolo ${state.currentRole}`,
    );
  }
  const caller = state.members.find(
    (m) => m.seatIndex === state.currentSeatIndex,
  );
  if (!caller) throw new Error("seat corrente senza membro");
  return openLot(state, player.id, caller.id, true, now);
}
