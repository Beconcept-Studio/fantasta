# DECISIONS

Registro **append-only** delle scelte non previste (o divergenti) da `docs/PLAN.md`.
Ogni voce: data, decisione, motivazione. I riferimenti Pn rimandano ai punti
dell'interrogazione del piano fatta nella sessione di kickoff.

---

## 2026-08-06 — Ratifiche del kickoff

**Niente undo (P1, P15).** `undoLastLot` è eliminato dal progetto: rimossi l'azione, i campi
`prev_role`/`prev_seat_index` di `lots`, lo stato `VOIDED` dei lotti; i test §12.36–38 sono
ridefiniti su `voidAssignment`; il runbook è aggiornato. La correzione di un lotto sbagliato è
`voidAssignment` (cancellazione del giocatore dalla rosa, via `voided_at`) + `manualAssign`;
la rotazione dei turni non torna mai indietro. Motivazione: semplificazione — il ripristino di
turno e ruolo era la parte più fragile della specifica. Propagato in PLAN.md, CLAUDE.md, BACKLOG.md.

**Override solo senza lotto in contesa (P1).** `manualAssign`, `voidAssignment` e `adjustBudget`
sono rifiutati con `phase ∈ {LOT_OPEN, LOT_TIE_PREP}`, anche in PAUSED: la pausa congela la fase,
non la azzera. Motivazione: toccare le rose con buste aperte o uno spareggio pendente corromperebbe
lo stato.

**`max_bid` robusta (P2).** Residui calcolati per ruolo e clampati a ≥ 0; `max_bid ≤ crediti`
sempre, anche dopo `manualAssign` con `force`. Motivazione: la formula lineare di I5 va in
overdraft se un ruolo è in overflow.

**Conferma della stessa cifra = no-op (P3).** `placeBid` con importo identico all'offerta corrente
non aggiorna `amount_set_at`. Motivazione: nel round 2 un "conferma" ansioso non deve peggiorare
la posizione temporale di chi era arrivato prima a quella cifra.

**Ripartizione dei test §12 e criteri differiti (P4, P5).** Fase 2: 1–26, 29, 30, 41 (puri);
Fase 3: 27–28 (concorrenza DB); Fase 4: 31–34 (snapshot); Fase 7: 35–40 (override). Il criterio
"avviando, l'asta parte dal primo ruolo" di Fase 1 si verifica al gate di Fase 3; i bot arrivano
dopo la Fase 4 (richiedono SSE); il seed è incrementale (utenti in F0, listone in F1, stati LIVE
in F3). Motivazione: la lettera del piano rendeva alcuni cancelli non verificabili nella propria fase.

**File xlsx non conservato (P6).** L'import estrae i dati e il file viene buttato; l'export
rigenera il layout Fantacalcio.it dai dati importati, con le colonne non importate vuote.

**Toggle `include_out_of_list` (P7).** Colonna su `auctions`, default `false`; ogni modifica
rivalida I9 e viene rifiutata se la violerebbe.

**Heartbeat fuori dal lock (P8).** `last_seen_at`/`is_visible` sono telemetria, non stato-macchina:
si scrivono senza `withAuctionLock`, senza bump di `state_version`; broadcast dei soli cambi di
presence, coalescato. La regola "mai mutare un'asta fuori dal lock" copre lo stato della macchina
(auctions, lots, lot_rounds, bids, assignments, ledger). Motivazione: evitare uno snapshot-storm
da 12 heartbeat ogni 10 secondi.

**`nextRole` a salti (P9).** L'avanzamento lungo `role_order` salta i ruoli già pieni per tutti
(possibile dopo `manualAssign`); nessun ruolo residuo → COMPLETED.

**Ritiro irreversibile (P10).** Dopo `withdrawBid` il membro non può più offrire su quel lotto.

**Owner e membership (P11).** L'owner tipicamente joina come membro normale (ma non è obbligato);
il gate presence per l'avvio riguarda i soli membri.

**DRAFT ↔ READY derivato (P12).** Ricalcolato a ogni mutazione di setup; reversibile (un
removeMember su asta READY la riporta a DRAFT).

**Seat in ordine di join (P13).** `seat_index` assegnato in ordine di join, ricompattato alla
rimozione di un membro in DRAFT/READY.

**`state_version` solo su mutazioni effettive (P14).** Le no-op (es. `advancePhase` guardata)
non incrementano la versione e non fanno broadcast. Motivazione: coerenza con I7 e niente
traffico inutile dallo sweep.

