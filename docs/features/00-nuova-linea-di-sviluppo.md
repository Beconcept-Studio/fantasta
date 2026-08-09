# M0 — La nuova linea di sviluppo

> **Stato:** in corso · **Aperta il** 2026-08-09 · **Uscirà con** v1.1.0
> **Tocca lo schema del database?** No.
> **Invarianti coinvolti:** nessuno. Questa macro non tocca codice applicativo.

## Obiettivo

v1.0.0 è in produzione e le fasi 0–8 del piano sono chiuse. Da qui in avanti non ci sono più
fasi: ci sono **macro-feature**, che nascono dalle richieste raccolte in `docs/REQUESTS.md` e
arrivano in produzione una alla volta.

Questa macro non aggiunge niente all'applicazione. Cambia il modo in cui l'applicazione viene
sviluppata: introduce un flusso a tre branch, un versionamento, un formato di documento per le
feature, e riscrive `CLAUDE.md` perché continui a essere il file che dice come si lavora qui.

Il motivo è che il vecchio impianto documentale descrive un lavoro che non esiste più.
`CLAUDE.md` dice «rileggi la sezione di `PLAN.md` che riguarda la fase»: non ci sono più fasi.
`BACKLOG.md` è un elenco di task tutti spuntati. Se non si riscrive adesso, la prima
macro-feature verrà sviluppata a intuito, ed è esattamente ciò che questo progetto ha evitato
per otto fasi.

## Richieste che ci confluiscono

Nessuna. `docs/REQUESTS.md` resta intatto: questa macro prepara il terreno per pianificare
quelle richieste, non le pianifica.

---

## Spec

### 1. Il flusso git

Tre livelli, un solo senso di marcia.

| Branch | Cos'è | Chi lo tocca |
|---|---|---|
| `main` | **La produzione.** Ogni push fa partire il deploy Ploi (~2 minuti). | Solo merge da `dev`. Mai un commit diretto. |
| `dev` | **L'integrazione.** Si prova in locale. Nessun deploy la guarda: `DEPLOY_BRANCH` resta `main`. | Solo merge da `feature/*`. |
| `feature/NN-nome` | **Una macro-feature.** Nasce da `dev`, muore in `dev`. | Qui si committa, anche in piccolo. |

Il ciclo di una macro-feature:

1. `git switch dev && git pull` → `git switch -c feature/NN-nome`
2. Si lavora e si committa liberamente sul branch. Commit piccoli vanno benissimo: è il branch
   a essere macro, non il commit.
3. **Gate di chiusura feature** — `pnpm test`, `pnpm typecheck` e `pnpm build` tutti verdi, e i
   task del file feature tutti spuntati. Poi `git merge --no-ff` su `dev`.
4. **Prova su `dev`** — Docker + seed, `pnpm bots` o `pnpm drive`, e `pnpm dev:lan` per provare
   dal telefono. È il momento in cui si scopre ciò che i test non vedono.
5. Quando `dev` convince: `git merge --no-ff` su `main`, tag, `CHANGELOG.md`, push. Il deploy
   parte da solo.

`--no-ff` è obbligatorio, non stilistico: il merge commit è il punto in cui la macro-feature
inizia e finisce. Con il fast-forward la storia si appiattisce e per tornare indietro bisogna
ricostruire a mano dove cominciava.

**Non esistono branch per interventi piccoli.** Una correzione di una riga vive dentro la
macro-feature aperta, oppure aspetta la prossima. L'unica cosa che scavalca il flusso è
l'hotfix, qui sotto.

### 2. Le due eccezioni, dichiarate

**Hotfix.** `fix/nome` parte da `main`, e va rimesso su `main` **e subito dopo su `dev`**. Se il
secondo merge si dimentica, la prossima macro-feature riporta in produzione il bug appena tolto.

**Modifiche allo schema.** `pnpm db:push` non è nel deploy e resta manuale, di proposito
(DECISIONS 2026-08-07). Se una macro-feature tocca `lib/db/schema.ts`, **il merge su `main` non
basta**: va applicato lo schema a mano sul server. Per questo ogni file feature dichiara in
testa se tocca lo schema, e `CLAUDE.md` porta la procedura con l'ordine giusto. È la trappola
più probabile del nuovo flusso: un'app che va in 500 in produzione perché il codice nuovo
interroga una colonna che non esiste ancora.

