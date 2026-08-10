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

---

## 2026-08-07 — Fase 4, SSE e snapshot

**I tipi dello snapshot in `lib/realtime/types.ts`, la funzione in `lib/engine/snapshot.ts`.**
Il tipo `Snapshot` lo importa anche il client, e `lib/engine/snapshot.ts` importa `lib/db`: tenerli
insieme significherebbe o un `import type` dal bundle del telefono verso l'ORM, o un'eccezione alla
regola ESLint. È la stessa scelta di `lib/domain.ts` (DECISIONS 2026-08-07, Fase 1) applicata al
protocollo. `lib/realtime/types.ts` non dipende da niente tranne `lib/domain.ts`.

**`serializeSnapshot` prende il bundle di `loadAuctionState`, non il solo `AuctionState`.**
La firma di PLAN §8 è `serializeSnapshot(auctionState, viewerMemberId)`; quella vera è
`serializeSnapshot(loaded, viewerMemberId, now)`. Servono tre cose che il motore puro non ha e non
deve avere: la riga `auctions` (nome e `state_version`), la mappa `refs` (gli id del motore sono
etichette di caricamento — verso il client devono uscire **uuid**, altrimenti il
`dismissedLotId` di §8bis punterebbe a un numero diverso a ogni load) e i nomi (squadra, giocatore)
con la telemetria di presence. Il vincolo della regola 3 — **un solo punto di uscita** — resta
intatto, che è ciò che il test I8 verifica.

**`LoadedAuction.view`: nomi e presence accanto allo stato, non dentro.** `loadAuctionState`
restituisce anche `view.members` (nome squadra, `display_name`, `last_seen_at`, `is_visible`) e
`view.players` (nome, squadra). `AuctionState` resta senza: al motore «Lautaro» non serve, e i test
puri continuano a costruire un giocatore con cinque campi. Costo: una `INNER JOIN users` in più a
ogni caricamento.

**Lo snapshot dice anche `withdrawn` e `tie`, che PLAN §8 non elenca.** Due aggiunte, entrambe
richieste dalla regola 7 (ogni schermata è funzione pura dello snapshot): `myBid.withdrawnAt` e
`bidStatus[].withdrawn`, senza i quali un partecipante che ha ritirato non saprebbe perché non può
più offrire; e `currentLot.tie` (importo pareggiato + chi ha pareggiato), popolato **solo** in
`LOT_TIE_PREP`, senza il quale il rientro durante lo spareggio previsto da §8bis mostrerebbe un
countdown senza dire di cosa. Non è una deroga a I8: quell'importo è il contenuto dell'annuncio di
spareggio e fra due secondi sarà il `min_amount` pubblico del round 2.

**La TV entra col `public_token` in query string.** `GET /api/auctions/:id/stream?token=…`: la
vista proiettabile non ha login (PLAN §10, `/tv/[publicToken]`), quindi il token nell'URL *è* la
sua autenticazione. `resolveViewer` (`lib/engine/viewer.ts`) distingue i tre spettatori —
partecipante, manager, TV — e restituisce il `viewerMemberId` per cui sanificare: solo il
partecipante ne ha uno.

**Esiste `POST /api/auctions/:id/action`, non previsto da PLAN §10.** PLAN §9 lascia la scelta fra
Server Action e Route Handler; qui serve un endpoint HTTP per una ragione concreta. I bot sono
client veri, e se agissero chiamando il motore nel proprio processo le loro mutazioni non
passerebbero dal processo del server: il broadcast parte da chi scrive, quindi nessun browser
collegato vedrebbe muoversi niente — e guardare il proprio portale mentre gli altri offrono è
esattamente il motivo per cui i bot esistono. L'endpoint è un dispatcher senza logica (START,
PICK, BID, WITHDRAW → le azioni di `lib/engine/actions.ts`) e non restituisce stato: quello arriva
dallo snapshot. La Fase 5 può usarlo al posto di una Server Action per il pulsante di offerta —
sotto un countdown di 30 secondi una `fetch` con codice d'errore tipizzato è più maneggevole.

**I singleton di processo stanno su `globalThis`.** Il registro delle connessioni SSE, l'hook di
broadcast e la memoria della presence annunciata. Next compila `instrumentation.ts` (da cui parte
lo scheduler) e i route handler (da cui si aprono le connessioni) in **bundle separati**: con una
variabile di modulo esisterebbero due copie di ciascun file, le connessioni finirebbero nel
registro dove nessuno fa broadcast e l'hook sarebbe impostato solo nella copia dello scheduler.
Sintomo osservato: stream aperto, snapshot iniziale corretto, poi silenzio per tutta l'asta.
È la generalizzazione della guardia `globalThis.__scheduler` già presente (PLAN §16.8).

**`serverExternalPackages: ["pg"]` e gli import dentro l'`if` in `instrumentation.ts`.** Bug della
Fase 3 scoperto qui: **l'app non partiva affatto**, ogni pagina rispondeva 500 con
`Can't resolve 'fs'` da `pg`. Una guardia `if (process.env.NEXT_RUNTIME !== "nodejs") return;` a
inizio funzione non è eliminabile come ramo morto — il bundler compilava `pg` anche nel bundle
edge. Gli import dinamici vanno **dentro** un `if (process.env.NEXT_RUNTIME === "nodejs") { … }`.
Non era emerso in Fase 3 perché quei criteri si verificano da terminale (`pnpm test`, `pnpm drive`)
e nessuno aveva ancora aperto una pagina con lo scheduler registrato.

**Il broadcast dei cambi di presence è coalescato a 1 secondo, e parte solo se cambia qualcosa.**
⚠ P8: dodici heartbeat ogni dieci secondi sono più di un evento al secondo. `recordHeartbeat`
scrive le due colonne fuori dal lock, poi confronta la mappa di presence derivata con **l'ultima
annunciata**: se differisce, il route handler mette in coda un invio (uno solo per finestra). Il
confronto con l'ultima annunciata — invece che con il "prima" dello stesso heartbeat — è ciò che
fa accorgere di chi ha *smesso* di battere il colpo: nessun evento lo segnala, ma il primo
heartbeat altrui che arriva dopo la scadenza dei 15 secondi se ne accorge. Se nessun membro è più
collegato, nessuno se ne accorge: non c'è più nessuno a cui dirlo.

**Il gate presence vale per test, seed e driver come per tutti.** `startAuction` rifiuta con
`MEMBERS_NOT_READY` se un membro non è LIVE (⚠ P11: solo i membri; l'owner che non gioca non
conta). Di conseguenza `makeGameAuction` e `pnpm drive` battono gli heartbeat dei membri che
impersonano, invece di avere una scorciatoia per saltare il cancello: chi simula la stanza simula
anche i telefoni accesi.

