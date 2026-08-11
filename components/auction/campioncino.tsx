"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * La figurina del giocatore in asta (M7 §6).
 *
 * Si vede in **due posti soli**: il portale del partecipante e la vista TV. In
 * regia no — la console mostra il lotto come una riga di testo, non come un
 * riquadro, e chi conduce ha la TV nella stessa stanza.
 *
 * ⚠ **Il fallback è sparire, non un segnaposto grigio.** Se l'immagine non c'è,
 * l'elemento non viene disegnato affatto e il testo scorre a sinistra: un
 * rettangolo grigio segnalerebbe un'assenza, e un'assenza qui non è un guasto —
 * è l'archivio non ancora riempito, che in produzione è lo stato del primo
 * giorno. E in quel caso non ce l'ha nessuno, quindi il riquadro resta uniforme
 * comunque.
 *
 * Lo stato tiene **quale** id ha fallito, non un booleano: così quando il lotto
 * cambia giocatore la figurina nuova riparte da sola, senza che chi usa questo
 * componente debba ricordarsi di passargli una `key`. Una difesa che dipende
 * dall'attenzione di chi chiama prima o poi si dimentica.
 *
 * ⚠ **Un `<img>` e non `next/image`**, di proposito: le figurine sono già alla
 * dimensione giusta (255×378, il formato `card`), le serve una nostra rotta che
 * legge un file dal disco, e passare dall'ottimizzatore di Next vorrebbe dire un
 * secondo giro sul server per riconvertire un PNG che va benissimo com'è.
 *
 * `alt` è vuoto perché il nome del giocatore è scritto lì accanto: un lettore di
 * schermo che lo annunciasse due volte darebbe meno informazione, non di più.
 */
export function Campioncino({
  extId,
  className,
}: {
  extId: number;
  className?: string;
}) {
  const [failedFor, setFailedFor] = useState<number | null>(null);
  if (failedFor === extId) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/campioncini/${extId}.png`}
      alt=""
      // Le misure vere del formato `card`: servono al browser per riservare lo
      // spazio giusto prima che l'immagine arrivi. Quanto grande si vede lo
      // decide il `className` di chi la mostra.
      width={255}
      height={378}
      onError={() => setFailedFor(extId)}
      className={cn("object-contain", className)}
    />
  );
}
