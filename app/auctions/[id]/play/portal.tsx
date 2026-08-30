"use client";

import Link from "next/link";
import { Tabs } from "radix-ui";
import { useState } from "react";

import { useDeletedRedirect } from "@/app/auctions/use-deleted-redirect";
import { BidModal } from "@/components/auction/bid-modal";
import { StatsPlusTab } from "@/components/auction/stats-plus";
import { Countdown } from "@/components/auction/countdown";
import { DeletedCurtain } from "@/components/auction/deleted-curtain";
import { Identity } from "@/components/auction/identity";
import { ListoneTable } from "@/components/auction/listone-table";
import { LotCard } from "@/components/auction/lot-card";
import { LotClosedCard } from "@/components/auction/lot-closed-card";
import { MembersPanel } from "@/components/auction/members-panel";
import { PickSheet, PickWaiting } from "@/components/auction/pick-panel";
import { PortalHeader } from "@/components/auction/portal-header";
import { RosterAccordion } from "@/components/auction/roster-grid";
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
import {
  alternative,
  avvisi,
  haPma,
  lottiAlMinimo,
  lottiInformativi,
  saldoRuoliChiusi,
  scartoPerPartecipante,
  scartoStrutturale,
  scatto,
  temperatura,
} from "@/lib/stats-plus";
import type { PoolPlayer, Snapshot } from "@/lib/realtime/types";
import { useAuctionStream, useHeartbeat } from "@/lib/realtime/use-auction-stream";
import type { UserListoneStatus } from "@/lib/engine/user-listone";
import { cn } from "@/lib/utils";

/** Le due metà della pagina. `asta` è quella di sempre, ed è attiva al caricamento. */
type Tab = "asta" | "listone" | "stats";

/**
 * Il portale del partecipante (F5-01): **una sola pagina, e nient'altro che lo
 * snapshot**.
 *
 * La gerarchia è quella vincolante di §8bis, dall'esterno all'interno: la
 * **cornice permanente** della colonna 3 e i **due pannelli** che si aprono
 * sopra di lei. Qui si vede la parte interna: quale scena mostrare è
 * `sceneOf(snapshot)`, se un pannello è aperto sono `shouldOpenBidDialog` e
 * `shouldOpenPickSheet`, e le sole due variabili che non vengono dallo snapshot
 * sono `dismissedLotId` e `dismissedTurnKey`.
 *
 * Che siano due e non una non allenta la regola 7, perché sono due **dello
 * stesso tipo**: «questa cosa che si apre da sé l'ho chiusa io». Non esiste da
 * nessuna parte una variabile "ho ricevuto l'evento X", quindi non esiste una
 * schermata raggiungibile solo da chi era connesso al momento giusto. Chiudere
 * il tab e riaprirlo produce esattamente la stessa pagina — non perché ci sia un
 * recupero, ma perché non c'era niente da recuperare (I10).
 *
 * ⚠ **Il banner globale «Asta in corso» che §8bis mette al primo livello non
 * esiste più** da v1.10.0: era il modo di *arrivare* alla pagina, non di
 * ricostruirla, e la sua rimozione non ha toccato nessuno dei rientri. Il
 * racconto sta in `docs/ARCHITECTURE.md`.
 *
 * Le azioni escono da `sendAction`; lo stato torna **solo** dallo stream. Non
 * c'è nessun aggiornamento ottimistico dello stato dell'asta: il feedback
 * immediato riguarda l'invio ("✓ salvata"), il mondo lo riscrive lo snapshot.
 */