**Auth.js con strategy JWT (P17).** Nessuna tabella adapter; upsert su `google_sub` al login.
Lo stato applicativo vive tutto a DB, quindi lo stesso account Google su due dispositivi vede
le stesse informazioni.

**Rinomina file (P18).** `claude.md` → `CLAUDE.md`, `docs/plan.md` → `docs/PLAN.md`: il
filesystem del VPS di produzione è case-sensitive. Fatto in kickoff.

**Area admin post-MVP (P19).** `/admin` fuori scope per la prima asta (task PM-01 nel backlog).

**Pool esaurito post-import (P20).** Il caso "auto-pick senza giocatori disponibili nel ruolo"
è deliberatamente non gestito, su indicazione dell'utente.

**Niente `DEV_TIME_SCALE` (P16).** Eliminata: le aste di prova nascono dal seed con timer corti
(bid 3s, pick 3s, reveal 2s). Il motore resta identico in dev e produzione; nessun ramo di codice
dipendente dall'ambiente dentro la logica del tempo.

**Inviti senza limiti di default.** `expires_at` e `max_uses` restano nello schema ma di default
non sono valorizzati: il link vale per chiunque finché l'asta è in DRAFT/READY. La protezione
reale è che gli inviti muoiono comunque all'avvio dell'asta (§17).

**Budget uguale per tutti.** `budget_initial` è sempre una copia di `budget_default`; nessun
budget per-membro. Le uniche variazioni individuali passano dal `ledger` (rettifiche motivate).

**Lotto con un solo idoneo: chiusura immediata.** Se alla creazione del lotto l'unico membro
idoneo è il chiamante, non si attende `bid_seconds`: il lotto passa direttamente a LOT_REVEAL,
assegnato a 1 (comportamento coperto dal test §12.41). Motivazione: a fine ruolo questi lotti
possono essere molti di fila; countdown dall'esito già scritto sono minuti persi in diretta.

---

## 2026-08-07 — Fase 0, scaffold

**Postgres su porta 5433, non 5432.** `docker-compose.yml` mappa `5433:5432` invece del
`5432:5432` di PLAN §15. Motivazione: sulla macchina di sviluppo la 5432 è già occupata dal
Postgres di un altro progetto, e `docker compose up` falliva. Dentro il container la porta resta
quella standard; cambia solo `DATABASE_URL`. In produzione la questione non esiste.

**Eccezioni esplicite alla regola ESLint su `lib/db`.** La regola vieta l'import di `lib/db`
dappertutto tranne da un elenco enumerato in `eslint.config.mjs`: `lib/db/**`, `lib/engine/**`,
`lib/auth.ts`, `scripts/**`, `drizzle.config.ts`, `tests/**`. Motivazione: la lettera della
regola ("solo da `lib/engine/**`") è incompatibile con PLAN §15, che mostra `lib/auth.ts` che
interroga il database, e col seed di §15 che deve scriverci. L'intento della regola sono le
regole 3 e 4, cioè lo **stato dell'asta**: è da `app/**` e `components/**` che la scorciatoia
farebbe danno, e lì il divieto è pieno e verificato. Ogni eccezione è una riga di elenco, quindi
aggiungerne una si vede nel diff.

**Tutti gli accessi alla tabella `users` in `lib/auth.ts`.** Compreso `setDisplayName`, che è una
scrittura di profilo e non di autenticazione. Motivazione: PLAN §10 non prevede un `lib/users.ts`,
e le quattro operazioni sulla tabella (upsert da Google, rilettura per la sessione, scrittura del
nome, lista degli utenti dev) sono tutte al servizio dell'identità. Un modulo in più sarebbe
un'astrazione prima del secondo chiamante (regola 8).

**`display_name` non viene mai preso dal profilo Google.** All'upsert resta `NULL` e lo scrive
l'utente nell'onboarding; il nome Google serve solo a precompilare il campo. Motivazione: PLAN §2
richiede che nome e cognome siano compilati al primo accesso, e se li deducessimo da Google il
cancello dell'onboarding non scatterebbe mai — il criterio ✅ della Fase 0 sarebbe indimostrabile.

**`google_sub NULL` distingue gli utenti di prova.** Gli utenti creati dal seed non hanno
`google_sub`; è il filtro con cui la pagina di login costruisce la lista "Entra come …" e la
condizione che il provider `dev` verifica prima di aprire una sessione (un account Google vero non
è impersonabile). L'indice unico su `google_sub` ammette più NULL, quindi non serve altro.

