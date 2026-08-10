import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

import { type Result, fail, ok } from "./errors";

/**
 * Le password, custodite con `crypto.scrypt` (M5 §5).
 *
 * **Niente dipendenze nuove**: `scrypt` sta nella libreria standard di Node.
 * E la ragione per cui non è `bcryptjs` è il processo unico di questa app.
 * `bcryptjs` è JavaScript puro: mezzo secondo di CPU per hash, che l'event loop
 * si mangia a fette. `crypto.scrypt` è nativo e **asincrono** — gira sul
 * threadpool di libuv, quindi non blocca il loop. In un'app che tiene aperti
 * dodici stream SSE mentre scorre un countdown, mezzo secondo di loop bloccato
 * è mezzo secondo in cui nessuno riceve uno snapshot.
 *
 * Questo file non tocca il database e non ha bisogno di `now`: sta in
 * `lib/engine` per stare accanto ad `accounts.ts`, che lo chiama.
 */

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * N=2^15, r=8, p=1: circa 32 MB e un decimo di secondo per hash su una CX22.
 *
 * N=2^16 sarebbe più robusto e costerebbe 64 MB per ogni hash concorrente: con
 * il rate limit di `lib/rate-limit.ts` davanti al login, 2^15 è la misura
 * giusta per una macchina da 2 vCPU e 4 GB.
 */
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;

/**
 * `maxmem` va **alzato a mano**: il default di Node è esattamente 32 MB, cioè
 * al pelo di ciò che questi parametri chiedono (`128 · N · r`), e al pelo di un
 * limite è dove si finisce fuori. Il doppio non alloca il doppio — è un tetto,
 * non una prenotazione.
 */
const MAXMEM = 128 * N * R * 2;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

/**
 * La politica: **lunghezza e basta**, fra 10 e 200 caratteri.
 *
 * Nessuna regola di composizione: è la raccomandazione corrente (la lunghezza
 * vale più dei simboli obbligatori) ed è una cosa in meno contro cui combattere
 * alle 21:00, in piedi accanto alla TV, dal telefono di qualcun altro. Il
 * massimo non difende da niente se non da sé stesso: limita l'input che diamo a
 * scrypt, che su una stringa da un megabyte ci penserebbe parecchio.
 */
export function validatePassword(value: unknown): Result<string> {
  if (typeof value !== "string") {
    return fail("INVALID_PASSWORD", "Scrivi una password.");
  }
  if (value.length < PASSWORD_MIN) {
    return fail(
      "INVALID_PASSWORD",
      `La password deve avere almeno ${PASSWORD_MIN} caratteri.`,
    );
  }
  if (value.length > PASSWORD_MAX) {
    return fail(
      "INVALID_PASSWORD",
      `La password non può superare i ${PASSWORD_MAX} caratteri.`,
    );
  }
  return ok(value);
}

/**
 * `scrypt$N$r$p$salt$hash`, con salt e hash in base64.
 *
 * I parametri viaggiano **col valore** e non in una costante di questo file:
 * alzarli domani non invalida gli hash di ieri, perché `verifyPassword` rilegge
 * dalla stringa quelli con cui l'hash è stato prodotto.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM,
  });
  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Confronto con `timingSafeEqual`, **mai** con `===`.
 *
 * Un `===` su due Buffer esce al primo byte diverso, e quel tempo si misura:
 * è il modo in cui un hash si ricostruisce un byte alla volta. Qui il costo è
 * zero, quindi non c'è nessuna ragione di scegliere la versione fragile.
 *
 * Ritorna `false` — e non lancia — su qualunque stringa malformata: un hash
 * illeggibile è una password che non entra, non un 500 in faccia a chi prova
 * a fare login.
 */
export async function verifyPassword(
  password: string,
  stored: string | null,
): Promise<boolean> {
  if (!stored) return false;

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  // Un `N` arbitrario letto da database sarebbe un modo di far allocare
  // gigabyte a chi controlla quella colonna. Non è una minaccia reale — chi
  // scrive lì dentro ha già vinto — ma il tetto costa una riga.
  if (n > 2 ** 20 || r > 32 || p > 16) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = await scrypt(password, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: Math.max(MAXMEM, 128 * n * r * 2),
    });
  } catch {
    return false;
  }

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
