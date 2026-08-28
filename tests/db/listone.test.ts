import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, expect, it, suite, vi } from "vitest";

import { db } from "@/lib/db";
import {
  auctions,
  carmyPlayers,
  listonePlayers,
  players,
  userListone,
} from "@/lib/db/schema";
import {
  CARMY_FASCE,
  CARMY_TEAM_BY_SIGLA,
  SOGLIA_TITOLARE_CARMY,
  normalizeCarmyName,
} from "@/lib/domain";
import {
  CARMY_MATCH_THRESHOLD,
  CARMY_STALE_HOURS,
  allCarmy,
  carmyStatus,
  carmyTags,
  uploadCarmy,
} from "@/lib/engine/carmy";
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
  uploadUserListone,
  userListoneStatus,
} from "@/lib/engine/user-listone";
import {
  createAuction,
  importPlayers,
  importPlayersFromListone,
  listPickPool,
} from "@/lib/engine/setup";
import { DEFAULT_CONFIG } from "@/lib/engine/setup-rules";

import * as XLSX from "xlsx";

import { CARMY_SHEETS } from "@/lib/import/parseCarmy";
import { SHEET_NAME, parseListone } from "@/lib/import/parseListone";

import {
  type GameAuction,
  makeGameAuction,
  markAllPresent,
} from "./game-helpers";
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
 *
 * ⚠ **«Altissimi» va preso alla lettera**, e la prima versione di questo file lo
 * aveva sbagliato: vedi `EXT_ID_BASE` qui sotto.
 *
 * ## ⚠ Perché i test di M10B stanno qui e non in `tests/db/carmy.test.ts`
 *
 * Perché **`uploadListone` fa `DELETE` su `listone_players`**, e M10B si aggancia
 * proprio a quella tabella: il suo join per nome non si può provare senza un
 * listone caricato. Due file che caricano un listone sono due `DELETE` e due
 * `INSERT` sulla stessa tabella globale in **worker paralleli** — e la prima
 * versione di M10B li aveva separati, con questo risultato: dieci test rossi nella
 * suite ed entrambi i file verdi da soli, con un `duplicate key value violates
 * unique constraint "listone_players_pkey"` su un `ext_id` che l'altro worker
 * stava inserendo. È **la stessa cicatrice** del `player_insights` qui sopra, e la
 * regola che ne esce è quella: **una tabella globale, un file che la possiede.**
 * Questo file possiede `listone_players` e `carmy_players`.
 *
 * L'alternativa — serializzare i file di test con `fileParallelism: false` —
 * costerebbe secondi a ogni `pnpm test` per un problema che riguarda due file, e
 * lascerebbe la trappola aperta per il terzo.
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

/**
 * ⚠ **Il primo identificativo sintetico, e perché è così alto.**
 *
 * `syntheticListone` di `game-helpers.ts` numera da 1, e la prima versione di
 * questo file lo usava credendo che «tanto quegli id non esistono in nessuna
 * fonte». **È falso**: gli `ext_id` veri di Fantacalcio.it partono da 4 e
 * arrivano a 7548, quindi due righe del listone sintetico si agganciavano a due
 * righe di insight vere. Il test passava solo quando `player_insights` era
 * vuota — cioè quando un altro file di test l'aveva appena svuotata — ed è
 * esattamente il «verde da solo, rosso nella suite» da cui questo file cerca di
 * stare lontano.
 *
 * Dieci milioni sta sopra qualunque identificativo che quella fonte possa
 * assegnare, e rende il `LEFT JOIN` verificabile senza scrivere una riga di
 * `player_insights`.
 */
const EXT_ID_BASE = 10_000_000;

/** Un listone sintetico con identificativi che nessuna fonte può avere. */
function syntheticListone(
  counts: Record<"P" | "D" | "C" | "A", number> = { P: 10, D: 10, C: 10, A: 10 },
): ArrayBuffer {
  let n = 0;
  const rows = (["P", "D", "C", "A"] as const).flatMap((role) =>
    Array.from({ length: counts[role] }, () => {
      n += 1;
      return {
        "#": EXT_ID_BASE + n,
        Nome: `Giocatore ${n}`,
        "Fuori lista": "",
        "Sq.": "Test",
        "R.": role,
        "R.MANTRA": role,
        // Quotazione decrescente: l'ordine di apertura della pagina è
        // verificabile senza dipendere dal file vero.
        "FVM/1000": 1000 - n,
        "QUOT.": 1000 - n,
      };
    }),
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), SHEET_NAME);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

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

/**
 * Un'asta di gioco pronta a partire, con i suoi utenti registrati per la pulizia.
 *
 * Estratto in M10B, che è il secondo chiamante (regola 8): le tre righe di
 * `createdUsers.push` ripetute erano il genere di duplicazione che, dimenticata
 * una volta, lascia otto utenti in giro e fa fallire un test che non c'entra.
 */
