"use client";

import { useActionState, useState } from "react";

import { deleteAuctionAsAdminAction } from "@/app/admin/actions";
import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * La cancellazione di un'asta dal pannello (M6 §2).
 *
 * **La conferma non è un `confirm()`**: quello si clicca per riflesso, e per un
 * gesto irreversibile un riflesso non è un consenso. Si **scrive il nome
 * dell'asta**, così chi sta cancellando la cosa sbagliata se ne accorge mentre
 * scrive il nome sbagliato. Il confronto si rifà comunque sul server (regola 6).
 *
 * ⚠ **L'avviso è più forte che nella configurazione, e deve esserlo.** Dal
 * proprio pannello di configurazione si cancella un'asta di cui si conosce il
 * valore: da qui si cancellano **le aste degli altri**, cioè quelle di cui non si
 * sa niente. Se è un'asta reale conclusa, se ne va il verbale delle rose e tutto
 * lo storico dei lotti — l'unica copia che esiste.
 *
 * ⚠ **Da M12 anche le aste in corso arrivano qui**, ed è l'unico posto da cui si
 * possono cancellare (§4). Per quelle l'avviso è un altro, e la differenza non è
 * il tono: **nomina quante persone sono collegate in quel momento**. Un avviso
 * che dice «tre persone» si legge; uno che dice «questa azione è irreversibile»
 * si clicca — l'abbiamo letto tutti mille volte e non vuol dire più niente.
 */
/**
 * La frase che nomina i collegati (M12 §4), nelle tre forme che servono.
 *
 * ⚠ **Zero non è «0 persone collegate».** Un numero al posto di nessuno fa
 * suonare un allarme che non c'è: una simulazione in pausa che nessuno sta
 * guardando è esattamente il caso per cui questa strada è stata aperta, e leggere
 * «0 persone verranno riportate alla dashboard» la farebbe sembrare una serata
 * interrotta. Il singolare, per la stessa ragione al contrario: «1 persone» è il
 * modo più rapido di far capire che il numero non è stato letto da nessuno.
 */
function connectedSentence(connected: number): string {
  if (connected === 0) {
    return "Nessuno è collegato in questo momento, ma l'asta non esisterà più.";
  }
  if (connected === 1) {
    return "C'è 1 persona collegata in questo momento: verrà riportata alla dashboard e l'asta non esisterà più.";
  }
  return `Ci sono ${connected} persone collegate in questo momento: verranno riportate alla dashboard e l'asta non esisterà più.`;
}

export function AuctionDelete({
  auctionId,
  name,
  ownerLabel,
  running,
  connected,
}: {
  auctionId: string;
  name: string;
  /** Di chi è l'asta, ripetuto nell'avviso: è ciò che qui non si sa a memoria. */
  ownerLabel: string;
  /** `LIVE` o `PAUSED`: si interrompe una serata, non si butta una prova. */
  running: boolean;
  /** Quante connessioni SSE aperte su quest'asta, al render della pagina. */
  connected: number;
}) {
  const [state, formAction, pending] = useActionState(
    deleteAuctionAsAdminAction,
    EMPTY_FORM_STATE,
  );
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="border-destructive/50 text-destructive hover:bg-destructive/10 h-8"
        onClick={() => setOpen(true)}
      >
        Cancella
      </Button>
    );
  }

  return (
    <form action={formAction} className="min-w-64 space-y-2">
      <input type="hidden" name="auctionId" value={auctionId} />
      <input type="hidden" name="name" value={name} />

      {running ? (
        <p className="text-destructive text-xs">
          <strong>Questa asta è in corso.</strong> {connectedSentence(connected)}{" "}
          Se ne vanno partecipanti, listone, lotti, buste,{" "}
          <strong>rose e storico</strong> dell&apos;asta di {ownerLabel}.
          L&apos;utente resta.
        </p>
      ) : (
        <p className="text-destructive text-xs">
          Cancelli l&apos;asta di {ownerLabel}. Se ne vanno partecipanti,
          listone, lotti, buste, <strong>rose e storico</strong>: se è
          un&apos;asta vera e conclusa, quello è il verbale della serata e non ne
          esiste un&apos;altra copia. L&apos;utente resta.
        </p>
      )}

      <Input
        name="confirmName"
        aria-label={`Scrivi «${name}» per confermare`}
        placeholder={`Scrivi «${name}»`}
        autoComplete="off"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        className="h-8 text-sm"
      />

      {state.error && (
        <p role="alert" className="text-destructive text-xs">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="text-xs text-emerald-700">
          {state.ok}
        </p>
      )}

      <div className="flex gap-1">
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="border-destructive/50 text-destructive hover:bg-destructive/10 h-8"
          disabled={pending || typed.trim() !== name.trim()}
        >
          {pending
            ? "Cancello…"
            : running
              ? "Interrompi e cancella"
              : "Cancella per sempre"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={() => {
            setOpen(false);
            setTyped("");
          }}
        >
          Lascia stare
        </Button>
      </div>
    </form>
  );
}
