import { ROLES, type Role, pmaCrediti } from "@/lib/domain";
import type { PoolPlayer, Snapshot } from "@/lib/realtime/types";

/**
 * **Stats+ — il termometro dell'asta in corso** (M22).
 *
 * Funzioni pure che prendono lo snapshot e il pool e restituiscono numeri. Non
 * importano `lib/db`, non conoscono l'utente, non sanno niente del gate: chi le
 * chiama ha già deciso se mostrarle (`canSeeStatsPlus`).
 *
 * ⚠ **L'invariante che regge tutto il file** (§7.3): *tutto ciò che Stats+
 * mostra si calcola da lotti risolti e da stato pubblico. Mai dalle buste in
 * corso.* Non è una precauzione in più — è I8 espresso come proprietà di queste
 * funzioni. Il rischio non è teorico: un giorno qualcuno vorrà «migliorare» la
 * temperatura usando `eligibleMemberIds` o il numero di buste consegnate, e **il
 * numero continuerebbe ad avere la stessa faccia**. Nessuna schermata lo
 * denuncerebbe. `tests/stats-plus.test.ts` lo misura invece di dedurlo, e quel
 * test va letto prima di toccare qualunque cosa qui dentro.
 *
 * ⚠ **E niente stime.** Nessun prezzo consigliato, nessuna banda, nessuna
 * contrazione bayesiana, nessun prior. Le prime due stesure della spec avevano
 * un motore statistico e non è mai stato validato: qui si contano crediti già
 * pagati e si dividono per crediti attesi. Un rapporto fra due cifre pagate è
 * vero o falso, non accurato o inaccurato — ed è il motivo per cui questa macro
 * non ha bisogno di una validazione che non potrebbe avere.
 */

// ─── Le costanti dichiarate, con il loro perché accanto ──────────────────────

/**
 * Sotto questa cifra **in crediti** un lotto non porta informazione (§3.4).
 *
 * ⚠ **È dichiarata, non tarata**, e va detto. Cinque crediti sono la cifra sotto
 * la quale una contesa non c'è: su un giocatore da un credito il prezzo non ha
 * spazio per scostarsi da niente. Serve perché **il 58% del listone vale un
 * credito** (302 righe su 519, misurato il 2026-08-29): senza il filtro, la metà
 * dei punti del termometro sarebbe rumore a 1×.
 *
 * ⚠ **Resta una soglia in crediti anche con un budget diverso**, non in punti di
 * PMA: è il numero di crediti a decidere se una contesa può esistere.
 */
export const SOGLIA_LOTTO_INFORMATIVO = 5;

/**
 * Quanti lotti guarda la finestra «recente»: **uno per partecipante** al tavolo
 * di riferimento (owner, M23).
 *
 * ⚠ **È una costante, non `snapshot.members.length`**, e la differenza va
 * saputa: la ragione del numero è «un giro di tavolo», quindi a un tavolo da
 * dodici la finestra *coerente con quella ragione* sarebbe dodici. Resta fissa
 * perché è la lettura più prudente — un numero che cambia con il tavolo
 * cambierebbe anche l'etichetta a schermo (`PMA Last 8` / `PMA Last 12`) e
 * renderebbe due aste non confrontabili fra loro. Per legarla al tavolo basta
 * passare `snapshot.members.length` come secondo argomento di
 * {@link temperaturaRecente}: il parametro esiste per quello.
 *
 * ⚠ **Sotto questo numero di lotti la finestra non esiste** e vale `null`, non
 * «il ruolo intero»: con sette lotti chiusi «gli ultimi otto» sarebbero il ruolo
 * stesso, cioè lo stesso numero scritto due volte in due badge diversi.
 */
export const FINESTRA_RECENTE = 8;

// ─── I tipi che escono di qui ────────────────────────────────────────────────

/** Un lotto già chiuso, con il suo rapporto fra pagato e atteso. */
export type LottoInformativo = {
  lotSeq: number;
  playerId: string;
  name: string;
  role: Role;
  /** Quanto è stato pagato davvero. */
  price: number;
  /** Il PMA tradotto in crediti su questo budget: il denominatore, e la cifra
   *  che va a schermo accanto al prezzo (§5.1). */
  atteso: number;
  /** `price / atteso`. `1` è «esattamente il PMA». */
  rapporto: number;
};

/**
 * Quanto un insieme di lotti ha pagato rispetto al foglio: **un rapporto fra
 * due somme**, coi suoi addendi accanto.
 *
 * ⚠ **Fra somme, non fra rapporti, e la differenza cambia il segno** (M23). La
 * prima stesura teneva minimo, mediana e massimo dei rapporti lotto per lotto:
 * lì un lotto da 10 crediti pesava quanto uno da 50, e la mediana rispondeva a
 * «com'è andato il lotto tipico» mentre la domanda era «quanti crediti sono
 * usciti dal tavolo». Misurato su due lotti — uno da 50 crediti pagato 25, uno
 * da 10 pagato 20 — la mediana dei rapporti dà **+25%** e il rapporto fra le
 * somme **−25%**: due risposte opposte alla stessa domanda, ed è la seconda
 * quella vera per il budget. `tests/stats-plus.test.ts` tiene quel caso.
 *
 * ⚠ **`pagato` e `atteso` viaggiano col rapporto**, e non sono un dettaglio che
 * la UI può decidere di buttare: sono ciò che rende il numero verificabile, e
 * `n` è ciò che distingue «te lo dico su 4» da «su 40».
 */
