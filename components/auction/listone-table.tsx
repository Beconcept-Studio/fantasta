"use client";

import { Bookmark, Search } from "lucide-react";
import React, { useState } from "react";

import { CarmyTags } from "@/components/auction/insights";
import { ListoneImport } from "@/components/auction/listone-import";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ROLES, type Role, pmaCrediti } from "@/lib/domain";
import { type ListoneGroup, listoneRows } from "@/lib/realtime/portal";
import type { PoolPlayer, Snapshot } from "@/lib/realtime/types";
import type { UserListoneStatus } from "@/lib/engine/user-listone";
import { cn } from "@/lib/utils";

/**
 * La tab Listone (M21 §4): chi è ancora libero, raggruppato per fascia.
 *
 * ## Cos'è, in una riga
 *
 * Il posto in cui guardare **chi resta** nei venti minuti in cui tocca agli
 * altri — che sono la stragrande maggioranza della serata. Fino a M21 la lista
 * dei giocatori esisteva solo dentro il pannello di chiamata, cioè si apriva solo
 * quando toccava a me e spariva appena avevo scelto.
 *
 * ## ⚠ Non fa nessuna query, e non ascolta nessun evento
 *
 * «Sincronizzata in tempo reale con ogni lotto» è già risolto dal fatto che la
 * tabella è **funzione pura del pool e dello snapshot**: quando un lotto chiude,
 * la rosa del vincitore cambia, lo snapshot arriva, la riga sparisce. È I10 senza
 * scrivere una riga per ottenerlo, ed è anche il motivo per cui chi ricarica a
 * metà asta vede esattamente la stessa tabella di chi non si è mosso.
 *
 * Tutta la logica sta in `listoneRows`, che è pura e ha i suoi test. Qui c'è
 * **solo** rendering — più due pezzi di stato che sono preferenze di chi guarda:
 * i filtri.
 *
 * ## Due forme, una sola in pagina
 *
 * Da `md` una tabella; sotto, un elenco su tre righe. Non è la stessa tabella con
 * `overflow-x-auto`: quella strada è stata guardata nella fase di progettazione e
 * scartata, perché chiede di scorrere in orizzontale la cosa principale di una
 * tab, su un telefono, durante un'asta.
 */
