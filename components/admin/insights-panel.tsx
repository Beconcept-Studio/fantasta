"use client";

import { useActionState } from "react";

import {
  refreshListoneInsightsAction,
  refreshSetPiecesAction,
} from "@/app/admin/actions";
import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { FormFeedback } from "@/components/setup/form-feedback";
import { Button } from "@/components/ui/button";

/**
 * I due pulsanti degli insight (M8 §7).
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
 */
export function InsightsPanel({ rows }: { rows: number }) {
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
