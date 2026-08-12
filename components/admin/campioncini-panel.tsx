"use client";

import { useActionState } from "react";

import { downloadCampionciniAction } from "@/app/admin/actions";
import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { FormFeedback } from "@/components/setup/form-feedback";
import { Button } from "@/components/ui/button";

/**
 * Lo scaricamento delle caricature (M7 §7): **un pulsante**.
 *
 * ⚠ **Da M10 non c'è più il campo del file.** Gli id arrivano dal listone a
 * sistema, che è la dipendenza vera di questo blocco — e quindi anche l'unico
 * posto del pannello dove un gate ha senso: senza un elenco di `ext_id` qui non
 * c'è niente da scaricare. Il pulsante accanto, quello degli insight, resta
 * **sempre attivo**, perché le sue due fonti non sanno che esistiamo (M10 §5).
 *
 * ⚠ **Non c'è nessuna barra di avanzamento, e non è una dimenticanza.** Il
 * downloader è stato provato sui 495 id di un listone vero prima di essere
 * specificato: 51,56 MB in **7,3 secondi**. Una barra che sale e scende in sette
 * secondi non informa nessuno, e per averla servirebbe tutto ciò che quel
 * collaudo ha tolto — lo scaricamento a lotti, uno stato che sopravvive alla
 * richiesta, una pagina che si richiama da sé.
 *
 * Se un giorno il CDN fosse dieci volte più lento, l'azione si ferma da sé a
 * venti secondi e dice quante ne restano: si ripreme il pulsante e riprende da
 * dov'era — lo stato è il disco, non una sessione.
 */
export function CampionciniPanel({
  archived,
  listoneRows,
}: {
  archived: number;
  /** Zero = niente da scaricare: è il gate, ed è l'unico vero della pagina. */
  listoneRows: number;
}) {
  const [state, action, running] = useActionState(
    downloadCampionciniAction,
    EMPTY_FORM_STATE,
  );

  const gated = listoneRows === 0;

  return (
    <form action={action} className="space-y-3">
      <div>
        <h2 className="font-medium">Caricature dei calciatori</h2>
        <p className="text-muted-foreground text-xs">
          Le figurine del CDN di Fantacalcio.it, una per{" "}
          <span className="font-mono">ext_id</span> del listone a sistema. Si può
          premere quante volte si vuole: viene scaricato solo ciò che non è già
          sul disco.
        </p>
      </div>

      <FormFeedback state={state} />

      <Button type="submit" disabled={running || gated}>
        {running
          ? "Scarico…"
          : archived === 0
            ? "Scarica le caricature"
            : "Scarica quelle che mancano"}
      </Button>

      {/* La ragione sta **accanto al pulsante spento**, non in una nota in fondo
          alla pagina: un pulsante disabilitato senza il suo perché è un guasto. */}
      {gated && (
        <p className="text-muted-foreground text-xs">
          Serve prima il listone: gli identificativi da scaricare vengono da lì.
        </p>
      )}
    </form>
  );
}
