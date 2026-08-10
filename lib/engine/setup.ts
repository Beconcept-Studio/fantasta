import { randomBytes } from "node:crypto";

import { and, asc, count, eq, inArray, or, sql } from "drizzle-orm";
import { cache } from "react";

import { db } from "@/lib/db";
import {
  type Auction,
  type Member,
  auctions,
  invites,
  members,
  players,
  users,
} from "@/lib/db/schema";
import {
  ROLES,
  type AuctionStatus,
  type BotFill,
  type BotStrategy,
  type Role,
  isAppAdmin,
  strategyFor,
} from "@/lib/domain";
import { countPool, parseListone } from "@/lib/import/parseListone";
import type { PoolPlayer } from "@/lib/realtime/types";

import { ensureBotUsers } from "./bots";
import { type Result, fail, ok } from "./errors";
import { isUuid } from "./ids";
import {
  type AuctionConfig,
  type AuctionConfigInput,
  DEFAULT_CONFIG,
  type PoolCounts,
  type SlotsByRole,
  totalSlots,
  validateAuctionConfig,
  validateRolePool,
  validateTeamName,
} from "./setup-rules";

/**
 * Il setup di un'asta: creazione, configurazione, import del listone, inviti,
 * join e uscita dei membri.
 *
 * ## Perché tutto passa da qui
 *
 * Questo è uno dei pochi file autorizzati a importare `lib/db` (regola ESLint in
 * `eslint.config.mjs`). Le pagine e i componenti non vedono mai il database:
 * chiamano queste funzioni, oppure le Server Action in `app/auctions/actions.ts`
 * che si limitano a incartarle.
 *
 * ## Il lock
 *
 * Ogni mutazione apre una transazione e prende un `SELECT ... FOR UPDATE` sulla
 * riga dell'asta (`withSetupLock`). Serve davvero: due persone che aprono lo
 * stesso link d'invito nello stesso istante, senza serializzazione, si
 * assegnerebbero lo stesso `seat_index` o supererebbero il numero di posti.
 *
 * È il **cugino del `withAuctionLock` di PLAN §6**, che arriverà in Fase 3 per
 * le mutazioni di gioco. Sono due funzioni distinte di proposito: quella di
 * gioco incrementa `state_version` e fa il broadcast dello snapshot, cose che in
 * DRAFT/READY non esistono ancora — non c'è nessuno stream aperto e nessuna
 * macchina a stati da far avanzare.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function withSetupLock<T>(
  auctionId: string,
  fn: (tx: Tx, auction: Auction) => Promise<Result<T>>,
): Promise<Result<T>> {
  // F7-07bis: come in `withAuctionLock`, un id non-uuid è un'asta che non
  // esiste, non un'eccezione di Postgres da mostrare come 500.
  if (!isUuid(auctionId)) return fail<T>("NOT_FOUND", "Questa asta non esiste.");

  return db.transaction(async (tx) => {
    const [auction] = await tx
      .select()
      .from(auctions)
      .where(eq(auctions.id, auctionId))
      .for("update");

    if (!auction) return fail<T>("NOT_FOUND", "Questa asta non esiste.");
    return fn(tx, auction);
  });
}

/** Solo l'owner configura l'asta (PLAN §2). */
function requireOwner<T>(auction: Auction, userId: string): Result<T> | null {
  if (auction.ownerUserId !== userId) {
    return fail<T>(
      "FORBIDDEN",
      "Solo chi ha creato l'asta può modificarla.",
    );
  }
  return null;
}

/** Il setup si tocca solo prima dell'avvio. */
function requireSetupPhase<T>(auction: Auction): Result<T> | null {
  if (auction.status !== "DRAFT" && auction.status !== "READY") {
    return fail<T>(
      "WRONG_STATUS",
      "L'asta è già iniziata: la configurazione non si cambia più.",
    );
  }
  return null;
}

// ─── Lettura dello stato di setup ────────────────────────────────────────────

function slotsOf(auction: Auction): SlotsByRole {
  return {
    P: auction.slotsP,
    D: auction.slotsD,
    C: auction.slotsC,
    A: auction.slotsA,
  };
}

/**
 * Il pool acquistabile, per ruolo. Il toggle `include_out_of_list` (P7) è
 * l'unica cosa che lo cambia in fase di setup: ad asta iniziata andrebbero
 * sottratti anche i giocatori già assegnati, ma in DRAFT/READY non ce ne sono.
 */
