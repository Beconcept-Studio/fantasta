"use client";

import { Countdown, CountdownBar } from "@/components/auction/countdown";
import { RevealPanel, TiePanel } from "@/components/auction/reveal-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/domain";
import {
  amEligible,
  amInTie,
  envelopes,
  haveWithdrawn,
  memberById,
  memberLabel,
} from "@/lib/realtime/portal";
import type { Snapshot } from "@/lib/realtime/types";
import { cn } from "@/lib/utils";

/**
 * La card del lotto (F5-04): **elemento permanente** del portale finché
 * `currentLot != null`.
 *
 * È la risposta di §8bis al problema che l'anno scorso rendeva l'app
 * inutilizzabile: se l'unica interfaccia per offrire è un modale, chi lo chiude
 * per sbaglio — o chi ha il telefono che va in standby — non ha più modo di
 * rientrare nel lotto. La card non sparisce mai: mostra a che punto siamo,
 * quanto ho offerto io, chi ha consegnato la busta, e ha il pulsante che
 * riapre il modale.
 *
 * Attraversa tutte e tre le fasi di un lotto senza cambiare identità:
 * `LOT_OPEN` (offerte), `LOT_TIE_PREP` (annuncio dello spareggio, F5-08),
 * `LOT_REVEAL` (buste aperte, F5-09). Chi rientra a metà trova la fase giusta
 * perché la fase è nello snapshot, non nella memoria del browser.
 */
export function LotCard({
  snapshot,
  myMemberId,
  offset,
  onOpenBid,
}: {
  snapshot: Snapshot;
  myMemberId: string | null;
  offset: number;
  onOpenBid: () => void;
}) {
  const lot = snapshot.currentLot;
  if (lot === null) return null;

  const { phase, status, pausedAt, timers } = snapshot.auction;
  const frozen = status === "PAUSED";
  const pausedFor = frozen ? pausedAt : null;
  const open = phase === "LOT_OPEN";
  const eligible = amEligible(lot, myMemberId);
  const caller = memberById(snapshot, lot.calledByMemberId);
  const iCalled = lot.calledByMemberId === myMemberId;
  const withdrawn = haveWithdrawn(snapshot);
  const rows = envelopes(snapshot, myMemberId);

  return (
    <section className="bg-card overflow-hidden rounded-xl border shadow-sm">
      {/* ── Il giocatore, e quanto tempo resta ── */}
      <header className="space-y-2 p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{ROLE_LABELS[lot.player.role]}</Badge>
              {lot.roundNo === 2 && <Badge>Spareggio</Badge>}
              {lot.autoCalled && (
                <Badge variant="outline" title="Nessuno ha chiamato in tempo">
                  auto
                </Badge>
              )}
            </div>
            <h2 className="mt-1.5 truncate text-2xl leading-tight font-semibold">
              {lot.player.name}
            </h2>
            <p className="text-muted-foreground truncate text-sm">
              {lot.player.team} · fvm {lot.player.fvm} · chiamato da{" "}
              {iCalled ? "te" : memberLabel(caller)}
            </p>
          </div>
          <p className="text-right text-3xl leading-none font-semibold">
            <Countdown
              deadline={open ? lot.endsAt : snapshot.auction.phaseDeadline}
              offset={offset}
              pausedAt={pausedFor}
            />
          </p>
        </div>
        <CountdownBar
          deadline={open ? lot.endsAt : snapshot.auction.phaseDeadline}
          offset={offset}
          totalSeconds={
            open
              ? timers.bidSeconds
              : phase === "LOT_TIE_PREP"
                ? timers.tiePrepSeconds
                : timers.revealSeconds
          }
          pausedAt={pausedFor}
        />
      </header>

      {/* ── Il cuore, che cambia con la fase ── */}
      <div className="space-y-3 px-4 pb-4">
        {phase === "LOT_REVEAL" && lot.reveal !== null && (
          <RevealPanel
            reveal={lot.reveal}
            snapshot={snapshot}
            myMemberId={myMemberId}
          />
        )}

        {phase === "LOT_TIE_PREP" && lot.tie !== null && (
          <TiePanel
            amount={lot.tie.amount}
            amInTie={amInTie(snapshot, myMemberId)}
          />
        )}

        {open && (
          <>
            <MyBidRow
              snapshot={snapshot}
              eligible={eligible}
              iCalled={iCalled}
              withdrawn={withdrawn}
            />
            {eligible && !withdrawn && (
              <Button
                type="button"
                className="h-12 w-full text-base"
                onClick={onOpenBid}
                disabled={frozen}
              >
                {snapshot.myBid === null ? "Apri offerta" : "Modifica offerta"}
              </Button>
            )}
          </>
        )}

        {/* ── Le buste degli altri: solo un booleano (I8) ── */}
        {rows.length > 0 && phase !== "LOT_REVEAL" && (
          <div className="space-y-1.5">
            <h3 className="text-muted-foreground text-xs tracking-wide uppercase">
              Buste consegnate
            </h3>
            <ul className="flex flex-wrap gap-1.5">
              {rows.map((row) => (
                <li
                  key={row.member.id}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                    row.withdrawn && "text-muted-foreground line-through",
                    !row.withdrawn &&
                      row.hasBid &&
                      "border-emerald-600/40 bg-emerald-600/10",
                    row.isMe && "font-medium",
                  )}
                  title={
                    row.withdrawn
                      ? "Si è ritirato"
                      : row.hasBid
                        ? "Ha consegnato la busta"
                        : "Non ha ancora offerto"
                  }
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      row.hasBid && !row.withdrawn
                        ? "bg-emerald-600"
                        : "bg-muted-foreground/40",
                    )}
                  />
                  {row.isMe ? "tu" : row.member.teamName}
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground text-xs">
              Gli importi si vedono solo all&apos;apertura delle buste.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * La propria offerta, che è l'unica cifra che si può mostrare durante
 * `LOT_OPEN` (I8) — e che va mostrata, perché è la domanda a cui il
 * partecipante vuole rispondere ogni tre secondi: «quanto ho messo?».
 */
function MyBidRow({
  snapshot,
  eligible,
  iCalled,
  withdrawn,
}: {
  snapshot: Snapshot;
  eligible: boolean;
  iCalled: boolean;
  withdrawn: boolean;
}) {
  if (!eligible) {
    return (
      <p className="bg-muted/50 rounded-md px-3 py-2 text-sm">
        Non sei fra gli idonei di questo lotto: hai il ruolo pieno, o i crediti
        non bastano.
      </p>
    );
  }
  if (withdrawn) {
    return (
      <p className="bg-muted/50 rounded-md px-3 py-2 text-sm">
        Ti sei ritirato da questo lotto: il ritiro è definitivo.
      </p>
    );
  }
  return (
    <div className="space-y-1 rounded-lg border px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-sm">La tua offerta</span>
        <span className="text-xl font-semibold tabular-nums">
          {snapshot.myBid === null ? "—" : snapshot.myBid.amount}
        </span>
      </div>
      {iCalled && (
        <p className="text-muted-foreground text-xs">
          L&apos;hai chiamato tu: l&apos;apertura a 1 è già registrata e non
          puoi ritirarti, solo rilanciare.
        </p>
      )}
    </div>
  );
}
