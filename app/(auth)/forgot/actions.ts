"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type { FormState } from "@/app/auctions/form-state";
import { requestPasswordReset } from "@/lib/engine/accounts";
import { RESET_BY_IP, clientIp, hit } from "@/lib/rate-limit";

/**
 * «Password dimenticata»: manda il codice e porta a `/reset`.
 *
 * ⚠ **Questo flusso è non autenticato**, al contrario di `/verify`: chi lo usa
 * è per definizione fuori. Le difese non possono quindi appoggiarsi a una
 * sessione — restano i cinque tentativi della tabella, e sopra ci va questo
 * limite per IP.
 */
export async function forgotAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim();

  const ip = clientIp(await headers());
  const verdict = hit(
    `reset:ip:${ip}`,
    RESET_BY_IP.limit,
    RESET_BY_IP.windowSeconds,
  );
  if (!verdict.allowed) {
    return { error: "Troppe richieste da qui: riprova fra un'ora." };
  }

  const result = await requestPasswordReset(email);
  if (!result.ok) return { error: result.error.message };

  // L'indirizzo viaggia nella query string, e va bene: **non è un segreto**, è
  // il segreto che ci mandiamo sopra. Serve solo a non farlo riscrivere nella
  // schermata dopo, dal telefono, con il codice già in mano.
  redirect(`/reset?email=${encodeURIComponent(email)}`);
}
