import Link from "next/link";

import { AuctionDelete } from "@/components/admin/auction-delete";
import { SimulationBadge } from "@/components/auction/simulation-badge";
import { StatusBadge } from "@/components/setup/status-badge";
import { romeDay } from "@/lib/auction-log";
import { requireAppAdmin } from "@/lib/auth";
import { listAdminAuctions } from "@/lib/engine/admin";

/**
 * La lista di tutte le aste dell'applicazione (M6 §3).
 *
 * ⚠ **Non c'è nessuno stato di gioco, e non è pigrizia: è come si rispetta I8.**
 * Nessun importo di offerta lascia il server mentre un lotto è aperto. Il modo
 * fragile di onorarlo sarebbe mostrare lotti, buste e crediti sanificandoli con
 * attenzione; il modo solido è **non avere niente da sanificare** — e questa
 * pagina non ha niente, perché `listAdminAuctions` non gliene dà. Un test guarda
 * la risposta e non la pagina, e ha l'insieme esatto dei campi scritto dentro.
 *
 * Lo *stato* dell'asta non è lo stato di gioco: «in corso» non dice niente di chi
 * ha offerto quanto.
 *
 * ⚠ **E nessuna azione sull'asta tranne la cancellazione**: niente pausa, niente
 * avvio, niente override. La plancia di comando è la regia e resta dell'owner —
 * un secondo posto da cui si comanda la stessa asta sono due verità sullo stesso
 * stato. Chi vuole vedere un'asta la apre da dove si aprono le aste: il link c'è,
 * la vista non è duplicata.
 */
export default async function AdminAuctionsPage() {
  await requireAppAdmin();
  const auctions = await listAdminAuctions();

  return (
    <section className="space-y-4">
      <p className="text-muted-foreground text-sm">
        {auctions.length} {auctions.length === 1 ? "asta" : "aste"}
      </p>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-208 border-collapse text-left">
          <thead className="bg-muted/40 text-muted-foreground text-xs uppercase">
            <tr className="border-b">
              <th className="px-2 py-2 font-medium">Asta</th>
              <th className="px-2 py-2 font-medium">Creata da</th>
              <th className="px-2 py-2 font-medium">Stato</th>
              <th className="px-2 py-2 font-medium">Posti</th>
              <th className="px-2 py-2 font-medium">Creata</th>
              <th className="px-2 py-2 font-medium">Avviata</th>
              <th className="px-2 py-2 font-medium">Conclusa</th>
              <th className="px-2 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {auctions.map((auction) => {
              // `LIVE` e `PAUSED` non si cancellano — nemmeno da qui, nemmeno da
              // un amministratore: la pausa congela la fase, non azzera l'asta.
              // La UI non offre il pulsante e il motore rifiuta comunque.
              const deletable =
                auction.status !== "LIVE" && auction.status !== "PAUSED";
              const ownerLabel =
                auction.ownerEmail ?? auction.ownerName ?? "un utente";

              return (
                <tr key={auction.id} className="border-b align-top">
                  <td className="px-2 py-2">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Link
                        href={`/auctions/${auction.id}/lobby`}
                        className="font-medium underline underline-offset-4"
                      >
                        {auction.name}
                      </Link>
                      {auction.isSimulated && <SimulationBadge />}
                    </span>
                  </td>

                  <td className="px-2 py-2 text-sm">
                    <span className="block">{auction.ownerName ?? "—"}</span>
                    <span className="text-muted-foreground font-mono text-xs break-all">
                      {auction.ownerEmail ?? "—"}
                    </span>
                  </td>

                  <td className="px-2 py-2">
                    <StatusBadge status={auction.status} />
                  </td>

                  <td className="px-2 py-2 text-sm whitespace-nowrap tabular-nums">
                    {auction.memberCount}/{auction.seats}
                  </td>

                  <td className="text-muted-foreground px-2 py-2 text-sm whitespace-nowrap tabular-nums">
                    {romeDay(auction.createdAt.toISOString())}
                  </td>
                  <td className="text-muted-foreground px-2 py-2 text-sm whitespace-nowrap tabular-nums">
                    {auction.startedAt
                      ? romeDay(auction.startedAt.toISOString())
                      : "—"}
                  </td>
                  <td className="text-muted-foreground px-2 py-2 text-sm whitespace-nowrap tabular-nums">
                    {auction.completedAt
                      ? romeDay(auction.completedAt.toISOString())
                      : "—"}
                  </td>

                  <td className="px-2 py-2">
                    {deletable ? (
                      <AuctionDelete
                        auctionId={auction.id}
                        name={auction.name}
                        ownerLabel={ownerLabel}
                      />
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        in corso
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
