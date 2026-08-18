"use server";

import { revalidatePath } from "next/cache";

import type { FormState } from "@/app/auctions/form-state";
import type { UserFieldOutcome, UserSaveState } from "@/lib/admin-users";
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
import { recordSourceRun } from "@/lib/engine/insight-refresh";
import {
  refreshListoneInsights,
  refreshSetPieces,
} from "@/lib/engine/insights";
import { uploadCarmy } from "@/lib/engine/carmy";
import { listoneExtIds, uploadListone } from "@/lib/engine/listone";
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

/**
 * L'intenzione su un flag, letta dal form: `true`, `false`, o `undefined` se non è
 * nessuna delle due.
 *
 * La stringa diventa un booleano **qui**, e ciò che non lo è resta `undefined`: il
 * motore riceve `unknown` e rifiuta quello che non è un booleano, perché è lui a
 * dover restare vero anche se un giorno lo chiamasse qualcun altro (regola 6).
 */
function flag(form: FormData, key: string): boolean | undefined {
  const value = text(form, key);
  return value === "true" ? true : value === "false" ? false : undefined;
}

const USERS_PATH = `${ADMIN_ROOT}/users`;
const AUCTIONS_PATH = `${ADMIN_ROOT}/auctions`;
const LISTONE_PATH = `${ADMIN_ROOT}/listone`;
const DATI_PATH = `${ADMIN_ROOT}/listone/dati`;

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

  const result = await setUserAdmin(admin.id, userId, flag(form, "isAdmin"));
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
 * Il salvataggio del pannello laterale della pagina utenti (M13 §5).
 *
 * ⚠ **`requireAppAdmin()` in prima riga, prima di leggere un solo campo**, come le
 * altre: `tests/db/admin.test.ts` enumera gli export di questo file con
 * un'uguaglianza **esatta** e li chiama tutti con un form vuoto, quindi questa
 * azione è nata insieme al suo rosso — e l'elenco del test è stato aggiornato a
 * mano, che è precisamente il meccanismo che funziona.
 *
 * ⚠ **Chiama solo per ciò che è cambiato, e lo sa dalla presenza del campo.** Un
 * `displayName` che non c'è nella `FormData` vuol dire «il nome non si tocca», non
 * «il nome è vuoto»: il pannello monta l'input nascosto solo quando quel valore
 * differisce da quello che il server gli aveva mandato. Non c'è nessun confronto da
 * fare qui, e non potrebbe esserci — questo file non legge il database (la regola
 * ESLint su `lib/db`), e `lib/engine/admin.ts` non si tocca (§1). L'unico effetto di
 * un client che mentisse sarebbe una `UPDATE` che riscrive il valore che c'è già:
 * l'autorizzazione la fa il motore, che rilegge `is_admin` a ogni mutazione.
 *
 * ⚠ **Non è atomica, e l'esito lo dice.** Sono quattro `UPDATE` distinti su `users`
 * (niente lock: `lib/engine/admin.ts` spiega perché non serve), quindi un
 * salvataggio **può riuscire a metà**: si riporta un esito **per campo** e `done`
 * solo se tutto ciò che era stato chiesto è passato — è `done` l'unica cosa su cui
 * il modale si chiude. E il `revalidatePath` si dà anche a metà strada: ciò che è
 * stato scritto deve comparire in tabella, altrimenti la pagina racconta una storia
 * e il database un'altra.
 *
 * La verifica è **a senso unico** anche qui, e non per simmetria con la UI: esiste
 * `verify=1` e non esiste il suo contrario, perché `forceVerifyEmail` sa scrivere
 * `email_verified_at` e non cancellarlo. Una de-verifica rispedirebbe una persona
 * alla schermata del codice.
 */
