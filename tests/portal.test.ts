import { describe, expect, it } from "vitest";

import type { CarmyJudgement } from "@/lib/domain";
import {
  NO_CARMY_FILTERS,
  amInTie,
  autoPickCandidate,
  availablePlayers,
  bidBounds,
  canWithdraw,
  checkAmount,
  countdownLabel,
  hasCarmyFilters,
  parseAmount,
  pausedRemaining,
  portalScreen,
  shouldOpenBidDialog,
  takenPlayerIds,
} from "@/lib/realtime/portal";
import type { PoolPlayer, Snapshot } from "@/lib/realtime/types";

import {
  ME,
  OTHER,
  THIRD,
  iso,
  lot,
  member,
  snapshot,
} from "./snapshot-factory";

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
      currentLot: lot({ eligibleMemberIds: [OTHER, THIRD] }),
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

// ─── Le buste degli altri ────────────────────────────────────────────────────
//
// Non c'è niente da collaudare qui, ed è il risultato di M1: delle buste altrui
// lo snapshot non porta più niente, quindi non esiste una funzione che le legga.
// La guardia sta in `tests/db/i8.test.ts`, dove ha senso — sull'insieme esatto
// delle chiavi che escono davvero dalla route SSE.

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
        roster: [
          { assignmentId: "a2", playerId: "p2", name: "Vlahovic", role: "A", team: "Juventus", price: 80 },
        ],
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

// ─── I filtri di Carmy, e il vincolo che protegge l'auto-pick (M10B §6) ───────

describe("i filtri di Carmy sulla lista di chiamata", () => {
  /** Un giudizio minimo, con solo ciò che i filtri guardano. */
  function judge(over: Partial<CarmyJudgement>): CarmyJudgement {
    return {
      extId: 1,
      sourceName: "x",
      sourceTeam: "INT",
      fascia: null,
      prezzo: null,
      titolarita: null,
      affidabilita: null,
      integrita: null,
      fmvExp: null,
      tags: [],
      commento: null,
      ...over,
    };
  }

  /**
   * ⚠ **Il pool è ordinato in modo che il primo per `fvm` sia l'ultimo per
   * titolarità.** Serve esattamente a questo: è la configurazione in cui un filtro
   * di Carmy **sposta** il primo nome della lista, cioè il caso che il riquadro di
   * §6 descrive. Un pool in cui il migliore per `fvm` è anche il migliore per
   * titolarità non proverebbe niente.
   */
  const pool: PoolPlayer[] = [
    {
      id: "p1",
      name: "Lautaro",
      team: "Inter",
      role: "A",
      fvm: 300,
      quot: 30,
      carmy: judge({ titolarita: 2, fascia: "Top", tags: ["incostante"] }),
    },
    {
      id: "p2",
      name: "Retegui",
      team: "Atalanta",
      role: "A",
      fvm: 250,
      quot: 29,
      carmy: judge({ titolarita: 5, fascia: "Semi-Top", tags: ["bonus", "rigorista"] }),
    },
    {
      id: "p3",
      name: "Vlahovic",
      team: "Juventus",
      role: "A",
      fvm: 200,
      quot: 28,
      carmy: judge({ titolarita: 4, fascia: "Top", tags: ["bonus"] }),
    },
    // ⚠ Senza giudizio: è il caso dei dieci nomi che il listone non aveva, e di
    // ogni giocatore quando il foglio non è caricato.
    { id: "p4", name: "Senza", team: "Lecce", role: "A", fvm: 180, quot: 10 },
  ];

  const s = snapshot();

  it("senza filtri la lista è quella di prima, nell'ordine dell'auto-pick", () => {
    expect(availablePlayers(pool, s, "A").map((p) => p.id)).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
    ]);
  });

  it("la titolarità minima tiene chi ci arriva, nell'ordine dell'auto-pick", () => {
    expect(
      availablePlayers(pool, s, "A", "", { ...NO_CARMY_FILTERS, titolaritaMin: 4 }).map(
        (p) => p.id,
      ),
    ).toEqual(["p2", "p3"]);
  });

  it("la fascia filtra per valore esatto", () => {
    expect(
      availablePlayers(pool, s, "A", "", { ...NO_CARMY_FILTERS, fascia: "Top" }).map(
        (p) => p.id,
      ),
    ).toEqual(["p1", "p3"]);
  });

  it("il tag filtra per appartenenza, uno per volta", () => {
    expect(
      availablePlayers(pool, s, "A", "", { ...NO_CARMY_FILTERS, tag: "bonus" }).map(
        (p) => p.id,
      ),
    ).toEqual(["p2", "p3"]);
  });

  it("i filtri si compongono, e la ricerca continua a valere accanto a loro", () => {
    expect(
      availablePlayers(pool, s, "A", "juv", {
        ...NO_CARMY_FILTERS,
        fascia: "Top",
        titolaritaMin: 4,
      }).map((p) => p.id),
    ).toEqual(["p3"]);
  });

  it("⚠ chi non ha un giudizio esce quando un filtro è acceso: «non lo so» non è un sì", () => {
    // Vale anche per chi non ha il permesso, a cui la chiave non arriva affatto: i
    // filtri sono l'interfaccia sopra un dato, non la sua protezione (§7).
    const senzaGiudizio = availablePlayers(pool, s, "A", "", {
      ...NO_CARMY_FILTERS,
      titolaritaMin: 1,
    });
    expect(senzaGiudizio.map((p) => p.id)).not.toContain("p4");
  });

  it("e senza filtri accesi rientra, perché la domanda non è stata fatta", () => {
    expect(availablePlayers(pool, s, "A").map((p) => p.id)).toContain("p4");
    expect(hasCarmyFilters(NO_CARMY_FILTERS)).toBe(false);
  });

  it("hasCarmyFilters riconosce ognuno dei tre da solo", () => {
    expect(hasCarmyFilters({ ...NO_CARMY_FILTERS, fascia: "Top" })).toBe(true);
    expect(hasCarmyFilters({ ...NO_CARMY_FILTERS, titolaritaMin: 4 })).toBe(true);
    expect(hasCarmyFilters({ ...NO_CARMY_FILTERS, tag: "bonus" })).toBe(true);
  });
});

