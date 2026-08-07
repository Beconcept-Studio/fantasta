import { asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  type Auction,
  assignments,
  auctions,
  bids,
  ledger,
  lotRounds,
  lots,
  members,
  players,
  roundEligibility,
  users,
} from "@/lib/db/schema";

import { type Result, fail } from "./errors";
import type {
  Assignment as EngineAssignment,
  Bid as EngineBid,
  Lot as EngineLot,
  LotRound as EngineLotRound,
  AuctionState,
  EngineId,
  Millis,
} from "./types";

/**
 * Il ponte fra il motore puro e il database (F3-01/F3-02).
 *
 * Il motore di Fase 2 lavora su un `AuctionState` in memoria, con il tempo in
 * millisecondi e id numerici da contatore; il database ha righe con uuid e
 * TIMESTAMPTZ. Questo file fa la traduzione nei due sensi — `loadAuctionState`
 * legge le righe e costruisce lo stato, `persistTransition` scrive la
 * differenza fra lo stato prima e dopo una `transition` — e fornisce
 * `withAuctionLock`, l'unico punto in cui un'asta avviata si muta (regola 4).
 *
 * Due proprietà da capire per leggere il resto:
 *
 * - **Gli id del motore sono etichette di caricamento.** Ogni load li assegna
 *   da un contatore in ordine di lettura e tiene la mappa verso gli uuid in
 *   `refs`; valgono per il ciclo load → transition → persist corrente e non
 *   si persistono. Niente nel dominio dipende dal loro valore (l'unico
 *   tie-break su `MIN(bids.id)` scatta a parità esatta di timestamp,
 *   "praticamente impossibile" per PLAN §4).
 * - **La persistenza è una diff per riferimento.** Il motore non muta mai lo
 *   stato: ciò che cambia è un oggetto nuovo lungo il cammino della modifica,
 *   ciò che non cambia è lo stesso riferimento. `persistTransition` sfrutta
 *   questa proprietà per toccare solo le righe davvero cambiate — e un no-op
 *   (`next === prev`) non scrive niente, che è il segnale P14 per non bumpare
 *   `state_version`.
 */

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Dbx = Tx | typeof db;

// ─── Il lock ─────────────────────────────────────────────────────────────────

/**
 * L'invio degli snapshot, agganciato dall'esterno (lo fa `instrumentation.ts`,
 * F4-03): il motore non deve sapere che esiste un canale verso i client. Nel
 * seed, nei test e nel driver resta il no-op di default, e nessuno di loro apre
 * connessioni.
 *
 * **Il riferimento vive su `globalThis`, non in un `let` di modulo.** Next
 * compila `instrumentation.ts` e i route handler in bundle separati: con una
 * variabile di modulo esisterebbero due copie di questo file, l'hook sarebbe
 * impostato solo in quella dello scheduler, e un'offerta arrivata via HTTP non
 * farebbe partire nessuno snapshot. È lo stesso motivo per cui lo scheduler sta
 * su `globalThis.__scheduler` (PLAN §16.8).
 */
type BroadcastHook = (auctionId: string) => void;

const processGlobals = globalThis as typeof globalThis & {
  __broadcastHook?: BroadcastHook;
};

export function setBroadcastHook(hook: BroadcastHook): void {
  processGlobals.__broadcastHook = hook;
}

export type LockOutcome<T> = {
  result: Result<T>;
  /** `true` se il corpo ha davvero scritto qualcosa: decide bump e broadcast. */
  mutated: boolean;
};

/**
 * **L'unico punto di serializzazione della concorrenza** (PLAN §6, regola 4):
 * ogni mutazione di un'asta avviata apre una transazione, prende il
 * `SELECT ... FOR UPDATE` sulla riga dell'asta e carica lo stato del motore.
 * Due azioni concorrenti sulla stessa asta si mettono in fila qui; con il
 * lock preso, non esistono race condition sul resto delle tabelle.
 *
 * `state_version` viene incrementata — e il broadcast parte, **dopo** il
 * commit — solo se il corpo dichiara una mutazione effettiva (⚠ P14): i no-op
 * dello sweep non producono né versioni né traffico.
 */
