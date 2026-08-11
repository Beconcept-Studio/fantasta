import { describe, expect, it } from "vitest";

import {
  GIORNATE,
  canSeeInsights,
  minutiMedi,
  quotaTitolare,
  showableInsights,
  type PlayerInsights,
} from "@/lib/domain";

/**
 * Le funzioni pure di M8: le tre che traducono i numeri della fonte in qualcosa
 * che si legge sotto un countdown, e il predicato che decide chi li vede.
 *
 * Sta in `tests/` e non in `tests/db/` perché **non vuole Postgres**: è lo stesso
 * taglio di `tests/auction-nav.test.ts`. Se un giorno una di queste funzioni
 * avesse bisogno del database, sarebbe il segno che è finita nel file sbagliato.
 */

/** Una riga di insight plausibile, da modificare caso per caso. */
function insight(over: Partial<PlayerInsights> = {}): PlayerInsights {
  return {
    extId: 531,
    fullName: "Domenico Berardi",
    team: "Sassuolo",
    statsSeason: "current",
    presenze: 26,
    startsEleven: 24,
    minPlayingTime: 1971,
    rigoriFatti: 2,
    rigoriSbagliati: 0,
    rigoriParati: 0,
    fmvHome: 7.19,
    fmvAway: 6.4,
    rigoristaRank: 1,
    piazzatiRank: null,
    ...over,
  };
}

describe("quotaTitolare", () => {
  it("misura le partenze da titolare sulle giornate della stagione, non sulle presenze", () => {
    // I due casi che il file Statistiche di Fantacalcio.it confonde (M8 §2):
    // stesse presenze quasi, storie opposte.
    const berardi = quotaTitolare(insight({ presenze: 26, startsEleven: 24 }));
    const bernardeschi = quotaTitolare(
      insight({ presenze: 24, startsEleven: 12 }),
    );

    expect(berardi).toBeCloseTo(24 / 38, 5);
    expect(bernardeschi).toBeCloseTo(12 / 38, 5);

    // La domanda «quando c'era, partiva?» darebbe 92% e 50%: vera, ma non è
    // quella che si fa mentre scorre un timer.
    expect(berardi).toBeLessThan(24 / 26);
  });

  it("GIORNATE è 38", () => {
    expect(GIORNATE).toBe(38);
  });

  it("⚠ non supera il 100% nemmeno per Thiam, che ha 42 partenze su 38 giornate", () => {
    // Questo caso è **reale**, non inventato: nella risposta salvata in
    // `fixtures/fantalab-listone.json` Thiam ha `starts_eleven: 42`, perché il
    // campo somma più competizioni. Senza clamp la card scriverebbe «110% da
    // titolare», che è la sola cosa peggiore di non scrivere niente.
    expect(quotaTitolare(insight({ startsEleven: 42, presenze: 42 }))).toBe(1);
    expect(quotaTitolare(insight({ startsEleven: 39, presenze: 39 }))).toBe(1);
    expect(quotaTitolare(insight({ startsEleven: 38, presenze: 38 }))).toBe(1);
  });

  it("zero partenze è zero, non un dato mancante", () => {
    expect(quotaTitolare(insight({ startsEleven: 0, presenze: 9 }))).toBe(0);
  });
});

describe("minutiMedi", () => {
  it("distingue il titolare dallo spezzone", () => {
    expect(minutiMedi(insight({ presenze: 26, minPlayingTime: 1971 }))).toBeCloseTo(75.8, 1);
    expect(minutiMedi(insight({ presenze: 24, minPlayingTime: 1212 }))).toBeCloseTo(50.5, 1);
  });

  it("è null senza presenze, non zero: non aver giocato non vuol dire zero minuti a partita", () => {
    expect(minutiMedi(insight({ presenze: 0, minPlayingTime: 0 }))).toBeNull();
  });
});

describe("showableInsights", () => {
  it("passa i numeri della stagione corrente", () => {
    const i = insight({ statsSeason: "current" });
    expect(showableInsights(i)).toBe(i);
  });

  it("⚠ scarta quelli della stagione precedente: sono 168 su 497 e parlano di un altro campionato", () => {
    expect(showableInsights(insight({ statsSeason: "previous" }))).toBeNull();
  });

  it("regge l'assenza, che è il caso del viewer non-pro e della tabella vuota", () => {
    expect(showableInsights(undefined)).toBeNull();
    expect(showableInsights(null)).toBeNull();
  });
});

describe("canSeeInsights", () => {
  it("il pro sì", () => {
    expect(canSeeInsights({ isPro: true, isAdmin: false })).toBe(true);
  });

  it("l'amministratore sì, anche senza il flag: altrimenti dovrebbe accenderselo da sé", () => {
    expect(canSeeInsights({ isPro: false, isAdmin: true })).toBe(true);
  });

  it("chi non è né l'uno né l'altro no", () => {
    expect(canSeeInsights({ isPro: false, isAdmin: false })).toBe(false);
  });

  it("nessuno e non-so sono no, non un'eccezione", () => {
    expect(canSeeInsights(null)).toBe(false);
    expect(canSeeInsights(undefined)).toBe(false);
  });
});
