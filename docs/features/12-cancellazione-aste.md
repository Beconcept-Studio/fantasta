# M12 — Cancellare un'asta per forza

> **Stato:** **chiusa e in produzione da `v1.13.0`** (2026-08-18). Chiusa su `dev` il 2026-08-17,
> rilasciata il giorno dopo, a prova a due dispositivi fatta. Pianificata il 2026-08-12 ·
> **Indipendente da M9, M10 e M11**: può scivolare dove serve. Sta per ultima perché è l'unica macro
> dopo la quale un errore non si corregge con un `git reset`.
>
> **Tocca lo schema del database?** **No.** Nessuna tabella, nessuna colonna, **nessun `pnpm db:push`
> e nessun backfill**: le cascate che servono **esistono già**, per intero, e §1 dice da quando e
> perché.
>
> **Invarianti coinvolti:** **I10 e `PLAN §8bis`**, in un modo nuovo: §8bis elenca cinque rientri
> possibili in un'asta e **non contempla «l'asta non esiste più»**. Questa macro deve aggiungere quel
> caso, e §3 è tutto lì. **I8** non c'entra — non esce nessuno stato. **Regole coinvolte:** **5**, che
> non viene violata e §1 spiega con la citazione; **7** (ogni schermata è funzione dello snapshot: e
> quando lo snapshot non arriverà mai più?).
>
> ⚠ **Questa è l'unica azione irreversibile dell'applicazione.** Non c'è `voided_at`, non c'è undo, non
> c'è un cestino: cancellare un'asta conclusa vuol dire cancellare il verbale delle rose e tutto lo
> storico di M3. L'unico recupero è il `pg_dump` delle 04:15 UTC. §4 dice cosa deve costare, e il file
> lo dice qui in cima perché è la prima cosa da sapere.
>
> ⚠ Si apre **su richiesta esplicita dell'owner**, come tutte.

## Obiettivo

Un'asta di prova lasciata in pausa **non si può chiudere**. Non è un'ipotesi: è successo davvero il
2026-08-12, durante il rilascio di v1.9.0 — «FerroAsta», una simulazione messa in pausa il giorno
prima, ha annullato il deploy. E il rimedio non c'era: `deleteAuction` rifiuta `LIVE` e `PAUSED` anche
a un amministratore, non esiste un'azione «termina asta», e a `COMPLETED` si arriva **solo giocando
fino in fondo**.

La conseguenza è stata una decisione che ha curato il sintomo: la guardia del deploy ha smesso di
contare le simulate, perché l'alternativa era abituarsi a scavalcarla. Quella decisione resta giusta
(§5), ma il vicolo cieco è ancora lì.

Questa macro lo apre. Un amministratore può cancellare **qualunque** asta, in qualunque stato, e
l'applicazione deve saper spiegare a chi la stava guardando che non c'è più.

Il tema, detto in una riga: *non serve un pulsante nuovo, serve togliere un rifiuto — e sapere cosa
dire a chi era collegato.*

## Richieste che ci confluiscono

Tolta da `docs/REQUESTS.md` il 2026-08-12 — il quaderno torna vuoto.

- **Forzare cancellazione aste.** «Da admin devo poter cancellare aste. La cancellazione da admin cade
  a cascata su tutto il resto. Solo gli utenti annessi non si cancellano.»

**Due terzi di questa richiesta sono già veri**, ed è la ragione per cui la macro è piccola: la
cascata c'è ed è completa, e gli utenti non vengono toccati per costruzione (§1). Quello che manca è
il permesso di farlo su un'asta in corso.

**Decisione dell'owner del 2026-08-12:** **solo l'amministratore** può forzare. L'owner di un'asta
continua a poterla cancellare alle condizioni di oggi. E il congedo per chi è collegato: «ok con il
messaggio per gli utenti live».

---

## Spec

### 1. Cosa esiste già — e perché la regola 5 non è in mezzo

