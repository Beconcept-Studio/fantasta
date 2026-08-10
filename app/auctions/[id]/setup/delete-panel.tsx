"use client";

import { useActionState, useState } from "react";

import { deleteAuctionAction } from "@/app/auctions/actions";
import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { FormFeedback } from "@/components/setup/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * La cancellazione dell'asta (M4).
 *
 * **La conferma non è un `confirm()`**: quello si clicca per riflesso, e per un
 * gesto irreversibile un riflesso non è un consenso. Si **scrive il nome
 * dell'asta**, così chi sta cancellando la cosa sbagliata se ne accorge mentre
 * scrive il nome sbagliato.
 *
 * Il pulsante resta disabilitato finché il nome non coincide, e il confronto si
 * rifà comunque sul server (regola 6). Quello che nemmeno un nome digitato può
 * fare è restituire un'asta: il testo qui sotto dice cosa se ne va, per nome,
 * perché è l'ultimo momento in cui qualcuno può leggerlo.
 */
export function DeletePanel({
  auctionId,
  name,
  deletable,
}: {
  auctionId: string;
  name: string;
  /** `false` con l'asta in corso: si cancella solo ciò che non sta giocando. */
  deletable: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    deleteAuctionAction,
    EMPTY_FORM_STATE,
  );
  const [typed, setTyped] = useState("");

  if (!deletable) {
    return (
      <p className="text-muted-foreground text-sm">
        L&apos;asta è in corso. Si cancella quando è finita — o prima che
        cominci.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="auctionId" value={auctionId} />
      <input type="hidden" name="name" value={name} />

      <p className="text-sm">
        Se ne vanno <strong>tutte</strong> le sue cose: partecipanti, listone,
        lotti, buste, rose, rettifiche e lo storico. Non c&apos;è modo di
        tornare indietro.
      </p>

      <div className="space-y-2">
        <Label htmlFor="confirmName">
          Scrivi <strong>{name}</strong> per confermare
        </Label>
        <Input
          id="confirmName"
          name="confirmName"
          autoComplete="off"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      </div>

      <FormFeedback state={state} />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        className="border-destructive/50 text-destructive hover:bg-destructive/10"
        disabled={pending || typed.trim() !== name.trim()}
      >
        {pending ? "Cancello…" : "Cancella l'asta"}
      </Button>
    </form>
  );
}
