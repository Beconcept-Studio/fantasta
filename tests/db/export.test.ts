import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

import { advancePhase, pickPlayer, placeBid, startAuction } from "@/lib/engine/actions";
import { exportRoseCsv, exportXlsx } from "@/lib/engine/export";
import { setBroadcastHook } from "@/lib/engine/mutate";
import { manualAssign, voidAssignment } from "@/lib/engine/override";
import { loadForSnapshot } from "@/lib/engine/snapshot";
import { EXPORT_COLUMNS, exportFileName } from "@/lib/import/exportListone";
import { SHEET_NAME, parseListone } from "@/lib/import/parseListone";

import { type GameAuction, makeGameAuction } from "./game-helpers";
import {
  closeDatabase,
  databaseAvailable,
  dropAuctions,
  dropUsers,
} from "./helpers";

/**
 * F7-06 — l'export xlsx (⚠ P6).
 *
 * Il criterio ✅ della fase è che il file abbia `FantaSquadra` e `Costo`
 * riempite e che riapra correttamente. «Riapre correttamente» qui vuol dire
 * una cosa verificabile: **il nostro stesso parser lo accetta**. Se
 * `parseListone` lo rilegge senza errori e ritrova gli stessi 40 giocatori, il
 * file ha foglio, intestazione e tipi giusti — che è tutto ciò che Excel
 * guarda.
 */

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn("\n⚠ Postgres non raggiungibile: i test dell'export sono saltati.\n");
}

const createdAuctions: string[] = [];
const createdUsers: string[] = [];

afterAll(async () => {
  if (!dbUp) return;
  setBroadcastHook(() => {});
  await dropAuctions(createdAuctions);
  await dropUsers(createdUsers);
  await closeDatabase();
});

