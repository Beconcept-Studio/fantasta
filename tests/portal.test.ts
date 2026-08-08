import { describe, expect, it } from "vitest";

import {
  amInTie,
  availablePlayers,
  bidBounds,
  canWithdraw,
  checkAmount,
  countdownLabel,
  envelopes,
  parseAmount,
  pausedRemaining,
  portalScreen,
  shouldOpenBidDialog,
  takenPlayerIds,
} from "@/lib/realtime/portal";
import type {
  PoolPlayer,
  Snapshot,
  SnapshotLot,
  SnapshotMember,
} from "@/lib/realtime/types";

/**
 * Fase 5 — le funzioni pure del portale.
 *
 * Sono la traduzione in test della regola 7: se ogni schermata è funzione dello
 * snapshot, allora i cinque casi di rientro di §8bis (F5-13) si provano
 * costruendo lo snapshot di quel momento e chiedendo alla funzione quale
 * schermata mostrerebbe — senza browser, senza kill del tab, in millisecondi.
 * Il collaudo a mano sui browser veri resta (è il gate di fase), ma non è più
 * l'unico posto in cui questa logica viene esercitata.
 */

const T = Date.parse("2026-08-07T20:00:00.000Z");
const iso = (offsetMs: number) => new Date(T + offsetMs).toISOString();

const ME = "member-me";
const OTHER = "member-other";
const THIRD = "member-third";

function member(id: string, seatIndex: number, patch: Partial<SnapshotMember> = {}): SnapshotMember {
  return {
    id,
    teamName: `Squadra ${seatIndex + 1}`,
    displayName: null,
    seatIndex,
    credits: 500,
    maxBid: 476,
    slotsFilled: { P: 0, D: 0, C: 0, A: 0 },
    presence: "LIVE",
    roster: [],
    ...patch,
  };
}

function lot(patch: Partial<SnapshotLot> = {}): SnapshotLot {
  return {
    id: "lot-1",
    seq: 1,
    player: { id: "player-1", name: "Lautaro", role: "A", team: "Inter", fvm: 300 },
    calledByMemberId: OTHER,
    autoCalled: false,
    roundNo: 1,
    minAmount: 1,
    endsAt: iso(30_000),
    closedAt: null,
    eligibleMemberIds: [ME, OTHER, THIRD],
    bidStatus: [
      { memberId: ME, hasBid: false, withdrawn: false },
      { memberId: OTHER, hasBid: true, withdrawn: false },
      { memberId: THIRD, hasBid: false, withdrawn: false },
    ],
    tie: null,
    reveal: null,
    ...patch,
  };
}

function snapshot(patch: Partial<Snapshot> = {}): Snapshot {
  return {
    serverNow: iso(0),
    stateVersion: 12,
    viewerMemberId: ME,
    auction: {
      id: "auction-1",
      name: "Asta di prova",
      status: "LIVE",
      phase: "LOT_OPEN",
      phaseDeadline: iso(30_000),
      pausedAt: null,
      currentRole: "A",
      currentSeatIndex: 1,
      currentMemberId: OTHER,
      roleOrder: ["P", "D", "C", "A"],
      seats: 8,
      slots: { P: 3, D: 8, C: 8, A: 6 },
      timers: { bidSeconds: 30, pickSeconds: 60, tiePrepSeconds: 5, revealSeconds: 10 },
      ...patch.auction,
    },
    members: [member(ME, 0), member(OTHER, 1), member(THIRD, 2)],
    currentLot: lot(),
    myBid: null,
    ...patch,
  };
}

// ─── Countdown (F5-03) ───────────────────────────────────────────────────────

