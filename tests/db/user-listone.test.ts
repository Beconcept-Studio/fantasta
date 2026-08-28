import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, it, suite, vi } from "vitest";

import { db } from "@/lib/db";
import { type NewUserListoneRow, userListone } from "@/lib/db/schema";

import {
  closeDatabase,
  databaseAvailable,
  dropUsers,
  makeUser,
} from "./helpers";

/**
 * M21 — `user_listone`, il foglio che ognuno carica per sé.
 *
 * ## Cosa prova questo file, e cosa no
 *
 * Solo lo **schema**: che le quattordici colonne esistano, che ci arrivi e ne
 * torni indietro quello che ci si mette, che la chiave composta separi davvero
 * due utenti, e che la cascata su `user_id` porti via le righe. È il modo in cui
 * ci si accorge di una colonna dimenticata **in locale invece che sul server**,
 * dove `pnpm db:push` si dà a mano e nessuno lo ridà.
 *
 * Il caricamento vero — parser, aggancio per nome, soglia, sostituzione — è
 * M21-05 e M21-06, e i suoi test vanno dove sta il listone di sistema.
 *
 * ## ⚠ Perché questo file può stare da solo, mentre M10B non poteva
 *
 * `tests/db/listone.test.ts` spiega per esteso la cicatrice: due file che
 * scrivono sulla **stessa tabella globale** in worker paralleli si cancellano le
 * righe a vicenda, ed è così che dieci test erano rossi nella suite e verdi da
 * soli. La regola che ne è uscita è «una tabella globale, un file che la
 * possiede».
 *
 * Qui non si applica, e va detto perché: `user_listone` **non è globale**. Ogni
 * riga appartiene a un utente, gli utenti di questi test nascono con un uuid
 * usa-e-getta, e nessun `DELETE` di questo file può toccare le righe di un
 * altro. Non c'è nessuna tabella condivisa da possedere — non si scrive né su
 * `listone_players`, né su `carmy_players`, né su `player_insights`.
 */

const dbUp = await databaseAvailable();
if (!dbUp) {
  console.warn(
    "\n⚠ Postgres non raggiungibile: i test del listone personale sono saltati.\n",
  );
}

const T0 = new Date("2026-08-28T10:00:00.000Z");

/**
 * ⚠ Identificativi altissimi, per la ragione di `EXT_ID_BASE` in
 * `listone.test.ts`: gli `ext_id` veri di Fantacalcio.it arrivano a 7548, e un
 * numero basso qui somiglierebbe a un giocatore vero. Qui non aggancerebbe
 * niente comunque — questa tabella non ha nessuna FOREIGN KEY — ma un id che
 * *sembra* reale è un id che qualcuno, un giorno, proverà a raccontare.
 */
const EXT_ID_BASE = 10_000_000;

/** Le quattordici colonne di §2, per nome. Un `toEqual` sulle chiavi le fissa tutte. */
const COLONNE = [
  "userId",
  "extId",
  "obiettivo",
  "fascia",
  "fasciaRank",
  "pma",
  "fmvExp",
  "prezzo",
  "titolarita",
  "affidabilita",
  "integrita",
  "tags",
  "commento",
  "uploadedAt",
] as const;

const createdUsers: string[] = [];

async function user(label = "listone-mio"): Promise<string> {
  const id = await makeUser(label);
  createdUsers.push(id);
  return id;
}

/**
 * Una riga piena: nessuna colonna lasciata al default, così il confronto di
 * ritorno le attraversa tutte.
 *
 * ⚠ `pma` e `fmvExp` sono `real`, cioè float a 32 bit: i valori sono scelti
 * **esattamente rappresentabili in binario** (`15.5`, `7.25`) perché il test
 * parli dello schema e non dell'arrotondamento di Postgres.
 */
function rigaPiena(userId: string, extId: number): NewUserListoneRow {
  return {
    userId,
    extId,
    obiettivo: true,
    fascia: "Top",
    fasciaRank: 0,
    pma: 15.5,
    fmvExp: 7.25,
    prezzo: 75,
    titolarita: 5,
    affidabilita: 5,
    integrita: 4,
    tags: ["modificatore", "tiratore", "titolarissimo"],
    commento: "abbinato al secondo portiere",
    uploadedAt: T0,
  };
}

