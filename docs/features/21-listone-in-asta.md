# M21 — Il listone dentro l'asta: una tab, gli obiettivi di ognuno, e i giocatori che restano

> **Stato:** **chiusa**, in produzione da **`v1.21.0`** (2026-08-28). Nasce dall'unica richiesta
> del quaderno del 2026-08-28, tolta da `docs/REQUESTS.md` lo stesso giorno.
>
> ⚠ **Tocca lo schema del database? Sì.** Una tabella nuova (`user_listone`) e due colonne su
> `player_insights`. Dopo il deploy serve `pnpm db:push` sul server, con nessuna asta `LIVE` o
> `PAUSED`, e poi `pm2 reload deploy/ecosystem.config.cjs --update-env`.
> **Backfill a mano? No**, e §3 spiega perché le due colonne nuove si riempiono da sé al primo
> refresh giornaliero. Il rilascio finisce col `db:push`.
>
> ⚠ **Tocca il motore? No.** Non un campo in `serializeSnapshot`, non una riga in `machine.ts`,
> `rules.ts` o `mutate.ts`, nessuna transizione nuova, nessun `withAuctionLock`. Le uniche
> scritture sono un `INSERT` per-utente fuori da qualunque asta.
>
> **Invarianti coinvolti:**
> **I8** — non si aggiunge niente allo snapshot, quindi non c'è nessun importo nuovo da sanificare.
> ⚠ Va **verificato sul diff** e non dedotto: la tab nuova mostra molte più cose insieme di prima, e
> la regola resta che non si renderizza niente che lo snapshot non porti già o che il pool non
> abbia portato all'apertura della pagina.
> **I10** — la tab Listone è **funzione pura del pool e dello snapshot**. Chi ricarica a metà asta
> vede la stessa tabella di chi non si è mosso, perché non c'è niente da recuperare: chi è già stato
> preso si legge dalle rose, non da un evento ascoltato al momento giusto.
> **I2** — non è toccato e non è nemmeno sfiorato: qui non si assegna niente.
>
> **Regole coinvolte:** **3** (nessun dato dell'asta esce da un'altra porta: il listone personale
> viaggia su `listPickPool`, che è la lettura del listone e non lo stato del gioco — la stessa
> strada che M8 e M10B hanno già aperto), **6** (il gate Pro decide una **query**, non un
> `className`), **7** (la tab attiva è l'unico stato locale nuovo, e §6 dice perché non può rendere
> una schermata irraggiungibile), **8** (una tabella sola, non due; nessun componente condiviso
> prima del secondo chiamante).

---

## §0 — Cosa ribalta, e perché il ribaltamento sta in piedi

`lib/import/parseCarmy.ts` **butta la colonna `Obiett.` di proposito**, e la ragione è scritta lì
dentro da M10B:

> «È la **lista della spesa di chi compila il foglio**, non un giudizio sul giocatore: metterla
> nell'app vorrebbe dire mostrare a dodici persone chi punta a comprare l'autore del file, il quale
> gioca la stessa asta. Non si importa, e la ragione sta scritta qui perché è la colonna che
> qualcuno vorrà aggiungere.»

Quella frase è ancora giusta, ed è precisamente per questo che **non si cancella**. Ciò che cade è
il suo presupposto: là il foglio era **uno solo e globale**, quindi importare `Obiett.` avrebbe
significato pubblicare la lista della spesa di una persona sola. Qui l'import è **per utente**, il
dato non esce mai dal browser di chi l'ha caricato, e nessuno vede gli obiettivi di nessun altro.

⚠ **La colonna resta ignorata sul percorso globale.** `uploadCarmy` non la importa e non la
importerà: `carmy_players` è il foglio di una persona mostrato a tutti, e lì l'obiezione di M10B
vale identica. `Obiett.` entra **solo** dal caricamento personale di §5.

Va in `docs/DECISIONS.md` come ribaltamento datato, insieme a questa distinzione: non è «M10B
sbagliava», è «M10B decideva su un altro caso».

---

## Obiettivo

Durante l'asta uno guarda due cose: **cosa sta succedendo adesso** e **chi è rimasto**. Oggi il
portale risponde benissimo alla prima e per niente alla seconda: la lista dei giocatori esiste, ma
vive dentro il pannello di chiamata, cioè si apre solo quando tocca a me, e sparisce appena ho
scelto. Nei venti minuti in cui tocca agli altri — che sono la stragrande maggioranza della serata —
chi vuole sapere quanti difensori di fascia alta restano non ha nessun posto dove guardarlo.

Questa macro apre quel posto: **una tab accanto all'asta**, con la lista di chi è ancora libero,
raggruppata per fascia, con i propri obiettivi marcati, che si aggiorna da sé a ogni lotto chiuso.

E aggiunge la cosa che quella lista richiede per essere *mia*: **un import personale**. Il foglio
che l'applicazione ha a sistema è di una persona sola; qui ognuno carica il proprio, con le proprie
fasce e la propria lista della spesa, e vede la propria tabella.

Il tema, in una riga: *mentre tocca agli altri, sapere chi resta e cosa volevo comprare non deve
costare l'apertura di un pannello che non si può aprire.*

---

## Richieste che ci confluiscono

Tolta da `docs/REQUESTS.md` il **2026-08-28**. È una richiesta sola, lunga, e vale la pena tenerne i
punti nelle parole dell'owner perché sono già decisioni:

- **«Dentro ad asta live voglio che la pagina sotto la live diventi un sistema a tab.»** Tab
  **Asta**: «qui mostro l'attuale contenuto della pagina. È la tab di default al caricamento, dove
  l'utente passa la maggior parte del tempo. Stesse funzionalità invariate».
- **Tab Listone, solo Pro**: «la tab resta visibile, ma non cliccabile. Esce un tooltip con l'info
  che la tab è solo per utenti Pro».
- **Sopra la tabella**: ricerca «per giocatore o nome squadra»; filtro **Ruoli** «in OR, quindi posso
  decidere di filtrare per più ruoli. Di default vedo il ruolo aperto in quel momento nell'asta»;
  filtro **Obiettivi** «posso vedere solo i giocatori che ho messo come obiettivo»; bottone
  **«importa obiettivi»** che apre un modale con un caricamento `.xls`.
- **«Questa tabella deve essere sincronizzata in tempo reale con ogni lotto. Qui devo vedere solo i
  giocatori che sono rimasti disponibili.»**
