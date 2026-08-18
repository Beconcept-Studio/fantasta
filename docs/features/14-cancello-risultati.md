# M14 — Il cancello dei risultati: le buste non si aprono da sole

> **Stato:** **pianificata** il 2026-08-18, **non aperta**. Si apre **su richiesta esplicita
> dell'owner**, come tutte · **Indipendente da M13**, che sta prima solo per profilo di rischio:
> quella è tutta UI nel pannello, questa apre la macchina a stati dell'asta.
>
> ⚠ **Tocca lo schema del database? Sì.** Una colonna: **`auctions.result_gate_seconds`**, additiva,
> con `DEFAULT 0`. Quindi al rilascio servono, sul server, `pnpm db:push` e `pm2 reload` — la procedura
> è in «Regole operative di produzione» di `CLAUDE.md`. **Nessun backfill**, e non per fortuna: lo zero
> *è* il comportamento di oggi (§7), quindi le aste già in tabella restano identiche a se stesse senza
> che nessuno debba scriverci sopra. È la differenza fra questa macro e M5, dove il default
> «ragionevole» era quello sbagliato per ogni riga esistente.
> ⚠ **E `lots.status` prende un terzo valore, `VOIDED`.** Non è una modifica di schema — la colonna è
> `text` senza `CHECK`, quindi non c'è niente da migrare — ma è una modifica del **tipo**, e §6 dice
> quali due predicati la guardano e perché uno di essi non va «sistemato».
>
> **Invarianti coinvolti — è la macro che ne tocca più di tutte dopo M1:**
> **I8** è il centro. La fase nuova non deve far uscire niente, e §4 spiega perché la struttura di
> `serializeSnapshot` lo dà quasi gratis — e dove sta invece la trappola vera, che non è il pannello
> delle buste ma **i crediti** (§3).
> **I1** (un solo lotto `OPEN` per asta): il cancello **tiene il lotto aperto**, quindi l'indice
> parziale continua a valere e a proteggere. Nessun indice cambia.
> **I2** (un proprietario per giocatore): un lotto annullato non ha **mai avuto** un'assegnazione,
> quindi non c'è niente da annullare e `one_owner_per_player` non viene sfiorato.
> **I7** (idempotenza): due click su «Mostra risultati», due su «Annulla lotto», lo sweep che passa
> mentre si preme.
> **I10 e `PLAN §8bis`**: un **settimo** caso di rientro (i cinque del piano, il sesto è il congedo di
> M12). Chi rientra durante il cancello deve trovare il cancello, non i risultati.
> **Regole coinvolte:** **1** (mai un timer che decide: il cancello scade **lato server**, il client
> disegna un countdown e non decide niente), **2** (nessun `Date.now()` nel motore: il cancello è una
> deadline passata come parametro), **3**, **5** — che **non** viene sfiorata, e §3 spiega che la
> scelta opposta l'avrebbe sfiorata davvero — **6**, **7**, **8**.
>
> ⚠ **Ribalta una regola operativa scritta in `CLAUDE.md`**, e va detto in cima perché è la cosa che
> un lettore futuro troverà contraddittoria: *«Un lotto sbagliato si corregge con `voidAssignment` +
> `manualAssign`: **la rotazione dei turni non torna mai indietro**.»* «Annulla lotto» la fa tornare
> indietro. In **un** caso solo e sotto condizioni strette (§6), e la regola resta vera in tutti gli
> altri — ma la riga di `CLAUDE.md` va modificata, non lasciata a mentire. Precedente letterale: M9 e
> `PLAN §8bis` punto 1.
> ⚠ **E ne modifica una seconda**, per una ragione che viene fuori solo dall'annullamento: *«Gli
> override solo senza un lotto in contesa. Sono rifiutati con `phase ∈ {LOT_OPEN, LOT_TIE_PREP}`»*
> diventa `{LOT_OPEN, LOT_TIE_PREP, LOT_SEALED}`. §6 spiega perché non è una precauzione ma il
> presupposto che rende sicuro l'annullamento.

## Obiettivo

Oggi, fra «il round è chiuso» e «tutti sanno tutto», **non c'è nessun istante**. È una transizione
sola: `advanceLotOpen` chiude il round, chiama `resolveRound`, entra in `LOT_REVEAL` — e in quella
stessa transazione l'assegnazione è committata e lo snapshot successivo porta **tutte le buste di
tutti i round** a tutti, TV compresa.

Il caso che questa macro esiste per non lasciare in piedi non è ipotetico ed è quello descritto nel
quaderno: **qualcuno perde la connessione negli ultimi secondi**, non per colpa sua. Nel momento in cui
lo dice a voce, le buste sono già sul proiettore. Non c'è niente da fermare: il lotto è assegnato, il
prezzo è pubblico, e l'unico rimedio è una correzione a mano che lascia comunque tutti a conoscenza di
quanto ciascuno aveva offerto — cioè, in un'asta a busta chiusa fra amici che si guardano in faccia,
**l'informazione che decide i lotti successivi**.

Questa macro mette un istante lì dentro, e lo consegna a chi conduce. Per X secondi il round è chiuso
e nessuno sa niente: si può mostrare, si può fermare, si può — solo lì — buttare via il lotto e
rifarlo.

Il tema, detto in una riga: *fra la chiusura e la rivelazione ci vuole un istante che appartenga a chi
conduce.*

## Richieste che ci confluiscono

Tolta da `docs/REQUESTS.md` il 2026-08-18 — il quaderno torna vuoto.

