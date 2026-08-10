"use client";

import { useActionState } from "react";

import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { FormFeedback } from "@/components/setup/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { resetAction } from "./actions";

/** Deve restare uguale a `PASSWORD_MIN` in `lib/engine/password.ts`. */
const PASSWORD_MIN = 10;

export function ResetForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState(
    resetAction,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="reset-email">Email</Label>
        <Input
          id="reset-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          defaultValue={email}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="reset-code">Codice</Label>
        <Input
          id="reset-code"
          name="code"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder="123456"
          className="text-center text-2xl tracking-[0.4em]"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="reset-password">Password nuova</Label>
        <Input
          id="reset-password"
          name="password"
          type="password"
          required
          minLength={PASSWORD_MIN}
          maxLength={200}
          autoComplete="new-password"
        />
        <p className="text-muted-foreground text-xs">
          Almeno {PASSWORD_MIN} caratteri.
        </p>
      </div>

      <FormFeedback state={state} />

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Cambio la password…" : "Cambia la password ed entra"}
      </Button>
    </form>
  );
}
