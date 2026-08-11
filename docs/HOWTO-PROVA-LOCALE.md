# Come si avvia una prova in locale

Questo file esiste per una ragione sola: non doversi più ricordare a memoria l'ordine dei comandi
per mettere in piedi un'asta finta e giocarci. Non aggiunge niente al progetto, racconta cosa c'è
già.

Il percorso è sempre lo stesso: **Postgres acceso → seed → app accesa → login come owner → bot**.
Fuori da quest'ordine qualcosa non funziona, e i motivi sono spiegati sotto.

---

## In quattro comandi

```bash
docker compose up -d                     # 1. Postgres su localhost:5433
pnpm db:seed --auction-status=ready      # 2. 12 utenti + un'asta a 8 pronta a partire
pnpm dev                                 # 3. l'app (lasciala accesa: ha lo scheduler)
# 4. dal browser: http://localhost:3000 → "Entra come Marco Bianchi"
```

Il seed stampa a fine corsa tutto quello che serve, id dell'asta compreso:

```text
Utenti: 0 creati, 12 utenti di prova a database.
  Password di tutti (M5): asta-di-prova-1 — es. marco.bianchi@example.test
Asta "Asta di prova" creata: stato READY, 8 posti, listone importato.
  Setup:  http://localhost:3000/auctions/<id>/setup
  Lobby:  http://localhost:3000/auctions/<id>/lobby
  TV:     http://localhost:3000/tv/<publicToken>
  Invito: http://localhost:3000/join/<token>
  Owner:  Marco Bianchi — seat 7, l'ultimo occupato
  Bot, giocano tutti:
    pnpm bots --auction=<id> --count=8 --strategy=random --start --url=http://localhost:3000
  Bot, giochi tu come Marco Bianchi (tieni aperto il portale, poi avvia dalla regia):
    pnpm bots --auction=<id> --count=7 --strategy=random --url=http://localhost:3000
```

**Copia la riga che ti serve.** Sono i due comandi dei bot già compilati con l'id giusto: il primo
per guardare un'asta che si gioca da sola, il secondo per giocarla tu. È il modo più veloce per non
andare a cercare l'id dell'asta da nessuna parte.

---

## 1. Postgres

```bash
docker compose up -d          # la prima volta anche: pnpm db:push
docker compose ps             # deve dire "Up (healthy)"
```

La porta sull'host è **5433**, non 5432 (c'è un altro Postgres su quella macchina — vedi
`docs/DECISIONS.md`, 2026-08-07). `DATABASE_URL` nel `.env` la conosce già.

`pnpm db:push` serve solo la prima volta, o dopo una macro-feature che ha toccato
`lib/db/schema.ts`.

## 2. Il seed

```bash
pnpm db:seed                             # solo i 12 utenti di prova, nessuna asta
pnpm db:seed --auction-status=ready      # + un'asta a 8, listone importato, tutti seduti
```

Senza `--auction-status` **non nasce nessuna asta**: si ottengono soltanto i dodici utenti con cui
funziona l'accesso di sviluppo. È il caso in cui si vuole creare l'asta a mano dall'interfaccia,
per collaudare il setup.

Gli stati generabili sono cinque:

| `--auction-status=` | Cosa produce |
|---|---|
| `draft` | asta a 8 con **un posto libero**: serve a vedere il ritorno READY → DRAFT |
| `ready` | asta a 8 piena, in attesa dell'avvio. **È quello da usare quasi sempre** |
| `live` | asta appena avviata, primo turno di chiamata aperto |
| `mid` | asta già a metà: metà degli slot assegnati, crediti consumati, rose vere |
| `completed` | asta finita, per guardare i tabelloni finali |

Il seed è **idempotente sugli utenti** e **distruttivo sull'asta di prova**: l'asta chiamata «Asta
di prova» viene cancellata e rifatta da zero a ogni esecuzione, così si riparte sempre da uno
stato noto. Gli stati avanzati non sono righe scritte a mano: il seed fa girare il motore vero su
un orologio virtuale, quindi ciò che trovi a database è uno stato che l'applicazione sa produrre.

⚠ **`mid` con l'app accesa prosegue da sola.** Lo scheduler trova un'asta LIVE con una deadline
davanti e comincia a chiudere i round: se ti serve ferma per guardarla, mettila in pausa dalla
regia appena entri.

