# M2 — Navigazione e identità delle pagine

> **Stato:** aperta · **Aperta il** 2026-08-10
> **Tocca lo schema del database?** No. Nessun `pnpm db:push` dopo il deploy.
> **Invarianti coinvolti:** I8 e I10 (nessuno dei due cambia: la macro non tocca né
> `serializeSnapshot` né il motore), regole 3, 7 e 8.

## Obiettivo

L'applicazione ha cinque schermate — configurazione, lobby, regia, portale, TV — e cinque
navigazioni diverse, una per pagina, scritte a mano ognuna per conto suo. La regia ha cinque link
testuali in cima; il portale ne ha due **in fondo alla pagina**, cioè sotto tutto, che sul telefono
significa dopo uno scroll completo; lobby e setup ne hanno due ciascuna, e nessuna delle quattro
porta dove portano le altre.

Il sintomo che ha fatto aprire questa macro è preciso: **la voce «Pannello di configurazione» punta
alla lobby**, in due posti diversi — nell'intestazione della setup e sulla card d'attesa del
portale. Chi cerca la configurazione clicca esattamente quella voce e finisce altrove; la
configurazione dei tempi ad asta iniziata, che esiste da v1.2.0, sembra irraggiungibile pur avendo
un link che la raggiunge, nella regia, sotto l'etichetta giusta ma in mezzo ad altri quattro.

Non è un link da correggere. È che **un'etichetta e la sua destinazione, tenute insieme da nient'altro
che l'attenzione, prima o poi divergono** — e in quattro posti diversi divergono quattro volte.

Il secondo problema è dove ti trovi. Il titolo di ogni pagina è il **nome dell'asta**, cioè la cosa
che in quel momento sai già: sono tre schermate diverse che si presentano tutte come «Serie A
2026». Manca il nome della *pagina*, che è l'unica informazione che l'intestazione non sta dando.

Il terzo è la TV. Nasce per essere proiettata su un televisore e letta da quattro metri, con le
misure calcolate a mano per quella distanza; nella pratica sta su un portatile, dove metà schermo
serve a un countdown e la classifica delle rose è ridotta a un totale `11/25` proprio perché il
dettaglio non si leggeva da lontano. Il vincolo che aveva prodotto quelle scelte non c'è più.

Le tre cose stanno nella stessa macro perché sono la stessa domanda vista da tre lati: **come si
capisce dove si è, e come ci si sposta.**

## Richieste che ci confluiscono

Tolte da `docs/REQUESTS.md` il 2026-08-10.

- **Navbar di navigazione.** Una navbar con logo (per ora la scritta «Fantasta»), nome utente e
  bottone di logout. Dentro un'asta, anche una sotto-navbar con le voci che aiutano a navigare fra
  le sezioni disponibili.
- **Miglioramento titoli pagine.** Non è chiaro in che pagina si è. Al posto del nome dell'asta come
  titolo, il **titolo della pagina**, con sopra un badge che indica l'asta in cui si sta agendo.
- **Portale TV — visualizzazione più compatta.** Testi tarati su un MacBook e non su una TV. «Se
  proprio devo migliorare la leggibilità farò zoom della schermata.»

La terza richiesta è entrata in questa macro con una **estensione decisa in fase di spec**
(2026-08-10): non solo testi più piccoli, ma un cambio di forma — la TV diventa un tabellone di
recap. Vedi §4.

---

## Spec

### 1. La navbar globale

Un componente in `components/nav/navbar.tsx`, montato nel layout radice subito sotto il
`LiveBanner`. Contiene tre cose e nient'altro: la scritta **Fantasta** a sinistra, che è un link
alla dashboard; il nome dell'utente; il pulsante **Esci**.

Il blocco utente si disegna solo se c'è una sessione, e il nome solo se esiste. Non servono casi
speciali per `/signin` (nessuna sessione: resta il solo logo) né per `/onboarding` (sessione senza
nome: logo ed Esci): la stessa condizione li copre entrambi.

Si nasconde su `/tv/*`, che è pagina pubblica, nera e proiettata. Il meccanismo è quello che il
`LiveBanner` usa già per nascondersi sul portale — `usePathname` e un `return null` — e non un
route group: spostare la TV fuori dal layout radice per una riga di navbar sarebbe riorganizzare
l'albero delle rotte per un dettaglio di presentazione.

**Nome utente e logout in chiaro, non dentro un menu a tendina.** Un menu con due voci è
un'astrazione prima del secondo chiamante (regola 8), e costerebbe un componente shadcn nuovo, del
JavaScript client su ogni pagina e due tocchi per uscire. Su 375px di larghezza il nome si tronca e
il pulsante resta raggiungibile.

