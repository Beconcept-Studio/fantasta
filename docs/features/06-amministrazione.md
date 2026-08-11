# M6 — Amministrazione: il pannello

> **Stato:** **chiusa** — **v1.7.0 in produzione il 2026-08-11**, verificata da fuori (`/signin`
> risponde `1.7.0`, e le tre rotte di `/admin` rispondono `307` verso `/signin` a un anonimo).
> Pianificata il 2026-08-10, aperta e chiusa il 2026-08-11 · **Dipendeva da M5** (v1.6.0)
> **Tocca lo schema del database?** **No.** `email_verified_at` arriva da M5 e al pannello non serve
> nient'altro: **nessun `pnpm db:push` a mano sul server** dopo il deploy. È una macro di sola UI,
> query e autorizzazioni, cioè il profilo di rischio più basso che potesse avere.
>
> **Invarianti coinvolti:** **I8**, che qui si rispetta per assenza e non per attenzione (§3).
> **Regole coinvolte:** 3, 5, 8.
>
> ⚠ Si apre **su richiesta esplicita dell'owner**, come tutte. Questo file è la spec concordata, non
> un via libera: i task possono essere rifiniti quando la macro si apre davvero, perché nel frattempo
> M5 avrà insegnato qualcosa.

## Obiettivo

`users.is_admin` esiste dall'inizio del progetto. M4 gli ha dato il primo significato — creare aste
simulate e riempirle di bot — e nient'altro. Non esiste nessun posto da cui guardare chi è iscritto,
nessun modo di correggere un nome scritto male, e nessun modo di cancellare l'asta di qualcun altro:
oggi la si cancella solo dalla propria configurazione, e solo se è la propria.

Questa macro costruisce il posto da cui si guarda l'applicazione dall'alto. Ed è la macro che **chiude
la finestra aperta da M5**: la verifica manuale dell'email, che in M5 è una `UPDATE` copiata a mano
sul server, qui diventa un pulsante.

Il tema, detto in una riga: *un pannello che vede tutto e tocca il meno possibile.*

## Richieste che ci confluiscono

Tolta da `docs/REQUESTS.md` il 2026-08-10, insieme a quella di M5 — il quaderno resta vuoto.

