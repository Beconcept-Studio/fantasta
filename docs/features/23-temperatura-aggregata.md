# M23 — La temperatura, rifatta: un rapporto fra somme

> **Stato:** **in produzione da `v1.23.0`** (2026-09-02). Gate verde — `pnpm test` **1044/1044** (da
> 1057: ventisei test se ne vanno con le funzioni che tolgono, tredici arrivano nuovi),
> `pnpm typecheck`, `pnpm build`.
>
> ⚠ **Senza branch di feature, ed è una scelta dell'owner detta a voce**: i commit sono andati
> **diretti su `dev`** e da lì con `merge --no-ff` su `main`. Il punto di rollback quindi non è un
> merge commit di macro, è il **tag `v1.23.0`**.
>
> ⚠ **Le prove a mano le fa l'owner in produzione**, come per M22: in locale non erano possibili
> perché `carmy_players` del database di sviluppo è vuota (§6).
>
> **Non tocca lo schema del database.** Nessuna colonna, nessun backfill, nessun `pnpm db:push`: il
> rilascio è il merge e basta. `users.stats_plus` di M22 resta com'è, gate compreso.
>
> **Non tocca il motore.** Niente su `machine.ts`, `rules.ts`, `mutate.ts`, nessun
> `withAuctionLock`, e `serializeSnapshot` non cambia di un campo — `lotSeq`, che M22 aveva aggiunto,
> è tutto ciò che serviva e c'è già.
>
> **Nasce da una revisione dell'owner su M22 in produzione**, non da una richiesta del quaderno:
> *«Non sono molto sicuro del dato visualizzato»*. Quattro giri di mock su artefatto prima di
> scrivere una riga.
>
> **Invarianti coinvolti:**
> **I8** — invariato e ancora misurato: il primo `describe` di `tests/stats-plus.test.ts` confronta
> due stati che differiscono **solo** per le buste vive e pretende lo stesso oggetto. È stato
> **aggiornato alle funzioni nuove**, non lasciato a guardare quelle vecchie — che è il modo in cui
> quel test poteva diventare verde e inutile.
> **I10** — invariato: il pannello resta funzione pura di snapshot e pool.
>
> **Regole coinvolte:** **6** (`pmaAsta` ha un pavimento a 1 credito perché zero non è un'offerta
> valida: la UI non propone accanto al campo una cifra che il server rifiuterebbe), **8** (il
> bilancio è **più codice tolto che aggiunto**: cinque funzioni e tre costanti fuori, tre funzioni
> dentro).

---

## §0 — Perché M22 non convinceva, in tre fatti

L'owner non era sicuro del numero. Riletto il codice, le ragioni erano tre e nessuna era un bug:

1. **Era una mediana di rapporti, lotto per lotto.** Un lotto da 10 crediti pesava quanto uno da 50.
   Rispondeva a «com'è andato il lotto tipico» mentre la domanda era «quanti crediti sono usciti dal
   tavolo». ⚠ **E le due risposte possono avere segno opposto**: due lotti, uno da 50 crediti pagato
   25 e uno da 10 pagato 20, danno **+25%** di mediana e **−25%** di aggregato. È il primo test di
   §4.
2. **Esisteva solo per il ruolo in corso.** Il reset a ogni ruolo — che era la richiesta centrale di
   M22 — si vedeva come un numero solo che a un certo punto ricominciava da capo, senza niente che
   lo dicesse. I ruoli chiusi avevano il *saldo* in crediti, che è un'altra cosa nella stessa
   schermata.
3. **Non esisteva nessun numero d'insieme.** Cross-ruolo, niente.

E il quarto, che non era un difetto del dato ma della sua forma: **il «prima/adesso»** — due
percentuali accostate, l'una il passato dell'altra — *«non riesco a capire cosa sia»*. Aveva ragione:
niente nella riga diceva che una delle due era il passato dello stesso reparto.

---

## §1 — Il numero: Σ pagato ÷ Σ atteso

```
temperatura(lotti) = Σ prezzi pagati ÷ Σ (PMA in crediti)
```

Il peso lo fa il budget e non il conteggio dei lotti, che è ciò che rende il numero **la risposta
alla domanda vera**: quanti crediti sono usciti rispetto a quanti il foglio ne chiedeva.

⚠ **`pagato`, `atteso` e `n` viaggiano col rapporto** e non sono un dettaglio che la UI può
buttare: sono ciò che rende il numero verificabile a mano, e `n` è ciò che distingue «te lo dico su
4» da «su 40».

