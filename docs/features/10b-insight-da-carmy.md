# M10B — Gli insight che vengono da un umano

> **Stato:** **chiusa su `dev`** il 2026-08-12, merge `--no-ff` da
> `feature/10b-insight-da-carmy` · ⚠ **Non ancora rilasciata**: esce con M10 in un tag solo,
> `v1.11.0`, **su richiesta esplicita dell'owner** (task M10B-16) · Spec scritta lo stesso giorno in
> una sessione di sola analisi, a valle di M10.
>
> ⚠ **Cosa è cambiato rispetto a questa spec sta in «Com'è andata», in fondo**, e sotto ogni task con
> la freccia `→`. Le tre decisioni che l'owner ha preso guardando — la forma del badge, la riga
> dell'auto-pick, dove sta il prezzo consigliato — sono in `docs/DECISIONS.md`, 2026-08-12.
>
> **Perché «10B» e non «M13».** Non è una macro nuova nella fila M11–M12: è il **refactor della
> gestione degli insight** che M10 ha reso possibile, e che si appoggia alla tabella che M10 ha
> costruito. Senza `listone_players` questa macro non ha un denominatore su cui agganciarsi (§3), e
> senza il pannello di M10 non ha un posto dove caricare il file. Va **dopo M10 e prima o dopo M11
> indifferentemente**; se M11 arriva prima, questa eredita gratis il posto in cui dire «l'ultimo
> caricamento è di tre giorni fa».
>
> **Tocca lo schema del database?** **Sì**, in modo additivo: **una tabella nuova**
> (`carmy_players`) e **una colonna** su `player_insights` — nessuna sparisce, nessun tipo cambia →
> niente `pg_dump` preventivo, ma `pnpm db:push` a mano dopo il deploy:
>
> ```bash
> cd /home/ploi/fantasta.rggndr.it && pnpm db:push
> pm2 reload deploy/ecosystem.config.cjs --update-env
> ```
>
> ⚠ **E un backfill, il terzo di fila**: la tabella nasce vuota e va riempita caricando il file da
> Admin → Listone. Finché non si fa, **niente si rompe** — le colonne di Carmy semplicemente non si
> vedono, e `/play` resta quella di v1.11.0. È lo stesso inciampo di M7, M8 e M10, con la stessa cura.
>
> **Invarianti coinvolti:** **nessuno.** I1–I10 non sono toccati: qui non si scrive niente che entri
> in una regola di gioco. **Regole coinvolte:** 3 (non violata, e §5 dice perché), 6, 7, 8.
> ⚠ **Il vincolo più facile da rompere di questa macro non è un invariante**: è che **il primo nome
> della lista di chiamata sia quello che l'auto-pick sceglierebbe** (§6).

## Obiettivo

Gli insight di M8 rispondono con dei numeri a una domanda che i numeri non sanno chiudere. Quanto
gioca un giocatore l'anno prossimo non dipende da quanto ha giocato l'anno scorso: dipende da chi lo
ha comprato, da che modulo gioca il suo allenatore nuovo, da chi gli è arrivato davanti. La sessione
del 2026-08-12 aveva provato a modellare quelle variabili — probabili formazioni, giornate di
infortunio da sottrarre, pesi diversi fra inizio e fine stagione — e si è fermata su un fatto: **il
dato per giornata non esiste in nessuna fonte pubblica**, e ricostruirlo vorrebbe dire cinquecento
richieste HTTP e una tabella da diciannovemila righe.

`fixtures/carmy.xlsx` risolve la stessa domanda per un'altra strada: **un umano ha già fatto quella
ponderazione**, giocatore per giocatore, e l'ha messa in tre colonne su una scala da 1 a 5.

Il tema, in una riga: *smettere di dedurre la titolarità e cominciare a leggerla, senza smettere di
mostrare il numero che la rende verificabile.*

## Richieste che ci confluiscono

Arrivano dalla conversazione del 2026-08-12, non da `docs/REQUESTS.md` — il quaderno resta vuoto.

- «Vorrei migliorare la gestione della titolarità: probabili formazioni e ballottaggi, rimuovere le
  giornate di infortunio dal calcolo, prendere come riferimento tutto l'anno scorso ma ponderare
  inizio contro fine stagione, e se nelle probabili un calciatore è dato titolare che incida parecchio
  rispetto all'anno precedente — nuovo arrivo, cambio di ruolo, di modulo, allenatore.»
- «In fixtures ho caricato Carmy. Potremmo rivedere l'intera gestione degli insight con questo foglio.
  Si scarica il listone da fantacalcio.it come ora, poi carico il file Carmy, poi scarichiamo le
  caricature. Gli insight si popolano in automatico con il file di Carmy.»
- «Le nuove colonne che mette Carmy voglio poterle vedere sia nel listone che nella pagina `/play`
  dove ho le info dei giocatori. E fra i filtri della selezione del calciatore da chiamare, gli
  `is_pro` devono poter filtrare anche per i valori di Carmy.»

**Tre decisioni dell'owner del 2026-08-12**, date in risposta alle tre domande della sessione:

- **La titolarità è quella di Carmy.** Si smette di dedurla da `starts_eleven / 38` (§4).
- **La soglia del verde è `>= 4`** sulla scala 1–5. ⚠ Colora un nome su tre: la misura, e la regola
  di M9 che tocca, sono in §4.
- **Il prezzo consigliato si scrive**, e come gestirlo lo decide l'owner guardandolo (§6).
- **Il file si ricarica circa una volta al giorno**, quando serve.
- **La provenienza non è un problema**: il file lo vedono solo gli `is_pro`.

---

## Spec

### 1. Cosa Carmy è — e soprattutto cosa non è

Da leggere prima del resto, perché tutta la macro dipende da questa misura. Fatta sui byte veri di
`fixtures/carmy.xlsx` il 2026-08-12, agganciando **sul nome contro la fonte A: 497 su 497, il 100%**,
zero omonimi.

**Undici colonne su quindici sono identiche, byte per byte, a quelle che già importiamo:**

| Colonna Carmy | Campo della fonte A | Uguali |
|---|---|---|
| `Presenze`, `Pt. Tit.`, `Minuti`, `Quo` | `presenze`, `starts_eleven`, `min_playing_time`, `quotazione` | **497/497** |
| `Assist`, `Ammonizioni`, `Espulsioni` | `assist`, `amm`, `esp` | **497/497** |
| `Rig. Segnati`, `Rig. Sbagliati`, `Rig. Parati`, `Gol Subiti` | idem | **497/497** |
| `MV`, `FMV` | `display_mv`, `display_fmv` | 438/497 (88%) — le differenze sono `0` dove la fonte ha un numero |
| `Gol` | `gol_fatti` | 461/497 (93%) |

**Quindi Carmy non porta nessuna statistica nuova.** Porta gli stessi numeri, ri-esportati.

