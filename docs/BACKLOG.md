# BACKLOG — Asta Fantacalcio a Busta Chiusa

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

- [ ] **F5-01 — Layout `/auctions/[id]/play`**
  Struttura mobile-first: rosa, crediti, `max_bid`, ruolo corrente, chi è di turno. Tutto derivato dallo snapshot (I10).
  Verifica: la pagina renderizza ogni stato del seed (`ready|live|mid`) correttamente al primo load, senza eventi ricevuti.
  Dipende: F4-12

- [ ] **F5-02 — Banner globale "Asta in corso"**
  Su tutte le pagine (dashboard inclusa) se l'utente è membro di un'asta LIVE/PAUSED; porta a `/play`.
  Verifica: con asta LIVE il banner compare in dashboard e naviga correttamente; senza aste live non compare.
  Dipende: F5-01

- [ ] **F5-03 — Componente Countdown**
  Rendering con clock offset; a zero mostra "in chiusura…" e NON cambia mai stato (regola 1).
  Verifica: unit test con offset simulato; a deadline superata mostra "in chiusura…" finché non arriva lo snapshot.
  Dipende: F4-07

- [ ] **F5-04 — Card permanente del lotto**
  Visibile finché `currentLot != null`: giocatore, ruolo, squadra, countdown, propria offerta, buste altrui (booleano), pulsante "Apri offerta".
  Verifica: chiuso il modale, la card resta e riapre il modale; la card mostra l'offerta salvata.
  Dipende: F5-01, F5-03

- [ ] **F5-05 — Modale d'offerta**
  Auto-apertura su `LOT_OPEN && idoneo && dismissedLotId !== currentLot.id`; `dismissedLotId` solo nello state del componente.
  Verifica: chiudo il modale → non si riapre per lo stesso lotto; al lotto successivo si riapre da solo.
  Dipende: F5-04

- [ ] **F5-06 — Input e submit dell'offerta**
  `inputMode="numeric"`, conferma nella metà inferiore ≥ 44px, feedback di salvataggio immediato e inequivocabile, countdown e max_bid visibili anche con tastiera aperta.
  Verifica: su viewport mobile con tastiera virtuale, countdown e max_bid restano visibili; il feedback di conferma appare < 500ms.
  Dipende: F5-05

- [ ] **F5-07 — Override e ritiro da UI**
  Rilancio (override) sempre; ritiro nascosto per il chiamante e nel round 2, e comunicato come definitivo ⚠ P10; ri-submit dello stesso importo comunicato come "sei già a X" ⚠ P3.
  Verifica: gli stati del pulsante ritiro corrispondono a snapshot chiamante/round1/round2; dopo il ritiro la UI non offre più il submit.
  Dipende: F5-06

- [ ] **F5-08 — Vista TIE_PREP**
  Countdown di preparazione con indicazione chiara "sei/non sei tra i pareggianti".
  Verifica: con `--strategy=tie` i due pareggianti e un terzo vedono messaggi coerenti.
  Dipende: F5-04

- [ ] **F5-09 — Pannello reveal**
  Tutte le offerte di tutti i round, vincitore e prezzo, per la durata di `reveal_seconds`.
  Verifica: dopo un lotto con spareggio, il pannello mostra round 1 e round 2 con importi e timestamp relativi.
  Dipende: F5-04

- [ ] **F5-10 — Vista WAITING_PICK (proprio turno)**
  Lista/ricerca dei giocatori disponibili del ruolo corrente, ordinabile per fvm, con countdown del pick.
  Verifica: la lista esclude assegnati e fuori-lista; pick da UI apre il lotto.
  Dipende: F5-01, F5-03

- [ ] **F5-11 — Vista PAUSED**
  Schermata di attesa con stato congelato.
  Verifica: su pause dal manager (o via action) tutti i client mostrano l'attesa; su resume riprendono.
  Dipende: F5-01

- [ ] **F5-12 — Presence in lobby**
  Pallini LIVE/IDLE/OFFLINE per membro nella lobby (§7).
  Verifica: tab in background → IDLE entro 15s; tab chiuso → OFFLINE entro 15s.
  Dipende: F4-05, F1-14

- [ ] **F5-13 — Checklist di rientro §8bis**
  Verifica sistematica dei 5 casi: rientro in LOT_OPEN (offerta precompilata), TIE_PREP, LOT_REVEAL (tempo residuo), WAITING_PICK scaduto (mai schermata fantasma), PAUSED.
  Verifica: ognuno dei 5 casi riprodotto con kill del tab e rientro: schermata identica a un client mai disconnesso.
  Dipende: F5-04 … F5-11

