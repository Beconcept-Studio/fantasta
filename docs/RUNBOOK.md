# RUNBOOK

## Guida per l'owner — il tuo iter attraverso il progetto

Questa sezione è per l'utente umano: cosa devi fare tu, fase per fase, e cosa puoi delegare.
**A ogni chiusura di fase, Claude deve ricapitolarti i punti di questa guida relativi al gate
appena chiuso e alla fase che si apre** (regola in `CLAUDE.md`).

> **Dove siamo.** Fasi 0–6 chiuse, la 6 il **2026-08-08** con 275 test verdi. Adesso l'asta si
> conduce per intero da dentro l'applicazione: la **regia** (`/auctions/<id>/manage`, solo tua) ha
> il recap delle rose, l'avvio con la scelta del posto di partenza, pausa e ripresa e l'alert di
> chi cade; la **vista TV** (`/tv/<public_token>`) si apre senza login e non riceve nessun importo
> a busta chiusa. **Ti restano da fare i collaudi visivi delle Fasi 3, 4 e 6** — i comandi sono
> nella tabella qui sotto e, per la 6, nella sezione "Il collaudo della Fase 6". La prossima è la
> **Fase 7 — Override e chiusura** (assegnazione manuale, void, rettifiche di budget, export
> xlsx), da aprire in una sessione nuova col modello di default (Opus): nessun `/model` da
> digitare.
>
> Nota per la Fase 3: `pnpm drive` continua a funzionare, ma se vuoi rifare quella demo sappi
> che ora l'avvio richiede la presence di tutti i membri — il driver batte gli heartbeat da sé,
> non devi fare niente.

### Il ritmo generale (vale per ogni fase)

1. **Una sessione nuova per ogni fase** (PLAN.md §16): verso la fine di una conversazione lunga
   il modello perde i vincoli letti all'inizio. Prima di scrivere il prompt, **controlla il
   modello** (tabella qui sotto): il default di progetto è Opus (`.claude/settings.json`),
   quindi devi intervenire solo per le Fasi 2 e 3, digitando `/model fable` come prima cosa.
   Prompt di apertura:
   > Leggi CLAUDE.md, docs/DECISIONS.md e la sezione di docs/PLAN.md relativa alla Fase N.
   > Esegui la Fase N seguendo docs/BACKLOG.md, task per task, spuntando le checkbox man mano.
2. **Se una sessione si allunga troppo a metà fase**, chiudila: il backlog con le checkbox è
   fatto apposta. Nella sessione nuova: *"Riprendi la Fase N dal backlog: i task spuntati sono fatti."*
3. **Prima di chiudere una fase, verifica tu il gate.** Non fidarti del "tutto verde" dichiarato:
   esegui di persona i criteri ✅ del piano, leggi il capitolo nuovo di `ARCHITECTURE.md`
   (è scritto per te), controlla le checkbox del backlog, la riga "Fase corrente" in `CLAUDE.md`
   e che le scelte nuove siano in `DECISIONS.md`.
4. **Cosa deve girare sul tuo Mac**: Docker Desktop sempre acceso (Postgres è lì dentro);
   `pnpm dev` solo quando si testa la UI.

### Che modello usare, fase per fase

Claude **non può cambiare modello da solo**: è una scelta che fai tu all'apertura della sessione.
Il file `.claude/settings.json` imposta già **Opus** come default del progetto, quindi ogni nuova
sessione parte col modello giusto senza che tu faccia nulla. L'unica eccezione sono le fasi ad
alta densità di logica, dove conviene il modello più capace:

| Fasi | Modello | Cosa devi fare |
|---|---|---|
| **2 — Motore** e **3 — Persistenza/timer** | **Fable** | Apri la sessione e digita `/model fable` prima del prompt di apertura |
| Tutte le altre (0, 1, 4, 5, 6, 7, 8) | **Opus** | Niente: è il default di progetto |

