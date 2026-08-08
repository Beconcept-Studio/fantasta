import { describe, expect, it } from "vitest";

import {
  autoPick,
  canAdjustBudget,
  canManualAssign,
  credits,
  eligibleMemberIds,
  maxBid,
  nextRole,
  nextSeat,
  resolveRound,
} from "@/lib/engine/rules";
import type { LotRound } from "@/lib/engine/types";

import { T0, assignment, bid, makeState, member, player, sec } from "./helpers";

/**
 * Le regole di dominio come funzioni pure (F2-02 … F2-04): crediti, offerta
 * massima, idoneità. Sono i numeri che PLAN §5 chiama I3, I5 e la base di I6:
 * quello che qui è rosso, in asta è un'offerta accettata a torto.
 */

describe("credits — F2-02", () => {
  it("parte dal budget iniziale", () => {
    const state = makeState();
    expect(credits(state, "m0")).toBe(500);
  });

  it("somma le rettifiche del ledger, positive e negative", () => {
    const state = makeState({
      ledger: [
        { memberId: "m0", delta: -30 },
        { memberId: "m0", delta: +10 },
        { memberId: "m1", delta: -999 }, // di un altro membro: non conta
      ],
    });
    expect(credits(state, "m0")).toBe(480);
  });

  it("sottrae i prezzi delle assegnazioni ma ignora le annullate", () => {
    const state = makeState({
      assignments: [
        assignment(1, "m0", "p1", 100),
        assignment(2, "m0", "p2", 50, { voidedAt: 123 }), // voided: non conta
        assignment(3, "m1", "p3", 200), // di un altro membro: non conta
      ],
    });
    expect(credits(state, "m0")).toBe(400);
  });
});

describe("maxBid — F2-03 (⚠ P2)", () => {
  it("§12.16 — 500 crediti, 0 giocatori su 25 slot → 476", () => {
    const state = makeState({
      config: { slots: { P: 3, D: 8, C: 8, A: 6 } },
    });
    expect(maxBid(state, "m0")).toBe(476);
  });

  it("§12.17 — crediti = slot residui → può offrire solo 1", () => {
    // 4 slot totali, 0 posseduti, crediti portati a 4 via ledger.
    const state = makeState({
      ledger: [{ memberId: "m0", delta: -496 }],
    });
    expect(maxBid(state, "m0")).toBe(1);
  });

  it("i residui si calcolano per ruolo, clampati a ≥ 0 (overflow da force)", () => {
    // Ruolo P in overflow (2 posseduti su 1 slot): il ruolo conta 0 residui,
    // non −1 — altrimenti il max_bid salirebbe oltre il lecito.
    const state = makeState({
      assignments: [
        assignment(1, "m0", "p1", 10),
        assignment(2, "m0", "p2", 10, { source: "MANUAL" }),
      ],
      players: [player("p1", "P"), player("p2", "P"), player("p3", "D")],
    });
    // crediti 480; residui D,C,A = 3 → max_bid = 480 − (3 − 1) = 478.
    expect(maxBid(state, "m0")).toBe(478);
  });

  it("mai sopra i crediti, anche con rosa completa o in overflow", () => {
    const state = makeState({
      assignments: [
        assignment(1, "m0", "p1", 100),
        assignment(2, "m0", "p2", 100),
        assignment(3, "m0", "p3", 100),
        assignment(4, "m0", "p4", 100),
      ],
      players: [
        player("p1", "P"),
        player("p2", "D"),
        player("p3", "C"),
        player("p4", "A"),
      ],
    });
    // Residui 0 → la formula lineare darebbe crediti + 1: va clampata.
    expect(maxBid(state, "m0")).toBe(100);
  });
});