**Nessun `middleware.ts` in Fase 0.** Il cancello dell'onboarding è una guardia server-side
(`requireUser()`) chiamata dalle pagine, non un middleware. Motivazione: il middleware girerebbe
su runtime edge, dove `node-postgres` non esiste; farlo funzionare richiederebbe di spezzare la
configurazione Auth.js in due file, o il runtime Node sperimentale. La guardia nelle pagine dà lo
stesso risultato osservabile.

**Sessione JWT: nel token solo l'id utente.** Nome e `is_admin` si rileggono dal database a ogni
richiesta (`currentUser()`), non si portano nel token. Motivazione: è la ratifica pratica di P17 —
lo stesso account su due dispositivi vede le stesse informazioni, e il nome scritto
nell'onboarding ha effetto subito senza rifare il login.

**`pnpm dev:lan` è uno script, non `next dev -H 0.0.0.0`.** Con Next in ascolto su `0.0.0.0`
l'URL che arriva ai route handler ha per host `0.0.0.0`, e Auth.js ci costruisce sopra i redirect:
dal telefono, dopo il login, si finisce su `http://0.0.0.0:3000/`, che non esiste.
`scripts/dev-lan.ts` trova l'IP di LAN, lo passa come `AUTH_URL` e lo stampa a video. Motivazione:
il collaudo da telefono vero è un criterio di chiusura della Fase 5, e questo bug si sarebbe
manifestato proprio lì.

**`vitest` fissato a `~4.0.6`.** La 4.1 tira `vite@8.2`, che dipende da un `lightningcss` non
ancora pubblicato: `pnpm install` fallisce. La 4.0 usa `vite@7` e non ha il problema. Da
rimuovere quando la catena a monte si sistema.

**`drizzle-kit` con `strict: false`.** Con `strict: true` `pnpm db:push` chiede conferma statement
per statement e serve un TTY, quindi non è usabile da script. `verbose` resta attivo: l'SQL si
vede comunque prima di essere eseguito.

---

## 2026-08-07 — Fase 1, setup asta

**`lib/domain.ts` per il vocabolario condiviso.** `ROLES`, `Role`, `ROLE_LABELS`,
`AUCTION_STATUSES`, `AUCTION_PHASES`, `SEAT_OPTIONS` non stanno in `lib/db/schema.ts` ma in un file
senza dipendenze; `schema.ts` li importa da lì. Motivazione: due vincoli che si sono incontrati.
(1) La regola ESLint su `lib/db` deve restare **assoluta**: una pagina che importa quattro stringhe
non fa danno, ma nessun linter la distingue da una che apre una query, e la regola vale proprio
perché non ammette eccezioni discrezionali. (2) `schema.ts` tira dentro `drizzle-orm/pg-core`:
importarlo da un componente `"use client"` per quattro stringhe farebbe viaggiare un ORM fino al
telefono. Nessuna eccezione aggiunta a `eslint.config.mjs`.

**`withSetupLock` distinta da `withAuctionLock`.** Le mutazioni di setup (create, update, import,
toggle, invite, join, remove) prendono un `SELECT ... FOR UPDATE` sulla riga dell'asta tramite una
funzione locale a `lib/engine/setup.ts`, non tramite il `withAuctionLock` di PLAN §6 — che arriverà
in F3-02. Motivazione: il lock serve già adesso (due join simultanei si assegnerebbero lo stesso
`seat_index`), ma `withAuctionLock` incrementa `state_version` e fa il broadcast dello snapshot,
due cose che in DRAFT/READY non esistono: non c'è nessuno stream aperto né macchina a stati da far
avanzare. Anticiparlo a metà avrebbe reso ambiguo cosa resta da fare in F3-02.

**Setup diviso fra `setup-rules.ts` (puro) e `setup.ts` (database).** Le validazioni —
configurazione, permutazione di `role_order`, I9, nome squadra — sono funzioni pure in un file che
non importa `lib/db`. Motivazione: sono collaudabili senza Postgres acceso, ed è la stessa
disciplina che in Fase 2 governerà `rules.ts`. Non è un layer in più (regola 8): è dove passa la
linea fra ciò che si può provare in millisecondi e ciò che ha bisogno di un database.

