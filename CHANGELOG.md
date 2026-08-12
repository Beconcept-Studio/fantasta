# CHANGELOG

Una sezione per versione, scritta al momento del merge su `main`. Le macro-feature sono un
minor, gli hotfix una patch. Il dettaglio di cosa doveva fare una feature sta nel suo file in
`docs/features/`; qui c'è solo cosa è cambiato per chi usa l'app.

## [1.9.1] — 2026-08-12

**Il deploy non si blocca più per un'asta simulata.** Fino a ieri la guardia che impedisce un rilascio
mentre si sta giocando contava **tutte** le aste in corso, comprese quelle di prova: una simulazione
lasciata in pausa bloccava ogni deploy successivo, e non c'era modo di chiuderla — un'asta in pausa non
si cancella, e a «completata» si arriva solo giocandola fino in fondo. L'unico rimedio era scavalcare
la guardia a ogni rilascio, che è il modo in cui una guardia smette di proteggere il giorno che serve
davvero.

Ora blocca solo le aste **reali**. Le simulate in corso vengono comunque stampate nell'output del
deploy, perché un rilascio che scavalca qualcosa in silenzio insegna a non leggere quello che scrive.

### Per chi aggiorna il server

**Niente**: nessun cambio di schema, nessun `pnpm db:push`, nessun passo a mano. Il deploy automatico
basta.

⚠ **Ma questo è l'ultimo deploy che può ancora bloccarsi.** La guardia viene eseguita *prima* che il
codice nuovo venga scaricato, quindi quella che decide è la copia già presente sul server — cioè
ancora la vecchia. Se in produzione c'è una simulazione in pausa, questo rilascio va forzato una volta
sola:

```bash
cd /home/ploi/fantasta.rggndr.it
DEPLOY_DURING_AUCTION=1 ./deploy/deploy.sh
```

Dal deploy dopo, il problema non si presenta più.

## [1.9.0] — 2026-08-12

**M8 — Insight sul listone.** `fvm` dice quanto **costa** un giocatore, non se gioca. Da questa
versione l'applicazione risponde anche alle altre domande che si fanno davvero a un'asta: **parte
titolare? tira i rigori? batte i calci piazzati?** Prima si rispondeva con un telefono in mano e
un'altra app aperta, che in dieci secondi di countdown vuol dire non rispondere.

Si vede in **due posti**, entrambi sul percorso di chi gioca. Nella **lista di chiamata** ogni nome ha
una riga in più: la percentuale di partite da titolare, i minuti medi quando era in campo, e i badge
`Rigori 1°` / `Piazzati 2°` per chi è designato. Nel **modale d'offerta**, mentre si decide quanto
mettere, ci sono solo le tre macro — quanto è titolare, e se batte — perché lì ogni riga in più ruba
spazio al campo dell'importo con la tastiera aperta.

**I dati arrivano da due fonti pubbliche**, che il server interroga da sé: nessun file da caricare,
nessuna password da custodire. Da **Admin → Listone** ci sono due pulsanti — il primo scarica
titolarità, minuti e rigori storici, il secondo i rigoristi e i battitori di piazzati — e in tutto ci
vogliono **due secondi**. Il pannello dice quando è stata aggiornata ciascuna delle due fonti, e
**quanti giocatori del tuo listone sono agganciati**: sul listone vero sono 487 su 495, e gli otto che
mancano sono elencati per nome. Non arriverà mai a 495: i due elenchi non coincidono, ed è normale.

**Non li vedono tutti.** È una scelta, non un limite tecnico: il permesso si dà dalla lista utenti,
colonna «Insight». Chi non ce l'ha vede l'applicazione esattamente come prima — e i dati **non
arrivano nemmeno nel suo browser**, non sono nascosti a schermo. Chi amministra li vede sempre.

**Due dettagli che sembrano difetti e non lo sono.** Circa un terzo dei giocatori mostra `—` invece
dei numeri: sono quelli per cui la fonte ha solo i dati della stagione **precedente**, e mescolarli con
quelli di quest'anno sarebbe un confronto falso. E `—` non è `0`: un giocatore senza storico e uno che
non è mai partito titolare sono due cose diverse, e all'asta si pagano in modo diverso.

