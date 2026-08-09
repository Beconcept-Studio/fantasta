# Le macro-feature

Dopo v1.0.0 lo sviluppo non procede più per fasi. Procede per **macro-feature**: un tema
coerente, un branch, un merge su `main`, un minor. Una alla volta, e solo su richiesta esplicita.

Ogni macro ha un file qui dentro che contiene **spec e task insieme**: obiettivo, quali richieste
di `docs/REQUESTS.md` ci confluiscono, se tocca lo schema del database, quali invarianti di
`docs/PLAN.md` sono coinvolti, la spec, i task con checkbox e i criteri di verifica.

Quando una macro viene pianificata, le richieste che ci confluiscono **spariscono da
`docs/REQUESTS.md`**: il quaderno contiene solo ciò che non è ancora stato pianificato.

## In corso

| Macro | Tema | Aperta il |
|---|---|---|
| [M1](01-segretezza-offerte.md) | Segretezza e rivelazione delle offerte | 2026-08-09 |

## Da pianificare

Il raggruppamento delle richieste oggi in `docs/REQUESTS.md`, concordato il 2026-08-09.
L'ordine è indicativo: si apre quella che serve.

| Macro | Tema |
|---|---|
| **M1** | Segretezza e rivelazione delle offerte — nascondere chi ha offerto durante il lotto (portale e TV), card di chiusura che rivela offerte e vincitore |
| **M2** | Navigazione e identità delle pagine — navbar, sotto-navbar, titolo con badge dell'asta, portale TV compatto |
| **M3** | Tracciabilità — esportazione delle rose in un CSV unico, pagina di log dell'asta e dei lotti |
| **M4** | Simulazione in-app — asta simulata dall'interfaccia: l'owner partecipa, gli altri X sono bot |

## Chiuse

| Macro | Tema | Versione |
|---|---|---|
| [M0](00-nuova-linea-di-sviluppo.md) | La nuova linea di sviluppo: tre branch, versioni, documenti | v1.1.0 — 2026-08-09 |
