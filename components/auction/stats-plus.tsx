"use client";

import { IconaObiettivo } from "@/components/auction/icona-obiettivo";
import { Badge } from "@/components/ui/badge";
import { CARMY_SCALA_MAX, ROLE_LABELS, pmaCrediti, type Role } from "@/lib/domain";
import type {
  Alternativa,
  Alternative,
  AndatiStessaFascia,
  ScartoPartecipante,
  ScartoStrutturale,
  Temperatura,
  TemperaturePerRuolo,
} from "@/lib/stats-plus";
import { FINESTRA_RECENTE, pct, pmaAsta } from "@/lib/stats-plus";

/**
 * Stats+ nel modale d'offerta: **una riga sola**, sotto il campo (M22 §5.1).
 *
 * ## ⚠ Perché sta in un file suo, come `prezzo-consigliato.tsx`
 *
 * Perché è l'unico punto di Stats+ che tocca il modale d'offerta, cioè il posto
 * in cui la decisione del 2026-08-12 aveva **tolto** un numero. Quella decisione
 * non si applica a Stats+ (§5.3: qui non c'è nessuna cifra da offrire — c'è un
 * rapporto misurato su lotti già chiusi), ma la forma di allora si tiene: **una
 * costante sola, con tutte le forme scritte**, così spegnere Stats+ in tutta
 * l'applicazione costa una riga e non una rimozione di codice.
 */

/**
 * Dove compare Stats+, o se non compare affatto.
 *
 * - `campo` — solo nel modale d'offerta: la riga sotto l'input e, da `sm:` in
 *   su, la colonna destra.
 * - `tab` — solo la linguetta Stats+ del portale.
 * - `entrambi` — tutti e due i posti.
 * - `spento` — non compare da nessuna parte. Il calcolo resta, e tace.
 */
export const POSIZIONI_STATS = ["campo", "tab", "entrambi", "spento"] as const;
export type PosizioneStats = (typeof POSIZIONI_STATS)[number];

/**
 * ⚠ **La posizione scelta: `entrambi`.**
 *
 * Spegnere Stats+ in tutta l'applicazione vuol dire scrivere `"spento"` qui, e
 * **non** togliere del codice: i punti d'innesto restano scritti e tacciono da
 * soli, come quello di `PrezzoConsigliato dove="campo"` in `bid-modal.tsx`.
 */
export const POSIZIONE_STATS: PosizioneStats = "entrambi";

/** `−25%` / `+14%`, col segno sempre: senza, `14%` si legge come un livello. */
function segnato(rapporto: number): string {
  const n = pct(rapporto);
  return `${n > 0 ? "+" : ""}${n}%`;
}

/**
 * I tre badge sotto il campo dell'offerta (M23 §1): il PMA del foglio a
 * sinistra, e a destra lo stesso PMA corretto per come il tavolo sta pagando —
 * il **ruolo** dal suo inizio e gli **ultimi lotti**.
 *
 * ⚠ **Tutti e tre dello stesso grigio, ed è una decisione dell'owner**: nessuno
 * dei tre ha la precedenza. Un badge in pieno direbbe «segui questo», e qual
 * numero seguire è la deduzione che questa macro lascia a chi gioca.
 *
 * ⚠ **Nessuna percentuale qui dentro.** Il `−15%` è il ponte fra le cifre, non
 * una cifra in più: la differenza fra 44 e 37 è già visibile, e una percentuale
 * accanto chiederebbe una moltiplicazione a chi ha venti secondi. Le percentuali
 * stanno nella tabella, dove si guarda il quadro invece di decidere un importo.
 *
 * ⚠ **Sotto l'input e non sopra, ed è la risposta all'obiezione del 2026-08-12**
 * (§5.3): sopra il campo un'informazione arriva **prima** della decisione e la
 * sostituisce; sotto, prima vedi la cifra che stai scrivendo e poi il contesto.
 *
 * ⚠ **Una riga sola, e misurata**: 29px contro i 27 della riga di testo che
 * questo blocco sostituisce, e 274px di larghezza sui 361 disponibili a 393px di
 * schermo. È il vincolo di M16 — *«i ~44px che la riga occupava sono altezza
 * restituita al campo, che con la tastiera aperta è la risorsa scarsa»* — e
 * questa forma non li rimette. Una seconda riga sì: non aggiungerne.
 */
