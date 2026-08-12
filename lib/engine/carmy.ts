import { asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { carmyPlayers, listonePlayers } from "@/lib/db/schema";
import {
  CARMY_TEAM_BY_SIGLA,
  type CarmyJudgement,
  SOGLIA_TITOLARE_CARMY,
  normalizeCarmyName,
} from "@/lib/domain";
import { type CarmyRow, parseCarmy } from "@/lib/import/parseCarmy";

import { type Result, fail, ok } from "./errors";

/**
 * Il foglio di Carmy (M10B): il caricamento, il join per nome, lo stato del
 * pannello, la lettura per il pool e per il Centro dati.
 *
 * ## Le due frasi da cui dipende tutto il resto
 *
 * **Il join passa dal nome, e il denominatore è `listone_players`** (M10B §3). Il
 * file non ha `ext_id`: ha `Nome` e una sigla di tre lettere. Si aggancia al
 * listone a sistema — la tabella di M10 — perché è la lista di chi si può
 * comprare, e un giudizio su qualcuno che non è nel listone non serve a nessuno.
 * Misura del 2026-08-12: **487 su 497, il 98,0%**, con **zero omonimi** nel
 * listone; i dieci che restano sono acquisti che il listone del 6 agosto non aveva
 * ancora. Sul solo `(Nome, Squadra)` l'aggancio sarebbe **zero**, perché `ROM` non
 * è `Roma`: la sigla è il **controllo**, non la chiave.
 *
 * **Questa tabella non entra in nessuna regola di gioco.** Come
 * `player_insights` e `listone_players`, si legge in `LEFT JOIN` e nessun percorso
 * critico la attraversa: **un'asta si crea, si prepara e arriva a `COMPLETED` con
 * `carmy_players` vuota**. In particolare **non tocca l'auto-pick**, che pesca dal
 * pool intero dentro `machine.ts` ordinando per `fvm DESC, quot DESC` e di Carmy
 * non sa niente — e non deve saperne.
 *
 * ## Perché sta nel motore
 *
 * Perché tocca `lib/db`, e `lib/engine/**` è già dentro l'allowlist ESLint:
 * **questa macro non ne aggiunge nessuna** (M10B §9). Le pagine chiamano queste
 * funzioni; il parser resta puro in `lib/import/parseCarmy.ts`.
 *
 * ## Niente lock, e la transazione sì
 *
 * `withAuctionLock` serializza le mutazioni **di un'asta**, e qui non se ne tocca
 * nessuna. Ma la sostituzione sta **dentro una transazione**, per la stessa ragione
 * di `uploadListone`: fra il `DELETE` e l'`INSERT` la tabella è vuota, e mezzo
 * secondo di tabella vuota è un `/play` che in quel mezzo secondo mostra `—` su
 * cinquecento giocatori.
 */

/** Chi sa leggere: `db` oppure una transazione. */
type Reader = Pick<typeof db, "select">;

/**
 * Sotto questa quota di nomi agganciati, il caricamento rifiuta e non scrive
 * niente. **90%**, contro il 98,0% misurato.
 *
 * ⚠ **È una guardia sana, e la differenza rispetto al controllo che M8 aveva
 * smontato è la parte da non perdere** (M10B §3). Quello là misurava la copertura
 * **contro il listone di un'asta**: un'asta simulata con `ext_id` sintetici la
 * portava a zero su dati perfetti, cioè era **avvelenabile**, e per questo è stato
 * tolto. Qui il denominatore è `listone_players`, che è **globale e non appartiene
 * a nessuna asta**: nessuna simulazione lo può inquinare, e l'unica cosa che può
 * abbassare questa quota è che il foglio e il listone abbiano davvero cominciato a
 * divergere. **La continuità all'85% degli insight resta dov'è e non si tocca**: è
 * un altro controllo, su un'altra tabella, che confronta una fonte con sé stessa.
 */
export const CARMY_MATCH_THRESHOLD = 0.9;

/**
 * Da quante ore un caricamento è «vecchio».
 *
 * ⚠ **Ventiquattro, e per questo file conta più che per il listone** (M10B §8): il
 * foglio lo si ricarica circa una volta al giorno perché **invecchia in un
 * giorno** — un giudizio sulla titolarità cambia con un infortunio o con una
 * probabile formazione. Il listone a sistema invecchia in settimane.
 */
export const CARMY_STALE_HOURS = 24;

// ─── Il caricamento ──────────────────────────────────────────────────────────

export type CarmyUploadSummary = {
  /** Righe lette dal file. */
  fromFile: number;
  /** Righe scritte, cioè quelle che hanno agganciato un `ext_id` del listone. */
  written: number;
  /**
   * I nomi che il listone non conosce, **per nome e non per numero**: dieci nomi
   * in fondo alla pagina sono l'unico modo di accorgersi che il foglio e il
   * listone hanno cominciato a divergere (M10B §3, come `unknown` in
   * `refreshSetPieces`).
   */
  unmatched: string[];
  /**
   * Chi ha agganciato ma con un'altra squadra: un trasferimento, o un omonimo che
   * il listone non aveva. **Si segnala, non si ingoia.** Sul file del 2026-08-12
   * sono tre, e sono tutti e tre mercato vero.
   */
  teamMismatches: { name: string; carmy: string; listone: string }[];
  uploadedAt: Date;
};

/**
 * Sostituisce l'intero foglio di Carmy con quello del file.
 *
 * ⚠ **Sostituisce, non fonde**, come `uploadListone` e a differenza dell'`upsert`
 * delle due fonti di M8 — ed è la ragione per cui questa è una **tabella sua**
 * (M10B §5). Un giudizio ritirato deve poter sparire: se il caricamento fondesse,
 * un `titolarissimo` messo a luglio e tolto ad agosto resterebbe in tabella per
 * sempre. La regola 5 non è in discussione: qui non ci sono assegnazioni né
 * ledger, è l'opinione di una persona su dei calciatori.
 *
 * Il file **non si conserva** (P6).
 *
 * `now` arriva da fuori come in tutto il motore: è ciò che rende verificabile
 * l'avviso «questo file è di ieri».
 */
export async function uploadCarmy(
  file: ArrayBuffer | Uint8Array,
  now: Date = new Date(),
): Promise<Result<CarmyUploadSummary>> {
  const parsed = parseCarmy(file);
  if (!parsed.ok) return parsed;

  const rows = parsed.value;

  return db.transaction(async (tx) => {
    const listone = await tx
      .select({
        extId: listonePlayers.extId,
        name: listonePlayers.name,
        team: listonePlayers.team,
      })
      .from(listonePlayers);

    // ⚠ Senza listone non c'è denominatore, e senza denominatore la soglia di
    // aggancio sarebbe una divisione per zero: si rifiuta **dicendo cosa fare**,
    // perché l'ordine dei due caricamenti non è una preferenza (M10B §8).
    if (listone.length === 0) {
      return fail<CarmyUploadSummary>(
        "CARMY_NO_LISTONE",
        "Prima va caricato il listone: il foglio di Carmy si aggancia a quello per nome, quindi senza listone non c'è niente a cui agganciarsi.",
      );
    }

    const byName = new Map(
      listone.map((row) => [normalizeCarmyName(row.name), row]),
    );

    const matched: (CarmyRow & { extId: number })[] = [];
    const unmatched: string[] = [];
    const teamMismatches: CarmyUploadSummary["teamMismatches"] = [];

    for (const row of rows) {
      const target = byName.get(normalizeCarmyName(row.name));
      if (!target) {
        unmatched.push(row.name);
        continue;
      }
      // La sigla è il controllo: si traduce e si confronta, e una discordanza si
      // **segnala** senza fermare il caricamento — è un trasferimento, e il
      // giudizio su quel giocatore vale comunque.
      const expected = CARMY_TEAM_BY_SIGLA[row.team];
      if (expected !== undefined && expected !== target.team) {
        teamMismatches.push({
          name: row.name,
          carmy: expected,
          listone: target.team,
        });
      }
      matched.push({ ...row, extId: target.extId });
    }

    const quota = matched.length / rows.length;
    if (quota < CARMY_MATCH_THRESHOLD) {
      return fail<CarmyUploadSummary>(
        "CARMY_COVERAGE",
        `Solo ${matched.length} nomi su ${rows.length} (${Math.round(quota * 100)}%) trovano un giocatore nel listone a sistema: ` +
          `sotto il ${Math.round(CARMY_MATCH_THRESHOLD * 100)}% non scrivo niente, perché uno scarto così grosso vuol dire che il foglio e il listone parlano di due elenchi diversi — ` +
          `di solito perché il listone è vecchio. Carica prima il listone aggiornato.`,
      );
    }

    await tx.delete(carmyPlayers);

    // A blocchi, come `writeListoneRows`: un solo `INSERT` da 497 righe con 12
    // colonne supera i parametri che ci stanno in una query.
    const CHUNK = 100;
    for (let i = 0; i < matched.length; i += CHUNK) {
      await tx.insert(carmyPlayers).values(
        matched.slice(i, i + CHUNK).map((row) => ({
          extId: row.extId,
          sourceName: row.name,
          sourceTeam: row.team,
          fascia: row.fascia,
          prezzo: row.prezzo,
          titolarita: row.titolarita,
          affidabilita: row.affidabilita,
          integrita: row.integrita,
          fmvExp: row.fmvExp,
          tags: row.tags,
          commento: row.commento,
          uploadedAt: now,
        })),
      );
    }

    return ok({
      fromFile: rows.length,
      written: matched.length,
      unmatched,
      teamMismatches,
      uploadedAt: now,
    });
  });
}

// ─── Lo stato, per il pannello ───────────────────────────────────────────────

export type CarmyStatus = {
  rows: number;
  /** Quanti hanno un giudizio di titolarità, cioè quanti possono avere il badge. */
  conTitolarita: number;
  /** Quanti stanno sopra la soglia del verde: è la misura che si guarda in pagina. */
  titolari: number;
  /** Quanti hanno un prezzo consigliato. */
  conPrezzo: number;
  /** `null` quando la tabella è vuota. */
  uploadedAt: Date | null;
  /** Se il caricamento è più vecchio di `CARMY_STALE_HOURS`. `false` se non c'è. */
  stale: boolean;
};

/**
 * Cosa c'è a sistema, e di quando.
 *
 * ⚠ **`stale` si calcola qui e non nel componente**, perché è l'unica cosa che
 * distingue «il file di stamattina» da «il file di ieri» e la regola 2 vale anche
 * fuori dal motore puro: `now` si passa, non si legge. Un `Date.now()` dentro un
 * componente sarebbe un avviso che non si può provare.
 */
export async function carmyStatus(now: Date = new Date()): Promise<CarmyStatus> {
  const [totals] = await db
    .select({
      rows: sql<number>`count(*)::int`,
      conTitolarita: sql<number>`count(*) filter (where ${carmyPlayers.titolarita} is not null)::int`,
      // ⚠ La soglia arriva da `lib/domain.ts` e non è scritta `4` qui dentro: è
      // la stessa che colora il badge, e due copie di una soglia sono una soglia
      // che prima o poi diverge — con il pannello che dice «168 titolari» mentre
      // in pagina se ne colorano altri.
      titolari: sql<number>`count(*) filter (where ${carmyPlayers.titolarita} >= ${SOGLIA_TITOLARE_CARMY})::int`,
      conPrezzo: sql<number>`count(*) filter (where ${carmyPlayers.prezzo} is not null)::int`,
      uploadedAt: sql<string | null>`max(${carmyPlayers.uploadedAt})`,
    })
    .from(carmyPlayers);

  // ⚠ Un `max()` in SQL grezzo torna una **stringa**, non una `Date`: stessa
  // cicatrice di `asDate` in `insights.ts` e `listone.ts`, dove il test se n'è
  // accorto con un `getTime is not a function`.
  const uploadedAt = asDate(totals?.uploadedAt);

  return {
    rows: totals?.rows ?? 0,
    conTitolarita: totals?.conTitolarita ?? 0,
    titolari: totals?.titolari ?? 0,
    conPrezzo: totals?.conPrezzo ?? 0,
    uploadedAt,
    stale:
      uploadedAt !== null &&
      now.getTime() - uploadedAt.getTime() > CARMY_STALE_HOURS * 3_600_000,
  };
}

function asDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(value);
}

