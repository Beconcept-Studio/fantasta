import { and, count, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { type User, auctions, members, users } from "@/lib/db/schema";
import {
  type AuctionStatus,
  isAppAdmin,
  normalizeDisplayName,
} from "@/lib/domain";

import { type Result, fail, ok } from "./errors";
import { isUuid } from "./ids";

/**
 * Il pannello di amministrazione (M6): le due liste e le tre azioni.
 *
 * ## Perché sta nel motore
 *
 * Perché tocca `lib/db`, e la regola ESLint non ammette eccezioni discrezionali:
 * una pagina che apre una query non sta facendo niente di male, ma nessun linter
 * sa distinguerla da una che salta il lock. Le pagine del pannello chiamano
 * queste funzioni; i nomi restano in `lib/domain.ts`.
 *
 * ## Il perimetro, che è la parte importante di questa macro
 *
 * Il pannello gira **nello stesso processo dell'asta vera**, quindi la domanda da
 * cui parte questo file non è cosa può fare un amministratore, è cosa **non** può
 * fare mentre dodici persone stanno offrendo. Qui dentro:
 *
 * - **non si tocca nessuna asta**, tranne cancellarla — e la cancellazione è
 *   `deleteAuction` in `setup.ts`, che questa macro allarga di una riga e non
 *   riscrive. Niente pausa, niente avvio, niente override, niente rettifiche: un
 *   secondo posto da cui si comanda la stessa asta sono due verità sullo stesso
 *   stato;
 * - **non esce nessuno stato di gioco.** La lista aste non ha lotti, non ha
 *   offerte, non ha rose. È così che si rispetta **I8**: il modo fragile è
 *   mostrare lo stato di gioco sanificandolo con attenzione, il modo solido è non
 *   avere niente da sanificare. E la regola 3 resta intatta — lo stato dell'asta
 *   esce solo da `serializeSnapshot`, e da qui non esce affatto;
 * - **non si scrive niente su `assignments` e `ledger`** (regola 5): non li si
 *   legge nemmeno.
 *
 * ## La guardia, due volte
 *
 * Ogni mutazione rilegge `is_admin` **dal database**, anche se la server action
 * che l'ha chiamata ha già passato `requireAppAdmin()`. Non è ridondanza inutile:
 * la sessione è un JWT (P17) e non sa niente dei permessi, quindi senza questa
 * rilettura chi è stato appena declassato continuerebbe a comandare fino alla
 * scadenza del token. È il precedente di M4: `fillWithBots` rilegge il flag
 * dentro il lock anche se l'azione l'ha già verificato.
 *
 * ## Perché niente lock
 *
 * `withAuctionLock` e `withSetupLock` serializzano le mutazioni **di un'asta**.
 * Qui si scrive una riga di `users` con un `UPDATE` singolo, che è già atomico, e
 * le condizioni che si controllano prima non sono dati che corrono: l'identità
 * dell'attore è un id, e `is_bot` non cambia mai dopo la creazione della riga.
 */

// ─── La guardia ──────────────────────────────────────────────────────────────

/**
 * `null` se l'attore è un amministratore, il rifiuto altrimenti.
 *
 * L'`isUuid` non è pedanteria: `findFirst` con una stringa che non è un uuid fa
 * alzare a Postgres un `22P02`, cioè un 500 al posto di un rifiuto previsto
 * (stessa ragione per cui `withSetupLock` lo controlla, F7-07bis).
 */
async function refuseNonAdmin<T>(
  actorUserId: string,
): Promise<Result<T> | null> {
  const actor = isUuid(actorUserId)
    ? await db.query.users.findFirst({ where: eq(users.id, actorUserId) })
    : undefined;
  if (!isAppAdmin(actor)) {
    return fail<T>(
      "NOT_ADMIN",
      "Solo un amministratore dell'applicazione può usare il pannello.",
    );
  }
  return null;
}

async function findUser(userId: string): Promise<User | undefined> {
  if (!isUuid(userId)) return undefined;
  return db.query.users.findFirst({ where: eq(users.id, userId) });
}

// ─── Gli utenti ──────────────────────────────────────────────────────────────

/**
 * Da quale porta entra questa persona.
 *
 * `none` esiste e non è un caso teorico: sono le righe senza nessuna credenziale
 * — i dodici utenti del seed, i bot — che entrano dal provider `dev` in locale e
 * in produzione non entrano affatto.
 */
export type AdminEntry = "google" | "password" | "both" | "none";

export type AdminUserRow = {
  id: string;
  /** ⚠ In sola lettura, sempre (§4): da M5 è la chiave d'identità. */
  email: string | null;
  displayName: string | null;
  entry: AdminEntry;
  emailVerifiedAt: Date | null;
  isAdmin: boolean;
  isBot: boolean;
  createdAt: Date;
  /** Aste possedute e aste giocate: è con questi due numeri che si capisce se
   *  una riga è una persona o un residuo. */
  ownedAuctions: number;
  playedAuctions: number;
};

/**
 * Tutti gli utenti, con i conteggi delle aste.
 *
 * **I bot stanno dietro un filtro e per default non ci sono.** Sette righe
 * «Bot 3» per ogni asta simulata rendono la lista inutile, ed è l'unico modo in
 * cui una lista di dodici amici può diventare illeggibile.
 *
 * L'ordine è dal più recente: la riga su cui un amministratore deve agire è
 * quasi sempre quella di chi si è appena iscritto e non riesce a entrare.
 * Niente paginazione e niente ricerca (§8): con dodici utenti una tabella
 * ordinata è la cosa giusta, e la paginazione si aggiunge quando una lista non
 * ci sta in una schermata.
 */
export async function listAdminUsers({
  includeBots = false,
}: { includeBots?: boolean } = {}): Promise<AdminUserRow[]> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      googleSub: users.googleSub,
      passwordHash: users.passwordHash,
      emailVerifiedAt: users.emailVerifiedAt,
      isAdmin: users.isAdmin,
      isBot: users.isBot,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(includeBots ? undefined : eq(users.isBot, false))
    .orderBy(desc(users.createdAt));

  // Due conteggi raggruppati e una `Map`, invece di due join sulla stessa
  // query: un join con `members` moltiplicherebbe le righe di `users`, e
  // sommare in SQL ciò che si legge meglio in tre righe di JavaScript non è un
  // guadagno a questa scala.
  const owned = new Map(
    (
      await db
        .select({ userId: auctions.ownerUserId, n: count() })
        .from(auctions)
        .groupBy(auctions.ownerUserId)
    ).map((r) => [r.userId, r.n]),
  );
  const played = new Map(
    (
      await db
        .select({ userId: members.userId, n: count() })
        .from(members)
        .groupBy(members.userId)
    ).map((r) => [r.userId, r.n]),
  );

  return rows.map(({ googleSub, passwordHash, ...row }) => ({
    ...row,
    entry: entryOf(googleSub, passwordHash),
    ownedAuctions: owned.get(row.id) ?? 0,
    playedAuctions: played.get(row.id) ?? 0,
  }));
}

