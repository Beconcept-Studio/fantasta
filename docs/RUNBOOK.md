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
| ~~**6 — Manager e TV**~~ ✓ | Il collaudo è scritto passo per passo qui sotto ("Il collaudo della Fase 6"). In due parole: apri la **regia** e avvia da lì un'asta con bot scegliendo il posto di partenza, prova pausa e ripresa, killa un bot e guarda comparire l'alert; poi apri la **vista TV in incognito** (senza login) e verifica che durante le offerte non si veda nessun importo. Se hai una TV o un proiettore, provala lì per la leggibilità: è l'unica cosa che a schermo di computer non si può giudicare. ~30 minuti. |
| **7 — Override** | Il collaudo è scritto passo per passo qui sotto ("Il collaudo della Fase 7"). In due parole: simula la serata storta — pausa → cancella un giocatore da una rosa → riassegna manualmente → riprendi — e verifica che crediti e rose tornino da soli. Poi esporta l'xlsx e **aprilo in Excel**: `FantaSquadra` e `Costo` riempite, e il giocatore corretto risulta della squadra nuova. ~20 minuti. |
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
anche dalla dashboard e dalla pagina di configurazione, "Regia dell'asta". Devi vedere le otto rose
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

### Il collaudo della Fase 7 — passo per passo

Venti minuti, tutto al computer. Stesso campo della Fase 6: un'asta `ready`, l'app accesa, otto bot.

```bash
docker compose up -d
pnpm db:seed --auction-status=ready     # stampa l'id dell'asta
pnpm dev                                # in un terminale
pnpm bots --auction=<id> --count=8 --strategy=random   # in un secondo terminale, senza --start
```

**1. Il pannello.** Entra come l'owner, vai su `/auctions/<id>/manage` e apri «Correzioni». Deve
dirti, prima di tutto, che un pulsante «annulla» non esiste e perché.

**2. Con le buste aperte non si tocca niente.** Avvia l'asta e aspetta il primo lotto aperto: il
pannello si deve spegnere e comparire la riga in ambra che spiega di aspettare l'assegnazione.
**Premi «Metti in pausa» e riguarda**: deve restare spento. La pausa congela la fase, non la azzera
— è la cosa più facile da dare per scontata al contrario.

**3. La correzione vera — è il primo criterio ✅ della fase.** Aspetta la fine di un lotto (fase
«buste aperte» o «in attesa della chiamata»), poi:

- annota crediti e rosa di chi ha vinto;
- in «Cancella un giocatore da una rosa» scegli la sua squadra, premi «Cancella» sul giocatore e
  conferma. **I crediti devono risalire esattamente del prezzo pagato** e il giocatore sparire
  dalla rosa, subito, senza ricaricare la pagina;
- in «Assegna un giocatore a mano» scegli un'altra squadra, cerca **quello stesso giocatore** (deve
  ricomparire fra i liberi: se non ricompare, il void non ha funzionato), metti un prezzo diverso e
  assegna. La nuova rosa e i nuovi crediti si aggiornano da soli.

Se hai un portale partecipante aperto in un'altra finestra, tieni d'occhio anche quello: la
correzione ci deve arrivare come ci arriva un'offerta.

**4. Quello che il server rifiuta comunque.** Prova ad assegnare un giocatore che è già in una
rosa: non compare nemmeno nella lista dei liberi. Prova una rettifica di −500 crediti: deve essere
rifiutata con un messaggio che nomina i numeri («resterebbe con … crediti per … slot»). Prova ad
assegnare un secondo portiere a chi ne ha già uno: rifiutato, e con la spunta «Forza lo slot in
eccesso» accettato.

**5. Il registro.** Le rettifiche non spariscono: `psql` e `select type, payload from events where
auction_id = '<id>' order by id desc limit 5;` deve mostrare `MANUAL_ASSIGN`, `VOID_ASSIGNMENT` e
`ADJUST_BUDGET` con dentro chi, cosa e perché. E `select price, source, voided_at from assignments`
deve mostrare la riga annullata ancora lì, con la data.

**6. L'export — è il secondo criterio ✅ della fase.** Dalla barra dei link, «Scarica le rose
(.xlsx)». **Apri il file in Excel o Numbers**: foglio `Lista calciatori`, tutto il listone, e le
colonne `FantaSquadra` e `Costo` riempite solo per i giocatori comprati. Il giocatore che hai
cancellato al punto 3 deve risultare della squadra **nuova**, al prezzo nuovo. Se sei sul sito di
Fantacalcio.it, prova a ricaricarlo lì: è quello il vero collaudo.