Perché così: la Fase 2 è quella dove "si rompe tutto" (invarianti, casi limite dei tiebreak,
idempotenza) e la Fase 3 aggiunge concorrenza e lock — lì la capacità extra di Fable paga.
Il resto è lavoro agentico ben specificato dove Opus è il punto di forza. Al gate di ogni fase
Claude ti ricorda il modello per la fase successiva (regola in `CLAUDE.md`), così non devi
tenere a mente questa tabella.

### Prima della Fase 0 — le uniche cose che Claude non può fare per te

- **Credenziali Google OAuth**: Google Cloud Console → nuovo progetto → "Credenziali" →
  OAuth Client ID (tipo "Applicazione web") → redirect URI autorizzato
  `http://localhost:3000/api/auth/callback/google`. Metti `AUTH_GOOGLE_ID` e
  `AUTH_GOOGLE_SECRET` nel `.env`. Senza, la Fase 0 non chiude.
- Verifica di avere Node 20+, pnpm e Docker Desktop funzionanti.

### Fase per fase — quando ti devi attivare tu

| Fase | Il tuo intervento manuale |
|---|---|
| ~~**0 — Scaffold**~~ ✓ | Fornisci le credenziali OAuth. A fine fase: login con il **tuo** account Google vero, verifica che ti chieda nome e cognome, poi un login con un utente dev. ~10 minuti. |
| ~~**1 — Setup asta**~~ ✓ | Test a due browser (uno normale + uno incognito, due utenti dev): crea un'asta, carica il listone da UI, genera l'invito, entra col secondo utente, verifica i nomi squadra reciproci. Prova anche un listone "povero" per vedere il rifiuto I9. |
| ~~**2 — Motore**~~ ✓ | **Nessun test manuale** — tutto da terminale. Supervisiona: `pnpm test` verde e confronta i nomi dei test con §12 del piano (1–26, 29, 30, 41). È la fase in cui NON avere fretta: se il motore è giusto, il resto è cosmetica. |
| **3 — Persistenza e timer** | Guarda con i tuoi occhi le due dimostrazioni. **(a) Asta completa:** `pnpm db:seed --auction-status=ready`, prendi l'id stampato, poi `pnpm drive --auction=<id>` — vedrai il log JSON scorrere e in ~20 minuti «✓ Asta COMPLETED: 200 lotti». **(b) Restart a metà round:** mentre il driver gira, fermalo con Ctrl-C (o killa il processo); guarda che l'asta resti ferma (nessuna riga nuova), poi rilancia lo stesso comando `pnpm drive --auction=<id>`: riparte entro 1 secondo da dove si era fermata, fino a COMPLETED. |
| **4 — SSE** | Poco, ed è tutto da terminale. `pnpm test` verde (il criterio di fase è il test I8 sui tre spettatori). Se vuoi vedere il canale con i tuoi occhi: `pnpm dev` in un terminale, `pnpm bots --auction=<id> --count=8 --strategy=tie --start --verbose` in un altro, e un `curl -N "http://localhost:3000/api/auctions/<id>/stream?token=<public_token>"` in un terzo — è la vista TV, e vedrai scorrere uno snapshot per transizione senza **nessun** importo finché non si apre il reveal. Con `--strategy=tie` ogni lotto va allo spareggio. |
| ~~**5 — Portale partecipante**~~ ✓ | Fatto il 2026-08-08: telefono vero + un browser sul Mac dentro un'asta con sei bot, tutti sull'IP di LAN. Nessun disallineamento fra i due dispositivi; tastierino numerico e nessuno zoom forzato. La procedura resta scritta qui sotto ("Il collaudo della Fase 5"): serve di nuovo ogni volta che si tocca il portale. |
| **6 — Manager e TV** | Il collaudo è scritto passo per passo qui sotto ("Il collaudo della Fase 6"). In due parole: apri la **regia** e avvia da lì un'asta con bot scegliendo il posto di partenza, prova pausa e ripresa, killa un bot e guarda comparire l'alert; poi apri la **vista TV in incognito** (senza login) e verifica che durante le offerte non si veda nessun importo. Se hai una TV o un proiettore, provala lì per la leggibilità: è l'unica cosa che a schermo di computer non si può giudicare. ~30 minuti. |
| **7 — Override** | Simula la serata storta: pausa → cancella un giocatore da una rosa → riassegna manualmente → riprendi. Poi esporta l'xlsx e **aprilo in Excel** per verificare FantaSquadra e Costo. |
| **8 — Deploy** ⚠ | Alto coinvolgimento tuo: server Hetzner, Ploi, DNS del dominio, redirect URI di **produzione** nella console Google, env sul server. Poi l'asta di prova a 8 bot in produzione e la checklist pre-asta di PLAN.md §17, eseguita da te punto per punto. |

