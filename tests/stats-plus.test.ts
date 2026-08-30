import { describe, expect, it } from "vitest";

import type { Role } from "@/lib/domain";
import {
  MIN_ANDATI_PRIMA_DI_ALLARGARE,
  MIN_LOTTI_PER_PARTE,
  SOGLIA_AVVISO,
  SOGLIA_LOTTO_INFORMATIVO,
  alternative,
  andatiStessaFascia,
  avvisi,
  haPma,
  lottiAlMinimo,
  lottiInformativi,
  pct,
  pianoPerRuolo,
  saldoRuoliChiusi,
  scartoStrutturale,
  scalaSlotPerRuolo,
  scartoPerPartecipante,
  scatto,
  temperatura,
} from "@/lib/stats-plus";
import type { PoolPlayer, Snapshot } from "@/lib/realtime/types";

import { ME, OTHER, THIRD, iso, lot, member, snapshot } from "./snapshot-factory";

/**
 * M22 — il termometro, che è aritmetica su lotti già chiusi e niente altro.
 *
 * ⚠ **Il primo `describe` è il test che regge la macro** (§7.3), e va letto
 * prima degli altri: tutto ciò che Stats+ mostra si calcola da lotti risolti e
 * da stato pubblico, **mai** dalle buste in corso. Non è una precauzione in più,
 * è I8 espresso come proprietà di queste funzioni — e il rischio non è teorico:
 * un giorno qualcuno vorrà «migliorare» la temperatura usando
 * `eligibleMemberIds`, e il numero continuerebbe ad avere la stessa faccia.
 */

const BUDGET = 500;

/** Un giocatore del pool, con la sola parte di giudizio che il termometro guarda. */
function p(
  id: string,
  over: { role?: Role; pma?: number | null; fasciaRank?: number } = {},
): PoolPlayer {
  return {
    id,
    name: id,
    team: "Inter",
    role: over.role ?? "D",
    fvm: 100,
    quot: 10,
    fasciaRank: over.fasciaRank,
    carmy: {
      extId: 1,
      fascia: null,
      prezzo: null,
      pma: over.pma ?? null,
      titolarita: null,
      affidabilita: null,
      integrita: null,
      fmvExp: null,
      tags: [],
      commento: null,
    },
  };
}

/**
 * Una riga di rosa da un lotto vinto. `pma` serve solo a costruire il pool
 * coerente: quello che entra nello snapshot è il prezzo.
 */
type Preso = {
  playerId: string;
  role: Role;
  price: number;
  lotSeq: number | null;
};

function rosaDi(presi: Preso[]) {
  return presi.map((x, i) => ({
    assignmentId: `a-${x.playerId}-${i}`,
    playerId: x.playerId,
    name: x.playerId,
    role: x.role,
    team: "Inter",
    price: x.price,
    lotSeq: x.lotSeq,
  }));
}

// ─── §7.3 — l'invariante, misurato invece che promesso ───────────────────────

describe("§7.3 — cambiare le buste vive non cambia un solo numero", () => {
  /**
   * Il pool e le rose sono gli stessi nei due stati: **cambia solo il lotto in
   * corso**, cioè tutto ciò che nello snapshot può portare traccia di una busta.
   */
  const pool: PoolPlayer[] = [
    p("d1", { role: "D", pma: 8 }),
    p("d2", { role: "D", pma: 6 }),
    p("d3", { role: "D", pma: 4 }),
    p("d4", { role: "D", pma: 5 }),
    p("gk1", { role: "P", pma: 10 }),
    p("gk2", { role: "P", pma: 7 }),
    // Il giocatore del lotto aperto: non ha ancora un prezzo, e non deve averne
    // uno in nessuno dei due stati.
    p("in-asta", { role: "D", pma: 9 }),
  ];

  function statoCon(patchLotto: Parameters<typeof lot>[0], myBid: Snapshot["myBid"]) {
    return snapshot({
      auction: { ...snapshot().auction, currentRole: "D", phase: "LOT_OPEN" },
      members: [
        member(ME, 0, {
          roster: rosaDi([
            { playerId: "gk1", role: "P", price: 30, lotSeq: 1 },
            { playerId: "d1", role: "D", price: 50, lotSeq: 3 },
          ]),
        }),
        member(OTHER, 1, {
          roster: rosaDi([
            { playerId: "gk2", role: "P", price: 20, lotSeq: 2 },
            { playerId: "d2", role: "D", price: 25, lotSeq: 4 },
          ]),
        }),
        member(THIRD, 2, {
          roster: rosaDi([
            { playerId: "d3", role: "D", price: 12, lotSeq: 5 },
            { playerId: "d4", role: "D", price: 30, lotSeq: 6 },
          ]),
        }),
      ],
      currentLot: lot({
        player: {
          id: "in-asta",
          extId: 1,
          name: "in-asta",
          role: "D",
          team: "Inter",
          fvm: 100,
        },
        ...patchLotto,
      }),
      myBid,
    });
  }

  /** Tutto ciò che le funzioni pubbliche sanno dire, in un oggetto solo. */
  function tuttoQuelloCheStatsPlusMostra(s: Snapshot) {
    const lotti = lottiInformativi(s, pool, BUDGET, "D");
    return {
      piano: pianoPerRuolo(pool),
      lotti,
      temperatura: temperatura(lotti),
      saldo: saldoRuoliChiusi(s, pool, BUDGET),
      scatto: scatto(lotti),
      avvisi: avvisi(s, pool, BUDGET),
    };
  }

  it("importi diversi, un'offerta in più, un ritiro: esce lo stesso identico oggetto", () => {
    // Stato A — round 1, tre idonei, nessuna busta mia.
    const a = statoCon(
      {
        roundNo: 1,
        minAmount: 1,
        eligibleMemberIds: [ME, OTHER, THIRD],
        endsAt: iso(30_000),
      },
      null,
    );

    // Stato B — le buste si sono mosse in ogni modo che lo snapshot possa
    // rappresentare: un round in più con una soglia più alta, un idoneo in meno
    // (qualcuno non può più offrire), la mia busta consegnata e poi ritirata, e
    // un pareggio annunciato — che è l'unico importo che esce prima del reveal.
    const b = statoCon(
      {
        roundNo: 2,
        minAmount: 47,
        eligibleMemberIds: [ME, THIRD],
        endsAt: iso(9_000),
        tie: { amount: 47, memberIds: [ME, THIRD] },
      },
      { amount: 63, amountSetAt: iso(-4_000), withdrawnAt: iso(-1_000) },
    );

    // ⚠ **`toEqual` su tutto, non un campo per volta.** Un'asserzione per campo
    // proverebbe i campi che qualcuno si è ricordato di elencare; questa prova
    // anche quelli che verranno aggiunti domani.
    expect(tuttoQuelloCheStatsPlusMostra(b)).toEqual(
      tuttoQuelloCheStatsPlusMostra(a),
    );
  });

  it("e i due stati sono davvero diversi: se lo fossero solo per finta, il test sopra non direbbe niente", () => {
    // La guardia della guardia. Senza, basterebbe un refuso nel costruttore per
    // confrontare due snapshot identici e vedere verde per sempre.
    const a = statoCon({ roundNo: 1, minAmount: 1 }, null);
    const b = statoCon(
      { roundNo: 2, minAmount: 47, tie: { amount: 47, memberIds: [ME] } },
      { amount: 63, amountSetAt: iso(-4_000), withdrawnAt: null },
    );
    expect(b).not.toEqual(a);
  });
});

