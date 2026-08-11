import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * `@/lib/auth` è finto per una ragione sola, la stessa del test I8: fuori da una
 * richiesta vera non esiste una sessione, e `requireAppAdmin()` la legge da
 * Auth.js. Il finto riproduce ciò che la guardia fa davvero a chi non è
 * amministratore — **interrompe**, come fa `redirect()` — e serve a provare che
 * ogni server action **la chiama**. Tutto il resto qui è vero: Postgres, le
 * righe, i permessi riletti dal database.
 */
const REFUSED = new Error("requireAppAdmin: redirect");
vi.mock("@/lib/auth", () => ({
  requireAppAdmin: async () => {
    throw REFUSED;
  },
}));

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  forceVerifyEmail,
  setUserAdmin,
  setUserDisplayName,
} from "@/lib/engine/admin";

import { closeDatabase, databaseAvailable, dropUsers, makeUser } from "./helpers";

/**
 * M6 — il pannello di amministrazione, contro un Postgres vero.
 *
 * ⚠ **La cosa meno ovvia di questa macro, e quella che fa danno se la si
 * semplifica**: un layout non protegge le server action. Quelle sono endpoint
 * raggiungibili per conto proprio — un `POST` con l'id dell'azione dentro, senza
 * mai aprire una pagina del pannello — e un pannello protetto solo dal layout è
 * un pannello aperto. Per questo la guardia si prova **su due piani**, e i due
 * piani sono due `describe` distinti:
 *
 * 1. **la server action chiama la guardia prima di qualunque cosa** — la si
 *    chiama direttamente, con la guardia che rifiuta, e a database non cambia
 *    niente;
 * 2. **il motore rilegge `is_admin` dal database** — chiamato con l'id di un
 *    utente vero e non amministratore, rifiuta. È la difesa che resta in piedi
 *    anche se un giorno una server action nuova nascesse senza guardia.
 *
 * È il precedente che il progetto ha già scelto in M4: `fillWithBots` rilegge
 * `is_admin` dentro il lock anche se l'azione l'ha già verificato.
 */

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn(
    "\n⚠ Postgres non raggiungibile: i test del pannello sono saltati.\n" +
      "  Avvia il database con `docker compose up -d` e rilancia `pnpm test`.\n",
  );
}

const suite = dbUp ? describe : describe.skip;
const created: string[] = [];

afterAll(async () => {
  if (!dbUp) return;
  await dropUsers(created);
  await closeDatabase();
});

async function user(
  label: string,
  options: { isAdmin?: boolean; verified?: boolean } = {},
): Promise<string> {
  const id = await makeUser(label, options);
  created.push(id);
  return id;
}

function row(id: string) {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}

// ─── Piano 1: ogni server action ha la sua guardia ───────────────────────────

/**
 * Le action del pannello, enumerate dal modulo e non a mano.
 *
 * ⚠ È un'**uguaglianza esatta**, non un «almeno queste», per la stessa ragione
 * per cui in M5 la lista dei provider è confrontata per intero: il giorno in cui
 * qualcuno aggiunge un'azione al pannello, questo test si rompe e lo obbliga a
 * guardare in faccia la riga della guardia. Un test che dicesse «almeno queste
 * quattro» lascerebbe passare la quinta senza guardia, che è esattamente il bug
 * che stiamo prevenendo.
 *
 * Un modulo `"use server"` può esportare soltanto funzioni async: qui non c'è
 * niente da filtrare, ogni export è un'azione.
 */
const adminActions = await import("@/app/admin/actions");

