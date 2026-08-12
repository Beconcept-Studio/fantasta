"use client";

import { useActionState } from "react";

import {
  importFromSystemListoneAction,
  importListoneAction,
  toggleOutOfListAction,
} from "@/app/auctions/actions";
import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { FormFeedback } from "@/components/setup/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLES, ROLE_LABELS } from "@/lib/domain";
import type { SlotsByRole } from "@/lib/engine/setup-rules";
import { when } from "@/lib/when";

/**
 * Import del listone e toggle sui fuori lista.
 *
 * La tabellina "disponibili / servono" per ruolo è il cuore del pannello: è la
 * lettura umana dell'invariante I9, e serve a capire *prima* di caricare un file
 * perché una configurazione non passerà.
 *
 * ⚠ **L'upload da file resta anche dopo M10**, su richiesta esplicita
 * dell'owner: serve a correggere un file sbagliato, e a preparare un'asta il
 * giorno in cui a sistema non c'è niente. Accanto c'è il pulsante che copia il
 * listone a sistema — nei due sensi, e quante volte si vuole, finché l'asta non
 * parte.
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
  systemListone,
  notice,
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
  /** `null` quando a sistema non c'è niente: il pulsante non compare affatto. */
  systemListone: { rows: number; uploadedAt: Date } | null;
  /**
   * Il motivo per cui la copia **alla creazione** non è riuscita (M10 §4).
   * L'asta è nata lo stesso, in DRAFT: questa è la frase che glielo spiega.
   */
  notice: string | null;
}) {
  const [importState, importAction, importing] = useActionState(
    importListoneAction,
    EMPTY_FORM_STATE,
  );
  const [systemState, systemAction, copying] = useActionState(
    importFromSystemListoneAction,
    EMPTY_FORM_STATE,
  );
  const [toggleState, toggleAction, toggling] = useActionState(
    toggleOutOfListAction,
    EMPTY_FORM_STATE,
  );

  return (
    <div className="space-y-5">
      {notice !== null && (
        <p
          role="alert"
          className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm"
        >
          <strong>L&apos;asta è stata creata, ma senza listone.</strong> {notice}{" "}
          Puoi cambiare posti o slot qui sotto e riprovare, oppure caricare un
          file tuo.
        </p>
      )}

      {systemListone !== null && (
        <form action={systemAction} className="space-y-3">
          <input type="hidden" name="auctionId" value={auctionId} />
          <div className="space-y-1">
            <p className="text-sm font-medium">Il listone a sistema</p>
            <p className="text-muted-foreground text-xs">
              {systemListone.rows} giocatori, caricati il{" "}
              {when(systemListone.uploadedAt)}. Copiarlo qui dentro sostituisce
              il listone di quest&apos;asta; da quel momento è una copia, e un
              caricamento nuovo in amministrazione non la tocca più.
            </p>
          </div>
          <FormFeedback state={systemState} />
          <Button
            type="submit"
            variant="secondary"
            disabled={!editable || copying}
          >
            {copying ? "Copio…" : "Usa il listone a sistema"}
          </Button>
        </form>
      )}

      <form
        action={importAction}
        className={systemListone !== null ? "space-y-3 border-t pt-4" : "space-y-3"}
      >
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
