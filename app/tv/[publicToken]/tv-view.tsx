"use client";

import { Campioncino } from "@/components/auction/campioncino";
import { Countdown } from "@/components/auction/countdown";
import { statusLabel } from "@/components/setup/status-badge";
import { Badge } from "@/components/ui/badge";
import {
  type AuctionStatus,
  ROLES,
  ROLE_LABELS_ONE,
  type Role,
} from "@/lib/domain";
import {
  bidOffsetLabel,
  compareRevealBids,
  memberById,
  memberLabel,
  portalScreen,
  revealBaseMs,
  tvConnected,
} from "@/lib/realtime/portal";
import type { Presence, Snapshot, SnapshotMember } from "@/lib/realtime/types";
import { useAuctionStream } from "@/lib/realtime/use-auction-stream";
import { cn } from "@/lib/utils";

/**
 * La vista proiettata: **un tabellone di recap**, sola lettura.
 *
 * Fino a M2 questa pagina era calcolata per un televisore da 50" letto da
 * quattro metri: niente sotto i 36px, il nome del giocatore fino a 128px, e la
 * classifica ridotta al totale `11/25` perché quattro frazioni per riga da
 * lontano diventano una riga di numerini. Nella pratica la TV sta su un
 * portatile, a mezzo metro, e quel vincolo produceva solo uno spreco: mezzo
 * schermo per un countdown che ognuno ha già sul proprio telefono.
 *
 * Da qui la forma attuale, che è un cambio di natura e non di scala:
 *
 * - **Tre quarti di schermo sono il tabellone**: tutte le squadre, con la rosa
 *   completa e i crediti residui. Gli slot ancora da riempire restano disegnati,
 *   quindi ogni card è alta uguale dall'inizio della serata alla fine: la
 *   griglia non balla a ogni acquisto, e chi è indietro si vede a colpo
 *   d'occhio. È questa la cosa che nessuno può tenere a mente da solo, ed è per
 *   questo che sta sullo schermo grande.
 * - **Un quarto è il lotto in corso**: giocatore, countdown, buste aperte. Resta
 *   il più leggibile della colonna ma non della pagina. In cima a quella stessa
 *   colonna sta l'**intestazione**, nome dell'asta e stato: prima era una
 *   striscia a tutta larghezza sopra entrambi, e da lì si prendeva una riga di
 *   rosa in ognuna delle card del tabellone — l'altezza è la risorsa scarsa di
 *   questa pagina, e la colonna del lotto ne ha da spendere mentre il tabellone
 *   no.
 * - **La forma non cambia mai.** Nemmeno al reveal: le buste si aprono nella
 *   colonna mentre la card del vincitore si accende nel tabellone, e i due lati
 *   raccontano insieme chi ha vinto, a quanto, e com'è adesso la sua rosa.
 *
 * Due cose restano dalla versione precedente, e per le stesse ragioni di prima.
 * **I colori sono fissi, bianco su nero**, invece che presi dal tema: è l'unica
 * pagina che non lo segue, perché uno schermo condiviso non ha una preferenza di
 * sistema. E **niente hover, niente scroll, niente click**: chi guarda non ha un
 * mouse, quindi tutto ciò che conta sta in una schermata sola.
 *
 * ⚠ **Il numero scomodo, dichiarato.** Su 900px di altezza ogni card ha circa
 * 430px per venticinque righe: ~16px a riga, testo a 11px. Ci sta, ma sotto gli
 * ~800px di altezza il tabellone non è più leggibile. È una pagina da portatile,
 * dichiaratamente: chi ha bisogno di più corpo fa zoom, ed è la richiesta da cui
 * questo lavoro è nato.
 *
 * Sulle buste non c'è niente da nascondere: lo snapshot della TV non le contiene
 * (I8, e da M1 nemmeno chi ha consegnato). I prezzi che si leggono nel tabellone
 * sono assegnazioni chiuse, non offerte in corso.
 *
 * ⚠ **Non riceve `isSimulated`, e non è una dimenticanza.** Fino a poco fa la TV
 * proiettava il marchio dell'asta di prova, con un componente suo perché il badge
 * condiviso prende i colori dal tema e qui il fondo è nero fisso. È stato tolto
 * su richiesta: chi guarda quello schermo sa già se la serata è una prova, e
 * l'intestazione della TV vale solo se dice le due cose che nessuno ha in testa —
 * *quale* asta è, e se sta correndo o è ferma.
 */
