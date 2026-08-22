# CHANGELOG

Una sezione per versione, scritta al momento del merge su `main`. Le macro-feature sono un
minor, gli hotfix una patch. Il dettaglio di cosa doveva fare una feature sta nel suo file in
`docs/features/`; qui c'è solo cosa è cambiato per chi usa l'app.

## [1.16.0] — 2026-08-22

**M16 — Chi offre tiene, e al massimo rilancia.** Due regole del gioco cambiano, e cambiano nella
stessa direzione: un'offerta è una decisione che si prende una volta.

**Nel modale d'offerta non c'è più niente che scriva una cifra al posto tuo.** Sotto al campo c'era
una fila di quattro pulsanti — `+5`, `+10`, `+25` e un `max` che ci scriveva dentro il tetto — e non
c'è più: restano `−1`, il campo, `+1`. In un'asta in cui la cifra è l'unica informazione che conta,
scegliere fra quattro incrementi tondi non è una comodità, è un modo di non decidere. I ~44 pixel
che quella riga occupava tornano al campo, che con la tastiera aperta è lo spazio che manca.

⚠ **Il `max` in alto a destra resta**, e non è una svista: quello non è un valore suggerito, è il
tetto che il server applica comunque a ogni offerta. Serve leggerlo *prima* di scrivere, non dopo
essersi visti rifiutare la busta.

**Il ritiro di un'offerta non esiste più.** Chi consegna una busta la tiene: può rilanciare fino alla
scadenza, non può più togliere. È sparito il pulsante «Ritira» dal modale, e con lui la riga sulla
card che diceva di esserti ritirato.

⚠ **Ed è sparito davvero, non solo dallo schermo.** Il server non sa più cosa sia un ritiro: chi
provasse a chiederglielo scavalcando l'interfaccia si sentirebbe rispondere che quell'azione non
esiste. È il motivo per cui questa versione tocca il motore dell'asta e non solo una pagina — una
regola del gioco che vive soltanto nel browser è una regola che, fra sei mesi, nessuno sa più se c'è.

**Le aste già giocate non cambiano di una riga.** Se in una serata passata qualcuno si era ritirato,
quel ritiro si vede ancora dov'era: barrato nell'apertura delle buste, e nello storico dei lotti col
suo orario. Non è stato riscritto niente del passato, ed è stato verificato invece che sperato.

**In TV si vede chi è collegato.** Ogni squadra del tabellone ha ora un pallino prima del nome:
**verde chi è collegato, rosso chi non lo è**. Serve alla domanda che in quella stanza si fa a voce
almeno una volta a serata — possiamo far partire il round, o manca qualcuno? Chi ha la pagina aperta
col telefono in tasca conta come collegato: in secondo piano non vuol dire andato via. Un telefono
che si scollega diventa rosso entro una quindicina di secondi, senza ricaricare niente.

⚠ Se si scollegassero **tutti insieme** i pallini resterebbero verdi, ed è un limite noto e accettato:
la presence si ricalcola quando qualcuno si fa vivo, e se non si fa vivo nessuno non c'è più nessuno
da mostrare.

**La voce «Lobby» sparisce dal menù mentre l'asta è in corso.** Ci portava a un rimbalzo: si entrava
in lobby e si veniva rispediti al portale un istante dopo. Un link che restituisce il punto di
partenza è peggio di un link che non c'è. Resta invece **quando l'asta è in pausa** — lì non rimbalza
nessuno, ed è la strada per andare a cambiare i tempi — e resta sempre **per chi organizza senza
giocare**, che dalla lobby vede la lista dei partecipanti e i loro pallini.

**Nessun passo a mano sul server**: nessuna colonna nuova, nessun dato da correggere, nessun file da
caricare. Il deploy basta, e quando dice «completato» ha finito davvero.

## [1.15.1] — 2026-08-18

**L'applicazione ha la sua icona.** Fino a questa versione nella linguetta del browser c'era ancora
quella che Next.js mette in un progetto appena creato — un quadratino anonimo, uguale a quello di
qualunque altra applicazione fatta con lo stesso strumento. Adesso c'è il cerchio blu, e si vede dove
serve: nella linguetta, nei preferiti, e sulla schermata home se aggiungi il sito dal telefono.

Non è un file solo ma tre, di misure diverse, perché a sedici pixel un'immagine grande ridotta dal
browser viene male: la linguetta prende una versione preparata apposta per quella misura, iOS ne prende
una senza trasparenza — altrimenti la riempirebbe di nero da sé, mettendo gli angoli neri attorno al
cerchio — e i browser moderni prendono quella grande.

⚠ **Se dopo il rilascio vedi ancora la vecchia icona**, non è il deploy che non è passato: le icone
sono la cosa che i browser tengono in cache più a lungo di tutto il resto, e a volte non basta
ricaricare la pagina. Un `Cmd+Shift+R`, o chiudere e riaprire la linguetta, la rimette a posto. Sulla
schermata home del telefono serve rimuovere e riaggiungere il collegamento.

**Nessun passo a mano sul server**: nessuna colonna nuova, nessun dato toccato. Il deploy basta.

## [1.15.0] — 2026-08-18

**M14 — Il cancello dei risultati: le buste non si aprono più da sole.** Fino a ieri, fra «il round è
chiuso» e «tutti sanno tutto» non c'era nessun istante: nello stesso momento in cui scadeva il tempo, il
vincitore era deciso, il prezzo pubblico e le buste di tutti comparivano su ogni telefono e sul
proiettore. Se qualcuno perdeva la connessione negli ultimi secondi — non per colpa sua — quando lo
diceva a voce era già tardi: non c'era niente da fermare, e l'unico rimedio era una correzione a mano
che lasciava comunque tutti a conoscenza di quanto ciascuno aveva offerto. In un'asta a busta chiusa fra
amici che si guardano in faccia, è l'informazione che decide i lotti successivi.

Adesso lì in mezzo c'è un istante, e appartiene a chi conduce.

**Cosa si vede.** Quando un round si chiude, per qualche secondo tutti — telefoni e TV — leggono «buste
da aprire» e un countdown, e **nessuno sa com'è finita**. Non solo le offerte restano coperte: restano
fermi anche i crediti, le rose e le squadre sul tabellone, perché fino a quel momento l'assegnazione
non è ancora avvenuta. Non c'è niente da cui indovinare chi ha vinto.

**Cosa può fare chi conduce**, dalla regia:

- **«Mostra risultati»** apre le buste subito, senza aspettare la scadenza. Se non premi nessuno, si
  aprono da sole allo scadere del tempo: il pulsante anticipa una scadenza che c'è comunque.
- **«Metti in pausa»** — che c'era già — congela il cancello: i risultati non escono finché non
  riprendi, e alla ripresa il countdown riparte dal tempo che restava.
- **«Annulla lotto»**, che compare **solo** ad asta in pausa dentro il cancello, butta via il lotto e
  lo fa rifare: il turno di chiamata torna a chi aveva chiamato e il giocatore torna disponibile per
  tutti. La conferma nomina il giocatore e la squadra, così si legge invece di cliccarla. È la cosa da
  usare quando qualcuno segnala un problema vero, e funziona **solo prima** che le buste si aprano: le
  offerte di quel lotto non diventano mai pubbliche, nemmeno nello storico, e restano registrate come
  verbale. Nel registro dell'asta compare una riga che dice cosa è stato annullato e chi aveva chiamato,
  senza nessun importo.

**Quanto dura lo decidi tu**, dalla configurazione dell'asta: c'è un campo nuovo fra i tempi, «Prima dei
risultati (s)». Come gli altri tempi si può cambiare anche ad asta iniziata, e vale dal lotto
successivo.

