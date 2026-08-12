# M10 — Il listone a sistema

> **Stato:** **chiusa** su `dev` il 2026-08-12 · Aperta e chiusa su `feature/10-listone-a-sistema` ·
> Pianificata il 2026-08-12 · ⚠ **Il rilascio non è suo**: M10 esce **insieme a M10B**, in un
> rilascio solo con un tag solo — `v1.11.0` — deciso dall'owner il 2026-08-12. Fino ad allora `dev`
> resta avanti a `main`, ed è la decisione, non una dimenticanza. I due passi a mano di §9 restano
> dovuti e finiscono nel `CHANGELOG.md` di quel rilascio, insieme a quelli di M10B · Dipende da
> **M9** solo per un componente: il Centro dati (§6) mostra i badge colorati, ed è il loro terzo
> chiamante. Se per qualche ragione M9 slittasse, il Centro dati nasce con i due grigi di M8 e i badge
> arrivano dopo — non è un blocco, è un ordine preferibile.
>
> **Tocca lo schema del database?** **Sì**, in modo additivo: **una tabella nuova**
> (`listone_players`). Nessuna colonna sparisce, nessun tipo cambia → **niente `pg_dump`
> preventivo**, ma `pnpm db:push` sul server **va dato a mano dopo il deploy**:
>
> ```bash
> cd /home/ploi/fantasta.rggndr.it && pnpm db:push
> pm2 reload deploy/ecosystem.config.cjs --update-env
> ```
>
> ⚠ **E c'è un backfill che nessuno ti ricorda: la tabella nasce vuota.** Finché non si carica il file
> dal pannello, tre cose restano ferme — le caricature non si possono scaricare (§5), il Centro dati è
> vuoto, e alla creazione di un'asta non compare nessuna proposta. **Niente si rompe**: chi crea
> un'asta carica il suo `.xlsx` come ha sempre fatto. È lo stesso inciampo dell'archivio figurine di
> M7 e della tabella di M8, con la stessa cura — sta scritto in §9 e va nel `CHANGELOG.md`.
>
> **Invarianti coinvolti:** **I9 è il cuore di questa macro** e non cambia di una riga: continua a
> essere validato **per asta**, al momento in cui le righe entrano in `players`, con lo stesso
> `validateRolePool`. **I2, I4** non sono toccati. **Regole coinvolte:** 5 (non violata, e §3 dice
> perché), 6, 8. **P7** (il toggle `include_out_of_list`) dipende da una colonna che la tabella nuova
> deve portarsi dietro, ed è il vincolo più facile da sbagliare di tutta la macro (§2).
>
> ⚠ Si è aperta **su richiesta esplicita dell'owner**, come tutte.

## Obiettivo

Il pannello di amministrazione è cresciuto per accumulo: `Utenti`, `Aste`, `Figurine`, `Listone`, e le
ultime due sono la stessa cosa vista da due lati — un archivio globale riempito da un pulsante. Che si
somigliassero era già scritto in `DECISIONS.md` (2026-08-12, «sono le due voci che non parlano di
righe legate a un'asta e si somigliano»): questa macro prende quell'osservazione e la trasforma in una
gerarchia.

Ma sotto la riorganizzazione c'è una cosa che oggi **non esiste**: un listone dell'applicazione. Il
listone vive solo dentro un'asta (`players.auction_id` congela la lista al momento dell'import) e il
downloader delle figurine si fa ricaricare un `.xlsx` usa-e-getta a ogni passata. Il risultato è che
lo stesso file viene caricato tre volte per tre scopi diversi, e non c'è nessun posto in cui si possa
rispondere alla domanda più semplice di tutte: *chi c'è nel listone di quest'anno?*

Questa macro dà quel posto. Il file si carica **una volta**, in admin; da lì si scaricano le
caricature, si guarda il Centro dati, e chi crea un'asta se lo trova proposto invece di andarlo a
cercare nei download.

Il tema, detto in una riga: *un file, caricato una volta, che serve tutte le aste — senza smettere di
essere copiato dentro ognuna.*

## Richieste che ci confluiscono

Tolta da `docs/REQUESTS.md` il 2026-08-12.

- **Gestione listone e varie.** «Vorrei cambiare un attimo le dinamiche nel portale admin, ora è tutto
  molto in confusione. Prima di tutto: una sezione listone dove posso caricare solo il listone. Di
  default vorrei però che ci fosse un sistema che una volta al giorno chieda il listone aggiornato.
  Sotto due sottosezioni che si attivano solo una volta caricato il listone (devono essere visibili ma
  non permettere azioni fino a quando il listone non è ok): Caricature: possibilità di attivare la
  richiesta di download caricature · Insight: attivazione download solo una volta caricato il listone
  · Centro dati: tabella con la lista di tutto il listone, le info principali (calciatore, squadra,
  fmv, valutazione, e gli insight importanti). Il listone deve avere una search per trovare il
  calciatore e avere un filtro per ruolo. Vorrei inoltre che una volta caricato in admin il listone,
  quando si crea una nuova asta venga proposto di usare il listone presente a sistema (evitando quindi
  l'upload dal manager dell'asta). Si indica data di ultimo aggionramento così può decidere se vuole
  usare quello.»

