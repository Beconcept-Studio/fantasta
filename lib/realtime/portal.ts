import { ROLE_LABELS, type Role } from "@/lib/domain";

import type {
  PoolPlayer,
  Snapshot,
  SnapshotLot,
  SnapshotMember,
} from "./types";

/**
 * Il portale del partecipante, nella parte che si può provare senza un browser.
 *
 * La regola 7 dice che ogni schermata è funzione pura dello snapshot corrente
 * (invariante I10): se è vero, allora *quale* schermata mostrare, *quanto* si
 * può offrire e *se* si può ritirare sono funzioni pure — e si collaudano in
 * millisecondi, come il motore. È il motivo per cui stanno qui e non dentro i
 * componenti: i test girano in ambiente `node`, senza DOM.
 *
 * Le validazioni di questo file **non** sostituiscono quelle del server
 * (regola 6). Servono a disabilitare un pulsante e a scrivere un messaggio
 * prima del round trip; il rifiuto vero arriva sempre da `lib/engine/machine.ts`
 * con il suo codice tipizzato. Se i due divergono, quello giusto è il server.
 */

// ─── Countdown ───────────────────────────────────────────────────────────────

/**
 * Secondi mancanti, arrotondati per eccesso: a 0,4 secondi dalla scadenza il
 * telefono deve ancora dire "1", non "0". Il countdown **rende**, non decide
 * (regola 1) — a zero non chiude niente, aspetta lo snapshot.
 */
export function secondsLeft(remaining: number | null): number | null {
  return remaining === null ? null : Math.ceil(remaining / 1000);
}

/**
 * Il residuo di un countdown **congelato dalla pausa**.
 *
 * Serve perché il resume trasla le scadenze, ma solo al resume: durante la
 * pausa `phase_deadline` è ancora quella di prima e continuerebbe a scorrere
 * verso zero da sé. Il tempo davvero rimasto è quello che c'era all'istante
 * della pausa, e lo snapshot lo dice (`pausedAt`).
 */
export function pausedRemaining(
  deadline: string | null,
  pausedAt: string | null,
): number | null {
  if (deadline === null || pausedAt === null) return null;
  return Math.max(0, Date.parse(deadline) - Date.parse(pausedAt));
}