## 3. L'app

```bash
pnpm dev          # http://localhost:3000
pnpm dev:lan      # come sopra ma raggiungibile dal telefono; stampa l'URL da digitare
```

**Deve restare accesa per tutta la prova.** Non è solo l'interfaccia: è quel processo ad avere lo
scheduler, cioè l'unica cosa che chiude i round allo scadere dei timer. Con l'app spenta i bot
offrono e poi l'asta resta immobile per sempre.

`pnpm dev:lan` è la variante da usare quando la prova è "il portale sul telefono vero": passa ad
Auth.js l'IP di LAN, altrimenti dopo il login il telefono finirebbe su un indirizzo morto.

## 4. Entrare come chi ha creato l'asta

Vai su <http://localhost:3000>. Sotto il pulsante di Google c'è una sezione **«Accesso di
sviluppo»** con un pulsante per ciascuno dei dodici utenti del seed. Esiste solo fuori produzione:
è un provider registrato solo se `NODE_ENV !== "production"`, e un test automatico verifica che in
produzione non ci sia.

**L'owner dell'asta di prova è sempre `Marco Bianchi`** — il primo dei dodici utenti. Clicca
«Entra come Marco Bianchi» e da lì hai tutto:

| Dove | Cosa ci fai |
|---|---|
| `/dashboard` | l'elenco delle sue aste: «Asta di prova» è lì |
| `/auctions/<id>/setup` | timer, slot, budget, listone, inviti |
| `/auctions/<id>/lobby` | chi è seduto, chi è collegato |
| `/auctions/<id>/manage` | **la regia**: avvio, pausa, override, correzioni. Solo l'owner |
| `/auctions/<id>/play` | il suo portale da partecipante (è anche il seat 0) |
| `/tv/<publicToken>` | la vista TV: è **pubblica**, aprila in un'altra scheda senza login |

La lista del login è in ordine alfabetico, quindi «Marco Bianchi» non è il primo pulsante: cercalo
per nome, non per posizione.

### Provare invece la strada email e password (M5)

L'accesso di sviluppo è comodo ma **salta esattamente ciò che M5 ha aggiunto**. Per collaudare la
seconda strada, sulla stessa pagina di login, sopra la sezione di sviluppo:

- **Email**: `marco.bianchi@example.test` — la regola è nome.cognome, tutto minuscolo, senza accenti.
- **Password**: `asta-di-prova-1`, uguale per tutti e dodici. La stampa anche il seed.

I dodici utenti del seed nascono **già verificati** (`email_verified_at` scritto): senza, finirebbero
tutti su `/verify` a chiedere un codice che nessuno può leggere, perché dietro `@example.test` non
c'è nessuna casella di posta.

### Provare il giro completo della registrazione

⚠ **Senza `SMTP_HOST` nel `.env` non serve nessuna credenziale: il codice esce sullo stdout del dev
server.** Tienilo sott'occhio nel terminale di `pnpm dev`, dove compare così:

```text
──── EMAIL (non inviata: nessun SMTP_HOST nel .env) ────
A:       mario@example.com
Oggetto: Il tuo codice di verifica
CODICE:  418302
───────────────────────────────────────────────────────
```

1. `/signup`, un indirizzo qualsiasi e una password di almeno 10 caratteri.
2. Copia il codice dal terminale e incollalo su `/verify`.
3. Poi `/onboarding` per il nome, e sei nella dashboard.

⚠ **Se invece `SMTP_HOST` è impostata, in locale le email partono per davvero** e nel terminale non
compare nessun blocco: il codice è nella casella di posta, spam compreso. È il modo di verificare le
credenziali del provider *prima* del deploy. Per tornare allo stdout basta svuotare `SMTP_HOST` e
riavviare `pnpm dev`.

**Se non arriva niente e nel terminale non c'è nemmeno il blocco**, in ordine:

1. Il dev server ha davvero letto il `.env`? Se hai aggiunto le variabili **dopo** averlo avviato,
   riavvia `pnpm dev`.
