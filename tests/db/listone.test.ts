import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, it, suite, vi } from "vitest";

import { db } from "@/lib/db";
import { auctions, listonePlayers, players } from "@/lib/db/schema";
import { transition } from "@/lib/engine/machine";
import {
  centroDatiRows,
  listoneExtIds,
  listoneStatus,
  readListoneForCopy,
  uploadListone,
} from "@/lib/engine/listone";
import { loadAuctionState, persistTransition } from "@/lib/engine/mutate";
import {
  createAuction,
  importPlayers,
  importPlayersFromListone,
} from "@/lib/engine/setup";
import { DEFAULT_CONFIG } from "@/lib/engine/setup-rules";

import { makeGameAuction, markAllPresent, syntheticListone } from "./game-helpers";
import {
  closeDatabase,
  databaseAvailable,
  dropAuctions,
  dropUsers,
  makeUser,
} from "./helpers";

/**
 * M10 — il listone a sistema.
 *
 * ## La difesa più importante di questa macro
 *
 * `listone_players` è una **sorgente da cui si copia, mai una tabella da cui
 * l'asta legge** (M10 §3). Il test che lo dimostra è quello che porta un'asta
 * fino a `COMPLETED` con la tabella **vuota**: se un giorno un `JOIN` verso
 * quella tabella comparisse in `machine.ts`, `rules.ts`, `snapshot.ts` o in
 * `listPickPool`, è lì che si romperebbe.
 *
 * ## E quella che protegge l'auto-pick
 *
 * La copia dal sistema e l'upload dello stesso file devono produrre **le stesse
 * righe** di `players`, `fvm` e `out_of_list` compresi. `players_autopick_idx`
 * ordina per `fvm` DESC, e quell'ordinamento *è* l'auto-pick: senza questo
 * confronto, una colonna tolta per una decisione di layout cambierebbe chi viene
 * scelto allo scadere di una chiamata (M10 §2).
 *
 * ## ⚠ Perché qui non si scrive mai su `player_insights`
 *
 * Quella tabella è **globale e condivisa**, e `tests/db/insights.test.ts` la
 * svuota nel suo `beforeEach`: vitest gira i file in worker paralleli, quindi
 * una riga scritta da qui potrebbe sparire a metà di un test di lì — o, peggio,
 * comparire in mezzo a un conteggio suo e rompere un test che non c'entra
 * niente. È la stessa cicatrice del parametro `auctionIds` di `insightsCoverage`
 * («verde da solo, rosso nella suite»). Il `LEFT JOIN` del Centro dati si prova
 * quindi **solo dal lato che è deterministico**: `ext_id` sintetici altissimi,
 * che nessuna fonte ha e che quindi non avranno mai una riga di insight.
 */

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn(
    "\n⚠ Postgres non raggiungibile: i test del listone a sistema sono saltati.\n",
  );
}

const LISTONE = readFileSync(
  fileURLToPath(new URL("../../fixtures/listone.xlsx", import.meta.url)),
);

const createdAuctions: string[] = [];
const createdUsers: string[] = [];

async function user(label = "listone"): Promise<string> {
  const id = await makeUser(label);
  createdUsers.push(id);
  return id;
}

async function auction(
  ownerId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const result = await createAuction(ownerId, {
    name: "Asta M10",
    ...DEFAULT_CONFIG,
    ...overrides,
  });
  if (!result.ok) throw new Error(result.error.message);
  createdAuctions.push(result.value.auctionId);
  return result.value.auctionId;
}

async function statusOf(auctionId: string): Promise<string> {
  const row = await db.query.auctions.findFirst({
    where: eq(auctions.id, auctionId),
  });
  return row!.status;
}

/** Le righe di `players` di un'asta, nella forma confrontabile fra due import. */
async function playersOf(auctionId: string) {
  return db
    .select({
      extId: players.extId,
      name: players.name,
      team: players.team,
      role: players.role,
      roleMantra: players.roleMantra,
      fvm: players.fvm,
      quot: players.quot,
      outOfList: players.outOfList,
    })
    .from(players)
    .where(eq(players.auctionId, auctionId))
    .orderBy(asc(players.extId));
}

