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
import { PickSheet, PickWaiting } from "@/components/auction/pick-panel";
import { PortalHeader } from "@/components/auction/portal-header";
import { RosterGrid } from "@/components/auction/roster-grid";
import { SceneCard } from "@/components/auction/scene-card";
import { StatusCard } from "@/components/auction/status-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { sendAction } from "@/lib/realtime/action";
import { managerControls } from "@/lib/realtime/manage";
import { ROLE_LABELS_ONE } from "@/lib/domain";
import {
  amEligible,
  autoPickCandidate,
  memberById,
  memberLabel,
  myMember,
  portalScreen,
  sceneLabel,
  sceneOf,
  sceneTime,
  shouldOpenBidDialog,
  shouldOpenPickSheet,
  toneOf,
  turnKey,
  type Scene,
} from "@/lib/realtime/portal";
import type { PoolPlayer, Snapshot } from "@/lib/realtime/types";
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
  /**
   * Il gemello del precedente per il pannello di chiamata (M17 §4), ed è il
   * **secondo e ultimo** pezzo di stato locale del portale.
   *
   * Che siano due e non uno non allenta la regola 7: sono due dello stesso tipo —
   * «questa cosa che si apre da sé l'ho chiusa io» — e nessuno dei due può
   * rendere una schermata irraggiungibile a chi si collega dopo. La chiave è la
   * scadenza della fase e non `currentMemberId`: il perché sta su `turnKey`, e in
   * breve è che dentro un ruolo lo stesso posto chiama più volte.
   */
  const [dismissedTurnKey, setDismissedTurnKey] = useState<string | null>(null);
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
  // La scena e il suo tono: due funzioni pure, e l'unico posto in cui la tabella
  // di M17 §6/§7 esiste (`lib/realtime/portal.ts`, con i test).
  const scene = sceneOf(snapshot, myMemberId);
  const tone = toneOf(scene, snapshot.auction.status);
  const pickOpen = shouldOpenPickSheet(snapshot, myMemberId, dismissedTurnKey);

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
              ⚠ **Una cornice, nove scene** (M17 §6). Fino a v1.16.0 qui c'era una
              catena di sei `&&` che sceglievano fra sei contenitori, ognuno con la
              sua cornice e il suo countdown; adesso la scelta è di `sceneOf`, che
              è una funzione pura con i suoi test, e quello che cambia è il **corpo**
              dentro `SceneCard`.

              Il guadagno non è meno JSX: è che la decisione «quale scena» non vive
              più in una condizione JSX che nessun test può leggere. In un progetto
              senza test di rendering — non c'è `@testing-library`, non c'è jsdom —
              è l'unica rete che una macro tutta visiva può avere.
            */}
            <SceneCard
              tone={tone}
              label={sceneLabel(scene)}
              badge={<SceneBadge scene={scene} snapshot={snapshot} />}
              time={sceneTime(scene, snapshot)}
              offset={offset}
              pausedAt={screen.frozen ? snapshot.auction.pausedAt : null}
              action={
                <SceneAction
                  scene={scene}
                  snapshot={snapshot}
                  myMemberId={myMemberId}
                  auctionId={auctionId}
                  viewerIsOwner={viewerIsOwner}
                  frozen={screen.frozen}
                  skipPending={skipping}
                  onOpenBid={() => setDismissedLotId(null)}
                  onOpenPick={() => setDismissedTurnKey(null)}
                  onSkip={skipReveal}
                  onShowResults={showResults}
                />
              }
            >
              <SceneBody
                scene={scene}
                snapshot={snapshot}
                myMemberId={myMemberId}
                pool={pool}
              />
            </SceneCard>
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

      {/*
        ⚠ **I due pannelli si alternano senza che nessuno li coordini**, ed è la
        cosa che vale la pena capire di questa coppia. Quando scelgo il giocatore
        lo snapshot successivo porta `phase = LOT_OPEN`: `shouldOpenPickSheet`
        diventa falsa e `shouldOpenBidDialog` diventa vera, nello stesso istante e
        senza che una riga di codice dica «adesso chiudi quello e apri questo».
        Sono due condizioni sullo stesso stato, non una sequenza — ed è per questo
        che funziona identico per chi si è appena ricollegato (regola 1, regola 7).
      */}
      <PickSheet
        open={pickOpen}
        // Chiudere non nasconde niente: la card «Tocca a te» tiene il tempo che
        // resta e il pulsante che riapre.
        onOpenChange={(open) =>
          setDismissedTurnKey(open ? null : turnKey(snapshot))
        }
        snapshot={snapshot}
        pool={pool}
        offset={offset}
        frozen={screen.frozen}
        onPick={(playerId) => sendAction(auctionId, { type: "PICK", playerId })}
      />

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