// ─── Le letture ──────────────────────────────────────────────────────────────

/** Una riga della tabella nella forma che va al browser. */
export function toJudgement(row: {
  extId: number;
  sourceName: string;
  sourceTeam: string;
  fascia: string | null;
  prezzo: number | null;
  titolarita: number | null;
  affidabilita: number | null;
  integrita: number | null;
  fmvExp: number | null;
  tags: string[];
  commento: string | null;
}): CarmyJudgement {
  return {
    extId: row.extId,
    sourceName: row.sourceName,
    sourceTeam: row.sourceTeam,
    fascia: row.fascia,
    prezzo: row.prezzo,
    titolarita: row.titolarita,
    affidabilita: row.affidabilita,
    integrita: row.integrita,
    fmvExp: row.fmvExp,
    tags: row.tags,
    commento: row.commento,
  };
}

/**
 * I giudizi dei giocatori di un'asta, per `ext_id`.
 *
 * ⚠ **Il suo unico chiamante è `listPickPool`, e la chiama solo per chi ha il
 * permesso** (M10B §7). La decisione «chi li vede» è una **query**, non un
 * `className`: questa funzione non deve essere chiamata affatto per un non-pro,
 * perché il risultato finisce nel payload RSC di un client component, cioè nel
 * browser, leggibile in tre click.
 *
 * Vive qui e non in `setup.ts` per la stessa ragione di `insightsForExtIds`: è una
 * lettura di questa tabella, e il `LEFT JOIN` sta là dove il pool si costruisce.
 */
