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

// ─── Il toast, cioè l'esito detto a chi ha smesso di guardare il pannello ────

/**
 * L'esito di un salvataggio, ridotto a ciò che sta in un toast.
 *
 * ⚠ **Serve perché il pannello, quando tutto va bene, se ne va.** L'esito per campo
 * è dentro il modale, che è il posto giusto quando il modale resta aperto — cioè in
 * caso di errore. A pieno successo però il modale si chiude, e fino a questo punto
 * il salvataggio riuscito era indistinguibile da un click andato perso: la tabella
 * si aggiornava e nient'altro. Il toast è la mezza riga che dice *cosa* è stato
 * salvato, e sopravvive alla chiusura perché non vive nel pannello.
 *
 * È una funzione pura e non tre `if` nel componente per la ragione di sempre in
 * questo file: il caso che conta è quello **a metà**, ed è anche il più raro da
 * vedere a mano.
 */
export type SaveToast = {
  /** `partial` non è un errore e non è un successo: è la cosa che va detta meglio. */
  kind: "ok" | "partial" | "error";
  title: string;
  /** Già in italiano e già leggibile: i messaggi vengono dal motore. */
  description: string | null;
};

const label = (outcome: UserFieldOutcome) => USER_FIELD_LABELS[outcome.field];
const listOf = (outcomes: UserFieldOutcome[]) => outcomes.map(label).join(" · ");
const detailOf = (outcomes: UserFieldOutcome[]) =>
  outcomes.map((outcome) => `${label(outcome)}: ${outcome.message}`).join(" ");

export function saveToast(state: UserSaveState): SaveToast | null {
  // Lo stato iniziale di `useActionState` non è un esito: niente toast finché
  // qualcuno non ha premuto Salva. Ogni ritorno dell'azione scrive `done` oppure
  // un `error`, quindi l'assenza di entrambi è il solo modo di essere «prima».
  if (state.done === undefined && state.error === null) return null;

  const outcomes = state.outcomes ?? [];
  if (outcomes.length === 0) {
    return state.error === null
      ? { kind: "ok", title: "Non c'era niente da salvare", description: null }
      : { kind: "error", title: "Non salvato", description: state.error };
  }

  const done = outcomes.filter((outcome) => outcome.ok);
  const failed = outcomes.filter((outcome) => !outcome.ok);

  if (failed.length === 0) {
    return {
      kind: "ok",
      title: done.length === 1 ? "Modifica salvata" : "Modifiche salvate",
      description: listOf(done),
    };
  }
  if (done.length === 0) {
    return {
      kind: "error",
      title: "Niente è stato salvato",
      description: detailOf(failed),
    };
  }
  // ⚠ Il caso che il titolo deve nominare per primo: **una parte è passata**. Dire
  // «errore» qui farebbe riprovare tutto, dire «salvato» nasconderebbe metà del
  // lavoro non fatto — ed è il motivo per cui l'azione non è atomica e non finge.
  return {
    kind: "partial",
    title: "Salvato solo in parte",
    description: `Fatto: ${listOf(done)}. Non fatto — ${detailOf(failed)}`,
  };
}
