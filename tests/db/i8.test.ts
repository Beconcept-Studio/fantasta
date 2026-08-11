import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pickPlayer, placeBid, startAuction } from "@/lib/engine/actions";
import { setBroadcastHook } from "@/lib/engine/mutate";
import { loadForSnapshot } from "@/lib/engine/snapshot";
import { connectionCount, resetBroadcast } from "@/lib/realtime/broadcast";
import type { Snapshot } from "@/lib/realtime/types";

import { type GameAuction, makeGameAuction } from "./game-helpers";
import {
  closeDatabase,
  databaseAvailable,
  dropAuctions,
  dropUsers,
  makeUser,
} from "./helpers";

/**
 * F4-08 — **il criterio ✅ della Fase 4**, e l'unica cosa di questa fase che
 * la sera dell'asta si vede o non si vede: durante `LOT_OPEN` nessun client
 * riceve l'importo dell'offerta di qualcun altro (I8)… e da M1 nemmeno il fatto
 * che quell'offerta esista.
 *
 * Il test non chiama `serializeSnapshot`: apre davvero la route SSE e legge il
 * primo messaggio, per i **tre** spettatori possibili — un partecipante,
 * l'owner che organizza senza giocare, la vista TV. Sono le tre uscite del
 * sistema; se una perdesse una cifra, l'asta a busta chiusa non sarebbe più
 * chiusa, e non è il tipo di bug che si scopre in diretta.
 *
 * Due strumenti, e la scelta è deliberata:
 *
 * - **l'insieme esatto delle chiavi** di `currentLot`, invece di un
 *   `bidStatus === undefined`. Un giorno l'informazione potrebbe rientrare con
 *   un altro nome — `envelopes`, `delivered`, `bidCount` — e un test che nomina
 *   il campo morto non se ne accorgerebbe;
 * - **il confronto fra due partecipanti**, uno che ha consegnato la busta e uno
 *   che non l'ha fatto. Se i loro `currentLot` sono identici byte per byte,
 *   allora dal lotto non si deduce chi si è mosso: non c'è niente da confrontare
 *   perché non c'è niente di diverso.
 *
 * `@/lib/auth` è finto perché fuori da una richiesta vera non c'è una
 * sessione: quello che si sta collaudando è la sanificazione, non Auth.js.
 */

const currentUser = vi.fn<() => Promise<{ id: string } | null>>();
vi.mock("@/lib/auth", () => ({ currentUser: () => currentUser() }));

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn("\n⚠ Postgres non raggiungibile: il test I8 è saltato.\n");
}

const createdAuctions: string[] = [];
const createdUsers: string[] = [];