describe("eligibleMemberIds — F2-04", () => {
  it("§12.19 — membro con il ruolo corrente pieno → escluso", () => {
    const state = makeState({
      assignments: [assignment(1, "m1", "p1", 10)],
      players: [player("p1", "P")],
    });
    expect(eligibleMemberIds(state, "P")).toEqual(["m0", "m2", "m3"]);
    // Sugli altri ruoli m1 resta idoneo.
    expect(eligibleMemberIds(state, "D")).toEqual(["m0", "m1", "m2", "m3"]);
  });

  it("membro con max_bid < 1 → escluso", () => {
    const state = makeState({
      ledger: [{ memberId: "m2", delta: -497 }], // crediti 3 < 4 slot residui
    });
    expect(eligibleMemberIds(state, "P")).toEqual(["m0", "m1", "m3"]);
  });

  it("l'ordine è quello dei seat", () => {
    const state = makeState({
      members: [member(2), member(0), member(1), member(3)],
    });
    expect(eligibleMemberIds(state, "P")).toEqual(["m0", "m1", "m2", "m3"]);
  });
});

describe("canAdjustBudget — §12.20 (I3)", () => {
  it("rifiuta il delta negativo che porta i crediti sotto gli slot residui", () => {
    // 4 slot residui, 500 crediti: con −497 ne resterebbero 3.
    const state = makeState();
    const result = canAdjustBudget(state, "m0", -497);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ADJUST_VIOLATES_I3");
      expect(result.error.message).toMatch(/credit/i);
    }
  });

  it("accetta il delta che lascia esattamente 1 credito per slot residuo", () => {
    const state = makeState();
    expect(canAdjustBudget(state, "m0", -496).ok).toBe(true);
  });

  it("conta solo gli slot ancora liberi", () => {
    const state = makeState({
      assignments: [assignment(1, "m0", "p1", 490)],
      players: [player("p1", "P")],
    });
    // Crediti 10, 3 slot residui: −7 lascia 3, ok; −8 lascia 2, no.
    expect(canAdjustBudget(state, "m0", -7).ok).toBe(true);
    expect(canAdjustBudget(state, "m0", -8).ok).toBe(false);
  });
});

