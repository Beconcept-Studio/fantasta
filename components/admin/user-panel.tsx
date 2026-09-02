"use client";

import { Dialog, Switch } from "radix-ui";
import { type ReactNode, useActionState, useEffect, useState } from "react";

import { saveUserAction } from "@/app/admin/actions";
import type { AdminUserView } from "@/components/admin/user-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EMPTY_USER_SAVE_STATE,
  USER_FIELD_LABELS,
  type UserSaveState,
} from "@/lib/admin-users";
import { ADMIN_ROOT } from "@/lib/admin-nav";
import type { AdminEntry } from "@/lib/engine/admin";
import { cn } from "@/lib/utils";

/**
 * Il pannello laterale della pagina utenti (M13 §5): **il recap completo, e le
 * quattro cose che si modificano**.
 *
 * ⚠ **`Dialog` di `radix-ui` direttamente, nessun `components/ui/sheet.tsx`**, ed
 * esiste il precedente letterale: `components/auction/bid-modal.tsx` monta il suo
 * sheet a mano per la ragione di `DECISIONS.md` 2026-08-07 — le primitive condivise
 * si allargano quando arriva il secondo chiamante **generico**. Questo è il secondo
 * modale dell'applicazione, ma il primo è uno sheet dal basso pensato per un pollice
 * sotto un countdown, e non ha niente da condividere con un pannello laterale da
 * scrivania oltre l'overlay.
 *
 * ⚠ **Lo `Switch` è quello di `radix-ui`, che è già installato**, e non la variante
 * Base UI del link della richiesta: quella pagina di shadcn monta
 * `@base-ui-components/react`, cioè una seconda libreria di primitive accanto a
 * quella che il progetto usa in ogni componente, per un interruttore. Il
 * comportamento chiesto — On/off — è lo stesso.
 *
 * **Da scrivania, come tutto il pannello** (M6). Su uno schermo stretto lo sheet
 * prende tutta la larghezza invece di diventare una colonna accanto a una tabella
 * che non c'è più: non è mobile-first, è non-rotto-sul-piccolo.
 *
 * ⚠ **Il salvataggio non è atomico e questa UI non fa finta che lo sia.** Sono
 * quattro `UPDATE` distinti, quindi può riuscire a metà: l'esito si legge **per
 * campo** e su qualunque errore il modale **resta aperto**. Si chiude solo su
 * `done`, che il server scrive solo se tutto ciò che era stato chiesto è passato.
 *
 * ⚠ **Al server va solo ciò che è cambiato**, e il modo in cui glielo si dice è la
 * presenza del campo nella `FormData`: un `input` nascosto compare solo quando quel
 * valore differisce da quello che il server ha mandato. Non c'è nessun «valore
 * precedente» da far tornare, e l'intenzione non è deducibile da un confronto che il
 * server non può fare — `app/admin/actions.ts` non legge il database, e
 * `lib/engine/admin.ts` non si tocca (§1).
 */
const ENTRY_LABELS: Record<AdminEntry, string> = {
  google: "Google",
  password: "Password",
  both: "Google + password",
  none: "Nessuna credenziale",
};