// ─── §3.4 — il filtro sull'ingresso, non sull'esito ──────────────────────────

describe("§3.4 — informativo si decide dal PMA del chiamato, non da come è finito", () => {
  const pool: PoolPlayer[] = [
    // 6% di 500 = 30 crediti: sopra la soglia.
    p("caro", { role: "D", pma: 6 }),
    // 0,2% di 500 = 1 credito: sotto la soglia, qualunque cifra faccia.
    p("da-un-credito", { role: "D", pma: 0.2 }),
  ];

  function stato(presi: Preso[]) {
    return snapshot({
      auction: { ...snapshot().auction, currentRole: "D" },
      members: [member(ME, 0, { roster: rosaDi(presi) }), member(OTHER, 1)],
    });
  }

  /**
   * ⚠ **Questo test fissa l'esatto contrario del rimedio archiviato, e la nota
   * serve perché il rimedio sbagliato sembra giusto.** La spec precedente
   * escludeva i lotti **chiusi al prezzo minimo**, avendo misurato che
   * avvelenavano la stima. La diagnosi era corretta e il rimedio no: filtrare
   * sul **prezzo pagato** scarta esattamente gli esiti bassi, e la temperatura
   * risulta sistematicamente più calda del vero. È selezione sull'esito.
   *
   * Il filtro giusto guarda il **giocatore chiamato**, cioè una proprietà nota
   * prima che il lotto si apra. Se un giorno qualcuno "correggesse" questa
   * funzione escludendo i lotti a 1 credito, è questa riga che diventa rossa.
   */
  it("un giocatore da 30 crediti chiuso a 1 ENTRA: è l'esito, e l'esito non filtra", () => {
    const lotti = lottiInformativi(stato([
      { playerId: "caro", role: "D", price: 1, lotSeq: 1 },
    ]), pool, BUDGET, "D");

    expect(lotti.map((l) => l.playerId)).toEqual(["caro"]);
    // E il rapporto è basso davvero: 1 credito su 30 attesi.
    expect(pct(lotti[0].rapporto)).toBe(-97);
  });

  it("un giocatore da 1 credito NON entra, qualunque cifra abbia fatto", () => {
    const lotti = lottiInformativi(stato([
      { playerId: "da-un-credito", role: "D", price: 40, lotSeq: 1 },
    ]), pool, BUDGET, "D");

    // Quaranta crediti su un giocatore da uno sono la cosa più calda dell'asta,
    // e non dicono niente: non c'era un prezzo da cui scostarsi.
    expect(lotti).toEqual([]);
  });

  it("la soglia è in crediti e non in punti di PMA: con un budget diverso cambia chi entra", () => {
    const presi: Preso[] = [{ playerId: "caro", role: "D", price: 10, lotSeq: 1 }];
    // 6% di 500 = 30 crediti → dentro. 6% di 50 = 3 crediti → fuori.
    expect(lottiInformativi(stato(presi), pool, 500, "D")).toHaveLength(1);
    expect(lottiInformativi(stato(presi), pool, 50, "D")).toHaveLength(0);
    expect(SOGLIA_LOTTO_INFORMATIVO).toBe(5);
  });

  it("un'assegnazione manuale non entra in nessun rapporto: è la regia, non il mercato", () => {
    const lotti = lottiInformativi(stato([
      { playerId: "caro", role: "D", price: 30, lotSeq: null },
    ]), pool, BUDGET, "D");

    expect(lotti).toEqual([]);
  });

  it("un giocatore senza PMA non entra, e non è un errore: non c'è denominatore", () => {
    const senzaPma = [p("ignoto", { role: "D", pma: null })];
    const lotti = lottiInformativi(
      stato([{ playerId: "ignoto", role: "D", price: 30, lotSeq: 1 }]),
      senzaPma,
      BUDGET,
      "D",
    );
    expect(lotti).toEqual([]);
  });
});

// ─── §3.1 e §3.3 — la temperatura del ruolo in corso ─────────────────────────

describe("§3.1 — la temperatura si azzera a ogni ruolo", () => {
  const pool: PoolPlayer[] = [
    p("gk1", { role: "P", pma: 10 }),
    p("gk2", { role: "P", pma: 10 }),
    p("d1", { role: "D", pma: 10 }),
    p("d2", { role: "D", pma: 10 }),
    p("d3", { role: "D", pma: 10 }),
  ];

  // Portieri a metà prezzo (50 su 50 attesi × 0,5), difensori a 1,2×.
  const s = snapshot({
    auction: { ...snapshot().auction, currentRole: "D", roleOrder: ["P", "D", "C", "A"] },
    members: [
      member(ME, 0, {
        roster: rosaDi([
          { playerId: "gk1", role: "P", price: 25, lotSeq: 1 },
          { playerId: "d1", role: "D", price: 60, lotSeq: 3 },
        ]),
      }),
      member(OTHER, 1, {
        roster: rosaDi([
          { playerId: "gk2", role: "P", price: 25, lotSeq: 2 },
          { playerId: "d2", role: "D", price: 60, lotSeq: 4 },
        ]),
      }),
      member(THIRD, 2, {
        roster: rosaDi([{ playerId: "d3", role: "D", price: 60, lotSeq: 5 }]),
      }),
    ],
  });

  it("i portieri a 0,5× non raffreddano i difensori a 1,2×", () => {
    const d = temperatura(lottiInformativi(s, pool, BUDGET, "D"));
    expect(d).not.toBeNull();
    // 60 crediti su 50 attesi = 1,2×, cioè +20%.
    expect(pct(d!.mediana)).toBe(20);
    // ⚠ La media dei due ruoli sarebbe 0,85×: è il numero che un termometro
    // cumulativo mostrerebbe mentre i difensori schizzano.
    expect(pct(d!.mediana)).not.toBe(-15);
  });

  it("i portieri restano leggibili per conto loro, con il loro numero di lotti", () => {
    const gk = temperatura(lottiInformativi(s, pool, BUDGET, "P"));
    expect(pct(gk!.mediana)).toBe(-50);
    expect(gk!.n).toBe(2);
  });

  it("«su quanti» viaggia col numero: «te lo dico su 2» e «su 40» sono due affermazioni diverse", () => {
    expect(temperatura(lottiInformativi(s, pool, BUDGET, "D"))!.n).toBe(3);
  });

  it("nessun lotto informativo non è uno zero, è un `null` che la UI traduce in una frase", () => {
    expect(temperatura(lottiInformativi(s, pool, BUDGET, "A"))).toBeNull();
  });
});

