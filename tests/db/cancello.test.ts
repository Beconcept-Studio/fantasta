import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { assignments, auctions, lots, members, players, users } from "@/lib/db/schema";
import {
  advancePhase,
  cancelLot,
  pauseAuction,
  pickPlayer,
  placeBid,
  showResults,
  startAuction,
} from "@/lib/engine/actions";
import { getAuctionLog } from "@/lib/engine/log";
import { setBroadcastHook } from "@/lib/engine/mutate";
import { manualAssign } from "@/lib/engine/override";
import { loadForSnapshot, serializeSnapshot } from "@/lib/engine/snapshot";
import { resetBroadcast } from "@/lib/realtime/broadcast";
import type { Snapshot } from "@/lib/realtime/types";

import { type GameAuction, makeGameAuction } from "./game-helpers";
import {
  closeDatabase,
  databaseAvailable,
  dropAuctions,
  dropUsers,
  sweeperFor,
} from "./helpers";

/**
 * M14 — **il cancello dei risultati, provato sul database e sulle tre uscite**.
 *
 * Questo file esiste per una verifica sola, e per capirla bisogna sapere cosa NON
 * bastava. Il modo ovvio di costruire il cancello era lasciare il motore come stava
 * — round chiuso, esito calcolato, assegnazione committata — e nascondere `reveal`
 * nello snapshot. Provato a mano il 2026-08-18: `reveal` e `tie` erano `null`, e
 * **l'esito si leggeva comunque**, perché `serializeMembers` calcola `credits`,
 * `maxBid`, `slotsFilled` e `roster` da `state.assignments`, e quei campi stanno in
 * ogni snapshot per tutti — TV compresa. Il vincitore scendeva di 87 crediti e la sua
 * rosa portava `price: 87`, cioè l'importo esatto della busta vincente.
 *
 * Quindi il test che conta non è «`reveal` è nullo»: quello passerebbe anche nel modo
 * sbagliato. È **«i crediti e la rosa del vincitore sono identici a prima della
 * chiusura del round»**, e si asserisce per tutti e tre gli spettatori.
 *
 * Gli snapshot si costruiscono con `serializeSnapshot` invece di aprire la rotta SSE:
 * `tests/db/i8.test.ts` copre già la strada HTTP per le tre uscite, e ciò che qui va
 * dimostrato è la sanificazione — che ha un punto solo (regola 3).
 */

const currentUser = vi.fn<() => Promise<{ id: string } | null>>();
vi.mock("@/lib/auth", () => ({ currentUser: () => currentUser() }));

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn("\n⚠ Postgres non raggiungibile: i test del cancello sono saltati.\n");
}

const createdAuctions: string[] = [];
const createdUsers: string[] = [];

beforeEach(() => {
  vi.useRealTimers();
  currentUser.mockResolvedValue(null);
});

afterEach(() => {
  resetBroadcast();
  setBroadcastHook(() => {});
});

