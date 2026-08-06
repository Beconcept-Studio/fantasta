"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { type OnboardingState, saveDisplayName } from "./actions";

const initialState: OnboardingState = {};

export function OnboardingForm({ suggestedName }: { suggestedName: string }) {
  const [state, formAction, pending] = useActionState(
    saveDisplayName,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="displayName" className="text-sm font-medium">
          Nome e cognome
        </label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          required
          minLength={3}
          maxLength={60}
          autoComplete="name"
          defaultValue={suggestedName}
          placeholder="Mario Rossi"
          className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-11 w-full rounded-md border px-3 py-2 text-base focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        />
        <p className="text-muted-foreground text-xs">
          È il nome con cui ti vedono gli altri partecipanti. Il nome della
          squadra si sceglie invece quando entri in un&apos;asta.
        </p>
      </div>

      {state.error && (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Salvo…" : "Continua"}
      </Button>
    </form>
  );
}
