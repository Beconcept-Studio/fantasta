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
 * L'elenco dei codici cresce con le fasi: quelli del setup vengono dalla
 * Fase 1, quelli di gioco dalla Fase 2 (il motore puro rifiuta con questi
 * stessi codici; F3-03 li porta alle action).
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

  // Gioco (Fase 2 — il motore puro)
  "WRONG_PHASE",
  "NOT_YOUR_TURN",
  "PLAYER_NOT_FOUND",
  "WRONG_ROLE",
  "PLAYER_ASSIGNED",
  "PLAYER_OUT_OF_LIST",
  "NOT_ELIGIBLE",
  "INVALID_AMOUNT",
  "BID_TOO_LOW",
  "BID_TOO_HIGH",
  "ROUND_CLOSED",
  "BID_WITHDRAWN",
  "WITHDRAW_FORBIDDEN",
  "INVALID_SEAT",
  "ADJUST_VIOLATES_I3",

  // Override del manager (Fase 7)
  "ASSIGN_VIOLATES_I4",
  "ASSIGNMENT_NOT_FOUND",

  // Presence e protocollo (Fase 4)
  "MEMBERS_NOT_READY",
  "INVALID_REQUEST",

  // Simulazione (M4)
  "NOT_ADMIN",
  "NOT_SIMULATED",

  // Identità (M5)
  "INVALID_EMAIL",
  "INVALID_PASSWORD",
  "EMAIL_TAKEN",
  /** L'indirizzo esiste ma entra da Google: è la direzione che §2 rifiuta. */
  "EMAIL_IS_GOOGLE",
  "ACCOUNT_NOT_FOUND",
  "CODE_INVALID",
  "CODE_EXPIRED",
  /** Cinque tentativi sbagliati: il codice è bruciato, se ne chiede un altro. */
  "CODE_BURNED",
  "RESEND_TOO_SOON",
  "ALREADY_VERIFIED",
  "RATE_LIMITED",

  // Insight sul listone (M8)
  /**
   * La fonte non risponde, o non risponde con quello che dice di essere.
   *
   * ⚠ Questi tre codici esistono perché le due fonti sono **fuori dal nostro
   * controllo**: un giorno cambieranno forma senza avvisare, e quel giorno l'unica
   * cosa che conta è che l'import **fallisca**, invece di scrivere 497 righe di
   * `null` sopra dati buoni.
   */
  "SOURCE_UNREACHABLE",
  "SOURCE_SCHEMA",
  /** Il match `ext_id` è troppo magro: qualcosa è cambiato, meglio non scrivere. */
  "SOURCE_COVERAGE",
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
