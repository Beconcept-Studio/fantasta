# M18 — La rosa a fisarmonica: i ruoli che si aprono, la quota di budget per reparto, e i giocatori in ordine di estrazione

> **Stato:** **pianificata**, non aperta. Nasce dalle due richieste che l'owner ha scritto nel
> quaderno dopo `v1.17.0`, ed è **una macro sola**: stesso file, stesso profilo di rischio, un tag
> solo (§0).
>
> ⚠ **Tocca lo schema del database? No. Tocca il motore? No.** Nessun `pnpm db:push`, nessun
> backfill, nessun file da caricare, nessuna dipendenza nuova — `radix-ui` è già in `package.json` e
> l'accordion viene da lì. Nessun campo nuovo in `serializeSnapshot`, nessun evento nuovo, nessuna
> Server Action nuova. È tutta in `components/auction/roster-grid.tsx`,
> `app/tv/[publicToken]/tv-view.tsx` e `lib/realtime/portal.ts`. **Il rilascio finisce col deploy.**
>
> **Invarianti coinvolti:**
> **I8** non è toccato, e va detto perché invece di darlo per scontato: questa macro non aggiunge un
> solo campo allo snapshot e non renderizza niente che lo snapshot non porti già. Le percentuali si
> calcolano da `credits` e da `roster`, che sono in ogni snapshot per tutti da v1.0.0; l'ordine
> cronologico **toglie** un riordino nel client invece di aggiungere un dato. La rosa mostrata è
> sempre e solo la propria (`me`) o, in regia, quella che la regia già vede.
> **I10 / `PLAN §8bis`** è il punto delicato: la fisarmonica introduce **stato locale nella colonna
> della rosa**, che finora non ne aveva. §4 dice qual è la forma ammessa — una chiave che si azzera al
> cambio ruolo — e perché chi ricarica la pagina non perde niente di leggibile.
> **Regole coinvolte:** **7** (la rosa resta funzione pura dello snapshot: la fisarmonica decide
> *cosa è aperto*, mai *cosa c'è dentro*), **8** (due chiamanti con due forme diverse → due
> componenti nello stesso file e un corpo condiviso, non una prop booleana che cambia due cose),
> **6** non è in gioco: qui non si scrive niente.

## §0 — Perché una macro sola

Le due richieste toccano **lo stesso file** — `components/auction/roster-grid.tsx` — e hanno lo
stesso profilo di rischio: zero motore, zero schema, zero passi a mano, un gate che sta quasi tutto
in `pnpm build` e in mezz'ora di simulazione guardata. Il criterio con cui sono state tagliate M5/M6,
M9–M12, M13/M14 e M16/M17 è **il rischio**, non il tema: due tag servono quando tornare indietro
sull'una non deve portarsi via l'altra. Qui tornare indietro vuol dire tornare indietro su una
colonna del portale, e le due cose ci stanno insieme.

⚠ **La seconda richiesta però esce anche dalla colonna del portale**: l'ordine cronologico vale
anche per la TV e per la regia (§2), e quella parte non è «cosmetica del portale» — è il tabellone
proiettato. Va guardata sul proiettore, non solo sul portatile.

## Obiettivo

A metà asta, guardando la propria rosa, uno si fa due domande e oggi il portale risponde male a
entrambe.

La prima è **«quanto ho messo dove»**. Oggi la colonna dice `4/8` per i difensori: quanti me ne
mancano, non quanto mi sono costati. Il conto di quanto budget è finito in un reparto — l'unico
numero su cui in un'asta si decide se si sta esagerando — bisogna farlo a mente sommando i prezzi
riga per riga, mentre scorre un countdown.

La seconda è **«chi ho preso»**, e la risposta è oggi una lista lunga: ventotto righe a rosa piena,
tutte aperte, tutte insieme, su un telefono. Su desktop occupa una colonna intera; sul telefono è
metà dello scroll fra il lotto e gli altri partecipanti.

E c'è una terza cosa, che nessuno chiedeva ma che tutti hanno visto: **la lista si rimescola**. È
ordinata per prezzo, quindi un acquisto da 45 crediti non si aggiunge in fondo al reparto: si mette
in cima e spinge giù tutto quello che si era appena finito di leggere. La rosa non è una classifica,
è un diario — l'ordine in cui le cose sono accadute è l'unico che non cambia sotto gli occhi.

