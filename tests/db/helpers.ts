import { inArray } from "drizzle-orm";

import { db, pool } from "@/lib/db";
import { auctions, users } from "@/lib/db/schema";
import { advancePhase } from "@/lib/engine/actions";
import { createScheduler } from "@/lib/engine/scheduler";

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

/**
 * Un utente usa e getta, distinguibile dal seed perché ha un `google_sub`.
 *
 * ⚠ **Nasce non verificato** (`email_verified_at` nullo): dalla scala di M5 non
 * passerebbe. Non è una svista — questi utenti non attraversano `requireUser()`,
 * perché i test chiamano il motore con un `userId` in mano. Chi ha bisogno di
 * una riga verificata la chiede, e chi collauda la verifica forzata di M6 ha
 * bisogno del contrario: che il default sia non verificato.
 */
export async function makeUser(
  label = "test",
  options: {
    isAdmin?: boolean;
    isPro?: boolean;
    statsPlus?: boolean;
    verified?: boolean;
  } = {},
): Promise<string> {
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
      isAdmin: options.isAdmin ?? false,
      // ⚠ Il default è **senza** permessi, come per `isAdmin`: chi collauda un
      // gate ha bisogno che la riga di partenza non lo passi.
      isPro: options.isPro ?? false,
      statsPlus: options.statsPlus ?? false,
      emailVerifiedAt: options.verified === true ? new Date() : null,
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

/**
 * Uno sweep **vero**, che però fa avanzare **solo l'asta di questo test**.
 *
 * ⚠ **`sweep()` è globale e i file di test girano in parallelo.** La query è
 * quella vera — «tutte le aste `LIVE` con la deadline scaduta», che è il pezzo
 * di boot recovery da collaudare — ma passargli `advancePhase` nudo vuol dire
 * mandare avanti **le aste degli altri file**, e anche quelle che stanno nel
 * database di sviluppo e non c'entrano niente coi test. Filtrando l'`advance` la
 * query resta vera e il vicinato resta in pace.
 *
 * ⚠ **È il terzo chiamante, ed è per questo che adesso vive qui.** La toppa
 * nasce in `cancello.test.ts` (M14), che l'aveva già diagnosticata per esteso:
 * `scheduler.test.ts` si vedeva rosso — «expected [] to include …» — per colpa
 * di un altro file, e chi trovava quel rosso andava a cercare un bug dello
 * scheduler, che è il posto sbagliato. Poi è servita in `snapshot.test.ts`
 * (M22), e poi si è scoperto che serviva **anche a `scheduler.test.ts`**, che
 * dell'inconveniente era la vittima dichiarata e ne era pure una causa. Tre
 * copie della stessa cautela sono tre posti in cui la prossima si dimentica.
 *
 * **Se scrivi un test che chiama `sweep()` o `bootRecovery()`, usa questo.**
 */
export function sweeperFor(auctionId: string) {
  return createScheduler(async (id) => {
    if (id === auctionId) await advancePhase(id);
  });
}
