import { type Result, fail, ok } from "./errors";

/**
 * Le regole dei codici a sei cifre, come **funzioni pure** (M5 §4).
 *
 * Stanno in un file separato da `accounts.ts` per la stessa ragione per cui
 * `setup-rules.ts` sta separato da `setup.ts`: quello importa il database,
 * quindi non è collaudabile senza un Postgres acceso. Qui invece non c'è niente
 * da mockare — si passa una riga e un istante, si riceve un verdetto.
 *
 * ⚠ **`now` è un parametro, sempre.** Nessun `Date.now()` dentro queste
 * funzioni: è la regola 2 applicata per analogia, e serve a poter collaudare
 * «il codice è scaduto dopo quindici minuti» coi fake timer invece che con un
 * `sleep` di quindici minuti.
 */

// ─── Le quattro difese ───────────────────────────────────────────────────────

/**
 * Dieci minuti sono tirati se la posta arriva lenta, trenta sono generosi per
 * un segreto da sei cifre. Il numero finisce anche nel testo dell'email, quindi
 * cambiarlo qui lo cambia là.
 */
export const CODE_TTL_MINUTES = 15;
const CODE_TTL_MS = CODE_TTL_MINUTES * 60_000;

/**
 * È **questa** la sicurezza dello schema, non lo sha256 del codice: con cinque
 * prove per codice, indovinarne uno su un milione non si fa.
 */
export const MAX_ATTEMPTS = 5;

/**
 * Sessanta secondi fra due invii. Non per proteggere noi: per non trasformare
 * il server in un cannone di posta puntato sull'indirizzo di qualcuno — e per
 * non bruciare la quota MailerSend in un pomeriggio.
 */
export const RESEND_COOLDOWN_SECONDS = 60;
const RESEND_COOLDOWN_MS = RESEND_COOLDOWN_SECONDS * 1000;

/** Sei cifre: un milione di possibilità, che i cinque tentativi rendono un muro. */
export const CODE_DIGITS = 6;

// ─── Il verdetto su un codice ────────────────────────────────────────────────

/**
 * Ciò che serve sapere di una riga di `email_codes` per decidere. È una forma
 * strutturale e non il tipo `EmailCode`: così questo file non importa nulla,
 * e i test lo chiamano con oggetti scritti a mano.
 */
export type CodeRow = {
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
};

/** Quando scade un codice emesso ora. */
export function codeExpiresAt(now: Date): Date {
  return new Date(now.getTime() + CODE_TTL_MS);
}

/**
 * Il codice si può ancora provare?
 *
 * L'ordine dei rifiuti è quello in cui una persona li capisce: prima «non ce
 * n'è uno» (o è già stato usato), poi «è scaduto», poi «l'hai sbagliato troppe
 * volte». **Nessuno dei tre è un vicolo cieco**: ognuno di questi messaggi
 * convive con il pulsante che ne fa mandare un altro, e l'account non
 * verificato resta dov'è — non si perde niente, e chi aveva già scritto la
 * password non la riscrive.
 */
export function checkCodeUsable(
  row: CodeRow | null,
  now: Date,
): Result<null> {
  if (row === null || row.consumedAt !== null) {
    return fail(
      "CODE_INVALID",
      "Non c'è nessun codice da usare: fattene mandare uno nuovo.",
    );
  }
  if (now.getTime() >= row.expiresAt.getTime()) {
    return fail(
      "CODE_EXPIRED",
      `Il codice è scaduto: vale ${CODE_TTL_MINUTES} minuti. Fattene mandare uno nuovo.`,
    );
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    return fail(
      "CODE_BURNED",
      "Hai sbagliato il codice troppe volte: questo non vale più, fattene mandare uno nuovo.",
    );
  }
  return ok(null);
}

/** Quanti tentativi restano su una riga, mai negativo. */
export function attemptsLeft(row: CodeRow): number {
  return Math.max(0, MAX_ATTEMPTS - row.attempts);
}

/**
 * Il messaggio dopo un codice sbagliato, che dice **quante prove restano**.
 *
 * `attempts` è quello già incrementato dal tentativo appena fallito: chi
 * chiama scrive la riga e poi chiede la frase.
 */
export function wrongCodeMessage(attempts: number): Result<null> {
  const left = MAX_ATTEMPTS - attempts;
  if (left <= 0) {
    return fail(
      "CODE_BURNED",
      "Codice sbagliato, e i tentativi sono finiti: fattene mandare uno nuovo.",
    );
  }
  return fail(
    "CODE_INVALID",
    left === 1
      ? "Codice sbagliato. Ti resta un tentativo."
      : `Codice sbagliato. Ti restano ${left} tentativi.`,
  );
}

// ─── Il reinvio ──────────────────────────────────────────────────────────────

/**
 * Si può mandare un altro codice?
 *
 * ⚠ Il limite si legge dal `created_at` dell'ultima riga: **è un rate limit che
 * vive nel database**, quindi sopravvive a un riavvio del processo e non ha
 * bisogno del limitatore in memoria di `lib/rate-limit.ts`. Alcuni limiti sono
 * gratis perché il fatto è già registrato.
 */
export function checkResendAllowed(
  lastSentAt: Date | null,
  now: Date,
): Result<null> {
  if (lastSentAt === null) return ok(null);
  const wait = secondsUntilResend(lastSentAt, now);
  if (wait <= 0) return ok(null);
  return fail(
    "RESEND_TOO_SOON",
    wait === 1
      ? "Aspetta un secondo prima di chiederne un altro."
      : `Aspetta ${wait} secondi prima di chiederne un altro.`,
  );
}

/** I secondi che mancano al prossimo invio possibile. Zero se si può già. */
export function secondsUntilResend(lastSentAt: Date | null, now: Date): number {
  if (lastSentAt === null) return 0;
  const elapsed = now.getTime() - lastSentAt.getTime();
  if (elapsed >= RESEND_COOLDOWN_MS) return 0;
  return Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
}
