"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  type AdminSection,
  activeAdminSection,
  adminSectionHref,
} from "@/lib/admin-nav";
import { cn } from "@/lib/utils";

/**
 * La sidebar del pannello di amministrazione, il titolo della pagina, e il
 * contenuto accanto (M6).
 *
 * **La voce e il titolo escono dalla stessa riga di `lib/admin-nav.ts`**: il
 * titolo che leggi in cima e la voce da cui ci sei arrivato non possono
 * raccontare due cose diverse, perché sono lo stesso oggetto. È il rimedio al bug
 * di M2, dove ogni pagina si scriveva i link a mano e una voce puntava altrove.
 *
 * Titolo e navigazione stanno **nello stesso componente** per la stessa ragione
 * per cui stanno nella stessa riga: separarli vorrebbe dire due letture del
 * pathname e due posti da cui la coppia può divergere.
 *
 * È client soltanto per `usePathname`: il titolo lo decide la rotta, non la
 * pagina. Una pagina che dichiara il proprio titolo può mentire su dove si trova;
 * la barra degli indirizzi no.
 *
 * ⚠ **Questa sidebar non autorizza niente**, come la sotto-navbar dell'asta.
 * Mostra due voci a chi è già passato da `requireAppAdmin()` nel layout, e ogni
 * pagina e ogni server action hanno la loro guardia comunque. Una voce che non
 * c'è non è una difesa.
 *
 * **Da scrivania, e detto invece che accaduto per caso**: la sidebar sta di lato
 * su schermi larghi e sopra il contenuto su schermi stretti, senza nessuna
 * ottimizzazione per il pollice. Il mobile-first è del portale del partecipante —
 * lì si offre dal telefono, sotto pressione, con trenta secondi di countdown — e
 * resta suo. Il pannello si apre da un portatile, con calma.
 */
export function AdminSidebar({
  sections,
  children,
}: {
  sections: AdminSection[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = activeAdminSection(pathname);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6 md:flex-row">
      <nav className="flex shrink-0 gap-1 border-b pb-3 md:w-44 md:flex-col md:border-r md:border-b-0 md:pr-4 md:pb-0">
        <p className="text-muted-foreground hidden px-3 pb-1 text-xs font-medium tracking-wide uppercase md:block">
          Amministrazione
        </p>
        {sections.map((section) => {
          const current = section.key === active?.key;
          return (
            <Link
              key={section.key}
              href={adminSectionHref(section)}
              aria-current={current ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition",
                // Una voce annidata (M10) rientra, e solo da schermo largo: in
                // orizzontale le voci stanno in fila e un margine sinistro
                // sposterebbe soltanto quella, senza dire niente a nessuno.
                section.parent !== undefined && "md:ml-3",
                current
                  ? "bg-muted font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
              )}
            >
              {section.label}
            </Link>
          );
        })}
      </nav>

      <div className="min-w-0 flex-1 space-y-6">
        <h1 className="text-xl font-semibold tracking-tight">
          {active?.title ?? "Amministrazione"}
        </h1>
        {children}
      </div>
    </main>
  );
}
