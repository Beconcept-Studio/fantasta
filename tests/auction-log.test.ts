import { describe, expect, it } from "vitest";

import {
  NOTABLE_EVENT_TYPES,
  describeEvent,
  isNotableEvent,
  isPublicLot,
  lotSearchText,
} from "@/lib/auction-log";

/**
 * La resa in italiano di una riga di `events` (M3 §4), provata senza database:
 * `describeEvent` è una funzione pura che prende tipo e payload e restituisce
 * una frase. I payload di questi test sono copiati da quelli veri che
 * `writeEvent` scrive in `lib/engine/actions.ts` e `lib/engine/override.ts` —
 * se là cambiano, qui deve diventare rosso.
 */

/**
 * M3 §5 — la barriera I8, provata da sola.
 *
 * Questi quattro test esistono per una scoperta fatta rompendo il codice di
 * proposito: in `tests/db/log.test.ts` l'asserzione «le buste del lotto aperto
 * non escono» **passava anche togliendo il filtro sullo stato**, perché
 * `serializeLot` scarta comunque i lotti senza vincitore, e un lotto aperto non
 * ne ha. Il test non stava dimostrando ciò che diceva di dimostrare.
 *
 * Qui il predicato si prova isolato, su un lotto costruito a mano che è `OPEN`
 * **e** ha un vincitore: uno stato che il motore non produce mai, e proprio per
 * questo l'unico che separa questo controllo da tutti gli altri.
 */
describe("isPublicLot — I8, e la riga che lo garantisce", () => {
  it("un lotto risolto è pubblico: le sue buste sono già state aperte", () => {
    expect(isPublicLot({ status: "RESOLVED" })).toBe(true);
  });

  it("un lotto aperto non lo è, ed è tutto il punto dell'invariante", () => {
    expect(isPublicLot({ status: "OPEN" })).toBe(false);
  });

  it("resta fuori anche se avesse già un vincitore, cosa che il motore non fa mai", () => {
    expect(
      isPublicLot({ status: "OPEN", winnerMemberId: "x", finalPrice: 91 }),
    ).toBe(false);
  });

  it("uno stato che non conosciamo non è pubblico", () => {
    expect(isPublicLot({ status: "QUALCOSA_DI_NUOVO" })).toBe(false);
  });
});

describe("describeEvent — gli eventi di conduzione", () => {
  it("racconta l'avvio", () => {
    expect(
      describeEvent({
        type: "START",
        payload: { from: "READY", to: "LIVE/WAITING_PICK", lotId: null },
        lotSeq: null,
      }),
    ).toBe("Asta avviata.");
  });

  it("racconta la pausa e la ripresa", () => {
    expect(describeEvent({ type: "PAUSE", payload: {}, lotSeq: null })).toBe(
      "Asta messa in pausa.",
    );
    expect(describeEvent({ type: "RESUME", payload: {}, lotSeq: null })).toBe(
      "Asta ripresa.",
    );
  });

  it("dice su quale lotto le buste sono state chiuse in anticipo", () => {
    expect(
      describeEvent({ type: "SKIP_REVEAL", payload: {}, lotSeq: 180 }),
    ).toContain("lotto #180");
  });
});