export type Temperatura = {
  n: number;
  /** I crediti davvero usciti dal tavolo su questi lotti. */
  pagato: number;
  /** Quanti ne chiedeva il foglio: la somma dei PMA in crediti. */
  atteso: number;
  /** `pagato / atteso`. `1` è «esattamente il PMA». */
  rapporto: number;
};

/** Una riga per ruolo, più la somma di tutte (M23 §2). */
export type TemperaturePerRuolo = {
  perRuolo: Record<Role, Temperatura | null>;
  totale: Temperatura | null;
};

/**
 * Tutte a `null`: quello che i chiamanti passano **quando Stats+ è spento**.
 *
 * ⚠ **Esiste perché il gate sta nel componente padre, non qui.** `portal.tsx` e
 * `bid-modal.tsx` calcolano dentro un `statsPlus ? … : …`, quindi il ramo falso
 * ha bisogno di un valore della forma giusta — e la stessa costante in due file
 * sarebbe due oggetti da tenere allineati a mano il giorno che il tipo cresce.
 */
export const TEMPERATURE_VUOTE: TemperaturePerRuolo = {
  perRuolo: { P: null, D: null, C: null, A: null },
  totale: null,
};

// ─── Aritmetica di base ──────────────────────────────────────────────────────

/**
 * Il rapporto scritto come lo legge un umano (§5.0): `0,75×` diventa `−25`.
 *
 * ⚠ **Un posto solo, e non è pedanteria di fattorizzazione.** È la decisione
 * dell'owner del 2026-08-29 guardando il mock — *«mi servono dei dati anche più
 * immediati»* — e vale perché `0,75×` chiede una moltiplicazione a chi ha
 * ventiquattro secondi di countdown, mentre `−25%` è già la risposta. Se la
 * conversione stesse in tre componenti, il giorno in cui uno arrotonda
 * diversamente ci sarebbero due verità sullo stesso lotto.
 */
export function pct(rapporto: number): number {
  return Math.round((rapporto - 1) * 100);
}

function mediana(valori: number[]): number {
  const ordinati = [...valori].sort((a, b) => a - b);
  const mezzo = Math.floor(ordinati.length / 2);
  return ordinati.length % 2 === 0
    ? (ordinati[mezzo - 1] + ordinati[mezzo]) / 2
    : ordinati[mezzo];
}

/** Il PMA di una riga del pool, `null` se quella riga non ne ha uno. */
function pmaDi(pool: PoolPlayer[], playerId: string): number | null {
  const row = pool.find((x) => x.id === playerId);
  return row?.carmy?.pma ?? null;
}

// ─── §2 — il piano, letto dal foglio ─────────────────────────────────────────

/**
 * Quanta parte del budget ogni ruolo si prende, **secondo il foglio caricato**.
 *
 * ⚠ **Non è una costante nel codice, ed è il punto di §2.** Chi compila il
 * foglio non prevede il prezzo di Bastoni: divide il denaro del tavolo fra i
 * reparti e poi lo spalma sui giocatori. Sul foglio di riferimento la somma di
 * tutti i PMA fa **993%** — dieci rose complete — e si divide 10 / 20 / 30 / 40
 * fra P, D, C e A. Leggendolo dal pool invece di scriverlo qui, **un foglio
 * tarato diversamente porta con sé il proprio piano** e nessuno deve ricordarsi
 * di aggiornare un numero.
 *
 * È anche ciò che rende il rapporto `pagato ÷ PMA` confrontabile fra ruoli: il
 * PMA è già una quota di budget, quindi 0,8× fra i portieri e 0,8× fra i
 * difensori vogliono dire la stessa cosa.
 */
export function pianoPerRuolo(pool: PoolPlayer[]): Record<Role, number> {
  const massa: Record<Role, number> = { P: 0, D: 0, C: 0, A: 0 };
  for (const player of pool) {
    const pma = player.carmy?.pma;
    if (pma === null || pma === undefined) continue;
    massa[player.role] += pma;
  }
  const totale = ROLES.reduce((somma, role) => somma + massa[role], 0);
  // Un pool senza PMA non è una divisione per zero: è un piano a zero, e la UI
  // ha già la sua frase per «serve un listone con i PMA» (§8).
  if (totale === 0) return { P: 0, D: 0, C: 0, A: 0 };
  return {
    P: massa.P / totale,
    D: massa.D / totale,
    C: massa.C / totale,
    A: massa.A / totale,
  };
}

