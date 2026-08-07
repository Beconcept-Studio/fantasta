import { events } from "@/lib/db/schema";

import { type Result, fail, ok } from "./errors";
import { transition } from "./machine";
import {
  type LoadedAuction,
  type Tx,
  persistTransition,
  withAuctionLock,
} from "./mutate";
import { derivePresence } from "./presence";
import { syncTimer } from "./scheduler";
import type { AuctionEvent, AuctionState, Millis } from "./types";

/**
 * Le azioni di gioco (PLAN §9, sezione Live): il punto in cui un utente
 * autenticato incontra il motore puro.
 *
 * Ogni azione ha la stessa forma — `withAuctionLock` → guardie di
 * autorizzazione → `transition` → `persistTransition` — e la condivide in
 * `applyEvent`. La divisione dei compiti è netta: qui si traduce l'utente in
 * membro e si controlla chi può fare cosa; **le regole del gioco stanno tutte
 * nel motore**, che rifiuta con gli stessi codici tipizzati che queste
 * funzioni restituiscono (F3-03). La UI di Fase 5 li mostrerà così come sono.
 *
 * Il tempo è un parametro anche qui: `now` ha come default l'orologio vero,
 * ma test, driver e seed lo iniettano — è ciò che permette di collaudare
 * "resume dopo 5 minuti" senza aspettare 5 minuti.
 */

export type ActionOutcome = {
  state: AuctionState;
  /** `false` se la transizione era un no-op (P14): nessun bump, nessun broadcast. */
  mutated: boolean;
};

type EventFactory = (loaded: LoadedAuction) => Result<AuctionEvent>;

/** Chi ha causato la transizione: un utente, o il tempo. */
type Actor = string | "system";

/** `LIVE/LOT_OPEN`, `PAUSED/LOT_OPEN`, `READY`, `COMPLETED`… */
function describePosition(state: AuctionState): string {
  return state.phase === null ? state.status : `${state.status}/${state.phase}`;
}

/**
 * La memoria dell'asta (F3-09, PLAN §17): ogni transizione effettiva scrive
 * una riga in `events` — nella stessa transazione della mutazione — e una
 * riga JSON su stdout, quella che si segue in diretta con `pm2 logs`.
 */
async function recordEvent(
  tx: Tx,
  loaded: LoadedAuction,
  next: AuctionState,
  event: AuctionEvent,
  actor: Actor,
  now: Millis,
): Promise<void> {
  // Il lotto toccato dalla transizione: quello corrente dopo, o — quando la
  // transizione lo archivia (fine reveal) — quello che era corrente prima.
  const lotEngineId = next.currentLotId ?? loaded.state.currentLotId;
  const lotId =
    lotEngineId === null ? null : (loaded.refs.lots.get(lotEngineId) ?? null);

  const payload = {
    from: describePosition(loaded.state),
    to: describePosition(next),
    lotId,
    actor,
  };
  await tx.insert(events).values({
    auctionId: loaded.auction.id,
    type: event.type,
    payload,
    createdAt: new Date(now),
  });
  console.log(
    JSON.stringify({
      auctionId: loaded.auction.id,
      type: event.type,
      ...payload,
      ts: new Date(now).toISOString(),
    }),
  );
}

/**
 * Il ciclo completo di una mutazione di gioco: lock, stato, evento, motore,
 * diff su DB. Un no-op del motore (stesso riferimento) esce con
 * `mutated: false` e `withAuctionLock` non bumpa né fa broadcast.
 */
async function applyEvent(
  auctionId: string,
  makeEvent: EventFactory,
  now: Millis,
  actor: Actor,
): Promise<Result<ActionOutcome>> {
  const outcome = await withAuctionLock<ActionOutcome>(
    auctionId,
    async (tx, loaded) => {
      const event = makeEvent(loaded);
      if (!event.ok) return { result: event, mutated: false };

      const next = transition(loaded.state, event.value, now);
      if (!next.ok) return { result: next, mutated: false };

      if (next.value === loaded.state) {
        return {
          result: ok({ state: loaded.state, mutated: false }),
          mutated: false,
        };
      }

      await persistTransition(tx, loaded, next.value, now);
      await recordEvent(tx, loaded, next.value, event.value, actor, now);
      return {
        result: ok({ state: next.value, mutated: true }),
        mutated: true,
      };
    },
  );

  // Il riarmo del timer, a commit avvenuto: LIVE con deadline → armato sulla
  // nuova scadenza; PAUSED/COMPLETED → spento (F3-07/F3-08).
  if (outcome.ok && outcome.value.mutated) {
    syncTimer(auctionId, outcome.value.state);
  }
  return outcome;
}

// ─── Guardie ─────────────────────────────────────────────────────────────────

function requireOwner(
  loaded: LoadedAuction,
  userId: string,
  cosa: string,
): Result<never> | null {
  if (loaded.auction.ownerUserId !== userId) {
    return fail("FORBIDDEN", `Solo chi ha creato l'asta può ${cosa}.`);
  }
  return null;
}

