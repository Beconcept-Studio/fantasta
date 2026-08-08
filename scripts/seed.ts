/**
 * `pnpm db:seed` — popola il database di sviluppo.
 *
 * Il seed è **incrementale** attraverso le fasi (DECISIONS, P4/P5): crea i 12
 * utenti fittizi con cui funziona il provider `dev` e, su richiesta, un'asta a
 * 8 in qualunque stato — dalla Fase 3 anche `live`, `mid` e `completed`,
 * generati facendo girare il motore puro su un orologio virtuale (vedi
 * `fastForwardAuction` in fondo al file).
 *
 * **Non scrive righe a mano.** Passa dalle stesse funzioni che usa la UI —
 * `createAuction`, `importPlayers`, `createInvite`, `joinAuction` — così ciò che
 * il seed produce è per costruzione uno stato che l'applicazione sa produrre.
 * Un seed che inserisce righe artigianali è un seed che prima o poi fabbrica
 * stati impossibili, e ci si perde un pomeriggio a capire perché.
 *
 * È idempotente: rieseguirlo non duplica nulla. L'asta di prova viene rifatta da
 * zero a ogni esecuzione (`draft`/`ready`), così si riparte sempre da uno stato
 * noto.
 *
 *   pnpm db:seed
 *   pnpm db:seed --auction-status=ready
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { and, asc, eq, isNull } from "drizzle-orm";

import { db, pool } from "../lib/db";
import { auctions, events, users } from "../lib/db/schema";
import { transition } from "../lib/engine/machine";
import { persistTransition, withAuctionLock } from "../lib/engine/mutate";
import { credits, maxBid } from "../lib/engine/rules";
import {
  createAuction,
  createInvite,
  importPlayers,
  joinAuction,
} from "../lib/engine/setup";
import type { AuctionEvent, AuctionState, Millis } from "../lib/engine/types";

/** Gli stati d'asta generabili. Dalla Fase 3 il seed li sa produrre tutti. */
const KNOWN_AUCTION_STATUSES = [
  "draft",
  "ready",
  "live",
  "mid",
  "completed",
] as const;

/**
 * La base degli URL che il seed stampa a fine corsa.
 *
 * In locale è `http://localhost:3000`; **sul server è `AUTH_URL`**, che nel
 * `.env` di produzione c'è già. Senza questo, il seed di produzione stamperebbe
 * link a localhost — e il punto 2 della checklist pre-asta (§17) è proprio
 * "asta di prova sul server", quindi quei link vanno seguiti da un browser che
 * localhost non ce l'ha.
 *
 * `||` e non `??`: nel `.env` di sviluppo `AUTH_URL` **esiste ma è vuota** (in
 * locale Auth.js usa localhost da sé), e `??` lascerebbe passare la stringa
 * vuota stampando link mozzi.
 */
const BASE_URL = (process.env.AUTH_URL || "http://localhost:3000").replace(
  /\/$/,
  "",
);

const DEV_USERS = [
  "Marco Bianchi",
  "Luca Ferrari",
  "Andrea Russo",
  "Matteo Esposito",
  "Francesco Romano",
  "Alessandro Colombo",
  "Davide Ricci",
  "Simone Marino",
  "Giulia Greco",
  "Chiara Bruno",
  "Sara Gallo",
  "Elena Conti",
] as const;

const TEAM_NAMES = [
  "Real Fantozzi",
  "Atletico Divano",
  "Borussia Bar Sport",
  "Inter Nos",
  "Sporting Panchina",
  "Deportivo Rigore",
  "Bayern Cucina",
  "AC Rimonta",
  "Union Fuorigioco",
  "Olympique Traversa",
  "Racing Pallone",
  "Dinamo Spogliatoio",
] as const;

/** Il nome è la chiave dell'idempotenza: c'è al massimo un'asta di prova. */
const SEED_AUCTION_NAME = "Asta di prova";

/**
 * Timer corti (DECISIONS 2026-08-06): niente `DEV_TIME_SCALE`, nessun ramo di
 * codice che dipende dall'ambiente dentro la logica del tempo. Le aste di prova
 * nascono già veloci, il motore resta identico in dev e in produzione.
 */
const DEV_TIMERS = {
  bidSeconds: 3,
  pickSeconds: 3,
  tiePrepSeconds: 2,
  revealSeconds: 2,
};

const SEED_SEATS = 8;

const LISTONE = fileURLToPath(
  new URL("../fixtures/listone.xlsx", import.meta.url),
);

