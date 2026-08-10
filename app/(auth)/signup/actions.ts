"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type { FormState } from "@/app/auctions/form-state";
import { signIn } from "@/lib/auth";
import { registerWithPassword } from "@/lib/engine/accounts";
import { SIGNUP_BY_IP, clientIp, hit } from "@/lib/rate-limit";

/**
 * La registrazione: crea l'account, prova a mandare il codice, apre la
 * sessione e lascia la persona su `/verify`.
 *
 * **Il login subito dopo non è una comodità, è ciò che rende la verifica un
 * gradino della scala** invece di un flusso a parte con un token suo (§3): da
 * `/verify` in poi esiste un utente, quindi il reinvio è un'azione autenticata
 * e il conto dei tentativi è per persona, non per indirizzo IP indovinato.
 */
export async function registerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const ip = clientIp(await headers());
  const verdict = hit(
    `signup:ip:${ip}`,
    SIGNUP_BY_IP.limit,
    SIGNUP_BY_IP.windowSeconds,
  );
  if (!verdict.allowed) {
    return {
      error:
        "Troppi account creati da qui: riprova fra un'ora, oppure entra con Google.",
    };
  }

  const result = await registerWithPassword({ email, password });
  if (!result.ok) return { error: result.error.message };

  // La password appena scritta è quella giusta per definizione: si entra senza
  // farla riscrivere. `redirect: false` perché il redirect lo facciamo noi.
  await signIn("email", { email: result.value.email, password, redirect: false });
  redirect("/verify");
}