describe("§3.3 — lo scatto non si calcola sotto gli 8 lotti informativi", () => {
  const pool = Array.from({ length: 10 }, (_, i) =>
    p(`d${i}`, { role: "D", pma: 10 }),
  );

  /** `n` lotti nel ruolo D, coi prezzi dati, in ordine di `lotSeq`. */
  function statoConPrezzi(prezzi: number[]) {
    return snapshot({
      auction: { ...snapshot().auction, currentRole: "D" },
      members: [
        member(ME, 0, {
          roster: rosaDi(
            prezzi.map((price, i) => ({
              playerId: `d${i}`,
              role: "D" as Role,
              price,
              lotSeq: i + 1,
            })),
          ),
        }),
        member(OTHER, 1),
      ],
    });
  }

  it("con 6 lotti restano i punti osservati e nessuno scatto", () => {
    const lotti = lottiInformativi(statoConPrezzi([25, 25, 25, 60, 60, 60]), pool, BUDGET, "D");
    expect(lotti).toHaveLength(6);
    expect(scatto(lotti)).toBeNull();
  });

  it("con 8 si calcola: prima metà contro seconda, in ordine di lotto", () => {
    // Primi 4 a 25 su 50 = 0,5× ; ultimi 4 a 60 su 50 = 1,2×.
    const lotti = lottiInformativi(
      statoConPrezzi([25, 25, 25, 25, 60, 60, 60, 60]),
      pool,
      BUDGET,
      "D",
    );
    const s = scatto(lotti);
    expect(s).not.toBeNull();
    expect(pct(s!.prima)).toBe(-50);
    expect(pct(s!.adesso)).toBe(20);
  });

  it("⚠ ordina per `lotSeq` e non per l'ordine in cui le rose lo consegnano", () => {
    // Le stesse cifre, ma la rosa le porta al contrario: se lo scatto leggesse
    // l'ordine dell'array invece di `lotSeq`, prima e adesso si scambierebbero.
    const alContrario = snapshot({
      auction: { ...snapshot().auction, currentRole: "D" },
      members: [
        member(ME, 0, {
          roster: rosaDi(
            [60, 60, 60, 60, 25, 25, 25, 25].map((price, i) => ({
              playerId: `d${i}`,
              role: "D" as Role,
              price,
              // `lotSeq` decrescente: il lotto 8 è consegnato per primo.
              lotSeq: 8 - i,
            })),
          ),
        }),
        member(OTHER, 1),
      ],
    });
    const s = scatto(lottiInformativi(alContrario, pool, BUDGET, "D"));
    expect(pct(s!.prima)).toBe(-50);
    expect(pct(s!.adesso)).toBe(20);
  });
});

// ─── §3.2 — il saldo, solo sui ruoli finiti ──────────────────────────────────

describe("§3.2 — il saldo si mostra solo per i ruoli chiusi", () => {
  // Piano: P vale 20 punti su 100 totali = 20%; D vale 80 = 80%.
  const pool: PoolPlayer[] = [
    p("gk1", { role: "P", pma: 10 }),
    p("gk2", { role: "P", pma: 10 }),
    p("d1", { role: "D", pma: 40 }),
    p("d2", { role: "D", pma: 40 }),
  ];

  const s = snapshot({
    auction: { ...snapshot().auction, currentRole: "D", roleOrder: ["P", "D", "C", "A"] },
    members: [
      member(ME, 0, {
        roster: rosaDi([
          { playerId: "gk1", role: "P", price: 30, lotSeq: 1 },
          { playerId: "d1", role: "D", price: 100, lotSeq: 3 },
        ]),
      }),
      member(OTHER, 1, {
        roster: rosaDi([{ playerId: "gk2", role: "P", price: 20, lotSeq: 2 }]),
      }),
    ],
  });

  it("il ruolo chiuso consegna il suo residuo", () => {
    const saldi = saldoRuoliChiusi(s, pool, BUDGET);
    expect(saldi.map((x) => x.role)).toEqual(["P"]);
    // Piano P = 20% di (500 × 2 membri) = 200. Speso = 50. Restano 150.
    expect(saldi[0]).toMatchObject({ piano: 200, speso: 50, saldo: 150 });
  });

  /**
   * ⚠ **A metà ruolo `speso(R)` è un parziale, e confrontarlo con l'intero
   * `piano(R)` direbbe sempre «avanza tantissimo»** (§3.2). È un errore che si
   * scrive da solo riusando la formula senza guardare quale ruolo si sta
   * guardando, ed è per questo che il ruolo in corso non compare **affatto**
   * invece di comparire con un numero che sembra vero.
   */
  it("il ruolo in corso non produce nessun saldo, nemmeno uno sbagliato", () => {
    expect(saldoRuoliChiusi(s, pool, BUDGET).map((x) => x.role)).not.toContain("D");
  });

  it("nel saldo entra anche il manuale: quei crediti sono stati spesi davvero", () => {
    // Il saldo è contabilità, non temperatura: un `manualAssign` toglie crediti
    // dal tavolo come qualunque altro. È la distinzione con `lottiInformativi`,
    // che invece lo scarta perché non è un prezzo di mercato.
    const conManuale = snapshot({
      auction: { ...s.auction },
      members: [
        member(ME, 0, {
          roster: rosaDi([{ playerId: "gk1", role: "P", price: 30, lotSeq: null }]),
        }),
        member(OTHER, 1),
      ],
    });
    expect(saldoRuoliChiusi(conManuale, pool, BUDGET)[0].speso).toBe(30);
  });

  /**
   * ⚠ **Tutti e quattro, non solo quelli in cui qualcuno ha comprato** (§8): ad
   * asta finita nessun ruolo è «in corso», quindi per nessuno vale la ragione
   * per cui il saldo si tace. Un ruolo senza acquisti esce con `speso: 0` e il
   * suo piano intero — che in un'asta vera non capita, e in una interrotta a
   * metà è la cosa giusta da leggere.
   */
  it("ad asta COMPLETED sono chiusi tutti i ruoli dell'ordine", () => {
    const finita = snapshot({
      auction: { ...s.auction, status: "COMPLETED", currentRole: null },
      members: s.members,
    });
    const saldi = saldoRuoliChiusi(finita, pool, BUDGET);
    expect(saldi.map((x) => x.role)).toEqual(["P", "D", "C", "A"]);
    // D adesso c'è, ed è il ruolo che a metà asta veniva taciuto.
    expect(saldi.find((x) => x.role === "D")).toMatchObject({ speso: 100 });
  });

  /**
   * ⚠ **Ad asta non ancora partita non c'è nessun saldo**, e non è lo stesso
   * caso di sopra malgrado `currentRole` sia `null` in entrambi: qui i ruoli non
   * sono chiusi, semplicemente non sono ancora cominciati. È la distinzione che
   * `ruoliChiusi` fa guardando `status`, e senza la quale un'asta in setup
   * mostrerebbe quattro saldi pieni come se il tavolo avesse risparmiato tutto.
   */
  it("ad asta non ancora partita non c'è nessun saldo, che è un caso diverso", () => {
    const inSetup = snapshot({
      auction: { ...s.auction, status: "READY", currentRole: null },
      members: s.members,
    });
    expect(saldoRuoliChiusi(inSetup, pool, BUDGET)).toEqual([]);
  });
});

// ─── §2 — il piano si legge dal foglio, non è una costante ───────────────────

describe("§2 — la quota di piano viene dal foglio caricato", () => {
  it("è la massa PMA del ruolo sulla massa totale", () => {
    const piano = pianoPerRuolo([
      p("gk", { role: "P", pma: 10 }),
      p("d", { role: "D", pma: 20 }),
      p("c", { role: "C", pma: 30 }),
      p("a", { role: "A", pma: 40 }),
    ]);
    expect(piano).toEqual({ P: 0.1, D: 0.2, C: 0.3, A: 0.4 });
  });

  it("un foglio tarato diversamente porta con sé il proprio piano", () => {
    // Nessuno deve ricordarsi di aggiornare una costante nel codice: se il
    // foglio sposta la massa, il piano la segue.
    const piano = pianoPerRuolo([
      p("gk", { role: "P", pma: 50 }),
      p("a", { role: "A", pma: 50 }),
    ]);
    expect(piano).toEqual({ P: 0.5, D: 0, C: 0, A: 0.5 });
  });

  it("un pool senza PMA non è una divisione per zero: è un piano a zero", () => {
    expect(pianoPerRuolo([p("x", { role: "D", pma: null })])).toEqual({
      P: 0,
      D: 0,
      C: 0,
      A: 0,
    });
  });
});

