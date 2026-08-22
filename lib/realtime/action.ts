import type { ErrorCode } from "@/lib/engine/errors";

/**
 * Il lato client di `POST /api/auctions/:id/action` (F4-10, DECISIONS Fase 4).
 *
 * PLAN §9 lascia libera la scelta fra Server Action e route handler; il portale
 * usa il secondo, che i bot avevano già reso necessario. La ragione, qui, è la
 * UX: sotto un countdown di trenta secondi serve sapere **subito** e con un
 * codice tipizzato se l'offerta è passata, senza rivalidazione della pagina e
 * senza `useActionState` da coordinare con uno stream che intanto sta
 * riscrivendo la schermata da sotto.
 *
 * La risposta non contiene stato — quello arriva dallo snapshot, sempre
 * (regola 3, regola 7). Qui torna solo il verdetto: passata, oppure il perché
 * no, già scritto in italiano da `lib/engine/errors.ts`.
 */

export type ActionPayload =
  | { type: "START"; startSeatIndex: number }
  | { type: "PICK"; playerId: string }
  | { type: "BID"; amount: number }
  /** Solo l'owner; il portale manager di Fase 6 le userà da qui. */
  | { type: "PAUSE" }
  | { type: "RESUME" }
  /** Solo l'owner: chiude il reveal senza aspettarne la scadenza. */
  | { type: "SKIP_REVEAL" }
  /**
   * Solo l'owner (M14): apre le buste senza aspettare la scadenza del cancello dei
   * risultati. Nessun payload — quale lotto lo sa il server, ed è l'unico a saperlo.
   */
  | { type: "SHOW_RESULTS" }
  /**
   * Solo l'owner, e **solo ad asta in pausa dentro il cancello** (M14): butta via il
   * lotto e riporta il turno a chi aveva chiamato. Le condizioni di fase le verifica
   * il motore; qui si sceglie solo cosa mandare.
   */
  | { type: "CANCEL_LOT" }
  /**
   * Gli override del manager (Fase 7), consentiti solo senza un lotto in
   * contesa. Il server rifiuta comunque: qui si sceglie solo cosa mandare.
   */
  | {
      type: "MANUAL_ASSIGN";
      memberId: string;
      playerId: string;
      price: number;
      force?: boolean;
    }
  | { type: "VOID_ASSIGNMENT"; assignmentId: string }
  | { type: "ADJUST_BUDGET"; memberId: string; delta: number; reason: string };

export type ActionResult =
  | { ok: true }
  | { ok: false; code: ErrorCode | "NETWORK"; message: string };

export async function sendAction(
  auctionId: string,
  payload: ActionPayload,
): Promise<ActionResult> {
  let response: Response;
  try {
    response = await fetch(`/api/auctions/${auctionId}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Il caso vero: il wifi della stanza che sparisce per due secondi. Va detto
    // esplicitamente, perché l'utente deve sapere che **non** ha offerto.
    return {
      ok: false,
      code: "NETWORK",
      message: "Connessione assente: l'invio non è andato. Riprova.",
    };
  }

  if (response.ok) return { ok: true };

  const body: unknown = await response.json().catch(() => null);
  if (
    typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof (body as { message: unknown }).message === "string"
  ) {
    const { code, message } = body as { code?: ErrorCode; message: string };
    return { ok: false, code: code ?? "NETWORK", message };
  }
  return {
    ok: false,
    code: "NETWORK",
    message: `Il server ha risposto ${response.status}. Riprova.`,
  };
}
