import fs from "node:fs/promises";
import path from "node:path";

/**
 * Le figurine dei calciatori (M7): l'URL, l'archivio su disco, lo scaricamento.
 *
 * ⚠ **Questo file è piccolo perché il downloader è stato provato prima di essere
 * specificato**, ed è la cosa da ricordare leggendolo. Sui 495 id di un listone
 * vero: 495 su 495 scaricate, 51,56 MB in **7,3 secondi**, zero errori, zero
 * `403`. La prima versione della spec era costruita attorno a un'operazione
 * lunga — lotti da venticinque, la lista degli id parcheggiata in un file, la
 * pagina che si richiamava da sé, un pulsante «Ferma», una condizione di
 * terminazione per il caso «nessun progresso». Sette secondi hanno tolto tutta
 * quell'impalcatura. Se un giorno qui dentro compare un singleton su
 * `globalThis`, una tabella di avanzamento o un file di stato, è quel lavoro che
 * sta rientrando dalla finestra: rileggere `docs/features/07-caricature.md` §1.
 *
 * **Lo stato è il disco.** «Questa figurina ce l'abbiamo?» lo risponde un file
 * che c'è o non c'è — nessuna tabella, nessuna colonna, nessun `pnpm db:push`.
 * È anche ciò che rende l'operazione ripetibile per costruzione: la si può dare
 * due volte, e la seconda non scarica niente.
 *
 * Il file è in due metà, e la divisione è quella che permette al test di non
 * toccare né la rete né una cartella vera: **sopra** ciò che è puro (l'URL da id
 * ed edizione, il nome del file, la validazione dell'id), **sotto** ciò che
 * tocca il mondo, con `fetch`, cartella e orologio iniettabili.
 */

// ─── La parte pura ───────────────────────────────────────────────────────────

/**
 * L'edizione di default, cioè l'unica parte dell'URL che invecchia.
 *
 * Oggi è la `21`: `20` risponde ancora, `22` no — è la stagione, e ad agosto
 * prossimo cambierà. Sta qui come default perché una variabile d'ambiente
 * assente non deve rompere niente in silenzio; una variabile *sbagliata* invece
 * si vede subito, perché non si scarica più nessuna figurina.
 */
export const DEFAULT_EDITION = "21";

/**
 * Il formato `card`, 255×378: la caricatura dentro la carta con lo scudetto e il
 * ruolo. Esistono anche `medium` (120×160) e `small` (60×80) — la caricatura
 * sola su fondo trasparente — e **non si scaricano**: un formato solo vuol dire
 * un file per giocatore, un URL, un solo caso «manca», e la `card` sta bene su
 * tutti e due gli schermi che la mostrano.
 *
 * Il `?v=644` che si vede negli URL del sito è un anti-cache e si omette.
 */
export function campioncinoUrl(extId: number, edition: string): string {
  return `https://content.fantacalcio.it/web/campioncini/${edition}/card/${extId}.png`;
}

/**
 * Nel nome del file c'è **solo l'id**, mai il nome del giocatore: «Martinez L.»
 * scritto in un altro modo alla prossima edizione renderebbe orfano il file.
 */
export function campioncinoFileName(extId: number): string {
  return `${extId}.png`;
}

/**
 * Il limite superiore dell'id. Gli id veri del listone stanno sotto i sei cifre;
 * il tetto serve a un'altra cosa — a fermare `99999999999999999999.png`, che
 * passa la regex e diventa un `Number` non più intero.
 */
const MAX_EXT_ID = 9_999_999;

/**
 * L'unico modo in cui un id può arrivare da fuori: `^\d+\.png$` e nient'altro.
 *
 * ⚠ **È la difesa di questa macro, e ne basta una sola.** La rotta che serve le
 * immagini prende un pezzo di URL scritto da chi sta dall'altra parte, e con
 * quello costruisce un percorso su disco: `..%2f..%2f.env.png` non deve nemmeno
 * arrivare al filesystem. La regola per non sbagliare non è «sanificare la
 * stringa» ma **non usarla affatto**: qui esce un intero, e il percorso lo
 * costruisce `campioncinoFileName()` da quell'intero. Una stringa che arriva da
 * fuori non tocca mai `path.join`.
 *
 * `\d` in JavaScript è ASCII, e `$` senza il flag `m` è davvero la fine della
 * stringa — un `1.png\n` non passa. Sono due dettagli su cui il test insiste
 * perché in altri linguaggi vanno diversamente.
 */
