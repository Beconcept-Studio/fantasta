# Le macro-feature

Dopo v1.0.0 lo sviluppo non procede più per fasi. Procede per **macro-feature**: un tema
coerente, un branch, un merge su `main`, un minor. Una alla volta, e solo su richiesta esplicita.

Ogni macro ha un file qui dentro che contiene **spec e task insieme**: obiettivo, quali richieste
di `docs/REQUESTS.md` ci confluiscono, se tocca lo schema del database, quali invarianti di
`docs/PLAN.md` sono coinvolti, la spec, i task con checkbox e i criteri di verifica.

Quando una macro viene pianificata, le richieste che ci confluiscono **spariscono da
`docs/REQUESTS.md`**: il quaderno contiene solo ciò che non è ancora stato pianificato.

## In corso

Nessuna. **M9 è chiusa su `dev`** e aspetta il rilascio: `CHANGELOG.md`, `package.json`, il merge su
`main` e il tag `v1.10.0` si danno **su richiesta esplicita dell'owner**, e non c'è nessun passo a mano
sul server da preparare — M9 non tocca lo schema, quindi per una volta il rilascio finisce col deploy.
⚠ Resta invece **una prova che solo l'owner può fare**: guardare i badge dal telefono su un'asta col
listone vero. Le quattro verifiche non spuntate del file di M9 sono tutte di quella forma.