/**
 * ─── I tre riempimenti della cornice ────────────────────────────────────────
 *
 * Corpo, badge e azione stanno **qui e non dentro `SceneCard`**, e la divisione
 * non è arbitraria: la cornice non sa niente di aste — prende una fascia, due
 * angoli, un corpo e una banda — mentre questi tre sanno tutto di aste e niente
 * di layout. È ciò che permette di guardare l'anatomia in un file e la mappa
 * delle scene in un altro.
 *
 * Stanno in fondo a `portal.tsx` e non in `components/` perché hanno **un solo
 * chiamante** e leggono tutti lo stesso `scene` (regola 8: niente astrazione
 * prima del secondo chiamante). Il giorno in cui la regia volesse la stessa
 * colonna, si spostano.
 */

/** Il corpo: l'unica cosa che cambia da una scena all'altra. */
function SceneBody({
  scene,
  snapshot,
  myMemberId,
  pool,
}: {
  scene: Scene;
  snapshot: Snapshot;
  myMemberId: string | null;
  pool: PoolPlayer[];
}) {
  switch (scene) {
    case "NOT_STARTED":
      return (
        <p className="text-muted-foreground text-sm">
          Tieni questa pagina aperta: si parte quando chi gestisce l&apos;asta la
          avvia, e serve che siate tutti collegati.
        </p>
      );
    case "COMPLETED":
      return (
        <p className="text-muted-foreground text-sm">
          Le rose sono chiuse, con i prezzi pagati.
        </p>
      );
    case "PICK_WAIT":
      return (
        <PickWaiting
          snapshot={snapshot}
          callerName={memberLabel(
            memberById(snapshot, snapshot.auction.currentMemberId),
          )}
        />
      );
    case "PICK_MINE":
      return <PickMineBody snapshot={snapshot} pool={pool} />;
    case "OFFERS":
    case "TIE_PREP":
    case "TIE_OPEN":
      return <LotCard snapshot={snapshot} myMemberId={myMemberId} />;
    case "SEALED":
    case "REVEAL":
      return <LotClosedCard snapshot={snapshot} myMemberId={myMemberId} />;
  }
}

/**
 * Il corpo di «Tocca a te» (M17 §4 e M17-08): **la card che rende richiudibile il
 * pannello**.
 *
 * Senza di lei un pannello che si apre da sé sarebbe una trappola: chi lo chiude
 * per sbaglio — o chi ha il telefono che va in standby — non avrebbe più né il
 * tempo che resta né la strada per tornare. Il tempo lo porta la banda della
 * cornice, la strada è il pulsante nello slot `action`, e insieme sono la stessa
 * promessa che la card del lotto fa al modale d'offerta (§8bis punto 2).
 *
 * ⚠ **Dice chi comprerebbe il timer, e lo dice senza filtri**: `autoPickCandidate`
 * pesca dal pool intero come fa `machine.ts`, e non dalla lista che il pannello
 * sta mostrando. È lo stesso vincolo di M10B §6 letto da un secondo posto — se
 * qui comparisse il primo nome della lista filtrata, questa card mentirebbe
 * esattamente come l'elenco mentiva prima che quella macro lo sistemasse.
 */
function PickMineBody({
  snapshot,
  pool,
}: {
  snapshot: Snapshot;
  pool: PoolPlayer[];
}) {
  const role = snapshot.auction.currentRole;
  const autoPick = autoPickCandidate(pool, snapshot, role);
  return (
    <div className="space-y-1.5">
      <h3 className="text-xl leading-tight font-semibold">
        Chiama un {role === null ? "giocatore" : ROLE_LABELS_ONE[role]}
      </h3>
      <p className="text-muted-foreground text-sm">
        {autoPick === null
          ? "Se scade, il timer chiama al posto tuo."
          : `Se scade, il timer compra ${autoPick.name} (${autoPick.team}) a 1.`}
      </p>
    </div>
  );
}

/**
 * Il badge nell'angolo in alto a destra: **qualifica la scena**, non ripete lo
 * stato dell'asta.
 *
 * ⚠ §5 fissa la *posizione* del badge («in alto a destra, che è il posto in cui
 * si guarderà anche in tutte le altre card»), non il suo contenuto qui: lo stato
 * dell'asta lo dice il badge della card di stato dieci pixel più su, e ripeterlo
 * nove volte sotto di lui sarebbe un badge che nessuno legge.
 *
 * ⚠ **La pausa non lo tocca**, di proposito. La pausa è già detta tre volte —
 * dalla fascia a righe, dal badge della card di stato e dal suo paragrafo — e una
 * quarta la trasformerebbe in rumore. Qui il badge continua a dire *che scena è*,
 * che è precisamente l'informazione che la pausa congela senza azzerare.
 *
 * `null` dove non c'è niente da qualificare: l'angolo resta vuoto e la label a
 * sinistra dice già tutto.
 */
