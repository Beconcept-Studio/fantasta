"use client";

import { useMemo, useState } from "react";

import {
  CarmyTags,
  FasciaBadge,
  SetPieceBadges,
  TitolaritaAnyBadge,
} from "@/components/auction/insights";
import { Input } from "@/components/ui/input";
import {
  type CentroDatiSort,
  DEFAULT_SORT,
  NO_FILTERS,
  type SortKey,
  arrangeRows,
  nextSort,
  searchableText,
} from "@/lib/centro-dati";
import {
  GIORNATE,
  ROLES,
  ROLE_LABELS,
  type Role,
  bestSetPieceRank,
  showableInsights,
} from "@/lib/domain";
import type { CentroDatiRow } from "@/lib/engine/listone";
import { cn } from "@/lib/utils";

/**
 * Il Centro dati (M10 §6): tutto il listone a sistema, con gli insight accanto.
 *
 * ⚠ **Search, filtri e ordinamento girano nel browser, su un payload solo.**
 * Cinquecento righe con gli insight dentro sono ~250 KB — un numero che
 * conosciamo perché è già pagato una volta al giorno da ogni telefono in
 * `/play` (misura di M8: 241 KB per il pool intero con insight, sopra HTTP).
 * Niente paginazione, niente `?q=` o `?sort=` sul server, niente debounce contro
 * un endpoint: è un `filter` e un `sort` su un array che è già in memoria, e
 * rispondono mentre si scrive. Se un giorno il listone avesse cinquemila righe
 * sarà il momento di cambiare, e non prima (regola 8).
 *
 * ⚠ **L'ordinamento vero sta in `lib/centro-dati.ts`, non qui.** È l'unica parte
 * di questa pagina che può sbagliarsi in silenzio — una lista ordinata male non
 * dà nessun errore, dà una lista plausibile — quindi vive in funzioni pure con i
 * loro test, e questo file si occupa solo di disegnarla.
 *
 * ⚠ **La colonna `FVM/1000` non c'è**, per decisione dell'owner: qui si legge la
 * quotazione, che è il numero con cui si compra, ed è anche l'ordinamento di
 * partenza — dal più alto al più basso. Ma **`fvm` resta a database**:
 * `players_autopick_idx` ordina per `fvm` DESC e quell'ordinamento *è*
 * l'auto-pick, quindi toglierlo dalla copia cambierebbe chi viene scelto allo
 * scadere di una chiamata, per una decisione di layout (M10 §2).
 *
 * ⚠ **`Fuori lista` è un segno accanto al nome, non una colonna.** Riguarda meno
 * del 5% delle righe e una settima colonna vuota per il resto stringerebbe le due
 * che si leggono davvero; ma va detto, perché è l'unica cosa in questa tabella
 * che **cambia il comportamento di un'asta**.
 *
 * ⚠ **Nessun `dark:`** (`CLAUDE.md`): l'applicazione gira in chiaro.
 */
