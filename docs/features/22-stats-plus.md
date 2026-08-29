# M22 — Stats+: la temperatura dell'asta che stai giocando

> **Stato:** **design**, non aperta. Nessun branch, nessun commit, nessuna riga di codice. Nasce
> dalla richiesta «Analisi realtime offerta adatta» del quaderno del 2026-08-28, che resta in
> `docs/REQUESTS.md` finché la macro non si apre davvero.
>
> ⚠ **Questa spec è la terza stesura, e le due precedenti sono archivio.** La prima costruiva un
> motore statistico di stima del prezzo; la seconda un indicatore di sola evidenza sui posti scoperti.
> Il perimetro definitivo è stato fissato dall'owner il **2026-08-29**, in una sessione di R&D che ha
> rimisurato il problema da capo: **la temperatura dell'asta rispetto ai PMA, per ruolo, azzerata a
> ogni ruolo — più le alternative ancora libere del lotto in corso.** Niente stima di prezzo, niente
> valutazione del giocatore. §10 dice cosa è stato archiviato e dove si rilegge.
>
> ⚠ **Tocca lo schema del database? Sì — una colonna.** `users.stats_plus`, un booleano
> `NOT NULL DEFAULT false`, che un amministratore accende utente per utente come `is_pro` e
> `is_admin` (owner, 2026-08-29). **Il merge su `main` non basta**: dopo il deploy, sul server, con
> nessuna asta `LIVE` o `PAUSED`, serve
>
> ```bash
> cd /home/ploi/fantasta.rggndr.it && pnpm db:push
> pm2 reload deploy/ecosystem.config.cjs --update-env
> ```
>
> **Nessun backfill**, e non è una dimenticanza: `false` per ogni riga esistente **è** lo stato
> giusto — nessuno ha Stats+ finché non glielo si accende. È il contrario di M5, dove il default
> sbagliato spediva ogni utente su una schermata.
>
> ⚠ **E dopo il deploy Stats+ non lo vede nemmeno chi ha fatto il deploy.** L'amministratore **non**
> è implicito (§6), quindi il primo gesto in produzione è accendersi il flag in `/admin/users`.
> Senza, l'applicazione si comporta esattamente come prima e la cosa si diagnostica come «il deploy
> non è passato».
>
> ⚠ **Tocca il motore? Un campo.** `lotSeq` su `SnapshotRosterEntry` in `serializeSnapshot`. Non
> aggiunge transizioni, non tocca `machine.ts`, `rules.ts` né `mutate.ts`, non scrive niente e non
> apre nessun `withAuctionLock`. Ma sta dentro la porta della regola 3, quindi §7 va letto prima di
> scrivere una riga.
>
> **Invarianti coinvolti:**
> **I8** — tutto ciò che Stats+ mostra si calcola da **lotti risolti e stato pubblico**. Un lotto
> risolto è pubblico per definizione; le buste in corso non entrano in nessun conto. §7.3 lo scrive
> come test invece che come promessa.
> **I10** — il pannello resta **funzione pura dello snapshot e del pool**, che il portale ha già
> entrambi. Chi ricarica a metà lotto vede gli stessi numeri di chi non si è mosso, senza nessun
> evento da aver ascoltato al momento giusto.
> **I1, I2** — non toccati e nemmeno sfiorati: qui non si assegna e non si apre niente.
>
> **Regole coinvolte:** **6** (il gate ha due metà e vanno distinte: `is_pro` decide una **query** —
> i PMA a chi non è Pro non arrivano affatto — mentre `stats_plus` decide cosa l'app **mostra** a chi
> quei PMA li ha già. §6 scrive perché la seconda metà non è, e non può essere, una difesa),
> **7** (nessuno stato locale nuovo oltre alla tab selezionata: il pannello non ricorda niente),
> **8** (nessuna astrazione prima del secondo chiamante: un file di calcolo, un tipo, due componenti).

---

## §0 — La richiesta, e le tre volte che il perimetro è cambiato

La richiesta di partenza, dal quaderno del 2026-08-28:

> *«Voglio capire se può esserci un modo per avere dei suggerimenti sui prezzi dell'asta in base a
> come sta andando l'asta live. Come utente ho a disposizione un listone con i PMA, ma non sempre
> vengono rispettati: ogni asta ha le sue peculiarità.»*

E la sua forma definitiva, dall'owner il 2026-08-29:

> *«Togliamo dall'equazione il possibile valore del calciatore, e puntiamo più sul capire il
> termometro dell'asta in corso rispetto ai PMA. Il resto lo lascio come deduzione dell'utente. Le
> uniche stats in più che potresti fornirmi è se quel giocatore estratto ha delle possibili
> alternative di pari livello ancora libere, così che possa decidere come giocarmi lo slot.»*

E, subito dopo, il vincolo che ha dato forma al termometro:

> *«Occhio a lavorare per ruoli, e in modo incrementale. Quando si parte sui portieri, bisogna
> stringere il contesto a quel ruolo. Quando poi si passa ai difensori, la temperatura va resettata:
> un partecipante può puntare forte sui portieri, poco sui difensori, e ripuntare forte sui CC. […]
> Il tool deve essere configurato per essere pronto a dirmi che sui difensori i valori di acquisto
> rispetto a PMA sono totalmente cambiati.»*

| # | Decisione | Data | Alternative scartate |
|---|---|---|---|
| 1 | **Nessun LLM** | 28-08 | lettura offline dei tag; prosa live; lettura a fine asta |
| 2 | **Solo prove osservate**, nessuna cifra da un modello | 29-08 | prove + banda derivata; una stima vera |
| 3 | **Il valore del giocatore esce dal perimetro** | 29-08 | valore di lega in app; ranking per ruolo |
| 4 | **La temperatura è per ruolo e si azzera** | 29-08 | temperatura cumulativa d'asta |
| 5 | **Le alternative si catalogano sulla titolarità**, non sul prezzo | 29-08 | solo fascia; solo PMA |
| 6 | **Il «ripiego» sta nella tab e non nel modale** | 29-08 | mostrarlo ovunque; non mostrarlo mai |

---

## §1 — Il perimetro, in una pagina

**Cosa fa.** Due cose, e nessun'altra.

1. **Il termometro** — quanto il tavolo sta pagando rispetto ai PMA, **nel ruolo in corso**, con il
   saldo che i ruoli chiusi hanno lasciato e lo scatto interno al ruolo.
2. **Le alternative** — chi altro, ancora libero, può riempire lo stesso slot del giocatore chiamato.

**Cosa non fa.** Nessun prezzo consigliato, nessuna banda, nessuna soglia di uscita, nessun giudizio
su quanto valga un giocatore, nessun ordinamento «i migliori da prendere». ⚠ **E questo chiude da sé
l'obiezione del 2026-08-12** su `prezzo-consigliato.tsx`: non c'è nessun numero suggerito accanto al
campo dell'offerta, quindi non c'è il suggerimento «che qualcuno segue senza pensarci». Vedi §5.3.

**Perché di sola evidenza.** Perché un fatto non ha bisogno di essere validato e una stima sì, e la
validazione non c'è: nel database c'è **una sola asta, simulata, con 37 lotti risolti** (verificato il
2026-08-29). Tre giri di simulazione hanno prodotto tre errori nel modello del comportamento umano,
ognuno dei quali invalidava i numeri del giro precedente. La storia è in
`fixtures/#22-lezioni-stats+.md` e non si ripete.

---

## §2 — Il fondamento: il PMA non è un prezzo, è una ripartizione del mercato

⚠ **Questa sezione è misurata, non ragionata, e tutto il resto della macro poggia su di essa.**
Misura fatta il 2026-08-29 su `fixtures/Classic Relative.xlsx`, 519 righe.

**La somma di tutti i PMA del foglio fa 993%**, cioè **dieci rose complete**. E la massa si divide fra
i reparti così:

| | P | D | C | A | totale |
|---|---|---|---|---|---|
| massa PMA | 97% | 203% | 297% | 396% | 993% |
| quota | **10%** | **20%** | **30%** | **40%** | 100% |

