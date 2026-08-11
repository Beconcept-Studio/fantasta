import { CampionciniPanel } from "@/components/admin/campioncini-panel";
import { requireAppAdmin } from "@/lib/auth";
import {
  campioncinoEdition,
  campionciniDir,
  countArchive,
} from "@/lib/campioncini";

/**
 * L'archivio delle figurine (M7 §7).
 *
 * ⚠ **La guardia sta qui e non solo nel layout**: la regola di M6 §5 vale anche
 * per le pagine, che sono endpoint come le altre. Costa una riga e non dipende
 * dall'albero delle cartelle.
 *
 * La pagina dice **quante figurine ci sono**, e quel numero non viene da una
 * tabella: viene dal contare i file nella cartella. È la stessa risposta che dà
 * il downloader quando decide cosa scaricare — «mancante» vuol dire «file che
 * non c'è» — e averne una sola è ciò che rende l'operazione ripetibile senza
 * nessuno stato da tenere allineato.
 *
 * ⚠ **In produzione l'archivio nasce vuoto**, e finché non si preme il pulsante
 * l'applicazione funziona esattamente come prima: semplicemente non si vede
 * nessuna figurina. È una differenza importante rispetto al backfill di M5, dove
 * il passo mancante rompeva il login; qui il passo mancante non rompe niente, si
 * vede e basta. Questa pagina è anche il posto dove uno se ne accorge, ed è per
 * questo che il numero è la prima cosa scritta.
 */
export default async function AdminFigurinePage() {
  await requireAppAdmin();

  const dir = campionciniDir();
  const archived = await countArchive(dir);
  const edition = campioncinoEdition();

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <p className="text-3xl font-semibold tabular-nums">{archived}</p>
        <p className="text-muted-foreground text-sm">
          {archived === 1
            ? "figurina nell'archivio"
            : "figurine nell'archivio"}
          {archived === 0 &&
            " — l'archivio è vuoto: carica il listone qui sotto e premi il pulsante."}
        </p>
      </div>

      <CampionciniPanel archived={archived} />

      <div className="text-muted-foreground max-w-2xl space-y-2 border-t pt-4 text-xs">
        <p>
          <strong>Edizione {edition}.</strong> È l&apos;unica parte
          dell&apos;indirizzo delle figurine che invecchia: è la stagione, e ad
          agosto prossimo cambierà. Si cambia in{" "}
          <span className="font-mono">CAMPIONCINI_EDITION</span> nel{" "}
          <span className="font-mono">.env</span> del server, seguita da{" "}
          <span className="font-mono">
            pm2 reload deploy/ecosystem.config.cjs --update-env
          </span>
          . Se fosse sbagliata te ne accorgeresti subito: non si scaricherebbe
          nessuna figurina.
        </p>
        <p>
          <strong>Le sagome senza volto restano.</strong> Circa un giocatore su
          tre non ha una caricatura e riceve una sagoma con la maglia del suo
          club: si salva e si mostra come tutte le altre. È voluto — così il
          riquadro del lotto non cambia mai forma, e il pulsante
          dell&apos;offerta non si sposta mentre un pollice lo sta cercando.
        </p>
        <p>
          <strong>L&apos;archivio sta in</strong>{" "}
          <span className="font-mono">{dir}</span>, fuori da git e fuori da{" "}
          <span className="font-mono">public/</span>: sopravvive a ogni rilascio
          e anche a un ritorno a una versione precedente. Per svuotarlo si
          cancella la cartella dal server — non c&apos;è un pulsante, e chi può
          farlo ha già un <span className="font-mono">ssh</span>.
        </p>
      </div>
    </section>
  );
}
