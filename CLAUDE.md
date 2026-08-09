# Asta Fantacalcio a Busta Chiusa

Web app per gestire un'asta di Fantacalcio a busta chiusa in tempo reale.
8–12 partecipanti, tutti nella stessa stanza, che offrono dal telefono mentre un portale manager
è proiettato su una TV.

**v1.0.0 è in produzione su <https://fantasta.rggndr.it>.** La specifica con cui è stata
costruita è `docs/PLAN.md`: è **archivio**, non si estende più, ma **i suoi invarianti I1–I10
restano vincolanti per sempre**. Il lavoro corrente vive in `docs/features/`.

---

## Regola zero

Prima di scrivere codice per una macro-feature, **rileggi il suo file in `docs/features/` e gli
invarianti di `docs/PLAN.md` che tocca**. Non lavorare a memoria: gli invarianti sono numerati e
vanno rispettati alla lettera.

Se qualcosa è ambiguo o sbagliato, **fermati e chiedi**. Non risolvere l'ambiguità inventando:
annota la domanda e aspetta. Un'assunzione silenziosa qui costa un'asta rifatta.

---

## Come si lavora: una macro-feature alla volta, tre branch

Non ci sono più fasi. C'è una **macro-feature** per volta: un tema coerente abbastanza da
giustificare un branch e un merge in produzione. Nasce dalle richieste in `docs/REQUESTS.md`, si
apre **solo su richiesta esplicita dell'utente**, e ha un file suo in `docs/features/NN-nome.md`
con spec e task insieme. Quando una richiesta entra in una macro, **sparisce dal quaderno**: due
copie della stessa richiesta divergono sempre.

| Branch | Cos'è | Chi lo tocca |
|---|---|---|
| `main` | **La produzione.** Ogni push fa partire il deploy (~2 min). | Solo merge da `dev`. Mai un commit diretto. |
| `dev` | **L'integrazione.** Si prova in locale; nessun deploy la guarda. | Solo merge da `feature/*`. |
| `feature/NN-nome` | **Una macro-feature.** Nasce da `dev`, muore in `dev`. | Qui si committa, anche in piccolo. |

1. `git switch dev && git pull` → `git switch -c feature/NN-nome`
2. Si lavora e si committa liberamente: è il branch a essere macro, non il commit.
3. **Gate**: `pnpm test`, `pnpm typecheck` e `pnpm build` verdi, task del file feature spuntati.
   Poi `git merge --no-ff` su `dev`.
4. **Prova su `dev`**: Docker + seed, `pnpm bots`/`pnpm drive`, `pnpm dev:lan` dal telefono.
5. `git merge --no-ff` su `main`, versione e tag minor, `CHANGELOG.md`, push. Il deploy parte da solo.

`--no-ff` sempre: il merge commit è dove la macro inizia e finisce, ed è il punto di rollback.

**Niente branch per interventi piccoli.** Una correzione di una riga vive dentro la macro aperta,
oppure aspetta la prossima.

**Due eccezioni.** *Hotfix*: `fix/nome` da `main`, poi merge su `main` **e subito dopo su `dev`** —
se il secondo si dimentica, la prossima macro riporta in produzione il bug appena tolto.
*Schema*: se una macro tocca `lib/db/schema.ts` il merge su `main` **non basta**, perché
`pnpm db:push` non è nel deploy e va dato a mano sul server. Il file della feature lo dichiara in
testa; la procedura è in «Regole operative di produzione».

---

## Le otto regole non negoziabili

1. **Mai un timer che decide.** Il client renderizza i countdown, non li usa mai per cambiare
   stato. La chiusura di un round avviene solo lato server.
2. **Mai un `Date.now()` dentro le funzioni pure di `lib/engine/rules.ts` e `machine.ts`.**
   Il tempo si passa come parametro. È ciò che rende testabile l'intera macchina a stati.
3. **Mai serializzare lo stato dell'asta fuori da `serializeSnapshot`.** È l'unico punto in cui
   lo stato esce dal server, ed è ciò che garantisce che nessun importo di offerta trapeli
   durante `LOT_OPEN` (invariante I8).
4. **Mai mutare un'asta fuori da `withAuctionLock`.** Il `SELECT ... FOR UPDATE` sulla riga
   dell'asta è l'unico punto di serializzazione della concorrenza.
5. **Mai `DELETE` né `UPDATE` distruttivi su `assignments` e `ledger`.** Solo `voided_at` e righe
   compensative. In un'asta live serve poter annullare e riassegnare, non la correzione a mano
   di un numero.
6. **Mai fidarsi della validazione client.** La UI disabilita il pulsante, il server rifiuta comunque.
7. **Mai far dipendere la UI da un evento ricevuto.** Ogni schermata è funzione pura dello
   snapshot corrente. Se una schermata è raggiungibile solo da chi era connesso al momento
   giusto, è un bug (invariante I10).