Resta valida la regola già in vigore: **la sera dell'asta non si pusha su `main`**. Ora vale a
maggior ragione, perché un merge di macro-feature è più grosso di un commit.

### 3. Il versionamento

- `git tag v1.0.0` sul commit `6216aa4`, che è ciò che gira in produzione adesso.
- Ogni macro-feature che arriva su `main` è un **minor**: `v1.1.0`, `v1.2.0`, …
- Ogni hotfix è una **patch**: `v1.1.1`.
- `package.json` tiene la stessa versione del tag.
- `CHANGELOG.md` in radice: una sezione per versione, in italiano, scritta **al momento del merge
  su `main`**, non dopo.

Il valore concreto è il rollback con un nome: sul server `git reset --hard v1.1.0` seguito da un
rebuild, senza cercare uno sha nei log.

### 4. I documenti

**Congelati — archivio di v1.0.0.** `docs/PLAN.md` e `docs/BACKLOG.md` ricevono una riga di
intestazione che dice che sono archivio e che lo sviluppo corrente sta in `docs/features/`.

Archivio **non** vuol dire disattivato. Gli invarianti I1–I10 e le regole del motore descritte in
`PLAN.md` restano vincolanti per sempre. Significa soltanto che quei file non si estendono più:
una feature nuova non si scrive lì dentro.

**Vivi — progrediscono nel tempo.**

| File | Quando si aggiorna |
|---|---|
| `docs/ARCHITECTURE.md` | Alla chiusura di ogni macro-feature. Criterio di chiusura, non un extra. |
| `docs/DECISIONS.md` | Append-only, al momento della scelta. Intestazioni per macro: «2026-08-XX — M1, segretezza offerte». |
| `CHANGELOG.md` | Al merge su `main`. |

**Nuovi.**

- `docs/features/README.md` — l'indice: macro aperte, macro chiuse con la versione in cui sono
  uscite. La prima cosa da leggere riaprendo il progetto tra sei mesi.
- `docs/features/NN-nome.md` — uno per macro. Struttura fissa, quella di questo stesso file:
  intestazione con stato / versione / **tocca lo schema?** / invarianti coinvolti, poi Obiettivo,
  Richieste che ci confluiscono, Spec, Task, Verifica.
- `CHANGELOG.md` in radice.

**`docs/REQUESTS.md`** resta il quaderno dell'utente: lo scrive lui, non Claude. La regola nuova
è che **quando una richiesta viene pianificata dentro una macro-feature, sparisce da
`REQUESTS.md`**: il contenuto raffinato vive nel file della feature, e il quaderno contiene solo
ciò che non è ancora stato pianificato. Claude lo tocca in quel momento e solo per rimuovere,
mai altrimenti.

### 5. `CLAUDE.md` riscritto

Il file deve continuare a essere ciò che è oggi: la cosa che va letta prima di scrivere una riga
di codice. Cambia questo:

- **Regola zero** — da «rileggi la sezione di `PLAN.md` che riguarda la fase» a «rileggi
  `docs/features/NN.md` e gli invarianti di `PLAN.md` che tocca». La seconda metà — se qualcosa
  è ambiguo, fermati e chiedi — resta parola per parola.
- **Stato** — da «fasi 0–8 chiuse» a «v1.0.0 in produzione, si sviluppa per macro-feature», con
  il flusso branch in forma compatta: la tabella dei tre livelli e le cinque righe del ciclo.
- **Le narrazioni di Fase 7 e Fase 8** si condensano in un blocco unico *Regole operative di
  produzione*: niente undo, override solo senza lotto in contesa, mai un `DELETE`, un processo
  solo (`fork` + 1 istanza), server in UTC, `pnpm build` fa parte della verifica, `reload` e non
  `restart` dopo una modifica di `.env`. **Le regole restano tutte**; sparisce il racconto di
  quando sono state scoperte, che ormai vive in `ARCHITECTURE.md` e `DECISIONS.md`.
- **Comandi** — si aggiungono quelli del ciclo git.
- **Tabella della documentazione** — riscritta con la distinzione archivio / vivo / nuovo.
- **Invariati**: le otto regole non negoziabili, lo stack e i divieti, gli errori noti, la regola
  ESLint su `lib/db`.

