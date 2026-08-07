import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { asc, eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { auctions, invites, members, players } from "@/lib/db/schema";
import {
  createAuction,
  createInvite,
  getAuctionOverview,
  importPlayers,
  joinAsOwner,
  joinAuction,
  listUserAuctions,
  removeMember,
  setIncludeOutOfList,
  updateAuctionSettings,
} from "@/lib/engine/setup";
import { DEFAULT_CONFIG } from "@/lib/engine/setup-rules";
import { SHEET_NAME } from "@/lib/import/parseListone";

import {
  closeDatabase,
  databaseAvailable,
  dropAuctions,
  dropUsers,
  makeUser,
} from "./helpers";

/**
 * Il setup dell'asta contro un Postgres vero.
 *
 * Se il database non risponde (Docker spento) l'intera suite si salta invece
 * di fallire: `pnpm test` deve restare eseguibile su una macchina appena
 * clonata. Il gate di fase, però, si verifica con Postgres acceso — è scritto
 * nel runbook.
 */

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn(
    "\n⚠ Postgres non raggiungibile: i test di integrazione sono saltati.\n" +
      "  Avvia il database con `docker compose up -d` e rilancia `pnpm test`.\n",
  );
}

const LISTONE = readFileSync(
  fileURLToPath(new URL("../../fixtures/listone.xlsx", import.meta.url)),
);

/** Un listone artificiale, per provare I9 senza dipendere dalla fixture. */
function poorListone(counts: { P: number; D: number; C: number; A: number }) {
  let id = 0;
  const rows = (["P", "D", "C", "A"] as const).flatMap((role) =>
    Array.from({ length: counts[role] }, () => {
      id += 1;
      return {
        "#": id,
        Nome: `Giocatore ${id}`,
        "Fuori lista": "",
        "Sq.": "Test",
        "R.": role,
        "R.MANTRA": role,
        "FVM/1000": 100 - (id % 90),
        "QUOT.": 10,
      };
    }),
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), SHEET_NAME);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

const createdAuctions: string[] = [];
const createdUsers: string[] = [];

async function user(label?: string): Promise<string> {
  const id = await makeUser(label);
  createdUsers.push(id);
  return id;
}

async function auction(
  ownerId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const result = await createAuction(ownerId, {
    name: "Asta di test",
    ...DEFAULT_CONFIG,
    ...overrides,
  });
  if (!result.ok) throw new Error(result.error.message);
  createdAuctions.push(result.value.auctionId);
  return result.value.auctionId;
}

async function inviteFor(ownerId: string, auctionId: string): Promise<string> {
  const result = await createInvite(ownerId, auctionId);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.token;
}

async function statusOf(auctionId: string): Promise<string> {
  const row = await db.query.auctions.findFirst({
    where: eq(auctions.id, auctionId),
  });
  return row!.status;
}

async function seats(auctionId: string) {
  return db
    .select({ seatIndex: members.seatIndex, teamName: members.teamName })
    .from(members)
    .where(eq(members.auctionId, auctionId))
    .orderBy(asc(members.seatIndex));
}

// `pg` fa vero I/O: i timer finti del setup condiviso qui darebbero fastidio.
beforeEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  if (!dbUp) return;
  await dropAuctions(createdAuctions);
  await dropUsers(createdUsers);
  await closeDatabase();
});

describe.skipIf(!dbUp)("createAuction", () => {
  it("persiste l'asta con l'owner giusto e un public token", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId, { name: "Lega dei Rossi" });

    const row = await db.query.auctions.findFirst({
      where: eq(auctions.id, id),
    });
    expect(row).toBeDefined();
    expect(row!.name).toBe("Lega dei Rossi");
    expect(row!.ownerUserId).toBe(ownerId);
    expect(row!.status).toBe("DRAFT");
    expect(row!.stateVersion).toBe(0);
    expect(row!.publicToken).toMatch(/^[A-Za-z0-9_-]{10,}$/);
  });

  it("salva l'ordine dei ruoli scelto, non quello di default", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId, { roleOrder: ["C", "A", "P", "D"] });

    const row = await db.query.auctions.findFirst({
      where: eq(auctions.id, id),
    });
    expect(row!.roleOrder).toEqual(["C", "A", "P", "D"]);
  });

  it("rifiuta 9 partecipanti senza scrivere niente", async () => {
    const ownerId = await user("owner");
    const result = await createAuction(ownerId, {
      name: "Asta impossibile",
      ...DEFAULT_CONFIG,
      seats: 9,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_SEATS");

    const rows = await db
      .select()
      .from(auctions)
      .where(eq(auctions.ownerUserId, ownerId));
    expect(rows).toHaveLength(0);
  });

  it("rifiuta un role_order che non è una permutazione di P,D,C,A", async () => {
    const ownerId = await user("owner");
    for (const roleOrder of [
      ["P", "P", "C", "A"],
      ["P", "D", "C"],
    ]) {
      const result = await createAuction(ownerId, {
        name: "Asta impossibile",
        ...DEFAULT_CONFIG,
        roleOrder,
      });
      expect(result.ok, roleOrder.join("")).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("INVALID_ROLE_ORDER");
    }
  });
});

