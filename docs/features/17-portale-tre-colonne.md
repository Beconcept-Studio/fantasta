# M17 — Il portale a tre colonne: la chiamata a pannello, e una colonna che si legge a colpo d'occhio

> **Stato:** **aperta** il 2026-08-22 su `feature/17-portale-tre-colonne`, da `dev` a `0bba393`.
> Baseline `pnpm test`: **858 test in 52 file**, cioè quella di `v1.16.0`. Task M17-01→08 e M17-11
> fatti; restano **M17-09** (la tavolozza guardata con una simulazione), **M17-10** (il gate finale) e
> **M17-12** (la chiusura). Pianificata lo stesso giorno. Nasce dalla terza richiesta del
> quaderno, insieme a **M16** — il taglio in due è spiegato in `16-regole-offerta.md` §0 e va letto
> prima di questa riga. **Esce dopo M16**, che toglie da `lot-card.tsx` un ramo che qui verrebbe
> ridisegnato per niente.
>
> ⚠ **Tocca lo schema del database? No. Tocca il motore? No.** Nessun `pnpm db:push`, nessun
> backfill, nessuna Server Action nuova, nessun evento nuovo. È **tutta** in `app/auctions/[id]/play/`,
> `components/auction/**` e `lib/realtime/portal.ts`. Il rilascio finisce col deploy.
>
> **Invarianti coinvolti:**
> **I10 e `PLAN §8bis`** sono il centro. Il pannello di chiamata è **il secondo modale che si apre da
> sé** dopo quello d'offerta, e vale per lui la stessa regola alla lettera: si apre in funzione dello
> snapshot, chiuderlo non nasconde niente, e chi ricarica la pagina a metà turno trova esattamente la
> stessa schermata di chi non si è mai mosso (§4).
> **I8** non è toccato: questa macro non aggiunge un solo campo a `serializeSnapshot` e non fa uscire
> niente che non uscisse già. ⚠ Va **verificato** e non dedotto, perché la colonna 3 mostra più cose
> insieme di prima: la regola è che non si renderizza niente che lo snapshot non porti già.
> **Regole coinvolte:** **1** (i countdown restano rendering: il pannello si chiude perché lo
> snapshot cambia fase, mai perché un timer del client è scaduto), **7** (ogni schermata è funzione
> pura dello snapshot: qui nasce un secondo `dismissed*`, e §4 dice perché resta l'unica forma
> ammessa di stato locale), **8** (`<Identity>` nasce **al** secondo chiamante, non prima).

## Obiettivo

Il portale è nato mobile-first e lo resta: si offre dal telefono, in piedi, con trenta secondi di
countdown. Ma metà della serata la si passa anche davanti a un portatile, e lì oggi il portale è una
colonna stretta al centro di uno schermo vuoto, con tutto in fila — l'intestazione, il lotto, la
propria rosa, gli altri — da scorrere per intero per sapere a che punto siamo.

Questa macro fa tre cose, e la terza è quella che conta:

1. **Su desktop il portale diventa tre colonne.** Chi ho, chi hanno gli altri, cosa sta succedendo:
   tre domande diverse, tre posti fissi, nessuno scroll.
2. **La chiamata diventa un pannello**, come l'offerta. Quando tocca a me, la cosa da fare arriva
   dal basso invece di stare in mezzo a una pagina che nel frattempo racconta altro.
3. **La colonna dello stato si legge senza leggere.** Non con font più grandi: con **la stessa
   anatomia in tutte le fasi** — label, badge e countdown sempre nello stesso pixel — e una fascia
   colorata che cambia con la fase. Ciò che si percepisce non è la scritta nuova: è la striscia che
   cambia colore in periferia dell'occhio.

Il tema, detto in una riga: *sullo schermo grande, sapere a che punto siamo non deve costare uno
scroll né una lettura.*

## Richieste che ci confluiscono

Tolte da `docs/REQUESTS.md` il 2026-08-22 — la parte sulla TV e quella sull'offerta vanno in **M16**.

