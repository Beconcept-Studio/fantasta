import { PrezzoConsigliato } from "@/components/auction/prezzo-consigliato";
import { Badge } from "@/components/ui/badge";
import {
  CARMY_SCALA_MAX,
  type CarmyJudgement,
  GIORNATE,
  type PlayerInsights,
  pmaCrediti,
  showableInsights,
  titolarita,
} from "@/lib/domain";
import { cn } from "@/lib/utils";

/**
 * Gli insight a schermo (M8 §7, colorati da M9): due forme, un solo posto dove
 * decidere.
 *
 * ⚠ **Non c'è nessun `if (isPro)` qui dentro, e non deve comparirne uno.** Chi non
 * ha il permesso non riceve affatto il campo `insights` (M8 §6): arriva
 * `undefined`, `showableInsights` restituisce `null` e il blocco non si
 * renderizza. La protezione sta nella query, e questo file si limita a non
 * rompersi quando il dato non c'è — che è una cosa diversa dal nasconderlo.
 *
 * ⚠ **E per la stessa ragione non esiste un badge «vuoto».** Chi non ha i numeri
 * della stagione corrente — un terzo del listone — non ha *nessun* badge, non un
 * badge grigio a zero: `—` e `0` non si scrivono allo stesso modo, e un badge
 * disegnato vuoto per tutti sarebbe il modo esatto di rendere invisibile la
 * protezione di M8. Vedi `lib/domain.ts`.
 *
 * ⚠ **`TitolaritaAnyBadge` e `SetPieceBadges` sono esportati da M10**, che è il
 * terzo chiamante e quello che li rende un componente invece di tre `className`:
 * il Centro dati li usa in due colonne separate, quindi non gli serve una
 * composizione pronta ma i due pezzi. Il tono, la soglia e la regola «il colore
 * non è mai l'unica informazione» restano decisi qui dentro, in un posto solo.
 *
 * ⚠ **Da M17 di composizioni pronte ne resta una sola, `InsightsMacro`.** C'era
 * anche `InsightsLine`, che disegnava tutto il blocco della lista di chiamata, ed è
 * stata **sciolta** quando l'owner ha ridisegnato la card in quattro righe
 * (2026-08-22): i suoi tre pezzi sono finiti in tre posti diversi della card, e una
 * composizione con un solo chiamante che va spezzata in tre non è un'astrazione, è
 * un ostacolo. Al suo posto ci sono `ValoriCarmy` e `BonusENote`, che sono pezzi
 * come gli altri.
 *
 * ⚠ **Da M10B il badge della titolarità è uno solo per due fonti**, e prima erano
 * due componenti: c'era `TitolaritaBadge` che leggeva le presenze, e il giudizio di
 * Carmy avrebbe voluto il suo. Tenerli separati voleva dire che ogni chiamante
 * decideva **quale dei due** disegnare — cioè tre copie della regola «da dove viene
 * la titolarità», che è esattamente la cosa che `titolarita()` in `lib/domain.ts`
 * esiste per centralizzare. Ora il chiamante passa le due chiavi e non sa quale
 * vince: se un giorno questo file contenesse un `if` sulla provenienza, lo stesso
 * giocatore sarebbe verde in una schermata e grigio nell'altra.
 */

/**
 * I colori, che stanno qui e non in `components/ui/badge.tsx`.
 *
 * Sono **vocabolario del dominio degli insight**, non di un badge qualunque: un
 * verde che vuol dire «parte titolare almeno quattro volte su cinque» non
 * significa niente fuori da questa lista. Il precedente è letterale ed è la voce
 * «Niente `components/ui/dialog.tsx`» di DECISIONS 2026-08-07 — le primitive
 * condivise si allargano quando arriva il secondo chiamante *generico*, e qui non
 * arriverà. (M9 §6.)
 *
 * ⚠ **La spec conta quattro colori, il codice ne rende tre**, e non è una
 * dimenticanza: il «grigio sotto soglia» e il «neutro riservato» di §2 sono la
 * stessa cosa — la variante `secondary` che esiste già. Quando arriverà il
 * prossimo fatto categorico dagli insight userà `neutro`, invece di inventare un
 * quarto colore: quattro sono il massimo che una riga densa regge, il quinto
 * rende illeggibili i primi quattro.
 *
 * ⚠ **Nessun `dark:`, ed è una regola dell'applicazione** (`CLAUDE.md`): l'app
 * gira in chiaro e il tema scuro non esiste. Una variante scura qui sarebbe un
 * colore che nessuno può guardare, cioè un colore che nessuno può verificare — e
 * il giorno che un tema scuro arriverà si tratteranno tutti insieme, guardandoli,
 * non uno per volta a scatola chiusa.
 *
 * La forma — bordo al 40%, fondo al 10%, testo pieno — è quella già usata in
 * cinque punti dell'app (l'offerta salvata, il prezzo vinto, i messaggi del
 * pannello), quindi non introduce un secondo linguaggio.
 */
