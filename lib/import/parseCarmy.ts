import * as XLSX from "xlsx";

import { CARMY_FASCIA_ASSENTE, CARMY_SCALA_MAX, ROLES, type Role } from "@/lib/domain";
import { type Result, fail, ok } from "@/lib/engine/errors";

/**
 * Il parser del foglio di Carmy (M10B §1).
 *
 * È una funzione pura come gli altri tre — bytes in, righe o errore tipizzato
 * fuori — e non tocca il database. Il join per nome, che è la parte fragile, sta
 * in `lib/engine/carmy.ts`: qui **non c'è nessun `ext_id`**, perché nel file non
 * c'è.
 *
 * ## Il formato, verificato sui byte del 2026-08-12
 *
 * Quattro fogli che si chiamano `P`, `D`, `C`, `A` — cioè esattamente `ROLES` —
 * con 59 + 176 + 174 + 88 = **497 righe** e la stessa intestazione di 32 colonne
 * in tutti e quattro:
 *
 * ```
 * Obiett. Fascia Ruolo Team Nome Prezzo PMA Quo Titolarità Affidabilità Integrità
 * Commento Nota 1…Nota 5 MV FMV Presenze FMV Exp. Pt. Tit. Minuti Pt. Inf. Gol
 * Assist Ammonizioni Espulsioni Rig. Segnati Rig. Sbagliati Gol Subiti Rig. Parati
 * ```
 *
 * ## ⚠ Le colonne che questo parser butta, e perché
 *
 * **Le undici statistiche**, che sono identiche byte per byte a quelle che già
 * importiamo dalla fonte A: `Presenze` vs `presenze` 497/497, `Pt. Tit.` vs
 * `starts_eleven` 497/497, `Minuti`, `Quo`, `Assist`, i cartellini, i tre rigori,
 * `Gol Subiti`. **Carmy non porta nessuna statistica nuova** (M10B §1): porta un
 * giudizio. Importarle vorrebbe dire avere due copie degli stessi numeri e una
 * domanda in più a cui rispondere ogni volta — quale delle due è quella buona.
 *
 * ⚠ **`Pt. Inf.` non è «partite saltate per infortunio», malgrado il nome.** È
 * identica al campo `injured` della fonte A (497/497), va da 0 a 5, e
 * `Presenze + Pt. Inf.` non converge a 38 (massimo misurato: 42, perché le
 * presenze sommano più competizioni). È un **conteggio di episodi**, che M8 §9
 * aveva già scartato. Il punto «togliere le giornate di infortunio dal calcolo»
 * **resta senza dato**, e questa colonna sembra risolverlo senza risolverlo: è la
 * trappola numero uno del file. Se un giorno servisse davvero, si chiede a chi
 * compila il foglio — non si deduce dal nome della colonna.
 *
 * **`Ruolo`**, ridondante col nome del foglio: verificato, 0 discordanze su 497.
 *
 * **`Obiett.`**, valorizzata `Sí` su tre giocatori. ⚠ È la **lista della spesa di
 * chi compila il foglio**, non un giudizio sul giocatore: metterla nell'app
 * vorrebbe dire mostrare a dodici persone chi punta a comprare l'autore del file,
 * il quale gioca la stessa asta. Non si importa, e la ragione sta scritta qui
 * perché è la colonna che qualcuno vorrà aggiungere.
 *
 * ⚠ **E qualcuno l'ha aggiunta: M21, il 2026-08-28.** La frase qui sopra è ancora
 * giusta e per questo non si cancella — quello che cade è il suo **presupposto**.
 * Là il foglio era uno solo e globale, quindi importare `Obiett.` voleva dire
 * pubblicare la lista della spesa di una persona sola; da M21 esiste un secondo
 * percorso, **per utente**, in cui il file è mio e il dato non esce dal mio
 * browser. Quindi il parser adesso la legge, e **la distinzione sta a valle**:
 * `uploadCarmy` — il percorso globale verso `carmy_players` — continua a
 * ignorarla, e lì l'obiezione vale identica. Non è «M10B sbagliava», è «M10B
 * decideva su un altro caso» (M21 §0, `DECISIONS.md` alla data).
 *
 * ## ⚠ Lo zero non è un voto
 *
 * Il foglio scrive l'assenza in tre modi diversi, e il database la scrive in uno:
 * `0` sui tre giudizi e sul prezzo, `"Non Impostata"` sulla fascia, la cella vuota
 * sulla fantamedia attesa. Diventano tutti `null`. Sul file del 2026-08-12 è **un
 * giocatore** ad avere i tre zeri insieme (Aurelio, con `MV` a zero e la fantamedia
 * vuota: una riga non compilata), **73** ad avere `Prezzo` a zero, **84** ad avere
 * `Non Impostata`. Un «titolarità 0» lo farebbe passare per il peggior giocatore
 * del listone invece che per un giocatore su cui non c'è giudizio.
 */

