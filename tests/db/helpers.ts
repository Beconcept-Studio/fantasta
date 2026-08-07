import { inArray } from "drizzle-orm";

import { db, pool } from "@/lib/db";
import { auctions, users } from "@/lib/db/schema";

/**
 * Aiuti per i test che parlano con Postgres vero.
 *
 * Perché non mockare il database: metà di ciò che vogliamo verificare in Fase 1
 * *è* il database — l'unicità di `(auction_id, seat_index)`, la ricompattazione
 * dei seat sotto vincolo, il comportamento di `FOR UPDATE`. Un mock direbbe
 * sempre di sì.
 *
 * I test si puliscono da soli: ogni asta creata viene cancellata alla fine, e
 * la cascata su `auction_id` porta via membri, inviti e listone.
 */

export async function databaseAvailable(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  try {
    const client = await pool.connect();
    client.release();
    return true;
  } catch {
    return false;
  }
}

/** Un utente usa e getta, distinguibile dal seed perché ha un `google_sub`. */
export async function makeUser(label = "test"): Promise<string> {
  // Un uuid, non `Date.now()+contatore`: i file di test girano in worker
  // paralleli e due `makeUser` nello stesso millisecondo collidevano su
  // `users_google_sub_unique`.
  const tag = crypto.randomUUID();
  const [row] = await db
    .insert(users)
    .values({
      displayName: `Test ${label} ${tag}`,
      email: `${label}.${tag}@test.invalid`,
      googleSub: `test-sub-${tag}`,
    })
    .returning({ id: users.id });
  return row.id;
}

export async function dropAuctions(ids: string[]): Promise<void> {
  if (ids.length > 0) await db.delete(auctions).where(inArray(auctions.id, ids));
}

export async function dropUsers(ids: string[]): Promise<void> {
  if (ids.length > 0) await db.delete(users).where(inArray(users.id, ids));
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
