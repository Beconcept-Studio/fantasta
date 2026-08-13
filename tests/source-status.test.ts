import { describe, expect, it } from "vitest";

import {
  type SourceRunStatus,
  describeSourceRun,
  failingSources,
} from "@/lib/source-status";

/**
 * Le frasi con cui il pannello racconta l'ultimo tentativo (M11 §5).
 *
 * ⚠ Sono provate qui, e non guardando la pagina, per una ragione precisa: questo
 * è l'**unico** modo in cui M11 parla. Un automatismo che riesce non ha bisogno di
 * raccontarlo, uno che fallisce in silenzio è peggio di nessun automatismo — e se
 * la frase sbagliata è «fallito» al posto di «da tre volte», la differenza fra un
 * incidente e un guasto che dura sparisce senza che nessun test rosso lo dica.
 */

const base: SourceRunStatus = {
  source: "listone_insights",
  ok: true,
  attemptedAt: new Date(Date.UTC(2026, 7, 13, 4, 12)),
  failures: 0,
  message: null,
  rows: 497,
  trigger: "auto",
  nextAttemptAt: new Date(Date.UTC(2026, 7, 14, 4, 12)),
};

describe("describeSourceRun", () => {
  it("un successo automatico dice quante righe, quando, e quando riproverà", () => {
    const said = describeSourceRun(base);
    expect(said.tone).toBe("ok");
    expect(said.label).toBe("Titolarità e rigori storici");
    expect(said.headline).toBe(
      "Aggiornato da sé il 13 ago 2026, 06:12 — 497 righe dalla fonte.",
    );
    expect(said.next).toContain("14 ago 2026, 06:12");
  });

  it("⚠ distingue un successo automatico da uno a mano", () => {
    // È la verifica 7 della spec, prima metà. Senza questa distinzione, i due
    // pulsanti e il loop racconterebbero la stessa storia con le stesse parole, e
    // nessuno saprebbe se l'automatismo funziona.
    expect(describeSourceRun(base).headline).toContain("da sé");
    expect(
      describeSourceRun({ ...base, trigger: "manual" }).headline,
    ).toContain("a mano");
  });

  it("⚠ dopo tre fallimenti dice «da tre volte», non «fallito»", () => {
    // È la verifica 7, seconda metà, e la frase è letterale nella spec: «fallito»
    // è un incidente, «da tre volte» è un guasto che dura. Sono due notizie
    // diverse, e la seconda è quella che fa aprire il pannello.
    const uno = describeSourceRun({
      ...base,
      ok: false,
      failures: 1,
      rows: null,
      message: "La fonte ha risposto 503.",
    });
    expect(uno.tone).toBe("fail");
    expect(uno.headline).toBe("Non si è aggiornato.");

    const tre = describeSourceRun({
      ...base,
      ok: false,
      failures: 3,
      rows: null,
      message: "La fonte ha risposto 503.",
    });
    expect(tre.headline).toBe("Non si aggiorna da tre volte.");
    expect(tre.detail).toBe("Ultimo tentativo da sé, il 13 ago 2026, 06:12");
    // Il messaggio della fonte esce così com'è: è già scritto per essere letto.
    expect(tre.message).toBe("La fonte ha risposto 503.");
  });

  it("i numeri sono a parole fino a dieci, e poi in cifre", () => {
    const volte = (failures: number) =>
      describeSourceRun({ ...base, ok: false, failures, rows: null }).headline;
    expect(volte(2)).toBe("Non si aggiorna da due volte.");
    expect(volte(10)).toBe("Non si aggiorna da dieci volte.");
    // Oltre dieci non serve una parola: a quel punto il numero è la notizia.
    expect(volte(14)).toBe("Non si aggiorna da 14 volte.");
  });

  it("⚠ «non ho mai provato» non è un guasto, e non si colora come tale", () => {
    // È lo stato in cui la tabella nasce in produzione, il giorno del deploy.
    const said = describeSourceRun({
      ...base,
      ok: null,
      attemptedAt: null,
      rows: null,
      trigger: null,
      nextAttemptAt: null,
    });
    expect(said.tone).toBe("never");
    expect(said.next).toContain("quarto d'ora");
  });

  it("⚠ i due orari sono in ora italiana, non in UTC", () => {
    // Il server gira in UTC, processo compreso: senza il fuso, un tentativo delle
    // 23:30 comparirebbe come del giorno prima — e questa data è ciò su cui si
    // decide se fidarsi dei numeri.
    const said = describeSourceRun({
      ...base,
      attemptedAt: new Date(Date.UTC(2026, 7, 13, 22, 30)),
    });
    expect(said.headline).toContain("14 ago 2026, 00:30");
  });
});

describe("failingSources", () => {
  it("è ciò che decide se l'avviso in cima compare", () => {
    const rotta: SourceRunStatus = { ...base, source: "set_pieces", ok: false };
    const mai: SourceRunStatus = { ...base, ok: null };

    // ⚠ Un successo non passa da qui, e nemmeno un «mai provato»: un avviso che
    // c'è sempre si smette di leggere, e il giorno che serve non lo si vede.
    expect(failingSources([base, mai])).toEqual([]);
    expect(failingSources([base, rotta]).map((s) => s.source)).toEqual([
      "set_pieces",
    ]);
  });
});
