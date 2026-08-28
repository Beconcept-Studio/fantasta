import { Identity } from "@/components/auction/identity";
import type { Snapshot, SnapshotMember } from "@/lib/realtime/types";

/**
 * L'intestazione fissa del portale, **sul telefono e solo lì**: crediti e
 * offerta massima non escono mai dallo schermo.
 *
 * È il requisito mobile-first di PLAN §15 preso alla lettera. `max_bid` è il
 * numero che decide ogni offerta — è il tetto che il server applica (I5) — e
 * cercarlo con uno scroll mentre restano otto secondi è esattamente il tipo di
 * attrito che fa perdere un lotto. Insieme ci sono i crediti (da cui il tetto
 * discende) e gli slot riempiti (che spiegano la differenza fra i due).
 *
 * ## Perché da `lg` sparisce (M17 §3)
 *
 * Su uno schermo grande non c'è niente da inseguire: le tre colonne stanno tutte
 * dentro l'altezza della finestra, e gli stessi numeri sono la fascia in testa
 * alla card della rosa in colonna 1. Una barra incollata che ripete due
 * centimetri più su ciò che si vede già è una riga di schermo spesa per niente.
 *
 * ⚠ **`lg:hidden` sta su questo `<header>` e la barra resta dov'è nell'albero —
 * fuori dal `<main>`**. È deliberato e non è intercambiabile con lo spostarla
 * dentro la griglia e nasconderla lì: uno `sticky` figlio di un contenitore di
 * griglia si aggancia al contenitore, non al viewport, e il comportamento
 * cambia. Il modo sicuro è tenerla dov'era e spegnerla da `lg`.
 *
 * ⚠ **Da M21 lo `sticky` non è più qui: sta sul contenitore che la tiene insieme
 * alla barra delle tab**, in `portal.tsx`. Il motivo è che gli elementi incollati
 * sarebbero diventati **due**, uno sotto l'altro, e due `sticky top-0` fratelli si
 * sovrappongono: il secondo avrebbe avuto bisogno di sapere quanto è alto il
 * primo, cioè di un numero magico da tenere allineato a mano a questa intestazione.
 * Un contenitore solo li incolla insieme e quel numero non esiste. Chi toglie da
 * qui l'intestazione deve rimettere lo `sticky` dove serve.
 *
 * ⚠ **Il badge dello stato dell'asta non è qui**, e il blocco commentato che lo
 * disegnava è stato **tolto** insieme al commento (M17 §5): quello stato ha
 * trovato il suo posto nella card di stato della colonna 3, dove ha accanto la
 * fase, il ruolo in gioco e di chi è il turno. Un blocco commentato che
 * riappare altrove è la cosa che fa dubitare di entrambi.
 */
export function PortalHeader({
  snapshot,
  me,
  connected,
}: {
  snapshot: Snapshot;
  me: SnapshotMember | null;
  connected: boolean;
}) {
  return (
    <header className="bg-background/95 supports-backdrop-filter:bg-background/80 border-b backdrop-blur lg:hidden">
      <div className="mx-auto w-full max-w-6xl px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
        {me !== null && (
          <Identity
            me={me}
            slots={snapshot.auction.slots}
            connected={connected}
          />
        )}
      </div>
    </header>
  );
}
