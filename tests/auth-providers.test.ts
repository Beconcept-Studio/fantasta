import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `lib/auth` importa `lib/db`, che aprirebbe un pool Postgres al solo import.
// Qui interessa quali provider l'app pubblica, non il database.
vi.mock("@/lib/db", () => ({
  db: { query: { users: { findFirst: async () => undefined } } },
  pool: {},
  schema: {},
}));

/**
 * Chiede all'app la lista dei provider così come la vede un client, dall'endpoint
 * `/api/auth/providers`, con `NODE_ENV` impostato prima che `lib/auth` venga
 * valutato. È la stessa lista che alimenta la pagina di login: se qui il
 * provider `dev` non c'è, non c'è nemmeno un modo di invocarlo.
 */
async function publishedProviderIds(nodeEnv: string): Promise<string[]> {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.stubEnv("AUTH_SECRET", "segreto-di-test");
  vi.stubEnv("AUTH_GOOGLE_ID", "google-id-di-test");
  vi.stubEnv("AUTH_GOOGLE_SECRET", "google-secret-di-test");
  vi.resetModules();

  const { handlers } = await import("@/lib/auth");
  const response = await handlers.GET(
    new NextRequest("http://localhost:3000/api/auth/providers"),
  );

  expect(response.status).toBe(200);
  return Object.keys((await response.json()) as Record<string, unknown>);
}

describe("provider di autenticazione", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  /**
   * ⚠ Il valore atteso è cambiato in M5 — da `["google"]` a
   * `["google", "email"]` — e il modo in cui è cambiato conta quanto il valore.
   *
   * **Resta un'uguaglianza esatta.** Non è diventata un `toContain`, non è
   * diventata un «almeno questi»: un provider aggiunto per sbaglio domani fa
   * fallire questo test esattamente come lo faceva ieri. Ciò che il file
   * proteggeva è protetto come prima; è cambiato quanti provider legittimi
   * esistono, non quanto stretta è l'asserzione.
   */
  it("in produzione pubblica Google e email, e nient'altro", async () => {
    expect(await publishedProviderIds("production")).toEqual([
      "google",
      "email",
    ]);
  });

  it("in produzione NON pubblica il provider dev", async () => {
    // PLAN §15: il bypass del login non deve essere raggiungibile in produzione.
    expect(await publishedProviderIds("production")).not.toContain("dev");
  });

  it("fuori produzione pubblica anche il provider dev", async () => {
    expect(await publishedProviderIds("development")).toContain("dev");
  });
});