- **BTN Apri risultati post conclusione lotto.** «Quando un lotto termina, al momento viene mostrato
  subito il vincitore con le relative offerte. Questo fa sì che nel caso ci fosse un problema (ES: un
  partecipante perde la connessione non per suoi problemi) le offerte verranno subito svelate. Vorrei
  che al termine del lotto ci siano due BTN: **"Mostra risultati"**, con timer di Xs (se entro Xs non
  viene premuto si scatena in automatico la visione dei risultati) — questo valore va definito
  dall'admin durante la configurazione dell'asta; **"Asta in pausa"**, che mette in pausa l'asta, così
  nel caso un utente segnali un problema l'admin può bloccare la visualizzazione dei risultati. Nel
  caso il bottone venga premuto lo stesso bottone deve tramutarsi in "Riprendi asta" che riattiva
  tutto, e deve apparire un BTN **"annulla lotto"**. "Annulla lotto" è una sorta di reset del lotto:
  l'utente che ha scelto il calciatore del lotto annullato è di nuovo il proprietario del turno. Anche
  il calciatore estratto durante il lotto annullato torna disponibile. Questa azione va segnalata nel
  log.»

**Quattro decisioni dell'owner, prese il 2026-08-18 e da leggere prima della spec**, perché tre di
esse cambiano il perimetro:

1. **Comanda l'owner dell'asta, in regia** — non l'amministratore dell'applicazione. In questo
   progetto «admin» è un permesso su una persona (`users.is_admin`, `lib/domain.ts`) e non ha nessuna
   pagina da cui condurre l'asta di un altro; i due pulsanti stanno accanto a «Metti in pausa» e
   «Prosegui asta», che sono già dell'owner. Conseguenza pratica: **«Asta in pausa» non è un pulsante
   nuovo** — è quello che c'è (§5).
2. **Il cancello sta a ogni chiusura di round**, non solo quando il lotto si chiude con un vincitore.
   È una decisione che *allarga* la richiesta, e la ragione è misurata: oggi un pareggio nel round 1
   svela l'importo pareggiato a chi ha pareggiato (`LOT_TIE_PREP`), cioè **un pezzo di busta esce prima
   del reveal** — lo dichiara `snapshot.ts` stesso, «l'unica informazione che esce prima». La
   disconnessione del quaderno esporrebbe comunque quella cifra. Ed è anche un punto solo nel codice
   invece di due (§2).
3. **`X = 0` spegne il cancello**, e lo zero è il default della colonna: le aste che esistono non
   cambiano comportamento. Una **nuova** asta invece lo propone a 10 secondi (§7).
4. **Nessun altro potere**: l'annullamento vive solo dentro il cancello e a asta in pausa, e fuori da
   lì resta la strada di sempre (§9).

---

## Spec

### 1. Cosa succede oggi, letto nel codice

Non è un'ipotesi da verificare all'apertura: è stato letto il 2026-08-18, e sono quattro fatti.

**1. La chiusura del round e la pubblicazione delle buste sono la stessa transizione.**
`advanceLotOpen` (`lib/engine/machine.ts`) chiama `resolveRound`, marca `closedAt` sul round e — se
c'è un vincitore — passa a `enterReveal`, che nello stesso stato nuovo scrive `status: "RESOLVED"` sul
lotto, il vincitore, il prezzo, **e crea l'assegnazione**. Lo snapshot successivo ha
`currentLot.reveal` popolato, e `reveal` porta *tutte* le offerte di *tutti* i round.

**2. L'assegnazione è committata all'ingresso del reveal, di proposito**, e il commento lo dice:
*«l'assegnazione è committata qui, non alla fine del reveal — i secondi di reveal sono
presentazionali, e un crash durante il reveal non deve poter perdere un lotto già deciso»*. È una
scelta buona, e §3 spiega cosa questa macro le fa e a quale prezzo.

**3. Un pezzo di busta esce già prima del reveal.** `LOT_TIE_PREP` porta `tie`: l'importo pareggiato e
chi l'ha pareggiato. `snapshot.ts` lo dichiara e lo motiva — *«è il contenuto stesso dell'annuncio di
spareggio, e fra due secondi sarà il `min_amount` pubblico del round 2»* — e la motivazione regge
finché il round 2 parte davvero. È la ragione della decisione 2 dell'owner.

**4. Esiste una strada che non passa da nessun countdown**, e va sapendola: se l'unico idoneo è il
chiamante, `openLot` va **diritto** a `enterReveal` nell'istante del pick, con `endsAt = now`. Il
commento spiega perché — *«a fine ruolo questi lotti possono essere molti di fila, e trenta secondi
ciascuno sarebbero minuti persi in diretta»* — e §2 dice cosa fa il cancello con quella strada.

### 2. La fase nuova: `LOT_SEALED`

**Dove si infila.** `advanceLotOpen` smette di risolvere e diventa: chiudi il round
(`closedAt = now`), vai in `LOT_SEALED` con `phaseDeadline = now + resultGateSeconds`. **`resolveRound`
non viene chiamata.** Non è un dettaglio di ordine: è la differenza fra «l'esito esiste e non lo
mostriamo» e «l'esito non esiste ancora», e §3 è tutta su quella differenza.

**Come si esce.** Due strade, e finiscono nello **stesso** posto:

| Uscita | Chi | Effetto |
|---|---|---|
| `ADVANCE` alla scadenza | il timer e lo sweep, come per ogni altra fase | risolve il round e va avanti |
| `SHOW_RESULTS` | l'owner, in regia | idem, subito |
| `CANCEL_LOT` | l'owner, **solo a asta in pausa** | il lotto muore e il turno torna al chiamante (§6) |

