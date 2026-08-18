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

## 6. Il listone a sistema, il foglio di Carmy, e le figurine (M7, M10, M10B)

⚠ **Da M10 questo è il passo che conviene dare per primo**, prima ancora dei bot: il listone a
sistema si carica **una volta** e serve tutte le prove successive — le caricature, il Centro dati, e
la proposta che compare a chi crea un'asta. Prima di M10 lo stesso file andava ricaricato ogni volta
e in tre posti diversi.

⚠ **E da M10B l'ordine dentro questo passo conta: listone → Carmy → caricature.** Non è una
preferenza: il foglio di Carmy si aggancia al listone **per nome** e le caricature prendono gli
identificativi dal listone, quindi il listone è il primo **di necessità**. I pulsanti degli altri due
sono spenti finché non c'è, e lo dicono.

Da amministratore (`users.is_admin`), **Admin → Listone**: si carica `fixtures/listone.xlsx` — il
listone vero da 495 giocatori, già in git — e si preme «Carica il listone». È istantaneo.

⚠ **La tabella `listone_players` nasce vuota anche in locale**, ed è la stessa storia di
`player_insights`: finché non carichi il file **non si rompe niente**, semplicemente le caricature
non si scaricano, il Centro dati è vuoto, e alla creazione di un'asta non compare nessuna proposta.
Se vuoi controllare a vista:

```bash
docker compose exec db psql -U postgres -d asta -c "select count(*) from listone_players;"
```

Da qui in poi, creando un'asta, la prima domanda del form è quale listone usare: «Il listone a
sistema · 495 giocatori · caricato il …» oppure «lo carico io». La seconda strada è quella di
sempre, e resta: serve a correggere un file sbagliato. ⚠ Se scegli il listone a sistema per
un'asta a **12** partecipanti con gli slot di default, I9 passa — la fixture regge tutti e tre i
tagli — ma se provi con un listone piccolo l'asta **viene creata lo stesso**, in DRAFT, e il motivo
è scritto in cima alla sua configurazione. Non è un guasto: è la regola.

### Il foglio di Carmy (M10B)

⚠ **Va caricato dopo il listone e prima delle caricature**, e l'ordine **non è una preferenza**: il
foglio non ha identificativi, si aggancia al listone **per nome**, e senza listone non c'è niente a cui
agganciarsi. Il pulsante è spento finché il listone non c'è, e lo dice.

Nella stessa pagina, sotto l'upload del listone: si carica `fixtures/carmy.xlsx` — quattro fogli,
497 giocatori, già in git — e si preme «Carica il foglio». È istantaneo.

Cosa deve dire quando è andato bene, sui byte del 2026-08-12:

```text
487 giudizi a sistema su 497 righe del foglio.
Non trovati nel listone (10): Satalino, Chalobah T., … — di solito sono acquisti
più recenti del listone caricato.
Squadra diversa dal listone (3): Dominguez B. — Carmy Sassuolo, listone Bologna; …
```

**Tutte e tre le righe sono normali.** I dieci non agganciati sono giocatori che il listone del 6
agosto non aveva ancora; le tre discordanze di squadra sono trasferimenti veri, e il giudizio viene
importato comunque. Se invece il caricamento **rifiuta** dicendo «solo N nomi su 497 (…%) trovano un
giocatore nel listone», il foglio e il listone parlano di due elenchi diversi: di solito il listone è
vecchio, e si ricarica quello prima.

Tre cose che non sono guasti:

- **Un nome su tre diventa verde** nella lista di chiamata: la soglia è `Titolarità >= 4`, e sui byte
  veri sono 168 su 497. È una scelta dell'owner, misurata (`docs/DECISIONS.md`, 2026-08-12).
- **Accanto al badge c'è un rapporto tipo `3/38`**, ed è voluto che a volte contraddica il badge: è la
  prova del giudizio, e la divergenza è l'informazione. Su chi ha solo le statistiche della stagione
  precedente quel rapporto **non compare**, e il giudizio resta da solo.
- **Senza il foglio caricato il portale è identico a prima**, badge delle presenze compreso. È il
  ripiego dichiarato, non un caso.

