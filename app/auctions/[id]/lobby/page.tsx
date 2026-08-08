import Link from "next/link";
import { notFound } from "next/navigation";

import { StatusBadge } from "@/components/setup/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { ROLES, ROLE_LABELS } from "@/lib/domain";
import { getAuctionOverview } from "@/lib/engine/setup";

import { LeaveButton } from "./leave-button";
import { LobbyLive } from "./lobby-live";

export const metadata = { title: "Lobby — Asta Fantacalcio" };

/**
 * La sala d'attesa: chi c'è, con che nome di squadra, in che ordine di turno.
 *
 * L'elenco dei membri e le regole dell'asta si leggono dal database qui, lato
 * server: sono fatti di setup, e un reload mostra sempre la realtà. Quello che
 * *cambia da solo* — i pallini di presence, e il momento in cui l'asta parte —
 * arriva dallo stream, dentro `LobbyLive` (F5-12): è lì che questa pagina batte
 * l'heartbeat che il cancello d'avvio pretende.
 */
export default async function LobbyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const overview = await getAuctionOverview(id, user.id);
  if (!overview) notFound();

  const { auction, members, viewerMember, viewerIsOwner } = overview;
  const canLeave =
    viewerMember !== null &&
    (auction.status === "DRAFT" || auction.status === "READY");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 p-6">
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
        {viewerIsOwner && (
          <Link
            href={`/auctions/${auction.id}/setup`}
            className="text-sm underline underline-offset-4"
          >
            Configura l&apos;asta
          </Link>
        )}
      </header>

      <LobbyLive
        auctionId={auction.id}
        seats={auction.seats}
        members={members.map(
          ({ id, teamName, displayName, seatIndex, budgetInitial }) => ({
            id,
            teamName,
            displayName,
            seatIndex,
            budgetInitial,
          }),
        )}
        viewerMemberId={viewerMember?.id ?? null}
      />

      <Card>
        <CardHeader>
          <CardTitle>Regole di questa asta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <strong>{auction.budgetDefault} crediti</strong> a testa,{" "}
            <strong>{overview.totalSlots} giocatori</strong> da comprare.
          </p>
          <p>
            Ordine dei ruoli:{" "}
            <strong>
              {auction.roleOrder.map((role) => ROLE_LABELS[role]).join(" → ")}
            </strong>
            .
          </p>
          <p className="text-muted-foreground">
            Slot:{" "}
            {ROLES.map((role) => `${overview.slots[role]} ${role}`).join(" · ")}.
            Tempi: {auction.pickSeconds}s per chiamare, {auction.bidSeconds}s per
            offrire, {auction.tiePrepSeconds}s di spareggio,{" "}
            {auction.revealSeconds}s di buste aperte.
          </p>
        </CardContent>
      </Card>

      {canLeave && <LeaveButton memberId={viewerMember.id} />}
    </main>
  );
}
