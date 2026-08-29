import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import {
  advancePhase,
  pauseAuction,
  resumeAuction,
  startAuction,
} from "@/lib/engine/actions";
import { setBroadcastHook } from "@/lib/engine/mutate";
import {
  createScheduler,
  startScheduler,
  stopScheduler,
} from "@/lib/engine/scheduler";

import {
  type GameAuction,
  makeGameAuction,
  markAllPresent,
} from "./game-helpers";
import {
  closeDatabase,
  databaseAvailable,
  dropAuctions,
  dropUsers,
  sweeperFor,
} from "./helpers";

/**
 * F3-08 — lo scheduler: `arm`/`cancel` (la via veloce), `sweep` (la rete di
 * sicurezza) e `bootRecovery` (il riavvio).
 *
 * `arm` e `cancel` si provano con i fake timers e un `advance` finto: sono
 * puro tempo, il database non c'entra. `sweep` e `bootRecovery` invece si
 * provano contro Postgres vero, perché il loro contratto È la query
 * (`status='LIVE' AND phase_deadline <= now()`).
 */

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn(
    "\n⚠ Postgres non raggiungibile: i test dello scheduler sono saltati.\n",
  );
}

const createdAuctions: string[] = [];
const createdUsers: string[] = [];

afterAll(async () => {
  if (!dbUp) return;
  await dropAuctions(createdAuctions);
  await dropUsers(createdUsers);
  await closeDatabase();
});

afterEach(() => {
  stopScheduler();
  setBroadcastHook(() => {});
});

async function gameAuction(): Promise<GameAuction> {
  const game = await makeGameAuction();
  createdAuctions.push(game.auctionId);
  createdUsers.push(...game.userIds);
  return game;
}

