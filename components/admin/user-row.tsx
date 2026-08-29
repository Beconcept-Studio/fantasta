import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AdminEntry } from "@/lib/engine/admin";

/**
 * Una riga della tabella utenti: **sei celle di dati e un pulsante** (M13 §2).
 *
 * ⚠ **Fino a v1.13.0 questa riga era un form.** Otto colonne, quattro delle quali
 * contenevano un comando: un campo di testo col suo «Salva», «Verifica a mano»,
 * «Rendi admin», «Dai insight» — quindi **quattro `useActionState` per riga**, che
 * su dodici righe sono quarantotto stati di form montati per *guardare* una lista.
 * La domanda più frequente («chi è questa persona, e le manca qualcosa per
 * entrare?») si rispondeva peggio della più rara. Adesso i comandi stanno tutti nel
 * pannello laterale, e qui non c'è nessun hook: la tabella risponde, il modale
 * interviene.
 *
 * ⚠ **Non è un componente server, e non per una dimenticanza.** §2 dice «se la riga
 * può tornare a essere un componente server, ci torni»: non può, perché «Vedi» apre
 * un pannello che vive nel browser, quindi la riga sta nell'albero client di
 * `UsersTable`. Ciò che è tornato indietro è tutto il resto — nessuno stato, nessun
 * effetto, nessuna azione: una funzione dalle prop al markup.
 *
 * Le tre informazioni che se ne sono andate da qui — «Come entra», «Aste»,
 * «Iscritto» — **non sono sparite**: sono nel pannello, che è il primo posto ad
 * avere lo spazio per dirle per esteso.
 */
export type AdminUserView = {
  id: string;
  email: string | null;
  displayName: string | null;
  entry: AdminEntry;
  verified: boolean;
  /** ⚠ **Quando**, non solo se: lo dice il pannello, che ha lo spazio (§5). */
  verifiedOn: string | null;
  isAdmin: boolean;
  /** ⚠ Vede gli insight sul listone (M8). Un amministratore li vede comunque. */
  isPro: boolean;
  /**
   * ⚠ Vede Stats+ nel portale (M22). **Le due differenze con la riga qui sopra
   * sono volute**: vale solo insieme a `isPro`, e l'amministratore *non* lo ha
   * implicito — `canSeeStatsPlus` in `lib/domain.ts` spiega perché.
   */
  statsPlus: boolean;
  isBot: boolean;
  createdOn: string;
  ownedAuctions: number;
  playedAuctions: number;
  /** ⚠ La riga di chi sta guardando: su di sé `is_admin` non si tocca (§5). */
  isSelf: boolean;
};

export function UserRow({
  user,
  onView,
}: {
  user: AdminUserView;
  onView: () => void;
}) {
  return (
    <tr className="border-b last:border-0">
      <td className="px-3 py-2">
        <span className="font-mono text-xs break-all">{user.email ?? "—"}</span>
      </td>

      <td className="px-3 py-2 text-sm">
        {user.displayName ?? <span className="text-muted-foreground">—</span>}
      </td>

      {/*
        ⚠ **Solo questo «No» si nota, e non è un vezzo grafico: è l'ordine della
        lista.** La lista è ordinata per `created_at DESC` perché «la riga su cui un
        amministratore deve agire è quasi sempre quella di chi si è appena iscritto e
        non riesce a entrare» (M6), e quella riga si riconosce **da qui**. È l'unico
        valore della tabella che chiede un intervento.

        Il criterio, scritto perché non venga esteso per simmetria alle altre due:
        **si evidenzia ciò su cui si deve agire, non ciò che è raro.** E la parola
        c'è sempre — il colore non è mai l'unica informazione (M9 §2), che qui vale
        doppio perché non c'è nessun numero accanto a fare da appoggio.
      */}
      <td className="px-3 py-2 text-sm">
        {user.verified ? "Sì" : <Badge variant="destructive">No</Badge>}
      </td>

      <td className="px-3 py-2 text-sm">{user.isAdmin ? "Sì" : "No"}</td>

      <td className="px-3 py-2 text-sm">{user.isPro ? "Sì" : "No"}</td>

      {/*
        ⚠ **«Sì» senza Pro non è un errore da evidenziare**, e va detto perché la
        tentazione c'è: il flag è acceso e non mostra niente. Ma il criterio della
        colonna «Email verificata» qui sopra è **si evidenzia ciò su cui si deve
        agire**, e qui non c'è niente da fare — la combinazione è legale, innocua,
        e spesso transitoria (si accendono i due flag in due gesti). Chi la crea
        l'ha già letta nel pannello, che lo dice mentre si accende.
      */}
      <td className="px-3 py-2 text-sm">{user.statsPlus ? "Sì" : "No"}</td>

      <td className="px-3 py-2 text-right">
        <Button type="button" variant="outline" size="sm" onClick={onView}>
          Vedi
        </Button>
      </td>
    </tr>
  );
}