Il tema, in una riga: *la propria rosa deve dire quanto è costato ogni reparto, stare in poche righe,
e non rimescolarsi mai.*

## Richieste che ci confluiscono

Tolte da `docs/REQUESTS.md` il 2026-08-22.

- **La tua rosa.** «In "asta live", nella sezione "La tua rosa", voglio che i ruoli siano degli
  accordion. Oltre a quello voglio che vicino al nome del ruolo venga inserito tra parentesi la %
  spesa per quel reparto.»
- **Ordinamento calciatori in asta.** «Durante un'asta, nelle visualizzazioni (Asta live e TV),
  l'ordine dei calciatori per ruolo è definito per valore, non per data di assegnazione.
  L'ordinamento deve quindi seguire la data di estrazione.»

**Quattro decisioni dell'owner, prese il 2026-08-22**, tutte prima di scrivere una riga:

1. **La percentuale è sui crediti a disposizione**, non sulla spesa fatta: «se spendo 250 su 500 sui
   portieri, ho investito il 50%». Il denominatore è il **budget**, non il totale già speso (§3).
2. **Il ruolo in gioco si apre da sé.** La fisarmonica non parte tutta chiusa: il reparto che l'asta
   sta chiamando adesso è aperto, e al cambio di ruolo si sposta l'apertura (§4).
3. **La fisarmonica vale solo in `/play`.** In regia la rosa dei membri resta piatta come oggi: lì
   serve leggere 8–12 rose a colpo d'occhio, e un accordion le nasconderebbe tutte (§5).
4. **L'ordine cronologico vale ovunque**: portale, regia e TV. Tre viste e il verbale che dicono la
   stessa cosa (§2).

---

## Spec

### 1. Cosa c'è oggi, letto nel codice

**`RosterGrid`** ([roster-grid.tsx](../../components/auction/roster-grid.tsx)) disegna i quattro
ruoli nell'ordine fisso `P → D → C → A`, e per ognuno: un `<h3>` con l'etichetta, `n/tot` a destra
in `tabular-nums`, la lista dei presi, e in coda gli slot vuoti come caselline con «N da comprare».
Ha **due chiamanti**, e sono diversissimi:

