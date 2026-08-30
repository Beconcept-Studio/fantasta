import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * M13 §5 — il salvataggio del pannello utenti, contro un Postgres vero.
 *
 * ⚠ **Qui la guardia deve *passare*, ed è il motivo per cui questo file esiste
 * accanto a `admin.test.ts` invece che dentro.** Là `requireAppAdmin` è sostituita
 * con una che **interrompe sempre**, e serve a provare che ogni server action la
 * chiama in prima riga; quel finto non si può convivere con un test che vuole vedere
 * un salvataggio riuscire. Qui la sostituzione fa l'altra metà: restituisce **la
 * riga vera** dell'attore che il test ha scelto, senza guardare `is_admin`.
 *
 * Il che è precisamente ciò che rende onesto il test del non-amministratore: la
 * guardia lo lascia entrare, e a fermarlo resta soltanto il motore, che rilegge
 * `is_admin` dal database a ogni mutazione. È la difesa che sopravvive anche al
 * giorno in cui una server action nascesse senza guardia (P17: la sessione è un JWT
 * e non sa niente dei permessi).
 *
 * ⚠ **`next/cache` è sostituito perché `revalidatePath` fuori da una richiesta vera
 * non ha nessuno store da invalidare.** Non è la parte che si sta provando: che la
 * tabella si aggiorni è una verifica da fare col browser (M13-11), qui interessa
 * cosa è finito a database.
 */

const actor = vi.hoisted(() => ({ id: null as string | null }));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireAppAdmin: async () => {
    if (actor.id === null) throw new Error("il test non ha scelto un attore");
    // L'attore vero, letto dal database come lo leggerebbe `requireUser()`:
    // l'azione usa il suo `id` e il motore ci rilegge sopra il permesso.
    const { db } = await import("@/lib/db");
    const { users } = await import("@/lib/db/schema");
    const { eq: equals } = await import("drizzle-orm");
    const row = await db.query.users.findFirst({
      where: equals(users.id, actor.id),
    });
    if (row === undefined) throw new Error("l'attore del test non esiste");
    return row;
  },
}));

import { saveUserAction } from "@/app/admin/actions";
import { isVerified } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { EMPTY_USER_SAVE_STATE, type UserField } from "@/lib/admin-users";

import {
  closeDatabase,
  databaseAvailable,
  dropUsers,
  makeUser,
} from "./helpers";

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn(
    "\n⚠ Postgres non raggiungibile: i test del salvataggio utenti sono saltati.\n" +
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

async function bot(label: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ displayName: label, isBot: true })
    .returning({ id: users.id });
  created.push(row.id);
  return row.id;
}

function row(id: string) {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}

/** Il salvataggio come lo manda il pannello: **solo i campi cambiati**. */
async function save(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return saveUserAction(EMPTY_USER_SAVE_STATE, form);
}

/** L'esito di un campo, per non ripetere il `find` in ogni asserzione. */
function outcome(
  state: Awaited<ReturnType<typeof save>>,
  field: UserField,
): { ok: boolean; message: string } | undefined {
  return state.outcomes?.find((entry) => entry.field === field);
}

// ─── Il caso normale: solo ciò che è cambiato ────────────────────────────────

