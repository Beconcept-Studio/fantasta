import type {
  AuctionPhase,
  AuctionStatus,
  CarmyJudgement,
  PlayerInsights,
  Role,
} from "@/lib/domain";

/**
 * La forma dello snapshot (PLAN §8): l'unico messaggio che viaggia dal server
 * al client durante l'asta.
 *
 * **Un solo tipo di evento per lo stato, e porta lo stato completo.** Niente
 * delta, niente merge lato client: a ogni transizione il server rimanda tutto,
 * sanificato per chi lo riceve. Con dodici persone e pochi KB il costo è
 * irrilevante, e in cambio spariscono due intere classi di bug — il merge
 * sbagliato di un delta e il desync di chi si riconnette a metà round (regola 7,
 * invariante I10). Da M12 ce n'è un secondo, e non porta stato: il congedo di
 * `DELETED_EVENT`, che dice che l'asta non esiste più.
 *
 * Il file sta qui, e non dentro `lib/engine/`, per la stessa ragione di
 * `lib/domain.ts`: lo importa anche il client. Tipi, più i nomi su cui le due
 * sponde del canale devono essere d'accordo — nessuna dipendenza, niente ORM
 * che viaggia fino al telefono.
 *
 * **Tutti i tempi sono stringhe ISO.** Il client non si fida del proprio
 * orologio: calcola `offset = serverNow − Date.now()` a ogni snapshot e rende i
 * countdown come `deadline − (Date.now() + offset)`.
 */

/**
 * **L'evento terminale del canale** (M12 §3): l'asta è stata cancellata, non
 * arriverà nessun altro snapshot, lo stream si chiude subito dopo.
 *
 * Il nome sta qui perché è l'unica cosa su cui la rotta dello stream e l'hook
 * del client devono essere d'accordo **alla lettera**: due stringhe uguali
 * scritte in due file sono due stringhe che un giorno divergono, e il modo in
 * cui te ne accorgi è un congedo che non arriva a nessuno.
 */
export const DELETED_EVENT = "deleted";

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
    /**
     * Il cancello dei risultati (M14). `0` = nessun cancello, e la fase
     * `LOT_SEALED` non compare mai.
     */
    resultGateSeconds: number;
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
  /**
   * L'identificativo di Fantacalcio.it — la colonna `#` del listone — con cui
   * si costruisce l'indirizzo della figurina (M7).
   *
   * ⚠ **Non tocca I8, e vale la pena dire perché**: il giocatore in asta è
   * pubblico per definizione, è la busta a essere segreta. Da `extId` non si
   * deduce niente di nessuna offerta — è la stessa informazione di `name` e
   * `team`, scritta in numeri.
   *
   * Sta qui e **non** nel pool dei giocatori: il pool serve a scegliere chi
   * chiamare, e nessuno ha chiesto le figurine lì (regola 8).
   */
  extId: number;
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
  /**
   * Titolarità, rigoristi, calci piazzati (M8).
   *
   * ⚠ **`?` e non `| null`, e la differenza è il cuore di M8 §6.** La chiave è
   * *assente* per chi non ha `is_pro`: non arriva un `null` da nascondere, non
   * arriva niente. Questo tipo viaggia nel payload RSC di un client component,
   * quindi tutto ciò che sta qui **è nel browser di chi apre la pagina**,
   * leggibile in DevTools in tre click — nasconderlo in JSX o in CSS non sarebbe
   * una protezione, sarebbe una decorazione. La decisione la prende la query, una
   * volta sola (`canSeeInsights`), e da qui in poi l'assenza si propaga da sé:
   * `undefined` non si renderizza, senza nessun `if (isPro)` nei componenti.
   */
  insights?: PlayerInsights;
  /**
   * Il giudizio di chi compila il foglio: fascia, titolarità, prezzo, tag (M10B).
   *
   * ⚠ **`?` per la stessa ragione di `insights`, e senza nessuna eccezione**
   * (M10B §7): la chiave è *assente* per chi non ha `is_pro`, non `null`. **I
   * filtri per `is_pro` della lista di chiamata non sono la protezione** — sono
   * l'interfaccia sopra un dato che a chi non è pro non arriva affatto. Se un
   * giorno il filtro si vedesse e i dati non ci fossero, il bug è nella query.
   *
   * ⚠ **E non entra in `serializeSnapshot`.** Viaggia su `listPickPool`, che è la
   * lettura del listone e non lo stato del gioco: la regola 3 protegge gli importi
   * delle buste durante `LOT_OPEN`, e qui non c'è nessuna offerta da sanificare.
   */
  carmy?: CarmyJudgement;
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
