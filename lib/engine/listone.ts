import { asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { listonePlayers, playerInsights } from "@/lib/db/schema";
import { type PlayerInsights, type Role } from "@/lib/domain";
import { parseListone } from "@/lib/import/parseListone";

import { type Result, fail, ok } from "./errors";

/**
 * Il listone a sistema (M10): l'upload, lo stato del pannello, la tabella del
 * Centro dati, la copertura globale.
 *
 * ## Le due frasi da cui dipende tutto il resto
 *
 * **«Listone» sono due file** (M10 §1). Questo è l'export **Leghe** in `.xlsx`,
 * scaricato a mano dall'area riservata di Fantacalcio.it, ed è quello che
 * definisce un'asta: porta la colonna `Fuori lista`, da cui dipendono I9 e il
 * toggle P7. L'altro è la `GET` pubblica di Fantalab che riempie
 * `player_insights` (M8), e **quello** è ciò che M11 aggiornerà da sé. Questo
 * no: l'export passa da un login, quindi resta un upload a mano (owner,
 * 2026-08-12). Il file *Quotazioni*, pubblico, non ha `Fuori lista` ed è già
 * stato scartato per quella ragione.
 *
 * **È una sorgente da cui si copia, mai una tabella da cui l'asta legge**
 * (M10 §3). L'unica funzione di questo file che serve un'asta è
 * `readListoneForCopy`, e il suo unico chiamante è `importPlayersFromListone` in
 * `setup.ts`, che copia le righe dentro `players` **validando I9 alla copia**.
 * Nessuna query di gioco tocca questa tabella. Un'asta si crea, si prepara e
 * arriva a `COMPLETED` con `listone_players` vuota.
 *
 * ## Perché sta nel motore
 *
 * Perché tocca `lib/db`, e `lib/engine/**` è già dentro l'allowlist ESLint:
 * **questa macro non ne aggiunge nessuna**. Le pagine del pannello chiamano
 * queste funzioni; il parser resta puro in `lib/import/parseListone.ts`.
 *
 * ## Niente lock, e perché
 *
 * `withAuctionLock` e `withSetupLock` serializzano le mutazioni **di un'asta**.
 * Qui non se ne tocca nessuna: la tabella è globale e non entra in nessuna regola
 * di gioco. Ma la sostituzione sta **dentro una transazione**, perché fra il
 * `DELETE` e l'`INSERT` la tabella è vuota, e una tabella vuota per mezzo secondo
 * è un'asta creata in quel mezzo secondo che non trova nessuna proposta.
 */

/** Chi sa leggere: `db` oppure una transazione — hanno gli stessi metodi. */
type Reader = Pick<typeof db, "select">;

/** Una riga del listone a sistema, come esce dalla tabella. */
export type ListoneRow = {
  extId: number;
  name: string;
  team: string;
  role: Role;
  roleMantra: string | null;
  fvm: number;
  quot: number;
  outOfList: boolean;
};

// ─── L'upload ────────────────────────────────────────────────────────────────

export type ListoneUploadSummary = {
  rows: number;
  outOfList: number;
  uploadedAt: Date;
};

/**
 * Sostituisce l'intero listone a sistema con quello del file.
 *
 * ⚠ **Non valida I9, e non può.** I9 è «per ogni ruolo, `giocatori_disponibili ≥
 * slot_ruolo × seats`»: posti e slot sono di un'asta, e qui non ce n'è nessuna.
 * Si valida il file — `parseListone`, che è già puro e già scritto — e basta.
 * **I9 si valida alla copia** (`importPlayersFromListone`), che è il momento in
 * cui esiste un'asta di cui chiederlo: lo stesso listone può passare per un'asta
 * a 8 e fallire per una a 12, ed è giusto che fallisca.
 *
 * ⚠ **Sostituisce, non fonde.** È l'unico modo di correggere un file sbagliato
 * senza inventare un merge fra due listoni, ed è lo stesso comportamento di
 * `importPlayers` sullo snapshot di un'asta. La regola 5 non è in discussione:
 * qui non ci sono assegnazioni né ledger, è un elenco di calciatori di Serie A.
 *
 * Il file **non si conserva** (P6): se ne estraggono le righe e si butta.
 *
 * `now` arriva da fuori come in tutto il motore: è ciò che rende verificabile la
 * data che l'owner legge alla creazione di un'asta.
 */
export async function uploadListone(
  file: ArrayBuffer | Uint8Array,
  now: Date = new Date(),
): Promise<Result<ListoneUploadSummary>> {
  const parsed = parseListone(file);
  if (!parsed.ok) return parsed;

  const rows = parsed.value;
  if (rows.length === 0) {
    return fail("LISTONE_EMPTY", "Il foglio del listone è vuoto.");
  }

  await db.transaction(async (tx) => {
    await tx.delete(listonePlayers);
    // A blocchi: un solo `INSERT` da 495 righe con 9 colonne supera comodamente
    // i parametri che ci stanno in una query (stessa ragione di `writeListoneRows`).
    const CHUNK = 100;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await tx.insert(listonePlayers).values(
        rows.slice(i, i + CHUNK).map((row) => ({
          extId: row.extId,
          name: row.name,
          team: row.team,
          role: row.role,
          roleMantra: row.roleMantra,
          fvm: row.fvm,
          quot: row.quot,
          outOfList: row.outOfList,
          uploadedAt: now,
        })),
      );
    }
  });

  return ok({
    rows: rows.length,
    outOfList: rows.filter((row) => row.outOfList).length,
    uploadedAt: now,
  });
}

