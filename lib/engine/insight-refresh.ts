import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { playerInsights, type SourceRunRow, sourceRuns } from "@/lib/db/schema";
import { REFRESH_SOURCES, type RefreshSource } from "@/lib/domain";
import type { SourceRunStatus } from "@/lib/source-status";

import { realAuctionRunning } from "./bots";
import type { Result } from "./errors";
import { refreshListoneInsights, refreshSetPieces } from "./insights";
import { type LastAttempt, nextAttemptAt, shouldAttempt } from "./refresh-rules";
import type { Millis } from "./types";

/**
 * Il refresh giornaliero delle due fonti pubbliche (M11).
 *
 * ## Cosa aggiunge, e cosa no
 *
 * **Non aggiunge un import: aggiunge chi lo chiama.** `refreshListoneInsights` e
 * `refreshSetPieces` esistono da M8, accettano già una `fetch` e un orologio
 * iniettabili, sono già in transazione, validano già l'envelope e rifiutano già
 * sotto l'85% di continuità. Qui non c'è nessuna logica di import: c'è la
 * decisione di *quando* chiamarle, la guardia che dice quando non farlo, e il
 * posto in cui si scrive com'è andata.
 *
 * ## Perché non è lo «scheduler esterno» che lo stack vieta
 *
 * `CLAUDE.md` vieta Redis, code, worker separati e servizi di scheduling. Qui non
 * c'è nessuno dei quattro: **nessun processo nuovo, nessun cron di sistema,
 * nessuna unità systemd**. È un `setInterval` dentro il processo che c'è già, e
 * ha due precedenti letterali in casa — lo sweep di `scheduler.ts` e il tick di
 * `bots.ts`. Poggia sulla stessa garanzia di quei due, e non ne aggiunge di
 * nuove: `exec_mode: "fork"` e `instances: 1` in `deploy/ecosystem.config.cjs`.
 *
 * ## E la regola 1 («mai un timer che decide»)
 *
 * Questo timer non decide niente **di un'asta**: non chiama `transition`, non
 * prende `withAuctionLock`, non tocca `auctions`, `lots`, `bids`, `assignments`
 * né `ledger`, non incrementa `state_version`, non fa nessun broadcast. Decide
 * una cosa sola: *se è il momento di chiedere a un sito web se ha numeri nuovi.*
 * È lo stesso confine che M8 aveva già tracciato per non prendere il lock —
 * `player_insights` è globale e non entra in nessuna regola di gioco. La domanda
 * da farsi la prossima volta è quella, non «è un timer?»: **tocca lo stato
 * dell'asta? Allora no.**
 */

// ─── Le due fonti ────────────────────────────────────────────────────────────

/**
 * ⚠ I nomi delle due fonti e il loro **ordine** stanno in `lib/domain.ts`, non
 * qui: il pannello è un client component e ha bisogno degli stessi nomi, e questo
 * modulo importa `lib/db`. L'ordine è A prima di B, e la ragione è scritta là.
 */

/**
 * Ogni quarto d'ora.
 *
 * ⚠ **Il tick è grossolano di proposito, perché non è lui a decidere.** A dire
 * «è passato un giorno» è `source_runs`, non l'intervallo: un `setInterval` da
 * ventiquattro ore sarebbe ancorato al **boot**, e il processo riparte a ogni
 * push su `main` — in una settimana di rilasci non scatterebbe mai (M11 §3).
 * Quindici minuti è la granularità con cui il refresh scivola in avanti nella
 * giornata, ed è accettabile: un dato di mercato non ha un'ora.
 */
export const REFRESH_TICK_MS = 15 * 60 * 1000;

// ─── Leggere e scrivere `source_runs` ────────────────────────────────────────

/** Le due righe, per fonte. Assente = nessun tentativo mai registrato. */
async function lastAttempts(): Promise<Map<RefreshSource, SourceRunRow>> {
  const rows = await db.select().from(sourceRuns);
  return new Map(rows.map((row) => [row.source, row]));
}

function asLastAttempt(row: SourceRunRow | undefined): LastAttempt | null {
  if (row === undefined) return null;
  return {
    attemptedAt: row.attemptedAt.getTime(),
    ok: row.ok,
    failures: row.failures,
  };
}

