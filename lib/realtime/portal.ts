import { ROLES, ROLE_LABELS, type AuctionStatus, type Role } from "@/lib/domain";

import type {
  PoolPlayer,
  Presence,
  Snapshot,
  SnapshotLot,
  SnapshotMember,
  SnapshotRevealBid,
} from "./types";

/**
 * Il portale del partecipante, nella parte che si può provare senza un browser.
 *
 * La regola 7 dice che ogni schermata è funzione pura dello snapshot corrente
 * (invariante I10): se è vero, allora *quale* schermata mostrare e *quanto* si
 * può offrire sono funzioni pure — e si collaudano in millisecondi, come il
 * motore. È il motivo per cui stanno qui e non dentro i componenti: i test
 * girano in ambiente `node`, senza DOM.
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
 * `LOT` copre LOT_OPEN, LOT_SEALED, LOT_TIE_PREP e LOT_REVEAL: finché
 * `currentLot != null` la card del lotto è l'elemento permanente della pagina, e
 * sono le sue parti interne a cambiare.
 *
 * ⚠ **Il cancello dei risultati (M14) rientra in `LOT` senza che nessuno abbia
 * aggiunto una riga**, e vale la pena saperlo: questa funzione decide su
 * `currentLot !== null && phase !== "WAITING_PICK"`, non su un elenco di fasi. È il
 * settimo caso di rientro di §8bis — chi ricarica la pagina durante il cancello
 * trova il cancello, non i risultati e non la card viva — e il test lo dimostra
 * invece di darlo per scontato: una proprietà che vale per costruzione va comunque
 * appesa a un'asserzione, o la prossima modifica la toglie in silenzio.
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
 * La frase serve fuori da un componente perché la vogliono in più posti, e la
 * pausa vince su tutto: dove questa riga è **l'unica** che parla della fase, «in
 * pausa» è la prima cosa da leggere, prima ancora di sapere quale ruolo è in
 * gioco.
 *
 * ⚠ Oggi il chiamante è uno solo, l'intestazione della regia: la TV l'aveva e ha
 * smesso — la sua intestazione dice nome e stato e niente altro — e la card di
 * stato del portale usa `phaseLabelIgnoringPause` per la ragione scritta lì
 * sotto. Resta separata da quella e non ci si fonde: la precedenza della pausa è
 * la differenza fra le due, non un dettaglio del suo unico chiamante.
 */
export function phaseLabel(snapshot: Snapshot): string {
  const { status } = snapshot.auction;
  if (status === "PAUSED") return "in pausa";
  if (status === "COMPLETED") return "finita";
  if (status === "DRAFT" || status === "READY") return "non iniziata";
  return phaseLabelIgnoringPause(snapshot);
}

/**
 * La stessa frase di `phaseLabel`, **senza la precedenza della pausa**: dice a
 * che punto del lotto siamo anche mentre l'asta è ferma.
 *
 * ⚠ **Non è una seconda copia delle frasi, ed è per questo che `phaseLabel` la
 * chiama** invece di ripetere lo `switch`: «offerte», «spareggio», «buste da
 * aprire» esistono in un posto solo, e chi ne cambia una le cambia per tutti i
 * chiamanti — la regia e il portale.
 *
 * Serve alla **card di stato** del portale (M17 §5), che ha il badge dello stato
 * dell'asta e la riga della fase uno accanto all'altro. Con `phaseLabel` in
 * pausa direbbero la stessa parola due volte — badge «in pausa», fase «in pausa»
 * — e una card che si ripete si legge come una card rotta. Così invece dice
 * **entrambe le cose**: in pausa, *durante un round di offerte*, che è
 * precisamente ciò che significa «la pausa congela la fase, non la azzera».
 *
 * Fuori da `LIVE`/`PAUSED` non ha niente da dire — `phase` è `null` — e chi
 * chiama non deve renderizzare la riga: lo stato lo dice già il badge.
 */
