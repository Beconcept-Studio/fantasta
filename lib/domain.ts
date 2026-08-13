/**
 * Il vocabolario dell'asta: ruoli, stati, tagli di partecipanti.
 *
 * Sta in un file suo, e non dentro `lib/db/schema.ts`, per due ragioni che si
 * sono manifestate insieme:
 *
 * 1. **La regola ESLint su `lib/db` è assoluta e deve restarlo.** Una pagina che
 *    scrive `import { ROLES } from "@/lib/db/schema"` non sta facendo niente di
 *    male, ma nessun linter sa distinguerla da una che apre una query — e la
 *    regola vale proprio perché non ammette eccezioni discrezionali.
 * 2. **Il bundle del client.** `schema.ts` tira dentro `drizzle-orm/pg-core`:
 *    importarlo da un componente `"use client"` per quattro stringhe farebbe
 *    viaggiare fino al telefono un ORM che al telefono non serve.
 *
 * Qui dentro non c'è nessuna dipendenza: sono i nomi delle cose.
 */

export const ROLES = ["P", "D", "C", "A"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  P: "Portieri",
  D: "Difensori",
  C: "Centrocampisti",
  A: "Attaccanti",
};

/** Il singolare, per le frasi: «chiama un portiere», non «chiama un Portieri». */
export const ROLE_LABELS_ONE: Record<Role, string> = {
  P: "portiere",
  D: "difensore",
  C: "centrocampista",
  A: "attaccante",
};

export const AUCTION_STATUSES = [
  "DRAFT",
  "READY",
  "LIVE",
  "PAUSED",
  "COMPLETED",
] as const;
export type AuctionStatus = (typeof AUCTION_STATUSES)[number];

export const AUCTION_PHASES = [
  "WAITING_PICK",
  "LOT_OPEN",
  "LOT_TIE_PREP",
  "LOT_REVEAL",
] as const;
export type AuctionPhase = (typeof AUCTION_PHASES)[number];

/** I tagli ammessi di partecipanti: segmented control, mai input libero. */
export const SEAT_OPTIONS = [8, 10, 12] as const;
export type SeatCount = (typeof SEAT_OPTIONS)[number];

// ─── Simulazione (M4) ────────────────────────────────────────────────────────

/**
 * Come si comporta un bot dentro un round. Sta su `members.bot_strategy`, cioè
 * **sul membro e non sull'utente-bot**: se «Bot 3» fosse aggressivo per sempre
 * le identità sarebbero più riconoscibili, ma si perderebbe l'asta con tutti in
 * pareggio — l'unico modo di innescare uno spareggio a comando, che a mano è
 * quasi impossibile riprodurre.
 */
export const BOT_STRATEGIES = ["random", "aggressive", "passive", "tie"] as const;
export type BotStrategy = (typeof BOT_STRATEGIES)[number];

export const BOT_STRATEGY_LABELS: Record<BotStrategy, string> = {
  random: "Verosimile",
  aggressive: "Aggressivo",
  passive: "Prudente",
  tie: "Pareggio",
};

/**
 * Come si riempie un'asta: una strategia uguale per tutti, oppure un misto.
 *
 * «Tutti in pareggio» non è una curiosità: è l'unico modo di innescare uno
 * spareggio a comando. Per questo `tie` resta selezionabile per tutti e **non**
 * entra nel misto — un solo bot in pareggio è solo un bot che offre sempre
 * dieci.
 */
export const BOT_FILL_MIX = "mix";
export type BotFill = BotStrategy | typeof BOT_FILL_MIX;

/** `random` due volte su quattro: un misto verosimile pende verso il mezzo. */
const MIXED_STRATEGIES: BotStrategy[] = [
  "random",
  "aggressive",
  "random",
  "passive",
];

/** La strategia dell'i-esimo bot aggiunto. */
export function strategyFor(fill: BotFill, index: number): BotStrategy {
  if (fill !== BOT_FILL_MIX) return fill;
  return MIXED_STRATEGIES[index % MIXED_STRATEGIES.length];
}

/** Il marchio di un'asta di prova, ovunque la si guardi. */
export const SIMULATION_BADGE = "simulazione";

