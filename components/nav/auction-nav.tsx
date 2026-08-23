"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SimulationBadge } from "@/components/auction/simulation-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  isSimulated,
  sections,
  tvHref,
}: {
  auctionId: string;
  auctionName: string;
  /** Un'asta di prova (M4): il badge accompagna il nome in ogni sezione. */
  isSimulated: boolean;
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
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">
            {active?.title ?? auctionName}
          </h1>
          <Badge variant="secondary" className="max-w-full truncate">
            {auctionName}
          </Badge>
          {isSimulated && <SimulationBadge />}

        </div>



        {(sections.length > 0 || tvHref !== null) && (
          <nav className="flex flex-wrap items-center gap-x-1 gap-y-1 pt-1">
            {sections.map((section) => {
              const current = section.key === active?.key;
              return (
                <Button
                  key={section.key}
                  asChild
                  variant="outline"
                  size="sm"
                  className={cn(
                    "shrink-0",
                    current
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  <Link
                    href={sectionHref(auctionId, section)}
                    aria-current={current ? "page" : undefined}
                  >
                    {section.label}
                  </Link>
                </Button>
              );
            })}

            {tvHref !== null && (
              <Button asChild size="sm" className="shrink-0">
                <a href={tvHref} target="_blank" rel="noreferrer">
                  TV ↗
                </a>
              </Button>
            )}
          </nav>
        )}
      </div>
    </div>
  );
}