Chi compila il foglio non prevede il prezzo di Bastoni: **divide il denaro del tavolo fra i reparti e
poi lo spalma sui giocatori**. Le tre conseguenze che rendono possibile questa macro:

1. **Il budget è chiuso.** Se la difesa assorbe il 14% della spesa contro un piano del 20%, quei
   crediti non sono spariti: sono in tasca a qualcuno e usciranno altrove. Non è una previsione, è
   un'identità contabile. È ciò che rende il termometro un fatto e non una stima.
2. **La quota di piano si legge dal foglio caricato**, non è una costante nel codice:
   `piano(R) = massa PMA del ruolo R ÷ massa PMA totale`. Un foglio tarato diversamente porta con sé
   il proprio piano, e nessuno deve ricordarsi di aggiornare un numero.
3. **Il rapporto `pagato ÷ PMA` è confrontabile fra ruoli**, perché il PMA è già una quota di budget.
   0,8× fra i portieri e 0,8× fra i difensori vogliono dire la stessa cosa.

### 2.1 La fascia è lo slot di rosa, e questo cambia le domande in conteggi

`Fascia` non è un'etichetta di prezzo: è **lo slot che quel giocatore serve a riempire**. Dal
`1° Slot Relativo` all'`8°` per D e C, fino al `6°` per gli A, con **esattamente dieci candidati per
slot** — uno per rosa. I portieri hanno un vocabolario suo (`top`, `semitop`, `secondi scomodi`,
`da abbinare`), che è la stessa idea con nomi diversi.

E **Dimarco ha una fascia tutta sua, di una riga sola**: la domanda da cui la macro era nata — *«merita
un discorso a parte»* — aveva già una risposta scritta a mano nel foglio. ⚠ **La prima stesura ha
speso un'intera sezione (§4, la «rarità») a costruire un percentile statistico per dedurre quello che
il dato dichiarava.** È l'errore da non rifare: **prima di modellare una proprietà, guardare se il
foglio la scrive già.**

⚠ **Ma la fascia da sola non è una classe di equivalenza**, ed è la correzione dell'owner del
2026-08-29 (*«quanto è titolare Bastoni rispetto ad Hermoso?»*). Misurato: dentro la stessa fascia il
giudizio di titolarità va da **3/5 a 5/5**, e il PMA lo spiega solo a metà — correlazione mediana
`PMA ~ titolarità` dentro fascia: **+0,50** in difesa, **+0,25** a centrocampo, **+0,45** in attacco.
Vedi §4.1.

### 2.2 Siete in otto su un foglio tarato per dieci

Con 8 rose da 500 crediti al tavolo ci sono **4.000 crediti**; il listone ne vale **4.965** ai prezzi
del foglio. Circa **un quinto del valore non verrà comprato da nessuno**, e in ogni fascia da dieci
candidati **ne avanzano due**.

⚠ **Questo non è un'occasione: è la nuova unità di misura, e va detto perché è la trappola numero uno
del termometro.** Con otto partecipanti si paga strutturalmente sotto il PMA **ovunque**, quindi un
`0,85×` non è uno sconto: è la norma. L'informazione sta nella **differenza fra un reparto e l'altro**
e nel **cambiamento nel tempo**, mai nella distanza dal PMA nudo. Il pannello lo dichiara (§5.2),
invece di lasciare che chi legge scambi lo scarto strutturale per un affare.

---

## §3 — Il termometro: due orologi, non uno

⚠ **La sezione nasce dal vincolo dell'owner del 2026-08-29**, ed è la sua forma esatta. Non è una
raffinatezza: un termometro cumulativo direbbe «l'asta sta pagando 0,9×» proprio mentre i difensori
schizzano a 1,3×, perché i portieri andati a 0,5× continuerebbero a pesare per sempre.

**E non è nemmeno solo una scelta di prodotto: è la forma vera dell'asta.** `machine.ts:152` rifiuta
la chiamata di un giocatore fuori dal ruolo corrente — *«In questo momento si chiamano i P, non i D»*.
L'asta **è** sequenziale per ruolo, e il termometro segue quella sequenza invece di ignorarla.

| | si azzera al cambio di ruolo | si accumula |
|---|---|---|
| **La temperatura** — quanto si paga rispetto al PMA | ✅ | |
| **Il vincolo** — crediti spesi, slot riempiti, `maxBid` | | ✅ |

### 3.1 La temperatura del ruolo in corso

```
rapporto(lotto) = prezzoPagato / (pma(giocatore) / 100 × budgetIniziale)

temperatura(R) = i rapporti dei lotti informativi del ruolo R, come punti osservati
```

⚠ **Come punti, non come media.** Con quattro lotti chiusi una media è un numero con la stessa faccia
sicura di una calcolata su quaranta, e chi legge non può distinguerle. Si mostrano il minimo, la
mediana, il massimo **e quanti lotti li producono** — «te lo dico su 4» e «su 40» sono due
affermazioni diverse e chi legge ha diritto di distinguerle.

⚠ **Niente contrazione bayesiana, niente prior, niente `k`.** La prima stesura le aveva (§3.2
archiviata) ed erano il punto in cui l'evidenza diventava stima. Con pochi dati il termometro dice
«pochi dati», non un numero addolcito.

### 3.2 Il saldo dei ruoli chiusi — l'unico ponte fra i due orologi

È ciò che fa tornare il reset con il budget chiuso di §2. Un ruolo che si chiude non svanisce:
consegna un residuo.

```
speso(R)   = Σ prezzi pagati nel ruolo R da tutti i membri
piano(R)   = massa PMA del ruolo R ÷ massa PMA totale        (§2)
saldo(R)   = piano(R) × budgetTotaleTavolo − speso(R)
```

> **Portieri — chiusi.** Il tavolo ci ha messo il **6%** del budget contro un piano del 10%.
> Restano **~160 crediti** in più del previsto per D, C e A.

⚠ **Il saldo si mostra solo per i ruoli finiti**, non per quello in corso: a metà ruolo `speso(R)` è
un parziale e il confronto con l'intero `piano(R)` direbbe sempre «avanza tantissimo». È un errore che
si scrive da solo se la formula viene riusata senza guardare quale ruolo si sta guardando.

### 3.3 Lo scatto dentro il ruolo

Non un livello: un confronto fra l'inizio e l'adesso del **ruolo in corso**, ordinato per `lotSeq`.

```
prima  = mediana dei rapporti della prima metà dei lotti informativi del ruolo
adesso = mediana dei rapporti della seconda metà
```

> **Difensori — 18 lotti.** Primi 9 a **0,71×**, ultimi 9 a **1,08×**.

⚠ **Sotto gli 8 lotti informativi lo scatto non si calcola e non si mostra.** Quattro contro quattro è
il minimo sotto cui due mediane sono due aneddoti. Finché non ci si arriva restano i punti osservati
col loro numero accanto.

### 3.4 Il filtro sull'ingresso, e qui la sessione precedente va corretta

La spec archiviata escludeva dall'indice i **lotti chiusi al prezzo minimo**, dopo aver misurato che
avvelenavano la stima (−22% contro un vero −6%). **La diagnosi era giusta e il rimedio è sbagliato**:
filtrare sul **prezzo pagato** significa scartare esattamente gli esiti bassi, e la temperatura
risulta sistematicamente più calda del vero. È selezione sull'esito.

Il filtro giusto è sull'**ingresso**:

```
lotto informativo  ⟺  pma(giocatore) / 100 × budgetIniziale ≥ 5 crediti
                      e lotSeq !== null                     (§7.2: non è un'assegnazione manuale)
```

È una proprietà del **giocatore chiamato**, nota prima che il lotto si apra, quindi non seleziona
nulla in base a come è finito. Serve perché **il 58% del listone vale un credito** (302 righe su 519,
misurato il 2026-08-29): un lotto su un giocatore da un credito non porta informazione qualunque cifra
faccia.

⚠ **E i lotti scartati non spariscono: diventano un fatto loro.** «9 degli ultimi 12 lotti sono andati
al minimo» è a sua volta una temperatura — dice che il tavolo non sta contendendo niente — e va
mostrata accanto, non nascosta dentro una media.

