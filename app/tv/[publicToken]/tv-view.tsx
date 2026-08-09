"use client";

import { Countdown } from "@/components/auction/countdown";
import { ROLE_LABELS, ROLE_LABELS_ONE, ROLES } from "@/lib/domain";
import { spentCredits } from "@/lib/realtime/manage";
import {
  memberById,
  memberLabel,
  phaseLabel,
  portalScreen,
} from "@/lib/realtime/portal";
import type { Snapshot } from "@/lib/realtime/types";
import { useAuctionStream } from "@/lib/realtime/use-auction-stream";
import { cn } from "@/lib/utils";

/**
 * La vista proiettata (F6-05, F6-06): **sola lettura, letta da lontano**.
 *
 * Tre vincoli, e sono tutti conseguenze del posto in cui vive questa pagina —
 * un televisore in fondo a una stanza, con dieci persone che guardano da tre o
 * quattro metri:
 *
 * 1. **Niente hover, niente scroll, niente click.** Nessuna informazione può
 *    stare dietro a un'interazione: chi guarda non ha un mouse. Tutto ciò che
 *    conta sta in una schermata sola.
 * 2. **Tipografia grande e contrasto alto, sempre.** I colori qui sono fissi —
 *    bianco su nero — invece che presi dal tema: un proiettore non ha una
 *    preferenza di sistema, e un tema chiaro in una stanza al buio è
 *    illeggibile. È l'unica pagina dell'applicazione che non segue il tema.
 *
 *    Le misure non sono a occhio. Su un televisore da 50" a 1080p un pixel vale
 *    circa 0,57 mm; la regola pratica della leggibilità vuole un'altezza del
 *    carattere pari a un 150-esimo della distanza, cioè ~2,7 cm a quattro metri,
 *    cioè **~47 px**. Da lì: niente che sia un *dato* scende sotto i 36 px
 *    (`text-4xl`), le etichette di contorno — quelle che si leggono una volta e
 *    poi si sanno — stanno a 24 px, e ciò che decide la serata (nome del
 *    giocatore, countdown, prezzo di aggiudicazione) sta fra i 128 e i 144 px.
 * 3. **Niente di niente sulle buste, finché non si aprono.** Non perché lo
 *    nascondiamo qui: perché lo snapshot della TV non lo contiene (I8, e da M1
 *    nemmeno chi ha consegnato o quante buste sono arrivate). Era proprio
 *    questo schermo il problema: un riquadro che si accendeva per ogni busta
 *    consegnata, grande abbastanza da leggerlo da quattro metri, cioè un
 *    tabellone delle intenzioni altrui in mezzo a un'asta segreta.
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
  const { snapshot, connected, offset } = useAuctionStream(
    auctionId,
    publicToken,
  );

  if (snapshot === null) {
    return (
      <Screen>
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <h1 className="text-4xl font-semibold">{auctionName}</h1>
          <p className="text-2xl text-white/60">
            {connected ? "Carico l'asta…" : "Mi collego all'asta…"}
          </p>
        </div>
      </Screen>
    );
  }

  const { auction } = snapshot;
  const screen = portalScreen(snapshot, null);

  return (
    <Screen>
      <header className="flex items-baseline gap-6 border-b border-white/15 px-8 py-4">
        <h1 className="truncate text-4xl font-semibold">{auction.name}</h1>
        <p className="text-3xl text-white/75 uppercase">{phaseLabel(snapshot)}</p>
        {!connected && (
          <p className="text-2xl text-amber-300">riconnessione…</p>
        )}
        <p className="ml-auto text-2xl text-white/60">
          {auction.roleOrder
            .map((role) =>
              role === auction.currentRole
                ? ROLE_LABELS[role].toUpperCase()
                : ROLE_LABELS[role],
            )
            .join(" → ")}
        </p>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col justify-center gap-8 px-10 py-8">
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
            <p className="rounded-2xl border-4 border-amber-400 px-6 py-4 text-center text-3xl font-semibold text-amber-300">
              Asta in pausa — i countdown sono fermi
            </p>
          )}
        </section>

        <aside className="w-[34rem] shrink-0 overflow-hidden border-l border-white/15 px-6 py-6">
          <Standings snapshot={snapshot} />
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
    <div className="space-y-3 text-center">
      <p className="text-2xl tracking-[0.2em] text-white/50 uppercase">
        {kicker}
      </p>
      <p className="text-[clamp(2.5rem,6vw,5.5rem)] leading-tight font-semibold">
        {title}
      </p>
      {sub && <p className="text-3xl text-white/60">{sub}</p>}
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
    <div className="space-y-6 text-center">
      <p className="text-2xl tracking-[0.2em] text-white/50 uppercase">
        Tocca a
      </p>
      <p className="text-[clamp(3rem,8vw,7rem)] leading-none font-semibold">
        {memberLabel(turnOf)}
      </p>
      <p className="text-3xl text-white/70">
        deve chiamare {role === null ? "un giocatore" : `un ${ROLE_LABELS_ONE[role]}`}
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
    <div className="space-y-8">
      <div className="text-center">
        <p className="text-2xl tracking-[0.2em] text-white/50 uppercase">
          {ROLE_LABELS_ONE[lot.player.role]} · {lot.player.team}
        </p>
        <p className="text-[clamp(3rem,9vw,8rem)] leading-none font-semibold">
          {lot.player.name}
        </p>
        <p className="mt-3 text-2xl text-white/60">
          chiamato da {memberLabel(memberById(snapshot, lot.calledByMemberId))}
          {lot.autoCalled && " · scelta automatica"}
          {lot.roundNo === 2 && " · spareggio"}
        </p>
      </div>

      {reveal !== null ? (
        <RevealStage snapshot={snapshot} offset={offset} />
      ) : lot.tie !== null ? (
        <div className="space-y-4 text-center">
          <p className="text-3xl text-white/70">
            Pareggio a{" "}
            <span className="text-5xl font-semibold text-amber-300">
              {lot.tie.amount}
            </span>
          </p>
          <p className="text-3xl">
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
        <div className="space-y-6">
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
 * guardano la TV «non succede niente» e «si è piantato» hanno lo stesso aspetto.
 * Una riga che dichiara il silenzio lo rende una regola invece che un guasto.
 */
