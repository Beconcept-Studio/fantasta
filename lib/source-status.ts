import { type RefreshSource, REFRESH_SOURCE_LABELS } from "@/lib/domain";
import { when } from "@/lib/when";

/**
 * Come si racconta l'ultimo tentativo di una fonte pubblica (M11 §5).
 *
 * ## Perché è un file suo, e non due componenti che scrivono le stesse frasi
 *
 * Perché i chiamanti sono **due, e stanno in due mondi diversi**: l'avviso in cima
 * alla sezione Listone è un componente server, la riga accanto al pulsante vive
 * dentro `InsightsPanel`, che è `"use client"`. Le stesse frasi scritte in due
 * posti divergono al primo ritocco — e queste due, se divergono, dicono due cose
 * diverse dello stesso guasto nella stessa pagina. Zero dipendenze oltre ai nomi
 * di `lib/domain.ts`, così la versione client non si porta dietro niente.
 *
 * ## Il tipo è piatto, e non è pigrizia
 *
 * ⚠ `SourceRunStatus` **non contiene la riga di Drizzle**. Un `SourceRunRow` nelle
 * props di un client component vorrebbe dire `import type` da `@/lib/db/schema`
 * dentro `components/**`, cioè esattamente la cosa che la regola ESLint su
 * `lib/db` esiste per rendere impossibile — anche in versione «solo il tipo»,
 * perché la regola non ammette eccezioni discrezionali. Il motore appiattisce la
 * riga in questo oggetto, che è anche l'unica forma che passa il confine
 * server → client.
 */
export type SourceRunStatus = {
  source: RefreshSource;
  /** `null` = nessun tentativo registrato: la tabella nasce vuota. */
  ok: boolean | null;
  attemptedAt: Date | null;
  /** Fallimenti consecutivi. `0` dopo un successo. */
  failures: number;
  message: string | null;
  /** Righe lette dalla fonte all'ultimo tentativo riuscito. */
  rows: number | null;
  trigger: "auto" | "manual" | null;
  /** Quando si riproverà, al più presto. `null` = al primo giro utile. */
  nextAttemptAt: Date | null;
};

export type SourceRunTone = "ok" | "fail" | "never";

export type SourceRunNarrative = {
  tone: SourceRunTone;
  /** Il nome della fonte, come sul pulsante che la aggiorna. */
  label: string;
  /** La frase che dice com'è andata. Corta: è quella che si legge di sfuggita. */
  headline: string;
  /** Quando, e da dove è partito il tentativo. `null` se non ce n'è stato uno. */
  detail: string | null;
  /** Il messaggio della fonte, solo quando è fallita. */
  message: string | null;
  /** Quando riproverà da sé. */
  next: string;
};

/**
 * I numeri a parole fino a dieci.
 *
 * ⚠ Serve a una frase precisa della spec: dopo tre fallimenti il pannello deve
 * dire «**da tre volte**», non «fallito». La differenza fra le due è tutta
 * l'informazione — «fallito» è un incidente, «da tre volte» è un guasto — e a
 * parole si legge come una frase invece che come un contatore.
 */
const VOLTE = [
  "zero",
  "una",
  "due",
  "tre",
  "quattro",
  "cinque",
  "sei",
  "sette",
  "otto",
  "nove",
  "dieci",
];

function volte(n: number): string {
  return VOLTE[n] ?? String(n);
}

/** «da sé» o «a mano»: è la distinzione fra l'automatismo e il pulsante. */
function comeFrom(trigger: "auto" | "manual" | null): string {
  return trigger === "manual" ? "a mano" : "da sé";
}

export function describeSourceRun(
  status: SourceRunStatus,
): SourceRunNarrative {
  const label = REFRESH_SOURCE_LABELS[status.source];
  const quando = status.attemptedAt === null ? null : when(status.attemptedAt);
  const next =
    status.nextAttemptAt === null
      ? "Ci proverà da sé entro un quarto d'ora."
      : `Riproverà da sé a partire dal ${when(status.nextAttemptAt)}.`;

  // Nessun tentativo registrato. È lo stato in cui la tabella nasce in
  // produzione, e **non è un guasto**: va detto senza allarmare, perché il primo
  // tick utile lo risolve da sé.
  if (status.ok === null) {
    return {
      tone: "never",
      label,
      headline: "Non è ancora stato chiesto nessun aggiornamento.",
      detail: null,
      message: null,
      next,
    };
  }

  // ⚠ Quando è andata bene, il *quando* sta dentro la frase e non in una riga
  // sua. Tenuto a parte diventava «Aggiornato da sé: 497 righe dalla fonte. Il 13
  // agosto, 06:12.» — una data isolata che si legge come una frase interrotta.
  if (status.ok) {
    const testa = `Aggiornato ${comeFrom(status.trigger)}${quando === null ? "" : ` il ${quando}`}`;
    return {
      tone: "ok",
      label,
      headline:
        status.rows === null
          ? `${testa}.`
          : `${testa} — ${status.rows} righe dalla fonte.`,
      detail: null,
      message: null,
      next,
    };
  }

  return {
    tone: "fail",
    label,
    // ⚠ Una volta è un incidente e si dice come tale; da due in su è un guasto
    // che dura, e il numero **è** la notizia. Le due frasi cominciano nello stesso
    // modo di proposito — «Non si è aggiornato» / «Non si aggiorna da tre volte» —
    // così passare dall'una all'altra si legge come un peggioramento e non come
    // un messaggio diverso.
    headline:
      status.failures <= 1
        ? "Non si è aggiornato."
        : `Non si aggiorna da ${volte(status.failures)} volte.`,
    detail:
      quando === null
        ? null
        : `Ultimo tentativo ${comeFrom(status.trigger)}, il ${quando}`,
    message: status.message,
    next,
  };
}

/**
 * Le fonti in guasto, se ce ne sono.
 *
 * ⚠ **Un fallimento in corso non è una riga di dettaglio**: è la cosa più
 * importante della pagina, e questa funzione è ciò che decide se l'avviso in cima
 * compare. Un successo non ha bisogno di raccontarsi lì — un avviso che c'è sempre
 * si smette di leggere, e il giorno che serve non lo si vede.
 */
export function failingSources(
  statuses: SourceRunStatus[],
): SourceRunStatus[] {
  return statuses.filter((s) => s.ok === false);
}
