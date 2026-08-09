### Portale TV - Visualizzazione più compatta
Crea una UI più compatta, con testi più adatti ad un Macbook che a una TV. Se proprio devo migliorare la leggibilità farò zoom della schermata.

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

### Log asta
Per ogni asta nella lobby ci deve essere la possibilità di trovare una pagina con i log dell'asta e di ogni lotto.
In questo modo in caso di disputa è possibile vedere lo storico senza accedere al database.