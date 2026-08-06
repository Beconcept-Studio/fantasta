import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Schema Drizzle. In Fase 0 esiste solo `users`: il resto delle tabelle di
 * PLAN §3 arriva in Fase 1.
 *
 * Tutti i timestamp sono TIMESTAMPTZ e il server gira in UTC (PLAN §17):
 * la conversione a Europe/Rome avviene solo in rendering.
 */
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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
