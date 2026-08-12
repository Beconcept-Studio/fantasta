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
 * Le aste in corso non arrivano qui: la pagina non mostra il pulsante, e il
 * motore rifiuta comunque `LIVE` e `PAUSED` anche a un amministratore.
 */
export function AuctionDelete({
  auctionId,
  name,
  ownerLabel,
}: {
  auctionId: string;
  name: string;
  /** Di chi è l'asta, ripetuto nell'avviso: è ciò che qui non si sa a memoria. */
  ownerLabel: string;
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

      <p className="text-destructive text-xs">
        Cancelli l&apos;asta di {ownerLabel}. Se ne vanno partecipanti, listone,
        lotti, buste, <strong>rose e storico</strong>: se è un&apos;asta vera e
        conclusa, quello è il verbale della serata e non ne esiste un&apos;altra
        copia. L&apos;utente resta.
      </p>

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
          {pending ? "Cancello…" : "Cancella per sempre"}
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
