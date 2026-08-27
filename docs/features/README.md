# Le macro-feature

Dopo v1.0.0 lo sviluppo non procede più per fasi. Procede per **macro-feature**: un tema
coerente, un branch, un merge su `main`, un minor. Una alla volta, e solo su richiesta esplicita.

Ogni macro ha un file qui dentro che contiene **spec e task insieme**: obiettivo, quali richieste
di `docs/REQUESTS.md` ci confluiscono, se tocca lo schema del database, quali invarianti di
`docs/PLAN.md` sono coinvolti, la spec, i task con checkbox e i criteri di verifica.

Quando una macro viene pianificata, le richieste che ci confluiscono **spariscono da
`docs/REQUESTS.md`**: il quaderno contiene solo ciò che non è ancora stato pianificato.

## Pianificata, non aperta

Nessuna.

## In corso

**M20 — «Il marchio nel nav, e l'app che si installa sul telefono»**
([20-marchio-e-app-installabile.md](20-marchio-e-app-installabile.md)), pianificata **e aperta** il
2026-08-27, su `feature/20-marchio-e-app-installabile`, dall'unica richiesta rimasta nel quaderno dopo
`v1.19.2`. Il marchio «F» entra nella navbar accanto a
«Fantasta», le icone si rifanno dal disegno nuovo, e l'applicazione diventa **installabile sulla
schermata home** — manifest, meta iOS, e la misura 192 che a `v1.15.1` era stata saltata proprio
perché serve solo a un manifest. Niente schema, niente backfill, nessuna dipendenza nuova: il rilascio
finisce col deploy, più una verifica dei tre percorsi nuovi da fuori.

⚠ **Ribalta una decisione scritta**, e il file lo dichiara in testa: la voce `DECISIONS.md` del
2026-08-18 diceva «nessun manifest, nessuna PWA, nessun service worker», e chiudeva con «per non
ritrovarselo proposto come idea nuova». Non è arrivato come idea nuova: l'ha chiesto l'owner. Il
service worker però **resta escluso**, e per la ragione che quella voce non poteva ancora conoscere —
una cache davanti a un'app che a ogni deploy ha due minuti di chunk 404 è quel guasto reso permanente.

⚠ **Il numero 19 resta bruciato di proposito**, non è un buco per distrazione: `CLAUDE.md` e la nota
qui sotto rimandano a un `git show` per la M19 cancellata, e riusare il numero renderebbe illeggibili
quei rimandi.

⚠ **M19 — «Il deploy senza finestra cieca» è stata cancellata**, il 2026-08-23, per decisione
dell'owner e senza che una riga fosse scritta: la finestra si gestisce **scegliendo quando
deployare**, non cambiando il deploy. La specifica confrontava tre strade (build in una `distDir`
parallela con scambio, cartella di rilasci alla Capistrano, pagina di manutenzione) e ne raccomandava
una; se un giorno tornasse in gioco si rilegge con
`git show e381389:docs/features/19-deploy-senza-finestra-cieca.md` invece di rifare l'analisi — è lo
stesso trattamento di `docs/RUNBOOK.md`.

⚠ **Il fatto misurato che stava lì dentro resta, e sta in `CLAUDE.md`**, accanto alle regole di
produzione: ogni deploy rende l'app inservibile per circa due minuti, perché `pnpm build` cancella gli
asset statici sotto i piedi del processo che sta ancora servendo. Non è un bug da diagnosticare la
prossima volta che si vedono dei 404 su un chunk durante un rilascio, ed è per questo che la nota è
sopravvissuta alla macro: la macro era la cura, quella riga è il sintomo, e il sintomo si incontra
comunque.

