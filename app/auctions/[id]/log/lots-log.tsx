"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { type LogLot, romeTime } from "@/lib/auction-log";
import { ROLE_LABELS_ONE } from "@/lib/domain";

/**
 * I lotti dello storico, con il campo di ricerca sopra (M3 §4).
 *
 * È l'unico pezzo client di questa sezione, e lo è per una ragione sola: il
 * filtro. Le righe arrivano già rese dal server — questo componente non chiede
 * niente a nessuno e non riceve niente dallo stream — e la ricerca lavora sul
 * `searchText` che il server ha precalcolato, così il confronto non ricompone la
 * stessa stringa a ogni tasto premuto.
 *
 * Importa `lib/auction-log` e `lib/domain`, che sono moduli puri: nessun ORM
 * viaggia fino al telefono.
 *
 * ⚠ Qui arrivano **solo lotti risolti**. Il filtro che lo garantisce è
 * `isPublicLot`, applicato in `lib/engine/log.ts`, e non va replicato né
 * indebolito qui: questa è presentazione, e I8 non si difende in presentazione.
 *
 * Il dettaglio sta in un `<details>` nativo e non in uno stato React: si apre
 * senza JavaScript, il browser lo sa fare da sé, e con trecento lotti non c'è
 * niente da tenere in memoria. Il costo dichiarato è che l'HTML di tutti i
 * dettagli viaggia al primo caricamento — circa 300 KB su un'asta piena.
 */
export function LotsLog({ lots }: { lots: LogLot[] }) {
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return lots;
    return lots.filter((lot) => lot.searchText.includes(needle));
  }, [lots, query]);

  if (lots.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nessun lotto si è ancora concluso.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Cerca un giocatore, una squadra, un numero di lotto…"
        aria-label="Cerca nei lotti"
        autoComplete="off"
      />

      <p className="text-muted-foreground text-sm" aria-live="polite">
        {query.trim() === ""
          ? `${lots.length} ${lots.length === 1 ? "lotto concluso" : "lotti conclusi"}`
          : `${shown.length} su ${lots.length}`}
      </p>

      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nessun lotto per «{query.trim()}».
        </p>
      ) : (
        <ul className="divide-border divide-y rounded-md border">
          {shown.map((lot) => (
            <li key={lot.seq}>
              <LotRow lot={lot} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LotRow({ lot }: { lot: LogLot }) {
  return (
    <details className="group">
      <summary className="hover:bg-muted/50 flex cursor-pointer flex-wrap items-baseline gap-x-2 gap-y-1 p-3 text-sm">
        <span className="text-muted-foreground font-mono">#{lot.seq}</span>
        <span className="font-medium">{lot.player.name}</span>
        <span className="text-muted-foreground">
          {ROLE_LABELS_ONE[lot.player.role]}, {lot.player.team}
        </span>
        {lot.voided && (
          // Regola 5 — il lotto resta, marcato. Lo storico non nasconde le
          // riassegnazioni: sono proprio quelle di cui si discute.
          <Badge variant="destructive">annullato</Badge>
        )}
        <span className="ml-auto whitespace-nowrap">
          → <span className="font-medium">{lot.winnerTeamName}</span>,{" "}
          {lot.price}
        </span>
      </summary>

      <div className="bg-muted/30 space-y-3 border-t p-3 text-sm">
        <p className="text-muted-foreground">
          Chiamato{" "}
          {lot.autoCalled ? (
            <>d&apos;ufficio per <strong>{lot.calledByTeamName}</strong></>
          ) : (
            <>da <strong>{lot.calledByTeamName}</strong></>
          )}
          , concluso alle {romeTime(lot.resolvedAt)}.
        </p>

        {lot.rounds.map((round) => (
          <div key={round.roundNo} className="space-y-1">
            <p className="font-medium">
              Round {round.roundNo}{" "}
              <span className="text-muted-foreground font-normal">
                · minimo {round.minAmount} · {round.eligibleCount}{" "}
                {round.eligibleCount === 1 ? "idoneo" : "idonei"}
              </span>
            </p>
            <ul className="space-y-0.5">
              {round.bids.map((bid, index) => (
                <li
                  key={`${bid.teamName}-${index}`}
                  className="flex items-baseline gap-2"
                >
                  <span className="min-w-0 flex-1 truncate">{bid.teamName}</span>
                  {bid.withdrawnAt === null ? (
                    <span className="font-mono">{bid.amount}</span>
                  ) : (
                    <span className="text-muted-foreground font-mono line-through">
                      {bid.amount}
                    </span>
                  )}
                  <span className="text-muted-foreground font-mono text-xs">
                    {romeTime(bid.withdrawnAt ?? bid.amountSetAt)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground">→ {round.outcome}</p>
          </div>
        ))}
      </div>
    </details>
  );
}