// ─── Identità (M5) ───────────────────────────────────────────────────────────

/**
 * A cosa serve un codice a sei cifre mandato per email.
 *
 * Sta qui e **non** nello schema per la stessa ragione di tutto il resto del
 * vocabolario: una pagina che deve dire «ti ho mandato un codice per entrare»
 * non può importare `lib/db/schema.ts`.
 *
 * I due valori nascono insieme (M5 §4): la verifica dell'indirizzo e il
 * recupero della password usano la stessa macchina — stessa tabella, stessa
 * scadenza, stessi cinque tentativi — e sono quindi due chiamanti veri, non
 * un'astrazione preparata per un chiamante che forse arriverà (regola 8).
 */
export const CODE_PURPOSES = ["VERIFY_EMAIL", "RESET_PASSWORD"] as const;
export type CodePurpose = (typeof CODE_PURPOSES)[number];

/**
 * L'indirizzo email, normalizzato: `trim` e `lower`, **e nient'altro**.
 *
 * Niente punti tolti a Gmail, niente `+tag` scartato: sono convenzioni di un
 * provider, non regole dell'email, e indovinarle vorrebbe dire trattare due
 * indirizzi diversi come lo stesso. Questa funzione è la definizione
 * applicativa di ciò che a database è l'indice `UNIQUE` su `lower(email)`: le
 * due devono restare d'accordo.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Una forma di indirizzo plausibile — qualcosa@qualcosa.qualcosa, senza spazi.
 *
 * Non è una validazione forte e non prova a esserlo: **l'unica prova che un
 * indirizzo esiste è il codice che ci arriva sopra**. Serve a fermare gli
 * errori di battitura prima di spendere un invio, non a decidere chi è valido.
 */
export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value) && value.length <= 254;
}

/**
 * Il nome che si legge in giro per l'applicazione: `trim`, spazi interni
 * collassati, fra 3 e 60 caratteri. `null` se non è accettabile.
 *
 * Stava dentro `setDisplayName` in `lib/auth.ts`, dove è nata con l'onboarding.
 * È salita qui in M6, quando il secondo chiamante è arrivato davvero (regola 8):
 * l'amministratore che corregge l'«asdf» scritto da un amico deve applicare
 * **la stessa** regola dell'onboarding, altrimenti esistono due idee di nome
 * valido e la seconda le scavalca la prima.
 *
 * Accetta `unknown` perché i due chiamanti ricevono entrambi una `FormData`, e
 * il posto giusto per rifiutare ciò che non è una stringa è la regola, non il
 * chiamante.
 */
export function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 3 || name.length > 60) return null;
  return name;
}

/**
 * L'amministratore **dell'applicazione**, che non è l'owner di un'asta.
 *
 * ⚠ In questo progetto «owner» è già chi possiede *un'asta*: conduce la sua e
 * basta. L'amministratore è un permesso su una persona — gioca le aste come
 * tutti gli altri — e in M4 può fare una cosa sola: creare aste simulate e
 * riempirle di bot. Cosa altro potrà fare si deciderà quando servirà.
 *
 * Il parametro è strutturale di proposito: così una pagina chiede «è un
 * amministratore?» senza importare il tipo `User` da `lib/db/schema`, che è
 * esattamente ciò che la regola ESLint su `lib/db` vieta.
 */
export function isAppAdmin(
  user: { isAdmin: boolean } | null | undefined,
): boolean {
  return user?.isAdmin === true;
}

// ─── Insight sul listone (M8) ────────────────────────────────────────────────

/**
 * Cosa sappiamo di un calciatore oltre alla sua quotazione.
 *
 * È la forma con cui gli insight viaggiano fino al browser: la stessa colonna
 * per colonna di `player_insights`, ma dichiarata **qui** e non dedotta dallo
 * schema, perché la legge un client component e `lib/db` nel bundle non ci deve
 * entrare. Le due definizioni devono restare d'accordo, e il test del parser è
 * ciò che se ne accorge.
 */