export function Portal({
  auctionId,
  pool,
  viewerIsOwner,
  budget,
  listone,
  statsPlus,
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
  /**
   * I crediti di partenza dell'asta, che servono a una cosa sola: tradurre il
   * `PMA` del foglio da percentuale a cifra offribile nella lista di chiamata.
   *
   * ⚠ Terza prop che arriva dal server invece che dallo snapshot, e per la stessa
   * ragione delle altre due — non è stato di gioco e non cambia durante la serata.
   * M17 §8 dice che un dato mancante nello snapshot è il segnale di fermarsi e
   * chiedere: qui non è servito, perché questa strada esisteva già e
   * `serializeSnapshot` non è stato toccato (I8).
   */
  budget: number;
  /**
   * Cosa ho già importato del mio listone — e, per la sua sola presenza, **se
   * posso vedere la tab Listone** (M21 §7).
   *
   * ⚠ **`null` per chi non ha `canSeeInsights`**, e non è un modo elegante di
   * scrivere un booleano: è la stessa regola delle quattro chiavi del pool. Chi
   * non ha il permesso non riceve *niente* — nemmeno il numero di righe del
   * proprio foglio — invece di riceverlo e vederselo nascondere da un `if` nel
   * JSX. La tab resta **visibile e spenta**, con accanto scritto perché: una tab
   * che non c'è non si può desiderare.
   */
  listone: UserListoneStatus | null;
  /**
   * Chi guarda vede Stats+ (M22 §6): `canSeeInsights && users.stats_plus`.
   *
   * ⚠ **Prop e non snapshot**, come `budget` e `viewerIsOwner`: non è stato di
   * gioco e non cambia durante la serata. E ⚠ **è un gate di prodotto, non una
   * difesa**: chi non ce l'ha ha comunque ricevuto PMA e snapshot, cioè tutti
   * gli addendi. Decide che cosa l'app mostra, non che cosa quel browser può
   * sapere — `lib/domain.ts` lo scrive per esteso su `canSeeStatsPlus`, e il
   * rimedio "forte" (il calcolo sul server) costerebbe un blocco serializzato
   * per dodici viewer a ogni transizione per nascondere un'addizione.
   */
  statsPlus: boolean;
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
  /**
   * ⚠ **Il terzo pezzo di stato locale del portale**, dopo i due `dismissed*` che
   * M17 aveva dichiarato «il secondo e ultimo» (M21 §1). La regola 7 regge lo
   * stesso, e va detto perché: quei due sono «questa cosa che si apre da sé l'ho
   * chiusa io», questo è «quale metà della pagina sto guardando». Nessuno dei tre
   * può rendere una schermata **irraggiungibile** a chi si collega dopo — chi apre
   * la pagina adesso trova `asta`, che è tutto ciò che c'era prima di M21.
   *
   * Se un giorno la tab attiva finisse nell'URL o in `localStorage`, quella
   * proprietà andrebbe riverificata: una tab ricordata è una schermata che dipende
   * da cosa hai fatto prima.
   */
  const [tab, setTab] = useState<Tab>("asta");
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

  /**
   * Pausa e ripresa **dal portale** (richiesta dell'owner del 2026-08-23): chi
   * conduce l'asta e ci gioca dentro non deve più uscire dal proprio portale per
   * fermarla. La Regia resta la casa dei comandi — è lì che vivono l'avvio, gli
   * override, «Annulla lotto» — e qui arrivano le due sole leve che servono
   * *mentre* si sta offrendo, cioè mentre si sta guardando questa pagina.
   *
   * ⚠ **Terza azione da owner del portale, e la terza volta con lo stesso stampo**
   * di `skipReveal` e `showResults`: un booleano di pending, nessun messaggio di
   * conferma, nessun messaggio di rifiuto. La conferma è lo snapshot che arriva e
   * cambia il badge della card di stato; e il rifiuto qui è quasi solo «l'asta è
   * appena finita», che il badge dice da sé meglio di una riga di testo. Una riga
   * di feedback costerebbe l'altezza che M17 e la richiesta del 2026-08-23 stanno
   * togliendo a questa card.
   *
   * Non è un'astrazione condivisa con le altre due (regola 8): tre chiamanti con
   * la stessa forma non fanno un helper finché non hanno anche lo stesso pending —
   * e questo è separato di proposito, perché «Prosegui asta» e «Pausa» possono
   * stare a schermo insieme e disabilitarsi a vicenda sarebbe un bug.
   */
  const [pausing, setPausing] = useState(false);

  async function togglePause(type: "PAUSE" | "RESUME") {
    setPausing(true);
    await sendAction(auctionId, { type });
    setPausing(false);
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
  // Il permesso è già stato deciso dal server, che a chi non ce l'ha non manda
  // niente: qui si legge l'assenza, non si ricalcola la regola.
  const canSeeListone = listone !== null;

  // ⚠ **Stats+ è funzione pura di snapshot e pool** (§7.3, I10): nessuno stato
  // locale, nessun effetto, niente da ricordare fra uno snapshot e l'altro. Chi
  // ricarica a metà lotto vede gli stessi numeri di chi non si è mosso — che è
  // la condizione di I10, non una conseguenza fortunata.
  //
  // ⚠ **E non si memoizza prima di aver misurato** (regola 8): `O(pool)` per le
  // alternative e `O(assegnazioni)` per il resto sono cinquecento e duecento, in
  // un browser. Se un giorno servisse, il candidato è l'indice
  // `fascia → giocatori`, immutabile per tutta l'asta.
  const ruoloInCorso = snapshot.auction.currentRole;
  const lottiRuolo =
    statsPlus && ruoloInCorso !== null
      ? lottiInformativi(snapshot, pool, budget, ruoloInCorso)
      : [];
  const temperaturaRuolo = statsPlus ? temperatura(lottiRuolo) : null;
  const scattoRuolo = statsPlus ? scatto(lottiRuolo) : null;
  const alMinimoRuolo =
    statsPlus && ruoloInCorso !== null
      ? lottiAlMinimo(snapshot, ruoloInCorso)
      : { alMinimo: 0, totale: 0 };
  const saldi = statsPlus ? saldoRuoliChiusi(snapshot, pool, budget) : [];
  const partecipanti = statsPlus
    ? scartoPerPartecipante(snapshot, pool, budget)
    : [];
  const alternativeLotto =
    statsPlus && lot !== null
      ? alternative(snapshot, pool, budget, lot.player.id)
      : null;
  const avvisiRuolo = statsPlus ? avvisi(snapshot, pool, budget) : [];
  const strutturale = scartoStrutturale(snapshot, pool, budget);
  const poolHaPma = haPma(pool);
  const nomiMembri = new Map(
    snapshot.members.map((m) => [m.id, m.displayName ?? m.teamName]),
  );

  const action = (
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
  );
  /**
   * ⚠ **L'esito è la sola scena in cui l'azione non è l'ultima cosa della card**
   * (richiesta dell'owner del 2026-08-22, dopo aver guardato una simulazione): sta
   * dentro il corpo, subito sotto la riga di chi si è aggiudicato il giocatore.
   *
   * Non è una deroga all'anatomia di §6 ma la sua lettura giusta. Nelle altre otto
   * scene il corpo è corto, quindi «in fondo alla card» e «subito sotto la notizia»
   * sono lo stesso pixel; nell'esito sotto il vincitore c'è l'elenco di tutte le
   * buste di tutti i round — fino a dodici righe di appendice — e col pulsante in
   * fondo bisognerebbe scorrere oltre l'appendice per proseguire l'asta. La regola
   * che regge non è «l'azione sta in fondo» ma **«l'azione segue la notizia»**.
   */
  const actionInBody = scene === "REVEAL";

  return (
    <Tabs.Root
      value={tab}
      onValueChange={(value) => setTab(value as Tab)}
      // ⚠ **Non è una navigazione, ed è tecnico prima che estetico** (M21 §1).
      // Due rotte smonterebbero `Portal`, quindi `useAuctionStream`, quindi la
      // connessione SSE: ogni tocco su una tab chiuderebbe lo stream e ne
      // aprirebbe un altro, col registro del server che vede una disconnessione e
      // una riconnessione per ogni cambio di tab, nel mezzo di un'asta.
      activationMode="manual"
    >
      {/*
        ⚠ **Un contenitore incollato solo, con dentro due strisce.** Sotto `lg`
        gli elementi `sticky` sarebbero due — l'intestazione e questa barra — e
        due `sticky top-0` fratelli si sovrappongono: il secondo avrebbe bisogno
        di sapere l'altezza del primo, cioè di un numero magico da tenere
        allineato a mano. Incollandoli insieme quel numero non esiste, e da `lg`
        resta solo la barra perché l'intestazione è `lg:hidden`.

        ⚠ M21 §8 chiede di guardarle **insieme su un telefono vero**: due strisce
        incollate mangiano l'altezza che serve a offrire, che è ciò che M17 stava
        restituendo. Se si accavallano, la prima da rivedere è questa.
      */}
      <div className="sticky top-0 z-40">
        <PortalHeader snapshot={snapshot} me={me} connected={connected} />
        <PortalTabs
          tab={tab}
          canSeeListone={canSeeListone}
          statsPlus={statsPlus}
          scene={scene}
          snapshot={snapshot}
          offset={offset}
          frozen={screen.frozen}
          myMemberId={myMemberId}
          onOpenBid={() => setDismissedLotId(null)}
          onOpenPick={() => setDismissedTurnKey(null)}
        />
      </div>

      <Tabs.Content value="asta">
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
            <StatusCard
              snapshot={snapshot}
              viewerIsOwner={viewerIsOwner}
              pausePending={pausing}
              onPause={() => void togglePause("PAUSE")}
              onResume={() => void togglePause("RESUME")}
            />

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
              action={actionInBody ? null : action}
            >
              <SceneBody
                scene={scene}
                snapshot={snapshot}
                myMemberId={myMemberId}
                pool={pool}
                action={actionInBody ? action : null}
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
                <h2 className="mb-2 font-semibold">La tua rosa</h2>
                {/*
                  ⚠ **`RosterAccordion` e non `RosterGrid`** (M18 §5): la
                  fisarmonica vale **solo** qui, dove la rosa è una. In regia
                  resta piatta, perché là servono 8–12 rose a colpo d'occhio.
                  `currentRole` è quello che apre il reparto in gioco, e lo fa
                  con una chiave — il perché è nel componente.
                */}
                <RosterAccordion
                  member={me}
                  slots={snapshot.auction.slots}
                  currentRole={snapshot.auction.currentRole}
                />
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
      </Tabs.Content>

      {/*
        ⚠ **La tab Listone si monta solo quando è attiva**, che è il
        comportamento di `Tabs.Content`: cinquecento righe non restano in memoria
        mentre si offre. E non c'è niente da perdere quando si smonta — i filtri
        sono l'unico stato, e sono una preferenza di chi guarda, non una schermata
        raggiungibile (regola 7).
      */}
      {/*
        ⚠ **Il contenuto è montato solo per chi ha il flag**, non nascosto: senza
        `statsPlus` il calcolo non gira affatto — che non è una difesa (i dati
        chi è Pro li ha già), ma è lavoro risparmiato a ogni snapshot per chi non
        guarderà mai questo pannello.
      */}
      {statsPlus && (
        <Tabs.Content value="stats">
          <main className="mx-auto w-full max-w-6xl p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <StatsPlusTab
              role={snapshot.auction.currentRole}
              temperatura={temperaturaRuolo}
              scatto={scattoRuolo}
              alMinimo={alMinimoRuolo}
              saldi={saldi}
              partecipanti={partecipanti}
              nomiMembri={nomiMembri}
              alternative={alternativeLotto}
              avvisi={avvisiRuolo}
              strutturale={strutturale}
              lottoAperto={lot !== null}
              haPma={poolHaPma}
            />
          </main>
        </Tabs.Content>
      )}

      <Tabs.Content value="listone">
        <main className="mx-auto w-full max-w-6xl p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {listone === null ? null : (
            <ListoneTable
              auctionId={auctionId}
              pool={pool}
              snapshot={snapshot}
              budget={budget}
              status={listone}
            />
          )}
        </main>
      </Tabs.Content>

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
        budget={budget}
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
          budget={budget}
          statsPlus={statsPlus}
          myMemberId={myMemberId}
          offset={offset}
          onBid={(amount) => sendAction(auctionId, { type: "BID", amount })}
        />
      )}
    </Tabs.Root>
  );
}