- [ ] **F5-14 — Prova su telefono reale**
  Portale partecipante provato su un telefono fisico via `dev:lan` dentro un'asta con bot (§15).
  Verifica: un'asta giocata dal telefono senza zoom forzato, con tastierino numerico nativo.
  Dipende: F5-13, F0-13, F4-10

- [ ] **F5-15 — ARCHITECTURE: il portale**
  Capitolo su gerarchia banner/card/modale e sul perché la UI è funzione dello snapshot.
  Verifica: capitolo presente.
  Dipende: F5-13

- [ ] **F5-16 — GATE Fase 5**
  I 4 criteri ✅ del piano: asta a 4 browser reali senza desync; modale chiuso/riaperto con offerta intatta; kill del tab a metà round e rientro identico; offline al proprio turno → rientro sul lotto auto-pick senza schermata fantasma. Aggiorna `CLAUDE.md`.
  Verifica: i 4 scenari eseguiti e documentati.
  Dipende: tutti i F5-*

---

## Fase 6 — Portale manager e vista TV

- [ ] **F6-01 — Recap rose e budget**
  `/auctions/[id]/manage` (solo owner, desktop): tutte le rose, crediti, max_bid, slot per ruolo.
  Verifica: i numeri coincidono con la formula crediti su un'asta `mid` seeded.
  Dipende: F5-16

- [ ] **F6-02 — Avvio con seat iniziale**
  UI di start: scelta `startSeatIndex`, bloccata finché non tutti i membri sono LIVE (gate F4-06).
  Verifica: con un membro OFFLINE il pulsante è disabilitato E il server rifiuta comunque (regola 6).
  Dipende: F6-01

- [ ] **F6-03 — Pausa/riprendi da UI**
  Pulsanti pause/resume con stato visibile a tutti i client.
  Verifica: pause dal manager congela i countdown di tutti; resume li riprende dal residuo.
  Dipende: F6-01

- [ ] **F6-04 — Alert presence in LIVE**
  Il manager vede un alert se un membro va OFFLINE ad asta iniziata (nessuna pausa automatica, §7).
  Verifica: kill del tab di un bot/browser → alert entro 15s; nessuna pausa scatta da sola.
  Dipende: F6-01

- [ ] **F6-05 — Vista TV**
  `/tv/[publicToken]` senza login, sola lettura, snapshot sanificato con `viewerMemberId = null`.
  Verifica: aperta in incognito mostra lotto, countdown e reveal; un token invalido → 404.
  Dipende: F5-16

- [ ] **F6-06 — Layout TV ad alto contrasto**
  Tipografia grande, lotto in corso + countdown + reveal leggibili da distanza di proiezione.
  Verifica: leggibile a 1080p da ~4 metri (o zoom equivalente); nessuna informazione richiede hover.
  Dipende: F6-05

- [ ] **F6-07 — ARCHITECTURE: manager e TV**
  Aggiornamento con i due portali e il ruolo del public token.
  Verifica: capitolo presente.
  Dipende: F6-06

- [ ] **F6-08 — GATE Fase 6**
  Criterio ✅: la vista TV in incognito, senza login, mostra tutto tranne gli importi a busta chiusa (riesegue il test I8 per il viewer TV). Aggiorna `CLAUDE.md`.
  Verifica: criterio dimostrato + test I8 verde.
  Dipende: tutti i F6-*

---

## Fase 7 — Override e chiusura

Niente undo (⚠ P1): la correzione di un lotto sbagliato è `voidAssignment` + `manualAssign`;
la rotazione dei turni non torna mai indietro.

- [ ] **F7-01 — `manualAssign`**
  Valida I2/I3/I4; `force` deroga solo I4, mai I3; rifiutata con lotto in contesa (`phase ∈ {LOT_OPEN, LOT_TIE_PREP}`, anche in PAUSED) ⚠ P1.
  Verifica: test §12.35 (con lotto in contesa rifiutata) e §12.40 (giocatore già assegnato rifiutato anche con force).
  Dipende: F6-08

- [ ] **F7-02 — `voidAssignment`**
  Cancella un giocatore da una rosa: `voided_at`, mai DELETE; rifiutata con lotto in contesa; crediti ricalcolati dalla formula.
  Verifica: test §12.36 (giocatore torna disponibile, crediti risalgono, riga a DB con `voided_at`) e §12.38 (con lotto in contesa rifiutata).
  Dipende: F6-08

- [ ] **F7-03 — `adjustBudget`**
  Riga di `ledger` con reason e actor; rifiutata se violerebbe I3.
  Verifica: test §12.20 e §12.39 — delta negativo che porta i crediti sotto gli slot residui rifiutato con errore tipizzato.
  Dipende: F6-08