**Dove è arrivata**, al 2026-08-27: fatti M20-01 → M20-04, gate verde (baseline **914** test, chiusa a
**917**: tre per il manifest, e il terzo è quello che prende il rinomino delle icone). Restano due task
e **vogliono l'owner**: M20-05 è l'installazione su un iPhone vero con `pnpm dev:lan`, e con lei la
guardata al marchio sul telefono che chiude M20-02; M20-07 è la verifica dei tre percorsi nuovi da
fuori, dopo il deploy. ⚠ Due cose trovate lavorando cambiano quello che c'era scritto nella spec, e
stanno annotate nei task: Next emette `mobile-web-app-capable` e **non**
`apple-mobile-web-app-capable`, e il marchio nel nav **tronca il nome dell'utente** di 23–26 pixel,
contro quello che dice la verifica 3.

---

**M18 è in produzione da `v1.18.0`** (2026-08-23): pianificata, aperta, lavorata, provata dall'owner e
rilasciata **nella stessa sessione**, il quinto caso di fila dopo M13, M14, M16 e M17. Baseline 897
test, chiusa a **909**: dieci per `quotaPerRuolo`, due per l'ordine di estrazione. Gate verde al primo
giro, nessun passo a mano sul server.

⚠ **Il paragone visivo del «prima» non c'è**: l'owner ha scelto di procedere senza (2026-08-22), quindi
il termine di paragone è quello misurato dal database e sta nel task M18-01. Se una misura o una
spaziatura si rivelasse sbagliata, quella è la ragione per cui nessuno se ne è accorto prima.

⚠ **Un flake preesistente è stato chiuso dentro la macro**, come i tre di M14 e con la stessa
disciplina — riprodotto e misurato prima di toccarlo: **due rossi su sei giri** con M18 addosso, **zero
su cinque sulla baseline** girata in un worktree. `delete-auction.test.ts` asseriva sul **contenuto** di
`listone_players`, che è posseduta da `listone.test.ts` e da lei svuotata senza `WHERE`. M14 aveva già
corretto quella misura una volta (da `toBe(length)` a contenimento) e non bastava: il contenimento
regge le righe aggiunte in parallelo, non quelle togliesse. **Non era aggiustabile una terza volta come
misura** — nessuna riga-sentinella sopravvive a quel `DELETE` — quindi l'asserzione è passata **dai dati
allo schema**: una cascata viaggia sulle foreign key, e quelle tabelle non ne hanno nessuna. Otto giri
di suite verdi.

---

**M17 è in produzione da `v1.17.0`** (2026-08-22): pianificata, aperta, lavorata,
provata dall'owner e rilasciata **nella stessa giornata**, il quarto caso di fila dopo M13, M14 e M16.
Gate verde con **897 test in 52 file** (da 858), typecheck, lint e build. Su desktop il portale è tre
colonne, la chiamata arriva dal basso come l'offerta, e la colonna dello stato ha la stessa anatomia
in tutte le nove scene. **Nessun `pnpm db:push`, nessun backfill, nessun file da caricare**:
verificato, non dedotto — il diff `origin/main..dev` non tocca `lib/db/schema.ts`.

⚠ **Il provino statico prima del React è ciò che ha salvato questa macro dal finire come M15**, e
vale come metodo più che come aneddoto. Le tre colonne, le nove scene e la tavolozza sono state
guardate come HTML statico con i token copiati da `app/globals.css` **prima** che esistesse un
componente, e quel giro ha cambiato **quattro decisioni su cinque**: l'identità inglobata e grigia
invece di una card a sé, l'ordine di chiamata tolto dal titolo, il timer da numero grande a banda in
fondo, la misura da barra ad anello. Ognuna di quelle scoperte, fatta a React scritto, sarebbe stata
un rifacimento.

⚠ **E le cinque correzioni dopo il provino sono arrivate tutte dalla simulazione**, cioè da M17-09,
che esiste per quello: il pulsante «Prosegui asta» spostato sotto il vincitore e reso nero, il taglio
della riga giocatore da «per fonte» a «per domanda», il rapporto grezzo via, la card in quattro
righe, e alla fine il pulsante «Chiama» via del tutto. **Nessuna di queste era nella spec**, e
nessuna si sarebbe vista leggendo il codice.

