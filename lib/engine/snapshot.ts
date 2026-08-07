import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { auctions } from "@/lib/db/schema";
import type {
  Snapshot,
  SnapshotBidStatus,
  SnapshotLot,
  SnapshotMember,
  SnapshotMyBid,
  SnapshotReveal,
  SnapshotTie,
} from "@/lib/realtime/types";

import { type LoadedAuction, loadAuctionState } from "./mutate";
import { derivePresence } from "./presence";
import { credits, maxBid, ownedByRole, resolveRound } from "./rules";
import type { AuctionState, Lot, LotRound, Millis } from "./types";

/**
 * **L'unico punto da cui lo stato dell'asta esce dal server** (regola 3).
 *
 * Non è una preferenza stilistica: è il modo di rendere vera l'invariante I8
 * — «durante `LOT_OPEN` nessuno vede l'importo di un'offerta altrui» — *per
 * costruzione* invece che per attenzione. Se la serializzazione fosse sparsa
 * in tre pagine e due componenti, basterebbe una `JSON.stringify` distratta
 * per far trapelare una busta, e in un'asta a busta chiusa una busta che
 * trapela non è un bug: è l'asta rifatta. Con una funzione sola, il test I8 su
 * partecipante, manager e vista TV copre tutte le uscite possibili.
 *
 * La sanificazione ha una regola sola, applicata due volte:
 *
 * - degli altri si sa **se** hanno offerto, mai **quanto** (`bidStatus`);
 * - il proprio importo lo vede solo il proprio viewer (`myBid`), e chi viewer
 *   non è — il manager che non gioca, la TV — non vede nemmeno quello.
 *
 * Gli importi diventano pubblici in un momento solo, `LOT_REVEAL`, ed è lì che
 * compare `reveal`. L'unica informazione che esce prima è l'importo pareggiato
 * durante `LOT_TIE_PREP` (`tie`): è il contenuto stesso dell'annuncio di
 * spareggio, e fra due secondi sarà il `min_amount` pubblico del round 2.
 *
 * Nota sulla firma: prende il bundle di `loadAuctionState`, non il solo
 * `AuctionState`. Servono tre cose che il motore puro non ha — la riga
 * `auctions` (nome e `state_version`), la mappa `refs` (gli id del motore sono
 * etichette di caricamento: verso il client devono uscire **uuid**) e `view`
 * (nomi e presence). Il punto di uscita resta uno solo, che è ciò che conta.
 */

// ─── Tempo ───────────────────────────────────────────────────────────────────

