"use client";

import { useActionState } from "react";

import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { FormFeedback } from "@/components/setup/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { registerAction } from "./actions";

/** Deve restare uguale a `PASSWORD_MIN` in `lib/engine/password.ts`. */
const PASSWORD_MIN = 10;

/**
 * ⚠ **Solo email e password.** Il nome non si chiede qui: lo si scrive
 * nell'onboarding, che è l'unico posto in cui si è sempre scritto (§3). Due
 * schermate che chiedono la stessa cosa sono due schermate che prima o poi
 * dicono cose diverse.
 */
export function SignUpForm() {
  const [state, formAction, pending] = useActionState(
    registerAction,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="signup-email">Email</Label>
        <Input
          id="signup-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="mario@example.com"
        />
        <p className="text-muted-foreground text-xs">
          Ci mandiamo un codice a sei cifre: dev&apos;essere un indirizzo che
          leggi adesso.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="signup-password">Password</Label>
        {/* `minLength` fa scoprire la regola prima di premere invio; il server
            rifiuta comunque (regola 6). */}
        <Input
          id="signup-password"
          name="password"
          type="password"
          required
          minLength={PASSWORD_MIN}
          maxLength={200}
          autoComplete="new-password"
        />
        <p className="text-muted-foreground text-xs">
          Almeno {PASSWORD_MIN} caratteri. Nessuna regola su maiuscole o
          simboli: la lunghezza conta di più.
        </p>
      </div>

      <FormFeedback state={state} />

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Creo l'account…" : "Crea l'account"}
      </Button>
    </form>
  );
}
