import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  type AuctionPhase,
  type AuctionStatus,
  type BotStrategy,
  type CodePurpose,
  ROLES,
  type Role,
} from "@/lib/domain";

/**
 * Schema Drizzle — traduzione fedele di PLAN §3.
 *
 * Tre cose da tenere a mente leggendolo:
 *
 * 1. **Tutti i timestamp sono TIMESTAMPTZ e il server gira in UTC** (PLAN §17).
 *    La conversione a Europe/Rome avviene solo in rendering: nessun `Date`
 *    naive da nessuna parte.
 * 2. **Il credito non è una colonna.** Non esiste `members.credits`: si calcola
 *    con `budget_initial + Σ ledger.delta − Σ assignments.price` sulle righe non
 *    annullate. Gli annullamenti sono `voided_at`, mai `DELETE`.
 * 3. **Il listone è copiato dentro l'asta.** `players.auction_id` congela la
 *    lista al momento dell'import: se il file cambia l'anno prossimo, le aste
 *    passate restano coerenti.
 *
 * Le due invarianti che qui diventano indici parziali — un solo lotto aperto per
 * asta (I1) e un solo proprietario per giocatore (I2) — sono l'unico modo di
 * renderle vere anche sotto concorrenza: nessun controllo applicativo può
 * garantirle da solo.
 */

// ─── Utenti ──────────────────────────────────────────────────────────────────

/**
 * ⚠ `is_admin` e `is_bot` sono **due permessi indipendenti su una persona**, non
 * un tipo di utente in due valori (M4). Un amministratore dell'applicazione
 * gioca le aste come tutti gli altri, ed è per questo che non c'è una colonna
 * sola a tre valori: modellerebbe «amministratore» come se fosse una specie.
 *
 * L'unica combinazione che due booleani permettono e che non deve esistere è
 * `is_admin AND is_bot`, e la vieta il `CHECK`. È la stessa logica degli indici
 * parziali di I1 e I2: se una regola si può rendere **impossibile** invece che
 * sorvegliata, si rende impossibile.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    googleSub: text("google_sub").unique(),
    email: text("email"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    /**
     * `scrypt$N$r$p$salt$hash` (M5 §5), oppure NULL per chi entra solo da
     * Google e per le righe senza persona dietro (bot, utenti del seed).
     */
    passwordHash: text("password_hash"),
    /**
     * Quando l'indirizzo è stato dimostrato: col codice a sei cifre, oppure
     * dall'asserzione `email_verified` di Google.
     *
     * ⚠ NULL significa **non verificato**, e un utente non verificato non fa
     * nulla (M5 §3): `requireUser()` lo manda a `/verify` prima di ogni altra
     * cosa. È per questo che il deploy di M5 pretende il backfill delle righe
     * già esistenti — nate tutte da Google, quindi verificate di fatto ma senza
     * nessuno che l'abbia mai scritto (M5 §10).
     */
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    isAdmin: boolean("is_admin").notNull().default(false),
    /**
     * Vede gli insight sul listone (M8): titolarità, rigoristi, piazzati.
     *
     * ⚠ **Non è una necessità di licenza** — le fonti sono pubbliche — ma una
     * scelta di prodotto: un vantaggio informativo che si riserva. Va detto qui
     * perché non venga difeso, un giorno, con un argomento che non ha.
     *
     * Chi è amministratore li vede comunque (`canSeeInsights` in `lib/domain.ts`),
     * altrimenti servirebbe auto-assegnarsi il flag per vedere i dati che si è
     * appena importati — e `lib/engine/admin.ts` vieta di toccare la propria riga.
     * Per questo **nessun `CHECK NOT (is_pro AND is_bot)`**: un bot pro è
     * insensato ma innocuo, mentre un bot amministratore è un conflitto vero, ed
     * è per quello che esiste `users_admin_not_bot_check`.
     */
    isPro: boolean("is_pro").notNull().default(false),
    /** Un partecipante simulato. Le sue mosse le decide il tick di `lib/engine/bots.ts`. */
    isBot: boolean("is_bot").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("users_admin_not_bot_check", sql`NOT (${t.isAdmin} AND ${t.isBot})`),
    /**
     * **L'email è la chiave d'identità** (M5 §2): una persona, una riga.
     *
     * Parziale su `email IS NOT NULL` perché le righe senza indirizzo — i bot,
     * gli utenti del seed prima che il seed gliene desse uno — restano legali e
     * non devono collidere fra loro.
     *
     * ⚠ Il vincolo è **qui e non nel codice**, come gli indici parziali di I1 e
     * I2: il giorno in cui sbaglio una `if`, Postgres rifiuta comunque. È ciò
     * che rende impossibile — non sorvegliato — il caso in cui la stessa persona
     * si presenta dalle due porte e si ritrova due dashboard.
     */
    uniqueIndex("users_email_lower_unique")
      .on(sql`lower(${t.email})`)
      .where(sql`${t.email} IS NOT NULL`),
  ],
);

