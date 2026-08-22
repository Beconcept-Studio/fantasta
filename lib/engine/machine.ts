import { type Result, fail, ok } from "./errors";
import {
  autoPick,
  eligibleMemberIds,
  maxBid,
  nextRole,
  nextSeat,
  ownedByRole,
  resolveRound,
} from "./rules";
import type {
  AuctionEvent,
  AuctionState,
  Lot,
  LotRound,
  Millis,
} from "./types";

/**
 * La macchina a stati dell'asta (PLAN §4), come funzione pura:
 * `transition(state, event, now)` restituisce il nuovo stato o un rifiuto
 * tipizzato. Niente database, niente `Date.now()`: il tempo arriva da fuori,
 * e chi chiama (le action di Fase 3) decide cosa farne del risultato.
 *
 * Due convenzioni che il resto del sistema sfrutta:
 *
 * - **Un no-op restituisce lo stesso riferimento** (`ok(state)`). È così che
 *   I7 (idempotenza) diventa osservabile e che Fase 3 saprà distinguere "la
 *   mutazione ha avuto effetto" (bump di `state_version` e broadcast) da "non
 *   è successo niente" (⚠ P14).
 * - **I rifiuti previsti sono `Result`, i bug sono eccezioni.** Un pick fuori
 *   turno è un rifiuto; un round senza offerte attive è un'invariante rotta e
 *   deve esplodere, non diventare un messaggio gentile.
 */

export function transition(
  state: AuctionState,
  event: AuctionEvent,
  now: Millis,
): Result<AuctionState> {
  switch (event.type) {
    case "START":
      return start(state, event.startSeatIndex, now);
    case "PICK":
      return pick(state, event.memberId, event.playerId, now);
    case "PLACE_BID":
      return placeBid(state, event.memberId, event.amount, now);
    case "ADVANCE":
      return advance(state, now);
    case "SKIP_REVEAL":
      return skipReveal(state, now);
    case "SHOW_RESULTS":
      return showResults(state, now);
    case "CANCEL_LOT":
      // ⚠ Senza `now`, ed è l'unica: vedi la firma di `cancelLot`.
      return cancelLot(state);
    case "PAUSE":
      return pause(state, now);
    case "RESUME":
      return resume(state, now);
  }
}

// ─── START ───────────────────────────────────────────────────────────────────

/**
 * `READY → LIVE` (PLAN §4): il primo elemento di `role_order` **è** il ruolo
 * iniziale — all'avvio si sceglie solo il seat di partenza. Il gate presence
 * ("tutti i membri LIVE") è un fatto di heartbeat, non di macchina a stati:
 * lo aggiunge F4-06 nell'action.
 */
function start(
  state: AuctionState,
  startSeatIndex: number,
  now: Millis,
): Result<AuctionState> {
  if (state.status !== "READY") {
    return fail("WRONG_STATUS", "Si avvia solo un'asta pronta (READY).");
  }
  const seatExists = state.members.some((m) => m.seatIndex === startSeatIndex);
  if (!seatExists) {
    return fail("INVALID_SEAT", `Nessun membro al seat ${startSeatIndex}.`);
  }
  return ok({
    ...state,
    status: "LIVE",
    phase: "WAITING_PICK",
    currentRole: state.config.roleOrder[0],
    currentSeatIndex: startSeatIndex,
    phaseDeadline: now + state.config.pickSeconds * 1000,
  });
}

// ─── Accessori ───────────────────────────────────────────────────────────────

function openLotOf(state: AuctionState): Lot {
  const lot = state.lots.find((l) => l.id === state.currentLotId);
  if (!lot || lot.status !== "OPEN") {
    throw new Error("fase di lotto senza un lotto OPEN: invariante I1 rotta");
  }
  return lot;
}

function currentRoundOf(lot: Lot): LotRound {
  const round = lot.rounds[lot.rounds.length - 1];
  if (!round || round.roundNo !== lot.currentRound) {
    throw new Error("lotto senza il round corrente");
  }
  return round;
}

/** Rimpiazza il lotto corrente (per id) in una copia dello stato. */
function withLot(state: AuctionState, lot: Lot): AuctionState {
  return {
    ...state,
    lots: state.lots.map((l) => (l.id === lot.id ? lot : l)),
  };
}

function withCurrentRound(lot: Lot, round: LotRound): Lot {
  return {
    ...lot,
    rounds: lot.rounds.map((r) => (r.roundNo === round.roundNo ? round : r)),
  };
}

// ─── PICK ────────────────────────────────────────────────────────────────────