/**
 * Il foglio caricato dice **qualcosa** sui prezzi?
 *
 * ⚠ **Serve a distinguere due stati che si assomigliano e non sono la stessa
 * cosa** (§8): «non c'è ancora nessun lotto informativo» — vero all'inizio di
 * ogni ruolo, e destinato a passare da sé — e «non c'è nessun PMA», che non
 * passa finché qualcuno non carica un listone. Con una frase sola per entrambi,
 * chi è nel secondo caso aspetterebbe per tutta l'asta un numero che non
 * arriverà.
 */
export function haPma(pool: PoolPlayer[]): boolean {
  return pool.some(
    (player) => player.carmy?.pma !== null && player.carmy?.pma !== undefined,
  );
}

// ─── §3.4 — quali lotti parlano ──────────────────────────────────────────────

/** Ogni riga di rosa del tavolo, con il membro che l'ha presa. */
function tutteLeRose(snapshot: Snapshot) {
  return snapshot.members.flatMap((m) =>
    m.roster.map((entry) => ({ memberId: m.id, ...entry })),
  );
}

/**
 * I lotti del ruolo `role` che portano informazione, **in ordine di lotto**.
 *
 * Due condizioni, e nessuna delle due guarda come il lotto è finito:
 *
 * - `lotSeq !== null` — l'assegnazione nasce da un lotto. Un `manualAssign` è
 *   una correzione della regia, non un prezzo di mercato: mediarlo con gli altri
 *   direbbe che il tavolo ha pagato una cifra che nessuno ha offerto.
 * - il PMA del chiamato vale almeno {@link SOGLIA_LOTTO_INFORMATIVO} crediti.
 *
 * ⚠ **Il filtro è sull'ingresso, e qui la spec archiviata va corretta** (§3.4).
 * Quella escludeva i lotti **chiusi al prezzo minimo**, dopo aver misurato che
 * avvelenavano la stima. La diagnosi era giusta e il rimedio è sbagliato:
 * filtrare sul **prezzo pagato** scarta esattamente gli esiti bassi, e la
 * temperatura risulta sistematicamente più calda del vero. È selezione
 * sull'esito. Questa condizione guarda invece una proprietà del **giocatore
 * chiamato**, nota prima che il lotto si apra, quindi non seleziona niente in
 * base a come è andata.
 *
 * ⚠ **Il denominatore è `pmaCrediti`, la stessa funzione della tab Listone e del
 * modale.** Non `pma / 100 × budget` riscritto qui: se le due strade
 * arrotondassero diversamente, lo stesso PMA darebbe due cifre in crediti in due
 * schermate — e quella di `atteso` è **la cifra che va a schermo** accanto al
 * prezzo pagato (§5.1), non solo un numero interno.
 */
export function lottiInformativi(
  snapshot: Snapshot,
  pool: PoolPlayer[],
  budget: number,
  role: Role,
): LottoInformativo[] {
  const lotti: LottoInformativo[] = [];
  for (const entry of tutteLeRose(snapshot)) {
    if (entry.role !== role) continue;
    if (entry.lotSeq === null) continue;
    const pma = pmaDi(pool, entry.playerId);
    if (pma === null) continue;
    const atteso = pmaCrediti(pma, budget);
    if (atteso < SOGLIA_LOTTO_INFORMATIVO) continue;
    lotti.push({
      lotSeq: entry.lotSeq,
      playerId: entry.playerId,
      name: entry.name,
      role: entry.role,
      price: entry.price,
      atteso,
      rapporto: entry.price / atteso,
    });
  }
  // ⚠ **Per `lotSeq`, non per l'ordine in cui le rose lo consegnano**: le rose
  // arrivano un membro alla volta, quindi l'ordine naturale è per proprietario e
  // non per tempo. Lo scatto di §3.3 legge questo ordine e sarebbe arbitrario
  // senza il sort.
  return lotti.sort((a, b) => a.lotSeq - b.lotSeq);
}

// ─── §3.1 — la temperatura del ruolo ─────────────────────────────────────────

/**
 * Il rapporto fra i crediti pagati e i crediti attesi su questi lotti.
 *
 * ⚠ **Niente contrazione bayesiana, niente prior, niente `k`.** La prima stesura
 * della macro le aveva ed erano il punto esatto in cui l'evidenza diventava
 * stima: con pochi dati un termometro contratto dice un numero addolcito che ha
 * la faccia di una misura. Qui con pochi dati il termometro dice **«pochi
 * dati»** — cioè `n`, `pagato` e `atteso` — e lascia la deduzione a chi legge.
 *
 * `null` con nessun lotto informativo, e non uno zero: la UI ha una frase o un
 * `N/A`, non un `0%` che si legge come «in linea col foglio» (§8).
 */
export function temperatura(lotti: LottoInformativo[]): Temperatura | null {
  if (lotti.length === 0) return null;
  const pagato = lotti.reduce((somma, l) => somma + l.price, 0);
  const atteso = lotti.reduce((somma, l) => somma + l.atteso, 0);
  // `atteso` non può essere zero: `lottiInformativi` tiene solo i lotti sopra la
  // soglia in crediti, e la soglia è cinque.
  return { n: lotti.length, pagato, atteso, rapporto: pagato / atteso };
}

