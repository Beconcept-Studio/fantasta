# M10B — Gli insight che vengono da un umano

> **Stato:** **da aprire** su `feature/10b-insight-da-carmy` · Scritta il 2026-08-12 in una sessione
> di sola analisi, a valle di M10 · ⚠ **Si apre su richiesta esplicita dell'owner**, come tutte.
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

> ⚠ **Da guardare prima di scriverlo, non da dedurre.** Questa è la modifica più visibile della
> macro: cambia ciò che dodici persone leggono sul telefono mentre offrono. La soglia del verde sulla
> scala 1–5 (`>= 4`? solo `5`?) e la forma del badge («Titolare 5/5», «Titolarissimo», il numero e
> basta) vanno **viste su una pagina di prova** e scelte dall'owner, come i colori di M9 il
> 2026-08-12. La spec non le decide.

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
  `Fascia`, `Prezzo` consigliato, `Affidabilità`, `Integrità` e i tag per esteso. ⚠ **Il prezzo
  consigliato accanto al campo dell'offerta è la cosa più utile e più pericolosa di questa macro**:
  va guardato prima di scriverlo, perché una cifra suggerita accanto a una cifra da digitare è un
  suggerimento che qualcuno seguirà senza pensarci.

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

- [ ] **M10B-01** — Aprire `feature/10b-insight-da-carmy` da `dev`; rileggere questo file, e in
      particolare §1 (Carmy non porta statistiche nuove, e `Pt. Inf.` non è ciò che sembra), §3 (il
      join per nome) e il riquadro di §6 (l'auto-pick). `pnpm test` verde **prima** di toccare
      qualcosa: i test di M9 su `quotaTitolare` si romperanno, e va saputo perché
- [ ] **M10B-02** — Rifare la misura di §1 e §2 sui byte del giorno in cui la macro si apre, e
      **salvare il file in `fixtures/`**: se le colonne sono cambiate, la spec va corretta prima di
      scrivere il parser, non dopo (è il metodo di M8-02)
- [ ] **M10B-03** — `lib/db/schema.ts`: `carmy_players` come in §5, più `name` su `player_insights`.
      `pnpm db:push` in locale
- [ ] **M10B-04** — `lib/import/parseCarmy.ts`, **puro**: bytes → `Result<CarmyRow[]>`. Quattro fogli,
      le note compattate in un array, e un rifiuto forte se le intestazioni cambiano. Con la sua
      fixture e i suoi test, senza database
- [ ] **M10B-05** — La mappa sigla → squadra in `lib/domain.ts`, venti righe in chiaro, con il test
      che verifica che copra tutte le squadre del listone caricato
- [ ] **M10B-06** — `lib/engine/carmy.ts`: l'upload (join per nome su `listone_players`, soglia di
      aggancio al 90%, sostituzione integrale in transazione), lo stato per il pannello, e i nomi non
      agganciati riportati per nome. **Nessuna eccezione nuova all'allowlist ESLint**
- [ ] **M10B-07** — `lib/domain.ts`: la titolarità che viene da Carmy, con il ripiego su M9 quando il
      file non c'è, **in un posto solo** e con il suo test (§4). ⚠ La soglia e la forma del badge le
      sceglie l'owner guardandole: **prima una pagina di prova, poi il codice**
- [ ] **M10B-08** — Il pannello: il caricamento sotto quello del listone, il quarto timestamp, e
      l'avviso quando il file è vecchio di più di un giorno (§8)
- [ ] **M10B-09** — Il Centro dati: le colonne nuove, ordinabili con la regola di M10, e il filtro
      per tag
- [ ] **M10B-10** — `listPickPool`: la chiave `carmy` **assente** per chi non è pro, come `insights`
      (§7). Il test è quello di M8: si asserisce l'assenza della chiave, non il suo valore
- [ ] **M10B-11** — Il portale: `InsightsLine` nella lista di chiamata, `InsightsMacro` nel modale.
      ⚠ Il prezzo consigliato accanto al campo dell'offerta **si guarda prima di scriverlo**
- [ ] **M10B-12** — I filtri della chiamata per `is_pro`: fascia, titolarità minima, tag. ⚠ **E la
      riga dell'auto-pick**, che è il vincolo del riquadro di §6 — da scegliere guardando, e da
      provare col filtro acceso
- [ ] **M10B-13** — Test con Postgres: un caricamento sostituisce l'intera tabella; sotto la soglia di
      aggancio **non si scrive niente** e i nomi mancati si dicono; **un'asta si gioca fino a
      `COMPLETED` con `carmy_players` vuota**; un non-pro **non riceve la chiave** `carmy`; il filtro
      per tag non cambia chi vince l'auto-pick
- [ ] **M10B-14** — Gate: `pnpm test`, `pnpm typecheck`, `pnpm build` verdi (⚠ build con `pnpm dev`
      spento)
- [ ] **M10B-15** — `docs/ARCHITECTURE.md`: il capitolo sugli insight si riapre — **da dove viene un
      giudizio, e perché non è una misura**. `docs/DECISIONS.md`, `docs/HOWTO-PROVA-LOCALE.md` (in
      locale il file si carica dopo il listone), `docs/features/README.md`
- [ ] **M10B-16** — Chiusura: merge `--no-ff` su `dev`, prova in locale, poi — **solo su richiesta
      esplicita** — `CHANGELOG.md`, `package.json`, merge su `main`, tag, push. **E il `CHANGELOG.md`
      deve contenere i due passi a mano di §10 scritti per esteso**

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
