"use client";

import { useState } from "react";

import { PresenceDot } from "@/components/auction/presence-dot";
import { Button } from "@/components/ui/button";
import { managerControls } from "@/lib/realtime/manage";
import { sendAction, type ActionPayload } from "@/lib/realtime/action";
import type { Snapshot } from "@/lib/realtime/types";
import { cn } from "@/lib/utils";

/**
 * I comandi della regia: avvio, e — da F6-03 — pausa e ripresa.
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
          <p className="text-muted-foreground max-w-xl text-sm">
            {controls.canResume
              ? "Alla ripresa ogni countdown riparte dal tempo che restava, non da capo: la pausa congela le scadenze, non le azzera."
              : "La pausa congela tutti i countdown e sospende le offerte. La fase resta quella che è: si riprende esattamente da qui."}
          </p>
        </div>
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
