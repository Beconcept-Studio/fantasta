import type { RefreshSource } from "@/lib/domain";
import {
  type SourceRunStatus,
  describeSourceRun,
  failingSources,
} from "@/lib/source-status";
import { when } from "@/lib/when";

/**
 * L'avviso in cima alla sezione Listone quando una fonte pubblica non si aggiorna
 * (M11 §5).
 *
 * ⚠ **Compare solo se c'è un guasto, e sta in cima.** Sono le due proprietà per
 * cui esiste, ed è la forma scelta dall'owner guardandola (2026-08-13). Con i due
 * pulsanti di M8 l'errore lo leggeva la persona che aveva premuto; dal momento in
 * cui il refresh parte da sé, l'unico modo in cui questa macro *parla* è questo
 * blocco — e se non si vede, l'intero automatismo non serve a niente, perché i
 * numeri invecchiano senza dire niente esattamente come prima. Un avviso che
 * compare **sempre** invece si smette di leggere, e il giorno che serve non lo si
 * vede: per questo il caso «va tutto bene» non passa da qui ma dalla riga accanto
 * al pulsante.
 *
 * ⚠ **Dice anche che i dati non sono corrotti**, e non è una gentilezza: è il
 * fatto che rende accettabile un allarme che nessuno riceve per email (§5, §7).
 * Merito di M8 — scrittura in transazione, envelope validato, continuità all'85% —
 * il caso peggiore automatico è **sapere numeri vecchi**, mai numeri falsi. Chi
 * legge questo avviso ha bisogno di saperlo subito, o passerà la sera a chiedersi
 * se può fidarsi del listone.
 *
 * Niente `dark:`: l'applicazione gira in chiaro.
 */
export function SourceRunBanner({
  statuses,
  dataUpdatedAt,
}: {
  statuses: SourceRunStatus[];
  /** Da quando sono i dati **a sistema** di ciascuna fonte, che il guasto non tocca. */
  dataUpdatedAt: Record<RefreshSource, Date | null>;
}) {
  const failing = failingSources(statuses);
  if (failing.length === 0) return null;

  return (
    <div
      role="alert"
      className="max-w-3xl space-y-3 rounded-md border border-red-600/50 bg-red-600/10 px-4 py-3 text-red-900"
    >
      {failing.map((status) => {
        const said = describeSourceRun(status);
        const dati = dataUpdatedAt[status.source];
        return (
          <div key={status.source} className="space-y-1">
            {/*
              ⚠ Il nome della fonte è un'etichetta sopra, non la prima metà di una
              frase. Scritto come «Titolarità e rigori storici: non si aggiorna da
              tre volte» costringeva a scegliere fra una maiuscola sbagliata dopo i
              due punti e una frase che, letta da sola accanto al pulsante, comincia
              in minuscolo. Le stesse parole in due posti devono poter stare in
              piedi in tutti e due.
            */}
            <p className="text-xs font-medium uppercase tracking-wide">
              {said.label}
            </p>
            <p className="font-medium">{said.headline}</p>
            {said.detail !== null && (
              <p className="text-sm">
                {said.detail}
                {said.message !== null && <> — «{said.message}»</>}
              </p>
            )}
            <p className="text-sm">
              {dati === null ? (
                <>
                  Da questa fonte non c&apos;è ancora niente a sistema: non è
                  stato scritto niente a metà, semplicemente non è stato scritto.
                </>
              ) : (
                <>
                  I numeri a sistema restano quelli del{" "}
                  <strong>{when(dati)}</strong>, e sono integri: un import che
                  fallisce non lascia righe a metà. Il costo è sapere numeri
                  vecchi, non numeri falsi.
                </>
              )}{" "}
              {said.next} Per farlo adesso, il pulsante qui sotto.
            </p>
          </div>
        );
      })}
    </div>
  );
}