⚠ **E in particolare `Pt. Inf.` non è «partite saltate per infortunio», malgrado il nome.** È
identica al campo `injured` della fonte A — 497/497 — va da 0 a 5 (351 giocatori a 0, uno solo a 5), e
`Presenze + Pt. Inf.` non converge a 38 (media 33,6 su 157 titolari, con un massimo di 42 perché le
presenze sommano più competizioni). È il **conteggio di episodi** che M8 §9 aveva già scartato, e la
sua etichetta afferma qualcosa che i dati non sostengono. **Il punto «togliere le giornate di
infortunio dal calcolo» resta senza dato**, e questa colonna sembra risolverlo senza risolverlo: è la
trappola numero uno del file. Se un giorno servisse davvero, la si chiede a chi compila il foglio —
non la si deduce dal nome della colonna.

**Quello che invece porta è un giudizio, e non ce l'ha nessuna fonte:**

| Colonna | Copertura | Cos'è |
|---|---|---|
| **`Titolarità`** | 497/497 | 1–5. Distribuzione: 1→75, 2→94, 3→159, 4→65, 5→103 |
| **`Affidabilità`** | 497/497 | 1–5. Concentrata: 3→254, 4→179 |
| **`Integrità`** | 497/497 | 1–5, la tenuta fisica. 1→37, 5→121 |
| **`Fascia`** | 497/497 | Top (26), Semi-Top (44), Terza (52), Quarta (58), Scomm. (80), Outsider (111), Non Impostata (84), Titolare «Scarso» (42) |
| **`Prezzo`** e **`PMA`** | 497/497 | Il prezzo consigliato, e la stessa cifra come percentuale del budget |
| **`FMV Exp.`** | 494/497 | La fantamedia attesa |
| **`Nota 1`…`Nota 5`** | 396 ne hanno almeno una | 17 etichette: `bonus` (118), `titolarissimo` (106), `scommessa` (105), `rischio infortuni` (96), `subentrante` (88), `modificatore` (82), `costante` (80), `cartellini` (67), `incostante` (44), `tanti gol` (39), `assistman` (25), `rigorista` (18), `tiratore` (11), `imbattibilità` (8), `pararigori` (6), `Coppa Africa` (1), `jolly` (1) |
| **`Commento`** | 10 | Testo libero. Fra questi, gli abbinamenti portieri che M8 §9 aveva rinviato a una macro sua: *«ABBIN a 2: FIO-CAG, FIO-GEN, FIO-UDI»* |

### 2. La prova che il giudizio non è la statistica travestita

È la misura che giustifica l'intera macro, e senza di lei tutto il resto sarebbe una preferenza.

**La correlazione fra `Titolarità` e la quota titolare dell'anno scorso (`Pt. Tit. / 38`) è 0,650**,
su 466 giocatori confrontabili. Correlata — un titolare dell'anno scorso tende a restarlo — ma
lontanissima dall'essere una riscrittura. E i disaccordi sono **esattamente** i casi che la richiesta
voleva modellare:

- **Giudicati titolari (4–5) con al più 10 partite da titolare**: 11 giocatori. Dovbyk al Bologna
  (`tit=5`, `pt=3`), Kouadio (`tit=5`, `pt=0`), Fazzini al Cagliari (`tit=5`, `pt=5`), Raspadori
  all'Atalanta (`tit=4`, `pt=7`), Dragusin e Jimenez alla Fiorentina.
- **Giudicati panchinari (1–2) con almeno 25 partite da titolare**: 13 giocatori. Stankovic A.
  all'Inter (`tit=2`, `pt=34`), Halhal (`tit=2`, `pt=32`), Abankwah (`tit=1`, `pt=30`).

Nuovo arrivo, cambio di modulo, cambio di allenatore, gerarchia nuova. **La ponderazione che la
sessione voleva costruire con un modello è già una colonna**, e non ha bisogno di essere difesa —
solo attribuita.

### 3. Il join, che è la parte fragile

⚠ **Carmy non ha `ext_id`.** Ha `Nome` e `Team`, e il `Team` è una sigla di tre lettere (`ROM`,
`INT`) mentre il listone scrive il nome per esteso (`Roma`, `Inter`). Le venti squadre coincidono.

Misure:

- Aggancio su `(Nome, Squadra)` senza mappa delle sigle: **0%**. È solo il formato, ma è il genere di
  zero che fa sospettare il file invece della mappa.
- Aggancio **sul solo nome** contro `fixtures/listone.xlsx`: **487/497 = 98,0%**, e ⚠ **zero nomi
  ripetuti nel listone**, quindi il nome è una chiave non ambigua. I 10 mancanti sono acquisti che
  nel listone del 6 agosto non c'erano ancora (Mastantuono, Chalobah T., Kevin Carlos…).
- Aggancio sul solo nome contro la fonte A: **497/497 = 100%**.

**La decisione: si aggancia a `listone_players` per nome, normalizzato.** È la tabella di M10, ed è
il denominatore giusto per la stessa ragione per cui lo è nel Centro dati — il listone è la lista di
chi si può comprare, e un giudizio su qualcuno che non è nel listone non serve a nessuno. Il `Team`
non è la chiave ma **il controllo**: si confronta via mappa sigla → squadra, e una discordanza si
segnala per nome invece di essere ingoiata (è un trasferimento, o un omonimo che il listone non
aveva).

⚠ **La mappa sigla → squadra va rigenerata a ogni promozione**, ed è la stessa nota che M8 §9 aveva
scritto per la griglia portieri. Si tiene in `lib/domain.ts` con le venti righe scritte in chiaro:
venti righe che qualcuno rilegge ad agosto sono più oneste di un algoritmo di somiglianza che
sbaglia in silenzio.

**Sotto una soglia di aggancio, l'import rifiuta e non scrive niente.** Proposta: **90%**, contro il
98,0% misurato. E qui c'è una differenza importante rispetto a M8, che va scritta perché è
controintuitiva: quel controllo là era **avvelenabile** — la copertura si misurava contro il listone
di un'asta, e un'asta simulata con `ext_id` sintetici la portava a zero su dati perfetti. **Qui il
denominatore è `listone_players`, che è globale e non appartiene a nessuna asta**: nessuna
simulazione lo può inquinare. La soglia di aggancio è quindi una guardia **sana**, e non rimette in
piedi il controllo che M8 aveva smontato. La continuità all'85% degli insight resta dov'è e non si
tocca.

I nomi non agganciati **si dicono**, come `unknown` in `refreshSetPieces`: dieci nomi in fondo alla
pagina sono l'unico modo di accorgersi che il foglio e il listone hanno cominciato a divergere.

### 4. La titolarità passa a Carmy — e cosa succede a M9

Decisione dell'owner. `Titolarità` 1–5 diventa **la** titolarità dell'applicazione.

Le conseguenze vanno dette per esteso, perché toccano la parte più visibile di M9:

