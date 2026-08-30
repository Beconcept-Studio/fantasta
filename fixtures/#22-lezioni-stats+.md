# M22 / Stas+ — cronistoria di una sessione, e gli errori che ha prodotto

> Scritto il **2026-08-29**, a chiusura di una sessione di analisi durata due giorni.
> Serve a chi riapre il tema da zero: **cosa è stato provato, cosa ha funzionato, e soprattutto cosa
> è andato storto e come.** Nessuna riga di codice applicativo è stata scritta; la macro non è mai
> stata aperta.
>
> La spec completa è in `docs/features/22-stas-plus.md`. Questo file non la sostituisce: racconta il
> **percorso**, che la spec non può contenere.

---

## 1. La richiesta di partenza

Dal quaderno del 2026-08-28:

> *«Voglio cercare di capire se può esserci un modo per avere dei suggerimenti sui prezzi dell'asta
> in base a come sta andando l'asta live. Come utente ho a disposizione un listone con i PMA, ma non
> sempre vengono rispettati: ogni asta ha le sue peculiarità. […] L'assistente AI deve incrociare
> tutti i dati, e ponderare le risposte anche in base alla tipologia di giocatore che viene
> chiamato.»*

Con l'esempio di Dimarco: un giocatore con numeri fuori scala «merita un discorso a parte», e l'AI
«non deve essere generalista».

**Dove è finita**: dopo tre giri di modellazione e misura, il perimetro si è ridotto a un
**indicatore di sola evidenza** — fatti sull'asta in corso, nessuna stima di prezzo. Il perché è
tutto qui sotto.

---

## 2. Gli approcci, in ordine

### 2.1 Motore statistico gerarchico (abbandonato)

Ancora = `PMA × crediti`. Osservazioni = `ln(pagato/ancora)` sui lotti chiusi. Tre livelli annidati
(asta → ruolo → fascia) con contrazione bayesiana verso zero; dispersione contratta verso un prior;
punteggio di rarità del giocatore per smorzare in modo asimmetrico lo scostamento del mercato; un
modulo di domanda (appetito dei rivali, sostituti residui, tensione, liquidità del tavolo); banda e
soglia di uscita dai quantili.

**Perché è caduto**: mai validato. Ogni misura che lo sosteneva è risultata poi viziata (§4).

### 2.2 Configurazione di lega come input del modello (fuori perimetro, ma le osservazioni restano)

Da `fixtures/guida-fantacalcio.md`. Ha prodotto tre osservazioni che valgono **a prescindere dal
motore** e che nessuno aveva fatto:

- **Il voto puro è calcolabile** dai dati che l'app ha già: `fmvExp − (3·gol + assist)/presenze`.
  È il numero che il modificatore difesa guarda, e i bonus **non** ci entrano.
- **A centrocampo vale la profondità, non il fuoriclasse**: il modificatore somma *tutti* i titolari,
  quindi un 5 annulla un 7. Questo **contraddice** la regola «i C top fanno vincere» che era stata
  data a voce e che era già stata codificata.
- **Il portiere muove tre leve insieme** (porta inviolata, gol subito, voto nel modificatore difesa),
  quindi vale più della sua pagella.

Misurato: la configurazione di lega cambia **3 dei primi 8 difensori** per valore. Non è cosmesi.

### 2.3 Indicatore di sola evidenza (l'approccio corrente)

Cinque fatti, zero stime: quanti dei partecipanti cercano ancora un titolare **di quel livello** in
quel ruolo; com'era dieci lotti fa; chi può contenderti il lotto e con quale `maxBid`; cosa hanno
pagato i comparabili già venduti; quanti ne restano. Più due avvisi, che sono soglie dichiarate su
quei fatti.

**Perché**: un fatto non ha bisogno di essere validato. Una stima sì, e la validazione non c'era.

⚠ **La prima versione di questo approccio era peggiore e va ricordata**: toglieva *ogni* prezzo. Ma
«6 su 8 hanno chiuso la difesa» è utile **solo perché implica «quindi costerà meno»** — togliere il
prezzo non elimina la previsione, la sposta nella testa di chi guarda, dove nessuno la può più
verificare. La versione buona tiene il prezzo a schermo **come prova** (i comparabili), non come
stima.

---

## 3. Errori nel modello

