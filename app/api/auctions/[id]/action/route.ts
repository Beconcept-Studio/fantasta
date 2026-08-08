import { errorResponse } from "@/app/api/http";
import { currentUser } from "@/lib/auth";
import {
  pauseAuction,
  pickPlayer,
  placeBid,
  resumeAuction,
  startAuction,
  withdrawBid,
} from "@/lib/engine/actions";
import type { ActionError, Result } from "@/lib/engine/errors";
import {
  adjustBudget,
  manualAssign,
  voidAssignment,
} from "@/lib/engine/override";

/**
 * `POST /api/auctions/:id/action` — le azioni di gioco via HTTP.
 *
 * PLAN §9 lascia la scelta fra Server Action e Route Handler. Qui serve un
 * route handler per una ragione concreta: **i bot** (F4-10) sono client veri,
 * si autenticano col provider `dev` e devono agire come agirebbe un telefono.
 * Se agissero chiamando il motore nel proprio processo, le loro mutazioni non
 * passerebbero dal processo del server e nessun browser collegato vedrebbe mai
 * niente — il broadcast parte da chi ha scritto (`mutate.ts`), e in dev quello
 * è il server Next, non lo script. Un'asta di prova con i bot serve proprio a
 * guardare il proprio portale mentre gli altri offrono.
 *
 * Nessuna logica qui dentro: si traduce il JSON in una chiamata alle azioni di
 * `lib/engine/actions.ts` e si restituisce il codice tipizzato del rifiuto. La
 * risposta **non contiene lo stato**: quello arriva dallo snapshot, che è
 * l'unico canale (regola 3, regola 7). Chi ha offerto sa che l'offerta è
 * passata perché `ok: true`, e vede il mondo aggiornato quando arriva lo
 * snapshot successivo.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BAD_REQUEST: ActionError = {
  code: "INVALID_REQUEST",
  message: "Richiesta non valida.",
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const user = await currentUser();
  if (!user) {
    return errorResponse({
      code: "NOT_AUTHENTICATED",
      message: "Devi essere autenticato per giocare.",
    });
  }

  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null || !("type" in body)) {
    return errorResponse(BAD_REQUEST);
  }
  const payload = body as Record<string, unknown>;

  let result: Result<unknown>;
  switch (payload.type) {
    case "START": {
      const seat = payload.startSeatIndex;
      if (!Number.isInteger(seat)) return errorResponse(BAD_REQUEST);
      result = await startAuction(user.id, id, seat as number);
      break;
    }
    case "PICK": {
      if (typeof payload.playerId !== "string") return errorResponse(BAD_REQUEST);
      result = await pickPlayer(user.id, id, payload.playerId);
      break;
    }
    case "BID": {
      // La UI disabilita il pulsante, il server rifiuta comunque (regola 6):
      // qui si controlla solo che sia un numero, il resto lo dice il motore.
      if (!Number.isInteger(payload.amount)) return errorResponse(BAD_REQUEST);
      result = await placeBid(user.id, id, payload.amount as number);
      break;
    }
    case "WITHDRAW": {
      result = await withdrawBid(user.id, id);
      break;
    }
    // PAUSE e RESUME sono azioni dell'owner e il loro posto vero è il portale
    // manager (Fase 6). Stanno già qui perché la vista in pausa del
    // partecipante (F5-11) va collaudata adesso, e senza un modo di mettere in
    // pausa l'asta sarebbe codice che nessuno ha mai visto funzionare.
    // `pauseAuction`/`resumeAuction` verificano da sé la proprietà dell'asta.
    case "PAUSE": {
      result = await pauseAuction(user.id, id);
      break;
    }
    case "RESUME": {
      result = await resumeAuction(user.id, id);
      break;
    }
    // Gli override del manager (Fase 7). Passano di qui e non da una rotta
    // loro per la stessa ragione delle offerte: un codice tipizzato subito, e
    // nessuno stato nella risposta. `manualAssign`, `voidAssignment` e
    // `adjustBudget` verificano da sé la proprietà dell'asta e la fase — la UI
    // disabilita, il server rifiuta comunque (regola 6).
    case "MANUAL_ASSIGN": {
      const { memberId, playerId, price, force } = payload;
      if (typeof memberId !== "string" || typeof playerId !== "string") {
        return errorResponse(BAD_REQUEST);
      }
      if (!Number.isInteger(price)) return errorResponse(BAD_REQUEST);
      result = await manualAssign(user.id, id, {
        memberId,
        playerId,
        price: price as number,
        force: force === true,
      });
      break;
    }
    case "VOID_ASSIGNMENT": {
      if (typeof payload.assignmentId !== "string") {
        return errorResponse(BAD_REQUEST);
      }
      result = await voidAssignment(user.id, id, payload.assignmentId);
      break;
    }
    case "ADJUST_BUDGET": {
      const { memberId, delta, reason } = payload;
      if (typeof memberId !== "string" || typeof reason !== "string") {
        return errorResponse(BAD_REQUEST);
      }
      if (!Number.isInteger(delta)) return errorResponse(BAD_REQUEST);
      result = await adjustBudget(user.id, id, memberId, delta as number, reason);
      break;
    }
    default:
      return errorResponse(BAD_REQUEST);
  }

  if (!result.ok) return errorResponse(result.error);
  return Response.json({ ok: true });
}
