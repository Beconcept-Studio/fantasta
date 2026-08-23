import Link from "next/link";

import { ForgotForm } from "./forgot-form";

export const metadata = { title: "Password dimenticata — Asta Fantacalcio" };

/**
 * Non è protetta da nessuna guardia, e non deve esserlo: chi ha dimenticato la
 * password è fuori per definizione.
 *
 * ⚠ È anche l'unico modo di **cambiare** la propria password: non esiste una
 * schermata «cambia password» dentro l'applicazione (§13). Chi la vuole
 * cambiare passa da qui, che è la stessa macchina e una schermata in meno.
 */
export default function ForgotPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 p-6">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">
          Password dimenticata
        </h1>
        <p className="text-muted-foreground text-sm">
          Scrivi il tuo indirizzo: ti mando un codice a sei cifre per
          sceglierne una nuova.
        </p>
      </header>

      <ForgotForm />

      <p className="text-muted-foreground text-center text-sm">
        <Link href="/signin" className="hover:text-foreground">
          Torna all&apos;ingresso
        </Link>
      </p>
    </main>
  );
}