suite("il salvataggio scrive solo i campi che gli arrivano", () => {
  it("due campi su cinque: quelli sì, gli altri tre non li tocca", async () => {
    actor.id = await user("admin", { isAdmin: true });
    const target = await user("bersaglio");

    const state = await save({
      userId: target,
      displayName: "Nome Corretto",
      isPro: "true",
    });

    expect(state.error).toBeNull();
    expect(state.done).toBe(true);
    expect(state.outcomes).toHaveLength(2);

    const after = (await row(target))!;
    expect(after.displayName).toBe("Nome Corretto");
    expect(after.isPro).toBe(true);
    // ⚠ I tre che non erano nel form: nessuna `UPDATE` li ha sfiorati.
    expect(after.isAdmin).toBe(false);
    expect(after.statsPlus).toBe(false);
    expect(after.emailVerifiedAt).toBeNull();
  });

  it("nessun campo: non fa niente, e non è un errore", async () => {
    actor.id = await user("admin", { isAdmin: true });
    const target = await user("bersaglio");
    const before = await row(target);

    const state = await save({ userId: target });

    expect(state.error).toBeNull();
    expect(state.done).toBe(true);
    expect(state.outcomes).toBeUndefined();
    expect(await row(target)).toEqual(before);
  });

  it("senza utente non prova nemmeno", async () => {
    actor.id = await user("admin", { isAdmin: true });

    const state = await save({ displayName: "Nessuno" });

    expect(state.error).toBe("Utente non indicato.");
    expect(state.done).toBeUndefined();
  });

  /**
   * ⚠ La verifica passa dall'azione nuova e **fa passare davvero il gradino di
   * `requireUser()`**, non solo scrive la colonna: è il punto di M5 §9, e con
   * `isVerified` autentico — una copia del predicato scritta nel test proverebbe che
   * la colonna è scritta, non che la persona entra.
   */
  it("la verifica a mano fa passare il gradino di requireUser()", async () => {
    actor.id = await user("admin", { isAdmin: true });
    const target = await user("non-verificato");
    expect(isVerified((await row(target))!)).toBe(false);

    const state = await save({ userId: target, verify: "1" });

    expect(state.done).toBe(true);
    expect(outcome(state, "verified")?.ok).toBe(true);
    expect(isVerified((await row(target))!)).toBe(true);
  });

  it("i flag si spengono come si accendono", async () => {
    actor.id = await user("admin", { isAdmin: true });
    const target = await user("bersaglio");

    expect(
      (
        await save({
          userId: target,
          isAdmin: "true",
          isPro: "true",
          statsPlus: "true",
        })
      ).done,
    ).toBe(true);
    const acceso = (await row(target))!;
    expect([acceso.isAdmin, acceso.isPro, acceso.statsPlus]).toEqual([
      true,
      true,
      true,
    ]);

    expect(
      (
        await save({
          userId: target,
          isAdmin: "false",
          isPro: "false",
          statsPlus: "false",
        })
      ).done,
    ).toBe(true);
    const spento = (await row(target))!;
    expect([spento.isAdmin, spento.isPro, spento.statsPlus]).toEqual([
      false,
      false,
      false,
    ]);
  });

  /**
   * M22 §6 — **`stats_plus` si scrive indipendentemente da `is_pro`**, e il test
   * lo fissa perché la tentazione di legarli è forte e sbagliata.
   *
   * Legare le due scritture vorrebbe dire decidere che cosa succede al flag
   * quando si spegne il Pro, e ogni risposta a quella domanda è una sorpresa per
   * chi la subisce: spegnerlo perde un'assegnazione che nessuno ha revocato,
   * lasciarlo acceso fa credere di averlo tolto. I due flag si combinano al
   * momento della **lettura** (`canSeeStatsPlus`), non della scrittura.
   */
  it("⚠ Stats+ si accende anche senza Pro: è la lettura a metterli insieme, non la scrittura", async () => {
    actor.id = await user("admin", { isAdmin: true });
    const target = await user("bersaglio");

    expect((await save({ userId: target, statsPlus: "true" })).done).toBe(true);
    const after = (await row(target))!;
    expect([after.isPro, after.statsPlus]).toEqual([false, true]);
  });

  /**
   * ⚠ **La propria riga si può toccare, ed è il caso che sblocca il rilascio**
   * (M22 §6.2): l'amministratore non ha Stats+ implicito, quindi se non potesse
   * accenderselo non vedrebbe mai la funzione appena messa in produzione — e in
   * un'installazione con un amministratore solo non potrebbe farlo nessun altro.
   */
  it("⚠ un amministratore accende Stats+ a se stesso", async () => {
    actor.id = await user("admin", { isAdmin: true });

    expect(
      (await save({ userId: actor.id, statsPlus: "true" })).done,
    ).toBe(true);
    expect((await row(actor.id))!.statsPlus).toBe(true);
  });
});

// ─── Il salvataggio che riesce a metà ───────────────────────────────────────

/**
 * ⚠ **La parte che questa macro può sbagliare più delle altre** (§5). Quattro
 * `UPDATE` distinti non sono una transazione: un salvataggio può riuscire a metà, e
 * la UI non deve far finta del contrario. Il patto è: esito **per campo**, `done`
 * solo se tutto è passato — ed è `done` l'unica cosa su cui il modale si chiude.
 */
