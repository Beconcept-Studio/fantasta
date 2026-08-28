"use client";

/** ⚠ Banco di prova M21-02 — i pezzi, in un file loro perché una `page.tsx`
 *  non può esportare altro che il default (il validatore delle rotte di Next
 *  la rifiuta). Si cancella con `app/banco/` (M21-13). */

import { Bookmark, Search, Upload } from "lucide-react";
import React, { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { FASCE, RIGHE, type Riga } from "./dati";



export function Intestazione() {
  return (
    <div className="space-y-1 border-b pb-4">
      <p className="text-muted-foreground font-mono text-xs">
        banco di prova — M21-02
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">
        La tab Listone, guardata prima di scriverla
      </h1>
      <p className="text-muted-foreground text-sm">
        Componenti veri, Tailwind vero, dati veri da{" "}
        <span className="font-mono">fixtures/carmy.xlsx</span> e{" "}
        <span className="font-mono">fixtures/fantalab-listone.json</span>.
      </p>
    </div>
  );
}

export function Sezione({
  titolo,
  children,
}: {
  titolo: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-muted-foreground text-sm font-semibold tracking-tight">
        {titolo}
      </h2>
      {children}
    </section>
  );
}

/** Una cornice larga come un telefono, per guardarci dentro da desktop. */
export function Telefono({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card w-[375px] max-w-full overflow-hidden rounded-xl border shadow-sm">
      {children}
    </div>
  );
}

export function BarraTab({
  attiva,
  scadenza,
  spenta = false,
}: {
  attiva: "asta" | "listone";
  scadenza: { scena: string; tempo: string; azione: string } | null;
  spenta?: boolean;
}) {
  return (
    <div className="bg-background/95 flex items-center gap-2 border-b py-2 backdrop-blur">
      <div className="bg-muted flex gap-1 rounded-lg p-1">
        <Linguetta attiva={attiva === "asta"}>Asta</Linguetta>
        <Linguetta attiva={attiva === "listone"} spenta={spenta}>
          Listone
        </Linguetta>
      </div>

      {spenta && (
        <span className="bg-foreground text-background rounded-md px-2 py-1 text-xs">
          Solo per gli utenti Pro
        </span>
      )}

      {scadenza !== null && (
        <div className="ml-auto flex items-center gap-2">
          <span className="text-muted-foreground hidden text-xs sm:inline">
            {scadenza.scena}
          </span>
          <span className="font-mono text-sm font-semibold tabular-nums">
            {scadenza.tempo}
          </span>
          <Button size="sm">{scadenza.azione}</Button>
        </div>
      )}
    </div>
  );
}

export function Linguetta({
  attiva,
  spenta = false,
  children,
}: {
  attiva: boolean;
  spenta?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium",
        attiva ? "bg-background shadow-sm" : "text-muted-foreground",
        spenta && "opacity-50",
      )}
    >
      {children}
    </span>
  );
}

export function Controlli() {
  const [ruoli, setRuoli] = useState<string[]>(["D"]);
  const [obiettivi, setObiettivi] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            placeholder="Cerca un giocatore o una squadra"
            className="pl-8"
          />
        </div>
        <Button variant="outline">
          <Upload />
          <span className="hidden sm:inline">Importa obiettivi</span>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {(["P", "D", "C", "A"] as const).map((r) => (
          <Button
            key={r}
            size="sm"
            variant={ruoli.includes(r) ? "default" : "outline"}
            onClick={() =>
              setRuoli((v) =>
                v.includes(r) ? v.filter((x) => x !== r) : [...v, r],
              )
            }
            className="w-9"
          >
            {r}
          </Button>
        ))}
        <span className="bg-border mx-1 h-5 w-px" />
        <Button
          size="sm"
          variant={obiettivi ? "default" : "outline"}
          onClick={() => setObiettivi((v) => !v)}
        >
          <Bookmark className={cn(obiettivi && "fill-current")} />
          Obiettivi
        </Button>
        <span className="text-muted-foreground ml-auto text-xs tabular-nums">
          {RIGHE.length} disponibili
        </span>
      </div>
    </div>
  );
}

