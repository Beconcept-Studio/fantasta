"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DELETED_EVENT, type Snapshot } from "./types";

/**
 * Il lato client del canale (F4-07): un `EventSource`, uno snapshot alla volta,
 * e un orologio che non è quello del telefono.
 *
 * Tre regole, tutte e tre nate da bug che altrimenti si vedono solo in diretta:
 *
 * 1. **Non fidarsi dell'orologio locale.** Il telefono di qualcuno sarà avanti
 *    di venti secondi, sempre. Da ogni snapshot si ricalcola
 *    `offset = serverNow − Date.now()` e i countdown si rendono con
 *    `deadline − (Date.now() + offset)`. Il countdown è **rendering**: quando
 *    arriva a zero la pagina scrive "in chiusura…" e aspetta lo snapshot
 *    successivo. Non chiude niente (regola 1).
 * 2. **Scartare le versioni vecchie.** Un broadcast può sorpassare lo snapshot
 *    iniziale della connessione: senza il confronto su `stateVersion` la
 *    schermata tornerebbe indietro nel tempo per un istante.
 * 3. **Chiudere bene.** In dev React monta due volte in StrictMode: se il
 *    cleanup non chiude l'`EventSource`, restano due connessioni aperte per
 *    ogni tab e ogni snapshot arriva doppio (PLAN §16.8).
 */

/** Millisecondi da sommare a `Date.now()` per ottenere l'ora del server. */
export function clockOffset(serverNow: string, clientNow: number): number {
  return Date.parse(serverNow) - clientNow;
}

/** Quanto manca a una scadenza, secondo l'orologio del server. Mai negativo. */
export function remainingMs(
  deadline: string | null,
  offset: number,
  clientNow: number,
): number | null {
  if (deadline === null) return null;
  return Math.max(0, Date.parse(deadline) - (clientNow + offset));
}

/** Uno snapshot più vecchio di quello già in mano si butta. */
export function acceptSnapshot(
  current: Snapshot | null,
  incoming: Snapshot,
): boolean {
  return current === null || incoming.stateVersion >= current.stateVersion;
}

/**
 * L'asta è stata cancellata mentre la si guardava (M12 §3c). `null` finché non
 * succede, che è sempre tranne una volta.
 */
export type Deleted = { auctionName: string };

export type AuctionStream = {
  snapshot: Snapshot | null;
  /** `false` mentre l'`EventSource` sta ritentando la connessione. */
  connected: boolean;
  offset: number;
  /** Il tempo residuo di una scadenza dello snapshot, con l'orologio del server. */
  remaining: (deadline: string | null) => number | null;
  /**
   * Valorizzato dall'evento terminale: da qui in poi non arriverà più niente,
   * e la schermata dell'asta non ha più nulla da mostrare. Chi ha una dashboard
   * dove andare ci va (`useDeletedRedirect`); la TV si ferma e lo dice.
   */
  deleted: Deleted | null;
};

export function useAuctionStream(
  auctionId: string,
  publicToken?: string,
): AuctionStream {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [offset, setOffset] = useState(0);
  const [deleted, setDeleted] = useState<Deleted | null>(null);
  // La versione vive anche in un ref: due snapshot nello stesso tick di React
  // vedrebbero entrambi lo stesso `snapshot` di stato.
  const lastVersion = useRef<number>(-1);

  useEffect(() => {
    const url = publicToken
      ? `/api/auctions/${auctionId}/stream?token=${encodeURIComponent(publicToken)}`
      : `/api/auctions/${auctionId}/stream`;
    const source = new EventSource(url);
    lastVersion.current = -1;

    source.addEventListener("open", () => setConnected(true));
    source.addEventListener("error", () => setConnected(false));
    source.addEventListener("snapshot", (event: MessageEvent<string>) => {
      const incoming = JSON.parse(event.data) as Snapshot;
      if (incoming.stateVersion < lastVersion.current) return;
      lastVersion.current = incoming.stateVersion;
      setConnected(true);
      setOffset(clockOffset(incoming.serverNow, Date.now()));
      setSnapshot(incoming);
    });

    // ⚠ **Il `close()` è la prima riga, e non è estetica** (M12 §3c). Il server
    // chiude lo stream subito dopo aver mandato questo evento, e uno stream che
    // finisce è per l'`EventSource` un buon motivo per riconnettersi da solo:
    // senza questa riga il client tornerebbe a battere su una rotta che
    // risponde 404, cioè il problema 2 di §2 con un passaggio in più. Chiuso
    // qui, non c'è nessun tentativo — ed è ciò che si guarda nel pannello di
    // rete, non sullo schermo.
    source.addEventListener(DELETED_EVENT, (event: MessageEvent<string>) => {
      source.close();
      setConnected(false);
      setDeleted(JSON.parse(event.data) as Deleted);
    });

    return () => source.close();
  }, [auctionId, publicToken]);

  const remaining = useCallback(
    (deadline: string | null) => remainingMs(deadline, offset, Date.now()),
    [offset],
  );

  return { snapshot, connected, offset, remaining, deleted };
}


/**
 * L'heartbeat del partecipante (F4-05, PLAN §7): un POST ogni 10 secondi con
 * lo stato del tab. È **indipendente dall'SSE** di proposito — un tab con lo
 * stream rotto ma la pagina viva deve continuare a risultare presente (§8bis),
 * e un tab in background deve risultare IDLE anche se lo stream regge.
 */
export const HEARTBEAT_MS = 10_000;

export function useHeartbeat(auctionId: string, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    const beat = () => {
      void fetch(`/api/auctions/${auctionId}/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visible: document.visibilityState === "visible",
        }),
        keepalive: true,
      }).catch(() => {
        // Un heartbeat perso non è un problema: ne parte un altro fra 10s.
      });
    };

    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    // Il passaggio in primo piano non deve aspettare il tick successivo: è il
    // momento in cui l'owner in lobby sta guardando il pallino.
    document.addEventListener("visibilitychange", beat);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [auctionId, enabled]);
}
