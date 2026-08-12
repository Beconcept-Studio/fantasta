import {
  ROLES,
  type PlayerInsights,
  type Role,
  bestSetPieceRank,
  quotaTitolare,
  showableInsights,
} from "@/lib/domain";

/**
 * Ordinamento e filtri del Centro dati (M10), come funzioni pure.
 *
 * ## Perché non stanno dentro il componente
 *
 * Perché sono l'unica parte di quella pagina che può sbagliarsi in silenzio.
 * Cinquecento righe ordinate male non danno nessun errore: danno una lista
 * plausibile e sbagliata, e nessuno se ne accorge finché non cerca un nome che
 * dovrebbe stare in cima. Qui si provano senza un browser e senza un database,
 * come `lib/domain.ts` — da cui infatti dipendono, e da nient'altro.
 *
 * ## Le due regole che decidono più di quanto sembri
 *
 * 1. **Chi non ha un valore finisce sempre in fondo**, in tutte e due le
 *    direzioni. Invertire «titolarità» non deve portare in cima trecento
 *    trattini: il senso di quella colonna è la classifica di chi *ha* il dato, e
 *    l'assenza non è uno zero (è la stessa distinzione di M8 — `—` e `0` non si
 *    scrivono allo stesso modo).
 * 2. **Ogni ordinamento finisce col nome.** Duecento difensori quotati 1
 *    resterebbero altrimenti in un ordine che cambia a ogni click senza motivo
 *    visibile, ed è il genere di instabilità che fa sospettare un bug.
 */

/** Le righe che questo modulo sa ordinare: la forma minima, non quella del DB. */
export type CentroDatiSortable = {
  name: string;
  team: string;
  role: Role;
  quot: number;
  insights?: PlayerInsights;
};

