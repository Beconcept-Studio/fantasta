import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  registerWithPassword,
  upsertGoogleUser,
  verifyEmail,
} from "@/lib/engine/accounts";
import { verifyPassword } from "@/lib/engine/password";

import { closeDatabase, databaseAvailable, dropUsers } from "./helpers";

/**
 * L'identità contro un Postgres vero (M5).
 *
 * Metà di ciò che va verificato qui **è** il database: l'indice `UNIQUE` su
 * `lower(email)`, il fatto che l'aggancio non crei una seconda riga, il
 * `password_hash` che si azzera. Un mock direbbe sempre di sì.
 */

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn(
    "\n⚠ Postgres non raggiungibile: i test di identità sono saltati.\n" +
      "  Avvia il database con `docker compose up -d` e rilancia `pnpm test`.\n",
  );
}

const suite = dbUp ? describe : describe.skip;

/**
 * Le righe create da tutto il file, portate via una volta sola alla fine.
 *
 * Un `beforeEach` che azzerasse questa lista perderebbe gli id dei test
 * precedenti, e un `afterAll` per `describe` chiuderebbe il pool addosso ai
 * `describe` successivi: entrambe le versioni "ordinate" lasciano dietro
 * spazzatura o rompono il file. Una lista, un teardown.
 */
const created: string[] = [];