// ─── §3.5 — le due soglie, sui casi limite ───────────────────────────────────

describe("§3.5 — le soglie sono dichiarate, e i casi limite le fissano", () => {
  const pool = Array.from({ length: 20 }, (_, i) =>
    p(`d${i}`, { role: "D", pma: 10 }),
  );
  const poolConP = [
    ...pool,
    ...Array.from({ length: 8 }, (_, i) => p(`gk${i}`, { role: "P", pma: 10 })),
  ];

  /** Prezzi nel ruolo D (e opzionalmente in P), in ordine di lotto. */
  function stato(d: number[], gk: number[] = []) {
    return snapshot({
      auction: { ...snapshot().auction, currentRole: "D", roleOrder: ["P", "D", "C", "A"] },
      members: [
        member(ME, 0, {
          roster: rosaDi([
            ...gk.map((price, i) => ({
              playerId: `gk${i}`,
              role: "P" as Role,
              price,
              lotSeq: i + 1,
            })),
            ...d.map((price, i) => ({
              playerId: `d${i}`,
              role: "D" as Role,
              price,
              lotSeq: gk.length + i + 1,
            })),
          ]),
        }),
        member(OTHER, 1),
      ],
    });
  }

  it("la soglia è 0,25 e sta scritta, non sparsa", () => {
    expect(SOGLIA_AVVISO).toBe(0.25);
    expect(MIN_LOTTI_PER_PARTE).toBe(4);
  });

  it("esattamente 0,25 di scatto suona: la soglia è inclusiva", () => {
    // Primi 4 a 50 su 50 = 1,00× ; ultimi 4 a 62,5 → 1,25×. Differenza: 0,25.
    const s = stato([50, 50, 50, 50, 62.5, 62.5, 62.5, 62.5]);
    expect(avvisi(s, poolConP, BUDGET).map((a) => a.tipo)).toContain("SCATTO");
  });

  it("appena sotto non suona, e non si inventa un terzo stato per riempire lo spazio", () => {
    // Ultimi 4 a 62 → 1,24×. Differenza: 0,24.
    const s = stato([50, 50, 50, 50, 62, 62, 62, 62]);
    expect(avvisi(s, poolConP, BUDGET)).toEqual([]);
  });

  it("con 3 lotti per parte non suona nemmeno con uno scatto enorme", () => {
    const s = stato([10, 10, 10, 100, 100, 100]);
    expect(avvisi(s, poolConP, BUDGET)).toEqual([]);
  });

  it("il cambio d'aria confronta il ruolo in corso col precedente", () => {
    // Portieri a 25/50 = 0,5× ; difensori a 50/50 = 1,0×. Differenza: 0,50.
    const s = stato([50, 50, 50, 50], [25, 25, 25, 25]);
    expect(avvisi(s, poolConP, BUDGET).map((a) => a.tipo)).toContain("CAMBIO_ARIA");
  });

  it("col ruolo precedente sotto i 4 lotti informativi non si confronta niente", () => {
    const s = stato([50, 50, 50, 50], [25, 25, 25]);
    expect(avvisi(s, poolConP, BUDGET).map((a) => a.tipo)).not.toContain(
      "CAMBIO_ARIA",
    );
  });

  it("sul primo ruolo dell'ordine non c'è nessun cambio d'aria da annunciare", () => {
    const primoRuolo = snapshot({
      auction: {
        ...snapshot().auction,
        currentRole: "P",
        roleOrder: ["P", "D", "C", "A"],
      },
      members: [
        member(ME, 0, {
          roster: rosaDi(
            [10, 10, 10, 10].map((price, i) => ({
              playerId: `gk${i}`,
              role: "P" as Role,
              price,
              lotSeq: i + 1,
            })),
          ),
        }),
        member(OTHER, 1),
      ],
    });
    expect(avvisi(primoRuolo, poolConP, BUDGET).map((a) => a.tipo)).not.toContain(
      "CAMBIO_ARIA",
    );
  });
});

// ─── §5.0 — i rapporti si scrivono in percentuale ────────────────────────────

describe("§5.0 — `pct`, in un posto solo", () => {
  it("0,75× si scrive −25%, che è già la risposta invece di una moltiplicazione", () => {
    expect(pct(0.75)).toBe(-25);
    expect(pct(1.14)).toBe(14);
    expect(pct(1)).toBe(0);
  });

  it("arrotonda all'intero: sotto il countdown non si leggono i decimali", () => {
    expect(pct(0.756)).toBe(-24);
  });
});

// ─── §4.2 — le alternative, e la regola asimmetrica ──────────────────────────

/**
 * ⚠ **I numeri sono quelli veri del foglio** (§4.1), non inventati per far
 * tornare il test: è il caso che l'owner ha portato, ed è il caso su cui una
 * regola simmetrica sbaglia in silenzio.
 *
 * |          | fascia   | rank | PMA  | titolarità | tag             |
 * |----------|----------|------|------|------------|-----------------|
 * | Bastoni  | 1° Slot  | 0    | 6,2% | **5/5**    | `titolarissimo` |
 * | Bisseck  | 2° Slot  | 1    | 4,4% | **3/5**    | `subentrante`   |
 * | Hermoso  | 3° Slot  | 2    | 2,2% | **3/5**    | `cartellini`    |
 */
