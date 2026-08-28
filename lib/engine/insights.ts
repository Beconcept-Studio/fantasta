import { desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { auctions, playerInsights, players } from "@/lib/db/schema";
import {
  type ParsedInsight,
  parseFantalabListone,
} from "@/lib/import/parseFantalabListone";
import { parseRigoristi, setPiecesByExtId } from "@/lib/import/parseRigoristi";

import { type Result, fail, ok } from "./errors";

/**
 * Gli insight sul listone (M8): le due `fetch`, le due scritture, la copertura.
 *
 * ## Perché sta nel motore, ed è l'unico file di M8 che ci sta
 *
 * Perché tocca `lib/db`. I tre parser stanno in `lib/import/` e sono **puri** —
 * bytes in, `Result` fuori — quindi si provano sulle risposte salvate in
 * `fixtures/` senza rete e senza database. Qui c'è solo ciò che non si può
 * provare senza il mondo: la chiamata alla fonte e l'`upsert`. **Nessuna
 * eccezione nuova all'allowlist ESLint**: `lib/engine/**` era già dentro.
 *
 * ## Niente lock, e perché
 *
 * `withAuctionLock` serializza le mutazioni **di un'asta**. Qui non si tocca
 * nessuna asta: `player_insights` è globale e non entra in nessuna regola di
 * gioco (M8 §3). Due refresh dati insieme si sovrascriverebbero a vicenda con gli
 * stessi dati, che è il caso più innocuo che esista.
 *
 * ## Ma dentro una transazione, sì
 *
 * Perché una fonte può rispondere a metà, e **una tabella riempita a metà è
 * peggio di una vuota**: vuota si vede, a metà si crede. La transazione copre la
 * scrittura *e* il controllo di copertura, così sotto soglia non resta niente.
 *
 * ## Niente lavoro in background
 *
 * Due richieste, due secondi misurati (M8 §1). Il precedente è il downloader
 * figurine di M7: 495 download in 7,3 secondi hanno cancellato un intero
 * sottosistema di batching dalla spec. Se un giorno qui dentro compare un
 * singleton su `globalThis` o una tabella di avanzamento, è quel lavoro che sta
 * rientrando dalla finestra.
 */

// ─── Le due fonti ────────────────────────────────────────────────────────────

export const LISTONE_URL = "https://api.fantalab.it/v2/listone";
export const RIGORISTI_URL = "https://www.fantacalcio.it/rigoristi-serie-a";

/**
 * Dieci secondi per fonte.
 *
 * ⚠ Il margine è calcolato, non scelto a naso: le due risposte misurate stanno in
 * 1,16 s e 0,85 s, e `location /` in `deploy/nginx-asta.conf` non imposta
 * `proxy_read_timeout`, quindi vale il default di **60 secondi**. Dieci secondi
 * per fonte lasciano un fattore otto di margine e restano dentro il limite di
 * nginx anche se entrambe le fonti vanno in timeout una dietro l'altra.
 */
const SOURCE_TIMEOUT_MS = 10_000;

/**
 * La soglia di **continuità** sotto la quale l'import fallisce invece di scrivere.
 *
 * ⚠ **Si confronta con l'import precedente, non con i listoni delle aste**, e il
 * perché è la parte da non perdere. La spec prevedeva la seconda cosa: «sotto
 * soglia di copertura contro il listone dell'asta, non scrivere». Scrivendo il
 * test si è visto che è **avvelenabile**: il listone di un'asta simulata ha
 * `ext_id` sintetici da 1 a 40, che nella fonte non esistono, quindi una sola
 * asta di prova nel database porta la copertura a zero e fa fallire l'import
 * **su dati perfetti**. Un controllo che si può far scattare da un'altra parte
 * dell'applicazione non è un controllo, è una trappola.
 *
 * La continuità invece misura ciò che il controllo vuole davvero sapere — *la
 * fonte parla ancora la stessa lingua?* — confrontando gli `ext_id` nuovi con
 * quelli dell'import precedente. Al primo import non c'è niente da confrontare e
 * il controllo si salta, che è corretto: non si può dedurre un cambiamento dal
 * nulla.
 *
 * 85% e non 99% perché anche fra due import veri qualche giocatore cambia: un
 * ritiro, un trasferimento fuori dalla Serie A. Sotto l'85% è cambiato qualcosa
 * di strutturale, e allora è giusto non scrivere.
 */
export const CONTINUITY_THRESHOLD = 0.85;

type FetchLike = typeof fetch;

type Clock = () => Date;

/**
 * Chi sa leggere: `db` oppure la transazione, che hanno gli stessi metodi. Il tipo
 * è strutturale perché la copertura si calcola in entrambi i mondi — fuori per il
 * pannello, dentro per decidere se tenere la scrittura.
 */
type Reader = Pick<typeof db, "select" | "selectDistinct">;

/** L'esito di un refresh, così come lo mostra il pannello. */
export type RefreshOutcome = {
  /** Righe lette dalla fonte. */
  fromSource: number;
  /** Righe scritte (inserite o aggiornate). */
  written: number;
  /** Quanti `ext_id` erano già lì prima: `null` al primo import. */
  continuity: number | null;
  /** La copertura dei listoni delle aste, dopo la scrittura. */
  coverage: Coverage[];
  updatedAt: Date;
};

/**
 * Quanto del listone di **una** asta è agganciato.
 *
 * ⚠ È per asta e non aggregata perché la domanda che si fa davvero guardando il
 * pannello è «il *mio* listone è coperto?». Un totale su tutte le aste
 * mescolerebbe un listone vero con quello sintetico di una simulazione, e
 * risponderebbe a una domanda che nessuno si è fatto.
 */
export type Coverage = {
  auctionId: string;
  auctionName: string;
  /** `ext_id` distinti nel listone di quest'asta. */
  wanted: number;
  /** Quanti di quelli hanno una riga di insight. */
  matched: number;
  /** I nomi non agganciati, per il pannello: al massimo venti, poi si capisce. */
  missing: { extId: number; name: string }[];
};

/**
 * Scarica un corpo di testo da una fonte pubblica.
 *
 * Un `!res.ok` e un errore di rete rispondono con lo **stesso** codice, di
 * proposito: da fuori sono la stessa cosa — la fonte non ha dato quello che
 * doveva — e distinguerli darebbe due messaggi da leggere invece di uno.
 */
async function fetchText(
  url: string,
  fetchImpl: FetchLike,
): Promise<Result<string>> {
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      headers: { accept: "application/json, text/html;q=0.9, */*;q=0.5" },
    });
    if (!res.ok) {
      return fail(
        "SOURCE_UNREACHABLE",
        `La fonte ha risposto ${res.status}. Riprova fra qualche minuto: non c'è niente da sistemare da parte nostra.`,
      );
    }
    return ok(await res.text());
  } catch (error) {
    const reason = error instanceof Error ? error.name : "errore";
    return fail(
      "SOURCE_UNREACHABLE",
      `Non sono riuscito a interrogare la fonte (${reason}). Se è un timeout, il sito è lento o giù: riprova.`,
    );
  }
}

