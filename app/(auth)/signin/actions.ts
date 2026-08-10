"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type { FormState } from "@/app/auctions/form-state";
import { isDevAuthEnabled, signIn } from "@/lib/auth";
import {
  LOGIN_BY_EMAIL,
  LOGIN_BY_IP,
  clientIp,
  hit,
  reset,
} from "@/lib/rate-limit";

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/" });
}

export async function signInAsDevUser(formData: FormData) {
  if (!isDevAuthEnabled) throw new Error("Il provider dev non è disponibile.");
  const userId = formData.get("userId");
  if (typeof userId !== "string") throw new Error("Utente non valido.");
  await signIn("dev", { userId, redirectTo: "/" });
}

/**
 * L'ingresso con email e password (M5).
 *
 * Il rate limit sta **qui e non dentro `authorize`** per una ragione pratica:
 * qui ci sono gli header della richiesta, quindi l'IP, e c'è un valore di
 * ritorno con cui dire *quanto* aspettare. Un `authorize` che restituisce
 * `null` sa dire soltanto «no».
 *
 * Si conta **ogni** tentativo e si azzera al successo: contare solo i falliti
 * darebbe lo stesso numero con una riga in più. Senza l'azzeramento, dieci
 * password sbagliate sparse in un quarto d'ora chiuderebbero fuori chi poi se
 * l'è ricordata — che è il caso normale, non l'attacco.
 */
export async function signInWithPassword(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  const ip = clientIp(await headers());
  const byIp = hit(`login:ip:${ip}`, LOGIN_BY_IP.limit, LOGIN_BY_IP.windowSeconds);
  if (!byIp.allowed) return { error: waitMessage(byIp.retryAfterSeconds) };

  const emailKey = `login:email:${email}`;
  const byEmail = hit(
    emailKey,
    LOGIN_BY_EMAIL.limit,
    LOGIN_BY_EMAIL.windowSeconds,
  );
  if (!byEmail.allowed) return { error: waitMessage(byEmail.retryAfterSeconds) };

  try {
    await signIn("email", { email, password, redirect: false });
  } catch (error) {
    // `AuthError` è il rifiuto previsto (credenziali sbagliate). Tutto il resto
    // è un bug vero e deve arrivare alla pagina d'errore, non finire ingoiato
    // in un «email o password non corretti» che manderebbe fuori strada.
    if (error instanceof AuthError) {
      return { error: "Email o password non corretti." };
    }
    throw error;
  }

  reset(emailKey);
  // La radice smista: `/verify` se manca la verifica, `/onboarding` se manca il
  // nome, `/dashboard` altrimenti. Una sola scala, in un posto solo.
  redirect("/");
}

function waitMessage(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1
    ? "Troppi tentativi: riprova fra un minuto."
    : `Troppi tentativi: riprova fra ${minutes} minuti.`;
}
