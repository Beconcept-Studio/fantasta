import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { type User, auctions, members, users } from "@/lib/db/schema";

import { pickPlayer, placeBid } from "./actions";
import { decide } from "./bot-brain";
import type { BotPoolPlayer } from "./bot-brain";
import { recordHeartbeat } from "./presence";
import { loadForSnapshot, serializeSnapshot } from "./snapshot";
import type { Millis } from "./types";

/**
 * I partecipanti simulati (M4).
 *
 * Qui vive tutto ciò che riguarda i bot **dentro l'applicazione**: le loro
 * identità, e — da M4-08 — il tick che li fa muovere. Le loro *decisioni* stanno
 * invece in `bot-brain.ts`, che è puro e non sa che esista un database: è quella
 * separazione a rendere il comportamento collaudabile senza Postgres, e a
 * garantire che un bot veda soltanto uno `Snapshot` redatto (I8).
 */

/**
 * I dodici bot, con nomi in ordine alfabetico perché così l'ordine dei posti si
 * legge a colpo d'occhio in lobby.
 *
 * Sono un **pool fisso** e non utenti usa-e-getta: `users` non cresce a ogni
 * prova, e da un'asta all'altra ritrovi le stesse facce. Dodici perché è il
 * taglio massimo di partecipanti, e perché l'owner può condurre senza giocare
 * (⚠ P11) — in quel caso i posti da riempire sono tutti.
 *
 * ⚠ Niente virgole né virgolette: questi nomi diventano anche nomi squadra, e
 * `validateTeamName` li rifiuterebbe (M3 §2).
 */
export const BOT_NAMES = [
  "Bot Ada",
  "Bot Bruno",
  "Bot Carla",
  "Bot Dario",
  "Bot Elsa",
  "Bot Furio",
  "Bot Gina",
  "Bot Ivo",
  "Bot Lea",
  "Bot Nino",
  "Bot Olga",
  "Bot Piero",
] as const;

/**
 * Una chiave arbitraria ma stabile per il lock consultivo: serve solo a non
 * collidere con altri usi futuri di `pg_advisory_xact_lock`.
 */
const BOT_USERS_LOCK = 4212;

/**
 * Crea i bot che mancano e non tocca quelli che ci sono. Idempotente: si può
 * chiamare a ogni riempimento senza pensarci.
 *
 * La chiama il primo riempimento **e** il seed. Se la chiamasse solo il seed,
 * in produzione servirebbe un comando a mano sul server — cioè esattamente la
 * cosa che questa macro esiste per togliere.
 *
 * Il lock consultivo copre il caso in cui due riempimenti di **aste diverse**
 * partano insieme: `withSetupLock` serializza le mutazioni della stessa asta,
 * non due aste distinte, e senza questa riga la finestra fra il `SELECT` e
 * l'`INSERT` produrrebbe ventiquattro bot invece di dodici. Costa una riga e si
 * rilascia da sé a fine transazione.
 */