export function extIdFromFileName(fileName: string): number | null {
  if (!/^\d+\.png$/.test(fileName)) return null;
  const extId = Number(fileName.slice(0, -".png".length));
  if (!Number.isSafeInteger(extId) || extId <= 0 || extId > MAX_EXT_ID) {
    return null;
  }
  return extId;
}

/**
 * La firma di un PNG. Un `200` che non è un PNG è una pagina di errore del CDN
 * travestita: salvarla come `<id>.png` vorrebbe dire un'immagine rotta per
 * sempre, perché «ce l'abbiamo» è «il file c'è» e nessuno riproverebbe più.
 */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function looksLikePng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_MAGIC.length) return false;
  return PNG_MAGIC.every((byte, i) => bytes[i] === byte);
}

// ─── Il mondo: l'archivio ────────────────────────────────────────────────────

/**
 * La radice dei file che l'applicazione scrive.
 *
 * ⚠ **`storage/` e non `public/`**, e la ragione è una trappola vera: in
 * produzione il server standalone fa `process.chdir(__dirname)`, quindi la sua
 * `public/` è `.next/standalone/public` — e `deploy/deploy.sh` fa
 * `rm -rf .next/standalone/public` prima di ricopiarla. Tutto ciò che
 * l'applicazione scrivesse là dentro **lo cancellerebbe il deploy successivo,
 * senza dire niente**. `storage/` invece non la sfiora nessuno: `git reset
 * --hard` non rimuove i file non tracciati e `pnpm build` non ci entra, quindi
 * l'archivio sopravvive a ogni rilascio e anche a un rollback a un tag.
 *
 * In produzione il percorso lo calcola `deploy/ecosystem.config.cjs` da `ROOT` e
 * lo passa come `MEDIA_DIR`, così non c'è nessun percorso da mettere a mano. In
 * sviluppo il default è `<cwd>/storage`, che sotto `pnpm dev` è la radice del
 * progetto — sotto `.next/standalone` no, ed è esattamente perché là la cwd è
 * un'altra che in produzione la variabile si passa invece di indovinarla.
 */
export function mediaDir(): string {
  const configured = process.env.MEDIA_DIR?.trim();
  return configured ? configured : path.join(process.cwd(), "storage");
}

export function campionciniDir(): string {
  return path.join(mediaDir(), "campioncini");
}

/** L'edizione da usare: `CAMPIONCINI_EDITION`, o il default se non c'è. */
export function campioncinoEdition(): string {
  const configured = process.env.CAMPIONCINI_EDITION?.trim();
  return configured ? configured : DEFAULT_EDITION;
}

/**
 * Gli id già sul disco. Una cartella che non esiste è un archivio vuoto, non un
 * errore: in produzione l'archivio nasce così, e l'applicazione deve funzionare
 * esattamente come prima finché qualcuno non preme il pulsante.
 *
 * Passa da `extIdFromFileName` come tutto il resto, quindi un `.tmp` rimasto per
 * terra da un processo morto a metà non conta e non si vede.
 */
export async function archivedExtIds(dir: string): Promise<Set<number>> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return new Set();
  }
  const ids = new Set<number>();
  for (const name of names) {
    const extId = extIdFromFileName(name);
    if (extId !== null) ids.add(extId);
  }
  return ids;
}

/** Quante figurine ci sono nell'archivio. È il numero in cima alla pagina. */
export async function countArchive(dir: string): Promise<number> {
  return (await archivedExtIds(dir)).size;
}

// ─── Il mondo: lo scaricamento ───────────────────────────────────────────────

/** Quattro richieste in parallelo: è la concorrenza con cui è stato misurato. */
const CONCURRENCY = 4;

/** Dieci secondi per richiesta. La peggiore misurata è stata 234 millisecondi. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Venti secondi per l'intera passata, e non è pessimismo gratuito: `location /`
 * in `deploy/nginx-asta.conf` non imposta `proxy_read_timeout`, quindi vale il
 * default di **60 secondi** (il timeout lungo di un'ora è solo sulla rotta dello
 * stream). Con sette secondi misurati il margine è di tre volte; se un giorno il
 * CDN fosse dieci volte più lento, la passata si ferma qui e dice quante ne
 * restano. Si ripreme il pulsante e riprende — il campo del file non si è
 * svuotato, perché una server action non ricarica la pagina.
 *
 * **Tre righe, non un sottosistema**: è ciò che resta del batching dopo il
 * collaudo.
 */
const BUDGET_MS = 20_000;

