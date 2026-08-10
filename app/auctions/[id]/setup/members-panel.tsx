"use client";

import { useActionState } from "react";

import { joinAsOwnerAction, removeMemberAction } from "@/app/auctions/actions";
import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { FormFeedback } from "@/components/setup/form-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BOT_STRATEGY_LABELS } from "@/lib/domain";
import type { MemberView } from "@/lib/engine/setup";

/**
 * Chi c'è dentro, in ordine di posto.
 *
 * `seat_index` è l'ordine di rotazione dei turni, assegnato in ordine di join.
 * Togliendo qualcuno gli indici si ricompattano: un buco nella rotazione
 * sarebbe un turno di nessuno.
 */
export function MembersPanel({
  auctionId,
  members,
  seats,
  viewerIsMember,
  editable,
}: {
  auctionId: string;
  members: MemberView[];
  seats: number;
  viewerIsMember: boolean;
  editable: boolean;
}) {
  const [removeState, removeAction] = useActionState(
    removeMemberAction,
    EMPTY_FORM_STATE,
  );
  const [joinState, joinAction, joining] = useActionState(
    joinAsOwnerAction,
    EMPTY_FORM_STATE,
  );

  const free = seats - members.length;

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        {members.length} di {seats} posti occupati
        {free > 0 ? `, ${free} liberi.` : ". Al completo."}
      </p>

      {members.length > 0 && (
        <ul className="space-y-2">
          {members.map((member) => (
            <li
              key={member.id}
              className="flex items-center gap-3 rounded-md border p-2"
            >
              <span className="bg-muted flex size-7 shrink-0 items-center justify-center rounded text-xs font-medium tabular-nums">
                {member.seatIndex + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {member.teamName}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {/* Per un bot il nome della persona non esiste: al suo posto
                      la strategia, che è l'unica cosa che lo distingue dagli
                      altri undici (M4). */}
                  {member.botStrategy
                    ? `bot · ${BOT_STRATEGY_LABELS[member.botStrategy].toLowerCase()}`
                    : (member.displayName ?? "—")}
                </p>
              </div>
              {editable && (
                <form action={removeAction}>
                  <input type="hidden" name="memberId" value={member.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    Togli
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      <FormFeedback state={removeState} />

      {!viewerIsMember && editable && free > 0 && (
        <form action={joinAction} className="space-y-2 border-t pt-4">
          <input type="hidden" name="auctionId" value={auctionId} />
          <Label htmlFor="ownerTeamName">Partecipa anche tu</Label>
          <div className="flex gap-2">
            {/* Come nel form di join: `pattern` anticipa la regola,
                il server rifiuta comunque (regola 6). */}
            <Input
              id="ownerTeamName"
              name="teamName"
              placeholder="Nome della tua squadra"
              required
              minLength={3}
              maxLength={60}
              pattern={'[^,"]+'}
              title="Senza virgole né virgolette"
            />
            <Button type="submit" variant="outline" disabled={joining}>
              {joining ? "Entro…" : "Entra"}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Chi crea l&apos;asta non è obbligato a giocarci, ma di solito lo fa.
          </p>
          <FormFeedback state={joinState} />
        </form>
      )}
    </div>
  );
}
