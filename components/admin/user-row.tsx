"use client";

import { useActionState, useState } from "react";

import {
  forceVerifyEmailAction,
  setUserAdminAction,
  setUserDisplayNameAction,
  setUserProAction,
} from "@/app/admin/actions";
import { EMPTY_FORM_STATE } from "@/app/auctions/form-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AdminEntry } from "@/lib/engine/admin";

/**
 * Una riga della tabella utenti, con le sue tre azioni — e sono tre (M6 §4).
 *
 * ⚠ **L'email non è modificabile, ed è l'unico campo di cui valga la pena dire
 * perché.** Da M5 è la chiave d'identità: cambiarla cambia *chi può entrare* in
 * quell'account. Un indirizzo sbagliato si risolve rifacendo l'account, che a
 * dodici utenti è perfettamente praticabile — e un amministratore che riscrive
 * l'indirizzo di qualcun altro è un potere che questa applicazione non ha motivo
 * di avere. Qui è testo semplice, non un campo disabilitato: un input grigio
 * suggerisce che da qualche parte esista il modo di abilitarlo.
 *
 * Le tre azioni sono tre form separati con tre `useActionState`: ognuna ha il suo
 * esito, e salvare il nome non deve cancellare il messaggio della verifica. Il
 * server rifiuta comunque tutto quello che questa UI non offre (regola 6).
 */
export type AdminUserView = {
  id: string;
  email: string | null;
  displayName: string | null;
  entry: AdminEntry;
  verified: boolean;
  isAdmin: boolean;
  /** ⚠ Vede gli insight sul listone (M8). Un amministratore li vede comunque. */
  isPro: boolean;
  isBot: boolean;
  createdOn: string;
  ownedAuctions: number;
  playedAuctions: number;
  /** ⚠ La riga di chi sta guardando: su di sé `is_admin` non si tocca (§4). */
  isSelf: boolean;
};

const ENTRY_LABELS: Record<AdminEntry, string> = {
  google: "Google",
  password: "Password",
  both: "Google + password",
  none: "—",
};

export function UserRow({ user }: { user: AdminUserView }) {
  const [nameState, saveName, savingName] = useActionState(
    setUserDisplayNameAction,
    EMPTY_FORM_STATE,
  );
  const [verifyState, verify, verifying] = useActionState(
    forceVerifyEmailAction,
    EMPTY_FORM_STATE,
  );
  const [adminState, toggleAdmin, togglingAdmin] = useActionState(
    setUserAdminAction,
    EMPTY_FORM_STATE,
  );
  const [proState, togglePro, togglingPro] = useActionState(
    setUserProAction,
    EMPTY_FORM_STATE,
  );
  const [name, setName] = useState(user.displayName ?? "");

  const messages = [nameState, verifyState, adminState, proState]
    .map((state) => state.error ?? state.ok)
    .filter((message): message is string => Boolean(message));
  const failed = Boolean(
    nameState.error || verifyState.error || adminState.error || proState.error,
  );

  return (
    <>
      <tr className="border-b align-top">
        <td className="px-2 py-2">
          <span className="font-mono text-xs break-all">
            {user.email ?? "—"}
          </span>
        </td>

        <td className="px-2 py-2">
          <form action={saveName} className="flex items-center gap-1">
            <input type="hidden" name="userId" value={user.id} />
            <Input
              name="displayName"
              aria-label="Nome"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-8 min-w-32 text-sm"
            />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={
                savingName ||
                name.trim() === (user.displayName ?? "").trim() ||
                name.trim().length < 3
              }
            >
              {savingName ? "…" : "Salva"}
            </Button>
          </form>
        </td>

        <td className="text-muted-foreground px-2 py-2 text-sm whitespace-nowrap">
          {ENTRY_LABELS[user.entry]}
        </td>

        <td className="px-2 py-2">
          {user.verified ? (
            <Badge variant="secondary">Verificato</Badge>
          ) : (
            <form action={verify}>
              <input type="hidden" name="userId" value={user.id} />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={verifying || user.email === null}
              >
                {verifying ? "…" : "Verifica a mano"}
              </Button>
            </form>
          )}
        </td>

        <td className="px-2 py-2">
          {/* ⚠ Sulla propria riga non c'è nessun pulsante: il server rifiuta
              comunque, ma un pulsante che esiste è un pulsante che qualcuno
              premerà — e un click e ci chiudiamo fuori tutti. Sui bot niente,
              perché un bot non amministra niente (e lo rifiuta il CHECK). */}
          {user.isSelf ? (
            <span className="text-muted-foreground text-xs">
              sei tu {user.isAdmin && "· amministratore"}
            </span>
          ) : user.isBot ? (
            <span className="text-muted-foreground text-xs">bot</span>
          ) : (
            <form action={toggleAdmin} className="flex items-center gap-2">
              <input type="hidden" name="userId" value={user.id} />
              <input
                type="hidden"
                name="isAdmin"
                value={user.isAdmin ? "false" : "true"}
              />
              {user.isAdmin && <Badge>Amministratore</Badge>}
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={togglingAdmin}
              >
                {togglingAdmin ? "…" : user.isAdmin ? "Togli" : "Rendi admin"}
              </Button>
            </form>
          )}
        </td>

        <td className="px-2 py-2">
          {/* ⚠ Sulla propria riga il pulsante **c'è**, a differenza di
              `is_admin`: quello, togliendoselo, chiude fuori dal pannello e non
              c'è un'altra porta da cui rientrare; questo non apre niente — e un
              amministratore vede gli insight comunque, quindi spegnerselo non
              gli toglie nemmeno la vista. Sui bot niente: un bot non guarda
              nessuna lista. */}
          {user.isBot ? (
            <span className="text-muted-foreground text-xs">—</span>
          ) : (
            <form action={togglePro} className="flex items-center gap-2">
              <input type="hidden" name="userId" value={user.id} />
              <input
                type="hidden"
                name="isPro"
                value={user.isPro ? "false" : "true"}
              />
              {user.isPro && <Badge variant="secondary">Insight</Badge>}
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={togglingPro}
              >
                {togglingPro ? "…" : user.isPro ? "Togli" : "Dai insight"}
              </Button>
            </form>
          )}
        </td>

        <td className="px-2 py-2 text-sm whitespace-nowrap tabular-nums">
          {user.ownedAuctions} / {user.playedAuctions}
        </td>

        <td className="text-muted-foreground px-2 py-2 text-sm whitespace-nowrap tabular-nums">
          {user.createdOn}
        </td>
      </tr>

      {messages.length > 0 && (
        <tr className="border-b">
          <td colSpan={8} className="px-2 pb-2">
            <p
              role={failed ? "alert" : "status"}
              className={
                failed
                  ? "text-destructive text-sm"
                  : "text-sm text-emerald-700 dark:text-emerald-400"
              }
            >
              {messages.join(" · ")}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}
