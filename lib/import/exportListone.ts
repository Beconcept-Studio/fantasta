import * as XLSX from "xlsx";

import type { Role } from "@/lib/domain";

import { SHEET_NAME } from "./parseListone";

/**
 * L'export del listone con le rose dentro (PLAN §13, ⚠ P6).
 *
 * È il gemello di `parseListone`, e come quello è una funzione pura: prende
 * righe, restituisce byte. Serve a una cosa sola — **rimettere il risultato
 * dell'asta su Fantacalcio.it** — e quindi il file deve avere la forma che
 * Fantacalcio.it si aspetta: foglio `Lista calciatori`, intestazione in riga 1,
 * quattordici colonne nell'ordine originale, `FantaSquadra` e `Costo`
 * riempite.
 *
 * **Il file di partenza non esiste più.** All'import ne estraiamo i dati e lo
 * buttiamo (⚠ P6, DECISIONS 2026-08-06): qui il layout si ricostruisce da zero
 * a partire da `players`. Le quattro colonne che non importiamo — `Under`
 * (l'età), `PGv`, `MV`, `FM` — restano **vuote**, non a zero: una cella vuota
 * dice «non lo so», uno zero dice «zero», e sono due cose diverse per chi
 * riapre il file.
 *
 * L'intestazione la scriviamo comunque tutta e nell'ordine giusto: è ciò che
 * rende il file riconoscibile a occhio e reimportabile dal nostro stesso
 * parser, che è come il test lo verifica.
 *
 * «Vuota» significa `null`, cioè **nessuna cella**, non una cella con dentro
 * una stringa vuota: la seconda è un valore, e in Excel si comporta da valore
 * (una colonna filtrata la vede, un `COUNTA` la conta).
 */

/** Le quattordici colonne del file Fantacalcio.it, nell'ordine originale. */
export const EXPORT_COLUMNS = [
  "#",
  "Nome",
  "Fuori lista",
  "Sq.",
  "Under",
  "R.",
  "R.MANTRA",
  "PGv",
  "MV",
  "FM",
  "FVM/1000",
  "QUOT.",
  "FantaSquadra",
  "Costo",
] as const;

export type ExportPlayer = {
  extId: number;
  name: string;
  team: string;
  role: Role;
  roleMantra: string | null;
  fvm: number;
  quot: number;
  outOfList: boolean;
  /** Il nome squadra di chi lo possiede; `null` se è rimasto senza padrone. */
  teamName: string | null;
  /** Il prezzo pagato; `null` se non è stato comprato. */
  price: number | null;
};

/**
 * Le righe del foglio, prima di diventare byte. Esportata perché è la forma su
 * cui il test guarda i valori senza dover riaprire un workbook.
 */
export function exportRows(
  players: ExportPlayer[],
): Record<string, string | number | null>[] {
  return players.map((p) => ({
    "#": p.extId,
    Nome: p.name,
    // Nel file originale i fuori lista sono marcati con `*` e gli altri hanno
    // la cella vuota: `parseListone` legge «qualunque contenuto non vuoto».
    "Fuori lista": p.outOfList ? "*" : null,
    "Sq.": p.team,
    Under: null,
    "R.": p.role,
    "R.MANTRA": p.roleMantra,
    PGv: null,
    MV: null,
    FM: null,
    "FVM/1000": p.fvm,
    "QUOT.": p.quot,
    FantaSquadra: p.teamName,
    Costo: p.price,
  }));
}

/** Il .xlsx completo, pronto da scaricare. */
export function buildListoneXlsx(players: ExportPlayer[]): Uint8Array {
  const sheet = XLSX.utils.json_to_sheet(exportRows(players), {
    // Senza questo, `json_to_sheet` deduce l'intestazione dalle chiavi del
    // primo oggetto: l'ordine sarebbe quello di iterazione, non quello di
    // Fantacalcio.it, e le colonne sempre vuote potrebbero sparire del tutto.
    header: [...EXPORT_COLUMNS],
  });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, SHEET_NAME);
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
}

/**
 * Il nome del file scaricato: «Asta di prova» → `asta-di-prova-listone.xlsx`.
 * Niente accenti né spazi, perché finisce in un header HTTP e poi nel
 * filesystem di chi scarica.
 *
 * Il `basename` è il secondo parametro da M3 (§1), da quando gli export sono
 * due: `"listone.xlsx"` e `"rose.csv"`. Prima era fisso a `-rose.xlsx`, che con
 * un vero export delle rose accanto mentirebbe — e il nome del file è l'unica
 * cosa che resta a chi lo ritrova nei download sei mesi dopo.
 *
 * Resta qui, e non in un modulo suo, perché è l'unico pezzo che i due export
 * condividono: una seconda funzione che fa lo slug divergerebbe dalla prima
 * entro un anno.
 */
export function exportFileName(auctionName: string, basename: string): string {
  const slug = auctionName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug === "" ? "asta" : slug}-${basename}`;
}