export function UserPanel({
  user,
  onClose,
  onResult,
}: {
  user: AdminUserView;
  onClose: () => void;
  /**
   * L'esito, riportato **a chi sopravvive alla chiusura** (`UsersTable`).
   *
   * ⚠ È lui a decidere se chiudere, non questo componente: a pieno successo il
   * pannello se ne va, e un messaggio che se ne va insieme al pannello è un
   * messaggio che nessuno ha letto — era esattamente il buco che il toast chiude.
   */
  onResult: (state: UserSaveState) => void;
}) {
  const [state, save, saving] = useActionState(
    saveUserAction,
    EMPTY_USER_SAVE_STATE,
  );

  const [name, setName] = useState(user.displayName ?? "");
  // ⚠ La verifica parte da dov'è e **non torna indietro**: se l'indirizzo è già
  // dimostrato questo stato non serve a niente, perché lo switch è bloccato.
  const [verify, setVerify] = useState(user.verified);
  const [isAdmin, setIsAdmin] = useState(user.isAdmin);
  const [isPro, setIsPro] = useState(user.isPro);
  const [statsPlus, setStatsPlus] = useState(user.statsPlus);

  // Ogni ritorno dell'azione scrive `done` oppure un `error`: l'assenza di entrambi
  // è lo stato iniziale di `useActionState`, cioè «nessuno ha ancora premuto Salva».
  const settled = state.done !== undefined || state.error !== null;
  useEffect(() => {
    if (settled) onResult(state);
    // ⚠ Chi chiude è `UsersTable`, e **solo** su `done`: un salvataggio riuscito a
    // metà lascia il pannello aperto col suo esito per campo, ed è il punto di §5 su
    // cui questa macro può fare più danno.
  }, [state, settled, onResult]);

  const trimmed = name.trim();
  const nameChanged = trimmed !== (user.displayName ?? "").trim();
  const nameTooShort = nameChanged && trimmed.length < 3;
  const verifyChanged = verify && !user.verified;
  const adminChanged = isAdmin !== user.isAdmin;
  const proChanged = isPro !== user.isPro;
  const statsChanged = statsPlus !== user.statsPlus;
  const dirty =
    nameChanged || verifyChanged || adminChanged || proChanged || statsChanged;

  // Un bot non ha un nome da correggere né un indirizzo da verificare (§6): il
  // pannello è tutto recap, e lo dice invece di mostrare quattro comandi spenti.
  const editable = !user.isBot;

  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right fixed inset-y-0 right-0 z-50 flex w-full flex-col gap-4 overflow-y-auto border-l p-5 outline-none sm:max-w-md">
          <div className="space-y-1">
            <Dialog.Title className="text-lg leading-tight font-semibold">
              {user.displayName ?? user.email ?? "Utente senza nome"}
            </Dialog.Title>
            <Dialog.Description className="text-muted-foreground font-mono text-xs break-all">
              {user.email ?? "nessun indirizzo"}
            </Dialog.Description>
          </div>

          {/* ── Il recap: anche ciò che in tabella non c'è più ── */}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <Field label="Come entra">{ENTRY_LABELS[user.entry]}</Field>
            <Field label="Email verificata">
              {/* ⚠ **Quando**, non solo se: è la prima cosa che il modale ha lo
                  spazio per dire, e serve a distinguere un indirizzo dimostrato
                  da uno verificato a mano il giorno dell'asta. */}
              {user.verified
                ? user.verifiedOn === null
                  ? "Sì"
                  : `Sì, dal ${user.verifiedOn}`
                : "No"}
            </Field>
            <Field label="Aste">
              {user.ownedAuctions} possedute · {user.playedAuctions} giocate
              {(user.ownedAuctions > 0 || user.playedAuctions > 0) && (
                <>
                  {" · "}
                  {/* Il rimando, non la vista: le aste si guardano dove si
                      guardano le aste (M6). */}
                  <a
                    href={`${ADMIN_ROOT}/auctions`}
                    className="underline underline-offset-4"
                  >
                    vedi le aste
                  </a>
                </>
              )}
            </Field>
            <Field label="Iscritto">{user.createdOn}</Field>
            {user.isBot && <Field label="Riga">Bot di una simulazione</Field>}
          </dl>

          <p className="text-muted-foreground border-t pt-4 text-xs">
            L&apos;<strong>indirizzo email non si modifica</strong>: da quando si
            entra anche con una password è la chiave d&apos;identità, e cambiarla
            cambia <em>chi può entrare</em> in quell&apos;account. Un indirizzo
            sbagliato si risolve rifacendo l&apos;account.
          </p>

          {!editable ? (
            <>
              <p className="text-muted-foreground text-sm">
                Su un bot non c&apos;è niente da modificare: non ha un nome da
                correggere, non ha un indirizzo da verificare, non amministra
                niente e non guarda nessuna lista.
              </p>
              <div className="mt-auto border-t pt-4">
                <Dialog.Close asChild>
                  <Button type="button" variant="outline" size="lg">
                    Chiudi
                  </Button>
                </Dialog.Close>
              </div>
            </>
          ) : (
            <form action={save} className="flex flex-1 flex-col gap-4">
              <input type="hidden" name="userId" value={user.id} />

              {/* ⚠ Il campo visibile **non ha `name`**: al server il nome arriva
                  dall'input nascosto qui sotto, che esiste solo se è cambiato. */}
              <div className="space-y-1.5">
                <Label htmlFor="panel-name">Nome</Label>
                <Input
                  id="panel-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  aria-invalid={nameTooShort}
                  disabled={saving}
                />
                <p className="text-muted-foreground text-xs">
                  Fra 3 e 60 caratteri: la stessa regola dell&apos;onboarding.
                </p>
                {nameChanged && !nameTooShort && (
                  <input type="hidden" name="displayName" value={name} />
                )}
              </div>

              <div className="space-y-3 border-t pt-4">
                {/* ── Lo switch a senso unico ──
                    `forceVerifyEmail` sa fare una cosa sola: **scrivere**
                    `email_verified_at`. Una de-verifica rispedirebbe una persona
                    alla schermata del codice, cioè la chiuderebbe fuori
                    dall'applicazione con un click. Ma uno switch promette due
                    direzioni: quindi acceso e **bloccato** quando l'indirizzo è
                    dimostrato, con la ragione scritta accanto. */}
                <FlagSwitch
                  id="panel-verified"
                  label={USER_FIELD_LABELS.verified}
                  checked={verify}
                  onCheckedChange={setVerify}
                  disabled={saving || user.verified || user.email === null}
                  hint={
                    user.verified
                      ? "L'indirizzo è dimostrato: non si torna indietro."
                      : user.email === null
                        ? "Questa riga non ha un indirizzo: non c'è niente da verificare."
                        : "Metti la tua parola al posto della prova: solo per una persona che hai davanti."
                  }
                />

                {/* ⚠ **Assente sulla propria riga, non spento** (§5): il motore
                    lo rifiuta comunque, ma un pulsante che esiste è un pulsante
                    che qualcuno premerà — e un click e ci chiudiamo fuori tutti. */}
                {user.isSelf ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      {USER_FIELD_LABELS.isAdmin}: {user.isAdmin ? "Sì" : "No"}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Questa è la tua riga: il tuo permesso di amministratore non
                      si cambia da qui. Se ti chiudi fuori non c&apos;è
                      un&apos;altra porta da cui rientrare — lo fa un altro
                      amministratore.
                    </p>
                  </div>
                ) : (
                  <FlagSwitch
                    id="panel-admin"
                    label={USER_FIELD_LABELS.isAdmin}
                    checked={isAdmin}
                    onCheckedChange={setIsAdmin}
                    disabled={saving}
                    hint="Vede e usa tutto il pannello di amministrazione."
                  />
                )}

                {/* ⚠ **Sulla propria riga questo c'è**, e la differenza con
                    `is_admin` è di sostanza: non apre nessuna porta, e un
                    amministratore vede gli insight comunque (`canSeeInsights`). */}
                <FlagSwitch
                  id="panel-pro"
                  label={USER_FIELD_LABELS.isPro}
                  checked={isPro}
                  onCheckedChange={setIsPro}
                  disabled={saving}
                  hint="Vede gli insight sul listone: titolarità, rigoristi, piazzati."
                />

                {/* ⚠ **L'interruttore resta acceso anche senza Pro, e la frase
                    dice perché non basta.** Disabilitarlo imporrebbe un ordine
                    fra i due — prima Pro, poi Stats+ — cioè una cosa in più da
                    ricordare per una combinazione che non fa danno: `stats_plus`
                    senza `is_pro` non mostra niente e non rompe niente
                    (`canSeeStatsPlus`). Il posto giusto per dirlo è qui, nel
                    momento in cui si accende, non il portale di chi lo riceve. */}
                <FlagSwitch
                  id="panel-stats-plus"
                  label={USER_FIELD_LABELS.statsPlus}
                  checked={statsPlus}
                  onCheckedChange={setStatsPlus}
                  disabled={saving}
                  hint={
                    isPro
                      ? "Vede la temperatura dell'asta e le alternative del lotto in corso."
                      : "Vede la temperatura dell'asta e le alternative del lotto in corso. ⚠ Senza Pro non ha i PMA, quindi non vedrà niente."
                  }
                />

                {adminChanged && (
                  <input
                    type="hidden"
                    name="isAdmin"
                    value={isAdmin ? "true" : "false"}
                  />
                )}
                {proChanged && (
                  <input
                    type="hidden"
                    name="isPro"
                    value={isPro ? "true" : "false"}
                  />
                )}
                {statsChanged && (
                  <input
                    type="hidden"
                    name="statsPlus"
                    value={statsPlus ? "true" : "false"}
                  />
                )}
                {verifyChanged && (
                  <input type="hidden" name="verify" value="1" />
                )}
              </div>

              <Outcome state={state} nameTooShort={nameTooShort} />

              <div className="mt-auto flex gap-2 border-t pt-4">
                <Button
                  type="submit"
                  size="lg"
                  className="flex-1"
                  disabled={saving || !dirty || nameTooShort}
                >
                  {saving ? "Salvo…" : "Salva"}
                </Button>
                <Dialog.Close asChild>
                  <Button type="button" variant="ghost" size="lg">
                    Chiudi
                  </Button>
                </Dialog.Close>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

/**
 * Uno switch con la sua etichetta vera e il suo stato scritto.
 *
 * ⚠ **`Label` + `id`, non un `aria-label` che nessuno legge**: uno switch senza
 * etichetta è un interruttore in una stanza buia. E accanto c'è la parola
 * «Sì»/«No», perché lo stato deve essere leggibile senza colore — la posizione del
 * pollice di un interruttore è un'informazione che chi guarda da lontano, o chi non
 * distingue quei due grigi, non ha.
 */
function FlagSwitch({
  id,
  label,
  checked,
  onCheckedChange,
  disabled,
  hint,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <Label htmlFor={id}>{label}</Label>
        {hint !== undefined && (
          <p className="text-muted-foreground text-xs">{hint}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span
          className={cn(
            "text-sm tabular-nums",
            disabled === true && "text-muted-foreground",
          )}
        >
          {checked ? "Sì" : "No"}
        </span>
        <Switch.Root
          id={id}
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent transition-all outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Switch.Thumb className="bg-background pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0" />
        </Switch.Root>
      </div>
    </div>
  );
}

/**
 * L'esito, **campo per campo** (§5): un «salvato» unico su tre campi scritti e uno
 * rifiutato è il modo di rendere inaffidabile l'unico pannello che c'è. Il segno
 * ✓/✕ sta davanti perché il colore non basta.
 */
function Outcome({
  state,
  nameTooShort,
}: {
  state: UserSaveState;
  nameTooShort: boolean;
}) {
  if (nameTooShort) {
    return (
      <p role="status" className="text-sm text-amber-700">
        Il nome deve stare fra 3 e 60 caratteri.
      </p>
    );
  }

  const outcomes = state.outcomes ?? [];
  if (outcomes.length === 0 && state.error === null) return null;

  return (
    <div className="space-y-1">
      {outcomes.length > 0 && (
        <ul role={state.error === null ? "status" : "alert"} className="space-y-1">
          {outcomes.map((outcome) => (
            <li
              key={outcome.field}
              className={cn(
                "text-sm",
                outcome.ok ? "text-emerald-700" : "text-destructive",
              )}
            >
              {outcome.ok ? "✓" : "✕"}{" "}
              <span className="font-medium">
                {USER_FIELD_LABELS[outcome.field]}
              </span>
              {": "}
              {outcome.message}
            </li>
          ))}
        </ul>
      )}
      {state.error !== null && outcomes.length === 0 && (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}
    </div>
  );
}