export async function withAuctionLock<T>(
  auctionId: string,
  fn: (tx: Tx, loaded: LoadedAuction) => Promise<LockOutcome<T>>,
): Promise<Result<T>> {
  const outcome = await db.transaction(async (tx) => {
    const [auction] = await tx
      .select()
      .from(auctions)
      .where(eq(auctions.id, auctionId))
      .for("update");
    if (!auction) {
      return {
        result: fail<T>("NOT_FOUND", "Questa asta non esiste."),
        mutated: false,
      };
    }

    const loaded = await loadAuctionState(tx, auction);
    const out = await fn(tx, loaded);
    if (out.mutated) {
      await tx
        .update(auctions)
        .set({ stateVersion: sql`${auctions.stateVersion} + 1` })
        .where(eq(auctions.id, auctionId));
    }
    return out;
  });

  if (outcome.mutated) processGlobals.__broadcastHook?.(auctionId);
  return outcome.result;
}

// ─── Tempo ───────────────────────────────────────────────────────────────────

function toMillis(d: Date): Millis;
function toMillis(d: Date | null): Millis | null;
function toMillis(d: Date | null): Millis | null {
  return d === null ? null : d.getTime();
}

function toDate(ms: Millis): Date;
function toDate(ms: Millis | null): Date | null;
function toDate(ms: Millis | null): Date | null {
  return ms === null ? null : new Date(ms);
}

// ─── Caricamento ─────────────────────────────────────────────────────────────

/** Le mappe id motore → uuid del ciclo corrente. I round sono `lotId:roundNo`. */
export type EngineRefs = {
  lots: Map<EngineId, string>;
  rounds: Map<string, string>;
  bids: Map<EngineId, string>;
  assignments: Map<EngineId, string>;
};

/**
 * Ciò che il motore non sa, e che serve a chi lo stato lo deve *mostrare*:
 * i nomi delle cose e la telemetria di presence.
 *
 * Il motore ragiona per membri, seat e id di giocatori — «Squadra Rossi» e
 * «Lautaro» non gli servono, e `last_seen_at` non è nemmeno stato-macchina
 * (⚠ P8: si scrive fuori dal lock). Tenerli fuori da `AuctionState` è ciò che
 * permette ai test puri di costruire uno stato con quattro campi; averli qui
 * accanto è ciò che permette a `serializeSnapshot` di essere l'unico punto di
 * uscita (regola 3) senza andarseli a ripescare da solo.
 */
export type MemberView = {
  teamName: string;
  displayName: string | null;
  lastSeenAt: Millis | null;
  isVisible: boolean;
};

export type PlayerView = { name: string; team: string };

export type AuctionView = {
  members: Map<string, MemberView>;
  players: Map<string, PlayerView>;
};

export type LoadedAuction = {
  auction: Auction;
  state: AuctionState;
  refs: EngineRefs;
  /** Nomi e presence, per la serializzazione. Il motore non li guarda mai. */
  view: AuctionView;
  /**
   * Chi è chi: l'utente autenticato → il suo `member_id` in quest'asta.
   * Il motore non conosce gli utenti (ragiona per membri e seat); la
   * traduzione è un fatto delle azioni, e la mappa nasce qui per non
   * rifare la query a ogni azione.
   */
  memberIdByUserId: Map<string, string>;
};

function roundKey(lotEngineId: EngineId, roundNo: number): string {
  return `${lotEngineId}:${roundNo}`;
}

/**
 * Costruisce l'`AuctionState` del motore dalle righe del database.
 *
 * Gli ordinamenti contano: membri per seat, giocatori per `ext_id`, lotti per
 * `seq`, offerte per `(created_at, id)` — così due load consecutivi dello
 * stesso database producono lo stesso identico stato, contatore compreso.
 */
