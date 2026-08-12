import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import {
  CARMY_FASCE,
  CARMY_TEAM_BY_SIGLA,
  normalizeCarmyName,
} from "@/lib/domain";
import { CARMY_SHEETS, parseCarmy } from "@/lib/import/parseCarmy";
import { parseListone } from "@/lib/import/parseListone";

/**
 * Il parser del foglio di Carmy, sulla fixture vera.
 *
 * ⚠ **Questi numeri sono il sensore di M10B, non un contorno.** Il file lo
 * compila **una persona**: cambierà, e cambierà senza avvisare. I numeri attesi
 * sono quindi **esatti** — 497 righe, 168 verdi, 17 etichette di tag, 10 commenti
 * — e non «almeno qualcosa»: un «almeno» passerebbe anche se metà del foglio si
 * svuotasse. Sono le misure del 2026-08-12 (M10B-02). Se cambiano perché il
 * *foglio* è cambiato, si aggiornano fixture e numeri **insieme**, e lo si scrive
 * nel commit.
 */

const FIXTURE = fileURLToPath(new URL("../fixtures/carmy.xlsx", import.meta.url));

function fixture(): Buffer {
  return readFileSync(FIXTURE);
}

function rows() {
  const result = parseCarmy(fixture());
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** Costruisce un .xlsx a quattro fogli al volo, per i casi che la fixture non ha. */
function workbookFrom(
  perSheet: Partial<Record<(typeof CARMY_SHEETS)[number], Record<string, unknown>[]>>,
  sheets: readonly string[] = CARMY_SHEETS,
) {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const data =
      perSheet[sheet as (typeof CARMY_SHEETS)[number]] ?? [{ ...ROW, Nome: `${sheet}-1` }];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), sheet);
  }
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

/** Una riga minima con tutte le colonne obbligatorie. */
const ROW = {
  "Obiett.": "",
  Fascia: "Top",
  Ruolo: "P",
  Team: "MIL",
  Nome: "Rossi",
  Prezzo: 30,
  PMA: "6.3%",
  Quo: 15,
  Titolarità: 5,
  Affidabilità: 4,
  Integrità: 3,
  Commento: "",
  "Nota 1": "titolarissimo",
  "Nota 2": "",
  "Nota 3": "",
  "Nota 4": "",
  "Nota 5": "",
  "FMV Exp.": 6.5,
};