- **Pannello di controllo super admin.** «Gli utenti super admin (con is_admin flaggato) devono poter
  vedere in navbar un bottone "Admin" che porta alla parte di amministrazione dell'app. Al momento mi
  interessa vedere da questa nuova sezione la lista degli utenti, e poterli gestire (cambio info,
  status, verifica manuale della email, le solite cose). Valutare quando si mette un utente in stop
  (quindi non può fare login), di mettere in pausa tutte le sue aste. Un'altra sezione che voglio
  vedere è la lista delle aste, con dato di chi l'ha creata (email) e possibilità di cancellarla da
  Database, cancellando tutto ciò che è collegato (non l'utente chiaramente). Prevedi quindi una
  navigazione ad hoc per questo pannello. Puoi inserire una sidebar apposita.»

Due cose della richiesta sono state decise in fase di spec e non entrano.

**Lo «status» e lo stop degli utenti restano fuori** (§6). Il quaderno diceva «valutare», la
valutazione è stata fatta, e l'owner ha deciso di rimandarla: «per il momento non implementiamo nulla,
lo vedremo più avanti». Quindi nessuna colonna `suspended_at`, nessun gradino in più nel login,
nessun pulsante. §6 conserva il ragionamento, perché quando la richiesta tornerà il ragionamento
servirà.

**«Super admin» e `is_admin` sono la stessa cosa**, un flag solo. Un secondo livello di
amministrazione su due persone è una gerarchia senza nessuno da gerarchizzare. Si chiama come lo
chiama già `lib/domain.ts`: **amministratore dell'applicazione**, `isAppAdmin()`.

---

## Spec

### 1. Il perimetro, che è la parte importante

Il pannello gira **sulla stessa macchina e nello stesso processo dell'asta vera**. Quindi la domanda
da cui parte questa spec non è «cosa può fare un admin», è cosa **non** può fare mentre dodici
persone stanno offrendo.

**Il pannello non ha nessuna azione sull'asta tranne la cancellazione.** Niente pausa, niente avvio,
niente override, niente riassegnazione, niente rettifiche di budget. La plancia di comando dell'asta
è la regia e resta dell'owner: un secondo posto da cui si comanda la stessa asta sono **due verità
sullo stesso stato**, che è il modo in cui questa applicazione si romperebbe peggio — e sarebbe anche
un secondo posto in cui ricordarsi le regole sulle fasi.

**La cancellazione non allenta il rifiuto che c'è già.** `deleteAuction` dice no su `LIVE` e `PAUSED`,
e continua a dirlo **anche all'amministratore**: la pausa congela la fase, non azzera l'asta, e non si
cancella qualcosa mentre dodici persone ci stanno dentro.

### 2. `deleteAuction` si allarga di una riga

La funzione esiste da M4 e **non si riscrive**: si allarga l'autorizzazione da `requireOwner` a «owner
**oppure** amministratore dell'applicazione», e nient'altro.

Era già fatta per questo, e vale la pena notarlo perché è raro: la riga su stdout registra
`actor: userId`, quindi una cancellazione fatta da un admin è tracciata dal giorno in cui quella riga
è stata scritta, senza aggiungere niente. È anche l'unica traccia che sopravvive — `events` se ne va
con l'asta.

Resta tutto il resto: il `DELETE` sulla riga di `auctions` porta via rose, storico, buste, ledger ed
eventi per `onDelete: "cascade"`, **l'utente no** (nessuna tabella di `users` dipende da un'asta), e
la conferma **si scrive digitando il nome**, non con un `confirm()` che si clicca per riflesso.

⚠ **Va detto ad alta voce nella UI, non solo qui**: cancellare un'asta reale completata porta via il
verbale delle rose e lo storico che M3 ha costruito. Dal pannello si cancellano le aste *degli altri*,
cioè quelle di cui non si conosce il valore affettivo: il pannello è il posto in cui questo avviso
serve **più** che nella configurazione.

### 3. Le aste: nessuno stato di gioco

La lista mostra nome, owner con la sua email, stato, posti, numero di membri, il marchio
`[simulazione]`, le date. E si ferma lì: **non i lotti, non le offerte, non le rose**.

⚠ Non è pigrizia, è come si rispetta **I8**. Nessun importo di offerta lascia il server mentre
`phase = LOT_OPEN`: il modo fragile di onorarlo è mostrare lo stato di gioco sanificandolo con
attenzione; il modo solido è **non avere niente da sanificare**. E resta intatta la regola 3 — lo
stato dell'asta esce solo da `serializeSnapshot`, e da qui non esce affatto.

Chi vuole vedere un'asta la apre da dove si aprono le aste. Il pannello dà il link e non duplica la
vista.

### 4. Gli utenti

Lista con: email, nome, **come entra** (Google / password / entrambi), verificato, amministratore,
data di iscrizione. Numero di aste possedute e giocate, che è l'informazione con cui si decide se una
riga è una persona o un residuo.

**I bot stanno nascosti dietro un filtro**, non in lista. Sette righe «Bot 3» per ogni asta simulata
rendono la lista inutile, ed è l'unico modo in cui una lista di dodici amici può diventare illeggibile.

Si può fare tre cose, e sono tre:

| Azione | Note |
|---|---|
| Correggere `display_name` | È testo, ed è l'unico modo di sistemare l'«asdf» scritto da un amico nell'onboarding |
| **Forzare la verifica dell'email** | È il pulsante che chiude la finestra di M5 §9 |
| Dare o togliere `is_admin` | ⚠ **Mai la propria**: un click e ci chiudiamo fuori tutti. Su un bot lo rifiuta già il `CHECK` a database, e la UI non lo offre |