// ─── La copertura ────────────────────────────────────────────────────────────

/**
 * Quante aste guarda il pannello. Le più recenti: le altre sono archivio, e una
 * copertura vecchia non dice niente su cosa succederà stasera.
 */
const COVERAGE_AUCTIONS = 5;

/**
 * La copertura del listone delle ultime aste.
 *
 * ⚠ **Il denominatore sono i `players` di un'asta, non il conteggio della
 * fonte.** «497 su 497» sarebbe vero e inutile: alla fonte non interessa il
 * nostro listone. Il numero che serve è quanti dei giocatori che si possono
 * *chiamare stasera* hanno qualcosa da dire — misurato 487 su 495.
 */
export async function insightsCoverage(
  tx: Reader = db,
  /**
   * Aste precise invece delle ultime cinque.
   *
   * ⚠ Il secondo chiamante è **il test**, e non è una concessione: senza questo
   * parametro, un test che verifica la copertura della *propria* asta dipende da
   * quante aste hanno creato gli altri file di test nel frattempo — e vitest li
   * gira in parallelo. Verde da solo, rosso nella suite: è successo, ed è il modo
   * peggiore di rompersi. Il pannello continua a non passare niente.
   */
  auctionIds?: string[],
): Promise<Coverage[]> {
  const recent =
    auctionIds === undefined
      ? await tx
          .select({ id: auctions.id, name: auctions.name })
          .from(auctions)
          .orderBy(desc(auctions.createdAt))
          .limit(COVERAGE_AUCTIONS)
      : await tx
          .select({ id: auctions.id, name: auctions.name })
          .from(auctions)
          .where(inArray(auctions.id, auctionIds));

  if (recent.length === 0) return [];

  const covered = await tx
    .select({ extId: playerInsights.extId })
    .from(playerInsights);
  const have = new Set(covered.map((r) => r.extId));

  const out: Coverage[] = [];
  for (const auction of recent) {
    const wanted = await tx
      .selectDistinct({ extId: players.extId, name: players.name })
      .from(players)
      .where(eq(players.auctionId, auction.id));
    if (wanted.length === 0) continue;

    const missing = wanted
      .filter((p) => !have.has(p.extId))
      .sort((a, b) => a.name.localeCompare(b.name, "it"));

    out.push({
      auctionId: auction.id,
      auctionName: auction.name,
      wanted: wanted.length,
      matched: wanted.length - missing.length,
      missing: missing.slice(0, 20),
    });
  }
  return out;
}

