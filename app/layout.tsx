import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { LiveBanner, type LiveMembership } from "@/components/auction/live-banner";
import { currentUser } from "@/lib/auth";
import { listUserAuctions } from "@/lib/engine/setup";

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
  // Il banner globale di §8bis: sta qui perché deve comparire su *tutte* le
  // pagine. Chi non è autenticato non ha aste, e la lettura non avviene.
  const user = await currentUser();
  const live: LiveMembership[] =
    user === null
      ? []
      : (await listUserAuctions(user.id))
          .filter(
            (auction) =>
              auction.isMember &&
              (auction.status === "LIVE" || auction.status === "PAUSED"),
          )
          .map((auction) => ({
            id: auction.id,
            name: auction.name,
            paused: auction.status === "PAUSED",
          }));

  return (
    // Le variabili dei font vanno su <html>, non su <body>: `globals.css`
    // applica `font-sans` all'elemento <html>, e una custom property definita su
    // un figlio non risale al padre. Con le classi sul body, `font-family` su
    // <html> resterebbe invalida e il serif di default verrebbe ereditato da
    // tutta la pagina.
    <html lang="it" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="antialiased">
        <LiveBanner auctions={live} />
        {children}
      </body>
    </html>
  );
}
