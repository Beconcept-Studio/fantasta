# M16 — Le regole dell'offerta: niente scorciatoie, niente ritiro

> **Stato:** **chiusa** — **in produzione da `v1.16.0`** (2026-08-22), aperta, lavorata, provata
> dall'owner e rilasciata nella stessa giornata. Gate verde con **858 test in 52 file** (da 860 in
> 51: 13 tolti insieme al ritiro, 11 aggiunti), typecheck e build puliti.
> ⚠ **Nessun passo a mano sul server**: nessun `pnpm db:push`, nessun backfill, nessun file da
> caricare. Il deploy finisce il rilascio.
> ⚠ **Porta anche una correzione fuori tema** (`M16-11`, chiesta a macro già chiusa su `dev`): la
> voce «Lobby» sparisce dal menù ad asta `LIVE`, dove portava a un rimbalzo.
> ⚠ **La versione di chiusura è `v1.16.0`**, non quella che si sarebbe potuta dedurre: in produzione
> c'è `v1.15.1`, e `package.json`, `CHANGELOG.md` e i tag concordano tutti e tre.
>
> Nasce da due delle tre richieste che
> l'owner ha scritto nel quaderno dopo `v1.15.1`, insieme a **M17** — e le due macro sono state
> tagliate di proposito (§0 di questo file, e `docs/features/README.md`).
>
> ⚠ **Tocca lo schema del database? No.** Nessun `pnpm db:push`, nessun backfill, nessun file da
> caricare. **La colonna `bids.withdrawn_at` resta** ed è precisamente il punto: questa macro toglie
> tutti gli **scrittori** del ritiro e non tocca **nessun lettore** (§3). Il rilascio finisce col
> deploy.
>
> **Invarianti coinvolti — nessuno viene modificato, e la verifica è stata fatta invece di
> essere dedotta**: I1–I10 non nominano il ritiro. **I5** (il tetto `max_bid`) è l'unico che questa
> macro sfiora, e lo sfiora per **rafforzarlo**: `max` resta scritto nell'intestazione del modale
> perché è il limite che il server applica, non un valore suggerito (§2). **I8** non è toccato: qui
> non esce niente di nuovo dal server, esce di meno.
> ⚠ **`PLAN.md` invece diventa parzialmente falso**, e non si riscrive: §297 («il chiamante non può
> ritirare, può solo rilanciare»), §314 («il ritiro è disabilitato nel round 2»), la firma di §544 e
> gli scenari 7 e 8 di §683-684 descrivono un comportamento che dopo questa macro non esiste più. È
> **archivio**, e il precedente è letterale — M13 ha ribaltato M6 §8 senza riscrivere il file di M6.
> La ratifica va in `docs/DECISIONS.md` alla data e in `docs/ARCHITECTURE.md`.
>
> **Regole coinvolte:** **3** (lo snapshot resta l'unico punto d'uscita, e non cambia forma: il campo
> `withdrawnAt` continua a viaggiare), **6** — che è **la ragione per cui il motore va toccato e non
> basta nascondere un pulsante** (§3), **8** (nessuna astrazione nuova: qui si cancella).

## Obiettivo

Due regole del gioco cambiano, e cambiano nella stessa direzione: **un'offerta è una decisione che si
prende una volta.**

Oggi il modale d'offerta ha quattro pulsanti che scrivono una cifra al posto tuo — `+5`, `+10`, `+25`,
`max` — e un pulsante che cancella l'offerta appena fatta. Sono due comodità che spingono nella
stessa direzione sbagliata: la prima trasforma la scelta della cifra in un tocco su un incremento
tondo, la seconda trasforma la busta chiusa in una cosa reversibile. In un'asta in cui la cifra è
l'unica informazione che conta, la comodità è il difetto.

Dopo questa macro si scrive un numero — con `−1` e `+1` accanto al campo per l'aggiustamento
dell'ultimo secondo — e quel numero si può **rilanciare**, mai togliere.

La terza cosa non c'entra col tema e sta qui perché è indipendente da tutto e costa mezza giornata:
in TV si vede **chi è collegato**.

Il tema, detto in una riga: *chi offre tiene, e al massimo rilancia.*

