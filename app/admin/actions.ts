"use server";

import { revalidatePath } from "next/cache";

import type { FormState } from "@/app/auctions/form-state";
import { requireAppAdmin } from "@/lib/auth";
import { ADMIN_ROOT } from "@/lib/admin-nav";
import {
  type CampionciniRun,
  campionciniDir,
  downloadCampioncini,
} from "@/lib/campioncini";
import {
  forceVerifyEmail,
  setUserAdmin,
  setUserDisplayName,
  setUserPro,
} from "@/lib/engine/admin";
import {
  refreshListoneInsights,
  refreshSetPieces,
} from "@/lib/engine/insights";
import { parseListone } from "@/lib/import/parseListone";
import { deleteAuction } from "@/lib/engine/setup";

/**
 * Le Server Action del pannello di amministrazione (M6).
 *
 * ⚠ **`requireAppAdmin()` è la prima riga di ognuna, e non è una ripetizione da
 * togliere.** Il layout `/admin` ha la sua guardia, ma un layout non protegge
 * niente: una server action è un endpoint raggiungibile per conto proprio — un
 * `POST` con l'id dell'azione dentro, senza mai aprire una pagina del pannello —
 * e un pannello protetto solo dal layout è un pannello aperto. È la cosa meno
 * ovvia di questa macro e quella che fa danno se la si semplifica.
 *
 * La guardia sta **in cima**, prima di leggere un solo campo della `FormData`:
 * così il rifiuto non dipende da cosa c'è nel form. Un test in
 * `tests/db/admin.test.ts` enumera gli export di questo file e li chiama tutti
 * con un form vuoto — se un'azione nuova nascesse senza guardia, quel test si
 * rompe. Ed è un'uguaglianza esatta, non un «almeno queste»: aggiungere
 * un'azione qui obbliga a guardare in faccia la riga della guardia.
 *
 * Sono sottili come quelle del setup: leggono la `FormData` e girano tutto a
 * `lib/engine/admin.ts`, dove ogni mutazione **rilegge `is_admin` dal database**.
 * La sessione è un JWT e non sa niente dei permessi (P17), quindi la guardia qui
 * e il controllo là non sono lo stesso controllo scritto due volte: uno decide
 * chi entra, l'altro chi comanda ancora nel momento in cui scrive.
 */

function text(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === "string" ? value : undefined;
}

const USERS_PATH = `${ADMIN_ROOT}/users`;
const AUCTIONS_PATH = `${ADMIN_ROOT}/auctions`;
const FIGURINE_PATH = `${ADMIN_ROOT}/figurine`;
const LISTONE_PATH = `${ADMIN_ROOT}/listone`;

/** Correggere il nome scritto male da qualcun altro. */
export async function setUserDisplayNameAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const admin = await requireAppAdmin();
  const userId = text(form, "userId");
  if (!userId) return { error: "Utente non indicato." };

  const result = await setUserDisplayName(
    admin.id,
    userId,
    form.get("displayName"),
  );
  if (!result.ok) return { error: result.error.message };

  revalidatePath(USERS_PATH);
  return { error: null, ok: `Nome aggiornato: ${result.value.displayName}.` };
}

/** Il pulsante che chiude la finestra di M5 §9. */
export async function forceVerifyEmailAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const admin = await requireAppAdmin();
  const userId = text(form, "userId");
  if (!userId) return { error: "Utente non indicato." };

  const result = await forceVerifyEmail(admin.id, userId);
  if (!result.ok) return { error: result.error.message };

  revalidatePath(USERS_PATH);
  return { error: null, ok: "Indirizzo verificato a mano: ora può entrare." };
}

/**
 * Dare o togliere il permesso di amministratore.
 *
 * L'intenzione arriva come stringa e diventa un booleano **qui**: il motore
 * riceve `unknown` e rifiuta ciò che non è un booleano, perché è lui a dover
 * restare vero anche se un giorno lo chiamasse qualcun altro (regola 6).
 */