- `quotaTitolare`, `SOGLIA_TITOLARE` (l'80%), `titolareForte` e il badge verde sono costruiti su
  `starts_eleven / GIORNATE`. La soglia del verde si sposta sulla scala di Carmy.
- Il rapporto grezzo **`31/38` non si perde**: resta accanto, in grigio, ed è ciò che rende il
  giudizio verificabile. Un `5/5` da solo è un'affermazione che nessuno può controllare; `5/5` accanto
  a `31/38` è un'affermazione con la sua prova, e quando i due divergono — Dovbyk `5/5` con `3/38` —
  **quella divergenza è l'informazione più preziosa della riga**.
- ⚠ **Senza il file caricato, la titolarità di Carmy non esiste.** Il comportamento deve essere
  dichiarato, non subito: si torna al badge di M9 calcolato dalle presenze. Due regole per la stessa
  cosa sono esattamente ciò che `showableInsights` era stato scritto per evitare, quindi **la scelta
  fra le due sta in un posto solo**, in `lib/domain.ts`, con il suo test.

**La soglia del verde è `Titolarità >= 4`** (owner, 2026-08-12).

⚠ **E va scritta con accanto la sua misura, perché tocca una regola che M9 aveva messo per
iscritto.** Contata sul file vero:

| Soglia | Verdi sul listone | In una lista di chiamata da 40 nomi |
|---|---|---|
| **`>= 4`** — la scelta | **168/497 = 33,8%** | ~9 portieri, ~15 difensori, ~13 centrocampisti, ~14 attaccanti |
| `>= 5` | 103/497 = 20,7% | ~6 · ~10 · ~9 · ~7 |
| M9 oggi, l'80% sulle presenze | 61/497 = 12,3% (sui soli mostrabili) | ~5 |

M9 §1 aveva scritto, contando: *«A 70% sarebbero 101, cioè un nome su cinque, che è il punto in cui
un colore smette di essere un segnale e diventa decorazione»*. Con `>= 4` si colora **un nome su
tre**, cioè oltre quella linea; `>= 5` cade esattamente su di essa. **La scelta resta `>= 4`, perché
è dell'owner** — ma va guardata sulla pagina di prova con quaranta nomi veri sotto, che è il posto in
cui «uno su tre» smette di essere una percentuale e diventa una schermata. Se lì risultasse troppo,
la riga da cambiare è una sola e la sua misura è già qui.

⚠ **La forma del badge resta invece da guardare, non da dedurre**: «Titolare 4/5», «Titolarissimo»,
il numero e basta. Cambia ciò che dodici persone leggono sul telefono mentre offrono, ed è la stessa
scelta che l'owner ha fatto per i colori di M9 il 2026-08-12 — guardandoli.

**`Affidabilità` e `Integrità` non entrano nel badge.** Sono la stessa scala e lo stesso posto, e tre
numeri da 1 a 5 accanto a un countdown sono tre numeri che non vengono letti — è la regola di M9 §4
(«tre informazioni, non dieci»). Vivono nel Centro dati e nel modale d'offerta, dove si decide con
qualche secondo in più.

### 5. Lo schema, e perché una tabella nuova invece di tre colonne

```ts
export const carmyPlayers = pgTable("carmy_players", {
  extId: integer("ext_id").primaryKey(),
  /** Il nome come lo scrive Carmy: serve a spiegare un aggancio, non ad agganciare. */
  sourceName: text("source_name").notNull(),
  fascia: text("fascia"),
  prezzo: integer("prezzo"),
  titolarita: integer("titolarita"),
  affidabilita: integer("affidabilita"),
  integrita: integer("integrita"),
  fmvExp: real("fmv_exp"),
  /** Le cinque note, già ripulite e senza i vuoti. */
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  commento: text("commento"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull(),
});
```

**Perché non tre colonne su `player_insights`**, che pure ospita già due fonti diverse: perché quelle
due si aggiornano **per colonna con un `upsert`**, mentre questa si sostituisce **per intero** a ogni
caricamento, come `listone_players`. Mescolarle vorrebbe dire che il refresh giornaliero di M11 e
l'upload di un file umano scrivono nella stessa riga con due semantiche diverse — ed è il punto in cui
qualcuno, fra sei mesi, cancellerà i giudizi con una `GET`.

⚠ **Una colonna su `player_insights` serve comunque**: `name`, il nome **corto** della fonte A. Oggi
salviamo solo `full_name` («James Abankwah»), mentre Carmy e il listone scrivono `Abankwah`. Non è
indispensabile al join scelto in §3 — che passa da `listone_players` — ma è ciò che permette di
diagnosticare un aggancio mancato senza riaprire il `.json` a mano.

**Il file non si conserva** (P6), come tutti gli altri.

### 6. Dove si vede — e l'unica cosa che non deve rompersi

**Il Centro dati** (`/admin/listone/dati`). Colonne nuove: `Fascia`, `Titolarità`, `Affidabilità`,
`Integrità`, `Prezzo`, e i tag. Le intestazioni ordinano già (M10, coda): le nuove entrano nello
stesso meccanismo, con la stessa regola — chi non ha il valore va in fondo in entrambe le direzioni.
Il filtro «rigori e piazzati» ha un fratello: i tag di Carmy.

**Il portale, `/play`.** Due posti, che sono i due di M8 §7 e non tre:

- **La lista di chiamata**: la riga di `InsightsLine` guadagna la titolarità di Carmy e, al più, un
  tag. ⚠ La riga è già larga quanto un telefono.
- **Il modale d'offerta**: `InsightsMacro` è il posto dove ci sono i secondi per leggere. Qui vanno
  `Fascia`, `Prezzo` consigliato, `Affidabilità`, `Integrità` e i tag per esteso.

⚠ **Il prezzo consigliato accanto al campo dell'offerta si scrive** (owner, 2026-08-12: «scrivila
comunque, poi io decido come gestirla»). Resta la cosa più delicata della macro, e la ragione va
lasciata scritta perché la decisione su *come* gestirla arriva dopo, guardandola: **una cifra
suggerita accanto a una cifra da digitare è un suggerimento che qualcuno segue senza pensarci** — e a
differenza di ogni altro numero di questa macro non descrive un giocatore, propone un'azione. Il che
significa anche che, se otto persone su otto hanno il file, il prezzo consigliato **smette di essere
un vantaggio informativo e diventa un prezzo di listino**: l'asta converge lì, e la contesa che rende
interessante la serata si sposta sui pochi nomi in cui qualcuno decide di scostarsene.

Quindi si scrive, e si scrive **in modo da poter essere spostato o spento senza rifare niente**: un
componente suo, un posto solo da cui si decide se e dove compare. Le tre forme fra cui si sceglierà
guardando — accanto al campo, sotto le macro insieme agli altri giudizi, oppure dietro un tocco — non
devono costare tre riscritture.

**I filtri della chiamata, solo per `is_pro`.** Sopra la lista, accanto alla ricerca che c'è già:
filtro per **fascia**, per **titolarità minima**, e per **tag**. La forma esatta va guardata — è
l'unica UI di questa macro che si usa **sotto un countdown di trenta secondi, con un pollice**, e la
densità decide tutto.