async function poolCounts(
  tx: Tx | typeof db,
  auction: Auction,
): Promise<PoolCounts> {
  const rows = await tx
    .select({ role: players.role, n: count() })
    .from(players)
    .where(
      auction.includeOutOfList
        ? eq(players.auctionId, auction.id)
        : and(eq(players.auctionId, auction.id), eq(players.outOfList, false)),
    )
    .groupBy(players.role);

  const counts = { P: 0, D: 0, C: 0, A: 0 } satisfies PoolCounts;
  for (const row of rows) counts[row.role] = row.n;
  return counts;
}

/**
 * **DRAFT ↔ READY è derivato, non impostato** (P12).
 *
 * Si ricalcola dopo ogni mutazione di setup ed è reversibile: togliere un membro
 * da un'asta READY la riporta in DRAFT. Nessuno "conferma" mai la readiness a
 * mano — sarebbe uno stato in più da tenere sincronizzato con la realtà.
 */
async function recomputeStatus(tx: Tx, auction: Auction): Promise<void> {
  if (auction.status !== "DRAFT" && auction.status !== "READY") return;

  const [{ n: memberCount }] = await tx
    .select({ n: count() })
    .from(members)
    .where(eq(members.auctionId, auction.id));

  const counts = await poolCounts(tx, auction);
  const hasListone = ROLES.some((role) => counts[role] > 0);
  const poolOk = validateRolePool({
    counts,
    slots: slotsOf(auction),
    seats: auction.seats,
  }).ok;

  const next: AuctionStatus =
    memberCount === auction.seats && hasListone && poolOk ? "READY" : "DRAFT";

  if (next !== auction.status) {
    await tx
      .update(auctions)
      .set({ status: next })
      .where(eq(auctions.id, auction.id));
  }
}

// ─── Creazione ───────────────────────────────────────────────────────────────