- **Refactor UI elementi → Asta live.** «Desktop: il main vorrei fosse su tre colonne, con max-w-6xl
  come gli altri contenitori. Colonna 1: inglobo `<header className="bg-background/95 …">` e lo metto
  in una card + sezione "La tua rosa". Colonna 2: Sezione "Gli altri". Colonna 3: lo status dell'asta,
  tutte le card che parlano del lotto, dello stato del lotto, etc.»
- «Turno di chiamata: quando è il mio turno non devo vedere tutto nel layout a tre colonne, ma deve
  apparire un pannello overlay come quello del lotto live per fare l'offerta (pinnato sul basso della
  viewport) che mi fa scegliere il giocatore. Una volta scelto il pannello si chiude ed appare l'altro
  pannello per fare l'offerta.»
- «Tutte le box della colonna 3 devono essere maggiormente evidenziate per mostrare in modo più chiaro
  lo status dell'asta. Non vuole dire utilizzare font più grandi, ma una miglior scelta sulla palette
  in modo che a colpo d'occhio si capisca cosa sta succedendo. Le UI dovrebbero avere label, badge di
  stato, etc. sempre nello stesso luogo in card per essere più facilmente percepibili i cambiamenti.»

**Cinque decisioni dell'owner, prese il 2026-08-22**, tutte prima di scrivere una riga:

1. **Le tre colonne partono da `lg` (1024px).** Sotto, **il portale resta identico a oggi**: colonna
   unica, intestazione incollata in cima. Nessun ridisegno del telefono in questa macro.
2. **Su desktop l'intestazione incollata sparisce** e diventa la card in cima alla colonna 1, come
   dice la richiesta.
3. **Il pannello di chiamata vale ovunque, telefono compreso, ed è richiudibile** come quello
   d'offerta: stessa cornice, stesso comportamento, una forma sola da imparare.
4. **La colonna 3 è due card**: una di stato che non sparisce mai, e una di scena che cambia con la
   fase.
5. **La fase si vede da una fascia colorata di 4px in testa alla card**, non da un bordo o da un fondo
   tinto: il colore sta tutto in una striscia, il contenuto resta su fondo neutro.

---

## Spec

### 1. Cosa c'è oggi, letto nel codice

Letto il 2026-08-22. Il portale (`app/auctions/[id]/play/portal.tsx`, 264 righe) è già quasi tutto
quello che serve, e questa macro **sposta** più di quanto aggiunga.

`PortalHeader` sta fuori dal `<main>`, è `sticky top-0` e ha già `max-w-6xl` dentro — la larghezza
che la richiesta chiede per il main c'è già nell'intestazione e non nel corpo, che è `max-w-xl`.
Dentro il main, in fila: il banner della pausa, una fra sei schermate (`NOT_STARTED`, `COMPLETED`,
`LotCard`, `LotClosedCard`, `PickPanel`, `PickWaiting`), «La tua rosa», «Gli altri».

Quale schermata si veda è già una funzione pura — `portalScreen(snapshot, myMemberId)` — e l'unico
pezzo di stato locale di tutto il portale è `dismissedLotId`. **È da qui che questa macro parte**: la
struttura che serve esiste, e ciò che manca è dove mettere le cose.

⚠ **Nessuno di questi componenti è usato altrove.** Verificato: `PortalHeader`, `LotCard`,
`LotClosedCard`, `MembersPanel`, `PickPanel` e `PickWaiting` hanno **un solo chiamante**, il portale.
(`app/auctions/[id]/setup/members-panel.tsx` è un omonimo diverso, della configurazione.) Quindi
ridisegnarli non ha nessun effetto collaterale sulla regia, sulla lobby o sulla TV.

⚠ **E in questo progetto la UI non ha test di rendering**: non c'è `@testing-library`, non c'è jsdom.
I 51 file di test sono su funzioni pure e sul database. **Conseguenza vincolante per questa macro**:
tutto ciò che si può rendere una funzione pura — quale scena, quale tono, se il pannello è aperto —
**deve** esserlo e **deve** avere il suo test, perché è l'unica rete che questa macro può avere. Ciò
che resta è markup, e si verifica guardandolo.

### 2. Le tre colonne, e l'ordine nel DOM

