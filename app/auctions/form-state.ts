/**
 * Il valore di ritorno delle Server Action del setup.
 *
 * Sta in un file suo e non accanto alle action: **un modulo `"use server"` può
 * esportare soltanto funzioni async**. Esportare da lì anche una costante
 * compila, passa il type-check e passa pure `next build` — poi esplode con un
 * 500 alla prima invocazione vera dell'azione. Tenerla fuori è l'unico modo di
 * non ricascarci.
 */
export type FormState = {
  /** Messaggio d'errore già leggibile, da `lib/engine/errors.ts`. */
  error: string | null;
  /** Conferma dopo un'operazione andata a buon fine. */
  ok?: string | null;
};

export const EMPTY_FORM_STATE: FormState = { error: null };