/**
 * La temperatura di ogni ruolo e quella di tutta l'asta.
 *
 * ⚠ **Il totale è la somma degli stessi lotti, e questo è un invariante che la
 * mediana non poteva avere** (M23): con due mediane, «il totale» e «la media dei
 * ruoli» sarebbero stati due numeri diversi senza che niente lo dicesse, e
 * starebbero nella stessa tabella a contraddirsi. Qui `totale.pagato` è per
 * costruzione la somma dei `pagato` di ogni ruolo — c'è un test che lo misura,
 * perché è la ragione per cui il totale può stare in fondo alla stessa colonna.
 *
 * ⚠ **Un ruolo non ancora iniziato è `null`, non uno zero.** È la distinzione
 * che la tabella scrive `N/A`: uno `0%` vorrebbe dire «si paga esattamente il
 * PMA», che è un'affermazione, mentre qui non è ancora stato chiuso niente.
 */
export function temperaturaPerRuolo(
  snapshot: Snapshot,
  pool: PoolPlayer[],
  budget: number,
): TemperaturePerRuolo {
  const perRuolo = {} as Record<Role, Temperatura | null>;
  const tutti: LottoInformativo[] = [];
  for (const role of ROLES) {
    const lotti = lottiInformativi(snapshot, pool, budget, role);
    perRuolo[role] = temperatura(lotti);
    tutti.push(...lotti);
  }
  return { perRuolo, totale: temperatura(tutti) };
}

/**
 * La temperatura degli ultimi `finestra` lotti, cioè **come si sta pagando
 * adesso** invece che dall'inizio del ruolo.
 *
 * ⚠ **Prende in ingresso i lotti di un ruolo solo, e non è un caso**: subito
 * dopo un cambio di ruolo, «gli ultimi otto lotti dell'asta» sarebbero ancora
 * del reparto precedente, e il numero direbbe come si pagavano i portieri a chi
 * sta offrendo per un difensore. Chi chiama passa
 * `lottiInformativi(…, ruoloInCorso)`.
 *
 * ⚠ **Sotto `finestra` lotti restituisce `null`**, che a schermo è `N/A`: con
 * sette lotti chiusi la finestra sarebbe il ruolo intero, cioè lo stesso numero
 * mostrato due volte accanto a se stesso.
 *
 * ⚠ **La coda si prende per `lotSeq`**, e vale perché `lottiInformativi` ordina
 * già: le rose arrivano un membro alla volta, quindi l'ordine naturale dell'array
 * è per proprietario e non per tempo. Un `slice(-8)` su quell'ordine
 * restituirebbe otto lotti qualsiasi.
 */
export function temperaturaRecente(
  lotti: LottoInformativo[],
  finestra: number = FINESTRA_RECENTE,
): Temperatura | null {
  if (lotti.length < finestra) return null;
  return temperatura(lotti.slice(-finestra));
}

/**
 * Il PMA di un giocatore in crediti, **corretto per come il tavolo sta
 * pagando**: la cifra che i badge sotto il campo dell'offerta mostrano (M23 §1).
 *
 * ⚠ **In un posto solo, come `pct`.** Ne escono due badge — uno col rapporto del
 * ruolo, uno con quello della finestra recente — e un giorno forse un terzo: se
 * la moltiplicazione stesse nei componenti, il primo che arrotonda diversamente
 * darebbe due cifre per lo stesso giocatore nella stessa schermata.
 *
 * ⚠ **Il pavimento a un credito non è simmetria con `pmaCrediti`: è che zero non
 * è un'offerta valida.** Su un giocatore da un credito atteso e un ruolo che paga
 * il 40% del foglio la moltiplicazione dà `0,4`, che arrotonda a zero — e accanto
 * al campo comparirebbe una cifra che il server rifiuta (regola 6: la UI non
 * propone quello che il server non accetta).
 */
export function pmaAsta(pma: number, budget: number, rapporto: number): number {
  return Math.max(1, Math.round(pmaCrediti(pma, budget) * rapporto));
}

// ─── §4 — le alternative del lotto in corso ──────────────────────────────────

/**
 * Un'alternativa catalogata, coi **fatti che discriminano e nessun punteggio**
 * (§4.3): titolarità, presenze da titolare, tag, PMA in crediti, e se è un
 * obiettivo. In quest'ordine, perché è l'ordine in cui si decide.
 */
export type Alternativa = {
  playerId: string;
  name: string;
  team: string;
  /** 1–5, il giudizio del foglio. */
  titolarita: number;
  /** Dal campo, se la fonte giornaliera ha risposto: `null` altrimenti. */
  startsEleven: number | null;
  presenze: number | null;
  tags: string[];
  fmvExp: number | null;
  /** In punti percentuali, come lo scrive il foglio. */
  pma: number;
  /** Lo stesso PMA in crediti su questo budget: la cifra che va a schermo. */
  atteso: number;
  fasciaRank: number;
  /** Positivo = fascia più bassa del chiamato, cioè più economica. */
  deltaRank: number;
  obiettivo: boolean;
};

