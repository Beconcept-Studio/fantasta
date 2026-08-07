import { afterEach, expect, it, vi } from "vitest";

/**
 * F3-08 — la guardia singleton di `instrumentation.ts` (PLAN §16.8).
 *
 * In dev l'HMR riesegue `register()`: senza `globalThis.__scheduler ??=` si
 * accumulerebbero due sweep che fanno avanzare la stessa asta. Qui scheduler
 * e azioni sono finti: si prova la guardia, non il tempo.
 */

const startScheduler = vi.fn(() => ({ stop: vi.fn() }));
vi.mock("@/lib/engine/scheduler", () => ({ startScheduler }));
vi.mock("@/lib/engine/actions", () => ({ advancePhase: vi.fn() }));

afterEach(() => {
  delete (globalThis as { __scheduler?: unknown }).__scheduler;
  vi.unstubAllEnvs();
  startScheduler.mockClear();
});

it("register() eseguita due volte avvia un solo scheduler", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  const { register } = await import("@/instrumentation");

  await register();
  await register();

  expect(startScheduler).toHaveBeenCalledTimes(1);
});

it("register() non avvia niente fuori dal runtime nodejs", async () => {
  vi.stubEnv("NEXT_RUNTIME", "edge");
  const { register } = await import("@/instrumentation");

  await register();

  expect(startScheduler).not.toHaveBeenCalled();
});
