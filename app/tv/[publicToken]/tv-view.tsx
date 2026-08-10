"use client";

import { Countdown } from "@/components/auction/countdown";
import { ROLES, ROLE_LABELS, ROLE_LABELS_ONE, type Role } from "@/lib/domain";
import { spentCredits } from "@/lib/realtime/manage";
import {
  memberById,
  memberLabel,
  phaseLabel,
  portalScreen,
} from "@/lib/realtime/portal";
import type { Snapshot, SnapshotMember } from "@/lib/realtime/types";
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
 *   il più leggibile della colonna ma non della pagina.
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
      <header className="flex shrink-0 items-baseline gap-4 border-b border-white/15 px-4 py-2">
        <h1 className="truncate text-base font-semibold">{auction.name}</h1>
        <p className="text-sm tracking-wide text-white/70 uppercase">
          {phaseLabel(snapshot)}
        </p>
        {!connected && <p className="text-sm text-amber-300">riconnessione…</p>}
        <p className="ml-auto text-sm text-white/45">
          speso {snapshot.members.reduce((sum, m) => sum + spentCredits(m), 0)}
        </p>
        <p className="text-sm text-white/55">
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
        <section className="min-w-0 flex-3 p-2">
          <Board
            snapshot={snapshot}
            winnerMemberId={reveal?.winnerMemberId ?? null}
            wonPlayerId={
              reveal === null ? null : (snapshot.currentLot?.player.id ?? null)
            }
          />
        </section>

        <aside className="flex w-0 min-w-0 flex-1 shrink-0 flex-col justify-center gap-4 border-l border-white/15 px-4 py-4">
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
    const owned = member.roster
      .filter((entry) => entry.role === role)
      .sort((a, b) => b.price - a.price);
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
      <p className="text-xs tracking-[0.2em] text-white/50 uppercase">Tocca a</p>
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
 * L'apertura delle buste: l'unico momento in cui gli importi sono pubblici.
 *
 * Mostra **tutti** i round, non solo l'ultimo: in uno spareggio, mostrare solo
 * il round finale significherebbe nascondere proprio le buste che lo spareggio
 * l'avevano causato.
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

      {reveal.rounds.map((round) => (
        <div key={round.roundNo} className="space-y-1">
          {reveal.rounds.length > 1 && (
            <p className="text-center text-xs tracking-[0.2em] text-white/45 uppercase">
              {round.roundNo === 1 ? "Buste" : `Spareggio · da ${round.minAmount}`}
            </p>
          )}
          <ul className="space-y-0.5">
            {[...round.bids]
              .sort((a, b) => b.amount - a.amount)
              .map((bid) => (
                <li
                  key={bid.memberId}
                  className={cn(
                    "flex items-baseline gap-2 text-sm",
                    bid.withdrawnAt !== null && "text-white/45 line-through",
                    bid.memberId === reveal.winnerMemberId &&
                      round.roundNo === reveal.rounds.length &&
                      "font-semibold text-emerald-300",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {memberLabel(memberById(snapshot, bid.memberId))}
                  </span>
                  <span className="shrink-0 tabular-nums">{bid.amount}</span>
                </li>
              ))}
          </ul>
        </div>
      ))}

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