export type Alternative = {
  /** Veri sostituti dello slot. */
  pariLivello: Alternativa[];
  /** Puoi permetterti di non salire. */
  costanoMeno: Alternativa[];
  /** Ti riempie lo slot, non te lo risolve. Vive nella tab, non nel modale. */
  ripiego: Alternativa[];
};

/** Il giudizio completo che serve a catalogare: senza, non c'è criterio. */
type Catalogabile = {
  player: PoolPlayer;
  titolarita: number;
  fasciaRank: number;
  pma: number;
};

function catalogabile(player: PoolPlayer): Catalogabile | null {
  const t = player.carmy?.titolarita;
  const pma = player.carmy?.pma;
  const rank = player.fasciaRank;
  if (t === null || t === undefined) return null;
  if (pma === null || pma === undefined) return null;
  if (rank === undefined) return null;
  return { player, titolarita: t, fasciaRank: rank, pma };
}

/** Chi compare in una rosa, in qualunque rosa. */
function presiDaQualcuno(snapshot: Snapshot): Set<string> {
  return new Set(tutteLeRose(snapshot).map((entry) => entry.playerId));
}

/**
 * Chi altro, **ancora libero**, può riempire lo stesso slot del giocatore
 * chiamato (§4.2). `null` se il chiamato non ha un giudizio da cui partire — che
 * è uno stato normale con la sua frase, non un errore (§8).
 *
 * ⚠ **La regola è asimmetrica sulla titolarità, ed è il punto della sezione.**
 * Se chiami un 5/5, un 3/5 **non** è un'alternativa; se chiami un 3/5, un 5/5 lo
 * è eccome — costa solo di più. Un test simmetrico (`|Δtitolarità| ≤ 1`) direbbe
 * che **Bisseck sostituisce Bastoni**, che è la cosa sbagliata, e la direbbe con
 * la stessa faccia sicura. Il caso è misurato sul foglio in §4.1: dentro la
 * stessa fascia la titolarità va da 3/5 a 5/5 in ogni ruolo, e la correlazione
 * col PMA è solo `+0,50 / +0,25 / +0,45` — metà della variazione di prezzo
 * dentro una fascia **non** è titolarità, e metà della titolarità **non** è nel
 * prezzo. Un catalogo su fascia e prezzo mentirebbe.
 *
 * ⚠ **`Δrank ≤ 3` non è arbitrario**: senza limite il gruppo va da 5 a 21
 * elementi e non distingue niente; con il limite va da 1 a 7 e cambia da
 * giocatore a giocatore (misurato su otto chiamati). Oltre tre gradini di slot
 * non stai scegliendo un'alternativa per lo stesso posto, stai scegliendo una
 * rosa di forma diversa — e quella è un'altra domanda.
 *
 * ⚠ **«Libero» si deduce dalle rose, non da una query sul pool**: il pool sono
 * cinquecento righe immutabili dall'import in poi, chi sia ancora libero è
 * funzione dello stato.
 */
export function alternative(
  snapshot: Snapshot,
  pool: PoolPlayer[],
  budget: number,
  chiamatoId: string,
): Alternative | null {
  const chiamatoRow = pool.find((x) => x.id === chiamatoId);
  const chiamato = chiamatoRow ? catalogabile(chiamatoRow) : null;
  if (chiamato === null) return null;

  const presi = presiDaQualcuno(snapshot);
  const gruppi: Alternative = { pariLivello: [], costanoMeno: [], ripiego: [] };

  for (const player of pool) {
    if (player.id === chiamatoId) continue;
    // Lo slot è di un ruolo: un centrocampista non riempie una casella di difesa.
    if (player.role !== chiamato.player.role) continue;
    if (presi.has(player.id)) continue;
    const c = catalogabile(player);
    // ⚠ Senza fascia o senza titolarità non entra in nessun gruppo, e il
    // pannello lo dice invece di ingoiarlo: non c'è nessun criterio per
    // catalogarlo. Nel foglio di riferimento sono 67 righe.
    if (c === null) continue;

    const deltaRank = c.fasciaRank - chiamato.fasciaRank;
    const almenoTitolare = c.titolarita >= chiamato.titolarita;

    const dove = almenoTitolare
      ? deltaRank >= -1 && deltaRank <= 1
        ? "pariLivello"
        : // ⚠ Il gruppo che la prima stesura non copriva: «fascia più economica
          // ma titolarità pari o migliore», cioè esattamente l'occasione. Quei
          // giocatori cadevano fuori da ogni gruppo e sparivano dal pannello.
          deltaRank >= 2 && deltaRank <= 3
          ? "costanoMeno"
          : null
      : // Il ripiego è limitato a `Δrank ≤ 1` per la stessa ragione del limite
        // sopra: senza, contiene tutto il fondo del listone e non è un catalogo,
        // è un elenco.
        deltaRank >= 0 && deltaRank <= 1
        ? "ripiego"
        : null;
    if (dove === null) continue;

    gruppi[dove].push({
      playerId: player.id,
      name: player.name,
      team: player.team,
      titolarita: c.titolarita,
      startsEleven: player.insights?.startsEleven ?? null,
      presenze: player.insights?.presenze ?? null,
      tags: player.carmy?.tags ?? [],
      fmvExp: player.carmy?.fmvExp ?? null,
      pma: c.pma,
      atteso: pmaCrediti(c.pma, budget),
      fasciaRank: c.fasciaRank,
      deltaRank,
      obiettivo: player.obiettivo === true,
    });
  }

  // ⚠ **Per PMA decrescente — il più caro per primo — e non «i migliori»**, che
  // sarebbe il valore del giocatore rientrato dalla finestra (decisione 3). Il
  // PMA è un fatto scritto nel foglio; un ordinamento per bontà sarebbe un
  // giudizio, cioè la cosa che questa macro ha deciso di non dare.
  for (const gruppo of ["pariLivello", "costanoMeno", "ripiego"] as const) {
    gruppi[gruppo].sort((a, b) => b.pma - a.pma);
  }
  return gruppi;
}

