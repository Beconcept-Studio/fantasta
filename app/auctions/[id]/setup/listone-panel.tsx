"use client";

import { useActionState } from "react";

import { importListoneAction, toggleOutOfListAction } from "@/app/auctions/actions";
import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { FormFeedback } from "@/components/setup/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLES, ROLE_LABELS } from "@/lib/domain";
import type { SlotsByRole } from "@/lib/engine/setup-rules";

/**
 * Import del listone e toggle sui fuori lista.
 *
 * La tabellina "disponibili / servono" per ruolo è il cuore del pannello: è la
 * lettura umana dell'invariante I9, e serve a capire *prima* di caricare un file
 * perché una configurazione non passerà.
 */
export function ListonePanel({
  auctionId,
  listoneSize,
  outOfListCount,
  includeOutOfList,
  pool,
  slots,
  seats,
  poolProblem,
  editable,
}: {
  auctionId: string;
  listoneSize: number;
  outOfListCount: number;
  includeOutOfList: boolean;
  pool: Record<string, number>;
  slots: SlotsByRole;
  seats: number;
  poolProblem: string | null;
  editable: boolean;
}) {
  const [importState, importAction, importing] = useActionState(
    importListoneAction,
    EMPTY_FORM_STATE,
  );
  const [toggleState, toggleAction, toggling] = useActionState(
    toggleOutOfListAction,
    EMPTY_FORM_STATE,
  );

  return (
    <div className="space-y-5">
      <form action={importAction} className="space-y-3">
        <input type="hidden" name="auctionId" value={auctionId} />
        <div className="space-y-2">
          <Label htmlFor="file">File del listone (.xlsx)</Label>
          <Input
            id="file"
            name="file"
            type="file"
            accept=".xlsx"
            required
            disabled={!editable}
          />
          <p className="text-muted-foreground text-xs">
            Il file scaricato da Fantacalcio.it, foglio «Lista calciatori». Il
            file non viene conservato: ne teniamo solo i dati, congelati dentro
            quest&apos;asta. Un nuovo caricamento sostituisce il precedente.
          </p>
        </div>
        <FormFeedback state={importState} />
        <Button type="submit" disabled={!editable || importing}>
          {importing ? "Importo…" : listoneSize > 0 ? "Sostituisci listone" : "Importa listone"}
        </Button>
      </form>

      {listoneSize > 0 && (
        <>
          <div className="space-y-2">
            <p className="text-sm">
              <strong>{listoneSize}</strong> giocatori importati, di cui{" "}
              <strong>{outOfListCount}</strong> fuori lista.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-xs">
                  <tr className="border-b">
                    <th className="py-2 text-left font-medium">Ruolo</th>
                    <th className="py-2 text-right font-medium">Disponibili</th>
                    <th className="py-2 text-right font-medium">Servono</th>
                  </tr>
                </thead>
                <tbody>
                  {ROLES.map((role) => {
                    const needed = slots[role] * seats;
                    const available = pool[role] ?? 0;
                    const short = available < needed;
                    return (
                      <tr key={role} className="border-b last:border-0">
                        <td className="py-2">
                          {ROLE_LABELS[role]}{" "}
                          <span className="text-muted-foreground font-mono text-xs">
                            ({role})
                          </span>
                        </td>
                        <td
                          className={`py-2 text-right tabular-nums ${
                            short ? "text-destructive font-semibold" : ""
                          }`}
                        >
                          {available}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {needed}
                          <span className="text-muted-foreground ml-1 text-xs">
                            ({slots[role]}×{seats})
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {poolProblem && (
              <p
                role="alert"
                className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
              >
                {poolProblem}
              </p>
            )}
          </div>

          <form action={toggleAction} className="space-y-3 border-t pt-4">
            <input type="hidden" name="auctionId" value={auctionId} />
            <input
              type="hidden"
              name="include"
              value={String(!includeOutOfList)}
            />
            <div className="space-y-1">
              <p className="text-sm font-medium">
                Giocatori fuori lista:{" "}
                {includeOutOfList ? "nel pool" : "esclusi dal pool"}
              </p>
              <p className="text-muted-foreground text-xs">
                Sono i {outOfListCount} marcati con l&apos;asterisco nel file.
                Esclusi di default. Il cambio viene rifiutato se lascerebbe un
                ruolo senza abbastanza giocatori.
              </p>
            </div>
            <FormFeedback state={toggleState} />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={!editable || toggling}
            >
              {includeOutOfList ? "Escludili dal pool" : "Includili nel pool"}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