const TONI = {
  /** Titolarità da `SOGLIA_TITOLARE` in su. */
  verde: "border-emerald-600/40 bg-emerald-600/10 text-emerald-700",
  /** Rigorista e battitore di piazzati: lo stesso blu, perché sono lo stesso tipo di fatto. */
  blu: "border-blue-600/40 bg-blue-600/10 text-blue-700",
  /** Titolarità sotto soglia, **e** il colore di ciò che arriverà. */
  neutro: "",
} as const;

/**
 * Un badge di insight: il tono, e il testo che lo rende leggibile anche a chi non
 * separa i colori.
 *
 * ⚠ **Il colore non è mai l'unica informazione.** Verde e grigio a fianco non li
 * distingue chiunque: per questo il testo dice sempre la percentuale, e non
 * «Titolare» da solo (§2). **Un badge senza testo non si aggiunge a questa lista.**
 *
 * `compact` è la lista di chiamata, dove quaranta nomi scorrono sotto un
 * countdown; senza, è il modale d'offerta.
 */
function InsightBadge({
  tono,
  compact = false,
  children,
}: {
  tono: keyof typeof TONI;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Badge
      // `outline` come base e non `secondary`: porta il bordo, e i tre override di
      // `TONI` passano da `cn`, che è `tailwind-merge` — border, bg e text
      // sostituiscono quelli della variante invece di accodarsi. Il `neutro` non
      // ha override, quindi resta il grigio della primitiva.
      variant={tono === "neutro" ? "secondary" : "outline"}
      className={cn(
        TONI[tono],
        compact && "h-4.5 px-1.5 py-0 text-[10px]",
        "tabular-nums",
      )}
    >
      {children}
    </Badge>
  );
}

// ─── La titolarità (M9, e da M10B con due fonti) ─────────────────────────────

/**
 * Le tre forme fra cui la titolarità giudicata si scrive, e **un posto solo da cui
 * si decide quale vale**.
 *
 * ⚠ **Sono tre perché era una decisione dell'owner, non una deduzione** (M10B §4):
 * cambia ciò che dodici persone leggono sul telefono mentre offrono, ed è la stessa
 * scelta che l'owner ha fatto per i colori di M9 — guardandola su una pagina di
 * prova con quaranta nomi veri sotto. Restano tutte e tre scritte perché il costo
 * di cambiare idea deve essere questa riga e non una riscrittura.
 *
 * - `voto` — «Titolare 4/5». Dice la scala, quindi si capisce senza sapere niente:
 *   un 4 su 5 è un 4 su 5. Costa due caratteri in più su una riga già larga quanto
 *   un telefono.
 * - `parola` — «Titolarissimo» sopra il massimo, «Titolare» sopra la soglia. Si
 *   legge in un colpo d'occhio e non chiede di fare una divisione.
 * - `numero` — «4/5» e basta. La più corta, e la meno leggibile da sola: un `4/5`
 *   in mezzo a `76′` e `Rigori 1°` non dice di cosa è il quattro.
 */
export const FORME_TITOLARITA = ["voto", "parola", "numero"] as const;
export type FormaTitolarita = (typeof FORME_TITOLARITA)[number];

