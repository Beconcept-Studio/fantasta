import { notFound, redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { canSeeInsights } from "@/lib/domain";
import { getAuctionOverview, listPickPool } from "@/lib/engine/setup";

import { Portal } from "./portal";

export const metadata = { title: "Asta live — Asta Fantacalcio" };

/**
 * `/auctions/[id]/play` — il portale del partecipante (PLAN §10).
 *
 * La parte server fa tre cose, e nessuna di queste è "preparare la schermata":
 *
 * 1. **Verifica chi sta entrando.** Solo un membro gioca; l'owner che non ha
 *    joinato (⚠ P11) non ha un portale — il suo è `/manage`, che arriva in
 *    Fase 6, e per adesso lo si rimanda in lobby.
 * 2. **Carica il listone**, che è l'unica cosa che il portale ha bisogno di
 *    sapere e che non sta nello snapshot (vedi `listPickPool`). Da M8 il listone
 *    porta con sé gli insight, **se chi guarda li può vedere**.
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

  // ⚠ Il flag decide una **query**, non un `className` (M8 §6): chi non lo ha
  // non riceve gli insight nel payload, invece di riceverli e non vederli.
  //
  // ⚠ E da M21 passa anche **chi sta guardando**: il listone personale si risolve
  // lato server, così la tab Listone e la lista di chiamata mostrano gli stessi
  // valori — i miei, se ho caricato il mio foglio (M21 §5).
  const pool = await listPickPool(id, canSeeInsights(user), user.id);

  return (
    <Portal
      auctionId={id}
      pool={pool}
      viewerIsOwner={overview.viewerIsOwner}
      // I crediti di partenza di questa asta, per tradurre il `PMA` del foglio da
      // percentuale a cifra offribile nella lista di chiamata (M17). Prop e non
      // snapshot, per la stessa ragione delle altre due: non è stato di gioco.
      budget={overview.auction.budgetDefault}
    />
  );
}
