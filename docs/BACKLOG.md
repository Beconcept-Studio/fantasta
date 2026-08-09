# BACKLOG — Asta Fantacalcio a Busta Chiusa

> **Archivio di v1.0.0. Non aggiornare.** Tutti i task delle fasi 0–8 sono chiusi. Il lavoro
> corrente è in `docs/features/`: una macro-feature per file, spec e task insieme.

Scomposizione operativa delle fasi di `docs/PLAN.md` §11. Ogni task è completabile e
verificabile in isolamento. Nessuna fase si apre finché il task di gate della precedente
non è verde.

**Legenda:**
- `Verifica:` criterio esplicito di completamento.
- `Dipende:` id di task prerequisiti (— = nessuno).
- ⚠ Pn = il task incorpora una risoluzione dell'interrogazione del piano (kickoff, punto Pn),
  ratificata il 2026-08-06 e registrata in `docs/DECISIONS.md`.

**Ripartizione dei test di §12** (⚠ P5 — il piano li elencava tutti in Fase 2, ma alcuni
richiedono DB, snapshot o azioni di fasi successive):

| Fase | Test §12 |
|---|---|
| Fase 2 (funzioni pure) | 1–26, 29, 30, 41 |
| Fase 3 (concorrenza DB) | 27, 28 |
| Fase 4 (snapshot) | 31, 32, 33, 34 |
| Fase 7 (override e correzioni) | 35, 36, 37, 38, 39, 40 |

I test 36–38 sono definiti su `voidAssignment`: l'undo è stato eliminato dal progetto
(⚠ P1, vedi `docs/DECISIONS.md`).

---

## Fase 0 — Scaffold

- [x] **F0-01 — Rinomina file di progetto** ⚠ P18
  Rinomina `claude.md` → `CLAUDE.md` e `docs/plan.md` → `docs/PLAN.md` (il deploy Linux è case-sensitive).
  Verifica: i nomi canonici esistono su disco; i riferimenti incrociati nei due file restano validi.
  Dipende: — *(fatto in kickoff, 2026-08-06)*

- [x] **F0-02 — Scaffold Next.js 15**
  App Router, TypeScript strict, `output: 'standalone'`, pnpm.
  Verifica: `pnpm dev` serve una pagina senza errori né warning di build.
  Dipende: —

- [x] **F0-03 — Tailwind + shadcn/ui**
  Init shadcn con Tailwind e un componente di prova (Button) in una pagina.
  Verifica: il Button shadcn renderizza con gli stili corretti in `pnpm dev`.
  Dipende: F0-02

- [x] **F0-04 — Postgres in Docker**
  `docker-compose.yml` come da §15 (postgres:16-alpine, volume, porta 5432).
  Verifica: `docker compose up -d` e connessione psql al db `asta` riuscita.
  Dipende: —

- [x] **F0-05 — Drizzle + schema `users` + `db:push`**
  Setup drizzle-kit, tabella `users` (§3) con `google_sub UNIQUE`, script `pnpm db:push`.
  Verifica: `\d users` mostra tutte le colonne di §3; push idempotente.
  Dipende: F0-02, F0-04

- [x] **F0-06 — Auth.js v5 con Google** ⚠ P17
  Provider Google, session strategy JWT (nessuna tabella adapter), upsert utente su `google_sub` al login.
  Verifica: login Google su localhost crea la riga `users` al primo accesso e la riusa al secondo; lo stesso account loggato su due dispositivi vede gli stessi dati.
  Dipende: F0-05

- [x] **F0-07 — Onboarding `display_name` obbligatorio**
  Utente senza `display_name` viene rediretto a un form nome+cognome prima di qualsiasi altra pagina.
  Verifica: nuovo utente non raggiunge `/dashboard` finché non compila; dopo il salvataggio sì.
  Dipende: F0-06

- [x] **F0-08 — Credentials provider `dev`**
  Provider `dev` registrato solo con `NODE_ENV !== 'production'`; pagina signin in dev mostra "Entra come <utente seeded>".
  Verifica: un click su un utente seeded apre una sessione valida senza Google.
  Dipende: F0-06, F0-12

- [x] **F0-09 — Test: provider `dev` assente in produzione**
  Test automatico che con `NODE_ENV=production` la lista provider non contiene `dev` (§15).
  Verifica: test verde in `pnpm test`.
  Dipende: F0-08, F0-10

- [x] **F0-10 — Vitest con fake timers**
  Config Vitest, `vi.useFakeTimers()` nel setup condiviso, script `pnpm test`.
  Verifica: un test di esempio che avanza timer finti passa; nessun `sleep` reale.
  Dipende: F0-02

- [x] **F0-11 — Regola ESLint su `lib/db`**
  Import di `lib/db` vietato fuori da `lib/engine/**` (`no-restricted-imports` o eslint-plugin-boundaries).
  Verifica: file di prova che importa `lib/db` da `components/` fa fallire `pnpm lint`; da `lib/engine/` passa.
  Dipende: F0-02

- [x] **F0-12 — Seed base: 12 utenti**
  `pnpm db:seed` crea 12 utenti fittizi con nome e cognome; parsing del flag `--auction-status` presente (gli stati non ancora generabili falliscono con messaggio chiaro).
  Verifica: seed idempotente; 12 righe in `users`; `--auction-status=live` stampa "non ancora supportato".
  Dipende: F0-05

- [x] **F0-13 — Script `dev:lan`**
  `next dev -H 0.0.0.0` per test da telefono in LAN.
  Verifica: app raggiungibile da `http://<ip-lan>:3000` da un secondo dispositivo.
  Dipende: F0-02

- [x] **F0-14 — RUNBOOK: sviluppo locale**
  Sezione "come far girare l'app in locale" in `docs/RUNBOOK.md` (docker, push, seed, dev, login dev).
  Verifica: seguendo solo il runbook da checkout pulito si arriva a una sessione loggata.
  Dipende: F0-08

- [x] **F0-15 — ARCHITECTURE: prima stesura**
  `docs/ARCHITECTURE.md` in prosa: stack, perché un solo processo Node, com'è organizzata l'auth (incluso il provider dev).
  Verifica: il documento esiste, descrive tutto ciò che è stato costruito in Fase 0, niente elenchi di file.
  Dipende: F0-08

- [x] **F0-16 — GATE Fase 0**
  Verifica dei criteri ✅ del piano: login Google funzionante, `display_name` obbligatorio al primo accesso. Aggiorna la riga "Fase corrente" in `CLAUDE.md`.
  Verifica: entrambi i criteri dimostrati manualmente; `pnpm test` e `pnpm lint` verdi.
  Dipende: tutti i F0-*
  *Chiuso il 2026-08-07. `pnpm test`, `pnpm lint`, `pnpm typecheck` e `pnpm build` verdi; il
  cancello dell'onboarding dimostrato end-to-end col provider `dev` (utente senza `display_name`
  → `/` e `/dashboard` rimandano a `/onboarding`; scritto il nome, `/dashboard` si apre e
  `/onboarding` rimanda indietro). Il login con un account Google vero è stato verificato a mano
  dall'owner.*

---

## Fase 1 — Setup asta

- [x] **F1-01 — Schema Drizzle completo**
  Tutte le tabelle di §3 (auctions, members, invites, players, lots, lot_rounds, round_eligibility, bids, assignments, ledger, events) con indici unici parziali `one_open_lot_per_auction` e `one_owner_per_player`, indice auto-pick su players, colonna `include_out_of_list` su auctions ⚠ P7.
  Verifica: `db:push` ok; i due indici parziali risultano da `pg_indexes`; vincoli UNIQUE e CHECK di §3 presenti.
  Dipende: F0-16

- [x] **F1-02 — `createAuction` con validazioni**
  Server action: seats ∈ {8,10,12}, `role_order` permutazione completa di P,D,C,A (validazione del test §12.25), default di budget/timer/slot, `public_token` generato.
  Verifica: unit test — seats 9 rifiutato; `role_order ['P','P','C','A']` e `['P','D','C']` rifiutati; asta valida persistita con owner corretto.
  Dipende: F1-01

- [x] **F1-03 — Form di creazione asta**
  Segmented control 8/10/12 (mai input libero), budget, timer, slot per ruolo, ordine ruoli riordinabile con dnd-kit (lista di 4, default P→D→C→A).
  Verifica: da UI si crea un'asta con `role_order ['C','A','P','D']` e il valore risulta a DB.
  Dipende: F1-02

- [x] **F1-04 — `updateAuctionSettings`**
  Patch dei settaggi con matrice di modificabilità: campi strutturali (seats, slot, role_order, budget) solo in DRAFT/READY; timer sempre, applicati dal lotto successivo (§9).
  Verifica: unit test — modifica `role_order` in READY accettata, in LIVE rifiutata con errore tipizzato; modifica timer in LIVE accettata.
  Dipende: F1-02

- [x] **F1-05 — `parseListone`**
  Parser SheetJS del foglio `Lista calciatori` con il mapping colonne di §13 (`#`, Nome, Sq., R., R.MANTRA, FVM/1000, QUOT., Fuori lista; Under/PGv/MV/FM ignorate). Il file non viene conservato dopo l'import ⚠ P6.
  Verifica: unit test sulla fixture `fixtures/listone.xlsx` — 495 righe, P 61 / D 177 / C 172 / A 85; `out_of_list` valorizzato correttamente.
  Dipende: F0-16

- [x] **F1-06 — Validazione I9**
  Per ogni ruolo `disponibili ≥ slot_ruolo × seats`, contando il pool secondo `include_out_of_list`; errore esplicito con ruolo e conteggi.
  Verifica: unit test — listone artificialmente povero di attaccanti rifiutato con messaggio che nomina il ruolo A e i numeri.
  Dipende: F1-05

- [x] **F1-07 — `importPlayers` + UI upload**
  Action riservata all'owner, solo in DRAFT/READY; snapshot in `players` con `auction_id`; il reimport sostituisce lo snapshot precedente.
  Verifica: upload da UI popola `players`; secondo upload sostituisce senza duplicare `ext_id`; upload da non-owner rifiutato.
  Dipende: F1-05, F1-06

- [x] **F1-08 — Toggle `include_out_of_list`** ⚠ P7
  Toggle in setup che ridefinisce il pool; ogni cambio rivalida I9.
  Verifica: unit test — toggle che rende un ruolo insufficiente viene rifiutato; il pool disponibile cambia coerentemente.
  Dipende: F1-06, F1-07

- [x] **F1-09 — `createInvite` + pagina di join**
  Genera token con URL; la pagina del token mostra l'asta e il form nome squadra.
  Verifica: URL di invito aperto da un secondo utente loggato mostra il form; token inesistente → 404.
  Dipende: F1-02

