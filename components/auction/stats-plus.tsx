"use client";

import { IconaObiettivo } from "@/components/auction/icona-obiettivo";
import { Badge } from "@/components/ui/badge";
import { CARMY_SCALA_MAX, ROLE_LABELS, type Role } from "@/lib/domain";
import type {
  Alternativa,
  Alternative,
  AndatiStessaFascia,
  Avviso,
  Scatto,
  Temperatura,
} from "@/lib/stats-plus";
import { pct } from "@/lib/stats-plus";

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

/**
 * ⚠ **Il budget di caratteri della riga, e non è un'intenzione: è misurato**
 * (mock del 2026-08-29). A 384px, con `text-xs`, oltre ~45 caratteri la riga va
 * a capo e il blocco passa da **31px a 49px** — cioè rimette esattamente i 44px
 * che M16 aveva restituito al campo, senza che nessuno l'abbia deciso.
 *
 * ⚠ **E l'esempio scritto in §5.1 non ci stava**: «Scatto: D da −25% a +14% · 5
 * pari livello, 2 tuoi» sono **49 caratteri**, cioè quattro oltre il limite che
 * la spec misura cinque righe più sotto. Trovato scrivendo il codice, ed è lo
 * stesso genere di difetto che i mock avevano già trovato tre volte: una forma
 * *scritta a mano* non si contraddice da sé, va **contata**. Per questo la riga
 * qui non è una stringa ma una **composizione che si misura** — e il test di
 * §9.1 la conta su tutte le combinazioni, non su una.
 */
export const MAX_CARATTERI_RIGA = 45;

/** `−25%` / `+14%`, col segno sempre: senza, `14%` si legge come un livello. */
function segnato(rapporto: number): string {
  const n = pct(rapporto);
  return `${n > 0 ? "+" : ""}${n}%`;
}

/**
 * La riga del modale, o `null` se non c'è niente da dire.
 *
 * ⚠ **Si compone dal più informativo al meno, e si tiene la prima forma che
 * sta nel budget.** Non è una furbizia: i nomi dei ruoli hanno lunghezze diverse
 * — `Portieri` sono 8 caratteri e `Centrocampisti` 14 — e una forma sola andrebbe
 * a capo su un ruolo e non sugli altri. Il caso peggiore è quello che decide, e
 * il caso peggiore non è quello che si guarda scrivendo la spec.
 */
export function rigaStatsPlus({
  role,
  temperatura,
  scatto,
  alternative,
}: {
  role: Role;
  temperatura: Temperatura | null;
  scatto: Scatto | null;
  alternative: Alternative | null;
}): string | null {
  const ruolo = ROLE_LABELS[role];

  if (temperatura === null) {
    // Uno stato normale con la sua frase, non un `—` muto (§8).
    return `${ruolo}: ancora nessun lotto`;
  }

  // La testa dice il livello, e lo scatto quando c'è: due regimi valgono più di
  // un livello solo, perché è il cambiamento a decidere.
  const testa =
    scatto === null
      ? `${ruolo} ${segnato(temperatura.mediana)} su ${temperatura.n}`
      : `${ruolo}: da ${segnato(scatto.prima)} a ${segnato(scatto.adesso)}`;

  // La coda conta chi resta, e i propri obiettivi dentro quel conto: è la
  // domanda «posso lasciarlo andare?» ridotta a due numeri.
  const pari = alternative?.pariLivello ?? [];
  const coda =
    pari.length === 0
      ? ""
      : ` · ${pari.length} pari, ${pari.filter((x) => x.obiettivo).length} tuoi`;

  const intera = `${testa}${coda}`;
  return intera.length <= MAX_CARATTERI_RIGA ? intera : testa;
}

/**
 * La riga, disegnata. `null` quando `POSIZIONE_STATS` non la vuole qui.
 *
 * ⚠ **Sotto l'input e non sopra, e non è layout: è la risposta all'obiezione del
 * 2026-08-12** (§5.3). Sopra il campo, un'informazione arriva **prima** della
 * decisione e la sostituisce; sotto, l'ordine di lettura si inverte — prima vedi
 * la cifra che stai scrivendo, poi il contesto. Chi lo vuole lo trova, chi ha
 * già deciso ha già digitato.
 *
 * ⚠ **E una riga sola, non due.** Il commento di M16 in `bid-modal.tsx` dice
 * perché la riga dei valori suggeriti è stata tolta: *«i ~44px che la riga
 * occupava sono altezza restituita al campo, che con la tastiera aperta è la
 * risorsa scarsa»*. Una seconda riga rimetterebbe quell'altezza, in mezzo fra il
 * campo e il suo verdetto, disfacendo una decisione presa apposta.
 */
