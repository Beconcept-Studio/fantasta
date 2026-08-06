# RUNBOOK

## Guida per l'owner — il tuo iter attraverso il progetto

Questa sezione è per l'utente umano: cosa devi fare tu, fase per fase, e cosa puoi delegare.
**A ogni chiusura di fase, Claude deve ricapitolarti i punti di questa guida relativi al gate
appena chiuso e alla fase che si apre** (regola in `CLAUDE.md`).

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
| **0 — Scaffold** | Fornisci le credenziali OAuth. A fine fase: login con il **tuo** account Google vero, verifica che ti chieda nome e cognome, poi un login con un utente dev. ~10 minuti. |
| **1 — Setup asta** | Test a due browser (uno normale + uno incognito, due utenti dev): crea un'asta, carica il listone da UI, genera l'invito, entra col secondo utente, verifica i nomi squadra reciproci. Prova anche un listone "povero" per vedere il rifiuto I9. |
| **2 — Motore** ⚠ | **Nessun test manuale** — tutto da terminale. Supervisiona: `pnpm test` verde e confronta i nomi dei test con §12 del piano (1–26, 29, 30, 41). È la fase in cui NON avere fretta: se il motore è giusto, il resto è cosmetica. |
| **3 — Persistenza e timer** | Guarda con i tuoi occhi le due dimostrazioni: lo script che porta un'asta da READY a COMPLETED nel terminale, e il kill del processo a metà round → riparte da solo entro 1s. |
| **4 — SSE** | Quasi niente: i criteri sono test automatici. Se vuoi, un `curl` sullo stream. Da qui esistono i **bot**: chiedi una demo con `--strategy=tie` per vedere uno spareggio forzato. |
| **5 — Portale partecipante** ⚠ | **La fase più impegnativa per te.** Riservati un'ora abbondante: 4 browser insieme in un'asta con bot; chiudi/riapri il modale; killa un tab a metà round e rientra; vai offline durante il tuo turno. E soprattutto: **prova dal tuo telefono vero** via `pnpm dev:lan` — è un criterio di chiusura, non un optional. |
| **6 — Manager e TV** | Apri la vista TV in incognito (senza login) durante un'asta con bot: nessun importo a busta chiusa deve vedersi. Se hai una TV/proiettore, provala lì per la leggibilità. |
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

*(Sezione da compilare in Fase 0, task F0-14: docker, db:push, seed, dev, login dev.)*

## Produzione e serata dell'asta

*(Sezione da compilare in Fase 8, task F8-05: checklist pre-asta e runbook incidenti.)*