⚠ **Le aste che hai già create non cambiano comportamento.** Quel campo nasce a **0** su tutto ciò che
esisteva prima di questa versione, e `0` vuol dire «nessuna attesa»: i risultati escono appena il round
chiude, esattamente come prima. Il cancello si accende quando **tu** ci scrivi un numero. Le aste nuove
lo propongono già a 10 secondi.

**Due cose che il cancello non fa**, per non cercarle. Non riapre le offerte: chi era disconnesso durante
il round ha perso quel round, e il cancello serve a non svelare — non a rimediare. L'unico rimedio vero è
annullare il lotto e rifarlo. E non mette in pausa da sé per nessuna ragione: se nessuno preme e nessuno
segnala, i risultati escono. Il cancello sposta la decisione, non la sospende.

**Un caso resta istantaneo, di proposito**: quando l'unico che potrebbe offrire è chi ha chiamato — capita
a fine ruolo, quando gli altri hanno la casella piena — il lotto si chiude subito a 1 come prima. Lì non
c'è nessuna busta da proteggere, e mettere qualche secondo d'attesa su ognuno di quei lotti sarebbero
minuti persi in diretta.

⚠ **Questa versione richiede un passo a mano sul server** (una colonna nuova nel database), fatto al
momento del rilascio. Nessun dato è stato modificato.

## [1.14.0] — 2026-08-18

**M13 — La pagina utenti: una tabella che si legge, un pannello che modifica.** Admin → Utenti era una
tabella di otto colonne in cui quattro colonne contenevano un form: un campo per il nome col suo
«Salva», «Verifica a mano», «Rendi admin», «Dai insight». Scorreva in orizzontale su qualunque schermo,
perché ogni cella doveva contenere un comando invece di un dato. Il risultato è che la domanda che ci si
fa quasi sempre — *chi è questa persona, e le manca qualcosa per entrare?* — si rispondeva peggio di
quella che ci si fa quasi mai, cioè *cambiamo qualcosa a questa persona*.

Adesso le due domande hanno due posti.

**La tabella è un elenco**: indirizzo, nome, e tre `Sì`/`No` — email verificata, admin, pro — più un
pulsante «Vedi». Niente da compilare, e su un portatile non scorre più di lato. Un solo valore è scritto
in modo che si veda da lontano: **«Email verificata: No»**, che è l'unica riga della tabella su cui
qualcuno deve fare qualcosa — di solito è chi si è appena iscritto e non riesce a entrare, ed è anche il
motivo per cui la lista è ordinata dal più recente.

**In testa alla tabella c'è una ricerca**, per nome o per indirizzo. Filtra mentre si digita, tollera
accenti e maiuscole in tutte due le direzioni — chi cerca «rossi» trova «Rossì», e chi scrive «ROSSÌ»
trova anche gli indirizzi senza accento — e il conteggio in cima segue il filtro invece di continuare a
dire quante righe ci sono in tutto. Con zero risultati c'è una frase, non una tabella vuota che sembra
guasta. Il filtro «mostra anche i bot» è dov'era e funziona come prima: la ricerca lavora su ciò che
quel filtro ha lasciato.

**«Vedi» apre un pannello laterale con tutto dentro**, comprese le tre cose che se ne sono andate dalla
tabella — da quale porta entra quella persona, quante aste possiede e quante ne gioca, quando si è
iscritta — più una che non c'era mai stata: **quando** l'indirizzo è stato verificato, non solo se. Le
modifiche si fanno da qui, con degli interruttori, e si salvano in un colpo solo.

### Tre cose del pannello che conviene sapere prima di usarlo

**L'interruttore della verifica va in una direzione sola.** Una volta che l'indirizzo è dimostrato non
si torna indietro, e l'interruttore resta acceso e bloccato dicendolo: spegnerlo vorrebbe dire rispedire
una persona alla schermata del codice, cioè chiuderla fuori dall'applicazione con un click. Su una riga
senza indirizzo l'interruttore è spento e bloccato, perché non c'è niente da verificare.

**Sulla propria riga l'interruttore «Admin» non c'è**, e c'è scritto perché: se ti togli il permesso non
esiste un'altra porta da cui rientrare nel pannello — lo fa un altro amministratore. Quello «Pro» invece
c'è, perché non apre nessuna porta e un amministratore vede gli insight comunque. Su un bot non c'è
nessun interruttore: non ha un nome da correggere né un indirizzo da verificare.

**Il salvataggio può riuscire a metà, e te lo dice.** I quattro campi si scrivono uno per uno, quindi se
uno viene rifiutato — il caso realistico è un nome fuori dai 3–60 caratteri — gli altri sono comunque
salvati. In quel caso **il pannello resta aperto** con l'esito campo per campo, e l'avviso in basso dice
«Salvato solo in parte» nominando prima ciò che è passato. A pieno successo il pannello si chiude, la
tabella si aggiorna da sé e l'avviso dice cosa è stato salvato.

**Nessun potere nuovo.** Le cose modificabili sono le quattro che si modificavano già — nome, verifica
dell'indirizzo, admin, pro — e l'indirizzo email resta in sola lettura, per la ragione di sempre: da
quando si entra anche con una password è la chiave d'identità, e cambiarlo cambia *chi può entrare* in
quell'account. Niente cancellazione di un utente e nessun reset della password da parte di un
amministratore.

**Nessun passo a mano su questa versione.** Niente da caricare, nessuna modifica al database, nessuna
dipendenza nuova: il deploy finisce e la versione è completa.

## [1.13.0] — 2026-08-18

**M12 — Cancellare un'asta per forza, e dirlo a chi la stava guardando.** Fino a ieri un'asta iniziata
non si poteva togliere di mezzo in nessun modo. Non era una svista: non esiste un pulsante «termina
asta», a «conclusa» ci si arriva solo giocando fino in fondo, e la cancellazione era rifiutata a
tutti — anche a chi amministra, anche a chi l'aveva creata. Il risultato era che una **simulazione
lasciata in pausa** restava lì per sempre, e il 12 agosto una di queste ha bloccato un rilascio senza
che ci fosse un gesto, in nessuna schermata, capace di chiuderla.

Adesso **un amministratore può cancellare qualunque asta, in qualunque stato**, da Admin → Aste. Chi ha
creato l'asta no: a lui l'applicazione continua a dire che è in corso, e gli dice anche chi può
interromperla. Non è avarizia — la sua asta la stanno guardando altre undici persone, e chi la
interrompe è meglio che non sia uno che sta giocando.

### Chi era collegato non resta a fissare uno schermo fermo

È la metà più importante di questa versione, e riguarda un guasto che c'era già. Cancellando un'asta,
prima, chi la stava guardando **non veniva avvisato di niente**: la pagina restava ferma sull'ultimo
momento ricevuto, con il countdown congelato. Non sembrava rotta — sembrava **lenta**. In una stanza con
dieci persone, questo vuol dire dieci ricariche di pagina in trenta secondi e nessuna che funziona.

Adesso, nell'istante in cui l'asta viene cancellata:

- **chi stava giocando** si ritrova sulle sue aste, con scritto che quell'asta — per nome — è stata
  cancellata da un amministratore;
- **il tabellone in TV** si ferma dove è e lo dice a schermo pieno, perché lì non c'è nessuna
  dashboard dove andare e nessuno che possa fare login davanti a un proiettore;
- **nessuno dei due continua a tentare** di riattaccarsi a un'asta che non c'è più.

**Prima di cancellare un'asta in corso, l'avviso dice quante persone sono collegate in quel momento** —
«ci sono tre persone collegate: verranno riportate alla dashboard» — perché un avviso che nomina un
numero si legge, e uno che dice «questa azione è irreversibile» si clicca. Se non c'è nessuno, lo dice
anche quello. Resta il nome dell'asta da scrivere a mano per confermare: quello non è cambiato.

### ⚠ Quello che nessun pulsante può impedire, ed è la riga da rileggere

