/**
 * La configurazione pm2 del processo di produzione (F8-03, PLAN §1).
 *
 * Questo file è **committato**, quindi non contiene nessun segreto: le variabili
 * d'ambiente le legge da `.env` nella radice del progetto sul server (lo stesso
 * file che usano `pnpm db:push`, il seed e i bot), così esiste un solo posto in
 * cui sta scritta la password del database.
 *
 * Tre righe qui dentro non sono negoziabili:
 *
 * - **`exec_mode: "fork"` e `instances: 1`.** In cluster mode pm2 avvierebbe più
 *   copie del processo, e ogni copia eseguirebbe `instrumentation.ts`: due sweep
 *   che fanno avanzare la stessa asta, cioè il bug di PLAN §16.8 riprodotto in
 *   produzione a comando. Tutta l'architettura (timer in-process, registro SSE
 *   su `globalThis`, `withAuctionLock` come unico punto di serializzazione)
 *   presuppone **un processo solo**.
 * - **`TZ: "UTC"`.** PLAN §17: il server gira in UTC e la conversione a
 *   `Europe/Rome` è solo di rendering. Non basta il fuso della macchina — questo
 *   lo fissa per il processo, qualunque cosa dica il sistema.
 * - **`HOSTNAME: "127.0.0.1"`.** Il server standalone di Next ascolta su
 *   `0.0.0.0` se non gli si dice altro. Davanti c'è nginx: la porta 3000 non
 *   deve essere raggiungibile da internet nemmeno per errore di firewall.
 *
 * ⚠ Conseguenza da ricordare: `.env` viene letto **quando pm2 valuta questo
 * file**. Dopo aver modificato una variabile serve quindi
 * `pm2 reload deploy/ecosystem.config.cjs --update-env`; un `pm2 restart asta`
 * riparte con l'ambiente che pm2 si è salvato la prima volta, e la modifica
 * sembrerebbe non aver avuto effetto.
 *
 * `script` punta al server standalone, che fa `process.chdir(__dirname)` da sé:
 * gira quindi con la working directory in `.next/standalone`, dove **non** c'è
 * nessun `.env` — ed è la ragione per cui le variabili le passiamo noi.
 */
const fs = require("node:fs");
const path = require("node:path");

/** La radice del progetto: `deploy/` sta un livello sotto. */
const ROOT = path.resolve(__dirname, "..");

/**
 * Un parser minimo di `.env`: niente dipendenze, perché pm2 esegue questo file
 * col proprio Node e non con quello del progetto. Formato accettato:
 * `CHIAVE=valore`, con apici opzionali e `#` per i commenti a inizio riga.
 */
function readEnvFile(file) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `Manca ${file}. Copia deploy/env.production.example in .env e riempilo (vedi docs/RUNBOOK.md).`,
    );
  }
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fileEnv = readEnvFile(path.join(ROOT, ".env"));

/** Le cinque variabili di PLAN §1: senza una di queste l'app non funziona. */
const REQUIRED = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "AUTH_URL",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
];

const missing = REQUIRED.filter((key) => !fileEnv[key]);
if (missing.length > 0) {
  // Meglio un errore qui che un login che gira a vuoto la sera dell'asta.
  throw new Error(`.env incompleto: manca ${missing.join(", ")}.`);
}

module.exports = {
  apps: [
    {
      name: "asta",
      cwd: ROOT,
      script: ".next/standalone/server.js",
      // ⚠ Un processo solo. Vedi il commento in testa al file.
      exec_mode: "fork",
      instances: 1,
      // Un riavvio è innocuo (lo stato è tutto a database e il boot recovery
      // riprende entro un secondo, F3-14), un OOM kill del kernel molto meno.
      // Il processo sta intorno ai 200 MB; la CX22 ne ha 4 GB.
      max_memory_restart: "512M",
      // Se il processo muore in loop, non tempestare il database di connessioni.
      restart_delay: 2000,
      max_restarts: 20,
      time: true,
      env: {
        ...fileEnv,
        NODE_ENV: "production",
        PORT: fileEnv.PORT || "3000",
        HOSTNAME: "127.0.0.1",
        TZ: "UTC",
      },
    },
  ],
};