**La navbar non è sticky, da nessuna parte.** Il requisito nasce dal portale, dove lo spazio
verticale è la risorsa più scarsa dell'app e non può essere speso per una barra di navigazione
mentre scorre un countdown; ma applicarlo ovunque costa nulla — le altre pagine sono documenti, non
cruscotti — e ci risparmia un incastro a tre livelli di `z-index` fra banner, navbar e
`PortalHeader`. Restano incollati i due che devono esserlo: il `LiveBanner`, che è il richiamo
d'emergenza, e la `PortalHeader`, che tiene crediti e offerta massima sempre in vista.

La server action del logout si sposta da `app/dashboard/actions.ts` a `components/nav/actions.ts`.
La dashboard perde il proprio pulsante «Esci»: ora è su ogni pagina.

### 2. Il layout dell'asta

Nasce `app/auctions/[id]/layout.tsx`, server component. Fa `requireUser`, legge
`getAuctionOverview`, chiama `notFound()` se l'asta non esiste, e da lì ricava il ruolo di chi
guarda: proprietario, membro, entrambi. Rende badge dell'asta, titolo della pagina e sotto-navbar
sopra `children`.

Il vocabolario delle sezioni sta in **`lib/auction-nav.ts`**, modulo puro senza nessuna dipendenza,
gemello di `lib/domain.ts`. Non importa `lib/db` e non importa niente, quindi lo può leggere anche
il client component che evidenzia la voce attiva — che è esattamente il motivo per cui
`lib/domain.ts` esiste.

| Sezione | Segmento | Voce di menù | Titolo di pagina | Chi la vede |
|---|---|---|---|---|
| `setup` | `/setup` | Configurazione | Configurazione dell'asta | proprietario |
| `lobby` | `/lobby` | Lobby | Lobby | tutti |
| `manage` | `/manage` | Regia | Regia dell'asta | proprietario |
| `play` | `/play` | Portale | Il tuo portale | membri |

**Il titolo e la voce di menù escono dalla stessa riga di questa tabella**, quindi non possono
divergere. È il rimedio strutturale al bug che oggi fa puntare alla lobby un link etichettato
«Pannello di configurazione»: non un link corretto a mano, ma un posto solo in cui l'etichetta e la
destinazione stanno insieme.

Un proprietario che gioca vede tutte e quattro le voci; uno che non ha joinato non vede `Portale`;
un partecipante vede `Lobby` e `Portale`. **Le voci dipendono dal ruolo e mai dallo stato
dell'asta**: nessuna voce compare o sparisce durante la serata. Non è solo una scelta di
prevedibilità — è ciò che rende la sotto-navbar immune allo stantio. Il ruolo non cambia mentre
guardi la pagina; lo stato sì, e una sotto-navbar renderizzata dal server a inizio pagina
mostrerebbe voci sbagliate dopo la prima transizione, a meno di farla dipendere dallo snapshot,
cioè di trasformare la navigazione in stato di gioco.

**La TV non è una sezione.** È un link esterno con `target="_blank"`, in coda alla sotto-navbar e
visibile al solo proprietario: il `publicToken` esce oggi soltanto dalla regia, ed è lui la chiave
della vista pubblica.

Layout e pagina chiamano entrambi `getAuctionOverview`, quindi la funzione va avvolta in `cache()`
di React dentro `lib/engine/setup.ts`, altrimenti ogni pagina dell'asta fa due volte la stessa
lettura.

### 3. Cosa sparisce dalle pagine

Con l'intestazione nel layout se ne vanno tutte e quattro le navigazioni fatte in casa: i
`← Le tue aste` di lobby, setup, regia e portale; il blocco di link nell'intestazione della setup e
quello della regia; il footer in fondo al portale. Se ne vanno anche gli `<h1>{auction.name}` di
lobby, setup e regia, e con loro le due occorrenze di «Pannello di configurazione» che puntavano
alla lobby — quella sulla card d'attesa del portale non è navigazione fra sezioni e resta, con
l'etichetta corretta in **«Vai alla lobby»**.

Restano al loro posto le cose che sono della singola pagina e non destinazioni: in regia il badge
di fase, che arriva dallo stream, e il link che scarica le rose, che è un'azione; nella setup la
riga che spiega quando l'asta diventa pronta.

`ManageConsole` perde la prop `publicToken`: le serviva solo per comporre il link alla vista TV, che
ora sta nell'intestazione comune.