In produzione **non resta nessun passo a mano pendente**: i tre di M8 (`pnpm db:push`, i due import dal
pannello, `is_pro`) e i due di M7 (`CAMPIONCINI_EDITION` nel `.env`, l'archivio figurine riempito) sono
stati **dati e confermati dall'owner il 2026-08-12**. Se un giorno un dato di M7 o M8 sembra assente in
produzione, non è quello il sospetto da coltivare per primo.

## Da pianificare

**Quattro macro, pianificate insieme il 2026-08-12** da una sessione di analisi sola, a partire dalle
quattro richieste che l'owner aveva scritto nel quaderno dopo il rilascio di v1.9.1. **La prima è
chiusa**; le altre tre si aprono **su richiesta esplicita**, una alla volta.

| Macro | Tema | Schema | Ordine |
|---|---|---|---|
| **[M10](10-listone-a-sistema.md)** | Il listone a sistema: la sezione admin, il Centro dati, la proposta alla creazione di un'asta | **sì** + backfill | 2ª |
| **[M11](11-refresh-giornaliero.md)** | Il refresh giornaliero degli insight, dentro l'unico processo | sì, piccolo | 3ª |
| **[M12](12-cancellazione-aste.md)** | Cancellare un'asta per forza, anche in corso | no | 4ª |

**Perché quattro e non una.** Le quattro richieste sembravano un tema solo — «sistemiamo il pannello»
— e hanno invece quattro profili di rischio diversi, che è il criterio con cui M5 e M6 sono state
tagliate in due il 2026-08-10. M9 era tutta UI: zero schema, zero motore, e si è chiusa in una sessione. M10
tocca **la strada dell'import**, cioè l'unica cosa che se si rompe rende impossibile *preparare* un'asta,
e porta uno `db:push` più un file da caricare a mano in produzione. M11 è l'unico codice che gira
**senza che nessuno guardi** dentro il processo che conduce l'asta. M12 è l'unico **irreversibile**: un
suo errore non si corregge con un `git reset`, si corregge con un `pg_dump`. Quattro tag e quattro
punti di rollback, perché un ritorno indietro sui badge non deve portarsi via la cancellazione delle
aste, e un ritorno indietro sul listone non deve rimettere la striscia verde.

**Le dipendenze sono due, e sono debolissime.** M10 usa i badge di M9 nel Centro dati — e M9 è chiusa,
quindi quella dipendenza è già soddisfatta: `InsightBadge` in `components/auction/insights.tsx` aspetta
il suo terzo chiamante, ed è il momento in cui dimostrerà di essere un componente e non tre
`className`. M11 ha bisogno del pannello di M10 per avere un posto dove
dire «ho provato e non ci sono riuscito» — e quella non è cosmetica: un automatismo muto è peggio di
nessun automatismo. M12 non dipende da niente.

**Due strade restano verificate e rinviate**, scritte per esteso in M8 §9 perché il lavoro d'analisi non
si perda: la **griglia portieri** (l'accoppiamento fra portieri di due squadre — e la scoperta che
qualsiasi indice per-squadra è provabilmente inutile, perché la media di riga vale 9.00 per tutte e
venti) e i **titolari attesi con gli infortunati del momento**, che fantacalcio.it serve pubblicamente
ma **solo a campionato in corso**: interrogata ad agosto, quella pagina è vuota. ⚠ La seconda ha avuto
una **seconda ratifica** il 2026-08-12: la richiesta di un badge «Infortunato (ora)» in rosso è stata
**ritirata dall'owner** proprio per quella misura. Non va riproposta come idea nuova.

## Chiuse

| Macro | Tema | Versione |
|---|---|---|
| [M9](09-badge-insight.md) | I badge degli insight, e la striscia verde via | v1.10.0 — su `dev`, tag e rilascio su richiesta |
| [M8](08-insight-listone.md) | Insight sul listone — titolarità, rigoristi, calci piazzati | v1.9.0 — 2026-08-12 |
| [M7](07-caricature.md) | Le caricature dei calciatori — la figurina scaricata una volta e guardata per tutta la serata | v1.8.0 — 2026-08-11 |
| [M6](06-amministrazione.md) | Amministrazione — il pannello: lista utenti, lista aste, e un perimetro strettissimo | v1.7.0 — 2026-08-11 |
| [M5](05-identita.md) | Identità — registrazione con email e password, verifica dell'indirizzo, recupero | v1.6.0 — 2026-08-10 |
| [M4](04-simulazione.md) | Simulazione in-app — l'asta di prova dall'interfaccia, con i bot dentro l'app | v1.5.0 — 2026-08-10 |
| [M3](03-tracciabilita.md) | Tracciabilità — il verbale delle rose e lo storico dell'asta | v1.4.0 — 2026-08-10 |
| [M2](02-navigazione.md) | Navigazione e identità delle pagine | v1.3.0 — 2026-08-10 |
| [M1](01-segretezza-offerte.md) | Segretezza e rivelazione delle offerte | v1.2.0 — 2026-08-10 |
| [M0](00-nuova-linea-di-sviluppo.md) | La nuova linea di sviluppo: tre branch, versioni, documenti | v1.1.0 — 2026-08-09 |

M5 e M6 sono nate da una sessione di spec sola, il 2026-08-10, e sono state **tagliate in due di
proposito**. M5 tocca la strada del login — l'unica cosa che, se si rompe, chiude fuori tutti — e
introduce l'unica dipendenza esterna del progetto; M6 è un pannello. Due profili di rischio così
diversi vogliono due tag e due punti di rollback: un rollback del pannello non deve portarsi via la
registrazione. E la dipendenza è a senso unico — la lista utenti di M6, senza M5, non avrebbe niente
da amministrare. È lo stesso criterio con cui il 2026-08-12 sono state tagliate M9–M12.

## Fuori macro

Non tutto passa da una macro, e va detto qui invece di sparire. In **v1.2.0**, su richiesta
esplicita dell'owner («falla direttamente qui»), sono entrati su `dev` senza aprirne una:

- **«Prosegui asta»** — l'evento `SKIP_REVEAL` e i suoi due pulsanti. Il perché delle scelte è in
  `docs/DECISIONS.md`, 2026-08-09.
- **Tre correzioni** attorno alla configurazione ad asta iniziata: il salvataggio dei tempi che non
  funzionava, il nome disabilitato, l'avviso costante, e la lobby che rimbalzava al portale in
  pausa. `docs/DECISIONS.md`, 2026-08-10.
- **La prova in locale**: `docs/HOWTO-PROVA-LOCALE.md` e il seed che fa entrare l'owner per ultimo.

Dopo **v1.9.0**, su richiesta esplicita («si direi di filtrare quelle simulate, procedi pure»):

- **La guardia del deploy ignora le aste simulate.** Una simulazione lasciata in pausa bloccava ogni
  deploy e non c'era modo di chiuderla, quindi l'unico rimedio era scavalcare la guardia ogni volta.
  `docs/DECISIONS.md`, 2026-08-12. ⚠ **M12 apre quel vicolo cieco**, e ha ratificato che la guardia
  resta comunque com'è: la voce sta nel suo §5.

In **v1.3.1**, sempre su richiesta esplicita («vai pure da `dev` a `main` senza branch»):

- **La versione nella navbar**, accanto al pulsante per uscire. Serve a controllare a vista quale
  codice sta rispondendo in produzione. `docs/DECISIONS.md`, 2026-08-10.

Il criterio resta quello di `CLAUDE.md`: una macro si apre su richiesta esplicita. Quando invece
si lavora direttamente su `dev`, restano dovuti `DECISIONS.md` al momento della scelta e
`CHANGELOG.md` al rilascio — che è ciò che rende questa riga leggibile fra sei mesi.