⚠ **L'email è in sola lettura.** Da M5 è la chiave d'identità: cambiarla cambia *chi può entrare* in
quell'account. Un indirizzo sbagliato si risolve rifacendo l'account, che a dodici utenti è
perfettamente praticabile — e un admin che riscrive l'indirizzo di qualcun altro è un potere che
questa applicazione non ha motivo di avere.

### 5. La navigazione, e la guardia

**La sidebar esce da `lib/admin-nav.ts`**, costruito sul modello di `lib/auction-nav.ts`: zero
dipendenze, e **etichetta, titolo e segmento di URL dalla stessa riga**. È il rimedio a un bug vero,
raccontato in testa a quel file: prima di M2 ogni pagina si scriveva i link a mano, e una voce
puntava alla pagina sbagliata. Due sezioni, `Utenti` e `Aste`, sotto `/admin`.

**Il pannello è roba da scrivania**, e va detto invece che accadere per caso: tabelle dense, sidebar
laterale, nessuna ottimizzazione per il pollice. Il mobile-first è del portale del partecipante — si
offre dal telefono sotto pressione — e resta suo. Il pannello si apre da un portatile, con calma.

⚠ **La guardia sta in cima a ogni pagina e a ogni server action, non solo nel layout.** Un layout non
protegge le server action: quelle sono endpoint raggiungibili per conto proprio, e un pannello
protetto solo dal layout è un pannello aperto. `requireAppAdmin()` in ognuna; nel layout anche, per
avere un redirect pulito invece di un errore.

**Il pulsante «Admin» in navbar** compare solo a chi è `isAppAdmin()`. La navbar riceve già un utente:
prende un booleano in più, non importa `lib/db` e non diventa un menù (regola 8 — è ancora una barra
con tre cose dentro).

**Le query dell'admin stanno in `lib/engine/admin.ts`**, perché toccano `lib/db` e la regola ESLint
non ammette eccezioni discrezionali. I nomi restano in `lib/domain.ts`.

### 6. Lo stop degli utenti: il ragionamento, conservato

Non si implementa. Ma la valutazione che il quaderno chiedeva è stata fatta, e buttarla via
significherebbe rifarla da zero quando la richiesta torna.

**Il punto di partenza.** La sessione è un JWT, non una riga a database (P17): «non può fare login»
non vuol dire «è fuori adesso» — chi ha un token in tasca continua a navigare finché non scade. Il
rimedio sarebbe gratis, perché `currentUser()` rilegge già la riga a ogni richiesta: lo stop
diventerebbe un gradino in più in `requireUser()`, controllato su ogni pagina e non al login.

**Il che sposta il problema.** Lo stop non serve a fermare l'owner, che a quel punto è già fermo:
serve perché **l'asta va avanti da sola senza di lui**. Lo scheduler fa scadere le fasi, l'auto-pick
chiama i giocatori, e un'asta senza conduttore si concluderebbe tranquillamente.

**La conclusione a cui si era arrivati**, se un giorno si riprende: *rifiutare* lo stop di chi è
dentro un'asta `LIVE` o `PAUSED` — come owner **o** come membro — invece di mettere in pausa a
cascata. Quattro ragioni. È il precedente che la codebase ha già scelto tre volte (`deleteAuction`,
gli override con un lotto in contesa, il deploy che non parte). La cascata **non ha una storia
transazionale**: N aste sono N `withAuctionLock` separati — non si tiene un lock e se ne prende un
altro senza inventarsi un ordinamento contro il deadlock — più l'`UPDATE` sull'utente, e il caso «due
aste in pausa su tre e poi ho fallito» esiste senza una risposta buona. Congelare una stanza con
dodici persone dentro deve essere un atto rivolto *a quell'asta*, mai l'effetto collaterale di un
click su una riga in una lista di utenti. E il rifiuto esteso ai membri chiude un buco simmetrico:
un'azione su una persona non deve degradare l'asta di un'altra.