**Una frase di questa richiesta non sta qui: «un sistema che una volta al giorno chieda il listone
aggiornato» è M11.** La separazione non è di comodo, e il perché è in §1: nel pannello la parola
«listone» indica **due file diversi**, e solo uno dei due si può chiedere da sé.

**Tre decisioni dell'owner del 2026-08-12** che hanno stretto il perimetro di questa macro:

- **Il Centro dati resta in admin** e non esce verso gli owner o chi ha `is_pro`. Quindi
  `canSeeInsights` non entra: la pagina è già dietro `requireAppAdmin()`.
- **Nel Centro dati la colonna `FVM/1000` non si mostra**: solo la quotazione e gli insight.
  ⚠ Attenzione a non tradurlo in «togliamo `fvm` dalla tabella», che romperebbe l'auto-pick (§2).
- **Il gate sulla sottosezione Insight: decisione delegata a me.** La risposta è §5, e va contro la
  lettera della richiesta.

---

## Spec

### 1. «Listone» sono due file, e solo uno si può chiedere da sé

Da leggere prima del resto, perché è la distinzione da cui dipendono questa macro e M11.

| | Cos'è | Da dove viene | Cosa porta di unico |
|---|---|---|---|
| **A** | Il listone **d'asta** | Export **Leghe** in `.xlsx`, scaricato a mano dall'area riservata | La colonna **`Fuori lista`**, da cui dipendono **I9** e il toggle **P7** |
| **B** | Il listone **degli insight** | `GET https://api.fantalab.it/v2/listone`, pubblica | `starts_eleven`, `min_playing_time`, i rigori storici |

Il pulsante di M8 si chiama «Importa il listone» ed è **B**. Il file che definisce un'asta è **A**.

