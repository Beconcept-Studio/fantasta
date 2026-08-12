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

export const metadata: Metadata = {
  title: "Asta Fantacalcio",
  description: "Asta di Fantacalcio a busta chiusa, in diretta.",
};

/**
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