export async function ensureBotUsers(): Promise<User[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BOT_USERS_LOCK})`);

    const existing = await tx
      .select()
      .from(users)
      .where(eq(users.isBot, true))
      .orderBy(asc(users.displayName));

    const have = new Set(existing.map((row) => row.displayName));
    const missing = BOT_NAMES.filter((name) => !have.has(name));
    if (missing.length === 0) return existing;

    // `email` resta nullo di proposito: un bot non è raggiungibile, e un
    // indirizzo finto in quella colonna sarebbe solo un modo di confonderlo con
    // una persona. `google_sub` nullo per la stessa ragione.
    await tx
      .insert(users)
      .values(missing.map((displayName) => ({ displayName, isBot: true })));

    return tx
      .select()
      .from(users)
      .where(eq(users.isBot, true))
      .orderBy(asc(users.displayName));
  });
}

// ─── Il tick ─────────────────────────────────────────────────────────────────

/**
 * Chi fa muovere i bot, dentro l'applicazione.
 *
 * **Perché in-process**, quando `scripts/bots.ts` è nato apposta per non
 * esserlo: la ragione storica — dei bot che chiamano il motore nel *proprio*
 * processo scrivono senza che il server se ne accorga, e nessun browser vede
 * muoversi niente — vale per uno script, non per codice che gira **dentro** il
 * server Next. Qui `setBroadcastHook(scheduleSnapshot)` è già impostato da
 * `instrumentation.ts`: si scrive nel processo giusto, e l'SSE parte da solo.
 *
 * **Perché un intervallo separato dallo sweep dello scheduler**: lo sweep chiude
 * i round ed è sequenziale. Mettendoci dentro le mosse dei bot, una simulazione
 * con undici bot che scrivono sotto lock ritarderebbe la chiusura di un round
 * dell'asta vera che gira accanto. Sono due lavori con priorità diverse.
 *
 * **Non è un servizio di scheduling, né un worker, né una coda**: è un
 * `setInterval` nell'unico processo Node, la stessa forma dello sweep.
 * `exec_mode: "fork"` e `instances: 1` restano la ragione per cui è sicuro.
 *
 * E le regole restano in piedi: i bot **non chiudono niente** (regola 1 — a
 * chiudere un round è solo lo scheduler), entrano da `actions.ts` come la rotta
 * HTTP e non da `persistTransition` (regola 6), quindi ogni mossa passa dal lock
 * (regola 4), e vedono soltanto uno `Snapshot` costruito col **proprio**
 * memberId (I8).
 */

export type BotTickOutcome = {
  /** Fermo perché è in corso un'asta vera: nessun bot si è mosso. */
  standBy: boolean;
  /** Aste simulate incontrate. */
  auctions: number;
  /** Mosse accettate dal server. I rifiuti sono fisiologici e non si contano qui. */
  moves: number;
};

/**
 * C'è un'asta **vera** in corso su questa macchina?
 *
 * È lo stand-down: il gemello a runtime della regola che il deploy applica già
 * (`deploy.sh` si rifiuta di partire con un'asta `LIVE` o `PAUSED`). Durante
 * l'asta vera nessuno può, nemmeno volendo, mettere undici bot a scrivere sotto
 * lock accanto ai dodici telefoni.
 *
 * Il costo è che una simulazione dimenticata accesa si **congela**. Per questo
 * la stessa domanda la fa anche la pagina della configurazione, e lo scrive:
 * senza quella riga, fra tre mesi sembrerà un guasto e ci si passerà una serata.
 */
export async function realAuctionRunning(): Promise<boolean> {
  const [row] = await db
    .select({ id: auctions.id })
    .from(auctions)
    .where(
      and(
        eq(auctions.isSimulated, false),
        inArray(auctions.status, ["LIVE", "PAUSED"]),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export type BotTickOptions = {
  now?: Millis;
  /**
   * Come si annuncia un cambio di presence, se ce n'è uno. Arriva da fuori per
   * la stessa ragione per cui lo scheduler riceve `advancePhase`: il motore non
   * deve sapere che esiste un canale verso i client.
   */
  onPresenceChange?: (auctionId: string) => void;
};

/**
 * Un giro del tick. Idempotente rispetto allo stato: tutto ciò che un bot
 * «ha già fatto» si rilegge dallo snapshot, quindi chiamarla due volte di
 * seguito non produce due offerte.
 */
export async function runBotTick(
  options: BotTickOptions = {},
): Promise<BotTickOutcome> {
  const now = options.now ?? Date.now();

  // ① Lo stand-down.
  if (await realAuctionRunning()) {
    return { standBy: true, auctions: 0, moves: 0 };
  }

  const simulated = await db
    .select({ id: auctions.id, status: auctions.status })
    .from(auctions)
    .where(
      and(
        eq(auctions.isSimulated, true),
        inArray(auctions.status, ["READY", "LIVE"]),
      ),
    );

  let moves = 0;
  for (const auction of simulated) {
    try {
      moves += await tickAuction(auction.id, auction.status === "LIVE", now, options);
    } catch (error: unknown) {
      // Un'asta che esplode non deve fermare le altre, esattamente come nello
      // sweep dello scheduler.
      console.error(`bot tick su ${auction.id} fallito:`, error);
    }
  }

  return { standBy: false, auctions: simulated.length, moves };
}

/**
 * Un giro su **una** asta simulata: heartbeat dei suoi bot e, se è `LIVE`, le
 * loro mosse. Restituisce quante ne sono state accettate.
 *
 * ⚠ Non controlla lo stand-down né che l'asta sia davvero simulata: quelle sono
 * decisioni di `runBotTick`, che è l'unico chiamante in produzione. È esportata
 * perché i test possano verificare il comportamento dei bot **senza dipendere
 * dall'assenza di aste reali nel database** — che in un test che gira in
 * parallelo ad altri non è una condizione controllabile.
 */
export async function tickAuction(
  auctionId: string,
  isLive: boolean,
  now: Millis,
  options: BotTickOptions = {},
): Promise<number> {
  const bots = await db
    .select({
      memberId: members.id,
      userId: members.userId,
      strategy: members.botStrategy,
    })
    .from(members)
    .where(
      and(eq(members.auctionId, auctionId), isNotNull(members.botStrategy)),
    )
    .orderBy(asc(members.seatIndex));
  if (bots.length === 0) return 0;

  // ② L'heartbeat. Fuori dal lock, come vuole ⚠ P8: è telemetria, non stato di
  // gioco. Serve perché il cancello di avvio pretende **tutti** i membri LIVE, e
  // un bot deve superarlo come lo supererebbe un telefono acceso — non con una
  // deroga nel motore.
  let presenceChanged = false;
  for (const bot of bots) {
    const { changed } = await recordHeartbeat(auctionId, bot.memberId, true, now);
    presenceChanged ||= changed;
  }
  if (presenceChanged) options.onPresenceChange?.(auctionId);

  // In READY i bot ci sono e respirano, ma non giocano: ad avviare l'asta è
  // l'owner dalla regia, come in un'asta vera.
  if (!isLive) return 0;

  const first = await loadForSnapshot(auctionId);
  if (!first) return 0;
  let loaded = first;

  // Il listone non cambia mai durante un'asta: si calcola una volta sola. ⚠ P7
  // — i fuori lista entrano solo se questa asta li ammette.
  const pool: BotPoolPlayer[] = first.state.players.filter(
    (p) => first.state.config.includeOutOfList || !p.outOfList,
  );

  let moves = 0;
  for (const bot of bots) {
    if (bot.strategy === null) continue;

    // ③ Lo snapshot **del bot**: è qui che I8 diventa una proprietà del codice
    // invece di una promessa. Un bot che ricevesse `AuctionState` grezzo
    // vedrebbe le buste dell'umano e potrebbe batterle sempre di uno.
    const snapshot = serializeSnapshot(loaded, bot.memberId, now);
    const move = decide(snapshot, bot.memberId, bot.strategy, pool, now);
    if (!move) continue;

    // Le stesse funzioni che chiama la rotta HTTP: stesso lock, stesse regole,
    // stesso broadcast. Un rifiuto tipizzato è fisiologico — il round si è
    // chiuso mentre si stava per offrire — e si ignora, come fa un telefono.
    const result =
      move.type === "PICK"
        ? await pickPlayer(bot.userId, auctionId, move.playerId, now)
        : await placeBid(bot.userId, auctionId, move.amount, now);
    if (result.ok) moves += 1;

    // Lo stato è cambiato: il bot dopo deve vedere il mondo aggiornato, o
    // offrirebbe su un lotto che nel frattempo si è chiuso.
    const reloaded = await loadForSnapshot(auctionId);
    if (!reloaded) break;
    loaded = reloaded;
  }

  return moves;
}

// ─── Il ciclo del processo ───────────────────────────────────────────────────

export type BotLoop = { stop(): void };

/**
 * Avvia il tick, una volta al secondo. **Acceso sempre**, anche senza nessuna
 * simulazione: è una `SELECT` su indice che non trova nulla, e in cambio non
 * esiste nessuno stato «il loop si è dimenticato di ripartire dopo un riavvio»
 * — lo stesso motivo per cui lo sweep dello scheduler non si spegne mai.
 *
 * Un giro non parte se il precedente non è finito: con undici bot e un database
 * lento, due giri sovrapposti offrirebbero due volte per lo stesso round.
 */
export function startBotLoop(
  onPresenceChange?: (auctionId: string) => void,
): BotLoop {
  let running = false;
  const interval = setInterval(() => {
    if (running) return;
    running = true;
    void runBotTick({ onPresenceChange })
      .catch((error: unknown) => {
        console.error("bot tick fallito:", error);
      })
      .finally(() => {
        running = false;
      });
  }, 1000);

  return {
    stop() {
      clearInterval(interval);
    },
  };
}
