/**
 * Riempie il database usa-e-getta `asta_banco` con quello che serve a guardare
 * la tab Listone: il listone a sistema, il foglio globale, un utente Pro e il
 * suo listone personale. Roba di sessione, non entra nel repo.
 */
import { readFileSync } from "node:fs";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { members, users } from "@/lib/db/schema";
import { uploadCarmy } from "@/lib/engine/carmy";
import { uploadListone } from "@/lib/engine/listone";
import { uploadUserListone, userListoneStatus } from "@/lib/engine/user-listone";

async function main() {
  const LISTONE = readFileSync("fixtures/listone.xlsx");
  const CARMY = readFileSync("fixtures/carmy.xlsx");
  const T0 = new Date();

  const l = await uploadListone(LISTONE, T0);
  console.log("listone:", l.ok ? l.value : l.error);

  const c = await uploadCarmy(CARMY, T0);
  console.log("carmy:", c.ok ? { written: c.value.written } : c.error);

  // Il primo membro dell'asta seedata: è quello con cui si entra dal login di
  // sviluppo. Lo faccio Pro, così la tab si apre.
  const [seat0] = await db
    .select({ userId: members.userId })
    .from(members)
    .where(eq(members.seatIndex, 0));

  await db.update(users).set({ isPro: true }).where(eq(users.id, seat0.userId));

  const nome = await db.query.users.findFirst({
    where: eq(users.id, seat0.userId),
  });
  console.log("pro:", nome?.displayName, seat0.userId);

  const mio = await uploadUserListone(seat0.userId, CARMY, T0);
  console.log("mio:", mio.ok ? mio.value.written + " righe, " + mio.value.obiettivi + " obiettivi" : mio.error);
  console.log("status:", await userListoneStatus(seat0.userId));

  // Il secondo posto resta senza permesso: serve a guardare la tab spenta.
  const [seat1] = await db
    .select({ userId: members.userId })
    .from(members)
    .where(eq(members.seatIndex, 1));
  const senza = await db.query.users.findFirst({ where: eq(users.id, seat1.userId) });
  console.log("non-pro:", senza?.displayName, senza?.isPro, senza?.isAdmin);

  console.log(
    "aste:",
    await db.execute(sql`select id, status, phase, current_role from auctions`),
  );
  await insights();
  process.exit(0);

}

void main();

// ─── Gli insight, dalla fixture invece che dalla rete ────────────────────────
// Serve a guardare le colonne Gol e Assist con dei numeri dentro invece che coi
// trattini: senza `player_insights` la tab Listone è corretta ma non si vede se
// quelle due colonne funzionano.
export async function insights() {
  const { refreshListoneInsights, LISTONE_URL } = await import(
    "@/lib/engine/insights"
  );
  const body = readFileSync("fixtures/fantalab-listone.json", "utf8");
  const fetchImpl = (async (url: string | URL | Request) =>
    String(url) === LISTONE_URL
      ? new Response(body, { status: 200 })
      : new Response("no", { status: 404 })) as unknown as typeof fetch;
  const out = await refreshListoneInsights({ fetchImpl });
  console.log("insights:", out.ok ? { written: out.value.written } : out.error);
}
