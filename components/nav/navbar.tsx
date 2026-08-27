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
 * documenti, non cruscotti — e ci risparmia un incastro di `z-index` con
 * `PortalHeader`, che invece è incollato e deve esserlo: tiene crediti e offerta
 * massima sempre in vista. (Fino a v1.9.1 l'incastro era a tre livelli, perché
 * c'era anche il banner «Asta in corso» in cima a ogni pagina. È stato rimosso
 * con M9: uno dei tre sticky non esiste più.)
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
  // niente da navigare. Un controllo sul pathname e non un route group:
  // spostare una rotta nell'albero per una riga di navbar sarebbe riorganizzare
  // l'app per un dettaglio di presentazione.
  if (pathname.startsWith("/tv/")) return null;

  return (
    <header className="bg-background border-b">
      <nav className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2.5">
        <Link
          href="/dashboard"
          className="flex shrink-0 items-center gap-2 text-base font-semibold tracking-tight"
        >
          <Logo />
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

/**
 * Il marchio, inline e **in questo file**: ha un solo chiamante, ed è il `<Link>`
 * qui sopra (regola 8). Il giorno che un secondo posto lo vuole — la pagina di
 * accesso con un marchio grande, la TV — si sposta in `components/nav/logo.tsx`,
 * e quel giorno ci sarà un secondo chiamante a giustificarlo.
 *
 * Tre dettagli che non sono gusto, e il quarto è la misura:
 *
 * - **`fill="currentColor"`**, non il `fill="black"` che esce da Figma: così il
 *   marchio segue il colore del testo accanto invece di congelarsi. Non serve
 *   oggi — la navbar è chiara e il testo è quasi nero — ed è ciò che evita un
 *   marchio nero su fondo nero il giorno che qualcosa cambia.
 * - **Il `clipPath` di Figma è stato buttato**, col suo `<defs>` e il suo `id`.
 *   Era un rettangolo a tela piena, cioè inerte, e ⚠ un SVG inline condivide lo
 *   spazio dei nomi degli `id` con tutta la pagina: `clip0_262_27` in una pagina
 *   è un rischio piccolo e gratuito da evitare.
 * - **`aria-hidden`**: il nome dell'app è scritto accanto in testo, e un
 *   `<title>` qui dentro farebbe leggere «Fantasta Fantasta».
 * - **`h-6`** e non l'`h-5` da cui la spec partiva. La misura è stata guardata a
 *   375px, tre altezze a confronto, e ha vinto per una ragione misurata prima che
 *   per gusto: **24px è esattamente la `line-height` del `text-base` accanto**,
 *   quindi sulla pagina di accesso — dove la navbar è il solo logo e non ci sono
 *   pulsanti a dettare l'altezza — la barra resta **alta 45px come prima**. A
 *   `h-7` diventerebbe 49px, cioè il marchio pagherebbe con l'altezza di ogni
 *   pagina dell'app. All'occhio: a `h-5` (20px → 15 di larghezza, il marchio è
 *   verticale) sta timido accanto a una parola in semibold, a `h-7` la domina.
 *   `w-auto` e non una larghezza fissa: il rapporto lo tiene il `viewBox`.
 *
 * ⚠ **Chi paga i diciotto pixel è il nome dell'utente**, e va saputo invece di
 * scoprirlo: a 375px la riga non va a capo in nessun caso — `nav.scrollWidth`
 * resta 375 — perché il nome ha `min-w-0` e `truncate`, quindi cede lui. Sulla
 * dashboard di un amministratore era già troncato prima (61px per «Andrea
 * Ruggeri», che ne vorrebbe un centinaio) e adesso ha 35px. Nel portale, senza il
 * pulsante Admin, un nome lungo passa da **intero a troncato**: 134px prima, 115
 * adesso. È il costo del marchio nel nav, non un difetto da aggiustare
 * allargando la navbar — e `h-5` ne restituirebbe **tre** pixel, cioè non
 * cambierebbe nulla di quel caso.
 */
function Logo() {
  return (
    <svg
      viewBox="0 0 602 800"
      className="h-6 w-auto"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M201.849 800L200.732 601.083L0.590969 601.017V400.853L200.273 400.066L0 200.492L200.732 0H602L601.934 200.689L201.126 200.623L201.192 400.591L601.409 400.853L201.849 800Z" />
    </svg>
  );
}
