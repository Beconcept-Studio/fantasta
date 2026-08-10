import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * L'unico modo di leggere un codice in chiaro è intercettarlo dove esce: da
 * `sendCode`. Non c'è nessuna via per rileggerlo dal database — a database c'è
 * uno sha256 — ed è esattamente la proprietà che questo mock conferma invece di
 * aggirare.
 */
const sent: { to: string; code: string; purpose: string }[] = [];
vi.mock("@/lib/mail", () => ({
  sendCode: async (mail: { to: string; code: string; purpose: string }) => {
    sent.push(mail);
  },
}));

import { db } from "@/lib/db";
import { emailCodes, users } from "@/lib/db/schema";
import {
  registerWithPassword,
  requestPasswordReset,
  resendVerificationCode,
  resetPassword,
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

/** L'ultimo codice partito verso quell'indirizzo, come lo legge chi lo riceve. */
function lastCodeTo(email: string, purpose: string): string {
  const found = [...sent]
    .reverse()
    .find((m) => m.to === email.toLowerCase() && m.purpose === purpose);
  if (!found) throw new Error(`Nessun codice ${purpose} mandato a ${email}.`);
  return found.code;
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
  it("il codice giusto verifica, e non si può riusare", async () => {
    const email = freshEmail("verifica");
    const { userId } = await register(email);
    const code = lastCodeTo(email, "VERIFY_EMAIL");

    expect((await verifyEmail(userId, code)).ok).toBe(true);
    const row = (await rowsWithEmail(email))[0];
    expect(row.emailVerifiedAt).not.toBeNull();

    // Riusarlo non fallisce con «codice non valido»: chi è già verificato ha
    // già finito, e un doppio invio del form non deve spaventarlo.
    expect((await verifyEmail(userId, code)).ok).toBe(true);
  });

  /**
   * ⚠ Venti reinvii non devono diventare venti chiavi valide, né lasciare la
   * persona a chiedersi quale delle venti email sia quella giusta: vale
   * l'ultima, sempre.
   */
  it("un codice nuovo consuma il precedente", async () => {
    const email = freshEmail("reinvio");
    const { userId } = await register(email);
    const first = lastCodeTo(email, "VERIFY_EMAIL");

    // Il reinvio è rifiutato prima di sessanta secondi: il limite vive nel
    // `created_at` della tabella, quindi si sposta `now` invece di aspettare.
    const now = new Date();
    const tooSoon = await resendVerificationCode(userId, now);
    expect(tooSoon.ok).toBe(false);
    if (!tooSoon.ok) expect(tooSoon.error.code).toBe("RESEND_TOO_SOON");

    const later = new Date(now.getTime() + 61_000);
    expect((await resendVerificationCode(userId, later)).ok).toBe(true);
    const second = lastCodeTo(email, "VERIFY_EMAIL");
    expect(second).not.toBe(first);

    // Il primo non vale più.
    const stale = await verifyEmail(userId, first, later);
    expect(stale.ok).toBe(false);
    // E il secondo sì.
    expect((await verifyEmail(userId, second, later)).ok).toBe(true);
  });

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

suite("identità — il recupero della password (M5 §4)", () => {
  it("il giro completo: codice, password nuova, e la vecchia non entra più", async () => {
    const email = freshEmail("recupero");
    const { userId } = await register(email, "vecchia-password-1");

    expect((await requestPasswordReset(email)).ok).toBe(true);
    const code = lastCodeTo(email, "RESET_PASSWORD");

    const done = await resetPassword({
      email,
      code,
      password: "nuova-password-1",
    });
    expect(done.ok).toBe(true);

    const row = (await db.query.users.findFirst({
      where: eq(users.id, userId),
    }))!;
    expect(await verifyPassword("nuova-password-1", row.passwordHash)).toBe(true);
    expect(await verifyPassword("vecchia-password-1", row.passwordHash)).toBe(
      false,
    );
  });

  /**
   * Un account di solo Google non se la vede creare dal nulla: sarebbe la
   * direzione Google → password di §2 per un'altra strada.
   */
  it("è rifiutato su un account di solo Google", async () => {
    const email = freshEmail("solo-google");
    const hooked = await upsertGoogleUser({
      googleSub: `google-sub-${crypto.randomUUID()}`,
      email,
      emailVerified: true,
      avatarUrl: null,
    });
    if (hooked.ok) created.push(hooked.value.id);

    const asked = await requestPasswordReset(email);
    expect(asked.ok).toBe(false);
    if (!asked.ok) {
      expect(asked.error.code).toBe("EMAIL_IS_GOOGLE");
      expect(asked.error.message).toMatch(/Google/);
    }

    const forced = await resetPassword({
      email,
      code: "123456",
      password: "password-lunga-1",
    });
    expect(forced.ok).toBe(false);
  });

  /**
   * La password si valida **prima** di consumare il codice: chi ne sceglie una
   * troppo corta non deve perdere il codice appena ricevuto e ricominciare.
   */
  it("una password troppo corta non brucia il codice", async () => {
    const email = freshEmail("cortapass");
    await register(email);
    await requestPasswordReset(email);
    const code = lastCodeTo(email, "RESET_PASSWORD");

    const tooShort = await resetPassword({ email, code, password: "corta" });
    expect(tooShort.ok).toBe(false);
    if (!tooShort.ok) expect(tooShort.error.code).toBe("INVALID_PASSWORD");

    // Il codice è ancora buono.
    const retry = await resetPassword({
      email,
      code,
      password: "abbastanza-lunga-1",
    });
    expect(retry.ok).toBe(true);
  });

  it("il reset non tocca email_verified_at: chi non era verificato passa da /verify", async () => {
    const email = freshEmail("nonverif");
    const { userId } = await register(email);
    await requestPasswordReset(email);

    await resetPassword({
      email,
      code: lastCodeTo(email, "RESET_PASSWORD"),
      password: "nuova-password-1",
    });

    const row = (await db.query.users.findFirst({
      where: eq(users.id, userId),
    }))!;
    expect(row.emailVerifiedAt).toBeNull();
    // E il codice di verifica è una macchina a parte: il cooldown del reset
    // non gli si applica, perché i due `purpose` si contano separatamente.
    const codes = await db
      .select()
      .from(emailCodes)
      .where(eq(emailCodes.userId, userId));
    expect(codes.some((c) => c.purpose === "VERIFY_EMAIL")).toBe(true);
    expect(codes.some((c) => c.purpose === "RESET_PASSWORD")).toBe(true);
  });
});

suite("identità — il backfill del deploy (M5 §10)", () => {
  /**
   * ⚠ **La riga di `psql` che si dà sul server, collaudata qui.**
   *
   * `pnpm db:push` crea la colonna ma non la riempie: in produzione ogni account
   * è entrato da Google e nessuno ha `email_verified_at`, quindi senza questa
   * `UPDATE` il primo caricamento dopo il deploy manderebbe **tutti** gli utenti
   * esistenti sulla schermata del codice, owner compreso. Ne uscirebbero — il
   * codice arriva davvero — ma è un incidente evitabile con una riga.
   *
   * Il test esiste perché quella riga, fino a M5, era soltanto scritta in un
   * documento: nessuno l'aveva mai eseguita prima di digitarla sul server, di
   * sera, con l'asta alle porte.
   *
   * ⚠ Il `WHERE` porta un filtro sull'email che **non** è nel comando vero: qui
   * serve a non toccare le righe degli altri file di test, che girano in worker
   * paralleli sullo stesso database. Ciò che il test verifica è il resto della
   * condizione — chi viene toccato e chi no.
   */
  it("verifica le righe di Google e non tocca quelle nate da M5", async () => {
    const marca = crypto.randomUUID();
    const vecchio = `vecchio.${marca}@backfill.test`;
    const nuovo = `nuovo.${marca}@backfill.test`;
    const giaVerificato = `verificato.${marca}@backfill.test`;
    const primaDi = new Date("2020-01-01T00:00:00.000Z");

    const righe = await db
      .insert(users)
      .values([
        // Com'è oggi in produzione: entrata da Google, prima che la colonna esistesse.
        {
          googleSub: `backfill-${marca}`,
          email: vecchio,
          displayName: "Utente Di Ieri",
          createdAt: primaDi,
        },
        // Nata da M5: password, mai verificata. Non deve essere toccata.
        { email: nuovo, passwordHash: "scrypt$32768$8$1$AAA$BBB" },
        // Già verificata: il timestamp vero non deve essere riscritto.
        {
          googleSub: `backfill-ok-${marca}`,
          email: giaVerificato,
          emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
          createdAt: primaDi,
        },
      ])
      .returning({ id: users.id });
    created.push(...righe.map((r) => r.id));

    await db.execute(sql`
      UPDATE users SET email_verified_at = created_at
      WHERE google_sub IS NOT NULL
        AND email_verified_at IS NULL
        AND email LIKE ${`%${marca}@backfill.test`}
    `);

    const dopo = new Map(
      (
        await db
          .select({ email: users.email, verificato: users.emailVerifiedAt })
          .from(users)
          .where(sql`${users.email} LIKE ${`%${marca}@backfill.test`}`)
      ).map((r) => [r.email, r.verificato]),
    );

    // Chi c'era già entra senza passare da /verify.
    expect(dopo.get(vecchio)?.toISOString()).toBe(primaDi.toISOString());
    // Chi si è registrato con una password e non ha verificato, resta fuori.
    expect(dopo.get(nuovo)).toBeNull();
    // E il comando è ripetibile: un timestamp vero non viene sovrascritto.
    expect(dopo.get(giaVerificato)?.toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });
});