export function TvView({
  auctionId,
  publicToken,
  auctionName,
}: {
  auctionId: string;
  publicToken: string;
  auctionName: string;
}) {
  const { snapshot, connected, offset, deleted } = useAuctionStream(
    auctionId,
    publicToken,
  );

  /**
   * **La TV si ferma qui** (M12 §3, ultimo capoverso).
   *
   * ⚠ Nessuna navigazione, e non è una dimenticanza: la TV non ha una dashboard
   * dove andare — non ha nemmeno una sessione — e mandarla a `/dashboard`
   * significherebbe proiettare una schermata di login in mezzo alla stanza. Lo
   * stream è già chiuso dall'hook, quindi da qui non riparte niente.
   *
   * Il nome dell'asta resta in cima come nel resto della vista: chi alza gli
   * occhi deve capire *quale* asta è finita, non soltanto che è finita.
   */
  if (deleted !== null) {
    return (
      <Screen>
        <header className="flex shrink-0 items-baseline gap-4 border-b border-white/15 px-4 py-2">
          <h1 className="truncate text-base font-semibold">
            {deleted.auctionName}
          </h1>
        </header>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 text-center">
          <p className="text-5xl font-semibold tracking-tight">
            Asta cancellata
          </p>
          <p className="max-w-2xl text-2xl text-white/70">
            Un amministratore ha cancellato questa asta. Il tabellone si ferma
            qui.
          </p>
        </div>
      </Screen>
    );
  }

  if (snapshot === null) {
    return (
      <Screen>
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <h1 className="text-3xl font-semibold">{auctionName}</h1>
          <p className="text-lg text-white/60">
            {connected ? "Carico l'asta…" : "Mi collego all'asta…"}
          </p>
        </div>
      </Screen>
    );
  }

  const { auction } = snapshot;
  const screen = portalScreen(snapshot, null);
  const reveal = snapshot.currentLot?.reveal ?? null;

  return (
    <Screen>
      <div className="flex min-h-0 flex-1">
        <section className="min-w-0 flex-3 p-2">
          <Board
            snapshot={snapshot}
            winnerMemberId={reveal?.winnerMemberId ?? null}
            wonPlayerId={
              reveal === null ? null : (snapshot.currentLot?.player.id ?? null)
            }
          />
        </section>

        <aside className="flex w-0 min-w-0 flex-1 shrink-0 flex-col gap-4 border-l border-white/15 px-4 py-4">
          {/**
           * L'intestazione **sta qui dentro** e non sopra le due colonne: a tutta
           * larghezza si portava via una riga di rosa da ogni card del tabellone,
           * che è la cosa per cui questa pagina esiste. In cima alla colonna del
           * lotto lo stesso testo non toglie niente a nessuno.
           *
           * Ci sono due cose sole. Il **nome dell'asta**, perché su uno schermo
           * proiettato serve sapere *quale* serata si sta guardando; e lo **stato**,
           * che risponde alla domanda di chi alza gli occhi e trova tutti i numeri
           * immobili — sta correndo o è in pausa? La **fase** («offerte»,
           * «spareggio») era qui e non c'è più: la colonna sotto la racconta in
           * grande, e ripeterla in piccolo a due centimetri di distanza era due
           * volte la stessa informazione nello stesso sguardo.
           */}
          <header className="flex shrink-0 flex-col gap-0.5 border-b border-white/15 pb-2">
            <div className="flex items-center gap-3">
              <h1 className="min-w-0 truncate text-base font-semibold">
                {auction.name}
              </h1>
              <TvStatusBadge status={auction.status} />
            </div>
            {/* Su una riga sua, e solo quando serve: se lo stream cade il
                tabellone resta pieno di numeri che sembrano validi, e questa è
                l'unica cosa in pagina che dica il contrario. */}
            {!connected && (
              <p className="text-sm text-amber-300">riconnessione…</p>
            )}
          </header>

          <div className="flex min-h-0 flex-1 flex-col justify-center gap-4">
            {screen.kind === "NOT_STARTED" && (
              <Headline
                kicker="In attesa"
                title="L'asta non è ancora iniziata"
                sub="Aspettiamo che siano tutti collegati."
              />
            )}

            {screen.kind === "COMPLETED" && (
              <Headline
                kicker="Fine"
                title="Asta conclusa"
                sub="Le rose qui accanto sono definitive."
              />
            )}

            {screen.kind === "PICK_WAIT" && (
              <PickStage snapshot={snapshot} offset={offset} />
            )}

            {screen.kind === "LOT" && snapshot.currentLot !== null && (
              <LotStage snapshot={snapshot} offset={offset} />
            )}

            {screen.frozen && (
              <p className="rounded-xl border-2 border-amber-400 px-3 py-2 text-center text-sm font-semibold text-amber-300">
                Asta in pausa — i countdown sono fermi
              </p>
            )}
          </div>
        </aside>
      </div>
    </Screen>
  );
}

