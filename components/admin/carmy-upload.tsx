"use client";

import { useActionState } from "react";

import { uploadCarmyAction } from "@/app/admin/actions";
import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { FormFeedback } from "@/components/setup/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Il caricamento del foglio di Carmy (M10B §8).
 *
 * ⚠ **Sta sotto quello del listone perché va dato dopo**, e l'ordine non è una
 * preferenza: il foglio non ha `ext_id`, si aggancia al listone **per nome**, e
 * senza listone non c'è niente a cui agganciarsi. Il pulsante è spento finché il
 * listone non c'è — e questo è un gate *vero*, a differenza di quello che M10 §5
 * aveva scelto di non mettere sugli insight: qui il caricamento fallirebbe
 * davvero, quindi un pulsante attivo sarebbe la bugia.
 *
 * ⚠ **Sostituisce tutto**, come il listone e a differenza delle due fonti di M8
 * che fanno `upsert` per colonna: un giudizio ritirato deve poter sparire.
 */
export function CarmyUpload({
  rows,
  listoneRows,
}: {
  rows: number;
  listoneRows: number;
}) {
  const [state, action, running] = useActionState(
    uploadCarmyAction,
    EMPTY_FORM_STATE,
  );
  const senzaListone = listoneRows === 0;

  return (
    <form action={action} className="max-w-2xl space-y-4">
      <div className="space-y-2">
        <Label htmlFor="carmy">Foglio di Carmy (.xlsx)</Label>
        <Input
          id="carmy"
          name="file"
          type="file"
          accept=".xlsx"
          required
          disabled={senzaListone}
        />
        <p className="text-muted-foreground text-xs">
          Quattro fogli <span className="font-mono">P</span>,{" "}
          <span className="font-mono">D</span>,{" "}
          <span className="font-mono">C</span>,{" "}
          <span className="font-mono">A</span>, con fascia, titolarità,
          affidabilità, integrità, prezzo consigliato e note. Porta{" "}
          <strong>un giudizio</strong>, non delle statistiche: le colonne di
          numeri sono le stesse che importiamo già dalla fonte pubblica. Si
          aggancia al listone <strong>per nome</strong>, quindi va caricato{" "}
          <strong>dopo</strong>; il file non viene conservato.
        </p>
        {senzaListone && (
          <p className="text-muted-foreground text-xs">
            Prima va caricato il listone qui sopra: è la lista di nomi a cui
            questo foglio si aggancia.
          </p>
        )}
      </div>

      <FormFeedback state={state} />

      <Button type="submit" disabled={running || senzaListone}>
        {running
          ? "Carico…"
          : rows === 0
            ? "Carica il foglio"
            : "Sostituisci il foglio"}
      </Button>
    </form>
  );
}
