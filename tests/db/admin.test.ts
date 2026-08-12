import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";


/**
 * Di `@/lib/auth` si sostituisce **una funzione sola**, per la stessa ragione del
 * test I8: fuori da una richiesta vera non esiste una sessione, e
 * `requireAppAdmin()` la legge da Auth.js. Il finto riproduce ciò che la guardia
 * fa davvero a chi non è amministratore — **interrompe**, come fa `redirect()` —
 * e serve a provare che ogni server action **la chiama**.
 *
 * ⚠ Tutto il resto del modulo resta quello vero, e non è un dettaglio: la
 * verifica forzata va provata con `isVerified` **autentico**, cioè col gradino di
 * mezzo della scala di `requireUser()` in persona. Una copia del predicato
 * scritta nel test proverebbe che la colonna è scritta, non che la persona
 * entra — che è la cosa che interessa.
 */
const REFUSED = new Error("requireAppAdmin: redirect");
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireAppAdmin: async () => {
    throw REFUSED;
  },
}));

import { isVerified } from "@/lib/auth";
import { db } from "@/lib/db";
import { auctions, users } from "@/lib/db/schema";
import { pickPlayer, placeBid, startAuction } from "@/lib/engine/actions";
import {
  forceVerifyEmail,
  listAdminAuctions,
  listAdminUsers,
  setUserAdmin,
  setUserDisplayName,
} from "@/lib/engine/admin";
import { loadForSnapshot } from "@/lib/engine/snapshot";
import { createAuction, deleteAuction } from "@/lib/engine/setup";

import { makeGameAuction } from "./game-helpers";
import {
  closeDatabase,
  databaseAvailable,
  dropAuctions,
  dropUsers,
  makeUser,
} from "./helpers";

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
const createdAuctions: string[] = [];

