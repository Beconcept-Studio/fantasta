import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Navbar } from "@/components/nav/navbar";
import { currentUser } from "@/lib/auth";
import { isAppAdmin } from "@/lib/domain";

/**
 * La versione mostrata nella navbar viene da `package.json`, letta **qui** e
 * passata alla navbar come stringa.
 *
 * L'import sta in questo file, che è un server component, e non dentro la
 * navbar, che è `"use client"`: importare `package.json` da un componente client
 * farebbe viaggiare fino al browser l'elenco completo delle dipendenze per
 * mostrare cinque caratteri. Così esce solo la stringa.
 *
 * Il numero è quello del `package.json` con cui l'applicazione è stata
 * **compilata**, che è esattamente ciò che serve per un controllo a vista: il
 * deploy fa `pnpm build` sul server dopo il checkout, quindi ciò che si legge
 * nella navbar è la versione del codice che sta rispondendo — non quella che
 * qualcuno ha scritto in un file di configurazione.
 *
 * ⚠ **Import del default, non del campo.** `import { version } from` faceva
 * emettere a `next build` l'avviso «only default export is available soon»: un
 * modulo JSON esporrà solo il default, e quel giorno la named import non
 * compilerebbe più. Il default si destruttura qui sotto, e non cambia niente per
 * il browser — questo file è un server component, quindi l'oggetto intero non
 * lascia il server e alla navbar arriva sempre e solo la stringa.
 */
import packageJson from "../package.json";

const appVersion = packageJson.version;

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * ⚠ **`appleWebApp` è deliberatamente ridondante col manifest** (M20 §5), come
 * `proxy_buffering off` e `X-Accel-Buffering` sulla rotta dello stream: Safari
 * legge ancora questi tre `<meta>` — `apple-mobile-web-app-capable`, `-title`,
 * `-status-bar-style` — oltre a `/manifest.webmanifest`, e le due dichiarazioni
 * insieme sono ciò che fa aprire l'app aggiunta alla schermata home **senza barra
 * degli indirizzi**.
 *
 * `title` è «Fantasta» e non il `title` della pagina qui sotto: è il nome che
 * finisce **sotto l'icona** sul telefono, dove «Asta Fantacalcio» verrebbe
 * troncato.
 *
 * `statusBarStyle: "default"` e **non** `black-translucent`: `default` lascia la
 * barra di stato **fuori** dalla pagina, cioè non apre il capitolo delle safe
 * area. È la stessa ragione per cui in `viewport` qui sotto non c'è
 * `viewport-fit=cover`, e quella riga vale la pena di leggerla prima di
 * aggiungerlo.
 */
export const metadata: Metadata = {
  title: "Asta Fantacalcio",
  description: "Asta di Fantacalcio a busta chiusa, in diretta.",
  appleWebApp: {
    capable: true,
    title: "Fantasta",
    statusBarStyle: "default",
  },
};

/**
 * ⚠ **Nessun `viewport-fit: "cover"`, e con l'app installabile è una riga che
 * verrà proposta** (M20 §5, punto 1). L'applicazione ha già quattro
 * `env(safe-area-inset-*)` **con fallback** — nel portale, nel modale d'offerta,
 * nel pannello di chiamata e nell'intestazione del portale — e senza
 * `viewport-fit=cover` quegli `env()` valgono **0**, quindi oggi vincono i
 * fallback e i layout sono quelli che l'owner ha guardato e approvato.
 * Accenderlo cambierebbe quattro layout, di cui due sono il modale d'offerta e la
 * barra incollata del portale, per un guadagno che nessuno ha chiesto.
 *
 * `interactiveWidget: "resizes-content"` è per la tastiera del telefono: senza,
 * su Android la tastiera *copre* la pagina invece di rimpicciolirla, e
 * `100dvh` continua a valere lo schermo intero — il modale d'offerta finirebbe
 * per metà sotto i tasti. Nessun `maximumScale`: bloccare lo zoom è una
 * scortesia verso chi non vede bene, e il campo dell'offerta è già a 16px per
 * non farlo scattare da solo su iOS.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // La navbar di M2 sta qui perché deve comparire su *tutte* le pagine, e da una
  // sola lettura dell'utente.
  //
  // ⚠ **Fino a v1.9.1 qui c'era anche il banner globale «Asta in corso»** di
  // `PLAN §8bis` punto 1, e con lui una `listUserAuctions(user.id)` a ogni
  // richiesta di ogni utente autenticato — per una striscia che compariva solo
  // quando un'asta era viva. Il banner è stato rimosso su richiesta dell'owner
  // (M9 §5, DECISIONS 2026-08-12) e quel punto del piano ha smesso di valere: chi
  // rientra passa dalla dashboard. Non rimetterlo qui per «comodità di rientro»
  // senza rileggere quella voce — la seconda query per pagina era il suo prezzo.
  const user = await currentUser();

  return (
    // Le variabili dei font vanno su <html>, non su <body>: `globals.css`
    // applica `font-sans` all'elemento <html>, e una custom property definita su
    // un figlio non risale al padre. Con le classi sul body, `font-family` su
    // <html> resterebbe invalida e il serif di default verrebbe ereditato da
    // tutta la pagina.
    <html lang="it" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="antialiased">
        <Navbar
          user={
            user === null
              ? null
              : // Il booleano, non la riga: la navbar è un client component e
                // `isAppAdmin` vive in `lib/domain.ts`, che non dipende da
                // niente (M6 §5).
                { name: user.displayName, isAdmin: isAppAdmin(user) }
          }
          version={appVersion}
        />
        {children}
      </body>
    </html>
  );
}
