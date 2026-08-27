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

`fixtures/` sono i materiali che arrivano da fuori e che non vengono serviti a nessuno: i fogli del
listone, l'HTML dei rigoristi, e il PNG sorgente dell'icona. Non è una cartella di asset — è il posto
dove sta l'originale di qualcosa che nel progetto entra in un'altra forma.

L'ultima cosa che si vede prima ancora della pagina è **l'icona nella linguetta**, e sono tre file in
`app/`: `favicon.ico` con tre misure dentro (16, 32, 48), `icon.png` a 512, e `apple-icon.png` a 180
**senza canale alpha** — iOS non rispetta la trasparenza, la riempie di nero da sé, quindi
l'appiattimento lo si decide qui invece di subirlo. Next li trova per convenzione di nome e genera i
`<link>` da sé: **non c'è nessun `metadata.icons` scritto a mano**, ed è di proposito, perché sarebbe
una seconda sorgente di verità da tenere allineata a mano. I tre file sono **committati**, non generati
in build. La ricetta che li ha prodotti sta in `scripts/genera-icone.py`, che non è chiamato da niente:
vuole Python e Pillow, che non sono e non devono diventare dipendenze del progetto.

⚠ **In produzione l'ICO non viene servito, e non è un guasto da riparare.** Il server block che Ploi
genera contiene un `location = /favicon.ico` del suo boilerplate, che nginx risolve dal disco: con
`output: 'standalone'` quel file sul disco non esiste — sta in `app/` e lo serve l'applicazione —
quindi nginx risponde 404 di suo e la richiesta non arriva mai a Node. È così da sempre, anche con il
`favicon.ico` che Next.js metteva in un progetto nuovo, e il rilascio dell'icona l'ha solo reso visibile.
L'effetto pratico è piccolo: l'icona in linguetta si vede comunque, perché il browser scende al `<link>`
successivo e prende `icon.png` ridimensionandolo da sé, e iOS prende `apple-icon.png`. Si perde solo la
resa a 16/32/48 preparata a mano. La decisione di lasciarlo così è dell'owner (2026-08-18), e la
correzione — cancellare quel blocco dalla configurazione di Ploi — sta scritta in
`deploy/nginx-asta.conf` insieme al perché non si può semplicemente aggiungerne uno nostro.

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

### Due strade, e una riga sola

Fino a v1.5.0 si entrava soltanto con Google, ed era stata la scelta giusta per arrivare in
produzione: nessuna password da custodire, nessuna email da mandare, nessun recupero da progettare.
Ma pretendeva che ogni partecipante avesse un account Google e fosse disposto a usarlo qui — e la
sera dell'asta la persona che non ce l'ha non è un caso di studio: è un amico in piedi accanto alla
TV che non riesce a entrare. Da M5 esiste la seconda strada, **email e password**, con l'indirizzo
confermato da un codice a sei cifre.

Il grosso del lavoro, però, non è stata la registrazione. È stato **tenere una persona su una riga
sola**. Nel momento in cui esistono due porte, la stessa persona può presentarsi a entrambe con lo
stesso indirizzo, e un'applicazione che glielo consente si ritrova due utenti, due dashboard, e
un'asta appesa a quello sbagliato — cioè, dal punto di vista di chi la sta usando, un'asta sparita.

La soluzione è che **l'email è la chiave d'identità**, e che il vincolo non sta nel codice: sta nel
database, come un indice `UNIQUE` su `lower(email)`, parziale su `email IS NOT NULL` perché le
righe senza indirizzo — i bot — restano legali. È la stessa logica degli indici parziali di I1 e I2:
se una regola si può rendere *impossibile* invece che sorvegliata, si rende impossibile. Il giorno
in cui un `if` è sbagliato, Postgres rifiuta comunque. La normalizzazione è `trim` e `lower` e
nient'altro: niente punti tolti a Gmail, niente `+tag` scartato, perché sono convenzioni di un
provider e indovinarle vorrebbe dire trattare due indirizzi diversi come lo stesso.

Il login Google cerca quindi prima per `google_sub`, poi per email, e **si aggancia**: se trova una
riga con quell'indirizzo le scrive dentro il `google_sub` invece di crearne una seconda. L'aggancio
è lecito perché Google asserisce `email_verified` — e se quella asserzione manca, il login viene
rifiutato del tutto, perché agganciare su una prova debole vale meno che chiudere la porta.

C'è un dettaglio che sembra un cavillo e non lo è: **l'email non si riscrive più a ogni login**.
Prima di M5 veniva aggiornata ogni volta dal profilo Google. Con il `UNIQUE` addosso, il giorno in
cui un account Google cambia indirizzo verso uno già preso da un'altra riga quell'`UPDATE`
fallirebbe, e il login diventerebbe un 500 senza spiegazione. Si scrive alla creazione e
all'aggancio, poi si lascia stare.

### L'aggancio è asimmetrico, e la direzione conta

Da email+password verso Google **sì**: si aggancia il `google_sub` alla riga che c'è già, e da quel
momento due strade portano allo stesso account. Da Google verso email+password **no**: chi prova a
registrarsi su un indirizzo che ha già un `google_sub` viene rifiutato con un messaggio che gli dice
di entrare da dove è sempre entrato.

Il rifiuto nella seconda direzione tiene vera una frase semplice — *un account nato da Google entra
da Google* — e risparmia per sempre la domanda «cosa succede se cambio la password di un account
Google». Aggiungere una password a un account Google esistente sarebbe un reset travestito; se un
giorno lo si vorrà, lo si vorrà dichiarato.

### La regola che chiude un furto d'account

Questa è la parte meno ovvia di tutta l'autenticazione, e va letta due volte. Aprire la prima
direzione **da sola** aprirebbe un attacco:

1. Un malintenzionato scrive **il tuo** indirizzo su `/signup`, con una password sua.
2. Non inserisce il codice: non gli arriva, e non gli serve. La riga esiste, non verificata, col suo
   hash dentro.
3. Tu entri da Google con quell'indirizzo. L'applicazione ti aggancia a quella riga — che è
   esattamente ciò che deve fare.
4. Da quel momento **lui ha la tua password**. Ha fatto la parte facile e ha lasciato a te quella
   difficile.

La regola che lo chiude sta in `hookGoogleTo`, in `lib/engine/accounts.ts`: **un aggancio su una
riga non verificata azzera `password_hash`**, e consuma i codici ancora vivi. Chi entra da Google ha
dimostrato di controllare quella casella; quella password l'ha scritta qualcuno che non ha
dimostrato niente, e non ha nessuna pretesa. Se l'avevi messa tu non perdi nulla che non puoi
rifare: da quel momento entri da Google, e la rimetti da «Password dimenticata». Se invece la riga
**era già verificata**, la password resta — le due prove ci sono entrambe, e restano entrambe le
strade.

Nel codice l'attacco è scritto per esteso accanto alla regola, e nei test ha due casi suoi (riga non
verificata, riga verificata) in `tests/db/accounts.test.ts`. Non è zelo documentale: una regola
senza il suo attacco accanto è una riga che il prossimo semplifica, e semplificarla riaprirebbe il
furto senza che nessun test verde se ne accorga — perché i test verdi resterebbero verdi solo se
qualcuno li ha scritti prima.

### La scala di `requireUser()`

La guardia che ogni pagina autenticata chiama fa tre gradini, in quest'ordine:

```
sessione?   no → /signin
verificato? no → /verify
ha un nome? no → /onboarding
                → la pagina
```

Il gradino di mezzo è di M5, e la sua posizione è deliberata: **la verifica viene prima
dell'onboarding** perché non si raccoglie il nome di qualcuno per un indirizzo che potrebbe non
esistere. Tenerla dentro la scala, invece di farne un flusso a parte con un token suo, ha una
conseguenza pratica che vale da sola la scelta: a quel punto **una sessione esiste già**, quindi il
reinvio del codice è una server action autenticata invece di una rotta pubblica da proteggere a
mano, e i limiti sono per persona perché *c'è* una persona.

L'accesso è **rigido**: chi non è verificato non fa nulla. Non crea aste, non entra su invito, non
gioca. Per una versione questo ha avuto un prezzo dichiarato — se a un amico l'email non arriva,
l'unico rimedio è una `UPDATE` sul server, scritta per esteso in `docs/features/05-identita.md` §9
perché alle nove di sera si copiasse invece di comporla. Da M6 quel rimedio è un pulsante nel
pannello di amministrazione, e funziona proprio perché il gradino non ha eccezioni: scrivere la
colonna *è* passare la scala. Il seguito sta nel capitolo sul pannello, insieme a ciò che quel
pulsante spegne.

C'è una sola scorciatoia, e vale la pena saperla perché è quella che tiene in piedi
`requireAppAdmin()`: la guardia del pannello **non** scavalca la scala, la attraversa per intero. Un
amministratore non verificato è un utente non verificato.

Chi entra con Google non ha ancora un nome nell'applicazione. Questo è deliberato: il profilo
Google avrebbe un `name`, ma l'app **non lo copia**. Al primo login la riga `users` nasce con
`display_name` vuoto, e la guardia manda l'utente su `/onboarding` e non lo lascia andare altrove
finché non ha scritto nome e cognome. Il nome Google serve solo a precompilare il campo. Perché non
prenderlo e basta? Perché il requisito è che l'utente lo *confermi*: in un gruppo di amici il
profilo Google si chiama spesso "Ale" o "iPhone di Marco", e sul tabellone proiettato in TV serve un
nome riconoscibile. Il nome della **squadra** è un'altra cosa ancora, e si sceglie quando si entra
in una specifica asta.

Il form di registrazione, di conseguenza, chiede **solo email e password**. Il nome continua a
scriversi nell'unico posto in cui si è sempre scritto: due schermate che chiedono la stessa cosa
sono due schermate che prima o poi dicono cose diverse.

Il controllo è una guardia server-side nelle pagine, non un middleware. Un middleware Next girerebbe
su runtime edge, dove il driver Postgres non esiste, e per farlo funzionare bisognerebbe spezzare
la configurazione di Auth.js in due file. La guardia nelle pagine ottiene lo stesso risultato
osservabile senza quella complicazione. Il prezzo è che la scala vale **solo per chi ci passa**:
tre pagine usano `currentUser()` invece di `requireUser()` perché la scala la stanno
*implementando* — `/signin`, `/verify`, `/onboarding` — più la radice, che smista, e la navbar, che
disegna. Le rotte API usano anch'esse `currentUser()`, e lì è giusto: a una richiesta `fetch` non si
risponde con un redirect.

### Il codice a sei cifre, e il recupero della password

Una tabella sola, `email_codes`, per due scopi: confermare un indirizzo e cambiare una password. I
due `purpose` — `VERIFY_EMAIL` e `RESET_PASSWORD` — stanno in `lib/domain.ts` col resto del
vocabolario, non nello schema.

Il codice a database è uno sha256, e va detto subito **cosa non è**: con sei cifre l'entropia è un
milione, quindi chi ha in mano il database rompe l'hash in un secondo. Non serve a difendere il
codice. Serve a non lasciare credenziali vive dentro un `pg_dump`, in una riga di log, nello
screenshot di una tabella aperta per guardare altro. Le difese vere sono quattro, e sono tutte
banali:

| Difesa | Valore | Perché |
|---|---|---|
| Scadenza | 15 minuti | Dieci sono tirati se la posta arriva lenta, trenta sono generosi per sei cifre |
| Tentativi | 5, poi il codice è bruciato | È **questa** la sicurezza dello schema: con cinque prove, indovinarne uno su un milione non si fa |
| Un solo codice vivo per `(utente, scopo)` | chiederne uno nuovo consuma il precedente | Venti reinvii non devono diventare venti chiavi valide |
| Reinvio | 60 secondi fra due invii | Non trasformare il server in un cannone di posta puntato sull'indirizzo di qualcuno |

L'ultima difesa è la più economica di tutte: **si legge dal `created_at` dell'ultima riga**, quindi
è un rate limit che vive nel database e sopravvive a un riavvio del processo. Alcuni limiti sono
gratis perché il fatto è già registrato.

Le **decisioni** — scaduto? bruciato? può reinviare? — non stanno insieme alle query. Stanno in
`lib/engine/account-rules.ts`, che non importa niente e riceve `now` come parametro, esattamente
come il motore dell'asta. È la regola 2 applicata per analogia, e serve a una cosa sola: «il codice
scade dopo quindici minuti» costa una riga di test coi fake timer, invece di quindici minuti di
attesa vera a ogni `pnpm test`.

Nessun rifiuto è un vicolo cieco. Scaduto, sbagliato, bruciato: qualunque cosa dica il messaggio, il
pulsante «mandamene un altro» è nella stessa schermata, e l'account non verificato resta dov'è —
non si perde niente, e chi aveva già scritto la password non la riscrive.

Il recupero usa la stessa macchina con l'altro `purpose`, e **un codice, non un link**: niente token
negli URL da farsi inoltrare per sbaglio, e una schermata in meno da scrivere. `/forgot` chiede
l'indirizzo, `/reset` chiede codice e password nuova. Funziona solo se una password esiste già: un
account di solo Google che chiede «password dimenticata» non se la vede creare dal nulla, perché
sarebbe la direzione Google → password per un'altra strada. Ed è anche l'unico modo di *cambiare* la
propria password: non esiste una schermata «cambia password» dentro l'applicazione, perché sarebbe
una seconda macchina per fare ciò che questa già fa.

Due limiti noti, scritti invece che scoperti. Il primo: un reset **non invalida le sessioni già
aperte altrove**, perché le sessioni sono JWT e non righe a database — revocarle vorrebbe dire una
colonna `sessions_valid_from` e un controllo nel callback `jwt`, complessità reale per una minaccia
che, con dodici amici e il dato «chi ha pagato Lautaro 180», non la giustifica. Il secondo:
**dall'enumerazione degli account non ci si difende**. «Questo indirizzo è già registrato con
Google» è una frase utile a chi la legge, e ciò che protegge un account non è il silenzio: è la
password.

### La password, e perché scrypt e non bcrypt

`lib/engine/password.ts`, senza nessuna dipendenza nuova: `crypto.scrypt` sta nella libreria
standard di Node. La ragione per cui non è `bcryptjs` è **il processo unico**. `bcryptjs` è
JavaScript puro: mezzo secondo di CPU per hash, che l'event loop si mangia a fette. `crypto.scrypt`
è nativo e asincrono, gira sul threadpool di libuv, e non blocca il loop. In un'applicazione che
tiene aperti dodici stream SSE mentre scorre un countdown, mezzo secondo di loop bloccato è mezzo
secondo in cui nessuno riceve uno snapshot — cioè, in diretta, mezzo secondo in cui l'asta sembra
rotta.

I parametri sono N=2^15, r=8, p=1: circa 32 MB e un decimo di secondo per hash su una CX22. N=2^16
sarebbe più robusto e costerebbe il doppio di memoria per hash concorrente; col rate limit davanti
al login, 2^15 è la misura giusta per una macchina da 2 vCPU. Il valore memorizzato ha la forma
`scrypt$N$r$p$salt$hash`, cioè **i parametri viaggiano col valore**: alzarli domani non invalida gli
hash di ieri, perché ogni hash sa con cosa è stato prodotto. Il confronto è con `timingSafeEqual`,
mai con `===`.

La politica è lunghezza e basta, fra 10 e 200 caratteri, nessuna regola di composizione. È la
raccomandazione corrente — la lunghezza vale più dei simboli obbligatori — ed è una cosa in meno
contro cui combattere alle nove di sera dal telefono di qualcun altro.

### L'invio delle email, e il rate limit

`lib/mail.ts` è `nodemailer` sopra un SMTP generico, oggi quello di MailerSend. Generico e non
l'SDK del provider: cambiare fornitore deve essere cambiare quattro variabili in `.env`. È l'unica
dipendenza esterna che questo progetto abbia mai preso, e ha un timeout di dieci secondi, perché è
una chiamata di rete dentro una richiesta HTTP in un processo solo.

**A decidere se si manda o si stampa è la presenza di `SMTP_HOST`.** Senza, il codice va sullo
stdout del dev server: è la stessa forma del provider `dev`, e ha lo stesso effetto — chi clona il
progetto collauda l'intero flusso di registrazione senza avere nessuna credenziale. Con `SMTP_HOST`
si manda davvero anche in locale, e serve a una cosa che la regola originale rendeva impossibile:
**verificare le credenziali del provider prima del deploy**, invece di scoprire la sera dell'asta
che il mittente non sta sul dominio verificato.

Su due punti la presenza della variabile non conta. **In produzione si manda sempre**, e un `.env`
mal configurato fa fallire l'invio invece di ripiegare sullo stdout — altrimenti i codici finirebbero
nei log del server, e in produzione l'unico modo di leggere un codice dev'essere la casella di posta.
**Sotto test non si manda mai**: `vitest` carica lo stesso `.env` dell'applicazione, e senza quel
blocco un test scritto senza mock spedirebbe email vere a ogni `pnpm test`. Il codice non compare
mai in una risposta HTTP, in nessun ambiente.

L'ordine, in registrazione, è **prima l'utente e poi l'invio**. Un invio fallito lascia un account
esistente e non verificato, e la schermata successiva è quella di sempre. Un errore di rete non deve
mai perdere una registrazione, né bruciare un indirizzo, né far riscrivere la password a chi
l'aveva già scritta.

Il rate limit, in `lib/rate-limit.ts`, è una `Map` su `globalThis`. Ed è qui che il vincolo che
rende semplice tutto il resto di questa applicazione rende *esatto* anche questo: con un processo
solo, una `Map` in memoria è un contatore globale e corretto, non un'approssimazione per nodo.
Niente Redis, e non per divieto — perché non servirebbe a nulla. Copre due cose sole, il login e la
registrazione; la verifica del codice e il reinvio non passano da qui, perché cinque tentativi e
sessanta secondi sono già righe nella tabella.

Due dettagli che mordono se saltati. Dietro nginx l'IP della connessione è `127.0.0.1`, quindi
l'IP vero si legge da `X-Forwarded-For` — e `deploy/nginx-asta.conf` lo imposta, verificato. Ma
`$proxy_add_x_forwarded_for` **accoda** al valore ricevuto invece di sostituirlo, e quel valore lo
scrive il client: si prende quindi l'**ultimo** elemento della lista, l'unico che ha scritto nginx.
Prendere il primo, che è la lettura ovvia della specifica dell'header, renderebbe il limite
aggirabile mandando un header a mano. E una `Map` che non sfratta nessuno è una perdita lenta in un
processo che gira per mesi: la scadenza si applica al tocco, e sopra c'è un tetto sul numero di
chiavi. Nessun timer, niente da schedulare.

### Il terzo provider, quello che non deve esistere in produzione

Collaudare un'asta a otto partecipanti richiederebbe otto account Google veri. È impraticabile, e
un'app che non si può collaudare a otto è un'app che si collauderà per la prima volta la sera
dell'asta.

Per questo esiste un terzo modo di entrare: un provider `dev` che apre una sessione per un
utente già presente a database, senza passare da Google e senza password. La pagina di login, fuori
produzione, mostra un elenco di pulsanti "Entra come Marco Bianchi", "Entra come Luca Ferrari" — i
dodici utenti creati da `pnpm db:seed`. Un click, sessione pronta. Quattro finestre di browser,
quattro partecipanti.

Un provider che salta l'autenticazione è però esattamente il genere di cosa che non deve
sopravvivere a un deploy. Due difese. La prima: la lista dei provider si costruisce in funzione di
`NODE_ENV`, e in produzione quello `dev` non viene nemmeno costruito. La seconda: c'è un test
automatico che **interroga l'endpoint `/api/auth/providers` con `NODE_ENV=production`** e verifica
che la lista sia **esattamente** `["google", "email"]`. Non ispeziona una variabile: chiede
all'applicazione la stessa lista che vedrebbe un client, e se il provider non è pubblicato lì non
c'è modo di invocarlo.

Quel test è cambiato in M5 — prima si aspettava `["google"]` — e *come* è cambiato conta quanto il
valore: è rimasta un'**uguaglianza esatta**. Non è diventata un «almeno questi», quindi un provider
aggiunto per sbaglio domani lo fa fallire esattamente come lo faceva ieri. È cambiato quanti
provider legittimi esistono, non quanto stretta è l'asserzione.

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

Da M5 il seed scrive ai dodici utenti anche due colonne nuove, e non sono un dettaglio.
**`email_verified_at`**: senza, la scala di `requireUser()` li lascerebbe tutti fermi su `/verify`, a
chiedere un codice che nessuno può leggere, perché dietro `@example.test` non c'è nessuna casella di
posta — la prova in locale si romperebbe al primo login. E **una password nota**, stampata a fine
seed, perché il provider `dev` è comodo ma salta esattamente ciò che M5 ha aggiunto: con quella
password si collauda `/signin` con email e password come farà un partecipante vero.

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

Dalla versione 1.11 quel file si può anche **non** caricare: se un amministratore ne ha messo uno a
sistema, chi crea un'asta se lo trova proposto con la data del caricamento accanto, e le righe
vengono copiate dentro l'asta al posto suo. Il caricamento da file resta comunque — serve a
correggere un file sbagliato, e a preparare un'asta il giorno in cui a sistema non c'è ancora
niente — e le due strade si possono alternare quante volte si vuole finché l'asta non parte. Quello
che **non** cambia è che dentro l'asta ci finisca una copia: il capitolo «Il listone a sistema»
racconta perché quella parola è la cosa importante della frase.

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
pochi e si contano: l'avvio, la chiamata di un giocatore, un'offerta, lo scattare di una scadenza,
l'apertura anticipata delle buste, l'annullamento di un lotto, la pausa e la ripresa. Non c'è
nient'altro che possa far muovere un'asta — e fino a M16 ce n'era uno in più, il ritiro di
un'offerta, che è stato tolto (vedi «Chi offre tiene» qui sotto).

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
`LOT_OPEN`; le buste si chiudono allo scadere; **da M14 c'è un istante in mezzo, `LOT_SEALED`**,
in cui il round è chiuso e l'esito non è ancora stato calcolato (è il capitolo dopo questo);
passato quello, se il massimo è unico si va al `LOT_REVEAL`, altrimenti c'è lo spareggio
(`LOT_TIE_PREP`, poi di nuovo `LOT_OPEN` come round 2); il reveal scade e il turno avanza — o
l'asta finisce.

Dentro questo giro ci sono cinque scelte che meritano una spiegazione.

**Chi chiama è vincolato.** All'apertura del lotto il motore registra da solo un'offerta a 1 del
chiamante, con il timestamp dell'apertura. Il chiamante può rilanciare, e basta: un lotto ha sempre
almeno un'offerta valida, e "nessuno offre" non è uno stato possibile.

**Chi offre tiene, e al massimo rilancia** (M16, `v1.16.0`). Per tutta la vita dell'app fino a
quella versione esisteva un ritiro: chi aveva consegnato la busta poteva toglierla entro la
scadenza, e il motore le scriveva addosso un `withdrawn_at` che la escludeva dalla risoluzione.
Non c'è più, e la cosa da capire è **quanto** non c'è più: non è stato nascosto il pulsante, è
stato tolto l'evento. `WITHDRAW_BID` non esiste nella macchina a stati, `withdrawBid` non esiste
fra le azioni, e la rotta `/action` non ha un `case` per lui — un `POST` costruito a mano riceve
`INVALID_REQUEST`, cioè «questa azione non esiste».