Da `lg` in su: una griglia a tre colonne dentro `max-w-6xl`, cioè ~350px per colonna a 1024px. Sotto
`lg`: una colonna sola, esattamente com'è oggi.

- **Colonna 1** — la card d'identità (§3) e «La tua rosa»
- **Colonna 2** — «Gli altri»
- **Colonna 3** — la card di stato (§5) e la card di scena (§6)

⚠ **L'ordine nel DOM è quello del telefono, non quello del desktop**, ed è la sola trappola di questa
sezione. Sul telefono la prima cosa dopo l'intestazione deve restare **il lotto**: se le colonne
fossero scritte in ordine 1-2-3, chi gioca dal telefono dovrebbe scorrere oltre la propria rosa e
oltre gli altri per arrivare all'offerta — cioè il contrario di ciò che il portale fa oggi. Quindi il
DOM è **scena → rosa → altri**, e su desktop le colonne si rimettono in ordine con `lg:order-*`. È
tre classi, e va scritto nel codice perché letto senza spiegazione sembra un errore.

Il banner della pausa resta dov'è concettualmente — in cima alla colonna 3 — ma il suo contenuto è
assorbito dalla card di stato (§5): due avvisi di pausa uno sopra l'altro sono un avviso che si
ignora.

### 3. L'identità in due posti, scritta una volta

Su desktop l'intestazione incollata sparisce e i suoi numeri — squadra, slot riempiti, crediti, `max`
— diventano la prima card della colonna 1. Sul telefono la barra incollata resta, perché è il
requisito di `PLAN §15` preso alla lettera: `max_bid` è il numero che decide ogni offerta e non deve
mai uscire dallo schermo.

Quindi la stessa informazione vive in due contenitori diversi. **Non in due copie**: si estrae
`<Identity me={me} slots={slots} />`, e `PortalHeader` (`lg:hidden`) e la card della colonna 1
(`hidden lg:block`) la rendono entrambi.

⚠ È **il secondo chiamante**, quindi la regola 8 è soddisfatta e non anticipata: l'astrazione nasce
perché servono due contenitori, non perché un giorno potrebbero servirne tre.

⚠ E la barra `lg:hidden` **non** va sostituita da un `hidden` sul contenitore esterno: resta
`sticky`, e uno `sticky` dentro un contenitore di griglia si comporta in modo diverso da uno sticky
figlio del `<body>`. Il modo sicuro è tenerla dov'è oggi — fuori dal `<main>` — e nasconderla da `lg`.

### 4. Il pannello di chiamata

`PickPanel` smette di essere una sezione della pagina e diventa il corpo di uno sheet con **la stessa
identica cornice del `BidModal`**: `Dialog` di `radix-ui`, dal basso su mobile, in basso a destra da
`sm` (`sm:right-4 sm:bottom-4 sm:w-96`). Non «simile»: le stesse classi, perché due pannelli che si
alternano nello stesso punto della serata devono essere lo stesso oggetto con dentro cose diverse.

**Si apre da sé** quando tocca a me, e la condizione è una funzione pura gemella di
`shouldOpenBidDialog`, con il suo test:

```
shouldOpenPickSheet(snapshot, myMemberId, dismissedTurnKey)
  status === "LIVE" && phase === "WAITING_PICK"
  && currentMemberId === myMemberId
  && dismissedTurnKey !== turnKey(snapshot)
```

**Si chiude da sé** quando non tocca più a me — perché ho scelto, o perché è scaduto e ha scelto
l'auto-pick. Non è il pannello a chiudersi: è la condizione a diventare falsa quando arriva lo
snapshot successivo. È la regola 1 e la regola 7 nello stesso punto, ed è ciò che fa apparire il
modale d'offerta subito dopo senza che nessuno lo coordini.

⚠ **La chiave con cui «l'ho chiuso» viene ricordata è la scadenza della fase**, `phaseDeadline`.
Non `currentMemberId` e non `currentRole`: dentro un ruolo lo stesso posto chiama più volte, quindi
quella coppia si ripete e il pannello resterebbe chiuso per tutte le chiamate successive del turno di
quella persona. La conseguenza da conoscere è che **una pausa riapre il pannello**: al resume la
scadenza è un'altra, quindi la chiave non combacia più. Sembra giusto — la pausa finisce e la domanda
ti viene rifatta — ma è una cosa da giudicare usandola, ed è nella lista di verifica.