describe("canManualAssign — F7-01 (I2/I3/I4)", () => {
  /** Un'asta con 1 slot per ruolo e due portieri liberi. */
  function base() {
    return makeState({
      players: [player("p1", "P"), player("p2", "P"), player("d1", "D")],
    });
  }

  it("accetta l'assegnazione ordinaria", () => {
    expect(canManualAssign(base(), "m0", "p1", 10, false).ok).toBe(true);
  });

  it("§12.40 — giocatore già assegnato: rifiutata anche con force (I2)", () => {
    const state = makeState({
      players: [player("p1", "P")],
      assignments: [assignment(1, "m1", "p1", 30)],
    });
    for (const force of [false, true]) {
      const result = canManualAssign(state, "m0", "p1", 10, force);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PLAYER_ASSIGNED");
    }
  });

  it("un'assegnazione annullata non occupa più il giocatore", () => {
    const state = makeState({
      players: [player("p1", "P")],
      assignments: [assignment(1, "m1", "p1", 30, { voidedAt: T0 })],
    });
    expect(canManualAssign(state, "m0", "p1", 10, false).ok).toBe(true);
  });

  it("ruolo pieno: rifiutata senza force, accettata con force (I4)", () => {
    const state = makeState({
      players: [player("p1", "P"), player("p2", "P")],
      assignments: [assignment(1, "m0", "p1", 30)],
    });
    const senza = canManualAssign(state, "m0", "p2", 10, false);
    expect(senza.ok).toBe(false);
    if (!senza.ok) expect(senza.error.code).toBe("ASSIGN_VIOLATES_I4");
    expect(canManualAssign(state, "m0", "p2", 10, true).ok).toBe(true);
  });

  it("prezzo che violerebbe I3: rifiutato, e force non lo salva", () => {
    // 4 slot, 500 crediti. Comprando un P restano 3 slot: il prezzo massimo
    // sostenibile è 497, perché 3 crediti devono restare per i 3 slot vuoti.
    const state = base();
    expect(canManualAssign(state, "m0", "p1", 497, false).ok).toBe(true);
    for (const force of [false, true]) {
      const result = canManualAssign(state, "m0", "p1", 498, force);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("ADJUST_VIOLATES_I3");
    }
  });

  it("I3 si valuta sui crediti veri, ledger compreso", () => {
    const state = makeState({
      players: [player("p1", "P")],
      ledger: [{ memberId: "m0", delta: -450 }],
    });
    // 50 crediti, 4 slot: comprando il P restano 3 slot → prezzo max 47.
    expect(canManualAssign(state, "m0", "p1", 47, false).ok).toBe(true);
    expect(canManualAssign(state, "m0", "p1", 48, false).ok).toBe(false);
  });

  it("il prezzo è un intero di almeno 1 credito", () => {
    for (const price of [0, -5, 1.5, Number.NaN]) {
      const result = canManualAssign(base(), "m0", "p1", price, false);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("INVALID_AMOUNT");
    }
  });

  it("membro o giocatore inesistenti → errori distinti", () => {
    const state = base();
    const noMember = canManualAssign(state, "mX", "p1", 10, false);
    expect(noMember.ok).toBe(false);
    if (!noMember.ok) expect(noMember.error.code).toBe("MEMBER_NOT_FOUND");

    const noPlayer = canManualAssign(state, "m0", "pX", 10, false);
    expect(noPlayer.ok).toBe(false);
    if (!noPlayer.ok) expect(noPlayer.error.code).toBe("PLAYER_NOT_FOUND");
  });

  it("con force e un ruolo in overflow, I3 resta valutata sul residuo vero (⚠ P2)", () => {
    // m0 ha già il suo unico P e ne prende un secondo con force: gli slot
    // residui restano 3 (P non scende sotto zero), quindi il tetto è 497 − 30.
    const state = makeState({
      players: [player("p1", "P"), player("p2", "P")],
      assignments: [assignment(1, "m0", "p1", 30)],
    });
    expect(canManualAssign(state, "m0", "p2", 467, true).ok).toBe(true);
    expect(canManualAssign(state, "m0", "p2", 468, true).ok).toBe(false);
  });
});

describe("autoPick — F2-05", () => {
  it("sceglie il miglior disponibile del ruolo per fvm DESC", () => {
    const state = makeState({
      players: [
        player("p1", "P", { fvm: 10 }),
        player("p2", "P", { fvm: 80 }),
        player("p3", "D", { fvm: 99 }), // ruolo sbagliato
      ],
    });
    expect(autoPick(state, "P")?.id).toBe("p2");
  });

  it("§12.4 — a pari fvm risolve su quot, poi su ext_id", () => {
    const state = makeState({
      players: [
        player("a", "P", { fvm: 80, quot: 20, extId: 30 }),
        player("b", "P", { fvm: 80, quot: 25, extId: 40 }),
        player("c", "P", { fvm: 80, quot: 25, extId: 20 }),
      ],
    });
    // fvm pari per tutti → quot 25 batte 20 → fra b e c vince ext_id minore.
    expect(autoPick(state, "P")?.id).toBe("c");
  });

  it("esclude gli assegnati (ma non quelli con assegnazione annullata)", () => {
    const state = makeState({
      players: [
        player("p1", "P", { fvm: 90 }),
        player("p2", "P", { fvm: 50 }),
      ],
      assignments: [
        assignment(1, "m1", "p1", 10),
        assignment(2, "m1", "p2", 10, { voidedAt: 5 }),
      ],
    });
    expect(autoPick(state, "P")?.id).toBe("p2");
  });

  it("esclude i fuori lista, a meno che il toggle non li includa (⚠ P7)", () => {
    const players = [
      player("fl", "P", { fvm: 90, outOfList: true }),
      player("ok", "P", { fvm: 50 }),
    ];
    expect(autoPick(makeState({ players }), "P")?.id).toBe("ok");
    expect(
      autoPick(
        makeState({ players, config: { includeOutOfList: true } }),
        "P",
      )?.id,
    ).toBe("fl");
  });

  it("restituisce null se il ruolo non ha disponibili", () => {
    const state = makeState({ players: [player("p1", "D")] });
    expect(autoPick(state, "P")).toBeNull();
  });
});

