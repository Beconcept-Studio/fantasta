/**
 * Il valore di ritorno delle Server Action del setup.
 *
 * Sta in un file suo e non accanto alle action: **un modulo `"use server"` può
 * esportare soltanto funzioni async**. Esportare da lì anche una costante
 * compila, passa il type-check e passa pure `next build` — poi esplode con un
 * 500 alla prima invocazione vera dell'azione. Tenerla fuori è l'unico modo di
 * non ricascarci.
 */
export type FormState = {
  /** Messaggio d'errore già leggibile, da `lib/engine/errors.ts`. */
  error: string | null;
  /** Conferma dopo un'operazione andata a buon fine. */
  ok?: string | null;
};

export const EMPTY_FORM_STATE: FormState = { error: null };

/**
 * Il parametro con cui la creazione di un'asta racconta alla configurazione
 * perché il listone a sistema **non** è stato copiato (M10 §4).
 *
 * ⚠ Sta qui per la ragione scritta qui sopra, che è già costata una volta: la
 * creazione finisce con un `redirect`, quindi la `FormState` muore con la pagina
 * che l'ha prodotta e l'URL è l'unico canale che sopravvive.
 */
export const LISTONE_NOTICE_PARAM = "listone";

/**
 * Il parametro con cui chi stava guardando un'asta cancellata arriva in
 * dashboard sapendo perché (M12 §3c). Porta il **nome** dell'asta: chi ne segue
 * due deve sapere quale delle due non c'è più.
 *
 * ⚠ Sta qui, accanto al suo gemello, per la stessa ragione: la schermata
 * dell'asta muore con l'asta, quindi non c'è nessuno stato di React che possa
 * sopravvivere alla navigazione — **l'URL è l'unico canale che resta**.
 */
export const DELETED_NOTICE_PARAM = "cancellata";