export async function loadAuctionState(
  dbx: Dbx,
  auction: Auction,
): Promise<LoadedAuction> {
  const memberRows = await dbx
    .select({
      id: members.id,
      userId: members.userId,
      seatIndex: members.seatIndex,
      budgetInitial: members.budgetInitial,
      teamName: members.teamName,
      displayName: users.displayName,
      lastSeenAt: members.lastSeenAt,
      isVisible: members.isVisible,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.auctionId, auction.id))
    .orderBy(asc(members.seatIndex));

  const playerRows = await dbx
    .select({
      id: players.id,
      extId: players.extId,
      role: players.role,
      fvm: players.fvm,
      quot: players.quot,
      outOfList: players.outOfList,
      name: players.name,
      team: players.team,
    })
    .from(players)
    .where(eq(players.auctionId, auction.id))
    .orderBy(asc(players.extId));

  const lotRows = await dbx
    .select()
    .from(lots)
    .where(eq(lots.auctionId, auction.id))
    .orderBy(asc(lots.seq));

  const lotIds = lotRows.map((row) => row.id);
  const roundRows = lotIds.length
    ? await dbx
        .select()
        .from(lotRounds)
        .where(inArray(lotRounds.lotId, lotIds))
        .orderBy(asc(lotRounds.roundNo))
    : [];

  const roundIds = roundRows.map((row) => row.id);
  const eligibilityRows = roundIds.length
    ? await dbx
        .select({
          lotRoundId: roundEligibility.lotRoundId,
          memberId: roundEligibility.memberId,
          seatIndex: members.seatIndex,
        })
        .from(roundEligibility)
        .innerJoin(members, eq(members.id, roundEligibility.memberId))
        .where(inArray(roundEligibility.lotRoundId, roundIds))
        .orderBy(asc(members.seatIndex))
    : [];

  const bidRows = roundIds.length
    ? await dbx
        .select()
        .from(bids)
        .where(inArray(bids.lotRoundId, roundIds))
        .orderBy(asc(bids.createdAt), asc(bids.id))
    : [];

  const assignmentRows = await dbx
    .select()
    .from(assignments)
    .where(eq(assignments.auctionId, auction.id))
    .orderBy(asc(assignments.createdAt), asc(assignments.id));

  const ledgerRows = await dbx
    .select({ memberId: ledger.memberId, delta: ledger.delta })
    .from(ledger)
    .where(eq(ledger.auctionId, auction.id));

  const refs: EngineRefs = {
    lots: new Map(),
    rounds: new Map(),
    bids: new Map(),
    assignments: new Map(),
  };
  const lotEngineIdByUuid = new Map<string, EngineId>();
  let counter: EngineId = 1;

  const engineLots: EngineLot[] = lotRows.map((lotRow) => {
    const lotEngineId = counter++;
    refs.lots.set(lotEngineId, lotRow.id);
    lotEngineIdByUuid.set(lotRow.id, lotEngineId);

    const rounds: EngineLotRound[] = roundRows
      .filter((r) => r.lotId === lotRow.id)
      .map((roundRow) => {
        refs.rounds.set(roundKey(lotEngineId, roundRow.roundNo), roundRow.id);
        const roundBids: EngineBid[] = bidRows
          .filter((b) => b.lotRoundId === roundRow.id)
          .map((bidRow) => {
            const bidEngineId = counter++;
            refs.bids.set(bidEngineId, bidRow.id);
            return {
              id: bidEngineId,
              memberId: bidRow.memberId,
              amount: bidRow.amount,
              amountSetAt: toMillis(bidRow.amountSetAt),
              createdAt: toMillis(bidRow.createdAt),
              withdrawnAt: toMillis(bidRow.withdrawnAt),
            };
          });
        return {
          roundNo: roundRow.roundNo as 1 | 2,
          minAmount: roundRow.minAmount,
          startsAt: toMillis(roundRow.startsAt),
          endsAt: toMillis(roundRow.endsAt),
          closedAt: toMillis(roundRow.closedAt),
          eligibleMemberIds: eligibilityRows
            .filter((e) => e.lotRoundId === roundRow.id)
            .map((e) => e.memberId),
          bids: roundBids,
        };
      });

    return {
      id: lotEngineId,
      seq: lotRow.seq,
      playerId: lotRow.playerId,
      calledByMemberId: lotRow.calledByMemberId,
      autoCalled: lotRow.autoCalled,
      status: lotRow.status,
      currentRound: lotRow.currentRound as 1 | 2,
      winnerMemberId: lotRow.winnerMemberId,
      finalPrice: lotRow.finalPrice,
      openedAt: toMillis(lotRow.openedAt),
      resolvedAt: toMillis(lotRow.resolvedAt),
      rounds,
    };
  });

  const engineAssignments: EngineAssignment[] = assignmentRows.map((row) => {
    const engineId = counter++;
    refs.assignments.set(engineId, row.id);
    return {
      id: engineId,
      memberId: row.memberId,
      playerId: row.playerId,
      price: row.price,
      lotId: row.lotId === null ? null : (lotEngineIdByUuid.get(row.lotId) ?? null),
      source: row.source,
      createdAt: toMillis(row.createdAt),
      voidedAt: toMillis(row.voidedAt),
    };
  });

  const currentLotEngineId =
    auction.currentLotId === null
      ? null
      : (lotEngineIdByUuid.get(auction.currentLotId) ?? null);

  const state: AuctionState = {
    config: {
      seats: auction.seats,
      budgetDefault: auction.budgetDefault,
      bidSeconds: auction.bidSeconds,
      pickSeconds: auction.pickSeconds,
      tiePrepSeconds: auction.tiePrepSeconds,
      revealSeconds: auction.revealSeconds,
      slots: {
        P: auction.slotsP,
        D: auction.slotsD,
        C: auction.slotsC,
        A: auction.slotsA,
      },
      roleOrder: auction.roleOrder,
      includeOutOfList: auction.includeOutOfList,
    },
    status: auction.status,
    phase: auction.phase ?? null,
    currentRole: auction.currentRole ?? null,
    currentSeatIndex: auction.currentSeatIndex,
    currentLotId: currentLotEngineId,
    phaseDeadline: toMillis(auction.phaseDeadline),
    pausedAt: toMillis(auction.pausedAt),
    // `userId` non entra nello stato: il motore ragiona per membri e seat.
    members: memberRows.map(({ id, seatIndex, budgetInitial }) => ({
      id,
      seatIndex,
      budgetInitial,
    })),
    // Solo i campi del motore: `name` e `team` restano fuori, in `view`.
    players: playerRows.map(({ id, extId, role, fvm, quot, outOfList }) => ({
      id,
      extId,
      role,
      fvm,
      quot,
      outOfList,
    })),
    lots: engineLots,
    assignments: engineAssignments,
    ledger: ledgerRows,
    nextId: counter,
  };

  const view: AuctionView = {
    members: new Map(
      memberRows.map((m) => [
        m.id,
        {
          teamName: m.teamName,
          displayName: m.displayName,
          lastSeenAt: toMillis(m.lastSeenAt),
          isVisible: m.isVisible,
        },
      ]),
    ),
    players: new Map(playerRows.map((p) => [p.id, { name: p.name, team: p.team }])),
  };

  return {
    auction,
    state,
    refs,
    view,
    memberIdByUserId: new Map(memberRows.map((m) => [m.userId, m.id])),
  };
}

