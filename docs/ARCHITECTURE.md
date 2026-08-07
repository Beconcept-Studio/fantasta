# ARCHITECTURE — come funziona questa applicazione

Questo documento è scritto per chi apre il repository fra sei mesi e vuole capire il proprio
progetto senza rileggere il codice. Racconta **cosa fa ogni pezzo, come si parlano e perché è
stato fatto così**. La specifica di riferimento resta `docs/PLAN.md`; qui si spiega la
realizzazione. Cresce di un capitolo a ogni fase.

---

## Il problema, in una riga

Dieci persone in una stanza fanno un'asta di Fantacalcio a busta chiusa. Ognuno offre dal proprio
telefono, un portale è proiettato sulla TV, e la serata dura qualche ora. Non serve scalare:
serve che nessuno veda l'offerta di un altro prima del momento giusto, che nessun giocatore
finisca a due squadre, e che se un telefono perde la rete per venti secondi il suo proprietario
rientri e trovi l'asta dove l'ha lasciata.

Tutte le scelte che seguono discendono da lì.

---

## Perché un solo processo Node

L'applicazione è un singolo processo Next.js in ascolto su una singola macchina, con Postgres
sulla stessa macchina. Non c'è Redis, non c'è una coda, non c'è un worker separato, non c'è un
provider realtime esterno. Non è una rinuncia: è la scelta che rende semplice tutto il resto.

Un'asta è fatta di **scadenze** — trenta secondi per chiamare un giocatore, trenta per offrire,
dieci per lo spareggio. Chi decide che il tempo è scaduto? Se la risposta fosse "il browser del
partecipante", basterebbe un orologio sfasato o una scheda in background per avere due client che
credono di essere in momenti diversi dell'asta. Quindi decide il server, e per decidere deve
esistere in modo continuo: un `setTimeout` in memoria che sopravvive fra una richiesta e l'altra.
Su un'architettura serverless questo non esiste, e infatti l'app è configurata con
`output: 'standalone'` (in `next.config.ts`) proprio per girare come processo persistente.

Lo stesso processo persistente è ciò che permette il realtime senza dipendenze: la connessione SSE
di ogni client resta appesa a un `ReadableStream` tenuto in una `Map` in memoria. E la concorrenza
diventa gestibile perché tutte le mutazioni passano da un unico punto, sotto un lock di riga
Postgres, invece di essere sparse su N istanze che non si conoscono.

Alla fine della Fase 1 niente di tutto questo esiste ancora: esistono le fondamenta su cui
poggerà, più tutto ciò che serve *prima* che un'asta cominci.

---

## Com'è messo insieme il progetto

Le cartelle sono quattro, e la divisione ha un significato preciso.

`app/` è Next.js App Router: le pagine e i route handler. Qui si decide **cosa vede** l'utente.
Ogni pagina è un server component che legge lo stato e lo rende; le scritture passano da Server
Action dichiarate in file `actions.ts` accanto alla pagina che le usa.

`lib/` è la logica. `lib/db/` è lo schema Drizzle e la connessione; `lib/auth.ts`
l'autenticazione; `lib/engine/` è dove vive tutto ciò che tocca lo stato di un'asta — oggi il
setup, da Fase 2 il motore vero e proprio; `lib/import/` legge il file del listone; `lib/domain.ts`
contiene il vocabolario condiviso (i quattro ruoli, gli stati di un'asta, i tagli di partecipanti
ammessi).

Quel `lib/domain.ts` merita una riga di spiegazione, perché la sua esistenza è la conseguenza di
due vincoli che si sono incontrati. I nomi dei ruoli servono anche a un componente che gira nel
browser, ma stavano dentro `lib/db/schema.ts`; e importare `lib/db` da un componente è vietato per
regola di lint — giustamente, perché nessun linter sa distinguere «importo quattro stringhe» da
«apro una query». Per di più `schema.ts` si porta dietro l'ORM: farlo viaggiare fino al telefono
per quattro stringhe sarebbe stato uno spreco. Le costanti si sono spostate in un file che non
dipende da niente, e la regola di lint è rimasta assoluta.

`components/` sono i componenti riusabili, compresi quelli di shadcn/ui in `components/ui/`.

`scripts/` sono gli strumenti da riga di comando: il seed, il lancio in LAN, e più avanti i bot.
Non fanno parte dell'applicazione servita, ma sono ciò che rende collaudabile un'asta a otto senza
otto persone.

`tests/` sono i test Vitest.

### Una regola di lint invece di una code review

C'è un vincolo che vale la pena raccontare perché è la spina dorsale delle regole di correttezza:
**il database non si importa da dove non si deve**. `eslint.config.mjs` vieta l'import di
`lib/db` a tutto il progetto, con un elenco enumerato di eccezioni — il motore, il modulo di
autenticazione, gli script, i test.