function pick(
  state: AuctionState,
  memberId: string,
  playerId: string,
  now: Millis,
): Result<AuctionState> {
  if (state.status !== "LIVE") {
    return fail("WRONG_STATUS", "L'asta non è in corso.");
  }
  if (state.phase !== "WAITING_PICK") {
    return fail("WRONG_PHASE", "Non è il momento di chiamare un giocatore.");
  }
  const member = state.members.find((m) => m.id === memberId);
  if (!member) {
    return fail("MEMBER_NOT_FOUND", "Membro sconosciuto per questa asta.");
  }
  if (member.seatIndex !== state.currentSeatIndex) {
    return fail("NOT_YOUR_TURN", "Non è il tuo turno di chiamata.");
  }
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    return fail("PLAYER_NOT_FOUND", "Giocatore non presente nel listone.");
  }
  if (player.role !== state.currentRole) {
    return fail(
      "WRONG_ROLE",
      `In questo momento si chiamano i ${state.currentRole}, non i ${player.role}.`,
    );
  }
  const assigned = state.assignments.some(
    (a) => a.playerId === playerId && a.voidedAt === null,
  );
  if (assigned) {
    return fail("PLAYER_ASSIGNED", "Il giocatore è già in una rosa.");
  }
  // §12.19 applicata al chiamante. Nella rotazione normale questo caso non
  // esiste — `nextSeat` dà il turno solo a chi ha uno slot libero — ma una
  // `manualAssign` di Fase 7 può riempire il ruolo di chi sta già aspettando
  // di chiamare. Senza questa guardia il lotto si aprirebbe con il chiamante
  // **fuori** da `round_eligibility` e la sua auto-offerta a 1 dentro il
  // round: se nessun altro rilancia, la vince lui e si ritrova un giocatore
  // oltre gli slot del ruolo, cioè I4 rotta senza che nessuno abbia forzato
  // niente. Il turno non si perde: lo salta `advanceWaitingPick`.
  if (
    ownedByRole(state, memberId)[player.role] >= state.config.slots[player.role]
  ) {
    return fail(
      "NOT_ELIGIBLE",
      `Hai già tutti i ${player.role} previsti: questo turno di chiamata passa al prossimo.`,
    );
  }
  if (player.outOfList && !state.config.includeOutOfList) {
    return fail(
      "PLAYER_OUT_OF_LIST",
      "Il giocatore è fuori lista e il pool di quest'asta li esclude.",
    );
  }
  return ok(openLot(state, playerId, memberId, false, now));
}

/**
 * L'apertura di un lotto (PLAN §4, `WAITING_PICK → LOT_OPEN`): round 1 con
 * `min_amount = 1`, eligibility calcolata adesso, e **l'auto-bid a 1 del
 * chiamante** — che da qui in poi è vincolato: può solo rilanciare.
 *
 * Caso speciale (DECISIONS 2026-08-06, test §12.41): se l'unico idoneo è il
 * chiamante, l'esito è già scritto — niente countdown, il lotto passa dritto
 * a LOT_REVEAL assegnato a 1. A fine ruolo questi lotti possono essere molti
 * di fila, e trenta secondi ciascuno sarebbero minuti persi in diretta.
 *
 * ⚠ **E non passa nemmeno dal cancello dei risultati** (M14 §2, ultimo capoverso):
 * `enterReveal` è chiamata qui, diritta, qualunque sia `resultGateSeconds`. Non è
 * una dimenticanza — è che **non c'è nessuna busta da proteggere**: l'unica offerta
 * in campo è l'auto-bid a 1 del chiamante, e «prezzo 1» è già implicito nel fatto
 * che nessun altro potesse offrire. Metterci il cancello vorrebbe dire pagare X
 * secondi per lotto, molti di fila a fine ruolo, per un esito che nessuno può
 * contestare: cioè disfare esattamente l'ottimizzazione che questo commento
 * descrive. La conseguenza va accettata sapendola — in questi lotti i risultati
 * compaiono subito, come prima di M14.
 */
