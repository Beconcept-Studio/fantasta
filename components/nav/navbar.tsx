"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { signOutAction } from "@/components/nav/actions";
import { Button } from "@/components/ui/button";

/**
 * La navbar globale: logo, nome di chi è entrato, uscita. Niente altro.
 *
 * **Non è sticky, da nessuna parte.** Il requisito nasce dal portale del
 * partecipante, dove lo spazio verticale è la risorsa più scarsa dell'app e non
 * può essere speso per una barra di navigazione mentre scorre un countdown di
 * otto secondi. Applicarlo ovunque non costa niente — le altre pagine sono
 * documenti, non cruscotti — e ci risparmia un incastro a tre livelli di
 * `z-index` fra `LiveBanner`, navbar e `PortalHeader`. Restano incollati i due
 * che devono esserlo: il banner, che è il richiamo d'emergenza, e
 * l'intestazione del portale, che tiene crediti e offerta massima sempre in
 * vista.
 *
 * **Nome e uscita in chiaro, non dentro un menu a tendina.** Un menu con due
 * voci è un'astrazione prima del secondo chiamante (regola 8), e costerebbe un
 * componente shadcn in più, del JavaScript client su ogni pagina e due tocchi
 * per uscire. A 375px il nome si tronca e il pulsante resta raggiungibile.
 *
 * I due `null` non sono la stessa cosa e coprono due casi senza scriverli come
 * eccezioni. Nessuna sessione (`/signin`): resta il solo logo. Sessione senza
 * nome (`/onboarding`, dove `display_name` è proprio ciò che si sta
 * compilando): niente nome, ma **l'uscita c'è** — è l'unica via di fuga per chi
 * è entrato con l'account Google sbagliato e non ha ancora una dashboard.
 */
export function Navbar({
  user,
}: {
  user: { name: string | null } | null;
}) {
  const pathname = usePathname();

  // La vista TV è pubblica, nera e proiettata: non ha un utente e non ha
  // niente da navigare. Stesso meccanismo con cui il `LiveBanner` si toglie di
  // mezzo sul portale — non un route group: spostare una rotta nell'albero per
  // una riga di navbar sarebbe riorganizzare l'app per un dettaglio di
  // presentazione.
  if (pathname.startsWith("/tv/")) return null;

  return (
    <header className="bg-background border-b">
      <nav className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2.5">
        <Link
          href="/dashboard"
          className="shrink-0 text-base font-semibold tracking-tight"
        >
          Fantasta
        </Link>

        {user !== null && (
          <div className="ml-auto flex min-w-0 items-center gap-3">
            {user.name !== null && (
              <span className="text-muted-foreground min-w-0 truncate text-sm">
                {user.name}
              </span>
            )}
            <form action={signOutAction} className="shrink-0">
              <Button type="submit" variant="outline" size="sm">
                Esci
              </Button>
            </form>
          </div>
        )}
      </nav>
    </header>
  );
}