export type PlayerInsights = {
  extId: number;
  fullName: string | null;
  team: string;
  /** `"current"` o `"previous"`: a quale stagione appartengono i numeri. */
  statsSeason: string;
  presenze: number;
  startsEleven: number;
  minPlayingTime: number;
  rigoriFatti: number;
  rigoriSbagliati: number;
  rigoriParati: number;
  fmvHome: number | null;
  fmvAway: number | null;
  /** `1` = primo della gerarchia. `null` = non designato. */
  rigoristaRank: number | null;
  piazzatiRank: number | null;
};

/** Le giornate di una stagione di Serie A. Una costante con un nome, non un 38 sparso in tre file. */
export const GIORNATE = 38;

/**
 * Da qui in su il badge della titolarità è verde (M9 §1). Sta qui e non dentro un
 * componente perché è un numero di dominio, come `GIORNATE`.
 *
 * **La soglia è contata, non scelta a naso.** Sulla fixture della fonte A (i byte
 * del 2026-08-11, 497 giocatori di cui 329 mostrabili) con questa `quotaTitolare`:
 * 61 verdi all'80% — il 12,3% del listone, cinque o sei nomi in una lista di
 * chiamata da quaranta. A 70% sarebbero 101, cioè uno su cinque, che è il punto in
 * cui un colore smette di essere un segnale e diventa decorazione.
 *
 * ⚠ **Regge solo perché la percentuale è scritta dentro il badge.** La soglia cade
 * in una zona densa: c'è un grumo di giocatori veri a 32/38 = 84% (Çelik, de Roon,
 * Højlund, Marusic, McKennie, Modrić, Murić, Pinamonti) e chi sta a 30/38 = 79%
 * resta grigio — due giocatori a due partite di distanza in due colori diversi. Va
 * bene finché il numero è leggibile accanto al colore. **Il giorno che qualcuno
 * togliesse la percentuale dal badge per fare spazio, questa soglia diventerebbe
 * una bugia**, e chi lo fa non starà rileggendo `docs/features/09-badge-insight.md`.
 */
export const SOGLIA_TITOLARE = 0.8;

/**
 * Quante volte è partito titolare, in frazione di stagione. È il numero che
 * decide all'asta: 0,63 per Berardi contro 0,32 per Bernardeschi, che nel file
 * Statistiche di Fantacalcio.it sono due `Pv` quasi uguali (M8 §2).
 *
 * Il denominatore è `GIORNATE`, **non** `presenze`: `startsEleven / presenze`
 * risponde a «quando c'era, partiva?», che è un'altra domanda — vera, ma non
 * quella che si fa mentre scorre un countdown.
 *
 * ⚠ **Il clamp non è difensivo, serve a due giocatori veri.** Nella risposta
 * salvata in `fixtures/fantalab-listone.json` Thiam ha `starts_eleven: 42` e
 * Stankovic A. 39 presenze: il campo somma più competizioni, quindi può superare
 * le 38 giornate. Senza clamp la card scriverebbe «110% da titolare». Il test ha
 * il caso col suo nome dentro, così la riga non viene tolta per pulizia.
 */
export function quotaTitolare(i: PlayerInsights): number {
  return Math.min(1, i.startsEleven / GIORNATE);
}

/**
 * Verde o grigio: l'unico posto in cui la soglia viene applicata.
 *
 * Il confronto è `>=`, e il caso di bordo sta nel test con i suoi numeri dentro —
 * 32/38 verde, 30/38 grigio. Un predicato invece di un `>= 0.8` sparso nei due
 * chiamanti (la lista di chiamata e il modale d'offerta) perché la stessa soglia
 * scritta due volte è una soglia che prima o poi diverge.
 */
export function titolareForte(i: PlayerInsights): boolean {
  return quotaTitolare(i) >= SOGLIA_TITOLARE;
}

/**
 * Quando era in campo, quanto ci stava. Distingue il titolare dallo spezzone:
 * 76' contro 50' per i due di sopra.
 *
 * `null` senza presenze, e non zero: non aver giocato non vuol dire giocare zero
 * minuti a partita. È la stessa distinzione fra `—` e `0` che la UI deve tenere.
 */
export function minutiMedi(i: PlayerInsights): number | null {
  return i.presenze > 0 ? i.minPlayingTime / i.presenze : null;
}

