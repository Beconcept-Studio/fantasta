"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { PresenceDot, PRESENCE_LABELS } from "@/components/auction/presence-dot";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Presence } from "@/lib/realtime/types";
import { useAuctionStream, useHeartbeat } from "@/lib/realtime/use-auction-stream";
import { cn } from "@/lib/utils";

/**
 * La lobby, viva (F5-12).
 *
 * Due cose che prima non c'erano e che sono indispensabili la sera dell'asta:
 *
 * 1. **L'heartbeat.** `startAuction` rifiuta l'avvio se un solo membro non è in
 *    presence LIVE (F4-06), e la presence nasce da un POST ogni dieci secondi
 *    fatto da una pagina aperta. Questa è quella pagina: finché i partecipanti
 *    stanno in lobby, l'owner vede i pallini diventare verdi uno a uno e sa
 *    quando può premere avvio. Senza un posto che batte il colpo, quel cancello
 *    sarebbe impossibile da passare.
 * 2. **Il passaggio automatico al portale.** L'asta parte con un countdown di
 *    chiamata già in corso: chi resta in lobby a guardare i pallini ha già
 *    perso secondi. Appena lo snapshot dice `LIVE` (o `PAUSED`), il membro
 *    viene portato su `/play`. È l'unico `router.push` automatico dell'app, e
 *    non è una scorciatoia allo stato: la decisione la prende lo snapshot, non
 *    un evento ricevuto — chi arriva in lobby ad asta già iniziata viene
 *    spostato allo stesso modo, al primo snapshot (regola 7).
 *
 * L'elenco parte dai dati che la pagina ha già letto dal database e si arricchisce
 * di presence quando arriva lo snapshot: nessun momento di lista vuota.
 */

export type LobbyMember = {
  id: string;
  teamName: string;
  displayName: string | null;
  seatIndex: number;
  budgetInitial: number;
};

export function LobbyLive({
  auctionId,
  seats,
  members,
  viewerMemberId,
}: {
  auctionId: string;
  seats: number;
  members: LobbyMember[];
  viewerMemberId: string | null;
}) {
  const router = useRouter();
  const { snapshot, connected } = useAuctionStream(auctionId);
  useHeartbeat(auctionId, viewerMemberId !== null);

  const started =
    snapshot !== null &&
    (snapshot.auction.status === "LIVE" || snapshot.auction.status === "PAUSED");

  useEffect(() => {
    if (started && viewerMemberId !== null) {
      router.push(`/auctions/${auctionId}/play`);
    }
  }, [started, viewerMemberId, auctionId, router]);

  const presenceOf = (memberId: string): Presence | null =>
    snapshot?.members.find((m) => m.id === memberId)?.presence ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Partecipanti ({members.length}/{seats})
        </CardTitle>
        <CardDescription>
          L&apos;ordine è quello di rotazione dei turni.{" "}
          {snapshot === null
            ? connected
              ? "Leggo chi è collegato…"
              : "Mi collego…"
            : "Il pallino verde è chi ha la pagina aperta adesso."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {started && (
          <p
            role="status"
            className="rounded-md border border-emerald-600/40 bg-emerald-600/10 px-3 py-2 text-sm font-medium"
          >
            L&apos;asta è partita: ti porto sul tuo portale…
          </p>
        )}

        {members.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Ancora nessuno. Il link d&apos;invito lo genera chi ha creato
            l&apos;asta.
          </p>
        ) : (
          <ol className="space-y-2">
            {members.map((member) => {
              const presence = presenceOf(member.id);
              return (
                <li
                  key={member.id}
                  className={cn(
                    "flex items-center gap-3 rounded-md border p-3",
                    member.id === viewerMemberId && "border-foreground/40",
                  )}
                >
                  <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded text-sm font-medium tabular-nums">
                    {member.seatIndex + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{member.teamName}</p>
                    <p className="text-muted-foreground truncate text-sm">
                      {member.displayName ?? "—"}
                      {member.id === viewerMemberId ? " · sei tu" : ""}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {presence !== null && <PresenceDot presence={presence} />}
                    <span className="text-muted-foreground text-xs">
                      {presence === null ? "—" : PRESENCE_LABELS[presence]}
                    </span>
                  </span>
                  <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
                    {member.budgetInitial} cr
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
