import { asc, eq, isNull } from "drizzle-orm";
import NextAuth, { type Profile } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { type User, users } from "@/lib/db/schema";

/**
 * Autenticazione dell'applicazione.
 *
 * Due provider:
 *
 * - **Google**, l'unico modo di entrare in produzione (PLAN §2).
 * - **`dev`**, un Credentials provider registrato solo fuori produzione, che
 *   apre una sessione per un utente già presente a database senza passare da
 *   Google. Serve perché collaudare un'asta a 8 richiederebbe 8 account Google
 *   reali (PLAN §15). Un test automatico verifica che in produzione non esista.
 *
 * La sessione è un **JWT**, non una riga a database: nessuna tabella adapter
 * (DECISIONS, P17). Il token porta soltanto l'id interno dell'utente; tutto il
 * resto — nome, flag admin — si rilegge dal database a ogni richiesta. È quello
 * che fa vedere le stesse informazioni allo stesso account su due dispositivi,
 * e che rende immediato l'effetto dell'onboarding senza rifare il login.
 *
 * Questo file è uno dei pochi autorizzati a importare `lib/db` (vedi la regola
 * ESLint in `eslint.config.mjs`): concentra qui tutti gli accessi alla tabella
 * `users`, così le pagine non ne hanno mai bisogno.
 */

/** Il provider `dev` esiste solo fuori produzione. */
export const isDevAuthEnabled = process.env.NODE_ENV !== "production";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Crea o aggiorna la riga `users` a partire dal profilo Google.
 *
 * `display_name` resta deliberatamente vuoto al primo accesso: il nome e
 * cognome li scrive l'utente nell'onboarding (PLAN §2), non li deduciamo dal
 * profilo Google. Sui login successivi non lo tocchiamo mai più.
 */
async function upsertGoogleUser(
  googleSub: string,
  profile: Profile | undefined,
): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({
      googleSub,
      email: profile?.email ?? null,
      avatarUrl: profile?.picture ?? null,
    })
    .onConflictDoUpdate({
      target: users.googleSub,
      set: {
        email: profile?.email ?? null,
        avatarUrl: profile?.picture ?? null,
      },
    })
    .returning();

  return row;
}

/**
 * La lista dei provider, con `NODE_ENV` passato come parametro invece che letto
 * dentro: è la stessa ragione per cui il motore riceve `now` dall'esterno —
 * rende la regola "in produzione il provider `dev` non esiste" verificabile con
 * un test, invece che per ispezione a occhio.
 */
export function buildProviders(
  nodeEnv: string | undefined = process.env.NODE_ENV,
) {
  const devProvider = Credentials({
    id: "dev",
    name: "Utente di sviluppo",
    credentials: { userId: { label: "Utente" } },
    authorize: async (credentials) => {
      const userId = credentials?.userId;
      if (typeof userId !== "string" || !UUID_RE.test(userId)) return null;
      const row = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });
      // Solo utenti seeded: chi ha un google_sub entra da Google.
      if (!row || row.googleSub !== null) return null;
      return { id: row.id, name: row.displayName, email: row.email };
    },
  });

  return [Google({}), ...(nodeEnv !== "production" ? [devProvider] : [])];
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  // L'app gira dietro nginx in produzione e viene raggiunta dal telefono via
  // IP di LAN in sviluppo (`pnpm dev:lan`): l'host della richiesta non è
  // sempre quello di AUTH_URL.
  trustHost: true,
  providers: buildProviders(),
  callbacks: {
    async jwt({ token, user, account, profile }) {
      if (account?.provider === "google" && account.providerAccountId) {
        const row = await upsertGoogleUser(account.providerAccountId, profile);
        token.uid = row.id;
        // Solo per precompilare il form di onboarding: non finisce a database.
        token.suggestedName = profile?.name ?? null;
      } else if (user?.id) {
        token.uid = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (typeof token.uid === "string") session.user.id = token.uid;
      return session;
    },
  },
});

/** L'utente della richiesta corrente, riletto dal database. `null` se anonimo. */
export async function currentUser(): Promise<User | null> {
  const session = await auth();
  const uid = session?.user?.id;
  if (typeof uid !== "string" || !UUID_RE.test(uid)) return null;
  return (await db.query.users.findFirst({ where: eq(users.id, uid) })) ?? null;
}

/**
 * Guardia delle pagine autenticate. Manda a `/signin` chi non è loggato e a
 * `/onboarding` chi non ha ancora scritto nome e cognome: è così che
 * `display_name` diventa obbligatorio *prima* di qualsiasi altra pagina.
 */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/signin");
  if (!user.displayName) redirect("/onboarding");
  return user;
}

/** Nome suggerito dal profilo Google, per precompilare l'onboarding. */
export async function suggestedDisplayName(): Promise<string> {
  const session = await auth();
  return session?.user?.name ?? "";
}

/** Scrive nome e cognome. Ritorna `false` se la stringa non è accettabile. */
export async function setDisplayName(
  userId: string,
  displayName: string,
): Promise<boolean> {
  const value = displayName.trim().replace(/\s+/g, " ");
  if (value.length < 3 || value.length > 60) return false;
  await db.update(users).set({ displayName: value }).where(eq(users.id, userId));
  return true;
}

/**
 * Gli utenti selezionabili dal provider `dev`: quelli creati dal seed, cioè
 * senza `google_sub`. Vuoto in produzione.
 */
export async function listDevUsers(): Promise<User[]> {
  if (!isDevAuthEnabled) return [];
  return db
    .select()
    .from(users)
    .where(isNull(users.googleSub))
    .orderBy(asc(users.displayName));
}