**Test di integrazione con Postgres vero, saltati se il database non risponde.**
`tests/db/setup.test.ts` gira contro il database reale e si auto-salta con un avviso se non è
raggiungibile. Motivazione: metà di ciò che c'è da verificare nel setup *è* il database (unicità di
`(auction_id, seat_index)`, ricompattazione dei posti sotto vincolo, serializzazione del lock) e un
mock direbbe sempre di sì; ma `pnpm test` deve restare eseguibile da un checkout pulito senza
Docker. Il gate di fase si verifica con Docker acceso — è nel runbook. Vitest carica `.env` da
`vitest.setup.ts`, e i test di integrazione chiamano `vi.useRealTimers()` perché `pg` fa I/O vero.

**`FormState` e `EMPTY_FORM_STATE` fuori dal file delle Server Action.** Stanno in
`app/auctions/form-state.ts`. Motivazione: **un modulo `"use server"` può esportare soltanto
funzioni async**. Esportare da lì anche una costante compila, passa `tsc` e passa pure
`next build` — poi restituisce 500 alla prima invocazione reale dell'azione. Trovato col test di
fumo end-to-end, non dai controlli statici: è il motivo per cui il gate di questa fase include un
giro vero sulle pagine e non solo `pnpm test`.

**SheetJS installato dal CDN ufficiale, non da npm.** `xlsx` è agganciato a
`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`. Motivazione: l'ultima versione pubblicata su
npm è la 0.18.5, ferma da anni e con vulnerabilità note (prototype pollution, ReDoS); SheetJS
distribuisce le versioni correnti solo dal proprio CDN. Il file lo carica l'owner dell'asta, quindi
il rischio sarebbe modesto, ma non c'è ragione di portarsi dietro codice vulnerabile. Il tarball
finisce nel lockfile e viene messo in cache da pnpm.

**Timer: minimi bassi invece che valori "ragionevoli".** `bid ≥ 3s`, `pick ≥ 3s`, `tiePrep ≥ 2s`,
`reveal ≥ 1s`. Motivazione: le aste di prova nascono dal seed con timer corti (DECISIONS
2026-08-06, niente `DEV_TIME_SCALE`), quindi il motore deve accettare quei valori senza rami
dipendenti dall'ambiente.

**Il budget non può essere inferiore al numero di slot.** `createAuction` rifiuta
`budget_default < slot totali`. Motivazione: I3 richiede che ogni slot residuo resti comprabile ad
almeno 1 credito; con un budget più basso la rosa non si completerebbe nemmeno comprando tutti a 1,
e l'asta nascerebbe già in uno stato impossibile.

