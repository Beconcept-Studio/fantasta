import { afterAll, describe, expect, it } from "vitest";

import {
  advancePhase,
  pickPlayer,
  placeBid,
  startAuction,
} from "@/lib/engine/actions";
import { setBroadcastHook } from "@/lib/engine/mutate";
import { manualAssign, voidAssignment } from "@/lib/engine/override";
import { derivePresence } from "@/lib/engine/presence";
import { createScheduler } from "@/lib/engine/scheduler";
import { loadForSnapshot, serializeSnapshot } from "@/lib/engine/snapshot";

import { type GameAuction, makeGameAuction } from "./game-helpers";
import {
  closeDatabase,
  databaseAvailable,
  dropAuctions,
  dropUsers,
} from "./helpers";

/**
 * F4-01/02 — `serializeSnapshot`, l'unico punto di uscita dello stato.
 *
 * I casi §12.31–34 di PLAN §12 sono test **sullo snapshot, non sulla UI**:
 * verificano che chi si riconnette a metà round ricostruisca tutto da un
 * messaggio solo (I10) e che nessun importo altrui ci finisca dentro (I8).
 * Il test I8 completo sui tre viewer sta in `tests/db/i8.test.ts`.
 */

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn("\n⚠ Postgres non raggiungibile: i test sullo snapshot sono saltati.\n");
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
  result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

async function gameAuction(): Promise<GameAuction> {
  const game = await makeGameAuction();
  createdAuctions.push(game.auctionId);
  createdUsers.push(...game.userIds);
  return game;
}

/** Lo snapshot come lo riceverebbe un client: dal database, sanificato. */
export async function snapshotOf(
  auctionId: string,
  viewerMemberId: string | null,
  now: number,
) {
  const loaded = await loadForSnapshot(auctionId);
  if (!loaded) throw new Error("asta sparita");
  return serializeSnapshot(loaded, viewerMemberId, now);
}

/** I giocatori del ruolo, in ordine di `fvm` decrescente (come l'auto-pick). */
async function playersOfRole(auctionId: string, role: "P" | "D" | "C" | "A") {
  const loaded = await loadForSnapshot(auctionId);
  if (!loaded) throw new Error("asta sparita");
  return loaded.state.players
    .filter((p) => p.role === role)
    .sort((a, b) => b.fvm - a.fvm);
}

