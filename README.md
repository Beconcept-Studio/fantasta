# Fantasta — Asta Fantacalcio a busta chiusa

Web app per condurre l'asta del Fantacalcio **a busta chiusa**, in tempo reale, con tutti nella
stessa stanza.

Otto-dodici partecipanti offrono dal proprio telefono; un portale del manager è proiettato sulla TV.
Chi ha il turno chiama un giocatore, e da quel momento parte un countdown: ognuno consegna la propria
offerta **senza vedere quelle degli altri** — né gli importi, né chi si è già mosso. Allo scadere le
buste si aprono tutte insieme, il giocatore va a chi ha offerto di più, e in caso di parità c'è uno
spareggio. Rose, crediti residui e storico si aggiornano da soli su ogni schermo.

**In produzione su [Fantasta](https://fantasta.rggndr.it).** È un progetto personale,
costruito per una lega vera che gioca una sera all'anno — il che spiega diverse scelte: nessuna
scalabilità orizzontale, nessun servizio esterno, e una diffidenza sistematica verso tutto ciò che
la sera dell'asta potrebbe non funzionare.

## Com'è fatto

| Pezzo | Cosa |
|---|---|
| Framework | Next.js 15 (App Router, `output: 'standalone'`) · React 19 · TypeScript |
| Interfaccia | Tailwind CSS 4 · shadcn/ui su Radix |
| Database | PostgreSQL 16 · Drizzle ORM |
| Autenticazione | Auth.js v5 — Google, oppure email e password |
| Tempo reale | SSE nativo, senza librerie |
| Test | Vitest |
| In produzione | Un unico processo Node sotto pm2, su un VPS, con nginx davanti |

**Un processo solo, e non è un ripiego.** I countdown vivono in memoria, il registro delle
connessioni SSE è una variabile del processo, e la concorrenza è serializzata da un
`SELECT … FOR UPDATE` sulla riga dell'asta. Questa è la scelta che tiene tutto il resto semplice, ed
è il motivo per cui **Redis, code, worker separati, provider realtime e servizi di scheduling sono
esplicitamente vietati** nel progetto.

## Avviarlo in locale

Servono **Node 20 o superiore** (in sviluppo si usa la 24), **pnpm** e **Docker**.

```bash
pnpm install
cp .env.example .env          # poi apri .env: vedi sotto
docker compose up -d          # Postgres su localhost:5433 (non 5432)
pnpm db:push                  # applica lo schema, solo la prima volta
pnpm db:seed --auction-status=ready
pnpm dev                      # http://localhost:3000
```

Nel `.env` l'unica riga davvero obbligatoria è **`AUTH_SECRET`**, che generi con
`openssl rand -base64 32`. Le credenziali Google servono solo per provare quel login; `AUTH_URL` in
locale può restare vuoto, e senza `SMTP_HOST` i codici di verifica vengono stampati sullo stdout del
dev server invece che spediti — l'intero flusso di registrazione si prova così, senza avere nessuna
credenziale.

Il seed stampa a fine corsa tutti gli indirizzi che servono (setup, lobby, TV, invito) e i comandi
dei bot già compilati con l'id dell'asta. In locale si entra con un pulsante **«Entra come …»**,
senza password.

Per far muovere un'asta finta ci sono due strade: la **simulazione dentro l'app** (si crea l'asta
spuntando «Asta simulata» e si riempiono i posti di bot dal pannello), oppure `pnpm bots`, che sono
client veri che parlano via HTTP — utile per collaudare sessione, rotte e SSE *da fuori*. Il percorso
completo, con le due prove tipiche, è in
**[docs/HOWTO-PROVA-LOCALE.md](docs/HOWTO-PROVA-LOCALE.md)**.

### I comandi

```bash
pnpm dev                  # sviluppo
pnpm dev:lan              # come sopra, ma raggiungibile dal telefono in LAN
pnpm test                 # vitest (i test in tests/db/ vogliono Postgres acceso)
pnpm typecheck            # tsc --noEmit
pnpm build                # next build — esegue anche ESLint
pnpm db:push              # applica lo schema Drizzle
pnpm db:seed              # 12 utenti di prova (--auction-status=ready|mid per un'asta)
pnpm bots --auction=<id> --count=7 --strategy=random
pnpm mail:check           # l'SMTP risponde?
```

⚠ **`pnpm build` con `pnpm dev` acceso corrompe `.next`**: i due scrivono nella stessa cartella e il
dev server comincia a rispondere 500. A dev acceso usa `pnpm lint`, che è ciò che la build aggiunge
al typecheck.

## Da leggere, in quest'ordine

**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — il documento principale, e l'unico che serve
davvero per capire il progetto. È scritto in prosa per un umano, non è un elenco di file: spiega
perché un processo solo, com'è fatta la macchina a stati, perché lo stato esce dal server da un punto
solo, come funzionano SSE e presence, cos'è la simulazione. Se leggi una cosa sola, leggi questa.

**[CLAUDE.md](CLAUDE.md)** — come si lavora qui: le otto regole non negoziabili, il modello a tre
branch (`main` / `dev` / `feature/*`), le regole operative di produzione e gli errori già commessi
una volta. È scritto per un assistente AI, ma è la guida per chiunque tocchi il codice.

**[docs/DECISIONS.md](docs/DECISIONS.md)** — append-only, in ordine di data: ogni scelta non ovvia
con il suo perché, comprese quelle scartate e quelle ribaltate. È il posto dove cercare *«perché è
fatto così?»* prima di cambiare qualcosa.

**[docs/features/](docs/features/)** — il lavoro procede per **macro-feature**, una alla volta, e
ciascuna ha qui il suo file con spec e task insieme. L'[indice](docs/features/README.md) dice quali
sono chiuse e in quale versione.

**[CHANGELOG.md](CHANGELOG.md)** — cosa è cambiato per chi usa l'app, versione per versione. Ogni
sezione ha in fondo un **«Per chi aggiorna il server»** con i passi a mano eventualmente necessari:
è lì che si guarda prima e dopo un rilascio.

**[docs/PLAN.md](docs/PLAN.md)** — la specifica con cui è stata costruita la v1.0.0. È **archivio** e
non si estende più, ma i suoi **invarianti I1–I10 restano vincolanti**: il più importante è **I8**,
«durante un lotto aperto nessuno vede l'offerta di nessun altro», che è la ragione d'essere
dell'intera applicazione.

## Le regole che non si negoziano

Sono otto e stanno per esteso in [CLAUDE.md](CLAUDE.md). Le tre da conoscere prima di aprire un file:

1. **Mai un timer che decide.** Il client disegna i countdown, non li usa per cambiare stato: un
   round si chiude solo lato server.
2. **Lo stato dell'asta esce dal server da un punto solo**, `serializeSnapshot`. È ciò che rende I8
   vero per costruzione invece che per attenzione — e c'è una regola ESLint che rende un errore di
   lint importare il database da fuori dal motore.
3. **Mai fidarsi della validazione client.** La UI disabilita il pulsante, il server rifiuta
   comunque.