Le aste in `DRAFT` o `READY` di un utente in stop non richiederebbero niente: restano lì e non possono
partire, perché l'unico che potrebbe avviarle non entra più. Inerti per costruzione.

Se si riprende, il nome è **`users.suspended_at`** (timestamptz, `null` = attivo): è lo stile di casa
— `voided_at`, `paused_at`, `completed_at` — e registra *quando*, che un booleano perde.

### 7. Cosa non cambia

Il motore, la macchina a stati, `serializeSnapshot`, lo stream, le rotte di gioco, i timer, la regia,
il portale, la vista TV. Lo schema. `deleteAuction` cambia di una riga e nient'altro.

### 8. Cosa non entra (regola 8)

Niente stop o sospensione (§6) · niente modifica dell'email (§4) · niente secondo livello di
amministrazione · niente azioni sull'asta oltre la cancellazione (§1) · niente vista dello stato di
gioco (§3) · niente log di audit delle azioni dell'admin: le tre azioni di §4 sono correzioni di
dati, e la sola distruttiva — la cancellazione — scrive già su stdout · niente ricerca full-text,
paginazione o esportazioni: con dodici utenti e una decina di aste, una tabella ordinata è la cosa
giusta, e la paginazione si aggiunge quando una lista non ci sta in una schermata.

---

## Task

> Da rifinire all'apertura della macro. Sono la traduzione della spec, non un impegno preso in questa
> sessione.

- [x] **M6-01** — Aprire `feature/06-amministrazione` da `dev`; rileggere questo file **e** verificare
      cosa M5 ha lasciato in piedi (in particolare la `UPDATE` d'emergenza di M5 §9, che questa macro
      sostituisce)
- [x] **M6-02** — `lib/admin-nav.ts` sul modello di `auction-nav.ts`: due sezioni, etichetta, titolo e
      segmento dalla stessa riga, zero dipendenze; il suo test come `tests/auction-nav.test.ts`
- [x] **M6-03** — `requireAppAdmin()` accanto a `requireUser()`; il layout `/admin` con la sidebar; il
      pulsante «Admin» in navbar per chi è `isAppAdmin()`
- [x] **M6-04** — `lib/engine/admin.ts`: la lista utenti (con «come entra», i conteggi delle aste, i
      bot filtrati) e la lista aste (owner, email, stato, membri, date — **nessuno stato di gioco**)
- [x] **M6-05** — Le tre azioni sull'utente: `display_name`, verifica forzata, `is_admin` con il
      divieto sulla propria. Ognuna con la guardia in cima alla server action
- [x] **M6-06** — `deleteAuction`: `requireOwner` → owner **oppure** amministratore, e nient'altro; la
      cancellazione dal pannello con il nome da digitare e l'avviso su cosa porta via
- [x] **M6-07** — Le due pagine, da scrivania: tabelle dense, niente ottimizzazioni per il pollice
- [x] **M6-08** — Test: `admin-nav` puro; con Postgres — un non-admin è rifiutato **su ogni server
      action** e non solo dal layout, `is_admin` non si toglie a sé stessi, la verifica forzata
      scrive `email_verified_at`, `deleteAuction` da parte di un admin funziona **ma resta rifiutata
      su `LIVE`/`PAUSED`**, la lista aste non contiene nessun importo
- [x] **M6-09** — Gate: `pnpm test`, `pnpm typecheck`, `pnpm build` verdi (⚠ build con `pnpm dev`
      spento)
- [x] **M6-10** — `docs/ARCHITECTURE.md`: il capitolo sul pannello, scritto attorno al perimetro (cosa
      **non** può fare) più che attorno alle schermate. `docs/DECISIONS.md`: **lo scostamento da PLAN
      §2**, che diceva admin «sola lettura», e lo stop rimandato con il suo perché
      · anche `docs/features/README.md` (indice) e `docs/HOWTO-PROVA-LOCALE.md` (come si prova il
      pannello, e la riga non verificata che il seed non fa)
