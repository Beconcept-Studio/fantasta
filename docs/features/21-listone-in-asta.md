# M21 — Il listone dentro l'asta: una tab, gli obiettivi di ognuno, e i giocatori che restano

> **Stato:** **pianificata**, non aperta. Nasce dall'unica richiesta del quaderno del 2026-08-28,
> tolta da `docs/REQUESTS.md` lo stesso giorno.
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
10. **`PMA` in percentuale con i crediti accanto**, come già fa la lista di chiamata.

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
uno solo, **il filtro obiettivi**, e **nessun tetto di quaranta righe**. L'ordinamento **dentro il
gruppo** resta quello di casa — `fvm DESC, quot DESC, nome` — mentre i gruppi vanno nell'ordine
delle fasce.

⚠ **Nessuna query per lotto, e nessun evento da ascoltare.** «Sincronizzata in tempo reale con ogni
lotto» è già risolto dal fatto che la tabella è funzione dello snapshot: quando un lotto chiude, la
rosa del vincitore cambia, lo snapshot arriva, la riga sparisce. È I10 senza scrivere una riga per
ottenerlo.

**Il giocatore in asta adesso resta in tabella, con un badge «in asta».** Non è ancora di nessuno, e
farlo sparire prima dell'assegnazione sarebbe una bugia — per di più una bugia che si corregge da
sé, perché se il lotto va deserto quel giocatore torna disponibile.

**Le colonne**, nell'ordine della richiesta: Fascia (nell'intestazione del gruppo, non ripetuta su
ogni riga), Obiettivo, Nome (con la squadra), PMA, FMV Exp., Gol, Assist, Note.

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
```

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
   posto solo**, leggendo i quattro fogli in ordine `P, D, C, A` e assegnando a ogni fascia nuova il
   numero successivo. ⚠ Il merge fra i quattro fogli non è banale e va scritto sapendolo: `P` e `A`
   **non hanno** `Titolare "Scarso"`, che in `D` e `C` sta fra `Scomm.` e `Outsider` — la prima
   occorrenza in ordine di foglio dà il risultato giusto su questo file, e il test lo fissa sul
   fixture vero.

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
- **Nessun pacchetto nuovo**: `Tabs` e `Tooltip` da `radix-ui`, l'icona da `lucide-react`.

---

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
- [ ] **M21-02** — **La progettazione UI della tab Listone, prima di qualunque codice di
      produzione** (è la richiesta esplicita dell'owner). Barra delle tab e sua versione sticky col
      countdown, tooltip della tab spenta, intestazioni di gruppo, la riga della tabella sul
      telefono a 375px e su desktop, il modale di import, lo stato vuoto di chi non ha importato.
      **Guardarla**, non descriverla. ⚠ Se la progettazione cambia una scelta di questa spec,
      **la spec si aggiorna nella stessa sessione** e il cambiamento si dichiara: è la parte della
      richiesta che vale quanto le altre
- [ ] **M21-03** — Lo schema (§2): `user_listone` e le due colonne su `player_insights`. `pnpm
      db:push` in locale, e **il primo test in `tests/db/` che tocca la tabella nuova** — è il modo
      in cui ci si accorge di una colonna dimenticata prima del server
- [ ] **M21-04** — Gol e Assist dalla fonte A (§3): `parseFantalabListone`, l'`upsert` di
      `refreshInsights`, e un test sul fixture vero che verifica che i due numeri arrivino e che la
      fonte B **non** li tocchi
- [ ] **M21-05** — Il parser (§6): `Obiett.` normalizzato e `fascia_rank` col merge dei quattro
      fogli, con i test sul fixture vero — incluso quello su `Titolare "Scarso"`, che in `P` e `A`
      non c'è. ⚠ Verificare che `uploadCarmy` continui a comportarsi **identico**: i suoi test
      esistenti devono passare senza modifiche
- [ ] **M21-06** — Il motore del caricamento personale (§6) in `lib/engine/`: aggancio, soglia,
      sostituzione, riepilogo. Test sul fixture vero, compreso il rifiuto sotto soglia e il rifiuto
      senza listone a sistema
- [ ] **M21-07** — `listPickPool` con `userId` e la risoluzione «personale se c'è, globale
      altrimenti» + `fasciaGruppo` (§5). ⚠ **Il test che conta è quello dell'assenza**: per un
      utente non-Pro le quattro chiavi non devono esistere nel risultato, non essere `null`
- [ ] **M21-08** — `listoneRows` in `lib/realtime/portal.ts` (§4), funzione pura con i suoi test:
      ruoli in OR, ricerca su nome e squadra, filtro obiettivi, esclusione di chi è già in una rosa,
      il giocatore in asta che **resta**, ordinamento dentro il gruppo, ordine dei gruppi nelle due
      modalità di vocabolario
- [ ] **M21-09** — Le tab e la barra sticky col countdown (§1, §8). ⚠ Provare **il rientro**: aprire
      il Listone, farsi arrivare il turno, chiudere il pannello, e verificare che dalla barra si
      riapra. È il buco che §8 esiste per chiudere, e non lo copre nessun test automatico
- [ ] **M21-10** — La tabella e i filtri (§4), col gate Pro e il tooltip (§7)
- [ ] **M21-11** — Il modale di import (§6), con il riepilogo e lo stato vuoto
- [ ] **M21-12** — `docs/DECISIONS.md`: il ribaltamento di §0, datato; le due regole per l'ordine
      delle fasce (§4); la scelta della tabella sola (§2). `docs/ARCHITECTURE.md` aggiornato — è un
      criterio di chiusura, non un extra
- [ ] **M21-13** — Gate: `pnpm test`, `pnpm typecheck`, `pnpm build` verdi (⚠ la build vuole il dev
      server **spento**, e la prima dopo una sessione di `pnpm dev` può morire da sola: si ridà).
      Prova su `dev` con Docker, seed e una simulata, e **dal telefono** con `pnpm dev:lan`
- [ ] **M21-14** — **Dopo il deploy**, e non è una formalità: `pnpm db:push` sul server con nessuna
      asta `LIVE` o `PAUSED`, poi `pm2 reload deploy/ecosystem.config.cjs --update-env`. Poi la
      versione dalla navbar (`curl -s https://fantasta.rggndr.it/signin | grep -oE '1\.[0-9]+\.[0-9]+'`),
      e **verificare che `gol_fatti` e `assist` si siano riempiti** dopo il primo refresh: sono
      nullable apposta, ma se restassero vuote vorrebbe dire che l'`upsert` non le scrive

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
8. **Il filtro dei ruoli parte dal ruolo in gioco**, si può mettere in OR, e una volta toccato non si
   muove più quando l'asta cambia ruolo.