/**
 * Gli insight **mostrabili**, cioè quelli della stagione corrente.
 *
 * ⚠ Esiste per un motivo solo, e sta qui perché la decisione va presa in **un**
 * punto: nella risposta della fonte convivono due stagioni — 329 `current` e 168
 * `previous` — e mettere `statsSeason === "current"` dentro i componenti
 * vorrebbe dire due copie della stessa regola, che prima o poi divergono.
 *
 * Chi ha solo la stagione precedente esce come `null`, e la UI scrive `—`: i suoi
 * numeri parlano di un altro campionato, e accanto a quelli di quest'anno
 * sarebbero un confronto falso. Regge anche `undefined`, che è il caso del viewer
 * non-pro e della tabella ancora vuota — così i chiamanti non hanno due controlli
 * da fare ma uno.
 */
export function showableInsights(
  i: PlayerInsights | null | undefined,
): PlayerInsights | null {
  if (!i) return null;
  return i.statsSeason === "current" ? i : null;
}

/**
 * La posizione migliore fra rigori e piazzati, o `null` se non è designato.
 *
 * ⚠ **Non passa da `showableInsights`, e la differenza è di sostanza.** Quel
 * filtro esiste per i numeri **della stagione**: presenze, partenze da titolare,
 * minuti — dove un dato del campionato scorso accanto a uno di quest'anno è un
 * confronto falso. I due rank non sono numeri di stagione: vengono dalla fonte
 * B, che pubblica **la gerarchia di adesso**, e non cambiano significato a
 * seconda di quanto ha giocato l'anno scorso il giocatore che li porta.
 *
 * La misura dice quanto pesa: dei 92 designati, **22 hanno le statistiche della
 * stagione precedente** — quasi un quarto. Un filtro «solo chi batte» costruito
 * sul gate stagionale li perderebbe tutti, in silenzio.
 *
 * ⚠ **Oggi ha un chiamante solo, il Centro dati** (M10). Il portale e il modale
 * d'offerta continuano a mostrare i badge blu solo a chi passa il gate
 * stagionale, cioè quei 22 in `/play` non li vedono: è il comportamento di M9,
 * e cambiarlo è una decisione dell'owner, non un effetto collaterale di un
 * filtro amministrativo.
 */
export function bestSetPieceRank(
  i: PlayerInsights | null | undefined,
): number | null {
  if (!i) return null;
  const ranks = [i.rigoristaRank, i.piazzatiRank].filter(
    (rank): rank is number => rank !== null,
  );
  return ranks.length === 0 ? null : Math.min(...ranks);
}

// ─── Il giudizio di un umano (M10B) ──────────────────────────────────────────

/**
 * Le venti sigle di tre lettere con cui il foglio di Carmy scrive le squadre.
 *
 * ⚠ **Venti righe in chiaro, e non un algoritmo di somiglianza** (M10B §3).
 * `ROM` → `Roma` lo indovinerebbe qualunque prefisso, ma `MON` sta per `Monza` e
 * non per `Modena`, e una funzione che sbaglia in silenzio su una squadra sola
 * sposta un giudizio da un giocatore a un altro. Venti righe che qualcuno rilegge
 * ad agosto sono più oneste.
 *
 * ⚠ **Va rigenerata a ogni promozione**, ed è la stessa nota che M8 §9 aveva
 * scritto per la griglia portieri. Il test lo verifica contro le squadre del
 * listone caricato, così la dimenticanza si vede in un rosso e non in un
 * giudizio mancante.
 *
 * ⚠ **Non è la chiave del join, è il controllo.** Il join passa dal nome (§3);
 * questa mappa serve a confrontare la squadra e a **segnalare** una discordanza,
 * che è un trasferimento o un omonimo. Sul file del 2026-08-12 sono tre —
 * Dominguez B., Masini, Maldini — e sono tutti e tre mercato vero.
 */