- [x] **M6-11** — Chiusura: merge `--no-ff` su `dev`, prova in locale, poi — **solo su richiesta
      dell'owner** — `CHANGELOG.md`, `package.json`, merge `--no-ff` su `main`, tag, push.
      **Nessun `db:push` sul server**: questa macro non tocca lo schema

## Com'è andata

Le nove verifiche sono passate: le prime otto in locale — il gate, la guardia, il divieto sulla
propria riga, la lista senza importi, la cancellazione — e la nona provata dall'owner su più aste.
Tre cose vale la pena portarsi dietro.

**La guardia è stata scritta prima delle azioni e vista fallire due volte**: la prima perché il modulo
non c'era, la seconda togliendo `requireAppAdmin()` a un'azione a mano. Il secondo fallimento ha detto
una cosa in più di quanto chiedesse: **senza la guardia dell'azione il rifiuto è arrivato comunque dal
motore**, che rilegge `is_admin` dal database. I due piani si coprono a vicenda per davvero, e non
soltanto sulla carta.

**Il test I8 è stato messo alla prova aggiungendo un `topBid` finto** alla riga della lista aste, per
vedere se l'insieme esatto delle chiavi lo notava. L'ha notato. Un test di assenza che non si è mai
visto fallire non è un test di assenza.

**Due funzioni sono salite di livello, e in entrambi i casi perché il secondo chiamante è arrivato
davvero** (regola 8): `normalizeDisplayName` in `lib/domain.ts` — pannello e onboarding devono
accettare la stessa cosa — e il parametro di `isVerified`, ora strutturale come quello di
`isAppAdmin`, così una riga del pannello può chiedere «è verificato?» senza importare un tipo da
`lib/db`.

Una cosa **non** prevista dalla spec è emersa e sta in `docs/DECISIONS.md`: forzare la verifica di un
indirizzo **spegne, per quella riga, la difesa di M5** che azzera `password_hash` quando Google si
aggancia a un account non verificato. Non è un difetto del pulsante — è cosa vuol dire premerlo: si
mette la propria parola al posto della prova, e si fa per una persona che si ha davanti.

Fuori spec, una riga di manutenzione: `docs/HOWTO-PROVA-LOCALE.md` spiega come si tolgono i residui
dei test dal database locale. Se ne erano accumulati venti — non per un difetto dei test, che una
passata completa li pulisce da sé, ma per i run interrotti a metà: nessuno se ne accorgeva finché non
è esistita una lista utenti da guardare.

## Verifica

1. `pnpm test`, `pnpm typecheck` e `pnpm build` verdi.
2. **Un utente non amministratore non vede il pulsante «Admin»**, e `/admin` gli risponde con un
   redirect — non con una pagina vuota.
3. ⚠ **Ogni server action del pannello rifiuta un non-admin**, chiamata direttamente e non dalla
   pagina. È il test che distingue un pannello protetto da un pannello nascosto.
4. **Non si può togliere `is_admin` a sé stessi**, e il tentativo lo dice invece di fallire in silenzio.
5. **La verifica forzata fa entrare davvero**: un account non verificato, dopo il pulsante, passa la
   scala di `requireUser()` e arriva all'onboarding.
6. **La lista aste non contiene nessun importo**, nemmeno per un'asta in `LOT_OPEN` con delle offerte
   dentro. Si guarda la risposta, non la pagina.
7. **La cancellazione dal pannello**: rifiutata su `LIVE` e `PAUSED` anche per l'admin; con il nome
   digitato porta via l'asta di un altro utente e tutto ciò che le appartiene, **e non l'utente**; la
   riga su stdout riporta l'admin come `actor`.
8. **La sidebar**: il titolo in cima alla pagina e la voce da cui ci si è arrivati dicono la stessa
   cosa, perché sono la stessa riga.
9. **Un'asta si gioca ancora**: una simulazione a 8 con 7 bot arriva a `COMPLETED` con il pannello
   aperto in un'altra scheda.