- [x] **F1-10 — `joinAuction`** ⚠ P13
  Join con `team_name`; `seat_index` assegnato in ordine di join; `budget_initial` copiato da `budget_default` (uguale per tutti, mai per-membro — DECISIONS 2026-08-06); rispetto di UNIQUE(auction_id, user_id) e (auction_id, seat_index). L'owner joina come membro normale ⚠ P11.
  Verifica: due utenti che joinano ottengono seat 0 e 1; doppio join dello stesso utente rifiutato; join oltre `seats` rifiutato.
  Dipende: F1-09

- [x] **F1-11 — Scadenza inviti**
  Inviti rifiutati se `status ∉ {DRAFT, READY}` (§17); `expires_at`/`max_uses` opzionali e di default assenti — nessun limite (DECISIONS 2026-08-06) — ma rispettati se valorizzati.
  Verifica: unit test sui tre casi di rifiuto (status, scadenza, usi esauriti); `uses` incrementato a ogni join riuscito.
  Dipende: F1-10

- [x] **F1-12 — `leaveAuction` / `removeMember`** ⚠ P13
  Solo in DRAFT/READY; alla rimozione i `seat_index` vengono ricompattati senza buchi.
  Verifica: con membri a seat 0,1,2 la rimozione di seat 0 lascia seat 0,1; rimozione in LIVE rifiutata.
  Dipende: F1-10

- [x] **F1-13 — Transizione DRAFT ↔ READY** ⚠ P12
  Stato ricalcolato a ogni mutazione di setup: READY quando seats pieni + listone importato + I9 valida; regressione a DRAFT se una condizione decade (es. removeMember).
  Verifica: unit test — ultimo join con listone valido → READY; removeMember su asta READY → DRAFT.
  Dipende: F1-07, F1-10, F1-12

