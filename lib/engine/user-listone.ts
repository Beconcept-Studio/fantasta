import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { listonePlayers, userListone, users } from "@/lib/db/schema";
import { type CarmyJudgement, canSeeInsights } from "@/lib/domain";
import { parseCarmy } from "@/lib/import/parseCarmy";

import {
  CARMY_MATCH_THRESHOLD,
  type TeamMismatch,
  matchToListone,
} from "./carmy";
import { type Result, fail, ok } from "./errors";

/**
 * Il listone personale (M21 §6): ognuno carica il proprio foglio, con le proprie
 * fasce e la propria lista della spesa.
 *
 * ## Cosa cambia rispetto al gemello di M10B, e cosa no
 *
 * **Non cambia il file, e non cambia il parser.** È lo stesso `.xlsx` di Carmy,
 * letto da `parseCarmy`, agganciato a `listone_players` dallo stesso
 * `matchToListone` con la stessa soglia. Due parser per lo stesso file sarebbero
 * due modi di leggere `PMA` che divergono al primo formato strano; due agganci
 * sarebbero due elenchi di nomi mancati che non coincidono.
 *
 * **Cambia chi è il proprietario, e quindi cosa si può dire.** `uploadCarmy`
 * scrive `carmy_players`, che è **una tabella globale mostrata a tutti**: là la
 * colonna `Obiett.` non si importa, perché sarebbe la lista della spesa di una
 * persona pubblicata a dodici. Qui la riga ha un `user_id`, il dato non esce dal
 * browser di chi l'ha caricato, e l'obiettivo è **il motivo per cui questo
 * caricamento esiste** (M21 §0).
 *
 * ## ⚠ Il permesso si controlla qui, non solo nella Server Action
 *
 * `canSeeInsights` — Pro **oppure** amministratore — decide se questo
 * caricamento può avvenire, e il controllo sta **nel motore**: la UI disabilita
 * la tab, la Server Action chiama questa funzione, e questa funzione rifiuta
 * comunque (regola 6). Metterlo solo nell'azione vorrebbe dire che il giorno in
 * cui nasce un secondo chiamante — uno script, una rotta — la guardia resta
 * indietro senza che nessun test se ne accorga.
 *
 * ## Niente lock, e la transazione sì
 *
 * `withAuctionLock` serializza le mutazioni **di un'asta**, e qui non se ne tocca
 * nessuna: questa tabella non entra in nessuna regola di gioco, esattamente come
 * `carmy_players`. Ma il `DELETE` e gli `INSERT` stanno **dentro una
 * transazione**, perché fra i due il mio listone è vuoto — e mezzo secondo di
 * listone vuoto è una tab che in quel mezzo secondo dice che non ho importato
 * niente.
 */

export type UserListoneSummary = {
  /** Righe lette dal file. */
  fromFile: number;
  /** Righe scritte, cioè quelle che hanno agganciato un `ext_id` del listone. */
  written: number;
  /**
   * Quanti obiettivi ha letto la colonna `Obiett.`.
   *
   * ⚠ **È il rimedio al fatto che quella colonna non sia obbligatoria** (vedi
   * `parseCarmy`): pretenderla fermerebbe anche il caricamento
   * dell'amministratore, che non la usa. Uno zero qui dentro è la stessa
   * informazione di un rifiuto — «il tuo foglio non ha nessun obiettivo, o la
   * colonna si chiama in un altro modo» — detta a chi ha il file in mano e lo
   * può correggere.
   */
  obiettivi: number;
  /** I nomi che il listone a sistema non conosce. */
  unmatched: string[];
  /** Le squadre discordanti: si segnalano, non si ingoiano. */
  teamMismatches: TeamMismatch[];
  uploadedAt: Date;
};

