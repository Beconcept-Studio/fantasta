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

**E proprio perché sono presentazionali, la regia può accorciarli.** «Prosegui asta» è un evento
a sé, `SKIP_REVEAL`, che l'owner emette dal proprio portale o dalla console: chiude il reveal e
passa il turno senza aspettare la scadenza. È l'unica transizione dell'applicazione che avviene
perché un umano l'ha chiesta invece che perché il tempo è passato, e per questo sta accanto ad
`ADVANCE` e non dentro: la guardia `now < phase_deadline` che rende `ADVANCE` idempotente serve ai
timer e allo sweep, e allentarla per fare spazio a un pulsante l'avrebbe resa inutile per
entrambi. L'effetto è la stessa funzione che gira alla scadenza, `nextTurn`, così non esistono due
strade per passare il turno; cambia solo *quando*, e il countdown della fase successiva nasce
dall'istante del click. Premuto due volte non salta due lotti: al secondo colpo la fase non è più
`LOT_REVEAL` e la guardia rifiuta, senza che sia servito un flag. `reveal_seconds` resta quello che
era — configurabile, e scadenza automatica per chi non tocca niente.

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

### L'asta che si gioca da sola

Il collaudo di tutto il capitolo è un'asta che parte pronta e arriva a `COMPLETED` senza che
nessuno tocchi niente: se ci arriva, è perché timer, sweep, lock e persistenza funzionano insieme.
Con i timer corti del seed (3 secondi per offrire) un'asta piccola si chiude in un paio di minuti;
quella vera da duecento lotti in un quarto d'ora.

Fino a v1.4.0 lo faceva `pnpm drive`, uno script che avviava **uno scheduler suo**. È stato
ritirato in M4: la simulazione in-app fa la stessa cosa meglio — dodici bot, nessun umano, e una UI
da guardare mentre succede — e senza il secondo scheduler sullo stesso database, che è una delle
trappole ricorrenti di questo progetto.

Lo stesso motore, girato su un **orologio virtuale**, è il modo in cui il seed fabbrica gli stati
avanzati: `--auction-status=mid` gioca metà asta in memoria saltando di deadline in deadline
(millisecondi, non minuti), poi persiste il risultato in un'unica differenza dentro il lock,
con tutti i timestamp traslati perché l'ultima transizione cada su "adesso". Niente `INSERT`
artigianali: ogni stato intermedio è passato da `transition`, quindi è per costruzione uno stato
che l'applicazione sa produrre. L'unica rinuncia dichiarata è la storia in `events` della parte
simulata, sostituita da una riga `SEED_FAST_FORWARD`.

---

## Il canale verso i client

Questo è il capitolo della Fase 4. Il motore e la persistenza non sono stati toccati: quello che
si aggiunge è il modo in cui lo stato **esce** dal server e arriva ai telefoni, alla TV e al
portale del manager. Sono quattro pezzi — la serializzazione, il registro delle connessioni, lo
stream, la presence — e una decisione di fondo che li tiene insieme.

### Snapshot interi, non aggiornamenti

Esiste un solo tipo di messaggio, si chiama `snapshot`, e contiene **tutto lo stato dell'asta**
ogni volta. Non c'è un evento "qualcuno ha offerto", non c'è un delta da applicare a quello che il
client aveva prima.

Sembra uno spreco, e non lo è: con dodici partecipanti uno snapshot sta in pochi kilobyte, e a
fronte di quel costo spariscono due intere categorie di bug. La prima è il merge sbagliato di un
delta — lo stato del client che diverge lentamente da quello del server e nessuno se ne accorge
finché non si assegna il giocatore alla persona sbagliata. La seconda, più insidiosa, è il
disallineamento di chi si riconnette: se le schermate dipendessero dagli eventi ricevuti, chi ha
il telefono che va in standby a metà round, o chiude il tab per sbaglio, tornerebbe a un'app che
non sa più dov'è. Con lo snapshot intero non esiste "aver perso qualcosa": ci si riconnette, arriva
subito lo stato completo, e da quello solo si ricostruisce la fase corrente, il tempo residuo, la
propria offerta già salvata, la propria idoneità e il pannello dei risultati se il lotto è già
stato deciso. È la settima regola del progetto, ed è verificabile: ogni schermata è funzione pura
dello snapshot corrente.

Il client scarta gli snapshot con una `stateVersion` inferiore a quella già vista. Serve perché i
due modi in cui uno snapshot arriva — quello iniziale della connessione e quelli del broadcast —
possono sorpassarsi a vicenda per qualche millisecondo, e senza il confronto la schermata
tornerebbe indietro nel tempo per un istante.

### Un solo punto di uscita, ed è il motivo

`serializeSnapshot` in `lib/engine/snapshot.ts` è **l'unica funzione che trasforma lo stato
dell'asta in qualcosa che esce dal server**. È la terza regola del progetto, e non è una
preferenza di stile: è il modo di rendere vera l'invariante I8 — *durante `LOT_OPEN` nessuno vede
l'importo dell'offerta di un altro* — per costruzione invece che per attenzione.

La differenza è tutta pratica. Se la serializzazione fosse sparsa fra tre pagine e due componenti,
garantire I8 vorrebbe dire ricordarsene ogni volta, e basterebbe una `JSON.stringify` distratta in
un punto qualsiasi per far trapelare una busta. In un'asta a busta chiusa una busta che trapela
non è un bug da ticket: è l'asta rifatta. Con una funzione sola, invece, *tutte* le uscite
possibili sono coperte da un test solo — ed è il criterio di chiusura di questa fase, esercitato
sui tre spettatori che esistono: un partecipante, l'owner che organizza senza giocare, e la vista
TV senza login.

La regola di sanificazione è una sola: **finché il lotto è aperto, delle buste altrui non esce
niente**. Il proprio importo lo vede solo il proprio viewer, in `myBid` — e chi viewer non è, cioè
il manager che non gioca e la TV, non ha nemmeno quello. Gli importi diventano pubblici in un
momento solo, `LOT_REVEAL`, ed è lì che compare il campo `reveal` con tutte le buste di tutti i
round. L'unica informazione che esce prima è l'importo pareggiato durante `LOT_TIE_PREP`, che è il
contenuto stesso dell'annuncio di spareggio e fra due secondi sarà la soglia pubblica del round
successivo.

Fino a v1.1.0 la regola era più debole, e diceva: degli altri si sa **se** hanno una busta, mai
**quanto** c'è dentro. C'era un campo apposta, `bidStatus`, una lista di booleani, e sul telefono
diventava un pallino verde per ogni busta consegnata, sulla TV un riquadro che si accendeva, nella
console un contatore `4/7`. Sembrava innocuo perché nessuna cifra usciva. Non lo era: in una stanza
dove ci si guarda in faccia, sapere chi si è già mosso — e soprattutto chi non si è ancora mosso —
è già abbastanza per fare strategia. Si aspetta il vicino, si legge la sua fretta, si offre di
conseguenza; ed è esattamente ciò che la busta chiusa doveva impedire. Con M1 il campo è caduto, e
con lui il conteggio aggregato: «quattro su sette» sembra anonimo, ma a fine ruolo gli idonei sono
due o tre e il numero fa il nome da sé.

Il modo in cui è caduto conta quanto il fatto che sia caduto. `bidStatus` non è stato spostato
dentro un `if` sulla fase: è stato **eliminato dal tipo**. È la differenza fra un invariante
sorvegliato e uno strutturale — un campo che non esiste non può essere emesso nella fase sbagliata
da una modifica distratta di qui a un anno. Quello che resta del round è `eligibleMemberIds`, che
dice chi *potrebbe* offrire ed è comunque deducibile da rose e crediti, pubblici per tutti.

Due dettagli che sembrano tecnici e sono di dominio. Il primo: verso il client escono **uuid**, non
gli id numerici del motore — quelli sono etichette valide per un solo caricamento, e un client che
si ricordasse "ho già chiuso il modale del lotto 7" si ritroverebbe a parlare di un altro lotto al
caricamento successivo. Il secondo: i nomi (della squadra, del giocatore) e la telemetria di
presence viaggiano accanto allo stato del motore, non dentro — `AuctionState` resta la struttura
minima su cui i test puri lavorano in millisecondi.

### L'orologio è quello del server

Ogni snapshot porta `serverNow`. Il client calcola `offset = serverNow − Date.now()` e rende i
countdown come `deadline − (Date.now() + offset)`. È l'unico modo di far vedere lo stesso numero a
dodici telefoni, uno dei quali sarà avanti di venti secondi — e succede sempre.

E il countdown è **rendering, non decisione**: quando arriva a zero la pagina scrive "in
chiusura…" e aspetta lo snapshot successivo. La chiusura di un round avviene esclusivamente lato
server, allo scattare del timer o dello sweep. È la prima regola del progetto, e questa fase è il
punto in cui sarebbe stato facile tradirla.

### Il registro delle connessioni

`lib/realtime/broadcast.ts` è una `Map` da id dell'asta all'insieme delle connessioni aperte, più
la funzione che manda a ciascuna il proprio snapshot. Il posto da cui parte era già stato deciso in
Fase 3: `withAuctionLock` chiama un hook **dopo il commit e solo se la mutazione ha avuto effetto**
— un no-op dello sweep non genera traffico. Ora quell'hook fa qualcosa.

Il broadcast carica lo stato una volta sola e poi serializza una volta per ogni viewer distinto.
Non è un'ottimizzazione mancata: serializzare una volta per tutti sarebbe *sbagliato*, perché
manderebbe il `myBid` di qualcuno a tutti gli altri.

Il costo è quello che è, e vale la pena averlo misurato: ogni snapshot rilegge **tutta la storia
dell'asta** dal database — duecento lotti, i loro round, milleseicento offerte — perché il motore
lavora sullo stato intero. A fine asta sono 20 ms di lettura, 1 ms di serializzazione e 23 KB di
JSON per viewer. Cresce durante la serata, ma resta lontano da qualunque soglia che si possa
notare, e in cambio non esiste una seconda strada per leggere lo stato: c'è `loadAuctionState`, e
basta.

