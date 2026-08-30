import { Bookmark } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Il segnalibro dell'obiettivo: la riga è nella lista della spesa di chi guarda.
 *
 * ⚠ **C'è su ogni riga, grigia o verde** (decisione dell'owner, fase di
 * progettazione del 2026-08-28). L'alternativa guardata era mostrarla solo sugli
 * obiettivi, con uno spazio vuoto altrove, ed è stata scartata: una colonna che a
 * volte c'è e a volte no si legge come un difetto di allineamento.
 *
 * ⚠ **Vive in un file suo da M22, e il momento in cui è stato estratto è la
 * regola 8 applicata invece che aggirata**: fino a ieri il chiamante era uno solo
 * — `listone-table.tsx` — e lì stava bene. Con le liste di alternative del modale
 * d'offerta (§5.1) i chiamanti diventano **due**, che è la condizione dichiarata
 * («mai un'astrazione prima del secondo chiamante»), non una sua deroga. Il
 * componente è stato spostato **senza cambiarlo di una riga**: se un giorno il
 * diff di questo file dovesse servire, è uno spostamento e si legge come tale.
 */
export function IconaObiettivo({
  obiettivo,
  className,
}: {
  obiettivo: boolean;
  className?: string;
}) {
  return (
    <Bookmark
      className={cn(
        "size-4",
        obiettivo
          ? "fill-emerald-600 text-emerald-600"
          : "text-muted-foreground/40",
        className,
      )}
      aria-label={obiettivo ? "Obiettivo" : undefined}
    />
  );
}
