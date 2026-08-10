/**
 * Il verbale delle rose (M3 §1): chi ha comprato chi, e a quanto.
 *
 * È il gemello di `lib/import/exportListone.ts` — prende righe, restituisce un
 * file — ma sta **fuori** da `lib/import/`, che è la cartella del formato
 * Fantacalcio.it: questo formato non è suo, ce lo siamo scelti noi. E come
 * quello è puro, quindi si collauda senza un Postgres acceso.
 *
 * I due export convivono e non si sovrappongono. Quello del listone serve a
 * **rimettere il risultato su Fantacalcio.it**, e per questo porta tutte e
 * quattordici le colonne e anche i giocatori che nessuno ha comprato. Questo
 * serve a **leggere il risultato**: tre colonne, solo gli assegnati, e un
 * separatore che si vede a occhio.
 *
 * ⚠ Il separatore è la **virgola**, come chiedeva la richiesta. Va saputo che
 * Excel in italiano usa il punto e virgola come separatore di elenco: questo
 * file aperto con un doppio clic finisce in una colonna sola, e va importato
 * dalla procedura guidata. È il prezzo di un formato neutro, ed è una scelta.
 *
 * ⚠ Qui vive anche **l'ordinamento**, e non in un `ORDER BY`. Non è indifferenza
 * al database: è che l'ordine delle righe di un file è una proprietà del file, e
 * tenerla qui la rende collaudabile in millisecondi invece che solo con Postgres
 * acceso. Averla in due posti significherebbe vederla divergere.
 */

export const ROSE_CSV_COLUMNS = [
  "nome_squadra",
  "id_calciatore",
  "crediti_spesi",
] as const;

export type RoseRow = {
  /**
   * Il posto in tavolo di chi possiede il giocatore. Non finisce nel file:
   * serve solo a ordinarlo, così le rose si leggono a blocchi nell'ordine dei
   * turni invece che in quello in cui il database le ha restituite.
   */
  seatIndex: number;
  teamName: string;
  /** La colonna `#` di Fantacalcio.it: il nostro uuid, fuori da qui, non significa niente. */
  extId: number;
  /** Il prezzo pagato per **questo** giocatore, non il totale della squadra. */
  price: number;
};

/**
 * La rete di cui parla M3 §1.
 *
 * La regola di §2 impedisce virgole e virgolette **all'ingresso**, e vale da
 * quel momento in avanti; i nomi salvati prima restano, e un nome squadra non
 * si rinomina. Senza questa rete un'asta iniziata prima della regola
 * produrrebbe un file rotto, e non ci sarebbe modo di aggiustarlo.
 *
 * Vale anche per il carattere che fra un anno ci scorderemo: qui si aggiunge
 * alla classe, e il file resta valido.
 */
function sanitize(teamName: string): string {
  return teamName.replace(/[,"]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Le righe del file, intestazione compresa, prima di diventare testo.
 * Esportata perché è la forma su cui il test guarda i valori senza dover
 * rileggere una stringa — la stessa ragione di `exportRows`.
 */
export function roseCsvRows(rose: RoseRow[]): string[][] {
  const sorted = [...rose].sort(
    (a, b) => a.seatIndex - b.seatIndex || a.extId - b.extId,
  );
  return [
    [...ROSE_CSV_COLUMNS],
    ...sorted.map((r) => [sanitize(r.teamName), String(r.extId), String(r.price)]),
  ];
}

/** Il .csv completo, pronto da scaricare. */
export function buildRoseCsv(rose: RoseRow[]): string {
  return roseCsvRows(rose)
    .map((cells) => cells.join(","))
    .join("\n")
    .concat("\n");
}
