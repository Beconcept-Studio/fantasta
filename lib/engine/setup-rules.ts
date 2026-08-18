import {
  ROLES,
  ROLE_LABELS,
  type Role,
  SEAT_OPTIONS,
  type SeatCount,
} from "@/lib/domain";

import { type Result, fail, ok } from "./errors";

/**
 * Le regole di configurazione di un'asta, come **funzioni pure**.
 *
 * Stanno in un file separato da `setup.ts` per una ragione sola: `setup.ts`
 * importa il database, quindi non è collaudabile senza un Postgres acceso.
 * Qui invece non c'è niente da mockare — si passano numeri, si riceve un
 * verdetto — e i test di §12.25 girano in millisecondi.
 *
 * È la stessa idea che in Fase 2 governerà `rules.ts`: la logica che decide sta
 * dove non c'è nulla da avviare per provarla.
 */

// ─── Limiti ──────────────────────────────────────────────────────────────────

export const NAME_MIN = 3;
export const NAME_MAX = 60;

export const BUDGET_MIN = 1;
export const BUDGET_MAX = 10_000;

export const SLOT_MIN = 1;
export const SLOT_MAX = 30;

/**
 * I minimi dei timer sono bassi apposta: le aste di prova nascono dal seed con
 * `bid 3s / pick 3s / reveal 2s` (DECISIONS 2026-08-06, niente `DEV_TIME_SCALE`),
 * quindi il motore deve accettare quei valori senza rami dipendenti dall'ambiente.
 */
export const TIMER_LIMITS = {
  bidSeconds: { min: 3, max: 300 },
  pickSeconds: { min: 3, max: 300 },
  tiePrepSeconds: { min: 2, max: 120 },
  revealSeconds: { min: 1, max: 120 },
  /**
   * Il cancello dei risultati (M14 §7): quanto passa fra la chiusura del round e
   * l'apertura delle buste.
   *
   * ⚠ **È l'unico timer con minimo 0, e lo zero non è «una fase da zero
   * secondi»: è l'assenza della fase.** Gli altri quattro hanno tutti un minimo
   * positivo perché una fase che dura zero non ha senso — un timer armato
   * sull'istante presente, uno snapshot in più per lotto mandato a dodici
   * persone, e una schermata «risultati in arrivo» che lampeggia se un `ADVANCE`
   * arriva un tick dopo. Qui lo zero salta la fase del tutto: `advanceLotOpen`
   * risolve nella stessa transizione, cioè esattamente il comportamento di
   * v1.14.0. **Non "uniformare" questo minimo a 1 per simmetria**: sarebbe
   * togliere l'unico modo di tornare a come l'asta si comportava prima.
   */
  resultGateSeconds: { min: 0, max: 120 },
} as const;

export type TimerField = keyof typeof TIMER_LIMITS;
export const TIMER_FIELDS = Object.keys(TIMER_LIMITS) as TimerField[];

export const TIMER_LABELS: Record<TimerField, string> = {
  bidSeconds: "secondi per offrire",
  pickSeconds: "secondi per chiamare",
  tiePrepSeconds: "secondi di preparazione allo spareggio",
  revealSeconds: "secondi di apertura buste",
  resultGateSeconds: "secondi prima dei risultati",
};

// ─── Configurazione ──────────────────────────────────────────────────────────

export type SlotsByRole = Record<Role, number>;

export type AuctionConfig = {
  name: string;
  seats: SeatCount;
  budgetDefault: number;
  bidSeconds: number;
  pickSeconds: number;
  tiePrepSeconds: number;
  revealSeconds: number;
  /** Il cancello dei risultati (M14). `0` = nessun cancello. */
  resultGateSeconds: number;
  slots: SlotsByRole;
  roleOrder: Role[];
};

/**
 * Cosa una pagina **propone** a chi sta creando un'asta adesso.
 *
 * ⚠ **`resultGateSeconds: 10` qui e `DEFAULT 0` sulla colonna, di proposito**
 * (M14 §7). Non sono in contraddizione e non vanno allineati: rispondono a due
 * domande diverse. Il default della colonna vale per le **righe che esistono
 * già**, e lo zero le lascia identiche a se stesse senza nessun backfill — è la
 * ragione per cui M14 si rilascia con un `db:push` e niente altro. Questo default
 * vale per le aste **nuove**, e dieci secondi sono il comportamento che l'owner
 * ha chiesto.
 */
