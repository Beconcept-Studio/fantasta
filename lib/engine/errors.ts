/**
 * Errori tipizzati.
 *
 * PLAN §17: «ogni azione rifiutata restituisce un codice di errore tipizzato,
 * non una stringa generica. Durante un countdown di 30 secondi, "Errore" senza
 * spiegazione è inutilizzabile».
 *
 * Da qui la forma di ogni funzione di mutazione: non lancia eccezioni per i
 * rifiuti previsti, ma restituisce un `Result`. Le eccezioni restano per i bug
 * veri (connessione persa, vincolo violato che non doveva esserlo), che vanno
 * viste in pagina d'errore, non ingoiate in un messaggio gentile.
 *
 * L'elenco dei codici cresce con le fasi: qui ci sono quelli del setup
 * (Fase 1). Quelli di gioco arrivano con F3-03.
 */

export const ERROR_CODES = [
  // Autorizzazione
  "NOT_AUTHENTICATED",
  "NOT_FOUND",
  "FORBIDDEN",

  // Configurazione dell'asta
  "INVALID_NAME",
  "INVALID_SEATS",
  "INVALID_ROLE_ORDER",
  "INVALID_BUDGET",
  "INVALID_TIMERS",
  "INVALID_SLOTS",
  "WRONG_STATUS",

  // Listone
  "LISTONE_UNREADABLE",
  "LISTONE_SHEET_MISSING",
  "LISTONE_COLUMNS_MISSING",
  "LISTONE_ROW_INVALID",
  "LISTONE_EMPTY",
  "LISTONE_DUPLICATE_ID",
  "LISTONE_INSUFFICIENT",
  "LISTONE_MISSING",

  // Inviti e membri
  "INVITE_NOT_FOUND",
  "INVITE_CLOSED",
  "INVITE_EXPIRED",
  "INVITE_EXHAUSTED",
  "AUCTION_FULL",
  "ALREADY_MEMBER",
  "INVALID_TEAM_NAME",
  "MEMBER_NOT_FOUND",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ActionError = {
  code: ErrorCode;
  /** Messaggio già leggibile da un umano, in italiano. Va mostrato così com'è. */
  message: string;
};

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: ActionError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T = never>(code: ErrorCode, message: string): Result<T> {
  return { ok: false, error: { code, message } };
}