export function CentroDatiTable({
  rows,
  tags = [],
}: {
  rows: CentroDatiRow[];
  /** I tag che esistono davvero a sistema, con la loro frequenza (M10B §6). */
  tags?: { tag: string; count: number }[];
}) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const [onlySetPieces, setOnlySetPieces] = useState(false);
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<CentroDatiSort>(DEFAULT_SORT);

  // I nomi normalizzati si calcolano **una volta**, non a ogni tasto: cercare
  // «Dzeko» scrivendo «dze» vuol dire togliere i segni diacritici a cinquecento
  // stringhe, e farlo dentro il `filter` lo rifarebbe a ogni lettera.
  const searchable = useMemo(() => rows.map(searchableText), [rows]);

  const shown = useMemo(
    () =>
      arrangeRows(
        rows,
        { ...NO_FILTERS, query, role, onlySetPieces, tag },
        sort,
        searchable,
      ),
    [rows, searchable, query, role, onlySetPieces, tag, sort],
  );

  // Quanti sarebbero, se si premesse il filtro: un numero accanto a
  // un'etichetta spiega cosa fa il pulsante meglio dell'etichetta da sola.
  const designati = useMemo(
    () => rows.filter((row) => bestSetPieceRank(row.insights) !== null).length,
    [rows],
  );

  function sortBy(key: SortKey) {
    setSort((current) => nextSort(current, key));
  }

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
          <Chip active={role === null} onClick={() => setRole(null)}>
            Tutti
          </Chip>
          {ROLES.map((r) => (
            <Chip
              key={r}
              active={role === r}
              onClick={() => setRole(role === r ? null : r)}
              title={ROLE_LABELS[r]}
            >
              {r}
            </Chip>
          ))}
        </div>

        <Chip
          active={onlySetPieces}
          onClick={() => setOnlySetPieces(!onlySetPieces)}
          title="Solo chi batte rigori o calci piazzati"
        >
          Rigori e piazzati{" "}
          <span className="tabular-nums opacity-70">{designati}</span>
        </Chip>

        <p className="text-muted-foreground text-sm tabular-nums">
          {shown.length === rows.length
            ? `${rows.length} giocatori`
            : `${shown.length} di ${rows.length}`}
        </p>
      </div>

      {/*
        ⚠ **Il fratello del filtro «rigori e piazzati»** (M10B §6): i tag di Carmy,
        letti **dai dati** e non da un elenco scritto a mano — chi compila il foglio
        ne aggiungerà uno, e un elenco fisso vorrebbe dire un filtro che non lo
        mostra senza che nessuno sappia perché. Su una riga sua e non accanto ai
        ruoli: sono diciassette, e mescolati agli altri controlli li renderebbero
        illeggibili tutti. Uno per volta, non un elenco: vedi `CentroDatiFilters`.
      */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filtra per tag">
          <Chip active={tag === null} onClick={() => setTag(null)}>
            Tutti i tag
          </Chip>
          {tags.map((t) => (
            <Chip
              key={t.tag}
              active={tag === t.tag}
              onClick={() => setTag(tag === t.tag ? null : t.tag)}
            >
              {t.tag}{" "}
              <span className="tabular-nums opacity-70">{t.count}</span>
            </Chip>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          Nessun calciatore con questi filtri.
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
                <Th sortKey="name" sort={sort} onSort={sortBy}>
                  Calciatore
                </Th>
                <Th sortKey="team" sort={sort} onSort={sortBy}>
                  Sq.
                </Th>
                <Th sortKey="role" sort={sort} onSort={sortBy}>
                  R.
                </Th>
                <Th sortKey="quot" sort={sort} onSort={sortBy} align="right">
                  Quot.
                </Th>
                <Th sortKey="titolarita" sort={sort} onSort={sortBy}>
                  Titolarità
                </Th>
                <Th sortKey="piazzati" sort={sort} onSort={sortBy}>
                  Rigori e piazzati
                </Th>
                {/* ─── Dal foglio di Carmy (M10B §6) ─── */}
                <Th sortKey="fascia" sort={sort} onSort={sortBy}>
                  Fascia
                </Th>
                <Th sortKey="prezzo" sort={sort} onSort={sortBy} align="right">
                  Consigl.
                </Th>
                <Th
                  sortKey="affidabilita"
                  sort={sort}
                  onSort={sortBy}
                  align="right"
                >
                  Affid.
                </Th>
                <Th sortKey="integrita" sort={sort} onSort={sortBy} align="right">
                  Integr.
                </Th>
                <th className="border-b px-2 py-2 text-left font-medium">
                  Note
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const stagione = showableInsights(row.insights);
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
                    {/*
                      ⚠ **Una colonna sola con due fonti dentro** (M10B §4): il
                      giudizio di Carmy quando c'è, il badge calcolato dalle
                      presenze quando non c'è. La scelta la fa `titolarita()` in
                      `lib/domain.ts`, in un posto solo — qui non c'è nessun `if`
                      sulla provenienza da tenere allineato con il portale. Accanto,
                      in grigio, il rapporto grezzo: è la prova del giudizio, e
                      quando i due divergono quella divergenza è l'informazione.
                    */}
                    <Td>
                      {row.carmy === undefined && stagione === null ? (
                        <Missing />
                      ) : (
                        <span className="flex flex-wrap items-center gap-1">
                          <TitolaritaAnyBadge
                            insights={row.insights}
                            carmy={row.carmy}
                            compact
                          />
                          {row.carmy?.titolarita != null && stagione !== null && (
                            <span className="text-muted-foreground text-xs tabular-nums">
                              {stagione.startsEleven}/{GIORNATE}
                            </span>
                          )}
                        </span>
                      )}
                    </Td>
                    {/*
                      ⚠ **Qui non si passa da `showableInsights`**, a differenza
                      della colonna accanto. I due rank vengono dalla fonte B e
                      dicono la gerarchia **di adesso**: non sono numeri di
                      stagione, e nasconderli a chi ha le statistiche dell'anno
                      scorso vorrebbe dire perdere 22 designati su 92 — quasi un
                      quarto — proprio dentro il filtro che serve a trovarli.
                    */}
                    <Td>
                      {row.insights === undefined ||
                      bestSetPieceRank(row.insights) === null ? (
                        <Missing />
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          <SetPieceBadges insights={row.insights} compact />
                        </span>
                      )}
                    </Td>

                    {/* ─── Dal foglio di Carmy ─── */}
                    <Td>
                      {row.carmy?.fascia == null ? (
                        <Missing />
                      ) : (
                        <FasciaBadge fascia={row.carmy.fascia} compact />
                      )}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {row.carmy?.prezzo ?? <Missing />}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {row.carmy?.affidabilita ?? <Missing />}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {row.carmy?.integrita ?? <Missing />}
                    </Td>
                    {/*
                      Le note per esteso: qui c'è lo spazio, e sono la parte del
                      foglio che nessuna fonte pubblica ha. Il commento, che esiste
                      su dieci portieri, sta nel `title`: è multi-riga e in tabella
                      spaccherebbe la griglia.
                    */}
                    <Td>
                      {row.carmy === undefined || row.carmy.tags.length === 0 ? (
                        <Missing />
                      ) : (
                        <span
                          className="flex flex-wrap gap-1"
                          title={row.carmy.commento ?? undefined}
                        >
                          <CarmyTags tags={row.carmy.tags} compact />
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
 * Nella colonna della titolarità sono **due** i motivi, e a schermo si
 * equivalgono: nessuna riga di insight, oppure numeri della stagione precedente,
 * che `showableInsights` scarta perché un numero del campionato scorso accanto a
 * uno di quest'anno è un confronto falso (M8 §5). In quella dei piazzati il
 * motivo è uno solo: non è designato.
 */
function Missing() {
  return <span className="text-muted-foreground font-mono">—</span>;
}

/**
 * Un'intestazione che ordina.
 *
 * È un `<button>` dentro il `<th>`, non un `<th onClick>`: si raggiunge con il
 * tab, si preme con la barra spaziatrice, e `aria-sort` dice a chi legge con uno
 * screen reader su quale colonna è ordinata la tabella e in che verso. La
 * freccia compare **solo sulla colonna attiva**: sei frecce grigie sarebbero sei
 * pulsanti che sembrano tutti premuti.
 */
function Th({
  sortKey,
  sort,
  onSort,
  align = "left",
  children,
}: {
  sortKey: SortKey;
  sort: CentroDatiSort;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const active = sort.key === sortKey;

  return (
    <th
      aria-sort={
        active
          ? sort.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
      className={cn(
        "border-b px-2 py-2 font-medium",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "hover:text-foreground inline-flex items-center gap-1 transition",
          align === "right" && "flex-row-reverse",
          active && "text-foreground",
        )}
      >
        {children}
        <span aria-hidden className="text-[10px]">
          {active ? (sort.direction === "asc" ? "▲" : "▼") : ""}
        </span>
      </button>
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

function Chip({
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
