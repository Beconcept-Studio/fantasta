import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { type User, emailCodes, users } from "@/lib/db/schema";
import {
  type CodePurpose,
  isPlausibleEmail,
  normalizeEmail,
} from "@/lib/domain";
import { sendCode } from "@/lib/mail";

import {
  CODE_DIGITS,
  checkCodeUsable,
  checkResendAllowed,
  codeExpiresAt,
  wrongCodeMessage,
} from "./account-rules";
import { type Result, fail, ok } from "./errors";
import { hashPassword, validatePassword, verifyPassword } from "./password";

/**
 * Registrazione, verifica dell'indirizzo e recupero della password (M5).
 *
 * Sta in `lib/engine` perché tocca `lib/db`, e la regola ESLint su `lib/db` non
 * ammette eccezioni discrezionali: le pagine e le server action passano da qui.
 *
 * Le **decisioni** — scaduto? bruciato? può reinviare? — non sono qui: stanno in
 * `account-rules.ts`, che non importa niente e riceve `now` come parametro.
 * Questo file fa il resto: legge, scrive, e manda l'email.
 */

// ─── I codici a sei cifre ────────────────────────────────────────────────────

/**
 * Sei cifre da `randomInt`, che è il generatore crittografico di Node e non
 * `Math.random()`. Il padding a sinistra non è cosmetico: senza, `000123`
 * diventerebbe `123` e chi lo digita come sta scritto nell'email sbaglierebbe.
 */
function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, "0");
}

/**
 * ⚠ **Questo sha256 non è una difesa, e va detto.** Con sei cifre l'entropia è
 * un milione: chi ha in mano il database rompe l'hash in un secondo, senza
 * nemmeno una tabella precalcolata. Serve a un'altra cosa — **non lasciare
 * credenziali vive dentro un `pg_dump`**, in una riga di log, nello screenshot
 * di una tabella aperta per guardare altro.
 *
 * Le difese vere sono tre righe più in là: quindici minuti di scadenza, cinque
 * tentativi, e un codice nuovo che consuma il precedente.
 */
