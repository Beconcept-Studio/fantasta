import type { Role } from "@/lib/domain";
import type {
  Assignment,
  AuctionState,
  Bid,
  Member,
  Millis,
  Player,
} from "@/lib/engine/types";

/**
 * Costruttori di stato per i test del motore.
 *
 * Il default è un'asta piccola apposta — 4 membri, 1 slot per ruolo — perché
 * un test che percorre un'asta intera deve poterlo fare in poche righe. I test
 * sui numeri veri (500 crediti, 25 slot) sovrascrivono `slots` e basta.
 *
 * Il tempo parte da `T0` e si scrive `T0 + sec(30)`: nessuna data, nessun
 * `Date.now()` — il tempo è sempre un parametro (regola 2).
 */

export const T0: Millis = 1_000_000;

export function sec(n: number): Millis {
  return n * 1000;
}

export function member(seatIndex: number, budgetInitial = 500): Member {
  return { id: `m${seatIndex}`, seatIndex, budgetInitial };
}

let playerCounter = 0;

export function player(
  id: string,
  role: Role,
  opts: Partial<Pick<Player, "extId" | "fvm" | "quot" | "outOfList">> = {},
): Player {
  playerCounter += 1;
  return {
    id,
    extId: opts.extId ?? playerCounter,
    role,
    fvm: opts.fvm ?? 10,
    quot: opts.quot ?? 10,
    outOfList: opts.outOfList ?? false,
  };
}

export function assignment(
  id: number,
  memberId: string,
  playerId: string,
  price: number,
  opts: Partial<Pick<Assignment, "voidedAt" | "source" | "lotId">> = {},
): Assignment {
  return {
    id,
    memberId,
    playerId,
    price,
    lotId: opts.lotId ?? null,
    source: opts.source ?? "AUCTION",
    createdAt: T0,
    voidedAt: opts.voidedAt ?? null,
  };
}

export function bid(
  id: number,
  memberId: string,
  amount: number,
  amountSetAt: Millis,
  opts: Partial<Pick<Bid, "withdrawnAt" | "createdAt">> = {},
): Bid {
  return {
    id,
    memberId,
    amount,
    amountSetAt,
    createdAt: opts.createdAt ?? amountSetAt,
    withdrawnAt: opts.withdrawnAt ?? null,
  };
}

type StateOverrides = Partial<Omit<AuctionState, "config">> & {
  config?: Partial<AuctionState["config"]>;
};

/**
 * Un'asta LIVE a 4 membri in WAITING_PICK sul primo ruolo di `roleOrder`,
 * con 1 slot per ruolo e nessun giocatore: ogni test aggiunge i suoi.
 */
export function makeState(overrides: StateOverrides = {}): AuctionState {
  const config = {
    seats: 4,
    budgetDefault: 500,
    bidSeconds: 30,
    pickSeconds: 30,
    tiePrepSeconds: 10,
    revealSeconds: 10,
    slots: { P: 1, D: 1, C: 1, A: 1 },
    roleOrder: ["P", "D", "C", "A"] as Role[],
    includeOutOfList: false,
    ...overrides.config,
  };
  const members =
    overrides.members ??
    Array.from({ length: config.seats }, (_, i) =>
      member(i, config.budgetDefault),
    );
  return {
    config,
    status: "LIVE",
    phase: "WAITING_PICK",
    currentRole: config.roleOrder[0],
    currentSeatIndex: 0,
    currentLotId: null,
    phaseDeadline: T0 + sec(config.pickSeconds),
    pausedAt: null,
    players: [],
    lots: [],
    assignments: [],
    ledger: [],
    nextId: 1,
    ...stripConfig(overrides),
    members,
  };
}

function stripConfig(overrides: StateOverrides): Partial<AuctionState> {
  const rest = { ...overrides };
  delete rest.config;
  delete rest.members;
  return rest as Partial<AuctionState>;
}