function openLot(
  state: AuctionState,
  playerId: string,
  calledByMemberId: string,
  autoCalled: boolean,
  now: Millis,
): AuctionState {
  const role = state.currentRole!;
  const eligible = eligibleMemberIds(state, role);
  const soleEligible = eligible.length === 1 && eligible[0] === calledByMemberId;
  const endsAt = soleEligible ? now : now + state.config.bidSeconds * 1000;
  const lotId = state.nextId;
  const bidId = state.nextId + 1;
  const lot: Lot = {
    id: lotId,
    seq: state.lots.length + 1,
    playerId,
    calledByMemberId,
    autoCalled,
    status: "OPEN",
    currentRound: 1,
    winnerMemberId: null,
    finalPrice: null,
    openedAt: now,
    resolvedAt: null,
    rounds: [
      {
        roundNo: 1,
        minAmount: 1,
        startsAt: now,
        endsAt,
        closedAt: soleEligible ? now : null,
        eligibleMemberIds: eligible,
        bids: [
          {
            id: bidId,
            memberId: calledByMemberId,
            amount: 1,
            amountSetAt: now,
            createdAt: now,
            withdrawnAt: null,
          },
        ],
      },
    ],
  };
  const opened: AuctionState = {
    ...state,
    phase: "LOT_OPEN",
    phaseDeadline: endsAt,
    currentLotId: lotId,
    lots: [...state.lots, lot],
    nextId: state.nextId + 2,
  };
  if (soleEligible) {
    return enterReveal(opened, lot, calledByMemberId, 1, now);
  }
  return opened;
}

// ─── Offerte ─────────────────────────────────────────────────────────────────

function placeBid(
  state: AuctionState,
  memberId: string,
  amount: number,
  now: Millis,
): Result<AuctionState> {
  if (state.status !== "LIVE") {
    return fail("WRONG_STATUS", "L'asta non è in corso.");
  }
  if (state.phase !== "LOT_OPEN") {
    return fail("WRONG_PHASE", "Non c'è un round di offerte aperto.");
  }
  const lot = openLotOf(state);
  const round = currentRoundOf(lot);
  if (now > round.endsAt) {
    return fail("ROUND_CLOSED", "Il round è chiuso: offerta arrivata tardi.");
  }
  if (!round.eligibleMemberIds.includes(memberId)) {
    return fail("NOT_ELIGIBLE", "Non sei fra gli idonei di questo round.");
  }
  // ⚠ Qui stava la guardia `existing?.withdrawnAt != null`, che rifiutava un
  // rilancio su un'offerta ritirata. Da M16 non c'è più nessuno scrittore di
  // `withdrawnAt`, quindi quella condizione non può più diventare vera: era
  // diventata una guardia irraggiungibile, cioè una guardia che nessun test
  // può più difendere.
  const existing = round.bids.find((b) => b.memberId === memberId);
  if (!Number.isInteger(amount)) {
    return fail("INVALID_AMOUNT", "L'offerta deve essere un numero intero.");
  }
  if (amount < round.minAmount) {
    return fail(
      "BID_TOO_LOW",
      `L'offerta minima di questo round è ${round.minAmount}.`,
    );
  }
  const cap = maxBid(state, memberId);
  if (amount > cap) {
    return fail(
      "BID_TOO_HIGH",
      `Puoi offrire al massimo ${cap}: il resto dei crediti serve agli slot rimanenti.`,
    );
  }
  // ⚠ P3 — confermare la stessa cifra è un no-op: il timestamp resta quello
  // del primo submit, e nel round 2 è la posizione in coda che conta.
  if (existing && existing.amount === amount) {
    return ok(state);
  }
  const bids = existing
    ? round.bids.map((b) =>
        b.memberId === memberId ? { ...b, amount, amountSetAt: now } : b,
      )
    : [
        ...round.bids,
        {
          id: state.nextId,
          memberId,
          amount,
          amountSetAt: now,
          createdAt: now,
          withdrawnAt: null,
        },
      ];
  const next = withLot(state, withCurrentRound(lot, { ...round, bids }));
  return ok(existing ? next : { ...next, nextId: state.nextId + 1 });
}

// ─── Il ritiro, che non c'è più ──────────────────────────────────────────────

// Qui stava `withdrawBid`, con i suoi tre divieti — il chiamante non ritira, lo
// spareggio non ammette ritiri, non si ritira ciò che non si è offerto — e
// l'unica scrittura di `withdrawnAt` che sia mai esistita. Da M16 la regola del
// gioco è più semplice di tutti e tre messi insieme: **chi offre tiene, e al
// massimo rilancia.**
//
// ⚠ È sparita da qui e non solo dal modale, ed è il punto della macro. Se la
// rotta avesse continuato ad accettare un `WITHDRAW`, la nuova regola sarebbe
// vissuta soltanto nel codice del browser — cioè esattamente ciò che la regola
// 6 vieta. Fra amici il rischio pratico di un `POST` costruito a mano è nullo;
// il rischio vero è che fra sei mesi nessuno sappia più se il ritiro c'è o no.
//
// Le offerte continuano a portarsi dietro `withdrawnAt`, sempre `null` sulle
// nuove: vedi il commento sul campo in `types.ts`.

