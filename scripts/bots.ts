/**
 * `pnpm bots --auction=<id> --count=7 --strategy=random` — partecipanti finti
 * (F4-10, PLAN §15).
 *
 * Sono **client veri**, non scorciatoie: si autenticano col provider `dev`,
 * aprono l'SSE come un browser e agiscono via HTTP sulla route delle azioni.
 * Niente accesso al motore nel proprio processo — se scrivessero da qui, il
 * server non se ne accorgerebbe e il browser aperto accanto non vedrebbe
 * muoversi niente. Il database lo interrogano una volta sola, in avvio, per
 * sapere chi sono e qual è il listone: da lì in poi vivono di snapshot, che è
 * esattamente il vincolo che ha il portale del partecipante (I10).
 *
 * Perché servono: con i bot più un browser reale si collauda il proprio
 * portale dentro un'asta viva, e con `--strategy=tie` si riproduce a comando
 * lo spareggio, che a mano è quasi impossibile innescare.
 *
 * Richiede l'app accesa (`pnpm dev`): è quel processo ad avere lo scheduler,
 * ed è lui a chiudere i round.
 */
import { asc, eq } from "drizzle-orm";

import { db, pool } from "../lib/db";
import { auctions, members, players, users } from "../lib/db/schema";
import type { Snapshot } from "../lib/realtime/types";

type Strategy = "random" | "aggressive" | "passive" | "tie";

const STRATEGIES: Strategy[] = ["random", "aggressive", "passive", "tie"];

/** L'importo su cui convergono i bot `tie`: uguale per tutti, quindi pareggio. */
const TIE_AMOUNT = 10;

type Options = {
  auctionId: string;
  count: number | null;
  strategy: Strategy;
  baseUrl: string;
  start: boolean;
  verbose: boolean;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    auctionId: "",
    count: null,
    strategy: "random",
    baseUrl: process.env.BOTS_URL ?? "http://localhost:3000",
    start: false,
    verbose: false,
  };
  for (const arg of argv) {
    if (arg === "--") continue;
    if (arg === "--start") {
      options.start = true;
      continue;
    }
    if (arg === "--verbose") {
      options.verbose = true;
      continue;
    }
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!match) throw new Error(`Argomento non riconosciuto: ${arg}`);
    const [, key, value] = match;
    if (key === "auction") options.auctionId = value;
    else if (key === "count") options.count = Number(value);
    else if (key === "url") options.baseUrl = value.replace(/\/$/, "");
    else if (key === "strategy") {
      if (!STRATEGIES.includes(value as Strategy)) {
        throw new Error(`Strategia sconosciuta: ${value}. Usa ${STRATEGIES.join("|")}.`);
      }
      options.strategy = value as Strategy;
    } else throw new Error(`Opzione sconosciuta: --${key}`);
  }
  if (!options.auctionId) {
    throw new Error(
      "Uso: pnpm bots --auction=<id> [--count=N] [--strategy=random|aggressive|passive|tie] [--start] [--url=http://localhost:3000]",
    );
  }
  return options;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pickOne = <T,>(items: T[]): T =>
  items[Math.floor(Math.random() * items.length)];

// ─── Login col provider `dev` ────────────────────────────────────────────────

/**
 * La stessa danza che fa il browser dalla pagina di signin: token CSRF, POST
 * delle credenziali, cookie di sessione. Il provider `dev` esiste solo fuori
 * produzione (PLAN §15) — in produzione questo script non ha modo di entrare,
 * ed è giusto così.
 */
async function loginAs(baseUrl: string, userId: string): Promise<string> {
  const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
  if (!csrfResponse.ok) {
    throw new Error(
      `L'app non risponde su ${baseUrl} (${csrfResponse.status}). È accesa?`,
    );
  }
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };
  const csrfCookie = cookiesFrom(csrfResponse);

  const login = await fetch(`${baseUrl}/api/auth/callback/dev`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: csrfCookie,
    },
    body: new URLSearchParams({ csrfToken, userId, callbackUrl: baseUrl }),
    redirect: "manual",
  });
  const session = cookiesFrom(login);
  if (!/session-token=/.test(session)) {
    throw new Error(
      `Login del provider dev fallito per ${userId}: nessun cookie di sessione.`,
    );
  }
  return [csrfCookie, session].filter(Boolean).join("; ");
}

function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

// ─── Un bot ──────────────────────────────────────────────────────────────────

type Bot = {
  label: string;
  userId: string;
  memberId: string;
  seatIndex: number;
  cookie: string;
  /** L'ultima situazione su cui ha già agito: `lotId:roundNo` o `pick:seq`. */
  actedOn: string | null;
  busy: boolean;
};