**Cancellare un'asta vera e conclusa si porta via il verbale delle rose e tutto il suo storico. Per
sempre.** Chi ha comprato chi, a quanto, in che ordine, le rettifiche, il registro dei lotti: tutto
quello che serve per raccontare com'è andata la serata. Non c'è un annulla, non c'è un cestino, non
c'è un export automatico che ti salvi prima. **L'unica copia che resta è il backup notturno**, e se la
cancellazione è di oggi il backup è di stanotte: manca la serata di oggi.

Quindi, prima di cancellare un'asta a cui tieni, si fa un backup a mano:

```bash
cd /home/ploi/fantasta.rggndr.it && ./deploy/db-backup.sh
```

Per le simulazioni — che sono il motivo per cui questa versione esiste — non serve niente: sono aste di
prova, e buttarle via è tutto ciò che si vuole fare.

**Nessun passo a mano su questa versione.** Niente da caricare, nessuna modifica al database: il deploy
finisce e la versione è completa. Era da sei rilasci che non succedeva, e questa riga c'è proprio perché
le cinque precedenti dicevano il contrario.

## [1.12.0] — 2026-08-13

**M11 — Il refresh giornaliero degli insight.** I numeri delle due fonti pubbliche si aggiornavano
premendo due pulsanti. Funzionava, e la sera dell'asta qualcuno se lo ricordava — il resto dell'anno
no, e i numeri invecchiavano **senza dire niente**: la pagina mostrava «aggiornato: 12 agosto» per tre
mesi, e nessuno lo leggeva come un problema, perché era esattamente ciò che mostrava anche il giorno
prima.

Adesso quei due aggiornamenti partono **da sé, una volta al giorno**. Sono le due fonti pubbliche: il
listone di `api.fantalab.it` (titolarità, minuti, rigori storici) e la pagina dei rigoristi di
`fantacalcio.it`. **I due pulsanti restano** e servono a quello che l'automatismo non fa: aggiornare
*adesso*, la sera prima dell'asta, guardando il risultato.

⚠ **Non si aggiornano da sé i due file che carichi tu** — il listone d'asta (l'export Leghe in
`.xlsx`) e il foglio di Carmy. Il primo passa da un login, il secondo lo compila una persona. Restano
due caricamenti a mano, e la data dell'ultimo resta scritta nel pannello.

**Non a un'ora fissa, e non è una svista.** Il conto si fa sull'ultimo *tentativo*, non sull'orologio,
quindi il refresh scivola in avanti di qualche minuto al giorno: un dato di mercato non ha un'ora. In
cambio un rilascio a mezzanotte non fa perdere il turno e non lo fa scattare due volte — lo stato sta
nel database, non nel processo.

### La parte che conta: quando **non** riesce, lo dice

Un automatismo che riesce non ha bisogno di raccontarlo. Uno che fallisce in silenzio è peggio di non
averlo affatto — ed è il motivo per cui metà di questa versione è un avviso.

**In cima ad Admin → Listone compare un blocco rosso, e solo quando c'è un guasto.** Dice quale fonte,
da quante volte, con quale messaggio, e — la parte che serve davvero — **che i dati a sistema sono
ancora quelli di prima e sono integri**: un import che fallisce non lascia righe a metà, mai. Il costo
di un guasto è sapere numeri vecchi, non numeri falsi.

Dopo il primo fallimento dice «non si è aggiornato». Dal secondo in poi dice «non si aggiorna da **tre**
volte», perché «fallito» è un incidente e un numero è un guasto che dura: sono due notizie diverse.

**Accanto a ciascuno dei due pulsanti c'è una riga che c'è sempre**, e dice quando si è aggiornato e se
è partito **da sé o a mano**. L'avviso in cima risponde a «c'è qualcosa che non va?», che si legge
entrando nella pagina; questa riga risponde a «quando si è aggiornato?», che si legge guardando il
pulsante. E che l'avviso in cima **non** ci sia quando tutto va bene è la sua unica proprietà
importante: un avviso che c'è sempre si smette di leggere, e il giorno che serve non lo si vede.

⚠ **Anche i due pulsanti scrivono lì.** Se scrivesse solo l'automatismo, il pannello avrebbe mentito
nel modo più fastidioso: premi il pulsante, l'aggiornamento riesce, e la pagina continua a dire «ultimo
tentativo fallito ieri».

**Non manda email**, e non è una dimenticanza: una notifica che arriva ogni giorno per un dato di
mercato è una notifica che si impara a cancellare senza leggere, e il giorno che conta viene cancellata
con le altre. Il limite è dichiarato — l'avviso lo vede chi apre il pannello — e regge perché i dati
non si corrompono e il pannello lo si apre comunque prima di un'asta.

### Due cose che non cambiano, e una che non si vede

**Durante un'asta vera non si aggiorna niente.** Se c'è un'asta reale in corso o in pausa, il refresh
sta fermo: due download e cinquecento righe in transazione non si fanno accanto a un round da chiudere.
È la stessa regola dei bot, e come per i bot le **simulazioni non contano**. Un giro saltato per questa
ragione non viene registrato come fallimento — altrimenti una serata d'asta manderebbe le fonti in
attesa lunga per un guasto che non c'è stato.

**Se una fonte è giù non viene tempestata di richieste.** Si riprova dopo un'ora, poi due, quattro,
otto, sedici, poi una volta al giorno: cinque richieste in una giornata di guasto invece di
novantasei. È una cortesia verso un sito che non è nostro, e costa una riga.

**E niente processi nuovi**: nessun cron, nessun servizio, nessun worker. È un intervallo dentro
l'unico processo Node che c'è già, il terzo accanto ai timer dell'asta e al tick dei bot.

### ⚠ Il rilascio non finisce col deploy: un passo a mano

**Lo schema, sul server**, dopo che il deploy è finito e con nessuna asta `LIVE` o `PAUSED`. Il cambio è
**additivo** — una tabella nuova con due righe, una per fonte — quindi **niente `pg_dump` preventivo**:

```bash
cd /home/ploi/fantasta.rggndr.it && pnpm db:push
pm2 reload deploy/ecosystem.config.cjs --update-env
```

**E questo è tutto: nessun file da caricare.** È il primo rilascio da quattro senza quel passo. La
tabella nasce **vuota**, ed è lo stato iniziale corretto — «nessun tentativo registrato» vuol dire
«prova adesso», e il primo giro la riempie da sé entro un quarto d'ora. ⚠ Se `pnpm db:push` non viene
dato, il refresh non parte e il pannello va in errore quando lo apri: è il passo che finisce il
rilascio, non un extra.

Vale ancora quello che valeva prima: il deploy **si rifiuta di partire** se in produzione c'è un'asta
**reale** `LIVE` o `PAUSED`, e in quel caso non tocca niente. Le aste **simulate** non lo bloccano: le
dice e tira avanti.

## [1.11.0] — 2026-08-12

**Due macro in un rilascio solo** (M10 e M10B), perché la seconda si appoggia alla tabella che
costruisce la prima: senza il listone a sistema, il foglio di Carmy non ha un elenco di nomi a cui
agganciarsi. ⚠ **I passi a mano stanno in fondo a questa sezione e sono tre**: uno è un comando sul
server, due sono file da caricare **in quest'ordine**. Finché non sono dati, niente si rompe e niente
si vede.

### M10 — Il listone a sistema

**Il listone si carica una volta e vale per tutte le aste.** Prima lo stesso `.xlsx` andava ricaricato
a ogni asta e per le figurine, in tre posti diversi. Adesso c'è **Admin → Listone**: si carica lì, e
da quel momento chi crea un'asta se lo trova **proposto**, con la data del caricamento accanto — un
tocco invece di cercare il file nei download.

