"use server";

import { redirect } from "next/navigation";

import { currentUser, isVerified, setDisplayName } from "@/lib/auth";

export type OnboardingState = { error?: string };

export async function saveDisplayName(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const user = await currentUser();
  if (!user) redirect("/signin");
  // Regola 6: la pagina ha già mandato via chi non è verificato, e il server
  // rifiuta comunque — una server action è una rotta come tutte le altre.
  if (!isVerified(user)) redirect("/verify");

  const displayName = formData.get("displayName");
  if (typeof displayName !== "string") {
    return { error: "Scrivi nome e cognome." };
  }

  // La validazione vera è quella del server: il form la duplica solo per UX.
  const ok = await setDisplayName(user.id, displayName);
  if (!ok) {
    return { error: "Serve nome e cognome, fra 3 e 60 caratteri." };
  }

  redirect("/dashboard");
}