// `pg` fa vero I/O: i timer finti del setup condiviso qui darebbero fastidio.
beforeEach(async () => {
  vi.useRealTimers();
  if (dbUp) await db.delete(listonePlayers);
});

afterAll(async () => {
  if (!dbUp) return;
  await db.delete(listonePlayers);
  await dropAuctions(createdAuctions);
  await dropUsers(createdUsers);
  await closeDatabase();
});

// ─── L'upload ────────────────────────────────────────────────────────────────

suite.runIf(dbUp)("l'upload del listone a sistema", () => {
  it("legge il file vero: 495 righe, e la data è quella passata", async () => {
    const t0 = new Date("2026-08-12T21:30:00.000Z");
    const result = await uploadListone(LISTONE, t0);
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value.rows).toBe(495);
    const status = await listoneStatus();
    expect(status.rows).toBe(495);
    expect(status.uploadedAt?.getTime()).toBe(t0.getTime());
  });

  /**
   * ⚠ **Sostituisce, non fonde.** È l'unico modo di correggere un file sbagliato
   * senza inventare un merge fra due listoni: se il secondo upload si
   * accodasse, un file caricato per errore resterebbe dentro per sempre e non
   * ci sarebbe nessun modo di toglierlo dall'interfaccia.
   */
  it("un upload sostituisce l'intera tabella, non ci si accoda", async () => {
    await uploadListone(LISTONE, new Date("2026-08-01T10:00:00.000Z"));
    expect((await listoneStatus()).rows).toBe(495);

    const t1 = new Date("2026-08-12T10:00:00.000Z");
    const small = await uploadListone(syntheticListone(), t1);
    if (!small.ok) throw new Error(small.error.message);

    const status = await listoneStatus();
    expect(status.rows).toBe(40);
    expect(status.uploadedAt?.getTime()).toBe(t1.getTime());
    // Nessuna riga del listone grande è sopravvissuta: gli id del sintetico
    // arrivano a 40, quelli del file vero ben oltre.
    const ids = await listoneExtIds();
    expect(Math.max(...ids)).toBe(40);
  });

  it("un file illeggibile non tocca quello che c'è già", async () => {
    await uploadListone(LISTONE, new Date("2026-08-01T10:00:00.000Z"));

    const broken = await uploadListone(new Uint8Array([1, 2, 3, 4]));
    expect(broken.ok).toBe(false);
    expect((await listoneStatus()).rows).toBe(495);
  });

  /**
   * ⚠ **`fvm` e `out_of_list` sopravvivono all'upload**, anche se il Centro dati
   * non mostra il primo: sono le due colonne da cui dipendono l'auto-pick e I9.
   */
  it("conserva fvm e out_of_list, che non si vedono ma decidono", async () => {
    await uploadListone(LISTONE, new Date("2026-08-12T10:00:00.000Z"));

    const rows = await readListoneForCopy();
    expect(rows.every((row) => Number.isInteger(row.fvm))).toBe(true);
    expect(rows.some((row) => row.outOfList)).toBe(true);
    expect((await listoneStatus()).outOfList).toBeGreaterThan(0);
  });
});

// ─── La copia dentro l'asta ──────────────────────────────────────────────────

