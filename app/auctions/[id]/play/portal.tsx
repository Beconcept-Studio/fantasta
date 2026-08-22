"use client";

import Link from "next/link";
import { useState } from "react";

import { useDeletedRedirect } from "@/app/auctions/use-deleted-redirect";
import { BidModal } from "@/components/auction/bid-modal";
import { DeletedCurtain } from "@/components/auction/deleted-curtain";
import { LotCard } from "@/components/auction/lot-card";
import { LotClosedCard } from "@/components/auction/lot-closed-card";
import { MembersPanel } from "@/components/auction/members-panel";
import { PickPanel, PickWaiting } from "@/components/auction/pick-panel";
import { PortalHeader } from "@/components/auction/portal-header";
import { RosterGrid } from "@/components/auction/roster-grid";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/domain";
import { sendAction } from "@/lib/realtime/action";
import { managerControls } from "@/lib/realtime/manage";
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
  viewerIsOwner,
}: {
  auctionId: string;
  /** Il listone dell'asta, letto una volta dal server: non viaggia nello snapshot. */
  pool: PoolPlayer[];
  /**
   * Se chi guarda possiede l'asta: abilita i due pulsanti che anticipano una
   * scadenza sulla card chiusa — «Prosegui asta» nel reveal e, da M14, «Mostra
   * risultati» nel cancello.
   *
   * Arriva come prop e non dallo snapshot, per la stessa ragione del listone:
   * non è stato di gioco, non cambia durante la serata, e nello snapshot
   * verrebbe spedito a tutti a ogni transizione per un booleano che nasce col
   * link. Non autorizza niente — `skipReveal` e `showResults` ricontrollano lato
   * server.
   *
   * ⚠ **«Annulla lotto» non è qui, e non è una dimenticanza**: vive solo nella regia
   * (M14 §5). Richiede l'asta in pausa, la conferma nomina due nomi, e il posto in
   * cui si conduce è quello — non il telefono con cui si gioca.
   */
  viewerIsOwner: boolean;
}) {
  const { snapshot, connected, offset, deleted } = useAuctionStream(auctionId);
  useHeartbeat(auctionId);
  // M12 §3c — l'asta cancellata mentre la si stava giocando: si va in dashboard.
  useDeletedRedirect(deleted);

  // ⚠ §8bis — vive **solo** qui: non è persistito, non è sincronizzato, e al
  // lotto successivo diventa irrilevante da sé perché l'id cambia.
  const [dismissedLotId, setDismissedLotId] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);

  async function skipReveal() {
    setSkipping(true);
    await sendAction(auctionId, { type: "SKIP_REVEAL" });
    setSkipping(false);
    // Nessun messaggio di conferma: la conferma è il lotto successivo che si
    // apre da solo. Se il server rifiuta — reveal già scaduto mentre premevi —
    // lo snapshot è già andato avanti lo stesso, e non c'è niente da dire.
  }

  // «Mostra risultati» (M14): identica alla precedente, e per lo stesso motivo non
  // dice niente in caso di rifiuto — se il cancello è scaduto mentre premevi, le
  // buste si sono aperte comunque ed è quello che volevi.
  async function showResults() {
    setSkipping(true);
    await sendAction(auctionId, { type: "SHOW_RESULTS" });
    setSkipping(false);
  }

  // Prima dello snapshot, perché l'ultimo snapshot ricevuto è di un'asta che non
  // c'è più: mostrarlo vorrebbe dire un countdown che scorre sul nulla.
  if (deleted !== null) {
    return <DeletedCurtain auctionName={deleted.auctionName} />;
  }

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
              <Link href={`/auctions/${auctionId}/lobby`}>Vai alla lobby</Link>
            </Button>
          </section>
        )}

        {screen.kind === "COMPLETED" && (
          <section className="bg-card/40 space-y-2 rounded-xl border p-6 text-center shadow-sm">
            <h2 className="text-lg font-semibold">Asta conclusa</h2>
            <p className="text-muted-foreground text-sm">
              Le rose sono chiuse. Qui sotto la tua, con i prezzi pagati.
            </p>
          </section>
        )}

        {/*
          Due card per lo stesso posto: il lotto vivo e il lotto chiuso sono due
          momenti diversi e devono avere due facce diverse (M1). La scelta è
          della fase, quindi dello snapshot: chi rientra a metà reveal trova la
          card chiusa come chi non si è mai disconnesso (I10).

          ⚠ **Da M14 le fasi chiuse sono due, ma le card restano due** — il cancello
          dei risultati (`LOT_SEALED`) porta la card chiusa nel suo stato sigillato,
          non una terza cornice. Il perché sta su `LotClosedCard`: per chi guarda il
          telefono la cosa già accaduta — «non si offre più» — è la stessa, e ciò che
          cambia è solo se il risultato si conosce.
        */}
        {screen.kind === "LOT" &&
          lot !== null &&
          (snapshot.auction.phase === "LOT_REVEAL" ||
          snapshot.auction.phase === "LOT_SEALED" ? (
            <LotClosedCard
              snapshot={snapshot}
              myMemberId={myMemberId}
              offset={offset}
              onSkip={
                viewerIsOwner && managerControls(snapshot).canSkipReveal
                  ? skipReveal
                  : null
              }
              onShowResults={
                viewerIsOwner && managerControls(snapshot).canShowResults
                  ? showResults
                  : null
              }
              skipPending={skipping}
            />
          ) : (
            <LotCard
              snapshot={snapshot}
              myMemberId={myMemberId}
              offset={offset}
              onOpenBid={() => setDismissedLotId(null)}
            />
          ))}

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

      </main>

      {lot !== null && (
        <BidModal
          open={bidOpen}
          // Chiudere il modale non nasconde niente: la card resta e lo riapre.
          onOpenChange={(open) => setDismissedLotId(open ? null : lot.id)}
          snapshot={snapshot}
          pool={pool}
          myMemberId={myMemberId}
          offset={offset}
          onBid={(amount) => sendAction(auctionId, { type: "BID", amount })}
          onWithdraw={() => sendAction(auctionId, { type: "WITHDRAW" })}
        />
      )}
    </>
  );
}
