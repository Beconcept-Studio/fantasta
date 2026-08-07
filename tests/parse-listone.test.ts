import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { SHEET_NAME, countPool, parseListone } from "@/lib/import/parseListone";

/**
 * Il parser sulla fixture vera, quella scaricata da Fantacalcio.it.
 * I numeri attesi sono quelli scritti in PLAN §13: 495 righe, P 61 / D 177 /
 * C 172 / A 85. Se il file cambia, questi test devono cambiare con lui — è il
 * punto: accorgersene qui e non la sera dell'asta.
 */

const FIXTURE = fileURLToPath(new URL("../fixtures/listone.xlsx", import.meta.url));

function fixture(): Buffer {
  return readFileSync(FIXTURE);
}

/** Costruisce un .xlsx al volo per i casi che la fixture non contiene. */
function workbookFrom(rows: Record<string, unknown>[], sheet = SHEET_NAME) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheet);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

const ROW = {
  "#": 1,
  Nome: "Rossi",
  "Fuori lista": "",
  "Sq.": "Milan",
  Under: 25,
  "R.": "A",
  "R.MANTRA": "Pc",
  PGv: 0,
  MV: 0,
  FM: 0,
  "FVM/1000": 100,
  "QUOT.": 20,
};

describe("parseListone — la fixture di riferimento", () => {
  it("legge 495 giocatori", () => {
    const result = parseListone(fixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(495);
  });

  it("li distribuisce in P 61 / D 177 / C 172 / A 85", () => {
    const result = parseListone(fixture());
    if (!result.ok) throw new Error(result.error.message);
    // `countPool` con `includeOutOfList = true` conta tutte le righe lette.
    expect(countPool(result.value, true)).toEqual({
      P: 61,
      D: 177,
      C: 172,
      A: 85,
    });
  });

  it("marca i fuori lista e li toglie dal pool di default", () => {
    const result = parseListone(fixture());
    if (!result.ok) throw new Error(result.error.message);

    const fuori = result.value.filter((p) => p.outOfList);
    expect(fuori).toHaveLength(5);
    expect(countPool(result.value, false)).toEqual({
      P: 59, // 61 − 2
      D: 174, // 177 − 3
      C: 172,
      A: 85,
    });
  });

  it("mappa le colonne di §13 sulla prima riga", () => {
    const result = parseListone(fixture());
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value[0]).toEqual({
      extId: 2764,
      name: "Martinez L.",
      team: "Inter",
      role: "A",
      roleMantra: "Pc",
      fvm: 185,
      quot: 35,
      outOfList: false,
    });
  });

  it("assegna identificativi tutti distinti", () => {
    const result = parseListone(fixture());
    if (!result.ok) throw new Error(result.error.message);
    expect(new Set(result.value.map((p) => p.extId)).size).toBe(495);
  });
});

describe("parseListone — file che non vanno bene", () => {
  it("rifiuta qualcosa che non è un foglio di calcolo", () => {
    const result = parseListone(new TextEncoder().encode("non sono un xlsx"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["LISTONE_UNREADABLE", "LISTONE_SHEET_MISSING"]).toContain(
        result.error.code,
      );
    }
  });

  it("rifiuta un file col foglio sbagliato, dicendo quali ha trovato", () => {
    const result = parseListone(workbookFrom([ROW], "Foglio1"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LISTONE_SHEET_MISSING");
      expect(result.error.message).toContain("Foglio1");
    }
  });

  it("rifiuta un listone senza le colonne obbligatorie", () => {
    const result = parseListone(workbookFrom([{ Nome: "Rossi", "R.": "A" }]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LISTONE_COLUMNS_MISSING");
      expect(result.error.message).toContain("#");
    }
  });

  it("rifiuta un ruolo non riconosciuto, dicendo a che riga", () => {
    const result = parseListone(
      workbookFrom([ROW, { ...ROW, "#": 2, "R.": "Z" }]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LISTONE_ROW_INVALID");
      expect(result.error.message).toContain("Riga 3");
    }
  });

  it("rifiuta due righe con lo stesso identificativo", () => {
    const result = parseListone(workbookFrom([ROW, { ...ROW, Nome: "Bianchi" }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("LISTONE_DUPLICATE_ID");
  });
});
