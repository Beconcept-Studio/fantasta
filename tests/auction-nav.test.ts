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

/**
 * Lo stato di default di questi test: un'asta che non è ancora partita, cioè
 * quello in cui la navigazione è al completo. Chi prova la restrizione di M16
 * passa `LIVE` esplicitamente, così si legge nel test cosa la sta causando.
 */
const READY = { status: "READY" } as const;

describe("le sezioni visibili dipendono dal ruolo", () => {
  it("il proprietario che gioca le vede tutte, in ordine di flusso", () => {
    expect(auctionSections(owner, READY).map((s) => s.key)).toEqual([
      "setup",
      "lobby",
      "manage",
      "play",
      "log",
    ]);
  });

  it("il proprietario che non ha joinato non ha un portale", () => {
    expect(auctionSections(ownerNotPlaying, READY).map((s) => s.key)).toEqual([
      "setup",
      "lobby",
      "manage",
      "log",
    ]);
  });

  it("il partecipante non vede né configurazione né regia", () => {
    expect(auctionSections(participant, READY).map((s) => s.key)).toEqual([
      "lobby",
      "play",
      "log",
    ]);
  });

  /**
   * M3 §3 — lo storico lo vedono owner e membri. Un partecipante che vuole
   * contestare un lotto deve poterlo guardare da sé, e I10 vale anche qui: le
   * buste non si rivedono da nessun'altra parte dopo i secondi di reveal, tanto
   * meno se è stato premuto «Prosegui asta».
   */
  it("lo storico lo vede sia il proprietario sia il partecipante", () => {
    for (const viewer of [owner, ownerNotPlaying, participant]) {
      expect(
        auctionSections(viewer, READY).some((s) => s.key === "log"),
        JSON.stringify(viewer),
      ).toBe(true);
    }
  });

  it("chi non è né proprietario né membro non ha sezioni", () => {
    expect(auctionSections({ isOwner: false, isMember: false }, READY)).toEqual(
      [],
    );
  });
});

/**
 * M16 — la Lobby è **l'unica voce che guarda lo stato dell'asta**, e la
 * condizione è copiata dal `router.push` di `LobbyLive`: chi è membro, ad asta
 * `LIVE`, dalla lobby viene spinto al portale. Mostrargli il link vuol dire
 * offrirgli un viaggio di andata e ritorno.
 *
 * I due casi che **non** nascondono niente sono la parte da non semplificare
 * per simmetria: in pausa la spinta non c'è, e l'owner che non gioca non viene
 * spinto da nessuna parte perché non è membro.
 */
describe("la Lobby sparisce solo a chi verrebbe rimbalzato", () => {
  const lobbyVisibleTo = (
    viewer: { isOwner: boolean; isMember: boolean },
    status: "DRAFT" | "READY" | "LIVE" | "PAUSED" | "COMPLETED",
  ) => auctionSections(viewer, { status }).some((s) => s.key === "lobby");

  it("ad asta LIVE il partecipante non la vede: ci verrebbe rimbalzato", () => {
    expect(lobbyVisibleTo(participant, "LIVE")).toBe(false);
    expect(lobbyVisibleTo(owner, "LIVE")).toBe(false);
  });

  it("⚠ in pausa la vede, perché in pausa non c'è nessun rimbalzo", () => {
    // La spinta al portale è stata tolta da `PAUSED` apposta: è il momento in
    // cui si va a cambiare i tempi. Nascondere la voce qui rimetterebbe in
    // piedi il problema che quella scelta aveva risolto.
    expect(lobbyVisibleTo(participant, "PAUSED")).toBe(true);
    expect(lobbyVisibleTo(owner, "PAUSED")).toBe(true);
  });

  it("⚠ l'owner che non gioca la vede sempre, LIVE compreso (P11)", () => {
    // Non è membro, quindi `LobbyLive` non lo spinge da nessuna parte: per lui
    // la lobby ad asta in corso è la lista dei partecipanti coi loro pallini.
    for (const status of ["READY", "LIVE", "PAUSED", "COMPLETED"] as const) {
      expect(lobbyVisibleTo(ownerNotPlaying, status), status).toBe(true);
    }
  });

  it("negli altri stati la vedono tutti, come prima di M16", () => {
    for (const status of ["DRAFT", "READY", "COMPLETED"] as const) {
      expect(lobbyVisibleTo(participant, status), status).toBe(true);
      expect(lobbyVisibleTo(owner, status), status).toBe(true);
    }
  });

  it("nessun'altra voce cambia con lo stato", () => {
    const others = (status: "READY" | "LIVE") =>
      auctionSections(owner, { status })
        .map((s) => s.key)
        .filter((key) => key !== "lobby");
    expect(others("LIVE")).toEqual(others("READY"));
  });
});

describe("le voci non possono divergere dalle destinazioni", () => {
  it("ogni sezione ha etichetta, titolo e segmento non vuoti", () => {
    for (const section of auctionSections(owner, READY)) {
      expect(section.label).not.toBe("");
      expect(section.title).not.toBe("");
      expect(section.segment).not.toBe("");
    }
  });

  it("nessuna etichetta e nessun titolo sono ripetuti", () => {
    const sections = auctionSections(owner, READY);
    expect(new Set(sections.map((s) => s.label)).size).toBe(sections.length);
    expect(new Set(sections.map((s) => s.title)).size).toBe(sections.length);
  });

  it("l'href si costruisce dal segmento della sezione, non a mano", () => {
    const setup = auctionSections(owner, READY).find((s) => s.key === "setup")!;
    expect(sectionHref(AUCTION, setup)).toBe(`/auctions/${AUCTION}/setup`);
  });
});

describe("la sezione attiva si ricava dal pathname", () => {
  it.each([
    ["setup", "Configurazione dell'asta"],
    ["lobby", "Lobby"],
    ["manage", "Regia dell'asta"],
    ["play", "Asta live"],
    ["log", "Storico dell'asta"],
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

  // ⚠ Fino a M3 questo test usava `/log` come esempio di segmento inesistente.
  // Ora `/log` è una sezione, quindi l'esempio è cambiato — ed è la ragione per
  // cui il test è servito: la lista è una sola, e chi la allunga lo scopre qui.
  it("un segmento che non è una sezione non ne inventa una", () => {
    expect(activeSection(`/auctions/${AUCTION}/statistiche`)).toBeNull();
  });

  /**
   * ⚠ **Il test che tiene in piedi la restrizione di M16**, e il caso che è
   * facilissimo rompere: una sezione può essere *nascosta dal menù* e
   * *raggiunta lo stesso*. La Lobby ad asta `LIVE` è esattamente quel caso —
   * il link sparisce, l'URL funziona, e l'owner che non gioca ci vive.
   *
   * `activeSection` deve quindi leggere il catalogo intero e non l'elenco delle
   * voci visibili. Se un giorno tornasse a passare da `auctionSections`, la
   * pagina della lobby perderebbe la propria intestazione proprio nello stato
   * in cui la voce è nascosta: al posto di «Lobby» si leggerebbe il nome
   * dell'asta, che è il ripiego di `AuctionNav` per le rotte che non riconosce.
   */
  it("la Lobby ha il suo titolo anche quando il menù non la mostra", () => {
    expect(
      auctionSections(participant, { status: "LIVE" }).some(
        (s) => s.key === "lobby",
      ),
    ).toBe(false);
    const section = activeSection(`/auctions/${AUCTION}/lobby`);
    expect(section?.key).toBe("lobby");
    expect(section?.title).toBe("Lobby");
  });
});
