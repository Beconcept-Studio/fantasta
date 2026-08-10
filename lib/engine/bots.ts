import { asc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { type User, users } from "@/lib/db/schema";

/**
 * I partecipanti simulati (M4).
 *
 * Qui vive tutto ciò che riguarda i bot **dentro l'applicazione**: le loro
 * identità, e — da M4-08 — il tick che li fa muovere. Le loro *decisioni* stanno
 * invece in `bot-brain.ts`, che è puro e non sa che esista un database: è quella
 * separazione a rendere il comportamento collaudabile senza Postgres, e a
 * garantire che un bot veda soltanto uno `Snapshot` redatto (I8).
 */

/**
 * I dodici bot, con nomi in ordine alfabetico perché così l'ordine dei posti si
 * legge a colpo d'occhio in lobby.
 *
 * Sono un **pool fisso** e non utenti usa-e-getta: `users` non cresce a ogni
 * prova, e da un'asta all'altra ritrovi le stesse facce. Dodici perché è il
 * taglio massimo di partecipanti, e perché l'owner può condurre senza giocare
 * (⚠ P11) — in quel caso i posti da riempire sono tutti.
 *
 * ⚠ Niente virgole né virgolette: questi nomi diventano anche nomi squadra, e
 * `validateTeamName` li rifiuterebbe (M3 §2).
 */
export const BOT_NAMES = [
  "Bot Ada",
  "Bot Bruno",
  "Bot Carla",
  "Bot Dario",
  "Bot Elsa",
  "Bot Furio",
  "Bot Gina",
  "Bot Ivo",
  "Bot Lea",
  "Bot Nino",
  "Bot Olga",
  "Bot Piero",
] as const;

/**
 * Una chiave arbitraria ma stabile per il lock consultivo: serve solo a non
 * collidere con altri usi futuri di `pg_advisory_xact_lock`.
 */
const BOT_USERS_LOCK = 4212;

/**
 * Crea i bot che mancano e non tocca quelli che ci sono. Idempotente: si può
 * chiamare a ogni riempimento senza pensarci.
 *
 * La chiama il primo riempimento **e** il seed. Se la chiamasse solo il seed,
 * in produzione servirebbe un comando a mano sul server — cioè esattamente la
 * cosa che questa macro esiste per togliere.
 *
 * Il lock consultivo copre il caso in cui due riempimenti di **aste diverse**
 * partano insieme: `withSetupLock` serializza le mutazioni della stessa asta,
 * non due aste distinte, e senza questa riga la finestra fra il `SELECT` e
 * l'`INSERT` produrrebbe ventiquattro bot invece di dodici. Costa una riga e si
 * rilascia da sé a fine transazione.
 */
export async function ensureBotUsers(): Promise<User[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BOT_USERS_LOCK})`);

    const existing = await tx
      .select()
      .from(users)
      .where(eq(users.isBot, true))
      .orderBy(asc(users.displayName));

    const have = new Set(existing.map((row) => row.displayName));
    const missing = BOT_NAMES.filter((name) => !have.has(name));
    if (missing.length === 0) return existing;

    // `email` resta nullo di proposito: un bot non è raggiungibile, e un
    // indirizzo finto in quella colonna sarebbe solo un modo di confonderlo con
    // una persona. `google_sub` nullo per la stessa ragione.
    await tx
      .insert(users)
      .values(missing.map((displayName) => ({ displayName, isBot: true })));

    return tx
      .select()
      .from(users)
      .where(eq(users.isBot, true))
      .orderBy(asc(users.displayName));
  });
}