- **Le colonne**: Fascia, Obiettivo («usa un'icona per definirlo, colorala di verde se è un
  obiettivo»), Nome giocatore, PMA, FMV Exp., Gol, Assist, Note («qui puoi inserire le note associate
  ad ogni singolo giocatore che mostriamo già in altre parti dell'app agli utenti Pro. Puoi inserire
  gli stessi badge uno in fila all'altro»).
- **Il raggruppamento**: «la tabella è raggruppata di default per Fascia». E, in grassetto:
  «**IMPORTANTE**: Dove trovo l'ordine delle fasce? Quando importi il file, i giocatori sono ordinati
  per fascia: dalla più alta alla più bassa. Quello è l'ordine delle fasce.»
- **Il file**: deve contenere `Obiett.` («"SI", se lo è»), `Fascia` («campo libero»), `Nome`, `PMA`,
  `FMV Exp.`, `Titolarità`, `Affidabilità`, `Integrità`, `Gol`, `Assist`. «Questo file deve trovare
  poi corrispondenze con il listone generale che viene caricato.» E, in grassetto: «**IMPORTANTE**:
  Questa importazione è singola per ogni utente, quindi gli obiettivi devono essere un dato associato
  al singolo utente.»
- **Il processo**: «vorrei che facessimo le specifiche, poi una fase di progettazione UI per la nuova
  sezione Listone, poi dopo la mia approvazione partire con lo sviluppo. Se la fase di progettazione
  UI cambia qualche specs, ti devi rendere conto del cambiamento e aggiornare la specifica della
  macro.» — Questo è **vincolante sull'ordine dei task**, e sta in M21-02.

`fixtures/obiettivi.html` è arrivato insieme alla richiesta come riferimento visivo: è una pagina
salvata da fantalab.it, «è un esempio di come potresti fare la visualizzazione, non va preso alla
lettera come stile. Utilizziamo sempre gli stessi componenti della nostra Web app.»

---

## Cosa dicono i file, misurato

Quattro cose lette nel codice e nei fixture **prima** di progettare, e tutte e quattro cambiano il
disegno.

**1. Il file «obiettivi» è il foglio di Carmy.** `fixtures/carmy.xlsx` ha quattro fogli `P`, `D`,
`C`, `A` e 32 colonne, e ci sono dentro **tutte** quelle che la richiesta elenca: `Obiett.`,
`Fascia`, `Nome`, `PMA`, `FMV Exp.`, `Titolarità`, `Affidabilità`, `Integrità`, `Gol`, `Assist`.
Non serve un parser nuovo: serve che `parseCarmy` smetta di buttare due cose (§5).

**2. `Gol` e `Assist` sono già nella fonte pubblica giornaliera.** In
`fixtures/fantalab-listone.json` ogni giocatore ha `gol_fatti` e `assist`, accanto alle statistiche
che già importiamo. ⚠ **Ma il parser oggi non li estrae**: `parseFantalabListone` costruisce una
riga con undici campi e quei due non ci sono, quindi non è vero che «li abbiamo e non li mostriamo»
— vanno aggiunti in due punti, il tipo di riga e l'`upsert`. Prenderli da lì invece che dal file personale vuol dire
che li ha **chiunque sia Pro**, anche senza aver mai importato niente, e che sono **aggiornati ogni
giorno** invece che vecchi quanto il file (§3).

**3. L'ordine delle fasce dal file funziona, ed è stato verificato.** Sui quattro fogli del file del
2026-08-12 la fascia **non si ripete mai**: `P` fa `Top → Semi-Top → Terza → Quarta → Scomm. →
Outsider → Non Impostata`, `D` e `C` fanno lo stesso con `Titolare "Scarso"` in mezzo, `A` come `P`.
Cioè «l'ordine in cui compaiono» è ben definito, e non è un'ipotesi: è una misura.

**4. ⚠ Ma `CARMY_FASCE` esiste già, cablato in `lib/domain.ts`**, ed è la trappola numero uno di
questa macro. È l'elenco fisso delle sette fasce, con `carmyFasciaRank` sopra, e lo usano **i filtri
del pannello di chiamata** (M10B §6). Se la fascia diventa campo libero per-utente esistono due
regole per lo stesso concetto, e §4 dice quale vale dove — perché la risposta non è unificarle.

---

## Le sette decisioni dell'owner, prese il 2026-08-28

Tutte prima di scrivere una riga, e ognuna chiude una domanda che il codice non poteva risolvere da
sé.

1. **La tabella è «personale se c'è, globale altrimenti», riga per riga.** Chi ha importato vede i
   propri valori; chi non ha importato vede comunque una tabella piena, con i valori del foglio
   globale, e senza obiettivi.
2. **L'import è per utente e globale**, non per asta: importo una volta e vale in ogni asta a cui
   partecipo. Ri-importare sostituisce.
3. **`Gol` e `Assist` vengono dalla fonte pubblica giornaliera**, non dal file personale.
4. **La tab è aperta a `canSeeInsights`** — Pro **oppure** amministratore — cioè la stessa regola di
   ogni altro dato riservato dell'applicazione.
5. **Un vocabolario di fasce solo.** Se ho importato, le fasce sono le mie, nell'ordine del mio file;
   i giocatori che nel mio file non ci sono finiscono in un gruppo **«Senza fascia»** in fondo,
   tenendo però PMA, FMV Exp. e note globali. Se non ho importato, valgono le fasce globali.
6. **I pannelli si aprono sopra la tab, e il countdown va nella barra.** Chi sta leggendo il listone
   quando tocca a lui non viene spostato di tab; ma la barra delle tab porta il tempo che resta e il
   pulsante che riapre.
7. **L'obiettivo è di sola lettura**: si mette e si toglie dal file, non con un tocco in tabella.

E tre che prendo io, dichiarate qui perché siano contestabili:

8. **Due regole per l'ordine delle fasce** (§4): l'ordine del file per il listone personale,
   `CARMY_FASCE` per quello globale.
9. **Il filtro dei ruoli segue il ruolo in gioco finché non lo tocco**; appena lo tocco è mio e non
   si muove più, fino al ricarico della pagina.
10. **`PMA` in percentuale con i crediti accanto**, come già fa la lista di chiamata. ⚠ **Corretta
    dalla fase UI**: i crediti stanno solo da `sm` in su, sul telefono non c'è la larghezza (§4).

**Quattro dalla fase di progettazione UI, lo stesso giorno**, prese guardando il banco di prova e non
descrivendolo — sono quelle che hanno cambiato la spec, ed è il motivo per cui quella fase esisteva:

11. **Dentro il gruppo si ordina per `PMA DESC`**, non per `fvm`. Cambia §4, e con esso il test di
    `listoneRows`.
12. **La colonna del ruolo si aggiunge**, e c'è sempre. Non era nell'elenco della richiesta.
13. **L'icona dell'obiettivo è su ogni riga**, grigia o verde.
14. **Sul telefono le righe sono un elenco su tre linee**, non una tabella che scorre di lato.

---

# Spec

## §1 — Le due tab, e perché non sono due rotte

Dentro `/auctions/[id]/play` il **corpo** della pagina diventa due tab: **Asta**, che è il contenuto
di oggi immutato, e **Listone**. `Asta` è attiva al caricamento, sempre.

⚠ **Non sono due rotte, e la ragione è tecnica prima che estetica.** Una navigazione smonterebbe
`Portal`, quindi `useAuctionStream`, quindi la connessione SSE: ogni tocco su una tab chiuderebbe lo
stream e ne aprirebbe un altro, con il registro SSE del server che vede una disconnessione e una
riconnessione per ogni cambio di tab, nel mezzo di un'asta. Le tab sono **stato locale del client**,
come `dismissedLotId` e `dismissedTurnKey`.

⚠ **E questo è il terzo pezzo di stato locale del portale**, dopo i due `dismissed*` che M17 aveva
dichiarato «il secondo e ultimo». La regola 7 regge lo stesso, e va detto perché: quei due sono
«questa cosa che si apre da sé l'ho chiusa io», questo è «quale metà della pagina sto guardando».
Nessuno dei tre può rendere una schermata **irraggiungibile** a chi si collega dopo — chi apre la
pagina adesso trova `Asta`, che è tutto ciò che c'era prima di questa macro. Se un giorno la tab
attiva finisse nell'URL o in `localStorage`, quella proprietà andrebbe riverificata: una tab
ricordata è una schermata che dipende da cosa hai fatto prima.

Sotto la barra delle tab il layout di M17 resta **identico**: tre colonne da `lg`, colonna unica
sotto, `max-w-6xl`, l'ordine nel DOM che è quello del telefono. Questa macro non ridisegna la tab
Asta.

`Tabs` e `Tooltip` vengono da **`radix-ui`**, che è già in dipendenza ed è già il modo in cui
`bid-modal.tsx` e `pick-panel.tsx` prendono `Dialog`. **Nessun pacchetto nuovo.**

## §2 — Lo schema: una tabella, non due

```
user_listone
  user_id      uuid    → users.id, ON DELETE CASCADE
  ext_id       integer                              PRIMARY KEY (user_id, ext_id)
  obiettivo    boolean not null default false
  fascia       text
  fascia_rank  integer
  pma          real
  fmv_exp      real
  prezzo       integer
  titolarita   integer
  affidabilita integer
  integrita    integer
  tags         jsonb not null default []
  commento     text
  uploaded_at  timestamptz not null
```

**Le colonne sono quelle di `carmy_players`** più `obiettivo` e `fascia_rank`, meno `source_name` e
`source_team`. È deliberato: le due tabelle contengono la stessa cosa — il giudizio di una persona
su un calciatore — e differiscono solo per chi è quella persona e chi lo può vedere.

⚠ **`ON DELETE CASCADE` su `user_id`**: cancellare un utente porta via il suo listone, che è l'unico
comportamento sensato per un dato che non ha senso senza il suo proprietario. Non è una violazione
della regola 5: qui non ci sono assegnazioni né ledger, è l'opinione di una persona su dei
calciatori, ed è la stessa ragione per cui `uploadCarmy` può fare `DELETE` di tutto il foglio.

⚠ **Una tabella e non due, e la scelta va capita.** Servivano tre cose oltre alle righe: quando ho
importato, quante righe, e **l'ordine delle fasce**. La tentazione è una seconda tabella
`user_listone_imports` con un `fasce jsonb`. Non serve: `uploaded_at` è uguale su tutte le righe di
un caricamento — è **esattamente** come `carmy_players` già lavora, con la sua nota nello schema — e
l'ordine delle fasce vive riga per riga in `fascia_rank`. L'unica cosa che la seconda tabella
darebbe in più è **la fascia le cui righe sono state tutte comprate**, e quella intestazione non
deve comparire comunque: la tabella mostra solo chi è rimasto (§4). Regola 8.

⚠ **Nessun vincolo di chiave esterna verso `listone_players`**, e non è una dimenticanza: è la
stessa asimmetria di `carmy_players` e `player_insights`, che sono tre tabelle globali indipendenti
lette in `LEFT JOIN`. Un `ext_id` che il listone non ha più dopo una sostituzione del listone
globale semplicemente non aggancia, e non compare. Una `FOREIGN KEY` farebbe fallire il prossimo
caricamento del listone di sistema per colpa del file personale di qualcuno.

Su `player_insights`, due colonne nuove:

```
  gol_fatti  integer      -- nullable
  assist     integer      -- nullable
```

⚠ **Nullable, e questo è ciò che evita il backfill.** Le righe già a sistema nascono con `null` e si
riempiono al primo refresh giornaliero di M11, che gira da sé entro un quarto d'ora. La UI tratta
`null` come «non ancora arrivato» e scrive un trattino. Se fossero `not null` servirebbe un backfill
a mano, cioè il passo che «nulla ti ricorda» di `CLAUDE.md`.

## §3 — Gol e Assist, dalla fonte che li aggiorna

Due aggiunte e nient'altro: `gol_fatti` e `assist` entrano nella riga che `parseFantalabListone`
produce — la risposta della fonte li contiene già, è il parser che oggi si ferma prima — e
`refreshInsights` li scrive nell'`upsert` per colonna che già fa.

⚠ **«Due aggiunte» è vero per le scritture, non per il diff** (misurato a M21-04). I punti in cui i
due numeri vanno elencati **a mano, colonna per colonna**, sono quattro: il parser, l'`upsert`, il
tipo `PlayerInsights` di `lib/domain.ts` — dichiarato a mano perché lo legge un client component — e
le due proiezioni che ricopiano le colonne una per una, `listPickPool` e `centroDatiRows`. Nessuna di
queste fallisce da sé se la si dimentica: la colonna resta vuota, o non arriva al browser, e non lo
dice nessuno.

⚠ **Si aggiungono all'`upsert` della fonte A e a nessun'altra scrittura.** La fonte B
(`refreshSetPieces`) tocca solo i due rank, e mescolare le due scritture è il modo in cui una `GET`
cancella i dati dell'altra — la ragione per cui M10B ha una tabella sua invece di tre colonne qui.

⚠ **`Gol` e `Assist` del foglio personale restano buttati**, come le altre undici statistiche che
`parseCarmy` già scarta con la sua nota: «Carmy non porta nessuna statistica nuova, porta un
giudizio». Importarle vorrebbe dire avere due copie degli stessi numeri e una domanda in più a cui
rispondere ogni volta — quale delle due è quella buona. Il file personale porta **il giudizio e la
lista della spesa**; i numeri li porta la fonte.

⚠ **A quale stagione appartengono** è la domanda che `player_insights.stats_season` esiste per
risolvere, ed è già risolta: la UI mostra solo i `current`, come fa M8 §5 per tutto il resto. Due
colonne nuove non aprono un caso nuovo, ma **vanno messe dalla parte giusta di quello vecchio**.

## §4 — La tabella: cosa mostra, come raggruppa, cosa esclude

**Le righe.** Il pool arriva già oggi come prop, letto una volta dal server e immutabile
dall'import. Chi è già stato preso si deduce da `snapshot.members[].roster`, e la funzione che lo fa
— `takenPlayerIds` — è già scritta ed esportata. Nasce accanto ad `availablePlayers` una funzione
pura sorella in `lib/realtime/portal.ts`:

```ts
listoneRows(pool, snapshot, { roles, query, soloObiettivi })
```

Differisce dalla vicina in tre punti, e sono tutti e tre la richiesta: **più ruoli in OR** invece di
uno solo, **il filtro obiettivi**, e **nessun tetto di quaranta righe**. I gruppi vanno nell'ordine
delle fasce; dentro il gruppo si ordina per **`PMA DESC`**, dal più caro.

⚠ **`PMA` e non `fvm`, ed è una divergenza voluta dalla lista di chiamata** (decisione della fase UI,
2026-08-28, guardando il banco di prova). La spec di questa macro diceva `fvm DESC` per coerenza con
la vicina, e guardandola non regge: `fvm` **non è in tabella** — l'owner l'ha fatto togliere a M17,
«un valore FMV che non capisco cosa sia» — quindi scorrendo, la lista sembra ordinata per niente. È
lo stesso difetto che M17 aveva dovuto compensare nel pannello di chiamata con la riga
dell'auto-pick.

E qui quella compensazione **non serve, perché non c'è niente da compensare**: nel pannello di
chiamata l'ordine *è* una promessa — «il primo è quello che il timer comprerebbe al posto tuo» — e
per questo non si tocca. Nel Listone non si sceglie niente, si guarda chi resta: nessun auto-pick da
raccontare, nessuna promessa da mantenere, e l'unico criterio giusto è **quello che chi legge può
verificare sulla riga**. ⚠ La conseguenza da tenere in mente: **le due liste della stessa serata
sono ordinate diversamente**, ed è deliberato. `availablePlayers` non si tocca.

⚠ **Nessuna query per lotto, e nessun evento da ascoltare.** «Sincronizzata in tempo reale con ogni
lotto» è già risolto dal fatto che la tabella è funzione dello snapshot: quando un lotto chiude, la
rosa del vincitore cambia, lo snapshot arriva, la riga sparisce. È I10 senza scrivere una riga per
ottenerlo.

**Il giocatore in asta adesso resta in tabella, con un badge «in asta».** Non è ancora di nessuno, e
farlo sparire prima dell'assegnazione sarebbe una bugia — per di più una bugia che si corregge da
sé, perché se il lotto va deserto quel giocatore torna disponibile.

**Le colonne**, nell'ordine della richiesta: Fascia (nell'intestazione del gruppo, non ripetuta su
ogni riga), Obiettivo, **Ruolo**, Nome (con la squadra), PMA, FMV Exp., Gol, Assist, Note.