/**
 * Registra com'è andato **un tentativo**, da qualunque parte sia partito.
 *
 * ⚠ **La chiamano anche i due pulsanti del pannello**, con `trigger: "manual"`, e
 * non è un dettaglio: se ci scrivesse solo l'automatismo, il pannello
 * racconterebbe una storia e la realtà un'altra — premo il pulsante, riesce, e la
 * pagina continua a dire «ultimo tentativo fallito ieri». Due storie nello stesso
 * posto sarebbero due verità, e per questo `trigger` è una colonna e non due
 * tabelle.
 *
 * ⚠ **`failures` si incrementa in SQL e non in JavaScript.** Leggere il valore di
 * prima e riscriverlo lascerebbe una finestra fra la lettura e la scrittura;
 * `case when excluded.ok …` lo fa dentro la stessa istruzione, e costa una riga.
 *
 * Il `Result` si accetta nella sua forma minima — `fromSource` è l'unica cosa che
 * serve — così la stessa funzione prende sia l'esito della fonte A sia quello
 * della B senza un ramo per ciascuna.
 */
export async function recordSourceRun(
  source: RefreshSource,
  trigger: "auto" | "manual",
  result: Result<{ fromSource: number }>,
  at: Date,
): Promise<void> {
  await db
    .insert(sourceRuns)
    .values({
      source,
      attemptedAt: at,
      ok: result.ok,
      message: result.ok ? null : result.error.message,
      rows: result.ok ? result.value.fromSource : null,
      failures: result.ok ? 0 : 1,
      trigger,
    })
    .onConflictDoUpdate({
      target: sourceRuns.source,
      set: {
        attemptedAt: sql`excluded.attempted_at`,
        ok: sql`excluded.ok`,
        message: sql`excluded.message`,
        rows: sql`excluded.rows`,
        failures: sql`case when excluded.ok then 0 else ${sourceRuns.failures} + 1 end`,
        trigger: sql`excluded.trigger`,
      },
    });
}

// ─── Un giro ─────────────────────────────────────────────────────────────────

export type RefreshTickOptions = {
  now?: Millis;
  /** Iniettabile per i test, come in `insights.ts`: la rete non si tocca. */
  fetchImpl?: typeof fetch;
};

export type RefreshTickOutcome = {
  /** Fermo perché c'è un'asta **vera** in corso: nessuna fonte è stata chiesta. */
  standBy: boolean;
  /** Le fonti chieste in questo giro, con l'esito. */
  attempted: { source: RefreshSource; ok: boolean }[];
  /**
   * Fonti **non** chieste, e perché. ⚠ Nessuna di queste scrive su `source_runs`:
   * un tentativo non fatto non è un tentativo fallito.
   */
  skipped: { source: RefreshSource; reason: "not-due" | "no-insights" }[];
};

/**
 * Un giro completo: la guardia, poi il lavoro.
 *
 * ⚠ **La guardia è la stessa di `runBotTick`, e la ragione è la stessa.** Due
 * `fetch` da mezzo megabyte e un `upsert` di 497 righe in transazione, nello
 * stesso processo che deve chiudere un round nel millisecondo giusto, non si
 * fanno mentre si gioca. Le **simulate non contano**: aspettano dei bot, non
 * dodici telefoni — è la stessa distinzione della guardia del deploy.
 *
 * ⚠ **E un tick saltato per la guardia non tocca `source_runs`.** Se lo
 * registrasse, una serata d'asta manderebbe le due fonti in backoff per un guasto
 * che non c'è stato: la sera dopo il pannello direbbe «fallito da tre volte»
 * avendo fallito zero volte.
 */
export async function runRefreshTick(
  options: RefreshTickOptions = {},
): Promise<RefreshTickOutcome> {
  if (await realAuctionRunning()) {
    return { standBy: true, attempted: [], skipped: [] };
  }
  return refreshDueSources(options);
}

/**
 * Le fonti scadute, chieste in ordine.
 *
 * ⚠ **Non controlla la guardia**: quella è una decisione di `runRefreshTick`, che
 * è l'unico chiamante in produzione. È esportata per la stessa ragione per cui lo
 * è `tickAuction` — perché i test possano verificare il comportamento **senza
 * dipendere dall'assenza di aste reali nel database**, che in un file che gira in
 * parallelo ad altri non è una condizione controllabile.
 */
