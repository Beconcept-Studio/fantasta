import { Badge } from "@/components/ui/badge";
import { SIMULATION_BADGE } from "@/lib/domain";

/**
 * Il marchio di un'asta di prova (M4).
 *
 * Non è decorazione: chi lavora a questa applicazione tiene aperte due schede,
 * una con l'asta vera e una con la simulazione, e le due schermate sono
 * identiche in tutto il resto — è lo stesso codice, di proposito. Deve essere
 * impossibile confondersi, quindi il badge compare **ovunque**: dashboard,
 * intestazione di ogni sezione dell'asta, vista TV.
 *
 * `outline` e non un colore d'allarme: non c'è niente di sbagliato in un'asta
 * simulata, e un badge rosso che compare venti volte smette di essere letto.
 */
export function SimulationBadge() {
  return (
    <Badge variant="outline" className="uppercase">
      {SIMULATION_BADGE}
    </Badge>
  );
}