// ─── ADVANCE — l'unico evento del tempo ──────────────────────────────────────

/**
 * La transizione temporale, **guardata** (I7): se la deadline non è arrivata,
 * o non c'è niente da far avanzare, restituisce lo stesso stato. I timer e lo
 * sweep di Fase 3 possono chiamarla quante volte vogliono.
 */
function advance(state: AuctionState, now: Millis): Result<AuctionState> {
  if (state.status !== "LIVE") return ok(state);
  if (state.phase === null || state.phaseDeadline === null) return ok(state);
  if (now < state.phaseDeadline) return ok(state);

  switch (state.phase) {
    case "WAITING_PICK":
      return ok(advanceWaitingPick(state, now));
    case "LOT_OPEN":
      return ok(advanceLotOpen(state, now));
    case "LOT_SEALED":
      return ok(resolveClosedRound(state, openLotOf(state), now));
    case "LOT_TIE_PREP":
      return ok(advanceTiePrep(state, now));
    case "LOT_REVEAL":
      return ok(advanceReveal(state, now));
  }
}

/**
 * Fine del reveal (PLAN §4, `LOT_REVEAL → WAITING_PICK | COMPLETED`): si
 * avanza il turno. Ruolo pieno per tutti → prossimo ruolo di `role_order`
 * (saltando quelli già pieni, ⚠ P9); nessun ruolo residuo → COMPLETED.
 * Il seat successivo è il prossimo in ordine circolare con uno slot libero,
 * indipendente da chi ha vinto.
 */
function advanceReveal(state: AuctionState, now: Millis): AuctionState {
  return nextTurn(state, now);
}

/**
 * «Prosegui asta»: la regia chiude il reveal prima della sua scadenza.
 *
 * È l'**unico** evento che fa avanzare una fase senza che il tempo sia
 * passato, e per questo sta qui e non dentro `advance`: la guardia
 * `now < phaseDeadline` esiste perché timer e sweep possano chiamare `ADVANCE`
 * quante volte vogliono senza combinare guai (I7), e allentarla per fare
 * spazio a un pulsante l'avrebbe resa inutile per tutti e due i chiamanti.
 *
 * L'effetto è `nextTurn`, cioè **la stessa identica funzione** che gira alla
 * scadenza: non esiste una seconda strada per passare il turno, e quindi non
 * c'è niente da tenere allineato. Cambia solo *quando*, e la deadline della
 * fase successiva nasce dall'istante in cui si è premuto.
 *
 * Idempotenza (I7): dopo il primo salto la fase non è più `LOT_REVEAL`, quindi
 * il secondo click trova questa guardia e viene rifiutato senza effetti. In
 * pausa lo stato è `PAUSED`, non `LIVE`: la pausa congela la fase, e da lì si
 * riparte con RESUME, non saltando.
 *
 * Chi può premere non si decide qui: il motore non sa chi possiede l'asta.
 * La verifica di proprietà sta in `skipReveal` di `actions.ts`, come per
 * PAUSE e RESUME.
 */
function skipReveal(state: AuctionState, now: Millis): Result<AuctionState> {
  if (state.status !== "LIVE" || state.phase !== "LOT_REVEAL") {
    return fail(
      "WRONG_PHASE",
      "Si prosegue solo mentre le buste sono aperte.",
    );
  }
  return ok(nextTurn(state, now));
}

/**
 * Il passaggio del turno: ruolo pieno per tutti → prossimo ruolo di
 * `role_order` (saltando quelli già pieni, ⚠ P9), nessun ruolo residuo →
 * COMPLETED, altrimenti il prossimo seat in ordine circolare con uno slot
 * libero.
 *
 * Ha due chiamanti — la fine del reveal e il pick timer scaduto su un membro
 * che non può più chiamare — e il secondo è arrivato con la Fase 7: prima
 * questa logica stava tutta dentro `advanceReveal`.
 */
function nextTurn(state: AuctionState, now: Millis): AuctionState {
  const base = { ...state, currentLotId: null };
  let role = state.currentRole!;
  const roleFull = state.members.every(
    (m) => ownedByRole(state, m.id)[role] >= state.config.slots[role],
  );
  if (roleFull) {
    const next = nextRole(state, role);
    if (next === null) {
      return {
        ...base,
        status: "COMPLETED",
        phase: null,
        currentRole: null,
        currentSeatIndex: null,
        phaseDeadline: null,
      };
    }
    role = next;
  }
  const seat = nextSeat(state, role, state.currentSeatIndex!);
  if (seat === null) {
    throw new Error(`nessun seat con slot liberi nel ruolo ${role}`);
  }
  return {
    ...base,
    phase: "WAITING_PICK",
    currentRole: role,
    currentSeatIndex: seat,
    phaseDeadline: now + state.config.pickSeconds * 1000,
  };
}