⚠ **Il Ruolo non è nell'elenco della richiesta, ed è stato aggiunto guardando la tabella** (fase UI,
2026-08-28): coi ruoli in OR — che la richiesta chiede — un gruppo «Top» può contenere portieri e
difensori insieme, e senza quella lettera non si legge di chi si sta parlando. È una lettera in
grigio a sinistra del nome, e c'è **sempre**, non solo quando i ruoli filtrati sono più d'uno: una
tabella che cambia forma sotto le dita costa più di una colonna da dieci pixel.

**L'icona dell'obiettivo c'è su ogni riga**, grigia quando non è un obiettivo e verde quando lo è
(decisione dell'owner, fase UI). L'alternativa guardata era mostrarla solo sugli obiettivi, con uno
spazio vuoto altrove; è stata scartata.

**Il `PMA` porta i crediti accanto** — `17.7% (89)` — come già fa la lista di chiamata, e con la
stessa `pmaCrediti`: una percentuale non si può offrire, e sotto un countdown nessuno la converte a
mente. ⚠ **Sul telefono resta solo la percentuale**: la larghezza non c'è, ed è il primo posto in cui
questa macro paga il fatto che il portale è mobile-first.

Le Note sono i **tag del foglio**, resi con `CarmyTags` che esiste già ed è già la forma con cui si
vedono altrove. Nessun componente nuovo: se i badge del listone e quelli del pannello di chiamata
divergessero, sarebbero due cose diverse che si chiamano uguale.

**Il raggruppamento e le due regole per l'ordine.** Questo è il punto delicato di §4, e va scritto
per esteso:

- Se **ho importato**, il vocabolario è il mio: le fasce sono quelle del mio file, nell'ordine del
  mio file (`fascia_rank`), e chi nel mio file non c'è finisce in **«Senza fascia»**, in fondo — pur
  tenendo PMA, FMV Exp. e note del foglio globale, se ce le ha.
- Se **non ho importato**, il vocabolario è quello globale, nell'ordine di `CARMY_FASCE`.

⚠ **Due regole per lo stesso concetto, ed è una scelta.** `CARMY_FASCE` regge oggi i filtri del
pannello di chiamata, e derivare anche quell'ordine dal file vorrebbe dire mettere le mani su un
pezzo che funziona per un guadagno che nessuno vedrebbe: le fasce del foglio globale sono le sette
di sempre, nell'ordine di sempre, verificato su quattro file. Se un giorno il foglio globale
cominciasse a usare fasce libere, si aggiungerà un `fascia_rank` anche a `carmy_players` e le due
regole diventeranno una. Non prima (regola 8).

⚠ **E il vocabolario non si mescola mai**, che è la decisione 5 letta al contrario: non esiste una
tabella con dentro sia `Top` (mia) sia `Top` (globale) come due gruppi diversi, e non esiste un
giocatore che compare sotto una fascia che io non ho scritto. Il gruppo «Senza fascia» è il prezzo
di questa promessa, ed è il prezzo giusto: dice la verità — *su costui non ho un giudizio mio*.

**Sul telefono la tabella diventa un elenco**, non una tabella che scorre di lato (decisione della
fase UI, viste entrambe): icona e ruolo e nome e squadra e PMA sulla prima riga, `exp / gol / ass`
sulla seconda, le note sulla terza; le fasce restano come intestazioni di gruppo. La strada scartata
è quella del Centro dati — `overflow-x-auto` con un `min-w` — che è onesta ma chiede di scorrere in
orizzontale la cosa principale di una tab, su un telefono, durante un'asta. Costa altezza: **circa
57px a riga**, misurati.

⚠ **Il nome tronca senza `min-w-0` sulla catena dei flex, e questo è misurato**: a 375px il caso
peggiore vero delle 495 righe del listone — «Milinkovic-Savic V. · Napoli» — sta dentro,
`scrollWidth` resta 375 e nessun PMA esce. Se un anno un nome più lungo entrasse nel listone, il
rimedio è `min-w-0` **su ogni anello**, non solo sul padre.

**Nessuna paginazione, nessun ordinamento per colonna.** Cinquecento righe girano già nel browser da
M8, e il Centro dati fa lo stesso con la stessa misura (~250 KB) senza paginare. L'ordinamento per
colonna non è nella richiesta e romperebbe il raggruppamento per fascia, che è il modo in cui questa
tabella si legge.

## §5 — Come i dati arrivano al browser

`listPickPool` prende **`userId`** oltre a `withInsights`, e risolve **lato server** la regola
«personale se c'è, globale altrimenti». Il browser riceve una forma sola e non ricalcola nessuna
regola. `PoolPlayer` **cresce di tre chiavi**, e la quarta è quella che già c'è e cambia
significato:

```ts
carmy?: CarmyJudgement   // NON è nuova: adesso è il giudizio RISOLTO
mio?: true               // questa riga viene dal mio file
obiettivo?: true         // è un mio obiettivo
fasciaGruppo?: string    // la fascia con cui raggruppare, già decisa (§4)
fasciaRank?: number      // dove sta quel gruppo nell'ordine — aggiunta a M21-07
```

⚠ **La quarta chiave è stata aggiunta implementando, e la ragione è questa stessa
sezione.** L'ordine dei gruppi dipende da **quale vocabolario è in gioco** — il mio
`fascia_rank` se ho importato, `CARMY_FASCE` altrimenti — e senza il numero il client
dovrebbe sapere in quale dei due mondi si trova per ordinare le intestazioni: cioè
ricalcolare la decisione che il server ha già preso, contro la promessa di questo
paragrafo. Non è una decisione nuova, è la stessa applicata fino in fondo.

⚠ **E `CarmyJudgement` perde due chiavi obbligatorie**: `sourceName` e `sourceTeam`
diventano opzionali, perché il listone personale non le conserva — la sua tabella ha le
colonne di `carmy_players` meno quelle due. Un giudizio mio arriva **senza**, invece che
col nome del listone copiato dentro: l'assenza è la verità, un valore inventato sarebbe
la spiegazione falsa di un aggancio avvenuto in un altro modo. Nessuna schermata le
legge: servono a capire un import, non a disegnare una riga.

⚠ **`?` e non `| null`, senza eccezioni**, che è la regola di M8 §6 e M10B §7 letta per la terza
volta: la chiave è **assente** per chi non ha il permesso, non `null` da nascondere. Questo tipo
viaggia nel payload RSC di un client component — tutto ciò che sta qui **è nel browser di chi apre
la pagina**, leggibile in DevTools in tre click. La decisione la prende la query, una volta sola, e
da lì in poi l'assenza si propaga da sé.

⚠ **`carmy` diventa il giudizio *risolto*, e questo cambia cosa vede il pannello di chiamata.** Chi
ha importato vedrà nella lista di chiamata i **propri** valori invece di quelli globali. È la
conseguenza voluta della decisione 1 — «il mio file vince sul globale» non ha senso se vale solo in
una delle due liste — ma va detta qui perché non venga scoperta guardando una schermata che nessuno
aveva pensato di cambiare. `mio` esiste anche per poterlo **mostrare** dove serve.

⚠ **`fasciaGruppo` è separata da `carmy.fascia`, e non è una ridondanza.** `carmy.fascia` è un
dato — la fascia scritta nella riga che ha vinto la risoluzione. `fasciaGruppo` è una **decisione** —
sotto quale intestazione va questa riga, applicata la regola del vocabolario unico. Tenerle
distinte è ciò che permette a un giocatore di stare in «Senza fascia» mostrando comunque i valori
globali che ha.

⚠ **Niente di tutto questo entra in `serializeSnapshot`** (regola 3): viaggia su `listPickPool`, che
è la lettura del listone e non lo stato del gioco. La regola 3 protegge gli importi delle buste
durante `LOT_OPEN`, e qui non c'è nessuna offerta da sanificare — è la stessa frase che M10B ha già
scritto, e vale identica.

## §6 — L'import personale

Un `Dialog` dentro la tab, aperto dal bottone **«Importa obiettivi»**: un `input type=file`
`accept=".xlsx"` e una Server Action per-utente. `fixtures/carmy.xlsx` pesa 74 KB, ben sotto il
limite del corpo delle Server Action, e il caricamento admin gemello fa già esattamente questo.

**Il parser è `parseCarmy` così com'è**, più due cose che oggi butta:

1. **`Obiett.`** — vero se la cella dice sì. ⚠ Tollerante alla scrittura: nel file di riferimento è
   `Sí` con l'accento acuto, la richiesta scrive `SI`. Si confronta **normalizzato** — senza
   accenti, senza maiuscole, senza spazi — perché la differenza fra `Sí` e `SI` non è
   un'informazione, è una tastiera.
2. **L'indice della fascia**, cioè l'ordine in cui le fasce compaiono nel file. Si calcola **in un
   posto solo**, leggendo i quattro fogli in ordine `P, D, C, A`.

   ⚠ **Correzione misurata, M21-05 (2026-08-28): «assegnare a ogni fascia nuova il numero
   successivo» è sbagliato, e sbaglia proprio sul file di riferimento.** Questa spec diceva che la
   prima occorrenza in ordine di foglio dava il risultato giusto. Non lo dà: `P` fa
   `… Scomm. → Outsider` e `Titolare "Scarso"` compare **solo** in `D` e `C`, dove sta *fra* le due —
   quindi accodandolo prenderebbe il numero **dopo** `Outsider`, cioè un ordine che due fogli su
   quattro smentiscono, dentro la funzione che esiste apposta per rispettare il file.

   Si fa invece un **ordinamento topologico**: ogni foglio è una catena e dichiara «questa fascia
   precede quella», si estraggono le fasce senza predecessori, e a parità vale l'ordine di prima
   apparizione. Un ciclo — due fogli che si contraddicono — **non fa fallire il caricamento**: si
   rompe il pareggio e si tira avanti, perché rifiutare un file intero per due gruppi in ordine
   discorde punirebbe chi l'ha compilato per una cosa che a schermo è dieci righe più in su.

   Il test è il migliore che questa macro abbia: sul file vero l'ordine ricavato è **esattamente
   `CARMY_FASCE`**, che in M10B era stato scritto **a mano** leggendo lo stesso foglio — e la cui nota
   dice che l'unico punto da indovinare era proprio fra `Titolare "Scarso"` e `Outsider`. Due
   derivazioni indipendenti della stessa verità.

⚠ **Il parser resta puro e resta condiviso.** `parseCarmy` è la stessa funzione per i due percorsi:
`uploadCarmy` ignora i due campi nuovi, il caricamento personale li usa. Due parser per lo stesso
file sarebbero due modi di leggere `PMA` che divergono al primo formato strano.

**L'aggancio** è quello di `lib/engine/carmy.ts`, riusato e non reinterpretato: `normalizeCarmyName`
contro `listone_players`, la sigla di tre lettere come **controllo** che segnala un trasferimento
senza fermare il caricamento, e la **soglia del 90%** sotto la quale non si scrive niente. Senza
listone a sistema il caricamento si rifiuta dicendo cosa fare, come già fa il gemello admin.

⚠ **Sostituisce le mie righe, non fonde**, e per la ragione di sempre: un obiettivo tolto deve poter
sparire. `DELETE` dove `user_id = me`, poi gli `INSERT` a blocchi. **Il file non si conserva** (P6).

Il riepilogo dice le stesse tre cose del pannello admin — righe scritte su righe lette, i nomi non
agganciati per nome e non per numero, le squadre discordanti — perché sono le tre cose che spiegano
un import andato storto, e chi carica il proprio file ha lo stesso diritto di capire dell'admin.

⚠ **La Server Action ricontrolla `canSeeInsights` da sé** e non si fida della tab spenta (regola 6).
La UI disabilita, il server rifiuta comunque.

## §7 — Il gate Pro

`canSeeInsights(user)` — Pro **oppure** amministratore — decide **la query**: chi non ce l'ha non
riceve né `carmy`, né `mio`, né `obiettivo`, né `fasciaGruppo`, esattamente come oggi non riceve gli
insight. Nel payload non c'è niente da nascondere perché non c'è niente.

La tab **resta visibile e spenta**, con un `Tooltip` che dice che è per gli utenti Pro. ⚠ È una
scelta di prodotto e non una protezione — vedere il nome di una tab non è vedere un dato — ed è
quello che la richiesta chiede: una tab che non c'è non si può desiderare.

⚠ **Il tooltip su un elemento disabilitato è un caso noto e va fatto bene**: un `<button disabled>`
non emette eventi di puntatore, quindi il trigger va su un elemento che li riceve. Radix lo
documenta; se in fase di UI si rivelasse fragile sul telefono — dove un tooltip senza hover non
esiste — la strada alternativa è **una riga di testo sotto le tab** invece di un tooltip, e si
decide guardandola.

## §8 — Il countdown nella barra delle tab

I due pannelli che si aprono da sé — `PickSheet` e `BidModal` — sono `Dialog`: stanno **fuori** dal
contenitore delle tab, in fondo a `Portal`, e continuano ad aprirsi identici mentre guardo il
Listone. La tab non si muove sotto le dita di chi sta leggendo un elenco.

⚠ **Ma questo apre un buco, ed è il motivo per cui questa sezione esiste.** M17 §4 ha costruito i
pannelli su una promessa precisa: chiuderne uno non nasconde niente, perché la card sotto tiene *il
tempo che resta* e *il pulsante che riapre*. Quella card sta nella tab **Asta**. Chi chiude il
pannello dal Listone si troverebbe davanti a una tabella, senza countdown e senza strada per
tornare: cioè esattamente il vicolo cieco che M17 aveva chiuso.

Quindi la barra delle tab è **sticky**, e quando c'è una scadenza in corso porta a destra tre cose:
l'etichetta della scena, il countdown, e il pulsante che riapre il pannello. È la stessa promessa,
spostata dove serve.

⚠ **Il countdown resta rendering** (regola 1). Si riusa `Countdown`, con lo stesso `offset` dello
stream e lo stesso `pausedAt`: non decide niente, disegna un numero che il server ha già deciso.

⚠ **La barra sticky è il secondo elemento incollato del portale sotto `lg`**, dopo l'intestazione di
`PortalHeader`. Vanno guardate insieme su un telefono vero: due strisce incollate una sotto l'altra
mangiano l'altezza che serve a offrire, che è la cosa che M17 stava togliendo. Se si accavallano, la
prima da rivedere è questa, non quella.

## §9 — Cosa non si fa

- **Nessuna icona cliccabile**: l'obiettivo viene solo dal file (decisione 7).
- **Nessun Listone in Regia e nessuno in TV**: la richiesta parla del portale del partecipante, e la
  vista TV è bianco su nero — un `.dark` in più, per una tabella che nessuno guarderebbe proiettata.
- **Nessuna paginazione, nessun ordinamento per colonna** (§4).
- **Nessun tocco a `serializeSnapshot`, a `machine.ts`, a `rules.ts`, all'auto-pick e a
  `players_autopick_idx`.** ⚠ Vale qui la stessa asimmetria che M10B §6 aveva fissato: il motore
  pesca dal pool intero e di fasce, obiettivi e filtri non sa niente — né deve saperne. Il listone
  personale è **una lente**, non una modifica del gioco.
- **Nessun `Obiett.` sul percorso globale** (§0).
- **Nessun `dark:`** nel codice nuovo.
- **Nessun pacchetto nuovo**: `Tabs` da `radix-ui`, l'icona da `lucide-react`. (⚠ `Tooltip` era
  previsto e **non serve più**: la tab spenta si spiega con una riga di testo accanto — vedi
  M21-10.)