describe.runIf(dbUp)("F4-01 — snapshot durante LOT_OPEN", () => {
  it("§12.31 — chi ha già offerto ritrova la propria offerta in myBid", async () => {
    const game = await gameAuction();
    const t0 = Date.now();
    unwrap(await startAuction(game.ownerId, game.auctionId, 0, t0));

    const [gk] = await playersOfRole(game.auctionId, "P");
    unwrap(await pickPlayer(game.userIds[0], game.auctionId, gk.id, t0 + 500));
    unwrap(await placeBid(game.userIds[1], game.auctionId, 42, t0 + 1_000));

    const snap = await snapshotOf(game.auctionId, game.memberIds[1], t0 + 1_200);

    expect(snap.auction.phase).toBe("LOT_OPEN");
    expect(snap.myBid).toEqual({
      amount: 42,
      amountSetAt: new Date(t0 + 1_000).toISOString(),
      withdrawnAt: null,
    });
    expect(snap.currentLot?.player.id).toBe(gk.id);
    expect(snap.currentLot?.player.name).not.toBe("");
    // Il countdown si ricostruisce da qui: scadenza e orologio del server.
    expect(snap.currentLot?.endsAt).toBe(new Date(t0 + 3_500).toISOString());
    expect(snap.serverNow).toBe(new Date(t0 + 1_200).toISOString());
  });

  it("§12.31 — degli altri non si sa né quanto né se hanno offerto", async () => {
    const game = await gameAuction();
    const t0 = Date.now();
    unwrap(await startAuction(game.ownerId, game.auctionId, 0, t0));

    const [gk] = await playersOfRole(game.auctionId, "P");
    unwrap(await pickPlayer(game.userIds[0], game.auctionId, gk.id, t0 + 500));
    unwrap(await placeBid(game.userIds[1], game.auctionId, 42, t0 + 1_000));

    const snap = await snapshotOf(game.auctionId, game.memberIds[2], t0 + 1_200);

    // Del round esce solo chi *potrebbe* offrire: al primo lotto sono tutti.
    expect(snap.currentLot?.eligibleMemberIds).toHaveLength(8);
    expect(snap.myBid).toBeNull();
    expect(snap.currentLot?.reveal).toBeNull();
    // Nessun campo `amount` da nessuna parte: non c'è cifra da cui risalire.
    // (`minAmount` non conta — la soglia del round è pubblica per definizione.)
    expect(JSON.stringify(snap)).not.toContain('"amount"');
    // E nemmeno una traccia di chi ha consegnato: il chiamante ha l'auto-bid a
    // 1 e il seat 1 ha appena offerto 42, ma dal lotto i due sono
    // indistinguibili dal seat 3, che non ha fatto niente (M1). La guardia
    // forte — l'insieme esatto delle chiavi — sta in `i8.test.ts`.
    expect(snap.currentLot).not.toHaveProperty("bidStatus");
  });

  // ⚠ Qui stava «il ritiro resta con withdrawnAt, e lo vede solo chi si è
  // ritirato», tolto da M16 insieme a `withdrawBid`: senza uno scrittore non
  // c'è modo di costruire un ritiro passando dalle azioni. Il campo continua a
  // viaggiare nello snapshot — `withdrawnAt: null` è asserito qui sopra — e le
  // due proprietà che quel test difendeva sono ancora difese altrove: la forma
  // esatta di ciò che esce dal server sta in `i8.test.ts`, e il filtro delle
  // ritirate nella risoluzione in `tests/engine/rules.test.ts`.
});

describe.runIf(dbUp)("F4-01 — §12.32, il membro non idoneo", () => {
  it("non compare in eligibleMemberIds e non ha un myBid", async () => {
    const game = await gameAuction();
    const t0 = Date.now();
    unwrap(await startAuction(game.ownerId, game.auctionId, 0, t0));

    // Primo lotto P: lo chiama il seat 0 e nessuno rilancia → lo vince a 1,
    // e con `slots.P = 1` il suo ruolo P è pieno.
    const gks = await playersOfRole(game.auctionId, "P");
    unwrap(await pickPlayer(game.userIds[0], game.auctionId, gks[0].id, t0 + 500));
    unwrap(await advancePhase(game.auctionId, t0 + 3_500)); // chiusura round → REVEAL
    unwrap(await advancePhase(game.auctionId, t0 + 4_500)); // fine reveal → turno dopo

    // Secondo lotto P, chiamato dal seat 1: il seat 0 non è più idoneo.
    unwrap(await pickPlayer(game.userIds[1], game.auctionId, gks[1].id, t0 + 5_000));

    const snap = await snapshotOf(game.auctionId, game.memberIds[0], t0 + 5_100);

    expect(snap.auction.phase).toBe("LOT_OPEN");
    expect(snap.currentLot?.eligibleMemberIds).not.toContain(game.memberIds[0]);
    expect(snap.currentLot?.eligibleMemberIds).toContain(game.memberIds[1]);
    expect(snap.myBid).toBeNull();
    // La rosa del seat 0 c'è comunque: lo snapshot resta completo per tutti.
    const seat0 = snap.members.find((m) => m.id === game.memberIds[0]);
    expect(seat0?.roster).toHaveLength(1);
    expect(seat0?.slotsFilled.P).toBe(1);
    expect(seat0?.credits).toBe(99);
  });
});

