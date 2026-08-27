import type { MetadataRoute } from "next";

/**
 * Il manifest dell'applicazione installabile (M20 §4).
 *
 * Next lo serve su **`/manifest.webmanifest`** e ne emette il `<link>` da sé, per
 * la stessa convenzione con cui trova le icone dentro `app/`. Non c'è un
 * `middleware.ts` in questo progetto — l'autenticazione è per pagina, con
 * `requireUser()` — quindi la rotta è **pubblica**, come deve essere: il browser
 * scarica il manifest **senza credenziali**, e un manifest dietro una sessione
 * renderebbe l'app non installabile senza dare nessun errore comprensibile.
 *
 * ⚠ **Questa è la metà che ribalta una decisione scritta.** `DECISIONS.md` del
 * 2026-08-18 diceva «nessun manifest, nessuna PWA, nessun service worker», con la
 * motivazione che l'installabilità era una superficie in più che nessuno aveva
 * chiesto. Adesso è chiesta, dall'owner in prima persona: cambia il fatto, non il
 * ragionamento — e il **service worker resta fuori**, per la ragione scritta in
 * §5 e nella voce del 2026-08-27.
 *
 * Le scelte che non sono ovvie:
 *
 * - **`start_url: "/"`** e non `/dashboard`: la radice smista già da sé per stato
 *   di sessione (`signin` → `verify` → `onboarding` → `dashboard`, in
 *   `app/page.tsx`). Puntare alla dashboard vorrebbe dire che l'app installata si
 *   apre su un redirect per chi non è entrato.
 * - **Nessun `orientation`.** Il portale è verticale e la TV è orizzontale, e sono
 *   la stessa applicazione: fissare un orientamento qui sarebbe imporre la scelta
 *   di una vista all'altra.
 * - **`theme_color` e `background_color` bianchi.** Il bianco è `--background`
 *   (`oklch(1 0 0)`) e la navbar è `bg-background`: una barra di stato colorata
 *   sopra una navbar bianca si legge come un difetto di allineamento, non come un
 *   tocco di marchio. Il `background_color` è anche lo splash su Android, e l'app
 *   apre bianca — così non c'è un lampo di colore prima della pagina.
 * - ⚠ **Quattro voci di icona per due file**, e non due voci con
 *   `purpose: "any maskable"`. La stringa doppia la specifica del W3C la ammette,
 *   ma il tipo di Next è `'any' | 'maskable' | 'monochrome'` — verificato in
 *   `node_modules/next/dist/lib/metadata/types/manifest-types.d.ts`, non dedotto —
 *   quindi sarebbe un **errore di typecheck**, cioè una build rossa al gate.
 *   Funziona perché il disegno è a tela piena col marchio centrato: il suo angolo
 *   più lontano dal centro sta al 28,6% del lato, dentro la zona sicura di Android
 *   che è il 40%. La stessa immagine è giusta ritagliata e non ritagliata, e il
 *   ritaglio circolare è stato guardato (M20-03).
 * - **Le due icone stanno in `public/`**, non in `app/`: qui servono URL
 *   **stabili**, e le rotte generate da `app/` portano un hash che cambia col
 *   contenuto. ⚠ E i loro nomi non sono `icon.png` perché collide con la rotta
 *   `/icon.png`: `public/README.md` lo spiega accanto ai file.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fantasta — Asta Fantacalcio",
    short_name: "Fantasta",
    description: "Asta di Fantacalcio a busta chiusa, in diretta.",
    lang: "it",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