/**
 * Sostituisce il **mio** listone con quello del file.
 *
 * ⚠ **Sostituisce le mie righe, non fonde**, e per la ragione di sempre: un
 * obiettivo tolto dal file deve poter sparire. `DELETE` dove `user_id = me`, poi
 * gli `INSERT` a blocchi — e la cancellazione è ristretta a una persona, quindi
 * non tocca il listone di nessun altro. Non viola la regola 5: qui non ci sono
 * assegnazioni né ledger, è l'opinione di una persona su dei calciatori.
 *
 * Il file **non si conserva** (P6).
 */
export async function uploadUserListone(
  userId: string,
  file: ArrayBuffer | Uint8Array,
  now: Date = new Date(),
): Promise<Result<UserListoneSummary>> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { isPro: true, isAdmin: true },
  });
  // ⚠ `FORBIDDEN`, il codice che c'è già: in questa funzione esiste **una sola**
  // ragione per rifiutare l'accesso, e un codice nuovo si aggiunge quando c'è
  // qualcosa da distinguere (regola 8).
  if (!user || !canSeeInsights(user)) {
    return fail(
      "FORBIDDEN",
      "Il listone personale è una funzione Pro: il caricamento non è disponibile su questo account.",
    );
  }

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

    // ⚠ Senza listone a sistema non c'è niente a cui agganciarsi, e il rifiuto
    // dice **cosa fare a chi lo sta leggendo**: un partecipante il listone non lo
    // può caricare, quindi la frase del pannello admin qui sarebbe un ordine
    // impossibile da eseguire.
    if (listone.length === 0) {
      return fail<UserListoneSummary>(
        "CARMY_NO_LISTONE",
        "Il listone dell'applicazione non è ancora stato caricato, e il tuo file si aggancia a quello per nome. Chiedi a un amministratore di caricarlo, poi riprova.",
      );
    }

    const { matched, unmatched, teamMismatches } = matchToListone(rows, listone);

    const quota = matched.length / rows.length;
    if (quota < CARMY_MATCH_THRESHOLD) {
      return fail<UserListoneSummary>(
        "CARMY_COVERAGE",
        `Solo ${matched.length} nomi su ${rows.length} (${Math.round(quota * 100)}%) trovano un giocatore nel listone dell'applicazione: ` +
          `sotto il ${Math.round(CARMY_MATCH_THRESHOLD * 100)}% non salvo niente, perché uno scarto così grosso vuol dire che il tuo foglio e il listone parlano di due elenchi diversi. ` +
          `Di solito è il listone dell'applicazione a essere vecchio: segnalalo a un amministratore.`,
      );
    }

    await tx.delete(userListone).where(eq(userListone.userId, userId));

    // A blocchi, come `writeListoneRows` e `uploadCarmy`: un solo `INSERT` da
    // quasi cinquecento righe con quattordici colonne supera i parametri che ci
    // stanno in una query.
    const CHUNK = 100;
    for (let i = 0; i < matched.length; i += CHUNK) {
      await tx.insert(userListone).values(
        matched.slice(i, i + CHUNK).map((row) => ({
          userId,
          extId: row.extId,
          obiettivo: row.obiettivo,
          fascia: row.fascia,
          fasciaRank: row.fasciaRank,
          pma: row.pma,
          fmvExp: row.fmvExp,
          prezzo: row.prezzo,
          titolarita: row.titolarita,
          affidabilita: row.affidabilita,
          integrita: row.integrita,
          tags: row.tags,
          commento: row.commento,
          uploadedAt: now,
        })),
      );
    }

    return ok({
      fromFile: rows.length,
      written: matched.length,
      // ⚠ Contati sulle righe **scritte** e non su quelle lette: un obiettivo su
      // un giocatore che il listone non ha non arriverà mai in tabella, e dirlo
      // qui sarebbe promettere una riga che non comparirà.
      obiettivi: matched.filter((row) => row.obiettivo).length,
      unmatched,
      teamMismatches,
      uploadedAt: now,
    });
  });
}

// ─── La lettura, per il pool ─────────────────────────────────────────────────