describe.skipIf(!dbUp)("updateAuctionSettings — matrice di modificabilità", () => {
  it("accetta un nuovo role_order in READY e lo rifiuta in LIVE", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId);

    await db.update(auctions).set({ status: "READY" }).where(eq(auctions.id, id));
    const inReady = await updateAuctionSettings(ownerId, id, {
      roleOrder: ["A", "C", "D", "P"],
    });
    expect(inReady.ok).toBe(true);

    await db.update(auctions).set({ status: "LIVE" }).where(eq(auctions.id, id));
    const inLive = await updateAuctionSettings(ownerId, id, {
      roleOrder: ["P", "D", "C", "A"],
    });
    expect(inLive.ok).toBe(false);
    if (!inLive.ok) expect(inLive.error.code).toBe("WRONG_STATUS");

    const row = await db.query.auctions.findFirst({
      where: eq(auctions.id, id),
    });
    expect(row!.roleOrder).toEqual(["A", "C", "D", "P"]);
  });

  it("accetta la modifica dei timer anche in LIVE", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId);
    await db.update(auctions).set({ status: "LIVE" }).where(eq(auctions.id, id));

    const result = await updateAuctionSettings(ownerId, id, { bidSeconds: 45 });
    expect(result.ok).toBe(true);

    const row = await db.query.auctions.findFirst({
      where: eq(auctions.id, id),
    });
    expect(row!.bidSeconds).toBe(45);
  });

  it("rifiuta chi non è l'owner", async () => {
    const ownerId = await user("owner");
    const intruderId = await user("intruso");
    const id = await auction(ownerId);

    const result = await updateAuctionSettings(intruderId, id, {
      bidSeconds: 45,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
  });

  it("rifiuta di scendere sotto il numero di partecipanti già entrati", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId, { seats: 12 });
    const token = await inviteFor(ownerId, id);
    for (let i = 0; i < 9; i += 1) {
      const joiner = await user(`membro${i}`);
      const joined = await joinAuction(joiner, token, `Squadra ${i}`);
      expect(joined.ok).toBe(true);
    }

    const result = await updateAuctionSettings(ownerId, id, { seats: 8 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_SEATS");
      expect(result.error.message).toContain("9");
    }
  });

  it("propaga il nuovo budget ai membri già entrati", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId);
    const token = await inviteFor(ownerId, id);
    const joiner = await user("membro");
    await joinAuction(joiner, token, "Squadra A");

    const result = await updateAuctionSettings(ownerId, id, {
      budgetDefault: 300,
    });
    expect(result.ok).toBe(true);

    const rows = await db
      .select({ budgetInitial: members.budgetInitial })
      .from(members)
      .where(eq(members.auctionId, id));
    expect(rows.every((row) => row.budgetInitial === 300)).toBe(true);
  });

  it("rifiuta un cambio di slot che romperebbe I9 sul listone già importato", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId, { seats: 12 });
    const imported = await importPlayers(ownerId, id, LISTONE);
    expect(imported.ok).toBe(true);

    // 85 attaccanti: con 8 slot × 12 partecipanti ne servirebbero 96.
    const result = await updateAuctionSettings(ownerId, id, {
      slots: { ...DEFAULT_CONFIG.slots, A: 8 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LISTONE_INSUFFICIENT");
      expect(result.error.message).toContain("Attaccanti");
    }
  });
});