export const CARMY_TEAM_BY_SIGLA: Record<string, string> = {
  ATA: "Atalanta",
  BOL: "Bologna",
  CAG: "Cagliari",
  COM: "Como",
  FIO: "Fiorentina",
  FRO: "Frosinone",
  GEN: "Genoa",
  INT: "Inter",
  JUV: "Juventus",
  LAZ: "Lazio",
  LEC: "Lecce",
  MIL: "Milan",
  MON: "Monza",
  NAP: "Napoli",
  PAR: "Parma",
  ROM: "Roma",
  SAS: "Sassuolo",
  TOR: "Torino",
  UDI: "Udinese",
  VEN: "Venezia",
};

/**
 * Il nome di un calciatore ridotto alla forma con cui si confrontano due file.
 *
 * ⚠ **È la chiave del join di M10B**, quindi è la funzione più delicata di questo
 * file: `trim`, minuscolo, accenti tolti, spazi interni collassati. Gli accenti
 * si tolgono perché è l'unica differenza plausibile fra due export dello stesso
 * nome — sui byte del 2026-08-12 i dodici nomi accentati (`Dodò`, `Lucumì`,
 * `Zè Pedro`…) sono scritti **identici** nei due file, e togliere gli accenti non
 * cambia il risultato: è la garanzia che continui a non cambiarlo il giorno in cui
 * uno dei due esporta in un'altra codifica.
 *
 * **Non fa niente di più.** Nessuna somiglianza, nessuna distanza di Levenshtein,
 * nessun cognome estratto: 487 nomi su 497 agganciano così, e i dieci che restano
 * sono giocatori che nel listone **non c'erano** — nessuna normalizzazione li
 * troverebbe. Un aggancio approssimato che indovina nove volte e sbaglia la decima
 * mette il giudizio di un giocatore addosso a un altro, e non lo dice a nessuno.
 */
export function normalizeCarmyName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ");
}

/**
 * Le fasce di Carmy, dalla più cara alla meno cara.
 *
 * ⚠ **L'ordine non è inventato: è quello del foglio.** Tutti e quattro i fogli
 * raggruppano le righe in questa sequenza identica, e la mediana del `Prezzo` la
 * conferma (47 → 26 → 13 → 3 → 2 → 1 → 1). L'unico punto in cui servirebbe
 * indovinare è fra `Titolare "Scarso"` e `Outsider`, che hanno la stessa mediana:
 * lì si tiene l'ordine in cui li mette il file, che è l'unica fonte che ne sa
 * qualcosa.
 *
 * `Non Impostata` non è in elenco perché il parser la traduce in `null`: nel file
 * è **il modo in cui si scrive «nessuna fascia»** — 84 giocatori su 497, e nessuna
 * cella vuota — e l'applicazione scrive l'assenza in un modo solo.
 */
export const CARMY_FASCE = [
  "Top",
  "Semi-Top",
  "Terza",
  "Quarta",
  "Scomm.",
  'Titolare "Scarso"',
  "Outsider",
] as const;

/** Il valore con cui il foglio scrive «nessuna fascia». Non arriva mai a database. */
export const CARMY_FASCIA_ASSENTE = "Non Impostata";

/**
 * Dove sta una fascia nell'ordine, per ordinare una colonna. Le sconosciute vanno
 * in fondo insieme alle assenti: se un giorno Carmy aggiunge una fascia, compare
 * in tabella e finisce in coda, senza che niente si rompa.
 */
export function carmyFasciaRank(fascia: string | null | undefined): number {
  if (!fascia) return CARMY_FASCE.length;
  const index = (CARMY_FASCE as readonly string[]).indexOf(fascia);
  return index === -1 ? CARMY_FASCE.length : index;
}

/**
 * Il giudizio di Carmy su un calciatore, nella forma con cui arriva al browser.
 *
 * Dichiarato **qui** e non dedotto da `carmy_players` per la stessa ragione di
 * `PlayerInsights`: lo legge un client component, e `lib/db` nel bundle non ci
 * deve entrare. Le due definizioni devono restare d'accordo, e il test del parser
 * è ciò che se ne accorge.
 */
