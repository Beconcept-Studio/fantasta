import { config } from "dotenv";
import { afterEach, beforeEach, vi } from "vitest";

/**
 * I test che toccano il database leggono `DATABASE_URL` dal `.env` come tutto
 * il resto del progetto. `dotenv` non sovrascrive quello che c'è già, quindi in
 * CI basta esportare la variabile per puntare altrove.
 */
config({ path: ".env", quiet: true });

/**
 * Fake timers per default in **tutti** i test (PLAN §16.7).
 *
 * Il motore dell'asta è fatto di scadenze; un test che aspetta davvero mezzo
 * secondo è un test che prima o poi diventa flaky su una macchina lenta. Qui i
 * timer sono finti dall'inizio, quindi `vi.advanceTimersByTime()` è l'unico
 * modo di far passare il tempo e nessun `sleep` reale può infilarsi.
 *
 * Un test che ha davvero bisogno del tempo vero chiama `vi.useRealTimers()`
 * al proprio interno: la scelta resta esplicita e locale.
 */
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
