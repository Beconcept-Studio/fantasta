"use client";

import { useState } from "react";

import { PresenceDot } from "@/components/auction/presence-dot";
import { Button } from "@/components/ui/button";
import { managerControls } from "@/lib/realtime/manage";
import { memberById, memberLabel } from "@/lib/realtime/portal";
import { sendAction, type ActionPayload } from "@/lib/realtime/action";
import type { Snapshot } from "@/lib/realtime/types";
import { cn } from "@/lib/utils";

/**
 * I comandi della regia: avvio, e — da F6-03 — pausa e ripresa. Da M14 anche le
 * due leve del cancello dei risultati.
 *
 * ⚠ **Il cancello è l'unico blocco di questa pagina che vive per pochi secondi**, e
 * questo cambia come va letto: «Mostra risultati» e «Annulla lotto» compaiono e
 * spariscono da soli, perché la loro condizione è una fase. Non sono leve della
 * serata come pausa e ripresa — sono la risposta a «un attimo, c'è un problema»,
 * e la sera dell'asta chi conduce le trova già davanti invece di cercarle.
 *
 * Il pulsante d'avvio **non esisteva in nessuna pagina** fino a qui: l'asta si
 * faceva partire dai bot o con una `fetch` a mano dalla console del browser.
 * Questo è il posto in cui vive, ed è anche l'unico punto dell'applicazione in
 * cui si sceglie da quale posto comincia la rotazione dei turni.
 *
 * Le condizioni che disabilitano i pulsanti sono in `managerControls`, cioè in
 * una funzione pura con i suoi test. **Disabilitare non è autorizzare**
 * (regola 6): `startAuction` ricontrolla da sé la proprietà dell'asta e la
 * presence di tutti i membri, e se qualcuno cade nel mezzo secondo fra il
 * render e il click, il rifiuto arriva dal server con il suo messaggio.
 */
