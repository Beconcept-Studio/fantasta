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

## 2026-08-10 — M2, tre correzioni dopo la prima prova

**Il banner dell'asta in corso si nasconde anche sulla vista TV.** Il layout radice gira su ogni
pagina, TV compresa, quindi finché l'owner aveva una sessione aperta nello stesso browser quel
banner si incollava in cima allo schermo proiettato: una striscia verde che invita ad andare al
proprio portale, sopra un tabellone che guarda tutta la stanza. Sottraeva anche altezza a un layout
che vive di `h-dvh` e non ha scroll. La navbar già si toglieva di mezzo su `/tv/`; il banner no
perché è più vecchio di quella regola, e nessuno l'aveva mai visto lì — la TV si guarda da un
browser senza login, e in prova la si apre nello stesso in cui si è loggati. §8bis non è indebolito:
il banner esiste per far ritrovare la strada a un partecipante, e la TV non è la pagina di nessun
partecipante.

**Nell'intestazione della TV lo stato al posto dello speso e dell'ordine dei ruoli.** Il totale
speso era un numero che nessuno guardava — i crediti residui di ciascuno sono già nel tabellone, uno
per squadra — e l'ordine dei ruoli è un fatto di configurazione che si legge una volta a inizio
serata. Lo stato dell'asta no: è la risposta alla domanda di chi alza gli occhi e trova tutti i
numeri immobili, «è finita, è in pausa, o si è piantato?». Sta accanto alla fase e non al posto suo,
perché le due cose rispondono a domande diverse: la fase cambia ogni pochi secondi, lo stato dura.

**«Portale» diventa «Asta live».** La voce di menù nominava il contenitore invece del contenuto. La
rotta resta `/play` e il componente resta `Portal`: rinominare l'URL romperebbe i link che i
partecipanti hanno già aperto, e rinominare il codice sarebbe churn senza lettori. Resta una
tensione, accettata: il titolo «Asta live» è sopra la pagina anche prima che l'asta parta, dove la
schermata dice «l'asta non è iniziata». I titoli sono fissi per sezione di proposito — è ciò che li
rende immuni allo stantio — e la direttezza vale più di quel caso di bordo.

## 2026-08-10 — La versione nella navbar

**Viene da `package.json`, importato nel layout radice e passato come stringa.** Il layout è un
server component, la navbar è `"use client"`: importare `package.json` dalla navbar farebbe
viaggiare fino al browser l'elenco completo delle dipendenze per mostrare cinque caratteri. Scartate
due alternative: `process.env.npm_package_version`, che esiste solo quando il processo è avviato da
uno script pnpm e in produzione pm2 lancia `node server.js`, quindi sarebbe vuota proprio dove
serve; e una variabile in `next.config.ts`, che aggiunge un posto in cui la versione può divergere
da quella vera.

**Il numero è quello con cui l'applicazione è stata compilata**, e questo è il punto: il deploy fa
`pnpm build` sul server dopo il checkout, quindi ciò che si legge nella navbar è la versione del
codice che sta rispondendo. Non è una dichiarazione d'intenti letta da un file di configurazione —
è la ragione per cui serve, cioè non dover credere al momento in cui il deploy dice di aver finito.

**Si disegna anche senza sessione.** La richiesta era «prima del bottone Esci», che vive nel blocco
utente; metterla lì dentro l'avrebbe nascosta sulla pagina di accesso, che è esattamente il posto
in cui uno guarda quando l'app non lo fa entrare e vuole capire se il rilascio è passato.

**Versione `1.3.1` e non `1.4.0`.** La convenzione del progetto lega il minor alle macro-feature e
la patch agli hotfix; questa è un'aggiunta minuscola fuori macro, e una patch la racconta meglio
di un minor.

## 2026-08-10 — M3, tracciabilità

**I due export convivono, e la decisione è arrivata da un fatto e non da una preferenza.** Chiesto
se l'export nuovo dovesse sostituire quello esistente, l'owner ha scelto la sostituzione; la domanda
successiva — «la reimportazione su Fantacalcio.it la usi?» — ha ribaltato la scelta, perché la
risposta era sì. Vale la pena annotare il metodo e non solo l'esito: la domanda utile non era quale
export preferire, era quale dei due file viene aperto davvero.

**Il file del listone si chiama `-listone.xlsx`, e prima si chiamava `-rose.xlsx`.** Cambia il nome
di un download, non il contenuto. Con un vero export delle rose accanto, un file chiamato «rose» che
contiene tutto il listone mente proprio a chi lo ritrova nei download sei mesi dopo.

**Le rotte diventano due gemelle** (`export/listone`, `export/rose`) invece di una con un segmento
parametrico. Dieci righe di autenticazione ripetute due volte si leggono senza spiegazioni; uno
smistamento su un enum da due valori è un'astrazione prima del secondo chiamante (regola 8). Anche
quella esistente si è spostata: `/export` accanto a `/export/rose` non dice quale sia quale, e lo
compone solo il link in regia — nessuno l'ha mai aperto a mano.

**Il CSV usa la virgola, con la trappola dichiarata.** Excel in italiano usa il punto e virgola come
separatore di elenco, quindi il file aperto con un doppio clic finisce in una colonna sola. Proposto
il punto e virgola, l'owner ha scelto la virgola: è il formato della richiesta ed è il più neutro per
chi lo legge da script o a mano. Annotato perché è una cosa che si riscopre con fastidio, non un
difetto da correggere.

**Il nome squadra non può contenere virgole né virgolette, e la regola nasce da qui.** Proposto di
virgolettare i valori in uscita, l'owner ha chiesto l'opposto: nomi puliti nel file e un vincolo
all'ingresso. È la scelta migliore per il file — un verbale deve restare leggibile a occhio — e ha
un punto di applicazione unico, perché `validateTeamName` è chiamata da un solo posto e un nome
squadra non si rinomina mai. Il punto e virgola passa: con la virgola come separatore è innocuo, e
togliere caratteri legittimi a un nome di fantasia si paga in fastidio a ogni ingresso. La regola sta
in `validateTeamName` e **non** in `normalizeName`, che il nome dell'asta condivide e che finisce solo
in uno slug.

**Resta una rete nel costruttore del CSV** che trasforma un carattere proibito in uno spazio. Non
sostituisce la regola: copre i nomi salvati *prima* che esistesse, che senza rinomina non si possono
aggiustare — ad asta iniziata nemmeno togliendo e riaggiungendo il membro. Un file leggermente
diverso dal nome digitato è meglio di un file rotto senza rimedio.

**L'ordinamento delle righe del CSV sta nella funzione pura e non in un `ORDER BY`.** L'ordine delle
righe è una proprietà del file, non della query; tenerlo dove si collauda senza Postgres lo rende
verificabile in millisecondi, e in un posto solo non può divergere.

**Lo storico è la quinta sezione dell'asta, non un link nella lobby.** La richiesta diceva «dalla
lobby», e una sezione ci arriva comunque, perché la sotto-navbar è su tutte le pagine dell'asta —
mentre il contrario no: durante una disputa si è in regia o nel portale, e tornare in lobby per
leggere lo storico è un passaggio in più. È anche il caso per cui `lib/auction-nav.ts` esiste, ed è
compatibile con la sua regola: la voce dipende dal ruolo e non dallo stato dell'asta.

**Lo vedono owner e partecipanti.** Un partecipante che contesta un lotto deve poter guardare da sé,
e c'è la I10: le buste non si rivedono da nessun'altra parte dopo i secondi di reveal — tanto meno
se è stato premuto «Prosegui asta», che quei secondi li salta. Chi non partecipa prende `NOT_FOUND`
e non `FORBIDDEN`: l'esistenza di un'asta a cui non partecipi non è una sua informazione.

**Due blocchi e non una cronologia unica, e il numero che l'ha deciso.** Un'asta da dodici con
venticinque slot fa ~300 lotti e **oltre duemila righe in `events`**, quasi tutte `ADVANCE` e
`PLACE_BID`. Una lista piatta in ordine di tempo sarebbe illeggibile la sera in cui serve. I lotti
pieghevoli la riducono a trecento righe; le correzioni sono poche e stanno sotto.

**`events` da sola non basta per una disputa**, e verificarlo prima di progettare ha cambiato la
forma della pagina. Il payload di un `PLACE_BID` è `{from, to, lotId, actor}`: registra chi e quando,
**mai quanto**. I lotti si leggono quindi dallo stato dell'asta, ed `events` serve solo agli eventi
notevoli.

**Un tipo di evento sconosciuto viene mostrato, non ignorato.** La lista consultata è quella della
routine da escludere (`PICK`, `PLACE_BID`, `WITHDRAW_BID`, `ADVANCE`), non quella dei tipi noti da
includere: un evento aggiunto fra un anno comparirà da sé, senza che nessuno debba ricordarsi di
registrarlo. Un log che nasconde ciò che non sa interpretare è un log di cui non ti fidi.

**Gli eventi si leggono con due query e non con un join, e questa avrebbe rotto la pagina in
produzione.** In `payload.actor` non c'è sempre un id utente: le transizioni decise dal tempo
scrivono `"system"`, il seed scrive `"seed"`, e un `->>'actor'` castato a `uuid` **solleva** su quelle
righe. La pagina sarebbe andata in 500 esattamente sulle aste in cui una fase è scaduta, cioè su
tutte quelle vere.

**L'esito di ogni round lo scrive `resolveRound`**, la stessa funzione che ha deciso l'asta. Il
conteggio dei pari merito serve alle parole («stallo») e non alla decisione: contare non è
ridecidere. Ricalcolare il verdetto a mano darebbe due verità su come si vince un lotto, e in una
disputa la seconda non serve a niente.

**Nessuno stream sulla pagina, e un pulsante invece di un aggiornamento automatico.** Lo storico non
è lo stato dell'asta: non passa da `serializeSnapshot` (regola 3) e non ha nulla da ricevere in
diretta. L'ora della lettura è scritta in cima perché in una disputa l'età di ciò che leggi è essa
stessa un'informazione; un aggiornamento automatico sposterebbe sotto gli occhi la riga che stai
guardando.

**Gli orari sono fissati a `Europe/Rome` nel codice, non lasciati al fuso del browser.** Le persone
che discutono di un lotto sono nella stessa stanza e devono leggere lo stesso numero, anche se una ha
il telefono su un altro fuso; ed è la stessa ora che l'owner legge nei log del server. `Intl` copre
l'ora legale, che sommare due ore fisse no.

### La barriera I8, e perché il predicato non è dove doveva essere

In fase di spec il filtro era una riga dentro `lib/engine/log.ts`. È stato spostato in
`lib/auction-log.ts` per una cosa scoperta **rompendolo di proposito**: togliendo il filtro, il test
con Postgres continuava a passare. `serializeLot` scarta comunque i lotti senza vincitore e senza
prezzo, e un lotto aperto non ne ha — quindi era *quel* controllo a escludere il lotto in contesa, e
l'asserzione non stava dimostrando ciò che diceva di dimostrare.

Le conseguenze, entrambe volute:

- **Le due protezioni restano.** Si coprono a vicenda soltanto perché il motore non produce mai un
  lotto `OPEN` con un vincitore; contare su quella coincidenza vorrebbe dire affidare I8 a un
  dettaglio di implementazione di `enterReveal` invece che a una regola dichiarata. Un commento in
  `serializeLot` lo dice a chi passerà da lì e sarà tentato di semplificare.
- **Il predicato sta in un modulo puro**, dove si prova da solo — su un lotto costruito a mano che è
  `OPEN` *e* ha un vincitore. Quello stato il motore non lo genera mai, ed è esattamente per questo
  l'unico che separa quel controllo da tutti gli altri. Un guardiano che non sai se sta guardando non
  è un guardiano.

**L'asserzione I8 toglie dal payload i numeri che non sono importi** prima di cercare le cifre: gli
istanti ISO, gli uuid (che finiscono anche nei nomi utente costruiti dai test) e gli `id` di `events`,
che sono un `bigserial` globale al database. Senza quelle esclusioni il test falliva **a caso**,
secondo i byte prodotti dal generatore di uuid — ed è il modo peggiore, perché un rosso che va e
viene si finisce per ignorare.

**La lobby non verifica l'appartenenza, e M3 non l'ha cambiato.** `getAuctionOverview` torna `null`
solo se l'asta non esiste, quindi qualunque utente autenticato può vedere la lobby di qualunque asta.
Lo storico si protegge da sé; allineare la lobby è una decisione dell'owner e non un effetto
collaterale di questa macro. Annotato qui perché è il genere di cosa che, non scritta, si riscopre
per caso.

## 2026-08-10 — Due code di M3, dopo la prova su `dev`

**La lobby resta visibile a qualunque utente autenticato, e ora è una scelta.** M3 aveva annotato
come osservazione che `getAuctionOverview` torna `null` solo se l'asta non esiste, quindi chiunque
sia loggato può aprire la lobby di un'asta che non è sua. Chiesto all'owner, la risposta è stata che
non gli interessa proteggerla. Va scritto qui e non lasciato implicito, perché altrimenti fra sei mesi
sembra una dimenticanza e qualcuno la «aggiusta»: **non è un buco rimasto aperto, è un requisito che
non c'è.** Lo storico invece si protegge da sé — quello contiene le buste, e le buste hanno un
invariante.

**La versione nella navbar importa il default di `package.json`, non il campo.** `next build` emetteva
`Should not import the named export 'version' … (only default export is available soon)`: un modulo
JSON esporrà solo il default, e quel giorno `import { version } from "../package.json"` smetterebbe di
compilare — cioè la build si romperebbe per una riga scritta un anno prima, durante un deploy. Il
default si destruttura in una costante subito sotto l'import.

Non cambia niente di ciò che era già stato deciso il 2026-08-10 per questa funzione: la lettura resta
in `app/layout.tsx`, che è un server component, quindi l'oggetto intero non lascia il server e alla
navbar arriva sempre e solo la stringa. Le due alternative scartate allora restano scartate, e non per
abitudine: `process.env.npm_package_version` è vuota quando il processo non è avviato da pnpm, cioè
sotto pm2, cioè in produzione; una variabile in `next.config.ts` aggiunge un posto da cui la versione
può divergere da quella vera.

## 2026-08-10 — M4, la simulazione in-app

**Il meccanismo di B con il cancello di A.** Il quaderno proponeva due strade: un flusso di
creazione dedicato all'asta simulata (A), oppure un pannello sotto gli inviti che riempie di bot
un'asta qualunque (B). Si è preso il pannello di B con il flag `is_simulated` deciso alla creazione
come in A. A da sola avrebbe duplicato la schermata di configurazione — che è esattamente ciò che
la richiesta chiede di riusare, «configurarla come se fosse vera» — e la copia sarebbe divergente
al primo cambio. B da sola avrebbe lasciato per sempre un pulsante «riempi di bot» a due centimetri
dagli inviti dell'asta vera. Il flag alla creazione, che nessuna schermata può più cambiare, rende
la cosa **strutturalmente** impossibile invece che sorvegliata.

**I bot si muovono da un `setInterval` in-process, separato dallo sweep.** Le alternative erano
agganciarli alla coda di ogni transizione o lasciarli fuori processo. La coda della transizione non
funziona: l'apertura di un lotto è un istante, e dei bot che offrono tutti in quell'istante chiudono
ogni round in cinquanta millisecondi — l'asta simulata diventa una lista di risultati invece della
dinamica che si vuole guardare mentre si offre dal telefono. Fuori processo non risolve la richiesta,
che è precisamente «senza lanciare script».

Separato dallo sweep e non dentro, perché lo sweep chiude i round ed è sequenziale: undici bot che
scrivono sotto lock ritarderebbero la chiusura di un round dell'asta vera che gira accanto. Non
viola il divieto su code, worker e servizi di scheduling: è un `setInterval` nell'unico processo
Node, la stessa forma dello sweep, e `exec_mode: fork` con `instances: 1` è la ragione per cui è
sicuro. **Acceso sempre**, anche senza simulazioni: è una `SELECT` al secondo che non trova nulla,
e in cambio non esiste lo stato «il loop non è ripartito dopo un riavvio».

**Lo stand-down: i bot si fermano se esiste un'asta reale `LIVE` o `PAUSED`.** La sezione gira sulla
stessa macchina dell'asta vera, ed è una funzione a runtime: «la sera dell'asta non si pusha su
`main`» non la copre. Il costo dichiarato è che una simulazione dimenticata accesa si congela — per
questo la pagina lo scrive, altrimenti fra tre mesi sembra un guasto.

**`is_admin` e `is_bot` sono due booleani, non una colonna a tre valori.** L'alternativa era
`users.role ∈ {USER, ADMIN, BOT}`, che avrebbe reso impossibile per costruzione la combinazione
assurda. Scartata su indicazione dell'owner, con la ragione giusta: l'amministratore è un **permesso
su una persona**, non un tipo di creatura — gioca le aste come tutti — e l'enum lo avrebbe modellato
come una specie. La combinazione impossibile la vieta un `CHECK`, che è la stessa logica degli
indici parziali di I1 e I2. Effetto collaterale gradito: `is_admin` resta dov'era e lo schema cambia
in modo puramente additivo, quindi nessun `pg_dump` preventivo.

**Un cervello solo, puro, che mangia lo snapshot redatto.** Prima di M4 i bot erano due
implementazioni: `scripts/bots.ts` decideva sullo snapshot (cieco), `scripts/drive.ts` su
`AuctionState` grezzo (onnisciente). Finché giocavano fra loro era indifferente; in una simulazione
in cui l'owner gioca contro di loro, un bot che vede le buste è un bot che batte sempre di uno. Il
cervello unico prende uno `Snapshot` e nient'altro: I8 diventa la firma di una funzione invece di
una promessa. `drive.ts` è stato ritirato — faceva una cosa che la simulazione fa meglio, e portava
con sé uno scheduler parallelo, che è una delle trappole documentate in `CLAUDE.md`. `bots.ts`
resta perché collauda l'applicazione *da fuori*: sessione, rotta, SSE, nginx.

**Niente memoria nei bot: il ritardo è derivato.** Dove c'era `Math.random()` c'è un hash di
`(membro, lotto, round)`. Stessa situazione, stesso ritardo, anche dopo un riavvio del processo — e
i test non diventano intermittenti, che è il modo peggiore di fallire perché un rosso che va e
viene si finisce per ignorare. «Ho già offerto?» non è uno stato del bot: glielo dice `myBid`.

**Le aste del seed nascono simulate, e il primo utente del seed è amministratore.** Un'asta prodotta
da `pnpm db:seed` non è mai un'asta vera; senza il flag, tenerne una aperta in locale terrebbe fermi
i bot di ogni simulazione per via dello stand-down. E dover aprire `psql` per nominarsi
amministratore, allo scopo di provare la funzione che esiste per non aprire più `psql`, sarebbe una
barzelletta. In produzione ci si diventa con un `UPDATE` a mano, una volta.

**Si può cancellare qualunque asta, non solo le simulate.** Proposto di limitarlo alle simulate;
l'owner ha chiesto che valga per tutte. Non contraddice la regola 5, che vieta il `DELETE` *dentro*
un'asta — dove un fatto accaduto si annulla lasciando traccia — mentre buttare via una partita
intera è un atto dichiarato. Rifiutata su `LIVE` e `PAUSED`, solo all'owner, e la conferma è **il
nome digitato** e non un `confirm()`: per un gesto irreversibile un riflesso non è un consenso. Su
un'asta vera conclusa se ne vanno verbale e storico; l'unica traccia che sopravvive è una riga su
stdout, perché `events` va via nel cascade.

## 2026-08-10 — M5, Identità: registrazione con email e password

**Ci si discosta da `PLAN.md` §2, e lo si scrive.** Quella riga dice testualmente: «Login unicamente
con **Google OAuth**. Nessuna password, nessun invio email». M5 fa esattamente le tre cose che
esclude. È legittimo — `PLAN.md` è archivio, e ciò che resta vincolante per sempre sono i suoi
invarianti I1–I10, **nessuno dei quali viene sfiorato qui** — ma non è indolore, e va scritto perché
fra sei mesi la differenza fra «ci siamo discostati con cognizione» e «qualcuno non aveva letto» non
si ricostruisce. Ciò che §2 aveva ragione a temere resta vero e resta trattato: una password è un
segreto da custodire (scrypt, e non la si vede mai in chiaro fuori dalla richiesta che la porta), e
un invio email è una dipendenza esterna (SMTP e nulla più, sostituibile con quattro variabili).

**L'email è la chiave d'identità, e il vincolo sta a database.** `UNIQUE` su `lower(email)`,
parziale su `email IS NOT NULL` così le righe senza indirizzo (i bot) restano legali. Stessa logica
degli indici parziali di I1 e I2: se una regola si può rendere *impossibile* invece che sorvegliata,
si rende impossibile. Normalizzazione `trim` + `lower` e nient'altro — niente punti di Gmail, niente
`+tag`: sono convenzioni di un provider, e indovinarle vorrebbe dire trattare due indirizzi diversi
come lo stesso.

**L'aggancio è asimmetrico.** email+password → Google **sì** (si scrive il `google_sub` sulla riga
che c'è già); Google → email+password **no**. Il rifiuto nella seconda direzione tiene vera una frase
semplice — un account nato da Google entra da Google — e risparmia per sempre la domanda «cosa
succede se cambio la password di un account Google»: sarebbe un reset travestito, e se un giorno lo
vorremo lo vorremo dichiarato.

**⚠ Un aggancio Google su una riga non verificata azzera `password_hash`.** È la decisione meno
ovvia della macro e chiude un furto d'account: un malintenzionato registra *il tuo* indirizzo con
una password sua, non verifica (non gli serve), e quando tu entri da Google noi ti agganciamo a
quella riga — regalandogli la tua password. Chi entra da Google ha dimostrato di avere la casella;
quella password l'ha scritta qualcuno che non ha dimostrato niente. Se la riga **era già
verificata** la password resta: le due prove ci sono entrambe. Ha un test suo scritto **prima** del
codice dell'aggancio, e nel codice ha accanto l'attacco per esteso — non la regola, l'attacco: una
regola senza il suo attacco accanto è una riga che il prossimo semplifica.

**`crypto.scrypt`, non `bcryptjs`.** Non è una preferenza crittografica, è il processo unico:
`bcryptjs` è JavaScript puro e mangia l'event loop a fette per mezzo secondo per hash, mentre
`scrypt` è nativo e asincrono sul threadpool di libuv. Con dodici stream SSE aperti durante un
countdown, mezzo secondo di loop bloccato è mezzo secondo in cui nessuno riceve uno snapshot.
N=2^15/r=8/p=1 (~32 MB, un decimo di secondo su una CX22): N=2^16 costerebbe il doppio di memoria
per hash concorrente, e col rate limit davanti non lo giustifica. Formato `scrypt$N$r$p$salt$hash`,
così alzarli domani non invalida gli hash di ieri.

**SMTP generico con `nodemailer`, non l'SDK di MailerSend.** Cambiare fornitore dev'essere cambiare
quattro variabili in `.env`. È comunque una **dipendenza esterna nuova** — la prima del progetto — e
per questo è qui. Timeout di dieci secondi, perché è una chiamata di rete dentro una richiesta in un
processo solo. Fuori produzione non si configura nessun trasporto: **il codice va su stdout**, come
il provider `dev`, così l'intero flusso si collauda in locale senza credenziali.

**La verifica è un gradino di `requireUser()`, in mezzo agli altri due.** Non un flusso a parte con
un token suo. Tre ragioni: una sessione esiste già, quindi il reinvio è una server action
autenticata invece di una rotta pubblica da proteggere a mano; è la forma che l'app ha già; e la
verifica viene **prima** dell'onboarding perché non si raccoglie il nome di qualcuno per un
indirizzo che potrebbe non esistere. Accesso rigido: non verificato non fa niente. Prezzo dichiarato
— fra M5 e M6 il solo rimedio a un'email non arrivata è una `UPDATE` sul server.

**«Password dimenticata» entra nello scope**, benché il quaderno non la chiedesse. La macchina dei
codici la costruiamo comunque per la verifica: il recupero costa una colonna, una rotta e un form,
mentre non averlo costa una sessione SSH nel momento peggiore. Effetto collaterale gradito: `purpose`
nasce con **due** valori invece di uno, quindi non è un'astrazione prima del secondo chiamante.

**Un codice, non un link.** Niente token negli URL da farsi inoltrare per sbaglio, e una schermata in
meno. Ed è anche l'unico modo di *cambiare* la propria password: nessuna schermata «cambia password»
dentro l'app, perché sarebbe una seconda macchina per fare ciò che questa già fa.