Risolvere significa **esattamente ciò che si fa oggi, spostato di un passo**: `resolveRound` sul round
corrente, `WINNER → enterReveal`, `TIE → LOT_TIE_PREP`. Nessuna seconda strada per la stessa cosa —
è il criterio con cui «Prosegui asta» è stato scritto (*«l'effetto è `nextTurn`, cioè la stessa
identica funzione che gira alla scadenza: non esiste una seconda strada per passare il turno, e quindi
non c'è niente da tenere allineato»*), e qui vale doppio, perché la funzione che si sposta è quella
che decide chi ha vinto.

⚠ **`SHOW_RESULTS` non può essere un `ADVANCE`.** La guardia `now < phaseDeadline` dentro `advance`
esiste perché timer e sweep possano chiamarla quante volte vogliono senza combinare guai (I7):
allentarla per fare spazio a un pulsante la renderebbe inutile per tutti e due i chiamanti. È
letteralmente il ragionamento scritto su `skipReveal`, e questa macro ne è **il secondo chiamante** —
due eventi «un umano fa avanzare una fase in anticipo», con la stessa forma e la stessa guardia
di proprietà nell'azione, non nel motore.

⚠ **Con `resultGateSeconds = 0` la fase non esiste**, e non è «una fase che dura zero secondi». Una
fase da zero è uno stato osservabile: un timer armato sull'istante presente, uno snapshot in più per
lotto mandato a dodici persone, un momento in cui un `ADVANCE` in ritardo di un tick fa vedere una
schermata «risultati in arrivo» che lampeggia. Il ramo nel motore è **una `if`** — se il cancello è
zero, `advanceLotOpen` risolve come oggi, nella stessa transizione — e vale la pena scriverla.

⚠ **La strada del §1.4 resta senza cancello**, ed è una decisione da scrivere dove succede. Quando
l'unico idoneo è il chiamante non c'è nessuna busta da proteggere: l'unica offerta in campo è il suo
auto-bid a 1, e «prezzo 1» è già implicito nel fatto che nessun altro potesse offrire. Metterci il
cancello vorrebbe dire pagare X secondi per lotto, **molti di fila a fine ruolo**, per un esito che
nessuno può contestare — cioè disfare esattamente l'ottimizzazione che il commento di `openLot`
descrive. La conseguenza va accettata sapendola: in quei lotti i risultati compaiono subito, come
oggi.

### 3. Perché il cancello sta **prima** della risoluzione — la trappola dei crediti

Questa sezione è la ragione per cui la macro è progettata così e non nel modo più ovvio, ed è la cosa
che va letta prima di scrivere una riga.

**Il modo ovvio** sarebbe: lasciare tutto come oggi — round chiuso, esito calcolato, assegnazione
committata — e **nascondere i risultati** finché la fase è il cancello. Una riga in
`serializeLot`: `reveal` solo in `LOT_REVEAL`, come già è.

**Non funziona, e il buco non è nel pannello delle buste: è nei crediti.** `serializeMembers` calcola
per ogni membro `credits`, `maxBid`, `slotsFilled` e `roster` — tutti e quattro da `state.assignments`
— e quei campi stanno in **ogni** snapshot per **tutti**, TV compresa. Nascondere `reveal` mentre i
crediti di un membro scendono di 87 e un nome nuovo compare nella sua rosa non nasconde niente: **è un
quiz con una risposta sola**. E la risposta la si legge sul proiettore, in tempo reale, prima che
chiunque possa premere un pulsante.

Quindi il cancello sta prima. Da lì discendono tre conseguenze, e sono tutte a favore:

**a) Annullare un lotto non tocca la regola 5, e nel modo ovvio l'avrebbe toccata.** Nel cancello
l'assegnazione **non esiste ancora**: non c'è nessun `voided_at` da scrivere, nessuna riga
compensativa da inventare, nessun credito da rimettere a posto. Il giocatore torna disponibile **da
sé**, perché la disponibilità è derivata dalle assegnazioni non annullate — `takenPlayerIds`,
`autoPick` e il controllo dentro `pick` guardano tutti la stessa cosa. Non c'è niente da rimettere in
ordine, e ciò che non si scrive non si può scrivere male.

**b) La barriera I8 dello storico continua a valere, gratis.** `isPublicLot` in `lib/auction-log.ts`
è `status === "RESOLVED"`, e il suo commento spiega che il confine non è inventato lì: *«`enterReveal`
scrive `status: "RESOLVED"` nell'istante esatto in cui entra in `LOT_REVEAL` … quindi «lotto risolto»
≡ «buste già state pubbliche», per costruzione e non per attenzione»*. Con il cancello prima della
risoluzione, un lotto sigillato è ancora `OPEN`: lo storico non pubblica le sue offerte, senza che
nessuno debba aggiungere una condizione. **L'equivalenza resta vera**, ed è per questo che §6 vieta di
dare `RESOLVED` a un lotto annullato.

**c) Il prezzo, dichiarato.** La proprietà di §1.2 — *un crash durante il reveal non deve poter perdere
un lotto già deciso* — adesso ha davanti una finestra di X secondi in cui il lotto è deciso **dalle
offerte** ma non committato. **Non è una perdita**, e la ragione è che l'esito non è un dato ma una
funzione: le offerte sono righe a database, `resolveRound` è pura, e al primo `ADVANCE` successivo —
timer riarmato dal boot recovery, o sweep — l'esito è **lo stesso**, perché gli stessi bit producono
la stessa risposta. Il boot recovery lo fa già per tutte le altre fasi. ⚠ **Va provato, non assunto**:
è la verifica 8.

