import { createTransport, type Transporter } from "nodemailer";

import { CODE_TTL_MINUTES } from "@/lib/engine/account-rules";

/**
 * L'invio delle email (M5 §7).
 *
 * **SMTP generico, non l'SDK del provider.** Oggi dall'altra parte c'è
 * MailerSend; cambiare fornitore deve essere cambiare quattro variabili in
 * `.env`, non riscrivere una riga di codice. `nodemailer` non è nulla di ciò
 * che lo stack vieta — non è una coda, non è un worker, non è un servizio di
 * scheduling — ma è comunque una dipendenza esterna nuova, ed è annotata in
 * `docs/DECISIONS.md`.
 *
 * ⚠ **In produzione si manda, sempre e comunque.** Non esiste nessun ripiego
 * sullo stdout: un `.env` mal configurato deve far *fallire* l'invio, non
 * scrivere i codici nei log del server. È il punto fermo di §7 — in produzione
 * l'unico modo di leggere un codice dev'essere la casella di posta — e non
 * dipende da nessuna variabile.
 *
 * ⚠ **Fuori produzione decide la presenza di `SMTP_HOST`**: se c'è si manda
 * davvero, se manca il codice va sullo stdout. Il default resta quindi quello
 * della spec — chi clona il progetto collauda l'intero flusso senza avere
 * nessuna credenziale — ma chi le credenziali ce le ha può **verificarle prima
 * del deploy**, invece di scoprire la sera dell'asta che il mittente non sta sul
 * dominio verificato presso il provider (DECISIONS 2026-08-10).
 *
 * ⚠ Il prezzo, dichiarato perché è una conseguenza voluta e non una svista: un
 * `.env` di produzione copiato in locale **manda email vere**, a indirizzi di
 * prova e a spese della quota MailerSend.
 *
 * Questo file **non importa `lib/db`**, quindi non ha bisogno di stare in
 * `lib/engine`.
 */

/**
 * Si manda davvero, o si stampa?
 *
 * Letta a ogni chiamata e non una volta all'import: in sviluppo si cambia il
 * `.env` e si riavvia, e una costante di modulo lascerebbe il processo convinto
 * di ciò che era vero al primo caricamento del bundle.
 *
 * ⚠ **Sotto test non si manda mai, qualunque cosa dica il `.env`.** `vitest`
 * carica lo stesso `.env` dell'applicazione (`vitest.setup.ts`), quindi da
 * quando «basta la presenza di `SMTP_HOST`» un test che chiamasse `sendCode`
 * senza mockare questo modulo spedirebbe email vere — a indirizzi
 * `@test.invalid`, in un ciclo di `pnpm test`, a spese della quota del
 * provider. Oggi l'unico test che passa di qui mocka `lib/mail`; questa riga
 * serve perché resti vero anche quando lo scriverà qualcun altro.
 */
function shouldSend(): boolean {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return false;
  return (
    process.env.NODE_ENV === "production" || Boolean(process.env.SMTP_HOST)
  );
}

/**
 * Una chiamata di rete dentro una richiesta HTTP, in un processo solo: se
 * l'SMTP non risponde, dieci secondi è quanto siamo disposti a farci tenere
 * fermi. Oltre, `sendCode` fallisce — e chi lo chiama sa già cosa fare, perché
 * l'account è stato creato prima (§7).
 */
const TIMEOUT_MS = 10_000;

const globalForMail = globalThis as unknown as { __mailer?: Transporter };

function transporter(): Transporter {
  // Su `globalThis` come ogni singleton di processo di questo progetto: Next
  // compila i route handler in bundle separati, e una variabile di modulo
  // diventerebbe un pool di connessioni SMTP per bundle.
  globalForMail.__mailer ??= createTransport({
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
    // 465 è TLS implicito, 587 è STARTTLS: la regola la decide la porta, che è
    // esattamente come la documenta ogni provider SMTP esistente.
    secure: Number(required("SMTP_PORT")) === 465,
    auth: { user: required("SMTP_USER"), pass: required("SMTP_PASS") },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
  return globalForMail.__mailer;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} non è impostata: in produzione serve per mandare i codici di verifica.`,
    );
  }
  return value;
}

type CodeMail = {
  to: string;
  code: string;
  purpose: "VERIFY_EMAIL" | "RESET_PASSWORD";
};

const SUBJECTS: Record<CodeMail["purpose"], string> = {
  VERIFY_EMAIL: "Il tuo codice di verifica",
  RESET_PASSWORD: "Il tuo codice per cambiare password",
};

function body({ code, purpose }: CodeMail): string {
  const intro =
    purpose === "VERIFY_EMAIL"
      ? "Ecco il codice per confermare il tuo indirizzo e entrare nell'asta:"
      : "Ecco il codice per scegliere una password nuova:";
  return [
    intro,
    "",
    `    ${code}`,
    "",
    `Vale ${CODE_TTL_MINUTES} minuti. Se non hai chiesto tu questo codice, puoi ignorare questa email.`,
    "",
    "— Asta Fantacalcio",
  ].join("\n");
}

/**
 * Manda un codice, o lo stampa.
 *
 * ⚠ **Il codice non compare mai nella risposta HTTP**, in nessun ambiente:
 * esce da qui e da nessun'altra parte. Senza `SMTP_HOST` «da qui» è lo stdout
 * del dev server, che è esattamente dove chi sta collaudando sta già guardando;
 * con `SMTP_HOST` è la casella di posta, in locale come in produzione.
 *
 * Lancia se l'invio fallisce. Chi chiama **non deve** disfare niente: a quel
 * punto l'account esiste già, non verificato, e la schermata successiva è
 * quella di sempre — «inserisci il codice», col pulsante per rimandarlo.
 */
export async function sendCode(mail: CodeMail): Promise<void> {
  if (!shouldSend()) {
    console.log(
      `\n──── EMAIL (non inviata: nessun SMTP_HOST nel .env) ────\n` +
        `A:       ${mail.to}\n` +
        `Oggetto: ${SUBJECTS[mail.purpose]}\n` +
        `CODICE:  ${mail.code}\n` +
        `───────────────────────────────────────────────────────\n`,
    );
    return;
  }

  await transporter().sendMail({
    from: required("MAIL_FROM"),
    to: mail.to,
    subject: SUBJECTS[mail.purpose],
    text: body(mail),
  });
}
