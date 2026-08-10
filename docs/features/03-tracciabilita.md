# M3 — Tracciabilità

> **Stato:** in corso · **Aperta il** 2026-08-10
> **Tocca lo schema del database?** **No.** Nessun `pnpm db:push` dopo il deploy. È stato
> verificato in fase di spec: tutto ciò che serve allo storico è già in tabella — `events` esiste
> dall'inizio del progetto con il suo indice su `(auction_id, id)`, e lotti, round, buste,
> assegnazioni e rettifiche hanno già ogni colonna che la pagina legge.
> **Invarianti coinvolti:** **I8** — è il punto delicato di questa macro, e §5 esiste solo per lui.
> I10. Regole 3, 5, 6, 7 e 8.

## Obiettivo

L'asta funziona e produce un risultato. Quello che non produce è **una traccia che si possa
leggere**: il risultato esce in un solo formato, quello che Fantacalcio.it reimporta, e la storia di
come ci si è arrivati esiste soltanto in cinque tabelle di Postgres. La sera in cui qualcuno dirà
«io avevo offerto 46, non 45», l'unica risposta possibile oggi è aprire `psql` — che nella stanza
dove si sta giocando non è una risposta.

Sono due cose, e stanno nella stessa macro perché sono la stessa domanda: **cosa è successo, e come
lo dimostro.** La prima guarda al risultato finito, la seconda al percorso.

Il percorso, in particolare, è già scritto e già non si perde: ogni transizione lascia una riga in
`events` nella stessa transazione della mutazione, e i tre override lasciano la traccia più ricca di
tutte. Non manca il dato: manca la pagina.

## Richieste che ci confluiscono

Tolte da `docs/REQUESTS.md` il 2026-08-10.

- **Esportazione rose.** «Deve essere prodotto un unico file con le seguenti informazioni:
  `nome_squadra,id_calciatore,crediti_spesi`.»
- **Log asta.** «Per ogni asta nella lobby ci deve essere la possibilità di trovare una pagina con i
  log dell'asta e di ogni lotto. In questo modo in caso di disputa è possibile vedere lo storico
  senza accedere al database.»

Una **terza cosa entra in fase di spec** (§2) e non viene da una richiesta: la validazione del nome
squadra. È l'export a farla nascere — vedi lì il perché.

---

## Spec

### 1. L'esportazione delle rose

**I due export convivono**, e sono due file diversi con due scopi diversi. Quello che c'è già è il
**listone** completo nel formato Fantacalcio.it — quattordici colonne, invenduti compresi — e serve
a ricaricare le rose là dove il fantacalcio si gioca davvero; l'owner ha confermato in fase di spec
che lo usa a fine asta, quindi togliere quel file sarebbe togliere una funzione viva. Quello nuovo è
il **verbale delle rose**: solo gli assegnati, tre colonne, leggibile a occhio.

Il taglio puro/database esistente si ripete tale e quale, perché è quello che rende un export
collaudabile senza Postgres:

| File | Cosa |
|---|---|
| `lib/rose-csv.ts` | **Nuovo, puro, zero dipendenze.** `roseCsvRows()` e `buildRoseCsv()`: prende righe, restituisce una stringa. Gemello di `lib/import/exportListone.ts` ma **fuori** da `lib/import/`, che è la cartella del formato Fantacalcio.it — e questo formato non è suo |
| `lib/engine/export.ts` | Accanto a `exportXlsx`, la nuova `exportRoseCsv()`: la query e il controllo che sia l'owner |
| `lib/import/exportListone.ts` | Solo `exportFileName(nome, basename)` prende un secondo parametro — `"listone.xlsx"` o `"rose.csv"`. Resta dov'è, col suo test: una seconda funzione che fa lo slug divergerebbe dalla prima entro un anno |

Le rotte diventano **due simmetriche**, e la vecchia sparisce:

```text
GET /api/auctions/[id]/export/listone   ← era /api/auctions/[id]/export
GET /api/auctions/[id]/export/rose      ← nuova
```

