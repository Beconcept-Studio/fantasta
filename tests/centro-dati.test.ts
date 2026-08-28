import { describe, expect, it } from "vitest";

import {
  type CentroDatiSortable,
  DEFAULT_SORT,
  NO_FILTERS,
  arrangeRows,
  fold,
  hasSetPieces,
  initialDirection,
  nextSort,
} from "@/lib/centro-dati";
import {
  type CarmyJudgement,
  GIORNATE,
  type PlayerInsights,
} from "@/lib/domain";

/**
 * M10 — l'ordinamento e i filtri del Centro dati.
 *
 * Sono funzioni pure apposta: cinquecento righe ordinate male **non danno
 * nessun errore**, danno una lista plausibile e sbagliata, e nessuno se ne
 * accorge finché non cerca un nome che dovrebbe stare in cima. Nessun browser e
 * nessun database, come per `lib/domain.ts`.
 */

function insights(over: Partial<PlayerInsights> = {}): PlayerInsights {
  return {
    extId: 1,
    fullName: null,
    team: "Test",
    statsSeason: "current",
    presenze: 30,
    startsEleven: 20,
    minPlayingTime: 2000,
    rigoriFatti: 0,
    rigoriSbagliati: 0,
    rigoriParati: 0,
    fmvHome: null,
    fmvAway: null,
    golFatti: null,
    assist: null,
    rigoristaRank: null,
    piazzatiRank: null,
    ...over,
  };
}

function judge(over: Partial<CarmyJudgement> = {}): CarmyJudgement {
  return {
    extId: 1,
    sourceName: "Test",
    sourceTeam: "INT",
    fascia: null,
    prezzo: null,
    pma: null,
    titolarita: null,
    affidabilita: null,
    integrita: null,
    fmvExp: null,
    tags: [],
    commento: null,
    ...over,
  };
}

function row(
  name: string,
  over: Partial<CentroDatiSortable> = {},
): CentroDatiSortable {
  return { name, team: "Test", role: "C", quot: 10, ...over };
}

const names = (rows: CentroDatiSortable[]) => rows.map((r) => r.name);

describe("l'ordinamento di partenza", () => {
  /**
   * ⚠ Richiesta esplicita dell'owner (2026-08-12): la lista si apre sulla
   * quotazione, dal più alto al più basso. È l'unica colonna di valore che la
   * pagina mostra — `FVM/1000` resta fuori per decisione dell'owner — e
   * ordinare per una colonna invisibile darebbe una lista in un ordine
   * inspiegabile.
   */
  it("è la quotazione dal più alto al più basso", () => {
    expect(DEFAULT_SORT).toEqual({ key: "quot", direction: "desc" });

    const rows = [row("Poco", { quot: 3 }), row("Tanto", { quot: 40 }), row("Medio", { quot: 12 })];
    expect(names(arrangeRows(rows, NO_FILTERS, DEFAULT_SORT))).toEqual([
      "Tanto",
      "Medio",
      "Poco",
    ]);
  });

  it("non muta l'array in ingresso", () => {
    const rows = [row("B", { quot: 1 }), row("A", { quot: 2 })];
    const before = names(rows);
    arrangeRows(rows, NO_FILTERS, DEFAULT_SORT);
    expect(names(rows)).toEqual(before);
  });
});

describe("il click sulle intestazioni", () => {
  it("i numeri si aprono dal più alto, il testo dalla A", () => {
    expect(initialDirection("quot")).toBe("desc");
    expect(initialDirection("titolarita")).toBe("desc");
    expect(initialDirection("piazzati")).toBe("desc");
    expect(initialDirection("name")).toBe("asc");
    expect(initialDirection("team")).toBe("asc");
    expect(initialDirection("role")).toBe("asc");
  });

  it("una colonna nuova si apre, la stessa colonna si inverte", () => {
    const first = nextSort(DEFAULT_SORT, "name");
    expect(first).toEqual({ key: "name", direction: "asc" });
    expect(nextSort(first, "name")).toEqual({ key: "name", direction: "desc" });
    expect(nextSort(first, "quot")).toEqual({ key: "quot", direction: "desc" });
  });
});