---

## ⚠ Lo stato della macchina locale, per chi riprende

Scritto qui perché **non è deducibile dal codice** e la sessione in cui è successo non c'è più.

1. **In `asta` — il database di sviluppo — c'è una simulata lasciata `LIVE` il 2026-08-23**
   (`51f56216-199c-48a5-8551-70eab533f433`, «Prova»). Accendere `pnpm dev` la **rimette in moto** e le
   consuma i lotti.

   ⚠ **E non è solo `pnpm dev`: la fa avanzare anche `pnpm test`**, che è la scoperta della fine di
   M21 e vale più della nota originale. Lo `sweep` dello scheduler è **globale** — «tutte le aste
   `LIVE` con la deadline scaduta» — e `tests/db/scheduler.test.ts` lo chiama per davvero, contro
   `asta`. Quindi **ogni giro di test la spinge avanti di una fase**: misurata a fine giornata a
   `LIVE/LOT_OPEN` con 36 giocatori assegnati e `state_version` 339, con la deadline ferma
   all'istante dell'ultimo `pnpm test`. Non è un guasto — è lo sweep che fa il suo mestiere su
   un'asta che nessuno ha chiuso — ma spiega perché quell'asta si muove anche quando l'app è spenta,
   e toglie di mezzo la spiegazione sbagliata («qualcuno ha acceso il dev server»).

   Chi riprende: o la mette in **pausa** dal pannello — che è l'unica cosa che la ferma davvero,
   perché lo sweep non tocca le `PAUSED` — o accetta che si consumi. Per lavorare senza pensarci,
   un database usa-e-getta (`asta_banco`, la ricetta è qui sotto).
