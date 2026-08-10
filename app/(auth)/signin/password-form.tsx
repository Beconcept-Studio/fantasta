"use client";

import Link from "next/link";
import { useActionState } from "react";

import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { FormFeedback } from "@/components/setup/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { signInWithPassword } from "./actions";

/**
 * Il form di ingresso con email e password. Mobile-first come tutto il resto:
 * campi alti, `autoComplete` giusti perché il gestore di password del telefono
 * li riconosca, e nessuna colonna da rincorrere in orizzontale.
 */
export function PasswordForm() {
  const [state, formAction, pending] = useActionState(
    signInWithPassword,
    EMPTY_FORM_STATE,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="signin-email">Email</Label>
        <Input
          id="signin-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="mario@example.com"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="signin-password">Password</Label>
        <Input
          id="signin-password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />
      </div>

      <FormFeedback state={state} />

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Entro…" : "Entra"}
      </Button>

      <div className="flex items-center justify-between text-sm">
        <Link
          href="/forgot"
          className="text-muted-foreground hover:text-foreground"
        >
          Password dimenticata
        </Link>
        <Link href="/signup" className="font-medium hover:underline">
          Crea un account
        </Link>
      </div>
    </form>
  );
}