export type CampionciniRun = {
  /** Scaricate e scritte adesso. */
  downloaded: number;
  /** Erano già sul disco: la passata non le ha nemmeno chieste. */
  alreadyThere: number;
  /**
   * Id per cui il CDN ha risposto «non è un giocatore» (`403`).
   *
   * ⚠ Non c'entrano niente con le **sagome senza volto**: a chi non ha la
   * caricatura quel CDN non risponde «non ce l'ho», restituisce una sagoma con
   * la maglia del suo club — 144 su 495 nel listone di prova — e quelle si
   * scaricano regolarmente, sono dei `200`. Per un listone vero questo numero
   * dovrebbe essere zero.
   */
  withoutImage: number;
  /** Errori di rete, timeout, risposte che non erano PNG. */
  failed: number;
  /** Non tentate perché è scaduto il tempo. Si ripreme, e riprendono da qui. */
  remaining: number;
  /** La passata si è fermata sulla scadenza invece di finire. */
  expired: boolean;
};

type Attempt = "saved" | "absent" | "failed";

async function fetchOne(
  extId: number,
  edition: string,
  dir: string,
  doFetch: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await doFetch(campioncinoUrl(extId, edition), {
      signal: controller.signal,
    });
    // `403` per un id che non è un giocatore (provato con `1` e `99999`); `404`
    // non l'abbiamo mai visto, ma vuol dire la stessa cosa e non è un guasto.
    if (response.status === 403 || response.status === 404) return "absent";
    if (!response.ok) return "failed";

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!looksLikePng(bytes)) return "failed";

    // Scrittura e poi `rename`: il rinomino è atomico, quindi un file che porta
    // il nome di un id **è completo**. Senza, un processo interrotto a metà
    // scrittura lascerebbe un'immagine troncata che nessuno riproverebbe più,
    // perché per noi «ce l'abbiamo» significa «il file c'è».
    const destination = path.join(dir, campioncinoFileName(extId));
    const temporary = `${destination}.tmp`;
    await fs.writeFile(temporary, bytes);
    await fs.rename(temporary, destination);
    return "saved";
  } catch {
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}

export type DownloadOptions = {
  /** Gli id del listone di riferimento. I duplicati non fanno danno. */
  extIds: number[];
  /** La cartella dell'archivio. Iniettabile perché il test non tocchi la vera. */
  dir: string;
  edition?: string;
  /** Iniettabile perché il test non tocchi la rete. */
  fetch?: typeof globalThis.fetch;
  /** Iniettabile per la stessa ragione dell'orologio del motore. */
  now?: () => number;
  budgetMs?: number;
  requestTimeoutMs?: number;
  concurrency?: number;
};

/**
 * Una passata: scarica ciò che manca, si ferma alla scadenza, restituisce i
 * numeri. Non c'è nient'altro — nessun lavoro in background, nessuna coda,
 * nessuno stato che sopravviva alla richiesta.
 */
export async function downloadCampioncini(
  options: DownloadOptions,
): Promise<CampionciniRun> {
  const {
    extIds,
    dir,
    edition = campioncinoEdition(),
    fetch: doFetch = globalThis.fetch,
    now = Date.now,
    budgetMs = BUDGET_MS,
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
    concurrency = CONCURRENCY,
  } = options;

  await fs.mkdir(dir, { recursive: true });

  const present = await archivedExtIds(dir);
  const wanted = [...new Set(extIds)];
  const queue = wanted.filter((extId) => !present.has(extId));
  const alreadyThere = wanted.length - queue.length;

  const deadline = now() + budgetMs;
  const run = { downloaded: 0, withoutImage: 0, failed: 0 };
  let next = 0;
  let expired = false;

  async function worker(): Promise<void> {
    for (;;) {
      // La scadenza si guarda **prima** di prendere il prossimo id: quella già
      // presa la si finisce, così non restano richieste a metà.
      if (now() >= deadline) {
        if (next < queue.length) expired = true;
        return;
      }
      const index = next++;
      if (index >= queue.length) return;

      const outcome = await fetchOne(
        queue[index],
        edition,
        dir,
        doFetch,
        requestTimeoutMs,
      );
      if (outcome === "saved") run.downloaded += 1;
      else if (outcome === "absent") run.withoutImage += 1;
      else run.failed += 1;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, worker),
  );

  const attempted = run.downloaded + run.withoutImage + run.failed;
  return {
    ...run,
    alreadyThere,
    remaining: queue.length - attempted,
    expired,
  };
}
