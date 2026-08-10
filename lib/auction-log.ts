import type { AuctionStatus, Role } from "@/lib/domain";

/**
 * Il vocabolario dello storico di un'asta: i tipi di ciò che la pagina mostra,
 * e la resa in italiano di una riga di `events`.
 *
 * Sta in un file suo e senza nessuna dipendenza per le stesse ragioni di
 * `lib/domain.ts` e `lib/auction-nav.ts`, che sono i suoi gemelli: non importa
 * `lib/db`, quindi lo può leggere anche il client component del campo di
 * ricerca senza portarsi l'ORM nel bundle del telefono. E la resa in italiano,
 * essendo pura, si collauda in millisecondi invece che con un Postgres acceso.
 *
 * ⚠ Lo storico **non è uno snapshot** e non deve diventarlo (regola 3). Questi
 * tipi non hanno niente a che vedere con `Snapshot`, non viaggiano sullo
 * stream, e la pagina che li usa è renderizzata dal server a ogni caricamento:
 * la storia di un'asta non ha nulla da ricevere in tempo reale.
 *
 * ⚠ Di qui non passa **nessuna** busta di un lotto ancora aperto, e il predicato
 * che lo decide — `isPublicLot` — sta qui sotto: `lib/engine/log.ts` lo applica
 * dove i dati si leggono, ma la regola è dichiarata in questo file perché è qui
 * che si può provare da sola. Vedi `docs/features/03-tracciabilita.md` §5.
 */

// ─── I lotti ─────────────────────────────────────────────────────────────────

export type LogBid = {
  teamName: string;
  amount: number;
  /** Quando è stata fissata **questa** cifra: è il campo che decide gli stalli. */
  amountSetAt: string;
  withdrawnAt: string | null;
};

export type LogRound = {
  roundNo: number;
  /** 1 nel round base; l'importo pareggiato nello spareggio (I6). */
  minAmount: number;
  /** Quanti potevano offrire. Il numero, non i nomi: alla disputa serve la misura. */
  eligibleCount: number;
  bids: LogBid[];
  /**
   * L'esito, già in italiano. Lo scrive `resolveRound` di `lib/engine/rules.ts`
   * — la stessa funzione che ha deciso l'asta quella sera. Ricopiare qui quel
   * ragionamento vorrebbe dire tenere due verità su come si vince un lotto.
   */
  outcome: string;
};

export type LogLot = {
  seq: number;
  player: { name: string; role: Role; team: string };
  calledByTeamName: string;
  autoCalled: boolean;
  /** Un lotto risolto ha sempre un vincitore: l'apertura piazza l'auto-bid a 1 del chiamante. */
  winnerTeamName: string;
  price: number;
  resolvedAt: string;
  /**
   * L'assegnazione nata da questo lotto è stata annullata (regola 5). Il lotto
   * **resta** nell'elenco, marcato: lo storico non nasconde le riassegnazioni.
   */
  voided: boolean;
  rounds: LogRound[];
  /** Precalcolato da `lotSearchText`: il client filtra, non ricompone. */
  searchText: string;
};

// ─── Le correzioni e le pause ────────────────────────────────────────────────

export type LogEvent = {
  id: number;
  at: string;
  /** Già in italiano, da `describeEvent`. */
  text: string;
  /** Il nome di chi ha agito; `null` quando è stato il tempo. */
  actorName: string | null;
};

export type AuctionLog = {
  auctionName: string;
  status: AuctionStatus;
  /** L'ora della lettura: in una disputa, l'età di ciò che stai leggendo conta. */
  readAt: string;
  /** Solo i lotti risolti, dal più recente. */
  lots: LogLot[];
  events: LogEvent[];
};

// ─── La barriera I8 ──────────────────────────────────────────────────────────

