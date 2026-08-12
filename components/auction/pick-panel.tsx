"use client";

import { useMemo, useState } from "react";

import { Countdown, CountdownBar } from "@/components/auction/countdown";
import { InsightsLine } from "@/components/auction/insights";
import {
  CARMY_FASCE,
  CARMY_SCALA_MAX,
  ROLE_LABELS,
  ROLE_LABELS_ONE,
  SOGLIA_TITOLARE_CARMY,
} from "@/lib/domain";
import type { ActionResult } from "@/lib/realtime/action";
import {
  type CarmyFilters,
  NO_CARMY_FILTERS,
  autoPickCandidate,
  availablePlayers,
  hasCarmyFilters,
} from "@/lib/realtime/portal";
import type { PoolPlayer, Snapshot } from "@/lib/realtime/types";
import { cn } from "@/lib/utils";

/**
 * La chiamata (F5-10): tocca a te, e hai `pick_seconds` per scegliere.
 *
 * La lista è funzione dello snapshot: il listone arriva dal server una volta
 * sola (è immutabile dall'import), **chi è ancora libero** si deduce dalle rose
 * che lo snapshot contiene già. Nessuna query per lotto, e I10 resta vera —
 * chi ricarica la pagina a metà turno vede la stessa lista di chi non si è
 * mosso.
 *
 * L'ordinamento non è cosmetico: è `fvm DESC, quot DESC`, lo stesso dell'auto-pick.
 * Il primo nome della lista è quello che il timer sceglierebbe al posto tuo, e
 * saperlo cambia la fretta con cui si guarda il countdown.
 */

const MAX_ROWS = 40;

/**
 * Le due strade fra cui si risolve il vincolo di §6, e **un posto solo da cui si
 * decide quale vale**.
 *
 * - `riga` — una riga sopra l'elenco che dice **sempre** chi prenderebbe il timer,
 *   filtro o no. Non tocca l'elenco: dice a parole ciò che l'ordinamento diceva
 *   implicitamente, e continua a dirlo quando l'ordinamento non lo dice più.
 * - `fissa` — quel giocatore resta **in cima all'elenco** anche quando il filtro lo
 *   escluderebbe, marcato. Più immediato, ma un elenco che contiene una riga che il
 *   filtro dice di aver tolto è un elenco che mente su sé stesso in un altro modo.
 *
 * ⚠ Quello che **non** si può fare è nessuna delle due: lasciare che la lista
 * continui a sembrare l'ordine dell'auto-pick quando non lo è.
 */
export const MODI_AUTOPICK = ["riga", "fissa"] as const;
export type ModoAutoPick = (typeof MODI_AUTOPICK)[number];

/**
 * `riga`, **su delega dell'owner** (2026-08-12: «non importa, l'importante è che la
 * dinamica di auto estrazione del lotto esista — la pagina di visualizzazione è più
 * una utility per l'utente»).
 *
 * ⚠ **La delega è sulla forma, non sul vincolo.** Che l'auto-pick esista e resti
 * quello di prima è precisamente ciò che questa macro non ha toccato: l'indice
 * `players_autopick_idx`, l'ordine `fvm DESC, quot DESC` e i criteri in
 * `machine.ts` sono identici a v1.10.0, e c'è un test che lo verifica **col filtro
 * acceso**. Quello che restava da scegliere era come dirlo in pagina, e fra le due
 * strade si è preso `riga` perché è l'unica che non fa mentire l'elenco una seconda
 * volta: `fissa` risolve il problema «il primo nome non è quello giusto»
 * introducendone un altro — una riga presente in un elenco che dichiara di averla
 * filtrata.
 */
export const MODO_AUTOPICK: ModoAutoPick = "riga";

