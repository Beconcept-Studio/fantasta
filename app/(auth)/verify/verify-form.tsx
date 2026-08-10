"use client";

import { useActionState } from "react";

import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { FormFeedback } from "@/components/setup/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { resendAction, verifyAction } from "./actions";

/**
 * Il codice a sei cifre, dal telefono.
 *
 * `inputMode="numeric"` e `autoComplete="one-time-code"` non sono cosmetici:
 * fanno uscire il tastierino invece della tastiera, e su iOS fanno comparire il
 * codice appena arrivato sopra la tastiera stessa. Si digita in piedi, accanto
 * alla TV, con qualcuno che aspetta.
 */
export function VerifyForm() {
  const [state, formAction, pending] = useActionState(
    verifyAction,
    EMPTY_FORM_STATE,
  );
  const [resendState, resendFormAction, resending] = useActionState(
    resendAction,
    EMPTY_FORM_STATE,
  );

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="code">Codice</Label>
          <Input
            id="code"
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

        <FormFeedback state={state} />

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? "Controllo…" : "Conferma"}
        </Button>
      </form>

      {/* Nessun rifiuto è un vicolo cieco: qualunque cosa dica il messaggio
          sopra — sbagliato, scaduto, bruciato — questo pulsante è sempre lì. */}
      <form action={resendFormAction} className="space-y-3 border-t pt-6">
        <FormFeedback state={resendState} />
        <Button
          type="submit"
          variant="outline"
          className="w-full"
          disabled={resending}
        >
          {resending ? "Mando…" : "Mandami un altro codice"}
        </Button>
      </form>
    </div>
  );
}
