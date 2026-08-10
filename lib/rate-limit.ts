/**
 * Il rate limit, **in processo** (M5 §6).
 *
 * ⚠ Il vincolo che rende semplice tutto il resto di questa applicazione rende
 * esatto anche questo. Con `exec_mode: "fork"` e `instances: 1` esiste **un
 * processo solo**, quindi una `Map` in memoria è un contatore globale e
 * *corretto*, non un'approssimazione per nodo. Niente Redis — e non perché ce
 * lo vietiamo: perché non servirebbe a nulla.
 *
 * Copre due cose sole: i tentativi di login e le registrazioni per IP. La
 * verifica del codice e il reinvio **non passano da qui**, perché cinque
 * tentativi e sessanta secondi sono già righe nella tabella `email_codes`
 * (§4) — e un limite scritto a database sopravvive a un riavvio, mentre questo
 * no. Un limitatore in memoria è la scelta giusta solo dove il fatto da contare
 * non è già registrato altrove.
 *
 * Questo file non tocca il database.
 */

type Bucket = {
  count: number;
  /** Quando il conteggio si azzera da solo. */
  resetAt: number;
};

/**
 * Su `globalThis` come ogni singleton di questo progetto, e non in una
 * variabile di modulo: Next compila `instrumentation.ts` e i route handler in
 * **bundle separati**, quindi dello stesso file esistono due copie. È così che
 * in passato registro SSE e hook di broadcast si sono trovati in due mondi
 * diversi — e un limitatore in due mondi diversi conta la metà di quello che
 * dovrebbe, cioè non limita.
 */
const globalForLimit = globalThis as unknown as {
  __rateLimit?: Map<string, Bucket>;
};

const buckets: Map<string, Bucket> = (globalForLimit.__rateLimit ??= new Map());

/**
 * **Una `Map` che non sfratta nessuno è una perdita lenta** in un processo che
 * gira per mesi. La difesa è in due mosse, entrambe senza timer: la scadenza si
 * applica al tocco (una chiave scaduta che nessuno rilegge non costa niente
 * finché non si supera il tetto), e sopra c'è un tetto sul numero di chiavi.
 *
 * Diecimila chiavi sono qualche centinaio di kilobyte: enormemente più di
 * quante ne produrranno dodici amici, e abbastanza poche da non essere un modo
 * di far crescere la memoria mandando richieste da indirizzi sempre diversi.
 */
const MAX_KEYS = 10_000;

export type RateLimitVerdict =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Conta un tentativo e dice se passa.
 *
 * La finestra è **fissa e non scorrevole**: il primo tentativo apre la
 * finestra, e allo scadere il conteggio riparte da zero. Una finestra scorrevole
 * sarebbe più precisa e costerebbe una lista di timestamp per chiave; qui la
 * differenza la vedrebbe solo chi sta cercando di indovinare una password, e
 * la vedrebbe a proprio sfavore.
 */
export function hit(
  key: string,
  limit: number,
  windowSeconds: number,
  now: number = Date.now(),
): RateLimitVerdict {
  const existing = buckets.get(key);

  if (existing === undefined || now >= existing.resetAt) {
    evictIfCrowded(now);
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true };
}

/**
 * Azzera un contatore: è ciò che fa un **login riuscito**.
 *
 * Senza questo, dieci tentativi sbagliati sparsi in quindici minuti
 * bloccherebbero chi la password se l'è poi ricordata — che è il caso normale,
 * non l'attacco.
 */
export function reset(key: string): void {
  buckets.delete(key);
}

/** Quanti tentativi restano prima del rifiuto. Solo per i messaggi. */
export function remaining(
  key: string,
  limit: number,
  now: number = Date.now(),
): number {
  const bucket = buckets.get(key);
  if (bucket === undefined || now >= bucket.resetAt) return limit;
  return Math.max(0, limit - bucket.count);
}

/**
 * Lo sfratto, al tocco e senza timer: prima le chiavi già scadute, e se non
 * bastano le più vecchie per scadenza. `Map` itera in ordine di inserimento,
 * quindi «le più vecchie» costa un giro invece di un ordinamento.
 */
function evictIfCrowded(now: number): void {
  if (buckets.size < MAX_KEYS) return;

  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
  if (buckets.size < MAX_KEYS) return;

  // Nessuna scaduta: si taglia un decimo dalle più vecchie. Non è un caso che
  // capiterà mai con dodici amici; è che «mai» non è una politica di memoria.
  const toDrop = Math.ceil(MAX_KEYS / 10);
  let dropped = 0;
  for (const key of buckets.keys()) {
    buckets.delete(key);
    dropped += 1;
    if (dropped >= toDrop) break;
  }
}

/** Solo per i test: svuota tutto. */
export function clearAllLimits(): void {
  buckets.clear();
}

// ─── L'indirizzo IP del richiedente ──────────────────────────────────────────

/**
 * L'IP vero di chi sta facendo la richiesta.
 *
 * ⚠ **Dietro nginx `request.ip` non esiste e l'IP della connessione è
 * 127.0.0.1**: senza leggere `X-Forwarded-For`, il limite per IP sarebbe un
 * limite su un IP solo, cioè un limite globale mascherato — il primo che
 * sbaglia dieci password chiude fuori tutta la sala.
 *
 * Verificato in M5-06: `deploy/nginx-asta.conf` imposta
 * `X-Forwarded-For $proxy_add_x_forwarded_for` in **entrambi** i blocchi
 * (`location /` e quello dello stream). Il primo elemento della lista è il
 * client originale, gli altri sono i proxy attraversati.
 *
 * ⚠ E va detto cosa questo header **non** è: un dato attendibile. Chiunque può
 * mandarcelo, e `$proxy_add_x_forwarded_for` accoda al valore ricevuto invece
 * di sostituirlo. Prendiamo quindi l'**ultimo** elemento e non il primo: è
 * quello che nginx ha scritto lui, cioè l'unico che il client non controlla.
 * Con un solo proxy davanti — la nostra topologia — questo è l'IP vero.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return headers.get("x-real-ip")?.trim() || "sconosciuto";
}

// ─── Le due politiche che esistono ───────────────────────────────────────────

/** Dieci tentativi falliti per email in quindici minuti, azzerati al successo. */
export const LOGIN_BY_EMAIL = { limit: 10, windowSeconds: 15 * 60 } as const;

/**
 * Il tetto per IP: è **questo** che ferma chi spara su molti indirizzi diversi,
 * caso in cui il contatore per email non arriva mai a dieci su nessuno.
 */
export const LOGIN_BY_IP = { limit: 50, windowSeconds: 15 * 60 } as const;

/** Pochi account per IP all'ora. */
export const SIGNUP_BY_IP = { limit: 5, windowSeconds: 60 * 60 } as const;

/** Il flusso di recupero è non autenticato: sopra i cinque tentativi della tabella, un tetto per IP. */
export const RESET_BY_IP = { limit: 20, windowSeconds: 60 * 60 } as const;
