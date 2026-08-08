import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { getAuctionOverview, listPickPool } from "@/lib/engine/setup";

import { ManageConsole } from "./console";

export const metadata = { title: "Regia dell'asta" };

/**
 * `/auctions/[id]/manage` — il portale del manager (PLAN §10).
 *
 * È il posto da cui si conduce la serata: recap delle rose, avvio con il posto
 * di partenza, pausa e ripresa, e l'alert di chi non è più collegato. **Solo
 * l'owner**, e volutamente **desktop-only**: qui non si offre sotto pressione,
 * si guarda un tabellone — è l'esatto opposto del vincolo del portale
 * partecipante, che è mobile-first perché si gioca dal telefono.
 *
 * Il server fa tre cose e nessuna è preparare la schermata: verifica che chi
 * entra sia l'owner, passa il `public_token` (che serve al link della vista TV,
 * e da nessun'altra parte è recuperabile) e dice se l'owner è anche un membro —
 * perché in quel caso questa pagina deve battere l'heartbeat, altrimenti il
 * cancello d'avvio non si passerebbe mai da qui. Lo stato dell'asta arriva
 * dallo stream e da lì soltanto (regola 7).
 */
export default async function ManagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const overview = await getAuctionOverview(id, user.id);
  if (!overview) notFound();
  // Chi non ha creato l'asta non ha una regia: per lui questa pagina non esiste.
  if (!overview.viewerIsOwner) notFound();

  // Il listone, per il pannello delle correzioni (F7-05). Stessa scelta del
  // portale (DECISIONS Fase 5): non viaggia nello snapshot — è immutabile
  // dall'import e non ha niente da sanificare — e **chi** sia ancora libero
  // resta funzione dello snapshot, che le rose ce le ha.
  const pool = await listPickPool(id);

  return (
    <ManageConsole
      auctionId={id}
      publicToken={overview.auction.publicToken}
      ownerIsMember={overview.viewerMember !== null}
      seatsTaken={overview.members.length}
      pool={pool}
    />
  );
}
