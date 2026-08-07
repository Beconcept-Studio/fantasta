import type { ActionError, ErrorCode } from "@/lib/engine/errors";

/**
 * La traduzione dei codici tipizzati in stati HTTP, per i due route handler
 * dell'asta (lo stream e l'heartbeat). Le Server Action non passano di qui:
 * loro il `Result` lo restituiscono così com'è alla pagina.
 *
 * Il messaggio viaggia insieme al codice perché è già scritto per un umano
 * (PLAN §17): la UI lo mostra come sta.
 */
const STATUS: Partial<Record<ErrorCode, number>> = {
  NOT_AUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  MEMBER_NOT_FOUND: 404,
};

export function errorResponse(error: ActionError): Response {
  return Response.json(
    { code: error.code, message: error.message },
    { status: STATUS[error.code] ?? 400 },
  );
}