---

## 2026-08-07 — Fase 5, portale partecipante

**Le derivazioni del portale sono funzioni pure, in `lib/realtime/portal.ts`.** Quale schermata
mostrare (`portalScreen`), se il modale deve aprirsi (`shouldOpenBidDialog`), quanto si può offrire
(`bidBounds`/`checkAmount`), se si può ritirare (`canWithdraw`), chi è ancora chiamabile
(`availablePlayers`): tutto fuori dai componenti. Motivazione: la regola 7 dice che ogni schermata è
funzione pura dello snapshot; se è vero, quelle domande *sono* funzioni pure, e i cinque casi di
rientro di §8bis diventano test automatici invece di una checklist da rifare a mano ogni volta.
`vitest` gira in ambiente `node`, senza DOM, quindi la logica deve stare in un `.ts` per essere
raggiungibile. Non è un layer in più (regola 8): è dove passa la linea fra ciò che si prova in
millisecondi e ciò che va guardato con gli occhi.

**Il listone non viaggia nello snapshot.** La schermata di chiamata ha bisogno dei nomi dei
giocatori; `listPickPool` (in `lib/engine/setup.ts`, accanto a `listPlayers`) li serve alla pagina
una volta sola, già filtrati dei fuori lista se l'asta li esclude. Motivazione: sono ~500 righe
immutabili dall'import in poi e senza niente da sanificare — replicarle a ogni transizione per
dodici viewer moltiplicherebbe per venti il costo del canale (uno snapshot costa 23 KB). Non è una
deroga alla regola 3, che protegge lo **stato dell'asta**, non l'elenco dei calciatori di Serie A.
E **quali** giocatori siano liberi resta funzione dello snapshot: le rose ci sono dentro, e il
client sottrae. Una query "giocatori disponibili" sarebbe stata una seconda fonte di verità sullo
stesso fatto.

**`PoolPlayer` sta in `lib/realtime/types.ts`.** È un tipo del protocollo server → client come lo
`Snapshot`, e va dove stanno i tipi che attraversano il confine.

**Il countdown si congela in pausa con `pausedRemaining(deadline, pausedAt)`.** PLAN §4 dice che il
resume trasla le scadenze, ma solo al resume: durante la pausa `phase_deadline` è ancora quella di
prima, e un countdown che sottrae `now` scorrerebbe a zero ad asta ferma — mostrando "in chiusura…"
per tutta la durata della pausa. Il residuo giusto è quello dell'istante della pausa, e lo snapshot
lo dice.

**Nessun aggiornamento ottimistico dello stato dell'asta.** Il feedback immediato riguarda
l'**invio** («✓ Offerta salvata: 9», dalla risposta della `fetch`); il **mondo** lo riscrive solo lo
snapshot successivo. Motivazione: un'offerta scritta a mano nello state locale sarebbe un secondo
posto dove vive la verità, e al primo snapshot in ritardo la schermata mostrerebbe una cifra che il
server non ha. Il requisito del piano («feedback di salvataggio immediato e inequivocabile») è
soddisfatto senza duplicare lo stato.

**`max_bid` degli altri è pubblico.** Lo snapshot lo porta per ogni membro e il portale lo mostra.
Non è una deroga a I8: I8 riguarda l'**importo di un'offerta in busta chiusa**, mentre il tetto si
calcola da crediti e slot, che sono entrambi pubblici per costruzione (PLAN §5, I5). Sapere che il
vicino può arrivare a 12 e non a 120 è metà del gioco.

**Il modale si apre anche a offerta ritirata.** La condizione di §8bis è presa alla lettera
(`LOT_OPEN && idoneo && dismissedLotId !== lotId`), e in quel caso il modale spiega perché non si
può più offrire. Motivazione: chi rientra dopo essersi ritirato deve trovare la spiegazione, non un
pulsante inerte; e nel flusso normale il modale è già aperto quando si ritira, quindi non "riappare"
mai a sorpresa. In pausa invece **non** si apre: il server rifiuterebbe l'offerta.

**PAUSE e RESUME anticipate nel dispatcher di `POST /api/auctions/:id/action`.** Il loro posto è il
portale manager (Fase 6). Motivazione: la vista in pausa del partecipante (F5-11) è un task di
questa fase, e senza un modo di mettere in pausa l'asta sarebbe codice che nessuno ha mai visto
funzionare. Le due azioni verificano da sé la proprietà dell'asta, quindi non è un allentamento dei
permessi.

**Il banner globale sta nel layout radice, e il layout radice ora legge la sessione.**
«Presente su tutte le pagine, dashboard inclusa» significa tutte, quindi l'unico posto è
`app/layout.tsx`; il costo è una lettura di sessione e una query per pagina, con dodici utenti
irrilevante. Chi non è autenticato non ha aste e la query non parte. Il banner si nasconde sul
portale di quell'asta tramite `usePathname` — che vale già in SSR, quindi non compare nemmeno per un
istante.

**`viewport.interactiveWidget = "resizes-content"`, e nessun `maximumScale`.** Senza il primo, su
Android la tastiera *copre* la pagina invece di rimpicciolirla e `100dvh` continua a valere lo
schermo intero: il modale d'offerta finirebbe per metà sotto i tasti. Il secondo non c'è di
proposito — bloccare lo zoom è una scortesia verso chi non vede bene, e il campo dell'importo è già
a 16px, la soglia sotto la quale iOS zooma da sé.

**La lobby batte l'heartbeat e porta su `/play` all'avvio.** Il cancello di `startAuction` pretende
tutti i membri in presence LIVE, e la presence nasce da una pagina aperta: senza una pagina che la
alimenti prima dell'avvio, quel cancello non si passa. Ed è l'unica navigazione automatica
dell'applicazione: la decisione la prende lo snapshot (`status === 'LIVE'`), non un evento ricevuto,
quindi chi apre la lobby ad asta già iniziata viene spostato allo stesso modo al primo snapshot.

**Niente `components/ui/dialog.tsx`.** Il modale d'offerta usa direttamente le primitive
`Dialog` di `radix-ui`, con le classi dello sheet dal basso. Motivazione: regola 8 — un wrapper
generico avrebbe un solo chiamante, e le scelte che contano qui (ancoraggio in basso, `max-h-dvh`,
`env(safe-area-inset-bottom)`, intestazione con countdown e `max_bid`) non sono generalizzabili a un
dialogo qualunque. Quando la Fase 6 o la 7 avranno il loro secondo modale, allora si vedrà.

