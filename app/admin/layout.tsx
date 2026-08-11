import { AdminSidebar } from "@/components/nav/admin-sidebar";
import { requireAppAdmin } from "@/lib/auth";
import { adminSections } from "@/lib/admin-nav";

export const metadata = { title: "Amministrazione — Asta Fantacalcio" };

/**
 * Il guscio del pannello di amministrazione (M6).
 *
 * ⚠ **La guardia qui non è la difesa del pannello, è la cortesia.** Serve a dare
 * a chi non è amministratore un redirect pulito su `/dashboard` invece di una
 * pagina vuota o di un errore. La difesa vera è distribuita: `requireAppAdmin()`
 * in cima **a ogni pagina** e **a ogni server action**, più il motore che rilegge
 * `is_admin` dal database a ogni scrittura.
 *
 * Perché non basta questo layout: una server action è un endpoint raggiungibile
 * per conto proprio — un `POST` con l'id dell'azione dentro, che non attraversa
 * nessun layout — e un pannello protetto solo dal layout è un pannello aperto. È
 * la cosa meno ovvia di questa macro, ed è quella che fa danno se la si
 * semplifica.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAppAdmin();

  return <AdminSidebar sections={adminSections()}>{children}</AdminSidebar>;
}