- [x] **F1-14 — Lobby**
  Pagina `/auctions/[id]/lobby` con elenco membri e nomi squadra (i pallini presence arrivano in Fase 5, quando esiste l'heartbeat).
  Verifica: due browser con utenti diversi vedono entrambi i nomi squadra dopo reload.
  Dipende: F1-10

- [x] **F1-15 — Dashboard**
  `/dashboard` con le aste di cui l'utente è owner o membro, stato e link a setup/lobby.
  Verifica: asta creata e asta joinata compaiono entrambe con lo stato corretto.
  Dipende: F1-02, F1-10

- [x] **F1-16 — Setup page**
  `/auctions/[id]/setup` (solo owner): settaggi, import listone, inviti, membri.
  Verifica: l'intero flusso creazione → import → invito → join si completa da UI; non-owner rediretto.
  Dipende: F1-03, F1-04, F1-07, F1-09, F1-12

- [x] **F1-17 — Seed: listone + asta READY**
  `db:seed --auction-status=draft|ready`: importa la fixture e crea un'asta a 8 con tutti i membri joinati e nome squadra.
  Verifica: `--auction-status=ready` produce un'asta READY che passa la validazione I9.
  Dipende: F1-05, F1-10, F1-13

- [x] **F1-18 — ARCHITECTURE: setup e inviti**
  Aggiorna `docs/ARCHITECTURE.md`: ciclo di vita DRAFT/READY, snapshot del listone, meccanica inviti.
  Verifica: il documento descrive tutto ciò che esiste a fine Fase 1.
  Dipende: F1-16

- [x] **F1-19 — GATE Fase 1** ⚠ P4
  Criteri ✅: due utenti entrano da link e vedono i reciproci nomi squadra; import insufficiente rifiutato con messaggio chiaro; `role_order` riordinato persiste ed è il primo della lista (la verifica "avviando, l'asta parte dal primo ruolo" è differita al gate di Fase 3, F3-16). Aggiorna `CLAUDE.md`.
  Verifica: i tre criteri dimostrati; `pnpm test` e `pnpm lint` verdi.
  Dipende: tutti i F1-*
  *Chiuso il 2026-08-07. `pnpm test` (67 test, di cui 32 di integrazione su Postgres), `pnpm lint`,
  `pnpm typecheck` e `pnpm build` verdi. I tre criteri ✅ sono stati dimostrati **end-to-end sulle
  pagine vere**, con due sessioni distinte del provider `dev` e i form inviati come li invierebbe
  un browser: (1) Marco Bianchi ed Elena Conti entrano nella stessa asta — uno dal pannello di
  setup, l'altra dal link d'invito — e in lobby ciascuno vede entrambi i nomi squadra; (2) l'import
  della fixture su un'asta a 12 con 8 slot da attaccante è rifiutato con «Attaccanti (A): servono
  96 giocatori (8 slot × 12 partecipanti), il listone ne ha 85» e nessuna riga scritta; (3) un'asta
  creata dal form con `role_order = ['C','A','P','D']` risulta a database con quell'ordine e lo
  mostra in lobby. Verificata anche la regola 6: un `seats = 9` iniettato nel campo nascosto viene
  respinto dal server. Il collaudo a due browser e il trascinamento dei ruoli col mouse sono stati
  confermati a mano dall'owner.*

---

## Fase 2 — Motore, funzioni pure, con test ⚠ FASE CRITICA - "Fase corrente"

Regola assoluta: nessun import da `lib/db`, nessuna rete, nessun `Date.now()`. Il tempo è
sempre un parametro. Test scritti PRIMA dell'implementazione (§12).

- [x] **F2-01 — Tipi puri del motore**
  `AuctionState`, `AuctionConfig`, `AuctionEvent` in memoria, speculari a §3 ma senza DB (membri, lotti, round, bids, assignments, ledger come strutture dati).
  Verifica: `tsc` compila; ESLint conferma zero import da `lib/db`.
  Dipende: F1-19

- [x] **F2-02 — `rules.credits`**
  `crediti(m) = budget_initial + Σ ledger.delta − Σ assignments.price (non voided)`.
  Verifica: unit test con rettifiche positive/negative e assignment voided ignorato.
  Dipende: F2-01

- [x] **F2-03 — `rules.maxBid`** ⚠ P2
  `max_bid = crediti − residui_altri`, con residui calcolati per ruolo clampati a ≥ 0 (robusto al `force` su I4) e comunque `max_bid ≤ crediti`.
  Verifica: test §12.16 (500 crediti, 0/25 → 476), §12.17 (crediti = residui → 1), più caso overflow da force: mai sopra i crediti.
  Dipende: F2-02

- [x] **F2-04 — `rules.eligibility`**
  Idonei = slot libero nel ruolo corrente ∧ `max_bid ≥ 1`.
  Verifica: test §12.19 (ruolo pieno → escluso).
  Dipende: F2-03

- [x] **F2-05 — `rules.autoPick`**
  Miglior disponibile del ruolo per `fvm DESC, quot DESC, ext_id ASC`, escludendo assegnati e (se configurato) out_of_list.
  Verifica: test §12.4 (pari fvm → quot, poi ext_id); pool filtrato correttamente.
  Dipende: F2-01

- [x] **F2-06 — `rules.resolveRound`**
  Dato un insieme di offerte non ritirate: max unico → vincitore; tie round 1 → pareggianti; tie round 2 → `MIN(amount_set_at)` poi `MIN(bid id)`.
  Verifica: test §12.1, §12.6, §12.11, §12.12.
  Dipende: F2-01

- [x] **F2-07 — `rules.nextSeat`**
  Prossimo seat in ordine crescente circolare con slot libero nel ruolo corrente; indipendente dal vincitore.
  Verifica: test §12.23 (skip ruolo pieno con wrap-around).
  Dipende: F2-04

- [x] **F2-08 — `rules.nextRole`** ⚠ P9
  Avanzamento lungo `role_order` che salta i ruoli già pieni per tutti (possibile dopo `manualAssign`); se nessun ruolo residuo → COMPLETED.
  Verifica: test §12.22, §12.24, più caso "ruolo intermedio già pieno" saltato.
  Dipende: F2-01

- [x] **F2-09 — `machine`: pick valido**
  `transition(state, {type:'PICK', playerId}, now)`: validazioni (membro di turno, ruolo corrente, non assegnato, non fuori lista) → crea lotto OPEN + round 1 + eligibility + auto-bid a 1 del chiamante con `amount_set_at = now`.
  Verifica: unit test — pick di non-di-turno, ruolo sbagliato, giocatore assegnato, fuori lista: tutti rifiutati con errore tipizzato; pick valido produce lo stato atteso.
  Dipende: F2-04, F2-05

- [x] **F2-10 — `machine`: timeout pick → auto-pick**
  Scadenza WAITING_PICK → auto-pick (`auto_called = true`) + auto-bid a 1 del chiamante.
  Verifica: test §12.3.
  Dipende: F2-09

- [x] **F2-11 — `machine`: `placeBid`** ⚠ P3
  Upsert: nuovo importo → aggiorna `amount` e `amount_set_at = now`; stesso importo → no-op (timestamp preservato); validazioni `min_amount ≤ amount ≤ max_bid`, idoneità, `now ≤ ends_at`.
  Verifica: test §12.5, §12.14, §12.18, §12.30; nuovo test: ri-submit dello stesso importo non tocca `amount_set_at`.
  Dipende: F2-03, F2-04

- [x] **F2-12 — `machine`: `withdrawBid`** ⚠ P10
  Ritiro vietato al chiamante e nel round 2; **irreversibile**: dopo il ritiro il membro non può più offrire su quel lotto.
  Verifica: test §12.7, §12.8; nuovo test: withdraw → placeBid successivo rifiutato con errore tipizzato.
  Dipende: F2-11

- [x] **F2-13 — `machine`: chiusura round 1**
  Timeout LOT_OPEN round 1 → max unico → LOT_REVEAL; pareggio → LOT_TIE_PREP con deadline `tie_prep_seconds`.
  Verifica: test §12.1, §12.2, §12.9.
  Dipende: F2-06, F2-11

- [x] **F2-14 — `machine`: TIE_PREP → round 2 con carry-forward**
  Round 2 con `min_amount` = importo pareggiato, eligibility = soli pareggianti, offerte copiate preservando `amount_set_at` originale.
  Verifica: test §12.9, §12.13, §12.15; il carry-forward conserva i timestamp del round 1.
  Dipende: F2-13

- [x] **F2-15 — `machine`: risoluzione round 2**
  Rilancio unico → vince; stallo → carry-forward più vecchio; rilanci pari → primo submit del round 2.
  Verifica: test §12.6, §12.10, §12.11, §12.12.
  Dipende: F2-14

- [x] **F2-16 — `machine`: REVEAL e avanzamento**
  Assegnazione committata all'INGRESSO di LOT_REVEAL; alla scadenza: nextSeat/nextRole o COMPLETED.
  Verifica: test §12.21, §12.22, §12.24; l'assignment esiste già durante la fase REVEAL.
  Dipende: F2-07, F2-08, F2-13, F2-15

- [x] **F2-17 — `machine`: pause/resume**
  Pause congela (`paused_at`); resume trasla `phase_deadline` del tempo di pausa.
  Verifica: test §12.29 (pausa a metà round + resume dopo 5' → residuo intatto).
  Dipende: F2-09

- [x] **F2-18 — `machine`: idempotenza e caso unico idoneo**
  `ADVANCE` su fase già avanzata o deadline non raggiunta = no-op (I7); se alla creazione del lotto l'unico idoneo è il chiamante → transizione immediata a LOT_REVEAL, assegnato a 1, senza attendere `bid_seconds` (DECISIONS 2026-08-06).
  Verifica: test §12.26, §12.41 (chiusura immediata, prezzo 1, nessun countdown di offerta).
  Dipende: F2-16

- [x] **F2-19 — Suite §12 pura completa**
  Test §12: 1–26, 29, 30, 41 tutti verdi da CLI in millisecondi; zero DB, zero UI, zero timer reali. ⚠ P5 per la ripartizione.
  Verifica: `pnpm test` verde; grep conferma nessun `Date.now()` in `rules.ts`/`machine.ts`.
  Dipende: F2-02 … F2-18

- [x] **F2-20 — ARCHITECTURE: il motore**
  Capitolo sul motore: perché funzioni pure, come si legge `transition`, la regola del tempo come parametro.
  Verifica: il capitolo esiste e spiega il flusso WAITING_PICK → … → REVEAL in prosa.
  Dipende: F2-19

- [x] **F2-21 — GATE Fase 2**
  Criteri ✅: tutti i test della parte pura di §12 verdi; zero righe di UI dell'asta scritte. Aggiorna `CLAUDE.md`.
  Verifica: `pnpm test` verde; `git diff --stat` della fase non tocca `app/auctions/**/play|manage` né `components/auction`.
  Dipende: tutti i F2-*
  *Chiuso il 2026-08-07. Il motore è in `lib/engine/types.ts` (stato ed eventi), `rules.ts`
  (crediti, max_bid, idoneità, auto-pick, risoluzione round, rotazione) e `machine.ts`
  (`transition(state, event, now)`). Suite tutta scritta PRIMA dell'implementazione (rosso→verde
  documentato dai run): 79 test puri nuovi in `tests/engine/`, che coprono §12 1–26, 29, 30, 41
  (il 25 era già verde dalla Fase 1). `pnpm test` 146/146, `pnpm lint`, `pnpm typecheck` e
  `pnpm build` verdi; `grep` conferma zero `Date.now()`/`new Date` in `rules.ts` e `machine.ts`;
  il diff della fase tocca solo `lib/engine/**`, `tests/engine/**` e i documenti — nessuna riga
  di UI. Scelte nuove (tempo in epoch-ms, id da contatore, no-op per riferimento, rifiuti in
  PAUSED, START nel motore) registrate in `DECISIONS.md` sotto "Fase 2, motore puro".*

---

## Fase 3 — Persistenza e timer

- [x] **F3-01 — Load/persist dello stato**
  Caricamento di `AuctionState` dalle righe DB e persistenza del nuovo stato dopo `transition`, dentro la transazione.
  Verifica: test integrazione — roundtrip load→transition→persist→load produce stati equivalenti su un'asta seeded.
  Dipende: F2-21

- [x] **F3-02 — `withAuctionLock`** ⚠ P14
  Come da §6: transazione + `SELECT ... FOR UPDATE`, incremento `state_version` e broadcast (hook no-op per ora) solo se la mutazione ha effetto; no-op → nessun bump.
  Verifica: test integrazione — due transazioni concorrenti serializzate; una `advancePhase` no-op non incrementa `state_version`.
  Dipende: F3-01

- [x] **F3-03 — Errori tipizzati**
  Enum di codici errore per ogni rifiuto (§17); ogni action li restituisce, mai stringhe generiche.
  Verifica: unit test su almeno pick non di turno e bid oltre max_bid: codice atteso.
  Dipende: F3-01

- [x] **F3-04 — `startAuction`**
  READY → LIVE con `startSeatIndex`; `current_role = role_order[0]`; il gate presence "tutti LIVE" è aggiunto in F4-06 quando esiste l'heartbeat ⚠ P5.
  Verifica: script su asta READY seeded → LIVE, `phase = WAITING_PICK`, deadline valorizzata.
  Dipende: F3-02

- [x] **F3-05 — Actions di gioco su DB**
  `pickPlayer`, `placeBid`, `withdrawBid` che caricano stato, chiamano il motore puro e persistono, tutto dentro `withAuctionLock`.
  Verifica: sequenza scriptata pick→bid×N→withdraw produce le righe attese in lots/lot_rounds/bids.
  Dipende: F3-02, F3-03

- [x] **F3-06 — `advancePhase` guardata**
  Rilegge `phase` e `phase_deadline` nella transazione; no-op se `now < deadline` o fase già cambiata (I7).
  Verifica: test §12.26 a livello DB — doppia chiamata sullo stesso deadline, un solo effetto.
  Dipende: F3-02

- [x] **F3-07 — `pauseAuction` / `resumeAuction`**
  Pause cancella i timer in memoria; resume trasla la deadline e riarma.
  Verifica: test integrazione §12.29 — resume dopo pausa lunga → countdown dal residuo, il round non risulta scaduto.
  Dipende: F3-05, F3-08

- [x] **F3-08 — Scheduler**
  `arm`/`cancel`/`sweep` (1s, `status='LIVE' AND phase_deadline <= now()`)/`bootRecovery`; init in `instrumentation.ts` con `globalThis.__scheduler ??=`.
  Verifica: test con fake timers su arm/sweep; doppia esecuzione di `register()` → un solo interval attivo.
  Dipende: F3-06

- [x] **F3-09 — `events` + log strutturato**
  Ogni transizione scrive una riga in `events` e una riga JSON su stdout `{auctionId, from, to, lotId, actor, ts}` (§17).
  Verifica: un lotto completo produce la sequenza di eventi attesa, leggibile con la query del runbook.
  Dipende: F3-05

- [x] **F3-10 — Test di concorrenza**
  §12.27 (due `pickPlayer` concorrenti → uno passa) e §12.28 (bid stesso millisecondo → nessun doppio assegnamento), su Postgres reale.
  Verifica: entrambi verdi e stabili su 20 run consecutivi.
  Dipende: F3-05, F3-06

- [x] **F3-11 — Script driver d'asta**
  Script (`pnpm drive --auction=<id>`) che via HTTP/action gioca un'asta completa: pick, bid casuali validi, gestione spareggi.
  Verifica: ✅ criterio di fase — un'asta parte READY e arriva a COMPLETED senza UI e senza interventi.
  Dipende: F3-04, F3-05, F3-08

- [x] **F3-12 — Timer di sviluppo accelerati** ⚠ P16
  Timer corti nel seed dev (bid 3s, pick 3s, reveal 2s); `DEV_TIME_SCALE` eliminata (DECISIONS 2026-08-06): nessun ramo dipendente dall'ambiente nella logica del tempo.
  Verifica: l'asta del driver F3-11 si completa in pochi minuti in locale.
  Dipende: F3-11

- [x] **F3-13 — Seed stati avanzati**
  `--auction-status=live|mid|completed` generati facendo girare il motore (non con INSERT artigianali).
  Verifica: `mid` produce un'asta LIVE con rose parziali dove i crediti rispettano la formula di §3 per ogni membro.
  Dipende: F3-11

- [x] **F3-14 — Boot recovery sotto restart** ⚠ P15
  Kill del processo a metà round → al riavvio `bootRecovery` riarma o avanza entro 1 secondo. Documentare in RUNBOOK: se il downtime supera il residuo, lo sweep chiude il round con le offerte già a DB; la correzione passa da `voidAssignment` + `manualAssign` (Fase 7).
  Verifica: ✅ criterio di fase — restart a metà round, l'asta prosegue correttamente entro 1s.
  Dipende: F3-08, F3-11

- [x] **F3-15 — ARCHITECTURE: persistenza e tempo**
  Capitolo su `withAuctionLock`, scheduler, sweep come rete di sicurezza, boot recovery.
  Verifica: capitolo presente e coerente con il codice.
  Dipende: F3-14

- [x] **F3-16 — GATE Fase 3**
  Criteri ✅ del piano più la verifica differita da F1-19: con `role_order = ['C','A','P','D']` l'asta parte da C e percorre l'ordine scelto (test §12.21 end-to-end). Aggiorna `CLAUDE.md`.
  Verifica: asta completa via script; restart test verde; ordine ruoli end-to-end dimostrato.
  Dipende: tutti i F3-*
  *Chiuso il 2026-08-07. `pnpm test` 183/183 (di cui ~40 di integrazione su Postgres, con i due
  test di concorrenza §12.27–28 stabili su 20 run consecutivi), `pnpm lint`, `pnpm typecheck` e
  `pnpm build` verdi. Criteri ✅ dimostrati: (1) l'asta del seed (8 posti, 200 lotti, timer 3s)
  portata da READY a COMPLETED da `pnpm drive` senza UI né interventi in 20,9 minuti — "pochi
  minuti" del piano è in realtà il minimo fisico dei timer (200 × ~5s); per iterare in fretta
  si usa un'asta con slot ridotti (32 lotti ≈ 2 minuti); rose finali 25/25 e crediti coerenti
  con la formula di §3 per tutti gli 8 membri. (2) Kill -9 del processo a metà round: l'asta
  resta congelata (28s oltre la deadline, `state_version` immobile) e al riavvio il primo
  avanzamento arriva **0,37s** dopo il lancio del processo (boot recovery + sweep). (3) Ordine
  ruoli: un'asta con `role_order = ['C','A','P','D']` percorre i lotti 1–8 su C, 9–16 su A,
  17–24 su P, 25–32 su D. Il collaudo visivo delle due demo spetta all'owner (guida nel
  RUNBOOK).*

---

## Fase 4 — SSE e snapshot

- [x] **F4-01 — `serializeSnapshot`**
  Unica funzione di serializzazione (§8): per-viewer (`viewerMemberId | null`), durante LOT_OPEN solo `hasBid` booleani, `myBid` solo del richiedente, `reveal` solo in LOT_REVEAL.
  Verifica: test §12.31 (myBid valorizzato per chi ha offerto) e §12.32 (non idoneo → myBid null, fuori da eligibleMemberIds). ✓ `tests/db/snapshot.test.ts`
  Fatto: `lib/engine/snapshot.ts` (funzione + `loadForSnapshot`), tipi in `lib/realtime/types.ts` (importabili dal client, come `lib/domain.ts`). Prende il bundle di `loadAuctionState`, non il solo stato: servono `refs` (verso il client escono uuid, non gli id del motore) e i nomi. Aggiunti `withdrawn`/`withdrawnAt` e `currentLot.tie` — vedi DECISIONS.
  Dipende: F3-16

