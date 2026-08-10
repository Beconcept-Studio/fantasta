import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { romeDateTime, romeTime } from "@/lib/auction-log";
import { getAuctionLog } from "@/lib/engine/log";

import { LotsLog } from "./lots-log";
import { RefreshButton } from "./refresh-button";

export const metadata = { title: "Storico dell'asta — Asta Fantacalcio" };

/**
 * Lo storico dell'asta (M3): la pagina che serve la sera in cui qualcuno dirà
 * «io avevo offerto 46, non 45».
 *
 * **Renderizzata dal server a ogni caricamento, senza stream.** Non è una scelta
 * di comodità: lo storico non è lo stato dell'asta, quindi non passa da
 * `serializeSnapshot` (regola 3) e non ha niente da ricevere in tempo reale — la
 * regola 7 non la riguarda, perché non è una schermata di gioco. Per questo in
 * cima c'è l'ora della lettura: in una disputa, l'età di ciò che stai leggendo è
 * essa stessa un'informazione.
 *
 * **L'autorizzazione è di `getAuctionLog`, non di questa funzione**, e non del
 * layout — che per progetto non autorizza niente. Owner e membri passano; a
 * chiunque altro `getAuctionLog` risponde `NOT_FOUND`, che qui diventa un 404 e
 * non un 403: l'esistenza di un'asta a cui non partecipi non è una tua
 * informazione.
 *
 * Il titolo, il badge dell'asta e la sotto-navbar arrivano dal layout comune di
 * M2: qui c'è solo il contenuto.
 */
export default async function LogPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const result = await getAuctionLog(user.id, id);
  if (!result.ok) notFound();
  const log = result.value;

  // ⚠ Con l'asta in corso un lotto può essere aperto, e le sue buste sono
  // segrete: non compare fra i lotti (I8, e la barriera è `isPublicLot`). La
  // pagina lo **dice**, invece di lasciar notare un buco — ed è una frase
  // costruita su `status`, che non fa uscire niente.
  const inCorso = log.status === "LIVE" || log.status === "PAUSED";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-muted-foreground text-sm">
          Aggiornato alle {romeTime(log.readAt)}
        </p>
        <RefreshButton />
      </header>

      {inCorso && (
        <p className="border-muted-foreground/30 text-muted-foreground rounded-md border border-dashed p-3 text-sm">
          Il lotto in corso non compare: le buste restano chiuse fino
          all&apos;apertura.
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">I lotti</h2>
        <LotsLog lots={log.lots} />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Le correzioni e le pause</CardTitle>
        </CardHeader>
        <CardContent>
          {log.events.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Niente da segnalare: nessuna pausa e nessuna correzione.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {log.events.map((event) => (
                <li key={event.id} className="flex flex-col gap-0.5">
                  <span>{event.text}</span>
                  <span className="text-muted-foreground text-xs">
                    {romeDateTime(event.at)}
                    {event.actorName === null
                      ? // Nessun attore umano: è stato il tempo a decidere.
                        " · automatico"
                      : ` · ${event.actorName}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