export async function setUserAdminAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const admin = await requireAppAdmin();
  const userId = text(form, "userId");
  if (!userId) return { error: "Utente non indicato." };

  const wanted = text(form, "isAdmin");
  const result = await setUserAdmin(
    admin.id,
    userId,
    wanted === "true" ? true : wanted === "false" ? false : undefined,
  );
  if (!result.ok) return { error: result.error.message };

  revalidatePath(USERS_PATH);
  return {
    error: null,
    ok: result.value.isAdmin
      ? "Adesso è amministratore dell'applicazione."
      : "Non è più amministratore dell'applicazione.",
  };
}

/**
 * La cancellazione di un'asta dal pannello.
 *
 * È un'azione a sé e non quella del setup, per una ragione di destinazione: da
 * `/auctions/[id]/setup` si finisce in dashboard, da qui si torna alla lista del
 * pannello. Il motore è lo stesso — `deleteAuction`, allargata di una riga in
 * M6 — e resta lui a rifiutare un'asta `LIVE` o `PAUSED`, anche a un
 * amministratore.
 *
 * Il nome digitato si confronta **qui**, come nel setup: è una difesa contro la
 * mano, non contro il chiamante, e nel motore diventerebbe un parametro che ogni
 * altro chiamante dovrebbe ricordarsi di riempire.
 */
export async function deleteAuctionAsAdminAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const admin = await requireAppAdmin();
  const auctionId = text(form, "auctionId");
  if (!auctionId) return { error: "Asta non indicata." };

  if (text(form, "confirmName")?.trim() !== text(form, "name")?.trim()) {
    return { error: "Il nome non coincide: l'asta non è stata cancellata." };
  }

  const result = await deleteAuction(admin.id, auctionId);
  if (!result.ok) return { error: result.error.message };

  revalidatePath(AUCTIONS_PATH);
  return { error: null, ok: `Asta «${result.value.name}» cancellata.` };
}

/** I numeri della passata, detti in italiano: è tutto ciò che la pagina mostra. */
function runSummary(run: CampionciniRun): string {
  const parts = [
    `${run.downloaded} scaricate`,
    `${run.alreadyThere} già presenti`,
  ];
  // I due numeri che devono essere zero si dicono **solo se non lo sono**: una
  // riga di zeri sembra un problema anche quando non c'è.
  if (run.withoutImage > 0) parts.push(`${run.withoutImage} senza immagine`);
  if (run.failed > 0) parts.push(`${run.failed} non riuscite`);

  const summary = `${parts.join(" · ")}.`;
  if (!run.expired) return summary;
  return (
    `${summary} Tempo scaduto: ne restano ${run.remaining}. ` +
    `Premi di nuovo — il file è ancora selezionato e riprende da dov'era.`
  );
}

/**
 * Lo scaricamento delle figurine (M7 §4): **un click**.
 *
 * Si carica il `.xlsx` del listone di riferimento, il parser che c'è già lo
 * legge — è puro e non tocca il database — e per ogni id che non è già sul disco
 * si scarica l'immagine. Il file **non si conserva** (P6, come l'import del
 * listone di un'asta): serve solo la lista di id, dentro questa richiesta.
 *
 * ⚠ **Qui non c'è nient'altro, ed è il punto.** Nessun lavoro in background,
 * nessun singleton su `globalThis`, nessuna tabella di avanzamento: lo stato è
 * il disco, «mancante» vuol dire «file che non c'è», e l'operazione è quindi
 * ripetibile per costruzione. La prima versione della spec aveva batching a
 * lotti da venticinque, una lista di id parcheggiata in un file e un pulsante
 * «Ferma»; il collaudo su 495 id veri ha misurato **7,3 secondi** e ha tolto
 * tutto. Se un giorno questa funzione ricomincia a crescere, la domanda da farsi
 * è quella che l'owner ha fatto allora: «l'hai provato?».
 *
 * Gli id vengono da un listone **di riferimento** e non dalle aste: l'archivio è
 * globale, e legarlo alle aste vorrebbe dire perderlo quando un'asta si cancella
 * — che da M6 è facile.
 */