export function RigaStatsPlus({
  role,
  temperatura,
  scatto,
  alternative,
  posizione = POSIZIONE_STATS,
}: {
  role: Role | null;
  temperatura: Temperatura | null;
  scatto: Scatto | null;
  alternative: Alternative | null;
  /**
   * L'override esiste solo per guardare le forme una accanto all'altra. In
   * applicazione non si passa: la posizione la decide `POSIZIONE_STATS`, in un
   * posto solo.
   */
  posizione?: PosizioneStats;
}) {
  if (posizione !== "campo" && posizione !== "entrambi") return null;
  if (role === null) return null;

  const testo = rigaStatsPlus({ role, temperatura, scatto, alternative });
  if (testo === null) return null;

  return (
    <p className="text-muted-foreground text-xs tabular-nums">{testo}</p>
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

/**
 * L'avviso, e **l'unico posto di Stats+ in cui il colore è informazione**
 * (§5.1): proprio perché tutto il resto è neutro, qui si vede. `amber` è già il
 * vocabolario di `FeedbackLine` per «guarda questo».
 */
function Avvisi({ avvisi }: { avvisi: Avviso[] }) {
  if (avvisi.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1">
      {avvisi.map((a) => (
        <li
          key={a.tipo}
          className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs"
        >
          {a.tipo === "SCATTO" ? (
            <>
              <strong>Scatto</strong> — da {segnato(a.prima)} a{" "}
              {segnato(a.adesso)} dentro il ruolo.
            </>
          ) : (
            <>
              <strong>Cambio d&apos;aria</strong> — {ROLE_LABELS[a.precedente]}{" "}
              {segnato(a.da)}, {ROLE_LABELS[a.role].toLowerCase()}{" "}
              {segnato(a.a)}.
            </>
          )}
        </li>
      ))}
    </ul>
  );
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
  righe: Alternativa[];
  vuoto: string;
}) {
  return (
    <Riquadro titolo={titolo}>
      {righe.length === 0 ? (
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
  temperatura,
  scatto,
  andati,
  alternative,
  avvisi,
  scartoRuolo,
  posizione = POSIZIONE_STATS,
}: {
  role: Role | null;
  temperatura: Temperatura | null;
  scatto: Scatto | null;
  andati: AndatiStessaFascia | null;
  alternative: Alternative | null;
  avvisi: Avviso[];
  /** Σ (pagato − atteso) sui lotti informativi del ruolo, in crediti. */
  scartoRuolo: number;
  posizione?: PosizioneStats;
}) {
  if (posizione !== "campo" && posizione !== "entrambi") return null;
  if (role === null) return null;

  return (
    <div className="hidden min-h-0 min-w-0 overflow-y-auto sm:block">
      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <Riquadro titolo="Temperatura">
          {temperatura === null ? (
            <Niente>Nessun lotto informativo ancora.</Niente>
          ) : (
            <>
              <p className="text-sm tabular-nums">
                <strong className="text-lg">{segnato(temperatura.mediana)}</strong>{" "}
                <span className="text-muted-foreground">
                  sul PMA · {ROLE_LABELS[role].toLowerCase()}, {temperatura.n}{" "}
                  {temperatura.n === 1 ? "lotto" : "lotti"}
                </span>
              </p>
              <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                {scatto !== null && (
                  <>
                    prima {segnato(scatto.prima)}, adesso {segnato(scatto.adesso)} ·{" "}
                  </>
                )}
                {/* ⚠ Somma degli scarti osservati, **non** il saldo di §3.2: quello
                    si mostra solo per i ruoli chiusi, perché a metà ruolo il
                    confronto con l'intero piano direbbe sempre «avanza
                    tantissimo». Qui si somma solo ciò che è già successo. */}
                sul totale il ruolo ha speso{" "}
                <strong>{Math.abs(scartoRuolo)} crediti</strong>{" "}
                {scartoRuolo <= 0 ? "in meno" : "in più"} del foglio
              </p>
              <p className="text-muted-foreground mt-1 text-[11px] tabular-nums">
                da {segnato(temperatura.min)} a {segnato(temperatura.max)}
              </p>
            </>
          )}
          <Avvisi avvisi={avvisi} />
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
          righe={alternative?.pariLivello ?? []}
          vuoto="Nessuno libero di pari livello."
        />
        <ListaAlternative
          titolo="Costano meno"
          righe={alternative?.costanoMeno ?? []}
          vuoto="Nessuno più economico con la stessa titolarità."
        />
      </div>
    </div>
  );
}
