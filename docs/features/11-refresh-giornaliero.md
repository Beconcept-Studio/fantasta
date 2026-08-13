# M11 — Il refresh giornaliero degli insight

> **Stato:** **chiusa su `dev`, non rilasciata** · Aperta e chiusa il 2026-08-13 su
> `feature/11-refresh-giornaliero` · Pianificata il 2026-08-12 · **Dipende
> da M10**, e non per un componente: questa macro ha bisogno del pannello riorganizzato per avere un
> posto dove dire *«ho provato e non ci sono riuscito»*. Un automatismo senza quel posto è un
> automatismo muto, che è la cosa peggiore che possa essere (§4).
>
> **Tocca lo schema del database?** **Sì**, in modo additivo e piccolo: **una tabella nuova**
> (`source_runs`, due righe per sempre). Nessuna colonna sparisce → **niente `pg_dump` preventivo**, ma
> `pnpm db:push` sul server **va dato a mano dopo il deploy**:
>
> ```bash
> cd /home/ploi/fantasta.rggndr.it && pnpm db:push
> pm2 reload deploy/ecosystem.config.cjs --update-env
> ```
>
> **Nessun backfill.** La tabella nasce vuota e va bene così: «nessun tentativo registrato» è lo stato
> iniziale corretto, e il primo tick lo riempie da sé entro un quarto d'ora.
>
> **Invarianti coinvolti:** **nessuno**, e va detto per esteso perché è il motivo per cui questa macro
> è possibile: `player_insights` non entra in nessuna regola di gioco (M8 §3), non passa da
> `serializeSnapshot`, non ha un `auction_id`. **Regole coinvolte:** **1** (§6 — la regola «mai un
> timer che decide» va guardata in faccia, non aggirata), **4** (nessun lock, e M8 ha già scritto
> perché), 8. **E il divieto di stack** su scheduler e worker esterni: §2 spiega perché questo non ne
> è uno.
>
> ⚠ Si apre **su richiesta esplicita dell'owner**, come tutte.

## Obiettivo

Gli insight di M8 si aggiornano premendo due pulsanti in admin. Funziona, ed è il modo giusto di
cominciare — ma vuol dire che la freschezza dei dati dipende dal fatto che qualcuno si ricordi. La
sera dell'asta si ricorda. Il resto dell'anno no, e i numeri invecchiano senza dire niente: la pagina
mostrerà «Listone aggiornato: 12 agosto» per tre mesi, e nessuno lo interpreterà come un problema
perché è esattamente ciò che mostrava anche il giorno prima.

Questa macro chiede quei due dati **una volta al giorno, da sé**, dentro l'unico processo Node che c'è
— e, cosa più importante, rende **visibile il fallimento**: un automatismo che riesce non ha bisogno
di raccontarlo, uno che fallisce in silenzio è peggio di nessun automatismo.

Il tema, detto in una riga: *si aggiorna da sé, e quando non riesce lo dice.*

## Richieste che ci confluiscono

Tolta da `docs/REQUESTS.md` il 2026-08-12 insieme al resto della richiesta «Gestione listone e varie»,
di cui questa è **una frase**:

- **Gestione listone e varie**, la parte che riguarda questa macro: «Di default vorrei però che ci
  fosse un sistema che una volta al giorno chieda il listone aggiornato.»

⚠ **«Quale listone» è la domanda che ha diviso questa macro da M10, e la risposta è dell'owner**
(2026-08-12, opzione B): si aggiornano da sé **le due fonti pubbliche di M8** — il listone Fantalab e
la pagina dei rigoristi. Il listone **d'asta** (l'export Leghe in `.xlsx`) **resta un upload a mano**,
perché passa da un login: «l'export passa da un login, quindi non creiamo collegamenti». La
distinzione fra i due file è scritta per esteso in M10 §1 e non va rifatta a memoria.

---

## Spec

### 1. Cosa si aggiorna, e cosa no