La ragione è che due delle regole non negoziabili del progetto ("lo stato dell'asta esce dal
server solo da `serializeSnapshot`", "l'asta si muta solo dentro `withAuctionLock`") sono facili
da rispettare fino al giorno in cui qualcuno, per fare presto, scrive una query dentro un
componente. Quella scorciatoia non romperebbe niente in modo visibile: farebbe trapelare un
importo, o creerebbe una corsa fra due offerte simultanee, e lo si scoprirebbe in diretta. La
regola di lint la trasforma in un errore prima del commit. `pnpm lint` è stato verificato in
entrambe le direzioni: una query in `components/` fa fallire il lint, la stessa query in
`lib/engine/` passa.

---

## Il database

Postgres 16, in Docker in sviluppo (`docker-compose.yml`, porta **5433** sull'host perché la 5432
era occupata da un altro progetto), sulla macchina di produzione in Fase 8. Lo schema è descritto
in TypeScript con Drizzle in `lib/db/schema.ts`, e `pnpm db:push` lo riversa sul database.

Due dettagli che avranno importanza più avanti. Il primo: **tutti i timestamp sono `TIMESTAMPTZ`
e il server ragiona in UTC**; la conversione all'ora italiana avviene solo nel momento in cui si
disegna un orario a schermo. Il secondo: la connessione è un `Pool` unico, tenuto in cache su
`globalThis` in `lib/db/index.ts`. Non è pignoleria: in sviluppo l'hot reload rivaluta i moduli a
ogni salvataggio, e senza quella cache si accumulerebbe un pool di connessioni per ricompilazione
finché Postgres non rifiuta le connessioni. La stessa precauzione servirà, per la stessa ragione,
allo scheduler dei timer.

Dalla Fase 1 lo schema è completo: `users`, `auctions`, `members`, `invites`, `players`, `lots`,
`lot_rounds`, `round_eligibility`, `bids`, `assignments`, `ledger`, `events`. Le tabelle del gioco
esistono ma sono ancora vuote — le riempirà il motore in Fase 3 — e sono già lì perché due
invarianti dovevano diventare vincoli del database prima che qualcuno scrivesse la prima riga che
li potrebbe violare. Se ne parla nel capitolo che segue.

---

## L'autenticazione

Tutto sta in `lib/auth.ts`. Auth.js v5 con **strategy JWT**: la sessione è un cookie firmato, non
una riga a database, e quindi non esiste nessuna tabella di adapter.

La parte interessante è **cosa c'è dentro quel cookie: soltanto l'id interno dell'utente**. Non il
nome, non il flag di amministratore, niente altro. Ogni volta che una pagina ha bisogno di sapere
chi sta guardando, chiama `currentUser()`, che dal token estrae l'id e ricarica la riga dal
database. Costa una query per richiesta — con dodici utenti è irrilevante — e in cambio dà due
cose che valgono molto: lo stesso account aperto su due dispositivi vede sempre le stesse
informazioni, e una modifica al profilo ha effetto immediato senza dover rifare il login.

### Il primo accesso

Chi entra con Google non ha ancora un nome nell'applicazione. Questo è deliberato: il profilo
Google avrebbe un `name`, ma l'app **non lo copia**. Al primo login la riga `users` nasce con
`display_name` vuoto, e la guardia `requireUser()` — chiamata da ogni pagina autenticata — manda
l'utente su `/onboarding` e non lo lascia andare altrove finché non ha scritto nome e cognome. Il
nome Google serve solo a precompilare il campo, per risparmiargli la digitazione.

Perché non prendere semplicemente il nome da Google? Perché il requisito è che l'utente lo
*confermi*: in un gruppo di amici il profilo Google si chiama spesso "Ale" o "iPhone di Marco", e
sul tabellone proiettato in TV serve un nome riconoscibile. Il nome della **squadra** è un'altra
cosa ancora, si sceglie quando si entra in una specifica asta, e arriva in Fase 1.

Il controllo è una guardia server-side nelle pagine, non un middleware. Un middleware Next girerebbe
su runtime edge, dove il driver Postgres non esiste, e per farlo funzionare bisognerebbe spezzare
la configurazione di Auth.js in due file. La guardia nelle pagine ottiene lo stesso risultato
osservabile senza quella complicazione.

### Il secondo provider, quello che non deve esistere in produzione

Collaudare un'asta a otto partecipanti richiederebbe otto account Google veri. È impraticabile, e
un'app che non si può collaudare a otto è un'app che si collauderà per la prima volta la sera
dell'asta.

Per questo esiste un secondo modo di entrare: un provider `dev` che apre una sessione per un
utente già presente a database, senza passare da Google. La pagina di login, fuori produzione,
mostra un elenco di pulsanti "Entra come Marco Bianchi", "Entra come Luca Ferrari" — i dodici
utenti creati da `pnpm db:seed`. Un click, sessione pronta. Quattro finestre di browser, quattro
partecipanti.

Un provider che salta l'autenticazione è però esattamente il genere di cosa che non deve
sopravvivere a un deploy. Due difese. La prima: la lista dei provider si costruisce in funzione di
`NODE_ENV`, e in produzione quello `dev` non viene nemmeno costruito. La seconda: c'è un test
automatico che **interroga l'endpoint `/api/auth/providers` con `NODE_ENV=production`** e verifica
che la risposta contenga solo Google. Non ispeziona una variabile: chiede all'applicazione la
stessa lista che vedrebbe un client, e se il provider non è pubblicato lì non c'è modo di
invocarlo.

C'è anche un terzo argine, più discreto: il provider `dev` accetta solo utenti **senza**
`google_sub`, cioè solo quelli nati dal seed. Un account Google vero non è impersonabile nemmeno
in sviluppo.

---

## Il seed, e perché cresce insieme al progetto

`pnpm db:seed` è idempotente — si può rilanciare quante volte si vuole senza duplicare niente — e
crea i dodici utenti fittizi che alimentano il provider `dev`. Con
`pnpm db:seed --auction-status=ready` costruisce anche un'asta a otto con il listone importato e
tutti i posti pieni; con `draft` la stessa asta ma con un posto libero. Dalla Fase 3 sa generare
anche gli stati di un'asta già avviata — `live` (appena partita), `mid` (a metà, con le rose
parzialmente riempite), `completed` — e il *come* è raccontato nel capitolo sulla persistenza:
il motore gioca l'asta per davvero, solo su un orologio virtuale.

