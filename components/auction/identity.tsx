import { SlotsSummary } from "@/components/auction/roster-grid";
import { Badge } from "@/components/ui/badge";
import type { Role } from "@/lib/domain";
import type { SnapshotMember } from "@/lib/realtime/types";
import { cn } from "@/lib/utils";

/**
 * **Chi sono io, in questa asta**: squadra, slot riempiti, crediti, `max_bid`.
 *
 * Esiste come componente perché da M17 la stessa informazione vive in **due
 * contenitori diversi**, e devono dire lo stesso numero:
 *
 * - sotto `lg`, dentro la barra incollata di `PortalHeader` — dove `max_bid` non
 *   deve mai uscire dallo schermo (il requisito mobile-first di PLAN §15);
 * - da `lg`, come fascia in testa alla card della rosa, in colonna 1 — dove la
 *   barra incollata non c'è più perché su uno schermo grande non serve
 *   inseguire niente.
 *
 * ⚠ **È il secondo chiamante, quindi la regola 8 è soddisfatta e non
 * anticipata**: l'astrazione nasce perché servono due contenitori adesso, non
 * perché un giorno potrebbero servirne tre. Due copie dello stesso blocco
 * divergono sempre, e qui divergerebbero sui due numeri che decidono ogni
 * offerta.
 *
 * Il contenitore lo mette il chiamante — questo componente non ha né cornice né
 * fondo, e per questo può stare dentro una barra traslucida e dentro una card
 * grigia senza sapere in quale dei due si trova.
 */
export function Identity({
  me,
  slots,
  connected,
  className,
}: {
  me: SnapshotMember;
  slots: Record<Role, number>;
  /**
   * Lo stream è attaccato.
   *
   * ⚠ **Sta qui e non nella card di stato, e non è una svista.** La card di
   * stato dice come sta *l'asta* — una cosa sola, uguale per tutti, che arriva
   * dallo snapshot. Questo dice come sta **il mio browser**: è l'unica
   * informazione del portale che non viene dallo snapshot ma dalla connessione
   * che lo trasporta, e mescolarla con lo stato dell'asta farebbe sembrare un
   * problema di rete un problema della partita.
   *
   * Che stia dentro `Identity` fa sì che si veda in tutti e due i contenitori:
   * finché la barra incollata era l'unico posto, da `lg` in su una
   * riconnessione in corso sarebbe stata invisibile.
   */
  connected: boolean;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {!connected && (
        <Badge variant="outline" className="border-amber-500/50">
          riconnessione…
        </Badge>
      )}
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{me.teamName}</p>
          <SlotsSummary
            slotsFilled={me.slotsFilled}
            slots={slots}
            className="text-muted-foreground"
          />
        </div>
        <div className="flex shrink-0 items-end gap-4 text-right">
          <Figure label="crediti" value={me.credits} />
          <Figure label="max" value={me.maxBid} />
        </div>
      </div>
    </div>
  );
}

/**
 * Un numero con la sua etichettina.
 *
 * ⚠ Aveva un `strong` che ingrandiva `max`, ed è stato tolto col ritocco
 * entrato in v1.6.0 fuori macro: dei due numeri nessuno è il numero principale
 * — i crediti dicono quanto hai, `max` quanto puoi spendere adesso, e si
 * leggono uno accanto all'altro. Un peso diverso suggeriva una gerarchia che non
 * c'è.
 */
function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-muted-foreground text-[0.65rem] tracking-wide uppercase">
        {label}
      </p>
      <p className="text-xl leading-none font-medium tabular-nums">{value}</p>
    </div>
  );
}
