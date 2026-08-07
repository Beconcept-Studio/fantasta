import Link from "next/link";
import { notFound } from "next/navigation";

import { StatusBadge } from "@/components/setup/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { ROLES, ROLE_LABELS } from "@/lib/domain";
import { getAuctionOverview } from "@/lib/engine/setup";

import { LeaveButton } from "./leave-button";

export const metadata = { title: "Lobby — Asta Fantacalcio" };

/**
 * La sala d'attesa: chi c'è, con che nome di squadra, in che ordine di turno.
 *
 * I pallini di presence (LIVE / IDLE / OFFLINE) arrivano in Fase 5, quando
 * esisterà l'heartbeat: prima di allora non c'è niente da mostrare che sia vero.
 * Qui la pagina è già una funzione dello stato a database, quindi un reload
 * mostra sempre la realtà — è la stessa disciplina che in Fase 4 diventa
 * l'invariante I10.
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

      <Card>
        <CardHeader>
          <CardTitle>
            Partecipanti ({members.length}/{auction.seats})
          </CardTitle>
          <CardDescription>
            L&apos;ordine è quello di rotazione dei turni.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Ancora nessuno. Il link d&apos;invito lo genera chi ha creato
              l&apos;asta.
            </p>
          ) : (
            <ol className="space-y-2">
              {members.map((member) => (
                <li
                  key={member.id}
                  className={`flex items-center gap-3 rounded-md border p-3 ${
                    member.id === viewerMember?.id ? "border-foreground/40" : ""
                  }`}
                >
                  <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded text-sm font-medium tabular-nums">
                    {member.seatIndex + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{member.teamName}</p>
                    <p className="text-muted-foreground truncate text-sm">
                      {member.displayName ?? "—"}
                      {member.id === viewerMember?.id ? " · sei tu" : ""}
                    </p>
                  </div>
                  <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
                    {member.budgetInitial} cr
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

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