type Listone = { id: string; role: string }[];

let completed = false;
let verbose = false;
let actions = 0;
let refused = 0;
/** I rifiuti per codice: a fine corsa dicono *perché* un bot è rimasto fuori. */
const refusals = new Map<string, number>();

async function act(
  options: Options,
  bot: Bot,
  body: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(
    `${options.baseUrl}/api/auctions/${options.auctionId}/action`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: bot.cookie },
      body: JSON.stringify(body),
    },
  );
  if (response.ok) {
    actions += 1;
    if (verbose) console.log(`  ${bot.label}: ${JSON.stringify(body)}`);
    return;
  }
  // I rifiuti tipizzati sono parte del gioco: il round si è chiuso mentre si
  // stava per offrire, il turno è passato. Il server è l'unica verità.
  refused += 1;
  const error = (await response.json().catch(() => ({}))) as { code?: string };
  const code = error.code ?? String(response.status);
  refusals.set(code, (refusals.get(code) ?? 0) + 1);
  if (verbose) console.log(`  ${bot.label}: ${JSON.stringify(body)} → ${code}`);
}

async function heartbeat(options: Options, bot: Bot): Promise<void> {
  await fetch(`${options.baseUrl}/api/auctions/${options.auctionId}/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: bot.cookie },
    body: JSON.stringify({ visible: true }),
  }).catch(() => {});
}

/** Quanto offre questo bot in questo round, o `null` per stare fermo. */
function amountFor(
  strategy: Strategy,
  minAmount: number,
  cap: number,
): number | null {
  if (cap < minAmount) return null;
  switch (strategy) {
    case "passive":
      return minAmount;
    case "aggressive":
      return cap;
    case "tie":
      return Math.min(cap, Math.max(minAmount, TIE_AMOUNT));
    case "random": {
      const spread = Math.min(cap - minAmount, 20);
      return minAmount + Math.floor(Math.random() * Math.random() * (spread + 1));
    }
  }
}

async function onSnapshot(
  options: Options,
  bot: Bot,
  listone: Listone,
  snapshot: Snapshot,
): Promise<void> {
  if (snapshot.auction.status === "COMPLETED") {
    completed = true;
    return;
  }
  if (snapshot.auction.status !== "LIVE" || bot.busy) return;

  const me = snapshot.members.find((m) => m.id === bot.memberId);
  if (!me) return;

  // Il turno di chiamata: un giocatore a caso fra quelli ancora liberi del
  // ruolo corrente. I presi si ricavano dalle rose, che lo snapshot contiene.
  if (
    snapshot.auction.phase === "WAITING_PICK" &&
    snapshot.auction.currentMemberId === bot.memberId
  ) {
    const key = `pick:${snapshot.auction.phaseDeadline}`;
    if (bot.actedOn === key) return;
    bot.actedOn = key;
    const taken = new Set(
      snapshot.members.flatMap((m) => m.roster.map((r) => r.playerId)),
    );
    const free = listone.filter(
      (p) => p.role === snapshot.auction.currentRole && !taken.has(p.id),
    );
    if (free.length === 0) return;
    bot.busy = true;
    await sleep(200 + Math.random() * 400);
    await act(options, bot, { type: "PICK", playerId: pickOne(free).id });
    bot.busy = false;
    return;
  }

  if (snapshot.auction.phase !== "LOT_OPEN" || !snapshot.currentLot) return;
  const lot = snapshot.currentLot;
  if (!lot.eligibleMemberIds.includes(bot.memberId)) return;
  // Un round, un'offerta: i bot non fanno guerre di rilanci contro sé stessi.
  const key = `${lot.id}:${lot.roundNo}`;
  if (bot.actedOn === key) return;
  bot.actedOn = key;

  const amount = amountFor(options.strategy, lot.minAmount, me.maxBid);
  if (amount === null) return;
  if (snapshot.myBid && snapshot.myBid.amount === amount) return;

  bot.busy = true;
  // Un po' di ritardo: un'asta non è una coda, e serve a lasciare spazio a chi
  // sta guardando la pagina da un browser vero.
  const jitter = snapshot.auction.timers.bidSeconds * 1000 * 0.3;
  await sleep(100 + Math.random() * jitter);
  await act(options, bot, { type: "BID", amount });
  bot.busy = false;
}

/**
 * Lo stream SSE letto a mano su `fetch`: serve il cookie di sessione fra gli
 * header, e `EventSource` in Node non lo permette.
 */
async function follow(
  options: Options,
  bot: Bot,
  listone: Listone,
): Promise<void> {
  while (!completed) {
    try {
      const response = await fetch(
        `${options.baseUrl}/api/auctions/${options.auctionId}/stream`,
        { headers: { Cookie: bot.cookie, Accept: "text/event-stream" } },
      );
      if (!response.ok || !response.body) {
        throw new Error(`stream rifiutato (${response.status})`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastVersion = -1;

      while (!completed) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut = buffer.indexOf("\n\n");
        while (cut !== -1) {
          const message = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          cut = buffer.indexOf("\n\n");
          const data = message
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (!data) continue; // un `: ping`
          const snapshot = JSON.parse(data.slice(6)) as Snapshot;
          if (snapshot.stateVersion < lastVersion) continue;
          lastVersion = snapshot.stateVersion;
          void onSnapshot(options, bot, listone, snapshot);
        }
      }
      await reader.cancel().catch(() => {});
    } catch (error: unknown) {
      if (completed) return;
      console.error(`${bot.label}: stream caduto, riprovo`, error);
      await sleep(1_000);
    }
  }
}

// ─── Avvio ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  verbose = options.verbose;

  const auction = await db.query.auctions.findFirst({
    where: eq(auctions.id, options.auctionId),
  });
  if (!auction) throw new Error(`Asta ${options.auctionId} non trovata.`);
  if (!["READY", "LIVE", "PAUSED"].includes(auction.status)) {
    throw new Error(`L'asta è in stato ${auction.status}: serve READY o LIVE.`);
  }

  const memberRows = await db
    .select({
      id: members.id,
      userId: members.userId,
      seatIndex: members.seatIndex,
      teamName: members.teamName,
    })
    .from(members)
    .where(eq(members.auctionId, options.auctionId))
    .orderBy(asc(members.seatIndex));

  const listone: Listone = (
    await db
      .select({ id: players.id, role: players.role, outOfList: players.outOfList })
      .from(players)
      .where(eq(players.auctionId, options.auctionId))
  ).filter((p) => auction.includeOutOfList || !p.outOfList);

  const chosen = memberRows.slice(0, options.count ?? memberRows.length);
  console.log(
    `${chosen.length} bot (${options.strategy}) su ${options.baseUrl} — asta "${auction.name}"`,
  );

  const bots: Bot[] = [];
  for (const row of chosen) {
    const cookie = await loginAs(options.baseUrl, row.userId);
    bots.push({
      label: row.teamName,
      userId: row.userId,
      memberId: row.id,
      seatIndex: row.seatIndex,
      cookie,
      actedOn: null,
      busy: false,
    });
  }

  // L'heartbeat è indipendente dallo stream, come nel browser (§8bis).
  for (const bot of bots) await heartbeat(options, bot);
  const beats = setInterval(() => {
    for (const bot of bots) void heartbeat(options, bot);
  }, 10_000);

  const streams = bots.map((bot) => follow(options, bot, listone));

  if (options.start && auction.status === "READY") {
    const owner = await db.query.users.findFirst({
      where: eq(users.id, auction.ownerUserId),
    });
    if (!owner) throw new Error("owner dell'asta sparito");
    const ownerCookie = await loginAs(options.baseUrl, owner.id);
    // Il gate presence vuole tutti i membri LIVE: gli heartbeat sono partiti.
    const response = await fetch(
      `${options.baseUrl}/api/auctions/${options.auctionId}/action`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: ownerCookie },
        body: JSON.stringify({ type: "START", startSeatIndex: 0 }),
      },
    );
    if (!response.ok) {
      const error = (await response.json()) as { message?: string };
      throw new Error(`Avvio rifiutato: ${error.message ?? response.status}`);
    }
    console.log("Asta avviata dal seat 0.");
  }

  const startedAt = Date.now();
  while (!completed) await sleep(500);
  clearInterval(beats);
  await Promise.allSettled(streams);

  const minutes = ((Date.now() - startedAt) / 60_000).toFixed(1);
  const perCode = [...refusals]
    .map(([code, n]) => `${code}×${n}`)
    .join(", ");
  console.log(
    `\n✓ Asta COMPLETED in ${minutes} minuti: ${actions} azioni riuscite, ` +
      `${refused} rifiutate dal server${perCode ? ` (${perCode})` : ""}.`,
  );
}

process.on("SIGINT", () => {
  completed = true;
});

main()
  .catch((error: unknown) => {
    console.error(`\n✗ ${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    completed = true;
    void pool.end();
  });
