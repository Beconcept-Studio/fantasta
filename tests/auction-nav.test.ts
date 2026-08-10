import { describe, expect, it } from "vitest";

import {
  activeSection,
  auctionSections,
  sectionHref,
} from "@/lib/auction-nav";

/**
 * M2 — il vocabolario della navigazione dentro un'asta.
 *
 * Questi test esistono per una ragione precisa: prima di M2 ogni pagina si
 * scriveva i propri link a mano, e nella setup la voce «Pannello di
 * configurazione» puntava alla lobby. Un'etichetta e una destinazione tenute
 * insieme da nient'altro che l'attenzione divergono, prima o poi.
 *
 * Qui l'etichetta, il titolo e il segmento di URL escono dalla stessa riga, e
 * quella riga è coperta. Nessun database, nessun browser: il modulo è puro
 * apposta — è ciò che permette anche al client component che evidenzia la voce
 * attiva di leggerlo senza portarsi dietro l'ORM.
 */

const AUCTION = "3f9a2c10-0000-4000-8000-000000000001";

const owner = { isOwner: true, isMember: true };
const ownerNotPlaying = { isOwner: true, isMember: false };
const participant = { isOwner: false, isMember: true };

describe("le sezioni visibili dipendono dal ruolo", () => {
  it("il proprietario che gioca le vede tutte, in ordine di flusso", () => {
    expect(auctionSections(owner).map((s) => s.key)).toEqual([
      "setup",
      "lobby",
      "manage",
      "play",
    ]);
  });

  it("il proprietario che non ha joinato non ha un portale", () => {
    expect(auctionSections(ownerNotPlaying).map((s) => s.key)).toEqual([
      "setup",
      "lobby",
      "manage",
    ]);
  });

  it("il partecipante non vede né configurazione né regia", () => {
    expect(auctionSections(participant).map((s) => s.key)).toEqual([
      "lobby",
      "play",
    ]);
  });

  it("chi non è né proprietario né membro non ha sezioni", () => {
    expect(auctionSections({ isOwner: false, isMember: false })).toEqual([]);
  });
});

describe("le voci non possono divergere dalle destinazioni", () => {
  it("ogni sezione ha etichetta, titolo e segmento non vuoti", () => {
    for (const section of auctionSections(owner)) {
      expect(section.label).not.toBe("");
      expect(section.title).not.toBe("");
      expect(section.segment).not.toBe("");
    }
  });

  it("nessuna etichetta e nessun titolo sono ripetuti", () => {
    const sections = auctionSections(owner);
    expect(new Set(sections.map((s) => s.label)).size).toBe(sections.length);
    expect(new Set(sections.map((s) => s.title)).size).toBe(sections.length);
  });

  it("l'href si costruisce dal segmento della sezione, non a mano", () => {
    const setup = auctionSections(owner).find((s) => s.key === "setup")!;
    expect(sectionHref(AUCTION, setup)).toBe(`/auctions/${AUCTION}/setup`);
  });
});

describe("la sezione attiva si ricava dal pathname", () => {
  it.each([
    ["setup", "Configurazione dell'asta"],
    ["lobby", "Lobby"],
    ["manage", "Regia dell'asta"],
    ["play", "Il tuo portale"],
  ])("/%s è la sezione con titolo «%s»", (segment, title) => {
    const section = activeSection(`/auctions/${AUCTION}/${segment}`);
    expect(section?.key).toBe(segment);
    expect(section?.title).toBe(title);
  });

  it("una barra finale non cambia la sezione", () => {
    expect(activeSection(`/auctions/${AUCTION}/manage/`)?.key).toBe("manage");
  });

  it("fuori da un'asta non c'è sezione attiva", () => {
    expect(activeSection("/dashboard")).toBeNull();
    expect(activeSection("/auctions/new")).toBeNull();
    expect(activeSection(`/auctions/${AUCTION}`)).toBeNull();
  });

  it("un segmento che non è una sezione non ne inventa una", () => {
    expect(activeSection(`/auctions/${AUCTION}/log`)).toBeNull();
  });
});