- [x] **F4-02 — `stateVersion` nello snapshot**
  Version inclusa; il client scarterà versioni inferiori.
  Verifica: test §12.34 — due snapshot consecutivi dopo due mutazioni hanno version strettamente crescente. ✓ (con il caso P14: un ADVANCE anticipato non bumpa)
  Dipende: F4-01

- [x] **F4-03 — `broadcast.ts`**
  Registry `Map<auctionId, Set<controller>>`; a ogni mutazione invia a ogni connessione lo snapshot serializzato per il SUO viewer.
  Verifica: test — due connessioni con member diversi ricevono `myBid` diversi dallo stesso broadcast. ✓ `tests/db/broadcast.test.ts`
  Fatto: `lib/realtime/broadcast.ts`; l'hook di `mutate.ts` è agganciato in `instrumentation.ts`. **Registro e hook su `globalThis`**: Next compila instrumentation e route handler in bundle separati, e con variabili di modulo lo stream restava muto dopo il primo snapshot (DECISIONS).
  Dipende: F4-01

- [x] **F4-04 — Route SSE**
  `GET /api/auctions/:id/stream` (runtime nodejs): snapshot immediato alla connessione, keep-alive `: ping` ogni 15s, cleanup del controller alla chiusura.
  Verifica: `curl -N` riceve subito uno snapshot, i ping ogni 15s, e la mappa si svuota alla disconnessione. ✓ verificato con `curl` e con test automatici sulla route vera (`tests/db/i8.test.ts`: header SSE, registro svuotato alla chiusura, 401/403 per estranei e token sbagliato).
  Fatto: accesso via sessione (membro → viewer; owner non giocante → manager) o `?token=<public_token>` per la vista TV; `resolveViewer` in `lib/engine/viewer.ts`.
  Dipende: F4-03

- [x] **F4-05 — Heartbeat e presence** ⚠ P8
  `POST /api/auctions/:id/heartbeat` ogni 10s con `{visible}`; aggiorna `last_seen_at`/`is_visible` FUORI da `withAuctionLock` (non è stato-macchina), senza bump di `state_version`; presence derivata LIVE/IDLE/OFFLINE; broadcast dei soli cambi di presence, coalescato.
  Verifica: unit test sulla derivazione (soglie 15s, visible); un heartbeat non incrementa `state_version` né genera uno snapshot per invocazione. ✓ `tests/db/presence.test.ts`
  Fatto: `lib/engine/presence.ts`; il confronto è con l'**ultima mappa annunciata**, così il primo heartbeat che arriva dopo la scadenza di un altro si accorge di chi è sparito. Coalescing a 1s in `broadcast.ts`.
  Dipende: F4-03

- [x] **F4-06 — Gate presence su `startAuction`** ⚠ P11
  READY → LIVE richiede tutti i **membri** in presence LIVE (§7); l'owner conta solo se ha joinato.
  Verifica: test — start con un membro OFFLINE rifiutato con errore tipizzato; con tutti LIVE passa. ✓ (più il caso IDLE, che non basta)
  Fatto: codice `MEMBERS_NOT_READY`, messaggio che nomina chi manca. `makeGameAuction` e `pnpm drive` battono gli heartbeat dei membri che impersonano: nessuna scorciatoia per saltare il cancello.
  Dipende: F4-05, F3-04

- [x] **F4-07 — Hook `useAuctionStream`**
  EventSource con riconnessione, calcolo `offset = serverNow − Date.now()`, scarto snapshot con version inferiore, cleanup corretto sotto StrictMode.
  Verifica: in dev con StrictMode una sola connessione resta viva; il countdown usa l'offset (test unit sul calcolo). ✓ `tests/use-auction-stream.test.ts` (offset, tempo residuo, scarto delle versioni)
  Fatto: `lib/realtime/use-auction-stream.ts`, con anche `useHeartbeat` (il lato client di F4-05, indipendente dallo stream). La verifica StrictMode è visiva e arriva in Fase 5, quando esisterà una pagina che monta l'hook.
  Dipende: F4-02, F4-04

- [x] **F4-08 — Test I8 automatico**
  Durante LOT_OPEN, il JSON ricevuto da: un partecipante, l'owner/manager e la vista TV non contiene NESSUN importo di offerte altrui.
  Verifica: ✅ criterio di fase — test automatico sui tre viewer verde. ✓ `tests/db/i8.test.ts`: apre davvero la route SSE e legge il primo messaggio per i tre spettatori; più il caso complementare (in LOT_REVEAL gli importi ci sono).
  Dipende: F4-01, F4-04

- [x] **F4-09 — Test snapshot post-timeout**
  §12.33 — snapshot richiesto dopo la scadenza del pick: la fase è già LOT_OPEN con l'auto-pick, mai WAITING_PICK stantio.
  Verifica: test verde. ✓ passa dallo sweep vero dello scheduler, non da una chiamata diretta ad `advancePhase`.
  Dipende: F4-01, F3-08

- [x] **F4-10 — Bot partecipanti** ⚠ P5
  `pnpm bots --auction=<id> --count=N --strategy=random|aggressive|passive|tie`: client headless con auth dev, SSE, reazione agli snapshot, rispetto di `min_amount` negli spareggi.
  Verifica: 7 bot + driver completano un'asta; `--strategy=tie` innesca almeno un round 2 osservabile in `events`. ✓ 8 bot hanno portato a COMPLETED un'asta da 200 lotti contro `pnpm dev` in 21,8 minuti: 1498 azioni riuscite, 0 rifiutate, 0 auto-pick, 24 spareggi anche con `--strategy=random`. Con `--strategy=tie` la transizione `LOT_OPEN → LOT_TIE_PREP` compare in `events` su ogni lotto.
  Fatto: i bot agiscono via HTTP su `POST /api/auctions/:id/action` (nuova route, vedi DECISIONS) e non toccano il motore nel proprio processo — solo così il browser aperto accanto vede muoversi l'asta. Non serve più il driver: `--start` avvia l'asta come farebbe l'owner, e lo scheduler è quello dell'app.
  Dipende: F4-04, F4-07, F3-11

- [x] **F4-11 — ARCHITECTURE: realtime**
  Capitolo su snapshot-only, sanificazione per costruzione, clock offset, presence.
  Verifica: capitolo presente. ✓ "Il canale verso i client"
  Dipende: F4-08

- [x] **F4-12 — GATE Fase 4**
  Criterio ✅ del piano (test I8 sui tre viewer) più suite §12.31–34 verde. Aggiorna `CLAUDE.md`.
  Verifica: `pnpm test` verde; bot funzionanti. ✓ 220 test verdi in 19 file; asta completa coi bot. Misurato a fine asta: uno snapshot costa 20 ms di lettura, 1 ms di serializzazione, 23 KB per viewer.
  Dipende: tutti i F4-*

- [x] **F4-13 — Bug di Fase 3: l'app non partiva** (fuori piano)
  Ogni pagina rispondeva 500 (`Can't resolve 'fs'` da `pg`): gli import dinamici di `instrumentation.ts` erano dopo una guardia con `return` anticipato, non eliminabile come ramo morto, e finivano nel bundle edge.
  Verifica: `pnpm dev` risponde 200; nessun "Module not found" nel log. ✓
  Fatto: import dentro `if (process.env.NEXT_RUNTIME === "nodejs") { … }` e `serverExternalPackages: ["pg"]` in `next.config.ts`. Non era emerso in Fase 3 perché i suoi criteri si verificano da terminale.

---

## Fase 5 — Portale partecipante (mobile-first)

- [x] **F5-01 — Layout `/auctions/[id]/play`**
  Struttura mobile-first: rosa, crediti, `max_bid`, ruolo corrente, chi è di turno. Tutto derivato dallo snapshot (I10).
  Verifica: la pagina renderizza ogni stato del seed (`ready|live|mid`) correttamente al primo load, senza eventi ricevuti. ✓ provata su asta READY e su asta LIVE in tutte le fasi con un browser headless mobile (390×844).
  Fatto: `app/auctions/[id]/play/page.tsx` (server: solo autorizzazione + listone) e `portal.tsx` (client: tutto dallo snapshot). Intestazione fissa con crediti e `max_bid` — il numero che decide ogni offerta non deve mai richiedere uno scroll. Le derivazioni pure stanno in `lib/realtime/portal.ts`, collaudabili in ambiente `node`.
  Dipende: F4-12

- [x] **F5-02 — Banner globale "Asta in corso"**
  Su tutte le pagine (dashboard inclusa) se l'utente è membro di un'asta LIVE/PAUSED; porta a `/play`.
  Verifica: con asta LIVE il banner compare in dashboard e naviga correttamente; senza aste live non compare. ✓ presente in `/dashboard` e `/lobby`, assente nell'HTML del portale stesso (il filtro su `usePathname` vale già in SSR).
  Fatto: `components/auction/live-banner.tsx`, montato in `app/layout.tsx`. Nel layout radice, non nelle singole pagine: «tutte le pagine» significa tutte. Aggiunto anche `viewport.interactiveWidget = "resizes-content"`, senza cui su Android la tastiera copre il modale invece di rimpicciolire la pagina.

- [x] **F5-03 — Componente Countdown**
  Rendering con clock offset; a zero mostra "in chiusura…" e NON cambia mai stato (regola 1).
  Verifica: unit test con offset simulato; a deadline superata mostra "in chiusura…" finché non arriva lo snapshot. ✓ `tests/portal.test.ts` (arrotondamento per eccesso, "in chiusura…" a zero, formato m:ss oltre il minuto).
  Fatto: `components/auction/countdown.tsx` (`Countdown` + `CountdownBar`), tick a 250ms perché a un tick al secondo il numero "salta" da 3 a 1. In pausa il residuo si congela con `pausedRemaining(deadline, pausedAt)`: la scadenza a database viene traslata solo al resume, quindi un countdown ingenuo scorrerebbe verso zero ad asta ferma.
  Dipende: F4-07

- [x] **F5-04 — Card permanente del lotto**
  Visibile finché `currentLot != null`: giocatore, ruolo, squadra, countdown, propria offerta, buste altrui (booleano), pulsante "Apri offerta".
  Verifica: chiuso il modale, la card resta e riapre il modale; la card mostra l'offerta salvata. ✓ verificato in browser: dopo "Chiudi" zero modali aperti, il pulsante della card lo riapre e il campo contiene ancora la cifra salvata.
  Fatto: `components/auction/lot-card.tsx`. Attraversa LOT_OPEN, LOT_TIE_PREP e LOT_REVEAL senza cambiare identità. Delle buste altrui mostra un pallino booleano e la frase «gli importi si vedono solo all'apertura delle buste» (I8).
  Dipende: F5-01, F5-03

