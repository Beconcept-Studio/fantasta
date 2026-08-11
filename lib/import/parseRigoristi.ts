import { type Result, fail, ok } from "@/lib/engine/errors";

/**
 * Il parser della fonte B degli insight: chi batte i rigori e chi i piazzati,
 * da `GET fantacalcio.it/rigoristi-serie-a` (M8 §2).
 *
 * È la parte fragile della macro, perché è **HTML scritto da altri**: non c'è un
 * contratto, e l'unica difesa è fallire forte al primo segno che la pagina non è
 * più quella. Per questo ogni controllo qui sotto è un `fail`, mai uno `scarta la
 * riga e tira avanti`: una lista corta somiglia troppo a una lista giusta.
 *
 * La struttura, verificata il 2026-08-11 su 168 KB di HTML:
 *
 * ```html
 * <span class="team-name">Atalanta</span>
 *   <header class="primary">Rigori</header>
 *   <ol class="pill-list ranked dark">
 *     <li><img src="…/campioncini/21/small/2137.png?v=644" …>
 *         <a class="player-name player-link"
 *            href="https://www.fantacalcio.it/serie-a/squadre/atalanta/scamacca/2137">…
 *   <header>Calci piazzati</header>
 *   <ol …> … </ol>
 * ```
 *
 * ⚠ **Due liste, non tre.** Le uniche intestazioni sono «Rigori» e «Calci
 * piazzati»: la parola «Punizioni» non compare nell'HTML, e i corner non hanno una
 * lista propria. La prima stesura della spec prevedeva tre gerarchie; il collaudo
 * l'ha corretta.
 *
 * ⚠ **L'`ext_id` si legge dall'`href`, non dal `src` della figurina.** Non è un
 * gusto: i campioncini sulla pagina sono **92**, i giocatori designati **87** —
 * cinque arrivano da altri moduli della pagina — e spazzolando tutta la pagina si
 * importerebbero cinque rigoristi che non lo sono. Il link giocatore invece
 * esiste in tutte e due le liste, mentre `data-id` c'è solo su alcune `<li>`.
 */

export type SetPieceKind = "RIGORI" | "PIAZZATI";

export type ParsedSetPiece = {
  team: string;
  kind: SetPieceKind;
  extId: number;
  /** `1` = primo della gerarchia. La posizione nella lista, non un punteggio. */
  rank: number;
};

/** Le venti squadre di Serie A: un numero che non cambia, e quindi si controlla. */
const SQUADRE = 20;

/** Le intestazioni delle due liste, così come la pagina le scrive. */
const KIND_BY_HEADER: Record<string, SetPieceKind> = {
  Rigori: "RIGORI",
  "Calci piazzati": "PIAZZATI",
};

const TEAM_MARKER = /<span class="team-name">([^<]+)<\/span>/g;
/** Un'intestazione seguita dalla sua lista ordinata, dentro un blocco squadra. */
const LIST_BLOCK = /<header[^>]*>([^<]+)<\/header>\s*<ol[^>]*>([\s\S]*?)<\/ol>/g;
/** La coda numerica del link al giocatore: `…/squadre/atalanta/scamacca/2137`. */
const PLAYER_LINK = /href="[^"]*\/serie-a\/squadre\/[^"/]+\/[^"/]+\/(\d+)"/g;

export function parseRigoristi(html: string): Result<ParsedSetPiece[]> {
  if (typeof html !== "string" || html.trim() === "") {
    return fail("SOURCE_UNREACHABLE", "La fonte dei rigoristi ha risposto vuoto.");
  }

  // I confini dei blocchi squadra: da un `team-name` al successivo. Tagliare qui
  // è ciò che tiene fuori il resto della pagina — sidebar, contenuti correlati e
  // le loro figurine.
  const markers = [...html.matchAll(TEAM_MARKER)];
  if (markers.length !== SQUADRE) {
    return fail(
      "SOURCE_SCHEMA",
      `Nella pagina dei rigoristi ho trovato ${markers.length} squadre invece di ${SQUADRE}: la struttura è cambiata.`,
    );
  }

  const rows: ParsedSetPiece[] = [];

  for (const [index, marker] of markers.entries()) {
    const team = marker[1].trim();
    const start = marker.index + marker[0].length;
    const end = index + 1 < markers.length ? markers[index + 1].index : html.length;
    const block = html.slice(start, end);

    const found = new Set<SetPieceKind>();

    for (const list of block.matchAll(LIST_BLOCK)) {
      const kind = KIND_BY_HEADER[list[1].trim()];
      // Un'intestazione che non conosciamo non è un errore: la pagina ha anche
      // liste che non c'entrano. È l'*assenza* delle due che ci servono a esserlo.
      if (!kind || found.has(kind)) continue;
      found.add(kind);

      const ids = [...list[2].matchAll(PLAYER_LINK)].map((m) => Number(m[1]));
      if (ids.length === 0) {
        return fail(
          "SOURCE_SCHEMA",
          `La lista "${list[1].trim()}" del ${team} non contiene nessun link a un giocatore: la struttura è cambiata.`,
        );
      }

      ids.forEach((extId, position) => {
        rows.push({ team, kind, extId, rank: position + 1 });
      });
    }

    if (!found.has("RIGORI")) {
      return fail(
        "SOURCE_SCHEMA",
        `Per il ${team} non ho trovato la lista dei rigoristi: la struttura è cambiata.`,
      );
    }
  }

  return ok(rows);
}

/**
 * I due rank per `ext_id`, che è la forma in cui servono al database: una riga
 * per giocatore, non una per lista.
 *
 * ⚠ Tiene il **primo** posizionamento visto per ogni coppia (giocatore, lista).
 * Nella pagina non capita, ma se un giorno un nome comparisse due volte nella
 * stessa lista, il rank giusto è il migliore — quello che il lettore vede in cima.
 */
export function setPiecesByExtId(
  rows: ParsedSetPiece[],
): Map<number, { rigoristaRank: number | null; piazzatiRank: number | null }> {
  const out = new Map<
    number,
    { rigoristaRank: number | null; piazzatiRank: number | null }
  >();

  for (const row of rows) {
    const current =
      out.get(row.extId) ?? { rigoristaRank: null, piazzatiRank: null };
    if (row.kind === "RIGORI") {
      if (current.rigoristaRank === null || row.rank < current.rigoristaRank) {
        current.rigoristaRank = row.rank;
      }
    } else if (current.piazzatiRank === null || row.rank < current.piazzatiRank) {
      current.piazzatiRank = row.rank;
    }
    out.set(row.extId, current);
  }

  return out;
}
