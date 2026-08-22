"use client";

import { RevealBids } from "@/components/auction/reveal-panel";
import { ROLE_LABELS } from "@/lib/domain";
import { memberById, memberLabel } from "@/lib/realtime/portal";
import type { Snapshot } from "@/lib/realtime/types";
import { cn } from "@/lib/utils";

/**
 * Il **corpo** del lotto chiuso, in due momenti (M14):
 *
 * - **sigillato** (`LOT_SEALED`) — il round è chiuso e nessuno sa niente, nemmeno
 *   il server, che non ha ancora chiamato `resolveRound`;
 * - **aperto** (`LOT_REVEAL`) — il vincitore, il prezzo, e tutte le buste di
 *   tutti i round.
 *
 * ## Cosa non c'è più (M17 §6)
 *
 * La cornice, l'intestazione col nome del giocatore e il badge, i due countdown
 * (quello grande nel mezzo e quello nel piè di pagina) e i pulsanti dell'owner:
 * tutto quello adesso è `SceneCard`, che lo mette negli stessi pixel in cui lo
 * mette per le altre otto scene.
 *
 * ⚠ **E qui la sottrazione ha risolto una cosa, non solo spostato del markup.**
 * Fino a v1.16.0 questa card aveva **due** countdown in due momenti diversi — nel
 * cancello il numero grande al centro, nel reveal un secondo numero in fondo — e
 * il prezzo appariva *dove prima scorreva il tempo*. Era una soluzione buona a un
 * problema che la cornice unica fa sparire: il tempo ha un posto suo in fondo alla
 * card, quindi il prezzo può stare dove sta il prezzo e non deve più ereditare
 * l'angolo del countdown.
 *
 * ⚠ **La distinzione fra i due momenti resta sulla `phase` e non su
 * `reveal === null`**, che è la cosa da non riscoprire da capo: prima di M14
 * questo componente usciva subito con `reveal === null` ed era giusto, perché
 * fuori dal reveal non c'era niente da disegnare. Adesso c'è, e la fase è l'unica
 * cosa che distingue «le buste non sono ancora uscite» da «questo snapshot non
 * porta il reveal perché siamo altrove».
 *
 * Il piè di pagina diceva **quando** si riparte e non **a chi** tocca, e quella
 * scelta sopravvive alla cornice nuova: il turno successivo lo decide il motore
 * quando il reveal scade, e anticiparlo qui sarebbe una seconda copia della
 * rotazione da tenere allineata a mano (decisione dell'owner, DECISIONS
 * 2026-08-09).
 */
export function LotClosedCard({
  snapshot,
  myMemberId,
  action = null,
}: {
  snapshot: Snapshot;
  myMemberId: string | null;
  /**
   * «Prosegui asta», e **solo nell'esito**: sta qui invece che nello slot in
   * fondo alla cornice (richiesta dell'owner del 2026-08-22, dopo aver guardato
   * una simulazione).
   *
   * ⚠ **È la sola scena in cui l'azione non è l'ultima cosa della card**, quindi
   * vale la pena dire perché non rompe l'anatomia di §6 ma la rispetta. In tutte
   * le altre otto scene il corpo è corto e «in fondo alla card» e «subito sotto
   * la notizia» sono lo stesso pixel. Nell'esito no: sotto il vincitore c'è
   * l'elenco di tutte le buste di tutti i round, che può essere dodici righe —
   * un'appendice, non la notizia. Con il pulsante in fondo bisognerebbe scorrere
   * oltre l'appendice per proseguire l'asta, e lo si preme dal telefono con
   * dodici persone che aspettano.
   *
   * La regola che regge, quindi, non è «l'azione sta in fondo» ma **«l'azione
   * segue la notizia»** — e nelle altre otto scene le due coincidono.
   */
  action?: React.ReactNode;
}) {
  const lot = snapshot.currentLot;
  if (lot === null) return null;

  const { phase, status } = snapshot.auction;
  const sealed = phase === "LOT_SEALED";
  const reveal = lot.reveal;
  if (!sealed && reveal === null) return null;

  const winner = reveal === null ? null : memberById(snapshot, reveal.winnerMemberId);
  const iWon = reveal !== null && reveal.winnerMemberId === myMemberId;

  return (
    <>
      {/* ── Chi era a lotto ── */}
      <div className="min-w-0">
        <h3 className="truncate text-xl leading-tight font-semibold">
          {lot.player.name}
        </h3>
        <p className="text-muted-foreground truncate text-sm">
          {ROLE_LABELS[lot.player.role]} · {lot.player.team}
        </p>
      </div>

      {/* ── Chi se l'è preso, e a quanto ── */}
      {sealed ? (
        <p className="bg-muted/50 rounded-md px-3 py-2 text-sm">
          Il round è chiuso: nessuna offerta nuova entra più.{" "}
          {status === "PAUSED"
            ? "L'asta è in pausa, quindi le buste restano chiuse fino alla ripresa."
            : "Si aprono tutte insieme, per tutti."}
        </p>
      ) : (
        <div
          className={cn(
            "flex items-center justify-between gap-3 rounded-lg border px-3 py-2",
            iWon && "border-emerald-600/40 bg-emerald-600/5",
          )}
        >
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs tracking-wide uppercase">
              {iWon ? "L'hai preso tu" : "Va a"}
            </p>
            <p className="truncate font-semibold">{memberLabel(winner)}</p>
          </div>
          <p
            className={cn(
              "shrink-0 text-3xl leading-none font-semibold tabular-nums",
              iWon && "text-emerald-700",
            )}
          >
            {reveal!.price}
          </p>
        </div>
      )}

      {/* ── «Prosegui asta», subito sotto chi si è aggiudicato il giocatore ── */}
      {!sealed && action}

      {/* ── Tutte le buste, di tutti i round ── */}
      {!sealed && (
        <RevealBids reveal={reveal!} snapshot={snapshot} myMemberId={myMemberId} />
      )}
    </>
  );
}