async function rowsWithEmail(email: string) {
  return db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`);
}

/** Un indirizzo diverso per ogni test: i file girano in worker paralleli. */
function freshEmail(label: string): string {
  return `${label}.${crypto.randomUUID()}@test.invalid`;
}

async function register(email: string, password = "password-lunga-1") {
  const result = await registerWithPassword({ email, password });
  if (!result.ok) throw new Error(result.error.message);
  created.push(result.value.userId);
  return result.value;
}

afterAll(async () => {
  if (!dbUp) return;
  await dropUsers(created);
  await closeDatabase();
});

suite("identità — l'aggancio Google e il furto d'account (M5 §2)", () => {
  /**
   * ⚠ **Il furto d'account che la macro esiste per chiudere.**
   *
   * L'attacco, per esteso, perché una regola senza il suo attacco accanto è una
   * riga che il prossimo semplifica:
   *
   * 1. Un malintenzionato scrive **il tuo** indirizzo su `/signup`, con una
   *    password sua.
   * 2. Non inserisce il codice: non gli arriva, e non gli serve. La riga esiste,
   *    non verificata, col suo hash dentro.
   * 3. Tu entri da Google con quell'indirizzo, e noi ti agganciamo a quella riga
   *    invece di crearne una seconda — che è proprio ciò che vogliamo fare.
   * 4. Da quel momento **lui ha la tua password**: ha fatto la parte facile e ha
   *    lasciato a te quella difficile.
   *
   * La regola che lo chiude: un aggancio su una riga **non verificata** azzera
   * `password_hash`. Chi entra da Google ha dimostrato di avere la casella;
   * quella password l'ha scritta qualcuno che non ha dimostrato niente.
   */
  it("un aggancio su una riga NON verificata azzera password_hash", async () => {
    const email = freshEmail("vittima");
    const attackerPassword = "password-del-ladro-1";
    const { userId } = await register(email, attackerPassword);

    // La riga esiste, non verificata, con dentro l'hash della password altrui.
    const before = (await rowsWithEmail(email))[0];
    expect(before.emailVerifiedAt).toBeNull();
    expect(await verifyPassword(attackerPassword, before.passwordHash)).toBe(
      true,
    );

    // Adesso entri tu da Google, con lo stesso indirizzo.
    const hooked = await upsertGoogleUser({
      googleSub: `google-sub-${crypto.randomUUID()}`,
      email,
      emailVerified: true,
      avatarUrl: null,
    });
    expect(hooked.ok).toBe(true);

    const rows = await rowsWithEmail(email);
    // Una persona, una riga: l'aggancio non ne crea una seconda.
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(userId);
    expect(rows[0].googleSub).not.toBeNull();

    // E la password del ladro non entra più.
    expect(rows[0].passwordHash).toBeNull();
    expect(await verifyPassword(attackerPassword, rows[0].passwordHash)).toBe(
      false,
    );
  });

  /**
   * L'altra metà della regola, ed è quella che le impedisce di essere solo
   * «Google cancella le password»: se la riga **era già verificata**, le due
   * prove ci sono entrambe e restano entrambe le strade.
   */
  it("un aggancio su una riga GIÀ verificata lascia la password intatta", async () => {
    const email = freshEmail("legittimo");
    const password = "la-mia-password-1";
    const { userId } = await register(email, password);

    // Questa volta il codice lo inserisce chi di dovere: la riga è verificata.
    await db
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(users.id, userId));

    const hooked = await upsertGoogleUser({
      googleSub: `google-sub-${crypto.randomUUID()}`,
      email,
      emailVerified: true,
      avatarUrl: null,
    });
    expect(hooked.ok).toBe(true);

    const rows = await rowsWithEmail(email);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(userId);
    expect(rows[0].googleSub).not.toBeNull();

    // Due strade, un account.
    expect(await verifyPassword(password, rows[0].passwordHash)).toBe(true);
  });

  /**
   * Il codice vivo al momento dell'aggancio è del ladro quanto la password:
   * lasciarlo valido vorrebbe dire lasciargli in mano il modo di verificare la
   * riga subito dopo, e con essa il tempo per rimetterci una password.
   */
  it("l'aggancio consuma i codici ancora vivi", async () => {
    const email = freshEmail("codici");
    const { userId } = await register(email);

    await upsertGoogleUser({
      googleSub: `google-sub-${crypto.randomUUID()}`,
      email,
      emailVerified: true,
      avatarUrl: null,
    });

    const rows = await db.query.emailCodes.findMany({
      where: (codes, { eq: is }) => is(codes.userId, userId),
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.consumedAt !== null)).toBe(true);
  });

  /**
   * Google senza `email_verified` non entra: non possiamo agganciare per email,
   * e agganciare su un'asserzione debole vale meno che chiudere la porta.
   */
  it("Google senza email verificata viene rifiutato", async () => {
    const email = freshEmail("nonverificato");
    const hooked = await upsertGoogleUser({
      googleSub: `google-sub-${crypto.randomUUID()}`,
      email,
      emailVerified: false,
      avatarUrl: null,
    });

    expect(hooked.ok).toBe(false);
    expect(await rowsWithEmail(email)).toHaveLength(0);
  });

  /**
   * L'email non si riscrive più a ogni login (§2): con il `UNIQUE` addosso, il
   * giorno in cui un account Google cambia indirizzo verso uno già preso da
   * un'altra riga quell'`UPDATE` fallirebbe, e il login diventerebbe un 500
   * senza spiegazione.
   */
  it("un secondo login Google non riscrive l'email", async () => {
    const googleSub = `google-sub-${crypto.randomUUID()}`;
    const first = freshEmail("stabile");
    const created1 = await upsertGoogleUser({
      googleSub,
      email: first,
      emailVerified: true,
      avatarUrl: null,
    });
    expect(created1.ok).toBe(true);
    if (created1.ok) created.push(created1.value.id);

    const second = freshEmail("cambiata");
    const again = await upsertGoogleUser({
      googleSub,
      email: second,
      emailVerified: true,
      avatarUrl: null,
    });
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.value.id).toBe(created1.ok ? created1.value.id : "");
      expect(again.value.email).toBe(first);
    }
    expect(await rowsWithEmail(second)).toHaveLength(0);
  });

});

suite("identità — l'email è la chiave (M5 §2)", () => {
  it("il UNIQUE parziale rifiuta due righe con la stessa email", async () => {
    const email = freshEmail("unico");
    await register(email);

    await expect(
      db.insert(users).values({ email: email.toUpperCase() }),
    ).rejects.toThrow();
  });

  it("le righe senza email restano legali e non collidono", async () => {
    const [a] = await db
      .insert(users)
      .values({ displayName: "Senza email A" })
      .returning({ id: users.id });
    const [b] = await db
      .insert(users)
      .values({ displayName: "Senza email B" })
      .returning({ id: users.id });
    created.push(a.id, b.id);
    expect(a.id).not.toBe(b.id);
  });

  it("registrarsi su un indirizzo già di Google viene rifiutato", async () => {
    const email = freshEmail("digoogle");
    const hooked = await upsertGoogleUser({
      googleSub: `google-sub-${crypto.randomUUID()}`,
      email,
      emailVerified: true,
      avatarUrl: null,
    });
    if (hooked.ok) created.push(hooked.value.id);

    const result = await registerWithPassword({
      email,
      password: "password-lunga-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("EMAIL_IS_GOOGLE");
    expect(await rowsWithEmail(email)).toHaveLength(1);
  });

  it("la registrazione normalizza l'indirizzo: trim e lower, e nient'altro", async () => {
    const email = freshEmail("Maiuscole");
    await register(`  ${email.toUpperCase()}  `);

    const rows = await rowsWithEmail(email);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(email.toLowerCase());
  });
});

suite("identità — il codice di verifica (M5 §4)", () => {
  it("un codice sbagliato non verifica, e dopo cinque il codice è bruciato", async () => {
    const { userId } = await register(freshEmail("tentativi"));

    for (let i = 1; i <= 5; i += 1) {
      const wrong = await verifyEmail(userId, "000000".slice(0, 5) + i);
      expect(wrong.ok).toBe(false);
    }
    const sixth = await verifyEmail(userId, "123456");
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) expect(sixth.error.code).toBe("CODE_BURNED");

    const [row] = await rowsWithEmail(
      (await db.query.users.findFirst({ where: eq(users.id, userId) }))!.email!,
    );
    expect(row.emailVerifiedAt).toBeNull();
  });
});