/**
 * Quanti degli `ext_id` che c'erano prima ci sono ancora: il controllo di
 * continuità di `CONTINUITY_THRESHOLD`. `null` al primo import.
 */
async function continuity(
  tx: Reader,
  fresh: Set<number>,
): Promise<{ before: number; kept: number } | null> {
  const previous = await tx
    .select({ extId: playerInsights.extId })
    .from(playerInsights);
  if (previous.length === 0) return null;

  const kept = previous.filter((r) => fresh.has(r.extId)).length;
  return { before: previous.length, kept };
}

function continuityRefusal<T>(before: number, kept: number): Result<T> {
  const pct = ((kept / before) * 100).toFixed(1);
  return fail<T>(
    "SOURCE_COVERAGE",
    `La fonte manda una lista che ha in comune solo ${kept} dei ${before} giocatori di prima (${pct}%): ` +
      `sotto il ${Math.round(CONTINUITY_THRESHOLD * 100)}% non scrivo niente, perché un cambio così grosso vuol dire ` +
      `che la fonte ha cambiato gli identificativi — non che qualcuno si è ritirato.`,
  );
}

/** Un errore che porta con sé il rifiuto, per far tornare indietro la transazione. */
class Rollback extends Error {
  constructor(readonly refusal: Result<never>) {
    super("rollback");
  }
}

async function inTransaction<T>(
  work: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<Result<T>>,
): Promise<Result<T>> {
  try {
    return await db.transaction(async (tx) => {
      const outcome = await work(tx);
      // Un `Result` di rifiuto non è un'eccezione, ma qui deve far tornare
      // indietro la scrittura: si esce lanciando, e si rientra nel `catch`.
      if (!outcome.ok) throw new Rollback(outcome as Result<never>);
      return outcome;
    });
  } catch (error) {
    if (error instanceof Rollback) return error.refusal as Result<T>;
    throw error;
  }
}

// ─── Fonte A: il listone Fantalab ────────────────────────────────────────────

/**
 * Scarica la fonte A e riscrive le colonne che vengono da lei.
 *
 * ⚠ **L'`upsert` aggiorna solo le proprie colonne.** `rigorista_rank` e
 * `piazzati_rank` vengono dalla fonte B e non si toccano: due fonti indipendenti
 * si aggiornano quando vogliono, e un refresh del listone non deve cancellare i
 * rigoristi importati ieri. Per la stessa ragione ci sono **due** timestamp.
 */
export async function refreshListoneInsights(
  options: { fetchImpl?: FetchLike; now?: Clock } = {},
): Promise<Result<RefreshOutcome>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  const body = await fetchText(LISTONE_URL, fetchImpl);
  if (!body.ok) return body;

  const parsed = parseFantalabListone(body.value);
  if (!parsed.ok) return parsed;

  const updatedAt = now();
  const rows = parsed.value.rows;

  return inTransaction(async (tx) => {
    // Il confronto va fatto **prima** di scrivere: dopo, gli `ext_id` di prima
    // sono già stati sovrascritti e non c'è più niente con cui confrontarsi.
    const before = await continuity(tx, new Set(rows.map((r) => r.extId)));
    if (before && before.kept / before.before < CONTINUITY_THRESHOLD) {
      return continuityRefusal<RefreshOutcome>(before.before, before.kept);
    }

    await writeListoneRows(tx, rows, updatedAt);

    return ok({
      fromSource: rows.length,
      written: rows.length,
      continuity: before ? before.kept : null,
      coverage: await insightsCoverage(tx),
      updatedAt,
    });
  });
}

