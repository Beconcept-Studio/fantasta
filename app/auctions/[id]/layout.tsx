import { notFound } from "next/navigation";

import { AuctionNav } from "@/components/nav/auction-nav";
import { requireUser } from "@/lib/auth";
import { auctionSections } from "@/lib/auction-nav";
import { getAuctionOverview } from "@/lib/engine/setup";

/**
 * L'intestazione comune a tutte le pagine di un'asta (M2).
 *
 * Prima di questo layout ogni pagina si scriveva la propria navigazione a mano,
 * e il risultato era che regia e portale non ne avevano nessuna: chi entrava in
 * regia ci restava, e la configurazione dei tempi ad asta iniziata — che esiste
 * da v1.2.0 — era di fatto irraggiungibile.
 *
 * Qui si legge una volta chi guarda e che rapporto ha con questa asta, e da
 * quei due booleani escono le sezioni. `getAuctionOverview` è avvolta in
 * `cache()`, quindi la pagina sotto può richiamarla senza che il database la
 * veda due volte.
 *
 * ⚠ **Questo layout non autorizza niente.** Decide cosa *mostrare*, non cosa si
 * può fare: sono le pagine a rifiutare chi non deve entrare — `/setup` rimanda
 * in lobby chi non è owner, `/manage` e `/play` fanno `notFound()` — e sono le
 * azioni sul server a ricontrollare comunque (regola 6). Una sotto-navbar che
 * nasconde una voce è cortesia verso l'occhio, mai una difesa.
 */
export default async function AuctionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const overview = await getAuctionOverview(id, user.id);
  if (!overview) notFound();

  const viewer = {
    isOwner: overview.viewerIsOwner,
    isMember: overview.viewerMember !== null,
  };

  return (
    <>
      <AuctionNav
        auctionId={id}
        auctionName={overview.auction.name}
        sections={auctionSections(viewer)}
        // Il `public_token` non esce da nessun'altra parte, ed è la chiave
        // della vista pubblica: il link lo vede chi l'asta la possiede.
        tvHref={
          viewer.isOwner ? `/tv/${overview.auction.publicToken}` : null
        }
      />
      {children}
    </>
  );
}