Vincolo: il file resta intorno alle 180 righe attuali. Se cresce molto, la riscrittura è
sbagliata — `CLAUDE.md` deve stare in testa a chi lo legge.

### 6. Le quattro macro già identificate

Dalle nove richieste oggi in `docs/REQUESTS.md`, il raggruppamento concordato. Non vengono
pianificate adesso: questa sezione fissa solo la taglia e l'ordine.

| Macro | Richieste che ci confluiscono |
|---|---|
| **M1 — Segretezza e rivelazione delle offerte** | Lotto live: non mostrare chi ha offerto · Portale TV: idem · Card di chiusura lotto che rivela offerte e vincitore |
| **M2 — Navigazione e identità delle pagine** | Navbar · Sotto-navbar dentro l'asta · Titolo pagina con badge dell'asta · Portale TV compatto |
| **M3 — Tracciabilità** | Esportazione rose in un CSV unico · Pagina log dell'asta e dei lotti |
| **M4 — Simulazione in-app** | Asta simulata dall'interfaccia: l'owner partecipa, gli altri X sono bot |

Ognuna è un branch, un merge su `dev`, un merge su `main`, un minor. Si affrontano **una alla
volta e su richiesta esplicita**.

---

## Task

- [x] **M0-01** — Creare `dev` da `main` e `feature/00-nuova-linea-di-sviluppo` da `dev`
- [x] **M0-02** — Taggare `v1.0.0` sul commit `6216aa4` e allineare `package.json`
- [x] **M0-03** — Intestazione di archivio su `docs/PLAN.md` e su `docs/BACKLOG.md`. Su `PLAN.md`
      l'ok esplicito è stato dato il 2026-08-09 approvando questa spec: è l'unica modifica
      ammessa a quel file, e la sola ragione per cui non viola la regola della sola lettura
- [x] **M0-04** — Creare `docs/features/README.md`, l'indice delle macro
- [x] **M0-05** — Creare `CHANGELOG.md` con la sezione `v1.0.0`
- [x] **M0-06** — Riscrivere `CLAUDE.md` secondo la sezione 5
- [x] **M0-07** — **Eliminare `docs/RUNBOOK.md`** e i rimandi che lo citano (`deploy/deploy.sh`,
      `deploy/ecosystem.config.cjs`, `lib/db/index.ts`), trasferendo in `CLAUDE.md` le tre
      procedure che il flusso richiede: schema dopo il deploy, rollback a un tag, deploy manuale.
      Decisione dell'owner del 2026-08-09, presa in corso di macro: metà del file era la guida per
      fasi, morta con le fasi, e un documento per metà obsoleto smette di essere creduto anche
      nell'altra metà. Il resto resta leggibile con `git show v1.0.0:docs/RUNBOOK.md`. I rimandi
      in `docs/BACKLOG.md` e `docs/DECISIONS.md` **non** si toccano: sono storia
- [x] **M0-08** — Aggiungere a `docs/ARCHITECTURE.md` la nota su come si evolve il progetto dopo
      v1.0.0 (dove sta la documentazione di una feature, e perché)
- [x] **M0-09** — Voce in `docs/DECISIONS.md`: «2026-08-09 — M0, la nuova linea di sviluppo», con
      le scelte e il perché (niente staging, PLAN e BACKLOG congelati, un file per macro)
- [ ] **M0-10** — Chiusura: merge `--no-ff` su `dev`, prova, merge `--no-ff` su `main`, tag
      `v1.1.0`, push

## Verifica

Questa macro non tocca codice applicativo, quindi il gate non è la suite di test ma la
coerenza dei documenti. È chiusa quando:

1. `pnpm test`, `pnpm typecheck` e `pnpm build` sono verdi — niente è stato rotto per sbaglio.
2. `CLAUDE.md` non contiene più riferimenti a «fasi» come unità di lavoro corrente, e nessun
   documento vivo rimanda a `BACKLOG.md` per il lavoro da fare.
3. `git tag` elenca `v1.0.0` e `v1.1.0`; `package.json` dice `1.1.0`.
4. Il flusso è stato percorso davvero: questa macro è arrivata in produzione passando da
   `feature/00-…` → `dev` → `main`, non con un commit diretto su `main`.
5. `docs/features/README.md` elenca M0 come chiusa e M1–M4 come aperte.
