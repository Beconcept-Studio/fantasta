"use client";

import { useActionState, useState } from "react";

import { createAuctionAction } from "@/app/auctions/actions";
import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { AuctionSettingsFields } from "@/components/setup/auction-settings-fields";
import { FormFeedback } from "@/components/setup/form-feedback";
import { Button } from "@/components/ui/button";
import type { AuctionConfig } from "@/lib/engine/setup-rules";
import { cn } from "@/lib/utils";
import { when } from "@/lib/when";

/** Cosa c'è a sistema, per la proposta. `null` quando non c'è niente. */
export type SystemListone = { rows: number; uploadedAt: Date };

export function CreateAuctionForm({
  defaults,
  canSimulate,
  systemListone,
}: {
  defaults: AuctionConfig;
  /** Vero solo per un amministratore dell'applicazione (M4). */
  canSimulate: boolean;
  /**
   * ⚠ **`null` quando a sistema non c'è niente, e allora la scelta non compare
   * affatto** — non compare disabilitata (M10 §4). Una scelta spenta fra due
   * opzioni di cui una non esiste è una domanda a cui si può rispondere in un
   * modo solo, cioè non una domanda.
   */
  systemListone: SystemListone | null;
}) {
  const [state, formAction, pending] = useActionState(
    createAuctionAction,
    EMPTY_FORM_STATE,
  );
  const [useSystem, setUseSystem] = useState(true);

  return (
    <form action={formAction} className="space-y-6">
      <AuctionSettingsFields defaults={defaults} />

      {/*
        La proposta del listone a sistema (M10 §4). **La data è il punto della
        richiesta** — «si indica data di ultimo aggiornamento così può decidere
        se vuole usare quello» — ed è resa in `Europe/Rome` perché il server gira
        in UTC: senza il fuso un caricamento delle 23:30 comparirebbe come del
        giorno prima, e farebbe scartare un listone buono.
      */}
      {systemListone !== null && (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">
            Il listone di quest&apos;asta
          </legend>
          <input
            type="hidden"
            name="useSystemListone"
            value={useSystem ? "yes" : "no"}
          />

          <ListoneChoice
            selected={useSystem}
            onSelect={() => setUseSystem(true)}
            title="Il listone a sistema"
            description={`${systemListone.rows} giocatori · caricato il ${when(systemListone.uploadedAt)}`}
          />
          <ListoneChoice
            selected={!useSystem}
            onSelect={() => setUseSystem(false)}
            title="Lo carico io"
            description="Il file .xlsx, dalla configurazione dell'asta"
          />

          <p className="text-muted-foreground text-xs">
            In ogni caso potrai sostituirlo dalla configurazione, finché
            l&apos;asta non parte.
          </p>
        </fieldset>
      )}

      {/*
        La casella c'è solo per un amministratore, e `createAuction` rilegge
        comunque il permesso dal database (regola 6). ⚠ Si decide **qui e mai
        più**: nessuna schermata la cambia dopo, ed è quello che rende
        impossibile che dei bot finiscano in un'asta vera.
      */}
      {canSimulate ? (
        <label className="border-input flex cursor-pointer items-start gap-3 rounded-md border p-4">
          <input
            type="checkbox"
            name="isSimulated"
            className="mt-1 size-4 accent-current"
          />
          <span className="space-y-1">
            <span className="block text-sm font-medium">Asta simulata</span>
            <span className="text-muted-foreground block text-sm">
              Un&apos;asta di prova, i cui posti liberi si riempiono di bot dalla
              configurazione. Non si potrà cambiare idea dopo.
            </span>
          </span>
        </label>
      ) : null}

      <FormFeedback state={state} />
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Creo…" : "Crea l'asta"}
      </Button>
    </form>
  );
}

/**
 * Una delle due alternative. È un `<label>` con dentro un radio vero, non un
 * `<div onClick>`: si seleziona con le frecce, si legge da uno screen reader, e
 * il click sull'intero riquadro funziona perché è un `<label>` — tre cose che un
 * div avrebbe richiesto di riscrivere a mano.
 */
function ListoneChoice({
  selected,
  onSelect,
  title,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-md border p-4 transition",
        selected ? "border-foreground bg-muted/50" : "border-input",
      )}
    >
      <input
        type="radio"
        name="listoneChoice"
        checked={selected}
        onChange={onSelect}
        className="mt-1 size-4 accent-current"
      />
      <span className="space-y-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="text-muted-foreground block text-sm">
          {description}
        </span>
      </span>
    </label>
  );
}
