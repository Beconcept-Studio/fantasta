import { readFile } from "node:fs/promises";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, suite } from "vitest";

import { db } from "@/lib/db";
import { playerInsights, players, sourceRuns, users } from "@/lib/db/schema";
import { canSeeInsights } from "@/lib/domain";
import { startAuction } from "@/lib/engine/actions";
import {
  recordSourceRun,
  refreshDueSources,
  runRefreshTick,
  sourceRunsStatus,
} from "@/lib/engine/insight-refresh";
import {
  CONTINUITY_THRESHOLD,
  LISTONE_URL,
  RIGORISTI_URL,
  insightsCoverage,
  insightsStatus,
  refreshListoneInsights,
  refreshSetPieces,
} from "@/lib/engine/insights";
import { listPickPool } from "@/lib/engine/setup";

import { makeGameAuction } from "./game-helpers";
import { closeDatabase, databaseAvailable, dropAuctions, dropUsers } from "./helpers";

/**
 * Il motore degli insight contro Postgres vero (M8-07).
 *
 * ⚠ **La rete non si tocca**: `fetchImpl` è iniettata e restituisce le risposte
 * salvate in `fixtures/`. È lo stesso taglio di M7 — la parte pura si prova sui
 * byte, la parte che scrive si prova sul database, e nessun test dipende dal fatto
 * che un sito sia in piedi mentre gira la suite.
 *
 * ⚠ E la tabella è **globale**: non muore con l'asta, quindi va pulita a mano. È
 * la stessa cura che vuole l'archivio figurine, e la ragione è la stessa — questi
 * dati non sono un fatto dell'asta.
 *
 * ⚠ **Per la stessa ragione tutto M8 si prova in questo file solo, e non va
 * spezzato.** Vitest gira i file in **worker paralleli**, e ogni altro test del
 * database si isola creandosi le proprie aste — la cascata su `auction_id` fa il
 * resto. Qui non c'è nessun `auction_id` da cui dipendere: due file che
 * riempissero e svuotassero `player_insights` insieme si guasterebbero a vicenda,
 * e il sintomo è il peggiore che esista — **verdi da soli, rossi nella suite**.
 * È successo scrivendo questi test, e la diagnosi è costata più della cura.
 *
 * ## ⚠ Questo file possiede due tabelle globali: `player_insights` e `source_runs`
 *
 * È la regola uscita da M10B (`DECISIONS.md`, 2026-08-12) — *una tabella globale,
 * un file di test che la possiede* — e M11 ci andava addosso due volte:
 * `source_runs` è una tabella globale nuova, **e il tick scrive
 * `player_insights`**, che questo file già svuota nel suo `beforeAll` e nel suo
 * `afterAll`. Un file separato per M11 sarebbe stato verde da solo e rosso nella
 * suite, esattamente come in M10B. Quindi i test del refresh stanno qui, e chi
 * scriverà su `source_runs` da un altro file deve prima spostare la proprietà.
 */

const FIXTURES = path.resolve(__dirname, "..", "..", "fixtures");

let listoneBody: string;
let rigoristiBody: string;
const createdAuctions: string[] = [];
const createdUsers: string[] = [];
/** L'asta di gioco, ma con `ext_id` che esistono davvero nella fonte. */
async function auctionWithRealExtIds(): Promise<{
  auctionId: string;
  playerId: number;
}> {
  const game = await makeGameAuction();
  createdAuctions.push(game.auctionId);
  createdUsers.push(game.ownerId, ...game.userIds);

  // Il listone sintetico ha `ext_id` da 1 a 40, che nella fonte non esistono: si
  // riscrivono su quelli di due giocatori veri, così l'aggancio è reale.
  // 531 = Berardi (`current`), 184 = Bernardeschi.
  const rows = await db
    .select({ id: players.id, extId: players.extId })
    .from(players)
    .where(eq(players.auctionId, game.auctionId))
    .orderBy(players.extId);

  await db
    .update(players)
    .set({ extId: 531 })
    .where(eq(players.id, rows[0].id));

  return { auctionId: game.auctionId, playerId: 531 };
}


