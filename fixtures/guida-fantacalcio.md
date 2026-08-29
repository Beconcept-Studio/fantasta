# Guida pratica al Fantacalcio — Lega di Andrea

Questa guida spiega come funziona il punteggio nella tua lega e, soprattutto, **come ragionare** per costruire una squadra che vince, non solo che fa punti sulla carta.

---

## 1. Come si forma il punteggio di una squadra

Il punteggio totale di ogni giornata è dato da:

```
Somma voti (con bonus/malus dei singoli giocatori)
+ Modificatore Difesa (se applicabile)
+ Modificatore Centrocampo (solo bonus, se applicabile)
+ Fattore Fair Play (se applicabile)
```

I modificatori NON sono un dettaglio marginale: nella tua lega possono valere da soli **+4 (difesa) e +3 (centrocampo)**, cioè quanto un gol e mezzo. Costruire la squadra pensando solo a "chi fa più bonus" e ignorando i modificatori è l'errore più comune e più costoso.

---

## 2. Bonus e malus individuali

| Evento | Punti |
|---|---|
| Gol segnato | +3 |
| Rigore segnato | +3 |
| Rigore parato (portiere) | +3 |
| Gol della vittoria | +0,5 (aggiuntivo al gol) |
| Gol del pareggio | +0 (nessun extra oltre al gol) |
| Assist | +1 |
| Assist gol | +1 |
| Assist soft | +0,5 |
| Porta inviolata | +1 |
| Player of the Match | +0,5 |
| Ammonizione | −0,5 |
| Espulsione | −1 |
| Rigore sbagliato | −2 |
| Autogol | −2 |
| Gol subito (portiere/difesa) | −1 |

> Nota: la tua lega distingue tre livelli di assist (assist, assist gol, assist soft). Se non hai il regolamento sotto mano su Tolaria per la definizione esatta di ciascuno, verificalo — ma per la strategia conta soprattutto il totale: un giocatore che partecipa spesso all'azione del gol vale più di un "puro finalizzatore silenzioso".

### Fattore Fair Play (+1)
Si ottiene **solo se nessuno degli 11 titolari prende un'ammonizione**. È un bonus di squadra, non individuale: basta *un solo* cartellino giallo su 11 giocatori per perderlo. Questo lo rende molto più fragile di quanto sembri sulla carta.

---

## 3. Modificatore Difesa

**Si attiva** schierando almeno 4 difensori.

**Come si calcola:** media dei **voti puri** (senza bonus/malus) dei migliori 3 giocatori del reparto arretrato — dove il portiere entra nel conteggio se il suo voto è tra i 3 migliori; se il voto del portiere non rientra tra i migliori 3, si passa alla media dei **migliori 4 difensori**, portiere escluso.

| Media voto | Modificatore |
|---|---|
| < 6 | 0 |
| ≥ 6 e < 6,25 | +1 |
| ≥ 6,25 e < 6,5 | +1,5 |
| ≥ 6,5 e < 6,75 | +2 |
| ≥ 6,75 e < 7 | +3 |
| ≥ 7 | +4 |

**Punti chiave:**
- Si basa sul voto *puro*: i bonus (gol, assist) dei difensori non contano per questo calcolo. Un difensore che fa un gol a voto 6 in pagella non "aiuta" il modificatore più di un difensore che prende semplicemente 7 di voto.
- Le soglie sono ripide: il salto tra 6,75 e 7 vale +1 punto pieno (da +3 a +4). Un decimo di voto medio può valere più di un gol.
- Il portiere può essere una delle 3 pedine che determinano il calcolo. Questo lo rende doppiamente strategico (vedi sezione 5).

---

## 4. Modificatore Centrocampo

**Come si calcola:** si somma lo scarto (voto − 6) di **tutti gli 11 titolari** impiegati a centrocampo, non solo dei migliori. La somma ottenuta ("differenza") determina il bonus:

| Differenza | Modificatore |
|---|---|
| 2 | +1 |
| 2,5 | +1 |
| 3 | +1,5 |
| 3,5 | +1,5 |
| 4 | +2 |
| 4,5 | +2 |
| 5 | +2 |
| 5,5 | +2 |
| 6 | +3 |
| < 2 | 0 |

È **solo in bonus**: se la differenza è negativa o troppo bassa, semplicemente non scatta nulla — non esiste un malus di modificatore.

**Punto chiave, il più importante di tutta questa sezione:** essendo la somma calcolata su *tutti* i centrocampisti titolari, **un solo centrocampista sottotono (voto 5, scarto −1) annulla il contributo di un compagno che ha fatto 7 (scarto +1)**. Non basta avere un fenomeno a centrocampo: serve che *nessuno* del reparto sia un buco. Un reparto di 4 centrocampisti "normali" a voto 6,5 (scarto totale +2) rende più del modificatore di un reparto con un 8 e un 5 (scarto totale netto ancora +2, ma molto più a rischio di scendere sotto per un singolo voto negativo).

---

## 5. Le regole non scritte (quelle che decidono il campionato)

