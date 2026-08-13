import type { Millis } from "./types";

/**
 * Quando è il momento di richiedere una fonte pubblica — come **funzione pura**
 * (M11 §3).
 *
 * Sta in un file separato da `insight-refresh.ts` per la stessa ragione per cui
 * `setup-rules.ts` sta separato da `setup.ts` e `rules.ts` da `actions.ts`:
 * quello importa il database e non si può provare senza un Postgres acceso,
 * questo si prova in millisecondi passando un numero e leggendo un verdetto. È la
 * riga che divide ciò che si può collaudare senza il mondo da ciò che no — e qui
 * dentro c'è la decisione che, sbagliata, **non si vede in locale**: si vede su
 * un sito di terzi, come novantasei richieste al giorno.
 *
 * Nessun `Date.now()`: il tempo arriva come parametro (regola 2).
 */

const HOUR = 60 * 60 * 1000;

/** A fonte sana, un giro al giorno. Un dato di mercato non cambia più spesso. */
export const REFRESH_EVERY_MS = 24 * HOUR;

/**
 * L'attesa dopo l'n-esimo fallimento di fila: 1h, 2h, 4h, 8h, 16h, poi 24h per
 * sempre.
 *
 * ⚠ **È la riga che protegge un sito che non è nostro.** Senza backoff, una fonte
 * giù per un giorno significherebbe un tentativo ogni quindici minuti, cioè
 * novantasei richieste al giorno per non riuscire novantasei volte. Costa una
 * riga e vale un ordine di grandezza in educazione.
 *
 * Si ferma a 24h e non cresce oltre perché sopra il giorno il backoff smette di
 * proteggere qualcuno e comincia solo a ritardare la ripresa: una fonte tornata
 * su dopo tre giorni di guasto deve rientrare entro il giorno, non entro la
 * settimana.
 */
export const BACKOFF_MS: readonly Millis[] = [
  1 * HOUR,
  2 * HOUR,
  4 * HOUR,
  8 * HOUR,
  16 * HOUR,
  24 * HOUR,
];

/**
 * L'ultimo tentativo, ridotto alle tre cose che decidono.
 *
 * ⚠ È **il tentativo**, non il successo: `attemptedAt` è `source_runs.attempted_at`
 * e non `player_insights.listone_updated_at`. La differenza è tutta la spec.
 */
export type LastAttempt = {
  attemptedAt: Millis;
  ok: boolean;
  /** Fallimenti consecutivi, `0` dopo un successo. */
  failures: number;
};

/** Quanto si aspetta dopo *questo* tentativo, prima di rifarne un altro. */
export function waitAfter(last: LastAttempt): Millis {
  if (last.ok) return REFRESH_EVERY_MS;
  // `failures` è ≥ 1 su una riga fallita, ma un dato storto non deve produrre
  // un'attesa negativa né un `undefined`: si stringe dentro la scala.
  const step = Math.min(Math.max(last.failures, 1), BACKOFF_MS.length);
  return BACKOFF_MS[step - 1];
}

/** Il primo istante in cui ha senso riprovare. */
export function nextAttemptAt(last: LastAttempt): Millis {
  return last.attemptedAt + waitAfter(last);
}

/**
 * Si prova adesso?
 *
 * ⚠ **Nessun tentativo registrato → sì, subito.** È lo stato in cui la tabella
 * nasce in produzione, e il primo tick utile deve riempirla: «non ho mai provato»
 * non è «ho provato adesso».
 */
export function shouldAttempt(last: LastAttempt | null, now: Millis): boolean {
  if (last === null) return true;
  return now >= nextAttemptAt(last);
}
