# Le macro-feature

Dopo v1.0.0 lo sviluppo non procede più per fasi. Procede per **macro-feature**: un tema
coerente, un branch, un merge su `main`, un minor. Una alla volta, e solo su richiesta esplicita.

Ogni macro ha un file qui dentro che contiene **spec e task insieme**: obiettivo, quali richieste
di `docs/REQUESTS.md` ci confluiscono, se tocca lo schema del database, quali invarianti di
`docs/PLAN.md` sono coinvolti, la spec, i task con checkbox e i criteri di verifica.

Quando una macro viene pianificata, le richieste che ci confluiscono **spariscono da
`docs/REQUESTS.md`**: il quaderno contiene solo ciò che non è ancora stato pianificato.

## In corso

**M13 — la pagina utenti** ([13-utenti-admin.md](13-utenti-admin.md)), aperta il **2026-08-18** su
richiesta dell'owner e lavorata per intero su `feature/13-utenti-admin`: gate verde con **813 test**,
typecheck e build, poi merge `--no-ff` su `dev`. La tabella del pannello è diventata sei colonne in sola
lettura con una ricerca in testa, e le modifiche stanno in un pannello laterale che si apre da «Vedi».
Non tocca lo schema, non tocca il motore, non tocca nessuna asta: **nessun `pnpm db:push`, nessun
backfill, nessun passo a mano sul server.**

Resta da fare **la prova in locale davanti alla pagina, anche su uno schermo stretto**: è l'unica cosa
che questa macro può rompere senza che nessun test se ne accorga (M13-11). Poi il rilascio, che parte
**solo su richiesta esplicita**: `CHANGELOG.md`, `package.json`, merge su `main`, tag `v1.14.0`.

⚠ **La misura che la spec chiedeva è stata fatta, e ha confermato la scelta invece di ereditarla**: 20
utenti veri in produzione, 32 contando i bot. «Niente paginazione» regge, e la ricerca resta un filtro
lato client su righe già arrivate. Il giorno in cui quel numero cresce, ricerca lato server e
paginazione arrivano **insieme** (M13 §4) — separate, la prima diventerebbe una bugia.

⚠ **Quattro Server Action sono rimaste in piedi senza nessun chiamante**: le tre per campo di M6 più
`setUserProAction` di M8. La spec dice che M13 «ne aggiunge una», non che ne toglie quattro, e ognuna ha
la sua guardia e il suo test — ma sono la prima cosa da guardare il giorno in cui si vuole togliere del
codice morto dal pannello, ricordando che l'elenco esatto di `tests/db/admin.test.ts` va aggiornato
anche in quella direzione.

**M12 è in produzione da `v1.13.0`** (2026-08-18): chiusa su `dev` il 17, provata a due
dispositivi il 18, rilasciata subito dopo. Gate verde con **791 test**, typecheck e build.

⚠ **È il primo rilascio da sei senza nessun passo a mano sul server**: nessun `pnpm db:push`, nessun
backfill, nessun file da caricare. Verificato invece di darlo per scontato — `git diff` non tocca
`lib/db/schema.ts`, e le cascate verso `auctions` esistono per intero dal 2026-08-07. Se un giorno una
cancellazione sembrasse incompleta in produzione, **non è un passo dimenticato** il sospetto da
coltivare per primo.

⚠ **E c'è una cosa che nessun pulsante può impedire**, scritta nel `CHANGELOG.md` di `v1.13.0` perché è
l'unico posto che qualcuno rileggerà: cancellare un'asta **reale** `COMPLETED` si porta via il verbale
delle rose e tutto lo storico di M3, **per sempre**. Prima si dà `deploy/db-backup.sh`.

**M11 è in produzione da `v1.12.0`** (2026-08-13), aperta e chiusa nella stessa
giornata: gate verde con **777 test**, typecheck e build.

⚠ **Il suo rilascio porta un `pnpm db:push`** — `source_runs`, additiva, due righe per sempre — e
**nessun file da caricare a mano**: è il primo rilascio da quattro che non ne ha, e la cosa è stata
verificata invece di darla per scontata. La tabella nasce vuota, «nessun tentativo registrato» è lo
stato iniziale corretto, e il primo tick la riempie da sé entro un quarto d'ora. ⚠ Ma finché il push
non è dato, il refresh non parte **e la pagina Admin → Listone va in errore quando la si apre**: è il
passo che finisce il rilascio, non un extra.

