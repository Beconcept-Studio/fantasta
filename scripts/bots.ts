/**
 * `pnpm bots --auction=<id> --count=7 --strategy=random` — partecipanti finti
 * (F4-10, PLAN §15).
 *
 * Sono **client veri**, non scorciatoie: portano un cookie di sessione valido,
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
 * ed è lui a chiudere i round. In produzione è lo stesso script, con
 * `--url=https://…`: è così che si gioca l'asta di prova di F8-06.
 */
import { asc, eq } from "drizzle-orm";
import { encode } from "next-auth/jwt";

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

// ─── Il cookie di sessione ───────────────────────────────────────────────────

/**
 * I bot si **firmano da sé** il cookie di sessione, invece di passare dalla
 * pagina di login.
 *
 * Prima passavano dal provider `dev`: token CSRF, POST delle credenziali,
 * cookie dalla risposta. Ma il provider `dev` non esiste in produzione (PLAN
 * §15, e un test lo garantisce), e il criterio ✅ della Fase 8 è un'asta a 8 bot
 * **in produzione** — quella strada era senza uscita. Nemmeno un'env var
 * l'avrebbe riaperta: il server standalone di Next forza `NODE_ENV=production`
 * da sé, prima che il nostro codice possa dire la sua.
 *
 * La sessione di questa applicazione è un JWT cifrato (DECISIONS P17, nessuna
 * tabella adapter) e la chiave di cifratura è `AUTH_SECRET`. Chi ha quel
 * segreto — il server, e questo script che legge lo stesso `.env` — può
 * emetterne uno valido. Non è una scorciatoia nell'autenticazione
 * dell'applicazione: **non aggiunge nessun modo di entrare dal browser**, e chi
 * possiede `AUTH_SECRET` possiede già tutto. In compenso il cammino di codice è
 * uno solo, identico in locale e in produzione: ciò che funziona in prova
 * funziona la sera dell'asta.
 *
 * Il contenuto del token è quello che si aspetta il callback `session` di
 * `lib/auth.ts`: `uid` con l'id interno dell'utente. `sub` c'è per convenzione.
 */
async function sessionCookie(baseUrl: string, userId: string): Promise<string> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET assente: senza il segreto del server i bot non possono firmarsi una sessione.",
    );
  }

  // Auth.js prefissa il cookie con `__Secure-` quando l'app gira in https, e
  // usa **il nome del cookie come salt** della derivazione della chiave: con il
  // nome sbagliato il token si cifra con una chiave diversa e il server lo
  // scarta senza dire niente.
  const name = baseUrl.startsWith("https://")
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";

  const token = await encode({
    token: { sub: userId, uid: userId },
    secret,
    salt: name,
    // Sei ore: più di qualunque asta, meno di una sessione dimenticata in giro.
    maxAge: 6 * 60 * 60,
  });
  const cookie = `${name}=${token}`;

  // Il cookie va provato subito, non al primo `pick`: se `AUTH_SECRET` non è
  // quello del server, l'unico sintomo sarebbe una sfilza di 401 a metà asta.
  const check = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { Cookie: cookie },
  });
  if (!check.ok) {
    throw new Error(
      `L'app non risponde su ${baseUrl} (${check.status}). È accesa?`,
    );
  }
  const session = (await check.json()) as { user?: { id?: string } };
  if (session.user?.id !== userId) {
    throw new Error(
      `Il server ha rifiutato la sessione di ${userId}: AUTH_SECRET non combacia con quello dell'app su ${baseUrl}.`,
    );
  }

  return cookie;
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
    const cookie = await sessionCookie(options.baseUrl, row.userId);
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
    const ownerCookie = await sessionCookie(options.baseUrl, owner.id);
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
