import fs from "node:fs/promises";
import path from "node:path";

import {
  campioncinoFileName,
  campionciniDir,
  extIdFromFileName,
} from "@/lib/campioncini";

/**
 * `GET /api/campioncini/<extId>.png` — l'archivio delle figurine, servito
 * dall'applicazione (M7 §3).
 *
 * ⚠ **La difesa di questa rotta è una sola, e sta nella prima riga del corpo.**
 * Il parametro è un pezzo di URL scritto da chi sta dall'altra parte, e con
 * quello si costruisce un percorso su disco: `..%2f..%2f.env.png` non deve
 * nemmeno arrivare al filesystem. La regola per non sbagliare non è
 * «sanificare la stringa» ma **non usarla affatto**: da `extIdFromFileName`
 * esce un intero o `null`, e il nome del file lo costruisce
 * `campioncinoFileName()` da quell'intero. La stringa che è arrivata da fuori
 * non tocca mai `path.join`, e quindi non c'è nessuna sanificazione da fare
 * bene — non c'è proprio niente da sanificare.
 *
 * È l'equivalente per M7 di ciò che in M6 era la guardia in cima a ogni server
 * action: la cosa meno ovvia della macro, e quella che fa danno se la si
 * semplifica. Il test sta in `tests/campioncini.test.ts` ed è stato scritto
 * prima di questo file.
 *
 * **Un `400` e non un `404`** per l'ingresso malevolo, e la differenza è
 * l'evidenza che il test cerca: `400` vuol dire rifiutato dal validatore, cioè
 * prima che esistesse un percorso da cercare. Un `404` significherebbe che il
 * percorso è stato costruito e il disco interrogato.
 *
 * **Nessuna sessione**, di proposito: la vista TV è un browser senza login, e il
 * giocatore in asta è pubblico per definizione — è la busta a essere segreta.
 * Mostrarne il volto non si avvicina nemmeno a I8.
 *
 * `ETag` da dimensione e mtime, cache di un giorno: durante una serata ogni
 * browser scarica ogni figurina una volta sola. Se un giorno servisse più
 * velocità, un `location /api/campioncini/` in nginx con un `alias` sulla
 * cartella la servirebbe senza passare da Node, **allo stesso URL e senza
 * toccare l'applicazione**.
 */

/** Un giorno. Le figurine di un'edizione non cambiano mai entro la serata. */
const MAX_AGE_SECONDS = 86_400;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await params;

  const extId = extIdFromFileName(file);
  if (extId === null) {
    return new Response("Non è l'identificativo di un giocatore.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // ⚠ Da qui in giù `file` non si usa più: il percorso esce dall'intero.
  const target = path.join(campionciniDir(), campioncinoFileName(extId));

  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    // L'archivio nasce vuoto in produzione, e finché nessuno preme il pulsante
    // la cartella non esiste affatto. Non è un guasto: è un `404`, e il
    // riquadro del lotto si nasconde da sé (`onError`).
    return new Response(null, { status: 404 });
  }
  if (!stat.isFile()) return new Response(null, { status: 404 });

  const etag = `"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
  const headers = {
    "Content-Type": "image/png",
    "Cache-Control": `public, max-age=${MAX_AGE_SECONDS}`,
    ETag: etag,
  };

  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(await fs.readFile(target), { headers });
}
