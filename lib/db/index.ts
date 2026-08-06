import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

/**
 * Unica connessione al database dell'applicazione.
 *
 * In dev l'HMR rivaluta questo modulo a ogni salvataggio: senza la cache su
 * `globalThis` si accumulerebbe un Pool per ricompilazione finché Postgres
 * rifiuta le connessioni. È lo stesso motivo per cui lo scheduler avrà una
 * guardia singleton (PLAN §16.8).
 */
const globalForDb = globalThis as unknown as { __pool?: Pool };

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL non è impostata. Copia .env.example in .env (vedi docs/RUNBOOK.md).",
    );
  }
  return url;
}

export const pool =
  globalForDb.__pool ?? new Pool({ connectionString: connectionString() });

if (process.env.NODE_ENV !== "production") globalForDb.__pool = pool;

export const db = drizzle(pool, { schema });

export { schema };
