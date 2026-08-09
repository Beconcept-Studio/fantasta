# M1 — Segretezza e rivelazione delle offerte

> **Stato:** in corso · **Aperta il** 2026-08-09 · **Uscita con** —
> **Tocca lo schema del database?** No. Nessun `pnpm db:push` dopo il deploy.
> **Invarianti coinvolti:** I8 (rafforzato, vedi «L'invariante nuovo»), I10, regole 3 e 7.

## Obiettivo

Un'asta a busta chiusa è tale finché la busta è chiusa davvero. Oggi non lo è del tutto: durante
`LOT_OPEN` lo snapshot dice a tutti **chi** ha già consegnato — un pallino verde sul telefono, un
riquadro acceso sulla TV, un contatore `4/7` nella console. L'importo no, quello è protetto da I8.
Ma sapere chi si è già mosso, e soprattutto chi non si è mosso, è materiale sufficiente per fare
strategia in una stanza dove ci si guarda in faccia: si aspetta il vicino, si legge la sua fretta,
si offre di conseguenza. È esattamente ciò che la busta chiusa doveva impedire.

Il rovescio della stessa medaglia è il momento in cui le buste si aprono. Oggi il reveal è un
pannello dentro la stessa card che un attimo prima chiedeva di offrire: stessa cornice, stessa
barra che scorre, stesso countdown grande in alto a destra. Chi guarda il telefono per tre secondi
non ha modo di capire che il lotto è finito e che non deve fare più niente. Serve una card che
*sembri* conclusa, che racconti il lotto per intero — giocatore, prezzo, vincitore, tutte le
offerte con la vincente in evidenza — e che dica quanto manca alla ripresa.

Le due cose stanno nella stessa macro perché sono la stessa cosa vista da due lati: **cosa esce
dal server durante il lotto, e cosa esce quando il lotto è chiuso.**

## Richieste che ci confluiscono

Tolte da `docs/REQUESTS.md` il 2026-08-09.

- **Lotto live — Offerte arrivate.** Mentre il lotto è live non si mostra chi ha consegnato
  un'offerta: fino allo scadere del timer nessuno vede chi sta offrendo.
- **Portale TV — Offerte arrivate.** Lo stesso sulla TV: mostrare chi consegna è fuorviante e
  porta a fare strategie fra competitor.
- **Lotto — Momento dell'assegnazione.** La UI dà l'impressione che l'asta sia ancora attiva
  mentre è un momento di stand by. Serve una card distinta in stile, con nome giocatore e squadra,
  valore d'acquisto, chi ha vinto, le offerte fatte con la vincente evidenziata, e un'indicazione
  di quando inizia la prossima asta — **non una progress bar**, un sistema che faccia capire che
  è una schermata di sola visualizzazione.

---

## Spec

### 1. L'invariante nuovo

`docs/PLAN.md` è archivio e non si estende, quindi l'invariante vive qui e da qui entra in
`docs/ARCHITECTURE.md`. È un rafforzamento di I8, non una sua sostituzione:

> **Durante `LOT_OPEN` non lascia il server nessuna informazione su chi ha consegnato una busta.**
> Non l'importo (I8), non un booleano, non un conteggio aggregato. Vale per tutti i client,
> portale manager e vista TV compresi.
>
> Due sole eccezioni, entrambe già esistenti e nessuna delle due sulle buste altrui: la propria
> offerta (`myBid`), che il proprio viewer vede perché è la sua; e l'annuncio dello spareggio
> (`tie`, solo in `LOT_TIE_PREP`), che nomina i pareggianti e l'importo pareggiato perché è il
> contenuto stesso dell'annuncio — quella cifra fra due secondi è il `min_amount` pubblico del
> round 2.

Il conteggio aggregato è escluso di proposito, e la decisione è stata presa esplicitamente
(DECISIONS 2026-08-09). «Quattro buste su sette» sembra anonimo e non lo è: con tre idonei
identifica la persona, e a fine ruolo gli idonei sono quasi sempre due o tre.

### 2. Il server: `bidStatus` non si sanifica, si elimina

Oggi `serializeLot` costruisce `bidStatus: {memberId, hasBid, withdrawn}[]` per ogni idoneo del
round, **in tutte le fasi**. La correzione minima sarebbe emetterlo solo in `LOT_REVEAL`. Ma in
`LOT_REVEAL` il campo `reveal` porta già tutto — importi, timestamp, ritiri, tutti i round —
quindi dopo questa macro `bidStatus` non ha più nessun consumatore legittimo.

Quindi sparisce del tutto:

- `SnapshotBidStatus` e il campo `bidStatus` su `SnapshotLot` in `lib/realtime/types.ts`;
- il blocco che lo costruisce in `serializeLot`, in `lib/engine/snapshot.ts`;
- `envelopes()` e `EnvelopeState` in `lib/realtime/portal.ts`, con i loro test.

Non è pulizia estetica: è la differenza fra un invariante **sorvegliato** e uno **strutturale**.
Un campo che non esiste nel tipo non può essere dimenticato in una fase sbagliata da una modifica
futura. È lo stesso ragionamento per cui `serializeSnapshot` è l'unico punto di uscita: si toglie
la possibilità di sbagliare, non ci si affida all'attenzione.

`eligibleMemberIds` **resta**. Non dice niente delle buste: dice chi *potrebbe* offrire, ed è
comunque deducibile da rose e crediti, che tutti vedono già.

### 3. Il telefono: due card, non una con un `if`

`LotCard` oggi attraversa le tre fasi cambiando il proprio corpo. Per ottenere «si capisce a colpo
d'occhio che qui non devi fare niente» la si spacca in due componenti, scelti dalla fase in
`app/auctions/[id]/play/portal.tsx`:

**`LotCard`** — `LOT_OPEN` e `LOT_TIE_PREP`. Perde la sezione «Buste consegnate» e non la
sostituisce con niente: resta giocatore, countdown con la barra, la propria offerta, il pulsante,
e il pannello dello spareggio quando c'è. Al posto dell'elenco, una riga sola di contorno che
spiega il silenzio — *«Le buste sono segrete: chi ha offerto, e quanto, si vede all'apertura.»*
Chi è in gara resta leggibile più in basso, nella sezione «Gli altri» che c'è già.

**`LotClosedCard`** — `LOT_REVEAL`, in un file nuovo `components/auction/lot-closed-card.tsx`.
Cambia registro visivo rispetto alla card viva: superficie e bordo diversi, **nessuna barra di
avanzamento**, e il numero grande in alto non è più il countdown ma il **prezzo**. Nell'ordine:

1. badge `Assegnato`, nome del giocatore, squadra e ruolo;
2. il vincitore e il prezzo, con un trattamento diverso se il vincitore sono io;
3. tutte le offerte di **tutti** i round, ordinate per importo, con la vincente evidenziata, i
   ritiri barrati e i `+Ns` che rendono leggibile uno spareggio deciso al timestamp;
4. staccata in fondo, la riga quieta: **«Prossimo turno fra 8s»**, con i secondi che scorrono.

Il punto 4 è la risposta a «non usare una progress»: un countdown testuale, senza barra e senza
pulsanti, che comunica attesa invece che urgenza. Non dice **a chi** toccherà — informazione non
necessaria, si scopre quando il lotto nuovo si apre (decisione dell'owner del 2026-08-09) — e
questo è anche il motivo per cui il server non cambia oltre la rimozione di `bidStatus`: la
scadenza è già nello snapshot, in `auction.phaseDeadline`.

§8bis chiede che l'area del lotto sia sempre presente e sia funzione pura dello snapshot, non che
sia sempre lo stesso componente React: `portalScreen` continua a restituire `LOT` per tutte e tre
le fasi, e chi rientra a metà reveal trova la card chiusa esattamente come chi non si è mai
disconnesso (I10). Il commento in testa a `LotCard` promette il contrario e va riscritto.

### 4. La TV

Stesso trattamento, tipografia invariata: la compattazione della TV è M2, e mescolarla qui
renderebbe il diff illeggibile.

- **Durante `LOT_OPEN`** sparisce il componente `Envelopes` con il suo `4/7` e i riquadri per
  squadra. Restano il giocatore e il countdown gigante, con una riga di contorno al posto
  dell'elenco.
- **In `LOT_REVEAL`** la schermata mostra **tutti** i round e non solo l'ultimo — oggi, in uno
  spareggio, la TV nasconde proprio le offerte che l'hanno causato — e guadagna in fondo la
  stessa riga «prossimo turno fra 8s». Vincitore e prezzo restano il blocco più grande.

### 5. La console del manager

Il blocco `Buste consegnate 4/7` in `LiveStrip` è un'uscita di quel dato quanto le altre, e chi
gestisce l'asta quasi sempre gioca: lasciarlo lì darebbe a un partecipante un'informazione che
nessun altro ha. Viene sostituito da **`In gara 7`**, che è pubblico e risponde comunque alla
domanda per cui il blocco era stato messo lì — *siamo a metà di un round vero o di un lotto a un
solo idoneo?* — che è ciò che serve per decidere se premere pausa.

### 6. Cosa non cambia

Il motore. Nessuna transizione, nessuna regola, nessun timer, nessuna tabella. Le offerte si
raccolgono, si risolvono e si assegnano esattamente come prima: cambia solo cosa il server
racconta, e quando.

---

## Task

- [ ] **M1-01** — Aprire `feature/01-segretezza-offerte` da `dev`; scrivere questo file, togliere
      le tre richieste da `docs/REQUESTS.md`, aggiornare `docs/features/README.md`
- [ ] **M1-02** — Eliminare `SnapshotBidStatus` e `bidStatus` da `lib/realtime/types.ts` e il
      blocco che lo costruisce in `serializeLot`; riscrivere il commento in testa a
      `lib/engine/snapshot.ts` con l'invariante rafforzato
- [ ] **M1-03** — Eliminare `envelopes()` e `EnvelopeState` da `lib/realtime/portal.ts`
- [ ] **M1-04** — `LotCard` senza la sezione delle buste, con la riga che spiega il silenzio
- [ ] **M1-05** — Nuovo `components/auction/lot-closed-card.tsx` e sua adozione in `portal.tsx`;
      `reveal-panel.tsx` resta con `TiePanel` e la lista delle offerte, riusata dalla card chiusa
- [ ] **M1-06** — TV: via `Envelopes`; reveal con tutti i round e la riga del prossimo turno
- [ ] **M1-07** — Console: `In gara N` al posto di `Buste consegnate N/M`
- [ ] **M1-08** — Test: `tests/db/i8.test.ts` verifica che in `LOT_OPEN` lo snapshot **non
      contenga** alcuna traccia delle buste altrui, per tutti e tre i viewer (partecipante,
      manager, TV), con un controllo sull'insieme esatto delle chiavi di `currentLot`; rimuovere i
      test di `envelopes` da `tests/portal.test.ts`; aggiornare `tests/snapshot-factory.ts`
- [ ] **M1-09** — Gate: `pnpm test`, `pnpm typecheck`, `pnpm build` verdi
- [ ] **M1-10** — `docs/ARCHITECTURE.md` con l'invariante rafforzato e le due card;
      `docs/DECISIONS.md` con le tre scelte non ovvie di questa macro
- [ ] **M1-11** — Chiusura: merge `--no-ff` su `dev`, prova con Docker + seed + `pnpm bots` e dal
      telefono con `pnpm dev:lan`, poi — **solo su richiesta dell'owner** — `CHANGELOG.md`,
      `package.json` a `1.2.0`, merge `--no-ff` su `main`, tag `v1.2.0`, push

## Verifica

1. `pnpm test`, `pnpm typecheck` e `pnpm build` verdi.
2. **Il test dell'invariante**: con un lotto in `LOT_OPEN` e tre buste consegnate, lo snapshot
   serializzato per un partecipante che non ha offerto, per il manager e per la TV non contiene
   né il campo `bidStatus`, né alcun altro campo che distingua un idoneo che ha offerto da uno che
   non l'ha fatto. Il controllo è sull'insieme esatto delle chiavi, non su un `!== undefined`:
   deve fallire anche se qualcuno reintroduce l'informazione con un nome diverso.
3. **A mano, dal telefono e dalla TV** (`pnpm dev:lan` + `pnpm bots`): durante un lotto nessuno
   dei due schermi mostra chi ha offerto; allo scadere, entrambi mostrano la card chiusa con
   vincitore, prezzo, tutte le offerte e il countdown al prossimo turno.
4. **La riconnessione a metà reveal** (I10): chiudere e riaprire il portale durante `LOT_REVEAL`
   restituisce la stessa card chiusa, con il countdown giusto.
5. **Lo spareggio**: in un lotto deciso al round 2, la card chiusa e la TV mostrano entrambi i
   round, e i `+Ns` rendono leggibile perché ha vinto quello che ha vinto.
