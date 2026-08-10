import type { BotStrategy, Role } from "@/lib/domain";
import type { Snapshot } from "@/lib/realtime/types";

import type { Millis } from "./types";

/**
 * Cosa fa un bot, e quando (M4).
 *
 * **Modulo puro: nessun database, nessun `Date.now()`, nessun import che tocchi
 * il mondo.** Il tempo è un parametro per la stessa ragione della regola 2 — è
 * ciò che rende il comportamento collaudabile con Vitest senza Postgres, e
 * riproducibile due volte di fila.
 *
 * ## Cosa vede un bot
 *
 * Uno `Snapshot`, cioè l'uscita di `serializeSnapshot` costruita con il
 * `memberId` **del bot**: le buste altrui non ci sono. Non è una gentilezza, è
 * I8: un bot che vedesse `AuctionState` grezzo saprebbe l'offerta dell'umano e
 * potrebbe batterla sempre di uno. La firma di questa funzione è la garanzia —
 * non accetta nient'altro, quindi non c'è niente da ricordarsi.
 *
 * ## Perché non c'è nessuna memoria
 *
 * Un bot non tiene traccia di «ho già offerto in questo round»: glielo dice lo
 * snapshot (`myBid`). E il ritardo con cui agisce dentro un round non è una
 * variabile: si **deriva** da chi è, su quale lotto e in quale round. Stessa
 * situazione, stesso ritardo — anche dopo un riavvio del processo, che
 * azzererebbe qualunque memoria. Il tick può quindi chiamare `decide` ogni
 * secondo senza sapere niente di ciò che è successo al giro prima.
 */

export type BotMove =
  | { type: "PICK"; playerId: string }
  | { type: "BID"; amount: number };

/**
 * Il listone ridotto a ciò che serve per chiamare: id e ruolo.
 *
 * È volutamente **strutturale e minimo**, non `PoolPlayer` né `Player` del
 * motore: i due chiamanti hanno in mano due cose diverse — il tick ha
 * `state.players`, lo script HTTP ha le righe che si è letto all'avvio — e
 * pretendere un tipo preciso costringerebbe uno dei due a rimappare per niente.
 * I fuori lista li filtra chi chiama, che è l'unico a sapere se questa asta li
 * ammette (⚠ P7).
 */
export type BotPoolPlayer = { id: string; role: Role };

/**
 * Un hash deterministico (FNV-1a a 32 bit) ridotto a una frazione in `[0, 1)`.
 *
 * Serve dove lo script dei bot usava `Math.random()`: qui la casualità
 * apparente deve essere una funzione degli argomenti, o il modulo non sarebbe
 * puro e i test diventerebbero intermittenti — che è il modo peggiore di
 * fallire, perché un rosso che va e viene si finisce per ignorare.
 */
