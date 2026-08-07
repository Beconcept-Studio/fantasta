import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import type { Presence } from "@/lib/realtime/types";

import type { Millis } from "./types";

/**
 * Chi c'è, adesso (PLAN §7).
 *
 * **La presence non è stato-macchina** (⚠ P8). `last_seen_at` e `is_visible`
 * sono telemetria: si scrivono **fuori da `withAuctionLock`** e non incrementano
 * `state_version`. La regola 4 ("mai mutare un'asta fuori dal lock") protegge lo
 * stato del gioco — aste, lotti, round, offerte, rose, ledger — non due colonne
 * che dicono se un telefono è ancora acceso. Se le passassimo dal lock, dodici
 * heartbeat ogni dieci secondi metterebbero in fila dodici transazioni serie
 * dietro un dato che scade da solo.
 *
 * Il valore mostrato — LIVE / IDLE / OFFLINE — non è una colonna: si **deriva**
 * a ogni lettura da `last_seen_at` e dal flag di visibilità del tab. Una colonna
 * andrebbe scritta da qualcuno anche quando *non* succede niente, che è
 * esattamente il caso in cui un partecipante sparisce.
 */

/** Oltre questa distanza da `last_seen_at`, un membro è considerato OFFLINE. */
export const PRESENCE_WINDOW_MS = 15_000;

/**
 * `LIVE` — visto da meno di 15s e con la pagina in primo piano.
 * `IDLE` — visto da meno di 15s, ma con il tab in background (Page Visibility).
 * `OFFLINE` — tutto il resto, compreso chi non si è mai fatto vedere.
 *
 * In lobby la differenza fra LIVE e IDLE è la differenza fra "possiamo
 * iniziare" e "chiamalo, ha il telefono in tasca": il gate di avvio (F4-06)
 * richiede LIVE per tutti, non "non OFFLINE".
 */
export function derivePresence(
  lastSeenAt: Millis | null,
  isVisible: boolean,
  now: Millis,
): Presence {
  if (lastSeenAt === null) return "OFFLINE";
  if (now - lastSeenAt >= PRESENCE_WINDOW_MS) return "OFFLINE";
  return isVisible ? "LIVE" : "IDLE";
}

/**
 * L'ultima mappa di presence già annunciata ai client, per asta.
 *
 * Serve a rispondere a una domanda che il solo heartbeat non sa risolvere:
 * *è cambiato qualcosa da dire?* Il caso interessante non è chi scrive
 * l'heartbeat — è chi **smette** di scriverlo, e diventa OFFLINE senza che
 * nessun evento accada. Confrontando la mappa derivata adesso con l'ultima
 * annunciata, il primo heartbeat che arriva dopo la scadenza di un altro se ne
 * accorge e fa partire l'aggiornamento. Con dodici partecipanti che battono
 * ogni 10 secondi, "dopo" significa al massimo un secondo.
 */
const processGlobals = globalThis as typeof globalThis & {
  __presenceAnnounced?: Map<string, Map<string, Presence>>;
};

// Su `globalThis` per la stessa ragione del registro delle connessioni: in
// dev questo file esiste in più bundle, e due memorie separate direbbero
// "cambiato" a turno per sempre.
const announced = (processGlobals.__presenceAnnounced ??= new Map());

function sameMap(a: Map<string, Presence>, b: Map<string, Presence>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

export type HeartbeatOutcome = {
  /** La presence derivata di tutti i membri, dopo questo heartbeat. */
  presence: Map<string, Presence>;
  /** `true` se qualcuno ha cambiato stato: solo allora vale la pena un invio. */
  changed: boolean;
};

/**
 * L'heartbeat di un membro: due colonne aggiornate, nessun lock, nessun bump.
 * Restituisce la mappa di presence e se è cambiata rispetto all'ultima
 * annunciata — è chi chiama (il route handler) a decidere di fare il broadcast
 * coalescato, così il motore non deve sapere che esiste un canale SSE.
 */
export async function recordHeartbeat(
  auctionId: string,
  memberId: string,
  visible: boolean,
  now: Millis = Date.now(),
): Promise<HeartbeatOutcome> {
  await db
    .update(members)
    .set({ lastSeenAt: new Date(now), isVisible: visible })
    .where(eq(members.id, memberId));

  return readPresence(auctionId, now);
}

/**
 * La mappa di presence dell'asta, con il confronto rispetto all'ultima
 * annunciata (che viene aggiornata se è cambiata).
 */
export async function readPresence(
  auctionId: string,
  now: Millis = Date.now(),
): Promise<HeartbeatOutcome> {
  const rows = await db
    .select({
      id: members.id,
      lastSeenAt: members.lastSeenAt,
      isVisible: members.isVisible,
    })
    .from(members)
    .where(eq(members.auctionId, auctionId));

  const presence = new Map(
    rows.map((r) => [
      r.id,
      derivePresence(r.lastSeenAt?.getTime() ?? null, r.isVisible, now),
    ]),
  );

  const before = announced.get(auctionId);
  const changed = before === undefined || !sameMap(before, presence);
  if (changed) announced.set(auctionId, presence);
  return { presence, changed };
}

/** Pulizia fra un test e l'altro: nessun uso in produzione. */
export function resetPresenceMemory(): void {
  announced.clear();
}