export async function saveUserAction(
  _prev: UserSaveState,
  form: FormData,
): Promise<UserSaveState> {
  const admin = await requireAppAdmin();
  const userId = text(form, "userId");
  if (!userId) return { error: "Utente non indicato." };

  const outcomes: UserFieldOutcome[] = [];

  // L'ordine è quello del pannello, dall'alto in basso: se qualcosa va storto a
  // metà, l'elenco degli esiti si legge nell'ordine in cui i campi stanno scritti.
  const wantedName = form.get("displayName");
  if (wantedName !== null) {
    const result = await setUserDisplayName(admin.id, userId, wantedName);
    outcomes.push(
      result.ok
        ? {
            field: "displayName",
            ok: true,
            message: `adesso è «${result.value.displayName}».`,
          }
        : { field: "displayName", ok: false, message: result.error.message },
    );
  }

  if (text(form, "verify") === "1") {
    const result = await forceVerifyEmail(admin.id, userId);
    outcomes.push(
      result.ok
        ? {
            field: "verified",
            ok: true,
            message: "verificata a mano: ora può entrare.",
          }
        : { field: "verified", ok: false, message: result.error.message },
    );
  }

  if (form.get("isAdmin") !== null) {
    const result = await setUserAdmin(admin.id, userId, flag(form, "isAdmin"));
    outcomes.push(
      result.ok
        ? {
            field: "isAdmin",
            ok: true,
            message: result.value.isAdmin
              ? "adesso amministra l'applicazione."
              : "non amministra più l'applicazione.",
          }
        : { field: "isAdmin", ok: false, message: result.error.message },
    );
  }

  if (form.get("isPro") !== null) {
    const result = await setUserPro(admin.id, userId, flag(form, "isPro"));
    outcomes.push(
      result.ok
        ? {
            field: "isPro",
            ok: true,
            message: result.value.isPro
              ? "adesso vede gli insight sul listone."
              : "non vede più gli insight sul listone.",
          }
        : { field: "isPro", ok: false, message: result.error.message },
    );
  }

  // Nessun campo nella `FormData`: non c'era niente da salvare, e non è un errore.
  // Il pannello tiene il pulsante spento in questo caso, quindi ci si arriva solo
  // per una strada che la UI non offre.
  if (outcomes.length === 0) {
    return { error: null, ok: "Non c'era niente da salvare.", done: true };
  }

  if (outcomes.some((outcome) => outcome.ok)) revalidatePath(USERS_PATH);

  const failed = outcomes.filter((outcome) => !outcome.ok);
  if (failed.length === 0) {
    return { error: null, ok: "Salvato.", outcomes, done: true };
  }
  return {
    error: failed.map((outcome) => outcome.message).join(" "),
    outcomes,
    done: false,
  };
}

/**
 * La cancellazione di un'asta dal pannello.
 *
 * È un'azione a sé e non quella del setup, per una ragione di destinazione: da
 * `/auctions/[id]/setup` si finisce in dashboard, da qui si torna alla lista del
 * pannello. Il motore è lo stesso — `deleteAuction` — e resta lui a decidere:
 * qui non si autorizza niente.
 *
 * Il nome digitato si confronta **qui**, come nel setup: è una difesa contro la
 * mano, non contro il chiamante, e nel motore diventerebbe un parametro che ogni
 * altro chiamante dovrebbe ricordarsi di riempire.
 *
 * ⚠ **`force: true` sempre, da questa azione** (M12 §4): questa è la strada
 * dell'amministratore, ed è l'unica che può interrompere un'asta in corso. Non è
 * un permesso che si prende scrivendolo qui — `deleteAuction` rilegge `is_admin`
 * dal database dentro il lock, quindi un `force` chiesto da chi non è
 * amministratore non cancella niente. La difesa contro la mano è il nome
 * digitato; la difesa vera è il motore.
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

  const result = await deleteAuction(admin.id, auctionId, { force: true });
  if (!result.ok) return { error: result.error.message };

  revalidatePath(AUCTIONS_PATH);
  // Quante persone sono state congedate si dice **solo se ce n'erano**: un
  // «0 collegati congedati» su una prova buttata è rumore che fa sembrare
  // grave una cosa che non lo era.
  const { name, dismissed } = result.value;
  return {
    error: null,
    ok:
      dismissed === 0
        ? `Asta «${name}» cancellata.`
        : `Asta «${name}» cancellata. ${dismissed === 1 ? "1 persona collegata è stata riportata" : `${dismissed} persone collegate sono state riportate`} alla dashboard.`,
  };
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
  // M10: non si dice più «il file è ancora selezionato», perché di file non ce
  // n'è più uno. Il «riprende da dov'era» resta vero per la stessa ragione di
  // sempre — lo stato è il disco, e si scarica solo ciò che non c'è.
  return (
    `${summary} Tempo scaduto: ne restano ${run.remaining}. ` +
    `Premi di nuovo: riprende da dov'era.`
  );
}

/**
 * Lo scaricamento delle figurine (M7 §4): **un click**.
 *
 * ⚠ **E da M10 nemmeno un file.** Gli id arrivano dal listone a sistema, non più
 * da un `.xlsx` ricaricato a ogni passata: era l'ultimo upload usa-e-getta del
 * pannello, e lo stesso file veniva caricato tre volte per tre scopi diversi. Se
 * la tabella è vuota l'azione **rifiuta e dice dove si carica**, invece di
 * scaricare zero figurine e dichiarare successo — che è il modo esatto in cui un
 * pulsante insegna a non fidarsi di sé (stessa regola di `refreshSetPieces`).
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
 * L'archivio resta **globale** e slegato dalle aste: legarlo a un'asta vorrebbe
 * dire perderlo quando quell'asta si cancella — che da M6 è facile.
 */
export async function downloadCampionciniAction(): Promise<FormState> {
  await requireAppAdmin();

  const extIds = await listoneExtIds();
  if (extIds.length === 0) {
    return {
      error:
        "A sistema non c'è nessun listone: carica il file qui sopra, poi riprova.",
    };
  }

  const run = await downloadCampioncini({ extIds, dir: campionciniDir() });

  revalidatePath(LISTONE_PATH);
  return { error: null, ok: runSummary(run) };
}

