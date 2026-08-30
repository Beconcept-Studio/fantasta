# M22 — Stas+: il prezzo che nasce dall'asta che stai giocando

> **Stato:** **design**, non aperta. Nessun branch, nessun commit, nessuna riga di codice. Nasce
> dalla richiesta «Analisi realtime offerta adatta» del quaderno del 2026-08-28, che resta in
> `docs/REQUESTS.md` finché la macro non si apre davvero.
>
> ⚠ **IL PERIMETRO È CAMBIATO IL 2026-08-29, E QUESTO DOCUMENTO VA LETTO SAPENDOLO.** La macro
> costruisce **un indicatore di sola evidenza** (§12): fatti di questa asta — chi ha ancora un posto
> scoperto, quanto sono costati i comparabili, quanti ne restano. **Non** costruisce il motore
> statistico di §2–§6, che resta scritto come **ipotesi non validata**, spento, e si riapre solo dopo
> un'asta vera su cui provarlo (§13). Chi legge §2–§6 sta leggendo un archivio, non un piano.
>
> ⚠ **Tocca lo schema del database? Sì**, ma di un soffio: **una colonna** su `users`
> (`stas_plus boolean NOT NULL DEFAULT false`). Dopo il deploy serve `pnpm db:push` sul server, con
> nessuna asta `LIVE` o `PAUSED`, e poi `pm2 reload deploy/ecosystem.config.cjs --update-env`.
> **Backfill a mano? No**, e la ragione è esatta e non «probabilmente»: `false` *è* la verità per
> ogni riga già in tabella, perché oggi Stas+ non ce l'ha nessuno. Il rilascio finisce col `db:push`.
>
> ⚠ **Tocca il motore? Sì, ed è la prima macro dopo M14 a farlo.** Aggiunge **un campo** a
> `serializeSnapshot`. Non aggiunge transizioni, non tocca `machine.ts`, `rules.ts` né `mutate.ts`,
> non scrive niente e non apre nessun `withAuctionLock`: è **sola lettura**, calcolata al momento
> della serializzazione. Ma sta dentro la porta della regola 3, quindi §7 va letto prima di scrivere
> una riga.
>
> **Invarianti coinvolti:**
> **I8 è il centro di questa macro.** Il consiglio è un numero che descrive *quanto vale un
> giocatore*, calcolato mentre le buste sono chiuse. Se una sola delle sue componenti guardasse le
> offerte in corso, l'analizzatore diventerebbe un canale laterale che svela le buste sotto forma di
> banda di prezzo — un guasto che non si vede a occhio e che nessuna schermata denuncerebbe. §7
> stabilisce l'invariante e §10 il test che lo misura invece di dedurlo.
> **I10** — il pannello resta **funzione pura dello snapshot**. Il consiglio arriva *dentro* lo
> snapshot, quindi chi ricarica a metà lotto vede la stessa banda di chi non si è mosso, senza
> nessun evento da aver ascoltato al momento giusto. È anche la ragione per cui il motore non gira
> su una rotta sua (§7).
> **I1, I2** — non toccati e nemmeno sfiorati: qui non si assegna e non si apre niente.
>
> **Regole coinvolte:** **2** (le funzioni di `lib/engine/stas.ts` sono pure e ricevono `now` come
> parametro: nessun `Date.now()` dentro), **3** (il consiglio esce da `serializeSnapshot` e da
> nessun'altra porta), **6** (il gate Stas+ decide una **query**, mai un `className`), **7** (nessuno
> stato locale nuovo: il pannello non ricorda niente dell'analisi), **8** (nessuna astrazione prima
> del secondo chiamante: un file di motore, un tipo, un componente).

---

## §0 — Da dove nasce, e le sette decisioni che la definiscono

La richiesta, per intero, è nel quaderno del 2026-08-28. In due righe: *ho un listone con i PMA, ma
ogni asta ha le sue peculiarità e i PMA non vengono rispettati; voglio un analizzatore che incroci i
valori effettivi dell'asta con i PMA e mi dia un suggerimento per ogni lotto, ponderato sul tipo di
giocatore — Dimarco merita un discorso a parte.*

L'analisi si è svolta in conversazione il 2026-08-28. Sette decisioni dell'owner, tutte prese
guardando delle alternative concrete, e da qui in poi vincolanti:

| # | Decisione | Alternative scartate |
|---|---|---|
| 1 | **Banda + soglia di uscita**, non un numero solo | numero singolo; solo termometro; banda + prosa di un LLM |
| 2 | **Mercato e tetto personale insieme, e vince il più stretto** | solo mercato; mercato + lista della spesa |
| 3 | **Fascia per raggruppare, numeri per distinguere dentro la fascia** | solo fascia; solo numeri |
| 4 | **L'ancora è `PMA × crediti dell'asta`** | il prezzo consigliato; PMA con il prezzo come rete |
| 5 | **Il consiglio vive dentro il pannello d'offerta** | una modal sua da desktop; un blocco fisso in colonna 3 |
| 6 | **Nessun LLM** — vedi §4bis, dove la misura ha smentito la domanda | lettura offline dei tag; prosa live; lettura a fine asta |
| 7 | **Il motore gira sul server, dentro lo snapshot** | nel browser con gate d'interfaccia; su una rotta dedicata |

⚠ **La 6 è stata ribaltata da una misura, ed è il caso che questo documento esiste anche per
raccontare.** L'owner aveva scelto «un LLM che legge tags e commenti offline», sulla scorta della mia
descrizione di quei campi come «linguaggio naturale». M10B li aveva già contati: sono **17 etichette
chiuse**. La descrizione era sbagliata, la scelta era stata fatta su di essa, e l'ha annullata il
dato. Vedi §4bis.

---

## §1 — Stas+: il flag

Una colonna su `users`, gemella di `is_pro`, con la stessa forma in tutti e quattro i punti in cui
`is_pro` vive — perché una seconda forma per lo stesso concetto è il modo in cui fra sei mesi due
gate divergono senza che nessuno se ne accorga.

```ts
/**
 * Vede l'analizzatore di prezzo in asta (M22): la banda consigliata, la soglia di
 * uscita e il segnale che le sta producendo.
 *
 * ⚠ **Presuppone `is_pro` e non lo sostituisce.** L'analizzatore si nutre del PMA,
 * che a chi non è Pro non arriva affatto (M8 §6, M10B §7): Stas+ su una riga non Pro
 * è un interruttore acceso che non fa niente. Il gate è un **AND** — `canSeeStasPlus`
 * in `lib/domain.ts` — e §1.2 dice come il pannello lo rende visibile invece di
 * lasciarlo silenzioso.
 */
