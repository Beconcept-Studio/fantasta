import { readFile } from "node:fs/promises";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { parseFantalabListone } from "@/lib/import/parseFantalabListone";
import { parseRigoristi } from "@/lib/import/parseRigoristi";

/**
 * I due parser di M8, provati sulle risposte vere salvate in `fixtures/`.
 *
 * ⚠ **Questi test sono il sensore di M8, non un contorno.** Le fonti sono
 * pubbliche e fuori dal nostro controllo: il giorno in cui una cambia forma,
 * l'unico modo per accorgersene prima di scrivere spazzatura nel database è che
 * qui compaia un rosso. Per questo i numeri attesi sono **esatti** — 497
 * giocatori, 20 squadre, 57 rigoristi, 56 piazzati, 87 id distinti — e non
 * «almeno qualcosa»: un «almeno» passerebbe anche se la pagina si svuotasse a
 * metà.
 *
 * I numeri sono quelli misurati il 2026-08-11 (M8 §1). Se cambiano perché la
 * *realtà* è cambiata — un rigorista designato in più — si aggiorna la fixture e
 * il numero, insieme, e lo si scrive nel commit.
 */

const FIXTURES = path.resolve(__dirname, "..", "fixtures");

let listoneBytes: Buffer;
let rigoristiHtml: string;

beforeAll(async () => {
  listoneBytes = await readFile(path.join(FIXTURES, "fantalab-listone.json"));
  rigoristiHtml = await readFile(path.join(FIXTURES, "rigoristi.html"), "utf8");
});