> ⚠ **E qui c'è il vincolo più facile da rompere di tutta la macro.**
>
> La lista di chiamata è ordinata `fvm DESC, quot DESC`, che **non è cosmetica**: è l'ordine esatto
> dell'auto-pick, e il commento di `pick-panel.tsx` lo dice — *«il primo nome della lista è quello che
> il timer sceglierebbe al posto tuo, e saperlo cambia la fretta con cui si guarda il countdown»*.
>
> **Un filtro cambia quali righe si vedono, ma non cambia di una virgola chi l'auto-pick sceglie**:
> quello pesca dal pool intero, in `machine.ts`, e di Carmy non sa niente. Con un filtro acceso, il
> primo nome della lista **non è più** quello che il timer prenderebbe — e chi ha imparato a fidarsi
> di quella riga si ritroverebbe comprato qualcun altro allo scadere.
>
> Va risolto **nell'interfaccia e in modo esplicito**, non con un commento nel codice. Le due strade:
> dire in una riga quale giocatore prenderebbe il timer, sempre, filtro o no; oppure tenere quella
> riga fissa in cima anche quando il filtro la escluderebbe. **Da scegliere guardando.** Quello che
> non si può fare è lasciare che la lista continui a sembrare l'ordine dell'auto-pick quando non lo è.

⚠ **E la regola 3 non è in discussione**: i dati di Carmy viaggiano su `listPickPool`, che è la
lettura del listone e non passa da `serializeSnapshot` — è già così per gli insight di M8, ed è
documentato lì perché il pool non è stato di gioco. Nessuna offerta, nessun credito, niente da
sanificare.

### 7. Chi li vede, e la regola che non si allenta

`canSeeInsights` decide **una query, non un `className`** (M8 §6). I dati di Carmy seguono la stessa
strada senza nessuna eccezione: la chiave `carmy` su `PoolPlayer` è **assente** per chi non ha il
permesso — non `null` — perché quel tipo finisce nel payload RSC di un client component, cioè nel
browser, leggibile in tre click. **I filtri per `is_pro` non sono la protezione**: sono l'interfaccia
sopra un dato che a chi non è pro non arriva affatto. Se un giorno il filtro si vedesse e i dati non
ci fossero, il bug è nella query.

⚠ Nel **Centro dati** invece `canSeeInsights` continua a non entrare: la pagina è dietro
`requireAppAdmin()`, e un amministratore li vede per costruzione (M10 §6).

### 8. Il caricamento, e il rapporto con M11

Il file si carica da **Admin → Listone**, sotto quello del listone, **circa una volta al giorno**
(owner). L'ordine è quello che l'owner ha descritto e non è arbitrario: **listone → Carmy →
caricature**. Il listone è il denominatore del join (§3) e la sorgente degli `ext_id` delle figurine,
quindi è il primo di necessità, non per abitudine.

⚠ **M11 non lo può automatizzare, e nessuno ci provi.** M11 aggiorna le due fonti pubbliche; questo è
un file che una persona compila e che arriva da fuori. Quello che M11 *può* dare è il posto dove dire
da quanto non lo si ricarica — e con un file che invecchia in un giorno, **la data di ultimo
caricamento conta più che per il listone**: `uploadedAt` va accanto agli altri tre timestamp del
pannello, e va detto quando è vecchio di più di un giorno.

### 9. Cosa questa macro non fa

- **Non tocca `machine.ts`, `rules.ts`, `snapshot.ts`, il lock, il ledger, lo scheduler.** Se un task
  sfiora uno di questi, il task è fuori posto.
- **Non cambia l'auto-pick.** Né l'indice, né l'ordine, né i criteri. I filtri sono una lente sulla
  lista, non una modifica del motore (§6).
- **Non sostituisce le due fonti di M8.** La fonte A porta gli stessi numeri **e si aggiorna da sé**;
  la fonte B porta la **gerarchia** dei rigoristi, che Carmy non ha — 18 tag `rigorista` contro 92
  designati con la posizione, e la posizione *è* l'informazione (M9). Carmy è una **terza fonte
  sovrapposta**, non un rimpiazzo.
- **Non prova a ricostruire le giornate di infortunio** (§1): il dato non c'è, e `Pt. Inf.` non è
  quello che sembra.
- **Non tocca le probabili formazioni.** ⚠ Vanno però conservate qui, perché la misura è stata fatta
  e costa ritrovarla: il 2026-08-12 `fantacalcio.it/probabili-formazioni-serie-a` è **piena** — 20
  moduli, **220 titolari tutti con `ext_id` e con la percentuale** (90% su 116, 85% su 19, 80% su 34,
  75% su 16, 70% su 35), 22 infortunati e 5 ballottaggi con la prosa e la data di rientro. **100% di
  aggancio** con i nostri `ext_id`. Corregge M8 §9, che l'aveva misurata vuota l'11 agosto, e rende
  inutile l'endpoint sotto login: **le percentuali di ballottaggio sono pubbliche**. Resta fuori da
  questa macro perché Carmy risponde alla stessa domanda con un caricamento invece che con un parser
  e uno scheduler — ma il giorno in cui il foglio non arrivasse, questa è la strada, ed è misurata.
- **Non aggiunge eccezioni all'allowlist ESLint**: la tabella si legge e si scrive da
  `lib/engine/carmy.ts`, e `lib/engine/**` è già dentro.
- **Non conserva il file** (P6).

### 10. ⚠ Il rilascio non finisce col merge

