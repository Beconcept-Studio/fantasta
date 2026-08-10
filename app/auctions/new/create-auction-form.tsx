"use client";

import { useActionState } from "react";

import { createAuctionAction } from "@/app/auctions/actions";
import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { AuctionSettingsFields } from "@/components/setup/auction-settings-fields";
import { FormFeedback } from "@/components/setup/form-feedback";
import { Button } from "@/components/ui/button";
import type { AuctionConfig } from "@/lib/engine/setup-rules";

export function CreateAuctionForm({
  defaults,
  canSimulate,
}: {
  defaults: AuctionConfig;
  /** Vero solo per un amministratore dell'applicazione (M4). */
  canSimulate: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    createAuctionAction,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-6">
      <AuctionSettingsFields defaults={defaults} />

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