/**
 * ⚠ `both` è più raro di quanto sembri, e la ragione è di M5: quando Google si
 * aggancia a una riga **non verificata**, `password_hash` viene azzerato — è la
 * difesa contro il furto d'account. Quindi «entrambi» resta solo a chi aveva già
 * dimostrato il proprio indirizzo prima di collegare Google.
 */
function entryOf(
  googleSub: string | null,
  passwordHash: string | null,
): AdminEntry {
  if (googleSub !== null && passwordHash !== null) return "both";
  if (googleSub !== null) return "google";
  if (passwordHash !== null) return "password";
  return "none";
}

// ─── Le aste ─────────────────────────────────────────────────────────────────

/**
 * Un'asta vista dal pannello.
 *
 * ⚠ **L'elenco dei campi è il modo in cui I8 è rispettato qui**, e va guardato in
 * faccia se un giorno cresce: non c'è la fase, non c'è il lotto in corso, non ci
 * sono le offerte, non ci sono i crediti, non ci sono le rose. Chi vuole vedere
 * un'asta la apre da dove si aprono le aste — il pannello dà il link e non
 * duplica la vista.
 */
export type AdminAuctionRow = {
  id: string;
  name: string;
  /** Lo *stato* dell'asta, che non è lo stato di gioco: DRAFT…COMPLETED. */
  status: AuctionStatus;
  seats: number;
  memberCount: number;
  isSimulated: boolean;
  ownerId: string;
  ownerName: string | null;
  /** L'email dell'owner: era la richiesta esplicita del quaderno. */
  ownerEmail: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};

