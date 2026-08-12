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
import { LISTONE_NOTICE_PARAM } from "@/app/auctions/form-state";
import { requireUser } from "@/lib/auth";
import { isAppAdmin } from "@/lib/domain";
import { realAuctionRunning } from "@/lib/engine/bots";
import { listoneStatus } from "@/lib/engine/listone";
import { getAuctionOverview } from "@/lib/engine/setup";

import { BotsPanel } from "./bots-panel";
import { DeletePanel } from "./delete-panel";
import { InvitesPanel } from "./invites-panel";
import { ListonePanel } from "./listone-panel";
import { MembersPanel } from "./members-panel";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Configurazione dell'asta — Asta Fantacalcio" };

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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const overview = await getAuctionOverview(id, user.id);
  if (!overview) notFound();
  if (!overview.viewerIsOwner) redirect(`/auctions/${id}/lobby`);

  const { auction } = overview;
  const editable = auction.status === "DRAFT" || auction.status === "READY";

  // Il listone a sistema (M10): il pulsante che lo copia esiste solo se c'è
  // qualcosa da copiare, e la data è quella che si legge per decidere.
  const listone = await listoneStatus();
  const systemListone =
    listone.rows > 0 && listone.uploadedAt !== null
      ? { rows: listone.rows, uploadedAt: listone.uploadedAt }
      : null;

  // ⚠ Perché la copia **alla creazione** non è passata: l'asta è nata comunque,
  // in DRAFT, e questa è l'unica frase che lo spiega (M10 §4).
  const noticeRaw = (await searchParams)[LISTONE_NOTICE_PARAM];
  const notice = typeof noticeRaw === "string" ? noticeRaw : null;

  // Solo per spiegare i bot fermi: la domanda si fa una volta sola, e solo
  // dove serve dirlo.
  const realAuctionRunningNow =
    auction.isSimulated && isAppAdmin(user) ? await realAuctionRunning() : false;

  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const proto = requestHeaders.get("x-forwarded-proto") ?? "http";
  const baseUrl = `${proto}://${host}`;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      {/* Lo `StatusBadge` è letto dal server insieme al resto della pagina e
          resta con il resto della pagina: nell'intestazione comune a tutte le
          sezioni starebbe fermo mentre l'asta parte. */}
      <header className="space-y-2">
        <p className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Stato dell&apos;asta:</span>
          <StatusBadge status={auction.status} />
        </p>
        <p className="text-muted-foreground text-sm">
          {auction.status === "READY"
            ? "Tutto a posto: posti pieni e listone sufficiente. L'asta si avvia dalla regia, quando siete tutti collegati."
            : "L'asta sarà pronta quando i posti saranno pieni e il listone importato basterà per ogni ruolo."}
        </p>
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

      {/*
        Il pannello dei bot esiste **solo su un'asta simulata**, e solo per un
        amministratore dell'applicazione. Non è la difesa — `fillWithBots`
        rifiuta comunque un'asta reale (regola 6) — è il motivo per cui, nella
        configurazione dell'asta vera, la domanda non ti viene in mente.
      */}
      {auction.isSimulated && isAppAdmin(user) && (
        <Card>
          <CardHeader>
            <CardTitle>Partecipanti simulati</CardTitle>
            <CardDescription>
              I bot giocano dal server: niente terminali, niente script.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {realAuctionRunningNow && (
              <p
                role="status"
                className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm"
              >
                <strong>I bot sono fermi.</strong> È in corso un&apos;asta reale
                su questa macchina, e finché non finisce la simulazione resta
                congelata. Non è un guasto: è la regola che tiene i bot lontani
                dalla sera dell&apos;asta.
              </p>
            )}
            <BotsPanel
              auctionId={auction.id}
              freeSeats={auction.seats - overview.members.length}
              editable={editable}
            />
          </CardContent>
        </Card>
      )}

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
            systemListone={systemListone}
            notice={notice}
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

      {/* In fondo e staccata: si arriva qui scorrendo apposta, non passandoci. */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Cancella l&apos;asta</CardTitle>
          <CardDescription>
            L&apos;unica azione di questa applicazione che non si può annullare.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeletePanel
            auctionId={auction.id}
            name={auction.name}
            deletable={auction.status !== "LIVE" && auction.status !== "PAUSED"}
          />
        </CardContent>
      </Card>
    </main>
  );
}