export function ControlPanel({
  auctionId,
  snapshot,
}: {
  auctionId: string;
  snapshot: Snapshot;
}) {
  const controls = managerControls(snapshot);
  const [startSeat, setStartSeat] = useState(0);
  const [pending, setPending] = useState<ActionPayload["type"] | null>(null);
  const [feedback, setFeedback] = useState<
    { ok: boolean; message: string } | null
  >(null);

  async function send(payload: ActionPayload, done: string) {
    setPending(payload.type);
    setFeedback(null);
    const result = await sendAction(auctionId, payload);
    setPending(null);
    setFeedback(
      result.ok ? { ok: true, message: done } : { ok: false, message: result.message },
    );
  }

  const { status } = snapshot.auction;
  const beforeStart = status === "DRAFT" || status === "READY";

  return (
    <section className="bg-card space-y-4 rounded-xl border p-4">
      <h2 className="font-semibold">Comandi</h2>

      {beforeStart && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Da quale posto si comincia</p>
            <p className="text-muted-foreground text-sm">
              La rotazione parte da qui e prosegue in ordine di posto. Il primo
              ruolo è quello in cima all&apos;ordine configurato.
            </p>
          </div>

          {/* Un pulsante per posto, non una select: sono al massimo dodici e la
              sera dell'asta si sceglie a voce, guardando chi è collegato. */}
          <div className="flex flex-wrap gap-2">
            {snapshot.members.map((member) => {
              const chosen = member.seatIndex === startSeat;
              return (
                <button
                  key={member.id}
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => setStartSeat(member.seatIndex)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition",
                    chosen
                      ? "border-foreground bg-foreground text-background"
                      : "hover:bg-accent",
                  )}
                >
                  <span className="tabular-nums opacity-70">
                    {member.seatIndex + 1}
                  </span>
                  <span className="max-w-40 truncate font-medium">
                    {member.teamName}
                  </span>
                  <PresenceDot
                    presence={member.presence}
                    className={chosen ? "ring-background/50 ring-1" : undefined}
                  />
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              disabled={!controls.canStart || pending !== null}
              onClick={() =>
                void send(
                  { type: "START", startSeatIndex: startSeat },
                  "Asta avviata.",
                )
              }
            >
              {pending === "START" ? "Avvio…" : "Avvia l'asta"}
            </Button>
            {controls.startBlocked !== null && (
              <p className="text-muted-foreground max-w-xl text-sm">
                {controls.startBlocked}
              </p>
            )}
          </div>
        </div>
      )}

      {/*
        ⚠ **Il cancello dei risultati sta in cima**, sopra pausa e ripresa (M14 §5).
        Non è gerarchia: è che dura X secondi e in quegli X secondi è la sola cosa
        che chi conduce deve poter raggiungere senza cercarla. Passati quelli, il
        blocco sparisce da sé.
      */}
      {controls.canShowResults && (
        <div className="border-primary/40 bg-primary/5 space-y-3 rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              disabled={pending !== null}
              onClick={() =>
                void send({ type: "SHOW_RESULTS" }, "Buste aperte.")
              }
            >
              {pending === "SHOW_RESULTS" ? "Apro…" : "Mostra risultati"}
            </Button>
            <p className="text-muted-foreground max-w-xl text-sm">
              Il round è chiuso e <strong>nessuno sa ancora niente</strong>. Apri
              le buste quando la stanza è pronta: se non premi, si aprono da sole
              allo scadere del tempo.
            </p>
          </div>
        </div>
      )}

      {(controls.canPause || controls.canResume) && (
        <div className="flex flex-wrap items-center gap-3">
          {controls.canPause && (
            <Button
              size="lg"
              variant="outline"
              disabled={pending !== null}
              onClick={() => void send({ type: "PAUSE" }, "Asta in pausa.")}
            >
              {pending === "PAUSE" ? "Metto in pausa…" : "Metti in pausa"}
            </Button>
          )}
          {controls.canResume && (
            <Button
              size="lg"
              disabled={pending !== null}
              onClick={() => void send({ type: "RESUME" }, "Asta ripresa.")}
            >
              {pending === "RESUME" ? "Riprendo…" : "Riprendi l'asta"}
            </Button>
          )}
          {/*
            ⚠ Durante il cancello il testo dice cosa succede **adesso**, non la frase
            generica sui countdown: chi mette in pausa in quel momento lo sta facendo
            perché qualcuno ha segnalato un problema, e la cosa che deve leggere è
            che i risultati non escono finché non riprende.
          */}
          <p className="text-muted-foreground max-w-xl text-sm">
            {controls.canShowResults
              ? "Se qualcuno segnala un problema, metti in pausa: i risultati non escono finché non riprendi, e da lì puoi anche annullare il lotto."
              : controls.canCancelLot
                ? "Le buste sono ancora chiuse e restano chiuse. Riprendi per far ripartire il cancello dal tempo che restava, oppure annulla il lotto qui sotto."
                : controls.canResume
                  ? "Alla ripresa ogni countdown riparte dal tempo che restava, non da capo: la pausa congela le scadenze, non le azzera."
                  : "La pausa congela tutti i countdown e sospende le offerte. La fase resta quella che è: si riprende esattamente da qui."}
          </p>
        </div>
      )}

      {/*
        «Annulla lotto» compare **solo** ad asta in pausa dentro il cancello, ed è
        l'unica azione dell'applicazione che riporta il turno indietro. Regge perché
        lì il lotto non ha ancora prodotto niente: nessuna assegnazione, nessun
        credito speso, nessuna rotazione avanzata.
      */}
      {controls.canCancelLot && (
        <CancelLotBlock
          snapshot={snapshot}
          pending={pending !== null}
          working={pending === "CANCEL_LOT"}
          onConfirm={() =>
            void send({ type: "CANCEL_LOT" }, "Lotto annullato: il turno torna a chi aveva chiamato.")
          }
        />
      )}

      {/*
        «Prosegui asta» compare solo mentre le buste sono aperte, quindi per
        pochi secondi per lotto: sta qui sotto pausa e ripresa e non fra i
        comandi permanenti, perché non è una leva della serata — è la risposta
        a «abbiamo visto, andiamo avanti».
      */}
      {controls.canSkipReveal && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="lg"
            disabled={pending !== null}
            onClick={() => void send({ type: "SKIP_REVEAL" }, "Si prosegue.")}
          >
            {pending === "SKIP_REVEAL" ? "Proseguo…" : "Prosegui asta"}
          </Button>
          <p className="text-muted-foreground max-w-xl text-sm">
            Chiude subito le buste aperte e passa il turno successivo, senza
            aspettare che scada il tempo configurato.
          </p>
        </div>
      )}

      {feedback !== null && (
        <p
          role="status"
          className={cn(
            "rounded-md border px-3 py-2 text-sm",
            feedback.ok
              ? "border-emerald-600/40 bg-emerald-600/10"
              : "border-destructive/50 bg-destructive/10",
          )}
        >
          {feedback.message}
        </p>
      )}

      {/* {beforeStart && (
        <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {snapshot.members.map((member) => (
            <li
              key={member.id}
              className="text-muted-foreground flex items-center gap-2 text-sm"
            >
              <PresenceDot presence={member.presence} />
              <span className="min-w-0 flex-1 truncate">{member.teamName}</span>
              <span className="text-xs">{PRESENCE_LABELS[member.presence]}</span>
            </li>
          ))}
        </ul>
      )} */}
    </section>
  );
}

