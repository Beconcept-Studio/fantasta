import { type Result, fail, ok } from "@/lib/engine/errors";

/**
 * Il parser della fonte A degli insight: `GET api.fantalab.it/v2/listone` (M8 §2).
 *
 * È una funzione pura come `parseListone.ts` — bytes in, righe o errore fuori —
 * e per la stessa ragione: la `fetch` sta in `lib/engine/insights.ts`, così
 * questo file si prova sulla risposta salvata in `fixtures/` senza toccare la
 * rete. Non conserva niente del corpo oltre alle colonne mappate (P6).
 *
 * La risposta, verificata il 2026-08-11 su 507 KB di JSON:
 *
 * ```json
 * { "version": "v656346f73db3", "season": "s_2025_2026", "count": 497,
 *   "players": [ { "fantacalcio_id": 6021, "starts_eleven": 30, … } ] }
 * ```
 *
 * ⚠ **Perché valida l'envelope prima di guardare le righe.** La fonte è pubblica
 * e non ha nessun impegno verso di noi: il giorno che cambia forma, `count`
 * diverso da `players.length` è il primo sintomo, e costa una riga accorgersene.
 * L'alternativa è scrivere 497 righe di `null` sopra dati buoni e scoprirlo la
 * sera dell'asta.
 *
 * ⚠ **E perché legge `display_presenze` invece di `presenze`.** Sono lo stesso
 * numero in 465 righe su 497 e differiscono in 32, tutte con
 * `display_stats_season: "previous"`, in entrambe le direzioni (Adzic 4→1,
 * Carboni F. 2→10). I `display_*` sono ciò che la fonte stessa mostra all'utente:
 * fra i due, quello che è già stato scelto da chi ha i dati.
 */

/** Una riga di insight, nella forma in cui va nel database. */
export type ParsedInsight = {
  extId: number;
  fantalabId: string | null;
  fullName: string | null;
  /**
   * Il nome **corto** (`name`): «Abankwah», dove `full_name` scrive «James
   * Abankwah». Aggiunto in M10B §5: non serve a nessun join — quello di Carmy
   * passa da `listone_players` — ma è ciò che permette di capire perché un nome
   * non ha agganciato senza riaprire a mano la risposta della fonte.
   */
  name: string | null;
  team: string;
  /** `"current"` o `"previous"`, da `display_stats_season`. */
  statsSeason: string;
  presenze: number;
  startsEleven: number;
  minPlayingTime: number;
  rigoriFatti: number;
  rigoriSbagliati: number;
  rigoriParati: number;
  fmvHome: number | null;
  fmvAway: number | null;
  /**
   * Gol e assist della stagione dichiarata da `statsSeason` (M21 §3).
   *
   * ⚠ **Erano già nella risposta e il parser si fermava prima**: la spec di M21
   * lo dava per fatto — «li abbiamo e non li mostriamo» — e non era vero. Sono
   * `gol_fatti` e `assist` nel corpo della fonte, misurati su tutte e 497 le
   * righe della risposta salvata: 288 giocatori con almeno un gol, 263 con
   * almeno un assist, massimo 17 per entrambi.
   *
   * ⚠ **Contatori come `rigoriFatti`, quindi `0` e non `null` quando mancano.**
   * Qui lo zero *è* un'informazione — non ha segnato — al contrario di
   * `fmv_home`, dove lo zero significa «nessuna media» e diventa `null`.
   *
   * ⚠ **Nessun `display_gol_fatti` nella fonte**, al contrario delle presenze:
   * verificato sulle chiavi della risposta, e per questo non c'è la scelta fra
   * due numeri che `presenze` ha dovuto fare.
   */
  golFatti: number;
  assist: number;
};

export type ParsedListone = {
  /** La stagione dichiarata dall'envelope: finisce nel pannello, non nel calcolo. */
  season: string | null;
  rows: ParsedInsight[];
};

/** Le stagioni che la fonte sa dire. Un terzo valore è un cambio di forma. */
const STATS_SEASONS = ["current", "previous"] as const;

function asInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  return null;
}

/** Un intero, oppure `0`: i contatori assenti valgono zero, non `null`. */
function counter(value: unknown): number {
  return asInteger(value) ?? 0;
}

