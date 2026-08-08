"use client";

import { useMemo, useState } from "react";

import { Countdown, CountdownBar } from "@/components/auction/countdown";
import { ROLE_LABELS, ROLE_LABELS_ONE } from "@/lib/domain";
import type { ActionResult } from "@/lib/realtime/action";
import { availablePlayers } from "@/lib/realtime/portal";
import type { PoolPlayer, Snapshot } from "@/lib/realtime/types";

/**
 * La chiamata (F5-10): tocca a te, e hai `pick_seconds` per scegliere.
 *
 * La lista è funzione dello snapshot: il listone arriva dal server una volta
 * sola (è immutabile dall'import), **chi è ancora libero** si deduce dalle rose
 * che lo snapshot contiene già. Nessuna query per lotto, e I10 resta vera —
 * chi ricarica la pagina a metà turno vede la stessa lista di chi non si è
 * mosso.
 *
 * L'ordinamento non è cosmetico: è `fvm DESC, quot DESC`, lo stesso dell'auto-pick.
 * Il primo nome della lista è quello che il timer sceglierebbe al posto tuo, e
 * saperlo cambia la fretta con cui si guarda il countdown.
 */

const MAX_ROWS = 40;

export function PickPanel({
  snapshot,
  pool,
  offset,
  frozen,
  onPick,
}: {
  snapshot: Snapshot;
  pool: PoolPlayer[];
  offset: number;
  frozen: boolean;
  onPick: (playerId: string) => Promise<ActionResult>;
}) {
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const role = snapshot.auction.currentRole;
  const available = useMemo(
    () => availablePlayers(pool, snapshot, role, query),
    [pool, snapshot, role, query],
  );
  const shown = available.slice(0, MAX_ROWS);

  const pick = async (playerId: string) => {
    setPending(playerId);
    setError(null);
    const result = await onPick(playerId);
    if (!result.ok) setError(result.message);
    // In caso di successo non si azzera niente: lo snapshot successivo cambia
    // schermata da sotto, ed è quello il segnale che la chiamata è passata.
    setPending(null);
  };

  return (
    <section className="space-y-3">
      <header className="bg-card space-y-2 rounded-xl border p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-muted-foreground text-xs tracking-wide uppercase">
              Tocca a te
            </p>
            <h2 className="text-xl font-semibold">
              Chiama un {role === null ? "giocatore" : ROLE_LABELS_ONE[role]}
            </h2>
          </div>
          <p className="text-right text-3xl leading-none font-semibold">
            <Countdown
              deadline={snapshot.auction.phaseDeadline}
              offset={offset}
              pausedAt={frozen ? snapshot.auction.pausedAt : null}
            />
          </p>
        </div>
        <CountdownBar
          deadline={snapshot.auction.phaseDeadline}
          offset={offset}
          totalSeconds={snapshot.auction.timers.pickSeconds}
          pausedAt={frozen ? snapshot.auction.pausedAt : null}
        />
        <p className="text-muted-foreground text-xs">
          Se scade, parte l&apos;auto-pick sul primo della lista e la tua offerta
          d&apos;apertura è 1.
        </p>
      </header>

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Cerca per nome o squadra"
        type="search"
        autoComplete="off"
        aria-label="Cerca un giocatore"
        // 16px minimi: sotto quella soglia iOS zooma da solo appena si tocca il
        // campo, e la pagina resta zoomata per il resto dell'asta.
        className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-12 w-full rounded-lg border bg-transparent px-3 text-base outline-none focus-visible:ring-3"
      />

      {error !== null && (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {error}
        </p>
      )}

      {frozen && (
        <p role="status" className="bg-muted/50 rounded-md px-3 py-2 text-sm">
          Asta in pausa: la chiamata riprende al resume.
        </p>
      )}

      <ul className="space-y-1.5">
        {shown.map((player) => (
          <li key={player.id}>
            <button
              type="button"
              disabled={frozen || pending !== null}
              onClick={() => void pick(player.id)}
              className="hover:bg-accent flex min-h-12 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition disabled:opacity-50"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{player.name}</span>
                <span className="text-muted-foreground block truncate text-xs">
                  {player.team}
                </span>
              </span>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                fvm {player.fvm}
              </span>
              <span className="shrink-0 text-sm font-medium">
                {pending === player.id ? "…" : "Chiama"}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {available.length === 0 && (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          Nessun giocatore libero con questa ricerca.
        </p>
      )}
      {available.length > MAX_ROWS && (
        <p className="text-muted-foreground text-center text-xs">
          Altri {available.length - MAX_ROWS} liberi: affina la ricerca.
        </p>
      )}
    </section>
  );
}

/** L'attesa mentre chiama qualcun altro: chi, e quanto tempo ha. */
export function PickWaiting({
  snapshot,
  offset,
  frozen,
  callerName,
}: {
  snapshot: Snapshot;
  offset: number;
  frozen: boolean;
  callerName: string;
}) {
  const role = snapshot.auction.currentRole;
  return (
    <section className="bg-card space-y-2 rounded-xl border p-6 text-center shadow-sm">
      <p className="text-muted-foreground text-xs tracking-wide uppercase">
        Sta chiamando
      </p>
      <h2 className="text-xl font-semibold">{callerName}</h2>
      <p className="text-4xl leading-none font-semibold">
        <Countdown
          deadline={snapshot.auction.phaseDeadline}
          offset={offset}
          pausedAt={frozen ? snapshot.auction.pausedAt : null}
        />
      </p>
      <CountdownBar
        deadline={snapshot.auction.phaseDeadline}
        offset={offset}
        totalSeconds={snapshot.auction.timers.pickSeconds}
        pausedAt={frozen ? snapshot.auction.pausedAt : null}
        className="mx-auto max-w-xs"
      />
      <p className="text-muted-foreground text-sm">
        Si stanno comprando i{" "}
        {role === null ? "giocatori" : ROLE_LABELS[role].toLowerCase()}.
      </p>
    </section>
  );
}