export function phaseLabelIgnoringPause(snapshot: Snapshot): string {
  const { phase, currentRole } = snapshot.auction;
  const role =
    currentRole === null ? "" : ` ${ROLE_LABELS[currentRole].toLowerCase()}`;
  switch (phase) {
    case "WAITING_PICK":
      return `chiamata${role}`;
    case "LOT_OPEN":
      return snapshot.currentLot?.roundNo === 2 ? "spareggio" : "offerte";
    // ⚠ «buste da aprire» sta accanto a «buste aperte» di proposito: le due frasi si
    // leggono in fila e dicono cose diverse in tre parole, che è il requisito di
    // questa funzione. Il default qui sotto avrebbe scritto «in corso» senza che
    // niente lo segnalasse — su un cartello proiettato in mezzo alla stanza, nel
    // momento in cui la cosa da capire è precisamente che le buste non sono aperte.
    case "LOT_SEALED":
      return "buste da aprire";
    case "LOT_TIE_PREP":
      return "spareggio";
    case "LOT_REVEAL":
      return "buste aperte";
    default:
      return "in corso";
  }
}

/**
 * Lo stato dell'asta in due parole, per il badge della card di stato (M17 §5).
 *
 * È una funzione dello **stato** e non dello snapshot intero di proposito: qui
 * non c'è niente da dedurre dalla fase o dal lotto, e prendere lo snapshot
 * inviterebbe a metterci dentro condizioni che appartengono a `phaseLabel`.
 *
 * `DRAFT` e `READY` dicono la stessa cosa a chi gioca — «non è ancora
 * cominciata» — e la differenza fra le due (listone importato o no) è una
 * faccenda di chi prepara l'asta, che la vede nella configurazione.
 */
export function statusLabel(status: AuctionStatus): string {
  switch (status) {
    case "DRAFT":
    case "READY":
      return "non iniziata";
    case "LIVE":
      return "in corso";
    case "PAUSED":
      return "in pausa";
    case "COMPLETED":
      return "conclusa";
  }
}

// ─── La scena, il tono, il tempo (M17 §6 e §7) ───────────────────────────────

/**
 * **Le nove scene della colonna 3**, che non sono le cinque schermate di
 * `portalScreen` e non sono le cinque fasi della macchina.
 *
 * ⚠ **La scena non è la fase, e il conto non torna se lo si dà per scontato**:
 * `LOT_OPEN` con `roundNo = 2` è lo *spareggio*, cioè una scena diversa dalla
 * stessa fase con `roundNo = 1`. È l'unico punto in cui questa mappa non è una
 * corrispondenza uno a uno, ed è il motivo per cui esiste come funzione invece
 * di come `switch` dentro un componente.
 *
 * Perché nove e non sei come i contenitori di prima: fino a v1.16.0 due card ne
 * coprivano più d'una con un `if` interno — `LotCard` faceva offerte, spareggio
 * in preparazione e spareggio, `LotClosedCard` cancello ed esito. Dopo M17 le
 * scene sono nove e la cornice è **una**: cambia il corpo, non il contenitore, e
 * chi decide quale corpo è questa funzione.
 */
export type Scene =
  | "NOT_STARTED"
  | "COMPLETED"
  /** Sta chiamando qualcun altro. */
  | "PICK_WAIT"
  /** Tocca a me chiamare. */
  | "PICK_MINE"
  /** `LOT_OPEN` al round 1. */
  | "OFFERS"
  /** `LOT_TIE_PREP`: lo spareggio sta per riaprirsi. */
  | "TIE_PREP"
  /** `LOT_OPEN` al round 2: lo spareggio è aperto. */
  | "TIE_OPEN"
  /** `LOT_SEALED`: il cancello dei risultati (M14). */
  | "SEALED"
  /** `LOT_REVEAL`: le buste sono aperte. */
  | "REVEAL";