### Correggere un errore in diretta

La procedura da tenere a mente la sera dell'asta, in quattro mosse:

1. **Pausa** dalla regia, così nessuno perde secondi mentre si ragiona.
2. Aspetta di **non avere buste aperte**: se il pannello è spento, l'assegnazione del lotto in
   corso arriva in pochi secondi. La pausa da sola non basta.
3. **Cancella** il giocatore dalla rosa sbagliata e **riassegnalo** com'era giusto, col prezzo
   giusto. Se il problema è solo il prezzo, cancella e riassegna allo stesso.
4. **Riprendi**. I countdown ripartono dal tempo che restava.

Cosa **non** si può fare, e come conviene raccontarlo a voce: il turno di chiamata non torna
indietro. Se il lotto sbagliato ha già fatto passare il turno, quel turno è passato — si corregge
la rosa, non la storia.

Se la correzione riempie il ruolo di chi sta per chiamare, quel turno viene **saltato** (il suo
pick verrà rifiutato e alla scadenza si passa al prossimo): è voluto, ed è meglio dirlo prima che
scoprirlo insieme.

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
bot sono **client**: vogliono l'app accesa (`pnpm dev`), si firmano un cookie di sessione con
`AUTH_SECRET`, aprono lo stream SSE e agiscono via HTTP come farebbe un telefono. Sono quelli da usare per guardare una
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

### La macchina, in sei righe

| | |
|---|---|
| Indirizzo | **<https://fantasta.rggndr.it>** · IP `46.225.231.138` |
| Server | Hetzner CX22 (2 vCPU, 4 GB), Ubuntu 26.04 LTS, gestito con **Ploi** |
| Fuso | **UTC**, sia la macchina sia il processo (`TZ=UTC` in `deploy/ecosystem.config.cjs`). Ogni orario nei log e nel database è UTC: d'estate l'ora italiana è **+2** |
| Accesso | `ssh ploi@46.225.231.138` (solo chiave; il login per password è disattivato) |
| Cartella | `/home/ploi/fantasta.rggndr.it` |
| Processo | un solo processo Node sotto **pm2**, che si chiama `asta`, in ascolto su `127.0.0.1:3000` con **nginx** davanti |

