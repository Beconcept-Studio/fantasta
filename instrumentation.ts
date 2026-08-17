/**
 * L'aggancio di Next.js all'avvio del processo (F3-08, F4-03): qui partono le
 * cose che devono esistere una volta sola per processo — lo scheduler (sweep
 * periodico e boot recovery), il collegamento fra le mutazioni e lo stream SSE,
 * il tick dei bot (M4) e il refresh giornaliero degli insight (M11).
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
    const { cancelTimer, startScheduler } = await import(
      "@/lib/engine/scheduler"
    );
    const { advancePhase } = await import("@/lib/engine/actions");
    const { setAuctionGoneHook, setBroadcastHook } = await import(
      "@/lib/engine/mutate"
    );
    const { startBotLoop } = await import("@/lib/engine/bots");
    const { startInsightRefreshLoop } = await import(
      "@/lib/engine/insight-refresh"
    );
    const { closeAuctionStreams, scheduleSnapshot, schedulePresenceSnapshot } =
      await import("@/lib/realtime/broadcast");

    const g = globalThis as typeof globalThis & {
      __scheduler?: unknown;
      __botLoop?: unknown;
      __insightRefresh?: unknown;
    };
    if (g.__scheduler) return;
    setBroadcastHook(scheduleSnapshot);

    // Il congedo di un'asta cancellata (M12 §3b). Aggancia le due sole cose che
    // di quell'asta vivono **in memoria di questo processo**: le connessioni
    // aperte, che vanno congedate perché nessuno snapshot arriverà più, e il
    // timer di fase armato, che nessuna mutazione successiva spegnerà.
    //
    // ⚠ **Solo da qui il timer si cancella davvero.** `active` è una variabile
    // di modulo di `scheduler.ts`, e di questo file e dei route handler
    // esistono due bundle: la stessa `cancelTimer` chiamata da una Server
    // Action girerebbe nella copia dove `active` è `null`. La closure nasce
    // qui, dove lo scheduler è stato avviato, quindi il timer che vede è quello
    // vero (PLAN §16.8, la ragione di sempre).
    setAuctionGoneHook((auctionId, auctionName) => {
      cancelTimer(auctionId);
      return closeAuctionStreams(auctionId, auctionName);
    });

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

    // Il refresh giornaliero delle due fonti pubbliche (M11). **Il terzo loop di
    // questo processo, e l'ultimo che serve**: quindici minuti di intervallo, e
    // a dire «è passato un giorno» è `source_runs`, non l'intervallo — un
    // `setInterval` da ventiquattro ore sarebbe ancorato al boot, e questo
    // processo riparte a ogni push su `main`.
    //
    // Anche questo su `globalThis`, e per la terza volta la ragione è la stessa:
    // Next compila questo file e i route handler in bundle separati, quindi di
    // una variabile di modulo esisterebbero due copie — e due copie di un loop
    // che conta i tentativi vorrebbero dire un conto che non torna.
    g.__insightRefresh = startInsightRefreshLoop();
  }
}
