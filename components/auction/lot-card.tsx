"use client";

import { Campioncino } from "@/components/auction/campioncino";
import { TiePanel } from "@/components/auction/reveal-panel";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS } from "@/lib/domain";
import { amEligible, amInTie, memberById, memberLabel } from "@/lib/realtime/portal";
import type { Snapshot } from "@/lib/realtime/types";

/**
 * Il **corpo** del lotto vivo: chi è a lotto, quanto ho offerto io, e — durante
 * `LOT_TIE_PREP` — che c'è uno spareggio in arrivo.
 *
 * ## Cosa non c'è più (M17 §6)
 *
 * Fino a v1.16.0 questo componente era una card intera: si disegnava il suo
 * `rounded-xl border`, la sua intestazione, il suo countdown da 30px e la sua
 * barra. Da M17 tutto quello è la cornice — `SceneCard` — e qui resta il
 * contenuto. Anche il pulsante «Apri offerta» è uscito: sta nello slot `action`
 * della cornice, che lo mette a piena larghezza in fondo in **tutte** le scene,
 * invece che in un posto un po' diverso per card.
 *
 * Il senso della sottrazione: la card del lotto non sparisce mai (§8bis punto 2)
 * e non è questo componente a garantirlo — lo garantisce la cornice, che c'è in
 * tutte e nove le scene. Quello che resta qui è la sola cosa che cambia da una
 * scena all'altra.
 *
 * **Degli altri non dice niente** (M1). Fino a v1.1.0 c'era un elenco delle buste
 * consegnate, un pallino verde per chi si era mosso: informazione che lo snapshot
 * non porta più, perché in una stanza dove ci si guarda in faccia sapere chi ha
 * già consegnato basta per fare strategia anche senza sapere quanto. Al suo posto
 * c'è una riga che spiega il silenzio — se non si dice perché, la card sembra
 * rotta.
 */
export function LotCard({
  snapshot,
  myMemberId,
}: {
  snapshot: Snapshot;
  myMemberId: string | null;
}) {
  const lot = snapshot.currentLot;
  if (lot === null) return null;

  const { phase } = snapshot.auction;
  const open = phase === "LOT_OPEN";
  const eligible = amEligible(lot, myMemberId);
  const caller = memberById(snapshot, lot.calledByMemberId);
  const iCalled = lot.calledByMemberId === myMemberId;

  return (
    <>
      {/* ── Chi è a lotto ── */}
      <div className="flex items-start gap-3">
        {/*
          ⚠ 68×100, a sinistra del nome (M7 §6). Venti pixel di altezza in più
          rispetto ai 54×80 provati sono il prezzo minimo perché sia una figurina
          invece di una macchia colorata; a 81×120 si vedrebbe meglio, ma
          costerebbe quaranta pixel su uno schermo da 667. Se non c'è, sparisce e
          il testo scorre a sinistra.
        */}
        <Campioncino
          extId={lot.player.extId}
          className="h-25 w-17 shrink-0 rounded-md"
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          {/*
            ⚠ Il badge dello **spareggio** non è più qui: da M17 lo spareggio è
            una scena sua, quindi lo dicono la fascia ambra, l'etichetta
            «Spareggio aperto» e il badge nell'angolo della cornice. Ripeterlo
            accanto al nome sarebbe la terza volta nella stessa card.
          */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{ROLE_LABELS[lot.player.role]}</Badge>
            {lot.autoCalled && (
              <Badge variant="outline" title="Nessuno ha chiamato in tempo">
                auto
              </Badge>
            )}
          </div>
          <h3 className="truncate text-2xl leading-tight font-semibold">
            {lot.player.name}
          </h3>
          <p className="text-muted-foreground text-sm">
            {lot.player.team} · fvm {lot.player.fvm}
            <br />
            chiamato da {iCalled ? "te" : memberLabel(caller)}
          </p>
        </div>
      </div>

      {/* ── Lo spareggio che sta per riaprirsi ── */}
      {phase === "LOT_TIE_PREP" && lot.tie !== null && (
        <TiePanel
          amount={lot.tie.amount}
          amInTie={amInTie(snapshot, myMemberId)}
        />
      )}

      {/* ── La mia offerta, l'unica cifra mostrabile durante LOT_OPEN (I8) ── */}
      {open && (
        <MyBidRow snapshot={snapshot} eligible={eligible} iCalled={iCalled} />
      )}

      {/*
        ── Il silenzio, spiegato: delle buste altrui non si sa niente (M1) ──
        Solo in LOT_OPEN: durante lo spareggio i pareggianti sono già stati
        annunciati, e ripetere che le buste sono segrete si contraddirebbe con il
        pannello qui sopra.
      */}
      {open && (
        <p className="text-muted-foreground text-center text-xs">
          Le buste sono segrete: chi ha offerto, e quanto, si vede
          all&apos;apertura.
        </p>
      )}
    </>
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
}: {
  snapshot: Snapshot;
  eligible: boolean;
  iCalled: boolean;
}) {
  if (!eligible) {
    return (
      <p className="bg-muted/50 rounded-md px-3 py-2 text-sm">
        Non sei fra gli idonei di questo lotto: hai il ruolo pieno, o i crediti
        non bastano.
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
      {/*
        ⚠ La coda «e non puoi ritirarti, solo rilanciare» è stata tolta da M16,
        e non perché fosse diventata falsa: è diventata **fuorviante**. Dire al
        chiamante che *lui* non può ritirarsi implica che qualcun altro possa, e
        dopo M16 non è vero per nessuno.
      */}
      {iCalled && (
        <p className="text-muted-foreground text-xs">
          L&apos;hai chiamato tu: l&apos;apertura a 1 è già registrata.
        </p>
      )}
    </div>
  );
}