**La regola 5 dice:** *«Mai `DELETE` né `UPDATE` distruttivi su `assignments` e `ledger`. Solo
`voided_at` e righe compensative.»* Sembra vietare questa macro. Non la vieta, e non è
un'interpretazione: è ratificato per iscritto in `DECISIONS.md`, 2026-08-07 (Fase 1), voce
«`ON DELETE CASCADE` su tutte le chiavi verso `auctions`»:

> *«Compresi `assignments` e `ledger`. Motivazione: la regola 5 vieta `DELETE` e `UPDATE` distruttivi
> **come correzione** dentro un'asta viva — lì si usano `voided_at` e righe compensative. Cancellare
> un'asta intera è un'altra cosa, ed è richiesta dalla checklist pre-asta di PLAN §17 (punto 3:
> rimozione dell'asta di prova). Senza le cascate quella cancellazione andrebbe scritta a mano
> tabella per tabella.»*

Le cascate sono state messe **per rendere possibile esattamente questo**. La regola 5 protegge la
correzione di un numero dentro un'asta che si sta giocando; qui non si corregge niente, si butta via
tutto.

**E «solo gli utenti annessi non si cancellano» è già vero, per direzione delle chiavi.** Nessuna
tabella punta da `auctions` verso `users`: è `members.user_id` che punta a `users`. Cancellare un'asta
cancella le sue righe `members` — la partecipazione — e **non tocca una riga di `users`**. Non serve
nessuna guardia: non c'è nessun percorso da cui potrebbe succedere.

**Cosa esiste già, per esteso:**

| | Dove | Stato |
|---|---|---|
| Cancellazione owner-o-admin | `deleteAuction` in `lib/engine/setup.ts` | Fatta (M6) |
| Cascata su tutte le tabelle dell'asta | Schema | Fatta (Fase 1) |
| Conferma con il nome digitato | `deleteAuctionAsAdminAction` | Fatta (M6) |
| Riga di log `DELETE_AUCTION` con stato, attore, simulata | `deleteAuction` | Fatta (M6) |
| **Il rifiuto su `LIVE` e `PAUSED`** | `deleteAuction` | **È ciò che questa macro tocca** |

Quindi il cuore della macro è **una riga di condizione** — e tutto il resto del file parla di cosa
succede dopo che quella riga è passata.

### 2. Cosa succede oggi se un'asta guardata smette di esistere

Non è un'ipotesi da valutare all'apertura: è stato **letto nel codice** il 2026-08-12, e sono tre
comportamenti indipendenti.

**1. Lo stream resta aperto e muto — per sempre.** `resolveViewer` gira **una volta**, all'apertura
della connessione (`app/api/auctions/[id]/stream/route.ts`): non c'è nessuna riautorizzazione mentre lo
stream vive. Dopo il `DELETE`, la connessione è ancora nel registro, il `: ping` continua ad arrivare
ogni intervallo, e **nessuno snapshot arriva mai più** — perché non c'è più niente che muti quell'asta.

⚠ **Il sintomo è il peggiore possibile:** il portale resta fermo sull'ultimo snapshot ricevuto, con il
countdown congelato, e sembra **lento**, non rotto. Dieci persone in una stanza guardano una schermata
che non cambia e cominciano a ricaricare la pagina.

**2. Chi ricarica trova un errore che riprova all'infinito.** Alla riconnessione `resolveViewer`
fallisce e la rotta risponde con un errore; l'`EventSource` **riconnette da sé**, quindi il client
entra in un ciclo di tentativi. Nessuno gli ha detto che è finita.

**3. Il timer armato è innocuo, e va sapientemente lasciato tale.** Il `setTimeout` sulla deadline
scatta e chiama `advancePhase` su un'asta che non c'è: `withAuctionLock` non trova la riga e
restituisce un `NOT_FOUND` **tipizzato** — non un'eccezione. Nessun crash, nessun log rumoroso. Lo
sweep, che seleziona le aste `LIVE` dal database, non la vede più. Va comunque **cancellato
esplicitamente**, per non lasciare in memoria una voce che nessuno ripulirà.

**Questa sezione è il lavoro vero di M12.** La riga di condizione è cinque minuti; questo è il resto.

### 3. Il congedo: dire che è finita, una volta sola

Serve un **evento terminale** sul canale: non uno snapshot (non ce n'è più uno da mandare), ma un
messaggio che dice «quest'asta non esiste più», dopo il quale il client se ne va.

**Tre pezzi, e uno per ciascun confine già esistente.**

**a) Il registro impara a congedare.** `Subscriber` in `lib/realtime/broadcast.ts` oggi ha un campo
solo, `send: (snapshot) => void`: non c'è nessun modo di mandare qualcosa che non sia uno snapshot.
Prende un secondo campo — il congedo — e il modulo una funzione `closeAuctionStreams(auctionId)` che lo
chiama su tutte le connessioni di quell'asta e svuota la voce della mappa.

**b) Il motore non deve sapere che esiste un canale.** ⚠ `deleteAuction` **non importa**
`lib/realtime/broadcast.ts`: passa da un **hook settabile**, come fa già `mutate.ts` con
`setBroadcastHook`, agganciato in `instrumentation.ts` dentro il ramo `nodejs`. È la stessa ragione per
cui lo scheduler riceve `advancePhase` da fuori: nei test, nel seed e nei bot quell'hook resta quello
di default e non fa niente, e nessuno di quei processi apre connessioni. Il congedo si manda **dopo il
commit**, fuori dalla transazione — esattamente dove `withAuctionLock` fa il broadcast.

