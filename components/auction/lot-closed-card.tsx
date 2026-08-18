"use client";

import { Countdown } from "@/components/auction/countdown";
import { RevealBids } from "@/components/auction/reveal-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/domain";
import { memberById, memberLabel } from "@/lib/realtime/portal";
import type { Snapshot } from "@/lib/realtime/types";
import { cn } from "@/lib/utils";

/**
 * Il lotto chiuso: **la cornice di «finito, non si offre più»**, in due momenti.
 *
 * Esiste come componente separato da `LotCard` per una ragione che non è di
 * organizzazione del codice ma di uso reale. Finché il reveal viveva dentro la
 * card viva, chi guardava il telefono per tre secondi vedeva la stessa cornice,
 * la stessa barra che scorre e lo stesso countdown grande che un attimo prima
 * chiedevano di offrire: l'unico modo di capire che il lotto era finito era
 * leggere. Qui il registro visivo cambia tutto insieme — superficie spenta,
 * nessuna barra di avanzamento, nessun pulsante d'offerta.
 *
 * ## I due momenti (M14)
 *
 * Da M14 questa card ne racconta **due**, e sono due momenti dello *stesso*
 * oggetto invece di due card:
 *
 * - **sigillato** (`LOT_SEALED`) — il round è chiuso e nessuno sa niente. Dove sta
 *   il prezzo pagato scorre il countdown del cancello, e dove sta l'elenco delle
 *   buste c'è una riga che dice che sono ancora chiuse.
 * - **aperto** (`LOT_REVEAL`) — il vincitore, il prezzo, e tutte le buste di tutti
 *   i round. Il numero grande in alto a destra non è più il tempo che scappa ma il
 *   **prezzo** già pagato.
 *
 * ⚠ **La scelta di non fare una terza card è la lezione di M1 applicata al
 * contrario.** Quella diceva: il lotto vivo e il lotto chiuso devono avere due
 * facce diverse. Questa dice: il lotto sigillato e il lotto aperto sono la stessa
 * faccia in due istanti, perché per chi guarda il telefono la cosa già accaduta —
 * «non si offre più» — è la stessa, e ciò che cambia è solo se il risultato si
 * conosce. Una terza cornice avrebbe rimesso a chi guarda il lavoro di capire
 * leggendo, che è precisamente ciò che M1 ha tolto.
 *
 * ⚠ E l'ordine visivo non cambia fra i due: il prezzo **appare dove prima scorreva
 * il tempo**. Chi sta guardando la card nell'istante in cui le buste si aprono non
 * ha niente da ritrovare — il numero grande resta dov'era e cambia significato.
 *
 * Che sia un componente diverso non tocca §8bis: quella chiede che l'area del
 * lotto sia sempre presente e sia funzione pura dello snapshot, non che sia
 * sempre lo stesso nodo React. `portalScreen` continua a restituire `LOT` per
 * tutte e quattro le fasi, e chi rientra a metà cancello trova questa card
 * sigillata con il suo countdown giusto, esattamente come chi non si è mai
 * disconnesso (I10).
 *
 * Il piè di pagina dice **quando** si riparte e non **a chi** tocca: il turno
 * successivo lo decide il motore quando il reveal scade, e anticiparlo qui
 * sarebbe una seconda copia della rotazione da tenere allineata a mano. Chi
 * chiama si scopre quando il lotto nuovo si apre (decisione dell'owner,
 * DECISIONS 2026-08-09).
 *
 * Per l'owner, e solo per lui, quel piè di pagina porta anche il pulsante che
 * anticipa la scadenza: «Mostra risultati» nel cancello, «Prosegui asta» nel
 * reveal. Il countdown resta e resta la scadenza automatica — il pulsante è la
 * scorciatoia, non il meccanismo. Chi non conduce vede la card senza pulsanti.
 */