Il dettaglio che conta è **come** li costruisce: non con `INSERT` artigianali, ma chiamando le
stesse funzioni che usa la UI — `createAuction`, `importPlayers`, `createInvite`, `joinAuction`.
Uno stato prodotto dal seed è quindi, per costruzione, uno stato che l'applicazione sa produrre.
Un seed che scrive righe a mano è un seed che prima o poi fabbrica configurazioni impossibili, e
si passa un pomeriggio a capire perché la UI ci si comporta in modo strano.

Ha anche un effetto collaterale utile: siccome `--auction-status=draft` ottiene lo stato DRAFT
lasciando un posto vuoto — e non impostando la colonna — ogni esecuzione del seed verifica di
passaggio che la derivazione DRAFT ↔ READY funzioni davvero.

L'asta di prova viene ricreata da zero a ogni esecuzione. Ripartire da uno stato noto vale più di
conservare quello vecchio: uno stato ereditato da un seed precedente è la cosa più fastidiosa da
diagnosticare.

---

## I test

Vitest, con una regola sola ma ferrea: **i fake timer sono attivi per default in tutti i test**
(`vitest.setup.ts`). In un'applicazione fatta di scadenze, un test che aspetta davvero mezzo
secondo è un test che prima o poi fallisce su una macchina lenta e fa perdere un pomeriggio a
capire perché. Con i timer finti il tempo passa solo quando lo si fa passare
(`vi.advanceTimersByTime`), e nessun `sleep` reale può infilarsi di nascosto. Un test che ha
davvero bisogno del tempo vero chiama `vi.useRealTimers()` al proprio interno: la deroga resta
esplicita e locale.

I test sono di due specie, e la distinzione conta.

I **test puri** non hanno bisogno di niente per girare: validazione della configurazione di
un'asta, permutazioni di `role_order`, invariante I9, parsing del listone. Sono la maggioranza, e
sono quelli che in Fase 2 diventeranno la garanzia di correttezza dell'intero motore.

I **test di integrazione** (`tests/db/`) parlano con un Postgres vero. Non è pigrizia: metà di ciò
che c'è da verificare nel setup *è* il database — che due join simultanei non prendano lo stesso
posto, che i posti si ricompattino rispettando il vincolo di unicità, che il lock di riga
serializzi davvero. Un mock direbbe sempre di sì. Se il database non risponde, quella suite si
salta con un avviso invece di fallire, così `pnpm test` resta eseguibile su una macchina appena
clonata; il gate di fase, però, si verifica con Docker acceso.

---

## Il setup di un'asta

Questo è il capitolo della Fase 1: tutto ciò che succede **prima** che l'asta cominci. Creare
un'asta, decidere com'è fatta, caricare l'elenco dei calciatori, invitare le persone, aspettare
che entrino.

### Una macchina a due stati, che nessuno imposta a mano

Un'asta nasce in `DRAFT` e diventa `READY` quando tre cose sono vere insieme: i posti sono tutti
occupati, il listone è stato importato, e per ogni ruolo ci sono abbastanza calciatori. Non c'è
nessun pulsante "conferma": lo stato viene **ricalcolato dopo ogni modifica del setup**, e la
funzione che lo fa (`recomputeStatus`) è chiamata alla fine di ogni mutazione.

La conseguenza importante è che il passaggio è reversibile in modo naturale. Se da un'asta pronta
esce un partecipante, l'asta torna in `DRAFT` da sola. Se fosse uno stato deciso da qualcuno,
qualcuno dovrebbe anche ricordarsi di annullarlo — e la sera dell'asta ci si accorgerebbe che
un'asta segnata "pronta" ha sette giocatori invece di otto.