function SealedBids() {
  return (
    <p className="text-center text-4xl text-white/60">
      Le buste sono segrete fino allo scadere
    </p>
  );
}

/**
 * L'apertura delle buste: l'unico momento in cui gli importi sono pubblici.
 *
 * Mostra **tutti** i round, non solo l'ultimo. Prima di M1 la TV mostrava le
 * offerte del round finale: in uno spareggio significava nascondere proprio le
 * buste che lo spareggio l'avevano causato, e chi guardava vedeva due cifre
 * uguali senza sapere da dove venissero.
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
    <div className="space-y-6">
      <div className="flex items-baseline justify-center gap-6 rounded-2xl border-4 border-emerald-400 bg-emerald-400/10 px-8 py-5">
        <p className="text-5xl font-semibold">
          {memberLabel(memberById(snapshot, reveal.winnerMemberId))}
        </p>
        <p className="text-[clamp(3rem,7vw,6rem)] leading-none font-semibold text-emerald-300">
          {reveal.price}
        </p>
      </div>

      {reveal.rounds.map((round) => (
        <div key={round.roundNo} className="space-y-2">
          {reveal.rounds.length > 1 && (
            <p className="text-center text-2xl tracking-[0.2em] text-white/45 uppercase">
              {round.roundNo === 1
                ? "Buste"
                : `Spareggio · da ${round.minAmount}`}
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-3">
            {[...round.bids]
              .sort((a, b) => b.amount - a.amount)
              .map((bid) => (
                <p
                  key={bid.memberId}
                  className={cn(
                    "text-4xl",
                    bid.withdrawnAt !== null && "text-white/45 line-through",
                    bid.memberId === reveal.winnerMemberId &&
                      round.roundNo === reveal.rounds.length &&
                      "font-semibold text-emerald-300",
                  )}
                >
                  {memberLabel(memberById(snapshot, bid.memberId))}{" "}
                  <span className="tabular-nums">{bid.amount}</span>
                </p>
              ))}
          </div>
        </div>
      ))}

      <p className="text-center text-3xl text-white/55">
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
      className="block text-center text-[clamp(3rem,10vw,9rem)] leading-none font-semibold"
    />
  );
}

/**
 * La classifica permanente: crediti e quanto manca alla rosa piena, che è ciò
 * che si guarda fra un lotto e l'altro.
 *
 * Della rosa si mostra il totale (`11/25`) e non il dettaglio per ruolo: quattro
 * frazioni per riga sono leggibili su un monitor a mezzo metro e diventano una
 * riga di numerini a quattro metri. Chi vuole il dettaglio ce l'ha sul telefono.
 */
function Standings({ snapshot }: { snapshot: Snapshot }) {
  const { auction } = snapshot;
  const slotTotali = ROLES.reduce((n, role) => n + auction.slots[role], 0);

  return (
    <div className="flex h-full flex-col gap-3">
      <h2 className="text-2xl tracking-[0.2em] text-white/60 uppercase">
        Crediti
      </h2>
      <ul className="flex min-h-0 flex-1 flex-col justify-between gap-1">
        {snapshot.members.map((member) => (
          <li
            key={member.id}
            className={cn(
              "flex items-baseline gap-4 rounded-lg px-3 py-1.5",
              member.id === auction.currentMemberId && "bg-white/15",
            )}
          >
            <span className="min-w-0 flex-1 truncate text-4xl">
              {member.teamName}
            </span>
            <span className="text-2xl text-white/60 tabular-nums">
              {member.roster.length}/{slotTotali}
            </span>
            <span className="w-20 text-right text-4xl font-semibold tabular-nums">
              {member.credits}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-2xl text-white/50">
        speso in totale{" "}
        {snapshot.members.reduce((sum, m) => sum + spentCredits(m), 0)} crediti
      </p>
    </div>
  );
}