describe("§4.2 — chiamando un 5/5, un 3/5 non è un'alternativa; al contrario sì", () => {
  function d(
    id: string,
    fasciaRank: number,
    pma: number,
    titolarita: number,
    tags: string[] = [],
  ): PoolPlayer {
    return {
      id,
      name: id,
      team: "Inter",
      role: "D",
      fvm: 100,
      quot: 10,
      fasciaGruppo: `${fasciaRank + 1}° Slot`,
      fasciaRank,
      carmy: {
        extId: 1,
        fascia: `${fasciaRank + 1}° Slot`,
        prezzo: null,
        pma,
        titolarita,
        affidabilita: null,
        integrita: null,
        fmvExp: null,
        tags,
        commento: null,
      },
    };
  }

  const pool: PoolPlayer[] = [
    d("Bastoni", 0, 6.2, 5, ["titolarissimo"]),
    d("Bisseck", 1, 4.4, 3, ["subentrante"]),
    d("Hermoso", 2, 2.2, 3, ["cartellini"]),
  ];

  /** Tutti liberi: nessuna rosa, così i gruppi dipendono solo dalle regole. */
  const tuttiLiberi = snapshot({
    auction: { ...snapshot().auction, currentRole: "D" },
    members: [member(ME, 0), member(OTHER, 1)],
  });

  it("⚠ chiamando Bastoni (5/5), Bisseck (3/5) NON è pari livello", () => {
    const alt = alternative(tuttiLiberi, pool, BUDGET, "Bastoni")!;
    expect(alt.pariLivello.map((x) => x.playerId)).not.toContain("Bisseck");
    // Ci finisce, ma nel gruppo che dice la verità: ti riempie lo slot, non te
    // lo risolve.
    expect(alt.ripiego.map((x) => x.playerId)).toContain("Bisseck");
  });

  it("⚠ chiamando Bisseck (3/5), Bastoni (5/5) LO è: costa solo di più", () => {
    const alt = alternative(tuttiLiberi, pool, BUDGET, "Bisseck")!;
    expect(alt.pariLivello.map((x) => x.playerId)).toContain("Bastoni");
  });

  /**
   * ⚠ **La prova che la regola è asimmetrica e non solo "giusta per caso".** Un
   * test simmetrico — `|Δtitolarità| ≤ 1` — passerebbe entrambi i casi qui sopra
   * e direbbe che Bisseck sostituisce Bastoni, con la stessa faccia sicura. Le
   * due asserzioni insieme sono l'unica forma che una regola simmetrica non può
   * soddisfare.
   */
  it("la coppia è la prova: la stessa relazione vale in un verso e non nell'altro", () => {
    const daBastoni = alternative(tuttiLiberi, pool, BUDGET, "Bastoni")!;
    const daBisseck = alternative(tuttiLiberi, pool, BUDGET, "Bisseck")!;
    expect([
      daBastoni.pariLivello.some((x) => x.playerId === "Bisseck"),
      daBisseck.pariLivello.some((x) => x.playerId === "Bastoni"),
    ]).toEqual([false, true]);
  });

  /**
   * ⚠ **Il buco che il mock ha trovato il 2026-08-29** (§4.2): la regola scritta
   * nella prima stesura aveva tre casi che **non coprivano** «fascia più
   * economica, titolarità pari o migliore» — che è esattamente l'occasione, cioè
   * la risposta a «posso rischiare una puntata più bassa». Quei giocatori
   * cadevano fuori da ogni gruppo e sparivano dal pannello.
   */
  it("⚠ titolarità ≥ e Δrank = 2 finisce in «costano meno», non fuori da tutti i gruppi", () => {
    const pari5 = [...pool, d("Economico", 2, 2.0, 5)];
    const alt = alternative(tuttiLiberi, pari5, BUDGET, "Bastoni")!;
    expect(alt.costanoMeno.map((x) => x.playerId)).toContain("Economico");
    // E non è finito anche altrove: i gruppi non si sovrappongono.
    expect(alt.pariLivello.map((x) => x.playerId)).not.toContain("Economico");
    expect(alt.ripiego.map((x) => x.playerId)).not.toContain("Economico");
  });

  it("oltre tre gradini di slot non è più un'alternativa per lo stesso posto", () => {
    const lontano = [...pool, d("Fondo", 4, 0.5, 5)];
    const alt = alternative(tuttiLiberi, lontano, BUDGET, "Bastoni")!;
    const tutti = [...alt.pariLivello, ...alt.costanoMeno, ...alt.ripiego];
    expect(tutti.map((x) => x.playerId)).not.toContain("Fondo");
  });

  it("chi è già in una rosa non è libero, e non compare", () => {
    const bissekPreso = snapshot({
      auction: { ...snapshot().auction, currentRole: "D" },
      members: [
        member(ME, 0, {
          roster: rosaDi([
            { playerId: "Bisseck", role: "D", price: 22, lotSeq: 1 },
          ]),
        }),
        member(OTHER, 1),
      ],
    });
    const alt = alternative(bissekPreso, pool, BUDGET, "Bastoni")!;
    const tutti = [...alt.pariLivello, ...alt.costanoMeno, ...alt.ripiego];
    expect(tutti.map((x) => x.playerId)).not.toContain("Bisseck");
  });

  it("il chiamato non è alternativa di se stesso", () => {
    const alt = alternative(tuttiLiberi, pool, BUDGET, "Bastoni")!;
    const tutti = [...alt.pariLivello, ...alt.costanoMeno, ...alt.ripiego];
    expect(tutti.map((x) => x.playerId)).not.toContain("Bastoni");
  });

  it("si ordina per PMA decrescente, che è un fatto e non un giudizio", () => {
    // ⚠ Nessun ordinamento «i migliori»: sarebbe il valore del giocatore
    // rientrato dalla finestra, che è fuori perimetro (decisione 3).
    const molti = [
      ...pool,
      d("CaroA", 1, 5.0, 5),
      d("CaroB", 1, 3.0, 5),
      d("CaroC", 0, 7.0, 5),
    ];
    const alt = alternative(tuttiLiberi, molti, BUDGET, "Bisseck")!;
    const pma = alt.pariLivello.map((x) => x.pma);
    expect(pma).toEqual([...pma].sort((a, b) => b - a));
  });

  it("un giocatore senza giudizio non entra in nessun gruppo: non c'è criterio", () => {
    const senzaTutto: PoolPlayer = {
      id: "Ignoto",
      name: "Ignoto",
      team: "Inter",
      role: "D",
      fvm: 100,
      quot: 10,
    };
    const alt = alternative(tuttiLiberi, [...pool, senzaTutto], BUDGET, "Bastoni")!;
    const tutti = [...alt.pariLivello, ...alt.costanoMeno, ...alt.ripiego];
    expect(tutti.map((x) => x.playerId)).not.toContain("Ignoto");
  });

  it("se è il CHIAMATO a non avere giudizio non c'è catalogo, ed è `null` non una lista vuota", () => {
    // §8: «Questo giocatore non ha un PMA nel tuo foglio». Una lista vuota
    // direbbe «non c'è nessuna alternativa», che è un'altra affermazione.
    const senzaTutto: PoolPlayer = {
      id: "Ignoto",
      name: "Ignoto",
      team: "Inter",
      role: "D",
      fvm: 100,
      quot: 10,
    };
    expect(
      alternative(tuttiLiberi, [...pool, senzaTutto], BUDGET, "Ignoto"),
    ).toBeNull();
  });

  it("un'alternativa è cercata nello stesso ruolo: un centrocampista non riempie uno slot di difesa", () => {
    const centrocampista: PoolPlayer = { ...d("Barella", 0, 6.0, 5), role: "C" };
    const alt = alternative(tuttiLiberi, [...pool, centrocampista], BUDGET, "Bastoni")!;
    const tutti = [...alt.pariLivello, ...alt.costanoMeno, ...alt.ripiego];
    expect(tutti.map((x) => x.playerId)).not.toContain("Barella");
  });
});

// ─── §5.1 — i già andati della stessa fascia ─────────────────────────────────

