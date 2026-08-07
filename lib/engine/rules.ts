import { ROLES, type Role } from "@/lib/domain";

import { type Result, fail, ok } from "./errors";
import type { AuctionState, Bid, LotRound, Player } from "./types";

/**
 * Le regole di dominio di PLAN §5, come funzioni pure sullo stato in memoria.
 *
 * Qui non si transisce mai: si risponde a domande. Quanti crediti ha un
 * membro? Fino a quanto può offrire? Chi è idoneo? Chi vince questo round?
 * `machine.ts` compone queste risposte in transizioni; i test le provano una
 * per una, in millisecondi, senza database (Fase 2).
 */

// ─── Rose e slot ─────────────────────────────────────────────────────────────

/** Giocatori posseduti (assegnazioni non annullate) di un membro, per ruolo. */
export function ownedByRole(
  state: AuctionState,
  memberId: string,
): Record<Role, number> {
  const owned: Record<Role, number> = { P: 0, D: 0, C: 0, A: 0 };
  for (const a of state.assignments) {
    if (a.memberId !== memberId || a.voidedAt !== null) continue;
    const p = state.players.find((p) => p.id === a.playerId);
    if (p) owned[p.role] += 1;
  }
  return owned;
}

/**
 * Slot ancora da riempire, calcolati **per ruolo e clampati a ≥ 0** (⚠ P2):
 * dopo una `manualAssign` con `force` un ruolo può essere in overflow, e la
 * somma lineare `slot_totali − posseduti` andrebbe sotto il vero residuo,
 * gonfiando `max_bid`.
 */
export function residualSlots(state: AuctionState, memberId: string): number {
  const owned = ownedByRole(state, memberId);
  return ROLES.reduce(
    (sum, role) => sum + Math.max(0, state.config.slots[role] - owned[role]),
    0,
  );
}

// ─── Crediti e offerta massima ───────────────────────────────────────────────

/**
 * PLAN §3: il credito non è una colonna mutabile.
 * `crediti(m) = budget_initial + Σ ledger.delta − Σ assignments.price (non voided)`
 */
export function credits(state: AuctionState, memberId: string): number {
  const m = state.members.find((m) => m.id === memberId);
  if (!m) throw new Error(`membro sconosciuto: ${memberId}`);
  let total = m.budgetInitial;
  for (const entry of state.ledger) {
    if (entry.memberId === memberId) total += entry.delta;
  }
  for (const a of state.assignments) {
    if (a.memberId === memberId && a.voidedAt === null) total -= a.price;
  }
  return total;
}

/**
 * **I5**, nella forma robusta di P2: bisogna lasciare 1 credito per ogni slot
 * residuo *oltre* a quello che si sta comprando, quindi
 * `max_bid = crediti − (residui − 1)` — e comunque mai sopra i crediti, che è
 * il caso `residui = 0` (rosa completa o in overflow da force).
 */
export function maxBid(state: AuctionState, memberId: string): number {
  const c = credits(state, memberId);
  return Math.min(c, c - (residualSlots(state, memberId) - 1));
}

// ─── Idoneità ────────────────────────────────────────────────────────────────

/**
 * Idonei a un lotto del ruolo dato: slot libero nel ruolo ∧ `max_bid ≥ 1`
 * (PLAN §4, `round_eligibility`). In ordine di seat, che è l'ordine in cui
 * tutto il resto del motore ragiona.
 */
export function eligibleMemberIds(state: AuctionState, role: Role): string[] {
  return [...state.members]
    .sort((a, b) => a.seatIndex - b.seatIndex)
    .filter((m) => {
      const owned = ownedByRole(state, m.id);
      return owned[role] < state.config.slots[role] && maxBid(state, m.id) >= 1;
    })
    .map((m) => m.id);
}

// ─── Auto-pick ───────────────────────────────────────────────────────────────

/**
 * Il miglior giocatore disponibile del ruolo: `fvm DESC, quot DESC, ext_id ASC`
 * (PLAN §4). L'`ext_id` come ultima chiave rende la scelta deterministica —
 * due esecuzioni sullo stesso stato chiamano lo stesso giocatore (§12.4).
 * `null` se il pool del ruolo è esaurito (caso deliberatamente non gestito a
 * monte, ⚠ P20: con I9 valida non succede).
 */