export const SORT_KEYS = [
  "name",
  "team",
  "role",
  "quot",
  "titolarita",
  "piazzati",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export type SortDirection = "asc" | "desc";
export type CentroDatiSort = { key: SortKey; direction: SortDirection };

/**
 * ⚠ **Il default è la quotazione dal più alto al più basso** (richiesta
 * dell'owner, 2026-08-12). È l'unica colonna di valore che il Centro dati
 * mostra: `FVM/1000` resta fuori dalla pagina per decisione dell'owner, pur
 * restando a database perché è lui a decidere l'auto-pick (M10 §2). Ordinare per
 * una colonna che non si vede sarebbe una lista in un ordine inspiegabile.
 */
export const DEFAULT_SORT: CentroDatiSort = { key: "quot", direction: "desc" };

/**
 * La direzione con cui una colonna si apre al primo click.
 *
 * I numeri partono dal **più alto**, il testo dalla **A**: è quello che ci si
 * aspetta, e una colonna che si aprisse al contrario costringerebbe a due click
 * per vedere la cosa ovvia.
 */
export function initialDirection(key: SortKey): SortDirection {
  return key === "name" || key === "team" || key === "role" ? "asc" : "desc";
}

/** Il click su un'intestazione: stessa colonna → si inverte, altrimenti si apre. */
export function nextSort(current: CentroDatiSort, key: SortKey): CentroDatiSort {
  if (current.key !== key) return { key, direction: initialDirection(key) };
  return {
    key,
    direction: current.direction === "asc" ? "desc" : "asc",
  };
}

export type CentroDatiFilters = {
  query: string;
  /** `null` = tutti i ruoli. */
  role: Role | null;
  /** Solo chi batte rigori o piazzati. */
  onlySetPieces: boolean;
};

export const NO_FILTERS: CentroDatiFilters = {
  query: "",
  role: null,
  onlySetPieces: false,
};

/**
 * Minuscolo e senza segni diacritici: chi cerca «Džeko» scrive «dzeko», e chi
 * cerca «Perišić» non ha la `ć` sulla tastiera.
 */
export function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/**
 * Il valore su cui ordina una colonna, oppure `null` se quella riga non ce l'ha.
 *
 * ⚠ **`titolarita` passa dal gate stagionale, `piazzati` no**, e non è
 * un'incoerenza: la prima è un numero della stagione — e uno dell'anno scorso
 * accanto a uno di quest'anno è un confronto falso — mentre i due rank sono la
 * gerarchia di adesso, pubblicata dalla fonte B. Il perché per esteso sta su
 * `bestSetPieceRank` in `lib/domain.ts`, insieme alla misura che lo giustifica.
 */
function valueOf(row: CentroDatiSortable, key: SortKey): number | string | null {
  switch (key) {
    case "name":
      return row.name;
    case "team":
      return row.team;
    // Il ruolo si ordina P, D, C, A — l'ordine del campo, non l'alfabeto, che
    // metterebbe gli attaccanti per primi e i portieri in mezzo.
    case "role":
      return ROLES.indexOf(row.role);
    case "quot":
      return row.quot;
    case "titolarita": {
      const showable = showableInsights(row.insights);
      return showable === null ? null : quotaTitolare(showable);
    }
    case "piazzati":
      return bestSetPieceRank(row.insights);
  }
}

/**
 * ⚠ Il rank **migliore è il più basso**: «Rigori 1°» conta più di «Rigori 3°».
 * Ordinare quella colonna «dal più alto» deve quindi mettere in cima i primi
 * rigoristi, non i terzi — cioè invertire il segno rispetto a una colonna
 * numerica qualunque. È la riga di questo file che si sbaglia più facilmente.
 */
function isRankLike(key: SortKey): boolean {
  return key === "piazzati";
}

export function hasSetPieces(row: CentroDatiSortable): boolean {
  return bestSetPieceRank(row.insights) !== null;
}

export function matchesFilters(
  row: CentroDatiSortable,
  filters: CentroDatiFilters,
  /** Il testo cercabile della riga, già normalizzato dal chiamante. */
  searchable: string,
): boolean {
  if (filters.role !== null && row.role !== filters.role) return false;
  if (filters.onlySetPieces && !hasSetPieces(row)) return false;

  const needle = fold(filters.query.trim());
  if (needle === "") return true;
  return searchable.includes(needle);
}

/** Il testo su cui cerca la casella di ricerca: nome e squadra. */
export function searchableText(row: CentroDatiSortable): string {
  return `${fold(row.name)} ${fold(row.team)}`;
}

/**
 * Filtra e ordina, in un colpo solo.
 *
 * Non muta l'array in ingresso: `sort` in JavaScript ordina sul posto, e un
 * componente React che riordinasse le proprie prop si troverebbe a rirenderizzare
 * a partire da un dato diverso da quello che il server gli ha mandato.
 */
export function arrangeRows<T extends CentroDatiSortable>(
  rows: T[],
  filters: CentroDatiFilters,
  sort: CentroDatiSort,
  /** I testi cercabili, nello stesso ordine di `rows`: si calcolano una volta. */
  searchable: string[] = rows.map(searchableText),
): T[] {
  const kept = rows.filter((row, index) =>
    matchesFilters(row, filters, searchable[index]),
  );

  const sign = sort.direction === "asc" ? 1 : -1;
  const rankSign = isRankLike(sort.key) ? -1 : 1;

  return kept.sort((a, b) => {
    const left = valueOf(a, sort.key);
    const right = valueOf(b, sort.key);

    // Regola 1: chi non ha il valore va in fondo, in **entrambe** le direzioni.
    if (left === null && right === null) return byName(a, b);
    if (left === null) return 1;
    if (right === null) return -1;

    const compared =
      typeof left === "string" && typeof right === "string"
        ? left.localeCompare(right as string, "it")
        : (left as number) - (right as number);

    // Regola 2: a parità, sempre il nome — altrimenti duecento quotazioni
    // uguali si riordinano a ogni click senza che si capisca perché.
    if (compared === 0) return byName(a, b);
    return compared * sign * rankSign;
  });
}

function byName(a: CentroDatiSortable, b: CentroDatiSortable): number {
  return a.name.localeCompare(b.name, "it");
}