1. `pnpm db:push` + `pm2 reload deploy/ecosystem.config.cjs --update-env` (in testa a questo file,
   per esteso — un comando abbreviato viene copiato com'è, `…` compresi).
2. **La tabella nasce vuota**, e va riempita caricando il file da Admin → Listone. Finché non si fa,
   le colonne di Carmy non compaiono da nessuna parte e `/play` è quella di v1.11.0. **Niente si
   rompe** — ed è precisamente ciò che rende il passo facile da dimenticare. Quarto di fila.

---

## Task

> Da rifinire all'apertura della macro. Sono la traduzione della spec, non un impegno preso nella
> sessione in cui è stata scritta.

- [x] **M10B-01** — Aprire `feature/10b-insight-da-carmy` da `dev`; rileggere questo file, e in
      particolare §1 (Carmy non porta statistiche nuove, e `Pt. Inf.` non è ciò che sembra), §3 (il
      join per nome) e il riquadro di §6 (l'auto-pick). `pnpm test` verde **prima** di toccare
      qualcosa: i test di M9 su `quotaTitolare` si romperanno, e va saputo perché
      → 659 test su 43 file verdi prima di toccare qualsiasi cosa.
- [x] **M10B-02** — Rifare la misura di §1 e §2 sui byte del giorno in cui la macro si apre, e
      **salvare il file in `fixtures/`**: se le colonne sono cambiate, la spec va corretta prima di
      scrivere il parser, non dopo (è il metodo di M8-02)
      → **La spec regge quasi per intero**, e i numeri che la giustificano sono confermati sui byte
      del 2026-08-12: quattro fogli `P`/`D`/`C`/`A` con 59+176+174+88 = **497 righe**, aggancio sul
      solo nome **497/497 contro la fonte A** e **487/497 = 98,0% contro `listone.xlsx`** con **zero
      omonimi** in entrambi, **0/497** su `(Nome, Squadra)` senza mappa delle sigle, 20 sigle contro
      20 squadre, `Pt. Inf.` **identica a `injured` 497/497** (0–5, 351 a zero, uno a 5, e
      `Presenze + Pt. Inf.` che non converge a 38: max 42), correlazione `Titolarità` × `Pt. Tit./38`
      **0,649** su **466** confrontabili, **11** giudicati titolari con ≤10 partite da titolare e
      **13** panchinari con ≥25, `>= 4` che colora **168/497 = 33,8%**, `>= 5` **103/497 = 20,7%**,
      M9 oggi **61** verdi su 329 mostrabili. Fasce, tag (17 etichette, 396 giocatori) e commenti
      (10) coincidono riga per riga con §1. **Cinque scarti, tutti corretti prima del parser:**
      → ⚠ **1. Lo `0` esiste, e la spec dice «1–5».** Un giocatore — **Aurelio (CAG)**, che è anche
      uno dei dieci non agganciati — ha `Titolarità`, `Affidabilità`, `Integrità`, `Prezzo` e `MV`
      tutti a `0`, `PMA` a `"0%"` e `FMV Exp.` vuota: è una **riga non compilata**, non un giudizio
      basso. Da qui la regola del parser: **`0` su un giudizio è `null`, non un voto** (ed è ciò che
      spiega il «1→75, 2→94, 3→159, 4→65, 5→103» di §1, che somma 496 e non 497). Lo stesso `0`
      spiega perché §2 contava 13 panchinari «1–2»: dodici più Aurelio.
      → ⚠ **2. `Prezzo = 0` su 73 giocatori**, il 15% del file — riserve e terzi portieri, quasi
      tutti di fascia `Non Impostata` o `Outsider`, tutti con `PMA` a `"0%"`. Non è un prezzo: **zero
      non è nemmeno un'offerta valida**. Trattato come assente, e detto in `DECISIONS.md` perché è
      una scelta e non un dettaglio del parser.
      → **3. Carmy non riporta i `display_*`, riporta i campi grezzi della fonte A.** `Presenze` è
      identica a `presenze` **497/497** ma a `display_presenze` — quella che **noi** importiamo — solo
      465/497; `MV`/`FMV` stanno a 438/497 contro `display_mv`/`display_fmv`. La conclusione di §1 non
      si indebolisce, si rafforza: Carmy ri-esporta gli stessi numeri, e per due colonne su quindici
      ri-esporta perfino la variante che la fonte stessa **non** mostra.
      → **4. Due colonne che §1 non cita**: `Ruolo` (ridondante col nome del foglio — 0 discordanze su
      497, quindi si ignora) e `Obiett.`, valorizzata `Sí` su **tre** giocatori (McTominay, Baturina,
      Rowe). È la lista della spesa di chi compila il foglio, non un giudizio sul giocatore: **non si
      importa**, e il motivo va scritto perché è la colonna che qualcuno vorrà aggiungere.
      → **5. `PMA` è una stringa** (`"10.5%"`), non un numero, e `Commento` è **multi-riga**. Nessuna
      delle due entra nello schema di §5: `PMA` è `Prezzo` diviso il budget, cioè un dato derivato.
      → Il file era già in `fixtures/carmy.xlsx` (74 KB) e non è stato toccato.
- [x] **M10B-03** — `lib/db/schema.ts`: `carmy_players` come in §5, più `name` su `player_insights`.
      `pnpm db:push` in locale
      → Fatto come da §5, con **una colonna in più non prevista**: `source_team`, la sigla di tre
      lettere. §5 aveva `source_name` «per spiegare un aggancio», ma il controllo della squadra ha
      bisogno di ricordare *cosa* diceva il foglio, non solo di confrontarlo una volta al
      caricamento. Il `db:push` in locale è additivo e pulito: una `CREATE TABLE` e una
      `ADD COLUMN`, nessun `ALTER` distruttivo.
      → **`name` su `player_insights` ha richiesto anche chi la riempie**, che la spec non diceva:
      `parseFantalabListone` leggeva `full_name ?? name` e buttava il nome corto. Ora lo porta, e
      l'`upsert` di `refreshListoneInsights` lo scrive. Nasce `null` sulle righe già in tabella e si
      riempie al primo refresh: **nessun backfill dedicato**, perché nessuna schermata la pretende.
- [x] **M10B-04** — `lib/import/parseCarmy.ts`, **puro**: bytes → `Result<CarmyRow[]>`. Quattro fogli,
      le note compattate in un array, e un rifiuto forte se le intestazioni cambiano. Con la sua
      fixture e i suoi test, senza database
      → 30 test in `tests/parse-carmy.test.ts`, con i numeri **esatti** del 2026-08-12 dentro. I
      quattro fogli si chiamano `P`/`D`/`C`/`A`, cioè **esattamente `ROLES`**: il ruolo si prende dal
      nome del foglio e la colonna `Ruolo` si butta (0 discordanze su 497).
      → **Il rifiuto forte è su tre cose e non su una**: intestazioni mancanti (note e commento
      compresi — se sparissero, i tag sparirebbero in silenzio), un voto **fuori dalla scala 1–5**
      perché una scala cambiata letta come se non lo fosse è un badge verde su un giocatore
      qualsiasi, e **due righe con lo stesso nome**, perché il nome *è* la chiave del join.
      → ⚠ **Un rifiuto in meno di quelli sperati**: `XLSX.read` **non lancia** su del testo qualsiasi
      — lo legge come un foglio unico chiamato `Sheet1` — quindi dei byte spazzatura escono come
      `CARMY_SHEET_MISSING` e non `CARMY_UNREADABLE`. È la stessa cosa che `parse-listone.test.ts`
      aveva già scoperto, e il test accetta entrambi i codici per la stessa ragione. Un
      `CARMY_UNREADABLE` vero si ottiene solo con un archivio zip cifrato, e c'è il suo test.
- [x] **M10B-05** — La mappa sigla → squadra in `lib/domain.ts`, venti righe in chiaro, con il test
      che verifica che copra tutte le squadre del listone caricato
      → Venti righe, e **due** test invece di uno: quello puro contro `fixtures/listone.xlsx` (le
      sigle del foglio si traducono **esattamente** nelle venti squadre del listone, insieme) e
      quello con Postgres contro il listone caricato, come chiedeva il task.
      → Accanto è finito il resto del vocabolario, che la spec non elencava ma che serviva a non
      spargere decisioni nei componenti: `normalizeCarmyName` (la chiave del join), `CARMY_FASCE`
      con `carmyFasciaRank`, `CarmyJudgement`, `CARMY_SCALA_MAX`, `SOGLIA_TITOLARE_CARMY`.
      → **L'ordine delle fasce non è stato inventato: è quello del foglio.** Tutti e quattro i fogli
      raggruppano le righe nella stessa sequenza (`Top > Semi-Top > Terza > Quarta > Scomm. >
      Titolare "Scarso" > Outsider`) e la mediana del `Prezzo` la conferma (47 → 26 → 13 → 3 → 2 → 1
      → 1). L'unico punto in cui serviva indovinare — `Titolare "Scarso"` contro `Outsider`, stessa
      mediana — è risolto tenendo l'ordine del file, che è l'unica fonte che ne sa qualcosa.
- [x] **M10B-06** — `lib/engine/carmy.ts`: l'upload (join per nome su `listone_players`, soglia di
      aggancio al 90%, sostituzione integrale in transazione), lo stato per il pannello, e i nomi non
      agganciati riportati per nome. **Nessuna eccezione nuova all'allowlist ESLint**
      → Nessuna eccezione aggiunta: `lib/engine/**` era già dentro, e `eslint.config.mjs` non è
      stato toccato. Sui byte veri: **487/497 scritti**, i dieci nomi detti per nome, le **tre**
      discordanze di squadra segnalate (Dominguez B., Masini, Maldini — tutti e tre trasferimenti
      veri, e il giudizio si importa comunque).
      → **Un rifiuto in più di quelli previsti**, e serviva: `CARMY_NO_LISTONE`. Senza listone la
      soglia di aggancio sarebbe una divisione per zero, e il messaggio dice **cosa fare** invece di
      lasciar scrivere zero righe dichiarando successo. È anche il gate del pulsante nel pannello.
      → `carmyStatus` prende `now` come parametro invece di leggerlo: l'avviso «questo file è di
      ieri» è la regola 2 applicata fuori dal motore puro, e senza quel parametro non sarebbe
      provabile. La soglia dentro il `count(... filter ...)` arriva da `lib/domain.ts` e **non** è
      un `4` scritto in SQL, altrimenti il pannello direbbe «168 titolari» mentre la pagina ne
      colora altri.
- [x] **M10B-07** — `lib/domain.ts`: la titolarità che viene da Carmy, con il ripiego su M9 quando il
      file non c'è, **in un posto solo** e con il suo test (§4). La soglia del verde è **`>= 4`**
      (owner), e il test la contiene con la sua misura accanto — 168/497, come `SOGLIA_TITOLARE` ha
      la sua. ⚠ La **forma** del badge la sceglie l'owner guardandola: prima una pagina di prova,
      poi il codice
      → `titolarita(insights, carmy)` restituisce una **unione discriminata** — `{fonte: "carmy"}`
      oppure `{fonte: "presenze"}`, mai un misto — e i tre chiamanti non sanno quale vince. 14 test
      in `tests/carmy-domain.test.ts`, con Dovbyk e Stankovic A. dentro col loro nome.
      → ⚠ **La spec sbagliava una previsione, e il task M10B-01 con lei**: «i test di M9 su
      `quotaTitolare` si romperanno». **Non si è rotto niente** (659 verdi prima, 659 dopo), perché
      il ripiego *è* il codice di M9 lasciato intatto — `quotaTitolare`, `titolareForte` e
      `SOGLIA_TITOLARE` non sono stati toccati. Portare la titolarità su Carmy è stato **additivo**.
      → **Un componente in meno, non uno in più.** `TitolaritaBadge` di M9 **non esiste più**: al suo
      posto c'è `TitolaritaAnyBadge`, che prende le due chiavi. Tenerne due voleva dire che ogni
      chiamante decideva quale disegnare, cioè tre copie della regola che `titolarita()` esiste per
      centralizzare — e la prima stesura l'aveva fatto davvero, duplicando la resa del badge di M9
      in due punti.
      → **La pagina di prova è esistita e poi è stata cancellata**, come quella dei colori di M9:
      `/admin/listone/prova` con quaranta difensori veri e gli interruttori per confrontare le
      forme. Di lei nel codice resta solo la costante con la scelta dentro. ⚠ Dopo averla cancellata
      `pnpm typecheck` è rimasto rosso su dei tipi generati in `.next/types` per una pagina che non
      c'era più: si cancella quella cartella, non è codice.
      → **La scelta dell'owner è `parola`** — «Titolarissimo» / «Titolare» — e **non** era la
      proposta. Ha comportato due cose che vanno lette insieme a lei, ed entrambe sono nel commento
      di `FORMA_TITOLARITA`: (1) sotto soglia la parola **non si inventa** — il foglio dice «3 su
      5», non «panchinaro» — quindi quei badge portano la scala, `Titolarità 3/5`; (2) il tag
      `titolarissimo`, che il foglio scrive su **106 giocatori**, **sparisce dalla riga** quando il
      badge lo dice già, altrimenti la stessa parola comparirebbe due volte sulla stessa riga di un
      telefono — una verde e una grigia — rubando il posto al secondo tag.
- [x] **M10B-08** — Il pannello: il caricamento sotto quello del listone, il quarto timestamp, e
      l'avviso quando il file è vecchio di più di un giorno (§8)
      → Tutto come da §8. Il pulsante è **spento finché il listone non c'è**, e questo è un gate
      *vero* — a differenza di quello che M10 §5 aveva scelto di non mettere sugli insight: qui il
      caricamento fallirebbe davvero, quindi un pulsante attivo sarebbe la bugia.
      → I nomi non agganciati e le discordanze di squadra si dicono **in due frasi separate** nel
      messaggio di successo, perché sono due cose diverse: un aggancio mancato è un file vecchio, una
      discordanza è un trasferimento.
- [x] **M10B-09** — Il Centro dati: le colonne nuove, ordinabili con la regola di M10, e il filtro
      per tag
      → Cinque colonne nuove (`Fascia`, `Consigl.`, `Affid.`, `Integr.`, `Note`) più il filtro per
      tag su una riga sua, letto **dai dati** e non da un elenco scritto a mano.
      → ⚠ **Una decisione che §6 non aveva previsto: `Titolarità` è una colonna sola, non due.** §6
      la elencava fra le «colonne nuove», ma il Centro dati ne aveva già una. Due colonne che dicono
      la stessa cosa con due scale sono due colonne che nessuno confronta, quindi è una: il badge di
      Carmy quando c'è, quello delle presenze quando non c'è, e il rapporto grezzo in grigio
      accanto. Ordinarla ha richiesto una scelta scritta in `valueOf`: i due valori si riportano a
      0–1 (`voto / 5` da un lato, `quotaTitolare` dall'altro) perché rispondono alla stessa domanda.
      → Il filtro per tag è **uno per volta e non un elenco**: un elenco pone subito la domanda
      «tutti o almeno uno?», cioè due significati per lo stesso controllo.
- [x] **M10B-10** — `listPickPool`: la chiave `carmy` **assente** per chi non è pro, come `insights`
      (§7). Il test è quello di M8: si asserisce l'assenza della chiave, non il suo valore
      → Fatto con lo **stesso** `canSeeInsights`, senza nessun permesso nuovo. Le due letture vanno
      in `Promise.all` e le due chiavi si aggiungono **una per una**: un giocatore giudicato da Carmy
      ma senza riga di insight arriva con `carmy` e senza `insights`, ed è il caso vero dei dieci
      nomi che il listone non aveva.
- [x] **M10B-11** — Il portale: `InsightsLine` nella lista di chiamata, `InsightsMacro` nel modale, e
      **il prezzo consigliato**, che si scrive (owner). ⚠ In un componente suo e con **un posto solo**
      da cui si decide se e dove compare: le tre forme fra cui l'owner sceglierà guardando non devono
      costare tre riscritture (§6)
      → `components/auction/prezzo-consigliato.tsx`, con **quattro** posizioni scritte e non tre:
      `campo`, `macro`, `tocco` e **`spento`**. La quarta è quella che la spec chiedeva senza
      nominarla — «poter essere spostato o spento senza rifare niente» — e spegnerlo è una riga,
      non una rimozione di codice: i due punti d'innesto restano scritti e tacciono da sé.
      → **La scelta dell'owner è `macro`**: il prezzo c'è, ma fra i giudizi e non accanto al campo.
- [x] **M10B-12** — I filtri della chiamata per `is_pro`: fascia, titolarità minima, tag. ⚠ **E la
      riga dell'auto-pick**, che è il vincolo del riquadro di §6 — da scegliere guardando, e da
      provare col filtro acceso
      → I filtri si mostrano **se e solo se i dati sono arrivati** (`pool.some(p => p.carmy)`), e non
      con un `if (isPro)`: la chiave è assente nel payload di chi non ha il permesso, quindi quella
      condizione **è** il permesso — più il caso «foglio non caricato», che si comporta allo stesso
      modo e giustamente.
      → La titolarità minima ha **due** valori e non cinque: «da 4» è la soglia del verde, «da 5» è
      il solo titolarissimo, e i gradi in mezzo non sono una domanda che qualcuno si fa mentre offre
      con un pollice sotto un countdown.
      → **Sulla riga dell'auto-pick l'owner ha delegato**: «non importa, l'importante è che la
      dinamica di auto estrazione del lotto esista — la pagina di visualizzazione è più una utility
      per l'utente». Scelta `riga` (entrambe restano scritte, dietro `MODO_AUTOPICK`), perché è
      l'unica che non fa mentire l'elenco una seconda volta: `fissa` risolve «il primo nome non è
      quello giusto» introducendo una riga presente in un elenco che dichiara di averla filtrata.
      La riga si scrive **sempre**, filtro o no, e diventa ambrata quando il primo della lista non è
      più quello: se comparisse solo a filtro acceso, chi non filtra continuerebbe a fidarsi
      dell'ordinamento e chi filtra la leggerebbe come un avviso d'errore.
- [x] **M10B-13** — Test con Postgres: un caricamento sostituisce l'intera tabella; sotto la soglia di
      aggancio **non si scrive niente** e i nomi mancati si dicono; **un'asta si gioca fino a
      `COMPLETED` con `carmy_players` vuota**; un non-pro **non riceve la chiave** `carmy`; il filtro
      per tag non cambia chi vince l'auto-pick
      → Tutti e cinque, più la mappa delle sigle contro il listone caricato. Il test del motore è più
      forte di quello chiesto: non prova che *il filtro* non cambia l'auto-pick — un filtro vive nel
      browser e non può — ma che **una tabella piena di giudizi addosso ai giocatori in gara** non
      cambia di una virgola chi viene comprato. I giudizi sono messi **contro** l'ordine
      dell'auto-pick (il `fvm` decresce con l'indice, la titolarità cresce), e due aste identiche
      comprano gli stessi nomi nello stesso ordine.
      → ⚠ **I test non stanno in `tests/db/carmy.test.ts`, e questo è lo scarto più importante del
      task.** Erano in un file loro, verde da solo — e la suite intera è diventata **rossa in dieci
      test** con un `duplicate key ... listone_players_pkey`: `uploadListone` fa `DELETE` sulla
      tabella, il join di M10B ha bisogno di un listone caricato, e vitest gira i file in worker
      **paralleli**. È la stessa cicatrice che il file di M10 aveva già documentato per
      `player_insights`, e la regola che ne esce è quella: **una tabella globale, un file che la
      possiede.** I test di M10B sono quindi in `tests/db/listone.test.ts`, che ora possiede
      `listone_players` **e** `carmy_players`, e il perché è scritto in testa al file. L'alternativa
      — `fileParallelism: false` — costerebbe secondi a ogni `pnpm test` per un problema che
      riguarda due file, e lascerebbe la trappola aperta per il terzo.
      → E due errori miei che i test hanno preso: `state.assignments[].playerId` è un **uuid per
      asta** (due aste hanno uuid diversi per lo stesso giocatore, il che è anche la prova che
      `players` è per asta), quindi si confrontano i **nomi**; e il listone sintetico di
      `game-helpers.ts` numera gli `ext_id` **da 1**, che si **sovrappongono** a quelli veri — la
      cicatrice `EXT_ID_BASE`, di nuovo, sul test del non-pro.
- [ ] **M10B-14** — Gate: `pnpm test`, `pnpm typecheck`, `pnpm build` verdi (⚠ build con `pnpm dev`
      spento)
- [x] **M10B-15** — `docs/ARCHITECTURE.md`: il capitolo sugli insight si riapre — **da dove viene un
      giudizio, e perché non è una misura**. `docs/DECISIONS.md`, `docs/HOWTO-PROVA-LOCALE.md` (in
      locale il file si carica dopo il listone), `docs/features/README.md`
      → `ARCHITECTURE.md` ha un capitolo suo, «Il giudizio di un umano: da dove viene, e perché non è
      una misura», dopo quello del listone a sistema e prima di «Il posto dove gira». Non riassume la
      spec: racconta perché la domanda dell'asta («quanto giocherà quest'anno») non è quella a cui
      rispondono i numeri, cosa dice la misura di 0,65, perché è una terza fonte e non un rimpiazzo, e
      perché il prezzo consigliato è l'unico numero della macro che **propone un'azione**.
      → `DECISIONS.md` ha una voce nuova, «M10B, quello che è cambiato scrivendola», che **non
      riscrive** quella della sessione d'analisi: richiama e aggiunge solo ciò che la spec non sapeva.
      → `HOWTO-PROVA-LOCALE.md`: §6 cambia titolo e porta l'ordine dei tre passi — **listone → Carmy →
      caricature** — con l'output atteso del caricamento e le tre cose che non sono guasti. Il Centro
      dati guadagna il paragrafo sulle colonne nuove e la regola dell'ordinamento.
      → `features/README.md`: M10B passa fra le chiuse, spariscono le righe che la davano «da
      pianificare», e i passi a mano del rilascio comune diventano espliciti — **un solo `db:push`**,
      poi **due file nell'ordine**.
