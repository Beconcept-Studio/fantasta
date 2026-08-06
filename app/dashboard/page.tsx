import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";

import { signOutAction } from "./actions";

export const metadata = { title: "Le tue aste — Asta Fantacalcio" };

export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-8 p-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Le tue aste</h1>
          <p className="text-muted-foreground text-sm">
            Ciao {user.displayName}.
          </p>
        </div>
        <form action={signOutAction}>
          <Button type="submit" variant="outline" size="sm">
            Esci
          </Button>
        </form>
      </header>

      <section className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-muted-foreground text-sm">
          Non c&apos;è ancora niente qui: la creazione delle aste arriva con la
          Fase 1.
        </p>
      </section>
    </main>
  );
}