// ─── La lettura per la copia dentro un'asta ──────────────────────────────────

/**
 * Le righe del listone a sistema, per copiarle dentro un'asta.
 *
 * ⚠ **Porta `fvm` e `out_of_list`**, e non è una svista da ripulire perché il
 * Centro dati non li mostra: `players_autopick_idx` ordina per `fvm` DESC e
 * quell'ordinamento *è* l'auto-pick, e senza `out_of_list` `validateRolePool`
 * conta i giocatori sbagliati (I9) e il toggle P7 non ha niente su cui lavorare
 * (M10 §2). La copia deve produrre **le stesse righe** che produrrebbe l'upload
 * dello stesso file dentro l'asta, e c'è un test che lo verifica.
 *
 * Accetta un `Reader` perché il suo chiamante legge **dentro** il lock di setup:
 * la copia e la validazione di I9 devono vedere la stessa tabella.
 */
export async function readListoneForCopy(
  tx: Reader = db,
): Promise<ListoneRow[]> {
  return tx
    .select({
      extId: listonePlayers.extId,
      name: listonePlayers.name,
      team: listonePlayers.team,
      role: listonePlayers.role,
      roleMantra: listonePlayers.roleMantra,
      fvm: listonePlayers.fvm,
      quot: listonePlayers.quot,
      outOfList: listonePlayers.outOfList,
    })
    .from(listonePlayers)
    .orderBy(asc(listonePlayers.extId));
}

// ─── Lo stato, per il pannello e per la proposta ─────────────────────────────

export type ListoneStatus = {
  rows: number;
  outOfList: number;
  /** `null` quando la tabella è vuota: non c'è niente da proporre. */
  uploadedAt: Date | null;
  /** Quante righe del listone hanno una riga di insight, e quante sono mostrabili. */
  coverage: { matched: number; showable: number };
};

/**
 * Cosa c'è a sistema, e di quando.
 *
 * ⚠ **La copertura è un'informazione, non una guardia** (M10 §7). Con un listone
 * a sistema esiste per la prima volta un denominatore vero — *quanti dei
 * giocatori di quest'anno hanno qualcosa da dire?* — ma farne una soglia che
 * blocca l'import degli insight rimetterebbe in piedi il controllo
 * **avvelenabile** che M8 ha smontato, questa volta avvelenabile da un file
 * caricato per sbaglio. Il controllo che protegge davvero resta la **continuità
 * all'85%** in `insights.ts`, che confronta la fonte con sé stessa.
 *
 * `showable` sono le righe con i numeri della stagione **corrente**, cioè quelle
 * che a schermo si vedono davvero: dirlo qui evita la domanda «perché 480
 * agganciati e due terzi dei badge non compaiono?» (M8 §5).
 */
export async function listoneStatus(): Promise<ListoneStatus> {
  const [totals] = await db
    .select({
      rows: sql<number>`count(*)::int`,
      outOfList: sql<number>`count(*) filter (where ${listonePlayers.outOfList})::int`,
      uploadedAt: sql<string | null>`max(${listonePlayers.uploadedAt})`,
    })
    .from(listonePlayers);

  const [covered] = await db
    .select({
      matched: sql<number>`count(*)::int`,
      showable: sql<number>`count(*) filter (where ${playerInsights.statsSeason} = 'current')::int`,
    })
    .from(listonePlayers)
    .innerJoin(playerInsights, eq(playerInsights.extId, listonePlayers.extId));

  return {
    rows: totals?.rows ?? 0,
    outOfList: totals?.outOfList ?? 0,
    // ⚠ Un `max()` scritto in SQL grezzo torna una **stringa**, non una `Date`:
    // dentro un `sql<...>` il tipo è una promessa di chi scrive, e Drizzle non
    // converte niente. Stessa cicatrice di `asDate` in `insights.ts`, dove il
    // test se n'è accorto con un `getTime is not a function`.
    uploadedAt: asDate(totals?.uploadedAt),
    coverage: {
      matched: covered?.matched ?? 0,
      showable: covered?.showable ?? 0,
    },
  };
}

function asDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(value);
}

/**
 * Gli `ext_id` a sistema, per il downloader delle figurine (M10 §5).
 *
 * È la ragione per cui il campo file delle caricature sparisce: gli id stanno in
 * una tabella, e ricaricare lo stesso `.xlsx` a ogni passata era l'ultimo upload
 * usa-e-getta rimasto nel pannello.
 */
export async function listoneExtIds(): Promise<number[]> {
  const rows = await db
    .select({ extId: listonePlayers.extId })
    .from(listonePlayers)
    .orderBy(asc(listonePlayers.extId));
  return rows.map((row) => row.extId);
}

// ─── Il Centro dati ──────────────────────────────────────────────────────────

/** Una riga della tabella di consultazione: il listone, con gli insight accanto. */
export type CentroDatiRow = {
  extId: number;
  name: string;
  team: string;
  role: Role;
  quot: number;
  outOfList: boolean;
  /** `undefined` per chi non ha una riga di insight: la tabella scrive `—`. */
  insights?: PlayerInsights;
};

/**
 * Tutto il listone a sistema con gli insight accanto (M10 §6).
 *
 * ⚠ **`LEFT JOIN`, sempre.** Le due tabelle sono globali ma indipendenti: un
 * listone caricato prima che gli insight siano stati importati mostra le sue
 * righe con `—` al posto dei numeri, e un giocatore con insight che non è nel
 * listone **non compare affatto** — il listone è il denominatore.
 *
 * ⚠ **Nessun `canSeeInsights` qui dentro**, a differenza di `listPickPool`. La
 * pagina sta dietro `requireAppAdmin()`, e un amministratore vede gli insight per
 * costruzione: aggiungere il predicato darebbe l'impressione che ci sia una
 * seconda regola da tenere allineata (M10 §6).
 *
 * **Tutte le righe in un colpo solo, senza paginazione**: search e filtro girano
 * nel browser. Cinquecento righe con gli insight dentro sono ~250 KB — un numero
 * che conosciamo perché è già stato pagato una volta al giorno da ogni telefono
 * in `/play` (misura di M8: 241 KB). Se un giorno il listone avesse cinquemila
 * righe sarà il momento di cambiare, e non prima (regola 8).
 */
export async function centroDatiRows(): Promise<CentroDatiRow[]> {
  const rows = await db
    .select({
      extId: listonePlayers.extId,
      name: listonePlayers.name,
      team: listonePlayers.team,
      role: listonePlayers.role,
      quot: listonePlayers.quot,
      outOfList: listonePlayers.outOfList,
      insights: playerInsights,
    })
    .from(listonePlayers)
    .leftJoin(playerInsights, eq(playerInsights.extId, listonePlayers.extId))
    // Lo stesso ordine con cui la pagina si apre — quotazione dal più alto al
    // più basso, e il nome a parità. La tabella riordina comunque nel browser a
    // ogni click, ma far arrivare le righe già nell'ordine giusto evita che il
    // primo disegno e il primo `sort` mostrino due liste diverse.
    .orderBy(desc(listonePlayers.quot), asc(listonePlayers.name));

  return rows.map(({ insights, ...player }) => {
    // ⚠ Niente `insights: undefined` esplicito: la chiave si aggiunge **solo** se
    // c'è qualcosa, come in `listPickPool`. Questo risultato finisce nel payload
    // RSC di un client component, e il tipo deve dire la verità su cosa contiene.
    if (insights === null) return player;
    return {
      ...player,
      insights: {
        extId: insights.extId,
        fullName: insights.fullName,
        team: insights.team,
        statsSeason: insights.statsSeason,
        presenze: insights.presenze,
        startsEleven: insights.startsEleven,
        minPlayingTime: insights.minPlayingTime,
        rigoriFatti: insights.rigoriFatti,
        rigoriSbagliati: insights.rigoriSbagliati,
        rigoriParati: insights.rigoriParati,
        fmvHome: insights.fmvHome,
        fmvAway: insights.fmvAway,
        rigoristaRank: insights.rigoristaRank,
        piazzatiRank: insights.piazzatiRank,
      },
    };
  });
}