**Lo `StatusBadge` non entra nell'intestazione**, ed è una scelta e non una dimenticanza. Sarebbe
letto dal server una volta e resterebbe fermo mentre l'asta parte; sulla regia si troverebbe
accanto al badge di fase che arriva dallo snapshot, a dire il contrario. Resta dov'è già coerente:
nella lista della dashboard, e nel corpo di lobby e setup come parte del loro contenuto, dove tutto
il resto della pagina è letto dallo stesso `getAuctionOverview` e ha la stessa età.

Su regia e portale il titolo comparirà anche mentre lo snapshot sta ancora arrivando, al posto
della pagina vuota con «Mi collego all'asta…» di oggi. Questo **non** viola la regola 7: badge e
titolo non sono stato di gioco, sono il nome dell'asta e il nome della pagina.

### 4. La TV diventa un tabellone

Qui non cambia la scala, cambia la natura della pagina. Il commento in testa a
`app/tv/[publicToken]/tv-view.tsx` calcola le misure a partire da una lettura a quattro metri: va
riscritto da capo, perché la premessa non vale più.

La schermata si divide in tre:

```text
┌─ Serie A 2026 · LOTTO APERTO ·  Portieri → DIFENSORI → C → A ──────┐
│ ┌ Rossi FC   412 ┐┌ Verdi   380 ┐┌ Bianchi ┐┌ Neri ┐│               │
│ │ P Donnarumma 31││ P …         ││         ││      ││   BASTONI     │
│ │   ············ ││             ││         ││      ││   difensore   │
│ │ D Bastoni    45││             ││         ││      ││               │
│ │   Di Lorenzo 28││             ││         ││      ││  chiamato da  │
│ │   ············ ││             ││         ││      ││    Rossi FC   │
│ │ C Barella    62││             ││         ││      ││               │
│ │   ············ ││             ││         ││      ││  le buste     │
│ │ A Lautaro   180││             ││         ││      ││  sono segrete │
│ │   ············ ││             ││         ││      ││               │
│ └────────────────┘└─────────────┘└─────────┘└──────┘│      12       │
│ ┌────────────────┐┌─────────────┐┌─────────┐┌──────┐│               │
│ │  (seconda riga di squadre)                        ││               │
│ └────────────────┘└─────────────┘└─────────┘└──────┘│               │
└────────────────────────────────────────────────────────────────────┘
```

**La striscia in cima**, a tutta larghezza: nome dell'asta, fase, ordine dei ruoli con quello
corrente in evidenza, e l'avviso di riconnessione. È contesto, e in una colonna da 360px ruberebbe
righe al lotto.

**Il tabellone, 3/4 di larghezza.** Tutte le squadre su due righe: le colonne sono `ceil(posti / 2)`,
quindi otto squadre danno quattro colonne larghe e dodici ne danno sei strette. Ogni card ha il
nome della squadra e i crediti residui in testa, poi la rosa: una riga per giocatore, la lettera
del ruolo solo sul primo di ogni gruppo — così non costa righe — e **gli slot ancora da riempire
disegnati tratteggiati**. Le card sono quindi alte uguali dall'inizio della serata alla fine: la
griglia non balla a ogni acquisto, e chi è indietro si vede a colpo d'occhio. Della squadra di
Serie A del giocatore si fa a meno: non entra e non serve al recap.

Due evidenze sulla card, e nessuna delle due è nuova come informazione: chi ha il turno (come già
oggi) e, per i secondi del reveal, chi ha appena vinto.

**La colonna del lotto, 1/4 di larghezza.** Ci sta dentro tutto quello che oggi occupa i tre quarti
di sinistra — attesa, turno di chiamata, lotto aperto, spareggio, buste aperte, asta conclusa,
avviso di pausa — in scala ridotta. Il countdown resta il numero più grande della colonna ma non
più della pagina: ogni partecipante ha il proprio sul telefono, e qui serve il recap.

**Il reveal resta nella colonna** e non prende mai tutto lo schermo: la TV non cambia forma, e i due
lati raccontano insieme la stessa cosa — chi ha vinto, a quanto, e com'è adesso la sua rosa. Il
giocatore aggiudicato compare nella card del vincitore da sé, perché quando le buste si aprono
l'assegnazione è già scritta.

**Non serve niente di nuovo dal server.** Le rose sono già nello snapshot della TV
(`SnapshotMember.roster`, con nome, ruolo e prezzo), e sono già visibili lì oggi — la classifica
attuale ne conta le righe. `serializeSnapshot` non si tocca (regola 3), I8 resta dov'è: i prezzi
delle rose sono assegnazioni chiuse, non buste in corso.

