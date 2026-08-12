# M9 — I badge degli insight, e la striscia verde via

> **Stato:** **da aprire** su `feature/09-badge-insight` · Pianificata il 2026-08-12 · Nessuna
> dipendenza da macro aperte: non ce ne sono, e M8 (v1.9.0) è in produzione **con i suoi tre passi a
> mano già dati** — schema applicato, le due fonti importate, `is_pro` acceso (confermato dall'owner
> il 2026-08-12). Quindi i badge di questa macro hanno dei dati veri sotto dal primo minuto.
>
> **Tocca lo schema del database?** **No.** Nessuna tabella, nessuna colonna, **nessun `pnpm db:push`
> e nessun backfill**. Il rilascio finisce col deploy: è l'unica delle quattro macro pianificate il
> 2026-08-12 di cui si può dire.
>
> **Invarianti coinvolti:** **I8 — non cambia, e non lo sfiora.** I badge stanno esattamente dove
> stavano gli insight di M8: nel **pool**, che la pagina carica per un singolo viewer, non nello
> snapshot che va in broadcast. Non si tocca `serializeSnapshot` di una riga. **I10** resta intatto
> anche togliendo la striscia: la UI continua a essere funzione dello snapshot, e nessuna schermata
> comincia a dipendere da un evento ricevuto. **Regole coinvolte:** 6 (la protezione resta nella
> query di M8 — qui non si aggiunge nessuna lettura da nascondere), 7, 8.
>
> ⚠ **Va detto in faccia, perché è l'unica cosa di questa macro che rinuncia a qualcosa:**
> `PLAN §8bis` punto 1 — «Banner globale *Asta in corso*, presente su tutte le pagine … è il modo
> con cui un utente rientrato trova la strada da solo» — **viene abbandonato di proposito**, su
> richiesta esplicita dell'owner (2026-08-12: «via del tutto, in ogni asta»). Non è un invariante
> I1–I10, quindi si può; ma quel punto ha smesso di valere e §5 spiega cosa prende il suo posto.
>
> ⚠ Si apre **su richiesta esplicita dell'owner**, come tutte.

## Obiettivo

M8 ha portato dentro i numeri che decidono un'asta — parte titolare? tira i rigori? batte i piazzati?
— e li ha messi nei due posti giusti. Ma li ha vestiti con quello che c'era: `Rigori 1°` e
`Piazzati 2°` usano le varianti `default` e `secondary` di `components/ui/badge.tsx`, cioè **due
grigi che si distinguono a fatica**, e la titolarità non è nemmeno un badge — è testo con una
percentuale in grassetto.

Sotto un countdown di dieci secondi, con un pollice sulla tastiera, la differenza fra «leggibile» e
«riconoscibile senza leggere» è tutta la differenza che conta. Questa macro dà **un colore a ogni
fatto**, e il colore fa una promessa che il numero mantiene.

E toglie la striscia verde in cima a ogni pagina, che è la seconda metà della stessa richiesta:
meno cose che chiedono attenzione, più attenzione per le tre che la meritano.

Il tema, detto in una riga: *il colore accelera, il numero decide.*

## Richieste che ci confluiscono

Tolte da `docs/REQUESTS.md` il 2026-08-12.

- **Aste live.** «Rimuovere la topbar verde che esce nel momento in cui c'è un'asta live. È più
  disturbante che utile.»
- **Visualizzazione Insights.** «Per gli insights voglio creare un sistema di badge riconoscibile e
  visibile velocemente. I badge devono essere: Titolare (con %): verde · Rigorista: blu · Punizioni:
  blu · Infortunato (ora): rosso · Se ci sono altre informazioni da insights usa il viola.»

**Tre pezzi della seconda richiesta sono cambiati nella sessione di spec, tutti e tre su decisione
dell'owner, e vanno letti prima del resto perché è ciò che questa macro *non* farà.**