/**
 * **I8: un lotto le cui buste sono già state pubbliche** (M3 §5).
 *
 * Il confine non è inventato qui: è quello del motore. `enterReveal` in
 * `lib/engine/machine.ts` scrive `status: "RESOLVED"` nell'istante esatto in cui
 * entra in `LOT_REVEAL`, cioè quando le buste si aprono e l'assegnazione viene
 * committata. Quindi **«lotto risolto» ≡ «buste già state pubbliche»**, per
 * costruzione e non per attenzione. Vale anche ad asta in pausa, gratis: la
 * pausa congela la fase e non azzera lo `status` del lotto.
 *
 * Sta in questo modulo puro, e non dentro `lib/engine/log.ts`, per una ragione
 * che è venuta fuori provandolo: qui si può collaudare su un lotto **costruito a
 * mano** che sia `OPEN` *e* abbia un vincitore. Quello stato il motore non lo
 * produce mai — ma è l'unico modo di dimostrare che è questo predicato a
 * escludere il lotto aperto, e non un altro controllo che per caso fa lo stesso
 * lavoro. Un guardiano che non sai se sta guardando non è un guardiano.
 *
 * ⚠ In `lib/engine/log.ts` c'è una **seconda** rete: un lotto senza vincitore o
 * senza prezzo viene comunque scartato. Le due si sovrappongono di proposito, e
 * nessuna delle due va rimossa perché «l'altra basta» — oggi si coprono a
 * vicenda solo perché il motore non genera lo stato che le separerebbe.
 */
export function isPublicLot(lot: { status: string }): boolean {
  return lot.status === "RESOLVED";
}

// ─── Quali eventi entrano ────────────────────────────────────────────────────

/**
 * Gli eventi che il blocco delle correzioni racconta.
 *
 * Fuori restano `PICK`, `PLACE_BID`, `WITHDRAW_BID` e `ADVANCE`: sono la routine
 * di un lotto, e il dettaglio del lotto li racconta meglio di quanto sappia
 * fare il loro payload — dentro `events` un `PLACE_BID` registra *chi* e
 * *quando*, **mai quanto**. Ed è anche ciò che rende la pagina leggibile: un'asta
 * da 12 con 25 slot produce oltre duemila righe, quasi tutte di macchina.
 */
export const NOTABLE_EVENT_TYPES = [
  "START",
  "PAUSE",
  "RESUME",
  "SKIP_REVEAL",
  "MANUAL_ASSIGN",
  "VOID_ASSIGNMENT",
  "ADJUST_BUDGET",
] as const;

const ROUTINE_EVENT_TYPES = new Set([
  "PICK",
  "PLACE_BID",
  "WITHDRAW_BID",
  "ADVANCE",
]);

/**
 * ⚠ Un tipo **sconosciuto è notevole**, e non è una svista: la lista da
 * consultare è quella della routine, non quella dei noti. Un evento che
 * aggiungeremo fra un anno comparirà nello storico senza che nessuno si ricordi
 * di aggiungerlo qui — mentre il contrario (comparire solo se elencato) lo
 * farebbe sparire in silenzio, che in una pagina fatta per le dispute è il
 * difetto peggiore possibile.
 */
export function isNotableEvent(type: string): boolean {
  return !ROUTINE_EVENT_TYPES.has(type);
}

// ─── La resa in italiano ─────────────────────────────────────────────────────

export type LogEventInput = {
  type: string;
  /** Il `payload` jsonb così com'è: di qui non si fida niente. */
  payload: Record<string, unknown> | null;
  /** Il numero del lotto a cui l'evento si riferisce, se il payload ne portava uno. */
  lotSeq: number | null;
};