**c) Il client chiude, e poi va via.** Sull'evento terminale, `lib/realtime/use-auction-stream.ts`
deve fare **due cose in quest'ordine**: `source.close()` e poi la navigazione alla dashboard con un
messaggio. ⚠ **L'ordine non è estetica:** un `EventSource` riconnette da sé quando lo stream si
chiude, quindi senza il `close()` esplicito il client tornerebbe a battere su una rotta che risponde
errore — cioè il problema 2 di §2 con un passaggio in più.

**Cosa vede la persona:** la dashboard, con scritto che l'asta è stata cancellata da un
amministratore. Non un modale su una schermata morta: la schermata dell'asta non ha più niente da
mostrare, e restarci sarebbe crudele.

⚠ **Vale per tutti e tre gli spettatori**, non solo per il partecipante: il portale manager e la
**vista TV** sono attaccati allo stesso stream. La TV non ha una dashboard dove andare — mostra un
messaggio e si ferma lì.

### 4. Cosa deve costare

**Solo l'amministratore forza** (decisione dell'owner). Concretamente: `deleteAuction` continua a
rifiutare `LIVE` e `PAUSED` a tutti — l'owner compreso — e l'amministratore ha una strada in più che
quel rifiuto non ha. Non si allarga il permesso dell'owner «tanto è la sua asta»: la sua asta la stanno
guardando altre undici persone.

Il permesso si **rilegge dal database** dentro il lock, non arriva dal chiamante: la sessione è un JWT
e non sa niente di `is_admin` (P17). È già così in `requireOwnerOrAppAdmin`, e resta così.

**Il nome digitato c'è già** e resta: è una difesa contro la mano, non contro il chiamante.

⚠ **Su un'asta `LIVE` o `PAUSED` la conferma deve dire cosa sta per succedere**, e non «questa azione è
irreversibile» in generale: *«ci sono N persone collegate; verranno riportate alla dashboard»* — con N
che il registro delle connessioni sa già dire (`connectionCount(auctionId)`). Un avviso che nomina un
numero si legge; uno generico si clicca.

⚠ **E il file deve dire ciò che nessun pulsante può impedire:** cancellare un'asta **reale**
`COMPLETED` si porta via il verbale delle rose e lo storico di M3, per sempre. Prima di farlo si dà
`deploy/db-backup.sh`. Va nel `CHANGELOG.md`, non solo qui: è l'unico posto che qualcuno rileggerà.

La riga di log `DELETE_AUCTION` esiste già e porta stato, attore e `isSimulated`. Su una cancellazione
forzata deve portare **anche il numero di connessioni congedate**: è la differenza fra «ho cancellato
una prova» e «ho interrotto una serata».

### 5. La guardia del deploy non torna a contare le simulate