// ─── Pause / resume ──────────────────────────────────────────────────────────

/**
 * `LIVE ↔ PAUSED` (PLAN §4): la pausa congela la fase, non la azzera. Ripetere
 * la pausa (o il resume) è un no-op — il doppio click dell'owner non deve
 * poter fare danni; fuori da LIVE/PAUSED invece è un errore.
 */
function pause(state: AuctionState, now: Millis): Result<AuctionState> {
  if (state.status === "PAUSED") return ok(state);
  if (state.status !== "LIVE") {
    return fail("WRONG_STATUS", "Si mette in pausa solo un'asta in corso.");
  }
  return ok({ ...state, status: "PAUSED", pausedAt: now });
}

/**
 * Il resume trasla ogni scadenza del tempo passato in pausa: la deadline di
 * fase e, se c'è un round di offerte aperto, anche il suo `ends_at` — è la
 * scadenza contro cui `placeBid` valida. **La pausa non deve mai far scadere
 * silenziosamente un countdown in corso.**
 */
function resume(state: AuctionState, now: Millis): Result<AuctionState> {
  if (state.status === "LIVE") return ok(state);
  if (state.status !== "PAUSED" || state.pausedAt === null) {
    return fail("WRONG_STATUS", "Si riprende solo un'asta in pausa.");
  }
  const shift = now - state.pausedAt;
  let next: AuctionState = {
    ...state,
    status: "LIVE",
    pausedAt: null,
    phaseDeadline:
      state.phaseDeadline === null ? null : state.phaseDeadline + shift,
  };
  if (state.phase === "LOT_OPEN") {
    const lot = openLotOf(state);
    const round = currentRoundOf(lot);
    next = withLot(
      next,
      withCurrentRound(lot, { ...round, endsAt: round.endsAt + shift }),
    );
  }
  return ok(next);
}

/**
 * Timeout del round di offerte (PLAN §4, `LOT_OPEN → …`): il round si **chiude**.
 *
 * ⚠ **Da M14 chiudere non è più risolvere**, e la differenza è tutta la macro. Con
 * un cancello dei risultati configurato si scrive `closed_at` sul round e si entra
 * in `LOT_SEALED`: `resolveRound` **non viene chiamata**. Non è un dettaglio
 * d'ordine — è la differenza fra «l'esito esiste e non lo mostriamo» e «l'esito non
 * esiste ancora», e solo la seconda tiene.
 *
 * Il modo ovvio sarebbe stato risolvere come prima e nascondere `reveal` nello
 * snapshot. **Non funziona, e il buco non è nel pannello delle buste: è nei
 * crediti.** `serializeMembers` calcola `credits`, `maxBid`, `slotsFilled` e
 * `roster` da `state.assignments`, e quei campi stanno in **ogni** snapshot per
 * **tutti**, TV compresa. Misurato il 2026-08-18 su un'asta a 8 con budget 100 e
 * offerta vincente 87, con la fase forzata a `LOT_SEALED` e l'assegnazione già
 * committata: `reveal` e `tie` erano entrambi `null`, e il vincitore passava da 100
 * a 13 crediti, da `maxBid` 97 a 11, da `slotsFilled.P` 0 a 1, con gli altri sette
 * fermi a 100. E `roster` portava `{ name: "Giocatore 1", price: 87 }` — cioè
 * **l'importo esatto della busta vincente**, in un campo che non ha nessun rapporto
 * con `reveal`. Sul proiettore, in tempo reale, prima che chiunque potesse premere
 * un pulsante.
 *
 * ⚠ **Con `resultGateSeconds = 0` la fase non esiste**, e non è «una fase che dura
 * zero secondi». Una fase da zero è uno stato osservabile: un timer armato
 * sull'istante presente, uno snapshot in più per lotto mandato a dodici persone, un
 * `ADVANCE` in ritardo di un tick che fa lampeggiare una schermata di attesa. Il
 * ramo è una `if`, e vale la pena scriverla: le aste che esistevano prima di M14
 * hanno `0` sulla colonna e si comportano **esattamente** come a v1.14.0.
 */
