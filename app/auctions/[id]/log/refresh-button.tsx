"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";

/**
 * Ricarica lo storico.
 *
 * Esiste perché questa pagina **non ha uno stream**: lo storico non è lo stato
 * dell'asta e non passa da `serializeSnapshot` (regola 3), quindi mentre la
 * serata va avanti la pagina invecchia. `router.refresh()` rifà la lettura sul
 * server tenendo la posizione nella pagina e il testo già scritto nel campo di
 * ricerca — che è ciò che serve a chi sta discutendo di un lotto e non vuole
 * ricominciare a cercarlo da capo.
 *
 * Un pulsante e non un intervallo automatico: durante una disputa si guarda una
 * riga ferma, e una pagina che si aggiorna da sé la sposterebbe sotto gli occhi.
 */
export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? "Aggiorno…" : "Aggiorna"}
    </Button>
  );
}