## Richieste che ci confluiscono

Tolte da `docs/REQUESTS.md` il 2026-08-22 — la terza (il refactor UI del portale) va in **M17**.

- **Lotto — Rimozione valori suggeriti e Ritiro offerta.** «Nel modale con la input per effettuare
  l'offerta rimuovere i valori consigliati (+10, +25, max, etc.). Tenere solo -1 / +1 vicino alla
  input. Rimuovere inoltre la possibilità di rimuovere un'offerta fatta. Chi fa un'offerta la tiene,
  al massimo può sovrascriverla.»
- **Refactor UI elementi → TV.** «Voglio vedere lo status dei partecipanti (verde: live - rosso:
  offline).»

**Quattro decisioni dell'owner, prese il 2026-08-22 e da leggere prima della spec**, perché due di
esse cambiano il perimetro:

1. **Il ritiro si toglie fino in fondo, motore compreso** — non solo il pulsante. La ragione è la
   regola 6 letta al contrario: se la rotta continuasse ad accettare un `WITHDRAW`, la regola del
   gioco vivrebbe **solo** nella UI, che è esattamente ciò che questo progetto non fa mai (§3).
2. **La colonna `withdrawn_at` resta**, con tutti i suoi lettori. Nessun `DELETE`, nessun cambio
   distruttivo, nessun `pg_dump` prima del rilascio.
3. **In TV due colori e non tre**, e `IDLE` conta come collegato: chi ha la pagina aperta col telefono
   in tasca è presente. In TV la domanda è «possiamo far partire il round?», e un tab in secondo
   piano non è una persona assente (§5).
4. **Questa macro esce prima di M17**, che è più grande e più rischiosa. Sono indipendenti e l'ordine
   si potrebbe invertire, ma M17 ridisegna una card da cui M16 ha già tolto un ramo.

---

## Spec

### 0. Perché due macro e non una

Le tre richieste del quaderno sembrano un tema solo — «sistemiamo il portale» — e hanno due profili di
rischio molto diversi, che è il criterio con cui sono state tagliate M5/M6, M9–M12 e M13/M14.

**M16 tocca il motore.** `machine.ts`, `actions.ts`, la rotta `/action`: un errore qui non si vede in
una pagina, si vede la sera dell'asta con dodici persone che guardano. Ma è **sottrattiva** — non
aggiunge nessun percorso nuovo — e il suo gate è quasi tutto in `pnpm test`.

**M17 non tocca il motore e non tocca lo schema**, ma è una scommessa visiva grande: tre colonne, un
pannello nuovo, una tavolozza. È esattamente la forma di lavoro che a **M15 è stata guardata e
buttata**, e quel precedente è la ragione principale del taglio: se il layout a tre colonne non
convince, tornare indietro **non deve rimettere in piedi il pulsante «Ritira»**. Due tag, due punti di
rollback.

Le dipendenze sono una sola e va in una direzione: M16 toglie da `lot-card.tsx` il ramo «ti sei
ritirato», e M17 ridisegna quella card. Fare M16 prima vuol dire ridisegnare una card che ha già la
forma finale; farla dopo vuol dire toccare due volte lo stesso file.

### 1. Cosa succede oggi, letto nel codice

Non è un'ipotesi da verificare all'apertura: è stato letto il 2026-08-22.

**I valori suggeriti** sono una riga di quattro pulsanti in `components/auction/bid-modal.tsx`
(righe 319-344): `[5, 10, 25].map(...)` che chiamano `bump(step)`, più un quarto che scrive
`bounds.max` nel campo. Stanno **sotto** il campo e sopra la riga del verdetto.

⚠ **Il prezzo consigliato di Carmy non è uno di questi**, e non va toccato. È un componente suo
(`PrezzoConsigliato`) con **un posto solo** da cui si decide dove compare, e quel posto dice già
`POSIZIONE_PREZZO = "macro"`: il numero sta in fila con fascia e affidabilità, **non** accanto al
campo. L'innesto `dove="campo"` che si legge in `bid-modal.tsx` è già muto oggi, e resta muto: è
scritto apposta perché cambiare idea costi una riga (M10B §6).

