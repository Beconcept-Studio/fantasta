/**
 * L'aggancio di Next.js all'avvio del processo (F3-08): qui parte lo
 * scheduler — sweep periodico e boot recovery — una volta sola.
 *
 * Il `??=` su `globalThis` è la guardia di PLAN §16.8: in dev l'HMR riesegue
 * questo file, e senza guardia si accumulerebbero due sweep che fanno
 * avanzare la stessa asta. Gli import sono dinamici e dentro il ramo
 * `nodejs`: il runtime edge non ha `pg` e non deve nemmeno provarci.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startScheduler } = await import("@/lib/engine/scheduler");
  const { advancePhase } = await import("@/lib/engine/actions");

  const g = globalThis as typeof globalThis & { __scheduler?: unknown };
  g.__scheduler ??= startScheduler(advancePhase);
}