/**
 * M18 §2 — **`member.roster` è in ordine di estrazione**, e da qui in avanti è
 * una proprietà dichiarata invece che soltanto vera.
 *
 * Vale per costruzione: `loadAuctionState` legge le assegnazioni con
 * `.orderBy(asc(assignments.createdAt), asc(assignments.id))` e
 * `serializeMembers` filtra e mappa **senza riordinare**. Fino a M18 nessuno lo
 * verificava, perché erano le due viste a riordinare per prezzo nel client: da
 * quando quel `.sort()` non c'è più, l'ordine dello snapshot è l'ordine che si
 * legge a schermo, e una modifica a `mutate.ts` o a `serializeMembers` potrebbe
 * togliersela senza che niente protesti.
 *
 * ⚠ **È un test che passerebbe anche prima di M18**, ed è precisamente il motivo
 * per cui va scritto: non prova una modifica, protegge un presupposto.
 */
describe.runIf(dbUp)("M18 §2 — la rosa è in ordine di estrazione", () => {
  it("due assegnazioni nello stesso ruolo restano in ordine di creazione, non di prezzo", async () => {
    const game = await gameAuction();
    const t0 = Date.now();
    const strikers = await playersOfRole(game.auctionId, "A");

    // ⚠ **La seconda è più costosa della prima**: è l'unico modo di distinguere
    // «ordine di estrazione» da «ordine per prezzo decrescente», che su una rosa
    // comprata in ordine di prezzo darebbero la stessa lista.
    unwrap(
      await manualAssign(
        game.ownerId,
        game.auctionId,
        { memberId: game.memberIds[0], playerId: strikers[0].id, price: 12 },
        t0,
      ),
    );
    // `force` deroga a I4 perché l'asta di prova ha 1 slot per ruolo: la deroga
    // è del setup, non della proprietà sotto esame.
    unwrap(
      await manualAssign(
        game.ownerId,
        game.auctionId,
        {
          memberId: game.memberIds[0],
          playerId: strikers[1].id,
          price: 45,
          force: true,
        },
        t0 + 1_000,
      ),
    );

    const snap = await snapshotOf(game.auctionId, game.memberIds[0], t0 + 1_100);
    const rosa = snap.members.find((m) => m.id === game.memberIds[0])!.roster;

    expect(rosa.map((entry) => entry.playerId)).toEqual([
      strikers[0].id,
      strikers[1].id,
    ]);
    // I prezzi salgono: se qualcuno rimettesse un riordino per prezzo, questa
    // riga sarebbe la prima a diventare rossa.
    expect(rosa.map((entry) => entry.price)).toEqual([12, 45]);
  });

  it("⚠ una riassegnazione va in fondo: la rosa dice quando le cose sono state decise", async () => {
    const game = await gameAuction();
    const t0 = Date.now();
    const strikers = await playersOfRole(game.auctionId, "A");
    const defenders = await playersOfRole(game.auctionId, "D");

    const primo = unwrap(
      await manualAssign(
        game.ownerId,
        game.auctionId,
        { memberId: game.memberIds[0], playerId: strikers[0].id, price: 30 },
        t0,
      ),
    );
    unwrap(
      await manualAssign(
        game.ownerId,
        game.auctionId,
        { memberId: game.memberIds[0], playerId: defenders[0].id, price: 5 },
        t0 + 1_000,
      ),
    );
    // La correzione di M18 §2: `voidAssignment` + `manualAssign` creano una riga
    // nuova, con il `createdAt` del momento in cui la correzione è stata fatta.
    unwrap(
      await voidAssignment(game.ownerId, game.auctionId, primo.assignmentId, t0 + 2_000),
    );
    unwrap(
      await manualAssign(
        game.ownerId,
        game.auctionId,
        { memberId: game.memberIds[0], playerId: strikers[1].id, price: 30 },
        t0 + 3_000,
      ),
    );

    const snap = await snapshotOf(game.auctionId, game.memberIds[0], t0 + 3_100);
    const rosa = snap.members.find((m) => m.id === game.memberIds[0])!.roster;

    // L'annullata non c'è più, e il rimpiazzo è **in coda** — non al posto che
    // occupava il giocatore che ha sostituito. Non è un difetto: è stato deciso
    // allora.
    expect(rosa.map((entry) => entry.playerId)).toEqual([
      defenders[0].id,
      strikers[1].id,
    ]);
  });
});

