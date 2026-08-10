import { redirect } from "next/navigation";

import { currentUser, isVerified } from "@/lib/auth";

/**
 * La radice: smista e basta. Rifà i gradini di `requireUser()` a mano invece di
 * chiamarlo perché l'ultimo passo è `/dashboard` e non «questa pagina» — ma i
 * gradini sono gli stessi e **nello stesso ordine**, verifica compresa (M5 §3).
 */
export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/signin");
  if (!isVerified(user)) redirect("/verify");
  if (!user.displayName) redirect("/onboarding");
  redirect("/dashboard");
}