export function autoPick(state: AuctionState, role: Role): Player | null {
  const taken = new Set(
    state.assignments.filter((a) => a.voidedAt === null).map((a) => a.playerId),
  );
  const pool = state.players.filter(
    (p) =>
      p.role === role &&
      !taken.has(p.id) &&
      (state.config.includeOutOfList || !p.outOfList),
  );
  if (pool.length === 0) return null;
  return pool.reduce((best, p) =>
    p.fvm !== best.fvm
      ? p.fvm > best.fvm
        ? p
        : best
      : p.quot !== best.quot
        ? p.quot > best.quot
          ? p
          : best
        : p.extId < best.extId
          ? p
          : best,
  );
}

// ─── Risoluzione di un round ─────────────────────────────────────────────────

export type RoundOutcome =
  | { kind: "WINNER"; bid: Bid }
  | { kind: "TIE"; amount: number; bids: Bid[] };

/**
 * L'apertura delle buste (PLAN §4, `LOT_OPEN → …`): fra le offerte non
 * ritirate vince il massimo unico; il pareggio nel round 1 produce un `TIE`
 * (→ spareggio), nel round 2 si risolve per `MIN(amount_set_at)` — è qui che
 * il carry-forward premia chi era arrivato per primo a quella cifra — e, a
 * timestamp identici, per `MIN(id)`.
 */
export function resolveRound(round: LotRound): RoundOutcome {
  const active = round.bids.filter((b) => b.withdrawnAt === null);
  if (active.length === 0) {
    // Il chiamante non può ritirare: un round senza offerte attive è un bug.
    throw new Error("round senza offerte attive");
  }
  const max = Math.max(...active.map((b) => b.amount));
  const top = active.filter((b) => b.amount === max);
  if (top.length === 1) return { kind: "WINNER", bid: top[0] };
  if (round.roundNo === 1) return { kind: "TIE", amount: max, bids: top };
  const winner = top.reduce((a, b) =>
    b.amountSetAt !== a.amountSetAt
      ? b.amountSetAt < a.amountSetAt
        ? b
        : a
      : b.id < a.id
        ? b
        : a,
  );
  return { kind: "WINNER", bid: winner };
}

// ─── Rotazione ───────────────────────────────────────────────────────────────

/**
 * Il prossimo seat in ordine crescente circolare con uno slot libero nel
 * ruolo, a partire da quello dopo `fromSeatIndex`. La rotazione è
 * indipendente da chi ha vinto il lotto (PLAN §4) e può tornare sullo stesso
 * seat se è rimasto l'unico con spazio. `null` se il ruolo è pieno per tutti.
 */
export function nextSeat(
  state: AuctionState,
  role: Role,
  fromSeatIndex: number,
): number | null {
  const seats = state.config.seats;
  for (let step = 1; step <= seats; step += 1) {
    const seatIndex = (fromSeatIndex + step) % seats;
    const m = state.members.find((m) => m.seatIndex === seatIndex);
    if (!m) continue;
    if (ownedByRole(state, m.id)[role] < state.config.slots[role]) {
      return seatIndex;
    }
  }
  return null;
}

/**
 * ⚠ P9 — l'avanzamento lungo `role_order` salta i ruoli già pieni per tutti
 * (possibile dopo una `manualAssign`); `null` quando non resta nessun ruolo
 * da giocare → COMPLETED.
 */
export function nextRole(state: AuctionState, fromRole: Role): Role | null {
  const order = state.config.roleOrder;
  const from = order.indexOf(fromRole);
  for (let i = from + 1; i < order.length; i += 1) {
    const role = order[i];
    const full = state.members.every(
      (m) => ownedByRole(state, m.id)[role] >= state.config.slots[role],
    );
    if (!full) return role;
  }
  return null;
}

// ─── I3 — rettifiche di budget ───────────────────────────────────────────────

/**
 * **I3**: ogni slot residuo deve restare comprabile ad almeno 1 credito.
 * La regola pura dietro `adjustBudget` (l'azione arriva in Fase 7); il
 * messaggio nomina i numeri perché in diretta "rettifica rifiutata" non basta.
 */
export function canAdjustBudget(
  state: AuctionState,
  memberId: string,
  delta: number,
): Result<null> {
  const after = credits(state, memberId) + delta;
  const residual = residualSlots(state, memberId);
  if (after < residual) {
    return fail(
      "ADJUST_VIOLATES_I3",
      `Con questa rettifica il membro resterebbe con ${after} crediti per ${residual} slot da riempire: ogni slot deve restare comprabile ad almeno 1 credito.`,
    );
  }
  return ok(null);
}
