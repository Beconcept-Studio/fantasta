"use client";

import { Countdown } from "@/components/auction/countdown";
import { RevealBids } from "@/components/auction/reveal-panel";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS } from "@/lib/domain";
import { memberById, memberLabel } from "@/lib/realtime/portal";
import type { Snapshot } from "@/lib/realtime/types";
import { cn } from "@/lib/utils";

/**
 * Il lotto chiuso (M1): la schermata di `LOT_REVEAL`, e **niente altro**.
 *
 * Esiste come componente separato da `LotCard` per una ragione che non è di
 * organizzazione del codice ma di uso reale. Finché il reveal viveva dentro la
 * card viva, chi guardava il telefono per tre secondi vedeva la stessa cornice,
 * la stessa barra che scorre e lo stesso countdown grande che un attimo prima
 * chiedevano di offrire: l'unico modo di capire che il lotto era finito era
 * leggere. Qui il registro visivo cambia tutto insieme — superficie spenta,
 * nessuna barra di avanzamento, nessun pulsante, e il numero grande in alto che
 * non è più il tempo che scappa ma il **prezzo** già pagato.
 *
 * Che sia un componente diverso non tocca §8bis: quella chiede che l'area del
 * lotto sia sempre presente e sia funzione pura dello snapshot, non che sia
 * sempre lo stesso nodo React. `portalScreen` continua a restituire `LOT` per
 * tutte e tre le fasi, e chi rientra a metà reveal trova questa card con il suo
 * countdown giusto, esattamente come chi non si è mai disconnesso (I10).
 *
 * Il piè di pagina dice **quando** si riparte e non **a chi** tocca: il turno
 * successivo lo decide il motore quando il reveal scade, e anticiparlo qui
 * sarebbe una seconda copia della rotazione da tenere allineata a mano. Chi
 * chiama si scopre quando il lotto nuovo si apre (decisione dell'owner,
 * DECISIONS 2026-08-09).
 */
export function LotClosedCard({
  snapshot,
  myMemberId,
  offset,
}: {
  snapshot: Snapshot;
  myMemberId: string | null;
  offset: number;
}) {
  const lot = snapshot.currentLot;
  if (lot === null || lot.reveal === null) return null;

  const reveal = lot.reveal;
  const { pausedAt, status } = snapshot.auction;
  const pausedFor = status === "PAUSED" ? pausedAt : null;
  const winner = memberById(snapshot, reveal.winnerMemberId);
  const iWon = reveal.winnerMemberId === myMemberId;

  return (
    <section className="bg-muted/40 overflow-hidden rounded-xl border">
      {/* ── Il lotto è finito, e si vede prima di leggere ── */}
      <header
        className={cn(
          "space-y-1 px-4 py-3 text-center",
          iWon ? "bg-emerald-600/10" : "bg-background/60",
        )}
      >
        <Badge variant={iWon ? "default" : "secondary"}>Lotto assegnato</Badge>
        <h2 className="truncate text-xl leading-tight font-semibold">
          {lot.player.name}
        </h2>
        <p className="text-muted-foreground truncate text-sm">
          {ROLE_LABELS[lot.player.role]} · {lot.player.team}
        </p>
      </header>

      {/* ── Chi se l'è preso, e a quanto ── */}
      <div className="flex items-center justify-between gap-3 border-y px-4 py-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs tracking-wide uppercase">
            {iWon ? "L'hai preso tu" : "Va a"}
          </p>
          <p className="truncate text-lg font-semibold">
            {memberLabel(winner)}
          </p>
        </div>
        <p
          className={cn(
            "text-4xl leading-none font-semibold tabular-nums",
            iWon && "text-emerald-700 dark:text-emerald-400",
          )}
        >
          {reveal.price}
        </p>
      </div>

      {/* ── Tutte le buste, di tutti i round ── */}
      <div className="px-4 py-3">
        <RevealBids
          reveal={reveal}
          snapshot={snapshot}
          myMemberId={myMemberId}
        />
      </div>

      {/* ── Quanto manca alla ripresa: un numero che scorre, non una barra ── */}
      <footer className="flex items-center justify-between gap-3 border-t px-4 py-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs tracking-wide uppercase">
            Prossimo turno
          </p>
          <p className="text-muted-foreground text-sm">
            Non devi fare niente: riparte da solo.
          </p>
        </div>
        <Countdown
          deadline={snapshot.auction.phaseDeadline}
          offset={offset}
          pausedAt={pausedFor}
          className="shrink-0 text-2xl font-semibold"
        />
      </footer>
    </section>
  );
}