// ─── §5.1 — i già andati della stessa fascia ─────────────────────────────────

export type Andato = {
  lotSeq: number;
  playerId: string;
  name: string;
  /** Il PMA in crediti: quanto ci si aspettava. */
  atteso: number;
  /** Quanto è stato pagato. */
  price: number;
  /** `price − atteso`, in crediti: il numero che §5.0 vuole accanto alla percentuale. */
  scarto: number;
  rapporto: number;
  /** Viene da una fascia adiacente, non da quella del chiamato (§5.1). */
  adiacente: boolean;
};

export type AndatiStessaFascia = {
  /** In **ordine di lotto**, non di prezzo. */
  righe: Andato[];
  /** Si è dovuto allargare alle fasce adiacenti per avere abbastanza righe. */
  allargato: boolean;
  /** Quanti della fascia del chiamato sono già andati, e quanti sono in tutto. */
  andati: number;
  totaleFascia: number;
  /** Quanti restano liberi **oltre al chiamato**. */
  liberiRestanti: number;
};

/** Sotto questo numero di righe la fascia si allarga alle adiacenti (§5.1). */
export const MIN_ANDATI_PRIMA_DI_ALLARGARE = 3;

/**
 * Quanto è costato davvero chi occupava **lo stesso slot** del giocatore
 * chiamato: il blocco che l'owner ha chiesto per nome, e il più diretto dei
 * quattro. `null` se il chiamato non ha una fascia da cui partire.
 *
 * ⚠ **In ordine di lotto, non di prezzo**, ed è la differenza fra un elenco e
 * un'informazione: così si **vede** dove il mercato ha girato. Un ordinamento
 * per prezzo mostrerebbe le stesse quattro righe e nasconderebbe l'unica cosa
 * che dicono insieme — che fra il secondo e il terzo nome la fascia si è
 * ribaltata, cioè lo scatto di §3.3 letto da vicino.
 *
 * ⚠ **Sotto le tre righe si allarga alle fasce adiacenti, dicendolo** (`allargato`).
 * Meglio quattro comparabili dichiarati un gradino sopra che due comparabili
 * perfetti su cui non si può leggere niente.
 *
 * ⚠ **Qui non si applica la soglia dei 5 crediti di §3.4, e la differenza è
 * voluta.** Il termometro risponde a «qual è il livello del ruolo» e scarta i
 * lotti che non portano informazione; questo blocco risponde a «cosa è costato
 * chi occupava lo slot», e lì un prezzo basso **è** la risposta. Dentro una
 * fascia i PMA sono omogenei per costruzione — è quello che una fascia è —
 * quindi in pratica i due insiemi coincidono; quando non coincidono, i conteggi
 * («6 andati su 10») restano veri, che è ciò che si romperebbe filtrando.
 */
