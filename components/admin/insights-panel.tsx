"use client";

import { useActionState } from "react";

import {
  refreshListoneInsightsAction,
  refreshSetPiecesAction,
} from "@/app/admin/actions";
import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { FormFeedback } from "@/components/setup/form-feedback";
import { Button } from "@/components/ui/button";
import type { RefreshSource } from "@/lib/domain";
import { type SourceRunStatus, describeSourceRun } from "@/lib/source-status";

/**
 * I due pulsanti degli insight (M8 §7), e da M11 lo stato di ciascuna fonte.
 *
 * ⚠ **Sono due form separati, con due stati separati**, e non un form con due
 * pulsanti: le fonti sono indipendenti e i loro messaggi vanno letti accanto al
 * pulsante che li ha prodotti. Un errore della pagina dei rigoristi che comparisse
 * sotto il pulsante del listone manderebbe a cercare il guasto nel posto
 * sbagliato.
 *
 * ⚠ **E nessun file da caricare, a differenza delle figurine**: qui le fonti sono
 * due `GET` pubbliche. È la ragione per cui M8 non aggiunge nessun upload — il solo
 * che era in progetto, la griglia portieri, è rimasto fuori dal perimetro.
 *
 * Niente barra di avanzamento, per la ragione di M7: le due risposte misurate
 * stanno in due secondi in tutto, e una barra che sale e scende in due secondi non
 * informa nessuno.
 *
 * ⚠ **Da M11 ogni fonte porta la sua riga di stato, e sta qui e non solo in cima
 * alla pagina.** L'avviso in cima compare solo quando qualcosa è rotto — è «la
 * cosa più importante della pagina» e deve restare tale — ma la domanda «quando si
 * è aggiornato, da sé o a mano?» si fa anche quando va tutto bene, e la si fa
 * guardando il pulsante. Le frasi le scrive `lib/source-status.ts`, che è lo
 * stesso modulo usato dall'avviso: due posti che raccontano lo stesso guasto con
 * parole diverse sono due posti che prima o poi si contraddicono.
 */
export function InsightsPanel({
  rows,
  statuses,
}: {
  rows: number;
  statuses: SourceRunStatus[];
}) {
  const [listoneState, refreshListone, listoneRunning] = useActionState(
    refreshListoneInsightsAction,
    EMPTY_FORM_STATE,
  );
  const [piecesState, refreshPieces, piecesRunning] = useActionState(
    refreshSetPiecesAction,
    EMPTY_FORM_STATE,
  );

  return (
    <div className="grid max-w-3xl gap-6 sm:grid-cols-2">
      <form action={refreshListone} className="space-y-3">
        <div>
          <h2 className="font-medium">Titolarità e rigori storici</h2>
          <p className="text-muted-foreground text-xs">
            Da <span className="font-mono">api.fantalab.it</span>: quante volte è
            partito titolare, i minuti giocati, i rigori tirati. È la fonte che
            crea le righe.
          </p>
        </div>

        <SourceRunLine statuses={statuses} source="listone_insights" />
        <FormFeedback state={listoneState} />

        <Button type="submit" disabled={listoneRunning}>
          {listoneRunning
            ? "Aggiorno…"
            : rows === 0
              ? "Importa il listone"
              : "Aggiorna il listone"}
        </Button>
      </form>

      <form action={refreshPieces} className="space-y-3">
        <div>
          <h2 className="font-medium">Rigoristi e calci piazzati</h2>
          <p className="text-muted-foreground text-xs">
            Da <span className="font-mono">fantacalcio.it</span>: chi batte i
            rigori e chi i piazzati, in ordine di gerarchia. Aggiorna le righe
            che esistono — <strong>il listone va importato prima</strong>.
          </p>
        </div>

        <SourceRunLine statuses={statuses} source="set_pieces" />
        <FormFeedback state={piecesState} />

        <Button
          type="submit"
          variant="secondary"
          disabled={piecesRunning || rows === 0}
        >
          {piecesRunning ? "Aggiorno…" : "Aggiorna i designati"}
        </Button>
      </form>
    </div>
  );
}

/**
 * Com'è andato l'ultimo tentativo di **questa** fonte.
 *
 * ⚠ Il nome della fonte non si ripete qui: sta già nell'intestazione due righe
 * sopra, e ripeterlo farebbe leggere due volte la stessa cosa in un blocco alto
 * quattro righe. Nell'avviso in cima invece c'è, perché là il contesto non c'è.
 *
 * ⚠ **Non svanisce mai in un colore illeggibile.** Il caso `never` — «non è ancora
 * stato chiesto nessun aggiornamento» — è quello con cui la tabella nasce in
 * produzione, e non è un guasto: si dice in grigio, come un'informazione. Un
 * `never` colorato di rosso il giorno del deploy manderebbe a cercare un guasto
 * che si sistema da sé entro un quarto d'ora.
 */
function SourceRunLine({
  statuses,
  source,
}: {
  statuses: SourceRunStatus[];
  source: RefreshSource;
}) {
  const status = statuses.find((s) => s.source === source);
  if (status === undefined) return null;
  const said = describeSourceRun(status);

  if (said.tone === "fail") {
    return (
      <p className="rounded-md border border-red-600/40 bg-red-600/10 px-3 py-2 text-xs text-red-900">
        <strong>{said.headline}</strong>
        {said.detail !== null && <> {said.detail}.</>}
        {said.message !== null && <> «{said.message}»</>} {said.next}
      </p>
    );
  }

  return (
    <p className="text-muted-foreground text-xs">
      {said.headline} {said.next}
    </p>
  );
}
