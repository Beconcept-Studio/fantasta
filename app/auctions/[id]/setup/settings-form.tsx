"use client";

import { useActionState } from "react";

import { updateSettingsAction } from "@/app/auctions/actions";
import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { AuctionSettingsFields } from "@/components/setup/auction-settings-fields";
import { FormFeedback } from "@/components/setup/form-feedback";
import { Button } from "@/components/ui/button";
import type { AuctionConfig } from "@/lib/engine/setup-rules";

export function SettingsForm({
  auctionId,
  defaults,
  structuralDisabled,
}: {
  auctionId: string;
  defaults: AuctionConfig;
  structuralDisabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    updateSettingsAction,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="auctionId" value={auctionId} />
      <AuctionSettingsFields
        defaults={defaults}
        structuralDisabled={structuralDisabled}
      />
      <FormFeedback state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Salvo…" : "Salva impostazioni"}
      </Button>
    </form>
  );
}
