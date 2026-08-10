import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuctionLog } from "@/lib/auction-log";
import {
  advancePhase,
  pauseAuction,
  pickPlayer,
  placeBid,
  startAuction,
} from "@/lib/engine/actions";
import { getAuctionLog } from "@/lib/engine/log";
import { setBroadcastHook } from "@/lib/engine/mutate";
import { manualAssign, voidAssignment } from "@/lib/engine/override";
import { loadForSnapshot } from "@/lib/engine/snapshot";

import { type GameAuction, makeGameAuction } from "./game-helpers";
import {
  closeDatabase,
  databaseAvailable,
  dropAuctions,
  dropUsers,
  makeUser,
} from "./helpers";

/**
 * M3 — lo storico dell'asta, e soprattutto **I8**.
 *
 * Il primo blocco di questo file è il test che vale la macro: una pagina che
 * mostrasse le buste del lotto in contesa violerebbe I8, e con il rafforzamento
 * di M1 lo violerebbe anche solo dicendo che una busta è stata consegnata. Il
 * dato è tutto lì, in memoria, un `map` di distanza — quindi va provato che non
 * esca, non sperato.
 */

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn("\n⚠ Postgres non raggiungibile: i test dello storico sono saltati.\n");
}

const createdAuctions: string[] = [];
const createdUsers: string[] = [];

afterAll(async () => {
  if (!dbUp) return;
  setBroadcastHook(() => {});
  await dropAuctions(createdAuctions);
  await dropUsers(createdUsers);
  await closeDatabase();
});

