/**
 * Il velo che copre la schermata di un'asta appena cancellata, per il tempo che
 * la navigazione verso la dashboard impiega ad arrivare (M12 §3c).
 *
 * Serve per una ragione sola, e sta scritta in §3: **restare sulla schermata
 * dell'asta sarebbe crudele.** Senza questo, per un istante si vedrebbe l'ultimo
 * snapshot ricevuto — la card del lotto, il countdown che scorre — di un'asta
 * che non esiste più: la stessa immagine falsa del bug di §2, solo più breve.
 *
 * Non è un modale e non ha un pulsante: non c'è niente da decidere, e da qui si
 * va via da soli (`useDeletedRedirect`).
 */
export function DeletedCurtain({ auctionName }: { auctionName: string }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-lg font-semibold">Asta cancellata</p>
      <p className="text-muted-foreground text-sm">
        L&apos;asta «{auctionName}» è stata cancellata da un amministratore.
      </p>
      <p className="text-muted-foreground text-sm">Ti riporto alle tue aste…</p>
    </main>
  );
}
