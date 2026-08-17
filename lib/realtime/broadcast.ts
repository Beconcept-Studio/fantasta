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

/**
 * Ciò che viaggia nel congedo (M12 §3a): il nome dell'asta che non c'è più.
 *
 * Non è uno snapshot — di snapshot non ce n'è più uno da fare — ed è l'unica
 * cosa che il client non può ricavare da sé: serve a dire *quale* asta è
 * sparita a chi ne segue più di una. Nessun importo, nessuno stato di gioco:
 * il nome dell'asta lo vedono già tutti, TV compresa (I8 non c'entra).
 */
export type Dismissal = { auctionName: string };

export type Subscriber = {
  /** Il membro per cui sanificare; `null` per il manager non giocante e la TV. */
  viewerMemberId: string | null;
  send: (snapshot: Snapshot) => void;
  /**
   * **Il congedo** (M12 §3a): manda l'evento terminale e chiude lo stream.
   *
   * Esiste perché `send` sa mandare solo snapshot, e un'asta cancellata non ne
   * produce più nessuno: senza questo campo la connessione resterebbe aperta e
   * muta per sempre, col `: ping` che continua ad arrivare — il sintomo di §2,
   * che sembra lentezza e non un guasto.
   */
  dismiss: (dismissal: Dismissal) => void;
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

// ─── Il congedo: un'asta che non esiste più ──────────────────────────────────

/**
 * **Congeda tutte le connessioni di un'asta che non esiste più** (M12 §3a).
 *
 * Restituisce **quante** ne ha congedate: è il numero che finisce nella riga di
 * log della cancellazione, e la differenza fra «ho buttato via una prova» e «ho
 * interrotto una serata» (M12 §4).
 *
 * Tre cose, e nessuna è di contorno:
 *
 * - **Si congeda una per una**, e un `dismiss` che esplode non ferma gli altri:
 *   una connessione morta fra il commit e il congedo non deve lasciare le altre
 *   undici a guardare una schermata ferma. È la stessa ragione del `try` in
 *   `broadcastSnapshot`.
 * - **La voce della mappa si svuota qui.** La pulizia normale la fa
 *   `unsubscribe` alla chiusura di ogni stream; quelle chiusure arriveranno
 *   comunque, un istante dopo, e troveranno una mappa che non ha più la loro
 *   asta — è innocuo, `unsubscribe` esce subito se la voce non c'è.
 * - **Anche un broadcast di presence in coda si annulla.** Sarebbe innocuo
 *   (`broadcastSnapshot` non troverebbe connessioni ed escerebbe subito) ma
 *   resterebbe un timer armato su un'asta che non c'è: è la stessa cosa che M12
 *   §2.3 chiede di non lasciare in giro per il timer di fase.
 */
export function closeAuctionStreams(
  auctionId: string,
  auctionName: string,
): number {
  const pending = pendingPresence.get(auctionId);
  if (pending) {
    clearTimeout(pending);
    pendingPresence.delete(auctionId);
  }

  const subs = connections.get(auctionId);
  if (!subs || subs.size === 0) return 0;

  const dismissed = subs.size;
  for (const sub of subs) {
    try {
      sub.dismiss({ auctionName });
    } catch (error: unknown) {
      console.error(`congedo non consegnato (asta ${auctionId}):`, error);
    }
  }
  connections.delete(auctionId);
  return dismissed;
}

/** Pulizia fra un test e l'altro: nessun uso in produzione. */
export function resetBroadcast(): void {
  for (const timer of pendingPresence.values()) clearTimeout(timer);
  pendingPresence.clear();
  connections.clear();
}
