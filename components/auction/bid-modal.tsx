"use client";

import { Dialog } from "radix-ui";
import { useEffect, useRef, useState } from "react";

import { Campioncino } from "@/components/auction/campioncino";
import { Countdown, CountdownBar } from "@/components/auction/countdown";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/domain";
import type { ActionResult } from "@/lib/realtime/action";
import {
  bidBounds,
  canWithdraw,
  checkAmount,
  haveWithdrawn,
  parseAmount,
} from "@/lib/realtime/portal";
import type { Snapshot } from "@/lib/realtime/types";
import { cn } from "@/lib/utils";

/**
 * Il modale d'offerta (F5-05/06/07) — il pezzo di app che si usa in piedi, con
 * una mano, mentre qualcuno in TV legge il nome del giocatore ad alta voce.
 *
 * Non è una notifica (§8bis): è una **vista sullo stato corrente**. Si apre da
 * sé quando c'è un round aperto e sono idoneo, si chiude senza perdere niente
 * (l'offerta è a database, non nello state del componente) e si riapre dalla
 * card. Chi rientra a metà round lo ritrova aperto con la propria cifra
 * dentro, perché quella cifra arriva dallo snapshot.
 *
 * Tre scelte di forma, tutte dal vincolo mobile-first di PLAN §15:
 *
 * - **Sheet dal basso, non modale centrato.** Il pollice sta in basso, e con la
 *   tastiera aperta la metà alta dello schermo non esiste.
 * - **Countdown e `max_bid` nell'intestazione dello sheet**, quindi a due
 *   centimetri sopra il campo: restano visibili anche quando la tastiera
 *   copre due terzi dello schermo. È il requisito esplicito del piano.
 * - **`inputMode="numeric"` su un `type="text"`**: niente spinner (inusabili
 *   col pollice), tastierino nativo, `text-2xl` perché sotto i 16px iOS zooma
 *   da solo e la pagina resta zoomata.
 *
 * Da M7 il campo **riceve il focus all'apertura**, e la figurina del giocatore
 * sta a sinistra dell'intestazione: il perché di entrambe è scritto dove
 * succedono, perché in entrambi i casi è il perché a non essere ovvio.
 *
 * Il pulsante di conferma non si fida di niente (regola 6): disabilita e
 * spiega, ma il rifiuto vero arriva dal server con il suo codice.
 */

type Feedback =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; amount: number }
  | { kind: "unchanged"; amount: number }
  | { kind: "withdrawn" }
  | { kind: "error"; message: string };