Un punto che ha richiesto un'ora di indagine e vale la pena ricordare: **i singleton di processo
stanno su `globalThis`**, non in variabili di modulo. Next compila `instrumentation.ts` — da cui
parte lo scheduler — e i route handler — da cui si aprono le connessioni — in bundle separati, con
copie distinte degli stessi file. Con una `Map` di modulo le connessioni finivano in un registro e
il broadcast partiva dall'altro: stream aperto, snapshot iniziale corretto, e poi silenzio per
tutta l'asta. È la generalizzazione della guardia `globalThis.__scheduler` che c'era già.

### Lo stream

`GET /api/auctions/:id/stream` è un `text/event-stream` che vive quanto la pagina. Alla
connessione manda subito uno snapshot completo — è ciò che rende il rientro a metà asta un
non-problema — e poi uno per ogni mutazione. Tre accortezze, tutte nate da modi in cui una
connessione muore in silenzio: ci si iscrive al registro **prima** di leggere lo stato (nell'ordine
inverso ci sarebbe una finestra in cui una transizione non arriva a nessuno); un commento `: ping`
ogni quindici secondi tiene aperta la connessione attraverso proxy e reti mobili; l'header
`X-Accel-Buffering: no` impedisce a nginx di bufferizzare la risposta e consegnare gli snapshot a
blocchi.

Chi può collegarsi lo decide `resolveViewer`: un membro dell'asta (e vede la propria offerta),
l'owner che non ha joinato (e non vede nessun importo, perché non ne ha), oppure la vista TV, che
non ha una sessione e si autentica col `public_token` dell'asta nell'URL. Chiunque altro riceve un
403.

### Chi c'è, adesso

La presence è telemetria, non stato-macchina, e questa distinzione ha una conseguenza precisa:
`last_seen_at` e `is_visible` si scrivono **fuori dal lock dell'asta** e non incrementano
`state_version`. La quarta regola protegge lo stato del gioco — aste, lotti, round, offerte, rose —
non due colonne che dicono se un telefono è acceso; farle passare dal lock significherebbe mettere
in fila dodici transazioni ogni dieci secondi dietro le offerte.

Il valore che si vede — LIVE, IDLE, OFFLINE — non è una colonna: si deriva a ogni lettura
dall'ultimo heartbeat e dal flag di visibilità del tab. Una colonna andrebbe scritta da qualcuno
anche quando *non* succede niente, che è esattamente il caso in cui un partecipante sparisce. Il
browser batte un colpo ogni dieci secondi con `POST …/heartbeat`, indipendentemente dallo stream:
un tab con la connessione rotta ma la pagina viva risulta comunque presente.

L'invio ai client di un cambio di presence è coalescato a un secondo e parte solo se qualcuno ha
davvero cambiato stato. Il confronto non è con il "prima" dello stesso heartbeat ma con **l'ultima
mappa annunciata**, e questa è la parte non ovvia: il caso interessante non è chi batte il colpo,
è chi *smette* di batterlo — nessun evento lo segnala, e a scoprirlo è il primo heartbeat altrui
che arriva dopo la scadenza dei quindici secondi.

Da qui nasce anche il cancello di avvio: `READY → LIVE` richiede **tutti i membri in LIVE**, non
"non OFFLINE". Un'asta parte con un countdown di trenta secondi, e chi ha il telefono in tasca lo
scoprirebbe dopo aver perso il primo lotto. Il rifiuto nomina chi manca, perché in lobby "membri
non pronti" non basta. Vale anche per il seed, i test e il driver: chi simula la stanza simula
anche i telefoni accesi, invece di avere una scorciatoia per saltare il cancello.

### I bot

`pnpm bots --auction=<id> --count=7 --strategy=random` è la fonte di partecipanti finti **da
fuori**: sono **client veri**. Si firmano un cookie di sessione — il capitolo sul server racconta
perché, e perché non passano dal provider `dev` — aprono lo stream SSE, e reagiscono agli snapshot
esattamente come un telefono. Le loro azioni passano da `POST …/action`, cioè dal server: se
scrivessero sul database dal proprio processo, il broadcast partirebbe da lì e il browser aperto
accanto non vedrebbe muoversi niente.

Le strategie servono a fabbricare situazioni: `aggressive` offre sempre il massimo, `passive`
sempre il minimo, `random` importi verosimili, e `tie` fa convergere tutti sulla stessa cifra —
è il modo di innescare a comando lo spareggio, che a mano è quasi impossibile da riprodurre. Con
sette bot più un browser reale si collauda il proprio portale in mezzo a un'asta che va avanti da
sola.

Da M4 questo script **non decide più niente**: come si comporta un bot lo stabilisce un modulo
condiviso, e qui resta il trasporto — sessione, stream, POST. Ed è per il trasporto che sopravvive
alla simulazione in-app, che di quei pezzi non ne tocca nessuno: il giorno in cui si romperà il
buffering SSE dietro nginx, sarà questo script a dirlo. Il capitolo che segue racconta l'altra metà.

---

## La simulazione, e chi fa muovere i bot

Fino a M4, provare le dinamiche dell'asta voleva dire tre terminali: il database, il seed con l'id
copiato da una riga di output, lo script dei bot. Funzionava — è ciò che ha permesso di collaudare
tutto — ma era una procedura, e una procedura è qualcosa che si sbaglia quando serve in fretta.
La simulazione in-app la sposta dentro l'applicazione: si crea un'asta simulata come se ne crea una
vera, le si dice «riempi i posti liberi con i bot», e si gioca.

### Un'asta simulata è un'asta, non una modalità

`auctions.is_simulated` si decide alla creazione e non cambia più: `updateAuctionSettings` non la
conosce, e non esiste nessuna schermata che la tocchi. Non è prudenza — è ciò che rende
*strutturalmente* impossibile che dei bot finiscano in un'asta vera. Non c'è nessun ramo «se
simulata allora» dentro il motore, e non deve nascerne: la simulazione non è un modo di giocare
diverso, è un'asta con dei partecipanti che non hanno un telefono.