| | Fonte | Automatica? |
|---|---|---|
| A | `GET https://api.fantalab.it/v2/listone` | **Sì.** Pubblica, nessuna auth, 1,16 s misurati |
| B | `GET https://www.fantacalcio.it/rigoristi-serie-a` | **Sì.** Pubblica, nessuna auth, 0,85 s misurati |
| — | Export Leghe `.xlsx` (il listone d'asta) | **No**, passa da un login (M10 §1) |
| — | Le caricature | **No.** Sono 50 MB e cambiano una volta l'anno, all'edizione nuova |

**Le due funzioni esistono già e non si riscrivono**: `refreshListoneInsights()` e `refreshSetPieces()`
in `lib/engine/insights.ts` accettano già `fetchImpl` e un orologio iniettabili, sono già in
transazione, già validano l'envelope, già fanno fallire l'import su schema diverso e sotto l'85% di
continuità. **Questa macro non aggiunge un import: aggiunge chi lo chiama.** Se durante il lavoro
qualcuno si trova a modificare la logica di import, è il segnale che sta risolvendo il problema
sbagliato.

**I due pulsanti restano.** Servono per la cosa che l'automatismo non fa: forzare un aggiornamento
adesso, la sera prima dell'asta, guardando il risultato.

### 2. Perché questo non è lo «scheduler esterno» che lo stack vieta

`CLAUDE.md` vieta di introdurre Redis, code, worker separati, provider realtime esterni e **servizi di
scheduling**. Questa macro non ne introduce nessuno: **nessun processo nuovo, nessun cron di sistema,
nessuna unità systemd, nessun servizio di terzi.** È un `setInterval` dentro il processo che c'è già,
e ha **due precedenti letterali in casa**:

- **Lo sweep dello scheduler** (`lib/engine/scheduler.ts`): un `setInterval` da un secondo che
  interroga il database e agisce.
- **Il tick dei bot** (`lib/engine/bots.ts`): un `setInterval` da un secondo, avviato da
  `instrumentation.ts`, che si ferma da sé quando c'è un'asta vera in corso.

Il singolo processo non è un caso: `exec_mode: "fork"` e `instances: 1` in
`deploy/ecosystem.config.cjs` esistono precisamente perché in cluster mode ogni copia eseguirebbe
`instrumentation.ts` — cioè due sweep sulla stessa asta. **Questa macro poggia su quella garanzia
esattamente come lo sweep**, e non ne aggiunge di nuove.

⚠ **Il singleton va su `globalThis`**, come gli altri due, e non in una variabile di modulo: Next
compila `instrumentation.ts` e i route handler in **bundle separati**, quindi dello stesso file
esistono due copie. È l'errore che ha già prodotto una volta «stream aperto e poi silenzio per tutta
l'asta».

### 3. Il tick: come si decide che è passato un giorno

⚠ **Non «ogni 24 ore da quando sono partito».** Il processo riparta a **ogni push su `main`**, e un
intervallo ancorato al boot, in una settimana di rilasci, non scatterebbe mai. Peggio: scatterebbe a
ore casuali e in numero imprevedibile.

**Il conto si fa sul database, non sul processo.** Un tick grossolano — **quindici minuti** — che a
ogni giro si chiede, per ciascuna delle due fonti: *quando ho provato l'ultima volta, e com'è andata?*

```text
ogni 15 minuti, per ciascuna fonte:
  c'è un'asta reale LIVE o PAUSED?        → non fare niente, riprova al prossimo giro
  l'ultimo tentativo è andato bene?       → riprova dopo 24 h
  l'ultimo tentativo è fallito?           → riprova con backoff: 1h, 2h, 4h, 8h, 16h, 24h (poi resta 24h)
  non c'è nessun tentativo registrato?    → prova adesso
```

**Tre conseguenze da capire prima di scrivere il codice.**

⚠ **La scadenza si conta dall'ultimo *tentativo*, non dall'ultimo *successo*.** È l'errore che
sembrerebbe naturale — «se `listone_updated_at` è vecchio di un giorno, aggiorna» — e produce una
**tempesta di richieste** verso un sito di terzi: una fonte giù per un giorno significa un tentativo
ogni quindici minuti, cioè novantasei richieste al giorno per non riuscire novantasei volte. Il
backoff esponenziale è una riga e vale un ordine di grandezza in educazione.

**Lo stato in tabella rende il riavvio innocuo.** Un deploy alle 04:59 non fa perdere il turno e non lo
fa scattare due volte: il primo processo che riparte legge la stessa riga di prima. È la stessa
proprietà che rende il `bootRecovery` dello scheduler affidabile — lo stato sta nel database, non nei
`setTimeout`.

**L'ora del giorno non è fissa, ed è una scelta.** Con questo schema il refresh scivola in avanti di
qualche minuto al giorno. Un'ora fissa vorrebbe dire aritmetica di fusi orari (**il server gira in
UTC**) e un ramo che gestisce «l'ora è già passata mentre eravamo spenti» — cioè tutto ciò che questo
schema non ha bisogno di avere. Un dato di mercato non ha un'ora.