/**
 * La cornice: schermo intero, nero, senza scroll. `dark` è forzato perché
 * dentro ci sono componenti condivisi (il countdown) che leggono le variabili
 * del tema.
 */
function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark flex h-dvh flex-col overflow-hidden bg-black text-white">
      {children}
    </div>
  );
}

// ─── Il tabellone ────────────────────────────────────────────────────────────

/**
 * Tutte le squadre, sempre tutte, su due righe.
 *
 * Le colonne sono `ceil(squadre / 2)`: otto squadre danno quattro colonne
 * larghe, dodici ne danno sei strette. Due righe e non tre perché una card di
 * venticinque giocatori vuole altezza, ed è l'altezza la risorsa scarsa.
 */
function Board({
  snapshot,
  winnerMemberId,
  wonPlayerId,
}: {
  snapshot: Snapshot;
  /** Chi ha appena vinto, per i secondi del reveal. `null` fuori dal reveal. */
  winnerMemberId: string | null;
  /** Il giocatore appena aggiudicato, da evidenziare nella sua nuova rosa. */
  wonPlayerId: string | null;
}) {
  const { auction, members } = snapshot;
  const columns = Math.max(1, Math.ceil(members.length / 2));

  return (
    <div
      className="grid h-full min-h-0 gap-2"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridTemplateRows: members.length > columns ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)",
      }}
    >
      {members.map((member) => (
        <TeamCard
          key={member.id}
          member={member}
          slots={auction.slots}
          isTurn={member.id === auction.currentMemberId}
          isWinner={member.id === winnerMemberId}
          wonPlayerId={wonPlayerId}
        />
      ))}
    </div>
  );
}

type BoardRow = {
  key: string;
  /** La lettera del ruolo, solo sulla prima riga del gruppo. */
  role: Role | null;
  name: string | null;
  price: number | null;
  won: boolean;
};

/**
 * Le righe di una rosa: i presi per ruolo, e sotto gli slot che mancano.
 *
 * Sono sempre `slot totali` righe, anche a rosa vuota. È ciò che tiene le card
 * alte uguali e la griglia ferma, e insieme risponde alla domanda che uno si fa
 * guardando il tabellone — non «chi ha preso» ma «quanti gliene mancano».
 */
function boardRows(
  member: SnapshotMember,
  slots: Record<Role, number>,
  wonPlayerId: string | null,
): BoardRow[] {
  const rows: BoardRow[] = [];
  for (const role of ROLES) {
    // ⚠ **Nessun riordino** (M18 §2): `member.roster` è già in ordine di
    // estrazione. Fino a M18 qui c'era un `.sort((a, b) => b.price - a.price)`.
    //
    // In TV ha un secondo effetto che conviene sapere: **il giocatore appena
    // vinto è sempre l'ultima riga piena del suo gruppo**, cioè un posto fisso,
    // mentre col riordino per prezzo l'evidenziazione compariva dove il prezzo
    // la mandava. Il resto di `boardRows` non cambia: sono sempre `slot totali`
    // righe, ed è ciò che tiene le card alte uguali.
    const owned = member.roster.filter((entry) => entry.role === role);
    const empty = Math.max(0, slots[role] - owned.length);

    owned.forEach((entry, i) => {
      rows.push({
        key: entry.assignmentId,
        role: i === 0 ? role : null,
        name: entry.name,
        price: entry.price,
        won: entry.playerId === wonPlayerId,
      });
    });
    for (let i = 0; i < empty; i++) {
      rows.push({
        key: `${role}-empty-${i}`,
        role: owned.length === 0 && i === 0 ? role : null,
        name: null,
        price: null,
        won: false,
      });
    }
  }
  return rows;
}