/** I quattro fogli, che si chiamano come i ruoli. */
export const CARMY_SHEETS = ROLES;

const COLUMNS = {
  name: "Nome",
  team: "Team",
  fascia: "Fascia",
  prezzo: "Prezzo",
  pma: "PMA",
  titolarita: "Titolarità",
  affidabilita: "Affidabilità",
  integrita: "Integrità",
  fmvExp: "FMV Exp.",
  commento: "Commento",
} as const;

/** Le cinque note, che diventano un array. */
const NOTE_COLUMNS = ["Nota 1", "Nota 2", "Nota 3", "Nota 4", "Nota 5"] as const;

/**
 * La lista della spesa (M21 §6).
 *
 * ⚠ **Volutamente fuori da `REQUIRED_COLUMNS`**, ed è una scelta contro
 * l'argomento che quell'elenco esiste per fare — «una persona rinomina una
 * colonna, e l'import scrive in silenzio 497 righe vuote». Qui non regge, per
 * una ragione sola: **la colonna serve a un percorso e il rifiuto ne fermerebbe
 * due.** `uploadCarmy` non la guarda nemmeno, e M21 promette che quel percorso
 * resti **identico**; pretenderla vorrebbe dire che un foglio più vecchio smette
 * di poter essere caricato dall'amministratore per una colonna che a
 * `carmy_players` non serve.
 *
 * Il silenzio si copre dall'altra parte: il riepilogo del caricamento personale
 * dice **quanti obiettivi** ha letto, e uno zero lì è la stessa informazione di
 * un rifiuto — arrivata a chi può correggere il file, invece che a chi non ne ha
 * uno.
 */
const OBIETTIVO_COLUMN = "Obiett.";

/**
 * `Sí`, `SI`, `sì`: la stessa cosa scritta da tre tastiere.
 *
 * Si confronta **normalizzato** — senza accenti, senza maiuscole, senza spazi —
 * perché la differenza fra `Sí` e `SI` non è un'informazione. Nel file di
 * riferimento la colonna ha **due soli valori** su 497 righe, misurati: vuota
 * (494) e `Sí` (3).
 *
 * ⚠ **L'insieme è corto di proposito.** `x`, `1`, `true` non compaiono in nessun
 * file visto, e accettarli vorrebbe dire indovinare cosa scriverà un domani chi
 * compila: un `1` in quella cella potrebbe benissimo essere una priorità, non un
 * sì. Quello che non è riconosciuto vale `false`, e il conteggio del riepilogo lo
 * rende visibile.
 */
const OBIETTIVO_SI = new Set(["si", "s"]);

function isObiettivo(value: unknown): boolean {
  const normalized = asText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, "");
  return OBIETTIVO_SI.has(normalized);
}

/**
 * L'ordine delle fasce **come lo dice il file**, fondendo i quattro fogli (M21 §6).
 *
 * Ogni foglio è una sequenza: i giocatori sono ordinati dalla fascia più alta
 * alla più bassa e nessuna fascia si ripete — verificato sui quattro fogli del
 * file del 2026-08-12. Quindi ogni foglio afferma un ordine **parziale**, e il
 * lavoro è metterli insieme senza contraddirne nessuno.
 *
 * ⚠ **Non è «la prima occorrenza in ordine di foglio», e la differenza si vede
 * sul file vero.** La spec di M21 diceva di accodare ogni fascia nuova; misurato,
 * quel metodo sbaglia: `P` e `A` non hanno `Titolare "Scarso"`, che in `D` e `C`
 * sta **fra `Scomm.` e `Outsider`**, quindi accodandolo alla prima occorrenza
 * finirebbe **dopo `Outsider`** — cioè in un ordine che due dei quattro fogli
 * smentiscono, nella funzione che esiste apposta per rispettare il file.
 *
 * Si fa invece un ordinamento topologico: ogni foglio dà gli archi «questa fascia
 * precede quella», e si estraggono le fasce senza predecessori, a parità nell'
 * ordine in cui si sono viste la prima volta. Sul file vero il risultato è
 * **esattamente `CARMY_FASCE`**, che è stato scritto a mano leggendo lo stesso
 * foglio: due derivazioni indipendenti della stessa verità, ed è il test.
 *
 * ⚠ **Un ciclo non fa fallire niente.** Se due fogli si contraddicessero — `A`
 * prima di `B` in uno, il contrario nell'altro — non c'è nessun ordine giusto da
 * trovare: si rompe il pareggio con l'ordine di prima apparizione e si tira
 * avanti. Rifiutare l'intero caricamento personale per due fasce in ordine
 * discorde punirebbe chi ha compilato il foglio per una cosa che, a schermo, è
 * un gruppo dieci righe più in alto.
 */
