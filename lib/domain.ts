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