### Consigli trasversali

- **Le fasi 2, 5 e 8 sono quelle da non comprimere**: la 2 decide la correttezza, la 5 e la 8
  richiedono te fisicamente (telefono, browser multipli, server).
- **Un problema visto durante un test manuale non si sistema "al volo" a fine sessione**:
  annotalo e apri una sessione dedicata con la descrizione precisa. Le correzioni frettolose a
  contesto esausto sono quelle che rompono gli invarianti.
- **La sera dell'asta non è la Fase 8**: è la checklist di §17 (backup, asta di prova, presence,
  `pm2 logs` aperto). Falla il giorno stesso, per intero, anche se "ha già funzionato ieri".

---

## Sviluppo locale

### Da checkout pulito a sessione loggata

Servono **Node 20+**, **pnpm** e **Docker Desktop acceso**. Cinque comandi:

```bash
pnpm install
cp .env.example .env          # poi apri .env e riempilo, vedi sotto
docker compose up -d          # Postgres 16 su localhost:5433
pnpm db:push                  # crea le tabelle
pnpm db:seed --auction-status=ready   # 12 utenti + un'asta pronta con listone
pnpm dev                      # http://localhost:3000
```

Apri `http://localhost:3000`: vieni rediretto a `/signin`, dove sotto il pulsante Google c'è la
lista **"Entra come …"** con i 12 utenti seeded. Un click e sei dentro. È tutto.

### Cosa mettere in `.env`

`.env.example` è il modello con i commenti. I quattro valori che contano:

| Variabile | Da dove viene |
|---|---|
| `DATABASE_URL` | Già giusta nell'esempio: `postgres://postgres:dev@localhost:5433/asta` |
| `AUTH_SECRET` | Generala: `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google Cloud Console → Credenziali → OAuth Client ID (Applicazione web), con redirect URI `http://localhost:3000/api/auth/callback/google` |

`AUTH_URL` in locale può restare vuota. **Senza le credenziali Google il resto funziona
comunque**: il provider `dev` non passa da Google. Servono solo per provare il login vero.

> **La porta è 5433, non 5432.** Sulla macchina di sviluppo la 5432 era già occupata da un altro
> progetto. Vedi `docs/DECISIONS.md` (2026-08-07).

### I due modi di entrare

- **Google**, l'unico che esisterà in produzione. Al primo accesso l'app chiede **nome e
  cognome** e non ti lascia andare altrove finché non li scrivi.
- **"Entra come `<nome>`"**, la lista degli utenti seeded, presente **solo fuori produzione**.
  Serve perché collaudare un'asta a 8 richiederebbe 8 account Google veri. Un test automatico
  (`pnpm test`) verifica che in produzione questi pulsanti non esistano.

Per avere più utenti loggati insieme sulla stessa macchina: una finestra normale, una in
incognito, e per il terzo e il quarto un altro browser. Ogni finestra ha i suoi cookie, quindi la
sua sessione.

### Test dal telefono

```bash
pnpm dev:lan
```

