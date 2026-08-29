import type { AdminUserView } from "@/components/admin/user-row";
import { UsersTable } from "@/components/admin/users-table";
import { romeDateTime, romeDay } from "@/lib/auction-log";
import { isVerified, requireAppAdmin } from "@/lib/auth";
import { listAdminUsers } from "@/lib/engine/admin";

/**
 * La lista degli utenti (M6 §4, rifatta da M13 §2).
 *
 * ⚠ **La guardia sta qui e non solo nel layout**: la regola di M6 §5 vale anche per
 * le pagine, che sono endpoint come le altre. Costa una riga e non dipende
 * dall'albero delle cartelle.
 *
 * **Questa pagina carica i dati e non disegna la tabella**, ed è il cambio di forma
 * di M13: la ricerca filtra righe già arrivate, quindi il conteggio in cima e le
 * righe mostrate dipendono da uno stato che vive nel browser (`UsersTable`). Qui
 * resta ciò che solo il server può fare — la guardia, la query, e la conversione a
 * `Europe/Rome`, che è rendering ma va fatta dove il fuso è fissato.
 *
 * **I bot dietro un link e non in lista** (M6 §4): sette righe «Bot 3» per ogni asta
 * simulata renderebbero la lista inutile. Il filtro è una `searchParam` e non uno
 * stato client — cambia **quali righe il server manda**, al contrario della ricerca
 * — così è anche un indirizzo che si può tenere aperto.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ bots?: string }>;
}) {
  const admin = await requireAppAdmin();
  const { bots } = await searchParams;
  const includeBots = bots === "1";

  const users = await listAdminUsers({ includeBots });
  const rows: AdminUserView[] = users.map((user) => ({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    entry: user.entry,
    // La pagina passa un booleano, non la colonna: `isVerified` è la stessa
    // condizione che la scala di `requireUser()` interroga, e non ne esiste una
    // seconda idea (M5).
    verified: isVerified(user),
    // ⚠ E **quando**, che è la cosa in più che il pannello ha lo spazio per dire:
    // un indirizzo dimostrato da sé e uno verificato a mano la sera dell'asta si
    // distinguono solo da questa data.
    verifiedOn:
      user.emailVerifiedAt === null
        ? null
        : romeDateTime(user.emailVerifiedAt.toISOString()),
    isAdmin: user.isAdmin,
    isPro: user.isPro,
    statsPlus: user.statsPlus,
    isBot: user.isBot,
    createdOn: romeDay(user.createdAt.toISOString()),
    ownedAuctions: user.ownedAuctions,
    playedAuctions: user.playedAuctions,
    isSelf: user.id === admin.id,
  }));

  return <UsersTable rows={rows} includeBots={includeBots} />;
}
