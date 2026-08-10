import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { auctions, bids, lotRounds, lots, members, users } from "@/lib/db/schema";
import { startAuction } from "@/lib/engine/actions";
import {
  ensureBotUsers,
  realAuctionRunning,
  runBotTick,
  tickAuction,
} from "@/lib/engine/bots";
import { setBroadcastHook } from "@/lib/engine/mutate";
import {
  createAuction,
  fillWithBots,
  getAuctionOverview,
  importPlayers,
} from "@/lib/engine/setup";

import { makeGameAuction, syntheticListone } from "./game-helpers";
import {
  closeDatabase,
  databaseAvailable,
  dropAuctions,
  dropUsers,
  makeUser,
} from "./helpers";

/**
 * La simulazione in-app contro un Postgres vero (M4-14).
 *
 * Il taglio dei test segue quello del codice: il **comportamento** dei bot si
 * prova senza database in `tests/bot-brain.test.ts`, e qui si prova ciò che
 * senza database non esiste — i rifiuti di `fillWithBots`, il `CHECK`, lo
 * stand-down, e il fatto che il tick costruisca lo snapshot **col memberId del
 * bot**.
 *
 * ⚠ Perché quasi tutto passa da `tickAuction` e non da `runBotTick`: lo
 * stand-down è una domanda **globale** — «esiste un'asta reale in corso su
 * questa macchina?» — e i file di test girano in worker paralleli su un
 * database condiviso. Un test che pretendesse l'assenza di aste reali sarebbe
 * rosso a seconda di cosa sta facendo un altro file, che è il modo peggiore di
 * fallire. `runBotTick` si prova quindi solo nella direzione robusta: con
 * un'asta reale accesa **deve** fermarsi.
 */

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn(
    "\n⚠ Postgres non raggiungibile: i test della simulazione sono saltati.\n",
  );
}

const created: string[] = [];
const users_: string[] = [];

beforeEach(() => {
  vi.useRealTimers(); // pg fa I/O vero
  setBroadcastHook(() => {});
});

afterAll(async () => {
  await dropAuctions(created);
  await dropUsers(users_);
  await closeDatabase();
});

function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

async function makeAdmin(label = "admin"): Promise<string> {
  const id = await makeUser(label);
  users_.push(id);
  await db.update(users).set({ isAdmin: true }).where(eq(users.id, id));
  return id;
}

/**
 * Un'asta simulata a 8 posti, listone importato, nessun membro.
 *
 * I tempi sono lunghi apposta — trenta secondi — e non perché il test aspetti:
 * il tempo si inietta. Servono a rendere leggibile il momento in cui un bot
 * agisce, che è una frazione della finestra del round.
 */
async function simulated(): Promise<{ adminId: string; auctionId: string }> {
  const adminId = await makeAdmin();
  const { auctionId } = unwrap(
    await createAuction(
      adminId,
      {
        name: "Simulata di prova",
        seats: 8,
        budgetDefault: 100,
        bidSeconds: 30,
        pickSeconds: 30,
        tiePrepSeconds: 5,
        revealSeconds: 5,
        slots: { P: 1, D: 1, C: 1, A: 1 },
        roleOrder: ["P", "D", "C", "A"],
      },
      true,
    ),
  );
  created.push(auctionId);
  unwrap(await importPlayers(adminId, auctionId, syntheticListone()));
  return { adminId, auctionId };
}

async function bidRows(auctionId: string) {
  return db
    .select({
      memberId: bids.memberId,
      amount: bids.amount,
      amountSetAt: bids.amountSetAt,
    })
    .from(bids)
    .innerJoin(lotRounds, eq(lotRounds.id, bids.lotRoundId))
    .innerJoin(lots, eq(lots.id, lotRounds.lotId))
    .where(eq(lots.auctionId, auctionId));
}

describe.runIf(dbUp)("ensureBotUsers", () => {
  it("crea dodici bot e non li duplica", async () => {
    await ensureBotUsers();
    const again = await ensureBotUsers();
    expect(again).toHaveLength(12);
    expect(again.every((bot) => bot.isBot)).toBe(true);
    // Nessuno di loro è impersonabile dal provider `dev`: quel filtro è su
    // `google_sub`, e i bot ce l'hanno nullo come gli utenti del seed — è
    // `is_bot` a distinguerli, ed è quello che `listDevUsers` esclude.
    expect(again.every((bot) => bot.googleSub === null)).toBe(true);
  });

  it("il database rifiuta un bot amministratore", async () => {
    const bots = await ensureBotUsers();
    // Non è una regola sorvegliata dall'applicazione: è un CHECK, quindi non
    // esiste nessuna strada — nemmeno un UPDATE a mano — per arrivarci.
    // ⚠ Il nome del vincolo non è nel messaggio: Drizzle incarta l'errore di
    // `pg` e lascia l'originale in `cause`. Asserire solo «ha sollevato»
    // passerebbe anche per un errore di sintassi, e non proverebbe niente.
    const failure: unknown = await db
      .update(users)
      .set({ isAdmin: true })
      .where(eq(users.id, bots[0].id))
      .then(() => null)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as { cause?: { constraint?: string } }).cause?.constraint).toBe(
      "users_admin_not_bot_check",
    );
  });
});