Stampa l'indirizzo da digitare sul telefono (`http://192.168.x.x:3000`) — telefono e Mac sulla
stessa rete Wi-Fi. Non usare `next dev -H 0.0.0.0` a mano: senza `AUTH_URL` impostata all'IP
vero, dopo il login il telefono finisce su `http://0.0.0.0:3000`, che non esiste. Lo script se ne
occupa da sé.

Il login Google **non funziona** da IP di LAN (il redirect URI autorizzato è su `localhost`): dal
telefono si entra col provider `dev`, che è esattamente il motivo per cui esiste.

### Il collaudo della Fase 5 — passo per passo

Questa è la parte che tocca a te, e sono i quattro criteri di chiusura del piano più la prova sul
telefono. Serve un'ora, con calma. Prepara così il campo:

```bash
docker compose up -d
pnpm db:seed --auction-status=ready     # stampa gli URL e l'id dell'asta
pnpm dev                                # in un terminale, e lascialo aperto
pnpm bots --auction=<id> --count=7 --strategy=random   # in un secondo terminale
```

Sette bot occupano i posti da 1 a 7: **l'ottavo è tuo**. Entra da `/signin` come l'ultimo utente
della lista, vai in lobby e resta lì: quando tutti i pallini sono verdi, i bot avviano l'asta da
soli e la lobby ti porta sul tuo portale.

**Se collaudi da più dispositivi** (è la variante consigliata: due orologi diversi provano la
sincronizzazione meglio di quattro finestre sullo stesso computer), il server va lanciato con
`pnpm dev:lan` e **tutti** — telefono, altro PC e anche il browser del Mac — usano l'indirizzo di
LAN che lo script stampa, mai `localhost`, altrimenti le sessioni non sono confrontabili. I bot
vogliono lo stesso indirizzo: `--url=http://192.168.x.x:3000`. La regola dei posti è
`--count = 8 − quante finestre umane apri`, e i bot prendono sempre i posti più bassi.

**Per far partire l'asta dal tuo posto** invece che dal primo: lancia i bot **senza** `--start`,
collegati con tutti i dispositivi, poi apri una finestra **in incognito**, entra come l'owner
(Marco Bianchi) e vai sulla **regia**, `/auctions/<id>/manage`. Lì scegli il posto di partenza — un
pulsante per posto, ciascuno col suo pallino — e premi «Avvia l'asta».

Serve l'incognito perché nella finestra normale sovrascriveresti la tua sessione di partecipante.
Se il pulsante è spento, sotto c'è scritto chi non è collegato: l'avvio pretende **tutti** i membri
con la pagina aperta in primo piano. Senza scegliere il posto, la rotazione parte dal primo e il tuo
turno di chiamata — la schermata che più vale la pena guardare — arriva dopo un giro intero.

> Fino alla Fase 5 questo passaggio si faceva a mano dalla console del browser, con una `fetch` su
> `POST /api/auctions/<id>/action`. Funziona ancora, ma non serve più.

> Con i timer del seed (3 secondi per offrire) si fa fatica a *guardare* le schermate. Se vuoi
> tempo per leggere, allunga i tempi di quell'asta prima di avviarla, dal database:
> `update auctions set bid_seconds=15, pick_seconds=15, tie_prep_seconds=8, reveal_seconds=15
> where id='<id>';`. È un'asta di prova, e i timer si applicano dal lotto successivo.

I quattro criteri, nell'ordine in cui conviene provarli:

1. **Quattro browser reali, nessun desync.** Una finestra normale, una in incognito, e altri due
   browser (Safari, Firefox): quattro utenti diversi nella stessa asta, con i bot a riempire i
   posti restanti. Guardali fianco a fianco per una decina di lotti: il countdown deve scorrere
   uguale su tutti, il vincitore del reveal deve essere lo stesso, i crediti devono coincidere.
