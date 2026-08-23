"use client";

import { ChevronDown } from "lucide-react";
import { Accordion } from "radix-ui";

import { ROLES, ROLE_LABELS, type Role } from "@/lib/domain";
import { quotaPerRuolo } from "@/lib/realtime/portal";
import type { SnapshotMember, SnapshotRosterEntry } from "@/lib/realtime/types";
import { cn } from "@/lib/utils";

/**
 * La rosa di un membro, ruolo per ruolo — in **due forme**, perché ha due
 * chiamanti che non si somigliano (M18 §5):
 *
 * - `RosterGrid` sta in regia, dove si leggono 8–12 rose a colpo d'occhio: tutto
 *   aperto e senza percentuali, perché dodici card con quattro numeri ciascuna
 *   sono quarantotto numeri che nessuno legge.
 * - `RosterAccordion` sta nel portale, dove la rosa è **una** — la propria — su
 *   una colonna di telefono: quattro righe che si aprono, con la quota di budget
 *   del reparto accanto al nome.
 *
 * ⚠ **Due componenti e non una prop booleana.** `<RosterGrid fisarmonica />`
 * accenderebbe **due cose diverse** con un flag — la fisarmonica *e* le
 * percentuali — e terrebbe dentro un componente due alberi che non si
 * somigliano. Quello che le due forme hanno davvero in comune è il corpo di un
 * reparto, e quello vive in un posto solo (`RosterBody`, privato).
 *
 * Tutto viene dallo snapshot: `member.roster` sono le assegnazioni non
 * annullate, `slots` la configurazione dell'asta. La fisarmonica decide *cosa è
 * aperto*, mai *cosa c'è dentro* (regola 7).
 */

/**
 * I presi di un reparto, **nell'ordine in cui sono stati presi**.
 *
 * ⚠ **Nessun riordino, ed è il punto di M18 §2**: `member.roster` arriva già in
 * ordine di estrazione. Fino a M18 qui c'era un `.sort((a, b) => b.price -
 * a.price)` che lo disfaceva, e un acquisto da 45 crediti non si aggiungeva in
 * fondo al reparto: si metteva in cima e spingeva giù quello che si era appena
 * finito di leggere. La rosa non è una classifica, è un diario. Perché l'ordine
 * dello snapshot sia affidabile sta scritto in `serializeMembers`.
 */
function ownedOf(member: SnapshotMember, role: Role): SnapshotRosterEntry[] {
  return member.roster.filter((entry) => entry.role === role);
}

/**
 * Il corpo di un reparto: le righe dei presi, e in coda gli slot ancora vuoti
 * disegnati come caselline.
 *
 * È l'unica cosa davvero uguale nelle due forme, quindi sta in un posto solo —
 * duplicarla vorrebbe dire ritoccarla due volte per sempre. **Non si esporta**:
 * è un dettaglio di questo file, non un'astrazione con chiamanti fuori
 * (regola 8).
 */
function RosterBody({
  owned,
  empty,
  role,
}: {
  owned: SnapshotRosterEntry[];
  empty: number;
  role: Role;
}) {
  return (
    <>
      <ul className="space-y-1">
        {owned.map((entry) => (
          <li
            key={entry.playerId}
            className="flex items-baseline gap-2 rounded-md border px-2.5 py-1.5 text-sm"
          >
            <span className="min-w-0 flex-1 truncate font-medium">
              {entry.name}
            </span>
            <span className="text-muted-foreground shrink-0 text-xs">
              {entry.team}
            </span>
            <span className="shrink-0 tabular-nums">{entry.price}</span>
          </li>
        ))}
      </ul>
      {/* Gli slot vuoti come caselline in fila, non come righe intere: otto
          righe tratteggiate per i difensori sarebbero mezzo schermo di telefono
          per dire «me ne mancano otto». */}
      {empty > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {Array.from({ length: empty }, (_, i) => (
            <span
              key={`empty-${role}-${i}`}
              className="border-muted-foreground/30 size-6 rounded border border-dashed"
              aria-hidden
            />
          ))}
          <span className="text-muted-foreground ml-1 text-xs">
            {empty === 1 ? "1 da comprare" : `${empty} da comprare`}
          </span>
        </div>
      )}
    </>
  );
}

/**
 * La rosa piatta: tutto aperto, tutto insieme.
 *
 * È la forma della regia (`console.tsx`), dove le rose sono 8–12 e la domanda
 * non è «chi ho preso» ma «a che punto sono tutti». Niente percentuali: là
 * accanto c'è già la `Figure` «speso» (M18 §5).
 */
