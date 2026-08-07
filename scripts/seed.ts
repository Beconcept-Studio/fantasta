/**
 * `pnpm db:seed` — popola il database di sviluppo.
 *
 * Il seed è **incrementale** attraverso le fasi (DECISIONS, P4/P5): oggi crea i
 * 12 utenti fittizi con cui funziona il provider `dev` e, su richiesta, un'asta
 * a 8 già configurata. Gli stati LIVE arrivano in Fase 3, quando esisterà il
 * motore che li sa generare davvero.
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
import { auctions, users } from "../lib/db/schema";
import {
  createAuction,
  createInvite,
  importPlayers,
  joinAuction,
} from "../lib/engine/setup";

/** Gli stati d'asta che il seed sa già generare. Si allunga a ogni fase. */
const SUPPORTED_AUCTION_STATUSES = ["draft", "ready"];

const KNOWN_AUCTION_STATUSES = [
  "draft",
  "ready",
  "live",
  "mid",
  "completed",
] as const;

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
  if (!SUPPORTED_AUCTION_STATUSES.includes(auctionStatus)) {
    throw new Error(
      `--auction-status=${auctionStatus} non è ancora supportato: le aste già ` +
        `avviate le genera la Fase 3, facendo girare il motore. ` +
        `Per ora funzionano "draft" e "ready".`,
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
  status: "draft" | "ready",
): Promise<{ id: string; status: string; inviteUrl: string }> {
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

  const joiners = status === "ready" ? SEED_SEATS : SEED_SEATS - 1;
  for (let i = 0; i < joiners; i += 1) {
    unwrap(await joinAuction(userIds[i], token, TEAM_NAMES[i]));
  }

  const row = await db.query.auctions.findFirst({
    where: eq(auctions.id, auctionId),
  });

  return {
    id: auctionId,
    status: row!.status,
    inviteUrl: `http://localhost:3000/join/${token}`,
  };
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

  const auction = await seedAuction(ids, auctionStatus as "draft" | "ready");
  console.log(
    `Asta "${SEED_AUCTION_NAME}" creata: stato ${auction.status}, ` +
      `${SEED_SEATS} posti, listone importato.`,
  );
  console.log(`  Setup:  http://localhost:3000/auctions/${auction.id}/setup`);
  console.log(`  Lobby:  http://localhost:3000/auctions/${auction.id}/lobby`);
  console.log(`  Invito: ${auction.inviteUrl}`);
  console.log(`  Owner:  ${DEV_USERS[0]}`);
}

main()
  .catch((error: unknown) => {
    console.error(`\n✗ ${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
