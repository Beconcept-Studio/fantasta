import Link from "next/link";

import { type AdminUserView, UserRow } from "@/components/admin/user-row";
import { romeDay } from "@/lib/auction-log";
import { isVerified, requireAppAdmin } from "@/lib/auth";
import { listAdminUsers } from "@/lib/engine/admin";

/**
 * La lista degli utenti (M6 §4).
 *
 * ⚠ **La guardia sta qui e non solo nel layout**: la regola di §5 vale anche per
 * le pagine, che sono endpoint come le altre. Costa una riga e non dipende
 * dall'albero delle cartelle.
 *
 * **Tabella densa, da scrivania.** Sette colonne strette, nessuna card, nessuna
 * ottimizzazione per il pollice: il pannello si apre da un portatile. Su schermi
 * stretti la tabella scorre in orizzontale dentro il suo contenitore invece di
 * riflowire in un elenco — un elenco di dodici righe con otto campi ciascuna
 * sarebbe più lungo di quanto sia leggibile.
 *
 * **I bot dietro un link e non in lista** (§4): sette righe «Bot 3» per ogni asta
 * simulata renderebbero la lista inutile. Il filtro è una `searchParam` e non uno
 * stato client, così è anche un indirizzo che si può tenere aperto.
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
    isAdmin: user.isAdmin,
    isBot: user.isBot,
    createdOn: romeDay(user.createdAt.toISOString()),
    ownedAuctions: user.ownedAuctions,
    playedAuctions: user.playedAuctions,
    isSelf: user.id === admin.id,
  }));

  return (
    <section className="space-y-4">
      <div className="text-muted-foreground flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span>
          {rows.length} {rows.length === 1 ? "riga" : "righe"}
        </span>
        <Link
          href={includeBots ? "/admin/users" : "/admin/users?bots=1"}
          className="underline underline-offset-4"
        >
          {includeBots ? "nascondi i bot" : "mostra anche i bot"}
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-208 border-collapse text-left">
          <thead className="bg-muted/40 text-muted-foreground text-xs uppercase">
            <tr className="border-b">
              <th className="px-2 py-2 font-medium">Email</th>
              <th className="px-2 py-2 font-medium">Nome</th>
              <th className="px-2 py-2 font-medium">Come entra</th>
              <th className="px-2 py-2 font-medium">Indirizzo</th>
              <th className="px-2 py-2 font-medium">Permessi</th>
              {/* Possedute / giocate: i due numeri con cui si capisce se una
                  riga è una persona o un residuo. */}
              <th className="px-2 py-2 font-medium">Aste</th>
              <th className="px-2 py-2 font-medium">Iscritto</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((user) => (
              <UserRow key={user.id} user={user} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-muted-foreground max-w-2xl text-xs">
        L&apos;indirizzo email non si modifica: da quando si entra anche con una
        password è la chiave d&apos;identità, e cambiarla cambia chi può entrare
        in quell&apos;account. Un indirizzo sbagliato si risolve rifacendo
        l&apos;account.
      </p>
    </section>
  );
}
