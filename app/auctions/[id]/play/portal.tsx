"use client";

import Link from "next/link";
import { useState } from "react";

import { useDeletedRedirect } from "@/app/auctions/use-deleted-redirect";
import { BidModal } from "@/components/auction/bid-modal";
import { DeletedCurtain } from "@/components/auction/deleted-curtain";
import { Identity } from "@/components/auction/identity";
import { LotCard } from "@/components/auction/lot-card";
import { LotClosedCard } from "@/components/auction/lot-closed-card";
import { MembersPanel } from "@/components/auction/members-panel";
import { PickPanel, PickWaiting } from "@/components/auction/pick-panel";
import { PortalHeader } from "@/components/auction/portal-header";
import { RosterGrid } from "@/components/auction/roster-grid";
import { StatusCard } from "@/components/auction/status-card";
import { Button } from "@/components/ui/button";
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

      {/*
        ⚠ **max-w-6xl e non max-w-xl** (M17 §2): fino a v1.16.0 la larghezza
        larga stava nell'intestazione e quella stretta nel corpo, cioè al
        contrario di come si legge. Da qui il corpo è la cosa larga, e a
        1024px le tre colonne vengono ~350px ciascuna.
      */}
      <main className="mx-auto w-full max-w-6xl p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {/*
          ⚠ **L'ordine nel DOM è quello del telefono, non quello del desktop**, e
          letto senza questa nota sembra un errore.

          Sotto `lg` c'è una colonna sola e conta solo l'ordine sorgente: la prima
          cosa dopo l'intestazione deve restare **la scena** — il lotto su cui si
          sta offrendo — perché è ciò per cui si tiene il telefono in mano. Se le
          colonne fossero scritte 1-2-3, chi gioca dal telefono dovrebbe scorrere
          oltre la propria rosa e oltre gli altri per arrivare all'offerta, cioè
          il contrario di quello che il portale fa da v1.0.0.

          Da `lg` le tre si rimettono in fila con `lg:order-*`, che è l'unica cosa
          che le tre classi qui sotto fanno. Non è ottimizzazione: è il prezzo di
          tre classi per non peggiorare il dispositivo con cui si gioca davvero.
        */}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-4 lg:order-3">
            <StatusCard snapshot={snapshot} />

            {/*
              ⚠ **Senza intestazione, e non è una dimenticanza**: «L'asta non è
              iniziata» era il titolo di questa card fino a v1.16.0, e da M17 lo
              dice la card di stato dieci pixel più su. Qui resta ciò che quella
              non dice: cosa fare mentre si aspetta, e la strada per la lobby.
            */}
            {screen.kind === "NOT_STARTED" && (
              <section className="bg-card space-y-3 rounded-xl border p-6 text-center shadow-sm">
                <p className="text-muted-foreground text-sm">
                  Tieni questa pagina aperta: si parte quando chi gestisce
                  l&apos;asta la avvia, e serve che siate tutti collegati.
                </p>
                <Button asChild variant="outline">
                  <Link href={`/auctions/${auctionId}/lobby`}>Vai alla lobby</Link>
                </Button>
              </section>
            )}

            {/*
              ⚠ «Qui sotto la tua» non si può più scrivere: da M17 la propria rosa
              è **accanto** su desktop e sotto sul telefono, quindi qualunque
              indicazione di direzione sarebbe falsa metà delle volte. Il rimando
              se ne va e non viene sostituito da un «qui accanto»: la rosa è la
              cosa più grande della pagina e non ha bisogno di essere additata.
            */}
            {screen.kind === "COMPLETED" && (
              <section className="bg-card/40 space-y-2 rounded-xl border p-6 text-center shadow-sm">
                <p className="text-muted-foreground text-sm">
                  Le rose sono chiuse, con i prezzi pagati.
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
          </div>

          {/* ── Colonna 1: la rosa, con l'identità inglobata in testa ── */}
          {me !== null && (
            <section
              className="bg-card min-w-0 overflow-hidden rounded-xl border shadow-sm lg:order-1"
              aria-label="La tua rosa"
            >
              {/*
                ⚠ **Grigia, e dentro la card della rosa invece che sopra**
                (decisione dell'owner del 2026-08-22). Una colonna che comincia
                con due cornici bianche una sopra l'altra chiede a chi guarda di
                capire perché sono due; il fondo grigio dice in un colpo che quello
                è un altro genere di cosa — i miei numeri, non i miei giocatori —
                senza spendere una seconda cornice.

                `hidden lg:block`: sotto `lg` gli stessi numeri sono nella barra
                incollata, e ripeterli qui sarebbe la seconda copia che `Identity`
                esiste per evitare.
              */}
              <div className="bg-muted hidden border-b p-4 lg:block">
                <Identity
                  me={me}
                  slots={snapshot.auction.slots}
                  connected={connected}
                />
              </div>
              <div className="p-4">
                {/*
                  ⚠ Nella riga del titolo c'è **solo il titolo** (decisione
                  dell'owner del 2026-08-22): l'ordine di chiamata dei ruoli, che
                  stava qui accanto, non c'è più. Va saputo che era **l'unico
                  posto** dell'app che lo scriveva, e che `RosterGrid` elenca i
                  ruoli nel suo ordine fisso (P → D → C → A) e non in quello
                  dell'asta — quindi in un'asta che chiama i portieri per ultimi
                  quell'informazione adesso non si legge da nessuna parte. Quale
                  ruolo è in gioco *adesso* lo dice la card di stato.
                */}
                <h2 className="mb-3 font-semibold">La tua rosa</h2>
                <RosterGrid member={me} slots={snapshot.auction.slots} />
              </div>
            </section>
          )}

          {/* ── Colonna 2: gli altri ── */}
          <section
            className="bg-card min-w-0 space-y-2 rounded-xl border p-4 shadow-sm lg:order-2"
            aria-label="Gli altri partecipanti"
          >
            <h2 className="font-semibold">Gli altri</h2>
            <MembersPanel snapshot={snapshot} myMemberId={myMemberId} />
          </section>
        </div>
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
        />
      )}
    </>
  );
}