### 4. Cosa vede chi guarda, durante il cancello

**Dal server non esce niente di nuovo, e per costruzione.** `serializeLot` popola `tie` solo in
`LOT_TIE_PREP` e `reveal` solo in `LOT_REVEAL`: nella fase nuova sono entrambi `null` **senza che
nessuno scriva un `if`**. È la proprietà per cui `serializeSnapshot` esiste (regola 3), e questa macro
è il primo caso in cui la si mette alla prova aggiungendo una fase invece di un campo. `myBid`
continua a portare la propria offerta, come in ogni fase: è la propria.

**Il partecipante.** La card del lotto chiuso, **senza i risultati**: le buste sono consegnate, si
aprono fra X secondi.

⚠ **Non deve somigliare alla card viva**, e la lezione è di M1, scritta su `lot-closed-card.tsx`:
*«finché il reveal viveva dentro la card viva, chi guardava il telefono per tre secondi vedeva la
stessa cornice, la stessa barra che scorre e lo stesso countdown grande che un attimo prima chiedevano
di offrire: l'unico modo di capire che il lotto era finito era leggere»*. La cornice che dice «finito,
non si offre più» è quella giusta — quindi **`LotClosedCard` impara uno stato**, invece di nascere una
terza card: dove c'è il prezzo pagato compare il countdown del cancello, e dove c'è l'elenco delle
buste una riga che dice che sono ancora chiuse. Due momenti dello **stesso oggetto**, con il prezzo che
appare dove prima scorreva il tempo. ⚠ Oggi quel componente esce subito se `lot.reveal === null`: è
la riga da cui la modifica comincia.

**La regia.** I due pulsanti, e in pausa il terzo (§5).

**La TV.** La stessa cosa, ed è lo schermo che la stanza sta guardando: per X secondi nessuno sa
niente. Non è un effetto collaterale da minimizzare — in un'asta a busta chiusa **è il momento**, e
allungarlo un po' è precisamente ciò che l'owner ha chiesto di poter fare.

**`phaseLabel`** prende la sua voce: **«buste da aprire»**, accanto a «buste aperte» che è il reveal.
Le due frasi si leggono in fila e dicono cose diverse in tre parole, che è il requisito di quella
funzione (la usano portale, regia e cartello della TV).

⚠ **`portalScreen` deve restituire `LOT`**, ed è già così **per costruzione** — decide su
`currentLot !== null && phase !== "WAITING_PICK"`, non su un elenco di fasi. **Va verificato con un
test, non assunto**: è una funzione pura con i suoi test, e il settimo caso di rientro di §8bis si
dimostra lì (verifica 3).

### 5. I due pulsanti, e il terzo che compare in pausa

**«Mostra risultati»** — `SHOW_RESULTS`, owner, guardato su `status === "LIVE" && phase ===
"LOT_SEALED"`. L'idempotenza arriva dalla stessa meccanica di `skipReveal`: dopo il primo click la
fase non è più quella, quindi il secondo trova la guardia e viene rifiutato senza effetti. Accanto, il
countdown: il pulsante **anticipa** una scadenza che c'è comunque, non la sostituisce.

**«Metti in pausa»** — **esiste già**, ed è nel `ControlPanel` della regia. `managerControls.canPause`
è vero durante il cancello perché guarda `status`, non la fase. Questa macro **non aggiunge una
pausa**: si assicura che in quel momento sia a portata di pollice e che il testo accanto dica cosa
succede *adesso* («i risultati non escono finché non riprendi»), invece della frase generica sui
countdown.

⚠ **La pausa congela il cancello senza che serva scriverlo**, e vale la pena verificarlo invece di
fidarsi: `resume` trasla `phaseDeadline` di quanto è durata la pausa, e il ramo che trasla anche
l'`ends_at` del round è dentro `if (state.phase === "LOT_OPEN")` — nel cancello il round è chiuso,
quindi non c'è niente da traslare **e `openLotOf` non viene chiamata**, cioè nessuna eccezione. Il
countdown congelato lato client lo disegna già `pausedRemaining`. Se tutto questo è vero, la pausa
costa **zero righe**: è la verifica 5.

**«Annulla lotto»** — `CANCEL_LOT`, owner, e la guardia è **`status === "PAUSED" && phase ===
"LOT_SEALED"`**. Che sia solo in pausa non è soltanto la lettera della richiesta: è anche la guardia
giusta, perché annullare un lotto mentre il suo countdown corre sarebbe una corsa con il proprio
timer — a asta in pausa i timer sono fermi per definizione.

⚠ **La conferma nomina il giocatore e chi l'aveva chiamato.** È la lezione di M12 §4: *«un avviso che
nomina un numero si legge; uno generico si clicca»*. Qui i nomi sono due, e sono precisamente i due
fatti che l'operazione cambia. Non serve digitare niente — non è una cancellazione irreversibile di
dati, è un lotto di trenta secondi da rifare — ma serve un passo in mezzo, perché il pulsante vive
accanto a «Riprendi asta» e i due click sono a un centimetro di distanza.

### 6. Cosa fa «Annulla lotto», esattamente

**Il lotto.** `status = "VOIDED"`. `winner_member_id`, `final_price` e `resolved_at` restano `null`:
non è mai stato risolto, e scrivere `resolved_at` significherebbe dire il contrario. **Quando** è
stato annullato lo dice la riga di `events`, che è il posto dove stanno i fatti dell'asta.