/** Tutte le aste dell'applicazione, dalla più recente. */
export async function listAdminAuctions(): Promise<AdminAuctionRow[]> {
  const rows = await db
    .select({
      id: auctions.id,
      name: auctions.name,
      status: auctions.status,
      seats: auctions.seats,
      isSimulated: auctions.isSimulated,
      ownerId: auctions.ownerUserId,
      ownerName: users.displayName,
      ownerEmail: users.email,
      createdAt: auctions.createdAt,
      startedAt: auctions.startedAt,
      completedAt: auctions.completedAt,
    })
    .from(auctions)
    .innerJoin(users, eq(users.id, auctions.ownerUserId))
    .orderBy(desc(auctions.createdAt));

  const counts = new Map(
    (
      await db
        .select({ auctionId: members.auctionId, n: count() })
        .from(members)
        .groupBy(members.auctionId)
    ).map((r) => [r.auctionId, r.n]),
  );

  return rows.map((row) => ({
    ...row,
    memberCount: counts.get(row.id) ?? 0,
  }));
}

// ─── Le tre azioni, e sono tre ───────────────────────────────────────────────

/**
 * Correggere il nome di qualcuno.
 *
 * È l'unico modo di sistemare l'«asdf» scritto da un amico nell'onboarding, ed è
 * testo: la regola è `normalizeDisplayName`, la stessa dell'onboarding, perché
 * due idee di nome valido sono una in più di quelle che servono.
 */
export async function setUserDisplayName(
  actorUserId: string,
  targetUserId: string,
  displayName: unknown,
): Promise<Result<{ displayName: string }>> {
  const refused = await refuseNonAdmin<{ displayName: string }>(actorUserId);
  if (refused) return refused;

  const target = await findUser(targetUserId);
  if (!target) {
    return fail<{ displayName: string }>(
      "NOT_FOUND",
      "Questo utente non esiste.",
    );
  }

  const value = normalizeDisplayName(displayName);
  if (value === null) {
    return fail<{ displayName: string }>(
      "INVALID_NAME",
      "Il nome deve stare fra 3 e 60 caratteri.",
    );
  }

  await db
    .update(users)
    .set({ displayName: value })
    .where(eq(users.id, target.id));
  return ok({ displayName: value });
}

/**
 * Forzare la verifica dell'indirizzo. **È il pulsante che chiude la finestra di
 * M5 §9**: fra M5 in produzione e questa macro, l'unico rimedio a un'email che
 * non arriva era una `UPDATE` a mano sul server, la sera dell'asta, sotto
 * pressione.
 *
 * Scrivere la colonna **è** far passare la scala di `requireUser()`: `isVerified`
 * è una condizione sola e senza eccezioni, quindi non c'è nient'altro da
 * aggiornare perché la persona arrivi all'onboarding e poi al gioco.
 *
 * ⚠ **Quello che questo pulsante spegne.** Da M5, quando Google si aggancia a
 * una riga non verificata, `password_hash` viene azzerato: è la difesa contro
 * chi si registra con l'indirizzo di qualcun altro e aspetta. Su una riga
 * verificata quella difesa non scatta più — giustamente, perché l'indirizzo è
 * dimostrato. Forzare la verifica vuol dire quindi **mettere la propria parola al
 * posto della prova**, e va fatto solo per una persona che si ha davanti.
 *
 * Idempotente, e non riscrive un timestamp che c'è già: è la lezione del
 * backfill di M5 §10, dove l'`AND email_verified_at IS NULL` è ciò che rende il
 * comando ripetibile. Un'operazione che si può dare una volta sola è
 * un'operazione che qualcuno darà due volte.
 */