⚠ **Le tre cose da non riscoprire da capo.** La prima: `CountdownBar` **cambiava già colore col
tempo** (verde/ambra/rosso), quindi fascia della scena e barra del countdown avrebbero avuto due
verdi e due ambra nella stessa card con significati diversi — a tre secondi dalla chiusura, fascia
verde sopra barra rossa. La banda in fondo lo scioglie **per posizione** (fascia in testa, misura in
coda, un bordo in mezzo), e le tre soglie stanno adesso in `timeTone`, da cui `CountdownBar` le
rilegge. La seconda: il badge «riconnessione…» viveva **solo** nella barra incollata, che da `lg`
sparisce — sarebbe diventato invisibile su desktop senza che niente lo segnalasse, e sta ora in
`<Identity>`. La terza: `phaseLabel` in pausa restituisce «in pausa», che è già quello che dice il
badge accanto; la card si ripeteva, e il rimedio è stato **fattorizzare** lo `switch` in
`phaseLabelIgnoringPause` — non scrivere una seconda frase, che §5 vietava. C'è un test sulla
**relazione** fra le due funzioni.

⚠ **Il rosso è limitato alle tre scene in cui si agisce**, ed è una decisione presa contando: con una
regola sola la banda diventerebbe rossa ~200 volte in una serata a 8 con 25 slot, e tre volte su
sette dove non è chiesto niente. Un rosso che non chiede mai niente si impara a ignorare.

⚠ **Due dati non si leggono più da nessuna parte, e sono stati tolti su richiesta**: l'ordine di
chiamata dei ruoli (`roleOrder` — il portale era l'unico posto che lo scriveva, e `RosterGrid`
elenca i ruoli nel suo ordine fisso) e `fvm` nella lista di chiamata. ⚠ Il secondo **ordina ancora
la lista**: ciò che tiene in piedi la promessa «il primo è quello che il timer prenderebbe» è la riga
dell'auto-pick sopra l'elenco, che lo dice per nome. Se un giorno quella riga venisse togliesse,
l'ordinamento diventerebbe muto.

⚠ **E `InsightsLine` non esiste più**: si è sciolta in `ValoriCarmy` e `BonusENote` quando la card è
passata a quattro righe. Una composizione con un solo chiamante da spezzare in tre non è
un'astrazione ma un ostacolo, e quel file esporta pezzi da M10.

---

**M14 è in produzione da `v1.15.0`** (2026-08-18): aperta, lavorata, provata dall'owner e
rilasciata **nella stessa giornata** in cui era stata pianificata — il secondo caso di fila, dopo M13.
Gate verde con **860 test in 51 file** (da 815), typecheck, lint e build. Fra la chiusura di un round e
la rivelazione delle buste c'è ora `LOT_SEALED`, la prima fase nuova della macchina a stati dopo v1.0.0.

⚠ **Il passo a mano sul server è stato dato**: `auctions.result_gate_seconds`, additiva con `DEFAULT 0`.
**Nessun backfill**, e nessuno serviva — in produzione c'erano **0 aste** (32 utenti, 12 dei quali bot),
quindi non esisteva una riga su cui quel default facesse differenza. La colonna è stata aggiunta
**prima** del push su `main` e non dopo il deploy come dice la procedura: fra il `pm2 reload` del deploy
e il `db:push` l'app girerebbe con il codice nuovo su uno schema vecchio, e ogni lettura di `auctions`
fallirebbe. Essendo additiva con un default, il codice vecchio la tollera senza vederla, quindi
anticiparla chiude quella finestra a costo zero. `pnpm db:push` è stato dato comunque dopo, e ha
risposto «No changes detected»: è la verifica che schema e `schema.ts` combaciano.