describe("parseCarmy — la fixture di riferimento", () => {
  it("legge 497 giocatori dai quattro fogli", () => {
    const result = parseCarmy(fixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(497);
  });

  it("li distribuisce in P 59 / D 176 / C 174 / A 88, dal nome del foglio", () => {
    const perRole = { P: 0, D: 0, C: 0, A: 0 };
    for (const row of rows()) perRole[row.role] += 1;
    expect(perRole).toEqual({ P: 59, D: 176, C: 174, A: 88 });
  });

  it("⚠ nessun nome si ripete: è la chiave del join, e 497 nomi sono 497", () => {
    const names = rows().map((row) => normalizeCarmyName(row.name));
    expect(new Set(names).size).toBe(497);
  });

  it("le venti sigle di squadra sono venti", () => {
    expect(new Set(rows().map((row) => row.team)).size).toBe(20);
  });
});

describe("parseCarmy — il giudizio, che è il motivo per cui il file esiste", () => {
  it("la titolarità si distribuisce 1→75, 2→94, 3→159, 4→65, 5→103", () => {
    const dist: Record<string, number> = {};
    for (const row of rows()) {
      const key = row.titolarita === null ? "null" : String(row.titolarita);
      dist[key] = (dist[key] ?? 0) + 1;
    }
    // 496 voti più **un** `null`: è la riga non compilata di sotto.
    expect(dist).toEqual({ "1": 75, "2": 94, "3": 159, "4": 65, "5": 103, null: 1 });
  });

  it("⚠ 168 giocatori stanno a `>= 4`, cioè uno su tre — la misura della soglia", () => {
    const verdi = rows().filter((row) => (row.titolarita ?? 0) >= 4);
    expect(verdi).toHaveLength(168);
    expect(Math.round((1000 * verdi.length) / 497) / 10).toBe(33.8);
    // La soglia che M9 §1 aveva indicato come limite — uno su cinque — è `>= 5`.
    expect(rows().filter((row) => (row.titolarita ?? 0) >= 5)).toHaveLength(103);
  });

  it("l'affidabilità è concentrata: 3→254 e 4→179 su 497", () => {
    const affidabilita = rows().filter((row) => row.affidabilita === 3);
    expect(affidabilita).toHaveLength(254);
    expect(rows().filter((row) => row.affidabilita === 4)).toHaveLength(179);
  });

  it("l'integrità no: 1→37 e 5→121", () => {
    expect(rows().filter((row) => row.integrita === 1)).toHaveLength(37);
    expect(rows().filter((row) => row.integrita === 5)).toHaveLength(121);
  });

  it("⚠ lo `0` del foglio non è un voto: è la riga non compilata di Aurelio", () => {
    const aurelio = rows().find((row) => row.name === "Aurelio");
    expect(aurelio).toBeDefined();
    // Nel foglio ha `0` su tutti e tre i giudizi, `0` di prezzo, `"Non Impostata"`
    // di fascia e la fantamedia vuota. Un «titolarità 0» lo farebbe passare per il
    // peggior giocatore del listone invece che per un giocatore senza giudizio.
    expect(aurelio).toMatchObject({
      titolarita: null,
      affidabilita: null,
      integrita: null,
      prezzo: null,
      fascia: null,
      fmvExp: null,
    });
  });

  it("⚠ `Prezzo` a zero sono 73 giocatori, e zero non è un'offerta valida", () => {
    expect(rows().filter((row) => row.prezzo === null)).toHaveLength(73);
    // Chi ha un prezzo, ce l'ha sopra lo zero: da 1 a 155.
    const prezzi = rows()
      .map((row) => row.prezzo)
      .filter((prezzo): prezzo is number => prezzo !== null);
    expect(Math.min(...prezzi)).toBe(1);
    expect(Math.max(...prezzi)).toBe(155);
  });

  /**
   * ⚠ **Il `PMA` non è `Prezzo` in un'altra unità, ed è questo test a dirlo.**
   *
   * La spec di M10B l'aveva scartata come «dato derivato, `Prezzo` diviso il
   * budget». Misurato quando l'owner l'ha chiesta: **solo 132 righe su 385**
   * coincidono con `round(prezzo / 5, 1)`. La correlazione coi prezzi è alta —
   * 0,969, perché entrambe seguono il valore di un giocatore — e il rapporto ha
   * mediana **esattamente 5**, ma quella mediana la fanno i **166 giocatori da un
   * credito**, dove `0,2%` è l'unico valore scrivibile. Fuori da quelli le due
   * colonne dicono cose diverse: Di Gregorio costa 41 con `PMA` 2,5% (da `prezzo`
   * verrebbe 8,2), De Gea costa 24 con 6,4% (verrebbe 4,8).
   *
   * I numeri sono **esatti** come tutti gli altri di questo file: se un giorno il
   * foglio venisse ricompilato, cambiano insieme alla fixture — e cambiando
   * direbbero che quella colonna ha cambiato significato, che è precisamente ciò
   * che si vuole sapere.
   */
  it("⚠ il PMA non si ricalcola dal prezzo: solo 132 righe su 385 coinciderebbero", () => {
    const both = rows().filter(
      (row): row is typeof row & { prezzo: number; pma: number } =>
        row.prezzo !== null && row.pma !== null,
    );
    expect(both).toHaveLength(385);

    const round1 = (x: number) => Math.round(x * 10) / 10;
    const coincidono = both.filter(
      (row) => Math.abs(row.pma - round1(row.prezzo / 5)) < 0.051,
    );
    expect(coincidono).toHaveLength(132);

    // La mediana del rapporto è 5, e da sola sarebbe stata fuorviante.
    const ratios = both.map((row) => row.prezzo / row.pma).sort((a, b) => a - b);
    expect(ratios[Math.floor(ratios.length / 2)]).toBeCloseTo(5, 6);

    // I tre casi col nome dentro, così nessuno «corregge» quelle righe.
    expect(rows().find((row) => row.name === "Di Gregorio")).toMatchObject({
      prezzo: 41,
      pma: 2.5,
    });
    expect(rows().find((row) => row.name === "De Gea")).toMatchObject({
      prezzo: 24,
      pma: 6.4,
    });
    expect(rows().find((row) => row.name === "Mkhitaryan")).toMatchObject({
      prezzo: 14,
      pma: 0.2,
    });
  });

  it("legge il PMA come numero, non come la stringa col simbolo dentro", () => {
    // Nel foglio è testo: `"10.5%"`, `"9%"`. Qui esce `10.5` e `9`.
    expect(rows().find((row) => row.name === "Svilar")?.pma).toBeCloseTo(10.5);
    expect(rows().find((row) => row.name === "Martinez Jo.")?.pma).toBe(9);
    expect(rows().every((row) => row.pma === null || typeof row.pma === "number")).toBe(
      true,
    );
  });

  it("⚠ lo `0%` è assente, e i due zeri non coincidono con quelli del prezzo", () => {
    const senzaPma = rows().filter((row) => row.pma === null);
    const senzaPrezzo = rows().filter((row) => row.prezzo === null);
    expect(senzaPma).toHaveLength(67);
    expect(senzaPrezzo).toHaveLength(73);
    // In comune 28: è l'altra faccia della deriva fra le due colonne, e il motivo
    // per cui nessuna delle due si deduce dall'altra.
    const entrambi = rows().filter(
      (row) => row.pma === null && row.prezzo === null,
    );
    expect(entrambi).toHaveLength(28);
  });

  it("le fasce sono le sette dichiarate, e `Non Impostata` diventa `null` su 84", () => {
    const dist: Record<string, number> = {};
    for (const row of rows()) dist[row.fascia ?? "null"] = (dist[row.fascia ?? "null"] ?? 0) + 1;
    expect(dist).toEqual({
      Top: 26,
      "Semi-Top": 44,
      Terza: 52,
      Quarta: 58,
      "Scomm.": 80,
      'Titolare "Scarso"': 42,
      Outsider: 111,
      null: 84,
    });
    // ⚠ Ogni fascia del file è fra quelle che l'applicazione sa ordinare: una in
    // più comparirebbe qui, prima che in fondo a una colonna senza spiegazione.
    for (const fascia of Object.keys(dist)) {
      if (fascia === "null") continue;
      expect(CARMY_FASCE).toContain(fascia);
    }
  });

  it("le cinque note diventano un array: 396 giocatori, 17 etichette", () => {
    const conTag = rows().filter((row) => row.tags.length > 0);
    expect(conTag).toHaveLength(396);
    const etichette = new Set(rows().flatMap((row) => row.tags));
    expect(etichette.size).toBe(17);
    // Le tre che contano per l'asta e che la fonte B racconta in un altro modo.
    expect(rows().filter((row) => row.tags.includes("rigorista"))).toHaveLength(18);
    expect(rows().filter((row) => row.tags.includes("titolarissimo"))).toHaveLength(106);
    expect(rows().filter((row) => row.tags.includes("bonus"))).toHaveLength(118);
    // Nessun vuoto sopravvive alla compattazione.
    expect(rows().flatMap((row) => row.tags).filter((tag) => tag.trim() === "")).toEqual([]);
  });

  it("⚠ il commento con solo un `\\n` è vuoto: 10 commenti, non 11", () => {
    const commenti = rows().filter((row) => row.commento !== null);
    expect(commenti).toHaveLength(10);
    // Sono gli abbinamenti dei portieri, che M8 §9 aveva rinviato a una macro sua.
    expect(commenti.every((row) => row.role === "P")).toBe(true);
    expect(rows().find((row) => row.name === "De Gea")?.commento).toContain("ABBIN a 2");
  });

  it("la fantamedia attesa c'è su 494 righe su 497", () => {
    expect(rows().filter((row) => row.fmvExp !== null)).toHaveLength(494);
  });

  it("⚠ non importa nessuna statistica: Carmy non ne porta di nuove", () => {
    // Le undici colonne identiche byte per byte alla fonte A non entrano nel tipo,
    // e nemmeno `Pt. Inf.` — che **non** è «partite saltate» ma il campo `injured`.
    // Se un giorno qualcuno le aggiunge, questo test lo ferma e gli fa rileggere §1.
    const keys = Object.keys(rows()[0]).sort();
    expect(keys).toEqual([
      "affidabilita",
      "commento",
      "fascia",
      "fmvExp",
      "integrita",
      "name",
      "pma",
      "prezzo",
      "role",
      "tags",
      "team",
      "titolarita",
    ]);
  });
});

describe("parseCarmy — i rifiuti, che sono il punto del parser", () => {
  it("rifiuta byte che non sono un .xlsx", () => {
    const result = parseCarmy(new TextEncoder().encode("non sono un foglio"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // ⚠ **Due codici e non uno**, per la stessa ragione che il test del listone ha
    // già scritto: `XLSX.read` non lancia su del testo qualsiasi, lo legge come un
    // foglio unico chiamato `Sheet1`. Quindi il rifiuto arriva un passo più tardi,
    // sul foglio che manca — e il messaggio che ne esce («fogli trovati: Sheet1»)
    // è comunque quello giusto da leggere.
    expect(["CARMY_UNREADABLE", "CARMY_SHEET_MISSING"]).toContain(
      result.error.code,
    );
  });

  it("rifiuta un file che il lettore non riesce nemmeno ad aprire", () => {
    // Un archivio zip cifrato: è il caso in cui `XLSX.read` lancia davvero.
    const zip = new Uint8Array(44);
    zip.set([0x50, 0x4b, 0x03, 0x04]);
    zip.fill(7, 4);
    const result = parseCarmy(zip);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CARMY_UNREADABLE");
  });

  it("rifiuta un file a cui manca uno dei quattro fogli, e dice quale", () => {
    const result = parseCarmy(workbookFrom({}, ["P", "D", "C"]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CARMY_SHEET_MISSING");
    expect(result.error.message).toContain('"A"');
  });

  /** La riga di prova senza una colonna: è così che si finge un file rinominato. */
  function senza(colonna: string): Record<string, unknown> {
    const row: Record<string, unknown> = { ...ROW };
    delete row[colonna];
    return row;
  }

  it("⚠ rifiuta un'intestazione cambiata, e dice quale colonna manca", () => {
    const result = parseCarmy(
      workbookFrom({ C: [{ ...senza("Titolarità"), "Tit.": 5 }] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CARMY_COLUMNS_MISSING");
    expect(result.error.message).toContain("Titolarità");
    expect(result.error.message).toContain('"C"');
  });

  it("rifiuta un file a cui mancano le note: i tag sparirebbero in silenzio", () => {
    const result = parseCarmy(workbookFrom({ A: [senza("Nota 3")] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CARMY_COLUMNS_MISSING");
    expect(result.error.message).toContain("Nota 3");
  });

  it("⚠ rifiuta un voto fuori scala: una scala cambiata è un badge verde a caso", () => {
    const result = parseCarmy(workbookFrom({ D: [{ ...ROW, Titolarità: 8 }] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CARMY_ROW_INVALID");
    expect(result.error.message).toContain("da 1 a 5");
  });

  it("⚠ rifiuta due righe con lo stesso nome: il nome è la chiave del join", () => {
    const result = parseCarmy(
      workbookFrom({ P: [ROW, { ...ROW, Team: "INT" }] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CARMY_DUPLICATE_NAME");
    expect(result.error.message).toContain("Rossi");
  });

  it("rifiuta una riga senza nome", () => {
    const result = parseCarmy(workbookFrom({ P: [{ ...ROW, Nome: "  " }] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CARMY_ROW_INVALID");
  });

  it("rifiuta un foglio vuoto", () => {
    const result = parseCarmy(workbookFrom({ A: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CARMY_EMPTY");
  });

  it("accetta un file minimo con tutte le colonne al posto giusto", () => {
    const result = parseCarmy(workbookFrom({}));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(4);
    expect(result.value.map((row) => row.role)).toEqual(["P", "D", "C", "A"]);
    expect(result.value[0]).toMatchObject({
      fascia: "Top",
      prezzo: 30,
      titolarita: 5,
      tags: ["titolarissimo"],
      commento: null,
    });
  });
});

describe("CARMY_TEAM_BY_SIGLA — la mappa che va rigenerata a ogni promozione", () => {
  /** Le squadre del listone di riferimento, per esteso. */
  function squadreDelListone(): Set<string> {
    const listone = parseListone(
      readFileSync(fileURLToPath(new URL("../fixtures/listone.xlsx", import.meta.url))),
    );
    if (!listone.ok) throw new Error(listone.error.message);
    return new Set(listone.value.map((row) => row.team));
  }

  it("traduce tutte e venti le sigle che compaiono nel foglio", () => {
    const sigle = new Set(rows().map((row) => row.team));
    expect(sigle.size).toBe(20);
    for (const sigla of sigle) {
      expect(CARMY_TEAM_BY_SIGLA[sigla], `la sigla ${sigla} non è in mappa`).toBeDefined();
    }
  });

  it("⚠ e le traduce nelle squadre del listone, non in venti stringhe qualsiasi", () => {
    // È questo il test che si accorge di una promozione dimenticata: il giorno in
    // cui il listone porta una squadra nuova, il foglio porta una sigla nuova, e
    // una delle due parti resta indietro. Meglio un rosso qui che un giudizio che
    // non aggancia.
    const squadre = squadreDelListone();
    expect(squadre.size).toBe(20);
    const tradotte = new Set(
      [...new Set(rows().map((row) => row.team))].map(
        (sigla) => CARMY_TEAM_BY_SIGLA[sigla],
      ),
    );
    expect([...tradotte].sort()).toEqual([...squadre].sort());
  });

  it("la mappa non ha righe di troppo: venti sigle, venti squadre distinte", () => {
    const valori = Object.values(CARMY_TEAM_BY_SIGLA);
    expect(valori).toHaveLength(20);
    expect(new Set(valori).size).toBe(20);
  });
});

describe("normalizeCarmyName", () => {
  it("toglie accenti, spazi e maiuscole, e nient'altro", () => {
    expect(normalizeCarmyName("  Dodò ")).toBe("dodo");
    expect(normalizeCarmyName("Zè  Pedro")).toBe("ze pedro");
    expect(normalizeCarmyName("Konè M.")).toBe("kone m.");
    // Il punto resta: `Konè M.` e `Konè I.` sono due giocatori diversi.
    expect(normalizeCarmyName("Konè I.")).not.toBe(normalizeCarmyName("Konè M."));
  });

  it("⚠ non prova a indovinare: due nomi diversi restano diversi", () => {
    expect(normalizeCarmyName("Esposito Se.")).not.toBe(
      normalizeCarmyName("Esposito Fr."),
    );
    expect(normalizeCarmyName("Pellegrini Lo.")).not.toBe(
      normalizeCarmyName("Pellegrini"),
    );
  });
});
