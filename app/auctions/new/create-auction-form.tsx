"use client";

import { useActionState } from "react";

import { createAuctionAction } from "@/app/auctions/actions";
import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { AuctionSettingsFields } from "@/components/setup/auction-settings-fields";
import { FormFeedback } from "@/components/setup/form-feedback";
import { Button } from "@/components/ui/button";
import type { AuctionConfig } from "@/lib/engine/setup-rules";

export function CreateAuctionForm({ defaults }: { defaults: AuctionConfig }) {
  const [state, formAction, pending] = useActionState(
    createAuctionAction,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-6">
      <AuctionSettingsFields defaults={defaults} />
      <FormFeedback state={state} />
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Creo…" : "Crea l'asta"}
      </Button>
    </form>
  );
}