Le due strade possibili erano un flusso di creazione dedicato («crea un'asta simulata») oppure un
pannello che riempie di bot un'asta qualunque. Si è scelto **il pannello, con il flag alla
creazione come cancello**. La prima strada avrebbe duplicato la schermata di configurazione, che è
precisamente ciò che serve — «configurarla come se fosse vera» — e la copia sarebbe divergente al
primo cambio. La seconda, da sola, avrebbe lasciato per sempre un pulsante «riempi di bot» a due
centimetri dagli inviti dell'asta vera.

I bot sono un **pool fisso di dodici utenti** con `is_bot = true`, creati se mancano al primo
riempimento (e dal seed, così in locale ci sono da subito). Dodici perché è il taglio massimo, e
perché l'owner può condurre senza giocare. Lo stesso bot sta in più aste insieme —
`members_auction_user_unique` è su *(asta, utente)* — quindi due simulazioni in parallelo non
collidono. Sono esclusi da `listDevUsers()` e rifiutati dal provider `dev`: una lista di identità
di comodo che si sporca da sola smette di essere utile.

### Il cervello, e perché è puro

Come si comporta un bot sta in `lib/engine/bot-brain.ts`: una funzione che prende uno **snapshot**,
una strategia e un istante, e restituisce la mossa o `null`. Nessun database, nessun `Date.now()`
dentro — il tempo è un parametro, per la stessa ragione per cui lo è nel motore.

Il tipo di quel primo argomento è la cosa importante. Uno `Snapshot` è l'uscita di
`serializeSnapshot` **costruita col `memberId` del bot**: le buste altrui non ci sono. Prima di M4 i
cervelli erano due e già divergevano — quello dello script leggeva lo snapshot redatto, quello del
driver leggeva `AuctionState` grezzo, cioè vedeva le offerte di tutti. Finché i bot giocavano fra
loro era indifferente; nel momento in cui *tu* giochi contro di loro, un bot onnisciente è un bot
che ti batte sempre di uno. Ridotti a uno, e quello che resta è il cieco: I8 smette di essere una
promessa e diventa la firma di una funzione.

Non c'è nessuna memoria da nessuna parte, e non per eleganza. «Ho già offerto in questo round?» lo
dice lo snapshot (`myBid`). E il ritardo con cui un bot agisce dentro un round — che serve, perché
bot che offrono tutti nell'istante dell'apertura trasformano l'asta in una lista di risultati — non
è una variabile: si **deriva** da chi è, su quale lotto, in quale round. Stessa situazione, stesso
ritardo, anche dopo un riavvio del processo, che qualunque memoria l'avrebbe azzerata. È anche ciò
che rende i test non intermittenti: dove c'era `Math.random()` adesso c'è un hash.

### Il tick, e perché non è lo sweep

A far muovere i bot dentro l'applicazione è un `setInterval` da un secondo, registrato in
`instrumentation.ts` sotto la sua guardia su `globalThis`. Tre domande, in ordine.

**Perché in-process, quando lo script dei bot è nato apposta per non esserlo.** La ragione storica
— dei bot che chiamano il motore nel *proprio* processo scrivono senza che il server se ne accorga,
e nessun browser vede muoversi niente — vale per uno script. Codice che gira **dentro** il server
Next ha già l'hook di broadcast impostato: scrive nel processo giusto, e lo stream parte da solo.

**Perché un intervallo separato dallo sweep dello scheduler.** Lo sweep chiude i round ed è
sequenziale. Mettendoci dentro le mosse dei bot, una simulazione con undici bot che scrivono sotto
lock ritarderebbe la chiusura di un round dell'asta vera che gira accanto sulla stessa macchina.
Sono due lavori con priorità diverse, e restano due cicli. Non è un servizio di scheduling né un
worker: è un `setInterval` nell'unico processo Node, la stessa forma dello sweep, e `exec_mode:
fork` con `instances: 1` resta la ragione per cui è sicuro.

**Cosa fa un giro.** Prima lo stand-down (sotto). Poi, per ogni asta simulata `READY` o `LIVE`,
l'heartbeat dei bot — fuori dal lock, perché la presence è telemetria: serve perché il cancello di
avvio pretende tutti i membri `LIVE`, e un bot deve superarlo come lo supererebbe un telefono
acceso, non con una deroga nel motore. Infine, per le aste `LIVE`, la mossa di ogni bot: si
costruisce il *suo* snapshot, lo si dà al cervello, e se decide di agire si chiamano `pickPlayer` o
`placeBid` — **le stesse funzioni che chiama la rotta HTTP**. Stesso lock, stesse regole, stesso
broadcast. Rispetto a un telefono, un bot salta soltanto la sessione, che è ciò che distingue «sono
il server» da «sono un browser».

E i bot **non chiudono mai niente**: offrono e chiamano, come un partecipante. A chiudere un round
resta soltanto lo scheduler.

### Lo stand-down, che è la difesa vera

Questa funzione gira sulla stessa macchina dell'asta vera, e «la sera dell'asta non si pusha su
`main`» non la copre: è roba di runtime, non di deploy. Quindi il tick, prima di muovere qualsiasi
bot, si chiede se esista un'asta **non simulata** in `LIVE` o `PAUSED` — e se c'è, non fa niente.
È il gemello a runtime della regola che il deploy applica già, quella per cui `deploy.sh` si
rifiuta di partire con un'asta in corso: durante l'asta vera nessuno può, nemmeno volendo, mettere
undici bot a scrivere sotto lock accanto ai dodici telefoni.

Il costo è che una simulazione dimenticata accesa **si congela**. Per questo la pagina della
configurazione fa la stessa domanda e lo scrive: senza quella riga, fra tre mesi sembrerà un guasto
e ci si passerà una serata.

Le altre difese sono più semplici e stanno tutte nello stesso punto: solo un **amministratore
dell'applicazione** (`users.is_admin`, una colonna che esisteva dall'inizio del progetto e che
questa macro usa per la prima volta) vede la casella «asta simulata» e può riempire di bot, e
`fillWithBots` rifiuta comunque un'asta che non sia simulata. L'amministratore è un permesso su una
persona e non un tipo di utente — un amministratore gioca le aste come tutti — ed è per questo che
`is_admin` e `is_bot` sono due booleani indipendenti invece di una colonna a tre valori. L'unica
combinazione che non deve esistere, `is_admin AND is_bot`, la vieta un `CHECK`: la stessa logica
degli indici parziali di I1 e I2, per cui una regola che si può rendere impossibile non si
sorveglia.

Infine il badge **[simulazione]**, che compare in dashboard, nell'intestazione di ogni sezione
dell'asta e sulla TV. Sembra decorazione e non lo è: chi lavora a questa applicazione tiene aperte
due schede, e le due schermate sono identiche in tutto il resto — è lo stesso codice, di proposito.

---

## Come ci si sposta, e come si sa dove si è

Per un anno ogni pagina si è scritta la propria navigazione. Non era una svista: le pagine sono
nate in fasi diverse, ognuna ha aggiunto i link che le servivano, e nessuna ha mai avuto il compito
di guardare le altre. Il risultato, arrivati a cinque schermate, erano cinque navigazioni diverse —
la regia con cinque link testuali in cima, il portale con due in fondo alla pagina (cioè, su un
telefono, dopo tutto il resto), lobby e setup con due ciascuna e nessun accordo su quali.

Il difetto vero non era la disomogeneità ma una sua conseguenza: **la voce «Pannello di
configurazione» puntava alla lobby**, in due punti diversi. Chi cercava la configurazione cliccava
esattamente quella e finiva altrove, mentre il link giusto esisteva, nella regia, in mezzo ad altri
quattro. Un'etichetta e la sua destinazione tenute insieme da nient'altro che l'attenzione, scritte
in quattro posti, divergono quattro volte.

La risposta è un posto solo. `lib/auction-nav.ts` tiene su una riga sola, per ogni sezione, il
segmento di URL, la voce di menù e il titolo della pagina; la sotto-navbar e il titolo escono
entrambi da lì, quindi non possono più raccontare due cose diverse. Il file non ha nessuna
dipendenza — è il gemello di `lib/domain.ts`, e per la stessa ragione: lo legge anche il componente
client che evidenzia la voce attiva, e importare l'ORM per quattro stringhe manderebbe Drizzle sul
telefono.

Sopra tutto c'è una **navbar globale** nel layout radice: la scritta *Fantasta* che riporta alla
lista delle aste, il nome di chi è entrato, la versione compilata e l'uscita. La versione è lì per
un controllo a vista — aprire il sito e sapere quale codice sta rispondendo, invece di credere al
momento in cui il deploy dichiara di aver finito — e viene da `package.json`, letto nel layout e
passato alla navbar come stringa: il deploy compila sul server dopo il checkout, quindi quel numero
è quello del codice in esecuzione. Si disegna anche senza sessione, così si legge dalla pagina di
accesso, che è dove si guarda quando l'app non fa entrare. Il blocco utente si disegna solo se c'è una
sessione e il nome solo se esiste, il che copre senza casi speciali sia `/signin` (dove non c'è
sessione) sia `/onboarding` (dove il nome è proprio ciò che si sta scrivendo, ma l'uscita deve
esserci: è l'unica via di fuga per chi è entrato con l'account sbagliato). Si toglie di mezzo sulla
sola vista TV, che è pubblica e proiettata — e con lei si toglie anche il banner dell'asta in corso,
che fino a quel momento si incollava in cima allo schermo proiettato ogni volta che l'owner avesse
una sessione aperta nello stesso browser: una striscia verde che invita ad andare al proprio
portale, sopra un tabellone che guarda tutta la stanza.

Dentro un'asta, un layout su `/auctions/[id]` legge una volta chi guarda e che rapporto ha con
quell'asta, e da due booleani — la possiede, ci gioca — ricava le sezioni. **Dipendono dal ruolo e
mai dallo stato dell'asta**, e non è solo prevedibilità: il ruolo non cambia mentre guardi la
pagina, lo stato sì, e una sotto-navbar renderizzata dal server mostrerebbe voci sbagliate dopo la
prima transizione — a meno di alimentarla dallo snapshot, cioè di trasformare la navigazione in
stato di gioco. Il layout decide cosa *mostrare*, mai cosa si può *fare*: sono le pagine a
respingere chi non deve entrare, e le azioni a ricontrollare comunque sul server.

Nella stessa intestazione il nome dell'asta è tornato a essere ciò che è — **contesto, quindi un
badge** — e il titolo dice finalmente il nome della pagina. Prima erano tre schermate diverse che si
presentavano tutte come «Serie A 2026», cioè l'unica cosa che chi guarda già sa.

Quel che invece **non** è salito nell'intestazione è lo stato dell'asta. Il suo badge è letto dal
server all'apertura della pagina e lì resta fermo: in regia si troverebbe accanto al badge di fase
che arriva dallo stream, a dire il contrario. Sta nel contenuto di lobby e configurazione, dove ogni
riga viene dalla stessa lettura e ha quindi la stessa età.

Un dettaglio che sembra estetico e non lo è: **niente di tutto questo è sticky**. Il requisito nasce
dal portale, dove lo spazio verticale è la risorsa più scarsa dell'applicazione e non può essere
speso per una barra di navigazione mentre scorre un countdown di otto secondi; applicarlo ovunque
non costa nulla, perché le altre pagine sono documenti e non cruscotti, ed evita un incastro a tre
livelli di `z-index`. Restano incollati i due che devono esserlo: il banner dell'asta in corso, che
è il richiamo d'emergenza, e l'intestazione dell'asta live, che tiene crediti e offerta massima
sempre in vista.

Il costo tecnico di tutto questo è una riga: `getAuctionOverview` è avvolta in `cache()` di React,
perché ora la chiamano sia il layout sia la pagina. La memoizzazione dura quanto la richiesta e non
altro — fuori da un contesto di render React la funzione viene semplicemente eseguita, quindi test e
script continuano a leggere il database vero a ogni chiamata.

---

## Il portale del partecipante

Qui l'applicazione incontra la persona: un telefono tenuto con una mano, in una stanza dove
qualcuno legge i nomi ad alta voce, con trenta secondi per decidere quanto vale un attaccante. Il
portale sta su `/auctions/[id]/play` ed è una pagina sola.

La parte server di quella pagina fa tre cose e nessuna di queste è preparare la schermata: verifica
che chi entra sia un membro (l'owner che non ha joinato non ha un portale — il suo è `/manage`),
carica il listone, e passa la palla al client. **Lo stato dell'asta non viene renderizzato lato
server**, ed è una scelta: una schermata calcolata a build-time della richiesta sarebbe giusta per
un istante e sbagliata per i trenta secondi successivi, e avere due fonti di verità sulla fase
corrente è esattamente il modo in cui si desincronizza un'asta.

### Tre livelli, e nessuna notifica

La gerarchia della UI è quella di `docs/PLAN.md` §8bis, e ogni livello esiste per un modo preciso in
cui un partecipante può perdersi.

Il **banner globale** sta nel layout radice, quindi compare su qualunque pagina — dashboard
inclusa — quando l'utente è membro di un'asta `LIVE` o `PAUSED`. Serve a chi ha chiuso il tab per
sbaglio o ha riaperto l'app dalla home dello smartphone: senza, l'unico modo di rientrare sarebbe
ricordarsi un URL con un uuid dentro. Si nasconde solo sul portale di quell'asta, dove porterebbe
dove già sei.

La **card del lotto** è un elemento *permanente* del portale finché c'è un lotto corrente. È la
correzione dell'errore che l'anno scorso ha reso l'app inutilizzabile: se l'unica interfaccia per
offrire è un modale, chi lo chiude non ha più modo di rientrare nel lotto. La card mostra
giocatore, ruolo, squadra, countdown, la propria offerta e il pulsante che riapre il modale. Degli
altri non dice niente, e lo dichiara: una riga spiega che le buste sono segrete fino all'apertura,
perché senza quella spiegazione la card sembra semplicemente rotta.

Le card sono **due**, e si danno il cambio con la fase. Finché il lotto è vivo — le offerte, e
l'annuncio dello spareggio — comanda `LotCard`: cornice accesa, barra che scorre, countdown grande,
un pulsante da premere. Quando le buste si aprono subentra `LotClosedCard`, che ha una faccia
diversa perché è un momento diverso: superficie spenta, nessuna barra, nessun pulsante, e il numero
grande in alto non è più il tempo che scappa ma il prezzo già pagato. Sotto, tutte le offerte di
tutti i round con la vincente in evidenza; in fondo, staccato, quanto manca alla ripresa. Prima di
M1 il reveal viveva dentro la card viva, con la stessa cornice e la stessa barra, e chi guardava il
telefono per tre secondi non aveva modo di capire che il lotto era finito se non leggendo.

Che siano due componenti invece di uno non intacca la permanenza: quella chiede che l'area del
lotto ci sia sempre e sia funzione pura dello snapshot, non che sia sempre lo stesso nodo React.
La scelta fra le due la fa la fase, che è nello snapshot, quindi chi rientra a metà reveal trova la
card chiusa con il countdown giusto esattamente come chi non si è mai disconnesso.

Nella card chiusa, e solo per l'owner, sotto il countdown compare «Prosegui asta». Che chi guarda
possieda l'asta non viaggia nello snapshot ma arriva come prop dalla pagina server, per la stessa
ragione del listone: non è stato di gioco, non cambia per tutta la serata, e nello snapshot
verrebbe spedito a tutti a ogni transizione. Il pulsante nascosto agli altri non autorizza niente
— `skipReveal` ricontrolla la proprietà dell'asta lato server, come sempre.

Il **modale** è un overlay sopra la card, e la frase da tenere a mente è che *non è una notifica*:
è una vista sullo stato corrente. Si apre da sé quando c'è un round aperto e sono fra gli idonei;
chiuderlo non nasconde niente perché l'offerta è a database, non nello state del componente.

### Un solo pezzo di stato locale

`dismissedLotId` è l'unica variabile del portale che non viene dallo snapshot: l'id del lotto per
cui ho chiuso il modale. Non è persistito, non è sincronizzato, e al lotto successivo diventa
irrilevante da sé perché l'id cambia — il modale si riapre da solo senza che nessuno lo resetti.

Che sia l'unica non è un aneddoto: è la forma che prende la settima regola. Non esiste da nessuna
parte una variabile "ho ricevuto l'evento X", quindi non esiste una schermata raggiungibile solo da
chi era connesso al momento giusto. Chiudere il tab e riaprirlo produce la stessa pagina — non
perché ci sia un recupero, ma perché non c'era niente da recuperare.

La conseguenza pratica è che la domanda «quale schermata devo mostrare?» è una funzione pura, e sta
in `lib/realtime/portal.ts` insieme a «quanto posso offrire?», «posso ritirarmi?», «chi è ancora
libero?». Girano in ambiente `node`, senza DOM, in millisecondi: i cinque casi di rientro di §8bis —
durante le offerte, durante lo spareggio, durante il reveal, a turno di chiamata già scaduto, ad
asta in pausa — sono **test automatici** che costruiscono lo snapshot di quell'istante e chiedono
alla funzione cosa mostrerebbe. Il collaudo a mano sui browser veri resta, ed è il cancello di fase;
ma non è più l'unico posto in cui questa logica viene esercitata.

### Il countdown, che non decide

Ogni countdown della pagina è un orologio a muro: legge la scadenza dallo snapshot, la confronta con
l'ora **del server** (`Date.now()` più l'offset ricalcolato a ogni snapshot) e scrive un numero.
Quando arriva a zero scrive "in chiusura…" e continua ad aspettare. Non chiude round, non cambia
fase, non chiama niente. Se lo snapshot successivo tarda di due secondi, il portale dice "in
chiusura…" per due secondi: è la verità, ed è preferibile a un esito inventato dal client.

La pausa ha un dettaglio che sembra un cavillo e non lo è. Il resume trasla le scadenze, ma solo al
resume: durante la pausa la scadenza a database è ancora quella di prima e un countdown ingenuo
continuerebbe a scorrere verso zero mentre l'asta è ferma. Il residuo giusto è quello che c'era
all'istante della pausa, e lo snapshot lo dice (`pausedAt`). Da lì nasce anche il resto della vista
in pausa: la fase resta quella che era — la pausa la congela, non la azzera — e le azioni sono
sospese perché il server le rifiuterebbe.

### Le scelte che vengono dal telefono

Il vincolo mobile-first di §15 non è una nota di stile, e si vede nelle forme concrete.
L'intestazione del portale è fissa e contiene **crediti e offerta massima**: `max_bid` è il numero
che decide ogni offerta — è il tetto che il server applica — e cercarlo con uno scroll mentre
restano otto secondi è il tipo di attrito che fa perdere un lotto. Il modale è uno *sheet dal
basso*, non un dialogo centrato, perché il pollice sta in basso e con la tastiera aperta la metà
alta dello schermo non esiste; countdown e `max_bid` sono nella sua intestazione, a due centimetri
sopra il campo, quindi restano visibili anche con la tastiera aperta. Il campo dell'importo è un
`type="text"` con `inputMode="numeric"` — niente spinner, inusabili col pollice — a sedici pixel,
perché sotto quella soglia iOS zooma da solo e la pagina resta zoomata per il resto della serata.
Nel layout radice `interactiveWidget: "resizes-content"` fa in modo che su Android la tastiera
rimpicciolisca la pagina invece di coprirla. Lo zoom non è bloccato: impedirlo è una scortesia
verso chi non vede bene.

Il feedback di salvataggio ha una riga fissa tutta sua, che non sposta il pulsante di conferma
quando compare. «L'ansia da *è passata?* a cinque secondi dalla scadenza è il vero problema di UX di
questa app», e la risposta è un `✓ Offerta salvata: 9` che arriva dalla risposta della `fetch`, non
dallo snapshot successivo. La distinzione conta: il verdetto sull'**invio** è immediato, il **mondo**
lo riscrive solo lo snapshot. Non c'è nessun aggiornamento ottimistico dello stato dell'asta.

Tre casi hanno un messaggio invece di un silenzio, perché sono i tre che generano discussioni in
diretta: chi riconferma la stessa cifra legge «sei già a 9: nulla è cambiato» (il timestamp resta
quello del primo invio, e nello spareggio è la posizione in coda che conta); chi ha chiamato il
giocatore legge che l'apertura a 1 è già registrata e che può solo rilanciare; e il ritiro chiede
una seconda conferma, perché è definitivo — chi si ritira non torna a offrire su quel lotto.

Le validazioni della pagina non sostituiscono quelle del server, lo anticipano: la UI disabilita il
pulsante e spiega perché, il motore rifiuta comunque con il proprio codice tipizzato. Se i due non
sono d'accordo, quello giusto è il server.

### L'unica cosa che non passa dallo snapshot

Per chiamare un giocatore serve l'elenco dei giocatori, e cinquecento righe di listone non stanno
nello snapshot: sono immutabili dall'import in poi, non contengono niente di sanificabile, e
replicarle a ogni transizione per dodici viewer moltiplicherebbe per venti il costo del canale. La
pagina le carica una volta dal server (`listPickPool`), filtrate dei fuori lista se l'asta li
esclude.

**Chi sia ancora libero, invece, resta funzione dello snapshot**: le rose ci sono dentro, e la lista
dei chiamabili è il listone meno i giocatori già assegnati. Nessuna seconda fonte di verità, e I10
resta vera — chi ricarica a metà turno vede la stessa lista di chi non si è mosso. L'ordinamento è
`fvm DESC, quot DESC`, lo stesso dell'auto-pick: il primo nome della lista è quello che il timer
sceglierebbe al posto tuo, e saperlo cambia la fretta con cui si guarda il countdown.

### La lobby, e come inizia la serata

La lobby è dove i partecipanti aspettano, e con la Fase 5 diventa il posto da cui **batte
l'heartbeat**. Non è un dettaglio implementativo: `startAuction` rifiuta l'avvio se un solo membro
non è in presence LIVE, e la presence nasce da un POST ogni dieci secondi fatto da una pagina
aperta. Senza una pagina che lo faccia, quel cancello sarebbe impossibile da passare. L'owner vede
i pallini diventare verdi uno a uno e sa quando può premere avvio.

Appena lo snapshot dice `LIVE`, il membro viene portato su `/play`. È l'unica navigazione
automatica dell'applicazione, e nemmeno lei dipende da un evento: la decisione la prende lo stato
che arriva: chi apre la lobby ad asta già iniziata viene spostato allo stesso modo, al primo
snapshot.

---

## La regia e la TV

Il portale del partecipante risponde alla domanda «quanto offro?». Ci sono altre due domande in
quella stanza, e hanno due pagine tutte loro: «posso far partire l'asta, e va tutto bene?», che è di
chi conduce, e «cosa sta succedendo adesso?», che è di tutti e si guarda alzando gli occhi verso il
televisore.

Sono la stessa applicazione vista da altri due posti. Nessuna delle due aggiunge un canale, una
query sullo stato o una seconda verità: entrambe aprono lo stesso `useAuctionStream` e leggono lo
stesso snapshot sanificato dei partecipanti. Ed entrambe sono **desktop-only** per scelta: il
vincolo mobile-first della Fase 5 nasceva dal pollice sotto pressione, e qui non c'è né pollice né
pressione — c'è un portatile sul tavolo e uno schermo in fondo alla stanza.

### La regia, su `/auctions/[id]/manage`

Solo l'owner: chi non ha creato l'asta riceve un 404, non un messaggio — di quella pagina non deve
sapere niente. Il server verifica quello e si ferma lì; il resto arriva dallo stream. Il
`public_token`, che serve a costruire il link della TV e non è recuperabile altrove, dalla v1.3.0
non passa più di qui: lo legge l'intestazione comune a tutte le sezioni dell'asta.

Il cuore della pagina è il **recap**: una scheda per squadra con crediti, speso, offerta massima e
la rosa ruolo per ruolo, tutte insieme sullo schermo. È l'informazione che a voce non si riesce a
tenere: chi ha ancora budget, chi ha la rosa quasi piena, chi non può più permettersi il portiere
che sta per essere chiamato. Lo *speso* non è un campo nuovo del protocollo ma la somma dei prezzi
della rosa, che nello snapshot c'è già; `speso + crediti = budget` è anche l'identità con cui si
vede in un colpo d'occhio che i conti tornano.

Sopra il recap ci sono i comandi, ed è qui che per la prima volta esiste un pulsante **"Avvia
l'asta"** — fino alla Fase 5 l'avvio passava dai bot o da una `fetch` scritta a mano nella console
del browser. Accanto si sceglie **da quale posto** comincia la rotazione: un pulsante per posto, con
il pallino di presence di ciascuno, perché la sera dell'asta quella decisione si prende a voce
guardando chi è collegato. Il pulsante è disabilitato finché tutti i membri non sono LIVE, ma
disabilitare non è autorizzare: `startAuction` rifà da sé la verifica, e se qualcuno cade nel mezzo
secondo fra il render e il click il rifiuto arriva dal server con il suo messaggio. È la sesta
regola, e qui si vede a occhio nudo.

Pausa e ripresa erano già nel dispatcher delle azioni dalla Fase 5, dove erano servite a collaudare
la vista congelata del partecipante: in Fase 6 sono state **collegate a due pulsanti**, non
riscritte. La pausa congela le scadenze e le trasla al resume, quindi ogni countdown riparte dal
tempo che restava e non da capo.

L'ultimo pezzo è **l'alert di chi non c'è più**. Ad asta iniziata, se qualcuno smette di battere
l'heartbeat, la regia lo dice entro quindici secondi, distinguendo chi è caduto — al suo turno
scatterà la chiamata automatica e le sue offerte si fermeranno a 1 — da chi ha solo la pagina in
secondo piano. Quello che l'applicazione **non** fa è mettersi in pausa da sola: i timer continuano
a fare il loro mestiere e la decisione di fermare tutto resta a chi conduce, che è l'unico a sapere
se quella persona è uscita dalla stanza o è andata a prendere da bere. Il banner lo scrive
esplicitamente, perché è la prima domanda che viene in mente leggendolo.

Dalla Fase 7 la regia ha anche un **pannello di correzioni**, chiuso di default perché non è roba
da usare per sbaglio: assegnazione manuale, cancellazione di un giocatore da una rosa, rettifica
dei crediti. Si spegne da solo quando c'è un lotto in contesa, e la prima cosa che scrive è che un
pulsante «annulla» non esiste. Come funziona e perché è fatto così sta nel capitolo dopo. In cima
alla pagina, accanto al badge di fase, c'è anche il download del file `.xlsx` con le rose dentro:
è un'azione della regia, non una destinazione, e per questo non è finita nella sotto-navbar.

### La TV, su `/tv/[publicToken]`

La vista proiettata **non ha login**, e il token nell'URL *è* la sua autenticazione. È la scelta
giusta per quello che è: la TV della stanza è un browser aperto una volta a inizio serata, non un
utente; chiedergli un account Google significherebbe accendere il proiettore e trovarsi davanti a
una schermata di consenso.

Quello che rende la scelta innocua sta dall'altra parte. Lo stream apre lo stesso canale di tutti,
ma `resolveViewer` assegna alla TV `viewerMemberId = null`, e `serializeSnapshot` — che è l'unico
punto da cui lo stato esce dal server — a un viewer nullo non mette dentro né `myBid` né un solo
importo di busta chiusa. **La TV non nasconde gli importi: non li riceve.** Il criterio di chiusura
della fase è esattamente questo, e si verifica leggendo il JSON: durante `LOT_OPEN` la stringa
`"amount"` nel messaggio non compare affatto, e ricompare solo in `LOT_REVEAL`, che è il momento in
cui le buste si aprono per tutti.

Questo schermo era anche il posto in cui la vecchia regola faceva più danno. Fino a v1.1.0, durante
le offerte, la TV mostrava un riquadro per squadra che si accendeva alla consegna della busta: un
tabellone delle intenzioni altrui, grande abbastanza da leggerlo da quattro metri, in mezzo a
un'asta che dovrebbe essere segreta. Adesso durante il lotto restano il giocatore e il countdown,
con una riga che dichiara il silenzio — uno schermo che non dice niente sembra uno schermo piantato,
e in una stanza «non succede niente» e «si è bloccato» hanno lo stesso aspetto. All'apertura delle
buste la TV mostra vincitore, prezzo e **tutti** i round: prima ne mostrava uno solo, l'ultimo, che
in uno spareggio significava nascondere proprio le offerte che lo spareggio l'avevano causato.

Per un anno il layout è stato governato da un posto che non era quello vero. Le misure venivano da
un conto — a 1080p su un cinquanta pollici un pixel vale circa mezzo millimetro, la leggibilità a
quattro metri chiede un carattere alto quasi tre centimetri — quindi nessun dato scendeva sotto i
trentasei pixel, e il nome del giocatore, il countdown e il prezzo stavano fra i 128 e i 144. Il
conto era giusto; l'ipotesi no. Nella pratica questa pagina sta su un portatile, a mezzo metro, e
quel vincolo produceva soltanto spreco: metà schermo per un countdown che ognuno ha già in mano,
e una classifica ridotta al totale `11/25` perché quattro frazioni per ruolo, da lontano, diventano
una riga di numerini.

Da v1.3.0 la TV **cambia natura, non scala**. Tre quarti dello schermo sono un tabellone: tutte le
squadre su due righe, ciascuna con la rosa completa, i prezzi pagati e i crediti residui. Le colonne
sono `ceil(squadre / 2)`, così otto squadre danno quattro colonne larghe e dodici ne danno sei
strette. Gli slot ancora da riempire restano **disegnati**, tratteggiati: ogni card è alta uguale
dalla prima chiamata all'ultima, la griglia non balla a ogni acquisto, e chi è indietro si vede a
colpo d'occhio. È questa l'informazione che nessuno in quella stanza può tenere a mente da solo, ed
è per questo che merita lo schermo grande.

Il quarto rimanente è il lotto in corso — giocatore, countdown, buste aperte — che resta il più
leggibile della colonna ma non più della pagina. Sopra, una striscia dice nome dell'asta, fase e —
a destra — lo **stato**: in corso o in pausa. Stato e fase non sono la stessa cosa, e la distinzione
qui è pratica: la fase cambia ogni pochi secondi, lo stato risponde alla domanda di chi alza gli
occhi e trova tutti i numeri immobili.

**La forma non cambia mai**, nemmeno nel momento più teatrale. Al reveal le buste si aprono nella
colonna mentre nel tabellone la card del vincitore si accende, col giocatore appena aggiudicato in
evidenza dentro la sua nuova rosa: l'assegnazione è già scritta quando le buste si aprono, quindi
quel nome comparirebbe lì comunque. I due lati raccontano insieme la stessa cosa — chi ha vinto, a
quanto, e com'è adesso la sua rosa — e il recap non sparisce proprio nell'istante in cui uno vuole
confrontare i crediti residui.

Due cose sopravvivono dalla versione precedente, ed è perché non dipendevano dalla distanza. Niente
hover, niente scroll, niente click: nessuna informazione può stare dietro a un'interazione, perché
chi guarda non ha un mouse. E bianco su nero **fisso**, l'unica pagina dell'applicazione che ignora
il tema di sistema, perché uno schermo condiviso non ha una preferenza e un tema chiaro in una
stanza al buio è illeggibile.

Il prezzo di questa densità è dichiarato nel file invece che scoperto la sera dell'asta: su 900
pixel di altezza ogni card ha circa 430 pixel per venticinque righe, cioè sedici pixel a riga con il
testo a undici. Ci sta, ma sotto gli ottocento pixel di altezza il tabellone non è più leggibile.
È una pagina da portatile, dichiaratamente — chi ha bisogno di più corpo fa zoom, ed è esattamente
la richiesta da cui questo lavoro è nato.

Niente di tutto questo ha richiesto una riga in più dal server: le rose erano già dentro lo
snapshot della TV, e i prezzi che si leggono nel tabellone sono assegnazioni chiuse, non offerte in
corso. `serializeSnapshot` non è stata toccata, e I8 è dove era.

---

## Le correzioni, e la memoria dell'asta

Fino alla Fase 6 l'applicazione sa fare una cosa sola: **aggiungere storia**. Un lotto, una busta,
un turno, un'assegnazione. Nessuna azione torna su ciò che è già successo, ed è quello che la rende
semplice da ragionare — lo stato di un'asta è la somma di quello che è accaduto, in ordine.

Poi arriva la sera vera. Qualcuno chiama il giocatore sbagliato, un'offerta parte con uno zero in
più, il manager si accorge che un lotto è stato aggiudicato mentre metà stanza guardava altrove.
La Fase 7 aggiunge le tre azioni che quella storia la **riscrivono**, e siccome sono le uniche di
tutto il progetto a farlo, hanno un file loro (`lib/engine/override.ts`) e tre regole che non
valgono per nient'altro.

### Niente undo, e non è una mancanza

Non esiste un pulsante «annulla l'ultimo lotto». È stato eliminato dal progetto in fase di
kickoff, ed è la decisione da cui discende tutto il resto del capitolo.

La ragione è che un undo vero avrebbe dovuto rimettere a posto anche il **turno**: ripristinare il
seat di chi aveva chiamato, il ruolo corrente, e — se quel lotto aveva fatto scattare il passaggio
al ruolo successivo — anche quello. Era la parte più fragile dell'intera specifica, e sarebbe stata
esercitata esattamente nel momento peggiore, con dieci persone che aspettano.

Al suo posto c'è una correzione in due mosse: si **cancella** il giocatore dalla rosa e lo si
**riassegna** com'era giusto. La rotazione dei turni non torna mai indietro; chi ha chiamato ha
chiamato. In cambio, quello che si corregge è esattamente quello che si vede — una rosa e un
prezzo — e si può raccontare a voce in una frase.

### Mai con le buste aperte

Le tre azioni sono rifiutate quando c'è un lotto in contesa, cioè con la fase in `LOT_OPEN` o
`LOT_TIE_PREP`. Non è prudenza generica: toccare una rosa mentre un round è aperto cambia i crediti
e l'offerta massima **sotto** a chi ha già offerto. Chi aveva messo 40 nella busta trenta secondi
fa si troverebbe l'offerta fuori tetto senza aver fatto niente, e l'esito del round dipenderebbe da
un fatto avvenuto dopo la sua decisione.

Il dettaglio che conta: il divieto guarda la **fase**, non lo stato. Mettere in pausa l'asta non
apre la porta alle correzioni, perché la pausa congela la fase invece di azzerarla. Il momento
buono è quello in cui nessuno ha una busta aperta — l'attesa della chiamata, i secondi del reveal,
l'asta ferma o finita — e in diretta significa aspettare pochi secondi, non riprogrammare la
serata.

### Mai un DELETE

Un'assegnazione annullata **resta a database**, con una colonna `voided_at` valorizzata. Una
rettifica di crediti è una riga in più in `ledger`, con dentro il motivo e chi l'ha decisa; nessun
numero viene sovrascritto.

Questo funziona perché il credito non è una colonna: è una formula, `budget_initial` più la somma
dei delta del ledger meno la somma dei prezzi delle assegnazioni **non annullate**. Marcare una
riga come annullata restituisce i crediti da sola, senza nessuna scrittura compensativa — anzi, una
riga di rimborso nel ledger conterebbe il rimborso due volte. È lo stesso motivo per cui il void
non ha invarianti da controllare: annullare restituisce almeno un credito per ogni slot che riapre
(i prezzi sono interi ≥ 1, all'asta come a mano), quindi non può mai lasciare qualcuno senza i
crediti per completare la rosa.

Il risultato è che dopo la serata non si può ricostruire solo *quanto* aveva ciascuno, ma
**perché**. È la differenza fra un archivio e un saldo.

### L'unica eccezione: buttare via l'asta intera

Da M4 un'asta si può **cancellare**, e vale la pena dire perché non contraddice quanto sopra. La
regola vieta il `DELETE` su `assignments` e `ledger` *dentro* un'asta: in un'asta viva un fatto
accaduto non si riscrive a mano, si annulla lasciandone traccia. Buttare via un'intera partita è un
atto diverso — esplicito, chiesto, e senza nessuna pretesa di correggere un numero.

Nasce da un bisogno concreto: con la simulazione, le aste di prova si moltiplicano a ogni sessione
di lavoro, e dopo dieci prove la dashboard è un elenco in cui l'asta vera sta in mezzo alle altre.
Un elenco così è il modo in cui, fra sei mesi, si clicca sulla cosa sbagliata.

Le difese sono tre. La cancellazione è **rifiutata su un'asta `LIVE` o `PAUSED`** — la pausa
congela la fase, non azzera l'asta, e non si butta via qualcosa mentre dodici persone ci stanno
dentro. Solo l'owner può chiederla. E la conferma non è un `confirm()`, che si clicca per riflesso:
**si scrive il nome dell'asta**, così chi sta cancellando la cosa sbagliata se ne accorge mentre
scrive il nome sbagliato.

Resta un fatto da guardare in faccia: su un'asta vera conclusa se ne vanno il verbale delle rose e
lo storico, perché ogni tabella ha `cascade` su `auction_id` — `events` compresa. L'unica cosa che
sopravvive è una riga su stdout, quella che si rilegge con `pm2 logs`. È scritto qui perché
quella riga è tutto ciò che resterà da leggere.

### Le tre azioni

**`manualAssign`** scrive un giocatore in una rosa senza che nessuno abbia offerto: `source =
MANUAL`, `lot_id` nullo — non c'è nessun lotto che l'abbia deciso. Controlla le stesse invarianti di
un acquisto vero, perché è l'unico modo di scrivere una rosa saltando la macchina a stati, e quindi
l'unico modo di corromperla. Un giocatore ha un solo proprietario (I2) e questo non è negoziabile;
ogni slot ancora vuoto deve restare comprabile ad almeno un credito (I3) e nemmeno questo lo è. La
sola cosa derogabile è il numero di slot del ruolo (I4), con una **forzatura** esplicita: esiste
per la sera in cui si è sbagliato a contare, e una rosa con un difensore di troppo è preferibile a
un'asta ferma.

**`voidAssignment`** cancella un giocatore da una rosa scrivendo `voided_at`. Ripeterla è un no-op,
non un errore: è il doppio click su un pulsante che intanto è sparito dalla schermata, e in diretta
un messaggio di errore su un'operazione già riuscita fa perdere dieci secondi a capire cosa sia
successo.

**`adjustBudget`** aggiunge una riga di ledger con delta, motivo e autore. Il motivo è obbligatorio,
e non per burocrazia: fra sei mesi un `−20` senza spiegazione è indistinguibile da un errore di
battitura. Una rettifica che lascerebbe un membro con meno crediti degli slot da riempire viene
rifiutata, perché quel membro non potrebbe più completare la rosa e l'asta si bloccherebbe sul suo
turno.

Tutte e tre passano da `withAuctionLock` come qualunque altra mutazione: si mettono in fila con le
offerte e con lo sweep, incrementano `state_version` e fanno partire lo snapshot. Un void deve
arrivare sui telefoni esattamente come ci arriva un'offerta — la regola 7 non ha eccezioni per le
correzioni.

Quello che **non** sono è transizioni della macchina a stati. Non hanno un istante che le fa
scattare, non spostano la fase, non producono uno stato successivo: sono scritture puntuali su due
tabelle. Le loro *regole*, invece, sono funzioni pure in `rules.ts` accanto a tutte le altre, e si
provano in millisecondi senza database.

### Un buco che la correzione stessa apriva

Aggiungere `manualAssign` ha reso raggiungibile una situazione che prima non esisteva, e che è
valsa due righe in più nel motore.

Nella rotazione normale, chi è di turno ha sempre uno slot libero nel ruolo che si sta giocando: è
`nextSeat` a dare il turno soltanto a chi ce l'ha. Ma il manager può assegnare un portiere a
qualcuno **mentre quel qualcuno sta aspettando di chiamare un portiere**. A quel punto il pick
apriva comunque il lotto, il chiamante restava fuori dagli idonei del round e la sua offerta
d'ufficio a 1 ci restava dentro: se nessun altro rilanciava se lo aggiudicava, e si ritrovava due
portieri su uno slot — l'invariante sugli slot rotta senza che nessuno avesse forzato niente.

Il rimedio segue la lettera del piano, che già diceva «chi ha il ruolo corrente pieno non è fra gli
idonei e il suo turno viene saltato»: adesso il pick di chi ha il ruolo pieno viene rifiutato, e
allo scadere del timer il turno **passa** invece di aprire un lotto che quel chiamante non potrebbe
vincere. Non è un undo, e non è il manager a muovere la rotazione: il turno va avanti, come sempre,
e a muoverlo resta soltanto il tempo.

### I due export, che rispondono a due domande diverse

L'ultima cosa che serve, la mattina dopo, è rimettere il risultato su Fantacalcio.it. Il file di
partenza non c'è più — all'import ne estraiamo i dati e lo buttiamo — quindi l'export **ricostruisce
il layout da zero**: foglio `Lista calciatori`, le quattordici colonne nell'ordine originale,
`FantaSquadra` e `Costo` riempite da chi possiede il giocatore e a quanto. Le quattro colonne che
non importiamo (l'età, le presenze, le due medie) restano celle vuote, non zeri: una cella vuota
dice «non lo so», uno zero dice «zero».

È tutto il listone, non solo le rose: chi non è stato comprato c'è comunque, con le due colonne
vuote. Il modo in cui lo verifichiamo è un giro completo: si esporta, si rilegge con **il nostro
stesso parser** dell'import e si controlla che ritrovi gli stessi giocatori con le squadre e i
prezzi giusti.

Accanto a quello, da M3, c'è un secondo file che serve a leggere invece che a ricaricare: un **CSV a
tre colonne** — nome squadra, id del calciatore, crediti spesi — con dentro **solo gli assegnati.
Nessun invenduto, nessun attributo del listone**. La differenza fra i due non è di formato ma di
punto di partenza: quello del listone parte dai giocatori, perché deve portarsi dietro anche chi
nessuno ha comprato; questo parte dalle assegnazioni, che è esattamente la differenza fra un listone
e una rosa. Convivono perché rispondono a due domande, e togliere il primo vorrebbe dire perdere la
reimportazione.

In entrambi un'assegnazione **annullata non compare**. Sono i due punti in cui il filtro «non
annullata» decide cosa finisce in un file che qualcuno guarderà altrove, e una riga sbagliata che
riapparisse lì sarebbe la correzione della sera buttata via.

Il CSV usa la **virgola** e non virgoletta niente, perché un verbale deve restare leggibile a
occhio. Questo però pretende che un nome squadra non contenga il separatore, e la scelta è stata
impedire il carattere all'ingresso invece di virgolettare all'uscita: da M3 un nome squadra non può
contenere virgole né virgolette, e il rifiuto arriva dall'unico punto in cui un nome squadra si fissa
— all'ingresso in un'asta, perché dopo non si rinomina più. Per i nomi salvati *prima* della regola,
che quindi non si possono aggiustare, il costruttore del CSV ha una rete: il carattere proibito
diventa uno spazio. Vale la pena sapere che con la virgola come separatore il file, aperto con un
doppio clic su un Excel italiano, finisce in una colonna sola: l'italiano usa il punto e virgola, ed
è il prezzo scelto per avere un formato neutro.

I download sono le uniche rotte che non passano dal dispatcher delle azioni — `GET` su
`/api/auctions/[id]/export/listone` e `/api/auctions/[id]/export/rose` — perché un file da scaricare
ha bisogno di un URL, di un tipo MIME e di un nome, e nessuna delle tre cose sta in una risposta
JSON. Sono due rotte gemelle e non una sola con un parametro: dieci righe di autenticazione ripetute
si leggono senza spiegazioni, uno smistamento no.

### La tabella `events`

Ogni transizione dell'asta scrive una riga in `events`, dall'inizio del progetto: da dove a dove,
su quale lotto, per mano di chi (o di `system`, quando è il tempo). Le correzioni ci si aggiungono
con qualche campo in più — chi ha assegnato cosa a chi, a quale prezzo, con quale motivo, se ha
forzato.

È la tabella che nessuno guarderà mai, finché non servirà. Quando qualcosa andrà storto durante
un'asta vera, sarà l'unica cosa che permetterà di ricostruire cosa è successo e in quale ordine —
ed è per questo che ogni riga viene scritta **nella stessa transazione** della mutazione che
descrive: o ci sono entrambe, o non c'è nessuna delle due. Una traccia che può mentire vale meno di
nessuna traccia. La stessa riga esce anche su stdout in JSON, ed è quella che si segue in diretta
con `pm2 logs` mentre l'asta va.

### Lo storico, la pagina che rende leggibile tutto questo

Fino a M3 quella tabella era vera e inutilizzabile: per rispondere a «io avevo offerto 46, non 45»
bisognava aprire `psql`, che nella stanza dove si sta giocando non è una risposta. Lo storico —
quinta sezione di ogni asta, su `/auctions/[id]/log` — è la pagina che risponde.

La prima cosa da capire è che **`events` da sola non basta**, e scoprirlo ha cambiato il progetto. Il
payload di una transizione è minimo: da dove a dove, su quale lotto, per mano di chi. Un `PLACE_BID`
registra *chi* e *quando*, **mai quanto** — l'importo non entra mai in `events`, ed è coerente col
resto, perché la fonte di verità di un'offerta è la riga in `bids`. Quindi la pagina si costruisce da
due sorgenti: i **lotti** dallo stato dell'asta, e `events` solo per gli **eventi notevoli**.

Da qui la forma, che è due blocchi e non una cronologia unica. Il numero che l'ha decisa: un'asta da
dodici con venticinque slot fa circa trecento lotti e **oltre duemila righe in `events`**, quasi
tutte rumore di macchina. Una lista piatta in ordine di tempo sarebbe illeggibile proprio la sera in
cui serve. Così in alto stanno i lotti, dal più recente, una riga compatta ciascuno che si apre sul
dettaglio delle buste — ogni round col suo minimo, quanti erano gli idonei, ogni offerta con importo
e orario in cui *quella cifra* è stata fissata, le ritirate, l'esito. Sotto stanno le correzioni e le
pause: avvio, pausa, ripresa, «prosegui asta», assegnazioni manuali, annullamenti, rettifiche di
crediti. Fuori resta la routine di un lotto, che il dettaglio del lotto racconta meglio.

Due dettagli valgono più di quanto sembri. **L'esito di ogni round lo scrive la stessa funzione che
ha deciso l'asta** quella sera: ricopiare quel ragionamento nella pagina vorrebbe dire tenere due
verità su come si vince un lotto, e in una disputa la seconda non servirebbe a niente. E **un tipo di
evento sconosciuto viene mostrato comunque**, in forma tecnica, invece di essere ignorato: la lista
consultata è quella della routine da escludere, non quella dei tipi noti da includere, così un evento
aggiunto fra un anno comparirà da sé. Un log che nasconde ciò che non sa interpretare è un log di cui
non ti fidi.

La pagina la vedono **l'owner e i partecipanti**, e non solo l'owner. Chi vuole contestare un lotto
deve poterlo guardare da sé; e c'è una ragione d'invariante, la I10 — le buste non si rivedono da
nessun'altra parte dopo i secondi di reveal, tanto meno se è stato premuto «prosegui asta», che quei
secondi li salta. Chi non partecipa prende un 404 e non un «vietato»: l'esistenza di un'asta a cui
non partecipi non è una sua informazione.

È **renderizzata dal server a ogni caricamento, senza stream**, e questo non è un risparmio: lo
storico non è lo stato dell'asta, quindi non passa dall'unico punto di uscita dello stato e non ha
nulla da ricevere in diretta. Per la stessa ragione in cima c'è l'ora della lettura — in una disputa
l'età di ciò che stai leggendo è essa stessa un'informazione — con un pulsante per rifare la lettura,
invece di un aggiornamento automatico che sposterebbe sotto gli occhi la riga che stai guardando. Gli
orari si leggono in ora italiana, fissata nel codice e non lasciata al fuso del telefono di chi
guarda: le persone che discutono di un lotto sono nella stessa stanza e devono leggere lo stesso
numero.

#### Il punto delicato: le buste di un lotto ancora aperto

È il rischio vero della pagina. Mostrare le buste del lotto in contesa violerebbe l'invariante della
segretezza, e con il rafforzamento di M1 lo violerebbe anche solo dicendo che una busta è stata
consegnata. Il dato è tutto lì, in memoria, a un passo dall'uscita.

La barriera **riusa il confine del motore invece di inventarne uno**: entrando nella fase di reveal,
la macchina scrive che il lotto è risolto — nello stesso istante in cui le buste si aprono e
l'assegnazione viene committata. Quindi «lotto risolto» equivale a «buste già state pubbliche», per
costruzione e non per attenzione, e un lotto aperto non arriva mai alla pagina, nemmeno come riga
vuota. Ad asta in pausa vale gratis, perché la pausa congela la fase e non azzera lo stato del lotto.
Quando l'asta è in corso la pagina **dice** che il lotto corrente non compare, invece di lasciar
notare un buco.

C'è una coda a questa storia che vale più della storia stessa. Il test che doveva dimostrare tutto
questo **passava anche togliendo la barriera**: la funzione che compone una riga scarta comunque i
lotti senza vincitore, e un lotto aperto non ne ha. L'asserzione non stava dimostrando ciò che diceva
di dimostrare, e l'abbiamo saputo solo perché la barriera è stata rotta di proposito per vedere il
test diventare rosso. Ne sono uscite due cose: le due protezioni restano **entrambe**, perché si
coprono a vicenda soltanto per una coincidenza di come il motore è fatto oggi, e affidare un
invariante a una coincidenza non è affidarlo; e il predicato è stato spostato in un modulo puro, dove
si può provare su un lotto costruito a mano che sia aperto *e* abbia già un vincitore — uno stato che
il motore non produce mai, e proprio per questo l'unico capace di distinguere quel controllo da tutti
gli altri. Un guardiano che non sai se sta guardando non è un guardiano.

### Un id sbagliato non è un errore del server

Chiude la fase una piccola cosa annotata durante il collaudo della Fase 5. Un URL come
`/api/auctions/undefined/action` — che nessuna pagina genera, ma che una `fetch` scritta a mano
produce al primo copia-incolla sbagliato — mandava la stringa fino a Postgres, che la rifiutava con
un'eccezione: un **500**, cioè la risposta che l'applicazione riserva ai propri bug. Ma un'asta che
non esiste è un rifiuto come gli altri, e ogni rifiuto ha un codice tipizzato.

La guardia sta nei due imbuti da cui passa tutto — `withAuctionLock` per le azioni e `resolveViewer`
per lo stream e l'heartbeat — più le letture che le pagine fanno con l'id preso dall'URL. Difendere
l'imbuto invece dell'ingresso è ciò che fa valere la regola anche per la prossima rotta che
qualcuno aggiungerà.

---

## Il posto dove gira

Tutto quello che hai letto finora vive su **una macchina sola**, ed è la conseguenza pratica della
scelta raccontata all'inizio: un processo Node persistente, con i timer in memoria e il registro
delle connessioni SSE in una variabile globale, non si può spalmare su più server senza
smontarlo. La topologia è quindi la più semplice possibile, e non è un ripiego — è ciò che rende
la concorrenza governabile da un `SELECT … FOR UPDATE`.

```text
        internet
            │  https
            ▼
     ┌──────────────┐
     │    nginx     │  certificato Let's Encrypt, proxy_buffering off sullo stream
     └──────┬───────┘
            │  http, 127.0.0.1:3000
            ▼
     ┌──────────────┐
     │   Node       │  un processo, sotto pm2 (fork, 1 istanza)
     │   Next.js    │  · lo scheduler: sweep ogni secondo + timer armati
     │   standalone │  · il registro delle connessioni SSE
     └──────┬───────┘
            │  socket locale
            ▼
     ┌──────────────┐
     │ PostgreSQL16 │  stessa macchina: nessuna latenza di rete nel lock
     └──────────────┘
```

Una CX22 di Hetzner: due vCPU, quattro gigabyte, circa quattro euro al mese. Il processo ne usa
centocinquanta megabyte, un'asta intera a otto produce milleduecento righe in `events` e il dump
compresso dell'intero database sta in centoventitré kilobyte. Il dimensionamento non è stato un
problema per un solo istante, ed è esattamente ciò che ci si aspetta da dodici persone in una
stanza per due ore all'anno.

### Perché il processo va avviato in un modo preciso

`output: 'standalone'` produce una cartella autoconsistente con dentro un `server.js` e le sole
dipendenze che servono davvero. Due cose di quel formato hanno conseguenze che si pagano in
produzione e in nessun altro posto.

La prima: **`.next/static` e `public/` non ci finiscono dentro**. Vanno copiati a mano accanto al
bundle, e se non lo fai la pagina si carica ma senza CSS e senza idratazione — il che significa
che il portale resta fermo sulla scritta «Mi collego all'asta…», nessuno stream parte, e il
sintomo sembra un problema di realtime mentre è un file mancante. È il motivo per cui lo script di
deploy fa quella copia e poi **verifica di averla fatta**, fallendo il deploy se il CSS non è al
suo posto: un errore rumoroso al momento giusto vale più di dieci minuti di diagnosi al momento
sbagliato.

La seconda: `server.js` fa `process.chdir(__dirname)` e gira quindi con la working directory
dentro `.next/standalone`, dove **non esiste nessun `.env`**. Le variabili d'ambiente non possono
arrivare da lì, e devono essere passate dall'esterno: se ne occupa `deploy/ecosystem.config.cjs`,
il file di configurazione di pm2, che legge il `.env` della radice con un parser di dieci righe e
lo consegna al processo aggiungendo `NODE_ENV`, `HOSTNAME=127.0.0.1` e `TZ=UTC`. Il file è
committato e non contiene nessun segreto: la password del database resta scritta in un posto solo.
Se manca una delle cinque variabili del piano, pm2 non parte affatto — meglio un errore all'avvio
che un login che gira a vuoto la sera dell'asta.

Dentro quel file c'è una riga che vale la pena non toccare mai: `exec_mode: "fork"` con
`instances: 1`. In cluster mode pm2 avvierebbe una copia del processo per core, e **ogni copia
eseguirebbe `instrumentation.ts`**: due sweep che fanno avanzare la stessa asta, cioè il bug
contro cui esiste la guardia `globalThis.__scheduler`, riprodotto in produzione a comando. Il
lock e l'invariante di versione lo renderebbero probabilmente innocuo, ma "probabilmente innocuo"
non è il modo in cui si conduce un'asta.

### nginx, e l'unica riga che conta

Davanti al processo c'è nginx, che termina il TLS e inoltra tutto a `127.0.0.1:3000`. La
configurazione è quella standard di Ploi con **due `location`** al posto di quello che serviva un
sito statico, e la differenza fra i due è tutta in una manciata di righe: sulla rotta dello stream
il buffering è spento.

Senza `proxy_buffering off`, nginx accumula la risposta e la consegna a blocchi. Su una risposta
normale non lo noteresti; su un canale che manda uno snapshot per transizione significa che gli
aggiornamenti arrivano a gruppi e i countdown dei partecipanti si muovono a scatti di trenta
secondi. È il tipo di guasto peggiore, perché l'applicazione *sembra* funzionare. La difesa è
doppia di proposito: l'app manda anche `X-Accel-Buffering: no` sulla risposta dello stream, e
nginx quell'header lo rispetta. Una protegge dal giorno in cui Ploi rigenererà la configurazione
del sito, l'altra dal giorno in cui un refactoring toglierà l'header.

La prova che tutto questo funziona non è una lettura della configurazione ma una misura:
aprendo lo stream da fuori e marcando ogni riga con l'ora in cui arriva, si vede lo snapshot al
secondo zero e i `: ping` a quindici e a trenta. Col buffering attivo arriverebbero tutti insieme
alla chiusura della connessione.

### Il deploy

Un push su `main` fa partire un webhook di GitHub verso Ploi, che esegue `deploy/deploy.sh` sul
server. Lo script è in git accanto al codice che deploya — non nel pannello di un servizio — così
la procedura è versionata insieme a ciò che installa, e in Ploi resta una riga sola che la
richiama.

L'ordine è: rifiutare di partire se un'asta è viva, allineare il codice con `git reset --hard`,
installare, compilare, copiare gli asset statici, ricaricare pm2. Due dettagli meritano una nota.
`pnpm install` usa `--prod=false` perché `next build` ha bisogno di TypeScript, Tailwind ed
eslint-config-next, che stanno tutti in `devDependencies`: senza quel flag la build muore sul
primo import di Tailwind, ed è il classico "in locale funziona". E `pnpm db:push` **non c'è**: lo
schema si applica a mano, perché `drizzle-kit` gira senza chiedere conferme e una modifica di
schema che parte da sola mentre otto persone stanno offrendo è un rischio che non ha nessun
contrappeso.

La guardia sull'asta viva merita di essere spiegata, perché a prima vista è ridondante: il riavvio
in sé è innocuo, lo stato è tutto a database e il boot recovery riprende in un attimo. Ma la build
avviene **sul posto**, dura due minuti, e per quei due minuti il processo in esecuzione legge file
da una cartella che si sta riscrivendo. Non è la fine del mondo; è agitazione gratuita nel momento
peggiore. Per questo lo script si ferma con `LIVE` o `PAUSED` — e `PAUSED` è compreso di proposito,
perché è lo stato in cui l'owner mette l'asta *mentre sta risolvendo un problema*.

### I bot, in produzione

Il collaudo che chiude il cerchio è un'asta completa a otto giocata sul server vero, e a giocarla
sono i bot. Ma i bot si autenticavano col provider `dev`, che in produzione non esiste per
costruzione — e non sarebbe bastato aggiungere un interruttore, perché il server standalone di
Next imposta `NODE_ENV=production` da sé prima che il nostro codice possa dire la sua.

La soluzione è che i bot **si firmano da soli il cookie di sessione**. La sessione di questa
applicazione è un JWT cifrato e la chiave è `AUTH_SECRET`; chi ha quel segreto — il server, e lo
script che legge lo stesso `.env` sulla stessa macchina — può emetterne uno valido. Non è una
scorciatoia nell'autenticazione: **all'applicazione non è stato aggiunto nessun modo di entrare**,
e chi possiede `AUTH_SECRET` possiede già tutto. In cambio il cammino di codice è uno solo, identico
in sviluppo e in produzione, il che è precisamente la proprietà che si vuole da uno strumento di
collaudo: ciò che funziona in prova funziona la sera dell'asta.

L'unica differenza fra i due ambienti la fa il nome del cookie, che Auth.js prefissa con
`__Secure-` quando l'app gira in https — e siccome quel nome è anche il *salt* della derivazione
della chiave, sbagliarlo produrrebbe un token che il server scarta in silenzio. Per questo lo
script, appena firmato il cookie, lo prova subito contro `/api/auth/session`: un errore
comprensibile in partenza invece di una sfilza di 401 a metà asta.

### Il tempo, i backup, e cosa si vede

Il server gira in **UTC**, e non solo la macchina: anche il processo, perché la variabile è fissata
nella configurazione di pm2 e non dipende da cosa dice il sistema operativo. Ogni orario nel
database e nei log è quindi UTC, e la conversione a `Europe/Rome` avviene soltanto quando un
numero viene disegnato su uno schermo. È una regola noiosa che si ripaga da sola la prima volta che
qualcuno confronta due timestamp.

Ogni notte un `pg_dump` comprime l'intero database in `~/backups` e tiene gli ultimi quattordici.
Il formato è SQL semplice gzippato e non il formato `custom` di Postgres, per una ragione poco
tecnica: un dump che si legge con `zless` e si ripristina con `psql` è un dump che riesci a usare
alle undici di sera senza rileggere il manuale. Accanto c'è uno script che il backup lo **prova**:
ripristina l'ultimo dump su un database separato, conta le righe e verifica che sulle rose
ripristinate valga ancora l'invariante I2 — nessun giocatore assegnato due volte. Un backup che si
ripristina ma con una rosa incoerente non è un backup buono, e la differenza si vede solo
controllando.

Della serata, infine, resta una traccia doppia. Su `stdout` — cioè in `pm2 logs asta`, che l'owner
tiene aperto su un terminale per tutta la durata — scorre una riga per transizione, e leggerle in
diretta è il modo più immediato di sapere a che punto è l'asta. A database, la tabella `events`
conserva le stesse transizioni per sempre: milleduecentosessanta righe per un'asta a otto, ed è lì
che si va a guardare quando qualcuno chiede «ma quel portiere a quanto era andato?».

---

## Cosa non c'è ancora

Con la Fase 8 l'applicazione è completa e vive su un indirizzo pubblico. L'unico pezzo rimasto
fuori dal piano è l'area `/admin` — l'elenco di tutte le aste e di tutti gli utenti per chi ha il
flag di amministratore: è comoda, non serve a giocare.

Restano poi le cose che un'applicazione usata **una sera all'anno** può permettersi di non avere, e
vale la pena che siano una scelta consapevole invece di una dimenticanza. Non c'è alta
disponibilità: se la macchina muore durante l'asta, si riparte da un backup su una macchina nuova,
e nel frattempo l'asta è ferma. Non c'è un ambiente di staging: la prova generale si fa in
produzione con i bot e poi si cancella, che per questo progetto è più onesto — collauda la macchina
vera. E non c'è nessun monitoraggio automatico: il controllo è un umano che guarda `pm2 logs` con
dieci persone intorno, ed è il monitoraggio con il tempo di reazione più breve che ci sia.

---

## Come questo progetto cresce, da qui in avanti

Tutto quello che hai letto fin qui è stato costruito in nove fasi, fra il 6 e il 9 agosto 2026,
seguendo una specifica scritta prima di iniziare — `docs/PLAN.md` — e un elenco di task —
`docs/BACKLOG.md`. Quei due documenti sono ancora nel repository, ma sono archivio: raccontano
come si è arrivati a v1.0.0, non cosa succede adesso. Il che non li rende innocui da ignorare:
gli invarianti numerati di `PLAN.md` restano la specifica del motore, e valgono oggi come il
primo giorno. Congelato vuol dire che non cresce più, non che non conta più.

Adesso il progetto cresce per **macro-feature**. Una macro è un tema coerente abbastanza da
giustificare un branch e un merge in produzione: «rendere segrete le offerte finché il lotto è
aperto» è una macro, «cambiare il colore di un bottone» no — quella vive dentro la macro aperta,
o aspetta la prossima. Ogni macro ha un file in `docs/features/`, che contiene nello stesso posto
la spec e i task: quando lo riapri fra sei mesi trovi in un documento solo cosa doveva fare e
cosa è stato fatto, senza dover incrociare due file che nel frattempo hanno preso strade diverse.

Le richieste arrivano da `docs/REQUESTS.md`, il quaderno dove l'owner annota cosa vorrebbe
cambiare mentre usa l'app. Nel momento in cui una richiesta viene pianificata dentro una macro,
sparisce dal quaderno: il contenuto raffinato vive nel file della feature, e il quaderno resta la
lista di ciò che non è ancora stato deciso. È una regola contro la ridondanza — due copie della
stessa richiesta divergono sempre, e quando divergono non sai più quale delle due è la verità.

Il codice viaggia su tre branch: `main` è la produzione e ogni push fa partire il deploy, `dev` è
dove le macro si integrano e si provano in locale, e ogni macro ha il suo `feature/NN-nome`. Non
c'è un ambiente di staging, per la stessa ragione descritta nel capitolo precedente: la prova si
fa in locale con i bot e il telefono, e la prova generale vera si fa in produzione. Le versioni
sono tag semantici — una macro in produzione è un minor, un hotfix è una patch — e `CHANGELOG.md`
dice, versione per versione, cosa è cambiato per chi usa l'app. Il valore vero dei tag è il
rollback: `git reset --hard v1.2.0` sul server è più rassicurante che cercare uno sha nei log
mentre dieci persone aspettano.

Una sola cosa di questo meccanismo può fare male davvero, ed è bene saperla prima che succeda: il
deploy **non** applica lo schema al database. Se una macro tocca `lib/db/schema.ts`, portarla su
`main` mette in produzione del codice che interroga colonne che ancora non esistono. Per questo
ogni file di feature dichiara in testa se tocca lo schema, e `CLAUDE.md` porta la procedura con
l'ordine giusto. Non è una dimenticanza: è la stessa scelta descritta più sopra, quella per cui
`drizzle-kit` non deve poter modificare un database da solo mentre un'asta è in corso.

C'era, fino a v1.0.0, un `docs/RUNBOOK.md` che raccoglieva queste procedure insieme alla guida
che ha accompagnato la build fase per fase. È stato eliminato in v1.1.0 perché la metà che serviva
durante la costruzione non serve più, e tenere in vita un documento per metà obsoleto è il modo
migliore per non fidarsi più nemmeno dell'altra metà. Quello che il flusso di sviluppo richiede
davvero è passato in `CLAUDE.md`; il resto — le tre password del server, la checklist pre-asta,
la tabella degli incidenti misurati, come rifare la macchina da zero — resta leggibile con
`git show v1.0.0:docs/RUNBOOK.md`, che è esattamente il genere di cosa per cui i tag esistono.
