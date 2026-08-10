"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type { FormState } from "@/app/auctions/form-state";
import { signIn } from "@/lib/auth";
import { resetPassword } from "@/lib/engine/accounts";
import { RESET_BY_IP, clientIp, hit } from "@/lib/rate-limit";

/**
 * Codice e password nuova, e si entra.
 *
 * ⚠ Il reset **non invalida le sessioni già aperte altrove** (§4): le sessioni
 * sono JWT e non righe a database (P17), e revocarle vorrebbe dire una colonna
 * `sessions_valid_from` più un controllo nel callback `jwt`. È un limite noto,
 * scritto in `docs/DECISIONS.md` invece che scoperto.
 */
export async function resetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim();
  const code = String(formData.get("code") ?? "");
  const password = String(formData.get("password") ?? "");

  const ip = clientIp(await headers());
  const verdict = hit(
    `reset:ip:${ip}`,
    RESET_BY_IP.limit,
    RESET_BY_IP.windowSeconds,
  );
  if (!verdict.allowed) {
    return { error: "Troppe richieste da qui: riprova fra un'ora." };
  }

  const result = await resetPassword({ email, code, password });
  if (!result.ok) return { error: result.error.message };

  await signIn("email", { email, password, redirect: false });
  redirect("/");
}
