import { describe, expect, it } from "vitest";

import { type RoseRow, buildRoseCsv, roseCsvRows } from "@/lib/rose-csv";

/**
 * Il verbale delle rose (M3 §1): tre colonne, solo gli assegnati.
 *
 * Tutto puro, nessun Postgres: la funzione riceve righe e restituisce testo.
 * Qui vive anche **l'ordinamento**, che per questo è collaudabile senza un
 * database acceso — e sta in un posto solo invece che anche in un `ORDER BY`.
 */

function row(over: Partial<RoseRow> = {}): RoseRow {
  return { seatIndex: 0, teamName: "Gli Invincibili", extId: 2792, price: 134, ...over };
}

describe("roseCsvRows — la forma del file", () => {
  it("mette in prima riga l'intestazione dei tre nomi della richiesta", () => {
    expect(roseCsvRows([])[0]).toEqual([
      "nome_squadra",
      "id_calciatore",
      "crediti_spesi",
    ]);
  });

  it("scrive una riga per assegnazione: squadra, id del calciatore, prezzo", () => {
    expect(roseCsvRows([row()])[1]).toEqual(["Gli Invincibili", "2792", "134"]);
  });

  it("senza assegnazioni resta la sola intestazione", () => {
    expect(roseCsvRows([])).toHaveLength(1);
  });

  it("ordina per posto in tavolo, così le rose si leggono a blocchi", () => {
    const rows = roseCsvRows([
      row({ seatIndex: 1, teamName: "Real Pastasciutta", extId: 164 }),
      row({ seatIndex: 0, teamName: "Gli Invincibili", extId: 411 }),
    ]);
    expect(rows.slice(1).map((r) => r[0])).toEqual([
      "Gli Invincibili",
      "Real Pastasciutta",
    ]);
  });

  it("dentro una squadra ordina per id del calciatore", () => {
    const rows = roseCsvRows([
      row({ extId: 2792 }),
      row({ extId: 411 }),
      row({ extId: 5089 }),
    ]);
    expect(rows.slice(1).map((r) => r[1])).toEqual(["411", "2792", "5089"]);
  });
});

/**
 * La rete di §1, che non sostituisce la regola di §2 ma copre i nomi salvati
 * **prima** che la regola esistesse — e quelli non si possono rinominare.
 */
describe("roseCsvRows — la rete sui caratteri che romperebbero il file", () => {
  it("una virgola nel nome squadra non diventa una colonna in più", () => {
    const rows = roseCsvRows([row({ teamName: "Real Pastasciutta, che ridere" })]);
    expect(rows[1]).toHaveLength(3);
    expect(rows[1]?.[0]).toBe("Real Pastasciutta che ridere");
  });

  it("le virgolette spariscono dal nome squadra", () => {
    expect(roseCsvRows([row({ teamName: 'I "Fenomeni"' })])[1]?.[0]).toBe(
      "I Fenomeni",
    );
  });

  it("non lascia gli spazi doppi che la sostituzione produrrebbe", () => {
    expect(roseCsvRows([row({ teamName: "Ajax, Amsterdam" })])[1]?.[0]).toBe(
      "Ajax Amsterdam",
    );
  });
});

describe("buildRoseCsv — il file", () => {
  it("separa le colonne con la virgola e le righe con un ritorno a capo", () => {
    const csv = buildRoseCsv([
      row({ seatIndex: 0, teamName: "Gli Invincibili", extId: 411, price: 88 }),
      row({ seatIndex: 1, teamName: "Real Pastasciutta", extId: 164, price: 201 }),
    ]);
    expect(csv).toBe(
      "nome_squadra,id_calciatore,crediti_spesi\n" +
        "Gli Invincibili,411,88\n" +
        "Real Pastasciutta,164,201\n",
    );
  });

  it("non contiene nessuna virgoletta, qualunque nome squadra arrivi", () => {
    expect(buildRoseCsv([row({ teamName: 'Il "Bar", Sport' })])).not.toContain('"');
  });

  it("finisce con un ritorno a capo, come ogni file di testo", () => {
    expect(buildRoseCsv([row()]).endsWith("\n")).toBe(true);
  });
});