2. **Modale chiuso e riaperto.** Offri, chiudi il modale con "Chiudi", riapri dalla card con
   "Modifica offerta": la tua cifra deve essere ancora lì. Poi lascia scorrere al lotto dopo: il
   modale si riapre da sé.
3. **Tab killato a metà round.** Chiudi la finestra mentre un round è aperto e riaprila (o
   ricarica con ⌘R): devi ritrovare la stessa schermata degli altri, con il countdown giusto —
   non ripartito da capo — e l'offerta già salvata nel campo.
4. **Offline durante il tuo turno di chiamata.** Quando tocca a te, chiudi la finestra e aspetta
   che il timer scada. Rientrando devi vedere il lotto generato dall'**auto-pick** con la tua
   offerta d'apertura a 1: mai una schermata di scelta ancora aperta.

Poi lo **spareggio**, che a mano non si innesca: rilancia i bot con `--strategy=tie` e offri
esattamente `10` come loro. Vedrai il pannello "Sei nello spareggio", il round 2 con la tua
offerta riportata, e nel reveal le due sezioni ("Buste" e "Spareggio") con i `+Ns` che spiegano
chi ha vinto a parità di cifra.

E la **pausa**: dalla Fase 6 è un pulsante nella regia (`/auctions/<id>/manage`, nella finestra in
incognito dove sei l'owner). Premi «Metti in pausa» e guarda il portale del partecipante: banner
giallo, countdown **fermo** sul residuo di quel momento, nessun modale aperto. «Riprendi l'asta» e
il tempo riparte da dov'era, non da capo.

**Infine il telefono, che è il criterio più importante.** Ferma `pnpm dev`, lancia `pnpm dev:lan`,
apri sul telefono l'indirizzo che stampa ed entra col provider `dev`. Gioca qualche lotto per
davvero, in piedi, con una mano. Le cose da guardare:

- toccando il campo dell'importo la pagina **non deve zoomare** e deve comparire il **tastierino
  numerico**, non la tastiera con le lettere;
- con la tastiera aperta, **countdown e "max" devono restare visibili** sopra il campo;
- il pulsante di conferma deve stare comodo sotto il pollice;
- dopo l'invio il `✓ Offerta salvata: N` deve comparire subito, senza far saltare il pulsante.

Se una di queste quattro cose non è vera, annotala e apri una sessione dedicata: sono i quattro
punti su cui si gioca l'usabilità della serata.

### Il collaudo della Fase 6 — passo per passo

Mezz'ora, tutta al computer. Il campo si prepara come per la Fase 5, ma **senza** far avviare l'asta
ai bot: l'avvio è la prima cosa da provare.

```bash
docker compose up -d
pnpm db:seed --auction-status=ready     # stampa l'id dell'asta
pnpm dev                                # in un terminale
pnpm bots --auction=<id> --count=8 --strategy=random   # in un secondo terminale, senza --start
```

**1. La regia.** Entra come l'owner (Marco Bianchi) e vai su `/auctions/<id>/manage` — ci arrivi
anche dalla dashboard e dalla pagina di configurazione, "Vai alla regia". Devi vedere le otto rose
con crediti, speso e offerta massima, e i pallini di presence.

**2. Il cancello d'avvio.** Ferma i bot (Ctrl-C) e guarda: entro quindici secondi il pulsante
«Avvia l'asta» si spegne e sotto compaiono i nomi di chi non è collegato. Rilancia i bot: torna
verde. Poi scegli **il posto di partenza** — clicca il quarto, per dire — e avvia: la prima
chiamata deve toccare a quel posto, e il primo ruolo deve essere il primo del tuo `role_order`.

**3. Pausa e ripresa.** Con l'asta viva premi «Metti in pausa»: il countdown della regia si ferma.
Riprendi e verifica che riparta dal tempo che restava, non da trenta secondi pieni. Se hai anche un
portale partecipante aperto in un'altra finestra, guarda i due insieme.

**4. L'alert di chi cade.** Killa i bot a metà asta: entro quindici secondi deve comparire il
banner rosso con i nomi. **L'asta non deve mettersi in pausa da sola** — continua con le chiamate
automatiche, ed è voluto.

**5. La vista TV — è il criterio ✅ della fase.** Dalla regia, il link "Vista TV ↗" apre
`/tv/<public_token>`. **Copia quell'URL e aprilo in una finestra in incognito**, dove non sei
loggato con nessun account: deve funzionare lo stesso. Con un'asta viva e i bot che offrono, guarda
un lotto intero:

- durante le offerte si vede il nome del giocatore, chi l'ha chiamato, **quante buste** sono
  arrivate e da chi — ma **nessuna cifra**;
- allo scadere, e solo lì, compaiono vincitore, prezzo e tutte le offerte.

Se vuoi la prova senza fidarti degli occhi, apri la console del browser di quella finestra sulla
scheda Network, guarda il messaggio dello stream durante le offerte e cerca `amount`: non deve
esserci. Non è nascosto dalla pagina — non arriva proprio.

**6. La leggibilità.** Questa è l'unica cosa che a schermo di computer non si giudica: se hai una TV
o un proiettore, collega il portatile e guarda da quattro metri. Il nome del giocatore, il countdown
e il prezzo di aggiudicazione devono leggersi senza sforzo; i nomi delle squadre nella colonna
di destra anche. Se qualcosa non si legge, annota **cosa** e **da che distanza**.

### Tutti i comandi

```bash
pnpm dev                  # app in sviluppo su localhost:3000
pnpm dev:lan              # idem, raggiungibile dal telefono in LAN
pnpm build                # build di produzione (output standalone)
pnpm test                 # vitest, fake timers sempre attivi
pnpm lint                 # eslint, compresa la regola sugli import di lib/db
pnpm typecheck            # tsc --noEmit
docker compose up -d      # Postgres
docker compose down       # ferma Postgres (i dati restano nel volume)
pnpm db:push              # applica lo schema drizzle al database
pnpm db:seed              # solo i 12 utenti di prova (idempotente)
pnpm db:seed --auction-status=ready   # + un'asta a 8 pronta, listone importato
pnpm db:seed --auction-status=draft   # + la stessa asta con un posto libero
pnpm db:seed --auction-status=live    # + la stessa asta appena avviata (LIVE)
pnpm db:seed --auction-status=mid     # + la stessa asta LIVE a metà, rose parziali
pnpm db:seed --auction-status=completed  # + la stessa asta finita, rose complete
pnpm drive --auction=<id> # gioca un'asta READY/LIVE fino a COMPLETED, senza UI
pnpm bots --auction=<id> --count=7 --strategy=random   # 7 partecipanti finti, via HTTP
pnpm db:studio            # ispezione del database dal browser
```

**`drive` e `bots` non sono la stessa cosa.** Il driver è un processo che gioca da solo, con il
proprio scheduler: serve a dimostrare che il motore funziona, e non ha bisogno dell'app accesa. I
bot sono **client**: vogliono l'app accesa (`pnpm dev`), fanno login col provider `dev`, aprono lo
stream SSE e agiscono via HTTP come farebbe un telefono. Sono quelli da usare per guardare una
schermata mentre l'asta va avanti — e, a differenza del driver, fanno arrivare gli aggiornamenti
anche al tuo browser.

```bash
pnpm bots --auction=<id> --count=7 --strategy=tie --start --verbose
```

| Opzione | Cosa fa |
|---|---|
| `--count=N` | Quanti membri impersonare, in ordine di posto. Lasciane fuori uno e quel posto è tuo, dal browser |
| `--strategy=` | `random` (verosimile), `aggressive` (offre sempre il massimo), `passive` (sempre il minimo), `tie` (tutti la stessa cifra → **spareggio a comando**) |
| `--start` | Avvia l'asta READY appena i bot sono collegati (fa login anche come owner) |
| `--verbose` | Stampa ogni azione e ogni rifiuto, col codice d'errore |
| `--url=` | Se l'app non è su `http://localhost:3000` |

> **Un'asta LIVE si muove da sola.** Con un processo attivo (l'app in `pnpm dev`, o il driver)
> lo scheduler fa scattare le scadenze: i pick scaduti diventano auto-pick e l'asta procede coi
> timer corti del seed. Un'asta `mid` è quindi *viva*, non un fermo immagine: se serve ferma,
> mettila in pausa. Senza nessun processo attivo, invece, non succede niente — riparte al
> prossimo avvio (boot recovery, vedi sotto).