⚠ **La cosa da non riscoprire da capo**: il cancello sta **prima** della risoluzione del lotto. Il modo
ovvio — risolvere e nascondere `reveal` — è stato provato prima di scrivere il rimedio e non nasconde
niente: nello snapshot della TV, con `reveal: null` e `tie: null`, il vincitore scende da 100 a 13
crediti e `roster` pubblica `price: 87`, cioè l'**importo esatto** della busta vincente. Il racconto per
un lettore futuro è in `docs/ARCHITECTURE.md`, le decisioni in `docs/DECISIONS.md` alla data.

**Tre flake preesistenti sono stati corretti dentro questa macro** — `delete-auction`, `bots` e
`scheduler` — dopo averli riprodotti e verificato che non fossero di M14: tutti e tre erano asserzioni
su stato globale condiviso fra file di test che girano in parallelo. Dieci giri di suite di fila verdi
dopo, contro uno rosso su otto prima.

⚠ **E una cosa sul collaudo locale, che non era scritta da nessuna parte**: l'asta prodotta da
`pnpm db:seed` ha i posti occupati dai dodici utenti di prova, **non** dai bot, e `bot_strategy` è
`NULL` su tutti — il tick interno muove solo i membri con una strategia, quindi lì non muove niente e
l'asta sembra piantata. Serve `pnpm bots`. Sta ora in `docs/HOWTO-PROVA-LOCALE.md`.

---

**M13 è in produzione da `v1.14.0`** (2026-08-18): aperta, lavorata, provata dall'owner e
rilasciata **nella stessa giornata** in cui era stata pianificata. Gate verde con **815 test**, typecheck
e build. La tabella di Admin → Utenti è diventata sei colonne in sola lettura con una ricerca in testa, e
le modifiche stanno in un pannello laterale che si apre da «Vedi».

⚠ **Nessun passo a mano sul server, e nessuna dipendenza nuova**: niente `pnpm db:push`, niente backfill,
niente file da caricare. Secondo rilascio di fila senza niente in sospeso — e la cosa è stata verificata,
non dedotta: `git diff` non tocca `lib/db/schema.ts` e `package.json` ha le stesse dipendenze di
`v1.13.0`.

**Due cose sono entrate a macro aperta, su decisione dell'owner del 2026-08-18** — la spec non le
prevedeva, e i task `M13-12` e `M13-13` le raccontano per esteso.

⚠ **Le quattro Server Action per campo sono state tolte**, non lasciate in piedi: `app/admin/actions.ts`
adesso ha **una sola** azione che scrive su una riga di `users`. Quattro endpoint scrivibili che nessuna
schermata apriva più sono quattro endpoint di cui nessuno si accorge se un giorno smettono di
comportarsi bene. Il potere non è cambiato — le funzioni del motore sono le stesse quattro — e
`lib/engine/admin.ts` è rimasto intatto. **L'elenco esatto degli export in `tests/db/admin.test.ts` ha
funzionato per la prima volta al contrario**: era nato per fermare l'azione aggiunta senza guardia, e qui
ha confermato che le quattro tolte non lasciavano riferimenti in giro.

⚠ **E c'è un toast**, perché il primo giro non dava nessun feedback: l'esito per campo dentro il modale
è giusto quando il modale resta aperto, ma a pieno successo il modale si chiude e il messaggio se ne
andava con lui — un salvataggio riuscito era indistinguibile da un click andato perso. Il toast vive in
`UsersTable`, che sopravvive alla chiusura, e ha tre toni: riuscito, **riuscito a metà** e rifiutato. È
fatto con `Toast` di `radix-ui` e **non** con quello di shadcn, che oggi è un involucro attorno a
`sonner`: è la stessa decisione dello `Switch`, presa due volte nello stesso giorno perché entrambe le
richieste linkavano shadcn.