function token(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * ⚠ `isSimulated` è un **terzo parametro** e non un campo di
 * `AuctionConfigInput` di proposito: quel tipo è anche `SettingsPatch`, cioè
 * ciò che `updateAuctionSettings` sa applicare a un'asta esistente. Se il flag
 * vivesse lì dentro esisterebbe una strada per accenderlo dopo la creazione, e
 * l'unica difesa sarebbe ricordarsi di escluderlo. Così la strada non c'è.
 *
 * Il permesso si rilegge **dal database** invece di fidarsi di chi chiama:
 * costa una query e rende la regola vera qualunque sia il chiamante — la
 * Server Action di oggi, il seed, o qualcosa che scriveremo fra un anno
 * (regola 6).
 */
export async function createAuction(
  ownerUserId: string,
  input: AuctionConfigInput,
  isSimulated = false,
): Promise<Result<{ auctionId: string }>> {
  if (isSimulated) {
    const owner = await db.query.users.findFirst({
      where: eq(users.id, ownerUserId),
    });
    if (!isAppAdmin(owner)) {
      return fail(
        "NOT_ADMIN",
        "Solo un amministratore dell'applicazione può creare un'asta simulata.",
      );
    }
  }

  const validated = validateAuctionConfig(input);
  if (!validated.ok) return validated;
  const config = validated.value;

  const [row] = await db
    .insert(auctions)
    .values({
      name: config.name,
      ownerUserId,
      publicToken: token(16),
      status: "DRAFT",
      seats: config.seats,
      budgetDefault: config.budgetDefault,
      bidSeconds: config.bidSeconds,
      pickSeconds: config.pickSeconds,
      tiePrepSeconds: config.tiePrepSeconds,
      revealSeconds: config.revealSeconds,
      slotsP: config.slots.P,
      slotsD: config.slots.D,
      slotsC: config.slots.C,
      slotsA: config.slots.A,
      roleOrder: config.roleOrder,
      isSimulated,
    })
    .returning({ id: auctions.id });

  return ok({ auctionId: row.id });
}

// ─── Configurazione ──────────────────────────────────────────────────────────

/**
 * I campi che si possono ancora toccare a seconda dello stato (PLAN §9).
 *
 * La linea di taglio è netta: **i timer si cambiano sempre** (si applicano dal
 * lotto successivo, non accorciano un countdown in corso), tutto il resto è
 * strutturale e si congela quando l'asta parte — cambiare gli slot o l'ordine
 * dei ruoli a metà asta significherebbe invalidare rose già comprate.
 */
const TIMER_PATCH_FIELDS = [
  "bidSeconds",
  "pickSeconds",
  "tiePrepSeconds",
  "revealSeconds",
] as const;

const STRUCTURAL_PATCH_FIELDS = [
  "seats",
  "budgetDefault",
  "slots",
  "roleOrder",
] as const;

export type SettingsPatch = AuctionConfigInput;

export async function updateAuctionSettings(
  actorUserId: string,
  auctionId: string,
  patch: SettingsPatch,
): Promise<Result<null>> {
  return withSetupLock(auctionId, async (tx, auction) => {
    const forbidden = requireOwner<null>(auction, actorUserId);
    if (forbidden) return forbidden;

    const touchesStructure = STRUCTURAL_PATCH_FIELDS.some(
      (field) => patch[field] !== undefined,
    );
    // ⚠ **Cambiato**, non **inviato**. La configurazione è un `<form>`: a ogni
    // salvataggio rimanda tutti i campi che non sono dentro un fieldset
    // disabilitato, nome compreso. Guardare la sola presenza faceva rifiutare
    // in blocco ogni salvataggio ad asta iniziata — anche quello che toccava
    // solo un timer — e rendeva impossibile ciò che questa stessa funzione
    // dichiara di permettere. Un nome identico a quello a database non è una
    // modifica.
    const touchesName =
      patch.name !== undefined &&
      (typeof patch.name !== "string" || patch.name.trim() !== auction.name);
    const isSetupPhase = auction.status === "DRAFT" || auction.status === "READY";

    if ((touchesStructure || touchesName) && !isSetupPhase) {
      return fail<null>(
        "WRONG_STATUS",
        "Ad asta iniziata si possono cambiare solo i timer, che valgono dal lotto successivo.",
      );
    }

    const validated = validateAuctionConfig(patch, {
      name: auction.name,
      seats: auction.seats,
      budgetDefault: auction.budgetDefault,
      bidSeconds: auction.bidSeconds,
      pickSeconds: auction.pickSeconds,
      tiePrepSeconds: auction.tiePrepSeconds,
      revealSeconds: auction.revealSeconds,
      slots: slotsOf(auction),
      roleOrder: auction.roleOrder,
    });
    if (!validated.ok) return validated;
    const config = validated.value;

    if (patch.seats !== undefined && config.seats !== auction.seats) {
      const [{ n: memberCount }] = await tx
        .select({ n: count() })
        .from(members)
        .where(eq(members.auctionId, auction.id));
      if (memberCount > config.seats) {
        return fail<null>(
          "INVALID_SEATS",
          `Ci sono già ${memberCount} partecipanti: togline qualcuno prima di scendere a ${config.seats} posti.`,
        );
      }
    }

    // Ogni cambio strutturale può invalidare I9: seats e slot sono due dei tre
    // termini della disuguaglianza (il terzo è il pool, che cambia con l'import
    // e col toggle sui fuori lista).
    if (touchesStructure) {
      const counts = await poolCounts(tx, auction);
      const listoneImported = ROLES.some((role) => counts[role] > 0);
      if (listoneImported) {
        const poolOk = validateRolePool({
          counts,
          slots: config.slots,
          seats: config.seats,
        });
        if (!poolOk.ok) return poolOk;
      }
    }

    const updated: Partial<typeof auctions.$inferInsert> = {};
    if (touchesName) updated.name = config.name;
    for (const field of TIMER_PATCH_FIELDS) {
      if (patch[field] !== undefined) updated[field] = config[field];
    }
    if (isSetupPhase) {
      if (patch.seats !== undefined) updated.seats = config.seats;
      if (patch.budgetDefault !== undefined)
        updated.budgetDefault = config.budgetDefault;
      if (patch.roleOrder !== undefined) updated.roleOrder = config.roleOrder;
      if (patch.slots !== undefined) {
        updated.slotsP = config.slots.P;
        updated.slotsD = config.slots.D;
        updated.slotsC = config.slots.C;
        updated.slotsA = config.slots.A;
      }
      // Il budget vale per chi entra da adesso in poi *e* per chi c'è già:
      // `budget_initial` è sempre una copia di `budget_default`, mai un valore
      // per-membro (DECISIONS 2026-08-06).
      if (patch.budgetDefault !== undefined) {
        await tx
          .update(members)
          .set({ budgetInitial: config.budgetDefault })
          .where(eq(members.auctionId, auction.id));
      }
    }

    if (Object.keys(updated).length > 0) {
      await tx.update(auctions).set(updated).where(eq(auctions.id, auction.id));
    }

    await recomputeStatus(tx, { ...auction, ...updated } as Auction);
    return ok(null);
  });
}

/**
 * Il toggle sui fuori lista (P7). Ridefinisce il pool acquistabile, quindi è
 * un cambio strutturale a tutti gli effetti e rivalida I9 come tale.
 */
export async function setIncludeOutOfList(
  actorUserId: string,
  auctionId: string,
  include: boolean,
): Promise<Result<null>> {
  return withSetupLock(auctionId, async (tx, auction) => {
    const forbidden = requireOwner<null>(auction, actorUserId);
    if (forbidden) return forbidden;
    const wrongStatus = requireSetupPhase<null>(auction);
    if (wrongStatus) return wrongStatus;

    if (auction.includeOutOfList === include) return ok(null);

    const next = { ...auction, includeOutOfList: include };
    const counts = await poolCounts(tx, next);
    if (ROLES.some((role) => counts[role] > 0)) {
      const poolOk = validateRolePool({
        counts,
        slots: slotsOf(auction),
        seats: auction.seats,
      });
      if (!poolOk.ok) return poolOk;
    }

    await tx
      .update(auctions)
      .set({ includeOutOfList: include })
      .where(eq(auctions.id, auction.id));
    await recomputeStatus(tx, next);
    return ok(null);
  });
}

// ─── Import del listone ──────────────────────────────────────────────────────

export type ImportSummary = {
  imported: number;
  counts: PoolCounts;
  outOfList: number;
};

/**
 * Sostituisce lo snapshot del listone dell'asta.
 *
 * Il file non viene conservato (P6): ne estraiamo i dati e lo buttiamo.
 * L'export di Fase 7 rigenererà il layout Fantacalcio.it da questi dati.
 *
 * Un reimport **sostituisce** lo snapshot precedente invece di aggiungersi: è
 * quello che rende ripetibile la correzione di un file sbagliato senza dover
 * ricreare l'asta. In DRAFT/READY non esistono ancora assegnazioni, quindi
 * cancellare le righe vecchie non distrugge niente (regola 5).
 */
export async function importPlayers(
  actorUserId: string,
  auctionId: string,
  file: ArrayBuffer | Uint8Array,
): Promise<Result<ImportSummary>> {
  const parsed = parseListone(file);
  if (!parsed.ok) return parsed;

  return withSetupLock(auctionId, async (tx, auction) => {
    const forbidden = requireOwner<ImportSummary>(auction, actorUserId);
    if (forbidden) return forbidden;
    const wrongStatus = requireSetupPhase<ImportSummary>(auction);
    if (wrongStatus) return wrongStatus;

    const rows = parsed.value;
    const counts = countPool(rows, auction.includeOutOfList);
    const poolOk = validateRolePool({
      counts,
      slots: slotsOf(auction),
      seats: auction.seats,
    });
    if (!poolOk.ok) return poolOk;

    await tx.delete(players).where(eq(players.auctionId, auction.id));
    await tx.insert(players).values(
      rows.map((row) => ({
        auctionId: auction.id,
        extId: row.extId,
        name: row.name,
        team: row.team,
        role: row.role,
        roleMantra: row.roleMantra,
        fvm: row.fvm,
        quot: row.quot,
        outOfList: row.outOfList,
      })),
    );

    await recomputeStatus(tx, auction);
    return ok({
      imported: rows.length,
      counts,
      outOfList: rows.filter((row) => row.outOfList).length,
    });
  });
}

// ─── Inviti ──────────────────────────────────────────────────────────────────

/**
 * Un invito è un token e basta: niente email, niente destinatario.
 *
 * `expires_at` e `max_uses` esistono nello schema ma restano vuoti di default
 * (DECISIONS 2026-08-06): la protezione vera è che **gli inviti smettono di
 * funzionare quando l'asta esce da DRAFT/READY** (PLAN §17). Nessuno entra ad
 * asta iniziata, qualunque link abbia in mano.
 */
export async function createInvite(
  actorUserId: string,
  auctionId: string,
  options: { expiresAt?: Date | null; maxUses?: number | null } = {},
): Promise<Result<{ token: string }>> {
  return withSetupLock(auctionId, async (tx, auction) => {
    const forbidden = requireOwner<{ token: string }>(auction, actorUserId);
    if (forbidden) return forbidden;
    const wrongStatus = requireSetupPhase<{ token: string }>(auction);
    if (wrongStatus) return wrongStatus;

    const value = token(12);
    await tx.insert(invites).values({
      token: value,
      auctionId: auction.id,
      createdByUserId: actorUserId,
      expiresAt: options.expiresAt ?? null,
      maxUses: options.maxUses ?? null,
    });
    return ok({ token: value });
  });
}

export type InviteView = {
  token: string;
  auctionId: string;
  auctionName: string;
  seats: number;
  memberCount: number;
  budget: number;
  slots: SlotsByRole;
  roleOrder: Role[];
  alreadyMember: boolean;
};

/** Quel che la pagina di join deve mostrare prima ancora di accettare un nome. */
export async function getInviteView(
  inviteToken: string,
  userId: string,
): Promise<InviteView | null> {
  const invite = await db.query.invites.findFirst({
    where: eq(invites.token, inviteToken),
  });
  if (!invite) return null;

  const auction = await db.query.auctions.findFirst({
    where: eq(auctions.id, invite.auctionId),
  });
  if (!auction) return null;

  const rows = await db
    .select({ userId: members.userId })
    .from(members)
    .where(eq(members.auctionId, auction.id));

  return {
    token: invite.token,
    auctionId: auction.id,
    auctionName: auction.name,
    seats: auction.seats,
    memberCount: rows.length,
    budget: auction.budgetDefault,
    slots: slotsOf(auction),
    roleOrder: auction.roleOrder,
    alreadyMember: rows.some((row) => row.userId === userId),
  };
}

/**
 * Le tre ragioni per cui un invito può essere rifiutato (F1-11).
 * `now` arriva da fuori: è la stessa disciplina del motore, e rende il caso
 * "scaduto" verificabile senza aspettare davvero.
 */
function checkInviteUsable<T>(
  invite: typeof invites.$inferSelect,
  auction: Auction,
  now: Date,
): Result<T> | null {
  if (auction.status !== "DRAFT" && auction.status !== "READY") {
    return fail<T>(
      "INVITE_CLOSED",
      "L'asta è già iniziata: non si entra più.",
    );
  }
  if (invite.expiresAt !== null && invite.expiresAt.getTime() <= now.getTime()) {
    return fail<T>("INVITE_EXPIRED", "Questo invito è scaduto.");
  }
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) {
    return fail<T>(
      "INVITE_EXHAUSTED",
      "Questo invito ha esaurito gli utilizzi disponibili.",
    );
  }
  return null;
}