2. **Il banco di prova non esiste più**, cancellato a M21-13 com'era previsto: era `app/banco/` —
   pubblico, senza `requireUser()`, e `next build` lo compilava — con accanto `scripts/banco/`. Si
   rilegge con `git show 45d1eb0:app/banco/pezzi.tsx` e fratelli, insieme allo script che riempiva il
   database usa-e-getta (`scripts/banco/riempi.ts`) e a quello che entrava col login di sviluppo e
   fotografava da CDP (`scripts/banco/entra.mjs`).
3. **Gli screenshot si prendono da CDP**, non col flag `--screenshot`: `--headless --screenshot
   --window-size=375` impagina a ~800px e poi ritaglia, cioè mostra una pagina che non esiste. E
   ⚠ **`element.click()` non attiva una linguetta Radix**, che risponde a `mousedown`: uno screenshot
   in cui la tab non cambia non vuol dire che la tab sia rotta. Tutte e due sono costate tempo.
4. **La ricetta del database usa-e-getta**, che è la sola cosa del banco che valeva la pena tenere
   scritta:

   ```bash
   docker exec fantasta-db psql -U postgres -c "CREATE DATABASE asta_banco;"
   DATABASE_URL=postgres://postgres:dev@localhost:5433/asta_banco pnpm exec drizzle-kit push --force
   DATABASE_URL=postgres://postgres:dev@localhost:5433/asta_banco pnpm db:seed --auction-status=mid
   env DATABASE_URL=postgres://postgres:dev@localhost:5433/asta_banco pnpm dev
   ```