```bash
cd /home/ploi/fantasta.rggndr.it && pnpm db:push
pm2 reload deploy/ecosystem.config.cjs --update-env
```

⚠ **E da questa macro il processo ha tre loop invece di due.** `exec_mode: "fork"` con `instances: 1`
in `deploy/ecosystem.config.cjs` era già la riga da non toccare mai; adesso protegge anche il refresh,
ed è il caso in cui una seconda copia si nota meno — `source_runs` ha una riga per fonte, quindi il
secondo `upsert` sovrascrive il primo e il conto dei tentativi sembra giusto.

**M10 e M10B sono in produzione da `v1.11.0`** (2026-08-12), uscite **insieme in un rilascio solo con
un tag solo**, per decisione dell'owner.

⚠ **Un tag solo vuol dire un punto di rollback solo**, e va saputo prima di trovarsi a farlo alle nove
di sera: il ciclo di `CLAUDE.md` dà a ogni macro il suo tag proprio per poter tornare indietro su una
senza portarsi via l'altra, e qui tornare indietro su M10B riporta indietro anche il listone a sistema.
È il prezzo della scelta, accettabile perché M10 in produzione da sola non c'è mai stata.

⚠ **E il rilascio non finisce col deploy: ci sono tre passi a mano**, scritti per esteso nel
`CHANGELOG.md` di `v1.11.0`. Uno è sul server:

```bash
cd /home/ploi/fantasta.rggndr.it && pnpm db:push
pm2 reload deploy/ecosystem.config.cjs --update-env
```

Un solo `pnpm db:push` copre entrambe le macro — i cambi sono additivi: `listone_players`,
`carmy_players`, e la colonna `player_insights.name`. Gli altri due sono **file da caricare, in
quest'ordine**: prima il listone da **Admin → Listone**, **poi** il foglio di Carmy sotto di lui, perché
il secondo si aggancia al primo **per nome** e senza il primo il suo pulsante è spento. Senza quei due
caricamenti le tabelle restano vuote — niente caricature nuove, Centro dati vuoto, nessuna proposta a
chi crea un'asta, e nessun giudizio in `/play`. **Niente si rompe**, ed è precisamente ciò che rende
quel passo facile da dimenticare: è il **quarto di fila**.