/**
 * La barra delle tab, e il countdown che ci vive dentro (M21 §1 e §8).
 *
 * ⚠ **Perché il countdown sta qui e non solo nella card.** M17 §4 ha costruito i
 * due pannelli su una promessa precisa: chiuderne uno non nasconde niente, perché
 * la card sotto tiene *il tempo che resta* e *il pulsante che riapre*. Quella card
 * sta nella tab Asta. Chi chiude il pannello dal Listone si troverebbe davanti a
 * una tabella, senza countdown e senza strada per tornare — cioè esattamente il
 * vicolo cieco che M17 aveva chiuso. È la stessa promessa, spostata dove serve.
 *
 * ⚠ **E si vede solo nella tab Listone**, che è una scelta e non una svista: in
 * quella dell'Asta le stesse tre cose sono dieci pixel più in basso, dentro la
 * card della scena. Ripeterle vorrebbe dire spendere due volte l'altezza che M17
 * ha passato una macro intera a restituire al telefono.
 *
 * ⚠ **Il countdown resta rendering** (regola 1): stesso `Countdown`, stesso
 * `offset` dello stream, stesso `pausedAt`. Non decide niente, disegna un numero
 * che il server ha già deciso.
 */
function PortalTabs({
  tab,
  canSeeListone,
  scene,
  snapshot,
  offset,
  frozen,
  myMemberId,
  statsPlus,
  onOpenBid,
  onOpenPick,
}: {
  tab: Tab;
  canSeeListone: boolean;
  statsPlus: boolean;
  scene: Scene;
  snapshot: Snapshot;
  offset: number;
  frozen: boolean;
  myMemberId: string | null;
  onOpenBid: () => void;
  onOpenPick: () => void;
}) {
  const time = sceneTime(scene, snapshot);
  const azione = azioneDiScena(scene, snapshot, myMemberId);

  return (
    <div className="bg-background/95 supports-backdrop-filter:bg-background/80 border-b backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-2">
        <Tabs.List className="bg-muted flex gap-1 rounded-lg p-1">
          <Linguetta value="asta">Asta</Linguetta>
          <Linguetta value="listone" disabled={!canSeeListone}>
            Listone
          </Linguetta>
          {/*
            ⚠ **La linguetta c'è solo per chi ha Stats+, e qui NON si usa
            `disabled`** — al contrario del Listone due righe sopra. La
            differenza è deliberata: là la tab spenta è visibile perché il Pro è
            una cosa che si può chiedere, e «una tab che non c'è non si può
            desiderare». Stats+ invece non si chiede: lo assegna un
            amministratore, uno per uno. Una linguetta spenta con accanto «è per
            chi ha Stats+» sarebbe una porta senza campanello.

            ⚠ E chi non ce l'ha vede **il portale di sempre, identico** (§8):
            nessuno spazio vuoto, nessuna traccia. È la stessa promessa che vale
            per un Pro senza il flag e per un amministratore senza il flag.
          */}
          {statsPlus && <Linguetta value="stats">Stats+</Linguetta>}
        </Tabs.List>

        {/*
          ⚠ **Una riga di testo e non un tooltip**, ed è la strada che M21 §7
          lasciava aperta esplicitamente: «se in fase di UI si rivelasse fragile
          sul telefono — dove un tooltip senza hover non esiste — la strada
          alternativa è una riga di testo sotto le tab, e si decide guardandola».
          Guardata: su un telefono un tooltip su un elemento disabilitato non si
          apre in nessun modo, quindi sarebbe una spiegazione che nessuno legge
          proprio dove la tab spenta si tocca. La tab **resta visibile** — una tab
          che non c'è non si può desiderare — e accanto c'è scritto perché.
        */}
        {!canSeeListone && (
          <span className="text-muted-foreground text-xs">
            Il Listone è per gli utenti Pro
          </span>
        )}

        {tab === "listone" && time !== null && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-muted-foreground hidden text-xs sm:inline">
              {time.label}
            </span>
            <Countdown
              deadline={time.deadline}
              offset={offset}
              pausedAt={frozen ? snapshot.auction.pausedAt : null}
              className="text-sm font-semibold"
            />
            {azione !== null && (
              <Button
                type="button"
                size="sm"
                disabled={frozen}
                onClick={azione === "pick" ? onOpenPick : onOpenBid}
              >
                {azione === "pick" ? "Scegli" : "Offri"}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Quale pannello riapre il pulsante della barra, se ce n'è uno da riaprire.
 *
 * Le due condizioni sono le stesse di `SceneAction`, e restano **due copie di due
 * righe** invece di un'astrazione: là il pulsante è alto 48px e a piena larghezza
 * perché è l'azione della card, qui è un pulsante piccolo in una barra: stesse
 * condizioni, forme diverse, e un componente solo che prendesse anche la forma
 * sarebbe più difficile da leggere di così (regola 8).
 */
function azioneDiScena(
  scene: Scene,
  snapshot: Snapshot,
  myMemberId: string | null,
): "pick" | "bid" | null {
  if (scene === "PICK_MINE") return "pick";
  if (scene === "OFFERS" || scene === "TIE_OPEN") {
    return amEligible(snapshot.currentLot, myMemberId) ? "bid" : null;
  }
  return null;
}

function Linguetta({
  value,
  disabled = false,
  children,
}: {
  value: Tab;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tabs.Trigger
      value={value}
      disabled={disabled}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium",
        "data-[state=active]:bg-background data-[state=active]:shadow-sm",
        "data-[state=inactive]:text-muted-foreground",
        disabled && "opacity-50",
      )}
    >
      {children}
    </Tabs.Trigger>
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
  action,
}: {
  scene: Scene;
  snapshot: Snapshot;
  myMemberId: string | null;
  pool: PoolPlayer[];
  /** Valorizzata solo nell'esito: il perché sta su `actionInBody`. */
  action: React.ReactNode;
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
      return (
        <LotClosedCard
          snapshot={snapshot}
          myMemberId={myMemberId}
          action={action}
        />
      );
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
        // ⚠ Nero e non `outline` (richiesta dell'owner del 2026-08-22): è il
        // pulsante primario dell'app, ed è la stessa forma di «Mostra risultati»
        // nel cancello. I due sono lo stesso gesto in due momenti — anticipare una
        // scadenza che scadrebbe da sé — e avere l'uno pieno e l'altro contornato
        // faceva sembrare che uno dei due fosse meno definitivo dell'altro.
        type="button"
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