⚠ **`docs/features/06-amministrazione.md` e `08-insight-listone.md` non sono stati riscritti**: sono
l'archivio di due macro chiuse e dicono il vero su cosa fecero allora. È lo stesso trattamento che M13
riserva a M6 §8 sulla ricerca — la ratifica di un cambio di idea sta in `docs/DECISIONS.md` e in
`docs/ARCHITECTURE.md`, non in una riscrittura del file di una macro chiusa.

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

Nessuna. Il quaderno `docs/REQUESTS.md` è vuoto: le due richieste che c'erano sono confluite in M18,
qui sopra.

Quello che segue è il ragionamento con cui **M18** è stata tagliata il 2026-08-22, e resta come
archivio: dice il vero su perché è una macro sola.

I ruoli della propria rosa diventano una fisarmonica con la **quota di budget del reparto** accanto
al nome, e i giocatori si ordinano per **data di estrazione** invece che per prezzo — nel portale,
in regia e in TV.

⚠ **È una macro sola perché il rischio è uno solo**: zero motore, zero schema, zero passi a mano,
tutto in `components/auction/roster-grid.tsx`, `app/tv/[publicToken]/tv-view.tsx` e
`lib/realtime/portal.ts`. Il criterio del progetto taglia per profilo di rischio, non per tema, e qui
non ci sono due profili.

⚠ **Le tre cose da non riscoprire da capo**, tutte verificate leggendo il codice e non dedotte. La
prima: **il dato per l'ordine cronologico c'è già** — `loadAuctionState` legge le assegnazioni per
`created_at, id` e `serializeMembers` non riordina, quindi `member.roster` **è già** in ordine di
estrazione e i due `.sort((a,b) => b.price - a.price)` del client lo stanno disfacendo. La modifica è
**sottrattiva** e non tocca `serializeSnapshot`: la strada ovvia — «serve un `assignedAt` nello
snapshot» — apre il punto più delicato dell'app per niente. La seconda: quel `created_at` è **del
motore**, non un `defaultNow()` (`persistAuctionState` scrive `toDate(a.createdAt)`), ed è ciò che
rende l'ordine giusto anche nei dati del seed — con un `now()` di transazione le assegnazioni
seminate insieme avrebbero condiviso il timestamp e in locale l'ordine dentro un reparto sarebbe
sembrato casuale, cioè un finto bug. La terza: **il ruolo in gioco che si apre da sé non vuole un
`useEffect`** ma una `key` su `auction.currentRole` — così la scelta a mano vale finché il ruolo non
cambia, invece di essere sovrascritta a ogni snapshot.