export async function carmyForExtIds(
  extIds: number[],
): Promise<Map<number, CarmyJudgement>> {
  if (extIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(carmyPlayers)
    .where(inArray(carmyPlayers.extId, extIds));
  return new Map(rows.map((row) => [row.extId, toJudgement(row)]));
}

/**
 * Tutti i giudizi a sistema, per il Centro dati.
 *
 * Il Centro dati parte dal listone e ci mette accanto quello che sa: qui non c'è
 * nessun `canSeeInsights`, perché la pagina sta dietro `requireAppAdmin()` e un
 * amministratore li vede per costruzione (M10 §6, M10B §7).
 */
export async function allCarmy(
  tx: Reader = db,
): Promise<Map<number, CarmyJudgement>> {
  const rows = await tx
    .select()
    .from(carmyPlayers)
    .orderBy(asc(carmyPlayers.extId));
  return new Map(rows.map((row) => [row.extId, toJudgement(row)]));
}

/**
 * I tag che esistono davvero a sistema, per costruire un filtro.
 *
 * ⚠ **Si leggono dai dati e non da una costante.** Le diciassette etichette del
 * 2026-08-12 sono misurate, non dichiarate: chi compila il foglio ne aggiungerà
 * una, e un elenco scritto a mano vorrebbe dire un filtro che non la mostra senza
 * che nessuno sappia perché. Ordinati per frequenza, che è l'ordine in cui
 * servono.
 */
export async function carmyTags(): Promise<{ tag: string; count: number }[]> {
  const rows = await db
    .select({
      tag: sql<string>`jsonb_array_elements_text(${carmyPlayers.tags})`,
      count: sql<number>`count(*)::int`,
    })
    .from(carmyPlayers)
    .groupBy(sql`1`)
    .orderBy(sql`2 desc, 1 asc`);
  return rows;
}

/** Il giudizio su un solo giocatore. Serve alla pagina di prova del badge. */
export async function carmyForExtId(
  extId: number,
): Promise<CarmyJudgement | null> {
  const [row] = await db
    .select()
    .from(carmyPlayers)
    .where(eq(carmyPlayers.extId, extId));
  return row ? toJudgement(row) : null;
}
