# M4 — Simulazione in-app

> **Stato:** in corso · **Aperta il** 2026-08-10
> **Tocca lo schema del database?** **Sì, in modo puramente additivo.** Tre colonne nuove con
> default e un `CHECK`: `users.is_bot`, `auctions.is_simulated`, `members.bot_strategy`. Nessuna
> colonna sparisce, nessun tipo cambia — quindi **niente `pg_dump` preventivo**, ma `pnpm db:push`
> sul server **va dato a mano dopo il deploy**, come da «Regole operative di produzione»:
>
> ```bash
> cd ~/asta && pnpm db:push
> pm2 reload deploy/ecosystem.config.cjs --update-env
> ```
>
> **Invarianti coinvolti:** **I8** — è il punto delicato, e §4 esiste solo per lui. I1, I5, I10.
> Regole 1, 2, 3, 4, 6, 7 e 8.

## Obiettivo

Provare le dinamiche dell'asta oggi richiede tre terminali e un pezzo di conoscenza che non sta in
nessuna interfaccia: un `docker compose up`, un `pnpm db:seed --auction-status=ready`, l'id
dell'asta copiato da una riga di output, un `pnpm bots --auction=… --count=7`. Funziona, ed è
esattamente ciò che ha permesso di collaudare tutto fin qui — ma è una procedura, e una procedura è
qualcosa che si sbaglia quando serve in fretta.

Questa macro la sposta **dentro l'applicazione**: si crea un'asta simulata come si crea un'asta
vera, le si dice «riempi i posti liberi con i bot», e si gioca. Nessun terminale, nessun id da
copiare, e — soprattutto — nessuna asimmetria fra quello che provi e quello che succederà la sera
dell'asta, perché i bot passano dalle stesse funzioni da cui passa un telefono.

C'è un secondo obiettivo, più silenzioso ma non minore: oggi i bot esistono in **due copie con due
cervelli diversi**. `scripts/bots.ts` decide guardando lo snapshot redatto — è cieco sulle buste
altrui, come un telefono. `scripts/drive.ts` decide guardando `AuctionState` grezzo, cioè vede
tutte le offerte di tutti. Finché giocano fra loro è indifferente; **nel momento in cui giochi tu
contro di loro, un bot onnisciente è un bot che ti batte sempre di uno**. Questa macro riduce i
cervelli a uno, e quello che resta è il cieco.

## Richieste che ci confluiscono

Tolta da `docs/REQUESTS.md` il 2026-08-10 — era l'unica rimasta nel quaderno.

- **Testing avanzato.** «Vorrei avere una sezione dove posso lanciare una simulazione di asta. […]
  il giocatore che crea l'asta simulata partecipa, gli altri X sono bot. […] In questo modo ho
  sempre la possibilità di simulare tutte le dinamiche senza dover fare azioni lato server per
  lanciare seed e simulare aste.» Con l'alternativa: «una sezione sotto gli inviti dove l'admin può
  decidere di riempire l'asta con dei bot […] verrà poi assegnata solo ai super admin».

