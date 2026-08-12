"use client";

import { useActionState } from "react";

import { uploadListoneAction } from "@/app/admin/actions";
import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { FormFeedback } from "@/components/setup/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Il caricamento del listone a sistema (M10 §2).
 *
 * ⚠ **È l'export «Leghe», non il file «Quotazioni»**, e la differenza non è
 * pignoleria: solo il primo ha la colonna `Fuori lista`, da cui dipendono I9 e il
 * toggle sui fuori lista. Il secondo è pubblico e si scaricherebbe da sé — è
 * esattamente per questo che qualcuno, un giorno, proverà a usarlo.
 *
 * ⚠ **Un caricamento sostituisce tutto**, come l'import dentro un'asta: è l'unico
 * modo di correggere un file sbagliato senza inventare un merge fra due listoni.
 * Le aste già preparate **non cambiano**: quelle si portano dentro la loro copia,
 * congelata al momento in cui l'hanno presa.
 */
export function ListoneUpload({ rows }: { rows: number }) {
  const [state, action, running] = useActionState(
    uploadListoneAction,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={action} className="max-w-2xl space-y-4">
      <div className="space-y-2">
        <Label htmlFor="file">Listone di quest&apos;anno (.xlsx)</Label>
        <Input id="file" name="file" type="file" accept=".xlsx" required />
        <p className="text-muted-foreground text-xs">
          L&apos;export <strong>Leghe</strong> di Fantacalcio.it, foglio «Lista
          calciatori» — quello con la colonna{" "}
          <span className="font-mono">Fuori lista</span>. Il file non viene
          conservato: ne teniamo solo i dati. Un nuovo caricamento sostituisce
          quello a sistema e <strong>non tocca le aste già preparate</strong>,
          che si portano dentro la loro copia.
        </p>
      </div>

      <FormFeedback state={state} />

      <Button type="submit" disabled={running}>
        {running
          ? "Carico…"
          : rows === 0
            ? "Carica il listone"
            : "Sostituisci il listone"}
      </Button>
    </form>
  );
}
