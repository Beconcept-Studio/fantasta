import { describe, expect, it, vi } from "vitest";

import {
  CODE_TTL_MINUTES,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
  attemptsLeft,
  checkCodeUsable,
  checkResendAllowed,
  codeExpiresAt,
  secondsUntilResend,
  wrongCodeMessage,
} from "@/lib/engine/account-rules";

/**
 * Le regole dei codici, con i **fake timer** e non con un `sleep`.
 *
 * È esattamente per poter scrivere questo file che `account-rules.ts` riceve
 * `now` come parametro: «il codice scade dopo quindici minuti» qui costa una
 * riga, e con un `Date.now()` dentro le funzioni sarebbe costato quindici
 * minuti di attesa vera per ogni esecuzione di `pnpm test`.
 */

const T0 = new Date("2026-08-10T20:00:00.000Z");

/** Un istante spostato di `ms` rispetto a T0. */
function at(ms: number): Date {
  return new Date(T0.getTime() + ms);
}

function code(overrides: Partial<Parameters<typeof checkCodeUsable>[0]> = {}) {
  return {
    expiresAt: codeExpiresAt(T0),
    attempts: 0,
    consumedAt: null,
    ...overrides,
  } as NonNullable<Parameters<typeof checkCodeUsable>[0]>;
}

describe("la scadenza del codice", () => {
  it("scade dopo esattamente quindici minuti", () => {
    const row = code();
    expect(checkCodeUsable(row, at(CODE_TTL_MINUTES * 60_000 - 1)).ok).toBe(
      true,
    );

    const expired = checkCodeUsable(row, at(CODE_TTL_MINUTES * 60_000));
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.error.code).toBe("CODE_EXPIRED");
  });

  it("un codice già consumato non si può riusare", () => {
    const used = checkCodeUsable(code({ consumedAt: T0 }), at(1000));
    expect(used.ok).toBe(false);
    if (!used.ok) expect(used.error.code).toBe("CODE_INVALID");
  });

  it("nessun codice è un rifiuto, non un errore da spiegare", () => {
    const none = checkCodeUsable(null, T0);
    expect(none.ok).toBe(false);
    // Ogni messaggio di rifiuto dice cosa fare: farsene mandare un altro.
    if (!none.ok) expect(none.error.message).toMatch(/mandare/i);
  });
});

describe("i cinque tentativi", () => {
  it("al quinto tentativo il codice è bruciato", () => {
    expect(checkCodeUsable(code({ attempts: MAX_ATTEMPTS - 1 }), at(0)).ok).toBe(
      true,
    );

    const burned = checkCodeUsable(code({ attempts: MAX_ATTEMPTS }), at(0));
    expect(burned.ok).toBe(false);
    if (!burned.ok) expect(burned.error.code).toBe("CODE_BURNED");
  });

  it("il messaggio dice quante prove restano, al singolare quando è una", () => {
    const two = wrongCodeMessage(3);
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.error.message).toContain("2 tentativi");

    const one = wrongCodeMessage(4);
    if (!one.ok) expect(one.error.message).toContain("un tentativo");

    const none = wrongCodeMessage(MAX_ATTEMPTS);
    if (!none.ok) expect(none.error.code).toBe("CODE_BURNED");
  });

  it("i tentativi rimasti non vanno mai sotto zero", () => {
    expect(attemptsLeft(code({ attempts: MAX_ATTEMPTS + 3 }))).toBe(0);
    expect(attemptsLeft(code({ attempts: 0 }))).toBe(MAX_ATTEMPTS);
  });
});

describe("il reinvio", () => {
  it("un reinvio prima di sessanta secondi viene rifiutato", () => {
    const refused = checkResendAllowed(T0, at(RESEND_COOLDOWN_SECONDS * 1000 - 1));
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("RESEND_TOO_SOON");
      // Il messaggio dice **quanto** aspettare: «riprova più tardi» non è
      // un'informazione con dodici persone che aspettano.
      expect(refused.error.message).toMatch(/\d+ secondi|un secondo/);
    }
  });

  it("dopo sessanta secondi si può", () => {
    expect(checkResendAllowed(T0, at(RESEND_COOLDOWN_SECONDS * 1000)).ok).toBe(
      true,
    );
  });

  it("il primo invio non aspetta niente", () => {
    expect(checkResendAllowed(null, T0).ok).toBe(true);
    expect(secondsUntilResend(null, T0)).toBe(0);
  });

  it("i secondi che mancano si arrotondano per eccesso", () => {
    // 59.5 secondi passati: ne manca mezzo, e mezzo secondo si dice «1».
    expect(secondsUntilResend(T0, at(59_500))).toBe(1);
    expect(secondsUntilResend(T0, at(0))).toBe(RESEND_COOLDOWN_SECONDS);
  });
});

describe("il tempo non si legge da dentro", () => {
  /**
   * La verifica meccanica della regola 2 applicata per analogia: se una di
   * queste funzioni leggesse l'orologio invece del parametro, con i fake timer
   * fermi su una data del 2020 il verdetto cambierebbe.
   */
  it("il verdetto dipende solo da `now`, non dall'orologio di sistema", () => {
    vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
    const row = code();
    expect(checkCodeUsable(row, at(60_000)).ok).toBe(true);
    expect(checkCodeUsable(row, at(CODE_TTL_MINUTES * 60_000)).ok).toBe(false);
  });
});