- [ ] **M10B-16** — Chiusura: merge `--no-ff` su `dev`, prova in locale, poi — **solo su richiesta
      esplicita** — `CHANGELOG.md`, `package.json`, merge su `main`, **tag `v1.11.0`**, push.
      ⚠ **Quel rilascio porta in produzione anche M10**, che è ferma su `dev` dal 2026-08-12: un tag
      solo per due macro, deciso dall'owner. Quindi il `CHANGELOG.md` ha **una sezione per entrambe**
      e, dei passi a mano, porta: **un solo `pnpm db:push`** (copre i due cambi di schema) seguito da
      `pm2 reload deploy/ecosystem.config.cjs --update-env`, e poi **due file da caricare
      nell'ordine** — prima il listone da Admin → Listone, poi il foglio di Carmy, perché il secondo
      si aggancia al primo per nome. Tutto per esteso: un comando abbreviato viene copiato com'è

## Verifica

1. `pnpm test`, `pnpm typecheck` e `pnpm build` verdi.
2. ⚠ **Con un filtro di Carmy acceso, chi vince allo scadere del timer è lo stesso di prima.** È la
   verifica che protegge il motore da una lente: si accende un filtro che esclude il primo della
   lista, si lascia scadere la chiamata, e si controlla chi è stato comprato.
