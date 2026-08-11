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
  it("sono Utenti, Aste e Figurine, in quest'ordine", () => {
    expect(adminSections().map((s) => s.key)).toEqual([
      "users",
      "auctions",
      // M7 — in fondo perché è l'unica voce che non parla di righe del
      // database: è un archivio di file, e sopravvive alle aste.
      "figurine",
    ]);
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
    ["users", "Tutti gli utenti"],
    ["auctions", "Tutte le aste"],
    ["figurine", "Le figurine dei calciatori"],
  ])("/admin/%s è la sezione con titolo «%s»", (segment, title) => {
    const section = activeAdminSection(`${ADMIN_ROOT}/${segment}`);
    expect(section?.key).toBe(segment);
    expect(section?.title).toBe(title);
  });

  it("una barra finale non cambia la sezione", () => {
    expect(activeAdminSection(`${ADMIN_ROOT}/users/`)?.key).toBe("users");
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
