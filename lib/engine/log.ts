import { asc, eq, inArray } from "drizzle-orm";

import {
  type AuctionLog,
  type LogEvent,
  type LogLot,
  type LogRound,
  describeEvent,
  isNotableEvent,
  isPublicLot,
  lotSearchText,
} from "@/lib/auction-log";
import { db } from "@/lib/db";
import { auctions, events, users } from "@/lib/db/schema";

import { type Result, fail, ok } from "./errors";
import { isUuid } from "./ids";
import { type LoadedAuction, loadAuctionState } from "./mutate";
import { resolveRound } from "./rules";
import type { Lot, LotRound, Millis } from "./types";

/**
 * Lo storico di un'asta (M3): cosa è successo, e come lo dimostro.
 *
 * Serve a una cosa sola, e la sera in cui servirà non ci sarà tempo di
 * spiegarla: qualcuno dirà «io avevo offerto 46, non 45», e questa è la pagina
 * che risponde senza aprire `psql`.
 *
 * **Non scrive query sui lotti.** `loadAuctionState` carica già lotti, round,
 * buste, assegnazioni e i nomi, ed è ciò che `loadForSnapshot` fa a ogni
 * broadcast: rifarne quattro a mano qui vorrebbe dire mantenerne due copie. Il
 * lock non serve — la regola 4 vieta di **mutare** fuori dal lock, non di
 * leggere — e l'unica query propria è quella su `events`.
 *
 * ⚠ **Non è uno snapshot e non deve diventarlo** (regola 3). `serializeSnapshot`
 * resta l'unico punto da cui esce lo *stato* dell'asta; qui esce la sua
 * *storia*, che è un'altra cosa: non viaggia sullo stream, non ha un
 * `stateVersion`, e la pagina che la mostra è renderizzata dal server a ogni
 * caricamento. Se un giorno qualcuno volesse mandare lo storico sullo stream,
 * la risposta è no: la storia di un'asta non ha nulla da ricevere in diretta.
 */

// ─── La barriera I8 ──────────────────────────────────────────────────────────

/**
 * **I8: qui i lotti diventano dati da mostrare, e qui si decide quali** (M3 §5).
 *
 * Il predicato sta in `lib/auction-log.ts` perché lì è puro e si può provare su
 * un lotto costruito a mano — vedi il commento di `isPublicLot`, che racconta
 * perché quella prova è servita davvero.
 *
 * ⚠ Non spostare questo filtro nella pagina, e non sostituirlo con un controllo
 * sulla fase dell'asta: una riga in meno di qui è una busta che trapela, e in
 * un'asta a busta chiusa una busta che trapela non è un bug — è l'asta rifatta.
 */
function publicLots(loaded: LoadedAuction): Lot[] {
  return loaded.state.lots.filter(isPublicLot);
}

// ─── Tempo ───────────────────────────────────────────────────────────────────

