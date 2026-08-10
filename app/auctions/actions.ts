"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";

import type { FormState } from "./form-state";
import {
  createAuction,
  createInvite,
  deleteAuction,
  fillWithBots,
  importPlayers,
  joinAsOwner,
  joinAuction,
  removeMember,
  setIncludeOutOfList,
  updateAuctionSettings,
} from "@/lib/engine/setup";
import {
  BOT_FILL_MIX,
  BOT_STRATEGIES,
  type BotFill,
  ROLES,
  type Role,
} from "@/lib/domain";

/**
 * Le Server Action del setup.
 *
 * Sono volutamente sottili: leggono la `FormData`, verificano chi sta
 * chiedendo, e girano tutto a `lib/engine/setup.ts`. Ogni validazione vera sta
 * lì, perché è lì che arriva anche il seed, e perché la regola 6 dice che la UI
 * può disabilitare quello che vuole ma il server rifiuta comunque.
 *
 * La forma `FormState` è quella che serve a `useActionState`: un messaggio
 * d'errore da mostrare accanto al form, mai un'eccezione in faccia all'utente
 * per un rifiuto previsto.
 */

function text(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === "string" ? value : undefined;
}

/** I campi numerici arrivano come stringa: qui diventano numeri o `undefined`. */
function number(form: FormData, key: string): number | undefined {
  const raw = text(form, key);
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function slots(form: FormData): Partial<Record<Role, number>> | undefined {
  const entries = ROLES.map((role) => [role, number(form, `slots_${role}`)] as const)
    .filter(([, value]) => value !== undefined);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

/** La lista riordinata arriva dal drag & drop come "C,A,P,D". */
function roleOrder(form: FormData): string[] | undefined {
  const raw = text(form, "roleOrder");
  if (raw === undefined || raw.trim() === "") return undefined;
  return raw.split(",").map((item) => item.trim());
}

function configFrom(form: FormData) {
  return {
    name: text(form, "name"),
    seats: number(form, "seats"),
    budgetDefault: number(form, "budgetDefault"),
    bidSeconds: number(form, "bidSeconds"),
    pickSeconds: number(form, "pickSeconds"),
    tiePrepSeconds: number(form, "tiePrepSeconds"),
    revealSeconds: number(form, "revealSeconds"),
    slots: slots(form),
    roleOrder: roleOrder(form),
  };
}

export async function createAuctionAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  // La casella esiste solo per un amministratore, e `createAuction` rilegge il
  // permesso dal database: qui si passa soltanto l'intenzione (regola 6).
  const result = await createAuction(
    user.id,
    configFrom(form),
    form.get("isSimulated") === "on",
  );
  if (!result.ok) return { error: result.error.message };
  redirect(`/auctions/${result.value.auctionId}/setup`);
}

export async function updateSettingsAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const auctionId = text(form, "auctionId");
  if (!auctionId) return { error: "Asta non indicata." };

  const result = await updateAuctionSettings(user.id, auctionId, configFrom(form));
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/auctions/${auctionId}/setup`);
  return { error: null, ok: "Impostazioni salvate." };
}

export async function importListoneAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const auctionId = text(form, "auctionId");
  if (!auctionId) return { error: "Asta non indicata." };

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Scegli il file .xlsx del listone." };
  }

  const result = await importPlayers(
    user.id,
    auctionId,
    await file.arrayBuffer(),
  );
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/auctions/${auctionId}/setup`);
  const { imported, outOfList } = result.value;
  return {
    error: null,
    ok: `Importati ${imported} giocatori (${outOfList} fuori lista).`,
  };
}

export async function toggleOutOfListAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const auctionId = text(form, "auctionId");
  if (!auctionId) return { error: "Asta non indicata." };

  const result = await setIncludeOutOfList(
    user.id,
    auctionId,
    text(form, "include") === "true",
  );
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/auctions/${auctionId}/setup`);
  return { error: null, ok: "Pool aggiornato." };
}

export async function createInviteAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const auctionId = text(form, "auctionId");
  if (!auctionId) return { error: "Asta non indicata." };

  const result = await createInvite(user.id, auctionId);
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/auctions/${auctionId}/setup`);
  return { error: null, ok: "Nuovo link d'invito generato." };
}

export async function joinAuctionAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const token = text(form, "token");
  if (!token) return { error: "Invito non indicato." };

  const result = await joinAuction(user.id, token, text(form, "teamName"));
  if (!result.ok) return { error: result.error.message };
  redirect(`/auctions/${result.value.auctionId}/lobby`);
}

export async function joinAsOwnerAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const auctionId = text(form, "auctionId");
  if (!auctionId) return { error: "Asta non indicata." };

  const result = await joinAsOwner(user.id, auctionId, text(form, "teamName"));
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/auctions/${auctionId}/setup`);
  return { error: null, ok: "Sei dentro." };
}

/** I bot che riempiono i posti liberi di un'asta simulata (M4). */
export async function fillWithBotsAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const auctionId = text(form, "auctionId");
  if (!auctionId) return { error: "Asta non indicata." };

  const fill = text(form, "fill");
  if (!isBotFill(fill)) return { error: "Strategia non riconosciuta." };

  const result = await fillWithBots(
    user.id,
    auctionId,
    number(form, "count") ?? Number.NaN,
    fill,
  );
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/auctions/${auctionId}/setup`);
  const { added } = result.value;
  return {
    error: null,
    ok: `${added} ${added === 1 ? "bot aggiunto" : "bot aggiunti"}.`,
  };
}

function isBotFill(value: string | undefined): value is BotFill {
  return (
    value === BOT_FILL_MIX ||
    (BOT_STRATEGIES as readonly string[]).includes(value ?? "")
  );
}

/**
 * La cancellazione di un'asta (M4).
 *
 * Il nome digitato si confronta **qui**, e non dentro `deleteAuction`: è una
 * difesa contro la mano, non contro il chiamante, e nel motore diventerebbe un
 * parametro che qualsiasi altro chiamante dovrebbe ricordarsi di riempire. La
 * difesa vera — solo l'owner, mai su un'asta in corso — sta nel motore.
 */
export async function deleteAuctionAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const auctionId = text(form, "auctionId");
  if (!auctionId) return { error: "Asta non indicata." };

  if (text(form, "confirmName")?.trim() !== text(form, "name")?.trim()) {
    return { error: "Il nome non coincide: l'asta non è stata cancellata." };
  }

  const result = await deleteAuction(user.id, auctionId);
  if (!result.ok) return { error: result.error.message };

  redirect("/dashboard");
}

export async function removeMemberAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const memberId = text(form, "memberId");
  if (!memberId) return { error: "Partecipante non indicato." };

  const result = await removeMember(user.id, memberId);
  if (!result.ok) return { error: result.error.message };

  revalidatePath(`/auctions/${result.value.auctionId}/setup`);
  revalidatePath(`/auctions/${result.value.auctionId}/lobby`);
  revalidatePath("/dashboard");
  return { error: null, ok: "Partecipante rimosso." };
}
