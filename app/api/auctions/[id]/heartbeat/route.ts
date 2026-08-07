import { errorResponse } from "@/app/api/http";
import { currentUser } from "@/lib/auth";
import { recordHeartbeat } from "@/lib/engine/presence";
import { resolveViewer } from "@/lib/engine/viewer";
import { schedulePresenceSnapshot } from "@/lib/realtime/broadcast";

/**
 * `POST /api/auctions/:id/heartbeat` — «ci sono, e sto guardando» (PLAN §7).
 *
 * Ogni 10 secondi, con `{ visible }` dalla Page Visibility API. Scrive due
 * colonne di telemetria **fuori da `withAuctionLock`** e senza toccare
 * `state_version` (⚠ P8): non è stato-macchina, e passare dodici heartbeat al
 * minuto dal lock dell'asta sarebbe metterli in fila dietro le offerte.
 *
 * L'invio ai client parte **solo se qualcuno ha davvero cambiato stato**, ed è
 * coalescato: un heartbeat non è uno snapshot. Il caso che conta non è chi
 * batte il colpo, è chi smette di batterlo — e a quello si accorge il primo
 * heartbeat che arriva dopo la scadenza dei 15 secondi.
 *
 * Solo i membri hanno un heartbeat: il manager che non gioca e la vista TV non
 * hanno una riga `members` da aggiornare, e in lobby non li aspetta nessuno.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const user = await currentUser();

  const viewer = await resolveViewer(id, user?.id ?? null, null);
  if (!viewer.ok) return errorResponse(viewer.error);
  if (viewer.value.memberId === null) {
    return errorResponse({
      code: "MEMBER_NOT_FOUND",
      message: "Non sei un partecipante di questa asta.",
    });
  }

  const body: unknown = await request.json().catch(() => ({}));
  const visible =
    typeof body === "object" && body !== null && "visible" in body
      ? Boolean((body as { visible: unknown }).visible)
      : true;

  const { presence, changed } = await recordHeartbeat(
    id,
    viewer.value.memberId,
    visible,
  );
  if (changed) schedulePresenceSnapshot(id);

  return Response.json({
    ok: true,
    presence: Object.fromEntries(presence),
  });
}
