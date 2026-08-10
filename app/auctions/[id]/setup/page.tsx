import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { StatusBadge } from "@/components/setup/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getAuctionOverview } from "@/lib/engine/setup";

import { InvitesPanel } from "./invites-panel";
import { ListonePanel } from "./listone-panel";
import { MembersPanel } from "./members-panel";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Configura l'asta — Asta Fantacalcio" };

/**
 * La pagina dell'owner: configurazione, listone, inviti, membri.
 *
 * L'URL d'invito si costruisce dall'host della richiesta e non da una variabile
 * d'ambiente: in sviluppo la stessa pagina viene aperta da `localhost` e
 * dall'IP di LAN col telefono, e un link con dentro `localhost` sul telefono
 * non porta da nessuna parte.
 */
export default async function SetupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const overview = await getAuctionOverview(id, user.id);
  if (!overview) notFound();
  if (!overview.viewerIsOwner) redirect(`/auctions/${id}/lobby`);

  const { auction } = overview;
  const editable = auction.status === "DRAFT" || auction.status === "READY";

  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const proto = requestHeaders.get("x-forwarded-proto") ?? "http";
  const baseUrl = `${proto}://${host}`;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-6">
      <header className="space-y-2">
        <Link
          href="/dashboard"
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← Le tue aste
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {auction.name}
          </h1>
          <StatusBadge status={auction.status} />
        </div>
        <p className="text-muted-foreground text-sm">
          {auction.status === "READY"
            ? "Tutto a posto: posti pieni e listone sufficiente. L'asta si avvia dalla regia, quando siete tutti collegati."
            : "L'asta sarà pronta quando i posti saranno pieni e il listone importato basterà per ogni ruolo."}
        </p>
        <div className="flex flex-wrap gap-4 text-sm">
          <Link
            href={`/auctions/${auction.id}/manage`}
            className="underline underline-offset-4"
          >
            Regia dell&apos;asta
          </Link>
          <Link
            href={`/auctions/${auction.id}/lobby`}
            className="underline underline-offset-4"
          >
            Pannello di configurazione
          </Link>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Partecipanti</CardTitle>
          <CardDescription>
            L&apos;ordine dei posti è l&apos;ordine di rotazione dei turni.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MembersPanel
            auctionId={auction.id}
            members={overview.members}
            seats={auction.seats}
            viewerIsMember={overview.viewerMember !== null}
            editable={editable}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Inviti</CardTitle>
          <CardDescription>
            Il link smette di funzionare da solo quando l&apos;asta parte.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InvitesPanel
            auctionId={auction.id}
            baseUrl={baseUrl}
            invites={overview.invites}
            editable={editable}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Listone</CardTitle>
          <CardDescription>
            Serve prima che l&apos;asta possa diventare pronta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ListonePanel
            auctionId={auction.id}
            listoneSize={overview.listoneSize}
            outOfListCount={overview.outOfListCount}
            includeOutOfList={auction.includeOutOfList}
            pool={overview.pool}
            slots={overview.slots}
            seats={auction.seats}
            poolProblem={overview.poolProblem}
            editable={editable}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Impostazioni</CardTitle>
          <CardDescription>
            {editable
              ? `${overview.totalSlots} slot a testa, ${auction.budgetDefault} crediti.`
              : "Ad asta iniziata restano modificabili solo i tempi."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/*
            L'avviso sta **sopra il form e sempre**, non nella risposta al
            salvataggio: quello che il server può dire dopo il click è un
            errore, e un errore arriva quando ormai hai compilato. Qui è una
            regola del posto in cui ti trovi, e va letta prima di toccare i
            campi — anche perché la seconda metà («dal lotto successivo») non è
            un divieto ma la risposta alla domanda che uno si fa davvero:
            «cambio adesso, quando vale?».
          */}
          {!editable && (
            <p
              role="status"
              className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm"
            >
              Ad asta iniziata si possono cambiare <strong>solo i timer</strong>
              , e valgono <strong>dal lotto successivo</strong>: un countdown
              già in corso non si accorcia. Posti, crediti, slot, ordine dei
              ruoli e nome restano quelli.
            </p>
          )}
          <SettingsForm
            auctionId={auction.id}
            structuralDisabled={!editable}
            defaults={{
              name: auction.name,
              seats: auction.seats as 8 | 10 | 12,
              budgetDefault: auction.budgetDefault,
              bidSeconds: auction.bidSeconds,
              pickSeconds: auction.pickSeconds,
              tiePrepSeconds: auction.tiePrepSeconds,
              revealSeconds: auction.revealSeconds,
              slots: overview.slots,
              roleOrder: auction.roleOrder,
            }}
          />
        </CardContent>
      </Card>
    </main>
  );
}