export const DEFAULT_CONFIG: Omit<AuctionConfig, "name"> = {
  seats: 8,
  budgetDefault: 500,
  bidSeconds: 30,
  pickSeconds: 30,
  tiePrepSeconds: 10,
  revealSeconds: 10,
  resultGateSeconds: 10,
  slots: { P: 3, D: 8, C: 8, A: 6 },
  roleOrder: [...ROLES],
};

export function totalSlots(slots: SlotsByRole): number {
  return ROLES.reduce((sum, role) => sum + slots[role], 0);
}

/**
 * `role_order` deve essere una **permutazione completa** di P, D, C, A: né
 * ripetizioni né ruoli mancanti (test §12.25). L'asta percorre questa lista
 * dall'inizio alla fine, quindi un ruolo assente sarebbe un ruolo che non si
 * gioca mai e uno ripetuto un ruolo che si giocherebbe due volte.
 */
export function isRoleOrder(value: unknown): value is Role[] {
  if (!Array.isArray(value) || value.length !== ROLES.length) return false;
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") return false;
    if (!(ROLES as readonly string[]).includes(item)) return false;
    if (seen.has(item)) return false;
    seen.add(item);
  }
  return true;
}

function integerIn(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

export function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < NAME_MIN || name.length > NAME_MAX) return null;
  return name;
}

/**
 * I caratteri che il nome di una squadra non può contenere (M3 §2).
 *
 * Il verbale delle rose è un CSV a virgole **senza virgolette**, e un formato
 * così pretende che i valori non contengano il separatore. Fra virgolettare
 * all'uscita e impedire il carattere all'ingresso si è scelto il secondo: il
 * file resta leggibile a occhio, che è tutto il punto di un verbale.
 *
 * Il punto e virgola passa di proposito — con la virgola come separatore è
 * innocuo, e togliere caratteri legittimi a un nome di fantasia si paga in
 * fastidio ogni volta che qualcuno entra in un'asta.
 *
 * ⚠ La restrizione è **solo** del nome squadra e non di `normalizeName`, che è
 * condivisa con il nome dell'asta: quello finisce in uno slug di nome file,
 * dove una virgola non fa danno. Restringere anche lui sarebbe un effetto
 * collaterale, non una decisione.
 */
