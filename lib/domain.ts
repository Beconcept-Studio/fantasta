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