// ─── Membri ──────────────────────────────────────────────────────────────────

/**
 * L'inserimento vero del membro, condiviso fra il join da invito e il join
 * dell'owner sulla propria asta.
 *
 * `seat_index` è assegnato **in ordine di join** (P13): il primo che entra ha
 * il posto 0. `budget_initial` è sempre una copia di `budget_default` — non
 * esiste un budget per-membro, le variazioni individuali passano tutte dal
 * `ledger` (DECISIONS 2026-08-06).
 */
async function addMember(
  tx: Tx,
  auction: Auction,
  userId: string,
  teamNameRaw: unknown,
  /** Valorizzata solo per un bot (M4): è ciò che distingue un membro simulato. */
  botStrategy: BotStrategy | null = null,
): Promise<Result<{ auctionId: string; memberId: string }>> {
  const validName = validateTeamName(teamNameRaw);
  if (!validName.ok) return validName;

  const existing = await tx
    .select({ id: members.id, seatIndex: members.seatIndex })
    .from(members)
    .where(eq(members.auctionId, auction.id))
    .orderBy(asc(members.seatIndex));

  if (existing.length >= auction.seats) {
    return fail("AUCTION_FULL", `L'asta è al completo (${auction.seats} posti).`);
  }

  const [row] = await tx
    .insert(members)
    .values({
      auctionId: auction.id,
      userId,
      teamName: validName.value,
      seatIndex: existing.length,
      budgetInitial: auction.budgetDefault,
      botStrategy,
    })
    .onConflictDoNothing({ target: [members.auctionId, members.userId] })
    .returning({ id: members.id });

  if (!row) {
    return fail("ALREADY_MEMBER", "Sei già dentro a questa asta.");
  }

  return ok({ auctionId: auction.id, memberId: row.id });
}