La ragione di tanta insistenza è la sesta regola letta al contrario. La regola dice che la UI
disabilita e il server rifiuta comunque; se si fosse tolto solo il pulsante, il server **non**
avrebbe rifiutato, e la nuova regola del gioco sarebbe vissuta soltanto nel codice del browser. In
un'asta fra amici nessuno costruirà mai quel `POST`: il rischio vero è un altro, ed è che fra sei
mesi nessuno sappia più con certezza se il ritiro c'è o no.

⚠ **La colonna `bids.withdrawn_at` invece è rimasta**, con tutti i suoi lettori: il filtro di
`resolveRound`, il `line-through` nel reveal — sia in TV che nel portale — e le righe del log dei
lotti. Su tutto ciò che si scrive da M16 in avanti è `null` e resterà `null`, ma le aste già
giocate hanno dei ritiri dentro, e un lettore tolto non semplificherebbe niente: riscriverebbe il
passato. È la stessa logica per cui `"WITHDRAW_BID"` resta elencato fra gli eventi «di routine» in
`lib/auction-log.ts` — lì un tipo *sconosciuto* è notevole, quindi cancellare quella riga non farebbe
sparire i ritiri storici, li farebbe comparire nello storico delle correzioni, dove non sono mai stati.

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

### Il cancello dei risultati, e la trappola dei crediti

Questa è la prima fase nuova della macchina a stati dopo la messa in produzione, e la ragione per
cui è fatta come è fatta non si vede leggendo il codice: va raccontata.

Il problema nasce da una serata vera. Fra «il round è chiuso» e «tutti sanno tutto» non c'era
nessun istante: era una transizione sola, che nella stessa frazione di secondo calcolava il
vincitore, scriveva l'assegnazione e mandava a dodici telefoni — e al proiettore — le buste di
tutti. Se qualcuno perdeva la connessione negli ultimi secondi, non per colpa sua, nel momento in
cui lo diceva a voce le offerte erano già sullo schermo. Non c'era niente da fermare: il lotto era
assegnato, il prezzo pubblico, e l'unico rimedio era una correzione a mano che lasciava comunque
tutti a conoscenza di quanto ciascuno aveva offerto — cioè, in un'asta a busta chiusa fra amici che
si guardano in faccia, l'informazione che decide i lotti successivi.

Il rimedio è un istante che appartiene a chi conduce. Per `result_gate_seconds` il round è chiuso e
nessuno sa niente: si può mostrare, si può fermare, e — solo lì — si può buttare via il lotto e
rifarlo.

**Il modo ovvio non funziona, e il perché è la cosa da ricordare.** Verrebbe naturale lasciare il
motore come stava — round chiuso, esito calcolato, assegnazione scritta — e semplicemente *non
mostrare* le buste finché il cancello è aperto. Una riga nella serializzazione, e sembra fatta. È
stato provato, e non nasconde niente: il buco non è nel pannello delle buste, **è nei crediti**.
Per ogni partecipante lo snapshot porta sempre i crediti residui, l'offerta massima possibile, gli
slot riempiti e la rosa, e li porta a *tutti*, TV compresa, perché sono tutti derivati dalle
assegnazioni. Nascondere le buste mentre i crediti di qualcuno scendono di 87 e un nome nuovo
compare nella sua rosa non è nascondere: è un quiz con una risposta sola. E la misura fatta il
2026-08-18 su un'asta di prova dice che è peggio ancora — nella rosa c'è anche il *prezzo pagato*,
cioè l'importo esatto della busta vincente, in un campo che non ha nessun rapporto con il pannello
del reveal. Sul proiettore, in tempo reale, prima che chiunque possa premere un pulsante.

Quindi **il cancello sta prima della risoluzione**: alla chiusura del round il motore scrive
`closed_at` e si ferma, e la funzione che decide chi ha vinto non viene chiamata affatto. Non è una
differenza di ordine, è la differenza fra «l'esito esiste e non lo mostriamo» e «l'esito non esiste
ancora». Da questa scelta discendono tre conseguenze, tutte a favore.

La prima: **annullare un lotto non tocca la regola dei dati mai distruttivi.** Nel cancello
l'assegnazione non esiste, quindi non c'è nessuna riga da marcare come annullata, nessuna
compensazione da inventare, nessun credito da rimettere a posto. Il giocatore torna disponibile da
sé, perché «disponibile» è derivato dalle assegnazioni non annullate. Ciò che non si scrive non si
può scrivere male.

La seconda: **lo storico resta a posto gratis.** La pagina della storia di un'asta pubblica le
buste dei soli lotti risolti, e quel confine non è una convenzione della pagina — è il momento
esatto in cui il motore scrive `RESOLVED`, cioè quando gli importi diventano pubblici. Un lotto
sigillato è ancora aperto, quindi lo storico non lo guarda, senza che nessuno abbia dovuto
aggiungere una condizione. È anche il motivo per cui **un lotto annullato prende `VOIDED` e non
diventerà mai `RESOLVED`**: è l'unico caso dell'applicazione in cui un lotto finisce senza che le
buste siano mai uscite, e dargli `RESOLVED` per coerenza — «è finito, no?» — farebbe pubblicare
dallo storico esattamente le offerte che il cancello esiste per non svelare.

La terza è un prezzo, e va detto: l'assegnazione si scriveva all'ingresso del reveal proprio perché
un crash non potesse perdere un lotto già deciso, e adesso davanti a quella proprietà c'è una
finestra di qualche secondo in cui il lotto è deciso **dalle offerte** ma non committato. Non è una
perdita, perché l'esito non è un dato ma una funzione: le offerte sono righe a database, la
funzione che le risolve è pura, e al primo avanzamento successivo — il timer riarmato, o lo sweep
di sicurezza dopo un riavvio — gli stessi bit producono la stessa risposta. Questa non è
un'affermazione da credere: c'è un test che spegne il processo con un lotto sigillato, riparte, e
verifica che il boot recovery produca lo stesso vincitore allo stesso prezzo.

**Lo zero non è una fase da zero secondi: è l'assenza della fase.** Con `result_gate_seconds = 0`
il motore risolve nella stessa transizione, come prima di M14 — è una `if`, e vale la pena averla
scritta. Una fase da zero sarebbe uno stato osservabile: un timer armato sull'istante presente, uno
snapshot in più per lotto spedito a dodici persone, e una schermata d'attesa che lampeggia se un
avanzamento arriva un tick in ritardo. Lo zero è anche il valore che hanno le aste già in tabella,
ed è per questo che M14 si è potuta rilasciare senza toccare nessuna riga esistente: quelle aste si
comportano esattamente come si comportavano. Una **nuova** asta invece propone dieci secondi, e i
due default sono diversi di proposito — uno risponde a «cosa c'era prima», l'altro a «cosa
proponiamo adesso».

**Chi comanda è l'owner, in regia.** Durante il cancello ha tre leve, e la differenza fra le prime
due è tutto il disegno: «Mostra risultati» funziona ad asta in corso e anticipa una scadenza che
c'è comunque; «Metti in pausa» — che esisteva già — congela il cancello; e solo ad asta in pausa
compare la terza, «Annulla lotto». Il cancello che scorre si può anticipare, quello fermo si può
disfare: annullare un lotto mentre il suo countdown corre sarebbe una corsa con il proprio timer, e
ad asta ferma i timer sono fermi per definizione.

«Mostra risultati» è la gemella di «Prosegui asta», e sta accanto ad `ADVANCE` per la stessa
ragione: la guardia sulla scadenza serve ai timer e allo sweep, e allentarla per fare spazio a un
pulsante la renderebbe inutile per entrambi. Premuto due volte non apre due volte, perché al
secondo colpo la fase non è più quella.

**«Annulla lotto» è l'unico posto dell'applicazione in cui il turno torna indietro**, e la regola
operativa che dice il contrario resta vera in tutti gli altri: dopo il reveal la strada è quella di
sempre — si annulla l'assegnazione e si riassegna a mano — e lì la rotazione non torna indietro. Qui
può, e regge su tre condizioni insieme: quel lotto non ha creato nessuna assegnazione, la rotazione
non è ancora avanzata, e il ruolo del chiamante non può essersi riempito nel frattempo. La terza è
vera **perché gli override sono rifiutati anche durante il cancello**: l'unica cosa che riempie un
ruolo fuori da un lotto è un'assegnazione manuale, e durante il cancello è vietata. Non è una
precauzione in più — è il presupposto, e un lotto sigillato *è* un lotto in contesa, il più in
contesa che ci sia: l'esito è già deciso e nessuno lo conosce. Con le tre condizioni in piedi, il
caso «il chiamante non può più chiamare» non esiste, e il motore lo asserisce invece di gestirlo.

Due cose che il cancello **non** fa, e sapendolo si evita di cercarle. Non riapre le offerte: chi
era disconnesso durante il round ha perso il round, e il cancello serve a non svelare, non a
rimediare — l'unico rimedio vero è buttare il lotto e rifarlo. E non si mette in pausa da solo per
nessuna ragione, che è la stessa scelta dell'avviso di presenza: un'asta che si ferma da sé perché
un telefono è andato in standby si bloccherebbe ogni due minuti. Se nessuno preme e nessuno segnala,
i risultati escono. Il cancello sposta la decisione, non la sospende.

Un'ultima nota, perché è una domanda che si farà chi guarda una simulazione: **i lotti a idoneo
unico non passano dal cancello.** Lì non c'è nessuna busta da proteggere — l'unica offerta in campo
è l'auto-offerta a 1 del chiamante — e mettere il cancello vorrebbe dire pagare qualche secondo per
lotto, molti di fila a fine ruolo, per un esito che nessuno può contestare.

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

C'è un dettaglio di questa famiglia che vale la pena conoscere prima della serata: **un'offerta
consegnata non si toglie più**. Si può rilanciare fino alla scadenza, mai ritirare. È una regola
del regolamento e non un limite tecnico — fino a `v1.15.1` il ritiro esisteva ed era *irreversibile*,
da M16 non esiste affatto — e la UI non la annuncia, perché una regola che non esiste non si
annuncia: nel modale non c'è nessun pulsante che tolga qualcosa, e tanto basta.

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
`pickPlayer`, `placeBid`, `pauseAuction`, `resumeAuction`, più `advancePhase` che
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

Sopra tutto c'è una **navbar globale** nel layout radice: il marchio e la scritta *Fantasta* che
riportano alla lista delle aste, il nome di chi è entrato, la versione compilata, l'uscita, e — solo
per chi è amministratore dell'applicazione — il pulsante che porta al pannello. La versione è lì per
un controllo a vista — aprire il sito e sapere quale codice sta rispondendo, invece di credere al
momento in cui il deploy dichiara di aver finito — e viene da `package.json`, letto nel layout e
passato alla navbar come stringa: il deploy compila sul server dopo il checkout, quindi quel numero
è quello del codice in esecuzione. Si disegna anche senza sessione, così si legge dalla pagina di
accesso, che è dove si guarda quando l'app non fa entrare. Il blocco utente si disegna solo se c'è una
sessione e il nome solo se esiste, il che copre senza casi speciali sia `/signin` (dove non c'è
sessione) sia `/onboarding` (dove il nome è proprio ciò che si sta scrivendo, ma l'uscita deve
esserci: è l'unica via di fuga per chi è entrato con l'account sbagliato). Si toglie di mezzo sulla
sola vista TV, che è pubblica e proiettata e non è la pagina di chi la guarda.

Fino a v1.9.1 lì accanto c'era anche una **striscia verde «Asta in corso»**, su ogni pagina, e da
v1.10.0 non c'è più: il capitolo del portale racconta perché, perché è lì che il suo posto è stato
preso da qualcos'altro.

Il **marchio** accanto alla scritta è arrivato da M20, ed è un `path` SVG scritto inline dentro
`navbar.tsx` invece di un file di componente o di un'immagine. Le tre ragioni, in ordine di
importanza. Non è un file suo perché ha **un solo chiamante**, e la regola dell'astrazione dopo il
secondo chiamante vale anche per sei righe: il giorno che la pagina di accesso volesse un marchio
grande, quel giorno esisterà il secondo chiamante che giustifica `components/nav/logo.tsx`. Non è un
`<img>` perché un SVG inline non è una richiesta di rete in più su ogni pagina, e soprattutto perché
il suo colore è `currentColor`: il marchio segue il colore del testo accanto, invece di essere un
nero congelato in un file che un giorno finirebbe su un fondo scuro. E il `clipPath` che l'export di
Figma si portava dietro è stato buttato — era un rettangolo a tela piena, cioè inerte — perché un SVG
inline condivide lo spazio dei nomi degli `id` con tutta la pagina, e `clip0_262_27` in una pagina è
un rischio piccolo e gratuito da evitare.

L'altezza è `h-6`, e non è un gusto: **24 pixel sono la `line-height` del testo accanto**, quindi la
barra non cresce di un pixel su nessuna pagina — sulla pagina di accesso, dove non ci sono pulsanti a
dettare l'altezza, resta alta 45px come prima. Il costo c'è e sta da un'altra parte: a 375 pixel la
riga della navbar non va a capo perché l'unico elemento che cede è il **nome dell'utente**, che ha
`min-w-0` e tronca. Diciotto pixel di marchio sono diciotto pixel in meno di nome, e nel portale un
nome lungo che prima entrava intero adesso si tronca. È una scelta, non un difetto: il marchio si
vede su ogni schermata, il nome per esteso lo sa già chi lo porta.

Dentro un'asta, un layout su `/auctions/[id]` legge una volta chi guarda e che rapporto ha con
quell'asta, e da due booleani — la possiede, ci gioca — ricava le sezioni. **Dipendono dal ruolo**,
e per quasi tutte è l'unica cosa da cui dipendono: il ruolo non cambia mentre guardi la pagina, lo
stato sì, e una sotto-navbar renderizzata dal server mostrerebbe voci sbagliate dopo la prima
transizione — a meno di alimentarla dallo snapshot, cioè di trasformare la navigazione in stato di
gioco. Il layout decide cosa *mostrare*, mai cosa si può *fare*: sono le pagine a respingere chi non
deve entrare, e le azioni a ricontrollare comunque sul server.

**Una sola voce fa eccezione, da M16: la Lobby, che sparisce dal menù ad asta `LIVE`.** Il motivo è
che lì il link non porta da nessuna parte — chi è membro, arrivando in lobby con l'asta in corso,
viene spinto al portale da `LobbyLive`, ed è l'unico `router.push` automatico dell'applicazione. Un
link che rimanda indietro è peggio di un link assente: chiede un tocco e restituisce il punto di
partenza.

La condizione è **copiata da quella del rimbalzo**, non inventata più larga, e le due cose che *non*
nasconde sono la parte da non semplificare per simmetria. Ad asta **in pausa** la voce resta, perché
in pausa la spinta non c'è — è stata tolta apposta, dato che la pausa è il momento in cui si va a
cambiare i tempi. E per **l'owner che non gioca** (⚠ P11) la voce resta sempre: non essendo membro
non viene spinto da nessuna parte, e per lui la lobby ad asta in corso è la lista dei partecipanti
coi loro pallini di presence.

⚠ Due precisazioni tengono in piedi il resto. La prima: lo stato arriva da `getAuctionOverview`,
cioè dalla stessa lettura da cui esce tutto il layout, **non dallo stream** — la riga sulla
navigazione che non diventa stato di gioco non si è mossa. Il prezzo è la staleness, ed è piccolo
per costruzione: il layout è dinamico e si rirenderizza a ogni navigazione, e la spinta al portale è
essa stessa una navigazione, quindi il caso che conta si corregge da sé nell'istante in cui si
verifica; resta stantia solo per chi sta fermo su una pagina mentre l'asta cambia stato. La seconda:
**nascosta dal menù non vuol dire irraggiungibile**, e `activeSection` — la funzione che dal
pathname ricava il titolo della pagina — legge per questo il catalogo intero e non l'elenco delle
voci visibili. Se passasse dalle voci visibili, la lobby perderebbe la propria intestazione proprio
nello stato in cui la voce è nascosta, cioè quando l'owner che non gioca la sta guardando.

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
non costa nulla, perché le altre pagine sono documenti e non cruscotti, ed evitava un incastro a tre
livelli di `z-index`. Resta incollato solo ciò che deve esserlo: l'intestazione dell'asta live, che
tiene crediti e offerta massima sempre in vista. I tre livelli sono diventati due quando la striscia
verde è stata rimossa.

Il costo tecnico di tutto questo è una riga: `getAuctionOverview` è avvolta in `cache()` di React,
perché ora la chiamano sia il layout sia la pagina. La memoizzazione dura quanto la richiesta e non
altro — fuori da un contesto di render React la funzione viene semplicemente eseguita, quindi test e
script continuano a leggere il database vero a ogni chiamata.

---

## L'app che si installa sul telefono

Da M20 l'applicazione si può **aggiungere alla schermata home** e aprire come un'app, senza barra
degli indirizzi. Il problema che risolve non è estetico: la sera dell'asta dodici persone nella stessa
stanza devono aprire lo stesso portale in fretta, e fra un'icona e un giro nella cronologia di Safari
c'è la differenza fra un tocco e mezzo minuto.

Serve **un file e tre meta**, e niente altro. `app/manifest.ts` è una funzione che restituisce un
oggetto: Next la serve su `/manifest.webmanifest` e ne emette il `<link>` da sé, per la stessa
convenzione con cui trova le icone dentro `app/`. La rotta è **pubblica**, e non per distrazione: in
questo progetto non c'è un `middleware.ts` — l'autenticazione è per pagina, con `requireUser()` —
quindi non c'è niente che possa metterla dietro una sessione, che è esattamente il modo in cui un
manifest smette di funzionare senza dare un errore comprensibile. I meta arrivano da `appleWebApp`
nel `metadata` del layout, e sono deliberatamente ridondanti col manifest: Safari li legge ancora, ed
è la stessa scelta di tenere insieme `proxy_buffering off` e `X-Accel-Buffering` sulla rotta dello
stream.

Le icone sono **cinque file committati**, generati a mano una volta da `fixtures/logo.png` con
`scripts/genera-icone.py`, che non è chiamato da nessuna build. Tre stanno in `app/` e le trova Next
per convenzione di nome; due stanno in `public/`, e questa cartella è nata per loro. Il motivo è che
il manifest dichiara le sue icone per URL, e le rotte generate dai file dentro `app/` portano un hash
che cambia col contenuto: un `<link>` che Next scrive da sé può contenerlo, un manifest scritto a mano
no. Il 512 quindi esiste **due volte con gli stessi byte**, una per ciascun consumatore, da una sola
sorgente e da una sola riduzione. È il prezzo per non scrivere `metadata.icons` a mano, cioè per non
tenere allineate due verità sulla stessa cosa. ⚠ E in `public/` i nomi sono `icon-192.png` e
`icon-512.png` perché `icon.png` collide con la rotta che Next genera da `app/icon.png`: un rinomino
per pulizia romperebbe l'installazione, e lo farebbe **in silenzio** — il manifest continuerebbe a
rispondere, con dentro due URL che danno 404. È l'unico modo in cui questa parte può rompersi senza
che nulla lo dica, e per questo `tests/manifest.test.ts` controlla che i due file dichiarati esistano
su disco.

Il manifest dichiara **quattro voci di icona per due file**: ogni misura una volta con `purpose: "any"`
e una con `"maskable"`. La stringa doppia `"any maskable"`, che la specifica del W3C ammette, non è
scrivibile qui — il tipo di Next è un'unione di tre stringhe singole, quindi sarebbe una build rossa —
e non serve: lo stesso file va bene per i due scopi perché il disegno è a tela piena col marchio
centrato, e il suo angolo più lontano dal centro sta al 28,6% del lato contro il 40% della zona sicura
di Android.

**Tre cose non ci sono, e ognuna per una ragione sua.** Non c'è un **service worker**: su iPhone
l'installazione in standalone non lo richiede, su Android costa il banner «Installa app» e resta la
scorciatoia dal menù. In cambio non si mette una cache davanti a un'applicazione che a ogni deploy ha
due minuti in cui i suoi chunk statici rispondono 404 — un service worker che serve una pagina vecchia
con riferimenti a chunk morti è quel guasto reso permanente, e il rimedio sarebbe una disinstallazione
che nessuno sa fare da un telefono. Non c'è `viewport-fit=cover`: l'applicazione ha quattro
`env(safe-area-inset-*)` con fallback, e senza quella riga gli `env()` valgono zero, quindi oggi
vincono i fallback e i layout sono quelli che sono stati guardati e approvati; accenderla cambierebbe
quattro layout, di cui due sono il modale d'offerta e la barra incollata del portale. E non c'è una
**schermata di avvio iOS**, che vorrebbe un'immagine per ogni misura di iPhone — una decina di file da
mantenere perché il primo mezzo secondo sia colorato invece che bianco.

Due cose cambiano per chi installa, e non sono difetti da correggere. La prima: **si rientra da zero**,
perché le web app aggiunte alla schermata home su iOS hanno un contenitore cookie separato da Safari, e
la sessione aperta nel browser non passa nell'app installata. La seconda: **senza barra degli indirizzi
il ricarico è un pull-to-refresh**, e il ricarico è il rimedio documentato per la finestra cieca del
deploy — la versione si legge ancora dalla navbar, ma il gesto per rimediare è un altro.

Questa parte **ribalta una decisione scritta**, e vale la pena saperlo leggendo `DECISIONS.md`: il
2026-08-18, quando le icone furono fatte fuori macro, si scrisse «nessun manifest, nessuna PWA, nessun
service worker», con la motivazione che l'installabilità era una superficie in più che nessuno aveva
chiesto. Poi l'ha chiesta l'owner. Cambia il fatto, non il ragionamento — e il service worker, che era
la parte del ragionamento che regge ancora, è rimasto fuori.

---

## Il portale del partecipante

Qui l'applicazione incontra la persona: un telefono tenuto con una mano, in una stanza dove
qualcuno legge i nomi ad alta voce, con trenta secondi per decidere quanto vale un attaccante. Il
portale sta su `/auctions/[id]/play` ed è una pagina sola.

Da M17 quella pagina sola ha **due forme**: sul telefono resta la colonna unica che è sempre stata,
e da 1024px in su diventa tre colonne. Non è responsive design applicato per abitudine — è
l'osservazione che metà della serata la si passa davanti a un portatile, e che lì il portale era una
colonna stretta in mezzo a uno schermo vuoto con tutto in fila da scorrere. Le tre colonne sono tre
domande diverse a cui si guarda in tre momenti diversi: **chi ho** (la mia rosa), **chi hanno gli
altri**, **cosa sta succedendo**.

