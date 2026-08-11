"use client";

import { useActionState } from "react";

import { downloadCampionciniAction } from "@/app/admin/actions";
import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { FormFeedback } from "@/components/setup/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Il form dello scaricamento delle figurine (M7 §7): un file e un pulsante.
 *
 * ⚠ **Non c'è nessuna barra di avanzamento, e non è una dimenticanza.** Il
 * downloader è stato provato sui 495 id di un listone vero prima di essere
 * specificato: 51,56 MB in **7,3 secondi**. Una barra che sale e scende in sette
 * secondi non informa nessuno, e per averla servirebbe tutto ciò che quel
 * collaudo ha tolto — lo scaricamento a lotti, uno stato che sopravvive alla
 * richiesta, una pagina che si richiama da sé. Qui il pulsante dice «Scarico…» e
 * dopo qualche secondo compaiono i numeri.
 *
 * Se un giorno il CDN fosse dieci volte più lento, l'azione si ferma da sé a
 * venti secondi e dice quante ne restano: si ripreme il pulsante e riprende da
 * dov'era. **Il campo del file non si è svuotato**, perché una server action non
 * ricarica la pagina — ed è quello che rende il «ripremi» una cosa che si fa
 * davvero invece di una frase in un messaggio d'errore.
 */
export function CampionciniPanel({ archived }: { archived: number }) {
  const [state, action, running] = useActionState(
    downloadCampionciniAction,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={action} className="max-w-2xl space-y-4">
      <div className="space-y-2">
        <Label htmlFor="file">Listone di riferimento (.xlsx)</Label>
        <Input id="file" name="file" type="file" accept=".xlsx" required />
        <p className="text-muted-foreground text-xs">
          Il file scaricato da Fantacalcio.it, foglio «Lista calciatori». Serve
          solo la colonna <span className="font-mono">#</span> degli
          identificativi: il file non viene conservato, e non ha niente a che
          vedere con il listone di una singola asta — l&apos;archivio è unico per
          tutta l&apos;applicazione e sopravvive alle aste che si cancellano.
        </p>
      </div>

      <FormFeedback state={state} />

      <Button type="submit" disabled={running}>
        {running
          ? "Scarico…"
          : archived === 0
            ? "Scarica le figurine"
            : "Scarica quelle che mancano"}
      </Button>

      <p className="text-muted-foreground text-xs">
        Si può premere quante volte si vuole: viene scaricato solo ciò che non è
        già sul disco. Su un listone intero ci vogliono pochi secondi.
      </p>
    </form>
  );
}
