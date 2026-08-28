import { describe, expect, it } from "vitest";

import type { CarmyJudgement, Role } from "@/lib/domain";
import {
  NO_CARMY_FILTERS,
  NO_LISTONE_FILTERS,
  amInTie,
  autoPickCandidate,
  availablePlayers,
  bidBounds,
  bidOffsetLabel,
  checkAmount,
  compareRevealBids,
  countdownLabel,
  hasCarmyFilters,
  listoneRows,
  parseAmount,
  pausedRemaining,
  portalScreen,
  quotaPerRuolo,
  revealBaseMs,
  sceneLabel,
  sceneOf,
  sceneTime,
  secondsLeft,
  shouldOpenBidDialog,
  shouldOpenPickSheet,
  takenPlayerIds,
  timeTone,
  toneOf,
  turnKey,
  tvConnected,
} from "@/lib/realtime/portal";
import type {
  PoolPlayer,
  Presence,
  Snapshot,
  SnapshotRevealBid,
} from "@/lib/realtime/types";

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
  });

  /**
   * Il **settimo** caso di rientro (M14): i cinque del piano, il sesto è il congedo
   * di M12, questo è il cancello dei risultati.
   *
   * ⚠ Vale per costruzione — `portalScreen` decide su `currentLot !== null && phase
   * !== "WAITING_PICK"`, non su un elenco di fasi — e proprio per questo va appeso a
   * un'asserzione: una proprietà che nessuno prova è una proprietà che la prossima
   * modifica può togliere in silenzio.
   */
  it("rientro durante LOT_SEALED: il cancello, non i risultati e non la card viva", () => {
    const s = snapshot({
      auction: {
        ...snapshot().auction,
        phase: "LOT_SEALED",
        // Il cancello è di 10s e ne restano 6: è il countdown che chi rientra deve
        // trovare, non uno ripartito da capo.
        phaseDeadline: iso(6_000),
      },
      currentLot: lot({ closedAt: iso(-4_000) }),
    });

    expect(portalScreen(s, ME)).toEqual({ kind: "LOT", frozen: false });
    // ⚠ Dell'esito non esce niente: non è nascosto in un campo, non c'è.
    expect(s.currentLot?.reveal).toBeNull();
    expect(s.currentLot?.tie).toBeNull();
    // Il round è chiuso: niente modale.
    expect(shouldOpenBidDialog(s, ME, null)).toBe(false);
    // Il countdown è quello vero, dedotto dalla deadline dello snapshot.
    expect(secondsLeft(6_000)).toBe(6);
  });

  it("rientro durante LOT_SEALED ad asta in pausa: congelato, e le buste restano chiuse", () => {
    const s = snapshot({
      auction: {
        ...snapshot().auction,
        status: "PAUSED",
        phase: "LOT_SEALED",
        phaseDeadline: iso(6_000),
        pausedAt: iso(-1_000),
      },
      currentLot: lot({ closedAt: iso(-4_000) }),
    });

    expect(portalScreen(s, ME)).toEqual({ kind: "LOT", frozen: true });
    expect(s.currentLot?.reveal).toBeNull();
    // Il residuo congelato è quello dell'istante della pausa, non quello che
    // continuerebbe a scorrere da sé verso zero: 6.000 − (−1.000) = 7 secondi.
    expect(pausedRemaining(iso(6_000), iso(-1_000))).toBe(7_000);
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

// ─── Ritiro (F5-07, tolto da M16) ────────────────────────────────────────────
//
// Non c'è niente da collaudare, e i cinque test che stavano qui — «si può
// ritirare un'offerta propria nel round 1», i tre divieti, «il ritiro è
// definitivo» — sono spariti con `canWithdraw`. Chi offre tiene, e al massimo
// rilancia.
//
// ⚠ La verifica che la regola è **del server** e non del browser non sta qui:
// sta in `tests/db/withdraw-gone.test.ts`, dove un `WITHDRAW` arriva alla rotta
// vera e torna `INVALID_REQUEST` senza toccare il database. Questo file prova
// funzioni pure, e la funzione da provare non esiste più.

// ─── La presence come la legge la TV (M16) ───────────────────────────────────

describe("tvConnected", () => {
  it("verde chi è collegato: LIVE e IDLE contano tutti e due", () => {
    // ⚠ È il cuore della scelta, non un dettaglio: chi ha il tab in secondo
    // piano ha il telefono in tasca ed è nella stanza. In TV la domanda è
    // «possiamo far partire il round?», e la risposta per lui è sì.
    expect(tvConnected("LIVE")).toBe(true);
    expect(tvConnected("IDLE")).toBe(true);
  });

  it("rosso solo chi non batte più il colpo", () => {
    expect(tvConnected("OFFLINE")).toBe(false);
  });

  it("due colori e non tre: nessuno stato resta senza risposta", () => {
    const all: Presence[] = ["LIVE", "IDLE", "OFFLINE"];
    for (const presence of all) {
      expect(typeof tvConnected(presence), presence).toBe("boolean");
    }
  });
});

// ─── Le buste degli altri ────────────────────────────────────────────────────
//
// Non c'è niente da collaudare qui, ed è il risultato di M1: delle buste altrui
// lo snapshot non porta più niente, quindi non esiste una funzione che le legga.
// La guardia sta in `tests/db/i8.test.ts`, dove ha senso — sull'insieme esatto
// delle chiavi che escono davvero dalla route SSE.

// ─── Le buste aperte: il «+3s» ───────────────────────────────────────────────

describe("il «+3s» del reveal", () => {
  const T0 = Date.parse("2026-08-23T20:00:00.000Z");

  /** Una busta: solo i campi che queste tre funzioni guardano. */
  const bid = (memberId: string, amount: number, ms: number): SnapshotRevealBid => ({
    memberId,
    amount,
    amountSetAt: new Date(T0 + ms).toISOString(),
    withdrawnAt: null,
  });

  it("lo zero è la prima busta del round, non l'apertura del round", () => {
    // ⚠ È **la** cosa da sapere di questo numero, e per questo un test la fissa:
    // chi legge «+3s» pensa «tre secondi dopo il via». Non è quello. La prima
    // busta consegnata è lo zero, per quanto tardi sia arrivata.
    const bids = [bid(OTHER, 30, 9_000), bid(ME, 40, 12_000)];
    const base = revealBaseMs(bids);
    expect(bidOffsetLabel(bids[0].amountSetAt, base)).toBe("+0s");
    expect(bidOffsetLabel(bids[1].amountSetAt, base)).toBe("+3s");
  });

  it("arrotonda al secondo, e non scrive mai un numero negativo", () => {
    expect(bidOffsetLabel(new Date(T0 + 2_400).toISOString(), T0)).toBe("+2s");
    expect(bidOffsetLabel(new Date(T0 + 2_600).toISOString(), T0)).toBe("+3s");
    // Sotto lo zero non si va: se un giorno arrivasse un timestamp prima della
    // base, l'etichetta resta «+0s» invece di scrivere «+-1s» sul proiettore.
    expect(bidOffsetLabel(new Date(T0 - 5_000).toISOString(), T0)).toBe("+0s");
  });

  it("un round senza buste non fa esplodere la colonna", () => {
    // `Math.min()` di un elenco vuoto è `Infinity`: il caso non arriva al reveal,
    // ma se ci arrivasse deve produrre un'etichetta, non un errore in mezzo alla
    // stanza.
    expect(revealBaseMs([])).toBe(Number.POSITIVE_INFINITY);
    expect(bidOffsetLabel(new Date(T0).toISOString(), revealBaseMs([]))).toBe("+0s");
  });

  it("l'ordine è l'importo, e a pari importo chi c'è arrivato prima", () => {
    // ⚠ Il secondo criterio è quello che ha deciso lo spareggio: con i secondi
    // scritti accanto, due `40` in ordine arbitrario si leggono come una
    // classifica sbagliata.
    const tardi = bid(OTHER, 40, 5_000);
    const presto = bid(ME, 40, 2_000);
    const basso = bid(THIRD, 30, 0);
    expect([tardi, basso, presto].sort(compareRevealBids)).toEqual([presto, tardi, basso]);
  });

  it("è lo stesso dato sui due schermi, perché è la stessa funzione", () => {
    // Il portale e la TV chiamano queste tre e non ne tengono una copia: qui
    // quella promessa è scritta. Se una delle due ricominciasse a calcolarsi i
    // secondi da sé, il numero potrebbe divergere senza che niente lo segnali.
    const bids = [bid(ME, 40, 3_000), bid(OTHER, 40, 0)];
    const base = revealBaseMs(bids);
    const letto = [...bids]
      .sort(compareRevealBids)
      .map((b) => `${b.amount} ${bidOffsetLabel(b.amountSetAt, base)}`);
    expect(letto).toEqual(["40 +0s", "40 +3s"]);
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

// ─── La tab Listone (M21 §4) ─────────────────────────────────────────────────

describe("listoneRows — chi resta, raggruppato per fascia", () => {
  /** Un giocatore del pool, con la sola parte di giudizio che la tabella guarda. */
  function p(
    id: string,
    over: Partial<PoolPlayer> & { pma?: number | null } = {},
  ): PoolPlayer {
    const { pma, ...rest } = over;
    const base: PoolPlayer = {
      id,
      name: id,
      team: "Inter",
      role: "A",
      fvm: 100,
      quot: 10,
      ...rest,
    };
    if (pma === undefined) return base;
    return {
      ...base,
      carmy: {
        extId: 1,
        fascia: base.fasciaGruppo ?? null,
        prezzo: null,
        pma,
        titolarita: null,
        affidabilita: null,
        integrita: null,
        fmvExp: null,
        tags: [],
        commento: null,
        ...base.carmy,
      },
    };
  }

  /** Il caso di riferimento: due fasce, un «Senza fascia», due ruoli. */
  const pool: PoolPlayer[] = [
    p("top-basso", { fasciaGruppo: "Top", fasciaRank: 0, pma: 10 }),
    p("top-alto", { fasciaGruppo: "Top", fasciaRank: 0, pma: 20, obiettivo: true }),
    p("terza", { fasciaGruppo: "Terza", fasciaRank: 2, pma: 5, role: "D" }),
    p("orfano", { pma: 30 }),
  ];

  it("raggruppa per fascia, nell'ordine del rank, e «Senza fascia» in fondo", () => {
    const groups = listoneRows(pool, snapshot());
    expect(groups.map((g) => g.fascia)).toEqual(["Top", "Terza", null]);
  });

  /**
   * ⚠ **`PMA` decrescente, non `fvm`**, ed è la divergenza voluta dalla lista di
   * chiamata (decisione della fase UI): là l'ordine *è* una promessa sull'
   * auto-pick, qui è l'unico criterio che chi legge può verificare sulla riga —
   * `fvm` in tabella non c'è nemmeno.
   */
  it("dentro il gruppo ordina per PMA decrescente", () => {
    const [top] = listoneRows(pool, snapshot());
    expect(top.players.map((x) => x.id)).toEqual(["top-alto", "top-basso"]);
  });

  it("⚠ chi non ha un PMA finisce in fondo al suo gruppo, non in cima", () => {
    const conNulli = [
      p("senza", { fasciaGruppo: "Top", fasciaRank: 0 }),
      p("con", { fasciaGruppo: "Top", fasciaRank: 0, pma: 1 }),
    ];
    expect(
      listoneRows(conNulli, snapshot())[0].players.map((x) => x.id),
    ).toEqual(["con", "senza"]);
  });

  it("i ruoli sono in OR, e nessun ruolo scelto vuol dire tutti", () => {
    const soloD = listoneRows(pool, snapshot(), {
      ...NO_LISTONE_FILTERS,
      roles: ["D"],
    });
    expect(soloD.flatMap((g) => g.players).map((x) => x.id)).toEqual(["terza"]);

    const dueRuoli = listoneRows(pool, snapshot(), {
      ...NO_LISTONE_FILTERS,
      roles: ["D", "A"],
    });
    expect(dueRuoli.flatMap((g) => g.players)).toHaveLength(4);

    // ⚠ Zero interruttori accesi non è «nessuno»: chi li spegne tutti sta
    // togliendo un filtro, non chiedendo una tabella vuota.
    expect(
      listoneRows(pool, snapshot(), NO_LISTONE_FILTERS).flatMap((g) => g.players),
    ).toHaveLength(4);
  });

  it("la ricerca guarda nome e squadra, con accenti e maiuscole", () => {
    const conAccento = [
      p("uno", { name: "Milinkovic-Savic V.", team: "Napoli", pma: 1 }),
      p("due", { name: "Konè", team: "Roma", pma: 1 }),
    ];
    const ids = (query: string) =>
      listoneRows(conAccento, snapshot(), { ...NO_LISTONE_FILTERS, query })
        .flatMap((g) => g.players)
        .map((x) => x.id);

    expect(ids("NAPOLI")).toEqual(["uno"]);
    expect(ids("kone")).toEqual(["due"]);
    expect(ids("  savic ")).toEqual(["uno"]);
  });

  it("il filtro obiettivi isola la lista della spesa", () => {
    const soli = listoneRows(pool, snapshot(), {
      ...NO_LISTONE_FILTERS,
      soloObiettivi: true,
    });
    expect(soli.flatMap((g) => g.players).map((x) => x.id)).toEqual(["top-alto"]);
  });

  /**
   * ⚠ **Il gruppo intero sparisce quando si svuota**, invece di restare come
   * un'intestazione vuota: è la ragione per cui `user_listone` non ha bisogno di
   * una seconda tabella che ricordi «quali fasce esistevano» (M21 §2). La tabella
   * mostra solo chi è rimasto.
   */
  it("un gruppo rimasto senza righe non compare affatto", () => {
    const groups = listoneRows(pool, snapshot(), {
      ...NO_LISTONE_FILTERS,
      soloObiettivi: true,
    });
    expect(groups.map((g) => g.fascia)).toEqual(["Top"]);
  });

  /**
   * ⚠ **La sincronia col lotto, senza una riga scritta per ottenerla** (I10).
   * Chi è già in una rosa sparisce perché lo dice lo snapshot, non perché sia
   * arrivato un evento: chi ricarica a metà asta vede la stessa tabella di chi
   * non si è mosso.
   */
  it("chi è già in una rosa non c'è più", () => {
    const conRosa = snapshot({
      members: [
        member(ME, 0, {
          roster: [
            {
              assignmentId: "a1",
              playerId: "top-alto",
              name: "top-alto",
              role: "A",
              team: "Inter",
              price: 50,
            },
          ],
        }),
        member(OTHER, 1),
      ],
    });
    const ids = listoneRows(pool, conRosa).flatMap((g) => g.players).map((x) => x.id);
    expect(ids).not.toContain("top-alto");
    expect(ids).toContain("top-basso");
  });

  /**
   * ⚠ **Il giocatore in asta adesso resta**, e non è una dimenticanza: non è
   * ancora di nessuno, e farlo sparire prima dell'assegnazione sarebbe una bugia
   * che si corregge da sé — se il lotto va deserto, quel giocatore torna
   * disponibile. Il badge lo mette il componente.
   */
  it("⚠ il giocatore del lotto aperto è ancora in tabella", () => {
    const inAsta = snapshot({
      currentLot: lot({ player: { ...lot().player, id: "top-alto" } }),
    });
    const ids = listoneRows(pool, inAsta).flatMap((g) => g.players).map((x) => x.id);
    expect(ids).toContain("top-alto");
  });

  it("con un pool vuoto non ci sono gruppi, e non è un errore", () => {
    expect(listoneRows([], snapshot())).toEqual([]);
  });

  /**
   * Le due modalità di vocabolario, viste da qui: la funzione **non sa** quale
   * sia in gioco — il server ha già deciso `fasciaGruppo` e `fasciaRank` — e
   * ordina allo stesso modo in tutti e due i casi. È il punto di §5: il browser
   * riceve una forma sola.
   */
  it("ordina le fasce personali come quelle globali, senza sapere quali siano", () => {
    const mie = [
      p("a", { fasciaGruppo: "La mia Seconda", fasciaRank: 1, pma: 1 }),
      p("b", { fasciaGruppo: "La mia Top", fasciaRank: 0, pma: 1 }),
      p("c", { pma: 1 }),
    ];
    expect(listoneRows(mie, snapshot()).map((g) => g.fascia)).toEqual([
      "La mia Top",
      "La mia Seconda",
      null,
    ]);
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
      pma: null,
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

// ─── Le nove scene, il tono, la banda del tempo (M17 §6 e §7) ────────────────

/**
 * ⚠ **Sono l'unica rete di questa macro.** In questo progetto la UI non ha test
 * di rendering — non c'è `@testing-library`, non c'è jsdom, e i test stanno su
 * funzioni pure e sul database. La conseguenza vincolante di M17 §1 è che tutto
 * ciò che si può rendere una funzione pura **deve** esserlo e **deve** avere il
 * suo test: quale scena, quale tono, quale scadenza. Ciò che resta è markup, e si
 * verifica guardandolo.
 */
describe("sceneOf — la scena non è la fase", () => {
  const live = (patch: Partial<Snapshot["auction"]>, rest: Partial<Snapshot> = {}) =>
    snapshot({ auction: { ...snapshot().auction, ...patch }, ...rest });

  it("⚠ LOT_OPEN al round 2 è lo spareggio, non le offerte: è la sola voce che non è uno a uno", () => {
    expect(sceneOf(snapshot(), ME)).toBe("OFFERS");
    const spareggio = snapshot({ currentLot: lot({ roundNo: 2, minAmount: 40 }) });
    expect(sceneOf(spareggio, ME)).toBe("TIE_OPEN");
    // La fase è la stessa in tutti e due: se un giorno qualcuno decide la scena
    // sulla fase, questa riga è quella che se ne accorge.
    expect(spareggio.auction.phase).toBe(snapshot().auction.phase);
  });

  it("le altre tre fasi di lotto hanno una scena ciascuna", () => {
    expect(sceneOf(live({ phase: "LOT_TIE_PREP" }), ME)).toBe("TIE_PREP");
    expect(sceneOf(live({ phase: "LOT_SEALED" }), ME)).toBe("SEALED");
    expect(sceneOf(live({ phase: "LOT_REVEAL" }), ME)).toBe("REVEAL");
  });

  it("in chiamata distingue il mio turno da quello di un altro", () => {
    const mio = live(
      { phase: "WAITING_PICK", currentMemberId: ME },
      { currentLot: null },
    );
    expect(sceneOf(mio, ME)).toBe("PICK_MINE");
    const altrui = live(
      { phase: "WAITING_PICK", currentMemberId: OTHER },
      { currentLot: null },
    );
    expect(sceneOf(altrui, ME)).toBe("PICK_WAIT");
  });

  it("fuori da LIVE/PAUSED dice non iniziata o conclusa", () => {
    expect(sceneOf(live({ status: "DRAFT", phase: null }, { currentLot: null }), ME)).toBe(
      "NOT_STARTED",
    );
    expect(sceneOf(live({ status: "READY", phase: null }, { currentLot: null }), ME)).toBe(
      "NOT_STARTED",
    );
    expect(
      sceneOf(live({ status: "COMPLETED", phase: null }, { currentLot: null }), ME),
    ).toBe("COMPLETED");
  });

  it("la pausa non cambia la scena: congela la fase, non la azzera", () => {
    const inPausa = live({ status: "PAUSED", pausedAt: iso(-1_000) });
    expect(sceneOf(inPausa, ME)).toBe(sceneOf(snapshot(), ME));
  });
});

describe("toneOf — la fascia da 4px", () => {
  const SCENE_ALL = [
    "NOT_STARTED",
    "COMPLETED",
    "PICK_WAIT",
    "PICK_MINE",
    "OFFERS",
    "TIE_PREP",
    "TIE_OPEN",
    "SEALED",
    "REVEAL",
  ] as const;

  it("⚠ in pausa il tono è quello della pausa QUALUNQUE sia la scena", () => {
    // È il test che conta di §7, e vale la pena che sia esaustivo invece di
    // esemplificativo: una fascia che dicesse «round di offerte» mentre le
    // offerte sono sospese direbbe una cosa falsa nel momento in cui qualcuno
    // sta cercando di capire perché il suo pulsante non funziona.
    for (const scene of SCENE_ALL) {
      expect(toneOf(scene, "PAUSED")).toBe("PAUSED");
    }
  });

  it("le tre scene in cui non c'è niente da fare sono grigie", () => {
    expect(toneOf("NOT_STARTED", "READY")).toBe("NEUTRAL");
    expect(toneOf("COMPLETED", "COMPLETED")).toBe("NEUTRAL");
    expect(toneOf("PICK_WAIT", "LIVE")).toBe("NEUTRAL");
  });

  it("il mio turno ha un tono suo, e i due spareggi ne condividono uno", () => {
    expect(toneOf("PICK_MINE", "LIVE")).toBe("MINE");
    expect(toneOf("TIE_PREP", "LIVE")).toBe("TIE");
    expect(toneOf("TIE_OPEN", "LIVE")).toBe("TIE");
  });

  it("⚠ offerte, buste da aprire ed esito sono tre toni diversi", () => {
    // Fuori dalla pausa nessuna delle scene «qualcosa sta succedendo» condivide
    // il tono con un'altra: se un giorno due si sovrappongono, il cambio di fase
    // in mezzo diventa invisibile.
    const toni = new Set([
      toneOf("OFFERS", "LIVE"),
      toneOf("SEALED", "LIVE"),
      toneOf("REVEAL", "LIVE"),
    ]);
    expect(toni.size).toBe(3);
  });

  it("ogni scena ha un tono: nessun buco nella tabella", () => {
    for (const scene of SCENE_ALL) {
      expect(toneOf(scene, "LIVE")).toBeTruthy();
      expect(sceneLabel(scene)).toBeTruthy();
    }
  });
});

describe("sceneTime — cosa scade, su quanto, e se la scadenza è mia", () => {
  const live = (patch: Partial<Snapshot["auction"]>) =>
    snapshot({ auction: { ...snapshot().auction, ...patch } });

  it("le due scene senza scadenza non hanno banda", () => {
    // Un anello vuoto con un «—» al posto della cifra fa sembrare la card rotta:
    // meglio due card più corte delle altre sette.
    expect(sceneTime("NOT_STARTED", snapshot())).toBeNull();
    expect(sceneTime("COMPLETED", snapshot())).toBeNull();
  });

  it("⚠ le offerte leggono la scadenza del round e non quella della fase", () => {
    const s = snapshot({
      auction: { ...snapshot().auction, phaseDeadline: iso(99_000) },
      currentLot: lot({ endsAt: iso(30_000) }),
    });
    expect(sceneTime("OFFERS", s)?.deadline).toBe(iso(30_000));
    expect(sceneTime("TIE_OPEN", s)?.deadline).toBe(iso(30_000));
    // Tutte le altre stanno sulla fase.
    expect(sceneTime("SEALED", s)?.deadline).toBe(iso(99_000));
    expect(sceneTime("REVEAL", s)?.deadline).toBe(iso(99_000));
    expect(sceneTime("PICK_MINE", s)?.deadline).toBe(iso(99_000));
  });

  it("ogni scena prende il totale dal suo timer", () => {
    const s = live({
      timers: {
        bidSeconds: 30,
        pickSeconds: 60,
        tiePrepSeconds: 5,
        revealSeconds: 10,
        resultGateSeconds: 7,
      },
    });
    expect(sceneTime("OFFERS", s)?.totalSeconds).toBe(30);
    expect(sceneTime("PICK_MINE", s)?.totalSeconds).toBe(60);
    expect(sceneTime("PICK_WAIT", s)?.totalSeconds).toBe(60);
    expect(sceneTime("TIE_PREP", s)?.totalSeconds).toBe(5);
    expect(sceneTime("REVEAL", s)?.totalSeconds).toBe(10);
    expect(sceneTime("SEALED", s)?.totalSeconds).toBe(7);
  });

  it("⚠ `pressing` è vero solo dove c'è una scadenza MIA da mancare", () => {
    // È la risposta a «dove il rosso ha senso» (decisione dell'owner del
    // 2026-08-22): con il colore acceso in tutte le scene la banda diventerebbe
    // rossa a ogni lotto, duecento volte in una serata, anche dove non è chiesto
    // niente — e un rosso che non chiede mai niente si impara a ignorare.
    for (const scene of ["PICK_MINE", "OFFERS", "TIE_OPEN"] as const) {
      expect(sceneTime(scene, snapshot())?.pressing).toBe(true);
    }
    for (const scene of ["PICK_WAIT", "TIE_PREP", "SEALED", "REVEAL"] as const) {
      expect(sceneTime(scene, snapshot())?.pressing).toBe(false);
    }
  });
});

describe("timeTone — le tre soglie, in un posto solo", () => {
  it("sono quelle che CountdownBar aveva già: 50% e 20%", () => {
    expect(timeTone(1, true)).toBe("OK");
    expect(timeTone(0.51, true)).toBe("OK");
    expect(timeTone(0.5, true)).toBe("WARN");
    expect(timeTone(0.21, true)).toBe("WARN");
    expect(timeTone(0.2, true)).toBe("HOT");
    expect(timeTone(0, true)).toBe("HOT");
  });

  it("senza una scadenza mia il tempo non grida mai, per quanto poco ne resti", () => {
    expect(timeTone(0.9, false)).toBe("CALM");
    expect(timeTone(0.01, false)).toBe("CALM");
  });

  it("senza scadenza è calmo e non rosso: un `null` non è un tempo scaduto", () => {
    expect(timeTone(null, true)).toBe("CALM");
    expect(timeTone(null, false)).toBe("CALM");
  });
});

// ─── Il pannello di chiamata (M17 §4) ────────────────────────────────────────

describe("turnKey — con che chiave si ricorda «l'ho chiuso»", () => {
  it("è la scadenza della fase", () => {
    expect(turnKey(snapshot())).toBe(iso(30_000));
  });

  it("⚠ e NON la coppia membro+ruolo, perché dentro un ruolo lo stesso posto chiama più volte", () => {
    // Otto difensori vogliono otto turni dello stesso membro sullo stesso ruolo.
    // Con `currentMemberId + currentRole` come chiave, chi chiude il pannello al
    // primo dei suoi difensori se lo ritroverebbe chiuso per tutti gli altri —
    // cioè per la serata. Queste due chiamate hanno membro e ruolo identici:
    const primo = snapshot({
      auction: {
        ...snapshot().auction,
        phase: "WAITING_PICK",
        currentMemberId: ME,
        currentRole: "D",
        phaseDeadline: iso(60_000),
      },
      currentLot: null,
    });
    const secondo = snapshot({
      auction: { ...primo.auction, phaseDeadline: iso(180_000) },
      currentLot: null,
    });
    expect(primo.auction.currentMemberId).toBe(secondo.auction.currentMemberId);
    expect(primo.auction.currentRole).toBe(secondo.auction.currentRole);
    // …e chiavi diverse, che è l'unica cosa che salva il secondo turno.
    expect(turnKey(primo)).not.toBe(turnKey(secondo));
  });
});

describe("shouldOpenPickSheet — il secondo modale che si apre da sé", () => {
  const mioTurno = (patch: Partial<Snapshot["auction"]> = {}) =>
    snapshot({
      auction: {
        ...snapshot().auction,
        phase: "WAITING_PICK",
        currentMemberId: ME,
        currentRole: "D",
        ...patch,
      },
      currentLot: null,
    });

  it("si apre quando tocca a me e non l'ho chiuso", () => {
    expect(shouldOpenPickSheet(mioTurno(), ME, null)).toBe(true);
  });

  it("resta chiuso se l'ho chiuso io, per questo turno", () => {
    const s = mioTurno();
    expect(shouldOpenPickSheet(s, ME, turnKey(s))).toBe(false);
  });

  it("⚠ si riapre al turno successivo dello stesso ruolo: la chiave è cambiata", () => {
    const primo = mioTurno({ phaseDeadline: iso(60_000) });
    const chiuso = turnKey(primo);
    const secondo = mioTurno({ phaseDeadline: iso(180_000) });
    expect(shouldOpenPickSheet(secondo, ME, chiuso)).toBe(true);
  });

  it("non si apre se tocca a un altro", () => {
    expect(shouldOpenPickSheet(mioTurno({ currentMemberId: OTHER }), ME, null)).toBe(
      false,
    );
  });

  it("non si apre fuori da WAITING_PICK: durante un lotto la chiamata è passata", () => {
    // È ciò che fa chiudere il pannello **da sé** quando ho scelto: non è il
    // pannello a chiudersi, è questa condizione a diventare falsa quando arriva
    // lo snapshot successivo.
    expect(shouldOpenPickSheet(snapshot(), ME, null)).toBe(false);
  });

  it("non si apre in pausa: il server rifiuterebbe la chiamata", () => {
    const s = mioTurno({ status: "PAUSED", pausedAt: iso(-1_000) });
    expect(shouldOpenPickSheet(s, ME, null)).toBe(false);
  });

  it("⚠ ma dopo il resume si riapre, ed è il comportamento voluto", () => {
    // Al resume le scadenze sono traslate, quindi la chiave di chi l'aveva chiuso
    // prima della pausa non combacia più. L'owner l'ha accettato sapendolo
    // (2026-08-22): la pausa finisce e la domanda ti viene rifatta. Se guardandolo
    // non convincesse, è la chiave da cambiare — e questa riga è dove si vede.
    const primaDellaPausa = mioTurno({ phaseDeadline: iso(60_000) });
    const chiuso = turnKey(primaDellaPausa);
    const dopoIlResume = mioTurno({ phaseDeadline: iso(72_000) });
    expect(shouldOpenPickSheet(dopoIlResume, ME, chiuso)).toBe(true);
  });

  it("senza un membro non si apre niente: chi guarda da fuori non chiama", () => {
    expect(shouldOpenPickSheet(mioTurno(), null, null)).toBe(false);
  });

  it("ha la stessa forma della gemella d'offerta: due condizioni, mai una sequenza", () => {
    // Quando scelgo, lo snapshot successivo porta `LOT_OPEN`: una diventa falsa e
    // l'altra vera nello stesso istante, senza che nessuno le coordini.
    const chiamata = mioTurno();
    expect(shouldOpenPickSheet(chiamata, ME, null)).toBe(true);
    expect(shouldOpenBidDialog(chiamata, ME, null)).toBe(false);
    const lottoAperto = snapshot();
    expect(shouldOpenPickSheet(lottoAperto, ME, null)).toBe(false);
    expect(shouldOpenBidDialog(lottoAperto, ME, null)).toBe(true);
  });
});

// ─── La quota di budget per reparto (M18-03) ─────────────────────────────────

describe("quotaPerRuolo — quanto budget è finito in ogni reparto", () => {
  /** Una rosa con i prezzi che servono, senza scrivere sei campi per riga. */
  function rosa(...presi: [Role, number][]) {
    return presi.map(([role, price], i) => ({
      assignmentId: `a${i}`,
      playerId: `p${i}`,
      name: `Giocatore ${i}`,
      role,
      team: "Inter",
      price,
    }));
  }

  it("l'esempio dell'owner: 250 sui portieri su un budget da 500 fa 50%", () => {
    // Il denominatore è il budget, non la spesa fatta — «se spendo 250 su 500
    // sui portieri, ho investito il 50%» (decisione 1 del 2026-08-22).
    const me = member(ME, 0, {
      credits: 250,
      roster: rosa(["P", 250]),
    });
    expect(quotaPerRuolo(me).P).toBe(50);
  });

  it("è sul budget e non sulla spesa: al primo acquisto il reparto non è al 100%", () => {
    // È il motivo della decisione: la quota sulla spesa direbbe 100% qui, cioè
    // niente. Quella sul budget dice quanto budget è impegnato.
    const me = member(ME, 0, { credits: 490, roster: rosa(["A", 10]) });
    expect(quotaPerRuolo(me).A).toBe(2);
  });

  it("le quattro quote non fanno 100, e ciò che manca sono i crediti in cassa", () => {
    const me = member(ME, 0, {
      credits: 350,
      roster: rosa(["P", 50], ["D", 50], ["C", 25], ["A", 25]),
    });
    const q = quotaPerRuolo(me);
    expect(q).toEqual({ P: 10, D: 10, C: 5, A: 5 });
    // 30% impegnato, 350 su 500 ancora in cassa: la somma è 30, non 100, ed è
    // voluta (§3).
    expect(q.P! + q.D! + q.C! + q.A!).toBe(30);
  });

  it("un reparto vuoto fa 0, non `null`: a schermo si legge `(0%)`", () => {
    // È la lezione di M17 sull'anatomia fissa: un numero che compare solo a
    // volte costringe a chiedersi perché non c'è.
    const me = member(ME, 0, { credits: 480, roster: rosa(["P", 20]) });
    expect(quotaPerRuolo(me)).toEqual({ P: 4, D: 0, C: 0, A: 0 });
  });

  it("una rosa vuota è quattro zeri, non quattro `null`", () => {
    expect(quotaPerRuolo(member(ME, 0))).toEqual({ P: 0, D: 0, C: 0, A: 0 });
  });

  it("arrotonda all'intero, per eccesso e per difetto", () => {
    // 33 su 500 = 6,6% → 7; 32 su 500 = 6,4% → 6.
    expect(quotaPerRuolo(member(ME, 0, { credits: 467, roster: rosa(["D", 33]) })).D).toBe(7);
    expect(quotaPerRuolo(member(ME, 0, { credits: 468, roster: rosa(["D", 32]) })).D).toBe(6);
  });

  it("somma i giocatori dello stesso reparto, non li conta", () => {
    const me = member(ME, 0, {
      credits: 400,
      roster: rosa(["D", 45], ["D", 28], ["D", 12], ["C", 15]),
    });
    expect(quotaPerRuolo(me).D).toBe(17);
  });

  it("a budget 0 dice `null` per tutti e quattro: non si scrive `NaN%` in faccia a nessuno", () => {
    // Impossibile in pratica (`budgetInitial` è positivo e I3 tiene i crediti
    // ≥ slot residui): la guardia è contro il `NaN%` di un test o di un'asta
    // manipolata a mano dalla regia.
    const me = member(ME, 0, { credits: 0, roster: [] });
    expect(quotaPerRuolo(me)).toEqual({ P: null, D: null, C: null, A: null });
  });

  it("⚠ una rettifica di budget (I3) sposta tutte e quattro le quote", () => {
    // `credits` include già `Σ ledger.delta`, quindi il denominatore è il budget
    // **corrente**. Stessa rosa, +100 di rettifica: il totale su cui si sta
    // ragionando è cambiato, e le quattro percentuali scendono tutte. È la
    // lettura giusta di «crediti a disposizione», ed è l'unica onesta.
    const presi = rosa(["P", 50], ["D", 50], ["C", 50], ["A", 50]);
    const prima = member(ME, 0, { credits: 300, roster: presi });
    const dopo = member(ME, 0, { credits: 400, roster: presi });
    expect(quotaPerRuolo(prima)).toEqual({ P: 10, D: 10, C: 10, A: 10 });
    expect(quotaPerRuolo(dopo)).toEqual({ P: 8, D: 8, C: 8, A: 8 });
  });

  it("non dipende dall'ordine della rosa, che da M18 è cronologico", () => {
    const crescente = rosa(["D", 12], ["D", 28], ["D", 45]);
    const me = member(ME, 0, { credits: 415, roster: crescente });
    const rimescolata = member(ME, 0, {
      credits: 415,
      roster: [...crescente].reverse(),
    });
    expect(quotaPerRuolo(me)).toEqual(quotaPerRuolo(rimescolata));
  });
});