function iso(ms: Millis): string;
function iso(ms: Millis | null): string | null;
function iso(ms: Millis | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

// ─── I lotti ─────────────────────────────────────────────────────────────────

/**
 * Com'è finito un round, in italiano.
 *
 * Chi vince lo decide `resolveRound` — la stessa funzione che ha deciso l'asta
 * quella sera. Qui si aggiunge soltanto il **conteggio** dei pari-merito, che
 * serve alle parole («stallo») e non alla decisione: contare non è ridecidere.
 * Se il verdetto fosse ricalcolato a mano, questa pagina e il motore
 * racconterebbero due storie diverse dello stesso lotto, e a quel punto
 * nessuna delle due servirebbe a chiudere una disputa.
 */
function outcomeText(round: LotRound): string {
  const active = round.bids.filter((b) => b.withdrawnAt === null);
  // Una pagina non va in 500 per una stranezza storica: `resolveRound`
  // solleverebbe, e un round senza buste attive non dovrebbe esistere.
  if (active.length === 0) return "nessuna busta attiva";

  const outcome = resolveRound(round);
  if (outcome.kind === "TIE") {
    return `pareggio a ${outcome.amount}, si spareggia`;
  }
  const max = Math.max(...active.map((b) => b.amount));
  const tied = active.filter((b) => b.amount === max).length;
  return tied > 1
    ? `stallo a ${max}, vince la busta fissata prima`
    : `aggiudicato a ${outcome.bid.amount}`;
}

function serializeRound(loaded: LoadedAuction, round: LotRound): LogRound {
  const teamOf = (memberId: string) =>
    loaded.view.members.get(memberId)?.teamName ?? "una squadra";

  return {
    roundNo: round.roundNo,
    minAmount: round.minAmount,
    // Il numero e non i nomi: alla disputa serve la misura di quanti potevano
    // offrire, e l'elenco degli idonei si legge dalle buste stesse.
    eligibleCount: round.eligibleMemberIds.length,
    bids: [...round.bids]
      // Dal più alto: è l'ordine in cui si guarda un reveal.
      .sort((a, b) => b.amount - a.amount || a.amountSetAt - b.amountSetAt)
      .map((bid) => ({
        teamName: teamOf(bid.memberId),
        amount: bid.amount,
        amountSetAt: iso(bid.amountSetAt),
        withdrawnAt: iso(bid.withdrawnAt),
      })),
    outcome: outcomeText(round),
  };
}

function serializeLot(loaded: LoadedAuction, lot: Lot): LogLot | null {
  // ⚠ La **seconda rete** su I8, e va letta come tale: un lotto risolto ha
  // sempre vincitore e prezzo — l'apertura piazza l'auto-bid a 1 del chiamante,
  // quindi «lotto deserto» non esiste — mentre un lotto aperto non li ha ancora.
  // Quindi questa riga, da sola, escluderebbe già il lotto in contesa.
  //
  // Non è un motivo per togliere `publicLots`, ed è il contrario di quello che
  // sembra: le due protezioni si sovrappongono solo perché il motore non genera
  // mai uno stato che le separi, e contare su questa coincidenza vorrebbe dire
  // affidare I8 a un dettaglio di implementazione di `enterReveal` invece che a
  // una regola dichiarata.
  if (lot.winnerMemberId === null || lot.finalPrice === null) return null;

  const enginePlayer = loaded.state.players.find((p) => p.id === lot.playerId);
  if (!enginePlayer) return null;
  const playerView = loaded.view.players.get(lot.playerId);
  const teamOf = (memberId: string) =>
    loaded.view.members.get(memberId)?.teamName ?? "una squadra";

  const player = {
    name: playerView?.name ?? "",
    role: enginePlayer.role,
    team: playerView?.team ?? "",
  };
  const calledByTeamName = teamOf(lot.calledByMemberId);
  const winnerTeamName = teamOf(lot.winnerMemberId);

  return {
    seq: lot.seq,
    player,
    calledByTeamName,
    autoCalled: lot.autoCalled,
    winnerTeamName,
    price: lot.finalPrice,
    resolvedAt: iso(lot.resolvedAt ?? lot.openedAt),
    // Regola 5: il lotto **resta**, marcato. Lo storico non nasconde le
    // riassegnazioni — sono proprio quelle di cui si discute.
    voided: loaded.state.assignments.some(
      (a) => a.lotId === lot.id && a.voidedAt !== null,
    ),
    rounds: lot.rounds.map((round) => serializeRound(loaded, round)),
    searchText: lotSearchText({ seq: lot.seq, player, calledByTeamName, winnerTeamName }),
  };
}

// ─── Le correzioni e le pause ────────────────────────────────────────────────

/**
 * Gli eventi notevoli, resi in italiano, dal più recente.
 *
 * Le due query proprie di questo modulo — e sono **due di proposito**, non un
 * join. In `payload.actor` non c'è sempre un id utente: le transizioni decise
 * dal tempo scrivono `"system"`, il seed scrive `"seed"`, e un `->>'actor'`
 * castato a `uuid` dentro un join **solleverebbe** su quelle righe. Non
 * sarebbe un difetto estetico: la pagina andrebbe in 500 esattamente sulle
 * aste più interessanti, quelle in cui il tempo ha fatto scadere qualcosa.
 *
 * Quindi si leggono gli eventi, si tengono gli `actor` che *sembrano* uuid, e i
 * nomi si prendono con una seconda query. Il nome serve perché in una disputa
 * «chi» è metà della domanda, e un uuid non è una risposta.
 */
async function loadEvents(loaded: LoadedAuction): Promise<LogEvent[]> {
  const rows = await db
    .select({
      id: events.id,
      type: events.type,
      payload: events.payload,
      createdAt: events.createdAt,
    })
    .from(events)
    .where(eq(events.auctionId, loaded.auction.id))
    .orderBy(asc(events.id));

  const notable = rows.filter((row) => isNotableEvent(row.type));

  const actorIds = [
    ...new Set(
      notable
        .map((row) => (row.payload as Record<string, unknown> | null)?.actor)
        .filter((actor): actor is string => typeof actor === "string" && isUuid(actor)),
    ),
  ];
  const nameByUserId = new Map<string, string | null>();
  if (actorIds.length > 0) {
    const userRows = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, actorIds));
    for (const row of userRows) nameByUserId.set(row.id, row.displayName);
  }

  // uuid del lotto → numero del lotto, per «era del lotto #180». La mappa del
  // motore va nel verso opposto, quindi si gira.
  const seqByLotUuid = new Map<string, number>();
  for (const lot of loaded.state.lots) {
    const uuid = loaded.refs.lots.get(lot.id);
    if (uuid) seqByLotUuid.set(uuid, lot.seq);
  }

  return notable
    .map((row) => {
      const payload = (row.payload ?? null) as Record<string, unknown> | null;
      const lotId = typeof payload?.lotId === "string" ? payload.lotId : null;
      const actor = typeof payload?.actor === "string" ? payload.actor : null;
      return {
        id: row.id,
        at: row.createdAt.toISOString(),
        text: describeEvent({
          type: row.type,
          payload,
          lotSeq: lotId === null ? null : (seqByLotUuid.get(lotId) ?? null),
        }),
        actorName: actor === null ? null : (nameByUserId.get(actor) ?? null),
      };
    })
    .reverse();
}