stasPlus: boolean("stas_plus").notNull().default(false),
```

**I quattro punti**, gli stessi di `is_pro`:

1. `lib/db/schema.ts` — la colonna qui sopra;
2. `lib/domain.ts` — `canSeeStasPlus(user)`, che è `(user?.stasPlus === true || user?.isAdmin === true) && canSeeInsights(user)`;
3. `lib/engine/admin.ts` — `setStasPlus()`, gemella di `setPro()`: `refuseNonAdmin`, `NOT_FOUND` sull'utente inesistente, e **il divieto di toccare la propria riga**;
4. `lib/admin-users.ts` — la colonna nell'elenco e l'etichetta `"Stas+"`.

⚠ **Gli amministratori ce l'hanno d'ufficio**, esattamente come per `is_pro` e per la stessa ragione
scritta là: `admin.ts` vieta di modificare la propria riga, quindi senza questa regola per provare
l'analizzatore un amministratore dovrebbe farsi dare il flag da qualcun altro.

⚠ **Nessun `CHECK NOT (stas_plus AND is_bot)`**, per lo stesso argomento di `is_pro`: un bot con
Stas+ è insensato ma innocuo — non guarda nessuno snapshot con gli occhi — mentre un bot
amministratore è un conflitto vero, e per quello esiste `users_admin_not_bot_check`.

### §1.2 — Stas+ senza Pro si vede, non tace

Nel pannello utenti la casella Stas+ su una riga non Pro si mostra **spenta e dichiarata inerte**,
non semplicemente spenta. È la stessa lezione di `OBIETTIVO_COLUMN` in `parseCarmy.ts`: il silenzio
si copre dall'altra parte, dicendolo a chi può correggerlo. Un interruttore che si lascia accendere
e non fa niente è un guasto che si scopre la sera dell'asta.

---

## §2 — L'ancora

Per ogni giocatore con un PMA:

```
ancora(p) = pma(p) / 100 × budgetIniziale
```

`pma` in punti percentuali (`10.5` è «10,5%», vedi la colonna in `schema.ts`), `budgetIniziale` da
`members.budget_initial`. È l'**unico** punto in cui i crediti dell'asta entrano nel motore, ed è ciò
che lo rende indipendente da quanto vale un credito in una lega: lo stesso foglio serve un'asta a 500
e una a 1000 senza toccare una riga.

⚠ **Non si ricalcola da `prezzo`, mai** — la colonna in `schema.ts` lo dice con la misura: solo 132
righe su 385 coincidono con `prezzo / 5`, e non di poco. Sono due numeri diversi.

⚠ **Nessuna rete di riserva sul prezzo consigliato** (decisione 4, alternativa scartata
esplicitamente). Conseguenza da conoscere e da non aggiustare di nascosto: **i giocatori senza PMA
non ricevono nessun consiglio**, e nel file di riferimento sono **67 righe**. Il pannello lo dice
(§9), non lo inventa.

⚠ **Il PMA che vale è quello risolto**, cioè il proprio se si è caricato il file personale (M21 §5),
quello globale altrimenti. Non è una scelta di questa macro: è già la semantica di `carmy` nel pool,
e il motore la eredita senza saperne niente. La conseguenza che va scritta è un'altra: **le ancore di
uno stesso utente sono coerenti fra loro**, perché la risoluzione è per utente e non per riga. Il
giorno in cui qualcuno la rendesse mista — il mio PMA per Dimarco e quello di Carmy per Bastoni — i
rapporti di §3 sarebbero calcolati su due scale diverse e il motore mentirebbe senza sbagliare un
conto.

---

## §3 — Il mercato, all'indietro: cosa è già successo in quest'asta

### 3.1 Le osservazioni

Ogni lotto **risolto** dell'asta dà un punto:

```
y = ln( prezzoPagato / ancora(giocatore) )
```

Il logaritmo non è una raffinatezza: rende simmetrici il doppio e la metà, che è il modo in cui un
mercato si muove davvero. Senza, pagare 2× e pagare 0,5× peserebbero uno il doppio dell'altro.

Solo `source = "AUCTION"` e `voided_at IS NULL`. Un'assegnazione manuale non è un prezzo di mercato,
è una correzione della regia (`manualAssign`, regola operativa degli override), e trattarla come tale
inquinerebbe l'indice con un numero che nessuno ha offerto.

⚠ **E niente lotti chiusi al prezzo minimo. Questa riga è arrivata dal banco (§10.1) e senza di essa
il motore misura un'asta che non esiste.** La prima stesura diceva «ogni lotto risolto dà un punto»,
senza distinguere. Ma in un'asta a otto **109 lotti su 199 vanno a un credito**, e non perché il
tavolo sia prudente: perché *nessuno li voleva*. Il loro `ln(1/12)` trascinava la stima dell'umore
d'asta a **−22% contro un vero −6%**; escludendoli la stima torna a **−9%**. L'assenza di domanda è
il mestiere di §5, e farla entrare anche qui vuol dire contare due volte lo stesso fenomeno — con
§5 che poi "corregge" un indice già piegato dalla stessa causa.

### 3.2 La gerarchia, che è ciò che risolve il problema vero

Il problema vero **non** è dove prendere i dati — ci sono tutti. È che il consiglio serve di più
proprio dove i dati sono di meno: i top vanno via presto, e ai primi lotti un indice di mercato è
rumore travestito da numero.

Quindi non un indice unico, ma tre livelli annidati, ciascuno stimato come **scarto residuo** rispetto
a quello sopra:

```
scarto(p) = ŝ(asta) + ŝ(ruolo | asta) + ŝ(fascia | ruolo)
```

e ogni `ŝ` è una media **contratta verso zero** in funzione di quanti punti ha:

```
ŝ = (n · media) / (n + k)          k ≈ 5
```

⚠ **È qui che il motore dice la verità invece di riempire un vuoto.** Con zero lotti chiusi tutti gli
scarti valgono zero, e il consiglio **è il PMA**: il motore non aggiunge niente a quello che già sai,
che è la cosa onesta da dire quando non si sa niente. Dopo cinque lotti in un gruppo crede a metà di
quello che vede. Il livello «asta» si consolida per primo perché raccoglie tutti i lotti; il livello
«D fascia 1» arriva quando arriva, e finché non arriva **eredita quello del ruolo** invece di
inventarsi un numero su tre punti.

### 3.3 La dispersione, che diventa la banda

```
σ̂ = deviazione standard degli y osservati, contratta verso σ₀ = 0.35 con lo stesso k
```

`σ₀ = 0.35` in scala logaritmica è circa ±35%, che è l'ordine di grandezza reale della dispersione in
un'asta di fantacalcio. Serve a dare una banda sensata quando non ci sono ancora dati per misurarne
una.

---

## §4 — Il profilo: perché Dimarco non è un difensore qualsiasi

L'esempio dell'owner è il criterio di questa sezione: *«Dimarco ha avuto numeri da fuoriclasse
assoluto: merita un discorso a parte. Ok se i prezzi medi sono più bassi, ma l'AI non deve essere
generalista.»*

### 4.1 La rarità

Un punteggio `s ∈ [0,1]`, calcolato come **percentile dentro il proprio ruolo** e mai in assoluto —
otto gol per un difensore non sono otto gol per un attaccante:

- `fmvExp`, la fantamedia attesa del foglio (il segnale più forte);
- gol + assist per presenza, da `player_insights` (`golFatti`, `assist`, `presenze`);
- titolarità: `startsEleven / presenze`, `minPlayingTime`, e il voto `titolarita` 1–5;
- `rigoristaRank === 1` e `piazzatiRank === 1`, due bonus secchi.

Per Dimarco: fmv alta, numeri offensivi fuori scala per un D, piazzati di prima fascia. `s ≈ 0.95`.

### 4.2 Come `s` entra, ed è qui che il motore smette di essere generalista

`s` **non alza il prezzo**. Decide **quanta parte del vento del mercato tocca quel giocatore**, e in
modo **asimmetrico**:

```
scarto < 0  (mercato in sconto):   scarto × (1 − 0.7·s)      lo sconto quasi non lo tocca
scarto > 0  (mercato caro):        scarto × (1 + 0.3·s)      il rincaro lo tocca di più
```

L'intuizione, che è quella dell'owner: **un giocatore sostituibile segue il vento, un fuoriclasse
no.** Se i difensori vanno a −7% perché il tavolo è prudente, su Dimarco lo sconto non arriva: chi lo
vuole ce l'ha in testa da settimane e un secondo Dimarco non esiste. Al contrario, in un'asta che sta
pagando caro sono proprio i top a portarsi via la guerra al rilancio.

⚠ **L'asimmetria è un'assunzione, non una misura, e i due coefficienti li ho scelti io ragionando.**
Va scritto qui perché non venga difeso un giorno con un argomento che non ha. §10 dice come si
misurano prima di costruire.

### 4.3 I tag: dove entrano, e dove **non** entrano

I 17 tag (§4bis) alimentano due cose e nessun'altra:

- **la rarità `s`** — `titolarissimo` + `rigorista` + `modificatore` descrivono uno senza sostituti;
  `scommessa` e `subentrante` descrivono uno di cento;
- **l'ampiezza `σ̂`** — su una `scommessa` nessuno è d'accordo su quanto valga e la banda si allarga;
  su un `titolarissimo` si stringe. È un effetto reale che nessun altro segnale cattura.

⚠ **I tag non toccano l'ancora, ed è la trappola numero uno di questa sezione.** Li ha scritti **la
stessa persona che ha scritto il PMA**, sulla stessa riga dello stesso foglio: il PMA li tiene già
dentro. Usarli per correggere l'ancora conterebbe due volte la stessa informazione, e il motore
scommetterebbe due volte sullo stesso cavallo senza che nessun conto risulti sbagliato.

⚠ **Un tag sconosciuto pesa zero e lo dice.** I 17 sono misurati sul foglio di Carmy; il parser è lo
stesso per il file personale (M21), ma un file personale può scrivere qualunque etichetta. Indovinare
il peso di una parola mai vista è esattamente il genere di silenzio che questa codebase non si
concede.

### §4bis — Perché non c'è un LLM, e come si è scoperto

L'owner aveva scelto, fra quattro opzioni, di usare un LLM per «leggere tags e commenti offline»: una
passata all'import che trasformasse le note in linguaggio naturale in segnali strutturati. La scelta
era ragionevole **sulla descrizione che gli avevo dato**, ed era la descrizione a essere sbagliata.

M10B aveva già contato quei campi. `tags` è un **vocabolario chiuso di 17 voci**:

`bonus` (118) · `titolarissimo` (106) · `scommessa` (105) · `rischio infortuni` (96) ·
`subentrante` (88) · `modificatore` (82) · `costante` (80) · `cartellini` (67) · `incostante` (44) ·
`tanti gol` (39) · `assistman` (25) · `rigorista` (18) · `tiratore` (11) · `imbattibilità` (8) ·
`pararigori` (6) · `Coppa Africa` (1) · `jolly` (1)

Diciassette voci non si fanno leggere a un modello linguistico: **si scrive una tabella di
diciassette pesi**, deterministica, gratuita, testabile, e regolabile come ogni altro coefficiente.
Un LLM davanti a un elenco chiuso paga latenza e imprevedibilità per fare peggio. L'unico campo
davvero libero è `commento`, che sta su **dieci giocatori** e parla di abbinamenti fra portieri:
dieci righe si leggono a occhio e non giustificano un'infrastruttura (regola 8).

**Conseguenza: M22 non ha nessuna dipendenza esterna, nessuna chiave in `.env`, nessuna rete la sera
dell'asta.** Il posto in cui un LLM guadagnerebbe davvero il posto resta fuori da questa macro: una
lettura a metà o a fine asta, senza countdown, su tutto lo stato. Si apre il giorno in cui questi
numeri avranno dimostrato di valere, e non prima.

---

## §5 — La domanda: chi ti contende davvero questo lotto

Richiesta dell'owner, arrivata dopo il primo giro di design e con un esempio che ha cambiato la forma
del modulo: *«siamo in 8, 7 portieri sono già assegnati a 7 squadre, io resto senza. Quella è una
variabile di possibile vantaggio: posso spendere un po' meno per il mio primo portiere, gli altri
sono a posto.»*

### 5.1 Perché il modello ovvio è sbagliato, e va detto prima di scrivere quello giusto

Il primo istinto è contare gli slot liberi: «quanti rivali hanno ancora un posto da portiere?».
Applicato all'esempio dà **la risposta opposta a quella giusta**: con 3 slot P a testa, i sette che
hanno già preso il portiere ne hanno ancora **due liberi ciascuno** — quattordici slot vuoti, e il
conteggio ingenuo grida «concorrenza altissima».

Quello che è finito non è lo **spazio**. È il **bisogno**.

### 5.2 L'appetito — il valore del k-esimo giocatore di un ruolo

Gli slot di uno stesso ruolo non valgono uguale. Il primo portiere è il titolare, il secondo e il
terzo sono riserve da un credito. Il quarto difensore gioca, l'ottavo no.

```
titolari(R) = max(1, floor(slot(R) / 2))              P→1   D→4   C→4   A→3