/** "in chiusura…" a zero: la chiusura è del server, e può tardare di un tick. */
export function countdownLabel(remaining: number | null): string {
  const seconds = secondsLeft(remaining);
  if (seconds === null) return "—";
  if (seconds <= 0) return "in chiusura…";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ─── Chi sono io, in questa asta ─────────────────────────────────────────────

export function myMember(
  snapshot: Snapshot,
  myMemberId: string | null,
): SnapshotMember | null {
  if (myMemberId === null) return null;
  return snapshot.members.find((m) => m.id === myMemberId) ?? null;
}

export function memberById(
  snapshot: Snapshot,
  memberId: string | null,
): SnapshotMember | null {
  if (memberId === null) return null;
  return snapshot.members.find((m) => m.id === memberId) ?? null;
}

/** Come chiamare un membro a schermo: il nome squadra, sempre valorizzato. */
export function memberLabel(member: SnapshotMember | null): string {
  return member?.teamName ?? "—";
}

// ─── Quale schermata ─────────────────────────────────────────────────────────

/**
 * La schermata principale del portale, dedotta dal solo snapshot.
 *
 * `frozen` è la pausa: la fase resta quella che era (la pausa la congela, non
 * la azzera), i countdown si fermano e nessuna azione è accettata dal server.
 * Non è una schermata a parte proprio per questo — §8bis chiede «lo stato
 * congelato», non una pagina bianca.
 *
 * `LOT` copre LOT_OPEN, LOT_TIE_PREP e LOT_REVEAL: finché `currentLot != null`
 * la card del lotto è l'elemento permanente della pagina, e sono le sue parti
 * interne a cambiare.
 */
export type PortalScreenKind =
  /** DRAFT o READY: l'asta non è ancora partita. */
  | "NOT_STARTED"
  /** Un lotto in corso (offerte, spareggio o buste aperte). */
  | "LOT"
  /** È il mio turno di chiamata. */
  | "PICK_MINE"
  /** Sta chiamando qualcun altro. */
  | "PICK_WAIT"
  | "COMPLETED";

export type PortalScreen = { kind: PortalScreenKind; frozen: boolean };

export function portalScreen(
  snapshot: Snapshot,
  myMemberId: string | null,
): PortalScreen {
  const { status, phase, currentMemberId } = snapshot.auction;
  const frozen = status === "PAUSED";

  if (status === "DRAFT" || status === "READY") {
    return { kind: "NOT_STARTED", frozen: false };
  }
  if (status === "COMPLETED") return { kind: "COMPLETED", frozen: false };

  // ⚠ Il lotto vince sulla fase: durante LOT_REVEAL la fase è di lotto, e
  // anche in WAITING_PICK con un `currentLot` residuo la card resta la verità.
  if (snapshot.currentLot !== null && phase !== "WAITING_PICK") {
    return { kind: "LOT", frozen };
  }
  if (myMemberId !== null && currentMemberId === myMemberId) {
    return { kind: "PICK_MINE", frozen };
  }
  return { kind: "PICK_WAIT", frozen };
}

/**
 * Dove siamo, in due o tre parole: «chiamata portieri», «offerte»,
 * «spareggio», «buste aperte», «in pausa».
 *
 * La stessa frase serve in tre posti — l'intestazione del portale, quella del
 * manager e il cartello grande della TV — ed è per questo che sta qui e non
 * dentro un componente. La pausa vince su tutto: in proiezione è la prima cosa
 * che chi guarda deve poter leggere, prima ancora di sapere quale ruolo è in
 * gioco.
 */
export function phaseLabel(snapshot: Snapshot): string {
  const { status, phase, currentRole } = snapshot.auction;
  if (status === "PAUSED") return "in pausa";
  if (status === "COMPLETED") return "finita";
  if (status === "DRAFT" || status === "READY") return "non iniziata";
  const role =
    currentRole === null ? "" : ` ${ROLE_LABELS[currentRole].toLowerCase()}`;
  switch (phase) {
    case "WAITING_PICK":
      return `chiamata${role}`;
    case "LOT_OPEN":
      return snapshot.currentLot?.roundNo === 2 ? "spareggio" : "offerte";
    case "LOT_TIE_PREP":
      return "spareggio";
    case "LOT_REVEAL":
      return "buste aperte";
    default:
      return "in corso";
  }
}

// ─── Il modale ───────────────────────────────────────────────────────────────

export function amEligible(
  lot: SnapshotLot | null,
  myMemberId: string | null,
): boolean {
  if (lot === null || myMemberId === null) return false;
  return lot.eligibleMemberIds.includes(myMemberId);
}

/**
 * §8bis, alla lettera: il modale si apre da sé quando
 * `phase === 'LOT_OPEN' && sonoIdoneo && dismissedLotId !== currentLot.id`.
 *
 * `dismissedLotId` vive **solo** nello state del componente: non è persistito e
 * non è mai sincronizzato. Chiuderlo non nasconde niente — la card resta e lo
 * riapre — e al lotto successivo si riapre da solo perché l'id è cambiato.
 *
 * In pausa non si apre: il server rifiuterebbe l'offerta, e un modale con un
 * pulsante che non può funzionare è peggio di nessun modale.
 */
export function shouldOpenBidDialog(
  snapshot: Snapshot,
  myMemberId: string | null,
  dismissedLotId: string | null,
): boolean {
  const lot = snapshot.currentLot;
  if (snapshot.auction.status !== "LIVE") return false;
  if (snapshot.auction.phase !== "LOT_OPEN") return false;
  if (lot === null) return false;
  if (!amEligible(lot, myMemberId)) return false;
  return dismissedLotId !== lot.id;
}

// ─── Quanto posso offrire ────────────────────────────────────────────────────

export type BidBounds = {
  /** Il minimo del round: 1 nel round 1, l'importo pareggiato nello spareggio. */
  min: number;
  /** `max_bid` del momento (I5): i crediti meno 1 per ogni slot residuo. */
  max: number;
};

export function bidBounds(
  snapshot: Snapshot,
  myMemberId: string | null,
): BidBounds | null {
  const lot = snapshot.currentLot;
  const me = myMember(snapshot, myMemberId);
  if (lot === null || me === null) return null;
  return { min: lot.minAmount, max: me.maxBid };
}

/**
 * Il messaggio da mostrare **prima** di chiamare il server, o `null` se
 * l'offerta è plausibile. Gli stessi confini che il motore verifica di nuovo.
 */
export function checkAmount(
  amount: number | null,
  bounds: BidBounds | null,
): string | null {
  if (bounds === null) return "Non c'è un lotto aperto.";
  if (amount === null || !Number.isInteger(amount)) {
    return "Scrivi un numero intero di crediti.";
  }
  if (amount < bounds.min) {
    return bounds.min === 1
      ? "L'offerta minima è 1."
      : `Nello spareggio si parte da ${bounds.min}.`;
  }
  if (amount > bounds.max) {
    return `Puoi offrire al massimo ${bounds.max}: il resto serve agli slot che ti mancano.`;
  }
  return null;
}

/** Legge un campo di testo numerico: `null` se non è un intero pulito. */
export function parseAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : null;
}

