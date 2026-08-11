import { readFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, suite } from "vitest";

import { db } from "@/lib/db";
import { playerInsights } from "@/lib/db/schema";
import {
  CONTINUITY_THRESHOLD,
  LISTONE_URL,
  RIGORISTI_URL,
  insightsCoverage,
  insightsStatus,
  refreshListoneInsights,
  refreshSetPieces,
} from "@/lib/engine/insights";

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
 */

const FIXTURES = path.resolve(__dirname, "..", "..", "fixtures");

let listoneBody: string;
let rigoristiBody: string;
const createdAuctions: string[] = [];
const createdUsers: string[] = [];

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

beforeAll(async () => {
  listoneBody = await readFile(
    path.join(FIXTURES, "fantalab-listone.json"),
    "utf8",
  );
  rigoristiBody = await readFile(path.join(FIXTURES, "rigoristi.html"), "utf8");
  if (available) await db.delete(playerInsights);
});

afterAll(async () => {
  if (available) {
    await db.delete(playerInsights);
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
    const coverage = await insightsCoverage();
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
