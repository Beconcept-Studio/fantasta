import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { auctionByPublicToken } from "@/lib/engine/viewer";

import { TvView } from "./tv-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ publicToken: string }>;
}): Promise<Metadata> {
  const { publicToken } = await params;
  const auction = await auctionByPublicToken(publicToken);
  return {
    title: auction ? `${auction.name} — in diretta` : "Vista TV",
    // Un URL che vale come autenticazione non va lasciato indicizzare.
    robots: { index: false, follow: false },
  };
}

/**
 * `/tv/[publicToken]` — la vista proiettabile (PLAN §10).
 *
 * **Senza login**: il token nell'URL *è* l'autenticazione. È una scelta del
 * piano, ed è quella giusta — la TV della stanza è un browser aperto una volta
 * a inizio serata, non un utente; chiedergli un account Google significherebbe
 * accendere il proiettore e trovarsi davanti a una schermata di consenso.
 *
 * Quello che rende la scelta sicura è dall'altra parte: lo stream apre lo stesso
 * canale di tutti gli altri, ma `resolveViewer` gli assegna
 * `viewerMemberId = null`, quindi `serializeSnapshot` non gli mette dentro né
 * `myBid` né un solo importo di busta chiusa. **La TV non nasconde gli importi:
 * non li riceve** (I8, criterio ✅ della Fase 6).
 *
 * Qui il server fa una cosa sola: tradurre il token in un'asta. Se non
 * corrisponde a niente, 404 — e un token inventato non può distinguere «asta
 * che non esiste» da «asta che esiste ma non è la tua».
 */
export default async function TvPage({
  params,
}: {
  params: Promise<{ publicToken: string }>;
}) {
  const { publicToken } = await params;
  const auction = await auctionByPublicToken(publicToken);
  if (!auction) notFound();

  return (
    <TvView
      auctionId={auction.id}
      publicToken={publicToken}
      auctionName={auction.name}
      isSimulated={auction.isSimulated}
    />
  );
}
