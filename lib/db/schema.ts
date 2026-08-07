import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  type AuctionPhase,
  type AuctionStatus,
  ROLES,
  type Role,
} from "@/lib/domain";

/**
 * Schema Drizzle — traduzione fedele di PLAN §3.
 *
 * Tre cose da tenere a mente leggendolo:
 *
 * 1. **Tutti i timestamp sono TIMESTAMPTZ e il server gira in UTC** (PLAN §17).
 *    La conversione a Europe/Rome avviene solo in rendering: nessun `Date`
 *    naive da nessuna parte.
 * 2. **Il credito non è una colonna.** Non esiste `members.credits`: si calcola
 *    con `budget_initial + Σ ledger.delta − Σ assignments.price` sulle righe non
 *    annullate. Gli annullamenti sono `voided_at`, mai `DELETE`.
 * 3. **Il listone è copiato dentro l'asta.** `players.auction_id` congela la
 *    lista al momento dell'import: se il file cambia l'anno prossimo, le aste
 *    passate restano coerenti.
 *
 * Le due invarianti che qui diventano indici parziali — un solo lotto aperto per
 * asta (I1) e un solo proprietario per giocatore (I2) — sono l'unico modo di
 * renderle vere anche sotto concorrenza: nessun controllo applicativo può
 * garantirle da solo.
 */

// ─── Utenti ──────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  googleSub: text("google_sub").unique(),
  email: text("email"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Asta ────────────────────────────────────────────────────────────────────

export const auctions = pgTable(
  "auctions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    /** Token della vista TV: `/tv/[publicToken]`, senza login. */
    publicToken: text("public_token").notNull().unique(),

    status: text("status").$type<AuctionStatus>().notNull().default("DRAFT"),
    phase: text("phase").$type<AuctionPhase>(),
    /** Incrementato ad OGNI transizione: il client scarta gli snapshot vecchi. */
    stateVersion: integer("state_version").notNull().default(0),

    seats: integer("seats").notNull(),
    budgetDefault: integer("budget_default").notNull().default(500),
    bidSeconds: integer("bid_seconds").notNull().default(30),
    pickSeconds: integer("pick_seconds").notNull().default(30),
    tiePrepSeconds: integer("tie_prep_seconds").notNull().default(10),
    revealSeconds: integer("reveal_seconds").notNull().default(10),
    slotsP: integer("slots_p").notNull().default(3),
    slotsD: integer("slots_d").notNull().default(8),
    slotsC: integer("slots_c").notNull().default(8),
    slotsA: integer("slots_a").notNull().default(6),

    /**
     * Ordine dei ruoli scelto alla creazione (drag & drop). Permutazione
     * completa di P,D,C,A. Il primo elemento **è** il ruolo iniziale dell'asta.
     */
    roleOrder: text("role_order")
      .array()
      .$type<Role[]>()
      .notNull()
      .default([...ROLES]),

    /**
     * Se i giocatori marcati "Fuori lista" entrano nel pool acquistabile
     * (DECISIONS, P7). Ogni modifica rivalida I9.
     */
    includeOutOfList: boolean("include_out_of_list").notNull().default(false),

    currentRole: text("current_role").$type<Role>(),
    currentSeatIndex: integer("current_seat_index"),
    /**
     * Volutamente senza FOREIGN KEY verso `lots`: `lots.auction_id` punta già
     * qui e la coppia di vincoli renderebbe circolare la creazione dello schema
     * (e la cancellazione di un'asta). PLAN §3 non la richiede.
     */
    currentLotId: uuid("current_lot_id"),
    phaseDeadline: timestamp("phase_deadline", { withTimezone: true }),
    /** Valorizzato solo con `status = 'PAUSED'`. */
    pausedAt: timestamp("paused_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    check("auctions_seats_check", sql`${t.seats} IN (8, 10, 12)`),
    index("auctions_owner_idx").on(t.ownerUserId),
  ],
);

// ─── Membri ──────────────────────────────────────────────────────────────────

export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    auctionId: uuid("auction_id")
      .notNull()
      .references(() => auctions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    teamName: text("team_name").notNull(),
    /** Ordine di rotazione, 0-based, assegnato in ordine di join (P13). */
    seatIndex: integer("seat_index").notNull(),
    budgetInitial: integer("budget_initial").notNull(),
    /** Telemetria di presence: si scrive fuori da `withAuctionLock` (P8). */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    isVisible: boolean("is_visible").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("members_auction_user_unique").on(t.auctionId, t.userId),
    unique("members_auction_seat_unique").on(t.auctionId, t.seatIndex),
  ],
);

// ─── Inviti ──────────────────────────────────────────────────────────────────