**Se una fonte cambia forma, l'aggiornamento si rifiuta e lo dice**, invece di riempire la tabella di
righe vuote. Vale anche se la lista che arriva non somiglia più a quella di prima: in quel caso non
viene scritto niente e i dati di ieri restano al loro posto.

### Per chi aggiorna il server

⚠ **Questa volta il deploy automatico non basta, e ci sono tre passi.** I primi due sono
obbligatori — senza il primo l'applicazione **non parte**, perché il database non ha le colonne nuove.

**1. Lo schema del database cambia** (in modo additivo: una tabella nuova e una colonna, niente
sparisce e nessun tipo cambia, quindi **non serve un backup preventivo**). Dopo che il deploy
automatico è finito, sul server, **con nessuna asta `LIVE` o `PAUSED`**:

```bash
cd /home/ploi/fantasta.rggndr.it
pnpm db:push
pm2 reload deploy/ecosystem.config.cjs --update-env
```

**2. La tabella nasce vuota.** Da **Admin → Listone**, si premono i due pulsanti **in quest'ordine**:
prima «Importa il listone», poi «Aggiorna i designati» — il secondo aggiorna righe che nascono dal
primo, e su una tabella vuota rifiuta dicendolo. La pagina dice quanti giocatori ci sono: finché dice
`0`, nessuno vede niente. Sono due secondi, e si può ripremere quante volte si vuole.

**3. Il permesso nasce spento per tutti.** Da **Admin → Utenti**, colonna «Insight», pulsante «Dai
insight» su chi lo deve avere. Prima di quel momento la feature è invisibile a tutti tranne agli
amministratori — che la vedono per costruzione, così chi importa i dati può controllare che siano
arrivati.

⚠ Finché i passi 2 e 3 non sono fatti, **tutto funziona come prima e non si vede niente**: non si
rompe nulla, non c'è fretta, ma il rilascio non è finito. È lo stesso inciampo delle figurine di
v1.8.0.

Vale ancora quello che valeva prima: il deploy **si rifiuta di partire** se in produzione c'è un'asta
`LIVE` o `PAUSED`, e in quel caso non tocca niente.

## [1.8.0] — 2026-08-11

**M7 — Le caricature dei calciatori.** Quando un giocatore viene chiamato all'asta, adesso si vede la
sua **figurina**: la caricatura di Fantacalcio.it dentro la carta con lo scudetto e il ruolo. È la
risposta alla domanda che la stanza fa a voce alta — «chi è?» — e si legge a colpo d'occhio.

Si vede in **tre posti**, tutti sul percorso di chi gioca: nella card del lotto sul telefono, accanto
al nome; nel **modale d'offerta**, mentre si decide quanto mettere; e sulla **TV**, grande, che è lo
schermo per cui quelle carte sono state disegnate. In regia no: lì il lotto è una riga di testo, e chi
conduce ha la TV nella stessa stanza.

**Le immagini si scaricano una volta sola**, da **Admin → Figurine**: si carica il listone di
riferimento (il `.xlsx` di Fantacalcio.it) e si preme il pulsante. Su un listone intero sono ~500
immagini in pochi secondi. Si può premere quante volte si vuole: scarica solo quello che manca, e la
seconda volta non scarica niente. Il file caricato non viene conservato.

**Circa un giocatore su tre non ha una caricatura** e riceve una sagoma senza volto con la maglia del
suo club: è così sul sito di Fantacalcio.it, e si mostra come le altre. Non è un difetto
dell'applicazione, ed è voluto che ci sia — se le sagome venissero saltate, un lotto su tre avrebbe un
riquadro più corto e il pulsante d'offerta si sposterebbe sotto il pollice.

**Nel modale d'offerta il campo dell'importo parte già attivo**, con la tastiera aperta e il valore
selezionato: se sei già dentro con 31, digiti e sovrascrivi. Prima bisognava toccarlo.

### Per chi aggiorna il server

**Lo schema del database non cambia**: nessun `pnpm db:push`, nessuna riga di `psql`. Ma questa volta,
a differenza di v1.7.0, **il deploy automatico non basta**: restano due passi a mano, e finché non
sono fatti l'applicazione funziona esattamente come prima — semplicemente non si vede nessuna
figurina. Non si rompe niente, non c'è fretta, ma non è finito.

