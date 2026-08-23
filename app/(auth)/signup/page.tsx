import Link from "next/link";
import { redirect } from "next/navigation";

import { currentUser } from "@/lib/auth";

import { SignUpForm } from "./signup-form";

export const metadata = { title: "Crea un account — Asta Fantacalcio" };

export default async function SignUpPage() {
  if (await currentUser()) redirect("/");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 p-6">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">
          Crea un account
        </h1>
        <p className="text-muted-foreground text-sm">
          Ti mandiamo un codice per confermare l&apos;indirizzo, poi si entra.
        </p>
      </header>

      <SignUpForm />

      <p className="text-muted-foreground text-center text-sm">
        Hai già un account?{" "}
        <Link href="/signin" className="text-foreground font-medium hover:underline">
          Entra
        </Link>
      </p>
    </main>
  );
}