type Writer = Pick<typeof db, "insert" | "update" | "select" | "selectDistinct">;

async function writeListoneRows(
  tx: Writer,
  rows: ParsedInsight[],
  updatedAt: Date,
): Promise<void> {
  // A blocchi, perché un solo `INSERT` da 497 righe con diciassette colonne
  // supera comodamente i parametri che ci stanno in una query.
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => ({ ...r, listoneUpdatedAt: updatedAt }));
    await tx
      .insert(playerInsights)
      .values(chunk)
      .onConflictDoUpdate({
        target: playerInsights.extId,
        set: {
          fantalabId: sql`excluded.fantalab_id`,
          fullName: sql`excluded.full_name`,
          name: sql`excluded.name`,
          team: sql`excluded.team`,
          statsSeason: sql`excluded.stats_season`,
          presenze: sql`excluded.presenze`,
          startsEleven: sql`excluded.starts_eleven`,
          minPlayingTime: sql`excluded.min_playing_time`,
          rigoriFatti: sql`excluded.rigori_fatti`,
          rigoriSbagliati: sql`excluded.rigori_sbagliati`,
          rigoriParati: sql`excluded.rigori_parati`,
          fmvHome: sql`excluded.fmv_home`,
          fmvAway: sql`excluded.fmv_away`,
          // ⚠ Gol e assist stanno **qui e in nessun'altra scrittura** (M21 §3):
          // sono colonne della fonte A, e `refreshSetPieces` continua a toccare
          // i due rank e basta. Mescolare le due scritture è il modo in cui una
          // `GET` cancella i dati dell'altra — la ragione per cui il foglio di
          // Carmy ha una tabella sua invece di tre colonne in questa.
          golFatti: sql`excluded.gol_fatti`,
          assist: sql`excluded.assist`,
          listoneUpdatedAt: sql`excluded.listone_updated_at`,
        },
      });
  }
}

// ─── Fonte B: rigoristi e calci piazzati ─────────────────────────────────────

export type SetPiecesOutcome = {
  /** Giocatori designati letti dalla pagina. */
  fromSource: number;
  /** Quanti di quelli erano già nella tabella e sono stati aggiornati. */
  written: number;
  /** Quelli che la tabella non conosce: vanno detti, non ingoiati. */
  unknown: number[];
  updatedAt: Date;
};

/**
 * Scarica la fonte B e scrive i due rank.
 *
 * ⚠ **Aggiorna, non inserisce.** Le righe nascono dalla fonte A, che è quella che
 * porta le colonne `NOT NULL`: un rigorista di cui non sappiamo né presenze né
 * squadra non è una riga che vogliamo. Quindi se la tabella è vuota questo
 * refresh **rifiuta e lo dice**, invece di scrivere zero righe e dichiarare
 * successo — che è il modo esatto in cui un pulsante insegna a non fidarsi di sé.
 *
 * Sulla pagina misurata i 92 designati si agganciano **tutti**; `unknown` esiste
 * per il giorno in cui non sarà più vero.
 */