/**
 * ⚠ **La forma scelta dall'owner, 2026-08-12, guardandola** sulla pagina di prova
 * con quaranta nomi veri: **`parola`**.
 *
 * La riga è questa: cambiarla cambia la lista di chiamata, il modale d'offerta e il
 * Centro dati insieme, che è il motivo per cui esiste.
 *
 * ⚠ **Due cose che questa scelta ha comportato, e che vanno lette insieme a lei**,
 * perché sono l'unico modo in cui `parola` resta vera:
 *
 * 1. **Sotto soglia la parola non c'è, e non si inventa.** Il foglio dice «3 su 5»,
 *    non «panchinaro»: chiamarlo così sarebbe attribuire a chi compila il file un
 *    giudizio che non ha scritto. Quei badge portano quindi la scala —
 *    «Titolarità 3/5» — che è anche ciò che tiene in piedi la regola di M9 «il
 *    colore non è mai l'unica informazione».
 * 2. **Il tag `titolarissimo` sparisce dalla riga quando il badge lo dice già.**
 *    È un tag vero del foglio, su 106 giocatori, e senza questa regola la stessa
 *    parola comparirebbe **due volte sulla stessa riga** — una come badge verde e
 *    una come etichetta grigia. Vedi `CarmyTags`.
 */
export const FORMA_TITOLARITA: FormaTitolarita = "parola";

/**
 * Il tag che il badge `parola` dice già da sé, e che quindi non si ripete.
 *
 * ⚠ **Vive qui e non dentro `CarmyTags` per un motivo**: è una conseguenza di
 * `FORMA_TITOLARITA`, non una proprietà dei tag. Se un giorno la forma tornasse a
 * `voto`, questo tag deve **ricomparire** — e con le due cose accanto, chi cambia
 * la costante vede subito anche l'altra riga da cambiare.
 */
const TAG_DETTO_DAL_BADGE = "titolarissimo";

/**
 * Il badge della titolarità **giudicata**: il verde di M9 sulla scala di Carmy.
 *
 * ⚠ **Il colore non è mai l'unica informazione**, come per il badge delle
 * presenze: il testo dice sempre *quanto*, e la soglia (`>= 4`) sta in
 * `lib/domain.ts` con la sua misura accanto — 168 su 497, cioè un nome su tre.
 */
function TitolaritaCarmyBadge({
  voto,
  forte,
  compact = false,
  forma = FORMA_TITOLARITA,
}: {
  voto: number;
  forte: boolean;
  compact?: boolean;
  forma?: FormaTitolarita;
}) {
  const testo =
    forma === "numero"
      ? `${voto}/${CARMY_SCALA_MAX}`
      : forma === "parola"
        ? voto >= CARMY_SCALA_MAX
          ? "Titolarissimo"
          : forte
            ? "Titolare"
            : // ⚠ Sotto soglia la parola non esiste, e non si inventa: il foglio
              // dice «3 su 5», non «panchinaro». Si scrive «Titolarità», non
              // «Titolare», perché un badge grigio che dice «Titolare 3/5»
              // afferma la cosa che il grigio sta negando.
              `Titolarità ${voto}/${CARMY_SCALA_MAX}`
        : `Titolare ${voto}/${CARMY_SCALA_MAX}`;

  return (
    <InsightBadge tono={forte ? "verde" : "neutro"} compact={compact}>
      {testo}
    </InsightBadge>
  );
}

/**
 * La titolarità, **da qualunque delle due fonti venga**: è il badge che i tre
 * chiamanti usano da M10B.
 *
 * ⚠ **Non decide niente da sé**: la scelta fra Carmy e le presenze la fa
 * `titolarita()` in `lib/domain.ts`, in un posto solo e con il suo test. Qui si
 * disegna il risultato. Il giorno in cui questa funzione contenesse un `if` sulla
 * provenienza, esisterebbero due regole per la stessa cosa e lo stesso giocatore
 * sarebbe verde in una schermata e grigio nell'altra.
 *
 * ⚠ **Il rapporto grezzo resta fuori dal badge**, in grigio accanto (owner, M9):
 * `5/5` da solo è un'affermazione che nessuno può controllare, `5/5` accanto a
 * `3/38` è un'affermazione con la sua prova — **e quando i due divergono, quella
 * divergenza è l'informazione più preziosa della riga**. Chi lo mostra è il
 * chiamante, perché nella lista di chiamata non c'è spazio e nel modale sì.
 */
