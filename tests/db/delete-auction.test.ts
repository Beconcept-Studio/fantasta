import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import {
  assignments,
  auctions,
  bids,
  events,
  invites,
  ledger,
  listonePlayers,
  lotRounds,
  lots,
  members,
  playerInsights,
  players,
  users,
} from "@/lib/db/schema";
import {
  advancePhase,
  pickPlayer,
  placeBid,
  startAuction,
} from "@/lib/engine/actions";
import { setAuctionGoneHook, setBroadcastHook } from "@/lib/engine/mutate";
import { adjustBudget } from "@/lib/engine/override";
import { loadForSnapshot } from "@/lib/engine/snapshot";
import { createAuction, deleteAuction } from "@/lib/engine/setup";
import {
  type Dismissal,
  closeAuctionStreams,
  connectionCount,
  resetBroadcast,
  subscribe,
} from "@/lib/realtime/broadcast";

import { makeGameAuction } from "./game-helpers";
import {
  closeDatabase,
  databaseAvailable,
  dropAuctions,
  dropUsers,
  makeUser,
} from "./helpers";

/**
 * M12 — la cancellazione forzata di un'asta in corso, e il congedo di chi la
 * stava guardando.
 *
 * Tre proprietà, e sono tre cose diverse:
 *
 * 1. **Chi può.** Il rifiuto su `LIVE` e `PAUSED` resta per tutti; solo un
 *    amministratore ha la strada forzata, e `is_admin` si rilegge dal database
 *    dentro il lock — un `force: true` chiesto da chi non lo è non cancella
 *    niente (P17).
 * 2. **Cosa se ne va, e cosa no.** La cascata porta via tutto ciò che appartiene
 *    all'asta; **`users` non si tocca**, ed è la frase «solo gli utenti annessi
 *    non si cancellano» diventata un test. Le tabelle globali — listone e
 *    insight — sopravvivono di proposito.
 * 3. **Il congedo arriva.** Si asserisce sul registro delle connessioni, non su
 *    un browser: chi era iscritto riceve l'evento terminale e la voce della mappa
 *    si svuota.
 *
 * ⚠ **Su `users` non si conta niente globalmente.** Vitest gira i file in worker
 * paralleli e ogni file crea e distrugge utenti mentre questo gira: un
 * `count(*)` su `users` è un numero che cambia sotto i piedi, e un test che lo
 * guarda è un test che fallisce per colpa di qualcun altro. Si asserisce **sugli
 * id creati da questo test, uno per uno** (`missingAmong`). È la trappola di
 * DECISIONS 2026-08-12 con la tabella peggiore possibile.
 */

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn(
    "\n⚠ Postgres non raggiungibile: i test della cancellazione sono saltati.\n" +
      "  Avvia il database con `docker compose up -d` e rilancia `pnpm test`.\n",
  );
}

const suite = dbUp ? describe : describe.skip;
const created: string[] = [];
const createdAuctions: string[] = [];

afterEach(() => {
  resetBroadcast();
  setBroadcastHook(() => {});
  // L'hook del congedo è un singleton di processo come l'altro: se restasse
  // agganciato, il file di test successivo congederebbe connessioni che non ha
  // aperto lui.
  setAuctionGoneHook(() => 0);
});

afterAll(async () => {
  if (!dbUp) return;
  await dropAuctions(createdAuctions);
  await dropUsers(created);
  await closeDatabase();
});

async function user(
  label: string,
  options: { isAdmin?: boolean } = {},
): Promise<string> {
  const id = await makeUser(label, options);
  created.push(id);
  return id;
}

