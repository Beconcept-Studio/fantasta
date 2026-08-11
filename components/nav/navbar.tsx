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
  version,
}: {
  /**
   * ⚠ Un **booleano** e non l'utente intero, e non è pignoleria: questo è un
   * client component, e il tipo `User` viene da `lib/db/schema`, che tira dentro
   * l'ORM. Il layout legge già la riga e sa rispondere alla domanda: `isAppAdmin`
   * sta in `lib/domain.ts`, che non dipende da niente (M6 §5).
   */
  user: { name: string | null; isAdmin: boolean } | null;
  /**
   * La versione compilata, da `package.json`. Serve a un controllo a vista:
   * aprire il sito e sapere **quale** codice sta rispondendo, senza fidarsi di
   * quando il deploy dice di essere finito.
   *
   * Si disegna anche senza sessione, quindi si legge pure dalla pagina di
   * accesso — che è il posto in cui uno guarda quando l'app non lo fa entrare e
   * vuole capire se il deploy è passato.
   */
  version: string;
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

        <div className="ml-auto flex min-w-0 items-center gap-3">
          {user?.name != null && (
            <span className="text-muted-foreground min-w-0 truncate text-sm">
              {user.name}
            </span>
          )}
          <span className="text-muted-foreground/70 shrink-0 font-mono text-xs tabular-nums">
            v{version}
          </span>
          {/* Il pannello lo vede solo chi è amministratore dell'applicazione
              (M6). È un link e non un menù: la navbar resta una barra con tre
              cose dentro (regola 8), e nascondere la voce non è la difesa —
              quella sta in cima a ogni pagina e a ogni server action. */}
          {user?.isAdmin === true && (
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link href="/admin">Admin</Link>
            </Button>
          )}
          {user !== null && (
            <form action={signOutAction} className="shrink-0">
              <Button type="submit" variant="outline" size="sm">
                Esci
              </Button>
            </form>
          )}
        </div>
      </nav>
    </header>
  );
}