async function righeDi(userId: string) {
  return db.select().from(userListone).where(eq(userListone.userId, userId));
}

// `pg` fa vero I/O: i timer finti del setup condiviso qui darebbero fastidio.
beforeEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  if (!dbUp) return;
  // Le righe se ne vanno in cascata con i loro utenti: è la proprietà che il
  // penultimo test verifica, e qui è anche la pulizia.
  await dropUsers(createdUsers);
  await closeDatabase();
});

suite.runIf(dbUp)("lo schema di user_listone", () => {
  it("torna indietro tutto quello che ci si mette, colonna per colonna", async () => {
    const me = await user();
    const riga = rigaPiena(me, EXT_ID_BASE + 1);

    await db.insert(userListone).values(riga);

    const [letta] = await righeDi(me);
    // ⚠ Le **chiavi** prima dei valori: è il confronto che si accorge di una
    // colonna aggiunta allo schema e mai spinta al database, o del contrario.
    expect(Object.keys(letta).sort()).toEqual([...COLONNE].sort());
    expect(letta).toEqual(riga);
  });

  /**
   * I due default di §2, e sono due decisioni diverse: `obiettivo` è `false`
   * perché «non è un mio obiettivo» *è* un'informazione — ed è ciò che permette
   * all'icona di stare su ogni riga senza un terzo stato — mentre `tags` è `[]`
   * perché una riga senza note ha zero note, non note ignote.
   */
  it("chi non dice niente ha obiettivo falso e nessuna nota", async () => {
    const me = await user();

    await db.insert(userListone).values({
      userId: me,
      extId: EXT_ID_BASE + 2,
      uploadedAt: T0,
    });

    const [letta] = await righeDi(me);
    expect(letta.obiettivo).toBe(false);
    expect(letta.tags).toEqual([]);
    // E tutto il resto è assente, non zero: lo zero del foglio è una riga non
    // compilata, e non deve diventare un voto (la nota di `carmy_players`).
    expect(letta).toMatchObject({
      fascia: null,
      fasciaRank: null,
      pma: null,
      fmvExp: null,
      prezzo: null,
      titolarita: null,
      affidabilita: null,
      integrita: null,
      commento: null,
    });
  });

  /**
   * ⚠ **La proprietà per cui questa tabella esiste**: due persone giudicano lo
   * stesso calciatore in due modi, e nessuna delle due vede l'altra. Se la
   * chiave primaria fosse `ext_id` da solo — cioè se fosse `carmy_players` — il
   * secondo import cancellerebbe il primo.
   */
  it("due utenti tengono due giudizi diversi sullo stesso giocatore", async () => {
    const me = await user("io");
    const altro = await user("altro");
    const extId = EXT_ID_BASE + 3;

    await db.insert(userListone).values([
      { ...rigaPiena(me, extId), fascia: "Top", obiettivo: true },
      { ...rigaPiena(altro, extId), fascia: "Quarta", obiettivo: false },
    ]);

    expect(await righeDi(me)).toMatchObject([
      { fascia: "Top", obiettivo: true },
    ]);
    expect(await righeDi(altro)).toMatchObject([
      { fascia: "Quarta", obiettivo: false },
    ]);
  });

  it("lo stesso utente non può avere due righe per lo stesso giocatore", async () => {
    const me = await user();
    const riga = rigaPiena(me, EXT_ID_BASE + 4);
    await db.insert(userListone).values(riga);

    // ⚠ Il messaggio di Drizzle dice solo «Failed query», con la query dentro:
    // il vincolo violato sta nella causa, che è l'errore di `pg`. Asserire sul
    // messaggio farebbe passare **qualunque** fallimento di quella `INSERT`.
    const errore = await db
      .insert(userListone)
      .values(riga)
      .then(
        () => null,
        (e: unknown) => e as { cause?: { code?: string; constraint?: string } },
      );

    expect(errore).not.toBeNull();
    expect(errore?.cause).toMatchObject({
      code: "23505",
      constraint: "user_listone_user_id_ext_id_pk",
    });
  });

  /**
   * ⚠ **La cascata, e perché non viola la regola 5.** «Mai un `DELETE`» vale su
   * `assignments` e `ledger`, dove un annullamento deve restare leggibile. Qui
   * non ci sono assegnazioni né crediti: è l'opinione di una persona su dei
   * calciatori, e senza quella persona non significa niente.
   */
  it("cancellare l'utente porta via il suo listone", async () => {
    const me = await user("effimero");
    await db.insert(userListone).values(rigaPiena(me, EXT_ID_BASE + 5));
    expect(await righeDi(me)).toHaveLength(1);

    await dropUsers([me]);
    createdUsers.splice(createdUsers.indexOf(me), 1);

    expect(await righeDi(me)).toHaveLength(0);
  });

  /**
   * ⚠ **Nessuna FOREIGN KEY verso `listone_players`, e non è una
   * dimenticanza.** È la stessa asimmetria di `carmy_players` e
   * `player_insights`: un `ext_id` che il listone non ha più semplicemente non
   * aggancia e non compare in tabella. Con un vincolo, invece, il **prossimo
   * caricamento del listone di sistema** fallirebbe per colpa del file
   * personale di qualcuno — cioè il file di una persona potrebbe impedire il
   * lavoro dell'amministratore.
   */
  it("accetta un ext_id che nel listone non esiste", async () => {
    const me = await user("orfano");

    await db.insert(userListone).values(rigaPiena(me, 999_999_999));

    expect(await righeDi(me)).toHaveLength(1);
  });

  /**
   * `uploaded_at` è la sola cosa che dice **quando** ho importato e **quante**
   * righe: è uguale su tutte le righe di un caricamento, come in
   * `listone_players` e `carmy_players`. È il motivo per cui non serve una
   * seconda tabella `user_listone_imports` (§2).
   */
  it("la data del caricamento sta su ogni riga, ed è la stessa", async () => {
    const me = await user("data");
    await db
      .insert(userListone)
      .values(
        Array.from({ length: 5 }, (_, i) =>
          rigaPiena(me, EXT_ID_BASE + 100 + i),
        ),
      );

    const righe = await righeDi(me);
    expect(righe).toHaveLength(5);
    expect(
      righe.every((r) => r.uploadedAt.getTime() === T0.getTime()),
    ).toBe(true);
  });

  /**
   * ⚠ **Sostituisce, non fonde**, ed è la forma che avrà il caricamento vero
   * (M21-06): `DELETE` dove `user_id = me`, poi gli `INSERT`. Qui si prova che
   * lo schema lo permette **senza toccare nessun altro** — la cancellazione di
   * un import è ristretta a una persona, e la riga dell'altro utente resta.
   */
  it("il proprio listone si sostituisce senza toccare quello degli altri", async () => {
    const me = await user("sostituisco");
    const altro = await user("spettatore");
    const extId = EXT_ID_BASE + 200;

    await db.insert(userListone).values([
      rigaPiena(me, extId),
      rigaPiena(altro, extId),
    ]);

    await db.delete(userListone).where(eq(userListone.userId, me));
    await db.insert(userListone).values({
      ...rigaPiena(me, extId),
      obiettivo: false,
      fascia: "Terza",
      uploadedAt: new Date("2026-08-29T10:00:00.000Z"),
    });

    // Un obiettivo tolto dal file è sparito davvero.
    const [mia] = await righeDi(me);
    expect(mia).toMatchObject({ obiettivo: false, fascia: "Terza" });
    // E l'altro non se n'è accorto.
    expect(
      await db
        .select()
        .from(userListone)
        .where(
          and(eq(userListone.userId, altro), eq(userListone.extId, extId)),
        ),
    ).toMatchObject([{ obiettivo: true, fascia: "Top" }]);
  });
});