function unwrap<T>(
  r: { ok: true; value: T } | { ok: false; error: { message: string } },
): T {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

async function gameAuction(): Promise<GameAuction> {
  const game = await makeGameAuction();
  createdAuctions.push(game.auctionId);
  createdUsers.push(...game.userIds);
  return game;
}

/** Le righe del foglio esportato, come oggetti chiave → valore. */
function sheetRows(bytes: Uint8Array): Record<string, unknown>[] {
  const book = XLSX.read(bytes, { type: "array" });
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(
    book.Sheets[SHEET_NAME],
    { raw: true, defval: null },
  );
}

describe("exportFileName", () => {
  it("fa uno slug adatto a un header HTTP", () => {
    expect(exportFileName("Asta di prova", "listone.xlsx")).toBe(
      "asta-di-prova-listone.xlsx",
    );
    expect(exportFileName("Lega Città 2026/27", "listone.xlsx")).toBe(
      "lega-citta-2026-27-listone.xlsx",
    );
    expect(exportFileName("!!!", "listone.xlsx")).toBe("asta-listone.xlsx");
  });

  /**
   * M3 §1 — i due export convivono, quindi il nome del file deve dire quale
   * dei due hai in mano. Prima di M3 il listone si scaricava come
   * `<asta>-rose.xlsx`, che con un vero export delle rose accanto mentirebbe.
   */
  it("distingue i due export nel nome del file", () => {
    expect(exportFileName("Asta di prova", "rose.csv")).toBe(
      "asta-di-prova-rose.csv",
    );
  });
});

describe.runIf(dbUp)("F7-06 — exportXlsx", () => {
  beforeEach(() => {
    vi.useRealTimers(); // pg fa I/O vero
    setBroadcastHook(() => {});
  });

  it("riempie FantaSquadra e Costo, e lascia vuoto chi non è stato comprato", async () => {
    const now = Date.now();
    const game = await gameAuction();
    const state = (await loadForSnapshot(game.auctionId))!.state;
    const [keeper, altroKeeper] = state.players.filter((p) => p.role === "P");

    // Un giocatore comprato all'asta…
    unwrap(await startAuction(game.ownerId, game.auctionId, 0, now));
    unwrap(await pickPlayer(game.userIds[0], game.auctionId, keeper.id, now + 500));
    unwrap(await placeBid(game.userIds[1], game.auctionId, 17, now + 1000));
    unwrap(await advancePhase(game.auctionId, now + 3500));
    // …e uno assegnato a mano.
    unwrap(
      await manualAssign(
        game.ownerId,
        game.auctionId,
        { memberId: game.memberIds[5], playerId: altroKeeper.id, price: 3 },
        now + 4000,
      ),
    );

    const file = unwrap(await exportXlsx(game.ownerId, game.auctionId));
    expect(file.assigned).toBe(2);
    // Da M3 il listone si chiama «listone»: `-rose` è dell'altro export.
    expect(file.fileName).toBe("asta-di-gioco-listone.xlsx");

    const rows = sheetRows(file.bytes);
    expect(rows).toHaveLength(40); // tutto il listone, non solo le rose

    const comprato = rows.find((r) => r.Nome === `Giocatore ${keeper.extId}`)!;
    expect(comprato.FantaSquadra).toBe("Squadra 1");
    expect(comprato.Costo).toBe(17);

    const manuale = rows.find((r) => r.Nome === `Giocatore ${altroKeeper.extId}`)!;
    expect(manuale.FantaSquadra).toBe("Squadra 5");
    expect(manuale.Costo).toBe(3);

    // Chi non è stato comprato ha le due colonne vuote, non a zero.
    const liberi = rows.filter((r) => r.FantaSquadra === null);
    expect(liberi).toHaveLength(38);
    expect(liberi.every((r) => r.Costo === null)).toBe(true);
  });

  it("un'assegnazione annullata non finisce nel file (regola 5)", async () => {
    const now = Date.now();
    const game = await gameAuction();
    const state = (await loadForSnapshot(game.auctionId))!.state;
    const striker = state.players.find((p) => p.role === "A")!;

    const { assignmentId } = unwrap(
      await manualAssign(
        game.ownerId,
        game.auctionId,
        { memberId: game.memberIds[2], playerId: striker.id, price: 40 },
        now,
      ),
    );
    expect(unwrap(await exportXlsx(game.ownerId, game.auctionId)).assigned).toBe(1);

    unwrap(
      await voidAssignment(game.ownerId, game.auctionId, assignmentId, now + 10),
    );

    const dopo = unwrap(await exportXlsx(game.ownerId, game.auctionId));
    expect(dopo.assigned).toBe(0);
    const riga = sheetRows(dopo.bytes).find(
      (r) => r.Nome === `Giocatore ${striker.extId}`,
    )!;
    expect(riga.FantaSquadra).toBeNull();
    expect(riga.Costo).toBeNull();
  });

  it("il file riapre nel nostro stesso parser, con tutte le colonne al posto giusto", async () => {
    const now = Date.now();
    const game = await gameAuction();
    const state = (await loadForSnapshot(game.auctionId))!.state;
    const striker = state.players.find((p) => p.role === "A")!;
    unwrap(
      await manualAssign(
        game.ownerId,
        game.auctionId,
        { memberId: game.memberIds[1], playerId: striker.id, price: 55 },
        now,
      ),
    );

    const file = unwrap(await exportXlsx(game.ownerId, game.auctionId));

    // L'intestazione è quella di Fantacalcio.it, nell'ordine originale: le
    // quattro colonne che non importiamo ci sono comunque, vuote.
    const book = XLSX.read(file.bytes, { type: "array" });
    const header = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[SHEET_NAME], {
      header: 1,
    })[0];
    expect(header).toEqual([...EXPORT_COLUMNS]);

    // E il reimport lo accetta: stessi giocatori, stessi ruoli, stessi valori.
    const reimport = parseListone(file.bytes);
    expect(reimport.ok).toBe(true);
    if (!reimport.ok) return;
    expect(reimport.value).toHaveLength(40);
    const riletto = reimport.value.find((p) => p.extId === striker.extId)!;
    expect(riletto).toMatchObject({
      name: `Giocatore ${striker.extId}`,
      role: "A",
      fvm: striker.fvm,
      quot: striker.quot,
      outOfList: false,
    });
  });

  it("solo l'owner, e un'asta inesistente è un 404", async () => {
    const game = await gameAuction();
    expect(await exportXlsx(game.userIds[3], game.auctionId)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await exportXlsx(game.ownerId, "undefined")).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });
});

/**
 * M3 §1 — il verbale delle rose.
 *
 * L'altro export, quello del listone, dice cosa è successo a **ogni giocatore**
 * del listone; questo dice cosa c'è **in ogni rosa**, e nient'altro. La forma
 * del file è già collaudata a parte in `tests/rose-csv.test.ts`, senza
 * Postgres: qui si prova solo ciò che il database decide — chi entra, chi no, e
 * in che ordine.
 */