export function TitolaritaAnyBadge({
  insights,
  carmy,
  compact = false,
}: {
  insights: PlayerInsights | undefined;
  carmy: CarmyJudgement | undefined;
  compact?: boolean;
}) {
  const t = titolarita(insights, carmy);
  if (t === null) return null;

  if (t.fonte === "carmy") {
    return (
      <TitolaritaCarmyBadge voto={t.voto} forte={t.forte} compact={compact} />
    );
  }

  /*
   * Il ripiego di M9, per quando il foglio non è caricato o quel nome non ha
   * agganciato: identico a com'era, percentuale compresa.
   *
   * ⚠ **La percentuale non si toglie per fare spazio.** La soglia dell'80% cade in
   * una zona densa — 32/38 verde e 30/38 grigio, due partite di distanza — e regge
   * solo perché il numero è leggibile accanto al colore. Il perché per esteso, con
   * la misura, sta su `SOGLIA_TITOLARE` in `lib/domain.ts`.
   */
  return (
    <InsightBadge tono={t.forte ? "verde" : "neutro"} compact={compact}>
      {Math.round(t.quota * 100)}% tit.
    </InsightBadge>
  );
}

/**
 * I tag di Carmy, e **quanti se ne mostrano dove**.
 *
 * ⚠ **Uno nella lista di chiamata, tutti nel modale** (M10B §6). Un giocatore ne
 * ha in media due su diciassette etichette: cinque tag su una riga larga quanto un
 * telefono sono cinque etichette che non vengono lette e che rubano l'altezza al
 * nome. Il primo è quello che chi compila il foglio ha scritto per primo, che è
 * l'unica gerarchia disponibile — e non si inventa un ordine di importanza nostro.
 */
export function CarmyTags({
  tags,
  max,
  compact = false,
}: {
  tags: string[];
  max?: number;
  compact?: boolean;
}) {
  /*
   * ⚠ **Si toglie il tag che il badge sta già dicendo a parole** (vedi
   * `FORMA_TITOLARITA`). Con la forma `parola` scelta dall'owner, «Titolarissimo»
   * è il badge verde di chi sta a 5, e `titolarissimo` è un tag che il foglio
   * scrive su 106 giocatori: senza questa riga, la stessa parola comparirebbe due
   * volte sulla stessa riga di un telefono — una verde e una grigia — e il posto
   * che ruba è quello del secondo tag, cioè di un'informazione che non c'è altrove.
   *
   * Non si filtra il tag *sempre*: solo quando la forma attiva lo dice. Con la
   * forma `voto` o `numero` il badge non pronuncia nessuna parola, e il tag torna
   * a essere l'unico posto in cui quella cosa è scritta.
   */
  const utili =
    FORMA_TITOLARITA === "parola"
      ? tags.filter((tag) => tag !== TAG_DETTO_DAL_BADGE)
      : tags;
  const shown = max === undefined ? utili : utili.slice(0, max);
  if (shown.length === 0) return null;

  return (
    <>
      {shown.map((tag) => (
        <InsightBadge key={tag} tono="neutro" compact={compact}>
          {tag}
        </InsightBadge>
      ))}
    </>
  );
}

/** La fascia, che è un'etichetta di prezzo e non un giudizio sul giocatore. */
export function FasciaBadge({
  fascia,
  compact = false,
}: {
  fascia: string;
  compact?: boolean;
}) {
  return (
    <InsightBadge tono="neutro" compact={compact}>
      {fascia}
    </InsightBadge>
  );
}