1. ⚠ **«Infortunato (ora): rosso» è stato ritirato** (2026-08-12). Non per difficoltà: perché il dato
   non esiste nel momento in cui servirebbe. La misura è di M8 §9 e non va rifatta a memoria —
   `fantacalcio.it/infortunati-serie-a` serve i dati **lato client** (da server non c'è niente da
   leggere) e `probabili-formazioni-serie-a`, che li serve pubblici con l'`ext_id` dentro, l'11
   agosto conteneva **0 titolari, 0 riserve, 4 infortunati e 1 dubbio in tutta la Serie A**, con la
   giornata 1 segnaposto. Si popola a campionato in corso, **e l'asta si fa ad agosto**. Un badge
   rosso che non compare mai la sera per cui esiste l'applicazione è lavoro speso male, e un rosso
   generato da una pagina letta tre settimane prima sarebbe peggio: sarebbe una bugia.
   ⚠ **E non si ripiega sul campo `injured` della fonte A per farlo sembrare fatto:** è un conteggio
   stagionale che correla al contrario (20,3 presenze medie con `injured = 0` contro 24,5 con
   `injured > 0`).
2. **«Punizioni» diventa «Piazzati»** (§3): la fonte non ha una lista punizioni.
3. **Il viola sparisce, il neutro resta come fallback** (2026-08-12: «tieni il badge neutro come
   fallback in caso di nuove info»). Oggi non c'è nessuna «altra informazione» che sia un fatto
   categorico, e un badge viola con «76′» dentro non è un badge.

---

## Spec

### 1. La misura che ha deciso la soglia

Questa sezione viene prima delle altre perché **la §2 è una conseguenza sua**, ed è il metodo di M7
§1 e M8 §1 applicato una terza volta. La soglia dell'80% l'ha scelta l'owner; prima di scriverla in
una spec è stata **contata sui byte veri** — la fixture `fixtures/fantalab-listone.json`, cioè la
risposta della fonte A salvata da M8-02 il 2026-08-11 — con la stessa `quotaTitolare` che gira in
produzione, clamp compreso.

```text
497 giocatori, di cui 329 con i numeri della stagione corrente (gli unici mostrabili)

>= 90%   21 verdi    4,2% del listone
>= 80%   61 verdi   12,3% del listone     ← la soglia scelta
>= 70%  101 verdi   20,3% del listone
>= 60%  129 verdi   26,0% del listone

i 61 verdi: 25 difensori · 22 centrocampisti · 8 portieri · 6 attaccanti
```

**La soglia è buona, e ora si sa perché.** In una lista di chiamata da quaranta nomi il verde compare
cinque o sei volte: abbastanza raro da voler dire qualcosa, abbastanza frequente da non sembrare un
guasto. A 70% sarebbe un nome su cinque, che è il punto in cui un colore smette di essere un segnale
e diventa decorazione.

E dice una verità di dominio che non era ovvia: **gli attaccanti verdi sono sei**, contro
venticinque difensori. Gli attaccanti ruotano. Chi guarda i badge lo vedrà da sé, senza che nessuno
gliel'abbia scritto.

⚠ **La soglia cade in una zona densa, e questo vincola la §2.** C'è un grumo di giocatori a 32/38 =
**84%** (Çelik, de Roon, Højlund, Marusic, McKennie, Modrić, Murić, Pinamonti) e chi sta a 30/38 =
**79%** resta grigio: due giocatori a due partite di distanza finiscono in due colori. Va bene
**solo perché la percentuale è scritta dentro il badge**. Se un giorno qualcuno togliesse il numero
per fare spazio, quella soglia diventerebbe una bugia — e il commento nel codice deve dirlo, perché
il giorno che succede nessuno starà rileggendo questo file.

### 2. I tre badge, e i loro colori

| Badge | Testo | Colore | Quando c'è |
|---|---|---|---|
| Titolarità | `81% tit.` | **verde** se `quotaTitolare ≥ 0,80`, **grigio** sotto | Sempre, per chi ha i numeri della stagione corrente |
| Rigori | `Rigori 1°` | **blu** | Solo se `rigoristaRank` non è nullo |
| Piazzati | `Piazzati 2°` | **blu** | Solo se `piazzatiRank` non è nullo |
| *(riservato)* | — | **neutro** | Nessun uso oggi: è il colore di ciò che arriverà |