describe.runIf(dbUp)("M3 — exportRoseCsv", () => {
  beforeEach(() => {
    vi.useRealTimers();
    setBroadcastHook(() => {});
  });

  /** Il .csv riletto come righe di celle. */
  function csvRows(bytes: Uint8Array): string[][] {
    return new TextDecoder()
      .decode(bytes)
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => line.split(","));
  }

  it("scrive solo gli assegnati, con le tre colonne della richiesta", async () => {
    const now = Date.now();
    const game = await gameAuction();
    const state = (await loadForSnapshot(game.auctionId))!.state;
    const [keeper, altroKeeper] = state.players.filter((p) => p.role === "P");

    // Uno comprato all'asta…
    unwrap(await startAuction(game.ownerId, game.auctionId, 0, now));
    unwrap(await pickPlayer(game.userIds[0], game.auctionId, keeper.id, now + 500));
    unwrap(await placeBid(game.userIds[1], game.auctionId, 17, now + 1000));
    unwrap(await advancePhase(game.auctionId, now + 3500));
    // …e uno assegnato a mano.
    unwrap(
      await manualAssign(
        game.ownerId,
        game.auctionId,
        { memberId: game.memberIds[5], playerId: altroKeeper.id, price: 3 },
        now + 4000,
      ),
    );

    const file = unwrap(await exportRoseCsv(game.ownerId, game.auctionId));
    expect(file.fileName).toBe("asta-di-gioco-rose.csv");
    expect(file.assigned).toBe(2);

    const rows = csvRows(file.bytes);
    expect(rows[0]).toEqual(["nome_squadra", "id_calciatore", "crediti_spesi"]);
    // Due assegnazioni, quindi due righe oltre all'intestazione: gli altri 38
    // giocatori del listone qui non esistono.
    expect(rows).toHaveLength(3);
    expect(rows).toContainEqual(["Squadra 1", String(keeper.extId), "17"]);
    expect(rows).toContainEqual(["Squadra 5", String(altroKeeper.extId), "3"]);
  });

  it("un'assegnazione annullata non compare (regola 5)", async () => {
    const now = Date.now();
    const game = await gameAuction();
    const state = (await loadForSnapshot(game.auctionId))!.state;
    const striker = state.players.find((p) => p.role === "A")!;

    const { assignmentId } = unwrap(
      await manualAssign(
        game.ownerId,
        game.auctionId,
        { memberId: game.memberIds[2], playerId: striker.id, price: 40 },
        now,
      ),
    );
    expect(unwrap(await exportRoseCsv(game.ownerId, game.auctionId)).assigned).toBe(1);

    unwrap(
      await voidAssignment(game.ownerId, game.auctionId, assignmentId, now + 10),
    );

    const dopo = unwrap(await exportRoseCsv(game.ownerId, game.auctionId));
    expect(dopo.assigned).toBe(0);
    expect(csvRows(dopo.bytes)).toHaveLength(1); // la sola intestazione
  });

  it("ordina le righe per posto in tavolo, così le rose si leggono a blocchi", async () => {
    const now = Date.now();
    const game = await gameAuction();
    const state = (await loadForSnapshot(game.auctionId))!.state;
    const [primo, secondo] = state.players.filter((p) => p.role === "D");

    // Assegnati in ordine inverso di posto: il file deve rimetterli in ordine.
    unwrap(
      await manualAssign(
        game.ownerId,
        game.auctionId,
        { memberId: game.memberIds[6], playerId: primo.id, price: 10 },
        now,
      ),
    );
    unwrap(
      await manualAssign(
        game.ownerId,
        game.auctionId,
        { memberId: game.memberIds[3], playerId: secondo.id, price: 20 },
        now + 10,
      ),
    );

    const rows = csvRows(unwrap(await exportRoseCsv(game.ownerId, game.auctionId)).bytes);
    expect(rows.slice(1).map((r) => r[0])).toEqual(["Squadra 3", "Squadra 6"]);
  });

  it("solo l'owner, e un'asta inesistente è un 404", async () => {
    const game = await gameAuction();
    expect(await exportRoseCsv(game.userIds[3], game.auctionId)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await exportRoseCsv(game.ownerId, "undefined")).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });
});