**Il ritiro** attraversa nove file. Vale la pena elencarli qui perché è la parte della macro che si
sottovaluta guardando il modale:

| File | Cosa c'è |
|---|---|
| `components/auction/bid-modal.tsx` | i due pulsanti con la conferma a due tocchi, lo stato `confirmWithdraw`, la funzione `withdraw()`, il feedback `{kind:"withdrawn"}` e il suo ramo in `FeedbackLine`, i `disabled={… \|\| withdrawn}` |
| `components/auction/lot-card.tsx` | il ramo `withdrawn` di `MyBidRow`, e la frase sul chiamante che nomina il ritiro |
| `app/auctions/[id]/play/portal.tsx` | la prop `onWithdraw` passata al modale |
| `lib/realtime/portal.ts` | `canWithdraw` (i tre divieti) e `haveWithdrawn` |
| `lib/realtime/action.ts` | `\| { type: "WITHDRAW" }` nella union |
| `app/api/auctions/[id]/action/route.ts` | `case "WITHDRAW"` e l'import di `withdrawBid` |
| `lib/engine/actions.ts` | `withdrawBid`, che emette `WITHDRAW_BID` |
| `lib/engine/machine.ts` | `case "WITHDRAW_BID"`, la funzione `withdrawBid` (righe 340-378) e la guardia `BID_WITHDRAWN` dentro `placeBid` |
| `lib/engine/types.ts`, `lib/engine/errors.ts` | il tipo evento, `WITHDRAW_FORBIDDEN` e `BID_WITHDRAWN` |