⚠ **La soglia dei 5 crediti è dichiarata, non tarata**, e va scritta come costante con il suo perché
accanto. Con un budget diverso da 500 resta una soglia in **crediti**, non in punti di PMA: cinque
crediti sono la cifra sotto la quale una contesa non c'è.

### 3.5 I due avvisi, con le soglie dichiarate

L'unica cosa dell'indicatore che non sia aritmetica nuda, e sono **soglie su fatti**, non un modello.

- **CAMBIO D'ARIA** — il ruolo in corso paga ≥ **0,25×** sopra o sotto quello precedente, con almeno
  4 lotti informativi per parte.
- **SCATTO** — dentro il ruolo, `adesso − prima` ≥ **0,25×** in valore assoluto, con almeno 4 lotti
  informativi per parte (cioè 8 in tutto, come §3.3).

Fuori da questi due casi **nessun avviso**: i numeri bastano e non si inventa un terzo stato per
riempire lo spazio.

⚠ **0,25 è scelto, non misurato, e va detto.** È un quarto di PMA, cioè su un giocatore da 40 crediti
una differenza di dieci: la soglia sotto la quale un cambiamento non cambia una decisione. Si rivede
dopo la prima asta vera, ed è l'unico numero di questa macro che lo richieda.

### 3.6 La lettura per partecipante

La domanda dell'owner — *«ci può essere qualcuno più prudente su quel determinato ruolo, che
probabilmente sta risparmiando per i ruoli successivi»* — diventa un conto, perché la fascia **è** lo
slot (§2.1).

```
grezza(R,k)    = PMA mediano della fascia k-esima del ruolo R      (dal foglio caricato)
pianoSlot(R,k) = grezza(R,k) × piano(R) × 100 / Σⱼ grezza(R,j)     ⚠ normalizzata, vedi sotto

per ogni membro m:
  speso(m,R)  = Σ prezzi dei suoi acquisti nel ruolo R
  piano(m,R)  = Σ pianoSlot(R,k) per k = 1..(quanti ne ha presi)   × budgetIniziale / 100
  scarto(m,R) = speso(m,R) − piano(m,R)
```

I suoi acquisti si ordinano **per prezzo decrescente** e si confrontano con la scala delle fasce dal
1° slot in giù. Non è una deduzione su cosa avesse in testa: è il modo in cui il foglio stesso ordina
gli slot.

⚠ **La normalizzazione non è cosmesi, ed è un difetto trovato costruendo il mock (2026-08-29).** La
scala grezza — «il PMA mediano della 1ª fascia, più quello della 2ª, ecc.» — **non somma a 100**: sul
foglio di riferimento fa **116,6%**, e il gonfiaggio non è nemmeno distribuito (P **+10,0** punti, D
**+11,2**, C −3,5, A −1,1). La ragione è strutturale: la scala assume che ognuno prenda il *mediano*
di ogni fascia, ma **le fasce alte non hanno abbastanza giocatori per tutti** — cinque portieri `top`
e due `semitop` per otto squadre.

Senza normalizzare, **ogni partecipante risulta «sotto piano» del 17%** e la tabella dice che tutti
stanno risparmiando, cioè non dice niente. Con la normalizzazione per ruolo gli scarti misurati sullo
stesso stato diventano `+17, −15, −26, −23, −39, −43, −40, −50`: uno spread leggibile, e chi ha speso
più del piano si distingue.

⚠ **Si normalizza per ruolo e non globalmente**, così `Σₖ pianoSlot(R,k) = piano(R)` e §3.6 non può
mai contraddire §3.2 — le due letture poggiano sullo stesso numero per costruzione invece che per
coincidenza.

> **Marco** — ha chiuso P e D col **41%** del budget; per quegli slot il piano dice **30%**.
> Gli restano 4 attaccanti col 59% invece del 70%.
> **Luca** — **19%** invece di 30%. Ha 11 punti di fuoco in più per quello che resta.

⚠ **Si mostra il numero e non l'intenzione.** «Ha speso l'11% in più del piano» è un fatto; «sta
risparmiando per l'attacco» è una lettura, e la fa l'owner. È la sua frase: *«il resto lo lascio come
deduzione dell'utente».*

---

## §4 — Le alternative del lotto in corso

### 4.1 Perché la fascia e il PMA, da soli, mentono

Il caso che l'owner ha portato, misurato sul foglio:

| | fascia | PMA | **titolarità** | pres. da titolare | tag |
|---|---|---|---|---|---|
| **Bastoni** | 1° Slot | 6,2% | **5/5** | 28 | `titolarissimo` |
| **Hermoso** | 3° Slot | 2,2% | **3/5** | 25 | `cartellini` |
| **Bisseck** | 2° Slot | 4,4% | **3/5** | 21 | **`subentrante`** |

⚠ **E il problema è generale, non aneddotico.** Dentro la stessa fascia il giudizio di titolarità va
da 3/5 a 5/5 in ogni ruolo, e la correlazione con il PMA è **+0,50 / +0,25 / +0,45** (D / C / A):
metà della variazione di prezzo dentro una fascia **non** è titolarità, e metà della titolarità **non**
è nel prezzo. Un catalogo costruito su fascia e prezzo direbbe che Bisseck sostituisce Bastoni.

I tre segnali di titolarità che l'app ha già, e che sono indipendenti fra loro:

- `carmy.titolarita` — il giudizio 1–5 di chi ha compilato il foglio;
- `carmy.tags` — `titolarissimo` e `subentrante` sono due delle 17 etichette chiuse;
- `insights.startsEleven / insights.presenze` — dalla fonte giornaliera, aggiornato ogni giorno.

Il catalogo usa **`carmy.titolarita`** come chiave, perché è l'unico che esiste per ogni riga del
foglio e perché è **la scala su cui l'owner ha già ragionato quando ha marcato gli obiettivi**. Gli
altri due si **mostrano** accanto (§4.3), e una discordanza è informazione: un `5/5` con
`startsEleven` basso è un giudizio che il campo non ha confermato.

### 4.2 I tre gruppi, e la regola asimmetrica

```
libero(p)  ⟺  p non compare in nessuna rosa dello snapshot
```

⚠ **«Libero» si deduce dalle rose, non da una query sul pool**: il pool sono cinquecento righe
immutabili dall'import in poi, chi sia ancora libero è funzione dello stato (già scritto in
`types.ts`).

Con `Δrank = fasciaRank(alternativa) − fasciaRank(chiamato)` — positivo vuol dire **fascia più
bassa**, cioè più economica:

| gruppo | regola | cosa dice |
|---|---|---|
| **Pari livello** | libero · `titolarità ≥` · `−1 ≤ Δrank ≤ 1` | veri sostituti dello slot |
| **Costano meno** | libero · `titolarità ≥` · `2 ≤ Δrank ≤ 3` | puoi permetterti di non salire |
| **Ripiego** | libero · `titolarità <` · `0 ≤ Δrank ≤ 1` | ti riempie lo slot, non te lo risolve |

⚠ **L'asimmetria sulla titolarità è il punto della sezione, non un dettaglio.** Se chiami un 5/5, un
3/5 **non** è un'alternativa; se chiami un 3/5, un 5/5 lo è eccome — costa solo di più. Un test
simmetrico (`|Δtitolarità| ≤ 1`) direbbe che Bisseck sostituisce Bastoni, che è la cosa sbagliata, e
la direbbe con la stessa faccia sicura.

⚠ **Il secondo gruppo è l'unico che risponde a «posso rischiare una puntata più bassa», ed era assente
dalla prima stesura di questa sezione** (trovato costruendo il mock, 2026-08-29): la regola scritta
allora aveva tre casi che **non coprivano** «fascia più economica ma titolarità pari o migliore», che
è esattamente l'occasione. Quei giocatori cadevano fuori da ogni gruppo e sparivano dal pannello.

⚠ **E `Δrank ≤ 3` non è arbitrario: senza limite il conteggio smette di discriminare.** Misurato su
otto chiamati diversi: senza limite il gruppo va da 5 a 21 e non distingue niente; con `≤ 3` va da 1 a
7 e cambia da giocatore a giocatore. Oltre tre gradini di slot non stai scegliendo un'alternativa per
lo stesso posto, stai scegliendo una rosa di forma diversa — e la domanda è un'altra.

