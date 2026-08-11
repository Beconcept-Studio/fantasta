import { and, asc, eq, isNull } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { type User, users } from "@/lib/db/schema";
import { isAppAdmin, normalizeDisplayName } from "@/lib/domain";
import {
  authenticateWithPassword,
  upsertGoogleUser,
} from "@/lib/engine/accounts";

/**
 * Autenticazione dell'applicazione.
 *
 * Tre provider:
 *
 * - **Google**, la prima strada, e fino a M5 l'unica (PLAN §2).
 * - **`email`**, la seconda: indirizzo e password, con l'indirizzo verificato
 *   da un codice prima di poter fare qualunque altra cosa (M5). Esiste perché
 *   la sera dell'asta la persona che un account Google non ce l'ha, o non vuole
 *   collegarlo qui, non è un caso di studio: è un amico in piedi accanto alla
 *   TV che non riesce a entrare.
 * - **`dev`**, un Credentials provider registrato solo fuori produzione, che
 *   apre una sessione per un utente già presente a database senza passare da
 *   Google. Serve perché collaudare un'asta a 8 richiederebbe 8 account Google
 *   reali (PLAN §15). Un test automatico verifica che in produzione non esista.
 *
 * ⚠ Le due strade portano **alla stessa riga di `users`**, e l'indirizzo email
 * è la chiave che le tiene insieme (M5 §2). La regola meno ovvia di tutta
 * l'autenticazione — un aggancio Google su una riga non verificata azzera
 * `password_hash` — sta in `lib/engine/accounts.ts`, col suo attacco scritto
 * accanto.
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
      // E mai un bot (M4): non perché impersonarlo sarebbe pericoloso — non
      // può fare niente che un partecipante non possa — ma perché una lista di
      // identità di comodo che si sporca da sola smette di essere utile.
      if (row.isBot) return null;
      return { id: row.id, name: row.displayName, email: row.email };
    },
  });

  /**
   * La seconda strada d'ingresso (M5). È un Credentials provider come `dev`,
   * ma non ha niente in comune con lui: qui si verifica una password, e la
   * lista dei provider in produzione diventa `["google", "email"]` — che è
   * ancora un'uguaglianza esatta nel test, non un «almeno questi».
   */
  const emailProvider = Credentials({
    id: "email",
    name: "Email e password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    authorize: async (credentials) => {
      const result = await authenticateWithPassword(
        credentials?.email,
        credentials?.password,
      );
      // ⚠ Anche un utente **non verificato** entra: non verificato non è non
      // autenticato. La sessione serve proprio a portarlo su `/verify` e a
      // dargli il pulsante per farsi rimandare il codice.
      if (!result.ok) return null;
      const user = result.value;
      return { id: user.id, name: user.displayName, email: user.email };
    },
  });

  return [
    Google({}),
    emailProvider,
    ...(nodeEnv !== "production" ? [devProvider] : []),
  ];
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
        const hooked = await upsertGoogleUser({
          googleSub: account.providerAccountId,
          email: profile?.email ?? null,
          emailVerified: profile?.email_verified === true,
          avatarUrl: profile?.picture ?? null,
        });
        if (!hooked.ok) throw new Error(hooked.error.message);
        token.uid = hooked.value.id;
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
 * Guardia delle pagine autenticate: **una scala a tre gradini**, in quest'ordine.
 *
 * ```
 * sessione?   no → /signin
 * verificato? no → /verify
 * ha un nome? no → /onboarding
 *                → la pagina
 * ```
 *
 * Il gradino di mezzo è di M5, e la sua posizione non è casuale: **la verifica
 * viene prima dell'onboarding** di proposito, perché non si raccoglie il nome
 * di qualcuno per un indirizzo che potrebbe non esistere.
 *
 * ⚠ **Accesso rigido**: chi non è verificato non fa nulla. Non crea aste, non
 * entra in un'asta su invito, non gioca. Ha un prezzo dichiarato — fra M5 e M6
 * non esiste il pulsante «verifica a mano», e se a un amico l'email non arriva
 * l'unico rimedio è una `UPDATE` sul server (M5 §9).
 *
 * ⚠ **La scala vale solo per chi ci passa.** Chi scrive una pagina nuova usa
 * `requireUser()`; `currentUser()` è per chi la scala la sta *implementando*
 * (`/signin`, `/verify`, `/onboarding`, la navbar) o per le rotte API, dove un
 * redirect non ha senso e la risposta giusta è un 401. L'audit di M5-09 è in
 * `docs/features/05-identita.md`.
 */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/signin");
  if (!isVerified(user)) redirect("/verify");
  if (!user.displayName) redirect("/onboarding");
  return user;
}

