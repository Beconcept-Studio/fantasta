"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Il banner globale "Asta in corso" (F5-02, §8bis punto 1).
 *
 * È il primo dei tre livelli della gerarchia del partecipante, e il suo compito
 * è uno solo: **far ritrovare la strada da soli**. Chi chiude il tab per
 * sbaglio, chi apre l'app dalla home dello smartphone, chi si ritrova sulla
 * dashboard senza sapere come, deve vedere in cima a qualunque pagina che c'è
 * un'asta viva e che ci si arriva con un tocco. Senza questo, l'unico modo di
 * rientrare sarebbe ricordarsi l'URL.
 *
 * Sta nel layout radice, quindi compare davvero su tutte le pagine — dashboard
 * inclusa, come chiede il piano. L'unica pagina in cui si nasconde è il portale
 * di quell'asta: lì un banner che porta dove già sei ruberebbe righe allo
 * schermo del telefono, che è la risorsa più scarsa dell'app.
 */
export type LiveMembership = {
  id: string;
  name: string;
  paused: boolean;
};

export function LiveBanner({ auctions }: { auctions: LiveMembership[] }) {
  const pathname = usePathname();
  const visible = auctions.filter(
    (auction) => pathname !== `/auctions/${auction.id}/play`,
  );
  if (visible.length === 0) return null;

  return (
    <div className="sticky top-0 z-50">
      {visible.map((auction) => (
        <Link
          key={auction.id}
          href={`/auctions/${auction.id}/play`}
          className="flex items-center gap-2.5 border-b border-emerald-600/40 bg-emerald-600/15 px-4 py-2.5 text-sm transition hover:bg-emerald-600/25"
        >
          <span className="relative flex size-2.5 shrink-0">
            {!auction.paused && (
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
            )}
            <span className="relative inline-flex size-2.5 rounded-full bg-emerald-600" />
          </span>
          <span className="min-w-0 flex-1 truncate">
            <strong className="font-semibold">
              {auction.paused ? "Asta in pausa" : "Asta in corso"}
            </strong>
            <span className="text-muted-foreground"> · {auction.name}</span>
          </span>
          <span className="shrink-0 font-medium underline underline-offset-4">
            Entra
          </span>
        </Link>
      ))}
    </div>
  );
}