### 4. La guardia sull'asta vera, e perché non è opzionale

Se esiste **un'asta reale** `LIVE` o `PAUSED`, il tick **non fa niente**. Non è prudenza generica:

- Sono due `fetch` da mezzo megabyte e un `upsert` di 497 righe in transazione, **nello stesso
  processo** che deve chiudere un round nel millisecondo giusto.
- Il precedente è letterale e va copiato, non reinventato: `runBotTick` esce subito con la stessa
  condizione (`isSimulated = false` e stato in `LIVE`/`PAUSED`), e la ragione scritta là è la stessa.
- Le **simulate non contano**: aspettano dei bot. È la stessa distinzione della guardia del deploy
  (`DECISIONS.md`, 2026-08-12).

⚠ **Un tick saltato per la guardia non è un tentativo fallito** e non deve toccare `source_runs`: se lo
scrivesse, una serata d'asta manderebbe la fonte in backoff per un guasto che non c'è stato.

### 5. Il silenzio è il guasto — la tabella e il pannello

Questa è la sezione per cui la macro dipende da M10. Con il pulsante, l'errore lo legge la persona che
l'ha premuto; automatico, `SOURCE_SCHEMA` finisce in `console.error` e nessuno lo vede mai.

```ts
export const sourceRuns = pgTable("source_runs", {
  /** `"listone_insights"` o `"set_pieces"`: due righe, per sempre. */
  source: text("source").primaryKey(),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull(),
  ok: boolean("ok").notNull(),
  /** Il messaggio del `Result`, così com'è. È già scritto per essere letto da un umano. */
  message: text("message"),
  /** Righe lette dalla fonte, quando è andata bene. */
  rows: integer("rows"),
  /** Quanti fallimenti di fila: decide il backoff (§3) **e** si mostra. */
  failures: integer("failures").notNull().default(0),
  /** `"auto"` o `"manual"`: due storie nello stesso posto sarebbero due verità. */
  trigger: text("trigger").notNull(),
});
```

**Due righe e un `upsert`**, non uno storico. Nessuno ha chiesto la cronologia dei tentativi, e la
domanda a cui il pannello deve rispondere è una sola: *l'ultimo tentativo è andato bene?* (regola 8 —
lo storico si aggiunge il giorno che qualcuno vuole leggerlo).

⚠ **Anche i due pulsanti scrivono qui**, con `trigger: "manual"`. Se scrivesse solo l'automatismo, il
pannello racconterebbe una storia e la realtà un'altra: premo il pulsante, riesce, e la pagina continua
a dire «ultimo tentativo automatico fallito ieri».

**Nel pannello** (la sezione Listone di M10, accanto ai due timestamp): per ciascuna fonte, com'è
andato l'ultimo tentativo, quando, e — se è fallito — **da quante volte** e con quale messaggio. Un
fallimento in corso non è una riga di dettaglio: è la cosa più importante di quella pagina, e va
scritta come tale.

⚠ **Il limite di questo disegno, dichiarato invece di essere scoperto:** l'allarme funziona solo se
qualcuno apre il pannello. Non manda email, e non è una dimenticanza — una notifica che arriva ogni
giorno per un dato di mercato è una notifica che si impara a cancellare senza leggere. Due cose
rendono il limite accettabile: i dati **non si corrompono** (§7), quindi il costo del ritardo è
sapere numeri vecchi e non numeri falsi; e il pannello lo si apre comunque prima di un'asta. Se un
giorno non basterà, l'SMTP di M5 c'è e sarà una macro di tre righe.