function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** Un'asta avviata, con otto membri, l'owner che non gioca e il nome a portata. */
async function liveGame(status: "LIVE" | "PAUSED") {
  const game = await makeGameAuction({ ownerPlays: false });
  createdAuctions.push(game.auctionId);
  created.push(...game.userIds, game.ownerId);

  const t0 = Date.now();
  unwrap(await startAuction(game.ownerId, game.auctionId, 0, t0));
  if (status === "PAUSED") {
    await db
      .update(auctions)
      .set({ status: "PAUSED", pausedAt: new Date() })
      .where(eq(auctions.id, game.auctionId));
  }

  const row = await db.query.auctions.findFirst({
    where: eq(auctions.id, game.auctionId),
  });
  return { ...game, t0, name: row!.name };
}

/**
 * ⚠ **Gli utenti si controllano per id, non con un `count(*)`** (vedi la nota in
 * testa al file). Restituisce quelli che *non* ci sono più: la lista vuota è la
 * proprietà da provare.
 */
async function missingAmong(ids: string[]): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.id, ids));
  const present = new Set(rows.map((r) => r.id));
  return ids.filter((id) => !present.has(id));
}

/** La riga di log della cancellazione non deve sporcare l'output dei test. */
async function silently<T>(fn: () => Promise<T>): Promise<T> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    return await fn();
  } finally {
    log.mockRestore();
  }
}

/**
 * Quante righe restano, in ogni tabella che appartiene a quell'asta.
 *
 * ⚠ **Tre di queste tabelle non hanno `auction_id`**, e si raggiungono solo
 * seguendo la catena: `lot_rounds` dipende dal lotto, `bids` dal round. È proprio
 * il pezzo di cascata che potrebbe rompersi senza che nessuno se ne accorga —
 * contarle passando dall'asta sarebbe un test che non guarda dove serve.
 */
async function leftovers(auctionId: string): Promise<Record<string, number>> {
  const lotIds = (
    await db.select({ id: lots.id }).from(lots).where(eq(lots.auctionId, auctionId))
  ).map((r) => r.id);

  const roundIds =
    lotIds.length === 0
      ? []
      : (
          await db
            .select({ id: lotRounds.id })
            .from(lotRounds)
            .where(inArray(lotRounds.lotId, lotIds))
        ).map((r) => r.id);

  const rows = async (
    query: Promise<{ length: number }>,
  ): Promise<number> => (await query).length;

  return {
    members: await rows(
      db
        .select({ id: members.id })
        .from(members)
        .where(eq(members.auctionId, auctionId)),
    ),
    players: await rows(
      db
        .select({ id: players.id })
        .from(players)
        .where(eq(players.auctionId, auctionId)),
    ),
    lots: lotIds.length,
    lotRounds: roundIds.length,
    bids:
      roundIds.length === 0
        ? 0
        : await rows(
            db
              .select({ id: bids.id })
              .from(bids)
              .where(inArray(bids.lotRoundId, roundIds)),
          ),
    assignments: await rows(
      db
        .select({ id: assignments.id })
        .from(assignments)
        .where(eq(assignments.auctionId, auctionId)),
    ),
    ledger: await rows(
      db
        .select({ id: ledger.id })
        .from(ledger)
        .where(eq(ledger.auctionId, auctionId)),
    ),
    invites: await rows(
      db
        .select({ token: invites.token })
        .from(invites)
        .where(eq(invites.auctionId, auctionId)),
    ),
    events: await rows(
      db
        .select({ id: events.id })
        .from(events)
        .where(eq(events.auctionId, auctionId)),
    ),
  };
}

// ─── Chi può forzare ─────────────────────────────────────────────────────────