/**
 * Costruita **sopra `portalScreen`** e non accanto: chi decide se siamo in un
 * lotto, in attesa o fuori dall'asta resta uno, e questa funzione si limita ad
 * aprire il caso `LOT` nelle sue cinque scene. Due funzioni che decidessero
 * entrambe «siamo in un lotto?» divergerebbero il giorno in cui una fase nuova
 * entra nella macchina — che è successo con `LOT_SEALED` e succederà ancora.
 */
export function sceneOf(snapshot: Snapshot, myMemberId: string | null): Scene {
  const screen = portalScreen(snapshot, myMemberId);
  switch (screen.kind) {
    case "NOT_STARTED":
      return "NOT_STARTED";
    case "COMPLETED":
      return "COMPLETED";
    case "PICK_MINE":
      return "PICK_MINE";
    case "PICK_WAIT":
      return "PICK_WAIT";
    case "LOT":
      switch (snapshot.auction.phase) {
        case "LOT_TIE_PREP":
          return "TIE_PREP";
        case "LOT_SEALED":
          return "SEALED";
        case "LOT_REVEAL":
          return "REVEAL";
        default:
          // ⚠ Qui e in nessun altro posto: il round decide la scena.
          return snapshot.currentLot?.roundNo === 2 ? "TIE_OPEN" : "OFFERS";
      }
  }
}

/**
 * **La fascia da 4px in testa alla card**, cioè la sola cosa della colonna 3 che
 * si percepisce senza leggere.
 *
 * I toni sono sette per nove scene, e le due coincidenze sono volute: «non
 * iniziata», «conclusa» e «sta chiamando un altro» sono grigie perché sono le
 * tre scene in cui **non c'è niente da fare** — e la terza è la più frequente
 * della serata, undici turni su dodici. Vuol dire che per la maggior parte del
 * tempo la striscia è grigia e il colore parla solo quando qualcosa riguarda me,
 * che è precisamente il messaggio voluto (decisione dell'owner, 2026-08-22).
 *
 * ⚠ **La pausa vince su tutte**, e non è una scelta nuova: `phaseLabel` applica
 * già la stessa precedenza per la stessa ragione. Una fascia che dicesse «round
 * di offerte» mentre le offerte sono sospese direbbe una cosa falsa nel momento
 * in cui qualcuno sta cercando di capire perché il suo pulsante non funziona.
 */
export type SceneTone =
  /** Grigio: niente da fare. */
  | "NEUTRAL"
  /** Nero pieno: tocca a me. */
  | "MINE"
  /** Verde: si offre. */
  | "OPEN"
  /** Ambra: spareggio, in preparazione o aperto. */
  | "TIE"
  /** Ambra scuro: le buste sono chiuse e nessuno sa niente. */
  | "SEALED"
  /** Verde pieno: è deciso. */
  | "DONE"
  /** Ambra a righe: l'asta è ferma. */
  | "PAUSED";

export function toneOf(scene: Scene, status: AuctionStatus): SceneTone {
  if (status === "PAUSED") return "PAUSED";
  switch (scene) {
    case "NOT_STARTED":
    case "COMPLETED":
    case "PICK_WAIT":
      return "NEUTRAL";
    case "PICK_MINE":
      return "MINE";
    case "OFFERS":
      return "OPEN";
    case "TIE_PREP":
    case "TIE_OPEN":
      return "TIE";
    case "SEALED":
      return "SEALED";
    case "REVEAL":
      return "DONE";
  }
}

/** L'etichetta in alto a sinistra della card di scena, sempre in quel posto. */
export function sceneLabel(scene: Scene): string {
  switch (scene) {
    case "NOT_STARTED":
      return "In attesa";
    case "COMPLETED":
      return "La tua asta";
    case "PICK_WAIT":
      return "Sta chiamando";
    case "PICK_MINE":
      return "Tocca a te";
    case "OFFERS":
      return "Offerte aperte";
    case "TIE_PREP":
      return "Spareggio fra poco";
    case "TIE_OPEN":
      return "Spareggio aperto";
    case "SEALED":
      return "Buste consegnate";
    case "REVEAL":
      return "Lotto assegnato";
  }
}

