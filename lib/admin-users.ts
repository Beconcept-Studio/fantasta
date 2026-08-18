import { fold } from "@/lib/realtime/portal";

/**
 * La ricerca e l'esito del salvataggio della pagina utenti (M13).
 *
 * ## Perché non stanno dentro il componente
 *
 * Per la stessa ragione di `lib/centro-dati.ts`: una lista filtrata male **non dà
 * nessun errore**, dà una lista plausibile e incompleta, e chi cerca «Rossì» e non
 * lo trova conclude che quella persona non si è iscritta. Qui si prova senza un
 * browser e senza un database.
 *
 * Zero dipendenze oltre a `fold`: questo file lo legge un client component, e non
 * deve portarsi l'ORM nel bundle (la regola ESLint su `lib/db`).
 */

// ─── La ricerca ──────────────────────────────────────────────────────────────

/** La forma minima su cui si cerca: **non** la riga del database. */
export type AdminUserSearchable = {
  email: string | null;
  displayName: string | null;
};

/**
 * Il testo su cui il campo di ricerca confronta: indirizzo e nome, ripiegati.
 *
 * ⚠ **`fold` arriva da `lib/realtime/portal.ts` e non è ricopiata** (§4): quella
 * funzione è già la ricerca della lista di chiamata e quella della regia, e il
 * commento sul suo secondo chiamante dice perché conta — *«due ricerche che
 * rispondono diversamente a "citta" sarebbero una piccola bugia difficile da
 * spiegare»*. Su un cognome accentato vale identico: chi cerca «Rossì» digita
 * «rossi», e chi ha quel cognome nel database ce l'ha con l'accento.
 *
 * Le righe senza indirizzo o senza nome partecipano alla ricerca con una stringa
 * vuota al posto del campo che manca, non con la parola «—» che la tabella
 * disegna: cercare «—» non è una domanda che qualcuno farà, e un utente senza
 * nome deve restare trovabile dall'indirizzo.
 */
export function userSearchText(user: AdminUserSearchable): string {
  return `${fold(user.email ?? "")} ${fold(user.displayName ?? "")}`;
}

/**
 * Le righe che restano, cercando per nome **o** indirizzo.
 *
 * Query vuota vuol dire tutte: il campo di ricerca non è un filtro che parte
 * acceso. E non muta l'array in ingresso — è una prop che arriva dal server.
 */
export function filterUsers<T extends AdminUserSearchable>(
  users: T[],
  query: string,
  /** I testi cercabili, nello stesso ordine: si calcolano una volta sola. */
  searchable: string[] = users.map(userSearchText),
): T[] {
  const needle = fold(query.trim());
  if (needle === "") return users;
  return users.filter((_, index) => searchable[index].includes(needle));
}

// ─── L'esito del salvataggio, campo per campo ────────────────────────────────

/**
 * I quattro campi che il pannello laterale sa scrivere, e sono quattro: la macro
 * **non aggiunge nessun potere** (decisione dell'owner del 2026-08-18).
 *
 * `verified` è la verifica dell'indirizzo, che vale solo in una direzione —
 * `forceVerifyEmail` sa scrivere `email_verified_at`, non cancellarlo.
 */
export const USER_FIELDS = [
  "displayName",
  "verified",
  "isAdmin",
  "isPro",
] as const;
export type UserField = (typeof USER_FIELDS)[number];

/** Come si chiama quel campo per chi legge l'esito, non per il database. */
export const USER_FIELD_LABELS: Record<UserField, string> = {
  displayName: "Nome",
  verified: "Email verificata",
  isAdmin: "Admin",
  isPro: "Pro",
};

export type UserFieldOutcome = {
  field: UserField;
  ok: boolean;
  message: string;
};

/**
 * Lo stato di ritorno del salvataggio del pannello.
 *
 * ⚠ **Ha un esito per campo, e non è una comodità: è l'unica forma onesta.** Sono
 * quattro `UPDATE` distinti su `users` (`lib/engine/admin.ts` spiega perché non
 * serve nessun lock), quindi un salvataggio **può riuscire a metà** — e un
 * «salvato» unico su tre campi scritti e uno rifiutato è il modo di rendere
 * inaffidabile l'unico pannello di amministrazione che c'è.
 *
 * `error` e `ok` restano quelli di `FormState`, così il pannello mostra i
 * messaggi come li mostra il resto dell'applicazione; `outcomes` dice quale campo
 * è andato come, e `done` è l'unica cosa su cui il modale decide di chiudersi.
 */
export type UserSaveState = {
  error: string | null;
  ok?: string | null;
  outcomes?: UserFieldOutcome[];
  /** Tutto ciò che era stato chiesto è passato: **solo qui** il modale si chiude. */
  done?: boolean;
};

export const EMPTY_USER_SAVE_STATE: UserSaveState = { error: null };