- [ ] **F7-04 — Correzione combinata void + manualAssign** ⚠ P1
  Il flusso che sostituisce l'undo: void dell'assegnazione errata + riassegnazione manuale con l'esito corretto.
  Verifica: test §12.37 — dopo la correzione, rosa e crediti coerenti, nessun doppio assegnamento (I2).
  Dipende: F7-01, F7-02

- [ ] **F7-05 — UI override nel manager**
  Assegnazione manuale, cancellazione giocatore (void), rettifica budget con reason; controlli disabilitati con lotto in contesa (e comunque rifiutati dal server).
  Verifica: il flusso del runbook "pausa → void → manualAssign → resume" si esegue interamente da UI.
  Dipende: F7-01 … F7-04, F6-03

- [ ] **F7-06 — `exportXlsx`** ⚠ P6
  Rigenera il file nel layout Fantacalcio.it a partire dai dati importati (il file originale non è conservato: le colonne non importate restano vuote), con `FantaSquadra` = team_name e `Costo` = price.
  Verifica: ✅ criterio di fase — il file esportato ha le due colonne riempite e riapre correttamente in Excel; un reimport nel nostro stesso parser lo accetta.
  Dipende: F6-08

- [ ] **F7-07 — Suite §12.35–40 completa**
  Tutti i test di override e correzioni verdi.
  Verifica: `pnpm test` verde sull'intera §12 (41/41 contando le fasi precedenti).
  Dipende: F7-01 … F7-04

- [ ] **F7-08 — ARCHITECTURE: override e audit**
  Capitolo su ledger, void compensativi, correzione senza undo e la tabella events come memoria dell'asta.
  Verifica: capitolo presente.
  Dipende: F7-07

- [ ] **F7-09 — GATE Fase 7**
  Criteri ✅: void + riassegnazione manuale riporta crediti e rose a uno stato coerente (I2 rispettata, riga annullata a DB con `voided_at`); export riempie FantaSquadra e Costo. Aggiorna `CLAUDE.md`.
  Verifica: entrambi dimostrati; suite completa verde.
  Dipende: tutti i F7-*

---

## Fase 8 — Deploy

- [ ] **F8-01 — Provisioning**
  Hetzner CX22 + Ploi, Postgres 16 locale alla macchina, variabili d'ambiente di §1, deploy `standalone`.
  Verifica: l'app risponde su HTTPS con login Google di produzione funzionante.
  Dipende: F7-09

- [ ] **F8-02 — nginx per SSE**
  `proxy_buffering off` sulla route dello stream + Let's Encrypt.
  Verifica: `curl -N` sullo stream in produzione riceve snapshot e ping in tempo reale, senza buffering.
  Dipende: F8-01

- [ ] **F8-03 — pm2 e boot recovery**
  `pm2` con `--max-memory-restart`; `pm2 restart` in produzione a metà asta di prova → recovery entro 1s.
  Verifica: restart durante un round di prova: l'asta prosegue come da F3-14.
  Dipende: F8-01

- [ ] **F8-04 — Backup**
  `pg_dump` giornaliero in cron con retention; procedura di restore provata una volta.
  Verifica: il dump di oggi esiste ed è restorabile su un DB vuoto.
  Dipende: F8-01

- [ ] **F8-05 — RUNBOOK di produzione**
  Checklist pre-asta di §17 (6 punti) + tabella runbook incidenti (senza undo: correzioni via void + manualAssign), aggiornati con i comandi reali del server.
  Verifica: la checklist è eseguibile punto per punto senza conoscenze non scritte.
  Dipende: F8-03, F8-04

- [ ] **F8-06 — Asta di prova in produzione**
  Asta completa a 8 bot con timer accelerati portata a COMPLETED su produzione, poi cancellata.
  Verifica: ✅ criterio di fase — asta COMPLETED in produzione; `events` coerente; l'asta di prova rimossa.
  Dipende: F8-02, F8-03

- [ ] **F8-07 — ARCHITECTURE: capitolo finale**
  Deploy, topologia (un processo, un DB, una macchina), e come leggere i log in diretta.
  Verifica: il documento copre l'intera app allo stato finale.
  Dipende: F8-06

- [ ] **F8-08 — GATE Fase 8**
  Criterio ✅: un'asta completa a 8 partecipanti in produzione. Aggiorna `CLAUDE.md`.
  Verifica: criterio dimostrato; checklist pre-asta eseguita almeno una volta per intero.
  Dipende: tutti i F8-*

---

## Post-MVP

Fuori scope per la prima asta (DECISIONS, 2026-08-06).

- [ ] **PM-01 — Area admin** ⚠ P19
  `/admin` per `is_admin`: elenco aste e utenti, sola lettura (§10).
  Verifica: utente admin vede tutte le aste; non-admin → 403/redirect.
  Dipende: F5-16