// ─── Persistenza ─────────────────────────────────────────────────────────────

async function insertBid(
  dbx: Dbx,
  refs: EngineRefs,
  roundUuid: string,
  bid: EngineBid,
): Promise<void> {
  const [row] = await dbx
    .insert(bids)
    .values({
      lotRoundId: roundUuid,
      memberId: bid.memberId,
      amount: bid.amount,
      amountSetAt: toDate(bid.amountSetAt),
      createdAt: toDate(bid.createdAt),
      withdrawnAt: toDate(bid.withdrawnAt),
    })
    .returning({ id: bids.id });
  refs.bids.set(bid.id, row.id);
}

async function insertRound(
  dbx: Dbx,
  refs: EngineRefs,
  lotEngineId: EngineId,
  round: EngineLotRound,
): Promise<void> {
  const lotUuid = refs.lots.get(lotEngineId);
  if (!lotUuid) throw new Error(`lotto ${lotEngineId} senza uuid`);
  const [row] = await dbx
    .insert(lotRounds)
    .values({
      lotId: lotUuid,
      roundNo: round.roundNo,
      minAmount: round.minAmount,
      startsAt: toDate(round.startsAt),
      endsAt: toDate(round.endsAt),
      closedAt: toDate(round.closedAt),
    })
    .returning({ id: lotRounds.id });
  refs.rounds.set(roundKey(lotEngineId, round.roundNo), row.id);

  if (round.eligibleMemberIds.length > 0) {
    await dbx.insert(roundEligibility).values(
      round.eligibleMemberIds.map((memberId) => ({
        lotRoundId: row.id,
        memberId,
      })),
    );
  }
  for (const bid of round.bids) {
    await insertBid(dbx, refs, row.id, bid);
  }
}

