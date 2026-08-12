import { Badge } from "@/components/ui/badge";
import {
  GIORNATE,
  type PlayerInsights,
  minutiMedi,
  quotaTitolare,
  showableInsights,
  titolareForte,
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
 * ⚠ **`TitolaritaBadge` e `SetPieceBadges` sono esportati da M10**, che è il
 * terzo chiamante e quello che li rende un componente invece di tre `className`:
 * il Centro dati li usa in due colonne separate, quindi non gli servono le due
 * composizioni pronte (`InsightsLine`, `InsightsMacro`) ma i due pezzi. Il tono,
 * la soglia e la regola «il colore non è mai l'unica informazione» restano
 * decisi qui dentro, in un posto solo.
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

/**
 * Il badge della titolarità: la percentuale **dentro**, e il colore sopra.
 *
 * ⚠ La percentuale non si toglie per fare spazio. La soglia dell'80% cade in una
 * zona densa — 32/38 verde e 30/38 grigio, due partite di distanza — e regge solo
 * perché il numero è leggibile accanto al colore. Il perché per esteso, con la
 * misura, sta su `SOGLIA_TITOLARE` in `lib/domain.ts`.
 */
export function TitolaritaBadge({
  insights,
  compact = false,
}: {
  insights: PlayerInsights;
  compact?: boolean;
}) {
  return (
    <InsightBadge tono={titolareForte(insights) ? "verde" : "neutro"} compact={compact}>
      {Math.round(quotaTitolare(insights) * 100)}% tit.
    </InsightBadge>
  );
}

/**
 * La riga densa, per la lista di chiamata: si legge in mezzo secondo, con quaranta
 * nomi sotto e un countdown che scorre.
 */
export function InsightsLine({
  insights,
}: {
  insights: PlayerInsights | undefined;
}) {
  const i = showableInsights(insights);
  if (i === null) return null;

  const minuti = minutiMedi(i);

  return (
    <span className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs tabular-nums">
      <TitolaritaBadge insights={i} compact />
      {minuti !== null && <span>{Math.round(minuti)}′</span>}
      <SetPieceBadges insights={i} compact />
    </span>
  );
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
}: {
  insights: PlayerInsights | undefined;
}) {
  const i = showableInsights(insights);
  if (i === null) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <TitolaritaBadge insights={i} />
      <span className="text-muted-foreground tabular-nums">
        {i.startsEleven}/{GIORNATE} da titolare
      </span>
      <SetPieceBadges insights={i} />
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
