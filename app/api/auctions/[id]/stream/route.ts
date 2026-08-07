import { errorResponse } from "@/app/api/http";
import { currentUser } from "@/lib/auth";
import { loadForSnapshot, serializeSnapshot } from "@/lib/engine/snapshot";
import { resolveViewer } from "@/lib/engine/viewer";
import { subscribe } from "@/lib/realtime/broadcast";
import type { Snapshot } from "@/lib/realtime/types";

/**
 * `GET /api/auctions/:id/stream` — il canale verso i client (PLAN §8).
 *
 * Un solo tipo di evento, `snapshot`, e porta sempre lo stato completo. Il
 * primo arriva **subito**, appena la connessione si apre: è ciò che rende il
 * rientro a metà asta un non-problema (§8bis, I10) — chi si riconnette non
 * recupera niente, riceve semplicemente com'è il mondo adesso.
 *
 * Tre dettagli che sembrano minori e non lo sono:
 *
 * - **Ci si iscrive prima di mandare il primo snapshot.** Nell'ordine inverso
 *   esisterebbe una finestra in cui una transizione avvenuta fra la lettura e
 *   l'iscrizione non arriverebbe a nessuno. Il rischio opposto — ricevere
 *   prima un broadcast recente e poi lo snapshot iniziale più vecchio — lo
 *   neutralizza il client, che scarta le versioni inferiori (F4-07).
 * - **Un commento `: ping` ogni 15 secondi.** Senza traffico, proxy e reti
 *   mobili chiudono la connessione a metà lotto senza dire niente.
 * - **`X-Accel-Buffering: no`.** Con nginx davanti, senza questo header la
 *   risposta viene bufferizzata e gli snapshot arrivano a blocchi: il
 *   countdown si muoverebbe a scatti di trenta secondi (vedi anche
 *   `proxy_buffering off` nel runbook).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PING_MS = 15_000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const publicToken = new URL(request.url).searchParams.get("token");
  // La TV non ha sessione: se c'è un token, non si tocca nemmeno l'auth.
  const user = publicToken === null ? await currentUser() : null;

  const viewer = await resolveViewer(id, user?.id ?? null, publicToken);
  if (!viewer.ok) return errorResponse(viewer.error);
  const { memberId } = viewer.value;

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let ping: NodeJS.Timeout | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Il client se n'è andato fra un enqueue e l'altro: smetti e basta.
          closed = true;
        }
      };
      const sendSnapshot = (snapshot: Snapshot) =>
        write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);

      unsubscribe = subscribe(id, { viewerMemberId: memberId, send: sendSnapshot });

      const loaded = await loadForSnapshot(id);
      if (loaded) sendSnapshot(serializeSnapshot(loaded, memberId));

      ping = setInterval(() => write(": ping\n\n"), PING_MS);
    },
    cancel() {
      unsubscribe?.();
      unsubscribe = null;
      if (ping) clearInterval(ping);
      ping = null;
    },
  });

  // `cancel` non scatta in tutti i modi in cui una connessione può morire.
  request.signal.addEventListener("abort", () => {
    unsubscribe?.();
    unsubscribe = null;
    if (ping) clearInterval(ping);
    ping = null;
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