describe.runIf(dbUp)("fillWithBots", () => {
  it("riempie i posti liberi, con le strategie del misto", async () => {
    const { adminId, auctionId } = await simulated();

    const result = unwrap(await fillWithBots(adminId, auctionId, 8, "mix"));
    expect(result.added).toBe(8);

    const overview = await getAuctionOverview(auctionId, adminId);
    expect(overview!.members).toHaveLength(8);
    // Ogni membro è un bot, con una strategia sua e il posto in ordine
    // d'ingresso — tutto ciò che viene gratis passando da `addMember`.
    expect(overview!.members.map((m) => m.seatIndex)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(overview!.members.every((m) => m.botStrategy !== null)).toBe(true);
    expect(new Set(overview!.members.map((m) => m.botStrategy)).size).toBe(3);
    // Posti pieni e listone a posto: l'asta è diventata pronta da sé.
    expect(overview!.auction.status).toBe("READY");
  });

  it("lo stesso bot gioca due simulazioni insieme", async () => {
    const a = await simulated();
    const b = await simulated();
    unwrap(await fillWithBots(a.adminId, a.auctionId, 4, "passive"));
    unwrap(await fillWithBots(b.adminId, b.auctionId, 4, "passive"));

    const inA = await db
      .select({ userId: members.userId })
      .from(members)
      .where(eq(members.auctionId, a.auctionId));
    const inB = await db
      .select({ userId: members.userId })
      .from(members)
      .where(eq(members.auctionId, b.auctionId));
    // `members_auction_user_unique` è su (asta, utente): due simulazioni in
    // parallelo pescano dagli stessi dodici senza collidere.
    expect(new Set(inA.map((m) => m.userId))).toEqual(
      new Set(inB.map((m) => m.userId)),
    );
  });

  it("rifiuta chi non possiede l'asta", async () => {
    const { auctionId } = await simulated();
    const stranger = await makeAdmin("stranger");
    expect(await fillWithBots(stranger, auctionId, 1, "mix")).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("rifiuta chi non è amministratore dell'applicazione", async () => {
    const { adminId, auctionId } = await simulated();
    await db.update(users).set({ isAdmin: false }).where(eq(users.id, adminId));
    expect(await fillWithBots(adminId, auctionId, 1, "mix")).toMatchObject({
      ok: false,
      error: { code: "NOT_ADMIN" },
    });
  });

  it("rifiuta un'asta che non è simulata", async () => {
    // È la difesa vera: non dipende da quale pulsante è stato mostrato.
    const adminId = await makeAdmin("real-owner");
    const { auctionId } = unwrap(
      await createAuction(adminId, {
        name: "Asta vera",
        seats: 8,
        slots: { P: 1, D: 1, C: 1, A: 1 },
        roleOrder: ["P", "D", "C", "A"],
      }),
    );
    created.push(auctionId);

    expect(await fillWithBots(adminId, auctionId, 1, "mix")).toMatchObject({
      ok: false,
      error: { code: "NOT_SIMULATED" },
    });
  });

  it("rifiuta più bot dei posti liberi", async () => {
    const { adminId, auctionId } = await simulated();
    unwrap(await fillWithBots(adminId, auctionId, 6, "passive"));
    expect(await fillWithBots(adminId, auctionId, 4, "passive")).toMatchObject({
      ok: false,
      error: { code: "AUCTION_FULL" },
    });
  });

  it("rifiuta un numero che non è un numero", async () => {
    const { adminId, auctionId } = await simulated();
    expect(await fillWithBots(adminId, auctionId, 0, "mix")).toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });
  });

  it("rifiuta un'asta già iniziata", async () => {
    const { adminId, auctionId } = await simulated();
    const now = Date.now();
    unwrap(await fillWithBots(adminId, auctionId, 8, "passive"));
    await tickAuction(auctionId, false, now);
    unwrap(await startAuction(adminId, auctionId, 0, now));

    expect(await fillWithBots(adminId, auctionId, 1, "mix")).toMatchObject({
      ok: false,
      error: { code: "WRONG_STATUS" },
    });
  });
});

describe.runIf(dbUp)("il tick", () => {
  it("l'heartbeat dei bot fa passare il cancello di avvio", async () => {
    const { adminId, auctionId } = await simulated();
    unwrap(await fillWithBots(adminId, auctionId, 8, "passive"));
    const now = Date.now();

    // Senza heartbeat l'asta non parte: il gate vuole tutti i membri LIVE, e
    // vale anche per chi non ha un telefono (F4-06, nessuna deroga).
    expect(await startAuction(adminId, auctionId, 0, now)).toMatchObject({
      ok: false,
      error: { code: "MEMBERS_NOT_READY" },
    });

    await tickAuction(auctionId, false, now);
    expect(unwrap(await startAuction(adminId, auctionId, 0, now)).state.status).toBe(
      "LIVE",
    );
  });

  it("i bot chiamano e offrono, e non offrono due volte nello stesso round", async () => {
    const { adminId, auctionId } = await simulated();
    unwrap(await fillWithBots(adminId, auctionId, 8, "passive"));
    const t0 = Date.now();

    await tickAuction(auctionId, false, t0);
    unwrap(await startAuction(adminId, auctionId, 0, t0));

    // Il turno di chiamata dura 30s: a 25s il bot di turno ha già chiamato.
    // Gli altri, il cui round si è appena aperto, non hanno ancora offerto.
    expect(await tickAuction(auctionId, true, t0 + 25_000)).toBe(1);
    const opened = await db.query.auctions.findFirst({
      where: eq(auctions.id, auctionId),
    });
    expect(opened!.phase).toBe("LOT_OPEN");

    // Il round si è aperto a t0+25s e dura 30s: a t0+50s hanno offerto tutti
    // quelli che potevano.
    const first = await tickAuction(auctionId, true, t0 + 50_000);
    expect(first).toBeGreaterThan(0);
    const after = await bidRows(auctionId);
    expect(after.length).toBeGreaterThan(1);

    /**
     * ⚠ **Questa è l'asserzione che prova I8 nel tick.** Il secondo giro non
     * produce nessuna mossa perché ogni bot, nel *proprio* snapshot, si vede
     * già la busta dentro (`myBid`) — che è l'unico modo che ha di saperlo,
     * visto che non tiene memoria di niente.
     *
     * Se il tick costruisse lo snapshot con `viewerMemberId = null` — la vista
     * del manager, quella senza `myBid` — ogni bot ricomputerebbe la stessa
     * offerta e la ripresenterebbe a ogni secondo. Il database non se ne
     * accorgerebbe (⚠ P3: confermare la stessa cifra è un no-op) e le buste
     * resterebbero identiche: **l'unica traccia visibile è questo numero**.
     */
    expect(await tickAuction(auctionId, true, t0 + 51_000)).toBe(0);
    expect(await bidRows(auctionId)).toEqual(after);
  });

  it("in READY i bot respirano ma non giocano", async () => {
    const { adminId, auctionId } = await simulated();
    unwrap(await fillWithBots(adminId, auctionId, 8, "aggressive"));
    expect(await tickAuction(auctionId, false, Date.now())).toBe(0);
    expect(await bidRows(auctionId)).toHaveLength(0);
  });
});

describe.runIf(dbUp)("lo stand-down", () => {
  it("con un'asta reale in corso i bot stanno fermi", async () => {
    // L'asta vera: `makeGameAuction` non passa il flag, quindi non è simulata.
    const real = await makeGameAuction();
    created.push(real.auctionId);
    users_.push(real.ownerId, ...real.userIds);

    const { adminId, auctionId } = await simulated();
    unwrap(await fillWithBots(adminId, auctionId, 8, "aggressive"));
    const t0 = Date.now();
    await tickAuction(auctionId, false, t0);
    unwrap(await startAuction(adminId, auctionId, 0, t0));

    unwrap(await startAuction(real.ownerId, real.auctionId, 0, t0));
    expect(await realAuctionRunning()).toBe(true);

    // Il tick completo vede l'asta vera e si ferma prima di guardare le altre.
    const outcome = await runBotTick({ now: t0 + 25_000 });
    expect(outcome).toMatchObject({ standBy: true, auctions: 0, moves: 0 });

    // E la simulazione è rimasta ferma dov'era: nessuna chiamata, nessun lotto.
    const frozen = await db.query.auctions.findFirst({
      where: eq(auctions.id, auctionId),
    });
    expect(frozen!.phase).toBe("WAITING_PICK");
    expect(
      await db
        .select({ id: lots.id })
        .from(lots)
        .where(and(eq(lots.auctionId, auctionId), eq(lots.status, "OPEN"))),
    ).toHaveLength(0);
  });
});