**`ON DELETE CASCADE` su tutte le chiavi verso `auctions`.** Compresi `assignments` e `ledger`.
Motivazione: la regola 5 vieta `DELETE` e `UPDATE` **distruttivi come correzione** dentro un'asta
viva — lì si usano `voided_at` e righe compensative. Cancellare un'asta intera è un'altra cosa, ed
è richiesta dalla checklist pre-asta di PLAN §17 (punto 3: rimozione dell'asta di prova). Senza le
cascate quella cancellazione andrebbe scritta a mano tabella per tabella.

**`auctions.current_lot_id` senza FOREIGN KEY.** `lots.auction_id` punta già ad `auctions`: la
coppia di vincoli renderebbe circolare sia la creazione dello schema sia la cancellazione di
un'asta. PLAN §3 non la dichiara.

**Il seed costruisce le aste chiamando le funzioni dell'applicazione.** Niente `INSERT`
artigianali: `createAuction`, `importPlayers`, `createInvite`, `joinAuction`. Motivazione: uno
stato prodotto dal seed è per costruzione uno stato che l'app sa produrre. È la stessa regola che
F3-13 impone per gli stati avanzati, applicata da subito. Effetto collaterale utile:
`--auction-status=draft` ottiene DRAFT lasciando un posto vuoto invece di impostare la colonna,
quindi ogni seed verifica di passaggio la derivazione DRAFT ↔ READY.

**L'owner entra con una funzione dedicata, `joinAsOwner`.** Non passa da un invito. Motivazione:
l'owner ha già i permessi sull'asta e mandarlo a cercare il proprio link sarebbe assurdo; le due
funzioni condividono l'inserimento vero (`addMember`), quindi le regole su posti, nome squadra e
budget sono le stesse per tutti.

**Il nome dell'asta è modificabile solo in DRAFT/READY.** PLAN §9 non lo classifica. Trattato come
strutturale: ad asta iniziata il nome è già proiettato sulla TV e ripetuto a voce.

---

## 2026-08-07 — Fase 2, motore puro

**Il tempo nel motore è un numero (epoch ms), gli id sono un contatore.** `AuctionState` non
contiene `Date` e il motore non genera uuid: il tempo è `number` come lo produce `getTime()`, e le
entità create dal motore (lotti, offerte, assegnazioni) prendono id numerici sequenziali da
`state.nextId`. Motivazione: una funzione pura non può inventare valori casuali, e il tie-break
`MIN(bids.id)` di PLAN §4 deve essere riproducibile nei test. Il mapping fra id del motore e uuid
del database è un problema di F3-01, non del motore.

**Un no-op restituisce lo stesso riferimento.** `transition` che non ha effetto (ADVANCE in
anticipo o su fase già avanzata, conferma della stessa cifra, pause/resume ripetuti) restituisce
`ok(state)` con lo **stesso oggetto**, non una copia. Motivazione: è il segnale meccanico con cui
F3 distinguerà le mutazioni vere (bump di `state_version` + broadcast) dai no-op (P14) — un
`===` invece di un confronto profondo.

**Ad asta in PAUSED le azioni di gioco sono rifiutate.** PLAN §4 dice solo che la pausa congela i
deadline; pick/bid/withdraw durante la pausa non sono contemplati. Rifiutati con `WRONG_STATUS`:
i countdown sono congelati e le scadenze traslate al resume, quindi un'offerta accettata in pausa
verrebbe validata contro un `ends_at` che sta per muoversi. `ADVANCE` in pausa è un no-op (lo
sweep di F3 seleziona comunque solo `status='LIVE'`). Pause su PAUSED e resume su LIVE sono
no-op: il doppio click dell'owner non deve poter fare danni.

**Il resume trasla anche l'`ends_at` del round aperto,** oltre a `phase_deadline` (PLAN §4 nomina
solo quest'ultima). È l'`ends_at` la scadenza contro cui `placeBid` valida (§12.30): senza la
traslazione, dopo una pausa lunga il round risulterebbe scaduto per le offerte ma vivo per la fase.

**Anche il ritiro è guardato da `ends_at`.** `withdrawBid` dopo la scadenza → `ROUND_CLOSED`,
simmetrico alle offerte: fra la scadenza e lo sweep che chiude il round, un ritiro accettato
cambierebbe un esito già determinato dalle buste a DB.

**`PICK` non è guardato dalla deadline.** Un pick che arriva dopo `phase_deadline` ma prima che
lo sweep faccia scattare l'auto-pick viene accettato (la fase è ancora WAITING_PICK). Motivazione:
il pick manuale in extremis è l'esito che il chiamante voleva; il conflitto con l'auto-pick è
risolto in F3 dalla serializzazione di `withAuctionLock`, non da un confronto di orologi.

**`START` è una transizione del motore.** `READY → LIVE` sta in `machine.ts` (evento `START`),
non solo nell'action di F3-04: PLAN §4 la elenca fra le transizioni, e il test §12.21 la esercita
puro. Il gate presence "tutti i membri LIVE" resta fuori dal motore — è un fatto di heartbeat e lo
aggiunge F4-06 nell'action.

**Codici d'errore di gioco anticipati a Fase 2.** F3-03 prevedeva l'enum dei codici; il motore
puro rifiuta già con errori tipizzati, quindi i codici (`NOT_YOUR_TURN`, `BID_TOO_HIGH`,
`ROUND_CLOSED`, …) sono nati in `errors.ts` ora. F3-03 li porterà alle action senza inventarne di
nuovi. `WITHDRAW_FORBIDDEN` è un codice unico per i tre divieti di ritiro (chiamante, round 2,
nessuna offerta): la UI li disabilita comunque a monte e i messaggi restano distinti.

**Il lotto da unico idoneo ha comunque il suo round 1, già chiuso.** Nella chiusura immediata
(DECISIONS 2026-08-06, §12.41) il round esiste con l'auto-bid a 1 e `closed_at = ends_at = now`:
il pannello di reveal della Fase 5 mostra le buste di ogni lotto senza un caso speciale.

**Il carry-forward crea righe nuove.** Le offerte copiate nel round 2 hanno id nuovi e
`created_at` dell'apertura del round; solo `amount_set_at` è preservato dal round 1 (è l'unico
campo che PLAN §4 richiede di ereditare, ed è quello che decide gli stalli).

---

## 2026-08-07 — Fase 3, persistenza e timer