Le due strade erano **A** (un flusso di creazione dedicato all'asta simulata) e **B** (un pannello
che riempie di bot un'asta qualunque). In fase di spec si è scelto **il meccanismo di B con il
cancello di A**, e il perché è in `docs/DECISIONS.md`: A duplicherebbe il flusso di creazione che
esiste già — che è precisamente ciò che la richiesta chiede («configurare l'asta come se fosse
vera») — e B applicata a un'asta qualunque lascerebbe per sempre un pulsante «riempi di bot» a due
centimetri dagli inviti dell'asta vera. Il flag deciso alla creazione risolve entrambe.

---

## Spec

### 1. L'asta simulata

**`auctions.is_simulated` si scrive alla creazione e non cambia più.** Non è una preferenza di
prudenza: è ciò che rende *strutturalmente* impossibile che dei bot finiscano in un'asta vera. La
casella «Asta simulata» compare in `app/auctions/new` solo a un amministratore
dell'applicazione (§5); `createAuction` accetta il flag e lo rifiuta a chi non lo è (regola 6: la
casella non c'è, e il server rifiuta comunque). Non esiste nessuna via per accenderlo o spegnerlo
dopo — `updateAuctionSettings` non lo conosce.

Da lì in poi l'asta è **identica a una vera**: stesso listone da importare, stessi tempi, stessi
slot, stesso ordine dei ruoli, stessa lobby, stessa regia, stessa vista TV. Non c'è nessun ramo «se
simulata allora» dentro il motore, e non deve nascerne: la simulazione non è una modalità di gioco,
è un'asta con dei partecipanti che non hanno un telefono.

**Il badge `[simulazione]`** compare ovunque la si guardi: nella riga della dashboard, nella
intestazione comune di `app/auctions/[id]/layout.tsx` — che copre da sola configurazione, lobby,
regia, portale e storico — e nella vista TV. Deve essere impossibile confondersi avendo due schede
aperte.

### 2. Riempire di bot

Nella configurazione, **accanto al pannello degli inviti**, un pannello «Partecipanti simulati» che
esiste solo se `is_simulated` è vero e solo per l'owner amministratore. Chiede quanti bot
aggiungere — default: **tutti i posti liberi** — e con quale mix di strategie, più una scorciatoia
«tutti in pareggio» che li mette tutti su `tie`.

`fillWithBots(userId, auctionId, count, strategy)` sta in `lib/engine/setup.ts` e **riusa
`addMember`**, cioè la stessa funzione privata che serve `joinAuction` e `joinAsOwner`. È il criterio
del seed applicato qui: uno stato prodotto chiamando le funzioni dell'applicazione è, per
costruzione, uno stato che l'applicazione sa produrre. Vengono gratis il `seat_index` in ordine di
ingresso, il `budget_initial` copiato da `budget_default`, la validazione del nome squadra e il
`recomputeStatus` che porta l'asta a `READY` quando i posti sono pieni.

Rifiuta, con i codici tipizzati di sempre: chi non è owner, chi non è amministratore, un'asta non
simulata, un'asta che non è più in `DRAFT`/`READY`, e i posti esauriti (`AUCTION_FULL`, che
`addMember` restituisce già).

**I dodici bot sono un pool fisso**, non utenti usa-e-getta. `ensureBotUsers()` li crea se mancano e
non tocca quelli che ci sono: dodici righe in `users` con `is_bot = true`, `google_sub` nullo e un
nome riconoscibile. Dodici perché è il taglio massimo, e perché l'owner può condurre senza giocare
(⚠ P11) e allora i posti da riempire sono tutti. La chiama il primo riempimento e la chiama il
seed — se la chiamasse solo il seed, in produzione servirebbe un comando a mano, cioè esattamente
la cosa che questa macro esiste per togliere.

Lo stesso bot **può stare in più aste insieme**: `members_auction_user_unique` è su *(asta, utente)*,
quindi due simulazioni in parallelo non collidono. Il nome squadra è per-membro, quindi lo stesso
bot può chiamarsi diversamente in due aste.

Due conseguenze da non dimenticare, entrambe piccole e entrambe fastidiose se saltate:
`listDevUsers()` **esclude** i bot (altrimenti la pagina di login in sviluppo si riempie di dodici
pulsanti «Entra come Bot 7»), e l'`authorize` del provider `dev` li **rifiuta** — non perché
sarebbe pericoloso impersonarli, ma perché una lista di identità di comodo che si sporca da sola
smette di essere utile.

### 3. Il cervello dei bot — una funzione pura, due trasporti

`lib/engine/bot-brain.ts`, **nuovo, puro, zero dipendenze**:

```ts
decide(snapshot: Snapshot, memberId: string, strategy: BotStrategy, now: Millis): BotMove | null
```

Nessun database, nessun `Date.now()` dentro — il tempo è un parametro, per la stessa ragione della
regola 2 — e quindi collaudabile con Vitest senza Postgres. Restituisce l'azione da fare (`PICK` o
`BID`) o `null`, che significa «adesso no».

**Il ritardo dentro un round non è uno stato: è derivato.** Un bot non deve offrire nell'istante in
cui il lotto si apre, o l'asta simulata diventa una lista di risultati invece di una dinamica che
puoi guardare mentre offri dal telefono. Il ritardo si ricava da `memberId + lotId + roundNo` come
frazione dei secondi del round: stessa asta e stesso round danno sempre lo stesso ritardo, **anche
dopo un riavvio del processo**, che azzererebbe qualunque memoria. E «ho già offerto in questo
round?» non è uno stato del bot: glielo dice il suo snapshot (`myBid`). Zero memoria di processo,
tutto ricalcolabile, tutto testabile.