La parte server di quella pagina fa tre cose e nessuna di queste è preparare la schermata: verifica
che chi entra sia un membro (l'owner che non ha joinato non ha un portale — il suo è `/manage`),
carica il listone, e passa la palla al client. **Lo stato dell'asta non viene renderizzato lato
server**, ed è una scelta: una schermata calcolata a build-time della richiesta sarebbe giusta per
un istante e sbagliata per i trenta secondi successivi, e avere due fonti di verità sulla fase
corrente è esattamente il modo in cui si desincronizza un'asta.

### Tre colonne, e un ordine del DOM che sembra un errore

La griglia sta dentro `max-w-6xl`, che a 1024px fa colonne da circa 350px. Fino a v1.16.0 quella
larghezza larga stava nell'**intestazione** e il corpo era `max-w-xl`: cioè al contrario di come si
legge una pagina, ed è il tipo di cosa che nessuno nota finché non serve mettere tre cose una accanto
all'altra.

La sola trappola di questa griglia è **l'ordine in cui le colonne sono scritte**, e va raccontata
perché il codice, letto senza spiegazione, sembra sbagliato: nel DOM l'ordine è *scena → rosa →
altri*, e le colonne si rimettono in fila con tre classi `lg:order-*`. Il motivo è che sotto `lg` non
esiste nessuna griglia — c'è una colonna sola, e conta solo l'ordine sorgente. Scrivendo le colonne
nell'ordine visivo del desktop, chi gioca dal telefono avrebbe dovuto scorrere oltre la propria rosa
e oltre gli otto avversari per arrivare all'offerta, cioè il contrario esatto di quello che il
portale ha sempre fatto. Tre classi sono il prezzo per non peggiorare il dispositivo con cui si gioca
davvero.

L'intestazione incollata in cima — quella che tiene crediti e `max_bid` sempre a schermo, il
requisito mobile-first di `PLAN.md` §15 — da `lg` **sparisce**, perché su uno schermo grande non c'è
niente da inseguire. Gli stessi numeri diventano una fascia grigia in testa alla card della rosa, in
colonna 1. Sono lo stesso componente, `<Identity>`, e non due copie: due blocchi che dicono i due
numeri che decidono ogni offerta divergerebbero, e il giorno in cui divergono nessuno sa quale dei
due credere. Il `lg:hidden` sta sull'`<header>` e la barra resta dov'era nell'albero, fuori dal
`<main>`: uno `sticky` figlio di un contenitore di griglia si aggancia al contenitore e non al
viewport, quindi spostarla dentro la griglia e nasconderla lì non è la stessa cosa.

### Tre livelli, e nessuna notifica

La gerarchia della UI è quella di `docs/PLAN.md` §8bis, e ogni livello esiste per un modo preciso in
cui un partecipante può perdersi. Da v1.10.0 i livelli sono **due**, non tre, e il primo che è caduto
è l'unico pezzo di quel piano che ha smesso di valere: vale la pena raccontarlo per esteso, perché
`PLAN.md` è archivio vincolante e continuerà a descrivere una cosa che l'applicazione non fa più.

Il **banner globale «Asta in corso»** stava nel layout radice e compariva su qualunque pagina quando
chi guardava era membro di un'asta `LIVE` o `PAUSED`. Nel piano era «il modo con cui un utente
rientrato trova la strada da solo»; nell'uso è risultato **più disturbante che utile** — una striscia
verde in cima a ogni schermata, per tutta la sera, che dice una cosa che chi è in quella stanza sa
già. È stato rimosso su richiesta dell'owner, per tutte le aste e senza eccezioni.

Al suo posto non c'è un rimando nuovo in navbar: c'è **la dashboard**. Chi chiude il tab per sbaglio
riapre l'app, vede le proprie aste elencate e ne apre una — un tocco in più di prima, in cambio del
silenzio in cima a ogni pagina. E chi arriva sulla lobby di un'asta già iniziata viene portato al
portale da sé, perché quella navigazione automatica — l'unica dell'applicazione — la decide lo
snapshot e non è mai dipesa dal banner.

La cosa importante da capire è che **il banner era il modo di *arrivare* alla pagina, non di
ricostruirla**. I cinque rientri di §8bis continuano a funzionare identici, perché dipendono dallo
snapshot: chi si ricollega a metà lotto ritrova la schermata esatta di prima, banner o non banner.
La sua rimozione fa *sembrare* rotto I10 e non lo sfiora. Il guadagno collaterale è misurabile: il
layout radice non chiama più `listUserAuctions` a ogni richiesta di ogni utente autenticato, cioè una
query per pagina in meno per un elemento che compariva solo qualche sera all'anno.

La **card del lotto** è un elemento *permanente* del portale finché c'è un lotto corrente. È la
correzione dell'errore che l'anno scorso ha reso l'app inutilizzabile: se l'unica interfaccia per
offrire è un modale, chi lo chiude non ha più modo di rientrare nel lotto. La card mostra
giocatore, ruolo, squadra, countdown, la propria offerta e il pulsante che riapre il modale. Degli
altri non dice niente, e lo dichiara: una riga spiega che le buste sono segrete fino all'apertura,
perché senza quella spiegazione la card sembra semplicemente rotta.

Fino a M17 quella card era **due** card che si davano il cambio con la fase — `LotCard` per il lotto
vivo, `LotClosedCard` per le buste aperte — e prima di M1 era una sola, con il reveal dentro la
cornice viva. Da M17 la storia si chiude nell'altro verso: **una cornice sola per tutte le nove
scene**, e sono i corpi a cambiare. Vale la pena raccontare perché, perché letta di fretta sembra
il ritorno a prima di M1 e non lo è.

Il problema che M1 aveva risolto era che il lotto vivo e il lotto finito **si assomigliavano troppo**:
stessa cornice, stessa barra che scorre, stesso countdown grande, e l'unico modo di capire quale dei
due si stava guardando era leggere. Il problema che M17 ha risolto è l'opposto e nasce dal rimedio:
nove scene disegnate da sei contenitori diversi vogliono dire che a ogni cambio di fase **si sposta
tutto** — il badge era in tre posti a seconda della card, il countdown in quattro, l'intestazione a
volte c'era e a volte no. Capire *cosa* era cambiato voleva dire rileggere la card da capo.

La cornice unica è `SceneCard`, e la sua anatomia è la risposta: una fascia da 4px in testa, la
label della scena sempre nell'angolo in alto a sinistra, il badge sempre in quello a destra, il corpo
in mezzo, l'azione a piena larghezza sotto il corpo, e la banda del tempo nell'ultimo pixel della
card. Passando da una fase all'altra **non si sposta niente tranne il corpo**, quindi l'occhio
controlla badge e countdown senza cercarli e un cambiamento si nota perché qualcosa è cambiato *lì*.
La distinzione fra i momenti che M1 chiedeva non è tornata a essere una cornice diversa: è diventata
la **fascia**, cioè quattro pixel di colore che si percepiscono in periferia dell'occhio senza
leggere niente.

Che sia un contenitore invece di sei non intacca la permanenza dell'area del lotto: quella chiede che
ci sia sempre e sia funzione pura dello snapshot, non che sia sempre lo stesso nodo React — la stessa
cosa che valeva quando i componenti erano due.

Anche l'azione è finita in un posto solo. Prima ogni card metteva il suo pulsante dove capitava:
«Apri offerta» in mezzo al corpo, «Prosegui asta» in un piè di pagina, «Vai alla lobby» sotto un
paragrafo centrato. Si preme dal telefono, spesso senza guardare, e che stia sempre nello stesso
posto vale più di dove quel posto sia. Nel cancello e nel reveal, e solo per l'owner, quello slot
porta «Mostra risultati» e «Prosegui asta». Che chi guarda possieda l'asta non viaggia nello snapshot
ma arriva come prop dalla pagina server, per la stessa ragione del listone: non è stato di gioco, non
cambia per tutta la serata, e nello snapshot verrebbe spedito a tutti a ogni transizione. Il pulsante
nascosto agli altri non autorizza niente — `skipReveal` e `showResults` ricontrollano lato server,
come sempre.

C'è **un'eccezione, e chiarisce la regola invece di indebolirla**: nell'esito «Prosegui asta» non sta
nello slot in fondo ma dentro il corpo, subito sotto la riga di chi si è aggiudicato il giocatore. In
otto scene su nove il corpo è corto, quindi «in fondo alla card» e «subito sotto la notizia» sono lo
stesso pixel e la distinzione non si pone; nell'esito no, perché sotto il vincitore c'è l'elenco di
tutte le buste di tutti i round — fino a dodici righe che sono un'appendice, non la notizia. Con il
pulsante in fondo bisognerebbe scorrere oltre l'appendice per far ripartire l'asta, e lo si preme dal
telefono con dodici persone che aspettano. La regola che regge davvero, quindi, non è «l'azione sta in
fondo» ma **«l'azione segue la notizia»**.

C'è una cosa che la cornice unica ha **risolto** invece di spostare, e si vede solo confrontando con
com'era. `LotClosedCard` aveva due countdown in due momenti diversi — nel cancello un numero grande
al centro, nel reveal un secondo numero in fondo — e il prezzo pagato compariva *nello stesso punto in
cui un attimo prima scorreva il tempo*, di proposito, perché chi stava guardando non avesse niente da
ritrovare. Era una buona soluzione a un problema che la cornice fa sparire: adesso il tempo ha un
posto suo in fondo alla card, quindi il prezzo può stare dove sta il prezzo.

### La scena non è la fase, e la mappa sta in un posto solo

Le scene sono nove: non iniziata, conclusa, sta chiamando un altro, tocca a te, offerte aperte,
spareggio in preparazione, spareggio, buste da aprire, esito. Le fasi della macchina a stati sono
cinque. Il conto non torna, e il punto in cui non torna è uno: **`LOT_OPEN` con `roundNo = 2` è lo
spareggio**, cioè una scena diversa dalla stessa fase con `roundNo = 1`.

Per questo la mappa è una funzione pura — `sceneOf` in `lib/realtime/portal.ts` — e non uno `switch`
dentro un componente. Accanto a lei ci sono `toneOf` (quale fascia), `sceneLabel` (quale etichetta) e
`sceneTime` (quale scadenza, su quale totale, e se è una scadenza mia). Sono quattro tabelle e
vivono in un posto solo, con i loro test.

Che siano funzioni pure non è organizzazione del codice, è **l'unica rete che questa parte
dell'applicazione può avere**: in questo progetto la UI non ha test di rendering — niente
`@testing-library`, niente jsdom — quindi tutto ciò che si può rendere una funzione pura deve
esserlo, e ciò che resta è markup che si verifica guardandolo. Il test che conta è quello sulla
precedenza della pausa: per **tutte e nove** le scene, ad asta in pausa il tono è quello della pausa.
È la stessa precedenza che `phaseLabel` applica da v1.0.0, per la stessa ragione — una fascia che
dicesse «round di offerte» mentre le offerte sono sospese direbbe una cosa falsa proprio a chi sta
cercando di capire perché il suo pulsante non funziona.

`sceneOf` è costruita **sopra** `portalScreen` e non accanto: chi decide «siamo in un lotto?» resta
uno solo. Due funzioni che rispondessero entrambe a quella domanda divergerebbero il giorno in cui
una fase nuova entra nella macchina — che è successo con `LOT_SEALED` e succederà ancora.

### Il tempo, che ha smesso di urlare

La banda in fondo alla card è etichetta a sinistra, cifra e anello stretti a destra. Sostituisce il
countdown da 30px che ogni card si disegnava per conto proprio, e la ragione non è di stile: quel
numero era **identico in tutte le scene**, ma solo in tre la risposta è «devi fare qualcosa adesso».
In «sta chiamando un altro» — che è la scena che dura più di tutte, undici turni su dodici — un
numero grande e una barra che scorre chiedevano attenzione senza chiedere niente.

L'anello e non una barra, e la distinzione conta più di quanto sembri: una barra che si riempie è la
metafora di un lavoro che avanza, mentre qui non avanza niente, **scade** qualcosa — e a un tempo che
scade corrisponde un quadrante. In pratica costa 22 pixel invece dei 250 di una barra a piena
larghezza, che in una colonna da 350 è la ragione per cui etichetta, cifra e misura stanno su una
riga sola.

Il colore della banda ha tre soglie — sopra il 50% verde, sopra il 20% ambra, sotto rosso — e non
sono nuove: erano dentro `CountdownBar` da v1.0.0, e da M17 stanno in `timeTone`, da cui le legge
anche quella. Due copie della regola «sotto il 20% è rosso» sono due copie che un giorno divergono, e
il giorno in cui divergono la card e il pannello dicono due cose diverse sullo stesso countdown.

Ma il colore **non dipende solo dal tempo**: dipende anche da `sceneTime().pressing`, che è vero solo
dove c'è una scadenza *mia* da mancare. È una decisione presa guardando i numeri: con il colore
acceso in tutte le scene, in una serata a otto persone e venticinque slot la banda diventerebbe rossa
duecento volte, e tre volte su sette in scene dove non è chiesto niente — l'esito di un lotto, le
buste da aprire, la chiamata di qualcun altro. Un rosso che non chiede mai niente si impara a
ignorare, e poi non funziona più nelle tre volte in cui vuol dire «muoviti». Dove `pressing` è falso
la banda resta grigia per tutta la sua corsa: il tempo si legge, non grida.

In pausa la banda si **spegne** invece di restare del colore che aveva. Un tempo fermo colorato come
un tempo che scorre è la cosa che si guarda per due secondi prima di capire; che l'asta sia ferma lo
dicono già la fascia a righe, il badge della card di stato e il suo paragrafo.

### La card che non sparisce mai

Sopra la card di scena, prima cosa della colonna 3, c'è `StatusCard`: lo stato dell'asta nel badge,
la fase, il ruolo in gioco, di chi è il turno. C'è **in ogni fase e in ogni stato**, ed è il punto
fisso che rende leggibile il fatto che la card sotto cambi forma — senza qualcosa di stabile sopra,
un cambio di scena si legge come «la pagina è diventata un'altra».

Da agosto 2026 è alta **due righe**, e l'altezza è il requisito e non una conseguenza. Il punto fisso
serve, ma sotto c'è la card delle offerte — la ragione per cui si tiene il telefono in mano — e ogni
pixel speso qui è un pixel che quella non ha. Le quattro informazioni sono ancora tutte presenti in
metà spazio: fase e stato sulla prima riga, ruolo e turno sulla seconda come due badge in linea. Tre
cose sono cadute nel giro, e ognuna per una ragione sua. L'**occhiello «Asta»** era l'unica scritta
identica in tutti gli stati della card, cioè l'unica che non distingueva mai niente da niente: che
questa card parli dell'asta lo dicono la sua posizione e tutto il resto della pagina. La **lista di
definizioni** con «Ruolo» e «Turno» costava due righe per etichettare due parole che si distinguono da
sé — un ruolo e un nome squadra non si confondono — e le etichette sono diventate `sr-only`, perché chi
ascolta la pagina non ha la posizione né la forma e senza di loro sentirebbe due nomi propri di fila.
Il **paragrafo della pausa** è passato da tre righe a una, e il perché è nel paragrafo seguente.

Due dettagli che sembrano minori e non lo sono. Il primo: il badge dello stato dell'asta **era
commentato via** in `portal-header.tsx`, e M17 l'ha riaccesso qui invece di scommentarlo là. In una
barra che dice crediti e `max_bid` quello stato era un'informazione di un altro genere appoggiata
dove capitava; qui ha accanto le tre cose che lo qualificano. Il blocco commentato è stato **tolto**,
non spostato: un blocco commentato che riappare altrove è la cosa che fa dubitare di entrambi.

Il secondo: la fase in questa card usa `phaseLabelIgnoringPause` e non `phaseLabel`. In pausa
`phaseLabel` restituisce «in pausa», che è già quello che dice il badge due centimetri a destra — la
card si ripeteva. Le due funzioni non sono due copie delle frasi: `phaseLabel` **delega** alla
seconda, quindi «offerte», «spareggio» e «buste da aprire» esistono in un posto solo e chi ne cambia
una le cambia per TV, regia e portale insieme. Il risultato è che in pausa la card dice *entrambe* le
cose — in pausa, durante un round di offerte — che è precisamente ciò che significa «la pausa congela
la fase, non la azzera».

La card di stato ha anche **assorbito il banner della pausa** che stava in cima al `<main>`. Due
avvisi di pausa uno sopra l'altro sono un avviso che si ignora.

E adesso ha anche **il comando**. Chi conduce l'asta e ci gioca dentro trova qui, sulla seconda riga,
«Pausa» e «Riprendi»: prima doveva uscire dal portale e andare in Regia, cioè lasciare la pagina delle
offerte nel momento in cui serviva fermarle. La Regia resta la casa dei comandi — l'avvio, gli
override, «Annulla lotto», «Mostra risultati» — e nel portale arrivano le due sole leve che servono
*mentre* si sta guardando questa pagina. Chi conduce **senza giocare** non c'entra e non perde niente:
non è membro, quindi non ha un portale (⚠ P11), e la Regia è già il suo posto.

Tre cose tengono in piedi quel pulsante e vale la pena vederle insieme, perché sono la stessa idea
applicata tre volte. Le condizioni vengono da **`managerControls`**, la stessa funzione pura che usa
la Regia: `canPause` guarda `status = LIVE`, `canResume` guarda `status = PAUSED`, e riusarla invece di
riscrivere due confronti nel componente è ciò che impedisce al pulsante del portale e a quello della
Regia di divergere — i test di quella funzione coprono già entrambi. La visibilità viene da
`viewerIsOwner`, che **arriva come prop e non dallo snapshot**, perché nasce col link e non è stato di
gioco: è la stessa strada da cui `SceneAction` riceve il diritto di premere «Prosegui asta». E il
permesso non viene da nessuno dei due: `pauseAuction` e `resumeAuction` ricontrollano da sé la
proprietà dell'asta, quindi quel booleano decide **cosa si vede, non cosa si può fare** (regola 6).

Il pulsante **condivide la riga dei badge** invece di prendersene una, ed è per questo che la pausa nel
portale costa zero pixel di altezza: la riga è alta quanto il pulsante e i due badge le stavano dentro
comunque. Non dice niente né in caso di successo né in caso di rifiuto, ed è la terza azione da owner
del portale con lo stesso stampo delle altre due: la conferma è lo snapshot che arriva e cambia il
badge dello stato, e il rifiuto qui è quasi solo «l'asta è appena finita», che il badge dice da sé
meglio di una riga di testo. Una riga di feedback costerebbe esattamente l'altezza che tutto questo
giro sta togliendo. È anche il motivo per cui il paragrafo della pausa è tornato a una riga sola: chi
lo legge ha ora «Riprendi» sotto il pollice, non ha bisogno che gli si spieghi chi ha fermato l'asta, e
la cosa che serve sapere è una e non è ovvia — alla ripresa il tempo riparte da dov'era, non da capo.

Il **modale** è un overlay sopra la card, e la frase da tenere a mente è che *non è una notifica*:
è una vista sullo stato corrente. Si apre da sé quando c'è un round aperto e sono fra gli idonei;
chiuderlo non nasconde niente perché l'offerta è a database, non nello state del componente.

### Due pannelli che si alternano senza coordinarsi

Da M17 il modale d'offerta ha un gemello: quando tocca a me chiamare, la lista dei giocatori arriva
dal basso invece di stare in mezzo a una pagina che nel frattempo racconta altro. La cornice è
**la stessa** — le classi del `Dialog.Content` sono copiate, non reinterpretate — perché due pannelli
che si alternano nello stesso punto della serata devono essere lo stesso oggetto con dentro cose
diverse, o si impara due volte la stessa cosa.

La parte da capire è che **nessuno dei due chiude l'altro**. Quando scelgo il giocatore, lo snapshot
successivo porta `phase = LOT_OPEN`: `shouldOpenPickSheet` diventa falsa e `shouldOpenBidDialog`
diventa vera, nello stesso istante, senza che una riga di codice dica «adesso chiudi quello e apri
questo». Sono due condizioni sullo stesso stato, non una sequenza — ed è per questo che il giro
funziona identico per chi si è appena ricollegato, e per questo un pannello aperto quando il turno
scade si chiude da sé mentre l'auto-pick fa il suo lavoro.

Il pannello di chiamata ha un problema che quello d'offerta non ha: **l'altezza**. Il modale
d'offerta è corto; questo contiene una ricerca, le pastiglie dei filtri di Carmy, la riga
dell'auto-pick e fino a quaranta righe di giocatori. Su un telefono con la tastiera aperta è
costruito come quello insegna — intestazione fissa con titolo, countdown e barra, e **solo la lista
che scorre** dentro il suo `overflow-y-auto` — perché se scorresse tutto il countdown uscirebbe dallo
schermo appena si digita, e quello è il difetto che renderebbe il pannello peggiore della pagina che
sostituisce. Errore e avviso di pausa stanno nella parte fissa: un messaggio che si può perdere
scorrendo è un messaggio che non è stato dato.

Una differenza deliberata fra i due: **il campo di ricerca non prende il focus all'apertura**, mentre
quello dell'offerta lo prende da M7. Servono a due gesti diversi — quello d'offerta si apre per
scrivere un numero, quindi la tastiera è la prima cosa che serve; questo si apre per scegliere da un
elenco, e far salire la tastiera coprirebbe l'elenco che è la ragione per cui il pannello è lì.

### Due pezzi di stato locale, dello stesso tipo

`dismissedLotId` è l'id del lotto per cui ho chiuso il modale d'offerta; da M17 c'è
`dismissedTurnKey`, il suo gemello per il pannello di chiamata. Sono le sole due variabili del
portale che non vengono dallo snapshot. Nessuna delle due è persistita o sincronizzata, e entrambe
diventano irrilevanti da sé al momento successivo — l'una perché l'id del lotto cambia, l'altra
perché cambia la chiave del turno.

Da M18 ce n'è un terzo pezzo, di forma diversa: **quale reparto della propria rosa è aperto**. Non è
una variabile del portale — vive dentro l'accordion di radix — ma è stato locale a tutti gli effetti,
ed è governato dallo stesso principio per una strada un po' più elegante, raccontata due sezioni più
avanti.

Che siano dello stesso tipo — e non una collezione di stati che cresce — è ciò che non allenta la
settima regola: sono tutti «questa cosa che si apre da sé l'ho chiusa io», oppure «questa che si è
aperta da sé l'ho spostata io». Non esiste da nessuna parte una variabile "ho ricevuto
l'evento X", quindi non esiste una schermata raggiungibile solo da chi era connesso al momento giusto.
Chiudere il tab e riaprirlo produce la stessa pagina — non perché ci sia un recupero, ma perché non
c'era niente da recuperare.

La chiave del turno è **la scadenza della fase**, e la scelta merita una riga perché l'alternativa
ovvia è sbagliata in un modo che si scopre tardi. Ricordare «l'ho chiuso» con la coppia membro +
ruolo sembra naturale, ma dentro un ruolo lo stesso posto chiama più volte — otto difensori sono otto
turni della stessa persona sullo stesso ruolo — quindi quella coppia si ripete e chi chiudesse il
pannello al primo dei suoi difensori se lo ritroverebbe chiuso per tutti gli altri. `phaseDeadline`
invece è nuova a ogni turno. La conseguenza da conoscere è che **una pausa riapre il pannello**: al
resume le scadenze sono traslate e la chiave non combacia più. È il comportamento voluto — la pausa
finisce e la domanda ti viene rifatta — e c'è un test che lo dice esplicitamente, così se un giorno
non convincesse si sa dov'è la riga da cambiare.

Chiudere il pannello di chiamata non nasconde niente, ed è la stessa promessa che la card del lotto
fa al modale d'offerta: la card «Tocca a te» nella colonna 3 porta il tempo che resta e il pulsante
che riapre. Senza di lei un pannello che si apre da sé sarebbe una trappola per chi lo chiude per
sbaglio.

La conseguenza pratica è che la domanda «quale schermata devo mostrare?» è una funzione pura, e sta
in `lib/realtime/portal.ts` insieme a «quanto posso offrire?», «chi è ancora libero?» e — da M16 —
«questa squadra è collegata?», che è la domanda a cui rispondono i pallini della TV. Girano in ambiente `node`, senza DOM, in millisecondi: i cinque casi di rientro di §8bis —
durante le offerte, durante lo spareggio, durante il reveal, a turno di chiamata già scaduto, ad
asta in pausa — sono **test automatici** che costruiscono lo snapshot di quell'istante e chiedono
alla funzione cosa mostrerebbe. Il collaudo a mano sui browser veri resta, ed è il cancello di fase;
ma non è più l'unico posto in cui questa logica viene esercitata.

### La colonna della rosa: quattro righe che si aprono, e quanto budget c'è dentro

La prima colonna del portale è la propria rosa, e da M18 risponde a due domande che prima faceva
rispondere a mente.

La prima è **«quanto ho messo dove»**. Prima diceva `4/8` per i difensori: quanti me ne mancano, non
quanto mi sono costati. Il conto di quanto budget è finito in un reparto — l'unico numero su cui in
un'asta si decide se si sta esagerando — andava fatto sommando i prezzi riga per riga mentre scorre un
countdown. Adesso accanto al nome del reparto c'è una percentuale, e il denominatore è **il budget a
disposizione**, non la spesa già fatta: 250 sui portieri su un budget da 500 fa `50%`. La quota sulla
spesa sarebbe stata volatile e avrebbe insegnato poco — al primo acquisto un reparto starebbe al 100%
— mentre questa è confrontabile con la ripartizione che uno si è prefissato prima di sedersi. Le
quattro percentuali quindi **non fanno 100**, e ciò che manca sono i crediti ancora in cassa: non è una
somma da far quadrare, è a sua volta un'informazione.

Il budget iniziale non viaggia nello snapshot e non serve: `crediti + speso` lo ricostruisce, ed è la
stessa identità con cui si controlla a vista che i conti tornino (I3). Ne segue una cosa che vale la
pena sapere prima di trovarsi a spiegarla: **una rettifica di budget sposta tutte e quattro le quote**,
perché `credits` include già le rettifiche e il denominatore è il budget *corrente*. È la lettura
giusta di «crediti a disposizione» — è cambiato il totale su cui si sta ragionando.

La seconda domanda è **«chi ho preso»**, e la risposta era una lista lunga: ventotto righe a rosa
piena, tutte aperte, tutte insieme, su un telefono. Adesso i quattro reparti sono una fisarmonica —
uno aperto per volta, e si può chiudere anche quello — e **il reparto che l'asta sta chiamando adesso è
quello aperto**.

Come si ottiene quell'apertura è la parte che merita il paragrafo, perché la strada ovvia è sbagliata
in un modo che si vede solo in diretta. Un `useEffect` che copiasse `currentRole` in uno stato locale
darebbe due sorgenti di verità, e in un portale che riceve uno snapshot ogni pochi istanti significa un
accordion che si richiude sotto le dita. La strada giusta è una **chiave** sul ruolo in gioco: lo stato
locale non è mai *contro* lo snapshot, è **azzerato** da lui. La proprietà che ne esce è quella che si
vuole davvero — la scelta a mano vale finché il ruolo in gioco non cambia. Aperti i difensori mentre
l'asta chiama i centrocampisti, restano aperti; quando l'asta passa agli attaccanti, la fisarmonica si
rimonta con gli attaccanti aperti.

Sta dentro I10 per la stessa ragione dei due `dismissed*`: **niente è raggiungibile solo perché eri qui
prima**. Chi ricarica ritrova il reparto in gioco aperto e gli altri chiusi, cioè lo stato di chi non
si è mai mosso, e nessuna informazione vive solo dentro un pannello aperto — la riga chiusa dice già
nome, quota e `n/tot`. È ciò che rende accettabile perdere l'apertura con un F5. Ad asta conclusa
`currentRole` è nullo e la rosa completa si presenta come quattro righe chiuse con le quattro quote:
è il riepilogo giusto per quel momento, e chi vuole i nomi apre.

**La fisarmonica vale solo qui.** In regia la rosa resta piatta, perché là servono 8–12 rose a colpo
d'occhio e un accordion le nasconderebbe tutte; e là non ci sono percentuali, perché accanto c'è già la
cifra dello speso e dodici card con quattro percentuali sono quarantotto numeri che nessuno legge. Un
file che deve servire due forme così diverse le serve con **due componenti e un corpo privato
condiviso**, non con una prop booleana che accenda insieme la fisarmonica e le percentuali: sono due
cose, e un flag che ne comanda due è un flag che al terzo chiamante non si sa più cosa significhi.

### La rosa è un diario, non una classifica

C'è una terza cosa che nessuno aveva chiesto e che tutti avevano visto: la lista **si rimescolava**.
Era ordinata per prezzo, quindi un acquisto da 45 crediti non si aggiungeva in fondo al reparto — si
metteva in cima e spingeva giù quello che si era appena finito di leggere. L'ordine in cui le cose sono
accadute è l'unico che non cambia sotto gli occhi, e da M18 è quello che si legge nel portale, in regia
e in TV.

La cosa notevole è che **non è stato aggiunto niente**. La strada che sembra ovvia — «serve un
`assignedAt` nello snapshot» — avrebbe aperto `serializeSnapshot`, il punto più delicato dell'app, per
un dato che c'era già: le assegnazioni si leggono dal database ordinate per data di creazione, e chi
costruisce lo snapshot le filtra per membro senza riordinarle. `member.roster` **era già** in ordine di
estrazione, ed erano le due viste a disfarlo riordinando per prezzo nel client. La modifica è
sottrattiva: due `.sort()` in meno.

Perché quell'ordine sia affidabile dipende da un dettaglio che val la pena conoscere: la data di
creazione di un'assegnazione è **quella del motore**, non un `now()` del database. Se fosse stata del
database sarebbe stata per transazione e non per statement, quindi tutte le assegnazioni scritte in una
transazione sola — quelle di un seed, per esempio — avrebbero condiviso il timestamp, e in locale
l'ordine dentro un reparto sarebbe sembrato casuale: un finto bug, del tipo peggiore, perché si
manifesta solo sui dati di prova. Il perché sta scritto una volta sola e nel punto in cui la garanzia
viene prodotta, non nei due consumatori — con l'avviso che ora un riordino aggiunto lì cambia **tre**
schermate.

Tre conseguenze da conoscere. In TV **il giocatore appena vinto è sempre l'ultima riga piena del suo
gruppo**, cioè un posto fisso, mentre prima l'evidenziazione compariva dove il prezzo la mandava. Una
**riassegnazione va in fondo**, perché annullare e riassegnare crea una riga nuova col momento della
correzione: non è un difetto, la rosa dice quando le cose sono state decise. E il **verbale delle rose**
non è stato toccato: non ordinava per prezzo, quindi era già cronologico — dopo M18 sono le tre viste ad
allinearsi a lui, non il contrario.

### Il sesto caso: l'asta non esiste più

I cinque rientri di §8bis hanno una cosa in comune che non è scritta da nessuna parte: presuppongono
tutti che l'asta ci sia. Da v1.13.0 esiste un sesto caso, e non è un rientro — è il contrario. Un
amministratore può cancellare un'asta **mentre la si sta guardando**, e la domanda che nasce è quella
della settima regola letta al rovescio: se ogni schermata è funzione dello snapshot corrente, cosa
mostra una schermata il cui snapshot non arriverà mai più?

Prima di v1.13.0 la risposta era la peggiore possibile, e non per una dimenticanza ma per il modo in
cui è fatto il canale. Chi apre uno stream viene autorizzato **una volta**, all'apertura; dopo di che
la connessione vive per conto suo e riceve gli snapshot che le mutazioni producono. Cancellata
l'asta, di mutazioni non ce n'è più nessuna: la connessione resta iscritta a un registro che nessuno
interroga più, il commento di keep-alive continua ad arrivare ogni quindici secondi, e il portale
resta fermo sull'ultimo snapshot ricevuto con il countdown congelato. **Non sembra rotto: sembra
lento.** È il sintomo che in una stanza con dieci persone produce dieci ricariche di pagina in
trenta secondi, e chi ricarica trova una schermata che non si apre più — perché la pagina, quella,
l'asta la cerca a database e non la trova. Il keep-alive, che esiste per tenere in vita la
connessione attraverso i proxy delle reti mobili, è anche ciò che rendeva il guasto invisibile: la
connessione era perfettamente sana, semplicemente non aveva più niente da dire.

La cura è un **secondo tipo di evento** sul canale, il primo in tutta la storia dell'applicazione che
non porta uno snapshot: il congedo. Dice una cosa sola — quest'asta non esiste più, e si chiama così
— dopo la quale il server chiude lo stream. Non poteva essere uno snapshot con un campo dentro,
perché uno snapshot è la fotografia di uno stato e di stato non ce n'è più; e non poteva essere il
silenzio, perché il silenzio è esattamente il bug.

Chi lo riceve fa due cose, **in quest'ordine**, e l'ordine è l'unica cosa di questa storia che si può
sbagliare scrivendo codice che sembra funzionare. Prima chiude l'`EventSource`, poi va in dashboard.
Invertirle non produce un errore visibile: produce un client che riconnette da sé — perché uno stream
che finisce è, per la specifica di `EventSource`, un buon motivo per riprovare — e che va a battere su
una rotta che ora risponde 404. Il modo di accorgersene non è guardare lo schermo, che in entrambi i
casi finisce in dashboard: è guardare il pannello di rete e contare le richieste.

In dashboard chi arriva legge che quell'asta, per nome, è stata cancellata da un amministratore. Il
nome viaggia nell'URL, che è l'unico canale che sopravvive alla navigazione: la schermata dell'asta
muore con l'asta, e con lei qualunque stato di React. Per il tempo che la navigazione impiega, la
pagina dell'asta mostra un velo con la stessa frase, perché l'alternativa è far vedere per un istante
il countdown di un'asta che non c'è — la stessa immagine falsa di prima, solo più breve.

La **TV** è l'unico spettatore che non ha una dashboard dove andare: non ha una sessione, e mandarla
al login vorrebbe dire proiettare una schermata di consenso in mezzo alla stanza. Si ferma dov'è, in
bianco su nero come tutto il resto del tabellone, con il nome dell'asta ancora in cima e due righe che
dicono cosa è successo. Lo stream l'ha già chiuso, quindi da lì non riparte niente.

Sul lato server, il congedo tocca una disciplina che vale la pena capire, perché è la stessa che
regge il broadcast: **il motore non sa che esiste un canale verso i client.** `deleteAuction` non
importa nulla di `lib/realtime/`; chiama un hook che di default non fa niente e che il processo
aggancia all'avvio, in `instrumentation.ts`, esattamente come fa da sempre con l'invio degli
snapshot. Nei test, nel seed e nei bot quell'hook resta il no-op, e nessuno di quei processi ha
connessioni aperte da congedare. Il congedo parte **dopo il commit**, fuori dalla transazione: se il
`DELETE` fosse annullato, avremmo già mandato via dodici persone da un'asta ancora viva.

L'hook fa due cose e non una, e la seconda spiega perché passare da lì non è solo una questione di
pulizia. Oltre a congedare le connessioni, **cancella il timer di fase armato** su quell'asta. Un
timer rimasto acceso è innocuo — quando scatta, la mutazione non trova la riga e si spegne con un
rifiuto tipizzato, senza eccezioni e senza una riga di log — ma resterebbe in memoria per sempre,
perché l'unica cosa che lo spegneva era la mutazione successiva di quell'asta, e mutazioni successive
non ce ne saranno. Cancellarlo dall'interno del motore, però, non funzionerebbe: lo scheduler attivo
è una variabile di modulo, e di quel modulo esistono due copie in due bundle diversi, quindi una
chiamata partita da una Server Action girerebbe nella copia in cui non c'è nessun timer. La closure
agganciata in `instrumentation.ts` nasce invece nel bundle dove lo scheduler è stato avviato: da lì il
timer che vede è quello vero. È la stessa proprietà che anni di questo progetto hanno imparato a
riconoscere, applicata a un caso nuovo.

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

**All'apertura il campo prende il focus, e la tastiera sale da sola.** Fino a v1.7.0 era il
contrario, di proposito: il modale si apre da sé quando il round comincia, e una tastiera che
compare senza che nessuno l'abbia chiesta copre due terzi dello schermo nel momento peggiore. È
stato ribaltato dopo averlo usato, perché quel timore descriveva l'apertura e non l'uso — il modale
lo si apre per scrivere un numero, e trenta secondi di countdown non lasciano spazio a un tocco in
più. Il costo che la vecchia scelta temeva, del resto, il layout lo aveva già pagato: countdown e
`max_bid` stanno nell'intestazione dello sheet proprio perché restino leggibili sopra la tastiera.
Il valore già presente viene selezionato, così chi rientra a metà round sovrascrive digitando invece
di dover cancellare.

Il feedback di salvataggio ha una riga fissa tutta sua, che non sposta il pulsante di conferma
quando compare. «L'ansia da *è passata?* a cinque secondi dalla scadenza è il vero problema di UX di
questa app», e la risposta è un `✓ Offerta salvata: 9` che arriva dalla risposta della `fetch`, non
dallo snapshot successivo. La distinzione conta: il verdetto sull'**invio** è immediato, il **mondo**
lo riscrive solo lo snapshot. Non c'è nessun aggiornamento ottimistico dello stato dell'asta.

Due casi hanno un messaggio invece di un silenzio, perché sono quelli che generano discussioni in
diretta: chi riconferma la stessa cifra legge «sei già a 9: nulla è cambiato» (il timestamp resta
quello del primo invio, e nello spareggio è la posizione in coda che conta), e chi ha chiamato il
giocatore legge che l'apertura a 1 è già registrata.

⚠ Quella seconda frase da M16 finisce lì, e la coda che aveva prima — «e non puoi ritirarti, solo
rilanciare» — è stata tolta apposta: dire al chiamante che *lui* non può ritirarsi implica che
qualcun altro possa, e non è più vero per nessuno.

**Nel modale si scrive un numero, e non c'è altro che scriva una cifra al posto tuo.** Fino a
`v1.15.1` sotto al campo c'era una riga di quattro pulsanti — `+5`, `+10`, `+25` e un `max` che ci
scriveva dentro il tetto — e M16 li ha tolti tutti e quattro. Restano `−1` e `+1` ai lati del campo,
per l'aggiustamento dell'ultimo secondo. Le due comodità tolte da questa macro spingevano nella
stessa direzione: la prima trasformava la scelta della cifra in un tocco su un incremento tondo, la
seconda trasformava la busta chiusa in una cosa reversibile, e in un'asta in cui la cifra è l'unica
informazione che conta la comodità è il difetto.

⚠ Il `max NN` nell'intestazione **resta**, e non è una dimenticanza: quel numero non è un valore
suggerito, è il tetto dell'invariante I5 che il server applica a ogni offerta. Toglierlo vorrebbe
dire far scrivere una cifra al buio e poi farla rifiutare dal motore, mentre il vincolo mobile-first
chiede l'opposto — che il tetto resti leggibile anche con la tastiera aperta. È sparito il pulsante
che *scriveva* `max` nel campo, non l'informazione che il tetto è `max`.

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

Da M16 ogni card ha un **pallino prima del nome squadra**: verde chi è collegato, rosso chi non lo
è. Il dato non è nuovo — `member.presence` viaggia in ogni snapshot da sempre, derivato
dall'ultimo heartbeat e dal flag di visibilità della pagina — è nuovo solo il fatto che il tabellone
lo mostri, e serve a una domanda che in quella stanza si fa a voce almeno una volta a serata:
possiamo far partire il round, o manca qualcuno?

Due dettagli di quel pallino non sono ovvi. Il primo: **i colori sono due e non tre**, e `IDLE` —
il tab in secondo piano — conta come collegato. Nel portale la distinzione fra `LIVE` e `IDLE` serve
e `PresenceDot` la mostra in ambra; qui no, perché chi ha il telefono in tasca è nella stanza, e
perché in TV l'ambra è già la pausa ed è già la riconnessione: un terzo significato sullo stesso
colore, letto da tre metri, non si distingue dagli altri due. La mappa da tre stati a due sta in un
posto solo, `tvConnected` in `lib/realtime/portal.ts`, ed è una funzione pura con il suo test.

Il secondo: **la TV non riusa `PresenceDot`**, per la stessa ragione per cui non riusa gli altri
componenti condivisi — quel pallino disegna l'`OFFLINE` con un grigio del tema che su fondo nero
diventa *chiaro*, cioè il contrario di ciò che deve comunicare. Qui i due colori sono scritti a mano.

⚠ E un limite, dichiarato invece che scoperto la sera dell'asta: la presence si ricalcola quando
*qualcuno* batte il colpo. Con otto o dodici telefoni che lo fanno ogni dieci secondi un pallino
diventa rosso entro circa un secondo dalla scadenza della finestra di quindici, ma se si
scollegassero tutti insieme non arriverebbe nessun heartbeat e la TV resterebbe con tutti i pallini
verdi. Non si risolve, ed è una scelta: la cura sarebbe un timer nuovo nel processo, e non vale un
caso in cui non c'è più nessuno da mostrare.

Il quarto rimanente è il lotto in corso — giocatore, countdown, buste aperte — che resta il più
leggibile della colonna ma non più della pagina. **In cima a quella stessa colonna** sta
l'intestazione: nome dell'asta a sinistra, **stato** a destra — in corso, in pausa, conclusa — e
sotto, solo quando serve, l'avviso ambra di riconnessione.

Lo stato è un **badge**, con la forma della primitiva condivisa: è la stessa pastiglia che si legge in
tutta l'applicazione, e uno stato dell'asta è precisamente la cosa per cui quella forma esiste. Non è
però `StatusBadge`, e la ragione è più interessante del solito discorso sul tema nero. Quella
mappa manda `LIVE` e `READY` sulla stessa variante, e `PAUSED` e `COMPLETED` su un'altra stessa
variante: perfetto in una lista di aste dove si legge la riga, inutile qui, perché su uno schermo
proiettato «in corso» e «in pausa» finirebbero **dello stesso colore** e la differenza starebbe solo
nella parola. Ma la domanda a cui quel badge risponde — sta correndo, o è ferma? — è quella che si fa
alzando gli occhi da tre metri, *senza* leggere. Quindi tre famiglie di colore scritte a mano come
tutto il resto della pagina: verde corre, ambra è ferma, bianco smorto non è ancora cominciata o è
già finita. Le parole invece restano condivise (`statusLabel`), perché lì non c'è niente da dire in
modo diverso e due elenchi di etichette divergerebbero.

⚠ Il badge è `outline` e non pieno, **anche per la pausa**, e non è timidezza: il richiamo forte per
l'asta ferma esiste già ed è il cartello ambra in fondo alla stessa colonna, che dice la cosa in più —
i countdown sono fermi. Due allarmi ambra impilati nella stessa colonna si annullano a vicenda.

Quell'intestazione era una striscia a tutta larghezza sopra le due colonne, e stava per un motivo che
suona ragionevole: è un'intestazione, le intestazioni vanno in cima. Solo che il costo non lo pagava
lei. Trentasette pixel a tutta larghezza, su un tabellone di due righe, sono diciotto pixel in meno
per card, cioè **una riga di rosa in meno in ognuna** — su una pagina il cui unico vincolo dichiarato
è l'altezza, e che a ottocento pixel smette di essere leggibile. Dentro la colonna del lotto lo stesso
testo non toglie niente a nessuno: quella colonna ha spazio verticale da spendere, il tabellone no.
La lezione è generale e vale oltre questa pagina: in un layout dove una zona è satura e l'altra non lo
è, un elemento condiviso da entrambe va messo in quella che non lo è, anche quando la convenzione
dice altro.

Nella stessa passata l'intestazione ha perso due cose. Il **marchio dell'asta di prova**: il badge
compare ovunque nell'app perché chi lavora tiene aperte due schede identiche e non deve confondersi,
ma la TV non è la scheda di nessuno — è proiettata in mezzo alla stanza, e chi la guarda sa già se la
serata è una prova. E la **fase** («offerte», «spareggio»): la colonna sotto la racconta in grande,
quindi ripeterla in piccolo a due centimetri era due volte la stessa informazione nello stesso
sguardo. Resta lo stato, che invece non è ridondante con niente: risponde alla domanda di chi alza gli
occhi e trova tutti i numeri immobili — sta correndo, o è ferma?

L'avviso di riconnessione è sopravvissuto al taglio di proposito, ed è l'unica cosa in pagina che
sappia dirlo: se lo stream cade, il tabellone resta pieno di numeri che sembrano validi.

**La forma non cambia mai**, nemmeno nel momento più teatrale. Al reveal le buste si aprono nella
colonna mentre nel tabellone la card del vincitore si accende, col giocatore appena aggiudicato in
evidenza dentro la sua nuova rosa: l'assegnazione è già scritta quando le buste si aprono, quindi
quel nome comparirebbe lì comunque. I due lati raccontano insieme la stessa cosa — chi ha vinto, a
quanto, e com'è adesso la sua rosa — e il recap non sparisce proprio nell'istante in cui uno vuole
confrontare i crediti residui.

In quell'elenco, accanto a ogni cifra, c'è **quando quella busta è stata fissata**: `+0s`, `+3s`. Il
telefono lo mostrava da sempre e il proiettore no, e mancava nel posto dove serve più che altrove:
quando due hanno offerto lo stesso numero, la domanda che parte a voce in quella stanza è «e chi c'era
arrivato prima?», e la risposta era su dieci telefoni invece che sullo schermo che tutti stavano
guardando.

⚠ **Il conto parte dalla prima busta del round, non dall'apertura del round**, e chi legge «+3s» come
«tre secondi dopo il via» lo legge male. Le ragioni sono due. La prima è a cosa serve il numero: a
parità di importo vince `MIN(amount_set_at)`, quindi ciò che conta è l'ordine *fra* le buste, e
prendere la prima come zero lo rende leggibile senza sottrazioni a mente. La seconda è che l'apertura
del round non è un istante affidabile a posteriori — nello snapshot c'è `endsAt`, e una pausa in mezzo
al round lo trasla: un «+3s» contato da lì cambierebbe da sé dopo una pausa, cioè mentirebbe
precisamente nelle sere in cui qualcosa è andato storto.

Il dato e l'ordine stanno in `lib/realtime/portal.ts` (`revealBaseMs`, `bidOffsetLabel`,
`compareRevealBids`) e non nei due componenti che li disegnano. Prima vivevano dentro il pannello del
telefono, che era giusto finché il lettore era uno; con due schermi una copia per schermo
significherebbe che una sera la stessa busta è `+3s` sul telefono e `+4s` sul proiettore — in quella
stanza non è un dettaglio, è una discussione. Nello spostarli è emersa una conseguenza che il pannello
del telefono aveva già risolto e la TV no: le buste vanno ordinate per importo **e poi per tempo**,
perché due `40` in ordine arbitrario con i secondi scritti accanto si leggono come una classifica
sbagliata, e nello spareggio quella è esattamente la classifica che ha deciso.

