import { and, isNotNull, lte, sql, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { auctions } from "@/lib/db/schema";

import type { AuctionState, Millis } from "./types";

/**
 * I timer dell'asta (PLAN §7).
 *
 * Due vie verso la stessa `advancePhase`, entrambe innocue da sole perché la
 * transizione è guardata dentro il motore (I7):
 *
 * - **`arm` è la via veloce**: un `setTimeout` sulla deadline della fase,
 *   riarmato a ogni mutazione. È quello che chiude un round nel millisecondo
 *   giusto invece che "entro un secondo".
 * - **`sweep` è la rete di sicurezza**: ogni secondo interroga il database per
 *   le aste LIVE con la deadline scaduta. Se il processo muore e riparte, i
 *   `setTimeout` sono morti con lui, ma lo sweep riprende dal DB — è il boot
 *   recovery, e per questo non va mai saltato.
 *
 * Lo scheduler non decide niente: emette `ADVANCE`, il motore decide. E il
 * client men che meno (regola 1) — i countdown che si vedono in pagina sono
 * rendering, la chiusura avviene solo qui.
 *
 * La funzione `advance` arriva da fuori (la passa `instrumentation.ts`, o il
 * driver, o un test): il modulo non importa `actions.ts`, così non c'è nessun
 * ciclo di import fra azioni e scheduler.
 */

type Advance = (auctionId: string) => Promise<unknown>;

export type Scheduler = {
  arm(auctionId: string, deadline: Millis): void;
  cancel(auctionId: string): void;
  /** Un giro della rete di sicurezza. Restituisce le aste trovate scadute. */
  sweep(): Promise<string[]>;
  /** All'avvio del processo: sweep + riarmo di tutte le aste LIVE. */
  bootRecovery(): Promise<void>;
  /** Avvia lo sweep periodico (1s). Idempotente. */
  start(): void;
  stop(): void;
};

export function createScheduler(advance: Advance): Scheduler {
  const timeouts = new Map<string, NodeJS.Timeout>();
  let interval: NodeJS.Timeout | null = null;

  const run = (auctionId: string) => {
    advance(auctionId).catch((error: unknown) => {
      // Un errore su un'asta non deve fermare i timer delle altre.
      console.error(`advancePhase(${auctionId}) fallita:`, error);
    });
  };

  const scheduler: Scheduler = {
    arm(auctionId, deadline) {
      scheduler.cancel(auctionId);
      const delay = Math.max(0, deadline - Date.now());
      const t = setTimeout(() => {
        timeouts.delete(auctionId);
        run(auctionId);
      }, delay);
      timeouts.set(auctionId, t);
    },

    cancel(auctionId) {
      const t = timeouts.get(auctionId);
      if (t) {
        clearTimeout(t);
        timeouts.delete(auctionId);
      }
    },

    async sweep() {
      const due = await db
        .select({ id: auctions.id })
        .from(auctions)
        .where(
          and(
            eq(auctions.status, "LIVE"),
            isNotNull(auctions.phaseDeadline),
            lte(auctions.phaseDeadline, sql`now()`),
          ),
        );
      for (const { id } of due) {
        await advance(id).catch((error: unknown) => {
          console.error(`sweep: advancePhase(${id}) fallita:`, error);
        });
      }
      return due.map((row) => row.id);
    },

    async bootRecovery() {
      await scheduler.sweep();
      // Le aste avanzate dallo sweep si sono già riarmate da sole (syncTimer
      // a valle della mutazione); qui si arma tutto ciò che è LIVE, comprese
      // le aste con la deadline ancora davanti, che lo sweep non tocca.
      const live = await db
        .select({ id: auctions.id, phaseDeadline: auctions.phaseDeadline })
        .from(auctions)
        .where(
          and(eq(auctions.status, "LIVE"), isNotNull(auctions.phaseDeadline)),
        );
      for (const row of live) {
        scheduler.arm(row.id, row.phaseDeadline!.getTime());
      }
    },

    start() {
      interval ??= setInterval(() => {
        scheduler.sweep().catch((error: unknown) => {
          console.error("sweep fallito:", error);
        });
      }, 1000);
    },

    stop() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      for (const t of timeouts.values()) clearTimeout(t);
      timeouts.clear();
    },
  };

  return scheduler;
}

// ─── Lo scheduler attivo del processo ────────────────────────────────────────

let active: Scheduler | null = null;

/**
 * Avvia lo scheduler del processo: sweep periodico + boot recovery.
 * Chi lo avvia decide con quale `advance` (l'app usa `advancePhase`).
 * La guardia contro la doppia esecuzione sotto HMR sta in
 * `instrumentation.ts` (`globalThis.__scheduler ??=`, PLAN §16.8).
 */
export function startScheduler(advance: Advance): Scheduler {
  const scheduler = createScheduler(advance);
  active = scheduler;
  scheduler.start();
  void scheduler.bootRecovery().catch((error: unknown) => {
    console.error("bootRecovery fallito:", error);
  });
  return scheduler;
}

export function stopScheduler(): void {
  active?.stop();
  active = null;
}

/**
 * Il riarmo a valle di ogni mutazione (lo chiama `applyEvent`): asta LIVE con
 * una deadline → timer armato su quella; PAUSED o COMPLETED → timer spento.
 * Senza scheduler attivo non fa niente: in quel processo (seed, test) non c'è
 * nessuno che debba far scorrere il tempo.
 */
export function syncTimer(
  auctionId: string,
  state: Pick<AuctionState, "status" | "phaseDeadline">,
): void {
  if (!active) return;
  if (state.status === "LIVE" && state.phaseDeadline !== null) {
    active.arm(auctionId, state.phaseDeadline);
  } else {
    active.cancel(auctionId);
  }
}