function iso(ms: Millis): string;
function iso(ms: Millis | null): string | null;
function iso(ms: Millis | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

// ─── Lo snapshot ─────────────────────────────────────────────────────────────

function currentRoundOf(lot: Lot): LotRound {
  const round = lot.rounds[lot.rounds.length - 1];
  if (!round) throw new Error(`lotto ${lot.id} senza round`);
  return round;
}

function serializeMembers(
  loaded: LoadedAuction,
  now: Millis,
): SnapshotMember[] {
  const { state, view } = loaded;
  return [...state.members]
    .sort((a, b) => a.seatIndex - b.seatIndex)
    .map((m) => {
      const info = view.members.get(m.id);
      const owned = ownedByRole(state, m.id);
      return {
        id: m.id,
        teamName: info?.teamName ?? "",
        displayName: info?.displayName ?? null,
        seatIndex: m.seatIndex,
        credits: credits(state, m.id),
        maxBid: maxBid(state, m.id),
        slotsFilled: { P: owned.P, D: owned.D, C: owned.C, A: owned.A },
        presence: derivePresence(
          info?.lastSeenAt ?? null,
          info?.isVisible ?? false,
          now,
        ),
        roster: state.assignments
          .filter((a) => a.memberId === m.id && a.voidedAt === null)
          .map((a) => {
            const player = state.players.find((p) => p.id === a.playerId);
            if (!player) {
              throw new Error(`assegnazione su un giocatore sconosciuto: ${a.playerId}`);
            }
            const pv = view.players.get(a.playerId);
            return {
              playerId: a.playerId,
              name: pv?.name ?? "",
              role: player.role,
              team: pv?.team ?? "",
              price: a.price,
            };
          }),
      };
    });
}

/**
 * Lo spareggio annunciato: chi ha pareggiato e a quanto. Si ricalcola dal
 * round 1 chiuso con la stessa `resolveRound` che ha deciso il pareggio —
 * nessuna copia dello stesso ragionamento in due posti.
 */
function serializeTie(lot: Lot): SnapshotTie | null {
  const outcome = resolveRound(lot.rounds[0]);
  if (outcome.kind !== "TIE") return null;
  return {
    amount: outcome.amount,
    memberIds: outcome.bids.map((b) => b.memberId),
  };
}

/** Il pannello di reveal: **tutte** le buste, di tutti i round. Solo in LOT_REVEAL. */
function serializeReveal(lot: Lot): SnapshotReveal | null {
  if (lot.winnerMemberId === null || lot.finalPrice === null) return null;
  return {
    winnerMemberId: lot.winnerMemberId,
    price: lot.finalPrice,
    rounds: lot.rounds.map((r) => ({
      roundNo: r.roundNo,
      minAmount: r.minAmount,
      bids: r.bids.map((b) => ({
        memberId: b.memberId,
        amount: b.amount,
        amountSetAt: iso(b.amountSetAt),
        withdrawnAt: iso(b.withdrawnAt),
      })),
    })),
  };
}

function serializeLot(
  loaded: LoadedAuction,
  state: AuctionState,
): SnapshotLot | null {
  if (state.currentLotId === null) return null;
  const lot = state.lots.find((l) => l.id === state.currentLotId);
  if (!lot) return null;

  const uuid = loaded.refs.lots.get(lot.id);
  if (!uuid) throw new Error(`lotto ${lot.id} senza uuid: snapshot impossibile`);

  const round = currentRoundOf(lot);
  const player = state.players.find((p) => p.id === lot.playerId);
  if (!player) throw new Error(`lotto ${lot.id} su un giocatore sconosciuto`);
  const pv = loaded.view.players.get(lot.playerId);

  // ⚠ I8 — di ogni altro esce un booleano, mai una cifra.
  const bidStatus: SnapshotBidStatus[] = round.eligibleMemberIds.map(
    (memberId) => {
      const bid = round.bids.find((b) => b.memberId === memberId);
      return {
        memberId,
        hasBid: bid !== undefined && bid.withdrawnAt === null,
        withdrawn: bid?.withdrawnAt != null,
      };
    },
  );

  return {
    id: uuid,
    seq: lot.seq,
    player: {
      id: player.id,
      name: pv?.name ?? "",
      role: player.role,
      team: pv?.team ?? "",
      fvm: player.fvm,
    },
    calledByMemberId: lot.calledByMemberId,
    autoCalled: lot.autoCalled,
    roundNo: round.roundNo,
    minAmount: round.minAmount,
    endsAt: iso(round.endsAt),
    closedAt: iso(round.closedAt),
    eligibleMemberIds: round.eligibleMemberIds,
    bidStatus,
    tie: state.phase === "LOT_TIE_PREP" ? serializeTie(lot) : null,
    reveal: state.phase === "LOT_REVEAL" ? serializeReveal(lot) : null,
  };
}

function serializeMyBid(
  state: AuctionState,
  viewerMemberId: string | null,
): SnapshotMyBid | null {
  if (viewerMemberId === null || state.currentLotId === null) return null;
  const lot = state.lots.find((l) => l.id === state.currentLotId);
  if (!lot) return null;
  const bid = currentRoundOf(lot).bids.find((b) => b.memberId === viewerMemberId);
  if (!bid) return null;
  return {
    amount: bid.amount,
    amountSetAt: iso(bid.amountSetAt),
    withdrawnAt: iso(bid.withdrawnAt),
  };
}

export function serializeSnapshot(
  loaded: LoadedAuction,
  viewerMemberId: string | null,
  now: Millis = Date.now(),
): Snapshot {
  const { auction, state } = loaded;
  const currentMember =
    state.currentSeatIndex === null
      ? null
      : (state.members.find((m) => m.seatIndex === state.currentSeatIndex) ??
        null);

  return {
    serverNow: iso(now),
    stateVersion: auction.stateVersion,
    viewerMemberId,
    auction: {
      id: auction.id,
      name: auction.name,
      status: state.status,
      phase: state.phase,
      phaseDeadline: iso(state.phaseDeadline),
      pausedAt: iso(state.pausedAt),
      currentRole: state.currentRole,
      currentSeatIndex: state.currentSeatIndex,
      currentMemberId: currentMember?.id ?? null,
      roleOrder: [...state.config.roleOrder],
      seats: state.config.seats,
      slots: { ...state.config.slots },
      timers: {
        bidSeconds: state.config.bidSeconds,
        pickSeconds: state.config.pickSeconds,
        tiePrepSeconds: state.config.tiePrepSeconds,
        revealSeconds: state.config.revealSeconds,
      },
    },
    members: serializeMembers(loaded, now),
    currentLot: serializeLot(loaded, state),
    myBid: serializeMyBid(state, viewerMemberId),
  };
}

// ─── La lettura ──────────────────────────────────────────────────────────────

/**
 * Carica un'asta per il **solo scopo di serializzarla**: nessun `FOR UPDATE`,
 * nessuna transazione. Non è una scorciatoia alla regola 4 — quella vieta di
 * *mutare* fuori dal lock, e qui non si scrive niente. Prendere il lock a ogni
 * snapshot metterebbe in fila dodici letture dietro un'offerta.
 */
export async function loadForSnapshot(
  auctionId: string,
): Promise<LoadedAuction | null> {
  const [auction] = await db
    .select()
    .from(auctions)
    .where(eq(auctions.id, auctionId));
  if (!auction) return null;
  return loadAuctionState(db, auction);
}