**Il reset non tocca `email_verified_at`.** Sarebbe difendibile — la prova è la stessa che darebbe il
codice di verifica — ma non è un dead-end lasciarlo così (chi non era verificato entra e trova
`/verify`, che il codice glielo rimanda), e le regole dell'identità si contano. In caso serva, è un
cambio di una riga.

**Il reset non invalida le sessioni già aperte altrove.** Le sessioni sono JWT e non righe a
database (P17); revocarle vorrebbe dire una colonna `sessions_valid_from` più un controllo nel
callback `jwt`. Complessità reale per una minaccia che, con dodici amici e il dato «chi ha pagato
Lautaro 180», non la giustifica. Scritto qui perché sia un limite noto e non una scoperta.

**Dall'enumerazione degli account non ci si difende.** Diciamo «questo indirizzo è già registrato con
Google», che è utile, e non aggiungiamo ritardi finti per pareggiare i tempi di risposta. Ciò che
protegge un account non è il silenzio, è la password. Sta qui perché fra sei mesi non sembri una
dimenticanza.

**Il rate limit è una `Map` in memoria, e non è un compromesso.** Con `exec_mode: "fork"` e
`instances: 1` esiste un processo solo, quindi il contatore è **globale ed esatto**, non
un'approssimazione per nodo. Niente Redis — non per divieto: perché non servirebbe a nulla. Copre
login e registrazione; verifica e reinvio no, perché cinque tentativi e sessanta secondi sono già
righe nella tabella `email_codes`, e un limite scritto a database sopravvive a un riavvio.

**`clientIp()` legge l'ultimo elemento di `X-Forwarded-For`, non il primo.** Verificato che
`deploy/nginx-asta.conf` imposti l'header in entrambi i blocchi — senza, il limite per IP sarebbe un
limite su `127.0.0.1`, cioè un limite globale mascherato. Ma `$proxy_add_x_forwarded_for` **accoda**
al valore ricevuto invece di sostituirlo, e quel valore lo scrive il client: prendere il primo — la
lettura ovvia della specifica dell'header — renderebbe il limite aggirabile mandandosi un header a
mano. L'ultimo è l'unico che ha scritto nginx.

**Fuori produzione decide la presenza di `SMTP_HOST`, non `NODE_ENV`.** La spec (§7) diceva «fuori
produzione il codice va su stdout, punto»; alla prima prova del flusso è emerso il buco pratico che
quella regola lascia: **le credenziali del provider non si possono collaudare finché non sono in
produzione**, cioè si scoprono la sera dell'asta, che è l'unico momento in cui non si vuole
scoprirle. Da qui la regola nuova, scelta dall'owner: senza `SMTP_HOST` si stampa sullo stdout (il
default della spec, invariato per chi clona il progetto), con `SMTP_HOST` si manda davvero anche in
locale.

Due limiti su cui la regola **non** si applica, e sono deliberati. **In produzione si manda sempre**,
e se l'SMTP è mal configurato l'invio fallisce invece di ripiegare sullo stdout: altrimenti un `.env`
sbagliato scriverebbe i codici nei log del server, e §7 dice l'opposto — in produzione l'unico modo
di leggere un codice dev'essere la casella di posta. **Sotto test non si manda mai**, qualunque cosa
dica il `.env`: `vitest` carica lo stesso `.env` dell'applicazione, quindi senza quel blocco un test
che chiamasse `sendCode` senza mockare `lib/mail` spedirebbe email vere a indirizzi `@test.invalid`
a ogni `pnpm test`.

Il prezzo dichiarato della regola: **un `.env` di produzione copiato in locale manda email vere**. È
stato sollevato in fase di scelta e accettato; si torna allo stdout svuotando `SMTP_HOST`.

**Le SMTP mancanti avvisano, non fermano il boot.** `deploy/ecosystem.config.cjs` fa fallire l'avvio
se manca una delle cinque variabili storiche; per le cinque dell'SMTP stampa un avviso. Farne un
errore fatale vorrebbe dire che il giorno del deploy di M5 l'applicazione non si avvia affatto —
molto peggio del problema che eviterebbe, visto che senza SMTP il login Google continua a funzionare
per tutti.

---

## 2026-08-11 — M6, Amministrazione: il pannello

**Lo scostamento da `PLAN.md` §2, ed è uno scostamento, non una lettura estesa.** Il piano diceva:
«`users.is_admin` — admin di piattaforma: vede tutte le aste e tutti gli utenti. **Sola lettura**».
Il pannello di M6 non è in sola lettura: corregge il nome di una persona, forza la verifica del suo
indirizzo, dà e toglie `is_admin`, e cancella un'asta di qualcun altro. La deroga è deliberata e vale
la pena dire cosa l'ha giustificata, perché il criterio serva la prossima volta: **ognuna delle
quattro scritture esiste per chiudere un buco che altrimenti si chiude con una sessione SSH.** Il
nome sbagliato si correggeva con una `UPDATE`; la verifica manuale era letteralmente una riga di SQL
scritta per esteso in `docs/features/05-identita.md` §9; `is_admin` si dava a mano a database;
l'asta di qualcun altro non si cancellava affatto. Una scrittura che sostituisce `psql` alle nove di
sera non è la stessa cosa di una scrittura che aggiunge un potere.

Il confine è rimasto quello del piano dove il piano aveva ragione: **nessuna scrittura sullo stato di
un'asta**. Configurare, avviare, mettere in pausa, correggere una rosa restano dell'owner, dalla
regia. Due posti da cui si comanda la stessa asta sono due verità sullo stesso stato.

**I8 si rispetta per assenza, e la differenza conta.** La lista aste non mostra lotti, offerte, rose
né crediti. La versione «mostra lo stato di gioco, sanificando» avrebbe funzionato il primo giorno e
sarebbe stata un campo nuovo lontano dal rompersi: si onora un'invariante togliendo la possibilità di
violarla, non ricordandosi di non violarla. Per questo il test guarda **l'insieme esatto delle chiavi
della riga** e non l'assenza di un campo per nome: è la stessa scelta del test I8 di F4-08, e per lo
stesso motivo — un campo morto nominato in un test non protegge da un campo vivo con un altro nome.

**La guardia sta in ogni server action e non solo nel layout.** Non è una precauzione ridondante: una
server action è un endpoint raggiungibile da sé, che nessun layout attraversa. Il pannello ha tre
piani di difesa che rispondono a tre domande diverse — `requireAppAdmin()` in cima a ogni pagina e a
ogni azione (chi entra), il motore che rilegge `is_admin` dal database a ogni scrittura (chi comanda
*adesso*, dato che la sessione è un JWT e un declassato ha ancora il suo token), e un test che
enumera gli export del modulo delle azioni con un'uguaglianza esatta (chi se ne ricorderà la prossima
volta). Il terzo piano è quello che invecchia meglio: le prime due righe si dimenticano di scrivere,
la lista di nomi si rompe da sola.

**`is_admin` non si tocca sulla propria riga, in nessuna delle due direzioni.** Un click e ci si
chiude fuori tutti, e senza pannello non si rientra dal pannello. Il divieto copre anche il caso
innocuo — riconfermarsi un permesso che si ha già — perché l'eccezione «ma questo verso è sicuro» è
il gradino da cui rientra quello pericoloso.

**L'email è in sola lettura, e resta un no.** Da M5 è la chiave d'identità: riscriverla cambia *chi
può entrare* in quell'account. Un indirizzo sbagliato si risolve rifacendo l'account, che a dodici
utenti è praticabile. Un amministratore che riscrive l'indirizzo di qualcun altro è un potere che
questa applicazione non ha motivo di avere.

**Il prezzo della verifica forzata, dichiarato.** Da M5, quando Google si aggancia a una riga non
verificata, `password_hash` viene azzerato: è la difesa contro chi si registra con l'indirizzo di
qualcun altro e aspetta. Su una riga verificata quella difesa non scatta — giustamente, perché
l'indirizzo è dimostrato. Quindi **il pulsante mette la parola dell'amministratore al posto della
prova**, e disattiva quella difesa per quella riga. Non è un difetto del pulsante, è cosa vuol dire
premerlo: si preme per una persona che si ha davanti. Scritto qui perché fra sei mesi non sembri una
svista.

**Lo stop degli utenti: valutato e rimandato.** Il quaderno chiedeva «valutare», la valutazione è
stata fatta, e la decisione dell'owner è di non implementare nulla per ora. Il ragionamento è
conservato in `docs/features/06-amministrazione.md` §6 e non va rifatto da zero: in sintesi, lo stop
non serve a fermare l'owner — a token scaduto è già fermo — serve perché **l'asta va avanti da sola
senza di lui**, e la conclusione a cui si era arrivati è *rifiutare* lo stop di chi è dentro un'asta
`LIVE` o `PAUSED`, come owner o come membro, invece di mettere in pausa a cascata. La cascata non ha
una storia transazionale: N aste sono N lock separati, e «due aste in pausa su tre e poi ho fallito»
è un caso senza una risposta buona. Se un giorno si riprende, il nome è `users.suspended_at`.

**«Super admin» e `is_admin` sono la stessa cosa.** Un secondo livello di amministrazione su due
persone è una gerarchia senza nessuno da gerarchizzare.

**Niente log di audit delle azioni dell'admin.** Le tre azioni sull'utente sono correzioni di dati; la
sola distruttiva — la cancellazione di un'asta — scriveva già la sua riga su stdout con `actor`
dentro. Una cancellazione fatta da un amministratore era quindi tracciata **dal giorno in cui quella
riga è stata scritta**, senza aggiungere niente. È raro e vale la pena notarlo: una decisione presa in
M4 per un altro motivo ha coperto gratuitamente il caso di M6.

**Due funzioni salite di livello, e in entrambi i casi il secondo chiamante è arrivato davvero
(regola 8).** `normalizeDisplayName` era dentro `setDisplayName` in `lib/auth.ts` ed è passata in
`lib/domain.ts`, perché l'amministratore che corregge un nome deve applicare la stessa regola
dell'onboarding — due idee di nome valido sono una in più di quelle che servono. E `isVerified` ha
ora un parametro **strutturale** invece del tipo `User`: la tabella del pannello chiede «è
verificato?» su una riga sua, e deve poterlo fare senza importare un tipo da `lib/db/schema`, cioè
senza fare esattamente ciò che la regola ESLint vieta. La condizione resta una sola, ed è quella che
il secondo gradino della scala interroga.

**`deleteAuction` si è allargata di una riga e non è stata riscritta**, e il rifiuto su `LIVE` e
`PAUSED` non si è allentato per l'amministratore: la pausa congela la fase, non azzera l'asta. C'è un
test che lo dimostra per entrambi gli stati, invece di darlo per scontato — era una funzione dove
«tanto è admin» sarebbe stata una modifica di una parola.

---

## 2026-08-11 — M7, Le figurine dei calciatori

**Il collaudo prima della spec, e le tre semplificazioni che ha imposto.** Il downloader è stato
provato sui 495 id di un listone vero *prima* di scrivere una riga: 495 su 495, 51,56 MB in **7,3
secondi**, zero errori, zero `403`. La spec che esisteva fino a quel momento era costruita attorno a
un'operazione lunga, ed è caduta in tre pezzi. **Primo: niente batching.** Lo scaricamento a lotti da
venticinque, la lista degli id parcheggiata in un `listone.json`, la pagina che si richiama da sé e
il pulsante «Ferma» servivano a sopravvivere a un'attesa che non esiste; al loro posto c'è una server
action che fa il lavoro dentro la richiesta. **Secondo: niente marcatori per gli assenti.** Ci si
aspettava un `403` per chi non ha la caricatura, e quindi un file `.none` per non riprovarlo
all'infinito; invece quel CDN risponde con una sagoma, che è un `200` — non c'è nessun assente da
marcare. **Terzo: niente riquadro ad altezza variabile**, perché ogni giocatore del listone ha
un'immagine. La domanda «l'hai provato?» è arrivata dall'owner, non da Claude, ed è il precedente da
citare la prossima volta che qualcosa va scaricato da fuori.

**La scadenza è a 20 secondi, e il numero non è arbitrario.** `location /` in
`deploy/nginx-asta.conf` non imposta `proxy_read_timeout`, quindi vale il default di 60 secondi — il
timeout lungo di un'ora è solo sulla rotta dello stream. Venti secondi sono tre volte il misurato e
un terzo del taglio del proxy: se un giorno il CDN fosse dieci volte più lento, la passata si ferma
da sé e dice quante ne restano invece di farsi tagliare a metà da nginx. È ciò che resta del
batching, e sono tre righe.

**Lo stato è il disco, quindi lo schema non è stato toccato.** «Questa figurina ce l'abbiamo?» lo
risponde un file che c'è o non c'è. Una tabella `campioncini` avrebbe aggiunto un secondo posto dove
la stessa domanda ha una risposta, cioè un posto dove disallinearsi: un file cancellato a mano e una
riga che resta è un'immagine rotta per sempre. Senza tabella l'operazione è ripetibile per
costruzione, e non c'è nessun `pnpm db:push` né backfill in questo rilascio.

**`storage/` e non `public/`, ed è una trappola vera, non un'ipotesi.** Il server standalone fa
`process.chdir(__dirname)`, quindi la sua `public/` è `.next/standalone/public`, che
`deploy/deploy.sh` cancella e ricopia a ogni rilascio: 53 MB di figurine sarebbero spariti al primo
deploy successivo, in silenzio, con il sintomo «non si vedono più» e nessun errore. `storage/` sta
fuori da git e non viene toccata né da `pnpm build` né da `git reset --hard` — verificato con un file
finto **prima** di scrivere il downloader, perché tutto il disegno dell'archivio poggia su quello.
`MEDIA_DIR` lo calcola `deploy/ecosystem.config.cjs` dalla radice del progetto, così in produzione non
c'è nessun percorso da mettere a mano; anche questo verificato valutando davvero il file con Node,
invece di fidarsi della lettura.

**La difesa della rotta è una sola, ed è «non usare la stringa».** Il parametro accetta soltanto
`^\d+\.png$` e ne esce un intero; il percorso lo costruisce una funzione da quell'intero, e la
stringa arrivata da fuori non tocca mai `path.join`. Sanificare sarebbe stato il modo sbagliato di
avere ragione: una sanificazione si può scrivere male, un valore che non viene usato no. Il rifiuto è
un **`400` e non un `404`**, e la differenza è l'evidenza: `400` vuol dire prima del filesystem. Il
test è stato scritto prima della rotta ed è stato visto fallire.

**Un formato solo, la `card` 255×378.** Esistono anche `medium` e `small`, ma un formato solo
significa un file per giocatore, un indirizzo e un solo caso «manca», e la `card` sta bene su
entrambi gli schermi che la mostrano. Niente ritaglio, ridimensionamento o conversione in WebP: 53 MB
stanno su un disco da 40 GB, e un'immagine ritoccata è un'immagine da ritoccare di nuovo alla
prossima edizione.