Per svuotarlo:
`docker compose exec db psql -U postgres -d asta -c "delete from carmy_players;"`. Come per il
listone, non c'è un pulsante, di proposito.

### Le figurine

Non servono per giocare: senza, il portale e la TV mostrano i lotti esattamente come prima, solo
senza la caricatura del giocatore. Se le vuoi, adesso è **un pulsante e basta**, nella stessa pagina:
«Scarica le caricature». Gli identificativi li prende dal listone a sistema, quindi va caricato
prima — il pulsante è spento finché non lo fai, e lo dice. Al primo giro scarica tutto in circa tre
secondi; premuto di nuovo non scarica niente e lo dice, perché lo stato è il disco.

Le immagini finiscono in `storage/campioncini/`, che è fuori da git e **fuori da `public/`**: non la
tocca né `pnpm build` né `git reset --hard`, quindi le scarichi una volta e restano lì per tutte le
prove successive. Sono ~53 MB.

Due cose che non sono guasti, così non le cerchi:

- **Circa un giocatore su tre ha una sagoma senza volto** con la maglia del club, invece della
  caricatura. Sono 144 su 495, è così anche in produzione, ed è voluto che si mostrino come le altre.
- **Se l'archivio è vuoto la figurina non compare e basta**: nessun rettangolo grigio, il testo scorre
  a sinistra. Non è un errore da indagare, è il caso «non l'ho ancora scaricato».

Per svuotare l'archivio: `rm -rf storage/campioncini`. Per svuotare il listone a sistema:
`docker compose exec db psql -U postgres -d asta -c "delete from listone_players;"`. Non c'è un
pulsante né per l'uno né per l'altro, di proposito.

### Il Centro dati

**Admin → Listone → Centro dati**: tutto il listone a sistema in una tabella, con la ricerca e il
filtro per ruolo. È il posto più veloce da cui vedere se gli insight sono stati importati davvero —
chi ha `—` in tutte e due le colonne non ha una riga di insight, o ne ha una della stagione
precedente.

Da M10B ci sono anche le colonne del foglio di Carmy — fascia, fantamedia **attesa**, `PMA`,
affidabilità, integrità, note — e il **filtro per tag**, che è il fratello di «rigori e piazzati».
Tutte le intestazioni ordinano, e chi non ha il valore va **in fondo in entrambe le direzioni**: se
invertendo una colonna ti aspettavi trecento trattini in cima, è quella la regola.

⚠ **Il prezzo consigliato in crediti non è una colonna di questa tabella** (owner, 2026-08-12): al suo
posto c'è il `PMA`. Non sono lo stesso numero — su 385 righe con entrambi, solo 132 coincidono con
`prezzo / 5` — e il prezzo in crediti si vede nel **modale d'offerta**, dove serve a proporre una
cifra. Se cerchi «Consigl.» in tabella e non c'è, è questo il motivo.

## 7. Gli insight sul listone, se vuoi vederli (M8, M9)

Anche questo non serve per giocare: senza, la lista di chiamata e il modale d'offerta sono quelli di
prima. Ma è il modo per vedere la parte nuova, e sono **due click e mezzo**.

⚠ **Da M9 questo passo è anche il modo di non perdere mezz'ora.** I badge colorati vivono in
`player_insights`, che **nasce vuota anche in locale**: senza i due import qui sotto non compare *nessun*
badge, per nessun utente, e il sintomo è «in `/play` non vedo niente» — cioè identico a un bug.
È già successo (2026-08-12). Prima di sospettare il codice, controlla che la tabella abbia delle righe:

```bash
docker compose exec db psql -U postgres -d asta -c "select count(*) from player_insights;"
```

⚠ **E i badge stanno in due posti soli**, che è il perimetro di M8 §7 e M9 §4: la **lista di chiamata**
(solo quando è il tuo turno, a `WAITING_PICK` sul tuo seat) e il **modale d'offerta** (a `LOT_OPEN`, se
sei idoneo). **Non** sulla card del lotto, **non** al reveal, **non** in regia, **non** sulla TV. Un'asta
ferma in `LOT_REVEAL` non mostra badge nemmeno funzionando tutto.