const TEAM_NAME_FORBIDDEN = /[,"]/;

/** Nome squadra: le regole del nome dell'asta, più i caratteri di `TEAM_NAME_FORBIDDEN`. */
export function validateTeamName(value: unknown): Result<string> {
  const name = normalizeName(value);
  if (name === null) {
    return fail(
      "INVALID_TEAM_NAME",
      `Il nome della squadra deve avere fra ${NAME_MIN} e ${NAME_MAX} caratteri.`,
    );
  }
  if (TEAM_NAME_FORBIDDEN.test(name)) {
    return fail(
      "INVALID_TEAM_NAME",
      "Il nome della squadra non può contenere virgole né virgolette.",
    );
  }
  return ok(name);
}

export type AuctionConfigInput = {
  name?: unknown;
  seats?: unknown;
  budgetDefault?: unknown;
  bidSeconds?: unknown;
  pickSeconds?: unknown;
  tiePrepSeconds?: unknown;
  revealSeconds?: unknown;
  resultGateSeconds?: unknown;
  slots?: Partial<Record<Role, unknown>>;
  roleOrder?: unknown;
};

/**
 * Valida (e normalizza) la configurazione di un'asta.
 *
 * `partial: true` valida solo i campi presenti — è la modalità con cui
 * `updateAuctionSettings` verifica una patch senza pretendere l'oggetto intero.
 */
export type AuctionConfigBase = Omit<AuctionConfig, "name" | "seats"> & {
  name?: string;
  /** Non ancora ristretto a `SeatCount`: arriva dal database, dove è un intero. */
  seats: number;
};

export function validateAuctionConfig(
  input: AuctionConfigInput,
  base: AuctionConfigBase = DEFAULT_CONFIG,
): Result<AuctionConfig> {
  const name =
    input.name === undefined ? (base.name ?? null) : normalizeName(input.name);
  if (name === null) {
    return fail(
      "INVALID_NAME",
      `Il nome dell'asta deve avere fra ${NAME_MIN} e ${NAME_MAX} caratteri.`,
    );
  }

  const seats = input.seats === undefined ? base.seats : input.seats;
  if (!(SEAT_OPTIONS as readonly unknown[]).includes(seats)) {
    return fail(
      "INVALID_SEATS",
      `I partecipanti devono essere ${SEAT_OPTIONS.join(", ")}: "${String(seats)}" non è ammesso.`,
    );
  }

  const roleOrder =
    input.roleOrder === undefined ? base.roleOrder : input.roleOrder;
  if (!isRoleOrder(roleOrder)) {
    return fail(
      "INVALID_ROLE_ORDER",
      "L'ordine dei ruoli deve contenere P, D, C e A esattamente una volta ciascuno.",
    );
  }

  const slots = {} as SlotsByRole;
  for (const role of ROLES) {
    const raw = input.slots?.[role] ?? base.slots[role];
    if (!integerIn(raw, SLOT_MIN, SLOT_MAX)) {
      return fail(
        "INVALID_SLOTS",
        `Gli slot per ${ROLE_LABELS[role]} devono essere un numero intero fra ${SLOT_MIN} e ${SLOT_MAX}.`,
      );
    }
    slots[role] = raw;
  }

  const timers = {} as Record<TimerField, number>;
  for (const field of TIMER_FIELDS) {
    const raw = input[field] === undefined ? base[field] : input[field];
    const { min, max } = TIMER_LIMITS[field];
    if (!integerIn(raw, min, max)) {
      return fail(
        "INVALID_TIMERS",
        `I ${TIMER_LABELS[field]} devono essere un numero intero fra ${min} e ${max}.`,
      );
    }
    timers[field] = raw;
  }

  const budgetDefault =
    input.budgetDefault === undefined ? base.budgetDefault : input.budgetDefault;
  if (!integerIn(budgetDefault, BUDGET_MIN, BUDGET_MAX)) {
    return fail(
      "INVALID_BUDGET",
      `Il budget deve essere un numero intero fra ${BUDGET_MIN} e ${BUDGET_MAX}.`,
    );
  }
  // I3: ogni slot residuo deve restare comprabile ad almeno 1 credito. Con un
  // budget sotto il numero di slot la rosa non si potrebbe completare nemmeno
  // comprando tutti a 1, e l'asta nascerebbe già in uno stato impossibile.
  const slotCount = totalSlots(slots);
  if (budgetDefault < slotCount) {
    return fail(
      "INVALID_BUDGET",
      `Il budget (${budgetDefault}) non basta per ${slotCount} slot: ogni slot deve restare comprabile ad almeno 1 credito.`,
    );
  }

  return ok({ name, seats: seats as SeatCount, budgetDefault, ...timers, slots, roleOrder });
}

// ─── I9 — il listone deve bastare ────────────────────────────────────────────

export type PoolCounts = Record<Role, number>;

/**
 * **I9**: per ogni ruolo, `giocatori_disponibili ≥ slot_ruolo × seats`.
 *
 * Va verificata all'import, ma anche a ogni cambio che sposti uno dei tre
 * termini: numero di partecipanti, slot per ruolo, e il toggle sui fuori lista
 * (P7). Il messaggio nomina il ruolo e i due numeri, perché la sera dell'asta
 * "import rifiutato" senza altro è inutilizzabile.
 */
export function validateRolePool(args: {
  counts: PoolCounts;
  slots: SlotsByRole;
  seats: number;
}): Result<null> {
  const { counts, slots, seats } = args;
  const problems: string[] = [];

  for (const role of ROLES) {
    const needed = slots[role] * seats;
    const available = counts[role] ?? 0;
    if (available < needed) {
      problems.push(
        `${ROLE_LABELS[role]} (${role}): servono ${needed} giocatori (${slots[role]} slot × ${seats} partecipanti), il listone ne ha ${available}.`,
      );
    }
  }

  if (problems.length > 0) {
    return fail(
      "LISTONE_INSUFFICIENT",
      `Il listone non basta per questa configurazione. ${problems.join(" ")}`,
    );
  }
  return ok(null);
}