I tre passi di M8 (`pnpm db:push`, i due import dal pannello, `is_pro`) e i due di M7
(`CAMPIONCINI_EDITION` nel `.env`, l'archivio figurine riempito) sono stati **dati e confermati
dall'owner il 2026-08-12**. M9 non toccava lo schema. Se un giorno un dato di M7 o M8 sembra assente in
produzione, non è quello il sospetto da coltivare per primo.

⚠ **In locale i dati vanno riempiti, e la loro assenza somiglia a un guasto.** `player_insights` nasce
vuota anche sul database di sviluppo: senza i due import da Admin → Listone **nessun badge compare**,
per nessun utente, e il sintomo è «non vedo niente in `/play`» — cioè lo stesso che darebbe un bug. È
successo il 2026-08-12. Da M10 vale lo stesso per `listone_players`, con una differenza che conviene
sapere: **quella tabella non fa sparire niente che prima si vedesse** — semplicemente le caricature non
si scaricano, il Centro dati è vuoto e alla creazione di un'asta non compare nessuna proposta. Da M10B
la stessa cosa vale per `carmy_players`, e di nuovo senza far sparire niente: il badge della titolarità
torna quello calcolato dalle presenze, che è il ripiego dichiarato. ⚠ **E in locale l'ordine dei
caricamenti conta**: listone → Carmy → caricature. La procedura per tutte sta in
`docs/HOWTO-PROVA-LOCALE.md`, §6 e §7.

## Da pianificare

Due sono state pianificate insieme il **2026-08-18**, dalle due richieste che l'owner aveva nel
quaderno. **M13 è stata aperta** e sta qui sopra, in «In corso»; resta **M14**, che si apre su richiesta
esplicita come tutte. **`docs/REQUESTS.md` resta vuoto.**

| Macro | Tema | Schema? |
|---|---|---|
| [M14](14-cancello-risultati.md) | Il cancello dei risultati: le buste non si aprono da sole, e un lotto si può annullare | ⚠ **Sì** — una colonna additiva, `pnpm db:push`, **nessun backfill** |

**Perché due e non una.** Non hanno niente in comune: la prima è tutta UI dentro il pannello di
amministrazione, la seconda apre la **macchina a stati dell'asta** e aggiunge la prima fase nuova dopo
v1.0.0. È lo stesso criterio con cui M5 e M6 sono state tagliate in due il 2026-08-10 e M9–M12 il
2026-08-12: due profili di rischio così diversi vogliono due tag e due punti di rollback, perché
tornare indietro su un modale non deve portarsi via il cancello — e soprattutto il contrario.
M13 sta prima **solo** per questo: un suo errore si vede in una tabella, un errore di M14 si vede la
sera dell'asta con dodici persone che guardano.

**Le dipendenze sono zero.** Non si toccano gli stessi file, non si toccano gli stessi documenti, e
l'ordine si può invertire senza riscrivere una riga di spec.

⚠ **Le due cose da non riscoprire da capo, una per macro.** M13: la ricerca **ribalta una decisione
scritta di M6 §8** («niente ricerca full-text, paginazione o esportazioni»), e la ratifica vale solo
per la ricerca — la paginazione resta fuori, e M13 §4 spiega perché non sono la stessa decisione e cosa
succederebbe alla ricerca il giorno che la paginazione arriva. M14: **il cancello sta prima della
risoluzione del lotto, non dopo**, e il modo ovvio — risolvere e nascondere i risultati — ha un buco
che non si vede leggendo `serializeLot`: i crediti, `maxBid` e la rosa del vincitore sono in **ogni**
snapshot per **tutti**, TV compresa, e cambiano nell'istante dell'assegnazione. Nascondere il pannello
delle buste mentre i crediti di qualcuno scendono di 87 è un quiz con una risposta sola. M14 §3 è tutta
lì, ed è la sezione da leggere prima di scrivere una riga.

⚠ **M14 modifica due righe di `CLAUDE.md`**, e va saputo prima di aprirla: «la rotazione dei turni non
torna mai indietro» (l'annullamento la fa tornare indietro, in un caso solo e sotto tre condizioni) e
l'elenco delle fasi in cui gli override sono rifiutati, che deve comprendere anche la fase nuova. Un
file che si contraddice da solo è peggio di uno incompleto: è il precedente di M9 con `PLAN §8bis`
punto 1.

**Le quattro macro pianificate insieme il 2026-08-12** — da una sessione di analisi sola, a
partire dalle quattro richieste che l'owner aveva scritto nel quaderno dopo il rilascio di v1.9.1 —
sono state tutte lavorate e sono tutte in produzione: M9 (v1.10.0), M10 e M10B (v1.11.0), M11
(v1.12.0), M12 (v1.13.0).

⚠ **M11 non ha automatizzato il foglio di Carmy, e nessuno ci provi**: è un file che una persona
compila e che arriva da fuori. Lo stesso vale per il listone **d'asta**, l'export Leghe in `.xlsx`, che
passa da un login — è l'opzione B scelta dall'owner il 2026-08-12, e la distinzione fra i due file che
si chiamano «listone» sta in M10 §1. Quello che M11 dà è il posto dove dire da quanto non lo si
ricarica, e M10B quel posto l'aveva già preso: il **quarto timestamp** nel pannello e l'avviso quando
il file è più vecchio di un giorno. Con un file che invecchia in un giorno, quella data conta più che
per il listone.

⚠ **Una misura che corregge M8 §9, da non riscoprire da capo, e che M11 non ha usato.** Il 2026-08-12
`fantacalcio.it/probabili-formazioni-serie-a` è **piena** — 20 moduli, 220 titolari tutti con
`ext_id` **e con la percentuale di ballottaggio**, 22 infortunati con la data di rientro — e aggancia
al **100%** con i nostri identificativi. M8 l'aveva misurata vuota l'11 agosto e ne aveva concluso che
i ballottaggi stessero solo dietro il login di Fantalab: **sono pubblici**. Resta una strada non
percorsa, non una strada chiusa: sta in M10B §9.

⚠ **M11 ha ereditato da M10 il posto in cui dire «ho provato e non ci sono riuscito»**: la sezione
Listone del pannello. La dipendenza si è rivelata reale in un modo che la spec non aveva previsto — non
serviva *un* posto, ne servivano **due**, perché «c'è qualcosa che non va?» e «quando si è aggiornato,
da sé o a mano?» sono due domande diverse e si leggono in due momenti diversi. E la promessa è stata
onorata dalla parte giusta: il pulsante «Aggiorna il listone» era rimasto **sempre attivo** proprio in
vista di questa macro, e non ha dovuto essere smontato niente.

**Perché quattro e non una.** Le quattro richieste sembravano un tema solo — «sistemiamo il pannello»
— e hanno invece quattro profili di rischio diversi, che è il criterio con cui M5 e M6 sono state
tagliate in due il 2026-08-10. M9 era tutta UI: zero schema, zero motore, e si è chiusa in una sessione. M10
tocca **la strada dell'import**, cioè l'unica cosa che se si rompe rende impossibile *preparare* un'asta,
e porta uno `db:push` più un file da caricare a mano in produzione. M11 è l'unico codice che gira
**senza che nessuno guardi** dentro il processo che conduce l'asta. M12 è l'unico **irreversibile**: un
suo errore non si corregge con un `git reset`, si corregge con un `pg_dump`. Quattro tag e quattro
punti di rollback, perché un ritorno indietro sui badge non deve portarsi via la cancellazione delle
aste, e un ritorno indietro sul listone non deve rimettere la striscia verde.

**Le dipendenze sono due, e sono debolissime.** Quella di M10 su M9 è stata **onorata**: il Centro
dati è il terzo chiamante dei badge, e li ha resi un componente vero — `TitolaritaAnyBadge` e
`SetPieceBadges` sono esportati da `components/auction/insights.tsx` perché una tabella li vuole in due
colonne separate, non nelle due composizioni pronte. ⚠ Il primo dei due si chiamava
`TitolaritaBadge` fino a M10B, che lo ha **sostituito**: da quando la titolarità ha due fonti, un
badge per fonte voleva dire che ogni chiamante decideva quale disegnare — tre copie della regola che
`titolarita()` esiste per centralizzare. Quella di M11 su M10 è stata **onorata** anch'essa, ed era la
meno cosmetica delle due: un automatismo muto è peggio di nessun automatismo, e senza il pannello di
M10 il refresh sarebbe stato muto. M12 non dipende da niente.

**Due strade restano verificate e rinviate**, scritte per esteso in M8 §9 perché il lavoro d'analisi non
si perda: la **griglia portieri** (l'accoppiamento fra portieri di due squadre — e la scoperta che
qualsiasi indice per-squadra è provabilmente inutile, perché la media di riga vale 9.00 per tutte e
venti) e i **titolari attesi con gli infortunati del momento**, che fantacalcio.it serve pubblicamente
ma **solo a campionato in corso**: interrogata ad agosto, quella pagina è vuota. ⚠ La seconda ha avuto
una **seconda ratifica** il 2026-08-12: la richiesta di un badge «Infortunato (ora)» in rosso è stata
**ritirata dall'owner** proprio per quella misura. Non va riproposta come idea nuova.

## Chiuse

| Macro | Tema | Versione |
|---|---|---|
| [M12](12-cancellazione-aste.md) | Cancellare un'asta per forza, anche in corso, e il congedo di chi la stava guardando | v1.13.0 — 2026-08-18 |
| [M11](11-refresh-giornaliero.md) | Il refresh giornaliero degli insight: le due fonti pubbliche si chiedono da sé, e il pannello dice quando non ci riesce | v1.12.0 — 2026-08-13 |
| [M10B](10b-insight-da-carmy.md) | Gli insight che vengono da un umano: il foglio di Carmy, la titolarità letta invece che dedotta, i filtri per chi ha `is_pro` | v1.11.0 — 2026-08-12 |
| [M10](10-listone-a-sistema.md) | Il listone a sistema: la sezione admin, il Centro dati, la proposta alla creazione di un'asta | v1.11.0 — 2026-08-12 |
| [M9](09-badge-insight.md) | I badge degli insight, e la striscia verde via | v1.10.0 — 2026-08-12 |
| [M8](08-insight-listone.md) | Insight sul listone — titolarità, rigoristi, calci piazzati | v1.9.0 — 2026-08-12 |
| [M7](07-caricature.md) | Le caricature dei calciatori — la figurina scaricata una volta e guardata per tutta la serata | v1.8.0 — 2026-08-11 |
| [M6](06-amministrazione.md) | Amministrazione — il pannello: lista utenti, lista aste, e un perimetro strettissimo | v1.7.0 — 2026-08-11 |
| [M5](05-identita.md) | Identità — registrazione con email e password, verifica dell'indirizzo, recupero | v1.6.0 — 2026-08-10 |
| [M4](04-simulazione.md) | Simulazione in-app — l'asta di prova dall'interfaccia, con i bot dentro l'app | v1.5.0 — 2026-08-10 |
| [M3](03-tracciabilita.md) | Tracciabilità — il verbale delle rose e lo storico dell'asta | v1.4.0 — 2026-08-10 |
| [M2](02-navigazione.md) | Navigazione e identità delle pagine | v1.3.0 — 2026-08-10 |
| [M1](01-segretezza-offerte.md) | Segretezza e rivelazione delle offerte | v1.2.0 — 2026-08-10 |
| [M0](00-nuova-linea-di-sviluppo.md) | La nuova linea di sviluppo: tre branch, versioni, documenti | v1.1.0 — 2026-08-09 |

M5 e M6 sono nate da una sessione di spec sola, il 2026-08-10, e sono state **tagliate in due di
proposito**. M5 tocca la strada del login — l'unica cosa che, se si rompe, chiude fuori tutti — e
introduce l'unica dipendenza esterna del progetto; M6 è un pannello. Due profili di rischio così
diversi vogliono due tag e due punti di rollback: un rollback del pannello non deve portarsi via la
registrazione. E la dipendenza è a senso unico — la lista utenti di M6, senza M5, non avrebbe niente
da amministrare. È lo stesso criterio con cui il 2026-08-12 sono state tagliate M9–M12.

## Fuori macro

Non tutto passa da una macro, e va detto qui invece di sparire. In **v1.2.0**, su richiesta
esplicita dell'owner («falla direttamente qui»), sono entrati su `dev` senza aprirne una:

- **«Prosegui asta»** — l'evento `SKIP_REVEAL` e i suoi due pulsanti. Il perché delle scelte è in
  `docs/DECISIONS.md`, 2026-08-09.
- **Tre correzioni** attorno alla configurazione ad asta iniziata: il salvataggio dei tempi che non
  funzionava, il nome disabilitato, l'avviso costante, e la lobby che rimbalzava al portale in
  pausa. `docs/DECISIONS.md`, 2026-08-10.
- **La prova in locale**: `docs/HOWTO-PROVA-LOCALE.md` e il seed che fa entrare l'owner per ultimo.

Dopo **v1.9.0**, su richiesta esplicita («si direi di filtrare quelle simulate, procedi pure»):

- **La guardia del deploy ignora le aste simulate.** Una simulazione lasciata in pausa bloccava ogni
  deploy e non c'era modo di chiuderla, quindi l'unico rimedio era scavalcare la guardia ogni volta.
  `docs/DECISIONS.md`, 2026-08-12. ⚠ **M12 apre quel vicolo cieco**, e ha ratificato che la guardia
  resta comunque com'è: la voce sta nel suo §5.

In **v1.3.1**, sempre su richiesta esplicita («vai pure da `dev` a `main` senza branch»):

- **La versione nella navbar**, accanto al pulsante per uscire. Serve a controllare a vista quale
  codice sta rispondendo in produzione. `docs/DECISIONS.md`, 2026-08-10.

Il criterio resta quello di `CLAUDE.md`: una macro si apre su richiesta esplicita. Quando invece
si lavora direttamente su `dev`, restano dovuti `DECISIONS.md` al momento della scelta e
`CHANGELOG.md` al rilascio — che è ciò che rende questa riga leggibile fra sei mesi.