describe("describeEvent — le correzioni, che sono il motivo della pagina", () => {
  it("racconta un'assegnazione manuale con giocatore, squadra e prezzo", () => {
    const text = describeEvent({
      type: "MANUAL_ASSIGN",
      payload: {
        team: "Dinamo Divano",
        player: "Vlahovic",
        price: 88,
        force: false,
      },
      lotSeq: null,
    });
    expect(text).toContain("Vlahovic");
    expect(text).toContain("Dinamo Divano");
    expect(text).toContain("88");
  });

  it("segnala l'assegnazione manuale che ha forzato un vincolo", () => {
    const forced = describeEvent({
      type: "MANUAL_ASSIGN",
      payload: { team: "Bar Sport", player: "Vlahovic", price: 88, force: true },
      lotSeq: null,
    });
    expect(forced).toContain("forzando");
  });

  it("racconta un annullamento e da quale lotto veniva", () => {
    const text = describeEvent({
      type: "VOID_ASSIGNMENT",
      payload: { team: "Bar Sport", player: "Vlahovic", price: 88 },
      lotSeq: 180,
    });
    expect(text).toContain("Annullata");
    expect(text).toContain("Vlahovic");
    expect(text).toContain("lotto #180");
  });

  it("racconta una rettifica di crediti col segno e col motivo", () => {
    expect(
      describeEvent({
        type: "ADJUST_BUDGET",
        payload: { team: "Bar Sport", delta: -12, reason: "penalità ritardo" },
        lotSeq: null,
      }),
    ).toBe("Crediti rettificati: Bar Sport −12 — penalità ritardo.");
  });

  it("scrive il più davanti a una rettifica positiva", () => {
    expect(
      describeEvent({
        type: "ADJUST_BUDGET",
        payload: { team: "Bar Sport", delta: 5, reason: "rimborso" },
        lotSeq: null,
      }),
    ).toContain("+5");
  });
});

/**
 * Il caso che tiene onesta la pagina: un log che nasconde ciò che non sa
 * interpretare è un log di cui non ti fidi. `SEED_FAST_FORWARD` esiste già
 * (`scripts/seed.ts`), e fra un anno ce ne sarà un altro.
 */
describe("describeEvent — il tipo che non conosciamo", () => {
  it("lo rende comunque, invece di farlo sparire", () => {
    const text = describeEvent({
      type: "SEED_FAST_FORWARD",
      payload: { from: "READY", to: "LIVE/WAITING_PICK", actor: "seed" },
      lotSeq: null,
    });
    expect(text).toContain("SEED_FAST_FORWARD");
    expect(text).toContain("READY");
  });

  it("non esplode su un payload nullo", () => {
    expect(() =>
      describeEvent({ type: "QUALCOSA", payload: null, lotSeq: null }),
    ).not.toThrow();
  });
});

describe("isNotableEvent — cosa entra nel blocco delle correzioni", () => {
  it("tiene fuori la routine di un lotto, che il dettaglio racconta meglio", () => {
    for (const type of ["PICK", "PLACE_BID", "WITHDRAW_BID", "ADVANCE"]) {
      expect(isNotableEvent(type), type).toBe(false);
    }
  });

  it("tiene dentro conduzione e correzioni", () => {
    for (const type of NOTABLE_EVENT_TYPES) {
      expect(isNotableEvent(type), type).toBe(true);
    }
    expect(NOTABLE_EVENT_TYPES).toContain("VOID_ASSIGNMENT");
    expect(NOTABLE_EVENT_TYPES).toContain("MANUAL_ASSIGN");
  });

  /**
   * Un tipo sconosciuto **è** notevole: se non sappiamo cosa sia, tacerlo è la
   * scelta peggiore delle due.
   */
  it("tiene dentro un tipo che non conosciamo", () => {
    expect(isNotableEvent("SEED_FAST_FORWARD")).toBe(true);
  });
});

describe("lotSearchText — su cosa filtra il campo di ricerca", () => {
  const lot = {
    seq: 180,
    player: { name: "Vlahovic", role: "A" as const, team: "Juventus" },
    calledByTeamName: "Gli Invincibili",
    winnerTeamName: "Bar Sport",
  };

  it("trova per nome del giocatore, che è la domanda vera di una disputa", () => {
    expect(lotSearchText(lot)).toContain("vlahovic");
  });

  it("trova per squadra reale, per chiamante e per vincitore", () => {
    const text = lotSearchText(lot);
    expect(text).toContain("juventus");
    expect(text).toContain("gli invincibili");
    expect(text).toContain("bar sport");
  });

  it("trova per numero di lotto, col cancelletto e senza", () => {
    expect(lotSearchText(lot)).toContain("#180");
    expect(lotSearchText(lot)).toContain("180");
  });

  it("è tutto minuscolo, così il confronto non deve normalizzare due volte", () => {
    expect(lotSearchText(lot)).toBe(lotSearchText(lot).toLowerCase());
  });
});
