# Le macro-feature

Dopo v1.0.0 lo sviluppo non procede più per fasi. Procede per **macro-feature**: un tema
coerente, un branch, un merge su `main`, un minor. Una alla volta, e solo su richiesta esplicita.

Ogni macro ha un file qui dentro che contiene **spec e task insieme**: obiettivo, quali richieste
di `docs/REQUESTS.md` ci confluiscono, se tocca lo schema del database, quali invarianti di
`docs/PLAN.md` sono coinvolti, la spec, i task con checkbox e i criteri di verifica.

Quando una macro viene pianificata, le richieste che ci confluiscono **spariscono da
`docs/REQUESTS.md`**: il quaderno contiene solo ciò che non è ancora stato pianificato.

## In corso

Nessuna. La prossima è **M3**, qui sotto.

## Da pianificare

Il raggruppamento delle richieste in `docs/REQUESTS.md`, concordato il 2026-08-09.
L'ordine è indicativo: si apre quella che serve.

| Macro | Tema |
|---|---|
| **M3** | Tracciabilità — esportazione delle rose in un CSV unico, pagina di log dell'asta e dei lotti |
| **M4** | Simulazione in-app — asta simulata dall'interfaccia: l'owner partecipa, gli altri X sono bot |

## Chiuse

| Macro | Tema | Versione |
|---|---|---|
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