/**
 * **I due numeri che si confrontano**: la fantamedia attesa e il PMA con la sua
 * cifra in crediti (M17, 2026-08-22).
 *
 * ## Perché non è più una riga sola
 *
 * Fino a v1.16.0 esisteva `InsightsLine`, che disegnava tutto il blocco insight
 * della lista di chiamata in due righe: sopra i numeri di stagione, sotto il
 * giudizio del foglio. È stata **sciolta** quando l'owner ha ridisegnato la card
 * in quattro righe (2026-08-22), perché i suoi tre pezzi sono finiti in tre posti
 * diversi — la titolarità in alto a destra accanto alla squadra, questi due numeri
 * accanto al nome, i bonus e le note su una riga loro.
 *
 * Non è una perdita: questo file esporta **pezzi** e non composizioni pronte già
 * da M10, quando il Centro dati ha voluto `TitolaritaAnyBadge` e `SetPieceBadges`
 * separati. Una composizione con un solo chiamante che deve essere spezzata in tre
 * non è un'astrazione, è un ostacolo.
 *
 * ⚠ **`fvm` non è più su questa riga, e non era un mio dato da difendere**: era il
 * Fantavalore di Mercato, che l'owner ha chiesto di togliere non capendo cosa
 * fosse (2026-08-22) — ed era precisamente il rischio che il commento su `FMA`
 * aveva previsto due ore prima. La conseguenza da conoscere sta sul chiamante:
 * **quel numero ordina ancora la lista**.
 */
export function ValoriCarmy({ carmy, budget }: { carmy?: CarmyJudgement; budget: number }) {
  if (carmy?.fmvExp == null && carmy?.pma == null) return null;
  return (
    <span className="text-muted-foreground flex shrink-0 items-baseline gap-1.5 text-xs tabular-nums">
      {/*
        ⚠ **«FMA» e non «FMV»**, ed è la sigla su cui questa card ha già inciampato
        una volta: `fvm` era il Fantavalore di Mercato e stava sulla stessa riga, a
        pochi centimetri: due sigle di tre lettere con le stesse due consonanti per
        due cose che non si somigliano. Adesso `fvm` non si mostra più e la
        collisione non esiste — ma se un giorno tornasse, torna anche il problema.
      */}
      {carmy?.fmvExp != null && (
        <span>
          <span className="opacity-70">FMA</span> {carmy.fmvExp.toFixed(2)}
        </span>
      )}
      {/*
        ⚠ Il PMA con accanto la sua cifra in crediti: una percentuale non si può
        offrire, e sotto un countdown nessuno la converte a mente. La conversione è
        `pmaCrediti`, e **non** è il «prezzo consigliato» del foglio — quello è una
        colonna sua e può dire un numero diverso sullo stesso giocatore.
      */}
      {carmy?.pma != null && (
        <span>
          <span className="opacity-70">PMA</span> {formatPma(carmy.pma)}% (
          {pmaCrediti(carmy.pma, budget)})
        </span>
      )}
    </span>
  );
}

/**
 * **Cosa porta in più**: rigori, piazzati, fascia e le note del foglio.
 *
 * Sono le informazioni qualitative della card, e stanno insieme perché hanno in
 * comune il modo in cui si leggono: non si sommano e non si confrontano fra due
 * giocatori — si notano. È l'altra metà del taglio «per domanda» che ha
 * sostituito il taglio «per fonte» (2026-08-22).
 *
 * `null` quando non c'è niente da dire, così senza il foglio caricato **e** senza
 * insight la card resta identica a quella di v1.10.0, altezza compresa.
 */
export function BonusENote({
  insights,
  carmy,
}: {
  insights: PlayerInsights | undefined;
  carmy?: CarmyJudgement;
}) {
  const i = showableInsights(insights);
  const conBonus = i !== null && (i.rigoristaRank !== null || i.piazzatiRank !== null);
  const conNote = carmy !== undefined && (carmy.fascia !== null || carmy.tags.length > 0);
  if (!conBonus && !conNote) return null;

  return (
    <span className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
      {i !== null && <SetPieceBadges insights={i} compact />}
      {carmy?.fascia != null && <FasciaBadge fascia={carmy.fascia} compact />}
      {carmy !== undefined && <CarmyTags tags={carmy.tags} compact />}
    </span>
  );
}

/**
 * Il `PMA` come lo scrive il foglio: una cifra decimale quando serve, nessuna
 * quando è tonda — `9%`, non `9.0%`.
 *
 * ⚠ **Non porta il `%` dentro**, perché nella lista di chiamata il simbolo è
 * l'unica cosa che distingue questo numero da una quotazione, e va attaccato al
 * numero dal chiamante che decide anche l'etichetta.
 */
export function formatPma(pma: number): string {
  return Number.isInteger(pma) ? String(pma) : pma.toFixed(1);
}

