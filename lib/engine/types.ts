import type { AuctionPhase, AuctionStatus, Role } from "@/lib/domain";

/**
 * I tipi puri del motore (F2-01): lo stato di un'asta come oggetto in memoria,
 * speculare alle tabelle di PLAN §3 ma senza database.
 *
 * Tutta la logica dell'asta — `rules.ts` e `machine.ts` — lavora solo su questi
 * tipi. Niente `lib/db`, niente rete, niente `Date.now()`: è ciò che rende la
 * macchina a stati collaudabile in millisecondi da riga di comando (PLAN §11,
 * Fase 2). Il caricamento da database e la persistenza arrivano in Fase 3 e
 * vivono altrove.
 *
 * Due convenzioni di rappresentazione (registrate in DECISIONS 2026-08-07):
 *
 * - **Il tempo è un numero**: millisecondi di epoch, come li produce
 *   `Date.getTime()`. Mai un oggetto `Date` dentro lo stato — i confronti fra
 *   scadenze diventano confronti fra numeri e i test scrivono `t0 + 30_000`
 *   invece di costruire date.
 * - **Gli id delle entità create dal motore sono numeri sequenziali**, presi da
 *   `nextId` nello stato. Una funzione pura non può generare uuid; il contatore
 *   sì, ed è deterministico — il tie-break `MIN(bids.id)` di PLAN §4 resta
 *   riproducibile nei test. Gli id di membri e giocatori, che il motore non
 *   crea mai, restano stringhe opache decise da chi costruisce lo stato.
 */

// ─── Tempo e id ──────────────────────────────────────────────────────────────

/** Millisecondi di epoch (`Date.getTime()`). Il tempo si passa, non si legge. */
export type Millis = number;

/** Id di un'entità creata dal motore (lotto, offerta, assegnazione). */
export type EngineId = number;

// ─── Configurazione ──────────────────────────────────────────────────────────

export type SlotsByRole = Record<Role, number>;

/**
 * La configurazione dell'asta come la vede il motore: i campi di `auctions`
 * che non cambiano durante il gioco (i timer cambiano solo "dal lotto
 * successivo", quindi ogni transizione legge il valore corrente da qui).
 * Il `name` non c'è: al motore non serve.
 */
export type AuctionConfig = {
  seats: number;
  budgetDefault: number;
  bidSeconds: number;
  pickSeconds: number;
  tiePrepSeconds: number;
  revealSeconds: number;
  /**
   * Il cancello dei risultati (M14): quanti secondi il round resta chiuso senza
   * che nessuno sappia com'è finito. **`0` significa che la fase non esiste**, non
   * che dura zero — `advanceLotOpen` risolve nella stessa transizione, come prima
   * di M14. Il perché per esteso sta su `TIMER_LIMITS` in `setup-rules.ts`.
   */
  resultGateSeconds: number;
  slots: SlotsByRole;
  roleOrder: Role[];
  /** ⚠ P7 — se `true` i fuori lista rientrano nel pool chiamabile. */
  includeOutOfList: boolean;
};

// ─── Entità ──────────────────────────────────────────────────────────────────

export type Member = {
  id: string;
  /** Ordine di rotazione, 0-based, denso (0..seats-1). */
  seatIndex: number;
  budgetInitial: number;
};

export type Player = {
  id: string;
  extId: number;
  role: Role;
  fvm: number;
  quot: number;
  outOfList: boolean;
};

export type Bid = {
  id: EngineId;
  memberId: string;
  amount: number;
  /**
   * Quando è stata fissata QUESTA cifra. È il campo che decide gli stalli del
   * round 2: il carry-forward lo preserva dal round 1 (PLAN §4).
   */
  amountSetAt: Millis;
  createdAt: Millis;
  /**
   * ⚠ **Sempre `null` da M16**, e resta perché le aste già giocate hanno dei
   * ritiri dentro: il campo si legge — il reveal, il log dei lotti, il
   * tabellone — ma non lo scrive più nessuno. L'evento `WITHDRAW_BID` non
   * esiste, e con lui non esiste nessun modo di far diventare questo campo una
   * data. Non è una colonna morta: è un pezzo di storia che continua a
   * raccontare il vero.
   */
  withdrawnAt: Millis | null;
};

export type LotRound = {
  roundNo: 1 | 2;
  /** 1 nel round base; l'importo pareggiato nello spareggio (I6). */
  minAmount: number;
  startsAt: Millis;
  endsAt: Millis;
  closedAt: Millis | null;
  /** `round_eligibility`: chi può offrire in questo round. */
  eligibleMemberIds: string[];
  bids: Bid[];
};