**`ROLE_LABELS_ONE` accanto a `ROLE_LABELS` in `lib/domain.ts`.** Le etichette del piano sono
plurali ("Portieri") e in una frase servono al singolare ("chiama un portiere"). È vocabolario di
dominio, quindi sta nel file del vocabolario.

**Il font: `--font-sans` mappato su `var(--font-geist-sans)`, e le classi su `<html>`.** Bug della
Fase 0 scoperto qui: tutta l'app rendeva col serif di default del browser. `@theme inline`
**inlinea il valore** invece di emettere una variabile in `:root`, quindi
`--font-sans: var(--font-sans)` faceva risolvere a runtime una custom property che nessuno
definisce — `font-family` invalida, e ripiego sul default. In più le variabili di `next/font`
stavano sulla `className` del `<body>` mentre `font-sans` è applicato a `<html>`: una custom
property non risale dal figlio al padre, quindi anche con la mappatura giusta sarebbe rimasto
rotto. Il mono funzionava da sempre perché la sua riga era già scritta bene. Non era emerso prima
perché i criteri delle Fasi 0–4 si verificano da terminale, e la prima fase con un occhio sulla
tipografia è questa.

**Il gate della Fase 5 chiuso con due dispositivi invece di quattro browser.** PLAN §11 chiede
«un'asta a 4 partecipanti su 4 browser reali»; il collaudo del 2026-08-08 è stato fatto con **un
telefono e un browser sul Mac**, più sei bot sugli altri posti. Motivazione: quel criterio esiste
per scovare il **desync**, e quattro finestre sulla stessa macchina condividono lo stesso orologio —
è proprio la condizione in cui il bug che il criterio cerca non si manifesta. Due dispositivi
distinti hanno orologi distinti, ed è lì che l'offset di `serverNow` viene messo alla prova per
davvero. La sostituzione è quindi più severa della lettera, non più blanda. Resta non provato il
caso "quattro client contemporanei" come carico, che però la Fase 4 aveva già esercitato con otto
bot collegati via SSE.

**L'avvio dell'asta di prova parte dal posto del collaudatore.** `startAuction(startSeatIndex)` lo
permette già; i bot avviano sempre dal posto 0. Nel collaudo si lancia quindi `pnpm bots` **senza**
`--start` e si manda lo START dalla console del browser dell'owner con il proprio seat. Motivazione:
con due soli posti umani su otto, la rotazione farebbe arrivare il turno di chiamata dopo sei lotti,
e la schermata di chiamata è quella che più vale la pena guardare per prima. Procedura in
`docs/RUNBOOK.md`.

---

## 2026-08-08 — Fase 6, portale manager e vista TV

**Le derivazioni del manager sono funzioni pure, in `lib/realtime/manage.ts`.** «Si può avviare?»
(`managerControls`), «chi manca all'appello?» (`absentMembers`, `presenceAlert`), «quanto ha
speso?» (`spentCredits`) stanno fuori dai componenti, esattamente come le derivazioni del portale
in `portal.ts`. Motivazione: è la stessa di Fase 5 — se ogni schermata è funzione dello snapshot
(regola 7), quelle domande *sono* funzioni pure e si provano in millisecondi; e il cancello
d'avvio, che è la cosa più facile da sbagliare di tutta la pagina, diventa una tabella di casi
invece di una condizione dentro un `disabled`. Non è un layer in più (regola 8): è la stessa linea
già tracciata fra ciò che si prova senza browser e ciò che va guardato con gli occhi.

**`spentCredits` invece di portare `budget_initial` nello snapshot.** Il recap mostra «crediti ·
speso · max», ma lo speso non è un campo nuovo del protocollo: è la somma dei prezzi della rosa,
che nello snapshot c'è già. Motivazione: `speso + crediti = budget` è anche l'identità con cui si
controlla a colpo d'occhio che i conti tornino (I3); aggiungere una colonna al canale per un numero
derivabile sarebbe stata una seconda fonte di verità sullo stesso fatto.

**`phaseLabel` promossa a funzione condivisa.** Era una funzione privata dell'intestazione del
portale («dove siamo, in tre parole»); ora sta in `lib/realtime/portal.ts` e la usano in tre —
portale, regia, TV. Motivazione: regola 8 al contrario, cioè il secondo chiamante è arrivato. Lo
stesso vale per `tests/snapshot-factory.ts`, estratto da `portal.test.ts` quando i test della Fase 6
hanno avuto bisogno degli stessi oggetti di prova.

**Il portale manager batte l'heartbeat, ma solo se l'owner è anche membro.** ⚠ P11: l'owner
tipicamente joina come partecipante, e in quel caso conduce la serata da `/manage` mentre gioca dal
telefono. Senza heartbeat da questa pagina, un owner che *non* tiene aperto anche il portale
risulterebbe OFFLINE e il cancello d'avvio rifiuterebbe l'asta **per colpa di chi la sta avviando**.
L'owner che non gioca non ha una riga `members` e l'endpoint lo rifiuterebbe, quindi l'heartbeat
parte solo quando ha senso.

**La regia mostra una striscia sul lotto in corso, non un pannello di reveal.** PLAN §11 assegna
alla TV il «lotto in corso + countdown + reveal»; qui c'è solo una riga — giocatore, chi ha
chiamato, buste consegnate, countdown. Motivazione: serve a rispondere a «è il momento di premere
pausa?», che è una domanda che «siamo a metà di un round con tre buste su otto» risolve e «l'asta è
LIVE» no. Duplicare il reveal avrebbe significato due schermate da tenere allineate per la stessa
informazione.

**L'alert di presence distingue chi è caduto da chi è in secondo piano.** OFFLINE in rosso («al suo
turno scatta la chiamata automatica, le sue offerte si fermano a 1»), IDLE in ambra. Motivazione:
sono due telefonate diverse — uno è uscito dalla stanza, l'altro ha aperto Instagram — e il rimedio
è diverso. Resta valido §7: **nessuna pausa automatica**, e il banner lo dice esplicitamente perché
è la prima domanda che viene in mente leggendolo.

**La vista TV non segue il tema: bianco su nero, fisso.** È l'unica pagina dell'applicazione che
ignora `prefers-color-scheme`. Motivazione: un televisore non ha una preferenza di sistema, e un
tema chiaro proiettato in una stanza al buio è illeggibile — la scelta non è dell'utente, è del
mezzo. Le dimensioni vengono da un conto e non dall'occhio: a 1080p su un 50" un pixel vale ~0,57 mm
e la regola pratica della leggibilità chiede un carattere alto un 150-esimo della distanza (~2,7 cm
a quattro metri, cioè ~47 px), da cui la soglia «nessun dato sotto i 36 px» e i 128–144 px di nome
del giocatore, countdown e prezzo di aggiudicazione.

