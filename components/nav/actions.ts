"use server";

import { signOut } from "@/lib/auth";

/**
 * L'uscita, da qualunque pagina.
 *
 * Stava in `app/dashboard/actions.ts` fino a M2, quando il pulsante «Esci»
 * viveva solo nell'intestazione della dashboard. Ora la navbar è globale, e la
 * server action sta accanto al componente che la usa.
 */
export async function signOutAction() {
  await signOut({ redirectTo: "/signin" });
}