/**
 * I codici a sei cifre mandati per email: verifica dell'indirizzo e recupero
 * della password, **una tabella sola** (M5 §4).
 *
 * ⚠ `code_hash` è uno sha256, e va detto cosa non è: con sei cifre l'entropia è
 * un milione, quindi chi ha il database rompe l'hash in un secondo. Non serve a
 * quello. Serve a **non lasciare credenziali vive dentro un `pg_dump`**, in una
 * riga di log, in uno screenshot di una tabella. Le difese vere sono le altre
 * colonne: `expires_at` (quindici minuti), `attempts` (cinque, poi il codice è
 * bruciato) e `consumed_at`, più la regola che un codice nuovo consuma il
 * precedente — venti reinvii non devono diventare venti chiavi valide.
 */
export const emailCodes = pgTable(
  "email_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").$type<CodePurpose>().notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Le due query che esistono: «il codice vivo di questo utente per questo
    // scopo» e «quando gliene ho mandato uno l'ultima volta» (il rate limit sul
    // reinvio, che vive nel database e sopravvive a un riavvio del processo).
    index("email_codes_user_purpose_idx").on(
      t.userId,
      t.purpose,
      t.createdAt.desc(),
    ),
  ],
);

// ─── Asta ────────────────────────────────────────────────────────────────────

export const auctions = pgTable(
  "auctions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    /** Token della vista TV: `/tv/[publicToken]`, senza login. */
    publicToken: text("public_token").notNull().unique(),

    status: text("status").$type<AuctionStatus>().notNull().default("DRAFT"),
    phase: text("phase").$type<AuctionPhase>(),
    /** Incrementato ad OGNI transizione: il client scarta gli snapshot vecchi. */
    stateVersion: integer("state_version").notNull().default(0),

    seats: integer("seats").notNull(),
    budgetDefault: integer("budget_default").notNull().default(500),
    bidSeconds: integer("bid_seconds").notNull().default(30),
    pickSeconds: integer("pick_seconds").notNull().default(30),
    tiePrepSeconds: integer("tie_prep_seconds").notNull().default(10),
    revealSeconds: integer("reveal_seconds").notNull().default(10),
    slotsP: integer("slots_p").notNull().default(3),
    slotsD: integer("slots_d").notNull().default(8),
    slotsC: integer("slots_c").notNull().default(8),
    slotsA: integer("slots_a").notNull().default(6),

    /**
     * Ordine dei ruoli scelto alla creazione (drag & drop). Permutazione
     * completa di P,D,C,A. Il primo elemento **è** il ruolo iniziale dell'asta.
     */
    roleOrder: text("role_order")
      .array()
      .$type<Role[]>()
      .notNull()
      .default([...ROLES]),

    /**
     * Se i giocatori marcati "Fuori lista" entrano nel pool acquistabile
     * (DECISIONS, P7). Ogni modifica rivalida I9.
     */
    includeOutOfList: boolean("include_out_of_list").notNull().default(false),

    /**
     * Un'asta di prova, i cui posti si riempiono di bot (M4).
     *
     * ⚠ **Si scrive alla creazione e non cambia più**: `updateAuctionSettings`
     * non la conosce, e non esiste nessuna via per accenderla dopo. È ciò che
     * rende *strutturalmente* impossibile che dei bot finiscano in un'asta
     * vera — non un controllo da ricordarsi, l'assenza della strada.
     */
    isSimulated: boolean("is_simulated").notNull().default(false),

    currentRole: text("current_role").$type<Role>(),
    currentSeatIndex: integer("current_seat_index"),
    /**
     * Volutamente senza FOREIGN KEY verso `lots`: `lots.auction_id` punta già
     * qui e la coppia di vincoli renderebbe circolare la creazione dello schema
     * (e la cancellazione di un'asta). PLAN §3 non la richiede.
     */
    currentLotId: uuid("current_lot_id"),
    phaseDeadline: timestamp("phase_deadline", { withTimezone: true }),
    /** Valorizzato solo con `status = 'PAUSED'`. */
    pausedAt: timestamp("paused_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    check("auctions_seats_check", sql`${t.seats} IN (8, 10, 12)`),
    index("auctions_owner_idx").on(t.ownerUserId),
  ],
);

