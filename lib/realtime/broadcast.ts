import { loadForSnapshot, serializeSnapshot } from "@/lib/engine/snapshot";

import type { Snapshot } from "./types";

/**
 * Il registro delle connessioni aperte e l'invio degli snapshot (PLAN §8).
 *
 * Un processo solo, una `Map` in memoria: niente Redis, niente pub/sub, niente
 * worker (lo stack lo vieta esplicitamente, ed è la ragione per cui tutto il
 * resto di questa applicazione può essere semplice). Se il processo muore, le
 * connessioni muoiono con lui e i client riaprono l'`EventSource` da soli
 * ricevendo subito uno snapshot completo: non c'è nessuno stato da ricostruire
 * qui dentro, perché non c'è nessuno stato qui dentro.
 *
 * **Uno snapshot per viewer, non uno per tutti.** Lo stato si carica una volta
 * sola, poi si serializza una volta per ciascun viewer distinto: è la stessa
 * `serializeSnapshot` a decidere cosa ciascuno può vedere (I8). Un broadcast
 * unico "già serializzato" sarebbe più veloce e sbagliato — porterebbe a tutti
 * il `myBid` di qualcuno.
 */

export type Subscriber = {
  /** Il membro per cui sanificare; `null` per il manager non giocante e la TV. */
  viewerMemberId: string | null;
  send: (snapshot: Snapshot) => void;
};

/**
 * Il registro **del processo**, non del modulo.
 *
 * Next compila `instrumentation.ts` (da cui parte lo scheduler) e i route
 * handler (da cui si aprono le connessioni) in bundle separati: con una
 * `Map` di modulo ce ne sarebbero due, e le connessioni finirebbero in quella
 * dove nessuno fa broadcast — stream aperti, snapshot iniziale, e poi silenzio
 * per tutta l'asta. Su `globalThis` ce n'è una sola, come per lo scheduler.
 */
const processGlobals = globalThis as typeof globalThis & {
  __auctionConnections?: Map<string, Set<Subscriber>>;
  __presencePending?: Map<string, NodeJS.Timeout>;
};

const connections = (processGlobals.__auctionConnections ??= new Map());

/** Iscrive una connessione e restituisce la funzione per disiscriverla. */
export function subscribe(auctionId: string, sub: Subscriber): () => void {
  let set = connections.get(auctionId);
  if (!set) {
    set = new Set();
    connections.set(auctionId, set);
  }
  set.add(sub);

  return () => {
    const current = connections.get(auctionId);
    if (!current) return;
    current.delete(sub);
    // La mappa non deve crescere per aste finite mesi fa.
    if (current.size === 0) connections.delete(auctionId);
  };
}

/** Quante connessioni aperte: lo usano i test e la diagnostica. */
export function connectionCount(auctionId?: string): number {
  if (auctionId !== undefined) return connections.get(auctionId)?.size ?? 0;
  let total = 0;
  for (const set of connections.values()) total += set.size;
  return total;
}

/**
 * Carica lo stato una volta e manda a ogni connessione lo snapshot serializzato
 * **per il suo viewer**. Un `send` che esplode (connessione morta fra il commit
 * e l'invio) non deve fermare gli altri: si registra e si va avanti.
 */
export async function broadcastSnapshot(auctionId: string): Promise<void> {
  const subs = connections.get(auctionId);
  if (!subs || subs.size === 0) return;

  const loaded = await loadForSnapshot(auctionId);
  if (!loaded) return;

  const now = Date.now();
  const byViewer = new Map<string | null, Snapshot>();
  for (const sub of subs) {
    let snapshot = byViewer.get(sub.viewerMemberId);
    if (!snapshot) {
      snapshot = serializeSnapshot(loaded, sub.viewerMemberId, now);
      byViewer.set(sub.viewerMemberId, snapshot);
    }
    try {
      sub.send(snapshot);
    } catch (error: unknown) {
      console.error(`snapshot non consegnato (asta ${auctionId}):`, error);
    }
  }
}

/**
 * La versione "e chi se ne frega del risultato" per l'hook di `mutate.ts`, che
 * è sincrono: il broadcast parte dopo il commit e non fa aspettare l'azione.
 * Un errore qui non deve mai far fallire un'offerta già registrata.
 */
export function scheduleSnapshot(auctionId: string): void {
  void broadcastSnapshot(auctionId).catch((error: unknown) => {
    console.error(`broadcast fallito (asta ${auctionId}):`, error);
  });
}

// ─── Presence: broadcast coalescato ──────────────────────────────────────────

/**
 * ⚠ P8 — dodici partecipanti che battono un heartbeat ogni 10 secondi sono più
 * di un evento al secondo: mandare uno snapshot per ciascuno sarebbe uno
 * snapshot-storm per un pallino che cambia colore. I cambi di presence si
 * accumulano in questa finestra e producono **un solo** invio.
 */
export const PRESENCE_COALESCE_MS = 1_000;

const pendingPresence = (processGlobals.__presencePending ??= new Map());

export function schedulePresenceSnapshot(auctionId: string): void {
  if (pendingPresence.has(auctionId)) return;
  const timer = setTimeout(() => {
    pendingPresence.delete(auctionId);
    scheduleSnapshot(auctionId);
  }, PRESENCE_COALESCE_MS);
  // Un broadcast in coda non deve tenere vivo il processo da solo.
  timer.unref?.();
  pendingPresence.set(auctionId, timer);
}

/** C'è già un invio di presence in coda per quest'asta? Lo guardano i test. */
export function presenceScheduled(auctionId: string): boolean {
  return pendingPresence.has(auctionId);
}

/** Pulizia fra un test e l'altro: nessun uso in produzione. */
export function resetBroadcast(): void {
  for (const timer of pendingPresence.values()) clearTimeout(timer);
  pendingPresence.clear();
  connections.clear();
}