function round(
  roundNo: 1 | 2,
  bids: LotRound["bids"],
  minAmount = 1,
): LotRound {
  return {
    roundNo,
    minAmount,
    startsAt: T0,
    endsAt: T0 + sec(30),
    closedAt: null,
    eligibleMemberIds: bids.map((b) => b.memberId),
    bids,
  };
}

describe("resolveRound — F2-06", () => {
  it("§12.1 — tre offerte diverse → vince la più alta", () => {
    const outcome = resolveRound(
      round(1, [
        bid(1, "m0", 10, T0 + sec(1)),
        bid(2, "m1", 30, T0 + sec(2)),
        bid(3, "m2", 20, T0 + sec(3)),
      ]),
    );
    expect(outcome).toEqual({ kind: "WINNER", bid: expect.objectContaining({ memberId: "m1", amount: 30 }) });
  });

  it("le offerte ritirate sono escluse dalla risoluzione (§12.7)", () => {
    const outcome = resolveRound(
      round(1, [
        bid(1, "m0", 10, T0 + sec(1)),
        bid(2, "m1", 30, T0 + sec(2), { withdrawnAt: T0 + sec(5) }),
      ]),
    );
    expect(outcome).toEqual({
      kind: "WINNER",
      bid: expect.objectContaining({ memberId: "m0" }),
    });
  });

  it("pareggio sul massimo nel round 1 → TIE con i soli pareggianti (§12.9, §12.13)", () => {
    const outcome = resolveRound(
      round(1, [
        bid(1, "m0", 50, T0 + sec(2)),
        bid(2, "m1", 50, T0 + sec(25)),
        bid(3, "m2", 50, T0 + sec(10)),
        bid(4, "m3", 20, T0 + sec(1)),
      ]),
    );
    expect(outcome.kind).toBe("TIE");
    if (outcome.kind === "TIE") {
      expect(outcome.amount).toBe(50);
      expect(outcome.bids.map((b) => b.memberId).sort()).toEqual([
        "m0",
        "m1",
        "m2",
      ]);
    }
  });

  it("§12.11 — pareggio nel round 2 → vince l'amount_set_at più vecchio", () => {
    const outcome = resolveRound(
      round(
        2,
        [bid(5, "m0", 50, T0 + sec(2)), bid(6, "m1", 50, T0 + sec(25))],
        50,
      ),
    );
    expect(outcome).toEqual({
      kind: "WINNER",
      bid: expect.objectContaining({ memberId: "m0" }),
    });
  });

  it("round 2 a timestamp identici → vince l'id di offerta minore", () => {
    const outcome = resolveRound(
      round(2, [bid(6, "m1", 50, T0), bid(5, "m0", 50, T0)], 50),
    );
    expect(outcome).toEqual({
      kind: "WINNER",
      bid: expect.objectContaining({ memberId: "m0" }),
    });
  });
});