// ─── Membri ──────────────────────────────────────────────────────────────────

export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    auctionId: uuid("auction_id")
      .notNull()
      .references(() => auctions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    teamName: text("team_name").notNull(),
    /** Ordine di rotazione, 0-based, assegnato in ordine di join (P13). */
    seatIndex: integer("seat_index").notNull(),
    budgetInitial: integer("budget_initial").notNull(),
    /**
     * Come offre questo membro, se è un bot; `null` per una persona (M4). Sta
     * qui e non su `users` perché lo stesso bot gioca due aste con due
     * strategie diverse — ed è quello che permette l'asta tutta in pareggio.
     */
    botStrategy: text("bot_strategy").$type<BotStrategy>(),
    /** Telemetria di presence: si scrive fuori da `withAuctionLock` (P8). */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    isVisible: boolean("is_visible").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("members_auction_user_unique").on(t.auctionId, t.userId),
    unique("members_auction_seat_unique").on(t.auctionId, t.seatIndex),
  ],
);

// ─── Inviti ──────────────────────────────────────────────────────────────────

export const invites = pgTable("invites", {
  token: text("token").primaryKey(),
  auctionId: uuid("auction_id")
    .notNull()
    .references(() => auctions.id, { onDelete: "cascade" }),
  createdByUserId: uuid("created_by_user_id")
    .notNull()
    .references(() => users.id),
  /**
   * `expires_at` e `max_uses` restano di default vuoti: il link vale per
   * chiunque finché l'asta è in DRAFT/READY (DECISIONS 2026-08-06). La
   * protezione vera è che gli inviti muoiono all'avvio dell'asta (PLAN §17).
   */
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  maxUses: integer("max_uses"),
  uses: integer("uses").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Listone (snapshot per asta) ─────────────────────────────────────────────

export const players = pgTable(
  "players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    auctionId: uuid("auction_id")
      .notNull()
      .references(() => auctions.id, { onDelete: "cascade" }),
    /** La colonna `#` del file Fantacalcio.it. */
    extId: integer("ext_id").notNull(),
    name: text("name").notNull(),
    team: text("team").notNull(),
    role: text("role").$type<Role>().notNull(),
    roleMantra: text("role_mantra"),
    fvm: integer("fvm").notNull(),
    quot: integer("quot").notNull(),
    outOfList: boolean("out_of_list").notNull().default(false),
  },
  (t) => [
    unique("players_auction_ext_unique").on(t.auctionId, t.extId),
    // L'ordinamento esatto dell'auto-pick: fvm DESC, quot DESC, ext_id ASC.
    index("players_autopick_idx").on(
      t.auctionId,
      t.role,
      t.fvm.desc(),
      t.quot.desc(),
      t.extId.asc(),
    ),
  ],
);

// ─── Il listone a sistema (globale, non per asta) ────────────────────────────

/**
 * Il listone dell'applicazione: l'export **Leghe** di Fantacalcio.it caricato una
 * volta sola dal pannello, da cui si copia dentro le aste (M10).
 *
 * ⚠ **Si chiama `listone_players` e non `listone`, ed è deliberato.** Nel
 * pannello la parola «listone» indica **due file diversi** (M10 §1): questo, che
 * definisce un'asta e si carica a mano perché l'export passa da un login, e la
 * `GET` pubblica di Fantalab che riempie `player_insights`. Una tabella che si
 * chiama come un concetto ambiguo è una tabella che qualcuno userà per la cosa
 * sbagliata. Il menu dice `Listone`, lo schema dice di quali righe si tratta.
 *
 * ⚠ **È una sorgente da cui si copia, mai una tabella da cui l'asta legge**
 * (M10 §3). `players.auction_id` continua a congelare il listone al momento
 * dell'import, e un'asta preparata lunedì non cambia perché martedì qualcuno ha
 * caricato un file nuovo. Se un `JOIN` verso questa tabella compare in
 * `lib/engine/machine.ts`, `rules.ts`, `snapshot.ts` o in `listPickPool`, il
 * lavoro è fuori posto. Conseguenza che il codice deve rispettare: **un'asta si
 * crea, si prepara e arriva a `COMPLETED` con questa tabella vuota.**
 *
 * Un upload **sostituisce l'intera tabella** (`DELETE` + `INSERT` in
 * transazione), come `importPlayers` sostituisce lo snapshot di un'asta. Non
 * viola la regola 5: qui non ci sono assegnazioni né ledger, è un elenco di
 * calciatori di Serie A, e sostituirlo è l'unico modo di correggere un file
 * sbagliato senza inventare un merge fra due listoni.
 */
export const listonePlayers = pgTable("listone_players", {
  /** La colonna `#` del file: la stessa chiave di `players.ext_id` e di `player_insights.ext_id`. */
  extId: integer("ext_id").primaryKey(),
  name: text("name").notNull(),
  team: text("team").notNull(),
  role: text("role").$type<Role>().notNull(),
  roleMantra: text("role_mantra"),
  /**
   * ⚠ **C'è anche se il Centro dati non lo mostra** (M10 §2), e questa è la
   * trappola numero uno della macro. La decisione dell'owner («FVM togli»)
   * riguarda una colonna di una tabella a schermo, non il dato:
   * `players_autopick_idx` ordina per **`fvm` DESC, `quot` DESC, `ext_id` ASC**,
   * e quell'ordinamento *è* l'auto-pick. Una copia verso `players` senza `fvm`
   * cambierebbe chi viene scelto allo scadere di una chiamata, per una scelta di
   * layout.
   */
  fvm: integer("fvm").notNull(),
  quot: integer("quot").notNull(),
  /**
   * ⚠ **Obbligatorio, ed è l'altro campo da non perdere.** Senza,
   * `validateRolePool` conta i giocatori sbagliati (I9) e il toggle
   * `include_out_of_list` (P7) non ha niente su cui lavorare. È anche il campo
   * che **impedisce** di costruire questa tabella dal file *Quotazioni*, che è
   * pubblico ma non ce l'ha (M10 §1, DECISIONS 2026-08-12).
   */
  outOfList: boolean("out_of_list").notNull().default(false),
  /**
   * Quando è stato caricato il file da cui viene questa riga. Uguale su tutte le
   * righe di uno stesso upload: è la data che l'owner legge alla creazione di
   * un'asta per decidere se usare questo listone o caricarne uno suo.
   */
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull(),
});

// ─── Insight sul listone (globale, non per asta) ──────────────────────────────

/**
 * Cosa dicono le fonti pubbliche di un calciatore: quanto è partito titolare,
 * se batte i rigori, se batte i piazzati (M8).
 *
 * ⚠ **Sta accanto a `players` ma non ne segue il ciclo di vita, ed è il punto
 * più importante di questa tabella.** `players` è un *snapshot per asta*:
 * `auction_id` congela il listone al momento dell'import e le righe muoiono in
 * cascata con l'asta. Qui no: la chiave è `ext_id` e nient'altro, un refresh
 * dall'admin serve **tutte** le aste, e i dati sopravvivono alla cancellazione
 * di un'asta. Il precedente è l'archivio figurine di M7, tenuto fuori dal ciclo
 * dell'asta per la stessa ragione: un dato di mercato non è un fatto dell'asta.
 *
 * Conseguenza che il codice deve rispettare: **l'asta funziona con questa
 * tabella vuota.** Si legge in `LEFT JOIN`, mai in `INNER JOIN`, e nessun
 * percorso critico la attraversa. In produzione nasce vuota e resta vuota
 * finché qualcuno non preme i pulsanti del pannello.
 *
 * E i due elenchi **non coincidono**: dei 495 `ext_id` del listone di prova, 487
 * trovano una riga qui (98,4%) e la fonte ne ha 10 che il listone non ha. La
 * copertura si misura contro il listone dell'asta, non contro il conteggio della
 * fonte.
 */
export const playerInsights = pgTable("player_insights", {
  /** La colonna `#` del file Fantacalcio.it — la stessa di `players.ext_id`. */
  extId: integer("ext_id").primaryKey(),
  /**
   * L'uuid Fantalab (`player_id`). Non lo legge nessuno oggi: è l'unico modo di
   * ritrovare la stessa riga se un giorno la fonte cambiasse l'id pubblico.
   */
  fantalabId: uuid("fantalab_id"),
  fullName: text("full_name"),
  /**
   * Il nome **corto** della fonte A (`name`): «Abankwah», dove `full_name` scrive
   * «James Abankwah».
   *
   * ⚠ **Non serve a nessun join** — quello di M10B passa da `listone_players`
   * (§3) — e per questo è facile crederla inutile. Serve a **spiegare** un
   * aggancio mancato: Carmy e il listone scrivono il nome corto, e senza questa
   * colonna l'unico modo di capire perché dieci nomi non agganciano è riaprire a
   * mano la risposta della fonte. Nasce `null` sulle righe già in tabella e si
   * riempie al primo refresh: nessun backfill dedicato, perché nessuna schermata
   * la pretende.
   */
  name: text("name"),
  team: text("team").notNull(),

  /**
   * ⚠ **A quale stagione appartengono i numeri qui sotto**: `"current"` o
   * `"previous"`, copiato da `display_stats_season`.
   *
   * Non è una raffinatezza. Nella risposta della fonte le due stagioni
   * **convivono** — misurati 329 `current` e 168 `previous` — e senza questa
   * colonna un numero del 24/25 finirebbe accanto a uno del 25/26 senza che
   * nessuno possa accorgersene. La UI mostra solo i `current` (M8 §5).
   */
  statsSeason: text("stats_season").notNull(),

  /**
   * Fonte A, `api.fantalab.it/v2/listone`. `presenze` viene da
   * `display_presenze`, cioè il numero che la fonte stessa mostra: in 32 righe
   * differisce da `presenze`, e sono tutte `previous`.
   */
  presenze: integer("presenze").notNull(),
  startsEleven: integer("starts_eleven").notNull(),
  minPlayingTime: integer("min_playing_time").notNull(),
  rigoriFatti: integer("rigori_fatti").notNull(),
  rigoriSbagliati: integer("rigori_sbagliati").notNull(),
  rigoriParati: integer("rigori_parati").notNull(),
  fmvHome: real("fmv_home"),
  fmvAway: real("fmv_away"),

  /**
   * Fonte B, `fantacalcio.it/rigoristi-serie-a`. `1` = primo della gerarchia,
   * `null` = non designato — che è un'informazione, non un dato mancante.
   *
   * Sono **due** e non tre: la pagina ha esattamente le liste «Rigori» e «Calci
   * piazzati», e la parola «Punizioni» non compare nel suo HTML.
   */
  rigoristaRank: integer("rigorista_rank"),
  piazzatiRank: integer("piazzati_rank"),

  /** Due timestamp perché due fonti indipendenti: il pannello dice quale è vecchia. */
  listoneUpdatedAt: timestamp("listone_updated_at", { withTimezone: true }),
  setPiecesUpdatedAt: timestamp("set_pieces_updated_at", { withTimezone: true }),
});

// ─── Il giudizio di un umano (globale, non per asta) ──────────────────────────

/**
 * Il foglio di Carmy: un giudizio su ogni calciatore, compilato a mano da una
 * persona e caricato dal pannello (M10B).
 *
 * ⚠ **Perché una tabella sua e non tre colonne su `player_insights`**, che pure
 * ospita già due fonti diverse (M10B §5): perché quelle due si aggiornano **per
 * colonna con un `upsert`** — la fonte A scrive le statistiche, la fonte B i due
 * rank, e nessuna delle due tocca le colonne dell'altra — mentre questa si
 * **sostituisce per intero** a ogni caricamento, come `listone_players`.
 * Mescolarle vorrebbe dire che il refresh giornaliero e un file umano scrivono
 * nella stessa riga con due semantiche diverse, ed è il punto in cui qualcuno,
 * fra sei mesi, cancella i giudizi con una `GET`.
 *
 * ⚠ **Non c'è `ext_id` nel file.** La chiave qui è comunque `ext_id`, ma **la
 * mette il join**: Carmy ha `Nome` e una sigla di tre lettere, e si aggancia per
 * nome normalizzato a `listone_players` (§3). Conseguenza: un giocatore che non
 * sta nel listone **non entra qui**, e questo è voluto — un giudizio su qualcuno
 * che non si può comprare non serve a nessuno.
 *
 * Come `player_insights` e `listone_players`: **l'asta funziona con questa tabella
 * vuota**, si legge in `LEFT JOIN` e nessun percorso critico la attraversa.
 * Un'asta si crea, si prepara e arriva a `COMPLETED` senza che qui ci sia una riga.
 */
export const carmyPlayers = pgTable("carmy_players", {
  /** L'`ext_id` del listone a cui il nome ha agganciato: non viene dal file. */
  extId: integer("ext_id").primaryKey(),
  /**
   * Il nome come lo scrive Carmy, e la sigla della sua squadra: servono a
   * **spiegare** un aggancio, non ad agganciare. La sigla è il *controllo* di §3 —
   * una discordanza con la squadra del listone si segnala, non si ingoia.
   */
  sourceName: text("source_name").notNull(),
  sourceTeam: text("source_team").notNull(),
  fascia: text("fascia"),
  /**
   * Il prezzo consigliato in crediti.
   *
   * ⚠ **`null` quando il foglio scrive `0`, e non è pignoleria**: nel file del
   * 2026-08-12 sono **73 giocatori su 497** — riserve e terzi portieri, tutti con
   * `PMA` a `"0%"` — e **zero non è nemmeno un'offerta valida**. Un «prezzo
   * consigliato: 0» accanto al campo dell'offerta sarebbe un suggerimento
   * impossibile da seguire (M10B-02, DECISIONS 2026-08-12).
   */
  prezzo: integer("prezzo"),
  /**
   * Il `PMA` del foglio, in **punti percentuali** (`10.5` sta per «10,5%»).
   *
   * ⚠ **La spec di M10B l'aveva scartata chiamandola «un dato derivato, `Prezzo`
   * diviso il budget». È falso, ed è stato misurato quando l'owner l'ha chiesta
   * (2026-08-12):** solo **132 righe su 385** coincidono con
   * `round(prezzo / 5, 1)`. Le altre no, e non di poco — Di Gregorio costa 41 con un
   * `PMA` di 2,5% (da `prezzo` verrebbe 8,2), De Gea costa 24 con 6,4% (verrebbe
   * 4,8), Mkhitaryan costa 14 con 0,2%. La correlazione coi prezzi è alta (**0,969**,
   * perché entrambe seguono il valore di un giocatore) e il rapporto ha mediana
   * esattamente 5 — ma quella mediana la fanno i **166 giocatori da un credito**,
   * dove `0,2%` è l'unico valore scrivibile. **Sono due numeri diversi**, e il
   * secondo porta informazione che il primo non ha.
   *
   * Cosa significhi esattamente lo sa chi compila il foglio, e **non si indovina
   * qui**: si importa quello che c'è scritto e si mostra con la sua etichetta. Il
   * fatto strutturale che serve al codice è uno solo — **non si ricalcola da
   * `prezzo`**, perché ricalcolarla vorrebbe dire sostituire il dato di qualcun
   * altro con una nostra stima.
   *
   * La cella è **testo battuto a mano** (`"10.5%"`, nessuna formula: verificato sui
   * byte), da cui il parser prende il numero. `null` quando il foglio scrive `0%`,
   * come per tutto il resto. ⚠ E i due zeri **non coincidono**: 67 righe hanno `PMA`
   * a zero, 73 hanno `prezzo` a zero, in comune 28 — l'ennesima prova che sono due
   * colonne indipendenti.
   */
  pma: real("pma"),
  /**
   * I tre giudizi, da 1 a 5.
   *
   * ⚠ **`null` anche qui quando il foglio scrive `0`.** Lo `0` non è un voto
   * basso: è una riga non compilata — nel file del 2026-08-12 è **una sola**
   * (Aurelio, con tutti e tre gli zeri, `MV` a zero e la fantamedia attesa vuota),
   * e trattarla come «titolarità 0» la farebbe passare per il peggior giocatore
   * del listone invece che per un giocatore su cui non c'è giudizio.
   */
  titolarita: integer("titolarita"),
  affidabilita: integer("affidabilita"),
  integrita: integer("integrita"),
  /** La fantamedia attesa. 494 righe su 497 nel file del 2026-08-12. */
  fmvExp: real("fmv_exp"),
  /** Le cinque note del foglio, già ripulite e senza i vuoti. */
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  /** Testo libero, multi-riga, su dieci giocatori: gli abbinamenti dei portieri. */
  commento: text("commento"),
  /** Uguale su tutte le righe di uno stesso caricamento, come in `listone_players`. */
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull(),
});

// ─── Come sono andate le due fonti pubbliche (globale, non per asta) ─────────

/**
 * L'ultimo tentativo di aggiornamento di ciascuna fonte pubblica (M11 §5).
 *
 * ⚠ **Due righe, per sempre, e non uno storico.** La chiave primaria è il nome
 * della fonte: `"listone_insights"` e `"set_pieces"`. Ogni tentativo fa un
 * `upsert` sulla sua riga. Nessuno ha chiesto la cronologia dei tentativi, e la
 * domanda a cui il pannello deve rispondere è una sola — *l'ultimo tentativo è
 * andato bene?* (regola 8: lo storico si aggiunge il giorno che qualcuno vuole
 * leggerlo).
 *
 * ⚠ **Perché esiste**: con i due pulsanti di M8 l'errore lo legge la persona che
 * ha premuto. Dal momento in cui il refresh parte da sé, un `SOURCE_SCHEMA`
 * finirebbe in `console.error` e non lo vedrebbe **nessuno** — e i numeri
 * invecchierebbero senza dire niente, che è esattamente il guasto che M11 esiste
 * per togliere. Questa tabella è il posto in cui l'automatismo dice «ho provato e
 * non ci sono riuscito».
 *
 * ⚠ **`attempted_at` è l'ultimo *tentativo*, non l'ultimo *successo***, ed è la
 * colonna su cui si fa il conto della scadenza (M11 §3). Contare dall'ultimo
 * successo sembrerebbe naturale e produrrebbe **novantasei richieste al giorno**
 * verso un sito di terzi ogni volta che la fonte è giù: il quando-riprovare si
 * legge da qui e da `failures`, non da `player_insights.listone_updated_at`.
 *
 * ⚠ **Ci scrivono anche i due pulsanti**, con `trigger: "manual"`. Se scrivesse
 * solo l'automatismo, il pannello racconterebbe una storia e la realtà un'altra:
 * premo il pulsante, riesce, e la pagina continua a dire «ultimo tentativo
 * fallito ieri».
 *
 * ⚠ **Un tick saltato non è un tentativo**: quando la guardia sull'asta reale
 * ferma il giro, o quando la fonte B viene saltata perché `player_insights` è
 * vuota, qui non si scrive niente. Registrarlo manderebbe una fonte in backoff
 * per un guasto che non c'è stato (M11 §4 e §7).
 *
 * Nasce **vuota** e va bene così: «nessun tentativo registrato» è lo stato
 * iniziale corretto, ed è la condizione che fa partire il primo tick subito.
 */
export const sourceRuns = pgTable("source_runs", {
  /** `"listone_insights"` o `"set_pieces"`. */
  source: text("source").$type<"listone_insights" | "set_pieces">().primaryKey(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull(),
  ok: boolean("ok").notNull(),
  /** Il messaggio del `Result`, così com'è: è già scritto per essere letto. */
  message: text("message"),
  /** Righe lette dalla fonte, quando è andata bene. */
  rows: integer("rows"),
  /** Quanti fallimenti di fila: decide il backoff (§3) **e** si mostra (§5). */
  failures: integer("failures").notNull().default(0),
  /** `"auto"` o `"manual"`: due storie nello stesso posto sarebbero due verità. */
  trigger: text("trigger").$type<"auto" | "manual">().notNull(),
});

// ─── Lotti (una chiamata all'asta) ───────────────────────────────────────────

export const lots = pgTable(
  "lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    auctionId: uuid("auction_id")
      .notNull()
      .references(() => auctions.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    calledByMemberId: uuid("called_by_member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    autoCalled: boolean("auto_called").notNull().default(false),
    status: text("status").$type<"OPEN" | "RESOLVED">().notNull(),
    currentRound: integer("current_round").notNull().default(1),
    winnerMemberId: uuid("winner_member_id").references(() => members.id, {
      onDelete: "cascade",
    }),
    finalPrice: integer("final_price"),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    unique("lots_auction_seq_unique").on(t.auctionId, t.seq),
    // I1 — al massimo un lotto aperto per asta, garantito dal database.
    uniqueIndex("one_open_lot_per_auction")
      .on(t.auctionId)
      .where(sql`${t.status} = 'OPEN'`),
  ],
);

// ─── Round di offerta ────────────────────────────────────────────────────────

export const lotRounds = pgTable(
  "lot_rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => lots.id, { onDelete: "cascade" }),
    /** 1 = round base, 2 = spareggio. Non esiste un round 3. */
    roundNo: integer("round_no").notNull(),
    minAmount: integer("min_amount").notNull().default(1),
    startsAt: timestamp("starts_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [unique("lot_rounds_lot_round_unique").on(t.lotId, t.roundNo)],
);

export const roundEligibility = pgTable(
  "round_eligibility",
  {
    lotRoundId: uuid("lot_round_id")
      .notNull()
      .references(() => lotRounds.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.lotRoundId, t.memberId] })],
);

// ─── Offerte ─────────────────────────────────────────────────────────────────

export const bids = pgTable(
  "bids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lotRoundId: uuid("lot_round_id")
      .notNull()
      .references(() => lotRounds.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    /**
     * Quando è stata fissata **questa** cifra, non quando è nata la riga:
     * è il timestamp che decide lo spareggio in caso di stallo, e sopravvive
     * al carry-forward nel round 2.
     */
    amountSetAt: timestamp("amount_set_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  },
  (t) => [
    check("bids_amount_check", sql`${t.amount} >= 1`),
    // L'override di un'offerta è un UPDATE, non una riga nuova.
    unique("bids_round_member_unique").on(t.lotRoundId, t.memberId),
  ],
);

// ─── Rose ────────────────────────────────────────────────────────────────────

export const assignments = pgTable(
  "assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    auctionId: uuid("auction_id")
      .notNull()
      .references(() => auctions.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    price: integer("price").notNull(),
    lotId: uuid("lot_id").references(() => lots.id, { onDelete: "cascade" }),
    source: text("source").$type<"AUCTION" | "MANUAL">().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** L'annullamento è questo. Mai un DELETE. */
    voidedAt: timestamp("voided_at", { withTimezone: true }),
  },
  (t) => [
    // I2 — un giocatore ha al massimo un proprietario non annullato.
    uniqueIndex("one_owner_per_player")
      .on(t.auctionId, t.playerId)
      .where(sql`${t.voidedAt} IS NULL`),
    index("assignments_member_idx").on(t.memberId),
  ],
);

// ─── Rettifiche budget ───────────────────────────────────────────────────────

export const ledger = pgTable(
  "ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    auctionId: uuid("auction_id")
      .notNull()
      .references(() => auctions.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("ledger_member_idx").on(t.memberId)],
);

// ─── Audit ───────────────────────────────────────────────────────────────────

/**
 * La memoria dell'asta. Quando qualcosa andrà storto in diretta, questa tabella
 * sarà l'unica cosa che permetterà di capire cosa è successo (PLAN §14.8).
 */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    auctionId: uuid("auction_id")
      .notNull()
      .references(() => auctions.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("events_auction_idx").on(t.auctionId, t.id)],
);

// ─── Tipi inferiti ───────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type EmailCode = typeof emailCodes.$inferSelect;
export type Auction = typeof auctions.$inferSelect;
export type NewAuction = typeof auctions.$inferInsert;
export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;
export type Invite = typeof invites.$inferSelect;
export type NewInvite = typeof invites.$inferInsert;
export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type PlayerInsightRow = typeof playerInsights.$inferSelect;
export type NewPlayerInsightRow = typeof playerInsights.$inferInsert;
export type CarmyPlayerRow = typeof carmyPlayers.$inferSelect;
export type NewCarmyPlayerRow = typeof carmyPlayers.$inferInsert;
export type SourceRunRow = typeof sourceRuns.$inferSelect;
export type Lot = typeof lots.$inferSelect;
export type LotRound = typeof lotRounds.$inferSelect;
export type Bid = typeof bids.$inferSelect;
export type Assignment = typeof assignments.$inferSelect;
export type LedgerEntry = typeof ledger.$inferSelect;
export type AuctionEventRow = typeof events.$inferSelect;