Due cose sopravvivono dalla versione precedente, ed è perché non dipendevano dalla distanza. Niente
hover, niente scroll, niente click: nessuna informazione può stare dietro a un'interazione, perché
chi guarda non ha un mouse. E bianco su nero **fisso**, perché uno schermo condiviso non ha una
preferenza e un tema chiaro in una stanza al buio è illeggibile.

Quel nero merita una precisazione, perché è facile leggerlo per ciò che non è: **il resto
dell'applicazione non ha un tema scuro da cui la TV si stia distinguendo.** Non c'è nessun
interruttore, e la preferenza di sistema non viene letta da nessuna parte: l'app gira in chiaro,
sempre. La TV è l'unico posto in cui la classe `.dark` è attiva, e la accende da sé — è una scelta di
quella pagina, non un tema dell'applicazione. Da qui la regola in `CLAUDE.md`: **non si scrivono
varianti `dark:`**, perché sarebbero colori che nessuno può guardare e quindi nessuno può verificare —
si scrivono convinti di aver coperto un caso e restano sbagliati per mesi senza che si veda. Il giorno
che un tema scuro servirà davvero, i colori si tratteranno tutti insieme e guardandoli.

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
dentro. Può chiederla l'owner, e da M6 anche un amministratore dell'applicazione, che è l'unica
azione del pannello sopra un'asta di qualcun altro. E la conferma non è un `confirm()`, che si clicca
per riflesso: **si scrive il nome dell'asta**, così chi sta cancellando la cosa sbagliata se ne
accorge mentre scrive il nome sbagliato.