/**
 * ⚠ **Il vincolo più facile da rompere di M10B** (§6), provato dove vive.
 *
 * La lista di chiamata è ordinata `fvm DESC, quot DESC`, che **è** l'ordine
 * dell'auto-pick: per questo il primo nome è sempre stato «quello che il timer
 * sceglierebbe al posto tuo». Un filtro cambia quali righe si vedono e **non**
 * cambia chi il timer scegli — quello pesca dal pool intero, in `machine.ts`.
 *
 * `autoPickCandidate` è la risposta a «chi prenderebbe il timer?» e **deve essere
 * insensibile ai filtri**. Se un giorno qualcuno le passasse i filtri «per
 * coerenza», è qui che si romperebbe — e in `/play` la riga direbbe una bugia
 * esattamente nel momento in cui serve.
 */
describe("autoPickCandidate — chi comprerebbe il timer", () => {
  const pool: PoolPlayer[] = [
    { id: "p1", name: "Lautaro", team: "Inter", role: "A", fvm: 300, quot: 30 },
    { id: "p2", name: "Retegui", team: "Atalanta", role: "A", fvm: 250, quot: 29 },
    { id: "p3", name: "Zaccagni", team: "Lazio", role: "C", fvm: 200, quot: 20 },
  ];

  it("è il primo per fvm, poi per quot: l'ordine del motore", () => {
    expect(autoPickCandidate(pool, snapshot(), "A")?.id).toBe("p1");
  });

  it("rispetta il ruolo corrente e le rose, come l'auto-pick", () => {
    const conRose = snapshot({
      members: [
        member(ME, 0, {
          roster: [
            {
              assignmentId: "a1",
              playerId: "p1",
              name: "Lautaro",
              role: "A",
              team: "Inter",
              price: 80,
            },
          ],
        }),
        member(OTHER, 1),
        member(THIRD, 2),
      ],
    });
    expect(autoPickCandidate(pool, conRose, "A")?.id).toBe("p2");
    expect(autoPickCandidate(pool, snapshot(), "C")?.id).toBe("p3");
  });

  it("è `null` quando non c'è niente da comprare di quel ruolo", () => {
    expect(autoPickCandidate(pool, snapshot(), "P")).toBeNull();
    expect(autoPickCandidate(pool, snapshot(), null)).toBeNull();
  });
});