// ─── Il ritiro ───────────────────────────────────────────────────────────────

/**
 * I tre divieti di `withdrawBid`, nella forma che serve a un pulsante: il
 * chiamante non può ritirare (ha l'auto-bid a 1 e può solo rilanciare), nello
 * spareggio il ritiro non esiste, e non si ritira ciò che non si è offerto.
 * Il ritiro è **definitivo** (⚠ P10): chi si è ritirato non torna a offrire.
 */
export function canWithdraw(
  snapshot: Snapshot,
  myMemberId: string | null,
): boolean {
  const lot = snapshot.currentLot;
  if (snapshot.auction.status !== "LIVE") return false;
  if (snapshot.auction.phase !== "LOT_OPEN") return false;
  if (lot === null || myMemberId === null) return false;
  if (lot.calledByMemberId === myMemberId) return false;
  if (lot.roundNo === 2) return false;
  if (snapshot.myBid === null) return false;
  return snapshot.myBid.withdrawnAt === null;
}

export function haveWithdrawn(snapshot: Snapshot): boolean {
  return snapshot.myBid?.withdrawnAt != null;
}

// ─── Le buste degli altri ────────────────────────────────────────────────────

// Non c'è niente da leggere, e non è una dimenticanza: finché il lotto è
// aperto, delle buste altrui lo snapshot non porta niente da cui derivare
// qualcosa (M1, §1). La funzione che stava qui — `envelopes()` — leggeva un
// campo che non esiste più.

// ─── Lo spareggio ────────────────────────────────────────────────────────────

export function amInTie(
  snapshot: Snapshot,
  myMemberId: string | null,
): boolean {
  const tie = snapshot.currentLot?.tie;
  if (!tie || myMemberId === null) return false;
  return tie.memberIds.includes(myMemberId);
}

// ─── La chiamata ─────────────────────────────────────────────────────────────

/** Gli id già in una rosa, secondo lo snapshot: le assegnazioni annullate non ci sono. */
export function takenPlayerIds(snapshot: Snapshot): Set<string> {
  const taken = new Set<string>();
  for (const member of snapshot.members) {
    for (const entry of member.roster) taken.add(entry.playerId);
  }
  return taken;
}

/**
 * Confronto tollerante agli accenti e alle maiuscole, per la ricerca.
 * Esportata dalla Fase 7: la cerca anche la regia, che ha una sua lista di
 * giocatori assegnabili (`assignablePlayers`) — e due ricerche che rispondono
 * diversamente a «citta» sarebbero una piccola bugia difficile da spiegare.
 */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * I giocatori chiamabili adesso: quelli del ruolo corrente non ancora in una
 * rosa, ordinati come li ordina l'auto-pick (`fvm DESC, quot DESC`) — così il
 * primo della lista è quello che il timer sceglierebbe al posto tuo.
 */
export function availablePlayers(
  pool: PoolPlayer[],
  snapshot: Snapshot,
  role: Role | null,
  query = "",
  /** I filtri di Carmy, solo per chi ha il permesso (M10B §6). */
  carmyFilters: CarmyFilters = NO_CARMY_FILTERS,
): PoolPlayer[] {
  if (role === null) return [];
  const taken = takenPlayerIds(snapshot);
  const needle = fold(query.trim());
  return pool
    .filter(
      (p) =>
        p.role === role &&
        !taken.has(p.id) &&
        (needle === "" ||
          fold(p.name).includes(needle) ||
          fold(p.team).includes(needle)) &&
        matchesCarmy(p, carmyFilters),
    )
    .sort((a, b) => b.fvm - a.fvm || b.quot - a.quot || a.name.localeCompare(b.name));
}