| # | Errore | Come si manifestava | Chi l'ha trovato |
|---|---|---|---|
| 1 | **Appetito a gradino** — «hai già un portiere → non lo vuoi» | «Offri 1» per un portiere titolare, con sette rivali già serviti | **l'owner** |
| 2 | `centro` senza pavimento a `minAmount` | Consigliava **0,55 crediti** | misura |
| 3 | «Campo libero» come etichetta invece che ramo | Il pannello scriveva «parti dal minimo», il motore emetteva **6,6** | misura |
| 4 | Indice di mercato avvelenato dai lotti da 1 credito | Stima dell'umore d'asta a **−22%** contro un vero −6% | misura |
| 5 | Tetto personale che **sostituiva** il numero di mercato | Un attaccante da 141 riceveva «offri 62» senza dire che 62 era il portafoglio | misura |

⚠ **L'errore 1 è il più istruttivo.** L'appetito non è «ce l'hai o non ce l'hai»: è **quanto ci
guadagni**. Chi ha un portiere mediocre compra eccome un portiere forte a tre crediti. Un conteggio
sugli **slot** dice il contrario del vero; serve un conteggio **sul livello**. Questa lezione è
sopravvissuta al cambio di perimetro ed è ora la definizione del fatto n.1 dell'indicatore.

---

## 4. Errori nel banco di prova — i più gravi

Sono i peggiori perché **invalidavano le misure che giustificavano il motore**.

1. **Circolarità.** I banditori simulati avevano dentro **lo stesso gradino** del motore, quindi
   pagavano davvero 1 credito, quindi l'errore misurato su 109 lotti risultava **zero** e la sezione
   sembrava il pezzo migliore della macro. È esattamente ciò che il banco esisteva per evitare.
   → **Regola che ne è uscita: quando il banco conferma una sezione con errore zero, andare a
   guardare se il mondo simulato contiene una copia di quella sezione.**
2. **Curva delle ancore sbagliata.** Ai rincalzi veniva dato un PMA da titolare; il PMA nudo
   risultava sbagliato del **200%** su ogni seme. Nel foglio vero le riserve stanno a `0,2%`.
3. **Costante di conversione mai tarata.** Passando le valutazioni a «punti di lega» è rimasto un
   `× 8.5` scelto a caso: gli attaccanti risultavano comprati all'**1% del loro PMA**.
4. **Manopola «umore globale» che non può esistere.** Se il foglio è tarato sul budget e tutti
   spendono tutto, la deviazione media dal PMA sull'intera asta è **~0 per costruzione**: esiste solo
   la **redistribuzione fra ruoli**. Scoperto grazie allo scenario «ruoli sbilanciati» proposto
   dall'owner. Tutte le misure precedenti ne erano distorte.
5. **Agenti senza pianificazione del budget fra reparti.** Con i modificatori difesa e centrocampo
   che valgono +4 e +3, gli agenti scaricavano tutto su portieri e difensori e arrivavano all'attacco
   senza crediti. Le persone vere tengono da parte. **Non corretto**: è a quel punto che si è deciso
   di fermarsi.

⚠ **Tre errori in tre giri, ognuno dei quali invalidava i numeri del giro precedente.** La
conclusione non riguarda le singole istanze: **costruire da zero un modello generativo di come otto
persone offrono è un compito in cui non si sa quando si è finito di sbagliare.**

---

## 5. Errori di metrica — i più insidiosi

1. **Misurare l'accuratezza invece dell'esito.** «Quanto è precisa la stima» non è «quanto mi aiuta»:
   in busta chiusa **paghi quello che offri**, quindi si può vincere più lotti e finire con una rosa
   peggiore. Un guadagno di accuratezza da 44% a 29% si è tradotto in **+1,9%** di punti attesi.
2. **Includere i lotti da un credito nella mediana.** Metà dei lotti di un'asta va a 1: il motore
   sembrava perfetto perché era bravo a dire «uno». Le mediane vanno calcolate **sui soli lotti
   contesi**.
3. **Cambiare metro a metà esperimento.** Il criterio di falsificazione era stato dichiarato *prima*
   (giustamente) sull'errore di stima; poi è stata scoperta una metrica migliore (i punti attesi) e
   si è passati a quella. È la cosa giusta da fare e **al tempo stesso** invalida la garanzia della
   pre-registrazione. Va dichiarato, non nascosto.
4. **Campione piccolo spacciato per risultato.** Su 40 aste il guadagno risultava **+5,3%**; su 200
   diventava **+1,9%**. Il primo numero era stato riportato all'owner come se fosse solido.