/**
 * Chi è collegato, prima del nome squadra: **verde sì, rosso no** (M16).
 *
 * ⚠ **Non riusa `PresenceDot`**, ed è la ragione per cui questa pagina non riusa
 * nessuno dei componenti condivisi che hanno un colore dentro: è bianco su nero
 * fisso, e `PresenceDot` disegna l'`OFFLINE` con `bg-muted-foreground/40`, che su
 * fondo nero diventa un grigio chiaro — cioè il contrario di ciò che deve
 * comunicare. Qui i due colori sono scritti a mano e non passano dal tema.
 *
 * La mappa da tre stati a due sta altrove e in un posto solo, `tvConnected`:
 * qui c'è solo il colore. `aria-label` c'è per disciplina, ma nessuno legge
 * questa pagina con uno screen reader — è un televisore.
 */
function TvPresenceDot({ presence }: { presence: Presence }) {
  const connected = tvConnected(presence);
  return (
    <span
      className={cn(
        "size-2 shrink-0 self-center rounded-full",
        connected ? "bg-emerald-400" : "bg-red-500",
      )}
      role="img"
      aria-label={connected ? "collegato" : "non collegato"}
      title={connected ? "collegato" : "non collegato"}
    />
  );
}

/**
 * Lo stato dell'asta nell'intestazione della TV: **in corso**, **in pausa**, o
 * quello che è.
 *
 * Usa la primitiva `Badge` — la forma, il raggio, il passo del testo sono quelli
 * di tutti gli altri badge dell'applicazione — ma **non riusa `StatusBadge`**, e
 * la ragione non è il solito discorso sul tema: è che quella mappa qui perde
 * proprio l'informazione che serve. `StatusBadge` manda `LIVE` e `READY` sulla
 * stessa variante `default`, e `PAUSED` e `COMPLETED` sulla stessa `secondary`:
 * su questo schermo «in corso» e «in pausa» si distinguerebbero **soltanto
 * leggendo la parola**, mentre la domanda a cui questo badge risponde — sta
 * correndo o è ferma? — è quella che si fa alzando gli occhi da tre metri, senza
 * leggere.
 *
 * Quindi tre famiglie di colore, scritte a mano come tutto il resto della pagina
 * perché il fondo è nero fisso: **verde** corre, **ambra** è ferma, **bianco
 * smorto** è tutto ciò che non è ancora cominciato o è già finito. Le *parole*
 * invece restano condivise, `statusLabel`: qui non c'è niente da dire in modo
 * diverso, e due elenchi di etichette divergerebbero.
 *
 * ⚠ `variant="outline"` e non un badge pieno, anche per la pausa. Il richiamo
 * forte per l'asta ferma esiste già ed è il cartello ambra in fondo alla colonna,
 * che dice la cosa in più — i countdown sono fermi. Due allarmi ambra nella stessa
 * colonna, uno sopra l'altro, si annullano.
 */
function TvStatusBadge({ status }: { status: AuctionStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "ml-auto text-sm font-semibold tracking-wide uppercase",
        status === "PAUSED"
          ? "border-amber-300/60 text-amber-300"
          : status === "LIVE"
            ? "border-emerald-400/60 text-emerald-300"
            : "border-white/25 text-white/60",
      )}
    >
      {statusLabel(status)}
    </Badge>
  );
}