/** Una `fetch` che risponde con le fixture, e conta le chiamate. */
function fakeFetch(bodies: Record<string, string>, status = 200) {
  const calls: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    const href = typeof url === "string" ? url : url.toString();
    calls.push(href);
    const body = bodies[href];
    if (body === undefined) {
      return new Response("not found", { status: 404 });
    }
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const available = await databaseAvailable();

/**
 * Riempie la tabella dalla fixture, passando dal motore vero.
 *
 * ⚠ La suite del pool la richiama **prima di ogni test**, perché uno di quei test
 * svuota la tabella di proposito — è quello che dimostra che l'asta funziona senza
 * insight. Senza il ricarico, il test successivo girava sul vuoto e falliva per la
 * ragione sbagliata.
 */
async function loadInsights(): Promise<void> {
  await db.delete(playerInsights);
  const { impl } = fakeFetch({ [LISTONE_URL]: listoneBody });
  const done = await refreshListoneInsights({ fetchImpl: impl });
  if (!done.ok) throw new Error(done.error.message);
}

beforeAll(async () => {
  listoneBody = await readFile(
    path.join(FIXTURES, "fantalab-listone.json"),
    "utf8",
  );
  rigoristiBody = await readFile(path.join(FIXTURES, "rigoristi.html"), "utf8");
  if (available) {
    await db.delete(playerInsights);
    await db.delete(sourceRuns);
  }
});

afterAll(async () => {
  if (available) {
    await db.delete(playerInsights);
    await db.delete(sourceRuns);
    await dropAuctions(createdAuctions);
    await dropUsers(createdUsers);
  }
  await closeDatabase();
});

suite.skipIf(!available)("gli insight dal listone Fantalab", () => {
  it("scrive 497 righe e le rilegge, chiamando la fonte una volta sola", async () => {
    const { impl, calls } = fakeFetch({ [LISTONE_URL]: listoneBody });
    const result = await refreshListoneInsights({ fetchImpl: impl });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fromSource).toBe(497);
    expect(result.value.written).toBe(497);
    // Primo import: non c'è niente con cui confrontarsi, e il controllo si salta.
    expect(result.value.continuity).toBeNull();
    expect(calls).toEqual([LISTONE_URL]);

    const status = await insightsStatus();
    expect(status.rows).toBe(497);
    // I 329 `current` sono gli unici mostrabili: gli altri 168 escono come `—`.
    expect(status.current).toBe(329);
    expect(status.listoneUpdatedAt).not.toBeNull();
    expect(status.setPiecesUpdatedAt).toBeNull();
  });

  it("è ripetibile: la seconda passata riscrive le stesse righe senza duplicarne una", async () => {
    const { impl } = fakeFetch({ [LISTONE_URL]: listoneBody });
    await refreshListoneInsights({ fetchImpl: impl });
    const second = await refreshListoneInsights({ fetchImpl: impl });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // Ora il confronto c'è, e la lista è identica a se stessa.
    expect(second.value.continuity).toBe(497);
    expect((await insightsStatus()).rows).toBe(497);
  });

  it("mappa i due casi di §2 con i valori veri", async () => {
    const { impl } = fakeFetch({ [LISTONE_URL]: listoneBody });
    await refreshListoneInsights({ fetchImpl: impl });

    const berardi = await db.query.playerInsights.findFirst({
      where: eq(playerInsights.extId, 531),
    });
    expect(berardi).toMatchObject({
      team: "Sassuolo",
      statsSeason: "current",
      presenze: 26,
      startsEleven: 24,
      minPlayingTime: 1971,
    });
    // I rank vengono dalla fonte B e questo refresh non li tocca.
    expect(berardi?.rigoristaRank).toBeNull();
  });

  /**
   * M21 §3 — gol e assist arrivano fino alla tabella.
   *
   * ⚠ **La colonna nullable non basta a farla scrivere**, ed è il guasto che
   * questo test esiste per prendere: l'`upsert` di M8 elenca le colonne una per
   * una, quindi una colonna nuova aggiunta allo schema e dimenticata lì dentro
   * resterebbe `null` per sempre **senza nessun errore** — la prima passata la
   * riempirebbe (è un `INSERT`), la seconda non la aggiornerebbe più. Per questo
   * l'asserzione arriva dopo **due** refresh.
   */
  it("porta gol e assist della fonte A, anche alla seconda passata", async () => {
    const { impl } = fakeFetch({ [LISTONE_URL]: listoneBody });
    await refreshListoneInsights({ fetchImpl: impl });
    await refreshListoneInsights({ fetchImpl: impl });

    const berardi = await db.query.playerInsights.findFirst({
      where: eq(playerInsights.extId, 531),
    });
    expect(berardi).toMatchObject({ golFatti: 6, assist: 4 });

    // Zero è un dato pieno, non un buco: chi non ha segnato ha `0`, e nessuna
    // riga resta `null` dopo un refresh riuscito.
    const [conti] = await db
      .select({
        nulli: sql<number>`count(*) filter (where ${playerInsights.golFatti} is null)::int`,
        gol: sql<number>`sum(${playerInsights.golFatti})::int`,
        assist: sql<number>`sum(${playerInsights.assist})::int`,
      })
      .from(playerInsights);
    expect(conti.nulli).toBe(0);
    expect(conti.gol).toBe(933);
    expect(conti.assist).toBe(653);
  });

  /**
   * ⚠ **La prova che il rilascio non vuole nessun backfill** (M21 §2, verifica
   * 21). Le righe che il giorno del deploy sono già a sistema nascono con
   * `null`, e devono riempirsi **da sé** al primo refresh giornaliero: qui si
   * riproduce esattamente quello stato — le due colonne svuotate a mano su una
   * tabella piena — e si guarda cosa fa il refresh successivo.
   *
   * Se un giorno questo test diventasse rosso, il rilascio avrebbe bisogno di un
   * passo a mano che «nulla ti ricorda».
   */
  it("⚠ una riga già a sistema con le due colonne vuote si riempie al refresh, senza backfill", async () => {
    const { impl } = fakeFetch({ [LISTONE_URL]: listoneBody });
    await refreshListoneInsights({ fetchImpl: impl });

    // Lo stato del giorno del deploy: righe vecchie, colonne nuove vuote.
    await db.update(playerInsights).set({ golFatti: null, assist: null });
    expect(
      (
        await db.query.playerInsights.findFirst({
          where: eq(playerInsights.extId, 531),
        })
      )?.golFatti,
    ).toBeNull();

    await refreshListoneInsights({ fetchImpl: impl });

    expect(
      await db.query.playerInsights.findFirst({
        where: eq(playerInsights.extId, 531),
      }),
    ).toMatchObject({ golFatti: 6, assist: 4 });
  });

  it("⚠ una fonte irraggiungibile non lascia la tabella a metà", async () => {
    const { impl } = fakeFetch({ [LISTONE_URL]: listoneBody });
    await refreshListoneInsights({ fetchImpl: impl });
    const before = await insightsStatus();

    const rotta = fakeFetch({ [LISTONE_URL]: "" }, 503);
    const result = await refreshListoneInsights({ fetchImpl: rotta.impl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SOURCE_UNREACHABLE");

    const after = await insightsStatus();
    expect(after.rows).toBe(before.rows);
    expect(after.listoneUpdatedAt?.getTime()).toBe(
      before.listoneUpdatedAt?.getTime(),
    );
  });

  it("⚠ e nemmeno una risposta che non è quella attesa", async () => {
    const { impl } = fakeFetch({ [LISTONE_URL]: listoneBody });
    await refreshListoneInsights({ fetchImpl: impl });

    const html = fakeFetch({ [LISTONE_URL]: "<html>manutenzione</html>" });
    const result = await refreshListoneInsights({ fetchImpl: html.impl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SOURCE_UNREACHABLE");
    expect((await insightsStatus()).rows).toBe(497);
  });

  it("⚠ rifiuta una lista che non ha più niente in comune con quella di prima, e non scrive", async () => {
    const { impl } = fakeFetch({ [LISTONE_URL]: listoneBody });
    await refreshListoneInsights({ fetchImpl: impl });

    // Gli stessi giocatori con identificativi tutti nuovi: è esattamente il caso
    // che la continuità esiste per fermare.
    const payload = JSON.parse(listoneBody) as {
      players: { fantacalcio_id: number }[];
    };
    for (const p of payload.players) p.fantacalcio_id += 1_000_000;
    const rinumerata = fakeFetch({ [LISTONE_URL]: JSON.stringify(payload) });

    const result = await refreshListoneInsights({ fetchImpl: rinumerata.impl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SOURCE_COVERAGE");
      expect(result.error.message).toContain(
        String(Math.round(CONTINUITY_THRESHOLD * 100)),
      );
    }

    // La tabella è quella di prima: nessun id nuovo, nessuna riga in più.
    const status = await insightsStatus();
    expect(status.rows).toBe(497);
    const rinumerato = await db.query.playerInsights.findFirst({
      where: eq(playerInsights.extId, 531 + 1_000_000),
    });
    expect(rinumerato).toBeUndefined();
  });
});

suite.skipIf(!available)("i rigoristi e i calci piazzati", () => {
  it("aggiorna i due rank sulle righe che esistono", async () => {
    const listone = fakeFetch({ [LISTONE_URL]: listoneBody });
    await refreshListoneInsights({ fetchImpl: listone.impl });

    const { impl } = fakeFetch({ [RIGORISTI_URL]: rigoristiBody });
    const result = await refreshSetPieces({ fetchImpl: impl });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fromSource).toBe(92);
    expect(result.value.written).toBe(92);
    // Sulla pagina misurata si agganciano tutti: `unknown` esiste per il giorno
    // in cui non sarà più vero.
    expect(result.value.unknown).toEqual([]);

    // Scamacca è il primo rigorista dell'Atalanta.
    const scamacca = await db.query.playerInsights.findFirst({
      where: eq(playerInsights.extId, 2137),
    });
    expect(scamacca?.rigoristaRank).toBe(1);
    expect(scamacca?.setPiecesUpdatedAt).not.toBeNull();

    const status = await insightsStatus();
    expect(status.designated).toBe(92);
    expect(status.setPiecesUpdatedAt).not.toBeNull();
    // ⚠ Il refresh dei piazzati **non** tocca il timestamp del listone.
    expect(status.listoneUpdatedAt).not.toBeNull();
  });

  /**
   * ⚠ **La fonte B non tocca gol e assist**, ed è la metà di M21 §3 che il
   * codice non dice da solo: `refreshSetPieces` scrive i due rank con un
   * `UPDATE … SET`, quindi il giorno in cui qualcuno ci aggiungesse una colonna
   * della fonte A, una `GET` ai rigoristi comincerebbe a sovrascrivere i gol —
   * ed è **esattamente** la ragione per cui il foglio di Carmy ha una tabella
   * sua invece di tre colonne qui.
   *
   * Il momento in cui si romperebbe è invisibile a occhio: i due refresh
   * riescono, il pannello dice bene, e i numeri diventano zeri.
   */
  it("⚠ e non tocca gol e assist, che sono della fonte A", async () => {
    const listone = fakeFetch({ [LISTONE_URL]: listoneBody });
    await refreshListoneInsights({ fetchImpl: listone.impl });

    const prima = await db.query.playerInsights.findFirst({
      where: eq(playerInsights.extId, 2137),
    });
    expect(prima).toMatchObject({ golFatti: 8, assist: 1 });

    const { impl } = fakeFetch({ [RIGORISTI_URL]: rigoristiBody });
    const result = await refreshSetPieces({ fetchImpl: impl });
    expect(result.ok).toBe(true);

    // Scamacca è designato, quindi la sua riga è stata scritta davvero — e i due
    // numeri della fonte A sono ancora i suoi.
    const dopo = await db.query.playerInsights.findFirst({
      where: eq(playerInsights.extId, 2137),
    });
    expect(dopo?.rigoristaRank).toBe(1);
    expect(dopo).toMatchObject({ golFatti: 8, assist: 1 });

    // E nessuna riga della tabella ha perso i suoi: il totale è quello di prima.
    const [conti] = await db
      .select({ gol: sql<number>`sum(${playerInsights.golFatti})::int` })
      .from(playerInsights);
    expect(conti.gol).toBe(933);
  });

  it("⚠ rifiuta se il listone non è stato importato, invece di scrivere zero righe e dire bene", async () => {
    await db.delete(playerInsights);

    const { impl } = fakeFetch({ [RIGORISTI_URL]: rigoristiBody });
    const result = await refreshSetPieces({ fetchImpl: impl });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SOURCE_SCHEMA");
    expect((await insightsStatus()).rows).toBe(0);
  });

  it("toglie il rank a chi non è più designato: un rigorista non lo resta per sempre", async () => {
    const listone = fakeFetch({ [LISTONE_URL]: listoneBody });
    await refreshListoneInsights({ fetchImpl: listone.impl });
    const pieno = fakeFetch({ [RIGORISTI_URL]: rigoristiBody });
    await refreshSetPieces({ fetchImpl: pieno.impl });

    expect(
      (
        await db.query.playerInsights.findFirst({
          where: eq(playerInsights.extId, 2137),
        })
      )?.rigoristaRank,
    ).toBe(1);

    // La stessa pagina, ma Scamacca non è più nella lista dell'Atalanta.
    const senzaScamacca = rigoristiBody.replace(
      /href="[^"]*\/serie-a\/squadre\/atalanta\/scamacca\/2137"/g,
      'href="https://www.fantacalcio.it/serie-a/squadre/atalanta/altro/2137999"',
    );
    const dopo = fakeFetch({ [RIGORISTI_URL]: senzaScamacca });
    const result = await refreshSetPieces({ fetchImpl: dopo.impl });
    expect(result.ok).toBe(true);

    const scamacca = await db.query.playerInsights.findFirst({
      where: eq(playerInsights.extId, 2137),
    });
    expect(scamacca?.rigoristaRank).toBeNull();
    expect(scamacca?.piazzatiRank).toBeNull();
    if (result.ok) expect(result.value.unknown).toContain(2137999);
  });
});

suite.skipIf(!available)("la copertura, per asta", () => {
  it("⚠ un listone sintetico non aggancia niente e non fa fallire l'import di dati sani", async () => {
    // È il caso che ha cambiato il criterio della soglia (vedi
    // `CONTINUITY_THRESHOLD`): l'asta di gioco ha `ext_id` da 1 a 40, che nella
    // fonte non esistono.
    const game = await makeGameAuction();
    createdAuctions.push(game.auctionId);
    createdUsers.push(game.ownerId, ...game.userIds);

    await db.delete(playerInsights);
    const { impl } = fakeFetch({ [LISTONE_URL]: listoneBody });
    const result = await refreshListoneInsights({ fetchImpl: impl });

    // L'import riesce, e lo dice: 497 righe scritte.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.written).toBe(497);

    // Ma la copertura di quell'asta è quasi nulla, e il pannello lo mostra invece
    // di nasconderlo: è il modo in cui si capisce che il listone è finto.
    //
    // «Quasi» e non «del tutto»: due degli id sintetici (1..40) esistono per caso
    // anche nella fonte vera. È un dettaglio della fixture, non un comportamento
    // da bloccare — per questo l'asserzione guarda l'ordine di grandezza.
    // ⚠ Si chiede **questa** asta e non «le ultime cinque»: gli altri file di
    // test ne creano decine negli stessi secondi, in worker paralleli, e la
    // nostra non sarebbe fra le più recenti. È esattamente il motivo per cui
    // `insightsCoverage` ha il parametro.
    const coverage = await insightsCoverage(undefined, [game.auctionId]);
    const mine = coverage.find((c) => c.auctionId === game.auctionId);
    expect(mine).toBeDefined();
    expect(mine?.wanted).toBe(40);
    expect(mine?.matched).toBeLessThan(10);
    // `missing` è troncata a venti nomi di proposito: oltre, un elenco non
    // aggiunge informazione a chi guarda il pannello.
    expect(mine?.missing).toHaveLength(20);
  });

  it("senza nessuna asta la copertura è una lista vuota, non un errore", async () => {
    // Non si può misurare la copertura di un insieme vuoto: in produzione, il
    // giorno del deploy, è esattamente questo il caso.
    const coverage = await insightsCoverage();
    expect(Array.isArray(coverage)).toBe(true);
  });
});

suite.skipIf(!available)("il pool e gli insight", () => {
  beforeEach(async () => {
    await loadInsights();
  });

  it("⚠ senza il permesso la chiave `insights` non esiste nell'oggetto", async () => {
    const { auctionId } = await auctionWithRealExtIds();

    const pool = await listPickPool(auctionId, false);
    expect(pool.length).toBeGreaterThan(0);

    for (const player of pool) {
      // Non `toBeUndefined()`: la chiave non deve **esserci**. Un
      // `insights: undefined` sparirebbe nella serializzazione, ma direbbe che
      // qualcuno ha pensato di metterla e poi svuotarla — e la prossima modifica
      // la riempirebbe.
      expect(Object.keys(player)).not.toContain("insights");
    }

    // E il default è senza: un chiamante nuovo che si dimentica il flag non fa
    // uscire niente.
    const byDefault = await listPickPool(auctionId);
    for (const player of byDefault) {
      expect(Object.keys(player)).not.toContain("insights");
    }
  });

  it("con il permesso arrivano, agganciati per ext_id", async () => {
    const { auctionId } = await auctionWithRealExtIds();

    const pool = await listPickPool(auctionId, true);
    const withInsights = pool.filter((p) => p.insights !== undefined);

    // Il giocatore a cui abbiamo dato un `ext_id` vero c'è, con i suoi numeri.
    const berardi = withInsights.find((p) => p.insights?.extId === 531);
    expect(berardi?.insights).toMatchObject({
      team: "Sassuolo",
      statsSeason: "current",
      startsEleven: 24,
      // I due numeri di M21 fanno tutta la strada: fonte → tabella → pool. La
      // tab Listone li legge da qui, e non da una query sua.
      golFatti: 6,
      assist: 4,
    });

    // E la maggioranza resta **senza**, perché gli altri 39 hanno id sintetici:
    // è il caso «il listone ha un nome che la fonte non conosce», vero anche in
    // produzione (8 su 495). Due degli id da 1 a 40 esistono per caso nella
    // fonte, quindi il conto non è esattamente 1.
    expect(withInsights.length).toBeLessThan(5);
    expect(pool.length - withInsights.length).toBeGreaterThan(30);
  });

  it("il pool non porta `extId`: serviva solo ad agganciare", async () => {
    const { auctionId } = await auctionWithRealExtIds();
    for (const player of await listPickPool(auctionId, true)) {
      expect(Object.keys(player)).not.toContain("extId");
    }
  });

  it("⚠ con la tabella vuota il pool è quello di prima, insight o no", async () => {
    const { auctionId } = await auctionWithRealExtIds();
    await db.delete(playerInsights);

    const senza = await listPickPool(auctionId, false);
    const con = await listPickPool(auctionId, true);

    expect(con).toHaveLength(senza.length);
    for (const player of con) {
      expect(player.insights).toBeUndefined();
    }
    // È la prova che nessun dato di M8 sta su un percorso critico: con la tabella
    // vuota — cioè come nasce in produzione — la lista di chiamata è identica a
    // quella di prima della macro.
    expect(con.map((p) => p.id).sort()).toEqual(senza.map((p) => p.id).sort());
  });

  it("il predicato e la colonna sono d'accordo: è `canSeeInsights` a decidere, non la pagina", async () => {
    const { auctionId } = await auctionWithRealExtIds();

    const [normale, pro, admin] = await Promise.all([
      db
        .insert(users)
        .values({ displayName: "Normale", isPro: false })
        .returning({ id: users.id }),
      db
        .insert(users)
        .values({ displayName: "Pro", isPro: true })
        .returning({ id: users.id }),
      db
        .insert(users)
        .values({ displayName: "Admin", isAdmin: true })
        .returning({ id: users.id }),
    ]);
    createdUsers.push(normale[0].id, pro[0].id, admin[0].id);

    const rows = await db.select().from(users).where(eq(users.id, pro[0].id));
    expect(canSeeInsights(rows[0])).toBe(true);

    const proPool = await listPickPool(auctionId, canSeeInsights(rows[0]));
    expect(proPool.some((p) => p.insights !== undefined)).toBe(true);

    const plain = (await db.select().from(users).where(eq(users.id, normale[0].id)))[0];
    const plainPool = await listPickPool(auctionId, canSeeInsights(plain));
    expect(plainPool.every((p) => !("insights" in p))).toBe(true);

    // L'amministratore li vede **senza** avere il flag: altrimenti dovrebbe
    // accenderselo da sé per guardare i dati che ha appena importato.
    const boss = (await db.select().from(users).where(eq(users.id, admin[0].id)))[0];
    expect(boss.isPro).toBe(false);
    expect(canSeeInsights(boss)).toBe(true);
    const bossPool = await listPickPool(auctionId, canSeeInsights(boss));
    expect(bossPool.some((p) => p.insights !== undefined)).toBe(true);
  });
});

// ─── M11 — il refresh giornaliero ────────────────────────────────────────────

/**
 * Il tick contro Postgres vero (M11-08).
 *
 * ⚠ **Quasi tutto passa da `refreshDueSources` e non da `runRefreshTick`**, per la
 * ragione già scritta in `tests/db/bots.test.ts`: la guardia è una domanda
 * **globale** — «esiste un'asta reale in corso su questa macchina?» — e i file di
 * test girano in worker paralleli su un database condiviso. Un test che
 * pretendesse l'assenza di aste reali sarebbe rosso a seconda di cosa sta facendo
 * un altro file. `runRefreshTick` si prova quindi solo nella direzione robusta:
 * con un'asta reale accesa **deve** fermarsi.
 *
 * ⚠ **Conseguenza dichiarata:** «una simulata `LIVE` non ferma il tick» non è
 * verificabile qui senza flakiness — sarebbe rossa ogni volta che un altro file
 * ha un'asta vera accesa nello stesso istante. La guardia è `realAuctionRunning`,
 * **la stessa funzione** del tick dei bot, e la distinzione simulata/reale vive
 * lì; quel verso si prova in locale (M11-09, `HOWTO-PROVA-LOCALE` §8) con le
 * simulate del database di sviluppo.
 */
const t0 = Date.UTC(2026, 7, 13, 4, 0, 0);
const HOUR = 60 * 60 * 1000;

async function runRows() {
  return db.select().from(sourceRuns).orderBy(sourceRuns.source);
}

async function clearRuns(): Promise<void> {
  await db.delete(sourceRuns);
  await db.delete(playerInsights);
}

suite.skipIf(!available)("il tick del refresh", () => {
  it("un giro a tabella vuota chiede tutte e due le fonti, in ordine, e registra com'è andata", async () => {
    await clearRuns();
    const { impl, calls } = fakeFetch({
      [LISTONE_URL]: listoneBody,
      [RIGORISTI_URL]: rigoristiBody,
    });

    const outcome = await refreshDueSources({ fetchImpl: impl, now: t0 });

    // A prima di B: la seconda aggiorna righe che nascono dalla prima, e a
    // tabella vuota l'ordine è la differenza fra portare a casa tutte e due o
    // rimandare la seconda al giro dopo.
    expect(calls).toEqual([LISTONE_URL, RIGORISTI_URL]);
    expect(outcome.attempted).toEqual([
      { source: "listone_insights", ok: true },
      { source: "set_pieces", ok: true },
    ]);
    expect(outcome.skipped).toEqual([]);

    // I dati ci sono davvero: il tick non si limita a scrivere che è andata bene.
    const status = await insightsStatus();
    expect(status.rows).toBe(497);
    expect(status.designated).toBe(92);

    const rows = await runRows();
    expect(rows.map((r) => r.source)).toEqual([
      "listone_insights",
      "set_pieces",
    ]);
    for (const row of rows) {
      expect(row.ok).toBe(true);
      expect(row.failures).toBe(0);
      expect(row.message).toBeNull();
      expect(row.trigger).toBe("auto");
      expect(row.attemptedAt.getTime()).toBe(t0);
    }
    expect(rows[0].rows).toBe(497);
    expect(rows[1].rows).toBe(92);
  });

  it("⚠ due tick di fila fanno un solo tentativo", async () => {
    await clearRuns();
    const primo = fakeFetch({
      [LISTONE_URL]: listoneBody,
      [RIGORISTI_URL]: rigoristiBody,
    });
    await refreshDueSources({ fetchImpl: primo.impl, now: t0 });

    // Un quarto d'ora dopo, cioè il tick successivo: nessuna delle due è scaduta.
    const secondo = fakeFetch({
      [LISTONE_URL]: listoneBody,
      [RIGORISTI_URL]: rigoristiBody,
    });
    const outcome = await refreshDueSources({
      fetchImpl: secondo.impl,
      now: t0 + 15 * 60 * 1000,
    });

    // ⚠ Il conto sta a database, non nel processo: la fonte non viene nemmeno
    // sfiorata, e un riavvio in mezzo non cambierebbe niente.
    expect(secondo.calls).toEqual([]);
    expect(outcome.attempted).toEqual([]);
    expect(outcome.skipped).toEqual([
      { source: "listone_insights", reason: "not-due" },
      { source: "set_pieces", reason: "not-due" },
    ]);

    const rows = await runRows();
    for (const row of rows) expect(row.attemptedAt.getTime()).toBe(t0);
  });

  it("⚠ una fonte che risponde male non scrive i dati, scrive il fallimento, e incrementa `failures`", async () => {
    await clearRuns();
    const buono = fakeFetch({
      [LISTONE_URL]: listoneBody,
      [RIGORISTI_URL]: rigoristiBody,
    });
    await refreshDueSources({ fetchImpl: buono.impl, now: t0 });
    const prima = await insightsStatus();

    // Il giorno dopo tutte e due sono scadute, ma la fonte A è giù. ⚠ Le due
    // fonti sono **indipendenti**: il guasto dell'una non ferma l'altra, che
    // infatti passa — è la ragione per cui `source_runs` ha due righe e non un
    // esito solo.
    const rotta = fakeFetch({ [RIGORISTI_URL]: rigoristiBody });
    const uno = await refreshDueSources({
      fetchImpl: rotta.impl,
      now: t0 + 25 * HOUR,
    });
    expect(uno.attempted).toEqual([
      { source: "listone_insights", ok: false },
      { source: "set_pieces", ok: true },
    ]);

    // I dati sono quelli di prima: il caso peggiore automatico è sapere numeri
    // vecchi, mai numeri falsi (M11 §7).
    const dopo = await insightsStatus();
    expect(dopo.rows).toBe(prima.rows);
    expect(dopo.listoneUpdatedAt?.getTime()).toBe(
      prima.listoneUpdatedAt?.getTime(),
    );

    const [listone] = await runRows();
    expect(listone.ok).toBe(false);
    expect(listone.failures).toBe(1);
    expect(listone.rows).toBeNull();
    // Il messaggio è quello del `Result`, così com'è: è già scritto per un umano.
    expect(listone.message).toContain("fonte");

    // ⚠ Mezz'ora dopo **non** si riprova: è la riga che protegge un sito che non
    // è nostro da novantasei richieste al giorno.
    const troppoPresto = fakeFetch({});
    await refreshDueSources({
      fetchImpl: troppoPresto.impl,
      now: t0 + 25 * HOUR + 30 * 60 * 1000,
    });
    expect(troppoPresto.calls).toEqual([]);

    // Passata l'ora sì, e il contatore sale.
    const ancoraRotta = fakeFetch({});
    await refreshDueSources({
      fetchImpl: ancoraRotta.impl,
      now: t0 + 26 * HOUR + 5 * 60 * 1000,
    });
    expect(ancoraRotta.calls).toEqual([LISTONE_URL]);
    const [dueVolte] = await runRows();
    expect(dueVolte.failures).toBe(2);

    // E un successo riazzera il contatore, senza passare da nessun `UPDATE` a
    // mano: è il `case when excluded.ok` dell'`upsert`.
    const tornata = fakeFetch({ [LISTONE_URL]: listoneBody });
    await refreshDueSources({ fetchImpl: tornata.impl, now: t0 + 30 * HOUR });
    const [guarita] = await runRows();
    expect(guarita.ok).toBe(true);
    expect(guarita.failures).toBe(0);
    expect(guarita.message).toBeNull();
  });

  it("⚠ a `player_insights` vuota la fonte B si salta, e non si registra come fallita", async () => {
    await clearRuns();
    // La A è giù, quindi la tabella resta vuota: è il caso del giorno del
    // deploy, e mandare la B in backoff per un ordine di operazioni che si
    // sistema da sé sarebbe punire la sequenza giusta.
    const { impl, calls } = fakeFetch({ [RIGORISTI_URL]: rigoristiBody });

    const outcome = await refreshDueSources({ fetchImpl: impl, now: t0 });

    expect(outcome.attempted).toEqual([
      { source: "listone_insights", ok: false },
    ]);
    expect(outcome.skipped).toEqual([
      { source: "set_pieces", reason: "no-insights" },
    ]);
    // La pagina dei rigoristi non viene nemmeno chiesta.
    expect(calls).toEqual([LISTONE_URL]);

    // ⚠ Una riga sola: la B non ha lasciato traccia, quindi al primo giro utile
    // riproverà subito invece di aspettare un'ora.
    const rows = await runRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("listone_insights");
  });

  it("⚠ con un'asta reale LIVE il tick non fa niente e non tocca `source_runs`", async () => {
    await clearRuns();

    const real = await makeGameAuction();
    createdAuctions.push(real.auctionId);
    createdUsers.push(real.ownerId, ...real.userIds);
    const avviata = await startAuction(real.ownerId, real.auctionId, 0);
    expect(avviata.ok).toBe(true);

    const { impl, calls } = fakeFetch({
      [LISTONE_URL]: listoneBody,
      [RIGORISTI_URL]: rigoristiBody,
    });
    const outcome = await runRefreshTick({ fetchImpl: impl, now: t0 });

    expect(outcome).toEqual({ standBy: true, attempted: [], skipped: [] });
    // Nessuna `fetch` da mezzo megabyte accanto a un round da chiudere…
    expect(calls).toEqual([]);
    // …e nessuna riga: **un tick saltato non è un tentativo fallito**. Se lo
    // registrasse, una serata d'asta manderebbe le fonti in backoff per un
    // guasto che non c'è stato.
    expect(await runRows()).toHaveLength(0);
    expect((await insightsStatus()).rows).toBe(0);
  });
});

suite.skipIf(!available)("`source_runs`, per il pannello", () => {
  it("sono sempre due voci, anche senza nessun tentativo registrato", async () => {
    await clearRuns();

    const status = await sourceRunsStatus();
    expect(status.map((s) => s.source)).toEqual([
      "listone_insights",
      "set_pieces",
    ]);
    // «Non ho mai provato» è una risposta, e una fonte che sparisse dal pannello
    // perché non ha una riga sarebbe il silenzio che M11 esiste per togliere.
    for (const voce of status) {
      expect(voce.ok).toBeNull();
      expect(voce.attemptedAt).toBeNull();
      expect(voce.failures).toBe(0);
      expect(voce.nextAttemptAt).toBeNull();
    }
  });

  it("dopo un successo dice quando riproverà: ventiquattr'ore dopo il tentativo", async () => {
    await clearRuns();
    const { impl } = fakeFetch({
      [LISTONE_URL]: listoneBody,
      [RIGORISTI_URL]: rigoristiBody,
    });
    await refreshDueSources({ fetchImpl: impl, now: t0 });

    const [listone] = await sourceRunsStatus();
    expect(listone.ok).toBe(true);
    expect(listone.rows).toBe(497);
    expect(listone.trigger).toBe("auto");
    expect(listone.nextAttemptAt?.getTime()).toBe(t0 + 24 * HOUR);
  });

  it("⚠ dopo un fallimento la prossima è fra un'ora, non fra un giorno", async () => {
    await clearRuns();
    await refreshDueSources({ fetchImpl: fakeFetch({}).impl, now: t0 });

    const [listone] = await sourceRunsStatus();
    expect(listone.ok).toBe(false);
    expect(listone.failures).toBe(1);
    expect(listone.nextAttemptAt?.getTime()).toBe(t0 + 1 * HOUR);
  });

  it("⚠ un tentativo manuale scrive la stessa riga, e si distingue dal `trigger`", async () => {
    await clearRuns();
    // Il fallimento automatico di ieri…
    await refreshDueSources({ fetchImpl: fakeFetch({}).impl, now: t0 });
    expect((await runRows())[0].trigger).toBe("auto");

    // …e il pulsante premuto stasera, che riesce. È la ragione per cui i due
    // pulsanti scrivono qui: senza, la pagina continuerebbe a dire «ultimo
    // tentativo fallito» dopo un aggiornamento andato a buon fine.
    await recordSourceRun(
      "listone_insights",
      "manual",
      { ok: true, value: { fromSource: 497 } },
      new Date(t0 + HOUR),
    );

    const [row] = await runRows();
    expect(row).toMatchObject({
      trigger: "manual",
      ok: true,
      failures: 0,
      rows: 497,
      message: null,
    });
    expect(row.attemptedAt.getTime()).toBe(t0 + HOUR);
  });

  it("⚠ e un fallimento manuale rimanda in avanti anche il tentativo automatico", async () => {
    await clearRuns();
    await recordSourceRun(
      "set_pieces",
      "manual",
      { ok: false, error: { code: "SOURCE_UNREACHABLE", message: "giù" } },
      new Date(t0),
    );

    // Il backoff protegge la fonte da **tutti** i chiamanti, non solo dal loop.
    const status = await sourceRunsStatus();
    expect(status[1].nextAttemptAt?.getTime()).toBe(t0 + 1 * HOUR);

    // Mezz'ora dopo il tick non ci riprova: la salta perché non è scaduta, e non
    // perché la tabella degli insight è vuota — le due ragioni sono diverse e il
    // codice le distingue.
    const { impl, calls } = fakeFetch({
      [LISTONE_URL]: listoneBody,
      [RIGORISTI_URL]: rigoristiBody,
    });
    const outcome = await refreshDueSources({
      fetchImpl: impl,
      now: t0 + 30 * 60 * 1000,
    });
    expect(outcome.skipped).toContainEqual({
      source: "set_pieces",
      reason: "not-due",
    });
    expect(calls).toEqual([LISTONE_URL]);
  });
});