2. Le credenziali funzionano? **`pnpm mail:check`**: apre la connessione, si autentica, chiude, e
   **non manda niente**. Un errore qui è credenziali o porta sbagliate (587 in STARTTLS, 465 in TLS
   implicito). Con `pnpm mail:check --to=<indirizzo>` manda anche un'email di prova vera.

   ⚠ Se `pnpm mail:check` funziona e l'applicazione no, **il problema non è l'SMTP**: è che il
   processo dell'app ha in ambiente un `.env` diverso, perché è stato avviato prima della modifica.
   In locale si riavvia `pnpm dev`; in produzione serve
   `pm2 reload deploy/ecosystem.config.cjs --update-env`, **non** `pm2 restart asta`.
3. Il server SMTP ha accettato il messaggio ma non arriva? Guarda il pannello del provider: con
   MailerSend gli account in prova accettano solo destinatari del dominio amministratore, e il
   `MAIL_FROM` deve stare **sul dominio verificato** — altrimenti l'invio viene rifiutato, e
   l'errore si vede solo al primo tentativo vero.

Le cose che vale la pena provare a mano, perché i test le coprono ma vederle è un'altra cosa:

- **Non verificato non fa niente**: con l'account appena creato e il codice non inserito, prova ad
  aprire `/dashboard` o un link d'invito — rimbalzi su `/verify`.
- **Il codice scaduto**: `UPDATE email_codes SET expires_at = now() - interval '1 minute'
  WHERE consumed_at IS NULL;` e riprova. La schermata lo dice e offre il pulsante.
- **Il recupero**: `/forgot` con lo stesso indirizzo, poi il codice dal terminale su `/reset`.
- **Il reinvio troppo presto**: due click di fila su «Mandami un altro codice» — il secondo viene
  rifiutato con i secondi che mancano. Quel limite vive nel database, non in memoria.

## 5. I bot

```bash
pnpm bots --auction=<id> --count=8 --strategy=random --start
```

I bot sono **client veri**: si firmano un cookie di sessione con `AUTH_SECRET`, aprono lo stream
SSE come farebbe un browser e agiscono via HTTP. Non toccano il motore nel proprio processo — è
per questo che, mentre girano, quello che vedi sullo schermo si muove davvero.

| Opzione | A cosa serve |
|---|---|
| `--auction=<id>` | obbligatoria. L'id lo stampa il seed |
| `--count=N` | quanti seat far giocare ai bot, **a partire dal seat 0**. Senza, li prende tutti. `--count=7` lascia libero l'ultimo posto, che è quello dell'owner |
| `--strategy=random` | offerte casuali basse: il comportamento realistico, per una prova lunga |
| `--strategy=aggressive` | tutti al massimo consentito: brucia i crediti e mette alla prova i limiti |
| `--strategy=passive` | tutti al minimo: utile per vedere i lotti che si chiudono al prezzo base |
| `--strategy=tie` | tutti sullo stesso importo: **è il modo di innescare lo spareggio a comando**, che a mano è quasi impossibile |
| `--start` | avvia l'asta da solo (usa il cookie dell'owner). Ometti se vuoi premere «Avvia» tu dalla regia |
| `--verbose` | stampa ogni azione e ogni rifiuto |
| `--url=` | il server a cui parlare, se non è `http://localhost:3000` |

A fine asta stampa un riepilogo con azioni riuscite e rifiutate. **I rifiuti sono normali**: un
round che si chiude mentre un bot stava per offrire è esattamente ciò che deve succedere.

Per fermarli: `Ctrl-C`.

---

## 6. Le figurine, se vuoi vederle (M7)

Non serve per giocare: senza, il portale e la TV mostrano i lotti esattamente come prima, solo senza
la caricatura del giocatore. Se la vuoi, è un passo solo e dura pochi secondi.

Da amministratore (`users.is_admin`), **Admin → Figurine**: si carica `fixtures/listone.xlsx` — il
listone vero da 495 giocatori, già in git — e si preme il pulsante. Al primo giro scarica tutto in
circa tre secondi; premuto di nuovo non scarica niente e lo dice, perché lo stato è il disco.

Le immagini finiscono in `storage/campioncini/`, che è fuori da git e **fuori da `public/`**: non la
tocca né `pnpm build` né `git reset --hard`, quindi la scarichi una volta e resta lì per tutte le
prove successive. Sono ~53 MB.

Due cose che non sono guasti, così non le cerchi:

- **Circa un giocatore su tre ha una sagoma senza volto** con la maglia del club, invece della
  caricatura. Sono 144 su 495, è così anche in produzione, ed è voluto che si mostrino come le altre.