Da v1.13.0 quel rifiuto ha **una strada in più, e non è dell'owner**. Fino a M11 un'asta in corso non
si poteva chiudere in nessun modo: non esiste un'azione «termina asta», a `COMPLETED` si arriva solo
giocando fino in fondo, e la cancellazione era rifiutata a tutti. Il giorno in cui una simulazione
messa in pausa la sera prima ha bloccato un rilascio, quel vicolo cieco è diventato visibile — non
c'era nessun gesto, in nessuna schermata, capace di togliere di mezzo quell'asta. Adesso c'è, ed è
**solo dell'amministratore**: l'owner continua a sentirsi rispondere che l'asta è in corso, e il
messaggio gli dice anche chi può interromperla. Non è avarizia — è che la sua asta la stanno guardando
altre undici persone, e chi la interrompe deve essere qualcuno che non sta giocando. Il permesso si
rilegge dal database dentro il lock: la sessione è un JWT e non sa niente di `is_admin`, quindi
chiedere di forzare senza esserlo non cancella niente.

Su un'asta in corso l'avviso è diverso, e la differenza non è il tono: **nomina quante persone sono
collegate in quel momento**, contandole nel registro delle connessioni. «Ci sono tre persone collegate:
verranno riportate alla dashboard» si legge; «questa azione è irreversibile» si clicca, perché
l'abbiamo letto tutti mille volte. E con nessuno collegato la frase cambia ancora, perché scrivere
«0 persone verranno riportate» farebbe sembrare una serata interrotta quella che è una prova buttata.

Resta un fatto da guardare in faccia: su un'asta vera conclusa se ne vanno il verbale delle rose e
lo storico, perché ogni tabella ha `cascade` su `auction_id` — `events` compresa. L'unica cosa che
sopravvive è una riga su stdout, quella che si rilegge con `pm2 logs`, e da v1.13.0 quella riga dice
anche se la cancellazione è stata forzata e **quante connessioni ha congedato**: è la differenza fra
«ho buttato via una prova» e «ho interrotto una serata». È scritto qui perché quella riga è tutto ciò
che resterà da leggere.

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

## Il pannello di amministrazione, e ciò che non può fare

`users.is_admin` esiste dal primo giorno del progetto, e per un anno ha voluto dire una cosa sola:
creare aste simulate e riempirle di bot. Non c'era nessun posto da cui guardare chi è iscritto,
nessun modo di correggere un nome scritto male, e nessun modo di cancellare l'asta di qualcun altro.
M6 costruisce quel posto, su `/admin`, e la sua descrizione onesta comincia dalla fine: **è un
pannello che vede tutto e tocca il meno possibile.**

Conviene raccontarlo così, e non per schermate, perché la parte difficile di questa macro non è
disegnare due tabelle. È che il pannello gira **sulla stessa macchina e nello stesso processo
dell'asta vera**: la domanda da cui è nato non è cosa può fare un amministratore, è cosa **non** può
fare mentre dodici persone stanno offrendo.

### Il perimetro

**Nessuna azione sull'asta, tranne cancellarla.** Niente pausa, niente avvio, niente override,
niente riassegnazioni, niente rettifiche di budget. La plancia di comando è la regia e resta
dell'owner. Un secondo posto da cui si comanda la stessa asta sono **due verità sullo stesso stato**,
che è il modo in cui questa applicazione si romperebbe peggio — e sarebbe anche un secondo posto in
cui ricordarsi le regole sulle fasi, cioè un secondo posto in cui sbagliarle. La cancellazione è
l'unica eccezione, e `deleteAuction` è la funzione che c'era già.

Da v1.13.0 quell'eccezione è anche l'unico punto dell'applicazione in cui un'asta **in corso** può
essere fermata, e resta dentro lo stesso perimetro invece di allargarlo: interrompere un'asta non è
comandarla. Un amministratore non può metterla in pausa, non può farla avanzare e non può correggere
una rosa — può soltanto farla finire di esistere, dicendo prima quante persone sta per mandare a casa.
Il confine è lo stesso di prima, letto con attenzione: non «non toccare le aste degli altri», ma «non
esistere come secondo posto da cui si gioca».

**Nessuno stato di gioco nelle liste.** La lista aste mostra nome, owner con la sua email, stato,
posti, membri, il marchio delle simulazioni e le date. Non i lotti, non le offerte, non le rose. Non
è pigrizia: è come si rispetta **I8**, l'invariante per cui nessun importo di offerta lascia il
server mentre un lotto è aperto. Il modo fragile di onorarlo è mostrare lo stato di gioco
sanificandolo con attenzione; il modo solido è **non avere niente da sanificare**. Chi vuole vedere
un'asta la apre da dove si aprono le aste — il pannello dà il link e non duplica la vista — e la
regola per cui lo stato dell'asta esce solo da `serializeSnapshot` resta intatta, perché da qui non
esce affatto. Il test che lo protegge guarda **la risposta e non la pagina**, e lo fa con l'insieme
esatto dei campi della riga: un `expect(row.topBid).toBeUndefined()` nominerebbe un campo morto, e
non vedrebbe l'informazione rientrare un giorno sotto un altro nome.

**Nessuna sospensione degli utenti, e nessuna modifica delle email.** La prima è stata valutata e
rimandata, con il ragionamento conservato nel file della macro; la seconda è un potere che
l'applicazione non ha motivo di avere — da quando si entra anche con una password, l'indirizzo è la
chiave d'identità, e riscriverlo vuol dire cambiare *chi può entrare* in quell'account. Un indirizzo
sbagliato si risolve rifacendo l'account, che a dodici utenti è praticabile.

**Nessun secondo livello di amministrazione.** «Super admin» e `is_admin` sono la stessa cosa, un
flag solo: una gerarchia su due persone è una gerarchia senza nessuno da gerarchizzare. E nessun log
di audit: le tre azioni sul singolo utente sono correzioni di dati, e la sola distruttiva — la
cancellazione di un'asta — scriveva già la sua riga su stdout, con `actor` dentro. Una cancellazione
fatta da un amministratore era quindi tracciata dal giorno in cui quella riga è stata scritta, senza
aggiungere niente.

### La guardia, che è la cosa meno ovvia

C'è un layout su `/admin` che rimanda in dashboard chi non è amministratore. **Quel layout non
protegge il pannello.** Le server action sono endpoint raggiungibili per conto proprio — un `POST`
con l'id dell'azione dentro, che non attraversa nessun layout e non apre nessuna pagina — e un
pannello protetto solo dal layout è un pannello aperto. È l'equivalente, per questa macro, di quello
che in M5 era il furto d'account: la cosa che sembra un dettaglio e che fa danno se la si semplifica.

Quindi la guardia è distribuita, su tre piani che rispondono a tre domande diverse:

1. **`requireAppAdmin()` in cima a ogni pagina e a ogni server action.** Nel layout ci sta anche, ma
   solo per dare un redirect pulito invece di un errore. Nelle action sta **prima di leggere un campo
   della `FormData`**, così il rifiuto non dipende da cosa c'è nel form.
2. **Il motore rilegge `is_admin` dal database** a ogni scrittura. La sessione è un JWT e non sa
   niente dei permessi: senza questa rilettura, chi è stato appena declassato continuerebbe a
   comandare fino alla scadenza del suo token. È il precedente che la simulazione aveva già scelto,
   dove `fillWithBots` rilegge il flag dentro il lock benché l'azione l'abbia già verificato.
3. **Il test enumera gli export del modulo delle action** e li chiama tutti, direttamente, con la
   guardia che rifiuta — e con un'uguaglianza esatta sui nomi, non un «almeno questi». Il giorno in
   cui qualcuno aggiunge un'azione al pannello, quel test si rompe e lo obbliga a guardare in faccia
   la riga della guardia.

`requireAppAdmin()` passa per la scala di `requireUser()` **per intero** e non la scavalca: un
amministratore non verificato è un utente non verificato, e il pannello non è una porta di servizio
che aggira l'identità.

### La pagina utenti: una tabella che si legge, un pannello che modifica

Le azioni sul singolo utente sono quattro. **Correggere il nome**, che è l'unico modo di sistemare
l'«asdf» scritto da un amico nell'onboarding: applica la stessa regola dell'onboarding, perché quella
regola è salita in `lib/domain.ts` quando il secondo chiamante è arrivato davvero. **Forzare la
verifica dell'indirizzo**, di cui fra un attimo. **Dare o togliere `is_admin`**, mai sulla propria
riga: un click e ci si chiude fuori tutti, e senza pannello non si rientra dal pannello — il divieto
vale in entrambe le direzioni, anche per riconfermarsi un permesso che si ha già, perché l'eccezione
«ma darselo è innocuo» è il gradino da cui il caso pericoloso rientra. E **dare o togliere `is_pro`**,
cioè gli insight sul listone, dove quel divieto invece non c'è: quel flag non apre nessuna porta, e un
amministratore vede gli insight comunque. Su un bot i due flag sono rifiutati prima della query, e
comunque lo rifiuterebbe il `CHECK` a database: il controllo esplicito serve a rispondere con una
frase leggibile invece che con un 500.

Da v1.14.0 **nessuna di queste quattro funzioni del motore è cambiata**. È cambiato *da dove si danno*:
dove c'erano quattro Server Action, una per campo, adesso ce n'è **una sola**, ed è l'unica azione
dell'applicazione che scrive su una riga di `users`. Le quattro vecchie sono state tolte nello stesso
momento in cui la schermata ha smesso di chiamarle, e vale la pena dire perché non sono state lasciate
lì: una server action senza chiamanti non è codice morto inerte, è un endpoint scrivibile che nessuna
schermata apre più — cioè superficie di cui nessuno si accorge se un giorno smette di comportarsi bene.
Il meccanismo che ha reso sicura la pulizia è lo stesso test che di solito fa il rumore opposto: l'elenco
**esatto** degli export del modulo, che era nato per rompersi quando un'azione nasce senza guardia, e che
qui ha confermato che non restava in giro nessun riferimento.

E vale la pena raccontare anche cos'era sbagliato nella forma di prima, perché è un errore di quelli che
si commettono senza accorgersene.

Fino a v1.13.0 la pagina era una tabella di otto colonne, e in quattro di quelle colonne c'era un
form: un campo di testo col suo «Salva», «Verifica a mano», «Rendi admin», «Dai insight». Ogni riga
montava quattro stati di form — su dodici righe sono quarantotto, montati per *guardare* una lista — e
la tabella aveva una larghezza minima che la faceva scorrere in orizzontale su qualunque schermo,
perché ogni cella doveva contenere un comando invece di un dato. Il risultato è che la domanda più
frequente, *chi è questa persona e le manca qualcosa per entrare?*, si rispondeva peggio della più
rara, che è *cambiamo qualcosa a questa persona*.

Adesso le due domande hanno due posti. **La tabella è un elenco**: sei colonne, dati e nient'altro —
indirizzo, nome, e tre `Sì`/`No` per email verificata, admin e pro — più un pulsante «Vedi». La riga
non ha nessun hook e nessuna azione, e la larghezza minima è sparita insieme ai form che la
giustificavano; il contenitore che scorre resta, perché la colonna dell'indirizzo è lunga e
imprevedibile ed è l'unica cosa che può ancora costringere allo scorrimento.

Una sola di quelle tre celle è scritta in modo da vedersi da lontano, e non è un vezzo grafico: **è
l'ordine della lista**. La lista è ordinata dal più recente perché la riga su cui un amministratore
deve agire è quasi sempre quella di chi si è appena iscritto e non riesce a entrare, e quella riga si
riconosce da «Email verificata: No». È l'unico valore della tabella che chiede un intervento, quindi
prende il tono `destructive` che l'applicazione usa già, mentre `Admin: No` e `Pro: No` sono il caso
normale e restano testo normale. Il criterio è scritto accanto al codice perché non venga esteso per
simmetria: **si evidenzia ciò su cui si deve agire, non ciò che è raro.** E la parola c'è sempre — il
colore non è mai l'unica informazione, che qui vale doppio perché non c'è nessun numero accanto a fare
da appoggio.

**La ricerca sta nell'intestazione della tabella e filtra nel browser**, sulle righe già in pagina.
Non è una `searchParam` e non è una query nuova: la pagina carica già tutti gli utenti, quindi cercare
vuol dire nascondere righe che sono già arrivate, e la risposta arriva mentre si digita — l'unico
comportamento accettabile per un campo di ricerca. È la differenza col filtro dei bot, che invece vive
nell'indirizzo proprio perché cambia **quali righe il server manda**. Il confronto riusa la `fold()`
di `lib/realtime/portal.ts`, che era già la ricerca della lista di chiamata e quella della regia:
questo è il suo terzo chiamante, e la ragione per cui non se ne scrive una copia è la stessa scritta
là — due ricerche che rispondono diversamente a «citta» sono una piccola bugia difficile da spiegare,
e su un cognome accentato la bugia diventa «quella persona non si è iscritta». Il conteggio in cima
**segue il filtro**, perché «20 righe» sopra una tabella che ne mostra tre sarebbe la prima cosa a
mentire, e zero risultati si dice a parole: una tabella con la sola intestazione sembra un guasto.

**La paginazione resta fuori, e non è la stessa decisione della ricerca.** Un filtro su righe già
caricate non ha nessuna «pagina 2» in cui una riga possa nascondersi; la paginazione invece cambia il
contratto della pagina, e nel momento in cui esiste la ricerca lato client diventa una bugia, perché
cercherebbe solo dentro la pagina corrente. Quel giorno arriveranno insieme, ricerca lato server
compresa. Il numero che tiene in piedi la scelta è stato **misurato** all'apertura della macro invece
di essere ereditato da M6: venti utenti veri in produzione, trentadue contando i bot.

**Le modifiche stanno in un pannello laterale** che si apre da «Vedi». È costruito con `Dialog` di
`radix-ui` a mano, senza aggiungere nessuna primitiva condivisa in `components/ui/`: il precedente è
letterale — il modale d'offerta fa lo stesso — e la ragione è che le primitive si allargano quando
arriva il secondo chiamante *generico*, mentre uno sheet dal basso per un pollice sotto un countdown
non ha niente da condividere con un pannello da scrivania oltre l'overlay. Gli interruttori sono lo
`Switch` di `radix-ui`, non la variante Base UI a cui rimandava la richiesta: quella pagina monta una
seconda libreria di primitive accanto a quella che il progetto usa in ogni componente, per un
interruttore.

Il pannello è anche il primo posto che ha lo spazio per dire tutto: le tre colonne che se ne sono
andate dalla tabella — da quale porta entra, quante aste possiede e quante ne gioca, quando si è
iscritto — e **quando** l'indirizzo è stato verificato, non solo se, che è ciò che distingue un
indirizzo dimostrato da sé da uno verificato a mano la sera dell'asta. L'email è testo e non un campo
disabilitato, con la spiegazione accanto invece che in fondo alla pagina: un input grigio suggerisce
che da qualche parte esista il modo di abilitarlo. Su un bot non c'è nessun comando, e c'è scritto
perché.

**Lo switch della verifica è asimmetrico, e va guardato in faccia.** `forceVerifyEmail` sa fare una
cosa sola: scrivere `email_verified_at`. Una de-verifica non esiste e non deve esistere, perché
spegnerla vorrebbe dire rispedire una persona alla schermata del codice, cioè chiuderla fuori
dall'applicazione con un click. Ma uno switch **promette due direzioni**: quindi acceso e bloccato
quando l'indirizzo è dimostrato, con la ragione scritta accanto, e spento e attivabile quando non lo
è. È l'unico dei tre che ha uno stato terminale, e chi lo legge deve capirlo senza provarci. Per la
stessa ragione lo switch di `is_admin` **non esiste** sulla propria riga invece di essere spento — il
motore lo rifiuterebbe comunque, ma un pulsante che esiste è un pulsante che qualcuno premerà — mentre
quello di `is_pro` c'è, perché la differenza fra i due flag è di sostanza e non di simmetria.

**Il salvataggio è uno solo, e non è atomico.** Sono quattro `UPDATE` distinti su `users` — nessun
lock, perché non c'è nessuna asta da serializzare e `is_bot` non cambia mai dopo la creazione della
riga — quindi un salvataggio può riuscire a metà, e la UI non deve far finta del contrario: l'esito si
riporta **per campo** e il modale si chiude solo se tutto ciò che era stato chiesto è passato.
Chiudersi dicendo «fatto» dopo aver scritto tre cose su quattro è il modo di rendere inaffidabile
l'unico pannello di amministrazione che c'è. Il server sa cosa è cambiato dalla **presenza del campo**
nella `FormData`: il pannello monta l'input nascosto solo quando quel valore differisce da quello che
gli era arrivato, perché l'azione non legge il database e non può fare nessun confronto — e non deve,
dato che l'autorizzazione la fa il motore rileggendo `is_admin` a ogni mutazione. Un client che
mentisse otterrebbe una `UPDATE` che riscrive il valore che c'era già.

E c'è **un toast**, che è arrivato guardando la pagina invece che leggendo la spec: l'esito per campo
dentro il pannello è la cosa giusta finché il pannello **resta aperto**, cioè quando qualcosa è andato
storto — ma a pieno successo il pannello si chiude, e il messaggio se ne andava con lui. Restava una
tabella che si aggiornava e nient'altro, quindi un salvataggio riuscito era indistinguibile da un click
andato perso. Il toast vive perciò **fuori** dal pannello, in `UsersTable`, che è ciò che sopravvive alla
chiusura: il pannello riporta il proprio esito verso l'alto e non decide più di chiudersi da sé. Ha tre
toni e non due — riuscito, **riuscito a metà**, rifiutato — perché il caso di mezzo è quello che va detto
meglio: «errore» farebbe riprovare tutto, «salvato» nasconderebbe il campo che non è passato. È fatto con
`Toast` di `radix-ui` e non con quello di shadcn, che oggi è un involucro attorno a `sonner`: la stessa
decisione dello `Switch`, presa due volte nello stesso giorno perché entrambe le richieste linkavano
shadcn — e «usa il componente di shadcn» significa «voglio quel comportamento», non «monta quella
dipendenza».

I **bot stanno dietro un filtro** e per default non ci sono: sette righe «Bot 3» per ogni asta
simulata sono l'unico modo in cui una lista di dodici amici può diventare illeggibile. E i due numeri
con cui si capisce se una riga è una persona o un residuo — quante aste possiede, quante ne gioca —
sono indipendenti, perché l'owner che organizza senza giocare possiede un'asta e non ne gioca nessuna.

### Il pulsante che chiude una finestra

La verifica manuale merita un paragrafo suo, perché è la ragione per cui questa macro esisteva già
prima di essere scritta. Con l'identità di M5 in produzione e senza pannello, un amico a cui l'email
non arriva ha un solo rimedio: una `UPDATE` a mano sul server, la sera dell'asta, sotto pressione.
Quella riga di SQL era scritta per esteso nel file di M5 proprio perché si potesse copiare invece di
comporla. **Adesso è un pulsante.**

Funziona perché la verifica non ha eccezioni: `isVerified` è una condizione sola — la colonna è
scritta o non lo è — quindi scrivere la colonna **è** far passare il gradino di mezzo della scala.
Il test lo prova con `isVerified` autentico, non con una copia del predicato: una copia dimostrerebbe
che la colonna viene scritta, non che la persona entra. Ed è ripetibile, senza riscrivere un
timestamp che c'è già: è la lezione del backfill di M5, dove un comando che si può dare una volta
sola è un comando che qualcuno darà due volte.

Ha un prezzo che va detto ad alta voce. Quando Google si aggancia a una riga **non verificata**,
l'applicazione azzera la password: è la difesa contro chi si registra con l'indirizzo di qualcun
altro e aspetta. Su una riga verificata quella difesa non scatta più — giustamente, perché
l'indirizzo è dimostrato. Forzare la verifica significa quindi **mettere la propria parola al posto
della prova**, e va fatto per una persona che si ha davanti, non per un indirizzo che si legge in una
tabella.

### La navigazione, e il fatto che sia roba da scrivania

La sidebar esce da `lib/admin-nav.ts`, costruito sul modello di `lib/auction-nav.ts` e per la stessa
cicatrice: etichetta, titolo e segmento di URL sulla stessa riga, così il titolo in cima alla pagina
e la voce da cui ci si è arrivati non possono raccontare due cose diverse. Zero dipendenze, perché lo
legge il componente client che evidenzia la voce attiva. A differenza delle sezioni di un'asta **non
c'è nessun parametro «chi guarda»**: qui il ruolo è uno solo, e una navigazione che filtra è una
navigazione che prima o poi qualcuno confonderà per una difesa. `/admin` non è una schermata: è una
porta, e atterra sulla prima voce della sidebar ricavata dalla lista, non da una stringa scritta due
volte.

Dalla versione 1.11 una voce è **annidata** — il Centro dati, sotto il listone — e questo ha
richiesto di riscrivere la funzione che decide quale voce è accesa: guardava il primo segmento dopo
`/admin` e basta, quindi su `/admin/listone/dati` avrebbe acceso «Listone» e messo in cima alla
pagina il titolo sbagliato. Adesso vince il percorso più lungo che combacia. È esattamente il bug
per cui quel file esiste, ripresentatosi in una forma nuova; il test che lo copre nomina il percorso
per esteso.

Il pulsante «Admin» in navbar compare solo a chi è amministratore, e la navbar riceve **un
booleano** e non la riga dell'utente: è un client component, e il tipo `User` si porterebbe dietro
l'ORM fino al telefono.

Infine una cosa dichiarata invece che accaduta per caso: **il pannello è roba da scrivania.**
Tabelle dense, sidebar laterale, nessuna ottimizzazione per il pollice; su schermi stretti le tabelle
scorrono in orizzontale invece di riflowire in un elenco lunghissimo — la pagina utenti da v1.14.0 non
ha più bisogno di scorrere su un portatile, ma il contenitore che lo permette è rimasto, perché un
indirizzo email lungo è più largo di qualunque previsione. Il pannello laterale segue la stessa
regola: su uno schermo stretto prende tutta la larghezza invece di diventare una colonna accanto a una
tabella che non c'è più — non è mobile-first, è non-rotto-sul-piccolo. Il mobile-first è del portale
del partecipante — lì si offre dal telefono, sotto pressione, con trenta secondi di countdown — e
resta suo. Il pannello si apre da un portatile, con calma.

---

## Le figurine dei calciatori

Quando un giocatore viene chiamato all'asta, la stanza guarda lo schermo e chiede «chi è?». Fino a
v1.7.0 trovava un nome, una squadra e un numero. Fantacalcio.it disegna per ogni giocatore una
**figurina** — la caricatura dentro una carta con lo scudetto e il ruolo — e quella figurina è
esattamente la risposta a quella domanda, a colpo d'occhio, da tre metri di distanza. Questa parte
dell'applicazione la scarica una volta e la mostra per tutta la serata. Non fa nient'altro, e il
capitolo racconta soprattutto **perché non fa nient'altro**.

### Venti richieste vere hanno tolto tre pezzi di architettura

