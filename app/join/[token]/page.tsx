import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { ROLES, ROLE_LABELS } from "@/lib/domain";
import { getInviteView } from "@/lib/engine/setup";

import { JoinForm } from "./join-form";

export const metadata = { title: "Entra nell'asta — Asta Fantacalcio" };

/**
 * La pagina che si apre cliccando un link d'invito.
 *
 * Serve prima di tutto a far capire *dove* si sta entrando: nome dell'asta,
 * quanti posti restano, crediti e slot. Poi chiede il nome della squadra, che è
 * per-asta e non per-utente (PLAN §2): la stessa persona può chiamarsi in modo
 * diverso in due leghe.
 *
 * Un token inesistente è un 404 e basta: non diciamo se sia mai esistito.
 */
export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const user = await requireUser();
  const { token } = await params;

  const invite = await getInviteView(token, user.id);
  if (!invite) notFound();
  if (invite.alreadyMember) redirect(`/auctions/${invite.auctionId}/lobby`);

  const free = invite.seats - invite.memberCount;
  const totalSlots = ROLES.reduce((sum, role) => sum + invite.slots[role], 0);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 p-6">
      <Card>
        <CardHeader>
          <CardDescription>Sei stato invitato a</CardDescription>
          <CardTitle className="text-2xl">{invite.auctionName}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="text-muted-foreground space-y-1 text-sm">
            <li>
              {invite.memberCount} di {invite.seats} posti occupati
              {free > 0 ? ` · ${free} liberi` : " · al completo"}
            </li>
            <li>
              {invite.budget} crediti a testa · {totalSlots} giocatori da
              comprare
            </li>
            <li>
              Ordine dei ruoli:{" "}
              {invite.roleOrder.map((role) => ROLE_LABELS[role]).join(" → ")}
            </li>
          </ul>

          {free > 0 ? (
            <JoinForm token={invite.token} />
          ) : (
            <p role="alert" className="text-destructive text-sm">
              L&apos;asta è al completo.
            </p>
          )}
        </CardContent>
      </Card>

      <Link
        href="/dashboard"
        className="text-muted-foreground hover:text-foreground text-center text-sm"
      >
        Le tue aste
      </Link>
    </main>
  );
}
