import Link from "next/link";

import { CampionciniPanel } from "@/components/admin/campioncini-panel";
import { CarmyUpload } from "@/components/admin/carmy-upload";
import { InsightsPanel } from "@/components/admin/insights-panel";
import { ListoneUpload } from "@/components/admin/listone-upload";
import { requireAppAdmin } from "@/lib/auth";
import {
  campioncinoEdition,
  campionciniDir,
  countArchive,
} from "@/lib/campioncini";
import { SOGLIA_TITOLARE_CARMY } from "@/lib/domain";
import { carmyStatus } from "@/lib/engine/carmy";
import { insightsStatus } from "@/lib/engine/insights";
import { listoneStatus } from "@/lib/engine/listone";
import { when } from "@/lib/when";

/**
 * La sezione «Listone» (M10 §5): l'upload, lo stato, e le due azioni che si
 * fanno **con** un listone appena caricato.
 *
 * ⚠ **Una pagina per la sezione, non quattro.** In cima l'upload e lo stato;
 * sotto, i due blocchi d'azione — Caricature e Insight — che stanno insieme
 * perché si leggono insieme: sono la sequenza «carico, scarico i volti, aggiorno
 * i numeri», che è la sequenza per cui questa sezione esiste. Quattro pagine
 * separate l'avrebbero moltiplicata per quattro in clic. Il Centro dati ha una
 * pagina sua perché cinquecento righe con una casella di ricerca non stanno
 * sotto un form di upload, e perché si apre per consultare, non per agire.
 *
 * ⚠ **Il gate sta solo su Caricature, e Insight resta sempre attivo** — contro
 * la lettera della richiesta, su delega dell'owner (2026-08-12). Caricature ha
 * una dipendenza vera: senza `ext_id` non c'è niente da scaricare. Le due fonti
 * degli insight non ne hanno nessuna — creano righe con chiave `ext_id` e non
 * sanno che esistiamo — quindi bloccarle bloccherebbe un aggiornamento che
 * *riuscirebbe*: un pulsante disabilitato che funzionerebbe è una bugia
 * dell'interfaccia, come lo era nascondere gli insight in CSS (M8 §6). Il gate
 * che serve, lì dentro, esiste già ed è vero: «Aggiorna i designati» è spento
 * finché la tabella degli insight è vuota. E **M11 farà partire quel refresh da
 * sé ogni giorno**: un pulsante bloccato accanto a «aggiornato automaticamente
 * tre ore fa» sarebbe da smontare alla macro dopo.
 *
 * ⚠ **La guardia sta qui e non solo nel layout**: la regola di M6 §5 vale anche
 * per le pagine, che sono endpoint come le altre.
 *
 * ⚠ **In produzione la tabella nasce vuota**, e finché non si carica il file non
 * si rompe niente — semplicemente le caricature non si scaricano, il Centro dati
 * è vuoto e chi crea un'asta non trova nessuna proposta. È precisamente ciò che
 * rende il passo facile da dimenticare (stesso inciampo di M7 e M8), ed è per
 * questo che il numero delle righe è la prima cosa scritta in pagina.
 */