export async function joinAuction(
  userId: string,
  inviteToken: string,
  teamName: unknown,
  now: Date = new Date(),
): Promise<Result<{ auctionId: string; memberId: string }>> {
  const invite = await db.query.invites.findFirst({
    where: eq(invites.token, inviteToken),
  });
  if (!invite) {
    return fail("INVITE_NOT_FOUND", "Questo link d'invito non esiste.");
  }

  return withSetupLock(invite.auctionId, async (tx, auction) => {
    // Riletto dentro il lock: fra il controllo e l'inserimento un altro join
    // concorrente potrebbe aver esaurito `max_uses`.
    const [locked] = await tx
      .select()
      .from(invites)
      .where(eq(invites.token, inviteToken));
    if (!locked) {
      return fail<{ auctionId: string; memberId: string }>(
        "INVITE_NOT_FOUND",
        "Questo link d'invito non esiste.",
      );
    }

    const unusable = checkInviteUsable<{
      auctionId: string;
      memberId: string;
    }>(locked, auction, now);
    if (unusable) return unusable;

    const added = await addMember(tx, auction, userId, teamName);
    if (!added.ok) return added;

    await tx
      .update(invites)
      .set({ uses: sql`${invites.uses} + 1` })
      .where(eq(invites.token, inviteToken));

    await recomputeStatus(tx, auction);
    return added;
  });
}