export function ListoneTable({
  auctionId,
  pool,
  snapshot,
  budget,
  status,
}: {
  auctionId: string;
  pool: PoolPlayer[];
  snapshot: Snapshot;
  /** I crediti di partenza, per tradurre il `PMA` in una cifra offribile. */
  budget: number;
  /** Cosa ho già importato: serve al modale e allo stato vuoto. */
  status: UserListoneStatus;
}) {
  /**
   * ⚠ **`null` non è «nessun ruolo»: è «segui il ruolo in gioco»** (decisione 9).
   * Finché non tocco i pulsanti, la tabella mostra il reparto che si sta
   * comprando — che è quello che si vuole guardare nel 99% dei casi; appena ne
   * tocco uno, il filtro è mio e non si muove più fino al ricarico della pagina.
   *
   * Una tabella che cambia sotto le dita mentre l'asta passa da un ruolo
   * all'altro sarebbe la stessa cosa di un pannello che si riapre da solo.
   */
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [query, setQuery] = useState("");
  const [soloObiettivi, setSoloObiettivi] = useState(false);

  const inGioco = snapshot.auction.currentRole;
  const attivi = roles ?? (inGioco === null ? [] : [inGioco]);

  const groups = listoneRows(pool, snapshot, {
    roles: attivi,
    query,
    soloObiettivi,
  });
  const quanti = groups.reduce((n, g) => n + g.players.length, 0);

  // Chi ha importato lo dice il pool, che il server ha già risolto: nessuna
  // seconda fonte di verità sullo stesso fatto.
  const hoImportato = pool.some((p) => p.mio);
  const inAstaId = snapshot.currentLot?.player.id ?? null;

  function toggleRole(role: Role) {
    setRoles((prima) => {
      const base = prima ?? (inGioco === null ? [] : [inGioco]);
      return base.includes(role)
        ? base.filter((r) => r !== role)
        : [...base, role];
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cerca un giocatore o una squadra"
              className="pl-8"
              aria-label="Cerca un giocatore o una squadra"
            />
          </div>
          <ListoneImport auctionId={auctionId} status={status} />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {ROLES.map((role) => (
            <Button
              key={role}
              size="sm"
              variant={attivi.includes(role) ? "default" : "outline"}
              onClick={() => toggleRole(role)}
              className="w-9"
              aria-pressed={attivi.includes(role)}
            >
              {role}
            </Button>
          ))}
          <span className="bg-border mx-1 h-5 w-px" />
          <Button
            size="sm"
            variant={soloObiettivi ? "default" : "outline"}
            onClick={() => setSoloObiettivi((v) => !v)}
            aria-pressed={soloObiettivi}
          >
            <Bookmark className={cn(soloObiettivi && "fill-current")} />
            Obiettivi
          </Button>
          <span className="text-muted-foreground ml-auto text-xs tabular-nums">
            {quanti} disponibili
          </span>
        </div>
      </div>

      {!hoImportato && (
        /*
         * ⚠ **Lo stato vuoto non è una tabella vuota**: chi non ha importato vede
         * comunque tutte le righe, coi valori del foglio a sistema (decisione 1).
         * Questa è solo la riga che spiega cosa manca — gli obiettivi e le proprie
         * fasce — e sta sopra una tabella piena, non al posto suo.
         */
        <p className="text-muted-foreground bg-muted/50 rounded-lg px-3 py-2 text-xs">
          Stai guardando le fasce e i prezzi del foglio a sistema. Importa il tuo
          per vedere <strong>i tuoi obiettivi</strong> e le tue fasce: vale solo
          per te, e in tutte le aste a cui partecipi.
        </p>
      )}

      {quanti === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          {soloObiettivi && !hoImportato
            ? "Non hai obiettivi: si mettono dal file, con la colonna «Obiett.»."
            : "Nessun giocatore libero con questi filtri."}
        </p>
      ) : (
        <>
          <div className="hidden md:block">
            <TabellaLarga
              groups={groups}
              budget={budget}
              inAstaId={inAstaId}
            />
          </div>
          <div className="md:hidden">
            <ElencoStretto groups={groups} inAstaId={inAstaId} />
          </div>
        </>
      )}
    </div>
  );
}

/** L'intestazione di un gruppo. `null` è il gruppo «Senza fascia», in fondo. */
function titolo(fascia: string | null): string {
  return fascia ?? "Senza fascia";
}

// ─── Da `md` in su: una tabella ──────────────────────────────────────────────

function TabellaLarga({
  groups,
  budget,
  inAstaId,
}: {
  groups: ListoneGroup[];
  budget: number;
  inAstaId: string | null;
}) {
  return (
    <table className="w-full border-separate border-spacing-0 text-sm">
      <thead className="text-muted-foreground text-xs">
        <tr className="bg-background">
          <th className="w-8 border-b px-2 py-2">
            <span className="sr-only">Obiettivo</span>
          </th>
          <th className="w-8 border-b px-2 py-2 text-left font-medium">R</th>
          <th className="border-b px-2 py-2 text-left font-medium">Giocatore</th>
          <th className="border-b px-2 py-2 text-right font-medium">PMA</th>
          <th className="border-b px-2 py-2 text-right font-medium">FMV Exp.</th>
          <th className="border-b px-2 py-2 text-right font-medium">Gol</th>
          <th className="border-b px-2 py-2 text-right font-medium">Ass.</th>
          <th className="border-b px-2 py-2 text-left font-medium">Note</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <React.Fragment key={titolo(group.fascia)}>
            <tr className="bg-muted/60">
              <td colSpan={8} className="border-b px-2 py-1.5">
                <span className="text-xs font-semibold">
                  {titolo(group.fascia)}
                </span>
                <span className="text-muted-foreground ml-2 text-xs tabular-nums">
                  · {group.players.length}
                </span>
              </td>
            </tr>
            {group.players.map((p) => (
              <tr key={p.id} className="hover:bg-muted/40">
                <td className="border-b px-2 py-1.5">
                  <IconaObiettivo obiettivo={p.obiettivo === true} />
                </td>
                <td className="border-b px-2 py-1.5">
                  <span className="text-muted-foreground font-mono text-xs">
                    {p.role}
                  </span>
                </td>
                <td className="border-b px-2 py-1.5">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground ml-2 text-xs">
                    {p.team}
                  </span>
                  {p.id === inAstaId && <InAsta />}
                </td>
                <td className="border-b px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                  {p.carmy?.pma == null ? (
                    <Vuoto />
                  ) : (
                    <>
                      {p.carmy.pma}%{" "}
                      {/*
                        ⚠ I crediti accanto alla percentuale, come nella lista di
                        chiamata e con la stessa `pmaCrediti`: una percentuale non
                        si può offrire, e sotto un countdown nessuno la converte a
                        mente. Sul telefono non c'è la larghezza e resta solo il
                        `%` — è il primo posto in cui questa macro paga il fatto
                        che il portale è mobile-first (decisione 10, corretta dalla
                        fase di progettazione).
                      */}
                      <span className="text-muted-foreground text-xs">
                        ({pmaCrediti(p.carmy.pma, budget)})
                      </span>
                    </>
                  )}
                </td>
                <td className="border-b px-2 py-1.5 text-right tabular-nums">
                  {p.carmy?.fmvExp ?? <Vuoto />}
                </td>
                <td className="border-b px-2 py-1.5 text-right tabular-nums">
                  {p.insights?.golFatti ?? <Vuoto />}
                </td>
                <td className="border-b px-2 py-1.5 text-right tabular-nums">
                  {p.insights?.assist ?? <Vuoto />}
                </td>
                <td className="border-b px-2 py-1.5">
                  <span className="flex flex-wrap gap-1">
                    {p.carmy !== undefined && (
                      <CarmyTags tags={p.carmy.tags} compact />
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  );
}

// ─── Sotto `md`: un elenco, non una tabella che scorre di lato ───────────────

function ElencoStretto({
  groups,
  inAstaId,
}: {
  groups: ListoneGroup[];
  inAstaId: string | null;
}) {
  return (
    <div>
      {groups.map((group) => (
        <div key={titolo(group.fascia)}>
          <div className="bg-muted/60 border-y px-3 py-1.5">
            <span className="text-xs font-semibold">{titolo(group.fascia)}</span>
            <span className="text-muted-foreground ml-2 text-xs tabular-nums">
              · {group.players.length}
            </span>
          </div>
          <div className="divide-y">
            {group.players.map((p) => (
              <div key={p.id} className="flex items-start gap-2 px-1 py-2.5">
                <IconaObiettivo
                  obiettivo={p.obiettivo === true}
                  className="mt-0.5 shrink-0"
                />

                {/*
                  ⚠ `min-w-0` è ciò che permette al nome di troncare invece di
                  spingere il `PMA` fuori schermo: senza, il flex item non scende
                  sotto la larghezza del proprio contenuto.
                  ⚠ **Il nome tronca senza `min-w-0` sugli anelli interni, ed è
                  misurato**: a 375px il caso peggiore vero delle 495 righe —
                  «Milinkovic-Savic V. · Napoli» — sta dentro, `scrollWidth` resta
                  375 e nessun PMA esce. Se un anno entrasse un nome più lungo, il
                  rimedio è `min-w-0` **su ogni anello**, non solo sul padre.
                */}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-muted-foreground shrink-0 font-mono text-xs">
                      {p.role}
                    </span>
                    <span className="truncate font-medium">{p.name}</span>
                    <span className="text-muted-foreground shrink-0 truncate text-xs">
                      {p.team}
                    </span>
                    {p.id === inAstaId && <InAsta />}
                  </div>
                  <div className="text-muted-foreground flex gap-3 text-xs tabular-nums">
                    <span>
                      <span className="opacity-70">exp </span>
                      {p.carmy?.fmvExp ?? "—"}
                    </span>
                    <span>
                      <span className="opacity-70">gol </span>
                      {p.insights?.golFatti ?? "—"}
                    </span>
                    <span>
                      <span className="opacity-70">ass </span>
                      {p.insights?.assist ?? "—"}
                    </span>
                  </div>
                  {p.carmy !== undefined && p.carmy.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      <CarmyTags tags={p.carmy.tags} max={3} compact />
                    </div>
                  )}
                </div>

                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {p.carmy?.pma == null ? "—" : `${p.carmy.pma}%`}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── I pezzi piccoli ─────────────────────────────────────────────────────────

/**
 * ⚠ **C'è su ogni riga, grigia o verde** (decisione dell'owner, fase di
 * progettazione del 2026-08-28). L'alternativa guardata era mostrarla solo sugli
 * obiettivi, con uno spazio vuoto altrove, ed è stata scartata: una colonna che a
 * volte c'è e a volte no si legge come un difetto di allineamento.
 */
function IconaObiettivo({
  obiettivo,
  className,
}: {
  obiettivo: boolean;
  className?: string;
}) {
  return (
    <Bookmark
      className={cn(
        "size-4",
        obiettivo
          ? "fill-emerald-600 text-emerald-600"
          : "text-muted-foreground/40",
        className,
      )}
      aria-label={obiettivo ? "Obiettivo" : undefined}
    />
  );
}

/**
 * ⚠ **Il giocatore in asta adesso resta in tabella, con un badge.** Non è ancora
 * di nessuno — le rose non l'hanno — e farlo sparire prima dell'assegnazione
 * sarebbe una bugia che si corregge da sé: se il lotto va deserto, quel giocatore
 * torna disponibile.
 */
function InAsta() {
  return (
    <Badge className="ml-2 h-4.5 shrink-0 bg-amber-600 px-1.5 text-[10px] text-white">
      in asta
    </Badge>
  );
}

/** Il trattino di «non ce l'ho», che non è uno zero. */
function Vuoto() {
  return <span className="text-muted-foreground font-mono">—</span>;
}