describe("le colonne", () => {
  it("il ruolo si ordina P, D, C, A — non in alfabeto", () => {
    const rows = [
      row("Attaccante", { role: "A" }),
      row("Centrocampista", { role: "C" }),
      row("Portiere", { role: "P" }),
      row("Difensore", { role: "D" }),
    ];
    expect(
      names(arrangeRows(rows, NO_FILTERS, { key: "role", direction: "asc" })),
    ).toEqual(["Portiere", "Difensore", "Centrocampista", "Attaccante"]);
  });

  it("la titolarità ordina sulla percentuale, non sulle presenze", () => {
    const rows = [
      row("Poco", { insights: insights({ startsEleven: 5 }) }),
      row("Sempre", { insights: insights({ startsEleven: GIORNATE }) }),
      row("Metà", { insights: insights({ startsEleven: 19 }) }),
    ];
    expect(
      names(arrangeRows(rows, NO_FILTERS, { key: "titolarita", direction: "desc" })),
    ).toEqual(["Sempre", "Metà", "Poco"]);
  });

  /**
   * ⚠ **La riga che si sbaglia più facilmente di tutto il file.** Il rank
   * migliore è il **più basso**: «Rigori 1°» conta più di «Rigori 3°». Ordinare
   * quella colonna «dal più alto» deve quindi mettere in cima i primi
   * rigoristi, cioè invertire il segno rispetto a una colonna numerica
   * qualunque.
   */
  it("sui piazzati il primo della gerarchia sta in cima, non il terzo", () => {
    const rows = [
      row("Terzo", { insights: insights({ rigoristaRank: 3 }) }),
      row("Primo", { insights: insights({ rigoristaRank: 1 }) }),
      row("Secondo", { insights: insights({ piazzatiRank: 2 }) }),
    ];
    expect(
      names(arrangeRows(rows, NO_FILTERS, { key: "piazzati", direction: "desc" })),
    ).toEqual(["Primo", "Secondo", "Terzo"]);
    expect(
      names(arrangeRows(rows, NO_FILTERS, { key: "piazzati", direction: "asc" })),
    ).toEqual(["Terzo", "Secondo", "Primo"]);
  });

  it("chi batte sia rigori sia piazzati vale per la posizione migliore", () => {
    const rows = [
      row("Solo primo sui piazzati", { insights: insights({ piazzatiRank: 1 }) }),
      row("Secondo e primo", {
        insights: insights({ rigoristaRank: 2, piazzatiRank: 1 }),
      }),
      row("Quinto", { insights: insights({ rigoristaRank: 5 }) }),
    ];
    const sorted = arrangeRows(rows, NO_FILTERS, {
      key: "piazzati",
      direction: "desc",
    });
    expect(sorted[2].name).toBe("Quinto");
  });
});

describe("le due regole che decidono più di quanto sembri", () => {
  /**
   * Invertire «titolarità» non deve portare in cima trecento trattini: il senso
   * di quella colonna è la classifica di chi *ha* il dato, e l'assenza non è
   * uno zero.
   */
  it("chi non ha il valore resta in fondo in entrambe le direzioni", () => {
    const rows = [
      row("Senza", {}),
      row("Con", { insights: insights({ startsEleven: 30 }) }),
      row("Stagione scorsa", {
        insights: insights({ startsEleven: 38, statsSeason: "previous" }),
      }),
    ];

    for (const direction of ["asc", "desc"] as const) {
      const sorted = names(
        arrangeRows(rows, NO_FILTERS, { key: "titolarita", direction }),
      );
      expect(sorted[0]).toBe("Con");
      expect(sorted.slice(1).sort()).toEqual(["Senza", "Stagione scorsa"]);
    }
  });

  it("a parità di valore l'ordine è il nome, e non cambia a ogni click", () => {
    const rows = [
      row("Zaccagni", { quot: 10 }),
      row("Anguissa", { quot: 10 }),
      row("Meret", { quot: 10 }),
    ];
    const once = names(arrangeRows(rows, NO_FILTERS, DEFAULT_SORT));
    const twice = names(arrangeRows(rows, NO_FILTERS, DEFAULT_SORT));
    expect(once).toEqual(["Anguissa", "Meret", "Zaccagni"]);
    expect(twice).toEqual(once);
  });
});