export function BidModal({
  open,
  onOpenChange,
  snapshot,
  myMemberId,
  offset,
  onBid,
  onWithdraw,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: Snapshot;
  myMemberId: string | null;
  offset: number;
  onBid: (amount: number) => Promise<ActionResult>;
  onWithdraw: () => Promise<ActionResult>;
}) {
  const lot = snapshot.currentLot;
  const bounds = bidBounds(snapshot, myMemberId);
  const myBid = snapshot.myBid;
  const withdrawable = canWithdraw(snapshot, myMemberId);
  const withdrawn = haveWithdrawn(snapshot);
  const closing = snapshot.auction.phase !== "LOT_OPEN";
  const frozen = snapshot.auction.status === "PAUSED";

  const [raw, setRaw] = useState("");
  const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" });
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ogni lotto ricomincia da zero, e il campo parte dalla propria offerta già
  // salvata: chi rientra a metà round trova la sua cifra, non un campo vuoto.
  const lotId = lot?.id ?? null;
  const savedAmount = myBid?.amount ?? null;
  useEffect(() => {
    setRaw(savedAmount === null ? "" : String(savedAmount));
    setFeedback({ kind: "idle" });
    setConfirmWithdraw(false);
    // `savedAmount` intenzionalmente fuori dalle dipendenze: il campo si
    // riallinea al cambio di lotto (o di round), non a ogni snapshot — altrimenti
    // riscriverebbe sotto le dita quello che l'utente sta digitando.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotId, lot?.roundNo]);

  if (lot === null || bounds === null) return null;

  const amount = parseAmount(raw);
  const problem = checkAmount(amount, bounds);
  const alreadyAt = amount !== null && savedAmount === amount;
  const canSubmit =
    !closing && !frozen && !withdrawn && problem === null && feedback.kind !== "saving";

  // Da campo vuoto "+5" scrive 5 e "−1" scrive il minimo: sotto pressione i
  // tasti rapidi devono valere quello che c'è scritto sopra, non "minimo più 5".
  const bump = (delta: number) => {
    const base = amount ?? savedAmount ?? 0;
    const next = Math.min(bounds.max, Math.max(bounds.min, base + delta));
    setRaw(String(next));
    setFeedback({ kind: "idle" });
  };

  const submit = async () => {
    if (amount === null || !canSubmit) return;
    setFeedback({ kind: "saving" });
    const result = await onBid(amount);
    if (result.ok) {
      // ⚠ P3 — confermare la stessa cifra è un no-op lato server: il timestamp
      // resta quello del primo submit, e nello spareggio è la posizione in coda
      // che conta. Va detto, non lasciato credere a un salvataggio nuovo.
      setFeedback(
        alreadyAt ? { kind: "unchanged", amount } : { kind: "saved", amount },
      );
    } else {
      setFeedback({ kind: "error", message: result.message });
    }
  };

  const withdraw = async () => {
    setFeedback({ kind: "saving" });
    const result = await onWithdraw();
    setFeedback(
      result.ok ? { kind: "withdrawn" } : { kind: "error", message: result.message },
    );
    setConfirmWithdraw(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content
          // ⚠ **Il focus va sul campo all'apertura, ed è un cambio di idea
          // esplicito** (M7, su richiesta dell'owner dopo averlo usato). Fino a
          // v1.7.0 il focus veniva tolto di proposito: il modale si apre **da
          // sé** quando il round comincia, e far salire la tastiera senza che
          // nessuno l'abbia chiesta copre due terzi dello schermo — card e
          // countdown compresi — nel momento peggiore.
          //
          // La ragione del cambio è che quel timore descriveva l'apertura, non
          // l'uso: si apre il modale per scrivere un numero, e trenta secondi di
          // countdown non lasciano spazio a un tocco in più. Countdown e
          // `max_bid` stanno nell'intestazione dello sheet **apposta** per
          // restare visibili sopra la tastiera, quindi il costo che la scelta
          // precedente temeva è già pagato dal layout.
          //
          // `preventDefault` resta: senza, Radix darebbe il focus al primo
          // elemento focusabile, che è il pulsante «−1». Il `select()` fa sì che
          // chi rientra con una cifra già dentro possa sovrascriverla digitando,
          // invece di dover cancellare prima.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const field = inputRef.current;
            if (field === null) return;
            field.focus();
            field.select();
          }}
          className="bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom fixed inset-x-0 bottom-0 z-50 flex max-h-dvh flex-col gap-3 rounded-t-2xl border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl outline-none sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-96 sm:rounded-2xl sm:border"
        >
          {/* ── Intestazione: sempre visibile, anche con la tastiera aperta ── */}
          <div className="flex items-start gap-3">
            {/*
              La figurina sta **a sinistra dell'intero blocco** — nome, countdown,
              `max_bid` e barra — non sopra il nome: questo foglio arriva dal
              basso e con la tastiera aperta l'altezza è la risorsa scarsa, mentre
              la larghezza a sinistra del testo è spazio che c'era già. Di fianco
              non costa nessuna riga, sopra ne costava centoquaranta pixel.

              Stessa misura della card dietro (68×100): è lo stesso giocatore
              nello stesso momento, e vederlo cambiare taglia aprendo il modale
              sarebbe un movimento senza significato.
            */}
            <Campioncino
              extId={lot.player.extId}
              className="h-25 w-17 shrink-0 rounded-md"
            />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Dialog.Title className="truncate text-lg leading-tight font-semibold">
                    {lot.player.name}
                  </Dialog.Title>
                  <Dialog.Description className="text-muted-foreground truncate text-xs">
                    {ROLE_LABELS[lot.player.role]} · {lot.player.team} · fvm{" "}
                    {lot.player.fvm}
                    {lot.roundNo === 2 ? " · spareggio" : ""}
                  </Dialog.Description>
                </div>
                <div className="text-right">
                  <p
                    className={cn(
                      "text-2xl leading-none font-semibold",
                      closing && "text-muted-foreground",
                    )}
                  >
                    <Countdown
                      deadline={lot.endsAt}
                      offset={offset}
                      pausedAt={frozen ? snapshot.auction.pausedAt : null}
                    />
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs whitespace-nowrap">
                    max <span className="tabular-nums">{bounds.max}</span>
                  </p>
                </div>
              </div>
              <CountdownBar
                deadline={lot.endsAt}
                offset={offset}
                totalSeconds={snapshot.auction.timers.bidSeconds}
                pausedAt={frozen ? snapshot.auction.pausedAt : null}
              />
            </div>
          </div>

          {/* ── Il campo e i suoi appigli ── */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="size-12 shrink-0 text-lg"
              aria-label="Un credito in meno"
              disabled={closing || frozen || withdrawn}
              onClick={() => bump(-1)}
            >
              −1
            </Button>
            <input
              ref={inputRef}
              value={raw}
              onChange={(event) => {
                setRaw(event.target.value.replace(/[^\d]/g, ""));
                setFeedback({ kind: "idle" });
              }}
              inputMode="numeric"
              // `type="text"`, non `number`: gli spinner sono inusabili col
              // pollice e il piano li vieta esplicitamente.
              type="text"
              pattern="[0-9]*"
              autoComplete="off"
              enterKeyHint="send"
              disabled={closing || frozen || withdrawn}
              aria-label="La tua offerta in crediti"
              aria-invalid={problem !== null && raw !== ""}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
              className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-14 min-w-0 flex-1 rounded-lg border bg-transparent text-center text-2xl font-semibold tabular-nums outline-none focus-visible:ring-3 disabled:opacity-50 aria-invalid:border-destructive"
            />
            <Button
              type="button"
              variant="outline"
              className="size-12 shrink-0 text-lg"
              aria-label="Un credito in più"
              disabled={closing || frozen || withdrawn}
              onClick={() => bump(1)}
            >
              +1
            </Button>
          </div>

          <div className="flex gap-2">
            {[5, 10, 25].map((step) => (
              <Button
                key={step}
                type="button"
                variant="secondary"
                className="h-11 flex-1"
                disabled={closing || frozen || withdrawn}
                onClick={() => bump(step)}
              >
                +{step}
              </Button>
            ))}
            <Button
              type="button"
              variant="secondary"
              className="h-11 flex-1"
              disabled={closing || frozen || withdrawn}
              onClick={() => {
                setRaw(String(bounds.max));
                setFeedback({ kind: "idle" });
              }}
            >
              max
            </Button>
          </div>

          {/* ── Il verdetto, sempre nello stesso posto ── */}
          <FeedbackLine
            feedback={feedback}
            problem={raw === "" ? null : problem}
            savedAmount={savedAmount}
            withdrawn={withdrawn}
            closing={closing}
            frozen={frozen}
          />

          {/* ── La conferma, nella metà bassa, 56px di altezza ── */}
          <Button
            type="button"
            className="h-14 w-full text-base"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {withdrawn
              ? "Ritirato"
              : feedback.kind === "saving"
                ? "Invio…"
                : savedAmount === null
                  ? "Offri"
                  : alreadyAt
                    ? `Conferma ${savedAmount}`
                    : `Rilancia a ${amount ?? "…"}`}
          </Button>

          <div className="flex items-center gap-2">
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" className="h-11 flex-1">
                Chiudi
              </Button>
            </Dialog.Close>
            {withdrawable &&
              (confirmWithdraw ? (
                <Button
                  type="button"
                  variant="destructive"
                  className="h-11 flex-1"
                  onClick={() => void withdraw()}
                >
                  Ritiro definitivo?
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 flex-1"
                  onClick={() => setConfirmWithdraw(true)}
                >
                  Ritira
                </Button>
              ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Il feedback di salvataggio, e il motivo per cui ha una riga fissa tutta sua:
 * «l'ansia da *è passata?* a cinque secondi dalla scadenza è il vero problema
 * di UX di questa app» (PLAN §15). Un messaggio che compare e sposta il
 * pulsante di conferma è peggio di nessun messaggio.
 */
function FeedbackLine({
  feedback,
  problem,
  savedAmount,
  withdrawn,
  closing,
  frozen,
}: {
  feedback: Feedback;
  problem: string | null;
  savedAmount: number | null;
  withdrawn: boolean;
  closing: boolean;
  frozen: boolean;
}) {
  const base =
    "flex min-h-11 items-center rounded-md border px-3 py-2 text-sm";

  if (frozen) {
    return (
      <p role="status" className={cn(base, "bg-muted/50 border-transparent")}>
        Asta in pausa: le offerte sono sospese.
      </p>
    );
  }
  if (withdrawn) {
    return (
      <p role="status" className={cn(base, "bg-muted/50 border-transparent")}>
        Ti sei ritirato da questo lotto. Il ritiro è definitivo.
      </p>
    );
  }
  if (feedback.kind === "error") {
    return (
      <p
        role="alert"
        className={cn(base, "border-destructive/40 bg-destructive/5 text-destructive")}
      >
        {feedback.message}
      </p>
    );
  }
  if (feedback.kind === "saved") {
    return (
      <p
        role="status"
        className={cn(
          base,
          "border-emerald-600/40 bg-emerald-600/10 font-medium text-emerald-700 dark:text-emerald-400",
        )}
      >
        ✓ Offerta salvata: {feedback.amount}
      </p>
    );
  }
  if (feedback.kind === "unchanged") {
    return (
      <p role="status" className={cn(base, "bg-muted/50 border-transparent")}>
        Sei già a {feedback.amount}: nulla è cambiato.
      </p>
    );
  }
  if (feedback.kind === "withdrawn") {
    return (
      <p role="status" className={cn(base, "bg-muted/50 border-transparent")}>
        Ritiro registrato.
      </p>
    );
  }
  if (feedback.kind === "saving") {
    return (
      <p role="status" className={cn(base, "bg-muted/50 border-transparent")}>
        Invio in corso…
      </p>
    );
  }
  if (problem !== null) {
    return (
      <p role="status" className={cn(base, "border-amber-500/40 bg-amber-500/10")}>
        {problem}
      </p>
    );
  }
  if (closing) {
    return (
      <p role="status" className={cn(base, "bg-muted/50 border-transparent")}>
        Round chiuso: si aprono le buste.
      </p>
    );
  }
  return (
    <p role="status" className={cn(base, "text-muted-foreground border-transparent")}>
      {savedAmount === null
        ? "Non hai ancora offerto su questo lotto."
        : `La tua offerta salvata è ${savedAmount}.`}
    </p>
  );
}