⚠ **Le aste già preparate non cambiano.** Ognuna si porta dentro la **sua copia** delle righe,
congelata al momento in cui l'ha presa: le rose, i prezzi e le regole di quella serata sono appesi a
quelle. Caricare un listone nuovo non tocca un'asta esistente, mai.

**Le caricature sono diventate un pulsante.** «Scarica le caricature» prende gli identificativi dal
listone a sistema, quindi non c'è più nessun file da riallegare. È spento finché il listone non c'è, e
lo dice.

**E c'è il Centro dati** (Admin → Listone → Centro dati): tutto il listone in una tabella, con la
ricerca, il filtro per ruolo, il filtro «rigori e piazzati» e le intestazioni che ordinano. È il posto
da cui si controlla a vista se i dati sono arrivati davvero. Chi non ha un valore mostra `—` e va **in
fondo in entrambe le direzioni** dell'ordinamento: invertire una colonna non porta in cima trecento
trattini.

La pagina dice anche quanti giocatori del listone hanno una riga di insight, e quanti hanno i numeri
di quest'anno — cioè quelli che si vedono davvero. Resta un'informazione e **non** diventa una
guardia: un import bloccato da una soglia sarebbe un import che rifiuta dati buoni.

### M10B — Gli insight che vengono da un umano

**La titolarità si legge, non si deduce più.** Fino a ieri l'app rispondeva a «quanto gioca?» con le
partenze da titolare dell'anno scorso. Ma all'asta la domanda è **quanto giocherà quest'anno**, e
quella dipende da chi lo ha comprato, da che modulo gioca il suo allenatore nuovo, da chi gli è
arrivato davanti — cose che nessun numero dell'anno scorso contiene.

Adesso si carica un **foglio compilato a mano** (Admin → Listone, sotto il listone) con tre giudizi da
1 a 5 per ogni calciatore — titolarità, affidabilità, tenuta fisica — più una fascia, un prezzo
consigliato, la fantamedia attesa e delle etichette brevi: `rigorista`, `rischio infortuni`,
`subentrante`, `scommessa`. Da lì viene la titolarità dell'applicazione: **verde da 4 in su**.

⚠ **Il numero dell'anno scorso resta accanto, in grigio, e serve.** Un «Titolarissimo» da solo è
un'affermazione che nessuno può controllare; accanto a `3/38` diventa un'affermazione con la sua
prova — e **quando i due divergono, quella divergenza è l'informazione**. Un attaccante giudicato
titolare pieno che l'anno scorso ha giocato tre partite non è un errore del foglio: è una notizia.

**Nella lista di chiamata** — la schermata in cui si sceglie chi chiamare — ogni riga porta ora
titolarità, rapporto grezzo, minuti medi, rigori e piazzati, **fascia, fantamedia attesa, PMA e note**.
È la schermata più densa dell'app di proposito: è l'unica in cui si *confronta*, e l'informazione che
non c'è è un giocatore che non si considera. Sta su due righe perché otto voci in fila non si leggono.

**Nel modale d'offerta** ci sono le stesse macro più affidabilità, tenuta fisica e il **prezzo
consigliato** — messo fra gli altri giudizi e non accanto al campo, di proposito: una cifra suggerita a
due centimetri dalla cifra da digitare è un suggerimento che si segue senza pensarci.

**Sopra la lista, per chi ha il permesso, ci sono i filtri**: titolari da 4, titolari da 5, e le fasce.
⚠ E c'è una riga che dice **sempre** chi comprerebbe il timer allo scadere, filtro o no. Serve a questo:
la lista è ordinata come l'auto-pick, quindi il suo primo nome ha sempre voluto dire «quello che il
timer prenderebbe al posto tuo» — ma **un filtro non cambia chi il timer sceglie**, perché quello guarda
tutti i giocatori liberi. Con un filtro acceso quella riga diventa ambrata e lo dice a voce alta.

**Il Centro dati** guadagna fascia, fantamedia attesa, PMA, affidabilità, tenuta fisica e note, tutte
ordinabili, più il filtro per **tag**. Il prezzo consigliato in crediti non è fra le colonne: al suo
posto c'è il PMA, e la cifra in crediti si legge nel modale d'offerta.

**Il foglio invecchia in un giorno**, e il pannello lo dice: c'è la data dell'ultimo caricamento
accanto agli altri tre, e un avviso quando è più vecchia di ventiquattr'ore. Un caricamento
**sostituisce** il precedente per intero, così un giudizio ritirato sparisce davvero.

Se il foglio non aggancia almeno il 90% dei nomi, il caricamento **rifiuta e non scrive niente**: vuol
dire che il foglio e il listone parlano di due elenchi diversi, di solito perché il listone è vecchio.
I nomi che non agganciano vengono **elencati per nome** (di solito sono acquisti più recenti del
listone), e così le squadre che non corrispondono — quelli sono trasferimenti, e il giudizio si importa
comunque.

**Chi vede i giudizi**: chi ha il permesso «Insight», più gli amministratori. Come per i numeri di
v1.9.0, a chi non ce l'ha **non arrivano affatto**: non sono nascosti a schermo.

### ⚠ Il rilascio non finisce col deploy: tre passi a mano

**1. Lo schema, sul server.** Un solo comando copre entrambe le macro — i cambi sono additivi (una
tabella nuova per il listone, una per i giudizi, una colonna su quella degli insight), quindi **niente
`pg_dump` preventivo**:

```bash
cd /home/ploi/fantasta.rggndr.it && pnpm db:push
pm2 reload deploy/ecosystem.config.cjs --update-env
```

**2. Il listone, da Admin → Listone.** La tabella nasce vuota: finché è vuota, le caricature non si
scaricano, il Centro dati è vuoto e chi crea un'asta non trova nessuna proposta. Si carica l'export
**Leghe** in `.xlsx` — quello con la colonna `Fuori lista`.

**3. Il foglio di Carmy, sotto quello del listone.** ⚠ **In quest'ordine, e non è una preferenza**: il
foglio non ha identificativi e si aggancia al listone **per nome**, quindi senza il passo 2 il suo
pulsante è spento e lo dice. Finché non è caricato, la titolarità torna quella calcolata dalle presenze
e `/play` è identica a v1.10.0.

⚠ **Finché i passi 2 e 3 non sono dati, tutto funziona come prima e non si vede niente**: non si rompe
nulla, non c'è fretta, ma il rilascio non è finito. È lo stesso inciampo di v1.8.0 e v1.9.0, il quarto
di fila.

Vale ancora quello che valeva prima: il deploy **si rifiuta di partire** se in produzione c'è un'asta
**reale** `LIVE` o `PAUSED`, e in quel caso non tocca niente. Le aste **simulate** non lo bloccano: le
dice e tira avanti.

## [1.10.0] — 2026-08-12

**M9 — I badge degli insight, e la striscia verde via.** I numeri arrivati con v1.9.0 c'erano ma erano
vestiti di grigio: `Rigori 1°` e `Piazzati 2°` usavano due grigi che si distinguono a fatica, e la
titolarità non era nemmeno un badge. Sotto un countdown di dieci secondi, con un pollice sulla
tastiera, fra «leggibile» e «riconoscibile senza leggere» c'è tutta la differenza che conta.

Ora ogni fatto ha un colore. **Verde la titolarità dall'80% in su**, blu chi batte i rigori e chi batte
i calci piazzati, grigio tutto il resto. La percentuale e la posizione restano scritte **dentro** il
badge: il colore fa arrivare l'occhio, il numero decide — «secondo battitore» vale molto meno di
«primo», e un colore che sostituisse quel numero butterebbe via il dato per mostrarlo meglio.

La soglia del verde non è stata scelta a naso. Contata sul listone vero, dall'80% in su ci sono **61
giocatori su 497**: cinque o sei nomi in una lista di chiamata da quaranta — abbastanza raro da voler
dire qualcosa, abbastanza frequente da non sembrare un guasto. Al 70% sarebbe un nome su cinque, cioè
decorazione. Quel conteggio dice anche una cosa che nessuno aveva scritto: i verdi sono venticinque
difensori e **sei attaccanti**. Gli attaccanti ruotano, e adesso si vede.

