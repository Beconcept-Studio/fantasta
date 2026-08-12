import Link from "next/link";

import { CentroDatiTable } from "@/components/admin/centro-dati-table";
import { requireAppAdmin } from "@/lib/auth";
import { centroDatiRows, listoneStatus } from "@/lib/engine/listone";
import { when } from "@/lib/when";

/**
 * Il Centro dati (M10 §6): la tabella di consultazione del listone a sistema.
 *
 * ⚠ **La guardia sta qui e non solo nel layout**: la regola di M6 §5 vale anche
 * per le pagine, che sono endpoint come le altre. Costa una riga e non dipende
 * dall'albero delle cartelle.
 *
 * ⚠ **Nessun `canSeeInsights`.** La pagina è dietro `requireAppAdmin()`, e un
 * amministratore vede gli insight per costruzione: aggiungere il predicato qui
 * darebbe l'impressione che ci sia una seconda regola da tenere allineata. È
 * anche la ragione per cui il Centro dati **resta in admin** e non esce verso
 * gli owner o chi ha `is_pro` (decisione dell'owner, 2026-08-12).
 *
 * **A tabella vuota la pagina lo dice**, invece di mostrare le intestazioni e
 * niente sotto: il numero grande **è** l'allarme che il passo a mano — caricare
 * il file — è ancora da dare.
 */
export default async function CentroDatiPage() {
  await requireAppAdmin();

  const status = await listoneStatus();
  const rows = status.rows === 0 ? [] : await centroDatiRows();

  if (rows.length === 0) {
    return (
      <section className="space-y-3">
        <p className="text-3xl font-semibold tabular-nums">0</p>
        <p className="text-muted-foreground max-w-xl text-sm">
          Non c&apos;è nessun listone a sistema, quindi qui non c&apos;è niente da
          guardare. Si carica dalla sezione{" "}
          <Link href="/admin/listone" className="underline">
            Listone
          </Link>
          : l&apos;export <strong>Leghe</strong> in{" "}
          <span className="font-mono">.xlsx</span>, quello con la colonna{" "}
          <span className="font-mono">Fuori lista</span>.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <p className="text-muted-foreground text-sm">
        <span className="tabular-nums">{status.rows}</span> giocatori, caricati
        il {when(status.uploadedAt)} ·{" "}
        <span className="tabular-nums">{status.coverage.showable}</span> con i
        numeri di quest&apos;anno. Chi ha <span className="font-mono">—</span> non
        ha una riga di insight, oppure ha solo quelli della stagione precedente:
        un numero del campionato scorso accanto a uno di quest&apos;anno è un
        confronto falso, quindi non si scrive.
      </p>

      <CentroDatiTable rows={rows} />
    </section>
  );
}
