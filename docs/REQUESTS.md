### Lotto - Momento dell'assegnazione
Dobbiamo cambiare la UI quando il giocatore viene assegnato.
Al momento la UI da l'impressione sia ancora attiva l'asta, mentre in realtà è un momento di stand by. Devo differenziare le due UI
Voglio costruire una card che si differenzi in stile per mostrare in modo chiaro che il lotto è concluso.
Crea una card con:
- nome giocatore (e squadra dove gioca)
- valore d'acquisto
- chi ha vinto l'asta
- offerte fatte per quel giocatore (con evidenziata l'offerta vincente)
- progress bar che mostra tra quanto scade quel momento: non usare una progress, ma utilizza un sistema che indica tra quando inizia la prossima asta (così l'utente capisce che si tratta di una schermata di visualizzazione e non deve fare nulla).


### Lotto live - Offerte arrivate
Mentre il lotto è live, nonn voglio mostrare chi ha consegnato un'offerta. Fino a che non scade il timer non voglio mostrare agli altri utenti chi sta offrendo.

### Portale TV - Visualizzazione più compatta
Crea una UI più compatta, con testi più adatti ad un Macbook che a una TV. Se proprio devo migliorare la leggibilità farò zoom della schermata.

### Portale TV - Offerte arrivate
Togliere chi consegna la propria offerta, è fuorviante e può portare a fare strategie tra competitor. È lo stesso concetto del task "Lotto live - Offerte arrivate".

### Esportazione rose
Deve essere prodotto un unico file con le seguenti informazioni:
- nome_squadra,id_calciatore,crediti_spesi

### Navbar di navigazione
Inserimento di una navbar di navigazione per semplificare la navigazione degli utenti.
Cosa inserire:
- Logo: Per il momento scrivi il nome "Fantasta"
- Nome utente
- Bottone per il logout

Quando sono all'interno dell'asta vorrei avere anche una sotto navbar con le voci di menù che mi possono aiutare a navigare tra le sezioni disponibili.

### Miglioramento titoli pagine
Al momento quando navigo l'applicazione non è chiaro in che pagina sia.
Voglio ristrutturare la sezione dove vedo il nome dell'asta.
In quella posizione vorrei vedere il titolo della pagina, con un badge sopra che indica il nome dell'asta in cui sto agendo.

### Testing avanzato
Vorrei avere una sezione dove posso lanciare una simulazione di asta.
La simulazione deve essere gestita in questo modo: il giocatore che crea l'asta simulata partecipa, gli altri X sono bot.
Devo poter configurare l'asta come se fosse vera, semplicemente poi vanno utilizzati X utenti bot che partecipano all'asta. In questo modo ho sempre la possibilità di simulare tutte le dinamiche senza dover fare azioni lato server per lanciare seed e simulare aste.