export function Thead() {
  return (
    <thead className="text-muted-foreground sticky top-0 z-10 text-xs">
      <tr className="bg-background">
        <th className="w-8 border-b px-2 py-2" />
        <th className="w-8 border-b px-2 py-2 text-left font-medium">R</th>
        <th className="border-b px-2 py-2 text-left font-medium">Giocatore</th>
        <th className="border-b px-2 py-2 text-right font-medium">PMA</th>
        <th className="border-b px-2 py-2 text-right font-medium">FMV Exp.</th>
        <th className="border-b px-2 py-2 text-right font-medium">Gol</th>
        <th className="border-b px-2 py-2 text-right font-medium">Ass.</th>
        <th className="border-b px-2 py-2 text-left font-medium">Note</th>
      </tr>
    </thead>
  );
}

export function Tabella() {
  return (
    <table className="w-full border-separate border-spacing-0 text-sm">
      <Thead />
      <tbody>
        {FASCE.map((fascia) => {
          const righe = RIGHE.filter((r) => r.fascia === fascia);
          return (
            <React.Fragment key={fascia}>
              <tr className="bg-muted/60">
                <td colSpan={8} className="border-b px-2 py-1.5">
                  <span className="text-xs font-semibold">{fascia}</span>
                  <span className="text-muted-foreground ml-2 text-xs tabular-nums">
                    · {righe.length}
                  </span>
                </td>
              </tr>
              {righe.map((r) => (
                <RigaTabella key={r.name} r={r} />
              ))}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

export function RigaTabella({ r }: { r: Riga }) {
  return (
    <tr className="hover:bg-muted/40">
      <td className="border-b px-2 py-1.5">
        <IconaObiettivo obiettivo={r.obiettivo} />
      </td>
      <td className="border-b px-2 py-1.5">
        <span className="text-muted-foreground font-mono text-xs">{r.role}</span>
      </td>
      <td className="border-b px-2 py-1.5">
        <span className="font-medium">{r.name}</span>
        <span className="text-muted-foreground ml-2 text-xs">{r.team}</span>
        {r.inAsta && (
          <Badge className="ml-2 h-4.5 bg-amber-600 px-1.5 text-[10px] text-white">
            in asta
          </Badge>
        )}
      </td>
      <td className="border-b px-2 py-1.5 text-right tabular-nums">
        {r.pma === null ? <Vuoto /> : `${r.pma}%`}
      </td>
      <td className="border-b px-2 py-1.5 text-right tabular-nums">
        {r.fmvExp ?? <Vuoto />}
      </td>
      <td className="border-b px-2 py-1.5 text-right tabular-nums">
        {r.gol ?? <Vuoto />}
      </td>
      <td className="border-b px-2 py-1.5 text-right tabular-nums">
        {r.assist ?? <Vuoto />}
      </td>
      <td className="border-b px-2 py-1.5">
        <span className="flex flex-wrap gap-1">
          {r.tags.map((t) => (
            <Badge key={t} variant="secondary" className="h-4.5 px-1.5 text-[10px]">
              {t}
            </Badge>
          ))}
        </span>
      </td>
    </tr>
  );
}

export function RigaMobileA({ r }: { r: Riga }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2.5">
      <IconaObiettivo obiettivo={r.obiettivo} className="mt-0.5 shrink-0" />

      {/* ⚠ `min-w-0` è ciò che permette al nome di troncare invece di spingere
          fuori schermo il PMA: senza, il flex item non scende sotto il proprio
          contenuto e la colonna di destra esce dalla viewport. Visto a 375px. */}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-muted-foreground shrink-0 font-mono text-xs">
            {r.role}
          </span>
          {/* ⚠ **Il nome tronca e basta, senza `min-w-0` sulla catena**, ed è
              misurato e non dedotto: a 375px il caso peggiore vero del listone
              — «Milinkovic-Savic V. · Napoli», il più lungo delle 495 righe —
              sta dentro, `scrollWidth` resta 375 e nessuno dei PMA esce.
              Se un anno il listone portasse un nome più lungo, il rimedio è
              `min-w-0` **su ogni anello**, non solo sul padre. */}
          <span className="truncate font-medium">{r.name}</span>
          <span className="text-muted-foreground shrink-0 truncate text-xs">
            {r.team}
          </span>
          {r.inAsta && (
            <Badge className="h-4.5 shrink-0 bg-amber-600 px-1.5 text-[10px] text-white">
              in asta
            </Badge>
          )}
        </div>
        <div className="text-muted-foreground flex gap-3 text-xs tabular-nums">
          <span>
            <span className="opacity-70">exp </span>
            {r.fmvExp ?? "—"}
          </span>
          <span>
            <span className="opacity-70">gol </span>
            {r.gol ?? "—"}
          </span>
          <span>
            <span className="opacity-70">ass </span>
            {r.assist ?? "—"}
          </span>
        </div>
        {r.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {r.tags.slice(0, 3).map((t) => (
              <Badge
                key={t}
                variant="secondary"
                className="h-4.5 px-1.5 text-[10px]"
              >
                {t}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <span className="shrink-0 text-sm font-semibold tabular-nums">
        {r.pma === null ? "—" : `${r.pma}%`}
      </span>
    </div>
  );
}

/** Le stesse righe del telefono, raggruppate come la tabella. */
export function ElencoMobile({ righe }: { righe: Riga[] }) {
  return (
    <div>
      {FASCE.map((fascia) => {
        const gruppo = righe.filter((r) => r.fascia === fascia);
        if (gruppo.length === 0) return null;
        return (
          <div key={fascia}>
            <div className="bg-muted/60 sticky top-0 z-10 border-y px-3 py-1.5">
              <span className="text-xs font-semibold">{fascia}</span>
              <span className="text-muted-foreground ml-2 text-xs tabular-nums">
                · {gruppo.length}
              </span>
            </div>
            <div className="divide-y">
              {gruppo.map((r) => (
                <RigaMobileA key={r.name} r={r} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function IconaObiettivo({
  obiettivo,
  sempre = false,
  className,
}: {
  obiettivo: boolean;
  sempre?: boolean;
  className?: string;
}) {
  if (!obiettivo && !sempre) {
    return <span className={cn("block size-4", className)} aria-hidden />;
  }
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

export function Vuoto() {
  return <span className="text-muted-foreground font-mono">—</span>;
}

export function ModaleImport() {
  return (
    <div className="bg-card w-full max-w-md space-y-4 rounded-xl border p-4 shadow-lg">
      <div className="space-y-1">
        <h3 className="font-semibold">Importa i tuoi obiettivi</h3>
        <p className="text-muted-foreground text-sm">
          Il tuo foglio in <span className="font-mono">.xlsx</span>: quattro
          fogli <span className="font-mono">P</span>,{" "}
          <span className="font-mono">D</span>,{" "}
          <span className="font-mono">C</span>,{" "}
          <span className="font-mono">A</span>, con la colonna{" "}
          <span className="font-mono">Obiett.</span> e la fascia. Si aggancia al
          listone per nome. Il file non viene conservato, e vale solo per te.
        </p>
      </div>
      <Input type="file" accept=".xlsx" />
      <div className="bg-muted/60 space-y-1 rounded-lg p-3 text-xs">
        <p className="font-medium">176 giudizi su 176 righe del foglio.</p>
        <p className="text-muted-foreground">
          Non trovati nel listone (2): Rovella, Zaccagni — di solito sono
          acquisti più recenti del listone caricato.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline">Annulla</Button>
        <Button>Importa</Button>
      </div>
    </div>
  );
}