- [x] **F5-05 — Modale d'offerta**
  Auto-apertura su `LOT_OPEN && idoneo && dismissedLotId !== currentLot.id`; `dismissedLotId` solo nello state del componente.
  Verifica: chiudo il modale → non si riapre per lo stesso lotto; al lotto successivo si riapre da solo. ✓ `tests/portal.test.ts` sui quattro casi di `shouldOpenBidDialog`, più la prova in browser.
  Fatto: `components/auction/bid-modal.tsx`, sheet dal basso (radix `Dialog`, nessun wrapper generico: regola 8). `dismissedLotId` è **l'unico** stato locale del portale. Non prende il focus all'apertura: la tastiera coprirebbe card e countdown nell'istante in cui il modale compare da sé.
  Dipende: F5-04

- [x] **F5-06 — Input e submit dell'offerta**
  `inputMode="numeric"`, conferma nella metà inferiore ≥ 44px, feedback di salvataggio immediato e inequivocabile, countdown e max_bid visibili anche con tastiera aperta.
  Verifica: su viewport mobile con tastiera virtuale, countdown e max_bid restano visibili; il feedback di conferma appare < 500ms. ✓ countdown e `max` sono nell'intestazione dello sheet, subito sopra il campo; il `✓ Offerta salvata: 9` arriva dalla risposta della fetch (misurato < 350ms in locale).
  Fatto: `type="text"` + `inputMode="numeric"` (mai spinner) a `text-2xl`, perché sotto i 16px iOS zooma da solo; conferma alta 56px, tasti rapidi −1/+1/+5/+10/+25/max da 44–48px. Il feedback ha una riga fissa che non sposta il pulsante quando compare.
  Dipende: F5-05

- [x] **F5-07 — Override e ritiro da UI**
  Rilancio (override) sempre; ritiro nascosto per il chiamante e nel round 2, e comunicato come definitivo ⚠ P10; ri-submit dello stesso importo comunicato come "sei già a X" ⚠ P3.
  Verifica: gli stati del pulsante ritiro corrispondono a snapshot chiamante/round1/round2; dopo il ritiro la UI non offre più il submit. ✓ `tests/portal.test.ts` sui cinque casi di `canWithdraw`, più il ritiro eseguito in browser con la doppia conferma.
  Fatto: il ritiro chiede conferma («Ritiro definitivo?») perché non si torna indietro; dopo il ritiro card e modale dicono perché non si può più offrire. La riconferma della stessa cifra passa comunque dal server (è un no-op lì) e la UI la annuncia come «sei già a X: nulla è cambiato».
  Dipende: F5-06

- [x] **F5-08 — Vista TIE_PREP**
  Countdown di preparazione con indicazione chiara "sei/non sei tra i pareggianti".
  Verifica: con `--strategy=tie` i due pareggianti e un terzo vedono messaggi coerenti. ✓ spareggio innescato con i bot `tie`: chi ha pareggiato legge «sei nello spareggio… la tua offerta resta a X se non fai niente», chi è fuori legge «pareggio a X fra altri: tu sei fuori».
  Fatto: `TiePanel` in `components/auction/reveal-panel.tsx`, dentro la card. L'importo pareggiato viene da `currentLot.tie`, popolato solo in LOT_TIE_PREP.
  Dipende: F5-04

- [x] **F5-09 — Pannello reveal**
  Tutte le offerte di tutti i round, vincitore e prezzo, per la durata di `reveal_seconds`.
  Verifica: dopo un lotto con spareggio, il pannello mostra round 1 e round 2 con importi e timestamp relativi. ✓ verificato su un lotto risolto allo spareggio: le due sezioni ("Buste" e "Spareggio") con gli importi e il `+Ns` dalla prima offerta del round.
  Fatto: `RevealPanel`. Le offerte ritirate restano in elenco, barrate: chi si tira indietro non sparisce dalla storia. Il `+Ns` non è cosmetico — a parità di importo nello spareggio vince `MIN(amount_set_at)`, e senza quel numero un esito contestato non è leggibile.
  Dipende: F5-04

