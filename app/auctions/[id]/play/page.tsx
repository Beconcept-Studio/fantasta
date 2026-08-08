import { notFound, redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { getAuctionOverview, listPickPool } from "@/lib/engine/setup";

import { Portal } from "./portal";

export const metadata = { title: "Asta — il tuo portale" };

/**
 * `/auctions/[id]/play` — il portale del partecipante (PLAN §10).
 *
 * La parte server fa tre cose, e nessuna di queste è "preparare la schermata":
 *
 * 1. **Verifica chi sta entrando.** Solo un membro gioca; l'owner che non ha
 *    joinato (⚠ P11) non ha un portale — il suo è `/manage`, che arriva in
 *    Fase 6, e per adesso lo si rimanda in lobby.
 * 2. **Carica il listone**, che è l'unica cosa che il portale ha bisogno di
 *    sapere e che non sta nello snapshot (vedi `listPickPool`).
 * 3. **Passa la palla al client.** Lo stato dell'asta non si legge qui: arriva
 *    dallo stream, e da lì soltanto. Renderizzare lato server la fase corrente
 *    darebbe una schermata giusta per un istante e sbagliata per i trenta
 *    secondi successivi — ed è esattamente il tipo di doppia verità che la
 *    regola 7 vieta.
 */
export default async function PlayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const overview = await getAuctionOverview(id, user.id);
  if (!overview) notFound();
  if (overview.viewerMember === null) {
    if (overview.viewerIsOwner) redirect(`/auctions/${id}/lobby`);
    notFound();
  }

  const pool = await listPickPool(id);

  return <Portal auctionId={id} pool={pool} />;
}