⚠ **E `RosterGrid` ha due chiamanti diversissimi**: il portale ne mostra **una** rosa, la regia
**8–12**. La fisarmonica vale solo nel portale (decisione dell'owner), quindi il file serve due forme
— due componenti e un corpo privato condiviso, **non** una prop booleana che accende insieme la
fisarmonica e le percentuali.

---

Quello che segue è il ragionamento con cui M16 e M17 sono state tagliate il 2026-08-22, e resta come
archivio. Sono **entrambe chiuse e in produzione** — M16 in `v1.16.0`, M17 in `v1.17.0`, nella stessa
giornata.

**Perché due e non una.** Le tre richieste sembrano un tema solo — «sistemiamo il portale» — e hanno
due profili di rischio molto diversi, che è il criterio con cui sono state tagliate M5/M6, M9–M12 e
M13/M14. **M16 tocca il motore**: `machine.ts`, `actions.ts`, la rotta `/action`. Un suo errore non si
vede in una pagina, si vede la sera dell'asta — ma è **sottrattiva**, non apre nessun percorso nuovo,
e il suo gate sta quasi tutto in `pnpm test`. **M17 non tocca né motore né schema**, ma è una
scommessa visiva grande: tre colonne, un pannello nuovo, una tavolozza.

⚠ **Ed è il precedente di M15 a decidere il taglio, non la simmetria.** Quella macro — tutta visiva —
è stata lavorata per intero, guardata una volta e buttata: tredici commit scartati. Se il layout a tre
colonne facesse la stessa fine, tornare indietro **non deve rimettere in piedi il pulsante «Ritira»**.
Due tag, due punti di rollback.

**La dipendenza è una sola e va in una direzione**: M16 toglie da `lot-card.tsx` il ramo «ti sei
ritirato», e M17 ridisegna quella card. M16 prima vuol dire ridisegnare una card che ha già la forma
finale; l'ordine inverso vuol dire toccare due volte lo stesso file. Nessuna delle due tocca lo
schema: **nessun `pnpm db:push`, nessun backfill, nessun file da caricare** — e la cosa è stata
verificata leggendo, non dedotta.

⚠ **Le due cose da non riscoprire da capo, una per macro.** M16: `"WITHDRAW_BID"` in
`ROUTINE_EVENT_TYPES` (`lib/auction-log.ts`) **non va tolto** insieme al resto — quel file ha scritto
che «un tipo sconosciuto è notevole», quindi toglierlo dall'elenco della routine non fa sparire i
ritiri storici, li **promuove** nel blocco delle correzioni dove non sono mai stati. M17: la colonna 3
va scritta **prima** delle altre nel DOM e riordinata con `lg:order-*`, altrimenti chi gioca dal
telefono deve scorrere oltre la propria rosa per arrivare all'offerta.

---

Quello che segue è il ragionamento con cui M13 e M14 erano state tagliate il 2026-08-18, e resta come
archivio: dice il vero su perché sono due macro e non una.

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
| [M17](17-portale-tre-colonne.md) | Il portale a tre colonne: la chiamata a pannello, e una colonna di stato che si legge a colpo d'occhio | v1.17.0 — 2026-08-22 |
| [M16](16-regole-offerta.md) | Le regole dell'offerta: via i valori suggeriti, via il ritiro (motore compreso), i pallini di presence in TV | v1.16.0 — 2026-08-22 |
| [M14](14-cancello-risultati.md) | Il cancello dei risultati: fra la chiusura di un round e la rivelazione delle buste un istante che appartiene a chi conduce, e un lotto che si può annullare | v1.15.0 — 2026-08-18 |
| [M13](13-utenti-admin.md) | La pagina utenti: sei colonne in sola lettura con la ricerca, e un pannello laterale che modifica | v1.14.0 — 2026-08-18 |
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

Dopo **v1.15.0**, su richiesta esplicita («applica solo la favicon al progetto»):

- **L'icona dell'applicazione**: tre file in `app/` — `favicon.ico` con 16, 32 e 48 dentro, `icon.png`
  a 512, `apple-icon.png` a 180 senza trasparenza — più la sorgente in `fixtures/favicon-512.png` e la
  ricetta in `scripts/genera-icone.py`, che non è chiamato da niente. `docs/DECISIONS.md`, 2026-08-18.
  ⚠ Era una delle due richieste che **M15 avrebbe portato**: quella macro è stata **annullata** — il
  tema nuovo non è piaciuto all'owner e i tredici commit sono stati scartati, senza conseguenze perché
  `dev` non era mai stato pushato. L'icona è stata poi chiesta da sé. **Il preset di shadcn non è stato
  applicato**, e se un giorno tornasse in gioco l'analisi va rifatta da zero: la spec di M15 non esiste
  più.

In **v1.3.1**, sempre su richiesta esplicita («vai pure da `dev` a `main` senza branch»):

- **La versione nella navbar**, accanto al pulsante per uscire. Serve a controllare a vista quale
  codice sta rispondendo in produzione. `docs/DECISIONS.md`, 2026-08-10.

Il criterio resta quello di `CLAUDE.md`: una macro si apre su richiesta esplicita. Quando invece
si lavora direttamente su `dev`, restano dovuti `DECISIONS.md` al momento della scelta e
`CHANGELOG.md` al rilascio — che è ciò che rende questa riga leggibile fra sei mesi.
