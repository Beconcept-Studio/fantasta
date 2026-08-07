import { describe, expect, it } from "vitest";

import {
  acceptSnapshot,
  clockOffset,
  remainingMs,
} from "@/lib/realtime/use-auction-stream";
import type { Snapshot } from "@/lib/realtime/types";

/**
 * F4-07 — le tre funzioni pure dell'hook: l'offset dell'orologio, il tempo
 * residuo e lo scarto delle versioni vecchie. Sono estratte apposta dal
 * `useEffect`: è la parte che può sbagliare in silenzio, ed è collaudabile
 * senza un browser.
 */

const T = Date.parse("2026-08-07T20:00:00.000Z");

describe("clock offset", () => {
  it("un client indietro di 20 secondi ottiene un offset positivo", () => {
    expect(clockOffset(new Date(T).toISOString(), T - 20_000)).toBe(20_000);
  });

  it("un client avanti di 5 secondi ottiene un offset negativo", () => {
    expect(clockOffset(new Date(T).toISOString(), T + 5_000)).toBe(-5_000);
  });

  it("il countdown usa l'offset, non l'orologio del telefono", () => {
    // Scadenza fra 30s secondo il server; il telefono è avanti di 20s.
    const deadline = new Date(T + 30_000).toISOString();
    const offset = clockOffset(new Date(T).toISOString(), T + 20_000);
    expect(remainingMs(deadline, offset, T + 20_000)).toBe(30_000);
  });

  it("una scadenza passata vale zero, mai un numero negativo", () => {
    expect(remainingMs(new Date(T - 1_000).toISOString(), 0, T)).toBe(0);
  });

  it("senza scadenza non c'è countdown", () => {
    expect(remainingMs(null, 0, T)).toBeNull();
  });
});

describe("scarto degli snapshot superati", () => {
  const withVersion = (stateVersion: number) => ({ stateVersion }) as Snapshot;

  it("il primo snapshot si accetta sempre", () => {
    expect(acceptSnapshot(null, withVersion(0))).toBe(true);
  });

  it("una versione più alta sostituisce quella corrente", () => {
    expect(acceptSnapshot(withVersion(7), withVersion(8))).toBe(true);
  });

  it("una versione più bassa si butta", () => {
    // Il caso vero: il broadcast di una mutazione sorpassa lo snapshot
    // iniziale della connessione appena aperta.
    expect(acceptSnapshot(withVersion(9), withVersion(8))).toBe(false);
  });

  it("la stessa versione si accetta (presence e serverNow cambiano senza bump)", () => {
    expect(acceptSnapshot(withVersion(9), withVersion(9))).toBe(true);
  });
});
