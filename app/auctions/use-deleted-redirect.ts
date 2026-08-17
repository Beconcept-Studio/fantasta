"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import type { Deleted } from "@/lib/realtime/use-auction-stream";

import { DELETED_NOTICE_PARAM } from "./form-state";

/**
 * **Chi ha una dashboard dove andare, ci va** (M12 §3c): portale, regia e lobby.
 *
 * Sta in un file suo, e non dentro `useAuctionStream`, per tre ragioni che
 * sembrano stilistiche e non lo sono:
 *
 * 1. **La TV non deve navigare da nessuna parte.** Non ha una dashboard: si
 *    ferma dov'è e lo dice. Se la navigazione fosse dentro l'hook dello stream,
 *    quella differenza sarebbe una condizione nascosta invece di una riga che
 *    non si scrive.
 * 2. **L'ordine di §3c resta impossibile da invertire.** La chiusura
 *    dell'`EventSource` avviene *dentro* il listener dell'evento, sincrona;
 *    la navigazione è un effetto che parte dal `deleted` già impostato, quindi
 *    per costruzione dopo. Non sono nello stesso posto, quindi nessuno le può
 *    scambiare per sbaglio scrivendo codice che *sembra* funzionare.
 * 3. **`lib/` non conosce le rotte dell'applicazione.** Il nome del parametro
 *    vive con le altre cose che viaggiano nell'URL, in `app/auctions/`.
 *
 * `replace` e non `push`: la pagina di un'asta cancellata non è un posto in cui
 * il tasto «indietro» deve poter riportare — lì non c'è più niente.
 */
export function useDeletedRedirect(deleted: Deleted | null): void {
  const router = useRouter();

  useEffect(() => {
    if (deleted === null) return;
    router.replace(
      `/dashboard?${DELETED_NOTICE_PARAM}=${encodeURIComponent(deleted.auctionName)}`,
    );
  }, [deleted, router]);
}