describe("i filtri", () => {
  it("la ricerca ignora maiuscole e segni diacritici, e guarda anche la squadra", () => {
    expect(fold("Džeko")).toBe("dzeko");
    const rows = [
      row("Džeko", { team: "Fiorentina" }),
      row("Lautaro", { team: "Inter" }),
    ];
    expect(
      names(arrangeRows(rows, { ...NO_FILTERS, query: "dze" }, DEFAULT_SORT)),
    ).toEqual(["Džeko"]);
    expect(
      names(arrangeRows(rows, { ...NO_FILTERS, query: "INTER" }, DEFAULT_SORT)),
    ).toEqual(["Lautaro"]);
  });

  it("il filtro per ruolo e la ricerca si compongono", () => {
    const rows = [
      row("Rossi", { role: "P" }),
      row("Rossini", { role: "A" }),
      row("Bianchi", { role: "A" }),
    ];
    expect(
      names(
        arrangeRows(
          rows,
          { ...NO_FILTERS, query: "ross", role: "A" },
          DEFAULT_SORT,
        ),
      ),
    ).toEqual(["Rossini"]);
  });

  /**
   * ⚠ **Il filtro guarda i rank, non il gate stagionale.** Dei 92 designati
   * veri, 22 hanno le statistiche della stagione precedente: un filtro
   * costruito su `showableInsights` li perderebbe tutti, in silenzio, proprio
   * dentro lo strumento che serve a trovarli. Il perché sta su
   * `bestSetPieceRank` in `lib/domain.ts`.
   */
  it("«rigori e piazzati» tiene anche chi ha le statistiche dell'anno scorso", () => {
    const rows = [
      row("Designato, stagione scorsa", {
        insights: insights({ statsSeason: "previous", rigoristaRank: 1 }),
      }),
      row("Designato, quest'anno", {
        insights: insights({ piazzatiRank: 2 }),
      }),
      row("Non designato", { insights: insights() }),
      row("Senza insight", {}),
    ];

    expect(
      names(
        arrangeRows(rows, { ...NO_FILTERS, onlySetPieces: true }, DEFAULT_SORT),
      ).sort(),
    ).toEqual(["Designato, quest'anno", "Designato, stagione scorsa"]);
  });

  it("hasSetPieces è falso per chi non ha né rank né insight", () => {
    expect(hasSetPieces(row("Nessuno"))).toBe(false);
    expect(hasSetPieces(row("Vuoto", { insights: insights() }))).toBe(false);
    expect(
      hasSetPieces(row("Batte", { insights: insights({ piazzatiRank: 3 }) })),
    ).toBe(true);
  });

  it("nessuna riga passa i filtri: la lista è vuota, non è un errore", () => {
    const rows = [row("Rossi", { role: "P" })];
    expect(
      arrangeRows(rows, { ...NO_FILTERS, query: "inesistente" }, DEFAULT_SORT),
    ).toEqual([]);
  });
});

// ─── Le colonne che vengono dal foglio di Carmy (M10B §6) ────────────────────