beforeEach(() => {
  vi.useRealTimers();
  currentUser.mockResolvedValue(null);
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

/** L'asta del test: owner che non gioca (⚠ P11) e tre buste diverse aperte. */
async function auctionInLotOpen(): Promise<
  GameAuction & { publicToken: string }
> {
  const game = await makeGameAuction({ ownerPlays: false });
  createdAuctions.push(game.auctionId);
  createdUsers.push(...game.userIds, game.ownerId);

  const t0 = Date.now();
  unwrap(await startAuction(game.ownerId, game.auctionId, 0, t0));
  const loaded = await loadForSnapshot(game.auctionId);
  const gk = loaded!.state.players.find((p) => p.role === "P")!;
  unwrap(await pickPlayer(game.userIds[0], game.auctionId, gk.id, t0 + 100));
  unwrap(await placeBid(game.userIds[1], game.auctionId, 31, t0 + 200));
  unwrap(await placeBid(game.userIds[2], game.auctionId, 57, t0 + 300));

  return { ...game, publicToken: loaded!.auction.publicToken };
}

async function openStream(auctionId: string, token?: string): Promise<Response> {
  const { GET } = await import("@/app/api/auctions/[id]/stream/route");
  const url = token
    ? `http://localhost/api/auctions/${auctionId}/stream?token=${token}`
    : `http://localhost/api/auctions/${auctionId}/stream`;
  return GET(new Request(url), { params: Promise.resolve({ id: auctionId }) });
}

/** Legge il primo evento dello stream e chiude la connessione. */
async function firstSnapshot(response: Response): Promise<Snapshot> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!buffer.includes("\n\n")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream chiuso senza snapshot");
      buffer += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
  expect(buffer.startsWith("event: snapshot\n")).toBe(true);
  const data = buffer.split("\n").find((l) => l.startsWith("data: "));
  if (!data) throw new Error(`nessun payload nel messaggio: ${buffer}`);
  return JSON.parse(data.slice("data: ".length)) as Snapshot;
}

/**
 * Le uniche chiavi che `currentLot` può avere durante `LOT_OPEN`. Se questo
 * elenco cresce, la modifica va guardata in faccia: ogni campo nuovo del lotto
 * è un candidato a raccontare qualcosa delle buste.
 */
const LOT_KEYS = [
  "autoCalled",
  "calledByMemberId",
  "closedAt",
  "eligibleMemberIds",
  "endsAt",
  "id",
  "minAmount",
  "player",
  "reveal",
  "roundNo",
  "seq",
  "tie",
];

/**
 * ⚠ **Le chiavi del giocatore, e il buco che le ha fatte aggiungere.**
 *
 * Fino a M7 questo file guardava solo l'insieme qui sopra, che è quello di
 * primo livello. `player` era già una di quelle chiavi, quindi aggiungere
 * `extId` **dentro** al giocatore ha lasciato il test verde senza che nessuno
 * dovesse guardare niente in faccia — che è precisamente ciò che il commento in
 * cima dichiara di voler evitare. Il campo di M7 era innocuo (l'id di
 * Fantacalcio.it, per la figurina: il giocatore in asta è pubblico, è la busta a
 * essere segreta), ma il prossimo potrebbe non esserlo, e la sede naturale di un
 * dato che riguarda «questo lotto» è proprio il giocatore.
 *
 * Da qui in poi anche questo insieme è esatto: un campo nuovo nel giocatore
 * rompe il test, e chi lo aggiunge deve dire perché non racconta niente delle
 * buste.
 */
const PLAYER_KEYS = ["extId", "fvm", "id", "name", "role", "team"];

describe.runIf(dbUp)("F4-08 — I8 e M1 sui tre viewer", () => {
  it("il partecipante vede la propria offerta e nessun'altra", async () => {
    const game = await auctionInLotOpen();
    currentUser.mockResolvedValue({ id: game.userIds[1] });

    const snap = await firstSnapshot(await openStream(game.auctionId));

    expect(snap.auction.phase).toBe("LOT_OPEN");
    expect(snap.viewerMemberId).toBe(game.memberIds[1]);
    expect(snap.myBid?.amount).toBe(31);
    // L'unica cifra di offerta nello snapshot è la sua: nel lotto non c'è
    // nessun campo `amount`.
    expect(JSON.stringify(snap.currentLot)).not.toContain('"amount"');
    expect(JSON.stringify(snap)).not.toContain('"amount":57');
    expect(snap.currentLot?.reveal).toBeNull();
    expect(Object.keys(snap.currentLot!).sort()).toEqual(LOT_KEYS);
    expect(Object.keys(snap.currentLot!.player).sort()).toEqual(PLAYER_KEYS);
  });

  it("chi ha consegnato e chi non l'ha fatto ricevono lo stesso lotto", async () => {
    const game = await auctionInLotOpen();

    currentUser.mockResolvedValue({ id: game.userIds[1] }); // ha offerto 31
    const offerente = await firstSnapshot(await openStream(game.auctionId));
    currentUser.mockResolvedValue({ id: game.userIds[4] }); // non ha offerto
    const silenzioso = await firstSnapshot(await openStream(game.auctionId));

    // La differenza fra i due sta tutta nella propria busta, mai nel lotto.
    expect(offerente.myBid?.amount).toBe(31);
    expect(silenzioso.myBid).toBeNull();
    expect(silenzioso.currentLot).toEqual(offerente.currentLot);
  });

  it("il manager che non gioca non vede né importi né buste", async () => {
    const game = await auctionInLotOpen();
    currentUser.mockResolvedValue({ id: game.ownerId });

    const snap = await firstSnapshot(await openStream(game.auctionId));

    expect(snap.viewerMemberId).toBeNull();
    expect(snap.myBid).toBeNull();
    expect(JSON.stringify(snap)).not.toContain('"amount"');
    // Nemmeno il conteggio: chi conduce l'asta quasi sempre gioca (M1, §5).
    expect(Object.keys(snap.currentLot!).sort()).toEqual(LOT_KEYS);
    // Vede tutto il resto: è il portale proiettato, deve poter condurre l'asta.
    expect(snap.members).toHaveLength(8);
    expect(snap.currentLot?.eligibleMemberIds).toHaveLength(8);
  });

  it("la vista TV entra col public token e non vede né importi né buste", async () => {
    const game = await auctionInLotOpen();
    // Nessuna sessione: la TV è un browser senza login.
    currentUser.mockResolvedValue(null);

    const snap = await firstSnapshot(
      await openStream(game.auctionId, game.publicToken),
    );

    expect(snap.viewerMemberId).toBeNull();
    expect(snap.myBid).toBeNull();
    expect(JSON.stringify(snap)).not.toContain('"amount"');
    expect(Object.keys(snap.currentLot!).sort()).toEqual(LOT_KEYS);
  });

  it("in LOT_REVEAL, e solo lì, gli importi diventano pubblici", async () => {
    const game = await auctionInLotOpen();
    const { advancePhase } = await import("@/lib/engine/actions");
    const loaded = await loadForSnapshot(game.auctionId);
    // Il round si chiude allo scadere: da qui in poi le buste sono aperte.
    unwrap(
      await advancePhase(
        game.auctionId,
        loaded!.auction.phaseDeadline!.getTime(),
      ),
    );
    currentUser.mockResolvedValue(null);

    const snap = await firstSnapshot(
      await openStream(game.auctionId, game.publicToken),
    );

    expect(snap.auction.phase).toBe("LOT_REVEAL");
    const reveal = snap.currentLot?.reveal;
    expect(reveal?.price).toBe(57);
    expect(reveal?.winnerMemberId).toBe(game.memberIds[2]);
    expect(reveal?.rounds[0].bids.map((b) => b.amount).sort()).toEqual([1, 31, 57]);
  });
});

describe.runIf(dbUp)("F4-04 — la route dello stream", () => {
  it("risponde con gli header dell'SSE e si iscrive al registro", async () => {
    const game = await auctionInLotOpen();
    currentUser.mockResolvedValue({ id: game.userIds[1] });

    const response = await openStream(game.auctionId);

    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(response.headers.get("Cache-Control")).toContain("no-cache");
    // Senza questo, nginx bufferizza e gli snapshot arrivano a blocchi.
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");

    await firstSnapshot(response);
    // Letto e chiuso: la disiscrizione svuota il registro (nessuna perdita).
    await vi.waitFor(() => expect(connectionCount(game.auctionId)).toBe(0));
  });

  it("un estraneo non entra, e nemmeno un token sbagliato", async () => {
    const game = await auctionInLotOpen();
    const stranger = await makeUser("intruso");
    createdUsers.push(stranger);

    currentUser.mockResolvedValue({ id: stranger });
    expect((await openStream(game.auctionId)).status).toBe(403);

    currentUser.mockResolvedValue(null);
    expect((await openStream(game.auctionId)).status).toBe(401);
    expect((await openStream(game.auctionId, "token-inventato")).status).toBe(403);

    expect(connectionCount(game.auctionId)).toBe(0);
  });
});