async function gameAuction(): Promise<GameAuction> {
  const game = await makeGameAuction();
  createdAuctions.push(game.auctionId);
  createdUsers.push(...game.userIds);
  if (!game.userIds.includes(game.ownerId)) createdUsers.push(game.ownerId);
  return game;
}

type Esito = {
  state: Awaited<ReturnType<typeof loadAuctionState>>["state"];
  /**
   * I **nomi** comprati, nell'ordine di assegnazione.
   *
   * ⚠ Nomi e non `playerId`: quelli sono uuid di `players`, cioè della **copia per
   * asta** del listone, quindi due aste hanno due uuid diversi per lo stesso
   * giocatore. La prima versione del test di M10B li confrontava direttamente ed è
   * diventata rossa su due liste identiche — il che è anche la prova che `players`
   * è per asta, come M10 §3 dice che deve essere.
   */
  comprati: string[];
};

/**
 * Porta un'asta fino a `COMPLETED` senza che nessuno agisca: pick e round scadono,
 * e l'asta si gioca da sola. È la tecnica di `tests/engine/machine.test.ts`, ma
 * contro Postgres.
 */
async function giocaFinoAllaFine(game: GameAuction): Promise<Esito> {
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

  const nomi = new Map(
    (
      await db
        .select({ id: players.id, name: players.name })
        .from(players)
        .where(eq(players.auctionId, game.auctionId))
    ).map((r) => [r.id, r.name]),
  );

  return {
    state: loaded.state,
    comprati: loaded.state.assignments.map(
      (a) => nomi.get(a.playerId) ?? `?${a.playerId}`,
    ),
  };
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
  if (!dbUp) return;
  // ⚠ Prima `carmy_players`: non ha una foreign key verso `listone_players` — il
  // join è per nome e l'`ext_id` lo mette l'import — ma l'ordine racconta la
  // dipendenza vera, ed è quello in cui si caricano i due file.
  await db.delete(carmyPlayers);
  await db.delete(listonePlayers);
});