export function RosterGrid({
  member,
  slots,
  className,
}: {
  member: SnapshotMember;
  slots: Record<Role, number>;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      {ROLES.map((role) => {
        const owned = ownedOf(member, role);
        return (
          <div key={role} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">{ROLE_LABELS[role]}</h3>
              <span className="text-muted-foreground text-xs tabular-nums">
                {owned.length}/{slots[role]}
              </span>
            </div>
            <RosterBody
              owned={owned}
              empty={Math.max(0, slots[role] - owned.length)}
              role={role}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * La propria rosa a fisarmonica: quattro righe cliccabili, e il reparto che
 * l'asta sta chiamando adesso è quello aperto.
 *
 * `type="single"` con `collapsible`: **un reparto aperto per volta**, e si può
 * chiudere anche quello. Sotto `lg` la rosa è una colonna piena di telefono, e
 * due reparti aperti insieme rimetterebbero lo scroll che questa forma esiste
 * per togliere.
 *
 * ⚠ **Il ruolo in gioco si apre da sé con una `key`, non con un `useEffect`**
 * (M18 §4). Un effetto che sincronizzasse `currentRole` in uno stato locale
 * darebbe due sorgenti di verità e un click dell'utente sovrascritto al
 * prossimo snapshot — cioè un accordion che si richiude sotto le dita ogni due
 * secondi. Con la chiave la proprietà è quella voluta: **la scelta a mano vale
 * finché il ruolo in gioco non cambia**. Aperti i difensori mentre l'asta chiama
 * i centrocampisti restano aperti, nessuno snapshot li richiude; quando l'asta
 * passa agli attaccanti la fisarmonica si rimonta con gli attaccanti aperti. Lo
 * stato locale non è mai *contro* lo snapshot: è azzerato da lui.
 *
 * ⚠ È la stessa famiglia dei `dismissed*` di M17, e sta dentro I10 per la stessa
 * ragione: **niente è raggiungibile solo perché eri qui prima**. Chi ricarica
 * ritrova il reparto in gioco aperto e gli altri chiusi, cioè lo stato di chi non
 * si è mai mosso, e **nessuna informazione vive solo dentro un pannello aperto**
 * — la riga chiusa dice già nome, quota e `n/tot`.
 *
 * Con `currentRole = null` è tutto chiuso: succede ad asta non iniziata e ad
 * asta conclusa. A fine asta la rosa completa si presenta come quattro righe con
 * le quattro quote e i quattro `n/tot`, che è il riepilogo giusto per quel
 * momento, e chi vuole i nomi apre. È una scelta e non una dimenticanza: «a
 * `null` apro il primo reparto» darebbe un reparto aperto a caso.
 */
export function RosterAccordion({
  member,
  slots,
  currentRole,
  className,
}: {
  member: SnapshotMember;
  slots: Record<Role, number>;
  currentRole: Role | null;
  className?: string;
}) {
  const quote = quotaPerRuolo(member);

  return (
    <div className={className}>
      <Accordion.Root
        key={currentRole ?? "nessuno"}
        type="single"
        collapsible
        defaultValue={currentRole ?? ""}
      >
        {ROLES.map((role) => {
          const owned = ownedOf(member, role);
          const quota = quote[role];
          return (
            <Accordion.Item
              key={role}
              value={role}
              className="border-b last:border-b-0"
            >
              {/* `Accordion.Header` **è** l'`<h3>` (rende un `Primitive.h3`), e
                  `Accordion.Trigger` mette da sé `aria-expanded`, gli id e la
                  navigazione da tastiera: non vanno riscritti a mano. */}
              <Accordion.Header className="flex">
                <Accordion.Trigger className="group focus-visible:ring-ring/50 flex w-full items-center gap-2 rounded-sm py-2 text-left text-sm font-medium transition-colors outline-none hover:text-foreground/70 focus-visible:ring-[3px]">
                  <ChevronDown
                    className="size-4 shrink-0 -rotate-90 transition-transform group-data-[state=open]:rotate-0"
                    aria-hidden
                  />
                  <span>
                    {ROLE_LABELS[role]}
                    {/* ⚠ **A zero speso si scrive `(0%)`**, non niente: è la
                        lezione di M17 sull'anatomia fissa — un numero che
                        compare solo a volte costringe a chiedersi perché non c'è,
                        e il posto in cui guardare deve essere sempre lo stesso.
                        Sparisce **solo** a budget 0, dove non esiste. */}
                    {quota !== null && (
                      <span className="text-muted-foreground font-normal">
                        {" "}
                        ({quota}%)
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground ml-auto text-xs font-normal tabular-nums">
                    {owned.length}/{slots[role]}
                  </span>
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content className="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden">
                <div className="space-y-1.5 pb-2.5">
                  <RosterBody
                    owned={owned}
                    empty={Math.max(0, slots[role] - owned.length)}
                    role={role}
                  />
                </div>
              </Accordion.Content>
            </Accordion.Item>
          );
        })}
      </Accordion.Root>
    </div>
  );
}

/** Gli slot di un membro in una riga sola: `1/3 · 4/8 · 2/8 · 0/6`. */
export function SlotsSummary({
  slotsFilled,
  slots,
  className,
}: {
  slotsFilled: Record<Role, number>;
  slots: Record<Role, number>;
  className?: string;
}) {
  return (
    <span className={cn("text-xs tabular-nums", className)}>
      {ROLES.map((role) => (
        <span key={role} className="after:text-muted-foreground/50 after:content-['_·_'] last:after:content-none">
          <span className="text-muted-foreground">{role}</span>{" "}
          {slotsFilled[role]}/{slots[role]}
        </span>
      ))}
    </span>
  );
}