export function andatiStessaFascia(
  snapshot: Snapshot,
  pool: PoolPlayer[],
  budget: number,
  chiamatoId: string,
): AndatiStessaFascia | null {
  const chiamatoRow = pool.find((x) => x.id === chiamatoId);
  const rank = chiamatoRow?.fasciaRank;
  if (chiamatoRow === undefined || rank === undefined) return null;

  const stessoRuolo = pool.filter((x) => x.role === chiamatoRow.role);
  const nellaFascia = stessoRuolo.filter((x) => x.fasciaRank === rank);
  const presi = presiDaQualcuno(snapshot);
  const prezzi = new Map(
    tutteLeRose(snapshot).map((entry) => [entry.playerId, entry]),
  );

  /** Le righe dei venduti fra i giocatori dati, in ordine di lotto. */
  function righeDi(candidati: PoolPlayer[]): Andato[] {
    const righe: Andato[] = [];
    for (const player of candidati) {
      if (player.id === chiamatoId) continue;
      const entry = prezzi.get(player.id);
      if (entry === undefined || entry.lotSeq === null) continue;
      const pma = player.carmy?.pma;
      if (pma === null || pma === undefined) continue;
      const atteso = pmaCrediti(pma, budget);
      righe.push({
        lotSeq: entry.lotSeq,
        playerId: player.id,
        name: player.name,
        atteso,
        price: entry.price,
        scarto: entry.price - atteso,
        rapporto: entry.price / atteso,
        adiacente: player.fasciaRank !== rank,
      });
    }
    return righe.sort((a, b) => a.lotSeq - b.lotSeq);
  }

  const strette = righeDi(nellaFascia);
  const allargato = strette.length < MIN_ANDATI_PRIMA_DI_ALLARGARE;
  const righe = allargato
    ? righeDi(
        stessoRuolo.filter(
          (x) => x.fasciaRank !== undefined && Math.abs(x.fasciaRank - rank) <= 1,
        ),
      )
    : strette;

  return {
    righe,
    allargato,
    andati: nellaFascia.filter((x) => x.id !== chiamatoId && presi.has(x.id))
      .length,
    totaleFascia: nellaFascia.length,
    liberiRestanti: nellaFascia.filter(
      (x) => x.id !== chiamatoId && !presi.has(x.id),
    ).length,
  };
}

// ─── §3.6 — la lettura per partecipante ──────────────────────────────────────

/** La scala degli slot di un ruolo: quanto budget vale il k-esimo, in frazione. */
export type ScalaSlot = {
  role: Role;
  /** Per rank di fascia crescente: `[0]` è il 1° slot. */
  quote: number[];
};

export type ScartoRuolo = {
  role: Role;
  presi: number;
  speso: number;
  /** In crediti. */
  piano: number;
  /** `speso − piano`: positivo = ha speso più del piano. */
  scarto: number;
};

export type ScartoPartecipante = {
  memberId: string;
  speso: number;
  piano: number;
  scarto: number;
  perRuolo: ScartoRuolo[];
};

/**
 * Quanto budget vale ogni slot di rosa, ruolo per ruolo.
 *
 * La scala grezza è «il PMA mediano della 1ª fascia, poi della 2ª, ecc.» — e la
 * fascia **è** lo slot (§2.1), quindi la domanda «quanto dovrebbe costargli il
 * secondo difensore» è un conteggio e non una deduzione.
 *
 * ⚠ **La normalizzazione non è cosmesi, ed è un difetto trovato costruendo il
 * mock il 2026-08-29.** La scala grezza **non somma a 100**: sul foglio di
 * riferimento fa **116,6%**, e il gonfiaggio non è nemmeno distribuito (P +10,0
 * punti, D +11,2, C −3,5, A −1,1). La ragione è strutturale: la scala assume che
 * ognuno prenda il *mediano* di ogni fascia, ma **le fasce alte non hanno
 * abbastanza giocatori per tutti** — cinque portieri `top` e due `semitop` per
 * otto squadre.
 *
 * Senza normalizzare, **ogni partecipante risulta «sotto piano» del 17%** e la
 * tabella dice che tutti stanno risparmiando, cioè non dice niente. Con la
 * normalizzazione gli scarti misurati sullo stesso stato diventano
 * `+17, −15, −26, −23, −39, −43, −40, −50`: uno spread leggibile, e chi ha speso
 * più del piano si distingue da chi no.
 *
 * ⚠ **Si normalizza per ruolo e non globalmente**, così `Σₖ quote[k] = piano(R)`
 * e §3.6 non può mai contraddire §3.2: le due letture poggiano sullo stesso
 * numero **per costruzione** invece che per coincidenza.
 */
export function scalaSlotPerRuolo(pool: PoolPlayer[]): Record<Role, ScalaSlot> {
  const piano = pianoPerRuolo(pool);
  const scale = {} as Record<Role, ScalaSlot>;

  for (const role of ROLES) {
    // I PMA di ogni fascia del ruolo, per rank crescente.
    const perFascia = new Map<number, number[]>();
    for (const player of pool) {
      if (player.role !== role) continue;
      const rank = player.fasciaRank;
      const pma = player.carmy?.pma;
      if (rank === undefined || pma === null || pma === undefined) continue;
      perFascia.set(rank, [...(perFascia.get(rank) ?? []), pma]);
    }
    const ranks = [...perFascia.keys()].sort((a, b) => a - b);
    const grezza = ranks.map((rank) => mediana(perFascia.get(rank)!));
    const somma = grezza.reduce((a, b) => a + b, 0);
    scale[role] = {
      role,
      // `somma === 0` è un ruolo senza fasce: nessuno slot, nessuna quota. Non
      // è un errore — è un foglio che quel ruolo non lo descrive.
      quote: somma === 0 ? [] : grezza.map((g) => (g / somma) * piano[role]),
    };
  }
  return scale;
}