afterAll(async () => {
  if (!dbUp) return;
  await db.delete(carmyPlayers);
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
    // stanno tutti sopra `EXT_ID_BASE`, quelli del file vero tutti sotto.
    const ids = await listoneExtIds();
    expect(Math.min(...ids)).toBeGreaterThan(EXT_ID_BASE);
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

    const esito = await giocaFinoAllaFine(await gameAuction());

    expect(esito.state.status).toBe("COMPLETED");
    // 8 posti × 4 slot: le rose sono piene, e nessuna riga è mai passata dal
    // listone a sistema.
    expect(esito.state.assignments).toHaveLength(32);
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
  });

  /**
   * Le righe arrivano già nell'ordine con cui la pagina si apre — quotazione dal
   * più alto al più basso, nome a parità. La tabella riordina comunque nel
   * browser a ogni click sulle intestazioni, ma far arrivare i dati nell'ordine
   * giusto evita che il primo disegno e il primo `sort` mostrino due liste
   * diverse.
   */
  it("le righe arrivano nell'ordine con cui la pagina si apre", async () => {
    await uploadListone(LISTONE, new Date("2026-08-12T10:00:00.000Z"));

    const rows = await centroDatiRows();
    const quotazioni = rows.map((row) => row.quot);
    expect(quotazioni).toEqual([...quotazioni].sort((a, b) => b - a));
    expect(quotazioni[0]).toBeGreaterThan(quotazioni[quotazioni.length - 1]);
  });

  it("con la tabella vuota non ha niente da mostrare, e non è un errore", async () => {
    expect(await centroDatiRows()).toEqual([]);
    const status = await listoneStatus();
    expect(status.rows).toBe(0);
    expect(status.uploadedAt).toBeNull();
    expect(status.coverage.matched).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// M10B — il foglio di Carmy
//
// Stanno in questo file e non in uno loro perché `uploadListone` fa `DELETE` su
// `listone_players`, a cui il join di M10B si aggancia: due file che caricano un
// listone sono due `DELETE` sulla stessa tabella globale in worker paralleli. Il
// perché per esteso, con il rosso che l'ha insegnato, è in testa al file.
// ═════════════════════════════════════════════════════════════════════════════

const CARMY = readFileSync(
  fileURLToPath(new URL("../../fixtures/carmy.xlsx", import.meta.url)),
);

const T0 = new Date("2026-08-12T10:00:00.000Z");

// ─── Il caricamento e il join ────────────────────────────────────────────────

suite.runIf(dbUp)("il caricamento del foglio di Carmy", () => {
  it("⚠ senza listone rifiuta, perché senza denominatore non c'è nessun join", async () => {
    const result = await uploadCarmy(CARMY, T0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CARMY_NO_LISTONE");
    // E non scrive niente: non resta nessuna riga a metà.
    expect(await db.select().from(carmyPlayers)).toHaveLength(0);
  });

  it("aggancia 487 nomi su 497 e dice quali dieci non ha trovato", async () => {
    await uploadListone(LISTONE, T0);

    const result = await uploadCarmy(CARMY, T0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.fromFile).toBe(497);
    expect(result.value.written).toBe(487);
    // ⚠ **Per nome e non per numero**: dieci nomi in fondo alla pagina sono
    // l'unico modo di accorgersi che il foglio e il listone hanno cominciato a
    // divergere. Sono acquisti più recenti del listone del 6 agosto.
    expect(result.value.unmatched).toHaveLength(10);
    expect(result.value.unmatched).toContain("Mastantuono");
    expect(result.value.unmatched).toContain("Kevin Carlos");
    expect(await db.select().from(carmyPlayers)).toHaveLength(487);
  });

  it("⚠ la sigla è il controllo e non la chiave: le tre discordanze si dicono", async () => {
    await uploadListone(LISTONE, T0);
    const result = await uploadCarmy(CARMY, T0);
    if (!result.ok) throw new Error(result.error.message);

    // Sono trasferimenti veri, e il giudizio va importato comunque: un giocatore
    // che ha cambiato squadra resta lo stesso giocatore.
    expect(result.value.teamMismatches).toHaveLength(3);
    expect(result.value.teamMismatches.map((m) => m.name).sort()).toEqual([
      "Dominguez B.",
      "Maldini",
      "Masini",
    ]);
    expect(
      result.value.teamMismatches.find((m) => m.name === "Dominguez B."),
    ).toMatchObject({ carmy: "Sassuolo", listone: "Bologna" });
  });

  it("l'`ext_id` viene dal listone, non dal file: il file non ce l'ha", async () => {
    await uploadListone(LISTONE, T0);
    await uploadCarmy(CARMY, T0);

    const parsed = parseListone(LISTONE);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const byName = new Map(
      parsed.value.map((row) => [normalizeCarmyName(row.name), row.extId]),
    );

    const rows = await db
      .select()
      .from(carmyPlayers)
      .orderBy(asc(carmyPlayers.extId));
    for (const row of rows) {
      expect(row.extId).toBe(byName.get(normalizeCarmyName(row.sourceName)));
    }
  });

  it("⚠ un caricamento sostituisce l'intera tabella, non fonde", async () => {
    await uploadListone(LISTONE, T0);
    await uploadCarmy(CARMY, T0);
    expect(await db.select().from(carmyPlayers)).toHaveLength(487);

    // Un foglio ridotto a un giocatore per ruolo: se fondesse, resterebbero 487
    // righe e un giudizio ritirato non sparirebbe mai.
    const dopo = new Date("2026-08-12T18:00:00.000Z");
    expect((await uploadCarmy(minimalCarmy(), dopo)).ok).toBe(true);

    const rows = await db.select().from(carmyPlayers);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.uploadedAt.getTime() === dopo.getTime())).toBe(
      true,
    );
  });

  it("le colonne arrivano a database come le legge il parser", async () => {
    await uploadListone(LISTONE, T0);
    await uploadCarmy(CARMY, T0);

    const [dimarco] = await db
      .select()
      .from(carmyPlayers)
      .where(eq(carmyPlayers.sourceName, "Dimarco"));
    expect(dimarco).toMatchObject({
      sourceTeam: "INT",
      fascia: "Top",
      titolarita: 5,
      affidabilita: 5,
      integrita: 4,
      prezzo: 75,
      // ⚠ Il `PMA` arriva **come lo scrive il foglio**, non ricalcolato: 15,6 e non
      // 15 (che sarebbe `prezzo / 5`). Sono due numeri diversi, e su 385 righe
      // coincidono solo 132 — vedi lo schema.
      pma: 15.6,
    });
    expect(dimarco.fmvExp).toBeCloseTo(7.36, 2);
    // I tag sono un array `jsonb`, non una stringa con le virgole.
    expect(dimarco.tags).toEqual([
      "modificatore",
      "tiratore",
      "bonus",
      "titolarissimo",
    ]);
  });

  it("⚠ Aurelio non entra, e nessuno zero del foglio diventa un voto", async () => {
    await uploadListone(LISTONE, T0);
    await uploadCarmy(CARMY, T0);

    // È il caso in cui i due scarti di §1 si incrociano: la riga non compilata è
    // anche uno dei dieci nomi che il listone non ha.
    expect(
      await db
        .select()
        .from(carmyPlayers)
        .where(eq(carmyPlayers.sourceName, "Aurelio")),
    ).toHaveLength(0);

    const all = await db.select().from(carmyPlayers);
    expect(all.filter((row) => row.titolarita === 0)).toHaveLength(0);
    expect(all.filter((row) => row.prezzo === 0)).toHaveLength(0);
  });
});

// ─── La soglia di aggancio ───────────────────────────────────────────────────

suite.runIf(dbUp)("la soglia di aggancio del foglio", () => {
  /**
   * ⚠ **Sotto la soglia non si scrive niente**, e la differenza con il controllo
   * che M8 aveva smontato è la parte da non perdere (M10B §3): qui il denominatore
   * è `listone_players`, che è **globale** e non appartiene a nessuna asta —
   * nessuna simulazione con `ext_id` sintetici lo può avvelenare.
   */
  it("con un listone che non c'entra niente, rifiuta e non scrive", async () => {
    await uploadListone(estraneoListone(), T0);
    const result = await uploadCarmy(CARMY, T0);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CARMY_COVERAGE");
    expect(result.error.message).toContain(
      `${Math.round(CARMY_MATCH_THRESHOLD * 100)}%`,
    );
    expect(await db.select().from(carmyPlayers)).toHaveLength(0);
  });

  it("un caricamento fallito non tocca quello di prima", async () => {
    await uploadListone(LISTONE, T0);
    await uploadCarmy(CARMY, T0);
    expect(await db.select().from(carmyPlayers)).toHaveLength(487);

    // Il listone cambia sotto e diventa estraneo: il secondo caricamento
    // fallisce, e la transazione lascia in piedi i 487 giudizi di prima.
    await uploadListone(estraneoListone(), T0);
    expect((await uploadCarmy(CARMY, T0)).ok).toBe(false);
    expect(await db.select().from(carmyPlayers)).toHaveLength(487);
  });

  it("il 98% misurato passa comodamente il 90% richiesto", async () => {
    await uploadListone(LISTONE, T0);
    const result = await uploadCarmy(CARMY, T0);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.written / result.value.fromFile).toBeGreaterThan(
      CARMY_MATCH_THRESHOLD,
    );
  });
});