function parseArgs(argv: string[]): { auctionStatus: string | null } {
  let auctionStatus: string | null = null;

  for (const arg of argv) {
    // pnpm inoltra il `--` separatore così com'è: `pnpm db:seed -- --flag`.
    if (arg === "--") continue;

    const match = /^--auction-status=(.*)$/.exec(arg);
    if (match) {
      auctionStatus = match[1];
      continue;
    }
    if (arg === "--auction-status") {
      throw new Error("Usa --auction-status=<stato>, con l'uguale.");
    }
    throw new Error(`Argomento non riconosciuto: ${arg}`);
  }

  return { auctionStatus };
}

function checkAuctionStatus(auctionStatus: string): void {
  if (!(KNOWN_AUCTION_STATUSES as readonly string[]).includes(auctionStatus)) {
    throw new Error(
      `Stato d'asta sconosciuto: "${auctionStatus}". ` +
        `Attesi: ${KNOWN_AUCTION_STATUSES.join(", ")}.`,
    );
  }
}

function emailFor(displayName: string): string {
  const slug = displayName
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z]+/g, ".");
  return `${slug}@example.test`;
}

/**
 * I 12 utenti di prova. `google_sub` resta NULL: è ciò che li distingue da un
 * account Google vero ed è il filtro con cui la pagina di login costruisce la
 * lista "Entra come …".
 */
async function seedUsers(): Promise<{ created: number; ids: string[] }> {
  let created = 0;

  for (const displayName of DEV_USERS) {
    const email = emailFor(displayName);
    const existing = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (existing) {
      if (existing.displayName !== displayName) {
        await db
          .update(users)
          .set({ displayName })
          .where(eq(users.id, existing.id));
      }
      continue;
    }

    await db.insert(users).values({ displayName, email });
    created += 1;
  }

  const rows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(isNull(users.googleSub))
    .orderBy(asc(users.createdAt));

  // L'ordine è quello di DEV_USERS, non quello alfabetico: i posti dell'asta
  // devono essere sempre gli stessi fra un seed e l'altro.
  const byName = new Map(rows.map((row) => [row.displayName, row.id]));
  const ids = DEV_USERS.map((name) => byName.get(name)).filter(
    (id): id is string => id !== undefined,
  );

  return { created, ids };
}

function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/**
 * Un'asta a 8 con listone importato e tutti i posti pieni.
 *
 * Con `ready` la si lascia così: il ricalcolo DRAFT ↔ READY la porta da sé in
 * READY all'ultimo join. Con `draft` si toglie l'ultimo partecipante, che è
 * esattamente ciò che fa retrocedere lo stato — un modo di verificare, ogni
 * volta che si esegue il seed, che quella derivazione funzioni davvero.
 */
async function seedAuction(
  userIds: string[],
  status: "draft" | "ready" | AdvancedStatus,
): Promise<{ id: string; status: string; inviteUrl: string; publicToken: string }> {
  if (userIds.length < SEED_SEATS) {
    throw new Error(
      `Servono almeno ${SEED_SEATS} utenti di prova, ne ho trovati ${userIds.length}.`,
    );
  }

  const ownerId = userIds[0];

  // Si riparte da zero: l'asta di prova è usa e getta, e uno stato ereditato da
  // un seed precedente è la cosa più fastidiosa da diagnosticare.
  await db
    .delete(auctions)
    .where(
      and(eq(auctions.name, SEED_AUCTION_NAME), eq(auctions.ownerUserId, ownerId)),
    );

  const { auctionId } = unwrap(
    await createAuction(ownerId, {
      name: SEED_AUCTION_NAME,
      seats: SEED_SEATS,
      budgetDefault: 500,
      slots: { P: 3, D: 8, C: 8, A: 6 },
      roleOrder: ["P", "D", "C", "A"],
      ...DEV_TIMERS,
    }),
  );

  unwrap(await importPlayers(ownerId, auctionId, readFileSync(LISTONE)));

  const { token } = unwrap(await createInvite(ownerId, auctionId));

  // Tutti dentro tranne che per `draft`, dove un posto resta libero apposta.
  const joiners = status === "draft" ? SEED_SEATS - 1 : SEED_SEATS;
  for (let i = 0; i < joiners; i += 1) {
    unwrap(await joinAuction(userIds[i], token, TEAM_NAMES[i]));
  }

  if (status === "live" || status === "mid" || status === "completed") {
    await fastForwardAuction(auctionId, status);
  }

  const row = await db.query.auctions.findFirst({
    where: eq(auctions.id, auctionId),
  });

  return {
    id: auctionId,
    status: row!.status,
    publicToken: row!.publicToken,
    inviteUrl: `${BASE_URL}/join/${token}`,
  };
}

// ─── Stati avanzati: il motore gira davvero (F3-13) ──────────────────────────