### 6. La regola 1 guardata in faccia

«**Mai un timer che decide.**» La regola dice che il client renderizza i countdown ma non cambia mai
stato, e che la chiusura di un round avviene solo lato server: parla della **macchina a stati
dell'asta**.

Questo timer **non decide niente di un'asta**. Non chiama `transition`, non prende
`withAuctionLock`, non tocca `auctions`, `lots`, `bids`, `assignments`, `ledger`, non incrementa
`state_version` e non fa nessun broadcast. Decide una cosa sola: *se è il momento di chiedere a un
sito web se ha numeri nuovi.* Il confine è lo stesso che M8 ha già tracciato per non prendere il lock
(`player_insights` è globale e non entra in nessuna regola di gioco), e vale la pena scriverlo in
`DECISIONS.md` perché la prossima volta che qualcuno vorrà «un timer per…» la domanda sia già posta:
**tocca lo stato dell'asta? Allora no.**

### 7. Cosa succede se una fonte cambia forma mentre nessuno guarda

Merito di M8, e va riletto perché è la ragione per cui questo automatismo è sicuro:

- La scrittura è **in transazione**: una fonte che risponde a metà non lascia la tabella a metà.
- L'envelope è **validato** (`count === players.length`, `season`), e uno schema diverso è un rifiuto
  tipizzato, non un `null` scritto in 497 righe.
- La **continuità all'85%** rifiuta una lista che ha in comune con la precedente meno del 85% degli
  identificativi: se la fonte cambia gli id, non si scrive niente.

**Quindi il caso peggiore automatico è: i dati restano quelli di ieri, e la tabella `source_runs` dice
perché.** Nessuna riga corrotta, nessun dato a metà. Il rischio che questa macro aggiunge non è sui
dati, è sull'**attenzione** — ed è per questo che §5 esiste.

⚠ **Un caso da non trattare come fallimento:** la fonte B rifiuta se `player_insights` è vuota
(«prima va importato il listone»). In produzione, il giorno del deploy, quella condizione è normale.
Il tick **salta B** quando la tabella è vuota, invece di registrare un fallimento e mandarla in
backoff per un ordine di operazioni che si sistemerà da sé al primo giro utile.

### 8. Il perimetro — cosa questa macro non fa

- **Non modifica** `refreshListoneInsights` né `refreshSetPieces`: aggiunge chi le chiama (§1).
- **Non tocca** il motore, la macchina a stati, il lock, lo scheduler, il tick dei bot,
  `serializeSnapshot`, `player_insights` (nemmeno una colonna).
- **Non introduce** processi, cron, code, worker, Redis, provider esterni (§2).
- **Non scarica** le caricature né il listone d'asta (§1).
- **Non manda email** e non aggiunge notifiche (§5).
- **Non tiene uno storico** dei tentativi: due righe (§5).
- **Non aggiunge un'ora configurabile** né un pulsante «disattiva l'automatismo»: un interruttore che
  nessuno ha chiesto è uno stato in più da spiegare. Se serve fermarlo, si ferma il processo — e in
  quel caso è ferma anche l'asta, quindi la domanda non si pone.
- **Non aggiunge eccezioni all'allowlist ESLint**: il loop sta in `lib/engine/`, e `instrumentation.ts`
  lo importa dentro il ramo `nodejs` come gli altri due.

---

## Task

> Da rifinire all'apertura della macro. Sono la traduzione della spec, non un impegno preso nella
> sessione in cui è stata scritta.

- [x] **M11-01** — Aprire `feature/11-refresh-giornaliero` da `dev`; rileggere questo file, e in
      particolare §3 (la scadenza contata dai **tentativi**, non dai successi) e §4 (la guardia). Sono
      le due cose che, sbagliate, non si vedono in locale e si vedono su un sito di terzi
      → Fatto. **Le due cose erano davvero le due cose**, e la seconda si è rivelata più insidiosa
      della prima: contare dai tentativi è una riga scritta una volta, ma «un tick saltato non è un
      tentativo» sono **due** rami distinti nel codice — la guardia e il salto della fonte B — e
      sbagliarne uno solo basta a far mentire il pannello.