⚠ **Il rischio implementativo vero è l'altezza**, e non è il countdown. Il pannello d'offerta è corto;
questo contiene una ricerca, le pastiglie dei filtri di Carmy, la riga dell'auto-pick e fino a
quaranta righe di giocatori. Su un telefono con la tastiera aperta va costruito come il modale
d'offerta insegna: **intestazione fissa** (chi chiama cosa, countdown, barra) e **solo la lista che
scorre**, dentro il suo `overflow-y-auto`, con il pannello a `max-h-[85dvh]`. Se scorre tutto, il
countdown esce dallo schermo appena si digita — e quello è il difetto che rende un pannello peggiore
della pagina che sostituisce.

La card di scena «Tocca a te» (§6) porta il countdown e il pulsante che riapre il pannello: chiuderlo
non nasconde mai né il tempo che resta né la strada per tornare.

### 5. La card di stato

Prima cosa della colonna 3, **presente in ogni fase e in ogni stato dell'asta**, sempre alla stessa
altezza. Dice quattro cose e nient'altro:

- lo **stato** dell'asta — in corso / in pausa / non iniziata / conclusa — con il badge in alto a
  destra, che è il posto in cui si guarderà anche in tutte le altre card
- la **fase**, con la frase che esiste già: `phaseLabel(snapshot)`, la stessa che usano la TV e la
  regia. Non se ne scrive una seconda
- il **ruolo in gioco**
- **di chi è il turno**

⚠ Il badge di stato dell'asta torna **acceso** qui. Oggi in `portal-header.tsx` c'è commentato via
(righe 36-38): la card di stato è il posto in cui ha senso, ed è il motivo per cui quel commento va
tolto insieme al codice — un blocco commentato che riappare altrove è la cosa che fa dubitare di
entrambi.

### 6. La card di scena: una sola, con l'anatomia fissa

Sotto la card di stato, **una sola card** che cambia con la fase.

Le scene sono **nove** — non iniziata, conclusa, sta chiamando un altro, tocca a te, offerte aperte,
spareggio in preparazione, spareggio, buste da aprire, esito — e oggi le disegnano **sei** contenitori
(§1), perché due di essi ne coprono più d'una con un `if` interno: `LotCard` ne fa tre (offerte,
spareggio in preparazione, spareggio) e `LotClosedCard` due (buste da aprire, esito). Dopo questa macro restano nove
scene e **una** cornice: cambia il corpo, non il contenitore.

L'anatomia, uguale in tutte:

```
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀   ← la fascia, 4px, cambia colore
┌──────────────────────────────┐
│ label della scena    ⬤ badge │   ← sempre in questi due angoli
│                              │
│ [il corpo, che cambia]       │
│                       0:23   │   ← countdown e barra, sempre qui
│ ▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░░░░░░░░░░  │
│ [    l'azione, se c'è    ]   │   ← a piena larghezza, in fondo
└──────────────────────────────┘
```

È **questa** la parte che risponde alla richiesta, più della tinta: se il badge sta sempre in
quell'angolo e il countdown sempre in quel punto, l'occhio li controlla senza cercarli, e un
cambiamento si nota perché qualcosa **è cambiato lì**, non perché è comparso qualcosa da qualche
parte.

I corpi restano quelli che ci sono già — `LotCard`, `LotClosedCard`, `PickWaiting`, i due cartelli di
asta non iniziata e conclusa — svuotati della propria cornice: oggi ognuno si disegna il suo
`rounded-xl border`, il suo countdown e la sua intestazione, ognuno un po' diverso. Quello che
sparisce è la cornice ripetuta cinque volte; quello che resta è il contenuto.

⚠ **La scena non è la fase**, e il conto non torna se lo si dà per scontato: `LOT_OPEN` con
`roundNo = 2` è lo spareggio, cioè una scena diversa dalla stessa fase con `roundNo = 1`. La mappa
va scritta come funzione pura accanto a `phaseLabel`, con il suo test, ed è l'unico posto in cui la
tabella qui sotto esiste.