Tre password diverse, che è facile confondere: quella **di sudo dell'utente `ploi`** (sta nel
pannello di Ploi; serve per `systemctl`, `nginx`, `sudo -u postgres`), quella **del database**
(sta solo dentro `.env`, e la usano l'app e il backup), e la **passphrase della chiave SSH**, che
non lascia mai il tuo Mac.

### Entrare e guardare cosa succede

```bash
ssh ploi@46.225.231.138
cd /home/ploi/fantasta.rggndr.it
export DB="$(sed -n 's/^DATABASE_URL="\(.*\)"$/\1/p' .env)"   # per interrogare il database

pm2 status                     # il processo `asta` è online?
pm2 logs asta                  # l'asta in diretta: una riga per transizione
pm2 logs asta --lines 50 --nostream
pm2 describe asta | grep -E "uptime|restarts|memory"
```

`export DB=…` vale **solo nella sessione in cui lo dai**: in una tab nuova va rifatto, insieme al
`cd`.

### Il deploy

Il deploy parte **da solo a ogni push su `main`** (webhook GitHub → Ploi → `deploy/deploy.sh`) e
dura **circa due minuti**. Si può anche lanciare a mano, dal pulsante di Ploi o dal server:

```bash
cd /home/ploi/fantasta.rggndr.it && ./deploy/deploy.sh
```

Cosa fa, in ordine: rifiuta di partire se un'asta è `LIVE` o `PAUSED`, `git reset --hard
origin/main`, `pnpm install --frozen-lockfile --prod=false`, `pnpm build`, **copia `.next/static`
dentro `.next/standalone`**, `pm2 reload`. Finisce stampando il commit finito in produzione, e
quella riga si legge anche nel log di Ploi (*Deployments*).

> ⚠ **La sera dell'asta non si pusha su `main`.** La guardia protegge la finestra pericolosa —
> asta viva — ma non la fase di setup: lì un deploy sono due minuti di pagine ballerine e di
> presence che si riazzera mentre i partecipanti stanno entrando in lobby. Se vuoi la cintura in
> più, spegni *Quick deploy* dal pannello di Ploi per quella sera e riaccendilo il giorno dopo.
> Se serve davvero deployare ad asta viva: `DEPLOY_DURING_AUCTION=1 ./deploy/deploy.sh`.

**Se cambi una variabile in `.env`**, il deploy non basta:

```bash
pm2 reload deploy/ecosystem.config.cjs --update-env
```

e **non** `pm2 restart asta`: è l'ecosystem file a leggere `.env`, e lo fa quando pm2 lo valuta —
un restart per nome riparte con l'ambiente vecchio, e sembra che la modifica non abbia avuto
effetto.

Lo **schema del database non si applica mai da solo**: `pnpm db:push` è un comando manuale, di
proposito. `drizzle-kit` gira con `strict: false` e non chiede il permesso a nessuno.

### Checklist pre-asta (PLAN §17) — da eseguire il giorno stesso

**1. Backup completo, e una copia scaricata in locale.**

```bash
# sul server
cd /home/ploi/fantasta.rggndr.it && ./deploy/db-backup.sh && ls -lh ~/backups/
# dal tuo Mac
scp ploi@46.225.231.138:'~/backups/asta-*.sql.gz' ~/Downloads/
```

**2. Asta di prova a 8 bot con timer accelerati, portata a `COMPLETED`, in produzione.**

```bash
pnpm db:seed --auction-status=ready      # stampa id, link TV e la riga dei bot già pronta
pnpm bots --auction=<ID> --count=8 --strategy=random --start --url=https://fantasta.rggndr.it
```

Sono ~200 lotti in 10–20 minuti. A fine corsa i controlli che contano:

```bash
psql "$DB" -c "select status, completed_at from auctions where id='<ID>';"
psql "$DB" -c "
select m.team_name, count(a.id) giocatori, m.budget_initial - coalesce(sum(a.price),0) crediti
from members m left join assignments a on a.member_id=m.id and a.voided_at is null
where m.auction_id='<ID>' group by m.team_name, m.budget_initial order by 1;"
```

Atteso: `COMPLETED`, otto rose da **25** giocatori, crediti tutti **≥ 0**.

**3. Cancellazione dell'asta di prova, e l'asta vera in `READY`.**

```bash
psql "$DB" -c "delete from auctions where id='<ID-DI-PROVA>';"
psql "$DB" -c "delete from users where google_sub is null;"   # via i 12 utenti finti del seed
psql "$DB" -c "select name, status from auctions;"            # deve restare solo quella vera, READY
```

Il `DELETE` porta via tutto per cascata ed è l'unico posto in cui è legittimo: la regola 5 vieta
di *correggere* con `DELETE` dentro un'asta viva, non di buttarne una intera.

**4. Vista TV sul dispositivo di proiezione, provata con un lotto finto.** Il link è
`https://fantasta.rggndr.it/tv/<public_token>`; il token si legge dalla regia o così:

```bash
psql "$DB" -c "select name, public_token from auctions;"
```

Aprila **in incognito**: non ha login, e il token *è* la sua autenticazione. Se sul televisore
qualcosa è illeggibile, quello è il momento di scoprirlo.

**5. Ogni partecipante fa login e compare `LIVE` in lobby, prima di cominciare.** È un cancello
vero, non un consiglio: `startAuction` rifiuta finché **tutti** i membri non hanno la pagina
aperta in primo piano. Sulla regia (`/manage`) ogni posto ha il suo pallino.

**6. `pm2 logs asta` aperto su un terminale, visibile a te per tutta la durata.**

```bash
ssh ploi@46.225.231.138 'pm2 logs asta'
```

### Se qualcosa va storto in diretta

**La pausa è sempre il primo passo.** Non esiste uno stato in cui mettere in pausa peggiori le
cose: le scadenze vengono congelate e poi traslate, non perse.

| Sintomo | Azione |
|---|---|
| Un partecipante non riesce a offrire | Pausa. Guarda presence e `max_bid` sulla regia. Se serve, a lotto chiuso il manager sistema con `manualAssign` |
| Un lotto si è chiuso con l'esito sbagliato | Pausa → `voidAssignment` dell'assegnazione errata → `manualAssign` con l'esito giusto → resume. **La rotazione dei turni non torna indietro** |
| Un client resta indietro | Ricarica la pagina. Ogni schermata è funzione dello snapshot: non c'è niente da recuperare |
| Il telefono di qualcuno si è disconnesso | Basta che riapra la pagina. Nel frattempo, al suo turno scatta l'auto-pick e le sue offerte si fermano a 1 |
| Il server non risponde | `pm2 restart asta`. Lo stato è tutto a database e il boot recovery riprende **dentro il ritmo dell'asta** (misurato: buco massimo 4 secondi su 1260 transizioni). Se il downtime supera il tempo residuo, lo sweep chiude il round con le buste già a database; esito sbagliato → pausa → void → manualAssign |
| La pagina si carica senza stile e non risponde | Manca `.next/static` dentro `.next/standalone`: rilancia `./deploy/deploy.sh`, che la copia e fallisce esplicitamente se non ci riesce |
| I countdown si muovono a scatti di 30 secondi | nginx sta bufferizzando lo stream: controlla che il `location ~ ^/api/auctions/[^/]+/stream$` con `proxy_buffering off` sia ancora nella config del sito (Ploi la riscrive quando rinnova il certificato) |
| Dubbio su cosa sia successo | `psql "$DB" -c "select * from events where auction_id='<ID>' order by id desc limit 50;"` |
| Il processo mangia memoria | pm2 lo riavvia da sé a 512 MB, e il boot recovery copre il riavvio. Normale sta sui 150 MB |

Verificare lo stato in un colpo d'occhio, da terminale:

```bash
psql "$DB" -c "select name, status, phase, state_version, phase_deadline from auctions;"
```

### Backup e restore

Il `pg_dump` gira ogni notte alle **04:15 UTC** (06:15 italiane) e tiene gli ultimi **14** dump in
`~/backups`, con il log in `~/backups/backup.log`.

```bash
./deploy/db-backup.sh          # un backup adesso
./deploy/db-restore-check.sh   # prova il restore dell'ultimo dump su un DB separato, poi lo butta
crontab -l                     # controlla che il cron ci sia
```

`db-restore-check.sh` non tocca mai la produzione: ricrea `asta_restore_check`, ci ripristina il
dump, conta le righe, **verifica I2** (nessun giocatore assegnato due volte fra le righe vive) e
cancella la copia. Chiede la password di sudo.

**Restore vero, sopra la produzione** — solo se il database è compromesso, e con l'app ferma:

```bash
pm2 stop asta
gunzip -c ~/backups/asta-<data>.sql.gz | psql "$DB"
pm2 start asta
psql "$DB" -c "select name, status, state_version from auctions;"
```

Il dump contiene i `DROP` in testa (`--clean --if-exists`), quindi si ripristina anche sopra un
database che contiene già qualcosa.

### Le cose che si rompono solo in produzione

Cinque trappole che in locale non esistono, tutte già pagate una volta:

1. **Il redirect URI di Google** va aggiunto a mano nella console per il dominio di produzione
   (`https://fantasta.rggndr.it/api/auth/callback/google`), e l'app va **pubblicata**: in modalità
   *Testing* entrano solo gli account aggiunti come utenti di test. Se il login dà
   `invalid_client`, il problema è `AUTH_GOOGLE_ID`; se dà `redirect_uri_mismatch`, è l'URI. Per
   vedere cosa manda davvero l'app basta leggere il parametro `client_id` del redirect verso
   `accounts.google.com`.
2. **`output: 'standalone'` non copia `.next/static` né `public/`.** Senza, la pagina si carica
   senza CSS e senza idratazione — e il sintomo (il portale fermo su «Mi collego all'asta…»)
   sembra un problema di realtime. Lo fa `deploy.sh`, che si ferma se la copia non è riuscita.
3. **Gli import di `instrumentation.ts` devono restare dentro l'`if (NEXT_RUNTIME === "nodejs")`**,
   altrimenti `pg` finisce nel bundle edge e ogni pagina risponde 500.
4. **`proxy_buffering off` sulla rotta dello stream**, o i countdown vanno a scatti.
5. **`next build` esegue ESLint**: un errore di lint **blocca la build di produzione** anche se
   `pnpm dev` e `pnpm test` sono verdi. Per questo `pnpm build` va dato **prima** di chiudere una
   fase, non la sera del deploy.

### Rifare la macchina da zero

Se un giorno il server sparisse, la sequenza completa è: creare un Hetzner CX22 con Ubuntu LTS →
adottarlo in Ploi come *Custom server* scegliendo **PostgreSQL 16** e *Do not install PHP* →
puntare il record A del dominio → creare il sito e agganciare il repository → creare database e
utente → `cp deploy/env.production.example .env` e riempirlo → `pnpm install --frozen-lockfile
--prod=false`, `pnpm db:push`, `./deploy/deploy.sh`, `pm2 startup` e `pm2 save` → incollare i due
`location` di `deploy/nginx-asta.conf` nella config del sito **dopo** aver emesso il certificato
(l'emissione riscrive quel file) → rimettere il cron del backup. Tutto ciò che serve è in `deploy/`
e in questo capitolo.