export async function downloadCampionciniAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  await requireAppAdmin();

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Scegli il file .xlsx del listone di riferimento." };
  }

  const parsed = parseListone(await file.arrayBuffer());
  if (!parsed.ok) return { error: parsed.error.message };

  const run = await downloadCampioncini({
    extIds: parsed.value.map((player) => player.extId),
    dir: campionciniDir(),
  });

  revalidatePath(FIGURINE_PATH);
  return { error: null, ok: runSummary(run) };
}

// ─── Gli insight sul listone (M8) ────────────────────────────────────────────

/**
 * Dare o togliere `is_pro`, cioè gli insight sul listone.
 *
 * Stessa forma di `setUserAdminAction`, e la differenza sta nel motore: là
 * toccare la propria riga è vietato — togliersi `is_admin` chiude fuori — qui no,
 * perché il flag non apre nessuna porta e un amministratore vede gli insight
 * comunque.
 */
export async function setUserProAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const admin = await requireAppAdmin();
  const userId = text(form, "userId");
  if (!userId) return { error: "Utente non indicato." };

  const wanted = text(form, "isPro");
  const result = await setUserPro(
    admin.id,
    userId,
    wanted === "true" ? true : wanted === "false" ? false : undefined,
  );
  if (!result.ok) return { error: result.error.message };

  revalidatePath(USERS_PATH);
  return {
    error: null,
    ok: result.value.isPro
      ? "Adesso vede gli insight sul listone."
      : "Non vede più gli insight sul listone.",
  };
}

/**
 * Il refresh della fonte A: titolarità, minuti, rigori storici.
 *
 * ⚠ **Nessun file da caricare, a differenza delle figurine**: qui la fonte è una
 * `GET` pubblica, quindi il pulsante è un pulsante e basta. Per la stessa ragione
 * la firma non prende parametri — non c'è nessuna `FormData` da leggere — e
 * `useActionState` la accetta comunque, perché una funzione che ignora gli
 * argomenti è assegnabile a una che li riceve. È la ragione per cui
 * questa macro non aggiunge nessun upload — l'unico che c'era in progetto, la
 * griglia portieri, è rimasto fuori dal perimetro.
 */
export async function refreshListoneInsightsAction(): Promise<FormState> {
  await requireAppAdmin();

  const result = await refreshListoneInsights();
  if (!result.ok) return { error: result.error.message };

  revalidatePath(LISTONE_PATH);
  const { fromSource, coverage } = result.value;
  const parts = [`${fromSource} giocatori aggiornati dalla fonte`];
  for (const c of coverage) {
    parts.push(`«${c.auctionName}»: ${c.matched}/${c.wanted} agganciati`);
  }
  return { error: null, ok: `${parts.join(" · ")}.` };
}

/**
 * Il refresh della fonte B: rigoristi e calci piazzati.
 *
 * Va dato **dopo** il listone la prima volta: aggiorna righe che nascono da
 * quello, e se la tabella è vuota rifiuta dicendolo — invece di scrivere zero
 * righe e dichiarare successo.
 */
export async function refreshSetPiecesAction(): Promise<FormState> {
  await requireAppAdmin();

  const result = await refreshSetPieces();
  if (!result.ok) return { error: result.error.message };

  revalidatePath(LISTONE_PATH);
  const { fromSource, written, unknown } = result.value;
  const summary = `${written} designati aggiornati su ${fromSource} letti dalla pagina`;
  // Gli id che la tabella non conosce si dicono solo se ci sono: una riga «0
  // sconosciuti» sembra un problema anche quando non c'è.
  if (unknown.length === 0) return { error: null, ok: `${summary}.` };
  return {
    error: null,
    ok:
      `${summary}. ${unknown.length} non sono nel listone importato ` +
      `(${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? "…" : ""}): ` +
      `prova a riaggiornare prima il listone.`,
  };
}