/**
 * L'owner che partecipa alla propria asta. Tipicamente lo fa (P11), ma non è
 * obbligato: il gate presence dell'avvio riguarda i soli membri.
 */
export async function joinAsOwner(
  userId: string,
  auctionId: string,
  teamName: unknown,
): Promise<Result<{ auctionId: string; memberId: string }>> {
  return withSetupLock(auctionId, async (tx, auction) => {
    const forbidden = requireOwner<{ auctionId: string; memberId: string }>(
      auction,
      userId,
    );
    if (forbidden) return forbidden;
    const wrongStatus = requireSetupPhase<{
      auctionId: string;
      memberId: string;
    }>(auction);
    if (wrongStatus) return wrongStatus;

    const added = await addMember(tx, auction, userId, teamName);
    if (!added.ok) return added;
    await recomputeStatus(tx, auction);
    return added;
  });
}

/**
 * Riempie di bot i posti liberi di un'asta simulata (M4).
 *
 * **Passa da `addMember`**, cioè dalla stessa funzione che serve `joinAuction` e
 * `joinAsOwner`: è il criterio del seed applicato qui — uno stato prodotto
 * chiamando le funzioni dell'applicazione è, per costruzione, uno stato che
 * l'applicazione sa produrre. Vengono gratis il `seat_index` in ordine di
 * ingresso, il `budget_initial` copiato da `budget_default`, la validazione del
 * nome squadra e il `recomputeStatus` che porta l'asta a `READY`.
 *
 * I quattro rifiuti sono impilati apposta: chi non possiede l'asta, chi non è
 * amministratore, un'asta **non simulata** — che è la difesa vera, quella che
 * non si può aggirare nemmeno costruendo la richiesta a mano — e un'asta già
 * iniziata.
 */
export async function fillWithBots(
  userId: string,
  auctionId: string,
  count: number,
  fill: BotFill,
): Promise<Result<{ added: number }>> {
  if (!Number.isInteger(count) || count < 1) {
    return fail("INVALID_REQUEST", "Quanti bot? Serve un numero intero.");
  }

  // Fuori dal lock dell'asta: apre una transazione sua, e non c'è ragione di
  // tenere bloccata la riga dell'asta mentre si creano delle identità.
  const bots = await ensureBotUsers();

  return withSetupLock(auctionId, async (tx, auction) => {
    const forbidden = requireOwner<{ added: number }>(auction, userId);
    if (forbidden) return forbidden;

    const owner = await tx.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!isAppAdmin(owner)) {
      return fail<{ added: number }>(
        "NOT_ADMIN",
        "Solo un amministratore dell'applicazione può usare i bot.",
      );
    }

    if (!auction.isSimulated) {
      return fail<{ added: number }>(
        "NOT_SIMULATED",
        "Questa non è un'asta simulata: i bot si aggiungono solo alle aste di prova.",
      );
    }

    const wrongStatus = requireSetupPhase<{ added: number }>(auction);
    if (wrongStatus) return wrongStatus;

    const taken = await tx
      .select({ userId: members.userId })
      .from(members)
      .where(eq(members.auctionId, auctionId));
    const takenIds = new Set(taken.map((row) => row.userId));

    const free = auction.seats - taken.length;
    if (free < count) {
      return fail<{ added: number }>(
        "AUCTION_FULL",
        free === 0
          ? `L'asta è al completo (${auction.seats} posti).`
          : `Restano ${free} posti liberi, non ${count}.`,
      );
    }

    // I bot già dentro a *questa* asta si saltano: lo stesso bot può giocarne
    // due insieme, ma non due volte la stessa.
    const available = bots.filter((bot) => !takenIds.has(bot.id));
    if (available.length < count) {
      return fail<{ added: number }>(
        "INVALID_REQUEST",
        `Ci sono solo ${available.length} bot liberi.`,
      );
    }

    for (let i = 0; i < count; i += 1) {
      const bot = available[i];
      const added = await addMember(
        tx,
        auction,
        bot.id,
        bot.displayName,
        strategyFor(fill, i),
      );
      // Il rifiuto si ricostruisce invece di girarlo con un cast: il tipo del
      // valore è diverso, e mentire al compilatore per una riga non conviene.
      if (!added.ok) {
        return fail<{ added: number }>(added.error.code, added.error.message);
      }
    }

    await recomputeStatus(tx, auction);
    return ok({ added: count });
  });
}

