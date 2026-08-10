import { errorResponse } from "@/app/api/http";
import { currentUser } from "@/lib/auth";
import { exportRoseCsv } from "@/lib/engine/export";

/**
 * `GET /api/auctions/:id/export/rose` — il verbale delle rose in .csv (M3 §1).
 *
 * La gemella di `/export/listone`, e la duplicazione fra le due è voluta: sono
 * dieci righe di autenticazione ripetute, contro un segmento dinamico che
 * accetterebbe due valori e li smisterebbe con un `switch`. La prima si legge
 * senza spiegazioni (regola 8).
 *
 * `charset=utf-8` non è decorativo: i nomi squadra hanno gli accenti, e senza
 * dichiarare la codifica un foglio di calcolo che apra il file a Latin-1
 * mostrerebbe «Città» come «CittÃ ».
 *
 * Solo l'owner: lo verifica `exportRoseCsv`, non questa funzione.
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

  const result = await exportRoseCsv(user.id, id);
  if (!result.ok) return errorResponse(result.error);

  const { fileName, bytes } = result.value;
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