**La percentuale resta dentro il badge** (§1) e **il rank resta dentro il badge**: la gerarchia *è*
l'informazione — «secondo battitore» vale molto meno di «primo» — ed è la ragione per cui M8 aveva
scartato il pallino colorato. Un colore che sostituisse il rank butterebbe via il dato per mostrare
meglio il dato.

⚠ **Il colore non è mai l'unica informazione.** Verde e grigio a fianco non li distingue chiunque, e
il badge della titolarità va letto anche da chi non li separa: per questo il testo dice sempre la
percentuale, e non «Titolare» da solo. Vale come regola generale di questa macro — un badge senza
testo non si aggiunge.

**Il neutro come fallback, e cosa vuol dire.** Non è un badge che si scrive adesso: è la variante che
esiste già (grigio, `secondary`) e che si userà per il prossimo fatto categorico che arriverà dagli
insight, invece di inventare un quinto colore. Quattro colori sono il massimo che una riga densa
regge; il quinto renderebbe illeggibili i primi quattro.

### 3. «Piazzati», e non «Punizioni»

Il nome non è una preferenza di stile, è una **questione di verità del dato**, e la misura c'è già:
in M8 §1, tabella delle quattro smentite, riga 2. La pagina ha **due** liste per squadra — `Rigori` e
`Calci piazzati`, tre nomi ciascuna — e **la parola «Punizioni» compare zero volte nell'HTML**.

«Calci piazzati» include le punizioni **e i corner**. Il primo battitore di piazzati di una squadra
può essere il suo uomo dei corner, e un badge «Punizioni» su di lui direbbe una cosa falsa
esattamente nel momento in cui nessuno va a controllare: dieci secondi, un pollice, una cifra da
decidere.

Si scrive quindi **`Piazzati N°`**, che è come si chiama la cosa. Ratificato dall'owner il
2026-08-12.

### 4. Dove si vede: gli stessi due posti di M8, e non un terzo

| Dove | Cosa cambia |
|---|---|
| `components/auction/pick-panel.tsx` | La riga densa prende i colori: `81% tit.` verde o grigio, `Rigori 1°` blu, `Piazzati 2°` blu |
| `components/auction/bid-modal.tsx` | Le sole macro, colorate allo stesso modo |

**Non la card del lotto, non la TV, non la regia.** È il perimetro di M8 §7 e non si allarga: la card
non sparisce mai e si guarda anche quando non si sta offrendo; la TV è di tutta la stanza e gli
insight sono di chi ha il permesso; la regia mostra il lotto come una riga di testo. Regola 8 — due
chiamanti, non cinque. (Il terzo chiamante arriverà con M10, il Centro dati, e sarà il momento in cui
questi badge dimostrano di essere un componente e non tre `className`.)

### 5. La striscia verde via, e cosa resta al suo posto

Si toglie `components/auction/live-banner.tsx` e la sua riga in `app/layout.tsx`. **Con lei se ne va
anche una query per pagina**, e va contato come guadagno: il layout radice oggi chiama
`listUserAuctions(user.id)` a ogni richiesta di ogni utente autenticato, per un banner che compare
solo quando un'asta è viva. Con dodici utenti non era un problema; con zero banner non è più nemmeno
una domanda.

Se ne va anche il codice che il banner aveva accumulato per non dare fastidio: l'esclusione di
`/tv/`, l'esclusione del portale della propria asta, la logica del pallino che pulsa solo se l'asta
non è in pausa.

**Cosa prende il suo posto: la dashboard, e nient'altro.** Chi chiude il tab per sbaglio torna
sull'app, vede le proprie aste elencate e ne apre una. È un tocco in più di prima, e l'owner ha
deciso che vale il silenzio in cima a ogni pagina.

**Cosa non si tocca, e va verificato invece di essere assunto:**

- **La lobby continua a portare su `/play` all'avvio.** È l'unica navigazione automatica
  dell'applicazione, e la decisione la prende lo **snapshot** (`status === 'LIVE'`), non un evento
  ricevuto: chi apre la lobby ad asta già iniziata viene spostato allo stesso modo. Toglierla
  romperebbe il cancello di presence di `startAuction` (DECISIONS 2026-08-07, Fase 5).
