import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M7 — le figurine dei calciatori.
 *
 * ⚠ **Il primo blocco di questo file è stato scritto prima della rotta**, ed è
 * l'ordine giusto: la rotta prende un pezzo di URL scritto da chi sta
 * dall'altra parte e con quello costruisce un percorso su disco. È l'unica cosa
 * di questa macro che fa danno se la si semplifica, quindi è la prima cosa che
 * si prova.
 *
 * La difesa non è «sanificare la stringa»: è **non usarla affatto**. Il
 * parametro passa da `extIdFromFileName`, che restituisce un intero o `null`, e
 * il percorso lo costruisce `campioncinoFileName()` da quell'intero. Una stringa
 * che arriva da fuori non tocca mai `path.join`.
 *
 * Il resto del file collauda ciò che il collaudo del 2026-08-11 aveva già
 * misurato a mano: `200` salva, `403` no, il timeout no, la scadenza ferma la
 * passata e dice quante ne restano, e ripetere non riscarica niente. Né la rete
 * né la cartella vera vengono toccate: `fetch`, cartella e orologio sono
 * iniettabili apposta.
 */

let dir: string;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "campioncini-"));
  dir = path.join(root, "campioncini");
  await fs.mkdir(dir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

// ─── La difesa: il parametro è un intero, o non è niente ─────────────────────

describe("extIdFromFileName — la sola difesa che la rotta deve avere", () => {
  it("accetta un id vero e restituisce un numero, non una stringa", async () => {
    const { extIdFromFileName } = await import("@/lib/campioncini");

    expect(extIdFromFileName("2764.png")).toBe(2764);
    expect(typeof extIdFromFileName("2764.png")).toBe("number");
  });

  /**
   * Gli ingressi malevoli della verifica 2, più quelli che in altri linguaggi
   * passerebbero: in JavaScript `\d` è ASCII e `$` senza il flag `m` è davvero
   * la fine della stringa — due dettagli su cui conviene avere un test invece
   * che una convinzione.
   */
  it.each([
    ["../../.env.png", "la risalita, in chiaro"],
    ["..%2f..%2f.env.png", "la risalita, percent-encoded"],
    ["../2764.png", "una risalita di un solo livello"],
    ["/etc/passwd.png", "un percorso assoluto"],
    ["abc.png", "un id che non è un numero"],
    ["2764.png.txt", "un'estensione appiccicata dopo"],
    ["2764.PNG", "l'estensione in maiuscolo"],
    ["2764", "l'estensione che manca"],
    ["2764.png\n", "una riga nuova in coda ($ non è multilinea in JS)"],
    ["٢٧٦٤.png", "cifre non ASCII (\\d in JS è ASCII)"],
    ["2 764.png", "uno spazio in mezzo"],
    ["-1.png", "un id negativo"],
    ["0.png", "lo zero, che non è un giocatore"],
    ["2764.5.png", "un id con la virgola"],
    ["99999999999999999999999999999999999999999999999999.png", "cinquanta cifre"],
    ["", "la stringa vuota"],
  ])("rifiuta %j — %s", async (malicious) => {
    const { extIdFromFileName } = await import("@/lib/campioncini");
    expect(extIdFromFileName(malicious)).toBeNull();
  });
});

// ─── La rotta ────────────────────────────────────────────────────────────────

async function get(file: string): Promise<Response> {
  const { GET } = await import("@/app/api/campioncini/[file]/route");
  return GET(new Request(`http://localhost/api/campioncini/${file}`), {
    params: Promise.resolve({ file }),
  });
}

/** Un PNG minimo ma vero: la firma, che è ciò che il downloader controlla. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

describe("GET /api/campioncini/<extId>.png", () => {
  beforeEach(() => {
    process.env.MEDIA_DIR = root;
  });

  afterEach(() => {
    delete process.env.MEDIA_DIR;
  });

  /**
   * ⚠ **Il `400` qui vale più di un `404`**, ed è per questo che il test guarda
   * lo stato e non solo il corpo: `400` vuol dire che il parametro è stato
   * rifiutato dal validatore, cioè **prima** che esistesse un percorso da
   * cercare. Un `404` significherebbe che il percorso è stato costruito e il
   * filesystem interrogato — che è esattamente ciò che non deve succedere.
   */
  it.each([
    "../../.env.png",
    "..%2f..%2f.env.png",
    "../segreto.png",
    "abc.png",
    "2764.png.txt",
    "99999999999999999999999999999999999999999999999999.png",
  ])("rifiuta %j con 400, senza arrivare al filesystem", async (malicious) => {
    // Il bersaglio esiste davvero, un livello sopra l'archivio: se la rotta
    // costruisse il percorso concatenando, questo file uscirebbe.
    await fs.writeFile(path.join(root, "segreto.png"), "una password");
    await fs.writeFile(path.join(root, ".env.png"), "AUTH_SECRET=vero");

    const response = await get(malicious);

    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("AUTH_SECRET");
  });

  it("un id ben formato che non c'è è un 404, non un 400", async () => {
    const response = await get("404404.png");
    expect(response.status).toBe(404);
  });

  it("serve il file, con il tipo giusto e la cache di un giorno", async () => {
    await fs.writeFile(path.join(dir, "2764.png"), PNG);

    const response = await get("2764.png");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toContain("86400");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });

  /**
   * L'`ETag` è ciò che rende gratuita la seconda serata: dodici telefoni che
   * riaprono il portale non riscaricano 118 KB a figurina.
   */
  it("con l'ETag giusto risponde 304 e non rimanda i byte", async () => {
    await fs.writeFile(path.join(dir, "2764.png"), PNG);

    const first = await get("2764.png");
    const etag = first.headers.get("ETag");
    expect(etag).toBeTruthy();

    const { GET } = await import("@/app/api/campioncini/[file]/route");
    const second = await GET(
      new Request("http://localhost/api/campioncini/2764.png", {
        headers: { "If-None-Match": etag! },
      }),
      { params: Promise.resolve({ file: "2764.png" }) },
    );

    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
  });

  /**
   * L'archivio nasce vuoto in produzione, e la cartella non esiste affatto
   * finché nessuno preme il pulsante. Non è un errore: è un `404`, e
   * l'applicazione funziona esattamente come prima.
   */
  it("con l'archivio che non esiste risponde 404, non 500", async () => {
    process.env.MEDIA_DIR = path.join(root, "cartella-che-non-c-e");
    const response = await get("2764.png");
    expect(response.status).toBe(404);
  });
});

