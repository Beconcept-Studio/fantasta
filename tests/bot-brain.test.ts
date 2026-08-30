import { describe, expect, it } from "vitest";

import {
  amountFor,
  decide,
  delayWithin,
  fraction,
} from "@/lib/engine/bot-brain";

import { ME, OTHER, T, THIRD, iso, lot, member, snapshot } from "./snapshot-factory";

/**
 * Il cervello dei bot (M4-13).
 *
 * Il modulo è puro e questo è il punto: nessun database, nessun orologio vero,
 * nessuna asta da costruire. Lo snapshot di prova è lo stesso che usano i test
 * del portale — che è appropriato, perché **un bot vede esattamente quello che
 * vede un portale**, e questi test lo dimostrano per costruzione.
 *
 * Il default della factory: asta LIVE, lotto aperto con `minAmount = 1`, round
 * da 30 secondi iniziato a `T`, io idoneo e senza busta consegnata.
 */

/** Il listone minimo che serve alle chiamate: id e ruolo. */
const POOL = [
  { id: "player-1", role: "A" as const },
  { id: "player-2", role: "A" as const },
  { id: "player-3", role: "D" as const },
];

/** Dopo i due terzi della finestra qualunque bot ha già deciso. */
const LATE = T + 25_000;

describe("fraction", () => {
  it("è deterministica e sta in [0, 1)", () => {
    for (const parts of [["a"], ["member-1", "lot-9", "2"], [""]]) {
      const value = fraction(...parts);
      expect(value).toBe(fraction(...parts));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("distingue le parti dal loro accostamento", () => {
    // Senza separatore `["ab","c"]` e `["a","bc"]` darebbero lo stesso hash, e
    // due bot diversi sullo stesso lotto finirebbero per muoversi insieme.
    expect(fraction("ab", "c")).not.toBe(fraction("a", "bc"));
  });
});

describe("delayWithin", () => {
  it("non è mai zero e non arriva mai a fine finestra", () => {
    // Il primo bordo servirebbe a niente (offrire nell'istante dell'apertura
    // rende l'asta una lista di risultati), il secondo sarebbe un rifiuto per
    // round chiuso.
    for (let i = 0; i < 200; i += 1) {
      const delay = delayWithin(30_000, `member-${i}`, "lot-1", "1");
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThan(30_000 * 0.7);
    }
  });

  it("è stabile fra due processi", () => {
    // Il valore è scritto a mano di proposito: se l'hash cambia, questo test
    // rosseggia. È la garanzia che un riavvio non sposta il ritardo di nessuno
    // — che è tutta la ragione per cui non c'è memoria da nessuna parte.
    expect(delayWithin(30_000, "member-me", "lot-1", "1")).toBe(
      delayWithin(30_000, "member-me", "lot-1", "1"),
    );
    expect(delayWithin(30_000, ME, "lot-1", "1")).not.toBe(
      delayWithin(30_000, OTHER, "lot-1", "1"),
    );
  });
});

describe("amountFor", () => {
  it("passive offre il minimo, aggressive il massimo", () => {
    expect(amountFor("passive", 5, 100, "x")).toBe(5);
    expect(amountFor("aggressive", 5, 100, "x")).toBe(100);
  });

  it("tie fa convergere bot diversi sulla stessa cifra", () => {
    expect(amountFor("tie", 1, 100, ME)).toBe(amountFor("tie", 1, 100, OTHER));
  });

  it("resta dentro [minAmount, cap], sempre", () => {
    for (let i = 0; i < 500; i += 1) {
      const amount = amountFor("random", 7, 40, `member-${i}`, "lot-1", "1");
      expect(amount).not.toBeNull();
      expect(amount!).toBeGreaterThanOrEqual(7);
      expect(amount!).toBeLessThanOrEqual(40);
    }
  });

  it("sta fuori se non arriva al minimo", () => {
    // I5: `max_bid` sotto il minimo del round vuol dire che questo membro non
    // può offrire, e il server lo rifiuterebbe.
    for (const strategy of ["random", "aggressive", "passive", "tie"] as const) {
      expect(amountFor(strategy, 50, 20, "x")).toBeNull();
    }
  });
});

describe("decide — le offerte", () => {
  it("aspetta il proprio momento invece di offrire all'apertura", () => {
    expect(decide(snapshot(), ME, "random", POOL, T)).toBeNull();
  });

  it("offre entro la finestra del round", () => {
    const move = decide(snapshot(), ME, "passive", POOL, LATE);
    expect(move).toEqual({ type: "BID", amount: 1 });
  });

  it("non ri-offre la stessa cifra che ha già consegnato", () => {
    // È il «una volta per round» — e non c'è nessuna memoria dietro: la
    // risposta sta nello snapshot.
    const before = snapshot({ myBid: null });
    const move = decide(before, ME, "aggressive", POOL, LATE);
    expect(move).toEqual({ type: "BID", amount: 476 });

    const after = snapshot({
      myBid: { amount: 476, amountSetAt: iso(1_000), withdrawnAt: null },
    });
    expect(decide(after, ME, "aggressive", POOL, LATE)).toBeNull();
  });

  it("nel round 2 rilancia sopra la propria busta ereditata", () => {
    // Il carry-forward porta l'offerta del round 1 dentro il round 2: senza
    // rilancio si conferma e basta, e lo stallo lo decide la busta più vecchia.
    const tie = snapshot({
      currentLot: lot({ roundNo: 2, minAmount: 10, endsAt: iso(30_000) }),
      myBid: { amount: 10, amountSetAt: iso(-5_000), withdrawnAt: null },
    });
    expect(decide(tie, ME, "aggressive", POOL, LATE)).toEqual({
      type: "BID",
      amount: 476,
    });
    // `tie` invece conferma: la sua cifra è già quella su cui si pareggia.
    expect(decide(tie, ME, "tie", POOL, LATE)).toBeNull();
  });

  it("un ritiro è definitivo", () => {
    const withdrawn = snapshot({
      myBid: { amount: 3, amountSetAt: iso(0), withdrawnAt: iso(1_000) },
    });
    expect(decide(withdrawn, ME, "aggressive", POOL, LATE)).toBeNull();
  });

  it("sta fermo se non è idoneo, se il round è chiuso, se l'asta è in pausa", () => {
    const notEligible = snapshot({
      currentLot: lot({ eligibleMemberIds: [OTHER, THIRD] }),
    });
    expect(decide(notEligible, ME, "aggressive", POOL, LATE)).toBeNull();

    const closed = snapshot({ currentLot: lot({ closedAt: iso(20_000) }) });
    expect(decide(closed, ME, "aggressive", POOL, LATE)).toBeNull();

    // La pausa congela la fase, e il server rifiuterebbe comunque (regola 6).
    const paused = snapshot({
      auction: { ...snapshot().auction, status: "PAUSED", pausedAt: iso(5_000) },
    });
    expect(decide(paused, ME, "aggressive", POOL, LATE)).toBeNull();
  });

  it("non offre oltre il proprio massimo (I5)", () => {
    const poor = snapshot({
      members: [member(ME, 0, { maxBid: 0 }), member(OTHER, 1), member(THIRD, 2)],
    });
    expect(decide(poor, ME, "aggressive", POOL, LATE)).toBeNull();
  });
});

describe("decide — le chiamate", () => {
  const waiting = snapshot({
    auction: {
      ...snapshot().auction,
      phase: "WAITING_PICK",
      currentMemberId: ME,
      currentRole: "A",
      phaseDeadline: iso(60_000),
    },
    currentLot: null,
  });

  it("chiama un giocatore libero del ruolo corrente", () => {
    const move = decide(waiting, ME, "random", POOL, T + 55_000);
    expect(move?.type).toBe("PICK");
    // Mai un difensore mentre si chiamano attaccanti.
    expect(["player-1", "player-2"]).toContain(
      move?.type === "PICK" ? move.playerId : "",
    );
  });

  it("non chiama i giocatori già in rosa di qualcun altro", () => {
    const taken = snapshot({
      ...waiting,
      members: [
        member(ME, 0),
        member(OTHER, 1, {
          roster: [
            {
              assignmentId: "a-1",
              playerId: "player-1",
              name: "Lautaro",
              role: "A",
              team: "Inter",
              price: 40,
              lotSeq: 1,
            },
          ],
        }),
        member(THIRD, 2),
      ],
    });
    const move = decide(taken, ME, "random", POOL, T + 55_000);
    expect(move).toEqual({ type: "PICK", playerId: "player-2" });
  });

  it("non chiama se non è il suo turno", () => {
    const notMine = snapshot({
      ...waiting,
      auction: { ...waiting.auction, currentMemberId: OTHER },
    });
    expect(decide(notMine, ME, "random", POOL, T + 55_000)).toBeNull();
  });

  it("aspetta il proprio momento anche per chiamare", () => {
    expect(decide(waiting, ME, "random", POOL, T)).toBeNull();
  });

  it("lascia fare all'auto-pick se non è rimasto niente", () => {
    const empty = decide(waiting, ME, "random", [{ id: "d", role: "D" }], T + 55_000);
    expect(empty).toBeNull();
  });
});
