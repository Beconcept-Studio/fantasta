import { redirect } from "next/navigation";

import { requireAppAdmin } from "@/lib/auth";
import { adminSectionHref, adminSections } from "@/lib/admin-nav";

/**
 * `/admin` non è una schermata: è la porta, e atterra sulla **prima voce della
 * sidebar** — ricavata da `adminSections()` invece di essere una stringa scritta
 * qui. Riordinare le sezioni sposta anche la destinazione, senza che nessuno se
 * lo debba ricordare.
 *
 * La guardia c'è comunque, prima del redirect: è la regola di §5, e vale anche
 * per una pagina che non disegna niente — chi non è amministratore non deve
 * nemmeno sapere che questa rotta porta da qualche parte.
 */
export default async function AdminHomePage() {
  await requireAppAdmin();
  redirect(adminSectionHref(adminSections()[0]));
}