// ─── Lo stato del pannello ───────────────────────────────────────────────────

suite.runIf(dbUp)("lo stato del foglio, per il pannello", () => {
  it("a tabella vuota non c'è nessuna data e niente è vecchio", async () => {
    expect(await carmyStatus(T0)).toMatchObject({
      rows: 0,
      uploadedAt: null,
      stale: false,
    });
  });

  it("conta i giudizi, i titolari sopra soglia e i prezzi", async () => {
    await uploadListone(LISTONE, T0);
    await uploadCarmy(CARMY, T0);

    const status = await carmyStatus(T0);
    expect(status.rows).toBe(487);
    // ⚠ La soglia è quella di `lib/domain.ts`, non un `4` scritto in SQL: il
    // pannello e il badge devono contare la stessa cosa.
    expect(SOGLIA_TITOLARE_CARMY).toBe(4);
    expect(status.titolari).toBeGreaterThan(0);
    expect(status.titolari).toBeLessThan(status.conTitolarita);
    expect(status.conPrezzo).toBeGreaterThan(0);
    // ⚠ `max()` in SQL grezzo torna una stringa: se `asDate` sparisse, qui
    // arriverebbe un `getTime is not a function`.
    expect(status.uploadedAt?.getTime()).toBe(T0.getTime());
  });

  it("il caricamento di ieri si distingue da quello di stamattina", async () => {
    await uploadListone(LISTONE, T0);
    await uploadCarmy(CARMY, T0);

    expect((await carmyStatus(new Date("2026-08-12T11:00:00.000Z"))).stale).toBe(
      false,
    );
    const dopo = new Date(T0.getTime() + (CARMY_STALE_HOURS + 1) * 3_600_000);
    expect((await carmyStatus(dopo)).stale).toBe(true);
  });

  it("i tag si leggono dai dati, ordinati per frequenza", async () => {
    await uploadListone(LISTONE, T0);
    await uploadCarmy(CARMY, T0);

    const tags = await carmyTags();
    expect(tags.length).toBeGreaterThan(10);
    // Dal più frequente: è l'ordine in cui servono in un filtro.
    for (let i = 1; i < tags.length; i += 1) {
      expect(tags[i - 1].count).toBeGreaterThanOrEqual(tags[i].count);
    }
    expect(tags.map((t) => t.tag)).toContain("rigorista");
  });
});

// ─── Il Centro dati con i giudizi ────────────────────────────────────────────

