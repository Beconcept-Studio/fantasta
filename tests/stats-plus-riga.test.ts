import { describe, expect, it } from "vitest";

import { ROLES, ROLE_LABELS } from "@/lib/domain";
import {
  MAX_CARATTERI_RIGA,
  POSIZIONE_STATS,
  POSIZIONI_STATS,
  rigaStatsPlus,
} from "@/components/auction/stats-plus";
import type { Alternativa, Alternative } from "@/lib/stats-plus";

/**
 * §9.1 — **la lunghezza della riga del modale, misurata su tutte le varianti.**
 *
 * ⚠ **È un test sulle stringhe, non sul rendering, e vale quanto un test di
 * layout**: a 46 caratteri il blocco raddoppia d'altezza — da 31px a 49px,
 * misurato — e rimette i ~44px che M16 aveva restituito al campo, disfacendo una
 * decisione presa apposta senza che nessuno la prenda.
 *
 * ⚠ **E la spec ci era già cascata due volte.** La prima stesura di quelle righe
 * andava a capo; la terza scriveva come esempio «Scatto: D da −25% a +14% · 5
 * pari livello, 2 tuoi», che sono **49 caratteri** — quattro oltre il limite
 * dichiarato cinque righe più sotto. Una forma scritta a mano non si contraddice
 * da sé: va contata. Per questo qui si enumera, invece di guardare un caso.
 */

function alt(obiettivo: boolean): Alternativa {
  return {
    playerId: "x",
    name: "x",
    team: "Inter",
    titolarita: 4,
    startsEleven: null,
    presenze: null,
    tags: [],
    fmvExp: null,
    pma: 5,
    atteso: 25,
    fasciaRank: 1,
    deltaRank: 0,
    obiettivo,
  };
}

function alternative(pari: number, tuoi: number): Alternative {
  return {
    pariLivello: Array.from({ length: pari }, (_, i) => alt(i < tuoi)),
    costanoMeno: [],
    ripiego: [],
  };
}

describe("§5.1 — la riga del modale sta sotto i 45 caratteri, sempre", () => {
  /**
   * ⚠ **La griglia comprende i casi che nessuno guarda scrivendo una spec**: il
   * ruolo col nome più lungo (`Centrocampisti`, 14 caratteri contro gli 8 di
   * `Portieri`), le percentuali a tre e quattro cifre — un lotto da 5 crediti
   * chiuso a 100 fa `+1900%` — e un conteggio di alternative a due cifre.
   */
  const rapporti = [0, 0.5, 0.75, 1, 1.14, 2, 20, 100];
  const conteggi = [0, 1, 5, 12, 99];

  it("ogni combinazione di ruolo, regime, percentuali e conteggi", () => {
    const troppoLunghe: string[] = [];
    let generate = 0;

    for (const role of ROLES) {
      for (const n of [1, 4, 18, 240]) {
        for (const mediana of rapporti) {
          for (const pari of conteggi) {
            for (const tuoi of [0, pari]) {
              for (const conScatto of [false, true]) {
                for (const adesso of rapporti) {
                  const riga = rigaStatsPlus({
                    role,
                    temperatura: { n, min: mediana, mediana, max: mediana },
                    scatto: conScatto ? { prima: mediana, adesso } : null,
                    alternative: alternative(pari, tuoi),
                  })!;
                  generate += 1;
                  if (riga.length > MAX_CARATTERI_RIGA) troppoLunghe.push(riga);
                }
              }
            }
          }
        }
      }
    }

    // La griglia è davvero grande: se un refuso la riducesse a quattro casi, il
    // test resterebbe verde e non proverebbe più niente.
    expect(generate).toBeGreaterThan(5_000);
    expect(troppoLunghe).toEqual([]);
  });

  it("anche le frasi degli stati normali stanno nel budget", () => {
    for (const role of ROLES) {
      const riga = rigaStatsPlus({
        role,
        temperatura: null,
        scatto: null,
        alternative: null,
      })!;
      expect(riga.length).toBeLessThanOrEqual(MAX_CARATTERI_RIGA);
      // ⚠ Una frase, non un `—` muto (§8).
      expect(riga).toContain(ROLE_LABELS[role]);
      expect(riga.length).toBeGreaterThan(10);
    }
  });

  /**
   * ⚠ **La coda si perde per prima, e la testa non si perde mai.** È la scelta
   * che rende la riga sempre leggibile: il livello del ruolo è il perché della
   * riga, il conteggio delle alternative è un di più. Senza questo test,
   * qualcuno potrebbe "risolvere" un caso lungo troncando la stringa — e una
   * riga tagliata a metà è peggio di una riga corta.
   */
  it("quando non ci sta tutto, cade il conteggio e resta il livello", () => {
    const lunga = rigaStatsPlus({
      role: "C",
      temperatura: { n: 18, min: 0.5, mediana: 0.5, max: 2 },
      scatto: { prima: 0.05, adesso: 20 },
      alternative: alternative(99, 99),
    })!;
    expect(lunga).toContain(ROLE_LABELS.C);
    expect(lunga).not.toContain("pari");
    expect(lunga.length).toBeLessThanOrEqual(MAX_CARATTERI_RIGA);
    // Nessun troncamento: la riga finisce con un dato intero, non a metà parola.
    expect(lunga.endsWith("…")).toBe(false);
  });

  it("senza alternative la coda non c'è, e non lascia un `·` orfano", () => {
    const riga = rigaStatsPlus({
      role: "P",
      temperatura: { n: 3, min: 0.75, mediana: 0.75, max: 0.75 },
      scatto: null,
      alternative: alternative(0, 0),
    })!;
    expect(riga).not.toContain("·");
    // ⚠ **Il meno è quello ASCII, non il `−` tipografico che la spec scrive in
    // prosa.** È quello che produce il numero, e una seconda rappresentazione
    // della stessa cosa è una che prima o poi diverge: metà schermate con `-` e
    // metà con `−`. Se un giorno servisse quello tipografico — per allineare i
    // segni in una colonna `tabular-nums` — si cambia in `segnato`, che è
    // l'unico posto che lo scrive.
    expect(riga).toBe("Portieri -25% su 3");
  });

  it("il segno c'è sempre: `14%` da solo si leggerebbe come un livello", () => {
    const riga = rigaStatsPlus({
      role: "D",
      temperatura: { n: 5, min: 1.14, mediana: 1.14, max: 1.14 },
      scatto: null,
      alternative: null,
    })!;
    expect(riga).toContain("+14%");
  });

  it("`POSIZIONE_STATS` è una delle quattro forme dichiarate", () => {
    expect(POSIZIONI_STATS).toContain(POSIZIONE_STATS);
    expect(POSIZIONI_STATS).toEqual(["campo", "tab", "entrambi", "spento"]);
  });
});