function unwrap<T>(
  r: { ok: true; value: T } | { ok: false; error: { message: string } },
): T {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

async function gameAuction(ownerPlays = true): Promise<GameAuction> {
  const game = await makeGameAuction({ ownerPlays });
  createdAuctions.push(game.auctionId);
  createdUsers.push(...game.userIds);
  if (!ownerPlays) createdUsers.push(game.ownerId);
  return game;
}

async function log(game: GameAuction, actorUserId = game.ownerId): Promise<AuctionLog> {
  return unwrap(await getAuctionLog(actorUserId, game.auctionId));
}

/**
 * Lo storico serializzato, **togliendo le cifre che non sono importi**.
 *
 * L'asserzione che conta è «una cifra d'offerta non è uscita da nessuna parte»,
 * e per poterla scrivere su tutto il payload bisogna prima togliere i numeri
 * che un importo non sono e che per caso contengono le stesse cifre:
 *
 * - gli **istanti** ISO — `21:47` non è un'offerta da 47;
 * - gli **uuid**, che sono esadecimali casuali e finiscono anche dentro i nomi
 *   utente costruiti da `makeUser`;
 * - gli **id** di `events`, che sono un `bigserial` globale al database e in un
 *   test ripetuto arrivano a cinque cifre.
 *
 * Senza queste tre esclusioni il test fallisce a caso, secondo i byte che il
 * generatore di uuid ha prodotto quel giorno — cioè nel modo peggiore, perché
 * un rosso che va e viene si finisce per ignorare. Il test resta forte: un
 * importo che comparisse in una busta, in un `outcome` o in un payload reso in
 * italiano lo troverebbe comunque.
 */
function payloadWithoutHarmlessNumbers(entry: AuctionLog): string {
  return JSON.stringify(entry)
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<istante>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
    .replace(/"id":\d+/g, '"id":<id>');
}

describe.runIf(dbUp)("M3 §5 — I8: le buste del lotto in corso non escono", () => {
  beforeEach(() => {
    vi.useRealTimers();
    setBroadcastHook(() => {});
  });

  /** Un'asta con un lotto **aperto** e tre buste dentro, cifre riconoscibili. */
  async function withOpenLot(): Promise<{ game: GameAuction; amounts: number[] }> {
    const now = Date.now();
    const game = await gameAuction();
    const state = (await loadForSnapshot(game.auctionId))!.state;
    const keeper = state.players.find((p) => p.role === "P")!;

    unwrap(await startAuction(game.ownerId, game.auctionId, 0, now));
    unwrap(await pickPlayer(game.userIds[0], game.auctionId, keeper.id, now + 100));
    // Cifre che non possono comparire altrove: il listone sintetico ha 40
    // giocatori, i posti sono 8, i budget 100.
    const amounts = [47, 63, 91];
    unwrap(await placeBid(game.userIds[1], game.auctionId, 47, now + 200));
    unwrap(await placeBid(game.userIds[2], game.auctionId, 63, now + 300));
    unwrap(await placeBid(game.userIds[3], game.auctionId, 91, now + 400));
    return { game, amounts };
  }

  it("nessuno dei tre importi compare in ciò che lo storico restituisce", async () => {
    const { game, amounts } = await withOpenLot();
    const testo = payloadWithoutHarmlessNumbers(await log(game));
    for (const amount of amounts) {
      expect(testo, `l'importo ${amount} è trapelato`).not.toContain(String(amount));
    }
  });

  it("il lotto in contesa non compare affatto, nemmeno come riga vuota", async () => {
    const { game } = await withOpenLot();
    expect((await log(game)).lots).toHaveLength(0);
  });

  it("non escono nemmeno al partecipante che sta offrendo su quel lotto", async () => {
    const { game, amounts } = await withOpenLot();
    const testo = payloadWithoutHarmlessNumbers(await log(game, game.userIds[1]));
    for (const amount of amounts) {
      expect(testo, `l'importo ${amount} è trapelato`).not.toContain(String(amount));
    }
  });

  /**
   * La pausa congela la fase, non la azzera: un lotto aperto resta aperto, e le
   * sue buste restano chiuse. È lo stesso ragionamento degli override, che con
   * `LOT_OPEN` sono rifiutati anche ad asta in pausa.
   */
  it("nemmeno ad asta in pausa con il lotto aperto", async () => {
    const { game, amounts } = await withOpenLot();
    unwrap(await pauseAuction(game.ownerId, game.auctionId, Date.now() + 500));
    const testo = payloadWithoutHarmlessNumbers(await log(game));
    for (const amount of amounts) {
      expect(testo, `l'importo ${amount} è trapelato`).not.toContain(String(amount));
    }
  });

  it("quando il lotto si risolve, le stesse buste compaiono tutte", async () => {
    const { game, amounts } = await withOpenLot();
    // L'ingresso in LOT_REVEAL è il momento in cui le buste diventano
    // pubbliche, ed è lo stesso in cui il motore scrive `status = RESOLVED`.
    unwrap(await advancePhase(game.auctionId, Date.now() + 5_000));

    const entry = await log(game);
    expect(entry.lots).toHaveLength(1);
    const [lot] = entry.lots;
    expect(lot.price).toBe(91);
    expect(lot.winnerTeamName).toBe("Squadra 3");

    const importi = lot.rounds[0].bids.map((b) => b.amount);
    for (const amount of amounts) expect(importi).toContain(amount);
    // L'auto-bid a 1 del chiamante: è una busta come le altre e si vede.
    expect(importi).toContain(1);
  });
});

describe.runIf(dbUp)("M3 §3 — chi può aprire lo storico", () => {
  beforeEach(() => {
    vi.useRealTimers();
    setBroadcastHook(() => {});
  });

  it("l'owner sì, anche se non gioca", async () => {
    const game = await gameAuction(false);
    expect((await getAuctionLog(game.ownerId, game.auctionId)).ok).toBe(true);
  });

  it("un partecipante sì: la disputa la porta lui", async () => {
    const game = await gameAuction();
    expect((await getAuctionLog(game.userIds[4], game.auctionId)).ok).toBe(true);
  });

  /** Un 404 e non un 403: l'esistenza di un'asta che non è tua non è tua. */
  it("un estraneo prende un 404, non un «vietato»", async () => {
    const game = await gameAuction();
    const estraneo = await makeUser("log-estraneo");
    createdUsers.push(estraneo);
    expect(await getAuctionLog(estraneo, game.auctionId)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });

  it("un'asta inesistente è un 404", async () => {
    const game = await gameAuction();
    expect(await getAuctionLog(game.ownerId, "undefined")).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });
});

describe.runIf(dbUp)("M3 §4 — cosa racconta lo storico", () => {
  beforeEach(() => {
    vi.useRealTimers();
    setBroadcastHook(() => {});
  });

  /** Un'asta con un lotto risolto, restituendo il numero di quel lotto. */
  async function withResolvedLot(): Promise<{ game: GameAuction; seq: number }> {
    const now = Date.now();
    const game = await gameAuction();
    const state = (await loadForSnapshot(game.auctionId))!.state;
    const keeper = state.players.find((p) => p.role === "P")!;

    unwrap(await startAuction(game.ownerId, game.auctionId, 0, now));
    unwrap(await pickPlayer(game.userIds[0], game.auctionId, keeper.id, now + 100));
    unwrap(await placeBid(game.userIds[1], game.auctionId, 12, now + 200));
    unwrap(await advancePhase(game.auctionId, now + 5_000));
    return { game, seq: 1 };
  }

  it("il lotto risolto porta giocatore, chiamante, vincitore e prezzo", async () => {
    const { game } = await withResolvedLot();
    const [lot] = (await log(game)).lots;
    expect(lot.seq).toBe(1);
    expect(lot.player.role).toBe("P");
    expect(lot.calledByTeamName).toBe("Squadra 0");
    expect(lot.winnerTeamName).toBe("Squadra 1");
    expect(lot.price).toBe(12);
    expect(lot.voided).toBe(false);
  });

  it("ogni round dice il minimo, quanti erano gli idonei e com'è finito", async () => {
    const { game } = await withResolvedLot();
    const [round] = (await log(game)).lots[0].rounds;
    expect(round.roundNo).toBe(1);
    expect(round.minAmount).toBe(1);
    expect(round.eligibleCount).toBe(8);
    expect(round.outcome).toContain("aggiudicato");
    expect(round.outcome).toContain("12");
  });

  it("l'avvio dell'asta è fra le correzioni, le offerte no", async () => {
    const { game } = await withResolvedLot();
    const entry = await log(game);
    expect(entry.events.some((e) => e.text.includes("Asta avviata"))).toBe(true);
    // PICK, PLACE_BID e ADVANCE sono routine: il dettaglio del lotto le racconta
    // meglio di quanto sappia fare il loro payload.
    expect(entry.events.some((e) => e.text.includes("PLACE_BID"))).toBe(false);
    expect(entry.events.some((e) => e.text.includes("ADVANCE"))).toBe(false);
  });

  /**
   * Regola 5 — lo storico non nasconde le riassegnazioni: le racconta. Il lotto
   * resta, marcato, e l'annullamento con il suo rimpiazzo stanno fra le
   * correzioni.
   */
  it("un'assegnazione annullata marca il lotto e lascia due tracce", async () => {
    const { game } = await withResolvedLot();
    const loaded = (await loadForSnapshot(game.auctionId))!;
    const assignmentId = loaded.refs.assignments.get(loaded.state.assignments[0].id)!;
    const altro = loaded.state.players.filter((p) => p.role === "P")[1];

    const now = Date.now();
    unwrap(await voidAssignment(game.ownerId, game.auctionId, assignmentId, now));
    unwrap(
      await manualAssign(
        game.ownerId,
        game.auctionId,
        { memberId: game.memberIds[4], playerId: altro.id, price: 7 },
        now + 10,
      ),
    );

    const entry = await log(game);
    // Il lotto non è sparito: è marcato.
    expect(entry.lots).toHaveLength(1);
    expect(entry.lots[0].voided).toBe(true);

    const testi = entry.events.map((e) => e.text);
    expect(testi.some((t) => t.startsWith("Annullata"))).toBe(true);
    expect(testi.some((t) => t.startsWith("Assegnato a mano"))).toBe(true);
  });

  it("l'annullamento dice da quale lotto veniva", async () => {
    const { game, seq } = await withResolvedLot();
    const loaded = (await loadForSnapshot(game.auctionId))!;
    const assignmentId = loaded.refs.assignments.get(loaded.state.assignments[0].id)!;
    unwrap(
      await voidAssignment(game.ownerId, game.auctionId, assignmentId, Date.now()),
    );

    const void_ = (await log(game)).events.find((e) => e.text.startsWith("Annullata"))!;
    expect(void_.text).toContain(`lotto #${seq}`);
  });

  it("dice chi ha agito, col nome e non con un uuid", async () => {
    const { game } = await withResolvedLot();
    const avvio = (await log(game)).events.find((e) =>
      e.text.includes("Asta avviata"),
    )!;
    expect(avvio.actorName).not.toBeNull();
    expect(avvio.actorName).not.toMatch(/^[0-9a-f-]{36}$/);
  });

  it("porta il nome dell'asta, lo stato e l'ora della lettura", async () => {
    const { game } = await withResolvedLot();
    const entry = await log(game);
    expect(entry.auctionName).toBe("Asta di gioco");
    expect(entry.status).toBe("LIVE");
    expect(Number.isNaN(Date.parse(entry.readAt))).toBe(false);
  });

  it("su un'asta che non è ancora partita non c'è niente da raccontare", async () => {
    const game = await gameAuction();
    const entry = await log(game);
    expect(entry.lots).toEqual([]);
    expect(entry.events).toEqual([]);
    expect(entry.status).toBe("READY");
  });
});
