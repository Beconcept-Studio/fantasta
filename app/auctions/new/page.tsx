import Link from "next/link";

import { requireUser } from "@/lib/auth";
import { isAppAdmin } from "@/lib/domain";
import { DEFAULT_CONFIG } from "@/lib/engine/setup-rules";

import { CreateAuctionForm } from "./create-auction-form";

export const metadata = { title: "Nuova asta — Asta Fantacalcio" };

export default async function NewAuctionPage() {
  const user = await requireUser();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-8 p-6">
      <header className="space-y-1">
        <Link
          href="/dashboard"
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← Le tue aste
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Nuova asta</h1>
        <p className="text-muted-foreground text-sm">
          Puoi cambiare tutto finché l&apos;asta non parte.
        </p>
      </header>

      <CreateAuctionForm
        defaults={{ name: "", ...DEFAULT_CONFIG }}
        canSimulate={isAppAdmin(user)}
      />
    </main>
  );
}