describe("countdown", () => {
  it("arrotonda per eccesso: a 0,4s dalla fine dice ancora 1s", () => {
    expect(countdownLabel(400)).toBe("1s");
  });

  it("a zero dice «in chiusura…» e non decide niente (regola 1)", () => {
    expect(countdownLabel(0)).toBe("in chiusura…");
  });

  it("oltre il minuto passa a m:ss — il pick può durare 90 secondi", () => {
    expect(countdownLabel(90_000)).toBe("1:30");
    expect(countdownLabel(60_000)).toBe("1:00");
    expect(countdownLabel(59_000)).toBe("59s");
  });

  it("senza scadenza non c'è countdown", () => {
    expect(countdownLabel(null)).toBe("—");
  });

  it("in pausa il residuo è quello dell'istante della pausa, non scorre", () => {
    // Scadenza fra 30s, pausa scattata 12s dopo l'apertura: restano 18s, e
    // restano 18s anche fra dieci minuti di pausa.
    expect(pausedRemaining(iso(30_000), iso(12_000))).toBe(18_000);
    expect(pausedRemaining(iso(30_000), null)).toBeNull();
  });
});

// ─── I cinque rientri di §8bis (F5-13) ───────────────────────────────────────

describe("§8bis — la schermata è funzione dello snapshot", () => {
  it("rientro durante LOT_OPEN: la card del lotto, con l'offerta già salvata", () => {
    const s = snapshot({ myBid: { amount: 42, amountSetAt: iso(-5_000), withdrawnAt: null } });
    expect(portalScreen(s, ME)).toEqual({ kind: "LOT", frozen: false });
    // L'offerta precompilata arriva dallo snapshot, non da un evento perso.
    expect(s.myBid?.amount).toBe(42);
    expect(shouldOpenBidDialog(s, ME, null)).toBe(true);
  });

  it("rientro durante LOT_TIE_PREP: la card, e si sa se si è fra i pareggianti", () => {
    const s = snapshot({
      auction: { ...snapshot().auction, phase: "LOT_TIE_PREP", phaseDeadline: iso(5_000) },
      currentLot: lot({ tie: { amount: 40, memberIds: [ME, THIRD] }, closedAt: iso(0) }),
    });
    expect(portalScreen(s, ME)).toEqual({ kind: "LOT", frozen: false });
    expect(amInTie(s, ME)).toBe(true);
    expect(amInTie(s, OTHER)).toBe(false);
    // Nessun modale durante la preparazione: non c'è un round aperto.
    expect(shouldOpenBidDialog(s, ME, null)).toBe(false);
  });

  it("rientro durante LOT_REVEAL: il pannello dei risultati per il tempo residuo", () => {
    const s = snapshot({
      auction: { ...snapshot().auction, phase: "LOT_REVEAL", phaseDeadline: iso(10_000) },
      currentLot: lot({
        closedAt: iso(0),
        reveal: {
          winnerMemberId: THIRD,
          price: 55,
          rounds: [
            {
              roundNo: 1,
              minAmount: 1,
              bids: [
                { memberId: OTHER, amount: 1, amountSetAt: iso(-30_000), withdrawnAt: null },
                { memberId: THIRD, amount: 55, amountSetAt: iso(-10_000), withdrawnAt: null },
              ],
            },
          ],
        },
      }),
    });
    expect(portalScreen(s, ME)).toEqual({ kind: "LOT", frozen: false });
    expect(s.currentLot?.reveal?.winnerMemberId).toBe(THIRD);
    expect(shouldOpenBidDialog(s, ME, null)).toBe(false);
  });

  it("rientro a turno scaduto: mai una schermata di chiamata fantasma", () => {
    // Il mio turno era il mio, il timer è scaduto mentre ero offline, l'auto-pick
    // è già avvenuto: la fase è LOT_OPEN e il lotto ha `autoCalled`.
    const s = snapshot({
      auction: { ...snapshot().auction, currentSeatIndex: 0, currentMemberId: ME },
      currentLot: lot({ autoCalled: true, calledByMemberId: ME }),
      myBid: { amount: 1, amountSetAt: iso(0), withdrawnAt: null },
    });
    expect(portalScreen(s, ME).kind).toBe("LOT");
    expect(s.currentLot?.autoCalled).toBe(true);
    // L'auto-bid a 1 è già a database, e si vede.
    expect(s.myBid?.amount).toBe(1);
  });

  it("rientro a status PAUSED: lo stato congelato, non una pagina bianca", () => {
    const s = snapshot({
      auction: { ...snapshot().auction, status: "PAUSED", pausedAt: iso(-2_000) },
    });
    expect(portalScreen(s, ME)).toEqual({ kind: "LOT", frozen: true });
    // In pausa il server rifiuta le offerte: nessun modale che finge di poter salvare.
    expect(shouldOpenBidDialog(s, ME, null)).toBe(false);
    expect(canWithdraw(s, ME)).toBe(false);
  });
});

