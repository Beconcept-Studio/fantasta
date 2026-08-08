import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

import { advancePhase, pickPlayer, placeBid, startAuction } from "@/lib/engine/actions";
import { exportXlsx } from "@/lib/engine/export";
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
    expect(exportFileName("Asta di prova")).toBe("asta-di-prova-rose.xlsx");
    expect(exportFileName("Lega Città 2026/27")).toBe("lega-citta-2026-27-rose.xlsx");
    expect(exportFileName("!!!")).toBe("asta-rose.xlsx");
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
    expect(file.fileName).toBe("asta-di-gioco-rose.xlsx");

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