- [x] **M11-02** — `lib/db/schema.ts`: `source_runs` come in §5. `pnpm db:push` in locale
      → Fatto, identica a §5 tranne due `$type<>()` sulle colonne `source` e `trigger`: sono due unioni
      di stringhe, e senza il tipo il codice avrebbe scritto `"listone-insights"` con un trattino senza
      che niente si lamentasse. `pnpm db:push` in locale ha creato la tabella e nient'altro.
- [x] **M11-03** — La decisione di quando provare, come **funzione pura** in un file che non importa
      `lib/db`: `(riga di source_runs | null, now) → provare o no`. È il pezzo che va provato in
      millisecondi, ed è dove vive il backoff — la stessa linea che `setup-rules.ts` e `rules.ts`
      tracciano fra ciò che si prova senza database e ciò che no. Test puro: mai provato → sì; riuscito
      23 h fa → no; riuscito 25 h fa → sì; fallito una volta 30 min fa → no; fallito una volta 90 min
      fa → sì; fallito sei volte 20 h fa → no
      → Fatto in `lib/engine/refresh-rules.ts`, i sei casi passano. ⚠ **Un settimo test ha corretto un
      numero della spec**: il conto «una fonte giù per un giorno costa N richieste invece di 96» dà
      **cinque**, non sei — t0, +1h, +3h, +7h, +15h, e il sesto tentativo cade a +31h, cioè fuori dalla
      giornata. La spec non aveva scritto il numero, ma la prima stesura del test sì, ed era sbagliata.
- [x] **M11-04** — `lib/engine/insight-refresh.ts` (o dove starà il loop): il tick da 15 minuti, la
      guardia sull'asta reale con **la stessa condizione di `runBotTick`**, la sequenza A→B, il salto
      di B a tabella vuota, la scrittura di `source_runs`. Tutto sotto `.catch()`: un errore qui non
      deve poter fermare il processo che sta conducendo un'asta
      → Fatto, e la guardia non è «la stessa condizione»: è **la stessa funzione**,
      `realAuctionRunning()` importata da `bots.ts` — il secondo chiamante è arrivato e la regola 8 dice
      di riusarla, non di ricopiarla. Due cose non previste dalla spec: il tick è diviso in
      `runRefreshTick` (guardia) e `refreshDueSources` (lavoro), **copiando il taglio di `runBotTick` /
      `tickAuction`**, perché la guardia è una domanda globale e un test che pretendesse l'assenza di
      aste reali sarebbe rosso a seconda di cosa fa un altro file; e `failures` si incrementa in SQL
      (`case when excluded.ok then 0 else source_runs.failures + 1 end`) invece che leggendo e
      riscrivendo, che avrebbe lasciato una finestra fra le due.
- [x] **M11-05** — `instrumentation.ts`: l'avvio, dentro il ramo `nodejs`, **con il singleton su
      `globalThis`** accanto a `__scheduler` e `__botLoop`
      → Fatto: `g.__insightRefresh`. La guardia `if (g.__scheduler) return` già in cima copre tutti e
      tre, e `tests/instrumentation.test.ts` ha adesso un caso che lo verifica sul terzo loop.
- [x] **M11-06** — I due pulsanti di M8 scrivono `source_runs` con `trigger: "manual"` (§5)
      → Fatto, con una riga sola per azione, **prima** del `return` di fallimento. ⚠ Una decisione che
      la spec non copriva: il pulsante dei rigoristi registra anche il rifiuto «prima va importato il
      listone», che il tick automatico invece **salta**. Non è un'incoerenza — è chi ha fatto la
      domanda: il tick incontra quella condizione da solo il giorno del deploy, qui l'ha chiesto una
      persona, e il pulsante è pure spento a tabella vuota.