/**
 * Uscita di un membro: l'owner può togliere chiunque, ognuno può togliere sé
 * stesso. Solo in DRAFT/READY — «la rimozione di un membro ad asta iniziata non
 * è supportata» (PLAN §17): se serve, si mette in pausa e si usano gli override.
 *
 * I `seat_index` vengono **ricompattati** senza buchi (P13). Un buco nella
 * rotazione non è un dettaglio estetico: la rotazione dei turni scorre i seat
 * in ordine circolare, e un indice mancante sarebbe un turno di nessuno.
 */
export async function removeMember(
  actorUserId: string,
  memberId: string,
): Promise<Result<{ auctionId: string }>> {
  const member = await db.query.members.findFirst({
    where: eq(members.id, memberId),
  });
  if (!member) {
    return fail("MEMBER_NOT_FOUND", "Questo partecipante non esiste.");
  }

  return withSetupLock(member.auctionId, async (tx, auction) => {
    const isOwner = auction.ownerUserId === actorUserId;
    const isSelf = member.userId === actorUserId;
    if (!isOwner && !isSelf) {
      return fail<{ auctionId: string }>(
        "FORBIDDEN",
        "Puoi togliere solo te stesso, a meno che l'asta non sia tua.",
      );
    }
    const wrongStatus = requireSetupPhase<{ auctionId: string }>(auction);
    if (wrongStatus) return wrongStatus;

    await tx.delete(members).where(eq(members.id, memberId));

    // Ricompattazione. In ordine crescente di seat ogni membro può solo
    // scendere di posto, quindi non si scontra mai con UNIQUE(auction, seat).
    const remaining = await tx
      .select({ id: members.id, seatIndex: members.seatIndex })
      .from(members)
      .where(eq(members.auctionId, auction.id))
      .orderBy(asc(members.seatIndex));

    for (const [index, row] of remaining.entries()) {
      if (row.seatIndex !== index) {
        await tx
          .update(members)
          .set({ seatIndex: index })
          .where(eq(members.id, row.id));
      }
    }

    await recomputeStatus(tx, auction);
    return ok({ auctionId: auction.id });
  });
}

// ─── Viste di lettura ────────────────────────────────────────────────────────

export type AuctionListItem = {
  id: string;
  name: string;
  status: AuctionStatus;
  seats: number;
  memberCount: number;
  isOwner: boolean;
  isMember: boolean;
  teamName: string | null;
};

/** Le aste di cui l'utente è owner o membro, per la dashboard. */
export async function listUserAuctions(
  userId: string,
): Promise<AuctionListItem[]> {
  const rows = await db
    .selectDistinct({ auction: auctions })
    .from(auctions)
    .leftJoin(members, eq(members.auctionId, auctions.id))
    .where(or(eq(auctions.ownerUserId, userId), eq(members.userId, userId)))
    .orderBy(asc(auctions.createdAt));

  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.auction.id);
  const allMembers = await db
    .select({
      auctionId: members.auctionId,
      userId: members.userId,
      teamName: members.teamName,
    })
    .from(members)
    .where(inArray(members.auctionId, ids));

  return rows.map(({ auction }) => {
    const own = allMembers.filter((m) => m.auctionId === auction.id);
    const mine = own.find((m) => m.userId === userId);
    return {
      id: auction.id,
      name: auction.name,
      status: auction.status,
      seats: auction.seats,
      memberCount: own.length,
      isOwner: auction.ownerUserId === userId,
      isMember: mine !== undefined,
      teamName: mine?.teamName ?? null,
    };
  });
}

export type MemberView = Pick<
  Member,
  "id" | "userId" | "teamName" | "seatIndex" | "budgetInitial"
> & { displayName: string | null };

export type AuctionOverview = {
  auction: Auction;
  members: MemberView[];
  slots: SlotsByRole;
  totalSlots: number;
  pool: PoolCounts;
  listoneSize: number;
  outOfListCount: number;
  poolProblem: string | null;
  invites: { token: string; uses: number; maxUses: number | null }[];
  viewerIsOwner: boolean;
  viewerMember: MemberView | null;
};

/**
 * Tutto ciò che serve alle pagine di setup e lobby, in una lettura sola.
 *
 * Non è `serializeSnapshot` (regola 3): quella funzione serializza lo stato
 * *dell'asta in corso* ed è l'unico punto che può far uscire importi di
 * offerte. Qui siamo prima dell'avvio, non esistono né lotti né buste.
 *
 * ⚠ È avvolta in `cache()` di React perché da M2 la chiamano **due volte per
 * richiesta**: il layout dell'asta, che ne ricava badge, titolo e sotto-navbar,
 * e poi la pagina. La memoizzazione dura quanto la singola richiesta e non
 * altro: fuori da un contesto di render React esegue la funzione senza
 * memoizzare nulla, quindi test e script continuano a leggere il database vero
 * a ogni chiamata.
 */
