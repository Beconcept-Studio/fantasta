"use client";

import { useEffect, useState } from "react";

import { countdownLabel, pausedRemaining } from "@/lib/realtime/portal";
import { remainingMs } from "@/lib/realtime/use-auction-stream";
import { cn } from "@/lib/utils";

/**
 * Il countdown (F5-03) — e va letto sapendo che **non decide niente**
 * (regola 1, PLAN §8).
 *
 * Questo componente è un orologio a muro: legge la scadenza dallo snapshot,
 * la confronta con l'ora **del server** (`Date.now() + offset`) e scrive un
 * numero. Quando arriva a zero scrive "in chiusura…" e continua ad aspettare.
 * Non chiude round, non cambia fase, non fa fetch: la chiusura è esclusivamente
 * server-side, e se lo snapshot successivo tarda di due secondi il portale deve
 * dire "in chiusura…" per due secondi — non inventarsi l'esito.
 *
 * `pausedAt` congela il valore: durante la pausa la scadenza a database è
 * ancora quella di prima (il resume la trasla) e senza questo il numero
 * scorrerebbe a zero mentre l'asta è ferma.
 */
export function Countdown({
  deadline,
  offset,
  pausedAt = null,
  className,
}: {
  deadline: string | null;
  /** `serverNow − Date.now()` dell'ultimo snapshot. */
  offset: number;
  /** Valorizzato solo ad asta in pausa. */
  pausedAt?: string | null;
  className?: string;
}) {
  const frozen = pausedAt !== null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (frozen) return;
    // 250ms invece di 1000: con un tick al secondo il numero può "saltare" da
    // 3 a 1 e sotto pressione quello sembra un bug dell'app.
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [frozen]);

  const remaining = frozen
    ? pausedRemaining(deadline, pausedAt)
    : remainingMs(deadline, offset, now);

  return (
    <span
      className={cn("tabular-nums", className)}
      role="timer"
      aria-live="off"
      data-frozen={frozen ? "" : undefined}
    >
      {countdownLabel(remaining)}
    </span>
  );
}

/**
 * La barra che accompagna il numero: la stessa informazione in forma
 * periferica, per chi sta guardando il campo dell'offerta e non la cifra.
 */
export function CountdownBar({
  deadline,
  offset,
  totalSeconds,
  pausedAt = null,
  className,
}: {
  deadline: string | null;
  offset: number;
  totalSeconds: number;
  pausedAt?: string | null;
  className?: string;
}) {
  const frozen = pausedAt !== null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (frozen) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [frozen]);

  const remaining = frozen
    ? pausedRemaining(deadline, pausedAt)
    : remainingMs(deadline, offset, now);
  const total = Math.max(1, totalSeconds) * 1000;
  const ratio = remaining === null ? 0 : Math.min(1, remaining / total);

  return (
    <div
      className={cn("bg-muted h-1.5 w-full overflow-hidden rounded-full", className)}
      aria-hidden
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-200 ease-linear",
          ratio > 0.5
            ? "bg-emerald-600"
            : ratio > 0.2
              ? "bg-amber-500"
              : "bg-destructive",
        )}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}