**1. La variabile nuova nel `.env`.** L'edizione delle figurine è la stagione, ed è l'unica parte
dell'indirizzo che invecchia. Sul server, in `/home/ploi/fantasta.rggndr.it/.env`:

```bash
CAMPIONCINI_EDITION="21"
```

Poi, obbligatoriamente, il ricarico che rilegge il file — **non** `pm2 restart asta`, che riparte con
l'ambiente vecchio:

```bash
cd /home/ploi/fantasta.rggndr.it
pm2 reload deploy/ecosystem.config.cjs --update-env
```

Si può anche saltare: il codice ha `21` come default, ed è il valore giusto per la stagione in corso.
Va messa perché **ad agosto prossimo andrà cambiata**, e quel giorno è più facile modificare una riga
che esiste che scoprire che va aggiunta. Se un giorno l'edizione fosse sbagliata te ne accorgi subito:
non si scarica nessuna figurina.

**2. L'archivio va riempito, e nasce vuoto.** Da **Admin → Figurine**, si carica il listone e si preme
il pulsante. La pagina dice quante ce ne sono: finché dice `0`, nessuno vedrà nessuna figurina. Le
immagini finiscono in `/home/ploi/fantasta.rggndr.it/storage/campioncini/` (~53 MB) e **sopravvivono
ai deploy successivi e anche a un ritorno a una versione precedente**: questa operazione si fa una
volta per stagione, non a ogni rilascio.

Vale ancora quello che valeva prima: il deploy **si rifiuta di partire** se in produzione c'è un'asta
`LIVE` o `PAUSED`, e in quel caso non tocca niente.

## [1.7.0] — 2026-08-11

**M6 — Amministrazione.** Chi amministra l'applicazione ha un pannello: il pulsante **«Admin»** in
navbar porta a `/admin`, con la lista di tutti gli utenti e quella di tutte le aste. Gli altri non
vedono il pulsante e, se scrivono l'indirizzo a mano, tornano in dashboard.

**Sugli utenti si può fare tre cose.** Correggere un nome scritto male — l'«asdf» digitato di fretta
nell'onboarding. **Verificare a mano un indirizzo email**, che è la novità che conta: fino a ieri, se a
un amico il codice non arrivava, l'unico rimedio era una riga di SQL sul server, e adesso è un
pulsante. E dare o togliere il permesso di amministratore — **mai sul proprio account**, perché un
click e ci si chiude fuori tutti.

L'indirizzo email **non si modifica**, e non è una dimenticanza: da v1.6.0 è la chiave con cui si
entra, quindi cambiarlo vuol dire cambiare chi può entrare in quell'account. Un indirizzo sbagliato si
risolve rifacendo l'account.

**Sulle aste si può fare una cosa sola: cancellarle**, anche quelle di qualcun altro, digitandone il
nome per conferma. Niente pausa, niente avvio, niente correzioni: quella è la regia, e resta di chi ha
creato l'asta. Le aste in corso o in pausa non si cancellano nemmeno da qui.

La lista aste mostra nome, chi l'ha creata con la sua email, stato, posti, membri e date — e
**nient'altro**: non i lotti, non le offerte, non le rose. Un'asta si guarda da dove si guardano le
aste, e il pannello dà il link.

Il pannello è pensato **per un portatile**, non per il telefono: tabelle dense e sidebar laterale. Dal
telefono si offre, e quella parte resta com'era.

### Per chi aggiorna il server

**Niente.** Questa versione non cambia lo schema del database: nessun `pnpm db:push`, nessuna riga di
`psql`, nessuna variabile nuova nel `.env`. Il deploy automatico basta e si conclude da sé.

Una sola cosa da sapere, che valeva anche prima: il deploy **si rifiuta di partire** se in produzione
c'è un'asta `LIVE` o `PAUSED`, e in quel caso non tocca niente — si toglie di mezzo l'asta e si
rilancia `./deploy/deploy.sh`.

E se il pulsante «Admin» non compare a chi dovrebbe vederlo, manca il permesso sull'account, non il
deploy: `UPDATE users SET is_admin = true WHERE email = '…'`. Da questa versione è l'ultima volta che
serve — il secondo amministratore lo si nomina dal pannello.

## [1.6.0] — 2026-08-10