## Task

> Da rifinire all'apertura della macro. Sono la traduzione della spec, non un impegno preso nella
> sessione in cui è stata scritta.

- [x] **M21-01** — Aprire `feature/21-listone-in-asta` da `dev`. Rileggere **questo file**, il blocco
      di `parseCarmy.ts` su `Obiett.` (§0 è scritto contro quello), M10B §6 sull'asimmetria fra la
      lista e l'auto-pick, e le regole di produzione di `CLAUDE.md` — questa macro **tocca lo
      schema**. `pnpm test` verde come baseline, col numero annotato qui.
      `fixtures/obiettivi.html` è già committato insieme a questa spec — era arrivato untracked
      con la richiesta, e una macro che non si può rigenerare comincia da un file dimenticato
      → **Baseline: 917 test in 53 file**, verde al primo giro. ⚠ **Trovata un'asta simulata lasciata
      `LIVE` il 23 agosto nel database locale**: accendere `pnpm dev` l'ha rimessa in moto e ha
      consumato una manciata di lotti prima che me ne accorgessi. Rimedio senza toccarla: il dev
      server gira su un database **usa-e-getta** (`asta_banco`), e la simulata è congelata a
      `LIVE/WAITING_PICK`. È la stessa ricetta di M20, e da qui in avanti vale come regola per
      qualunque lavoro di UI che non abbia bisogno dei dati veri