3. **Un'asta si crea, si prepara e arriva a `COMPLETED` con `carmy_players` vuota.** Nessun dato di
   questa macro sta su un percorso critico — la stessa verifica di M10, per la stessa ragione.
4. **Un caricamento con dieci nomi che non agganciano riesce e li elenca**; uno con metà file
   che non aggancia **fallisce e non scrive niente**.
5. **Un `is_pro` vede fascia, titolarità e tag in `/play`; chi non lo è non li ha nel payload** — si
   controlla in DevTools, non a schermo.
6. **La divergenza si vede**: un giocatore come Dovbyk mostra `5/5` accanto a `3/38`, e le due cose
   si leggono come due cose diverse.
7. **Senza il file caricato, `/play` è identica a v1.11.0** e il badge torna quello di M9.
8. **Il caricamento di ieri si distingue da quello di stamattina**: la data è in ora italiana, e il
   pannello dice quando il file è vecchio.

---

## Com'è andata

Scritto alla chiusura, il 2026-08-12. Non è il riassunto di cosa è stato fatto — quello sta nei task,
sotto le frecce. **È cosa la spec aveva sbagliato**, perché è l'unica parte che serve alla prossima.

**La misura di §1 e §2 ha tenuto, e questo è il risultato più importante del metodo.** Rifatta sui
byte del giorno di apertura, la spec regge riga per riga: 497 righe, 487/497 di aggancio, zero omonimi,
`Pt. Inf.` identica a `injured`, correlazione 0,649, 11 e 13 disaccordi, `>= 4` a 168/497 = 33,8%, M9
a 61 su 329 mostrabili, le otto fasce e le diciassette etichette coi loro conteggi. Scrivere una spec
partendo da una misura sui byte veri, e non da un'idea di com'è fatto il file, ha fatto sì che il
parser si scrivesse in un pomeriggio invece di essere riscritto tre volte.