export function fraction(...parts: string[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 1) {
      h ^= part.charCodeAt(i);
      // `Math.imul` perché la moltiplicazione normale perde i bit alti.
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x2f; // separatore fra le parti: "ab"+"c" e "a"+"bc" non collidono
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x100000000;
}

/**
 * Quanto aspetta un bot prima di agire, in millisecondi dall'inizio della fase.
 *
 * Sta **sotto i due terzi** della finestra: un bot che decidesse sul filo
 * verrebbe rifiutato dal server per round chiuso, e l'asta simulata sembrerebbe
 * rotta invece che lenta. E non parte da zero perché un bot che offre
 * nell'istante in cui il lotto si apre trasforma l'asta in una lista di
 * risultati — mentre il senso di tutto questo è poterla guardare mentre si
 * offre dal telefono.
 */
export function delayWithin(windowMs: number, ...parts: string[]): Millis {
  return Math.round(windowMs * (0.1 + fraction(...parts) * 0.55));
}

/** La cifra su cui convergono i bot `tie`: uguale per tutti, quindi pareggio. */
const TIE_AMOUNT = 10;

/** L'importo che questo bot metterebbe nella busta, o `null` se sta fuori. */
export function amountFor(
  strategy: BotStrategy,
  minAmount: number,
  cap: number,
  ...parts: string[]
): number | null {
  if (cap < minAmount) return null;
  switch (strategy) {
    case "passive":
      return minAmount;
    case "aggressive":
      return cap;
    // Tutti sulla stessa cifra: è l'unico modo di innescare uno spareggio a
    // comando, che a mano è quasi impossibile riprodurre.
    case "tie":
      return Math.min(cap, Math.max(minAmount, TIE_AMOUNT));
    case "random": {
      // Il quadrato della frazione tiene la coda corta verso l'alto: importi
      // verosimili, con ogni tanto un rilancio serio.
      const spread = Math.min(cap - minAmount, 20);
      const f = fraction(...parts);
      return minAmount + Math.floor(f * f * (spread + 1));
    }
  }
}

/**
 * La mossa di questo bot **adesso**, o `null` per «non ancora» / «niente da
 * fare». Chiamarla di continuo è previsto: è idempotente rispetto allo stato,
 * perché ogni «ho già fatto» si rilegge dallo snapshot.
 */
export function decide(
  snapshot: Snapshot,
  memberId: string,
  strategy: BotStrategy,
  pool: BotPoolPlayer[],
  now: Millis,
): BotMove | null {
  // In pausa i bot stanno fermi come tutti: la pausa congela la fase, e il
  // server rifiuterebbe comunque (regola 6).
  if (snapshot.auction.status !== "LIVE") return null;

  const me = snapshot.members.find((m) => m.id === memberId);
  if (!me) return null;

  if (snapshot.auction.phase === "WAITING_PICK") {
    return decidePick(snapshot, memberId, pool, now);
  }
  if (snapshot.auction.phase === "LOT_OPEN") {
    return decideBid(snapshot, memberId, strategy, me.maxBid, now);
  }
  // LOT_TIE_PREP e LOT_REVEAL scorrono da soli: non c'è niente da fare.
  return null;
}

function decidePick(
  snapshot: Snapshot,
  memberId: string,
  pool: BotPoolPlayer[],
  now: Millis,
): BotMove | null {
  if (snapshot.auction.currentMemberId !== memberId) return null;

  const deadline = snapshot.auction.phaseDeadline;
  const role = snapshot.auction.currentRole;
  if (deadline === null || role === null) return null;

  // L'inizio della fase non è nello snapshot: si ricava dalla scadenza meno la
  // durata configurata. È esatto perché è così che il motore l'ha calcolata.
  const endsAt = Date.parse(deadline);
  const windowMs = snapshot.auction.timers.pickSeconds * 1000;
  const startedAt = endsAt - windowMs;
  if (now < startedAt + delayWithin(windowMs, memberId, deadline)) return null;

  // I presi si ricavano dalle rose, che lo snapshot contiene: non serve nessuna
  // informazione in più di quelle che ha il portale di un partecipante (I10).
  const taken = new Set(
    snapshot.members.flatMap((m) => m.roster.map((r) => r.playerId)),
  );
  const free = pool.filter((p) => p.role === role && !taken.has(p.id));
  if (free.length === 0) return null; // ci penserà l'auto-pick del motore

  const index = Math.floor(fraction(memberId, deadline) * free.length);
  return { type: "PICK", playerId: free[index].id };
}

function decideBid(
  snapshot: Snapshot,
  memberId: string,
  strategy: BotStrategy,
  cap: number,
  now: Millis,
): BotMove | null {
  const lot = snapshot.currentLot;
  if (lot === null || lot.closedAt !== null) return null;
  if (!lot.eligibleMemberIds.includes(memberId)) return null;

  // Un ritiro è definitivo: chi si è ritirato non torna a offrire.
  if (snapshot.myBid?.withdrawnAt != null) return null;

  const key = [memberId, lot.id, String(lot.roundNo)];
  const amount = amountFor(strategy, lot.minAmount, cap, ...key);
  if (amount === null) return null;

  // **Qui sta il «una volta per round», senza memoria**: se la busta dentro è
  // già quella che questo bot vorrebbe mettere, non c'è niente da fare. Nel
  // round 2 la stessa riga permette il rilancio, perché `min_amount` è salito e
  // l'importo calcolato cambia.
  if (snapshot.myBid?.amount === amount) return null;

  const endsAt = Date.parse(lot.endsAt);
  const windowMs = snapshot.auction.timers.bidSeconds * 1000;
  const startedAt = endsAt - windowMs;
  if (now < startedAt + delayWithin(windowMs, ...key)) return null;

  return { type: "BID", amount };
}