describe("le colonne di Carmy", () => {
  it("la fascia si ordina per posizione, non in alfabeto: Top prima di Terza", () => {
    const rows = [
      row("Terzo", { carmy: judge({ fascia: "Terza" }) }),
      row("Primo", { carmy: judge({ fascia: "Top" }) }),
      row("Secondo", { carmy: judge({ fascia: "Semi-Top" }) }),
    ];
    expect(
      names(arrangeRows(rows, NO_FILTERS, { key: "fascia", direction: "desc" })),
    ).toEqual(["Primo", "Secondo", "Terzo"]);
  });

  it("chi non ha una fascia va in fondo in **entrambe** le direzioni", () => {
    const rows = [
      row("Senza", {}),
      row("Top", { carmy: judge({ fascia: "Top" }) }),
      row("Outsider", { carmy: judge({ fascia: "Outsider" }) }),
    ];
    for (const direction of ["asc", "desc"] as const) {
      const ordered = names(arrangeRows(rows, NO_FILTERS, { key: "fascia", direction }));
      expect(ordered[ordered.length - 1]).toBe("Senza");
    }
  });

  /**
   * ⚠ **Il prezzo consigliato in crediti non è una colonna del Centro dati**
   * (owner, 2026-08-12): al suo posto c'è il `PMA`, che è lo stesso numero in
   * percentuale — e la percentuale è l'unica delle due che resta vera se un'asta ha
   * un budget diverso da 500. `prezzo` resta a database e nel modale d'offerta, e
   * **non** è fra le chiavi di ordinamento: se qualcuno lo rimettesse in tabella
   * dovrebbe rimettere anche la chiave, ed è giusto che se ne accorga qui.
   */
  it("PMA e attesa sono numeri, e l'assenza resta in fondo in entrambi i versi", () => {
    const rows = [
      row("Caro", { carmy: judge({ pma: 18.2, fmvExp: 7.5 }) }),
      row("Senza", { carmy: judge({ pma: null, fmvExp: null }) }),
      row("Economico", { carmy: judge({ pma: 0.6, fmvExp: 5.1 }) }),
    ];
    for (const key of ["pma", "fmvExp"] as const) {
      expect(
        names(arrangeRows(rows, NO_FILTERS, { key, direction: "desc" })),
      ).toEqual(["Caro", "Economico", "Senza"]);
      expect(
        names(arrangeRows(rows, NO_FILTERS, { key, direction: "asc" })),
      ).toEqual(["Economico", "Caro", "Senza"]);
    }
  });

  it("l'affidabilità si ordina come gli altri numeri", () => {
    const rows = [
      row("Tre", { carmy: judge({ affidabilita: 3 }) }),
      row("Senza", {}),
      row("Cinque", { carmy: judge({ affidabilita: 5 }) }),
    ];
    expect(
      names(
        arrangeRows(rows, NO_FILTERS, { key: "affidabilita", direction: "desc" }),
      ),
    ).toEqual(["Cinque", "Tre", "Senza"]);
  });

  /**
   * ⚠ **La titolarità è una colonna sola con due fonti dentro** (M10B §4), e
   * ordinarla richiede la scelta scritta in `valueOf`: i due valori si riportano a
   * 0–1 — `voto / 5` da un lato, `quotaTitolare` dall'altro — perché rispondono
   * alla stessa domanda. Un `5` di Carmy finisce sopra un `34/38`, che è l'ordine
   * giusto: il giudizio parla di quest'anno, il rapporto dell'anno scorso.
   */
  it("ordina il giudizio di Carmy insieme al badge calcolato dalle presenze", () => {
    const rows = [
      row("Presenze alte", { insights: insights({ startsEleven: 34 }) }),
      row("Giudizio 5", {
        carmy: judge({ titolarita: 5 }),
        insights: insights({ startsEleven: 3 }),
      }),
      row("Giudizio 2", {
        carmy: judge({ titolarita: 2 }),
        insights: insights({ startsEleven: 30 }),
      }),
      row("Niente", {}),
    ];
    expect(
      names(arrangeRows(rows, NO_FILTERS, { key: "titolarita", direction: "desc" })),
    ).toEqual(["Giudizio 5", "Presenze alte", "Giudizio 2", "Niente"]);
  });

  it("il filtro per tag tiene solo chi ce l'ha", () => {
    const rows = [
      row("Rigorista", { carmy: judge({ tags: ["rigorista", "bonus"] }) }),
      row("Solo bonus", { carmy: judge({ tags: ["bonus"] }) }),
      row("Senza giudizio", {}),
    ];
    expect(
      names(arrangeRows(rows, { ...NO_FILTERS, tag: "rigorista" }, DEFAULT_SORT)),
    ).toEqual(["Rigorista"]);
    expect(
      names(arrangeRows(rows, { ...NO_FILTERS, tag: "bonus" }, DEFAULT_SORT)).sort(),
    ).toEqual(["Rigorista", "Solo bonus"]);
  });

  it("⚠ chi non ha un giudizio esce dal filtro per tag: «non lo so» non è un sì", () => {
    // Stessa regola del filtro «rigori e piazzati», e stessa ragione: un filtro
    // acceso è una domanda, e l'assenza non è una risposta affermativa.
    const rows = [row("Senza giudizio", {}), row("Con tag", { carmy: judge({ tags: ["bonus"] }) })];
    expect(
      names(arrangeRows(rows, { ...NO_FILTERS, tag: "bonus" }, DEFAULT_SORT)),
    ).toEqual(["Con tag"]);
  });

  it("i filtri di Carmy si compongono con quelli di M10", () => {
    const rows = [
      row("Portiere top", { role: "P", carmy: judge({ tags: ["imbattibilità"] }) }),
      row("Attaccante top", { role: "A", carmy: judge({ tags: ["imbattibilità"] }) }),
    ];
    expect(
      names(arrangeRows(rows, { ...NO_FILTERS, role: "P", tag: "imbattibilità" }, DEFAULT_SORT)),
    ).toEqual(["Portiere top"]);
  });
});
