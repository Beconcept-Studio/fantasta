import { redirect } from "next/navigation";

import { currentUser, isVerified, suggestedDisplayName } from "@/lib/auth";

import { OnboardingForm } from "./onboarding-form";

export const metadata = { title: "Come ti chiami? — Asta Fantacalcio" };

/**
 * Il terzo gradino della scala, e usa `currentUser()` perché **è** un gradino:
 * chiamare `requireUser()` da qui sarebbe un ciclo di redirect.
 *
 * ⚠ Il rimando a `/verify` non è ridondante. Senza, chi digita `/onboarding`
 * nella barra degli indirizzi salterebbe il gradino di mezzo e si scriverebbe
 * il nome per un indirizzo che potrebbe non esistere: la scala vale solo per
 * chi ci passa, e questa pagina è raggiungibile per conto suo.
 */
export default async function OnboardingPage() {
  const user = await currentUser();
  if (!user) redirect("/signin");
  if (!isVerified(user)) redirect("/verify");
  if (user.displayName) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Come ti chiami?
        </h1>
        <p className="text-muted-foreground text-sm">
          Prima di entrare serve il tuo nome e cognome.
        </p>
      </header>

      <OnboardingForm suggestedName={await suggestedDisplayName()} />
    </main>
  );
}