**E la striscia verde in cima a ogni pagina non c'è più.** Compariva su tutte le schermate per tutta la
sera, per dire una cosa che chi è in quella stanza sa già: era più disturbante che utile. Chi chiude il
tab per sbaglio rientra dalla dashboard, dove le sue aste sono elencate — un tocco in più, in cambio
del silenzio in cima a ogni pagina. Chi apre la lobby di un'asta già iniziata continua a essere portato
al portale da sé, come prima: quella non dipendeva dalla striscia.

Chi si ricollega a metà lotto ritrova esattamente la schermata di prima, striscia o non striscia. Non è
cambiato niente lì: la striscia era il modo di *arrivare* alla pagina, non di ricostruirla.

Due cose che **non** sono entrate, e sono decisioni prese: nessun badge «Infortunato», perché lo stato
«si è rotto adesso» si popola a campionato in corso e l'asta si fa ad agosto — un badge rosso che non
compare mai la sera per cui esiste l'app è lavoro speso male, e uno costruito su una pagina letta tre
settimane prima sarebbe una bugia. E il badge dei calci piazzati si chiama **`Piazzati`** e non
«Punizioni»: la fonte mette punizioni e corner nella stessa lista, quindi il primo battitore di una
squadra può essere il suo uomo dei corner.

### Per chi aggiorna il server

**Niente.** Nessun cambio di schema, nessun `pnpm db:push`, nessun backfill, nessun passo a mano: il
deploy automatico basta e il rilascio finisce lì. È la prima volta da tre versioni che si può dire.

⚠ L'unica cosa che può fermare questo deploy è **un'asta reale `LIVE` o `PAUSED`** in produzione — la
guardia esiste per quello e va lasciata fare. Le simulate non lo bloccano più (v1.9.1).

## [1.9.1] — 2026-08-12

**Il deploy non si blocca più per un'asta simulata.** Fino a ieri la guardia che impedisce un rilascio
mentre si sta giocando contava **tutte** le aste in corso, comprese quelle di prova: una simulazione
lasciata in pausa bloccava ogni deploy successivo, e non c'era modo di chiuderla — un'asta in pausa non
si cancella, e a «completata» si arriva solo giocandola fino in fondo. L'unico rimedio era scavalcare
la guardia a ogni rilascio, che è il modo in cui una guardia smette di proteggere il giorno che serve
davvero.

Ora blocca solo le aste **reali**. Le simulate in corso vengono comunque stampate nell'output del
deploy, perché un rilascio che scavalca qualcosa in silenzio insegna a non leggere quello che scrive.

### Per chi aggiorna il server

**Niente**: nessun cambio di schema, nessun `pnpm db:push`, nessun passo a mano. Il deploy automatico
basta.

⚠ **Ma questo è l'ultimo deploy che può ancora bloccarsi.** La guardia viene eseguita *prima* che il
codice nuovo venga scaricato, quindi quella che decide è la copia già presente sul server — cioè
ancora la vecchia. Se in produzione c'è una simulazione in pausa, questo rilascio va forzato una volta
sola:

```bash
cd /home/ploi/fantasta.rggndr.it
DEPLOY_DURING_AUCTION=1 ./deploy/deploy.sh
```

Dal deploy dopo, il problema non si presenta più.

## [1.9.0] — 2026-08-12

**M8 — Insight sul listone.** `fvm` dice quanto **costa** un giocatore, non se gioca. Da questa
versione l'applicazione risponde anche alle altre domande che si fanno davvero a un'asta: **parte
titolare? tira i rigori? batte i calci piazzati?** Prima si rispondeva con un telefono in mano e
un'altra app aperta, che in dieci secondi di countdown vuol dire non rispondere.

Si vede in **due posti**, entrambi sul percorso di chi gioca. Nella **lista di chiamata** ogni nome ha
una riga in più: la percentuale di partite da titolare, i minuti medi quando era in campo, e i badge
`Rigori 1°` / `Piazzati 2°` per chi è designato. Nel **modale d'offerta**, mentre si decide quanto
mettere, ci sono solo le tre macro — quanto è titolare, e se batte — perché lì ogni riga in più ruba
spazio al campo dell'importo con la tastiera aperta.

**I dati arrivano da due fonti pubbliche**, che il server interroga da sé: nessun file da caricare,
nessuna password da custodire. Da **Admin → Listone** ci sono due pulsanti — il primo scarica
titolarità, minuti e rigori storici, il secondo i rigoristi e i battitori di piazzati — e in tutto ci
vogliono **due secondi**. Il pannello dice quando è stata aggiornata ciascuna delle due fonti, e
**quanti giocatori del tuo listone sono agganciati**: sul listone vero sono 487 su 495, e gli otto che
mancano sono elencati per nome. Non arriverà mai a 495: i due elenchi non coincidono, ed è normale.

**Non li vedono tutti.** È una scelta, non un limite tecnico: il permesso si dà dalla lista utenti,
colonna «Insight». Chi non ce l'ha vede l'applicazione esattamente come prima — e i dati **non
arrivano nemmeno nel suo browser**, non sono nascosti a schermo. Chi amministra li vede sempre.

**Due dettagli che sembrano difetti e non lo sono.** Circa un terzo dei giocatori mostra `—` invece
dei numeri: sono quelli per cui la fonte ha solo i dati della stagione **precedente**, e mescolarli con
quelli di quest'anno sarebbe un confronto falso. E `—` non è `0`: un giocatore senza storico e uno che
non è mai partito titolare sono due cose diverse, e all'asta si pagano in modo diverso.

**Se una fonte cambia forma, l'aggiornamento si rifiuta e lo dice**, invece di riempire la tabella di
righe vuote. Vale anche se la lista che arriva non somiglia più a quella di prima: in quel caso non
viene scritto niente e i dati di ieri restano al loro posto.

### Per chi aggiorna il server

⚠ **Questa volta il deploy automatico non basta, e ci sono tre passi.** I primi due sono
obbligatori — senza il primo l'applicazione **non parte**, perché il database non ha le colonne nuove.

**1. Lo schema del database cambia** (in modo additivo: una tabella nuova e una colonna, niente
sparisce e nessun tipo cambia, quindi **non serve un backup preventivo**). Dopo che il deploy
automatico è finito, sul server, **con nessuna asta `LIVE` o `PAUSED`**:

```bash
cd /home/ploi/fantasta.rggndr.it
pnpm db:push
pm2 reload deploy/ecosystem.config.cjs --update-env
```

**2. La tabella nasce vuota.** Da **Admin → Listone**, si premono i due pulsanti **in quest'ordine**:
prima «Importa il listone», poi «Aggiorna i designati» — il secondo aggiorna righe che nascono dal
primo, e su una tabella vuota rifiuta dicendolo. La pagina dice quanti giocatori ci sono: finché dice
`0`, nessuno vede niente. Sono due secondi, e si può ripremere quante volte si vuole.

**3. Il permesso nasce spento per tutti.** Da **Admin → Utenti**, colonna «Insight», pulsante «Dai
insight» su chi lo deve avere. Prima di quel momento la feature è invisibile a tutti tranne agli
amministratori — che la vedono per costruzione, così chi importa i dati può controllare che siano
arrivati.

⚠ Finché i passi 2 e 3 non sono fatti, **tutto funziona come prima e non si vede niente**: non si
rompe nulla, non c'è fretta, ma il rilascio non è finito. È lo stesso inciampo delle figurine di
v1.8.0.

Vale ancora quello che valeva prima: il deploy **si rifiuta di partire** se in produzione c'è un'asta
`LIVE` o `PAUSED`, e in quel caso non tocca niente.

