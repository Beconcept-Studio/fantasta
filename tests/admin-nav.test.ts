import { describe, expect, it } from "vitest";

import {
  ADMIN_ROOT,
  activeAdminSection,
  adminSectionHref,
  adminSections,
} from "@/lib/admin-nav";

/**
 * M6 — il vocabolario della navigazione del pannello.
 *
 * È il gemello di `tests/auction-nav.test.ts`, e nasce dalla stessa cicatrice:
 * prima di M2 ogni pagina si scriveva i link a mano e una voce puntava alla
 * pagina sbagliata. Qui etichetta, titolo e segmento di URL escono dalla stessa
 * riga, e questi test coprono quella riga.
 *
 * Nessun database e nessun browser: il modulo è puro apposta — è ciò che
 * permette alla sidebar, che è un client component perché legge il pathname, di
 * leggerlo senza portarsi l'ORM nel bundle.
 */

describe("le sezioni del pannello", () => {
  it("sono Utenti, Aste, Listone e il suo Centro dati, in quest'ordine", () => {
    expect(adminSections().map((s) => s.key)).toEqual([
      "users",
      "auctions",
      // M10 — `Listone` assorbe le figurine, che fino a v1.10.0 erano una voce
      // di primo livello: erano le due voci che non parlavano di righe legate a
      // un'asta, e una accanto all'altra erano un pannello cresciuto per
      // accumulo. Adesso le caricature sono un blocco dentro questa pagina.
      "listone",
      "dati",
    ]);
  });

  /**
   * ⚠ La prima voce annidata dell'applicazione. Il `parent` non è decorazione:
   * è ciò da cui la sidebar ricava l'indentazione, e senza di lui «Centro dati»
   * sembrerebbe una sezione di pari grado di «Utenti».
   */
  it("il Centro dati è annidato sotto il listone, e nient'altro lo è", () => {
    const nested = adminSections().filter((s) => s.parent !== undefined);
    expect(nested.map((s) => s.key)).toEqual(["dati"]);
    expect(nested[0].parent).toBe("listone");
    expect(nested[0].segment).toBe("listone/dati");
  });

  /**
   * ⚠ Non c'è nessun parametro `viewer`, e non è una dimenticanza: qui il ruolo
   * è uno solo. Chi non è amministratore non vede il pannello affatto — lo
   * fermano `requireAppAdmin()` nel layout e in ogni server action, non una
   * voce di menù nascosta.
   */
  it("non dipendono da chi guarda: la funzione non prende nessun argomento", () => {
    expect(adminSections.length).toBe(0);
  });
});

describe("le voci non possono divergere dalle destinazioni", () => {
  it("ogni sezione ha etichetta, titolo e segmento non vuoti", () => {
    for (const section of adminSections()) {
      expect(section.label).not.toBe("");
      expect(section.title).not.toBe("");
      expect(section.segment).not.toBe("");
    }
  });

  it("nessuna etichetta e nessun titolo sono ripetuti", () => {
    const sections = adminSections();
    expect(new Set(sections.map((s) => s.label)).size).toBe(sections.length);
    expect(new Set(sections.map((s) => s.title)).size).toBe(sections.length);
  });

  it("l'href si costruisce dal segmento della sezione, non a mano", () => {
    const users = adminSections().find((s) => s.key === "users")!;
    expect(adminSectionHref(users)).toBe(`${ADMIN_ROOT}/users`);
  });

  it("ogni href sta sotto la radice del pannello", () => {
    for (const section of adminSections()) {
      expect(adminSectionHref(section).startsWith(`${ADMIN_ROOT}/`)).toBe(true);
    }
  });
});

describe("la sezione attiva si ricava dal pathname", () => {
  it.each([
    ["users", "users", "Tutti gli utenti"],
    ["auctions", "auctions", "Tutte le aste"],
    ["listone", "listone", "Il listone a sistema"],
  ])("/admin/%s è la sezione con titolo «%s»", (segment, key, title) => {
    const section = activeAdminSection(`${ADMIN_ROOT}/${segment}`);
    expect(section?.key).toBe(key);
    expect(section?.title).toBe(title);
  });

  /**
   * ⚠ **Il test per cui `activeAdminSection` è stata riscritta in M10.** Fino a
   * v1.10.0 guardava `parts[1]` e basta: su questo percorso avrebbe acceso
   * «Listone» e messo in cima alla pagina il titolo del listone, mentre la barra
   * degli indirizzi diceva un'altra cosa. Il match più lungo vince.
   */
  it("/admin/listone/dati accende «Centro dati», non «Listone»", () => {
    const section = activeAdminSection(`${ADMIN_ROOT}/listone/dati`);
    expect(section?.key).toBe("dati");
    expect(section?.label).toBe("Centro dati");
  });

  it("una barra finale non cambia la sezione", () => {
    expect(activeAdminSection(`${ADMIN_ROOT}/users/`)?.key).toBe("users");
    expect(activeAdminSection(`${ADMIN_ROOT}/listone/dati/`)?.key).toBe("dati");
  });

  /**
   * Una pagina che un giorno nascesse sotto `listone` senza essere una sezione
   * resta dentro `Listone`: appartiene a quella sezione, e lasciare la sidebar
   * spenta sarebbe peggio che accendere la voce da cui ci si è arrivati.
   */
  it("una sotto-pagina sconosciuta resta nella sezione che la contiene", () => {
    expect(activeAdminSection(`${ADMIN_ROOT}/listone/qualcosa`)?.key).toBe(
      "listone",
    );
  });

  /**
   * La radice non è una sezione: `/admin` reindirizza alla prima voce, e il
   * reindirizzamento si costruisce da `adminSections()[0]` — non da una stringa
   * scritta due volte.
   */
  it("la radice del pannello non è una sezione", () => {
    expect(activeAdminSection(ADMIN_ROOT)).toBeNull();
  });

  it("fuori dal pannello non c'è sezione attiva", () => {
    expect(activeAdminSection("/dashboard")).toBeNull();
    expect(activeAdminSection("/auctions/new")).toBeNull();
    // ⚠ Le aste dell'applicazione stanno sotto `/admin/auctions`, le proprie
    // sotto `/auctions`: la seconda non deve accendere la voce della prima.
    expect(activeAdminSection("/auctions")).toBeNull();
  });

  it("un segmento che non è una sezione non ne inventa una", () => {
    expect(activeAdminSection(`${ADMIN_ROOT}/statistiche`)).toBeNull();
  });
});
