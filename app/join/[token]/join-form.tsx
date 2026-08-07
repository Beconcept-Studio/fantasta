"use client";

import { useActionState } from "react";

import { joinAuctionAction } from "@/app/auctions/actions";
import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { FormFeedback } from "@/components/setup/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function JoinForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(
    joinAuctionAction,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <div className="space-y-2">
        <Label htmlFor="teamName">Nome della tua squadra</Label>
        <Input
          id="teamName"
          name="teamName"
          required
          minLength={3}
          maxLength={60}
          autoComplete="off"
          placeholder="Real Fantozzi"
        />
        <p className="text-muted-foreground text-xs">
          Vale solo per quest&apos;asta: in un&apos;altra lega puoi chiamarti
          diversamente.
        </p>
      </div>
      <FormFeedback state={state} />
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Entro…" : "Entra nell'asta"}
      </Button>
    </form>
  );
}
