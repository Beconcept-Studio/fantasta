"use client";

import { useActionState } from "react";

import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { FormFeedback } from "@/components/setup/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { forgotAction } from "./actions";

export function ForgotForm() {
  const [state, formAction, pending] = useActionState(
    forgotAction,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="forgot-email">Email</Label>
        <Input
          id="forgot-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="mario@example.com"
        />
      </div>

      <FormFeedback state={state} />

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Mando…" : "Mandami il codice"}
      </Button>
    </form>
  );
}