/**
 * «Annulla lotto», con il passo in mezzo (M14 §5).
 *
 * ⚠ **La conferma nomina il giocatore e chi l'aveva chiamato**, ed è la lezione di
 * M12 §4: «un avviso che nomina un numero si legge; uno generico si clicca». Qui i
 * nomi sono due, e sono precisamente i due fatti che l'operazione cambia — il
 * giocatore torna disponibile, il turno torna a quella squadra.
 *
 * **Non serve digitare niente.** Non è una cancellazione irreversibile di dati: è un
 * lotto di trenta secondi da rifare, e le offerte restano tutte a database. Ma serve
 * un passo in mezzo, perché il pulsante vive accanto a «Riprendi l'asta» e i due
 * click sono a un centimetro di distanza.
 */
function CancelLotBlock({
  snapshot,
  pending,
  working,
  onConfirm,
}: {
  snapshot: Snapshot;
  /** Un'altra azione è in volo: si disabilita tutto, non solo questo pulsante. */
  pending: boolean;
  working: boolean;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const lot = snapshot.currentLot;
  if (lot === null) return null;

  const caller = memberLabel(memberById(snapshot, lot.calledByMemberId));

  return (
    <div className="border-destructive/40 bg-destructive/5 space-y-3 rounded-lg border p-3">
      {!asking ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="lg"
            variant="outline"
            disabled={pending}
            onClick={() => setAsking(true)}
          >
            Annulla lotto
          </Button>
          <p className="text-muted-foreground max-w-xl text-sm">
            Butta via questo lotto e rifallo: le buste non si aprono, il turno
            torna a chi aveva chiamato e il giocatore torna disponibile.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold">
              Annullo il lotto di {lot.player.name}?
            </p>
            <p className="text-muted-foreground text-sm">
              Le buste di questo lotto <strong>non verranno mai aperte</strong>.{" "}
              <strong>{lot.player.name}</strong> torna disponibile per tutti, e il
              turno di chiamata torna a <strong>{caller}</strong>. Le offerte
              restano nel verbale dell&apos;asta, senza diventare pubbliche.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              disabled={pending}
              onClick={onConfirm}
            >
              {working ? "Annullo…" : "Sì, annulla il lotto"}
            </Button>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => setAsking(false)}
            >
              No, lascia stare
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
