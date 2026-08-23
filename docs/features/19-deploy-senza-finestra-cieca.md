# M19 — Il deploy senza finestra cieca

**Stato**: pianificata, **non aperta**. Nessun branch, nessun codice.
**Schema del database**: nessuna modifica. Nessun backfill.
**Invarianti di `PLAN.md` coinvolti**: nessuno direttamente. ⚠ Vincolo architetturale da non
violare: **un processo solo** (`exec_mode: "fork"`, `instances: 1` in
`deploy/ecosystem.config.cjs`) — vedi «Cosa non si tocca».
**Nasce da**: l'episodio del 2026-08-23, non da `docs/REQUESTS.md`. Nessuna richiesta del quaderno
confluisce qui.

---

## Il problema, misurato

`deploy/deploy.sh` ricompila **in place**: `pnpm build` rigenera `.next/` mentre il processo vecchio
è ancora vivo e sta servendo. Gli asset statici che quel processo serve stanno in
`.next/standalone/.next/static/`, e la build li cancella sotto i suoi piedi.

Misurato durante il rilascio della `v1.19.2`:

| Ora (UTC) | Evento |
|---|---|
| 12:53:20 | il deploy parte, `git reset`, `pnpm install`, `pnpm build` |
| ~12:53:40 | `.next/standalone/` **non esiste più** (colto in questo stato: `package.json` mancante) |
| 12:54:30 | `.next/BUILD_ID` riscritto |
| 12:55:30 | asset statici ricopiati in `standalone` |
| 12:55:32 | `pm2 reload` |

**Finestra: ~2 minuti e 10 secondi.** In quella finestra l'app risponde ma è inservibile: una pagina
caricata non si idrata, e le richieste di `/_next/static/chunks/*` danno 404. È esattamente quello che
l'owner ha visto su `/auctions/new` durante quel rilascio, e per un minuto ha sembrato un bug
dell'applicazione — che non c'era: in quel rilascio non c'era **una riga** di codice applicativo.

⚠ **Ci sono due finestre, non una, e la seconda non si chiude spostando la build.** Dopo lo scambio,
chi ha in mano una pagina HTML **vecchia** ne conserva i riferimenti a chunk con hash che non
esistono più: gli si rompe alla prima navigazione o al primo componente caricato in modo lazy. La
prima finestra (durante la build) è quella che questa macro deve chiudere; la seconda (dopo lo
scambio) è inerente a un deploy senza CDN e va **documentata**, non risolta.

**Perché adesso e non prima.** Fino al 2026-08-23 i deploy erano rari e dati a mano. Da quando il
webhook è corretto partono da soli a ogni push su `main`, quindi quella finestra si incontra molto
più spesso. E la guardia dello script protegge **solo** dalle aste `LIVE` o `PAUSED`: la fase di
setup — quando si creano le aste e la gente aspetta in lobby — non è protetta da niente.

---

## Cosa non si tocca

Vincoli che qualunque soluzione deve rispettare, non preferenze:

- **`exec_mode: "fork"` e `instances: 1`.** Due processi eseguono due volte
  `instrumentation.ts`, cioè due sweep sulla stessa asta. Qualunque soluzione che passi da un
  «processo nuovo accanto a quello vecchio» va valutata *proprio* su questo: due processi vivi
  insieme, anche per dieci secondi, sono due scheduler.
- **`.env` sta nella radice del progetto** e non è in git.
- ⚠ **`MEDIA_DIR` è derivato da `ROOT`** in `ecosystem.config.cjs`
  (`path.join(ROOT, "storage")`): l'archivio delle figurine (M7, ~51 MB) vive **dentro** la cartella
  del progetto. Qualunque soluzione che cambi la radice per rilascio deve pinnare `MEDIA_DIR` in
  `.env`, o il primo deploy si porta via l'archivio.
- **Il server standalone porta la propria copia di `node_modules`.** Il processo vecchio non
  dipende da `node_modules/` della radice: `pnpm install` durante il deploy non lo disturba. È
  questa la ragione per cui la soluzione A qui sotto è sicura.

---

## Le tre strade, con i loro costi