### 5.1 — Il portiere conta doppio (o triplo) se hai imbattibilità + modificatore difesa
Un portiere solido non è "solo" un titolare che prende voto pieno. Con la tua configurazione di lega mette in moto **tre leve insieme**:
1. Bonus diretto **porta inviolata +1**;
2. Riduce il malus **gol subito −1** a ogni gol incassato;
3. Il suo voto puro può essere uno dei migliori 3 usati per il **modificatore difesa**, spingendolo verso soglie da +3/+4.

Conclusione pratica: se nella tua lega hai attive sia l'imbattibilità che il modificatore difesa, il portiere titolare di una squadra solida (pochi gol subiti, voti alti e costanti) vale molto più della sua singola pagella. Vale la pena spendere budget/scelta su un top portiere piuttosto che risparmiare lì per investire tutto in attacco.

### 5.2 — Per il modificatore difesa, servono difensori "da media", non da bonus
Dato che il calcolo ignora bonus/malus, un difensore-goleador che segna ma prende voti altalenanti (5,5 una gara, 7 quella dopo per il gol) è meno utile per il modificatore di un difensore "noioso" che fa sempre 6,5 pulito. I difensori-bonus (gol/assist) restano ottimi per il punteggio individuale, ma **non sostituiscono** la necessità di 3-4 difensori a voto medio alto e stabile per far scattare le fasce +3/+4.

### 5.3 — Per il modificatore centrocampo, serve equilibrio su tutta la linea, non un fuoriclasse isolato
Vale quanto detto al punto 4: qui la logica è opposta a quella della difesa. Non basta avere un top player a centrocampo se il resto del reparto è debole — un singolo voto sotto 6 può azzerare o abbassare drasticamente la fascia di bonus. Priorità: **profondità e costanza** di tutto il reparto centrocampo, comprese le riserve pronte a subentrare quando un titolare rischia il voto basso (infortuni, diffide, trasferte difficili).

### 5.4 — I goleador spostano tanto, statisticamente, perché il gol vale già +3 di base
Il gol (+3) è il singolo evento a punteggio più alto della tabella, insieme al rigore segnato e al rigore parato. Un attaccante che segna con continuità (specialmente se rigorista, dato che rigore segnato = altri +3) genera oscillazioni di punteggio molto più ampie di qualsiasi altro ruolo. Questo significa:
- In asta/scelte, un attaccante titolare fisso con buona probabilità di gol vale una spesa/priorità alta anche se "caro", perché il ritorno atteso per singola gara è alto e concentrato (non diluito su tanti bonus piccoli).
- I rigoristi vanno cercati attivamente: rigore segnato (+3) supera ampiamente il rischio di un rigore sbagliato (−2), quindi se un giocatore ha alta percentuale realizzativa il valore atteso resta comunque molto positivo.

### 5.5 — Il fair play è fragile: un cartellino costa più di 0,5 punti
L'ammonizione singola vale solo −0,5, ma se capita a **uno qualsiasi** degli 11 titolari fa perdere anche il fair play di squadra (+1). Il costo reale di un'ammonizione, quindi, è spesso **−1,5 complessivi**, non −0,5. Vale la pena:
- Evitare di schierare più "diffidati/nervosi" contemporaneamente nella stessa giornata, soprattutto in derby o gare ad alta tensione;
- Considerare il fair play come una leva da proteggere attivamente in formazione, non come un bonus passivo che arriva "se capita".

### 5.6 — Ordine di priorità pratico per costruire/gestire la rosa
Con questa configurazione di punteggio, l'ordine di priorità consigliato è:
1. **Titolarità certa** in qualsiasi ruolo — un giocatore fuori formazione vale zero, indipendentemente dal talento.
2. **Attaccanti da gol garantito**, in particolare rigoristi di squadre che segnano molto.
3. **Blocco difesa a media alta e costante** (3-4 difensori solidi, non necessariamente da bonus) + **portiere titolare di squadra forte**, per massimizzare il modificatore difesa e l'imbattibilità insieme.
4. **Profondità a centrocampo**: meglio 5-6 centrocampisti dignitosi che 2 fenomeni e il resto scarso, per non far collassare il modificatore centrocampo a ogni turno con assenze o diffide.
5. Solo a parità di tutto il resto, differenziare in base a rigoristi secondari, assist-men, e giocatori da Player of the Match.

---

## 6. In sintesi

Il punteggio della tua lega premia due strategie complementari che vanno gestite **insieme**, non separatamente:
- **In attacco**: concentrazione del rischio su pochi giocatori da gol/rigore, perché il singolo evento vale molto (+3).
- **In difesa e centrocampo**: distribuzione e costanza, perché i modificatori premiano la media di reparto e non i singoli exploit — con la differenza cruciale che la difesa guarda ai migliori 3-4, mentre il centrocampo guarda a **tutti** i titolari impiegati.

Chi vince la lega, tipicamente, non è chi ha la rosa con più "nomi", ma chi riesce a tenere sempre in campo 4 difensori solidi e un centrocampo senza buchi, lasciando che uno o due attaccanti da gol facciano la differenza nei punteggi individuali.