---

## 6. Errori di processo

1. **Mock con numeri inventati presentati come se fossero del motore.** Peggio: erano **internamente
   incoerenti** — il pannello consigliava «offri 1» e due centimetri sotto elencava portieri andati a
   34, 29 e 22. L'incoerenza l'ha vista l'owner, non chi l'aveva scritta.
2. **Verificare con un controllo che non esegue niente.** `new Function(js)` valida la **sintassi**,
   non il funzionamento: una modifica ha lasciato codice morto che leggeva una proprietà su
   `undefined`, la pagina è stata **pubblicata vuota** e il controllo era passato. → **Un artefatto va
   eseguito contro un DOM, e vanno cliccati tutti gli stati.**
3. **Perdere di vista la richiesta.** Sono stati spesi tre giri a costruire un **predittore di
   prezzo** mentre la richiesta era uno strumento di **consapevolezza della stanza** («magari non mi
   accorgo che 6 su 8 hanno già la difesa titolare completa»). L'owner ha dovuto riportare il lavoro
   sul bersaglio.
4. **Modifiche a colpi di sostituzione testuale invece che leggendo il file.** È così che è nato
   l'errore 2.

---

## 7. Cosa resta in piedi

**Fatti, utilizzabili subito, che non dipendono da nessun modello:**

- `scoperti(R,p)` — quanti cercano ancora un titolare **di quel livello** (non «di quello slot»).
- Lo stesso conteggio **dieci lotti fa**: l'occasione sta nel *cambiamento*, non nel livello.
- I rivali per nome col loro `maxBid` — due dati già nello snapshot.
- I comparabili già venduti col prezzo pagato accanto al PMA.
- Quanti ne restano di livello comparabile.

**Vincoli strutturali accertati:**

- Il **budget è chiuso**: le deviazioni dal PMA si redistribuiscono fra ruoli, non si sommano.
- Il consiglio si calcola da **lotti risolti e stato pubblico**, mai dalle buste in corso (I8). Va
  scritto come test: *cambiare le offerte vive non deve cambiare l'indicatore di un credito.*
- Serve **`lotSeq` su `SnapshotRosterEntry`**: senza l'ordine dei lotti non si fanno né i comparabili
  né il confronto temporale. È l'unica aggiunta allo snapshot, ed è pubblica.
- Nel database c'è **una sola asta, simulata, con 37 lotti**. Nessun dato reale.

**Osservazioni di dominio dalla guida** (§2.2 qui sopra): voto puro, profondità a centrocampo, tre
leve del portiere.

---

## 8. Per la sessione di R&D

**La cosa più importante da sapere: la validazione buona esiste e non è una simulazione.** Si
**ricalca un'asta vera** — `lots.seq`, `assignments.price`, `players` sono già tutto quello che
serve — chiedendo al motore cosa avrebbe consigliato a ogni lotto e confrontando col pagato. Nessun
modello di comportamento umano, quindi nessun errore di modello del comportamento umano. Oggi non è
praticabile perché quei dati non esistono; lo diventa il giorno dopo la prima asta vera.

**Domande aperte:**

- Le due soglie degli avvisi («si è svuotata», «si sta chiudendo») sono le uniche cose
  dell'indicatore che non siano aritmetica. Con quali valori, e tarate come?
- Il termometro «quanto si è pagato per ruolo» nella tab è una statistica di lotti chiusi — un fatto.
  Ma somiglia a una stima. Dentro o fuori?
- Vale la pena mostrare un intervallo derivato **solo** dai comparabili (min–max osservati), che è un
  fatto, invece di una banda da modello?
- Il nome: **Stas+** o **Specs+**. Mai deciso; finisce in una colonna del database.

**Da non rifare:**

- Non ricostruire il banco di simulazione sperando che al quarto giro sia giusto.
- Non riportare un numero senza dire su quante aste e con quale separazione taratura/verifica.
- Non far coincidere una formula del mondo simulato con una del motore.
- Non pubblicare un artefatto senza averlo eseguito e cliccato in tutti i suoi stati.

**Artefatti prodotti** (vivono su claude.ai, non nel repo):

- *Banco Stas+* — l'asta simulata con le manopole del motore.
- *Stas+ nel portale* — il mock dell'interfaccia: modale a due colonne e tab, con i cinque scenari.