// ─── Lo scaricamento ─────────────────────────────────────────────────────────

function png(): Response {
  return new Response(PNG, { status: 200 });
}

/** Cosa c'è nell'archivio, per nome: il modo più diretto di dire «salvata». */
async function saved(): Promise<string[]> {
  return (await fs.readdir(dir)).sort();
}

describe("downloadCampioncini — una passata", () => {
  it("un 200 salva, e il nome del file è solo l'id", async () => {
    const { downloadCampioncini } = await import("@/lib/campioncini");

    const run = await downloadCampioncini({
      extIds: [2764, 494],
      dir,
      fetch: async () => png(),
    });

    expect(run.downloaded).toBe(2);
    expect(run.failed).toBe(0);
    expect(await saved()).toEqual(["2764.png", "494.png"]);
  });

  it("l'URL si costruisce da id ed edizione, e il formato è la card", async () => {
    const { downloadCampioncini } = await import("@/lib/campioncini");
    const asked: string[] = [];

    await downloadCampioncini({
      extIds: [2764],
      dir,
      edition: "22",
      fetch: async (url) => {
        asked.push(String(url));
        return png();
      },
    });

    expect(asked).toEqual([
      "https://content.fantacalcio.it/web/campioncini/22/card/2764.png",
    ]);
    // ⚠ Nessun `?v=`, e nessun `medium` né `small`: un formato solo (§2).
    expect(asked[0]).not.toContain("?");
  });

  /**
   * ⚠ Il `403` è l'id che **non è un giocatore** (provato con `1` e `99999`).
   * Non è la sagoma senza volto: quella è un `200` come tutti gli altri e si
   * salva regolarmente — vedi il test qui sotto.
   */
  it("un 403 non salva niente, e finisce nel suo contatore", async () => {
    const { downloadCampioncini } = await import("@/lib/campioncini");

    const run = await downloadCampioncini({
      extIds: [1, 99999],
      dir,
      fetch: async () => new Response(null, { status: 403 }),
    });

    expect(run.withoutImage).toBe(2);
    expect(run.downloaded).toBe(0);
    expect(run.failed).toBe(0);
    expect(await saved()).toEqual([]);
  });

  /**
   * §5 — le 144 sagome su 495 si salvano e si mostrano come tutte le altre. Un
   * `200` è un `200`: qui non c'è nessun riconoscimento da fare, ed è il punto.
   */
  it("una sagoma senza volto è un 200, quindi si salva come le altre", async () => {
    const { downloadCampioncini } = await import("@/lib/campioncini");

    const run = await downloadCampioncini({
      extIds: [5555],
      dir,
      fetch: async () => png(),
    });

    expect(run.downloaded).toBe(1);
    expect(await saved()).toEqual(["5555.png"]);
  });

  it("un 200 che non è un PNG non si salva: sarebbe rotto per sempre", async () => {
    const { downloadCampioncini } = await import("@/lib/campioncini");

    const run = await downloadCampioncini({
      extIds: [2764],
      dir,
      fetch: async () =>
        new Response("<html>errore del CDN</html>", { status: 200 }),
    });

    expect(run.failed).toBe(1);
    expect(run.downloaded).toBe(0);
    expect(await saved()).toEqual([]);
  });

  it("il timeout della richiesta non salva niente", async () => {
    const { downloadCampioncini } = await import("@/lib/campioncini");

    // ⚠ Si aspetta che la richiesta sia **partita** prima di far scorrere il
    // tempo: prima di chiamare `fetch` la passata legge la cartella, che è I/O
    // vero e non passa dai timer finti. Avanzando subito, il `setTimeout` del
    // timeout non sarebbe ancora stato registrato e non scatterebbe mai.
    let started!: () => void;
    const requestSent = new Promise<void>((resolve) => {
      started = resolve;
    });

    const run = downloadCampioncini({
      extIds: [2764],
      dir,
      concurrency: 1,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
          started();
        }),
    });

    await requestSent;
    // I timer sono finti (PLAN §16.7): il tempo passa solo qui.
    await vi.advanceTimersByTimeAsync(10_000);

    expect((await run).failed).toBe(1);
    expect(await saved()).toEqual([]);
  });

  /**
   * ⚠ **Ripetibile per costruzione**, perché lo stato è il disco: «mancante»
   * vuol dire «file che non c'è». La seconda passata non chiede niente al CDN —
   * non «scarica di nuovo e sovrascrive»: proprio non parte.
   */
  it("ripetere la passata non riscarica niente e non chiede niente", async () => {
    const { downloadCampioncini } = await import("@/lib/campioncini");
    let calls = 0;
    const counting = async () => {
      calls += 1;
      return png();
    };

    const first = await downloadCampioncini({
      extIds: [2764, 494],
      dir,
      fetch: counting,
    });
    const second = await downloadCampioncini({
      extIds: [2764, 494],
      dir,
      fetch: counting,
    });

    expect(first.downloaded).toBe(2);
    expect(calls).toBe(2);
    expect(second.downloaded).toBe(0);
    expect(second.alreadyThere).toBe(2);
    expect(second.expired).toBe(false);
  });

  /**
   * Verifica 4 — **la scadenza**. Con un `fetch` finto e lento la passata si
   * ferma a venti secondi, dice quante ne restano, e ripremendo riprende da dove
   * era. L'orologio è iniettato invece che avanzato coi timer perché così il
   * conto è esatto e il test non dipende da quanto ci mette la macchina.
   */
  it("la scadenza ferma la passata, che dice quante ne restano", async () => {
    const { downloadCampioncini } = await import("@/lib/campioncini");

    let clock = 0;
    const slow = async () => {
      clock += 6_000;
      return png();
    };

    const run = await downloadCampioncini({
      extIds: [1, 2, 3, 4, 5],
      dir,
      concurrency: 1,
      budgetMs: 20_000,
      now: () => clock,
      fetch: slow,
    });

    expect(run.expired).toBe(true);
    expect(run.downloaded).toBe(4);
    expect(run.remaining).toBe(1);
    expect(await saved()).toEqual(["1.png", "2.png", "3.png", "4.png"]);
  });

  it("e ripremendo riprende da dove era, senza rifare le prime", async () => {
    const { downloadCampioncini } = await import("@/lib/campioncini");
    const extIds = [1, 2, 3, 4, 5];

    let clock = 0;
    const slow = async () => {
      clock += 6_000;
      return png();
    };

    await downloadCampioncini({
      extIds,
      dir,
      concurrency: 1,
      budgetMs: 20_000,
      now: () => clock,
      fetch: slow,
    });

    clock = 0;
    const second = await downloadCampioncini({
      extIds,
      dir,
      concurrency: 1,
      budgetMs: 20_000,
      now: () => clock,
      fetch: slow,
    });

    expect(second.alreadyThere).toBe(4);
    expect(second.downloaded).toBe(1);
    expect(second.remaining).toBe(0);
    expect(second.expired).toBe(false);
    expect(await saved()).toEqual(["1.png", "2.png", "3.png", "4.png", "5.png"]);
  });

  it("una passata a freddo scarica tutto e non lascia file temporanei", async () => {
    const { downloadCampioncini, countArchive } = await import(
      "@/lib/campioncini"
    );
    const extIds = Array.from({ length: 100 }, (_, i) => i + 1);

    const run = await downloadCampioncini({
      extIds,
      dir,
      fetch: async () => png(),
    });

    expect(run.downloaded).toBe(100);
    expect(await countArchive(dir)).toBe(100);
    // Il `.tmp` del rinomino atomico non deve restare per terra.
    expect((await fs.readdir(dir)).some((n) => n.endsWith(".tmp"))).toBe(false);
  });

  it("un archivio che non esiste ancora è vuoto, non un errore", async () => {
    const { countArchive, archivedExtIds } = await import("@/lib/campioncini");
    const nowhere = path.join(root, "mai-creata");

    expect(await countArchive(nowhere)).toBe(0);
    expect(await archivedExtIds(nowhere)).toEqual(new Set());
  });

  it("conta solo i file che sono id, non tutto ciò che sta nella cartella", async () => {
    const { countArchive } = await import("@/lib/campioncini");
    await fs.writeFile(path.join(dir, "2764.png"), PNG);
    await fs.writeFile(path.join(dir, "2764.png.tmp"), PNG);
    await fs.writeFile(path.join(dir, "appunti.txt"), "niente");

    expect(await countArchive(dir)).toBe(1);
  });
});