function advanceLotOpen(state: AuctionState, now: Millis): AuctionState {
  const lot = openLotOf(state);
  const round = currentRoundOf(lot);
  const closed = withCurrentRound(lot, { ...round, closedAt: now });

  if (state.config.resultGateSeconds > 0) {
    return {
      ...withLot(state, closed),
      phase: "LOT_SEALED",
      phaseDeadline: now + state.config.resultGateSeconds * 1000,
    };
  }
  return resolveClosedRound(state, closed, now);
}

/**
 * **L'apertura delle buste**: massimo unico → reveal; pareggio nel round 1 →
 * preparazione dello spareggio; pareggio nel round 2 → lo risolve `resolveRound`
 * per `amount_set_at`, quindi comunque reveal.
 *
 * Ha tre chiamanti e fa per tutti e tre la stessa cosa: la chiusura del round senza
 * cancello, la scadenza del cancello, e «Mostra risultati». **Non esiste una seconda
 * strada per decidere chi ha vinto un lotto**, che è lo stesso criterio con cui è
 * stato scritto «Prosegui asta» — e qui vale doppio, perché la funzione che si
 * sposta di un passo è quella che assegna il giocatore.
 *
 * Il lotto arriva come parametro, con il round già chiuso: chi chiama sa se lo ha
 * appena chiuso lui (`advanceLotOpen`) o se lo ha trovato chiuso da prima (le altre
 * due), e questa funzione non ha bisogno di distinguere.
 */
function resolveClosedRound(
  state: AuctionState,
  lot: Lot,
  now: Millis,
): AuctionState {
  const outcome = resolveRound(currentRoundOf(lot));

  if (outcome.kind === "WINNER") {
    return enterReveal(state, lot, outcome.bid.memberId, outcome.bid.amount, now);
  }
  return {
    ...withLot(state, lot),
    phase: "LOT_TIE_PREP",
    phaseDeadline: now + state.config.tiePrepSeconds * 1000,
  };
}

/**
 * «Mostra risultati» (regia): l'owner apre le buste senza aspettare la scadenza del
 * cancello.
 *
 * ⚠ **È il secondo chiamante del pattern di `skipReveal`, e sta qui per la stessa
 * ragione per cui sta qui quello.** La guardia `now < phaseDeadline` dentro `advance`
 * esiste perché timer e sweep possano chiamare `ADVANCE` quante volte vogliono senza
 * combinare guai (I7): allentarla per fare spazio a un pulsante la renderebbe
 * inutile per tutti e due i chiamanti. Quindi «un umano fa avanzare una fase in
 * anticipo» è un evento suo, con la sua guardia, e l'effetto è **la stessa funzione**
 * che gira alla scadenza.
 *
 * Idempotenza (I7): dopo il primo click la fase non è più `LOT_SEALED`, quindi il
 * secondo trova questa guardia e viene rifiutato senza effetti. In pausa lo stato è
 * `PAUSED` e non `LIVE`: da lì si riparte con RESUME, o si annulla il lotto.
 *
 * Chi può premere non si decide qui — il motore non sa chi possiede l'asta: la
 * verifica di proprietà sta in `showResults` di `actions.ts`, come per PAUSE, RESUME
 * e «Prosegui asta».
 */
function showResults(state: AuctionState, now: Millis): Result<AuctionState> {
  if (state.status !== "LIVE" || state.phase !== "LOT_SEALED") {
    return fail(
      "WRONG_PHASE",
      "Si mostrano i risultati solo mentre le buste sono ancora chiuse.",
    );
  }
  return ok(resolveClosedRound(state, openLotOf(state), now));
}