- [x] **M11-07** — Il pannello (sezione Listone di M10): esito, quando, `failures` e messaggio per
      ciascuna fonte. Un fallimento in corso è **la cosa più visibile della pagina**
      → Fatto, nella forma scelta dall'owner guardando tre alternative (2026-08-13): **avviso rosso in
      cima che compare solo in caso di guasto** + **riga di stato accanto a ciascun pulsante, sempre
      presente**. I quattro timestamp in fondo restano dov'erano. ⚠ La spec diceva «un posto»; servivano
      **due**, perché «c'è qualcosa che non va?» e «quando si è aggiornato, da sé o a mano?» si leggono
      in due momenti diversi. Le frasi le scrive un modulo puro, `lib/source-status.ts`, perché i due
      consumatori stanno in due mondi — l'avviso è un componente server, la riga vive in un
      `"use client"` — e le stesse parole scritte due volte divergono al primo ritocco.
- [x] **M11-08** — Test con Postgres: un tick con una fonte finta scrive `source_runs` e i dati; un
      tick con la fonte che risponde male **non scrive i dati**, scrive il fallimento e incrementa
      `failures`; **un tick con un'asta reale `LIVE` non fa niente e non tocca `source_runs`**; una
      simulata `LIVE` non lo ferma; due tick di fila fanno **un solo** tentativo; B viene saltata a
      `player_insights` vuota **senza** registrare un fallimento
      → Fatto, tutti dentro `tests/db/insights.test.ts`, che adesso dichiara in testa di possedere
      **due** tabelle globali: `player_insights` e `source_runs`. Era la trappola di M10B, e M11 ci
      andava addosso due volte.
      ⚠ **Un caso è rimasto fuori, e non per dimenticanza: «una simulata `LIVE` non lo ferma».** Non è
      verificabile in un test parallelo senza flakiness — sarebbe rosso ogni volta che un altro file ha
      un'asta vera accesa nello stesso istante, ed è precisamente la ragione per cui
      `tests/db/bots.test.ts` prova `runBotTick` **solo** nella direzione robusta. Il verso «la
      simulata non conta» vive in `realAuctionRunning()`, che è condivisa, e si è provato in locale
      (M11-09) sul database di sviluppo, che ha due simulate in pausa: il tick ha lavorato.
      In compenso sono nati due test che la spec non chiedeva: le frasi del pannello in
      `tests/source-status.test.ts` (è lì che vive la verifica 7) e la guardia sul terzo loop in
      `tests/instrumentation.test.ts`.
- [x] **M11-09** — Prova in locale con le **fonti vere**, guardando il payload e non lo schermo (è il
      metodo con cui M8 ha chiuso): il primo tick importa, il secondo non fa niente, e il pannello dice
      la verità in ora italiana
      → Fatto, sulle fonti vere: **497 righe** da `api.fantalab.it` e **92 designati** da
      `fantacalcio.it` al primo tick; il secondo, subito dopo, ha restituito
      `skipped: [not-due, not-due]` senza sfiorare la rete; `nextAttemptAt` a ventiquattr'ore esatte.
      La guardia interrogata con le due simulate in pausa a database ha risposto `standBy: false`, che è
      la verifica 4. Il pannello si è guardato su una pagina di prova temporanea con i quattro stati
      affiancati, poi cancellata: ⚠ **e ha fatto il suo lavoro**, perché due frasi erano sbagliate e
      non si vedeva dal codice — una maiuscola dopo i due punti («Titolarità e rigori storici: L'ultimo
      aggiornamento è fallito») e una data isolata che si leggeva come una frase interrotta
      («Aggiornato da sé: 497 righe dalla fonte. Il 13 ago 2026, 06:12.»).
- [x] **M11-10** — Gate: `pnpm test`, `pnpm typecheck`, `pnpm build` verdi (⚠ build con `pnpm dev`
      spento). ⚠ E un controllo che i test non fanno: **`lsof -nP -iTCP -sTCP:LISTEN | grep node`** —
      con due processi dell'app accesi ci sono **due loop**, e il conto dei tentativi non tornerebbe
      → Verde: **777 test** su 47 file, typecheck e build. `lsof` ha mostrato **un solo** processo in
      ascolto sulla 3000. ⚠ E il controllo ha fatto emergere una cosa da sapere in locale che non
      riguarda i due processi: **con `pnpm dev` acceso il loop c'è**, quindi `player_insights` si
      riempie da sola entro un quarto d'ora dall'avvio — e se `pnpm test` gira mentre scatta un tick,
      i test degli insight possono trovare righe che non hanno scritto loro. È una finestra di due
      secondi ogni quindici minuti, ed è scritta in `HOWTO-PROVA-LOCALE` §8.