suite.runIf(dbUp)("la copia dentro l'asta", () => {
  /**
   * ⚠ **Il test che protegge l'ordinamento dell'auto-pick.** Le due strade —
   * caricare il file dentro l'asta, oppure caricarlo a sistema e copiarlo —
   * devono produrre righe **identiche**. Se un giorno la copia perdesse `fvm`
   * perché «tanto non si mostra», qui si vedrebbe subito.
   */
  it("produce le stesse righe dell'upload dello stesso file, fvm e out_of_list compresi", async () => {
    const owner = await user("copia");
    const daFile = await auction(owner);
    const daSistema = await auction(owner);

    const imported = await importPlayers(owner, daFile, LISTONE);
    if (!imported.ok) throw new Error(imported.error.message);

    await uploadListone(LISTONE, new Date("2026-08-12T10:00:00.000Z"));
    const copied = await importPlayersFromListone(owner, daSistema);
    if (!copied.ok) throw new Error(copied.error.message);

    expect(copied.value.imported).toBe(imported.value.imported);
    expect(copied.value.outOfList).toBe(imported.value.outOfList);
    expect(copied.value.counts).toEqual(imported.value.counts);
    expect(await playersOf(daSistema)).toEqual(await playersOf(daFile));
  });

  it("porta l'asta a READY come farebbe il file, se i posti sono pieni", async () => {
    const owner = await user("ready");
    const auctionId = await auction(owner, { seats: 8 });

    await uploadListone(LISTONE, new Date("2026-08-12T10:00:00.000Z"));
    const copied = await importPlayersFromListone(owner, auctionId);
    expect(copied.ok).toBe(true);
    // Nessun membro: resta DRAFT, ed è `recomputeStatus` a dirlo.
    expect(await statusOf(auctionId)).toBe("DRAFT");
  });

  /**
   * ⚠ **I9 si valida alla copia**, non all'upload: posti e slot sono di
   * un'asta, e lo stesso listone globale può passare per un'asta a 8 e fallire
   * per una a 12. **Ed è giusto che fallisca.**
   */
  it("fallisce se il listone non copre gli slot, e l'asta resta in DRAFT senza listone", async () => {
    const owner = await user("i9");
    const auctionId = await auction(owner, { seats: 12 });

    // 10 per ruolo: bastano a un'asta a 8 con 1 slot, non a una a 12 con gli
    // slot di default (3/8/8/6).
    await uploadListone(syntheticListone(), new Date("2026-08-12T10:00:00.000Z"));
    const copied = await importPlayersFromListone(owner, auctionId);

    expect(copied.ok).toBe(false);
    if (copied.ok) throw new Error("doveva fallire");
    expect(copied.error.code).toBe("LISTONE_INSUFFICIENT");
    expect(copied.error.message).toContain("il listone ne ha");

    expect(await statusOf(auctionId)).toBe("DRAFT");
    expect(await playersOf(auctionId)).toEqual([]);
  });

  it("con la tabella vuota rifiuta dicendo dove si carica, e non svuota l'asta", async () => {
    const owner = await user("vuoto");
    const auctionId = await auction(owner);
    const imported = await importPlayers(owner, auctionId, LISTONE);
    if (!imported.ok) throw new Error(imported.error.message);

    const copied = await importPlayersFromListone(owner, auctionId);
    expect(copied.ok).toBe(false);
    if (copied.ok) throw new Error("doveva fallire");
    expect(copied.error.message).toContain("Amministrazione");
    // Il listone che c'era è ancora lì: un rifiuto non è un `DELETE`.
    expect(await playersOf(auctionId)).toHaveLength(495);
  });

  it("chi non possiede l'asta non la può riempire", async () => {
    const owner = await user("proprietario");
    const estraneo = await user("estraneo");
    const auctionId = await auction(owner);
    await uploadListone(LISTONE, new Date("2026-08-12T10:00:00.000Z"));

    const copied = await importPlayersFromListone(estraneo, auctionId);
    expect(copied.ok).toBe(false);
    expect(await playersOf(auctionId)).toEqual([]);
  });

  /**
   * ⚠ **Il congelamento di `auction_id`, ed è la cosa che questa macro poteva
   * rompere di peggio.** Un'asta preparata lunedì non cambia perché martedì
   * qualcuno ha caricato in admin un file diverso: le rose, i prezzi e le regole
   * di quella serata sono appesi a quelle righe.
   */
  it("un'asta già preparata non cambia quando a sistema si carica un altro file", async () => {
    const owner = await user("congelata");
    const auctionId = await auction(owner, { seats: 8 });

    await uploadListone(LISTONE, new Date("2026-08-01T10:00:00.000Z"));
    const copied = await importPlayersFromListone(owner, auctionId);
    if (!copied.ok) throw new Error(copied.error.message);
    const prima = await playersOf(auctionId);
    expect(prima).toHaveLength(495);

    // Un file completamente diverso, caricato dopo.
    await uploadListone(syntheticListone(), new Date("2026-08-12T10:00:00.000Z"));
    expect((await listoneStatus()).rows).toBe(40);

    expect(await playersOf(auctionId)).toEqual(prima);
  });
});