⚠ **Il «ripiego» è limitato a `Δrank ≤ 1` per la stessa ragione**: senza, contiene tutto il fondo del
listone e non è un catalogo, è un elenco.

⚠ **«Fascia superiore» e «inferiore» si leggono da `fasciaRank`**, che M21 §5 ha già messo nel pool e
che è risolto per utente: il proprio se si è caricato il file personale, quello globale altrimenti. Il
catalogo lo eredita senza saperne niente.

⚠ **Un giocatore senza `carmy` non entra in nessun gruppo**, e il pannello lo dice invece di
ingoiarlo: senza fascia e senza titolarità non c'è nessun criterio per catalogarlo. Nel foglio di
riferimento sono 67 righe senza PMA.

### 4.3 Cosa si mostra di ognuno

I fatti che discriminano, **non un punteggio**: titolarità (1–5), presenze da titolare, i tag, il PMA
in crediti, e se è un tuo obiettivo. In quest'ordine, perché è l'ordine in cui si decide.

⚠ **Nessun ordinamento «i migliori»**, che sarebbe il valore del giocatore rientrato dalla finestra.
Si ordina per **PMA decrescente** — il più caro per primo — che è un fatto e non un giudizio.

---

## §5 — Dove si vede

### 5.0 I numeri si dicono in percentuale, non in multipli

⚠ **Decisione dell'owner del 2026-08-29, guardando il mock**: *«mi servono dei dati anche più
immediati»*. Ovunque un rapporto vada a schermo si scrive **`−25%`**, non `0,75×`, e accanto **lo
scarto in crediti** quando esiste un prezzo concreto: `Molina · PMA 36 → 27 · −9 crediti, −25%`.

Non è una preferenza estetica. `0,75×` chiede una moltiplicazione a chi ha ventiquattro secondi di
countdown; `−25%` e `−9 crediti` sono già la risposta. Il calcolo resta il rapporto di §3.1 — cambia
solo come si scrive: `(rapporto − 1) × 100`.

### 5.1 Il modale: una riga sul telefono, un pannello sul desktop

**Sul telefono, una riga sola**, sotto l'input:

> `Scatto: D da −25% a +14% · 5 pari livello, 2 tuoi`

⚠ **«Una riga» è un vincolo di caratteri, non un'intenzione, ed è misurato** (mock del 2026-08-29): a
384px, con `text-xs`, oltre **~45 caratteri** la riga va a capo e il blocco passa da **31px a 49px**.
Cioè rimette esattamente i 44px che M16 aveva restituito al campo, senza che nessuno l'abbia deciso.
La prima stesura di queste righe ci era già cascata. Le forme che stanno dentro il budget sono
telegrafiche di proposito — `Difensori −25%`, non `I difensori stanno a −25% sul PMA` — e il test di
§9.1 misura **tutte** le varianti, non una.

⚠ **E non due, e il perché è già scritto nel file.** Il commento di M16 in `bid-modal.tsx` dice perché
la riga dei valori suggeriti è stata tolta: *«i ~44px che la riga occupava sono altezza restituita al
campo, che con la tastiera aperta è la risorsa scarsa»*. Una seconda riga rimetterebbe quell'altezza,
in mezzo fra il campo e il suo verdetto, disfacendo una decisione presa apposta.

**Da `sm:` in su il modale si allarga e si divide in due colonne** (owner, 2026-08-29): a sinistra
l'offerta com'è oggi, a destra una sezione Stats+ estesa. E in due tempi, perché i quattro blocchi
della sezione stanno affiancati solo se c'è davvero lo spazio:

```
             larghezza      la colonna Stats+
< sm         piena          nessuna — solo la riga sotto l'input
sm:          46rem  736px   i 4 blocchi in colonna
xl:          64rem 1024px   i 4 blocchi in griglia 2×2
```

`grid-cols-[384px_1fr]` in tutti e due i casi: **la colonna sinistra resta 384px sempre**, cioè
identica al telefono. A cambiare è solo quanta aria ha quella destra.

⚠ **La griglia 2×2 accoppia i blocchi che si leggono insieme, e l'accoppiamento è il punto**
(owner, 2026-08-29): **temperatura accanto ai già andati** — il livello del ruolo accanto alle prove
che lo producono — e **pari livello accanto a costano meno** — le due liste fra cui si sceglie. Un
ordine in colonna singola mette quattro blocchi in fila e lascia al lettore il compito di appaiarli.

⚠ **Il raddoppio vale solo da `sm:`, ed è la ragione per cui non contraddice M16.** Sotto `sm:` il
modale è `fixed inset-x-0 bottom-0`, cioè un foglio che sale dal basso su uno schermo dove l'altezza
è contesa dalla tastiera: lì non cambia **niente**. Da `sm:` in su è una card flottante in basso a
destra su uno schermo dove lo spazio orizzontale abbonda e la tastiera non copre nulla.

⚠ **E qui va corretta un'assunzione della spec archiviata**, che dava per esistente una «colonna
destra desktop»: **non esisteva**. Il modale era `sm:w-96` in ogni caso, cioè 384px anche su desktop
— **più stretto di un iPhone 15 Pro** (393px). La colonna adesso c'è perché questa macro la
**crea**, non perché fosse lì.

#### La sezione Stats+ della colonna destra

**Quattro riquadri**, appaiati due a due (§5.1): in alto la temperatura accanto ai già andati, in
basso le due liste. Sotto `xl:` scendono in colonna, in quest'ordine.

**1. Temperatura** — il ruolo in corso, in percentuale, coi due regimi quando c'è uno scatto:

> **+14%** sul PMA · difensori, 18 lotti
> prima −25%, adesso +14% · sul totale il ruolo ha speso 63 crediti in meno del foglio

**2. Già andati della stessa fascia** — il blocco che l'owner ha chiesto per nome, e il più diretto
dei tre: **quanto è costato davvero chi occupava lo stesso slot**, in ordine di lotto, con lo scarto
in crediti e in percentuale.

> `Molina N.  PMA 36 → 27   −9 cr  −25%`
> `Solet      PMA 29 → 21   −8 cr  −28%`
> `Kalulu     PMA 26 → 30   +4 cr  +15%`
> `Bisseck    PMA 22 → 25   +3 cr  +14%`
> *6 andati su 10 · ne restano 3 oltre a questo*

⚠ **In ordine di lotto, non di prezzo**, ed è la differenza fra un elenco e un'informazione: così si
**vede** dove il mercato ha girato. Nell'esempio la fascia si ribalta esattamente fra il secondo e il
terzo nome, che è lo stesso scatto di §3.3 letto da vicino.

⚠ **Se la stessa fascia ha meno di 3 lotti chiusi si allarga alle fasce adiacenti** (`|Δrank| = 1`),
dicendolo. Meglio quattro comparabili dichiarati un gradino sopra che due comparabili perfetti su cui
non si può leggere niente.

**3 e 4. Pari livello** e **Costano meno** — i due gruppi utili di §4.2, un riquadro per ciascuno; il
**ripiego** resta fuori dal modale e vive nella tab (decisione 6). Ogni riga porta, in quest'ordine:

```
🔖  Couto  COM   [T 4/5]  [FMV 6.17]                     16
```

il **segnalibro dell'obiettivo**, nome e squadra, il badge di **titolarità**, il badge della
**fantamedia attesa**, e a destra il **prezzo medio atteso** in crediti.

⚠ **Il segnalibro è `IconaObiettivo` di `listone-table.tsx`, non un'icona nuova**: `Bookmark` di
lucide, `size-4`, `fill-emerald-600 text-emerald-600` quando è un obiettivo e
`text-muted-foreground/40` quando non lo è. E **sta su ogni riga, verde o grigio**, che è già una
decisione presa (owner, 2026-08-28, scritta nel file): *«una colonna che a volte c'è e a volte no si
legge come un difetto di allineamento»*. Il componente si estrae da `listone-table.tsx` e diventa il
primo caso di **due chiamanti** — che è la condizione della regola 8, non una sua deroga.