- [x] **M11-11** — `docs/ARCHITECTURE.md`: il capitolo su cosa gira da sé dentro il processo (sweep,
      bot, refresh: tre loop, tre ragioni, una sola garanzia — un processo). `docs/DECISIONS.md`: la
      scadenza dai tentativi con la tempesta che evita, il backoff, la guardia sull'asta reale, i due
      pulsanti che scrivono la stessa riga, **la regola 1 e perché questo timer non la viola**, e
      l'email decisa di no
      → Fatto: «I tre loop: cosa gira da sé, dentro il processo» in `ARCHITECTURE.md`, più il diagramma
      del processo aggiornato a tre righe e una postilla in «Cosa non c'è ancora» — perché da questa
      macro **una cosa in questa applicazione si guasta senza che nessuno sia nella stanza**, e la
      frase «nessun monitoraggio automatico» aveva bisogno di un'eccezione. Le sei voci in
      `DECISIONS.md`, più una settima sulla forma scelta dall'owner. E `HOWTO-PROVA-LOCALE` §8: come si
      prova un loop da quindici minuti senza aspettarne quindici (si mente sulla data a database, non
      si riavvia il processo — riavviarlo non accelera niente, perché il tick non parte al boot).
- [ ] **M11-12** — Chiusura: merge `--no-ff` su `dev`, prova in locale, poi — **solo su richiesta
      esplicita** — `CHANGELOG.md`, `package.json`, merge su `main`, tag `v1.12.0`, push. **Il
      `CHANGELOG.md` deve contenere il `pnpm db:push`** scritto per esteso
      → Merge su `dev` fatto. Il rilascio aspetta la richiesta esplicita dell'owner. ⚠ **Verificato che
      non c'è nessun file da caricare a mano**: `source_runs` nasce vuota, «nessun tentativo
      registrato» è lo stato iniziale corretto, e il primo tick la riempie entro un quarto d'ora — è il
      primo rilascio da quattro senza un passo a mano oltre al `db:push`.

## Verifica

1. `pnpm test`, `pnpm typecheck` e `pnpm build` verdi.
2. ⚠ **Con una fonte che risponde male, il tick non riprova prima di un'ora.** È la verifica che
   protegge un sito di terzi da novantasei richieste al giorno, ed è l'errore che questa spec ha
   corretto prima di essere scritta (§3).
3. **Con un'asta reale `LIVE`, il tick non fa niente** — e `source_runs` non viene toccata, così la
   serata non manda nessuna fonte in backoff.
4. **Con un'asta simulata `LIVE`, il tick lavora**: le simulate non fermano niente.
5. **Due tick consecutivi fanno un solo tentativo**, e un riavvio del processo non ne fa scattare un
   altro: lo stato è a database.
6. **Una fonte che cambia forma non lascia niente a metà**: i dati restano quelli di prima e il
   pannello dice perché (§7).
7. **Il pannello distingue un successo automatico da uno manuale** e, dopo tre fallimenti, dice «da
   tre volte» invece di «fallito».
8. **A `player_insights` vuota la fonte B viene saltata**, non registrata come fallita.
9. **Un'asta si gioca durante tutto questo**: una simulazione a 8 arriva a `COMPLETED` con il loop
   acceso, e i tempi dei round non cambiano.

---

## Com'è andata

Non cosa è stato fatto — quello sta nei task. Cosa **la spec aveva sbagliato**, che è l'unica parte
che serve a chi scriverà la prossima.