/**
 * **La banda del tempo in fondo alla card**: cosa scade, quando, su quanto, e se
 * la scadenza è mia.
 *
 * `null` nelle due scene che non hanno una scadenza — ad asta non iniziata e ad
 * asta conclusa non c'è niente che scorre, e una banda con un `—` al posto della
 * cifra fa sembrare la card rotta.
 *
 * ⚠ **`pressing` è la risposta alla domanda «dove il rosso ha senso»** (decisione
 * dell'owner, 2026-08-22), e vale la pena leggerla per quello che è: con il
 * colore acceso in tutte le scene la banda diventa rossa anche in «esito», «buste
 * da aprire» e «sta chiamando un altro», cioè a **ogni lotto** — duecento volte
 * in una serata a 8 con 25 slot. Un rosso che non chiede mai niente si impara a
 * ignorare, e poi non funziona più nelle tre in cui vuol dire «muoviti». Qui è
 * `true` solo dove c'è una scadenza **mia** da mancare, e altrove la banda resta
 * grigia: il tempo si legge, non grida.
 *
 * ⚠ Le offerte leggono `lot.endsAt` e non `phaseDeadline`: sono la stessa cosa
 * finché il round è aperto, ma `endsAt` è la scadenza del **round** e sopravvive
 * a un cambio di fase arrivato un tick prima dello snapshot. È la scelta che
 * `LotCard` faceva già.
 */
export type SceneTime = {
  /** «si chiude fra», «scegli entro», «risultati fra»… */
  label: string;
  deadline: string | null;
  /** Il totale su cui la misura è una frazione. */
  totalSeconds: number;
  /** Se il tempo va colorato: c'è una scadenza mia da mancare. */
  pressing: boolean;
};

export function sceneTime(scene: Scene, snapshot: Snapshot): SceneTime | null {
  const { phaseDeadline, timers } = snapshot.auction;
  const lotEnd = snapshot.currentLot?.endsAt ?? phaseDeadline;
  switch (scene) {
    case "NOT_STARTED":
    case "COMPLETED":
      return null;
    case "PICK_WAIT":
      return {
        label: "scade fra",
        deadline: phaseDeadline,
        totalSeconds: timers.pickSeconds,
        pressing: false,
      };
    case "PICK_MINE":
      return {
        label: "scegli entro",
        deadline: phaseDeadline,
        totalSeconds: timers.pickSeconds,
        pressing: true,
      };
    case "OFFERS":
    case "TIE_OPEN":
      return {
        label: "si chiude fra",
        deadline: lotEnd,
        totalSeconds: timers.bidSeconds,
        pressing: true,
      };
    case "TIE_PREP":
      return {
        label: "si riapre fra",
        deadline: phaseDeadline,
        totalSeconds: timers.tiePrepSeconds,
        pressing: false,
      };
    case "SEALED":
      return {
        label: "risultati fra",
        deadline: phaseDeadline,
        totalSeconds: timers.resultGateSeconds,
        pressing: false,
      };
    case "REVEAL":
      return {
        label: "prossimo turno fra",
        deadline: phaseDeadline,
        totalSeconds: timers.revealSeconds,
        pressing: false,
      };
  }
}

/**
 * Il tono del tempo, dalle **tre soglie che c'erano già** in `CountdownBar`:
 * sopra il 50% verde, sopra il 20% ambra, sotto rosso. Non è una regola nuova,
 * è quella di v1.0.0 spostata dove la possono leggere in due — la banda della
 * card di scena e la barra dentro i due pannelli.
 *
 * `CALM` è il tono di chi non ha una scadenza sua: grigio, la misura si vede e
 * non chiama. Vale ovunque `sceneTime().pressing` sia falso, e in pausa.
 */
export type TimeTone = "CALM" | "OK" | "WARN" | "HOT";