export async function forceVerifyEmail(
  actorUserId: string,
  targetUserId: string,
  now: Date = new Date(),
): Promise<Result<{ verifiedAt: Date }>> {
  const refused = await refuseNonAdmin<{ verifiedAt: Date }>(actorUserId);
  if (refused) return refused;

  const target = await findUser(targetUserId);
  if (!target) {
    return fail<{ verifiedAt: Date }>("NOT_FOUND", "Questo utente non esiste.");
  }
  if (target.email === null) {
    return fail<{ verifiedAt: Date }>(
      "INVALID_EMAIL",
      "Questa riga non ha un indirizzo: non c'è niente da verificare.",
    );
  }

  const [updated] = await db
    .update(users)
    .set({ emailVerifiedAt: now })
    .where(and(eq(users.id, target.id), isNull(users.emailVerifiedAt)))
    .returning({ verifiedAt: users.emailVerifiedAt });

  if (updated?.verifiedAt) return ok({ verifiedAt: updated.verifiedAt });

  // Zero righe aggiornate: era già verificato — dal pulsante premuto due volte,
  // o dal codice arrivato davvero nel frattempo. Si restituisce il timestamp che
  // c'è, non quello di adesso.
  const again = await findUser(target.id);
  return again?.emailVerifiedAt
    ? ok({ verifiedAt: again.emailVerifiedAt })
    : fail<{ verifiedAt: Date }>("NOT_FOUND", "Questo utente non esiste.");
}

/**
 * Dare o togliere il permesso di amministratore.
 *
 * ⚠ **Mai sulla propria riga.** Un click e ci chiudiamo fuori tutti: senza
 * pannello non si rientra dal pannello, e il rimedio sarebbe un `UPDATE` sul
 * server — cioè esattamente la finestra che questa macro è nata per chiudere. Il
 * divieto vale in **entrambe** le direzioni, anche per riconfermarsi il permesso
 * che si ha già: un'eccezione «ma darselo è innocuo» è il gradino da cui il caso
 * pericoloso rientra.
 *
 * Su un bot è rifiutato qui, e comunque lo rifiuterebbe il `CHECK`
 * `NOT (is_admin AND is_bot)` a database. Il controllo esplicito non è una
 * seconda difesa: serve a rispondere con un rifiuto leggibile invece che con un
 * 500 (PLAN §17 — le eccezioni sono per i bug veri).
 */
export async function setUserAdmin(
  actorUserId: string,
  targetUserId: string,
  isAdmin: unknown,
): Promise<Result<{ isAdmin: boolean }>> {
  const refused = await refuseNonAdmin<{ isAdmin: boolean }>(actorUserId);
  if (refused) return refused;

  if (targetUserId === actorUserId) {
    return fail<{ isAdmin: boolean }>(
      "FORBIDDEN",
      "Il tuo permesso di amministratore non si cambia da qui: se ti chiudi fuori, " +
        "non c'è un'altra porta da cui rientrare. Fallo fare a un altro amministratore.",
    );
  }

  if (typeof isAdmin !== "boolean") {
    return fail<{ isAdmin: boolean }>("INVALID_REQUEST", "Richiesta non valida.");
  }

  const target = await findUser(targetUserId);
  if (!target) {
    return fail<{ isAdmin: boolean }>("NOT_FOUND", "Questo utente non esiste.");
  }
  if (target.isBot) {
    return fail<{ isAdmin: boolean }>(
      "FORBIDDEN",
      "Un bot non è una persona: non amministra niente.",
    );
  }

  await db.update(users).set({ isAdmin }).where(eq(users.id, target.id));
  return ok({ isAdmin });
}