export function PickPanel({
  snapshot,
  pool,
  offset,
  frozen,
  onPick,
}: {
  snapshot: Snapshot;
  pool: PoolPlayer[];
  offset: number;
  frozen: boolean;
  onPick: (playerId: string) => Promise<ActionResult>;
}) {
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [carmyFilters, setCarmyFilters] = useState<CarmyFilters>(NO_CARMY_FILTERS);

  const role = snapshot.auction.currentRole;
  const available = useMemo(
    () => availablePlayers(pool, snapshot, role, query, carmyFilters),
    [pool, snapshot, role, query, carmyFilters],
  );

  /**
   * ⚠ **Chi comprerebbe il timer**, calcolato **senza** filtri e senza ricerca.
   * È il vincolo del riquadro di §6: l'auto-pick pesca dal pool intero dentro
   * `machine.ts` e di Carmy non sa niente, quindi con un filtro acceso il primo
   * nome della lista non è più quello che verrebbe comprato allo scadere.
   */
  const autoPick = useMemo(
    () => autoPickCandidate(pool, snapshot, role),
    [pool, snapshot, role],
  );
  const filtrato = hasCarmyFilters(carmyFilters) || query.trim() !== "";
  // La lista mente sull'auto-pick solo quando il primo nome **non** è quello.
  const autoPickAltrove =
    autoPick !== null && filtrato && available[0]?.id !== autoPick.id;

  /**
   * ⚠ **I filtri si mostrano se e solo se i dati sono arrivati**, e non con un
   * `if (isPro)`: la chiave `carmy` è *assente* nel payload di chi non ha il
   * permesso (M10B §7), quindi questa condizione **è** il permesso — più il caso
   * «foglio non caricato», che si comporta allo stesso modo e giustamente.
   */
  const conCarmy = useMemo(() => pool.some((p) => p.carmy !== undefined), [pool]);
  const fasce = useMemo(() => {
    const set = new Set<string>();
    for (const p of pool) if (p.carmy?.fascia) set.add(p.carmy.fascia);
    // Nell'ordine del foglio — `Top` prima di `Terza` — non in alfabeto.
    return CARMY_FASCE.filter((f) => set.has(f));
  }, [pool]);

  const shown =
    MODO_AUTOPICK === "fissa" && autoPickAltrove
      ? [autoPick, ...available.filter((p) => p.id !== autoPick.id)].slice(
          0,
          MAX_ROWS,
        )
      : available.slice(0, MAX_ROWS);

  const pick = async (playerId: string) => {
    setPending(playerId);
    setError(null);
    const result = await onPick(playerId);
    if (!result.ok) setError(result.message);
    // In caso di successo non si azzera niente: lo snapshot successivo cambia
    // schermata da sotto, ed è quello il segnale che la chiamata è passata.
    setPending(null);
  };

  return (
    <section className="space-y-3">
      <header className="bg-card space-y-2 rounded-xl border p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-muted-foreground text-xs tracking-wide uppercase">
              Tocca a te
            </p>
            <h2 className="text-xl font-semibold">
              Chiama un {role === null ? "giocatore" : ROLE_LABELS_ONE[role]}
            </h2>
          </div>
          <p className="text-right text-3xl leading-none font-semibold">
            <Countdown
              deadline={snapshot.auction.phaseDeadline}
              offset={offset}
              pausedAt={frozen ? snapshot.auction.pausedAt : null}
            />
          </p>
        </div>
        <CountdownBar
          deadline={snapshot.auction.phaseDeadline}
          offset={offset}
          totalSeconds={snapshot.auction.timers.pickSeconds}
          pausedAt={frozen ? snapshot.auction.pausedAt : null}
        />
        <p className="text-muted-foreground text-xs">
          Se scade, parte l&apos;auto-pick sul primo della lista e la tua offerta
          d&apos;apertura è 1.
        </p>
      </header>

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Cerca per nome o squadra"
        type="search"
        autoComplete="off"
        aria-label="Cerca un giocatore"
        // 16px minimi: sotto quella soglia iOS zooma da solo appena si tocca il
        // campo, e la pagina resta zoomata per il resto dell'asta.
        className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-12 w-full rounded-lg border bg-transparent px-3 text-base outline-none focus-visible:ring-3"
      />

      {/*
        ⚠ **I filtri di Carmy** (M10B §6). È l'unica UI di questa macro che si usa
        **sotto un countdown di trenta secondi, con un pollice**: per questo sono
        pastiglie da toccare e non tre menù a tendina, e per questo la titolarità
        minima ha due valori e non cinque — «da 4» è la soglia del verde, «da 5» è
        il solo titolarissimo, e i gradi in mezzo non sono una domanda che qualcuno
        si fa mentre offre.
      */}
      {conCarmy && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filtra per titolarità">
            {[SOGLIA_TITOLARE_CARMY, CARMY_SCALA_MAX].map((min) => (
              <FilterChip
                key={min}
                active={carmyFilters.titolaritaMin === min}
                onClick={() =>
                  setCarmyFilters((f) => ({
                    ...f,
                    titolaritaMin: f.titolaritaMin === min ? null : min,
                  }))
                }
              >
                Titolari da {min}
              </FilterChip>
            ))}
            {fasce.map((fascia) => (
              <FilterChip
                key={fascia}
                active={carmyFilters.fascia === fascia}
                onClick={() =>
                  setCarmyFilters((f) => ({
                    ...f,
                    fascia: f.fascia === fascia ? null : fascia,
                  }))
                }
              >
                {fascia}
              </FilterChip>
            ))}
            {hasCarmyFilters(carmyFilters) && (
              <FilterChip
                active={false}
                onClick={() => setCarmyFilters(NO_CARMY_FILTERS)}
              >
                Togli i filtri
              </FilterChip>
            )}
          </div>
        </div>
      )}

      {/*
        ⚠ **Il vincolo di §6, risolto in pagina e non con un commento nel codice.**
        La riga si scrive **sempre** quando c'è un auto-pick, filtro o no: se
        comparisse solo a filtro acceso, chi non filtra continuerebbe a fidarsi
        dell'ordinamento — e chi filtra imparerebbe che quella riga è un avviso
        d'errore invece di un'informazione. Quando il primo della lista **non** è
        più quello che il timer prenderebbe, la riga lo dice a voce più alta.
      */}
      {autoPick !== null && (
        <p
          className={cn(
            "rounded-md px-3 py-2 text-xs",
            autoPickAltrove
              ? "border border-amber-600/40 bg-amber-600/10 text-amber-800"
              : "text-muted-foreground bg-muted/50",
          )}
          role={autoPickAltrove ? "status" : undefined}
        >
          {autoPickAltrove ? (
            <>
              Allo scadere il timer comprerebbe{" "}
              <strong>{autoPick.name}</strong> ({autoPick.team}), che con questi
              filtri {MODO_AUTOPICK === "fissa" ? "è tenuto in cima" : "non è il primo della lista"}:
              l&apos;auto-pick guarda tutti i {ROLE_LABELS[autoPick.role].toLowerCase()} liberi,
              non quelli filtrati.
            </>
          ) : (
            <>
              Allo scadere il timer comprerebbe{" "}
              <strong>{autoPick.name}</strong> ({autoPick.team}), a 1.
            </>
          )}
        </p>
      )}

      {error !== null && (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {error}
        </p>
      )}

      {frozen && (
        <p role="status" className="bg-muted/50 rounded-md px-3 py-2 text-sm">
          Asta in pausa: la chiamata riprende al resume.
        </p>
      )}

      <ul className="space-y-1.5">
        {shown.map((player) => (
          <li key={player.id}>
            <button
              type="button"
              disabled={frozen || pending !== null}
              onClick={() => void pick(player.id)}
              className={cn(
                "hover:bg-accent flex min-h-12 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition disabled:opacity-50",
                // Il giocatore tenuto in cima contro il filtro va marcato: una riga
                // che il filtro dice di aver tolto e che invece c'è, senza un segno,
                // è un elenco che mente su sé stesso in un altro modo.
                MODO_AUTOPICK === "fissa" &&
                  autoPickAltrove &&
                  player.id === autoPick.id &&
                  "border-amber-600/40 bg-amber-600/5",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{player.name}</span>
                <span className="text-muted-foreground block truncate text-xs">
                  {player.team}
                </span>
                {/* ⚠ Sotto la squadra e non accanto a `fvm`: la riga è già larga
                    quanto un telefono, e i numeri che si confrontano fra loro
                    stanno incolonnati a destra. Chi non ha il permesso, o chi ha
                    solo la stagione precedente, non vede niente — e la riga non
                    cambia altezza, perché era già su due righe. */}
                <InsightsLine insights={player.insights} carmy={player.carmy} />
              </span>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                fvm {player.fvm}
              </span>
              <span className="shrink-0 text-sm font-medium">
                {pending === player.id ? "…" : "Chiama"}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {available.length === 0 && (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
          Nessun giocatore libero con questa ricerca.
        </p>
      )}
      {available.length > MAX_ROWS && (
        <p className="text-muted-foreground text-center text-xs">
          Altri {available.length - MAX_ROWS} liberi: affina la ricerca.
        </p>
      )}
    </section>
  );
}

/**
 * Una pastiglia di filtro, alta abbastanza da essere toccata con un pollice.
 *
 * `min-h-9` e non `h-7`: si preme in piedi, sotto un countdown, e un bersaglio
 * piccolo qui costa un giocatore sbagliato — è la stessa ragione per cui la riga di
 * un giocatore è `min-h-12`.
 */
function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-h-9 rounded-md border px-2.5 text-xs transition",
        active
          ? "bg-foreground text-background border-foreground"
          : "text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

/** L'attesa mentre chiama qualcun altro: chi, e quanto tempo ha. */
export function PickWaiting({
  snapshot,
  offset,
  frozen,
  callerName,
}: {
  snapshot: Snapshot;
  offset: number;
  frozen: boolean;
  callerName: string;
}) {
  const role = snapshot.auction.currentRole;
  return (
    <section className="bg-card space-y-2 rounded-xl border p-6 text-center shadow-sm">
      <p className="text-muted-foreground text-xs tracking-wide uppercase">
        Sta chiamando
      </p>
      <h2 className="text-xl font-semibold">{callerName}</h2>
      <p className="text-4xl leading-none font-semibold">
        <Countdown
          deadline={snapshot.auction.phaseDeadline}
          offset={offset}
          pausedAt={frozen ? snapshot.auction.pausedAt : null}
        />
      </p>
      <CountdownBar
        deadline={snapshot.auction.phaseDeadline}
        offset={offset}
        totalSeconds={snapshot.auction.timers.pickSeconds}
        pausedAt={frozen ? snapshot.auction.pausedAt : null}
        className="mx-auto max-w-xs"
      />
      <p className="text-muted-foreground text-sm">
        Si stanno comprando i{" "}
        {role === null ? "giocatori" : ROLE_LABELS[role].toLowerCase()}.
      </p>
    </section>
  );
}