export type CarmyJudgement = {
  extId: number;
  /** Il nome e la sigla come li scrive il foglio: spiegano un aggancio. */
  sourceName: string;
  sourceTeam: string;
  fascia: string | null;
  /** `null` anche quando il foglio scrive `0`: zero non è un'offerta valida. */
  prezzo: number | null;
  /**
   * Il `PMA` del foglio, in **punti percentuali**: `10.5` sta per «10,5%».
   *
   * ⚠ **Non è `prezzo` in un'altra unità**, malgrado la correlazione alta: solo 132
   * righe su 385 coincidono con `prezzo / 5`. È un numero **suo**, e non si
   * ricalcola — il perché per esteso, con la misura, sta sulla colonna in
   * `lib/db/schema.ts`.
   */
  pma: number | null;
  /** 1–5, oppure `null` su una riga che nel foglio non è compilata. */
  titolarita: number | null;
  affidabilita: number | null;
  integrita: number | null;
  fmvExp: number | null;
  tags: string[];
  commento: string | null;
};

/** La scala dei tre giudizi. Un numero fuori da qui è un file cambiato, non un voto. */
export const CARMY_SCALA_MAX = 5;

/**
 * Da qui in su la titolarità è verde: **`Titolarità >= 4`** (owner, 2026-08-12).
 *
 * ⚠ **Va letta con la sua misura accanto, perché tocca una regola che M9 aveva
 * messo per iscritto contando.** Sul file del 2026-08-12, 497 giocatori:
 *
 * | Soglia | Verdi | Sul listone |
 * |---|---|---|
 * | **`>= 4`** — la scelta | **168** | **33,8%** — uno su tre |
 * | `>= 5` | 103 | 20,7% — uno su cinque |
 * | M9, l'80% sulle presenze | 61 | 12,3% sui soli mostrabili |
 *
 * M9 §1 aveva scritto che «uno su cinque è il punto in cui un colore smette di
 * essere un segnale e diventa decorazione», e `>= 5` cade **esattamente** lì.
 * **La scelta resta `>= 4` perché è dell'owner**, che l'ha guardata su una lista
 * vera: la misura sta qui così che, se un giorno risultasse troppo, la riga da
 * cambiare sia una sola e il numero da confrontare sia già scritto.
 */
export const SOGLIA_TITOLARE_CARMY = 4;

/**
 * La titolarità di un calciatore, e **l'unico posto in cui si decide da dove
 * viene** (M10B §4).
 *
 * Restituisce una delle due forme, mai un misto:
 *
 * - `{ fonte: "carmy" }` — il giudizio di chi compila il foglio, 1–5. È **la**
 *   titolarità dell'applicazione quando c'è (decisione dell'owner, 2026-08-12): si
 *   smette di dedurla da `starts_eleven / 38`. Porta con sé `quota`, il rapporto
 *   grezzo dell'anno scorso, che **non si perde** — resta accanto in grigio, ed è
 *   ciò che rende il giudizio verificabile. Un `5/5` da solo è un'affermazione che
 *   nessuno può controllare; `5/5` accanto a `3/38` è un'affermazione con la sua
 *   prova, **e quando i due divergono quella divergenza è l'informazione più
 *   preziosa della riga** (Dovbyk: giudicato 5, tre partite da titolare).
 * - `{ fonte: "presenze" }` — il badge di M9, calcolato dalle presenze, per quando
 *   il file non è caricato o quel giocatore non ha agganciato.
 * - `null` — non c'è né l'uno né l'altro: la UI scrive `—`.
 *
 * ⚠ **Esiste perché la scelta fra le due sta in un posto solo.** Due regole per la
 * stessa cosa sparse nei componenti sono esattamente ciò che `showableInsights` era
 * stato scritto per evitare: il giorno in cui la lista di chiamata e il modale
 * d'offerta le applicassero in due modi diversi, lo stesso giocatore sarebbe verde
 * in una schermata e grigio nell'altra.
 *
 * ⚠ **`showableInsights` continua a valere sul ramo `presenze` e non su quello di
 * Carmy**, ed è la stessa distinzione di `bestSetPieceRank`: le presenze sono un
 * numero *di stagione*, e quello dell'anno scorso accanto a uno di quest'anno è un
 * confronto falso. Il giudizio di Carmy no — è un'opinione su **quest'anno**,
 * scritta oggi, e non cambia significato per quanto ha giocato chi la porta.
 * Conseguenza voluta: la `quota` accanto a un giudizio di Carmy c'è **solo** se è
 * mostrabile, così un `5/5` non finisce mai accanto a un `34/38` di due campionati
 * fa (è il caso di Stankovic A., giudicato 2).
 */