**`auctionByPublicToken` sta in `lib/engine/viewer.ts`, e la pagina TV è `noindex`.** La
risoluzione del token vive accanto a `resolveViewer`, che è già il posto in cui si decide chi sta
guardando e con quali diritti; è anche l'unica lettura a database che la vista TV fa. Un token
inesistente e un'asta inesistente danno la stessa risposta (404), e la pagina dichiara
`robots: noindex, nofollow`: un URL che *è* l'autenticazione non si lascia indicizzare.

---

## 2026-08-08 — Fase 7, override e chiusura

**Gli override non sono transizioni della macchina a stati.** `manualAssign`, `voidAssignment` e
`adjustBudget` stanno in `lib/engine/override.ts` e scrivono direttamente su `assignments` e
`ledger` dentro `withAuctionLock`; non passano da `transition` e non hanno un evento in
`AuctionEvent`. Motivazione: non hanno un istante che le fa scattare, non spostano la fase e non
producono uno stato successivo — sono scritture puntuali su due tabelle. Era anche già la
posizione presa in Fase 3, scritta nel commento di `persistTransition`: «le correzioni manuali
sono azioni di Fase 7, non transizioni». Le *invarianti* però restano funzioni pure in `rules.ts`
(`canManualAssign` accanto a `canAdjustBudget`, che la Fase 2 aveva già scritto aspettando
questa), quindi si provano in millisecondi come tutto il resto del motore.

**Il prezzo di una `manualAssign` è un intero ≥ 1.** PLAN §9 non dà un minimo. Uno vale il
pavimento di qualunque offerta (`min_amount = 1`), ma la ragione vera è un'altra: con `price ≥ 1`
**`voidAssignment` non può mai violare I3**. Annullare restituisce `price` crediti e riapre uno
slot, quindi con prezzi ≥ 1 il membro guadagna sempre almeno tanti crediti quanti slot riapre —
ed è per questo che il void non ha nessuna validazione da fare. Con un prezzo 0 ammesso, un void
avrebbe potuto lasciare un membro sotto la soglia di I3, e sarebbe servita una guardia su
un'azione che nasce per *riparare*, non per essere rifiutata.

**Un void non scrive nessuna riga compensativa nel `ledger`.** Il credito è la formula di PLAN §3
(`budget_initial + Σ ledger.delta − Σ price non annullati`): con `voided_at` valorizzato il prezzo
esce dalla somma da solo. Una riga compensativa conterebbe il rimborso due volte. Il `ledger`
resta quello che è: le rettifiche *decise* dal manager, non la contabilità automatica degli
annullamenti.

**Un void ripetuto è un no-op, non un errore.** Seconda chiamata sulla stessa assegnazione già
annullata → `ok` con `mutated: false`: nessun bump, nessun broadcast (⚠ P14). Motivazione: è il
doppio click su un pulsante che intanto è sparito dalla schermata, e in diretta un messaggio
d'errore su un'operazione già riuscita fa perdere dieci secondi a capire cosa è successo.

**⚠ Un `manualAssign` poteva violare I4 senza `force`: chiusa una falla del motore.** Scoperta
provando il caso limite, non prevista dal piano. Nella rotazione normale chi è di turno ha sempre
uno slot libero nel ruolo (ci pensa `nextSeat`), ma una `manualAssign` può riempirgli il ruolo
**mentre sta aspettando di chiamare** — ed è esattamente quello che il pannello di correzione di
questa fase permette di fare. Prima: `pick` non controllava gli slot del chiamante, il lotto si
apriva con lui **fuori** da `round_eligibility` e la sua auto-offerta a 1 **dentro** il round; se
nessun altro rilanciava se la aggiudicava, e si ritrovava due portieri su uno slot. Variante
peggiore: ruolo pieno per tutti → l'auto-pick apriva un lotto con zero idonei e la rotazione
successiva non aveva più un seat dove andare (eccezione in diretta). Rimedio, due righe in
`machine.ts`: `pick` rifiuta con `NOT_ELIGIBLE` chi ha già il ruolo pieno (è §12.19 applicata al
chiamante), e `advanceWaitingPick` in quel caso **salta il turno** invece di aprire il lotto,
riusando la logica di avanzamento già esistente — estratta da `advanceReveal` in `nextTurn`, che
adesso ha due chiamanti. Non è un undo: il turno va avanti, mai indietro (⚠ P1), e a muoverlo
resta **solo il tempo**, mai il manager. Coperto da tre test puri e uno su database.

**Gli override passano dallo stesso `POST /api/auctions/:id/action` delle azioni di gioco.**
Nessuna rotta nuova e nessuna Server Action: il dispatcher esisteva già (DECISIONS Fase 4) e i
tre override hanno bisogno esattamente di ciò che dà — un codice tipizzato subito e nessuno stato
nella risposta, perché lo stato arriva dallo snapshot. `exportXlsx` invece è una `GET` a sé
(`/api/auctions/:id/export`): un download ha bisogno di un URL, di un `Content-Type` e di un
`Content-Disposition`, che in una `POST` di azioni non stanno.

**`assignmentId` entra nello snapshot, dentro ogni voce di rosa.** PLAN §9 vuole
`voidAssignment(assignmentId)` e la regia non aveva da nessuna parte quell'id: le rose dello
snapshot avevano solo `playerId`. Alternativa scartata: annullare per `(memberId, playerId)`, che
avrebbe funzionato ma avrebbe reso l'azione una ricerca invece di un riferimento. Non è una
deroga a I8 — un uuid di riga non dice niente di nessuna busta.

**L'export rigenera tutte e quattordici le colonne, non solo quelle importate** (⚠ P6). `Under`,
`PGv`, `MV` e `FM` restano vuote perché il file originale non è conservato; l'intestazione però è
completa e nell'ordine di Fantacalcio.it, altrimenti il file non sarebbe riconoscibile da chi lo
riapre. Il test è un giro completo: esporta, rilegge con **il nostro stesso parser** e ritrova
`FantaSquadra` e `Costo` sulle righe giuste.

**F7-07bis: la guardia sugli id sta nei due imbuti, non nelle tre rotte.** `isUuid`
(`lib/engine/ids.ts`) è chiamata da `withAuctionLock` — che copre la rotta `action` e ogni azione
futura — e da `resolveViewer`, che copre `stream` e `heartbeat`. In più `withSetupLock`,
`getAuctionOverview` e `listPickPool`, perché anche `/auctions/undefined/setup` rispondeva 500 e
adesso è un `notFound()`. Difendere l'imbuto invece dell'ingresso è ciò che fa valere la regola
anche per la prossima rotta che qualcuno aggiungerà.