afterAll(async () => {
  if (!dbUp) return;
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

/** Il cancello dell'asta di prova: dieci secondi. */
const GATE = 10;

type Sealed = GameAuction & {
  /** L'istante della chiusura del round. */
  closedAt: number;
  /** Il portiere in gara. */
  playerId: string;
  /** Chi vince, quando le buste si apriranno: il seat 2, a 87. */
  winnerMemberId: string;
  /** Lo snapshot **prima** della chiusura: il metro di paragone di §3. */
  before: Snapshot;
};

/**
 * Un lotto sigillato: owner che non gioca (⚠ P11), il seat 0 chiama, tre buste
 * diverse, il round si chiude e si entra nel cancello.
 */
async function sealedAuction(now = Date.now()): Promise<Sealed> {
  const game = await makeGameAuction({
    ownerPlays: false,
    config: { resultGateSeconds: GATE },
  });
  createdAuctions.push(game.auctionId);
  createdUsers.push(...game.userIds, game.ownerId);

  unwrap(await startAuction(game.ownerId, game.auctionId, 0, now));
  const loaded = (await loadForSnapshot(game.auctionId))!;
  const gk = loaded.state.players.find((p) => p.role === "P")!;

  unwrap(await pickPlayer(game.userIds[0], game.auctionId, gk.id, now + 100));
  unwrap(await placeBid(game.userIds[1], game.auctionId, 40, now + 200));
  unwrap(await placeBid(game.userIds[2], game.auctionId, 87, now + 300));

  // Lo snapshot di prima: nessuno ha ancora speso niente.
  const before = serializeSnapshot(
    (await loadForSnapshot(game.auctionId))!,
    null,
    now + 400,
  );

  // Il round scade. Da M14 questo **non** risolve.
  // ⚠ `makeGameAuction` ha `bidSeconds: 3` e il pick è a `now + 100`, quindi il
  // round chiude a `now + 3_100`: un `ADVANCE` prima di quell'istante è un no-op
  // guardato (I7) e il lotto resterebbe `LOT_OPEN` senza che niente si lamenti.
  const closedAt = now + 4_000;
  unwrap(await advancePhase(game.auctionId, closedAt));

  return {
    ...game,
    closedAt,
    playerId: gk.id,
    winnerMemberId: game.memberIds[2],
    before,
  };
}

/** Lo snapshot come lo vedrebbe quel viewer, adesso. */
async function snapshotFor(
  auctionId: string,
  viewerMemberId: string | null,
  now: number,
): Promise<Snapshot> {
  return serializeSnapshot(
    (await loadForSnapshot(auctionId))!,
    viewerMemberId,
    now,
  );
}

describe.runIf(dbUp)("M14 — I8 durante il cancello, sulle tre uscite", () => {
  it("⚠ né reveal né tie, e i crediti e la rosa del vincitore IDENTICI a prima", async () => {
    const game = await sealedAuction();
    const now = game.closedAt + 1_000;

    // I tre spettatori possibili. Il partecipante è uno che **non** ha offerto, come
    // in `i8.test.ts`: chi ha offerto vede legittimamente la propria cifra in
    // `myBid`, e mescolare i due casi renderebbe l'asserzione «nessun importo»
    // impossibile da scrivere in modo esatto. Che il proprio importo continui a
    // viaggiare lo prova il test qui sotto.
    const viste: Array<[string, Snapshot]> = [
      ["partecipante senza busta", await snapshotFor(game.auctionId, game.memberIds[4], now)],
      ["manager che non gioca", await snapshotFor(game.auctionId, null, now)],
      ["vista TV", await snapshotFor(game.auctionId, null, now)],
    ];

    for (const [chi, snap] of viste) {
      expect(snap.auction.phase, chi).toBe("LOT_SEALED");
      // Il pannello delle buste è muto…
      expect(snap.currentLot?.reveal, chi).toBeNull();
      expect(snap.currentLot?.tie, chi).toBeNull();

      // …e questo è il test che il modo ovvio NON avrebbe passato.
      const primaW = game.before.members.find((m) => m.id === game.winnerMemberId)!;
      const oraW = snap.members.find((m) => m.id === game.winnerMemberId)!;
      expect(oraW.credits, `${chi}: crediti`).toBe(primaW.credits);
      expect(oraW.maxBid, `${chi}: maxBid`).toBe(primaW.maxBid);
      expect(oraW.slotsFilled, `${chi}: slot`).toEqual(primaW.slotsFilled);
      expect(oraW.roster, `${chi}: rosa`).toEqual([]);

      // Nessun membro si è mosso: non c'è **nessuna** differenza da cui dedurre chi
      // ha vinto, che è ciò che rende il cancello un cancello e non una tendina.
      for (const prima of game.before.members) {
        const ora = snap.members.find((m) => m.id === prima.id)!;
        expect(ora.credits, `${chi}: crediti di ${prima.teamName}`).toBe(prima.credits);
        expect(ora.roster, `${chi}: rosa di ${prima.teamName}`).toEqual(prima.roster);
      }

      // E nessun importo compare da nessuna parte del payload. Si confrontano i
      // **nomi dei campi** e non le cifre: un `not.toContain("87")` passerebbe o
      // fallirebbe a seconda dei millisecondi dentro `serverNow`, che è il modo
      // peggiore di fallire.
      const testo = JSON.stringify(snap);
      expect(testo, chi).not.toContain('"amount"');
      // `price` vive solo dentro `roster` e `reveal`: durante il cancello non
      // dovrebbe esistere nessuno dei due.
      expect(testo, chi).not.toContain('"price"');
    }
  });

  it("il proprio importo continua a viaggiare: è il proprio", async () => {
    const game = await sealedAuction();
    const mio = await snapshotFor(
      game.auctionId,
      game.memberIds[1],
      game.closedAt + 1_000,
    );
    // `myBid` c'è in ogni fase, cancello compreso: la propria busta si è sempre
    // potuta rileggere, ed è ciò che permette a chi rientra di sapere cosa aveva
    // offerto.
    expect(mio.myBid?.amount).toBe(40);
    expect(mio.currentLot?.reveal).toBeNull();
  });

  it("a database il lotto è ancora OPEN e non esiste nessuna assegnazione", async () => {
    const game = await sealedAuction();

    const [row] = await db
      .select()
      .from(lots)
      .where(eq(lots.auctionId, game.auctionId));
    expect(row.status).toBe("OPEN");
    expect(row.winnerMemberId).toBeNull();
    expect(row.finalPrice).toBeNull();
    expect(row.resolvedAt).toBeNull();
    // Il round è chiuso: nessuna offerta nuova entra più.
    expect(row.currentRound).toBe(1);

    const assegnate = await db
      .select()
      .from(assignments)
      .where(eq(assignments.auctionId, game.auctionId));
    expect(assegnate).toHaveLength(0);
  });

  it("«Mostra risultati» apre le buste, e premuto due volte non fa niente", async () => {
    const game = await sealedAuction();
    const premuto = game.closedAt + 2_000;

    unwrap(await showResults(game.ownerId, game.auctionId, premuto));
    const dopo = await snapshotFor(game.auctionId, null, premuto + 10);
    expect(dopo.auction.phase).toBe("LOT_REVEAL");
    expect(dopo.currentLot?.reveal?.winnerMemberId).toBe(game.winnerMemberId);
    expect(dopo.currentLot?.reveal?.price).toBe(87);
    // Ora sì: i crediti si muovono, insieme alle buste, per tutti nello stesso
    // snapshot.
    const w = dopo.members.find((m) => m.id === game.winnerMemberId)!;
    expect(w.credits).toBe(100 - 87);
    expect(w.roster.map((r) => r.playerId)).toEqual([game.playerId]);

    // Il secondo click trova la guardia del motore.
    const ancora = await showResults(game.ownerId, game.auctionId, premuto + 20);
    expect(ancora.ok).toBe(false);
    if (!ancora.ok) expect(ancora.error.code).toBe("WRONG_PHASE");
  });

  it("solo l'owner apre le buste: a un partecipante il server dice no", async () => {
    const game = await sealedAuction();
    const rifiutato = await showResults(
      game.userIds[1],
      game.auctionId,
      game.closedAt + 1_000,
    );
    expect(rifiutato.ok).toBe(false);
    if (!rifiutato.ok) expect(rifiutato.error.code).toBe("FORBIDDEN");
    // E l'asta non si è mossa di un millimetro.
    const snap = await snapshotFor(game.auctionId, null, game.closedAt + 1_100);
    expect(snap.auction.phase).toBe("LOT_SEALED");
  });

  it("⚠ gli override sono rifiutati durante il cancello, col messaggio che c'è già", async () => {
    const game = await sealedAuction();
    const loaded = (await loadForSnapshot(game.auctionId))!;
    const altro = loaded.state.players.find(
      (p) => p.role === "D" && p.id !== game.playerId,
    )!;

    // È il presupposto di «Annulla lotto», non una precauzione: se una
    // `manualAssign` potesse riempire il ruolo del chiamante qui, il ritorno del
    // turno non sarebbe più sicuro.
    for (const status of ["LIVE", "PAUSED"] as const) {
      if (status === "PAUSED") {
        unwrap(await pauseAuction(game.ownerId, game.auctionId, game.closedAt + 500));
      }
      const rifiutato = await manualAssign(
        game.ownerId,
        game.auctionId,
        { memberId: game.memberIds[0], playerId: altro.id, price: 5 },
        game.closedAt + 600,
      );
      expect(rifiutato.ok, status).toBe(false);
      if (!rifiutato.ok) {
        expect(rifiutato.error.code, status).toBe("WRONG_PHASE");
        expect(rifiutato.error.message, status).toMatch(/contesa/i);
      }
    }
  });
});

describe.runIf(dbUp)("M14 — «Annulla lotto» sul database", () => {
  /** Un lotto sigillato con l'asta in pausa: l'unico posto da cui si annulla. */
  async function pausedSealed(): Promise<Sealed & { pausedAt: number }> {
    const game = await sealedAuction();
    const pausedAt = game.closedAt + 1_000;
    unwrap(await pauseAuction(game.ownerId, game.auctionId, pausedAt));
    return { ...game, pausedAt };
  }

  it("il lotto è VOIDED, senza vincitore né prezzo, e nessuna assegnazione esiste", async () => {
    const game = await pausedSealed();
    unwrap(await cancelLot(game.ownerId, game.auctionId, game.pausedAt + 2_000));

    const [row] = await db
      .select()
      .from(lots)
      .where(eq(lots.auctionId, game.auctionId));
    expect(row.status).toBe("VOIDED");
    // ⚠ **Mai `RESOLVED`**: `isPublicLot` equipara quello status a «le buste sono
    // già state pubbliche», e queste non lo sono mai state.
    expect(row.status).not.toBe("RESOLVED");
    expect(row.winnerMemberId).toBeNull();
    expect(row.finalPrice).toBeNull();
    expect(row.resolvedAt).toBeNull();

    // Nessuna assegnazione creata, e quindi nessuna da annullare: la regola 5 non
    // viene sfiorata (§3a).
    const assegnate = await db
      .select()
      .from(assignments)
      .where(eq(assignments.auctionId, game.auctionId));
    expect(assegnate).toHaveLength(0);
  });

  it("le offerte restano in tabella, e i crediti di tutti sono quelli di prima", async () => {
    const game = await pausedSealed();
    unwrap(await cancelLot(game.ownerId, game.auctionId, game.pausedAt + 2_000));

    const loaded = (await loadForSnapshot(game.auctionId))!;
    const lot = loaded.state.lots[0];
    // Il verbale resta: tre buste, il round, l'eligibility. Semplicemente non
    // diventano mai pubbliche.
    expect(lot.rounds).toHaveLength(1);
    expect(lot.rounds[0].bids.map((b) => b.amount).sort((a, b) => a - b)).toEqual([
      1, 40, 87,
    ]);
    expect(lot.rounds[0].closedAt).not.toBeNull();

    const snap = serializeSnapshot(loaded, null, game.pausedAt + 2_100);
    for (const prima of game.before.members) {
      const ora = snap.members.find((m) => m.id === prima.id)!;
      expect(ora.credits, prima.teamName).toBe(prima.credits);
      expect(ora.roster, prima.teamName).toEqual([]);
    }
  });

  it("il turno torna al chiamante e il giocatore è di nuovo chiamabile", async () => {
    const game = await pausedSealed();
    unwrap(await cancelLot(game.ownerId, game.auctionId, game.pausedAt + 2_000));

    const dopo = await snapshotFor(game.auctionId, null, game.pausedAt + 2_100);
    expect(dopo.auction.phase).toBe("WAITING_PICK");
    expect(dopo.auction.status).toBe("PAUSED");
    // Il chiamante era il seat 0, e il turno torna a lui: la rotazione va indietro.
    expect(dopo.auction.currentSeatIndex).toBe(0);
    expect(dopo.auction.currentMemberId).toBe(game.memberIds[0]);
    expect(dopo.auction.currentRole).toBe("P");
    expect(dopo.currentLot).toBeNull();

    // E il giocatore è chiamabile davvero: lo si richiama.
    const { resumeAuction } = await import("@/lib/engine/actions");
    const resumedAt = game.pausedAt + 3_000;
    unwrap(await resumeAuction(game.ownerId, game.auctionId, resumedAt));
    unwrap(
      await pickPlayer(
        game.userIds[0],
        game.auctionId,
        game.playerId,
        resumedAt + 100,
      ),
    );

    const rows = await db
      .select()
      .from(lots)
      .where(eq(lots.auctionId, game.auctionId))
      .orderBy(asc(lots.seq));
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe("VOIDED");
    expect(rows[1].status).toBe("OPEN");
    expect(rows[1].playerId).toBe(game.playerId);
    // ⚠ L'indice parziale `one_open_lot_per_auction` non si è opposto: `VOIDED` non
    // è `OPEN`, quindi il lotto vecchio è uscito dall'indice.
  });

  it("utenti, membri e listone restano intatti: si butta un lotto, non dei dati", async () => {
    const game = await pausedSealed();
    // ⚠ Tutto **legato a quest'asta**, mai conteggi globali: i file di test girano
    // in parallelo e creano utenti loro, quindi un `count(*)` su `users` sarebbe un
    // test che passa o fallisce a seconda di chi altro sta girando.
    const miei = [...game.userIds, game.ownerId];
    const primaPlayers = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.auctionId, game.auctionId));

    unwrap(await cancelLot(game.ownerId, game.auctionId, game.pausedAt + 2_000));

    const dopoPlayers = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.auctionId, game.auctionId));
    expect(dopoPlayers).toHaveLength(primaPlayers.length);

    const dopoUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, miei));
    expect(dopoUsers).toHaveLength(miei.length);

    // E gli otto seat sono ancora al loro posto: annullare un lotto non tocca chi
    // gioca.
    const dopoMembers = await db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.auctionId, game.auctionId));
    expect(dopoMembers).toHaveLength(game.memberIds.length);
  });

  it("⚠ lo storico non pubblica le offerte di un lotto annullato", async () => {
    const game = await pausedSealed();
    unwrap(await cancelLot(game.ownerId, game.auctionId, game.pausedAt + 2_000));

    const log = unwrap(await getAuctionLog(game.ownerId, game.auctionId));

    // Il lotto non compare fra i lotti: non è `RESOLVED`, e `isPublicLot` è la
    // barriera. Non va «sistemato» dando `RESOLVED` a un lotto annullato.
    expect(log.lots).toHaveLength(0);
    // E la pagina non porta **nessuna struttura di busta**: né i round, né gli
    // importi. Si confrontano i nomi dei campi e non le cifre, perché un `40` come
    // sottostringa vive anche dentro un uuid o un timestamp — un test che passa o
    // fallisce a seconda dei millisecondi è peggio di nessun test.
    const testo = JSON.stringify(log);
    expect(testo).not.toContain('"bids"');
    expect(testo).not.toContain('"amount"');
    expect(testo).not.toContain('"rounds"');
    expect(testo).not.toContain('"price"');

    // La riga di log invece c'è, e nomina i due fatti che l'operazione cambia.
    const riga = log.events.find((e) => e.text.includes("Lotto annullato"));
    expect(riga).toBeDefined();
    expect(riga!.text).toContain("Giocatore 1"); // il portiere migliore
    expect(riga!.text).toContain("Squadra 0"); // chi l'aveva chiamato
    // Il nome di chi ha agito: in una disputa «chi» è metà della domanda.
    expect(riga!.actorName).not.toBeNull();
  });

  it("solo l'owner annulla, e solo dal cancello a asta in pausa", async () => {
    const game = await sealedAuction();

    // Asta in corso, dentro il cancello: no. Annullare mentre il countdown corre
    // sarebbe una corsa con il proprio timer.
    const liveNo = await cancelLot(game.ownerId, game.auctionId, game.closedAt + 500);
    expect(liveNo.ok).toBe(false);
    if (!liveNo.ok) expect(liveNo.error.code).toBe("WRONG_PHASE");

    // In pausa, ma da un partecipante: no.
    const pausedAt = game.closedAt + 1_000;
    unwrap(await pauseAuction(game.ownerId, game.auctionId, pausedAt));
    const nonOwner = await cancelLot(game.userIds[1], game.auctionId, pausedAt + 100);
    expect(nonOwner.ok).toBe(false);
    if (!nonOwner.ok) expect(nonOwner.error.code).toBe("FORBIDDEN");

    // Il lotto è ancora lì, ancora OPEN.
    const [row] = await db
      .select()
      .from(lots)
      .where(eq(lots.auctionId, game.auctionId));
    expect(row.status).toBe("OPEN");
  });
});

