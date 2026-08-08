"use client";

import Link from "next/link";

import { Countdown } from "@/components/auction/countdown";
import { PresenceDot, PRESENCE_LABELS } from "@/components/auction/presence-dot";
import { RosterGrid } from "@/components/auction/roster-grid";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS } from "@/lib/domain";
import { presenceAlert, spentCredits } from "@/lib/realtime/manage";
import { memberById, memberLabel, phaseLabel } from "@/lib/realtime/portal";
import type { PoolPlayer, Snapshot, SnapshotMember } from "@/lib/realtime/types";
import { useAuctionStream, useHeartbeat } from "@/lib/realtime/use-auction-stream";
import { cn } from "@/lib/utils";

import { ControlPanel } from "./controls";
import { OverridePanel } from "./overrides";

/**
 * La regia dell'asta (F6-01…F6-04).
 *
 * Una pagina sola, alimentata dallo stesso `useAuctionStream` del portale del
 * partecipante e dello stesso snapshot sanificato: il manager che non gioca non
 * ha un `viewerMemberId`, quindi durante `LOT_OPEN` **non vede nessun importo**,
 * nemmeno da qui (I8). Vede chi ha consegnato la busta, che è ciò che serve per
 * condurre.
 *
 * Desktop-only per scelta: la griglia mostra dodici rose insieme, e quello è il
 * senso del recap — capire in un colpo d'occhio chi ha ancora crediti e chi ha
 * la rosa quasi piena. Su un telefono sarebbe una colonna di dodici schede da
 * scorrere, cioè un altro strumento.
 */
export function ManageConsole({
  auctionId,
  publicToken,
  ownerIsMember,
  seatsTaken,
  pool,
}: {
  auctionId: string;
  /** Il token della vista TV: da qui esce l'unico link che la apre. */
  publicToken: string;
  /** Se l'owner gioca, questa pagina deve battere il suo heartbeat. */
  ownerIsMember: boolean;
  seatsTaken: number;
  /** Il listone dell'asta, per il pannello delle correzioni (F7-05). */
  pool: PoolPlayer[];
}) {
  const { snapshot, connected, offset } = useAuctionStream(auctionId);
  // ⚠ Se l'owner è anche un membro (⚠ P11 — di solito lo è) e conduce da qui,
  // senza questo la sua presence sarebbe OFFLINE e il cancello d'avvio
  // rifiuterebbe l'asta per colpa di chi la sta avviando.
  useHeartbeat(auctionId, ownerIsMember);

  if (snapshot === null) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-muted-foreground text-sm">
          {connected ? "Carico l'asta…" : "Mi collego all'asta…"}
        </p>
      </main>
    );
  }

  const { auction } = snapshot;
  const turnOf = memberById(snapshot, auction.currentMemberId);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {auction.name}
          </h1>
          <Badge
            variant={auction.status === "PAUSED" ? "destructive" : "secondary"}
          >
            {phaseLabel(snapshot)}
          </Badge>
          {!connected && (
            <Badge variant="outline" className="border-amber-500/50">
              riconnessione…
            </Badge>
          )}
        </div>

        <nav className="text-muted-foreground flex flex-wrap gap-4 text-sm">
          <Link href="/dashboard" className="hover:text-foreground">
            ← Le tue aste
          </Link>
          <Link
            href={`/auctions/${auctionId}/setup`}
            className="hover:text-foreground"
          >
            Configurazione
          </Link>
          <Link
            href={`/auctions/${auctionId}/lobby`}
            className="hover:text-foreground"
          >
            Lobby
          </Link>
          <a
            href={`/tv/${publicToken}`}
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground"
          >
            Vista TV ↗
          </a>
          {/* Un link, non un pulsante: è una GET che scarica un file, e il
              browser sa già farlo (F7-06). */}
          <a
            href={`/api/auctions/${auctionId}/export`}
            className="hover:text-foreground"
          >
            Scarica le rose (.xlsx) ↓
          </a>
        </nav>
      </header>

      <PresenceBanner snapshot={snapshot} />

      <ControlPanel auctionId={auctionId} snapshot={snapshot} />

      <LiveStrip snapshot={snapshot} offset={offset} turnOf={turnOf} />

      <OverridePanel auctionId={auctionId} snapshot={snapshot} pool={pool} />

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold">Rose e budget</h2>
          <p className="text-muted-foreground text-sm">
            crediti · speso · offerta massima
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {snapshot.members.map((member) => (
            <MemberCard
              key={member.id}
              member={member}
              slots={auction.slots}
              isTurn={member.id === auction.currentMemberId}
            />
          ))}
        </div>
      </section>
    </main>
  );
}

/**
 * L'alert di chi non c'è più (F6-04, PLAN §7).
 *
 * **Nessuna pausa automatica.** Se un telefono va in standby a metà lotto, i
 * timer fanno il loro mestiere — auto-pick del miglior `fvm`, auto-bid a 1 — e
 * la decisione se fermare tutto resta a chi conduce, che è l'unico a sapere se
 * quella persona è uscita dalla stanza o è andata a prendere da bere. Un'asta
 * che si sospende da sola si bloccherebbe ogni due minuti.
 *
 * Prima dell'avvio non compare: lì gli stessi pallini sono il cancello, non un
 * guasto, e li si guarda già in lobby e nel pannello dei comandi.
 */