⚠ **Mai `RESOLVED`, e questa è la trappola numero uno della macro.** `isPublicLot` equipara
«RESOLVED» a «le buste sono già state pubbliche» (§3b), e un lotto annullato è **l'unico caso
nell'applicazione in cui un lotto finisce senza che le buste siano mai uscite**. Se un giorno qualcuno
gli dà `RESOLVED` per coerenza — «è finito, no?» — lo storico pubblicherà le offerte di un lotto
annullato, cioè esattamente le buste che questa macro esiste per non svelare. Il predicato **non va
cambiato**. E la seconda rete di `lib/engine/log.ts` — un lotto senza vincitore o senza prezzo viene
scartato comunque — copre lo stesso caso da un altro lato e va lasciata dov'è: il commento di M3 dice
che si sovrappongono di proposito e che nessuna delle due va rimossa perché «l'altra basta».

**Le offerte e i round restano.** Non si cancella niente: sono il verbale di ciò che è accaduto, ed è
ciò che rende l'annullamento verificabile domani. Semplicemente **non diventano mai pubbliche**.

**Il giocatore torna disponibile da sé** (§3a). Nessun codice.

**Il turno torna al chiamante.** `currentLotId = null`, `phase = "WAITING_PICK"`,
`currentSeatIndex` = il seat di `lot.calledByMemberId`, `phaseDeadline = now + pickSeconds`. Il ruolo
non cambia: è il ruolo del giocatore chiamato, per costruzione.

⚠ **Va indietro, ed è la riga di `CLAUDE.md` che questa macro modifica.** Le condizioni strette che
lo rendono sicuro, tutte e tre necessarie:

1. **quel lotto non ha creato nessuna assegnazione** (§3a) — quindi non c'è niente di cui il ritorno
   indietro debba tenere conto;
2. **la rotazione non è ancora avanzata**: `nextTurn` gira all'uscita dal reveal, che qui non è mai
   arrivata;
3. **il ruolo del chiamante non può essersi riempito nel frattempo.** Il chiamante aveva uno slot
   libero quando ha chiamato (`pick` lo verifica, ⚠ §12.19), nessun altro lotto può esistere (I1), e
   l'unica cosa che riempie un ruolo fuori da un lotto è `manualAssign`.

⚠ **La terza condizione è vera solo se gli override sono rifiutati anche nel cancello**, e oggi non lo
sono: `lib/engine/override.ts` rifiuta `LOT_OPEN` e `LOT_TIE_PREP`, e `overrideControls` fa la copia
client dello stesso elenco. **`LOT_SEALED` va aggiunto a entrambi**, e non come precauzione: un lotto
sigillato **è** un lotto in contesa — è il momento più in contesa che ci sia, perché l'esito è già
deciso e nessuno lo conosce. Assegnare a mano un giocatore in quel momento vorrebbe dire correggere
una rosa mentre una busta chiusa sta per cambiarla. È una riga in due posti, e in cambio toglie
un'intera classe di interazioni.

Con le tre condizioni in piedi, il caso «il chiamante non può più chiamare» **non esiste**: il motore
lo **asserisce** e, se lo trova, solleva un'eccezione. È la convenzione dichiarata del file — *«i
rifiuti previsti sono `Result`, i bug sono eccezioni»* — e il precedente letterale è il
`throw new Error("nessun seat con slot liberi nel ruolo …")` di `nextTurn`, due funzioni sopra.

**Il log.** Una riga in `events`, che è ciò che la richiesta chiede esplicitamente.

- ⚠ **Un tipo nuovo è «notevole» da sé**: `isNotableEvent` consulta la lista della *routine*, non
  quella dei noti, «così un evento che aggiungeremo fra un anno comparirà nello storico senza che
  nessuno si ricordi di aggiungerlo». Quindi la riga compare nello storico gratis — **ma**
  `describeEvent` cadrebbe sul ramo tecnico, che stampa il payload grezzo. Serve il suo `case`, con il
  giocatore e chi l'aveva chiamato.
- ⚠ **Nel payload non entra nessun importo.** È la disciplina che `events` ha già: *«dentro `events`
  un `PLACE_BID` registra chi e quando, mai quanto»*. Un lotto annullato è il caso in cui quella
  disciplina conta più che mai, perché la riga di log sopravvive alla sigillatura.

**Se lo stesso membro richiama lo stesso giocatore** nasce un **lotto nuovo**, con il `seq`
successivo. Il vecchio resta in tabella, `VOIDED`. La sequenza dei lotti pubblici ha un buco, ed è
onesto che l'abbia: è il numero di volte che si è chiamato, non il numero di lotti riusciti.

⚠ **E in simulazione va saputa una cosa**: se il chiamante era un bot, riprende il turno e richiama —
molto probabilmente **lo stesso giocatore**, perché `autoPick` è deterministico (`fvm DESC`). Non è un
guaio, ed è anche il modo di provare la macro con `pnpm bots`; ma un «annulla lotto» ripetuto in una
simulazione produce lo stesso lotto una seconda volta, e chi lo vede senza saperlo penserà a un bug.

### 7. Il valore X: dove sta, quanto vale, e l'unico zero ammesso

**La colonna:** `auctions.result_gate_seconds`, `NOT NULL DEFAULT 0`.

**Il limite:** una quinta voce in `TIMER_LIMITS` (`lib/engine/setup-rules.ts`), con **min 0** e un max
nell'ordine degli altri (120 come `revealSeconds` e `tiePrepSeconds`).