⚠ **Niente conteggi di partite nelle righe** (owner, 2026-08-29). `T 4/5` è il giudizio del foglio e
basta a decidere; «30 presenze da titolare» è un numero in più da leggere in venti secondi, e il
posto in cui si confrontano i giocatori è la tab Listone, non il modale d'offerta. È la stessa
distinzione che `InsightsMacro` fa già: *«qui non si confronta, si decide una cifra»*.

⚠ **`FMV` e non `FVM`.** Il foglio chiama quella colonna `FMV Exp.` e l'app la importa come
`carmy.fmvExp`. La distinzione non è pedanteria: nello snapshot esiste già `SnapshotPlayer.fvm`, che
è il **fantavalore di mercato** — un prezzo, un intero come `80` — e due etichette a una lettera di
distanza per un prezzo e per una media sono il genere di ambiguità che si paga fra sei mesi.

**Il punto d'innesto esiste già** ed è libero: la riga `<PrezzoConsigliato carmy={carmy} dove="campo" />`
in `bid-modal.tsx`, fra il campo dell'offerta e `<FeedbackLine>`. Oggi tace, perché
`POSIZIONE_PREZZO = "macro"`.

⚠ **Sotto l'input e non sopra, e non è layout: è la risposta all'obiezione del 2026-08-12** (§5.3).
Sopra il campo, un'informazione arriva **prima** della decisione e la sostituisce; sotto, l'ordine di
lettura si inverte — prima vedi la cifra che stai scrivendo, poi il contesto. Chi lo vuole lo trova,
chi ha già deciso ha già digitato.

⚠ **La colonna destra non tocca l'altezza di niente**, e va detto perché è ciò che rende
l'allargamento gratuito: sta **accanto** alla colonna dell'offerta, non sopra né sotto. Il campo, il verdetto e la
conferma restano ai pixel in cui sono oggi, e chi guarda la sinistra vede lo stesso modale di sempre.
⚠ **La colonna destra è più alta di quella sinistra, misurato: a 1024px di ~190px.** Sotto «Chiudi»
resta spazio vuoto, ed è la conseguenza accettata di tenere la colonna dell'offerta identica al
telefono. La cosa da sorvegliare è l'altra: su uno schermo basso la destra spingerebbe «Conferma»
sotto il bordo, quindi **scorre nel proprio contenitore** (`overflow-y-auto`) invece di allungare la
card. Va guardato su un portatile vero (§9.2), non deciso qui.

⚠ **Fondo neutro (`bg-muted`) e nessun colore**, come tutto ciò che non è una fase. Nel portale il
colore **significa una fase**: `SceneTone` e la fascia da 4px della colonna 3 (M17 §3) parlano quel
vocabolario, e ciò che si percepisce in periferia dell'occhio è la striscia che cambia. **L'unica
eccezione sono i due avvisi di §3.5**, che sono l'unico caso in cui il colore *è* informazione — e
proprio perché il resto è neutro, lì si vedono. `border-amber-500/40 bg-amber-500/10` è già il
vocabolario di `FeedbackLine` per «guarda questo».

⚠ **E niente `dark:`**, come ovunque fuori dalla TV.

### 5.2 La tab Stats+

Una terza linguetta accanto ad `Asta` e `Listone`, cioè un `<Linguetta value="stats">` in `PortalTabs`
e un `<Tabs.Content value="stats">` in `portal.tsx`. **Non una rotta**: due rotte smonterebbero
`Portal`, quindi `useAuctionStream`, quindi la connessione SSE — la nota è già scritta su
`Tabs.Root`.

Quattro blocchi, in quest'ordine:

1. **Il ruolo in corso** — la temperatura (§3.1), i lotti su cui poggia, i lotti andati al minimo, e
   lo scatto (§3.3) quando c'è.
2. **I ruoli chiusi** — una riga per ruolo col saldo (§3.2).
3. **I partecipanti** — la tabella di §3.6: speso, piano, scarto, slot residui, `maxBid`.
4. **Le alternative del lotto in corso** — i tre gruppi di §4.2, **ripiego compreso**: è qui che vive,
   e non nel modale (decisione 6).

⚠ **Il blocco 4 esiste solo con un lotto aperto.** Fuori da `LOT_OPEN` la tab mostra i primi tre e lo
dice; non è un errore da gestire, è uno stato normale.

⚠ **La riga dello scarto strutturale sta in testa alla tab, sempre**: «Siete in 8 su un foglio tarato
per 10: si paga sotto il PMA ovunque, guarda le differenze fra reparti» (§2.2). Senza, il primo
`0,85×` verrà letto come un affare.

### 5.3 Il conflitto con la decisione del 2026-08-12, e perché stavolta non c'è

`components/auction/prezzo-consigliato.tsx` esiste perché l'owner ha guardato il prezzo consigliato
accanto al campo dell'offerta e ha deciso di **non metterlo lì** (`POSIZIONE_PREZZO = "macro"`). Le due
ragioni scritte nel file:

1. *«una cifra suggerita accanto a una cifra da digitare è un suggerimento che qualcuno segue senza
   pensarci»* — non descrive un giocatore, **propone un'azione**;
2. *«se otto persone su otto hanno il file, il prezzo consigliato smette di essere un vantaggio
   informativo e diventa un prezzo di listino»*.

**Nessuna delle due si applica a Stats+ come è oggi**, e va scritto perché nella prima stesura si
applicavano entrambe: quella metteva una banda e una soglia esattamente dove la decisione aveva tolto
un numero. **Qui non c'è nessuna cifra da offrire** — c'è un rapporto misurato su lotti già chiusi e
un conteggio di giocatori liberi. Non propone un'azione, descrive la stanza. E non può diventare un
listino, perché il numero nasce dall'asta viva: due persone con rose diverse leggono la stessa
temperatura ma hanno alternative diverse.

Si tratta comunque come M10B — **una costante sola, con tutte le forme scritte**, gemella di
`POSIZIONE_PREZZO`:

```ts
export const POSIZIONI_STATS = ["campo", "tab", "entrambi", "spento"] as const;
export const POSIZIONE_STATS: PosizioneStats = "entrambi";
```

Spegnere Stats+ in tutta l'applicazione vuol dire scrivere `"spento"` qui, e **non** togliere del
codice.

---

## §6 — Il gate: `is_pro` **e** `stats_plus`, assegnato dall'amministratore

⚠ **Questa sezione è stata riscritta il 2026-08-29, all'apertura della macro, e diceva l'opposto.**
La versione precedente concludeva «nessuna colonna: il gate è `is_pro`». L'owner ha deciso che
**Stats+ si assegna, come il Pro e come l'Admin**: una colonna sua su `users`, un interruttore suo nel
pannello di amministrazione. Il testo vecchio si rilegge con
`git show <commit di apertura>^:docs/features/22-stats-plus.md`, e sotto c'è cosa di quell'argomento
resta valido — perché una parte resta, ed è la parte che decide **dove gira il calcolo**.

### 6.1 La forma

```ts
// lib/domain.ts, accanto a canSeeInsights
canSeeStatsPlus(user) = canSeeInsights(user) && user.statsPlus === true
```

**L'`AND` con Pro non è una cautela in più: è forzato dai dati.** Senza `is_pro` la chiave `carmy`
non arriva affatto nel payload (M8 §6, M10B §7) — niente PMA, niente fasce, niente titolarità. Un
`stats_plus` senza Pro sarebbe un pannello vuoto, cioè un interruttore che promette e non fa. Il
pannello di amministrazione **lo dice con una frase** invece di disabilitare la casella: disabilitarla
imporrebbe un ordine fra i due interruttori, e un ordine obbligato è una cosa in più da ricordare.

### 6.2 L'amministratore **non** è implicito

⚠ **E qui la differenza con `canSeeInsights` è di sostanza, non una svista da uniformare.** Là
l'implicito esiste per una ragione scritta in `schema.ts`: un amministratore deve poter guardare i
dati che ha appena importato, altrimenti dovrebbe auto-assegnarsi il flag per verificare il proprio
lavoro. **Stats+ non ha quel bisogno** — non è un dato importato, è una lettura dell'asta viva — e
renderlo implicito costerebbe l'unica prova che §9.2 chiede: aprire il portale **senza** Stats+ per
vedere com'è.

