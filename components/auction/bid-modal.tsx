"use client";

import { Dialog } from "radix-ui";
import { useEffect, useRef, useState } from "react";

import { Campioncino } from "@/components/auction/campioncino";
import { InsightsMacro } from "@/components/auction/insights";
import { PrezzoConsigliato } from "@/components/auction/prezzo-consigliato";
import { RigaStatsPlus } from "@/components/auction/stats-plus";
import { Countdown, CountdownBar } from "@/components/auction/countdown";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/domain";
import type { ActionResult } from "@/lib/realtime/action";
import { bidBounds, checkAmount, parseAmount } from "@/lib/realtime/portal";
import {
  alternative,
  lottiInformativi,
  scatto,
  temperatura,
} from "@/lib/stats-plus";
import type { PoolPlayer, Snapshot } from "@/lib/realtime/types";
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
 *
 * Da M16 il modale ha **una strada sola**: si scrive una cifra, con `−1` e `+1`
 * accanto al campo per l'aggiustamento dell'ultimo secondo, e quella cifra si
 * può rilanciare, mai togliere. Sono spariti i valori suggeriti (`+5`, `+10`,
 * `+25`, `max`), che trasformavano la scelta della cifra in un tocco su un
 * incremento tondo, e il ritiro, che trasformava la busta chiusa in una cosa
 * reversibile — quest'ultimo fino in fondo, motore compreso, perché una regola
 * del gioco che vive solo nel browser qui non esiste. ⚠ Resta invece `max NN`
 * nell'intestazione: non è un valore suggerito, è il tetto I5 che il server
 * applica, e con la tastiera aperta va letto prima di scrivere, non dopo il
 * rifiuto.
 */

type Feedback =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; amount: number }
  | { kind: "unchanged"; amount: number }
  | { kind: "error"; message: string };

