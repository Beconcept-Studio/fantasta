import { redirect } from "next/navigation";

import { signOutAction } from "@/components/nav/actions";
import { Button } from "@/components/ui/button";
import { currentUser, isVerified } from "@/lib/auth";
import { CODE_TTL_MINUTES } from "@/lib/engine/account-rules";

import { VerifyForm } from "./verify-form";

export const metadata = { title: "Conferma l'indirizzo — Asta Fantacalcio" };

/**
 * Il gradino di mezzo della scala di `requireUser()` (§3).
 *
 * Usa `currentUser()` e non `requireUser()` perché **è** un gradino: chiamare
 * la guardia da qui sarebbe un ciclo di redirect. Ed è l'unica pagina, insieme
 * a `/signin` e `/onboarding`, che ha il diritto di farlo.
 */
export default async function VerifyPage() {
  const user = await currentUser();
  if (!user) redirect("/signin");
  if (isVerified(user)) redirect("/");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Conferma il tuo indirizzo
        </h1>
        {user.email ? (
          <p className="text-muted-foreground text-sm">
            Ho mandato un codice a sei cifre a{" "}
            <span className="text-foreground font-medium">{user.email}</span>.
            Vale {CODE_TTL_MINUTES} minuti.
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            Questo account non ha un indirizzo email a cui mandare il codice:
            serve una mano da chi amministra l&apos;applicazione.
          </p>
        )}
      </header>

      {user.email && <VerifyForm />}

      {/* La via d'uscita: chi ha sbagliato a scrivere l'indirizzo non ha nessun
          altro modo di ricominciare, e senza questo pulsante resterebbe chiuso
          in una pagina che gli chiede un codice che non gli arriverà mai. */}
      <form action={signOutAction} className="border-t pt-6">
        <Button
          type="submit"
          variant="ghost"
          className="text-muted-foreground w-full"
        >
          Esci e usa un altro indirizzo
        </Button>
      </form>
    </main>
  );
}
