import { describe, expect, it } from "vitest";

import {
  absentMembers,
  assignablePlayers,
  managerControls,
  overrideControls,
  presenceAlert,
  spentCredits,
} from "@/lib/realtime/manage";
import { phaseLabel } from "@/lib/realtime/portal";

import { ME, OTHER, THIRD, iso, lot, member, snapshot } from "./snapshot-factory";

/**
 * Fase 6 — le funzioni pure del portale manager e della vista TV.
 *
 * Stessa disciplina della Fase 5: se ogni schermata è funzione dello snapshot
 * (regola 7), allora «si può avviare?», «chi manca all'appello?» e «dove siamo,
 * in tre parole» sono funzioni pure, e si provano senza aprire un browser. Il
 * pulsante che chiedono di disegnare è la parte facile: quella che decide se
 * abilitarlo è questa, ed è anche l'unica che il server ripete comunque
 * (regola 6).
 */

const readyAuction = () => {
  const base = snapshot().auction;
  return {
    ...base,
    status: "READY" as const,
    phase: null,
    phaseDeadline: null,
    currentRole: null,
    currentSeatIndex: null,
    currentMemberId: null,
  };
};

const ready = (members = snapshot().members) =>
  snapshot({ auction: readyAuction(), members, currentLot: null });

// ─── Il cancello d'avvio (F6-02) ─────────────────────────────────────────────

describe("avvio dell'asta", () => {
  it("con tutti i membri collegati si può partire", () => {
    const controls = managerControls(ready());
    expect(controls.canStart).toBe(true);
    expect(controls.startBlocked).toBeNull();
  });

  it("un membro in secondo piano blocca l'avvio, e si sa quale", () => {
    // ⚠ Il cancello di `startAuction` pretende LIVE, non "non OFFLINE": chi ha
    // il telefono in tasca scoprirebbe l'asta partita dopo il primo lotto.
    const s = ready([
      member(ME, 0),
      member(OTHER, 1, { presence: "IDLE", teamName: "I Distratti" }),
      member(THIRD, 2),
    ]);
    expect(managerControls(s).canStart).toBe(false);
    expect(managerControls(s).startBlocked).toContain("I Distratti");
  });

  it("un membro non collegato blocca l'avvio", () => {
    const s = ready([
      member(ME, 0),
      member(OTHER, 1),
      member(THIRD, 2, { presence: "OFFLINE", teamName: "Gli Assenti" }),
    ]);
    expect(managerControls(s).canStart).toBe(false);
    expect(managerControls(s).startBlocked).toContain("Gli Assenti");
  });

  it("ad asta incompleta (DRAFT) non si parte, e il motivo non è la presence", () => {
    const s = snapshot({
      auction: { ...readyAuction(), status: "DRAFT" },
      currentLot: null,
    });
    expect(managerControls(s).canStart).toBe(false);
    expect(managerControls(s).startBlocked).toMatch(/post|partecipant/i);
  });

  it("ad asta già iniziata il pulsante d'avvio non esiste più", () => {
    expect(managerControls(snapshot()).canStart).toBe(false);
    expect(managerControls(snapshot()).startBlocked).toMatch(/già|corso/i);
  });

  it("ad asta finita non si riparte", () => {
    const s = snapshot({
      auction: { ...readyAuction(), status: "COMPLETED" },
      currentLot: null,
    });
    expect(managerControls(s).canStart).toBe(false);
  });
});

// ─── Pausa e ripresa (F6-03) ─────────────────────────────────────────────────

describe("pausa e ripresa", () => {
  it("ad asta LIVE si può mettere in pausa, e non riprendere", () => {
    const controls = managerControls(snapshot());
    expect(controls.canPause).toBe(true);
    expect(controls.canResume).toBe(false);
  });

  it("ad asta in pausa si può riprendere, e non ripausare", () => {
    const s = snapshot({
      auction: { ...snapshot().auction, status: "PAUSED", pausedAt: iso(-2_000) },
    });
    expect(managerControls(s).canPause).toBe(false);
    expect(managerControls(s).canResume).toBe(true);
  });

  it("prima dell'avvio e dopo la fine non c'è niente da mettere in pausa", () => {
    expect(managerControls(ready()).canPause).toBe(false);
    const finita = snapshot({
      auction: { ...readyAuction(), status: "COMPLETED" },
      currentLot: null,
    });
    expect(managerControls(finita).canPause).toBe(false);
    expect(managerControls(finita).canResume).toBe(false);
  });
});