- [x] **F5-10 — Vista WAITING_PICK (proprio turno)**
  Lista/ricerca dei giocatori disponibili del ruolo corrente, ordinabile per fvm, con countdown del pick.
  Verifica: la lista esclude assegnati e fuori-lista; pick da UI apre il lotto. ✓ `tests/portal.test.ts` su `availablePlayers`; in browser la chiamata dalla lista ha aperto il lotto sul giocatore scelto.
  Fatto: `components/auction/pick-panel.tsx`. Il listone arriva dal server una volta sola (`listPickPool`, esclude i fuori lista se l'asta li esclude) e **non viaggia nello snapshot**; chi è libero si deduce dalle rose dello snapshot, quindi I10 resta vera. Ordine `fvm DESC, quot DESC`, lo stesso dell'auto-pick: il primo della lista è quello che il timer sceglierebbe al posto tuo.
  Dipende: F5-01, F5-03

- [x] **F5-11 — Vista PAUSED**
  Schermata di attesa con stato congelato.
  Verifica: su pause dal manager (o via action) tutti i client mostrano l'attesa; su resume riprendono. ✓ PAUSE e RESUME via `POST …/action`: banner di pausa, countdown congelato al residuo del momento della pausa, nessun modale aperto, ripresa corretta.
  Fatto: non è una schermata a parte — la fase resta quella che era (la pausa la congela, non la azzera) e le azioni sono disabilitate. PAUSE/RESUME aggiunte al dispatcher della route delle azioni: il loro posto vero è il portale manager (Fase 6), ma senza di esse questa vista sarebbe codice che nessuno ha mai visto funzionare.
  Dipende: F5-01

- [x] **F5-12 — Presence in lobby**
  Pallini LIVE/IDLE/OFFLINE per membro nella lobby (§7).
  Verifica: tab in background → IDLE entro 15s; tab chiuso → OFFLINE entro 15s. ✓ misurato con due browser: IDLE in 1,5s (l'evento `visibilitychange` fa partire subito un heartbeat), OFFLINE in ~18s — la soglia è 15s, ma chi è sparito viene notato dal primo heartbeat **altrui** che arriva dopo (DECISIONS, Fase 4), quindi il ritardo osservabile è 15s + cadenza dell'heartbeat.
  Fatto: `components/auction/presence-dot.tsx` (con etichetta testuale: il colore da solo non è un canale informativo) e `app/auctions/[id]/lobby/lobby-live.tsx`. La lobby è anche il posto **da cui batte l'heartbeat** prima dell'avvio: senza una pagina che lo faccia, il cancello presence di `startAuction` sarebbe impossibile da passare. All'avvio dell'asta il membro viene portato su `/play`.
  Dipende: F4-05, F1-14

- [x] **F5-13 — Checklist di rientro §8bis**
  Verifica sistematica dei 5 casi: rientro in LOT_OPEN (offerta precompilata), TIE_PREP, LOT_REVEAL (tempo residuo), WAITING_PICK scaduto (mai schermata fantasma), PAUSED.
  Verifica: ognuno dei 5 casi riprodotto con kill del tab e rientro: schermata identica a un client mai disconnesso. ✓ i cinque casi sono **test automatici** in `tests/portal.test.ts` (costruiscono lo snapshot di quell'istante e chiedono a `portalScreen` cosa mostrerebbe); il caso LOT_OPEN è stato riprodotto anche con un reload vero a metà round — modale riaperto da sé, campo a 9, countdown a 12s dei 14.
  Fatto: la checklist a mano resta compito dell'owner al gate (4 browser, telefono), ma la logica non è più collaudata solo a mano.
  Dipende: F5-04 … F5-11

- [x] **F5-14 — Prova su telefono reale**
  Portale partecipante provato su un telefono fisico via `dev:lan` dentro un'asta con bot (§15).
  Verifica: un'asta giocata dal telefono senza zoom forzato, con tastierino numerico nativo. ✓ **eseguita dall'owner il 2026-08-08**: telefono vero + un browser sul Mac come partecipanti, sei bot sugli altri posti, tutti sull'IP di LAN.
  Fatto: le contromisure hanno retto — campi a 16px (iOS non zooma), `interactiveWidget: "resizes-content"` (la tastiera non copre il modale), target da 44px, `env(safe-area-inset-*)` su header e sheet.
  Dipende: F5-13, F0-13, F4-10

- [x] **F5-15 — ARCHITECTURE: il portale**
  Capitolo su gerarchia banner/card/modale e sul perché la UI è funzione dello snapshot.
  Verifica: capitolo presente. ✓ "Il portale del partecipante", più "Cosa non c'è ancora" riscritto sulla Fase 6.
  Dipende: F5-13

- [x] **F5-16 — GATE Fase 5**
  I 4 criteri ✅ del piano: asta a 4 browser reali senza desync; modale chiuso/riaperto con offerta intatta; kill del tab a metà round e rientro identico; offline al proprio turno → rientro sul lotto auto-pick senza schermata fantasma. Aggiorna `CLAUDE.md`.
  Verifica: ✓ i quattro scenari eseguiti. Criteri 2, 3 e 4 provati sia in automatico (browser headless + funzioni pure) sia a mano dall'owner. **Il criterio 1 è stato soddisfatto con due dispositivi invece di quattro browser** — un telefono e un browser sul Mac, con sei bot a riempire i posti: nessun disallineamento di countdown, vincitori e crediti. Vedi `docs/DECISIONS.md` per il perché la sostituzione è più severa, non più blanda.
  Dipende: tutti i F5-*

- [x] **F5-17 — Bug: il font non veniva applicato** (fuori piano)
  Tutta l'app rendeva col serif di default del browser invece di Geist. Due difetti sommati: in `app/globals.css` il tema dichiarava `--font-sans: var(--font-sans)`, autoreferenziale — e con `@theme inline` il valore viene **inlineato**, quindi `font-family` risolveva una variabile che nessuno definisce e diventava invalida; e le variabili di `next/font` stavano sulla `className` del `<body>`, mentre `font-sans` è applicato a `<html>` (una custom property non risale dal figlio al padre).
  Verifica: `getComputedStyle(document.documentElement).fontFamily` vale `Geist, "Geist Fallback"` su `<html>`, `<body>` e sui titoli, e il file del font risulta `loaded`. ✓
  Fatto: `--font-sans`/`--font-heading` puntano a `var(--font-geist-sans)` (com'era già per il mono, che infatti funzionava) e le classi dei font sono passate su `<html>`. Trovato guardando gli screenshot del collaudo: la mappatura era sbagliata dalla Fase 0, ma prima della Fase 5 nessuno aveva guardato una pagina con attenzione tipografica.

---

## Fase 6 — Portale manager e vista TV

- [x] **F6-01 — Recap rose e budget**
  `/auctions/[id]/manage` (solo owner, desktop): tutte le rose, crediti, max_bid, slot per ruolo.
  Verifica: i numeri coincidono con la formula crediti su un'asta `mid` seeded. ✓ sugli otto posti di un'asta `mid`: `crediti + speso = 500` per tutti e `max_bid = min(crediti, crediti − (slot residui − 1))` esatto, letti dallo stesso snapshot che riceve il manager. La route risponde 200 all'owner e **404 a un partecipante** (chi non ha creato l'asta non ha una regia).
  Fatto: `app/auctions/[id]/manage/page.tsx` (server: solo autorizzazione + `public_token` + "l'owner gioca?") e `console.tsx` (client: tutto dallo snapshot, `viewerMemberId = null` → nessun importo nemmeno per il manager). Le derivazioni pure stanno in `lib/realtime/manage.ts` con i loro test. La pagina batte l'heartbeat **se l'owner è anche membro**: senza, sarebbe lui stesso a bloccare il proprio cancello d'avvio.
  Dipende: F5-16

- [x] **F6-02 — Avvio con seat iniziale**
  UI di start: scelta `startSeatIndex`, bloccata finché non tutti i membri sono LIVE (gate F4-06).
  Verifica: con un membro OFFLINE il pulsante è disabilitato E il server rifiuta comunque (regola 6). ✓ il pulsante: `managerControls` in `tests/manage.test.ts` (IDLE e OFFLINE bloccano, e il messaggio nomina la squadra). Il server: con nessuno collegato, `POST …/action {START}` risponde **400 `MEMBERS_NOT_READY`** con l'elenco degli assenti. Con gli otto bot collegati, START dal posto 4 → `current_seat_index = 3`, primo ruolo `P`.
  Fatto: `app/auctions/[id]/manage/controls.tsx`. Il posto di partenza si sceglie con un pulsante per posto (sono al massimo dodici e la sera dell'asta si decide a voce), ognuno col suo pallino di presence. **È il primo posto dell'applicazione in cui esiste un pulsante "Avvia l'asta"**: prima l'avvio passava dai bot o da una fetch a mano.
  Dipende: F6-01

- [x] **F6-03 — Pausa/riprendi da UI**
  Pulsanti pause/resume con stato visibile a tutti i client.
  Verifica: pause dal manager congela i countdown di tutti; resume li riprende dal residuo. ✓ misurato a database: alla pausa `phase_deadline` **non si muove** (ferma a 05:34:21.427 con `paused_at` 05:34:20.304), e resta ferma dopo sei secondi da fermo; al resume la scadenza è traslata a 05:34:27.58 su un "adesso" di 05:34:26.5 — cioè ripartono gli **1,1 secondi** che restavano, non il countdown intero. La vista congelata dei partecipanti era già stata collaudata in F5-11 con le stesse azioni.
  Fatto: due pulsanti nello stesso pannello dei comandi, mutuamente esclusivi per costruzione (`canPause` è `status === 'LIVE'`, `canResume` è `PAUSED`). Le azioni esistevano già nel dispatcher dalla Fase 5: qui sono state **collegate**, non riscritte.
  Dipende: F6-01

- [x] **F6-04 — Alert presence in LIVE**
  Il manager vede un alert se un membro va OFFLINE ad asta iniziata (nessuna pausa automatica, §7).
  Verifica: kill del tab di un bot/browser → alert entro 15s; nessuna pausa scatta da sola. ✓ uccisi gli otto bot a metà asta e letti gli snapshot dal vivo: l'ultimo con `presence: LIVE` è delle 05:35:38, il primo con tutti `OFFLINE` delle 05:35:41 — dentro la finestra dei 15 secondi dall'ultimo heartbeat. **L'asta è rimasta `LIVE`** e ha continuato da sola con auto-pick e auto-bid a 1, esattamente come vuole §7.
  Fatto: `PresenceBanner` in `console.tsx`, su `presenceAlert`. Distingue chi è caduto (rosso: al suo turno scatta la chiamata automatica) da chi ha la pagina in secondo piano (ambra), e dice esplicitamente che **niente si mette in pausa da solo**: il pulsante è lì sotto, la decisione è di chi conduce. Prima dell'avvio l'alert non compare — lì gli stessi pallini sono il cancello, non un guasto. ⚠ In un'asta ferma il cambio di presence viene notato dal primo heartbeat **altrui** che arriva dopo la scadenza (DECISIONS, Fase 4): se cade l'ultimo collegato, non c'è più nessuno a cui dirlo.
  Dipende: F6-01

- [x] **F6-05 — Vista TV**
  `/tv/[publicToken]` senza login, sola lettura, snapshot sanificato con `viewerMemberId = null`.
  Verifica: aperta in incognito mostra lotto, countdown e reveal; un token invalido → 404. ✓ senza **nessun cookie** (l'equivalente dell'incognito): la pagina risponde 200 col nome dell'asta nel titolo, un token inventato dà 404, e lo stream aperto col solo `?token=` restituisce `viewerMemberId: null`, `myBid: null` e otto membri con crediti e rose. Osservati 22 secondi di asta dal vivo: la stringa `"amount"` compare nel JSON **solo** negli snapshot in `LOT_REVEAL`, mai in `LOT_OPEN`.
  Fatto: `app/tv/[publicToken]/page.tsx` (server: traduce il token in un'asta, `auctionByPublicToken` in `lib/engine/viewer.ts`, con i suoi test in `tests/db/tv.test.ts`) e `tv-view.tsx`. La pagina è `noindex`: un URL che vale come autenticazione non si lascia indicizzare. Token inesistente e asta inesistente danno la stessa risposta.
  Dipende: F5-16

- [x] **F6-06 — Layout TV ad alto contrasto**
  Tipografia grande, lotto in corso + countdown + reveal leggibili da distanza di proiezione.
  Verifica: leggibile a 1080p da ~4 metri (o zoom equivalente); nessuna informazione richiede hover. ✓ **nessun `hover:` e nessun `title` nell'intera pagina**, e nessun testo sotto i 24 px (verificato sul sorgente). Le misure vengono da un conto, non dall'occhio: a 1080p su un 50" un pixel vale ~0,57 mm e la leggibilità a quattro metri chiede ~2,7 cm di altezza, cioè ~47 px — quindi nessun **dato** sotto i 36 px, le etichette di contorno a 24, e nome del giocatore, countdown e prezzo fra 128 e 144 px. ⚠ La prova con gli occhi, a schermo vero e a quattro metri, resta all'owner al gate.
  Fatto: bianco su nero **fissi**, non presi dal tema: un proiettore non ha una preferenza di sistema e un tema chiaro in una stanza al buio è illeggibile (è l'unica pagina dell'app che non segue il tema, vedi `docs/DECISIONS.md`). Schermo intero senza scroll: intestazione, palco al centro, classifica dei crediti a destra. Della rosa la classifica mostra il totale (`11/25`) e non le quattro frazioni per ruolo — a quattro metri diventerebbero una riga di numerini.
  Dipende: F6-05

- [x] **F6-07 — ARCHITECTURE: manager e TV**
  Aggiornamento con i due portali e il ruolo del public token.
  Verifica: capitolo presente. ✓ "La regia e la TV", con le due sezioni `/manage` e `/tv/[publicToken]`, più "Cosa non c'è ancora" riscritto sulla Fase 7.
  Fatto: il capitolo spiega perché il token *è* l'autenticazione della TV e perché la cosa è innocua (`viewerMemberId = null` → lo snapshot non contiene gli importi, non li nasconde), da dove vengono le misure tipografiche, e perché il pulsante disabilitato non è mai l'autorizzazione.
  Dipende: F6-06

- [x] **F6-08 — GATE Fase 6**
  Criterio ✅: la vista TV in incognito, senza login, mostra tutto tranne gli importi a busta chiusa (riesegue il test I8 per il viewer TV). Aggiorna `CLAUDE.md`.
  Verifica: criterio dimostrato + test I8 verde. ✓ **Dimostrazione dal vivo**: asta a 8 bot `random` avviata dalla regia, 53 snapshot letti dallo stream della TV **senza nessun cookie**, sei lotti completi con 7–8 buste ciascuno. `viewerMemberId: null` e `myBid: null` in tutti; la stringa `"amount"` compare **solo** nei sei snapshot in `LOT_REVEAL` (con gli otto importi distinti e il vincitore), e in **nessuno** dei 40 in `LOT_OPEN`, dove si vede solo il contatore delle buste. **Violazioni: 0.** Test I8 verde sui tre spettatori; suite completa **275/275**, `typecheck`, `lint` e `build` puliti.
  Fatto: aggiunte anche le vie per **arrivare** alla regia — dalla dashboard (ad asta iniziata l'owner ci finisce direttamente), dalla configurazione e dalla lobby; e corretta la frase del setup che prometteva ancora «l'avvio arriva con la Fase 3». `docs/RUNBOOK.md` ha la nuova sezione "Il collaudo della Fase 6" e non manda più l'owner nella console del browser per avviare e mettere in pausa.
  ⚠ Resta all'owner la prova con gli occhi: la leggibilità a quattro metri su TV o proiettore, che a schermo di computer non si può giudicare.
  Dipende: tutti i F6-*

---

## Fase 7 — Override e chiusura

Niente undo (⚠ P1): la correzione di un lotto sbagliato è `voidAssignment` + `manualAssign`;
la rotazione dei turni non torna mai indietro.

- [x] **F7-01 — `manualAssign`**
  Valida I2/I3/I4; `force` deroga solo I4, mai I3; rifiutata con lotto in contesa (`phase ∈ {LOT_OPEN, LOT_TIE_PREP}`, anche in PAUSED) ⚠ P1.
  Verifica: test §12.35 (con lotto in contesa rifiutata) e §12.40 (giocatore già assegnato rifiutato anche con force). ✓ Entrambi verdi in `tests/db/override.test.ts`, §12.35 provato sia in `LOT_OPEN` sia in `LOT_TIE_PREP` sia **in pausa**.
  Fatto: azione in `lib/engine/override.ts`, invarianti in `canManualAssign` (funzione pura in `rules.ts`, 9 test). `source = MANUAL`, `lot_id = NULL`. **Il prezzo è un intero ≥ 1**: è il pavimento di qualunque offerta ed è ciò che rende `voidAssignment` sempre innocua per I3 (DECISIONS).
  Dipende: F6-08

- [x] **F7-02 — `voidAssignment`**
  Cancella un giocatore da una rosa: `voided_at`, mai DELETE; rifiutata con lotto in contesa; crediti ricalcolati dalla formula.
  Verifica: test §12.36 (giocatore torna disponibile, crediti risalgono, riga a DB con `voided_at`) e §12.38 (con lotto in contesa rifiutata). ✓ Verdi. §12.36 controlla anche che **nessuna riga di ledger** venga scritta: il credito è una formula, non una colonna da rimettere a posto.
  Fatto: nessuna invariante da validare, e non è una dimenticanza — con `price ≥ 1` un void restituisce almeno un credito per ogni slot che riapre, quindi I3 non può rompersi. Ripeterla è un **no-op** (nessun bump, nessun broadcast): è il doppio click su un pulsante già sparito.
  Dipende: F6-08

- [x] **F7-03 — `adjustBudget`**
  Riga di `ledger` con reason e actor; rifiutata se violerebbe I3.
  Verifica: test §12.20 e §12.39 — delta negativo che porta i crediti sotto gli slot residui rifiutato con errore tipizzato. ✓ Verdi, con il caso «una rettifica in più tiene conto di quelle già scritte».
  Fatto: motivo obbligatorio (`INVALID_REQUEST` se vuoto), delta intero e diverso da zero. La regola è `canAdjustBudget`, che la Fase 2 aveva già scritto aspettando questa fase.
  Dipende: F6-08

- [x] **F7-04 — Correzione combinata void + manualAssign** ⚠ P1
  Il flusso che sostituisce l'undo: void dell'assegnazione errata + riassegnazione manuale con l'esito corretto.
  Verifica: test §12.37 — dopo la correzione, rosa e crediti coerenti, nessun doppio assegnamento (I2). ✓ Verde: due righe a DB, **una sola viva**, l'annullata conserva prezzo, `source = AUCTION` e il proprio `lot_id`; crediti tornati a 100 per chi ha perso il giocatore e scesi a 70 per chi l'ha preso. Provato anche il caso «riassegno allo stesso membro» (correzione del solo prezzo) e che l'override faccia partire lo snapshot.
  ⚠ **Falla chiusa qui**: un `manualAssign` sul membro **di turno** in `WAITING_PICK` gli riempiva il ruolo, e il suo pick apriva comunque un lotto di cui non era idoneo — con la sua auto-offerta a 1 dentro il round. Se nessuno rilanciava se lo aggiudicava: **I4 rotta senza `force`**. Due righe in `machine.ts` (pick rifiutato con `NOT_ELIGIBLE`, turno saltato allo scadere), tre test puri e uno su DB. Vedi DECISIONS 2026-08-08.
  Dipende: F7-01, F7-02

- [x] **F7-05 — UI override nel manager**
  Assegnazione manuale, cancellazione giocatore (void), rettifica budget con reason; controlli disabilitati con lotto in contesa (e comunque rifiutati dal server).
  Verifica: il flusso del runbook "pausa → void → manualAssign → resume" si esegue interamente da UI. ✓ Pannello «Correzioni» in `app/auctions/[id]/manage/overrides.tsx`, chiuso di default. Le tre azioni passano dal dispatcher `POST /api/auctions/:id/action` già esistente e **provate dal vivo via HTTP** con l'app accesa: FORBIDDEN da un non-owner, `PLAYER_ASSIGNED` anche con `force`, `ADJUST_VIOLATES_I3` su −500, void + riassegnazione con una sola riga viva a DB, void ripetuto no-op.
  Fatto: le derivazioni sono pure (`overrideControls`, `assignablePlayers` in `lib/realtime/manage.ts`, 9 test). Il void chiede **due click** — cancellare una rosa per un tocco sbagliato sarebbe l'errore che il pannello dovrebbe riparare. La lista dei giocatori mostra solo i liberi, quindi I2 non è nemmeno proponibile; la ricerca del manager non è filtrata per ruolo corrente, perché è proprio per gli errori fuori dal ruolo corrente che il pannello esiste.
  ⚠ Resta all'owner la prova con gli occhi: il pannello si vede solo a stream connesso (la pagina è funzione dello snapshot), quindi da riga di comando se ne può verificare il bundle, non il rendering.
  Dipende: F7-01 … F7-04, F6-03

- [x] **F7-06 — `exportXlsx`** ⚠ P6
  Rigenera il file nel layout Fantacalcio.it a partire dai dati importati (il file originale non è conservato: le colonne non importate restano vuote), con `FantaSquadra` = team_name e `Costo` = price.
  Verifica: ✅ criterio di fase — il file esportato ha le due colonne riempite e riapre correttamente in Excel; un reimport nel nostro stesso parser lo accetta. ✓ 5 test verdi: intestazione identica alle 14 colonne di Fantacalcio.it, reimport con `parseListone` che ritrova i 40 giocatori, e un'assegnazione **annullata** che non compare (regola 5). Provato anche dal vivo: 495 righe, 129 KB, `Content-Disposition: attachment; filename="asta-di-prova-rose.xlsx"`, 403 per chi non è l'owner.
  Fatto: layout puro in `lib/import/exportListone.ts`, lettura in `lib/engine/export.ts` (la regola ESLint vieta `lib/db` a `lib/import/**`), download su `GET /api/auctions/:id/export` — l'unica azione della fase fuori dal dispatcher, perché un file ha bisogno di un URL e di due header. Le colonne non importate sono `null`, cioè **nessuna cella**, non stringhe vuote.
  ⚠ Resta all'owner: aprire davvero il file in Excel/Numbers e, se possibile, ricaricarlo su Fantacalcio.it.
  Dipende: F6-08

- [x] **F7-07 — Suite §12.35–40 completa**
  Tutti i test di override e correzioni verdi.
  Verifica: `pnpm test` verde sull'intera §12 (41/41 contando le fasi precedenti). ✓ §12.35, 36, 37, 38, 39 e 40 in `tests/db/override.test.ts` (22 test), §12.20 riverificata sia pura sia su database. Suite completa **327/327** su 25 file, contro i 275 alla chiusura della Fase 6.
  Dipende: F7-01 … F7-04

- [x] **F7-07bis — Un id malformato deve dare 404, non 500** (rimandato dalla Fase 5)
  `POST /api/auctions/undefined/action` (e le altre route con `:id`) risponde **500**: l'uuid finto arriva fino a Postgres, che lo rifiuta con un'eccezione. PLAN §17 vuole un codice tipizzato per ogni rifiuto, e un URL sbagliato è un rifiuto come gli altri.
  Verifica: le tre route con `:id` (`action`, `heartbeat`, `stream`) rispondono `NOT_FOUND` con un id non-uuid, e il caso è coperto da un test. ✓ `tests/db/ids.test.ts`, 5 test verdi su sei id malformati (`undefined`, `null`, stringa vuota, `123`, `not-a-uuid`, un uuid con un carattere in più).
  Fatto: `isUuid` in `lib/engine/ids.ts`, chiamata dai due **imbuti** invece che dalle tre rotte — `withAuctionLock` (che copre `action` e ogni azione futura) e `resolveViewer` (che copre `stream` e `heartbeat`) — più `withSetupLock`, `getAuctionOverview` e `listPickPool`, che le pagine chiamano con l'id preso dall'URL: anche `/auctions/undefined/setup` rispondeva 500 e adesso è un `notFound()`.
  Nota: emerso durante il collaudo della Fase 5, dove il comando di avvio in console aveva preso l'id sbagliato. Non è urgente — è un URL che nessuna pagina genera — ma sta qui perché è la fase in cui si guardano gli errori.
  Dipende: —

- [x] **F7-08 — ARCHITECTURE: override e audit**
  Capitolo su ledger, void compensativi, correzione senza undo e la tabella events come memoria dell'asta.
  Verifica: capitolo presente. ✓ "Le correzioni, e la memoria dell'asta": perché l'undo non esiste, perché il divieto guarda la fase e non lo stato, perché il credito-formula rende superflua ogni riga compensativa, le tre azioni una per una, la falla su I4 e come è stata chiusa, l'export e la tabella `events`. Aggiornati anche il capitolo della regia e "Cosa non c'è ancora", riscritto sulla Fase 8.
  Dipende: F7-07

- [x] **F7-09 — GATE Fase 7**
  Criteri ✅: void + riassegnazione manuale riporta crediti e rose a uno stato coerente (I2 rispettata, riga annullata a DB con `voided_at`); export riempie FantaSquadra e Costo. Aggiorna `CLAUDE.md`.
  Verifica: entrambi dimostrati; suite completa verde. ✓ **Suite 327/327** su 25 file, `typecheck`, `lint` e `build` puliti.
  ✓ **Primo criterio, dimostrato due volte.** Nei test (§12.37): lotto aggiudicato al seat 1 per 10, void, riassegnazione al seat 4 per 30 → crediti 100 e 70, rose 0 e 1 portiere, **due righe a DB con una sola viva**, l'annullata che conserva prezzo 10, `source = AUCTION` e il proprio `lot_id`. E dal vivo via HTTP, con l'app accesa, sull'asta del seed: stessa sequenza, `PLAYER_ASSIGNED` sul tentativo di dare lo stesso giocatore a due squadre (anche con `force`), `ADJUST_VIOLATES_I3` su una rettifica di −500, void ripetuto no-op.
  ✓ **Secondo criterio.** Export da `GET /api/auctions/<id>/export`: 495 righe, 129 KB, `filename="asta-di-prova-rose.xlsx"`, con `FantaSquadra` e `Costo` riempite **solo** per i giocatori comprati e il giocatore corretto attribuito alla squadra nuova al prezzo nuovo. Intestazione identica alle 14 colonne di Fantacalcio.it e reimport accettato da `parseListone`.
  ✓ **F7-07bis dal vivo**: `/api/auctions/undefined/stream` e `.../heartbeat` rispondono `404 NOT_FOUND`, `.../action` autenticato idem, e `/auctions/undefined/manage` e `/setup` sono passate da 500 a 404.
  ⚠ **Restano all'owner tre prove con gli occhi**, tutte nel runbook ("Il collaudo della Fase 7"): il pannello di correzione usato davvero dalla regia con un'asta viva (da riga di comando se ne verifica il bundle, non il rendering), l'apertura del file esportato in Excel/Numbers, e il ricaricamento su Fantacalcio.it.
  Dipende: tutti i F7-*

---

## Fase 8 — Deploy

- [x] **F8-00 — La build di produzione e la suite, riparate** *(task non previsto)*
  Prima di poter deployare c'era da rimettere in piedi due cose che i cancelli delle fasi 0–7 non avevano visto, perché si verificano con `pnpm dev` e `pnpm test` su un albero che nel frattempo era cambiato.
  Verifica: `pnpm build` verde (17 rotte), `pnpm test` **327/327**, `pnpm typecheck` e `pnpm lint` verdi. ✓
  Fatto: (1) `next build` esegue ESLint e un errore di lint **blocca la build** — un apostrofo non escapato in `app/auctions/[id]/setup/page.tsx` rendeva l'app non deployabile; corretto insieme a tre variabili morte, fra cui la prop `seatsTaken` di `ManageConsole`. (2) Il commit `01b7c0d` aveva lasciato **due test rossi** in `tests/manage.test.ts`: i nomi degli assenti sono stati tolti da `startBlocked` di proposito (la stessa informazione stava in tre posti), e i test sono stati riportati sul contratto vero — `canStart` falso, messaggio sulla regola, e il nome di chi manca ancora raggiungibile da `absentMembers`. Vedi DECISIONS 2026-08-08.

- [x] **F8-01 — Provisioning**
  Hetzner CX22 + Ploi, Postgres 16 locale alla macchina, variabili d'ambiente di §1, deploy `standalone`.
  Verifica: l'app risponde su HTTPS con login Google di produzione funzionante.
  Fatto (file, in `deploy/`): `env.production.example` (le 5 variabili di §1), `ecosystem.config.cjs` (pm2 in `fork` con `instances: 1` — in cluster mode ogni copia eseguirebbe `instrumentation.ts`, cioè due sweep sulla stessa asta — `max_memory_restart: 512M`, `TZ=UTC`, `HOSTNAME=127.0.0.1`; legge `.env` da sé e **non parte** se manca una variabile), `deploy.sh` (install con `--prod=false`, build, copia di `.next/static`, `pm2 reload`; si rifiuta di partire con un'asta `LIVE`/`PAUSED`).
  ✓ **Standalone collaudato in locale**, non solo evitato: `server.js` fa `process.chdir(__dirname)` e da `.next/standalone` non vede nessun `.env` — le variabili le passa pm2. Con `.next/static` copiato, `GET /` → 307 e il CSS servito 200 (55 KB).
  ✓ Macchina: Hetzner CX22, Ubuntu 26.04 LTS, `psql 16.14` (PGDG ha la 26.04), nginx 1.30.4, Node 24.19, fuso `Etc/UTC`. Valkey installata per obbligo di Ploi e disabilitata; login SSH per password chiuso (`passwordauthentication no`), root solo con chiave.
  ✓ **Criterio raggiunto**: `https://fantasta.rggndr.it` risponde, certificato Let's Encrypt valido, **login Google di produzione funzionante**, schema applicato con `pnpm db:push` (14 tabelle, indici parziali `one_owner_per_player` e `one_open_lot_per_auction` compresi), pm2 online in `fork`, `pm2 startup` registrato.
  ⚠ Due inciampi utili da ricordare: il `client_id` di Google era stato riempito col redirect URI (Google risponde `invalid_client`, non `redirect_uri_mismatch` — si diagnostica leggendo il parametro `client_id` nel redirect verso Google); e una modifica di `.env` richiede `pm2 reload deploy/ecosystem.config.cjs --update-env`, **non** `pm2 restart asta`, perché è l'ecosystem file a leggere `.env` quando pm2 lo valuta.
  Dipende: F7-09

- [x] **F8-02 — nginx per SSE**
  `proxy_buffering off` sulla route dello stream + Let's Encrypt.
  Verifica: `curl -N` sullo stream in produzione riceve snapshot e ping in tempo reale, senza buffering. ✓ Con ogni riga marcata dall'ora d'arrivo: `event: snapshot` al secondo 0, `: ping` a **+15s** e a **+30s**. Con il buffering attivo sarebbero arrivate tutte insieme allo scadere della connessione.
  Fatto: due `location` in `deploy/nginx-asta.conf`, incollati nel server block generato da Ploi — quello dello stream con `proxy_buffering off`, `proxy_request_buffering off`, `proxy_cache off`, `gzip off` e timeout a un'ora; quello generale con `client_max_body_size 10M` per l'upload del listone (il default di 1 MB avrebbe dato un 413 in fase di setup). La difesa è doppia di proposito: l'app manda già `X-Accel-Buffering: no`. Certificato Let's Encrypt emesso da Ploi **prima** di modificare la config, perché l'emissione riscrive quel file.
  Dipende: F8-01

- [x] **F8-03 — pm2 e boot recovery**
  `pm2` con `--max-memory-restart`; `pm2 restart` in produzione a metà asta di prova → recovery entro 1s.
  Verifica: restart durante un round di prova: l'asta prosegue come da F3-14. ✓ `pm2 restart asta` dato a ~100 assegnazioni su 200. Prova oggettiva a posteriori: sulle **1260 transizioni** dell'asta il buco più lungo fra due consecutive è di **4,0 secondi**, e con `bid_seconds = 3` la cadenza naturale è 3–4 — il riavvio **non si distingue dal rumore di fondo**. I bot hanno perso lo stream e si sono riconnessi da soli entro un secondo.
  Fatto: `deploy/ecosystem.config.cjs`, `max_memory_restart: 512M`, `pm2 startup` + `pm2 save` registrati (riparte al boot della macchina), `pm2-logrotate` installato.
  Dipende: F8-01

- [x] **F8-04 — Backup**
  `pg_dump` giornaliero in cron con retention; procedura di restore provata una volta.
  Verifica: il dump di oggi esiste ed è restorabile su un DB vuoto. ✓ Dump di 123 KB con dentro l'asta di prova completa, ripristinato su `asta_restore_check`: 200 assegnazioni, 774 offerte, 1260 eventi, 495 giocatori, **I2 verificata sui dati ripristinati**, database di prova rimosso. Provato di proposito **prima** di cancellare l'asta di prova: un dump pieno è una prova seria, uno vuoto no.
  Fatto: `deploy/db-backup.sh` (SQL semplice gzippato, `--clean --if-exists --no-owner`, rifiuta un dump sotto il KB o un gzip corrotto, retention 14) in cron alle **04:15 UTC** (06:15 italiane); `deploy/db-restore-check.sh` ripristina su un database separato, conta le righe e ricontrolla I2 senza mai toccare la produzione.
  Dipende: F8-01

- [x] **F8-05 — RUNBOOK di produzione**
  Checklist pre-asta di §17 (6 punti) + tabella runbook incidenti (senza undo: correzioni via void + manualAssign), aggiornati con i comandi reali del server.
  Verifica: la checklist è eseguibile punto per punto senza conoscenze non scritte. ✓ Capitolo «Produzione e serata dell'asta» in `docs/RUNBOOK.md`: coordinate della macchina, le **tre password diverse** che è facile confondere, il deploy (automatico su push, ~2 minuti, con la regola «la sera dell'asta non si pusha»), la checklist §17 coi comandi copiabili, la tabella degli incidenti con i numeri misurati, backup e restore (compreso il restore vero sopra la produzione), le cinque trappole che esistono solo in produzione e la procedura per rifare la macchina da zero.
  Dipende: F8-03, F8-04

- [x] **F8-06 — Asta di prova in produzione**
  Asta completa a 8 bot con timer accelerati portata a COMPLETED su produzione, poi cancellata.
  Verifica: ✅ criterio di fase — asta COMPLETED in produzione; `events` coerente; l'asta di prova rimossa.
  Fatto (codice): i bot non passano più dal provider `dev`, che in produzione non esiste per costruzione — e non sarebbe bastata un'env var, perché il server standalone forza `NODE_ENV=production` da sé. `sessionCookie()` in `scripts/bots.ts` emette il JWT di sessione con `encode()` di `next-auth/jwt` usando `AUTH_SECRET`, e **verifica subito** che il server lo accetti (`GET /api/auth/session` deve restituire l'id giusto), invece di scoprirlo da una sfilza di 401 a metà asta. Il nome del cookie segue lo schema (`__Secure-` su https) perché Auth.js usa **il nome come salt** della chiave. Nessuna superficie di login aggiunta all'app: chi ha `AUTH_SECRET` ha già tutto. Vedi DECISIONS 2026-08-08.
  ✓ **Prova generale in locale**: asta a 8 bot dallo `START` a `COMPLETED`, 8 rose da 25 giocatori (200 assegnazioni vive), crediti tutti positivi (I3), `state_version` 827.
  ✓ **In produzione, il criterio ✅ della fase**: asta a 8 bot su `https://fantasta.rggndr.it`, `COMPLETED` alle 10:46:14 del 2026-08-09, 8 rose da **25 giocatori esatti**, crediti tutti ≥ 0, **1260 righe in `events`** (con dentro il `pm2 restart` di F8-03), 774 offerte. Poi asta cancellata e utenti di prova rimossi: database di produzione con **zero aste e un solo utente**, quello vero — punto 3 della checklist §17.
  Dipende: F8-02, F8-03

- [x] **F8-07 — ARCHITECTURE: capitolo finale**
  Deploy, topologia (un processo, un DB, una macchina), e come leggere i log in diretta.
  Verifica: il documento copre l'intera app allo stato finale. ✓ Capitolo «Il posto dove gira»: il diagramma della topologia, perché il processo va avviato in un modo preciso (i due lasciti di `standalone`, e `fork`/1 istanza come invariante), l'unica riga di nginx che conta e come si **misura** che funzioni, il deploy e la ragione della guardia sull'asta viva, i bot che si firmano il cookie, il tempo in UTC, i backup provati e la traccia doppia della serata. Riscritto anche «Cosa non c'è ancora»: niente alta disponibilità, niente staging, niente monitoraggio — tre scelte, non tre dimenticanze.
  Dipende: F8-06

- [x] **F8-08 — GATE Fase 8**
  Criterio ✅: un'asta completa a 8 partecipanti in produzione. Aggiorna `CLAUDE.md`.
  Verifica: criterio dimostrato; checklist pre-asta eseguita almeno una volta per intero. ✓ Criterio dimostrato il **2026-08-09**: asta a 8 bot `COMPLETED` su `https://fantasta.rggndr.it`. `pnpm test` **327/327**, `pnpm build`, `pnpm lint` e `pnpm typecheck` verdi. `CLAUDE.md` e la guida per l'owner in `docs/RUNBOOK.md` aggiornate: non ci sono più fasi da aprire.
  ⚠ **Della checklist §17 restano all'owner i punti 5 e 6**, che richiedono la serata vera: otto persone che fanno login e compaiono `LIVE` in lobby prima di cominciare, e `pm2 logs asta` aperto per tutta la durata. I punti 1–4 (backup con copia scaricata, asta di prova a 8 bot in produzione, cancellazione, vista TV) sono stati eseguiti oggi.
  Dipende: tutti i F8-*

---

## Post-MVP

Fuori scope per la prima asta (DECISIONS, 2026-08-06).

- [ ] **PM-01 — Area admin** ⚠ P19
  `/admin` per `is_admin`: elenco aste e utenti, sola lettura (§10).
  Verifica: utente admin vede tutte le aste; non-admin → 403/redirect.
  Dipende: F5-16
