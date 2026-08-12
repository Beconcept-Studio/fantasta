import { Badge } from "@/components/ui/badge";
import {
  GIORNATE,
  type PlayerInsights,
  minutiMedi,
  quotaTitolare,
  showableInsights,
} from "@/lib/domain";

/**
 * Gli insight a schermo (M8 §7): due forme, un solo posto dove decidere.
 *
 * ⚠ **Non c'è nessun `if (isPro)` qui dentro, e non deve comparirne uno.** Chi non
 * ha il permesso non riceve affatto il campo `insights` (M8 §6): arriva
 * `undefined`, `showableInsights` restituisce `null` e il blocco non si
 * renderizza. La protezione sta nella query, e questo file si limita a non
 * rompersi quando il dato non c'è — che è una cosa diversa dal nasconderlo.
 *
 * `showableInsights` filtra anche chi ha solo i numeri della stagione precedente:
 * un terzo del listone, che esce come `—`. Vedi `lib/domain.ts`.
 */

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
    <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs tabular-nums">
      <span>
        <span className="text-foreground font-medium">
          {Math.round(quotaTitolare(i) * 100)}%
        </span>{" "}
        tit.
      </span>
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
      <span className="tabular-nums">
        <span className="font-semibold">
          {Math.round(quotaTitolare(i) * 100)}%
        </span>{" "}
        <span className="text-muted-foreground">
          da titolare ({i.startsEleven}/{GIORNATE})
        </span>
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
 * `Rigori 1°` e non un'icona.
 */
function SetPieceBadges({
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
        <Badge
          variant={rigoristaRank === 1 ? "default" : "secondary"}
          className={compact ? "px-1.5 py-0 text-[10px]" : undefined}
        >
          Rigori {rigoristaRank}°
        </Badge>
      )}
      {piazzatiRank !== null && (
        <Badge
          variant="secondary"
          className={compact ? "px-1.5 py-0 text-[10px]" : undefined}
        >
          Piazzati {piazzatiRank}°
        </Badge>
      )}
    </>
  );
}