// ─── L'alert di presence (F6-04) ─────────────────────────────────────────────

describe("chi manca all'appello", () => {
  it("gli assenti sono in ordine di posto, e sono tutti i non-LIVE", () => {
    const s = snapshot({
      members: [
        member(ME, 0, { presence: "OFFLINE" }),
        member(OTHER, 1),
        member(THIRD, 2, { presence: "IDLE" }),
      ],
    });
    expect(absentMembers(s).map((m) => m.id)).toEqual([ME, THIRD]);
  });

  it("ad asta iniziata chi è caduto genera un alert, distinto da chi è in background", () => {
    const s = snapshot({
      members: [
        member(ME, 0),
        member(OTHER, 1, { presence: "OFFLINE" }),
        member(THIRD, 2, { presence: "IDLE" }),
      ],
    });
    const alert = presenceAlert(s);
    expect(alert?.offline.map((m) => m.id)).toEqual([OTHER]);
    expect(alert?.idle.map((m) => m.id)).toEqual([THIRD]);
  });

  it("l'alert vale anche in pausa: la pausa non è una riconnessione", () => {
    const s = snapshot({
      auction: { ...snapshot().auction, status: "PAUSED", pausedAt: iso(-2_000) },
      members: [member(ME, 0), member(OTHER, 1, { presence: "OFFLINE" }), member(THIRD, 2)],
    });
    expect(presenceAlert(s)?.offline.map((m) => m.id)).toEqual([OTHER]);
  });

  it("con tutti collegati non c'è nessun alert", () => {
    expect(presenceAlert(snapshot())).toBeNull();
  });

  it("prima dell'avvio l'alert non esiste: lì i pallini sono il cancello, non un guasto", () => {
    const s = ready([member(ME, 0), member(OTHER, 1, { presence: "OFFLINE" }), member(THIRD, 2)]);
    expect(presenceAlert(s)).toBeNull();
  });
});

// ─── Il recap (F6-01) ────────────────────────────────────────────────────────

describe("recap delle rose", () => {
  it("lo speso è la somma dei prezzi pagati, e coi crediti torna il budget", () => {
    const me = member(ME, 0, {
      credits: 420,
      roster: [
        { assignmentId: "a1", playerId: "p1", name: "Lautaro", role: "A", team: "Inter", price: 60 },
        { assignmentId: "a2", playerId: "p2", name: "Sommer", role: "P", team: "Inter", price: 20 },
      ],
    });
    expect(spentCredits(me)).toBe(80);
    expect(spentCredits(me) + me.credits).toBe(500);
  });

  it("una rosa vuota non ha speso niente", () => {
    expect(spentCredits(member(ME, 0))).toBe(0);
  });
});

// ─── Dove siamo, in tre parole (F6-06) ───────────────────────────────────────

describe("etichetta della fase", () => {
  it("in chiamata dice il ruolo: è la domanda che si fa chi guarda la TV", () => {
    const s = snapshot({
      auction: { ...snapshot().auction, phase: "WAITING_PICK", currentRole: "P" },
      currentLot: null,
    });
    expect(phaseLabel(s)).toBe("chiamata portieri");
  });

  it("distingue le offerte dallo spareggio, che è un round 2", () => {
    expect(phaseLabel(snapshot())).toBe("offerte");
    const spareggio = snapshot({ currentLot: lot({ roundNo: 2, minAmount: 40 }) });
    expect(phaseLabel(spareggio)).toBe("spareggio");
  });

  it("le buste aperte hanno un nome tutto loro", () => {
    const s = snapshot({
      auction: { ...snapshot().auction, phase: "LOT_REVEAL" },
    });
    expect(phaseLabel(s)).toBe("buste aperte");
  });

  it("la pausa vince su tutto: è la prima cosa da leggere in proiezione", () => {
    const s = snapshot({
      auction: { ...snapshot().auction, status: "PAUSED", pausedAt: iso(-1_000) },
    });
    expect(phaseLabel(s)).toBe("in pausa");
  });

  it("prima dell'avvio e a fine asta lo dice", () => {
    expect(phaseLabel(ready())).toBe("non iniziata");
    const finita = snapshot({
      auction: { ...readyAuction(), status: "COMPLETED" },
      currentLot: null,
    });
    expect(phaseLabel(finita)).toBe("finita");
  });
});