**M5 — Identità.** Ci si può registrare con email e password, non solo con Google. Chi non ha un
account Google — o non vuole collegarlo qui — adesso entra, e la sera dell'asta non resta in piedi
accanto alla TV a guardare gli altri giocare.

### ⚠ Per chi aggiorna il server

Questa versione **cambia lo schema del database**, e a differenza delle altre **non basta
`pnpm db:push`**: serve anche una riga di `psql`, senza la quale al primo caricamento *tutti* gli
utenti che c'erano già finiscono davanti alla schermata del codice, chi amministra compreso.

**Prima** del push, per sapere se il nuovo vincolo di unicità passa (se questa query restituisce
righe, il push fallisce e vanno sistemate prima):

```sql
SELECT lower(email), count(*) FROM users
WHERE email IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
```

**Dopo** il deploy, con nessuna asta in corso:

```bash
cd /home/ploi/fantasta.rggndr.it && pnpm db:push
psql -c "UPDATE users SET email_verified_at = created_at
         WHERE google_sub IS NOT NULL AND email_verified_at IS NULL"
pm2 reload deploy/ecosystem.config.cjs --update-env
```

Servono inoltre **cinque variabili nuove nel `.env`** — `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, `MAIL_FROM` — senza le quali l'applicazione parte lo stesso e il login con Google
continua a funzionare, ma i codici di verifica non partono. `pnpm mail:check` dice in trenta secondi
se le credenziali sono giuste, senza spedire niente.

Nessuna colonna sparisce e nessun tipo cambia, quindi il backup preventivo non è obbligatorio — ma
questa versione tocca il login, che è l'unica cosa che se si rompe chiude fuori tutti:
`deploy/db-backup.sh` costa trenta secondi.

### Aggiunto

- **La registrazione con email e password.** Si sceglie un indirizzo e una password di almeno dieci
  caratteri — nessuna regola su maiuscole o simboli, la lunghezza conta di più — e arriva un codice
  a sei cifre da inserire nella schermata successiva. Il nome e cognome si scrivono dopo, dove si
  sono sempre scritti.
- **La conferma dell'indirizzo.** Finché il codice non è stato inserito non si fa nulla: non si
  creano aste, non si entra su invito, non si gioca. Il codice vale quindici minuti, si può
  sbagliare cinque volte, e in ogni schermata di rifiuto c'è il pulsante per farsene mandare un
  altro — quello nuovo annulla il precedente.
- **«Password dimenticata».** Stesso meccanismo: si chiede l'indirizzo, arriva un codice, si sceglie
  la password nuova. È anche l'unico modo di *cambiare* la propria password.
- **Le due strade portano allo stesso account.** Chi si è registrato con email e password e poi
  entra con Google usando lo stesso indirizzo ritrova le sue aste: non nasce un secondo utente.

### Da sapere

- ⚠ **Se entri con Google su un indirizzo registrato con una password mai confermata, quella
  password smette di funzionare.** Sembra severo ed è deliberato: è ciò che impedisce a un
  estraneo di registrare il tuo indirizzo con una password sua e ritrovarsela valida sul tuo
  account il giorno in cui entri da Google. Se la password l'avevi messa tu, la rimetti da
  «Password dimenticata». Se invece l'indirizzo era già confermato, non cambia nulla e restano
  valide entrambe le strade.
- **Un account nato da Google entra da Google.** Su quell'indirizzo la registrazione con password
  viene rifiutata, e «Password dimenticata» risponde che si entra con Google.
- **Un account Google senza indirizzo email verificato non entra**, e lo dice.
- **Cambiare la password non chiude le sessioni aperte altrove**: chi era già dentro su un altro
  dispositivo ci resta.
- **Troppi tentativi di accesso falliti sullo stesso indirizzo bloccano per un quarto d'ora**, e un
  accesso riuscito azzera il conteggio.

## [1.5.0] — 2026-08-10

**M4 — Simulazione in-app.** Un'asta di prova si lancia dall'applicazione, con dei partecipanti
finti che giocano davvero. Prima serviva accendere il database, lanciare un seed da riga di
comando, copiare l'id dell'asta e far partire uno script in un terminale a parte.

### ⚠ Per chi aggiorna il server

Questa versione **cambia lo schema del database**. Dopo che il deploy è finito, e con nessuna asta
in corso, va dato a mano sul server:

```bash
cd /home/ploi/fantasta.rggndr.it && pnpm db:push
pm2 reload deploy/ecosystem.config.cjs --update-env
```

Il cambio è additivo — tre colonne nuove con un valore di default, niente che sparisce — quindi non
serve un backup preventivo e i dati esistenti non vengono toccati.

### Aggiunto

- **L'asta simulata.** Alla creazione compare una casella «Asta simulata»: l'asta che ne nasce è
  identica a una vera — stessa configurazione, stesso listone, stessa lobby, stessa regia, stessa
  TV — e in più si può riempire di partecipanti finti. La casella si decide **una volta sola**: non
  si può trasformare un'asta vera in una di prova, né il contrario.
- **I partecipanti simulati**, nel pannello accanto agli inviti: si sceglie quanti bot aggiungere ai
  posti liberi e come offrono — un misto verosimile, tutti al massimo, tutti al minimo, o tutti
  sulla stessa cifra, che è il modo di far scattare uno spareggio a comando. I bot giocano dal
  server, quindi risultano collegati da soli e l'asta si avvia senza aspettare nessuno.
- **Il badge «simulazione»**, in elenco aste, in cima a ogni schermata dell'asta e sulla TV. Con due
  schede aperte, le due aste si distinguono senza guardare l'indirizzo.
- **La cancellazione di un'asta**, in fondo alla configurazione, per chi l'ha creata. Per confermare
  si scrive il nome dell'asta: un pulsante si clicca per riflesso, un nome no.
- **L'amministratore dell'applicazione**, che non è chi possiede un'asta: è un permesso a parte, e
  per ora serve solo a creare aste simulate e a riempirle di bot. Chi ce l'ha gioca le aste come
  tutti gli altri.

### Da sapere

- **Mentre è in corso un'asta vera, i bot di ogni simulazione si fermano.** Non è un guasto: è la
  regola che tiene i partecipanti finti lontani dalla serata che conta. La configurazione della
  simulazione lo scrive, e i bot ripartono da soli quando l'asta vera è finita.
- **Nella simulazione le buste restano chiuse anche per i bot.** Giocandoci contro non si viene
  battuti di un credito ogni volta: vedono quello che vede un telefono, cioè la propria offerta e
  nient'altro.
- **Cancellare un'asta porta via tutto quello che le appartiene** — rose, storico, buste,
  rettifiche — e non si torna indietro. Un'asta in corso o in pausa non si può cancellare.

## [1.4.0] — 2026-08-10

**M3 — Tracciabilità.** Una macro sola, e risponde a due domande: cosa è successo durante l'asta, e
come lo dimostro se qualcuno non è d'accordo.

### Aggiunto

- **Lo storico dell'asta**, nuova voce «Storico» nel menù dell'asta, per chi l'ha creata **e** per
  chi ci gioca. In alto tutti i lotti conclusi, dal più recente: una riga per lotto che si apre sul
  dettaglio delle buste — ogni round col suo minimo, quanti potevano offrire, ogni offerta con la
  cifra e l'ora in cui è stata fissata, le offerte ritirate, e com'è finito il round. Sotto, le
  pause e le correzioni: chi ha messo in pausa e quando, cosa è stato assegnato a mano, cosa
  annullato, quali crediti sono stati rettificati e con che motivo. Prima tutto questo esisteva solo
  nel database, e per leggerlo bisognava aprirlo.
- **Un campo di ricerca sopra i lotti**: si scrive il nome di un giocatore, una squadra o un numero
  di lotto e l'elenco si restringe mentre digiti. In una disputa la domanda è sempre un nome.
- **L'esportazione delle rose in `.csv`**, dalla regia, accanto a quella che c'era già: tre colonne
  — nome squadra, id del calciatore, crediti spesi — e soltanto i giocatori assegnati.

### Cambiato

- **In regia i download sono due, con etichette che dicono a cosa servono**: «Listone per
  Fantacalcio.it (.xlsx)», che è il file di prima e serve a ricaricare le rose là dove si gioca, e
  «Rose (.csv)», il verbale da leggere. Il primo si scarica ora come `<asta>-listone.xlsx`: si
  chiamava `<asta>-rose.xlsx`, che con un vero export delle rose accanto sarebbe stato fuorviante.
- **Un nome squadra non può più contenere virgole né virgolette.** Lo richiede il formato del nuovo
  file, che per restare leggibile a occhio non usa virgolette. Il vincolo vale per chi entra da qui
  in avanti; i nomi già salvati restano come sono, e nel file il carattere diventa uno spazio.

### Da sapere

- **Le buste di un lotto ancora in corso non compaiono nello storico**, per nessuno — né per chi
  conduce, né per chi sta offrendo su quel lotto, né ad asta in pausa. Compaiono nel momento in cui
  le buste si aprono, e da quel momento restano leggibili per sempre: è la risposta al caso in cui i
  secondi delle buste aperte siano passati mentre guardavi altrove, o sia stato premuto «Prosegui
  asta».
- **I lotti annullati non spariscono dallo storico**: restano, marcati «annullato», e l'annullamento
  con la sua riassegnazione si leggono fra le correzioni. Uno storico che nasconde le correzioni non
  serve a chiudere una discussione.
- Il `.csv` usa la virgola come separatore. Aperto con un doppio clic su un Excel in italiano finisce
  in una sola colonna, perché l'italiano si aspetta il punto e virgola: va importato dalla procedura
  guidata, oppure aperto con un editor di testo.

## [1.3.1] — 2026-08-10

### Aggiunto

- **La versione dell'applicazione nella navbar**, accanto al pulsante per uscire. Serve a un
  controllo a vista: si apre il sito e si sa quale codice sta rispondendo, senza dover credere al
  momento in cui il deploy dichiara di aver finito. Il numero è quello con cui l'applicazione è
  stata compilata, e si legge anche dalla pagina di accesso — che è il posto in cui si guarda
  quando l'app non fa entrare e si vuole capire se il rilascio è passato.

## [1.3.0] — 2026-08-10

**M2 — Navigazione e identità delle pagine.** Una macro sola, e riguarda il muoversi dentro l'app.

### Aggiunto

- **Una navbar su ogni pagina**: il nome dell'app, che riporta alla lista delle aste, il tuo nome e
  il pulsante per uscire. Prima l'uscita esisteva solo nella lista delle aste.
- **Dentro un'asta, un menù delle sezioni.** Configurazione, Lobby, Regia, Asta live e il link alla
  vista TV: ognuno vede le voci che gli competono, e sono sempre le stesse dall'inizio alla fine
  della serata. Prima ogni pagina aveva i propri link, diversi dagli altri, e in due punti la voce
  «Pannello di configurazione» portava alla lobby — motivo per cui la configurazione dei tempi ad
  asta iniziata sembrava irraggiungibile.

### Cambiato

- **Il titolo di ogni pagina dice adesso la pagina**, con il nome dell'asta in un'etichetta sopra.
  Prima il titolo era il nome dell'asta: tre schermate diverse si presentavano tutte allo stesso
  modo, e l'unica informazione che mancava era dove ti trovavi.
- **La vista TV è diventata un tabellone di recap.** Tre quarti dello schermo sono tutte le squadre
  con la rosa completa, i prezzi pagati e i crediti residui; gli slot ancora da riempire restano
  disegnati, così si vede a colpo d'occhio chi è indietro. Il quarto rimanente è il lotto in corso.
  Al momento delle buste aperte la squadra che ha vinto si accende nel tabellone, col giocatore
  appena preso in evidenza dentro la sua rosa. Prima la pagina era tarata per essere letta da
  quattro metri su un televisore, e su un portatile spendeva metà schermo per un countdown che ogni
  partecipante ha già in mano.
- **Il portale del partecipante si chiama «Asta live»**, che dice cosa ci trovi invece di come si
  chiama. L'indirizzo della pagina non è cambiato: i link già aperti continuano a funzionare.
- Nell'intestazione della vista TV, al posto del totale speso e dell'ordine dei ruoli, c'è lo
  **stato dell'asta** — in corso o in pausa. È la risposta alla domanda di chi alza gli occhi e
  trova tutti i numeri immobili.

### Corretto

- **Il richiamo «Asta in corso» non compare più sopra la vista TV.** Se chi proiettava era anche
  loggato nello stesso browser, quella striscia verde si incollava in cima allo schermo condiviso e
  invitava tutta la stanza ad andare al suo portale.

## [1.2.0] — 2026-08-10

Due macro in un rilascio: **M1** era ferma su `dev` da ieri e non è mai arrivata in produzione.

### Aggiunto

- **La busta resta chiusa fino alla fine** (M1). Durante un lotto non si vede più **chi** ha
  consegnato la propria offerta: niente pallino sul telefono, niente riquadro acceso sulla TV,
  niente contatore «4/7» nella console della regia. Gli importi erano già protetti; chi si è
  mosso e chi non si è mosso era l'ultima informazione che permetteva di fare strategia
  guardandosi in faccia.
- **Una card per il lotto assegnato** (M1). Quando le buste si aprono la schermata cambia faccia:
  superficie spenta, nessuna barra che scorre, e in grande non il tempo che scappa ma il prezzo
  pagato. Sotto, il giocatore, chi l'ha vinto e **tutte** le offerte di tutti i round con la
  vincente in evidenza; in fondo, quanto manca alla ripresa. Prima era un pannello dentro la
  stessa card che un attimo prima chiedeva di offrire, e per tre secondi non si capiva che il
  lotto era finito.
- **«Prosegui asta».** Quando le buste sono aperte, chi gestisce l'asta trova un pulsante — nel
  proprio portale e nella console di regia — che chiude subito la rivelazione e passa al lotto
  successivo, senza aspettare i secondi configurati. I secondi restano: chi non tocca niente vede
  l'asta comportarsi come prima. Il pulsante è solo dell'owner, e solo mentre le buste sono
  aperte: ad asta in pausa non compare.

### Corretto

- **I tempi dell'asta non si riuscivano a salvare ad asta iniziata.** La pagina prometteva che i
  timer restassero modificabili, ma ogni salvataggio veniva rifiutato con «si possono cambiare
  solo i timer» — anche quando era proprio un timer a essere cambiato. Il form rimandava il nome
  dell'asta invariato e il server lo scambiava per una modifica strutturale.
- **Dalla lobby non si riusciva a raggiungere la configurazione ad asta in pausa**: si veniva
  rispediti al proprio portale. Ora in pausa si resta dove si è, e alla ripresa si viene
  riaccompagnati al portale da soli.

### Cambiato

- Nella configurazione, ad asta iniziata, il nome dell'asta è disabilitato come posti, crediti e
  slot: era l'unico campo che sembrava modificabile pur non essendolo.
- L'avviso «ad asta iniziata si possono cambiare solo i timer, che valgono dal lotto successivo»
  è sempre visibile sopra le impostazioni, invece di comparire in rosso dopo aver premuto Salva.
- Il seed di sviluppo fa entrare l'owner **per ultimo**, così il suo posto è quello che i bot
  lasciano libero con `--count=7`: si prova l'asta dal vivo restando l'owner, con la regia e il
  portale nello stesso browser. Non tocca l'applicazione.

## [1.1.0] — 2026-08-09

### Cambiato

- Lo sviluppo non procede più per fasi ma per macro-feature, su tre branch (`main` produzione,
  `dev` integrazione, `feature/NN-nome`). Nessun cambiamento nell'applicazione: `CLAUDE.md` e
  `docs/ARCHITECTURE.md` sono stati riscritti di conseguenza, `docs/PLAN.md` e `docs/BACKLOG.md`
  sono diventati archivio di v1.0.0.

### Rimosso

- `docs/RUNBOOK.md`. Le tre procedure che il flusso di sviluppo richiede — applicare lo schema
  dopo un deploy, tornare indietro a un tag, deployare a mano — sono passate in `CLAUDE.md`. Il
  resto resta leggibile con `git show v1.0.0:docs/RUNBOOK.md`.

## [1.0.0] — 2026-08-09

La prima versione in produzione su <https://fantasta.rggndr.it>, con le fasi 0–8 del piano
chiuse e 327 test verdi.

### Aggiunto

- Asta a busta chiusa completa: setup, listone, rotazione dei turni, chiamata, offerte segrete,
  spareggi, assegnazione e chiusura.
- Portale partecipante mobile-first, portale manager e vista TV.
- Override del manager: pausa, `voidAssignment`, `manualAssign`, rettifiche a `ledger`.
- Persistenza su Postgres, snapshot via SSE, boot recovery dopo un riavvio.
- Deploy su Hetzner con pm2 e nginx, backup `pg_dump` giornaliero con retention 14.