export async function refreshSetPieces(
  options: { fetchImpl?: FetchLike; now?: Clock } = {},
): Promise<Result<SetPiecesOutcome>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  const body = await fetchText(RIGORISTI_URL, fetchImpl);
  if (!body.ok) return body;

  const parsed = parseRigoristi(body.value);
  if (!parsed.ok) return parsed;

  const byExtId = setPiecesByExtId(parsed.value);
  const updatedAt = now();

  return inTransaction(async (tx) => {
    const existing = await tx
      .select({ extId: playerInsights.extId })
      .from(playerInsights);

    if (existing.length === 0) {
      return fail<SetPiecesOutcome>(
        "SOURCE_SCHEMA",
        "Prima va importato il listone: i rigoristi aggiornano righe che nascono da lì, non le creano.",
      );
    }

    const known = new Set(existing.map((r) => r.extId));
    const unknown: number[] = [];
    let written = 0;

    for (const [extId, ranks] of byExtId) {
      if (!known.has(extId)) {
        unknown.push(extId);
        continue;
      }
      await tx
        .update(playerInsights)
        .set({ ...ranks, setPiecesUpdatedAt: updatedAt })
        .where(eq(playerInsights.extId, extId));
      written += 1;
    }

    // Chi non è più designato torna `null`: un rigorista dell'anno scorso che
    // resta primo in eterno è un dato che invecchia senza dirlo.
    const stillDesignated = [...byExtId.keys()].filter((id) => known.has(id));
    if (stillDesignated.length > 0) {
      await tx
        .update(playerInsights)
        .set({ rigoristaRank: null, piazzatiRank: null, setPiecesUpdatedAt: updatedAt })
        .where(
          sql`${playerInsights.extId} NOT IN ${stillDesignated} AND (${playerInsights.rigoristaRank} IS NOT NULL OR ${playerInsights.piazzatiRank} IS NOT NULL)`,
        );
    }

    return ok({ fromSource: byExtId.size, written, unknown, updatedAt });
  });
}

// ─── Lo stato, per il pannello ───────────────────────────────────────────────

export type InsightsStatus = {
  rows: number;
  /** Quante righe hanno i numeri della stagione corrente, cioè quelle mostrabili. */
  current: number;
  designated: number;
  listoneUpdatedAt: Date | null;
  setPiecesUpdatedAt: Date | null;
  coverage: Coverage[];
};

/**
 * Cosa c'è nella tabella, e quanto è vecchio.
 *
 * I **due** timestamp sono separati perché le fonti sono due e si aggiornano
 * quando vogliono: un pannello che ne mostrasse uno solo non saprebbe dire quale
 * delle due è ferma da tre mesi.
 */
export async function insightsStatus(): Promise<InsightsStatus> {
  const [totals] = await db
    .select({
      rows: sql<number>`count(*)::int`,
      current: sql<number>`count(*) filter (where ${playerInsights.statsSeason} = 'current')::int`,
      designated: sql<number>`count(*) filter (where ${playerInsights.rigoristaRank} is not null or ${playerInsights.piazzatiRank} is not null)::int`,
      listoneUpdatedAt: sql<string | null>`max(${playerInsights.listoneUpdatedAt})`,
      setPiecesUpdatedAt: sql<string | null>`max(${playerInsights.setPiecesUpdatedAt})`,
    })
    .from(playerInsights);

  return {
    rows: totals?.rows ?? 0,
    current: totals?.current ?? 0,
    designated: totals?.designated ?? 0,
    listoneUpdatedAt: asDate(totals?.listoneUpdatedAt),
    setPiecesUpdatedAt: asDate(totals?.setPiecesUpdatedAt),
    coverage: await insightsCoverage(),
  };
}

/**
 * ⚠ **Un `max()` scritto in SQL grezzo torna una stringa, non una `Date`.**
 * Drizzle converte i timestamp quando la colonna è nel `select` per nome, perché
 * conosce il suo tipo; dentro un `sql<...>` il tipo è **una promessa di chi
 * scrive**, e qui la promessa era falsa. Il test se n'è accorto con un
 * `getTime is not a function`, che è esattamente il genere di errore che si
 * scopre in pagina alle nove di sera se nessuno lo cerca prima.
 */
function asDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(value);
}

/**
 * Gli insight dei giocatori di un'asta, per `ext_id`.
 *
 * Vive qui e non in `setup.ts` perché è una lettura di questa tabella, ma il suo
 * chiamante è `listPickPool`: è il punto in cui i due mondi si toccano, e il
 * `LEFT JOIN` sta là dove il pool si costruisce.
 */
export async function insightsForExtIds(
  extIds: number[],
): Promise<Map<number, typeof playerInsights.$inferSelect>> {
  if (extIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(playerInsights)
    .where(inArray(playerInsights.extId, extIds));
  return new Map(rows.map((r) => [r.extId, r]));
}

/** Quanti giocatori designati ci sono: serve solo al test di fumo del pannello. */
export async function countDesignated(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(playerInsights)
    .where(isNotNull(playerInsights.rigoristaRank));
  return row?.n ?? 0;
}