⚠ **Il filtro dei lotti informativi resta identico a M22** — PMA del chiamato ≥ 5 crediti, fuori le
assegnazioni manuali, fuori chi non ha PMA — ed è una decisione dell'owner presa sapendo il costo.
**Misurato: tenerlo o toglierlo sposta la temperatura di al massimo un punto** (portieri −45% contro
−44%), perché i 12 lotti esclusi valgono **17 crediti su 760**. Con l'aggregato il filtro non serve
più a proteggere niente — il peso lo fa già il rapporto — ma non fa danno, e la sua unica
conseguenza va saputa: **la somma dei ruoli non è la spesa reale del tavolo**, ed è il 2% dei
crediti.

### 1.1 Una riga per ruolo, più il totale

`temperaturaPerRuolo` calcola i quattro ruoli e la loro somma.

⚠ **Il totale è la somma degli stessi lotti, ed è un invariante che la mediana non poteva avere.**
Con due mediane, «il totale» e «la media dei ruoli» sarebbero stati due numeri diversi senza che
niente lo dicesse, **nella stessa tabella**. Qui `totale.pagato` è per costruzione la somma dei
`pagato` di ogni ruolo, e c'è un test che lo misura: è la ragione per cui il totale può stare in
fondo alla stessa colonna invece che in un blocco a parte.

⚠ **Un ruolo non ancora cominciato è `null`, che a schermo è `N/A` e non `0%`.** Uno zero vorrebbe
dire «si paga esattamente il PMA», che è un'affermazione; qui non è stato chiuso ancora niente.

### 1.2 La finestra recente: 8 lotti, uno per partecipante

`temperaturaRecente(lotti, finestra = 8)` è la stessa aritmetica sugli **ultimi `finestra` lotti del
ruolo in corso**.

⚠ **Prende in ingresso i lotti di un ruolo solo, e non è un caso**: «gli ultimi otto lotti
dell'asta» subito dopo un cambio di ruolo sarebbero ancora del reparto precedente, e il numero
direbbe come si pagavano i portieri a chi sta offrendo per un difensore.

⚠ **Sotto 8 lotti è `null`, non «il ruolo intero»**: con sette lotti chiusi la finestra
coinciderebbe col ruolo, cioè lo stesso numero in due badge accanto.

⚠ **Otto è una costante, non `snapshot.members.length`**, e la differenza va saputa perché la
*ragione* del numero è «un giro di tavolo»: a un tavolo da dodici, la finestra coerente con quella
ragione sarebbe dodici. Resta fissa perché un numero che cambia col tavolo cambierebbe anche
l'etichetta a schermo (`PMA Last 8` / `PMA Last 12`) e renderebbe due aste non confrontabili. Per
legarla al tavolo basta passare `snapshot.members.length` come secondo argomento: **il parametro
esiste per quello**, e questo paragrafo è il posto in cui la decisione è scritta.

⚠ **Otto lotti sono pochi crediti, e il badge non lo dice.** Misurato sul dataset del mock: gli
ultimi lotti di un ruolo sono **strutturalmente i più piccoli**, perché i giocatori si chiamano dal
più caro in giù — cinque lotti in coda facevano 29 crediti pagati su 26 attesi, e quel +12% veniva
poi moltiplicato per un giocatore da 44. Non è un difetto da correggere con una formula: è la natura
di una finestra corta, ed è la ragione per cui **i tre badge stanno insieme** (§2). Da 5 a 8 la
finestra è già stata allargata una volta proprio per questo.

### 1.3 `pmaAsta`, in un posto solo

```
pmaAsta(pma, budget, rapporto) = max(1, round(pmaCrediti(pma, budget) × rapporto))
```

⚠ **Il pavimento a un credito non è simmetria con `pmaCrediti`: è che zero non è un'offerta
valida.** Su un giocatore da un credito atteso e un ruolo che paga il 40% del foglio la
moltiplicazione dà `0,4`, che arrotonda a zero — e accanto al campo comparirebbe una cifra che il
server rifiuta.

⚠ **In un posto solo, come `pct`**: ne escono due badge, e se la moltiplicazione stesse nei
componenti il primo che arrotonda diversamente darebbe due cifre per lo stesso giocatore nella
stessa schermata.

---

## §2 — Dove si vede

### 2.1 I tre badge sotto il campo dell'offerta

```
PMA: 44                    PMA Ruolo: 37   PMA Last 8: 49
```

Il PMA del foglio a sinistra; a destra lo stesso PMA corretto per come il tavolo sta pagando quel
reparto **dall'inizio** e **adesso**.

⚠ **Tutti e tre dello stesso grigio** (owner): nessuno ha la precedenza. Un badge in pieno direbbe
«segui questo», e quale numero seguire è la deduzione che questa macro lascia a chi gioca.

⚠ **Nessuna percentuale nei badge.** Il `−15%` è il ponte fra le cifre, non una cifra in più: la
differenza fra 44 e 37 è già visibile, e una percentuale accanto chiederebbe una moltiplicazione a
chi ha venti secondi.