- [x] **M21-02** — **La progettazione UI della tab Listone, prima di qualunque codice di
      produzione** (è la richiesta esplicita dell'owner). Barra delle tab e sua versione sticky col
      countdown, tooltip della tab spenta, intestazioni di gruppo, la riga della tabella sul
      telefono a 375px e su desktop, il modale di import, lo stato vuoto di chi non ha importato.
      **Guardarla**, non descriverla. ⚠ Se la progettazione cambia una scelta di questa spec,
      **la spec si aggiorna nella stessa sessione** e il cambiamento si dichiara: è la parte della
      richiesta che vale quanto le altre
      → Fatta in `app/banco/`, con i componenti veri e i dati veri dei fixture. **Ha cambiato la spec
      in quattro punti** (decisioni 11–14) più la correzione della 10: l'ordinamento dentro il gruppo,
      la colonna del ruolo, l'icona su ogni riga, l'elenco invece della tabella sul telefono.
      ⚠ **Una lezione di metodo che vale oltre questa macro**: Chrome
      `--headless --screenshot --window-size=375` **impagina a ~800px e poi ritaglia**, quindi mostra
      una pagina che non esiste — il `PMA` sembrava fuori schermo e non lo era, e ci ho creduto
      abbastanza da «correggere» un difetto inesistente. Gli screenshot si prendono da **CDP**
      (`Emulation.setDeviceMetricsOverride` + `Page.captureScreenshot`), che è lo stesso contesto in
      cui si misura il DOM: uno screenshot che non concorda con la misura non è una prova
- [x] **M21-03** — Lo schema (§2): `user_listone` e le due colonne su `player_insights`. `pnpm
      db:push` in locale, e **il primo test in `tests/db/` che tocca la tabella nuova** — è il modo
      in cui ci si accorge di una colonna dimenticata prima del server
      → Fatto come da §2, senza scostamenti: quattordici colonne, `PRIMARY KEY (user_id, ext_id)`,
      `ON DELETE CASCADE`, nessuna FK verso `listone_players`; `gol_fatti` e `assist` **nullable** su
      `player_insights`. Il push in locale ha prodotto le tre istruzioni attese e nessuna domanda.
      Otto test in `tests/db/user-listone.test.ts` → **925 in 54 file**, verde. ⚠ **Il file può
      stare da solo**, al contrario di M10B: `user_listone` non è una tabella globale — ogni riga
      appartiene a un utente usa-e-getta, quindi non c'è nessuna tabella condivisa da «possedere» e
      la cicatrice dei worker paralleli non si applica. ⚠ **Una nota per chi scriverà altri test sui
      vincoli**: il messaggio d'errore di Drizzle è solo `Failed query: …` con dentro la query, e il
      vincolo violato sta nella **causa** (`cause.code`, `cause.constraint`). Un
      `rejects.toThrow(/duplicate key/)` non passa, e — peggio — se passasse accetterebbe qualunque
      fallimento di quella `INSERT`
- [x] **M21-04** — Gol e Assist dalla fonte A (§3): `parseFantalabListone`, l'`upsert` di
      `refreshInsights`, e un test sul fixture vero che verifica che i due numeri arrivino e che la
      fonte B **non** li tocchi
      → I due campi nel parser (contatori, `0` e non `null`: qui lo zero *è* un'informazione) e
      nell'`upsert` della fonte A. ⚠ **Erano quattro i punti da toccare, non due**, e vale la pena
      saperlo prima di aggiungere la prossima colonna: `PlayerInsights` in `lib/domain.ts` — che è
      dichiarato a mano perché lo legge un client component — e le **due** proiezioni che elencano le
      colonne una per una, `listPickPool` e `centroDatiRows`. Una colonna aggiunta allo schema e
      dimenticata in una di quelle resta invisibile senza nessun errore. Misurato sul fixture:
      **933 gol e 653 assist** su 497 righe, 209 giocatori a secco. Quattro test nuovi → **929 in 54
      file**. Due meritano il nome per esteso: quello che fa **due** refresh di fila (una colonna
      fuori dall'`upsert` si riempirebbe al primo `INSERT` e non si aggiornerebbe mai più) e quello
      che **svuota le due colonne a mano su una tabella piena** e guarda il refresh successivo
      riempirle — è la verifica 21, cioè la prova in locale che il rilascio non vuole nessun backfill
- [x] **M21-05** — Il parser (§6): `Obiett.` normalizzato e `fascia_rank` col merge dei quattro
      fogli, con i test sul fixture vero — incluso quello su `Titolare "Scarso"`, che in `P` e `A`
      non c'è. ⚠ Verificare che `uploadCarmy` continui a comportarsi **identico**: i suoi test
      esistenti devono passare senza modifiche
      → **La spec sbagliava, e §6.2 è stato corretto**: la prima occorrenza in ordine di foglio
      metteva `Titolare "Scarso"` **dopo** `Outsider`, contro quello che dicono `D` e `C`. Ora è un
      ordinamento topologico (`mergeFasce`, esportata per il suo test), e sul file vero produce
      **esattamente `CARMY_FASCE`** — che M10B aveva scritto a mano leggendo lo stesso foglio.
      `Obiett.` si confronta normalizzato: nel file è `Sí` acuto, la richiesta scriveva `SI`, e un
      confronto letterale avrebbe letto **zero obiettivi senza dirlo**. Sono tre, e hanno un nome:
      McTominay, Baturina, Rowe. ⚠ **La colonna è volutamente fuori da `REQUIRED_COLUMNS`**: serve a
      un percorso e il rifiuto ne fermerebbe due — `uploadCarmy` non la guarda, e deve restare
      identico. Il silenzio si copre col conteggio nel riepilogo (M21-06). `uploadCarmy` mappa le
      colonne una per una, quindi ignora i due campi nuovi senza una riga di modifica, e i suoi test
      passano **non toccati**. 13 test nuovi → **942 in 54 file**
- [x] **M21-06** — Il motore del caricamento personale (§6) in `lib/engine/`: aggancio, soglia,
      sostituzione, riepilogo. Test sul fixture vero, compreso il rifiuto sotto soglia e il rifiuto
      senza listone a sistema
      → `lib/engine/user-listone.ts`, con `uploadUserListone` e `userListoneStatus`. **L'aggancio è
      stato estratto** in `matchToListone` dentro `carmy.ts`: è il caso della regola 8 — il secondo
      chiamante è arrivato, e due copie di quel ciclo sarebbero due modi di leggere lo stesso foglio
      che divergono su dieci righe su cinquecento senza che nessuno lo veda. ⚠ **Il rifiuto sotto
      soglia invece resta separato, e non per distrazione**: la quota si misura uguale, il messaggio
      no — «carica prima il listone aggiornato» a un partecipante è un ordine che non può eseguire,
      quindi il suo dice di rivolgersi a un amministratore. ⚠ **Il gate `canSeeInsights` sta nel
      motore**, non solo nella Server Action: metterlo solo nell'azione vorrebbe dire che il giorno
      in cui nasce un secondo chiamante la guardia resta indietro senza che un test se ne accorga —
      e così è provabile in `tests/db/`. Il riepilogo porta anche **quanti obiettivi** ha letto, ed è
      il rimedio deciso a M21-05 per la colonna non obbligatoria: uno zero lì dice la stessa cosa di
      un rifiuto, a chi ha il file in mano. ⚠ **I test stanno in `tests/db/listone.test.ts`** e non
      nel file di M21-03, per la ragione di M10B: il caricamento personale si aggancia a
      `listone_players`, e quel file **possiede** quella tabella. 12 test nuovi → **954 in 54 file**
- [x] **M21-07** — `listPickPool` con `userId` e la risoluzione «personale se c'è, globale
      altrimenti» + `fasciaGruppo` (§5). ⚠ **Il test che conta è quello dell'assenza**: per un
      utente non-Pro le quattro chiavi non devono esistere nel risultato, non essere `null`
      → Fatto, e §5 è stato aggiornato in due punti: **`fasciaRank` è la quarta chiave** (senza, il
      client dovrebbe sapere quale vocabolario è in gioco per ordinare le intestazioni, cioè
      rifare la decisione che il server ha già preso) e **`CarmyJudgement` perde due chiavi
      obbligatorie**, `sourceName`/`sourceTeam`, che il listone personale non conserva. ⚠ **«Ho
      importato» si decide una volta sola e non riga per riga**: è ciò che rende vera la decisione 5
      — o le fasce sono tutte mie, o sono tutte globali, mai una tabella con `Top` mia e `Top`
      globale come due gruppi. Il test dell'assenza è scritto sul caso peggiore, che non è teorico:
      un utente che **ha** un listone a database e ha **perso** il flag Pro. `userId` lo passano
      **due** pagine, `play` e `manage`: la regia è la regia di chi la guarda, e mostrarle i prezzi
      globali a chi ne ha caricati di suoi sarebbe la stessa incoerenza che la decisione 1 toglie.
      6 test nuovi → **960 in 54 file**
- [x] **M21-08** — `listoneRows` in `lib/realtime/portal.ts` (§4), funzione pura con i suoi test:
      ruoli in OR, ricerca su nome e squadra, filtro obiettivi, esclusione di chi è già in una rosa,
      il giocatore in asta che **resta**, ordinamento dentro il gruppo, ordine dei gruppi nelle due
      modalità di vocabolario
      → Torna **gruppi**, non righe: `{ fascia, players }[]`, con `fascia: null` per «Senza fascia»,
      sempre in fondo. La parola non sta nella funzione pura — è rendering, e il componente la
      traduce. Tre decisioni piccole prese scrivendola, tutte nei test: **nessun ruolo scelto vuol
      dire tutti** (chi spegne tutti gli interruttori sta togliendo un filtro, non chiedendo una
      tabella vuota), **chi non ha `PMA` va in fondo al gruppo** e non in cima, e a parità si scende
      su `fvm`/`quot`/nome perché l'ordine deve essere **stabile** — due disegni a un secondo di
      distanza non si rimescolano sotto le dita. ⚠ La funzione **non sa** quale vocabolario è in
      gioco: ordina per `fasciaRank`, che il server ha già deciso. 11 test nuovi → **971 in 54 file**
- [x] **M21-09** — Le tab e la barra sticky col countdown (§1, §8). ⚠ Provare **il rientro**: aprire
      il Listone, farsi arrivare il turno, chiudere il pannello, e verificare che dalla barra si
      riapra. È il buco che §8 esiste per chiudere, e non lo copre nessun test automatico
      → `Tabs` di `radix-ui` dentro `Portal`, stato locale, nessuna rotta nuova. ⚠ **Lo `sticky` è
      stato tolto da `PortalHeader` e messo su un contenitore che tiene insieme intestazione e
      barra**: due `sticky top-0` fratelli si sovrappongono, e il secondo avrebbe avuto bisogno di
      sapere l'altezza del primo — cioè di un numero magico da tenere allineato a mano. Un
      contenitore solo e quel numero non esiste. ⚠ **Il countdown si vede solo nella tab Listone**,
      ed è una scelta: nella tab Asta le stesse tre cose sono dieci pixel più in basso, dentro la
      card della scena, e ripeterle spenderebbe due volte l'altezza che M17 ha passato una macro a
      restituire al telefono. Guardato in Chrome via CDP: la barra porta «si chiude fra 2s» e il
      pulsante «Offri», che riapre il modale
- [x] **M21-10** — La tabella e i filtri (§4), col gate Pro e il tooltip (§7)
      → ⚠ **Niente `Tooltip`: una riga di testo accanto alla tab spenta**, che è la strada che §7
      lasciava aperta e diceva di decidere guardandola. Guardata: su un telefono un tooltip su un
      elemento disabilitato non si apre in nessun modo, quindi sarebbe una spiegazione che nessuno
      legge proprio dove la tab spenta si tocca. La tab resta visibile e spenta, e accanto c'è
      scritto «Il Listone è per gli utenti Pro». **Un pacchetto in meno del previsto**: `Tooltip`
      non serve più. Verificato a schermo con tre utenti veri — Pro con import, Pro senza import,
      non-Pro
- [x] **M21-11** — Il modale di import (§6), con il riepilogo e lo stato vuoto
      → `Dialog` di `radix-ui` + Server Action in `app/auctions/[id]/play/actions.ts`. ⚠ **Il modale
      non si chiude da sé quando riesce**: il riepilogo è la parte da leggere — dieci nomi non
      agganciati dicono che il foglio e il listone hanno cominciato a divergere — e chiudersi
      sull'esito lo farebbe sparire nell'istante in cui compare. ⚠ **`revalidatePath` sulla pagina di
      gioco è ciò che fa comparire i dati**: il listone risolto è una prop letta all'apertura, non
      passa dallo stream. Lo stato vuoto **non è una tabella vuota**: chi non ha importato vede la
      tabella piena coi valori globali, con sopra una riga che dice cosa manca

> ### ⚠ Due cose viste a schermo che la fase di progettazione non poteva vedere
>
> Il banco di prova di M21-02 disegnava la tab **da sola**, senza la pagina intorno. A schermo, nella
> pagina vera, sono comparse due cose. **Portate all'owner il 2026-08-28, e tutte e due lasciate come
> sono**: si scrivono qui perché la prossima volta che qualcuno le guarda sappia che non sono sfuggite.
>
> 1. **Due file di pillole una sotto l'altra.** Sopra la barra delle tab c'è già la navigazione
>    dell'asta — `Asta live` / `Storico` — che ha esattamente lo stesso aspetto: due gruppi di
>    pillole identici che significano cose diverse («in quale schermata dell'asta sono» contro «quale
>    metà di questa pagina guardo»). Non è rotto, è ridondante da guardare. L'alternativa proposta era
>    dare alle due tab la sottolineatura invece della pillola; **l'owner ha scelto di lasciare il
>    disegno approvato**.
> 2. **L'intestazione delle colonne non è incollata**, mentre nel banco lo era: con la barra delle tab
>    sopra, un `thead` incollato avrebbe bisogno di sapere quanto è alta quella barra — lo stesso
>    numero magico che il contenitore unico ha appena tolto di mezzo. Scorrendo cinquecento righe le
>    intestazioni escono di scena, e restano le intestazioni di **gruppo** (la fascia) come punto di
>    riferimento. **Va bene così** (owner, 2026-08-28).
- [x] **M21-12** — `docs/DECISIONS.md`: il ribaltamento di §0, datato; le due regole per l'ordine
      delle fasce (§4); la scelta della tabella sola (§2). `docs/ARCHITECTURE.md` aggiornato — è un
      criterio di chiusura, non un extra
      → In `DECISIONS.md` sono **tre** voci datate 2026-08-28 e non due: al ribaltamento di §0 e alle
      due regole delle fasce si è aggiunta quella che l'implementazione ha reso necessaria —
      **l'ordine delle fasce non si accoda, si ordina topologicamente** (M21-05), con la misura che
      la giustifica. In `ARCHITECTURE.md` una sezione nuova, «Il listone dentro l'asta», scritta per
      chi leggerà fra sei mesi: perché le tab non sono due rotte, il buco che aprivano e la barra che
      lo chiude, la tabella come funzione dello snapshot, la risoluzione lato server e il vocabolario
      unico. `docs/features/README.md`: M21 spostata da «pianificata» a «in corso»
- [x] **M21-13** — Gate: `pnpm test`, `pnpm typecheck`, `pnpm build` verdi (⚠ la build vuole il dev
      server **spento**, e la prima dopo una sessione di `pnpm dev` può morire da sola: si ridà).
      Prova su `dev` con Docker, seed e una simulata, e **dal telefono** con `pnpm dev:lan`
      → **971 test in 54 file**, typecheck e build verdi. `app/banco/` e `scripts/banco/` cancellati
      com'era previsto — quel banco era **pubblico senza `requireUser()`** e `next build` lo
      compilava. Prova fatta **dall'owner in autonomia** su `asta_banco`, con tutti e quattro i login:
      Pro con import, Pro senza, non-Pro, e l'amministratore. Nessun difetto trovato.
      ⚠ **Una trappola nel gate, subito dopo la cancellazione**: `pnpm typecheck` è diventato rosso
      con `Cannot find module '../../app/banco/telefono/page.js'` — dentro `.next/types/validator.ts`,
      che è **generato** e puntava ancora alla rotta appena cancellata. Non è codice nostro e non è un
      errore vero: si ridà `pnpm build`, che lo rigenera, e il typecheck torna verde. Finita in
      `CLAUDE.md` fra gli errori noti, perché il messaggio punta su un file che nel repo non esiste
- [x] **M21-14** — **Dopo il deploy**, e non è una formalità: `pnpm db:push` sul server con nessuna
      asta `LIVE` o `PAUSED`, poi `pm2 reload deploy/ecosystem.config.cjs --update-env`. Poi la
      versione dalla navbar (`curl -s https://fantasta.rggndr.it/signin | grep -oE '1\.[0-9]+\.[0-9]+'`),
      e **verificare che `gol_fatti` e `assist` si siano riempiti** dopo il primo refresh: sono
      nullable apposta, ma se restassero vuote vorrebbe dire che l'`upsert` non le scrive
      → Deploy partito da sé, **1.21.0 servita 2m40s dopo il push**. Poi il `db:push` sul server: le
      stesse tre istruzioni date in locale, nessuna domanda, e `pm2 reload`. Import provato
      dall'owner **su un'asta vera in produzione**: funziona.
      ⚠ **La finestra fra il deploy e il `db:push` non è innocua, e va saputa prima della prossima
      macro che tocca lo schema.** Per quei ~6 minuti in produzione girava il codice nuovo su uno
      schema vecchio: `/play` andava in errore **per gli utenti Pro e amministratori** — la lettura
      del pool tocca `player_insights.gol_fatti` e `user_listone`, che ancora non c'erano — mentre
      chi non è Pro non passa da quel ramo e non si è accorto di niente. Nessuna scrittura a
      rischio, solo letture. La cosa da ricordare non è «è andata bene»: è che **il `db:push` va dato
      appena il deploy finisce**, e che chi rilascia deve stare davanti al terminale in quei due
      minuti invece di andarsene

---

## Verifica

1. `pnpm test`, `pnpm typecheck` e `pnpm build` verdi.
2. **La tab Asta è attiva al caricamento** e il suo contenuto è **identico** a prima: tre colonne da
   `lg`, colonna unica sotto, stessi pannelli, stessi countdown.
3. **Cambiare tab non riapre lo stream**: nella console di rete, una sola connessione a
   `/api/auctions/[id]/stream` per tutta la sessione, qualunque numero di tocchi sulle tab.
4. **Un utente non-Pro e non-admin vede la tab spenta**, col tooltip — e nel payload della pagina
   (DevTools) **non c'è nessuna** delle quattro chiavi. Verificato guardandolo, non dedotto.
5. **Un admin senza `is_pro` apre la tab.**
6. **La tabella mostra solo chi è rimasto**: si assegna un giocatore e la sua riga sparisce **senza
   ricaricare la pagina**.
7. **Il giocatore in asta adesso è ancora in tabella**, con il suo badge; se il lotto va deserto
   resta, se viene assegnato sparisce.
8. **Dentro un gruppo l'ordine è per PMA decrescente**, e la colonna del ruolo c'è su ogni riga.
9. **Il filtro dei ruoli parte dal ruolo in gioco**, si può mettere in OR, e una volta toccato non si
   muove più quando l'asta cambia ruolo.
10. **La ricerca trova per nome e per squadra**, accenti e maiuscole comprese.
11. **Importando il file di riferimento**: le fasce sono nell'ordine del file, gli obiettivi hanno
    l'icona verde, il filtro obiettivi li isola, e il riepilogo dice righe scritte, non agganciate e
    squadre discordanti.
12. **Chi non ha importato vede la tabella piena** con i valori globali e **nessun** obiettivo.
13. **Chi ha importato vede «Senza fascia» in fondo**, con dentro chi nel suo file non c'è, e quelle
    righe hanno comunque PMA, FMV Exp. e note globali quando ci sono.
14. **Ri-importare sostituisce**: un obiettivo tolto dal file sparisce dalla tabella.
15. **Due utenti diversi vedono due tabelle diverse**, e nessuno dei due vede gli obiettivi
    dell'altro. Provato con due sessioni sulla stessa asta.
16. **Gol e Assist ci sono** e vengono dalla fonte A: si spegne il file personale e restano.
17. **Il rientro dal Listone**: turno mio, chiudo il pannello dal Listone, la barra sticky mostra il
    countdown e il pulsante lo riapre.
18. **Su un telefono vero a 375px**: la barra delle tab e l'intestazione incollata non si mangiano
    l'altezza dell'offerta, e la riga della tabella si legge.
19. **`serializeSnapshot` non è toccato**: verificato sul diff `origin/main..dev`, non dedotto.
20. **Niente `dark:` nel codice nuovo**, e la TV resta bianco su nero com'era.
21. **`pnpm db:push` dato sul server**, e **nessun backfill** richiesto: le due colonne nuove si sono
    riempite da sole al primo refresh.
