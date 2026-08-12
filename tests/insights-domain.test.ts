import { describe, expect, it } from "vitest";

import {
  GIORNATE,
  SOGLIA_TITOLARE,
  canSeeInsights,
  minutiMedi,
  quotaTitolare,
  showableInsights,
  titolareForte,
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

describe("titolareForte", () => {
  it("la soglia è l'80%", () => {
    expect(SOGLIA_TITOLARE).toBe(0.8);
  });

  it("⚠ la zona densa di M9 §1: 32/38 è verde, 30/38 è grigio", () => {
    // Due giocatori a due partite di distanza finiscono in due colori, e va bene
    // **solo** perché il badge scrive la percentuale accanto al colore. Il grumo
    // a 32/38 = 84% esiste davvero nella fixture (Çelik, de Roon, Højlund,
    // Marusic, McKennie, Modrić, Murić, Pinamonti): se questo caso viene tolto
    // per pulizia, la prossima persona sposterà la soglia senza sapere di
    // spostare quegli otto.
    expect(titolareForte(insight({ startsEleven: 32, presenze: 34 }))).toBe(true);
    expect(titolareForte(insight({ startsEleven: 30, presenze: 34 }))).toBe(false);
  });

  it("il primo intero verde è 31/38, e la soglia esatta non è raggiungibile", () => {
    // 0,8 × 38 = 30,4: con `startsEleven` intero **nessun giocatore cade sulla
    // soglia esatta**, quindi la direzione del confronto (`>=` invece di `>`) non
    // cambia il colore di nessuno. Vale la pena saperlo prima di «correggere» il
    // predicato: e va provato così, non con un 30,4 finto — `30.4 / 38` in
    // virgola mobile vale 0,7999… e sarebbe grigio, cioè il test direbbe il
    // contrario di quello che vuole dire.
    expect(titolareForte(insight({ startsEleven: 31, presenze: 34 }))).toBe(true);
    expect(titolareForte(insight({ startsEleven: 30, presenze: 34 }))).toBe(false);
  });

  it("chi supera le 38 partenze resta verde, non esce dal clamp", () => {
    // Thiam, `starts_eleven: 42`: `quotaTitolare` lo porta a 1 e il predicato
    // legge quello, non il campo grezzo.
    expect(titolareForte(insight({ startsEleven: 42, presenze: 42 }))).toBe(true);
  });

  it("zero partenze è grigio", () => {
    expect(titolareForte(insight({ startsEleven: 0, presenze: 9 }))).toBe(false);
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