suite.runIf(dbUp)("il Centro dati con i giudizi", () => {
  it("porta i giudizi accanto al listone, e lascia senza chi non ne ha", async () => {
    await uploadListone(LISTONE, T0);
    await uploadCarmy(CARMY, T0);

    const rows = await centroDatiRows();
    expect(rows).toHaveLength(495);
    expect(rows.find((row) => row.name === "Dimarco")?.carmy).toMatchObject({
      fascia: "Top",
      titolarita: 5,
    });

    // ⚠ La chiave **non c'è affatto** per chi non ha un giudizio: non è un `null`
    // da nascondere in pagina.
    const senza = rows.filter((row) => !("carmy" in row));
    expect(senza).toHaveLength(495 - 487);
  });

  it("con la tabella di Carmy vuota il Centro dati resta quello di M10", async () => {
    await uploadListone(LISTONE, T0);

    const rows = await centroDatiRows();
    expect(rows).toHaveLength(495);
    expect(rows.every((row) => !("carmy" in row))).toBe(true);
  });

  it("ogni fascia a database è fra quelle che l'applicazione sa ordinare", async () => {
    await uploadListone(LISTONE, T0);
    await uploadCarmy(CARMY, T0);

    for (const j of (await allCarmy()).values()) {
      if (j.fascia === null) continue;
      expect(CARMY_FASCE).toContain(j.fascia);
    }
  });

  /**
   * ⚠ **La mappa sigla → squadra va rigenerata a ogni promozione** (M10B §3), e
   * questo è il test che se ne accorge: il giorno in cui il listone porta una
   * squadra nuova, il foglio porta una sigla nuova, e una delle due parti resta
   * indietro. Meglio un rosso qui che un giudizio che non aggancia.
   */
  it("la mappa delle sigle copre tutte le squadre del listone caricato", async () => {
    await uploadListone(LISTONE, T0);

    const squadre = new Set(
      (await db.select({ team: listonePlayers.team }).from(listonePlayers)).map(
        (row) => row.team,
      ),
    );
    const tradotte = new Set(Object.values(CARMY_TEAM_BY_SIGLA));
    for (const squadra of squadre) {
      expect(tradotte, `${squadra} non è in CARMY_TEAM_BY_SIGLA`).toContain(
        squadra,
      );
    }
  });
});

// ─── Chi li vede: una query, non un `className` ──────────────────────────────

suite.runIf(dbUp)("chi vede i giudizi", () => {
  /**
   * ⚠ **Il test è quello di M8, e si asserisce l'assenza della chiave, non il suo
   * valore** (M10B §7). `PoolPlayer` finisce nel payload RSC di un client
   * component, cioè nel browser: un `null` nascosto in pagina sarebbe leggibile in
   * DevTools in tre click. I filtri per `is_pro` sono l'interfaccia sopra questo
   * dato, non la sua protezione.
   */
  it("un non-pro non riceve la chiave `carmy`", async () => {
    const game = await gameAuction();

    const pool = await listPickPool(game.auctionId, false);
    expect(pool.length).toBeGreaterThan(0);
    for (const player of pool) {
      expect(Object.keys(player)).not.toContain("carmy");
      expect(Object.keys(player)).not.toContain("insights");
    }
  });

  /**
   * ⚠ **Perché il giudizio si scrive a mano invece di caricare il foglio vero.**
   * Il listone sintetico di `game-helpers.ts` numera gli `ext_id` **da 1**, e
   * quelli veri partono da 4: i due insiemi **si sovrappongono**. È la stessa
   * cicatrice di `EXT_ID_BASE` qui sopra — la prima versione di questo test
   * caricava `carmy.xlsx` credendo che «tanto quegli id non esistono», ed è
   * diventata rossa su un pool che conteneva la chiave per costruzione. Qui la
   * sovrapposizione è **voluta e misurata**: un `ext_id` noto, un giocatore solo.
   */
  it("e un pro la riceve solo per chi ha davvero un giudizio", async () => {
    const game = await gameAuction();

    await db.insert(carmyPlayers).values({
      extId: 1,
      sourceName: "Giocatore 1",
      sourceTeam: "INT",
      fascia: "Top",
      prezzo: 42,
      pma: 8.4,
      titolarita: 5,
      affidabilita: 4,
      integrita: 3,
      fmvExp: 7,
      tags: ["bonus"],
      commento: null,
      uploadedAt: T0,
    });

    const pool = await listPickPool(game.auctionId, true);
    const giudicati = pool.filter((p) => "carmy" in p);
    expect(giudicati).toHaveLength(1);
    expect(giudicati[0].name).toBe("Giocatore 1");
    expect(giudicati[0].carmy).toMatchObject({
      fascia: "Top",
      prezzo: 42,
      pma: 8.4,
    });

    // E lo stesso pool, chiesto senza il permesso, non la porta a nessuno.
    expect(
      (await listPickPool(game.auctionId, false)).filter((p) => "carmy" in p),
    ).toHaveLength(0);
  });
});

// ─── Il percorso critico, e l'auto-pick ──────────────────────────────────────