/**
 * Il caricamento del listone a sistema (M10 §2).
 *
 * ⚠ **È l'unico upload rimasto nel pannello**, ed è quello che ne toglie due: le
 * caricature non chiedono più un file e il Centro dati non esisteva. Il file non
 * si conserva (P6): se ne estraggono le righe e si butta.
 *
 * ⚠ **Non valida I9 e non può**: posti e slot sono di un'asta, qui non ce n'è
 * nessuna. I9 si valida alla copia dentro un'asta, che è il momento in cui esiste
 * qualcuno di cui chiederlo.
 */
export async function uploadListoneAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  await requireAppAdmin();

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Scegli il file .xlsx del listone." };
  }

  const result = await uploadListone(await file.arrayBuffer());
  if (!result.ok) return { error: result.error.message };

  revalidatePath(LISTONE_PATH);
  revalidatePath(DATI_PATH);
  const { rows, outOfList } = result.value;
  return {
    error: null,
    ok: `${rows} giocatori a sistema (${outOfList} fuori lista). Da adesso è quello proposto a chi crea un'asta.`,
  };
}

/**
 * Il caricamento del foglio di Carmy (M10B §8).
 *
 * ⚠ **Va dato dopo il listone, e non è una preferenza**: il join passa per nome da
 * `listone_players` (§3), quindi senza listone non c'è denominatore. Il motore lo
 * rifiuta dicendolo, invece di scrivere zero righe e dichiarare successo.
 *
 * ⚠ **I nomi non agganciati si dicono per nome**, come `unknown` in
 * `refreshSetPieces`: dieci nomi in fondo alla pagina sono l'unico modo di
 * accorgersi che il foglio e il listone hanno cominciato a divergere. E le
 * discordanze di squadra si dicono accanto, perché sono un'altra cosa — un
 * trasferimento, non un aggancio mancato.
 */
export async function uploadCarmyAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  await requireAppAdmin();

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Scegli il file .xlsx del foglio di Carmy." };
  }

  const result = await uploadCarmy(await file.arrayBuffer());
  if (!result.ok) return { error: result.error.message };

  revalidatePath(LISTONE_PATH);
  revalidatePath(DATI_PATH);
  const { fromFile, written, unmatched, teamMismatches } = result.value;

  const parts = [
    `${written} giudizi a sistema su ${fromFile} righe del foglio.`,
  ];
  if (unmatched.length > 0) {
    parts.push(
      `Non trovati nel listone (${unmatched.length}): ${unmatched.join(", ")} — di solito sono acquisti più recenti del listone caricato.`,
    );
  }
  if (teamMismatches.length > 0) {
    parts.push(
      `Squadra diversa dal listone (${teamMismatches.length}): ${teamMismatches
        .map((m) => `${m.name} — Carmy ${m.carmy}, listone ${m.listone}`)
        .join("; ")}. Il giudizio è stato importato comunque: di solito è un trasferimento.`,
    );
  }

  return { error: null, ok: parts.join(" ") };
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

  const result = await setUserPro(admin.id, userId, flag(form, "isPro"));
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
 *
 * ⚠ **Da M11 il pulsante scrive anche `source_runs`**, con `trigger: "manual"`, e
 * la riga sta **prima** del `return` di fallimento perché è soprattutto il
 * fallimento che va registrato. Senza, il pannello racconterebbe una storia e la
 * realtà un'altra: premo il pulsante, riesce, e la pagina continua a dire «ultimo
 * tentativo automatico fallito ieri». E vale anche al contrario — un pulsante che
 * fallisce adesso rimanda in avanti il prossimo tentativo automatico, che è
 * esattamente ciò che si vuole: il backoff protegge la fonte da *tutti* i
 * chiamanti, non solo dal loop.
 */
export async function refreshListoneInsightsAction(): Promise<FormState> {
  await requireAppAdmin();

  const result = await refreshListoneInsights();
  await recordSourceRun("listone_insights", "manual", result, new Date());
  if (!result.ok) return { error: result.error.message };

  revalidatePath(LISTONE_PATH);
  revalidatePath(DATI_PATH);
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
 *
 * ⚠ **Anche questo scrive `source_runs`** (M11 §5). E lo scrive *anche* quando il
 * rifiuto è «prima va importato il listone», che il tick automatico invece salta
 * senza registrare (§7): la differenza non è un'incoerenza, è chi ha fatto la
 * domanda. Il tick incontra quella condizione da solo, il giorno del deploy, ed è
 * un ordine di operazioni che si sistema da sé al primo giro utile; qui l'ha
 * chiesto una persona — il pulsante è pure spento a tabella vuota — e un
 * tentativo fatto apposta è un tentativo.
 */
export async function refreshSetPiecesAction(): Promise<FormState> {
  await requireAppAdmin();

  const result = await refreshSetPieces();
  await recordSourceRun("set_pieces", "manual", result, new Date());
  if (!result.ok) return { error: result.error.message };

  revalidatePath(LISTONE_PATH);
  revalidatePath(DATI_PATH);
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