**I bot non ritirano mai.** `bot-brain.ts` legge `withdrawnAt` una volta (riga 186, per non rilanciare
su un'offerta ritirata) ma non emette nessun `WITHDRAW`. Verificato: nessuna occorrenza in
`lib/engine/bots.ts`. Quindi togliere l'evento non rompe la simulazione.

**Lo status dei partecipanti in TV** non esiste, ma il **dato sì**, e in ogni snapshot: `member.presence`
è già `LIVE | IDLE | OFFLINE`, derivato a ogni lettura da `last_seen_at` e dal flag di visibilità
(`lib/engine/presence.ts`). Lo usa già `MembersPanel` nel portale. ⚠ E **anche i bot battono il
colpo** (`bots.ts`, `recordHeartbeat`): in simulazione i pallini si vedono subito, senza dover mettere
in piedi dodici telefoni.

### 2. I valori suggeriti se ne vanno, il tetto resta

Sparisce la riga dei quattro pulsanti, interamente. Restano `−1`, il campo, `+1`, che sono già lì e
già alti 48px.

`bump()` **non** si tocca: la usano `−1` e `+1`, e la sua regola sottile va lasciata scritta — da campo
vuoto, `−1` scrive il minimo e non «minimo meno uno», perché sotto pressione i tasti rapidi devono
valere quello che c'è scritto sopra.

⚠ **`max NN` nell'intestazione resta**, e non è una svista rispetto alla richiesta. Quel numero non è
un valore suggerito: è **I5**, il tetto che il server applica a ogni offerta al momento del submit.
Toglierlo vorrebbe dire far scrivere una cifra al buio e farla rifiutare dal motore — e il vincolo
mobile-first di `PLAN §15` chiede l'opposto, cioè che `max_bid` resti visibile anche con la tastiera
aperta. Ciò che sparisce è il pulsante che **scrive** `max` nel campo, non l'informazione che il
tetto è `max`.

### 3. Il ritiro: via tutti gli scrittori, restano tutti i lettori

È la sezione da leggere prima di toccare qualcosa, perché la distinzione fra le due metà è ciò che
rende questa macro sicura.

**Via tutti gli scrittori.** Tutto ciò che è elencato nella tabella di §1 sparisce: il percorso da un
pollice fino a `withdrawn_at` non esiste più in nessuno dei suoi nove tratti. Compresa la guardia
`if (existing?.withdrawnAt != null)` dentro `placeBid` (`machine.ts:294`), che rifiutava un rilancio
su un'offerta ritirata: senza scrittori quella condizione non può più diventare vera, e una guardia
irraggiungibile è una guardia che nessun test può più difendere.

⚠ **Perché non basta nascondere il pulsante.** È la regola 6 letta al contrario. La regola dice «la UI
disabilita, il server rifiuta comunque»: se si togliesse solo il pulsante, il server **non**
rifiuterebbe — un `POST` costruito a mano continuerebbe a ritirare un'offerta, e la nuova regola del
gioco vivrebbe soltanto nel codice del browser. In un'asta fra amici il rischio pratico è nullo; il
punto è un altro, ed è che questo progetto non ha mai una regola che esista solo lato client, e
lasciarne una qui vuol dire che fra sei mesi nessuno saprà più se il ritiro c'è o no.

**Restano tutti i lettori, e non è una dimenticanza.** La colonna `bids.withdrawn_at`
(`schema.ts:756`), il campo negli snapshot (`snapshot.ts:151` e `216`) e nei tipi
(`realtime/types.ts`), il filtro di `resolveRound` (`rules.ts:141`), il round-trip di `mutate.ts`, il
`line-through` nel reveal in TV (`tv-view.tsx:621`), le due righe di `app/auctions/[id]/log/lots-log.tsx`
e la guardia di `bot-brain.ts:186`. Leggono un campo che continua a esistere e che continua a essere
`null`: costano zero e raccontano il vero su qualunque riga vecchia. Il commento di `resolveRound`
(«il chiamante non può ritirare: un round senza offerte attive è un bug») va **aggiornato**, non
tolto: da qui in poi non è il chiamante a non poter ritirare, è nessuno.

⚠ **E c'è una riga che sembra da togliere e non va toccata**: `"WITHDRAW_BID"` dentro
`ROUTINE_EVENT_TYPES` in `lib/auction-log.ts`. Quel file ha una scelta deliberata scritta in un
commento — *«un tipo sconosciuto è notevole»* — perché lo storico delle correzioni deve mostrare un
evento nuovo anche se nessuno si è ricordato di elencarlo. La conseguenza è che togliere
`WITHDRAW_BID` dall'elenco della routine non lo fa sparire: lo **promuove**, e i ritiri di un'asta
già giocata comparirebbero di colpo nel blocco delle correzioni, dove non sono mai stati. La riga
resta, e questa è la ragione.

**Il codice di errore.** `WITHDRAW_FORBIDDEN` e `BID_WITHDRAWN` spariscono da `errors.ts` insieme
alle funzioni che li producevano. Con la union di `action.ts` senza `"WITHDRAW"`, un `POST` con quel
tipo cade nel `default` della rotta e torna `INVALID_REQUEST` — che è la risposta giusta: non «non
puoi ritirare adesso», ma «questa azione non esiste».

### 4. Le due frasi che vanno riscritte, non cancellate

Togliere del codice lascia in giro del testo che parlava di lui, ed è il modo in cui una macro
sottrattiva mente.

1. **Sulla card**, al chiamante: «L'hai chiamato tu: l'apertura a 1 è già registrata e non puoi
   ritirarti, solo rilanciare» diventa «**L'hai chiamato tu: l'apertura a 1 è già registrata.**» La
   coda va tolta per una ragione precisa — dire al chiamante che *lui* non può ritirarsi implica che
   qualcun altro possa, e dopo questa macro non è vero per nessuno.
2. **Nel modale**, il testo del pulsante di conferma resta `Offri` / `Conferma NN` / `Rilancia a NN`:
   è già la lingua giusta e adesso è anche l'unica strada. Non serve un'aggiunta che spieghi che non
   si può ritirare: **una regola che non esiste non si annuncia**, e una riga «il ritiro non è
   possibile» in un modale che nessuno ha mai visto ritirare è rumore per chi entra oggi.

### 5. I pallini in TV

Un pallino prima del nome squadra nell'intestazione di `TeamCard`, in `app/tv/[publicToken]/tv-view.tsx`.

⚠ **Non riusa `PresenceDot`**, ed è la stessa ragione per cui `SimulationTag` non riusa
`SimulationBadge`: la TV è **bianco su nero fisso** e `PresenceDot` disegna l'`OFFLINE` con
`bg-muted-foreground/40`, che su fondo nero è un grigio chiaro — cioè il contrario di ciò che deve
comunicare. La TV ha il suo pallino con colori fissi, `emerald-400` e `red-500`.

La mappa da tre stati a due sta in **un posto solo**, una funzione pura accanto al componente:
`IDLE` conta come collegato. La ragione è la domanda che si fa chi guarda il tabellone — «possiamo
partire?» — e un tab in secondo piano non è una persona che se n'è andata. ⚠ È anche l'unico punto in
cui l'ambra sarebbe stata sbagliata: in TV l'ambra è già la pausa e già la riconnessione, e un terzo
significato sullo stesso colore, a tre metri, non si distingue.

⚠ **Un limite, dichiarato invece che scoperto la sera dell'asta.** La presence si ricalcola quando
*qualcuno* batte il colpo (`readPresence` confronta la mappa con l'ultima annunciata, e il primo
heartbeat che arriva dopo la scadenza di un altro fa partire l'aggiornamento). Con otto o dodici
telefoni che battono ogni dieci secondi, un pallino diventa rosso entro circa un secondo dalla
scadenza della finestra di 15s. Ma se si scollegassero **tutti insieme**, nessun heartbeat arriverebbe
e la TV resterebbe con tutti i pallini verdi. **Non si risolve**: la cura sarebbe un timer nuovo nel
processo, e non vale un caso in cui non c'è più nessuno da mostrare. Se un giorno lo si volesse, il
posto è lo sweep che esiste già, non un timer nuovo.

### 6. Cosa non entra (regola 8)

- **Nessuna «offerta massima automatica»**, nessun proxy bidding, niente che offra al posto di
  qualcuno. La richiesta toglie comodità, non ne aggiunge una diversa.
- **Nessun cambio a `−1` / `+1`**: restano dove sono, con la stessa taglia e la stessa regola.
- **Nessun tocco al prezzo consigliato di Carmy** (§1), che è un giudizio e non un valore suggerito
  dall'interfaccia. Se un giorno lo si volesse spegnere, resta una riga in `prezzo-consigliato.tsx`.
- **Nessun pallino di presence nel portale oltre a quelli che ci sono già**: `MembersPanel` li ha, e
  la loro forma è materia di M17.
- **Nessuna colonna tolta, nessuna migrazione** (§3).

---

## Task

> Da rifinire all'apertura della macro. Sono la traduzione della spec, non un impegno preso nella
> sessione in cui è stata scritta.

- [x] **M16-01** — Aprire `feature/16-regole-offerta` da `dev`. Rileggere questo file e `PLAN §15`
      (il vincolo mobile-first sul modale). Dare `pnpm test` **prima** di toccare qualunque cosa e
      annotare il conteggio come baseline: la baseline attesa è quella di `v1.15.1`
      → **860 test in 51 file, verdi**, che è esattamente la baseline attesa
- [x] **M16-02** — Via la riga dei quattro valori suggeriti da `bid-modal.tsx` (§2). Non toccare
      `bump()`, non toccare `max` nell'intestazione, non toccare `PrezzoConsigliato`. Verificare a
      occhio sul telefono che il modale con la tastiera aperta non sia peggiorato: la riga tolta
      libera ~44px di altezza, che è spazio guadagnato dove serviva
      → codice fatto; ⏳ **la verifica a occhio sul telefono resta all'owner**
- [x] **M16-03** — Il ritiro via dal **client**: modale, card, portale, `lib/realtime/portal.ts`,
      `lib/realtime/action.ts` (§3). A fine task `grep -rn "withdraw" components app/auctions` deve
      restituire **solo** le due righe di `lots-log.tsx` e quella di `tv-view.tsx`, che sono lettori
      → ⚠ **quel grep era incompleto, e la spec di §3 aveva ragione contro il suo stesso task.**
      Restituisce anche **quattro righe di `components/auction/reveal-panel.tsx`**, che è il gemello
      nel portale del `line-through` della TV: legge `bid.withdrawnAt` per barrare le buste ritirate
      di un'asta già giocata. È un **lettore**, quindi resta — la regola «via tutti gli scrittori,
      restano tutti i lettori» decide, non l'elenco. Il conto giusto è: 2 righe di `lots-log.tsx` +
      4 di `reveal-panel.tsx` sotto `components`/`app/auctions`, più quella di `tv-view.tsx` che sta
      sotto `app/tv` e che quel grep non guardava nemmeno
- [x] **M16-04** — Il ritiro via dal **motore**: la rotta, `actions.ts`, `machine.ts` (evento,
      funzione e la guardia irraggiungibile dentro `placeBid`), `types.ts`, `errors.ts` (§3).
      ⚠ **Non** toccare `ROUTINE_EVENT_TYPES` in `auction-log.ts`, per la ragione scritta in §3, e
      **non** toccare nessun lettore di `withdrawn_at`
      → fatto; `ROUTINE_EVENT_TYPES` è intatto e ha guadagnato il commento che spiega perché quella
      riga resta, che è la difesa vera contro la prossima ripulitura
- [x] **M16-05** — Aggiornare le due frasi di §4 e il commento di `resolveRound`. Rileggere i commenti
      di testa dei file toccati: `bid-modal.tsx` e `portal.ts` **spiegano** il ritiro in prosa, e un
      commento che descrive del codice cancellato è peggio di nessun commento
- [x] **M16-06** — I test: togliere quelli sul ritiro (≈45 occorrenze in 9 file, contate il
      2026-08-22) e **aggiungerne uno al contrario** — un `POST` con `{type:"WITHDRAW"}` torna
      `INVALID_REQUEST` e a database non cambia niente. È la verifica che la regola non vive solo
      nella UI. ⚠ Controllare che `tests/engine/helpers.ts` non costruisca offerte ritirate per altri
      test che non parlano di ritiro
      → **13 test tolti**, e il test al contrario è `tests/db/withdraw-gone.test.ts`, che passa dalla
      rotta vera con la sessione mockata. `helpers.ts` **resta com'è**: la sua opzione `withdrawnAt`
      ha un chiamante solo, il test di `resolveRound` in `tests/engine/rules.test.ts`, che è
      precisamente il lettore da continuare a difendere
- [x] **M16-07** — I pallini in TV (§5): il pallino in `TeamCard` e la mappa a due stati in una
      funzione pura con il suo test. Guardarli **con una simulazione accesa**, dove i bot battono il
      colpo, e poi con un telefono vero che si scollega — il rosso deve arrivare entro ~15 secondi
      → `TvPresenceDot` in `tv-view.tsx` e `tvConnected` in `lib/realtime/portal.ts`, con tre test.
      ⚠ **La funzione pura sta in `portal.ts` e non «accanto al componente»** come diceva la spec: è
      la stessa ragione di `use-auction-stream.ts` — vitest include solo `**/*.test.ts`, e un test
      che importasse un `.tsx` client si tirerebbe dietro React in ambiente `node`. `tv-view.tsx`
      importa già `portalScreen` da lì, quindi il precedente c'era. ⏳ **Il collaudo a occhio con la
      simulazione e con un telefono che si scollega resta all'owner**
- [x] **M16-08** — Gate: `pnpm test`, `pnpm typecheck`, `pnpm build` verdi (⚠ la build vuole il dev
      server **spento**, e la prima dopo una sessione di `pnpm dev` può morire da sola sulla rotta
      dello stream: prima di indagare, ridarla)
      → **852 test in 52 file**, typecheck pulito, build pulita al primo colpo (nessun dev server
      acceso: verificato con `lsof` prima di darla)
- [x] **M16-09** — Documentazione: `docs/DECISIONS.md` con le quattro decisioni del 2026-08-22 e la
      ratifica su `PLAN §297/§314/§683-684`; `docs/ARCHITECTURE.md` dove racconta il modale d'offerta
      e il ciclo di un lotto — oggi dice che si può ritirare
      → in `ARCHITECTURE.md` sono **sei** i punti riscritti, non due: gli eventi del motore («sette»
      non erano più sette), «Chi chiama è vincolato» con accanto la sezione nuova «Chi offre tiene»,
      il paragrafo sull'irreversibilità del ritiro, l'elenco delle azioni di `actions.ts`, le domande
      pure di `portal.ts`, e il modale d'offerta. Più la TV, per i pallini
- [x] **M16-11** — ⚠ **Entrato a macro già chiusa su `dev`**, su richiesta dell'owner del 2026-08-22
      e prima del rilascio: col tema dell'offerta non c'entra, sta qui perché `CLAUDE.md` dice che
      una correzione piccola vive dentro la macro aperta. **La voce «Lobby» sparisce dal menù ad asta
      `LIVE`**, dove portava a un rimbalzo — `LobbyLive` spinge il membro al portale.
      La condizione è **copiata da quella del rimbalzo**: `isMember && status === "LIVE"`. Restano
      visibili la voce in pausa (lì la spinta non c'è, per una decisione precedente) e la voce per
      l'owner che non gioca (non è membro, non viene spinto, e la lobby per lui funziona).
      ⚠ Restringe la regola scritta in `lib/auction-nav.ts` — «le sezioni dipendono dal ruolo e mai
      dallo stato» — in **un caso solo**, con lo stato preso da `getAuctionOverview` e non dallo
      stream: la navigazione non diventa stato di gioco (regola 7). ⚠ E `activeSection` ora legge il
      catalogo intero: da qui in poi esiste una sezione **nascosta ma raggiungibile**, e senza quella
      modifica la lobby perderebbe il proprio titolo esattamente quando la voce è nascosta.
      **+6 test** (`tests/auction-nav.test.ts`, da 16 a 22). Il link della dashboard non è toccato:
      rimbalza ancora, ed è annotato in `docs/DECISIONS.md`
- [x] **M16-10** — Chiusura: merge `--no-ff` su `dev`, prova in locale con `pnpm bots` e un telefono
      in LAN, poi `CHANGELOG.md` e `package.json` a `v1.16.0`, merge su `main`, tag. **Nessun passo a
      mano sul server**, e va scritto nel changelog che non ce n'è: è l'informazione che si cerca
      quando il deploy dice «completato»
      → chiusa il 2026-08-22 con **`v1.16.0`**. ⚠ **Il numero è quello della spec e non quello che
      si sarebbe potuto dedurre**: in produzione c'era `v1.15.1`, e `package.json`, `CHANGELOG.md` e
      i tag concordavano tutti e tre — controllati prima di decidere, invece di contare a memoria.
      Il changelog dice per esteso che non c'è nessun passo a mano sul server

## Verifica

1. `pnpm test`, `pnpm typecheck` e `pnpm build` verdi.
2. **Nel modale ci sono `−1`, il campo e `+1`, e nient'altro che scriva una cifra.** `max NN` è ancora
   leggibile in alto a destra con la tastiera aperta.
3. **Non c'è nessun modo di ritirare un'offerta dall'interfaccia**: né nel modale, né sulla card, né
   in pausa, né nello spareggio.
4. **Un `POST /api/auctions/:id/action` con `{"type":"WITHDRAW"}` torna `INVALID_REQUEST`**, e
   `bids.withdrawn_at` resta `NULL`. È il punto della macro: la regola è del server.
5. **Un rilancio funziona ancora**, compreso il caso «stessa cifra» che risponde «sei già a NN» senza
   toccare il timestamp.
6. **Lo spareggio funziona ancora**, e `resolveRound` continua a risolvere per `MIN(amount_set_at)`.
7. **Lo storico delle correzioni non è cambiato**: un'asta già giocata mostra le stesse righe di
   prima, senza nessun ritiro comparso dal nulla.
8. **Il reveal di un'asta vecchia con un ritiro dentro si legge ancora**, col suo `line-through`.
9. **In TV ogni squadra ha il suo pallino**: verde chi è collegato (anche col tab in secondo piano),
   rosso chi non lo è. Con una simulazione accesa sono tutti verdi.
10. **Un telefono che si scollega diventa rosso entro ~15 secondi**, senza ricaricare la TV.
11. **I bot giocano un'asta simulata dall'inizio alla fine** senza un solo errore in console: è la
    verifica che togliere l'evento non ha rotto il loro giro.