- **I cinque rientri di §8bis** (LOT_OPEN, LOT_TIE_PREP, LOT_REVEAL, WAITING_PICK, PAUSED) non
  dipendono dal banner: dipendono dallo snapshot, e i test di `lib/realtime/portal.ts` continuano a
  provarli. Il banner era il modo di *arrivare* alla pagina, non di ricostruirla.
- **La navbar resta com'è.** Nessun rimando nuovo: se un giorno servirà, sarà perché si è visto che
  serve.

⚠ **E va scritto in `DECISIONS.md`, non solo qui.** `PLAN §8bis` punto 1 è archivio vincolante come
il resto del piano: una sua parte che smette di valere ha bisogno di una voce datata, altrimenti fra
sei mesi il file dice una cosa e l'applicazione un'altra, e chi legge crede al file.

### 6. Il colore, deciso in un posto solo

`components/ui/badge.tsx` **non prende varianti nuove.** I quattro colori sono vocabolario del
dominio degli insight, non di un badge qualunque: stanno in
`components/auction/insights.tsx`, dov'è già `SetPieceBadges` — cioè si estende un file che esiste,
non si crea un'astrazione. Il precedente è letterale, ed è la voce «Niente
`components/ui/dialog.tsx`» di DECISIONS 2026-08-07 (Fase 5): le primitive condivise si allargano
quando il secondo chiamante *generico* arriva, e qui non arriverà — un badge verde all'80% non vuol
dire niente fuori da questa lista.

Due vincoli sui colori scelti, entrambi da guardare con gli occhi e non da dedurre:

- **Tema chiaro e tema scuro.** I token vanno definiti per entrambi. Un blu che sul chiaro è
  leggibile e sullo scuro sparisce è un bug che si vede solo la sera, che è quando si gioca.
- **La vista TV non è interessata** — non mostra insight — quindi il bianco-su-nero fisso di
  DECISIONS 2026-08-08 non entra in conflitto con niente. Va verificato che resti vero: se un giorno
  gli insight arrivassero sulla TV, i colori andrebbero rifatti per quel fondo.

### 7. Cosa non cambia

Il motore, la macchina a stati, il lock, `serializeSnapshot`, lo scheduler, il tick dei bot, lo
schema, `listPickPool` e la sua protezione (`canSeeInsights` decide nella query, come in M8 §6 — qui
non si aggiunge un solo `if (isPro)`), le tre funzioni pure di `lib/domain.ts`
(`quotaTitolare`, `minutiMedi`, `showableInsights`) e i loro test.

La soglia dell'80%, invece, **è un numero nuovo e va dove vanno i numeri di dominio**: una costante
con un nome in `lib/domain.ts`, accanto a `GIORNATE`, non un `0.8` dentro un componente.

### 8. Cosa non entra (regola 8)

Niente badge «Infortunato» e nessuna terza fonte (le richieste che ci confluiscono, punto 1) · niente
viola (punto 3) · niente badge sui minuti medi: un numero non è un fatto categorico, e resta il testo
che è oggi · niente badge nella card del lotto, sulla TV, in regia, nelle rose o nello storico (§4) ·
nessuna variante nuova in `components/ui/badge.tsx` (§6) · niente icone al posto del testo (§2) ·
nessun rimando nuovo in navbar al posto della striscia (§5) · niente soglie configurabili
dall'utente: una soglia che si può cambiare è una soglia di cui nessuno conosce il valore.

---

## Task

> Da rifinire all'apertura della macro. Sono la traduzione della spec, non un impegno preso nella
> sessione in cui è stata scritta.

- [ ] **M9-01** — Aprire `feature/09-badge-insight` da `dev`; rileggere questo file, e in particolare
      §1 e il punto 1 delle richieste: la soglia contata e il badge rosso ritirato sono le due cose
      che si è tentati di rifare a naso. Verificare che `pnpm test` sia verde **prima** di toccare
      qualcosa
- [ ] **M9-02** — `lib/domain.ts`: la soglia dell'80% come costante con un nome, e il predicato che
      decide verde o grigio. Test puro **con il caso di bordo di §1 dentro**: 30/38 grigio, 32/38
      verde — la zona densa senza il suo caso è una riga che qualcuno sposterà
