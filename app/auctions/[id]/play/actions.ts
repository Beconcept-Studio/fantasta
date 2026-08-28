"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { uploadUserListone } from "@/lib/engine/user-listone";

import type { FormState } from "../../form-state";

/**
 * Il caricamento del listone personale, dalla tab Listone (M21 §6).
 *
 * ⚠ **Sta qui, accanto alla pagina che la chiama, e non in `app/admin/`**: è la
 * gemella di `uploadCarmyAction` ma non è un'azione da amministratore — la dà un
 * partecipante, sul proprio account, mentre gioca.
 *
 * ⚠ **Il permesso lo ricontrolla il motore** (`uploadUserListone`), che rifiuta
 * chi non ha `canSeeInsights` anche con il file giusto: qui non c'è una seconda
 * copia della regola, perché due copie di un controllo sono due controlli che un
 * giorno divergono. La UI spegne la tab, il server rifiuta comunque (regola 6).
 *
 * ⚠ **`revalidatePath` sulla pagina di gioco, ed è ciò che fa comparire i dati.**
 * Il listone risolto viaggia su `listPickPool`, che è una prop letta **una volta**
 * all'apertura della pagina (§5): senza questa riga il caricamento riuscirebbe e
 * la tabella continuerebbe a mostrare i valori globali fino al ricarico a mano.
 * Non è lo stato dell'asta e non passa dallo stream — lo stream porta lo
 * snapshot, e il listone non ne fa parte (regola 3).
 */
export async function uploadUserListoneAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Scegli il file .xlsx del tuo foglio." };
  }

  const result = await uploadUserListone(user.id, await file.arrayBuffer());
  if (!result.ok) return { error: result.error.message };

  const auctionId = form.get("auctionId");
  if (typeof auctionId === "string" && auctionId !== "") {
    revalidatePath(`/auctions/${auctionId}/play`);
  }

  const { fromFile, written, obiettivi, unmatched, teamMismatches } =
    result.value;

  // Le stesse tre cose del riepilogo dell'amministratore — righe scritte su
  // righe lette, i nomi non agganciati, le squadre discordanti — più gli
  // obiettivi, che sono il motivo per cui questo caricamento esiste. Chi carica
  // il proprio file ha lo stesso diritto di capire perché è andato storto.
  const parts = [
    `${written} giocatori dal tuo foglio su ${fromFile} righe, ${obiettivi} segnati come obiettivo.`,
  ];
  if (obiettivi === 0) {
    parts.push(
      `Nessun obiettivo: nel foglio la colonna «Obiett.» deve dire «Sì» sui giocatori che vuoi comprare.`,
    );
  }
  if (unmatched.length > 0) {
    parts.push(
      `Non trovati nel listone (${unmatched.length}): ${unmatched.join(", ")} — di solito sono acquisti più recenti del listone caricato.`,
    );
  }
  if (teamMismatches.length > 0) {
    parts.push(
      `Squadra diversa dal listone (${teamMismatches.length}): ${teamMismatches
        .map((m) => `${m.name} — tu ${m.carmy}, listone ${m.listone}`)
        .join("; ")}. Li ho importati comunque: di solito è un trasferimento.`,
    );
  }

  return { error: null, ok: parts.join(" ") };
}