scalzato(m,R) = ancora del titolari(R)-esimo giocatore di m in R, oppure 0 se ne ha meno
appetito(m,p) = clamp( (ancora(p) − scalzato(m,R)) / ancora(p), 0, 1 )
```

Una riga invece di quattro costanti, e si riscala da sé se un'asta configura gli slot diversamente.

⚠ **L'appetito è «quanto ci guadagni», non «ce l'hai o non ce l'hai», e questa è la correzione più
importante che la macro abbia ricevuto** (owner, 2026-08-28: *«è impossibile che prenda un buon
portiere a 1, nonostante i primi slot siano stati assegnati»*).

La prima stesura era **a gradino**: chi possedeva già, in quel ruolo, un giocatore con ancora ≥ metà
di questo aveva appetito **zero**. Sette rivali con un portiere qualsiasi diventavano sette rivali
senza domanda, `R = 0`, campo libero, e il consiglio saltava al minimo. È falso per una ragione
elementare: **chi ha un portiere mediocre compra eccome un portiere forte a tre crediti.** Il
gradino ignorava l'*upgrade*, che è quasi tutta la domanda residua di un'asta a metà.

⚠ **E il banco aveva confermato il gradino perché ne condivideva l'errore.** I suoi banditori
avevano dentro la stessa funzione (`bisogno = 0 → valore × 0.06`), quindi pagavano davvero un
credito, quindi l'errore misurato su 109 lotti risultava **zero** e la sezione sembrava il pezzo
migliore della macro. Era circolarità, nel punto esatto in cui il banco esiste per evitarla. Da qui
in poi: **quando il banco conferma una sezione con errore zero, si va a guardare se il mondo
simulato contiene una copia di quella sezione.**

E generalizza a casi che nessuno ha nominato: l'ottavo difensore chiamato quando tutti hanno già
quattro D titolari ha appetito zero da tutti, e va via a un credito — che è ciò che succede nelle aste
vere e che nessun PMA su un foglio può dire.

### 5.3 I rivali effettivi

L'appetito è la voglia; serve anche il portafoglio. E il server ha già fatto il lavoro: **`maxBid` è
esattamente la quantità giusta** — crediti residui meno quanto serve a riempire gli slot rimanenti —
quindi «il budget già speso dai competitor» è già misurato, e con la formula corretta
(`maxBid` in `lib/engine/rules.ts`).

```
R = Σ appetito(m, p)     sui rivali m ≠ io con maxBid(m) ≥ centro corrente
```

Un numero **frazionario**: «due rivali e mezzo». Dipende dal prezzo, quindi si itera: stima il centro,
riconta, ricalcola. **Due passate, non un ciclo `while`** — la convergenza è immediata e un ciclo
senza limite dentro `serializeSnapshot` è un modo di fermare l'asta.

### 5.4 I sostituti

```
S = quanti giocatori liberi, stesso ruolo, con ancora ≥ 0.6·ancora(p)
```

È il conto che manca a chiunque guardi solo la domanda: quattro rivali su un giocatore sono tanti se
è l'ultimo del suo livello, pochi se dietro ce ne sono venti uguali.

⚠ **«Libero» si deduce dalle rose, non da una query sul pool.** È la stessa regola che `PoolPlayer`
dichiara in `types.ts`: il pool sono cinquecento righe immutabili, chi sia ancora libero è funzione
dello stato.

### 5.5 La tensione

```
pressione       = R / (R + S)
fattoreCompetizione = (pressione / pressioneTipica) ^ β        β ≈ 0.35, esito limitato a [0.15, 1.8]
```

⚠ **QUESTA È LA SEZIONE CHE IL BANCO HA MESSO IN DISCUSSIONE, e va decisa prima di scriverla**
(§10.1). Su ogni mondo provato, con `β = 0.35` il motore **peggiora** il PMA nudo; con `β = 0` lo
batte. Il fattore risulta **sempre ≥ 1** — alza e non abbassa mai — perché `pressioneTipica` conta
i sostituti su tutto il listone mentre `pressione` conta solo i liberi, e i comparabili si
esauriscono più in fretta dei rivali.

⚠ **Ma il banco non può condannarla del tutto, e va detto con la stessa forza**: quella simulazione
**non contiene il fenomeno che questa sezione modella** — i suoi banditori non alzano l'offerta
quando restano pochi sostituti. Un banco che non simula la scarsità non può premiare chi la
modella. Le due letture restano aperte, e la scelta è fra tre: spegnere §5.5 (`β = 0`) e tenere
solo il ramo binario di §6.2, che nel banco è la parte che funziona; tenerla a `β` molto basso;
oppure aggiungere la scarsità ai banditori — con una forma **diversa** da questa, o il banco si dà
ragione da solo.

⚠ **Nulla di tutto ciò tocca §5.2 e §6.2**, che nel banco sono il pezzo migliore della macro. La
sezione in dubbio è il **fattore continuo**, non l'appetito da cui nasce.

⚠ **`pressioneTipica` non è un valore congelato all'apertura del ruolo, ed è una precisazione che
serve** — «quella che c'era» si presta a due letture, e una delle due produce un motore che si
comporta diversamente a seconda di quando è stata caricata la pagina. Si **ricalcola** ogni volta,
sulla stessa formula, sostituendo alle quantità vive quelle di un ruolo appena aperto: tutti i rivali
con appetito pieno (`R = seats − 1`) e tutti i comparabili ancora liberi (`S` contato sul pool
completo, ignorando le rose). È il denominatore che risponde a «quanta tensione ci sarebbe se questo
lotto fosse il primo del suo ruolo», e va ricavato, non ricordato.

### 5.6 La liquidità del tavolo — l'unico segnale che guarda avanti

Tutto il §3 è retrospettivo: dice cosa **è** successo. Questo dice cosa **può** succedere.

```
liquidità      = Σ crediti dei rivali / Σ slot liberi dei rivali
liquiditàTipica = budget / slotTotali                            (500/25 = 20 a inizio asta)
```

Se a metà asta il tavolo è a 14 crediti per slot residuo, i soldi sono finiti e da lì in poi si compra
a poco — e lo si sa **prima** che i prezzi lo mostrino.

⚠ **Si sovrappone in parte all'indice di §3**, e va gestito invece che ignorato: i due si fondono con
lo **stesso peso di contrazione** già usato ovunque. Con pochi lotti chiusi la liquidità porta il
carico (è l'unica informazione che c'è); man mano che i prezzi osservati si accumulano si spegne e
restano loro. **La liquidità è il prior, i rapporti sono l'osservazione.**

---

## §6 — La sintesi

Tutto in scala logaritmica, dove tre effetti indipendenti sul prezzo diventano tre addendi:

```
ln(centro / ancora) =   scarto(p) · smorzamentoProfilo        §3 × §4   — cosa è già successo
                      + ln(fattoreCompetizione)               §5        — chi ti contende, adesso
                      + peso · ln(liquidità / tipica)         §5.6      — quanto denaro resta

                      totale limitato a ±0.6