9. **La ricerca trova per nome e per squadra**, accenti e maiuscole comprese.
10. **Importando il file di riferimento**: le fasce sono nell'ordine del file, gli obiettivi hanno
    l'icona verde, il filtro obiettivi li isola, e il riepilogo dice righe scritte, non agganciate e
    squadre discordanti.
11. **Chi non ha importato vede la tabella piena** con i valori globali e **nessun** obiettivo.
12. **Chi ha importato vede «Senza fascia» in fondo**, con dentro chi nel suo file non c'è, e quelle
    righe hanno comunque PMA, FMV Exp. e note globali quando ci sono.
13. **Ri-importare sostituisce**: un obiettivo tolto dal file sparisce dalla tabella.
14. **Due utenti diversi vedono due tabelle diverse**, e nessuno dei due vede gli obiettivi
    dell'altro. Provato con due sessioni sulla stessa asta.
15. **Gol e Assist ci sono** e vengono dalla fonte A: si spegne il file personale e restano.
16. **Il rientro dal Listone**: turno mio, chiudo il pannello dal Listone, la barra sticky mostra il
    countdown e il pulsante lo riapre.
17. **Su un telefono vero a 375px**: la barra delle tab e l'intestazione incollata non si mangiano
    l'altezza dell'offerta, e la riga della tabella si legge.
18. **`serializeSnapshot` non è toccato**: verificato sul diff `origin/main..dev`, non dedotto.
19. **Niente `dark:` nel codice nuovo**, e la TV resta bianco su nero com'era.
20. **`pnpm db:push` dato sul server**, e **nessun backfill** richiesto: le due colonne nuove si sono
    riempite da sole al primo refresh.
