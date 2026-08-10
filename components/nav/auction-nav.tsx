"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  type AuctionSection,
  activeSection,
  sectionHref,
} from "@/lib/auction-nav";
import { cn } from "@/lib/utils";

/**
 * L'intestazione di ogni pagina dell'asta: **il badge dice dove sei, il titolo
 * dice cosa stai facendo.**
 *
 * Prima di M2 era il contrario di quello che serviva: il titolo di ogni pagina
 * era il nome dell'asta, cioè l'unica cosa che uno già sa — tre schermate
 * diverse che si presentavano tutte come «Serie A 2026». Il nome dell'asta è
 * contesto, e il contesto sta in un badge; il titolo è il nome della pagina.
 *
 * È client soltanto per `usePathname`: il titolo lo decide la rotta, non la
 * pagina. Una pagina che dichiara il proprio titolo può mentire su dove si
 * trova; la barra degli indirizzi no. `lib/auction-nav.ts` non ha dipendenze
 * apposta — è ciò che permette a questo componente di leggerlo senza portarsi
 * l'ORM nel bundle.
 *
 * Non è sticky, come la navbar sopra di lui, e per lo stesso motivo: sul
 * portale del partecipante lo spazio verticale è del countdown.
 */
export function AuctionNav({
  auctionId,
  auctionName,
  sections,
  tvHref,
}: {
  auctionId: string;
  auctionName: string;
  sections: AuctionSection[];
  /**
   * Il link alla vista proiettata, o `null`. Non è una sezione dell'asta: è una
   * pagina pubblica che si apre in un'altra scheda, e la sua chiave — il
   * `public_token` — è dell'owner.
   */
  tvHref: string | null;
}) {
  const pathname = usePathname();
  const active = activeSection(pathname);

  return (
    <div className="bg-muted/40 border-b">
      <div className="mx-auto w-full max-w-6xl space-y-2 px-4 py-4">
        <Badge variant="secondary" className="max-w-full truncate">
          {auctionName}
        </Badge>

        <h1 className="text-2xl font-semibold tracking-tight">
          {active?.title ?? auctionName}
        </h1>

        {(sections.length > 0 || tvHref !== null) && (
          <nav className="flex flex-wrap items-center gap-x-1 gap-y-1 pt-1">
            {sections.map((section) => {
              const current = section.key === active?.key;
              return (
                <Link
                  key={section.key}
                  href={sectionHref(auctionId, section)}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm transition",
                    current
                      ? "bg-background font-medium shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-background/60",
                  )}
                >
                  {section.label}
                </Link>
              );
            })}

            {tvHref !== null && (
              <a
                href={tvHref}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground hover:bg-background/60 rounded-md px-3 py-1.5 text-sm transition"
              >
                TV ↗
              </a>
            )}
          </nav>
        )}
      </div>
    </div>
  );
}