- **Se l'archivio è vuoto la figurina non compare e basta**: nessun rettangolo grigio, il testo scorre
  a sinistra. Non è un errore da indagare, è il caso «non l'ho ancora scaricato».

Per svuotarlo: `rm -rf storage/campioncini`. Non c'è un pulsante, di proposito.

---

## Chi è chi nell'asta di prova

I posti sono sempre gli stessi fra un seed e l'altro: serve a poter rifare la stessa prova due
volte e riconoscere le stesse squadre.

| Seat | Utente | Squadra |
|---|---|---|
| 0 | Luca Ferrari | Real Fantozzi |
| 1 | Andrea Russo | Atletico Divano |
| 2 | Matteo Esposito | Borussia Bar Sport |
| 3 | Francesco Romano | Inter Nos |
| 4 | Alessandro Colombo | Sporting Panchina |
| 5 | Davide Ricci | Deportivo Rigore |
| 6 | Simone Marino | Bayern Cucina |
| 7 | **Marco Bianchi** (owner) | AC Rimonta |

**L'owner è l'ultimo posto, ed è deliberato.** I bot prendono i posti a partire da zero, quindi
con `--count=7` quello che resta libero è il suo: è la configurazione con cui giochi di persona
restando l'owner, cioè con la regia e il portale nello stesso browser.

Gli altri quattro utenti del seed (Giulia Greco, Chiara Bruno, Sara Gallo, Elena Conti) esistono a
database ma **non sono seduti**: servono a provare gli inviti e i join.

L'asta di prova nasce con 8 posti, 500 crediti, slot 3/8/8/6 e **timer corti** — 3 secondi per
offrire, 3 per chiamare, 2 di preparazione spareggio, 2 di rivelazione. Non è una scorciatoia di
ambiente: sono proprio i parametri con cui l'asta viene creata, il motore è identico a quello di
produzione.

---

## Le due prove tipiche

### A. Guardare la serata dalla regia (la più frequente)

Tu sei l'owner e conduci; i bot giocano tutti e otto i posti.

```bash
pnpm db:seed --auction-status=ready
pnpm dev
```

1. Entra come **Marco Bianchi**, apri `/auctions/<id>/manage`.
2. In un'altra scheda apri la **vista TV** col link stampato dal seed (non serve login).
3. Lancia i bot **senza** `--start`:
   `pnpm bots --auction=<id> --count=8 --strategy=random`
4. Aspetta che in lobby tutti risultino collegati, poi premi **Avvia** dalla regia.

Il cancello d'avvio pretende che **tutti** i membri siano LIVE, cioè visti negli ultimi 15 secondi
e con la pagina in primo piano. I bot battono il proprio heartbeat da soli; la pagina di regia
batte quello dell'owner quando l'owner è anche un membro, come qui. Se «Avvia» resta rifiutato, è
quasi sempre un bot non ancora partito o una scheda finita in background.

### B. Giocare tu una squadra, con sette bot attorno

Questa è la prova completa: **sei Marco Bianchi**, quindi owner e partecipante insieme, e non devi
cambiare account né browser.

```bash
pnpm db:seed --auction-status=ready
pnpm dev
pnpm bots --auction=<id> --count=7 --strategy=random     # niente --start
```

1. Entra come **Marco Bianchi** e apri `/auctions/<id>/play`: è il tuo portale, seat 7.
2. I sette bot occupano i seat 0–6. Il tuo resta libero perché **prendono i posti da zero in su**
   e l'owner è l'ultimo: è il motivo per cui il seed lo fa entrare per ultimo.
3. Quando in lobby sono tutti collegati, avvia l'asta. Puoi farlo da `/auctions/<id>/manage`, che
   è tua: la regia e il portale sono dello stesso utente, in due schede.

⚠ **Niente `--start` qui.** Il cancello d'avvio pretende tutti i membri LIVE, e il tuo posto è
LIVE solo se hai già una tua pagina aperta e in primo piano. Avviando tu dalla regia il problema
non si pone; con `--start` i bot proverebbero a partire prima che tu sia in piedi.

Per giocare dal telefono invece che dal browser del computer, usa `pnpm dev:lan` e apri sul
telefono l'URL che stampa — il portale è mobile-first, ed è lì che va provato.

---