È la cosa da portarsi via da qui, ed è successa prima che venisse scritta una riga di codice.

La prima versione di questa funzionalità era progettata attorno a un'operazione lunga. Cinquecento
richieste HTTP a un CDN esterno sembrano una cosa da gestire bene: scaricamento a lotti da
venticinque, la lista degli id parcheggiata in un file `listone.json` fra un lotto e l'altro, una
pagina che si richiama da sé per far avanzare il lavoro, un pulsante «Ferma», una condizione di
terminazione per il caso «nessun progresso». Tutto ragionevole, tutto approvato a voce, e tutto
inutile — perché nessuno aveva provato quanto ci mettesse.

L'owner ha chiesto «l'hai provato?», e la risposta è stata un prototipo in Node — la stessa `fetch`
che avrebbe usato l'applicazione, non `curl`, così un CDN che rifiutasse un client non-browser si
sarebbe visto subito — lanciato sui 495 id di un listone vero:

```text
495 su 495 scaricate · 0 errori · 0 403 · 0 risposte non-PNG
51,56 MB in 7,3 secondi · mediana 18ms · peggiore 234ms
concorrenza 4 · timeout 10s per richiesta · nessun 429
```

Sette secondi. Il batching, il file di stato e il pulsante «Ferma» servivano a sopravvivere a
un'attesa che non esisteva, e sono spariti tutti e tre. Al loro posto è rimasta **una server action**
che fa il lavoro dentro la richiesta e risponde con i numeri, più una scadenza a venti secondi che
sta in tre righe: se un giorno il CDN fosse dieci volte più lento la passata si ferma da sé e dice
quante ne restano, si ripreme il pulsante e riprende. Venti secondi e non sessanta perché
`location /` in nginx non imposta `proxy_read_timeout` e vale il default di un minuto — il timeout
lungo di un'ora è solo sulla rotta dello stream — quindi il margine è di tre volte su quanto misurato
e resta comodamente sotto il taglio del proxy.

Lo stesso collaudo ha tolto un secondo pezzo. Ci si aspettava che i giocatori senza caricatura
dessero `403`, e quindi era previsto un marcatore su disco per non riprovarli all'infinito. Non è
così: a chi non ha la foto quel CDN restituisce una **sagoma senza volto con la maglia del suo
club**, che è un `200` come tutti gli altri — 144 giocatori su 495, il 29%, in venti varianti. Il
`403` arriva solo per id che non sono giocatori (provato con `1` e `99999`). Non c'era nessun assente
da marcare, e i marcatori sono spariti.

La morale è scritta qui perché varrà anche per la prossima cosa da scaricare da fuori: **venti
richieste vere hanno tolto tre pezzi di design già approvati.** Prima di progettare attorno a un
costo, misurarlo.

### Lo stato è il disco

Non c'è nessuna tabella e nessuna colonna: questa macro non ha toccato lo schema. «Questa figurina ce
l'abbiamo?» lo risponde **un file che c'è o non c'è**, in `storage/campioncini/<extId>.png`, dove
`extId` è la colonna `#` del listone, quella che il progetto salva già in `players.ext_id`. Nel nome
c'è solo l'id e mai il nome del giocatore, perché il giorno che il listone scrivesse «Martinez L.» in
un altro modo il file diventerebbe orfano.

Da questa scelta discende gratuitamente la proprietà che conta: **l'operazione è ripetibile per
costruzione.** La si può dare due volte, e la seconda non scarica niente — non «riscarica e
sovrascrive»: proprio non parte, perché la lista di cosa manca è la differenza fra gli id del listone
e i nomi dei file nella cartella. Non c'è nessuno stato da tenere allineato, quindi non c'è nessuno
stato che possa disallinearsi.

L'unico dettaglio di implementazione che vale la pena conoscere è che ogni file viene scritto con un
nome temporaneo e poi rinominato. Il rinomino è atomico, quindi un file che porta il nome di un id è
completo per definizione: senza, un processo interrotto a metà scrittura lascerebbe un'immagine
troncata che nessuno riproverebbe mai più, proprio perché per noi «ce l'abbiamo» significa «il file
c'è».

### `storage/` e non `public/`, e la trappola che l'ha deciso

La cartella naturale per delle immagini sarebbe `public/`. Sarebbe stata una bomba a orologeria.

In produzione il server standalone di Next fa `process.chdir(__dirname)`: gira quindi con la working
directory in `.next/standalone`, e la sua `public/` è `.next/standalone/public` — che
`deploy/deploy.sh` **cancella e ricopia a ogni rilascio**. Cinquantatré megabyte di figurine
scaricate a settembre sarebbero spariti al primo deploy di ottobre, in silenzio, e il sintomo sarebbe
stato «le figurine non si vedono più» senza nessun errore da nessuna parte.

`storage/` invece non la sfiora nessuno: sta nel `.gitignore`, `git reset --hard` non rimuove i file
non tracciati e `pnpm build` non ci entra. L'archivio sopravvive a ogni rilascio e anche a un ritorno
a un tag precedente. È stato verificato con un file finto prima di scrivere il downloader, perché
tutto il disegno dell'archivio poggia su quella proprietà.

Il percorso lo calcola `deploy/ecosystem.config.cjs`, che già risolve la radice del progetto per pm2:
passa `MEDIA_DIR` nell'ambiente del processo, così in produzione non c'è nessun percorso da scrivere
a mano. In sviluppo il default è `<cwd>/storage`, che sotto `pnpm dev` è la radice del progetto — ed
è esattamente perché sotto `.next/standalone` la working directory è un'altra che in produzione la
variabile si passa invece di indovinarla.

### La difesa della rotta, ed è una sola

I file li serve l'applicazione, su `GET /api/campioncini/<extId>.png`, con `ETag` da dimensione e
mtime e una cache di un giorno: durante una serata ogni browser scarica ogni figurina una volta sola.
Senza sessione, di proposito — la vista TV è un browser senza login, e il giocatore in asta è
pubblico per definizione: è la busta a essere segreta, non chi è stato chiamato.

**Questa rotta è il punto pericoloso dell'intera macro**, ed è l'equivalente di ciò che in M6 era la
guardia in cima a ogni server action: prende un pezzo di URL scritto da chi sta dall'altra parte e
con quello costruisce un percorso su disco. `..%2f..%2f.env.png` non deve nemmeno arrivare al
filesystem.

La regola per non sbagliare non è «sanificare la stringa» ma **non usarla affatto**. Il parametro
passa da una funzione che accetta soltanto `^\d+\.png$` e restituisce un intero o `null`; il nome del
file lo costruisce poi un'altra funzione a partire da quell'intero. La stringa che è arrivata da
fuori non tocca mai `path.join`, quindi non c'è nessuna sanificazione da fare bene — non c'è proprio
niente da sanificare.

Un dettaglio che sembra cosmetico e non lo è: un ingresso malevolo riceve **`400`, non `404`**. La
differenza è l'evidenza che il test cerca. `400` significa rifiutato dal validatore, cioè prima che
esistesse un percorso da cercare; `404` significherebbe che il percorso è stato costruito e il disco
interrogato. Il test di quel rifiuto è stato scritto prima della rotta ed è stato visto fallire.

### Le sagome senza volto, tenute apposta

144 giocatori su 495 non hanno una caricatura e ricevono la sagoma con la maglia del club. Si salvano
e si mostrano come tutte le altre: un `200` è un `200`, e nel codice non esiste nessun riconoscimento.

Non è pigrizia, sono tre ragioni. La sagoma è **riconoscibile per quello che è** — non ha scudetto né
nome stampato, mentre le figurine vere li hanno — quindi nessuno penserà che l'applicazione sia
rotta. Il riquadro del lotto **non cambia mai forma**, perché ogni giocatore del listone ha
un'immagine: se le sagome venissero scartate, quasi un lotto su tre avrebbe un riquadro più corto e
il pulsante d'offerta si sposterebbe mentre un pollice lo sta cercando. E scartarle richiederebbe
riconoscerle, cioè venti impronte scritte nel codice che **cambiano alla prossima edizione**: un
riconoscimento che un giorno smette di funzionare in silenzio, che è il modo peggiore di rompersi.

### L'unica parte che invecchia

L'indirizzo di una figurina è `content.fantacalcio.it/web/campioncini/<edizione>/card/<extId>.png`, e
si scarica **solo il formato `card`, 255×378**. Esistono anche `medium` e `small` — la caricatura sola
su fondo trasparente — e un formato solo significa un file per giocatore, un indirizzo, un solo caso
«manca»; la `card` sta bene su entrambi gli schermi che la mostrano.

`<edizione>` è la stagione, ed è l'unica parte che invecchia: oggi è `21`, la `20` risponde ancora, la
`22` no. Sta in `CAMPIONCINI_EDITION` nel `.env`, con `21` come default nel codice — una variabile
assente non deve rompere niente, e una variabile sbagliata si vede subito perché non si scarica più
nessuna figurina. Ad agosto prossimo si cambia sul server, seguita dal `pm2 reload
deploy/ecosystem.config.cjs --update-env` che ogni modifica di `.env` pretende. La pagina del pannello
scrive a schermo l'edizione in uso proprio perché fra dodici mesi nessuno si ricorderà di questo
paragrafo.

### Dove si vede, e dove no

Nello snapshot è cambiato **un campo**: `extId` dentro il giocatore del lotto, aggiunto in
`serializeSnapshot` — che è l'unico punto da cui lo stato esce dal server, e quindi l'unico posto dove
un campo si aggiunge. Nel pool dei giocatori non c'è: il pool serve a scegliere chi chiamare, e
nessuno ha chiesto le figurine lì.

Aggiungerlo ha fatto emergere una crepa nel test dell'invariante I8, e vale la pena raccontarla
perché è il tipo di cosa che si scopre solo provandoci. Quel test confronta **l'insieme esatto delle
chiavi** del lotto, apposta per obbligare chi aggiunge un campo a guardare in faccia la riga che
scrive: ogni campo nuovo del lotto è un candidato a raccontare qualcosa delle buste. Ma `player` era
già una di quelle chiavi, quindi un campo nuovo *dentro* il giocatore lasciava il test verde senza
svegliare nessuno. Il campo di M7 era innocuo; il prossimo potrebbe non esserlo, e il giocatore è la
sede naturale di un dato che riguarda «questo lotto». Da v1.8.0 anche le chiavi del giocatore sono un
insieme esatto.

La figurina si vede in **tre posti**, tutti e tre sul percorso di chi gioca: la card del lotto nel
portale, a 68×100 a sinistra del nome; il modale d'offerta, alla stessa misura e nella stessa
posizione; e la vista TV, a un terzo della larghezza della colonna del lotto. Le misure del portale
sono state scelte guardando i layout a dimensione reale: a 54×80 la figurina non costava niente e non
si vedeva niente, a 81×120 si vedeva meglio ma costava quaranta pixel su uno schermo alto 667.

Nel modale la figurina è nata **sopra il nome** e ci è rimasta il tempo di guardarla su un telefono.
Sta di fianco perché quello sheet arriva dal basso e con la tastiera aperta **l'altezza è la risorsa
scarsa**, mentre la colonna a sinistra del testo era spazio che c'era già: di fianco non costa
nessuna riga, sopra ne costava centoquaranta pixel. Ed è alla stessa misura della card che sta
dietro, perché è lo stesso giocatore nello stesso momento — vederlo cambiare taglia aprendo il modale
sarebbe un movimento senza significato.

In regia **no**: la console mostra il lotto come una riga di testo e non come un riquadro, e chi
conduce ha la TV nella stessa stanza. Nelle rose e nello storico nemmeno.

Se l'immagine non arriva, l'elemento **sparisce** e il testo scorre a sinistra. Niente segnaposto
grigio: un rettangolo vuoto segnalerebbe un'assenza, e qui l'assenza non è un guasto — è l'archivio
non ancora riempito, che in produzione è lo stato del primo giorno. E in quel caso non ce l'ha
nessuno, quindi il riquadro resta uniforme comunque.

Che porta all'ultima cosa da sapere, ed è operativa: **in produzione l'archivio nasce vuoto.** Il
deploy non lo riempie, e va riempito dal pannello caricando un listone di riferimento e premendo il
pulsante. Fino a quel momento l'applicazione funziona esattamente come prima, semplicemente senza
figurine. È una differenza importante rispetto al backfill di M5, dove il passo mancante *rompeva* il
login: qui il passo mancante non rompe niente, si vede e basta.

---

## Gli insight sul listone: titolarità, rigoristi, piazzati

`fvm` è una quotazione: dice quanto **costa** un giocatore sul mercato, non se gioca. Fino a v1.8.0
era l'unico numero che l'applicazione sapeva dire, e le domande che si fanno davvero a un'asta —
*parte titolare? tira i rigori? batte i piazzati?* — si risolvevano con un telefono in mano e
un'altra app aperta. In una fase a tempo di dieci secondi, questo vuol dire che non si risolvevano.

Da M8 quelle risposte stanno dentro l'applicazione, e arrivano da **due `GET` pubbliche** che il
server interroga da sé: nessun token, nessuna credenziale di terze parti, nessun file da caricare.
La prima, `api.fantalab.it/v2/listone`, porta 497 giocatori con quante volte ognuno è **partito
titolare**, i minuti giocati e i rigori tirati. La seconda, la pagina dei rigoristi di
Fantacalcio.it, porta per ogni squadra chi batte i rigori e chi i calci piazzati, **in ordine di
gerarchia** — che è l'informazione vera: «secondo rigorista» vale molto meno di «primo».

### Il collaudo, di nuovo prima della spec — e di nuovo ha tolto roba

Il metodo è quello delle figurine, applicato una seconda volta: prima di congelare la specifica le
due fonti sono state chiamate per davvero, con la stessa `fetch` di Node che usa l'applicazione.
Rispondono entrambe `200` senza autenticazione, in poco più di due secondi in tutto, e si agganciano
fra loro perfettamente — 92 giocatori designati su 92, zero squadre discordanti, le stesse venti
squadre scritte allo stesso modo in entrambe le fonti **e** nella colonna `Sq.` del listone d'asta.
Nessuna mappa di sigle da mantenere, da nessuna parte.

Ma quelle due chiamate hanno anche **smentito quattro cose** che la prima stesura della spec dava
per certe, e ognuna ha tolto una colonna o un pezzo di interfaccia. La spec diceva che i numeri
erano tutti della stagione conclusa: in realtà nella stessa risposta convivono **due stagioni** —
329 giocatori con i dati di quest'anno, 168 con quelli dell'anno prima. Diceva tre gerarchie
(rigori, punizioni, corner): la pagina ne ha **due**, e la parola «punizioni» non compare nel suo
HTML. Prevedeva una colonna `fmv_subin`, che nella risposta vale **zero per tutti e 497**. E soprattutto
prometteva di rispondere a «si rompe?» usando un campo `injured` che **non dice quello**: vale da 0 a
5 e correla *al contrario* — chi gioca di più si fa male di più — perché conta gli infortuni della
stagione, non lo stato di adesso.

Quel quarto punto è l'unico che ha tolto una promessa invece che una colonna, ed è stato deciso con
una misura. Lo stato «infortunato adesso» esiste davvero in chiaro: la pagina delle probabili
formazioni di Fantacalcio.it lo serve senza autenticazione, con l'identificativo del giocatore già
dentro. Solo che **si popola quando serve a schierare, e l'asta si fa ad agosto**: interrogata a
campionato fermo, quella pagina contiene zero titolari e quattro infortunati in tutta la Serie A.
Un numero che sembra rispondere a una domanda a cui non risponde è peggio di un numero assente,
quindi `injured` è rimasto fuori — e la strada è annotata come l'aggiornamento più ovvio del giorno
in cui questa parte servisse a campionato in corso.

### Una tabella che non appartiene a nessuna asta

`players` è un **listone per asta**: `auction_id` congela la lista al momento dell'import, e le
righe muoiono in cascata quando l'asta si cancella. `player_insights` no. La sua chiave è l'`ext_id`
del giocatore e nient'altro: un aggiornamento dal pannello serve **tutte** le aste, e i dati
sopravvivono alla cancellazione di qualunque asta. È la stessa scelta dell'archivio delle figurine,
per la stessa ragione — un dato di mercato non è un fatto dell'asta.

Da questo discende un vincolo che vale la pena dire per esteso, perché è la difesa più importante
del capitolo: **l'asta deve funzionare con quella tabella vuota.** Si legge sempre in `LEFT JOIN`,
mai in `INNER JOIN`, e nessun percorso critico la attraversa. In produzione nasce vuota e resta
vuota finché qualcuno non preme i pulsanti del pannello — e finché non lo fa, la sera dell'asta
funziona esattamente come prima. C'è un test che percorre un'asta intera con la tabella vuota, e
serve solo a dimostrare questo.

I due elenchi, del resto, non coincidono e non coincideranno mai: dei 495 giocatori del listone di
prova, **487 trovano una riga** nella fonte, e la fonte ne ha dieci che il listone non ha. Gli otto
mancanti sono giocatori veri, con nome e cognome. Il pannello li mostra per nome invece di
nasconderli, perché «487 su 495» è un'informazione e «tutto a posto» no.

### Cosa succede quando una fonte cambia forma

Questa è la domanda attorno a cui è costruita l'intera parte, perché le due fonti sono **fuori dal
nostro controllo**: un giorno cambieranno, senza avvisare nessuno. Il modo sbagliato di reagire è
scrivere 497 righe di `null` sopra dati buoni e accorgersene la sera dell'asta. Le difese sono
quattro, e sono tutte della stessa forma — *fallire, invece di scrivere*.

I due parser **rifiutano invece di scartare**. Non esiste da nessuna parte un «questa riga non la
capisco, tiro avanti»: un envelope che dichiara un numero di giocatori diverso da quelli che manda,
una riga senza identificativo, una stagione con un nome mai visto, diciannove squadre invece di
venti, una lista senza nessun link a un giocatore — sono tutti errori, con un messaggio in italiano
che il pannello mostra. Una lista corta somiglia troppo a una lista giusta.

La scrittura sta **dentro una transazione**, perché una tabella riempita a metà è peggio di una
vuota: vuota si vede, a metà si crede.

Ogni fonte tocca **solo le proprie colonne**. Aggiornare il listone non cancella i rigoristi
importati ieri, e viceversa; per questo i timestamp sono due e il pannello li mostra separati —
altrimenti non saprebbe dire *quale* delle due fonti è ferma da tre mesi.

E c'è un **controllo di continuità**: se la lista che arriva ha in comune con quella precedente meno
dell'85% degli identificativi, non viene scritto niente. La forma di questo controllo è cambiata
scrivendo i test, e vale la pena raccontarlo perché l'errore era sottile. La prima versione
confrontava la copertura con i listoni delle aste: sotto soglia, rifiuta. Sembrava ragionevole
finché non si è visto che **una singola asta simulata la avvelena** — il suo listone sintetico ha
identificativi da 1 a 40, che nella fonte non esistono, quindi bastava una prova nel database per
far fallire l'import su dati perfetti. Un controllo che si può far scattare da un'altra parte
dell'applicazione non è un controllo, è una trappola. Confrontarsi con l'import precedente invece
misura esattamente ciò che si vuole sapere — *la fonte parla ancora la stessa lingua?* — e al primo
import, non avendo niente con cui confrontarsi, si salta: non si deduce un cambiamento dal nulla.

### Chi li vede: il server omette, la UI non nasconde

Gli insight non li vedono tutti. È una scelta di prodotto e non una necessità di licenza — le fonti
sono pubbliche — e va detto così, perché non venga difesa un giorno con un argomento che non ha: è
un vantaggio informativo che si riserva a chi ha il permesso, più gli amministratori, che li vedono
comunque (altrimenti dovrebbero accendersi un flag da soli per guardare i dati che hanno appena
importato).

Il **come** è la parte che conta. Il listone arriva al browser come proprietà di un componente
client: tutto ciò che ci sta dentro è nel browser di chi apre la pagina, leggibile negli strumenti
di sviluppo in tre click. Nasconderlo con un `if` nel JSX o con una regola CSS non sarebbe una
protezione, sarebbe una decorazione — è la regola «mai fidarsi della validazione client» applicata
alla lettura invece che alla scrittura. Quindi la decisione si prende **una volta sola, nella
query**: chi non ha il permesso riceve un listone in cui la chiave degli insight *non esiste*. Non
un valore vuoto da nascondere: proprio niente.

Il resto discende da sé. Nei componenti non c'è nessun `if (puoi vedere)`: il campo assente non si
renderizza, e lo stesso codice regge senza saperlo anche gli altri due casi in cui non c'è niente da
mostrare — la tabella ancora vuota, e il giocatore che la fonte non conosce. Il test che protegge
tutto questo guarda **l'oggetto** restituito dalla query, non ciò che si vede a schermo: un test che
guardasse il render passerebbe anche con il dato addosso.

Per la stessa ragione **lo snapshot dell'asta non è stato toccato di una riga**. Lo snapshot è uno
solo, mandato in trasmissione a tutti i partecipanti insieme: metterci gli insight vorrebbe dire
mandarli anche a chi non li può vedere. Viaggiano nel listone, che è caricato dalla pagina per quel
singolo spettatore — ed è per questo che l'invariante sulla segretezza delle offerte attraversa
questa macro senza che una sola riga del motore cambi.

### Dove si vede, e perché in due posti soli

Nella **lista di chiamata** c'è la riga densa: il badge della titolarità con la sua percentuale, i
minuti medi, e i badge di rigorista e piazzati. Lì si scorre e si confronta — quaranta nomi, e la scelta è fra due o tre —
quindi più informazione aiuta, purché stia su una riga che si legge in mezzo secondo.

Nel **modale d'offerta** ci sono solo le macro: quanto è titolare, e se batte. Lì non si confronta,
si decide una cifra in dieci secondi con un pollice sulla tastiera, e ogni riga in più ruba altezza
al campo dell'offerta — che con la tastiera aperta è la risorsa scarsa, esattamente come aveva già
insegnato la figurina.

Nella card del lotto **no**, e non è una dimenticanza: la card non sparisce mai ed è la schermata
che si guarda anche quando non si sta offrendo, mentre la domanda «quanto vale?» ce l'ha il modale.
Due chiamanti, non tre.

### Il colore accelera, il numero decide

M8 ha portato dentro i numeri e li ha vestiti con quello che c'era: due grigi che si distinguono a
fatica, e la titolarità nemmeno un badge — testo con una percentuale in grassetto. Sotto un countdown
di dieci secondi, con un pollice sulla tastiera, la differenza fra «leggibile» e «riconoscibile senza
leggere» è tutta la differenza che conta, e v1.10.0 dà **un colore a ogni fatto**: verde la titolarità
alta, blu chi batte i rigori e chi batte i piazzati, grigio tutto il resto.

Il verde ha una soglia, e la soglia è stata **contata prima di essere scritta**: dall'80% in su. Sulla
risposta vera della fonte sono 61 giocatori su 497 — il 12,3% del listone, cioè cinque o sei nomi in
una lista di chiamata da quaranta: abbastanza raro da voler dire qualcosa, abbastanza frequente da non
sembrare un guasto. Al 70% sarebbero 101, un nome su cinque, che è il punto in cui un colore smette di
essere un segnale e diventa decorazione. Quel conteggio dice anche una verità di dominio che nessuno
aveva scritto: i verdi sono venticinque difensori e **sei attaccanti**. Gli attaccanti ruotano, e chi
guarda i badge lo scopre da sé.

