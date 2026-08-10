"use server";

import { redirect } from "next/navigation";

import type { FormState } from "@/app/auctions/form-state";
import { currentUser } from "@/lib/auth";
import { resendVerificationCode, verifyEmail } from "@/lib/engine/accounts";

/**
 * Le due azioni di `/verify`, **entrambe autenticate**.
 *
 * È la prima delle tre ragioni per cui la verifica è un gradino della scala di
 * `requireUser()` e non un flusso a parte: una sessione esiste già, quindi il
 * reinvio è l'azione di un utente invece di una rotta pubblica da proteggere a
 * mano, e i limiti sono per persona perché *c'è* una persona.
 *
 * Non passano da `lib/rate-limit`: cinque tentativi e sessanta secondi sono già
 * righe nella tabella `email_codes` (§4), e un limite scritto a database
 * sopravvive a un riavvio del processo.
 */
export async function verifyAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const result = await verifyEmail(user.id, formData.get("code"));
  if (!result.ok) return { error: result.error.message };

  // Il gradino dopo è l'onboarding, e a smistare è la radice.
  redirect("/");
}

/**
 * Senza parametri di proposito: non c'è niente da leggere dal form, e uno stato
 * precedente dichiarato e mai usato sarebbe solo una riga in più da spiegare.
 * `useActionState` accetta un'azione che ignora gli argomenti.
 */
export async function resendAction(): Promise<FormState> {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const result = await resendVerificationCode(user.id);
  if (!result.ok) return { error: result.error.message };

  // ⚠ Un invio fallito **non** è un errore da mostrare come tale: l'account
  // esiste, il codice è stato emesso, e la persona non deve rifare niente. Che
  // la posta non sia partita lo dice il log del processo; qui si dice cosa
  // fare, cioè riprovare fra un minuto.
  if (!result.value.mailSent) {
    return {
      error:
        "Non sono riuscito a mandare l'email: riprova fra un minuto. Il tuo account è al sicuro, non devi rifare la registrazione.",
    };
  }
  return { error: null, ok: "Ti ho mandato un codice nuovo: il precedente non vale più." };
}