## Le varianti

**Una prova senza terminali: la simulazione in-app** (M4, da v1.5.0). È la via più corta e ormai
quella normale — niente seed, niente id da copiare, niente `pnpm bots` in una finestra a parte.
Serve solo l'app accesa.

1. Entra come **Marco Bianchi**, che il seed nomina amministratore dell'applicazione (è il primo
   dei dodici, lo stesso che possiede l'asta di prova).
2. «Crea un'altra asta», spunta **«Asta simulata»** — la casella la vedi solo tu, e solo perché sei
   amministratore — e configurala come faresti per una vera.
3. Importa il listone, e da «Partecipanti» premi **«Partecipa anche tu»** se vuoi giocarla.
4. Nel pannello **«Partecipanti simulati»**, accanto agli inviti, scegli quanti bot e come offrono,
   poi «Riempi con i bot». Con «Pareggio» per tutti inneschi lo spareggio a comando.
5. Vai in regia e premi «Avvia». I bot risultano già collegati: a tenerli vivi è il tick del
   server, non un browser.

⚠ **Se i bot non si muovono**, prima di indagare guarda se hai un'**asta reale** in corso: finché
esiste un'asta non simulata `LIVE` o `PAUSED`, il tick sta fermo apposta, e la pagina della
configurazione te lo scrive. Le aste create dal seed sono simulate, quindi non fanno scattare la
regola.

Non è una prova che sostituisce del tutto `pnpm bots`: la simulazione gira dentro il server, quindi
**non** collauda sessione, rotta HTTP, SSE e nginx. Quando quello che vuoi provare è il canale — o
quando vuoi giocare un'asta contro il server di produzione — resta lo script.

**Il pannello di amministrazione** (M6). Entra come **Marco Bianchi** — il primo dei dodici, quello
che il seed nomina amministratore — e in navbar compare il pulsante **«Admin»**. Gli altri undici non
lo vedono, e se digitano `/admin` a mano finiscono in dashboard. Da lì:

- **Utenti**: la lista dei dodici, con da quale porta entrano e quante aste possiedono e giocano. I
  bot non ci sono, e per vederli c'è «mostra anche i bot» — con qualche asta simulata riempita, è la
  differenza fra una lista di dodici righe e una di sessanta.
- Il pulsante **«Verifica a mano»** compare solo accanto a chi non è verificato. Per provarlo serve
  una riga non verificata, e il seed non ne fa: registrane una da `/signup` e **non** inserire il
  codice. Prima del pulsante quell'account resta inchiodato su `/verify`; subito dopo — basta
  ricaricare — arriva all'onboarding.
- **`is_admin`**: sulla propria riga non c'è nessun pulsante, e c'è scritto «sei tu». È deliberato:
  un click e ti chiudi fuori dal pannello, e da dentro l'applicazione non si rientra più.
- **Aste**: tutte quelle del database, con l'email di chi le ha create. Le aste `LIVE` o `PAUSED`
  dicono «in corso» al posto del pulsante di cancellazione — e se ci provi comunque, il server
  rifiuta anche a un amministratore.

**Ricominciare da capo**: rilancia `pnpm db:seed --auction-status=ready`. L'asta di prova viene
buttata e rifatta; gli utenti restano quelli, quindi resti loggato.

**Buttare via tutto il database** e ripartire dallo schema:

```bash
docker compose down -v && docker compose up -d
pnpm db:push && pnpm db:seed --auction-status=ready
```

**Ripulire i residui dei test.** Una passata completa di `pnpm test` si pulisce da sé — le righe che
crea le cancella `afterAll`. Ma un run **interrotto a metà** (`Ctrl-C`, un file che muore, il watch
chiuso di fretta) le lascia dov'erano, e non se ne accorge nessuno finché non si apre la lista utenti
del pannello e ci si trovano venti righe `Test game-3 <uuid>`. Si contano e si tolgono così — l'unico
posto che produce quell'indirizzo è `tests/db/helpers.ts`, quindi il filtro non può prendere un
account vero:

```bash
docker exec -i fantasta-db psql -U postgres -d asta \
  -c "SELECT count(*) FROM users WHERE email LIKE '%@test.invalid'"

docker exec -i fantasta-db psql -U postgres -d asta -c "
  DELETE FROM auctions WHERE owner_user_id IN
    (SELECT id FROM users WHERE email LIKE '%@test.invalid');
  DELETE FROM users WHERE email LIKE '%@test.invalid';"
```