export function BadgePma({
  pma,
  budget,
  ruolo,
  recente,
  finestra = FINESTRA_RECENTE,
  posizione = POSIZIONE_STATS,
}: {
  /** Il PMA del chiamato in punti, `null`/`undefined` se il foglio non ne ha uno. */
  pma: number | null | undefined;
  budget: number;
  /** La temperatura del ruolo in corso, `null` se non ha ancora lotti chiusi. */
  ruolo: Temperatura | null;
  /** La temperatura degli ultimi `finestra` lotti, `null` sotto quel numero. */
  recente: Temperatura | null;
  finestra?: number;
  posizione?: PosizioneStats;
}) {
  if (posizione !== "campo" && posizione !== "entrambi") return null;
  // ⚠ Senza PMA non c'è nessuno dei tre numeri, nemmeno il primo: il blocco
  // tace del tutto invece di mostrare due `N/A` e un `—`.
  if (pma === null || pma === undefined) return null;

  return (
    <div className="flex items-center justify-between gap-1.5 text-xs tabular-nums">
      <span className="bg-muted rounded-md px-2 py-0.5">
        PMA: <strong className="font-semibold">{pmaCrediti(pma, budget)}</strong>
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <Derivato etichetta="PMA Ruolo" pma={pma} budget={budget} t={ruolo} />
        <Derivato
          etichetta={`PMA Last ${finestra}`}
          pma={pma}
          budget={budget}
          t={recente}
        />
      </span>
    </div>
  );
}

/**
 * Un badge derivato, o lo stesso badge con `N/A`.
 *
 * ⚠ **`N/A` e non un badge che sparisce**: una casella che a volte c'è e a volte
 * no si legge come un difetto di allineamento — è la stessa decisione del
 * segnalibro sulle righe del listone (owner, 2026-08-28).
 */
function Derivato({
  etichetta,
  pma,
  budget,
  t,
}: {
  etichetta: string;
  pma: number;
  budget: number;
  t: Temperatura | null;
}) {
  return (
    <span
      className={`bg-muted rounded-md px-2 py-0.5 ${t === null ? "text-muted-foreground" : ""}`}
    >
      {etichetta}:{" "}
      <strong className="font-semibold">
        {t === null ? "N/A" : pmaAsta(pma, budget, t.rapporto)}
      </strong>
    </span>
  );
}

/**
 * La tabella della temperatura: **una riga per ruolo, e il totale staccato in
 * fondo** (M23 §2).
 *
 * ⚠ **Il reset al cambio di ruolo si vede perché i ruoli stanno uno sotto
 * l'altro.** Prima era un numero solo, quello del ruolo in corso, che a un certo
 * punto dell'asta ricominciava da capo senza che niente lo dicesse.
 *
 * ⚠ **`N/A` per i ruoli non ancora cominciati, e non `0%`**: uno zero vorrebbe
 * dire «si paga esattamente il PMA», che è un'affermazione. Qui non è stato
 * chiuso ancora niente, ed è un'altra cosa.
 *
 * ⚠ **Il numero di lotti sta accanto alla percentuale**, in 11px: «−45% su 13
 * lotti» e «−45% su 40» non sono la stessa affermazione, e la differenza non si
 * vede dal numero.
 *
 * ⚠ **Nessun `box-shadow` e nessun badge in pieno** (owner, M23): il ruolo in
 * corso si segna con `border-l-2`, il totale con una riga più marcata. Un'ombra
 * o un fondo scuro sarebbero una priorità, e qui nessun numero ce l'ha.
 */