C'è però un prezzo, e va detto perché è la ragione per cui una riga di codice non va toccata. La
soglia cade in una zona densa: c'è un grumo di giocatori veri a 32/38, che è l'84%, e chi sta a 30/38
— il 79% — resta grigio. Due giocatori a due partite di distanza finiscono in due colori diversi, e
questo va bene **solo perché la percentuale è scritta dentro il badge**. Il giorno in cui qualcuno
togliesse il numero per fare spazio, la soglia diventerebbe una bugia: per questo il numero non è un
dettaglio grafico ma parte della correttezza, e sta scritto accanto alla costante invece che solo qui.

Dalla stessa regola discende che **il colore non è mai l'unica informazione**: verde e grigio a fianco
non li distingue chiunque, quindi il badge dice sempre la percentuale e non «Titolare» da solo. Un
badge senza testo non si aggiunge a quella lista. E il blu non cambia col rank: il colore dice *che*
batte, il numero dice *quanto* conta — «secondo rigorista» vale molto meno di «primo», e un pallino
colorato butterebbe via il dato per mostrarlo meglio.

I quattro colori stanno in un posto solo, e non è la primitiva del badge. `components/ui/badge.tsx`
non ha preso varianti nuove: un verde che significa «parte titolare almeno quattro volte su cinque»
non vuol dire niente fuori da questa lista, quindi il vocabolario vive accanto ai suoi due chiamanti,
in `components/auction/insights.tsx`. È la stessa scelta con cui il progetto ha rifiutato un
`dialog.tsx` condiviso: le primitive si allargano quando arriva un secondo chiamante *generico*, e qui
non arriverà. La quarta variante — il neutro — non ha un uso oggi: è il colore riservato al prossimo
fatto categorico che arriverà dagli insight, perché quattro colori sono il massimo che una riga densa
regge e il quinto renderebbe illeggibili i primi quattro.

Un colore che la richiesta chiedeva **non** c'è, ed è il rosso di «Infortunato». Non per difficoltà:
lo stato «si è rotto adesso» esiste in chiaro su Fantacalcio.it, ma si popola a campionato in corso e
l'asta si fa ad agosto — interrogata quella pagina d'estate contiene quattro infortunati in tutta la
Serie A. Un badge rosso che non compare mai la sera per cui esiste l'applicazione è lavoro speso male;
uno generato da una pagina letta tre settimane prima sarebbe peggio, sarebbe una bugia.

Un dettaglio piccolo che riassume l'atteggiamento di tutto il capitolo: **`—` e `0` non si scrivono
allo stesso modo**. Un giocatore senza dati e un giocatore che non è mai partito titolare sono due
cose diverse, e all'asta si pagano in modo diverso. Per lo stesso motivo si mostrano soltanto i
numeri della stagione corrente: quelli di un terzo del listone parlano del campionato precedente, e
accanto a quelli di quest'anno sarebbero un confronto falso. Escono come `—`, che è la risposta
onesta.

E un ultimo dettaglio che sembra un capriccio e non lo è: la percentuale di titolarità è **fermata
al 100%**. Nella risposta vera c'è un giocatore con 42 partenze da titolare su 38 giornate — il
campo somma più competizioni — e senza quel limite la card scriverebbe «110% da titolare», che è la
sola cosa peggiore di non scrivere niente. Il test ha il suo nome dentro, così quella riga non viene
tolta per pulizia da qualcuno che non sa perché c'è.

---

## Il listone a sistema, e i due file che si chiamano allo stesso modo

Fino alla versione 1.10 il listone non esisteva come cosa in sé. Esisteva solo *dentro* un'asta:
chi la creava caricava il suo `.xlsx`, quelle righe finivano in `players` con l'`auction_id`
accanto, e lì restavano. Lo stesso file veniva poi ricaricato per scaricare le caricature, e
ricaricato ancora per l'asta dopo. Nessun posto dell'applicazione sapeva rispondere alla domanda più
semplice che ci sia: *chi c'è nel listone di quest'anno?*

Adesso quel posto c'è, e si chiama `listone_players`. Il file si carica **una volta**, in
amministrazione; da lì si scaricano le caricature, si consulta il Centro dati, e chi crea un'asta se
lo trova proposto invece di andarlo a cercare nei download.

### Perché la tabella non si chiama `listone`

Perché nel pannello quella parola indica **due file diversi**, ed è la distinzione da cui dipende
tutto il resto del capitolo.

Il primo è l'export **Leghe** di Fantacalcio.it: un `.xlsx` che si scarica a mano dall'area
riservata, e che è *quello che definisce un'asta*. Porta la colonna `Fuori lista`, e da quella
colonna dipendono l'invariante I9 e il toggle che decide se i fuori lista sono comprabili. Il
secondo è la `GET` pubblica di `api.fantalab.it`, quella che riempie `player_insights` con
titolarità, minuti e rigori: è la fonte del capitolo precedente, e il pulsante che la chiama si
chiama «Importa il listone» da quando esiste.

Solo il secondo si può chiedere da sé, e non è una questione di pigrizia: l'export Leghe passa da un
login, quindi nessun automatismo può andarselo a prendere. C'è un terzo file, *Quotazioni*, che è
pubblico e si scaricherebbe senza credenziali — ed è già stato scartato una volta, per una ragione
che vale la pena ripetere: **non ha la colonna `Fuori lista`**. Un listone a sistema costruito da
lì lascerebbe I9 e il toggle senza il loro dato di ingresso.

Da qui la divisione del lavoro: il listone d'asta si carica a mano, e il refresh automatico
giornaliero — che arriverà — riguarda solo le due fonti pubbliche degli insight. Le due cose stanno
nella stessa pagina del pannello perché è il posto giusto per guardarle insieme, non perché siano la
stessa cosa. E la tabella si chiama `listone_players` e non `listone` per lo stesso motivo per cui
il codice dice `campioncini` e il menu dice «Figurine»: una tabella che porta il nome di un concetto
ambiguo è una tabella che qualcuno userà per la cosa sbagliata.

### Resta una copia, e questa è la parte da non toccare

La tentazione, avendo finalmente un listone globale, è farlo leggere direttamente all'asta: una
tabella sola, niente duplicazione, un `JOIN` e via. Sarebbe sbagliato, e non per ragioni di
architettura ma di dominio.

Un'asta preparata lunedì non può cambiare listone perché martedì un amministratore ne ha caricato
uno aggiornato. Le rose comprate quella sera, i prezzi pagati, i giocatori che erano chiamabili e
quelli che non lo erano: tutto è appeso a quelle righe. Se il listone fosse condiviso, correggere un
refuso in un nome cambierebbe il verbale di un'asta finita tre settimane fa.

Quindi il principio scritto in `schema.ts` dal primo giorno — *«il listone è copiato dentro l'asta,
`players.auction_id` congela la lista al momento dell'import»* — non si tocca, e attorno a
`listone_players` vale una regola con una direzione sola: **è una sorgente da cui si copia, mai una
tabella da cui l'asta legge.** Nessuna query di gioco la attraversa. Se un `JOIN` verso quella
tabella comparisse in `machine.ts`, in `rules.ts`, in `snapshot.ts` o nella lettura del pool
chiamabile, sarebbe un errore anche se funzionasse.

C'è un test che difende esattamente questo, ed è la stessa forma del test che difende gli insight:
un'asta si crea, si prepara e arriva a `COMPLETED` con `listone_players` **vuota**. Se un giorno un
pezzo di motore cominciasse a dipendere da quella tabella, è lì che si romperebbe — prima della sera
dell'asta, invece che durante.

La conseguenza pratica è che le due strade — caricare il file dentro l'asta, oppure caricarlo a
sistema e copiarlo — devono produrre **le stesse identiche righe**. C'è un test anche per quello, e
ha un motivo preciso: `players_autopick_idx` ordina per valore di mercato decrescente, e
quell'ordinamento *è* la scelta automatica che scatta quando scade il tempo di una chiamata. La
colonna del valore di mercato non si mostra nel Centro dati, per decisione di chi guarda la pagina;
ma toglierla dalla copia perché «tanto non si vede» cambierebbe **chi viene comprato** allo scadere
di un countdown. È la trappola più facile di tutta questa parte, e il test esiste per non caderci
fra sei mesi.

### I9 si valida alla copia, non al caricamento

L'invariante I9 dice: per ogni ruolo, i giocatori disponibili devono essere almeno
`slot × partecipanti`. Sono tre termini, e due — gli slot e i partecipanti — appartengono a
un'asta. Al momento in cui il file entra a sistema non c'è nessuna asta di cui chiederlo, quindi
lì si valida solo il file: che sia leggibile, che abbia le colonne, che gli identificativi non si
ripetano.

I9 si verifica **alla copia**, con la stessa funzione di sempre. La conseguenza è che lo stesso
listone globale può passare per un'asta a otto partecipanti e fallire per una a dodici — ed è
giusto che fallisca, perché quella seconda asta si bloccherebbe davvero a metà serata.

Questo apre una domanda che vale la pena aver risolto bene: cosa succede se la copia fallisce
proprio **mentre si sta creando l'asta**? La risposta è che l'asta **resta creata**, in bozza, senza
listone, e il motivo arriva scritto in cima alla sua configurazione. L'alternativa — rifiutare la
creazione — sarebbe la trappola in cui un file inadatto impedisce di creare un'asta che si
preparerebbe a mano in trenta secondi.

### Il pannello, e il gate messo solo dove è vero

La sezione «Listone» del pannello tiene insieme il caricamento, lo stato e le due azioni che si
fanno *con* un listone appena caricato: scaricare le caricature e aggiornare gli insight. Le
figurine, che fino a ieri erano una voce di primo livello, sono diventate un blocco qui dentro:
erano l'altra voce che non parlava di righe legate a un'asta, e una accanto all'altra erano un
pannello cresciuto per accumulo. Il Centro dati ha invece una pagina sua, perché cinquecento righe
con una casella di ricerca non stanno sotto un modulo di caricamento — e perché è una pagina che si
apre per consultare, non per agire.

La richiesta originale chiedeva che **entrambe** le sottosezioni restassero inerti finché il listone
non fosse caricato. È stata accolta per una sola delle due, ed è una scelta che vale la pena
spiegare. Le caricature hanno una dipendenza vera: senza un elenco di identificativi non c'è niente
da scaricare, quindi il pulsante spento *dice* qualcosa. Gli insight no: le loro due fonti creano
righe con la propria chiave e non sanno che il nostro listone esista, quindi bloccarle bloccherebbe
un aggiornamento che **riuscirebbe**. Un pulsante disabilitato che funzionerebbe è una bugia
dell'interfaccia. E fra i due c'è già un gate vero, che nessuno ha dovuto inventare: «aggiorna i
designati» è spento finché la tabella degli insight è vuota, perché la seconda fonte aggiorna righe
che nascono dalla prima.

### La copertura, che finalmente ha un denominatore

Con un listone a sistema esiste per la prima volta il numero che si vorrebbe leggere: *quanti dei
giocatori di quest'anno hanno qualcosa da dire?* Sta nel pannello, accanto ai tre timestamp.

Ed è un'informazione, non una guardia — la distinzione conta. La prima versione del controllo sugli
insight, quella scartata, sbarrava l'import sotto una soglia di copertura, e si è rivelata
**avvelenabile**: un'asta simulata con identificativi finti portava la copertura a zero su dati
perfetti. Al suo posto c'è il controllo di continuità, che confronta la fonte con sé stessa.
Trasformare la copertura globale in una soglia rimetterebbe in piedi esattamente quel problema, con
un veleno nuovo: un file caricato per sbaglio. Le due domande, del resto, sono diverse — «il *mio*
listone è coperto?» e «la fonte copre il listone di quest'anno?» — e per questo il pannello le
mostra tutte e due.

### Il Centro dati

È una tabella e basta: tutto il listone a sistema, con gli insight accanto in `LEFT JOIN`. Chi non
ha una riga di insight compare lo stesso, con un trattino al posto dei numeri; chi ha insight ma non
è nel listone non compare affatto, perché il listone è il denominatore.

Ricerca, filtri e ordinamento girano **nel browser**, su un carico solo: cinquecento righe con gli
insight dentro sono un paio di centinaia di kilobyte, un numero che conosciamo perché è già pagato
una volta a serata da ogni telefono collegato al portale. Niente paginazione, niente ricerca lato
server, niente attesa fra un tasto e il successivo. Se un giorno il listone avesse cinquemila righe
sarà il momento di cambiare, e non prima.

Le intestazioni si cliccano per ordinare, e la lista si apre sulla quotazione dal più alto al più
basso. La logica sta in un file di funzioni pure con i suoi test, e non dentro il componente, per una
ragione che vale la pena dire: **una lista ordinata male non dà nessun errore.** Dà una lista
plausibile, e nessuno se ne accorge finché non cerca un nome che dovrebbe stare in cima. Due regole
lì dentro non sono ovvie: chi non ha il valore di quella colonna finisce in fondo *in entrambe le
direzioni* — invertire «titolarità» non deve portare in cima trecento trattini, perché l'assenza di
un dato non è uno zero — e a parità si ordina per nome, altrimenti duecento quotazioni uguali si
riordinano a ogni click e sembrano un difetto.

C'è poi un filtro «rigori e piazzati», e costruirlo ha fatto emergere una distinzione che prima era
rimasta implicita. Il gate stagionale — quello che nasconde i numeri di chi ha giocato solo il
campionato scorso — esiste per **i numeri della stagione**: presenze, partenze da titolare, minuti,
dove un dato dell'anno scorso accanto a uno di quest'anno è un confronto falso. Ma le due posizioni
di rigorista e battitore di piazzati non sono numeri di stagione: vengono dall'altra fonte, che
pubblica la gerarchia *di adesso*. Applicare loro lo stesso gate significa perderne una fetta
consistente — misurata: **22 designati su 92** — e un filtro che si chiama «solo chi batte» e ne
nasconde un quarto è peggio di nessun filtro. Nel Centro dati, dove le due informazioni stanno in
due colonne separate e non c'è nessun confronto da falsare, le posizioni si mostrano sempre.

⚠ Il portale, invece, non è cambiato: in `/play` e nel modale d'offerta quei ventidue continuano a
non avere il badge blu. È una differenza deliberata fra una pagina di consultazione e una schermata
di gioco, ed è annotata come tale — non è una svista da uniformare senza chiederlo.

La pagina sta dietro la guardia dell'amministrazione, e per questo non contiene nessun controllo sul
permesso di vedere gli insight: un amministratore li vede per costruzione, e aggiungere il predicato
qui darebbe l'impressione che ci sia una seconda regola da tenere allineata alla prima.

### La cosa che non si rompe, ed è quella da ricordare

La tabella nasce **vuota**. Finché nessuno carica il file: le caricature non si scaricano, il Centro
dati dice di essere vuoto, e chi crea un'asta non trova nessuna proposta — carica il suo file come
ha sempre fatto. **Niente si rompe**, ed è precisamente ciò che rende quel passo facile da
dimenticare dopo un rilascio. È lo stesso inciampo dell'archivio delle figurine e della tabella
degli insight, con la stessa cura: il numero grande in cima alla pagina *è* l'allarme.

---

## Il giudizio di un umano: da dove viene, e perché non è una misura

Il capitolo sugli insight si riapre qui, e non per aggiungere un'altra fonte: per aggiungere un
**tipo diverso di informazione**. Fino a v1.10.0 tutto ciò che l'applicazione sapeva di un calciatore
era una misura — quante partite, quanti minuti, quanti rigori, quale posizione nella gerarchia dei
battitori. Numeri veri, letti da fonti pubbliche, che rispondono a una domanda sola: *cosa è
successo l'anno scorso.*

Solo che all'asta la domanda è un'altra, ed è **quanto giocherà quest'anno**. Le due non coincidono, e
non coincidono per ragioni che nessun dato pubblico contiene: dipende da chi lo ha comprato, da che
modulo gioca il suo allenatore nuovo, da chi gli è arrivato davanti. Un difensore con trentaquattro
partenze da titolare che a luglio è finito in una squadra dove il suo posto è occupato non è un
titolare, e il numero non lo sa. La sessione che ha aperto questa strada ha provato a modellarlo — pesi
diversi fra inizio e fine stagione, giornate di infortunio da sottrarre, probabili formazioni — e si è
fermata su un fatto banale: **il dato per giornata non esiste in nessuna fonte pubblica**, e
ricostruirlo voleva dire cinquecento richieste HTTP e una tabella da diciannovemila righe per ottenere
un'approssimazione di qualcosa che una persona sa già.

Perché quella ponderazione, in effetti, **qualcuno l'ha già fatta**. Un foglio compilato a mano,
giocatore per giocatore, con tre giudizi su una scala da 1 a 5 — quanto è titolare, quanto è
affidabile, quanto tiene fisicamente — più una fascia di prezzo, un prezzo consigliato e delle
etichette brevi: `rigorista`, `rischio infortuni`, `subentrante`, `scommessa`. Si carica dal pannello
come il listone, circa una volta al giorno.

Il tema di questo capitolo, in una riga: **smettere di dedurre la titolarità e cominciare a leggerla,
senza smettere di mostrare il numero che la rende verificabile.**

### La misura che giustifica tutto il resto

Prima di costruirci sopra, una domanda andava chiusa: quel giudizio è informazione vera, o è la
statistica dell'anno scorso riscritta a mano? Perché se fosse la seconda, tutto questo capitolo
sarebbe una preferenza estetica.

La correlazione fra il voto di titolarità e la quota di partenze dell'anno scorso è **0,65** su 466
giocatori confrontabili. Correlata — un titolare tende a restare titolare — ma lontanissima
dall'essere una copia. E soprattutto: **i disaccordi sono esattamente i casi che la domanda voleva
catturare.** Undici giocatori sono giudicati titolari pieni pur avendo giocato dieci partite o meno:
un attaccante appena comprato da una squadra dove sarà il centravanti, un ragazzo promosso, due
difensori arrivati in una squadra che si è svuotata. Tredici sono giudicati panchinari pur avendo
trentaquattro partenze alle spalle: gente che ha cambiato squadra in peggio, o a cui è arrivato
davanti qualcuno.

Nuovo arrivo, cambio di modulo, cambio di allenatore, gerarchia nuova. La ponderazione che si voleva
costruire con un modello **era già una colonna**, e non ha bisogno di essere difesa: ha bisogno di
essere attribuita.

E c'è il rovescio della misura, che è la ragione per cui questa non è diventata *la* fonte. Delle
quindici colonne di statistiche del foglio, **undici sono identiche byte per byte** a quelle che
importiamo già: presenze, partite da titolare, minuti, quotazione, rigori, cartellini — 497 righe su
497. Il foglio non porta **nessuna statistica nuova**. Porta un giudizio, e solo per quello vale la
pena caricarlo. Sostituire con lui le due `GET` vorrebbe dire prendere gli stessi numeri da un file
caricato a mano invece che da una fonte che si aggiorna da sé, e perdere la gerarchia dei rigoristi —
che il foglio ha come etichetta su diciotto giocatori, contro i novantadue designati **con la loro
posizione** della fonte pubblica. La posizione *è* l'informazione. Quindi è una **terza fonte
sovrapposta**, non un rimpiazzo.

C'è anche una trappola, e va lasciata scritta perché il suo nome è convincente. Il foglio ha una
colonna che si chiama `Pt. Inf.`, e sembra la risposta a «togli le giornate di infortunio dal
calcolo». Non lo è: è identica al campo «infortunato» della fonte pubblica, va da 0 a 5, e
`presenze + Pt. Inf.` non fa 38 — arriva a 42, perché le presenze sommano più competizioni. È un
**conteggio di episodi**, non di giornate saltate. Quel punto resta senza dato, e questa colonna
sembra risolverlo senza risolverlo: se un giorno servisse, si chiede a chi compila il foglio invece di
dedurlo dal nome della colonna.

### Il join per nome, che è la parte fragile

Il foglio non ha identificativi. Ha un nome e una sigla di tre lettere per la squadra, e le due cose
insieme non bastano: `ROM` non è `Roma`, e agganciare su `(nome, squadra)` senza tradurre le sigle dà
**zero** su 497 — il genere di zero che fa sospettare il file invece della mappa.

Si aggancia quindi **sul solo nome, normalizzato**, contro il listone a sistema. Il risultato misurato
è 487 su 497, il 98%, e il fatto che lo rende sicuro non è la percentuale: è che **nel listone non c'è
un solo nome ripetuto**, quindi il nome è una chiave non ambigua. I dieci che restano fuori sono
acquisti più recenti del listone caricato — gente che quel file non aveva ancora.

Il listone è il denominatore giusto per la stessa ragione per cui lo è nel Centro dati: è la lista di
chi si può comprare, e un giudizio su qualcuno che non è in vendita non serve a nessuno. La sigla della
squadra non è la chiave, ma **il controllo**: si traduce con una mappa di venti righe scritte in chiaro
e si confronta, e una discordanza **si segnala per nome** invece di essere ingoiata. Sul file vero sono
tre, e sono tre trasferimenti veri: il giudizio si importa comunque, perché un giocatore che ha cambiato
squadra è lo stesso giocatore.

Venti righe in chiaro e non un algoritmo di somiglianza, e la ragione è la stessa di sempre in questo
progetto: `ROM → Roma` lo indovinerebbe qualunque prefisso, ma `MON` sta per Monza e non per Modena, e
una funzione che sbaglia in silenzio su una squadra sola sposta il giudizio di un giocatore addosso a
un altro. Venti righe che qualcuno rilegge ad agosto sono più oneste. Vanno rigenerate a ogni
promozione, e c'è un test che se ne accorge.

Sotto il **90%** di nomi agganciati l'import **rifiuta e non scrive niente**. Vale la pena dire perché
questa guardia è sana, quando M8 aveva smontato un controllo che somigliava a questo: quello là
misurava la copertura contro il listone di *un'asta*, e un'asta simulata con identificativi finti la
portava a zero su dati perfetti — era **avvelenabile**. Qui il denominatore è il listone globale, che
non appartiene a nessuna asta: nessuna simulazione lo può inquinare, e l'unica cosa che può abbassare
quella quota è che il foglio e il listone abbiano davvero cominciato a divergere. Di solito perché il
listone è vecchio, ed è quello che il messaggio d'errore dice di fare.

### Una tabella sua, e non tre colonne accanto alle altre

I giudizi stanno in `carmy_players`, non in tre colonne di `player_insights` — che pure ospita già due
fonti diverse. La differenza non è di gusto, è di **semantica della scrittura**: le due fonti pubbliche
si aggiornano *per colonna, con un upsert* — una scrive le statistiche, l'altra i due rank, e nessuna
tocca le colonne dell'altra — mentre questa si **sostituisce per intero** a ogni caricamento, come il
listone.

Mescolarle vorrebbe dire che un refresh automatico e l'upload di un file umano scrivono nella stessa
riga con due regole diverse, ed è il punto esatto in cui qualcuno, fra sei mesi, cancellerebbe i
giudizi con una `GET`. La sostituzione integrale serve anche a una cosa che l'upsert non farebbe: **un
giudizio ritirato deve poter sparire**. Un `titolarissimo` messo a luglio e tolto ad agosto, con un
merge, resterebbe in tabella per sempre.

Il foglio invecchia in fretta — un giudizio sulla titolarità cambia con un infortunio — quindi il
pannello dice **quando** è stato caricato e lo segnala se è più vecchio di un giorno. È l'unico dei
quattro timestamp con un avviso sopra: gli altri tre vengono da fonti che si aggiornano da sé, questo
lo carica una persona, e nessun refresh automatico potrà mai occuparsene.

