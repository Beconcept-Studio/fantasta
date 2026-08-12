"use client";

import { useMemo, useState } from "react";

import { SetPieceBadges, TitolaritaBadge } from "@/components/auction/insights";
import { Input } from "@/components/ui/input";
import { ROLES, ROLE_LABELS, type Role, showableInsights } from "@/lib/domain";
import type { CentroDatiRow } from "@/lib/engine/listone";
import { cn } from "@/lib/utils";

/**
 * Il Centro dati (M10 §6): tutto il listone a sistema, con gli insight accanto.
 *
 * ⚠ **Search e filtro girano nel browser, su un payload solo.** Cinquecento
 * righe con gli insight dentro sono ~250 KB — un numero che conosciamo perché è
 * già stato pagato una volta al giorno da ogni telefono in `/play` (misura di
 * M8: 241 KB per il pool intero con insight, sopra HTTP). Niente paginazione,
 * niente `?q=` sul server, niente debounce contro un endpoint: la ricerca è un
 * `filter` su un array che è già in memoria, e risponde mentre si scrive. Se un
 * giorno il listone avesse cinquemila righe sarà il momento di cambiare, e non
 * prima (regola 8).
 *
 * ⚠ **La colonna `FVM/1000` non c'è**, per decisione dell'owner: qui si legge la
 * quotazione, che è il numero con cui si compra. Ma **`fvm` resta a database** —
 * `players_autopick_idx` ordina per `fvm` DESC e quell'ordinamento *è*
 * l'auto-pick: toglierlo dalla copia cambierebbe chi viene scelto allo scadere di
 * una chiamata, per una decisione di layout (M10 §2).
 *
 * ⚠ **`Fuori lista` è un segno accanto al nome, non una colonna.** Riguarda meno
 * del 5% delle righe e una settima colonna vuota per il resto stringerebbe le due
 * che si leggono davvero; ma va detto, perché è l'unica cosa in questa tabella
 * che **cambia il comportamento di un'asta**.
 *
 * ⚠ **Nessun `dark:`** (`CLAUDE.md`): l'applicazione gira in chiaro.
 */
export function CentroDatiTable({ rows }: { rows: CentroDatiRow[] }) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<Role | null>(null);

  // I nomi normalizzati si calcolano **una volta**, non a ogni tasto: cercare
  // «Dzeko» scrivendo «dze» vuol dire togliere i segni diacritici a cinquecento
  // stringhe, e farlo dentro il `filter` lo rifarebbe a ogni lettera.
  const searchable = useMemo(
    () => rows.map((row) => `${fold(row.name)} ${fold(row.team)}`),
    [rows],
  );

  const shown = useMemo(() => {
    const needle = fold(query.trim());
    return rows.filter((row, index) => {
      if (role !== null && row.role !== role) return false;
      if (needle === "") return true;
      return searchable[index].includes(needle);
    });
  }, [rows, searchable, query, role]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cerca un calciatore o una squadra…"
          className="max-w-xs"
          aria-label="Cerca un calciatore"
        />
        <div className="flex gap-1" role="group" aria-label="Filtra per ruolo">
          <RoleChip active={role === null} onClick={() => setRole(null)}>
            Tutti
          </RoleChip>
          {ROLES.map((r) => (
            <RoleChip
              key={r}
              active={role === r}
              onClick={() => setRole(role === r ? null : r)}
              title={ROLE_LABELS[r]}
            >
              {r}
            </RoleChip>
          ))}
        </div>
        <p className="text-muted-foreground text-sm tabular-nums">
          {shown.length === rows.length
            ? `${rows.length} giocatori`
            : `${shown.length} di ${rows.length}`}
        </p>
      </div>

      {shown.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          Nessun calciatore con questo nome{role !== null && ` fra i ${ROLE_LABELS[role].toLowerCase()}`}.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] border-separate border-spacing-0 text-sm">
            {/*
              La testata resta in cima mentre si scorre: con cinquecento righe,
              una testata che scompare vuol dire non sapere più cosa sia la
              colonna dei numeri. `bg-background` è obbligatorio — senza, le
              righe le passerebbero sotto in trasparenza.
            */}
            <thead className="text-muted-foreground sticky top-0 z-10 text-xs">
              <tr className="bg-background">
                <Th className="text-left">Calciatore</Th>
                <Th className="text-left">Sq.</Th>
                <Th className="text-left">R.</Th>
                <Th className="text-right">Quot.</Th>
                <Th className="text-left">Titolarità</Th>
                <Th className="text-left">Rigori e piazzati</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const insights = showableInsights(row.insights);
                return (
                  <tr key={row.extId} className="hover:bg-muted/40">
                    <Td>
                      {row.name}
                      {row.outOfList && (
                        <span
                          className="text-muted-foreground ml-2 text-xs"
                          title="Fuori lista: escluso dal pool, salvo che l'asta non li includa"
                        >
                          · fuori lista
                        </span>
                      )}
                    </Td>
                    <Td className="text-muted-foreground">{row.team}</Td>
                    <Td className="font-mono text-xs">{row.role}</Td>
                    <Td className="text-right tabular-nums">{row.quot}</Td>
                    <Td>
                      {insights === null ? (
                        <Missing />
                      ) : (
                        <TitolaritaBadge insights={insights} compact />
                      )}
                    </Td>
                    <Td>
                      {insights === null ? (
                        <Missing />
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          <SetPieceBadges insights={insights} compact />
                        </span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Chi non ha niente da dire lo dice con un trattino, non con un badge a zero.
 *
 * ⚠ Sono **due** i motivi per cui compare, e a schermo si equivalgono: nessuna
 * riga di insight (il listone e la fonte non coincidono), oppure numeri della
 * stagione **precedente**, che `showableInsights` scarta perché un numero del
 * campionato scorso accanto a uno di quest'anno è un confronto falso (M8 §5).
 */
function Missing() {
  return <span className="text-muted-foreground font-mono">—</span>;
}

function Th({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <th className={cn("border-b px-2 py-2 font-medium", className)}>
      {children}
    </th>
  );
}

function Td({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <td className={cn("border-b px-2 py-1.5", className)}>{children}</td>;
}

function RoleChip({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "rounded-md border px-2.5 py-1 text-sm transition",
        active
          ? "bg-foreground text-background border-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Minuscolo e senza segni diacritici: chi cerca «Dzeko» scrive «dzeko», non
 * «Džeko», e chi cerca «Perisic» non ha la `ć` sulla tastiera.
 */
function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}
