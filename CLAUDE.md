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

> **FASE 5 — Portale partecipante** · da aprire con **Opus** (il default di progetto: nessun
> `/model` da digitare). Fasi 0–4 chiuse il 2026-08-07 (la 4: 220 test verdi, test I8 sui tre
> viewer, asta completa con 8 bot collegati via SSE; i collaudi visivi delle Fasi 3 e 4 spettano
> all'owner). Aggiorna questa riga a ogni passaggio di fase.

In Fase 5 il canale non si tocca: si disegna il **portale del partecipante**, mobile-first, su
`/auctions/[id]/play`. Tutto ciò che serve arriva dallo snapshot, e ogni schermata è funzione
pura di quello (regola 7, I10): `useAuctionStream` in `lib/realtime/use-auction-stream.ts` dà
snapshot, `offset` dell'orologio e tempo residuo; `useHeartbeat` tiene viva la presence; le
azioni passano da `POST /api/auctions/:id/action` (o da una Server Action, a scelta — il primo
è già lì e risponde con codici tipizzati). La gerarchia della UI è **vincolante**: banner globale
→ card permanente del lotto → modale (`docs/PLAN.md` §8bis), e `dismissedLotId` vive solo nello
state del componente. Il countdown si rende, non decide (regola 1).

Le fasi sono cancelli sequenziali (`docs/PLAN.md` §11). Non si apre una fase finché tutti i
criteri ✅ della precedente non sono verdi. Il gate della 5 include un collaudo **su un telefono
vero** via `pnpm dev:lan`, non sul simulatore del browser.

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

---

## La regola ESLint su `lib/db` — attiva, e da non allentare

Import di `lib/db` vietato fuori da `lib/engine/**` (più le eccezioni enumerate in
`eslint.config.mjs`). Rende meccanicamente impossibile la scorciatoia che rompe le regole 3 e 4.

**Quando una pagina o un componente ha bisogno di un nome di dominio** (i ruoli, gli stati di
un'asta, i tagli di partecipanti) la risposta non è aggiungere un'eccezione: quei nomi stanno in
`lib/domain.ts`, che non dipende da niente. Vale anche per i client component, che altrimenti si
porterebbero l'ORM nel bundle.