## [1.8.0] — 2026-08-11

**M7 — Le caricature dei calciatori.** Quando un giocatore viene chiamato all'asta, adesso si vede la
sua **figurina**: la caricatura di Fantacalcio.it dentro la carta con lo scudetto e il ruolo. È la
risposta alla domanda che la stanza fa a voce alta — «chi è?» — e si legge a colpo d'occhio.

Si vede in **tre posti**, tutti sul percorso di chi gioca: nella card del lotto sul telefono, accanto
al nome; nel **modale d'offerta**, mentre si decide quanto mettere; e sulla **TV**, grande, che è lo
schermo per cui quelle carte sono state disegnate. In regia no: lì il lotto è una riga di testo, e chi
conduce ha la TV nella stessa stanza.

**Le immagini si scaricano una volta sola**, da **Admin → Figurine**: si carica il listone di
riferimento (il `.xlsx` di Fantacalcio.it) e si preme il pulsante. Su un listone intero sono ~500
immagini in pochi secondi. Si può premere quante volte si vuole: scarica solo quello che manca, e la
seconda volta non scarica niente. Il file caricato non viene conservato.

**Circa un giocatore su tre non ha una caricatura** e riceve una sagoma senza volto con la maglia del
suo club: è così sul sito di Fantacalcio.it, e si mostra come le altre. Non è un difetto
dell'applicazione, ed è voluto che ci sia — se le sagome venissero saltate, un lotto su tre avrebbe un
riquadro più corto e il pulsante d'offerta si sposterebbe sotto il pollice.

**Nel modale d'offerta il campo dell'importo parte già attivo**, con la tastiera aperta e il valore
selezionato: se sei già dentro con 31, digiti e sovrascrivi. Prima bisognava toccarlo.

### Per chi aggiorna il server

**Lo schema del database non cambia**: nessun `pnpm db:push`, nessuna riga di `psql`. Ma questa volta,
a differenza di v1.7.0, **il deploy automatico non basta**: restano due passi a mano, e finché non
sono fatti l'applicazione funziona esattamente come prima — semplicemente non si vede nessuna
figurina. Non si rompe niente, non c'è fretta, ma non è finito.

**1. La variabile nuova nel `.env`.** L'edizione delle figurine è la stagione, ed è l'unica parte
dell'indirizzo che invecchia. Sul server, in `/home/ploi/fantasta.rggndr.it/.env`:

```bash
CAMPIONCINI_EDITION="21"
```

Poi, obbligatoriamente, il ricarico che rilegge il file — **non** `pm2 restart asta`, che riparte con
l'ambiente vecchio:

```bash
cd /home/ploi/fantasta.rggndr.it
pm2 reload deploy/ecosystem.config.cjs --update-env
```

Si può anche saltare: il codice ha `21` come default, ed è il valore giusto per la stagione in corso.
Va messa perché **ad agosto prossimo andrà cambiata**, e quel giorno è più facile modificare una riga
che esiste che scoprire che va aggiunta. Se un giorno l'edizione fosse sbagliata te ne accorgi subito:
non si scarica nessuna figurina.

**2. L'archivio va riempito, e nasce vuoto.** Da **Admin → Figurine**, si carica il listone e si preme
il pulsante. La pagina dice quante ce ne sono: finché dice `0`, nessuno vedrà nessuna figurina. Le
immagini finiscono in `/home/ploi/fantasta.rggndr.it/storage/campioncini/` (~53 MB) e **sopravvivono
ai deploy successivi e anche a un ritorno a una versione precedente**: questa operazione si fa una
volta per stagione, non a ogni rilascio.

Vale ancora quello che valeva prima: il deploy **si rifiuta di partire** se in produzione c'è un'asta
`LIVE` o `PAUSED`, e in quel caso non tocca niente.

## [1.7.0] — 2026-08-11

**M6 — Amministrazione.** Chi amministra l'applicazione ha un pannello: il pulsante **«Admin»** in
navbar porta a `/admin`, con la lista di tutti gli utenti e quella di tutte le aste. Gli altri non
vedono il pulsante e, se scrivono l'indirizzo a mano, tornano in dashboard.

**Sugli utenti si può fare tre cose.** Correggere un nome scritto male — l'«asdf» digitato di fretta
nell'onboarding. **Verificare a mano un indirizzo email**, che è la novità che conta: fino a ieri, se a
un amico il codice non arrivava, l'unico rimedio era una riga di SQL sul server, e adesso è un
pulsante. E dare o togliere il permesso di amministratore — **mai sul proprio account**, perché un
click e ci si chiude fuori tutti.

L'indirizzo email **non si modifica**, e non è una dimenticanza: da v1.6.0 è la chiave con cui si
entra, quindi cambiarlo vuol dire cambiare chi può entrare in quell'account. Un indirizzo sbagliato si
risolve rifacendo l'account.

**Sulle aste si può fare una cosa sola: cancellarle**, anche quelle di qualcun altro, digitandone il
nome per conferma. Niente pausa, niente avvio, niente correzioni: quella è la regia, e resta di chi ha
creato l'asta. Le aste in corso o in pausa non si cancellano nemmeno da qui.

La lista aste mostra nome, chi l'ha creata con la sua email, stato, posti, membri e date — e
**nient'altro**: non i lotti, non le offerte, non le rose. Un'asta si guarda da dove si guardano le
aste, e il pannello dà il link.

Il pannello è pensato **per un portatile**, non per il telefono: tabelle dense e sidebar laterale. Dal
telefono si offre, e quella parte resta com'era.

### Per chi aggiorna il server

**Niente.** Questa versione non cambia lo schema del database: nessun `pnpm db:push`, nessuna riga di
`psql`, nessuna variabile nuova nel `.env`. Il deploy automatico basta e si conclude da sé.

Una sola cosa da sapere, che valeva anche prima: il deploy **si rifiuta di partire** se in produzione
c'è un'asta `LIVE` o `PAUSED`, e in quel caso non tocca niente — si toglie di mezzo l'asta e si
rilancia `./deploy/deploy.sh`.

E se il pulsante «Admin» non compare a chi dovrebbe vederlo, manca il permesso sull'account, non il
deploy: `UPDATE users SET is_admin = true WHERE email = '…'`. Da questa versione è l'ultima volta che
serve — il secondo amministratore lo si nomina dal pannello.

## [1.6.0] — 2026-08-10

**M5 — Identità.** Ci si può registrare con email e password, non solo con Google. Chi non ha un
account Google — o non vuole collegarlo qui — adesso entra, e la sera dell'asta non resta in piedi
accanto alla TV a guardare gli altri giocare.

### ⚠ Per chi aggiorna il server

Questa versione **cambia lo schema del database**, e a differenza delle altre **non basta
`pnpm db:push`**: serve anche una riga di `psql`, senza la quale al primo caricamento *tutti* gli
utenti che c'erano già finiscono davanti alla schermata del codice, chi amministra compreso.

**Prima** del push, per sapere se il nuovo vincolo di unicità passa (se questa query restituisce
righe, il push fallisce e vanno sistemate prima):

```sql
SELECT lower(email), count(*) FROM users
WHERE email IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
```

**Dopo** il deploy, con nessuna asta in corso:

```bash
cd /home/ploi/fantasta.rggndr.it && pnpm db:push
psql -c "UPDATE users SET email_verified_at = created_at
         WHERE google_sub IS NOT NULL AND email_verified_at IS NULL"
pm2 reload deploy/ecosystem.config.cjs --update-env
```

