# CHANGELOG

Una sezione per versione, scritta al momento del merge su `main`. Le macro-feature sono un
minor, gli hotfix una patch. Il dettaglio di cosa doveva fare una feature sta nel suo file in
`docs/features/`; qui c'è solo cosa è cambiato per chi usa l'app.

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