### 7. La tavolozza — **una proposta, non una decisione**

Otto toni, tutti da colori che l'applicazione usa già, nessun `dark:`, nessun tema nuovo, nessun
preset da applicare:

| Scena | Fascia |
|---|---|
| non iniziata · conclusa | grigio |
| sta chiamando un altro | grigio |
| **tocca a te** | nero pieno |
| offerte aperte (round 1) | verde |
| spareggio (`LOT_TIE_PREP`, e `LOT_OPEN` round 2) | ambra |
| buste da aprire (`LOT_SEALED`) | ambra scuro |
| esito (`LOT_REVEAL`) | verde pieno |
| **asta in pausa** | ambra a righe, **vince su tutte** |

La precedenza della pausa non è una scelta nuova: `phaseLabel` la applica già («la pausa vince su
tutto: in proiezione è la prima cosa che chi guarda deve poter leggere»), e la fascia segue la stessa
regola nello stesso file.

⚠ **Questa tabella si fissa guardandola su `dev`, ed è un criterio di chiusura della macro.** La
lezione è di **M15**, ed è costata tredici commit: un tema scelto a scatola chiusa è stato lavorato
per intero, guardato una volta e buttato. Qui il rischio è più piccolo — sono otto strisce di 4px,
non una tavolozza globale — ma la regola che se ne ricava è la stessa, e in `CLAUDE.md` è già scritta
per il tema scuro: **i colori si trattano guardandoli**. Il fatto che la mappa sia una funzione pura
in un posto solo è precisamente ciò che rende il cambio d'idea gratuito.

### 8. Cosa non entra (regola 8)

- **Nessun ridisegno del telefono.** Sotto `lg` questa macro non cambia niente, e la verifica lo dice.
- **Nessuna colonna configurabile, nessun pannello richiudibile, nessuna preferenza salvata.** Il
  layout è uno.
- **Niente di nuovo nello snapshot.** Se una card di questa macro avesse bisogno di un dato che lo
  snapshot non porta, quello è il segnale di fermarsi e chiedere, non di aggiungere un campo (I8).
- **Nessuno storico dei lotti nel portale**: è la terza card della colonna 3 che era stata proposta e
  scartata. Quella pagina esiste già ed è `/log`.
- **Nessun tocco alla regia, alla lobby, alla TV** — la TV la tocca M16 — né al modale d'offerta, che
  resta esattamente com'è dopo M16.
- **Nessun tema scuro**, in nessuna forma. Vale la regola di `CLAUDE.md`: nel portale una variante
  `dark:` è un colore che nessuno può guardare.

---

## Task

> Da rifinire all'apertura della macro. Sono la traduzione della spec, non un impegno preso nella
> sessione in cui è stata scritta.

- [x] **M17-01** — Aprire `feature/17-portale-tre-colonne` da `dev`, **dopo che M16 è su `dev`**.
      Rileggere questo file, `PLAN §8bis` e `PLAN §15`. `pnpm test` verde come baseline. Aprire una
      simulazione con i bot e **guardare il portale com'è oggi su un portatile**, prima di cambiarlo:
      è il termine di paragone e dopo non esisterà più
- [x] **M17-02** — `<Identity>` estratta e usata dai due contenitori (§3), con la barra `lg:hidden`
      lasciata dov'è nell'albero. Nessun cambiamento visibile sotto `lg`: è il primo task e serve a
      verificare che il telefono non si muova
- [x] **M17-03** — La griglia a tre colonne, con l'ordine del DOM del telefono e `lg:order-*` (§2), e
      il commento che spiega perché l'ordine è quello. Guardare a 1024, 1280 e 1440
- [x] **M17-04** — La card di stato (§5), col badge riacceso e il blocco commentato di
      `portal-header.tsx` tolto
- [x] **M17-05** — La cornice della card di scena e la mappa scena → tono come funzioni pure accanto a
      `phaseLabel`, **con i test** (§6, §7). ⚠ Il test che conta è quello sulla precedenza: in pausa
      il tono è quello della pausa **qualunque** sia la fase