export function TabellaTemperature({
  temperature,
  roleOrder,
  currentRole,
}: {
  temperature: TemperaturePerRuolo;
  roleOrder: Role[];
  currentRole: Role | null;
}) {
  const indiceCorrente = currentRole === null ? -1 : roleOrder.indexOf(currentRole);

  return (
    <div className="flex flex-col">
      {roleOrder.map((role, i) => {
        const t = temperature.perRuolo[role];
        const inCorso = role === currentRole;
        // Chiuso = sta prima del corrente nell'ordine; ad asta finita
        // (`currentRole === null`) lo sono tutti quelli che hanno dei lotti.
        const chiuso = indiceCorrente === -1 ? t !== null : i < indiceCorrente;
        return (
          <div
            key={role}
            className={`flex items-center justify-between gap-2 px-2 py-1.5 ${
              i > 0 ? "border-t" : ""
            } ${
              // ⚠ **`rounded-r-md` e non `rounded-md`**: con l'angolo arrotondato
              // anche a sinistra, il bordo da 2px si curva e la riga si legge
              // come una parentesi quadra invece che come un binario. Visto sul
              // banco col CSS vero, non dedotto.
              inCorso
                ? "bg-background border-primary border-t-transparent border-l-2 rounded-r-md pl-1.5"
                : "rounded-md"
            } ${!inCorso && !chiuso ? "text-muted-foreground" : ""}`}
          >
            <span className="flex min-w-0 items-baseline gap-1.5 text-sm font-medium">
              {ROLE_LABELS[role]}
              {(inCorso || chiuso) && (
                <span className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                  {inCorso ? "in corso" : "chiuso"}
                </span>
              )}
            </span>
            <RigaValore t={t} />
          </div>
        );
      })}

      <div className="border-muted-foreground mt-2 flex items-center justify-between gap-2 border-t px-2 pt-2.5">
        <span className="text-sm font-medium">Tutta l&apos;asta</span>
        <RigaValore t={temperature.totale} />
      </div>
    </div>
  );
}

/**
 * La percentuale in badge col suo numero di lotti accanto, oppure `N/A`.
 *
 * ⚠ **Il badge ha un bordo e nessun fondo suo, e non è una preferenza: con un
 * fondo era invisibile.** Questa tabella sta dentro un `Riquadro`, che è
 * `bg-muted`, e nel tema dell'app `--muted`, `--secondary` e `--accent` valgono
 * tutti `oklch(0.97)`: un badge `secondary` lì è lo stesso grigio su se stesso.
 * E **`bg-background` non risolve**, perché la riga del ruolo in corso è già
 * bianca — un badge bianco sparirebbe proprio sulla riga che conta. Un bordo si
 * vede su tutti e due i fondi, resta neutro (nessun colore, nessuna ombra) ed è
 * il `variant="outline"` che shadcn usa per la stessa ragione.
 *
 * ⚠ **Trovato guardando il banco col CSS compilato dell'app**: nel mock i due
 * grigi erano token distinti e il difetto non si vedeva. È la ragione per cui il
 * banco esiste.
 */
function RigaValore({ t }: { t: Temperatura | null }) {
  if (t === null) {
    return <span className="text-muted-foreground text-xs tabular-nums">N/A</span>;
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
      <span className="text-muted-foreground text-[11px]">
        {t.n} {t.n === 1 ? "lotto" : "lotti"}
      </span>
      <span className="rounded-md border px-1.5 py-0.5 text-xs font-medium">
        {segnato(t.rapporto)}
      </span>
    </span>
  );
}

// ─── La colonna destra del modale, da `sm:` in su (§5.1) ─────────────────────

/**
 * ⚠ **Fondo neutro e nessun colore, come tutto ciò che non è una fase.** Nel
 * portale il colore **significa una fase**: `SceneTone` e la fascia da 4px della
 * colonna 3 (M17 §3) parlano quel vocabolario, e ciò che si percepisce in
 * periferia dell'occhio è la striscia che cambia. Un riquadro colorato qui
 * direbbe qualcosa che non ha da dire.
 */
function Riquadro({
  titolo,
  children,
}: {
  titolo: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-muted min-w-0 rounded-lg p-3">
      <h3 className="text-muted-foreground mb-2 text-[11px] font-medium tracking-wide uppercase">
        {titolo}
      </h3>
      {children}
    </section>
  );
}

