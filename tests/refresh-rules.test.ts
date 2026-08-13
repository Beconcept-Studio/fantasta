import { describe, expect, it } from "vitest";

import {
  BACKOFF_MS,
  REFRESH_EVERY_MS,
  type LastAttempt,
  nextAttemptAt,
  shouldAttempt,
  waitAfter,
} from "@/lib/engine/refresh-rules";

/**
 * La decisione «si riprova adesso?», senza database e senza rete (M11-03).
 *
 * ⚠ Questi test valgono più dei loro tre secondi: la regola che provano è
 * l'unica di M11 che, sbagliata, **non si vede in locale**. Un conto fatto
 * sull'ultimo *successo* invece che sull'ultimo *tentativo* passerebbe ogni prova
 * a mano — il pannello direbbe le cose giuste, i dati sarebbero quelli giusti — e
 * si manifesterebbe soltanto come novantasei richieste al giorno verso un sito
 * che non è nostro.
 */

const HOUR = 60 * 60 * 1000;
const t0 = Date.UTC(2026, 7, 13, 4, 0, 0);

function attempt(over: Partial<LastAttempt> = {}): LastAttempt {
  return { attemptedAt: t0, ok: true, failures: 0, ...over };
}

describe("shouldAttempt — i sei casi della spec", () => {
  it("mai provato → sì, e subito", () => {
    // È lo stato in cui `source_runs` nasce in produzione.
    expect(shouldAttempt(null, t0)).toBe(true);
  });

  it("riuscito 23 h fa → no", () => {
    expect(shouldAttempt(attempt(), t0 + 23 * HOUR)).toBe(false);
  });

  it("riuscito 25 h fa → sì", () => {
    expect(shouldAttempt(attempt(), t0 + 25 * HOUR)).toBe(true);
  });

  it("fallito una volta 30 minuti fa → no", () => {
    const last = attempt({ ok: false, failures: 1 });
    expect(shouldAttempt(last, t0 + 30 * 60 * 1000)).toBe(false);
  });

  it("fallito una volta 90 minuti fa → sì", () => {
    const last = attempt({ ok: false, failures: 1 });
    expect(shouldAttempt(last, t0 + 90 * 60 * 1000)).toBe(true);
  });

  it("fallito sei volte 20 h fa → no", () => {
    const last = attempt({ ok: false, failures: 6 });
    expect(shouldAttempt(last, t0 + 20 * HOUR)).toBe(false);
  });
});

describe("il backoff", () => {
  it("cresce 1h → 2h → 4h → 8h → 16h → 24h e poi si ferma", () => {
    const waits = [1, 2, 3, 4, 5, 6, 7, 20].map((failures) =>
      waitAfter({ attemptedAt: t0, ok: false, failures }),
    );
    expect(waits).toEqual([
      1 * HOUR,
      2 * HOUR,
      4 * HOUR,
      8 * HOUR,
      16 * HOUR,
      24 * HOUR,
      // Oltre la scala resta 24h: sopra il giorno il backoff smette di
      // proteggere qualcuno e comincia solo a ritardare la ripresa.
      24 * HOUR,
      24 * HOUR,
    ]);
  });

  it("⚠ e una fonte giù per un giorno costa cinque richieste, non novantasei", () => {
    // Il conto che ha deciso la spec: quindici minuti di tick per ventiquattro
    // ore sarebbero 96 tentativi. Qui si simula il giro vero — il tick chiede,
    // e riprova solo quando la scala glielo permette: t0, +1h, +3h, +7h, +15h, e
    // il sesto cade a +31h, cioè fuori dalla giornata.
    let last: LastAttempt | null = null;
    let attempts = 0;
    for (let now = t0; now <= t0 + 24 * HOUR; now += 15 * 60 * 1000) {
      if (!shouldAttempt(last, now)) continue;
      attempts += 1;
      last = { attemptedAt: now, ok: false, failures: attempts };
    }
    expect(attempts).toBe(5);
  });

  it("un successo azzera l'attesa a ventiquattro ore", () => {
    expect(waitAfter({ attemptedAt: t0, ok: true, failures: 0 })).toBe(
      REFRESH_EVERY_MS,
    );
    // ⚠ `ok` vince su `failures`: la riga è un `upsert`, e chi la scrive azzera
    // il contatore — ma se un giorno non lo facesse, il backoff non deve
    // sopravvivere a un successo.
    expect(waitAfter({ attemptedAt: t0, ok: true, failures: 4 })).toBe(
      REFRESH_EVERY_MS,
    );
  });

  it("un `failures` storto non produce un'attesa negativa né un `undefined`", () => {
    // Difesa di una riga: `failures` a zero su una riga fallita non deve poter
    // far tornare il tick a chiedere ogni quindici minuti.
    expect(waitAfter({ attemptedAt: t0, ok: false, failures: 0 })).toBe(1 * HOUR);
    expect(waitAfter({ attemptedAt: t0, ok: false, failures: -3 })).toBe(1 * HOUR);
    expect(waitAfter({ attemptedAt: t0, ok: false, failures: 999 })).toBe(
      BACKOFF_MS[BACKOFF_MS.length - 1],
    );
  });
});

describe("nextAttemptAt", () => {
  it("è l'istante esatto in cui `shouldAttempt` cambia idea", () => {
    const last = attempt({ ok: false, failures: 2 });
    const next = nextAttemptAt(last);
    expect(next).toBe(t0 + 2 * HOUR);
    expect(shouldAttempt(last, next - 1)).toBe(false);
    expect(shouldAttempt(last, next)).toBe(true);
  });
});
