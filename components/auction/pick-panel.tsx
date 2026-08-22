"use client";

import { Dialog } from "radix-ui";
import { useMemo, useState } from "react";

import { Countdown, CountdownBar } from "@/components/auction/countdown";
import {
  BonusENote,
  TitolaritaAnyBadge,
  ValoriCarmy,
} from "@/components/auction/insights";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
 *
 * ⚠ **Da M17 quell'ordine non ha più una giustificazione visibile**, e va saputo
 * perché cambia cosa la lista sembra dire. `fvm` era scritto su ogni riga e
 * spiegava l'ordinamento a chi lo guardava; l'owner ha chiesto di togliere «un
 * valore FMV che non capisco cosa sia» (2026-08-22) — era il Fantavalore di
 * Mercato — e la card adesso mostra `FMA` e `PMA`, che **non sono monotoni**.
 * Scorrendo, la lista sembrerà ordinata per niente.
 *
 * L'ordine però è identico: `availablePlayers` non è stato toccato, e resta quello
 * dell'auto-pick. Ciò che tiene in piedi la promessa «il primo è quello che il
 * timer prenderebbe» è la **riga dell'auto-pick** sopra l'elenco, che lo dice per
 * nome invece di lasciarlo dedurre da una colonna di numeri — cioè la strada che
 * M10B §6 aveva già scelto per un'altra ragione, e che qui regge da sola.
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

/**
 * **Il pannello di chiamata** (M17 §4): tocca a te, e arriva dal basso come
 * l'offerta.
 *
 * ## Perché è uno sheet e non una sezione di pagina
 *
 * Fino a v1.16.0 la chiamata era una sezione in mezzo al portale, e con il
 * layout a tre colonne quella sezione sarebbe finita in una colonna da 350px —
 * una ricerca, quattro pastiglie e quaranta righe di giocatori in una striscia
 * stretta, mentre le altre due colonne raccontano altro. Quando tocca a me la
 * cosa da fare deve arrivare **davanti**, non stare in mezzo a una pagina che nel
 * frattempo parla d'altro.
 *
 * ## La stessa cornice del `BidModal`, non una simile
 *
 * Le classi del `Dialog.Content` sono **le stesse**, copiate e non
 * reinterpretate: dal basso sul telefono, in basso a destra da `sm`. Due pannelli
 * che si alternano nello stesso punto della serata — scegli il giocatore, poi
 * offri — devono essere lo stesso oggetto con dentro cose diverse, o si impara
 * due volte la stessa cosa.
 *
 * ⚠ **L'unica differenza è `max-h-[85dvh]` invece di `max-h-dvh`**, e non è
 * estetica: questo pannello ha dentro una lista lunga, e lasciare visibile una
 * striscia di pagina sotto di lui è ciò che dice che è un pannello e non una
 * schermata nuova.
 *
 * ## Il rischio vero non è il countdown, è l'altezza
 *
 * Il modale d'offerta è corto; questo contiene una ricerca, le pastiglie dei
 * filtri, la riga dell'auto-pick e fino a quaranta righe. Su un telefono con la
 * tastiera aperta è costruito come quello insegna: **intestazione fissa** — chi
 * chiama cosa, countdown, barra — e **solo la lista che scorre**, dentro il suo
 * `overflow-y-auto`. Se scorresse tutto, il countdown uscirebbe dallo schermo
 * appena si digita, e quello è il difetto che renderebbe il pannello peggiore
 * della pagina che sostituisce.
 *
 * ⚠ **Il campo di ricerca NON prende il focus all'apertura**, ed è una differenza
 * deliberata dal `BidModal`, che invece lo fa (M7, su richiesta dell'owner). I due
 * pannelli esistono per due gesti diversi: quello d'offerta si apre per **scrivere
 * un numero**, quindi la tastiera è la prima cosa che serve; questo si apre per
 * **scegliere da un elenco**, e far salire la tastiera coprirebbe l'elenco che è
 * la ragione per cui il pannello è lì. Chi vuole cercare tocca il campo.
 */