### A — Compilare in una `distDir` parallela e scambiare *(raccomandata)*

`next build` scrive in `.next-build/` invece di `.next/`; a build finita, due `mv`:
`.next` → `.next-prev`, `.next-build` → `.next`; poi `pm2 reload`.

**Pro**

- La finestra passa da **~130 secondi a ~2**: solo il tempo dei due `mv` (millisecondi) più il
  riavvio del processo. Durante tutta la build il processo vecchio serve dal suo `.next` intatto.
- **Non tocca `ecosystem.config.cjs`**, né il percorso di pm2, né `.env`, né `storage/`. Il raggio
  d'azione è un solo file: `deploy/deploy.sh` (più una riga in `next.config.ts`).
- **Regala un rollback istantaneo**: `.next-prev` resta sul disco, quindi tornare indietro è due `mv`
  e un reload, senza ricompilare. Oggi un rollback costa `git reset` + `pnpm install` + `pnpm build`.
- Un processo solo, sempre: nessun periodo con due processi vivi.

**Contro**

- ⚠ **Va verificato che l'output `standalone` non incorpori il nome della `distDir`.** Se `server.js`
  o i suoi manifest contenessero `.next-build` in percorsi assoluti o relativi alla radice, dopo lo
  scambio il processo cercherebbe una cartella che non c'è più. **È il rischio che decide se A è
  praticabile, e va provato prima di scrivere il resto** (vedi M19-01).
- `next.config.ts` deve leggere una variabile d'ambiente per la `distDir`: la configurazione smette di
  essere una costante e diventa dipendente dall'ambiente. Piccolo, ma è una verità in più.
- Raddoppia lo spazio occupato da `.next` (più `.next-prev`: tre copie nel momento di picco). Su 37 GB
  con il 39% usato non è un problema, ma va detto e va messa una pulizia.
- Non chiude la **seconda** finestra (chunk vecchi in mano a un browser dopo lo scambio).

### B — Cartella di rilasci e symlink, alla Capistrano

`releases/<sha>/` più un symlink `current`; pm2 punta a `current/.next/standalone/server.js`.

**Pro**

- È **l'unica** che azzera la prima finestra del tutto: il processo vecchio serve dalla propria
  cartella, che nessuno tocca, finché non si ricarica.
- Rollback e storico dei rilasci gratis.

**Contro** — e per questo progetto sono pesanti:

- ⚠ **`MEDIA_DIR` diventerebbe per-rilascio**: l'archivio delle figurine finirebbe dentro
  `releases/<sha>/storage` e sparirebbe al rilascio successivo. Si risolve pinnando `MEDIA_DIR` in
  `.env`, ma è un passo a mano su un file non in git — cioè la categoria di passo che questo progetto
  ha già visto dimenticare.
- `.env` va condiviso fra i rilasci (symlink), e con lui qualunque stato futuro.
- Il modello `git reset --hard` sul posto — che è **la** semplificazione su cui è costruito il deploy
  attuale, «il server è una copia di git, non un posto dove si scrive» — verrebbe sostituito da un
  clone per rilascio. Cambia anche il modo in cui Ploi e il webhook interagiscono con la cartella.
- Aggiunge un livello di deployment a un progetto che deliberatamente non ne ha, contro la regola 8 e
  contro l'obiettivo dichiarato di restare leggibile in un pomeriggio.

**Verdetto**: corretta in generale, sproporzionata qui. Da riconsiderare solo se A si rivelasse
impraticabile.

### C — Non ridurre la finestra: renderla onesta e impossibile da incontrare

Due mosse indipendenti, entrambe piccole:

- **C1 — pagina di manutenzione.** Il deploy crea un file-bandiera all'inizio e lo rimuove alla fine;
  `deploy/nginx-asta.conf` (già nel repository) risponde 503 con una pagina «stiamo aggiornando,
  torna fra un minuto» finché la bandiera esiste. Trasforma «l'app è rotta» in «l'app si sta
  aggiornando», che è la verità.