// ─── I filtri di Carmy sulla lista di chiamata (M10B §6) ─────────────────────

/**
 * Fascia, titolarità minima, tag.
 *
 * ⚠ **Sono una lente sulla lista, non una modifica del motore.** L'auto-pick pesca
 * dal pool intero dentro `machine.ts`, ordinando per `fvm DESC, quot DESC`, e di
 * Carmy non sa niente — né deve saperne. Le conseguenze di questa asimmetria sono
 * il vincolo più importante della macro, e stanno su `autoPickCandidate` qui sotto.
 */
export type CarmyFilters = {
  /** `null` = tutte le fasce. */
  fascia: string | null;
  /** `null` = nessun minimo. Altrimenti 1–5. */
  titolaritaMin: number | null;
  /** `null` = tutti. Uno per volta, come nel Centro dati. */
  tag: string | null;
};

export const NO_CARMY_FILTERS: CarmyFilters = {
  fascia: null,
  titolaritaMin: null,
  tag: null,
};

/** Se un filtro di Carmy è acceso: serve a decidere se avvisare, in un posto solo. */
export function hasCarmyFilters(filters: CarmyFilters): boolean {
  return (
    filters.fascia !== null ||
    filters.titolaritaMin !== null ||
    filters.tag !== null
  );
}

function matchesCarmy(player: PoolPlayer, filters: CarmyFilters): boolean {
  if (!hasCarmyFilters(filters)) return true;
  const carmy = player.carmy;
  // ⚠ Chi non ha un giudizio **esce** quando un filtro è acceso, e vale anche per
  // chi non ha il permesso — a cui la chiave non arriva affatto. Un filtro acceso è
  // una domanda, e «non lo so» non è una risposta affermativa. È la stessa regola
  // del filtro «solo chi batte» nel Centro dati.
  if (!carmy) return false;
  if (filters.fascia !== null && carmy.fascia !== filters.fascia) return false;
  if (
    filters.titolaritaMin !== null &&
    (carmy.titolarita === null || carmy.titolarita < filters.titolaritaMin)
  ) {
    return false;
  }
  if (filters.tag !== null && !carmy.tags.includes(filters.tag)) return false;
  return true;
}

/**
 * ⚠ **Chi comprerebbe l'auto-pick allo scadere del timer**, e questo è il vincolo
 * più facile da rompere di tutta M10B (§6).
 *
 * La lista di chiamata è ordinata `fvm DESC, quot DESC`, che **non è cosmetica**: è
 * l'ordine esatto dell'auto-pick, e per questo il primo nome della lista è sempre
 * stato «quello che il timer sceglierebbe al posto tuo». Un filtro di Carmy cambia
 * **quali righe si vedono**, ma non cambia di una virgola chi l'auto-pick sceglie:
 * quello pesca dal pool intero. Con un filtro acceso il primo nome della lista
 * **non è più** quello che verrebbe comprato allo scadere, e chi ha imparato a
 * fidarsi di quella riga si ritroverebbe comprato qualcun altro.
 *
 * ⚠ **Va risolto nell'interfaccia e in modo esplicito, non con un commento nel
 * codice.** Questa funzione risponde alla domanda «chi prenderebbe il timer?»
 * indipendentemente dai filtri: è la lista **non filtrata**, e il chiamante lo
 * scrive in una riga sopra l'elenco, sempre, filtro o no.
 *
 * `null` solo quando non c'è nessun giocatore libero di quel ruolo, cioè quando
 * l'auto-pick non avrebbe niente da comprare.
 */
export function autoPickCandidate(
  pool: PoolPlayer[],
  snapshot: Snapshot,
  role: Role | null,
): PoolPlayer | null {
  // Nessun filtro, nessuna ricerca: è **esattamente** l'ordine del motore.
  return availablePlayers(pool, snapshot, role)[0] ?? null;
}
