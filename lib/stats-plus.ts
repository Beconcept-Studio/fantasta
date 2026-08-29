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
 * Quanto deve cambiare un rapporto perché valga un avviso (§3.5).
 *
 * ⚠ **0,25 è scelto, non misurato, e va detto.** È un quarto di PMA: su un
 * giocatore da 40 crediti, una differenza di dieci — la soglia sotto la quale un
 * cambiamento non cambia una decisione. **È l'unico numero di questa macro che
 * vada rivisto dopo la prima asta vera**, guardando se ha suonato quando serviva
 * e taciuto quando no.
 */
export const SOGLIA_AVVISO = 0.25;

/**
 * Quanti lotti informativi servono **per parte** perché due mediane siano un
 * confronto invece che due aneddoti (§3.3, §3.5).
 */
export const MIN_LOTTI_PER_PARTE = 4;

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
 * I punti osservati di un ruolo, **e quanti sono**.
 *
 * ⚠ **Punti, non una media** (§3.1). Con quattro lotti chiusi una media ha la
 * stessa faccia sicura di una calcolata su quaranta, e chi legge non può
 * distinguerle. «Te lo dico su 4» e «su 40» sono due affermazioni diverse, e chi
 * legge ha diritto di distinguerle: per questo `n` viaggia sempre col resto e
 * non è un dettaglio che la UI può decidere di non mostrare.
 */
export type Temperatura = {
  n: number;
  min: number;
  mediana: number;
  max: number;
};

export type Saldo = {
  role: Role;
  /** `piano(R) × budget × membri`, in crediti. */
  piano: number;
  /** Quanto il tavolo ha speso davvero in quel ruolo, manuali compresi. */
  speso: number;
  /** `piano − speso`: positivo vuol dire che restano crediti oltre il previsto. */
  saldo: number;
};

export type Scatto = { prima: number; adesso: number };

export type Avviso =
  | { tipo: "SCATTO"; prima: number; adesso: number }
  | { tipo: "CAMBIO_ARIA"; role: Role; precedente: Role; da: number; a: number };

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
 * I punti osservati di un ruolo: minimo, mediana, massimo **e quanti sono**.
 *
 * ⚠ **Niente contrazione bayesiana, niente prior, niente `k`.** La prima stesura
 * le aveva ed erano il punto esatto in cui l'evidenza diventava stima: con pochi
 * dati un termometro contratto dice un numero addolcito che ha la faccia di una
 * misura. Qui con pochi dati il termometro dice **«pochi dati»** — cioè `n` — e
 * lascia la deduzione a chi legge. È la frase dell'owner: *«il resto lo lascio
 * come deduzione dell'utente».*
 *
 * `null` con nessun lotto informativo, e non uno zero: la UI ha una frase
 * («Nessun lotto informativo ancora»), non un `—` muto (§8).
 */
export function temperatura(lotti: LottoInformativo[]): Temperatura | null {
  if (lotti.length === 0) return null;
  const rapporti = lotti.map((l) => l.rapporto);
  return {
    n: rapporti.length,
    min: Math.min(...rapporti),
    mediana: mediana(rapporti),
    max: Math.max(...rapporti),
  };
}

// ─── §3.3 — lo scatto dentro il ruolo ────────────────────────────────────────

/**
 * L'inizio del ruolo contro l'adesso: due mediane, non un livello.
 *
 * ⚠ **Sotto gli 8 lotti informativi non si calcola e non si mostra.** Quattro
 * contro quattro è il minimo sotto cui due mediane sono due aneddoti; finché non
 * ci si arriva restano i punti osservati col loro numero accanto (§3.1).
 *
 * Con un numero dispari di lotti **il lotto di mezzo si scarta**, così le due
 * metà hanno la stessa numerosità: due mediane calcolate su 5 e su 4 punti
 * sarebbero confrontabili solo per finta.
 */
export function scatto(lotti: LottoInformativo[]): Scatto | null {
  const meta = Math.floor(lotti.length / 2);
  if (meta < MIN_LOTTI_PER_PARTE) return null;
  const rapporti = lotti.map((l) => l.rapporto);
  return {
    prima: mediana(rapporti.slice(0, meta)),
    adesso: mediana(rapporti.slice(-meta)),
  };
}

// ─── §3.2 — il saldo dei ruoli chiusi ────────────────────────────────────────

/**
 * Quali ruoli sono finiti: quelli **prima** di `currentRole` nell'ordine, e
 * tutti se l'asta è finita.
 */
function ruoliChiusi(snapshot: Snapshot): Role[] {
  const ordine = snapshot.auction.roleOrder;
  const corrente = snapshot.auction.currentRole;
  if (corrente === null) {
    // Nessun ruolo in corso: o l'asta è finita, o non è ancora partita. Nel
    // secondo caso non c'è niente di speso e i saldi escono a zero da soli.
    return snapshot.auction.status === "COMPLETED" ? [...ordine] : [];
  }
  const indice = ordine.indexOf(corrente);
  return indice <= 0 ? [] : ordine.slice(0, indice);
}

