import { errorResponse } from "@/app/api/http";
import { currentUser } from "@/lib/auth";
import { exportXlsx } from "@/lib/engine/export";

/**
 * `GET /api/auctions/:id/export` — il listone con le rose dentro (F7-06).
 *
 * L'unica azione della Fase 7 che **non** passa dal dispatcher
 * `POST .../action`: un download ha bisogno di un URL da mettere in un link, di
 * un `Content-Type` e di un `Content-Disposition`, e nessuna delle tre cose sta
 * in una risposta JSON. È anche l'unica rotta dell'applicazione che restituisce
 * qualcosa che non sia uno snapshot o un verdetto — ed è innocua per la regola
 * 3, perché non esce nessuno stato dell'asta: escono le rose **finite**, che a
 * quel punto sono pubbliche per definizione.
 *
 * Solo l'owner: lo verifica `exportXlsx`, non questa funzione.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const user = await currentUser();
  if (!user) {
    return errorResponse({
      code: "NOT_AUTHENTICATED",
      message: "Devi essere autenticato per esportare l'asta.",
    });
  }

  const result = await exportXlsx(user.id, id);
  if (!result.ok) return errorResponse(result.error);

  const { fileName, bytes } = result.value;
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