describe.skipIf(!dbUp)("importPlayers", () => {
  it("popola il listone dell'asta e conta i fuori lista", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId);

    const result = await importPlayers(ownerId, id, LISTONE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.imported).toBe(495);
    expect(result.value.outOfList).toBe(5);
    expect(result.value.counts).toEqual({ P: 59, D: 174, C: 172, A: 85 });

    const rows = await db.select().from(players).where(eq(players.auctionId, id));
    expect(rows).toHaveLength(495);
  });

  it("il reimport sostituisce lo snapshot invece di duplicare gli ext_id", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId);

    await importPlayers(ownerId, id, LISTONE);
    const second = await importPlayers(ownerId, id, LISTONE);
    expect(second.ok).toBe(true);

    const rows = await db
      .select({ extId: players.extId })
      .from(players)
      .where(eq(players.auctionId, id));
    expect(rows).toHaveLength(495);
    expect(new Set(rows.map((r) => r.extId)).size).toBe(495);
  });

  it("rifiuta l'import da chi non è l'owner", async () => {
    const ownerId = await user("owner");
    const intruderId = await user("intruso");
    const id = await auction(ownerId);

    const result = await importPlayers(intruderId, id, LISTONE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");

    const rows = await db.select().from(players).where(eq(players.auctionId, id));
    expect(rows).toHaveLength(0);
  });

  it("rifiuta un listone povero di attaccanti, nominando il ruolo e i numeri", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId, { seats: 8 });

    const result = await importPlayers(
      ownerId,
      id,
      poorListone({ P: 40, D: 100, C: 100, A: 20 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LISTONE_INSUFFICIENT");
      expect(result.error.message).toContain("Attaccanti");
      expect(result.error.message).toContain("48"); // 6 slot × 8 partecipanti
      expect(result.error.message).toContain("20");
    }

    const rows = await db.select().from(players).where(eq(players.auctionId, id));
    expect(rows).toHaveLength(0);
  });
});

describe.skipIf(!dbUp)("setIncludeOutOfList", () => {
  it("allarga il pool quando si accendono i fuori lista", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId);
    await importPlayers(ownerId, id, LISTONE);

    const before = await getAuctionOverview(id, ownerId);
    expect(before!.pool).toEqual({ P: 59, D: 174, C: 172, A: 85 });

    const result = await setIncludeOutOfList(ownerId, id, true);
    expect(result.ok).toBe(true);

    const after = await getAuctionOverview(id, ownerId);
    expect(after!.pool).toEqual({ P: 61, D: 177, C: 172, A: 85 });
  });

  it("rifiuta lo spegnimento che renderebbe un ruolo insufficiente", async () => {
    const ownerId = await user("owner");
    // 8 portieri "fuori lista" su 24: senza di loro I9 non regge a 8 posti.
    const id = await auction(ownerId, {
      seats: 8,
      slots: { P: 3, D: 8, C: 8, A: 6 },
    });

    let extId = 0;
    const rows = (
      [
        ["P", 16, false],
        ["P", 8, true],
        ["D", 64, false],
        ["C", 64, false],
        ["A", 48, false],
      ] as const
    ).flatMap(([role, n, out]) =>
      Array.from({ length: n }, () => {
        extId += 1;
        return {
          "#": extId,
          Nome: `Giocatore ${extId}`,
          "Fuori lista": out ? "*" : "",
          "Sq.": "Test",
          "R.": role,
          "R.MANTRA": role,
          "FVM/1000": 50,
          "QUOT.": 10,
        };
      }),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), SHEET_NAME);
    const file = XLSX.write(wb, {
      type: "array",
      bookType: "xlsx",
    }) as ArrayBuffer;

    // Con i fuori lista accesi ci sono 24 portieri: l'import passa.
    await db
      .update(auctions)
      .set({ includeOutOfList: true })
      .where(eq(auctions.id, id));
    const imported = await importPlayers(ownerId, id, file);
    expect(imported.ok).toBe(true);

    // Spegnendoli restano 16 portieri e ne servono 24: rifiutato.
    const result = await setIncludeOutOfList(ownerId, id, false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LISTONE_INSUFFICIENT");
      expect(result.error.message).toContain("Portieri");
    }

    const row = await db.query.auctions.findFirst({
      where: eq(auctions.id, id),
    });
    expect(row!.includeOutOfList).toBe(true);
  });
});