/**
 * Un decimale, oppure `null`. **Lo zero diventa `null` di proposito**: nella
 * fonte `fmv_home` vale `0` per i 141 giocatori senza media, e uno zero salvato
 * come numero si legge a schermo come «media 0.00», che è una bugia. `fmv_subin`
 * invece è `0` per **tutti** e 497, e per questo non esiste nemmeno come colonna.
 */
function decimalOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value === 0 ? null : value;
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" ? null : text;
}

export function parseFantalabListone(
  body: ArrayBuffer | Uint8Array | string,
): Result<ParsedListone> {
  const text =
    typeof body === "string" ? body : new TextDecoder().decode(body as Uint8Array);

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return fail(
      "SOURCE_UNREACHABLE",
      "La fonte non ha risposto con un JSON: probabilmente è una pagina di errore o di manutenzione.",
    );
  }

  if (typeof payload !== "object" || payload === null) {
    return fail("SOURCE_SCHEMA", "La risposta della fonte non è un oggetto.");
  }

  const envelope = payload as Record<string, unknown>;
  const players = envelope.players;

  if (!Array.isArray(players)) {
    return fail(
      "SOURCE_SCHEMA",
      "Nella risposta manca l'elenco `players`: la fonte ha cambiato forma.",
    );
  }

  if (players.length === 0) {
    return fail("SOURCE_SCHEMA", "La fonte ha risposto con zero giocatori.");
  }

  const declared = asInteger(envelope.count);
  if (declared !== null && declared !== players.length) {
    return fail(
      "SOURCE_SCHEMA",
      `La fonte dichiara ${declared} giocatori ma ne manda ${players.length}: risposta troncata o incoerente.`,
    );
  }

  const rows: ParsedInsight[] = [];
  const seen = new Set<number>();

  for (const [index, raw] of players.entries()) {
    if (typeof raw !== "object" || raw === null) {
      return fail(
        "SOURCE_SCHEMA",
        `La riga ${index + 1} della fonte non è un oggetto.`,
      );
    }
    const row = raw as Record<string, unknown>;

    const extId = asInteger(row.fantacalcio_id);
    if (extId === null) {
      return fail(
        "SOURCE_SCHEMA",
        `La riga ${index + 1} non ha un \`fantacalcio_id\`: senza quello non c'è nessun aggancio possibile al listone.`,
      );
    }
    if (seen.has(extId)) {
      return fail(
        "SOURCE_SCHEMA",
        `L'identificativo ${extId} compare due volte nella risposta della fonte.`,
      );
    }
    seen.add(extId);

    const team = asText(row.team_name);
    if (team === null) {
      return fail(
        "SOURCE_SCHEMA",
        `Il giocatore ${extId} non ha una squadra: la fonte ha cambiato forma.`,
      );
    }

    const statsSeason = asText(row.display_stats_season);
    if (
      statsSeason === null ||
      !(STATS_SEASONS as readonly string[]).includes(statsSeason)
    ) {
      return fail(
        "SOURCE_SCHEMA",
        `Il giocatore ${extId} dichiara la stagione "${statsSeason ?? "assente"}", che non conosco (attese: ${STATS_SEASONS.join(", ")}).`,
      );
    }

    rows.push({
      extId,
      fantalabId: asText(row.player_id),
      fullName: asText(row.full_name) ?? asText(row.name),
      name: asText(row.name),
      team,
      statsSeason,
      // `display_presenze`, non `presenze`: vedi il commento in testa al file.
      presenze: counter(row.display_presenze),
      startsEleven: counter(row.starts_eleven),
      minPlayingTime: counter(row.min_playing_time),
      rigoriFatti: counter(row.rigori_fatti),
      rigoriSbagliati: counter(row.rigori_sbagliati),
      rigoriParati: counter(row.rigori_parati),
      fmvHome: decimalOrNull(row.fmv_home),
      fmvAway: decimalOrNull(row.fmv_away),
      golFatti: counter(row.gol_fatti),
      assist: counter(row.assist),
    });
  }

  return ok({ season: asText(envelope.season), rows });
}