export async function refreshDueSources(
  options: RefreshTickOptions = {},
): Promise<RefreshTickOutcome> {
  const now = options.now ?? Date.now();
  const at = new Date(now);
  const clock = () => at;

  const last = await lastAttempts();
  const outcome: RefreshTickOutcome = {
    standBy: false,
    attempted: [],
    skipped: [],
  };

  for (const source of REFRESH_SOURCES) {
    if (!shouldAttempt(asLastAttempt(last.get(source)), now)) {
      outcome.skipped.push({ source, reason: "not-due" });
      continue;
    }

    // ⚠ La fonte B rifiuta a `player_insights` vuota — «prima va importato il
    // listone» — e in produzione, il giorno del deploy, quella condizione è
    // **normale**. Si salta, non si registra: mandarla in backoff per un ordine
    // di operazioni che si sistema da sé al giro dopo sarebbe punire la
    // sequenza giusta. La domanda si fa qui e non prima del ciclo, perché la
    // fonte A può aver riempito la tabella un istante fa.
    if (source === "set_pieces" && (await insightsAreEmpty())) {
      outcome.skipped.push({ source, reason: "no-insights" });
      continue;
    }

    const result =
      source === "listone_insights"
        ? await refreshListoneInsights({ fetchImpl: options.fetchImpl, now: clock })
        : await refreshSetPieces({ fetchImpl: options.fetchImpl, now: clock });

    await recordSourceRun(source, "auto", result, at);
    outcome.attempted.push({ source, ok: result.ok });
  }

  return outcome;
}

async function insightsAreEmpty(): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(playerInsights);
  return (row?.n ?? 0) === 0;
}

// ─── Lo stato, per il pannello ───────────────────────────────────────────────

/**
 * Com'è andato l'ultimo tentativo di ciascuna fonte, nell'ordine in cui si
 * chiedono. Sempre due voci, anche a tabella vuota: «non ho mai provato» è una
 * risposta, e una fonte che sparisse dal pannello perché non ha una riga sarebbe
 * il silenzio che questa macro esiste per togliere.
 *
 * ⚠ **La riga di Drizzle non esce da qui**, si appiattisce: il chiamante finale è
 * `InsightsPanel`, che è `"use client"`, e un `SourceRunRow` nelle sue props
 * vorrebbe dire un `import type` da `@/lib/db/schema` dentro `components/**` —
 * cioè la scorciatoia che la regola ESLint su `lib/db` esiste per rendere
 * impossibile. `nextAttemptAt` è l'unico campo calcolato, e lo calcola la funzione
 * pura di `refresh-rules.ts`: la pagina non rifà quel conto.
 */
export async function sourceRunsStatus(): Promise<SourceRunStatus[]> {
  const rows = await lastAttempts();
  return REFRESH_SOURCES.map((source) => {
    const row = rows.get(source);
    const attempt = asLastAttempt(row);
    return {
      source,
      ok: row?.ok ?? null,
      attemptedAt: row?.attemptedAt ?? null,
      failures: row?.failures ?? 0,
      message: row?.message ?? null,
      rows: row?.rows ?? null,
      trigger: row?.trigger ?? null,
      nextAttemptAt: attempt === null ? null : new Date(nextAttemptAt(attempt)),
    };
  });
}

// ─── Il ciclo del processo ───────────────────────────────────────────────────

export type InsightRefreshLoop = { stop(): void };

/**
 * Avvia il tick. **Acceso sempre**, come lo sweep e il tick dei bot: è una
 * `SELECT` di due righe ogni quindici minuti, e in cambio non esiste nessuno
 * stato «il loop si è dimenticato di ripartire».
 *
 * ⚠ **Nessun giro all'avvio**, e non è una dimenticanza: lo stato sta a database,
 * quindi un deploy alle 04:59 non fa perdere il turno — il primo tick dopo il
 * riavvio rilegge la stessa riga di prima e decide come avrebbe deciso il
 * processo di prima. Un giro al boot, con i rilasci che si susseguono, sarebbe
 * invece un tentativo per ogni deploy.
 *
 * Un giro non parte se il precedente non è finito: due `fetch` lente e due giri
 * sovrapposti chiederebbero la stessa fonte due volte.
 */
export function startInsightRefreshLoop(): InsightRefreshLoop {
  let running = false;
  const interval = setInterval(() => {
    if (running) return;
    running = true;
    void runRefreshTick()
      .catch((error: unknown) => {
        // Un errore qui non deve poter fermare il processo che sta conducendo
        // un'asta: si stampa e si riprova fra un quarto d'ora.
        console.error("refresh degli insight fallito:", error);
      })
      .finally(() => {
        running = false;
      });
  }, REFRESH_TICK_MS);

  return {
    stop() {
      clearInterval(interval);
    },
  };
}
