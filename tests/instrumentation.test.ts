import { afterEach, expect, it, vi } from "vitest";

/**
 * F3-08 — la guardia singleton di `instrumentation.ts` (PLAN §16.8).
 *
 * In dev l'HMR riesegue `register()`: senza `globalThis.__scheduler ??=` si
 * accumulerebbero due sweep che fanno avanzare la stessa asta. Qui scheduler
 * e azioni sono finti: si prova la guardia, non il tempo.
 */

const startScheduler = vi.fn(() => ({ stop: vi.fn() }));
const startInsightRefreshLoop = vi.fn(() => ({ stop: vi.fn() }));
const cancelTimer = vi.fn();
vi.mock("@/lib/engine/scheduler", () => ({ startScheduler, cancelTimer }));
vi.mock("@/lib/engine/actions", () => ({ advancePhase: vi.fn() }));
vi.mock("@/lib/engine/insight-refresh", () => ({ startInsightRefreshLoop }));

afterEach(() => {
  delete (globalThis as { __scheduler?: unknown }).__scheduler;
  vi.unstubAllEnvs();
  startScheduler.mockClear();
  startInsightRefreshLoop.mockClear();
  cancelTimer.mockClear();
});

it("register() eseguita due volte avvia un solo scheduler", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  const { register } = await import("@/instrumentation");

  await register();
  await register();

  expect(startScheduler).toHaveBeenCalledTimes(1);
});

/**
 * ⚠ M11 — la stessa guardia deve valere per il terzo loop. Due copie del refresh
 * vorrebbero dire due tentativi contati come uno: `source_runs` ha una riga per
 * fonte, e il secondo `upsert` sovrascriverebbe il primo senza che si veda.
 */
it("register() eseguita due volte avvia un solo loop di refresh", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  const { register } = await import("@/instrumentation");

  await register();
  await register();

  expect(startInsightRefreshLoop).toHaveBeenCalledTimes(1);
});

/**
 * ⚠ **M12 — l'aggancio del congedo, che è il pezzo la cui assenza non si vede.**
 *
 * Se questa riga sparisse da `register()`, non si romperebbe niente di visibile:
 * `deleteAuction` continuerebbe a cancellare le aste, i test del motore
 * resterebbero verdi, e l'unica differenza sarebbe che dodici persone in una
 * stanza restano a guardare una schermata ferma — cioè il bug che M12 esiste per
 * togliere, tornato in silenzio.
 *
 * Il test non guarda il congedo delle connessioni (quello ha un file suo, con
 * Postgres vero): guarda che l'hook **sia agganciato**, e lo fa dal lato del
 * timer, che qui è finto. Serve anche a proteggere la ragione per cui il timer
 * passa da qui: dentro il motore, `active` sarebbe quello di un altro bundle.
 */
it("register() aggancia il congedo, e da lì il timer si cancella davvero", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  const { register } = await import("@/instrumentation");
  const { auctionGone } = await import("@/lib/engine/mutate");

  await register();
  // È ciò che fa `deleteAuction` dopo il commit, senza sapere chi ascolta.
  auctionGone("un-id-qualsiasi", "Un'asta qualsiasi");

  expect(cancelTimer).toHaveBeenCalledWith("un-id-qualsiasi");
});

it("register() non avvia niente fuori dal runtime nodejs", async () => {
  vi.stubEnv("NEXT_RUNTIME", "edge");
  const { register } = await import("@/instrumentation");

  await register();

  expect(startScheduler).not.toHaveBeenCalled();
  expect(startInsightRefreshLoop).not.toHaveBeenCalled();
});