suite.runIf(dbUp)("nessun dato di M10B sta su un percorso critico", () => {
  /**
   * ⚠ **La verifica 3 di M10B**, la stessa che M10 ha per `listone_players` e per
   * la stessa ragione: un'asta si crea, si prepara e arriva a `COMPLETED` con
   * `carmy_players` **vuota**. Se un giorno un `JOIN` verso questa tabella
   * comparisse in `machine.ts`, `rules.ts`, `snapshot.ts` o in `listPickPool`, è
   * qui che si romperebbe.
   */
  it("un'asta arriva a COMPLETED con carmy_players vuota", async () => {
    expect((await carmyStatus(T0)).rows).toBe(0);

    const esito = await giocaFinoAllaFine(await gameAuction());

    expect(esito.state.status).toBe("COMPLETED");
    expect(esito.state.assignments).toHaveLength(32);
    expect((await carmyStatus(T0)).rows).toBe(0);
  }, 120_000);

  /**
   * ⚠ **La verifica 2 di M10B, e il vincolo del riquadro di §6.**
   *
   * L'asta si gioca con la tabella di Carmy **piena** di giudizi che riguardano
   * proprio i giocatori in gara — e finisce **identica** a quella di sopra. È la
   * prova che un giudizio non entra in nessuna regola: l'auto-pick pesca dal pool
   * intero, ordinando per `fvm DESC, quot DESC`, e di Carmy non sa niente.
   *
   * ⚠ **I giudizi sono messi contro l'ordine dell'auto-pick**: il `fvm` decresce
   * con l'indice e la titolarità cresce, quindi il migliore per Carmy è l'ultimo
   * per il motore. Se un giudizio o un filtro riuscisse a toccare l'auto-pick,
   * l'asta comprerebbe giocatori diversi — e il confronto fra le due liste di nomi
   * lo direbbe.
   */
  it("⚠ con i giudizi addosso ai giocatori in gara, compra esattamente gli stessi", async () => {
    const attesi = await giocaFinoAllaFine(await gameAuction());

    const con = await gameAuction();
    await db.insert(carmyPlayers).values(
      Array.from({ length: 40 }, (_, i) => ({
        extId: i + 1,
        sourceName: `Giocatore ${i + 1}`,
        sourceTeam: "INT",
        fascia: "Top",
        prezzo: 50,
        pma: 10,
        titolarita: (i % 5) + 1,
        affidabilita: 3,
        integrita: 3,
        fmvExp: 6,
        tags: i % 2 === 0 ? ["bonus"] : ["scommessa"],
        commento: null,
        uploadedAt: T0,
      })),
    );
    expect((await carmyStatus(T0)).rows).toBe(40);

    const ottenuti = await giocaFinoAllaFine(con);

    expect(ottenuti.state.status).toBe("COMPLETED");
    expect(ottenuti.state.assignments).toHaveLength(32);
    // Gli stessi giocatori, nello stesso ordine di acquisto.
    expect(ottenuti.comprati).toEqual(attesi.comprati);
  }, 240_000);
});

// ═════════════════════════════════════════════════════════════════════════════
// M21 — il listone personale
//
// ⚠ **Stanno qui, e non in `tests/db/user-listone.test.ts`, per la stessa ragione
// di M10B**: il caricamento personale si aggancia a `listone_players`, quindi
// vuole un listone caricato — e questo file **possiede** quella tabella. Quel
// file lì resta a provare lo schema, che di listone non ha bisogno.
// ═════════════════════════════════════════════════════════════════════════════