Servono inoltre **cinque variabili nuove nel `.env`** — `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, `MAIL_FROM` — senza le quali l'applicazione parte lo stesso e il login con Google
continua a funzionare, ma i codici di verifica non partono. `pnpm mail:check` dice in trenta secondi
se le credenziali sono giuste, senza spedire niente.

Nessuna colonna sparisce e nessun tipo cambia, quindi il backup preventivo non è obbligatorio — ma
questa versione tocca il login, che è l'unica cosa che se si rompe chiude fuori tutti:
`deploy/db-backup.sh` costa trenta secondi.

### Aggiunto

- **La registrazione con email e password.** Si sceglie un indirizzo e una password di almeno dieci
  caratteri — nessuna regola su maiuscole o simboli, la lunghezza conta di più — e arriva un codice
  a sei cifre da inserire nella schermata successiva. Il nome e cognome si scrivono dopo, dove si
  sono sempre scritti.
- **La conferma dell'indirizzo.** Finché il codice non è stato inserito non si fa nulla: non si
  creano aste, non si entra su invito, non si gioca. Il codice vale quindici minuti, si può
  sbagliare cinque volte, e in ogni schermata di rifiuto c'è il pulsante per farsene mandare un
  altro — quello nuovo annulla il precedente.
- **«Password dimenticata».** Stesso meccanismo: si chiede l'indirizzo, arriva un codice, si sceglie
  la password nuova. È anche l'unico modo di *cambiare* la propria password.
- **Le due strade portano allo stesso account.** Chi si è registrato con email e password e poi
  entra con Google usando lo stesso indirizzo ritrova le sue aste: non nasce un secondo utente.

### Da sapere

- ⚠ **Se entri con Google su un indirizzo registrato con una password mai confermata, quella
  password smette di funzionare.** Sembra severo ed è deliberato: è ciò che impedisce a un
  estraneo di registrare il tuo indirizzo con una password sua e ritrovarsela valida sul tuo
  account il giorno in cui entri da Google. Se la password l'avevi messa tu, la rimetti da
  «Password dimenticata». Se invece l'indirizzo era già confermato, non cambia nulla e restano
  valide entrambe le strade.
- **Un account nato da Google entra da Google.** Su quell'indirizzo la registrazione con password
  viene rifiutata, e «Password dimenticata» risponde che si entra con Google.
- **Un account Google senza indirizzo email verificato non entra**, e lo dice.
- **Cambiare la password non chiude le sessioni aperte altrove**: chi era già dentro su un altro
  dispositivo ci resta.
- **Troppi tentativi di accesso falliti sullo stesso indirizzo bloccano per un quarto d'ora**, e un
  accesso riuscito azzera il conteggio.

## [1.5.0] — 2026-08-10

**M4 — Simulazione in-app.** Un'asta di prova si lancia dall'applicazione, con dei partecipanti
finti che giocano davvero. Prima serviva accendere il database, lanciare un seed da riga di
comando, copiare l'id dell'asta e far partire uno script in un terminale a parte.

### ⚠ Per chi aggiorna il server

Questa versione **cambia lo schema del database**. Dopo che il deploy è finito, e con nessuna asta
in corso, va dato a mano sul server:

```bash
cd /home/ploi/fantasta.rggndr.it && pnpm db:push
pm2 reload deploy/ecosystem.config.cjs --update-env
```

Il cambio è additivo — tre colonne nuove con un valore di default, niente che sparisce — quindi non
serve un backup preventivo e i dati esistenti non vengono toccati.

### Aggiunto

- **L'asta simulata.** Alla creazione compare una casella «Asta simulata»: l'asta che ne nasce è
  identica a una vera — stessa configurazione, stesso listone, stessa lobby, stessa regia, stessa
  TV — e in più si può riempire di partecipanti finti. La casella si decide **una volta sola**: non
  si può trasformare un'asta vera in una di prova, né il contrario.
- **I partecipanti simulati**, nel pannello accanto agli inviti: si sceglie quanti bot aggiungere ai
  posti liberi e come offrono — un misto verosimile, tutti al massimo, tutti al minimo, o tutti
  sulla stessa cifra, che è il modo di far scattare uno spareggio a comando. I bot giocano dal
  server, quindi risultano collegati da soli e l'asta si avvia senza aspettare nessuno.
- **Il badge «simulazione»**, in elenco aste, in cima a ogni schermata dell'asta e sulla TV. Con due
  schede aperte, le due aste si distinguono senza guardare l'indirizzo.
- **La cancellazione di un'asta**, in fondo alla configurazione, per chi l'ha creata. Per confermare
  si scrive il nome dell'asta: un pulsante si clicca per riflesso, un nome no.
- **L'amministratore dell'applicazione**, che non è chi possiede un'asta: è un permesso a parte, e
  per ora serve solo a creare aste simulate e a riempirle di bot. Chi ce l'ha gioca le aste come
  tutti gli altri.

### Da sapere

- **Mentre è in corso un'asta vera, i bot di ogni simulazione si fermano.** Non è un guasto: è la
  regola che tiene i partecipanti finti lontani dalla serata che conta. La configurazione della
  simulazione lo scrive, e i bot ripartono da soli quando l'asta vera è finita.
- **Nella simulazione le buste restano chiuse anche per i bot.** Giocandoci contro non si viene
  battuti di un credito ogni volta: vedono quello che vede un telefono, cioè la propria offerta e
  nient'altro.
- **Cancellare un'asta porta via tutto quello che le appartiene** — rose, storico, buste,
  rettifiche — e non si torna indietro. Un'asta in corso o in pausa non si può cancellare.

## [1.4.0] — 2026-08-10

**M3 — Tracciabilità.** Una macro sola, e risponde a due domande: cosa è successo durante l'asta, e
come lo dimostro se qualcuno non è d'accordo.

### Aggiunto

- **Lo storico dell'asta**, nuova voce «Storico» nel menù dell'asta, per chi l'ha creata **e** per
  chi ci gioca. In alto tutti i lotti conclusi, dal più recente: una riga per lotto che si apre sul
  dettaglio delle buste — ogni round col suo minimo, quanti potevano offrire, ogni offerta con la
  cifra e l'ora in cui è stata fissata, le offerte ritirate, e com'è finito il round. Sotto, le
  pause e le correzioni: chi ha messo in pausa e quando, cosa è stato assegnato a mano, cosa
  annullato, quali crediti sono stati rettificati e con che motivo. Prima tutto questo esisteva solo
  nel database, e per leggerlo bisognava aprirlo.
- **Un campo di ricerca sopra i lotti**: si scrive il nome di un giocatore, una squadra o un numero
  di lotto e l'elenco si restringe mentre digiti. In una disputa la domanda è sempre un nome.
- **L'esportazione delle rose in `.csv`**, dalla regia, accanto a quella che c'era già: tre colonne
  — nome squadra, id del calciatore, crediti spesi — e soltanto i giocatori assegnati.

### Cambiato

- **In regia i download sono due, con etichette che dicono a cosa servono**: «Listone per
  Fantacalcio.it (.xlsx)», che è il file di prima e serve a ricaricare le rose là dove si gioca, e
  «Rose (.csv)», il verbale da leggere. Il primo si scarica ora come `<asta>-listone.xlsx`: si
  chiamava `<asta>-rose.xlsx`, che con un vero export delle rose accanto sarebbe stato fuorviante.
- **Un nome squadra non può più contenere virgole né virgolette.** Lo richiede il formato del nuovo
  file, che per restare leggibile a occhio non usa virgolette. Il vincolo vale per chi entra da qui
  in avanti; i nomi già salvati restano come sono, e nel file il carattere diventa uno spazio.

### Da sapere

- **Le buste di un lotto ancora in corso non compaiono nello storico**, per nessuno — né per chi
  conduce, né per chi sta offrendo su quel lotto, né ad asta in pausa. Compaiono nel momento in cui
  le buste si aprono, e da quel momento restano leggibili per sempre: è la risposta al caso in cui i
  secondi delle buste aperte siano passati mentre guardavi altrove, o sia stato premuto «Prosegui
  asta».
- **I lotti annullati non spariscono dallo storico**: restano, marcati «annullato», e l'annullamento
  con la sua riassegnazione si leggono fra le correzioni. Uno storico che nasconde le correzioni non
  serve a chiudere una discussione.
- Il `.csv` usa la virgola come separatore. Aperto con un doppio clic su un Excel in italiano finisce
  in una sola colonna, perché l'italiano si aspetta il punto e virgola: va importato dalla procedura
  guidata, oppure aperto con un editor di testo.

## [1.3.1] — 2026-08-10

### Aggiunto

- **La versione dell'applicazione nella navbar**, accanto al pulsante per uscire. Serve a un
  controllo a vista: si apre il sito e si sa quale codice sta rispondendo, senza dover credere al
  momento in cui il deploy dichiara di aver finito. Il numero è quello con cui l'applicazione è
  stata compilata, e si legge anche dalla pagina di accesso — che è il posto in cui si guarda
  quando l'app non fa entrare e si vuole capire se il rilascio è passato.

## [1.3.0] — 2026-08-10

**M2 — Navigazione e identità delle pagine.** Una macro sola, e riguarda il muoversi dentro l'app.

### Aggiunto

- **Una navbar su ogni pagina**: il nome dell'app, che riporta alla lista delle aste, il tuo nome e
  il pulsante per uscire. Prima l'uscita esisteva solo nella lista delle aste.
- **Dentro un'asta, un menù delle sezioni.** Configurazione, Lobby, Regia, Asta live e il link alla
  vista TV: ognuno vede le voci che gli competono, e sono sempre le stesse dall'inizio alla fine
  della serata. Prima ogni pagina aveva i propri link, diversi dagli altri, e in due punti la voce
  «Pannello di configurazione» portava alla lobby — motivo per cui la configurazione dei tempi ad
  asta iniziata sembrava irraggiungibile.

### Cambiato

- **Il titolo di ogni pagina dice adesso la pagina**, con il nome dell'asta in un'etichetta sopra.
  Prima il titolo era il nome dell'asta: tre schermate diverse si presentavano tutte allo stesso
  modo, e l'unica informazione che mancava era dove ti trovavi.
- **La vista TV è diventata un tabellone di recap.** Tre quarti dello schermo sono tutte le squadre
  con la rosa completa, i prezzi pagati e i crediti residui; gli slot ancora da riempire restano
  disegnati, così si vede a colpo d'occhio chi è indietro. Il quarto rimanente è il lotto in corso.
  Al momento delle buste aperte la squadra che ha vinto si accende nel tabellone, col giocatore
  appena preso in evidenza dentro la sua rosa. Prima la pagina era tarata per essere letta da
  quattro metri su un televisore, e su un portatile spendeva metà schermo per un countdown che ogni
  partecipante ha già in mano.
- **Il portale del partecipante si chiama «Asta live»**, che dice cosa ci trovi invece di come si
  chiama. L'indirizzo della pagina non è cambiato: i link già aperti continuano a funzionare.
- Nell'intestazione della vista TV, al posto del totale speso e dell'ordine dei ruoli, c'è lo
  **stato dell'asta** — in corso o in pausa. È la risposta alla domanda di chi alza gli occhi e
  trova tutti i numeri immobili.

### Corretto

- **Il richiamo «Asta in corso» non compare più sopra la vista TV.** Se chi proiettava era anche
  loggato nello stesso browser, quella striscia verde si incollava in cima allo schermo condiviso e
  invitava tutta la stanza ad andare al suo portale.

## [1.2.0] — 2026-08-10

Due macro in un rilascio: **M1** era ferma su `dev` da ieri e non è mai arrivata in produzione.

### Aggiunto

- **La busta resta chiusa fino alla fine** (M1). Durante un lotto non si vede più **chi** ha
  consegnato la propria offerta: niente pallino sul telefono, niente riquadro acceso sulla TV,
  niente contatore «4/7» nella console della regia. Gli importi erano già protetti; chi si è
  mosso e chi non si è mosso era l'ultima informazione che permetteva di fare strategia
  guardandosi in faccia.
- **Una card per il lotto assegnato** (M1). Quando le buste si aprono la schermata cambia faccia:
  superficie spenta, nessuna barra che scorre, e in grande non il tempo che scappa ma il prezzo
  pagato. Sotto, il giocatore, chi l'ha vinto e **tutte** le offerte di tutti i round con la
  vincente in evidenza; in fondo, quanto manca alla ripresa. Prima era un pannello dentro la
  stessa card che un attimo prima chiedeva di offrire, e per tre secondi non si capiva che il
  lotto era finito.
- **«Prosegui asta».** Quando le buste sono aperte, chi gestisce l'asta trova un pulsante — nel
  proprio portale e nella console di regia — che chiude subito la rivelazione e passa al lotto
  successivo, senza aspettare i secondi configurati. I secondi restano: chi non tocca niente vede
  l'asta comportarsi come prima. Il pulsante è solo dell'owner, e solo mentre le buste sono
  aperte: ad asta in pausa non compare.

### Corretto

- **I tempi dell'asta non si riuscivano a salvare ad asta iniziata.** La pagina prometteva che i
  timer restassero modificabili, ma ogni salvataggio veniva rifiutato con «si possono cambiare
  solo i timer» — anche quando era proprio un timer a essere cambiato. Il form rimandava il nome
  dell'asta invariato e il server lo scambiava per una modifica strutturale.
- **Dalla lobby non si riusciva a raggiungere la configurazione ad asta in pausa**: si veniva
  rispediti al proprio portale. Ora in pausa si resta dove si è, e alla ripresa si viene
  riaccompagnati al portale da soli.

### Cambiato

- Nella configurazione, ad asta iniziata, il nome dell'asta è disabilitato come posti, crediti e
  slot: era l'unico campo che sembrava modificabile pur non essendolo.
- L'avviso «ad asta iniziata si possono cambiare solo i timer, che valgono dal lotto successivo»
  è sempre visibile sopra le impostazioni, invece di comparire in rosso dopo aver premuto Salva.
- Il seed di sviluppo fa entrare l'owner **per ultimo**, così il suo posto è quello che i bot
  lasciano libero con `--count=7`: si prova l'asta dal vivo restando l'owner, con la regia e il
  portale nello stesso browser. Non tocca l'applicazione.

## [1.1.0] — 2026-08-09

### Cambiato

- Lo sviluppo non procede più per fasi ma per macro-feature, su tre branch (`main` produzione,
  `dev` integrazione, `feature/NN-nome`). Nessun cambiamento nell'applicazione: `CLAUDE.md` e
  `docs/ARCHITECTURE.md` sono stati riscritti di conseguenza, `docs/PLAN.md` e `docs/BACKLOG.md`
  sono diventati archivio di v1.0.0.

### Rimosso

- `docs/RUNBOOK.md`. Le tre procedure che il flusso di sviluppo richiede — applicare lo schema
  dopo un deploy, tornare indietro a un tag, deployare a mano — sono passate in `CLAUDE.md`. Il
  resto resta leggibile con `git show v1.0.0:docs/RUNBOOK.md`.

## [1.0.0] — 2026-08-09

La prima versione in produzione su <https://fantasta.rggndr.it>, con le fasi 0–8 del piano
chiuse e 327 test verdi.

### Aggiunto

- Asta a busta chiusa completa: setup, listone, rotazione dei turni, chiamata, offerte segrete,
  spareggi, assegnazione e chiusura.
- Portale partecipante mobile-first, portale manager e vista TV.
- Override del manager: pausa, `voidAssignment`, `manualAssign`, rettifiche a `ledger`.
- Persistenza su Postgres, snapshot via SSE, boot recovery dopo un riavvio.
- Deploy su Hetzner con pm2 e nginx, backup `pg_dump` giornaliero con retention 14.
