/**
 * `pnpm drive --auction=<id>` — gioca un'asta intera senza UI (F3-11).
 *
 * È il criterio ✅ della Fase 3: un'asta parte READY e arriva a COMPLETED
 * senza interventi. Il driver fa due cose, entrambe con i pezzi veri
 * dell'applicazione:
 *
 * - avvia **lo scheduler in-process** (`startScheduler(advancePhase)`): è lui
 *   a chiudere i round allo scadere dei timer, esattamente come farà il
 *   server. Il driver non chiama mai `advancePhase` da sé — se l'asta va
 *   avanti, è perché timer e sweep funzionano;
 * - impersona i partecipanti: chi è di turno chiama un giocatore a caso del
 *   ruolo corrente, gli idonei offrono importi casuali validi (round 2
 *   compreso, dove vale `min_amount`), ogni tanto qualcuno ritira o lascia
 *   scadere il pick per esercitare l'auto-pick.
 *
 * I rifiuti tipizzati (round chiuso mentre si stava per offrire, ecc.) sono
 * parte del gioco e vengono solo contati: il server è l'unica verità.
 */
import { asc, eq } from "drizzle-orm";

import { db, pool } from "../lib/db";
import { auctions, members } from "../lib/db/schema";
import {
  advancePhase,
  pickPlayer,
  placeBid,
  startAuction,
  withdrawBid,
} from "../lib/engine/actions";
import { loadAuctionState } from "../lib/engine/mutate";
import { maxBid } from "../lib/engine/rules";
import { startScheduler, stopScheduler } from "../lib/engine/scheduler";
import type { AuctionState } from "../lib/engine/types";

function parseArgs(argv: string[]): { auctionId: string } {
  let auctionId: string | null = null;
  for (const arg of argv) {
    if (arg === "--") continue;
    const match = /^--auction=(.+)$/.exec(arg);
    if (match) {
      auctionId = match[1];
      continue;
    }
    throw new Error(`Argomento non riconosciuto: ${arg}. Uso: pnpm drive --auction=<id>`);
  }
  if (!auctionId) throw new Error("Manca --auction=<id>.");
  return { auctionId };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/** Un importo valido: dal minimo del round, con una coda corta verso l'alto. */
function randomAmount(min: number, cap: number): number {
  const spread = Math.min(cap - min, 20);
  return min + Math.floor(Math.random() * Math.random() * (spread + 1));
}

let ignored = 0;

/** I rifiuti tipizzati sono fisiologici in un gioco concorrente: si contano. */
function swallow(result: { ok: boolean }): void {
  if (!result.ok) ignored += 1;
}

async function main(): Promise<void> {
  const { auctionId } = parseArgs(process.argv.slice(2));

  const auction = await db.query.auctions.findFirst({
    where: eq(auctions.id, auctionId),
  });
  if (!auction) throw new Error(`Asta ${auctionId} non trovata.`);
  if (!["READY", "LIVE", "PAUSED"].includes(auction.status)) {
    throw new Error(`L'asta è in stato ${auction.status}: serve READY o LIVE.`);
  }

  // Chi è chi: seat → utente, per impersonare il membro giusto.
  const memberRows = await db
    .select({ id: members.id, userId: members.userId, seatIndex: members.seatIndex })
    .from(members)
    .where(eq(members.auctionId, auctionId))
    .orderBy(asc(members.seatIndex));
  const userBySeat = new Map(memberRows.map((m) => [m.seatIndex, m.userId]));
  const userByMemberId = new Map(memberRows.map((m) => [m.id, m.userId]));

  // Il tempo lo fa scorrere lo scheduler, come in produzione.
  startScheduler(advancePhase);

  if (auction.status === "READY") {
    const started = await startAuction(auction.ownerUserId, auctionId, 0);
    if (!started.ok) throw new Error(started.error.message);
    console.log(`Asta avviata dal seat 0.`);
  }

  const startedAt = Date.now();
  const totalSlots = (auction.slotsP + auction.slotsD + auction.slotsC + auction.slotsA) * auction.seats;
  let lastSeq = 0;

  for (;;) {
    const row = await db.query.auctions.findFirst({
      where: eq(auctions.id, auctionId),
    });
    if (!row) throw new Error("asta sparita");
    if (row.status === "COMPLETED") break;
    if (row.status === "PAUSED") {
      await sleep(500);
      continue;
    }

    const { state } = await loadAuctionState(db, row);
    const resolved = state.lots.filter((l) => l.status === "RESOLVED").length;
    if (resolved > lastSeq) {
      lastSeq = resolved;
      if (resolved % 10 === 0) {
        console.log(`— ${resolved}/${totalSlots} lotti assegnati`);
      }
    }

    if (state.phase === "WAITING_PICK") {
      await actOnPick(auctionId, state, userBySeat);
    } else if (state.phase === "LOT_OPEN") {
      await actOnLot(auctionId, state, userByMemberId);
    }
    // LOT_TIE_PREP e LOT_REVEAL scorrono da soli, via scheduler.

    await sleep(150);
  }

  stopScheduler();
  const minutes = ((Date.now() - startedAt) / 60_000).toFixed(1);
  console.log(
    `\n✓ Asta COMPLETED: ${totalSlots} lotti in ${minutes} minuti ` +
      `(${ignored} azioni rifiutate dal server, com'è giusto).`,
  );
}

async function actOnPick(
  auctionId: string,
  state: AuctionState,
  userBySeat: Map<number, string>,
): Promise<void> {
  // Ogni tanto il chiamante "si distrae": il timeout deve fare l'auto-pick.
  if (Math.random() < 0.03) {
    await sleep(300);
    return;
  }
  const userId = userBySeat.get(state.currentSeatIndex!);
  if (!userId) throw new Error(`nessun utente al seat ${state.currentSeatIndex}`);

  const taken = new Set(
    state.assignments.filter((a) => a.voidedAt === null).map((a) => a.playerId),
  );
  const pool = state.players.filter(
    (p) =>
      p.role === state.currentRole &&
      !taken.has(p.id) &&
      (state.config.includeOutOfList || !p.outOfList),
  );
  if (pool.length === 0) return; // ci penserà l'auto-pick a dircelo
  swallow(await pickPlayer(userId, auctionId, pick(pool).id));
}

async function actOnLot(
  auctionId: string,
  state: AuctionState,
  userByMemberId: Map<string, string>,
): Promise<void> {
  const lot = state.lots.find((l) => l.id === state.currentLotId);
  if (!lot || lot.status !== "OPEN") return;
  const round = lot.rounds[lot.rounds.length - 1];

  for (const memberId of round.eligibleMemberIds) {
    const existing = round.bids.find((b) => b.memberId === memberId);
    if (existing?.withdrawnAt != null) continue;
    // Non tutti offrono, e non tutti subito: è un'asta, non una coda.
    if (Math.random() > 0.4) continue;

    const userId = userByMemberId.get(memberId);
    if (!userId) continue;

    // Un ritiro ogni tanto (mai il chiamante, mai nel round 2).
    if (
      existing &&
      memberId !== lot.calledByMemberId &&
      round.roundNo === 1 &&
      Math.random() < 0.05
    ) {
      swallow(await withdrawBid(userId, auctionId));
      continue;
    }

    const cap = maxBid(state, memberId);
    if (cap < round.minAmount) continue;
    swallow(await placeBid(userId, auctionId, randomAmount(round.minAmount, cap)));
  }
}

main()
  .catch((error: unknown) => {
    console.error(`\n✗ ${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    stopScheduler();
    void pool.end();
  });