export function timeTone(ratio: number | null, pressing: boolean): TimeTone {
  if (!pressing || ratio === null) return "CALM";
  if (ratio > 0.5) return "OK";
  if (ratio > 0.2) return "WARN";
  return "HOT";
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

// ─── Il pannello di chiamata (M17 §4) ────────────────────────────────────────

/**
 * **La chiave con cui «ho chiuso il pannello» viene ricordata**: la scadenza
 * della fase.
 *
 * ⚠ **Non `currentMemberId` e non `currentRole`**, ed è l'errore che questa
 * funzione esiste per non far fare: dentro un ruolo lo stesso posto chiama più
 * volte — otto difensori vogliono otto turni dello stesso membro sullo stesso
 * ruolo — quindi quella coppia si ripete e il pannello resterebbe chiuso per
 * **tutte** le chiamate successive di quella persona. Chi lo chiude una volta lo
 * chiuderebbe per la serata.
 *
 * `phaseDeadline` invece è nuova a ogni turno, perché ogni `WAITING_PICK` apre la
 * sua finestra. Ed è il gemello di `dismissedLotId` per il modale d'offerta: là
 * l'id del lotto cambia al lotto successivo, qui la scadenza cambia al turno
 * successivo, e in entrambi i casi lo stato locale diventa irrilevante da sé
 * senza che nessuno lo ripulisca.
 *
 * ⚠ **La conseguenza da conoscere è che una pausa riapre il pannello**: al resume
 * le scadenze sono traslate, quindi la chiave non combacia più. Sembra giusto —
 * la pausa finisce e la domanda ti viene rifatta — e l'owner l'ha accettata
 * sapendolo (2026-08-22), ma è nella lista di verifica: se guardandola non
 * convince, si cambia la chiave, non si accetta il comportamento.
 */
export function turnKey(snapshot: Snapshot): string | null {
  return snapshot.auction.phaseDeadline;
}

/**
 * **Gemella di `shouldOpenBidDialog`**, e volutamente della stessa forma: il
 * pannello di chiamata è il secondo modale dell'app che si apre da sé, e vale per
 * lui §8bis alla lettera.
 *
 * Si apre in funzione dello snapshot, chiuderlo non nasconde niente — la card
 * «Tocca a te» porta il tempo che resta e il pulsante che lo riapre — e chi
 * ricarica la pagina a metà turno ritrova esattamente la stessa schermata di chi
 * non si è mai mosso (I10).
 *
 * **Si chiude da sé quando non tocca più a me**, perché ho scelto o perché è
 * scaduto e ha scelto l'auto-pick. E non è il pannello a chiudersi: è questa
 * condizione a diventare falsa quando arriva lo snapshot successivo — regola 1 e
 * regola 7 nello stesso punto. È anche ciò che fa apparire il modale d'offerta
 * subito dopo senza che nessuno coordini le due cose.
 *
 * In pausa non si apre: il server rifiuterebbe la chiamata, e un pannello con
 * quaranta pulsanti che non possono funzionare è peggio di nessun pannello.
 */
export function shouldOpenPickSheet(
  snapshot: Snapshot,
  myMemberId: string | null,
  dismissedTurnKey: string | null,
): boolean {
  const { status, phase, currentMemberId } = snapshot.auction;
  if (status !== "LIVE") return false;
  if (phase !== "WAITING_PICK") return false;
  if (myMemberId === null || currentMemberId !== myMemberId) return false;
  return dismissedTurnKey !== turnKey(snapshot);
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

// Non c'è, e da M16 non c'è più da nessuna parte: chi offre tiene, e al massimo
// rilancia. Qui stavano `canWithdraw` — i tre divieti di `withdrawBid` nella
// forma che serviva a un pulsante — e `haveWithdrawn`. Sono sparite insieme
// all'evento del motore, non solo al pulsante: una regola del gioco che vive
// soltanto nel browser è precisamente ciò che la regola 6 vieta.
//
// ⚠ `myBid.withdrawnAt` **continua a viaggiare nello snapshot** e continua a
// essere letto — dal reveal, dal log dei lotti, dal tabellone — perché le aste
// già giocate hanno dei ritiri dentro e vanno raccontate per quello che sono.
// Su ogni offerta nuova è `null` e resterà `null`.

// ─── Le buste degli altri ────────────────────────────────────────────────────

// Non c'è niente da leggere, e non è una dimenticanza: finché il lotto è
// aperto, delle buste altrui lo snapshot non porta niente da cui derivare
// qualcosa (M1, §1). La funzione che stava qui — `envelopes()` — leggeva un
// campo che non esiste più.

// ─── La presence come la legge la TV (M16) ───────────────────────────────────

/**
 * Tre stati di presence in due colori: **verde chi è collegato, rosso chi non
 * lo è**, e `IDLE` conta come collegato.
 *
 * La ragione è la domanda che si fa chi guarda il tabellone — «possiamo far
 * partire il round?» — e un tab in secondo piano non è una persona che se n'è
 * andata: è qualcuno che ha il telefono in tasca ed è nella stanza. Nel portale
 * la distinzione fra `LIVE` e `IDLE` serve e `PresenceDot` la mostra in ambra;
 * a tre metri da un televisore no.
 *
 * ⚠ **L'ambra sarebbe stata sbagliata proprio lì**, ed è l'unico punto dell'app
 * in cui vale: in TV l'ambra è già la pausa e già la riconnessione, e un terzo
 * significato sullo stesso colore, letto da lontano, non si distingue da nessuno
 * degli altri due.
 *
 * Sta qui, in un posto solo e come funzione pura, per la stessa ragione per cui
 * ci sta `portalScreen`: la mappa da tre stati a due è una regola, e una regola
 * si collauda in millisecondi invece che accendendo dodici telefoni.
 */
export function tvConnected(presence: Presence): boolean {
  return presence !== "OFFLINE";
}

// ─── Le buste aperte: il «+3s» accanto a ogni cifra ──────────────────────────

/**
 * Queste tre funzioni sono **il dato del reveal**, e stanno qui perché lo
 * leggono in due posti: il pannello del portale (`RevealBids`) e la colonna della
 * TV. Prima vivevano dentro il pannello, che era giusto finché il chiamante era
 * uno (regola 8); adesso che gli schermi sono due, una copia per schermo
 * significherebbe che una sera la stessa busta è `+3s` sul telefono e `+4s` sul
 * proiettore, e in quella stanza sarebbe una discussione, non un dettaglio.
 *
 * ⚠ **Il conto parte dalla prima busta del round, non dall'apertura del round.**
 * È il punto che sorprende chi legge «+3s» come «tre secondi dopo il via», e la
 * scelta ha due ragioni. La prima è che questo numero serve a **leggere uno
 * spareggio**: a parità di importo vince `MIN(amount_set_at)`, quindi ciò che
 * conta è l'ordine fra le buste, e prendere la prima come zero lo rende leggibile
 * senza sottrazioni a mente. La seconda è che l'apertura del round non è un
 * istante affidabile a posteriori: nello snapshot c'è `endsAt`, e una pausa in
 * mezzo al round lo **trasla** — un «+3s» contato da lì cambierebbe da solo dopo
 * una pausa, cioè il numero mentirebbe proprio nelle sere in cui qualcosa è
 * andato storto.
 */
export function revealBaseMs(bids: readonly SnapshotRevealBid[]): number {
  // `Math.min()` di un elenco vuoto è `Infinity`, e va bene così: un round senza
  // buste non arriva al reveal, e se ci arrivasse ogni etichetta direbbe «+0s»
  // invece di far esplodere la colonna che la stanza sta guardando.
  return Math.min(...bids.map((bid) => Date.parse(bid.amountSetAt)));
}

/** Quanto dopo la prima busta è stata fissata questa, in secondi: `+0s`, `+3s`. */
export function bidOffsetLabel(amountSetAt: string, baseMs: number): string {
  const delta = Math.round((Date.parse(amountSetAt) - baseMs) / 1000);
  return delta <= 0 ? "+0s" : `+${delta}s`;
}

/**
 * L'ordine in cui si leggono le buste di un round: **importo più alto in cima**,
 * e a pari importo **chi c'è arrivato prima**.
 *
 * ⚠ Il secondo criterio non è un vezzo, ed è diventato obbligatorio nel momento
 * in cui i secondi sono comparsi anche in TV: due buste da 40 mostrate in ordine
 * arbitrario, con accanto scritto `+2s` e `+5s`, si leggono come una classifica
 * sbagliata — e nello spareggio quella è esattamente la classifica che ha
 * deciso. È la stessa regola del motore (`MIN(amount_set_at)`), riscritta qui per
 * l'occhio invece che per il verdetto.
 */
export function compareRevealBids(
  a: SnapshotRevealBid,
  b: SnapshotRevealBid,
): number {
  return (
    b.amount - a.amount || Date.parse(a.amountSetAt) - Date.parse(b.amountSetAt)
  );
}

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

// ─── La quota di budget per reparto (M18) ────────────────────────────────────

/**
 * Quanto del budget a disposizione è finito in ogni reparto, in percentuale
 * intera. `null` per un ruolo quando il budget è 0 — non si divide per zero e
 * non si scrive `NaN%` in faccia a nessuno.
 *
 * **Il denominatore è il budget, non la spesa fatta** (decisione dell'owner del
 * 2026-08-22): «se spendo 250 su 500 sui portieri, ho investito il 50%». La
 * quota sulla spesa sarebbe volatile e insegnerebbe poco — al primo acquisto il
 * reparto starebbe al 100% — mentre questa è confrontabile con la ripartizione
 * che uno si è prefissato prima di sedersi, cioè è il numero su cui si decide se
 * fermarsi. Conseguenza voluta: **le quattro percentuali non fanno 100**, e ciò
 * che manca sono i crediti ancora in cassa, che è a sua volta un'informazione.
 *
 * Il budget iniziale non viaggia nello snapshot e non serve: `crediti + speso`
 * lo ricostruisce, ed è la stessa identità con cui si controlla a vista che i
 * conti tornino (I3) — la stessa che sta nel commento di `spentCredits`.
 *
 * ⚠ **Le rettifiche di budget (I3) entrano nel denominatore**, perché `credits`
 * include già `Σ ledger.delta`: il denominatore è il budget **corrente**, non
 * quello di partenza. Dopo una rettifica le quattro quote si spostano tutte, ed
 * è la lettura giusta di «crediti a disposizione» — è cambiato il totale su cui
 * si sta ragionando.
 *
 * Sta qui e non in un componente per la stessa ragione di `bidBounds` e
 * `sceneTime`: è una formula, e una formula si collauda in millisecondi senza
 * DOM. Il totale se lo calcola da sé invece di chiamare `spentCredits`, che vive
 * in `manage.ts` con un chiamante già contento: spostarlo sarebbe un refactor
 * che nessuno ha chiesto (regola 8).
 */
export function quotaPerRuolo(
  member: SnapshotMember,
): Record<Role, number | null> {
  const speso: Record<Role, number> = { P: 0, D: 0, C: 0, A: 0 };
  for (const entry of member.roster) speso[entry.role] += entry.price;

  const budget =
    member.credits + ROLES.reduce((somma, role) => somma + speso[role], 0);

  // Impossibile in pratica — `budgetInitial` è positivo e I3 tiene i crediti ≥
  // slot residui — quindi la guardia non è una precauzione contro la realtà: è
  // contro il `NaN%` che comparirebbe in un test o in un'asta manipolata a mano
  // dalla regia.
  const quota = (parziale: number) =>
    budget === 0 ? null : Math.round((100 * parziale) / budget);

  return {
    P: quota(speso.P),
    D: quota(speso.D),
    C: quota(speso.C),
    A: quota(speso.A),
  };
}
