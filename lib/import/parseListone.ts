import * as XLSX from "xlsx";

import { ROLES, type Role } from "@/lib/domain";
import { type Result, fail, ok } from "@/lib/engine/errors";

/**
 * Il parser del listone Fantacalcio.it (PLAN §13).
 *
 * È una funzione pura: prende i byte del file, restituisce righe o un errore
 * tipizzato. Non tocca il database e non conserva il file — **il .xlsx viene
 * buttato dopo l'estrazione** (P6). L'export di Fase 7 rigenererà il layout a
 * partire da questi dati, lasciando vuote le colonne che non importiamo.
 *
 * Il formato di riferimento, verificato sulla fixture:
 *
 *   foglio "Lista calciatori", intestazione in riga 1, 495 righe di dati
 *   #  Nome  Fuori lista  Sq.  Under  R.  R.MANTRA  PGv  MV  FM  FVM/1000  QUOT.  FantaSquadra  Costo
 *
 * `Under` contiene l'età, non un flag: si ignora, come `PGv`, `MV` e `FM`.
 * `Fuori lista` è valorizzata con `*` per i giocatori fuori lista e vuota per
 * gli altri: qualunque contenuto non vuoto vale come "fuori lista".
 */

export const SHEET_NAME = "Lista calciatori";

const COLUMNS = {
  extId: "#",
  name: "Nome",
  outOfList: "Fuori lista",
  team: "Sq.",
  role: "R.",
  roleMantra: "R.MANTRA",
  fvm: "FVM/1000",
  quot: "QUOT.",
} as const;

/** Le colonne senza le quali non si va da nessuna parte. */
const REQUIRED_COLUMNS = [
  COLUMNS.extId,
  COLUMNS.name,
  COLUMNS.team,
  COLUMNS.role,
  COLUMNS.fvm,
  COLUMNS.quot,
] as const;

export type ParsedPlayer = {
  extId: number;
  name: string;
  team: string;
  role: Role;
  roleMantra: string | null;
  fvm: number;
  quot: number;
  outOfList: boolean;
};

type RawRow = Record<string, unknown>;

function asInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const cleaned = value.trim().replace(",", ".");
    if (cleaned === "") return null;
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return null;
    return Math.trunc(parsed);
  }
  return null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

export function parseListone(
  file: ArrayBuffer | Uint8Array,
): Result<ParsedPlayer[]> {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(file, { type: "array" });
  } catch {
    return fail(
      "LISTONE_UNREADABLE",
      "Non riesco ad aprire il file: assicurati che sia il .xlsx scaricato da Fantacalcio.it.",
    );
  }

  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) {
    return fail(
      "LISTONE_SHEET_MISSING",
      `Nel file manca il foglio "${SHEET_NAME}". Fogli trovati: ${
        workbook.SheetNames.join(", ") || "nessuno"
      }.`,
    );
  }

  const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, {
    raw: true,
    defval: null,
  });

  if (rows.length === 0) {
    return fail("LISTONE_EMPTY", "Il foglio del listone è vuoto.");
  }

  const header = Object.keys(rows[0]);
  const missing = REQUIRED_COLUMNS.filter((col) => !header.includes(col));
  if (missing.length > 0) {
    return fail(
      "LISTONE_COLUMNS_MISSING",
      `Nel listone mancano le colonne: ${missing.join(", ")}.`,
    );
  }

  const players: ParsedPlayer[] = [];
  const seen = new Set<number>();

  for (const [index, row] of rows.entries()) {
    // +2: l'intestazione è la riga 1, quindi la prima riga di dati è la 2.
    const line = index + 2;

    const extId = asInteger(row[COLUMNS.extId]);
    if (extId === null) {
      return fail(
        "LISTONE_ROW_INVALID",
        `Riga ${line}: la colonna "${COLUMNS.extId}" non contiene un numero.`,
      );
    }
    if (seen.has(extId)) {
      return fail(
        "LISTONE_DUPLICATE_ID",
        `Riga ${line}: l'identificativo ${extId} compare due volte nel file.`,
      );
    }
    seen.add(extId);

    const name = asText(row[COLUMNS.name]);
    if (name === "") {
      return fail("LISTONE_ROW_INVALID", `Riga ${line}: manca il nome.`);
    }

    const role = asText(row[COLUMNS.role]).toUpperCase();
    if (!(ROLES as readonly string[]).includes(role)) {
      return fail(
        "LISTONE_ROW_INVALID",
        `Riga ${line}: ruolo "${role}" non riconosciuto (attesi ${ROLES.join(", ")}).`,
      );
    }

    const fvm = asInteger(row[COLUMNS.fvm]);
    const quot = asInteger(row[COLUMNS.quot]);
    if (fvm === null || quot === null) {
      return fail(
        "LISTONE_ROW_INVALID",
        `Riga ${line}: "${COLUMNS.fvm}" e "${COLUMNS.quot}" devono essere numeri.`,
      );
    }

    const mantra = asText(row[COLUMNS.roleMantra]);

    players.push({
      extId,
      name,
      team: asText(row[COLUMNS.team]),
      role: role as Role,
      roleMantra: mantra === "" ? null : mantra,
      fvm,
      quot,
      // Qualunque contenuto non vuoto significa "fuori lista": nella fixture è `*`.
      outOfList: asText(row[COLUMNS.outOfList]) !== "",
    });
  }

  return ok(players);
}

/**
 * Il pool acquistabile per ruolo a partire dalle righe lette, cioè il termine
 * sinistro di I9. Sta qui e non in `setup.ts` per poter essere provato senza
 * un database acceso.
 */
export function countPool(
  rows: Pick<ParsedPlayer, "role" | "outOfList">[],
  includeOutOfList: boolean,
): Record<Role, number> {
  const counts: Record<Role, number> = { P: 0, D: 0, C: 0, A: 0 };
  for (const row of rows) {
    if (row.outOfList && !includeOutOfList) continue;
    counts[row.role] += 1;
  }
  return counts;
}
