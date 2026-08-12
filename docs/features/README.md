# Le macro-feature

Dopo v1.0.0 lo sviluppo non procede più per fasi. Procede per **macro-feature**: un tema
coerente, un branch, un merge su `main`, un minor. Una alla volta, e solo su richiesta esplicita.

Ogni macro ha un file qui dentro che contiene **spec e task insieme**: obiettivo, quali richieste
di `docs/REQUESTS.md` ci confluiscono, se tocca lo schema del database, quali invarianti di
`docs/PLAN.md` sono coinvolti, la spec, i task con checkbox e i criteri di verifica.

Quando una macro viene pianificata, le richieste che ci confluiscono **spariscono da
`docs/REQUESTS.md`**: il quaderno contiene solo ciò che non è ancora stato pianificato.

## In corso

- **[M8](08-insight-listone.md)** — Insight sul listone: titolarità, rigoristi, calci piazzati.
  Aperta il 2026-08-11 su `feature/08-insight-listone`, **integrata su `dev` il 2026-08-12**. Non è
  ancora in produzione: il merge su `main` aspetta una richiesta esplicita. ⚠ Tocca lo schema in modo
  additivo, quindi il rilascio vorrà `pnpm db:push` a mano sul server, **più due backfill**: la
  tabella nasce vuota (Admin → Listone) e `is_pro` nasce `false` per tutti. Procedura in §10 del file.

⚠ **M7 è in produzione ma il suo rilascio non è finito finché non si fanno due passi a mano sul
server**, e nessuno te li ricorda: `CAMPIONCINI_EDITION` nel `.env` seguito da `pm2 reload
deploy/ecosystem.config.cjs --update-env`, e **l'archivio riempito da Admin → Figurine**, perché in
produzione nasce vuoto. Nessuno dei due rompe niente se manca — semplicemente non si vede nessuna
figurina — che è precisamente ciò che li rende facili da dimenticare. La procedura per esteso è nel
`CHANGELOG.md` di v1.8.0.

## Da pianificare

Nessuna. Il quaderno `docs/REQUESTS.md` è vuoto.

Due strade sono state **verificate e rinviate** durante M8, e sono scritte per esteso nel suo §9
perché il lavoro d'analisi non si perda: la **griglia portieri** (l'accoppiamento fra portieri di due
squadre — e la scoperta che qualsiasi indice per-squadra è provabilmente inutile, perché la media di
riga vale 9.00 per tutte e venti) e i **titolari attesi con gli infortunati del momento**, che
fantacalcio.it serve pubblicamente ma **solo a campionato in corso**: interrogata ad agosto, quella
pagina è vuota.

M5 e M6 sono nate da una sessione di spec sola, il 2026-08-10, e sono state **tagliate in due di
proposito**. M5 tocca la strada del login — l'unica cosa che, se si rompe, chiude fuori tutti — e
introduce l'unica dipendenza esterna del progetto; M6 è un pannello. Due profili di rischio così
diversi vogliono due tag e due punti di rollback: un rollback del pannello non deve portarsi via la
registrazione. E la dipendenza è a senso unico — la lista utenti di M6, senza M5, non avrebbe niente
da amministrare.

## Chiuse

| Macro | Tema | Versione |
|---|---|---|
| [M7](07-caricature.md) | Le caricature dei calciatori — la figurina scaricata una volta e guardata per tutta la serata | v1.8.0 — 2026-08-11 |
| [M6](06-amministrazione.md) | Amministrazione — il pannello: lista utenti, lista aste, e un perimetro strettissimo | v1.7.0 — 2026-08-11 |
| [M5](05-identita.md) | Identità — registrazione con email e password, verifica dell'indirizzo, recupero | v1.6.0 — 2026-08-10 |
| [M4](04-simulazione.md) | Simulazione in-app — l'asta di prova dall'interfaccia, con i bot dentro l'app | v1.5.0 — 2026-08-10 |
| [M3](03-tracciabilita.md) | Tracciabilità — il verbale delle rose e lo storico dell'asta | v1.4.0 — 2026-08-10 |
| [M2](02-navigazione.md) | Navigazione e identità delle pagine | v1.3.0 — 2026-08-10 |
| [M1](01-segretezza-offerte.md) | Segretezza e rivelazione delle offerte | v1.2.0 — 2026-08-10 |
| [M0](00-nuova-linea-di-sviluppo.md) | La nuova linea di sviluppo: tre branch, versioni, documenti | v1.1.0 — 2026-08-09 |

## Fuori macro

Non tutto passa da una macro, e va detto qui invece di sparire. In **v1.2.0**, su richiesta
esplicita dell'owner («falla direttamente qui»), sono entrati su `dev` senza aprirne una:

- **«Prosegui asta»** — l'evento `SKIP_REVEAL` e i suoi due pulsanti. Il perché delle scelte è in
  `docs/DECISIONS.md`, 2026-08-09.
- **Tre correzioni** attorno alla configurazione ad asta iniziata: il salvataggio dei tempi che non
  funzionava, il nome disabilitato, l'avviso costante, e la lobby che rimbalzava al portale in
  pausa. `docs/DECISIONS.md`, 2026-08-10.
- **La prova in locale**: `docs/HOWTO-PROVA-LOCALE.md` e il seed che fa entrare l'owner per ultimo.

In **v1.3.1**, sempre su richiesta esplicita («vai pure da `dev` a `main` senza branch»):

- **La versione nella navbar**, accanto al pulsante per uscire. Serve a controllare a vista quale
  codice sta rispondendo in produzione. `docs/DECISIONS.md`, 2026-08-10.

Il criterio resta quello di `CLAUDE.md`: una macro si apre su richiesta esplicita. Quando invece
si lavora direttamente su `dev`, restano dovuti `DECISIONS.md` al momento della scelta e
`CHANGELOG.md` al rilascio — che è ciò che rende questa riga leggibile fra sei mesi.