export const getAuctionOverview = cache(async function getAuctionOverview(
  auctionId: string,
  viewerUserId: string,
): Promise<AuctionOverview | null> {
  // F7-07bis: le pagine prendono l'id dall'URL e chiamano di qui; un id
  // malformato deve diventare il loro `notFound()`, non un 500.
  if (!isUuid(auctionId)) return null;

  const auction = await db.query.auctions.findFirst({
    where: eq(auctions.id, auctionId),
  });
  if (!auction) return null;

  const memberRows = await db
    .select({
      id: members.id,
      userId: members.userId,
      teamName: members.teamName,
      seatIndex: members.seatIndex,
      budgetInitial: members.budgetInitial,
      displayName: users.displayName,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.auctionId, auctionId))
    .orderBy(asc(members.seatIndex));

  const [{ n: listoneSize }] = await db
    .select({ n: count() })
    .from(players)
    .where(eq(players.auctionId, auctionId));

  const [{ n: outOfListCount }] = await db
    .select({ n: count() })
    .from(players)
    .where(and(eq(players.auctionId, auctionId), eq(players.outOfList, true)));

  const pool = await poolCounts(db, auction);
  const slots = slotsOf(auction);
  const poolCheck =
    listoneSize > 0
      ? validateRolePool({ counts: pool, slots, seats: auction.seats })
      : ok(null);

  const inviteRows = await db
    .select({
      token: invites.token,
      uses: invites.uses,
      maxUses: invites.maxUses,
    })
    .from(invites)
    .where(eq(invites.auctionId, auctionId))
    .orderBy(asc(invites.createdAt));

  return {
    auction,
    members: memberRows,
    slots,
    totalSlots: totalSlots(slots),
    pool,
    listoneSize,
    outOfListCount,
    poolProblem: poolCheck.ok ? null : poolCheck.error.message,
    invites: inviteRows,
    viewerIsOwner: auction.ownerUserId === viewerUserId,
    viewerMember: memberRows.find((m) => m.userId === viewerUserId) ?? null,
  };
});

/** Il listone dell'asta, per la tabella di anteprima nel setup. */
export async function listPlayers(
  auctionId: string,
  limit = 50,
): Promise<
  { extId: number; name: string; team: string; role: Role; fvm: number; quot: number; outOfList: boolean }[]
> {
  return db
    .select({
      extId: players.extId,
      name: players.name,
      team: players.team,
      role: players.role,
      fvm: players.fvm,
      quot: players.quot,
      outOfList: players.outOfList,
    })
    .from(players)
    .where(eq(players.auctionId, auctionId))
    .orderBy(sql`${players.fvm} DESC`, sql`${players.quot} DESC`)
    .limit(limit);
}

/**
 * Il pool chiamabile dell'asta, per la schermata di chiamata del portale
 * (F5-10): tutto il listone meno i fuori lista, se l'asta li esclude.
 *
 * Sta qui accanto a `listPlayers` perché è la stessa cosa — una lettura del
 * listone — e perché **non è stato dell'asta**: nessuna offerta, nessun credito,
 * niente da sanificare, e dall'import in poi non cambia più. Per questo non
 * passa da `serializeSnapshot` e non viola la regola 3: quel vincolo protegge lo
 * stato del gioco, non l'elenco dei calciatori di Serie A.
 *
 * Chi sia già stato comprato **non** si chiede qui: quello sta nelle rose dello
 * snapshot, e il client lo sottrae da questa lista (regola 7, I10). Una query
 * per lotto sarebbe una seconda fonte di verità sullo stesso fatto.
 */
export async function listPickPool(auctionId: string): Promise<PoolPlayer[]> {
  if (!isUuid(auctionId)) return [];

  const auction = await db.query.auctions.findFirst({
    where: eq(auctions.id, auctionId),
    columns: { includeOutOfList: true },
  });
  if (!auction) return [];

  return db
    .select({
      id: players.id,
      name: players.name,
      team: players.team,
      role: players.role,
      fvm: players.fvm,
      quot: players.quot,
    })
    .from(players)
    .where(
      auction.includeOutOfList
        ? eq(players.auctionId, auctionId)
        : and(eq(players.auctionId, auctionId), eq(players.outOfList, false)),
    )
    .orderBy(sql`${players.fvm} DESC`, sql`${players.quot} DESC`);
}

export { DEFAULT_CONFIG, type AuctionConfig };
