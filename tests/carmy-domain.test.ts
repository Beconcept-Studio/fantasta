import { describe, expect, it } from "vitest";

import {
  CARMY_FASCE,
  CARMY_FASCIA_ASSENTE,
  CARMY_SCALA_MAX,
  type CarmyJudgement,
  GIORNATE,
  type PlayerInsights,
  SOGLIA_TITOLARE,
  SOGLIA_TITOLARE_CARMY,
  carmyFasciaRank,
  titolarita,
} from "@/lib/domain";

/**
 * M10B — la titolarità con due fonti, e **l'unico posto in cui si decide da dove
 * viene** (§4).
 *
 * ⚠ **È il test che tiene in piedi la regola più importante della macro.** Se un
 * giorno la lista di chiamata e il modale d'offerta applicassero la scelta in due
 * modi diversi, lo stesso giocatore sarebbe verde in una schermata e grigio
 * nell'altra — e nessuno se ne accorgerebbe, perché nessuna delle due schermate
 * sbaglierebbe *da sola*. Qui la regola sta in una funzione, e i casi hanno i nomi
 * dei giocatori veri dentro.
 *
 * Nessun database e nessun browser, come `tests/insights-domain.test.ts`.
 */

function insight(over: Partial<PlayerInsights> = {}): PlayerInsights {
  return {
    extId: 531,
    fullName: "Domenico Berardi",
    team: "Sassuolo",
    statsSeason: "current",
    presenze: 26,
    startsEleven: 24,
    minPlayingTime: 1971,
    rigoriFatti: 2,
    rigoriSbagliati: 0,
    rigoriParati: 0,
    fmvHome: 7.19,
    fmvAway: 6.4,
    rigoristaRank: 1,
    piazzatiRank: null,
    ...over,
  };
}

function carmy(over: Partial<CarmyJudgement> = {}): CarmyJudgement {
  return {
    extId: 531,
    sourceName: "Berardi",
    sourceTeam: "SAS",
    fascia: "Terza",
    prezzo: 13,
    titolarita: 4,
    affidabilita: 3,
    integrita: 3,
    fmvExp: 6.8,
    tags: ["bonus"],
    commento: null,
    ...over,
  };
}

describe("titolarita — quale delle due fonti vince", () => {
  it("con il giudizio di Carmy vince Carmy: si smette di dedurla dalle presenze", () => {
    const t = titolarita(insight({ startsEleven: 24 }), carmy({ titolarita: 5 }));
    expect(t).toMatchObject({ fonte: "carmy", voto: 5, forte: true });
  });

  it("senza il foglio caricato si torna al badge di M9, calcolato dalle presenze", () => {
    // È il comportamento **dichiarato** e non subito: in produzione la tabella
    // nasce vuota, e finché non si carica il file `/play` è quella di prima.
    const t = titolarita(insight({ startsEleven: 32 }), undefined);
    expect(t).toMatchObject({ fonte: "presenze", starts: 32, forte: true });
    if (t?.fonte !== "presenze") return;
    expect(t.quota).toBeCloseTo(32 / GIORNATE);
  });

  it("con un giudizio senza titolarità si torna alle presenze: lo `0` del foglio non è un voto", () => {
    // È la riga non compilata di Aurelio: ha il giudizio, ma non ha il voto.
    const t = titolarita(insight(), carmy({ titolarita: null }));
    expect(t?.fonte).toBe("presenze");
  });

  it("senza né l'uno né l'altro è `null`, e la UI scrive `—`", () => {
    expect(titolarita(undefined, undefined)).toBeNull();
    expect(titolarita(null, null)).toBeNull();
    // Nessuna riga di insight mostrabile e nessun giudizio: niente badge, **non**
    // un badge grigio a zero (è la regola di M8 §5, `—` e `0` non si scrivono
    // allo stesso modo).
    expect(titolarita(insight({ statsSeason: "previous" }), undefined)).toBeNull();
  });
});