/**
 * `OPEN` durante il lotto (round di offerte **e** cancello dei risultati),
 * `RESOLVED` quando le buste si aprono, `VOIDED` quando l'owner butta via il lotto
 * dal cancello (M14 §6).
 *
 * ⚠ **Un lotto annullato non è `RESOLVED` e non lo diventerà mai**, e non è una
 * distinzione formale: `isPublicLot` in `lib/auction-log.ts` equipara `RESOLVED` a
 * «le buste sono già state pubbliche», per costruzione — `enterReveal` scrive
 * quello status nell'istante esatto in cui gli importi diventano pubblici. Un lotto
 * annullato è **l'unico caso dell'applicazione in cui un lotto finisce senza che le
 * buste siano mai uscite**: dargli `RESOLVED` «per coerenza» — «è finito, no?» —
 * farebbe pubblicare dallo storico esattamente le offerte che il cancello esiste
 * per non svelare.
 *
 * ⚠ **E `VOIDED` non è `OPEN`, che è ciò che tiene in piedi I1**: l'indice parziale
 * `one_open_lot_per_auction` guarda `status = 'OPEN'`, quindi il lotto annullato
 * esce dall'indice e il lotto rifatto può nascere. Durante il cancello invece il
 * lotto è ancora `OPEN`, quindi l'indice continua a proteggere.
 */
export type LotStatus = "OPEN" | "RESOLVED" | "VOIDED";

export type Lot = {
  id: EngineId;
  /** Progressivo per asta, 1-based. */
  seq: number;
  playerId: string;
  calledByMemberId: string;
  autoCalled: boolean;
  status: LotStatus;
  currentRound: 1 | 2;
  winnerMemberId: string | null;
  finalPrice: number | null;
  openedAt: Millis;
  resolvedAt: Millis | null;
  rounds: LotRound[];
};

export type AssignmentSource = "AUCTION" | "MANUAL";

export type Assignment = {
  id: EngineId;
  memberId: string;
  playerId: string;
  price: number;
  /** Il lotto d'origine; `null` per le assegnazioni manuali. */
  lotId: EngineId | null;
  source: AssignmentSource;
  createdAt: Millis;
  /** Regola 5: mai DELETE — un'assegnazione annullata resta, con questo campo. */
  voidedAt: Millis | null;
};

/** Una rettifica di budget (PLAN §3, `ledger`). Il motore usa solo il delta. */
export type LedgerEntry = {
  memberId: string;
  delta: number;
};

// ─── Lo stato ────────────────────────────────────────────────────────────────

export type AuctionState = {
  config: AuctionConfig;
  status: AuctionStatus;
  /** Valorizzata solo con `status ∈ {LIVE, PAUSED}` (la pausa la congela). */
  phase: AuctionPhase | null;
  currentRole: Role | null;
  currentSeatIndex: number | null;
  currentLotId: EngineId | null;
  phaseDeadline: Millis | null;
  /** Valorizzato solo se `status = PAUSED`. */
  pausedAt: Millis | null;

  members: Member[];
  players: Player[];
  /** Tutti i lotti dell'asta, in ordine di `seq`; l'ultimo può essere OPEN (I1). */
  lots: Lot[];
  /** Tutte le assegnazioni, comprese le annullate (`voidedAt` valorizzato). */
  assignments: Assignment[];
  ledger: LedgerEntry[];

  /** Prossimo id per le entità create dal motore. Solo `transition` lo avanza. */
  nextId: EngineId;
};

// ─── Gli eventi ──────────────────────────────────────────────────────────────

/**
 * Gli input della macchina a stati: `transition(state, event, now)` restituisce
 * il nuovo stato. `ADVANCE` è l'unico evento "del tempo" — lo emettono i timer
 * e lo sweep in Fase 3 — ed è guardato dalla deadline (I7): arrivato in
 * anticipo, o su una fase già avanzata, è un no-op.
 */
export type AuctionEvent =
  | { type: "START"; startSeatIndex: number }
  | { type: "PICK"; memberId: string; playerId: string }
  | { type: "PLACE_BID"; memberId: string; amount: number }
  | { type: "ADVANCE" }
  | { type: "SKIP_REVEAL" }
  /**
   * «Mostra risultati» (M14): l'owner apre le buste prima che il cancello scada.
   * È il **secondo** evento della forma «un umano fa avanzare una fase in
   * anticipo», dopo `SKIP_REVEAL`, e per la stessa ragione non è un `ADVANCE`:
   * la guardia sulla deadline dentro `advance` serve a timer e sweep (I7), e
   * allentarla la renderebbe inutile per entrambi.
   */
  | { type: "SHOW_RESULTS" }
  /** «Annulla lotto» (M14): solo ad asta in pausa, e solo dentro il cancello. */
  | { type: "CANCEL_LOT" }
  | { type: "PAUSE" }
  | { type: "RESUME" };