Anche quella esistente si sposta, perché `/export` accanto a `/export/rose` fra sei mesi non si
capisce più quale sia quale. Non è un URL che qualcuno ha aperto durante un'asta: lo compone solo il
link in regia.

**La query** parte da `assignments`, ed è l'inverso di quella del listone — che parte dai giocatori
proprio perché deve portarsi dietro anche gli invenduti. `INNER JOIN` su `members` e `players`,
`WHERE auction_id = ? AND voided_at IS NULL`, ordinata per `members.seat_index` e poi
`players.ext_id`, così le rose si leggono a blocchi nell'ordine dei turni. Quel `voided_at IS NULL`
è il **secondo** posto in cui la regola 5 decide cosa finisce in un file che qualcuno guarderà
altrove: un'assegnazione annullata che riapparisse qui sarebbe la correzione della sera dell'asta
buttata via.

**Il file.** Nome `<asta>-rose.csv`, `Content-Type: text/csv; charset=utf-8`, intestazione con
esattamente i tre nomi della richiesta:

```csv
nome_squadra,id_calciatore,crediti_spesi
Gli Invincibili,2792,134
Gli Invincibili,411,88
Real Pastasciutta,164,201
```

`id_calciatore` è **`players.ext_id`**, cioè la colonna `#` del file Fantacalcio.it: il nostro uuid
fuori dal nostro database non significa niente. `crediti_spesi` è il prezzo pagato per **quel**
giocatore, non il totale della squadra.

**Il separatore è la virgola**, alla lettera come nel quaderno. Va detto e sta qui perché è nota, non
perché vada aggiustata: Excel in italiano usa il punto e virgola come separatore di elenco, quindi
questo file aperto con un doppio clic finisce in una colonna sola e va importato dalla procedura
guidata. È il prezzo di un formato neutro, e l'owner l'ha scelto sapendolo.

**Nessuna virgoletta nel file** (§2). Resta una **rete** in `buildRoseCsv`: se un nome squadra
contiene ancora un carattere proibito, il carattere diventa uno spazio. Serve per i nomi salvati
*prima* della regola — e per il terzo carattere che fra un anno ci scorderemo.

**In regia** i due link diventano espliciti: «Listone per Fantacalcio.it (.xlsx)» e «Rose (.csv)».

### 2. Il nome squadra non contiene più virgole né virgolette

Un CSV senza virgolette pretende che i valori non contengano il separatore. La scelta è **impedire
il carattere all'ingresso** invece di virgolettare all'uscita: il file resta leggibile a occhio, che
è tutto il punto di un verbale.

Il posto è uno solo e la cosa funziona: `validateTeamName` in `lib/engine/setup-rules.ts` — puro,
già testato — è chiamata da un unico punto (`addMember` in `lib/engine/setup.ts`), che serve sia
`joinAuction` sia `joinAsOwner`. E **un nome squadra non si rinomina**: si fissa all'ingresso e non
cambia più.

`normalizeName` già collassa ogni spazio bianco in spazi singoli, quindi i ritorni a capo sono
impossibili da prima di questa macro. Restano due caratteri, e diventano un rifiuto:

> Il nome della squadra non può contenere virgole né virgolette.

**Il punto e virgola passa di proposito**: con la virgola come separatore è innocuo, e togliere
caratteri legittimi a un nome di fantasia si paga in fastidio ogni volta che qualcuno entra.

La regola sta in `validateTeamName` e **non** in `normalizeName`, che è condivisa con il nome
dell'asta: quello finisce in uno slug di nome file, dove le virgole non fanno danno. Restringere
anche lui sarebbe un effetto collaterale, non una decisione.

Lato client, `pattern` sui due `Input` che raccolgono il nome — `app/join/[token]/join-form.tsx` e
`app/auctions/[id]/setup/members-panel.tsx` — così lo si scopre prima di premere invio. Il server
rifiuta comunque (regola 6).