### Chi può fare cosa, e quando

Due assi. Il primo è **chi**: le modifiche alla configurazione, l'import e gli inviti sono
riservati a chi ha creato l'asta; ognuno può togliere sé stesso, l'owner può togliere chiunque.

Il secondo è **quando**, ed è il più interessante. La configurazione si divide in due famiglie:

- I **tempi** (secondi per chiamare, per offrire, per lo spareggio, per l'apertura delle buste) si
  possono cambiare sempre, anche ad asta iniziata. Valgono dal lotto successivo: non accorciano
  mai un countdown in corso.
- Tutto il resto — numero di posti, crediti, slot per ruolo, ordine dei ruoli — è **strutturale** e
  si congela quando l'asta parte. Cambiare gli slot a metà asta significherebbe invalidare rose già
  comprate.

Nell'interfaccia i campi strutturali risultano spenti quando non si possono toccare, ma è solo
cortesia: il server rifiuta comunque quelle modifiche. È la sesta regola del progetto — la UI
disabilita il pulsante, il server rifiuta lo stesso — e la si verifica facilmente manomettendo il
form: un'asta a nove partecipanti inviata a mano viene respinta con «I partecipanti devono essere
8, 10, 12».

### L'ordine dei ruoli

È una lista di quattro elementi che si trascina, e il **primo elemento è il ruolo da cui parte
l'asta**: non c'è una seconda scelta al momento dell'avvio. La lista viaggia al server come una
stringa (`"C,A,P,D"`) dentro un campo nascosto — il drag & drop è un modo di modificarla, non il
canale dati — e il server verifica che sia una permutazione completa di P, D, C, A: né ripetizioni
né ruoli mancanti. Un ruolo assente sarebbe un ruolo che non si gioca mai; uno ripetuto, un ruolo
che si giocherebbe due volte.

Accanto alla maniglia di trascinamento ci sono due frecce. Trascinare quattro righe col pollice su
un telefono è più difficile che premere un pulsante, e la tastiera deve poter fare tutto.

### Il listone

Il file è quello che si scarica da Fantacalcio.it: foglio «Lista calciatori», intestazione in prima
riga, e nel nostro esempio 495 calciatori. Ne leggiamo otto colonne — identificativo, nome,
squadra, ruolo, ruolo Mantra, valore di mercato, quotazione, e il marcatore «fuori lista» — e
ignoriamo il resto. La colonna `Under` contiene l'età, non un flag: è il genere di trappola che
vale la pena scrivere in un commento.

**Il file non viene conservato.** Ne estraiamo i dati e lo buttiamo. In compenso i dati vengono
copiati *dentro l'asta*: la tabella `players` ha una colonna `auction_id`, e la lista si congela al
momento dell'import. Se l'anno prossimo il file cambia, le aste dell'anno scorso restano coerenti
con sé stesse. Un secondo caricamento sostituisce lo snapshot precedente invece di aggiungersi,
così correggere un file sbagliato non richiede di rifare l'asta.

### L'invariante che rifiuta un'asta impossibile

Prima di accettare un import, il server verifica che **per ogni ruolo ci siano almeno
`slot × partecipanti` calciatori disponibili**. È l'invariante I9 del piano, e senza di essa
l'asta si bloccherebbe a metà serata, quando l'ultimo partecipante scopre che di portieri non ne
restano.

Il messaggio di rifiuto nomina il ruolo e i due numeri: «Attaccanti (A): servono 96 giocatori
(8 slot × 12 partecipanti), il listone ne ha 85». Un «import rifiutato» generico, a un'ora dalla
serata, non aiuterebbe nessuno.

La stessa verifica scatta ogni volta che uno dei tre termini si muove: cambiando il numero di
posti, cambiando gli slot per ruolo, e accendendo o spegnendo il toggle sui **fuori lista** — i
calciatori marcati con l'asterisco nel file, esclusi dal pool per default. La pagina di setup
mostra la tabellina «disponibili / servono» per tutti e quattro i ruoli, che è la lettura umana
della stessa disuguaglianza: si vede *prima* di caricare un file perché una configurazione non
passerà.

### Inviti e join

Un invito è un token in un URL, e nient'altro: niente email, niente destinatario, nessuna
scadenza. Lo stesso link va bene per tutti e si manda nel gruppo. Lo schema prevede i campi per una
scadenza e per un numero massimo di utilizzi, e il codice li rispetta se valorizzati, ma di default
restano vuoti — perché **la protezione vera è che gli inviti smettono di funzionare quando l'asta
esce da DRAFT o READY**. Nessuno entra ad asta iniziata, qualunque link abbia in mano.

Chi apre il link vede dove sta entrando — nome dell'asta, posti liberi, crediti, ordine dei ruoli —
e sceglie il nome della squadra. Quel nome è **per-asta, non per-utente**: la stessa persona in due
leghe diverse può chiamarsi in due modi.

Entrando prende il primo posto libero, in ordine di arrivo, e i crediti iniziali sono una copia del
budget dell'asta. Non esiste un budget per singolo partecipante: le differenze individuali, quando
serviranno, saranno righe di rettifica motivate nel registro dei movimenti. Uscendo, i posti si
**ricompattano** senza lasciare buchi, perché la rotazione dei turni scorre i posti in ordine
circolare e un indice mancante sarebbe il turno di nessuno.

### Il lock, questa volta per davvero

Tutte le mutazioni di setup aprono una transazione e prendono un `SELECT ... FOR UPDATE` sulla riga
dell'asta. Non è cerimoniale: due persone che aprono lo stesso link d'invito nello stesso istante,
senza serializzazione, si assegnerebbero lo stesso posto o supererebbero il numero di partecipanti.
Il vincolo di unicità del database le fermerebbe, ma con un errore incomprensibile invece che con
un messaggio.

Questa funzione (`withSetupLock`) è il cugino del `withAuctionLock` di PLAN §6, che arriverà in
Fase 3 per le mutazioni di gioco. Sono due funzioni distinte di proposito: quella di gioco
incrementa il numero di versione dello stato e diffonde lo snapshot a tutti i client collegati,
cose che in `DRAFT` non esistono ancora — non c'è nessuno stream aperto e nessuna macchina a stati
da far avanzare.

### Le due invarianti scolpite nel database

Lo schema di questa fase contiene già le tabelle del gioco, vuote. Due di esse portano un **indice
unico parziale**, ed è il modo in cui due regole del piano diventano impossibili da violare invece
che semplicemente vietate:

```sql
CREATE UNIQUE INDEX one_open_lot_per_auction
  ON lots(auction_id) WHERE status = 'OPEN';

CREATE UNIQUE INDEX one_owner_per_player
  ON assignments(auction_id, player_id) WHERE voided_at IS NULL;
```

Il primo dice che un'asta non può avere due chiamate aperte insieme; il secondo che un calciatore
non può stare in due rose. Nessun controllo applicativo può garantirle sotto concorrenza: due
richieste simultanee possono entrambe leggere «non c'è nessun lotto aperto» e entrambe crearne uno.
L'indice no. Sono lì da adesso perché il momento giusto per metterli è prima che esista la prima
riga che potrebbe violarli.

### Gli errori

Ogni rifiuto ha un **codice** (`INVALID_SEATS`, `LISTONE_INSUFFICIENT`, `INVITE_EXPIRED`, …) e un
messaggio già scritto in italiano. Le funzioni del setup non lanciano eccezioni per i rifiuti
previsti: restituiscono un risultato che è o un valore o un errore, e la pagina lo mostra così
com'è. Le eccezioni restano per i guasti veri — connessione persa, vincolo violato che non doveva
esserlo — che devono finire in una pagina d'errore, non essere ingoiate in un messaggio gentile.

Il motivo è scritto nel piano e vale la pena ripeterlo: durante un countdown di trenta secondi, la
parola «Errore» senza spiegazione è inutilizzabile.

### Le pagine

Quattro, e nessuna di esse tocca il database direttamente.

`/dashboard` elenca le aste di cui si è proprietari o partecipanti. `/auctions/new` le crea.
`/auctions/[id]/setup` è la pagina dell'owner: partecipanti, inviti, listone, impostazioni; chi non
è l'owner viene mandato in lobby. `/auctions/[id]/lobby` è la sala d'attesa, visibile a tutti i
partecipanti. `/join/[token]` è quel che si apre cliccando un invito.

I pallini di presenza in lobby (chi è collegato, chi ha l'app in background) arrivano in Fase 5,
quando esisterà l'heartbeat: prima di allora non ci sarebbe niente di vero da mostrare. Nel
frattempo la lobby è già una funzione dello stato a database — un ricaricamento mostra sempre la
realtà — che è la stessa disciplina che in Fase 4 diventerà l'invariante I10.

L'URL degli inviti si costruisce dall'host della richiesta, non da una variabile d'ambiente. In
sviluppo la stessa pagina viene aperta da `localhost` e dall'IP di rete locale col telefono, e un
link con dentro `localhost` sul telefono non porta da nessuna parte.

---

## Il motore

Questo è il capitolo della Fase 2: la logica dell'asta vera e propria. Vive in tre file dentro
`lib/engine/` — `types.ts`, `rules.ts`, `machine.ts` — e ha una proprietà che vale più di ogni
altra: **non tocca niente**. Nessun database, nessuna rete, nessun orologio. È la fase che il
piano marca come critica, ed è quella che l'anno scorso è saltata: una logica d'asta scritta
direttamente dentro le pagine non si può collaudare, e si scopre che è sbagliata la sera stessa.

### Funzioni pure, e perché

Il motore è una funzione: `transition(stato, evento, adesso) → nuovo stato`. Lo stato è un
oggetto in memoria (`AuctionState` in `types.ts`) che rispecchia le tabelle del database — membri,
giocatori, lotti, round, offerte, assegnazioni, rettifiche — ma non ne dipende. Gli eventi sono
sette: l'avvio, la chiamata di un giocatore, un'offerta, un ritiro, lo scattare di una scadenza,
la pausa e la ripresa. Non c'è nient'altro che possa far muovere un'asta.

Il vantaggio si tocca con mano nei test: l'intera suite del regolamento — le buste, gli spareggi,
i casi patologici — gira in una manciata di millisecondi, senza avviare niente. Un'asta completa
da otto lotti è un ciclo `while` in un test. Quando in Fase 3 il motore verrà collegato al
database, quello strato dovrà solo caricare lo stato, chiamare `transition` e salvare il
risultato: la logica resterà tutta qui, già collaudata.

`rules.ts` e `machine.ts` si dividono il lavoro in modo preciso. Le *regole* rispondono a domande
e non cambiano mai niente: quanti crediti ha un membro, fino a quanto può offrire, chi è idoneo a
un lotto, chi vince un round, a chi tocca dopo. La *macchina* compone quelle risposte in
transizioni. Se si cerca "come si calcola l'offerta massima" si legge `rules.ts`; se si cerca
"cosa succede quando scade il round" si legge `machine.ts`.

### Il tempo si passa come parametro

Dentro il motore non esiste `Date.now()`. Ogni funzione che ha bisogno di sapere che ore sono lo
riceve come argomento, in millisecondi. Sembra un vezzo ed è invece la decisione che rende
testabile tutto il resto: nei test il tempo è un numero che si sceglie — "l'offerta arriva 200
millisecondi dopo la scadenza" è un test di una riga, non un `sleep` — e il comportamento del
motore è identico in sviluppo, in produzione e sotto i timer finti di Vitest.

Ne discende una regola di lettura: quando in `machine.ts` si vede `now`, quel valore l'ha deciso
il chiamante. In Fase 3 sarà il server a passarlo; nei test è il test a dirigere l'orologio.

Per la stessa ragione — una funzione pura non può inventare identificatori casuali — le entità che
il motore crea (lotti, offerte, assegnazioni) ricevono id numerici sequenziali da un contatore
dentro lo stato. Due esecuzioni sullo stesso stato producono lo stesso risultato, sempre; è anche
ciò che rende riproducibile lo spareggio più improbabile, quello che si decide sull'ordine di
inserimento delle offerte.

### Come si legge un lotto

Il giro di un lotto, dall'alto: si è in `WAITING_PICK` e tocca a un seat; la chiamata (o il
timeout, che chiama d'ufficio il miglior valore di mercato rimasto) apre il lotto e lo porta in
`LOT_OPEN`; le buste si chiudono allo scadere; se il massimo è unico si passa al `LOT_REVEAL`,
altrimenti c'è lo spareggio (`LOT_TIE_PREP`, poi di nuovo `LOT_OPEN` come round 2); il reveal
scade e il turno avanza — o l'asta finisce.

Dentro questo giro ci sono quattro scelte che meritano una spiegazione.

**Chi chiama è vincolato.** All'apertura del lotto il motore registra da solo un'offerta a 1 del
chiamante, con il timestamp dell'apertura. Il chiamante può rilanciare ma non ritirarsi: un lotto
ha sempre almeno un'offerta valida, e "nessuno offre" non è uno stato possibile.

**Lo spareggio eredita i timestamp.** Se il round 1 finisce in parità, il round 2 si apre con i
soli pareggianti e con le loro offerte *copiate*, ciascuna con l'`amount_set_at` originale. Chi
non fa nulla "sta" sulla propria cifra; se nessuno rilancia vince chi era arrivato per primo a
quell'importo, nel round 1. Confermare la stessa cifra, per ansia, è deliberatamente un no-op che
non tocca il timestamp: il pulsante premuto due volte non peggiora la posizione di nessuno.

**L'assegnazione si scrive all'ingresso del reveal, non alla fine.** I secondi di reveal sono
puramente presentazionali — servono alla stanza per guardare le buste aperte sulla TV. L'esito è
già committato: un crash durante il reveal non può perdere un lotto deciso.

**Il caso dell'unico idoneo si chiude subito.** Se all'apertura del lotto l'unico che potrebbe
offrire è il chiamante stesso — succede a fine ruolo, quando gli altri hanno la casella piena —
l'esito è già scritto, e il motore salta il countdown: il lotto va dritto al reveal, assegnato
a 1. Trenta secondi di attesa con l'esito noto, moltiplicati per gli ultimi lotti di ogni ruolo,
sarebbero minuti persi in diretta.

### L'evento del tempo, e l'idempotenza

`ADVANCE` è l'unico evento che il tempo genera: in Fase 3 lo emetteranno i `setTimeout` e lo
sweep di sicurezza. È **guardato**: se la scadenza non è ancora arrivata, o la fase nel frattempo
è già cambiata, la transizione restituisce lo stato *identico* — proprio lo stesso oggetto, non
una copia uguale. È l'invariante I7 del piano: un timer che scatta due volte, o un timer e lo
sweep che arrivano insieme, producono un effetto solo.

Quella convenzione — "un no-op restituisce lo stesso riferimento" — è anche il segnale che la
Fase 3 userà per distinguere le mutazioni vere (che incrementano la versione dello stato e
diffondono lo snapshot) da quelle a vuoto (che non devono generare traffico).

La pausa congela, la ripresa trasla. Mettere in pausa segna solo l'istante; riprendere sposta in
avanti ogni scadenza del tempo passato in pausa — la deadline di fase e, se c'è un round aperto,
anche il suo `ends_at`, che è la scadenza contro cui si validano le offerte. Un countdown fermo a
metà riparte da metà: la pausa non può mai far scadere niente in silenzio. Ad asta in pausa le
azioni di gioco sono rifiutate e il tempo non avanza nulla.

### I rifiuti sono valori, i bug sono eccezioni

Come già nel setup, il motore non lancia eccezioni per dire "non puoi": restituisce un errore
tipizzato con un messaggio già pronto (`NOT_YOUR_TURN`, `BID_TOO_HIGH`, `ROUND_CLOSED`, …). Le
eccezioni restano per gli stati che non dovrebbero esistere — un round senza offerte, una fase di
lotto senza lotto — dove l'unica cosa onesta da fare è esplodere e farsi vedere.

C'è un dettaglio di questa famiglia che vale la pena conoscere prima della serata: **il ritiro di
un'offerta è irreversibile**. Chi ritira non può più rientrare su quel lotto, nemmeno cambiando
idea entro la scadenza. È una regola del regolamento, non un limite tecnico, e la UI della Fase 5
dovrà comunicarla per quello che è.

---

## La persistenza e il tempo

Questo è il capitolo della Fase 3: il ponte fra il motore in memoria e il mondo — il database, il
lock, i timer, il riavvio. Il motore non è stato toccato: tutto ciò che segue sta *attorno* a
`transition`, in `lib/engine/mutate.ts` (caricamento, persistenza, lock), `actions.ts` (le azioni
che gli utenti invocano) e `scheduler.ts` (il tempo).

### Il ciclo di ogni mutazione

Qualunque cosa succeda a un'asta avviata — un'offerta, un pick, lo scattare di una scadenza, la
pausa — passa dallo stesso identico ciclo: si apre una transazione, si prende il `SELECT ... FOR
UPDATE` sulla riga dell'asta, si carica lo stato del motore dalle righe del database, si chiama
`transition`, si scrive la differenza, si committa. Poi — fuori dalla transazione — si avvisa chi
deve saperlo: il broadcast dello snapshot (che oggi è un gancio vuoto, lo riempie la Fase 4) e il
riarmo del timer sulla nuova scadenza.

Il lock è il punto che rende tutto il resto semplice, ed è la quarta regola del progetto: **due
azioni concorrenti sulla stessa asta si mettono in fila lì**, e con il lock preso non esistono
corse su nessuna delle altre tabelle. Il test che lo dimostra non usa attese: due mutazioni
simultanee leggono la versione dello stato dalla riga bloccata, e se la seconda vede il valore
già incrementato dalla prima è *perché* ha dovuto aspettarne il commit. I due test di concorrenza
del piano — due pick simultanei aprono un lotto solo; due offerte nello stesso millisecondo non
producono mai un doppio assegnamento — girano contro Postgres vero e sono stabili su venti
esecuzioni consecutive.

### La traduzione fra i due mondi

Il motore ragiona su millisecondi e id numerici da contatore; il database ha `TIMESTAMPTZ` e
uuid. La traduzione è confinata in due funzioni speculari. `loadAuctionState` legge le righe e
costruisce l'`AuctionState`, assegnando gli id del motore in ordine di lettura e tenendosi la
mappa verso gli uuid; quegli id sono **etichette di caricamento**, valide per il ciclo corrente e
mai persistite — due caricamenti dello stesso database producono lo stesso identico stato, e
niente nel dominio dipende dal loro valore.

`persistTransition` scrive la differenza fra lo stato prima e dopo, e la calcola **per
riferimento**: siccome il motore non muta mai — ciò che cambia è un oggetto nuovo, ciò che non
cambia è lo stesso oggetto — basta un confronto di identità per sapere quali lotti, round e
offerte toccare. Un rilancio è l'aggiornamento di una riga; un pick è l'inserimento di un lotto
col suo round, l'eligibility e l'auto-bid del chiamante; un no-op non scrive niente. E qui torna
la convenzione della Fase 2: quando `transition` restituisce lo stesso riferimento, il ciclo lo
riconosce con un `===`, non incrementa `state_version` e non farà partire nessun broadcast. Lo
sweep può bussare ogni secondo senza generare traffico.

### Le azioni, e chi può fare cosa

`actions.ts` è il punto in cui un utente autenticato incontra il motore: `startAuction`,
`pickPlayer`, `placeBid`, `withdrawBid`, `pauseAuction`, `resumeAuction`, più `advancePhase` che
non ha un utente — la chiamano i timer. La divisione dei compiti è netta: le azioni traducono
l'utente nel suo membro e controllano le autorizzazioni (l'avvio e la pausa sono dell'owner);
**le regole del gioco restano tutte nel motore**, e i suoi rifiuti tipizzati risalgono così come
sono. Ogni transizione effettiva scrive anche una riga in `events` — la memoria dell'asta, quella
che si interroga quando qualcosa è andato storto — e una riga JSON su stdout, quella che la sera
dell'asta scorre in un terminale con `pm2 logs`.

Un dettaglio che i test sfruttano ovunque: anche le azioni prendono il tempo come parametro
opzionale. In produzione nessuno lo passa e vale l'orologio vero; nei test "riprendi dopo cinque
minuti di pausa" è un numero, non un'attesa.

### Il tempo ha due gambe

Lo scheduler (`lib/engine/scheduler.ts`) dà corpo alle scadenze, e lo fa con due meccanismi che
puntano alla stessa `advancePhase`:

- **`arm`** è la via veloce: un `setTimeout` sulla deadline della fase, riarmato dopo ogni
  mutazione. È quello che chiude un round nel millisecondo giusto.
- **lo `sweep`** è la rete di sicurezza: ogni secondo chiede al database le aste LIVE con la
  deadline scaduta e le fa avanzare. Da solo terrebbe in piedi l'asta anche se tutti i
  `setTimeout` sparissero — ed è esattamente ciò che succede a un riavvio.

Nessuno dei due "decide" niente: emettono `ADVANCE`, e la transizione è guardata dentro il motore
(I7). Un timer che scatta due volte, un timer e lo sweep insieme, due processi che per sbaglio
fanno lo sweep sulla stessa base dati: tutto innocuo per costruzione, un effetto solo.

Il **boot recovery** è la conseguenza, non una funzione in più: all'avvio del processo si fa un
giro di sweep (che chiude subito ciò che è scaduto durante il downtime) e si riarma il timer di
ogni asta LIVE. L'avvio sta in `instrumentation.ts`, il gancio che Next.js esegue una volta per
processo — con la guardia `globalThis.__scheduler ??=`, perché in sviluppo l'hot reload rieseguirebbe
la registrazione e due sweep sulla stessa asta, per quanto innocui, sono comunque uno spreco. Se
il server muore a metà round e riparte, entro un secondo lo stato riprende dal database: se il
downtime era più corto del tempo residuo il round prosegue normalmente, altrimenti lo sweep lo
chiude con le buste già consegnate — che è il comportamento giusto, perché le offerte stanno a
database, non in memoria.

### Il driver: l'asta che si gioca da sola

`pnpm drive --auction=<id>` è il collaudo di tutto il capitolo: prende un'asta pronta e la porta
a COMPLETED senza UI. Avvia lo scheduler in-process — è lui a chiudere i round, il driver non
chiama mai `advancePhase` — e impersona i partecipanti: chi è di turno chiama un giocatore, gli
idonei offrono importi casuali validi, qualcuno ogni tanto ritira o si lascia scadere il pick per
esercitare l'auto-pick. Se l'asta arriva in fondo è perché timer, sweep, lock e persistenza
funzionano insieme. Con i timer corti del seed (3 secondi per offrire) un'asta piccola si chiude
in un paio di minuti; quella vera da duecento lotti in un quarto d'ora.

Lo stesso motore, girato su un **orologio virtuale**, è il modo in cui il seed fabbrica gli stati
avanzati: `--auction-status=mid` gioca metà asta in memoria saltando di deadline in deadline
(millisecondi, non minuti), poi persiste il risultato in un'unica differenza dentro il lock,
con tutti i timestamp traslati perché l'ultima transizione cada su "adesso". Niente `INSERT`
artigianali: ogni stato intermedio è passato da `transition`, quindi è per costruzione uno stato
che l'applicazione sa produrre. L'unica rinuncia dichiarata è la storia in `events` della parte
simulata, sostituita da una riga `SEED_FAST_FORWARD`.

---

## Cosa non c'è ancora

Alla fine della Fase 3 un'asta completa si gioca da sola, da riga di comando, e sopravvive a un
riavvio del processo a metà round. Ma nessun client la vede: il broadcast è un gancio vuoto, non
esiste né lo snapshot sanificato né lo stream SSE, e non c'è ancora una sola riga di UI
dell'asta — è un criterio dei gate, non una mancanza.

La Fase 4 costruirà il canale verso i client: `serializeSnapshot` (l'unico punto da cui lo stato
esce dal server, per costruzione senza importi altrui durante le buste chiuse), il broadcast agli
stream aperti, l'heartbeat di presence e i bot che sostituiranno il driver come partecipanti
finti.
