"use client";

import { useActionState, useState } from "react";

import { fillWithBotsAction } from "@/app/auctions/actions";
import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { FormFeedback } from "@/components/setup/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BOT_FILL_MIX,
  BOT_STRATEGIES,
  BOT_STRATEGY_LABELS,
  type BotFill,
} from "@/lib/domain";

/**
 * I partecipanti simulati (M4).
 *
 * Sta accanto agli inviti perché è la stessa domanda — «come riempio i posti?»
 * — e compare **solo su un'asta simulata**. Non è la difesa: quella è
 * `fillWithBots`, che rifiuta comunque un'asta reale (regola 6). Questa è la
 * ragione per cui la domanda non ti viene nemmeno in mente quando sei nella
 * configurazione dell'asta vera.
 */

const OPTIONS: { value: BotFill; label: string; hint: string }[] = [
  { value: BOT_FILL_MIX, label: "Misto", hint: "Come una stanza vera" },
  ...BOT_STRATEGIES.map((strategy) => ({
    value: strategy as BotFill,
    label: BOT_STRATEGY_LABELS[strategy],
    hint:
      strategy === "tie"
        ? "Tutti sulla stessa cifra: fa scattare lo spareggio"
        : strategy === "aggressive"
          ? "Sempre il massimo che possono"
          : strategy === "passive"
            ? "Sempre il minimo del round"
            : "Importi verosimili",
  })),
];

export function BotsPanel({
  auctionId,
  freeSeats,
  editable,
}: {
  auctionId: string;
  freeSeats: number;
  editable: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    fillWithBotsAction,
    EMPTY_FORM_STATE,
  );
  const [fill, setFill] = useState<BotFill>(BOT_FILL_MIX);

  if (freeSeats === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        I posti sono pieni. L&apos;asta si avvia dalla regia: i bot risultano
        collegati da soli, non serve aspettarli.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="auctionId" value={auctionId} />
      <input type="hidden" name="fill" value={fill} />

      <div className="space-y-2">
        <Label htmlFor="count">Quanti</Label>
        <Input
          id="count"
          name="count"
          type="number"
          min={1}
          max={freeSeats}
          defaultValue={freeSeats}
          className="w-24"
          disabled={!editable}
        />
        <p className="text-muted-foreground text-sm">
          {freeSeats === 1
            ? "Resta un posto libero."
            : `Restano ${freeSeats} posti liberi.`}{" "}
          Lasciane uno per te se vuoi giocare: entra da «Partecipa anche tu»
          qui sopra.
        </p>
      </div>

      <fieldset className="space-y-2" disabled={!editable}>
        <legend className="text-sm font-medium">Come offrono</legend>
        <div className="flex flex-wrap gap-2">
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFill(option.value)}
              aria-pressed={fill === option.value}
              title={option.hint}
              className={
                fill === option.value
                  ? "bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium"
                  : "text-muted-foreground hover:bg-muted rounded-md border px-3 py-1.5 text-sm transition"
              }
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="text-muted-foreground text-sm">
          {OPTIONS.find((option) => option.value === fill)?.hint}
        </p>
      </fieldset>

      <FormFeedback state={state} />
      <Button type="submit" variant="outline" size="sm" disabled={!editable || pending}>
        {pending ? "Aggiungo…" : "Riempi con i bot"}
      </Button>
    </form>
  );
}