function TeamCard({
  member,
  slots,
  isTurn,
  isWinner,
  wonPlayerId,
}: {
  member: SnapshotMember;
  slots: Record<Role, number>;
  isTurn: boolean;
  isWinner: boolean;
  wonPlayerId: string | null;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-white/10 px-1.5 py-1",
        isTurn && "bg-white/10",
        isWinner && "border-emerald-400 bg-emerald-400/10",
      )}
    >
      <div className="flex shrink-0 items-baseline gap-1.5 border-b border-white/10 pb-1">
        <TvPresenceDot presence={member.presence} />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">
          {member.teamName}
        </span>
        <span className="shrink-0 text-xs font-semibold tabular-nums">
          {member.credits}
        </span>
      </div>

      <ul className="flex min-h-0 flex-1 flex-col justify-evenly overflow-hidden pt-0.5">
        {boardRows(member, slots, wonPlayerId).map((row) => (
          <li
            key={row.key}
            className={cn(
              "flex items-baseline gap-1 text-[0.7rem] leading-none",
              row.won && "font-semibold text-emerald-300",
            )}
          >
            <span className="w-2 shrink-0 text-white/35">{row.role ?? ""}</span>
            {row.name === null ? (
              <span className="mb-[0.15rem] flex-1 border-b border-dashed border-white/15" />
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                <span
                  className={cn(
                    "shrink-0 tabular-nums",
                    !row.won && "text-white/60",
                  )}
                >
                  {row.price}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── La colonna del lotto ────────────────────────────────────────────────────

function Headline({
  kicker,
  title,
  sub,
}: {
  kicker: string;
  title: string;
  sub?: string;
}) {
  return (
    <div className="space-y-2 text-center">
      <p className="text-xs tracking-[0.2em] text-white/50 uppercase">
        {kicker}
      </p>
      <p className="text-2xl leading-tight font-semibold">{title}</p>
      {sub && <p className="text-sm text-white/60">{sub}</p>}
    </div>
  );
}

/** Il turno di chiamata: chi deve scegliere, quale ruolo, quanto tempo resta. */
function PickStage({
  snapshot,
  offset,
}: {
  snapshot: Snapshot;
  offset: number;
}) {
  const { auction } = snapshot;
  const turnOf = memberById(snapshot, auction.currentMemberId);
  const role = auction.currentRole;

  return (
    <div className="space-y-3 text-center">
      <p className="text-xs tracking-[0.2em] text-white/50 uppercase">
        Tocca a
      </p>
      <p className="text-3xl leading-tight font-semibold">
        {memberLabel(turnOf)}
      </p>
      <p className="text-sm text-white/70">
        deve chiamare{" "}
        {role === null ? "un giocatore" : `un ${ROLE_LABELS_ONE[role]}`}
      </p>
      <BigCountdown
        deadline={auction.phaseDeadline}
        offset={offset}
        pausedAt={auction.pausedAt}
      />
    </div>
  );
}

/** Il lotto: il giocatore in ballo, le buste, e — solo alla fine — gli importi. */
function LotStage({
  snapshot,
  offset,
}: {
  snapshot: Snapshot;
  offset: number;
}) {
  const { auction } = snapshot;
  const lot = snapshot.currentLot;
  if (lot === null) return null;
  const reveal = lot.reveal;

  return (
    <div className="space-y-4">
      <div className="text-center">
        {/*
          ⚠ Un terzo della larghezza **di questa colonna** (M7 §6). È lo schermo
          per cui la `card` è stata disegnata, ed è il posto dove si legge la
          cornice con lo scudetto: qui la figurina risponde alla domanda che la
          stanza fa a voce alta — «chi è?» — mentre il tabellone accanto risponde
          a quella che nessuno può tenere a mente.
        */}
        <Campioncino
          extId={lot.player.extId}
          className="mx-auto mb-3 w-1/3 rounded-lg"
        />
        <p className="text-xs tracking-[0.2em] text-white/50 uppercase">
          {ROLE_LABELS_ONE[lot.player.role]} · {lot.player.team}
        </p>
        <p className="text-[clamp(1.5rem,2.6vw,2.5rem)] leading-tight font-semibold">
          {lot.player.name}
        </p>
        <p className="mt-1 text-sm text-white/60">
          chiamato da {memberLabel(memberById(snapshot, lot.calledByMemberId))}
          {lot.autoCalled && " · scelta automatica"}
          {lot.roundNo === 2 && " · spareggio"}
        </p>
      </div>

      {reveal !== null ? (
        <RevealStage snapshot={snapshot} offset={offset} />
      ) : auction.phase === "LOT_SEALED" ? (
        <SealedStage snapshot={snapshot} offset={offset} />
      ) : lot.tie !== null ? (
        <div className="space-y-2 text-center">
          <p className="text-sm text-white/70">
            Pareggio a{" "}
            <span className="text-xl font-semibold text-amber-300">
              {lot.tie.amount}
            </span>
          </p>
          <p className="text-sm">
            {lot.tie.memberIds
              .map((id) => memberLabel(memberById(snapshot, id)))
              .join(" · ")}
          </p>
          <BigCountdown
            deadline={auction.phaseDeadline}
            offset={offset}
            pausedAt={auction.pausedAt}
          />
        </div>
      ) : (
        <div className="space-y-3">
          <SealedBids />
          <BigCountdown
            deadline={lot.endsAt}
            offset={offset}
            pausedAt={auction.pausedAt}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Il posto dove stavano le buste consegnate.
 *
 * Non è rimasto vuoto di proposito: uno schermo che durante il lotto non dice
 * niente sembra uno schermo fermo, e in una stanza con dieci persone che
 * guardano «non succede niente» e «si è piantato» hanno lo stesso aspetto. Una
 * riga che dichiara il silenzio lo rende una regola invece che un guasto.
 */
function SealedBids() {
  return (
    <p className="text-center text-sm text-white/60">
      Le buste sono segrete fino allo scadere
    </p>
  );
}

/**
 * Il cancello dei risultati, sullo schermo che la stanza sta guardando (M14 §4).
 *
 * ⚠ **Questo ramo va scritto, e la ragione è che senza di lui la TV non sbaglia in
 * modo evidente: sbaglia in modo credibile.** Durante `LOT_SEALED` sia `reveal` sia
 * `tie` sono `null`, quindi la colonna cadeva sul ramo del lotto vivo — «Le buste
 * sono segrete fino allo scadere» e un countdown puntato su `lot.endsAt`, che è un
 * istante **già passato**. Chi guarda avrebbe letto «in chiusura…» fermo per dieci
 * secondi, cioè un tabellone che sembra piantato nel momento esatto in cui tutta la
 * stanza lo sta fissando.
 *
 * Il tono non è quello di un'attesa tecnica, ed è deliberato: in un'asta a busta
 * chiusa **questo è il momento**, e allungarlo un po' è precisamente ciò che l'owner
 * ha chiesto di poter fare. Il countdown è il numero grande della colonna, come nel
 * round di offerte: è la stessa domanda — «quanto manca?» — con una risposta diversa.
 */
function SealedStage({
  snapshot,
  offset,
}: {
  snapshot: Snapshot;
  offset: number;
}) {
  const { auction } = snapshot;
  return (
    <div className="space-y-3 text-center">
      <p className="text-xs tracking-[0.2em] text-white/50 uppercase">
        Buste consegnate
      </p>
      <p className="text-2xl leading-tight font-semibold">
        {auction.status === "PAUSED"
          ? "Le buste restano chiuse"
          : "Si aprono tutte insieme"}
      </p>
      <p className="text-sm text-white/60">
        {auction.status === "PAUSED"
          ? "L'asta è in pausa: nessuno sa ancora com'è finita."
          : "Il round è chiuso. Nessuno sa ancora com'è finita."}
      </p>
      <BigCountdown
        deadline={auction.phaseDeadline}
        offset={offset}
        pausedAt={auction.pausedAt}
      />
    </div>
  );
}

/**
 * L'apertura delle buste: l'unico momento in cui gli importi sono pubblici.
 *
 * Mostra **tutti** i round, non solo l'ultimo: in uno spareggio, mostrare solo
 * il round finale significherebbe nascondere proprio le buste che lo spareggio
 * l'avevano causato.
 *
 * Accanto a ogni cifra c'è **quando quella busta è stata fissata** — `+0s`, `+3s`
 * — che è lo stesso dato del pannello sul telefono perché è la stessa funzione
 * (`bidOffsetLabel`, e il conto parte dalla prima busta del round: il perché è
 * scritto là). In uno spareggio è il numero che *decide*, quindi è la risposta
 * alla domanda che in quella stanza si fa a voce alta quando due hanno offerto lo
 * stesso: «e chi c'era arrivato prima?». Le buste sono ordinate con lo stesso
 * criterio del portale, importo e poi tempo, perché due `40` in ordine arbitrario
 * con i secondi scritti accanto si leggono come una classifica sbagliata.
 *
 * Resta in questa colonna e non prende mai tutto lo schermo. Il tabellone
 * accanto sta già raccontando l'altra metà della stessa cosa — la card del
 * vincitore accesa, con dentro il giocatore appena entrato — e toglierlo di
 * mezzo proprio adesso vorrebbe dire far sparire il recap nel momento in cui
 * uno vuole confrontare i crediti residui.
 */
function RevealStage({
  snapshot,
  offset,
}: {
  snapshot: Snapshot;
  offset: number;
}) {
  const reveal = snapshot.currentLot?.reveal;
  if (!reveal) return null;
  const { auction } = snapshot;

  return (
    <div className="space-y-3">
      <div className="space-y-1 rounded-xl border-2 border-emerald-400 bg-emerald-400/10 px-3 py-2 text-center">
        <p className="truncate text-base font-semibold">
          {memberLabel(memberById(snapshot, reveal.winnerMemberId))}
        </p>
        <p className="text-3xl leading-none font-semibold text-emerald-300">
          {reveal.price}
        </p>
      </div>

      {reveal.rounds.map((round) => {
        const base = revealBaseMs(round.bids);
        return (
          <div key={round.roundNo} className="space-y-1">
            {reveal.rounds.length > 1 && (
              <p className="text-center text-xs tracking-[0.2em] text-white/45 uppercase">
                {round.roundNo === 1
                  ? "Buste"
                  : `Spareggio · da ${round.minAmount}`}
              </p>
            )}
            <ul className="space-y-0.5">
              {[...round.bids].sort(compareRevealBids).map((bid) => (
                <li
                  key={bid.memberId}
                  className={cn(
                    "flex items-baseline gap-2 text-sm",
                    bid.withdrawnAt !== null && "text-white/45",
                    bid.memberId === reveal.winnerMemberId &&
                      round.roundNo === reveal.rounds.length &&
                      "font-semibold text-emerald-300",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {memberLabel(memberById(snapshot, bid.memberId))}
                  </span>
                  {/* Il «+3s»: lo stesso dato e lo stesso testo del portale,
                      perché è la stessa funzione. Smorto e più piccolo della
                      cifra di proposito — l'importo è ciò che la stanza legge da
                      lontano, il secondo è ciò che si cerca quando l'esito viene
                      contestato. */}
                  <span className="shrink-0 text-xs text-white/50 tabular-nums">
                    {bid.withdrawnAt !== null
                      ? "ritirata"
                      : bidOffsetLabel(bid.amountSetAt, base)}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 tabular-nums",
                      bid.withdrawnAt !== null && "line-through",
                    )}
                  >
                    {bid.amount}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      <p className="text-center text-sm text-white/55">
        Prossimo turno ·{" "}
        <Countdown
          deadline={auction.phaseDeadline}
          offset={offset}
          pausedAt={auction.pausedAt}
          className="font-semibold text-white"
        />
      </p>
    </div>
  );
}

/**
 * Il countdown della colonna: il numero più grande di questo quarto di schermo,
 * non della pagina. Ogni partecipante ha il proprio sul telefono, e qui lo
 * spazio serve al recap.
 */
function BigCountdown({
  deadline,
  offset,
  pausedAt,
}: {
  deadline: string | null;
  offset: number;
  pausedAt: string | null;
}) {
  return (
    <Countdown
      deadline={deadline}
      offset={offset}
      pausedAt={pausedAt}
      className="block text-center text-[clamp(2rem,4vw,3.5rem)] leading-none font-semibold"
    />
  );
}