dove  peso = k / (n + k)      lo stesso k e lo stesso n della contrazione di §3.2
```

⚠ **`peso` è il complemento esatto della contrazione, e non un secondo coefficiente da regolare.**
Con `n = 0` vale 1 e la liquidità porta tutto il carico; con `n` grande tende a 0 e restano i prezzi
osservati. È la formalizzazione di §5.6 — la liquidità è il prior, i rapporti sono l'osservazione — e
va scritta così perché due manopole separate si sregolerebbero l'una contro l'altra.

```
centro  = ancora × e^(totale)
banda   = [ centro·e^(−0.4σ̂) , centro·e^(+0.4σ̂) ]     il grosso di quello che si sta pagando
soglia  = centro·e^(+1.0σ̂)                             oltre, in quest'asta, si è pagato 1 volta su 6
```

⚠ **Il limite a ±0.6 non è cosmesi.** Senza, un caso degenere — due lotti chiusi, un solo sostituto,
un rivale — produce un numero assurdo con la stessa faccia sicura di uno buono.

⚠ **Il pavimento a `minAmount` vale anche per il `centro`, non solo per la banda** (dal banco,
§10.1). Sembra una pignoleria e non lo è: su un giocatore da un credito il motore proponeva **0,55**,
cioè una cifra che non si può nemmeno offrire.

### 6.0 Il pavimento misurato, e l'asimmetria dei due errori

```
rapporti      = e^y su tutte le osservazioni di §3.1
pavimento     = quantile(rapporti, 0.20)      oppure 0.30 sotto le sei osservazioni
centro        = max(minAmount, centro, ancora × pavimento)
```

⚠ **Nasce dall'obiezione dell'owner del 2026-08-28**, ed è la ragione per cui questa sezione esiste:
*«è impossibile che prenda un buon portiere a 1»*. Ha ragione, e il motivo va scritto perché non è
solo empirico — **i due errori non sono simmetrici**. Consigliare troppo poco **fa perdere il
giocatore**; consigliare troppo costa qualche credito. In un'asta a busta chiusa non c'è un secondo
tentativo: chi offre 1 su un titolare che va a 12 non ha risparmiato undici crediti, ha perso il
titolare. Un motore che minimizza l'errore quadratico tratta i due casi uguale, e sbaglia.

⚠ **Il pavimento non è una costante**: è il quantile basso dei rapporti *di questa asta*, cioè
«quanto costa qui uno che nessuno si contende». Su un rincalzo da un credito vale 0,3 e sparisce
sotto il minimo; su un portiere da 30 vale 9. Si tara da sé e non ha una manopola in più.

### 6.0bis `offri` non è il prezzo atteso

`centro` è dove il lotto andrà a finire **più probabilmente** — offrire quella cifra vuol dire
perdere il giocatore una volta su due. La cifra consigliata sta in cima alla banda:

```
offri  = centro × e^(+0.4·σ̂)      quanto serve per vincere
soglia = centro × e^(+1.0·σ̂)      dove smettere
```

Nel banco la cifra così definita **vince il lotto nel 78% dei casi** sui giocatori veri (ancora ≥ 15).

### 6.1 Il tetto personale, e il «più stretto vince» (decisione 2)

Due tetti, ed entrambi si mostrano solo quando mordono:

- **duro**: `maxBid` del viewer. Oltre, il server rifiuta l'offerta: non è un consiglio, è un fatto.
- **morbido**: `crediti − riserva`, dove `riserva` è, per ogni slot ancora da riempire (escluso
  quello in gioco), l'ancora del **quartile basso** dei giocatori liberi di quel ruolo. Cioè: «per i
  posti che ti restano, metti in conto di spendere quanto un giocatore economico ma non da un
  credito».

Il consiglio mostrato è il **minore** fra banda di mercato e tetti, e **dice quale dei due sta
mordendo** — «lascia oltre 71 *(mercato)*» e «lascia oltre 22 *(il tuo budget)*» sono due frasi
diverse che chiedono due decisioni diverse.

⚠ **Il quartile basso è la scelta più arbitraria della macro**, ed è la prima da guardare sul banco:
la mediana è troppo pessimista (gli ultimi slot si riempiono col fondo), il minimo è troppo ottimista
(è `maxBid`, che di riserva non ne tiene nessuna).

### 6.2 Il «campo libero» è un ramo, non un'etichetta

Quando `R < 0.5` il motore **non** produce una banda calcolata: entra in uno stato dichiarato, perché
lì la statistica non serve e la verità è più semplice.

⚠ **«Non produce» va preso alla lettera, e il banco ha mostrato cosa succede altrimenti** (§10.1).
Nella prima stesura il campo libero era un'*etichetta* appiccicata sopra una banda calcolata
normalmente: il pannello scriveva «parti dal minimo» e il motore emetteva **6,6** su un giocatore
che è poi andato a **1**. Il testo diceva una cosa e il numero un'altra, il che è peggio di
entrambe. Il ramo salta l'intero calcolo: `centro = minAmount`, e il tetto è una frazione
dell'ancora. Sui 109 lotti in cui è scattato, **l'errore è zero**.

> **Campo libero.** Nessuno degli altri ha ancora bisogno di un portiere titolare.
> Parti dal minimo: **1–4**. Il tuo PMA dice 30 — non ti serve.

È il singolo output più prezioso di tutta la macro, e nessun foglio di PMA potrà mai darlo.

### 6.3 I due esempi, coi numeri

**Il caso dell'owner.** 8 squadre, budget 500, slot P 3. Sette portieri titolari assegnati, lui senza.
Chiama un portiere da PMA 6% → **ancora 30**. `titolari(P)=1` → appetito 0 su tutti e sette → **R=0**;
`S`=4 portieri liberi comparabili; pressione 0 contro una tipica di 0.37 → **campo libero**.

> «Offri **1–4**. Nessun rivale ha ancora bisogno di un portiere: il PMA di 30 qui non si applica.»

**Il caso opposto**, per mostrare che il modulo sa anche alzare. Quarto difensore, quattro rivali senza
nessun D titolare, un solo D comparabile ancora libero. `R=4`, `S=1` → pressione 0.8 contro 0.19 →
fattore 1.65. Ancora 40 → **centro 66**.

> «Offri **62–71**. È l'ultimo difensore di questo livello e in quattro lo vogliono.»

**E Dimarco**, che è da dove siamo partiti. Ancora 66. A metà dei difensori: scarto asta −0.02, ruolo D
−0.05, fascia 1 +0.03 → −0.04. `s = 0.95`, scarto negativo → smorzato a −0.013. Centro **65**, σ̂ 0.26
→ banda **59–72**, soglia **84**.

> «Offri **59–72**, lascia oltre 84. I D vanno a −4%, ma su questo profilo lo sconto non si applica.»

---

## §7 — Il gate, e la porta da cui esce (regole 3 e 6, I8)

### 7.1 Perché sul server, e non nel browser

Il motore poteva girare nel browser: il portale ha già tutto — il pool con i PMA, le rose con i prezzi
pagati, crediti e `maxBid` di tutti. Era il disegno iniziale, ed è caduto quando è arrivato Stas+.

`is_pro` funziona perché **il dato è trattenuto dal server**: chi non è Pro non riceve i PMA, e
`types.ts` è esplicito sul perché — *«nasconderlo in JSX o in CSS non sarebbe una protezione, sarebbe
una decorazione»*. Stas+ non ha quella proprietà: un utente Pro riceve già tutti gli ingredienti, e
ciò che Stas+ aggiunge è **il calcolo**. Un gate lato client su un browser che ha tutti gli input è,
per la definizione che questa codebase si è data, una decorazione.

Sul server è anche **più piccolo**: il disegno client richiedeva due campi nuovi nello snapshot **per
tutti** (il budget iniziale, e il numero di lotto su ogni voce di rosa). Sul server spariscono
entrambi.

⚠ **E non su una rotta dedicata**, che pure sarebbe un gate altrettanto vero: violerebbe la regola 7 e
I10. Chi ricarica a metà lotto rivedrebbe un caricamento, e la schermata smetterebbe di essere
funzione pura dello snapshot.

### 7.2 La forma nello snapshot

```ts
/**
 * L'analisi di prezzo del lotto corrente (M22), per chi ha Stas+.
 *
 * ⚠ **Chiave assente, non `null`**, come `carmy` e `insights` in `PoolPlayer`: la
 * decisione la prende la query, una volta sola, e da lì l'assenza si propaga da sé
 * senza nessun `if (stasPlus)` nei componenti.
 *
 * ⚠ **Popolata solo in `LOT_OPEN`.** Fuori dal round di offerte non c'è niente da
 * consigliare, e calcolarla comunque sarebbe lavoro a ogni transizione di ogni asta.
 */