function PresenceBanner({ snapshot }: { snapshot: Snapshot }) {
  const alert = presenceAlert(snapshot);
  if (alert === null) return null;

  const names = (members: SnapshotMember[]) =>
    members.map((m) => m.teamName).join(", ");

  return (
    <section
      role="status"
      className={cn(
        "space-y-1 rounded-xl border p-4",
        alert.offline.length > 0
          ? "border-destructive/50 bg-destructive/10"
          : "border-amber-500/50 bg-amber-500/10",
      )}
    >
      <h2 className="font-semibold">
        {alert.offline.length > 0
          ? "Qualcuno non è più collegato"
          : "Qualcuno ha la pagina in secondo piano"}
      </h2>
      {alert.offline.length > 0 && (
        <p className="text-sm">
          <strong>{names(alert.offline)}</strong> — se resta così, al suo turno
          scatta la chiamata automatica e le sue offerte si fermano a 1.
        </p>
      )}
      {alert.idle.length > 0 && (
        <p className="text-sm">
          <strong>{names(alert.idle)}</strong> — la pagina è aperta ma non in
          primo piano: con trenta secondi di countdown è come non esserci.
        </p>
      )}
      <p className="text-muted-foreground text-sm">
        L&apos;asta <strong>non</strong> si mette in pausa da sola: se serve
        aspettare, il pulsante è qui sotto.
      </p>
    </section>
  );
}

/**
 * Dove siamo adesso, in una striscia sola: fase, countdown, e — se c'è un lotto
 * aperto — chi ha chiamato chi e quante buste sono arrivate.
 *
 * Non è un secondo pannello di reveal: quello è della TV. Qui serve a decidere
 * se è il momento di premere pausa, che è una domanda a cui «siamo a metà di un
 * round con tre buste consegnate» risponde e «l'asta è LIVE» no.
 */
function LiveStrip({
  snapshot,
  offset,
  turnOf,
}: {
  snapshot: Snapshot;
  offset: number;
  turnOf: SnapshotMember | null;
}) {
  const { auction } = snapshot;
  const lot = snapshot.currentLot;

  if (auction.status === "DRAFT" || auction.status === "READY") {
    return null;
  }
  if (auction.status === "COMPLETED") {
    return (
      <section className="bg-card rounded-xl border p-4">
        <p className="font-medium">
          Asta conclusa: le rose qui sotto sono definitive.
        </p>
      </section>
    );
  }

  const buste = lot?.bidStatus.filter((b) => b.hasBid).length ?? 0;
  const idonei = lot?.eligibleMemberIds.length ?? 0;

  return (
    <section className="bg-card flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border p-4">
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs tracking-wide uppercase">
          {lot === null ? "In attesa della chiamata" : "Lotto in corso"}
        </p>
        <p className="truncate text-lg font-semibold">
          {lot === null
            ? `${memberLabel(turnOf)} deve chiamare`
            : `${lot.player.name} · ${lot.player.team}`}
        </p>
        {lot !== null && (
          <p className="text-muted-foreground text-sm">
            chiamato da {memberLabel(memberById(snapshot, lot.calledByMemberId))}
            {lot.autoCalled && " (scelta automatica)"}
            {lot.roundNo === 2 && " · spareggio"}
          </p>
        )}
      </div>

      {lot !== null && auction.phase === "LOT_OPEN" && (
        <div>
          <p className="text-muted-foreground text-xs tracking-wide uppercase">
            Buste consegnate
          </p>
          {/* Solo il conteggio: gli importi non li ha nemmeno il manager (I8). */}
          <p className="text-lg font-semibold tabular-nums">
            {buste}/{idonei}
          </p>
        </div>
      )}

      <div className="ml-auto text-right">
        <p className="text-muted-foreground text-xs tracking-wide uppercase">
          {auction.status === "PAUSED" ? "Congelato a" : "Tempo"}
        </p>
        <Countdown
          deadline={auction.phaseDeadline}
          offset={offset}
          pausedAt={auction.pausedAt}
          className="text-2xl font-semibold"
        />
      </div>
    </section>
  );
}

/** Una rosa, con i tre numeri che decidono tutto il resto. */
function MemberCard({
  member,
  slots,
  isTurn,
}: {
  member: SnapshotMember;
  slots: Snapshot["auction"]["slots"];
  isTurn: boolean;
}) {
  return (
    <article
      className={cn(
        "bg-card space-y-3 rounded-xl border p-4",
        isTurn && "border-amber-500/60",
      )}
    >
      <div className="flex items-start gap-2">
        <PresenceDot presence={member.presence} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold">{member.teamName}</h3>
          <p className="text-muted-foreground truncate text-xs">
            posto {member.seatIndex + 1} · {member.displayName ?? "—"} ·{" "}
            {PRESENCE_LABELS[member.presence]}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Figure label="crediti" value={member.credits} strong />
        <Figure label="speso" value={spentCredits(member)} />
        <Figure label="max" value={member.maxBid} />
      </div>

      <RosterGrid member={member} slots={slots} />
    </article>
  );
}

function Figure({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div className="bg-muted/40 rounded-lg px-2 py-1.5">
      <p className="text-muted-foreground text-[0.65rem] tracking-wide uppercase">
        {label}
      </p>
      <p
        className={cn(
          "leading-tight tabular-nums",
          strong ? "text-xl font-semibold" : "text-lg font-medium",
        )}
      >
        {value}
      </p>
    </div>
  );
}
