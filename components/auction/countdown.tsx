"use client";

import { useEffect, useState } from "react";

import {
  countdownLabel,
  pausedRemaining,
  timeTone,
  type SceneTime,
  type TimeTone,
} from "@/lib/realtime/portal";
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
  const ratio = timeRatio(remaining, totalSeconds);

  return (
    <div
      className={cn("bg-muted h-1.5 w-full overflow-hidden rounded-full", className)}
      aria-hidden
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-200 ease-linear",
          // ⚠ Le tre soglie non sono più scritte qui: da M17 stanno in `timeTone`,
          // perché la banda della card di scena le vuole identiche. Due copie di
          // «sotto il 20% è rosso» sono due copie che un giorno divergono, e il
          // giorno in cui divergono la card e il pannello dicono due cose diverse
          // sullo stesso countdown.
          BAR_TONE[timeTone(ratio, true)],
        )}
        style={{ width: `${(ratio ?? 0) * 100}%` }}
      />
    </div>
  );
}

const BAR_TONE: Record<TimeTone, string> = {
  CALM: "bg-muted-foreground",
  OK: "bg-emerald-600",
  WARN: "bg-amber-500",
  HOT: "bg-destructive",
};

/** La frazione di tempo che resta, o `null` se non c'è una scadenza. */
function timeRatio(remaining: number | null, totalSeconds: number): number | null {
  if (remaining === null) return null;
  return Math.min(1, remaining / (Math.max(1, totalSeconds) * 1000));
}

/**
 * **La banda del tempo** in fondo alla card di scena (M17 §6): etichetta a
 * sinistra, cifra e anello stretti a destra.
 *
 * Sostituisce il numero grande che ogni card si disegnava per conto suo, e la
 * ragione non è di stile: quel numero era **identico in tutte le scene**, ma solo
 * in tre la risposta è «devi fare qualcosa adesso». In «sta chiamando un altro»,
 * «buste da aprire» ed «esito» urlava senza chiedere niente — e in una colonna
 * da 350px urlava anche sopra il resto della card.
 *
 * Sta nell'**ultimo pixel** della card, staccata da un bordo, in tutte e sette le
 * scene che hanno una scadenza. È questo che risponde alla richiesta più della
 * tinta: se la banda è sempre lì, un cambiamento si nota perché qualcosa **è
 * cambiato lì**, non perché è comparso qualcosa da qualche parte.
 *
 * ⚠ **Il colore lo decide `pressing`, non solo il tempo**: dove non c'è una
 * scadenza mia da mancare la banda resta grigia per tutta la sua corsa. Il perché
 * sta su `sceneTime`, ed è la differenza fra un rosso che compare venticinque
 * volte in una serata e uno che ne compare duecento.
 *
 * ⚠ **In pausa la banda si spegne**: `pausedAt` congela la cifra (senza,
 * scorrerebbe a zero mentre l'asta è ferma) e il tono va a `CALM`. Un tempo fermo
 * che si colora come un tempo che scorre è la cosa che si guarda per due secondi
 * prima di capire; che l'asta sia in pausa lo dicono la fascia a righe e il badge.
 */
export function TimeBand({
  time,
  offset,
  pausedAt = null,
}: {
  time: SceneTime;
  /** `serverNow − Date.now()` dell'ultimo snapshot. */
  offset: number;
  /** Valorizzato solo ad asta in pausa. */
  pausedAt?: string | null;
}) {
  const frozen = pausedAt !== null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (frozen) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [frozen]);

  const remaining = frozen
    ? pausedRemaining(time.deadline, pausedAt)
    : remainingMs(time.deadline, offset, now);
  const ratio = timeRatio(remaining, time.totalSeconds);
  const tone = timeTone(ratio, time.pressing && !frozen);

  return (
    <div className="bg-muted/40 flex items-center gap-2.5 border-t px-4 py-2">
      <span
        className={cn(
          "text-[0.6875rem] tracking-wide whitespace-nowrap uppercase",
          tone === "HOT" ? BAND_TEXT[tone] : "text-muted-foreground",
        )}
      >
        {frozen ? "restavano" : time.label}
      </span>
      <span className="flex-1" />
      <span
        className={cn(
          "font-mono text-[1.0625rem] leading-none font-medium",
          BAND_TEXT[tone],
        )}
        role="timer"
        aria-live="off"
        data-frozen={frozen ? "" : undefined}
      >
        {countdownLabel(remaining)}
      </span>
      <TimeRing ratio={ratio} tone={tone} />
    </div>
  );
}

const BAND_TEXT: Record<TimeTone, string> = {
  CALM: "text-muted-foreground",
  // ⚠ Un passo più scuri delle tinte della barra, e non è pignoleria:
  // `amber-500` su bianco non raggiunge il contrasto di un testo, mentre come
  // riempimento va benissimo. La coppia esiste già in due punti dell'app
  // (`text-emerald-700` sul prezzo vinto, `text-amber-800` sull'avviso
  // dell'auto-pick), quindi qui non nasce nessuna convenzione nuova.
  OK: "text-emerald-700",
  WARN: "text-amber-700",
  HOT: "text-destructive",
};

const RING_STROKE: Record<TimeTone, string> = {
  CALM: "stroke-muted-foreground",
  OK: "stroke-emerald-600",
  WARN: "stroke-amber-500",
  HOT: "stroke-destructive",
};

/**
 * L'anello che si consuma: **un orologio, non una barra di avanzamento**.
 *
 * La distinzione conta più di quanto sembri. Una barra che si riempie è la
 * metafora di un lavoro che avanza; qui non avanza niente, scade qualcosa — e a
 * un tempo che scade corrisponde un quadrante. Costa 22px invece dei 250 di una
 * barra a piena larghezza, che in una colonna da 350px è la ragione per cui la
 * banda ci sta su una riga sola insieme all'etichetta e alla cifra.
 *
 * ⚠ `stroke-dasharray` è la circonferenza (2π·15.5 ≈ 97.4) e `stroke-dashoffset`
 * la parte già consumata: **si scrivono in unità di percorso, non in gradi**, e
 * cambiare `r` senza rifare il conto lascia un anello che non chiude mai o che
 * chiude a metà corsa.
 */
function TimeRing({ ratio, tone }: { ratio: number | null; tone: TimeTone }) {
  const CIRCUMFERENCE = 2 * Math.PI * 15.5;
  const left = ratio === null ? 0 : ratio;
  return (
    <svg
      viewBox="0 0 36 36"
      className="size-5.5 shrink-0"
      aria-hidden
      // `-rotate-90` sul contenitore e non sul cerchio: ruotare il cerchio
      // richiede un `transform-origin` che l'SVG calcola sul viewBox, ed è il
      // modo più rapido di ritrovarsi l'anello che parte da destra.
      style={{ transform: "rotate(-90deg)" }}
    >
      <circle
        cx="18"
        cy="18"
        r="15.5"
        fill="none"
        strokeWidth="4"
        className={cn(RING_STROKE[tone], "opacity-20")}
      />
      <circle
        cx="18"
        cy="18"
        r="15.5"
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        className={cn(
          RING_STROKE[tone],
          "transition-[stroke-dashoffset] duration-200 ease-linear",
        )}
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={CIRCUMFERENCE * (1 - left)}
      />
    </svg>
  );
}