/** Una frase al posto di un `—` muto: ogni stato normale ha la sua (§8). */
function Niente({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground text-xs">{children}</p>;
}

/** Una riga di alternativa: i fatti che discriminano, in ordine di decisione (§4.3). */
function RigaAlternativa({ x }: { x: Alternativa }) {
  return (
    <li className="flex items-center gap-2 py-1 text-xs">
      <IconaObiettivo obiettivo={x.obiettivo} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {x.name}{" "}
        <span className="text-muted-foreground">{x.team.slice(0, 3).toUpperCase()}</span>
      </span>
      <Badge variant="secondary" className="h-4.5 shrink-0 px-1.5 py-0 text-[10px]">
        T {x.titolarita}/{CARMY_SCALA_MAX}
      </Badge>
      {x.fmvExp !== null && (
        <Badge variant="secondary" className="h-4.5 shrink-0 px-1.5 py-0 text-[10px]">
          FMV {x.fmvExp}
        </Badge>
      )}
      <span className="shrink-0 tabular-nums">{x.atteso}</span>
    </li>
  );
}

/**
 * ⚠ **Niente conteggi di partite nelle righe** (owner, 2026-08-29). `T 4/5` è il
 * giudizio del foglio e basta a decidere; «30 presenze da titolare» è un numero
 * in più da leggere in venti secondi, e il posto in cui si confrontano i
 * giocatori è la tab Listone, non il modale d'offerta. È la stessa distinzione
 * che `InsightsMacro` fa già: *«qui non si confronta, si decide una cifra»*.
 */
function ListaAlternative({
  titolo,
  righe,
  vuoto,
}: {
  titolo: string;
  /**
   * ⚠ **`null` non è la lista vuota, ed è una distinzione che si perde in un
   * attimo** (§8). Vuota vuol dire «non c'è nessuna alternativa libera», che è
   * un'informazione; `null` vuol dire «questo giocatore non ha un PMA nel tuo
   * foglio», cioè che non c'è **nessun criterio** per catalogarlo. Scriverle allo
   * stesso modo direbbe a chi guarda che il campo è sgombro, quando invece non
   * si è nemmeno guardato.
   */
  righe: Alternativa[] | null;
  vuoto: string;
}) {
  return (
    <Riquadro titolo={titolo}>
      {righe === null ? (
        <Niente>Questo giocatore non ha un PMA nel tuo foglio.</Niente>
      ) : righe.length === 0 ? (
        <Niente>{vuoto}</Niente>
      ) : (
        <ul className="divide-y">
          {righe.slice(0, 6).map((x) => (
            <RigaAlternativa key={x.playerId} x={x} />
          ))}
        </ul>
      )}
    </Riquadro>
  );
}

/**
 * La sezione Stats+ del modale, da `sm:` in su.
 *
 * ⚠ **La griglia 2×2 da `xl:` accoppia i blocchi che si leggono insieme, e
 * l'accoppiamento è il punto** (owner, 2026-08-29): **temperatura accanto ai già
 * andati** — il livello del ruolo accanto alle prove che lo producono — e **pari
 * livello accanto a costano meno**, le due liste fra cui si sceglie. Una colonna
 * singola mette quattro blocchi in fila e lascia al lettore il compito di
 * appaiarli.
 *
 * ⚠ **Scorre nel proprio contenitore** (`overflow-y-auto`) invece di allungare
 * la card: su un portatile basso, allungandola, spingerebbe «Conferma» sotto il
 * bordo. La colonna destra è più alta della sinistra, e sotto «Chiudi» resta
 * spazio vuoto: è la conseguenza accettata di tenere la colonna dell'offerta
 * identica al telefono.
 *
 * ⚠ **E `overflow-y-auto` da solo NON basta — misurato, non dedotto.** Un
 * elemento di griglia ha `min-height: auto`, quindi non può rimpicciolirsi sotto
 * il proprio contenuto: l'`overflow` non ha niente da fare e la colonna deborda.
 * E `min-h-0` sull'elemento **non basta neanche lui**, perché la *riga* implicita
 * della griglia è `auto` e cresce comunque. Servono tutte e due le cose:
 * `sm:grid-rows-[minmax(0,1fr)]` sul contenitore in `bid-modal.tsx` e `min-h-0`
 * qui. Misurato in Chrome headless su viewport da 913 a 353px di altezza: senza
 * la riga vincolata la colonna resta a 472px e `scrollHeight === clientHeight`,
 * cioè non scorre affatto; con, si stringe a 439/379/319 e scorre.
 */
export function StatsPlusColonna({
  role,
  temperature,
  roleOrder,
  andati,
  alternative,
  haPma,
  posizione = POSIZIONE_STATS,
}: {
  role: Role | null;
  temperature: TemperaturePerRuolo;
  roleOrder: Role[];
  andati: AndatiStessaFascia | null;
  alternative: Alternative | null;
  /** Il foglio caricato ha dei PMA: senza, non c'è niente da calcolare (§8). */
  haPma: boolean;
  posizione?: PosizioneStats;
}) {
  if (posizione !== "campo" && posizione !== "entrambi") return null;
  if (role === null) return null;

  // ⚠ **Uno stato che non passa da sé**, al contrario di «nessun lotto
  // informativo ancora»: senza PMA non arriverà nessun numero per tutta l'asta,
  // e dirlo è l'unica cosa utile che si può dire.
  if (!haPma) {
    return (
      <div className="hidden min-h-0 min-w-0 overflow-y-auto sm:block">
        <Riquadro titolo="Stats+">
          <Niente>Serve un listone con i PMA.</Niente>
        </Riquadro>
      </div>
    );
  }

  return (
    <div className="hidden min-h-0 min-w-0 overflow-y-auto sm:block">
      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <Riquadro titolo="Temperatura">
          <TabellaTemperature
            temperature={temperature}
            roleOrder={roleOrder}
            currentRole={role}
          />
        </Riquadro>

        <Riquadro titolo="Già andati della stessa fascia">
          {andati === null || andati.righe.length === 0 ? (
            <Niente>Nessuno di questa fascia è ancora andato.</Niente>
          ) : (
            <>
              <ul className="divide-y">
                {andati.righe.slice(0, 6).map((r) => (
                  <li
                    key={r.playerId}
                    className="flex items-center gap-2 py-1 text-xs tabular-nums"
                  >
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    <span className="text-muted-foreground shrink-0">
                      PMA {r.atteso} → {r.price}
                    </span>
                    <span className="w-12 shrink-0 text-right">
                      {r.scarto > 0 ? "+" : ""}
                      {r.scarto} cr
                    </span>
                    <span className="w-14 shrink-0 text-right">
                      {segnato(r.rapporto)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground mt-2 text-[11px]">
                {andati.andati} andati su {andati.totaleFascia} · ne restano{" "}
                {andati.liberiRestanti} oltre a questo
                {andati.allargato && " · allargato alle fasce vicine"}
              </p>
            </>
          )}
        </Riquadro>

        <ListaAlternative
          titolo="Pari livello"
          righe={alternative === null ? null : alternative.pariLivello}
          vuoto="Nessuno libero di pari livello."
        />
        <ListaAlternative
          titolo="Costano meno"
          righe={alternative === null ? null : alternative.costanoMeno}
          vuoto="Nessuno più economico con la stessa titolarità."
        />
      </div>
    </div>
  );
}

// ─── La tab Stats+ (§5.2) ────────────────────────────────────────────────────

/**
 * ⚠ **In testa, sempre, e non è un'introduzione: è la chiave di lettura.**
 * Senza, il primo `−15%` verrà letto come un affare — mentre con otto
 * partecipanti su un foglio tarato per dieci si paga strutturalmente sotto il
 * PMA **ovunque** (§2.2). L'informazione sta nella differenza fra reparti e nel
 * cambiamento nel tempo, mai nella distanza dal PMA nudo.
 */
function ScartoStrutturaleRiga({ s }: { s: ScartoStrutturale }) {
  const percentuale = Math.round((1 - s.copertura) * 100);
  return (
    <p className="text-muted-foreground text-xs">
      Al tavolo ci sono <strong>{s.budgetTavolo}</strong> crediti e il listone ne
      vale <strong>{s.valoreListone}</strong> ai prezzi del foglio
      {percentuale > 0 ? (
        <>
          : circa <strong>{percentuale}%</strong> del valore non lo comprerà
          nessuno, quindi si paga sotto il PMA ovunque.{" "}
          <strong>Guarda le differenze fra reparti</strong>, non la distanza dal
          PMA.
        </>
      ) : (
        <>. Il tavolo copre tutto il listone: qui il PMA non è un tetto.</>
      )}
    </p>
  );
}

/**
 * La tab Stats+ del portale: quattro blocchi, e il **ripiego** che nel modale
 * non c'è (decisione 6 — è qui che vive, dove si confronta invece di decidere).
 *
 * ⚠ **Non è una rotta**, ed è scritto anche su `Tabs.Root`: due rotte
 * smonterebbero `Portal`, quindi `useAuctionStream`, quindi la connessione SSE.
 */
export function StatsPlusTab({
  role,
  temperature,
  roleOrder,
  partecipanti,
  nomiMembri,
  alternative,
  strutturale,
  lottoAperto,
  haPma,
  posizione = POSIZIONE_STATS,
}: {
  role: Role | null;
  temperature: TemperaturePerRuolo;
  roleOrder: Role[];
  partecipanti: ScartoPartecipante[];
  nomiMembri: Map<string, string>;
  alternative: Alternative | null;
  strutturale: ScartoStrutturale;
  lottoAperto: boolean;
  /** Il foglio caricato ha dei PMA: senza, non c'è niente da calcolare (§8). */
  haPma: boolean;
  posizione?: PosizioneStats;
}) {
  if (posizione !== "tab" && posizione !== "entrambi") return null;

  // ⚠ Vedi `StatsPlusColonna`: è uno stato che non passa col tempo, e va
  // distinto da quello che passa.
  if (!haPma) {
    return (
      <Riquadro titolo="Stats+">
        <Niente>
          Serve un listone con i PMA: caricane uno tuo dalla tab Listone, oppure
          chiedi che venga caricato quello globale.
        </Niente>
      </Riquadro>
    );
  }

  return (
    <div className="space-y-3">
      <ScartoStrutturaleRiga s={strutturale} />

      <Riquadro titolo="Temperatura">
        <TabellaTemperature
          temperature={temperature}
          roleOrder={roleOrder}
          currentRole={role}
        />
      </Riquadro>

      <Riquadro titolo="Partecipanti">
        {/* ⚠ **Si mostra il numero e non l'intenzione** (§3.6). «Ha speso l'11%
            in più del piano» è un fatto; «sta risparmiando per l'attacco» è una
            lettura, e la fa chi guarda. */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="py-1 pr-2 font-medium">Squadra</th>
                <th className="py-1 pr-2 text-right font-medium">Speso</th>
                <th className="py-1 pr-2 text-right font-medium">Piano</th>
                <th className="py-1 text-right font-medium">Scarto</th>
              </tr>
            </thead>
            <tbody>
              {partecipanti.map((x) => (
                <tr key={x.memberId} className="border-t">
                  <td className="max-w-[10rem] truncate py-1 pr-2">
                    {nomiMembri.get(x.memberId) ?? "—"}
                  </td>
                  <td className="py-1 pr-2 text-right">{x.speso}</td>
                  <td className="text-muted-foreground py-1 pr-2 text-right">
                    {x.piano}
                  </td>
                  <td className="py-1 text-right">
                    {x.scarto > 0 ? "+" : ""}
                    {x.scarto}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Riquadro>

      {/* ⚠ **Il blocco esiste solo con un lotto aperto**, e fuori da lì lo dice:
          non è un errore da gestire, è uno stato normale (§5.2). */}
      {lottoAperto ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <ListaAlternative
            titolo="Pari livello"
            righe={alternative === null ? null : alternative.pariLivello}
            vuoto="Nessuno libero di pari livello."
          />
          <ListaAlternative
            titolo="Costano meno"
            righe={alternative === null ? null : alternative.costanoMeno}
            vuoto="Nessuno più economico con la stessa titolarità."
          />
          {/* ⚠ **Il ripiego vive qui e non nel modale** (decisione 6): «ti
              riempie lo slot, non te lo risolve» è una cosa da leggere
              confrontando, non da decidere in venti secondi con la tastiera
              aperta. */}
          <ListaAlternative
            titolo="Ripiego"
            righe={alternative === null ? null : alternative.ripiego}
            vuoto="Nessun ripiego libero."
          />
        </div>
      ) : (
        <Riquadro titolo="Alternative">
          <Niente>Le alternative compaiono quando c&apos;è un lotto aperto.</Niente>
        </Riquadro>
      )}
    </div>
  );
}