**Una conseguenza dichiarata.** La regola vale da qui in avanti. I nomi già salvati restano, e senza
rinomina l'unico rimedio è togliere il membro e rifarlo entrare, cosa che ad asta iniziata non si
può fare. È esattamente il motivo della rete in `buildRoseCsv`: un file leggermente diverso dal nome
digitato è meglio di un file rotto senza possibilità di aggiustarlo.

### 3. Lo storico: dove sta e chi lo vede

**È la quinta sezione dell'asta**, non un link dentro la lobby. Si aggiunge una riga a `SECTIONS` in
`lib/auction-nav.ts`:

| Sezione | Segmento | Voce di menù | Titolo di pagina | Chi la vede |
|---|---|---|---|---|
| `log` | `/log` | Storico | Storico dell'asta | proprietario e membri |

È il caso per cui M2 ha creato quel file: etichetta, titolo e segmento escono dalla stessa riga, e
nessuna pagina si scrive il link a mano. Rispetta anche la regola in testa a `auction-nav.ts` — **le
sezioni dipendono dal ruolo, mai dallo stato**: su un'asta in `DRAFT` la voce c'è e la pagina dice
che non è ancora successo niente. E arrivarci dalla lobby, che è ciò che la richiesta chiedeva,
viene gratis: la sotto-navbar è su tutte le pagine dell'asta.

**La vedono owner e membri.** Un partecipante che vuole contestare un lotto deve poterlo guardare da
sé, senza chiedere a chi conduce di guardare per lui. C'è anche una ragione d'invariante: I10 dice
che una schermata non deve essere raggiungibile solo da chi era connesso al momento giusto, e le
buste di un lotto **non si rivedono da nessun'altra parte** dopo i secondi di reveal — tanto meno se
è stato premuto «Prosegui asta», che quei secondi li salta. Senza questa pagina, chi ha perso il
reveal ha perso il dato.

Chi non è né owner né membro prende un `notFound()`, non un 403: l'esistenza di un'asta a cui non
partecipi non è una tua informazione.

**Osservazione fuori scopo, e volutamente non risolta qui:** la lobby oggi non verifica
l'appartenenza — `getAuctionOverview` torna `null` solo se l'asta non esiste, quindi qualunque
utente autenticato può vedere la lobby di qualunque asta. Lo storico si gating da sé come si deve.
Allineare la lobby è una decisione dell'owner e, se la vuole, una riga in `docs/REQUESTS.md`: non
un effetto collaterale di questa macro.

**La pagina è renderizzata dal server a ogni caricamento, senza stream.** Lo storico non è lo stato
dell'asta, quindi non passa da `serializeSnapshot` (regola 3) e non ha niente da ricevere in tempo
reale — la regola 7 non la riguarda, perché non è una schermata di gioco. In cima scrive «aggiornato
alle 21:15:04» e un pulsante per ricaricare: la data dice l'età di ciò che stai leggendo, che in una
disputa è essa stessa un'informazione.

### 4. Lo storico: com'è fatto

Due blocchi distinti, perché le sorgenti sono due e mescolarle nasconderebbe entrambe. Il numero che
ha deciso la forma: un'asta da 12 con ~25 slot fa **~300 lotti e oltre duemila righe in `events`**,
di cui la grande maggioranza è rumore di macchina. Una cronologia piatta sarebbe illeggibile proprio
la sera in cui serve.

**In alto, i lotti**, dal più recente. Una riga compatta per lotto — numero, giocatore con ruolo e
squadra reale, chi l'ha chiamato, vincitore, prezzo — che si apre su un dettaglio con, per ogni
round: il minimo, quanti erano gli idonei, ogni busta con importo e orario in cui **quella cifra** è
stata fissata, le ritirate, e l'esito del round.