describe("§5.1 — quanto è costato chi occupava lo stesso slot", () => {
  /** Un difensore con fascia, PMA e titolarità. */
  function d(id: string, fasciaRank: number, pma: number): PoolPlayer {
    return {
      id,
      name: id,
      team: "Inter",
      role: "D",
      fvm: 100,
      quot: 10,
      fasciaGruppo: `${fasciaRank + 1}° Slot`,
      fasciaRank,
      carmy: {
        extId: 1,
        fascia: `${fasciaRank + 1}° Slot`,
        prezzo: null,
        pma,
        titolarita: 4,
        affidabilita: null,
        integrita: null,
        fmvExp: null,
        tags: [],
        commento: null,
      },
    };
  }

  // Una fascia da 6, più due vicini di fascia adiacente.
  const pool: PoolPlayer[] = [
    d("Molina", 1, 7.2),
    d("Solet", 1, 5.8),
    d("Kalulu", 1, 5.2),
    d("Bisseck", 1, 4.4),
    d("Chiamato", 1, 6.0),
    d("LiberoStessaFascia", 1, 5.0),
    d("VicinoSopra", 0, 9.0),
    d("VicinoSotto", 2, 3.0),
  ];

  function stato(presi: Preso[]) {
    return snapshot({
      auction: { ...snapshot().auction, currentRole: "D" },
      members: [member(ME, 0, { roster: rosaDi(presi) }), member(OTHER, 1)],
    });
  }

  /**
   * ⚠ **L'ordine è di lotto, e la fascia si ribalta fra il secondo e il terzo
   * nome.** È il caso di §5.1: ordinati per prezzo, questi quattro nomi
   * mostrerebbero le stesse cifre e nasconderebbero l'unica cosa che dicono
   * insieme — dove il mercato ha girato.
   */
  const quattroAndati: Preso[] = [
    { playerId: "Molina", role: "D", price: 27, lotSeq: 3 },
    { playerId: "Solet", role: "D", price: 21, lotSeq: 5 },
    { playerId: "Kalulu", role: "D", price: 30, lotSeq: 8 },
    { playerId: "Bisseck", role: "D", price: 25, lotSeq: 11 },
  ];

  it("in ordine di lotto, non di prezzo: si vede dove il mercato ha girato", () => {
    const a = andatiStessaFascia(stato(quattroAndati), pool, BUDGET, "Chiamato")!;
    expect(a.righe.map((r) => r.name)).toEqual([
      "Molina",
      "Solet",
      "Kalulu",
      "Bisseck",
    ]);
    // Per prezzo sarebbe Kalulu, Molina, Bisseck, Solet: le stesse righe, e il
    // ribaltamento invisibile.
    expect(a.righe.map((r) => r.name)).not.toEqual(
      [...a.righe].sort((x, y) => y.price - x.price).map((r) => r.name),
    );
  });

  it("porta lo scarto in crediti E in percentuale, che è quello che §5.0 chiede", () => {
    const a = andatiStessaFascia(stato(quattroAndati), pool, BUDGET, "Chiamato")!;
    // Molina: PMA 7,2% di 500 = 36 crediti attesi, pagato 27.
    expect(a.righe[0]).toMatchObject({ atteso: 36, price: 27, scarto: -9 });
    expect(pct(a.righe[0].rapporto)).toBe(-25);
    // Kalulu: 5,2% = 26 attesi, pagato 30.
    expect(a.righe[2]).toMatchObject({ atteso: 26, price: 30, scarto: 4 });
    expect(pct(a.righe[2].rapporto)).toBe(15);
  });

  it("i conteggi rispondono a «quanti slot restano»", () => {
    const a = andatiStessaFascia(stato(quattroAndati), pool, BUDGET, "Chiamato")!;
    // Sei in fascia: il chiamato, quattro andati, uno libero.
    expect(a).toMatchObject({ totaleFascia: 6, andati: 4, liberiRestanti: 1 });
  });

  it("con meno di 3 andati si allarga alle fasce adiacenti, e lo dice", () => {
    const dueSoli: Preso[] = [
      { playerId: "Molina", role: "D", price: 27, lotSeq: 3 },
      { playerId: "Solet", role: "D", price: 21, lotSeq: 5 },
      { playerId: "VicinoSopra", role: "D", price: 50, lotSeq: 1 },
      { playerId: "VicinoSotto", role: "D", price: 10, lotSeq: 7 },
    ];
    const a = andatiStessaFascia(stato(dueSoli), pool, BUDGET, "Chiamato")!;
    expect(a.allargato).toBe(true);
    expect(a.righe.map((r) => r.name)).toEqual([
      "VicinoSopra",
      "Molina",
      "Solet",
      "VicinoSotto",
    ]);
    // ⚠ E si sa **quali** righe sono il prestito: «dichiarati un gradino sopra»
    // è metà del patto, e senza questo campo la UI non potrebbe dirlo.
    expect(a.righe.filter((r) => r.adiacente).map((r) => r.name)).toEqual([
      "VicinoSopra",
      "VicinoSotto",
    ]);
  });

  it("con 3 andati non si allarga: la soglia è inclusiva", () => {
    const a = andatiStessaFascia(
      stato(quattroAndati.slice(0, 3)),
      pool,
      BUDGET,
      "Chiamato",
    )!;
    expect(a.allargato).toBe(false);
    expect(a.righe.every((r) => !r.adiacente)).toBe(true);
    expect(MIN_ANDATI_PRIMA_DI_ALLARGARE).toBe(3);
  });

  it("un'assegnazione manuale non è un prezzo di mercato e non compare", () => {
    const conManuale: Preso[] = [
      ...quattroAndati,
      { playerId: "LiberoStessaFascia", role: "D", price: 25, lotSeq: null },
    ];
    const a = andatiStessaFascia(stato(conManuale), pool, BUDGET, "Chiamato")!;
    expect(a.righe.map((r) => r.name)).not.toContain("LiberoStessaFascia");
    // ⚠ Ma nei conteggi c'è: quello slot è occupato davvero, e chi guarda
    // «quanti ne restano» deve saperlo.
    expect(a).toMatchObject({ andati: 5, liberiRestanti: 0 });
  });

  it("il chiamato non compare fra i suoi comparabili", () => {
    const conSeStesso: Preso[] = [
      ...quattroAndati,
      { playerId: "Chiamato", role: "D", price: 33, lotSeq: 12 },
    ];
    const a = andatiStessaFascia(stato(conSeStesso), pool, BUDGET, "Chiamato")!;
    expect(a.righe.map((r) => r.name)).not.toContain("Chiamato");
    expect(a.totaleFascia).toBe(6);
  });

  it("senza fascia non c'è blocco, ed è `null` e non una lista vuota", () => {
    const senzaFascia: PoolPlayer = {
      id: "Ignoto",
      name: "Ignoto",
      team: "Inter",
      role: "D",
      fvm: 100,
      quot: 10,
    };
    expect(
      andatiStessaFascia(stato([]), [...pool, senzaFascia], BUDGET, "Ignoto"),
    ).toBeNull();
  });
});

// ─── §3.6 — la lettura per partecipante, e la normalizzazione ────────────────

