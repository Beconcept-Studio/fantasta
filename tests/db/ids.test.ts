import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { startAuction } from "@/lib/engine/actions";
import { isUuid } from "@/lib/engine/ids";
import { setBroadcastHook, withAuctionLock } from "@/lib/engine/mutate";
import { getAuctionOverview } from "@/lib/engine/setup";
import { resolveViewer } from "@/lib/engine/viewer";

import { closeDatabase, databaseAvailable, makeUser, dropUsers } from "./helpers";

/**
 * F7-07bis — un id malformato è un 404, non un 500.
 *
 * Il difetto veniva dal collaudo della Fase 5: un `POST` su
 * `/api/auctions/undefined/action` faceva arrivare la stringa fino a Postgres,
 * che rifiutava l'uuid con un'eccezione — quindi 500, la risposta che
 * l'applicazione riserva ai propri bug. PLAN §17 vuole un codice tipizzato per
 * ogni rifiuto, e un URL sbagliato è un rifiuto come gli altri.
 *
 * I test stanno sui due imbuti da cui passano le tre rotte con `:id`:
 * `withAuctionLock` (usata da ogni azione, quindi da `action`) e
 * `resolveViewer` (usata da `stream` e `heartbeat`). Che il database sia acceso
 * conta: senza la guardia questi stessi test **esploderebbero** invece di
 * fallire con un'asserzione, ed è esattamente il sintomo che si vuole spegnere.
 */

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn("\n⚠ Postgres non raggiungibile: i test degli id sono saltati.\n");
}

const createdUsers: string[] = [];

afterAll(async () => {
  if (!dbUp) return;
  await dropUsers(createdUsers);
  await closeDatabase();
});

/** Gli id che nella pratica finiscono davvero in un URL. */
const MALFORMED = [
  "undefined",
  "null",
  "",
  "123",
  "not-a-uuid",
  // Quasi giusto: un carattere in più. Postgres lo rifiuta come tutti gli altri.
  "0b1a1f9c-6f1e-4a3f-9d2b-2f8a7c6e5d4c1",
];

describe("isUuid", () => {
  it("accetta un uuid vero, in maiuscolo o minuscolo", () => {
    expect(isUuid("0b1a1f9c-6f1e-4a3f-9d2b-2f8a7c6e5d4c")).toBe(true);
    expect(isUuid("0B1A1F9C-6F1E-4A3F-9D2B-2F8A7C6E5D4C")).toBe(true);
  });

  it("rifiuta tutto ciò che uuid non è", () => {
    for (const value of MALFORMED) expect(isUuid(value)).toBe(false);
  });
});

describe.runIf(dbUp)("F7-07bis — le rotte con :id davanti a un id malformato", () => {
  beforeEach(() => {
    vi.useRealTimers(); // pg fa I/O vero
    setBroadcastHook(() => {});
  });

  it("withAuctionLock (rotta `action`) → NOT_FOUND, senza eccezioni", async () => {
    const user = await makeUser("bad-id");
    createdUsers.push(user);

    for (const id of MALFORMED) {
      const result = await startAuction(user, id, 0);
      expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    }

    // E il lock non è nemmeno stato aperto: il corpo non gira.
    let bodyRan = false;
    const direct = await withAuctionLock("undefined", async () => {
      bodyRan = true;
      return { result: { ok: true as const, value: null }, mutated: false };
    });
    expect(bodyRan).toBe(false);
    expect(direct).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("resolveViewer (rotte `stream` e `heartbeat`) → NOT_FOUND", async () => {
    const user = await makeUser("bad-id-viewer");
    createdUsers.push(user);

    for (const id of MALFORMED) {
      // Sia con una sessione sia con il token della TV: la guardia viene prima.
      expect(await resolveViewer(id, user, null)).toMatchObject({
        ok: false,
        error: { code: "NOT_FOUND" },
      });
      expect(await resolveViewer(id, null, "un-token-qualsiasi")).toMatchObject({
        ok: false,
        error: { code: "NOT_FOUND" },
      });
    }
  });

  it("le letture delle pagine danno `null`, cioè il loro notFound()", async () => {
    const user = await makeUser("bad-id-page");
    createdUsers.push(user);
    for (const id of MALFORMED) {
      expect(await getAuctionOverview(id, user)).toBeNull();
    }
  });
});