export function BidModal({
  open,
  onOpenChange,
  snapshot,
  pool,
  budget,
  statsPlus,
  myMemberId,
  offset,
  onBid,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: Snapshot;
  /**
   * Il listone, per gli insight del giocatore a lotto (M8 §7).
   *
   * ⚠ **Arriva da qui e non dallo snapshot**, ed è la ragione per cui M8 non
   * aggiunge un solo campo a `serializeSnapshot`: lo snapshot è **uno**, mandato
   * in broadcast a tutti, quindi metterci gli insight vorrebbe dire mandarli
   * anche a chi non li può vedere. Il pool invece è caricato dalla pagina per
   * quel viewer, e chi non ha il permesso ha ricevuto un pool senza insight.
   */
  pool: PoolPlayer[];
  /** I crediti di partenza: il denominatore di ogni rapporto di Stats+ (M22 §7.1). */
  budget: number;
  /** Chi guarda vede Stats+ (M22 §6). */
  statsPlus: boolean;
  myMemberId: string | null;
  offset: number;
  onBid: (amount: number) => Promise<ActionResult>;
}) {
  const lot = snapshot.currentLot;
  const bounds = bidBounds(snapshot, myMemberId);
  const myBid = snapshot.myBid;
  const closing = snapshot.auction.phase !== "LOT_OPEN";
  const frozen = snapshot.auction.status === "PAUSED";
  // ⚠ `?.insights` è `undefined` in tre casi che non serve distinguere: chi non
  // ha il permesso, la tabella ancora vuota, e un giocatore che il pool non ha
  // (i fuori lista, se l'asta li esclude). In tutti e tre il blocco non si
  // renderizza da sé — nessun `if` da scrivere qui.
  // Da M10B si prende la riga intera e non solo `insights`: le due chiavi sono
  // indipendenti — un giocatore può avere il giudizio di Carmy e non la riga di
  // insight — e `undefined` su una delle due non deve nascondere l'altra.
  const poolRow = pool.find((p) => p.id === lot?.player.id);
  const insights = poolRow?.insights;
  const carmy = poolRow?.carmy;

  // ⚠ **Stats+ è funzione pura di snapshot e pool** (M22 §7.3, I10): non c'è
  // nessuno stato locale, nessun effetto, niente da ricordare fra uno snapshot e
  // l'altro. Chi ricarica a metà lotto vede gli stessi numeri di chi non si è
  // mosso.
  //
  // ⚠ **E non si memoizza**: `O(righe del pool)` per le alternative e
  // `O(assegnazioni)` per il termometro sono cinquecento e duecento in un
  // browser. Non si memoizza prima di aver misurato (regola 8) — e se un giorno
  // servisse, il candidato è l'indice `fascia → giocatori`, che è immutabile per
  // tutta l'asta.
  const ruoloInCorso = snapshot.auction.currentRole;
  const lottiRuolo =
    statsPlus && ruoloInCorso !== null
      ? lottiInformativi(snapshot, pool, budget, ruoloInCorso)
      : [];
  const temperaturaRuolo = statsPlus ? temperatura(lottiRuolo) : null;
  const scattoRuolo = statsPlus ? scatto(lottiRuolo) : null;
  const alternativeLotto =
    statsPlus && lot !== null
      ? alternative(snapshot, pool, budget, lot.player.id)
      : null;

  const [raw, setRaw] = useState("");
  const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  // Ogni lotto ricomincia da zero, e il campo parte dalla propria offerta già
  // salvata: chi rientra a metà round trova la sua cifra, non un campo vuoto.
  const lotId = lot?.id ?? null;
  const savedAmount = myBid?.amount ?? null;
  useEffect(() => {
    setRaw(savedAmount === null ? "" : String(savedAmount));
    setFeedback({ kind: "idle" });
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
    !closing && !frozen && problem === null && feedback.kind !== "saving";

  // Da campo vuoto "+1" scrive il minimo e "−1" pure: sotto pressione i tasti
  // rapidi devono valere quello che c'è scritto sopra, non "minimo più 1".
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

          {/*
            Le sole macro (M8 §7): quanto è titolare, e se batte i rigori o i
            piazzati. Non i minuti medi, non le presenze, non le fmv per contesto:
            qui non si confronta, si decide una cifra — e ogni riga in più ruba
            altezza al campo dell'offerta, che con la tastiera aperta è la risorsa
            scarsa. La lista di chiamata, dove invece si confronta, mostra di più.
          */}
          <InsightsMacro insights={insights} carmy={carmy} />

          {/* ── Il campo e i suoi appigli ── */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="size-12 shrink-0 text-lg"
              aria-label="Un credito in meno"
              disabled={closing || frozen}
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
              disabled={closing || frozen}
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
              disabled={closing || frozen}
              onClick={() => bump(1)}
            >
              +1
            </Button>
          </div>

          {/*
            ⚠ Il **secondo** punto d'innesto del prezzo consigliato, quello accanto
            al campo — il più utile e il più pericoloso, perché è un numero
            suggerito a due centimetri dal numero da scrivere. Quale dei due sia
            attivo lo decide `POSIZIONE_PREZZO`, in un posto solo: qui non c'è
            nessuna condizione da tenere allineata (M10B §6).
          */}
          <PrezzoConsigliato carmy={carmy} dove="campo" />

          {/*
            ⚠ **Stats+ sta SOTTO il campo, ed è la risposta all'obiezione del
            2026-08-12, non una scelta di layout** (M22 §5.3). Sopra il campo
            un'informazione arriva **prima** della decisione e la sostituisce;
            sotto, l'ordine di lettura si inverte — prima vedi la cifra che stai
            scrivendo, poi il contesto.

            ⚠ **E una riga sola.** Il commento qui sotto dice perché la riga dei
            valori suggeriti è stata tolta: quei ~44px sono altezza restituita al
            campo, e con la tastiera aperta sono la risorsa scarsa. Una seconda
            riga li rimetterebbe, in mezzo fra il campo e il suo verdetto,
            disfacendo una decisione presa apposta. Il budget di caratteri che
            tiene la riga a una riga sola è misurato e provato in
            `tests/stats-plus-riga.test.ts`.
          */}
          {statsPlus && (
            <RigaStatsPlus
              role={ruoloInCorso}
              temperatura={temperaturaRuolo}
              scatto={scattoRuolo}
              alternative={alternativeLotto}
            />
          )}

          {/*
            ⚠ Qui stava la riga dei valori suggeriti — `+5`, `+10`, `+25` e un
            `max` che scriveva il tetto nel campo — e da M16 non c'è più: la
            cifra si scrive, non si sceglie fra quattro incrementi tondi. I
            ~44px che la riga occupava sono altezza restituita al campo, che con
            la tastiera aperta è la risorsa scarsa.
          */}

          {/* ── Il verdetto, sempre nello stesso posto ── */}
          <FeedbackLine
            feedback={feedback}
            problem={raw === "" ? null : problem}
            savedAmount={savedAmount}
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
            {feedback.kind === "saving"
              ? "Invio…"
              : savedAmount === null
                ? "Offri"
                : alreadyAt
                  ? `Conferma ${savedAmount}`
                  : `Rilancia a ${amount ?? "…"}`}
          </Button>

          {/*
            ⚠ «Chiudi» è rimasto da solo, e occupa la riga intera: accanto a lui
            stava «Ritira», tolto da M16. Chiudere il modale non toglie niente —
            l'offerta è a database e la card la rimostra — ed è la ragione per
            cui questo pulsante non chiede conferma.
          */}
          <Dialog.Close asChild>
            <Button type="button" variant="ghost" className="h-11 w-full">
              Chiudi
            </Button>
          </Dialog.Close>
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
  closing,
  frozen,
}: {
  feedback: Feedback;
  problem: string | null;
  savedAmount: number | null;
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
          "border-emerald-600/40 bg-emerald-600/10 font-medium text-emerald-700",
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