Un amministratore può accendersi il flag da sé: `setUserPro` permette di toccare la propria riga
apposta (`lib/engine/admin.ts:407`, con il perché), e `setUserStatsPlus` la rispecchia riga per riga.

### 6.3 Il calcolo resta nel browser, e il flag non è una difesa

⚠ **Va scritto per esteso, perché è l'unico punto in cui questa macro dice una cosa scomoda su se
stessa.** Un utente Pro **senza** `stats_plus` riceve comunque i PMA e lo snapshot, cioè **tutti gli
addendi**. Il flag decide che cosa l'applicazione **mostra**, non che cosa quel browser **può sapere**:
chi apre DevTools ha gli ingredienti in entrambi i casi.

Non è un difetto da correggere spostando il calcolo sul server, ed è la parte dell'argomento archiviato
che **resta valida capovolta**. Quella spec diceva: *«un gate lato client su un browser che ha tutti
gli input è una decorazione — quindi il calcolo va sul server»*. L'argomento era corretto **quando il
calcolo era un motore statistico**, cioè quando il valore stava nel modello. Ora il calcolo è: contare
giocatori liberi, dividere crediti per crediti, ordinare per `lotSeq`. Metterlo sul server vorrebbe
dire calcolare e serializzare un blocco per dodici viewer a ogni transizione **per nascondere
un'addizione a chi ha già gli addendi** — un costo su ogni snapshot in cambio di niente.

Quindi `stats_plus` è un **gate di prodotto**, dello stesso rango di `POSIZIONE_STATS` (§5.3): decide
chi vede il pannello, non chi potrebbe ricostruirlo. È esattamente lo statuto che `schema.ts` dà già a
`is_pro` — *«non è una necessità di licenza… va detto qui perché non venga difeso, un giorno, con un
argomento che non ha»* — e la colonna nuova porta la stessa nota, per la stessa ragione.

### 6.4 I punti da toccare sono dieci, non quattro

⚠ **La versione precedente di questa sezione diceva «i suoi quattro punti». Sono dieci**, e nessuno
dei dieci fallisce se lo dimentichi — è la lezione di M21 sulla colonna aggiunta a metà.

| # | Dove | Cosa |
|---|---|---|
| 1 | `lib/db/schema.ts` | la colonna, sotto `is_pro`, con la nota di §6.3 |
| 2 | `lib/engine/admin.ts` | il tipo della riga admin + la `select` di `listUsers` |
| 3 | `lib/engine/admin.ts` | `setUserStatsPlus`, gemella di `setUserPro` |
| 4 | `app/admin/actions.ts` | il ramo del form |
| 5 | `lib/admin-users.ts` | `USER_FIELDS` e `USER_FIELD_LABELS` |
| 6 | `components/admin/user-panel.tsx` | l'interruttore, con la frase di §6.1 |
| 7 | `components/admin/user-row.tsx` | la colonna in tabella |
| 8 | `app/admin/users/page.tsx` | il passaggio |
| 9 | `lib/domain.ts` | `canSeeStatsPlus` |
| 10 | `app/auctions/[id]/play/page.tsx` | la prop verso `Portal` |

