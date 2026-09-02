"use client";

import type { ReactNode } from "react";

import { TimeBand } from "@/components/auction/countdown";
import type { SceneTime, SceneTone } from "@/lib/realtime/portal";
import { cn } from "@/lib/utils";

/**
 * **La cornice unica della colonna 3** (M17 §6): una card, nove scene.
 *
 * ```
 * ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀   ← la fascia, 4px, cambia colore con la scena
 * ┌────────────────────────────┐
 * │ label della scena  ⬤ badge │  ← sempre in questi due angoli
 * │                            │
 * │ [il corpo, che cambia]     │
 * │                            │
 * │ [   l'azione, se c'è   ]   │  ← a piena larghezza
 * ├────────────────────────────┤
 * │ si chiude fra    0:12  ◕   │  ← la banda del tempo, l'ultimo pixel
 * └────────────────────────────┘
 * ```
 *
 * **È questa la parte che risponde alla richiesta, più della tinta.** Fino a
 * v1.16.0 le nove scene erano disegnate da sei contenitori, ognuno con la sua
 * cornice, la sua intestazione e il suo countdown in un posto un po' diverso:
 * passando da una fase all'altra si spostava tutto, e capire cosa fosse cambiato
 * voleva dire rileggere la card da capo. Qui il badge sta sempre in
 * quell'angolo e il tempo sempre in fondo, quindi l'occhio li controlla senza
 * cercarli e un cambiamento si nota perché qualcosa **è cambiato lì**.
 *
 * Il componente non sa niente di aste: prende una fascia, due angoli, un corpo,
 * un'azione e una banda. Chi decide cosa metterci è `sceneOf`/`toneOf`/
 * `sceneTime`, che sono funzioni pure e hanno i loro test — l'unica rete che una
 * macro tutta visiva può avere in un progetto senza test di rendering.
 */
export function SceneCard({
  tone,
  label,
  badge,
  time,
  offset,
  pausedAt = null,
  action,
  children,
}: {
  tone: SceneTone;
  label: string;
  /** L'angolo in alto a destra: qualifica la scena, non ripete lo stato. */
  badge?: ReactNode;
  /** `null` nelle due scene senza scadenza: la banda non si disegna. */
  time?: SceneTime | null;
  offset: number;
  pausedAt?: string | null;
  /** A piena larghezza, in fondo al corpo: si preme dal telefono. */
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="bg-card overflow-hidden rounded-xl border">
      <Fascia tone={tone} />

      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-muted-foreground text-[0.6875rem] tracking-wide uppercase">
            {label}
          </p>
          {badge}
        </div>

        {children}

        {action}
      </div>

      {time && <TimeBand time={time} offset={offset} pausedAt={pausedAt} />}
    </section>
  );
}

/**
 * La fascia: **quattro pixel, e nient'altro**.
 *
 * ⚠ Il colore sta tutto qui e il contenuto resta su fondo neutro — non un bordo
 * colorato, non una card tinta (decisione dell'owner, 2026-08-22). Una card col
 * fondo verde e una col fondo ambra sono due card che si leggono diversamente;
 * una striscia che cambia colore sopra lo stesso fondo bianco è la stessa card
 * che cambia stato, che è ciò che sta succedendo davvero.
 *
 * ⚠ **Niente `dark:`, in nessuna forma** (CLAUDE.md): il portale gira in chiaro,
 * e una variante scura qui sarebbe un colore che nessuno può guardare — cioè
 * nessuno può verificare che sia giusto.
 */
function Fascia({ tone }: { tone: SceneTone }) {
  if (tone === "PAUSED") {
    return (
      <div
        className="h-1"
        // A righe, e non ambra piena: la pausa è l'unico tono che deve
        // distinguersi dallo spareggio, che l'ambra piena ha già preso. Un
        // motivo invece di una tinta si legge come «questa cosa è sospesa»
        // anche prima di riconoscere il colore.
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, var(--color-amber-500) 0 6px, var(--color-amber-200) 6px 12px)",
        }}
      />
    );
  }
  return <div className={cn("h-1", FASCIA[tone])} />;
}

/**
 * ⚠ **Sette toni, tutti da colori che l'applicazione usa già**: nessun tema
 * nuovo, nessun preset, nessuna variabile aggiunta.
 *
 * ⚠ **`TIE` e `SEALED` sono ambra su ambra**, ed è la coppia debole di questa
 * tavolozza: sono l'unico passaggio della serata in cui la fascia cambia solo di
 * luminosità (`amber-500` → `amber-700`), e capita nel momento in cui la cosa da
 * capire è che le buste si sono chiuse. Tutti gli altri passaggi cambiano tinta.
 * Le due alternative dentro i colori già in uso sono prese — il nero è «tocca a
 * te», l'ambra a righe è la pausa — quindi la voce è **da giudicare guardandola
 * con una simulazione accesa** (§7, che è un criterio di chiusura della macro).
 * Che questa tabella sia in un posto solo è precisamente ciò che rende il cambio
 * d'idea gratuito.
 */
const FASCIA: Record<Exclude<SceneTone, "PAUSED">, string> = {
  NEUTRAL: "bg-neutral-300",
  MINE: "bg-foreground",
  OPEN: "bg-emerald-500",
  TIE: "bg-amber-500",
  SEALED: "bg-amber-700",
  DONE: "bg-emerald-600",
};