Da amministratore, **Admin → Listone** — la stessa pagina del passo 6, i due pulsanti stanno sotto
l'upload: si preme «Importa il listone» (scarica 497 giocatori da
`api.fantalab.it`, poco più di un secondo) e poi «Aggiorna i designati» (la pagina dei rigoristi di
Fantacalcio.it, mezzo secondo). ⚠ **In quest'ordine**: il secondo aggiorna righe che nascono dal
primo, e su una tabella vuota rifiuta dicendolo.

Il mezzo click è il permesso: **Admin → Utenti**, colonna «Insight», pulsante «Dai insight» sulla riga
di chi vuoi far giocare. Chi è amministratore li vede già senza.

Tre cose che non sono guasti:

- **Con l'asta di prova del seed non si vede quasi niente**, ed è giusto: quel listone è sintetico e i
  suoi `ext_id` non esistono nella fonte. Il pannello lo dice — la copertura di quell'asta è vicina a
  zero. Per vedere gli insight sul serio serve un'asta creata importando `fixtures/listone.xlsx`, che
  ha gli identificativi veri: lì la copertura è **487 su 495**.
- **Un terzo dei giocatori mostra `—`**: sono quelli per cui la fonte ha solo i numeri della stagione
  precedente, e non si mescolano con quelli di quest'anno.
- **Otto giocatori del listone vero non hanno insight** (Djimsiti, Angelino, Gutierrez e altri
  cinque): i due elenchi non coincidono, e il pannello li elenca per nome.

La tabella è **globale**: sopravvive alla cancellazione delle aste e ai `pnpm db:seed`, quindi si
importa una volta e resta lì per tutte le prove. Per svuotarla:
`docker compose exec db psql -U postgres -d asta -c "delete from player_insights;"`.

⚠ **`pnpm test` la svuota**, insieme a `listone_players`, `carmy_players` e `source_runs`: i test con
Postgres puliscono ciò che hanno sporcato, ed è il comportamento giusto. Vuol dire che dopo ogni
`pnpm test` il giro di §6 e §7 va rifatto, in quest'ordine: listone → Carmy → i due import. Se «in
`/play` non vedo niente» arriva subito dopo una suite verde, il colpevole è questo e non il codice.

## 8. Il refresh automatico, e come si prova senza aspettare un quarto d'ora (M11)

Da M11 i due import di §7 partono **da sé**, una volta al giorno, dentro il processo dell'app: c'è un
terzo `setInterval` accanto allo sweep e al tick dei bot, che ogni **quindici minuti** rilegge la
tabella `source_runs` e si chiede, per ciascuna fonte, quando ha provato l'ultima volta e com'è andata.

Questo cambia una cosa nelle prove in locale, e conviene saperla prima di trovarsela: **con `pnpm dev`
acceso, `player_insights` si riempie da sola** entro un quarto d'ora dal primo avvio, perché
`source_runs` nasce vuota e «nessun tentativo registrato» vuol dire «prova adesso». Non è un guasto ed
è precisamente ciò che la macro fa. ⚠ Il rovescio è che se `pnpm test` gira **mentre** scatta un tick,
i test degli insight possono trovare righe che non hanno scritto loro: è una finestra di due secondi
ogni quindici minuti, ma se vedi un rosso irriproducibile in `tests/db/insights.test.ts` guarda l'ora
prima di guardare il codice.

**Come si guarda lo stato.** Le due righe stanno tutte lì:

```bash
docker compose exec db psql -U postgres -d asta -c "select * from source_runs;"
```

E in pagina, **Admin → Listone**: accanto a ciascuno dei due pulsanti c'è una riga che dice com'è
andato l'ultimo tentativo, quando, e se è partito **da sé o a mano**.

**Come si fa scattare un tick adesso.** Non serve aspettare: lo stato è a database, quindi basta
mentire sulla data dell'ultimo tentativo. Il loop se ne accorge al giro dopo, e nel frattempo si può
guardare il pannello.

