import { redirect } from "next/navigation";

import { currentUser, suggestedDisplayName } from "@/lib/auth";

import { OnboardingForm } from "./onboarding-form";

export const metadata = { title: "Come ti chiami? — Asta Fantacalcio" };

export default async function OnboardingPage() {
  const user = await currentUser();
  if (!user) redirect("/signin");
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
