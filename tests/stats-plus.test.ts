import { describe, expect, it } from "vitest";

import type { Role } from "@/lib/domain";
import {
  MIN_LOTTI_PER_PARTE,
  SOGLIA_AVVISO,
  SOGLIA_LOTTO_INFORMATIVO,
  avvisi,
  lottiInformativi,
  pct,
  pianoPerRuolo,
  saldoRuoliChiusi,
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
