import { describe, expect, it } from "vitest";

import {
  EMPTY_USER_SAVE_STATE,
  filterUsers,
  saveToast,
  userSearchText,
} from "@/lib/admin-users";

/**
 * M13 §4 — la ricerca della pagina utenti, provata senza browser e senza database.
 *
 * ⚠ **Il caso che conta è il nome accentato**, e non è un dettaglio esotico: chi
 * cerca «Rossì» digita «rossi», perché l'accento non è sulla tastiera e nessuno
 * ricorda com'è scritto il cognome di un amico nel proprio account. Una ricerca che
 * non lo trova non dà nessun errore — dice che quella persona non si è iscritta, che
 * è la risposta sbagliata alla domanda più frequente della pagina.
 *
 * `fold` è **importata** da `lib/realtime/portal.ts`, non ricopiata: è già la
 * ricerca della lista di chiamata e quella della regia, e due ricerche che
 * rispondono diversamente allo stesso testo sono una piccola bugia difficile da
 * spiegare.
 */

const ROWS = [
  { email: "paolo.rossi@example.com", displayName: "Paolo Rossì" },
  { email: "MARIO.VERDI@example.com", displayName: "Mario Verdi" },
  { email: "rossi.impresa@example.com", displayName: "Anna Bianchi" },
  { email: null, displayName: "Senza Indirizzo" },
  { email: "muto@example.com", displayName: null },
];

const names = (rows: typeof ROWS) => rows.map((row) => row.displayName);

describe("la ricerca per nome o email", () => {
  it("«rossi» trova «Rossì», e lo trova anche nell'indirizzo di un altro", () => {
    const found = filterUsers(ROWS, "rossi");

    expect(names(found)).toEqual(["Paolo Rossì", "Anna Bianchi"]);
  });

  /**
   * ⚠ **Il ripiegamento vale in tutte e due le direzioni**, e la riga qui sotto lo
   * dice meglio di come era stata scritta la prima volta: «ROSSÌ» — maiuscolo *e*
   * accentato — trova anche `rossi.impresa@example.com`, che non ha né l'uno né
   * l'altro. Chi scrive l'accento e chi non lo scrive fanno la stessa domanda e
   * devono ottenere la stessa risposta.
   */
  it("le maiuscole e gli accenti non contano, in nessuna delle due direzioni", () => {
    expect(names(filterUsers(ROWS, "ROSSÌ"))).toEqual([
      "Paolo Rossì",
      "Anna Bianchi",
    ]);
    expect(names(filterUsers(ROWS, "mario.verdi"))).toEqual(["Mario Verdi"]);
  });

  it("una query vuota, o di soli spazi, è tutte le righe", () => {
    expect(filterUsers(ROWS, "")).toHaveLength(ROWS.length);
    expect(filterUsers(ROWS, "   ")).toHaveLength(ROWS.length);
  });

  /**
   * ⚠ Le due righe incomplete restano trovabili **da ciò che hanno**: la tabella
   * disegna un «—» al posto del campo che manca, ma quel trattino è disegno e non
   * un dato — cercarlo non è una domanda che qualcuno farà.
   */
  it("chi non ha un nome si trova dall'indirizzo, e viceversa", () => {
    expect(names(filterUsers(ROWS, "muto"))).toEqual([null]);
    expect(names(filterUsers(ROWS, "senza indirizzo"))).toEqual([
      "Senza Indirizzo",
    ]);
    expect(filterUsers(ROWS, "—")).toHaveLength(0);
  });

  it("una query che non trova niente trova niente, non tutto", () => {
    expect(filterUsers(ROWS, "zzz")).toHaveLength(0);
  });

  it("non riordina e non muta l'array che arriva dal server", () => {
    const before = [...ROWS];

    filterUsers(ROWS, "rossi");

    expect(ROWS).toEqual(before);
  });

  /**
   * Il componente calcola i testi cercabili una volta sola e li passa a ogni tasto:
   * il risultato deve essere lo stesso di quando li calcola la funzione da sé.
   */
  it("i testi cercabili precalcolati danno lo stesso risultato", () => {
    const searchable = ROWS.map(userSearchText);

    expect(filterUsers(ROWS, "rossi", searchable)).toEqual(
      filterUsers(ROWS, "rossi"),
    );
  });

  it("il testo cercabile ripiega gli accenti e le maiuscole di entrambi i campi", () => {
    expect(userSearchText(ROWS[0])).toBe("paolo.rossi@example.com paolo rossi");
    expect(userSearchText({ email: null, displayName: null })).toBe(" ");
  });
});

/**
 * M13 — l'esito ridotto a un toast.
 *
 * ⚠ **Il caso che conta è quello a metà**, ed è anche il più difficile da vedere a
 * mano: dire «errore» farebbe riprovare tutto, dire «salvato» nasconderebbe il campo
 * che non è passato. Il salvataggio non è atomico — quattro `UPDATE` distinti — e il
 * toast è il posto in cui quella verità arriva a chi ha smesso di guardare il
 * pannello, perché a pieno successo il pannello si chiude.
 */
describe("il toast dell'esito", () => {
  it("prima di premere Salva non c'è nessun toast", () => {
    expect(saveToast(EMPTY_USER_SAVE_STATE)).toBeNull();
  });

  it("tutto riuscito: dice quali campi, al singolare o al plurale", () => {
    const uno = saveToast({
      error: null,
      done: true,
      outcomes: [{ field: "isPro", ok: true, message: "adesso vede gli insight." }],
    });
    expect(uno).toEqual({
      kind: "ok",
      title: "Modifica salvata",
      description: "Pro",
    });

    const due = saveToast({
      error: null,
      done: true,
      outcomes: [
        { field: "displayName", ok: true, message: "adesso è «Anna»." },
        { field: "verified", ok: true, message: "verificata a mano." },
      ],
    });
    expect(due?.title).toBe("Modifiche salvate");
    expect(due?.description).toBe("Nome · Email verificata");
  });

  it("tutto rifiutato: lo dice, e riporta i messaggi del motore", () => {
    const toast = saveToast({
      error: "Questo utente non esiste.",
      done: false,
      outcomes: [
        { field: "displayName", ok: false, message: "Questo utente non esiste." },
      ],
    });

    expect(toast?.kind).toBe("error");
    expect(toast?.title).toBe("Niente è stato salvato");
    expect(toast?.description).toContain("Questo utente non esiste.");
  });

  it("riuscito a metà: nomina prima ciò che è passato, poi ciò che no", () => {
    const toast = saveToast({
      error: "Il nome deve stare fra 3 e 60 caratteri.",
      done: false,
      outcomes: [
        {
          field: "displayName",
          ok: false,
          message: "Il nome deve stare fra 3 e 60 caratteri.",
        },
        { field: "isPro", ok: true, message: "adesso vede gli insight." },
      ],
    });

    expect(toast?.kind).toBe("partial");
    expect(toast?.title).toBe("Salvato solo in parte");
    expect(toast?.description).toBe(
      "Fatto: Pro. Non fatto — Nome: Il nome deve stare fra 3 e 60 caratteri.",
    );
  });

  it("un form senza campi non è un errore, ed è un toast che non allarma", () => {
    expect(saveToast({ error: null, ok: "Non c'era niente da salvare.", done: true })).toEqual({
      kind: "ok",
      title: "Non c'era niente da salvare",
      description: null,
    });
  });

  it("un rifiuto prima dei campi (nessun utente) è un errore secco", () => {
    expect(saveToast({ error: "Utente non indicato." })).toEqual({
      kind: "error",
      title: "Non salvato",
      description: "Utente non indicato.",
    });
  });
});
