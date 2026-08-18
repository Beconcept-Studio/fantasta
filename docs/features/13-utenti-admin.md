# M13 — La pagina utenti: una tabella che si legge, un modale che modifica

> **Stato:** **pianificata** il 2026-08-18, **non aperta**. Si apre **su richiesta esplicita
> dell'owner**, come tutte · **Indipendente da M14**: le due macro non si sfiorano, e questa sta prima
> per profilo di rischio — è tutta UI dentro il pannello, non tocca il motore, non tocca lo schema, e
> un suo errore non può rovinare una serata.
>
> **Tocca lo schema del database?** **No.** Nessuna tabella, nessuna colonna, **nessun `pnpm db:push`
> e nessun backfill**: le quattro azioni che il modale offrirà esistono già tutte in
> `lib/engine/admin.ts`, con le loro guardie. Questa macro **non aggiunge nessun potere** — decisione
> dell'owner del 2026-08-18 — le sposta di posto.
>
> **Invarianti coinvolti:** **nessuno di I1–I10, e va detto perché non è una fortuna.** Dal pannello
> non esce un solo bit di stato di gioco (M6, «il perimetro»): non ci sono lotti, non ci sono offerte,
> non ci sono rose, quindi **I8 non ha niente da sanificare** e la regola 3 resta intatta — lo stato
> dell'asta esce solo da `serializeSnapshot`, e da qui non esce affatto. **Regole coinvolte:** **6**
> (la tabella diventa in sola lettura e il modale disabilita, ma le quattro funzioni del motore
> continuano a rileggere `is_admin` dal database: la UI non autorizza niente), **8** (nessuna
> primitiva nuova in `components/ui/` finché non c'è il secondo chiamante generico — §5).
>
> ⚠ **Ribalta una decisione scritta di M6**, e non di sfuggita: M6 §8 elenca fra le cose escluse
> *«niente ricerca full-text, paginazione o esportazioni: con dodici utenti e una decina di aste, una
> tabella ordinata è la cosa giusta, e la paginazione si aggiunge quando una lista non ci sta in una
> schermata»*. La ricerca adesso la chiede l'owner. **La paginazione resta fuori** (§4): le due cose
> erano nella stessa riga ma non sono la stessa decisione, e distinguerle è metà del lavoro di §4.
> Va in `DECISIONS.md` come ratifica datata, con il rimando alla voce di M6.

## Obiettivo

La pagina utenti di M6 è una tabella che **si compila**, non una che si legge. Otto colonne, e in
quattro di esse c'è un form: un campo di testo con il suo «Salva», un pulsante «Verifica a mano», un
pulsante «Rendi admin», un pulsante «Dai insight». Ogni riga monta **quattro `useActionState`** e
tiene uno stato client suo per il nome; la tabella è larga `min-w-240` e su qualunque schermo scorre
in orizzontale, perché ogni cella deve contenere un comando invece di un dato.

Il risultato è che la domanda più frequente — *chi è questa persona, e le manca qualcosa per
entrare?* — si risponde peggio della domanda più rara, che è *cambiamo qualcosa a questa persona*.

Questa macro separa le due. **La tabella diventa un elenco**: sei colonne, dati e nient'altro, con
una ricerca in testa. **Le modifiche vanno in un pannello laterale** che si apre da «Vedi», mostra
tutto — anche ciò che in tabella non ci sta — e si chiude quando hai salvato.

Il tema, detto in una riga: *la tabella risponde, il modale interviene.*

## Richieste che ci confluiscono

Tolta da `docs/REQUESTS.md` il 2026-08-18.

- **Admin – Refactor pagina utenti.** «Voglio migliorare la tabella. Per ogni utente voglio vedere in
  tabella: Email · Nome · Email verificata: Si/No · Admin: Si/No · Pro: Si/No · BTN "Vedi". Tutti i
  dati devono avere il giusto spazio per essere visualizzati. I dati in tabella sono in sola
  visualizzazione. Nel head della tabella voglio anche una input per cercare l'utente per nome o
  email. Il BTN "Vedi" apre un side modal con il recap di tutte le informazioni (anche quelle non
  mostrate in tabella), e la possibilità di modificare i dati. Tutti i flag si/no devono essere dei
  switch On/off (<https://ui.shadcn.com/docs/components/base/switch>). In quel modal una volta salvate
  le info si chiude il modal e si aggiorna la tabella.»

**Era in `docs/REQUESTS.md` dal 2026-08-12** e non è entrata in nessuna delle quattro macro
pianificate quel giorno: l'indice lo dice per esteso («sarà una macro sua quando la chiederà»). È
questa.

**Decisione dell'owner del 2026-08-18:** il modale **non porta poteri nuovi**. Le quattro azioni sono
quelle che esistono — nome, verifica dell'indirizzo, `is_admin`, `is_pro` — e l'email resta in sola
lettura. Niente cancellazione di un utente, niente reset della password da parte di un
amministratore. §6 dice perché entrambe sarebbero state più costose di quanto sembrano.

---

## Spec

### 1. Cosa esiste già — e quindi cos'è davvero questa macro

Non è un'analisi da fare all'apertura: è stato letto il 2026-08-18.

| | Dove | Stato |
|---|---|---|
| Otto colonne, tabella densa da scrivania | `app/admin/users/page.tsx` | Fatta (M6) |
| Il filtro «mostra anche i bot», via `searchParam` | `app/admin/users/page.tsx` | Fatta (M6) |
| Quattro form per riga, con quattro esiti separati | `components/admin/user-row.tsx` | **È ciò che questa macro smonta** |
| `setUserDisplayName` · `forceVerifyEmail` · `setUserAdmin` · `setUserPro` | `lib/engine/admin.ts` | Fatte (M6, M8) — **non si toccano** |
| Le quattro Server Action, con `requireAppAdmin()` in prima riga | `app/admin/actions.ts` | Fatte — §5 ne aggiunge **una** |
| `is_admin` riletto dal database a ogni mutazione | `lib/engine/admin.ts` | Fatta (M6) |
| La ricerca | — | **Non c'è, ed era esclusa per iscritto** (§4) |
| Un modale laterale | — | **Non c'è nessun modale nel pannello** (§5) |

Quindi il cuore della macro è **spostare quattro form da trentadue celle a un pannello solo**, e le
due cose nuove sono la ricerca e il modale. Il motore non si apre nemmeno per guardare: se durante
questa macro qualcuno si trova a modificare `lib/engine/admin.ts`, è il momento di fermarsi e
chiedersi cosa è andato storto.

### 2. Le sei colonne, e le tre che se ne vanno

| Colonna | Cosa contiene | Da dove viene |
|---|---|---|
| Email | L'indirizzo, in `font-mono`, o `—` | `users.email` |
| Nome | `display_name`, o `—` | `users.display_name` |
| Email verificata | **Sì / No** | `isVerified(user)`, cioè la stessa condizione che interroga `requireUser()` |
| Admin | **Sì / No** | `users.is_admin` |
| Pro | **Sì / No** | `users.is_pro` |
| | **«Vedi»** | apre il pannello di §5 |

**Se ne vanno dalla tabella, e vanno nel modale**: «Come entra» (Google / password / entrambi),
«Aste» (possedute / giocate), «Iscritto». Non sparisce niente — sono le «informazioni non mostrate in
tabella» che la richiesta vuole nel recap.

⚠ **«Tutti i dati devono avere il giusto spazio» è la conseguenza, non un requisito a parte.** Oggi
la tabella non respira perché ogni cella ospita un comando: `min-w-240` più un contenitore che scorre
in orizzontale sono lì per far stare quattro form. Con tre celle che contengono la parola «Sì» quella
larghezza minima **va rimessa in discussione** — probabilmente sparisce, e con lei lo scorrimento
orizzontale. Va **guardato**, non dedotto: la colonna dell'email è lunga e imprevedibile, ed è l'unica
che può ancora costringere allo scorrimento.

⚠ **«I dati in tabella sono in sola visualizzazione» è il vero cambio di forma**, e ha una
conseguenza che vale la pena scrivere: `UserRow` smette di essere un client component con quattro
`useActionState` e diventa **una riga**. Con dodici righe erano quarantotto stati di form montati per
guardare una lista. Se la riga può tornare a essere un componente server, ci torni.

**Il filtro dei bot resta com'è**, `searchParam` compresa. La ragione di M6 non è cambiata di una
virgola: sette righe «Bot 3» per ogni asta simulata rendono la lista inutile, e un filtro che vive
nell'indirizzo è un indirizzo che si può tenere aperto.

### 3. Come si scrive un booleano in una tabella che si legge di colpo

Tre colonne su sei sono `Sì`/`No`, e in una tabella scandita con l'occhio sono la parte che decide se
la pagina serve.

**La parola, sempre.** Non un pallino, non un'icona, non un colore da solo: è la regola generale di
M9 §2 — *«il colore non è mai l'unica informazione»* — e qui vale ancora di più, perché non c'è
nessun numero accanto che possa fare da appoggio.

⚠ **Una sola delle tre celle merita di essere vista da lontano, e non è un vezzo grafico: è l'ordine
della lista.** M6 ordina per `created_at DESC` con una motivazione precisa — *«la riga su cui un
amministratore deve agire è quasi sempre quella di chi si è appena iscritto e non riesce a
entrare»*. Quella riga si riconosce da **«Email verificata: No»**, e in quel caso il `No` è l'unico
valore della tabella che chiede un intervento: prende un trattamento che si nota (il tono
`destructive` che l'applicazione usa già), mentre `Admin: No` e `Pro: No` sono il caso normale e
restano testo normale. Il criterio, scritto perché non venga esteso per simmetria: **si evidenzia ciò
su cui si deve agire, non ciò che è raro.**

**Niente switch in tabella.** La richiesta dice due cose che insieme la escludono — «i dati in
tabella sono in sola visualizzazione» e «i flag si/no devono essere degli switch» nel modale — e la
ragione sta in M6: *«un input grigio suggerisce che da qualche parte esista il modo di
abilitarlo»*. Uno switch spento in tabella è precisamente quello.

### 4. La ricerca in testa, e la paginazione che resta fuori

**Cosa fa:** filtra per **nome o email**, tollerante ad accenti e maiuscole.

⚠ **Riusa `fold()` di `lib/realtime/portal.ts`, e non è un dettaglio di implementazione.** Quella
funzione è già la ricerca della lista di chiamata e quella della regia, e il commento sul suo secondo
chiamante dice perché: *«due ricerche che rispondono diversamente a «citta» sarebbero una piccola
bugia difficile da spiegare»*. Questo è il terzo chiamante, e la stessa frase vale su un cognome
accentato. Il modulo non importa `lib/db` — sono tipi e funzioni pure — quindi un componente del
pannello lo può importare senza toccare la regola ESLint.

**Dove sta:** nell'intestazione della tabella, come chiede la richiesta.

**Come filtra: sul client, sulle righe già in pagina.** Non una `searchParam`, non una query nuova,
nessun round trip. La pagina carica già **tutti** gli utenti (`listAdminUsers`), quindi cercare
significa nascondere righe che sono già arrivate: la risposta è immediata mentre si digita, che è
l'unico comportamento accettabile per un campo di ricerca. La differenza con il filtro dei bot — che
invece è nell'indirizzo — è che quello cambia **quali righe il server manda**, questo no.

⚠ **Il conteggio in cima deve seguire il filtro.** Oggi dice «N righe» e sarebbe la prima cosa a
mentire: con una ricerca attiva deve dire quante righe si stanno vedendo e su quante. E **zero
risultati va detto a parole** — una tabella con la sola intestazione sembra un guasto.

**La paginazione resta fuori, e non per pigrizia.** M6 aveva messo ricerca e paginazione nella stessa
riga di esclusioni; sono due cose diverse. La ricerca sopra è un filtro su righe già caricate: non
cambia nessuna query, non introduce nessuno stato nell'indirizzo, non ha un «pagina 2» in cui una
riga può nascondersi. La paginazione cambia il contratto della pagina — e nel momento in cui esiste,
**la ricerca lato client diventa una bugia**, perché cercherebbe solo dentro la pagina corrente.
Quel giorno arrivano insieme, ricerca lato server compresa.

⚠ **E c'è una misura che da qui non si può fare, e va fatta all'apertura della macro: quanti utenti
ci sono in produzione.** Se sono dodici, questa ricerca è una comodità; se sono sessanta, «niente
paginazione» va riguardato invece di essere ereditato. Il numero si legge in un secondo dalla pagina
stessa, ed è il primo task.

### 5. Il pannello laterale

**Cosa mostra:** tutto. Le tre colonne che se ne sono andate dalla tabella (§2), più ciò che il
modale è il primo posto ad avere spazio per dire: **quando** l'indirizzo è stato verificato, non solo
se; e se la riga è un bot, che spiega da sé perché metà dei comandi non c'è.

**Cosa modifica:** le quattro cose che si modificano già, e nient'altro (decisione dell'owner).

| Campo | Comando | Vincoli che restano quelli del motore |
|---|---|---|
| Email | **niente**, è testo | Da M5 è la chiave d'identità: cambiarla cambia *chi entra* in quell'account. La riga di spiegazione che oggi sta sotto la tabella si sposta qui, accanto al campo |
| Nome | Campo di testo | `normalizeDisplayName`: 3–60 caratteri, la **stessa** regola dell'onboarding |
| Email verificata | **Switch, a senso unico** (vedi qui sotto) | `forceVerifyEmail` è idempotente e non riscrive un timestamp che c'è |
| Admin | Switch | ⚠ **Assente sulla propria riga**, non spento: il motore lo rifiuta, e un pulsante che esiste è un pulsante che qualcuno premerà. Assente sui bot (lo vieta anche il `CHECK`) |
| Pro | Switch | Assente sui bot. **C'è** sulla propria riga, e la differenza con `is_admin` è di sostanza: quel flag non apre nessuna porta, e un amministratore vede gli insight comunque (`canSeeInsights`) |

⚠ **Lo switch della verifica è asimmetrico, e va progettato guardando l'asimmetria in faccia.**
`forceVerifyEmail` sa fare una cosa sola: **scrivere** `email_verified_at`. Non esiste una
*de*-verifica, e non deve esistere — spegnerla vorrebbe dire rispedire una persona alla schermata del
codice, cioè chiuderla fuori dall'applicazione con un click. Ma uno switch **promette due
direzioni**. Quindi: acceso e bloccato quando l'indirizzo è dimostrato, con la ragione scritta
accanto («l'indirizzo è dimostrato: non si torna indietro»); spento e attivabile quando non lo è. È
l'unico dei tre switch che ha uno stato terminale, e chi lo legge deve capirlo senza provarci.

**Il salvataggio: uno solo, e chiude il modale.** La richiesta è esplicita («una volta salvate le info
si chiude il modal e si aggiorna la tabella»), e questo è l'unico punto in cui la macro **aggiunge
codice al server**: una Server Action nuova in `app/admin/actions.ts` che legge il form e chiama —
**solo per ciò che è cambiato** — le quattro funzioni che esistono.

⚠ **Non è atomica, e la UI non deve far finta che lo sia.** Sono quattro `UPDATE` distinti su `users`
(niente lock: `lib/engine/admin.ts` spiega perché non serve), quindi un salvataggio può riuscire a
metà. La copertura è in due parti: **il modale non offre ciò che il server rifiuterebbe** — nessuno
switch `is_admin` sulla propria riga, nessuno switch sui bot — quindi il fallimento realistico resta
uno solo, il nome fuori dai 3–60 caratteri, che si può fermare anche prima; e **l'esito si riporta per
campo**, non come un «salvato» unico. Su qualunque errore **il modale resta aperto** col messaggio:
chiudersi dicendo «fatto» dopo aver scritto tre cose su quattro è il modo di rendere inaffidabile
l'unico pannello di amministrazione che c'è.

⚠ **E c'è un test che si romperà, di proposito.** `tests/db/admin.test.ts` **enumera gli export di
`app/admin/actions.ts`** e li chiama tutti con un form vuoto, con un'uguaglianza **esatta** e non un
«almeno queste»: il commento in cima al file dice che serve proprio a questo — *«aggiungere un'azione
qui obbliga a guardare in faccia la riga della guardia»*. L'azione nuova deve avere
`requireAppAdmin()` in prima riga, prima di leggere un solo campo, e l'elenco del test va aggiornato
a mano. Non è un intoppo: è il meccanismo che funziona.

**La forma: uno sheet da destra, costruito con `radix-ui` direttamente.**

- ⚠ **Nessun `components/ui/dialog.tsx` e nessun `components/ui/sheet.tsx`**, ed esiste il
  precedente letterale: `components/auction/bid-modal.tsx` importa `Dialog` da `radix-ui` e monta il
  suo sheet a mano, per la ragione scritta in `DECISIONS.md` 2026-08-07 (Fase 5) — le primitive
  condivise si allargano quando arriva il secondo chiamante **generico**. Questo è il secondo modale
  dell'applicazione, ma il primo è uno sheet dal basso pensato per un pollice sotto un countdown, e
  non ha niente da condividere con un pannello laterale da scrivania oltre l'overlay.
- ⚠ **Lo switch si fa con lo `Switch` di `radix-ui`, che è già installato**, e **non** con la variante
  Base UI del link nella richiesta: quella pagina di shadcn monta `@base-ui-components/react`, cioè
  una libreria di primitive nuova accanto a quella che il progetto usa in ogni componente. Lo stack
  di `CLAUDE.md` è esplicito su cosa non si introduce, e due librerie di primitive per uno switch è
  esattamente il genere di cosa. Il comportamento richiesto — On/off — è lo stesso.
- **Da scrivania, come tutto il pannello** (M6: «tabella densa, da scrivania… il pannello si apre da
  un portatile»). Su uno schermo stretto lo sheet occupa tutta la larghezza invece di diventare una
  colonna di 320px accanto a una tabella che non c'è più: non è mobile-first, è non-rotto-sul-piccolo.
- **Accessibilità dello switch, che è la parte che si sbaglia**: ogni switch ha la sua etichetta
  vera (`Label` + `id`, non un `aria-label` che nessuno legge), lo stato è leggibile senza colore, e
  il focus si vede. Uno switch senza etichetta è un interruttore in una stanza buia.

### 6. Cosa non entra (regola 8)

- **Nessuna cancellazione di un utente.** Non esiste oggi e ha una coda vera: `members.user_id` punta
  a `users` **senza cascata**, quindi un utente che ha giocato non si cancella affatto senza portarsi
  via un'asta — è la stessa direzione delle chiavi che in M12 §1 garantisce che cancellare un'asta
  non tocchi nessuna persona, letta dall'altro lato. Sarebbe la seconda azione irreversibile
  dell'applicazione, e vuole una macro sua con la sua domanda: *cosa resta del verbale di un'asta a
  cui un partecipante non esiste più?*
- **Nessun reset della password da parte di un amministratore, e nessuna forzatura di credenziali.**
  Il recupero lo chiede la persona da sé (M5). Un amministratore che entra nell'account di un altro è
  un potere che questa applicazione non ha, e la verifica forzata — che già esiste — è il massimo che
  si è accettato, con la sua avvertenza scritta (*«mettere la propria parola al posto della prova»*).
- **Niente modifica dell'email**, per la ragione di sempre (§5).
- **Niente elenco delle aste dentro il modale**: restano i due numeri «possedute / giocate», che sono
  l'informazione con cui si capisce se una riga è una persona o un residuo. I rimandi ci sono già, e
  stanno nella pagina delle aste — il pannello dà il link e non duplica la vista (M6).
- **Niente paginazione, niente ricerca lato server, niente esportazioni** (§4).
- **Niente modifica dei bot**: un bot non ha un nome da correggere né un indirizzo da verificare.
- **Non si tocca `lib/engine/admin.ts`**, e §1 dice perché è un criterio e non un auspicio.

---

## Task

> Da rifinire all'apertura della macro. Sono la traduzione della spec, non un impegno preso nella
> sessione in cui è stata scritta.

- [x] **M13-01** — Aprire `feature/13-utenti-admin` da `dev`; rileggere questo file e **contare gli
      utenti veri in produzione** (§4): il numero decide se «niente paginazione» regge o va riaperto,
      e si legge in un secondo dalla pagina stessa. Verificare che `pnpm test` sia verde **prima** di
      toccare qualcosa, e annotare il conteggio come baseline
      → **20 utenti veri, 32 contando i bot**, letto dall'owner sulla pagina in produzione il
      2026-08-18. Da qui non era leggibile e non lo sarà mai: non c'è nessun accesso SSH configurato al
      server, e la pagina vuole una sessione da amministratore. **«Niente paginazione» regge**, e §4
      non si riapre: venti righe stanno in una schermata da portatile, quindi la ricerca lato client
      resta un filtro su righe già arrivate e non la bugia che diventerebbe con una «pagina 2». Il
      numero da tenere d'occhio è quello **con** i bot — 32 — perché è quello che la pagina mostra col
      filtro acceso, ed è ancora la metà della soglia in cui §4 dice di riguardare la decisione.
      → Baseline dei test **prima** di toccare qualunque cosa: **791 test in 48 file, tutti verdi**
      (8,2 s), cioè esattamente il conteggio di v1.13.0. Il Postgres locale era già acceso, quindi
      anche i test di `tests/db/` hanno girato per davvero.
- [x] **M13-02** — La tabella: sei colonne, dati e nient'altro, più «Vedi» (§2). Le tre colonne che se
      ne vanno **non spariscono**: vanno nel modale. Rimettere in discussione `min-w-240` e il
      contenitore che scorre — **guardando**, non deducendo (§2)
      → **`min-w-240` via, il contenitore che scorre resta.** Con sei colonne — di cui tre contengono la
      parola «Sì» — quella larghezza minima non aveva più niente da tenere aperto: era lì per far stare
      quattro form. Il `overflow-x-auto` invece **è rimasto di proposito**, e §2 lo diceva già: la
      colonna dell'email è lunga e imprevedibile, ed è l'unica cosa che può ancora costringere allo
      scorrimento — su uno schermo stretto è meglio uno scorrimento che un indirizzo spezzato in sei
      righe. ⚠ **Questo pezzo è stato ragionato, non guardato**: da qui non c'è un browser, e la spec
      chiede di guardare. La verifica visiva è quella di M13-11, e va fatta con la pagina davanti — è
      l'unica cosa di questa macro che nessun test può accorgersi di aver rotto.
      → Le tre colonne che se ne vanno sono nel pannello, e con loro **una quarta informazione che in
      tabella non c'era mai stata**: *quando* l'indirizzo è stato verificato (`verifiedOn`). È la cosa
      che distingue un indirizzo dimostrato da sé da uno verificato a mano la sera dell'asta, e il
      pannello è il primo posto che ha lo spazio per dirla.
      → `UserRow` **non** è tornato a essere un componente server, e §2 lasciava la porta aperta («se
      la riga può, ci torni»): non può, perché «Vedi» apre un pannello che vive nel browser. Ciò che è
      tornato indietro è tutto il resto — zero hook, zero azioni, zero stato: una funzione dalle prop
      al markup. I quarantotto `useActionState` di prima sono zero.
- [x] **M13-03** — `Sì`/`No` con il criterio di §3: la parola sempre, e il trattamento che si nota
      **solo** su «Email verificata: No», che è la riga su cui si deve agire. Non estenderlo per
      simmetria alle altre due
      → Il `No` della verifica è un **`Badge variant="destructive"`**, che è il tono che
      l'applicazione usa già; gli altri due `Sì`/`No` sono testo normale. Il badge aggiunge una forma
      oltre al colore, quindi la cella si distingue anche da chi non separa quei due grigi — e la
      parola resta comunque scritta, che è la regola di M9 §2.
- [x] **M13-04** — La ricerca in testa alla tabella, lato client, con `fold()` di
      `lib/realtime/portal.ts` — **importata, non ricopiata** (§4). Il conteggio in cima segue il
      filtro, e zero risultati si dice a parole. Test puro sul filtro, con un nome accentato dentro
      → `fold()` **importata** da `lib/realtime/portal.ts`, come chiedeva §4. Il filtro sta in
      `lib/admin-users.ts` — puro, senza dipendenze oltre a `fold`, sul modello di
      `lib/centro-dati.ts` — perché una lista filtrata male non dà nessun errore: dà una lista
      plausibile e incompleta. I testi cercabili si calcolano una volta, non a ogni tasto.
      → ⚠ **`fold()` esiste in due copie, e la spec non lo sapeva**: oltre a quella di `portal.ts`
      (di cui M13 è il terzo chiamante, come scritto) `lib/centro-dati.ts` ne ha una **sua** da M10,
      con la stessa semantica scritta in un ordine diverso. **Non l'ho unificata**: cambiare la `fold`
      del Centro dati vuol dire toccare il comportamento di una ricerca su cinquecento righe per una
      questione di forma, dentro una macro che non c'entra. Sta in `DECISIONS.md` perché è
      esattamente la «piccola bugia» di cui parla il commento su `portal.ts`, ed è già in casa.
      → **Il test ha corretto la spec, non il contrario.** La prima asserzione diceva che «ROSSÌ»
      trova solo «Paolo Rossì»: è falso, e per il motivo giusto — il ripiegamento vale in **tutte due
      le direzioni**, quindi una query accentata trova anche `rossi.impresa@example.com`, che
      l'accento non ce l'ha. L'asserzione è stata cambiata per dire quello, che è la garanzia che
      serve davvero.
      → Il conteggio segue il filtro («3 di 20 righe») e zero risultati è una frase. ⚠ **Quella frase
      dice anche che i bot sono nascosti**, quando lo sono: è esattamente il posto in cui uno cerca
      «Bot 3» e non lo trova, e la spiegazione costa una riga.
- [x] **M13-05** — Il pannello laterale: `Dialog` di `radix-ui` come in `bid-modal.tsx`, **nessun
      `components/ui/sheet.tsx`** (§5). Il recap completo, email in sola lettura con la sua riga di
      spiegazione accanto
      → `Dialog` di `radix-ui` a mano, come `bid-modal.tsx`: **nessun `components/ui/sheet.tsx` e
      nessun `components/ui/dialog.tsx`**. Sheet da destra, `sm:max-w-md`, a tutta larghezza sotto quel
      taglio — non mobile-first, non-rotto-sul-piccolo.
      → **La riga di spiegazione sull'email si è spostata**, come chiedeva §5: prima stava sotto la
      tabella (dove parlava di trentadue celle) e adesso sta nel pannello, accanto al campo di cui
      parla. L'email è testo, non un input disabilitato: un input grigio suggerisce che da qualche
      parte esista il modo di abilitarlo.
      → Il pannello **nasce e muore** con «Vedi» (`key={user.id}`, montato solo quando è aperto):
      così lo stato del form non sopravvive a una riga diversa, e riaprirlo non mostra il messaggio
      del salvataggio precedente. Ne viene anche il congedo dell'animazione di chiusura, che è un
      prezzo che si vede meno di uno stato che resta appiccicato.
- [x] **M13-06** — I tre switch con lo `Switch` di `radix-ui` (**non** Base UI, §5): etichette vere,
      stato leggibile senza colore. ⚠ Quello della verifica è **a senso unico** e bloccato quando
      l'indirizzo è dimostrato; `is_admin` **assente** sulla propria riga e sui bot; `is_pro` assente
      sui bot e **presente** sulla propria
      → `Switch` di `radix-ui`, tre volte, con `Label` + `id` veri (niente `aria-label`) e **la parola
      «Sì»/«No» accanto**: la posizione del pollice di un interruttore è un'informazione che chi
      guarda da lontano non ha.
      → La verifica è **acceso e bloccato** quando l'indirizzo è dimostrato, con la ragione scritta
      accanto («l'indirizzo è dimostrato: non si torna indietro»). ⚠ **E c'è un terzo stato che la
      spec non nominava**: una riga **senza indirizzo** — i bot non sono gli unici, `entry: "none"`
      esiste — dove `forceVerifyEmail` rifiuta con `INVALID_EMAIL`. Lì lo switch è spento e bloccato,
      e dice perché: «non c'è niente da verificare».
      → `is_admin` **assente** sulla propria riga (al suo posto una riga che dice cosa vale e perché
      non si tocca da qui), `is_pro` **presente**. Su un bot niente di tutto questo: il pannello è
      tutto recap e lo dice in una frase, invece di mostrare quattro comandi spenti.
- [x] **M13-07** — La Server Action del salvataggio in `app/admin/actions.ts`: `requireAppAdmin()` in
      prima riga, chiama **solo per ciò che è cambiato** le quattro funzioni esistenti, riporta
      l'esito **per campo**. Su errore il modale resta aperto; a pieno successo si chiude e la tabella
      si aggiorna (`revalidatePath`). ⚠ Aggiornare l'elenco degli export in `tests/db/admin.test.ts`,
      che si romperà di proposito (§5)
      → `saveUserAction` in `app/admin/actions.ts`, `requireAppAdmin()` in prima riga.
      → ⚠ **«Solo per ciò che è cambiato» ha richiesto una decisione che §5 non aveva preso**: per
      sapere cos'era prima bisognerebbe leggere il database, e quest'azione **non può** — non importa
      `lib/db` (regola ESLint) e `lib/engine/admin.ts` non si tocca (§1), quindi non esiste nessun
      `getAdminUser` e non doveva nascerne uno. Il campo cambiato lo dice **la sua presenza nella
      `FormData`**: il pannello monta l'input nascosto solo quando il valore differisce da quello
      ricevuto, e un `displayName` assente vuol dire «il nome non si tocca», non «il nome è vuoto». Ne
      viene una piccola stranezza da sapere leggendo il componente: **il campo di testo visibile non
      ha `name`**. Scartato il mandare anche i valori precedenti: due volte i dati per la stessa
      informazione, e il peggio che fa un client che mente è una `UPDATE` che riscrive ciò che c'era.
      → L'esito per campo vive in `lib/admin-users.ts` (`outcomes` + `done`) accanto al filtro:
      `FormState` ha un solo `error`, che è la forma giusta per un'azione che fa **una** cosa. Il
      modale si chiude **solo** su `done`.
      → ⚠ **`revalidatePath` si dà anche a metà strada**, se almeno un campo è passato: era una scelta
      da fare e la spec non la nominava. Ciò che è stato scritto deve comparire in tabella anche
      quando il modale resta aperto — altrimenti la pagina racconta una storia e il database un'altra,
      che è il guaio peggiore di un salvataggio non atomico.
      → Il ternario `"true"/"false" → boolean` era scritto due volte e adesso è tre: è diventato
      `flag(form, key)` accanto a `text()`, **usato anche dalle due azioni vecchie**. Terzo chiamante,
      quindi non è un'astrazione anticipata.
      → `tests/db/admin.test.ts` si è rotto come previsto e l'elenco esatto è stato aggiornato a mano
      (quinta volta di fila). ⚠ **E ha portato un test in regalo**: l'`it.each` che enumera gli export
      e li chiama con un form vuoto ha guadagnato un caso da solo, quindi la guardia dell'azione nuova
      era già coperta prima di scrivere un test suo.
- [x] **M13-08** — Test con Postgres: le quattro azioni continuano a rifiutare ciò che rifiutavano
      (propria riga per `is_admin`, bot per entrambi i flag, nome fuori dai limiti, utente
      inesistente) **passando dall'azione nuova**; un non-amministratore è rifiutato chiamandola
      direttamente; un salvataggio che cambia due campi su quattro non scrive gli altri due
      → File nuovo: `tests/db/admin-save.test.ts`, **13 test**. ⚠ **Non è una sezione di
      `admin.test.ts`, e non per ordine**: là `requireAppAdmin` è sostituita da una che *interrompe
      sempre* — è ciò che prova la guardia in prima riga — e accanto a quel finto non ci si può
      mettere un test che vuole vedere un salvataggio **riuscire**. Il finto nuovo fa l'altra metà:
      restituisce la riga vera dell'attore scelto dal test, **senza guardare `is_admin`**. È questo
      che rende onesta la verifica 11 — la guardia lascia entrare l'intruso, e a fermarlo resta
      soltanto la rilettura del permesso dentro il motore.
      → `next/cache` è sostituito: `revalidatePath` fuori da una richiesta vera non ha nessuno store
      da invalidare, e che la tabella si aggiorni è una verifica da fare col browser (M13-11).
      → Coperti: due campi su quattro scrivono solo quei due; nome fuori dai limiti che cade **mentre
      il flag valido passa**; `is_admin` sulla propria riga rifiutato con il nome dello stesso
      salvataggio che invece si scrive; i tre comandi su un bot tutti rifiutati; un uuid inesistente
      **e** una stringa che non è un uuid (il `22P02`, cioè un 500 al posto di un rifiuto); un flag
      che non è né `true` né `false`; l'intruso; e **l'amministratore appena declassato** che salva
      una volta e poi non più.
- [x] **M13-09** — Gate: `pnpm test`, `pnpm typecheck`, `pnpm build` verdi (⚠ build con `pnpm dev`
      spento — è una macro **tutta di UI**, quindi esattamente quella in cui un errore di lint fa
      fallire la build di produzione con tutto il resto verde: è successo a M9)
      → **813 test in 50 file**, typecheck e build verdi. Dei 22 in più di v1.13.0, otto sono la
      ricerca, tredici il salvataggio e **uno è arrivato da solo** (M13-07).
      → `pnpm build` dato con `pnpm dev` **spento**, verificato guardando chi era in ascolto e non
      dandolo per fatto. `/admin/users` pesa 9 kB / 138 kB di first load. Nessun errore di lint, che è
      il modo in cui questa macro poteva far fallire la produzione con tutto il resto verde (M9).
- [x] **M13-10** — `docs/ARCHITECTURE.md`: il capitolo del pannello, che oggi descrive una tabella che
      si compila. `docs/DECISIONS.md`: **la ratifica su M6 §8** (la ricerca sì, la paginazione no, e
      perché non sono la stessa decisione), lo `Switch` di radix invece di Base UI, lo switch della
      verifica a senso unico, e le due strade scartate di §6
      → `docs/ARCHITECTURE.md`: «Le tre azioni sugli utenti» è diventato «La pagina utenti: una
      tabella che si legge, un pannello che modifica», e racconta perché la forma di prima era
      sbagliata — la domanda frequente che si rispondeva peggio della rara. Corretta anche la chiusa
      del capitolo, che dava per scontato che tutte le tabelle del pannello scorrano in orizzontale.
      → `docs/DECISIONS.md`: le quattro decisioni che M13-10 chiedeva **erano già scritte** nella voce
      di pianificazione del 2026-08-18 (ratifica su M6 §8, radix invece di Base UI, la verifica a
      senso unico, le due strade scartate) e sono state seguite alla lettera. La voce nuova dice
      quelle prese **scrivendola**: la misura in produzione, il protocollo «campo presente = campo
      cambiato», l'esito per campo in `lib/admin-users.ts`, il file di test separato, le quattro
      azioni vecchie lasciate in piedi e la `fold` duplicata.
- [ ] **M13-11** — Chiusura: merge `--no-ff` su `dev`, prova in locale — **anche su uno schermo
      stretto**, che è l'unica cosa che questa macro può rompere senza che nessun test se ne accorga —
      poi, **solo su richiesta esplicita**, `CHANGELOG.md`, `package.json`, merge su `main`, tag
      `v1.14.0`, push. **Nessun `db:push`, nessun passo a mano sul server**

## Verifica

1. `pnpm test`, `pnpm typecheck` e `pnpm build` verdi.
2. **La tabella ha sei colonne e nessun campo modificabile**, e su un portatile non scorre in
   orizzontale.
3. **Cercare «rossi» trova Rossi, «ROSSI» e «Rossì»**, e trova anche chi ha quel testo nell'email. Il
   conteggio in cima cambia mentre si digita; con zero risultati c'è una frase, non una tabella vuota.
4. **Il filtro dei bot funziona ancora**, e la ricerca lavora su ciò che il filtro ha lasciato.
5. **«Vedi» apre il pannello con tutto dentro**, comprese le tre informazioni che in tabella non ci
   sono più, e l'email non è modificabile in nessun modo.
6. **Sulla propria riga lo switch `is_admin` non esiste**, e c'è scritto perché. Quello di `is_pro`
   c'è.
7. **Su un bot non c'è nessuno switch.**
8. **Lo switch della verifica, una volta acceso, non si spegne**, e lo dice.
9. **Salvato: il modale si chiude e la tabella mostra il valore nuovo** senza ricaricare la pagina a
   mano.
10. **Un salvataggio rifiutato lascia il modale aperto** con il messaggio del server, e a database non
    è cambiato niente di ciò che era valido — cioè l'esito è per campo, non tutto-o-niente.
11. **Un non-amministratore che chiama l'azione nuova direttamente è rifiutato**, e a database non
    cambia niente. È la verifica che il layout non protegge nessuno.
12. **Il resto del pannello è intatto**: lista aste, listone, Centro dati, figurine.