describe.runIf(dbUp)("F4-02 — stateVersion", () => {
  it("§12.34 — due snapshot consecutivi hanno versione strettamente crescente", async () => {
    const game = await gameAuction();
    const t0 = Date.now();

    const before = await snapshotOf(game.auctionId, game.memberIds[0], t0);
    unwrap(await startAuction(game.ownerId, game.auctionId, 0, t0));
    const afterStart = await snapshotOf(game.auctionId, game.memberIds[0], t0);

    const [gk] = await playersOfRole(game.auctionId, "P");
    unwrap(await pickPlayer(game.userIds[0], game.auctionId, gk.id, t0 + 500));
    const afterPick = await snapshotOf(game.auctionId, game.memberIds[0], t0 + 500);

    expect(afterStart.stateVersion).toBeGreaterThan(before.stateVersion);
    expect(afterPick.stateVersion).toBeGreaterThan(afterStart.stateVersion);

    // ⚠ P14 — un ADVANCE in anticipo è un no-op: niente bump, niente traffico.
    unwrap(await advancePhase(game.auctionId, t0 + 600));
    const afterNoop = await snapshotOf(game.auctionId, game.memberIds[0], t0 + 600);
    expect(afterNoop.stateVersion).toBe(afterPick.stateVersion);
  });
});

describe.runIf(dbUp)("F4-09 — §12.33, niente fasi stantie", () => {
  it("dopo la scadenza del pick lo snapshot è già LOT_OPEN con l'auto-pick", async () => {
    const game = await gameAuction();
    // L'asta è partita un minuto fa e nessuno ha chiamato: la deadline del
    // pick (3s) è scaduta da un pezzo, come per chi rientra dopo un blackout.
    unwrap(
      await startAuction(game.ownerId, game.auctionId, 0, Date.now() - 60_000),
    );

    const stale = await snapshotOf(game.auctionId, game.memberIds[0], Date.now());
    expect(stale.auction.phase).toBe("WAITING_PICK"); // finché nessuno avanza

    // È il server a far scorrere il tempo: lo sweep dello scheduler, non il
    // client che chiede lo snapshot (regola 1).
    const scheduler = createScheduler(advancePhase);
    const swept = await scheduler.sweep();
    scheduler.stop();
    expect(swept).toContain(game.auctionId);

    const fresh = await snapshotOf(game.auctionId, game.memberIds[0], Date.now());
    expect(fresh.auction.phase).toBe("LOT_OPEN");
    expect(fresh.currentLot?.autoCalled).toBe(true);
    // L'auto-bid a 1 del chiamante è già a database e si vede nel suo snapshot.
    expect(fresh.myBid?.amount).toBe(1);
    expect(fresh.currentLot?.player.name).not.toBe("");
    // La scadenza è quella nuova del round, non un residuo del pick.
    expect(Date.parse(fresh.currentLot!.endsAt)).toBeGreaterThan(Date.now() - 1_000);
  });
});

describe("F4-05 — derivazione della presence (PLAN §7)", () => {
  const now = 1_700_000_000_000;

  it("visto meno di 15s fa e con il tab in primo piano → LIVE", () => {
    expect(derivePresence(now - 14_999, true, now)).toBe("LIVE");
  });

  it("visto di recente ma con il tab in background → IDLE", () => {
    expect(derivePresence(now - 1_000, false, now)).toBe("IDLE");
  });

  it("oltre i 15 secondi → OFFLINE, comunque", () => {
    expect(derivePresence(now - 15_000, true, now)).toBe("OFFLINE");
    expect(derivePresence(now - 60_000, false, now)).toBe("OFFLINE");
  });

  it("mai visto → OFFLINE", () => {
    expect(derivePresence(null, true, now)).toBe("OFFLINE");
  });
});