- [x] **M17-06** — I corpi dentro la cornice: `LotCard`, `LotClosedCard`, `PickWaiting` e i due
      cartelli perdono la propria cornice, il proprio countdown e la propria intestazione (§6). È il
      task più lungo e va fatto una scena per volta, guardando
- [x] **M17-07** — Il pannello di chiamata (§4): la cornice del `BidModal` riusata, `shouldOpenPickSheet`
      e `turnKey` puri e testati, l'intestazione fissa con la sola lista che scorre. ⚠ Provare **sul
      telefono con la tastiera aperta**: se il countdown esce dallo schermo mentre si cerca un nome,
      il pannello è peggio della pagina che sostituisce e va rifatto, non accettato
- [x] **M17-08** — La card «Tocca a te» nella colonna 3, col countdown e il pulsante che riapre il
      pannello. Provare il giro completo: pannello → scelgo → si chiude → si apre l'offerta
- [ ] **M17-09** — La tavolozza, **guardata** con una simulazione che gira: le otto scene una dopo
      l'altra, e la pausa dentro ciascuna. Correggere qui, non «più avanti» (§7)
- [ ] **M17-10** — Gate: `pnpm test`, `pnpm typecheck`, `pnpm build` verdi (⚠ build con dev server
      spento; la prima dopo una sessione di `pnpm dev` può morire da sola e passare al secondo giro)
- [x] **M17-11** — Documentazione: `docs/DECISIONS.md` con le cinque decisioni del 2026-08-22 e
      l'esito della tavolozza guardata; `docs/ARCHITECTURE.md`, il capitolo del portale, che oggi
      descrive una colonna sola
- [ ] **M17-12** — Chiusura: merge `--no-ff` su `dev`, prova a due dispositivi (portatile + telefono
      in LAN) con i bot, `CHANGELOG.md` e `package.json` a `v1.17.0`, merge su `main`, tag. Nessun
      passo a mano sul server, e va scritto nel changelog che non ce n'è

## Verifica

1. `pnpm test`, `pnpm typecheck` e `pnpm build` verdi.
2. **Sotto 1024px il portale è identico a prima**: colonna unica, barra incollata in cima, il lotto
   come prima cosa dopo l'intestazione. Questa è la verifica che protegge il dispositivo con cui si
   gioca davvero.
3. **Da 1024px in su ci sono tre colonne dentro `max-w-6xl`**, e la barra incollata non c'è più: i
   suoi numeri sono la prima card della colonna 1.
4. **Crediti e `max` dicono lo stesso numero nei due contenitori**, perché sono lo stesso componente.
5. **La card di stato c'è in ogni fase**, sempre allo stesso posto, anche ad asta non iniziata e a
   asta conclusa.
6. **In tutte le scene il badge è nello stesso angolo e il countdown nello stesso punto.** Passando da
   una fase all'altra non si sposta niente tranne il corpo.
7. **La fascia cambia colore a ogni cambio di scena**, e in pausa è quella della pausa qualunque sia
   la fase.
8. **Quando tocca a me il pannello si apre da solo**, sul telefono e sul portatile, con la stessa
   cornice del pannello d'offerta.
9. **Scelto il giocatore il pannello si chiude da sé e si apre quello dell'offerta**, senza toccare
   niente.
10. **Se scade il turno mentre il pannello è aperto, si chiude da sé** e l'auto-pick fa il suo lavoro.
11. **Chiudendo il pannello la colonna 3 dice ancora quanto tempo resta**, e il pulsante lo riapre.
12. **Ricaricando la pagina a metà turno si ritrova il pannello aperto** con la stessa lista: è I10, e
    va provato davvero premendo F5.
13. **Sul telefono, con la tastiera aperta e una ricerca in corso, il countdown resta visibile.**
14. **Dopo una pausa e un resume il pannello di chiamata si riapre**, ed è il comportamento voluto
    (§4): se guardandolo non convince, si cambia la chiave, non si accetta.
15. **Niente `dark:` nel codice nuovo**, e la TV è intatta.