/**
 * Il residuo che ogni ruolo chiuso ha lasciato sul tavolo.
 *
 * È il ponte fra i due orologi di §3 — la temperatura si azzera a ogni ruolo, il
 * vincolo si accumula — e **funziona perché il budget è chiuso**: se la difesa
 * assorbe il 14% della spesa contro un piano del 20%, quei crediti non sono
 * spariti, sono in tasca a qualcuno e usciranno altrove. Non è una previsione, è
 * un'identità contabile.
 *
 * ⚠ **Solo per i ruoli finiti, e l'assenza è la difesa** (§3.2). A metà ruolo
 * `speso(R)` è un parziale, e confrontarlo con l'intero `piano(R)` direbbe
 * sempre «avanza tantissimo». È un errore che si scrive da solo riusando la
 * formula senza guardare quale ruolo si sta guardando, quindi il ruolo in corso
 * non compare **affatto** invece di comparire con un numero che sembra vero.
 *
 * ⚠ **Nello speso entrano anche le assegnazioni manuali**, al contrario di
 * `lottiInformativi`, e la differenza non è una svista: questo è **contabilità**
 * — quei crediti sono usciti dal tavolo davvero — mentre là si misurava un
 * prezzo di mercato, che un `manualAssign` non è.
 */
export function saldoRuoliChiusi(
  snapshot: Snapshot,
  pool: PoolPlayer[],
  budget: number,
): Saldo[] {
  const piano = pianoPerRuolo(pool);
  const budgetTavolo = budget * snapshot.members.length;
  const rose = tutteLeRose(snapshot);

  return ruoliChiusi(snapshot).map((role) => {
    const speso = rose
      .filter((entry) => entry.role === role)
      .reduce((somma, entry) => somma + entry.price, 0);
    const pianoRuolo = Math.round(piano[role] * budgetTavolo);
    return { role, piano: pianoRuolo, speso, saldo: pianoRuolo - speso };
  });
}

// ─── §3.5 — i due avvisi ─────────────────────────────────────────────────────

/**
 * Gli avvisi, che sono **soglie su fatti** e non un modello.
 *
 * Due soli casi, e fuori da questi **nessun avviso**: i numeri bastano e non si
 * inventa un terzo stato per riempire lo spazio.
 *
 * - **SCATTO** — dentro il ruolo in corso, `|adesso − prima| ≥ 0,25`.
 * - **CAMBIO D'ARIA** — il ruolo in corso paga 0,25 sopra o sotto quello
 *   **immediatamente precedente** nell'ordine, con almeno
 *   {@link MIN_LOTTI_PER_PARTE} lotti informativi per parte.
 *
 * ⚠ **Il confronto è fra mediane**, che §3.5 non diceva e §3.1 vieta di
 * risolvere con una media: è la stessa statistica dello scatto, così i due
 * avvisi non possono contraddirsi guardando gli stessi lotti.
 *
 * ⚠ **«Il ruolo precedente» è quello immediatamente prima, letteralmente.** Se
 * ha meno di quattro lotti informativi non si risale al penultimo per trovarne
 * uno abbastanza popolato: un confronto con un ruolo di due giri fa
 * risponderebbe a una domanda che nessuno ha fatto, e lo farebbe senza dirlo.
 */
export function avvisi(
  snapshot: Snapshot,
  pool: PoolPlayer[],
  budget: number,
): Avviso[] {
  const role = snapshot.auction.currentRole;
  if (role === null) return [];

  const fuori: Avviso[] = [];
  const lotti = lottiInformativi(snapshot, pool, budget, role);

  const s = scatto(lotti);
  if (s !== null && Math.abs(s.adesso - s.prima) >= SOGLIA_AVVISO) {
    fuori.push({ tipo: "SCATTO", prima: s.prima, adesso: s.adesso });
  }

  const ordine = snapshot.auction.roleOrder;
  const precedente = ordine[ordine.indexOf(role) - 1];
  if (precedente !== undefined) {
    const prima = lottiInformativi(snapshot, pool, budget, precedente);
    const qui = temperatura(lotti);
    const là = temperatura(prima);
    if (
      qui !== null &&
      là !== null &&
      lotti.length >= MIN_LOTTI_PER_PARTE &&
      prima.length >= MIN_LOTTI_PER_PARTE &&
      Math.abs(qui.mediana - là.mediana) >= SOGLIA_AVVISO
    ) {
      fuori.push({
        tipo: "CAMBIO_ARIA",
        role,
        precedente,
        da: là.mediana,
        a: qui.mediana,
      });
    }
  }

  return fuori;
}