⚠ **A non si può automatizzare, e non per pigrizia: passa da un login** (verificato con l'owner il
2026-08-12 — «l'export passa da un login, quindi non creiamo collegamenti»). Il file *Quotazioni* di
Fantacalcio.it è pubblico ma **non ha `Fuori lista`**, ed è già stato scartato per questa ragione in
`DECISIONS.md` (2026-08-12, M8): un listone a sistema costruito da quel file lascerebbe I9 e P7 senza
il loro input.

**Quindi: A si carica a mano — ed è questa macro. B si aggiorna da sé — ed è M11.** Il pannello le
mette nella stessa sezione perché è il posto giusto per guardarle insieme, non perché siano la stessa
cosa.

### 2. Lo schema, e il campo che non va tolto per sbaglio

Una tabella sola, globale, con la stessa forma di `players` meno l'asta:

```ts
export const listonePlayers = pgTable("listone_players", {
  /** La colonna `#` del file: la stessa chiave di `players.ext_id` e di `player_insights.ext_id`. */
  extId: integer("ext_id").primaryKey(),
  name: text("name").notNull(),
  team: text("team").notNull(),
  role: text("role").$type<Role>().notNull(),
  roleMantra: text("role_mantra"),
  fvm: integer("fvm").notNull(),
  quot: integer("quot").notNull(),
  outOfList: boolean("out_of_list").notNull().default(false),
  /** Quando è stato caricato il file da cui viene questa riga. Uguale su tutte
   *  le righe di uno stesso upload: è la data che l'owner legge per decidere. */
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull(),
});
```

Il nome della tabella è **`listone_players`** e non `listone`: «listone» in questa applicazione indica
già due file (§1) e una voce di menu, e una tabella che si chiama come un concetto ambiguo è una
tabella che qualcuno userà per la cosa sbagliata. Il precedente sul bilinguismo è di M7 — «il codice
parla la lingua del CDN, la navigazione quella della stanza» — e qui vale allo stesso modo: il menu
dice `Listone`, lo schema dice di quali righe si tratta.

⚠ **`fvm` resta nella tabella anche se il Centro dati non lo mostra**, e questa è la trappola numero
uno di questa macro. La decisione dell'owner («FMV togli») riguarda **una colonna di una tabella a
schermo**, non il dato: `players_autopick_idx` ordina per **`fvm` DESC, `quot` DESC, `ext_id` ASC**, e
quell'ordinamento *è* l'auto-pick. Una copia verso `players` senza `fvm` cambierebbe chi viene scelto
quando scade il timer di una chiamata — cioè il comportamento del motore, da una decisione di layout.

⚠ **`outOfList` è l'altro campo da non perdere.** Senza di lui `validateRolePool` conta i giocatori
sbagliati (I9) e il toggle P7 non ha niente su cui lavorare. È anche il campo che **impedisce** di
costruire questa tabella dal file Quotazioni (§1).

**Un upload sostituisce l'intera tabella**, come `importPlayers` sostituisce lo snapshot di un'asta:
`DELETE` di tutto e `INSERT` delle righe nuove, in transazione. Non è una violazione della regola 5 —
qui non ci sono assegnazioni né ledger, è un elenco di calciatori di Serie A, e sostituire un elenco è
l'unico modo di correggere un file sbagliato senza inventare un merge fra due listoni.

⚠ **L'upload globale non valida I9, e non può.** I9 dipende da posti e slot, che sono di un'asta:
qui non ce n'è nessuna. Si valida il file (`parseListone`, che è già puro e già scritto) e basta. **I9
si valida alla copia** (§3), che è il momento in cui esiste un'asta di cui chiederlo.

**Il file non si conserva** (P6, come per l'import d'asta e per le figurine): si estraggono le righe e
si butta.

### 3. La copia dentro l'asta resta una copia — cosa non deve cambiare

`lib/db/schema.ts` è esplicito da sempre: *«Il listone è copiato dentro l'asta. `players.auction_id`
congela la lista al momento dell'import»*. Questa macro **non tocca quel principio**, e la ragione è
di dominio, non di architettura: un'asta preparata lunedì non può cambiare listone perché martedì
qualcuno ha caricato in admin un file aggiornato. Le rose, i prezzi e le regole di quella serata sono
appesi a quelle righe.

Quindi, con parole che il codice deve rispettare:

1. **Il listone a sistema è una sorgente da cui si copia, mai una tabella da cui l'asta legge.**
   Nessuna query dell'asta, in nessuna fase, deve toccare `listone_players`. Se un `JOIN` verso quella
   tabella compare in `lib/engine/machine.ts`, `rules.ts`, `snapshot.ts` o `listPickPool`, il lavoro è
   fuori posto.
2. **I9 si valida alla copia**, con lo stesso `validateRolePool` dell'upload: lo stesso listone
   globale può passare per un'asta a 8 e fallire per una a 12, **ed è giusto che fallisca**. Il
   messaggio d'errore è quello che c'è già.
3. **Il toggle P7 continua a rivalidare I9** a ogni modifica. Non si tocca.
4. **L'upload nel setup dell'asta resta** (richiesta esplicita dell'owner, 2026-08-12: «lasciamo
   comunque la possibilità di importare l'attuale listone al cliente»). Serve a due cose che non
   spariscono: correggere un file sbagliato, e permettere a chi possiede un'asta di prepararla anche
   quando a sistema non c'è niente — cioè il giorno del deploy (§9).
5. **Il reimport resta possibile** in DRAFT/READY, da file o da sistema, nei due sensi.

**La funzione nuova è una sola** — `importPlayersFromListone(actorUserId, auctionId)` — e condivide
con `importPlayers` la parte che conta: validazione del pool, `DELETE` delle righe vecchie, `INSERT`
delle nuove, `recomputeStatus`. Il secondo chiamante è arrivato davvero (regola 8), quindi quella
parte si estrae; ciò che resta diverso è **da dove arrivano le righe**: da un `.xlsx` parsato o da una
`SELECT`.

### 4. Dove si propone, e cosa succede se non ci sta

Due posti, una funzione.

| Dove | Come si presenta |
|---|---|
| `app/auctions/new` | Una scelta nel form: **«Usa il listone a sistema (aggiornato il 12 agosto)»**, preselezionata se a sistema c'è qualcosa. Se non c'è, l'opzione non compare affatto — non compare disabilitata |
| Il setup dell'asta | Accanto all'upload che c'è già: un pulsante **«Usa il listone a sistema · aggiornato il 12 agosto»** |

**La data è il punto della richiesta** («si indica data di ultimo aggiornamento così può decidere se
vuole usare quello») e viene da `uploadedAt`, resa in `Europe/Rome` — perché **il server gira in
UTC**, processo compreso: senza il fuso, un upload delle 23:30 comparirebbe come del giorno prima. La
funzione `when()` che lo fa esiste già in `app/admin/listone/page.tsx` e ora ha il suo secondo
chiamante.

⚠ **Creare l'asta non deve poter fallire per colpa del listone.** La copia avviene **dopo** che la
riga dell'asta esiste, dentro il suo lock di setup; se I9 non passa — un listone che non copre gli
slot di dodici squadre — l'asta **resta creata, in DRAFT, senza listone**, e il messaggio dice
esattamente questo insieme al motivo. L'alternativa (rifiutare la creazione) sarebbe la trappola in
cui un file inadatto impedisce di creare un'asta che si potrebbe preparare a mano in trenta secondi.

**Chi può usarla: chiunque possieda un'asta**, non solo gli amministratori. Il listone a sistema lo
carica un admin, ma è un elenco di calciatori di Serie A — non c'è niente da proteggere, e legarne
l'uso a `is_admin` vorrebbe dire che un amico che si crea la sua asta deve chiedere il permesso per
non caricare un file.

### 5. Il pannello, riorganizzato — e il gate solo dove è vero

**La gerarchia nuova**, in `lib/admin-nav.ts`, che resta l'unico posto dove etichetta, titolo e
segmento di URL escono dalla stessa riga:

```text
Utenti
Aste
Listone                     /admin/listone        ← l'upload, lo stato, e le due azioni
  ⤷ Centro dati             /admin/listone/dati   ← la tabella