```text
▾ #311  Bastoni (D, Inter) · chiamato d'ufficio · → Gli Invincibili, 45

    Round 1 · minimo 1 · idonei 7
      Gli Invincibili      45   21:04:12
      Real Pastasciutta    45   21:04:09
      Bar Sport            12   21:04:20
      Dinamo Divano   ritirata  21:04:18
    → pareggio a 45, si spareggia
    Round 2 · minimo 45 · idonei 2
      Gli Invincibili      45   21:04:09
      Real Pastasciutta    45   21:04:12
    → stallo, vince la busta più vecchia
```

**L'esito di ogni round lo scrive `resolveRound` di `lib/engine/rules.ts`**, la stessa funzione che
ha deciso l'asta quella sera. Ricopiare quel ragionamento nella pagina vorrebbe dire tenere due
verità su come si vince un lotto, e la seconda sarebbe quella sbagliata.

**Un lotto risolto ha sempre un vincitore e un prezzo.** L'apertura di un lotto piazza l'auto-bid a
1 del chiamante, quindi «lotto deserto» non esiste e la pagina non deve raccontarlo.

**Un campo di ricerca** sopra l'elenco filtra le righe man mano che si scrive: nome del giocatore,
squadra reale, nome squadra del chiamante o del vincitore, numero di lotto. È un filtro **lato
client su righe già presenti** — nessuna rotta nuova, nessuna query nuova — perché in una disputa la
domanda è sempre un nome: «fammi vedere Vlahovic». Il costo, dichiarato: al primo caricamento
viaggia l'HTML di tutti i dettagli, ~300 KB su un'asta piena.

**Sotto, le correzioni e le pause**, in ordine di tempo, con il payload reso in italiano. Gli eventi
notevoli sono `START`, `PAUSE`, `RESUME`, `SKIP_REVEAL`, `MANUAL_ASSIGN`, `VOID_ASSIGNMENT`,
`ADJUST_BUDGET`. Fuori come routine `PICK`, `PLACE_BID`, `WITHDRAW_BID` e `ADVANCE`, che il dettaglio
del lotto racconta meglio di quanto sappia fare il loro payload — dentro `events` un `PLACE_BID`
registra *chi* e *quando*, **mai quanto**.

Un tipo **sconosciuto** — `SEED_FAST_FORWARD`, o un evento che aggiungeremo fra un anno — si rende in
modo generico invece di sparire: un log che nasconde ciò che non sa interpretare è un log di cui non
ti fidi.

È anche così che **i void restano visibili** come vuole la regola 5: il lotto annullato tiene la sua
riga fra i lotti, marcata «⚠ annullato», e l'annullamento con il suo rimpiazzo compaiono fra le
correzioni. Lo storico non nasconde le riassegnazioni: le racconta.

**Come si legge il tutto:**

| File | Cosa |
|---|---|
| `lib/auction-nav.ts` | La quinta sezione (§3) |
| `lib/auction-log.ts` | **Nuovo, puro, zero dipendenze.** I tipi dello storico e `describeEvent()`. Client-safe come `domain.ts` e `auction-nav.ts`: il campo di ricerca è un client component e non deve portarsi l'ORM sul telefono |
| `lib/engine/log.ts` | **Nuovo.** `getAuctionLog(actorUserId, auctionId)`: autorizzazione, lettura, e la barriera di §5 |
| `app/auctions/[id]/log/page.tsx` | Server component. Il blocco delle correzioni sta qui: non è interattivo, non serve che sia client |
| `app/auctions/[id]/log/lots-log.tsx` | Client component: il campo di ricerca e le righe `<details>` |

**`getAuctionLog` non scrive query nuove sui lotti.** Usa `loadAuctionState` di `mutate.ts` — che già
carica lotti, round, buste, assegnazioni e i nomi, ed è ciò che `loadForSnapshot` fa a ogni broadcast
— senza lock, perché non si muta niente e la regola 4 vieta di mutare, non di leggere. L'unica query
propria è quella su `events`, con il join su `users` per scrivere «da Andrea» invece di un uuid:
`payload.actor` è un id utente.