// ─── Le correzioni (F7-05) ───────────────────────────────────────────────────

describe("overrideControls — quando si può correggere", () => {
  it("con le buste aperte no, e lo spiega", () => {
    const s = snapshot({ auction: { ...snapshot().auction, phase: "LOT_OPEN" } });
    const controls = overrideControls(s);
    expect(controls.allowed).toBe(false);
    expect(controls.blocked).toMatch(/busta/i);
  });

  it("nemmeno durante lo spareggio", () => {
    const s = snapshot({
      auction: { ...snapshot().auction, phase: "LOT_TIE_PREP" },
    });
    expect(overrideControls(s).allowed).toBe(false);
  });

  it("⚠ P1 — la pausa non apre la porta: congela la fase, non la azzera", () => {
    const s = snapshot({
      auction: {
        ...snapshot().auction,
        status: "PAUSED",
        pausedAt: iso(-1_000),
        phase: "LOT_OPEN",
      },
    });
    expect(overrideControls(s).allowed).toBe(false);
  });

  it("in attesa della chiamata, durante il reveal e ad asta ferma sì", () => {
    for (const phase of ["WAITING_PICK", "LOT_REVEAL"] as const) {
      const s = snapshot({ auction: { ...snapshot().auction, phase } });
      expect(overrideControls(s), phase).toMatchObject({
        allowed: true,
        blocked: null,
      });
    }
    expect(overrideControls(ready()).allowed).toBe(true);
    const finita = snapshot({
      auction: { ...readyAuction(), status: "COMPLETED" },
      currentLot: null,
    });
    expect(overrideControls(finita).allowed).toBe(true);
  });
});

describe("assignablePlayers — chi si può assegnare a mano", () => {
  const pool = [
    { id: "p1", name: "Lautaro", team: "Inter", role: "A" as const, fvm: 300, quot: 30 },
    { id: "p2", name: "Sommer", team: "Inter", role: "P" as const, fvm: 90, quot: 12 },
    { id: "p3", name: "Bastoni", team: "Inter", role: "D" as const, fvm: 120, quot: 15 },
    { id: "p4", name: "Retegui", team: "Atalanta", role: "A" as const, fvm: 250, quot: 29 },
  ];

  const conRosa = snapshot({
    members: [
      member(ME, 0, {
        roster: [
          { assignmentId: "a1", playerId: "p1", name: "Lautaro", role: "A", team: "Inter", price: 60 },
        ],
      }),
      member(OTHER, 1),
      member(THIRD, 2),
    ],
  });

  it("esclude chi ha già un proprietario (I2 non è nemmeno proponibile)", () => {
    expect(assignablePlayers(pool, conRosa, null).map((p) => p.id)).toEqual([
      "p4",
      "p3",
      "p2",
    ]);
  });

  it("senza ruolo li dà tutti: il manager corregge anche fuori dal ruolo corrente", () => {
    const tutti = assignablePlayers(pool, snapshot(), null);
    expect(tutti).toHaveLength(4);
    // Ordinati come l'auto-pick: fvm DESC, poi quot DESC.
    expect(tutti.map((p) => p.id)).toEqual(["p1", "p4", "p3", "p2"]);
  });

  it("con un ruolo filtra su quello", () => {
    expect(assignablePlayers(pool, snapshot(), "A").map((p) => p.id)).toEqual([
      "p1",
      "p4",
    ]);
  });

  it("la ricerca guarda nome e squadra, e non si fa fermare dagli accenti", () => {
    expect(assignablePlayers(pool, snapshot(), null, "inter")).toHaveLength(3);
    expect(assignablePlayers(pool, snapshot(), null, "REtegui")).toHaveLength(1);
    expect(assignablePlayers(pool, snapshot(), null, "nessuno")).toHaveLength(0);
  });
});