describe("titolarita — la soglia del verde, con la sua misura accanto", () => {
  it(`è \`>= ${SOGLIA_TITOLARE_CARMY}\`, e ${SOGLIA_TITOLARE_CARMY} è verde`, () => {
    expect(SOGLIA_TITOLARE_CARMY).toBe(4);
    expect(titolarita(insight(), carmy({ titolarita: 4 }))).toMatchObject({
      forte: true,
    });
    expect(titolarita(insight(), carmy({ titolarita: 5 }))).toMatchObject({
      forte: true,
    });
  });

  it("e 3 è grigio: il confronto è `>=`, e il caso di bordo sta qui", () => {
    expect(titolarita(insight(), carmy({ titolarita: 3 }))).toMatchObject({
      forte: false,
    });
  });

  /**
   * ⚠ **La misura che sta accanto alla soglia**, come `SOGLIA_TITOLARE` ha la sua.
   * Sul file del 2026-08-12, 497 giocatori: `>= 4` colora **168**, cioè il 33,8% —
   * un nome su tre. `>= 5` ne colora 103, il 20,7%, che è esattamente il limite che
   * M9 §1 aveva indicato contando («uno su cinque è il punto in cui un colore
   * smette di essere un segnale e diventa decorazione»).
   *
   * **La scelta resta `>= 4` perché è dell'owner**, che l'ha guardata su quaranta
   * nomi veri. Questo test non la difende: la **documenta**, così se un giorno
   * risultasse troppo, la riga da cambiare è una sola e il numero da confrontare è
   * già scritto. Il conteggio vero, sui byte, sta in `tests/parse-carmy.test.ts`.
   */
  it("⚠ e la misura è 168 su 497, cioè un nome su tre — non è un dettaglio", () => {
    const distribuzione = { 1: 75, 2: 94, 3: 159, 4: 65, 5: 103 };
    const verdi = Object.entries(distribuzione)
      .filter(([voto]) => Number(voto) >= SOGLIA_TITOLARE_CARMY)
      .reduce((sum, [, n]) => sum + n, 0);
    expect(verdi).toBe(168);
    expect(Math.round((1000 * verdi) / 497) / 10).toBe(33.8);
    // Per confronto, la soglia di M9 sulle presenze ne colorava 61 su 497.
    expect(SOGLIA_TITOLARE).toBe(0.8);
  });
});

describe("titolarita — il rapporto grezzo, che è la prova del giudizio", () => {
  /**
   * ⚠ **Il caso che giustifica tutta la macro.** Dovbyk al Bologna: giudicato `5`
   * su 5, tre partite da titolare l'anno scorso. Le due cose insieme dicono
   * «l'anno scorso non giocava, quest'anno gioca» — che è precisamente
   * l'informazione che nessuna statistica poteva dare.
   */
  it("Dovbyk: 5/5 accanto a 3/38, e la divergenza si legge", () => {
    const t = titolarita(
      insight({ startsEleven: 3, statsSeason: "current" }),
      carmy({ titolarita: 5 }),
    );
    expect(t).toMatchObject({
      fonte: "carmy",
      voto: 5,
      forte: true,
      quota: { starts: 3, giornate: GIORNATE },
    });
  });

  /**
   * ⚠ **E il caso in cui il rapporto grezzo va tolto**, che è la stessa
   * distinzione di `bestSetPieceRank`: Stankovic A. ha 34 partite da titolare, ma
   * di **due campionati fa** (`previous`). Un `2/5` accanto a un `34/38` di due
   * anni prima non è una prova, è un confronto falso — quindi la quota è `null` e
   * il giudizio resta da solo.
   */
  it("Stankovic A.: il giudizio resta, il rapporto dell'altro campionato no", () => {
    const t = titolarita(
      insight({ startsEleven: 34, statsSeason: "previous" }),
      carmy({ titolarita: 2 }),
    );
    expect(t).toMatchObject({ fonte: "carmy", voto: 2, forte: false, quota: null });
  });

  it("⚠ ma il giudizio di Carmy **non** passa dal gate stagionale, e questo è il punto", () => {
    // Se `titolarita` filtrasse anche il giudizio, Stankovic A. non avrebbe nessun
    // badge — e con lui tutti i 168 `previous` del listone perderebbero
    // l'informazione più recente che abbiamo su di loro. Il giudizio è
    // un'opinione su **quest'anno**, scritta oggi.
    expect(
      titolarita(insight({ statsSeason: "previous" }), carmy({ titolarita: 4 })),
    ).not.toBeNull();
  });
});

describe("le fasce", () => {
  it("si ordinano come le ordina il foglio: Top prima di Terza, non in alfabeto", () => {
    expect(carmyFasciaRank("Top")).toBeLessThan(carmyFasciaRank("Terza"));
    expect(carmyFasciaRank("Semi-Top")).toBeLessThan(carmyFasciaRank("Quarta"));
    expect(carmyFasciaRank("Scomm.")).toBeLessThan(carmyFasciaRank("Outsider"));
  });

  it("le assenti e le sconosciute vanno in fondo, insieme", () => {
    const fondo = CARMY_FASCE.length;
    expect(carmyFasciaRank(null)).toBe(fondo);
    expect(carmyFasciaRank(undefined)).toBe(fondo);
    // Una fascia nuova non rompe niente: compare e finisce in coda.
    expect(carmyFasciaRank("Fascia Inventata")).toBe(fondo);
    // ⚠ `Non Impostata` non è una fascia: il parser la traduce in `null`, e se
    // arrivasse fin qui finirebbe comunque in fondo.
    expect(carmyFasciaRank(CARMY_FASCIA_ASSENTE)).toBe(fondo);
  });

  it("sono sette, e `Non Impostata` non è fra loro", () => {
    expect(CARMY_FASCE).toHaveLength(7);
    expect(CARMY_FASCE as readonly string[]).not.toContain(CARMY_FASCIA_ASSENTE);
  });
});

describe("la scala", () => {
  it("arriva a 5, ed è la stessa che il parser rifiuta di superare", () => {
    expect(CARMY_SCALA_MAX).toBe(5);
    expect(SOGLIA_TITOLARE_CARMY).toBeLessThanOrEqual(CARMY_SCALA_MAX);
  });
});