describe("§3.6 — quanto ha speso ciascuno rispetto al piano dei suoi slot", () => {
  /** Un giocatore di ruolo `role`, nella fascia `rank`, con quel PMA. */
  function q(id: string, role: Role, rank: number, pma: number): PoolPlayer {
    return {
      id,
      name: id,
      team: "Inter",
      role,
      fvm: 100,
      quot: 10,
      fasciaGruppo: `${rank + 1}° Slot`,
      fasciaRank: rank,
      carmy: {
        extId: 1,
        fascia: `${rank + 1}° Slot`,
        prezzo: null,
        pma,
        titolarita: 4,
        affidabilita: null,
        integrita: null,
        fmvExp: null,
        tags: [],
        commento: null,
      },
    };
  }

  /**
   * ⚠ **Un pool costruito perché la scala grezza sia GONFIA**, come lo è quella
   * vera: le tre fasce di D hanno mediana 30 ciascuna, cioè 90 punti di scala
   * grezza, mentre la massa di D vale l'80% del foglio. Senza normalizzare,
   * ognuno risulterebbe sotto piano di quella differenza.
   */
  const pool: PoolPlayer[] = [
    // P: massa 20 punti → piano(P) = 20%.
    q("p1", "P", 0, 10),
    q("p2", "P", 0, 10),
    // D: massa 180 punti su 200 → piano(D) = 90%... no: 180/200 = 90%.
    q("d1", "D", 0, 30),
    q("d2", "D", 0, 30),
    q("d3", "D", 1, 30),
    q("d4", "D", 1, 30),
    q("d5", "D", 2, 30),
    q("d6", "D", 2, 30),
  ];

  /**
   * ⚠ **Il test che impedisce il ritorno del difetto per cui tutti risultavano
   * «sotto piano» del 17%** (§9.1). È anche ciò che rende §3.6 incapace di
   * contraddire §3.2: le due letture poggiano sullo stesso `piano(R)` per
   * costruzione, non per coincidenza.
   */
  it("⚠ la somma delle quote di un ruolo fa esattamente `piano(R)`", () => {
    const piano = pianoPerRuolo(pool);
    const scala = scalaSlotPerRuolo(pool);
    for (const role of ["P", "D", "C", "A"] as const) {
      const somma = scala[role].quote.reduce((a, b) => a + b, 0);
      // A e C non esistono nel foglio: quote vuote, somma 0, piano 0.
      expect(somma).toBeCloseTo(piano[role], 10);
    }
  });

  /**
   * ⚠ **Il difetto, riprodotto invece che raccontato.** Serve un pool con fasce
   * di **dimensione diversa**, che è come sono quelle vere: la scala grezza
   * somma le *mediane* — una per slot — mentre il piano viene dalla *massa*, che
   * conta tutti i candidati. Le due cose coincidono solo per coincidenza, e sul
   * foglio di riferimento non coincidono affatto: **116,6% contro 100**.
   *
   * Il verso qui è l'opposto di quello del foglio vero, e non importa: quello
   * che conta è che l'errore **sposta tutti nella stessa direzione**, cioè
   * produce una tabella in cui l'intero tavolo sembra risparmiare (o spendere)
   * e nessuno si distingue da nessuno. Una tabella così non dice niente.
   */
  it("⚠ senza normalizzare, la scala grezza dà un piano diverso — e sposta tutti insieme", () => {
    // Fasce di dimensione diversa: la 1ª ha due giocatori, la 2ª ne ha quattro.
    const sbilanciato: PoolPlayer[] = [
      q("x1", "D", 0, 50),
      q("x2", "D", 0, 50),
      q("y1", "D", 1, 10),
      q("y2", "D", 1, 10),
      q("y3", "D", 1, 10),
      q("y4", "D", 1, 10),
    ];

    const piano = pianoPerRuolo(sbilanciato);
    const scala = scalaSlotPerRuolo(sbilanciato);

    // La scala grezza — la somma delle due mediane — vale 60 punti, cioè 0,60
    // del budget. Il piano di D vale 1,00, perché D è l'unico ruolo del foglio.
    const grezza = (50 + 10) / 100;
    expect(grezza).toBeCloseTo(0.6, 10);
    expect(piano.D).toBeCloseTo(1, 10);
    // ⚠ **Non coincidono**: è esattamente la condizione in cui il mock ha
    // trovato tutti «sotto piano» del 17%.
    expect(grezza).not.toBeCloseTo(piano.D, 2);

    // Normalizzata, invece, la somma torna al piano — per costruzione.
    expect(scala.D.quote.reduce((a, b) => a + b, 0)).toBeCloseTo(piano.D, 10);

    // E la differenza è quella che si vedrebbe in tabella: chi ha riempito i due
    // slot ha un piano di 500 crediti, non i 300 che la scala grezza darebbe.
    const conDue = snapshot({
      auction: { ...snapshot().auction, currentRole: "D" },
      members: [
        member(ME, 0, {
          roster: rosaDi([
            { playerId: "x1", role: "D", price: 250, lotSeq: 1 },
            { playerId: "y1", role: "D", price: 150, lotSeq: 2 },
          ]),
        }),
      ],
    });
    const x = scartoPerPartecipante(conDue, sbilanciato, BUDGET)[0];
    expect(x.piano).toBe(500);
    expect(x.scarto).toBe(-100);
    // Con la scala grezza sarebbe stato piano 300 e scarto +100: segno opposto,
    // cioè la conclusione rovesciata sullo stesso identico stato.
    expect(Math.round(grezza * BUDGET)).toBe(300);
  });

  const stato = snapshot({
    auction: { ...snapshot().auction, currentRole: "D" },
    members: [
      // Ha preso due difensori spendendo 400: il piano dei suoi due slot è
      // (30+30)/90 × 0,90 × 500 = 300. Ha speso 100 in più.
      member(ME, 0, {
        roster: rosaDi([
          { playerId: "d1", role: "D", price: 250, lotSeq: 1 },
          { playerId: "d3", role: "D", price: 150, lotSeq: 3 },
        ]),
      }),
      // Stessi due slot, 200 spesi: 100 in meno del piano.
      member(OTHER, 1, {
        roster: rosaDi([
          { playerId: "d2", role: "D", price: 120, lotSeq: 2 },
          { playerId: "d4", role: "D", price: 80, lotSeq: 4 },
        ]),
      }),
      member(THIRD, 2),
    ],
  });

  it("chi ha speso più del piano si distingue da chi ha speso meno", () => {
    const scarti = scartoPerPartecipante(stato, pool, BUDGET);
    const mio = scarti.find((x) => x.memberId === ME)!;
    const altro = scarti.find((x) => x.memberId === OTHER)!;

    expect(mio).toMatchObject({ speso: 400, piano: 300, scarto: 100 });
    expect(altro).toMatchObject({ speso: 200, piano: 300, scarto: -100 });
    // ⚠ **Lo spread è il punto**: senza normalizzazione entrambi sarebbero
    // negativi e la tabella direbbe che tutti risparmiano, cioè niente.
    expect(Math.sign(mio.scarto)).not.toBe(Math.sign(altro.scarto));
  });

  it("chi non ha comprato niente non ha né speso né piano: zero, non un negativo", () => {
    const terzo = scartoPerPartecipante(stato, pool, BUDGET).find(
      (x) => x.memberId === THIRD,
    )!;
    expect(terzo).toMatchObject({ speso: 0, piano: 0, scarto: 0, perRuolo: [] });
  });

  /**
   * ⚠ **Gli acquisti si ordinano per prezzo decrescente**, non nell'ordine in
   * cui li ha presi: è il modo in cui il foglio ordina gli slot. Le stesse due
   * cifre in ordine inverso devono dare lo stesso piano — se il codice leggesse
   * l'ordine di estrazione, un membro che ha preso prima il difensore da 150
   * risulterebbe con un piano diverso a parità di rosa.
   */
  it("l'ordine di estrazione non cambia il piano: contano le cifre, non la cronologia", () => {
    const alContrario = snapshot({
      auction: { ...stato.auction },
      members: [
        member(ME, 0, {
          roster: rosaDi([
            { playerId: "d3", role: "D", price: 150, lotSeq: 1 },
            { playerId: "d1", role: "D", price: 250, lotSeq: 3 },
          ]),
        }),
      ],
    });
    expect(scartoPerPartecipante(alContrario, pool, BUDGET)[0].piano).toBe(300);
  });

  it("il piano cresce con gli slot riempiti, non col budget intero", () => {
    // Un solo difensore: il piano è quello del 1° slot e basta.
    const unoSolo = snapshot({
      auction: { ...stato.auction },
      members: [
        member(ME, 0, {
          roster: rosaDi([{ playerId: "d1", role: "D", price: 100, lotSeq: 1 }]),
        }),
      ],
    });
    // 30/90 × 0,90 × 500 = 150.
    expect(scartoPerPartecipante(unoSolo, pool, BUDGET)[0].piano).toBe(150);
  });

  it("le assegnazioni manuali entrano: quei crediti li ha spesi davvero", () => {
    const conManuale = snapshot({
      auction: { ...stato.auction },
      members: [
        member(ME, 0, {
          roster: rosaDi([
            { playerId: "d1", role: "D", price: 250, lotSeq: null },
          ]),
        }),
      ],
    });
    expect(scartoPerPartecipante(conManuale, pool, BUDGET)[0].speso).toBe(250);
  });

  it("più acquisti che fasce: gli slot in eccesso valgono zero, non una quota inventata", () => {
    const quattro = snapshot({
      auction: { ...stato.auction },
      members: [
        member(ME, 0, {
          roster: rosaDi(
            ["d1", "d2", "d3", "d4"].map((playerId, i) => ({
              playerId,
              role: "D" as Role,
              price: 50,
              lotSeq: i + 1,
            })),
          ),
        }),
      ],
    });
    // Tre fasce sole: il piano è la loro somma intera, cioè piano(D) × budget.
    expect(scartoPerPartecipante(quattro, pool, BUDGET)[0].piano).toBe(450);
  });

  it("il totale è la somma dei ruoli, e i ruoli restano leggibili a parte", () => {
    const misto = snapshot({
      auction: { ...stato.auction },
      members: [
        member(ME, 0, {
          roster: rosaDi([
            { playerId: "p1", role: "P", price: 60, lotSeq: 1 },
            { playerId: "d1", role: "D", price: 250, lotSeq: 2 },
          ]),
        }),
      ],
    });
    const x = scartoPerPartecipante(misto, pool, BUDGET)[0];
    expect(x.perRuolo.map((r) => r.role)).toEqual(["P", "D"]);
    expect(x.speso).toBe(310);
    expect(x.piano).toBe(x.perRuolo.reduce((s, r) => s + r.piano, 0));
  });
});