/**
 * «Annulla lotto» (M14 §6): il lotto muore senza essere mai stato risolto, e il turno
 * torna a chi aveva chiamato.
 *
 * **Solo a asta in pausa, e solo dentro il cancello.** Che sia solo in pausa non è
 * soltanto la lettera della richiesta: è anche la guardia giusta, perché annullare un
 * lotto mentre il suo countdown corre sarebbe una corsa con il proprio timer — a asta
 * in pausa i timer sono fermi per definizione.
 *
 * **Cosa cambia, e cosa no.** Il lotto prende `status: "VOIDED"`; `winnerMemberId`,
 * `finalPrice` e `resolvedAt` restano `null`, perché non è mai stato risolto e
 * scrivere `resolved_at` significherebbe dire il contrario — *quando* è stato
 * annullato lo dice la riga di `events`, che è il posto dove stanno i fatti
 * dell'asta. Offerte e round **restano**: sono il verbale di ciò che è accaduto, ed è
 * ciò che rende l'annullamento verificabile domani. Semplicemente non diventano mai
 * pubbliche.
 *
 * ⚠ **Nessuna assegnazione viene toccata, e non c'è nulla da toccare** — è la
 * conseguenza migliore del mettere il cancello *prima* della risoluzione. Nel
 * cancello l'assegnazione **non esiste ancora**: nessun `voided_at` da scrivere,
 * nessuna riga compensativa da inventare, nessun credito da rimettere a posto. La
 * regola 5 non viene sfiorata, e nel modo ovvio l'avrebbe sfiorata davvero. Il
 * giocatore torna disponibile **da sé**, perché la disponibilità è derivata dalle
 * assegnazioni non annullate — `takenPlayerIds`, `autoPick` e il controllo dentro
 * `pick` guardano tutti la stessa cosa. Ciò che non si scrive non si può scrivere
 * male.
 *
 * ⚠ **Il turno va indietro, ed è l'unico posto dell'applicazione in cui succede.**
 * La regola operativa di `CLAUDE.md` — «la rotazione dei turni non torna mai
 * indietro» — resta vera in tutti gli altri casi, e qui regge per tre condizioni,
 * tutte e tre necessarie:
 *
 * 1. **quel lotto non ha creato nessuna assegnazione**, quindi il ritorno indietro
 *    non deve tenere conto di niente;
 * 2. **la rotazione non è ancora avanzata**: `nextTurn` gira all'uscita dal reveal,
 *    che qui non è mai arrivata;
 * 3. **il ruolo del chiamante non può essersi riempito nel frattempo**. Il chiamante
 *    aveva uno slot libero quando ha chiamato (`pick` lo verifica, ⚠ §12.19),
 *    nessun altro lotto può esistere (I1), e l'unica cosa che riempie un ruolo fuori
 *    da un lotto è `manualAssign` — che durante `LOT_SEALED` è **rifiutata**
 *    (`lib/engine/override.ts`). La terza condizione è vera *perché* quel rifiuto
 *    c'è: se qualcuno un giorno togliesse `LOT_SEALED` da quell'elenco, romperebbe
 *    questa funzione da un altro file.
 *
 * Con le tre condizioni in piedi il caso «il chiamante non può più chiamare» **non
 * esiste**, quindi lo si asserisce invece di gestirlo: i rifiuti previsti sono
 * `Result`, i bug sono eccezioni. Il precedente letterale è il `throw` di `nextTurn`.
 *
 * ⚠ **È l'unica transizione della macchina che non prende `now`**, e vale la pena
 * saperlo perché dice una cosa vera sul disegno: l'asta è **ferma**, quindi non c'è
 * nessun «adesso» che conti. Ogni istante che questa funzione scrive è ancorato a
 * `pausedAt` (vedi il commento sulla scadenza qui sotto), il lotto annullato non
 * prende nessun timestamp — `resolvedAt` resta `null` perché non è mai stato risolto
 * — e *quando* è stato annullato lo dice la riga di `events`, che nasce fuori dal
 * motore. Prendere un `now` per non usarlo sarebbe stato un parametro che finge.
 */
function cancelLot(state: AuctionState): Result<AuctionState> {
  if (state.status !== "PAUSED" || state.phase !== "LOT_SEALED") {
    return fail(
      "WRONG_PHASE",
      "Un lotto si annulla solo ad asta in pausa, mentre le buste sono ancora chiuse.",
    );
  }
  const lot = openLotOf(state);
  const caller = state.members.find((m) => m.id === lot.calledByMemberId);
  if (!caller) throw new Error("lotto chiamato da un membro sconosciuto");
  if (state.pausedAt === null) {
    throw new Error("asta in pausa senza `pausedAt`: invariante rotta");
  }

  // Il ruolo non cambia: è il ruolo del giocatore chiamato, per costruzione.
  const role = state.currentRole!;
  if (ownedByRole(state, caller.id)[role] >= state.config.slots[role]) {
    throw new Error(
      `il chiamante del lotto annullato non ha slot liberi nel ruolo ${role}`,
    );
  }

  // ⚠ **La scadenza parte da `pausedAt`, non da `now`**, e la spec dice `now`.
  // Il motivo è che l'asta è ferma: `resume` trasla ogni scadenza di quanto è durata
  // la pausa, quindi un `now + pickSeconds` scritto qui verrebbe traslato **una
  // seconda volta** e chi deve richiamare si troverebbe più tempo di `pickSeconds`.
  // Peggio, si vedrebbe subito: durante la pausa il client disegna
  // `pausedRemaining(deadline, pausedAt)`, che con `now` mostrerebbe
  // «pickSeconds + quanto si è già stati in pausa» — un 30s configurato che a schermo
  // dice 80. Ancorando a `pausedAt` il conto torna in tutti e due i posti: il
  // cartello in pausa dice `pickSeconds`, e alla ripresa il chiamante ha esattamente
  // `pickSeconds` per chiamare.
  const lotVoided: Lot = { ...lot, status: "VOIDED" };
  return ok({
    ...withLot(state, lotVoided),
    currentLotId: null,
    phase: "WAITING_PICK",
    currentSeatIndex: caller.seatIndex,
    phaseDeadline: state.pausedAt + state.config.pickSeconds * 1000,
  });
}

