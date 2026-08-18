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

- [ ] **M13-01** — Aprire `feature/13-utenti-admin` da `dev`; rileggere questo file e **contare gli
      utenti veri in produzione** (§4): il numero decide se «niente paginazione» regge o va riaperto,
      e si legge in un secondo dalla pagina stessa. Verificare che `pnpm test` sia verde **prima** di
      toccare qualcosa, e annotare il conteggio come baseline
- [ ] **M13-02** — La tabella: sei colonne, dati e nient'altro, più «Vedi» (§2). Le tre colonne che se
      ne vanno **non spariscono**: vanno nel modale. Rimettere in discussione `min-w-240` e il
      contenitore che scorre — **guardando**, non deducendo (§2)
- [ ] **M13-03** — `Sì`/`No` con il criterio di §3: la parola sempre, e il trattamento che si nota
      **solo** su «Email verificata: No», che è la riga su cui si deve agire. Non estenderlo per
      simmetria alle altre due
- [ ] **M13-04** — La ricerca in testa alla tabella, lato client, con `fold()` di
      `lib/realtime/portal.ts` — **importata, non ricopiata** (§4). Il conteggio in cima segue il
      filtro, e zero risultati si dice a parole. Test puro sul filtro, con un nome accentato dentro
- [ ] **M13-05** — Il pannello laterale: `Dialog` di `radix-ui` come in `bid-modal.tsx`, **nessun
      `components/ui/sheet.tsx`** (§5). Il recap completo, email in sola lettura con la sua riga di
      spiegazione accanto
- [ ] **M13-06** — I tre switch con lo `Switch` di `radix-ui` (**non** Base UI, §5): etichette vere,
      stato leggibile senza colore. ⚠ Quello della verifica è **a senso unico** e bloccato quando
      l'indirizzo è dimostrato; `is_admin` **assente** sulla propria riga e sui bot; `is_pro` assente
      sui bot e **presente** sulla propria
- [ ] **M13-07** — La Server Action del salvataggio in `app/admin/actions.ts`: `requireAppAdmin()` in
      prima riga, chiama **solo per ciò che è cambiato** le quattro funzioni esistenti, riporta
      l'esito **per campo**. Su errore il modale resta aperto; a pieno successo si chiude e la tabella
      si aggiorna (`revalidatePath`). ⚠ Aggiornare l'elenco degli export in `tests/db/admin.test.ts`,
      che si romperà di proposito (§5)
- [ ] **M13-08** — Test con Postgres: le quattro azioni continuano a rifiutare ciò che rifiutavano
      (propria riga per `is_admin`, bot per entrambi i flag, nome fuori dai limiti, utente
      inesistente) **passando dall'azione nuova**; un non-amministratore è rifiutato chiamandola
      direttamente; un salvataggio che cambia due campi su quattro non scrive gli altri due
- [ ] **M13-09** — Gate: `pnpm test`, `pnpm typecheck`, `pnpm build` verdi (⚠ build con `pnpm dev`
      spento — è una macro **tutta di UI**, quindi esattamente quella in cui un errore di lint fa
      fallire la build di produzione con tutto il resto verde: è successo a M9)
- [ ] **M13-10** — `docs/ARCHITECTURE.md`: il capitolo del pannello, che oggi descrive una tabella che
      si compila. `docs/DECISIONS.md`: **la ratifica su M6 §8** (la ricerca sì, la paginazione no, e
      perché non sono la stessa decisione), lo `Switch` di radix invece di Base UI, lo switch della
      verifica a senso unico, e le due strade scartate di §6
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