describe.runIf(dbUp)("M14 — un crash dentro il cancello non cambia il vincitore", () => {
  /**
   * ⚠ **La proprietà che questa macro rimanda di X secondi, e che va provata invece
   * che raccontata** (§3c).
   *
   * Prima di M14 l'assegnazione era committata all'ingresso del reveal di proposito:
   * «un crash durante il reveal non deve poter perdere un lotto già deciso». Il
   * cancello mette davanti a quella proprietà una finestra in cui il lotto è deciso
   * **dalle offerte** ma non committato. Non è una perdita, e la ragione è che
   * l'esito non è un dato ma una funzione: le offerte sono righe a database,
   * `resolveRound` è pura, e al primo `ADVANCE` successivo gli stessi bit producono
   * la stessa risposta.
   *
   * Il crash si simula in due mosse, e l'ordine conta: si sigilla un lotto con la
   * scadenza del cancello **nel futuro**, poi si retrodata quella scadenza a mano.
   * Il risultato è un'asta `LIVE` con la deadline già passata e **nessun timer
   * armato** — in questo processo non c'è nessuno scheduler attivo, che è
   * precisamente la situazione di un processo appena riavviato. L'unica cosa che la
   * fa ripartire è lo `sweep`, cioè il boot recovery.
   *
   * ⚠ **Perché il retrodatare viene dopo, e non si passa un `now` nel passato.**
   * `sweep()` è **globale**: interroga tutte le aste `LIVE` con la deadline scaduta,
   * e i file di test girano in parallelo — `tests/db/scheduler.test.ts` ne ha uno con
   * l'`advance` vero. Un'asta lasciata `LIVE` e già scaduta per il tempo del setup è
   * un'asta che un altro file può far avanzare, e questo test è diventato rosso una
   * volta su sei prima di essere scritto così. Retrodatando all'ultimo istante la
   * finestra si chiude.
   *
   * ⚠ E per la stessa ragione **non si asserisce su `trovate`**: quale sweep abbia
   * pescato l'asta non è una proprietà nostra. Ciò che è nostro è l'**esito**, e le
   * asserzioni qui sotto valgono qualunque sia lo sweep che ha risolto — che è
   * esattamente la proprietà sotto esame: gli stessi bit producono la stessa
   * risposta, chiunque prema.
   */
  it("il boot recovery risolve lo stesso lotto allo stesso modo", async () => {
    const crashed = await sealedAuction();

    // Lo stesso scenario, con il cancello spento: è il metro di paragone.
    const control = await makeGameAuction({
      ownerPlays: false,
      config: { resultGateSeconds: 0 },
    });
    createdAuctions.push(control.auctionId);
    createdUsers.push(...control.userIds, control.ownerId);
    const c0 = Date.now();
    unwrap(await startAuction(control.ownerId, control.auctionId, 0, c0));
    const cLoaded = (await loadForSnapshot(control.auctionId))!;
    const cGk = cLoaded.state.players.find((p) => p.role === "P")!;
    unwrap(await pickPlayer(control.userIds[0], control.auctionId, cGk.id, c0 + 100));
    unwrap(await placeBid(control.userIds[1], control.auctionId, 40, c0 + 200));
    unwrap(await placeBid(control.userIds[2], control.auctionId, 87, c0 + 300));
    unwrap(await advancePhase(control.auctionId, c0 + 4_000));

    // Prima del recovery: il lotto sigillato è ancora indeciso. Deterministico,
    // perché la sua deadline è ancora nel futuro e nessuno sweep la guarda.
    const [prima] = await db.select().from(lots).where(eq(lots.auctionId, crashed.auctionId));
    expect(prima.status).toBe("OPEN");
    expect(prima.winnerMemberId).toBeNull();

    // ── Il processo era giù mentre il cancello scadeva ──
    await db
      .update(auctions)
      .set({ phaseDeadline: new Date(Date.now() - 30_000) })
      .where(eq(auctions.id, crashed.auctionId));

    // ── E riparte: nessun `setTimeout` sopravvissuto, solo lo sweep ──
    const scheduler = sweeperFor(crashed.auctionId);
    await scheduler.sweep();
    scheduler.stop();

    const [dopo] = await db.select().from(lots).where(eq(lots.auctionId, crashed.auctionId));
    const [atteso] = await db.select().from(lots).where(eq(lots.auctionId, control.auctionId));

    // Lo stesso vincitore e lo stesso prezzo, per seat: gli id dei membri sono
    // diversi fra le due aste, la posizione al tavolo no.
    expect(dopo.status).toBe("RESOLVED");
    expect(dopo.finalPrice).toBe(atteso.finalPrice);
    expect(dopo.winnerMemberId).toBe(crashed.memberIds[2]);
    expect(atteso.winnerMemberId).toBe(control.memberIds[2]);

    // E l'assegnazione esiste, con lo stesso prezzo: il lotto non si è perso.
    const assegnate = await db
      .select()
      .from(assignments)
      .where(eq(assignments.auctionId, crashed.auctionId));
    expect(assegnate).toHaveLength(1);
    expect(assegnate[0].price).toBe(87);
    expect(assegnate[0].memberId).toBe(crashed.memberIds[2]);
  });

  /**
   * ⚠ **Il cancello si può tenere fermo quanto serve**, e questa è la proprietà che
   * rende utile «Metti in pausa» durante il cancello: la deadline scade, e nessuno la
   * fa scattare.
   *
   * L'ordine è quello dell'altro test e per la stessa ragione: prima si mette in
   * pausa, **poi** si retrodata la scadenza. Così l'asta non è mai `LIVE` e scaduta
   * insieme, e nessuno sweep di nessun altro file può pescarla — che è anche il modo
   * di far dire a questo test una cosa sola invece di due.
   */
  it("⚠ lo sweep non tocca un'asta in pausa: il cancello resta sigillato", async () => {
    const game = await sealedAuction();
    unwrap(await pauseAuction(game.ownerId, game.auctionId, game.closedAt + 1_000));

    // La scadenza del cancello è passata da mezzo minuto, e l'asta è ferma.
    await db
      .update(auctions)
      .set({ phaseDeadline: new Date(Date.now() - 30_000) })
      .where(eq(auctions.id, game.auctionId));

    const scheduler = sweeperFor(game.auctionId);
    const trovate = await scheduler.sweep();
    scheduler.stop();

    // Lo sweep cerca `status = 'LIVE'`: un'asta in pausa non è sua.
    expect(trovate).not.toContain(game.auctionId);
    const [row] = await db.select().from(lots).where(eq(lots.auctionId, game.auctionId));
    expect(row.status).toBe("OPEN");
    expect(row.winnerMemberId).toBeNull();
    // E nessuna assegnazione è nata nel frattempo.
    const assegnate = await db
      .select()
      .from(assignments)
      .where(eq(assignments.auctionId, game.auctionId));
    expect(assegnate).toHaveLength(0);
  });
});