---

## 2026-08-08 — Fase 8, deploy

**Gli artefatti di deploy stanno in `deploy/`, non in `scripts/`.** `scripts/` contiene programmi
`tsx` che parlano col motore (seed, driver, bot); `deploy/` contiene la configurazione della
macchina: `ecosystem.config.cjs` per pm2, `deploy.sh`, `nginx-asta.conf`, `db-backup.sh`,
`db-restore-check.sh`, `env.production.example`. Motivazione: sono file che si leggono dal server
e non dal progetto, e nessuno di loro importa una riga di applicazione. Tenerli insieme agli script
TypeScript avrebbe reso `scripts/` un cassetto.

**⚠ Il build di produzione era rotto, e nessun cancello delle Fasi 0–7 lo aveva notato.**
`next build` esegue ESLint e un errore di lint **fa fallire la build**: un apostrofo non
escapato in `app/auctions/[id]/setup/page.tsx` (aggiunto dall'ultimo commit di Fase 7) rendeva
l'applicazione **non deployabile**, con `pnpm dev`, `pnpm test` e `pnpm typecheck` tutti verdi.
Corretto insieme a tre variabili non usate — fra cui la prop `seatsTaken` di `ManageConsole`, morta
dopo il rimaneggiamento della regia. Lezione registrata nel runbook: `pnpm build` è la verifica che
va fatta **prima** di considerare chiusa una fase con della UI dentro, non la sera del deploy.

**Le variabili d'ambiente le passa pm2, non il file `.env`.** Il server standalone di Next fa
`process.chdir(__dirname)` e gira quindi con la working directory in `.next/standalone`, dove non
esiste nessun `.env`: le variabili non verrebbero lette. `deploy/ecosystem.config.cjs` legge il
`.env` della radice con un parser di dieci righe (niente `dotenv`: pm2 esegue quel file col proprio
Node, non con quello del progetto) e lo passa al processo, aggiungendo `NODE_ENV=production`,
`HOSTNAME=127.0.0.1` e `TZ=UTC`. Il file è committato, quindi **non contiene segreti**: la password
del database resta scritta in un posto solo. Se manca una delle cinque variabili di PLAN §1, pm2
non parte affatto — meglio un errore all'avvio che un login che gira a vuoto la sera dell'asta.

**`exec_mode: "fork"` e `instances: 1` sono un invariante, non una preferenza.** In cluster mode
pm2 avvierebbe una copia del processo per core, e ognuna eseguirebbe `instrumentation.ts`: due
sweep che fanno avanzare la stessa asta, cioè il bug di PLAN §16.8 riprodotto in produzione a
comando. Il corollario osservato in Fase 3 («due processi con lo sweep attivo non si fanno male,
ma il design resta un processo solo») qui diventa una riga di configurazione da non toccare.

**`TZ=UTC` fissato sul processo, oltre che sulla macchina.** PLAN §17 chiede il server in UTC;
`timedatectl set-timezone UTC` lo fa per il sistema, ma un giorno qualcuno potrebbe cambiarlo. La
variabile nell'ecosystem file rende la cosa vera per il processo che conta, qualunque cosa dica il
sistema operativo.

**`pnpm db:push` **non** è nel deploy.** Il deploy aggiorna codice e processo; lo schema si applica
a mano. Motivazione: `drizzle-kit` gira con `strict: false` (DECISIONS 2026-08-07) e non chiede il
permesso a nessuno — un `push` automatico significherebbe una modifica di schema che parte da sola
mentre otto persone stanno offrendo.

**Il deploy si rifiuta di partire con un'asta `LIVE` o `PAUSED`.** Una riga di `psql` in
`deploy.sh`, aggirabile con `DEPLOY_DURING_AUCTION=1`. Motivazione: il riavvio in sé è innocuo (il
boot recovery riprende entro un secondo, F3-14), ma `pnpm build` dura un minuto, e un minuto di
silenzio in diretta è un minuto di panico. La pausa non basta come protezione: `PAUSED` è compreso
nella guardia proprio perché è lo stato in cui l'owner mette l'asta quando sta cercando di
risolvere un problema, ed è il momento peggiore per un deploy.

**Il dump è SQL semplice compresso, non il formato `custom`.** `pg_dump --clean --if-exists
--no-owner | gzip`. Motivazione: un dump che si legge con `zless` e si ripristina con `psql` è un
dump che si riesce a usare alle undici di sera senza rileggere il manuale, e questo database sta in
pochi megabyte. `db-restore-check.sh` ripristina su un database separato, conta le righe **e
verifica I2** sul ripristinato: un backup che si ripristina ma con due volte lo stesso giocatore in
una rosa non è un backup buono.

**I bot in produzione si firmano da sé il cookie di sessione.** `scripts/bots.ts` non passa più dal
provider `dev`: emette il proprio JWT di sessione Auth.js con `encode()` di `next-auth/jwt`, usando
l'`AUTH_SECRET` che sul server ha già in `.env`. Motivazione: il criterio ✅ della fase è un'asta a
8 bot **in produzione**, ma il provider `dev` in produzione non esiste per costruzione — e il
server standalone forza `NODE_ENV=production` da sé, quindi non sarebbe bastato nemmeno un flag.
Le alternative erano riaprire il provider dietro un'env var (indebolendo un invariante che
`tests/auth-providers.test.ts` garantisce in modo assoluto, e dipendendo dal ricordarsi di
spegnerla) o rinunciare al collaudo con i bot. Firmare il cookie non aggiunge **nessuna superficie
di login all'applicazione**: chi ha `AUTH_SECRET` ha già tutto. Effetto collaterale voluto: un solo
cammino di codice in locale e in produzione, quindi ciò che funziona in prova funziona la sera
dell'asta.

**Valkey installata per obbligo del provisioner, e disabilitata.** Ploi non permette di creare un
server senza un servizio di cache: la scelta è fra Redis e Valkey. Installata Valkey e spenta
subito (`systemctl disable --now`). Non è una deroga al divieto di PLAN §1: quel divieto riguarda
l'**architettura** — nessuna riga di questo progetto deve dipendere da un servizio esterno per
timer, code o realtime, e non lo fa (i countdown sono `setTimeout` nel processo, il registro SSE sta
su `globalThis`, la concorrenza la serializza `withAuctionLock`). Un demone che nessuno interroga
non cambia l'architettura di niente; sarebbe diverso il giorno in cui qualcuno lo usasse per
condividere stato fra processi, perché a quel punto smetterebbe di esistere un processo solo.