function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe.runIf(dbUp)("F3-08 — arm e cancel (fake timers)", () => {
  it("arm fa scattare advance alla deadline, una volta sola", async () => {
    vi.useFakeTimers();
    const advance = vi.fn<(auctionId: string) => Promise<void>>(async () => {});
    const s = createScheduler(advance);

    s.arm("asta-1", Date.now() + 5000);
    await vi.advanceTimersByTimeAsync(4999);
    expect(advance).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(advance).toHaveBeenCalledTimes(1);
    expect(advance).toHaveBeenCalledWith("asta-1");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(advance).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it("ri-armare sostituisce il timer precedente", async () => {
    vi.useFakeTimers();
    const advance = vi.fn<(auctionId: string) => Promise<void>>(async () => {});
    const s = createScheduler(advance);

    s.arm("asta-1", Date.now() + 3000);
    s.arm("asta-1", Date.now() + 8000);

    await vi.advanceTimersByTimeAsync(3000);
    expect(advance).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(advance).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it("cancel spegne il timer", async () => {
    vi.useFakeTimers();
    const advance = vi.fn<(auctionId: string) => Promise<void>>(async () => {});
    const s = createScheduler(advance);

    s.arm("asta-1", Date.now() + 3000);
    s.cancel("asta-1");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(advance).not.toHaveBeenCalled();
    s.stop();
  });

  it("una deadline già passata scatta subito", async () => {
    vi.useFakeTimers();
    const advance = vi.fn<(auctionId: string) => Promise<void>>(async () => {});
    const s = createScheduler(advance);

    s.arm("asta-1", Date.now() - 1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(advance).toHaveBeenCalledTimes(1);
    s.stop();
  });
});

describe.runIf(dbUp)("F3-08 — sweep e bootRecovery (Postgres vero)", () => {
  it("sweep avanza le sole aste LIVE con la deadline scaduta", async () => {
    vi.useRealTimers();
    const overdue = await gameAuction();
    const future = await gameAuction();
    const paused = await gameAuction();

    // Scaduta: avviata nel passato, mai avanzata.
    unwrap(
      await startAuction(overdue.ownerId, overdue.auctionId, 0, Date.now() - 60_000),
    );
    // Futura: appena avviata, deadline fra 3 secondi.
    unwrap(await startAuction(future.ownerId, future.auctionId, 0, Date.now()));
    // In pausa con la deadline scaduta: lo sweep non la tocca.
    unwrap(
      await startAuction(paused.ownerId, paused.auctionId, 0, Date.now() - 60_000),
    );
    unwrap(
      await pauseAuction(paused.ownerId, paused.auctionId, Date.now() - 30_000),
    );

    const advance = vi.fn<(auctionId: string) => Promise<void>>(async () => {});
    const s = createScheduler(advance);
    const due = await s.sweep();

    expect(due).toContain(overdue.auctionId);
    expect(due).not.toContain(future.auctionId);
    expect(due).not.toContain(paused.auctionId);
    const advancedIds = advance.mock.calls.map((c) => c[0]);
    expect(advancedIds).toContain(overdue.auctionId);
    expect(advancedIds).not.toContain(future.auctionId);
    expect(advancedIds).not.toContain(paused.auctionId);
    s.stop();
  });

  it("lo sweep vero fa avanzare davvero: il pick scaduto diventa auto-pick", async () => {
    vi.useRealTimers();
    const game = await gameAuction();
    unwrap(
      await startAuction(game.ownerId, game.auctionId, 0, Date.now() - 60_000),
    );

    // ⚠ **Filtrato, e questo test è il motivo per cui l'helper esiste in tre
    // file invece che in uno.** Con `advancePhase` nudo lo sweep faceva
    // avanzare ogni asta `LIVE` scaduta del database — comprese quelle di
    // sviluppo, che coi test non c'entrano niente. Lo sweep resta vero: è la
    // stessa query, e l'asta di questo test avanza davvero.
    const s = sweeperFor(game.auctionId);
    await s.sweep();
    s.stop();

    // WAITING_PICK era scaduto: l'auto-pick ha aperto un lotto.
    const after = unwrap(await advancePhase(game.auctionId, Date.now()));
    expect(after.state.phase).toBe("LOT_OPEN");
    expect(after.state.lots[0].autoCalled).toBe(true);
  });

  it("bootRecovery arma le aste LIVE non scadute", async () => {
    vi.useRealTimers();
    const game = await gameAuction();
    const now = Date.now();
    unwrap(await startAuction(game.ownerId, game.auctionId, 0, now));

    vi.useFakeTimers({ now });
    const advance = vi.fn<(auctionId: string) => Promise<void>>(async () => {});
    const s = createScheduler(advance);
    await s.bootRecovery();

    // La deadline del pick è now+3000: prima non scatta, dopo sì.
    await vi.advanceTimersByTimeAsync(2999);
    const before = advance.mock.calls.filter((c) => c[0] === game.auctionId);
    expect(before).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    const after = advance.mock.calls.filter((c) => c[0] === game.auctionId);
    expect(after).toHaveLength(1);
    s.stop();
  });

  it("il timer si riarma a ogni mutazione: pausa cancella, resume riarma (F3-07)", async () => {
    vi.useRealTimers();
    const game = await gameAuction();

    // ⚠ **Un'ora nel futuro, e non `Date.now()`.** Questo test vive su un orologio
    // finto che avanza di dodici secondi (pausa di 10s, più i 2s di residuo), mentre
    // `startScheduler` accende **anche** lo sweep periodico — che interroga il
    // database con l'orologio **vero**. Con la linea temporale ancorata all'adesso
    // reale, basta che l'esecuzione della suite duri più di quei dodici secondi
    // perché lo sweep trovi la `phase_deadline` scaduta e faccia avanzare l'asta da
    // sé: il timer armato non ha fatto niente di sbagliato, ma la spia registra una
    // chiamata e il test diventa rosso. Succedeva circa una volta su otto lanciando
    // la suite di fila (2026-08-18, lavorando a M14, che non tocca lo scheduler).
    //
    // Spostando tutto un'ora avanti nessuna scadenza è mai scaduta per il database,
    // quindi l'unica cosa che può far scattare la spia è il timer — che è
    // precisamente ciò che questo test verifica. La presence va riscritta a quel
    // momento, o il cancello d'avvio (F4-06) rifiuterebbe: `last_seen_at` di adesso,
    // guardato da un'ora dopo, è OFFLINE.
    const now = Date.now() + 3_600_000;
    await markAllPresent(game.auctionId, game.memberIds, now);

    vi.useFakeTimers({ now });
    const advance = vi.fn<(auctionId: string) => Promise<void>>(async () => {});
    startScheduler(advance); // il syncTimer delle azioni parla con questo

    unwrap(await startAuction(game.ownerId, game.auctionId, 0, now));
    unwrap(await pauseAuction(game.ownerId, game.auctionId, now + 1000));

    // In pausa: nessun timer deve scattare.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(
      advance.mock.calls.filter((c) => c[0] === game.auctionId),
    ).toHaveLength(0);

    // Resume: il residuo era 2s (pausa a +1000 su deadline +3000) e il timer
    // torna armato sul nuovo `phase_deadline`.
    const resumeAt = Date.now(); // il clock finto, avanzato di 10s
    unwrap(await resumeAuction(game.ownerId, game.auctionId, resumeAt));
    await vi.advanceTimersByTimeAsync(1999);
    expect(
      advance.mock.calls.filter((c) => c[0] === game.auctionId),
    ).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(
      advance.mock.calls.filter((c) => c[0] === game.auctionId),
    ).toHaveLength(1);
    stopScheduler();
  });
});