⚠ **È l'unico timer che ammette lo zero**, e i quattro che esistono hanno tutti un minimo positivo
perché una fase da zero secondi non ha senso. Qui lo zero **non è una fase da zero secondi: è
l'assenza della fase** (§2), e la nota va scritta accanto al limite — altrimenti qualcuno
«uniformerà» quel minimo a 1 per simmetria e spegnerà la possibilità di tornare al comportamento di
prima.

⚠ **Due default diversi, di proposito, e va scritto perché.** Il default della **colonna** è `0`: è
ciò che vale per le righe che esistono già, e le lascia identiche a se stesse senza backfill
(decisione dell'owner). Il default della **creazione** — `DEFAULT_CONFIG` in `setup-rules.ts` — è
`10`: è ciò che una pagina *propone* a chi sta creando un'asta nuova, e il comportamento nuovo è
quello che l'owner ha chiesto. Non sono in contraddizione e non vanno allineati: uno risponde a «cosa
c'era prima», l'altro a «cosa proponiamo adesso».

**Si cambia anche a asta iniziata**, come gli altri tempi, con la regola che già c'è: valgono dal
lotto successivo, non accorciano un countdown in corso (il motore rilegge la config a ogni
transizione).

**L'etichetta**, nei campi dei tempi accanto a «Buste aperte»: **«Prima dei risultati (s)»**, con la
riga che dice che `0` vuol dire come prima — i risultati appena il round chiude.

**E finisce nello snapshot**, in `auction.timers`, come i quattro fratelli: è ciò da cui il client
sa quanto dura la fase quando ne ha bisogno (i bot lo usano già per `pickSeconds`).

### 8. I posti da toccare, e quello che il compilatore **non** dice

Aggiungere un valore a `AUCTION_PHASES` non fa cadere il typecheck dove servirebbe, e contarci sarebbe
il modo di dimenticare metà dell'elenco. Verificato leggendo i chiamanti:

| Posto | Cosa succede aggiungendo la fase |
|---|---|
| `advance` in `machine.ts` | ⚠ **`tsc` lo segnala**: lo `switch` non ha `default` e la funzione smetterebbe di restituire sempre un valore. È l'unico posto che si difende da sé |
| `phaseLabel` in `portal.ts` | **Silenzioso**: ha un `default`. Va aggiunta la voce a mano (§4) |
| `bot-brain.ts` | **Silenzioso**: catene di `if`, e per una fase sconosciuta restituisce `null` — che è il comportamento **giusto** («il cancello scorre da sé»). Da verificare, non da cambiare |
| `overrideControls` + `override.ts` | **Silenziosi**, ed è il posto dove il silenzio fa danno: §6 |
| ⚠ `scripts/seed.ts` | Due cose, e nessuna delle due è quella che sembra. **`tsc` lo segnala, ma solo se il campo è obbligatorio in `AuctionConfig`** (`setup-rules.ts`): il seed costruisce la config a mano con un oggetto suo, `DEV_TIMERS`, e un campo in più obbligatorio fa fallire quel letterale — ed è la ragione per cui il campo va reso obbligatorio lì invece di opzionale. **E la fase, di suo, nel seed non capiterebbe mai**: `DEV_TIMERS` non è `DEFAULT_CONFIG`, e senza il campo il valore sarebbe lo `0` della colonna. Quindi il `default: throw new Error("simulazione: fase inattesa …")` di quello `switch` **non scatterebbe**, e `--auction-status=mid` — l'unico collaudo locale che gioca un'asta intera — sarebbe l'unico posto che **non attraversa la fase nuova**. Servono entrambe le cose: il `case` (identico a `LOT_TIE_PREP`, avanza alla scadenza) **e** un cancello corto in `DEV_TIMERS`, 2 secondi come gli altri |
| `managerControls` | I due pulsanti nuovi, accanto a `canSkipReveal` |
| `lot-closed-card.tsx`, `tv-view.tsx`, `portal.tsx` | La scelta della card oggi è `phase === "LOT_REVEAL" ? chiusa : viva`: diventa a tre vie (§4) |

### 9. Il perimetro — cosa questa macro non fa

- **Nessun annullamento dopo il reveal.** Fuori dal cancello resta la strada di sempre —
  `voidAssignment` + `manualAssign` — e **lì la regola operativa continua a valere alla lettera**: la
  rotazione non torna indietro. Il ritorno indietro esiste solo dove non ha ancora prodotto niente.
- **Il cancello non riapre le offerte.** Chi era disconnesso durante il round ha perso il round: serve
  a **non svelare**, non a rimediare. L'unico rimedio vero è buttare il lotto e rifarlo, che è
  precisamente il terzo pulsante.
- **Nessun pulsante «ho un problema» per i partecipanti.** La segnalazione avviene a voce, nella
  stanza, che è dove sono tutti. Se un giorno servirà è una macro sua.
- **Nessuna pausa automatica**, per nessuna ragione: è la scelta di `presenceAlert` — *«un'asta che si
  mette in pausa da sola perché un telefono è andato in standby si bloccherebbe ogni due minuti»* — e
  vale identica qui.
- **X secondi sono X secondi.** Se nessuno preme e nessuno segnala, i risultati escono. Il cancello
  sposta la decisione, non la sospende.
- **Non si toccano:** `resolveRound` e il tie-break, `maxBid` e i crediti, il ledger, l'export del
  verbale, la cancellazione delle aste e il congedo di M12, gli insight, lo scheduler (il cancello è
  una `phase_deadline` come le altre: il timer e lo sweep lo trattano già senza sapere cosa sia).
- **Nessun secondo cancello** prima del `WAITING_PICK`, e nessuna riapertura di un round.
- **Niente cancello sui lotti a idoneo unico** (§2, ultimo capoverso).

---

## Task

> Da rifinire all'apertura della macro. Sono la traduzione della spec, non un impegno preso nella
> sessione in cui è stata scritta.

- [x] **M14-01** — Aprire `feature/14-cancello-risultati` da `dev`; rileggere questo file, e in
      particolare **§3**: la scelta di mettere il cancello prima della risoluzione è l'unica decisione
      da cui dipende tutto il resto, e il modo ovvio ha un buco che non si vede leggendo
      `serializeLot`. `pnpm test` verde come baseline, con il conteggio annotato (791 a v1.13.0)
      → **Baseline: 815 test in 50 file**, verdi. Il 791 del testo era di v1.13.0: M13 ne ha aggiunti
      24. Branch aperto da `dev` allineato a `origin/dev`.
- [x] **M14-02** — Riprodurre §3 **prima di scrivere il rimedio**: sigillare a mano un lotto risolto
      (fase forzata a un valore che non mostra `reveal`) e guardare **i crediti del vincitore nello
      snapshot**. È il buco che decide la forma della macro, e va visto una volta
      → **Visto, e §3 sottostima il buco.** Test usa-e-getta: asta a 8 con budget 100, il seat 0
      chiama un portiere, due offerte (40 e 87), `ADVANCE` chiude il round, poi `phase` forzata a
      `'LOT_SEALED'` con una `UPDATE` grezza. Nello snapshot **della TV** (`viewerMemberId = null`,
      quindi nemmeno `myBid`): `reveal` e `tie` sono entrambi `null` — la sanificazione di
      `serializeLot` funziona — e intanto il vincitore passa da `credits: 100` a `13`, da
      `maxBid: 97` a `11`, da `slotsFilled.P: 0` a `1`, mentre gli altri sette restano a 100.
      ⚠ **E c'è di più di quanto §3 dica**: non è «un quiz con una risposta sola», è la risposta
      scritta. `roster` porta `{ name: "Giocatore 1", price: 87 }` — cioè **l'importo esatto
      dell'offerta vincente**, in un campo che non ha nessun rapporto con `reveal`. Nascondere
      `reveal` mentre `roster` pubblica il prezzo non nasconde niente: sigillare *dopo* la
      risoluzione sarebbe stato inutile per costruzione, non per distrazione. Il cancello va prima.
- [ ] **M14-03** — `lib/domain.ts`: `LOT_SEALED` in `AUCTION_PHASES`. `lib/engine/setup-rules.ts`: la
      quinta voce di `TIMER_LIMITS` con **min 0** e la nota di §7, `DEFAULT_CONFIG` a 10.
      ⚠ Il campo è **obbligatorio** in `AuctionConfig` — sia quello del setup sia quello del motore in
      `lib/engine/types.ts` — ed è precisamente ciò che fa segnalare a `tsc` i costruttori di config
      scritti a mano, il seed compreso (§8). `lib/db/schema.ts`: la colonna con `DEFAULT 0` e il
      commento sui **due default diversi**.
      `lots.status` prende `VOIDED`, con il rimando a §6 sul perché non sarà mai `RESOLVED`
- [ ] **M14-04** — Il motore: `advanceLotOpen` chiude e sigilla (⚠ **senza chiamare `resolveRound`**),
      il caso `LOT_SEALED` in `advance` risolve, `SHOW_RESULTS` come secondo chiamante del pattern di
      `skipReveal`. **Il ramo `resultGateSeconds === 0` che salta la fase del tutto** (§2). Test puri:
      vincitore, pareggio, cancello a 0, cancello in pausa, doppio `SHOW_RESULTS`, `ADVANCE` in
      anticipo
- [ ] **M14-05** — `CANCEL_LOT` nel motore (§6): lotto `VOIDED`, turno al chiamante, ruolo invariato,
      niente assegnazioni toccate. L'asserzione sulle tre condizioni, con l'eccezione e non il rifiuto
      (§6). Test puri, **compreso il caso che dimostra che il giocatore torna chiamabile** e quello che
      dimostra che le offerte restano in tabella
- [ ] **M14-06** — ⚠ `LOT_SEALED` fra le fasi che **rifiutano gli override**, in
      `lib/engine/override.ts` **e** in `overrideControls` (§6). È il presupposto di M14-05, non un
      extra: il messaggio è quello che c'è già («c'è un lotto in contesa»)