8. **Mai un'astrazione prima del secondo chiamante.** Niente repository pattern, niente service
   layer generico, niente event sourcing. La codebase deve restare leggibile in un pomeriggio.

---

## Regole operative di produzione

**Niente undo.** Un lotto sbagliato si corregge con `voidAssignment` + `manualAssign`: la
rotazione dei turni non torna mai indietro.

**Gli override solo senza un lotto in contesa.** Sono rifiutati con `phase ∈ {LOT_OPEN,
LOT_TIE_PREP}`, anche ad asta in pausa — la pausa congela la fase, non la azzera.

**Mai un `DELETE`** (regola 5): si scrive `voided_at`. Un void **non** scrive righe compensative,
perché il credito è una formula e il prezzo esce dalla somma da solo.

**Un processo solo.** `exec_mode: "fork"` e `instances: 1` in `deploy/ecosystem.config.cjs` non
sono una preferenza: in cluster mode ogni copia eseguirebbe `instrumentation.ts`, cioè due sweep
sulla stessa asta.

**Il server gira in UTC**, processo compreso: `Europe/Rome` è solo rendering. **Dopo una modifica
di `.env`** serve `pm2 reload deploy/ecosystem.config.cjs --update-env`, **non** `pm2 restart asta`.

**La sera dell'asta non si pusha su `main`.** Il deploy si rifiuta di partire con un'asta `LIVE`
o `PAUSED`, ma la fase di setup non è protetta.

**La macchina, in breve.** Hetzner CX22 (`46.225.231.138`), Ubuntu 26.04, Ploi; Postgres 16 sulla
stessa macchina; un solo processo Node sotto pm2 (`asta`) su `127.0.0.1:3000`, nginx davanti con
Let's Encrypt; deploy automatico a ogni push su `main` (~2 minuti); `pg_dump` alle 04:15 UTC con
retention 14, in `deploy/db-backup.sh`. Il runbook è stato eliminato in v1.1.0 e resta leggibile
con `git show v1.0.0:docs/RUNBOOK.md`; le tre procedure che servono al flusso sono qui sotto.

**Una macro che tocca lo schema.** Dopo che il deploy è finito, sul server, con nessuna asta
`LIVE` o `PAUSED`:

```bash
cd ~/asta && pnpm db:push
pm2 reload deploy/ecosystem.config.cjs --update-env
```

Se il cambio è distruttivo (una colonna che sparisce, un tipo che cambia), prima un `pg_dump`:
`deploy/db-backup.sh`.

**Tornare indietro a una versione.** È a questo che servono i tag:

```bash
cd ~/asta && git fetch --tags && git reset --hard v1.2.0
pnpm install --prod=false && pnpm build
pm2 reload deploy/ecosystem.config.cjs --update-env
```

⚠ Se la versione da cui torni indietro aveva cambiato lo schema, il rollback del codice **non**
riporta indietro il database: serve il restore da `pg_dump` (`deploy/db-restore-check.sh` mostra
come si rilegge un dump).

**Deployare a mano**, se il webhook non parte: `cd ~/asta && ./deploy/deploy.sh`.

---

## Stack

Next.js 15 (App Router, `output: 'standalone'`) · TypeScript · shadcn/ui + Tailwind ·
PostgreSQL 16 · Drizzle · Auth.js v5 (Google) · SSE nativo · Vitest.

**Vietato introdurre**: Redis, code, worker separati, provider realtime esterni, servizi di
scheduling, Vercel. Un singolo processo Node su un singolo VPS è sufficiente e semplifica
radicalmente la concorrenza. Se pensi che serva altro, chiedi prima.

---

## Comandi

```bash
pnpm dev                  # app in sviluppo
pnpm dev:lan              # come sopra ma raggiungibile dal telefono in LAN (stampa l'URL)
docker compose up -d      # postgres (host: porta 5433, vedi DECISIONS 2026-08-07)
pnpm db:push              # applica lo schema drizzle
pnpm db:seed              # solo i 12 utenti di prova
pnpm db:seed --auction-status=ready    # + asta a 8 pronta, listone importato
pnpm db:seed --auction-status=mid      # asta LIVE già a metà (attenzione: con l'app accesa prosegue da sola)
pnpm drive --auction=<id>              # gioca un'asta READY/LIVE fino a COMPLETED, senza UI
pnpm test                 # vitest, fake timers obbligatori; i test in tests/db/ vogliono Postgres
pnpm typecheck            # tsc --noEmit
pnpm build                # next build — esegue ESLint: fa parte del gate, non del deploy
pnpm bots --auction=<id> --count=7 --strategy=random|tie|aggressive|passive
```

Il ciclo git:

```bash
git switch dev && git pull
git switch -c feature/NN-nome                          # apre una macro
git switch dev && git merge --no-ff feature/NN-nome    # a gate verde
git switch main && git merge --no-ff dev               # quando dev convince
git tag -a v1.N.0 -m "MN — tema" && git push origin main --tags
```

---

## Documentazione — obbligo a ogni iterazione

La documentazione non è un deliverable finale: **si aggiorna nella stessa sessione in cui si
scrive il codice**, altrimenti non verrà mai fatta.

| File | Cosa contiene | Quando si aggiorna |
|---|---|---|
| `docs/features/NN-nome.md` | **Il lavoro corrente.** Spec e task di una macro, nello stesso file | Task spuntati mentre si lavora |
| `docs/features/README.md` | L'indice: macro aperte, chiuse, e in quale versione | All'apertura e alla chiusura di una macro |
| `docs/ARCHITECTURE.md` | **Come funziona la web app, spiegato a un umano.** Prosa leggibile, non elenchi di file. Il perché prima del come | Alla chiusura di ogni macro, obbligatorio |
| `docs/DECISIONS.md` | Append-only. Ogni scelta non ovvia, con data e motivazione | Al momento della scelta |
| `CHANGELOG.md` | Una sezione per versione: cosa è cambiato per chi usa l'app | Al merge su `main` |
| `docs/REQUESTS.md` | **Il quaderno dell'utente.** Lo scrive lui | Claude lo tocca **solo** per togliere le richieste appena pianificate in una macro |
| `docs/PLAN.md`, `docs/BACKLOG.md` | **Archivio di v1.0.0.** Gli invarianti di `PLAN.md` restano vincolanti | Mai |

`docs/ARCHITECTURE.md` è il documento che l'utente leggerà fra sei mesi per capire il proprio
progetto. Scrivilo per quel lettore: paragrafi, non bullet point; il "perché" prima del "come";
un diagramma testuale dove serve. **Aggiornarlo è un criterio di chiusura della macro, non un extra.**

`docs/REQUESTS.md` è il quaderno in cui l'utente annota cosa vuole cambiare mentre usa l'app.
**Non ci si lavora e non se ne anticipano i contenuti.**

---

## Errori noti da evitare

- **Scheduler duplicato in dev**: HMR rieseguirà `instrumentation.ts`. Usa
  `globalThis.__scheduler ??= start()`.
- **Ogni singleton di processo va su `globalThis`**, non in una variabile di modulo: Next compila
  `instrumentation.ts` e i route handler in **bundle separati**, quindi dello stesso file esistono
  due copie. È così che registro SSE e hook di broadcast si erano trovati in due mondi diversi —
  stream aperto e poi silenzio per tutta l'asta.
- **Gli import di `instrumentation.ts` vanno dentro `if (process.env.NEXT_RUNTIME === "nodejs")`**,
  non dopo un `return` di guardia: solo il blocco `if` viene eliminato come ramo morto. Altrimenti
  `pg` finisce nel bundle edge e **l'app non parte affatto** (500 su ogni pagina).
- **`EventSource` doppio in dev**: React StrictMode monta due volte. Cleanup corretto nell'effect.
- **Test flaky**: `vi.useFakeTimers()` sempre. Mai un `sleep` reale in test.
- **Buffering SSE**: in nginx serve `proxy_buffering off` sulla route dello stream.
- **Mobile**: il portale partecipante è **mobile-first**, non desktop con breakpoint. Si offre dal
  telefono, sotto pressione, con 30 secondi di countdown.
- **`next build` esegue ESLint**: un errore di lint **fa fallire la build di produzione**, anche
  con `pnpm dev`, `pnpm test` e `pnpm typecheck` verdi. `pnpm build` va dato **prima** di chiudere
  qualunque lavoro con della UI dentro, non la sera del deploy.
- **Chunk client stantio in dev**: dopo molte modifiche con `pnpm dev` acceso, il browser può
  chiedere un bundle che non esiste più — `404 su /_next/static/chunks/app/.../page.js`. Il sintomo
  inganna: la pagina *si carica* ma non idrata, il portale resta su "Mi collego all'asta…" e non
  parte nessuno stream. Non è un bug dell'app: riavvia il dev server. Prima di indagare su un
  client che "non riceve snapshot", cerca un 404 su un chunk nella console.

---

## La regola ESLint su `lib/db` — attiva, e da non allentare

Import di `lib/db` vietato fuori da `lib/engine/**` (più le eccezioni enumerate in
`eslint.config.mjs`). Rende meccanicamente impossibile la scorciatoia che rompe le regole 3 e 4.

**Quando una pagina o un componente ha bisogno di un nome di dominio** (i ruoli, gli stati di
un'asta, i tagli di partecipanti) la risposta non è aggiungere un'eccezione: quei nomi stanno in
`lib/domain.ts`, che non dipende da niente. Vale anche per i client component, che altrimenti si
porterebbero l'ORM nel bundle.