Questa macro **rimuove la causa** della decisione del 2026-08-12: la guardia ha smesso di contare le
aste simulate proprio perché una simulata in pausa non si poteva chiudere. Con la cancellazione forzata
quel motivo cade, e la domanda «la rimettiamo?» va risposta invece di restare implicita.

**No** — ratificato dall'owner il 2026-08-12. Il secondo motivo di quella voce regge da solo:
*«un minuto di silenzio con dieci persone che aspettano è un minuto di panico» in una simulazione non
si applica: aspettano dei bot, e il boot recovery li rimette in moto da solo.* E riaprire una guardia
appena chiusa riporterebbe l'abitudine a scavalcarla, che è il modo in cui una guardia smette di
proteggere il giorno che serve davvero.

⚠ Va scritto in `DECISIONS.md` come **ratifica**, con il rimando alla voce di ieri: chi leggerà le due
voci in fila deve trovare la domanda già posta, non doversela fare.

### 6. Il perimetro — cosa questa macro non fa

- **Nessuna azione «termina asta»**, che porterebbe un'asta a `COMPLETED` senza giocarla. Sarebbe uno
  stato prodotto da un percorso che il motore non conosce, e ogni query che oggi si fida di
  `COMPLETED` (il verbale, l'export, lo storico) dovrebbe imparare a diffidarne. Se un giorno servirà,
  è una macro sua, e la domanda da farsi sarà «cosa dice il verbale di un'asta terminata a metà?».
- **Nessuna cancellazione morbida** (un flag `deleted_at` sull'asta). Vorrebbe dire un filtro nuovo in
  ogni query che oggi legge `auctions` — dashboard, pannello, sweep, tick dei bot, guardia del deploy —
  e un solo posto dimenticato è un'asta fantasma che riappare. La regola 5 non chiede il contrario per
  un'asta intera (§1).
- **Nessun undo, nessun cestino, nessun export automatico prima di cancellare.** Il backup c'è ed è
  quello (§4).
- **Non si tocca** il motore, la macchina a stati, `serializeSnapshot`, il ledger, gli override.
- **Non si tocca la guardia del deploy** (§5).
- **Nessuna cancellazione in blocco** («cancella tutte le simulate»): la conferma con il nome esiste
  per rendere l'operazione una alla volta.
- **Nessun `DELETE` su `player_insights`, `listone_players` o sull'archivio figurine.** Sono dati
  globali e sopravvivono alle aste di proposito: è scritto in tre file di feature e resta vero.

---

## Task

> Da rifinire all'apertura della macro. Sono la traduzione della spec, non un impegno preso nella
> sessione in cui è stata scritta.

- [x] **M12-01** — Aprire `feature/12-cancellazione-aste` da `dev`; rileggere questo file, e in
      particolare §2: i tre comportamenti sono stati letti nel codice, non ipotizzati, e sono la
      ragione per cui la macro non è «una riga»
- [x] **M12-02** — Riprodurre §2 **prima di scrivere il rimedio**: un'asta simulata `LIVE`, un browser
      collegato, `DELETE` a mano da `psql`, e guardare il portale restare fermo con i ping che
      arrivano. È il bug che questa macro esiste per non lasciare in piedi, e va visto una volta
      → **Fatto, e il bug si è comportato esattamente come scritto.** Al posto del browser uno stream
      TV aperto con `curl` — il token nell'URL *è* l'autenticazione, quindi non serve una sessione, e
      un terminale timbra ogni riga con l'ora, che uno schermo non fa. «Simulasta» riportata `LIVE`,
      snapshot alle 23:11:20/32/39/43/45 mentre i bot giocavano, `DELETE` da `psql` alle 23:11:46:
      **da lì solo `: ping` alle :52, :07, :22, e nessuno snapshot mai più.** La connessione non muore
      mai, quindi nessun client ha motivo di riconnettersi. → **Una cosa la spec l'aveva sbagliata:
      vedi «Com'è andata».**
- [x] **M12-03** — `lib/realtime/broadcast.ts`: il campo del congedo in `Subscriber` e
      `closeAuctionStreams(auctionId)` (§3a). La voce della mappa va svuotata
      → Il campo si chiama `dismiss` e la funzione prende **anche il nome dell'asta**, perché il
      congedo lo porta ai client (§3c dice «con un messaggio», e il messaggio nomina l'asta). Svuota
      anche un eventuale broadcast di presence in coda: era innocuo, ma è un timer armato su un'asta
      che non c'è, cioè la stessa cosa che §2.3 chiede di non lasciare in giro.
- [x] **M12-04** — La rotta dello stream manda l'evento terminale e chiude il controller; il client
      (`use-auction-stream.ts`) fa **`close()` e poi naviga** (§3c). ⚠ L'ordine è il punto: senza il
      `close()` l'`EventSource` riconnette da sé
      → `event: deleted`, e il nome dell'evento sta in `lib/realtime/types.ts` perché le due sponde
      devono essere d'accordo alla lettera. La navigazione **non** è finita dentro
      `use-auction-stream.ts`: l'hook restituisce `deleted` e chi ha una dashboard chiama
      `useDeletedRedirect` (`app/auctions/use-deleted-redirect.ts`). Tre ragioni nel file, e la prima
      è che così l'ordine di §3c **non si può invertire per sbaglio**: il `close()` è sincrono dentro
      il listener, la navigazione è un effetto che parte dopo, e le due cose non stanno nello stesso
      posto. La seconda è la TV. La terza è che `lib/` non deve conoscere le rotte dell'app.
- [x] **M12-05** — L'hook settabile in `deleteAuction` + l'aggancio in `instrumentation.ts` dentro il
      ramo `nodejs` (§3b). **`lib/engine/setup.ts` non importa `lib/realtime/`**
      → `setAuctionGoneHook` sta in `lib/engine/mutate.ts`, accanto a `setBroadcastHook`: **riusato,
      non somigliato** — stessa forma, stesso `globalThis`, stesso no-op di default. E l'hook fa
      **due** cose, non una: congeda le connessioni **e** cancella il timer. Perché è l'unico posto da
      cui il timer si cancella davvero, vedi M12-06.
- [x] **M12-06** — Il rifiuto su `LIVE`/`PAUSED` resta per tutti; la strada forzata è
      dell'amministratore, con `is_admin` **riletto dentro il lock**. Cancellare il timer armato (§2.3)
      → `deleteAuction(userId, auctionId, { force })`, e `force` vale solo se `actorIsAppAdmin` dice sì
      **dentro la transazione**. Il messaggio del rifiuto adesso dice anche chi può interrompere, che
      è la verifica 4. → **Il timer non si poteva cancellare da `deleteAuction`**, e la spec non lo
      sapeva: `active` è una variabile di modulo di `scheduler.ts`, e di quel modulo esistono due copie
      in due bundle — una `cancelTimer` chiamata da una Server Action girerebbe in quella dove
      `active` è `null`. Passa dalla closure di `instrumentation.ts`, che nasce nel bundle dello
      scheduler. Il `cancelTimer` nuovo è in `scheduler.ts` e non passa da `syncTimer`: non c'è nessuno
      stato da guardare, la riga non esiste più.
- [x] **M12-07** — La conferma che **nomina il numero di collegati** (`connectionCount`) e la riga di
      log che dice quanti sono stati congedati (§4)
      → La conferma ha **tre** forme, non una: plurale, singolare, e «nessuno è collegato». Lo zero
      era il caso da non scrivere come numero — «0 persone verranno riportate alla dashboard» fa
      sembrare una serata interrotta quella che è una prova buttata, ed è il caso più frequente di
      tutti. → **La riga di log si è spostata dopo il commit**, perché il numero dei congedati esiste
      solo dopo il congedo; è anche più onesta di prima, quando registrava una cancellazione che una
      transazione fallita poteva ancora annullare.
- [x] **M12-08** — La vista TV: il messaggio, e nessuna navigazione (§3, ultimo capoverso)
- [x] **M12-09** — Test con Postgres: un'amministratore cancella un'asta `LIVE` e una `PAUSED`;
      **l'owner no**, in entrambi gli stati; le righe di `members`, `players`, `lots`, `bids`,
      `assignments`, `ledger`, `invites`, `events` sono spariste e **le righe di `users` sono ancora
      tutte lì** (è il test che dimostra la frase «solo gli utenti non si cancellano»);
      `player_insights` e `listone_players` intatte; il nome sbagliato non cancella niente; **un
      congedo raggiunge le connessioni aperte** (si asserisce sul registro, non sul browser)
      → 13 test in `tests/db/delete-auction.test.ts`. Su `users` si asserisce **per id, uno per uno**,
      come la spec avvertiva. Due cose sono venute fuori scrivendoli: `bids` **non ha** `auction_id` —
      si arriva solo passando da lotti e round, che è proprio il pezzo di cascata che potrebbe
      rompersi in silenzio — e il `ledger` restava a zero anche prima della cancellazione, quindi
      l'asserzione era vuota: adesso il test scrive una rettifica con `adjustBudget` prima di
      cancellare. → **Il nome sbagliato non è coperto da un test**, e non per dimenticanza: il
      confronto sta nella Server Action, dietro `requireAppAdmin`, che nei test del pannello è un
      finto che interrompe. È codice che M12 non ha toccato, e resta nella verifica a mano (n. 6).
- [x] **M12-10** — Prova a mano, che i test non sostituiscono: **due dispositivi collegati** a una
      simulazione `LIVE` — uno su `/play`, uno su `/tv/` — e la cancellazione mentre guardano. Il primo
      finisce in dashboard con il messaggio, il secondo si ferma con il suo, **e nessuno dei due
      riprova a connettersi** (si guarda la rete, non lo schermo)
      → **Fatta dall'owner il 2026-08-18 con due dispositivi veri: il comportamento atteso è quello
      giusto**, in tutti e tre i punti. → Un inciampo che non c'entra con la macro ma che conviene
      ricordare: `pnpm dev:lan` è morto con `EADDRINUSE` su 3000 perché era rimasto acceso un
      **`next-server`** dal `pnpm build` del gate. È l'orfano descritto in `CLAUDE.md`, e la diagnosi è
      sempre `lsof -nP -iTCP:3000 -sTCP:LISTEN`.
      → Il lato server era già stato verificato prima. Due stream TV aperti con `curl` su un'asta
      simulata `LIVE` usa e getta, cancellazione forzata *dentro il processo dell'app*: entrambi hanno
      ricevuto `event: deleted` con `{"auctionName":"M12 congedo"}` allo stesso secondo e il server ha
      chiuso lo stream — `curl` è uscito subito invece di aspettare il timeout, che è la differenza
      esatta con la riproduzione di M12-02. La riga di log diceva `forced:true, dismissed:2`, e la
      riconnessione risponde 404. **Resta da guardare il pannello di rete di due browser veri**: è
      l'unica cosa che distingue un `close()` che c'è da uno che manca, e la fa l'owner. Procedura in
      `docs/HOWTO-PROVA-LOCALE.md` §9.
- [x] **M12-11** — Gate: `pnpm test`, `pnpm typecheck`, `pnpm build` verdi (⚠ build con `pnpm dev`
      spento)
- [x] **M12-12** — `docs/ARCHITECTURE.md`: il paragrafo su cosa succede a chi guarda un'asta che
      viene cancellata — è il sesto caso di §8bis, e va scritto accanto agli altri cinque.
      `docs/DECISIONS.md`: la regola 5 e perché non è in mezzo (con la citazione del 2026-08-07), il
      congedo via hook invece dell'import diretto, il `close()` prima della navigazione, **la ratifica
      di §5 sulla guardia del deploy**, e le due strade scartate di §6 (terminare un'asta,
      cancellazione morbida)
      → Toccati anche i due punti di `ARCHITECTURE.md` che dicevano «il rifiuto vale per
      l'amministratore come per tutti»: restavano veri a metà, e un documento che si contraddice da
      solo è peggio di uno incompleto. E `HOWTO-PROVA-LOCALE.md` ha una §9 nuova.
- [x] **M12-13** — Chiusura: merge `--no-ff` su `dev`, prova in locale, poi — **solo su richiesta
      esplicita** — `CHANGELOG.md`, `package.json`, merge su `main`, tag `v1.13.0`, push. **Nessun
      `db:push`**; ma il changelog deve dire, con parole semplici, che cancellare un'asta conclusa
      cancella il suo verbale e che prima si fa un backup (§4)
      → Merge su `dev` il 2026-08-17, rilascio `v1.13.0` il 2026-08-18 su richiesta dell'owner dopo la
      prova a due dispositivi. `pnpm db:push` **non serve**, verificato e non dato per scontato:
      `git diff` non tocca `lib/db/schema.ts` e non c'è nessun backfill. **È il primo rilascio da sei
      senza un passo a mano sul server.**

## Verifica

1. `pnpm test`, `pnpm typecheck` e `pnpm build` verdi.
2. ⚠ **Un'asta `LIVE` con due dispositivi collegati viene cancellata, e nessuno dei due resta a
   guardare una schermata ferma**: uno finisce in dashboard con il messaggio, la TV si ferma con il
   suo. È il bug di §2, guardato prima e dopo.
3. **Nessuno dei due client riprova a connettersi** dopo il congedo: si guarda il pannello di rete, non
   lo schermo. È l'unico modo di distinguere un `close()` che c'è da uno che manca.
4. **L'owner non può forzare**, né su `LIVE` né su `PAUSED`, e il messaggio glielo dice.
5. **Un non-amministratore è rifiutato** chiamando l'azione direttamente, e a database non cambia
   niente.
6. **Il nome digitato sbagliato non cancella niente.**
7. **Dopo la cancellazione: zero righe** in `members`, `players`, `lots`, `lot_rounds`, `bids`,
   `assignments`, `ledger`, `invites`, `events` per quell'asta — e **tutte le righe di `users` ancora
   presenti**, bot compresi.
8. **`player_insights`, `listone_players` e l'archivio figurine sono intatti**: sopravvivono alle aste
   di proposito.
9. **Una simulazione in pausa si cancella**, che è il vicolo cieco per cui questa macro esiste — e il
   deploy successivo non ha niente da dire.
10. **La riga di log dice quante connessioni sono state congedate**: è la differenza fra una prova
    buttata e una serata interrotta.

---

## Com'è andata

Scritto il 2026-08-17, a macro chiusa su `dev`. Non è il riassunto di cosa è stato fatto — quello sta
nei task — ma l'elenco di **cosa questa spec aveva sbagliato**, perché è la parte che serve alla
prossima.

**§2.2 aveva ragione sul rimedio e torto sul meccanismo, e la differenza conta.** La spec diceva: «chi
ricarica trova un errore che riprova all'infinito; l'`EventSource` riconnette da sé». Verificato: la
rotta risponde **404 con `Content-Type: application/json`**, e per la specifica di `EventSource` un
non-200 **fa fallire la connessione in modo definitivo** — nessun ritentativo, `readyState` a `CLOSED`.
Il ciclo di tentativi non esisteva. Quello che esisteva era il problema 1, e basta.

Il punto interessante è che il ciclo di tentativi **lo introduce la cura**: chiudere lo stream lato
server significa terminarlo *normalmente*, con 200, e uno stream terminato normalmente è per un browser
il caso in cui riconnettersi. Verificato con `curl`: il congedo esce e la risposta si chiude con 200.
Quindi il `close()` di §3c non è la difesa da un bug che c'era — **è la difesa dal bug che la cura
avrebbe creato senza di lui**. La conclusione operativa non cambia di una riga, e la spec aveva
indovinato la cosa giusta per la ragione sbagliata: se il prossimo lettore ne deduce che un 404 fa
ciclare un `EventSource`, si porterà dietro un modello mentale falso.

**§2.3 chiedeva di cancellare il timer senza sapere che da `deleteAuction` non si può.** «Va comunque
cancellato esplicitamente» è giusto; il modo no. Lo scheduler attivo è una variabile di modulo, e Next
compila `instrumentation.ts` e i route handler in bundle separati: una `cancelTimer` chiamata da una
Server Action non trova nessun timer da cancellare, e — cosa peggiore — **non fallisce**. Sarebbe stata
una riga di codice che non fa niente, con un commento che spiega cosa fa. Il timer si cancella dalla
closure agganciata in `instrumentation.ts`, che è la stessa che congeda le connessioni: per questo
l'hook di §3b ha finito per fare due cose invece di una. È la trappola di CLAUDE.md — «ogni singleton
di processo va su `globalThis`» — incontrata dal lato in cui *non* si può risolvere spostando il
singleton, perché spostare `active` su `globalThis` cambierebbe il comportamento dei timer di tutta
l'asta, e non è quello che questa macro deve fare.

**§4 chiedeva due cose che non potevano stare nello stesso posto.** La riga di log doveva portare il
numero dei congedati, ma il log era *dentro* il lock e il congedo va *dopo* il commit: il numero non
esisteva ancora quando la riga veniva scritta. Si è spostata la riga, non il congedo — ed è venuto
fuori che così è anche più corretta, perché prima registrava una cancellazione che una transazione
fallita poteva ancora annullare.

**Il numero dei collegati nella conferma è vero al render, non al clic.** La pagina del pannello è
dinamica, quindi il numero è fresco quando la si apre, e la conferma dice «in questo momento». Ma se
la pagina resta aperta, quel numero invecchia. Non è stato aggiunto niente per rinfrescarlo — sarebbe
una Server Action in più per una differenza di qualche unità — e la copertura è che **il numero vero lo
dice l'azione dopo**: «3 persone collegate sono state riportate alla dashboard» è contato al congedo, e
quello non può sbagliare.

**Tre forme per la frase, non una.** §4 dava l'esempio con `N` persone. Il caso da scrivere a parte è
**zero**, che è anche il più frequente: una simulazione in pausa che nessuno guarda è esattamente il
motivo per cui questa macro esiste, e «0 persone verranno riportate alla dashboard» la farebbe sembrare
una serata interrotta. E il singolare, perché «1 persone» è il modo più rapido di far vedere che nessuno
ha letto quella frase.

**§3a chiedeva `closeAuctionStreams(auctionId)` e serviva anche il nome.** Il congedo dice «quest'asta
non esiste più», e §3c vuole che la dashboard lo spieghi: senza il nome, chi segue due aste non sa
quale delle due è sparita. Il nome viaggia nell'evento e poi nell'URL — non è stato di gioco, lo
vedono già tutti, TV compresa, quindi I8 non è sfiorata.

**Due cose sul test, e una non si può fare.** `bids` **non ha** `auction_id`: si arriva solo passando
per lotti e round, ed è lì che una cascata si romperebbe in silenzio, quindi il test conta seguendo la
catena. Il `ledger`, invece, era vuoto anche *prima* della cancellazione: l'asserzione «zero righe
dopo» era vera senza dimostrare niente, e ora il test scrive una rettifica prima di cancellare. La
cosa che non si può fare è la verifica 6: il confronto del nome digitato sta nella Server Action,
dietro `requireAppAdmin`, che nei test del pannello è un finto che interrompe — e non vale la pena
estrarre un confronto di due stringhe per poterlo chiamare da un test. Resta una verifica a mano, come
era.

**Quello che la spec aveva previsto giusto, e vale dirlo.** Che la macro fosse «una riga di condizione
più tutto il resto» è esatto: il rifiuto è diventato una condizione con un `force`, e il resto —
congedo, hook, ordine del `close()`, tre forme della conferma, il timer — è il novanta per cento del
lavoro. Che le cascate esistessero per intero è esatto: **nessun `pnpm db:push`, nessun backfill**, e
`users` non si tocca per direzione delle chiavi, senza bisogno di nessuna guardia. E il consiglio di
riprodurre il bug prima di curarlo si è pagato da solo: è così che si è scoperto che il `: ping` è la
ragione per cui il guasto sembrava lentezza, ed è così che è venuta fuori la correzione a §2.2.