- [ ] **M14-07** — Le azioni: `showResults` e `cancelLot` in `lib/engine/actions.ts`, con
      `requireOwner` come pausa, ripresa e «Prosegui asta». La riga di `events` per l'annullamento —
      **senza nessun importo nel payload** — e il `case` in `describeEvent` (§6)
- [ ] **M14-08** — La regia: i due pulsanti in `ControlPanel` più il terzo in pausa, con la conferma
      che nomina giocatore e chiamante (§5); `managerControls` con i suoi test puri. Il testo accanto a
      «Metti in pausa» dice cosa succede **adesso**
- [ ] **M14-09** — Il portale: `LotClosedCard` impara lo stato sigillato (⚠ oggi esce subito con
      `reveal === null`), `phaseLabel` prende «buste da aprire», la scelta della card diventa a tre
      vie. Test di `portal.ts`: **il settimo caso di rientro di §8bis**, cioè chi ricarica durante il
      cancello trova il cancello col tempo giusto
- [ ] **M14-10** — La vista TV (§4): la stessa cosa, sul fondo nero, senza `dark:` nuovi altrove
- [ ] **M14-11** — ⚠ `scripts/seed.ts`: il `case` per la fase nuova **e** il cancello corto in
      `DEV_TIMERS` (§8). Il secondo è il punto: senza, `--auction-status=mid` continua a funzionare e
      **non attraversa la fase nuova**, cioè l'unico collaudo locale che gioca un'asta intera è anche
      l'unico che non prova ciò che questa macro aggiunge. Provarlo, non dedurlo