afterAll(async () => {
  if (!dbUp) return;
  await dropAuctions(createdAuctions);
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
      // M7 — la prova che questo test fa il suo lavoro: la riga qui sotto è
      // stata aggiunta **dopo** aver visto il test rompersi, e insieme alla
      // guardia in cima all'azione. L'uguaglianza è rimasta esatta.
      "downloadCampionciniAction",
      "forceVerifyEmailAction",
      // M8 — le tre azioni degli insight sul listone. Come per M7, le righe qui
      // sotto sono state aggiunte **dopo** aver visto il test rompersi, insieme
      // alla guardia in cima a ognuna delle tre.
      "refreshListoneInsightsAction",
      "refreshSetPiecesAction",
      "setUserAdminAction",
      "setUserDisplayNameAction",
      "setUserProAction",
      // M10 — il caricamento del listone a sistema. Come per M7 e M8, la riga è
      // stata aggiunta **dopo** aver visto il test rompersi, insieme alla
      // guardia in cima all'azione. ⚠ La spec di M10 §5 diceva che questo test
      // non si sarebbe rotto: si riferiva alla modifica di
      // `downloadCampionciniAction`, che infatti non cambia nome né firma
      // rispetto all'elenco — ma la macro **un'azione la aggiunge**, ed è
      // questa. Il test ha fatto il suo lavoro anche stavolta.
      // M10B — il caricamento del foglio di Carmy. Quarta volta di fila che
      // questa riga viene aggiunta **dopo** aver visto il rosso, insieme al
      // `requireAppAdmin()` in cima all'azione: a questo punto non è più una
      // coincidenza, è il test che funziona.
      "uploadCarmyAction",
      "uploadListoneAction",
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

// ─── La verifica forzata: il pulsante che chiude la finestra di M5 §9 ─────────

suite("la verifica forzata", () => {
  /**
   * ⚠ Il punto di questo test non è la colonna: è **`isVerified` vero**, quello
   * che `requireUser()` interroga al secondo gradino. Prima del pulsante quella
   * persona finisce su `/verify` a ogni pagina; dopo, il gradino la lascia
   * passare e l'unico che resta è l'onboarding — che è dove `requireUser()` manda
   * chi non ha ancora un nome (verifica 5).
   */
  it("fa passare davvero il gradino di requireUser(), non solo scrive la colonna", async () => {
    const actor = await user("admin", { isAdmin: true });
    const target = await user("non-verificato");

    const before = (await row(target))!;
    expect(before.emailVerifiedAt).toBeNull();
    expect(isVerified(before)).toBe(false);

    const result = await forceVerifyEmail(actor, target);
    expect(result.ok).toBe(true);

    const after = (await row(target))!;
    expect(after.emailVerifiedAt).not.toBeNull();
    expect(isVerified(after)).toBe(true);
  });

  /**
   * Ripetibile, e senza riscrivere il timestamp: è la lezione del backfill di
   * M5 §10 — un comando che si può dare una volta sola è un comando che qualcuno
   * darà due volte (il doppio invio del form, il tasto indietro del browser).
   */
  it("premuta due volte non riscrive il momento della verifica", async () => {
    const actor = await user("admin", { isAdmin: true });
    const target = await user("non-verificato");

    const first = await forceVerifyEmail(actor, target);
    const firstAt = (await row(target))!.emailVerifiedAt;

    const second = await forceVerifyEmail(actor, target);

    expect(first.ok && second.ok).toBe(true);
    expect((await row(target))!.emailVerifiedAt).toEqual(firstAt);
    if (second.ok) expect(second.value.verifiedAt).toEqual(firstAt);
  });

  it("una riga senza indirizzo non ha niente da verificare", async () => {
    const actor = await user("admin", { isAdmin: true });
    const [bot] = await db
      .insert(users)
      .values({ displayName: "Bot di prova", isBot: true })
      .returning({ id: users.id });
    created.push(bot.id);

    const result = await forceVerifyEmail(actor, bot.id);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_EMAIL");
  });
});

// ─── La lista utenti ─────────────────────────────────────────────────────────

/**
 * ⚠ Le asserzioni cercano **le proprie righe per id** e mai la lunghezza della
 * lista: il database di prova ha i dodici utenti del seed, e i file di test
 * girano in worker paralleli. Un `toHaveLength` qui sarebbe un test che passa a
 * seconda di chi altro sta girando.
 */
suite("la lista utenti", () => {
  it("i bot non ci sono, e col filtro acceso ci sono", async () => {
    const [bot] = await db
      .insert(users)
      .values({ displayName: "Bot 3", isBot: true })
      .returning({ id: users.id });
    created.push(bot.id);

    const senza = await listAdminUsers();
    const con = await listAdminUsers({ includeBots: true });

    expect(senza.some((u) => u.id === bot.id)).toBe(false);
    expect(con.some((u) => u.id === bot.id)).toBe(true);
  });

  it("«come entra» esce dalle credenziali che ci sono davvero", async () => {
    const google = await user("google");
    const [password] = await db
      .insert(users)
      .values({
        displayName: "Solo Password",
        email: `pwd.${crypto.randomUUID()}@test.invalid`,
        passwordHash: "scrypt$finto",
      })
      .returning({ id: users.id });
    const [both] = await db
      .insert(users)
      .values({
        displayName: "Tutte Due",
        email: `both.${crypto.randomUUID()}@test.invalid`,
        googleSub: `sub-${crypto.randomUUID()}`,
        passwordHash: "scrypt$finto",
      })
      .returning({ id: users.id });
    const [none] = await db
      .insert(users)
      .values({ displayName: "Nessuna Credenziale" })
      .returning({ id: users.id });
    created.push(password.id, both.id, none.id);

    const list = await listAdminUsers();
    const entryOf = (id: string) => list.find((u) => u.id === id)?.entry;

    expect(entryOf(google)).toBe("google");
    expect(entryOf(password.id)).toBe("password");
    expect(entryOf(both.id)).toBe("both");
    expect(entryOf(none.id)).toBe("none");
  });

  /**
   * I due numeri con cui si decide se una riga è una persona o un residuo (§4).
   * Sono indipendenti: l'owner che non ha joinato possiede un'asta e non ne
   * gioca nessuna (⚠ P11).
   */
  it("conta le aste possedute e quelle giocate, separatamente", async () => {
    const game = await makeGameAuction({ ownerPlays: false });
    createdAuctions.push(game.auctionId);
    created.push(...game.userIds, game.ownerId);

    const list = await listAdminUsers();
    const owner = list.find((u) => u.id === game.ownerId)!;
    const player = list.find((u) => u.id === game.userIds[0])!;

    expect(owner.ownedAuctions).toBe(1);
    expect(owner.playedAuctions).toBe(0);
    expect(player.ownedAuctions).toBe(0);
    expect(player.playedAuctions).toBe(1);
  });

  it("chi non ha aste ha due zeri, non due assenze", async () => {
    const solo = await user("appena-iscritto");
    const found = (await listAdminUsers()).find((u) => u.id === solo)!;

    expect(found.ownedAuctions).toBe(0);
    expect(found.playedAuctions).toBe(0);
  });
});

// ─── La lista aste: I8 per assenza ───────────────────────────────────────────

/**
 * Le chiavi che una riga della lista aste può avere. **L'insieme è esatto**, ed è
 * lo strumento del test I8: un `expect(row.topBid).toBeUndefined()` nominerebbe
 * un campo morto, e il giorno in cui l'informazione rientrasse con un altro nome
 * — `bidStatus`, `credits`, `currentLot` — non se ne accorgerebbe nessuno. Se
 * questo elenco cresce, la modifica va guardata in faccia.
 */
const AUCTION_ROW_KEYS = [
  "completedAt",
  "createdAt",
  "id",
  "isSimulated",
  "memberCount",
  "name",
  "ownerEmail",
  "ownerId",
  "ownerName",
  "seats",
  "startedAt",
  "status",
];

/** Le due buste del lotto aperto. Nessuna delle due deve uscire da nessuna parte. */
const BIDS = [31, 57];

suite("la lista aste non ha nessuno stato di gioco (I8)", () => {
  it("un'asta in LOT_OPEN con due buste dentro non porta fuori nessun importo", async () => {
    const game = await makeGameAuction({ ownerPlays: false });
    createdAuctions.push(game.auctionId);
    created.push(...game.userIds, game.ownerId);

    const t0 = Date.now();
    expect((await startAuction(game.ownerId, game.auctionId, 0, t0)).ok).toBe(
      true,
    );
    const loaded = await loadForSnapshot(game.auctionId);
    const gk = loaded!.state.players.find((p) => p.role === "P")!;
    expect(
      (await pickPlayer(game.userIds[0], game.auctionId, gk.id, t0 + 100)).ok,
    ).toBe(true);
    expect(
      (await placeBid(game.userIds[1], game.auctionId, BIDS[0], t0 + 200)).ok,
    ).toBe(true);
    expect(
      (await placeBid(game.userIds[2], game.auctionId, BIDS[1], t0 + 300)).ok,
    ).toBe(true);

    const found = (await listAdminAuctions()).find(
      (a) => a.id === game.auctionId,
    )!;

    // 1. L'insieme esatto delle chiavi: niente fase, niente lotto, niente buste.
    expect(Object.keys(found).sort()).toEqual(AUCTION_ROW_KEYS);

    // 2. E nessun numero della riga è un importo di offerta. Si guarda la
    //    risposta, non la pagina (verifica 6).
    const numbers = Object.values(found).filter(
      (value): value is number => typeof value === "number",
    );
    for (const bid of BIDS) expect(numbers).not.toContain(bid);

    // 3. L'asta c'è, con lo stato che ha: LIVE è lo stato dell'asta, non lo
    //    stato di gioco — dire «è in corso» non dice niente di chi ha offerto.
    expect(found.status).toBe("LIVE");
    expect(found.memberCount).toBe(8);
  });

  it("l'owner esce con la sua email, che era la richiesta del quaderno", async () => {
    const owner = await user("proprietario");
    const { value } = (await createAuction(owner, {
      name: "Asta del pannello",
      seats: 8,
    })) as { ok: true; value: { auctionId: string } };
    createdAuctions.push(value.auctionId);

    const found = (await listAdminAuctions()).find(
      (a) => a.id === value.auctionId,
    )!;
    const ownerRow = (await row(owner))!;

    expect(found.ownerId).toBe(owner);
    expect(found.ownerEmail).toBe(ownerRow.email);
    expect(found.ownerName).toBe(ownerRow.displayName);
  });
});

// ─── La cancellazione dal pannello ───────────────────────────────────────────

suite("deleteAuction dal pannello", () => {
  it("un amministratore cancella l'asta di un altro, e non cancella l'altro", async () => {
    const admin = await user("admin", { isAdmin: true });
    const owner = await user("proprietario");
    const { value } = (await createAuction(owner, {
      name: "Asta di qualcun altro",
      seats: 8,
    })) as { ok: true; value: { auctionId: string } };

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await deleteAuction(admin, value.auctionId);
    const lines = log.mock.calls.map((c) => String(c[0]));
    log.mockRestore();

    expect(result.ok).toBe(true);
    expect(
      await db.query.auctions.findFirst({
        where: eq(auctions.id, value.auctionId),
      }),
    ).toBeUndefined();
    // ⚠ L'utente no: nessuna tabella di `users` dipende da un'asta.
    expect(await row(owner)).toBeDefined();

    // La riga su stdout è l'unica traccia che sopravvive — `events` se ne va con
    // l'asta — e registra l'amministratore come `actor`.
    const entry = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((e) => e.type === "DELETE_AUCTION");
    expect(entry?.actor).toBe(admin);
    expect(entry?.auctionId).toBe(value.auctionId);
  });

  it("chi non è né owner né amministratore resta fuori", async () => {
    const intruder = await user("intruso");
    const owner = await user("proprietario");
    const { value } = (await createAuction(owner, {
      name: "Asta non tua",
      seats: 8,
    })) as { ok: true; value: { auctionId: string } };
    createdAuctions.push(value.auctionId);

    const result = await deleteAuction(intruder, value.auctionId);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
    expect(
      await db.query.auctions.findFirst({
        where: eq(auctions.id, value.auctionId),
      }),
    ).toBeDefined();
  });

  /**
   * ⚠ **Il rifiuto non si allenta per un amministratore.** Non si butta via una
   * stanza con dodici persone dentro, e la pausa congela la fase senza azzerare
   * l'asta: `PAUSED` è un rifiuto esattamente come `LIVE`.
   */
  it.each(["LIVE", "PAUSED"] as const)(
    "su un'asta %s è rifiutata anche a un amministratore",
    async (status) => {
      const admin = await user("admin", { isAdmin: true });
      const game = await makeGameAuction({ ownerPlays: false });
      createdAuctions.push(game.auctionId);
      created.push(...game.userIds, game.ownerId);

      const t0 = Date.now();
      expect((await startAuction(game.ownerId, game.auctionId, 0, t0)).ok).toBe(
        true,
      );
      if (status === "PAUSED") {
        await db
          .update(auctions)
          .set({ status: "PAUSED", pausedAt: new Date() })
          .where(eq(auctions.id, game.auctionId));
      }

      const result = await deleteAuction(admin, game.auctionId);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("WRONG_STATUS");
      expect(
        await db.query.auctions.findFirst({
          where: eq(auctions.id, game.auctionId),
        }),
      ).toBeDefined();
    },
  );
});
