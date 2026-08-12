# M12 — Cancellare un'asta per forza

> **Stato:** **da aprire** su `feature/12-cancellazione-aste` · Pianificata il 2026-08-12 ·
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

- [ ] **M12-01** — Aprire `feature/12-cancellazione-aste` da `dev`; rileggere questo file, e in
      particolare §2: i tre comportamenti sono stati letti nel codice, non ipotizzati, e sono la
      ragione per cui la macro non è «una riga»
- [ ] **M12-02** — Riprodurre §2 **prima di scrivere il rimedio**: un'asta simulata `LIVE`, un browser
      collegato, `DELETE` a mano da `psql`, e guardare il portale restare fermo con i ping che
      arrivano. È il bug che questa macro esiste per non lasciare in piedi, e va visto una volta
- [ ] **M12-03** — `lib/realtime/broadcast.ts`: il campo del congedo in `Subscriber` e
      `closeAuctionStreams(auctionId)` (§3a). La voce della mappa va svuotata
- [ ] **M12-04** — La rotta dello stream manda l'evento terminale e chiude il controller; il client
      (`use-auction-stream.ts`) fa **`close()` e poi naviga** (§3c). ⚠ L'ordine è il punto: senza il
      `close()` l'`EventSource` riconnette da sé
- [ ] **M12-05** — L'hook settabile in `deleteAuction` + l'aggancio in `instrumentation.ts` dentro il
      ramo `nodejs` (§3b). **`lib/engine/setup.ts` non importa `lib/realtime/`**
- [ ] **M12-06** — Il rifiuto su `LIVE`/`PAUSED` resta per tutti; la strada forzata è
      dell'amministratore, con `is_admin` **riletto dentro il lock**. Cancellare il timer armato (§2.3)
- [ ] **M12-07** — La conferma che **nomina il numero di collegati** (`connectionCount`) e la riga di
      log che dice quanti sono stati congedati (§4)
- [ ] **M12-08** — La vista TV: il messaggio, e nessuna navigazione (§3, ultimo capoverso)
- [ ] **M12-09** — Test con Postgres: un'amministratore cancella un'asta `LIVE` e una `PAUSED`;
      **l'owner no**, in entrambi gli stati; le righe di `members`, `players`, `lots`, `bids`,
      `assignments`, `ledger`, `invites`, `events` sono spariste e **le righe di `users` sono ancora
      tutte lì** (è il test che dimostra la frase «solo gli utenti non si cancellano»);
      `player_insights` e `listone_players` intatte; il nome sbagliato non cancella niente; **un
      congedo raggiunge le connessioni aperte** (si asserisce sul registro, non sul browser)
- [ ] **M12-10** — Prova a mano, che i test non sostituiscono: **due dispositivi collegati** a una
      simulazione `LIVE` — uno su `/play`, uno su `/tv/` — e la cancellazione mentre guardano. Il primo
      finisce in dashboard con il messaggio, il secondo si ferma con il suo, **e nessuno dei due
      riprova a connettersi** (si guarda la rete, non lo schermo)
- [ ] **M12-11** — Gate: `pnpm test`, `pnpm typecheck`, `pnpm build` verdi (⚠ build con `pnpm dev`
      spento)
- [ ] **M12-12** — `docs/ARCHITECTURE.md`: il paragrafo su cosa succede a chi guarda un'asta che
      viene cancellata — è il sesto caso di §8bis, e va scritto accanto agli altri cinque.
      `docs/DECISIONS.md`: la regola 5 e perché non è in mezzo (con la citazione del 2026-08-07), il
      congedo via hook invece dell'import diretto, il `close()` prima della navigazione, **la ratifica
      di §5 sulla guardia del deploy**, e le due strade scartate di §6 (terminare un'asta,
      cancellazione morbida)
- [ ] **M12-13** — Chiusura: merge `--no-ff` su `dev`, prova in locale, poi — **solo su richiesta
      esplicita** — `CHANGELOG.md`, `package.json`, merge su `main`, tag `v1.13.0`, push. **Nessun
      `db:push`**; ma il changelog deve dire, con parole semplici, che cancellare un'asta conclusa
      cancella il suo verbale e che prima si fa un backup (§4)

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