Gli uuid dei lotti non servono — sulle righe dello storico non si agisce, e la chiave naturale è
`seq`. Servono solo per l'inverso: `refs.lots` permette di risalire dal `lotId` dentro un payload al
numero di lotto, che è ciò che rende leggibile «era del lotto #180».

### 5. Come lo storico rispetta I8

> **I8** — Nessun importo di offerta lascia il server mentre `phase = LOT_OPEN`. Vale per tutti i
> client. L'unica eccezione è l'offerta del richiedente stesso.

Una pagina che mostrasse le buste del lotto in contesa violerebbe I8 e, con il rafforzamento di M1,
lo violerebbe anche solo dicendo che una busta è stata consegnata. Ed è il rischio vero di questa
macro: il dato è tutto lì, in memoria, un `map` di distanza.

**La barriera è una riga in `lib/engine/log.ts`:**

```ts
state.lots.filter((lot) => lot.status === "RESOLVED")
```

Funziona perché **non è un confine nuovo: è quello del motore**. `enterReveal` scrive
`status: "RESOLVED"` nel momento esatto in cui entra in `LOT_REVEAL`, cioè quando le buste
diventano pubbliche e l'assegnazione viene committata. Quindi «lotto risolto» ≡ «buste già state
pubbliche», per costruzione e non per attenzione — e un lotto in `LOT_OPEN` o in `LOT_TIE_PREP` non
arriva mai alla pagina, nemmeno come riga vuota.

È lo stesso mestiere di `serializeSnapshot`, che carica tutto e decide cosa esce; e come lì, il
punto di decisione è **uno solo**. Ma non è uno snapshot e non deve diventarlo (regola 3):
`serializeSnapshot` non si tocca, `Snapshot` non guadagna campi, lo stream non trasporta storico.

**Con asta `LIVE` la pagina spiega l'assenza** invece di lasciarla notare: «Il lotto in corso non
compare: le buste restano chiuse fino all'apertura.» È una frase costruita su `auction.status` e non
fa uscire niente. Il conteggio dice «312 lotti risolti» e non mente.

Il test che vale questa macro è in `tests/db/log.test.ts`: un'asta con un lotto `LOT_OPEN` e tre
buste dentro, e l'asserzione che **in tutto ciò che `getAuctionLog` restituisce non compaia nessuno
di quei tre importi**.

### 6. Cosa non cambia

Il motore, lo schema, lo snapshot, gli endpoint di gioco. Nessuna transizione nuova, nessun timer,
nessuna tabella, nessun campo nuovo che esca dallo stream. `serializeSnapshot` non si tocca. Le
schermate di gioco restano funzione pura dello snapshot corrente (regola 7, I10), e il portale resta
mobile-first: lo storico è una pagina in più nella sotto-navbar, non una riga sottratta al countdown.

Nessuna astrazione nuova (regola 8): nessuna paginazione, nessun repository, nessun formattatore
generico. Due export sono due funzioni, non un export parametrico.

---

## Task

- [x] **M3-01** — Aprire `feature/03-tracciabilita` da `dev`; scrivere questo file, togliere le due
      richieste da `docs/REQUESTS.md`, aggiornare `docs/features/README.md`
- [ ] **M3-02** — `lib/rose-csv.ts`: `roseCsvRows()`, `buildRoseCsv()` e la rete sui caratteri
      proibiti. Modulo puro, zero dipendenze
- [ ] **M3-03** — `validateTeamName` rifiuta virgola e virgolette; `pattern` sui due `Input` di
      `join-form.tsx` e `members-panel.tsx`
- [ ] **M3-04** — `exportRoseCsv()` in `lib/engine/export.ts`; `exportFileName(nome, basename)` con
      il secondo parametro; le due rotte `export/listone` e `export/rose`, via la vecchia `export`;
      i due link in `manage/console.tsx`
- [ ] **M3-05** — `lib/auction-log.ts`: i tipi dello storico e `describeEvent()`, compreso il tipo
      sconosciuto reso in modo generico. Modulo puro, zero dipendenze
