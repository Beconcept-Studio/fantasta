import { beforeEach, describe, expect, it } from "vitest";

import {
  LOGIN_BY_EMAIL,
  clearAllLimits,
  clientIp,
  hit,
  remaining,
  reset,
} from "@/lib/rate-limit";

/**
 * Il limitatore in memoria.
 *
 * `now` è un parametro anche qui — con un default a `Date.now()` per i
 * chiamanti veri, ma esplicito nei test: far scadere una finestra di quindici
 * minuti richiede di spostare l'orologio, non di aspettare.
 */

const T0 = 1_760_000_000_000;

beforeEach(() => {
  clearAllLimits();
});

describe("la soglia", () => {
  it("passa fino al limite e poi rifiuta", () => {
    for (let i = 0; i < LOGIN_BY_EMAIL.limit; i += 1) {
      expect(
        hit("k", LOGIN_BY_EMAIL.limit, LOGIN_BY_EMAIL.windowSeconds, T0).allowed,
      ).toBe(true);
    }
    const refused = hit(
      "k",
      LOGIN_BY_EMAIL.limit,
      LOGIN_BY_EMAIL.windowSeconds,
      T0,
    );
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) {
      // Deve poter dire quanto aspettare: «troppi tentativi» e basta non è
      // un'informazione con dodici persone in piedi accanto alla TV.
      expect(refused.retryAfterSeconds).toBe(LOGIN_BY_EMAIL.windowSeconds);
    }
  });

  it("la finestra è fissa: allo scadere il conteggio riparte da zero", () => {
    for (let i = 0; i < 10; i += 1) hit("k", 10, 900, T0);
    expect(hit("k", 10, 900, T0).allowed).toBe(false);

    expect(hit("k", 10, 900, T0 + 900_000).allowed).toBe(true);
    expect(remaining("k", 10, T0 + 900_000)).toBe(9);
  });

  it("chiavi diverse non si disturbano", () => {
    for (let i = 0; i < 10; i += 1) hit("mario", 10, 900, T0);
    expect(hit("mario", 10, 900, T0).allowed).toBe(false);
    expect(hit("luca", 10, 900, T0).allowed).toBe(true);
  });
});

describe("l'azzeramento al successo", () => {
  it("un login riuscito rimette il contatore a zero", () => {
    for (let i = 0; i < 9; i += 1) hit("mario", 10, 900, T0);
    expect(remaining("mario", 10, T0)).toBe(1);

    reset("mario");

    expect(remaining("mario", 10, T0)).toBe(10);
    // Senza questo, chi ha sbagliato nove volte e poi si è ricordato la
    // password resterebbe a un tentativo dal blocco per un quarto d'ora.
    expect(hit("mario", 10, 900, T0).allowed).toBe(true);
  });
});

describe("lo sfratto", () => {
  it("le chiavi scadute non si accumulano all'infinito", () => {
    // Diecimila chiavi che scadono subito, e poi una nuova: il tetto scatta e
    // le scadute se ne vanno senza nessun timer.
    for (let i = 0; i < 10_000; i += 1) hit(`vecchia-${i}`, 1, 60, T0);
    const dopo = T0 + 61_000;
    hit("nuova", 1, 60, dopo);

    // Le vecchie sono state sfrattate: se fossero ancora lì, il contatore di
    // una di loro sarebbe rimasto a 1 e non a 0.
    expect(remaining("vecchia-0", 1, dopo)).toBe(1);
  });
});

describe("l'indirizzo IP dietro nginx", () => {
  it("legge X-Forwarded-For", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7" });
    expect(clientIp(headers)).toBe("203.0.113.7");
  });

  /**
   * ⚠ Il test che spiega perché si prende l'**ultimo** elemento.
   *
   * `$proxy_add_x_forwarded_for` **accoda** al valore ricevuto dal client
   * invece di sostituirlo. Prendendo il primo — che è la lettura ovvia della
   * specifica dell'header — chiunque potrebbe scegliersi il proprio IP a ogni
   * richiesta e il limite non limiterebbe più niente.
   */
  it("scarta la parte che il client si è scritto da solo", () => {
    const headers = new Headers({
      "x-forwarded-for": "1.2.3.4, 5.6.7.8, 203.0.113.7",
    });
    expect(clientIp(headers)).toBe("203.0.113.7");
  });

  it("senza header non lancia: una chiave vale l'altra, purché ce ne sia una", () => {
    expect(clientIp(new Headers())).toBe("sconosciuto");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.9" }))).toBe(
      "198.51.100.9",
    );
  });
});