type AdvancedStatus = "live" | "mid" | "completed";

function activeAssignments(state: AuctionState): number {
  return state.assignments.filter((a) => a.voidedAt === null).length;
}

/** Un importo casuale valido, con la coda schiacciata verso il minimo. */
function randomAmount(min: number, cap: number): number {
  const spread = Math.min(cap - min, 20);
  return min + Math.floor(Math.random() * Math.random() * (spread + 1));
}

function apply(state: AuctionState, event: AuctionEvent, now: Millis): AuctionState {
  const result = transition(state, event, now);
  if (!result.ok) {
    throw new Error(`simulazione: ${event.type} rifiutato — ${result.error.message}`);
  }
  return result.value;
}

/**
 * Gioca l'asta **in memoria** col motore puro e un orologio virtuale che
 * salta di deadline in deadline: duecento lotti costano millisecondi, non
 * i venti minuti dei timer veri. Nessun INSERT artigianale: ogni stato
 * intermedio è il risultato di una `transition`.
 *
 * Si ferma su un punto stabile: WAITING_PICK appena aperto (per `mid`),
 * o COMPLETED.
 */
function simulate(
  initial: AuctionState,
  target: AdvancedStatus,
): { state: AuctionState; endsAt: Millis } {
  let vnow: Millis = 0;
  let state = apply(initial, { type: "START", startSeatIndex: 0 }, vnow);
  if (target === "live") return { state, endsAt: vnow };

  const totalSlots =
    state.members.length *
    (state.config.slots.P +
      state.config.slots.D +
      state.config.slots.C +
      state.config.slots.A);
  const targetCount =
    target === "mid" ? Math.floor(totalSlots / 2) : totalSlots;

  while (state.status !== "COMPLETED") {
    switch (state.phase) {
      case "WAITING_PICK": {
        if (activeAssignments(state) >= targetCount) {
          return { state, endsAt: vnow };
        }
        // Ogni tanto il pick scade: auto-pick, come capiterà davvero.
        if (Math.random() < 0.05) {
          vnow = state.phaseDeadline!;
          state = apply(state, { type: "ADVANCE" }, vnow);
          break;
        }
        vnow += 500;
        const caller = state.members.find(
          (m) => m.seatIndex === state.currentSeatIndex,
        )!;
        const taken = new Set(
          state.assignments
            .filter((a) => a.voidedAt === null)
            .map((a) => a.playerId),
        );
        const pool = state.players.filter(
          (p) =>
            p.role === state.currentRole &&
            !taken.has(p.id) &&
            (state.config.includeOutOfList || !p.outOfList),
        );
        const player = pool[Math.floor(Math.random() * pool.length)];
        state = apply(
          state,
          { type: "PICK", memberId: caller.id, playerId: player.id },
          vnow,
        );
        break;
      }
      case "LOT_OPEN": {
        const lot = state.lots.find((l) => l.id === state.currentLotId)!;
        const round = lot.rounds[lot.rounds.length - 1];
        for (const memberId of round.eligibleMemberIds) {
          if (memberId === lot.calledByMemberId) continue;
          if (Math.random() > 0.5) continue;
          const cap = maxBid(state, memberId);
          if (cap < round.minAmount) continue;
          vnow += 50;
          if (vnow >= round.endsAt) break;
          state = apply(
            state,
            {
              type: "PLACE_BID",
              memberId,
              amount: randomAmount(round.minAmount, cap),
            },
            vnow,
          );
        }
        vnow = state.phaseDeadline!;
        state = apply(state, { type: "ADVANCE" }, vnow);
        break;
      }
      case "LOT_TIE_PREP":
      case "LOT_REVEAL": {
        vnow = state.phaseDeadline!;
        state = apply(state, { type: "ADVANCE" }, vnow);
        break;
      }
      default:
        throw new Error(`simulazione: fase inattesa ${state.phase}`);
    }
  }
  return { state, endsAt: vnow };
}

/** Trasla ogni timestamp dello stato di `delta` millisecondi. */
function shiftTimes(state: AuctionState, delta: number): AuctionState {
  const ms = (v: Millis | null) => (v === null ? null : v + delta);
  return {
    ...state,
    phaseDeadline: ms(state.phaseDeadline),
    pausedAt: ms(state.pausedAt),
    lots: state.lots.map((l) => ({
      ...l,
      openedAt: l.openedAt + delta,
      resolvedAt: ms(l.resolvedAt),
      rounds: l.rounds.map((r) => ({
        ...r,
        startsAt: r.startsAt + delta,
        endsAt: r.endsAt + delta,
        closedAt: ms(r.closedAt),
        bids: r.bids.map((b) => ({
          ...b,
          amountSetAt: b.amountSetAt + delta,
          createdAt: b.createdAt + delta,
          withdrawnAt: ms(b.withdrawnAt),
        })),
      })),
    })),
    assignments: state.assignments.map((a) => ({
      ...a,
      createdAt: a.createdAt + delta,
      voidedAt: ms(a.voidedAt),
    })),
  };
}