suite("un salvataggio rifiutato a metà lo dice campo per campo", () => {
  it("il nome fuori dai 3–60 caratteri cade, e il flag valido passa comunque", async () => {
    actor.id = await user("admin", { isAdmin: true });
    const target = await user("bersaglio");
    const nomeDiPrima = (await row(target))!.displayName;

    const state = await save({
      userId: target,
      displayName: "ab",
      isPro: "true",
    });

    // Il modale resta aperto: `done` non è `true`.
    expect(state.done).toBe(false);
    expect(state.error).not.toBeNull();
    expect(outcome(state, "displayName")?.ok).toBe(false);
    expect(outcome(state, "isPro")?.ok).toBe(true);

    const after = (await row(target))!;
    expect(after.displayName).toBe(nomeDiPrima);
    expect(after.isPro).toBe(true);
  });

  /**
   * §5 — sulla propria riga il pannello **non offre** lo switch di `is_admin`, ma il
   * server rifiuta comunque (regola 6). E il nome nello stesso salvataggio si scrive:
   * è di nuovo l'esito per campo, non tutto-o-niente.
   */
  it("is_admin sulla propria riga è rifiutato, e il resto del form passa", async () => {
    const self = await user("admin-che-si-tocca", { isAdmin: true });
    actor.id = self;

    const state = await save({
      userId: self,
      displayName: "Mi Rinomino",
      isAdmin: "false",
    });

    expect(state.done).toBe(false);
    expect(outcome(state, "isAdmin")?.ok).toBe(false);
    expect(outcome(state, "isAdmin")?.message.length).toBeGreaterThan(20);
    expect(outcome(state, "displayName")?.ok).toBe(true);

    const after = (await row(self))!;
    expect(after.isAdmin).toBe(true);
    expect(after.displayName).toBe("Mi Rinomino");
  });

  it("su un bot i tre comandi sono tutti rifiutati", async () => {
    actor.id = await user("admin", { isAdmin: true });
    const target = await bot("Bot 3");
    const before = await row(target);

    const state = await save({
      userId: target,
      verify: "1",
      isAdmin: "true",
      isPro: "true",
    });

    expect(state.done).toBe(false);
    expect(state.outcomes?.every((entry) => !entry.ok)).toBe(true);
    expect(await row(target)).toEqual(before);
  });

  it.each([
    ["un uuid che non esiste", crypto.randomUUID()],
    // ⚠ Non è pedanteria: `findFirst` con una stringa che non è un uuid fa alzare
    // a Postgres un `22P02`, cioè un 500 al posto di un rifiuto previsto.
    ["una stringa che non è nemmeno un uuid", "non-un-uuid"],
  ])("%s è rifiutato senza esplodere", async (_label, userId) => {
    actor.id = await user("admin", { isAdmin: true });

    const state = await save({ userId, displayName: "Nome Valido", isPro: "true" });

    expect(state.done).toBe(false);
    expect(state.outcomes?.every((entry) => !entry.ok)).toBe(true);
  });

  it("un flag che non è né «true» né «false» è rifiutato", async () => {
    actor.id = await user("admin", { isAdmin: true });
    const target = await user("bersaglio");

    const state = await save({ userId: target, isAdmin: "forse" });

    expect(state.done).toBe(false);
    expect(outcome(state, "isAdmin")?.ok).toBe(false);
    expect((await row(target))!.isAdmin).toBe(false);
  });
});

// ─── Il non-amministratore, con la guardia che lo lascia entrare ─────────────

/**
 * ⚠ **È la verifica che il layout non protegge nessuno** (M13, verifica 11). Qui la
 * guardia è sostituita da una che passa: chi ferma questa chiamata è soltanto la
 * rilettura di `is_admin` dentro `lib/engine/admin.ts`.
 */
suite("chi non è amministratore non scrive niente dall'azione nuova", () => {
  it("tutti i campi sono rifiutati, e a database non cambia niente", async () => {
    const intruder = await user("intruso");
    actor.id = intruder;
    const target = await user("bersaglio");
    const before = await row(target);

    const state = await save({
      userId: target,
      displayName: "Riscritto Da Un Intruso",
      verify: "1",
      isAdmin: "true",
      isPro: "true",
    });

    expect(state.done).toBe(false);
    expect(state.outcomes).toHaveLength(4);
    expect(state.outcomes?.every((entry) => !entry.ok)).toBe(true);
    expect(await row(target)).toEqual(before);
  });

  it("un amministratore appena declassato non salva più", async () => {
    const ex = await user("ex-admin", { isAdmin: true });
    actor.id = ex;
    const target = await user("bersaglio");

    expect((await save({ userId: target, displayName: "Prima Va" })).done).toBe(
      true,
    );

    await db.update(users).set({ isAdmin: false }).where(eq(users.id, ex));

    const state = await save({ userId: target, displayName: "Poi Non Va" });

    expect(state.done).toBe(false);
    expect((await row(target))!.displayName).toBe("Prima Va");
  });
});