⚠ **Il punto 5 non è un'aggiunta, è una correzione**: il commento di `USER_FIELDS` dice *«I quattro
campi che il pannello laterale sa scrivere, e sono quattro: la macro **non aggiunge nessun potere**
(decisione dell'owner del 2026-08-18)»*. Quella decisione era di M18 e valeva per M18; questa è
dell'owner ed è del 2026-08-29. Il commento va **riscritto**, non lasciato a dire una cosa falsa
accanto a cinque campi.

E fuori dai dieci: `tests/db/helpers.ts` (`makeUser`) e **un utente del seed col flag acceso**, senza
il quale ogni prova locale comincia con un giro in `/admin/users`.

⚠ **Il nome è `stats_plus` / `statsPlus`.** La spec archiviata scriveva `stas_plus`, che è un refuso e
non si eredita.

---

## §7 — La forma dei dati, e l'unica aggiunta al motore

### 7.1 Quasi tutto è già nel browser

| serve | dove sta già |
|---|---|
| PMA, fascia, titolarità, tag | `PoolPlayer.carmy` |
| il gruppo fascia e il suo ordine | `PoolPlayer.fasciaGruppo`, `.fasciaRank` |
| i miei obiettivi | `PoolPlayer.obiettivo` |
| presenze e titolarità dal campo | `PoolPlayer.insights` |
| chi è libero, chi ha comprato cosa e a quanto | `SnapshotMember.roster[]` |
| crediti e capacità di spesa | `SnapshotMember.credits`, `.maxBid` |
| il ruolo in corso e l'ordine dei ruoli | `SnapshotAuction.currentRole`, `.roleOrder` |
| il budget iniziale del tavolo | `SnapshotMember.credits + Σ prezzi` |

Il pool arriva **una volta sola**, fuori dallo snapshot, ed è immutabile dall'import: è la ragione per
cui il costo di questa macro sul canale è **un intero per riga di rosa** e nient'altro.

### 7.2 `lotSeq` su `SnapshotRosterEntry` — un campo, tre usi

```ts
/**
 * Il numero di lotto da cui questa assegnazione nasce, `null` se non nasce da un
 * lotto (M22 §3.3).
 *
 * ⚠ **Non tocca I8**: un lotto risolto è già pubblico, `seq` è il suo numero
 * d'ordine e da esso non si deduce niente di nessuna busta.
 *
 * ⚠ **`null` è esattamente `source = "MANUAL"`, e non è una coincidenza da
 * verificare a ogni lettura**: tutti e tre i punti che scrivono un'assegnazione lo
 * fanno coerentemente — `machine.ts:791` scrive `lotId: lot.id` con
 * `source: "AUCTION"`, `override.ts:180` e `rules.ts:341` scrivono `lotId: null`
 * con `source: "MANUAL"`. Un campo solo porta i due fatti, e serializzare anche
 * `source` sarebbe una seconda copia della stessa verità.
 */
lotSeq: number | null;
```

I tre usi: **l'ordine** per lo scatto di §3.3; **l'esclusione delle assegnazioni manuali** dai rapporti
(un `manualAssign` è una correzione della regia, non un prezzo di mercato); e **il «com'era prima»**
di qualunque confronto temporale.

### 7.3 L'invariante, e perché va scritto come test

> **Tutto ciò che Stats+ mostra si calcola da lotti risolti e da stato pubblico. Mai dalle buste in
> corso.**

Non è una precauzione in più: è I8 espresso come proprietà di questa macro. Il rischio non è teorico —
un giorno qualcuno vorrà «migliorare» la temperatura usando `eligibleMemberIds` o, peggio, il numero
di buste consegnate, e **il numero continuerebbe ad avere la stessa faccia**. Nessuna schermata lo
denuncerebbe. §9 lo misura invece di dedurlo.

### 7.4 Il costo

Il calcolo è `O(righe del pool)` per le alternative e `O(assegnazioni)` per il termometro: cinquecento
e duecento, in un browser, a ogni snapshot. Non serve memoizzare niente, e **non si memoizza prima di
aver misurato** (regola 8). Se un giorno servisse, il candidato è l'indice `fascia → giocatori` del
pool, che è immutabile per tutta l'asta.

---

## §8 — Come cede

Nessuno di questi è un errore da gestire: sono stati normali, e ognuno ha la sua frase.

| Situazione | Cosa succede |
|---|---|
| Non è Pro | La tab non c'è e la riga nel modale non compare. Il portale è quello di oggi, identico. |
| È Pro ma senza `stats_plus` | Identico alla riga sopra, e **di proposito indistinguibile**: chi non ha Stats+ non deve scoprire che esiste da uno spazio vuoto o da una linguetta spenta. I PMA sul listone li vede come sempre. |
| È amministratore ma senza `stats_plus` | Come sopra: l'admin **non** è implicito (§6.2). È lo stato in cui si trova chiunque subito dopo il deploy. |
| Ha `stats_plus` ma non è Pro | Niente Stats+, perché senza `carmy` non ci sono PMA (§6.1). Il pannello di amministrazione lo dice **quando si accende il flag**, non lo scopre l'utente. |
| Nessun listone personale né foglio globale | Nessun PMA, quindi nessuna temperatura: «Serve un listone con i PMA». |
| Il giocatore chiamato non ha PMA (67 righe) | Niente catalogo: «Questo giocatore non ha un PMA nel tuo foglio». Il termometro del ruolo resta. |
| Primo lotto del ruolo | Nessuna temperatura, e lo dice: «Nessun lotto informativo ancora». Non è un `—`, è una frase. |
| Meno di 8 lotti informativi | Punti osservati col loro numero; nessuno scatto, nessun avviso. |
| Il ruolo in corso è il primo | Nessun saldo, nessun «cambio d'aria». |
| `insights` vuota | Titolarità dal solo foglio. Nessun percorso critico la attraversa. |
| Asta in pausa | La tab si guarda benissimo; il modale non si apre (`shouldOpenBidDialog`), quindi non si pone. |
| Asta `COMPLETED` | Tutti i ruoli sono chiusi: la tab mostra i saldi e i partecipanti, e nessun lotto. |

---

## §9 — Le prove

### 9.1 I test di `pnpm test`

- **L'invariante di §7.3, e non per deduzione**: si costruisce uno stato con un lotto aperto, si
  calcolano termometro e alternative, si **cambiano le offerte vive** (importi diversi, un ritiro,
  un'offerta in più) e si ricalcola. **Deve uscire lo stesso identico oggetto.** È il test che tiene
  in piedi I8 dentro questa macro.
- **Il reset per ruolo**: uno stato con i portieri chiusi a 0,5× e tre difensori a 1,2× deve dare
  temperatura D = 1,2×, **non** una media dei due.
- **Il saldo**: il ruolo chiuso produce il residuo giusto; il ruolo **in corso** non produce nessun
  saldo (§3.2).
- **Il filtro di §3.4**: un lotto su un giocatore da 1 credito non entra nella temperatura, qualunque
  cifra abbia fatto; un lotto da 30 crediti chiuso a 1 **entra** (è l'esatto contrario del rimedio
  archiviato, e il test lo fissa perché non venga «corretto» in buona fede).
- **L'esclusione dei manuali**: un'assegnazione con `lotSeq === null` non entra in nessun rapporto.
- **La normalizzazione di §3.6**: su uno stato costruito apposta, `Σₖ pianoSlot(R,k)` deve fare
  esattamente `piano(R)`. È il test che impedisce il ritorno del difetto per cui tutti risultavano
  «sotto piano» del 17%.
- **L'asimmetria di §4.2**: chiamando Bastoni (5/5), Bisseck (3/5) **non** è pari livello; chiamando
  Bisseck, Bastoni **lo è**. Con i numeri esatti della tabella.
- **La copertura dei tre gruppi**: un giocatore libero con `titolarità ≥` e `Δrank = 2` deve finire in
  «costano meno», **non** cadere fuori da tutti i gruppi. È il buco che il mock ha trovato, e senza
  test si riapre alla prima riscrittura della condizione.
- **Le due soglie di §3.5** sui casi limite: esattamente 0,25, esattamente 4 lotti per parte.
- **La lunghezza della riga del modale**: ogni variante di testo prodotta da §5.1 sta sotto i
  **45 caratteri**. È un test sulle stringhe, non sul rendering, e vale quanto un test di layout —
  a 46 caratteri il blocco raddoppia d'altezza e disfa M16 senza che nessuno lo decida.
- **Il gate**: `canSeeStatsPlus` su tutte e otto le combinazioni di `isPro × isAdmin × statsPlus`, e
  due casi scritti per nome perché sono quelli che qualcuno «uniformerà» in buona fede — **un
  amministratore senza il flag non vede Stats+** (§6.2), e **`statsPlus` senza `isPro` non lo vede
  nemmeno** (§6.1). Più `setUserStatsPlus`: rifiuta un non-amministratore, rifiuta un bot, e
  **accetta la propria riga**, che è ciò che rende accendibile il flag a chi fa il deploy.

### 9.2 Le prove a mano su `dev`

- Un'asta simulata dall'applicazione (M4) con un utente Pro e uno no, aperti fianco a fianco.
- **La riga nel modale su un telefono vero, con la tastiera aperta**, che è l'unico posto in cui si
  vede se ha rubato altezza al campo (§5.1).
- **Il modale a due colonne su un portatile da 13″ con poca altezza**: è lì che si vede se la colonna
  destra spinge la conferma fuori dallo schermo, e non su un monitor grande.
- La tab a 1024px e a 390px.
- La conferma di §5.1 guardando lo schermo: la riga sotto l'input, non sopra.

### 9.3 Come si validerà davvero, e quando

⚠ **Non con una simulazione**, e la ragione è in `fixtures/#22-lezioni-stats+.md`: tre giri, tre
errori nel modello del comportamento umano, ognuno dei quali ha invalidato i numeri del precedente.

Ma **questa macro non ha bisogno di essere validata**, ed è il senso del perimetro: un rapporto fra
due numeri pagati e un conteggio di giocatori liberi sono veri o falsi, non accurati o inaccurati.
L'unica cosa che si rivedrà dopo la prima asta vera sono **le due soglie di §3.5**, guardando se hanno
suonato quando serviva e taciuto quando no.

---

## §10 — Cosa è archiviato, e dove si rilegge

| Cosa | Dove | Perché è uscita |
|---|---|---|
| Il motore statistico gerarchico (ancora, scarti, contrazione, rarità, appetito, tensione, liquidità, banda, soglia) | `fixtures/#22-spec-abbandonata.md` §2–§6 | Mai validato; ogni misura che lo sosteneva è risultata viziata |
| La configurazione di lega come input del modello | idem, §11 | Fuori perimetro: serve al valore del giocatore, che esce |
| Il banco di simulazione e le quattro tornate di misura | idem, §10.1–§10.1quater | Il racconto è in `fixtures/#22-lezioni-stats+.md` |
| ~~La colonna `stas_plus` e il suo gate~~ | — | ⚠ **Non è più archiviata**: l'owner l'ha voluta il 2026-08-29 e la macro la implementa. Vedi §6, che è stato riscritto all'apertura. Il nome però è `stats_plus`. |
| Il valore di lega dai voti 2025/26 | l'artefatto *Il foglio riletto*, 2026-08-29 | Decisione 3: è deduzione dell'owner, non dello strumento |

⚠ **Due risultati della sessione di R&D del 2026-08-29 valgono a prescindere da questa macro**, e si
tengono qui perché nessun altro documento li ospiterebbe:

1. **Il modificatore difesa premia la varianza, non la costanza.** Misurato su 118 difensori con ≥20
   presenze: a parità di voto medio, i più incostanti producono un modificatore **più alto**
   (`r = +0,65` tolto l'effetto della media). Il motivo è nella formula — prende i **migliori tre di
   cinque**, cioè una statistica d'ordine, e un massimo premia la varianza. `guida-fantacalcio.md`
   §5.2 dice il contrario ed è sbagliata su questo punto.
2. **Il modificatore centrocampo quasi non esiste.** Con quattro centrocampisti titolari *mediani* non
   scatta **mai** (0 giornate su 38); con i quattro migliori della Serie A rende **+0,50** a giornata.
   Fare tutto il gioco dei due modificatori — nove slot di rosa — vale **+1,50** punti a giornata,
   quanto **un solo** attaccante top su uno mediano (+1,64).

⚠ **I dati grezzi da cui escono quei due numeri non sono più nel repo**, e va detto perché altrimenti
qualcuno li cerca: `fixtures/2025/` (38 file di voti) e `fixtures/fantacalcio_2025_26.sqlite` sono
stati **cancellati il 2026-08-29**, chiusa la sessione di R&D, perché il valore del giocatore è fuori
perimetro (decisione 3) e nessuna parte di questa macro li legge. Le conclusioni vivono
nell'artefatto *«Il foglio riletto»* del 2026-08-29; per rifare la misura si riscarica la stagione.
**`fixtures/Classic Relative.xlsx` invece resta**, perché è la sorgente delle misure di §2 su cui
poggia tutta la macro.

---

## §11 — Task

**Aperta il 2026-08-29** su `feature/22-stats-plus`, da `dev`.

L'ordine è quello dei commit, e due tagli sono deliberati: **`lotSeq` da solo** (è l'unica cosa dentro
la porta della regola 3, e l'unica che vuole Postgres per essere provata) e **il flag subito dopo**
(è indipendente da tutto, e averlo presto significa dare `pnpm db:push` in locale una volta all'inizio
invece di scoprire un problema di schema alla fine). Il calcolo non conosce il flag: sono funzioni
pure, non sanno chi è l'utente.

**Deciso e chiuso**

- [x] Il perimetro: temperatura per ruolo + alternative, niente stima e niente valore (owner, 2026-08-29)
- [x] Il termometro si azzera a ogni ruolo, il vincolo si accumula (owner, 2026-08-29)
- [x] Le alternative si catalogano sulla titolarità, con la regola asimmetrica (owner, 2026-08-29)
- [x] Il ripiego sta nella tab e non nel modale (owner, 2026-08-29)
- [x] ⚠ ~~Nessuna colonna nuova~~ → **`users.stats_plus`, assegnato dall'amministratore, e l'admin
      non è implicito** (owner, 2026-08-29). §6 riscritto all'apertura

**Il motore** — commit 1 ✅

- [x] `lotSeq` su `SnapshotRosterEntry` in `lib/realtime/types.ts`, con la nota di §7.2
- [x] Popolarlo in `serializeSnapshot` risolvendo `a.lotId` → `lots.seq`, con una `Map` costruita una
      volta sola fuori dal ciclo per membro (non un `find` per assegnazione)
- [x] Il test in `tests/db/snapshot.test.ts`: `source = "AUCTION"` → il `seq` giusto,
      `source = "MANUAL"` → `null`
- [x] ⚠ **Fuori programma, e non è di M22**: F4-09 passava a uno sweep **globale** un `advancePhase`
      non filtrato, quindi faceva avanzare le aste degli altri file di test — che girano in
      parallelo — e li faceva vedere rossi con «expected [] to include …». `cancello.test.ts:143`
      aveva già diagnosticato e risolto lo stesso problema con `sweeperFor`; qui il filtro mancava.
      Era **latente**: aggiungere un test in quel file ha spostato di qualche decina di millisecondi
      il momento dell'incrocio, e da 0 rossi si è passati a 3 deterministici

**Il flag** — commit 2, i dieci punti di §6.4 ✅

- [x] `users.stats_plus` in `lib/db/schema.ts`, con la nota di §6.3 sul suo statuto
- [x] `canSeeStatsPlus` in `lib/domain.ts`, accanto a `canSeeInsights`
- [x] `setUserStatsPlus` in `lib/engine/admin.ts` + il tipo e la `select` di `listUsers`
- [x] Il ramo in `app/admin/actions.ts`; `USER_FIELDS` e le etichette in `lib/admin-users.ts`,
      **col commento dei «quattro campi» riscritto** (§6.4)
- [x] L'interruttore in `user-panel.tsx` con la frase di §6.1, la colonna in `user-row.tsx` e
      l'intestazione in `users-table.tsx`, il passaggio in `app/admin/users/page.tsx`
- [x] `makeUser` in `tests/db/helpers.ts` + **gli utenti del seed**: il primo (amministratore) col
      flag acceso — senza, in locale Stats+ non si vedrebbe e si cercherebbe la causa nel codice — e
      il secondo e il terzo entrambi Pro, **uno con Stats+ e uno senza**, che è la coppia di
      confronto di §9.2
- [x] `pnpm db:push` in locale
- [x] I test: le otto combinazioni del gate, i due casi scritti per nome, `setUserStatsPlus` sulla
      propria riga e senza Pro
- [ ] ⚠ **Spostato al commit che lo legge** (era il decimo punto di §6.4): la prop verso `Portal` in
      `app/auctions/[id]/play/page.tsx`. Aggiungerla qui avrebbe voluto dire una prop che nessuno
      legge fino a tre commit dopo — cioè un'astrazione prima del primo chiamante, non del secondo
      (regola 8). Il gate esiste ed è provato; il filo si tira quando c'è qualcosa da accendere

**Il calcolo** — `lib/stats-plus.ts`, funzioni pure, nessun import di `lib/db`

- [ ] `pianoPerRuolo(pool)` — le quote dal foglio caricato (§2)
- [ ] `lottiInformativi(snapshot, pool, ruolo)` — il filtro sull'ingresso (§3.4)
- [ ] `temperatura(...)` — i punti osservati e il loro numero (§3.1)
- [ ] `saldoRuoliChiusi(...)` — solo per i ruoli finiti (§3.2)
- [ ] `scatto(...)` — prima metà contro seconda, da 8 lotti in su (§3.3)
- [ ] `avvisi(...)` — le due soglie dichiarate (§3.5)
- [ ] `scartoPerPartecipante(...)` — speso contro piano degli slot riempiti (§3.6)
- [ ] `alternative(...)` — i tre gruppi con la regola asimmetrica (§4.2)
- [ ] `andatiStessaFascia(...)` — i venduti della fascia **in ordine di lotto**, con lo scarto in
      crediti e in percentuale, e l'allargamento alle fasce adiacenti sotto i 3 lotti (§5.1)
- [ ] `pct(rapporto)` — il rapporto in percentuale, un posto solo (§5.0)

**L'interfaccia**

- [ ] `POSIZIONE_STATS` in un file suo, con le quattro forme scritte (§5.3)
- [ ] La riga nel modale, sotto l'input, dove oggi tace `PrezzoConsigliato dove="campo"` (§5.1)
- [ ] Il modale a due colonne **solo da `sm:`**: `sm:w-96` → `sm:w-[46rem]` → `xl:w-[64rem]`,
      griglia `grid-cols-[384px_1fr]`, la colonna sinistra invariata a 384px (§5.1)
- [ ] I quattro blocchi della colonna destra, **in griglia 2×2 da `xl:`** e in colonna sotto (§5.1)
- [ ] Estrarre `IconaObiettivo` da `listone-table.tsx`: secondo chiamante, quindi si estrae (§5.1)
- [ ] ⚠ La colonna destra **scorre da sé** (`overflow-y-auto`): non deve allungare la card e
      spingere la conferma fuori dallo schermo su un portatile (§5.1)
- [ ] `<Linguetta value="stats">` in `PortalTabs` + `<Tabs.Content value="stats">` (§5.2)
- [ ] I quattro blocchi della tab, con la riga dello scarto strutturale in testa
- [ ] Gli stati di §8, ognuno con la sua frase e nessun `—` muto

**Le prove**

- [ ] L'invariante di §7.3: **cambiare le buste vive non cambia niente**
- [ ] Il reset per ruolo, il saldo solo sui ruoli chiusi
- [ ] Il filtro sull'ingresso, **e il caso che il rimedio archiviato sbagliava** (§9.1)
- [ ] L'asimmetria Bastoni / Bisseck, con i numeri veri
- [ ] Le due soglie sui casi limite; il gate su tutte le combinazioni

**Chiusura**

- [ ] `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (il perimetro del 2026-08-29, il perché, e la
      decisione sul flag con il suo statuto di §6.3)
- [x] `docs/features/README.md` all'apertura · [ ] alla chiusura
- [x] Togliere la richiesta da `docs/REQUESTS.md` — **solo** all'apertura della macro
- [ ] `CHANGELOG.md` e `package.json` al merge su `main`
- [ ] ⚠ **`pnpm db:push` a mano sul server**, con nessuna asta `LIVE` o `PAUSED`, poi
      `pm2 reload deploy/ecosystem.config.cjs --update-env`. Nessun backfill (l'intestazione dice
      perché), **ma il rilascio non è finito finché chi deve vedere Stats+ non ha il flag acceso in
      `/admin/users`** — e quello include chi ha fatto il deploy
