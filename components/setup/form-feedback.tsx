import type { FormState } from "@/app/auctions/form-state";

/**
 * Il ritorno di una Server Action, mostrato all'utente.
 *
 * Il messaggio arriva già scritto in italiano da `lib/engine/errors.ts`: qui non
 * si traduce nulla e non si inventa nulla. «Errore» senza spiegazione è
 * inutilizzabile (PLAN §17), quindi se un rifiuto non ha un messaggio decente
 * il posto dove sistemarlo è il codice d'errore, non questo componente.
 */
export function FormFeedback({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
      >
        {state.error}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p
        role="status"
        className="rounded-md border border-emerald-600/40 bg-emerald-600/5 px-3 py-2 text-sm text-emerald-700"
      >
        {state.ok}
      </p>
    );
  }
  return null;
}