/**
 * Fine della preparazione allo spareggio (PLAN §4, `LOT_TIE_PREP → LOT_OPEN`):
 * round 2 con `min_amount` = importo pareggiato, idonei i soli pareggianti, e
 * il **carry-forward** delle loro offerte con l'`amount_set_at` originale —
 * chi non fa nulla "sta" sulla propria cifra, e nello stallo vince chi c'era
 * arrivato per primo.
 */
function advanceTiePrep(state: AuctionState, now: Millis): AuctionState {
  const lot = openLotOf(state);
  const round1 = currentRoundOf(lot);
  const outcome = resolveRound(round1);
  if (outcome.kind !== "TIE") {
    throw new Error("LOT_TIE_PREP senza un pareggio nel round 1");
  }
  const endsAt = now + state.config.bidSeconds * 1000;
  let nextId = state.nextId;
  const round2: LotRound = {
    roundNo: 2,
    minAmount: outcome.amount,
    startsAt: now,
    endsAt,
    closedAt: null,
    eligibleMemberIds: outcome.bids.map((b) => b.memberId),
    bids: outcome.bids.map((b) => ({
      id: nextId++,
      memberId: b.memberId,
      amount: b.amount,
      amountSetAt: b.amountSetAt, // il timestamp del round 1, preservato
      createdAt: now,
      withdrawnAt: null,
    })),
  };
  const withRound2: Lot = {
    ...lot,
    currentRound: 2,
    rounds: [...lot.rounds, round2],
  };
  return {
    ...withLot(state, withRound2),
    phase: "LOT_OPEN",
    phaseDeadline: endsAt,
    nextId,
  };
}

/**
 * L'ingresso in LOT_REVEAL (PLAN §4): l'assegnazione è **committata qui**,
 * non alla fine del reveal — i secondi di reveal sono presentazionali, e un
 * crash durante il reveal non deve poter perdere un lotto già deciso.
 */
function enterReveal(
  state: AuctionState,
  lot: Lot,
  winnerMemberId: string,
  price: number,
  now: Millis,
): AuctionState {
  const resolved: Lot = {
    ...lot,
    status: "RESOLVED",
    winnerMemberId,
    finalPrice: price,
    resolvedAt: now,
  };
  return {
    ...withLot(state, resolved),
    phase: "LOT_REVEAL",
    phaseDeadline: now + state.config.revealSeconds * 1000,
    assignments: [
      ...state.assignments,
      {
        id: state.nextId,
        memberId: winnerMemberId,
        playerId: lot.playerId,
        price,
        lotId: lot.id,
        source: "AUCTION",
        createdAt: now,
        voidedAt: null,
      },
    ],
    nextId: state.nextId + 1,
  };
}

/**
 * Timeout del pick → auto-pick (PLAN §4): chiama il miglior disponibile del
 * ruolo, `auto_called = true`, e l'auto-bid a 1 resta a nome del membro di
 * turno — il regolamento non fa sconti a chi si distrae.
 */
function advanceWaitingPick(state: AuctionState, now: Millis): AuctionState {
  const role = state.currentRole!;
  const caller = state.members.find(
    (m) => m.seatIndex === state.currentSeatIndex,
  );
  if (!caller) throw new Error("seat corrente senza membro");

  // Il turno si salta se nel frattempo il ruolo si è riempito: succede solo
  // dopo una `manualAssign` di Fase 7, perché la rotazione normale dà il turno
  // soltanto a chi ha uno slot libero. Aprire comunque il lotto significherebbe
  // un round di cui il chiamante non è nemmeno idoneo — e con lui l'unica
  // offerta in campo (§12.19, I4).
  if (ownedByRole(state, caller.id)[role] >= state.config.slots[role]) {
    return nextTurn(state, now);
  }

  const player = autoPick(state, role);
  if (!player) {
    // ⚠ P20 — pool esaurito dopo l'import: deliberatamente non gestito.
    throw new Error(`auto-pick senza giocatori disponibili nel ruolo ${role}`);
  }
  return openLot(state, player.id, caller.id, true, now);
}