// ─── Il percorso critico ─────────────────────────────────────────────────────

suite.runIf(dbUp)("nessun dato di M10 sta su un percorso critico", () => {
  /**
   * ⚠ **La verifica più importante della macro.** Un'asta si crea, si prepara e
   * arriva a `COMPLETED` con `listone_players` **vuota**: il listone a sistema
   * è una comodità del setup, e da lì in poi non esiste più. Se un giorno una
   * query di gioco andasse a leggere quella tabella, è qui che si romperebbe.
   *
   * Nessuno agisce: pick e round scadono, e l'asta si gioca da sola — la stessa
   * tecnica di `tests/engine/machine.test.ts`, ma contro Postgres.
   */
  it("un'asta si crea, si prepara e arriva a COMPLETED con la tabella vuota", async () => {
    expect((await listoneStatus()).rows).toBe(0);

    const game = await makeGameAuction();
    createdAuctions.push(game.auctionId);
    createdUsers.push(...game.userIds);
    if (!game.userIds.includes(game.ownerId)) createdUsers.push(game.ownerId);

    const row = async () => {
      const found = await db.query.auctions.findFirst({
        where: eq(auctions.id, game.auctionId),
      });
      if (!found) throw new Error("asta sparita");
      return found;
    };

    const t0 = Date.now();
    await markAllPresent(game.auctionId, game.memberIds, t0);

    let loaded = await loadAuctionState(db, await row());
    expect(loaded.state.status).toBe("READY");

    const started = transition(
      loaded.state,
      { type: "START", startSeatIndex: 0 },
      t0,
    );
    if (!started.ok) throw new Error(started.error.message);
    await persistTransition(db, loaded, started.value, t0);

    let guard = 0;
    for (;;) {
      loaded = await loadAuctionState(db, await row());
      if (loaded.state.status !== "LIVE") break;
      if ((guard += 1) > 400) throw new Error("l'asta non converge");

      const now = loaded.state.phaseDeadline!;
      const advanced = transition(loaded.state, { type: "ADVANCE" }, now);
      if (!advanced.ok) throw new Error(advanced.error.message);
      await persistTransition(db, loaded, advanced.value, now);
    }

    expect(loaded.state.status).toBe("COMPLETED");
    // 8 posti × 4 slot: le rose sono piene, e nessuna riga è mai passata dal
    // listone a sistema.
    expect(loaded.state.assignments).toHaveLength(32);
    expect((await listoneStatus()).rows).toBe(0);
  }, 120_000);
});

// ─── Il Centro dati ──────────────────────────────────────────────────────────

suite.runIf(dbUp)("il Centro dati", () => {
  it("mostra il listone e lascia senza insight chi non ne ha", async () => {
    await uploadListone(syntheticListone(), new Date("2026-08-12T10:00:00.000Z"));

    const rows = await centroDatiRows();
    expect(rows).toHaveLength(40);
    // Gli `ext_id` del listone sintetico non esistono in nessuna fonte: la
    // chiave `insights` **non c'è affatto**, non è un `null` da nascondere in
    // pagina (stessa regola di `listPickPool`).
    expect(rows.every((row) => !("insights" in row))).toBe(true);
    expect(rows.map((row) => row.name)).toEqual(
      [...rows.map((row) => row.name)].sort((a, b) => a.localeCompare(b, "it")),
    );
  });

  it("con la tabella vuota non ha niente da mostrare, e non è un errore", async () => {
    expect(await centroDatiRows()).toEqual([]);
    const status = await listoneStatus();
    expect(status.rows).toBe(0);
    expect(status.uploadedAt).toBeNull();
    expect(status.coverage.matched).toBe(0);
  });
});