**⚠ I 327 test verdi del gate di Fase 7 non lo erano più.** Il commit `01b7c0d` ("update UI labels")
ha tolto i nomi degli assenti da `startBlocked` e commentato la lista dei membri prima
dell'avvio, lasciando **due test rossi** in `tests/manage.test.ts`. La modifica è deliberata e
sensata — la stessa informazione stava in tre posti (il messaggio, la lista dei posti col pallino di
presence, e la lista commentata), cioè uno da tenere allineato e due da dimenticare. I test sono
stati riportati sul contratto vero: `canStart` falso, il messaggio parla della regola, e **il nome
di chi manca resta raggiungibile** da `absentMembers`, che è la funzione che la lista dei posti
usa per il pallino. Il blocco JSX commentato in `controls.tsx` è stato lasciato com'è: sembra un
segnaposto di una decisione ancora aperta dell'owner, e non è codice che il deploy tocchi.

## 2026-08-09 — M0, la nuova linea di sviluppo

**Non c'è un ambiente di staging, e non è una dimenticanza.** `dev` si prova in locale: Docker,
seed, bot, e `pnpm dev:lan` per il telefono. Uno staging sul server avrebbe voluto dire un secondo
sito Ploi, un secondo processo pm2 e un secondo database sulla stessa CX22, più una procedura
raddoppiata da tenere aggiornata — per un'app che va in produzione davanti a dieci persone una
volta all'anno. Se un giorno servisse, il flusso non cambia: basta puntarci `DEPLOY_BRANCH=dev`.

**`PLAN.md` e `BACKLOG.md` sono congelati, non estesi.** L'alternativa era continuare ad
aggiungere «Ciclo N» in fondo al backlog e riscrivere il piano a ogni feature. Congelarli ha due
vantaggi: `PLAN.md` mantiene lo statuto di documento immutabile che gli invarianti I1–I10 meritano,
e ciò che si legge per lavorare oggi è un file corto invece di 1.700 righe di storia. **Archivio
non vuol dire disattivato**: gli invarianti restano vincolanti, ed è scritto nell'intestazione di
entrambi i file perché è l'equivoco che costerebbe di più.

**Un file per macro-feature, con spec e task insieme.** La separazione fra documento di design e
piano di implementazione — due file — è più rigorosa ma obbliga a saltare fra due documenti
mentre si lavora, per un beneficio che qui non esiste: la stessa persona scrive la spec e la
esegue, a giorni di distanza. Vale la regola 8 di `CLAUDE.md`: niente struttura prima del secondo
chiamante.

**Le macro sono grosse di proposito.** Il rischio del flusso a tre branch è che ogni correzione
di una riga diventi un branch, un merge e un deploy. La regola è che una macro è un tema, non un
task: una correzione piccola vive dentro la macro aperta o aspetta la prossima.

**`--no-ff` obbligatorio su entrambi i merge.** Con il fast-forward la storia si appiattisce e non
resta traccia di dove una macro cominciava: il merge commit è il punto di rollback.

**Le richieste pianificate spariscono da `REQUESTS.md`.** Due copie della stessa richiesta — una
nel quaderno, una nel file della feature — divergono sempre, e quando divergono non si sa più
quale sia la verità. Il quaderno è la lista di ciò che non è ancora stato deciso.

**Il tag `v1.0.0` punta a un commit il cui `package.json` dice `0.1.0`.** Non è stato corretto a
posteriori: il versionamento comincia adesso e la storia non si riscrive.

**⚠ `docs/RUNBOOK.md` è stato eliminato**, su decisione dell'owner presa a macro già aperta. Metà
del file era la guida che lo aveva accompagnato attraverso le fasi — il ritmo, che modello usare,
quando attivarsi — e quella metà è morta con le fasi. Tenere in vita un documento per metà
obsoleto è il modo migliore per smettere di fidarsi anche dell'altra metà, quella di produzione.
Le tre procedure che il flusso di sviluppo richiede davvero — schema dopo il deploy, rollback a un
tag, deploy manuale — sono passate in `CLAUDE.md`, dove vengono lette; tutto il resto (le tre
password, la checklist §17, la tabella degli incidenti, come rifare la macchina da zero) resta
recuperabile con `git show v1.0.0:docs/RUNBOOK.md`. Il ragionamento: il costo di perderlo è basso
perché è recuperabile, il costo di tenerlo è alto perché invecchia in silenzio. I rimandi al
runbook in `deploy/deploy.sh`, `deploy/ecosystem.config.cjs` e `lib/db/index.ts` sono stati tolti;
quelli in `BACKLOG.md` e in questo file **no**, perché descrivono cosa era vero quando sono stati
scritti.

**`CLAUDE.md` è passato da 178 a 234 righe**, sopra il tetto di 230 che ci si era dati. Le righe
in più sono le procedure ereditate dal runbook: si è preferito sforare di quattro righe piuttosto
che lasciarle senza casa.

## 2026-08-09 — M1, segretezza e rivelazione delle offerte

**Il conteggio aggregato delle buste è caduto insieme ai nomi.** L'alternativa in campo era
togliere l'elenco di chi ha consegnato e tenere un «4 su 7», che sembra anonimo. Non lo è: gli
idonei di un lotto sono spesso due o tre, soprattutto a fine ruolo, e a quel punto il numero fa il
nome da sé. La richiesta dell'owner parlava di strategie fra competitor, non di importi, quindi
qualunque cosa distingua un idoneo che si è mosso da uno che non si è mosso è nel perimetro.

**`bidStatus` è stato eliminato dal tipo, non nascosto in un ramo `if`.** La correzione minima
sarebbe stata emetterlo solo in `LOT_REVEAL`, dove però `reveal` porta già tutto: il campo non
aveva più nessun consumatore legittimo. Toglierlo dal tipo rende l'invariante strutturale invece
che sorvegliato — un campo che non esiste non può essere emesso nella fase sbagliata da una
modifica distratta fra un anno. È lo stesso ragionamento della regola 3.

**Anche la regia perde il contatore.** Nella console del manager il blocco «buste consegnate 4/7»
era il dato più utile della striscia, e serviva a decidere se premere pausa. È stato sostituito
dagli idonei, che sono pubblici, perché chi conduce l'asta quasi sempre gioca: lasciarlo lì
avrebbe dato a un partecipante — uno solo, e per di più quello che controlla la pausa —
un'informazione che nessun altro ha. La domanda operativa («siamo in un round vero o in un lotto a
un solo idoneo?») trova risposta lo stesso.

