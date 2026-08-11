"use server";

import { revalidatePath } from "next/cache";

import type { FormState } from "@/app/auctions/form-state";
import { requireAppAdmin } from "@/lib/auth";
import { ADMIN_ROOT } from "@/lib/admin-nav";
import {
  forceVerifyEmail,
  setUserAdmin,
  setUserDisplayName,
} from "@/lib/engine/admin";
import { deleteAuction } from "@/lib/engine/setup";

/**
 * Le Server Action del pannello di amministrazione (M6).
 *
 * ⚠ **`requireAppAdmin()` è la prima riga di ognuna, e non è una ripetizione da
 * togliere.** Il layout `/admin` ha la sua guardia, ma un layout non protegge
 * niente: una server action è un endpoint raggiungibile per conto proprio — un
 * `POST` con l'id dell'azione dentro, senza mai aprire una pagina del pannello —
 * e un pannello protetto solo dal layout è un pannello aperto. È la cosa meno
 * ovvia di questa macro e quella che fa danno se la si semplifica.
 *
 * La guardia sta **in cima**, prima di leggere un solo campo della `FormData`:
 * così il rifiuto non dipende da cosa c'è nel form. Un test in
 * `tests/db/admin.test.ts` enumera gli export di questo file e li chiama tutti
 * con un form vuoto — se un'azione nuova nascesse senza guardia, quel test si
 * rompe. Ed è un'uguaglianza esatta, non un «almeno queste»: aggiungere
 * un'azione qui obbliga a guardare in faccia la riga della guardia.
 *
 * Sono sottili come quelle del setup: leggono la `FormData` e girano tutto a
 * `lib/engine/admin.ts`, dove ogni mutazione **rilegge `is_admin` dal database**.
 * La sessione è un JWT e non sa niente dei permessi (P17), quindi la guardia qui
 * e il controllo là non sono lo stesso controllo scritto due volte: uno decide
 * chi entra, l'altro chi comanda ancora nel momento in cui scrive.
 */

function text(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === "string" ? value : undefined;
}

const USERS_PATH = `${ADMIN_ROOT}/users`;
const AUCTIONS_PATH = `${ADMIN_ROOT}/auctions`;

/** Correggere il nome scritto male da qualcun altro. */
export async function setUserDisplayNameAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const admin = await requireAppAdmin();
  const userId = text(form, "userId");
  if (!userId) return { error: "Utente non indicato." };

  const result = await setUserDisplayName(
    admin.id,
    userId,
    form.get("displayName"),
  );
  if (!result.ok) return { error: result.error.message };

  revalidatePath(USERS_PATH);
  return { error: null, ok: `Nome aggiornato: ${result.value.displayName}.` };
}

/** Il pulsante che chiude la finestra di M5 §9. */
export async function forceVerifyEmailAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const admin = await requireAppAdmin();
  const userId = text(form, "userId");
  if (!userId) return { error: "Utente non indicato." };

  const result = await forceVerifyEmail(admin.id, userId);
  if (!result.ok) return { error: result.error.message };

  revalidatePath(USERS_PATH);
  return { error: null, ok: "Indirizzo verificato a mano: ora può entrare." };
}

/**
 * Dare o togliere il permesso di amministratore.
 *
 * L'intenzione arriva come stringa e diventa un booleano **qui**: il motore
 * riceve `unknown` e rifiuta ciò che non è un booleano, perché è lui a dover
 * restare vero anche se un giorno lo chiamasse qualcun altro (regola 6).
 */
export async function setUserAdminAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const admin = await requireAppAdmin();
  const userId = text(form, "userId");
  if (!userId) return { error: "Utente non indicato." };

  const wanted = text(form, "isAdmin");
  const result = await setUserAdmin(
    admin.id,
    userId,
    wanted === "true" ? true : wanted === "false" ? false : undefined,
  );
  if (!result.ok) return { error: result.error.message };

  revalidatePath(USERS_PATH);
  return {
    error: null,
    ok: result.value.isAdmin
      ? "Adesso è amministratore dell'applicazione."
      : "Non è più amministratore dell'applicazione.",
  };
}

/**
 * La cancellazione di un'asta dal pannello.
 *
 * È un'azione a sé e non quella del setup, per una ragione di destinazione: da
 * `/auctions/[id]/setup` si finisce in dashboard, da qui si torna alla lista del
 * pannello. Il motore è lo stesso — `deleteAuction`, allargata di una riga in
 * M6 — e resta lui a rifiutare un'asta `LIVE` o `PAUSED`, anche a un
 * amministratore.
 *
 * Il nome digitato si confronta **qui**, come nel setup: è una difesa contro la
 * mano, non contro il chiamante, e nel motore diventerebbe un parametro che ogni
 * altro chiamante dovrebbe ricordarsi di riempire.
 */
export async function deleteAuctionAsAdminAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const admin = await requireAppAdmin();
  const auctionId = text(form, "auctionId");
  if (!auctionId) return { error: "Asta non indicata." };

  if (text(form, "confirmName")?.trim() !== text(form, "name")?.trim()) {
    return { error: "Il nome non coincide: l'asta non è stata cancellata." };
  }

  const result = await deleteAuction(admin.id, auctionId);
  if (!result.ok) return { error: result.error.message };

  revalidatePath(AUCTIONS_PATH);
  return { error: null, ok: `Asta «${result.value.name}» cancellata.` };
}
