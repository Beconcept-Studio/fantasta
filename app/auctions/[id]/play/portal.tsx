"use client";

import Link from "next/link";
import { useState } from "react";

import { BidModal } from "@/components/auction/bid-modal";
import { LotCard } from "@/components/auction/lot-card";
import { MembersPanel } from "@/components/auction/members-panel";
import { PickPanel, PickWaiting } from "@/components/auction/pick-panel";
import { PortalHeader } from "@/components/auction/portal-header";
import { RosterGrid } from "@/components/auction/roster-grid";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/domain";
import { sendAction } from "@/lib/realtime/action";
import {
  memberById,
  memberLabel,
  myMember,
  portalScreen,
  shouldOpenBidDialog,
} from "@/lib/realtime/portal";
import type { PoolPlayer } from "@/lib/realtime/types";
import { useAuctionStream, useHeartbeat } from "@/lib/realtime/use-auction-stream";

/**
 * Il portale del partecipante (F5-01): **una sola pagina, e nient'altro che lo
 * snapshot**.
 *
 * La gerarchia è quella vincolante di §8bis, dall'esterno all'interno:
 * il banner globale (che sta nel layout, e porta qui), la **card permanente**
 * del lotto, il **modale** sopra la card. Qui si vede la parte interna: quale
 * schermata mostrare è `portalScreen(snapshot)`, se il modale è aperto è
 * `shouldOpenBidDialog(snapshot, dismissedLotId)`, e `dismissedLotId` è l'unico
 * pezzo di stato locale di tutto il portale.
 *
 * Che sia l'unico non è un dettaglio: è la forma che prende la regola 7. Non
 * esiste una variabile "ho ricevuto l'evento X", non esiste una schermata
 * raggiungibile solo da chi era connesso al momento giusto. Chiudere il tab e
 * riaprirlo produce esattamente la stessa pagina — non perché ci sia un
 * recupero, ma perché non c'era niente da recuperare (I10).
 *
 * Le azioni escono da `sendAction`; lo stato torna **solo** dallo stream. Non
 * c'è nessun aggiornamento ottimistico dello stato dell'asta: il feedback
 * immediato riguarda l'invio ("✓ salvata"), il mondo lo riscrive lo snapshot.
 */
export function Portal({
  auctionId,
  pool,
}: {
  auctionId: string;
  /** Il listone dell'asta, letto una volta dal server: non viaggia nello snapshot. */
  pool: PoolPlayer[];
}) {
  const { snapshot, connected, offset } = useAuctionStream(auctionId);
  useHeartbeat(auctionId);

  // ⚠ §8bis — vive **solo** qui: non è persistito, non è sincronizzato, e al
  // lotto successivo diventa irrilevante da sé perché l'id cambia.
  const [dismissedLotId, setDismissedLotId] = useState<string | null>(null);

  if (snapshot === null) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-muted-foreground text-sm">
          {connected ? "Carico l'asta…" : "Mi collego all'asta…"}
        </p>
      </main>
    );
  }

  const myMemberId = snapshot.viewerMemberId;
  const me = myMember(snapshot, myMemberId);
  const screen = portalScreen(snapshot, myMemberId);
  const lot = snapshot.currentLot;
  const bidOpen = shouldOpenBidDialog(snapshot, myMemberId, dismissedLotId);

  return (
    <>
      <PortalHeader snapshot={snapshot} me={me} connected={connected} />

      <main className="mx-auto w-full max-w-xl space-y-4 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {screen.frozen && (
          <section
            role="status"
            className="space-y-1 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4"
          >
            <h2 className="font-semibold">Asta in pausa</h2>
            <p className="text-sm">
              Chi gestisce l&apos;asta l&apos;ha messa in pausa. I countdown sono
              congelati e le offerte sospese: quando riprende, il tempo che
              restava riparte da dov&apos;era.
            </p>
          </section>
        )}

        {screen.kind === "NOT_STARTED" && (
          <section className="bg-card space-y-3 rounded-xl border p-6 text-center shadow-sm">
            <h2 className="text-lg font-semibold">L&apos;asta non è iniziata</h2>
            <p className="text-muted-foreground text-sm">
              Tieni questa pagina aperta: si parte quando chi gestisce
              l&apos;asta la avvia, e serve che siate tutti collegati.
            </p>
            <Button asChild variant="outline">
              <Link href={`/auctions/${auctionId}/lobby`}>Pannello di configurazione</Link>
            </Button>
          </section>
        )}

        {screen.kind === "COMPLETED" && (
          <section className="bg-card space-y-2 rounded-xl border p-6 text-center shadow-sm">
            <h2 className="text-lg font-semibold">Asta conclusa</h2>
            <p className="text-muted-foreground text-sm">
              Le rose sono chiuse. Qui sotto la tua, con i prezzi pagati.
            </p>
          </section>
        )}

        {screen.kind === "LOT" && lot !== null && (
          <LotCard
            snapshot={snapshot}
            myMemberId={myMemberId}
            offset={offset}
            onOpenBid={() => setDismissedLotId(null)}
          />
        )}

        {screen.kind === "PICK_MINE" && (
          <PickPanel
            snapshot={snapshot}
            pool={pool}
            offset={offset}
            frozen={screen.frozen}
            onPick={(playerId) => sendAction(auctionId, { type: "PICK", playerId })}
          />
        )}

        {screen.kind === "PICK_WAIT" && (
          <PickWaiting
            snapshot={snapshot}
            offset={offset}
            frozen={screen.frozen}
            callerName={memberLabel(
              memberById(snapshot, snapshot.auction.currentMemberId),
            )}
          />
        )}

        {me !== null && (
          <section className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <h2 className="font-semibold">La tua rosa</h2>
              <p className="text-muted-foreground text-xs">
                {snapshot.auction.roleOrder
                  .map((role) => ROLE_LABELS[role])
                  .join(" → ")}
              </p>
            </div>
            <RosterGrid member={me} slots={snapshot.auction.slots} />
          </section>
        )}

        <section className="space-y-2">
          <h2 className="font-semibold">Gli altri</h2>
          <MembersPanel snapshot={snapshot} myMemberId={myMemberId} />
        </section>

        <footer className="flex items-center justify-between gap-3 pt-2">
          <Link
            href="/dashboard"
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            ← Le tue aste
          </Link>
          <Link
            href={`/auctions/${auctionId}/lobby`}
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            Lobby
          </Link>
        </footer>
      </main>

      {lot !== null && (
        <BidModal
          open={bidOpen}
          // Chiudere il modale non nasconde niente: la card resta e lo riapre.
          onOpenChange={(open) => setDismissedLotId(open ? null : lot.id)}
          snapshot={snapshot}
          myMemberId={myMemberId}
          offset={offset}
          onBid={(amount) => sendAction(auctionId, { type: "BID", amount })}
          onWithdraw={() => sendAction(auctionId, { type: "WITHDRAW" })}
        />
      )}
    </>
  );
}