**Il reveal è un componente diverso, non un ramo di `LotCard`.** La card viva e la card chiusa
hanno cornice, colori e gerarchia tipografica diversi di proposito: il problema segnalato era che
il momento dell'assegnazione *sembrava* un'asta ancora in corso. Un `if` dentro un componente solo
avrebbe prodotto la stessa UI con qualche classe condizionale in più, che è esattamente ciò che
non funzionava. §8bis non è toccata: chiede che l'area del lotto sia sempre presente e sia
funzione pura dello snapshot, non che sia sempre lo stesso nodo React.

**La card chiusa dice quando si riparte, non a chi tocca.** Mostrare il prossimo chiamante avrebbe
richiesto di calcolare il turno successivo già durante il reveal e di farlo uscire nello snapshot:
fattibile riusando `nextSeat`/`nextRole`, ma è un campo in più e un'anteprima che un override del
manager può smentire mentre la si guarda. Decisione dell'owner: informazione non necessaria, si
scopre quando il lotto nuovo si apre. Conseguenza pratica notevole — **il server non cambia se non
per la rimozione di `bidStatus`**, perché la scadenza del reveal è già in `phaseDeadline`.

**Il countdown al prossimo turno non è una barra.** Richiesta esplicita dell'owner, e ha una
ragione: la barra che scorre è il segnale visivo dell'urgenza durante le offerte. Riusarla sulla
schermata in cui non si deve fare niente rimetterebbe addosso la fretta da cui la card doveva
liberare.

---

## 2026-08-09 — Prova in locale: l'owner è l'ultimo posto

**Nel seed l'owner entra per ultimo.** Prima era `userIds[0]` a joinare per primo, quindi l'owner
era il seat 0. I bot però prendono i posti **a partire da zero** (`memberRows.slice(0, count)`),
per cui `--count=7` liberava l'ultimo posto — un utente qualsiasi — e mai quello dell'owner. Chi
voleva giocare di persona doveva entrare come un altro utente, e perdeva la regia: `/manage`
esiste solo per l'owner. Invertendo l'ordine di join, l'owner si prende l'ultimo posto ed è
esattamente quello che i bot lasciano libero: **regia e portale dello stesso utente, in due
schede, senza cambiare account**.

Le alternative erano un flag `--skip-seat` sui bot (più codice, e due posti da tenere allineati)
o rassegnarsi a cambiare browser. La strada scelta non tocca né i bot né l'applicazione: sposta
una riga nel seed, che è il posto dove i posti si assegnano.

Conseguenze accettate: il seat 0 non è più dell'owner, quindi all'avvio (`startSeatIndex: 0`) non
è lui il primo a chiamare; e con `--auction-status=draft` l'owner è il seat 6, perché lì i posti
occupati sono sette. L'invariante che conta resta vero in tutti i casi — **l'owner è sempre
l'ultimo posto occupato**.

Questa è una comodità di sviluppo, non la funzionalità: la macro **M4 — Simulazione in-app**
resta in piedi e serve a far girare i bot dall'interfaccia, senza terminale.

---

## 2026-08-09 — «Prosegui asta»: la regia chiude il reveal in anticipo

**Un evento nuovo, `SKIP_REVEAL`, e non una deadline accorciata.** Il modo più corto di scrivere
questa funzione sarebbe stato mettere `phase_deadline = now` e lasciare che lo sweep facesse il
resto: nessun evento nuovo, tre righe. È stata scartata per due ragioni. La prima è la
tracciabilità: nel log resterebbe un `ADVANCE` di sistema, e fra sei mesi, davanti a una disputa,
non ci sarebbe modo di sapere che qualcuno ha premuto un pulsante. La seconda è che introdurrebbe
fino a un secondo di attesa — il passo dello sweep — che è esattamente ciò che il pulsante deve
togliere.