export default async function AdminListonePage() {
  await requireAppAdmin();

  const listone = await listoneStatus();
  const insights = await insightsStatus();
  const carmy = await carmyStatus();
  const archived = await countArchive(campionciniDir());

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <p className="text-3xl font-semibold tabular-nums">{listone.rows}</p>
        <p className="text-muted-foreground text-sm">
          {listone.rows === 1 ? "giocatore a sistema" : "giocatori a sistema"}
          {listone.rows === 0
            ? " — carica il file qui sotto: finché non lo fai, le caricature non si scaricano, il Centro dati è vuoto e chi crea un'asta non trova nessuna proposta."
            : ` · ${listone.outOfList} fuori lista · caricato il ${when(listone.uploadedAt)}`}
        </p>
      </div>

      <ListoneUpload rows={listone.rows} />

      <div className="max-w-2xl space-y-3 border-t pt-6">
        <CarmyUpload rows={carmy.rows} listoneRows={listone.rows} />
        {carmy.rows > 0 && (
          <p className="text-muted-foreground text-sm">
            <strong className="tabular-nums">{carmy.rows}</strong> giudizi a
            sistema ·{" "}
            <span className="tabular-nums">{carmy.conTitolarita}</span> con una
            titolarità, di cui{" "}
            <span className="tabular-nums">{carmy.titolari}</span> da{" "}
            {SOGLIA_TITOLARE_CARMY} in su ·{" "}
            <span className="tabular-nums">{carmy.conPrezzo}</span> con un prezzo
            consigliato.
          </p>
        )}
        {/*
          ⚠ L'avviso è sul **foglio di Carmy e non sul listone**, e la ragione sta
          in §8: questo file invecchia in un giorno, perché un giudizio sulla
          titolarità cambia con un infortunio o con una probabile formazione. Il
          listone a sistema invecchia in settimane. `stale` lo calcola il motore,
          non questo componente: `now` si passa, non si legge (regola 2).
        */}
        {carmy.stale && (
          <p
            role="status"
            className="rounded-md border border-amber-600/40 bg-amber-600/10 px-3 py-2 text-sm text-amber-800"
          >
            Il foglio a sistema è di <strong>{when(carmy.uploadedAt)}</strong>,
            cioè vecchio di più di un giorno. Questo file invecchia in fretta —
            la titolarità di un giocatore cambia con un infortunio — quindi
            conviene ricaricarlo prima dell&apos;asta.
          </p>
        )}
      </div>

      <div className="grid max-w-3xl gap-6 border-t pt-6 sm:grid-cols-2">
        <CampionciniPanel archived={archived} listoneRows={listone.rows} />
        <InsightsPanel rows={insights.rows} />
      </div>

      <dl className="grid max-w-3xl gap-4 border-t pt-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground text-xs">Listone caricato</dt>
          <dd>{when(listone.uploadedAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">
            Titolarità e rigori storici
          </dt>
          <dd>{when(insights.listoneUpdatedAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">
            Designati sui piazzati
          </dt>
          <dd>{when(insights.setPiecesUpdatedAt)}</dd>
        </div>
        {/*
          ⚠ **Il quarto timestamp**, e va accanto agli altri tre perché la domanda
          è la stessa — «quale di queste quattro cose è ferma?». Ma è l'unico che
          ha un avviso sopra: gli altri tre si aggiornano da una fonte che si
          aggiorna da sé (o quasi), questo lo carica una persona a mano, e M11 non
          lo potrà automatizzare (§8).
        */}
        <div>
          <dt className="text-muted-foreground text-xs">Foglio di Carmy</dt>
          <dd>{when(carmy.uploadedAt)}</dd>
        </div>
      </dl>

      <div className="max-w-3xl space-y-4 border-t pt-4">
        <div className="space-y-1">
          <p className="text-sm">
            <strong className="tabular-nums">{archived}</strong>{" "}
            {archived === 1 ? "caricatura" : "caricature"} nell&apos;archivio ·{" "}
            <strong className="tabular-nums">{insights.rows}</strong>{" "}
            {insights.rows === 1
              ? "giocatore con insight"
              : "giocatori con insight"}
            {insights.rows > 0 &&
              `, ${insights.current} con i numeri di quest'anno`}
          </p>
          {/*
            ⚠ La **copertura globale**, che con un listone a sistema ha per la
            prima volta un denominatore vero. Resta un'informazione e non
            diventa una guardia: farne una soglia rimetterebbe in piedi il
            controllo avvelenabile che M8 aveva smontato, questa volta
            avvelenabile da un file caricato per sbaglio (M10 §7). Quello che
            protegge davvero è la continuità all'85%, e non si tocca.
          */}
          {listone.rows > 0 && (
            <p className="text-muted-foreground text-sm">
              Del listone a sistema,{" "}
              <span className="tabular-nums">
                {listone.coverage.matched}/{listone.rows}
              </span>{" "}
              hanno una riga di insight (
              <span className="tabular-nums">
                {Math.round((listone.coverage.matched / listone.rows) * 100)}%
              </span>
              ), e{" "}
              <span className="tabular-nums">{listone.coverage.showable}</span>{" "}
              hanno i numeri di quest&apos;anno, cioè quelli che si vedono
              davvero.{" "}
              <Link href="/admin/listone/dati" className="underline">
                Guardali uno per uno nel Centro dati
              </Link>
              .
            </p>
          )}
        </div>
      </div>

      {insights.coverage.length > 0 && (
        <div className="max-w-3xl space-y-3 border-t pt-4">
          <h2 className="font-medium">Copertura dei listoni delle aste</h2>
          <p className="text-muted-foreground text-xs">
            Quanti giocatori <em>chiamabili</em> hanno qualcosa da dire. È una
            domanda diversa da quella qui sopra — «il <em>mio</em> listone è
            coperto?» invece di «la fonte copre il listone di quest&apos;anno?» —
            e per questo restano tutte e due. Non arriverà mai al 100%: i due
            elenchi non coincidono, e un&apos;asta simulata, che ha un listone
            finto, sta vicino allo zero ed è giusto così.
          </p>
          <ul className="space-y-3">
            {insights.coverage.map((c) => (
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
          <strong>«Listone» qui sono due file.</strong> Quello che si carica
          sopra è l&apos;export <strong>Leghe</strong> in{" "}
          <span className="font-mono">.xlsx</span>: definisce le aste, porta la
          colonna <span className="font-mono">Fuori lista</span>, e si scarica a
          mano perché l&apos;area riservata vuole un login. Quello che scarica il
          pulsante «Importa il listone» è la <span className="font-mono">GET</span>{" "}
          pubblica di <span className="font-mono">api.fantalab.it</span>, e porta
          i numeri. Sono nella stessa pagina perché è il posto giusto per
          guardarli insieme, non perché siano la stessa cosa.
        </p>
        <p>
          <strong>Il foglio di Carmy porta un giudizio, non una misura.</strong>{" "}
          Le sue colonne di numeri — presenze, partite da titolare, minuti,
          rigori, cartellini — sono <em>identiche</em> a quelle che importiamo
          già dalla fonte pubblica, quindi non le prendiamo. Quello che prendiamo
          sono le tre colonne da 1 a 5, la fascia, il prezzo consigliato e le
          note: sono l&apos;opinione di una persona su come andrà{" "}
          <em>quest&apos;anno</em>, ed è una cosa che nessuna fonte pubblica ha.
          Accanto alla titolarità giudicata resta sempre il rapporto grezzo
          dell&apos;anno scorso, in grigio: quando i due divergono — giudicato
          titolare con tre partite da titolare — quella divergenza è
          l&apos;informazione. Il foglio si aggancia al listone{" "}
          <strong>per nome</strong>, e se meno del 90% dei nomi lo trova
          l&apos;import si rifiuta senza scrivere niente: vuol dire che i due
          file parlano di due elenchi diversi, di solito perché il listone è
          vecchio.
        </p>
        <p>
          <strong>Il listone si copia dentro l&apos;asta.</strong> Chi crea
          un&apos;asta se lo trova proposto, con la data qui sopra; da quel
          momento quell&apos;asta ha la <em>sua</em> copia e un caricamento nuovo
          non la tocca più. Le rose, i prezzi e le regole di quella serata sono
          appesi a quelle righe.
        </p>
        <p>
          <strong>Chi vede gli insight.</strong> Solo chi ha il permesso, che si
          dà dalla lista utenti, più gli amministratori — che li vedono comunque,
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
          quando la lista nuova non somiglia più a quella di prima: sotto
          l&apos;85% di identificativi in comune non viene scritto niente.
        </p>
        <p>
          <strong>Edizione {campioncinoEdition()}</strong> per le caricature. È
          l&apos;unica parte del loro indirizzo che invecchia: è la stagione, e ad
          agosto prossimo cambierà. Si cambia in{" "}
          <span className="font-mono">CAMPIONCINI_EDITION</span> nel{" "}
          <span className="font-mono">.env</span> del server, seguita da{" "}
          <span className="font-mono">
            pm2 reload deploy/ecosystem.config.cjs --update-env
          </span>
          . L&apos;archivio sta in{" "}
          <span className="font-mono">{campionciniDir()}</span>, fuori da git e
          fuori da <span className="font-mono">public/</span>: sopravvive a ogni
          rilascio e anche a un ritorno a una versione precedente.
        </p>
      </div>
    </section>
  );
}