describe.skipIf(!dbUp)("inviti e join", () => {
  it("assegna i seat in ordine di join", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId);
    const token = await inviteFor(ownerId, id);

    const first = await user("primo");
    const second = await user("secondo");
    const a = await joinAuction(first, token, "Prima Squadra");
    const b = await joinAuction(second, token, "Seconda Squadra");
    expect(a.ok && b.ok).toBe(true);

    expect(await seats(id)).toEqual([
      { seatIndex: 0, teamName: "Prima Squadra" },
      { seatIndex: 1, teamName: "Seconda Squadra" },
    ]);
  });

  it("incrementa gli utilizzi dell'invito a ogni join riuscito", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId);
    const token = await inviteFor(ownerId, id);

    await joinAuction(await user("a"), token, "Squadra A");
    await joinAuction(await user("b"), token, "Squadra B");

    const row = await db.query.invites.findFirst({
      where: eq(invites.token, token),
    });
    expect(row!.uses).toBe(2);
  });

  it("rifiuta il secondo join dello stesso utente", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId);
    const token = await inviteFor(ownerId, id);
    const joiner = await user("doppione");

    expect((await joinAuction(joiner, token, "Squadra A")).ok).toBe(true);
    const again = await joinAuction(joiner, token, "Squadra B");
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("ALREADY_MEMBER");

    expect(await seats(id)).toHaveLength(1);
  });

  it("rifiuta il join oltre il numero di posti", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId, { seats: 8 });
    const token = await inviteFor(ownerId, id);

    for (let i = 0; i < 8; i += 1) {
      const joined = await joinAuction(await user(`m${i}`), token, `Squadra ${i}`);
      expect(joined.ok, `join ${i}`).toBe(true);
    }

    const overflow = await joinAuction(await user("tardivo"), token, "In ritardo");
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.error.code).toBe("AUCTION_FULL");
  });

  it("rifiuta un nome squadra vuoto senza consumare l'invito", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId);
    const token = await inviteFor(ownerId, id);

    const result = await joinAuction(await user("anonimo"), token, "  ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TEAM_NAME");

    const row = await db.query.invites.findFirst({
      where: eq(invites.token, token),
    });
    expect(row!.uses).toBe(0);
  });

  it("l'owner può entrare come membro normale", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId);

    const result = await joinAsOwner(ownerId, id, "Squadra del boss");
    expect(result.ok).toBe(true);
    expect(await seats(id)).toEqual([
      { seatIndex: 0, teamName: "Squadra del boss" },
    ]);
  });

  it("rifiuta un token che non esiste", async () => {
    const result = await joinAuction(await user("curioso"), "non-esiste", "X Team");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVITE_NOT_FOUND");
  });
});

describe.skipIf(!dbUp)("scadenza degli inviti", () => {
  it("rifiuta l'invito quando l'asta è già partita", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId);
    const token = await inviteFor(ownerId, id);
    await db.update(auctions).set({ status: "LIVE" }).where(eq(auctions.id, id));

    const result = await joinAuction(await user("tardivo"), token, "In ritardo");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVITE_CLOSED");
  });

  it("rifiuta un invito scaduto", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId);
    const expiresAt = new Date("2026-01-01T12:00:00Z");
    const created = await createInvite(ownerId, id, { expiresAt });
    if (!created.ok) throw new Error(created.error.message);

    const prima = await joinAuction(
      await user("puntuale"),
      created.value.token,
      "Puntuale",
      new Date("2026-01-01T11:59:00Z"),
    );
    expect(prima.ok).toBe(true);

    const dopo = await joinAuction(
      await user("ritardatario"),
      created.value.token,
      "Ritardatario",
      new Date("2026-01-01T12:00:01Z"),
    );
    expect(dopo.ok).toBe(false);
    if (!dopo.ok) expect(dopo.error.code).toBe("INVITE_EXPIRED");
  });

  it("rifiuta un invito con gli utilizzi esauriti", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId);
    const created = await createInvite(ownerId, id, { maxUses: 1 });
    if (!created.ok) throw new Error(created.error.message);

    expect((await joinAuction(await user("a"), created.value.token, "Squadra A")).ok).toBe(
      true,
    );
    const second = await joinAuction(
      await user("b"),
      created.value.token,
      "Squadra B",
    );
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("INVITE_EXHAUSTED");
  });
});