**Gli id del motore sono etichette di caricamento, non identità persistite.** Ogni
`loadAuctionState` li assegna da un contatore in ordine di lettura e tiene la mappa verso gli
uuid in `refs`; valgono per il ciclo load → transition → persist corrente e non escono mai dal
processo. Due load consecutivi dello stesso database producono lo stesso identico stato; il load
*dopo* una transizione produce uno stato **equivalente** (stessi fatti, etichette diverse), ed è
questa l'equivalenza che il test di roundtrip verifica. Motivazione: persistere la numerazione
avrebbe richiesto colonne in più senza guadagno — niente nel dominio dipende dal valore degli id
(il tie-break `MIN(bids.id)` scatta solo a parità esatta di timestamp, e a quel punto qualunque
ordinamento stabile è ugualmente arbitrario).

**La persistenza è una diff per riferimento.** Il motore non muta mai lo stato: ciò che cambia è
un oggetto nuovo lungo il cammino della modifica, ciò che non cambia è lo stesso riferimento.
`persistTransition` confronta con `===` e tocca solo le righe davvero cambiate; il no-op
(`next === prev`) non scrive niente ed è il segnale P14 per non bumpare `state_version`.

**`now` è un parametro anche nelle azioni.** `startAuction`, `placeBid`, `advancePhase` ecc.
accettano un `now: Millis` opzionale (default `Date.now()`). Motivazione: è la stessa disciplina
del motore portata un livello più su — i test integrano "resume dopo 5 minuti" senza dormire
5 minuti, e il seed degli stati avanzati inietta un orologio virtuale. In produzione nessuno
passa il parametro.

**`withAuctionLock` carica lo stato e chiede `mutated` esplicito.** La firma è
`fn(tx, loaded) → { result, mutated }`: ogni utilizzatore del lock ha comunque bisogno dello
stato del motore, quindi il caricamento sta dentro il lock; e la decisione bump/broadcast (P14)
è dichiarata dal corpo, non dedotta. Il broadcast è un hook settabile che oggi non fa niente:
la Fase 4 lo aggancerà allo stream SSE, ma il punto da cui parte — dopo il commit, solo su
mutazione — è già quello definitivo.

**Lo scheduler non importa le azioni.** `createScheduler(advance)` riceve la funzione di
avanzamento da chi lo avvia (`instrumentation.ts` gli passa `advancePhase`; i test un mock).
Motivazione: evitare il ciclo di import azioni ↔ scheduler; in cambio `syncTimer` — il riarmo a
valle di ogni mutazione — è un no-op nei processi senza scheduler (seed, test), dove non c'è
nessuno che debba far scorrere il tempo. Corollario osservato col driver: **due processi con lo
sweep attivo sulla stessa base dati si pestano i piedi senza farsi male** (I7 + lock rendono i
doppi ADVANCE innocui), ma il design resta un processo solo — non farci affidamento.

**Il driver non chiama mai `advancePhase`.** `pnpm drive` avvia lo scheduler in-process e
impersona solo i partecipanti (pick, offerte, ritiri): se l'asta arriva a COMPLETED è perché
timer e sweep funzionano. È il criterio ✅ di fase esercitato con i pezzi veri.

**Seed avanzato: simulazione pura, persistenza in blocco, timestamp traslati.**
`--auction-status=live|mid|completed` gioca l'asta col motore puro su un orologio virtuale che
salta di deadline in deadline (duecento lotti in millisecondi), poi persiste il risultato con
un'unica `persistTransition` dentro `withAuctionLock`, dopo aver traslato tutti i timestamp così
che l'ultima transizione cada su "adesso" — un'asta `mid` riparte con un countdown pieno, non
già scaduta. Conseguenza dichiarata: la storia lotto-per-lotto in `events` non esiste per la
parte simulata; una riga `SEED_FAST_FORWARD` lo documenta. Un'asta `mid` con l'app accesa
**continua da sola** (auto-pick coi timer corti): è LIVE per davvero, come da backlog.

**`events.payload` è `{from, to, lotId, actor}`.** `from`/`to` sono posizioni compatte
(`LIVE/LOT_OPEN`, `READY`, `COMPLETED`); `actor` è l'utente che ha agito o `"system"` per le
transizioni del tempo; `lotId` è il lotto toccato (quello corrente dopo la transizione o, quando
la transizione lo archivia, quello di prima). La riga JSON su stdout ha gli stessi campi più
`auctionId`, `type` e `ts` (PLAN §17).