export function mergeFasce(sequences: readonly (readonly string[])[]): string[] {
  const firstSeen: string[] = [];
  const successors = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();

  const node = (fascia: string) => {
    if (!successors.has(fascia)) {
      firstSeen.push(fascia);
      successors.set(fascia, new Set());
      indegree.set(fascia, 0);
    }
  };

  for (const sequence of sequences) {
    for (const fascia of sequence) node(fascia);
    // Solo le coppie **consecutive**: la catena porta la transitività da sé, e
    // gli archi restano quanti sono le fasce invece del loro quadrato.
    for (let i = 1; i < sequence.length; i += 1) {
      const from = sequence[i - 1];
      const to = sequence[i];
      if (from === to) continue;
      const edges = successors.get(from)!;
      if (edges.has(to)) continue;
      edges.add(to);
      indegree.set(to, indegree.get(to)! + 1);
    }
  }

  const ordered: string[] = [];
  const taken = new Set<string>();
  while (ordered.length < firstSeen.length) {
    const next =
      firstSeen.find((f) => !taken.has(f) && indegree.get(f) === 0) ??
      // Nessuna senza predecessori: c'è un ciclo. Si prende la prima vista fra
      // quelle rimaste, e il giro successivo riprende normalmente.
      firstSeen.find((f) => !taken.has(f))!;

    taken.add(next);
    ordered.push(next);
    for (const to of successors.get(next)!) {
      indegree.set(to, indegree.get(to)! - 1);
    }
  }

  return ordered;
}

/**
 * Le colonne senza le quali il file non è il file.
 *
 * ⚠ **Il rifiuto è forte di proposito.** Questo foglio lo compila una persona, e
 * una persona rinomina una colonna: il giorno in cui `Titolarità` diventasse
 * `Tit.`, senza questo controllo l'import scriverebbe 497 giudizi vuoti sopra 497
 * giudizi buoni e nessuno se ne accorgerebbe fino alla sera dell'asta. Le note e
 * il commento sono dentro l'elenco per la stessa ragione: se sparissero, i tag
 * sparirebbero in silenzio.
 */
const REQUIRED_COLUMNS = [
  ...Object.values(COLUMNS),
  ...NOTE_COLUMNS,
] as readonly string[];

/** Una riga del foglio, senza `ext_id`: quello lo mette il join. */
export type CarmyRow = {
  /** Il nome come lo scrive il foglio, non normalizzato. */
  name: string;
  /** La sigla di tre lettere, così com'è: la traduce `CARMY_TEAM_BY_SIGLA`. */
  team: string;
  /** Dal nome del foglio, non dalla colonna `Ruolo`. */
  role: Role;
  fascia: string | null;
  /**
   * Il posto della fascia nell'ordine del file, da `0`. `null` per chi non ha
   * fascia — che nel foglio si scrive `"Non Impostata"`, ed è il gruppo «Senza
   * fascia» in fondo alla tabella (M21 §4).
   *
   * ⚠ **È una proprietà del file, non della riga**, e per questo si calcola solo
   * quando tutti e quattro i fogli sono stati letti: la stessa fascia in due
   * fogli deve avere lo stesso numero, o il raggruppamento si spezza in due.
   */
  fasciaRank: number | null;
  /**
   * La colonna `Obiett.`: «lo voglio comprare» (M21).
   *
   * ⚠ **La legge solo il caricamento personale.** `uploadCarmy`, che scrive la
   * tabella globale, la ignora — vedi il commento in testa al file: sul percorso
   * globale l'obiezione di M10B vale identica, e questo campo lì non deve
   * arrivare da nessuna parte.
   */
  obiettivo: boolean;
  prezzo: number | null;
  /** Il `PMA`, in punti percentuali: `10.5` sta per «10,5%». */
  pma: number | null;
  titolarita: number | null;
  affidabilita: number | null;
  integrita: number | null;
  fmvExp: number | null;
  tags: string[];
  commento: string | null;
};