**⚠ «Un posto dove dire che non ci sono riuscito» erano due posti.** È l'errore più utile di questa
spec, e nasce da una formulazione che sembrava precisa: §5 diceva «nel pannello, accanto ai due
timestamp: per ciascuna fonte, com'è andato l'ultimo tentativo, quando, e — se è fallito — da quante
volte e con quale messaggio», e poi «un fallimento in corso non è una riga di dettaglio: è la cosa più
importante di quella pagina». **Le due frasi chiedono due cose diverse e la spec non se n'era
accorta**, perché rispondono a due domande che si fanno in due momenti diversi: «c'è qualcosa che non
va?» si legge *entrando* nella pagina, e vuole qualcosa in cima che di solito non c'è; «quando si è
aggiornato, da sé o a mano?» si legge *guardando il pulsante*, e vuole qualcosa che c'è sempre.
Provando a farne un posto solo si otteneva o un avviso permanente — che si smette di leggere, e il
giorno che serve non lo si vede — o un guasto a metà pagina. La forma finale l'ha scelta l'owner
guardando tre alternative, ed è quella con due posti.

**⚠ Un numero della spec era sbagliato, e l'ha corretto un test.** «Novantasei richieste al giorno» era
giusto; il conto complementare — quante ne costa il backoff — no. Ne costa **cinque** in ventiquattro
ore, non sei: t0, +1h, +3h, +7h, +15h, e il sesto tentativo cade a +31h, cioè il giorno dopo. Il test
è nato dando per buona la sesta e si è visto rosso subito. È lo stesso genere di riga della lezione di
M10B — *se una colonna si scarta, si scarta con una misura* — declinata al contrario: **se una spec
scrive un numero, quel numero è un test, non una frase.**

**⚠ «La stessa condizione di `runBotTick`» era la richiesta sbagliata: serviva la stessa funzione.** Il
task M11-04 chiedeva di copiare la condizione della guardia. Copiarla avrebbe voluto dire due
definizioni di «si sta giocando» a due chilometri l'una dall'altra, che divergono la prima volta che
qualcuno aggiunge uno stato. `realAuctionRunning()` era già esportata: il secondo chiamante è arrivato,
e la regola 8 dice di riusarla. Vale come promemoria sul modo di scrivere un task: «copia il
precedente» è quasi sempre un modo impreciso di dire «riusa il precedente».

**⚠ E il precedente da copiare per davvero era un altro, ed era nei test.** La spec non l'aveva visto:
il taglio `runBotTick` / `tickAuction` esiste perché la guardia è una domanda **globale** — «esiste
un'asta reale su questa macchina?» — e i file di test girano in worker paralleli su un database
condiviso. Senza quel taglio, metà dei test di M11-08 sarebbero stati rossi a seconda di cosa stava
facendo `tests/db/bots.test.ts` nello stesso istante. La conseguenza è dichiarata invece che aggirata:
**un caso della lista di M11-08 non è automatizzabile** — «una simulata `LIVE` non lo ferma» — e si è
provato in locale, sul database di sviluppo che ha due simulate in pausa.

**La trappola annunciata era annunciata bene, e non è costata niente.** Il briefing diceva che M11 ci
andava addosso due volte — `source_runs` nuova, e il tick che scrive `player_insights`, già posseduta
da `tests/db/insights.test.ts` — e la cura era decisa prima di scrivere una riga: tutti i test con
Postgres dentro il file che possiede già quella tabella, che adesso dichiara di possederne **due**.
Zero rossi, zero diagnosi. È il primo caso in cui una lezione di `DECISIONS.md` ha pagato in
prevenzione invece che in cura, e vale la pena notarlo: la regola era scritta in una forma azionabile
(«una tabella globale, un file che la possiede») e non come racconto di un incidente.

**Due previsioni della spec sono state confermate, e vale dirlo.** La prima: i due pulsanti che
scrivono la stessa riga *servivano* — è il caso in cui il pannello avrebbe mentito nel modo più
fastidioso, dicendo «fallito ieri» dopo un aggiornamento riuscito adesso. La seconda: la promessa di
M10 di lasciare il pulsante degli insight **sempre attivo** era giusta, e non c'è stato niente da
smontare.

**Quello che non è cambiato, e che era il punto.** `refreshListoneInsights` e `refreshSetPieces` non
hanno **una riga** di differenza: `git diff` su `lib/engine/insights.ts` è vuoto. La macro ha aggiunto
chi le chiama, come §1 chiedeva, e il fatto che quel file non compaia nel diff è il modo migliore di
misurare se il perimetro ha tenuto.
