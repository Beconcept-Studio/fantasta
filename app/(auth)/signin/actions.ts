"use server";

import { isDevAuthEnabled, signIn } from "@/lib/auth";

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/" });
}

export async function signInAsDevUser(formData: FormData) {
  if (!isDevAuthEnabled) throw new Error("Il provider dev non è disponibile.");
  const userId = formData.get("userId");
  if (typeof userId !== "string") throw new Error("Utente non valido.");
  await signIn("dev", { userId, redirectTo: "/" });
}
