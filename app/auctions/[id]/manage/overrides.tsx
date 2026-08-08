"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/domain";
import { sendAction, type ActionPayload } from "@/lib/realtime/action";
import { assignablePlayers, overrideControls } from "@/lib/realtime/manage";
import type { PoolPlayer, Snapshot, SnapshotMember } from "@/lib/realtime/types";
import { cn } from "@/lib/utils";

/**
 * Il pannello delle correzioni (F7-05): le tre azioni che riscrivono un fatto
 * già accaduto, tutte in un posto solo, e visibili solo all'owner (questa
 * pagina non esiste per nessun altro).
 *
 * **Non c'è un pulsante "annulla l'ultimo lotto", e non è una dimenticanza**
 * (⚠ P1). Un lotto sbagliato si corregge in due mosse — si cancella il
 * giocatore dalla rosa, lo si riassegna com'era giusto — e la rotazione dei
 * turni non torna indietro. Il pannello lo dice a parole, perché è la prima
 * cosa che si cerca quando qualcosa va storto.
 *
 * Tutto si spegne con un lotto in contesa (`overrideControls`), pausa
 * compresa: la pausa congela la fase, non la azzera. E come sempre
 * **disabilitare non è autorizzare** (regola 6) — `lib/engine/override.ts`
 * rifiuta comunque, con il suo messaggio, se la fase cambia nel mezzo secondo
 * fra il render e il click.
 */

type Feedback = { ok: boolean; message: string } | null;