function text(payload: Record<string, unknown> | null, key: string): string | null {
  const value = payload?.[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function num(payload: Record<string, unknown> | null, key: string): number | null {
  const value = payload?.[key];
  return typeof value === "number" ? value : null;
}

/** «(lotto #180)», o niente se l'evento non riguarda un lotto. */
function ofLot(lotSeq: number | null): string {
  return lotSeq === null ? "" : ` (lotto #${lotSeq})`;
}

/** Il segno sempre esplicito: «+5» e «−12» si leggono, «5» e «-12» si interpretano. */
function signed(delta: number): string {
  return delta < 0 ? `−${Math.abs(delta)}` : `+${delta}`;
}

/**
 * Una riga di `events` come frase italiana.
 *
 * I nomi dei campi sono quelli che `writeEvent` scrive davvero — vedi
 * `recordEvent` in `lib/engine/actions.ts` per le transizioni e
 * `lib/engine/override.ts` per le tre correzioni. Niente qui si fida del
 * payload: è `jsonb`, quindi in lettura è `unknown`, e un campo mancante fa
 * degradare la frase invece di rompere la pagina.
 */
export function describeEvent({ type, payload, lotSeq }: LogEventInput): string {
  const team = text(payload, "team") ?? "una squadra";
  const player = text(payload, "player") ?? "un giocatore";
  const price = num(payload, "price");

  switch (type) {
    case "START":
      return "Asta avviata.";
    case "PAUSE":
      return "Asta messa in pausa.";
    case "RESUME":
      return "Asta ripresa.";
    case "SKIP_REVEAL":
      return `Buste chiuse in anticipo con «Prosegui asta»${ofLot(lotSeq)}.`;
    case "MANUAL_ASSIGN": {
      const forced = payload?.force === true ? ", forzando un vincolo" : "";
      const perPrice = price === null ? "" : ` per ${price} crediti`;
      return `Assegnato a mano: ${player} a ${team}${perPrice}${forced}.`;
    }
    case "VOID_ASSIGNMENT": {
      const perPrice = price === null ? "" : ` per ${price} crediti`;
      return `Annullata: ${player} a ${team}${perPrice}${ofLot(lotSeq)}.`;
    }
    case "ADJUST_BUDGET": {
      const delta = num(payload, "delta");
      const reason = text(payload, "reason");
      const amount = delta === null ? "" : ` ${signed(delta)}`;
      return `Crediti rettificati: ${team}${amount}${reason === null ? "" : ` — ${reason}`}.`;
    }
    default:
      // Il tipo che non conosciamo: si mostra com'è, payload compreso. Meglio
      // una riga tecnica che una riga mancante.
      return `${type} — ${JSON.stringify(payload ?? {})}`;
  }
}

// ─── Gli orari ───────────────────────────────────────────────────────────────

/**
 * Il server gira in UTC, processo compreso: **`Europe/Rome` è solo rendering**,
 * e questo è il punto in cui la conversione avviene per lo storico.
 *
 * Il fuso è fissato qui e non lasciato al browser di chi guarda: le persone che
 * discutono di un lotto sono nella stessa stanza, e devono leggere lo stesso
 * orario — anche se una di loro ha il telefono su un altro fuso. Ed è la stessa
 * ora che l'owner vede sul server nei log di `pm2`, il che rende confrontabili
 * le due cose senza fare aritmetica a mente.
 *
 * `Intl` fa il resto, ora legale compresa: sommare due ore fisse funzionerebbe
 * in agosto e sbaglierebbe a gennaio.
 */
const ROME = "Europe/Rome";

/** «21:04:12» — l'ora di una busta, al secondo, perché è il secondo che decide. */
export function romeTime(iso: string): string {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: ROME,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

/** «10 agosto, 21:04» — per le righe in cui il giorno conta. */
export function romeDateTime(iso: string): string {
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: ROME,
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

// ─── La ricerca ──────────────────────────────────────────────────────────────

/**
 * Il testo su cui il campo di ricerca confronta, tutto minuscolo e calcolato
 * una volta sola dal server.
 *
 * Include il numero di lotto **in due forme**, con il cancelletto e senza: chi
 * cerca il lotto di cui si sta discutendo lo digita come lo vede scritto,
 * `#180`, ma chi arriva da altrove digita `180`.
 */
export function lotSearchText(lot: {
  seq: number;
  player: { name: string; team: string };
  calledByTeamName: string;
  winnerTeamName: string;
}): string {
  return [
    `#${lot.seq}`,
    String(lot.seq),
    lot.player.name,
    lot.player.team,
    lot.calledByTeamName,
    lot.winnerTeamName,
  ]
    .join(" ")
    .toLowerCase();
}
