import Link from "next/link";

import { StatusBadge } from "@/components/setup/status-badge";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { listUserAuctions } from "@/lib/engine/setup";

export const metadata = { title: "Le tue aste — Asta Fantacalcio" };

export default async function DashboardPage() {
  const user = await requireUser();
  const auctions = await listUserAuctions(user.id);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-8 p-6">
      {/* Il nome e l'uscita stanno nella navbar da M2: qui resterebbero due
          volte sulla stessa schermata. */}
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Le tue aste</h1>
      </header>

      {auctions.length === 0 ? (
        <section className="space-y-4 rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground text-sm">
            Non partecipi ancora a nessun&apos;asta. Creane una, oppure apri il
            link d&apos;invito che ti hanno mandato.
          </p>
          <Button asChild>
            <Link href="/auctions/new">Crea un&apos;asta</Link>
          </Button>
        </section>
      ) : (
        <>
          <ul className="space-y-3">
            {auctions.map((auction) => (
              <li key={auction.id}>
                <Link
                  // Ad asta iniziata l'owner vuole la regia, non la
                  // configurazione: da lì mette in pausa e vede chi è caduto.
                  href={
                    auction.isOwner
                      ? auction.status === "DRAFT" || auction.status === "READY"
                        ? `/auctions/${auction.id}/setup`
                        : `/auctions/${auction.id}/manage`
                      : `/auctions/${auction.id}/lobby`
                  }
                  className="hover:bg-accent flex items-center gap-4 rounded-lg border p-4 transition"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate font-medium">{auction.name}</p>
                    <p className="text-muted-foreground text-sm">
                      {auction.memberCount}/{auction.seats} partecipanti
                      {auction.isOwner ? " · la gestisci tu" : ""}
                      {auction.teamName ? ` · ${auction.teamName}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={auction.status} />
                </Link>
              </li>
            ))}
          </ul>

          <Button asChild variant="outline" className="self-start">
            <Link href="/auctions/new">Crea un&apos;altra asta</Link>
          </Button>
        </>
      )}
    </main>
  );
}