export function OverridePanel({
  auctionId,
  snapshot,
  pool,
}: {
  auctionId: string;
  snapshot: Snapshot;
  /** Il listone dell'asta: arriva dal server una volta sola, come nel portale. */
  pool: PoolPlayer[];
}) {
  const controls = overrideControls(snapshot);
  const [open, setOpen] = useState(false);

  return (
    <section className="bg-card space-y-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Correzioni</h2>
          <p className="text-muted-foreground text-sm">
            Assegnazione manuale, cancellazione di un giocatore da una rosa,
            rettifica dei crediti.
          </p>
        </div>
        <Button variant="outline" onClick={() => setOpen((v) => !v)}>
          {open ? "Chiudi" : "Apri le correzioni"}
        </Button>
      </div>

      {open && (
        <>
          <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
            <strong className="text-foreground">Non esiste un annulla.</strong>{" "}
            Un lotto sbagliato si corregge cancellando il giocatore dalla rosa e
            riassegnandolo a mano: la riga sbagliata resta a database, marcata
            come annullata, e i crediti si ricalcolano da soli. Il turno di
            chiamata non torna indietro.
          </p>

          {!controls.allowed && (
            <p
              role="status"
              className="border-amber-500/50 bg-amber-500/10 rounded-lg border px-3 py-2 text-sm"
            >
              {controls.blocked}
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <ManualAssign
              auctionId={auctionId}
              snapshot={snapshot}
              pool={pool}
              disabled={!controls.allowed}
            />
            <div className="space-y-4">
              <VoidAssignment
                auctionId={auctionId}
                snapshot={snapshot}
                disabled={!controls.allowed}
              />
              <AdjustBudget
                auctionId={auctionId}
                snapshot={snapshot}
                disabled={!controls.allowed}
              />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

// ─── Pezzi comuni ────────────────────────────────────────────────────────────

function Box({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div>
        <h3 className="font-medium">{title}</h3>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </div>
      {children}
    </div>
  );
}

function MemberSelect({
  id,
  members,
  value,
  onChange,
}: {
  id: string;
  members: SnapshotMember[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-3"
    >
      <option value="">Scegli una squadra…</option>
      {members.map((m) => (
        <option key={m.id} value={m.id}>
          {m.seatIndex + 1} · {m.teamName} ({m.credits} crediti)
        </option>
      ))}
    </select>
  );
}

function Result({ feedback }: { feedback: Feedback }) {
  if (feedback === null) return null;
  return (
    <p
      role="status"
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        feedback.ok
          ? "border-emerald-600/40 bg-emerald-600/10"
          : "border-destructive/50 bg-destructive/10",
      )}
    >
      {feedback.message}
    </p>
  );
}

/** L'invio comune ai tre riquadri: nessuno stato locale dell'asta, mai. */
function useSend(auctionId: string) {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const send = async (payload: ActionPayload, done: string): Promise<boolean> => {
    setPending(true);
    setFeedback(null);
    const result = await sendAction(auctionId, payload);
    setPending(false);
    setFeedback(
      result.ok ? { ok: true, message: done } : { ok: false, message: result.message },
    );
    return result.ok;
  };

  return { pending, feedback, send };
}

// ─── Assegnazione manuale ────────────────────────────────────────────────────

const MAX_ROWS = 12;

function ManualAssign({
  auctionId,
  snapshot,
  pool,
  disabled,
}: {
  auctionId: string;
  snapshot: Snapshot;
  pool: PoolPlayer[];
  disabled: boolean;
}) {
  const { pending, feedback, send } = useSend(auctionId);
  const [memberId, setMemberId] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [query, setQuery] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [price, setPrice] = useState("1");
  const [force, setForce] = useState(false);

  const candidates = useMemo(
    () => assignablePlayers(pool, snapshot, role === "" ? null : role, query),
    [pool, snapshot, role, query],
  );
  const shown = candidates.slice(0, MAX_ROWS);
  const chosen = candidates.find((p) => p.id === playerId) ?? null;
  const amount = Number(price);
  const ready =
    memberId !== "" && chosen !== null && Number.isInteger(amount) && amount >= 1;

  return (
    <Box
      title="Assegna un giocatore a mano"
      hint="Il prezzo è quello che verrà scalato dai crediti: almeno 1, come qualunque offerta."
    >
      <div className="space-y-1.5">
        <Label htmlFor="assign-member">A chi</Label>
        <MemberSelect
          id="assign-member"
          members={snapshot.members}
          value={memberId}
          onChange={setMemberId}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="assign-query">Quale giocatore</Label>
        <div className="flex flex-wrap gap-1.5">
          <RoleChip label="tutti" active={role === ""} onClick={() => setRole("")} />
          {ROLES.map((r) => (
            <RoleChip
              key={r}
              label={ROLE_LABELS[r]}
              active={role === r}
              onClick={() => setRole(r)}
            />
          ))}
        </div>
        <Input
          id="assign-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cerca per nome o squadra"
          type="search"
          autoComplete="off"
        />
      </div>

      {/* Solo i liberi: chi ha già un proprietario non compare, così I2 non è
          nemmeno proponibile — e se lo fosse, il server rifiuterebbe. */}
      <ul className="max-h-52 space-y-1 overflow-y-auto">
        {shown.map((player) => (
          <li key={player.id}>
            <button
              type="button"
              aria-pressed={player.id === playerId}
              onClick={() => setPlayerId(player.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition",
                player.id === playerId
                  ? "border-foreground bg-foreground text-background"
                  : "hover:bg-accent",
              )}
            >
              <span className="min-w-0 flex-1 truncate font-medium">
                {player.name}
              </span>
              <span className="shrink-0 text-xs opacity-70">
                {player.role} · {player.team} · fvm {player.fvm}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {candidates.length === 0 && (
        <p className="text-muted-foreground text-xs">
          Nessun giocatore libero con questa ricerca.
        </p>
      )}
      {candidates.length > MAX_ROWS && (
        <p className="text-muted-foreground text-xs">
          Altri {candidates.length - MAX_ROWS} liberi: affina la ricerca.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-28 space-y-1.5">
          <Label htmlFor="assign-price">Prezzo</Label>
          <Input
            id="assign-price"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            inputMode="numeric"
            type="number"
            min={1}
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={force}
            onChange={(event) => setForce(event.target.checked)}
            className="size-4"
          />
          Forza lo slot in eccesso
        </label>
      </div>
      <p className="text-muted-foreground text-xs">
        La forzatura deroga <strong>solo</strong> al numero di slot del ruolo.
        Sui crediti non c&apos;è forzatura che tenga: ogni slot ancora vuoto deve
        restare comprabile ad almeno 1.
      </p>

      <Button
        disabled={disabled || pending || !ready}
        onClick={() => {
          if (chosen === null) return;
          void send(
            {
              type: "MANUAL_ASSIGN",
              memberId,
              playerId: chosen.id,
              price: amount,
              force,
            },
            `${chosen.name} assegnato a ${amount}.`,
          ).then((ok) => {
            if (ok) {
              setPlayerId("");
              setQuery("");
              setForce(false);
            }
          });
        }}
      >
        {pending ? "Assegno…" : "Assegna"}
      </Button>
      <Result feedback={feedback} />
    </Box>
  );
}

function RoleChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs transition",
        active ? "border-foreground bg-foreground text-background" : "hover:bg-accent",
      )}
    >
      {label}
    </button>
  );
}

// ─── Cancellazione (void) ────────────────────────────────────────────────────

function VoidAssignment({
  auctionId,
  snapshot,
  disabled,
}: {
  auctionId: string;
  snapshot: Snapshot;
  disabled: boolean;
}) {
  const { pending, feedback, send } = useSend(auctionId);
  const [memberId, setMemberId] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  const member = snapshot.members.find((m) => m.id === memberId) ?? null;

  return (
    <Box
      title="Cancella un giocatore da una rosa"
      hint="La riga non viene distrutta: resta a database come annullata, e i crediti risalgono."
    >
      <div className="space-y-1.5">
        <Label htmlFor="void-member">Da quale rosa</Label>
        <MemberSelect
          id="void-member"
          members={snapshot.members}
          value={memberId}
          onChange={(value) => {
            setMemberId(value);
            setConfirming(null);
          }}
        />
      </div>

      {member !== null && member.roster.length === 0 && (
        <p className="text-muted-foreground text-xs">
          Questa rosa è ancora vuota.
        </p>
      )}

      {member !== null && (
        <ul className="max-h-52 space-y-1 overflow-y-auto">
          {member.roster.map((entry) => (
            <li
              key={entry.assignmentId}
              className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{entry.name}</span>{" "}
                <span className="text-muted-foreground text-xs">
                  {entry.role} · {entry.team}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">{entry.price}</span>
              {/* Due click, non uno: cancellare una rosa per un tocco sbagliato
                  sarebbe l'errore che questo pannello dovrebbe riparare. */}
              {confirming === entry.assignmentId ? (
                <span className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={disabled || pending}
                    onClick={() => {
                      void send(
                        { type: "VOID_ASSIGNMENT", assignmentId: entry.assignmentId },
                        `${entry.name} tolto da ${member.teamName}: ${entry.price} crediti restituiti.`,
                      ).then(() => setConfirming(null));
                    }}
                  >
                    {pending ? "…" : "Confermo"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirming(null)}
                  >
                    No
                  </Button>
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled || pending}
                  onClick={() => setConfirming(entry.assignmentId)}
                >
                  Cancella
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Result feedback={feedback} />
    </Box>
  );
}

// ─── Rettifica dei crediti ───────────────────────────────────────────────────

function AdjustBudget({
  auctionId,
  snapshot,
  disabled,
}: {
  auctionId: string;
  snapshot: Snapshot;
  disabled: boolean;
}) {
  const { pending, feedback, send } = useSend(auctionId);
  const [memberId, setMemberId] = useState("");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");

  const amount = Number(delta);
  const ready =
    memberId !== "" &&
    delta.trim() !== "" &&
    Number.isInteger(amount) &&
    amount !== 0 &&
    reason.trim() !== "";

  return (
    <Box
      title="Rettifica i crediti"
      hint="Una riga in più nel registro, con il motivo: nessun numero viene sovrascritto."
    >
      <div className="space-y-1.5">
        <Label htmlFor="adjust-member">A chi</Label>
        <MemberSelect
          id="adjust-member"
          members={snapshot.members}
          value={memberId}
          onChange={setMemberId}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-28 space-y-1.5">
          <Label htmlFor="adjust-delta">Crediti</Label>
          <Input
            id="adjust-delta"
            value={delta}
            onChange={(event) => setDelta(event.target.value)}
            placeholder="−10"
            inputMode="numeric"
            type="number"
          />
        </div>
        <div className="min-w-48 flex-1 space-y-1.5">
          <Label htmlFor="adjust-reason">Motivo</Label>
          <Input
            id="adjust-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Perché, in due parole"
          />
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        Un numero negativo toglie crediti, uno positivo li aggiunge. Il motivo è
        obbligatorio: fra sei mesi «−20» senza spiegazione è indistinguibile da
        un errore di battitura.
      </p>

      <Button
        disabled={disabled || pending || !ready}
        onClick={() => {
          void send(
            { type: "ADJUST_BUDGET", memberId, delta: amount, reason: reason.trim() },
            `Rettifica di ${amount > 0 ? "+" : ""}${amount} registrata.`,
          ).then((ok) => {
            if (ok) {
              setDelta("");
              setReason("");
            }
          });
        }}
      >
        {pending ? "Registro…" : "Registra la rettifica"}
      </Button>
      <Result feedback={feedback} />
    </Box>
  );
}
