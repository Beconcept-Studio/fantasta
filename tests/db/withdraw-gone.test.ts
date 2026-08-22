import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { bids, lotRounds, lots } from "@/lib/db/schema";
import {
  pickPlayer,
  placeBid,
  startAuction,
} from "@/lib/engine/actions";
import { setBroadcastHook } from "@/lib/engine/mutate";
import { loadForSnapshot } from "@/lib/engine/snapshot";
import { resetBroadcast } from "@/lib/realtime/broadcast";

import { makeGameAuction } from "./game-helpers";
import { closeDatabase, databaseAvailable, dropAuctions, dropUsers } from "./helpers";

/**
 * M16 — **il ritiro non c'è, e la prova è che non c'è nel server**.
 *
 * Questo file è il test «al contrario» della macro, e la ragione per cui esiste
 * è la regola 6 letta al rovescio. La regola dice «la UI disabilita, il server
 * rifiuta comunque»: togliere il pulsante «Ritira» dal modale non basta,
 * perché un `POST` costruito a mano continuerebbe a funzionare e la regola del
 * gioco vivrebbe **soltanto** nel codice del browser. Fra amici il rischio
 * pratico è nullo; il rischio vero è che fra sei mesi nessuno sappia più se il
 * ritiro c'è o no.
 *
 * Quindi si passa dalla rotta HTTP e non dalle azioni: la funzione da chiamare
 * non esiste più, ed è precisamente ciò che va dimostrato. Un `WITHDRAW` cade
 * nel `default` di `route.ts` e torna `INVALID_REQUEST` — «questa azione non
 * esiste», non «non puoi ritirare adesso» — e a database non cambia niente.
 *
 * ⚠ **La colonna `bids.withdrawn_at` non è stata tolta**: le aste già giocate
 * hanno dei ritiri dentro e i loro lettori li raccontano ancora. Quello che qui
 * si asserisce è che resta `NULL`, non che sia sparita.
 */

const currentUser = vi.fn<() => Promise<{ id: string } | null>>();
vi.mock("@/lib/auth", () => ({ currentUser: () => currentUser() }));

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn("\n⚠ Postgres non raggiungibile: i test del ritiro sono saltati.\n");
}

const createdAuctions: string[] = [];
const createdUsers: string[] = [];

beforeEach(() => {
  vi.useRealTimers();
  currentUser.mockResolvedValue(null);
  setBroadcastHook(() => {});
});

afterEach(() => {
  resetBroadcast();
  setBroadcastHook(() => {});
});

afterAll(async () => {
  if (!dbUp) return;
  await dropAuctions(createdAuctions);
  await dropUsers(createdUsers);
  await closeDatabase();
});

function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** Un lotto aperto con una busta dentro: il seat 0 chiama, il seat 1 offre 40. */
async function auctionWithOneBid(now = Date.now()) {
  const game = await makeGameAuction();
  createdAuctions.push(game.auctionId);
  createdUsers.push(...game.userIds, game.ownerId);

  unwrap(await startAuction(game.ownerId, game.auctionId, 0, now));
  const loaded = (await loadForSnapshot(game.auctionId))!;
  const gk = loaded.state.players.find((p) => p.role === "P")!;

  unwrap(await pickPlayer(game.userIds[0], game.auctionId, gk.id, now + 100));
  unwrap(await placeBid(game.userIds[1], game.auctionId, 40, now + 200));

  return game;
}

/** Le righe `bids` del lotto corrente, per verificare che non si muova niente. */
async function bidRowsOf(auctionId: string) {
  const [lotRow] = await db.select().from(lots).where(eq(lots.auctionId, auctionId));
  const [roundRow] = await db
    .select()
    .from(lotRounds)
    .where(eq(lotRounds.lotId, lotRow.id));
  return db.select().from(bids).where(eq(bids.lotRoundId, roundRow.id));
}

async function post(auctionId: string, body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/auctions/[id]/action/route");
  return POST(
    new Request(`http://localhost/api/auctions/${auctionId}/action`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: auctionId }) },
  );
}

describe.runIf(dbUp)("M16 — il ritiro non esiste più, e la regola è del server", () => {
  it("un POST {type:'WITHDRAW'} torna INVALID_REQUEST e non tocca withdrawn_at", async () => {
    const now = Date.now();
    const game = await auctionWithOneBid(now);
    currentUser.mockResolvedValue({ id: game.userIds[1] });

    const before = await bidRowsOf(game.auctionId);
    // Il presupposto del test: c'è davvero una busta da ritirare, e chi la
    // ritirerebbe è autenticato e membro. Se il ritiro esistesse, passerebbe.
    expect(before).toHaveLength(2); // l'auto-bid a 1 del chiamante + i 40 del seat 1
    expect(before.every((b) => b.withdrawnAt === null)).toBe(true);

    const response = await post(game.auctionId, { type: "WITHDRAW" });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST" });

    // ⚠ Il cuore della verifica: a database **non è cambiato niente**. Non un
    // `withdrawn_at`, non un importo, non una riga in più.
    const after = await bidRowsOf(game.auctionId);
    expect(after.every((b) => b.withdrawnAt === null)).toBe(true);
    expect(after.map((b) => b.amount).sort()).toEqual(before.map((b) => b.amount).sort());
  });

  it("e l'offerta si può ancora rilanciare: è tolto il ritiro, non il resto", async () => {
    const now = Date.now();
    const game = await auctionWithOneBid(now);

    unwrap(await placeBid(game.userIds[1], game.auctionId, 55, now + 300));

    const rows = await bidRowsOf(game.auctionId);
    const mine = rows.find((b) => b.amount === 55);
    expect(mine).toBeDefined();
    // Il rilancio è un UPDATE della stessa riga: due buste, non tre.
    expect(rows).toHaveLength(2);
    expect(mine!.withdrawnAt).toBeNull();
  });
});
