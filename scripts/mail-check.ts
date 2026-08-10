/**
 * `pnpm mail:check` — l'SMTP risponde? E le credenziali sono quelle giuste?
 *
 * Esiste per una ragione sola, ed è la sera dell'asta: quando un codice non
 * arriva, la prima domanda è **di chi è la colpa**, e senza questo comando la
 * risposta si cerca dentro l'applicazione — dove non è. Trenta secondi qui
 * separano «l'SMTP è rotto» da «l'app non sta mandando», che sono due indagini
 * completamente diverse.
 *
 *   pnpm mail:check                      # apre la connessione, si autentica, NON manda niente
 *   pnpm mail:check --to=tu@example.com  # manda anche un'email di prova, a un solo destinatario
 *
 * ⚠ Con `--to` l'email parte **davvero** e consuma la quota del provider: è il
 * punto del comando, ma va detto.
 *
 * ⚠ Legge le stesse cinque variabili di `lib/mail.ts` dallo stesso `.env`, e
 * costruisce il trasporto con gli stessi parametri. Se questo comando funziona e
 * l'applicazione no, il problema non è l'SMTP — è che il processo dell'app ha in
 * ambiente un `.env` diverso, tipicamente perché è stato avviato prima di una
 * modifica (in produzione: `pm2 reload … --update-env`, non `pm2 restart asta`).
 */
import { createTransport } from "nodemailer";

function parseArgs(argv: string[]): { to: string | null } {
  let to: string | null = null;
  for (const arg of argv) {
    if (arg === "--") continue;
    const match = /^--to=(.*)$/.exec(arg);
    if (match) {
      to = match[1];
      continue;
    }
    if (arg === "--to") throw new Error("Usa --to=<indirizzo>, con l'uguale.");
    throw new Error(`Argomento non riconosciuto: ${arg}`);
  }
  return { to };
}

/** Mostra abbastanza per riconoscere il valore, non abbastanza per riusarlo. */
function masked(value: string): string {
  if (value.length <= 6) return "…";
  return `${value.slice(0, 3)}…${value.slice(-3)}`;
}

async function main(): Promise<void> {
  const { to } = parseArgs(process.argv.slice(2));

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM;

  console.log(`host : ${host || "(vuoto)"}`);
  console.log(`port : ${port || "(vuota)"}${port ? ` — ${port === 465 ? "TLS implicito" : "STARTTLS"}` : ""}`);
  console.log(`user : ${user ? masked(user) : "(vuoto)"}`);
  console.log(`pass : ${pass ? `impostata, ${pass.length} caratteri` : "(vuota)"}`);
  console.log(`from : ${from || "(vuoto)"}\n`);

  const missing = (
    [
      ["SMTP_HOST", host],
      ["SMTP_PORT", process.env.SMTP_PORT],
      ["SMTP_USER", user],
      ["SMTP_PASS", pass],
      ["MAIL_FROM", from],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `Manca ${missing.join(", ")} nel .env. ` +
        `Senza SMTP_HOST l'applicazione, fuori produzione, stampa i codici sullo stdout invece di mandarli.`,
    );
  }

  const transporter = createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });

  try {
    await transporter.verify();
    console.log("✓ Connessione e autenticazione riuscite: il trasporto funziona.");

    if (to === null) {
      console.log(
        "  Nessuna email inviata. Per mandarne una di prova: pnpm mail:check --to=<indirizzo>",
      );
      return;
    }

    const info = await transporter.sendMail({
      from,
      to,
      subject: "Prova di invio — Asta Fantacalcio",
      text:
        "Se leggi questa email, l'SMTP configurato in .env funziona.\n\n— Asta Fantacalcio",
    });
    console.log(`\n✓ Il server SMTP ha accettato il messaggio.`);
    console.log(`  accettati: ${JSON.stringify(info.accepted)}`);
    console.log(`  rifiutati: ${JSON.stringify(info.rejected)}`);
    console.log(`  risposta : ${info.response}`);
    console.log(
      `\n⚠ «Accettato» non è «recapitato»: se non arriva, guarda lo spam e poi il pannello del\n` +
        `  provider. Con MailerSend gli account in prova accettano solo destinatari del dominio\n` +
        `  amministratore, e MAIL_FROM deve stare sul dominio verificato.`,
    );
  } finally {
    transporter.close();
  }
}

main().catch((error: unknown) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