**Il numero scomodo, dichiarato.** Su 900px di altezza, tolta la striscia, ogni card ha circa 430px
per venticinque righe: **~16px a riga**, testo a 11px. Ci sta, ma è stretto, e sotto circa 800px di
altezza il tabellone non è leggibile. Va scritto nel commento del file: questa pagina è
dichiaratamente un artefatto da portatile, ed è il senso stesso della richiesta.

### 5. Cosa non cambia

Il motore, lo schema, lo snapshot, gli endpoint. Nessuna transizione, nessun timer, nessuna
tabella, nessun campo nuovo che esca dal server. La navigazione è fatta di link, e un link non è
stato: ogni schermata resta funzione dello snapshot corrente (regola 7, I10), e chi si ricollega a
metà lotto trova la stessa pagina di prima, adesso con sopra una navbar.

---

## Task

- [x] **M2-01** — Aprire `feature/02-navigazione` da `dev`; scrivere questo file, togliere le tre
      richieste da `docs/REQUESTS.md`, aggiornare `docs/features/README.md`
- [x] **M2-02** — `lib/auction-nav.ts`: sezioni, etichette, titoli e visibilità per ruolo, modulo
      puro senza dipendenze
- [x] **M2-03** — `components/nav/navbar.tsx` e `components/nav/actions.ts`; montaggio nel layout
      radice sotto il `LiveBanner`; via il pulsante «Esci» dalla dashboard e
      `app/dashboard/actions.ts`
- [x] **M2-04** — `app/auctions/[id]/layout.tsx` con badge, titolo e sotto-navbar; `cache()` su
      `getAuctionOverview` in `lib/engine/setup.ts`
- [x] **M2-05** — Ripulire le pagine: via i `← Le tue aste`, i blocchi di link dell'owner e gli
      `<h1>` col nome dell'asta da lobby, setup e regia; `StatusBadge` ricollocato nel contenuto di
      lobby e setup; `metadata.title` di ogni pagina allineato ai titoli della tabella §2
- [ ] **M2-06** — TV, il tabellone: griglia delle squadre a `ceil(posti/2)` colonne su due righe,
      card con rosa completa e slot tratteggiati, evidenza del turno e del vincitore
- [ ] **M2-07** — TV, la colonna del lotto: tutte le schermate attuali in scala ridotta, striscia
      di contesto in cima, commento in testa al file riscritto
- [x] **M2-08** — Test: `tests/auction-nav.test.ts` — sezioni per proprietario-che-gioca,
      proprietario-che-non-gioca e partecipante; sezione attiva ricavata da un pathname; titolo di
      ogni sezione. Vitest secco, niente Postgres
- [ ] **M2-09** — Gate: `pnpm test`, `pnpm typecheck`, `pnpm build` verdi
- [ ] **M2-10** — `docs/ARCHITECTURE.md` con la navigazione e la nuova TV; `docs/DECISIONS.md` con
      le scelte non ovvie di questa macro
- [ ] **M2-11** — Chiusura: merge `--no-ff` su `dev`, prova con Docker + seed + `pnpm bots` e dal
      telefono con `pnpm dev:lan`, poi — **solo su richiesta dell'owner** — `CHANGELOG.md`,
      `package.json` a `1.3.0`, merge `--no-ff` su `main`, tag `v1.3.0`, push

## Verifica

1. `pnpm test`, `pnpm typecheck` e `pnpm build` verdi.
2. **Da ogni pagina si raggiunge ogni altra pagina del proprio ruolo.** In particolare: da `/manage`
   ad asta `LIVE` si arriva alla configurazione dei tempi in un click, che è il caso da cui è nata
   la richiesta.
3. **Nessuna voce mostra una destinazione che non le compete.** Un partecipante non vede
   Configurazione, Regia né TV; un proprietario che non ha joinato non vede Portale. Le voci sono le
   stesse da `DRAFT` a `COMPLETED`.
4. **Il titolo dice la pagina, il badge dice l'asta.** Su tutte e quattro le sezioni, regia e
   portale compresi, e su questi due anche mentre lo snapshot sta ancora arrivando.
5. **Dal telefono** (`pnpm dev:lan`): su `/play` la navbar e la sotto-navbar scorrono via al primo
   swipe, la `PortalHeader` con crediti e max resta incollata, e nessuna riga di navigazione è stata
   sottratta al countdown o al pulsante d'offerta.
6. **La TV, a 12 squadre e con `pnpm bots`**: le dodici rose complete stanno in una schermata senza
   scroll su un portatile, si legge il prezzo di ogni giocatore, e durante il reveal la card del
   vincitore si accende mentre le buste si aprono nella colonna.
7. **La riconnessione** (I10): ricaricare una qualsiasi pagina dell'asta a metà lotto restituisce la
   stessa schermata, navigazione compresa.