/**
 * Il gate di avvio (F4-06, PLAN §7): `READY → LIVE` solo con **tutti i membri
 * in presence LIVE**. Non "non OFFLINE": LIVE, cioè con la pagina davvero
 * aperta in primo piano — l'asta parte con un countdown di trenta secondi e
 * chi ha il telefono in tasca lo scopre dopo aver perso il primo lotto.
 *
 * ⚠ P11 — riguarda i **membri**: l'owner che non ha joinato non conta, non
 * dovendo offrire. Se ha joinato è un membro come gli altri.
 */
function requireEveryoneLive(
  loaded: LoadedAuction,
  now: Millis,
): Result<never> | null {
  const assenti = [...loaded.view.members.entries()]
    .filter(([, m]) => derivePresence(m.lastSeenAt, m.isVisible, now) !== "LIVE")
    .map(([, m]) => m.displayName ?? m.teamName);
  if (assenti.length === 0) return null;
  return fail(
    "MEMBERS_NOT_READY",
    `Non sono collegati: ${assenti.join(", ")}. L'asta parte quando tutti hanno la pagina aperta.`,
  );
}

function requireMember(loaded: LoadedAuction, userId: string): Result<string> {
  const memberId = loaded.memberIdByUserId.get(userId);
  if (!memberId) {
    return fail("MEMBER_NOT_FOUND", "Non sei un partecipante di questa asta.");
  }
  return ok(memberId);
}

// ─── Le azioni ───────────────────────────────────────────────────────────────

/**
 * `READY → LIVE` (F3-04). Il ruolo iniziale è `role_order[0]`; qui si sceglie
 * solo il seat di partenza. Due guardie prima del motore: la proprietà
 * dell'asta e la presence di tutti i membri (F4-06).
 */
export async function startAuction(
  actorUserId: string,
  auctionId: string,
  startSeatIndex: number,
  now: Millis = Date.now(),
): Promise<Result<ActionOutcome>> {
  return applyEvent(
    auctionId,
    (loaded) =>
      requireOwner(loaded, actorUserId, "avviarla") ??
      requireEveryoneLive(loaded, now) ??
      ok({ type: "START", startSeatIndex }),
    now,
    actorUserId,
  );
}

export async function pickPlayer(
  actorUserId: string,
  auctionId: string,
  playerId: string,
  now: Millis = Date.now(),
): Promise<Result<ActionOutcome>> {
  return applyEvent(
    auctionId,
    (loaded) => {
      const member = requireMember(loaded, actorUserId);
      if (!member.ok) return member;
      return ok({ type: "PICK", memberId: member.value, playerId });
    },
    now,
    actorUserId,
  );
}

export async function placeBid(
  actorUserId: string,
  auctionId: string,
  amount: number,
  now: Millis = Date.now(),
): Promise<Result<ActionOutcome>> {
  return applyEvent(
    auctionId,
    (loaded) => {
      const member = requireMember(loaded, actorUserId);
      if (!member.ok) return member;
      return ok({ type: "PLACE_BID", memberId: member.value, amount });
    },
    now,
    actorUserId,
  );
}

export async function withdrawBid(
  actorUserId: string,
  auctionId: string,
  now: Millis = Date.now(),
): Promise<Result<ActionOutcome>> {
  return applyEvent(
    auctionId,
    (loaded) => {
      const member = requireMember(loaded, actorUserId);
      if (!member.ok) return member;
      return ok({ type: "WITHDRAW_BID", memberId: member.value });
    },
    now,
    actorUserId,
  );
}

/**
 * L'unico evento del tempo (F3-06). Senza attore e senza autorizzazione: la
 * chiamano i timer e lo sweep, ed è **guardata dentro il motore** (I7) —
 * in anticipo sulla deadline, o su una fase già avanzata, è un no-op che non
 * bumpa `state_version`.
 */
export async function advancePhase(
  auctionId: string,
  now: Millis = Date.now(),
): Promise<Result<ActionOutcome>> {
  return applyEvent(auctionId, () => ok({ type: "ADVANCE" }), now, "system");
}

export async function pauseAuction(
  actorUserId: string,
  auctionId: string,
  now: Millis = Date.now(),
): Promise<Result<ActionOutcome>> {
  return applyEvent(
    auctionId,
    (loaded) =>
      requireOwner(loaded, actorUserId, "metterla in pausa") ??
      ok({ type: "PAUSE" }),
    now,
    actorUserId,
  );
}

export async function resumeAuction(
  actorUserId: string,
  auctionId: string,
  now: Millis = Date.now(),
): Promise<Result<ActionOutcome>> {
  return applyEvent(
    auctionId,
    (loaded) =>
      requireOwner(loaded, actorUserId, "riprenderla") ??
      ok({ type: "RESUME" }),
    now,
    actorUserId,
  );
}