export function PickSheet({
  open,
  onOpenChange,
  snapshot,
  pool,
  budget,
  offset,
  frozen,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: Snapshot;
  pool: PoolPlayer[];
  /** I crediti di partenza dell'asta: servono al `PMA` in crediti sulla riga. */
  budget: number;
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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content
          // ⚠ Nessun focus automatico, al contrario del `BidModal`: il perché sta
          // in testa a questo componente, ed è che i due pannelli servono a due
          // gesti diversi. `preventDefault` senza un `focus()` dopo lascia il
          // fuoco sul contenitore, quindi la tastiera resta giù e l'elenco si
          // vede tutto.
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col gap-3 rounded-t-2xl border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl outline-none sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-96 sm:rounded-2xl sm:border"
        >
          {/*
            ── L'intestazione fissa: `shrink-0`, e sopra la tastiera ──
            Countdown e barra restano visibili anche con la tastiera aperta e una
            ricerca in corso. È il requisito che decide se questo pannello è
            meglio o peggio della pagina che sostituisce.
          */}
          <div className="flex shrink-0 flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-muted-foreground text-[0.6875rem] tracking-wide uppercase">
                  Tocca a te
                </p>
                <Dialog.Title className="text-xl leading-tight font-semibold">
                  Chiama un {role === null ? "giocatore" : ROLE_LABELS_ONE[role]}
                </Dialog.Title>
              </div>
              <p className="shrink-0 text-right text-3xl leading-none font-semibold">
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
            {/*
              Una riga e non due: il nome di chi il timer comprerebbe lo dice la
              riga dell'auto-pick più sotto, con il nome vero. Qui resta la regola,
              là c'è il caso concreto — dirle entrambe per esteso vorrebbe dire
              quattro righe di testo sopra la tastiera.
            */}
            <Dialog.Description className="text-muted-foreground text-xs">
              Se scade, il timer chiama al posto tuo e apre a 1.
            </Dialog.Description>

            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cerca per nome o squadra"
              type="search"
              autoComplete="off"
              aria-label="Cerca un giocatore"
              // 16px minimi: sotto quella soglia iOS zooma da solo appena si
              // tocca il campo, e la pagina resta zoomata per il resto dell'asta.
              className="border-input focus-visible:border-ring focus-visible:ring-ring/50 h-12 w-full rounded-lg border bg-transparent px-3 text-base outline-none focus-visible:ring-3"
            />

            {/*
              Errore e pausa stanno nella parte **fissa** e non in quella che
              scorre: un messaggio che si può perdere scorrendo è un messaggio che
              non è stato dato. Sono le due sole cose brevi che meritano lo spazio
              sopra la tastiera insieme al countdown.
            */}
            {error !== null && (
              <p
                role="alert"
                className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
              >
                {error}
              </p>
            )}

            {/*
              ⚠ **Questo ramo oggi non si raggiunge, e resta di proposito.**
              `shouldOpenPickSheet` vuole `status === "LIVE"`, quindi una pausa
              chiude il pannello invece di lasciarlo aperto e spento — chi era a
              metà scelta si ritrova la card «Tocca a te» col pulsante disabilitato
              e la banda del tempo spenta, che è dove la pausa è spiegata.
              Cancellarlo insieme al `frozen` qui sotto vorrebbe dire che il giorno
              in cui quella condizione cambia — e le condizioni di apertura sono
              cambiate due volte da v1.0.0 — il pannello resterebbe aperto senza
              dire perché non funziona. Costa tre righe e una domanda in meno.
            */}
            {frozen && (
              <p role="status" className="bg-muted/50 rounded-md px-3 py-2 text-sm">
                Asta in pausa: la chiamata riprende al resume.
              </p>
            )}
          </div>

          {/*
            ── Da qui scorre, e **solo** da qui ──
            `min-h-0` sul figlio flex non è cosmetico: senza, un contenitore flex
            si dimensiona sul contenuto invece che sullo spazio disponibile, il
            pannello cresce oltre `max-h-[85dvh]` e l'intestazione fissa esce dallo
            schermo — cioè esattamente il difetto che tutta questa struttura esiste
            per evitare.
          */}
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            {/*
              ⚠ **I filtri di Carmy** (M10B §6). È l'unica UI che si usa **sotto un
              countdown, con un pollice**: per questo sono pastiglie da toccare e non
              tre menù a tendina, e per questo la titolarità minima ha due valori e
              non cinque — «da 4» è la soglia del verde, «da 5» è il solo
              titolarissimo, e i gradi in mezzo non sono una domanda che qualcuno si
              fa mentre il tempo scorre.
            */}
            {conCarmy && (
              <div
                className="flex flex-wrap gap-1"
                role="group"
                aria-label="Filtra per titolarità"
              >
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
            )}

            <ul className="space-y-1.5">
              {shown.map((player) => (
                <li key={player.id}>
                  <button
                    type="button"
                    disabled={frozen || pending !== null}
                    onClick={() => void pick(player.id)}
                    className={cn(
                      "hover:bg-accent flex w-full flex-col gap-1.5 rounded-lg border p-2.5 text-left transition disabled:opacity-50",
                      // Il giocatore tenuto in cima contro il filtro va marcato: una
                      // riga che il filtro dice di aver tolto e che invece c\'è, senza
                      // un segno, è un elenco che mente su sé stesso in un altro modo.
                      MODO_AUTOPICK === "fissa" &&
                        autoPickAltrove &&
                        player.id === autoPick.id &&
                        "border-amber-600/40 bg-amber-600/5",
                    )}
                  >
                    {/* ── Riga 0: la squadra a sinistra, la titolarità a destra ── */}
                    <span className="flex items-center justify-between gap-2">
                      <Badge variant="secondary" className="h-4.5 px-1.5 py-0 text-[10px]">
                        {player.team}
                      </Badge>
                      {/* ⚠ **Solo il badge**: i minuti medi sono stati tolti su
                          richiesta dell'owner (2026-08-22). Erano il secondo numero
                          della titolarità, e il badge già porta la sua misura dentro
                          — la percentuale quando viene dalle presenze, il voto su 5
                          quando viene dal foglio. */}
                      <TitolaritaAnyBadge
                        insights={player.insights}
                        carmy={player.carmy}
                        compact
                      />
                    </span>

                    {/* ── Riga 1: il nome a sinistra, i due numeri a destra ── */}
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-medium">
                        {player.name}
                      </span>
                      <ValoriCarmy carmy={player.carmy} budget={budget} />
                    </span>

                    {/*
                      ── Riga 2: i bonus e le note ──
                      ⚠ `fvm` **non c'è più** su questa card: l'owner ha chiesto di
                      togliere «un valore FMV che non capisco cosa sia» (2026-08-22),
                      ed era il Fantavalore di Mercato. La conseguenza da conoscere è
                      che **quel numero ordina ancora la lista** — `availablePlayers`
                      ordina `fvm DESC, quot DESC`, che è l'ordine esatto
                      dell'auto-pick — quindi da qui l'ordinamento non ha più una
                      giustificazione visibile: `FMA` e `PMA` non sono monotoni, e
                      scorrendo la lista sembrerà ordinata per niente. Ciò che regge
                      la promessa «il primo è quello che il timer prenderebbe» è la
                      riga dell'auto-pick sopra l'elenco, che lo dice per nome.
                    */}
                    <BonusENote insights={player.insights} carmy={player.carmy} />
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
              <p className="text-muted-foreground shrink-0 text-center text-xs">
                Altri {available.length - MAX_ROWS} liberi: affina la ricerca.
              </p>
            )}
          </div>

          {/*
            ⚠ «Chiudi» c'è, e chiudere non nasconde niente: la card «Tocca a te»
            nella colonna 3 porta il tempo che resta e il pulsante che riapre il
            pannello. È la stessa promessa che la card del lotto fa al modale
            d'offerta (§8bis punto 3), e senza di lei un pannello che si apre da sé
            sarebbe una trappola.
          */}
          <Dialog.Close asChild>
            <Button type="button" variant="ghost" className="h-11 w-full shrink-0">
              Chiudi
            </Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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

/**
 * Il **corpo** dell'attesa mentre chiama qualcun altro: chi, e cosa si sta
 * comprando.
 *
 * ⚠ **Era la card più rumorosa della serata senza chiedere niente**, e da M17 è
 * la più quieta. Fino a v1.16.0 aveva un countdown da 36px al centro e una barra
 * sotto — lo stesso peso visivo della card su cui si sta offrendo — in una scena
 * in cui l'unica cosa da fare è aspettare. Ed è la scena che **dura più di tutte**:
 * undici turni su dodici sta chiamando qualcun altro. Il tempo adesso sta nella
 * banda in fondo alla cornice come in tutte le altre scene, e lì resta grigio
 * perché la scadenza non è mia (`sceneTime().pressing === false`).
 *
 * Chi chiama arriva come `callerName` già risolto e non come id: la risoluzione
 * da `currentMemberId` a nome è del portale, che ce l'ha già fatta per la card di
 * stato — farla due volte vorrebbe dire due `memberById` da tenere d'accordo.
 */
export function PickWaiting({
  snapshot,
  callerName,
}: {
  snapshot: Snapshot;
  callerName: string;
}) {
  const role = snapshot.auction.currentRole;
  return (
    <div className="space-y-1">
      <h3 className="text-xl leading-tight font-semibold">{callerName}</h3>
      <p className="text-muted-foreground text-sm">
        Si stanno comprando i{" "}
        {role === null ? "giocatori" : ROLE_LABELS[role].toLowerCase()}.
      </p>
    </div>
  );
}