/**
 * Chi ha speso più del proprio piano e chi meno, ruolo per ruolo e in totale.
 *
 * ⚠ **Gli acquisti si ordinano per prezzo decrescente** e si confrontano con la
 * scala delle fasce dal 1° slot in giù. Non è una deduzione su cosa avesse in
 * testa: è il modo in cui il foglio stesso ordina gli slot, applicato a ciò che
 * ha davvero comprato.
 *
 * ⚠ **Si mostra il numero e non l'intenzione.** «Ha speso l'11% in più del
 * piano» è un fatto; «sta risparmiando per l'attacco» è una lettura, e la fa chi
 * guarda. È la frase dell'owner: *«il resto lo lascio come deduzione
 * dell'utente»* — e la ragione per cui questa funzione restituisce crediti e non
 * aggettivi.
 *
 * ⚠ **Le assegnazioni manuali entrano**, come in `saldoRuoliChiusi` e al
 * contrario di `lottiInformativi`: qui si guarda quanto uno **ha speso**, e un
 * `manualAssign` gli ha tolto crediti come qualunque altro acquisto.
 */
export function scartoPerPartecipante(
  snapshot: Snapshot,
  pool: PoolPlayer[],
  budget: number,
): ScartoPartecipante[] {
  const scale = scalaSlotPerRuolo(pool);

  return snapshot.members.map((m) => {
    const perRuolo: ScartoRuolo[] = [];
    for (const role of ROLES) {
      const presi = m.roster
        .filter((entry) => entry.role === role)
        // Dal più caro al meno caro: è la scala delle fasce letta dall'alto.
        .sort((a, b) => b.price - a.price);
      if (presi.length === 0) continue;

      const speso = presi.reduce((somma, entry) => somma + entry.price, 0);
      // ⚠ **Se ha preso più giocatori che fasce, gli slot in eccesso valgono
      // zero.** Capita solo con un foglio che descrive meno slot di quanti il
      // regolamento ne dia, ed è la scelta prudente: attribuirgli una quota
      // inventata gonfierebbe il suo piano e lo farebbe sembrare parsimonioso.
      const quote = scale[role].quote;
      const piano = Math.round(
        presi.reduce((somma, _entry, k) => somma + (quote[k] ?? 0), 0) * budget,
      );
      perRuolo.push({ role, presi: presi.length, speso, piano, scarto: speso - piano });
    }

    const speso = perRuolo.reduce((s, r) => s + r.speso, 0);
    const piano = perRuolo.reduce((s, r) => s + r.piano, 0);
    return { memberId: m.id, speso, piano, scarto: speso - piano, perRuolo };
  });
}

// ─── §2.2 e §3.4 — i due fatti che la tab dichiara in testa ──────────────────

export type ScartoStrutturale = {
  /** I crediti che il tavolo ha in tutto. */
  budgetTavolo: number;
  /** Quanto vale il listone ai prezzi del foglio, in crediti. */
  valoreListone: number;
  /** `budgetTavolo / valoreListone`: sotto 1 vuol dire che si paga sotto il PMA. */
  copertura: number;
};

/**
 * Quanto il tavolo può comprare di ciò che il foglio mette in vendita (§2.2).
 *
 * ⚠ **Questa non è un'occasione: è la nuova unità di misura, ed è la trappola
 * numero uno del termometro.** Con 8 rose da 500 crediti ci sono 4.000 crediti e
 * il listone ne vale ~4.965 ai prezzi del foglio, perché il foglio è tarato per
 * **dieci** rose (§2: la somma di tutti i PMA fa 993%). Circa un quinto del
 * valore non verrà comprato da nessuno, e in ogni fascia da dieci candidati ne
 * avanzano due.
 *
 * Conseguenza: **con otto partecipanti si paga strutturalmente sotto il PMA
 * ovunque**, quindi un `−15%` non è uno sconto, è la norma. L'informazione sta
 * nella **differenza fra un reparto e l'altro** e nel **cambiamento nel tempo**,
 * mai nella distanza dal PMA nudo. Il pannello lo dichiara in testa invece di
 * lasciare che chi legge scambi lo scarto strutturale per un affare.
 *
 * ⚠ **Si calcola, non si scrive.** Il «siete in 8 su un foglio per 10» è vero
 * per il tavolo di riferimento e falso per un altro: con dodici partecipanti il
 * rapporto si rovescia, e una frase costante direbbe la cosa sbagliata proprio
 * al tavolo che ne avrebbe più bisogno.
 */
export function scartoStrutturale(
  snapshot: Snapshot,
  pool: PoolPlayer[],
  budget: number,
): ScartoStrutturale {
  const budgetTavolo = budget * snapshot.members.length;
  const valoreListone = pool.reduce((somma, player) => {
    const pma = player.carmy?.pma;
    return pma === null || pma === undefined
      ? somma
      : somma + pmaCrediti(pma, budget);
  }, 0);
  return {
    budgetTavolo,
    valoreListone,
    copertura: valoreListone === 0 ? 1 : budgetTavolo / valoreListone,
  };
}