function SceneBadge({
  scene,
  snapshot,
}: {
  scene: Scene;
  snapshot: Snapshot;
}) {
  switch (scene) {
    case "PICK_MINE":
      return <Badge>tuo turno</Badge>;
    case "OFFERS":
      return <Badge variant="secondary">round 1</Badge>;
    case "TIE_PREP":
    case "TIE_OPEN":
      return (
        <Badge variant="outline" className="border-amber-600/40 text-amber-800">
          {scene === "TIE_OPEN" ? "round 2" : "spareggio"}
        </Badge>
      );
    case "SEALED":
      return (
        <Badge variant="outline" className="border-amber-600/40 text-amber-800">
          da aprire
        </Badge>
      );
    case "REVEAL":
      // Solo a chi l'ha vinto: per gli altri il vincitore è già nel corpo, e un
      // badge «assegnato» accanto all'etichetta «Lotto assegnato» è la stessa
      // parola due volte a tre centimetri.
      return snapshot.currentLot?.reveal?.winnerMemberId ===
        snapshot.viewerMemberId ? (
        <Badge className="bg-emerald-600 text-white">a te</Badge>
      ) : null;
    default:
      return null;
  }
}

/**
 * L'azione, a piena larghezza in fondo al corpo: **un posto solo per scena**.
 *
 * Prima di M17 ogni card metteva il suo pulsante dove capitava — «Apri offerta»
 * in mezzo al corpo, «Prosegui asta» in un piè di pagina, «Vai alla lobby» sotto
 * un paragrafo centrato. Si preme dal telefono, spesso senza guardare: che stia
 * sempre nello stesso posto vale più di dove quel posto sia.
 *
 * ⚠ I due pulsanti dell'owner **non autorizzano niente** e non è un promemoria
 * inutile: `skipReveal` e `showResults` ricontrollano lato server (regola 6), e
 * `viewerIsOwner` arriva come prop perché nasce col link e non è stato di gioco.
 */
function SceneAction({
  scene,
  snapshot,
  myMemberId,
  auctionId,
  viewerIsOwner,
  frozen,
  skipPending,
  onOpenBid,
  onOpenPick,
  onSkip,
  onShowResults,
}: {
  scene: Scene;
  snapshot: Snapshot;
  myMemberId: string | null;
  auctionId: string;
  viewerIsOwner: boolean;
  frozen: boolean;
  skipPending: boolean;
  onOpenBid: () => void;
  onOpenPick: () => void;
  onSkip: () => void;
  onShowResults: () => void;
}) {
  const controls = managerControls(snapshot);

  if (scene === "NOT_STARTED") {
    return (
      <Button asChild variant="outline" className="w-full">
        <Link href={`/auctions/${auctionId}/lobby`}>Vai alla lobby</Link>
      </Button>
    );
  }

  // La strada per tornare al pannello: senza di lei chiuderlo sarebbe definitivo
  // fino al turno successivo, cioè un vicolo cieco a timer che scorre.
  if (scene === "PICK_MINE") {
    return (
      <Button
        type="button"
        className="h-12 w-full text-base"
        onClick={onOpenPick}
        disabled={frozen}
      >
        Scegli il giocatore
      </Button>
    );
  }

  if (scene === "OFFERS" || scene === "TIE_OPEN") {
    if (!amEligible(snapshot.currentLot, myMemberId)) return null;
    return (
      <Button
        type="button"
        className="h-12 w-full text-base"
        onClick={onOpenBid}
        disabled={frozen}
      >
        {snapshot.myBid === null ? "Apri offerta" : "Modifica offerta"}
      </Button>
    );
  }

  if (scene === "SEALED" && viewerIsOwner && controls.canShowResults) {
    return (
      <Button
        type="button"
        className="w-full"
        onClick={onShowResults}
        disabled={skipPending}
      >
        {skipPending ? "Apro…" : "Mostra risultati"}
      </Button>
    );
  }

  if (scene === "REVEAL" && viewerIsOwner && controls.canSkipReveal) {
    return (
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={onSkip}
        disabled={skipPending}
      >
        {skipPending ? "Proseguo…" : "Prosegui asta"}
      </Button>
    );
  }

  return null;
}