describe.skipIf(!dbUp)("removeMember", () => {
  it("ricompatta i seat senza lasciare buchi", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId);
    const token = await inviteFor(ownerId, id);

    const ids: string[] = [];
    for (const name of ["Alfa", "Beta", "Gamma"]) {
      const joined = await joinAuction(await user(name), token, name);
      if (!joined.ok) throw new Error(joined.error.message);
      ids.push(joined.value.memberId);
    }

    const removed = await removeMember(ownerId, ids[0]);
    expect(removed.ok).toBe(true);

    expect(await seats(id)).toEqual([
      { seatIndex: 0, teamName: "Beta" },
      { seatIndex: 1, teamName: "Gamma" },
    ]);
  });

  it("lascia che un membro esca da solo, ma non che tolga gli altri", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId);
    const token = await inviteFor(ownerId, id);

    const meId = await user("io");
    const otherId = await user("altro");
    const me = await joinAuction(meId, token, "La Mia");
    const other = await joinAuction(otherId, token, "L'Altra");
    if (!me.ok || !other.ok) throw new Error("join fallito");

    const intrusion = await removeMember(meId, other.value.memberId);
    expect(intrusion.ok).toBe(false);
    if (!intrusion.ok) expect(intrusion.error.code).toBe("FORBIDDEN");

    const selfExit = await removeMember(meId, me.value.memberId);
    expect(selfExit.ok).toBe(true);
    expect(await seats(id)).toEqual([{ seatIndex: 0, teamName: "L'Altra" }]);
  });

  it("rifiuta la rimozione ad asta iniziata", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId);
    const token = await inviteFor(ownerId, id);
    const joined = await joinAuction(await user("membro"), token, "Squadra");
    if (!joined.ok) throw new Error(joined.error.message);

    await db.update(auctions).set({ status: "LIVE" }).where(eq(auctions.id, id));
    const result = await removeMember(ownerId, joined.value.memberId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WRONG_STATUS");
  });
});

describe.skipIf(!dbUp)("DRAFT ↔ READY è derivato", () => {
  it("diventa READY con l'ultimo join, se il listone regge", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId, { seats: 8 });
    await importPlayers(ownerId, id, LISTONE);
    const token = await inviteFor(ownerId, id);

    const memberIds: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const joined = await joinAuction(await user(`m${i}`), token, `Squadra ${i}`);
      if (!joined.ok) throw new Error(joined.error.message);
      memberIds.push(joined.value.memberId);
      // Prima dell'ottavo join l'asta è ancora incompleta.
      if (i < 7) expect(await statusOf(id)).toBe("DRAFT");
    }
    expect(await statusOf(id)).toBe("READY");

    // …e torna indietro: la readiness non è uno stato che si conferma.
    const removed = await removeMember(ownerId, memberIds[0]);
    expect(removed.ok).toBe(true);
    expect(await statusOf(id)).toBe("DRAFT");
  });

  it("resta DRAFT se i posti sono pieni ma manca il listone", async () => {
    const ownerId = await user("owner");
    const id = await auction(ownerId, { seats: 8 });
    const token = await inviteFor(ownerId, id);
    for (let i = 0; i < 8; i += 1) {
      await joinAuction(await user(`m${i}`), token, `Squadra ${i}`);
    }
    expect(await statusOf(id)).toBe("DRAFT");

    const imported = await importPlayers(ownerId, id, LISTONE);
    expect(imported.ok).toBe(true);
    expect(await statusOf(id)).toBe("READY");
  });
});

describe.skipIf(!dbUp)("dashboard", () => {
  it("elenca sia le aste create sia quelle a cui si è entrati", async () => {
    const ownerId = await user("owner");
    const guestId = await user("ospite");

    const mine = await auction(ownerId, { name: "La mia asta" });
    const theirs = await auction(guestId, { name: "L'asta altrui" });
    const token = await inviteFor(guestId, theirs);
    await joinAuction(ownerId, token, "Squadra Ospite");

    const list = await listUserAuctions(ownerId);
    const names = list.map((row) => row.name).sort();
    expect(names).toEqual(["L'asta altrui", "La mia asta"]);

    const own = list.find((row) => row.id === mine)!;
    expect(own.isOwner).toBe(true);
    expect(own.isMember).toBe(false);

    const joined = list.find((row) => row.id === theirs)!;
    expect(joined.isOwner).toBe(false);
    expect(joined.isMember).toBe(true);
    expect(joined.teamName).toBe("Squadra Ospite");
  });
});