Scartata anche l'idea di **allentare la guardia dentro `advance`**. Quel `if (now <
state.phaseDeadline) return ok(state)` è ciò che rende `ADVANCE` idempotente (I7) e permette a
timer e sweep di chiamarla quante volte vogliono: aprirle un'eccezione per fare spazio a un
pulsante l'avrebbe resa inaffidabile per i suoi due chiamanti veri. `SKIP_REVEAL` vive accanto ad
`ADVANCE`, non dentro.

**L'effetto è `nextTurn`, la stessa identica funzione della scadenza.** Non esiste una seconda
strada per passare il turno, quindi non c'è niente da tenere allineato: cambia solo *quando*, e la
deadline della fase successiva nasce dall'istante del click. Il test lo verifica confrontando lo
stato prodotto dal salto con quello prodotto dalla scadenza, invece di riscrivere le attese.

**L'idempotenza non ha avuto bisogno di codice.** Dopo il primo salto la fase non è più
`LOT_REVEAL`, quindi il secondo click trova la guardia e viene rifiutato: I7 esce dalla forma
della macchina, non da un flag.

**Solo l'owner, e la verifica sta nell'azione.** Il motore non sa chi possiede l'asta — è la
stessa ragione per cui il cancello di presence di `START` non è nella macchina. `skipReveal` in
`actions.ts` chiama `requireOwner` come fanno pausa e ripresa; il pulsante nascosto agli altri è
comodità, non sicurezza (regola 6).

**Il client sa di essere l'owner da una prop, non dallo snapshot.** `viewerIsOwner` arriva a
`Portal` dalla pagina server, come già fa il listone. Metterlo nello snapshot avrebbe significato
spedire a tutti, a ogni transizione, un booleano che nasce col link e non cambia per tutta la
serata — e allargare `serializeSnapshot`, che è il punto in cui si decide cosa può uscire (regola
3, I8).

**Restano fuori il turno di chiamata e la preparazione dello spareggio.** Tagliare l'attesa del
pick non è «riparti», è far scattare l'auto-pick al posto di qualcuno: stessa etichetta, funzione
diversa. Lo spareggio dura due secondi e serve a far capire che si ricomincia. Decisione
dell'owner: il pulsante esiste solo dove l'attesa non serve a nessuno.

**`reveal_seconds` non cambia**: resta configurabile e resta la scadenza automatica. Il pulsante
è una scorciatoia, non una sostituzione — un'asta condotta senza toccarlo si comporta come prima.

---

## 2026-08-10 — Tre correzioni attorno alla configurazione ad asta iniziata

**Il salvataggio dei tempi non ha mai funzionato, e il test lo diceva verde.** `updateAuctionSettings`
decideva se una patch fosse strutturale guardando `patch.name !== undefined`, cioè se il campo
*fosse arrivato*, non se fosse *cambiato*. La configurazione è un `<form>`: rimanda tutti i campi
che non stanno dentro un fieldset disabilitato, e il nome era fuori da tutti. Risultato: ogni
salvataggio ad asta iniziata portava con sé il nome invariato e veniva rifiutato in blocco, con il
messaggio che spiegava che si possono cambiare solo i timer — mentre era proprio un timer quello
che si stava cambiando.

Il test che avrebbe dovuto proteggerlo passava una patch con il solo `bidSeconds`, cioè una patch
che il form vero non produce mai. È il modo tipico in cui un test resta verde su una funzione
rotta: prova l'unità con un input che nessun chiamante le passa. I due test nuovi passano il nome
invariato come fa il form, e verificano che un nome davvero diverso continui a essere rifiutato.

**Il nome è passato dentro un fieldset disabilitato.** Il server lo considera strutturale, quindi
la UI non deve prometterlo modificabile: un fieldset disabilitato, oltre a spegnere il campo, non
lo invia affatto: la classe di bug qui sopra non si ripresenta.

**L'avviso è costante e non è un errore.** «Ad asta iniziata si possono cambiare solo i timer, che
valgono dal lotto successivo» era un errore rosso dopo il click. Ora è un avviso ambra sopra il
form: è una regola del posto in cui ti trovi, va letta prima di compilare, e la sua seconda metà
— «dal lotto successivo» — non è un divieto ma la risposta alla domanda vera, «se cambio adesso,
quando vale?».

**La lobby non spinge più al portale ad asta in pausa.** Il `router.push` automatico serve perché
nessuno perda secondi di un'asta che corre; in pausa non scorre niente, ed è anzi il momento in
cui si va a cambiare i tempi — dalla configurazione, che si raggiunge dalla lobby. Finché valeva
anche per `PAUSED`, l'owner veniva rispedito al portale a ogni tentativo di attraversarla. La
correzione non ha bisogno di compensazioni: alla ripresa lo stato torna `LIVE`, l'effetto riparte
e accompagna al portale chi era rimasto in lobby. Resta un avviso con il link al portale, perché
in pausa nessuno viene più spostato e la porta va lasciata visibile.

## 2026-08-10 — M2, navigazione e identità delle pagine

**Un modulo puro invece di quattro elenchi di link.** La navigazione era scritta a mano in quattro
pagine, e in due punti la voce «Pannello di configurazione» puntava alla lobby. La correzione ovvia
sarebbe stata sistemare i due link; quella scelta è `lib/auction-nav.ts`, dove segmento di URL, voce
di menù e titolo della pagina stanno sulla stessa riga e da lì escono sia la sotto-navbar sia il
titolo. Un link sbagliato si ripresenta appena si aggiunge una pagina; un posto solo no. Il modulo
non ha dipendenze, come `lib/domain.ts` e per la stessa ragione: lo legge anche il componente client
che evidenzia la voce attiva.

**Le sezioni dipendono dal ruolo e mai dallo stato dell'asta.** L'alternativa — voci contestuali,
«Configurazione» che sparisce a `COMPLETED` — mostra meno voci morte ma trasforma la navigazione in
stato di gioco: renderizzata dal server a inizio pagina, mentirebbe dopo la prima transizione, e
per non mentire dovrebbe essere alimentata dallo snapshot. Il ruolo, al contrario, non cambia
mentre guardi la pagina. Voci fisse significa anche che nessuno impara la posizione di un pulsante
e poi non lo ritrova.

**Il titolo lo decide la rotta, non la pagina.** `activeSection` ricava la sezione dal `pathname`.
Una pagina che dichiara il proprio titolo può mentire su dove si trova — è precisamente il bug di
partenza, in un'altra forma; la barra degli indirizzi no.

**Lo `StatusBadge` non sale nell'intestazione.** È letto dal server all'apertura della pagina e lì
resta fermo: nell'intestazione comune si troverebbe, in regia, accanto al badge di fase che arriva
dallo stream, a dire il contrario. Resta nel contenuto di lobby e configurazione, dove ogni riga
viene dalla stessa lettura e ha la stessa età. Il badge dell'asta, invece, porta solo il **nome** —
un fatto di setup, che stantio non può diventare.

**Niente di sticky, nemmeno sul desktop.** Il requisito nasce dal portale, dove lo spazio verticale
è del countdown. Applicarlo ovunque costa nulla e toglie di mezzo un incastro a tre livelli di
`z-index` fra banner, navbar e intestazione del portale: un comportamento solo, invece di uno con
un'eccezione.

**Nome e uscita in chiaro, non in un menu a tendina.** Un menu con due voci è un'astrazione prima
del secondo chiamante (regola 8): costerebbe un componente shadcn nuovo, del JavaScript client su
ogni pagina e due tocchi per uscire.

**`getAuctionOverview` avvolta in `cache()`.** Layout e pagina la chiamano entrambi. Verificato che
fuori da un contesto di render React la funzione venga semplicemente eseguita: i test che rileggono
l'overview dopo una mutazione, e si aspettano di vedere il cambiamento, restano verdi.

**La TV cambia natura, non scala.** La richiesta era «testi più adatti a un MacBook che a una TV».
Dimezzare i corpi avrebbe soddisfatto la lettera e sprecato la risposta: il motivo per cui la TV
mostrava poco non era la dimensione del testo ma il fatto di essere progettata per quattro metri di
distanza — mezzo schermo a un countdown che ognuno ha già in mano, e la rosa ridotta a `11/25`
perché quattro frazioni da lontano sono illeggibili. Su un portatile quei vincoli non esistono più,
quindi tre quarti di schermo diventano un tabellone con tutte le rose complete. L'estensione è stata
decisa esplicitamente dall'owner in fase di spec, ed è annotata anche in `docs/features/02-navigazione.md`.

**Gli slot vuoti restano disegnati.** Costano righe che si potrebbero risparmiare, ma tengono le
card alte uguali: la griglia non balla a ogni acquisto, e il tabellone risponde anche alla domanda
«quanti gliene mancano», che è la seconda che uno si fa guardandolo.

**Il reveal non prende lo schermo.** Le buste si aprono nella colonna mentre la card del vincitore
si accende nel tabellone. Costa poco — il giocatore aggiudicato compare lì da sé, perché
l'assegnazione è già scritta quando le buste si aprono — e evita che il recap sparisca proprio
nell'istante in cui si vogliono confrontare i crediti residui.

**Il limite di leggibilità è scritto nel file.** Sotto gli ~800px di altezza il tabellone non si
legge più. È una pagina da portatile per scelta, e una scelta dichiarata è diversa da un difetto
scoperto la sera dell'asta.