describe("le altre schermate", () => {
  it("prima dell'avvio non c'è portale di gioco", () => {
    const s = snapshot({
      auction: { ...snapshot().auction, status: "READY", phase: null, phaseDeadline: null },
      currentLot: null,
    });
    expect(portalScreen(s, ME).kind).toBe("NOT_STARTED");
  });

  it("WAITING_PICK sul mio seat è la schermata di chiamata", () => {
    const s = snapshot({
      auction: {
        ...snapshot().auction,
        phase: "WAITING_PICK",
        currentSeatIndex: 0,
        currentMemberId: ME,
        phaseDeadline: iso(60_000),
      },
      currentLot: null,
    });
    expect(portalScreen(s, ME).kind).toBe("PICK_MINE");
    expect(portalScreen(s, OTHER).kind).toBe("PICK_WAIT");
  });

  it("ad asta finita si guardano le rose", () => {
    const s = snapshot({
      auction: { ...snapshot().auction, status: "COMPLETED", phase: null },
      currentLot: null,
    });
    expect(portalScreen(s, ME).kind).toBe("COMPLETED");
  });
});

// ─── Il modale (F5-05) ───────────────────────────────────────────────────────

describe("apertura del modale", () => {
  it("si apre da sé a lotto aperto se sono idoneo", () => {
    expect(shouldOpenBidDialog(snapshot(), ME, null)).toBe(true);
  });

  it("chiuso, non si riapre per lo stesso lotto", () => {
    expect(shouldOpenBidDialog(snapshot(), ME, "lot-1")).toBe(false);
  });

  it("al lotto successivo si riapre da solo", () => {
    const s = snapshot({ currentLot: lot({ id: "lot-2" }) });
    expect(shouldOpenBidDialog(s, ME, "lot-1")).toBe(true);
  });

  it("chi non è idoneo non se lo vede aprire", () => {
    const s = snapshot({
      currentLot: lot({
        eligibleMemberIds: [OTHER, THIRD],
        bidStatus: [
          { memberId: OTHER, hasBid: true, withdrawn: false },
          { memberId: THIRD, hasBid: false, withdrawn: false },
        ],
      }),
    });
    expect(shouldOpenBidDialog(s, ME, null)).toBe(false);
  });
});

// ─── Confini dell'offerta (F5-06) ────────────────────────────────────────────

describe("confini dell'offerta", () => {
  it("nel round 1 si parte da 1 e si arriva a max_bid", () => {
    expect(bidBounds(snapshot(), ME)).toEqual({ min: 1, max: 476 });
  });

  it("nello spareggio il minimo è l'importo pareggiato", () => {
    const s = snapshot({ currentLot: lot({ roundNo: 2, minAmount: 40 }) });
    expect(bidBounds(s, ME)?.min).toBe(40);
    expect(checkAmount(39, bidBounds(s, ME))).toMatch(/spareggio si parte da 40/);
    expect(checkAmount(40, bidBounds(s, ME))).toBeNull();
  });

  it("sopra max_bid il messaggio dice perché, non «errore»", () => {
    const bounds = { min: 1, max: 12 };
    expect(checkAmount(13, bounds)).toMatch(/al massimo 12/);
    expect(checkAmount(12, bounds)).toBeNull();
  });

  it("un campo vuoto o sporco non è un'offerta", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("12,5")).toBeNull();
    expect(parseAmount(" 12 ")).toBe(12);
    expect(checkAmount(null, { min: 1, max: 10 })).toMatch(/numero intero/);
  });
});

// ─── Ritiro (F5-07) ──────────────────────────────────────────────────────────