/**
 * Porta l'asta READY del seed allo stato avanzato richiesto.
 *
 * La simulazione corre su un orologio virtuale che parte da 0; prima di
 * persistere, **tutti** i timestamp vengono traslati così che l'ultima
 * transizione cada su "adesso": un'asta `mid` riparte con un countdown
 * pieno davanti, non con una deadline già scaduta. La persistenza è un'unica
 * `persistTransition` dentro `withAuctionLock` (regola 4) — la stessa diff
 * usata dalle azioni, solo con un salto più lungo.
 */
async function fastForwardAuction(
  auctionId: string,
  target: AdvancedStatus,
): Promise<void> {
  const outcome = await withAuctionLock(auctionId, async (tx, loaded) => {
    const { state: finalState, endsAt } = simulate(loaded.state, target);
    const delta = Date.now() - endsAt;

    const started = shiftTimes(
      apply(loaded.state, { type: "START", startSeatIndex: 0 }, 0),
      delta,
    );
    const finale = shiftTimes(finalState, delta);

    await persistTransition(tx, loaded, started, delta);
    await persistTransition(tx, { ...loaded, state: started }, finale, endsAt + delta);

    // La storia lotto-per-lotto non c'è (la simulazione persiste in blocco):
    // una riga la dichiara, così la query del runbook non trova il vuoto.
    await tx.insert(events).values({
      auctionId,
      type: "SEED_FAST_FORWARD",
      payload: {
        from: "READY",
        to: finale.phase === null ? finale.status : `${finale.status}/${finale.phase}`,
        lotId: null,
        actor: "seed",
      },
    });

    return { result: { ok: true as const, value: finale }, mutated: true };
  });
  if (!outcome.ok) throw new Error(outcome.error.message);
}

async function main(): Promise<void> {
  const { auctionStatus } = parseArgs(process.argv.slice(2));
  if (auctionStatus !== null) checkAuctionStatus(auctionStatus);

  const { created, ids } = await seedUsers();
  console.log(
    `Utenti: ${created} creati, ${ids.length} utenti di prova a database.`,
  );

  if (auctionStatus === null) {
    console.log(
      "Nessuna asta creata. Usa --auction-status=draft|ready per averne una.",
    );
    return;
  }

  const auction = await seedAuction(
    ids,
    auctionStatus as "draft" | "ready" | AdvancedStatus,
  );
  console.log(
    `Asta "${SEED_AUCTION_NAME}" creata: stato ${auction.status}, ` +
      `${SEED_SEATS} posti, listone importato.`,
  );
  console.log(`  Setup:  ${BASE_URL}/auctions/${auction.id}/setup`);
  console.log(`  Lobby:  ${BASE_URL}/auctions/${auction.id}/lobby`);
  console.log(`  TV:     ${BASE_URL}/tv/${auction.publicToken}`);
  console.log(`  Invito: ${auction.inviteUrl}`);
  console.log(`  Owner:  ${DEV_USERS[0]}`);
  console.log(`  Bot:    pnpm bots --auction=${auction.id} --count=8 --strategy=random --start --url=${BASE_URL}`);

  if (auctionStatus === "live" || auctionStatus === "mid" || auctionStatus === "completed") {
    await printRosterSummary(auction.id);
  }
}

/** Il riepilogo che rende verificabile a occhio la formula dei crediti (§3). */
async function printRosterSummary(auctionId: string): Promise<void> {
  const row = await db.query.auctions.findFirst({
    where: eq(auctions.id, auctionId),
  });
  if (!row) return;
  const { loadAuctionState } = await import("../lib/engine/mutate");
  const { state } = await loadAuctionState(db, row);
  console.log(`  Fase:   ${row.status}${row.phase ? `/${row.phase}` : ""}`);
  for (const m of state.members) {
    const roster = state.assignments.filter(
      (a) => a.memberId === m.id && a.voidedAt === null,
    );
    const c = credits(state, m.id);
    if (c < 0) throw new Error(`crediti negativi per il seat ${m.seatIndex}`);
    console.log(
      `  seat ${m.seatIndex}: ${roster.length} giocatori, ${c} crediti (max_bid ${maxBid(state, m.id)})`,
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error(`\n✗ ${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