export function LotClosedCard({
  snapshot,
  myMemberId,
  offset,
  onSkip = null,
  onShowResults = null,
  skipPending = false,
}: {
  snapshot: Snapshot;
  myMemberId: string | null;
  offset: number;
  /** Solo per l'owner, nel reveal: `null` per tutti gli altri. */
  onSkip?: (() => void) | null;
  /** Solo per l'owner, nel cancello (M14): `null` per tutti gli altri. */
  onShowResults?: (() => void) | null;
  skipPending?: boolean;
}) {
  const lot = snapshot.currentLot;
  if (lot === null) return null;

  const { pausedAt, status, phase } = snapshot.auction;
  // ⚠ La card sigillata si riconosce dalla **fase**, non da `reveal === null`.
  // Prima di M14 questo componente usciva subito con `reveal === null`, ed era
  // giusto: fuori dal reveal non c'era niente da disegnare. Adesso c'è, e la fase
  // è l'unica cosa che distingue «le buste non sono ancora uscite» da «questo
  // snapshot non porta il reveal perché siamo altrove».
  const sealed = phase === "LOT_SEALED";
  const reveal = lot.reveal;
  if (!sealed && reveal === null) return null;

  const pausedFor = status === "PAUSED" ? pausedAt : null;
  const winner = reveal === null ? null : memberById(snapshot, reveal.winnerMemberId);
  const iWon = reveal !== null && reveal.winnerMemberId === myMemberId;

  return (
    <section className="bg-muted/40 overflow-hidden rounded-xl border">
      {/* ── Il lotto è finito, e si vede prima di leggere ── */}
      <header
        className={cn(
          "space-y-1 px-4 py-3 text-center",
          iWon ? "bg-emerald-600/10" : "bg-background/60",
        )}
      >
        <Badge variant={iWon ? "default" : "secondary"}>
          {sealed ? "Buste consegnate" : "Lotto assegnato"}
        </Badge>
        <h2 className="truncate text-xl leading-tight font-semibold">
          {lot.player.name}
        </h2>
        <p className="text-muted-foreground truncate text-sm">
          {ROLE_LABELS[lot.player.role]} · {lot.player.team}
        </p>
      </header>

      {/*
        ── Chi se l'è preso, e a quanto ──
        Nel cancello questa riga è la stessa riga, con dentro l'attesa: a sinistra
        cosa sta succedendo, a destra il numero grande. Quando le buste si aprono il
        countdown lascia il posto al prezzo **nello stesso punto**.
      */}
      <div className="flex items-center justify-between gap-3 border-y px-4 py-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs tracking-wide uppercase">
            {sealed ? "Risultati fra" : iWon ? "L'hai preso tu" : "Va a"}
          </p>
          <p
            className={cn(
              "truncate font-semibold",
              sealed ? "text-muted-foreground text-sm" : "text-lg",
            )}
          >
            {sealed ? "Le buste sono ancora chiuse" : memberLabel(winner)}
          </p>
        </div>
        {sealed ? (
          <Countdown
            deadline={snapshot.auction.phaseDeadline}
            offset={offset}
            pausedAt={pausedFor}
            className="shrink-0 text-4xl leading-none font-semibold"
          />
        ) : (
          <p
            className={cn(
              "text-4xl leading-none font-semibold tabular-nums",
              iWon && "text-emerald-700",
            )}
          >
            {reveal!.price}
          </p>
        )}
      </div>

      {/* ── Tutte le buste, di tutti i round — o la riga che dice che non ci sono ── */}
      <div className="px-4 py-3">
        {sealed ? (
          <p className="text-muted-foreground text-sm">
            Il round è chiuso: nessuna offerta nuova entra più.{" "}
            {status === "PAUSED"
              ? "L'asta è in pausa, quindi le buste restano chiuse fino alla ripresa."
              : "Fra pochi secondi si aprono tutte insieme, per tutti."}
          </p>
        ) : (
          <RevealBids
            reveal={reveal!}
            snapshot={snapshot}
            myMemberId={myMemberId}
          />
        )}
      </div>

      {/* ── Quanto manca alla ripresa: un numero che scorre, non una barra ── */}
      <footer className="space-y-3 border-t px-4 py-3">
        {/*
          Nel cancello il countdown è già il numero grande qui sopra, quindi questo
          piè di pagina non lo ripete: dice solo che non c'è niente da fare.
        */}
        {sealed ? (
          <p className="text-muted-foreground text-sm">
            {onShowResults
              ? "Si aprono da sole, o quando vuoi tu."
              : "Non devi fare niente: si aprono da sole."}
          </p>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-muted-foreground text-xs tracking-wide uppercase">
                Prossimo turno
              </p>
              <p className="text-muted-foreground text-sm">
                {onSkip
                  ? "Riparte da solo, o quando vuoi tu."
                  : "Non devi fare niente: riparte da solo."}
              </p>
            </div>
            <Countdown
              deadline={snapshot.auction.phaseDeadline}
              offset={offset}
              pausedAt={pausedFor}
              className="shrink-0 text-2xl font-semibold"
            />
          </div>
        )}

        {/* A tutta larghezza: si preme dal telefono, spesso senza guardare. */}
        {sealed && onShowResults && (
          <Button
            type="button"
            className="w-full"
            onClick={onShowResults}
            disabled={skipPending}
          >
            {skipPending ? "Apro…" : "Mostra risultati"}
          </Button>
        )}
        {!sealed && onSkip && (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={onSkip}
            disabled={skipPending}
          >
            {skipPending ? "Proseguo…" : "Prosegui asta"}
          </Button>
        )}
      </footer>
    </section>
  );
}