### Il giudizio vince, ma il numero resta accanto

Da qui in avanti la titolarità dell'applicazione **è** quella del foglio. Si smette di dedurla dalle
partenze dell'anno scorso, e la soglia del verde si sposta sulla scala 1–5: da 4 in su.

Il rapporto grezzo però **non si perde**. Resta accanto al badge, in grigio, e non è nostalgia: è ciò
che rende il giudizio verificabile. Un «5 su 5» da solo è un'affermazione che nessuno può controllare;
un «5 su 5» accanto a «3 partite su 38» è un'affermazione con la sua prova — e quando i due divergono,
**quella divergenza è l'informazione più preziosa della riga**. È letteralmente il caso che giustifica
il capitolo: l'attaccante giudicato titolare pieno che l'anno scorso ha giocato tre partite non è un
errore del foglio, è una notizia.

Con una precisazione che vale la pena capire, perché sembra un'incoerenza e non lo è. Il numero grezzo
compare **solo se è di quest'anno**: chi ha le statistiche del campionato precedente porta il giudizio
da solo, senza rapporto accanto. Il motivo è che le presenze sono un numero *di stagione*, e uno di due
campionati fa accanto a un giudizio scritto oggi non è una prova ma un confronto falso. Il giudizio
invece non ha stagione: è un'opinione su quest'anno, scritta oggi, e non cambia significato per quanto
ha giocato chi la porta. Se fosse passato dallo stesso filtro, i centosessantotto giocatori con le
statistiche vecchie avrebbero perso l'informazione più recente che abbiamo su di loro.

E quando il foglio non c'è? **Si torna al badge di prima**, calcolato dalle presenze. Questo è il
punto in cui l'architettura ha fatto una scelta che vale più di quanto sembri: la decisione «da dove
viene la titolarità» sta in **una funzione sola**, in `lib/domain.ts`, e restituisce una delle due
forme — mai un misto. I tre posti che disegnano un badge non sanno quale delle due ha vinto. Se quella
scelta fosse sparsa nei componenti, il giorno in cui la lista di chiamata e il modale d'offerta la
applicassero in due modi diversi lo stesso giocatore sarebbe verde in una schermata e grigio
nell'altra — e nessuna delle due schermate sbaglierebbe *da sola*, che è il genere di bug che non si
trova. Per la stessa ragione il badge è **un** componente e non due: tenerne uno per fonte voleva dire
che ogni chiamante decideva quale disegnare, cioè riportare la decisione dove non deve stare.

### Un numero che propone un'azione, e per questo sta in un posto solo

Fra tutto ciò che il foglio porta, il prezzo consigliato è diverso dagli altri, e la differenza va
detta perché è la ragione della forma che ha preso: **non descrive un giocatore, propone un'azione.**
Una cifra suggerita accanto a una cifra da digitare è un suggerimento che qualcuno segue senza
pensarci.

C'è anche un effetto sull'asta, non sull'interfaccia. Se otto persone su otto hanno il file, il prezzo
consigliato smette di essere un vantaggio informativo e diventa **un prezzo di listino**: l'asta
converge lì, e la contesa che rende interessante la serata si sposta sui pochi nomi in cui qualcuno
decide di scostarsene.

Per questo vive in un componente suo, con **un posto solo** da cui si decide se e dove compare, e
quattro posizioni tutte scritte: accanto al campo dell'offerta, fra gli altri giudizi, dietro un tocco,
oppure spento. Oggi sta fra gli altri giudizi — dove si legge come *un giudizio fra i giudizi* invece
che come un'istruzione a due centimetri dalla cifra da scrivere — e spegnerlo in tutta l'applicazione
è cambiare una parola, non togliere del codice: i due punti d'innesto restano al loro posto e tacciono
da sé.

### La riga della lista di chiamata, e la densità che si è scelta di pagare

La schermata in cui si sceglie chi chiamare è quella con più informazione dell'applicazione, e il
motivo è che è l'unica in cui si **confronta**: quaranta nomi, trenta secondi, e la domanda non è
«quanto vale questo?» ma «quale di questi?». Il capitolo su M8 aveva fissato una regola per quella
riga — «tre informazioni, non dieci» — e questa macro l'ha allargata: accanto al nome ci sono ora la
titolarità giudicata, il rapporto grezzo, i minuti medi, i badge dei piazzati, la fascia, la
fantamedia attesa, il `PMA` e le note.

È una scelta esplicita e va detta come tale, perché va contro la regola precedente. La spec di questa
macro aveva deciso «la titolarità e al più un tag», e guardando la pagina vera la decisione è stata
rovesciata: in una schermata di confronto, l'informazione che non c'è è un giocatore che non si
considera. Il prezzo si paga sulla densità, e per pagarlo il meno possibile la riga è **su due
righe**: sopra i numeri di stagione, sotto il giudizio del foglio. Due blocchi da tre o quattro voci
si scorrono; uno da otto si guarda e non si legge.

Due cose sono rimaste fuori, e sono le stesse due che nessuno confronterebbe con un pollice sotto un
countdown: **affidabilità e integrità**, che vivono nel modale d'offerta insieme al prezzo consigliato
in crediti. Il modale è il posto in cui si è già scelto il giocatore e si sta scegliendo la cifra, e
là la domanda è un'altra.

Un dettaglio di nomi che sembra pedanteria e non lo è: la fantamedia attesa si scrive **`attesa
7.36`**, non con la sua sigla. In questo progetto `fvm` è il *Fantavalore di Mercato* — un indice di
prezzo che vale 300 — e sta **sulla stessa riga**, a destra. `FMV Exp.` è la *fantamedia attesa*, e
vale 7.36. Due sigle quasi identiche per due cose che non si somigliano: scritte accanto, l'una si
legge per l'altra, e il numero sbagliato letto sotto un countdown è un giocatore comprato male.

### Il vincolo che non è un invariante, e che era il più facile da rompere

Sopra la lista di chiamata, per chi ha il permesso, ci sono dei filtri: titolarità minima e fascia.
Servono a quello per cui esistono — trovare in mezzo a quaranta nomi i pochi che vale la pena
chiamare — e sono, tecnicamente, una banalità: un `filter` su un array che è già in memoria.

Solo che quella lista **non era ordinata per caso**. È ordinata come l'auto-pick, ed è per questo che
il suo primo nome ha sempre avuto un significato preciso: *quello che il timer comprerebbe al posto
tuo se lasci scadere la chiamata*. Saperlo cambia la fretta con cui si guarda il countdown.

Un filtro cambia quali righe si vedono e **non cambia di una virgola chi il timer sceglie** — quello
pesca dal pool intero, dentro la macchina a stati, e del foglio non sa niente né deve saperne. Con un
filtro acceso il primo nome della lista **non è più** quello che verrebbe comprato allo scadere, e chi
ha imparato a fidarsi di quella riga si ritroverebbe comprato qualcun altro. Nessun invariante si
rompe: si rompe una promessa che l'interfaccia aveva fatto senza scriverla.

Va risolto **in pagina e in modo esplicito**, non con un commento nel codice. Sopra l'elenco c'è una
riga che dice chi comprerebbe il timer, e c'è **sempre** — filtro o no. Diventa ambrata quando il primo
della lista non è più quello. Il «sempre» non è pigrizia: se comparisse solo a filtro acceso, chi non
filtra continuerebbe a fidarsi dell'ordinamento e chi filtra la leggerebbe come un avviso d'errore
invece che come un'informazione.

L'altra strada — tenere quel giocatore fisso in cima anche quando il filtro lo escluderebbe — è
scritta e disattivata, perché risolve il problema introducendone un altro: un elenco che contiene una
riga che il filtro dichiara di aver tolto mente su sé stesso in un altro modo.

Quello che protegge davvero il motore, comunque, non è nessuna di queste due righe di interfaccia: è
un test che gioca **un'asta intera** con la tabella dei giudizi piena — messi apposta *contro* l'ordine
dell'auto-pick, il migliore per il foglio è l'ultimo per il motore — e verifica che compri esattamente
gli stessi giocatori, nello stesso ordine, di un'asta identica giocata con la tabella vuota.

### Chi li vede, e la cosa che non si rompe

Come per gli insight, il permesso decide **una query e non un `className`**: la chiave con i giudizi è
*assente* dal payload di chi non ce l'ha — non `null`, assente — perché quel dato viaggia dentro le
prop di un componente client, cioè finisce nel browser di chi apre la pagina. I filtri sopra la lista
di chiamata **non sono la protezione**: sono l'interfaccia sopra un dato che a chi non ha il permesso
non arriva affatto. Se un giorno il filtro si vedesse e i dati non ci fossero, il bug è nella query.
Nel Centro dati il discorso non si pone: quella pagina è dietro il permesso di amministratore, e un
amministratore li vede per costruzione.

E la solita cosa da ricordare, la quarta di fila. **La tabella nasce vuota.** Finché nessuno carica il
foglio, i giudizi non compaiono da nessuna parte, il badge della titolarità è quello calcolato dalle
presenze e il portale è identico a quello della versione precedente. **Niente si rompe** — ed è
precisamente ciò che rende quel passo facile da dimenticare dopo un rilascio. I due file vanno caricati
**in quest'ordine**: prima il listone, poi il foglio, perché il secondo si aggancia al primo per nome.
L'ordine non è una preferenza, ed è la ragione per cui il pulsante del secondo è spento finché il primo
non c'è.

---

## I tre loop: cosa gira da sé, dentro il processo

Quasi tutto in questa applicazione parte perché qualcuno ha premuto qualcosa. Tre cose no. Girano da
sole, dentro lo stesso processo Node che serve le pagine, e sono l'unica parte del progetto che
funziona — o si guasta — mentre nessuno guarda.

Vale la pena elencarle tutte e tre insieme, perché separate sembrano tre scelte indipendenti e non lo
sono: **poggiano su una garanzia sola**, e se quella garanzia cade cadono tutte e tre nello stesso
modo. La garanzia è `exec_mode: "fork"` con `instances: 1` in `deploy/ecosystem.config.cjs`. In
cluster mode pm2 avvierebbe una copia per core, ogni copia eseguirebbe `instrumentation.ts`, e ci
sarebbero due sweep sulla stessa asta, due tick dei bot e due refresh — cioè un round chiuso due
volte, un bot che offre due volte, e un sito di terzi interrogato il doppio delle volte che credi. È
per questo che quelle due righe di configurazione hanno un capitolo apposta più sotto, e non sono una
preferenza di deploy.

Il secondo dettaglio comune è più subdolo: **i tre singleton stanno su `globalThis`**, non in variabili
di modulo. Next compila `instrumentation.ts` e i route handler in *bundle separati*, quindi dello
stesso file esistono due copie in memoria, e una variabile di modulo sarebbe due variabili. È l'errore
che una volta ha già prodotto uno stream aperto e poi silenzio per tutta l'asta: il registro SSE e
l'hook di broadcast si erano trovati in due mondi diversi.

Tre loop, dunque, con tre periodi e tre ragioni.

**Lo sweep dello scheduler, ogni secondo.** È la rete di sicurezza dei timer dell'asta: cerca le aste
`LIVE` con la deadline scaduta e le fa avanzare. Serve perché i `setTimeout` armati sulle deadline
muoiono con il processo, e lo stato invece no — dopo un riavvio, lo sweep riprende dal database. È
raccontato per esteso in «Il tempo ha due gambe».

**Il tick dei bot, ogni secondo.** Muove i partecipanti simulati. Ha un intervallo proprio e non sta
dentro lo sweep, perché lo sweep chiude i round ed è sequenziale: undici bot che scrivono sotto lock
ritarderebbero la chiusura di un round dell'asta vera che gira accanto. Ed è il primo dei tre a
fermarsi da sé quando c'è un'asta vera in corso. «Lo stand-down, che è la difesa vera».

**Il refresh degli insight, ogni quindici minuti.** È il terzo, ed è arrivato con M11. Chiede alle due
fonti pubbliche — il listone di `api.fantalab.it` e la pagina dei rigoristi di `fantacalcio.it` — se
hanno numeri nuovi, una volta al giorno. Il resto di questo capitolo è su di lui, perché è quello con
le decisioni meno ovvie.

### Il tick da quindici minuti che aggiorna una volta al giorno

I due numeri sembrano in contraddizione e sono la parte importante. **L'intervallo non è l'orologio.**
Un `setInterval` da ventiquattro ore sarebbe ancorato al *boot* del processo, e questo processo
riparte a ogni push su `main`: in una settimana di rilasci un refresh «ogni 24 ore da quando sono
partito» non scatterebbe mai, e nelle settimane senza rilasci scatterebbe a un'ora casuale che
scivola. Il conto quindi non si fa nel processo, si fa **nel database**: c'è una tabella,
`source_runs`, con **due righe per sempre** — una per fonte — e ogni quindici minuti il loop le
rilegge e si chiede, per ciascuna, *quando ho provato l'ultima volta, e com'è andata?*

Lo stato a database ha una conseguenza che vale da sola il disegno: **un riavvio è innocuo**. Un
deploy alle 04:59 non fa perdere il turno e non lo fa scattare due volte, perché il primo processo che
riparte legge la stessa riga che aveva letto quello di prima. È la stessa proprietà che rende
affidabile il boot recovery dello scheduler, e per la stessa ragione: lo stato non sta nei
`setTimeout`.

L'ora del giorno, quindi, non è fissa: il refresh scivola in avanti di qualche minuto al giorno. È una
scelta e non un effetto collaterale. Un'ora fissa vorrebbe dire aritmetica di fusi orari — il server
gira in UTC — e un ramo che gestisce «l'ora era già passata mentre eravamo spenti», cioè tutto ciò che
questo schema non ha bisogno di avere. Un dato di mercato non ha un'ora.

### La scadenza si conta dai tentativi, non dai successi

Questa è la riga che, sbagliata, non si vede in locale. Sembrerebbe naturale chiedersi «`player_insights`
è vecchia di un giorno? allora aggiorna», e la formulazione è sbagliata in un modo che non si manifesta
mai finché tutto funziona: nel momento in cui una fonte è giù, i dati restano vecchi per definizione,
quindi la condizione è vera a ogni giro — **novantasei richieste al giorno** verso un sito che non è
nostro, per non riuscire novantasei volte.

Il conto si fa allora sull'ultimo **tentativo**, e sopra ci sta un backoff esponenziale: dopo il primo
fallimento si riprova dopo un'ora, poi due, quattro, otto, sedici, e da lì in avanti una volta al
giorno. Una fonte giù per un giorno costa **cinque richieste** invece di novantasei. Costa una riga di
codice e vale un ordine di grandezza in educazione. Il backoff si ferma a ventiquattro ore e non
cresce oltre, perché sopra il giorno smetterebbe di proteggere qualcuno e comincerebbe solo a
ritardare la ripresa.

La decisione di *quando* provare è una **funzione pura** in `lib/engine/refresh-rules.ts`: prende la
riga di `source_runs` (o `null`) e un istante, e risponde sì o no. Sta separata dal loop per la stessa
ragione per cui `setup-rules.ts` sta separato da `setup.ts` — quello importa il database e vuole un
Postgres acceso, questa si prova in millisecondi. È dove vive il backoff, ed è la parte del sistema
che merita più test per riga di codice, perché è quella il cui errore si vedrebbe solo dai log di
qualcun altro.

### La guardia, che è la stessa dei bot

Se esiste un'asta **reale** `LIVE` o `PAUSED`, il tick non fa niente. Due download da mezzo megabyte e
un `upsert` di 497 righe in transazione, nello stesso processo che deve chiudere un round nel
millisecondo giusto, non si fanno mentre si gioca. La condizione è letteralmente la stessa di
`runBotTick` — la funzione è una, `realAuctionRunning()` — e le aste **simulate non contano**:
aspettano dei bot, non dodici telefoni. È la stessa distinzione della guardia del deploy.

⚠ E c'è un dettaglio che si sbaglia facilmente: **un tick saltato per la guardia non è un tentativo
fallito**, e non tocca `source_runs`. Se lo registrasse, una serata d'asta di tre ore manderebbe le
due fonti in backoff per un guasto che non c'è stato, e il giorno dopo il pannello direbbe «non si
aggiorna da tre volte» avendo fallito zero volte. Lo stesso vale per un secondo caso: la fonte dei
rigoristi rifiuta quando `player_insights` è vuota — aggiorna righe che nascono dall'altra fonte, non
le crea — e in produzione, il giorno del deploy, quella condizione è **normale**. Si salta, non si
registra.

### La regola «mai un timer che decide», guardata in faccia

`CLAUDE.md` ha una regola non negoziabile che dice «mai un timer che decide», e un capitolo che
introduce un timer nuovo deve spiegare perché non la viola invece di sperare che nessuno chieda.

Quella regola parla della **macchina a stati dell'asta**: il client renderizza i countdown ma non
cambia mai stato, e la chiusura di un round avviene solo lato server. Questo timer non decide niente
di un'asta. Non chiama `transition`, non prende `withAuctionLock`, non tocca `auctions`, `lots`,
`bids`, `assignments` né `ledger`, non incrementa `state_version`, non fa nessun broadcast. Decide una
cosa sola: se è il momento di chiedere a un sito web se ha numeri nuovi. È lo stesso confine che gli
insight avevano già tracciato per non prendere il lock — `player_insights` è globale e non entra in
nessuna regola di gioco.

La domanda da farsi la prossima volta che servirà «un timer per…», quindi, non è «è un timer?» ma:
**tocca lo stato dell'asta?** Se sì, allora no.

### Il silenzio è il guasto

Con i due pulsanti in admin, un errore lo leggeva la persona che aveva premuto. Nel momento in cui il
refresh parte da sé, un rifiuto tipizzato finisce in `console.error` e non lo vede **nessuno**: i
numeri invecchiano senza dire niente, la pagina mostra «aggiornato: 12 agosto» per tre mesi, e nessuno
lo interpreta come un problema perché è esattamente ciò che mostrava anche il giorno prima. Un
automatismo che riesce non ha bisogno di raccontarlo; uno che fallisce in silenzio è peggio di nessun
automatismo.

`source_runs` è quindi anche il posto in cui l'automatismo parla, e il pannello lo legge in due punti.
Accanto a ciascuno dei due pulsanti c'è una riga che dice com'è andato l'ultimo tentativo, quando, e se
è partito **da sé o a mano** — e in cima alla sezione Listone compare un avviso rosso **soltanto**
quando una fonte è in guasto. Che compaia solo allora è la sua unica proprietà importante: un avviso
che c'è sempre si smette di leggere, e il giorno che serve non lo si vede. Dopo il primo fallimento
dice «non si è aggiornato»; dal secondo in poi dice «non si aggiorna da **tre** volte», perché
«fallito» è un incidente e un numero è un guasto che dura — sono due notizie diverse, e la seconda è
quella che fa aprire il pannello.

⚠ **Anche i due pulsanti scrivono quella riga**, con `trigger: "manual"`. Se ci scrivesse solo
l'automatismo, il pannello racconterebbe una storia e la realtà un'altra: si premerebbe il pulsante,
l'aggiornamento riuscirebbe, e la pagina continuerebbe a dire «ultimo tentativo fallito ieri». Due
storie nello stesso posto sarebbero due verità, e per questo `trigger` è una colonna e non due
tabelle. Ha anche un effetto voluto: un fallimento a mano rimanda in avanti il prossimo tentativo
automatico, perché il backoff protegge la fonte da *tutti* i chiamanti e non solo dal loop.

E le frasi le scrive un modulo puro, `lib/source-status.ts`, non i due componenti. L'avviso in cima è
un componente server, la riga accanto al pulsante vive dentro un `"use client"`: le stesse frasi
scritte in due posti divergono al primo ritocco, e queste due, se divergono, dicono due cose diverse
dello stesso guasto nella stessa pagina.

### Il limite, dichiarato invece che scoperto

**Non manda email.** L'allarme funziona solo se qualcuno apre il pannello, e questo è un limite vero,
non una dimenticanza: una notifica che arriva ogni giorno per un dato di mercato è una notifica che si
impara a cancellare senza leggere, e il giorno che conta viene cancellata con le altre.

Due cose lo rendono accettabile. La prima è che **i dati non si corrompono**, e lo si deve al lavoro
degli insight: la scrittura è in transazione, l'envelope è validato, e una lista che ha in comune con
la precedente meno dell'85% degli identificativi viene rifiutata invece di scritta. Il caso peggiore
automatico è quindi *sapere numeri vecchi*, mai numeri falsi — e la differenza fra le due cose è la
differenza fra un ritardo e un guaio. La seconda è che il pannello lo si apre comunque, prima di
un'asta. Se un giorno non basterà, l'SMTP c'è già e sarà una macro di tre righe.

Non c'è nemmeno un'ora configurabile né un interruttore per spegnere l'automatismo: uno stato in più
da spiegare, che nessuno ha chiesto. Se serve fermarlo si ferma il processo — e in quel caso è ferma
anche l'asta, quindi la domanda non si pone.

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
     │   standalone │  · il tick dei bot: ogni secondo, fermo se si gioca
     │              │  · il refresh degli insight: ogni quindici minuti
     │              │  · il registro delle connessioni SSE
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

E da M11 quella riga protegge **tre** loop e non uno: accanto allo sweep ci sono il tick dei bot e il
refresh degli insight, e i danni di una seconda copia sono diversi per ciascuno — un round chiuso due
volte, un bot che offre due volte, e due richieste al giorno di troppo a un sito che non è nostro. Il
terzo è anche il più difficile da accorgersi: `source_runs` ha una riga per fonte, quindi il secondo
`upsert` sovrascriverebbe il primo e il conto dei tentativi tornerebbe **giusto** anche essendo
sbagliato. È lo stesso motivo per cui il controllo da fare in locale, prima di sospettare il codice, è
`lsof -nP -iTCP -sTCP:LISTEN | grep node`.

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

Con la Fase 8 l'applicazione era completa e viveva su un indirizzo pubblico. L'unico pezzo rimasto
fuori dal piano era l'area `/admin`, ed è arrivata con M6 — con una differenza rispetto a come il
piano la immaginava, che è annotata in `docs/DECISIONS.md`: là era «sola lettura», qui tocca tre
campi e cancella un'asta.

Restano poi le cose che un'applicazione usata **una sera all'anno** può permettersi di non avere, e
vale la pena che siano una scelta consapevole invece di una dimenticanza. Non c'è alta
disponibilità: se la macchina muore durante l'asta, si riparte da un backup su una macchina nuova,
e nel frattempo l'asta è ferma. Non c'è un ambiente di staging: la prova generale si fa in
produzione con i bot e poi si cancella, che per questo progetto è più onesto — collauda la macchina
vera. E non c'è nessun monitoraggio automatico: il controllo è un umano che guarda `pm2 logs` con
dieci persone intorno, ed è il monitoraggio con il tempo di reazione più breve che ci sia.

⚠ Con M11 quest'ultima frase ha acquistato un'eccezione, e conviene dirlo qui invece di lasciarlo
dedurre: **una cosa sola in questa applicazione si guasta senza che nessuno sia nella stanza**, e cioè
il refresh delle due fonti pubbliche. Non ha un monitoraggio nel senso di un servizio che avvisa: ha
una tabella con due righe e un avviso in cima a una pagina, che è il monitoraggio più piccolo che
risponda alla domanda vera. Il limite — lo vede solo chi apre quella pagina — è scritto in «Il limite,
dichiarato invece che scoperto», insieme alla ragione per cui è accettabile: i dati non si corrompono,
quindi il costo del ritardo è sapere numeri vecchi e non numeri falsi.

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