describe("nextSeat — F2-07", () => {
  it("§12.23 — salta i membri con il ruolo pieno, con wrap-around", () => {
    // m1 e m2 hanno il ruolo P pieno; dal seat 0 il prossimo libero è il 3.
    const state = makeState({
      players: [player("p1", "P"), player("p2", "P")],
      assignments: [
        assignment(1, "m1", "p1", 10),
        assignment(2, "m2", "p2", 10),
      ],
    });
    expect(nextSeat(state, "P", 0)).toBe(3);
    // Dal seat 3 si torna allo 0: wrap-around.
    expect(nextSeat(state, "P", 3)).toBe(0);
  });

  it("può tornare sullo stesso seat se è l'unico con uno slot libero", () => {
    const state = makeState({
      players: [player("p1", "P"), player("p2", "P"), player("p3", "P")],
      assignments: [
        assignment(1, "m0", "p1", 10),
        assignment(2, "m1", "p2", 10),
        assignment(3, "m3", "p3", 10),
      ],
    });
    expect(nextSeat(state, "P", 2)).toBe(2);
  });

  it("restituisce null se nessuno ha slot liberi nel ruolo", () => {
    const state = makeState({
      players: [
        player("p1", "P"),
        player("p2", "P"),
        player("p3", "P"),
        player("p4", "P"),
      ],
      assignments: [
        assignment(1, "m0", "p1", 10),
        assignment(2, "m1", "p2", 10),
        assignment(3, "m2", "p3", 10),
        assignment(4, "m3", "p4", 10),
      ],
    });
    expect(nextSeat(state, "P", 1)).toBeNull();
  });
});

describe("nextRole — F2-08 (⚠ P9)", () => {
  // Aste a 2 membri e roleOrder di default per leggere i casi a colpo d'occhio.
  const twoMembers = [member(0), member(1)];

  function fillRole(
    ids: string[],
    role: "P" | "D" | "C" | "A",
    startId: number,
  ) {
    return ids.flatMap((m, i) => [
      assignment(startId + i, m, `${role}${i}`, 1),
    ]);
  }

  it("avanza al ruolo successivo in role_order", () => {
    const state = makeState({
      members: twoMembers,
      config: { seats: 2 },
      players: [player("P0", "P"), player("P1", "P")],
      assignments: fillRole(["m0", "m1"], "P", 1),
    });
    expect(nextRole(state, "P")).toBe("D");
  });

  it("salta un ruolo intermedio già pieno per tutti (possibile dopo manualAssign)", () => {
    const state = makeState({
      members: twoMembers,
      config: { seats: 2 },
      players: [
        player("P0", "P"),
        player("P1", "P"),
        player("D0", "D"),
        player("D1", "D"),
      ],
      assignments: [
        ...fillRole(["m0", "m1"], "P", 1),
        ...fillRole(["m0", "m1"], "D", 3),
      ],
    });
    expect(nextRole(state, "P")).toBe("C");
  });

  it("un ruolo pieno solo per qualcuno non viene saltato", () => {
    const state = makeState({
      members: twoMembers,
      config: { seats: 2 },
      players: [player("P0", "P"), player("P1", "P"), player("D0", "D")],
      assignments: [...fillRole(["m0", "m1"], "P", 1), assignment(3, "m0", "D0", 1)],
    });
    expect(nextRole(state, "P")).toBe("D");
  });

  it("§12.24 — nessun ruolo residuo → null (COMPLETED)", () => {
    const state = makeState({
      members: twoMembers,
      config: { seats: 2 },
      players: (["P", "D", "C", "A"] as const).flatMap((r) => [
        player(`${r}0`, r),
        player(`${r}1`, r),
      ]),
      assignments: (["P", "D", "C", "A"] as const).flatMap((r, i) =>
        fillRole(["m0", "m1"], r, 1 + i * 2),
      ),
    });
    expect(nextRole(state, "A")).toBeNull();
    // E anche partendo da un ruolo intermedio: tutto pieno → null.
    expect(nextRole(state, "P")).toBeNull();
  });

  it("rispetta un role_order personalizzato (§12.21)", () => {
    const state = makeState({
      members: twoMembers,
      config: { seats: 2, roleOrder: ["C", "A", "P", "D"] },
      players: [player("C0", "C"), player("C1", "C")],
      assignments: fillRole(["m0", "m1"], "C", 1),
    });
    expect(nextRole(state, "C")).toBe("A");
  });
});
