# Asta Fantacalcio a Busta Chiusa

Web app per gestire un'asta di Fantacalcio a busta chiusa in tempo reale.
8–12 partecipanti, tutti nella stessa stanza, che offrono dal telefono mentre un portale manager
è proiettato su una TV.

**La specifica completa è in `docs/PLAN.md`. È vincolante.** Questo file contiene solo ciò che
deve restare in contesto sempre.

---

## Regola zero

Prima di scrivere codice per una fase, **rileggi la sezione di `docs/PLAN.md` che la riguarda**.
Non lavorare a memoria: il piano contiene invarianti numerati che vanno rispettati alla lettera.

Se qualcosa nel piano è ambiguo o sbagliato, **fermati e chiedi**. Non risolvere l'ambiguità
inventando: annota la domanda e aspetta. Un'assunzione silenziosa qui costa un'asta rifatta.

---

## Fase corrente

> **FASE 8 — Deploy** · da aprire con **Opus** (il default di progetto: nessun `/model` da
> digitare). Fasi 0–7 chiuse: la 7 il **2026-08-08**, con **327 test verdi** e i due criteri ✅
> dimostrati — void + riassegnazione manuale che riporta crediti e rose a uno stato coerente (due
> righe a database, **una sola viva**, l'annullata con `voided_at`, I2 rispettata) e l'export che
> riempie `FantaSquadra` e `Costo` e riapre nel nostro stesso parser. Aggiorna questa riga a ogni
> passaggio di fase.

In Fase 8 si porta tutto **su una macchina vera**: Hetzner CX22 con Ploi, Postgres locale alla
macchina, nginx davanti con `proxy_buffering off` sulla rotta dello stream (senza, gli snapshot
arrivano a blocchi e i countdown vanno a scatti), Let's Encrypt, `pm2` con `--max-memory-restart`
e un `pg_dump` giornaliero in cron con la procedura di restore **provata almeno una volta**. Il
criterio ✅ è un'asta completa a 8 partecipanti giocata in produzione, poi cancellata; e la
checklist pre-asta di `docs/PLAN.md` §17 va eseguita per intero almeno una volta.

Attenzione alle due cose che in locale non si vedono: il redirect URI di **produzione** va aggiunto
nella console Google prima che il login funzioni, e `output: 'standalone'` vuole che i file statici
siano copiati accanto al bundle. Il boot recovery (F3-14) va riprovato **sul server**, con
`pm2 restart` a metà round.

Le fasi sono cancelli sequenziali (`docs/PLAN.md` §11). Non si apre una fase finché tutti i
criteri ✅ della precedente non sono verdi.

**Regole che la Fase 7 ha reso concrete e che restano vincolanti.** **Niente undo** (⚠ P1): un
lotto sbagliato si corregge con `voidAssignment` + `manualAssign`, la rotazione dei turni non torna
mai indietro. **Solo senza un lotto in contesa**: gli override sono rifiutati con `phase ∈
{LOT_OPEN, LOT_TIE_PREP}`, anche ad asta in pausa (la pausa congela la fase, non la azzera). E
**mai un `DELETE`** (regola 5): si scrive `voided_at`, e le rettifiche di budget sono righe di
`ledger` — un void invece **non** scrive nessuna riga compensativa, perché il credito è una formula
e il prezzo esce dalla somma da solo.

**A ogni chiusura di fase (task di GATE), ricapitola all'utente la sua parte**: i test manuali
che deve eseguire di persona per il gate appena chiuso, cosa lo aspetta nella fase successiva
**e con quale modello aprire la prossima sessione** (tabella in `docs/RUNBOOK.md`: il default di
progetto è Opus via `.claude/settings.json`; per le Fasi 2 e 3 deve digitare `/model fable`),
seguendo la "Guida per l'owner" in `docs/RUNBOOK.md`.

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
pnpm bots --auction=<id> --count=7 --strategy=random|tie|aggressive|passive
```

---

## Documentazione — obbligo a ogni iterazione

La documentazione non è un deliverable finale: **si aggiorna nella stessa sessione in cui si
scrive il codice**, altrimenti non verrà mai fatta.

| File | Cosa contiene | Quando si aggiorna |
|---|---|---|
| `docs/PLAN.md` | La specifica. **Sola lettura.** | Solo su richiesta esplicita dell'utente |
| `docs/BACKLOG.md` | Task atomici con checkbox, raggruppati per fase | A ogni task completato |
| `docs/ARCHITECTURE.md` | **Come funziona la web app, spiegato a un umano.** Prosa leggibile, non elenchi di file. Cosa fa ogni pezzo, come interagiscono, perché è stato fatto così. | A fine di ogni fase, obbligatorio |
| `docs/DECISIONS.md` | Append-only. Ogni scelta non prevista dal piano, con data e motivazione | Al momento della scelta |
| `docs/RUNBOOK.md` | Come far girare l'app in locale e cosa fare la sera dell'asta | Quando cambia una procedura |
| `docs/REQUESTS.md` | **Il quaderno dell'utente.** Modifiche che vuole fare *dopo*, annotate mentre prova l'app. **Non toccarlo e non lavorarci.** | Lo scrive lui, non tu |

**`docs/REQUESTS.md` è fuori dal piano di sviluppo.** Non è backlog: sono desiderata raccolti in
corsa, da affrontare **solo a fasi 0–8 concluse**, e su richiesta esplicita. Non anticiparne i
contenuti, non "già che ci sono", non citarlo come motivo per deviare da `docs/PLAN.md`. Se una
richiesta lì dentro contraddice il piano o un invariante, quello si discute quando arriverà il suo
turno, non prima.

`docs/ARCHITECTURE.md` è il documento che l'utente leggerà fra sei mesi per capire il proprio
progetto. Scrivilo per quel lettore: paragrafi, non bullet point; il "perché" prima del "come";
un diagramma testuale dove serve. **Aggiornarlo è un criterio di chiusura della fase, non un extra.**

---

## Errori noti da evitare

- **Scheduler duplicato in dev**: HMR rieseguirà `instrumentation.ts`. Usa
  `globalThis.__scheduler ??= start()`.
- **Ogni singleton di processo va su `globalThis`**, non in una variabile di modulo: Next compila
  `instrumentation.ts` e i route handler in **bundle separati**, quindi dello stesso file
  esistono due copie. È così che il registro delle connessioni SSE e l'hook di broadcast si
  erano trovati in due mondi diversi — stream aperto e poi silenzio per tutta l'asta.
- **Gli import di `instrumentation.ts` vanno dentro `if (process.env.NEXT_RUNTIME === "nodejs")`**,
  non dopo un `return` di guardia: solo il blocco `if` viene eliminato come ramo morto. Altrimenti
  `pg` finisce nel bundle edge e **l'app non parte affatto** (500 su ogni pagina).
- **`EventSource` doppio in dev**: React StrictMode monta due volte. Cleanup corretto nell'effect.
- **Test flaky**: `vi.useFakeTimers()` sempre. Mai un `sleep` reale in test.
- **Buffering SSE**: in nginx serve `proxy_buffering off` sulla route dello stream.
- **Mobile**: il portale partecipante è **mobile-first**, non desktop con breakpoint. Si offre dal
  telefono, sotto pressione, con 30 secondi di countdown.
- **Chunk client stantio in dev**: dopo molte modifiche con `pnpm dev` acceso, il browser può
  chiedere un bundle che non esiste più — `404 su /_next/static/chunks/app/.../page.js`. Il sintomo
  è ingannevole: la pagina *si carica* ma non idrata, quindi il portale resta fermo su "Mi collego
  all'asta…" e non parte nessuno stream né heartbeat. Non è un bug dell'app: riavvia il dev server.
  Prima di indagare su un client che "non riceve snapshot", controlla la console per un 404 su un
  chunk.

---

## La regola ESLint su `lib/db` — attiva, e da non allentare

Import di `lib/db` vietato fuori da `lib/engine/**` (più le eccezioni enumerate in
`eslint.config.mjs`). Rende meccanicamente impossibile la scorciatoia che rompe le regole 3 e 4.

**Quando una pagina o un componente ha bisogno di un nome di dominio** (i ruoli, gli stati di
un'asta, i tagli di partecipanti) la risposta non è aggiungere un'eccezione: quei nomi stanno in
`lib/domain.ts`, che non dipende da niente. Vale anche per i client component, che altrimenti si
porterebbero l'ORM nel bundle.