suite("ogni server action del pannello rifiuta chi non è amministratore", () => {
  it("le azioni esportate sono esattamente quelle attese", () => {
    expect(Object.keys(adminActions).sort()).toEqual([
      "deleteAuctionAsAdminAction",
      "forceVerifyEmailAction",
      "setUserAdminAction",
      "setUserDisplayNameAction",
    ]);
  });

  it.each(Object.keys(adminActions))(
    "%s chiamata direttamente non passa la guardia",
    async (name) => {
      const action = (
        adminActions as unknown as Record<
          string,
          (prev: unknown, form: FormData) => Promise<unknown>
        >
      )[name];
      // La `FormData` è vuota di proposito: se la guardia sta davvero **in
      // cima**, l'azione si ferma prima di leggere un solo campo, e quindi
      // quello che c'è dentro non conta.
      await expect(action({ error: null }, new FormData())).rejects.toBe(
        REFUSED,
      );
    },
  );

  it("con la guardia che rifiuta, a database non cambia niente", async () => {
    const target = await user("guardia-target");
    const before = await row(target);

    const form = new FormData();
    form.set("userId", target);
    form.set("displayName", "Nome Riscritto");
    form.set("isAdmin", "true");

    for (const action of Object.values(adminActions)) {
      await expect(
        (action as (p: unknown, f: FormData) => Promise<unknown>)(
          { error: null },
          form,
        ),
      ).rejects.toBe(REFUSED);
    }

    expect(await row(target)).toEqual(before);
  });
});

// ─── Piano 2: il motore rilegge il permesso dal database ─────────────────────

suite("il motore rifiuta un attore che non è amministratore", () => {
  it("setUserDisplayName", async () => {
    const intruder = await user("intruso");
    const target = await user("bersaglio");

    const result = await setUserDisplayName(intruder, target, "Nome Nuovo");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_ADMIN");
    expect((await row(target))!.displayName).not.toBe("Nome Nuovo");
  });

  it("forceVerifyEmail", async () => {
    const intruder = await user("intruso");
    const target = await user("bersaglio");

    const result = await forceVerifyEmail(intruder, target);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_ADMIN");
    expect((await row(target))!.emailVerifiedAt).toBeNull();
  });

  it("setUserAdmin", async () => {
    const intruder = await user("intruso");
    const target = await user("bersaglio");

    const result = await setUserAdmin(intruder, target, true);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_ADMIN");
    expect((await row(target))!.isAdmin).toBe(false);
  });

  /**
   * Il caso peggiore: **un amministratore declassato che riprova**. La sessione
   * è un JWT (P17) e non sa niente di `is_admin`; se il motore si fidasse di
   * qualcosa che non è la riga a database, chi è stato tolto continuerebbe a
   * comandare fino alla scadenza del token.
   */
  it("un amministratore appena declassato non passa più", async () => {
    const actor = await user("ex-admin", { isAdmin: true });
    const target = await user("bersaglio");

    expect((await setUserDisplayName(actor, target, "Prima Va")).ok).toBe(true);

    await db.update(users).set({ isAdmin: false }).where(eq(users.id, actor));

    const after = await setUserDisplayName(actor, target, "Poi Non Va");
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error.code).toBe("NOT_ADMIN");
    expect((await row(target))!.displayName).toBe("Prima Va");
  });
});

// ─── Il divieto di chiudersi fuori ───────────────────────────────────────────

/**
 * §4 — **mai la propria**. Un click e ci chiudiamo fuori tutti, e senza pannello
 * non si rientra: l'unico rimedio sarebbe un `UPDATE` sul server, cioè
 * esattamente la finestra che questa macro è nata per chiudere.
 */
suite("is_admin non si tocca sulla propria riga", () => {
  it("togliersela è rifiutato, e lo dice", async () => {
    const actor = await user("admin-suicida", { isAdmin: true });

    const result = await setUserAdmin(actor, actor, false);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN");
      // «Lo dice invece di fallire in silenzio» (verifica 4): il messaggio è
      // già in italiano e va mostrato così com'è.
      expect(result.error.message.length).toBeGreaterThan(20);
    }
    expect((await row(actor))!.isAdmin).toBe(true);
  });

  it("nemmeno riconfermarsela, che sarebbe l'eccezione da cui il bug rientra", async () => {
    const actor = await user("admin-confuso", { isAdmin: true });

    const result = await setUserAdmin(actor, actor, true);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
  });

  it("su qualcun altro invece funziona, in entrambe le direzioni", async () => {
    const actor = await user("admin", { isAdmin: true });
    const target = await user("collega");

    expect((await setUserAdmin(actor, target, true)).ok).toBe(true);
    expect((await row(target))!.isAdmin).toBe(true);

    expect((await setUserAdmin(actor, target, false)).ok).toBe(true);
    expect((await row(target))!.isAdmin).toBe(false);
  });
});
