import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { currentUser, isDevAuthEnabled, listDevUsers } from "@/lib/auth";

import { signInAsDevUser, signInWithGoogle } from "./actions";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Entra — Asta Fantacalcio" };

export default async function SignInPage() {
  if (await currentUser()) redirect("/");

  const devUsers = await listDevUsers();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Asta Fantacalcio
        </h1>
        <p className="text-muted-foreground text-sm">
          Entra per creare o partecipare a un&apos;asta.
        </p>
      </header>

      {/* Google resta in cima: è la strada di chi c'era già, ed è quella che
          non chiede di ricordarsi niente. */}
      <form action={signInWithGoogle}>
        <Button type="submit" className="w-full" size="lg">
          Entra con Google
        </Button>
      </form>

      <div className="flex items-center gap-3">
        <span className="bg-border h-px flex-1" />
        <span className="text-muted-foreground text-xs uppercase">oppure</span>
        <span className="bg-border h-px flex-1" />
      </div>

      <PasswordForm />

      {isDevAuthEnabled && (
        <section className="space-y-3 border-t pt-6">
          <h2 className="text-sm font-medium">Accesso di sviluppo</h2>
          <p className="text-muted-foreground text-xs">
            Solo fuori produzione. Serve a collaudare un&apos;asta a 8 senza
            avere 8 account Google.
          </p>
          {devUsers.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              Nessun utente di prova a database. Esegui{" "}
              <code className="font-mono">pnpm db:seed</code>.
            </p>
          ) : (
            <ul className="grid gap-2">
              {devUsers.map((user) => (
                <li key={user.id}>
                  <form action={signInAsDevUser}>
                    <input type="hidden" name="userId" value={user.id} />
                    <Button
                      type="submit"
                      variant="outline"
                      className="w-full justify-start"
                    >
                      Entra come {user.displayName}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