- [ ] **M9-03** — `components/auction/insights.tsx`: i tre badge colorati, il neutro riservato, i
      token per tema chiaro e scuro. Nessuna variante nuova in `components/ui/badge.tsx` (§6). Il
      testo resta dentro ogni badge (§2)
- [ ] **M9-04** — «Punizioni» → **`Piazzati`** (§3), che è già il nome nel codice di M8: verificare
      che non sia rimasta la parola sbagliata da nessuna parte, `docs/` compresa
- [ ] **M9-05** — Via `components/auction/live-banner.tsx`, la sua riga in `app/layout.tsx` **e la
      query `listUserAuctions` che serviva solo a lui** (§5). Il `LiveMembership` esportato muore con
      il file: verificare che non lo importi nessun altro
- [ ] **M9-06** — Verificare che i cinque rientri di §8bis siano ancora verdi (`portal.test.ts`) e
      che la lobby porti ancora su `/play` all'avvio: il banner era il modo di arrivare alla pagina,
      non di ricostruirla, e la differenza va provata invece di essere raccontata
- [ ] **M9-07** — Gate: `pnpm test`, `pnpm typecheck`, `pnpm build` verdi (⚠ build con `pnpm dev`
      spento — è una macro tutta di UI, quindi è **esattamente** quella in cui un errore di lint fa
      fallire la build di produzione con tutto il resto verde)
- [ ] **M9-08** — `docs/ARCHITECTURE.md` (il capitolo degli insight: come si leggono adesso, e che il
      banner non c'è più) e `docs/DECISIONS.md`: la soglia con la misura di §1, «Piazzati» e non
      «Punizioni», il badge rosso ritirato con il perché, **e l'abbandono esplicito di PLAN §8bis
      punto 1**
- [ ] **M9-09** — Chiusura: merge `--no-ff` su `dev`, prova in locale **dal telefono** (è l'unico
      posto dove si vede se un colore funziona sotto pressione), poi — **solo su richiesta esplicita**
      — `CHANGELOG.md`, `package.json`, merge su `main`, tag `v1.10.0`, push. **Nessun `db:push`,
      nessun passo a mano sul server**: per una volta il rilascio finisce col deploy, e il changelog
      può dirlo

## Verifica

1. `pnpm test`, `pnpm typecheck` e `pnpm build` verdi.
2. **Un giocatore a 32/38 ha il badge verde, uno a 30/38 lo ha grigio**, e in entrambi i casi la
   percentuale è scritta dentro (§1). Sono i due casi contati sulla fixture, e stanno nel test.
3. **In una lista di chiamata da quaranta nomi il verde compare cinque o sei volte**, non venti: la
   misura di §1 si rivede a schermo su un'asta con il listone vero.
4. **Un giocatore senza dati mostrabili** (`stats_season = "previous"`, un terzo del listone) **non
   ha nessun badge**, non un badge grigio a zero: `—` e `0` non si scrivono allo stesso modo, ed è la
   verifica 8 di M8 che deve restare vera.
5. ⚠ **Il pool di un utente senza permesso non contiene la chiave `insights`.** Si riasserisce sul
   payload, non sullo schermo: questa macro colora ciò che M8 protegge, e il modo di rompere la
   protezione sarebbe proprio un badge disegnato «vuoto» per tutti.
6. **I tre badge si leggono in tema chiaro e in tema scuro**, guardati e non dedotti.
7. **Nessuna striscia verde in cima a nessuna pagina**, con un'asta `LIVE` e con un'asta `PAUSED`, né
   su dashboard, né su `/play`, né su `/tv/`.
8. **Chi chiude il tab a metà lotto rientra dalla dashboard e ritrova la schermata esatta di prima**:
   è I10, e il banner non c'entrava niente — ma è il momento giusto per riprovarlo, perché è la cosa
   che la sua rimozione fa *sembrare* rotta.
9. **Un'asta si gioca ancora**: una simulazione a 8 arriva a `COMPLETED` con i badge in pagina.