⚠ **`N/A` invece di un badge che sparisce**: una casella che a volte c'è e a volte no si legge come
un difetto di allineamento — è la stessa decisione del segnalibro sulle righe del listone (owner,
2026-08-28).

⚠ **Sta dentro il vincolo di M16, misurato e non stimato.** 29px contro i 27 della riga di testo che
sostituisce; 268px di badge sui 361 disponibili a 393px di schermo, quindi nessun ritorno a capo. Le
altre due forme proposte sono state scartate proprio lì: i *tre valori incolonnati* costavano 70px,
cioè **+43px — esattamente i ~44px che M16 aveva restituito al campo** — e il *righello con la
banda* 67px.

⚠ **E qui va detta la cosa scomoda: questo blocco è una cifra da offrire**, cioè esattamente ciò che
la decisione del 2026-08-12 aveva tolto da accanto al campo (`POSIZIONE_PREZZO = "macro"`). La
differenza rispetto ad allora è che nasce dall'asta viva e non dal foglio, quindi non può diventare
un prezzo di listino che otto persone leggono uguale. **Ma resta un numero accanto a un numero da
digitare**, ed è una decisione dell'owner presa guardando il mock, non una conseguenza che è entrata
di contrabbando.

### 2.2 La tabella, nella tab e nella colonna del modale

Una riga per ruolo — nome, stato (`chiuso` / `in corso`), numero di lotti, badge — e in fondo, dopo
una riga più marcata, **Tutta l'asta**.

⚠ **Il conteggio dei lotti resta accanto alla percentuale**: «−45% su 13 lotti» e «−45% su 40» non
sono la stessa affermazione, e la differenza non si vede dal numero.

⚠ **Nessun `box-shadow` e nessun badge in pieno**: il ruolo in corso si segna con `border-l-2`, il
totale con una riga più marcata. Vedi §3.

---

## §3 — Le ombre, e cosa hanno insegnato i due banchi

**Richiesta dell'owner: nessun `box-shadow`, in generale.** Sono state tolte **tutte e 12** le
occorrenze dal nostro codice, in 9 file: `shadow-2xl` sui due sheet (offerta e chiamata) e sul
pannello laterale admin, `shadow-sm` sulle due colonne del portale, sulla linguetta attiva, sulla
scene-card, sulla status-card e sul segmento selezionato delle impostazioni, `shadow-lg` sul modale
d'import e sul toast admin, `shadow-xs` sull'interruttore.

⚠ **Una di quelle dodici stava facendo un lavoro**, e non si è tolta e basta: in
`role-order-picker.tsx` lo `shadow-lg` compariva **solo durante il trascinamento** ed era l'unica
cosa che diceva «questa riga è sollevata». È diventata `border-primary`.

⚠ **`components/ui/**` non ne aveva nessuna**, e va scritto perché in questa sessione l'ho affermato
il contrario prima di verificarlo: le ombre dell'app erano tutte nostre.

⚠ **I `ring-*` non sono stati toccati.** Tecnicamente Tailwind li implementa con un `box-shadow`, ma
sono lo **stato di focus da tastiera**: togliere quelli è togliere l'accessibilità, non un'ombra.

### 3.1 Il banco col CSS vero ha trovato due difetti che il mock non poteva vedere

Il mock su artefatto aveva token propri; il banco monta le **classi Tailwind copiate verbatim dai
componenti** contro il CSS compilato da `pnpm build`. Due cose sono venute fuori solo lì:

1. **I badge erano invisibili.** Erano `bg-muted` dentro un `Riquadro` che è `bg-muted`, e nel tema
   dell'app `--muted`, `--secondary` e `--accent` valgono **tutti** `oklch(0.97)`: lo stesso grigio
   su se stesso. ⚠ **E `bg-background` non risolveva**, perché la riga del ruolo in corso è già
   bianca — un badge bianco sarebbe sparito proprio sulla riga che conta. Sono diventati badge con
   **un bordo e nessun fondo**, che si vedono su entrambi.
2. **Il binario del ruolo in corso si leggeva come una parentesi quadra**: `rounded-md` curvava
   anche il `border-l-2`. È diventato `rounded-r-md`.

⚠ **La lezione è sulla tavolozza, non sui due difetti**: nel tema dell'app **tre token diversi hanno
lo stesso valore**, quindi «fondo grigio su fondo grigio» non si vede in nessun mock che usi colori
propri. Chi disegna un pannello dentro un `Riquadro` deve guardarlo col CSS dell'app, non con il
proprio.

---

## §4 — I test: cosa entra e cosa se ne va

**1044 test** (da 1057). Ventisei se ne vanno con le funzioni che tolgono, tredici arrivano.

I tre che non esistevano e valgono più degli altri:

- **la mediana e l'aggregato hanno segno opposto** sul caso costruito di §0.1 — è il test che
  giustifica l'intera macro, e senza il caso costruito non direbbe niente;
- **il totale è esattamente la somma dei ruoli**, su `pagato`, `atteso` e `n`;
- **la finestra prende la coda per `lotSeq`, non l'ordine in cui le rose consegnano** — con le
  stesse cifre consegnate al contrario i due ordini danno `−15%` e `+20%`, quindi il test è una
  prova e non una tautologia.

⚠ **Un test l'ho scritto sbagliato e la prima cosa da fare è stata guardare il test, non il
codice**: avevo atteso `−50%` dove l'aritmetica dava `−15%`, perché con dodici lotti invertiti la
coda per `lotSeq` è **mista** (quattro caldi e quattro freddi), non tutta fredda. Il codice era
giusto.

⚠ **Il test di I8 è stato aggiornato, non lasciato dov'era.** Confrontava un oggetto che conteneva
`saldo`, `scatto` e `avvisi`: con quelle funzioni via, sarebbe rimasto verde continuando a
sorvegliare tre cose che non esistono più. Ora confronta `temperaturaPerRuolo`,
`temperaturaRecente`, `scartoPerPartecipante` e `scartoStrutturale`. ⚠ E alla finestra recente passa
**2** invece di 8: con 8 l'oggetto darebbe `null` in entrambi gli stati, cioè un confronto fra due
assenze.

---

## §5 — Cosa esce dal codice

| Esce | Perché |
|---|---|
| `scatto()`, `Scatto` | il prima/adesso non si leggeva; la sua domanda torna come «Last 8» |
| `avvisi()`, `Avviso`, `SOGLIA_AVVISO`, `MIN_LOTTI_PER_PARTE` | il cambio d'aria era ridondante con la tabella, e senza scatto l'altro ramo resta solo |
| `saldoRuoliChiusi()`, `Saldo` | diceva la stessa direzione dei ruoli chiusi in un'altra unità |
| `lottiAlMinimo()`, `AlMinimo` | la riga di dettaglio che lo mostrava non c'è più |
| `rigaStatsPlus()`, `RigaStatsPlus`, `MAX_CARATTERI_RIGA` | i tre badge prendono il suo posto |
| `Avvisi` (componente) | niente più avvisi da disegnare |
| `tests/stats-plus-riga.test.ts` | misurava il budget di 45 caratteri di una riga che non esiste |

| Entra | Cos'è |
|---|---|
| `temperaturaPerRuolo()`, `TemperaturePerRuolo`, `TEMPERATURE_VUOTE` | i quattro ruoli e il totale |
| `temperaturaRecente()`, `FINESTRA_RECENTE` | la coda del ruolo |
| `pmaAsta()` | il PMA corretto, in un posto solo |
| `BadgePma`, `TabellaTemperature` | i due pezzi di UI |

⚠ **`Temperatura` cambia forma**, non nome: da `{ n, min, mediana, max }` a
`{ n, pagato, atteso, rapporto }`.

---

## §6 — I task

- [x] I test nuovi scritti **prima**, e visti fallire per la ragione giusta (13 rossi su funzioni
      mancanti, non su refusi)
- [x] `temperatura()` aggregata, `temperaturaPerRuolo()`, `temperaturaRecente()`, `pmaAsta()`,
      `TEMPERATURE_VUOTE`
- [x] Fuori `scatto`, `avvisi`, `saldoRuoliChiusi`, `lottiAlMinimo` e i loro tipi
- [x] Test di I8 aggiornato alle funzioni nuove
- [x] `BadgePma` e `TabellaTemperature`, con i commenti sul perché delle scelte di forma
- [x] `bid-modal.tsx` e `portal.tsx` ricablati; `RigaStatsPlus` e i suoi test cancellati
- [x] Tutte e 12 le ombre via, con `border-primary` al posto dell'unica che serviva
- [x] Banco col CSS compilato: due difetti trovati e chiusi (§3.1)
- [x] Gate: `pnpm test` 1044/1044, `pnpm typecheck`, `pnpm build`
- [x] `docs/features/README.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`
- [x] **La prova a mano la fa l'owner in produzione** (sua decisione, 2026-09-02), ed è la stessa
      strada di M22 §9.2. ⚠ **In locale non era possibile e va detto perché**: `carmy_players` nel
      database di sviluppo è **vuota** (0 righe, verificato), quindi ogni schermata di Stats+ mostra
      «Serve un listone con i PMA» — lo stato che non esercita niente di nuovo. Ciò che *si poteva*
      verificare in locale è stato verificato: le classi Tailwind contro il CSS compilato da
      `pnpm build`, ed è lì che sono usciti i due difetti di §3.1
- [x] `CHANGELOG.md` datato e `package.json` a `1.23.0`, sulla `dev` prima del merge
