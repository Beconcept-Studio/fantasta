import { access, constants } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";

/**
 * M20 — il manifest dell'app installabile.
 *
 * ⚠ **Questa macro ha un modo preciso di rompersi in silenzio**, e questo file
 * esiste per quello: il manifest dichiara due icone **per URL**, e se uno dei due
 * file non c'è — un rinomino «per pulizia», una cartella `public/` che qualcuno
 * pulisce, uno script cambiato a metà — il manifest continua a rispondere con un
 * JSON valido, la pagina continua a funzionare, i test continuano a passare, e
 * **l'app non si installa più**. Non c'è nessun sintomo visibile da qui: si
 * scopre col telefono in mano, la sera dell'asta.
 *
 * Quindi il controllo che conta non è sui campi — quelli sono un oggetto
 * letterale, e un test che li rilegge prova solo che TypeScript sa copiare — ma
 * l'**ultimo `it` di questo file**: che i percorsi dichiarati esistano su disco.
 * Gli altri stanno qui perché tre di quei campi cambiano il comportamento
 * dell'installazione e nessuno di loro si vede in una pagina: `display`,
 * `start_url` e la coppia di `purpose`.
 *
 * Cosa questo file **non** prova, per non dare l'impressione che lo faccia: che
 * la rotta risponda `200` senza sessione (in locale si guarda con un `curl`, in
 * produzione è il task M20-07), e che il telefono installi davvero (M20-05, e
 * vuole un iPhone).
 */

const m = manifest();

describe("il manifest dell'app installabile", () => {
  it("dichiara i campi da cui dipende l'installazione", () => {
    // `standalone` è ciò che apre l'app **senza barra degli indirizzi**: senza
    // questo campo l'icona sulla schermata home resta un segnalibro di Safari.
    expect(m.display).toBe("standalone");

    // La radice, non `/dashboard`: `app/page.tsx` smista per stato di sessione, e
    // puntare alla dashboard aprirebbe l'app installata su un redirect per chi
    // non è entrato.
    expect(m.start_url).toBe("/");

    // Il nome sotto l'icona, che è il posto in cui lo spazio è poco.
    expect(m.short_name).toBe("Fantasta");
    expect(m.name).toContain("Fantasta");

    // Bianchi entrambi, come `--background`: la barra di stato non stacca dalla
    // navbar, e lo splash di Android non fa un lampo di colore.
    expect(m.theme_color).toBe("#ffffff");
    expect(m.background_color).toBe("#ffffff");

    // ⚠ **Nessun `orientation`**, e non è una dimenticanza: il portale è verticale
    // e la TV è orizzontale, e sono la stessa applicazione (M20 §4).
    expect(m.orientation).toBeUndefined();
  });

  it("ha quattro voci di icona per due file: ogni misura una volta `any` e una `maskable`", () => {
    const icone = m.icons ?? [];
    expect(icone).toHaveLength(4);

    // ⚠ Quattro voci e non due con `purpose: "any maskable"`, che il W3C ammette
    // e il tipo di Next no (`'any' | 'maskable' | 'monochrome'`): la stringa
    // doppia sarebbe un errore di typecheck, cioè una build rossa al gate.
    for (const misura of ["192x192", "512x512"]) {
      const voci = icone.filter((i) => i.sizes === misura);
      expect(voci.map((i) => i.purpose).sort()).toEqual(["any", "maskable"]);
      // Lo stesso file per i due scopi: funziona perché il disegno è a tela piena
      // col marchio centrato, e il suo angolo più lontano sta al 28,6% del lato
      // contro il 40% della zona sicura di Android.
      expect(new Set(voci.map((i) => i.src)).size).toBe(1);
      for (const voce of voci) expect(voce.type).toBe("image/png");
    }
  });

  it("⚠ i due file dichiarati esistono su disco, ed è il test che prende il rinomino", async () => {
    const percorsi = [...new Set((m.icons ?? []).map((i) => String(i.src)))];
    expect(percorsi.sort()).toEqual(["/icon-192.png", "/icon-512.png"]);

    for (const src of percorsi) {
      // Gli URL del manifest sono assoluti sulla radice del sito, e in `public/`
      // il percorso è lo stesso senza lo slash iniziale: è la convenzione di Next,
      // e questa riga è il punto in cui le due cose si tengono insieme.
      const suDisco = path.join(process.cwd(), "public", src.replace(/^\//, ""));
      await expect(
        access(suDisco, constants.R_OK),
        `${src} è dichiarato nel manifest ma ${suDisco} non c'è: l'app non si installa, e nient'altro se ne accorge`,
      ).resolves.toBeUndefined();
    }
  });
});
