# CHANGELOG

Una sezione per versione, scritta al momento del merge su `main`. Le macro-feature sono un
minor, gli hotfix una patch. Il dettaglio di cosa doveva fare una feature sta nel suo file in
`docs/features/`; qui c'è solo cosa è cambiato per chi usa l'app.

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