Le strategie restano le quattro di oggi — `random`, `aggressive`, `passive`, `tie` — e vivono in
`members.bot_strategy`, non sull'utente-bot. Se la strategia stesse sull'utente («Bot 3 è sempre
aggressivo») le identità sarebbero più riconoscibili, ma si perderebbe l'asta tutta-in-pareggio, che
è **l'unico modo di innescare lo spareggio a comando** — a mano è quasi impossibile da riprodurre, e
vale più della riconoscibilità.

Sopra il cervello stanno due trasporti:

| Trasporto | Chi | Perché resta |
|---|---|---|
| **In-process** | il tick di §4 | è la macro |
| **HTTP** | `scripts/bots.ts`, riscritto sopra `decide` | è l'unica cosa che collauda l'applicazione **da fuori**: sessione, rotta, SSE, nginx. La simulazione in-app non tocca nessuno di quei quattro pezzi, e il giorno in cui si rompe il buffering SSE dietro nginx è quello script a dirlo |

**`scripts/drive.ts` viene ritirato.** Fa una cosa che la simulazione fa meglio — dodici bot,
nessun umano, un'asta fino a `COMPLETED` — con in più una UI da guardare, e senza il suo scheduler
parallelo, che è una delle trappole documentate in `CLAUDE.md` («due processi dell'app sullo stesso
database»). Spariscono il file, il comando in `package.json` e le righe in `HOWTO-PROVA-LOCALE.md`.

### 4. Il tick — chi fa muovere i bot, e come rispetta le regole

È la domanda vera di questa macro, e la risposta è: **un `setInterval` da un secondo dentro il
processo dell'applicazione**, registrato in `instrumentation.ts` sotto la sua guardia `globalThis`
— la stessa forma dello sweep dello scheduler, e per la stessa ragione (`CLAUDE.md`: ogni singleton
di processo va su `globalThis`, non in una variabile di modulo).

**Perché in-process, quando `scripts/bots.ts` è nato apposta per *non* esserlo.** Il commento in
testa a `app/api/auctions/[id]/action/route.ts` lo spiega: dei bot che chiamassero il motore nel
*proprio* processo scriverebbero senza che il server se ne accorga, e nessun browser vedrebbe
muoversi niente. Ma quel «proprio processo» è lo script. Codice che gira **dentro** il server Next
ha già `setBroadcastHook(scheduleSnapshot)` impostato da `instrumentation.ts`: scrive nel processo
giusto, e l'SSE parte da solo. L'obiezione storica cade esattamente nel caso che ci serve.

**Perché un intervallo separato e non lo sweep.** Lo sweep chiude i round, ed è sequenziale
(`for … await`). Mettendoci dentro le mosse dei bot, una simulazione con undici bot che scrivono
sotto lock **ritarderebbe la chiusura di un round dell'asta vera** che gira accanto sulla stessa
macchina. Sono due lavori con priorità diverse: restano due cicli.

**Non è un servizio di scheduling, né un worker, né una coda.** È un `setInterval` nello stesso
unico processo Node. `exec_mode: "fork"` e `instances: 1` restano la ragione per cui questo è
sicuro, ed è lo stesso motivo per cui lo è già lo sweep.

Un giro del tick:

1. **Stand-down.** Se esiste un'asta **non simulata** in `LIVE` o `PAUSED`, il tick non fa niente e
   esce. È il gemello a runtime della regola che il deploy applica già (`deploy.sh` si rifiuta di
   partire con un'asta in corso): durante l'asta vera nessuno può, nemmeno volendo, mettere undici
   bot a scrivere sotto lock accanto ai dodici telefoni. Il costo è che una simulazione dimenticata
   accesa **si congela**, e per questo la pagina lo dichiara — «bot in pausa: è in corso un'asta
   reale» — altrimenti fra tre mesi sembrerà un bug e ci si passerà una serata.
2. Per ogni asta simulata in `READY` o `LIVE`, **l'heartbeat dei bot**. Fuori dal lock, come vuole
   ⚠ P8: è telemetria, non stato di gioco. Serve perché il cancello di avvio pretende tutti i membri
   `LIVE`, e i bot devono superarlo come lo supererebbe un telefono acceso — non con una deroga.
3. Per ogni asta simulata **in `LIVE`**, per ogni membro bot, uno alla volta: si costruisce il
   **suo** snapshot con `serializeSnapshot(state, suoMemberId)` e lo si dà a `decide`. Se decide di
   agire, si chiama `pickPlayer(botUserId, …)` o `placeBid(botUserId, …)` — le stesse funzioni di
   `lib/engine/actions.ts` che chiama la rotta HTTP.

E le regole:

- **Regola 1 — mai un timer che decide.** I bot non chiudono niente: offrono e chiamano, come un
  partecipante. A chiudere un round resta soltanto lo scheduler.
- **Regola 6 — nessuna via privilegiata.** Il bot entra da `lib/engine/actions.ts`, mai da
  `persistTransition` e mai da una query sua. Rispetto a un telefono salta **solo** la sessione, che
  è ciò che distingue «sono il server» da «sono un browser»: tutte le regole del gioco stanno nel
  motore, e la rotta HTTP è uno strato sottile che traduce il JSON e null'altro.
- **Regola 4 — il lock.** Ogni mossa passa da `withAuctionLock` perché ci passano le azioni. Il tick
  non muta niente da sé.
- **I8 — e qui la tentazione era massima.** Il cervello riceve un `Snapshot`, cioè l'uscita di
  `serializeSnapshot` costruita con il `memberId` **del bot**: le buste altrui non ci sono, e non
  c'è modo di aggirarlo perché la firma di `decide` non accetta nient'altro. Un bot che vedesse
  `AuctionState` batterebbe sempre l'umano di uno — è la ragione per cui `drive.ts` non poteva
  diventare il modello. Nella simulazione **giochi cieco contro dei ciechi**, che è il punto.
- **Regola 3 — nessuna serializzazione fuori da `serializeSnapshot`.** Il tick la *usa*, non la
  aggira: `Snapshot` non guadagna campi, lo stream non trasporta niente di nuovo.

Il tick **è acceso sempre**, anche quando non c'è nessuna simulazione: è una `SELECT` al secondo che
non trova nulla, e in cambio non esiste nessuno stato «il loop si è dimenticato di ripartire dopo un
riavvio» — lo stesso motivo per cui lo sweep non si spegne mai. Un giro non parte se il precedente
non è finito.

### 5. L'amministratore dell'applicazione

`users.is_admin` esiste nello schema dall'inizio del progetto e non è mai stato letto da nessuna
riga di codice. Questa macro gli dà il primo significato.

**È un permesso su una persona, non un tipo di utente.** Un amministratore gioca le aste come tutti
gli altri: per questo restano due booleani indipendenti — `is_admin` e `is_bot` — e non un'unica
colonna a tre valori, che avrebbe modellato «amministratore» come se fosse una specie. L'unica
combinazione che i due booleani permettono e che non deve esistere è `is_admin AND is_bot`, e la
vieta un `CHECK` a database: è la stessa logica degli indici parziali di I1 e I2 — se una regola si
può rendere impossibile invece che sorvegliata, si rende impossibile.

⚠ **Non è l'owner dell'asta.** «Owner» in questo progetto è già chi possiede *un'asta*, e i due non
c'entrano niente: l'owner conduce la sua asta, l'amministratore ha funzioni in più
sull'applicazione. Nei documenti e nel codice si scrive **«amministratore dell'applicazione»** per
esteso quando c'è rischio di confusione.

**In M4 può fare una cosa sola**: creare aste simulate e riempirle di bot. Non è una dimenticanza,
è il perimetro — più avanti verrà definito cosa altro può fare (il quaderno parla di «super admin»,
e quella resta una parola in `REQUESTS.md` finché non diventa una macro).

Il nome vive in `lib/domain.ts` (`isAppAdmin`), non nello schema: è la regola in testa a quel file,
e serve perché le pagine non importino `lib/db` per sapere chi possono mostrare. Ci si diventa con
un `UPDATE` a mano sul server, una volta:

```sql
UPDATE users SET is_admin = true WHERE email = '…';
```

Non c'è una UI per nominare amministratori, e non deve esserci finché gli amministratori sono uno.

### 6. Eliminare un'asta

Oggi **un'asta non si può cancellare**: non esiste nessuna funzione che lo faccia, e non è mai
servito. Con delle aste di prova che nascono a ogni sessione di lavoro serve, e l'owner ha chiesto
che valga per **qualunque** asta, non solo per le simulate.

`deleteAuction(userId, auctionId)` in `lib/engine/setup.ts`. Solo l'owner dell'asta. **Rifiutata su
un'asta `LIVE` o `PAUSED`**: la pausa congela la fase, non azzera l'asta, e non si cancella qualcosa
mentre dodici persone ci stanno dentro. Un `DELETE` sulla riga di `auctions` porta via tutto il
resto da sé: ogni tabella ha `onDelete: "cascade"` su `auction_id`, `events` compresa.

**La regola 5 non è in discussione.** Vieta il `DELETE` su `assignments` e `ledger` *dentro* un'asta,
perché in un'asta viva un fatto accaduto non si riscrive a mano — si annulla con `voided_at`.
Buttare via un'intera partita è un atto diverso e dichiarato.

**La conferma non è un `confirm()`**, che si clicca per riflesso: **si scrive il nome dell'asta** per
sbloccare il pulsante. Chi sta cancellando la cosa sbagliata si accorge di stare scrivendo il nome
sbagliato. Il pannello sta in fondo alla configurazione, staccato dal resto e nominato per quello
che è.

⚠ **Va detto ad alta voce**: cancellare un'asta reale completata porta via il verbale delle rose e
lo storico che M3 ha costruito, senza lasciare traccia. L'unica cosa che sopravvive è una riga su
stdout — quella che si rilegge con `pm2 logs` — perché `events` se ne va con l'asta.

### 7. Cosa non cambia

Il motore, la macchina a stati, lo snapshot, le rotte di gioco, i timer. Nessuna transizione nuova,
nessun ramo «se simulata» dentro `machine.ts` o `rules.ts`, nessun campo nuovo nello stream.
`serializeSnapshot` non si tocca. Le schermate restano funzione pura dello snapshot corrente
(regola 7, I10) e il portale resta mobile-first.

### 8. Cosa non entra (regola 8)

Niente livelli di amministrazione (i «super admin» restano una parola nel quaderno) · niente UI per
nominare amministratori · niente strategie nuove oltre le quattro · niente acceleratore di
simulazione né «salta al lotto successivo»: i tempi si configurano già alla creazione, e un
acceleratore vorrebbe un secondo orologio accanto a quello che c'è · nessuna astrazione di
«partecipante» che unifichi umani e bot: un bot è un membro, e la sola differenza è chi decide le
sue mosse.

---

## Task

- [x] **M4-01** — Aprire `feature/04-simulazione` da `dev`; scrivere questo file, togliere
      «Testing avanzato» da `docs/REQUESTS.md`, aggiornare `docs/features/README.md`
- [x] **M4-02** — Schema: `users.is_bot`, `auctions.is_simulated`, `members.bot_strategy`, il
      `CHECK` che vieta `is_admin AND is_bot`; `pnpm db:push` in locale
- [x] **M4-03** — `lib/domain.ts`: `isAppAdmin()`, `BOT_STRATEGIES` con le etichette italiane, e il
      testo del badge. Nessuna dipendenza, come i suoi gemelli
- [x] **M4-04** — `ensureBotUsers()` idempotente; `listDevUsers()` esclude i bot; l'`authorize` del
      provider `dev` li rifiuta; il seed chiama `ensureBotUsers()`
- [x] **M4-05** — `createAuction` accetta `isSimulated` e lo rifiuta a chi non è amministratore;
      la casella nel form di creazione, visibile solo a lui
- [x] **M4-06** — `fillWithBots()` in `lib/engine/setup.ts` sopra `addMember`, con i cinque rifiuti
      tipizzati di §2
- [x] **M4-07** — `lib/engine/bot-brain.ts`: `decide()` puro, il ritardo derivato, le quattro
      strategie
- [x] **M4-08** — `lib/engine/bots.ts`: il giro del tick — stand-down, heartbeat, mosse via
      `lib/engine/actions.ts`, snapshot costruito col memberId del bot
- [x] **M4-09** — `instrumentation.ts`: il secondo intervallo sotto la sua guardia `globalThis`,
      dentro il ramo `nodejs` e con gli import dinamici lì dentro
- [x] **M4-10** — `scripts/bots.ts` riscritto sopra `decide()`; `scripts/drive.ts` rimosso con il
      suo comando in `package.json`
- [x] **M4-11** — UI: il pannello «Partecipanti simulati» accanto agli inviti; il badge
      `[simulazione]` in dashboard, nel layout dell'asta e nella vista TV; l'avviso «bot in pausa:
      è in corso un'asta reale»
- [x] **M4-12** — `deleteAuction()` e il pannello in fondo alla configurazione, con il nome da
      digitare e la riga su stdout
- [x] **M4-13** — Test puri: `bot-brain` (non ri-offre se ha già `myBid`, rispetta `minAmount` e
      `maxBid`, `tie` converge, il ritardo è deterministico e stabile fra due processi), `domain`
      esteso
- [x] **M4-14** — Test con Postgres: `fillWithBots` (i cinque rifiuti), il tick (**sta fermo con
      un'asta reale in corso**; il bot riceve uno snapshot costruito col **proprio** memberId),
      `deleteAuction` (rifiuta `LIVE`/`PAUSED`, rifiuta chi non è owner, il cascade porta via
      tutto), il `CHECK` `is_admin AND is_bot`
- [x] **M4-15** — Gate: `pnpm test`, `pnpm typecheck`, `pnpm build` verdi
- [x] **M4-16** — `docs/ARCHITECTURE.md`: il capitolo sulla simulazione, e la **correzione della
      riga che dice ancora che i bot si autenticano col provider `dev`** (non è più vero da quando
      si firmano il JWT da sé); `docs/DECISIONS.md`: il tick separato, i due booleani, lo
      stand-down, A+B; `docs/HOWTO-PROVA-LOCALE.md` riscritto attorno alla simulazione, senza
      `drive`
- [ ] **M4-17** — Chiusura: merge `--no-ff` su `dev`, prova in locale, poi — **solo su richiesta
      dell'owner** — `CHANGELOG.md`, `package.json` a `1.5.0`, merge `--no-ff` su `main`, tag
      `v1.5.0`, push, e **`pnpm db:push` a mano sul server** a deploy finito

## Verifica

1. `pnpm test`, `pnpm typecheck` e `pnpm build` verdi.
2. **Un utente non amministratore non vede la casella «Asta simulata»**, e la creazione con il flag
   forzato a mano viene rifiutata dal server (regola 6).
3. **Un'asta non simulata non ha il pannello dei bot**, e `fillWithBots` su di lei viene rifiutata.
4. **Un'asta simulata a 8 con 7 bot arriva a `COMPLETED`** partendo dalla sola interfaccia: nessun
   terminale, nessun id copiato a mano.
5. **I8 a video**: mentre un lotto è aperto, il portale non mostra gli importi altrui — e i bot non
   li vedono a loro volta, cioè non convergono sistematicamente a uno sopra la tua offerta.
6. **Lo spareggio a comando**: tutti i bot su `tie` producono un pareggio e un round 2.
7. **Lo stand-down**: con un'asta reale `LIVE` o `PAUSED`, i bot di una simulazione accesa **stanno
   fermi**, e la pagina dice perché. Ripresa l'asta reale a `COMPLETED`, ripartono.
8. **Due simulazioni in parallelo** con gli stessi bot non collidono.
9. **`pnpm bots --auction=…` continua a funzionare** contro un'asta simulata: stesso cervello,
   trasporto diverso.
10. **La cancellazione**: rifiutata su un'asta `LIVE` o `PAUSED`; con il nome digitato porta via
    l'asta e tutto ciò che le appartiene; il pulsante non è raggiungibile da chi non è owner.
11. **Dal telefono** (`pnpm dev:lan`): si gioca contro i bot dal portale, e il badge
    `[simulazione]` si vede senza cercarlo.
