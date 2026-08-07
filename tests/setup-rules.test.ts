import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONFIG,
  isRoleOrder,
  validateAuctionConfig,
  validateRolePool,
  validateTeamName,
} from "@/lib/engine/setup-rules";

/**
 * Le regole di configurazione, provate senza database e senza browser.
 * `validateAuctionConfig` è ciò che sta dietro sia `createAuction` sia
 * `updateAuctionSettings`: quello che qui è rosso, lì è un'asta rifiutata.
 */

const valid = { name: "Asta di prova", ...DEFAULT_CONFIG };

describe("validateAuctionConfig — partecipanti", () => {
  it("accetta 8, 10 e 12", () => {
    for (const seats of [8, 10, 12]) {
      const result = validateAuctionConfig({ ...valid, seats });
      expect(result.ok, `seats=${seats}`).toBe(true);
    }
  });

  it("rifiuta 9 (il segmented control non è un input libero)", () => {
    const result = validateAuctionConfig({ ...valid, seats: 9 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_SEATS");
    expect(result.error.message).toContain("8, 10, 12");
  });

  it("rifiuta un numero di posti non intero o mascherato da stringa", () => {
    for (const seats of ["8", 8.5, null, undefined as never]) {
      const result = validateAuctionConfig({ ...valid, seats });
      // `undefined` significa "non toccare il campo": eredita il default (8).
      if (seats === undefined) expect(result.ok).toBe(true);
      else expect(result.ok, JSON.stringify(seats)).toBe(false);
    }
  });
});

describe("validateAuctionConfig — role_order (test §12.25)", () => {
  it("accetta ogni permutazione completa di P, D, C, A", () => {
    for (const roleOrder of [
      ["P", "D", "C", "A"],
      ["C", "A", "P", "D"],
      ["A", "C", "D", "P"],
    ]) {
      const result = validateAuctionConfig({ ...valid, roleOrder });
      expect(result.ok, roleOrder.join("")).toBe(true);
      if (result.ok) expect(result.value.roleOrder).toEqual(roleOrder);
    }
  });

  it("rifiuta un ruolo ripetuto: ['P','P','C','A']", () => {
    const result = validateAuctionConfig({
      ...valid,
      roleOrder: ["P", "P", "C", "A"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_ROLE_ORDER");
  });

  it("rifiuta una lista incompleta: ['P','D','C']", () => {
    const result = validateAuctionConfig({
      ...valid,
      roleOrder: ["P", "D", "C"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_ROLE_ORDER");
  });

  it("rifiuta ruoli inventati e liste troppo lunghe", () => {
    expect(isRoleOrder(["P", "D", "C", "X"])).toBe(false);
    expect(isRoleOrder(["P", "D", "C", "A", "P"])).toBe(false);
    expect(isRoleOrder("PDCA")).toBe(false);
    expect(isRoleOrder(null)).toBe(false);
  });
});

describe("validateAuctionConfig — budget, slot e timer", () => {
  it("rifiuta un budget che non copre nemmeno uno slot per credito (I3)", () => {
    const result = validateAuctionConfig({ ...valid, budgetDefault: 24 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_BUDGET");
      expect(result.error.message).toContain("25 slot");
    }
  });

  it("accetta un budget pari esattamente al numero di slot", () => {
    const result = validateAuctionConfig({ ...valid, budgetDefault: 25 });
    expect(result.ok).toBe(true);
  });

  it("rifiuta slot a zero", () => {
    const result = validateAuctionConfig({
      ...valid,
      slots: { ...DEFAULT_CONFIG.slots, A: 0 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_SLOTS");
  });

  it("accetta i timer corti del seed di sviluppo (bid 3, pick 3, reveal 2)", () => {
    const result = validateAuctionConfig({
      ...valid,
      bidSeconds: 3,
      pickSeconds: 3,
      revealSeconds: 2,
      tiePrepSeconds: 2,
    });
    expect(result.ok).toBe(true);
  });

  it("rifiuta un timer a zero", () => {
    const result = validateAuctionConfig({ ...valid, bidSeconds: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TIMERS");
  });

  it("normalizza il nome e rifiuta quelli troppo corti", () => {
    const spaced = validateAuctionConfig({ ...valid, name: "  Lega   Rossi  " });
    expect(spaced.ok).toBe(true);
    if (spaced.ok) expect(spaced.value.name).toBe("Lega Rossi");

    const short = validateAuctionConfig({ ...valid, name: "ab" });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error.code).toBe("INVALID_NAME");
  });
});

describe("validateRolePool — invariante I9", () => {
  const slots = { P: 3, D: 8, C: 8, A: 6 };

  it("accetta il listone di riferimento a 12 partecipanti", () => {
    const result = validateRolePool({
      counts: { P: 61, D: 177, C: 172, A: 85 },
      slots,
      seats: 12,
    });
    expect(result.ok).toBe(true);
  });

  it("accetta il caso esatto, senza margine", () => {
    const result = validateRolePool({
      counts: { P: 36, D: 96, C: 96, A: 72 },
      slots,
      seats: 12,
    });
    expect(result.ok).toBe(true);
  });

  it("rifiuta un listone povero di attaccanti nominando il ruolo e i numeri", () => {
    const result = validateRolePool({
      counts: { P: 61, D: 177, C: 172, A: 40 },
      slots,
      seats: 12,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("LISTONE_INSUFFICIENT");
    expect(result.error.message).toContain("Attaccanti");
    expect(result.error.message).toContain("(A)");
    expect(result.error.message).toContain("72"); // 6 slot × 12 partecipanti
    expect(result.error.message).toContain("40"); // quelli che ci sono
    // Un solo ruolo in difetto: gli altri non devono comparire.
    expect(result.error.message).not.toContain("Portieri");
  });

  it("elenca tutti i ruoli in difetto, non solo il primo", () => {
    const result = validateRolePool({
      counts: { P: 10, D: 177, C: 172, A: 40 },
      slots,
      seats: 12,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("Portieri");
    expect(result.error.message).toContain("Attaccanti");
  });

  it("lo stesso listone può bastare a 8 e non a 12", () => {
    const counts = { P: 30, D: 96, C: 96, A: 72 };
    expect(validateRolePool({ counts, slots, seats: 8 }).ok).toBe(true);
    expect(validateRolePool({ counts, slots, seats: 12 }).ok).toBe(false);
  });
});

describe("validateTeamName", () => {
  it("normalizza gli spazi", () => {
    const result = validateTeamName("  Real   Fantozzi ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("Real Fantozzi");
  });

  it("rifiuta il vuoto e i nomi troppo corti", () => {
    for (const value of ["", "  ", "ab", null, 42]) {
      const result = validateTeamName(value);
      expect(result.ok, JSON.stringify(value)).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("INVALID_TEAM_NAME");
    }
  });
});
