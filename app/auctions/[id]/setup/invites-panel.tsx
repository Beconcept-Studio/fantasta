"use client";

import { Check, Copy } from "lucide-react";
import { useActionState, useState } from "react";

import { createInviteAction } from "@/app/auctions/actions";
import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { FormFeedback } from "@/components/setup/form-feedback";
import { Button } from "@/components/ui/button";

/**
 * I link d'invito.
 *
 * Non c'è nessuna gestione di scadenze o di utilizzi massimi in questa
 * schermata, ed è voluto: di default un invito vale per chiunque finché l'asta
 * è in DRAFT o READY, perché la protezione vera è che **all'avvio gli inviti
 * smettono di funzionare** (PLAN §17). I campi esistono nello schema per il
 * giorno in cui servissero.
 */
export function InvitesPanel({
  auctionId,
  baseUrl,
  invites,
  editable,
}: {
  auctionId: string;
  baseUrl: string;
  invites: { token: string; uses: number; maxUses: number | null }[];
  editable: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    createInviteAction,
    EMPTY_FORM_STATE,
  );

  return (
    <div className="space-y-4">
      {invites.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nessun link d&apos;invito. Generane uno e mandalo nel gruppo: va bene
          lo stesso link per tutti.
        </p>
      ) : (
        <ul className="space-y-2">
          {invites.map((invite) => (
            <InviteRow
              key={invite.token}
              url={`${baseUrl}/join/${invite.token}`}
              uses={invite.uses}
              maxUses={invite.maxUses}
            />
          ))}
        </ul>
      )}

      <form action={formAction} className="space-y-3">
        <input type="hidden" name="auctionId" value={auctionId} />
        <FormFeedback state={state} />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={!editable || pending}
        >
          {pending ? "Genero…" : "Genera un link d'invito"}
        </Button>
      </form>
    </div>
  );
}

function InviteRow({
  url,
  uses,
  maxUses,
}: {
  url: string;
  uses: number;
  maxUses: number | null;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Senza permesso sugli appunti (o fuori da https) resta la selezione a mano.
    }
  }

  return (
    <li className="flex items-center gap-2 rounded-md border p-2">
      <code className="flex-1 truncate font-mono text-xs" title={url}>
        {url}
      </code>
      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
        {uses} {uses === 1 ? "uso" : "usi"}
        {maxUses !== null ? ` / ${maxUses}` : ""}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        aria-label="Copia il link"
        onClick={copy}
      >
        {copied ? (
          <Check className="size-4 text-emerald-600" />
        ) : (
          <Copy className="size-4" />
        )}
      </Button>
    </li>
  );
}