- [ ] **M3-06** — `lib/engine/log.ts`: `getAuctionLog()` — autorizzazione owner-o-membro,
      `loadAuctionState`, la query su `events` con il join su `users`, e **la barriera I8 di §5 con
      il commento che dice perché**
- [ ] **M3-07** — `lib/auction-nav.ts`: la quinta sezione `log`
- [ ] **M3-08** — `app/auctions/[id]/log/page.tsx` e `log/lots-log.tsx`: i due blocchi, il campo di
      ricerca, l'ora di aggiornamento, la riga che spiega il lotto assente ad asta `LIVE`
- [ ] **M3-09** — Test puri: `tests/rose-csv.test.ts` (intestazione, ordinamento, solo assegnati,
      la rete sui caratteri), `tests/auction-log.test.ts` (`describeEvent` su ogni tipo notevole e
      su uno sconosciuto), `tests/auction-nav.test.ts` e `tests/setup-rules.test.ts` estesi
- [ ] **M3-10** — Test con Postgres: `tests/db/log.test.ts` — **l'asserzione I8 di §5**, più le tre
      autorizzazioni (owner sì, membro sì, estraneo `notFound`) e il lotto annullato che resta
      visibile e marcato; `tests/db/export.test.ts` esteso con l'annullata che non compare e la
      manuale che sì
- [ ] **M3-11** — Gate: `pnpm test`, `pnpm typecheck`, `pnpm build` verdi
- [ ] **M3-12** — `docs/ARCHITECTURE.md` con la tracciabilità: i due export e lo storico, con il
      perché della barriera; `docs/DECISIONS.md` con le scelte non ovvie di questa macro
- [ ] **M3-13** — Chiusura: merge `--no-ff` su `dev`, prova con Docker + seed + `pnpm bots` e dal
      telefono con `pnpm dev:lan`, poi — **solo su richiesta dell'owner** — `CHANGELOG.md`,
      `package.json` a `1.4.0`, merge `--no-ff` su `main`, tag `v1.4.0`, push

## Verifica

1. `pnpm test`, `pnpm typecheck` e `pnpm build` verdi.
2. **I due export scaricano due file diversi**, entrambi dalla regia: `<asta>-listone.xlsx` si
   riapre con `parseListone` e contiene anche gli invenduti; `<asta>-rose.csv` ha le tre colonne, la
   riga di intestazione, solo gli assegnati, e nessuna virgoletta.
3. **Un'assegnazione annullata non compare in nessuno dei due file**, e il suo rimpiazzo manuale sì.
4. **Un nome squadra con una virgola viene rifiutato** all'ingresso, con il messaggio giusto, sia
   dal form di join sia da «Partecipa anche tu» della configurazione — e viene rifiutato dal server
   anche disabilitando la validazione del browser (regola 6).
5. **`pnpm bots` fino a `COMPLETED`, poi lo storico**: ogni lotto ha il suo dettaglio, i round
   raccontano lo stesso esito che l'asta ha applicato, la ricerca per nome trova il lotto.
6. **L'asserzione I8, guardata anche a mano**: ad asta `LIVE` con un lotto aperto e buste dentro,
   aprire `/auctions/[id]/log` come owner e come partecipante non mostra da nessuna parte gli
   importi del lotto in corso, e la pagina dice perché non lo mostra.
7. **Void e riassegnazione**: annullare un'assegnazione e riassegnarla a mano lascia nello storico
   entrambe le tracce — il lotto marcato e le due correzioni — e non cancella niente (regola 5).
8. **Un estraneo** che apre `/auctions/[id]/log` di un'asta che non è sua prende un 404.
9. **Dal telefono** (`pnpm dev:lan`): lo storico si legge e si cerca a una mano, e nella
   sotto-navbar del portale la voce in più non ha rubato spazio al countdown né al pulsante
   d'offerta.