async function insertLot(
  dbx: Dbx,
  refs: EngineRefs,
  auctionId: string,
  lot: EngineLot,
): Promise<void> {
  const [row] = await dbx
    .insert(lots)
    .values({
      auctionId,
      seq: lot.seq,
      playerId: lot.playerId,
      calledByMemberId: lot.calledByMemberId,
      autoCalled: lot.autoCalled,
      status: lot.status,
      currentRound: lot.currentRound,
      winnerMemberId: lot.winnerMemberId,
      finalPrice: lot.finalPrice,
      openedAt: toDate(lot.openedAt),
      resolvedAt: toDate(lot.resolvedAt),
    })
    .returning({ id: lots.id });
  refs.lots.set(lot.id, row.id);

  for (const round of lot.rounds) {
    await insertRound(dbx, refs, lot.id, round);
  }
}

/**
 * Scrive sul database la differenza fra `loaded.state` e `next`.
 *
 * `now` serve solo ai due timestamp che il motore non tiene nello stato:
 * `started_at` (READY → LIVE) e `completed_at` (→ COMPLETED). Con `next`
 * identico per riferimento allo stato caricato non scrive niente (P14).
 *
 * Non tocca mai `ledger` né cancella righe: il motore in gioco crea lotti,
 * round, offerte e assegnazioni, e al più aggiorna i loro campi. Le
 * correzioni manuali (void, rettifiche) sono azioni di Fase 7, non
 * transizioni.
 */
