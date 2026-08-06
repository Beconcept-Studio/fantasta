/**
 * `pnpm db:seed` — popola il database di sviluppo.
 *
 * Il seed è **incrementale** attraverso le fasi (DECISIONS, P4/P5): in Fase 0
 * crea solo i 12 utenti fittizi con cui funziona il provider `dev`. Il listone
 * arriva in Fase 1, le aste LIVE in Fase 3. Il flag `--auction-status` esiste
 * già e per ora rifiuta con un messaggio chiaro gli stati non ancora
 * generabili, così il comando documentato in CLAUDE.md non cambia forma più
 * avanti.
 *
 * È idempotente: rieseguirlo non duplica nulla.
 *
 *   pnpm db:seed
 *   pnpm db:seed --auction-status=ready
 */
import { eq, isNull } from "drizzle-orm";

import { db, pool } from "../lib/db";
import { users } from "../lib/db/schema";

/** Gli stati d'asta che il seed sa già generare. Si allunga a ogni fase. */
const SUPPORTED_AUCTION_STATUSES: string[] = [];

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
      `--auction-status=${auctionStatus} non è ancora supportato: il seed delle ` +
        `aste arriva in Fase 1 (draft, ready) e in Fase 3 (live, mid, completed). ` +
        `Per ora "pnpm db:seed" crea solo gli utenti.`,
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
async function seedUsers(): Promise<{ created: number; total: number }> {
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

  const total = await db.select().from(users).where(isNull(users.googleSub));
  return { created, total: total.length };
}

async function main(): Promise<void> {
  const { auctionStatus } = parseArgs(process.argv.slice(2));
  if (auctionStatus !== null) checkAuctionStatus(auctionStatus);

  const { created, total } = await seedUsers();
  console.log(
    `Seed completato: ${created} utenti creati, ${total} utenti di prova a database.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(`\n✗ ${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
