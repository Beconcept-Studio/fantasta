"use client";

import { useActionState } from "react";

import { removeMemberAction } from "@/app/auctions/actions";
import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { FormFeedback } from "@/components/setup/form-feedback";
import { Button } from "@/components/ui/button";

/** Uscire da un'asta si può solo prima che parta (PLAN §17). */
export function LeaveButton({ memberId }: { memberId: string }) {
  const [state, formAction, pending] = useActionState(
    removeMemberAction,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="memberId" value={memberId} />
      <FormFeedback state={state} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? "Esco…" : "Esci da quest'asta"}
      </Button>
    </form>
  );
}