```

`Figurine` **sparisce come voce di primo livello** e diventa un blocco dentro `Listone`: era la voce
che non parlava di righe legate a un'asta, e adesso ha un posto dove quella frase ha un senso.

**Una pagina per la sezione, non quattro.** In cima l'upload e lo stato (quante righe, di quando);
sotto, i due blocchi d'azione — **Caricature** (scarica le figurine che mancano) e **Insight** (le due
`GET` di M8). Stanno insieme perché si leggono insieme: sono le due cose che si fanno *con* un listone
appena caricato. **Il Centro dati ha una pagina sua** perché cinquecento righe con una casella di
ricerca non stanno sotto un form di upload — e perché è una pagina che si apre per consultare, non per
agire. (Valutato e scartato: quattro pagine separate. Avrebbero moltiplicato per quattro i clic della
sequenza «carico, scarico i volti, aggiorno i numeri», che è la sequenza per cui la sezione esiste.)

⚠ **Il gate: solo su Caricature. Insight resta sempre attivo** — contro la lettera della richiesta,
su delega dell'owner, e con quattro ragioni di cui l'ultima è quella che decide.

1. **Caricature ha una dipendenza vera**: il downloader ha bisogno dell'elenco degli `ext_id`. Oggi lo
   prende da un `.xlsx` che gli si ricarica ogni volta; da questa macro lo prende dalla tabella, e il
   gate diventa la spiegazione naturale di dove sono finiti gli id.
2. **Insight non ne ha nessuna.** Le due fonti di M8 creano righe con chiave `ext_id` e non sanno che
   esistiamo: bloccarle finché non c'è un file caricato bloccherebbe un aggiornamento che
   *riuscirebbe*. È la regola 6 letta al contrario — un pulsante disabilitato che funzionerebbe è una
   bugia dell'interfaccia, come lo era nascondere gli insight in CSS (M8 §6).
3. **Il gate che serve, dentro quel blocco, esiste già ed è vero**: «Aggiorna i designati» è
   disabilitato finché la tabella degli insight è vuota, perché la fonte B aggiorna righe che nascono
   dalla A. La procedura è già insegnata dove è reale.
4. ⚠ **Decisiva: M11 fa partire quel refresh da solo, ogni giorno.** Un pulsante bloccato accanto alla
   scritta «aggiornato automaticamente tre ore fa» è incoerente, e il gate andrebbe smontato da M11 —
   cioè lo scriveremmo adesso per cancellarlo alla macro dopo.

**Cosa vede chi arriva a tabella vuota.** La sezione **è visibile** e lo dice, com'è nella richiesta:
in cima «0 giocatori a sistema — carica il file qui sopra», il blocco Caricature con il pulsante
spento e la ragione scritta accanto, il Centro dati che dice di essere vuoto invece di mostrare una
tabella con le intestazioni e niente sotto. È il pattern di M7 e M8, dove il numero grande in cima
alla pagina **è** l'allarme che il passo a mano è ancora da dare.

**E il campo file delle Caricature sparisce.** `downloadCampionciniAction` prende gli id dalla
tabella: un upload in meno da maneggiare, che è il tipo di riga che vale la pena scrivere in un
changelog. ⚠ Il test di M6 che enumera le server action del pannello **non si rompe** (nessuna azione
nuova, nessun nome cambiato), ma i test di M7 su quell'azione sì — e va sistemato togliendo il file,
non allentando le asserzioni.

⚠ **`activeAdminSection` oggi guarda `parts[1]` e basta.** Con una voce annidata, `/admin/listone/dati`
deve accendere «Centro dati» e non «Listone», e va provato: è precisamente il bug per cui
`lib/admin-nav.ts` esiste — un'etichetta e una destinazione tenute insieme dall'attenzione divergono
prima o poi.

### 6. Il Centro dati

Una tabella di tutto il listone a sistema, con gli insight accanto.

| Colonna | Da dove | Nota |
|---|---|---|
| Calciatore | `listone_players.name` | |
| Squadra | `listone_players.team` | |
| Ruolo | `listone_players.role` | Anche il filtro |
| Quotazione | `listone_players.quot` | ⚠ **Non `fvm`** (decisione dell'owner) — che però resta a database (§2) |
| Titolarità | `player_insights` | La percentuale, con il badge di M9 |
| Rigori / Piazzati | `player_insights` | I badge blu di M9 — **terzo chiamante**, quello che li rende un componente |
| Fuori lista | `listone_players.outOfList` | Un segno discreto: è l'unica colonna che cambia il comportamento di un'asta |

**`LEFT JOIN`, sempre.** Le due tabelle sono globali ma indipendenti: un listone caricato prima che gli
insight siano stati importati mostra le sue righe con `—` al posto dei numeri, e un giocatore con
insight che non è nel listone **non compare affatto** — il listone è il denominatore, ed è la ragione
per cui questa pagina è anche il posto migliore da cui giudicare la copertura (§7).

**Search e filtro girano nel browser, su un payload solo.** Cinquecento righe con gli insight dentro
sono ~250 KB (misura di M8: 241 KB per il pool intero con insight, sopra HTTP) — un numero che
conosciamo perché è già stato pagato una volta al giorno da ogni telefono in `/play`. Niente
paginazione, niente `?q=` sul server, niente debounce contro un endpoint: la ricerca è un `filter` su
un array che è già in memoria, e risponde mentre si scrive. Se un giorno il listone avesse
cinquemila righe, sarà il momento di cambiare — e non prima (regola 8).

**Solo admin** (decisione dell'owner): la pagina sta dietro `requireAppAdmin()`, come tutte quelle del
pannello, e la guardia va **anche nella pagina** e non solo nel layout (M6 §5). Perciò
`canSeeInsights` **non entra in questa pagina**: un amministratore vede gli insight per costruzione, e
aggiungere il predicato qui darebbe l'impressione che ci sia una seconda regola da tenere allineata.

### 7. La copertura, che finalmente ha un denominatore

Oggi `insightsCoverage` misura quanti giocatori delle **ultime cinque aste** hanno una riga di
insight, e la ragione per cui è così è scritta in `DECISIONS.md` (2026-08-12): la prima idea —
sbarrare l'import sotto una soglia di copertura — era **avvelenabile**, perché il listone di un'asta
simulata ha `ext_id` sintetici da 1 a 40 e porta la copertura a zero su dati perfetti. Da lì è nato il
controllo di **continuità** all'85%.

Con un listone a sistema esiste per la prima volta un riferimento vero, e la copertura globale diventa
il numero che si vorrebbe leggere: *quanti dei giocatori di quest'anno hanno qualcosa da dire?* Va nel
pannello, accanto ai due timestamp.

⚠ **E resta un'informazione, non una guardia.** La continuità all'85% **non si tocca**: è lei che
protegge dall'import di una fonte che ha cambiato lingua, e sostituirla con una soglia di copertura
sul listone a sistema rimetterebbe in piedi esattamente il controllo avvelenabile che M8 ha smontato —
questa volta avvelenabile da un file caricato per sbaglio. La copertura per asta resta anche lei: la
domanda «il *mio* listone è coperto?» non è la stessa di «la fonte copre il listone di quest'anno?».

### 8. Il perimetro — cosa questa macro non fa

- **Non tocca** `lib/engine/machine.ts`, `rules.ts`, `snapshot.ts`, il lock, il ledger, lo scheduler,
  il tick dei bot. Se un task sfiora uno di questi, il task è fuori posto.
- **Non tocca `parseListone.ts`** né il formato dell'export: il parser che c'è legge il file che c'è.
- **Non aggiunge un'automazione.** «Una volta al giorno» è M11 (§1).
- **Non tocca `players`**: né lo schema, né l'indice dell'auto-pick, né il fatto che sia una copia (§3).
- **Non fa scaricare le figurine all'upload del listone.** Sono due pulsanti e restano due: legarli
  vorrebbe dire che caricare un file corretto fa partire cinquanta megabyte che nessuno ha chiesto.
- **Non aggiunge eccezioni all'allowlist ESLint.** La lettura e la scrittura della tabella stanno in
  `lib/engine/listone.ts`, e `lib/engine/**` è già dentro; le pagine chiamano quelle funzioni.
- **Non conserva l'`.xlsx`** (P6).
- **Non fa uscire il Centro dati dall'admin**, e non introduce nessuna vista pubblica del listone.
- **Non cancella la tabella dal pannello**: un listone si sostituisce caricandone un altro, e uno
  svuotamento è un'operazione che nessuno ha chiesto e che si può fare in `psql`.

### 9. ⚠ Il rilascio non finisce col merge

Due passi sul server, e nessuno te li ricorda:

1. `pnpm db:push` + `pm2 reload deploy/ecosystem.config.cjs --update-env` (in testa a questo file, per
   esteso — un comando abbreviato viene copiato com'è, `…` compresi: è successo il 2026-08-11).
2. **La tabella nasce vuota**, e va riempita da Admin → Listone caricando il file. Finché non si fa:
   niente caricature nuove, Centro dati vuoto, nessuna proposta alla creazione di un'asta. **Niente si
   rompe** — chi crea un'asta carica il suo file come sempre — e questo è precisamente ciò che rende
   il passo facile da dimenticare. Stesso inciampo di M7 e M8, stessa cura: scritto nel `CHANGELOG.md`.

---

## Task

> Da rifinire all'apertura della macro. Sono la traduzione della spec, non un impegno preso nella
> sessione in cui è stata scritta.

- [x] **M10-01** — Aprire `feature/10-listone-a-sistema` da `dev`; rileggere questo file, e in
      particolare §1 (i due listoni), §2 (`fvm` e `outOfList` che non si tolgono) e §3 (la copia che
      resta una copia). Verificare che `pnpm test` sia verde **prima** di toccare qualcosa, così quando
      i test di M7 romperanno si sa perché
      → Baseline: **627 test in 41 file, verdi**.
- [x] **M10-02** — `lib/db/schema.ts`: `listone_players` come in §2, con i commenti che dicono perché
      `fvm` c'è pur non essendo mostrato e perché `out_of_list` è obbligatorio. `pnpm db:push` in locale
      → Nessuna divergenza. La tabella è esattamente quella di §2.
- [x] **M10-03** — `lib/engine/listone.ts`: l'upload (parse, `DELETE` + `INSERT` in transazione,
      `uploadedAt`), lo stato per il pannello (righe, data), la lettura per il Centro dati con il
      `LEFT JOIN` sugli insight, e la copertura globale di §7. **Nessuna eccezione nuova
      all'allowlist ESLint**
      → Nessuna eccezione aggiunta, come previsto. Due funzioni in più rispetto alla spec:
      `readListoneForCopy(tx)`, che accetta un `Reader` perché la copia legge **dentro** il lock di
      setup, e `listoneExtIds()` per M10-08. E una trappola già nota ripresa da `insights.ts`: il
      `max(uploaded_at)` scritto in `sql<...>` torna una **stringa**, non una `Date` — la conversione
      è esplicita, con il commento che rimanda alla cicatrice di M8.
- [x] **M10-04** — `importPlayersFromListone(actorUserId, auctionId)` in `lib/engine/setup.ts`, con la
      parte condivisa estratta da `importPlayers` (regola 8: il secondo chiamante è arrivato).
      **I9 validato alla copia**, `recomputeStatus` in coda, e il rifiuto leggibile se il listone non
      copre gli slot dell'asta
      → La parte condivisa è `replacePlayers(tx, auction, rows)`, e il suo parametro è **strutturale**:
      accetta sia le righe di `parseListone` sia quelle di `readListoneForCopy` senza che nessuno dei
      due mondi conosca l'altro. È anche il motivo per cui le due strade producono righe identiche per
      costruzione e non per attenzione.
- [x] **M10-05** — La proposta alla creazione (`app/auctions/new`) e il pulsante nel setup, con la
      **data in `Europe/Rome`** (§4). ⚠ Se la copia fallisce, **l'asta resta creata in DRAFT** e il
      messaggio dice perché: da provare a mano, non solo con un test
      → La spec diceva «una scelta nel form, preselezionata». Mostrati tre mockup all'owner, che ha
      scelto **due alternative esplicite** («Il listone a sistema · N giocatori · caricato il …» /
      «Lo carico io») invece della casella spuntata: costa una domanda in più, e in cambio rende
      visibile che la seconda strada esiste. → `when()` è uscita da `app/admin/listone/page.tsx` e
      vive in `lib/when.ts`: i chiamanti sono **tre**, non due. → Il motivo del fallimento viaggia in
      un parametro dell'URL, perché la creazione finisce con un `redirect` e la `FormState` muore con
      la pagina; la costante sta in `form-state.ts`, perché da un modulo `"use server"` non esce
      niente che non sia una funzione async — cosa che quel file dice in cima, e che ha già fatto
      danno una volta.
- [x] **M10-06** — `lib/admin-nav.ts`: la gerarchia di §5 con la voce annidata, `Figurine` che
      sparisce dal primo livello, e **`activeAdminSection` che risolve i percorsi a due segmenti** —
      con il suo test, perché è il bug per cui quel file esiste
      → `AdminSection` ha un campo `parent` in più: senza, la sidebar non saprebbe indentare e «Centro
      dati» sembrerebbe di pari grado di «Utenti». → `activeAdminSection` sceglie il **match più
      lungo**, e una sotto-pagina sconosciuta resta dentro la sezione che la contiene invece di
      spegnere la sidebar. Tre test nuovi.
- [x] **M10-07** — `/admin/listone`: l'upload, lo stato in cima (il numero grande **è** l'allarme del
      passo a mano), il blocco Caricature **con il gate** e senza campo file, il blocco Insight
      **senza gate** (§5), i due timestamp e la copertura
      → I timestamp sono **tre** e non due: al listone d'asta caricato a mano si aggiungono i due
      degli insight, che restano separati per la ragione di M8 — un pannello che ne mostrasse uno solo
      non saprebbe dire quale fonte è ferma da tre mesi. → `app/admin/figurine/page.tsx` è stata
      cancellata, non svuotata.
- [x] **M10-08** — `downloadCampionciniAction`: gli id dalla tabella invece che dal file. ⚠ I test di
      M7 su quell'azione si romperanno, e si sistemano **togliendo il file**, non allentando le
      asserzioni. Il test di M6 sull'elenco delle action deve restare verde da sé (nessuna azione nuova)
      → ⚠ **Due previsioni sbagliate, in direzioni opposte.** I test di M7 su quell'azione **non
      esistevano**: l'unico posto in cui `downloadCampionciniAction` compare nei test è l'elenco di
      M6, quindi non c'è stato niente da allentare né da togliere. E il test di M6 **si è rotto**, ma
      non per questa azione: la macro ne aggiunge una, `uploadListoneAction`, e §5 si riferiva alla
      sola modifica delle caricature. Sistemato come prescrivono M7 e M8: riga aggiunta **dopo** aver
      visto il test rompersi, insieme alla guardia in cima all'azione, e uguaglianza rimasta esatta.
      → Riscritto anche il messaggio «il file è ancora selezionato», che non era più vero.
- [x] **M10-09** — `/admin/listone/dati`: la tabella di §6, search e filtro per ruolo nel browser,
      badge di M9, `requireAppAdmin()` **anche nella pagina**
      → Mostrati tre mockup all'owner, che ha scelto la **tabella unica con testata fissa**: tutte le
      righe renderizzate, `Fuori lista` come segno accanto al nome e non come settima colonna (vuota
      per il 95% delle righe, e stringerebbe le due che si leggono davvero). → `TitolaritaBadge` e
      `SetPieceBadges` sono stati **esportati** da `components/auction/insights.tsx`: il Centro dati
      li usa in due colonne separate, quindi non gli servivano le composizioni pronte ma i due pezzi.
      È il terzo chiamante, quello che li rende un componente. → I nomi normalizzati per la ricerca si
      calcolano una volta sola con `useMemo`, non a ogni tasto.
      → ⚠ **Ripreso il 2026-08-12 a macro già mergiata su `dev`**, su richiesta dell'owner:
      intestazioni cliccabili, filtro «rigori e piazzati», e la lista che si apre ordinata per
      quotazione dal più alto al più basso. L'ordinamento è finito in `lib/centro-dati.ts` — funzioni
      pure con 15 test — perché è l'unica parte della pagina che può sbagliarsi **in silenzio**. E il
      filtro ha fatto emergere una distinzione che la spec non aveva visto: i due rank **non sono
      numeri di stagione**, quindi non passano da `showableInsights`, altrimenti il filtro perderebbe
      22 designati su 92. Il portale resta com'è (M9). Tutto in `DECISIONS.md`, 2026-08-12.
- [x] **M10-10** — Test con Postgres: un upload sostituisce l'intera tabella; **un'asta si crea e si
      gioca con `listone_players` vuota** (nessun dato di questa macro su un percorso critico); la
      copia dentro l'asta produce le **stesse righe** dell'upload dello stesso file — `fvm` e
      `out_of_list` compresi, ed è il test che protegge l'ordine dell'auto-pick; la copia **fallisce**
      se il listone non copre gli slot (I9) e l'asta resta in DRAFT; il Centro dati mostra `—` per chi
      non ha insight; un non-admin è rifiutato sull'azione di upload
      → 13 test in `tests/db/listone.test.ts`. L'asta non si limita a «giocare»: arriva a
      **`COMPLETED`** con la tabella vuota, 32 assegnazioni, in 386 ms — la stessa tecnica di
      `tests/engine/machine.test.ts` (nessuno agisce, i round scadono) ma contro Postgres. Aggiunta
      anche la **verifica 5**, che la spec metteva solo fra le verifiche a mano: un'asta preparata non
      cambia quando a sistema si carica un altro file. → ⚠ **Il file non scrive mai su
      `player_insights`**, e non è pigrizia: `tests/db/insights.test.ts` la svuota nel suo
      `beforeEach` e vitest gira i file in parallelo, quindi una riga scritta da qui potrebbe sparire
      a metà di un test di lì — o comparire in mezzo a un suo conteggio e rompere un test che non
      c'entra niente. Il `LEFT JOIN` si prova dal lato deterministico: `ext_id` sintetici che nessuna
      fonte ha. → Il rifiuto del non-admin sull'upload è coperto dall'elenco di M6, che chiama **ogni**
      azione del pannello con un utente qualunque e ne pretende il rifiuto.
- [x] **M10-11** — Gate: `pnpm test`, `pnpm typecheck`, `pnpm build` verdi (⚠ build con `pnpm dev`
      spento)
      → 643 test in 42 file. `pnpm build` dato con il dev server spento, su richiesta all'owner, e
      passata al primo tentativo: il falso allarme su `/api/auctions/[id]/stream` non si è presentato.
- [x] **M10-12** — `docs/ARCHITECTURE.md`: il capitolo sui **due listoni** e sul perché uno resta
      copiato dentro l'asta. `docs/DECISIONS.md`: la tabella globale con `fvm` tenuto pur non essendo
      mostrato, il gate solo su Caricature con le quattro ragioni, la copertura globale che resta
      informazione, il campo file delle caricature che sparisce. Più
      `docs/HOWTO-PROVA-LOCALE.md` (in locale il listone a sistema si carica una volta e serve tutte
      le prove) e `docs/features/README.md`
      → Il capitolo nuovo di `ARCHITECTURE.md` è «Il listone a sistema, e i due file che si chiamano
      allo stesso modo»; toccati anche «Il listone» del setup e «La navigazione» del pannello, che
      dicevano cose diventate false. In `HOWTO-PROVA-LOCALE.md` il §6 è stato **riscritto**: il
      listone a sistema è il primo passo, e le figurine sono diventate un suo sottoparagrafo — che è
      la stessa gerarchia del pannello.
- [x] **M10-13** — Chiusura: merge `--no-ff` su `dev`, prova in locale, poi — **solo su richiesta
      esplicita** — `CHANGELOG.md`, `package.json`, merge su `main`, tag `v1.11.0`, push. **E il
      `CHANGELOG.md` deve contenere i due passi a mano di §9 scritti per esteso**
      → Merge su `dev` fatto il 2026-08-12. ⚠ **La seconda metà del task non è di M10**: l'owner ha
      deciso che M10 esce **insieme a M10B**, con un tag solo, quindi `CHANGELOG.md`, `package.json`,
      `main` e `v1.11.0` sono passati a **M10B-16**. I passi a mano di §9 restano dovuti e vanno in
      quel changelog, prima di quelli di Carmy — l'ordine di caricamento dei due file conta.

## Com'è andata

**Le tre trappole annunciate sono state tutte evitate, e nessuna era quella che ha fatto perdere
tempo.** `fvm` e `out_of_list` sono nella tabella e nella copia, e c'è un test che confronta riga per
riga i `players` prodotti dalle due strade; nessun `JOIN` verso `listone_players` è entrato nel
motore, e l'asta arriva a `COMPLETED` con la tabella vuota. Quello che la spec aveva sbagliato sta
altrove.

**§5 diceva che il test di M6 non si sarebbe rotto, e si è rotto.** La frase era giusta nel suo
paragrafo — `downloadCampionciniAction` non cambia nome né firma nell'elenco — ma la macro
un'azione la aggiunge, `uploadListoneAction`, e nessuno l'aveva contata. Il test ha fatto
esattamente il lavoro per cui è scritto in quel modo, per la terza volta dopo M7 e M8.

**E §5 prometteva test di M7 da sistemare che non esistono.** «I test di M7 su quell'azione si
romperanno» dava per scontato che ci fossero asserzioni sul file caricato: non ce n'era nessuna —
`downloadCampionciniAction` compare nei test in un posto solo, l'elenco di M6. Le due previsioni
sbagliate sono in direzioni opposte e vengono dallo stesso errore: la spec ha immaginato la forma dei
test invece di guardarla.

**La spec non aveva previsto dove sarebbe finita la data.** §4 diceva «la funzione `when()` esiste
già in `app/admin/listone/page.tsx` e ora ha il suo secondo chiamante»: i chiamanti sono tre, e una
funzione condivisa da tre pagine dentro una pagina è il tipo di posto in cui una modifica al fuso
orario ne aggiorna uno solo. Adesso sta in `lib/when.ts`.

**Due decisioni sono state prese guardando, non deducendo**, come per i colori di M9: la forma della
proposta alla creazione (due alternative esplicite, non una casella spuntata) e il Centro dati
(tabella unica con testata fissa, `Fuori lista` come segno accanto al nome). Entrambe scelte
dall'owner su mockup, entrambe diverse dalla prima ipotesi della spec.

**Il gate su Insight non è stato messo, ed è la cosa che più assomiglia a una disobbedienza alla
richiesta.** Le quattro ragioni di §5 tengono tutte; quella che decide resta la quarta — M11 lo
smonterebbe fra una macro.

**La coda della macro ha trovato la cosa più interessante di tutte, e non era nel perimetro.**
Aggiungendo il filtro «rigori e piazzati» si è visto che `showableInsights` veniva applicato anche ai
due rank, che dalla stagione non dipendono: **22 designati su 92** sono nascosti da un gate pensato
per altro. Nel Centro dati è stato corretto; **nel portale no**, perché quello è M9 e la decisione è
dell'owner. È la dimostrazione che una spec fatta bene sposta il momento in cui si scoprono le cose,
non lo elimina: questa si è vista costruendo un filtro, cioè guardando i dati con una domanda nuova.

⚠ **E una cicatrice nei test**: gli `ext_id` sintetici partivano da 1 e collidevano con quelli veri
(che vanno da 4 a 7548). Il test del `LEFT JOIN` passava solo quando `player_insights` era vuota —
cioè quando un altro file di test l'aveva appena svuotata. Verde da solo, verde nella suite, e
sbagliato: se n'è accorto solo perché la modifica di oggi l'ha eseguito con la tabella piena. Base
spostata a `10_000_000`.

## Verifica

1. `pnpm test`, `pnpm typecheck` e `pnpm build` verdi.
2. ⚠ **La copia dal sistema e l'upload dello stesso file producono righe identiche.** Si confrontano
   le righe di `players`, `fvm` e `out_of_list` compresi: è la verifica che protegge l'ordinamento
   dell'auto-pick da una decisione di layout (§2).
3. **Un'asta si crea, si prepara e arriva a `COMPLETED` con `listone_players` vuota.** Nessun dato di
   questa macro sta su un percorso critico.
4. **Un listone che non copre gli slot di un'asta a 12 fa fallire la copia** con il messaggio di I9, e
   **l'asta resta creata in DRAFT** invece di non nascere.
5. **Un'asta preparata prima di un nuovo upload non cambia**: si copia, si ricarica in admin un file
   diverso, e le righe di quell'asta sono ancora quelle di prima. È il congelamento di `auction_id`,
   ed è la cosa che questa macro poteva rompere di peggio.
6. **La data che l'owner legge è in ora italiana**: un upload alle 23:30 non compare come del giorno
   prima.
7. **Il Centro dati trova un calciatore scrivendo tre lettere**, filtra per ruolo, e mostra `—` per
   chi ha solo i numeri della stagione precedente. Cinquecento righe non fanno scattare nessuna
   attesa percepibile.
8. **A tabella vuota la sezione è visibile e lo dice**: Caricature spento con la ragione accanto,
   Insight **attivo** e funzionante, Centro dati che dice di essere vuoto.
9. **`/admin/listone/dati` accende «Centro dati» nella sidebar**, non «Listone».
10. **Le caricature si scaricano senza caricare nessun file**, e la seconda passata non scarica niente
    — il comportamento di M7 è intatto, gli id arrivano da un altro posto.
11. **Un non-amministratore è rifiutato** sull'upload e sul Centro dati, chiamati direttamente e non
    dalla pagina.