⚠ **L'ordine conta e non è cosmetico**: `auctions.owner_user_id` **non** ha `onDelete`, quindi finché
l'asta di prova esiste Postgres rifiuta di cancellare il suo owner. È una rete utile — vuol dire che
nessuna pulizia degli utenti può portarsi via un'asta di nascosto — ma se si dà solo la seconda riga
sembra che il comando «non funzioni». Lo stesso vale per i bot rimasti senza asta: si tolgono solo
quelli che non sono membri di niente.

---

## Quando qualcosa non torna

**Le fasi sembrano accavallarsi: dal lotto aperto si salta al lotto aperto dopo, la rivelazione
non si vede mai, i bot non offrono e i lotti si chiudono tutti a 1 con `auto_called`.**

Cerca **un secondo processo dell'applicazione sullo stesso database**:

```bash
lsof -nP -iTCP -sTCP:LISTEN | grep node      # chi ascolta, e su che porta
ps -eo pid,ppid,etime,command | grep next-server
```

Il colpevole tipico è un `next-server` orfano (`ppid 1`) lasciato acceso da un `pnpm build &&
pnpm start` di ieri, con cwd `.next/standalone`, su una porta qualsiasi. **Ogni processo Next
esegue `instrumentation.ts`, quindi ha uno scheduler suo**: due processi sono due scheduler sulla
stessa asta. È lo stesso motivo per cui in produzione `deploy/ecosystem.config.cjs` impone
`exec_mode: "fork"` e `instances: 1`.

Il guaio non è che l'asta avanzi due volte — il lock a database la protegge, e infatti **lo stato
resta corretto e ordinato**. Il guaio è che il registro delle connessioni SSE è *in memoria, per
processo*: quando è l'altro processo a far scadere una fase, il suo broadcast va al suo registro,
che è vuoto, e chi è attaccato al tuo `pnpm dev` non riceve niente. I bot non vedono
`WAITING_PICK` né `LOT_REVEAL`, quindi non chiamano e non offrono; le offerte fatte via HTTP
invece arrivano subito, perché quelle passano dal processo giusto. Il risultato a schermo è
esattamente «le fasi si accavallano».

Come si riconosce in dieci secondi: nella tabella `lots` una fila di lotti consecutivi con
`auto_called = true`, una sola offerta e `final_price = 1`.

```sql
select seq, status, final_price, auto_called from lots
where auction_id = '<id>' order by seq desc limit 20;
```

La cura è terminare il processo di troppo (`kill <pid>`), non toccare il codice.

**Il portale resta su «Mi collego all'asta…» e non arriva nessuno snapshot.**
Prima di indagare, guarda la console del browser: se c'è un **404 su un chunk**
(`/_next/static/chunks/app/.../page.js`) non è un bug dell'app — è il bundle stantio di `pnpm dev`
dopo molte modifiche. Riavvia il dev server.

**I bot dicono «L'app non risponde su `http://localhost:3000`».**
L'app è spenta, o è su un'altra porta. Loro il database lo leggono una volta sola in avvio: tutto
il resto passa da HTTP, e senza server non esistono.

**I bot dicono «AUTH_SECRET non combacia».**
Stanno leggendo un `.env` diverso da quello con cui gira l'app — tipicamente perché l'app è stata
avviata prima di una modifica al `.env`. Riavvia `pnpm dev`.

**L'asta non parte: «Avvia» viene rifiutato.**
È il cancello di presence: serve che *tutti* i membri siano LIVE. Basta una scheda in background
per farlo fallire. Controlla la lobby, che dice chi è collegato e chi no.

**L'asta parte da sola appena accendo l'app.**
Hai seminato `live` o `mid`: quelle aste sono già LIVE e lo scheduler fa il suo mestiere. Usa
`ready` se la vuoi ferma.

**Ho fatto `pnpm db:seed` e non trovo nessuna asta.**
Senza `--auction-status` il seed crea solo gli utenti. È voluto.

**Il pulsante «Entra come …» non c'è.**
Stai girando con `NODE_ENV=production` (per esempio dopo `pnpm build && pnpm start`): il provider
di sviluppo lì non esiste, per costruzione.