// ─── La lettura ──────────────────────────────────────────────────────────────

/**
 * Lo storico di un'asta, per chi ci partecipa.
 *
 * **Owner e membri** (M3 §3). Chi non è né l'uno né l'altro prende un
 * `NOT_FOUND` e non un `FORBIDDEN`: l'esistenza di un'asta a cui non partecipi
 * non è una tua informazione.
 */
export async function getAuctionLog(
  actorUserId: string,
  auctionId: string,
): Promise<Result<AuctionLog>> {
  if (!isUuid(auctionId)) {
    return fail("NOT_FOUND", "Questa asta non esiste.");
  }

  const auction = await db.query.auctions.findFirst({
    where: eq(auctions.id, auctionId),
  });
  if (!auction) return fail("NOT_FOUND", "Questa asta non esiste.");

  const loaded = await loadAuctionState(db, auction);
  const isOwner = auction.ownerUserId === actorUserId;
  const isMember = loaded.memberIdByUserId.has(actorUserId);
  if (!isOwner && !isMember) {
    return fail("NOT_FOUND", "Questa asta non esiste.");
  }

  const lots = publicLots(loaded) // ⚠ I8 — vedi `publicLots`
    .map((lot) => serializeLot(loaded, lot))
    .filter((lot): lot is LogLot => lot !== null)
    // Dal più recente: in una disputa si parla di ciò che è appena successo.
    .reverse();

  return ok({
    auctionName: auction.name,
    status: loaded.state.status,
    readAt: new Date().toISOString(),
    lots,
    events: await loadEvents(loaded),
  });
}
