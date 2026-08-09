import type { AuctionPhase, AuctionStatus, Role } from "@/lib/domain";

/**
 * La forma dello snapshot (PLAN §8): l'unico messaggio che viaggia dal server
 * al client durante l'asta.
 *
 * **Un solo tipo di evento, e porta lo stato completo.** Niente delta, niente
 * merge lato client: a ogni transizione il server rimanda tutto, sanificato per
 * chi lo riceve. Con dodici persone e pochi KB il costo è irrilevante, e in
 * cambio spariscono due intere classi di bug — il merge sbagliato di un delta e
 * il desync di chi si riconnette a metà round (regola 7, invariante I10).
 *
 * Il file sta qui, e non dentro `lib/engine/`, per la stessa ragione di
 * `lib/domain.ts`: lo importa anche il client. Sono soltanto tipi — nessuna
 * dipendenza, niente ORM che viaggia fino al telefono.
 *
 * **Tutti i tempi sono stringhe ISO.** Il client non si fida del proprio
 * orologio: calcola `offset = serverNow − Date.now()` a ogni snapshot e rende i
 * countdown come `deadline − (Date.now() + offset)`.
 */

export type Presence = "LIVE" | "IDLE" | "OFFLINE";

export type SnapshotAuction = {
  id: string;
  name: string;
  status: AuctionStatus;
  /** `null` fuori da LIVE/PAUSED. */
  phase: AuctionPhase | null;
  /** ISO. La scadenza della fase corrente: è da qui che nasce ogni countdown. */
  phaseDeadline: string | null;
  /** ISO, valorizzato solo con `status = PAUSED`. */
  pausedAt: string | null;
  currentRole: Role | null;
  currentSeatIndex: number | null;
  /** Chi è di turno, già risolto da seat a membro. */
  currentMemberId: string | null;
  roleOrder: Role[];
  seats: number;
  slots: Record<Role, number>;
  timers: {
    bidSeconds: number;
    pickSeconds: number;
    tiePrepSeconds: number;
    revealSeconds: number;
  };
};

export type SnapshotRosterEntry = {
  /**
   * L'id della riga `assignments`, non del giocatore: è ciò che
   * `voidAssignment(assignmentId)` (PLAN §9) vuole come riferimento, e da
   * nessun'altra parte la regia lo avrebbe. Un uuid di riga non dice niente di
   * nessuna busta, quindi non tocca I8.
   */
  assignmentId: string;
  playerId: string;
  name: string;
  role: Role;
  team: string;
  price: number;
};

export type SnapshotMember = {
  id: string;
  teamName: string;
  displayName: string | null;
  seatIndex: number;
  credits: number;
  maxBid: number;
  slotsFilled: Record<Role, number>;
  presence: Presence;
  roster: SnapshotRosterEntry[];
};

export type SnapshotPlayer = {
  id: string;
  name: string;
  role: Role;
  team: string;
  fvm: number;
};

export type SnapshotRevealBid = {
  memberId: string;
  amount: number;
  /** ISO — nel round 2 è il timestamp ereditato dal round 1, e decide gli stalli. */
  amountSetAt: string;
  withdrawnAt: string | null;
};

/** Popolato **solo** in `LOT_REVEAL`: è qui che gli importi diventano pubblici. */
export type SnapshotReveal = {
  winnerMemberId: string;
  price: number;
  rounds: Array<{
    roundNo: 1 | 2;
    minAmount: number;
    bids: SnapshotRevealBid[];
  }>;
};

/**
 * Lo spareggio annunciato, popolato solo in `LOT_TIE_PREP`: l'importo pareggiato
 * (che sarà il `min_amount` del round 2) e chi lo ha pareggiato. Non è una
 * deroga a I8 — è il contenuto stesso dell'annuncio di spareggio (PLAN §4), e
 * quella cifra sta per diventare la soglia pubblica del round successivo.
 */
export type SnapshotTie = {
  amount: number;
  memberIds: string[];
};

export type SnapshotLot = {
  id: string;
  seq: number;
  player: SnapshotPlayer;
  calledByMemberId: string;
  autoCalled: boolean;
  /** Il round in corso (o l'ultimo giocato, se il lotto è già risolto). */
  roundNo: 1 | 2;
  minAmount: number;
  /** ISO — la scadenza delle offerte, che è anche quella contro cui il server valida. */
  endsAt: string;
  closedAt: string | null;
  /**
   * Chi può offrire nel round corrente (`round_eligibility`).
   *
   * È l'unica cosa che si sa degli altri finché le buste non si aprono, e non
   * dice niente delle offerte: dice chi *potrebbe* offrire, ed è comunque
   * deducibile da rose e crediti, che tutti vedono già. Chi ha davvero
   * consegnato — non l'importo: proprio il fatto di aver consegnato — non esce
   * dal server in nessuna forma prima di `LOT_REVEAL` (M1, §1).
   */
  eligibleMemberIds: string[];
  tie: SnapshotTie | null;
  reveal: SnapshotReveal | null;
};

/**
 * La propria offerta sul lotto corrente — e soltanto la propria. `null` per il
 * manager che non è membro e per la vista TV, che non hanno un viewer.
 * `withdrawnAt` valorizzato significa ritiro: definitivo, non si torna a offrire.
 */
export type SnapshotMyBid = {
  amount: number;
  amountSetAt: string;
  withdrawnAt: string | null;
};

/**
 * Il listone dell'asta, l'unica cosa che il server manda al portale **fuori**
 * dallo snapshot.
 *
 * Non è stato dell'asta: sono cinquecento righe immutabili dall'import in poi,
 * e non contengono nulla di sanificabile (nessuna offerta, nessun credito).
 * Replicarle a ogni transizione per dodici viewer moltiplicherebbe per venti il
 * costo del canale senza aggiungere un bit d'informazione. La pagina di gioco le
 * carica una volta; **quali** giocatori siano ancora liberi resta funzione dello
 * snapshot, che le rose ce le ha (regola 7, I10).
 */
export type PoolPlayer = {
  id: string;
  name: string;
  team: string;
  role: Role;
  fvm: number;
  quot: number;
};

export type Snapshot = {
  /** ISO — l'orologio del server, per la sincronizzazione dei countdown. */
  serverNow: string;
  /** Il client scarta gli snapshot con una versione inferiore a quella già vista. */
  stateVersion: number;
  /** Il membro per cui questo snapshot è stato sanificato; `null` per manager e TV. */
  viewerMemberId: string | null;
  auction: SnapshotAuction;
  members: SnapshotMember[];
  currentLot: SnapshotLot | null;
  myBid: SnapshotMyBid | null;
};