describe("ritiro", () => {
  const withMyBid = (patch: Partial<Snapshot> = {}) =>
    snapshot({ myBid: { amount: 30, amountSetAt: iso(-3_000), withdrawnAt: null }, ...patch });

  it("si può ritirare un'offerta propria nel round 1", () => {
    expect(canWithdraw(withMyBid(), ME)).toBe(true);
  });

  it("il chiamante non può ritirare: può solo rilanciare", () => {
    const s = withMyBid({ currentLot: lot({ calledByMemberId: ME }) });
    expect(canWithdraw(s, ME)).toBe(false);
  });

  it("nello spareggio il ritiro non esiste", () => {
    const s = withMyBid({ currentLot: lot({ roundNo: 2, minAmount: 30 }) });
    expect(canWithdraw(s, ME)).toBe(false);
  });

  it("senza un'offerta non c'è niente da ritirare", () => {
    expect(canWithdraw(snapshot(), ME)).toBe(false);
  });

  it("il ritiro è definitivo: non si ritira due volte ⚠ P10", () => {
    const s = snapshot({
      myBid: { amount: 30, amountSetAt: iso(-3_000), withdrawnAt: iso(-1_000) },
    });
    expect(canWithdraw(s, ME)).toBe(false);
  });
});

// ─── Le buste degli altri (I8) ───────────────────────────────────────────────

describe("buste degli altri", () => {
  it("degli idonei si sa solo se hanno consegnato, in ordine di seat", () => {
    const rows = envelopes(snapshot(), ME);
    expect(rows.map((r) => [r.member.id, r.hasBid, r.isMe])).toEqual([
      [ME, false, true],
      [OTHER, true, false],
      [THIRD, false, false],
    ]);
    // La riga non ha nessun campo con un importo: I8 vale anche in memoria.
    expect(Object.keys(rows[0])).toEqual(["member", "hasBid", "withdrawn", "isMe"]);
  });
});

// ─── La chiamata (F5-10) ─────────────────────────────────────────────────────

describe("giocatori chiamabili", () => {
  const pool: PoolPlayer[] = [
    { id: "p1", name: "Lautaro", team: "Inter", role: "A", fvm: 300, quot: 30 },
    { id: "p2", name: "Vlahovic", team: "Juventus", role: "A", fvm: 250, quot: 28 },
    { id: "p3", name: "Zaccagni", team: "Lazio", role: "C", fvm: 200, quot: 20 },
    { id: "p4", name: "Retegui", team: "Atalanta", role: "A", fvm: 250, quot: 29 },
  ];

  const conRose = snapshot({
    members: [
      member(ME, 0, {
        roster: [{ playerId: "p2", name: "Vlahovic", role: "A", team: "Juventus", price: 80 }],
      }),
      member(OTHER, 1),
      member(THIRD, 2),
    ],
  });

  it("esclude chi è già in una rosa e chi non è del ruolo corrente", () => {
    expect(availablePlayers(pool, conRose, "A").map((p) => p.id)).toEqual([
      "p1",
      "p4",
    ]);
  });

  it("ordina come l'auto-pick: fvm, poi quot", () => {
    // p4 e p2 hanno lo stesso fvm; senza rose assegnate vince la quot più alta.
    expect(availablePlayers(pool, snapshot(), "A").map((p) => p.id)).toEqual([
      "p1",
      "p4",
      "p2",
    ]);
  });

  it("la ricerca ignora maiuscole e accenti, e cerca anche la squadra", () => {
    expect(availablePlayers(pool, snapshot(), "A", "juv").map((p) => p.id)).toEqual(["p2"]);
    expect(availablePlayers(pool, snapshot(), "A", "LAUTARO").map((p) => p.id)).toEqual(["p1"]);
  });

  it("senza ruolo corrente non c'è niente da chiamare", () => {
    expect(availablePlayers(pool, snapshot(), null)).toEqual([]);
  });

  it("i presi si leggono dalle rose dello snapshot, non da una query", () => {
    expect([...takenPlayerIds(conRose)]).toEqual(["p2"]);
  });
});
