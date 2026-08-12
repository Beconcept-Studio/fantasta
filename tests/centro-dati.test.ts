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
import { GIORNATE, type PlayerInsights } from "@/lib/domain";

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
    rigoristaRank: null,
    piazzatiRank: null,
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