### Riavvio a metà asta (boot recovery)

Il processo può morire o essere riavviato in qualunque momento: **lo stato è tutto a database** e
all'avvio (`instrumentation.ts`) lo scheduler fa un giro di sweep e riarma i timer di ogni asta
LIVE, entro un secondo.

- Se il downtime era **più corto** del tempo residuo del countdown, il round prosegue come se
  niente fosse: la deadline non si sposta.
- Se il downtime era **più lungo**, lo sweep chiude il round con le buste già consegnate a
  database — le offerte non vivono mai in memoria. Se l'esito così determinato non è quello che
  la stanza voleva, la correzione è quella del runbook incidenti: pausa → `voidAssignment`
  dell'assegnazione sbagliata → `manualAssign` con l'esito giusto → resume (strumenti della
  Fase 7). La rotazione dei turni non torna mai indietro.

> **`pnpm test` vuole Docker acceso.** Una parte dei test parla con Postgres vero — è l'unico modo
> di verificare che due join simultanei non prendano lo stesso posto. Senza database quella parte
> si salta con un avviso invece di fallire, ma un `pnpm test` che serva da verifica di gate va dato
> con `docker compose up -d` attivo.

### Quando qualcosa non va

| Sintomo | Cosa fare |
|---|---|
| `DATABASE_URL non è impostata` | Manca il `.env`: `cp .env.example .env` e riempilo |
| `ECONNREFUSED ... 5433` | Docker Desktop è spento, o `docker compose up -d` non è stato dato |
| `port is already allocated` su 5433 | Un altro container occupa la porta: `docker ps` e fermalo |
| La lista "Entra come …" è vuota | Manca il seed: `pnpm db:seed` |
| Dopo il login Google resti sull'onboarding | È il comportamento giusto: scrivi nome e cognome |
| Ripartire da zero col database | `docker compose down -v && docker compose up -d && pnpm db:push && pnpm db:seed --auction-status=ready` |
| `pnpm test` salta i test di integrazione | Docker è spento: `docker compose up -d` |
| L'asta di prova è in uno stato strano | Rilancia `pnpm db:seed --auction-status=ready`: la ricrea da zero |
| `L'app non risponde su http://localhost:3000` dai bot | Manca `pnpm dev` in un altro terminale: i bot sono client, non giocano da soli |
| L'asta non parte: «Non sono collegati: …» | È il cancello di presence: l'avvio richiede **tutti** i membri con la pagina aperta in primo piano. Coi bot, usa `--start` |
| Lo stream si apre ma poi non arriva niente | Sintomo dei singleton duplicati fra i bundle di Next: se ricompare, i registri di `lib/realtime/broadcast.ts` devono stare su `globalThis` (DECISIONS 2026-08-07, Fase 4) |
| Ogni pagina risponde 500, `Can't resolve 'fs'` | Un import di `lib/db` è finito nel bundle edge. Gli import dinamici di `instrumentation.ts` vanno **dentro** l'`if (process.env.NEXT_RUNTIME === "nodejs")`, e `pg` in `serverExternalPackages` |

## Produzione e serata dell'asta

*(Sezione da compilare in Fase 8, task F8-05: checklist pre-asta e runbook incidenti.)*