/**
 * Le sole macro, per il momento dell'offerta: quanto è titolare, e se batte.
 *
 * ⚠ **Tre informazioni, non dieci.** Qui non si confronta, si decide una cifra in
 * dieci secondi con un pollice sulla tastiera: ogni numero in più è un numero che
 * non viene letto e che ruba l'altezza al campo dell'offerta.
 *
 * Il rapporto grezzo resta **fuori** dal badge, in grigio (owner, M9): il badge è
 * identico nei due posti — che è ciò che lo rende un componente e non due
 * `className` — e `31/38` è il numero che dice quante partite sono davvero, quindi
 * non si perde per far spazio a un colore.
 */
export function InsightsMacro({
  insights,
  carmy,
}: {
  insights: PlayerInsights | undefined;
  carmy?: CarmyJudgement;
}) {
  const i = showableInsights(insights);
  const t = titolarita(insights, carmy);
  if (t === null && i === null && !carmy) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <TitolaritaAnyBadge insights={insights} carmy={carmy} />
        {/* Il rapporto grezzo, in grigio: la prova del giudizio. Quando il badge
            viene dalle presenze la percentuale è già dentro il badge, e questo
            numero dice quante partite sono davvero. */}
        {i !== null && (
          <span className="text-muted-foreground tabular-nums">
            {i.startsEleven}/{GIORNATE} da titolare
          </span>
        )}
        {i !== null && <SetPieceBadges insights={i} />}
      </div>

      {/*
        ⚠ **Qui ci sono i secondi per leggere, e per questo è qui che vanno le
        cose che nella lista di chiamata non stanno** (M10B §6): fascia,
        affidabilità, integrità e i tag per esteso. Non tre badge colorati in
        più — un solo tono, perché il verde della titolarità deve restare l'unica
        cosa che salta all'occhio.
      */}
      {carmy && (
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {carmy.fascia !== null && <FasciaBadge fascia={carmy.fascia} compact />}
          {carmy.affidabilita !== null && (
            <span className="tabular-nums">
              affidabilità {carmy.affidabilita}/{CARMY_SCALA_MAX}
            </span>
          )}
          {carmy.integrita !== null && (
            <span className="tabular-nums">
              integrità {carmy.integrita}/{CARMY_SCALA_MAX}
            </span>
          )}
          {/* Il prezzo consigliato, se l'owner ha scelto che stia qui: è uno dei
              **due** punti d'innesto, e quale sia attivo lo decide
              `POSIZIONE_PREZZO` in un posto solo (M10B §6). */}
          <PrezzoConsigliato carmy={carmy} dove="macro" />
          <CarmyTags tags={carmy.tags} compact />
        </div>
      )}
    </div>
  );
}

/**
 * Rigorista e battitore di piazzati, con la loro **posizione**.
 *
 * ⚠ La gerarchia è l'informazione, non il fatto: «secondo rigorista» vale molto
 * meno di «primo», e un pallino colorato le confonderebbe. Per questo si scrive
 * `Rigori 1°` e non un'icona — e per questo il blu non cambia col rank: il colore
 * dice *che* batte, il numero dice *quanto* conta.
 *
 * ⚠ **Si scrive «Piazzati», non «Punizioni»** (M9 §3, DECISIONS 2026-08-12). La
 * fonte ha due liste per squadra, `Rigori` e `Calci piazzati`, e «Calci piazzati»
 * include le punizioni **e i corner**: il primo battitore di una squadra può essere
 * il suo uomo dei corner, e un badge «Punizioni» su di lui direbbe una cosa falsa
 * esattamente nel momento in cui nessuno va a controllare.
 */
export function SetPieceBadges({
  insights,
  compact = false,
}: {
  insights: PlayerInsights;
  compact?: boolean;
}) {
  const { rigoristaRank, piazzatiRank } = insights;
  if (rigoristaRank === null && piazzatiRank === null) return null;

  return (
    <>
      {rigoristaRank !== null && (
        <InsightBadge tono="blu" compact={compact}>
          Rigori {rigoristaRank}°
        </InsightBadge>
      )}
      {piazzatiRank !== null && (
        <InsightBadge tono="blu" compact={compact}>
          Piazzati {piazzatiRank}°
        </InsightBadge>
      )}
    </>
  );
}
