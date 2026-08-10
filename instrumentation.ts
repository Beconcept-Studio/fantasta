/**
 * L'aggancio di Next.js all'avvio del processo (F3-08, F4-03): qui partono le
 * due cose che devono esistere una volta sola per processo — lo scheduler
 * (sweep periodico e boot recovery) e il collegamento fra le mutazioni e lo
 * stream SSE.
 *
 * Il `??=` su `globalThis` è la guardia di PLAN §16.8: in dev l'HMR riesegue
 * questo file, e senza guardia si accumulerebbero due sweep che fanno
 * avanzare la stessa asta. Gli import sono dinamici e dentro il ramo
 * `nodejs`: il runtime edge non ha `pg` e non deve nemmeno provarci.
 *
 * Il broadcast si aggancia qui, e non dentro `lib/engine/mutate.ts`, per la
 * stessa ragione per cui lo scheduler riceve `advancePhase` da fuori: il
 * motore non deve sapere che esiste un canale verso i client. `mutate.ts`
 * chiama un hook che di default non fa niente — nei test, nel seed e nel
 * driver resta quello, e nessuno di loro apre connessioni.
 */
export async function register(): Promise<void> {
  // Il `return` anticipato non basta: gli import devono stare **dentro** l'if.
  // Il bundler sostituisce `process.env.NEXT_RUNTIME` con una costante ed
  // elimina il ramo morto solo se è un blocco — con una guardia a inizio
  // funzione compila comunque `pg` nel bundle edge, non risolve `fs` né
  // `pg-native` e ogni pagina risponde 500 (vedi DECISIONS 2026-08-07, F4).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/engine/scheduler");
    const { advancePhase } = await import("@/lib/engine/actions");
    const { setBroadcastHook } = await import("@/lib/engine/mutate");
    const { startBotLoop } = await import("@/lib/engine/bots");
    const { scheduleSnapshot, schedulePresenceSnapshot } = await import(
      "@/lib/realtime/broadcast"
    );

    const g = globalThis as typeof globalThis & {
      __scheduler?: unknown;
      __botLoop?: unknown;
    };
    if (g.__scheduler) return;
    setBroadcastHook(scheduleSnapshot);
    g.__scheduler = startScheduler(advancePhase);

    // Il tick dei bot (M4). **Un intervallo suo, non lo sweep**: lo sweep chiude
    // i round ed è sequenziale, e una simulazione con undici bot che scrivono
    // sotto lock ritarderebbe la chiusura di un round dell'asta vera che gira
    // accanto. Il ciclo si ferma da sé quando esiste un'asta reale in corso.
    //
    // Anche questo su `globalThis`, per la stessa ragione dello scheduler: Next
    // compila questo file e i route handler in bundle separati, e una variabile
    // di modulo esisterebbe in due copie.
    g.__botLoop = startBotLoop(schedulePresenceSnapshot);
  }
}