/** Una riga del mio listone, nella forma che serve a risolvere il pool. */
export type MyListoneRow = {
  /** Il giudizio, nella stessa forma di quello globale: è quello che vince. */
  judgement: CarmyJudgement;
  obiettivo: boolean;
  fascia: string | null;
  fasciaRank: number | null;
};

/**
 * Tutto il mio listone, per `ext_id`.
 *
 * ⚠ **Tutto, e non filtrato sugli `ext_id` dell'asta**, che pure sarebbe la
 * lettura più stretta. La ragione è che da questa mappa si legge anche **una
 * domanda diversa** — *ho importato?* — che è una proprietà di una persona, non
 * di un'asta: filtrando, chi ha importato un file i cui giocatori non stanno nel
 * listone di *questa* asta risulterebbe «non ha mai importato», e si vedrebbe le
 * fasce globali al posto delle sue. Sono al massimo cinquecento righe strette,
 * lette una volta per apertura di pagina.
 *
 * ⚠ **Il permesso non si controlla qui**, al contrario del caricamento: il
 * chiamante è `listPickPool`, che la chiama **solo** dentro il ramo
 * `withInsights` — cioè dopo che `canSeeInsights` ha già deciso. Un controllo in
 * più qui darebbe l'impressione che ci siano due regole da tenere allineate.
 */
export async function myListone(
  userId: string,
): Promise<Map<number, MyListoneRow>> {
  const rows = await db
    .select()
    .from(userListone)
    .where(eq(userListone.userId, userId));

  return new Map(
    rows.map((row) => [
      row.extId,
      {
        // ⚠ Niente `sourceName`/`sourceTeam`: il mio file non li conserva, e la
        // chiave assente è la verità (vedi `CarmyJudgement`).
        judgement: {
          extId: row.extId,
          fascia: row.fascia,
          prezzo: row.prezzo,
          pma: row.pma,
          titolarita: row.titolarita,
          affidabilita: row.affidabilita,
          integrita: row.integrita,
          fmvExp: row.fmvExp,
          tags: row.tags,
          commento: row.commento,
        },
        obiettivo: row.obiettivo,
        fascia: row.fascia,
        fasciaRank: row.fasciaRank,
      },
    ]),
  );
}

// ─── Lo stato, per il modale ─────────────────────────────────────────────────

export type UserListoneStatus = {
  rows: number;
  obiettivi: number;
  /** `null` per chi non ha mai importato: è lo stato vuoto della tab. */
  uploadedAt: Date | null;
};

/**
 * Cosa ho importato, e quando.
 *
 * Serve a due schermate: il modale, che dice «il tuo file è del 28 agosto, 487
 * righe, 3 obiettivi», e lo stato vuoto di chi non ha mai caricato niente — che
 * non è un errore, è la condizione normale di chi apre la tab la prima volta.
 */
export async function userListoneStatus(
  userId: string,
): Promise<UserListoneStatus> {
  const [totals] = await db
    .select({
      rows: sql<number>`count(*)::int`,
      obiettivi: sql<number>`count(*) filter (where ${userListone.obiettivo})::int`,
      uploadedAt: sql<string | null>`max(${userListone.uploadedAt})`,
    })
    .from(userListone)
    .where(eq(userListone.userId, userId));

  return {
    rows: totals?.rows ?? 0,
    obiettivi: totals?.obiettivi ?? 0,
    uploadedAt: asDate(totals?.uploadedAt),
  };
}

/**
 * ⚠ **Un `max()` scritto in SQL grezzo torna una stringa, non una `Date`.** È la
 * stessa cicatrice di `insights.ts`, `listone.ts` e `carmy.ts`, che hanno tutti e
 * tre questa funzione: dentro un `sql<...>` il tipo è **una promessa di chi
 * scrive**, e lì la promessa era falsa — il test se n'era accorto con un
 * `getTime is not a function`. Quattro copie di tre righe sono meno pericolose di
 * un modulo `sql-helpers` che nessuno sa dove cercare (regola 8).
 */
function asDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(value);
}