**Le sagome senza volto si tengono, e non si riconoscono.** 144 su 495 — verificato di nuovo in
questa sessione, e sono 144 in 20 varianti. La sagoma è riconoscibile per quello che è, tenerla
mantiene il riquadro del lotto sempre della stessa forma (altrimenti quasi un lotto su tre
sposterebbe il pulsante d'offerta sotto il pollice), e scartarle vorrebbe dire venti impronte scritte
nel codice **che cambiano alla prossima edizione**: un riconoscimento che un giorno smette di
funzionare in silenzio.

**Il fallback è `onError` che nasconde l'immagine**, non un segnaposto grigio: un rettangolo vuoto
segnalerebbe un'assenza, e l'unica assenza rimasta — l'archivio non ancora riempito — non è un
guasto, ed è comunque uniforme perché in quel caso non ce l'ha nessuno. Lo stato del componente tiene
**quale** id ha fallito e non un booleano, così al cambio di lotto la figurina nuova riparte da sola:
una `key` che chi chiama deve ricordarsi di passare è una difesa che prima o poi si dimentica.

**Un `<img>` e non `next/image`.** Le figurine sono già alla dimensione giusta e le serve una nostra
rotta che legge un file dal disco: passare dall'ottimizzatore vorrebbe dire un secondo giro sul
server per riconvertire un PNG che va benissimo com'è.

**Gli id vengono da un listone di riferimento, non dalle aste.** L'archivio è globale e sopravvive
alla cancellazione di un'asta, che da M6 è facile; agganciare lo scaricamento all'import del listone
di un'asta l'avrebbe legato al ciclo di vita sbagliato. Il `.xlsx` non si conserva, come in P6.

**Il test di M6 sugli export delle server action ha fatto esattamente il suo lavoro.** L'uguaglianza
esatta si è rotta all'aggiunta di `downloadCampionciniAction`, ed è stata sistemata aggiungendo la
guardia `requireAppAdmin()` e il nome alla lista nello stesso momento — non allentando l'uguaglianza.
È il secondo rilascio consecutivo in cui quel test paga il proprio costo.

**Il test I8 passava, ma passava per il motivo sbagliato.** `extId` è stato aggiunto **dentro**
`player`, e l'insieme esatto delle chiavi che quel test confronta è quello di primo livello di
`currentLot`, dove `player` era già presente: il campo nuovo non ha svegliato nessuno, che è
precisamente ciò che il commento in cima a quel file dichiara di voler evitare. Il campo di M7 è
innocuo — il giocatore in asta è pubblico, è la busta a essere segreta — ma il giocatore è la sede
naturale di un dato che riguarda «questo lotto», e il prossimo campo potrebbe non essere innocuo. Da
qui in poi anche le chiavi del giocatore sono un insieme esatto, e la nuova asserzione è stata vista
fallire prima di essere creduta.

**La voce del pannello si chiama «Figurine» e il segmento è in italiano**, a differenza di `users` e
`auctions`. `campioncini` è il nome che usa il CDN di Fantacalcio.it ed è la parola che sta nel
codice; «figurina» è la parola che si usa nella stanza. La navigazione parla la seconda lingua.

**Il modale d'offerta è diventato il terzo posto dove si vede la figurina, e §6 diceva «due, e sono
due».** La spec era stata scritta guardando card e TV; usandola, l'owner ha chiesto la figurina anche
nel modale, ed è la richiesta giusta per la ragione che la macro esiste — il modale è il posto dove
si guarda il giocatore *mentre si decide quanto mettere*. Restano fuori regia, rose e storico: §9 non
si è mossa.

**Nel modale sta di fianco e non sopra il nome, e la differenza l'ha decisa la tastiera.** Era nata
centrata sopra il nome, che è dove l'occhio la cerca. Ma quello sheet arriva dal basso e con la
tastiera aperta **l'altezza è la risorsa scarsa**, mentre la colonna a sinistra del testo era spazio
già disponibile: di fianco non costa nessuna riga, sopra ne costava ~140 pixel proprio quando ne
restano di meno. Stessa misura della card che sta dietro (68×100), perché è lo stesso giocatore nello
stesso momento e vederlo cambiare taglia aprendo il modale sarebbe un movimento senza significato.

**Il campo dell'offerta prende il focus all'apertura: una decisione di F5 ribaltata, non dimenticata.**
Fino a v1.7.0 il focus veniva tolto esplicitamente, con la sua riga di commento: il modale si apre
**da sé** all'inizio del round, e una tastiera che sale senza che nessuno l'abbia chiesta copre due
terzi dello schermo nell'istante peggiore. Il ribaltamento viene dall'uso, ed è motivato: quel timore
descriveva **l'apertura**, non l'uso — il modale lo si apre per scrivere un numero, e trenta secondi
di countdown non lasciano spazio a un tocco in più. E il costo che la vecchia scelta temeva era già
stato pagato dal layout: countdown e `max_bid` stanno nell'intestazione dello sheet proprio perché
restino leggibili sopra la tastiera. `preventDefault` è rimasto — senza, Radix darebbe il focus al
pulsante «−1» — e il valore già presente viene selezionato, così chi rientra a metà round sovrascrive
digitando invece di dover cancellare.

---

## 2026-08-12 — M8, gli insight sul listone

**Una tabella globale, non colonne su `players`.** `player_insights` ha per chiave l'`ext_id` e
nessun `auction_id`: un aggiornamento serve tutte le aste e sopravvive alla cancellazione di
un'asta. Metterle come colonne di `players` avrebbe voluto dire ricopiare 497 righe di dati di
mercato dentro ogni asta e rifare l'import a ogni listone caricato. Il precedente è l'archivio
figurine di M7, tenuto fuori dal ciclo dell'asta per la stessa ragione: un dato di mercato non è un
fatto dell'asta. Il prezzo di questa scelta è che la tabella **non si isola per asta**, e si vede nei
test (sotto).

**Scartati i file .xlsx di Fantacalcio.it.** Il file *Quotazioni* è ridondante con l'export delle
Leghe che già usiamo — che ha in più `Fuori lista`, da cui dipende I9. Il file *Statistiche* ha
numeri che combaciano esatti con la fonte scelta, ma **non ha `starts_eleven` né
`min_playing_time`**, cioè proprio i due campi per cui la macro esiste: `Pv` misura «ha preso il
voto», non «è partito titolare», e sui due casi di prova (Berardi 26 presenze di cui 24 da titolare,
Bernardeschi 24 di cui 12) li tratterebbe da pari. Restano come possibile ripiego se la fonte
diventasse instabile.

**`injured` non entra, pur essendo disponibile.** Il campo esiste nella fonte ma è un **conteggio
degli infortuni della stagione**, non lo stato attuale: valori 0–5, e correla al contrario (media
presenze 20,3 con `injured = 0` contro 24,5 con `injured > 0`). Su richiesta esplicita dell'owner
sarebbe entrato solo potendo dire «è infortunato *adesso*», e la verifica ha risposto di no per una
ragione di calendario: `fantacalcio.it/probabili-formazioni-serie-a` serve quel dato pubblicamente,
con l'`ext_id` dentro, ma **si popola a campionato in corso** — interrogata il 2026-08-11 conteneva
0 titolari attesi e 4 infortunati in tutta la Serie A — e l'asta si fa ad agosto. Un numero che
sembra rispondere a una domanda a cui non risponde è peggio di un numero assente. È annotato come
l'aggiornamento più ovvio della macro, e **corregge la spec di partenza**, che dava quei dati
raggiungibili solo dal `POST /guida` di Fantalab protetto da JWT.

**`is_pro` è prodotto, non licenza.** Le due fonti sono pubbliche: non c'è nessun vincolo esterno che
obblighi a limitare chi vede gli insight. È una scelta di prodotto — un vantaggio informativo che si
riserva — ed è scritto nello schema perché non venga difeso un giorno con un argomento che non ha.
Conseguenza: **nessun `CHECK NOT (is_pro AND is_bot)`** (un bot pro è insensato ma innocuo, mentre un
bot amministratore è un conflitto vero) e **nessun divieto di toccare la propria riga** in
`setUserPro`, a differenza di `setUserAdmin`: là il divieto esiste perché togliersi `is_admin` chiude
fuori dal pannello e non c'è un'altra porta, qui il flag non apre niente.

**La protezione sta nella query, non nel JSX.** `PoolPlayer` è una prop di un client component, cioè
arriva nel browser di chiunque apra la pagina: nascondere gli insight in JSX o in CSS sarebbe una
decorazione. `listPickPool(auctionId, withInsights)` decide **una volta**, e per chi non ha il
permesso la chiave `insights` non esiste nell'oggetto — non è un `null` da nascondere. Il test
asserisce sull'oggetto restituito e non sul render, che è la differenza fra un dato protetto e un
dato nascosto. Entrambi i chiamanti (portale e regia) passano `canSeeInsights(user)`: **la regia non
è un'eccezione**, un owner senza permesso non li vede nemmeno lì.

**`serializeSnapshot` non è stato toccato.** Gli insight viaggiano nel pool, che la pagina carica per
quel singolo viewer; lo snapshot è uno solo e va in broadcast a tutti, quindi metterceli vorrebbe
dire mandarli anche a chi non li può vedere. I8 attraversa M8 senza che una riga del motore cambi.

**Si mostra solo la stagione corrente.** Nella risposta convivono 329 righe `current` e 168
`previous`: la colonna `stats_season` le distingue e la UI mostra soltanto le prime, le altre come
`—`. Questa scelta cancella da sé anche il problema delle 32 righe in cui `presenze` e
`display_presenze` divergono, che sono tutte `previous`. Fra i due campi si legge `display_presenze`,
perché è il numero che la fonte stessa mostra.

**La soglia guarda la continuità, non la copertura.** Prima versione: «sotto una certa copertura dei
listoni delle aste, non scrivere». È **avvelenabile** — il listone di un'asta simulata ha `ext_id`
sintetici da 1 a 40, quindi una sola asta di prova nel database avrebbe fatto fallire l'import su
dati perfetti. Un controllo che si può far scattare da un'altra parte dell'applicazione non è un
controllo. La continuità (85% di identificativi in comune con l'import precedente, saltata al primo
import) misura ciò che si vuole davvero sapere: se la fonte parla ancora la stessa lingua. La
copertura resta, ma **come informazione nel pannello** — per asta, e non aggregata, perché la domanda
è «il *mio* listone è coperto?».

**Tre errori di misura, corretti dal codice e non dalla spec.** Vale la pena scriverli perché
riguardano il metodo, non il dominio. (1) I numeri della pagina dei rigoristi nella prima stesura
erano sbagliati — 87 designati, 57 rigoristi — e l'errore era in uno script d'analisi usa-e-getta,
non nella pagina: sono **92 e 60**, e i cinque «di troppo» erano nomi con l'accento, che nello slug
arrivano come entità HTML (`…/roma/soul&#xE8;/5734`). Un conteggio ottenuto con uno script
usa-e-getta non è un dato verificato. (2) `max()` scritto in SQL grezzo restituisce una **stringa**,
non una `Date`: il tipo dichiarato era una promessa falsa, e il test l'ha trovata con un `getTime is
not a function`. (3) `insightsCoverage` guardava le cinque aste più recenti e basta: siccome vitest
gira i file di test in parallelo e gli altri file creano decine di aste, il test della copertura era
**verde da solo e rosso nella suite**. Ora la funzione accetta anche delle aste precise.

**Tutti i test di M8 stanno in un file solo, e non va spezzato.** Ogni altro test del database si
isola creandosi le proprie aste, e la cascata su `auction_id` fa il resto; `player_insights` non ha
nessun `auction_id` da cui dipendere, quindi due file che la riempissero e svuotassero in worker
paralleli si guasterebbero a vicenda. È il costo della scelta globale in cima a questa voce, ed è
scritto in testa al file di test.

**La voce del pannello si chiama «Listone» e sta dopo «Figurine».** Sono le due voci che non parlano
di righe legate a un'asta e si somigliano, ma quella che conta di più sta prima: una figurina si vede
da tre metri, una percentuale di titolarità si legge col telefono in mano.

---

## 2026-08-12 — La guardia del deploy ignora le aste simulate

**`deploy/deploy.sh` blocca il deploy solo per un'asta `LIVE` o `PAUSED` non simulata.** Prima
contava tutte, e il caso è successo davvero durante il rilascio di v1.9.0: «FerroAsta», una
simulazione messa in pausa il giorno prima, ha annullato il deploy. Il problema non era il singolo
blocco ma l'assenza di una via d'uscita: **una simulazione in pausa non si può chiudere** —
`deleteAuction` rifiuta `LIVE` e `PAUSED` anche a un amministratore, non esiste un'azione «termina
asta», e a `COMPLETED` si arriva solo giocando fino in fondo. L'unico rimedio praticabile era
ricordarsi `DEPLOY_DURING_AUCTION=1` a ogni rilascio, cioè **abituarsi a scavalcare la guardia**: il
modo esatto in cui una guardia smette di proteggere il giorno che serve davvero.

La motivazione originale — «un minuto di silenzio con dieci persone che aspettano è un minuto di
panico» — in una simulazione non si applica: aspettano dei bot, e il boot recovery li rimette in moto
da solo. Le simulate in corso vengono comunque **stampate** nell'output del deploy: un deploy che
passa senza dire cosa ha scavalcato insegna a non leggere il suo output.

⚠ **La guardia gira prima del `git reset --hard`**, quindi lo script che decide è sempre quello già
presente sul server: questa modifica entra in vigore dal deploy **successivo** a quello che la
installa. Il primo, se una simulata è in pausa, vuole ancora la variabile d'ambiente.

Fatta direttamente su `dev` senza aprire una macro, su richiesta esplicita dell'owner — è una riga di
uno script di rilascio, non una feature.

---

## 2026-08-12 — Pianificazione di M9–M12

Sessione di analisi delle quattro richieste scritte nel quaderno dopo v1.9.1. **Nessuna macro aperta e
nessuna riga di codice scritta**: qui stanno le scelte prese pianificando, perché sono scelte, e
`DECISIONS.md` si aggiorna al momento della scelta e non al momento dell'implementazione. Le spec
stanno in `docs/features/09-badge-insight.md`, `10-listone-a-sistema.md`, `11-refresh-giornaliero.md`,
`12-cancellazione-aste.md`.

**Quattro macro invece di una, per profilo di rischio.** Le richieste sembravano un tema solo
(«sistemiamo il pannello»). Sono quattro: **M9** è tutta UI (zero schema, zero motore); **M10** tocca
la strada dell'import, cioè l'unica cosa che se si rompe rende impossibile *preparare* un'asta, e vuole
un `db:push` più un file caricato a mano in produzione; **M11** è l'unico codice che gira **senza che
nessuno guardi** dentro il processo che conduce l'asta; **M12** è l'unico irreversibile — un suo errore
si corregge con un `pg_dump`, non con un `git reset`. È lo stesso criterio del taglio M5/M6 del
2026-08-10: quattro tag, quattro punti di rollback. Scartato l'accorpamento M9+M12 («sono le due
piccole»): una è un `className`, l'altra un `DELETE` su i dati di una serata vera.

**«Listone» nel pannello sono due file, e solo uno si può chiedere da sé.** L'export **Leghe** in
`.xlsx` definisce l'asta e porta `Fuori lista`, da cui dipendono I9 e il toggle P7; il pulsante di M8
chiamato «Importa il listone» è la `GET` pubblica di Fantalab e porta gli insight. Il refresh
automatico giornaliero (M11) riguarda **le due fonti pubbliche di M8**; il listone d'asta **resta un
upload a mano** perché l'export passa da un login (owner, 2026-08-12: «l'export passa da un login,
quindi non creiamo collegamenti»). Il file *Quotazioni*, pubblico, resta scartato per la ragione già
scritta nella voce di M8: non ha `Fuori lista`. È da questa distinzione che nasce la separazione fra
M10 e M11, e non da una comodità di taglio.

**Il badge «Infortunato (ora)» è ritirato.** Era nella richiesta, in rosso. La misura di M8 §9 dice che
il dato non è disponibile **nel momento in cui servirebbe**: `infortunati-serie-a` serve i dati lato
client (da server non c'è niente da leggere) e `probabili-formazioni-serie-a`, che li serve pubblici con
l'`ext_id` dentro, interrogata l'11 agosto conteneva 0 titolari, 0 riserve, 4 infortunati e 1 dubbio in
tutta la Serie A. Si popola a campionato in corso, **e l'asta si fa ad agosto**: un badge rosso che non
compare mai la sera per cui esiste l'applicazione, e che se comparisse su dati di tre settimane prima
sarebbe una bugia. Ritirato dall'owner in sessione. ⚠ E non si ripiega sul campo `injured` della fonte
A, che è un conteggio stagionale e correla al contrario.

**Si scrive «Piazzati», non «Punizioni».** La richiesta diceva «Punizioni». La fonte ha due liste per
squadra — `Rigori` e `Calci piazzati` — e la parola «Punizioni» compare **zero volte** nell'HTML (M8
§1, smentita 2). «Calci piazzati» include le punizioni **e i corner**: un badge «Punizioni» sull'uomo
dei corner direbbe una cosa falsa nel momento esatto in cui nessuno va a controllare. Non è una
preferenza di stile, è la differenza fra un'etichetta e un'affermazione.

**La soglia del verde è 80%, e la misura c'era prima della spec.** Contata sulla fixture della fonte A
(i byte del 2026-08-11) con la `quotaTitolare` vera: **61 giocatori su 497 sopra l'80%** (12,3%), di cui
25 difensori, 22 centrocampisti, 8 portieri e **6 attaccanti** — gli attaccanti ruotano. A 70% sarebbero
101, cioè un nome su cinque, che è il punto in cui un colore smette di essere un segnale. ⚠ La soglia
cade in una zona densa (un grumo a 32/38 = 84%, e 30/38 = 79% resta grigio) e regge **solo perché la
percentuale è scritta dentro il badge**: se un giorno il numero uscisse dal badge, la soglia diventerebbe
una bugia.

**`PLAN §8bis` punto 1 è abbandonato di proposito.** Il banner globale «Asta in corso» — «il modo con
cui un utente rientrato trova la strada da solo» — viene rimosso da tutte le pagine e per tutte le aste
(owner, 2026-08-12: «via del tutto, in ogni asta»). Non è un invariante I1–I10, quindi si può; ma quel
punto del piano ha smesso di valere, e un archivio vincolante che dice una cosa diversa
dall'applicazione è peggio di un archivio senza quella riga. Al suo posto resta **la dashboard**. Non
cambia nulla di I10: la UI continua a essere funzione dello snapshot, e la lobby che porta su `/play`
all'avvio — l'unica navigazione automatica dell'applicazione, decisa dallo snapshot e non da un evento
— non si tocca. Guadagno collaterale: il layout radice smette di chiamare `listUserAuctions` a ogni
richiesta di ogni utente autenticato.

**Il gate del pannello sta solo su «Caricature», non su «Insight».** La richiesta chiedeva entrambe le
sottosezioni inerti finché il listone non è caricato; la decisione è stata delegata in sessione. Le
caricature hanno una dipendenza vera (hanno bisogno dell'elenco degli `ext_id`, che oggi arriva da un
`.xlsx` ricaricato ogni volta). Gli insight no: le due fonti creano righe con chiave `ext_id` e non
sanno che esistiamo, quindi un pulsante disabilitato **che funzionerebbe** è una bugia
dell'interfaccia — la stessa che M8 §6 ha rifiutato quando ha messo la protezione nella query invece
che nel CSS. E il gate che serve dentro quel blocco esiste già ed è vero: «Aggiorna i designati» è
spento finché la tabella è vuota, perché la fonte B aggiorna righe che nascono dalla A. ⚠ La ragione
decisiva è M11: il refresh partirà da sé ogni giorno, e un pulsante bloccato accanto a «aggiornato
automaticamente tre ore fa» sarebbe incoerente — lo scriveremmo in M10 per cancellarlo in M11.

**Il Centro dati resta in admin, e senza `FVM/1000`** (owner). Quindi `canSeeInsights` non entra in
quella pagina: un amministratore vede gli insight per costruzione, e aggiungere il predicato darebbe
l'impressione di una seconda regola da tenere allineata. ⚠ **Ma `fvm` resta nella tabella
`listone_players`**: la decisione riguarda una colonna a schermo, non il dato. `players_autopick_idx`
ordina per `fvm` DESC, `quot` DESC, `ext_id` ASC, e quell'ordinamento *è* l'auto-pick — una copia verso
`players` senza `fvm` cambierebbe chi viene scelto allo scadere di una chiamata, per una decisione di
layout.

**Il listone a sistema è una sorgente da cui si copia, mai una tabella da cui l'asta legge.**
`players.auction_id` continua a congelare la lista: un'asta preparata lunedì non può cambiare listone
perché martedì l'admin ha caricato un file nuovo. I9 continua a essere validato **per asta**, al momento
della copia, con lo stesso `validateRolePool` — lo stesso listone globale può passare per un'asta a 8 e
fallire per una a 12, ed è giusto che fallisca. L'upload nel setup dell'asta **resta** (owner:
«lasciamo comunque la possibilità di importare l'attuale listone al cliente»): serve a correggere un
file sbagliato e a preparare un'asta il giorno in cui a sistema non c'è ancora niente.

**La copertura degli insight resta un'informazione, non diventa una guardia.** Con un listone a sistema
la copertura ha finalmente un denominatore vero, e va nel pannello. Ma la **continuità all'85%** resta
l'unico controllo che sbarra un import: sostituirla con una soglia di copertura sul listone a sistema
rimetterebbe in piedi il controllo avvelenabile che M8 aveva smontato — questa volta avvelenabile da un
file caricato per sbaglio invece che da un'asta simulata.

**La regola 5 non è in mezzo alla cancellazione forzata di un'asta**, e non è
un'interpretazione: è già ratificato nella voce del 2026-08-07 (Fase 1) che ha messo
`ON DELETE CASCADE` su tutte le chiavi verso `auctions`, `assignments` e `ledger` compresi — *«la
regola 5 vieta `DELETE` e `UPDATE` distruttivi **come correzione** dentro un'asta viva … cancellare
un'asta intera è un'altra cosa»*. Le cascate esistono per rendere possibile questo. E «solo gli utenti
non si cancellano» è già vero per direzione delle chiavi: è `members.user_id` che punta a `users`, non
il contrario. Quindi M12 è **una riga di condizione** — il rifiuto su `LIVE`/`PAUSED`, che resta per
tutti e cade solo per un amministratore (owner) — più tutto il lavoro di §2–§3 del suo file, che è la
parte vera.

**Il caso che `PLAN §8bis` non contempla: l'asta non esiste più.** Letto nel codice, non ipotizzato.
`resolveViewer` gira **una volta sola**, all'apertura dello stream: dopo un `DELETE` la connessione
resta nel registro, i `: ping` continuano ad arrivare e **nessuno snapshot arriva mai più** — il
portale resta fermo sull'ultimo, con il countdown congelato, e sembra *lento* invece che rotto. Chi
ricarica trova un errore su cui l'`EventSource` **riprova all'infinito** da sé. Il timer armato invece è
innocuo: `withAuctionLock` su un'asta assente restituisce un `NOT_FOUND` tipizzato, non un'eccezione.
Serve quindi un **evento terminale** sul canale, mandato via **hook settabile** (come `setBroadcastHook`
— il motore non deve sapere che esiste un canale verso i client), e sul client `source.close()`
**prima** della navigazione: senza quel `close()` esplicito il congedo diventa un ciclo di riconnessioni.

**La guardia del deploy resta com'è, anche quando le simulate si potranno cancellare.** M12 rimuove la
*causa* della voce di ieri («una simulazione in pausa non si può chiudere»), quindi la domanda «la
rimettiamo a contare tutte le aste?» andava posta. Risposta: **no** (owner). Il secondo motivo di quella
voce regge da solo — in una simulazione aspettano dei bot, e il boot recovery li rimette in moto — e
riaprire una guardia appena chiusa riporterebbe l'abitudine a scavalcarla, che è il modo in cui una
guardia smette di proteggere il giorno che serve davvero.

**Un timer che chiede a un sito se ha numeri nuovi non viola la regola 1.** «Mai un timer che decide»
parla della **macchina a stati dell'asta**: il loop di M11 non chiama `transition`, non prende il lock,
non tocca `auctions`/`lots`/`bids`/`assignments`/`ledger`, non incrementa `state_version` e non fa
broadcast. Ha due precedenti letterali in casa — lo sweep dello scheduler e il tick dei bot — e poggia
sulla stessa garanzia (`exec_mode: "fork"`, `instances: 1`) senza aggiungerne di nuove; il singleton va
su `globalThis` come gli altri due. La domanda da farsi la prossima volta che qualcuno vorrà «un timer
per…» è quella: **tocca lo stato dell'asta?**

⚠ **E la scadenza di quel timer si conta dall'ultimo *tentativo*, non dall'ultimo *successo*.** È
l'errore che sembrerebbe naturale — «se `listone_updated_at` è vecchio di un giorno, aggiorna» — e
produce **novantasei richieste al giorno** verso un sito di terzi quando la fonte è giù, perché il
timestamp di successo non avanza mai. Da qui: una riga di `source_runs` per fonte con l'esito
dell'ultimo tentativo, e un backoff esponenziale (1h, 2h, 4h… fino a 24h). La tabella serve anche alla
cosa più importante di M11: **rendere visibile un fallimento silenzioso**, perché con il pulsante
l'errore lo legge chi l'ha premuto, e automatico finirebbe in `console.error` e in nessun altro posto.

---

## 2026-08-12 — M9, i badge degli insight e la striscia verde via

Le scelte prese **pianificando** stanno nella voce «Pianificazione di M9–M12» qui sopra e non si
riscrivono: la soglia dell'80% con la sua misura, «Piazzati» e non «Punizioni», il badge rosso
«Infortunato (ora)» ritirato, l'abbandono di `PLAN §8bis` punto 1. Qui stanno solo le scelte nate
**scrivendo il codice**, che è dove si scoprono le cose che una spec non può sapere.

**I quattro colori, scelti guardandoli.** Emerald per il verde e **`blue-600` per il blu, non
`sky-600`** (owner, su una pagina di prova con i valori veri della Tailwind installata, tema chiaro e
scuro affiancati). La forma è quella già usata in cinque punti dell'app — bordo al 40%, fondo al 10%,
testo pieno — quindi i badge non introducono un secondo linguaggio; scartato il riempimento pieno, che
si riconosce da più lontano ma trasforma quaranta righe di elenco in un cruscotto. Sky è stato
scartato perché tende al ciano e a 10px si separa meno dal verde, che è la sola distinzione che deve
funzionare con la coda dell'occhio.

**La spec conta quattro colori, il codice ne rende tre.** Il «grigio sotto soglia» e il «neutro
riservato» di §2 sono **la stessa cosa**: la variante `secondary` che esiste già. Un secondo nome per
lo stesso rendering sarebbe stato solo un modo di far sembrare quattro ciò che è tre. Il tono `neutro`
esiste nel tipo e non ha chiamanti: è il posto dove atterrerà il prossimo fatto categorico degli
insight, invece di un quinto colore.

**Il rapporto grezzo resta fuori dal badge** (owner). Nel modale d'offerta la titolarità era
`81% da titolare (31/38)`; adesso è il badge `81% tit.` più un `31/38 da titolare` in grigio accanto.
Così il badge è identico nei due posti — che è ciò che lo rende un componente e non due `className`,
e sarà quello che M10 riuserà nel Centro dati — e il numero che dice *quante partite sono davvero* non
si perde per far spazio a un colore.

**La soglia esatta non è raggiungibile, e il test lo dice.** `titolareForte` confronta con `>=`, ma
`0,8 × 38 = 30,4`: con `starts_eleven` intero nessun giocatore cade sulla soglia, quindi `>` e `>=`
colorano esattamente le stesse persone. Vale la pena saperlo prima di «correggere» il predicato. ⚠ E
il caso di bordo va provato **con interi veri** — 31/38 verde, 30/38 grigio: un `30.4/38` finto in
virgola mobile vale 0,7999… e il test direbbe il contrario di quello che vuole dire.

**Niente `dark:`, e da qui in avanti è una regola dell'applicazione** (`CLAUDE.md`, «Errori noti da
evitare»). §6 chiedeva i token per entrambi i temi e sono stati scritti; poi si è visto che **il tema
scuro non esiste**: `.dark` è attivo in un punto solo di tutta la codebase — il `className="dark"` di
`app/tv/[publicToken]/tv-view.tsx` — non c'è nessun interruttore né lettura della preferenza di
sistema, e la vista TV **non mostra insight**. Quei `dark:` erano quindi colori che nessuno può
guardare, cioè che nessuno può verificare: si scrivono convinti di aver coperto un caso e restano
sbagliati per mesi senza che si veda. **Sono stati tolti** (owner: «non hanno senso, se un giorno li
inseriremo poi li tratteremo»), e con loro i **sei `dark:text-emerald-400` già presenti** in
`form-feedback`, `reveal-panel`, `lot-closed-card`, `bid-modal`, `user-row` e `auction-delete`: nessuno
di quei componenti è mai renderizzato dentro il sottoalbero della TV, quindi erano morti anche loro.
⚠ Restano intoccabili il blocco `.dark` di `globals.css` e il `className="dark"` della TV — sono il
bianco-su-nero di DECISIONS 2026-08-08, non un residuo. E le primitive di `components/ui/**` tengono i
loro: arrivano da shadcn, sono inerti fuori dalla TV, e ripulirle sarebbe lavoro da rifare a ogni
aggiornamento.

**`listUserAuctions` sopravvive al banner.** Il task diceva di togliere «la query che serviva solo a
lui»: la **chiamata** nel layout radice è quella, e se ne va, ma la funzione resta perché il suo
chiamante vero è la dashboard — che dopo M9 è l'unica strada di rientro e quindi la usa più di prima.

---

## 2026-08-12 — M10, il listone a sistema

Le scelte prese implementando `docs/features/10-listone-a-sistema.md`. Le decisioni di
pianificazione — i due file che si chiamano «listone», il taglio M10/M11, il gate solo su Caricature
— stanno nella sezione «Pianificazione di M9–M12» e non si riscrivono qui: qui c'è solo ciò che è
stato deciso **scrivendo il codice**.

**`fvm` resta nella tabella globale, anche se il Centro dati non lo mostra.** La decisione dell'owner
(«FMV togli») riguardava una colonna a schermo. `players_autopick_idx` ordina per `fvm` DESC, `quot`
DESC, `ext_id` ASC, e quell'ordinamento **è** l'auto-pick allo scadere di una chiamata: una copia
verso `players` senza `fvm` cambierebbe chi viene comprato, per una scelta di layout. Il test che lo
difende confronta riga per riga i `players` prodotti dalle due strade — file dentro l'asta, e
sistema copiato dentro l'asta — `fvm` e `out_of_list` compresi.

**La parte condivisa dei due import è stata estratta solo adesso** (`replacePlayers` in `setup.ts`),
ed è la regola 8 applicata alla lettera: fino a v1.10.0 le righe potevano venire da una sorgente
sola, e un'astrazione l'avrebbe preceduta di quattro mesi. Ciò che resta diverso fra i due import è
**da dove arrivano le righe**, e nient'altro — che è anche il motivo per cui le due strade producono
righe identiche per costruzione, non per attenzione.

**La proposta alla creazione è una coppia di alternative esplicite, non una casella spuntata**
(owner, in sessione, scegliendo fra tre mockup). «Il listone a sistema · N giocatori · caricato il
…» preselezionato, e «lo carico io» accanto. Costa una domanda in più su una schermata che ne fa
già nove, e in cambio rende visibile che una seconda strada esiste — che è precisamente ciò che
l'upload nel setup deve restare a garantire. ⚠ Se a sistema non c'è niente, la scelta **non compare
affatto**: non compare disabilitata. Una scelta fra due opzioni di cui una non esiste non è una
domanda.

**Il motivo del fallimento della copia viaggia in un parametro dell'URL.** Creare un'asta finisce
con un `redirect`, e la `FormState` muore con la pagina che l'ha prodotta: l'URL è l'unico canale
che sopravvive. La costante `LISTONE_NOTICE_PARAM` vive in `app/auctions/form-state.ts` e non
accanto alle action, perché **da un modulo `"use server"` non esce niente che non sia una funzione
async** — è scritto in cima a quel file, ed è già costato una volta.

**`activeAdminSection` sceglie il match più lungo.** Con la prima voce annidata dell'applicazione
(`/admin/listone/dati`) la vecchia riga — `parts[1]` e basta — avrebbe acceso «Listone» e scritto in
cima alla pagina il titolo sbagliato. Una sotto-pagina sconosciuta di una sezione resta **dentro**
quella sezione, invece di spegnere la sidebar: appartiene lì, e una sidebar spenta sarebbe peggio.

**`when()` è uscita dalla pagina del pannello e vive in `lib/when.ts`.** I chiamanti sono tre — il
pannello, la proposta alla creazione, il pulsante nel setup — e `Europe/Rome` esplicito è la ragione
per cui esiste: il server gira in UTC, e un caricamento delle 23:30 senza fuso comparirebbe come del
giorno prima, cioè farebbe scartare un listone buono. La data di ultimo aggiornamento *è* il punto
della richiesta.

**`uploadListone` non rilegge `is_admin` dal database**, a differenza delle mutazioni di
`lib/engine/admin.ts`. Il precedente è M8: `refreshListoneInsights` e `refreshSetPieces` non lo
fanno neanche loro. La ragione è che quelle di `admin.ts` cambiano **permessi di persone** — dove
chi è stato appena declassato non deve poter comandare fino alla scadenza del suo JWT — mentre qui
si sostituisce un elenco di calciatori di Serie A. La guardia in cima alla server action, che il
test di M6 enumera e verifica una per una, è la difesa, ed è la stessa che protegge i due pulsanti
degli insight da v1.9.0.

**Il test M10 non scrive mai su `player_insights`.** Quella tabella è globale e
`tests/db/insights.test.ts` la svuota nel suo `beforeEach`; vitest gira i file in worker paralleli,
quindi una riga scritta da qui potrebbe sparire a metà di un test di lì — o, peggio, comparire in
mezzo a un suo conteggio e rompere un test che non c'entra niente. È la stessa cicatrice del
parametro `auctionIds` di `insightsCoverage` («verde da solo, rosso nella suite»). Il `LEFT JOIN` del
Centro dati si prova quindi solo dal lato deterministico: `ext_id` sintetici che nessuna fonte ha.

**Le figurine perdono la voce di primo livello e il campo file.** Gli `ext_id` arrivano dalla
tabella, e a tabella vuota l'azione **rifiuta dicendo dove si carica** invece di scaricare zero
figurine e dichiarare successo. Il messaggio «il file è ancora selezionato» è stato riscritto: di
file non ce n'è più uno, ma il «riprende da dov'era» resta vero per la ragione di sempre — lo stato
è il disco.

**Il Centro dati ordina, e i badge blu smettono di sparire** (owner, 2026-08-12, a macro già
mergiata su `dev`: intestazioni cliccabili, filtro «rigori e piazzati», e come default la lista
ordinata per valore dal più alto al più basso). Tre scelte dentro una richiesta che sembrava
meccanica:

- **«Valore» è la quotazione**, non `FVM/1000`. È l'unica colonna di valore che quella pagina
  mostra — l'altra resta fuori per decisione dell'owner, pur restando a database perché decide
  l'auto-pick — e aprire la lista ordinata per una colonna invisibile darebbe una lista in un
  ordine inspiegabile.
- ⚠ **Il filtro sui piazzati non passa da `showableInsights`, e questa è la scelta di sostanza.**
  Quel gate esiste per i numeri **della stagione** — presenze, partenze da titolare, minuti — dove
  un dato del campionato scorso accanto a uno di quest'anno è un confronto falso. I due rank non
  sono numeri di stagione: vengono dalla fonte B, che pubblica la gerarchia **di adesso**. La
  misura dice quanto pesa la differenza: dei **92 designati, 22 hanno le statistiche della stagione
  precedente** — quasi un quarto — e un filtro «solo chi batte» costruito sul gate li avrebbe persi
  tutti, in silenzio, proprio dentro lo strumento che serve a trovarli. La regola sta in un posto
  solo, `bestSetPieceRank` in `lib/domain.ts`, accanto a quella che continua a valere per la
  titolarità.
  ⚠ **Il portale non è stato toccato.** In `/play` e nel modale d'offerta quei 22 continuano a non
  avere il badge blu: è il comportamento di M9, e cambiarlo è una decisione dell'owner, non un
  effetto collaterale di un filtro amministrativo.
- **L'ordinamento vive in `lib/centro-dati.ts`, non nel componente.** È l'unica parte di quella
  pagina che può sbagliarsi **in silenzio**: cinquecento righe ordinate male non danno nessun
  errore, danno una lista plausibile. Due regole che non sono ovvie e hanno un test ciascuna: chi
  non ha il valore finisce in fondo **in entrambe le direzioni** (invertire «titolarità» non deve
  portare in cima trecento trattini), e a parità si ordina per nome (duecento quotazioni uguali che
  si riordinano a ogni click sembrano un bug). E il rank **migliore è il più basso**: «dal più
  alto» sui piazzati deve mettere in cima i primi rigoristi, cioè invertire il segno rispetto a una
  colonna numerica qualunque.

⚠ **E una cicatrice da non ripetere: gli `ext_id` sintetici dei test devono essere davvero alti.**
`syntheticListone` di `game-helpers.ts` numera da 1, e i test di M10 lo usavano dando per scontato
che quegli identificativi non esistessero in nessuna fonte. **È falso**: gli `ext_id` veri di
Fantacalcio.it vanno da 4 a 7548, quindi due righe sintetiche si agganciavano a due righe di insight
vere. Il test passava solo quando `player_insights` era vuota — cioè quando un altro file di test
l'aveva appena svuotata — ed è lo stesso «verde da solo, rosso nella suite» del parametro
`auctionIds` di `insightsCoverage`. I test di M10 hanno adesso un generatore loro, con base
`10_000_000`.

---

## 2026-08-12 — M10B, gli insight che vengono da un umano

Sessione di sola analisi sul foglio `fixtures/carmy.xlsx`, a valle di M10. **Nessuna macro aperta e
nessuna riga di codice**: la spec è `docs/features/10b-insight-da-carmy.md`, qui stanno le scelte,
perché sono scelte.

**Carmy è una terza fonte sovrapposta, non un rimpiazzo delle due di M8.** La misura lo impone: **11
colonne su 15 sono identiche byte per byte** alla fonte A (497/497 su presenze, partite da titolare,
minuti, quotazione, rigori, cartellini). Carmy **non porta nessuna statistica nuova**; porta un
giudizio. Sostituire le due `GET` vorrebbe dire prendere gli stessi numeri da un file caricato a mano
invece che da una fonte che si aggiorna da sé — e **perdere la gerarchia dei rigoristi**, che Carmy
ha come tag su 18 giocatori contro i 92 designati con la posizione della fonte B. La posizione *è*
l'informazione (M9).

**Il giudizio non è la statistica travestita, e c'è la misura.** Correlazione fra `Titolarità` 1–5 e
`Pt. Tit. / 38`: **0,650** su 466 giocatori. I disaccordi sono esattamente i casi che la richiesta
voleva modellare — 11 giudicati titolari con ≤10 partite da titolare (Dovbyk al Bologna 5 con 3, Kouadio
5 con 0, Raspadori all'Atalanta 4 con 7) e 13 giudicati panchinari con ≥25 (Stankovic A. all'Inter 2
con 34). Nuovo arrivo, cambio di modulo, cambio di allenatore: **la ponderazione che si voleva
costruire con un modello è già una colonna.**

⚠ **`Pt. Inf.` non è «partite saltate per infortunio», malgrado il nome.** Identica a `injured`
(497/497), va da 0 a 5, e `Presenze + Pt. Inf.` non converge a 38. È il conteggio di episodi che M8
§9 aveva già scartato. **Il punto «togliere le giornate di infortunio dal calcolo» resta senza dato**,
e questa colonna sembra risolverlo senza risolverlo: se un giorno servisse, si chiede a chi compila
il foglio invece di dedurlo dal nome della colonna.

**Il join è per nome, e la soglia di aggancio qui è una guardia sana.** Carmy non ha `ext_id`: ha
`Nome` e una sigla di tre lettere per la squadra. Misure: sul solo nome **487/497 = 98%** contro il
listone (**zero omonimi**), 497/497 contro la fonte A; su `(nome, squadra)` **0%**, perché `ROM` non
è `Roma`. Si aggancia a `listone_players` — la tabella di M10, che è il denominatore giusto per la
stessa ragione per cui lo è nel Centro dati — con la sigla come **controllo** e non come chiave.
⚠ Sotto il 90% l'import rifiuta senza scrivere, e **questo non ripete l'errore che M8 aveva smontato**:
là il denominatore era il listone di un'asta, avvelenabile da una simulazione con `ext_id` sintetici;
qui è il listone globale, che nessuna asta può inquinare. La continuità all'85% resta dov'è.

**Tabella separata `carmy_players`, non tre colonne su `player_insights`.** Le due fonti di M8 si
aggiornano **per colonna con un `upsert`**; questa si sostituisce **per intero** a ogni caricamento,
come `listone_players`. Mescolarle è il punto in cui, fra sei mesi, il refresh giornaliero di M11
cancella i giudizi con una `GET`.

**La soglia del verde è `Titolarità >= 4`** (owner). ⚠ Va ricordato cosa comporta, perché tocca una
regola che M9 aveva messo per iscritto contando: con `>= 4` si colorano **168/497 = 33,8%** del
listone, cioè **un nome su tre** — in una lista di chiamata da quaranta ne colora tredici o quindici.
M9 §1 aveva scritto che «uno su cinque è il punto in cui un colore smette di essere un segnale e
diventa decorazione», e `>= 5` cade esattamente lì (103/497 = 20,7%). La scelta resta `>= 4` perché è
dell'owner; la misura sta accanto alla soglia così che, guardando la pagina di prova, la riga da
cambiare sia una sola.

**Il prezzo consigliato si scrive** (owner: «scrivila comunque, poi io decido come gestirla»). La
ragione per cui è delicato resta scritta: a differenza di ogni altro numero della macro **non descrive
un giocatore, propone un'azione**, e se tutti hanno il file smette di essere un vantaggio informativo
e diventa un prezzo di listino — l'asta converge lì. Perciò va scritto in **un componente suo, con un
posto solo** da cui si decide se e dove compare: le tre forme fra cui si sceglierà guardando (accanto
al campo, fra le macro, dietro un tocco) non devono costare tre riscritture.

⚠ **E il vincolo più facile da rompere non è un invariante.** La lista di chiamata è ordinata `fvm
DESC, quot DESC`, che **è** l'ordine dell'auto-pick: un filtro per fascia o titolarità cambia quali
righe si vedono ma **non cambia chi il timer sceglie**, perché quello pesca dal pool intero dentro
`machine.ts`. Con un filtro acceso il primo nome della lista non è più quello che verrebbe comprato
allo scadere, e chi ha imparato a fidarsi di quella riga si ritroverebbe un altro giocatore. Va
risolto nell'interfaccia in modo esplicito — non con un commento nel codice.

**Le probabili formazioni sono pubbliche, complete, e restano fuori.** Misura del 2026-08-12, che
**corregge M8 §9**: `fantacalcio.it/probabili-formazioni-serie-a` ha 20 moduli, **220 titolari tutti
con `ext_id` e con la percentuale di ballottaggio** (90% su 116, 85% su 19, 80% su 34, 75% su 16, 70%
su 35), 22 infortunati e 5 dubbi con la prosa e la data di rientro, e aggancia al **100%** con i
nostri identificativi. M8 l'aveva misurata vuota l'11 agosto e ne aveva concluso che i ballottaggi
stessero solo dietro il JWT di Fantalab: **non è così**. Resta fuori perché Carmy risponde alla stessa
domanda con un caricamento invece che con un parser e uno scheduler — ma è una strada misurata, non
chiusa, ed è la risposta pronta il giorno in cui il foglio non arrivasse.

---

## 2026-08-12 — M10B, quello che è cambiato scrivendola

Le scelte della sessione di analisi restano dov'erano, nella voce qui sopra: non si riscrivono. Qui
c'è **solo ciò che la spec non sapeva**, deciso mentre il codice si scriveva.

**Lo `0` del foglio non è un voto, e il foglio scrive l'assenza in tre modi.** Rifatta la misura sui
byte del giorno di apertura, la spec regge quasi per intero — 497 righe, 487/497 di aggancio, `Pt.
Inf.` identica a `injured`, correlazione 0,649, 168 verdi a `>= 4` — ma **§1 dice «1–5» e nel file
c'è uno zero**: un giocatore (Aurelio) ha titolarità, affidabilità, integrità, prezzo e `MV` tutti a
zero, `PMA` a `"0%"` e la fantamedia vuota. È una **riga non compilata**, non un giudizio basso, e
letta come un voto lo farebbe passare per il peggior giocatore del listone. Lo stesso vale per
`Prezzo = 0`, che sono **73 giocatori su 497** — riserve e terzi portieri, tutti con `PMA` a zero — e
per `Fascia = "Non Impostata"`, che sono **84** e sono l'unico modo in cui il file scrive «nessuna
fascia» (nessuna cella è vuota). Decisione: **tutti e tre diventano `null` nel parser**, così
l'applicazione scrive l'assenza in un modo solo. Sul prezzo la ragione è anche più stringente:
**zero non è nemmeno un'offerta valida**, quindi un «prezzo consigliato: 0» accanto al campo sarebbe
un suggerimento impossibile da seguire.

**La colonna `Obiett.` non si importa, e va detto perché.** Vale `Sí` su **tre** giocatori
(McTominay, Baturina, Rowe) ed è la **lista della spesa di chi compila il foglio**: portarla
nell'app vorrebbe dire mostrare a dodici persone chi punta a comprare l'autore del file, che gioca
la stessa asta. Sta scritto in testa a `parseCarmy.ts` perché è la colonna che qualcuno vorrà
aggiungere. Non si importano nemmeno `PMA` (è `Prezzo` diviso il budget, un dato derivato, e per di
più una stringa) e `Ruolo` (ridondante col nome del foglio: 0 discordanze su 497).

**L'ordine delle fasce è quello del foglio, non uno nostro.** Tutti e quattro i fogli raggruppano le
righe nella stessa sequenza — `Top > Semi-Top > Terza > Quarta > Scomm. > Titolare "Scarso" >
Outsider` — e la mediana del `Prezzo` la conferma (47 → 26 → 13 → 3 → 2 → 1 → 1). L'unico punto in
cui servirebbe indovinare è `Titolare "Scarso"` contro `Outsider`, che hanno la stessa mediana: lì si
tiene l'ordine in cui li mette il file, che è l'unica fonte che ne sa qualcosa.

**La forma del badge è `parola` (owner, guardandola), e ha comportato due conseguenze.** «Titolarissimo»
per chi sta a 5, «Titolare» per chi sta a 4. Le due conseguenze non sono dettagli di resa:
1. **Sotto soglia la parola non si inventa.** Il foglio dice «3 su 5», non «panchinaro»: chiamarlo
   così sarebbe attribuire a chi compila il file un giudizio che non ha scritto. Quei badge portano
   quindi la scala — `Titolarità 3/5` — che è anche ciò che tiene in piedi la regola di M9 «il colore
   non è mai l'unica informazione».
2. **Il tag `titolarissimo` sparisce dalla riga quando il badge lo dice già.** È un tag vero del
   foglio, su **106 giocatori**: senza questa regola la stessa parola comparirebbe **due volte sulla
   stessa riga** di un telefono — una verde e una grigia — e il posto che ruba è quello del secondo
   tag, cioè di un'informazione che non c'è altrove. Il filtro per tag continua a offrirlo, perché
   lavora sui dati e non sulla resa.

**Il prezzo consigliato sta `macro`, e le posizioni scritte sono quattro.** Fra fascia, affidabilità
e integrità — dove si legge come **un giudizio fra i giudizi** invece che come un'istruzione a due
centimetri dalla cifra da digitare. La quarta posizione è **`spento`**, che la spec chiedeva senza
nominarla («poter essere spostato o spento senza rifare niente»): spegnerlo in tutta l'applicazione
è scrivere una parola in `POSIZIONE_PREZZO`, non togliere del codice — i due punti d'innesto restano
scritti e tacciono da sé.

**La riga dell'auto-pick: `riga`, su delega dell'owner.** «Non importa, l'importante è che la
dinamica di auto estrazione del lotto esista — la pagina di visualizzazione è più una utility per
l'utente.» Fra le due strade di §6 si è preso «una riga che lo dice sempre» perché è l'unica che non
fa mentire l'elenco una seconda volta: tenere il giocatore fisso in cima risolve «il primo nome non è
quello giusto» introducendo una riga presente in un elenco che dichiara di averla filtrata. La riga
c'è **sempre**, filtro o no, e diventa ambrata quando il primo della lista non è più quello — se
comparisse solo a filtro acceso, chi non filtra continuerebbe a fidarsi dell'ordinamento e chi filtra
la leggerebbe come un avviso d'errore. ⚠ La delega è sulla **forma**: che l'auto-pick resti quello di
prima è ciò che la macro non ha toccato, e c'è un test che lo verifica con la tabella dei giudizi
piena.

**La titolarità nel Centro dati è una colonna sola, non due.** §6 la elencava fra le «colonne nuove»,
ma quella pagina ne aveva già una: due colonne che dicono la stessa cosa con due scale sono due
colonne che nessuno confronta. Ordinare una colonna con due fonti dentro ha richiesto una scelta,
scritta in `valueOf`: i due valori si riportano a **0–1** — `voto / 5` da un lato, `quotaTitolare`
dall'altro — perché rispondono alla stessa domanda, e un `5` di Carmy finisce sopra un `34/38`, che è
l'ordine giusto (il giudizio parla di quest'anno, il rapporto dell'anno scorso).

**Un componente in meno, non uno in più.** `TitolaritaBadge` di M9 non esiste più: al suo posto c'è
`TitolaritaAnyBadge`, che prende le due chiavi e non sa quale vince — la scelta la fa `titolarita()`
in `lib/domain.ts`. Tenerne due voleva dire che ogni chiamante decideva quale disegnare, cioè tre
copie della regola che quella funzione esiste per centralizzare, e la prima stesura l'aveva fatto
davvero duplicando la resa del badge di M9 in due punti.

**⚠ Una tabella globale, un file di test che la possiede.** I test con Postgres di M10B erano in
`tests/db/carmy.test.ts`, verdi da soli, e hanno reso **rossa la suite in dieci test** con un
`duplicate key value violates unique constraint "listone_players_pkey"`. La ragione: `uploadListone`
fa `DELETE` sulla tabella, il join di M10B ha bisogno di un listone caricato, e vitest gira i file in
worker **paralleli**. È la stessa cicatrice che il file di M10 aveva già documentato per
`player_insights` («verde da solo, rosso nella suite»), e la regola che ne esce vale da qui in avanti:
**una tabella globale, un file di test che la possiede.** `tests/db/listone.test.ts` possiede
`listone_players` **e** `carmy_players`. L'alternativa — serializzare i file con
`fileParallelism: false` — costerebbe secondi a ogni `pnpm test` per un problema che riguarda due
file, e lascerebbe la trappola aperta per il terzo.

**La previsione che la spec aveva sbagliato.** Il task M10B-01 diceva «i test di M9 su `quotaTitolare`
si romperanno, e va saputo perché». **Non si è rotto niente**: 659 verdi prima, 659 dopo. Il ripiego
di §4 *è* il codice di M9 lasciato intatto — `quotaTitolare`, `titolareForte` e `SOGLIA_TITOLARE` non
sono stati toccati — e portare la titolarità su Carmy è stato **additivo**. Vale come promemoria sul
genere di previsione da non mettere in una spec: quella riga avrebbe fatto cercare per mezz'ora un
rosso che non doveva esserci.

---

## 2026-08-12 — M10B, le note dell'owner dopo averla guardata

Tre richieste arrivate a macro **chiusa su `dev` e non rilasciata**, quindi lavorate dentro M10B
riaprendo il suo branch: non è una macro nuova, è la stessa che si aggiusta guardandola.

**⚠ `PMA` entra, e la ragione per cui era stata scartata era sbagliata.** La spec di M10B §1 la
liquidava come «`Prezzo` in percentuale del budget, cioè un dato derivato». **Misurato: è falso.**
Solo **132 righe su 385** coincidono con `round(prezzo / 5, 1)`. La correlazione con `prezzo` è alta
— **0,969**, perché entrambe seguono il valore di un giocatore — e il rapporto `prezzo / pma` ha
mediana **esattamente 5**, ma quella mediana la fanno i **166 giocatori da un credito**, dove `0,2%`
è l'unico valore scrivibile. Fuori da quelli le due colonne dicono cose diverse: Di Gregorio costa 41
con `PMA` 2,5% (da `prezzo` verrebbe 8,2), De Gea costa 24 con 6,4% (verrebbe 4,8), Mkhitaryan costa
14 con 0,2%. **Sono due numeri indipendenti**, e i due zeri lo confermano: 67 righe hanno `PMA` a
zero, 73 hanno `prezzo` a zero, in comune 28.

Da cui due conseguenze scritte nel codice: **non si ricalcola** (ricalcolarla vorrebbe dire
sostituire il dato di chi compila il foglio con una nostra stima), e **cosa significhi esattamente
non si indovina** — la cella è testo battuto a mano, senza formula, e la domanda giusta è a chi
compila il foglio. Il codice ha bisogno di sapere solo che è un numero suo.

⚠ **La lezione di metodo, che è più importante del dato.** Una colonna è stata esclusa da una macro
sulla base di una relazione **assunta e non misurata**, e la frase «è un dato derivato» in una spec ha
l'aria di un fatto. Era l'unica affermazione di §1 senza un numero accanto — tutte le altre ne
avevano uno — e infatti è l'unica che si è rivelata falsa. **Se una colonna si scarta, si scarta con
una misura.**

**Il prezzo consigliato in crediti esce dal Centro dati** (owner). Al suo posto `PMA` e la
**fantamedia attesa**. Non è un rimpiazzo per equivalenza — le due colonne non sono lo stesso numero,
vedi sopra — è una preferenza su cosa guardare in una tabella di consultazione. `prezzo` resta a
database e nel modale d'offerta, dove serve a proporre una cifra; la sua chiave di ordinamento è
sparita da `SORT_KEYS`, così chi rimettesse la colonna deve rimettere anche quella e se ne accorge.

**⚠ La lista di chiamata prende cinque cose, contro quello che §6 aveva deciso.** La spec diceva «la
titolarità di Carmy e, **al più, un tag**», con la ragione giusta: la riga è larga quanto un telefono
e la regola di M9 §4 è «tre informazioni, non dieci». L'owner ha chiesto il contrario **dopo averla
guardata**: nella schermata in cui si *scegli* chi chiamare servono **fascia, fantamedia attesa, PMA,
titolarità e note**. La decisione è sua e la densità si paga; per pagarla il meno possibile la riga è
diventata **due righe** — sopra i numeri di stagione (titolarità, rapporto grezzo, minuti, piazzati),
sotto il giudizio del foglio (fascia, attesa, PMA, note). Due blocchi da tre o quattro cose si
scorrono, uno da otto no. **Affidabilità e integrità restano fuori**: non sono state chieste, e sono i
due numeri che nessuno confronterebbe sotto un countdown.

**«Attesa», non «FMV».** La fantamedia attesa si scrive `attesa 7.36` in tutte e due le schermate, e
non con la sua sigla, perché in questo progetto `fvm` è il **Fantavalore di Mercato** — un indice di
prezzo, 300 — e sta **sulla stessa riga**, a destra, nella lista di chiamata. Due sigle quasi
identiche per due cose che non si somigliano: scritte accanto, l'una si legge per l'altra.

---

## 2026-08-13 — M11, il refresh giornaliero

Sei scelte, e tutte e sei si potevano fare in un altro modo che sembra più naturale. È per questo che
sono qui: la versione naturale, in cinque casi su sei, è quella sbagliata.

**⚠ La scadenza si conta dall'ultimo *tentativo*, non dall'ultimo *successo*.** La formulazione che
viene in mente è «se `player_insights.listone_updated_at` è vecchio di un giorno, aggiorna», ed è
sbagliata in un modo che non si manifesta **mai finché tutto funziona**. Nel momento in cui una fonte è
giù, i dati restano vecchi per definizione, quindi la condizione è vera a ogni giro del tick: con un
tick da quindici minuti sono **novantasei richieste al giorno** verso un sito che non è nostro, per non
riuscire novantasei volte. Il conto si fa quindi su `source_runs.attempted_at`. È la decisione di M11
che, sbagliata, non si vede in locale, non si vede nei test scritti a mano e si vede nei log di
qualcun altro.

**Il backoff è esponenziale e si ferma a ventiquattro ore.** 1h, 2h, 4h, 8h, 16h, poi 24h per sempre.
Una fonte giù per un giorno costa **cinque** richieste invece di novantasei — misurato in un test, non
stimato. Si ferma a 24h perché sopra il giorno il backoff smette di proteggere qualcuno e comincia solo
a ritardare la ripresa: una fonte tornata su dopo tre giorni di guasto deve rientrare entro il giorno,
non entro la settimana.

**La guardia sull'asta reale è la stessa funzione dei bot, e un tick saltato non è un fallimento.** La
prima metà era ovvia: `realAuctionRunning()` esisteva già, e riscriverla avrebbe voluto dire due
definizioni di «si sta giocando» che divergono. La seconda metà non lo era affatto — **un tick saltato
per la guardia non scrive su `source_runs`**. Se lo scrivesse, una serata d'asta di tre ore manderebbe
le due fonti in backoff per un guasto che non c'è stato, e il giorno dopo il pannello direbbe «non si
aggiorna da tre volte» avendo fallito zero volte: l'automatismo mentirebbe **esattamente** nel giorno
in cui lo si va a guardare. Vale lo stesso per il secondo salto: la fonte B rifiuta a
`player_insights` vuota, che il giorno del deploy è la condizione normale, e anche quello si salta
senza registrare.

**I due pulsanti scrivono la stessa riga dell'automatismo**, con `trigger: "manual"`. L'alternativa —
solo il loop scrive — dava un pannello che racconta una storia e una realtà che ne racconta un'altra:
premo il pulsante, riesce, e la pagina continua a dire «ultimo tentativo fallito ieri». Due storie
nello stesso posto sarebbero due verità, e per questo `trigger` è una colonna e non due tabelle. Ha un
effetto voluto che va saputo: **un fallimento a mano rimanda in avanti il prossimo tentativo
automatico**, perché il backoff protegge la fonte da *tutti* i chiamanti e non solo dal loop.

**La regola 1 non è violata, e la domanda giusta non è «è un timer?».** «Mai un timer che decide» parla
della macchina a stati dell'asta: il client renderizza i countdown ma non cambia stato, e a chiudere un
round è solo il server. Questo timer non chiama `transition`, non prende `withAuctionLock`, non tocca
`auctions`, `lots`, `bids`, `assignments` né `ledger`, non incrementa `state_version` e non fa nessun
broadcast. Decide una cosa sola: se è il momento di chiedere a un sito web se ha numeri nuovi. Il
confine è lo stesso che M8 aveva già tracciato per non prendere il lock. **La domanda da farsi la
prossima volta che servirà «un timer per…» è: tocca lo stato dell'asta? Allora no.**

**Niente email, ed è una scelta con un limite dichiarato.** Un automatismo che fallisce in silenzio è
peggio di nessun automatismo, quindi l'allarme serve — ma una notifica che arriva **ogni giorno** per
un dato di mercato è una notifica che si impara a cancellare senza leggere, e il giorno che conta viene
cancellata con le altre. Il limite è che l'avviso lo vede solo chi apre il pannello, e due cose lo
rendono accettabile: i dati **non si corrompono** (transazione, envelope validato, continuità all'85%
— il caso peggiore è sapere numeri vecchi, mai numeri falsi), e il pannello lo si apre comunque prima
di un'asta. Per la stessa ragione non c'è un'ora configurabile né un interruttore per spegnere
l'automatismo: stati in più da spiegare, che nessuno ha chiesto.

**E una scelta di forma, dell'owner, guardandola** (2026-08-13, come per i colori di M9 e il badge di
M10B): il guasto si vede in **due posti** — un avviso rosso in cima alla sezione Listone, che compare
*soltanto* quando una fonte è in guasto, e una riga di stato accanto a ciascuno dei due pulsanti, che
c'è sempre. La ragione della doppia collocazione è che rispondono a due domande diverse: «c'è qualcosa
che non va?» si legge entrando nella pagina, «quando si è aggiornato, da sé o a mano?» si legge
guardando il pulsante. Che l'avviso in cima compaia solo in caso di guasto è la sua unica proprietà
importante: un avviso che c'è sempre si smette di leggere. E i quattro timestamp in fondo alla pagina
**restano** dove erano: rispondono a «quale di queste quattro cose è ferma?», che è una terza domanda
ancora.

⚠ **Una postilla scritta il giorno del rilascio, e vale per le macro future più che per questa.** Il
`pnpm db:push` di M11 **non** ha la proprietà rassicurante dei quattro rilasci precedenti. Da M7 a M10B
la frase era sempre la stessa — «finché il passo a mano non è dato, niente si rompe e niente si vede» —
perché quelle tabelle erano lette in `LEFT JOIN` da schermate che sanno stare senza. `source_runs` no: la
legge `sourceRunsStatus()`, che è la prima riga del pannello, quindi **fra la fine del deploy e il
`db:push` la pagina Admin → Listone risponde 500**. Il resto dell'app è intatto — l'asta, il portale, la
TV e il Centro dati non toccano quella tabella — ma la finestra è reale, e il changelog di `v1.12.0` la
dichiara.

**La regola che se ne ricava:** una tabella nuova **letta da una pagina** non è additiva nello stesso
senso in cui lo è una tabella nuova letta in `LEFT JOIN` da una query di dominio. Nel primo caso
l'ordine è deploy → `db:push` **subito**; nel secondo si può prendere tempo. La distinzione va fatta
quando si scrive il file della macro, non quando si legge il 500.

---

## 2026-08-17 — M12, cancellare un'asta per forza

Cinque scelte. La prima è la sola che avrebbe potuto far morire la macro prima di cominciarla, e non è
una scelta nuova: è una scelta del 2026-08-07 riletta.

**La regola 5 non è in mezzo, ed è ratificato per iscritto da Fase 1.** «Mai `DELETE` né `UPDATE`
distruttivi su `assignments` e `ledger`» sembra vietare esattamente questa macro. Non la vieta, e non è
un'interpretazione di comodo: la voce del 2026-08-07 su `ON DELETE CASCADE` verso `auctions` lo dice
con queste parole — *«Compresi `assignments` e `ledger`. Motivazione: la regola 5 vieta `DELETE` e
`UPDATE` distruttivi come correzione dentro un'asta viva — lì si usano `voided_at` e righe
compensative. Cancellare un'asta intera è un'altra cosa, ed è richiesta dalla checklist pre-asta di
PLAN §17 (punto 3: rimozione dell'asta di prova). Senza le cascate quella cancellazione andrebbe
scritta a mano tabella per tabella.»* Le cascate esistono **per rendere possibile questo**, da prima
che servisse: M12 non ha toccato lo schema, non ha dato nessun `pnpm db:push` e non ha scritto nessun
backfill. La regola protegge la correzione di un numero dentro un'asta che si sta giocando; qui non si
corregge niente, si butta via tutto — e chi lo fa deve digitare il nome dell'asta per riuscirci.

**Il congedo passa da un hook, non da un import.** `lib/engine/setup.ts` non importa
`lib/realtime/broadcast.ts`: `deleteAuction` chiama un hook che di default non fa niente, e il processo
lo aggancia in `instrumentation.ts` dentro il ramo `nodejs`, con la stessa forma di `setBroadcastHook`.
La ragione di disciplina è quella di sempre — il motore non sa che esiste un canale verso i client, e
nei test, nel seed e nei bot quell'hook resta il no-op — ma stavolta ce n'è una seconda, concreta, che
da sola avrebbe deciso lo stesso: **da lì il timer di fase si cancella davvero.** Lo scheduler attivo è
una variabile di modulo di `scheduler.ts`, e di quel modulo esistono due copie in due bundle; una
`cancelTimer` chiamata direttamente da una Server Action girerebbe nella copia in cui `active` è
`null` e non cancellerebbe niente. La closure agganciata in `instrumentation.ts` nasce nel bundle dove
lo scheduler è stato avviato. ⚠ **Nessuna regola ESLint difende questo confine** — quella copre solo
`lib/db` — quindi qui la disciplina è di chi scrive.

**Il `close()` viene prima della navigazione, e non è estetica.** Sull'evento terminale il client
chiude l'`EventSource` e *poi* va in dashboard. Invertirle produce codice che sembra funzionare: lo
schermo finisce in dashboard in entrambi i casi. Ma il server chiude lo stream subito dopo il congedo, e
uno stream che finisce normalmente è per la specifica di `EventSource` un buon motivo per riconnettersi:
senza il `close()` esplicito il client tornerebbe a battere su una rotta che risponde 404. Verificato
il 2026-08-17 con due stream aperti su un'asta cancellata: il server chiude con **200 e stream
terminato**, che è precisamente la condizione in cui un browser riprova. Il modo di accorgersi della
differenza non è guardare lo schermo, è contare le richieste nel pannello di rete — ed è per questo che
la verifica a mano di M12 chiede di guardare la rete.

**⚠ La guardia del deploy non torna a contare le simulate — ratifica.** Questa macro rimuove la *causa*
della decisione del 2026-08-12 («il deploy non si blocca più per un'asta simulata»): la guardia aveva
smesso di contarle proprio perché una simulata in pausa non si poteva chiudere in nessun modo, e adesso
si può. La domanda «la rimettiamo?» è stata posta invece di restare implicita, e la risposta dell'owner
è **no**. Due ragioni. Il secondo motivo di quella voce regge da solo — «un minuto di silenzio con dieci
persone che aspettano è un minuto di panico» non si applica a una simulazione, dove aspettano dei bot e
il boot recovery li rimette in moto da sé. E riaprire una guardia appena chiusa riporterebbe l'abitudine
a scavalcarla con `DEPLOY_DURING_AUCTION=1`, che è il modo in cui una guardia smette di proteggere il
giorno che serve davvero. Chi legge le due voci in fila deve trovare la domanda già posta.

**Le due strade scartate, e perché sarebbero costate più di quanto sembra.** La prima è **un'azione
«termina asta»** che porti un'asta a `COMPLETED` senza giocarla: sarebbe uno stato prodotto da un
percorso che il motore non conosce, e ogni query che oggi si fida di `COMPLETED` — il verbale, l'export,
lo storico — dovrebbe imparare a diffidarne. Se un giorno servirà è una macro sua, e la prima domanda
sarà «cosa dice il verbale di un'asta terminata a metà?». La seconda è la **cancellazione morbida**, un
`deleted_at` sull'asta: vorrebbe dire un filtro nuovo in ogni query che legge `auctions` — dashboard,
pannello, sweep, tick dei bot, refresh degli insight, guardia del deploy — e un solo posto dimenticato è
un'asta fantasma che riappare. Il `DELETE` vero non ha filtri da dimenticare. Il prezzo è dichiarato e
non mitigato: **non c'è undo, non c'è cestino, e su un'asta vera conclusa se ne va il verbale delle
rose**. Il recupero è il `pg_dump` delle 04:15 UTC, e prima di cancellare un'asta vera si dà
`deploy/db-backup.sh`.

## 2026-08-18 — Pianificazione di M13 e M14

Sessione di sola analisi, dalle due richieste che l'owner aveva nel quaderno: la pagina utenti del
pannello e il cancello sui risultati di un lotto. Due macro, `docs/features/13-utenti-admin.md` e
`docs/features/14-cancello-risultati.md`, nessuna delle due aperta. Sette scelte, e le prime due sono
quelle che hanno deciso la forma del lavoro.

**⚠ Il cancello sta prima della risoluzione del lotto, e il modo ovvio ha un buco che non si vede.**
La strada naturale sarebbe: lasciare `advanceLotOpen` come è — round chiuso, `resolveRound`,
`enterReveal`, assegnazione committata — e **nascondere i risultati** finché la fase è il cancello.
Sarebbe una riga, e non funziona: `serializeMembers` calcola `credits`, `maxBid`, `slotsFilled` e
`roster` da `state.assignments`, e quei quattro campi stanno in **ogni** snapshot per **tutti**, vista
TV compresa. Nascondere il pannello delle buste mentre i crediti del vincitore scendono di 87 e un nome
nuovo compare nella sua rosa non nasconde niente: **è un quiz con una risposta sola**, e la risposta si
legge sul proiettore prima che chiunque possa premere un pulsante. Il cancello quindi chiude il round e
**non risolve**: `resolveRound` viene chiamata all'uscita. Tre conseguenze, tutte a favore — annullare
un lotto non tocca la **regola 5** (non c'è nessuna assegnazione da annullare, e il giocatore torna
disponibile da sé perché la disponibilità è derivata); la barriera I8 dello storico
(`isPublicLot = status === "RESOLVED"`, M3) **continua a valere gratis**, perché un lotto sigillato è
ancora `OPEN`; e il prezzo è dichiarato — la proprietà «un crash nel reveal non perde un lotto già
deciso» viene rimandata di X secondi, ma l'esito è una **funzione pura delle offerte a database**,
quindi il primo `ADVANCE` successivo lo ricalcola identico. Quest'ultima cosa è una verifica a mano
della macro, non un'assunzione.

**Il cancello sta a ogni chiusura di round, non solo all'esito finale** (owner). Allarga la richiesta,
e la ragione è misurata: oggi un pareggio nel round 1 svela l'importo pareggiato a chi ha pareggiato
(`LOT_TIE_PREP`), cioè **un pezzo di busta esce prima del reveal** — è `snapshot.ts` stesso a
dichiararlo, «l'unica informazione che esce prima». La disconnessione descritta nel quaderno
esporrebbe comunque quella cifra, quindi un cancello che copre solo l'esito finale avrebbe lasciato
aperta la fessura che esiste per chiudere. Ed è un punto solo nel codice invece di due.

**Lo zero non è una fase da zero secondi: è l'assenza della fase** (owner: `X = 0` deve poter spegnere
il cancello). Il default della colonna è `0` — le aste che esistono restano identiche a se stesse,
**quindi nessun backfill**, che è la differenza fra questo rilascio e quello di M5 — mentre la
creazione di un'asta nuova propone `10`. **Due default diversi di proposito**, e la nota va nel codice:
uno risponde a «cosa c'era prima», l'altro a «cosa proponiamo adesso», e allinearli spegnerebbe una
delle due risposte. Nel motore il cancello a zero è un ramo `if` che salta la fase del tutto: una fase
da zero secondi sarebbe uno stato osservabile — un timer armato sull'istante presente, uno snapshot in
più per lotto verso dodici persone, una schermata «risultati in arrivo» che lampeggia.

**⚠ Un lotto annullato non sarà mai `RESOLVED`.** Prende un terzo valore di `lots.status`, `VOIDED`
(nessuna migrazione: la colonna è `text` senza `CHECK`), e `resolved_at` resta `null` perché non è mai
stato risolto. La ragione è la citazione di M3 su `isPublicLot`: *«"lotto risolto" ≡ "buste già state
pubbliche", per costruzione e non per attenzione»*. Un lotto annullato è **l'unico caso
dell'applicazione in cui un lotto finisce senza che le buste siano mai uscite**: dargli `RESOLVED` per
coerenza — «è finito, no?» — farebbe pubblicare allo storico le offerte di un lotto annullato, cioè
esattamente le buste che la macro esiste per non svelare. Il predicato non si cambia, e la seconda rete
di `lib/engine/log.ts` (niente vincitore o niente prezzo → scartato) resta dov'è: M3 dice che le due si
sovrappongono di proposito.

**⚠ Gli override si rifiutano anche nel cancello, e non è una precauzione.** `lib/engine/override.ts`
oggi rifiuta `phase ∈ {LOT_OPEN, LOT_TIE_PREP}`; il cancello va aggiunto perché **è il presupposto che
rende sicuro «Annulla lotto»**. Il ritorno del turno al chiamante è sicuro solo se il suo ruolo non può
essersi riempito nel frattempo, e l'unica cosa che riempie un ruolo fuori da un lotto è
`manualAssign`. Detto in positivo: un lotto sigillato **è** un lotto in contesa — è il momento più in
contesa che ci sia, perché l'esito è già deciso e nessuno lo conosce. Con la guardia in piedi, il caso
«il chiamante non può più chiamare» non esiste e il motore lo **asserisce** con un'eccezione, non con un
rifiuto: è la convenzione dichiarata di `machine.ts` (*«i rifiuti previsti sono `Result`, i bug sono
eccezioni»*) e il precedente è il `throw` di `nextTurn` due funzioni sopra.

**⚠ La rotazione dei turni torna indietro, in un caso solo — e la riga di `CLAUDE.md` va corretta.**
*«Un lotto sbagliato si corregge con `voidAssignment` + `manualAssign`: la rotazione dei turni non torna
mai indietro»* resta vera **fuori** dal cancello, cioè in tutti i casi in cui il lotto ha già prodotto
qualcosa. Dentro il cancello non ha prodotto niente: nessuna assegnazione, nessun passo di rotazione,
nessun credito mosso. È il precedente di M9 con `PLAN §8bis` punto 1 — una parte di una regola scritta
che smette di valere ha bisogno di una voce datata **e** della correzione nel file, altrimenti fra sei
mesi il documento dice una cosa e l'applicazione un'altra, e chi legge crede al documento. Vale anche
per la riga sulle fasi degli override.

**M13: la ricerca sì, la paginazione no — ratifica su M6 §8.** Quella sezione le escludeva nella stessa
riga (*«niente ricerca full-text, paginazione o esportazioni: con dodici utenti … una tabella ordinata è
la cosa giusta»*), ma non sono la stessa decisione. La ricerca di M13 filtra **righe già caricate**, sul
client, con la `fold()` che è già la ricerca della lista di chiamata e della regia — terzo chiamante, e
il commento su quella funzione dice perché conta: *«due ricerche che rispondono diversamente a "citta"
sarebbero una piccola bugia difficile da spiegare»*. Nessuna query nuova, nessuno stato
nell'indirizzo, nessuna «pagina 2» in cui una riga possa nascondersi. La paginazione invece cambia il
contratto della pagina, e nel momento in cui esiste **la ricerca lato client diventa una bugia** perché
cercherebbe solo dentro la pagina corrente: quel giorno arrivano insieme, ricerca lato server compresa.
La misura che deciderà se quel giorno è già arrivato — quanti utenti ci sono in produzione — è il primo
task di M13, perché da qui non si può fare.

**M13: lo switch è quello di `radix-ui`, non quello di Base UI.** La richiesta linka
`ui.shadcn.com/docs/components/base/switch`, che monta `@base-ui-components/react`: una seconda libreria
di primitive accanto a quella che il progetto usa in ogni componente, per un interruttore. Lo stack di
`CLAUDE.md` è esplicito su cosa non si introduce. Per la stessa ragione il pannello laterale si
costruisce con `Dialog` di `radix-ui` **senza** aggiungere `components/ui/sheet.tsx`, esattamente come
`bid-modal.tsx`: le primitive condivise si allargano quando arriva il secondo chiamante *generico*, e un
modale dal basso per un pollice sotto un countdown non ha niente da condividere con un pannello da
scrivania oltre l'overlay (DECISIONS 2026-08-07, Fase 5).

**M13: lo switch della verifica è a senso unico, e va progettato guardando l'asimmetria in faccia.**
`forceVerifyEmail` sa fare una cosa sola: scrivere `email_verified_at`. Non esiste una de-verifica e non
deve esistere — spegnerla vorrebbe dire rispedire una persona alla schermata del codice, cioè chiuderla
fuori dall'applicazione con un click. Ma uno switch **promette due direzioni**: quindi acceso e bloccato
quando l'indirizzo è dimostrato, con la ragione scritta accanto. Ed è anche il motivo per cui il
salvataggio del modale **non è atomico e non deve far finta di esserlo**: sono quattro `UPDATE` distinti
su `users`, l'esito si riporta per campo, e su qualunque errore il modale resta aperto — chiudersi
dicendo «fatto» dopo aver scritto tre cose su quattro rende inaffidabile l'unico pannello che c'è.

**Le due strade scartate in M13, entrambe più costose di quanto sembrano** (owner: nessun potere nuovo).
**Cancellare un utente**: `members.user_id` punta a `users` **senza cascata**, quindi un utente che ha
giocato non si cancella affatto senza portarsi via un'asta — è la stessa direzione delle chiavi che in
M12 §1 garantisce che cancellare un'asta non tocchi nessuna persona, letta dall'altro lato. Sarebbe la
seconda azione irreversibile dell'applicazione e vuole una macro sua, con la sua domanda: *cosa resta
del verbale di un'asta a cui un partecipante non esiste più?* **Il reset della password da parte di un
amministratore**: il recupero lo chiede la persona da sé (M5), e un amministratore che entra
nell'account di un altro è un potere che questa applicazione non ha. La verifica forzata — che esiste
già — è il massimo che si è accettato, con la sua avvertenza scritta: *«mettere la propria parola al
posto della prova»*.

## 2026-08-18 — M13, la pagina utenti

Le quattro decisioni che la pianificazione aveva già messo per iscritto — la ricerca sì e la
paginazione no, lo `Switch` di `radix-ui` invece di Base UI, la verifica a senso unico, le due strade
scartate — sono qui sopra, nella voce della pianificazione, e sono state seguite alla lettera. Queste
sono quelle **prese scrivendola**.

**La misura di §4 è stata fatta e non ha riaperto niente: 20 utenti veri in produzione, 32 contando i
bot** (letti dall'owner sulla pagina; da una sessione di sviluppo quel numero non è leggibile — nessun
accesso SSH al server, e la pagina vuole una sessione da amministratore). Venti righe stanno in una
schermata da portatile, quindi «niente paginazione» regge com'era ereditato da M6 invece di essere
riconfermato a occhio. Il numero da riguardare in futuro è quello **con** i bot, perché è quello che la
pagina mostra col filtro acceso.

**Il server sa cosa è cambiato dalla presenza del campo nella `FormData`, non da un confronto.** Era il
punto aperto di §5: «chiama solo per ciò che è cambiato» richiede di sapere cos'era prima, e l'azione
**non può leggerlo** — `app/admin/actions.ts` non importa `lib/db` (regola ESLint) e `lib/engine/admin.ts`
non si tocca (§1), quindi non esiste nessun `getAdminUser` da chiamare e non doveva nascerne uno. La
soluzione è che il pannello monta l'input nascosto **solo** quando quel valore differisce da quello che
il server gli aveva mandato: un `displayName` assente vuol dire «il nome non si tocca», non «il nome è
vuoto». Scartata l'alternativa di mandare anche i valori precedenti (`wasAdmin`, `wasPro`) e far
decidere al server: sono due volte i dati per la stessa informazione, e il peggio che può fare un client
che mente su questo protocollo è ottenere una `UPDATE` che riscrive il valore che c'era già —
l'autorizzazione la fa il motore, che rilegge `is_admin` a ogni mutazione.

**L'esito per campo vive in `lib/admin-users.ts`, insieme al filtro della ricerca.** `FormState` ha un
solo `error` e un solo `ok`, che è la forma giusta per un'azione che fa una cosa: qui le cose sono
quattro e possono andare diversamente, quindi lo stato di ritorno porta anche `outcomes` e `done` — ed è
`done` l'unica cosa su cui il modale si chiude. Il modulo è puro e senza dipendenze oltre a `fold`, sul
modello di `lib/centro-dati.ts`: lo legge un client component, e una lista filtrata male non dà nessun
errore — dà una lista plausibile e incompleta.

**Il test del salvataggio è un file nuovo, `tests/db/admin-save.test.ts`, e non una sezione di
`admin.test.ts`.** In quel file `requireAppAdmin` è sostituita da una che **interrompe sempre**, ed è
ciò che prova che ogni azione la chiama in prima riga: non ci si può mettere accanto un test che vuole
vedere un salvataggio *riuscire*. Il finto nuovo fa l'altra metà — restituisce la riga vera
dell'attore scelto dal test, senza guardare `is_admin` — e questo rende onesta la verifica 11: la
guardia lascia entrare il non-amministratore, e a fermarlo resta soltanto la rilettura del permesso nel
motore. `next/cache` è sostituito perché `revalidatePath` fuori da una richiesta vera non ha nessuno
store da invalidare, e non è la parte in prova.

⚠ **`tests/db/admin.test.ts` si è rotto come previsto, ed è la quinta volta di fila.** L'elenco esatto
degli export è stato aggiornato a mano insieme al `requireAppAdmin()` in cima all'azione nuova. Il
conteggio dei test è passato da 791 a 813: otto sono la ricerca, tredici il salvataggio, **e uno arriva
da solo** — l'`it.each` che enumera gli export e li chiama tutti con un form vuoto ha guadagnato un caso
senza che nessuno lo scrivesse. È il meccanismo che funziona, non un intoppo.

**Cosa non è stato toccato, verificato invece che dichiarato.** `lib/engine/admin.ts` è identico: §1
diceva che trovarsi a modificarlo è il segnale che qualcosa è andato storto, e non è successo. Le tre
azioni per campo (`setUserDisplayNameAction`, `forceVerifyEmailAction`, `setUserAdminAction`) e
`setUserProAction` **restano al loro posto** benché nessuna schermata le chiami più: la spec dice che la
macro «ne aggiunge una», non che ne toglie quattro, e ognuna ha la sua guardia e il suo test. Sono
quattro export da rileggere il giorno in cui si vorrà togliere del codice morto — con la consapevolezza
che l'elenco esatto di `admin.test.ts` andrà aggiornato anche in quella direzione.

**Una duplicazione trovata per strada e lasciata dov'era.** `fold()` esiste **due volte**: in
`lib/realtime/portal.ts` — quella che M13 importa, come chiedeva §4 — e in `lib/centro-dati.ts`, che da
M10 ne ha una copia sua con la stessa semantica scritta in un ordine diverso — l'una toglie i segni
diacritici con l'intervallo `\u0300-\u036f`, l'altra con `\p{Diacritic}`. Non è stata unificata in
questa macro: cambiare la `fold` del Centro dati vuol dire cambiare il comportamento di una ricerca su
cinquecento righe per una questione di forma, dentro una macro che non c'entra. Sta scritto qui perché il commento su
`portal.ts` dice «due ricerche che rispondono diversamente sono una piccola bugia» e la terza ricerca
adesso lo rispetta, mentre la seconda non lo sa.

⚠ **Le quattro azioni vecchie sono state tolte, e il paragrafo qui sopra è stato ribaltato nella stessa
sessione.** L'owner, letta la nota, ha deciso il contrario: pulizia. Resta scritto com'era perché è
append-only e perché la ragione del ribaltamento è più chiara col «prima» accanto — la spec dice «ne
aggiunge una» e **non si era pronunciata sul togliere**, quindi lasciarle era il default prudente, non una
scelta. Il default prudente qui era sbagliato: quattro endpoint scrivibili che nessuna schermata apre più
non sono codice morto inerte, sono superficie che nessuno guarda. `app/admin/actions.ts` passa da undici
export a sette, `lib/engine/admin.ts` resta intatto — il potere è lo stesso, chiamato da un posto invece
che da quattro — e i file di M6 e M8 **non** sono stati riscritti: sono l'archivio di due macro chiuse, e
la ratifica di un cambio di idea sta qui, come per M6 §8 sulla ricerca.

⚠ **E l'elenco esatto degli export ha funzionato al contrario, per la prima volta in cinque macro.** Era
nato per rompersi quando un'azione *nasce* senza guardia; qui ha confermato che le quattro tolte non
lasciavano nessun riferimento in giro, e che quella rimasta è una sola. Il conteggio dei test **scende**
di quattro casi (l'`it.each` sugli export), ed è la prima volta che accade: 813 → 815 con sei test nuovi
del toast dentro.

**Il toast dell'esito, e perché non sta nel pannello** (richiesta dell'owner del 2026-08-18, dopo aver
guardato la pagina: «non si capisce se vada in errore o effettua la modifica»). L'esito per campo dentro
il modale è la cosa giusta **quando il modale resta aperto**, cioè in caso di errore — ma a pieno
successo il modale si chiude, e il messaggio se ne andava con lui: la tabella si aggiornava e nient'altro,
quindi un salvataggio riuscito era indistinguibile da un click andato perso. Il toast vive quindi in
`UsersTable`, che è ciò che sopravvive alla chiusura, e il pannello **riporta** l'esito invece di
decidere da sé di chiudersi (`onResult`). Tre toni e non due: riuscito, **riuscito a metà** e rifiutato —
il caso di mezzo è quello che va detto meglio, perché «errore» farebbe riprovare tutto e «salvato»
nasconderebbe il campo non passato. La riduzione da esito a toast è una funzione pura con i suoi test
(`saveToast`), per la stessa ragione del filtro: il caso a metà è il più difficile da vedere a mano.

**E il toast è `Toast` di `radix-ui`, non quello di shadcn.** La pagina «Toast» di `ui.shadcn.com` oggi è
un involucro attorno a **`sonner`**, cioè una dipendenza nuova per un avviso, mentre la libreria di
primitive che il progetto usa in ogni componente ne ha già uno. È la **stessa** decisione dello `Switch`
presa qualche ora prima, e le due volte non sono una coincidenza: entrambe le richieste dell'owner
linkavano shadcn, e shadcn oggi impacchetta primitive di terzi — quindi «usa il componente di shadcn» va
letto come «voglio quel comportamento», non come «monta quella dipendenza». Due cose sapute e accettate:
la ✕ del toast non risponde mentre il modale è aperto (un `Dialog` modale di Radix rende inerte ciò che
gli sta fuori) — per questo il messaggio autorevole dell'errore resta quello per campo dentro il
pannello, e il toast dell'errore dura dieci secondi invece di quattro; e il `Toast.Root` ha una `key` che
avanza a ogni esito, perché due errori identici di fila lascerebbero il primo toast fermo com'è, che si
legge come un secondo Salva che non ha fatto niente.

## 2026-08-18 — M14, il cancello dei risultati

**Il cancello sta prima della risoluzione, e la ragione è misurata.** La forma ovvia era lasciare il
motore com'era — round chiuso, esito calcolato, assegnazione committata — e nascondere `reveal` nello
snapshot finché il cancello è aperto: una riga in `serializeLot`, ed è fatta. Non tiene, e il buco non
è dove si guarda. Prima di scrivere una riga di rimedio è stato riprodotto (M14-02, test usa e getta):
asta a 8 con budget 100, offerta vincente 87, la fase forzata a `LOT_SEALED` con l'assegnazione già a
database. Nello snapshot **della TV** (`viewerMemberId = null`, quindi nemmeno `myBid`) `reveal` e `tie`
erano entrambi `null` — la sanificazione funzionava — e intanto il vincitore passava da `credits: 100`
a `13`, da `maxBid: 97` a `11`, da `slotsFilled.P: 0` a `1`, con gli altri sette fermi a 100.
⚠ **E `roster` portava `{ name: "Giocatore 1", price: 87 }`**, cioè l'importo esatto della busta
vincente, in un campo che non ha nessun rapporto con `reveal`. Quindi non è «un quiz con una risposta
sola» come la spec prudentemente diceva: è la risposta scritta. `serializeMembers` deriva `credits`,
`maxBid`, `slotsFilled` e `roster` da `state.assignments`, e quei quattro campi stanno in **ogni**
snapshot per **tutti**. Sigillare dopo la risoluzione sarebbe stato inutile per costruzione, non per
distrazione.

**Le tre conseguenze del metterlo prima, e sono tutte a favore.** (a) L'annullamento non sfiora la
regola 5: nel cancello l'assegnazione non esiste, quindi non c'è nessun `voided_at` da scrivere e
nessun credito da rimettere a posto — il giocatore torna disponibile da sé, perché la disponibilità è
derivata. Nel modo ovvio l'avrebbe sfiorata davvero. (b) La barriera I8 dello storico continua a valere
gratis: `isPublicLot` è `status === "RESOLVED"`, un lotto sigillato è ancora `OPEN`, e nessuno ha
dovuto aggiungere una condizione. (c) Il prezzo, dichiarato: l'assegnazione era committata all'ingresso
del reveal perché «un crash durante il reveal non deve poter perdere un lotto già deciso», e adesso
davanti a quella proprietà c'è una finestra in cui il lotto è deciso **dalle offerte** ma non
committato. Non è una perdita — l'esito non è un dato ma una funzione — e **non è stato assunto**: c'è
un test che sigilla un lotto, retrodata la scadenza, e verifica che lo `sweep` (il boot recovery)
produca lo stesso vincitore allo stesso prezzo di un'asta gemella col cancello spento.

**Il cancello a ogni chiusura di round, non solo quando c'è un vincitore** (decisione dell'owner, e
allarga la richiesta del quaderno). La misura che la giustifica: oggi un pareggio nel round 1 svela
l'importo pareggiato a chi ha pareggiato — `LOT_TIE_PREP` porta `tie`, e `snapshot.ts` lo dichiara come
«l'unica informazione che esce prima del reveal», motivandolo col fatto che fra due secondi sarà il
`min_amount` pubblico del round 2. Quella motivazione regge finché il round 2 parte davvero: la
disconnessione da cui nasce questa macro esporrebbe comunque quella cifra. Ed è anche **un punto solo
nel codice invece di due**.

**`resultGateSeconds = 0` non è una fase da zero secondi: è l'assenza della fase.** Il ramo nel motore
è una `if`, e vale la pena averla scritta. Una fase da zero è uno stato osservabile — un timer armato
sull'istante presente, uno snapshot in più per lotto mandato a dodici persone, un `ADVANCE` in ritardo
di un tick che fa lampeggiare una schermata d'attesa. È anche l'unico timer di `TIMER_LIMITS` con
minimo 0, e la nota sta accanto al limite: chi «uniformasse» quel minimo a 1 per simmetria spegnerebbe
l'unico modo di tornare al comportamento di v1.14.0.

**I due default sono diversi di proposito e non vanno allineati.** La colonna ha `DEFAULT 0` — è ciò
che vale per le righe che esistono già, e le lascia identiche a se stesse **senza backfill**, che è la
differenza fra questa macro e M5 (dove il default «ragionevole» era quello sbagliato per ogni riga
esistente). `DEFAULT_CONFIG` ha `10` — è ciò che si propone a chi crea un'asta adesso. Uno risponde a
«cosa c'era prima», l'altro a «cosa proponiamo».

**`VOIDED` non sarà mai `RESOLVED`, e i due predicati non si toccano.** Un lotto annullato è l'unico
caso dell'applicazione in cui un lotto finisce senza che le buste siano mai uscite. `isPublicLot`
equipara `RESOLVED` a «le buste sono già state pubbliche» *per costruzione* — `enterReveal` scrive
quello status nell'istante in cui gli importi diventano pubblici — quindi dare `RESOLVED` a un lotto
annullato «per coerenza» farebbe pubblicare dallo storico esattamente le offerte che il cancello esiste
per non svelare. La seconda rete di `lib/engine/log.ts` (un lotto senza vincitore o senza prezzo viene
scartato comunque) resta dov'è: le due si sovrappongono di proposito.

**Gli override sono rifiutati anche dentro il cancello**, in `lib/engine/override.ts` e in
`overrideControls`. Non è una precauzione: è il **presupposto** di «Annulla lotto». Quell'azione riporta
il turno al chiamante e regge su tre condizioni, e la terza — «il ruolo del chiamante non può essersi
riempito nel frattempo» — è vera solo perché l'unica cosa che riempie un ruolo fuori da un lotto è
`manualAssign`, che lì è vietata. Chi un giorno togliesse `LOT_SEALED` da quell'elenco romperebbe una
funzione di `machine.ts` da un altro file, in silenzio; per questo il test di `overrideControls` lo dice
per iscritto. E un lotto sigillato **è** un lotto in contesa: è il momento più in contesa che ci sia,
perché l'esito è già deciso e nessuno lo conosce.

**Niente cancello sui lotti a idoneo unico.** Lì non c'è nessuna busta da proteggere — l'unica offerta
in campo è l'auto-bid a 1 del chiamante, e «prezzo 1» è già implicito nel fatto che nessun altro
potesse offrire. Metterlo vorrebbe dire pagare X secondi per lotto, molti di fila a fine ruolo, per un
esito incontestabile: cioè disfare l'ottimizzazione che il commento di `openLot` descrive.

⚠ **La scadenza del pick dopo un annullamento è ancorata a `pausedAt`, non a `now`, e la spec diceva
`now`.** È l'unica deviazione di sostanza dalla lettera di M14 §6, e la ragione è che l'asta è **ferma**:
`resume` trasla ogni scadenza di quanto è durata la pausa, quindi un `now + pickSeconds` scritto durante
la pausa verrebbe traslato **una seconda volta**, e alla ripresa il chiamante avrebbe più tempo di
`pickSeconds`. Peggio, si vedrebbe subito: durante la pausa il client disegna
`pausedRemaining(deadline, pausedAt)`, che con `now` mostrerebbe «`pickSeconds` più i secondi già
passati in pausa» — un 30s configurato che a schermo dice 80. Ancorando a `pausedAt` il conto torna in
tutti e due i posti, e c'è un test con quei numeri dentro. Conseguenza notevole: **`cancelLot` è l'unica
transizione della macchina che non prende `now`**, e non prenderlo è più onesto che prenderlo per non
usarlo — l'ha fatto notare ESLint, non un ragionamento.

⚠ **`scripts/seed.ts` non viene segnalato da `tsc`, al contrario di quanto §8 della spec prevedeva.**
La spec diceva che rendere il campo obbligatorio in `AuctionConfig` avrebbe fatto fallire il letterale
`DEV_TIMERS`; non succede, perché `createAuction` prende `AuctionConfigInput`, dove ogni campo è
opzionale, e quell'oggetto non viene mai confrontato con `AuctionConfig`. Quindi il cancello corto nel
seed è entrato **a mano** e nient'altro lo avrebbe ricordato — che è esattamente il rischio che §8
segnalava, per una ragione diversa da quella che dava. **Provato per falsificazione** invece che
dedotto: commentando il `case "LOT_SEALED"` dello `switch` di `simulate`,
`pnpm db:seed --auction-status=mid` muore con `simulazione: fase inattesa LOT_SEALED`. Cioè quel
collaudo attraversa davvero la fase nuova, e ci passa **solo** grazie al cancello in `DEV_TIMERS`:
senza, avrebbe continuato a funzionare senza provare niente di ciò che la macro aggiunge. Con
`--auction-status=completed`: 200 lotti, tutti `RESOLVED`, asta `COMPLETED`.

**Gli helper dei test nascono con il cancello spento, e non è pigrizia.** `makeState`
(`tests/engine/helpers.ts`) e `makeGameAuction` (`tests/db/game-helpers.ts`) hanno
`resultGateSeconds: 0`. Serviva perché `createAuction` valida contro `DEFAULT_CONFIG`, che propone 10:
senza quella riga 28 test scritti prima di M14 trovavano `LOT_SEALED` dove si aspettavano
`LOT_REVEAL`. Ma è anche la scelta giusta e non solo la comoda: così **tutte le asserzioni che
esistevano prima del cancello sono la prova che con `X = 0` l'asta si comporta come a v1.14.0** — la
verifica 10 della spec, dimostrata da 815 test esistenti invece che da un test nuovo che lo racconta.

**`LotClosedCard` impara uno stato invece di nascere una terza card**, ed è la lezione di M1 applicata
al contrario. M1 diceva: il lotto vivo e il lotto chiuso devono avere due facce diverse, perché chi
guarda il telefono per tre secondi non deve dover *leggere* per capire che il lotto è finito. Qui il
lotto sigillato e il lotto aperto sono la stessa faccia in due istanti: la cosa già accaduta — «non si
offre più» — è la stessa, e ciò che cambia è solo se il risultato si conosce. Il prezzo appare **dove
prima scorreva il countdown**, quindi chi sta guardando nell'istante in cui le buste si aprono non ha
niente da ritrovare: il numero grande resta dov'è e cambia significato.

⚠ **La TV ha avuto bisogno di un ramo suo, e senza sbagliava in modo credibile.** Durante `LOT_SEALED`
`reveal` e `tie` sono entrambi `null`, quindi la colonna del lotto cadeva sul ramo del lotto vivo:
«Le buste sono segrete fino allo scadere» e un countdown puntato su `lot.endsAt`, che è un istante
**già passato**. Chi guarda avrebbe letto «in chiusura…» fermo per dieci secondi — un tabellone che
sembra piantato, nel momento esatto in cui tutta la stanza lo sta fissando.

**Tre flake preesistenti, trovati per strada e corretti qui.** Nessuno dei tre è di M14 — è stato
verificato riproducendoli — ma tutti e tre sono emersi perché un file di test in più ha cambiato
l'ordine dei lavori, e un rosso intermittente che si impara a ignorare è peggio di un rosso.
(1) `delete-auction.test.ts` confrontava il **conteggio** globale di `listone_players` e
`player_insights`, che due altri file scrivono in parallelo: la domanda vera è «la cascata ha portato
via qualcosa?», e a quella risponde il contenimento — ogni riga che c'era prima c'è anche dopo.
(2) `bots.test.ts` asseriva `toHaveLength(12)` su *tutte* le righe `is_bot`, che altri file creano con
nomi loro (`admin.test.ts` fa «Bot di prova» e «Bot 3»): un giro interrotto li ha lasciati a database e
da lì il test è diventato rosso a ogni esecuzione — si asserisce che i dodici nomi ci siano una volta
ciascuno, che è la non-duplicazione, cioè la proprietà vera.
(3) `scheduler.test.ts` teneva un orologio finto **dodici secondi avanti** a quello reale mentre
`startScheduler` accende anche lo sweep periodico, che interroga il database con l'orologio **vero**:
bastava che la suite durasse più di quei dodici secondi perché lo sweep facesse avanzare l'asta da sé e
la spia registrasse una chiamata che il timer non aveva fatto. La linea temporale è stata spostata di
un'ora, con la presence riscritta a quel momento. Dopo: dieci giri di suite di fila verdi, contro uno
rosso su otto prima.

**E un test nuovo è nato antisociale, corretto sul posto.** `sweep()` è globale — interroga tutte le
aste `LIVE` con la deadline scaduta — quindi passargli `advancePhase` così com'è significa far avanzare
anche le aste degli altri file: `scheduler.test.ts` è diventato rosso da lì («expected [] to include
…») per colpa di `cancello.test.ts` e non per un bug. La query resta quella vera, che è il pezzo di
boot recovery da collaudare; l'`advance` è filtrato sull'asta del test. Per la stessa ragione i due
test del crash **non asseriscono su quale sweep abbia pescato l'asta** — non è una proprietà nostra —
ma sull'esito, che è identico qualunque sweep l'abbia risolta: ed è precisamente la proprietà sotto
esame.

---

## 2026-08-18 — L'icona dell'applicazione, fuori macro

Su richiesta esplicita dell'owner, **senza aprire una macro**: l'icona era una delle due richieste che
M15 avrebbe portato, ma M15 è stata **annullata e riportata indietro** (il tema nuovo non è piaciuto, e
i tredici commit sono stati scartati con `dev` che non era mai stato pushato). L'icona è stata chiesta
da sé, quindi vive dove `CLAUDE.md` manda gli interventi piccoli: direttamente su `dev`, con questa voce
e la riga nell'indice delle macro.

**Tre file, non quattro, e il quarto è stato saltato di proposito.** `app/favicon.ico` con 16, 32 e 48
dentro, `app/icon.png` a 512, `app/apple-icon.png` a 180. ⚠ **Non c'è la misura a 192**, che ogni
elenco di favicon sul web dà per obbligatoria: qui non lo è, e vale la pena scriverlo perché sembrerà
una dimenticanza. Il 192 serve a un **manifest**, e questa applicazione non ne ha uno e non lo vuole
(un manifest la renderebbe installabile, cioè aggiungerebbe una superficie da mantenere che nessuno ha
chiesto). Senza manifest nessun consumatore sceglie il 192 al posto del 512: la linguetta e i preferiti
prendono l'ICO, iOS prende `apple-icon`, Chrome su Android prende la più grande. E sarebbe costato un
file di nome `icon1.png`, perché il suffisso numerico è il solo modo in cui Next accetta due icone
dello stesso tipo — un nome che fra sei mesi qualcuno aprirebbe per capire cos'è.

**Niente `metadata.icons` scritto a mano.** Next trova i tre file per convenzione di nome dentro `app/`
e genera i `<link>` da sé — verificato sulla pagina servita: `icon`/`x-icon` per l'ICO, `icon`/`png` a
`512x512`, `apple-touch-icon` a `180x180`, e le tre rotte rispondono 200 col tipo giusto. Scriverli a
mano vorrebbe dire tenere allineate due verità per la stessa cosa.

**I file sono committati, non generati in build.** Un'icona cambia una volta all'anno: tre immagini
sono **asset**, e un passo di build è un costo permanente per un lavoro che si fa una volta. La ricetta
sta in `scripts/genera-icone.py`, che **non è chiamato da niente** — né build, né `tsc`, né ESLint lo
guardano — e vuole Python con Pillow, che non sono e non devono diventare dipendenze del progetto.
⚠ **`sharp` sarebbe stata la scelta ovvia in un progetto Node e non è utilizzabile**: c'è sotto
`node_modules/.pnpm/sharp@0.34.5` perché lo porta Next.js, ma con `pnpm` non è issato, quindi un
`require("sharp")` dalla radice risponde `MODULE_NOT_FOUND`. Il dubbio «appoggiarsi a una dipendenza
non dichiarata di qualcun altro?» si è chiuso da sé: non si può.

⚠ **L'ICO è scritto byte per byte**, e l'alternativa era inutile: `Image.save(..., sizes=[...])` di
Pillow **ridimensiona da sé** partendo da una sola immagine, cioè butta via le rese preparate a mano —
che sono l'unica ragione per cui un ICO multi-misura esiste invece di un PNG solo. Il formato è
semplice: intestazione, una voce di indice per misura, i blocchi BMP con la loro maschera di
trasparenza in coda.

**La sorgente sta in `fixtures/favicon-512.png`, non nella radice e non in `public/`.** Nella radice
c'era perché era il modo di passarmela; in `public/` sarebbe servita a qualcuno senza che nessuno la
chieda. `fixtures/` è già il posto dei materiali che arrivano da fuori e non vengono serviti — i fogli
del listone, l'HTML dei rigoristi — e l'originale di un'icona è esattamente quello.

**Due scelte che dipendono da com'è fatto *questo* disegno**, e vanno riviste se l'icona cambia forma.
Il PNG è un **cerchio blu pieno** (`#0000FF`) a tela piena, con il fuori-cerchio trasparente.

1. ⚠ **`apple-icon.png` è appiattita sul blu del disegno, non sul bianco e non sul nero.** iOS riempie
   la trasparenza di nero da sé e poi ritaglia con la sua maschera a quadrato stondato: lasciarla
   trasparente darebbe un cerchio blu con **gli angoli neri**, che è il difetto da evitare. Fra le due
   tinte possibili si è scelta quella del disegno, perché così l'unica cosa che cambia rispetto
   all'originale sono i quattro angoli che iOS avrebbe dipinto di nero — il bianco avrebbe introdotto
   un colore che nell'originale non c'è, e reso l'icona «un pallino blu su un cartoncino bianco».
   L'esito è un quadrato blu pieno che iOS stonda da sé, cioè l'idioma della piattaforma.
2. **Nessuna maschera di contrasto sulle misure piccole.** Sulla sorgente precedente — un pallone da
   calcio coi pentagoni disegnati — serviva, perché a 16 pixel il dettaglio fine diventa una pappa
   grigia. Qui il disegno è una campitura piatta con un bordo curvo: non c'è nessun dettaglio da
   recuperare, e una maschera su un bordo antialiasato produce **solo un alone**. Guardate le rese
   ingrandite, a 16 pixel il cerchio è già netto. Il punto in cui rimetterla, se la sorgente torna a
   essere un disegno, è segnato nello script.

⚠ **Una cosa da non «aggiustare»**: sul `.ico` Next dichiara `sizes="16x16"`, perché legge la prima
voce dell'indice e non tutte e tre. Le tre misure ci sono — riletto il file per controllo. È
un'indicazione, non un vincolo: i browser aprono l'ICO e scelgono da sé. Correggerla vorrebbe dire
scrivere `metadata.icons` a mano, cioè rinunciare alla decisione qui sopra.

**Quello che questo intervento non fa**, per non ritrovarselo proposto come idea nuova: nessun
manifest, nessuna PWA, nessun service worker; nessuna variante a fondo chiaro per i contesti scuri (le
icone che seguono `prefers-color-scheme` sono supportate a chiazze, quindi si pagherebbe un secondo
file per una garanzia che non c'è); e nessun margine aggiunto per la variante `maskable` di Android,
che senza manifest non viene mai selezionata — e che comunque non servirebbe, perché il disegno **è**
un cerchio e un ritaglio circolare non gli toglie niente.

⚠ **Il blu è scuro, e su una linguetta scura si vede ma non salta all'occhio.** `#0000FF` ha una
luminanza intorno all'11%, cioè è il più scuro dei tre primari: contro il grigio antracite di una
linguetta in tema scuro il cerchio si legge, ma con poco stacco. Non è un difetto da correggere di
nascosto — è il colore scelto — ed è scritto qui perché chi lo noterà fra sei mesi veda il sintomo
accanto alla sua causa invece di sospettare un file sbagliato.

---

## 2026-08-18 — `/favicon.ico` in produzione non arriva a Node, e si lascia così

Scoperto **dopo** il rilascio di `v1.15.1`, verificando dall'esterno che le tre icone rispondessero.
Due su tre sì; `/favicon.ico` no.

**Chi risponde 404, e come si sa.** Non l'applicazione: nginx. Il 404 di `/favicon.ico` è il suo —
146 byte, «nginx» nel corpo, e soprattutto **senza `x-powered-by: Next.js`** — mentre qualunque altro
percorso inesistente riceve il 404 *di Next*, cioè viene proxato a Node e risponde l'app. Ed è un match
**esatto** sul percorso, non per estensione: `/qualsiasi-cosa.ico` e `/sotto/cartella/x.ico` arrivano a
Node senza problemi, solo `/favicon.ico` viene intercettato. La causa è il boilerplate di Ploi, che nel
server block generato tiene un `location = /favicon.ico { access_log off; log_not_found off; }`: nginx lo
risolve **dal disco**, e con `output: 'standalone'` quel file sul disco non c'è — sta in `app/` e lo
serve l'applicazione. `deploy/nginx-asta.conf` sostituisce il `location /` di Ploi, **non** il resto del
suo boilerplate, quindi quel blocco non l'avevamo mai visto.

⚠ **È preesistente, e questo è il punto che evita una caccia inutile.** Misurato anche a `1.15.0`, un'ora
prima: stesso 404 da nginx. In produzione quel percorso **non ha mai servito niente**, nemmeno il
`favicon.ico` che Next.js mette in un progetto appena creato. Il rilascio dell'icona non l'ha rotto,
l'ha reso visibile — che è la ragione per cui vale la pena guardare le rotte dopo un deploy invece di
fidarsi del «completato».

**Deciso dall'owner: si lascia così** (2026-08-18). L'icona si vede comunque, e non per fortuna: il
browser scende al `<link>` successivo e prende `icon.png` a 512 ridimensionandolo da sé, iOS prende
`apple-icon.png`. L'unica cosa che si perde è la resa a 16/32/48 preparata a mano dentro l'ICO, cioè la
nitidezza dell'icona nella linguetta. Il `<link rel="icon" href="/favicon.ico">` che Next emette resta
un link morto ed è innocuo. Modificare la configurazione nginx di un server in produzione per la
nitidezza di un'icona a sedici pixel non è un rapporto costo/beneficio che regge.

**E `app/favicon.ico` resta dov'è**, invece di essere cancellato per togliere il link morto: in locale
funziona, è il file giusto se un giorno quel blocco di Ploi sparisce, e cancellarlo vorrebbe dire
buttare via le tre misure preparate a mano per guadagnare un `<link>` in meno in una pagina.

**Come si correggerebbe**, scritto in `deploy/nginx-asta.conf` accanto al resto: da Ploi → il sito →
Manage → Nginx configuration si **cancella** quel blocco, così `/favicon.ico` ricade nel `location /` e
viene proxato come tutto il resto, poi `sudo nginx -t && sudo systemctl reload nginx`. ⚠ E non si
aggiunge un `location = /favicon.ico` nel *nostro* file: sarebbe un secondo match esatto sullo stesso
percorso nello stesso server block, e nginx rifiuta di ripartire. Va **sostituito** quello di Ploi, non
affiancato.

---

## 2026-08-22 — M16: il ritiro si toglie fino in fondo, i valori suggeriti spariscono

Quattro decisioni dell'owner, prese aprendo M16 e ratificate qui perché tre di esse cambiano una
regola del gioco e la quarta cambia il perimetro di due macro.

**1. Il ritiro si toglie fino in fondo, motore compreso** — non solo il pulsante. La ragione è la
regola 6 letta al contrario: la regola dice «la UI disabilita, il server rifiuta comunque», e se si
fosse tolto solo il pulsante il server **non** avrebbe rifiutato. Un `POST` costruito a mano avrebbe
continuato a ritirare un'offerta, e la nuova regola del gioco sarebbe vissuta soltanto nel codice
del browser. In un'asta fra amici il rischio pratico è nullo; il punto è un altro, ed è che questo
progetto non ha mai una regola che esista solo lato client — lasciarne una qui vuol dire che fra sei
mesi nessuno saprà più se il ritiro c'è o no. Spariscono quindi `WITHDRAW_BID` dalla macchina a
stati, `withdrawBid` dalle azioni, il `case "WITHDRAW"` dalla rotta, i codici `BID_WITHDRAWN` e
`WITHDRAW_FORBIDDEN`, e `canWithdraw`/`haveWithdrawn` dal portale. Un `WITHDRAW` adesso cade nel
`default` della rotta e riceve `INVALID_REQUEST` — «questa azione non esiste», che è la risposta
giusta e non «non puoi ritirare adesso».

**2. La colonna `withdrawn_at` resta, con tutti i suoi lettori.** Nessun `pnpm db:push`, nessun
backfill, nessun `pg_dump` prima del rilascio: la macro toglie tutti gli **scrittori** e non tocca
**nessun lettore**. Restano il filtro di `resolveRound`, il round-trip di `mutate.ts`, il campo negli
snapshot, il `line-through` del reveal — in TV e nel portale — e le righe del log dei lotti. Su
tutto ciò che si scrive da qui in avanti è `null`, ma le aste già giocate hanno dei ritiri dentro:
un lettore tolto non semplificherebbe niente, riscriverebbe il passato.

⚠ **E `"WITHDRAW_BID"` resta dentro `ROUTINE_EVENT_TYPES` in `lib/auction-log.ts`**, che è la riga
che sembra più di tutte da cancellare e va lasciata. Quel file ha una scelta deliberata scritta in
un commento — *un tipo sconosciuto è notevole* — perché lo storico delle correzioni deve mostrare un
evento nuovo anche se nessuno si è ricordato di elencarlo. La conseguenza è che togliere
`WITHDRAW_BID` da quell'elenco non farebbe sparire i ritiri storici: li **promuoverebbe**, facendoli
comparire di colpo nel blocco delle correzioni di un'asta già giocata, dove non sono mai stati.

**3. In TV due colori e non tre**, e `IDLE` conta come collegato. In TV la domanda è «possiamo far
partire il round?», e un tab in secondo piano non è una persona assente: è qualcuno che ha il
telefono in tasca ed è nella stanza. È anche l'unico punto dell'app in cui l'ambra sarebbe stata
sbagliata — in TV l'ambra è già la pausa e già la riconnessione, e un terzo significato sullo stesso
colore, a tre metri, non si distingue. La mappa sta in `tvConnected` (`lib/realtime/portal.ts`), in
un posto solo e con il suo test.

**4. M16 esce prima di M17**, che è più grande e più rischiosa. Sono indipendenti e l'ordine si
potrebbe invertire, ma M17 ridisegna una card da cui M16 ha già tolto un ramo — e soprattutto, se il
layout a tre colonne di M17 non convincesse, tornare indietro **non deve rimettere in piedi il
pulsante «Ritira»**. Due tag, due punti di rollback. Il precedente che pesa è M15, guardata e
buttata.

### Cosa questo rende parzialmente falso, e non si riscrive

`docs/PLAN.md` è **archivio**: §297 («il chiamante non può ritirare, può solo rilanciare»), §314
(«il ritiro è disabilitato nel round 2»), la firma di §544 e gli scenari 7 e 8 di §683-684
descrivono un comportamento che dopo questa macro non esiste più. Restano scritti come stanno, ed è
il precedente letterale di M13, che ha ribaltato M6 §8 senza riscrivere il file di M6. La ratifica è
questa nota, insieme a `docs/ARCHITECTURE.md`, che è il documento che si legge per capire com'è
l'app **adesso**.

⚠ Nessuno degli invarianti I1–I10 viene modificato: non nominano il ritiro. **I5** — il tetto
`max_bid` — è l'unico che la macro sfiora, e lo sfiora per rafforzarlo: `max NN` resta scritto
nell'intestazione del modale, perché è il limite che il server applica e non un valore suggerito.
Sparisce il pulsante che scriveva quel numero nel campo, non l'informazione che il tetto è quello.

---

## 2026-08-22 — La Lobby sparisce dal menù ad asta LIVE, e la regola della navbar si restringe

Chiesto dall'owner a macro M16 già chiusa su `dev`, prima del rilascio: «la voce Lobby se l'asta è
live mi fa fare redirect, e questo mi va bene. Vorrei però nascondere la voce dal menù in quello
stato, non ha senso avere un link che mi fa redirect». Entra in M16 perché `CLAUDE.md` dice che una
correzione piccola vive dentro la macro aperta.

**Il fatto.** `LobbyLive` ha l'unico `router.push` automatico dell'applicazione: chi è **membro**,
arrivando in lobby con l'asta `LIVE`, viene portato al portale. La voce di menù che ci porta è
quindi un viaggio di andata e ritorno — un tocco che restituisce il punto di partenza.

**Cosa cambia, e cosa deliberatamente no.** La Lobby è nascosta se e solo se
`isMember && status === "LIVE"`, che è **la condizione del rimbalzo copiata**, non una più larga.
Due casi restano fuori apposta:

- **In pausa la voce resta.** La spinta al portale è stata tolta da `PAUSED` con una decisione
  precedente e per una ragione precisa — la pausa è il momento in cui si va a cambiare i tempi, e
  finché la spinta valeva anche lì l'owner veniva rispedito al portale a ogni tentativo. Nascondere
  la voce in pausa rimetterebbe in piedi quel problema dall'altro lato.
- **All'owner che non gioca la voce resta sempre** (⚠ P11). Non è membro, quindi non viene spinto da
  nessuna parte: per lui la lobby ad asta in corso è la lista dei partecipanti coi loro pallini, cioè
  una destinazione vera. Nasconderla sarebbe togliere un link che funziona.

**La regola scritta in `lib/auction-nav.ts` è stata ristretta, non abolita**, e la distinzione è il
punto di questa nota. Quel file diceva: «le sezioni dipendono dal **ruolo** di chi guarda e mai dallo
**stato** dell'asta», con una motivazione tecnica che vale ancora — il ruolo non cambia mentre
guardi la pagina, lo stato sì, e la navbar è renderizzata dal server. Adesso lo stato entra in **un
caso solo**, e la motivazione resta scritta accanto alla deroga invece di essere cancellata.

⚠ **Lo stato arriva da `getAuctionOverview`, non dallo snapshot.** Alimentare la navigazione dallo
stream sarebbe trasformarla in stato di gioco (regola 7), e quella riga non si è mossa: la navbar
legge lo stato dalla stessa lettura da cui esce il resto del layout. Il prezzo è la staleness, ed è
piccolo per costruzione — il layout è dinamico e si rirenderizza a ogni navigazione, e **la spinta
al portale è essa stessa una navigazione**, quindi il caso che conta si corregge da sé nell'istante
in cui si verifica. Resta stantia solo per chi sta fermo su una pagina mentre l'asta cambia stato,
ed è un costo accettato consapevolmente.

⚠ **`activeSection` adesso legge il catalogo intero e non passa più da `auctionSections`**, ed è la
riga che tiene in piedi tutto il resto. Da questa modifica in poi esiste una cosa che prima non
esisteva: una sezione **nascosta dal menù ma raggiungibile** — la Lobby ad asta `LIVE`, che l'owner
che non gioca continua ad abitare e il cui URL funziona per chiunque lo digiti. Se il titolo della
pagina venisse cercato fra le voci *visibili*, quella pagina perderebbe la propria intestazione
proprio nello stato in cui la voce è nascosta, e al posto di «Lobby» si leggerebbe il nome dell'asta
— il ripiego di `AuctionNav` per le rotte che non riconosce. C'è un test apposta.

**Quello che questa correzione non fa.** Il link alla lobby nella **dashboard** (`/dashboard`, per
chi non è owner) continua a portare in lobby anche ad asta `LIVE`, quindi rimbalza al portale
esattamente come faceva la voce di menù. È lo stesso difetto un click prima, non è stato toccato
perché fuori dalla richiesta, ed è annotato qui perché è il posto in cui lo si ritroverà.

---

## 2026-08-22 — Il portale a tre colonne: le cinque decisioni di M17, più le cinque prese lavorando

Le prime cinque sono dell'owner, prese **prima di scrivere una riga** e già registrate in
`docs/features/17-portale-tre-colonne.md`. Stanno qui perché quel file è la spec di una macro e
questo è il posto in cui si cercano le scelte:

1. **Le tre colonne partono da `lg` (1024px).** Sotto, il portale resta identico: colonna unica,
   intestazione incollata in cima. Nessun ridisegno del telefono.
2. **Su desktop l'intestazione incollata sparisce** e i suoi numeri diventano la prima cosa della
   colonna 1.
3. **Il pannello di chiamata vale ovunque, telefono compreso, ed è richiudibile** come quello
   d'offerta: stessa cornice, stesso comportamento, una forma sola da imparare.
4. **La colonna 3 è due card**: una di stato che non sparisce mai, e una di scena che cambia con la
   fase.
5. **La fase si vede da una fascia colorata di 4px in testa alla card**, non da un bordo o da un
   fondo tinto: il colore sta tutto in una striscia, il contenuto resta su fondo neutro.

Le cinque che seguono sono state prese **lavorando**, dopo aver guardato un provino statico dei
colori e delle tre colonne prima di scrivere React. Quella precauzione è la lezione di **M15**, che
era una macro tutta visiva lavorata per intero, guardata una volta e buttata: tredici commit
scartati. Qui il provino è costato una sessione e ha cambiato quattro cose su cinque.

### L'identità è inglobata nella card della rosa, e è grigia

Il provino la mostrava come card a sé sopra «La tua rosa», che è ciò che la richiesta chiedeva
letteralmente. Guardandolo, l'owner ha chiesto di inglobarla: **una colonna che comincia con due
cornici bianche una sopra l'altra chiede a chi guarda di capire perché sono due.** Il fondo grigio
(`bg-muted`) dice in un colpo che quello è un altro genere di cosa — i miei numeri, non i miei
giocatori — senza spendere una seconda cornice.

Nella stessa occasione **l'ordine di chiamata dei ruoli è stato tolto** dalla riga del titolo, che
adesso porta solo «La tua rosa».

⚠ **Va saputo che quell'informazione adesso non si legge da nessuna parte.** Il portale era l'unico
posto dell'app che scriveva `roleOrder`, e `RosterGrid` elenca i ruoli nel suo ordine fisso
(P → D → C → A) e non in quello dell'asta: in un'asta che chiama i portieri per ultimi, dopo questa
modifica nessuna schermata lo dice. Quale ruolo è in gioco *adesso* resta, nella card di stato. Se un
giorno servisse, il posto naturale è una riga in più in quella card e non il titolo.

### Il badge «riconnessione…» sta nell'identità, non nella card di stato

Non è una scelta di layout ma di significato, e nasce da un buco che la decisione 2 apriva: la barra
incollata diventa `lg:hidden`, quindi quel badge — che stava solo lì — **da 1024px in su sarebbe
diventato invisibile**. Una riconnessione in corso è precisamente la cosa che non si può non dire.

Il posto ovvio sarebbe stato la card di stato, ed è stato scartato: quella dice come sta **l'asta** —
una cosa sola, uguale per tutti, che arriva dallo snapshot — mentre questo dice come sta **il mio
browser**, ed è l'unica informazione del portale che non viene dallo snapshot ma dalla connessione
che lo trasporta. Mescolarli fa sembrare un problema di rete un problema della partita. Sta dentro
`<Identity>`, quindi si vede in tutti e due i contenitori senza che nessuno lo duplichi.

### Il timer è una banda in fondo alla card, con un anello e non una barra

Il provino aveva il countdown come numero grande nel corpo della card, com'era prima. Guardandolo,
l'owner l'ha bocciato: «è un elemento con font-size molto grande in uno spazio limitato».
Diagnosticandolo si è visto **perché** stonava, e la ragione non era la dimensione: quel numero era
**identico in tutte le scene**, ma solo in tre la risposta è «devi fare qualcosa adesso». In «sta
chiamando un altro» — la scena che dura undici turni su dodici — chiedeva attenzione senza chiedere
niente, e in una colonna da 350px la chiedeva anche sopra il resto della card.

Sono state provate cinque forme guardandole affiancate alla larghezza vera di una colonna. La scelta
è **la banda in fondo**: etichetta a sinistra, cifra e misura stretti a destra, staccata da un bordo,
nell'ultimo pixel della card in tutte e sette le scene che hanno una scadenza. Poi, su proposta
dell'owner, la misura è diventata **un anello** invece di una barra.

⚠ **La controindicazione dell'anello è stata misurata e accettata, non ignorata.** Una barra a piena
larghezza è un segnale **periferico** — duecentocinquanta pixel che si vedono con la coda dell'occhio
mentre si guarda il campo dell'offerta; un anello da 22px è un segnale **centrale**, che va guardato.
È stato messo a confronto sfocato, per approssimare ciò che la visione periferica risolve, e la barra
regge meglio. L'anello è stato scelto comunque, e la ragione tiene: a un tempo che **scade**
corrisponde un quadrante, mentre una barra che si riempie è la metafora di un lavoro che avanza — e i
22 pixel sono ciò che permette a etichetta, cifra e misura di stare su una riga sola in una colonna
da 350.

⚠ **Una proposta intermedia è stata scartata e vale la pena che resti scritta**: anello nelle scene
in cui non si agisce, barra nelle tre in cui sì. Risolveva due problemi con una regola sola, ma
chiedeva di imparare **due forme** per una card che deve essere leggibile senza impararla. Se un
giorno l'anello non convincesse guardandolo, quella è la strada già istruita.

### Il rosso solo dove c'è una scadenza mia da mancare

Conseguenza della decisione precedente, e la cosa su cui i numeri hanno deciso più del gusto. Le tre
soglie del colore esistevano già dentro `CountdownBar` da v1.0.0 — sopra il 50% verde, sopra il 20%
ambra, sotto rosso — e applicandole alla banda in tutte le scene la banda diventerebbe rossa **a ogni
lotto**: in una serata a otto persone con venticinque slot, circa duecento volte, e tre volte su
sette in scene dove non è chiesto niente (l'esito, le buste da aprire, la chiamata di qualcun altro).

Un rosso che non chiede mai niente si impara a ignorare, e poi non funziona più nelle tre volte in cui
vuol dire «muoviti». Quindi il colore dipende da `sceneTime().pressing` e non solo dal tempo: acceso
in «tocca a te», «offerte aperte» e «spareggio», grigio altrove per tutta la corsa. Il rosso passa da
~200 comparse a ~25.

⚠ **Le soglie sono state spostate in `timeTone` e `CountdownBar` adesso le legge da lì.** Non è
rifattorizzazione per pulizia: la banda della card e la barra dentro i due pannelli devono dire la
stessa cosa sullo stesso countdown, e due copie di «sotto il 20% è rosso» sono due copie che un
giorno divergono.

### La fase nella card di stato ignora la pausa

`phaseLabel` fa vincere la pausa su tutto, per una ragione che vale ancora: in proiezione «in pausa»
è la prima cosa che chi guarda deve poter leggere. Nella card di stato quella precedenza produceva una
card che si ripeteva — badge «in pausa», fase «in pausa», a due centimetri di distanza.

La spec vietava di scrivere una seconda frase («la stessa che usano la TV e la regia. Non se ne scrive
una seconda»), e il divieto è stato rispettato **fattorizzando invece di duplicando**: lo `switch`
delle frasi è diventato `phaseLabelIgnoringPause`, e `phaseLabel` gli delega dopo aver applicato le
sue precedenze. «Offerte», «spareggio» e «buste da aprire» esistono in un posto solo, e chi ne cambia
una le cambia per tutti i chiamanti. C'è un test che asserisce la **relazione** fra le due funzioni —
ad asta in corso dicono la stessa cosa in tutte e cinque le fasi — così se un giorno lo `switch`
venisse duplicato per comodità sarebbe un rosso a dirlo.

Il guadagno è che in pausa la card dice **entrambe** le cose: in pausa, *durante un round di
offerte*, che è precisamente ciò che significa «la pausa congela la fase, non la azzera».

### Due cose di copia che il layout ha reso false

Non sono decisioni di design ma vanno annotate, perché sono il tipo di errore che sopravvive a un
rilascio: «Le rose sono chiuse. **Qui sotto** la tua, con i prezzi pagati» era vero con una colonna
sola e diventa falso metà delle volte con tre — su desktop la rosa sta *accanto*. Il rimando è stato
tolto e **non sostituito** con «qui accanto»: la rosa è la cosa più grande della pagina e non ha
bisogno di essere additata. Allo stesso modo sono sparite le intestazioni «L'asta non è iniziata» e
«Asta conclusa» dalle card di scena, perché la card di stato dice la stessa cosa dieci pixel più su.

⚠ **La regola generale che se ne ricava**, e che vale per la prossima macro che tocca un layout: una
copia che nomina una **direzione** è una copia che un cambio di layout può rendere falsa senza che
nessun test se ne accorga. Vale la pena cercarle con un grep — «qui sotto», «qui sopra», «qui
accanto» — ogni volta che si sposta qualcosa.

### Nell'esito il pulsante segue la notizia, non la card

Chiesto dall'owner il 2026-08-22 **dopo aver guardato una simulazione girare**, che è esattamente il
momento in cui M17-09 doveva produrre correzioni: «quando viene mostrato l'esito del lotto sposta il
pulsante per proseguire l'asta sotto il div dove mostri chi si è aggiudicato il calciatore, non in
fondo. Rendi inoltre il pulsante nero, seguendo lo styling dell'app».

**Perché non indebolisce l'anatomia di §6.** In otto scene su nove il corpo è corto, quindi «in fondo
alla card» e «subito sotto la notizia» sono lo stesso pixel e la distinzione non si pone. Nell'esito
no: sotto la riga del vincitore c'è l'elenco di tutte le buste di tutti i round, che con dodici
partecipanti sono dodici righe — un'**appendice**, non la notizia. Con il pulsante in fondo bisogna
scorrere oltre l'appendice per far ripartire l'asta, e lo si preme dal telefono con dodici persone che
aspettano. La regola che regge, riscritta, è **«l'azione segue la notizia»**, e nelle altre otto scene
le due formulazioni coincidono.

⚠ **Il cancello resta con il pulsante nello slot in fondo**, e non è un'incoerenza: lì il corpo è un
paragrafo di due righe, quindi il pulsante è già subito sotto la notizia. Spostarlo dentro il corpo
avrebbe prodotto lo stesso pixel con una riga di codice in più.

**E il nero è il pulsante primario dell'app.** Era `variant="outline"`, cioè contornato, mentre
«Mostra risultati» nel cancello era già pieno. Sono lo stesso gesto in due momenti — anticipare una
scadenza che scadrebbe da sé — e averne uno pieno e uno contornato faceva sembrare che uno dei due
fosse meno definitivo dell'altro. Adesso hanno la stessa forma.

### La riga del giocatore nella lista di chiamata: il taglio passa da «fonte» a «domanda»

Chiesto dall'owner il 2026-08-22, dopo aver provato il pannello: due righe per ogni card, con
**FMA, titolarità e PMA** sulla prima e **rigori, piazzati e note** sulla seconda. Il `PMA` con
accanto il suo valore assoluto rispetto ai crediti dell'asta.

**Cosa cambia davvero.** La riga era già su due righe da M10B, ma divise per **fonte**: sopra i
numeri di stagione di fantacalcio.it, sotto il giudizio del foglio di Carmy. Adesso sono divise per
**domanda**: sopra *quanto vale* — le tre cose che si confrontano fra due giocatori — sotto *cosa
porta in più*, che è qualitativo e si nota invece di confrontarsi.

⚠ Il taglio per fonte era comodo per chi scrive il codice e non serviva a chi guarda: chi ha
ventidue secondi per scegliere non sa, né gliene importa, da dove arriva un numero. È lo stesso tipo
di errore della copia che nomina una direzione — una struttura che descrive l'implementazione invece
dell'uso.

**Il `PMA` in crediti**, che è la parte nuova: una percentuale non si può offrire, e sotto un
countdown nessuno converte `10,5%` di `500` a mente. La conversione è `pmaCrediti` in
`lib/domain.ts`, funzione pura con il suo test.

⚠ **E non è il «prezzo consigliato», anche se sembra la stessa cosa.** Il foglio ha due colonne
indipendenti — `prezzo`, un assoluto, e `pma`, una percentuale — e la misura sui byte lo dice: solo
132 righe su 385 rispettano `prezzo / 5`. Quindi **nella stessa serata i due numeri possono
divergere**: la lista di chiamata mostra `PMA 2,5% (13)` e il modale d'offerta, sullo stesso
giocatore, «consigliato 41». Non è un bug ed è annotato qui perché è precisamente il tipo di
differenza che sembra un bug: sono due giudizi diversi di chi compila il foglio, e ricalcolare l'uno
dall'altro vorrebbe dire sostituire il suo dato con una nostra stima.

⚠ **Il minimo è 1 credito.** Con un budget basso il `pma` più piccolo che il foglio scrive (0,2%)
arrotonderebbe a zero, e «zero crediti» è un'offerta che il motore rifiuta — un suggerimento
impossibile da seguire. È la stessa ragione per cui il parser traduce in assente il `prezzo` scritto
`0` (M10B-02).

⚠ **«FMA» è una sigla da tenere d'occhio, e il rischio era già scritto nel codice prima di questa
richiesta.** In questo progetto `fvm` è il **Fantavalore di Mercato**, che sta sulla **stessa riga
della card**, all'estremità destra, come `fvm 300`; `FMA` è la **fantamedia attesa**. Sono due sigle
di tre lettere con le stesse due consonanti a otto centimetri l'una dall'altra, ed è la ragione per
cui prima quel numero si chiamava «attesa» e non con una sigla. La richiesta è stata seguita perché
l'etichetta esplicita è più utile di una parola generica, ma se un giorno qualcuno le confonde **il
rimedio non è cambiare `FMA`**: è dare un nome anche al numero a destra, che oggi è l'unico dei due
a non averne uno.

**I crediti dell'asta arrivano come prop dalla pagina server**, non dallo snapshot: `budget` è la
terza prop di quel genere dopo il listone e `viewerIsOwner`, e per la stessa ragione — non è stato di
gioco e non cambia durante la serata. M17 §8 dice che un dato mancante nello snapshot è il segnale di
fermarsi e chiedere; qui non è servito, perché quella strada esisteva già e `serializeSnapshot` non è
stato toccato (I8 intatto).

**Cosa è stato tolto, e cosa è rimasto.** Il rapporto grezzo `31/38` era stato tenuto in un primo
giro perché non era nell'elenco della richiesta, e l'owner ha chiesto di **toglierlo** guardandolo.

⚠ **Va saputo cosa se ne va con lui**: era la *prova* del giudizio di Carmy, che è un voto da 1 a 5 e
non una percentuale, e la **divergenza** fra i due era l'informazione — un «titolarità 5» su un
giocatore con dodici presenze da titolare si vedeva solo lì. Non è però sparito dall'applicazione:
`InsightsMacro` lo scrive per esteso («31/38 da titolare») nel **modale d'offerta**, cioè nel momento
in cui ci sono i secondi per leggerlo. La lista di chiamata è il posto in cui si scorre, e lì restano
la titolarità e i minuti medi.

I minuti medi restano sulla riga 1 accanto alla titolarità. La fascia sta sulla riga 2 con le note,
che è dove un giudizio qualitativo appartiene. Affidabilità e integrità restano fuori da entrambe,
come da M10B: vivono nel modale d'offerta.

### La card di chiamata in quattro righe, e `fvm` che sparisce

Chiesto dall'owner il 2026-08-22, dopo aver caricato i due file e visto la riga piena per la prima
volta. La card di ogni giocatore passa da «un nome con dei numeri a destra» a **quattro righe**:

0. la **squadra** in un badge grigio a sinistra, la **titolarità** a destra — solo il badge;
1. il **nome** a sinistra, un po' più piccolo, e **FMA + PMA** a destra;
2. **bonus e note** — rigori, piazzati, fascia, i tag del foglio;
3. il **pulsante «Chiama»** a piena larghezza.

**I minuti medi sono stati tolti.** Erano il secondo numero della titolarità, e il badge porta già la
sua misura dentro: la percentuale quando viene dalle presenze, il voto su 5 quando viene dal foglio.

⚠ **`InsightsLine` non esiste più.** Era la composizione che disegnava tutto il blocco insight della
lista, e i suoi tre pezzi sono finiti in tre posti diversi della card: si è sciolta in `ValoriCarmy`
e `BonusENote`, che sono pezzi come `TitolaritaAnyBadge` e `SetPieceBadges`. Non è una perdita di
astrazione — quel file esporta pezzi e non composizioni pronte da M10, e una composizione con un solo
chiamante che va spezzata in tre non è un'astrazione ma un ostacolo.

⚠ **Il pulsante «Chiama» è uno `<span>` e non un `<button>`.** Un `button` dentro un `button` è HTML
non valido, e la card intera è già il bersaglio. Tenerla cliccabile per tutta la sua area vale più di
un bersaglio preciso: si preme in piedi, sotto un countdown, e un tocco a lato costa un giocatore
sbagliato. Il pulsante è l'**affordance** di ciò che la card fa, non un secondo comando.

### ⚠ `fvm` toglie l'ordine da sotto gli occhi, e va saputo

«C'è un valore FMV che non capisco cosa sia, toglilo» — era **`fvm`, il Fantavalore di Mercato**, e
la richiesta è la conferma di un rischio che il codice aveva messo per iscritto **due ore prima**,
introducendo l'etichetta `FMA`: due sigle di tre lettere con le stesse due consonanti, a pochi
centimetri l'una dall'altra, per due cose che non si somigliano. Il rimedio previsto era «dare un nome
anche al numero a destra»; l'owner ha scelto il rimedio più corto, cioè non mostrarlo.

**La conseguenza non è cosmetica e non è nel dato**: `availablePlayers` **non è stato toccato** e
ordina ancora `fvm DESC, quot DESC`, che è l'ordine esatto dell'auto-pick. Ma quel numero era anche
**la spiegazione visibile dell'ordinamento**, e adesso la card mostra `FMA` e `PMA`, che non sono
monotoni: scorrendo, la lista sembrerà ordinata per niente.

Ciò che tiene in piedi la promessa «il primo della lista è quello che il timer prenderebbe» è la
**riga dell'auto-pick** sopra l'elenco, che lo dice **per nome** invece di lasciarlo dedurre da una
colonna di numeri. È la strada che M10B §6 aveva già scelto per un'altra ragione — un filtro acceso
rompeva la deduzione — e che qui si ritrova a reggere da sola. Se un giorno quella riga venisse
togliesse, l'ordinamento diventerebbe muto: è annotato qui perché è il collegamento che nessuno
troverebbe partendo dal codice.

⚠ **`fvm` resta scritto in due posti che questa richiesta non ha toccato**: la card del lotto («fvm
118» sotto il nome del giocatore a lotto) e l'intestazione del modale d'offerta. Il secondo è fuori
perimetro per M17 §8, che dice esplicitamente che il modale d'offerta resta com'è. Il primo è in
perimetro e **non è stato cambiato di iniziativa**: se la sigla è incomprensibile lì com'era nella
lista, va tolta o rinominata in tutti e due, e quella è una decisione da prendere guardandoli.

---

## 2026-08-22/23 — M18: la rosa a fisarmonica, le quote di reparto, l'ordine di estrazione

Quattro decisioni prese dall'owner il 2026-08-22, tutte **prima** che fosse scritta una riga di
codice, più due cose emerse lavorando il 23.

### La percentuale è sul budget a disposizione, non sulla spesa fatta

«Se spendo 250 su 500 sui portieri, ho investito il 50%.» Il denominatore è quindi
`crediti + Σ prezzi`, cioè il budget, e non `Σ prezzi`.

Perché la spesa sarebbe stata la scelta sbagliata: **è volatile e insegna poco**. Al primo acquisto
il reparto starebbe al 100%; a metà asta direbbe come si è distribuito ciò che si è speso, non quanto
budget è impegnato. La quota sul budget invece è confrontabile con la ripartizione che uno si è
prefissato prima di sedersi, ed è il numero su cui si decide se fermarsi.

**Conseguenza voluta: le quattro percentuali non fanno 100.** Ciò che manca sono i crediti ancora in
cassa, che è a sua volta un'informazione. Non è una somma da far quadrare, e non va «corretta».

⚠ **Le rettifiche di budget (I3) entrano nel denominatore.** `credits` include già `Σ ledger.delta`,
quindi il denominatore è il budget **corrente**, non quello di partenza: dopo una rettifica le quattro
quote si spostano tutte. È la lettura giusta di «crediti a disposizione», ed è anche l'unica onesta —
è cambiato il totale su cui si sta ragionando.

Il budget iniziale **non è stato aggiunto allo snapshot**: `crediti + speso` lo ricostruisce, ed è la
stessa identità con cui si controlla a vista che i conti tornino. Il calcolo vive in
`quotaPerRuolo` (`lib/realtime/portal.ts`), funzione pura, per la stessa ragione di `bidBounds` e
`sceneTime`. E **`spentCredits` non è stato spostato** da `manage.ts`, dove ha un chiamante contento:
serviva un totale, e sta dentro `quotaPerRuolo` (regola 8).

**A zero speso si scrive `(0%)`**, non uno spazio bianco: è la lezione di M17 sull'anatomia fissa — un
numero che compare solo a volte costringe a chiedersi perché non c'è. Il solo caso in cui non si
scrive niente è budget 0, dove la quota non esiste.

### Il ruolo in gioco si apre da sé, e lo fa con una `key`

La fisarmonica non parte tutta chiusa: il reparto che l'asta sta chiamando adesso è aperto, e al cambio
di ruolo l'apertura si sposta.

⚠ **La forma sbagliata era un `useEffect`** che sincronizzasse `auction.currentRole` in uno stato
locale: due sorgenti di verità, e un click dell'utente sovrascritto al prossimo snapshot — cioè un
accordion che si richiude sotto le dita ogni due secondi, in un portale che riceve uno snapshot ogni
pochi istanti. La forma giusta è una **chiave** su `currentRole`, e non serve niente altro.

La proprietà che ne esce è esattamente quella voluta: **la scelta a mano vale finché il ruolo in gioco
non cambia**. Aperti i difensori mentre l'asta chiama i centrocampisti, restano aperti — nessuno
snapshot li richiude — ma quando l'asta passa agli attaccanti la fisarmonica si rimonta con gli
attaccanti aperti. Lo stato locale non è mai *contro* lo snapshot: è azzerato da lui.

È la stessa famiglia dei `dismissed*` di M17 e sta dentro I10 (`PLAN §8bis`) per la stessa ragione:
**niente è raggiungibile solo perché eri qui prima**. Chi ricarica ritrova il reparto in gioco aperto e
gli altri chiusi, cioè lo stato di chi non si è mai mosso, e **nessuna informazione vive solo dentro un
pannello aperto** — la riga chiusa dice già nome, quota e `n/tot`. È ciò che rende accettabile perdere
l'apertura con un F5.

**Con `currentRole = null` è tutto chiuso**, cioè ad asta non iniziata e ad asta conclusa: a fine asta
la rosa completa si presenta come quattro righe con le quattro quote e i quattro `n/tot`, che è il
riepilogo giusto per quel momento. È una scelta e non una dimenticanza — «a `null` apro il primo
reparto» darebbe un reparto aperto a caso.

### La fisarmonica vale solo in `/play`: due componenti, non una prop booleana

In regia la rosa dei membri resta piatta come prima: lì servono 8–12 rose a colpo d'occhio, e un
accordion le nasconderebbe tutte. Niente percentuali nemmeno lì — accanto c'è già la `Figure` «speso»,
e dodici card con quattro percentuali ciascuna sono quarantotto numeri che nessuno legge.

⚠ **La strada breve era `<RosterGrid fisarmonica />`, e è stata scartata**: un booleano che accende
**due cose diverse** — la fisarmonica *e* le percentuali — e un componente che si porta dentro due
alberi che non si somigliano. Con due chiamanti veri e diversi la forma giusta sono **due componenti
esportati** (`RosterGrid` per la regia, `RosterAccordion` per il portale) e **un corpo privato
condiviso** nello stesso file per le righe dei presi e le caselline: è l'unica cosa davvero uguale
nelle due forme. Non si esporta — è un dettaglio di quel file, non un'astrazione (regola 8).

`Accordion` arriva **direttamente da `radix-ui`**, come già fanno `Dialog`, `Toast` e `Switch`, e
**non** da un file nuovo in `components/ui/`: un accordion con un chiamante solo non è una primitiva
del design system, e `npx shadcn add` riscriverebbe `layout.tsx` (l'inciampo di M15). ⚠ Utile saperlo:
`Accordion.Header` rende un `Primitive.h3`, quindi **è** l'`<h3>` che c'era già — non va aggiunto un
secondo titolo dentro.

### L'ordine di estrazione vale ovunque, e la modifica è sottrattiva

Portale, regia e TV. La lista era ordinata per prezzo, quindi un acquisto da 45 crediti non si
aggiungeva in fondo al reparto: si metteva in cima e spingeva giù quello che si era appena finito di
leggere. **La rosa non è una classifica, è un diario.**

⚠ **La strada ovvia era sbagliata e costosa.** «Serve un `assignedAt` nello snapshot» porta a toccare
`serializeSnapshot`, cioè il punto più delicato dell'app, **per niente**: `loadAuctionState` legge già
le assegnazioni per `created_at, id` e `serializeMembers` non riordina, quindi `member.roster` **era
già** in ordine di estrazione e i due `.sort((a, b) => b.price - a.price)` del client lo stavano
disfacendo. Si sono tolti, e non è stato aggiunto niente.

⚠ **Il `createdAt` è quello del motore, non un `defaultNow()`**: `persistAuctionState` scrive
`toDate(a.createdAt)`. È ciò che rende l'ordine giusto anche nei dati del seed — con un `now()` del
database, che in Postgres è per transazione e non per statement, tutte le assegnazioni scritte nella
stessa transazione avrebbero condiviso il timestamp e in locale l'ordine dentro un reparto sarebbe
stato arbitrario, cioè un finto bug da inseguire. **Verificato sui dati del seed**: i quattro
difensori da 1 credito di un membro hanno timestamp distinti.

**Il perché è scritto in un posto solo, e non è nei due consumatori**: sta in `serializeMembers`, cioè
dove la garanzia è prodotta e dove guarderebbe chi un giorno pensasse di riordinare lì — con l'avviso
che da M18 un `.sort()` aggiunto in quel punto cambia **tre** schermate. Due test nuovi in
`tests/db/snapshot.test.ts` la dichiarano, con **la seconda assegnazione più costosa della prima**,
che è l'unico modo di distinguere «ordine di estrazione» da «ordine per prezzo».

Tre conseguenze da sapere in anticipo. **In TV il giocatore appena vinto è sempre l'ultima riga piena
del suo gruppo**, cioè un posto fisso, mentre prima l'evidenziazione compariva dove il prezzo la
mandava. **Una riassegnazione va in fondo** (`voidAssignment` + `manualAssign` creano una riga nuova,
col `createdAt` della correzione) e non è un difetto: la rosa dice quando le cose sono state decise.
**Il verbale delle rose (M3) non è stato toccato**: non ordinava per prezzo, quindi era già cronologico
— dopo M18 sono le viste ad allinearsi a lui, non il contrario.

### ⚠ Un flake preesistente chiuso dentro la macro, e la misura che non era aggiustabile

`tests/db/delete-auction.test.ts` asseriva sul **contenuto** di `listone_players` e `player_insights`
per provare che la cascata di M12 non porta via le tabelle globali. Sono tabelle possedute da altri
due file di test — `listone.test.ts` scrive la regola del progetto: «una tabella globale, un file che
la possiede» — e quel file le svuota con un `DELETE` senza `WHERE`, perché è ciò che fa `uploadListone`
in produzione.

M14 aveva già corretto quella misura una volta, da `toBe(length)` a **contenimento**: regge le righe
*aggiunte* da un altro worker, non quelle *togliesse*. Il rosso che ne esce è `expected [] to deeply
equal ArrayContaining{…}`. **Riprodotto e misurato prima di toccarlo**: due rossi su sei giri con M18
addosso, **zero su cinque sulla baseline `origin/dev`** girata in un worktree — le due db-test nuove di
M18-02 non c'entrano col listone, cambiano solo l'ordine dei lavori. È la stessa dinamica con cui il
rosso era comparso lavorando a M14.

⚠ **Non era aggiustabile una terza volta come misura**: nessuna riga-sentinella scritta da quel file
sopravvive a un `DELETE` senza `WHERE` fatto altrove, e serializzare i file di test era già stato
scartato (costa secondi a ogni `pnpm test` e lascia la trappola aperta al terzo file). La domanda vera
— «la cancellazione di un'asta può portarsi via il listone?» — **non è una domanda sui dati, è una
domanda sullo schema**: una cascata viaggia sulle foreign key, e quelle tre tabelle non ne hanno
nessuna. L'asserzione è ora su `information_schema`, è più forte di quella empirica (vale per qualunque
punto di partenza, anche per un ramo aggiunto domani sotto `auctions`) e non ha corse dentro. La
chiamata a `deleteAuction` resta, con la verifica che l'asta è sparita per davvero. **Otto giri di
suite verdi.**

### ⚠ La verifica visiva del «prima» non è stata fatta, e va saputo

M18-01 chiedeva di guardare la rosa nei tre posti — portale su portatile, portale sul telefono, TV —
**prima** di cambiarla, perché dopo quel termine di paragone non esiste più. L'owner ha deciso di
procedere senza (2026-08-22). Il paragone che resta è quello **misurato dal database** ed è annotato in
`docs/features/18-rosa-a-fisarmonica.md`, task M18-01: la rosa di un membro con Vojvoda a 19 — quarto
preso — in cima ai difensori, e le quote attese `P 5% · D 13% · C 6% · A 0%`. Non è la stessa cosa di
uno sguardo, e se una scelta di misura o di spaziatura si rivelasse sbagliata, questa è la ragione per
cui non se ne è accorto nessuno prima.

## 2026-08-23 — La card di stato si stringe, e si prende il comando della pausa

### L'altezza della card di stato è un requisito, non una conseguenza

`StatusCard` prendeva ~125px ad asta in corso e ~195px in pausa: un occhiello, un titolo da 18px, una
lista di definizioni a due righe e un paragrafo da tre. Ogni pixel lì è un pixel che la card delle
offerte non ha — ed è quella la ragione per cui si tiene il telefono in mano. Da qui la card è **alta
due righe**: fase e stato sulla prima, ruolo e turno sulla seconda come badge in linea. Le quattro
informazioni di M17 §5 ci sono ancora tutte.

⚠ **Le tre cose tolte non sono tre economie uguali.** L'**occhiello «Asta»** era l'unica scritta
identica in tutti gli stati della card: l'unica che non distingueva mai niente. La **lista di
definizioni** etichettava due valori che si distinguono da sé — un ruolo e un nome squadra non si
confondono — e le sue etichette sono diventate `sr-only` invece di sparire, perché chi ascolta la
pagina non ha né la posizione né la forma e sentirebbe due nomi propri di fila. Il **paragrafo della
pausa** è passato da tre righe a una perché accanto è comparso «Riprendi»: chi legge ha il rimedio
sotto il pollice e non gli serve sapere chi ha fermato l'asta, gli serve sapere che alla ripresa il
tempo riparte da dov'era.

### Pausa e ripresa anche nel portale, e la Regia resta la casa dei comandi

Chi conduce l'asta e ci gioca dentro doveva uscire dal portale e andare in Regia per fermarla: lasciare
la pagina delle offerte nell'istante in cui serve sospenderle. Da qui «Pausa» e «Riprendi» stanno anche
sulla card di stato del portale, per il solo owner.

⚠ **Non è uno spostamento e non è una duplicazione della Regia**: nel portale arrivano le **due sole**
leve che servono *mentre* si sta guardando quella pagina. Avvio, override, «Annulla lotto» e «Mostra
risultati» restano dove sono — sono la risposta a «un attimo, c'è un problema», e quella si dà davanti
al pannello, non col telefono in mano. Chi conduce senza giocare non è toccato: non è membro, non ha un
portale (⚠ P11), la Regia è già il suo posto.

Le condizioni sono quelle di **`managerControls`**, la stessa funzione pura della Regia, e non due
confronti riscritti nel componente: è ciò che impedisce ai due pulsanti di divergere, e i test di quella
funzione li coprono già entrambi. `viewerIsOwner` arriva come prop e non dallo snapshot — nasce col link
e non è stato di gioco, come per «Prosegui asta». **Il permesso non viene da nessuno dei due**:
`pauseAuction` e `resumeAuction` verificano da sé la proprietà dell'asta, quindi quel booleano decide
cosa si vede, non cosa si può fare (regola 6).

⚠ **Un tocco solo, nessuna conferma**, scelto dall'owner contro la proposta di una conferma in due
tocchi: il pulsante finisce a un centimetro da «Offri», sotto un countdown di trenta secondi, ma una
pausa messa per sbaglio si annulla con «Riprendi» — e quando serve fermare l'asta davvero, serve subito.
Nessun messaggio né in caso di successo né in caso di rifiuto, come per `skipReveal` e `showResults`: la
conferma è lo snapshot che cambia il badge, e una riga di feedback costerebbe l'altezza che questo giro
sta togliendo. Il pending è **separato** da quello delle altre due azioni owner e non è un'astrazione
condivisa (regola 8): «Prosegui asta» e «Pausa» possono stare a schermo insieme, e disabilitarsi a
vicenda sarebbe un bug.

## 2026-08-23 — Il deploy partiva a ogni push, e compilava sempre `main`

Due rilasci di fila — `v1.19.0` e `v1.19.1` — sono stati **deployati con successo alla versione
precedente**: Ploi segnalava «completato», il server era coerente con sé stesso, e in produzione
rispondeva il codice di prima. La causa non era il webhook «che non parte», che è stata la prima
diagnosi e era sbagliata.

**Il meccanismo.** Sul repository c'era un webhook aggiunto **a mano** il 2026-08-09, che puntava
all'endpoint di deploy generico di Ploi (`/deploy?token=…&direct=true`) con `events: ["push"]`. GitHub
non offre filtri per branch sui webhook, e quell'endpoint non guarda il `ref`: **ogni push, su
qualunque branch, faceva partire un deploy** — e `deploy/deploy.sh` compila sempre `main`
(`BRANCH="${DEPLOY_BRANCH:-main}"`). Il rito del progetto pusha `dev` pochi istanti prima di `main`,
quindi il deploy faceva `git fetch origin main` quando `main` era ancora quello vecchio.

⚠ **La finestra è di 4-6 secondi**, misurata tre volte: è il tempo fra il push e il `git fetch` sul
server. Nelle release precedenti i due push distavano **mezzo secondo** e il fetch pescava per caso il
`main` giusto; il 2026-08-23 fra i due sono passati 16 e 17 secondi — merge, controllo di ancestry e
tag in mezzo — e la finestra si è aperta. **Non era un guasto nuovo: era una protezione accidentale,
persa cambiando il ritmo dei comandi.** E il push su `main` arrivava mentre il deploy stava girando,
senza produrne un secondo.

**Le prove che lo dimostrano**, e che valgono come metodo la prossima volta: il `mtime` di
`.git/FETCH_HEAD` sul server (l'ora esatta dell'ultimo fetch), il reflog locale di `origin/dev` e
`origin/main` (`git reflog show --date=iso refs/remotes/origin/main`, l'ora esatta dei push) e le
*Recent Deliveries* del webhook su GitHub. Incrociati, datano ogni evento al secondo.

⚠ **`direct=true` non era la spiegazione.** Togliendolo il deploy partiva ancora da un push su `dev`:
verificato con un test da novanta secondi. La spiegazione vera è che il webhook era manuale, e Ploi non
poteva crearne uno proprio — il suo token OAuth non aveva accesso ai repository
dell'organizzazione, e GitHub rispondeva `Not Found` alla creazione dell'hook (risponde `404` e non
`403` su ciò che non puoi amministrare). Ricollegato GitHub in Ploi con il grant sull'organizzazione, e
cancellato l'hook manuale — che con la sua sola presenza faceva fallire Quick deploy per
`Hook already exists` — Ploi ha creato il proprio.

**La regola che resta, indipendente da tutto il resto**: `git push origin main --tags` **prima** di
`git push origin dev`. È in CLAUDE.md insieme al comando che legge la versione servita, perché la
seconda lezione della giornata è che **un `HTTP 200` non è una verifica di deploy**: l'app vecchia
risponde 200 identica, e su quel 200 è stato detto «è andata» quando non era andata.

**Verificato in entrambe le direzioni**, e non solo nella metà comoda: con l'hook creato da Ploi, un
push su `dev` riceve **`422`** e il server non fa nemmeno il `fetch` (`FETCH_HEAD` e
`pm2 created at` invariati al secondo); un push su `main` riceve **`200`** e il deploy parte, con il
`fetch` 5 secondi dopo e `HEAD` sul commit giusto. La seconda metà non è una formalità: un hook che
avesse rifiutato *anche* `main` avrebbe ucciso il deploy automatico in silenzio, che è esattamente il
genere di guasto di cui parla tutta questa nota.

⚠ **Quello che distingue i due hook è il token, non il parametro `direct=true`.** Togliere quel
parametro dall'hook manuale non cambiava niente — provato — perché il token era già quello del deploy
diretto. Il token che Ploi si crea da sé è di tipo quick deploy e ispeziona il payload. Chi in futuro
dovesse ricreare un webhook a mano da Ploi reintrodurrebbe il guasto senza accorgersene: **il webhook
di questo repository lo deve creare Ploi**, e per farlo il suo token OAuth ha bisogno del grant
sull'organizzazione.

### Il deploy esce subito quando non c'è niente da fare

Aggiunta in coda al `git fetch` di `deploy/deploy.sh`: se `HEAD` è già uguale a `origin/main`, il
deploy **esce in un secondo** senza compilare né ricaricare.

Sembra un'ottimizzazione e invece è **la seconda difesa** contro il guasto qui sopra. Un deploy inutile
durava due minuti e mezzo, e in quei due minuti e mezzo il push su `main` che arrivava pochi secondi
dopo non produceva un secondo deploy: la finestra era occupata. Un deploy che esce subito non la occupa,
e il push su `main` trova la strada libera. Il webhook è stato corretto e oggi filtra il branch, quindi
questa riga non serve *adesso*: serve il giorno che qualcuno rimette un hook manuale — cosa già accaduta
una volta, il 2026-08-09, e passata inosservata per due settimane.

⚠ **Confrontare i commit non basta, e la seconda condizione è la parte che conta.** Se una build
precedente muore a metà, `HEAD` è già quello giusto e il codice in esecuzione no: un'uscita anticipata
lascerebbe la produzione indietro stampando «tutto a posto», che è esattamente il guasto silenzioso da
cui nasce tutta questa nota. Quindi si esce solo se `.next/BUILD_ID` è **più recente del commit**; se
manca o è più vecchio si ricompila, dicendolo. **Nel dubbio si lavora, non si salta** — ed è anche il
motivo per cui uno scarto di orologio fra chi committa e il server è innocuo: sposta la decisione verso
il ricompilare.

Il prezzo è una scomodità, ed è documentata in CLAUDE.md accanto al comando: per rideployare la stessa
versione serve `DEPLOY_FORCE=1 ./deploy/deploy.sh`. Senza quella variabile il recupero a mano — quello
usato il 2026-08-23 per rimettere in produzione la `v1.19.1` — direbbe «niente di nuovo» e non farebbe
niente.