export async function persistTransition(
  dbx: Dbx,
  loaded: LoadedAuction,
  next: AuctionState,
  now: Millis,
): Promise<void> {
  const prev = loaded.state;
  if (next === prev) return;
  const { refs, auction } = loaded;

  // Lotti, round, offerte — prima gli inserimenti, così le FK e la mappa
  // degli uuid sono pronte quando serve aggiornare `current_lot_id`.
  const prevLotById = new Map(prev.lots.map((l) => [l.id, l]));
  for (const lot of next.lots) {
    const prevLot = prevLotById.get(lot.id);
    if (!prevLot) {
      await insertLot(dbx, refs, auction.id, lot);
      continue;
    }
    if (lot === prevLot) continue;

    const lotUuid = refs.lots.get(lot.id);
    if (!lotUuid) throw new Error(`lotto ${lot.id} senza uuid`);
    const lotPatch: Partial<typeof lots.$inferInsert> = {};
    if (lot.status !== prevLot.status) lotPatch.status = lot.status;
    if (lot.currentRound !== prevLot.currentRound)
      lotPatch.currentRound = lot.currentRound;
    if (lot.winnerMemberId !== prevLot.winnerMemberId)
      lotPatch.winnerMemberId = lot.winnerMemberId;
    if (lot.finalPrice !== prevLot.finalPrice)
      lotPatch.finalPrice = lot.finalPrice;
    if (lot.resolvedAt !== prevLot.resolvedAt)
      lotPatch.resolvedAt = toDate(lot.resolvedAt);
    if (Object.keys(lotPatch).length > 0) {
      await dbx.update(lots).set(lotPatch).where(eq(lots.id, lotUuid));
    }

    const prevRoundByNo = new Map(prevLot.rounds.map((r) => [r.roundNo, r]));
    for (const round of lot.rounds) {
      const prevRound = prevRoundByNo.get(round.roundNo);
      if (!prevRound) {
        await insertRound(dbx, refs, lot.id, round);
        continue;
      }
      if (round === prevRound) continue;

      const roundUuid = refs.rounds.get(roundKey(lot.id, round.roundNo));
      if (!roundUuid) throw new Error(`round ${round.roundNo} senza uuid`);
      const roundPatch: Partial<typeof lotRounds.$inferInsert> = {};
      if (round.endsAt !== prevRound.endsAt)
        roundPatch.endsAt = toDate(round.endsAt);
      if (round.closedAt !== prevRound.closedAt)
        roundPatch.closedAt = toDate(round.closedAt);
      if (Object.keys(roundPatch).length > 0) {
        await dbx
          .update(lotRounds)
          .set(roundPatch)
          .where(eq(lotRounds.id, roundUuid));
      }

      const prevBidById = new Map(prevRound.bids.map((b) => [b.id, b]));
      for (const bid of round.bids) {
        const prevBid = prevBidById.get(bid.id);
        if (!prevBid) {
          await insertBid(dbx, refs, roundUuid, bid);
          continue;
        }
        if (bid === prevBid) continue;
        const bidUuid = refs.bids.get(bid.id);
        if (!bidUuid) throw new Error(`offerta ${bid.id} senza uuid`);
        await dbx
          .update(bids)
          .set({
            amount: bid.amount,
            amountSetAt: toDate(bid.amountSetAt),
            withdrawnAt: toDate(bid.withdrawnAt),
          })
          .where(eq(bids.id, bidUuid));
      }
    }
  }

  // Assegnazioni: il motore le crea; l'unico aggiornamento ammesso, mai
  // distruttivo, è `voided_at` (regola 5).
  const prevAssignmentById = new Map(prev.assignments.map((a) => [a.id, a]));
  for (const a of next.assignments) {
    const prevA = prevAssignmentById.get(a.id);
    if (!prevA) {
      const lotUuid = a.lotId === null ? null : (refs.lots.get(a.lotId) ?? null);
      const [row] = await dbx
        .insert(assignments)
        .values({
          auctionId: auction.id,
          memberId: a.memberId,
          playerId: a.playerId,
          price: a.price,
          lotId: lotUuid,
          source: a.source,
          createdAt: toDate(a.createdAt),
          voidedAt: toDate(a.voidedAt),
        })
        .returning({ id: assignments.id });
      refs.assignments.set(a.id, row.id);
      continue;
    }
    if (a === prevA) continue;
    const uuid = refs.assignments.get(a.id);
    if (!uuid) throw new Error(`assegnazione ${a.id} senza uuid`);
    await dbx
      .update(assignments)
      .set({ voidedAt: toDate(a.voidedAt) })
      .where(eq(assignments.id, uuid));
  }

  // La riga dell'asta, per ultima: `current_lot_id` può puntare a un lotto
  // appena inserito.
  const auctionPatch: Partial<typeof auctions.$inferInsert> = {};
  if (next.status !== prev.status) {
    auctionPatch.status = next.status;
    if (prev.status === "READY" && next.status === "LIVE") {
      auctionPatch.startedAt = toDate(now);
    }
    if (next.status === "COMPLETED") {
      auctionPatch.completedAt = toDate(now);
    }
  }
  if (next.phase !== prev.phase) auctionPatch.phase = next.phase;
  if (next.currentRole !== prev.currentRole)
    auctionPatch.currentRole = next.currentRole;
  if (next.currentSeatIndex !== prev.currentSeatIndex)
    auctionPatch.currentSeatIndex = next.currentSeatIndex;
  if (next.currentLotId !== prev.currentLotId) {
    auctionPatch.currentLotId =
      next.currentLotId === null
        ? null
        : (refs.lots.get(next.currentLotId) ?? null);
  }
  if (next.phaseDeadline !== prev.phaseDeadline)
    auctionPatch.phaseDeadline = toDate(next.phaseDeadline);
  if (next.pausedAt !== prev.pausedAt)
    auctionPatch.pausedAt = toDate(next.pausedAt);

  if (Object.keys(auctionPatch).length > 0) {
    await dbx
      .update(auctions)
      .set(auctionPatch)
      .where(eq(auctions.id, auction.id));
  }
}