function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Confronto a tempo costante fra due hash esadecimali della stessa lunghezza. */
function sameHash(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Emette un codice nuovo, **consumando quello vivo di prima**.
 *
 * È la riga che impedisce a venti reinvii di diventare venti chiavi valide — e
 * che toglie a chi li ha ricevuti la domanda «quale delle venti email è quella
 * giusta»: vale l'ultima, sempre.
 *
 * Ritorna il codice **in chiaro**, che da qui esce solo verso `sendCode`: non
 * finisce in nessuna risposta HTTP, in nessun ambiente.
 */
async function issueCode(
  userId: string,
  purpose: CodePurpose,
  now: Date,
): Promise<string> {
  const code = generateCode();

  await db.transaction(async (tx) => {
    await tx
      .update(emailCodes)
      .set({ consumedAt: now })
      .where(
        and(
          eq(emailCodes.userId, userId),
          eq(emailCodes.purpose, purpose),
          isNull(emailCodes.consumedAt),
        ),
      );
    await tx.insert(emailCodes).values({
      userId,
      purpose,
      codeHash: hashCode(code),
      expiresAt: codeExpiresAt(now),
      createdAt: now,
    });
  });

  return code;
}

/** Il codice ancora vivo per questo scopo, o `null`. Al massimo ce n'è uno. */
async function liveCode(userId: string, purpose: CodePurpose) {
  return (
    (await db.query.emailCodes.findFirst({
      where: and(
        eq(emailCodes.userId, userId),
        eq(emailCodes.purpose, purpose),
        isNull(emailCodes.consumedAt),
      ),
      orderBy: [desc(emailCodes.createdAt)],
    })) ?? null
  );
}

/**
 * Quando è partito l'ultimo codice per questo scopo, **consumato o no**.
 *
 * Il «consumato o no» è il punto: il limite sul reinvio deve contare gli invii,
 * e ogni reinvio consuma il precedente. Guardare solo i vivi vorrebbe dire non
 * contarne mai più di uno, cioè non limitare niente.
 */
async function lastCodeSentAt(
  userId: string,
  purpose: CodePurpose,
): Promise<Date | null> {
  const row = await db.query.emailCodes.findFirst({
    where: and(eq(emailCodes.userId, userId), eq(emailCodes.purpose, purpose)),
    orderBy: [desc(emailCodes.createdAt)],
    columns: { createdAt: true },
  });
  return row?.createdAt ?? null;
}

// ─── Trovare una persona ─────────────────────────────────────────────────────

/**
 * La riga di un indirizzo, cercata come la cerca l'indice: su `lower(email)`.
 *
 * ⚠ La query **deve** usare la stessa espressione dell'indice
 * `users_email_lower_unique`, altrimenti Postgres non lo userebbe e — peggio —
 * il codice e il vincolo non parlerebbero più della stessa cosa.
 */
export async function findUserByEmail(email: string): Promise<User | null> {
  const normalized = normalizeEmail(email);
  if (normalized === "") return null;
  const rows = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${normalized}`)
    .limit(1);
  return rows[0] ?? null;
}

// ─── Registrazione ───────────────────────────────────────────────────────────

export type RegisterInput = { email: unknown; password: unknown };

/**
 * Crea un account con email e password, e prova a mandare il codice.
 *
 * ⚠ **L'ordine è: si crea l'utente, poi si prova a mandare.** Un invio fallito
 * lascia un account esistente e non verificato, e la schermata successiva è
 * quella di sempre — «inserisci il codice», col pulsante per rimandarlo. Un
 * errore di rete non deve mai perdere una registrazione, né bruciare un
 * indirizzo, né far riscrivere la password a chi l'aveva già scritta. Per
 * questo `mailSent: false` è un valore di ritorno e non un errore.
 *
 * L'indirizzo già preso si rifiuta con **due messaggi diversi**, e non è una
 * dimenticanza: `docs/DECISIONS.md` dice che dall'enumerazione degli account
 * non ci difendiamo. Dire «questo indirizzo entra con Google» è utile a chi lo
 * legge, e ciò che protegge non è il silenzio — è la password.
 */
export async function registerWithPassword(
  input: RegisterInput,
  now: Date = new Date(),
): Promise<Result<{ userId: string; email: string; mailSent: boolean }>> {
  if (typeof input.email !== "string") {
    return fail("INVALID_EMAIL", "Scrivi il tuo indirizzo email.");
  }
  const email = normalizeEmail(input.email);
  if (!isPlausibleEmail(email)) {
    return fail("INVALID_EMAIL", "Questo indirizzo email non sembra valido.");
  }

  const password = validatePassword(input.password);
  if (!password.ok) return password;

  const existing = await findUserByEmail(email);
  if (existing) {
    // La direzione Google → email+password è **chiusa** (§2): aggiungere una
    // password a un account nato da Google sarebbe un reset travestito.
    if (existing.googleSub !== null) {
      return fail(
        "EMAIL_IS_GOOGLE",
        "Questo indirizzo è già registrato con Google: entra da lì.",
      );
    }
    return fail(
      "EMAIL_TAKEN",
      "Questo indirizzo è già registrato. Entra con la tua password, oppure usa «Password dimenticata».",
    );
  }

  const passwordHash = await hashPassword(password.value);

  let userId: string;
  try {
    const [row] = await db
      .insert(users)
      .values({ email, passwordHash })
      .returning({ id: users.id });
    userId = row.id;
  } catch {
    // Due registrazioni sullo stesso indirizzo nello stesso istante: il
    // controllo qui sopra le fa passare entrambe, l'indice UNIQUE ne ferma una.
    // È esattamente il motivo per cui il vincolo sta a database e non solo in
    // una `if` — qui non resta che tradurre il rifiuto in una frase.
    return fail(
      "EMAIL_TAKEN",
      "Questo indirizzo è già registrato. Entra con la tua password, oppure usa «Password dimenticata».",
    );
  }

  const mailSent = await deliverCode(userId, email, "VERIFY_EMAIL", now);
  return ok({ userId, email, mailSent });
}

/**
 * Emette e manda, e **non lancia se la posta non parte**.
 *
 * Chi chiama ha già scritto a database tutto ciò che non deve perdersi;
 * l'errore finisce nei log del processo, e la persona vede la schermata del
 * codice col pulsante per rimandarlo.
 */
async function deliverCode(
  userId: string,
  email: string,
  purpose: CodePurpose,
  now: Date,
): Promise<boolean> {
  const code = await issueCode(userId, purpose, now);
  try {
    await sendCode({ to: email, code, purpose });
    return true;
  } catch (error) {
    console.error(
      `Invio del codice ${purpose} a ${email} fallito:`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

// ─── L'ingresso da Google ────────────────────────────────────────────────────

export type GoogleProfile = {
  googleSub: string;
  email: string | null;
  emailVerified: boolean;
  avatarUrl: string | null;
};

/**
 * L'ingresso da Google: ritrova la riga, **oppure si aggancia a quella che
 * esiste già con lo stesso indirizzo** (§2).
 *
 * Il vecchio codice faceva un `onConflictDoUpdate` su `google_sub`, e per
 * questo bastava: se Mario si era registrato con `mario@gmail.com` e una
 * password, nessuna riga aveva quel `google_sub` e Postgres ne inseriva una
 * seconda. Mario si ritrovava senza nome, davanti all'onboarding, con una
 * dashboard vuota — e la sua asta di ieri sull'altra riga.
 *
 * `display_name` resta deliberatamente vuoto al primo accesso: il nome e
 * cognome li scrive l'utente nell'onboarding (PLAN §2), non li deduciamo dal
 * profilo Google. Sui login successivi non lo tocchiamo mai più.
 */
export async function upsertGoogleUser(
  profile: GoogleProfile,
  now: Date = new Date(),
): Promise<Result<User>> {
  // ⚠ **Google senza email verificata non entra.** Senza quell'asserzione non
  // possiamo agganciare per email, e agganciare su una prova debole vale meno
  // che chiudere la porta: chi controlla un account Google con un indirizzo
  // altrui non verificato si prenderebbe la riga di quell'indirizzo.
  if (!profile.email || !profile.emailVerified) {
    return fail(
      "INVALID_EMAIL",
      "Questo account Google non ha un indirizzo email verificato: non possiamo usarlo per entrare.",
    );
  }
  const email = normalizeEmail(profile.email);

  // 1. Chi è già entrato da qui.
  const bySub = await db.query.users.findFirst({
    where: eq(users.googleSub, profile.googleSub),
  });
  if (bySub) {
    // ⚠ **L'email non si riscrive.** Con il `UNIQUE` addosso, il giorno in cui
    // un account Google cambia indirizzo verso uno già preso da un'altra riga
    // quell'`UPDATE` fallirebbe e il login diventerebbe un 500 senza
    // spiegazione. L'email si scrive alla creazione e all'aggancio, poi si
    // lascia stare. L'avatar invece non è la chiave di niente.
    const [updated] = await db
      .update(users)
      .set({ avatarUrl: profile.avatarUrl })
      .where(eq(users.id, bySub.id))
      .returning();
    return ok(updated);
  }

  // 2. C'è già una riga con questo indirizzo: ci si aggancia.
  const byEmail = await findUserByEmail(email);
  if (byEmail) return ok(await hookGoogleTo(byEmail, profile, now));

  // 3. Nessuno dei due: è un account nuovo. Nasce già verificato — la prova che
  //    chiederemmo col codice l'ha appena data Google.
  try {
    const [row] = await db
      .insert(users)
      .values({
        googleSub: profile.googleSub,
        email,
        avatarUrl: profile.avatarUrl,
        emailVerifiedAt: now,
      })
      .returning();
    return ok(row);
  } catch {
    // Due login nello stesso istante (due schede, il doppio tap di un
    // telefono): uno dei due ha vinto la corsa e la riga adesso c'è.
    const again =
      (await db.query.users.findFirst({
        where: eq(users.googleSub, profile.googleSub),
      })) ?? (await findUserByEmail(email));
    if (again) return ok(again);
    throw new Error("Login con Google fallito: riprova.");
  }
}

/**
 * ⚠⚠ **La regola che chiude un furto d'account. Non semplificarla.**
 *
 * Senza le tre righe qui sotto, aprire l'aggancio email+password → Google
 * aprirebbe questo attacco:
 *
 * 1. Un malintenzionato scrive **il tuo** indirizzo su `/signup`, con una
 *    password sua.
 * 2. Non inserisce il codice — non gli arriva, e non gli serve. La riga esiste,
 *    non verificata, col suo hash dentro.
 * 3. Tu entri da Google con quell'indirizzo. Noi ti agganciamo a quella riga,
 *    che è esattamente ciò che vogliamo fare: una persona, una riga.
 * 4. Da quel momento **lui ha la tua password**. Ha fatto la parte facile e ha
 *    lasciato a te quella difficile.
 *
 * Quindi: **un aggancio su una riga non verificata azzera `password_hash`** e
 * consuma i codici ancora vivi. Chi entra da Google ha dimostrato di avere la
 * casella; quella password l'ha scritta qualcuno che non ha dimostrato niente,
 * e non ha nessuna pretesa. Se l'avevi messa tu non perdi nulla che non puoi
 * rifare — da quel momento entri da Google, e la rimetti da «Password
 * dimenticata».
 *
 * Se invece la riga **era già verificata**, la password resta: le due prove ci
 * sono entrambe, e restano entrambe le strade.
 */
async function hookGoogleTo(
  existing: User,
  profile: GoogleProfile,
  now: Date,
): Promise<User> {
  const wasVerified = existing.emailVerifiedAt !== null;

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(users)
      .set({
        googleSub: profile.googleSub,
        avatarUrl: profile.avatarUrl,
        emailVerifiedAt: existing.emailVerifiedAt ?? now,
        ...(wasVerified ? {} : { passwordHash: null }),
      })
      .where(eq(users.id, existing.id))
      .returning();

    if (!wasVerified) {
      // I codici vivi sono del ladro quanto la password: lasciarne uno valido
      // gli lascerebbe il modo di verificare la riga subito dopo.
      await tx
        .update(emailCodes)
        .set({ consumedAt: now })
        .where(
          and(
            eq(emailCodes.userId, existing.id),
            isNull(emailCodes.consumedAt),
          ),
        );
    }

    return updated;
  });
}

// ─── L'ingresso con email e password ─────────────────────────────────────────

/**
 * Il controllo che sta dietro il provider `email`.
 *
 * Ritorna **un errore solo** per «non esiste» e «password sbagliata», e non per
 * difendersi dall'enumerazione — da quella non ci difendiamo, ed è scritto in
 * `docs/DECISIONS.md`. È che i due casi non hanno risposte diverse da dare: chi
 * sbaglia indirizzo e chi sbaglia password fanno la stessa cosa dopo.
 *
 * ⚠ **Verificato o no, qui si entra.** Non verificato ≠ non autenticato: chi ha
 * dato la password giusta ha una sessione, e la scala di `requireUser()` lo
 * porta a `/verify` invece che dentro l'applicazione. Rifiutare il login
 * lascerebbe la persona senza nessuna strada per farsi rimandare il codice.
 */
export async function authenticateWithPassword(
  email: unknown,
  password: unknown,
): Promise<Result<User>> {
  const generic = fail<User>(
    "INVALID_PASSWORD",
    "Email o password non corretti.",
  );
  if (typeof email !== "string" || typeof password !== "string") return generic;

  const user = await findUserByEmail(email);
  if (!user) return generic;
  if (!(await verifyPassword(password, user.passwordHash))) return generic;
  return ok(user);
}

// ─── Verifica dell'indirizzo ─────────────────────────────────────────────────

/**
 * Rimanda il codice di verifica a chi è già dentro ma non verificato.
 *
 * È una funzione **autenticata**: la chiama `/verify`, che una sessione ce l'ha
 * già. È la prima delle tre ragioni per cui la verifica è un gradino della
 * scala di `requireUser()` e non un flusso a parte — il reinvio è un'azione di
 * un utente, non una rotta pubblica da proteggere a mano.
 */
export async function resendVerificationCode(
  userId: string,
  now: Date = new Date(),
): Promise<Result<{ mailSent: boolean }>> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user || !user.email) {
    return fail("ACCOUNT_NOT_FOUND", "Account non trovato.");
  }
  if (user.emailVerifiedAt !== null) {
    return fail("ALREADY_VERIFIED", "Il tuo indirizzo è già verificato.");
  }

  const allowed = checkResendAllowed(
    await lastCodeSentAt(userId, "VERIFY_EMAIL"),
    now,
  );
  if (!allowed.ok) return allowed;

  const mailSent = await deliverCode(userId, user.email, "VERIFY_EMAIL", now);
  return ok({ mailSent });
}

/**
 * Consuma il codice e scrive `email_verified_at`.
 *
 * Ogni tentativo sbagliato incrementa `attempts` con una `UPDATE` che legge e
 * scrive in un colpo solo: due tentativi in parallelo contano due, non uno.
 * È l'unico punto di questo file in cui la concorrenza fa una differenza
 * visibile, ed è anche l'unico in cui una difesa dipende da un conteggio.
 */
export async function verifyEmail(
  userId: string,
  code: unknown,
  now: Date = new Date(),
): Promise<Result<null>> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return fail("ACCOUNT_NOT_FOUND", "Account non trovato.");
  // Idempotente di proposito: due invii dello stesso form, o il ritorno
  // indietro del browser, non devono dire «codice non valido» a chi ha appena
  // finito. Chi è già verificato ha già finito.
  if (user.emailVerifiedAt !== null) return ok(null);

  const row = await liveCode(userId, "VERIFY_EMAIL");
  const usable = checkCodeUsable(row, now);
  if (!usable.ok) return usable;

  const given = typeof code === "string" ? code.trim() : "";
  if (!sameHash(hashCode(given), row!.codeHash)) {
    const [updated] = await db
      .update(emailCodes)
      .set({ attempts: sql`${emailCodes.attempts} + 1` })
      .where(eq(emailCodes.id, row!.id))
      .returning({ attempts: emailCodes.attempts });
    return wrongCodeMessage(updated.attempts);
  }

  // Il consumo è condizionato a `consumed_at IS NULL`: se due richieste
  // arrivano col codice giusto nello stesso istante, una sola lo consuma.
  await db
    .update(emailCodes)
    .set({ consumedAt: now })
    .where(and(eq(emailCodes.id, row!.id), isNull(emailCodes.consumedAt)));

  await db
    .update(users)
    .set({ emailVerifiedAt: now })
    .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));

  return ok(null);
}

// ─── Il recupero della password ──────────────────────────────────────────────

/**
 * Perché un account può **non** avere una password da recuperare.
 *
 * Un account di solo Google che chiede «password dimenticata» non se la vede
 * creare dal nulla: sarebbe la direzione Google → password di §2 per un'altra
 * strada, e quella direzione è chiusa. La frase lo dice, invece di far provare
 * e riprovare.
 */
function noPasswordToReset(user: User): Result<never> {
  if (user.googleSub !== null) {
    return fail(
      "EMAIL_IS_GOOGLE",
      "Questo account entra con Google: usa «Entra con Google», non serve nessuna password.",
    );
  }
  return fail(
    "ACCOUNT_NOT_FOUND",
    "Questo account non ha una password da recuperare.",
  );
}

/**
 * `/forgot`: manda un codice per cambiare la password.
 *
 * ⚠ **Questo flusso è non autenticato**, al contrario di `/verify`: chi lo usa
 * è per definizione fuori. Il codice si cerca quindi per *(email, purpose)* e
 * le difese non possono appoggiarsi a una sessione — i cinque tentativi della
 * tabella valgono comunque, e sopra ci va il limite per IP di `lib/rate-limit`,
 * che applica chi chiama.
 *
 * ⚠ **Un limite noto, scritto invece che scoperto:** un reset **non invalida le
 * sessioni già aperte altrove**, perché le sessioni sono JWT e non righe a
 * database (P17). Vedi `docs/DECISIONS.md`.
 */
export async function requestPasswordReset(
  email: unknown,
  now: Date = new Date(),
): Promise<Result<{ mailSent: boolean }>> {
  if (typeof email !== "string") {
    return fail("INVALID_EMAIL", "Scrivi il tuo indirizzo email.");
  }
  const user = await findUserByEmail(email);
  // Dall'enumerazione degli account non ci difendiamo, ed è una decisione
  // scritta in `docs/DECISIONS.md`: dire «questo indirizzo non c'è» è utile a
  // chi ha sbagliato a digitarlo, e ciò che protegge un account è la password.
  if (!user || !user.email) {
    return fail("ACCOUNT_NOT_FOUND", "Nessun account con questo indirizzo.");
  }
  if (user.passwordHash === null) return noPasswordToReset(user);

  const allowed = checkResendAllowed(
    await lastCodeSentAt(user.id, "RESET_PASSWORD"),
    now,
  );
  if (!allowed.ok) return allowed;

  const mailSent = await deliverCode(
    user.id,
    user.email,
    "RESET_PASSWORD",
    now,
  );
  return ok({ mailSent });
}

/**
 * `/reset`: codice e password nuova, in un colpo solo.
 *
 * **Un codice, non un link**: niente token negli URL da farsi inoltrare per
 * sbaglio, e una schermata in meno da scrivere.
 *
 * ⚠ `email_verified_at` **non** si tocca qui, ed è deliberato: chi arriva da
 * `/forgot` senza aver mai verificato entra e trova `/verify`, che è il gradino
 * giusto e che il codice glielo rimanda. Far verificare l'indirizzo di rimbalzo
 * sarebbe difendibile — la prova è la stessa — ma sarebbe una regola in più che
 * nessuno ha chiesto, e le regole dell'identità si contano.
 */
export async function resetPassword(
  input: { email: unknown; code: unknown; password: unknown },
  now: Date = new Date(),
): Promise<Result<null>> {
  if (typeof input.email !== "string") {
    return fail("INVALID_EMAIL", "Scrivi il tuo indirizzo email.");
  }
  const user = await findUserByEmail(input.email);
  if (!user) {
    return fail("ACCOUNT_NOT_FOUND", "Nessun account con questo indirizzo.");
  }
  if (user.passwordHash === null) return noPasswordToReset(user);

  // La password si valida **prima** di consumare il codice: chi ne sceglie una
  // troppo corta non deve perdere il codice appena ricevuto e ricominciare.
  const password = validatePassword(input.password);
  if (!password.ok) return password;

  const row = await liveCode(user.id, "RESET_PASSWORD");
  const usable = checkCodeUsable(row, now);
  if (!usable.ok) return usable;

  const given = typeof input.code === "string" ? input.code.trim() : "";
  if (!sameHash(hashCode(given), row!.codeHash)) {
    const [updated] = await db
      .update(emailCodes)
      .set({ attempts: sql`${emailCodes.attempts} + 1` })
      .where(eq(emailCodes.id, row!.id))
      .returning({ attempts: emailCodes.attempts });
    return wrongCodeMessage(updated.attempts);
  }

  const passwordHash = await hashPassword(password.value);
  await db.transaction(async (tx) => {
    await tx
      .update(emailCodes)
      .set({ consumedAt: now })
      .where(and(eq(emailCodes.id, row!.id), isNull(emailCodes.consumedAt)));
    await tx
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, user.id));
  });

  return ok(null);
}