- **C2 — guardia più larga.** Oggi il deploy si rifiuta con un'asta reale `LIVE` o `PAUSED`.
  Aggiungere `READY` copre il caso «la gente è in lobby e sta per cominciare», che è il momento in cui
  un deploy fa più danno e in cui oggi passa liscio.

**Pro**: minuscole, nessuna ristrutturazione, e attaccano il **danno** invece della causa.
**Contro**: l'app resta inservibile per due minuti; C1 è quasi inutile se si fa A (la finestra
diventa di due secondi), C2 invece **resta utile in ogni caso**.

---

## La proposta

**A come cura, C2 come complemento.** A porta la finestra a ~2 secondi e regala il rollback
istantaneo; C2 costa tre parole nella query della guardia e chiude il caso «lobby piena». C1 diventa
superflua se A funziona, e va tenuta in tasca come ripiego **se** M19-01 dicesse che A non è
praticabile. B resta scritta qui perché è la risposta da manuale, e perché il giorno che il progetto
avesse due processi o due macchine sarebbe la strada giusta — oggi no.

---

## Task

- [ ] **M19-01 — La prova che decide.** Su una copia locale: `distDir` a `.next-build`, `pnpm build`,
      poi cercare `.next-build` dentro `.next-build/standalone/**` (`server.js`, i manifest, i
      `required-server-files.json`). Se il nome della cartella compare in un percorso, A non è
      praticabile così com'è e si passa a C1. **Nessun'altra riga si scrive prima di questa.**
- [ ] **M19-02 — `next.config.ts`**: `distDir` da variabile d'ambiente, con default `.next` — in
      sviluppo nulla cambia.
- [ ] **M19-03 — `deploy/deploy.sh`**: build nella cartella parallela, i due `mv`, il `pm2 reload`,
      la pulizia di `.next-prev` più vecchio di un rilascio. Il controllo sul CSS che già c'è va fatto
      **prima** dello scambio: se la copia degli asset è andata male, si abortisce senza scambiare, e
      la produzione non si accorge di niente.
- [ ] **M19-04 — Rollback documentato**: i due `mv` inversi più il reload, in CLAUDE.md accanto alla
      procedura di rollback esistente, che oggi ricompila.
- [ ] **M19-05 — C2**: `READY` nella guardia delle aste reali, e il messaggio che spiega quale asta
      sta bloccando.
- [ ] **M19-06 — La misura, non l'impressione.** Durante un deploy vero, uno script che chiede un
      chunk statico noto una volta al secondo e conta i 404. Prima: attesi ~130 secondi di 404. Dopo:
      atteso **zero**, salvo il riavvio. È il criterio di accettazione, e senza il «prima» non vale.
- [ ] **M19-07 — Documentazione**: `DECISIONS.md` (perché A e non B, con il dettaglio di `MEDIA_DIR`),
      `ARCHITECTURE.md` (la sezione sul deploy), `CHANGELOG.md` al merge.

## Criteri di verifica

1. Durante un deploy, **zero 404** su un chunk statico noto, tranne i secondi del riavvio di pm2.
2. `.next-prev` esiste dopo il deploy e i due `mv` inversi più un reload riportano alla versione
   precedente **senza ricompilare** — provato, non dedotto.
3. Una build che fallisce **non** scambia niente: la produzione resta sulla versione precedente e lo
   script esce con codice diverso da zero.
4. `pnpm dev` e `pnpm build` in locale si comportano esattamente come prima, senza variabili
   d'ambiente da ricordare.
5. La guardia rifiuta un deploy con un'asta reale in `READY` e dice quale.
6. `ecosystem.config.cjs` non è stato toccato: un processo solo, `MEDIA_DIR` invariato, `storage/`
   dove era.

## ⚠ Il rischio da tenere in mano

Questa macro modifica **il percorso con il raggio d'azione più grande del progetto**. Un errore qui
non rompe una schermata: rende la produzione non aggiornabile, o la lascia con mezza build.
Il primo task esiste per questo — e la sequenza di prova va fatta **in quest'ordine**: la prova
locale, poi un deploy vero guardato dall'inizio alla fine, poi la misura dei 404. Il ripiego, in
qualunque momento, è `git revert` del merge e il deploy vecchio che torna a funzionare come oggi.