suite.runIf(dbUp)("il caricamento del listone personale", () => {
  /** Un utente che può vedere gli insight, cioè che può caricare il proprio file. */
  async function proUser(label = "pro"): Promise<string> {
    const id = await makeUser(label, { isPro: true });
    createdUsers.push(id);
    return id;
  }

  async function righeDi(userId: string) {
    return db
      .select()
      .from(userListone)
      .where(eq(userListone.userId, userId))
      .orderBy(asc(userListone.extId));
  }

  it("aggancia gli stessi 487 nomi del gemello, e conta i tre obiettivi", async () => {
    await uploadListone(LISTONE, T0);
    const me = await proUser();

    const result = await uploadUserListone(me, CARMY, T0);
    if (!result.ok) throw new Error(result.error.message);

    // ⚠ **Gli stessi numeri del caricamento admin**, e non è una coincidenza: è
    // lo stesso file, lo stesso parser e lo stesso `matchToListone`. Se un giorno
    // questi due numeri divergessero, i due percorsi avrebbero cominciato a
    // leggere lo stesso foglio in due modi.
    expect(result.value.fromFile).toBe(497);
    expect(result.value.written).toBe(487);
    expect(result.value.unmatched).toHaveLength(10);
    expect(result.value.teamMismatches).toHaveLength(3);
    // E la cosa che solo questo percorso legge.
    expect(result.value.obiettivi).toBe(3);

    expect(await righeDi(me)).toHaveLength(487);
  });

  it("porta le fasce col loro ordine, e chi non ne ha resta senza numero", async () => {
    await uploadListone(LISTONE, T0);
    const me = await proUser();
    await uploadUserListone(me, CARMY, T0);

    const righe = await righeDi(me);
    const perRank = new Map<number, string>();
    for (const row of righe) {
      if (row.fasciaRank !== null) perRank.set(row.fasciaRank, row.fascia!);
    }
    // L'ordine del **mio** file, che sul file di riferimento coincide con quello
    // che l'applicazione conosce già.
    expect(
      [...perRank.entries()].sort(([a], [b]) => a - b).map(([, f]) => f),
    ).toEqual([...CARMY_FASCE]);

    // Chi nel foglio è `Non Impostata` arriva senza fascia e senza numero: è il
    // gruppo «Senza fascia» in fondo alla tabella.
    const senza = righe.filter((row) => row.fascia === null);
    expect(senza.length).toBeGreaterThan(0);
    expect(senza.every((row) => row.fasciaRank === null)).toBe(true);
  });

  it("i tre obiettivi hanno un nome, e sono solo quelli", async () => {
    await uploadListone(LISTONE, T0);
    const me = await proUser();
    await uploadUserListone(me, CARMY, T0);

    const obiettivi = await db
      .select({ extId: userListone.extId })
      .from(userListone)
      .where(and(eq(userListone.userId, me), eq(userListone.obiettivo, true)));
    expect(obiettivi).toHaveLength(3);

    const nomi = await db
      .select({ name: listonePlayers.name })
      .from(listonePlayers)
      .where(
        inArray(
          listonePlayers.extId,
          obiettivi.map((o) => o.extId),
        ),
      );
    expect(nomi.map((r) => r.name).sort()).toEqual([
      "Baturina",
      "McTominay",
      "Rowe",
    ]);
  });

  /**
   * ⚠ **Due persone, due listoni, e nessuna delle due vede l'altro.** È la
   * proprietà per cui `Obiett.` si può importare qui e non su `carmy_players`
   * (M21 §0): il dato non esce da chi l'ha caricato.
   */
  it("due utenti tengono due listoni indipendenti", async () => {
    await uploadListone(LISTONE, T0);
    const me = await proUser("io");
    const altro = await proUser("altro");

    await uploadUserListone(me, CARMY, T0);
    await uploadUserListone(altro, minimalCarmy(), T0);

    expect(await righeDi(me)).toHaveLength(487);
    // Il foglio ridotto ha un giocatore per ruolo: quattro righe, e nessuna delle
    // 487 dell'altro.
    expect(await righeDi(altro)).toHaveLength(4);
  });

  /**
   * ⚠ **Sostituisce le mie righe, non fonde**, e per la ragione di sempre: un
   * obiettivo tolto dal file deve poter sparire. Il `DELETE` è ristretto a un
   * `user_id`, quindi il listone di chi guarda non si accorge di niente.
   */
  it("ri-importare sostituisce il mio, e non tocca quello degli altri", async () => {
    await uploadListone(LISTONE, T0);
    const me = await proUser("sostituisco");
    const altro = await proUser("spettatore");

    await uploadUserListone(me, CARMY, T0);
    await uploadUserListone(altro, CARMY, T0);
    expect(await righeDi(me)).toHaveLength(487);

    const dopo = new Date("2026-08-28T18:00:00.000Z");
    const secondo = await uploadUserListone(me, minimalCarmy(), dopo);
    if (!secondo.ok) throw new Error(secondo.error.message);

    const mie = await righeDi(me);
    expect(mie).toHaveLength(4);
    expect(mie.every((r) => r.uploadedAt.getTime() === dopo.getTime())).toBe(true);
    // Il foglio ridotto non segna nessun obiettivo: i tre di prima sono spariti,
    // che è tutto il punto della sostituzione.
    expect(mie.filter((r) => r.obiettivo)).toHaveLength(0);
    expect(secondo.value.obiettivi).toBe(0);

    // E l'altro ha ancora i suoi 487, coi suoi tre obiettivi.
    const sue = await righeDi(altro);
    expect(sue).toHaveLength(487);
    expect(sue.filter((r) => r.obiettivo)).toHaveLength(3);
  });

  it("⚠ senza listone a sistema rifiuta, e dice a chi rivolgersi", async () => {
    const me = await proUser("senza-listone");

    const result = await uploadUserListone(me, CARMY, T0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CARMY_NO_LISTONE");
    // ⚠ Il messaggio **non** è quello del pannello admin: un partecipante il
    // listone non lo può caricare, e «carica prima il listone» sarebbe un ordine
    // impossibile da eseguire.
    expect(result.error.message).toContain("amministratore");
    expect(await righeDi(me)).toHaveLength(0);
  });

  it("⚠ sotto la soglia di aggancio non scrive niente", async () => {
    await uploadListone(estraneoListone(), T0);
    const me = await proUser("sotto-soglia");

    const result = await uploadUserListone(me, CARMY, T0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CARMY_COVERAGE");
    expect(result.error.message).toContain(
      `${Math.round(CARMY_MATCH_THRESHOLD * 100)}%`,
    );
    expect(await righeDi(me)).toHaveLength(0);
  });

  it("un caricamento fallito non tocca quello di prima", async () => {
    await uploadListone(LISTONE, T0);
    const me = await proUser("fallito");
    await uploadUserListone(me, CARMY, T0);
    expect(await righeDi(me)).toHaveLength(487);

    // Il listone cambia sotto e diventa estraneo: il secondo caricamento
    // fallisce, e la transazione lascia in piedi le 487 righe di prima.
    await uploadListone(estraneoListone(), T0);
    expect((await uploadUserListone(me, CARMY, T0)).ok).toBe(false);
    expect(await righeDi(me)).toHaveLength(487);
  });

  /**
   * ⚠ **Il gate sta nel motore, non solo nella Server Action** (regola 6). La UI
   * disabilita la tab; qui si prova che il server rifiuta comunque, con il file
   * giusto e il listone a posto — cioè che l'unica cosa che manca è il permesso.
   */
  it("⚠ un utente senza permesso viene rifiutato anche con il file perfetto", async () => {
    await uploadListone(LISTONE, T0);
    const normale = await user("normale");

    const result = await uploadUserListone(normale, CARMY, T0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FORBIDDEN");
    expect(await righeDi(normale)).toHaveLength(0);
  });

  it("e un amministratore carica il proprio, senza avere il flag Pro", async () => {
    await uploadListone(LISTONE, T0);
    const boss = await makeUser("admin", { isAdmin: true });
    createdUsers.push(boss);

    const result = await uploadUserListone(boss, CARMY, T0);
    expect(result.ok).toBe(true);
    expect(await righeDi(boss)).toHaveLength(487);
  });
});

suite.runIf(dbUp)("lo stato del listone personale", () => {
  it("chi non ha mai importato non ha niente, e non è un errore", async () => {
    const nessuno = await user("mai-importato");
    expect(await userListoneStatus(nessuno)).toEqual({
      rows: 0,
      obiettivi: 0,
      uploadedAt: null,
    });
  });

  it("dopo un caricamento dice righe, obiettivi e data", async () => {
    await uploadListone(LISTONE, T0);
    const me = await makeUser("stato", { isPro: true });
    createdUsers.push(me);
    await uploadUserListone(me, CARMY, T0);

    const status = await userListoneStatus(me);
    expect(status.rows).toBe(487);
    expect(status.obiettivi).toBe(3);
    // ⚠ `max()` in SQL grezzo torna una stringa: senza `asDate` qui arriverebbe
    // un `getTime is not a function`.
    expect(status.uploadedAt?.getTime()).toBe(T0.getTime());
  });
});

// ─── Aiutanti di M10B ────────────────────────────────────────────────────────

/** Un foglio di Carmy con un solo giocatore per ruolo, preso dal listone vero. */
function minimalCarmy(): ArrayBuffer {
  const parsed = parseListone(LISTONE);
  if (!parsed.ok) throw new Error(parsed.error.message);

  const wb = XLSX.utils.book_new();
  for (const sheet of CARMY_SHEETS) {
    const target = parsed.value.find((row) => row.role === sheet);
    if (!target) throw new Error(`nessun ${sheet} nel listone`);
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        {
          "Obiett.": "",
          Fascia: "Top",
          Ruolo: sheet,
          // La sigla giusta per la sua squadra, così il controllo non segnala.
          Team:
            Object.entries(CARMY_TEAM_BY_SIGLA).find(
              ([, name]) => name === target.team,
            )?.[0] ?? "INT",
          Nome: target.name,
          Prezzo: 10,
          PMA: "2%",
          Quo: target.quot,
          Titolarità: 4,
          Affidabilità: 3,
          Integrità: 3,
          Commento: "",
          "Nota 1": "bonus",
          "Nota 2": "",
          "Nota 3": "",
          "Nota 4": "",
          "Nota 5": "",
          "FMV Exp.": 6.5,
        },
      ]),
      sheet,
    );
  }
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

/**
 * Un listone con nomi che il foglio di Carmy non può avere: porta l'aggancio sotto
 * la soglia **senza** toccare il foglio.
 */
function estraneoListone(): ArrayBuffer {
  const rows = (["P", "D", "C", "A"] as const).flatMap((role, r) =>
    Array.from({ length: 20 }, (_, i) => ({
      "#": EXT_ID_BASE + 500 + r * 100 + i,
      Nome: `Nessuno ${role}${i}`,
      "Fuori lista": "",
      "Sq.": "Test",
      "R.": role,
      "R.MANTRA": role,
      "FVM/1000": 100,
      "QUOT.": 10,
    })),
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), SHEET_NAME);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