/**
 * Guardia del pannello di amministrazione (M6): `requireUser()` **e** il flag.
 *
 * ```
 * la scala di requireUser()  → /signin, /verify, /onboarding
 * is_admin?             no  → /dashboard
 *                           → il pannello
 * ```
 *
 * Passa dalla scala per intero e non la scavalca: un amministratore non
 * verificato è un utente non verificato, e il pannello non è una porta di
 * servizio che aggira M5.
 *
 * ⚠ **Va chiamata in cima a ogni pagina e a ogni server action del pannello, non
 * soltanto nel layout.** Un layout decide cosa mostrare; le server action sono
 * endpoint raggiungibili per conto proprio — un `POST` che non apre nessuna
 * pagina — e un pannello protetto solo dal layout è un pannello aperto. Nel
 * layout ci sta comunque, perché lì serve a dare un redirect pulito invece di un
 * errore. E il motore ricontrolla `is_admin` rileggendolo dal database, perché la
 * sessione è un JWT e non sa niente dei permessi: chi è stato declassato non deve
 * comandare fino alla scadenza del token.
 *
 * Il redirect di un non-amministratore va in `/dashboard` e non in `/signin`:
 * chi è entrato ha una sessione valida, non gli manca il login — gli manca il
 * permesso. Rimandarlo ad accedere gli farebbe pensare di essere stato buttato
 * fuori.
 */
export async function requireAppAdmin(): Promise<User> {
  const user = await requireUser();
  if (!isAppAdmin(user)) redirect("/dashboard");
  return user;
}

/**
 * Ha dimostrato di controllare il proprio indirizzo?
 *
 * Una condizione sola, senza eccezioni: la colonna è scritta o non lo è. Le due
 * categorie che «non hanno niente da dimostrare» non sono un'eccezione qui, ma
 * una riga a database — **il seed scrive `email_verified_at`** ai dodici utenti
 * di prova (M5 §9), e in produzione lo scrive il backfill del deploy (§10).
 * Un'eccezione nel codice avrebbe risparmiato quelle due righe e lasciato per
 * sempre la domanda «e questo caso qui, è verificato o no?».
 *
 * Il parametro è **strutturale** da M6, come quello di `isAppAdmin`: la tabella
 * del pannello chiede «è verificato?» su una riga sua, che non è un `User`
 * intero, e deve poterlo fare senza importare il tipo da `lib/db/schema` — cioè
 * senza fare esattamente quello che la regola ESLint vieta. La condizione resta
 * una sola e in un posto solo: è quella che il secondo gradino della scala
 * interroga, e non ne esistono due idee.
 */
export function isVerified(user: { emailVerifiedAt: Date | null }): boolean {
  return user.emailVerifiedAt !== null;
}

/** Nome suggerito dal profilo Google, per precompilare l'onboarding. */
export async function suggestedDisplayName(): Promise<string> {
  const session = await auth();
  return session?.user?.name ?? "";
}

/**
 * Scrive nome e cognome. Ritorna `false` se la stringa non è accettabile.
 *
 * La regola sta in `normalizeDisplayName` (`lib/domain.ts`) da M6, quando
 * l'amministratore che corregge il nome di qualcun altro è diventato il secondo
 * chiamante: una regola sola, o l'onboarding e il pannello accettano due cose
 * diverse.
 */
export async function setDisplayName(
  userId: string,
  displayName: string,
): Promise<boolean> {
  const value = normalizeDisplayName(displayName);
  if (value === null) return false;
  await db.update(users).set({ displayName: value }).where(eq(users.id, userId));
  return true;
}

/**
 * Gli utenti selezionabili dal provider `dev`: quelli creati dal seed, cioè
 * senza `google_sub` — **e non i bot** (M4), che sono altrettanti utenti senza
 * `google_sub` ma non sono nessuno da impersonare. Vuoto in produzione.
 */
export async function listDevUsers(): Promise<User[]> {
  if (!isDevAuthEnabled) return [];
  return db
    .select()
    .from(users)
    .where(and(isNull(users.googleSub), eq(users.isBot, false)))
    .orderBy(asc(users.displayName));
}