```bash
# «l'ultimo tentativo è di due giorni fa»: il prossimo tick di quindici minuti riprova
docker compose exec db psql -U postgres -d asta \
  -c "update source_runs set attempted_at = now() - interval '2 days';"

# oppure: azzerare tutto, così il primo tick riprova subito tutte e due le fonti
docker compose exec db psql -U postgres -d asta -c "delete from source_runs;"
```

⚠ **Non serve riavviare `pnpm dev`**, e riavviarlo non accelera niente: il tick non parte all'avvio del
processo, proprio perché il processo riparte a ogni modifica. Se non vuoi attendere il prossimo quarto
d'ora, l'alternativa è premere uno dei due pulsanti in pagina: scrivono la stessa riga con
`trigger = 'manual'`, e il refresh automatico ne tiene conto.

**Come si prova il caso che conta, cioè il guasto.** È l'unico modo in cui questa macro parla, quindi
val la pena guardarlo almeno una volta. Si scrive a mano una riga fallita e si apre **Admin → Listone**:
in cima alla pagina compare l'avviso rosso, che in condizioni normali non c'è.

```bash
# «non si aggiorna da tre volte»: è la frase della verifica 7
docker compose exec db psql -U postgres -d asta -c "
  insert into source_runs (source, attempted_at, ok, message, rows, failures, trigger)
  values ('listone_insights', now(), false,
          'La fonte ha risposto 503. Riprova fra qualche minuto: non c''è niente da sistemare da parte nostra.',
          null, 3, 'auto')
  on conflict (source) do update set
    ok = false, failures = 3, message = excluded.message, attempted_at = excluded.attempted_at;"
```

Con `failures = 1` la frase è «non si è aggiornato»; da 2 in su diventa «non si aggiorna da *due*
volte», a parole. È voluto: «fallito» è un incidente, un numero è un guasto che dura.

**Tre cose che non sono guasti.**

- **Con un'asta *vera* `LIVE` o `PAUSED` il refresh non fa niente**, esattamente come i bot. È la stessa
  funzione (`realAuctionRunning`), e le aste **simulate non contano**: una simulazione in pausa non
  ferma il refresh. Un tick saltato per questa ragione **non** scrive su `source_runs` — se lo
  scrivesse, una serata d'asta manderebbe le fonti in backoff per un guasto che non c'è stato.
- **Se una fonte è giù, non viene richiesta ogni quindici minuti**: si riprova dopo un'ora, poi due,
  quattro, otto, sedici, e poi una volta al giorno. Se stai aspettando un tentativo e non arriva,
  guarda `failures` prima di sospettare il loop.
- **A `player_insights` vuota la seconda fonte viene saltata**, e non registrata come fallita: aggiorna
  righe che nascono dalla prima. Nel `source_runs` di un database appena azzerato è normale trovare una
  riga sola dopo il primo giro.

⚠ **E il controllo che nessun test può fare.** Se ci sono **due** processi dell'app accesi, ci sono due
loop, e il conto dei tentativi non torna — peggio: `source_runs` ha una riga per fonte, quindi il
secondo `upsert` sovrascrive il primo e il conto sembra giusto. Prima di indagare su un refresh che «si
comporta in modo strano»:

```bash
lsof -nP -iTCP -sTCP:LISTEN | grep node
```

Deve esserci **una sola** riga in ascolto sulla porta dell'app. È la stessa diagnosi del paragrafo su
`pnpm build && pnpm start` in fondo a questo documento.

---

## 9. Il congedo: cancellare un'asta mentre qualcuno la guarda (M12)

Da v1.13.0 un amministratore può cancellare un'asta **in corso**, e chi la stava guardando deve essere
avvisato invece di restare davanti a una schermata ferma. È l'unica cosa di questa applicazione che si
prova bene solo con **due dispositivi**, perché i due spettatori si comportano in modo diverso di
proposito.

Serve una simulazione `LIVE` (§5) e due schermi:

1. sul telefono, il portale di un partecipante — `pnpm dev:lan` stampa l'URL da usare in LAN;
2. sul computer, la **vista TV**: dalla regia c'è il link, ed è l'unico URL dell'app che non chiede di
   entrare.

