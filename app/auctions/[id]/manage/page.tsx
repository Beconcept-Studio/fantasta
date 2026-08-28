import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { canSeeInsights } from "@/lib/domain";
import { getAuctionOverview, listPickPool } from "@/lib/engine/setup";

import { ManageConsole } from "./console";

export const metadata = { title: "Regia dell'asta — Asta Fantacalcio" };

/**
 * `/auctions/[id]/manage` — il portale del manager (PLAN §10).
 *
 * È il posto da cui si conduce la serata: recap delle rose, avvio con il posto
 * di partenza, pausa e ripresa, e l'alert di chi non è più collegato. **Solo
 * l'owner**, e volutamente **desktop-only**: qui non si offre sotto pressione,
 * si guarda un tabellone — è l'esatto opposto del vincolo del portale
 * partecipante, che è mobile-first perché si gioca dal telefono.
 *
 * Il server fa due cose e nessuna è preparare la schermata: verifica che chi
 * entra sia l'owner, e dice se l'owner è anche un membro — perché in quel caso
 * questa pagina deve battere l'heartbeat, altrimenti il cancello d'avvio non si
 * passerebbe mai da qui. Lo stato dell'asta arriva dallo stream e da lì soltanto
 * (regola 7).
 *
 * Il `public_token` non passa più di qui: da M2 il link alla vista TV sta
 * nell'intestazione comune a tutte le sezioni dell'asta, che il token ce
 * l'ha già.
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
  // Stessa regola del portale (M8 §6): un owner con gli insight li vede anche
  // in regia, uno senza no. Un predicato, due chiamate, nessuna eccezione.
  //
  // ⚠ E anche qui l'utente, per la stessa ragione (M21 §5): questa pagina è la
  // regia **di chi la sta guardando**, quindi il suo foglio vale qui come nel
  // portale. Un pannello delle correzioni che mostrasse i prezzi globali a chi ne
  // ha caricati di suoi sarebbe la stessa incoerenza che la decisione 1 toglie.
  const pool = await listPickPool(id, canSeeInsights(user), user.id);

  return (
    <ManageConsole
      auctionId={id}
      ownerIsMember={overview.viewerMember !== null}
      pool={pool}
    />
  );
}
