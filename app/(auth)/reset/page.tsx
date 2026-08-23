import Link from "next/link";

import { CODE_TTL_MINUTES } from "@/lib/engine/account-rules";

import { ResetForm } from "./reset-form";

export const metadata = { title: "Password nuova — Asta Fantacalcio" };

/**
 * **Un codice, non un link** (§4): niente token negli URL da farsi inoltrare
 * per sbaglio, e una schermata in meno da scrivere. L'indirizzo nella query
 * string serve solo a precompilare il campo — chi arriva qui a mano lo scrive.
 */
export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 p-6">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">
          Scegli una password nuova
        </h1>
        <p className="text-muted-foreground text-sm">
          Se quell&apos;indirizzo ha un account con una password, il codice è in
          arrivo. Vale {CODE_TTL_MINUTES} minuti.
        </p>
      </header>

      <ResetForm email={email ?? ""} />

      <p className="text-muted-foreground text-center text-sm">
        <Link href="/forgot" className="hover:text-foreground">
          Non è arrivato niente: rimandamelo
        </Link>
      </p>
    </main>
  );
}