**Ma la spec aveva letto la scala e non i valori fuori scala.** §1 dice «1–5» cinque volte e nel file
c'è uno **zero** — su tutti e tre i giudizi di un giocatore, sul prezzo di settantatré, e nella fascia
di ottantaquattro sotto forma di `"Non Impostata"`. Sono tre modi diversi di scrivere «non compilato»,
e letti come valori diventano tre bugie diverse: il peggior giocatore del listone, un prezzo
consigliato di zero crediti (che non è nemmeno un'offerta valida), una fascia che non esiste. **La
lezione non è «guarda gli zeri»: è che una distribuzione va contata anche fuori dall'intervallo che ti
aspetti.** La spec aveva contato 1→75, 2→94, 3→159, 4→65, 5→103, che fa 496 su 497 — il conto non
tornava già lì, e nessuno l'aveva fatto.

**Due decisioni le ha prese l'owner guardando, e una l'ha delegata.** La forma del badge è `parola` e
**non** era la proposta: la proposta era `voto`, con due argomenti scritti nella domanda stessa (perde
la scala, e collide con un tag che il foglio ha già su 106 giocatori). L'owner ha scelto comunque, che
è il suo diritto — e le due obiezioni non sono cadute, sono diventate due righe di codice: sotto soglia
il badge porta la scala invece di inventare una parola, e il tag `titolarissimo` sparisce dalla riga
quando il badge lo dice già. ⚠ **Vale come metodo: una preferenza dell'owner contro una proposta
motivata non chiude le obiezioni, le trasforma in requisiti.**
La terza — la riga dell'auto-pick — è stata delegata, ed è interessante *come*: «l'importante è che la
dinamica di auto estrazione del lotto esista, la pagina di visualizzazione è più una utility». Cioè
l'owner ha risposto al **vincolo** (il motore non si tocca) e non alla domanda sulla forma. Il vincolo
era la parte che contava.

**La pagina di prova ha funzionato e sarebbe stata sbagliata sostituirla con una descrizione.** Tre
decisioni su tre sono state prese guardando, come per i colori di M9. È esistita per il tempo di una
domanda e poi è stata cancellata: nel codice non resta niente di lei tranne tre costanti con la scelta
dentro, e le forme scartate — che restano scritte, perché il costo di cambiare idea deve essere una
riga.

**Lo scarto tecnico più costoso non era nella spec: era nei test.** I test con Postgres, in un file
loro, erano verdi da soli e hanno reso **rossa la suite in dieci test**. La causa è banale e la
diagnosi non lo è: `uploadListone` fa `DELETE` su una tabella **globale**, M10B ha bisogno di quella
tabella per esistere, e vitest gira i file in worker paralleli. È **la terza volta** che questo
progetto incontra la stessa cosa — `player_insights` in M10, l'`EXT_ID_BASE` in M10, questa — e la
regola che ne esce va scritta una volta per tutte: **una tabella globale, un file di test che la
possiede.** Costa un file di test più grosso e fa risparmiare un pomeriggio di «funziona da solo, non
funziona insieme».

**Una previsione della spec era falsa e ha rischiato di costare tempo.** M10B-01 diceva «i test di M9
su `quotaTitolare` si romperanno, e va saputo perché». Non si sono rotti, perché il ripiego di §4 *è*
il codice di M9 lasciato intatto. Una spec che predice un rosso fa cercare quel rosso: se non arriva,
si sospetta di non aver fatto il lavoro. **Le previsioni sui test non vanno scritte nelle spec** — ci
si scrive cosa deve valere alla fine, non cosa si romperà nel mezzo.

**Tre cose che la spec non aveva previsto e che sono entrate.** Una colonna `source_team`, perché il
controllo della squadra ha bisogno di ricordare cosa diceva il foglio; un codice d'errore
`CARMY_NO_LISTONE`, perché senza denominatore la soglia di aggancio sarebbe una divisione per zero e il
messaggio deve dire cosa fare; e una quarta posizione del prezzo consigliato, `spento`, che §6 chiedeva
senza nominarla («poter essere spostato o spento senza rifare niente»).

**E una cosa che la spec aveva previsto meglio di quanto sembrasse.** Il riquadro di §6 — il primo nome
della lista con un filtro acceso — sembrava un dettaglio di interfaccia e invece era l'unico posto in
cui questa macro poteva far perdere un giocatore a qualcuno. Non perché rompe il motore: perché rompe
**una promessa che l'interfaccia aveva fatto senza scriverla**. Vale la pena tenerlo a mente per le
prossime: i vincoli peggiori non sono negli invarianti, sono nelle abitudini che l'applicazione ha
insegnato.