- [ ] **M14-12** — Test con Postgres: I8 durante il cancello — **si asserisce sul payload dello
      snapshot** per partecipante, manager e TV: né `reveal`, né `tie`, e **i crediti e la rosa del
      vincitore identici a prima della chiusura** (è la verifica di §3, l'unica che il modo ovvio non
      avrebbe passato). Più: un lotto annullato non ha assegnazioni, `users` e `players` intatti, il
      lotto è `VOIDED` e **lo storico non ne pubblica le offerte**
- [ ] **M14-13** — Il crash nel cancello (§3c): si ferma il processo con un lotto sigillato, si
      riparte, e il boot recovery **produce lo stesso vincitore**. È la proprietà che questa macro
      rimanda di X secondi, e va provata invece che raccontata
- [ ] **M14-14** — Gate: `pnpm test`, `pnpm typecheck`, `pnpm build` verdi (⚠ build con `pnpm dev`
      spento)
- [ ] **M14-15** — Prova a mano, che i test non sostituiscono: una simulazione con cancello a 10
      secondi, **due dispositivi collegati** più la TV. Si guarda che per dieci secondi **nessuno dei
      tre** mostri qualcosa dei risultati (crediti compresi), poi «Mostra risultati»; poi un secondo
      lotto in cui si mette in pausa e si annulla, e si verifica che il turno torni a chi aveva
      chiamato e che il giocatore sia richiamabile
- [ ] **M14-16** — `docs/ARCHITECTURE.md`: il capitolo della macchina a stati — è la prima fase nuova
      dopo v1.0.0, e il racconto di §3 è la parte che serve a chi leggerà fra sei mesi.
      `docs/DECISIONS.md`: il cancello prima della risoluzione **con la trappola dei crediti**, il
      cancello a ogni chiusura di round (decisione 2 dell'owner, con la misura sul `tie`), lo zero come
      assenza della fase, i due default, `VOIDED` che non sarà mai `RESOLVED`, gli override rifiutati
      nel cancello, e i lotti a idoneo unico senza cancello.
      ⚠ **`CLAUDE.md`: le due righe da correggere** (la rotazione che torna indietro, e le fasi che
      rifiutano gli override): un file che si contraddice è peggio di uno incompleto
- [ ] **M14-17** — Chiusura: merge `--no-ff` su `dev`, prova in locale, poi — **solo su richiesta
      esplicita** — `CHANGELOG.md`, `package.json`, merge su `main`, tag `v1.15.0`, push. ⚠ **E poi
      `pnpm db:push` sul server**, che senza è un'asta che non parte: la colonna non esiste e ogni
      lettura di `auctions` fallisce. Nessun backfill (§ intestazione), e il changelog deve dire con
      parole semplici che le aste già create **non cambiano** finché non si mette un numero in quel
      campo

## Verifica

1. `pnpm test`, `pnpm typecheck` e `pnpm build` verdi.
2. ⚠ **Durante il cancello, dallo snapshot non esce niente dell'esito — crediti compresi.** Si
   asserisce sul payload per tutti e tre gli spettatori, e i crediti del vincitore sono **identici** a
   quelli di prima della chiusura del round. È §3, e la verifica che il modo ovvio avrebbe fallito.
3. **Chi ricarica durante il cancello trova il cancello**, con il countdown giusto — non i risultati e
   non la card viva. È il settimo caso di §8bis, e vale anche a asta in pausa.
4. **«Mostra risultati» apre le buste subito**, e premuto due volte non fa niente.
5. **La pausa congela il cancello**: il countdown si ferma, alla ripresa riparte dal tempo che
   restava, e i risultati non escono nel frattempo.
6. **«Annulla lotto» c'è solo a asta in pausa**, e solo nel cancello: non in `LOT_OPEN`, non nel
   reveal, non in `WAITING_PICK`.
7. **Dopo un annullamento**: il turno è di chi aveva chiamato, il giocatore è richiamabile da chiunque,
   **nessuna assegnazione** è stata creata né annullata, i crediti di tutti sono quelli di prima, e il
   lotto è `VOIDED`.
8. **Lo storico non pubblica le offerte di un lotto annullato**, e la riga di log dice cosa è
   successo, con giocatore e chiamante e **senza nessun importo**.
9. **Un crash nel cancello non cambia il vincitore**: si riparte e il boot recovery risolve lo stesso
   lotto allo stesso modo (§3c).
10. **Con `X = 0` l'asta si comporta esattamente come a v1.13.0**: nessuna fase in mezzo, nessuno
    snapshot in più, i risultati appena il round chiude. È la verifica che rende innocuo il deploy per
    le aste che esistono.
11. **Il pareggio passa dal cancello**: chiuso il round 1 in parità, per X secondi **nessuno sa che
    c'è uno spareggio**, e solo dopo compare l'annuncio con l'importo. È la decisione 2 dell'owner.
12. **Un lotto a idoneo unico non passa dal cancello** e resta istantaneo come oggi (§2).
13. **Gli override sono rifiutati durante il cancello**, con il messaggio che già esiste.
14. **Un'asta si gioca ancora fino in fondo**: una simulazione a 8 arriva a `COMPLETED` con il cancello
    acceso, e `pnpm db:seed --auction-status=mid` funziona.