stasPlus?: StasAdvice;
```

`StasAdvice` porta: `banda: [number, number]`, `soglia: number`, `ancora: number`,
`dominante: "MERCATO" | "COMPETIZIONE" | "LIQUIDITA" | "TETTO_MERCATO" | "TETTO_BUDGET"`,
`campoLibero: boolean`, i tre scarti separati per il dettaglio esteso, e `n` (quanti lotti hanno
prodotto la stima) — perché «te lo dico su 3 lotti» e «te lo dico su 90» sono due affermazioni
diverse e chi legge ha diritto di distinguerle.

### 7.3 L'invariante nuovo, e perché va scritto come test

> **Il consiglio si calcola da lotti risolti e da stato pubblico. Mai dalle buste in corso.**

Non è una precauzione in più: è I8 espresso come proprietà di questa macro. Un `JOIN` di troppo verso
`bids` — scritto fra sei mesi da qualcuno che sta ottimizzando una query — farebbe **trapelare le
buste sotto forma di banda di prezzo**, e nessuna schermata lo denuncerebbe: il numero continuerebbe
ad avere la stessa faccia. §10 lo misura invece di dedurlo.

### 7.4 Il costo, e la memoizzazione

`serializeSnapshot` gira per ~12 viewer a ogni transizione. L'ancora richiede il listone **risolto per
quel viewer**, che è una `LEFT JOIN` su ~500 righe.

Il listone risolto è **immutabile durante un'asta** — `carmy_players` e `user_listone` si sostituiscono
solo con un caricamento, che non succede a metà serata — quindi si memoizza per `(auctionId, userId)`.

⚠ **Su `globalThis`, non in una variabile di modulo**, per la ragione già nota agli «errori noti»:
`instrumentation.ts` e i route handler sono bundle separati, e dello stesso file esistono due copie.

⚠ **Il costo va misurato, non stimato.** §10 lo mette fra le prove: se una transizione passa da 8 ms a
80, la memoizzazione non basta e va ripensata la forma, non aggiunto un `setTimeout`.

---

## §8 — Cosa si vede

Dentro `bid-modal.tsx`, **sotto la riga dell'input** (owner, 2026-08-28, guardando il modale): un
blocco a fondo neutro con **la banda, la soglia, e una riga sola** che nomina il segnale dominante.
Tre righe di spiegazione a trenta secondi dal via non le legge nessuno. Su desktop, dentro lo stesso
blocco, il dettaglio esteso: i tre scarti separati, i lotti comparabili già chiusi, i rivali con
appetito e il loro `maxBid`.

**Il punto d'innesto esiste già**: è la riga `<PrezzoConsigliato carmy={carmy} dove="campo" />`, che
in `bid-modal.tsx` sta esattamente fra la riga dell'input e `<FeedbackLine>`. Stas+ si affianca lì.

⚠ **Il fondo è neutro (`bg-muted`) e non un colore, ed è una decisione, non un ripiego.** Nel portale
il colore **significa una fase**: `SceneTone` e la fascia da 4px della colonna 3 (M17 §3) parlano
quel vocabolario, e ciò che si percepisce in periferia dell'occhio è la striscia che cambia. Un
blocco d'analisi colorato entrerebbe in quella conversazione dicendo una cosa che non c'entra. Il
grigio dice «questa è una nota, non uno stato dell'asta». **L'unica eccezione è il campo libero**
(§6.2), che è l'unico caso in cui il colore *è* informazione — e proprio perché il resto è neutro,
lì si vede.

⚠ **Su mobile è una riga sola, e non è una semplificazione grafica.** Il commento di M16 in
`bid-modal.tsx` dice perché la riga dei valori suggeriti è stata tolta: *«i ~44px che la riga
occupava sono altezza restituita al campo, che con la tastiera aperta è la risorsa scarsa»*. Un
blocco che rimettesse quell'altezza — e in mezzo fra il campo e il suo verdetto — disferebbe una
decisione presa apposta. Il dettaglio esteso è **solo** desktop.

⚠ **E niente `dark:`**, come ovunque fuori dalla TV.

### 8.1 ⚠ Il conflitto con la decisione del 2026-08-12, che va guardato prima di scrivere

`components/auction/prezzo-consigliato.tsx` esiste perché l'owner ha guardato il prezzo consigliato
accanto al campo dell'offerta e ha deciso di **non metterlo lì** (`POSIZIONE_PREZZO = "macro"`). Le
due ragioni scritte nel file:

1. *«una cifra suggerita accanto a una cifra da digitare è un suggerimento che qualcuno segue senza
   pensarci»* — non descrive un giocatore, **propone un'azione**;
2. *«se otto persone su otto hanno il file, il prezzo consigliato smette di essere un vantaggio
   informativo e diventa un prezzo di listino»* — l'asta converge lì.

M22 mette una banda e una soglia **esattamente dove quella decisione ha tolto un numero**.

**La seconda obiezione Stas+ la disinnesca da sé**, e in due modi: è un flag riservato, quindi non
diventa listino; e la banda nasce dall'asta viva, quindi due Stas+ con rose diverse ricevono numeri
diversi sullo stesso giocatore. **La prima resta intera**, e questa macro non ha argomenti nuovi
contro di essa.

Quindi si tratta come M10B: **una costante sola, con tutte le forme scritte**, gemella di
`POSIZIONE_PREZZO`.

```ts
export const POSIZIONI_STAS = ["campo", "macro", "tocco", "spento"] as const;
export const POSIZIONE_STAS: PosizioneStas = "campo";
```

**La decisione, presa dall'owner il 2026-08-28 dopo che il conflitto gli è stato posto: `"campo"`,
ma sotto l'input, non sopra, e a fondo neutro.**

⚠ **E la disposizione *è* la risposta all'obiezione, non un dettaglio di layout.** Il timore del
2026-08-12 era «un numero suggerito a due centimetri dal numero da scrivere», cioè un consiglio che
arriva **prima** della decisione e la sostituisce. Sotto il campo, l'ordine di lettura si inverte:
prima vedi la cifra che stai scrivendo, poi cosa ne pensa il motore. Chi lo vuole lo trova, chi ha
già deciso ha già digitato. La decisione del 2026-08-12 non viene ribaltata: viene **rispettata da
un'altra parte** — dalla posizione invece che dall'assenza.

Le tre forme restano scritte, come in M10B: spegnere Stas+ in tutta l'applicazione vuol dire
scrivere `"spento"` qui, e **non** togliere del codice.

---

## §9 — Come cede

Nessuno di questi è un errore da gestire: sono stati normali, e ognuno ha la sua frase.

| Situazione | Cosa succede |
|---|---|
| Non ha Stas+ (o non è Pro) | Chiave assente. Il pannello è quello di oggi, identico. |
| Il giocatore non ha PMA (67 righe) | Nessuna banda. «Questo giocatore non ha un PMA nel tuo foglio.» |
| Asta appena partita | Gli scarti valgono zero: **il consiglio è il PMA**, e `n` dice su quanto. |
| `player_insights` vuota | `s` si calcola sui soli campi del foglio. Nessun percorso critico la attraversa. |
| Nessun rivale con appetito | **Campo libero** (§6.2), che è un consiglio migliore, non peggiore. |
| Asta in pausa | Il pannello d'offerta non si apre (`shouldOpenBidDialog`), quindi non si pone. |

---

## §10 — Le prove, e quella che viene prima di tutte

### 10.1 Il banco di prova — **fatto**, e ha cambiato la spec

**Costruito il 2026-08-28**, prima del branch e prima di una riga di applicazione: un'asta simulata a
otto con il motore vero dentro, e — il punto che lo rende un test e non uno specchio — **banditori
che non usano il motore**. Ogni manager ha un valore privato suo (ancora × gusto), un appetito che
dipende da chi ha già in rosa, e un portafoglio che si svuota. La simulazione decide un umore reale
dell'asta e il motore deve ritrovarlo dai soli prezzi visti. Cinque semi, ~200 lotti ciascuno.

**Le quattro cose che ha trovato, tutte già riportate nelle rispettive sezioni:**

1. **Il campo libero era un'etichetta invece che un ramo** (§6.2). Il pannello diceva «parti dal
   minimo» e il motore emetteva 6,6 su un giocatore da 1 credito. Corretto: 109 lotti su 199,
   errore **zero**.
2. **L'indice di mercato era avvelenato dai lotti da un credito** (§3.1). Stima dell'umore d'asta a
   **−22%** contro un vero **−6%**; escludendoli, **−9%**.
3. **Il `centro` non aveva pavimento** (§6): consigliava `0,55` su giocatori da un credito.
4. **`k = 5` è troppo credulone**: `k = 12` migliora in ogni configurazione provata.

**E la cosa che non ha risolto, che è la più importante:** con `β = 0.35` il motore **peggiora** il
PMA nudo su ogni mondo provato (§5.5). La misura, sui soli lotti **contesi** — sui campi liberi
l'errore è zero per costruzione e contarli truccherebbe la mediana:

| mondo | spec integrale | β = 0 | β = 0, k = 12 |
|---|---|---|---|
| l'asta **rispetta** il foglio | 20,4 vs 14,3 ✗ | 14,6 vs 14,3 ✗ | **13,1 vs 14,3 ✓** |
| l'asta **non** lo rispetta | 23,5 vs 18,8 ✗ | 17,4 vs 19,0 ✓ | **17,0 vs 19,0 ✓** (batte il 60%) |
| non lo rispetta, poche teste diverse | 34,6 vs 27,8 ✗ | — | **23,7 vs 27,8 ✓** (batte l'81%) |

⚠ **La riga da leggere non è una delle tre: è la loro differenza.** Il guadagno di Stas+ non è una
proprietà del motore, è una proprietà **dell'asta in cui gira**: se il tavolo rispetta i PMA non c'è
quasi niente da recuperare per nessuno, e il foglio nudo è già la risposta. Quanto la propria asta si
scosti dal foglio **lo sa solo l'owner**, e nessuna simulazione può dirglielo. È la domanda che la
macro deve avere sciolta prima di partire.

**Il banco resta**, ed è dove si rifà la misura ogni volta che un coefficiente si muove.

### 10.1bis La seconda misura, dopo l'obiezione dell'owner (2026-08-28)

L'appetito graduato (§5.2) e il pavimento (§6.0) hanno cambiato il mondo simulato quanto il motore,
quindi la misura è stata rifatta da capo su **sette semi**, e **sui soli lotti con ancora ≥ 15** —
i giocatori che contano. Un errore mediano calcolato anche sui rincalzi da un credito racconta
soprattutto quanto si è bravi a dire «uno», che non serve a nessuno.

| configurazione | Stas+ | PMA nudo | batte |
|---|---|---|---|
| **spec integrale** | 28,6% | 22,4% | 51% ✗ |
| β = 0 | 17,6% | 22,4% | 66% ✓ |
| β = 0, γ = 0, k = 12 | 17,6% | 22,4% | 64% ✓ |
| **β = 0, γ = 0, k = 12, λ = 0, μ = 0, limite 0,15** | **16,9%** | 22,4% | **70%** ✓ |

**Cosa sopravvive**: §3 (l'indice gerarchico con contrazione), §6.0 (il pavimento), §6.0bis
(`offri` come cifra che vince), e §5.2 — ma **l'appetito decide il verdetto e la riga dei rivali,
non la cifra**.

**Cosa cade**: §5.5 (β, la tensione continua), §5.6 (γ, la liquidità) e **§4.2 (λ e μ, lo
smorzamento asimmetrico del profilo)** — cioè proprio il meccanismo «Dimarco» da cui la macro era
partita. Spegnerli migliora in ogni configurazione provata.

⚠ **Vale per tutti e tre l'avvertenza già scritta in §5.5**: il mondo simulato potrebbe non
contenere i fenomeni che modellano. Ma la conseguenza pratica non cambia — **si rilascia la versione
che la misura sostiene**, e le tre sezioni si riaprono il giorno in cui un'asta vera dice il
contrario. Il limite stretto (0,15) dice la stessa cosa in un altro modo: *stai vicino al PMA, e
correggilo poco.*

## §12 — L'indicatore, che è quello che si costruisce

⚠ **Questa sezione è la macro. §2–§6 sono archivio.**

Richiesta dell'owner (2026-08-29), che ha riportato la macro al suo scopo: *«mi serve un indicatore
per capire opportunità e possibili variazioni di prezzo in base ai giocatori già assegnati […] magari
non mi accorgo che 6 su 8 hanno già la difesa titolare completa, mi devi aiutare tu in questo. Non
fare ragionamenti solo sul valore intrinseco del giocatore, poi sarò io a scegliere i miei target.»*

### 12.1 Perché di sola evidenza, e perché questo scioglie il problema

«Sei su otto hanno la difesa titolare completa» **non è una previsione: è aritmetica sulle rose che
tutti vedono già**. Non ha bisogno di essere validata contro niente — è vera o falsa. È la **stima di
prezzo** ad averne bisogno, ed è quella che tre giri di simulazione non sono riusciti a validare
(§10.1bis, §10.1ter, §10.1quater, e il difetto di §13.1).

⚠ **E la prima versione di questa proposta era peggiore, va detto.** Mostrava solo i conteggi e
toglieva ogni prezzo — ma «6 su 8 hanno chiuso» è utile *solo perché implica «quindi costerà meno»*.
Togliere il prezzo non elimina la previsione: la sposta nella testa di chi guarda, dove nessuno può
più verificarla. La versione giusta tiene il prezzo a schermo **sotto forma di prove**: i comparabili
già venduti e quanto sono costati davvero. L'informazione resta, la stima no.

### 12.2 I cinque fatti

Tutti calcolabili dallo snapshot e dal pool, tutti verificabili a occhio da chiunque, tutti funzioni
pure testabili con vitest.

1. **Chi ha ancora un posto scoperto**, nel ruolo in gioco e **al livello del giocatore chiamato**:
   ```
   scoperti(R,p) = | { m : |giocatori di m in R con ancora ≥ 0.5·ancora(p)| < titolari(R) } |
   ```
   ⚠ **«Al livello» non è una raffinatezza: è la correzione dell'errore del portiere** (§5.2). Chi ha
   un portiere mediocre ha lo slot occupato ma **non** ha un titolare, e comprerà eccome. Un
   conteggio che guardasse i soli slot direbbe il contrario del vero.

2. **Com'era prima.** Lo stesso conteggio dieci lotti fa. ⚠ **È il fatto più importante dei cinque**,
   perché l'occasione sta nel *cambiamento*, non nel livello: «6 su 8» da solo non dice niente, «da 2
   a 6 in dieci lotti» dice che la stanza si è appena svuotata.

3. **Chi te lo contende, per nome**: i membri di (1), diversi da me, con il loro `maxBid` — quanto
   possono davvero arrivare a spendere. Due fatti già nello snapshot.

4. **I comparabili già andati**: gli ultimi giocatori dello stesso ruolo con ancora simile, **e il
   prezzo pagato**, accanto al loro PMA. È qui che vive l'informazione di prezzo, e sono fatti.

5. **Quanti ne restano** di livello comparabile, fra i non ancora assegnati.

### 12.3 I due avvisi

L'unica cosa che non è un fatto nudo, e sono **soglie dichiarate su fatti**, non un modello:

- **SI È SVUOTATA** — `scoperti` è calato sotto un terzo del tavolo **e** restano ancora giocatori
  comparabili. Cioè: la domanda se n'è andata e l'offerta no.
- **SI STA CHIUDENDO** — restano pochi comparabili **e** `scoperti` è ancora alto. Cioè: se lo vuoi,
  è adesso.

Fuori da questi due casi, nessun avviso: i cinque fatti bastano e non si inventa un terzo stato per
riempire lo spazio.

### 12.4 Cosa **non** fa

Nessuna banda, nessuna soglia di uscita, **nessuna cifra consigliata**. ⚠ E questo chiude da sé
l'obiezione del 2026-08-12 su `prezzo-consigliato.tsx`: non c'è più nessun numero suggerito accanto
al campo dell'offerta, quindi non c'è più il suggerimento che «qualcuno segue senza pensarci». I
target li sceglie l'owner — è la sua frase — e lo strumento gli dice **com'è la stanza**, non cosa
fare.

### 12.5 Il costo, e l'unica aggiunta

Il fatto (4) richiede di sapere **quali** lotti sono stati chiusi, a quanto e **in che ordine**: oggi
lo snapshot porta le rose ma non l'ordine. Serve `lotSeq` su `SnapshotRosterEntry` — un numero
pubblico, un lotto risolto è già pubblico, non tocca I8. È la stessa aggiunta che serviva al fatto
(2), e la stessa che serviva alla taratura di §5.5: entra una volta e serve tre cose.

Il resto — `scoperti`, i rivali, i comparabili, quanti restano — si calcola da ciò che il portale ha
già.

---

## §13 — Come si valida davvero, e quando

⚠ **Non con una simulazione.** Tre giri, tre errori nel modello del *comportamento umano*: il gradino
dell'appetito (§5.2), la costante di conversione (§10.1quater), e la pianificazione del budget fra
reparti (§13.1). Ogni volta i numeri del giro precedente sono risultati invalidati. Il problema non è
stato nelle istanze: è che costruire da zero un modello generativo di come otto persone offrono è un
compito in cui non so quando ho finito di sbagliare.

### 13.1 Il terzo errore, per il registro

Spostate le valutazioni dei manager simulati su punti di lega (§11), gli attaccanti risultavano
comprati all'**1% del loro PMA**: con i modificatori difesa e centrocampo che valgono +4 e +3, gli
agenti scaricavano tutto su portieri e difensori e arrivavano all'attacco senza crediti. Le persone
vere tengono da parte. La correzione è delimitata e nota — pianificazione del budget per reparto — ma
la si scrive qui **senza applicarla**, perché la lezione è il terzo errore, non il terzo rimedio.

### 13.2 Quello che funziona: ricalcare un'asta vera

Si riavvolge un'asta realmente giocata — `lots.seq`, `assignments.price`, `players` sono già tutto
quello che serve — si chiede al motore cosa avrebbe consigliato a ogni lotto, e si confronta con
quanto è stato pagato davvero. **Nessun modello di comportamento umano, quindi nessun errore di
modello del comportamento umano.**

⚠ **Oggi non è praticabile**: verificato il 2026-08-29, il database contiene **una sola asta,
simulata, con 37 lotti risolti**. Lo diventa il giorno dopo la prima asta vera giocata su questa app.
È allora che §2–§6 si riaprono, e non prima.

---

## §11 — La configurazione di lega, che è un **input del modello**

⚠ **Fuori perimetro con la decisione del 2026-08-29**, e si tiene perché il lavoro fatto è valido e
perché tre delle sue osservazioni valgono a prescindere dal motore: il **voto puro** calcolabile da
`fmvExp − (3·gol + assist)/presenze`, la **profondità** che batte il fuoriclasse a centrocampo, e le
**tre leve del portiere**. Rientra insieme a §2–§6.

Richiesta dell'owner (2026-08-28), con `fixtures/guida-fantacalcio.md` alla mano: *«la
configurazione della lega con i bonus/malus può impattare sulla valutazione. Rendilo un elemento
variabile necessario per configurare il modello.»*

⚠ **Non è una preferenza: senza, il motore dà consigli sbagliati a metà delle leghe.** Il valore di
un difensore **cambia natura** a seconda che il modificatore difesa sia attivo. Con il modificatore
servono difensori «da media alta e costante»; senza, servono difensori da bonus. Sono due liste
della spesa diverse.

### 11.1 Le tre cose della guida che hanno smentito il modello

1. **§5.3 ribalta la regola sui centrocampisti.** Avevo codificato «i C top fanno vincere» come peso
   di valore, su indicazione dell'owner stesso. La guida dice il contrario: il modificatore
   centrocampo somma **tutti** gli 11 titolari, quindi *«un solo centrocampista sottotono annulla il
   contributo di un compagno»*. Vale la **profondità**, non il fuoriclasse isolato — e il modello
   deve dare valore al quinto centrocampista decente, non al secondo fenomeno.
2. **§5.2 ribalta il valore dei difensori.** Il modificatore guarda il **voto puro**: i bonus non
   contano. Un difensore-goleador altalenante vale *meno*, per il modificatore, di uno «noioso» a
   6,5 costante. ⚠ **E il voto puro è calcolabile da dati che l'app ha già**:
   `fmvExp − (3·gol + assist)/presenze`. Nessuno l'aveva mai calcolato.
3. **§5.1 spiega il portiere.** Tre leve insieme — porta inviolata, gol subito attenuati, e il suo
   voto che entra nel modificatore difesa. È una ragione **indipendente** per cui «offri 1 per un
   portiere» era sbagliato, e conferma la correzione di §5.2 da un'altra strada.

### 11.2 Cosa contiene, e dove entra

Bonus e malus individuali; i due modificatori con le loro soglie; il fair play; e quanti scendono in
campo per reparto (`P:1, D:4, C:4, A:2`) — quest'ultimo decide **dove sta il valore marginale**.

Da lì si calcola il **valore di lega** di ogni giocatore, in *punti attesi per giornata*: il voto
puro, più i bonus individuali, più il contributo ai modificatori, il tutto moltiplicato per la quota
di titolarità (guida §5.6: *«un giocatore fuori formazione vale zero»* — è un moltiplicatore, non un
addendo). E poi il **valore marginale** data la rosa che ho già, con la discesa ripida in attacco e
piatta a centrocampo che la guida descrive.

⚠ **Entra nel verdetto e nelle priorità, non nella stima del prezzo.** `centro` risponde a «quanto
pagherà il tavolo», che non dipende dalla mia lega; il valore di lega risponde a «per chi mi conviene
scostarmi», che ne dipende tutto. Tenerli separati è ciò che permette di misurare l'uno senza
l'altro — ed è così che si è scoperto quanto vale davvero (§10.1quater).

⚠ **Va chiesta alla creazione dell'asta**, con la lega dell'owner come default. Senza, il motore
assume dei modificatori che potrebbero non esserci.

---

### 10.1ter Cento aste, cinque archetipi, e la metrica giusta (2026-08-28)

Proposta dell'owner: *«simulare un centinaio di aste, con casistiche diverse ma riproducibili»* —
equilibrata, bonus in difesa, cannibali sui C top, cannibali sugli A top, ruoli sbilanciati; più
piccole eccezioni dentro ogni archetipo. Fatta, con quattro discipline: **archetipi strutturali**
(un sottoinsieme di manager con una funzione di valore diversa, non la stessa manopola girata),
**nessuna formula condivisa** fra banditori e motore, **risultati per archetipo**, e **taratura su
60 aste, verifica su 40 mai viste**, con il criterio dichiarato *prima*: vincere su ogni archetipo
preso da solo.

⚠ **Lo scenario «ruoli sbilanciati» ha smontato un difetto del banco precedente: il budget è
chiuso.** Se il foglio è tarato sul budget e tutti spendono tutto, la deviazione media dal PMA
sull'intera asta è **~0 per costruzione** — un'asta «tutta a −6%» non esiste. Quello che esiste è
la **redistribuzione fra ruoli**. Il banco vecchio aveva una manopola «umore globale» che nel mondo
reale non è una grandezza libera, e tutte le misure di §10.1bis ne erano distorte. Conseguenza sul
motore: il livello «asta» di §3.2 porta poco, e quasi tutto il segnale sta nel livello «ruolo».

**La verifica, 40 aste mai viste, configurazione congelata prima di guardarle:**

```
β = 0 · γ = 0 · k = 8 · λ = 0 · μ = 0 · limite 0.40 · banda 0.30 · σ₀ = 0.30
offerta consigliata = la stima secca (§6.0bis rivista, vedi sotto)
```

| archetipo | errore Stas+ | PMA nudo | forza rosa |
|---|---|---|---|
| Equilibrata | 27,0% | 42,7% | **+6,9%** |
| Bonus in difesa | 41,8% | 52,2% | **+1,9%** |
| Cannibali sui C top | 28,4% | 43,3% | **+9,2%** |
| Cannibali sugli A top | 25,9% | 43,3% | **+9,6%** |
| Ruoli sbilanciati | 26,7% | 44,6% | −0,5% |
| **aggregato** | **29,0%** | 44,7% | **+5,3%** (30 aste su 40) |

**Il criterio dichiarato è passato**: sull'errore di stima Stas+ vince su tutti e cinque.

⚠ **Ma a metà esperimento ho cambiato metro, e va detto perché indebolisce la garanzia.** «Quanto è
accurata la stima» non è «quanto mi aiuta»: in busta chiusa **paghi quello che offri**, quindi si
può vincere più lotti e finire con una rosa peggiore. La misura vera è **la forza della formazione
titolare a fine asta** — stesso seme, stessi avversari, stesso listone, cambia solo come offre il
manager 0. Su quella il guadagno è **+5,3%**, cioè circa un titolare in più; e «ruoli sbilanciati»
sta a −0,5% con 4 aste vinte su 8, che è testa o croce, non un fallimento dimostrato. Otto aste per
archetipo sono poche: quei numeri hanno barre d'errore larghe, e nessuno dei cinque va letto come
definitivo.

**Due cose che la metrica giusta ha ribaltato:**

1. **`offri` torna a essere la stima secca, non la cima della banda.** Puntare a vincere costava più
   di quanto rendesse: 34 crediti di sovrapprezzo medio sui lotti vinti, che poi mancano altrove.
   §6.0bis va corretto: la banda **comunica l'incertezza**, non è una cifra da offrire.
2. **La mira graduata sui top C/A non paga.** La regola di dominio dell'owner — *«centrocampisti top
   e migliori punte ti fanno vincere»* — è vera sul **valore** e infatti sta nel modello del mondo,
   ma **non implica offrire sopra la stima**: alzare la mira ha peggiorato la rosa finale in ogni
   prova. Il posto giusto di quella regola è il valore, non il rilancio.

### 10.1quater 500 aste, e il numero definitivo (2026-08-28)

Su proposta dell'owner (*«per me non è un problema fare 500 aste»*) e con la configurazione di lega
di §11 dentro il modello. **300 aste di taratura, 200 di verifica mai viste**, configurazione
congelata prima di guardarle. Obiettivo: **punti attesi della formazione titolare**, che è il solo
obiettivo che conti — non l'accuratezza, non i crediti risparmiati.

| archetipo | PMA nudo | Stas+ | Stas+ con la lega |
|---|---|---|---|
| Equilibrata | 78,4 | +1,3% | **+1,8%** |
| Bonus in difesa | 78,1 | +2,8% | **+2,6%** |
| Cannibali sui C top | 78,7 | +3,2% | **+2,8%** |
| Cannibali sugli A top | 78,5 | +1,3% | **+1,6%** |
| Ruoli sbilanciati | 79,7 | −0,1% | **+0,5%** |
| **aggregato** | **78,7** | **+1,7%** · 133 aste su 200 | **+1,9%** · **148 su 200** |

**Il verdetto: passa su tutti e cinque gli archetipi, con +1,9% di punti attesi e 148 aste vinte su
200.** Il criterio dichiarato prima dell'esperimento è soddisfatto.

⚠ **E il numero è la metà di quello che avevo riportato.** Sulle 40 aste di §10.1ter avevo misurato
**+5,3%**; su 200 è **+1,9%**. La differenza è **sovradattamento più rumore di campione piccolo**, ed
è precisamente ciò che la proposta dell'owner esisteva per smascherare. Chi legge questa spec fra sei
mesi deve sapere che +1,9% è il numero, e che +5,3% era un miraggio da 40 aste.

⚠ **Quanto vale la configurazione di lega, misurato**: porta le aste vinte da **133 a 148 su 200**,
ma la media solo da +1,7% a +1,9%. Cioè **rende il vantaggio più affidabile, non più grande** — e va
detto perché è il contrario di quello che ci si aspetterebbe da un modello che «conosce le regole».
La ragione è che il prezzo lo fa comunque il tavolo, e il giocatore alternativo che prendi è anche
lui decente: il guadagno si diluisce. Misurato anche al variare di **quanti avversari capiscono i
modificatori**: con tutti consapevoli il vantaggio è +0,13% (i modificatori sono già nel prezzo), con
tutti che seguono il foglio è +0,85%. **La conoscenza della lega vale in proporzione all'ingenuità
del tavolo**, ed è un'informazione che l'owner ha e il modello no.

**La domanda che resta all'owner, ed è di prodotto, non di misura: +1,9% di punti attesi — circa 1,5
punti a giornata su 79 — vale una colonna nel database, una tab, un blocco nello snapshot e il codice
nel motore?** La misura ha fatto il suo mestiere; questa risposta non è sua.

⚠ **E un difetto d'interfaccia trovato dalla stessa diagnostica**: il tetto personale (§6.1)
**sostituiva** la cifra di mercato invece di affiancarla — un attaccante che vale 141 riceveva
«offri 62» senza dire che 62 era il portafoglio, non il prezzo. Sono due fatti e vanno mostrati
entrambi: *«serve 141, tu arrivi a 96»*.

### 10.2 I test di `pnpm test`

- **L'invariante di §7.3**, e non per deduzione: si costruisce uno stato con un lotto aperto, si
  calcola l'analisi, si **cambiano le offerte vive** (importi diversi, un ritiro, un'offerta in più) e
  si ricalcola. **Deve uscire lo stesso identico oggetto.** È il test che tiene in piedi I8 dentro
  questa macro.
- Con zero lotti risolti, `centro === ancora` — il motore non inventa.
- La contrazione: 1 lotto e 50 lotti nello stesso gruppo, con la stessa media, danno scarti diversi e
  nel verso giusto.
- L'appetito: l'esempio dei portieri di §6.3 con i numeri esatti, come test.
- `titolari(R)` su una configurazione di slot non standard.
- Il limite `±0.6` su uno stato degenere costruito apposta.
- Il gate: `canSeeStasPlus` su tutte e sei le combinazioni di `stasPlus × isPro × isAdmin`.
- `setStasPlus`: non amministratore, utente inesistente, **la propria riga**.

### 10.3 Le prove a mano su `dev`

- La misura di §7.4: quanto costa davvero una transizione con 12 viewer Stas+.
- Un'asta simulata dall'applicazione (M4) con un utente Stas+ e uno senza, aperti fianco a fianco.
- La conferma di §8.1, guardando lo schermo.

---

## §11 — Task

Nessuna spuntata: la macro **non è aperta**. La lista è quella del perimetro di §12; §2–§6 e §11
non hanno task perché non si costruiscono.

**Deciso e chiuso**

- [x] Il banco di prova (§10.1), e le tre tornate di misura che hanno portato a §13
- [x] `POSIZIONE_STAS = "campo"`, **sotto** l'input e a fondo neutro (owner, 2026-08-28)
- [x] **Il perimetro**: solo evidenza, la stima fuori (owner, 2026-08-29)

**Il flag**

- [ ] `stas_plus` in `lib/db/schema.ts`, con la nota di §1
- [ ] `canSeeStasPlus` in `lib/domain.ts` — l'AND con `is_pro`
- [ ] `setStasPlus` in `lib/engine/admin.ts` + la colonna in `lib/admin-users.ts` + il pannello
- [ ] §1.2: Stas+ inerte su riga non Pro, **dichiarato** e non solo spento

**L'indicatore (§12)**

- [ ] `lib/engine/stas.ts`: `scoperti(R,p)` col confronto **di livello**, non di slot (§12.2-1)
- [ ] `lib/engine/stas.ts`: lo stesso conteggio dieci lotti fa (§12.2-2)
- [ ] `lib/engine/stas.ts`: rivali per nome col loro `maxBid` (§12.2-3)
- [ ] `lib/engine/stas.ts`: comparabili già andati col prezzo pagato (§12.2-4)
- [ ] `lib/engine/stas.ts`: quanti ne restano (§12.2-5)
- [ ] `lib/engine/stas.ts`: i due avvisi, con le soglie dichiarate (§12.3)
- [ ] `lotSeq` su `SnapshotRosterEntry` (§12.5) — l'unica aggiunta, e serve a tre fatti
- [ ] `StasRoom` in `lib/realtime/types.ts` + il campo in `serializeSnapshot` (§7.2)
- [ ] La memoizzazione del listone risolto su `globalThis` (§7.4)
- [ ] Il pannello in `bid-modal.tsx`, colonna destra desktop (§8)
- [ ] La tab Stas+ accanto ad Asta e Listone

**Le prove**

- [ ] L'invariante di §7.3 come test: **cambiare le buste vive non cambia l'indicatore**
- [ ] `scoperti` sull'esempio dei portieri: sette rivali serviti, io no → 1 su 8
- [ ] ⚠ `scoperti` su un rivale con un portiere **mediocre**: deve contarlo come scoperto
- [ ] Le due soglie di §12.3 sui casi limite
- [ ] Il gate: `canSeeStasPlus` su tutte le combinazioni; `setStasPlus` sulla propria riga

**Chiusura**

- [ ] `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` (il perimetro del 2026-08-29 e il perché)
- [ ] Togliere la richiesta da `docs/REQUESTS.md` — **solo** all'apertura della macro
- [ ] `CHANGELOG.md` e `package.json` al merge su `main`, e il `pnpm db:push` sul server