export type Titolarita =
  | {
      fonte: "carmy";
      /** 1–5. */
      voto: number;
      /** Il rapporto grezzo, se mostrabile: `{ starts, giornate }`. */
      quota: { starts: number; giornate: number } | null;
      forte: boolean;
    }
  | {
      fonte: "presenze";
      /** 0–1, già col clamp di `quotaTitolare`. */
      quota: number;
      starts: number;
      giornate: number;
      forte: boolean;
    };

export function titolarita(
  insights: PlayerInsights | null | undefined,
  carmy: CarmyJudgement | null | undefined,
): Titolarita | null {
  const showable = showableInsights(insights);

  if (carmy && carmy.titolarita !== null) {
    return {
      fonte: "carmy",
      voto: carmy.titolarita,
      quota: showable
        ? { starts: showable.startsEleven, giornate: GIORNATE }
        : null,
      forte: carmy.titolarita >= SOGLIA_TITOLARE_CARMY,
    };
  }

  if (showable) {
    return {
      fonte: "presenze",
      quota: quotaTitolare(showable),
      starts: showable.startsEleven,
      giornate: GIORNATE,
      forte: titolareForte(showable),
    };
  }

  return null;
}

/**
 * Chi vede gli insight sul listone.
 *
 * ⚠ **Questo predicato decide una query, non un `className`.** Gli insight non
 * arrivano affatto nel payload di chi non li può vedere (M8 §6): `PoolPlayer` è
 * una prop di un client component, quindi nasconderli in JSX li lascerebbe
 * leggibili in DevTools in tre click. È la regola 6 — mai fidarsi del client —
 * applicata alla lettura invece che alla scrittura.
 *
 * L'amministratore li vede anche senza il flag: altrimenti dovrebbe accendersi
 * `is_pro` da sé per guardare i dati che ha appena importato, e
 * `lib/engine/admin.ts` gli vieta di toccare la propria riga.
 */
export function canSeeInsights(
  user: { isPro: boolean; isAdmin: boolean } | null | undefined,
): boolean {
  return user?.isPro === true || user?.isAdmin === true;
}

// ─── Il refresh giornaliero (M11) ────────────────────────────────────────────

/**
 * Le due fonti pubbliche che si aggiornano da sé, nell'ordine in cui si chiedono.
 *
 * ⚠ **L'ordine non è alfabetico né casuale: A prima di B.** La fonte B aggiorna
 * righe che nascono dalla A, e il giorno del primo deploy la tabella è vuota —
 * chiedendo prima la A, il primo giro utile porta a casa tutte e due invece di
 * rimandare la seconda al quarto d'ora dopo. È anche l'ordine in cui il pannello
 * le mostra, e non è una coincidenza da spezzare: si leggono nella sequenza in
 * cui accadono.
 *
 * Sta qui e non in `lib/engine/insight-refresh.ts` perché serve **anche al
 * pannello**, che è un client component: quel modulo importa `lib/db`, e
 * `player_insights` con un ORM al seguito non deve arrivare fino al telefono.
 * Sono i nomi delle cose, e i nomi delle cose stanno qui.
 */
export const REFRESH_SOURCES = ["listone_insights", "set_pieces"] as const;
export type RefreshSource = (typeof REFRESH_SOURCES)[number];

/**
 * Come si chiamano in pagina. Sono **le stesse intestazioni dei due pulsanti** di
 * M8, di proposito: il messaggio di guasto in cima alla pagina e il pulsante che
 * lo risolve a metà pagina devono nominare la stessa cosa, o chi legge non capisce
 * quale dei due premere.
 */
export const REFRESH_SOURCE_LABELS: Record<RefreshSource, string> = {
  listone_insights: "Titolarità e rigori storici",
  set_pieces: "Rigoristi e calci piazzati",
};