suite("la strada forzata è solo dell'amministratore", () => {
  it.each(["LIVE", "PAUSED"] as const)(
    "un amministratore cancella un'asta %s con force",
    async (status) => {
      const admin = await user("admin", { isAdmin: true });
      const game = await liveGame(status);

      const result = await silently(() =>
        deleteAuction(admin, game.auctionId, { force: true }),
      );

      expect(result.ok).toBe(true);
      expect(
        await db.query.auctions.findFirst({
          where: eq(auctions.id, game.auctionId),
        }),
      ).toBeUndefined();
    },
  );

  it.each(["LIVE", "PAUSED"] as const)(
    "l'owner non forza un'asta %s, nemmeno la sua",
    async (status) => {
      const game = await liveGame(status);

      // ⚠ Anche chiedendo `force`: il permesso non è del proprietario. La sua
      // asta la stanno guardando altre undici persone.
      const result = await deleteAuction(game.ownerId, game.auctionId, {
        force: true,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("WRONG_STATUS");
        // Il messaggio glielo dice: non è un rifiuto muto.
        expect(result.error.message).toContain("amministratore");
      }
      expect(
        await db.query.auctions.findFirst({
          where: eq(auctions.id, game.auctionId),
        }),
      ).toBeDefined();
    },
  );

  it("un non-amministratore che chiede force non cancella niente", async () => {
    const intruder = await user("intruso");
    const game = await liveGame("LIVE");

    const result = await deleteAuction(intruder, game.auctionId, {
      force: true,
    });

    // Non arriva nemmeno alla questione dello stato: non è né owner né
    // amministratore, quindi è fuori prima.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
    expect(
      await db.query.auctions.findFirst({
        where: eq(auctions.id, game.auctionId),
      }),
    ).toBeDefined();
  });

  it("senza force, l'asta in corso è rifiutata anche all'amministratore", async () => {
    const admin = await user("admin", { isAdmin: true });
    const game = await liveGame("LIVE");

    const result = await deleteAuction(admin, game.auctionId);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WRONG_STATUS");
    expect(
      await db.query.auctions.findFirst({
        where: eq(auctions.id, game.auctionId),
      }),
    ).toBeDefined();
  });

  it("una simulata in pausa si cancella: è il vicolo cieco per cui M12 esiste", async () => {
    // ⚠ L'owner di una simulata è per forza un amministratore: `createAuction`
    // lo rilegge dal database (M4). Qui è la stessa persona che poi la cancella,
    // che è esattamente lo scenario del 2026-08-12.
    const admin = await user("admin", { isAdmin: true });
    const { auctionId } = unwrap(
      await createAuction(
        admin,
        { name: "Simulata in pausa", seats: 8 },
        true,
      ),
    );
    createdAuctions.push(auctionId);
    await db
      .update(auctions)
      .set({ status: "PAUSED", pausedAt: new Date() })
      .where(eq(auctions.id, auctionId));

    const result = await silently(() =>
      deleteAuction(admin, auctionId, { force: true }),
    );

    expect(result.ok).toBe(true);
    expect(
      await db.query.auctions.findFirst({ where: eq(auctions.id, auctionId) }),
    ).toBeUndefined();
  });
});

// ─── Cosa se ne va, e cosa resta ─────────────────────────────────────────────

suite("la cascata porta via l'asta e nient'altro", () => {
  it("spariscono tutte le righe dell'asta, e le righe di users sono ancora tutte lì", async () => {
    const admin = await user("admin", { isAdmin: true });
    const game = await liveGame("LIVE");

    // Un'asta con dentro qualcosa: un lotto giocato fino all'assegnazione.
    // Cancellare un'asta vuota non dimostrerebbe niente della cascata — e le
    // tabelle che contano (`assignments`, `ledger`, `bids`) sarebbero a zero
    // prima ancora di cominciare.
    const loaded = await loadForSnapshot(game.auctionId);
    const goalkeeper = loaded!.state.players.find((p) => p.role === "P")!;
    unwrap(
      await pickPlayer(
        game.userIds[0],
        game.auctionId,
        goalkeeper.id,
        game.t0 + 500,
      ),
    );
    unwrap(await placeBid(game.userIds[1], game.auctionId, 11, game.t0 + 600));
    unwrap(await placeBid(game.userIds[2], game.auctionId, 22, game.t0 + 700));
    // Scaduto il tempo delle buste il round si chiude, e l'assegnazione nasce.
    unwrap(await advancePhase(game.auctionId, game.t0 + 3500));
    // E una rettifica, perché il `ledger` altrimenti resterebbe vuoto: una
    // colonna a zero prima e zero dopo non dimostra nessuna cascata. In
    // `LOT_REVEAL` gli override sono ammessi (nessun lotto in contesa).
    unwrap(
      await adjustBudget(
        game.ownerId,
        game.auctionId,
        game.memberIds[3],
        5,
        "prova della cascata (M12)",
        game.t0 + 3600,
      ),
    );

    const before = await leftovers(game.auctionId);
    expect(before.members).toBeGreaterThan(0);
    expect(before.players).toBeGreaterThan(0);
    expect(before.lots).toBeGreaterThan(0);
    expect(before.lotRounds).toBeGreaterThan(0);
    expect(before.bids).toBeGreaterThan(0);
    expect(before.assignments).toBeGreaterThan(0);
    expect(before.ledger).toBeGreaterThan(0);
    expect(before.invites).toBeGreaterThan(0);
    expect(before.events).toBeGreaterThan(0);

    const everyone = [admin, game.ownerId, ...game.userIds];
    const result = await silently(() =>
      deleteAuction(admin, game.auctionId, { force: true }),
    );
    expect(result.ok).toBe(true);

    expect(await leftovers(game.auctionId)).toEqual({
      members: 0,
      players: 0,
      lots: 0,
      lotRounds: 0,
      bids: 0,
      assignments: 0,
      ledger: 0,
      invites: 0,
      events: 0,
    });

    // ⚠ **E gli utenti ci sono tutti**, uno per uno: nessuna tabella punta da
    // `auctions` verso `users` — è `members.user_id` che punta a `users`, e la
    // cascata va nell'altro senso. Questo è il test della frase «solo gli utenti
    // annessi non si cancellano».
    expect(await missingAmong(everyone)).toEqual([]);
  });

  it("le tabelle globali non le tocca: listone e insight sopravvivono alle aste", async () => {
    const admin = await user("admin", { isAdmin: true });
    const game = await liveGame("PAUSED");

    const listoneExtIds = async (): Promise<number[]> =>
      (
        await db.select({ extId: listonePlayers.extId }).from(listonePlayers)
      ).map((r) => r.extId);
    const insightExtIds = async (): Promise<number[]> =>
      (
        await db.select({ extId: playerInsights.extId }).from(playerInsights)
      ).map((r) => r.extId);

    const listoneBefore = await listoneExtIds();
    const insightsBefore = await insightExtIds();

    await silently(() => deleteAuction(admin, game.auctionId, { force: true }));

    // ⚠ **Le righe di prima ci sono ancora**, e non «il conteggio non è cambiato».
    //
    // Fino a M14 questa asserzione confrontava due `length`, con un commento che
    // diceva che qui il conteggio globale *è* la domanda giusta. La proprietà era
    // quella giusta, la misura no: `listone_players` e `player_insights` sono
    // tabelle **globali**, e `tests/db/listone.test.ts` e `tests/db/insights.test.ts`
    // ci scrivono dentro — girando in parallelo a questo file. Un `toBe(length)`
    // fallisce quando uno di quei due committa una riga nel mezzo, cioè a caso: il
    // rosso è comparso lavorando a M14 (che non tocca affatto queste tabelle) solo
    // perché un file di test in più ha cambiato l'ordine dei lavori.
    //
    // La domanda vera è «la cascata ha portato via qualcosa?», e a quella risponde
    // il **contenimento**: ogni riga che c'era prima c'è anche dopo. Righe in più
    // sono un altro test che lavora, righe in meno sono il bug.
    expect(await listoneExtIds()).toEqual(
      expect.arrayContaining(listoneBefore),
    );
    expect(await insightExtIds()).toEqual(
      expect.arrayContaining(insightsBefore),
    );
  });
});

// ─── Il congedo ──────────────────────────────────────────────────────────────

suite("il congedo raggiunge le connessioni aperte", () => {
  it("chi era collegato riceve l'evento terminale, e la mappa si svuota", async () => {
    const admin = await user("admin", { isAdmin: true });
    const game = await liveGame("LIVE");

    // L'hook è agganciato come fa `instrumentation.ts`, con la funzione vera: è
    // il pezzo che si vuole collaudare, non un finto che dice sempre di sì.
    setAuctionGoneHook((id, name) => closeAuctionStreams(id, name));

    const arrivati: Dismissal[] = [];
    subscribe(game.auctionId, {
      viewerMemberId: game.memberIds[0],
      send: () => {},
      dismiss: (d) => arrivati.push(d),
    });
    subscribe(game.auctionId, {
      viewerMemberId: null, // la TV: nessun viewer, stesso canale
      send: () => {},
      dismiss: (d) => arrivati.push(d),
    });
    expect(connectionCount(game.auctionId)).toBe(2);

    const result = await silently(() =>
      deleteAuction(admin, game.auctionId, { force: true }),
    );

    expect(result.ok).toBe(true);
    // Tutti e due, e ciascuno col nome dell'asta che non c'è più.
    expect(arrivati).toHaveLength(2);
    expect(new Set(arrivati.map((d) => d.auctionName))).toEqual(
      new Set([game.name]),
    );
    // Nessuno resta iscritto a un'asta che non esiste.
    expect(connectionCount(game.auctionId)).toBe(0);
    // E il numero torna al chiamante: è ciò che finisce nella riga di log e nel
    // messaggio del pannello.
    if (result.ok) expect(result.value.dismissed).toBe(2);
  });

  it("una connessione morta non impedisce il congedo alle altre", async () => {
    const admin = await user("admin", { isAdmin: true });
    const game = await liveGame("LIVE");
    setAuctionGoneHook((id, name) => closeAuctionStreams(id, name));

    const arrivati: Dismissal[] = [];
    subscribe(game.auctionId, {
      viewerMemberId: null,
      send: () => {},
      dismiss: () => {
        throw new Error("controller già chiuso");
      },
    });
    subscribe(game.auctionId, {
      viewerMemberId: game.memberIds[1],
      send: () => {},
      dismiss: (d) => arrivati.push(d),
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await silently(() =>
      deleteAuction(admin, game.auctionId, { force: true }),
    );
    errors.mockRestore();

    expect(result.ok).toBe(true);
    expect(arrivati).toHaveLength(1);
    // Le conta comunque entrambe: sono state congedate tutte e due, una l'ha
    // ricevuto e una era già andata via.
    if (result.ok) expect(result.value.dismissed).toBe(2);
  });

  it("la riga di log dice quante connessioni sono state congedate", async () => {
    const admin = await user("admin", { isAdmin: true });
    const game = await liveGame("LIVE");
    setAuctionGoneHook((id, name) => closeAuctionStreams(id, name));
    subscribe(game.auctionId, {
      viewerMemberId: game.memberIds[2],
      send: () => {},
      dismiss: () => {},
    });

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await deleteAuction(admin, game.auctionId, { force: true });
    const lines = log.mock.calls.map((c) => String(c[0]));
    log.mockRestore();

    const entry = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((e) => e.type === "DELETE_AUCTION");
    expect(entry).toBeDefined();
    // La differenza fra «ho buttato via una prova» e «ho interrotto una serata».
    expect(entry?.dismissed).toBe(1);
    expect(entry?.forced).toBe(true);
    expect(entry?.status).toBe("LIVE");
    expect(entry?.actor).toBe(admin);
  });

  it("senza nessuno collegato non congeda nessuno, e va bene così", async () => {
    const admin = await user("admin", { isAdmin: true });
    const game = await liveGame("PAUSED");
    setAuctionGoneHook((id, name) => closeAuctionStreams(id, name));

    const result = await silently(() =>
      deleteAuction(admin, game.auctionId, { force: true }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.dismissed).toBe(0);
  });
});