// ─── §2.2 e §3.4 — i due fatti dichiarati in testa alla tab ──────────────────

describe("§2.2 — lo scarto strutturale si calcola, non si scrive", () => {
  const pool: PoolPlayer[] = [
    p("a", { role: "A", pma: 40 }),
    p("b", { role: "A", pma: 40 }),
    p("c", { role: "D", pma: 20 }),
  ];

  function conMembri(n: number) {
    return snapshot({
      members: Array.from({ length: n }, (_, i) => member(`m${i}`, i)),
    });
  }

  it("il listone vale la somma dei PMA in crediti, il tavolo il budget per i posti", () => {
    // 40% + 40% + 20% di 500 = 200 + 200 + 100 = 500 crediti di listone.
    const s = scartoStrutturale(conMembri(2), pool, BUDGET);
    expect(s.valoreListone).toBe(500);
    expect(s.budgetTavolo).toBe(1_000);
    expect(s.copertura).toBe(2);
  });

  /**
   * ⚠ **La frase «siete in 8 su un foglio tarato per 10» è vera per un tavolo e
   * falsa per un altro**, e questo è il test che impedisce di scriverla come
   * costante: con pochi partecipanti si compra meno del listone, con tanti di
   * più, e una frase fissa direbbe la cosa sbagliata proprio al tavolo che ne
   * avrebbe più bisogno.
   */
  it("con meno partecipanti la copertura scende: il numero segue il tavolo", () => {
    expect(scartoStrutturale(conMembri(1), pool, BUDGET).copertura).toBe(1);
    expect(scartoStrutturale(conMembri(4), pool, BUDGET).copertura).toBe(4);
  });

  it("un pool senza PMA non è una divisione per zero", () => {
    expect(scartoStrutturale(conMembri(8), [p("x", { pma: null })], BUDGET))
      .toMatchObject({ valoreListone: 0, copertura: 1 });
  });
});

describe("§3.4 — i lotti al minimo sono un fatto loro, non un buco", () => {
  const pool: PoolPlayer[] = [
    p("caro1", { role: "D", pma: 6 }),
    p("caro2", { role: "D", pma: 6 }),
    p("misero", { role: "D", pma: 0.2 }),
  ];

  it("conta i lotti chiusi a 1 credito, informativi o no", () => {
    const s = snapshot({
      auction: { ...snapshot().auction, currentRole: "D" },
      members: [
        member(ME, 0, {
          roster: rosaDi([
            { playerId: "caro1", role: "D", price: 1, lotSeq: 1 },
            { playerId: "caro2", role: "D", price: 30, lotSeq: 2 },
            // ⚠ Scartato dal termometro (PMA da 1 credito) ma **contato qui**:
            // la domanda è «quanto si sta contendendo», e a quella risponde.
            { playerId: "misero", role: "D", price: 1, lotSeq: 3 },
          ]),
        }),
      ],
    });
    expect(lottiAlMinimo(s, "D")).toEqual({ alMinimo: 2, totale: 3 });
    // E il termometro ne vede due, non tre: i due insiemi sono diversi apposta.
    expect(lottiInformativi(s, pool, BUDGET, "D")).toHaveLength(2);
  });

  it("le assegnazioni manuali non contano: non sono lotti", () => {
    const s = snapshot({
      auction: { ...snapshot().auction, currentRole: "D" },
      members: [
        member(ME, 0, {
          roster: rosaDi([{ playerId: "caro1", role: "D", price: 1, lotSeq: null }]),
        }),
      ],
    });
    expect(lottiAlMinimo(s, "D")).toEqual({ alMinimo: 0, totale: 0 });
  });
});

// ─── §8 — due stati che si assomigliano e non sono la stessa cosa ────────────

describe("§8 — «ancora nessun lotto» e «serve un listone» sono stati diversi", () => {
  /**
   * ⚠ **Il primo passa da sé, il secondo no**, ed è tutta la differenza. A
   * inizio ruolo non c'è ancora nessun lotto informativo, e fra dieci minuti ce
   * ne saranno; senza PMA non ne arriverà **nessuno per tutta l'asta**. Con una
   * frase sola per entrambi, chi è nel secondo caso aspetterebbe fino alla fine
   * un numero che non può arrivare.
   */
  it("un pool con PMA lo dichiara, uno senza no", () => {
    expect(haPma([p("x", { pma: 6 })])).toBe(true);
    expect(haPma([p("x", { pma: null })])).toBe(false);
    expect(haPma([])).toBe(false);
  });

  it("⚠ un pool senza PMA e un ruolo appena cominciato danno lo stesso `null`", () => {
    // È la ragione per cui `haPma` esiste: la temperatura da sola non
    // distingue i due casi, quindi la UI non potrebbe distinguerli.
    const vuoto = snapshot({
      auction: { ...snapshot().auction, currentRole: "D" },
      members: [member(ME, 0)],
    });
    const conPma = [p("d1", { role: "D", pma: 6 })];
    const senzaPma = [p("d1", { role: "D", pma: null })];

    expect(temperatura(lottiInformativi(vuoto, conPma, BUDGET, "D"))).toBeNull();
    expect(temperatura(lottiInformativi(vuoto, senzaPma, BUDGET, "D"))).toBeNull();
    // Identici lì, distinguibili qui:
    expect([haPma(conPma), haPma(senzaPma)]).toEqual([true, false]);
  });
});
