import { InsightsPanel } from "@/components/admin/insights-panel";
import { requireAppAdmin } from "@/lib/auth";
import { insightsStatus } from "@/lib/engine/insights";

/**
 * Gli insight sul listone (M8 §7): due pulsanti, due date e la copertura.
 *
 * ⚠ **La guardia sta qui e non solo nel layout**: la regola di M6 §5 vale anche
 * per le pagine, che sono endpoint come le altre. Costa una riga e non dipende
 * dall'albero delle cartelle.
 *
 * ⚠ **In produzione la tabella nasce vuota**, e finché non si premono i pulsanti
 * `/play` è identica a prima — nessuno se ne accorge, che è precisamente ciò che
 * rende il passo facile da dimenticare (stesso inciampo dell'archivio figurine di
 * M7). Per questo il numero delle righe è la prima cosa scritta in pagina.
 *
 * **I due timestamp sono separati** perché le fonti sono due e si aggiornano
 * quando vogliono: un pannello che ne mostrasse uno solo non saprebbe dire quale
 * delle due è ferma da tre mesi.
 */
export default async function AdminListonePage() {
  await requireAppAdmin();

  const status = await insightsStatus();

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <p className="text-3xl font-semibold tabular-nums">{status.rows}</p>
        <p className="text-muted-foreground text-sm">
          {status.rows === 1 ? "giocatore con insight" : "giocatori con insight"}
          {status.rows === 0
            ? " — la tabella è vuota: premi il primo pulsante qui sotto, e nessuno vedrà niente finché non lo fai."
            : ` · ${status.current} con i numeri della stagione corrente · ${status.designated} designati sui piazzati`}
        </p>
      </div>

      <InsightsPanel rows={status.rows} />

      <dl className="grid max-w-3xl gap-4 border-t pt-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground text-xs">Listone aggiornato</dt>
          <dd>{when(status.listoneUpdatedAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Designati aggiornati</dt>
          <dd>{when(status.setPiecesUpdatedAt)}</dd>
        </div>
      </dl>

      {status.coverage.length > 0 && (
        <div className="max-w-3xl space-y-3 border-t pt-4">
          <h2 className="font-medium">Copertura dei listoni</h2>
          <p className="text-muted-foreground text-xs">
            Quanti giocatori <em>chiamabili</em> hanno qualcosa da dire. Non
            arriverà mai al 100%: i due elenchi non coincidono — sul listone di
            prova sono 487 su 495 — e un&apos;asta simulata, che ha un listone
            finto, sta vicino allo zero ed è giusto così.
          </p>
          <ul className="space-y-3">
            {status.coverage.map((c) => (
              <li key={c.auctionId} className="text-sm">
                <p>
                  <span className="font-medium">{c.auctionName}</span>{" "}
                  <span className="tabular-nums">
                    {c.matched}/{c.wanted}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    ({Math.round((c.matched / c.wanted) * 100)}%)
                  </span>
                </p>
                {c.missing.length > 0 && (
                  <p className="text-muted-foreground text-xs">
                    Senza insight: {c.missing.map((m) => m.name).join(", ")}
                    {c.wanted - c.matched > c.missing.length &&
                      ` e altri ${c.wanted - c.matched - c.missing.length}`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="text-muted-foreground max-w-2xl space-y-2 border-t pt-4 text-xs">
        <p>
          <strong>Chi li vede.</strong> Solo chi ha il permesso, che si dà dalla
          lista utenti, più gli amministratori — che li vedono comunque,
          altrimenti dovrebbero accendersi un flag per guardare i dati che hanno
          appena importato. Chi non ce l&apos;ha non li riceve affatto: non
          arrivano nel suo browser, non sono nascosti con il CSS.
        </p>
        <p>
          <strong>Due stagioni, e si mostra solo una.</strong> La fonte manda i
          numeri dell&apos;ultima stagione disponibile per ciascuno, e per un
          terzo dei giocatori è quella precedente. Quelli restano fuori — a
          schermo si vede <span className="font-mono">—</span> — perché un numero
          del campionato scorso accanto a uno di quest&apos;anno è un confronto
          falso.
        </p>
        <p>
          <strong>Se una fonte cambia forma, l&apos;import si rifiuta</strong> e
          te lo dice, invece di riempire la tabella di righe vuote. Vale anche
          quando la lista nuova non somiglia più a quella di prima: sotto l&apos;85%
          di identificativi in comune non viene scritto niente.
        </p>
      </div>
    </section>
  );
}

/**
 * La data in italiano, o «mai».
 *
 * `Europe/Rome` è esplicito perché **il server gira in UTC**, processo compreso:
 * senza il fuso, un import delle 23:30 comparirebbe come del giorno prima.
 */
function when(value: Date | null): string {
  if (value === null) return "mai";
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Rome",
  }).format(value);
}