Poi, da un terzo posto — una finestra dove sei entrato come amministratore — apri **Admin → Aste**.
L'asta in corso adesso ha il suo pulsante «Cancella», che prima non c'era: l'avviso che compare nomina
**quante persone sono collegate in quel momento**. Scrivi il nome dell'asta e premi «Interrompi e
cancella».

Cosa deve succedere, e sono tre cose distinte:

- **Il telefono** finisce sulla dashboard, con scritto che quell'asta — per nome — è stata cancellata
  da un amministratore.
- **La TV** non si muove da dove è: mostra «Asta cancellata» in grande, il nome in cima, e si ferma lì.
  Non ha una dashboard dove andare e non ha una sessione: mandarla al login vorrebbe dire proiettare
  una schermata di consenso in mezzo alla stanza.
- **Nessuno dei due riprova a connettersi.** ⚠ Questo si guarda **nel pannello di rete del browser,
  non sullo schermo**: se il `close()` mancasse, lo schermo finirebbe in dashboard identico e la
  differenza sarebbe solo una richiesta in più allo stream, che risponde 404. È l'unico modo di
  distinguere un `close()` che c'è da uno che manca.

E il messaggio nel pannello, dopo la cancellazione, dice quante persone sono state riportate alla
dashboard: deve essere il numero degli schermi che stavi guardando.

**Senza due dispositivi**, il pezzo lato server si vede anche da terminale, ed è la prova che ha
trovato il bug prima della cura (2026-08-17). Apri lo stream della TV con `curl` — il token nell'URL è
tutta l'autenticazione che serve — e guarda cosa arriva:

```bash
curl -sN "http://localhost:3000/api/auctions/<id>/stream?token=<publicToken>"
```

Ad asta viva scorrono gli `event: snapshot` e un `: ping` ogni quindici secondi. Alla cancellazione
arriva **una volta** `event: deleted` col nome dell'asta, e `curl` esce da sé perché il server ha
chiuso lo stream. Prima di M12, al posto di tutto questo, i `: ping` continuavano ad arrivare per
sempre e nessuno snapshot arrivava mai più: la connessione era sana e non aveva più niente da dire, che
è il motivo per cui il guasto sembrava lentezza.

⚠ **Una cancellazione dal terminale non congeda nessuno.** Un `DELETE` da `psql`, o uno script che
chiama `deleteAuction`, girano in un processo che non ha né connessioni aperte né l'hook agganciato: le
righe spariscono e gli schermi restano fermi. Il congedo esiste solo dentro il processo dell'app, che è
esattamente il motivo per cui l'hook si aggancia in `instrumentation.ts`.

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
offrire, 3 per chiamare, 2 di preparazione spareggio, **2 di cancello dei risultati** e 2 di
rivelazione. Non è una scorciatoia di ambiente: sono proprio i parametri con cui l'asta viene creata,
il motore è identico a quello di produzione.

⚠ **Il cancello a 2 secondi è quello che rende utile questo seed, e va saputo** (M14). È l'istante fra
la chiusura di un round e l'apertura delle buste, e il seed lo accende **di proposito**: la colonna a
database ha `DEFAULT 0`, quindi senza quella riga in `DEV_TIMERS` l'asta di prova non attraverserebbe
mai la fase nuova — cioè l'unico collaudo locale che gioca un'asta intera sarebbe anche l'unico che non
prova ciò che il cancello aggiunge. Due secondi bastano al motore e ai bot; **per guardarlo con gli
occhi** conviene alzarlo a 10 da `/auctions/<id>/setup`, campo «Prima dei risultati (s)» — si cambia
anche ad asta iniziata, e vale dal lotto successivo.

⚠ **E in simulazione l'annullamento di un lotto produce spesso lo stesso lotto una seconda volta.** Se
il chiamante era un bot, riprende il turno e richiama — molto probabilmente **lo stesso giocatore**,
perché l'auto-pick è deterministico (`fvm DESC`). Non è un guaio ed è anche il modo di provare la cosa;
ma chi lo vede senza saperlo penserà a un bug.

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