type RawRow = Record<string, unknown>;

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

/** Un numero, da una cella che può essere numero, stringa o vuota. */
function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.trim().replace(",", ".");
    if (cleaned === "") return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Il `PMA`, che nel foglio è **una stringa** con il segno di percentuale dentro
 * (`"10.5%"`, `"9%"`), non un numero: la cella è testo battuto a mano, con un
 * formato percentuale applicato sopra.
 *
 * Torna i **punti percentuali** (`10.5`), non la frazione: è ciò che si scrive a
 * schermo, e tenere la frazione vorrebbe dire moltiplicare per cento in ogni
 * chiamante. Lo `0%` diventa `null`, come lo zero del prezzo.
 */
function percent(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value !== 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace("%", "").replace(",", ".");
  if (cleaned === "") return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed === 0) return null;
  return parsed;
}

/**
 * Uno dei tre giudizi: `1`–`5`, oppure `null`.
 *
 * Lo `0` e la cella vuota diventano `null` (vedi il commento in testa). Un valore
 * **fuori** dalla scala non diventa `null`: fa fallire l'import, perché vorrebbe
 * dire che la scala è cambiata, e una scala cambiata letta come se non lo fosse è
 * un badge verde su un giocatore qualsiasi.
 */
function grade(value: unknown): number | null | "invalid" {
  const n = asNumber(value);
  if (n === null || n === 0) return null;
  if (!Number.isInteger(n) || n < 1 || n > CARMY_SCALA_MAX) return "invalid";
  return n;
}