export const invites = pgTable("invites", {
  token: text("token").primaryKey(),
  auctionId: uuid("auction_id")
    .notNull()
    .references(() => auctions.id, { onDelete: "cascade" }),
  createdByUserId: uuid("created_by_user_id")
    .notNull()
    .references(() => users.id),
  /**
   * `expires_at` e `max_uses` restano di default vuoti: il link vale per
   * chiunque finché l'asta è in DRAFT/READY (DECISIONS 2026-08-06). La
   * protezione vera è che gli inviti muoiono all'avvio dell'asta (PLAN §17).
   */
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  maxUses: integer("max_uses"),
  uses: integer("uses").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Listone (snapshot per asta) ─────────────────────────────────────────────

export const players = pgTable(
  "players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    auctionId: uuid("auction_id")
      .notNull()
      .references(() => auctions.id, { onDelete: "cascade" }),
    /** La colonna `#` del file Fantacalcio.it. */
    extId: integer("ext_id").notNull(),
    name: text("name").notNull(),
    team: text("team").notNull(),
    role: text("role").$type<Role>().notNull(),
    roleMantra: text("role_mantra"),
    fvm: integer("fvm").notNull(),
    quot: integer("quot").notNull(),
    outOfList: boolean("out_of_list").notNull().default(false),
  },
  (t) => [
    unique("players_auction_ext_unique").on(t.auctionId, t.extId),
    // L'ordinamento esatto dell'auto-pick: fvm DESC, quot DESC, ext_id ASC.
    index("players_autopick_idx").on(
      t.auctionId,
      t.role,
      t.fvm.desc(),
      t.quot.desc(),
      t.extId.asc(),
    ),
  ],
);

// ─── Lotti (una chiamata all'asta) ───────────────────────────────────────────

export const lots = pgTable(
  "lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    auctionId: uuid("auction_id")
      .notNull()
      .references(() => auctions.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    calledByMemberId: uuid("called_by_member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    autoCalled: boolean("auto_called").notNull().default(false),
    status: text("status").$type<"OPEN" | "RESOLVED">().notNull(),
    currentRound: integer("current_round").notNull().default(1),
    winnerMemberId: uuid("winner_member_id").references(() => members.id, {
      onDelete: "cascade",
    }),
    finalPrice: integer("final_price"),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    unique("lots_auction_seq_unique").on(t.auctionId, t.seq),
    // I1 — al massimo un lotto aperto per asta, garantito dal database.
    uniqueIndex("one_open_lot_per_auction")
      .on(t.auctionId)
      .where(sql`${t.status} = 'OPEN'`),
  ],
);

// ─── Round di offerta ────────────────────────────────────────────────────────

export const lotRounds = pgTable(
  "lot_rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => lots.id, { onDelete: "cascade" }),
    /** 1 = round base, 2 = spareggio. Non esiste un round 3. */
    roundNo: integer("round_no").notNull(),
    minAmount: integer("min_amount").notNull().default(1),
    startsAt: timestamp("starts_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [unique("lot_rounds_lot_round_unique").on(t.lotId, t.roundNo)],
);

export const roundEligibility = pgTable(
  "round_eligibility",
  {
    lotRoundId: uuid("lot_round_id")
      .notNull()
      .references(() => lotRounds.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.lotRoundId, t.memberId] })],
);

// ─── Offerte ─────────────────────────────────────────────────────────────────

export const bids = pgTable(
  "bids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lotRoundId: uuid("lot_round_id")
      .notNull()
      .references(() => lotRounds.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    /**
     * Quando è stata fissata **questa** cifra, non quando è nata la riga:
     * è il timestamp che decide lo spareggio in caso di stallo, e sopravvive
     * al carry-forward nel round 2.
     */
    amountSetAt: timestamp("amount_set_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  },
  (t) => [
    check("bids_amount_check", sql`${t.amount} >= 1`),
    // L'override di un'offerta è un UPDATE, non una riga nuova.
    unique("bids_round_member_unique").on(t.lotRoundId, t.memberId),
  ],
);

// ─── Rose ────────────────────────────────────────────────────────────────────

export const assignments = pgTable(
  "assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    auctionId: uuid("auction_id")
      .notNull()
      .references(() => auctions.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    price: integer("price").notNull(),
    lotId: uuid("lot_id").references(() => lots.id, { onDelete: "cascade" }),
    source: text("source").$type<"AUCTION" | "MANUAL">().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** L'annullamento è questo. Mai un DELETE. */
    voidedAt: timestamp("voided_at", { withTimezone: true }),
  },
  (t) => [
    // I2 — un giocatore ha al massimo un proprietario non annullato.
    uniqueIndex("one_owner_per_player")
      .on(t.auctionId, t.playerId)
      .where(sql`${t.voidedAt} IS NULL`),
    index("assignments_member_idx").on(t.memberId),
  ],
);

// ─── Rettifiche budget ───────────────────────────────────────────────────────

export const ledger = pgTable(
  "ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    auctionId: uuid("auction_id")
      .notNull()
      .references(() => auctions.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("ledger_member_idx").on(t.memberId)],
);

// ─── Audit ───────────────────────────────────────────────────────────────────

/**
 * La memoria dell'asta. Quando qualcosa andrà storto in diretta, questa tabella
 * sarà l'unica cosa che permetterà di capire cosa è successo (PLAN §14.8).
 */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    auctionId: uuid("auction_id")
      .notNull()
      .references(() => auctions.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("events_auction_idx").on(t.auctionId, t.id)],
);

// ─── Tipi inferiti ───────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Auction = typeof auctions.$inferSelect;
export type NewAuction = typeof auctions.$inferInsert;
export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;
export type Invite = typeof invites.$inferSelect;
export type NewInvite = typeof invites.$inferInsert;
export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type Lot = typeof lots.$inferSelect;
export type LotRound = typeof lotRounds.$inferSelect;
export type Bid = typeof bids.$inferSelect;
export type Assignment = typeof assignments.$inferSelect;
export type LedgerEntry = typeof ledger.$inferSelect;
export type AuctionEventRow = typeof events.$inferSelect;