| Chiamante | Cosa mostra | Cosa serve lì |
|---|---|---|
| [portal.tsx:299](../../app/auctions/[id]/play/portal.tsx#L299) | **una** rosa, la mia, in colonna 1 | poche righe, e i miei numeri |
| [console.tsx:310](../../app/auctions/[id]/manage/console.tsx#L310) | **8–12** rose, una per card | tutto aperto, a colpo d'occhio |

Nello stesso file vive `SlotsSummary`, che ha altri due chiamanti (`identity.tsx`,
`members-panel.tsx`) e **questa macro non lo tocca**.

**La TV** costruisce le sue righe in `boardRows`
([tv-view.tsx:284](../../app/tv/[publicToken]/tv-view.tsx#L284)): sempre `slot totali` righe per
ruolo, anche a rosa vuota, che è ciò che tiene le card alte uguali e la griglia ferma. La lettera del
ruolo compare solo sulla prima riga del gruppo, e il giocatore appena vinto è evidenziato
(`wonPlayerId`).

**L'ordine per valore è scritto in due posti soli**, e sono questi due:
[roster-grid.tsx:28](../../components/auction/roster-grid.tsx#L28) e
[tv-view.tsx:291](../../app/tv/[publicToken]/tv-view.tsx#L291), entrambi
`.sort((a, b) => b.price - a.price)`. **Il verbale delle rose (M3) non ordina per prezzo**: `export.ts`
non ha un `sort`, quindi esce nell'ordine del database. Cioè: il documento che resta è già giusto, e
sono le due viste a raccontarlo in un altro ordine.

### 2. L'ordine di estrazione: il dato c'è già, e non va aggiunto niente

Questa è la cosa da non riscoprire da capo, perché la strada ovvia — «serve un `assignedAt` nello
snapshot» — porta a toccare `serializeSnapshot`, cioè il punto più delicato dell'app, **per niente**:

- `loadAuctionState` legge `assignments` con
  `.orderBy(asc(assignments.createdAt), asc(assignments.id))`
  ([mutate.ts:324](../../lib/engine/mutate.ts#L324));
- `serializeMembers` filtra per membro e mappa **senza riordinare**
  ([snapshot.ts:99](../../lib/engine/snapshot.ts#L99));
- quindi **`member.roster` è già in ordine di estrazione**, e i due `.sort()` del client lo stanno
  disfacendo.

⚠ E il `createdAt` è **quello del motore**, non un `now()` del database: `persistAuctionState` scrive
`createdAt: toDate(a.createdAt)` ([mutate.ts:677](../../lib/engine/mutate.ts#L677)). Vale la pena
saperlo perché è ciò che rende l'ordine giusto anche **nei dati del seed**: l'asta prodotta da
`pnpm db:seed --auction-status=mid` è simulata in memoria con un timestamp diverso per lotto e poi
persistita con quei timestamp. Se `createdAt` fosse stato un `defaultNow()`, tutte le assegnazioni
scritte nella stessa transazione avrebbero condiviso il `now()` di quella transazione — `now()` in
Postgres è per transazione, non per statement — e in locale l'ordine dentro un reparto sarebbe stato
arbitrario, cioè un finto bug da inseguire.

**La modifica è quindi sottrattiva**: si tolgono i due `.sort()`. Restano il `.filter()` per ruolo e,
in TV, tutto il resto di `boardRows`.

**L'ordine è crescente: prima preso, prima in lista.** Un acquisto nuovo si aggiunge **in fondo** al
suo reparto e non sposta niente di ciò che c'era sopra — che è esattamente il male che la richiesta
descrive. In TV ha un secondo effetto che conviene sapere in anticipo: **il giocatore appena vinto è
sempre l'ultima riga piena del suo gruppo**, cioè un posto fisso, mentre oggi l'evidenziazione
compare dove il prezzo la manda.

⚠ **Una riassegnazione va in fondo**, e non è un difetto: `voidAssignment` + `manualAssign` creano una
riga nuova, con il `createdAt` del momento in cui la correzione è stata fatta. La rosa dice quando le
cose sono state decise, e una correzione è stata decisa allora. **«Annulla lotto» (M14) non lascia
traccia**, perché nel cancello dei risultati non c'è ancora nessuna assegnazione da annullare.

**Il tie-break resta `id`**, un uuid casuale: si applica solo a due assegnazioni con lo stesso
millisecondo di motore, cioè in pratica mai (un lotto si risolve per volta, e un `manualAssign` è un
click umano). Non serve niente di meglio, ma se un giorno l'ordine sembrasse arbitrario **su due
righe sole**, il sospetto è questo e non il resto.

**Un test lo fissa**, perché oggi quella garanzia non è scritta in nessun posto e la prossima
modifica a `mutate.ts` o a `serializeMembers` potrebbe togliersela senza che niente protesti. Va in
`tests/db/snapshot.test.ts`, che è il file che già guarda `roster`: due assegnazioni allo stesso
membro e nello stesso ruolo, **la seconda più costosa della prima**, e l'asserzione che
`roster.map(r => r.playerId)` sia in ordine di creazione. È un test che oggi passerebbe da solo — ed
è precisamente il motivo per cui va scritto: rende **dichiarata** una proprietà che oggi è solo vera.

### 3. La quota di budget per reparto

**Il denominatore è il budget, non la spesa** (decisione 1). Il budget iniziale non viaggia nello
snapshot e non serve: `crediti + speso` lo ricostruisce, ed è la stessa identità con cui si controlla
a vista che i conti tornino (I3) — sta già scritta nel commento di `spentCredits`
([manage.ts:152](../../lib/realtime/manage.ts#L152)).

```
quota(ruolo) = round( 100 × Σ prezzi(ruolo) / (crediti + Σ prezzi) )
```

Con l'esempio dell'owner: 250 spesi sui portieri e 500 di budget → **50%**.

Perché il budget e non la spesa fatta: la quota sulla spesa è **volatile e insegna poco**. Al primo
acquisto il reparto sta al 100%; a metà asta dice come si è distribuito ciò che si è speso, non
quanto budget è impegnato. La quota sul budget invece è confrontabile con la ripartizione che uno si
è prefissato prima di sedersi — è il numero su cui si decide se fermarsi — e **le quattro
percentuali non fanno 100**: ciò che manca sono i crediti ancora in cassa, che è a sua volta
un'informazione.

⚠ **Le rettifiche di budget (I3) entrano nel denominatore**, e va detto: `credits` include già
`Σ ledger.delta`, quindi il denominatore è il budget **corrente**, non quello di partenza. È la
lettura giusta di «crediti a disposizione», ed è anche l'unica onesta — dopo una rettifica le
percentuali si spostano tutte, perché è cambiato il totale su cui si sta ragionando.

**Dove vive il calcolo.** In `lib/realtime/portal.ts`, funzione pura, testata in
`tests/portal.test.ts` — è la stessa ragione per cui ci vivono `bidBounds` e `sceneTime`: i test
girano in ambiente `node`, in millisecondi, senza DOM. Un export solo:

```ts
/**
 * Quanto del budget a disposizione è finito in ogni reparto, in percentuale
 * intera. `null` per un ruolo quando il budget è 0 — non si divide per zero e
 * non si scrive `NaN%` in faccia a nessuno.
 */
export function quotaPerRuolo(member: SnapshotMember): Record<Role, number | null>
```

⚠ **Non si sposta `spentCredits` da `manage.ts`.** Serve un totale, e sta dentro `quotaPerRuolo`:
spostare una funzione che ha già un chiamante contento è un refactor che questa macro non ha chiesto
(regola 8).

**Il caso limite conta poco ma va scritto**: `crediti + speso = 0` è impossibile in pratica
(`budgetInitial` è positivo e I3 tiene i crediti ≥ slot residui), quindi la guardia non è una
precauzione contro la realtà — è contro il `NaN%` che comparirebbe in un test o in un'asta
manipolata a mano dalla regia. `null` → non si scrive niente fra parentesi.

**Come si legge a schermo.** La percentuale sta **nella riga del ruolo**, quindi si vede anche a
reparto chiuso — che è tutto il punto della richiesta. Arrotondata all'intero, in colore attenuato,
subito dopo l'etichetta:

```
▸ Portieri (3%)          1/3
▸ Difensori (12%)        4/8
▾ Centrocampisti (21%)   3/8
     Barella      INT     45
     Zaccagni     LAZ     28
     Frattesi     INT     12
     □ □ □ □ □   5 da comprare
▸ Attaccanti (34%)       2/6
```

**A zero speso si scrive `(0%)`**, non niente: è la lezione di M17 sull'anatomia fissa — un numero
che compare solo a volte costringe a chiedersi perché non c'è, e il posto in cui guardare deve
essere sempre lo stesso.

### 4. La fisarmonica, e il ruolo in gioco che si apre da sé

`Accordion` da `radix-ui`, importato direttamente come già fanno `Dialog` in `bid-modal.tsx` e
`pick-panel.tsx`, `Toast` in `users-table.tsx`, `Switch` in `user-panel.tsx`. **Nessun file nuovo in
`components/ui/`**: un accordion con un chiamante solo non è una primitiva del design system, ed
`npx shadcn add` riscriverebbe `layout.tsx` (l'inciampo di M15) per aggiungere un involucro attorno
allo stesso pacchetto che è già installato.

`type="single"` e `collapsible`: **un reparto aperto per volta**, e si può chiudere anche quello.
Sotto `lg` la rosa è una colonna piena di telefono, e due reparti aperti insieme rimetterebbero lo
scroll che questa macro toglie.

**Il ruolo in gioco è quello aperto** (decisione 2), e il modo di ottenerlo è la parte da non
complicare. La forma sbagliata è un `useEffect` che sincronizza `auction.currentRole` in uno stato
locale: due sorgenti di verità, e un click dell'utente che viene sovrascritto al prossimo snapshot —
cioè un accordion che si richiude sotto le dita ogni due secondi. La forma giusta è una **chiave**:

```tsx
<Accordion.Root
  key={snapshot.auction.currentRole ?? "nessuno"}
  type="single"
  collapsible
  defaultValue={snapshot.auction.currentRole ?? ""}
>
```

Non serve nient'altro, e la proprietà che ne esce è esattamente quella voluta: **la scelta a mano
vale finché il ruolo in gioco non cambia**. Aperti i difensori mentre l'asta chiama i centrocampisti,
restano aperti — nessuno snapshot li richiude — ma quando l'asta passa agli attaccanti la
fisarmonica si rimonta con gli attaccanti aperti. Lo stato locale non è mai *contro* lo snapshot: è
azzerato da lui.

⚠ **È la stessa famiglia dei `dismissed*` di M17** (il pannello richiuso che si riapre a chiave
nuova), e sta dentro I10 per la stessa ragione: **niente è raggiungibile solo perché eri qui prima**.
Chi ricarica la pagina ritrova il reparto in gioco aperto e gli altri chiusi, cioè lo stato di chi non
si è mai mosso, e **nessuna informazione vive solo dentro un pannello aperto** — la riga chiusa dice
già nome, quota e `n/tot`. È quello che rende accettabile perdere l'apertura con un F5.

**Con `currentRole = null` tutto è chiuso.** Succede ad asta non iniziata e ad asta conclusa. A fine
asta, quindi, la rosa completa si presenta come quattro righe chiuse con le quattro quote e i quattro
`n/tot` — che è il riepilogo giusto per quel momento — e chi vuole i nomi apre. È una scelta, non una
dimenticanza: la variante «a `null` apro il primo reparto» darebbe un reparto aperto a caso.

**La riga chiusa ha tre cose e sempre nello stesso posto**: chevron, etichetta con la quota,
`n/tot`. Il chevron ruota, `Accordion.Header` porta l'`<h3>` che oggi è già lì e
`Accordion.Trigger` fa il resto — gli `aria-expanded`, gli id e la navigazione da tastiera li mette
radix, e non vanno riscritti a mano.

⚠ **Il corpo aperto è quello di oggi, identico**: le righe dei presi e le caselline degli slot vuoti
con «N da comprare». Questa macro non ridisegna la riga del giocatore.

### 5. Due componenti nello stesso file, non una prop booleana

La fisarmonica vale solo in `/play` (decisione 3), quindi `roster-grid.tsx` deve servire due forme.
La strada breve — `<RosterGrid fisarmonica />` — accende **due cose diverse** con un booleano (la
fisarmonica *e* le percentuali) e lascia dentro un componente due alberi che non si somigliano. La
strada giusta, con due chiamanti veri e diversi (§1), è:

- **`RosterGrid`** — quella di oggi meno il `.sort()`. Resta la regia, senza percentuali: là accanto
  c'è già la `Figure` «speso», e dodici card con quattro percentuali ciascuna sono quarantotto numeri
  che nessuno legge.
- **`RosterAccordion`** — il portale: fisarmonica, quote, chiave sul ruolo in gioco.
- **un corpo privato condiviso** nello stesso file per le righe dei presi e le caselline: è l'unica
  cosa davvero uguale nelle due forme, e duplicarla vorrebbe dire ritoccarla due volte per sempre.
  Non si esporta — è un dettaglio di questo file, non un'astrazione (regola 8).

⚠ **Il file prende `"use client"`**, perché la fisarmonica ha stato. Non costa niente e va
verificato invece che dedotto: `portal.tsx` e `console.tsx` sono **già** `"use client"`, e
`members-panel.tsx` e `identity.tsx` — che importano `SlotsSummary` da questo file — sono importati
solo da quei due. Nessun componente server perde niente.

### 6. Cosa non entra (regola 8)

- **Niente fisarmonica in regia**, e niente percentuali lì (decisione 3).
- **Niente percentuali in TV.** Il tabellone ha 8–12 card in una griglia e righe di altezza fissa:
  quattro numeri in più per card è rumore su un proiettore, e nessuno li ha chiesti. In TV cambia
  **solo** l'ordine.
- **Niente `assignedAt` nello snapshot** (§2), niente colonne nuove, niente `pnpm db:push`.
- **Niente animazioni di apertura** oltre a quelle che radix dà con `tw-animate-css`: sono le stesse
  che i due pannelli usano già.
- **Niente memoria dell'apertura fra un caricamento e l'altro** (nessun `localStorage`): §4 dice
  perché la chiave basta, e nessuno l'ha chiesta.
- **Niente ordine dei ruoli secondo `roleOrder`.** M17 ha tolto quel dato dal portale su richiesta
  dell'owner, e `RosterGrid` elenca `P → D → C → A`: questa macro non riapre quella decisione, e la
  fisarmonica non la reintroduce di contrabbando — il reparto in gioco si riconosce perché è quello
  aperto.
- **Niente riordino del verbale delle rose**: è già cronologico (§1), e dopo questa macro le viste
  gli si allineano invece che il contrario.

---

## Task

> Da rifinire all'apertura della macro. Sono la traduzione della spec, non un impegno preso nella
> sessione in cui è stata scritta.

- [x] **M18-01** — Aprire `feature/18-rosa-a-fisarmonica` da `dev`. Rileggere questo file e `PLAN
      §8bis`. `pnpm test` verde come baseline. Aprire una simulazione con i bot (⚠ il seed non basta:
      i posti sono dei dodici utenti di prova con `bot_strategy` a `NULL`, serve `pnpm bots`) e
      **guardare com'è oggi** la rosa nei tre posti — portale su portatile, portale sul telefono in
      LAN, TV — prima di cambiarla: è il termine di paragone e dopo non esisterà più
      → Baseline **897 test in 52 file**, verde. Simulazione a 8 posti con 7 bot: **200 lotti, 533
      azioni, 0 rifiutate**, arrivata a `COMPLETED` in 14,5 minuti. ⚠ **Il paragone visivo sulle tre
      viste non è stato fatto**: l'owner ha deciso di procedere senza (2026-08-22), quindi il termine
      di paragone di questa macro è **quello misurato dal database** e non uno sguardo. Nella rosa del
      seat 7 (13 giocatori): fra i difensori **Vojvoda a 19, quarto preso, stava in cima** e spingeva
      giù i tre comprati prima di lui, e i quattro difensori da 1 credito avevano fra loro un ordine
      arbitrario. Quote attese a mano, su un denominatore di 500: **P 5% · D 13% · C 6% · A 0%** —
      24% impegnato, il resto in cassa, cioè le quattro quote che non fanno 100 di §3. ⚠ Confermato
      anche il punto sul `createdAt` del motore: i quattro difensori da 1 credito hanno **timestamp
      distinti**, quindi in locale l'ordine dentro un reparto è stabile e non arbitrario
- [x] **M18-02** — L'ordine di estrazione: via i due `.sort()` (§2), con il commento che dice **perché**
      l'ordine dello snapshot è affidabile — il `createdAt` è del motore, non un `now()` del database
      — e il test in `tests/db/snapshot.test.ts` che fissa la garanzia. Guardare la TV: il giocatore
      appena vinto deve essere l'ultima riga piena del suo gruppo
      → I due `.sort()` sono via; `grep` su `app/`, `components/` e `lib/` non trova più nessun
      riordino per prezzo. ⚠ **Il «perché» è scritto una volta sola e non due**, e non nei due
      consumatori: sta in `serializeMembers` (`lib/engine/snapshot.ts`), cioè **dove la garanzia è
      prodotta** e dove guarderebbe chi un giorno pensasse di riordinare lì — con l'avviso che un
      `.sort()` aggiunto in quel punto adesso cambia **tre** schermate. Le due viste portano un
      rimando corto. `tests/db/snapshot.test.ts` passa da 9 a **11 test**: il primo fissa l'ordine di
      creazione con **la seconda assegnazione più costosa della prima** (l'unico modo di distinguerlo
      dall'ordine per prezzo), il secondo che una **riassegnazione va in fondo**. La riga sui prezzi
      crescenti è quella che diventerebbe rossa per prima se qualcuno rimettesse un riordino.
      ⚠ La verifica visiva sulla TV resta a M18-06
- [x] **M18-03** — `quotaPerRuolo` in `lib/realtime/portal.ts` e i suoi test in `tests/portal.test.ts`
      (§3): l'esempio dell'owner 250 su 500 = 50%, l'arrotondamento, il ruolo a zero che fa `0%`, il
      budget 0 che fa `null`, e una rettifica di `ledger` che sposta tutte e quattro le quote
      → `tests/portal.test.ts` passa da 70 a **80 test**. Dentro anche i due casi che spiegano la
      decisione invece di solo verificarla: che al primo acquisto il reparto **non** è al 100% (è il
      motivo per cui il denominatore è il budget), e che le quattro quote sommano 30 e non 100 con il
      resto in cassa. La rettifica si prova come la vede il client — `credits` include già
      `Σ ledger.delta`, quindi due membri con la stessa rosa e crediti diversi danno quote diverse.
      **`spentCredits` non è stato spostato** da `manage.ts`: il totale se lo calcola `quotaPerRuolo`
- [x] **M18-04** — `RosterAccordion` e il corpo condiviso in `roster-grid.tsx` (§5), con `"use client"`
      e `Accordion` da `radix-ui`. La riga chiusa a tre elementi: chevron, etichetta con la quota,
      `n/tot`. **Nessun `dark:`**
      → Fatto: `RosterGrid` (regia, piatta), `RosterAccordion` (portale) e `RosterBody` privato, più
      `ownedOf` — che è dove vive il commento sul non-riordino, con due chiamanti veri. ⚠ **Verificato
      invece che dedotto**: `Accordion.Header` rende un `Primitive.h3`, quindi **è** l'`<h3>` che
      c'era già e non va aggiunto un secondo titolo dentro. Le animazioni sono
      `animate-accordion-down/up`, che `tw-animate-css` ha già con la variabile
      `--radix-accordion-content-height`: nessun keyframe da scrivere in `globals.css`. Nessun `dark:`,
      nessun file nuovo in `components/ui/`, nessuna dipendenza aggiunta. Typecheck e lint verdi
- [ ] **M18-05** — La chiave sul ruolo in gioco (§4), e provarla per davvero con la simulazione che
      gira: apro un reparto a mano e **resta aperto** al passare degli snapshot; al cambio di ruolo
      l'apertura si sposta; a `currentRole = null` è tutto chiuso; F5 a metà asta ritrova il reparto
      in gioco aperto
- [ ] **M18-06** — Guardare, e correggere qui invece che «più avanti»: portale sul telefono (quante
      righe si vedono senza scorrere, ora, fra lotto e rosa), portale su portatile, **regia intatta**,
      TV sul proiettore o a schermo pieno. È il task in cui M17 ha trovato cinque cose che la spec non
      prevedeva
- [ ] **M18-07** — Gate: `pnpm test`, `pnpm typecheck`, `pnpm build` verdi (⚠ build con dev server
      spento; la prima dopo una sessione di `pnpm dev` può morire da sola e passare identica al
      secondo giro). Documentazione: `docs/DECISIONS.md` con le quattro decisioni del 2026-08-22 e
      l'esito di M18-06; `docs/ARCHITECTURE.md`, il capitolo del portale
- [ ] **M18-08** — Chiusura: merge `--no-ff` su `dev`, prova a due dispositivi con i bot,
      `CHANGELOG.md` e `package.json` a `v1.18.0`, merge su `main`, tag. **Nessun passo a mano sul
      server**, e va scritto nel changelog che non ce n'è

## Verifica

1. `pnpm test`, `pnpm typecheck` e `pnpm build` verdi.
2. **In `/play` i quattro reparti sono righe cliccabili**, con la quota fra parentesi accanto
   all'etichetta e `n/tot` dove è sempre stato.
3. **La quota è quella del budget**: con 250 spesi sui portieri su un budget da 500 si legge `(50%)`.
   Si verifica a mano, sommando i prezzi di un reparto e dividendo per `crediti + speso`.
4. **A reparto vuoto si legge `(0%)`**, non uno spazio bianco.
5. **Le quattro quote non fanno 100**, e ciò che manca sono i crediti in cassa. È voluto (§3).
6. **Il reparto che l'asta sta chiamando è aperto**, e al cambio di ruolo l'apertura si sposta da sé.
7. **Un reparto aperto a mano non si richiude da solo** al passare degli snapshot — è la verifica che
   distingue la chiave da un `useEffect` sbagliato, e va fatta stando fermi dieci secondi a guardare.
8. **Ricaricando la pagina a metà asta** si ritrova il reparto in gioco aperto e gli altri chiusi.
9. **Ad asta conclusa la rosa è quattro righe chiuse** con quote e `n/tot`, e i nomi si aprono.
10. **In `/play`, in regia e in TV i giocatori sono in ordine di acquisto**, il primo preso in cima:
    un acquisto nuovo compare **in fondo** al suo reparto e non sposta niente sopra di sé.
11. **In TV il giocatore appena vinto è l'ultima riga piena del suo gruppo**, e le card restano alte
    uguali: `boardRows` continua a produrre `slot totali` righe.
12. **Le tre viste e il verbale delle rose dicono lo stesso ordine.** Si controlla scaricando il
    verbale e confrontandolo con una card della TV.
13. **La regia è identica a prima** tranne l'ordine: nessuna fisarmonica, nessuna percentuale.
14. **Niente `dark:` nel codice nuovo**, e la TV resta bianco su nero com'era.
15. **Sul telefono la rosa chiusa sta in quattro righe**, e fra il lotto e «Gli altri» non c'è più
    mezzo schermo di scroll.