export function parseCarmy(file: ArrayBuffer | Uint8Array): Result<CarmyRow[]> {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(file, { type: "array" });
  } catch {
    return fail(
      "CARMY_UNREADABLE",
      "Non riesco ad aprire il file: assicurati che sia il foglio di Carmy in formato .xlsx.",
    );
  }

  const rows: CarmyRow[] = [];
  // Il nome è la chiave del join (§3): due righe con lo stesso nome non si
  // possono agganciare a due giocatori diversi, e sceglierne una a caso è il
  // genere di silenzio che si scopre in asta.
  const seen = new Map<string, string>();
  /** La sequenza delle fasce di ciascun foglio, per `mergeFasce`. */
  const sequences: string[][] = [];

  for (const sheetName of CARMY_SHEETS) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      return fail(
        "CARMY_SHEET_MISSING",
        `Nel file manca il foglio "${sheetName}". Fogli trovati: ${
          workbook.SheetNames.join(", ") || "nessuno"
        }.`,
      );
    }

    const sheetRows = XLSX.utils.sheet_to_json<RawRow>(sheet, {
      raw: true,
      defval: null,
    });

    if (sheetRows.length === 0) {
      return fail("CARMY_EMPTY", `Il foglio "${sheetName}" è vuoto.`);
    }

    const sequence: string[] = [];
    const header = Object.keys(sheetRows[0]);
    const missing = REQUIRED_COLUMNS.filter((col) => !header.includes(col));
    if (missing.length > 0) {
      return fail(
        "CARMY_COLUMNS_MISSING",
        `Nel foglio "${sheetName}" mancano le colonne: ${missing.join(", ")}.`,
      );
    }

    for (const [index, raw] of sheetRows.entries()) {
      // +2: l'intestazione è la riga 1, quindi la prima riga di dati è la 2.
      const line = index + 2;
      const where = `Foglio "${sheetName}", riga ${line}`;

      const name = asText(raw[COLUMNS.name]);
      if (name === "") {
        return fail("CARMY_ROW_INVALID", `${where}: manca il nome.`);
      }

      const previous = seen.get(name.toLowerCase());
      if (previous !== undefined) {
        return fail(
          "CARMY_DUPLICATE_NAME",
          `${where}: "${name}" compare due volte nel file (già in ${previous}). Il nome è la chiave con cui il foglio si aggancia al listone, quindi due righe con lo stesso nome non si possono importare.`,
        );
      }
      seen.set(name.toLowerCase(), where);

      const team = asText(raw[COLUMNS.team]);
      if (team === "") {
        return fail("CARMY_ROW_INVALID", `${where}: manca la squadra di ${name}.`);
      }

      const grades = {
        titolarita: grade(raw[COLUMNS.titolarita]),
        affidabilita: grade(raw[COLUMNS.affidabilita]),
        integrita: grade(raw[COLUMNS.integrita]),
      };
      for (const [key, value] of Object.entries(grades)) {
        if (value === "invalid") {
          return fail(
            "CARMY_ROW_INVALID",
            `${where}: "${key}" di ${name} vale ${JSON.stringify(
              raw[COLUMNS[key as keyof typeof grades]],
            )}, che non è un voto da 1 a ${CARMY_SCALA_MAX}. Se la scala del foglio è cambiata, va cambiata anche qui.`,
          );
        }
      }

      const prezzoRaw = asNumber(raw[COLUMNS.prezzo]);
      if (prezzoRaw !== null && (!Number.isInteger(prezzoRaw) || prezzoRaw < 0)) {
        return fail(
          "CARMY_ROW_INVALID",
          `${where}: il prezzo di ${name} vale ${JSON.stringify(
            raw[COLUMNS.prezzo],
          )}, che non è un numero di crediti.`,
        );
      }

      const fascia = asText(raw[COLUMNS.fascia]);
      const fmvExp = asNumber(raw[COLUMNS.fmvExp]);
      const commento = asText(raw[COLUMNS.commento]);

      // `"Non Impostata"` è il modo in cui il foglio scrive «nessuna fascia».
      const fasciaVera =
        fascia === "" || fascia === CARMY_FASCIA_ASSENTE ? null : fascia;
      // La sequenza del foglio, senza ripetizioni. Sul file vero una fascia non
      // torna mai dopo essersi chiusa, ma un `includes` costa niente e rende la
      // sequenza corretta anche su un file rimescolato a mano.
      if (fasciaVera !== null && !sequence.includes(fasciaVera)) {
        sequence.push(fasciaVera);
      }

      rows.push({
        name,
        team,
        role: sheetName,
        fascia: fasciaVera,
        // Riempito sotto, quando tutti e quattro i fogli hanno parlato.
        fasciaRank: null,
        obiettivo: isObiettivo(raw[OBIETTIVO_COLUMN]),
        // Zero non è un prezzo: non è nemmeno un'offerta valida.
        prezzo: prezzoRaw === null || prezzoRaw === 0 ? null : prezzoRaw,
        // ⚠ Come la scrive il foglio, **non** ricalcolata da `prezzo`: sono due
        // numeri diversi — solo 132 righe su 385 coincidono con `prezzo / 5` — e
        // ricalcolarla vorrebbe dire sostituire il dato di qualcun altro con una
        // nostra stima (vedi lo schema).
        pma: percent(raw[COLUMNS.pma]),
        titolarita: grades.titolarita as number | null,
        affidabilita: grades.affidabilita as number | null,
        integrita: grades.integrita as number | null,
        // Zero come `fmv_home` in `parseFantalabListone`: una fantamedia zero si
        // legge a schermo come «attesa 0.00», che è una bugia.
        fmvExp: fmvExp === null || fmvExp === 0 ? null : fmvExp,
        // Le cinque note compattate: si tolgono i vuoti e si tiene l'ordine del
        // foglio, che è quello in cui chi scrive le ha messe.
        tags: NOTE_COLUMNS.map((col) => asText(raw[col])).filter(
          (tag) => tag !== "",
        ),
        // Il commento è multi-riga, e su un giocatore è **solo** un `\n`: `trim`
        // lo riduce a vuoto, che è ciò che è.
        commento: commento === "" ? null : commento,
      });
    }

    sequences.push(sequence);
  }

  if (rows.length === 0) {
    return fail("CARMY_EMPTY", "Il file non contiene nessuna riga.");
  }

  // L'ordine delle fasce è una proprietà **del file**: si decide qui, in un posto
  // solo, quando tutti e quattro i fogli hanno parlato.
  const rank = new Map(mergeFasce(sequences).map((fascia, i) => [fascia, i]));
  for (const row of rows) {
    row.fasciaRank = row.fascia === null ? null : (rank.get(row.fascia) ?? null);
  }

  return ok(rows);
}