describe("parseFantalabListone", () => {
  it("legge 497 giocatori con ext_id unico", () => {
    const result = parseFantalabListone(listoneBytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.rows).toHaveLength(497);
    expect(new Set(result.value.rows.map((r) => r.extId)).size).toBe(497);
    expect(result.value.season).toBe("s_2025_2026");
  });

  it("⚠ tiene le due stagioni distinte: 329 current, 168 previous", () => {
    const result = parseFantalabListone(listoneBytes);
    if (!result.ok) throw new Error(result.error.message);

    const current = result.value.rows.filter((r) => r.statsSeason === "current");
    const previous = result.value.rows.filter(
      (r) => r.statsSeason === "previous",
    );
    expect(current).toHaveLength(329);
    expect(previous).toHaveLength(168);
    // Nessun terzo valore: se la fonte ne introducesse uno, va visto qui.
    expect(current.length + previous.length).toBe(497);
  });

  it("prende le presenze da display_presenze, che è il numero che la fonte mostra", () => {
    const result = parseFantalabListone(listoneBytes);
    if (!result.ok) throw new Error(result.error.message);

    // Berardi e Bernardeschi: i due casi di M8 §2, con i valori veri.
    const berardi = result.value.rows.find((r) => r.extId === 531);
    const bernardeschi = result.value.rows.find((r) => r.extId === 184);

    expect(berardi).toMatchObject({
      team: "Sassuolo",
      presenze: 26,
      startsEleven: 24,
      minPlayingTime: 1971,
      rigoriFatti: 2,
    });
    expect(bernardeschi).toMatchObject({
      team: "Bologna",
      presenze: 24,
      startsEleven: 12,
      minPlayingTime: 1212,
    });
  });

  /**
   * M21 §3 — i due numeri che la tab Listone mostra, e che **il parser non
   * leggeva**.
   *
   * ⚠ La spec di M21 partiva dall'idea che «li abbiamo già e non li mostriamo»:
   * è falso, ed è stato misurato prima di progettare. Nella risposta ci sono da
   * sempre — `gol_fatti` e `assist` — ma la riga che il parser costruiva si
   * fermava a `fmv_away`. Questo test è il confine fra le due cose.
   *
   * I numeri sono esatti come tutti gli altri di questo file: 933 gol e 653
   * assist sulle 497 righe della risposta del 2026-08-11, e 209 giocatori a
   * secco. Un «almeno qualcosa» passerebbe anche se la fonte smettesse di
   * mandarli — e siccome sono contatori, il parser scriverebbe **zero ovunque**
   * senza fallire.
   */
  it("legge gol e assist, che sono contatori: 933 e 653, e 209 a secco", () => {
    const result = parseFantalabListone(listoneBytes);
    if (!result.ok) throw new Error(result.error.message);

    const rows = result.value.rows;
    expect(rows.reduce((s, r) => s + r.golFatti, 0)).toBe(933);
    expect(rows.reduce((s, r) => s + r.assist, 0)).toBe(653);
    // ⚠ Zero e non `null`: qui lo zero *è* un'informazione — non ha segnato — al
    // contrario di `fmvHome`, dove lo zero della fonte significa «nessuna media».
    expect(rows.filter((r) => r.golFatti === 0)).toHaveLength(209);
    expect(rows.every((r) => Number.isInteger(r.golFatti))).toBe(true);
    expect(rows.every((r) => Number.isInteger(r.assist))).toBe(true);

    // I due di §2 con i loro numeri, e il capocannoniere della risposta.
    expect(rows.find((r) => r.extId === 531)).toMatchObject({
      golFatti: 6,
      assist: 4,
    });
    expect(rows.find((r) => r.extId === 184)).toMatchObject({
      golFatti: 3,
      assist: 2,
    });
    expect(rows.find((r) => r.extId === 2764)).toMatchObject({
      golFatti: 17,
      assist: 6,
    });
  });

  it("le squadre sono venti, col nome pieno: è la stessa stringa di players.team", () => {
    const result = parseFantalabListone(listoneBytes);
    if (!result.ok) throw new Error(result.error.message);

    const teams = new Set(result.value.rows.map((r) => r.team));
    expect(teams.size).toBe(20);
    expect(teams).toContain("Atalanta");
    expect(teams).toContain("Juventus");
  });

  it("⚠ fallisce forte su un envelope diverso, invece di scrivere righe vuote", () => {
    const noPlayers = parseFantalabListone(
      Buffer.from(JSON.stringify({ count: 0, season: "s_2025_2026" })),
    );
    expect(noPlayers.ok).toBe(false);
    if (!noPlayers.ok) expect(noPlayers.error.code).toBe("SOURCE_SCHEMA");

    const countMismatch = parseFantalabListone(
      Buffer.from(
        JSON.stringify({
          count: 400,
          season: "s_2025_2026",
          players: [{ fantacalcio_id: 1 }],
        }),
      ),
    );
    expect(countMismatch.ok).toBe(false);
    if (!countMismatch.ok) {
      expect(countMismatch.error.code).toBe("SOURCE_SCHEMA");
      // Il messaggio dice i due numeri: è quello che si legge nel pannello.
      expect(countMismatch.error.message).toContain("400");
    }
  });

  it("fallisce su un corpo che non è JSON, e su una lista vuota", () => {
    const garbage = parseFantalabListone(Buffer.from("<html>ops</html>"));
    expect(garbage.ok).toBe(false);
    if (!garbage.ok) expect(garbage.error.code).toBe("SOURCE_UNREACHABLE");

    const empty = parseFantalabListone(
      Buffer.from(JSON.stringify({ count: 0, players: [] })),
    );
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe("SOURCE_SCHEMA");
  });

  it("rifiuta una riga senza fantacalcio_id: senza chiave non c'è aggancio possibile", () => {
    const result = parseFantalabListone(
      Buffer.from(
        JSON.stringify({
          count: 1,
          season: "s_2025_2026",
          players: [
            {
              fantacalcio_id: null,
              team_name: "Roma",
              display_stats_season: "current",
            },
          ],
        }),
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SOURCE_SCHEMA");
  });
});

describe("parseRigoristi", () => {
  it("legge venti squadre, tre rigoristi e tre piazzati per ognuna: 120 righe, 92 giocatori distinti", () => {
    const result = parseRigoristi(rigoristiHtml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = result.value;
    expect(new Set(rows.map((r) => r.team)).size).toBe(20);
    expect(rows.filter((r) => r.kind === "RIGORI")).toHaveLength(60);
    expect(rows.filter((r) => r.kind === "PIAZZATI")).toHaveLength(60);
    expect(rows).toHaveLength(120);
    // 92 e non 120 perché chi batte i rigori spesso batte anche i piazzati.
    expect(new Set(rows.map((r) => r.extId)).size).toBe(92);
  });

  it("⚠ non perde i cinque nomi con l'accento, che nell'URL arrivano come entità HTML", () => {
    const result = parseRigoristi(rigoristiHtml);
    if (!result.ok) throw new Error(result.error.message);

    // Questa è la trappola vera di questa pagina, e ci sono cascato scrivendo la
    // spec: nello slug del link l'accento è `&#xE8;` — `…/squadre/roma/soul&#xE8;/5734`
    // — quindi un regex che pretende `[a-z0-9-]+` prima dell'id **scarta cinque
    // giocatori in silenzio** e sembra funzionare. Il regex accetta qualunque
    // carattere che non sia `/` o `"`, e questi cinque sono il suo test.
    const ids = new Set(result.value.map((r) => r.extId));
    for (const extId of [7472, 6229, 6666, 5734, 6060]) {
      expect(ids).toContain(extId);
    }
  });

  it("prende gli id dai link, non dal percorso delle figurine, che invecchia ogni stagione", () => {
    const result = parseRigoristi(rigoristiHtml);
    if (!result.ok) throw new Error(result.error.message);

    // Sulla pagina di oggi le due strade portano agli stessi 92 id. Si è scelto
    // l'`href` perché il `src` contiene l'edizione dei campioncini (`/21/`), che
    // cambia a ogni stagione — è la stessa `CAMPIONCINI_EDITION` che M7 ha dovuto
    // mettere nel `.env`. L'uguaglianza qui sotto è la prova che la strada scelta
    // non perde nulla rispetto all'altra.
    const dalleFigurine = new Set(
      [...rigoristiHtml.matchAll(/campioncini\/\d+\/\w+\/(\d+)\.png/g)].map((m) =>
        Number(m[1]),
      ),
    );
    expect(dalleFigurine.size).toBe(92);
    expect(new Set(result.value.map((r) => r.extId))).toEqual(dalleFigurine);
  });

  it("il rank è la posizione nella lista, e parte da 1", () => {
    const result = parseRigoristi(rigoristiHtml);
    if (!result.ok) throw new Error(result.error.message);

    const atalanta = result.value.filter(
      (r) => r.team === "Atalanta" && r.kind === "RIGORI",
    );
    // Scamacca, Krstovic, Samardzic: la gerarchia vera del 2026-08-11.
    expect(atalanta.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(atalanta[0]).toMatchObject({ extId: 2137, rank: 1 });

    // Nessuna lista è più profonda di tre, in nessuna squadra.
    expect(Math.max(...result.value.map((r) => r.rank))).toBe(3);
  });

  it("ogni squadra ha almeno un rigorista designato", () => {
    const result = parseRigoristi(rigoristiHtml);
    if (!result.ok) throw new Error(result.error.message);

    const teams = [...new Set(result.value.map((r) => r.team))];
    for (const team of teams) {
      expect(
        result.value.some((r) => r.team === team && r.kind === "RIGORI"),
      ).toBe(true);
    }
  });

  it("⚠ fallisce forte quando la pagina cambia forma, invece di restituire una lista corta", () => {
    const vuota = parseRigoristi("<html><body><p>niente</p></body></html>");
    expect(vuota.ok).toBe(false);
    if (!vuota.ok) expect(vuota.error.code).toBe("SOURCE_SCHEMA");

    // Diciannove squadre invece di venti: è il modo silenzioso in cui una pagina
    // si rompe, ed è quello che deve fare rumore.
    const diciannove = rigoristiHtml.replace(
      '<span class="team-name">Venezia</span>',
      '<span class="team-nome">Venezia</span>',
    );
    const parziale = parseRigoristi(diciannove);
    expect(parziale.ok).toBe(false);
    if (!parziale.ok) {
      expect(parziale.error.code).toBe("SOURCE_SCHEMA");
      expect(parziale.error.message).toContain("19");
    }
  });

  it("una pagina con le squadre ma senza liste è un errore, non zero righe", () => {
    const senzaListe = rigoristiHtml.replace(/<ol[\s\S]*?<\/ol>/g, "");
    const result = parseRigoristi(senzaListe);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SOURCE_SCHEMA");
  });
});
