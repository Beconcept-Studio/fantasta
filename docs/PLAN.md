# Asta Fantacalcio a Busta Chiusa — Piano di Build

> **Archivio di v1.0.0. Non aggiornare.** Lo sviluppo corrente vive in `docs/features/`.
>
> Archivio **non** vuol dire disattivato: le regole marcate **INVARIANTE** — I1–I10 in
> particolare — restano vincolanti per sempre. Significa solo che questo documento non si
> estende: una feature nuova non si scrive qui dentro.

Documento di specifica operativa di v1.0.0, redatto prima della Fase 0 e rispettato fino alla
chiusura della Fase 8 il 2026-08-09.
Ogni sezione è vincolante: le regole marcate **INVARIANTE** non sono negoziabili durante l'implementazione.

---

## 0. Obiettivo e contesto

Web app per gestire un'asta di Fantacalcio **a busta chiusa** in tempo reale, per un gruppo
ristretto (8–12 partecipanti, tutti nella stessa stanza, un portale proiettato su TV).

Non serve scalabilità. Serve **correttezza**: un'asta live che si desincronizza o assegna due
volte lo stesso giocatore è inutilizzabile. Tutte le scelte architetturali sotto sono subordinate
a questo.

### Come funziona l'asta (regolamento)

1. È il turno di un partecipante (rotazione oraria). Ha `pick_seconds` per **chiamare** un
   calciatore del ruolo attualmente in asta. Se scade il tempo, il sistema chiama in automatico
   il giocatore disponibile con `fvm` più alto in quel ruolo.
2. Alla chiamata parte un round di offerte di `bid_seconds`. Tutti i partecipanti idonei
   preparano un'offerta in busta chiusa. Nessuno vede le offerte altrui.
3. Allo scadere si aprono le buste: il giocatore va a chi ha offerto di più.
4. In caso di pareggio sul massimo si apre **un solo** round di spareggio, aperto ai soli
   pareggianti. Se anche lì gli importi restano pari, vince chi ha fissato quella cifra per primo.
5. Si passa al partecipante successivo. L'asta finisce quando tutte le rose sono complete.

---

## 1. Stack e infrastruttura

| Componente | Scelta | Motivo |
|---|---|---|
| Framework | Next.js 15, App Router, `output: 'standalone'` | Processo Node persistente, non serverless |
| UI | shadcn/ui + Tailwind | Richiesto |
| DB | PostgreSQL 16, stessa macchina | Latenza nulla, zero servizi esterni |
| ORM | Drizzle | Migrations SQL leggibili, runtime leggero |
| Auth | Auth.js v5 (`next-auth@beta`), provider Google | Richiesto |
| Realtime | SSE nativo (`ReadableStream` in un Route Handler) | Mono-direzionale, riconnessione automatica, zero dipendenze |
| Timer | `setTimeout` in-process + sweep `setInterval` 1s | Possibile solo grazie al processo persistente |
| Import/Export | SheetJS (`xlsx`) lato server | Legge il formato Fantacalcio.it |
| Hosting | Hetzner CX22 + Ploi + nginx + Let's Encrypt | ~4 €/mese, tutto su una macchina |

**Vincolo**: non introdurre Redis, code, worker separati, provider realtime esterni o servizi
di scheduling. Un singolo processo Node è sufficiente e semplifica radicalmente la concorrenza.

### Variabili d'ambiente

```
DATABASE_URL=postgres://...
AUTH_SECRET=...
AUTH_URL=https://asta.tuodominio.it
AUTH_GOOGLE_ID=...
AUTH_GOOGLE_SECRET=...
```

---

## 2. Autenticazione e ruoli

- Login unicamente con **Google OAuth**. Nessuna password, nessun invio email.
- Al primo accesso l'utente compila **nome e cognome** (`users.display_name`) — obbligatorio prima
  di poter creare o partecipare a un'asta.
- Il **nome squadra** è per-asta, non per-utente: si imposta al momento del join.
- Tre livelli di autorizzazione:
  - `users.is_admin` — admin di piattaforma: vede tutte le aste e tutti gli utenti. Sola lettura.
  - `auctions.owner_user_id` — creatore dell'asta: configura, avvia, mette in pausa, fa override manuali.
  - membro dell'asta: partecipa e offre.
- **Vista TV pubblica**: `GET /tv/[publicToken]` accessibile senza login, sola lettura, stesse
  regole di sanificazione degli altri client (mai importi a busta chiusa).

---

## 3. Modello dati

Drizzle schema. `id` = `uuid` con default `gen_random_uuid()` salvo dove indicato.

```sql
-- ─── Utenti ────────────────────────────────────────────────────────────────
users(
  id, google_sub UNIQUE, email, display_name, avatar_url,
  is_admin BOOLEAN DEFAULT false, created_at
)

-- ─── Asta ──────────────────────────────────────────────────────────────────
auctions(
  id, name, owner_user_id REFERENCES users,
  public_token TEXT UNIQUE,                   -- link vista TV

  status       TEXT,   -- DRAFT | READY | LIVE | PAUSED | COMPLETED
  phase        TEXT,   -- WAITING_PICK | LOT_OPEN | LOT_TIE_PREP | LOT_REVEAL | NULL
  state_version INTEGER DEFAULT 0,            -- incrementato ad OGNI transizione

  seats INTEGER CHECK (seats IN (8, 10, 12)),
  budget_default INTEGER DEFAULT 500,
  bid_seconds INTEGER DEFAULT 30,
  pick_seconds INTEGER DEFAULT 30,
  tie_prep_seconds INTEGER DEFAULT 10,
  reveal_seconds INTEGER DEFAULT 10,
  slots_p INTEGER DEFAULT 3,
  slots_d INTEGER DEFAULT 8,
  slots_c INTEGER DEFAULT 8,
  slots_a INTEGER DEFAULT 6,

  role_order   TEXT[],        -- ordine scelto a creazione (drag & drop). Default ['P','D','C','A']
                              -- Permutazione completa di P,D,C,A. Modificabile solo in DRAFT/READY.
  current_role TEXT,
  current_seat_index INTEGER,
  current_lot_id UUID,
  phase_deadline TIMESTAMPTZ, -- scadenza della fase corrente
  paused_at TIMESTAMPTZ,      -- valorizzato solo se status = PAUSED

  created_at, started_at, completed_at
)

-- ─── Membri ────────────────────────────────────────────────────────────────
members(
  id, auction_id REFERENCES auctions ON DELETE CASCADE,
  user_id REFERENCES users,
  team_name TEXT,
  seat_index INTEGER,          -- ordine di rotazione, 0-based
  budget_initial INTEGER,
  last_seen_at TIMESTAMPTZ,
  is_visible BOOLEAN DEFAULT false,
  created_at
)
UNIQUE(auction_id, user_id)
UNIQUE(auction_id, seat_index)

-- ─── Inviti ────────────────────────────────────────────────────────────────
invites(
  token TEXT PRIMARY KEY, auction_id, created_by_user_id,
  expires_at, max_uses INTEGER, uses INTEGER DEFAULT 0
)

-- ─── Listone (snapshot per asta) ───────────────────────────────────────────
players(
  id, auction_id REFERENCES auctions ON DELETE CASCADE,
  ext_id INTEGER,              -- colonna "#" del file
  name TEXT, team TEXT,
  role TEXT,                   -- P | D | C | A  (colonna "R.")
  role_mantra TEXT,
  fvm INTEGER,                 -- colonna "FVM/1000"
  quot INTEGER,                -- colonna "QUOT."
  out_of_list BOOLEAN DEFAULT false
)
UNIQUE(auction_id, ext_id)
INDEX(auction_id, role, fvm DESC, quot DESC, ext_id ASC)   -- per l'auto-pick

-- ─── Lotti (una chiamata all'asta) ─────────────────────────────────────────
lots(
  id, auction_id, seq INTEGER,
  player_id REFERENCES players,
  called_by_member_id REFERENCES members,
  auto_called BOOLEAN DEFAULT false,
  status TEXT,                 -- OPEN | RESOLVED
  current_round INTEGER DEFAULT 1,
  winner_member_id REFERENCES members,
  final_price INTEGER,
  opened_at, resolved_at
)
CREATE UNIQUE INDEX one_open_lot_per_auction
  ON lots(auction_id) WHERE status = 'OPEN';

-- ─── Round di offerta ──────────────────────────────────────────────────────
lot_rounds(
  id, lot_id REFERENCES lots ON DELETE CASCADE,
  round_no INTEGER,            -- 1 = round base, 2 = spareggio
  min_amount INTEGER DEFAULT 1,
  starts_at, ends_at, closed_at
)
UNIQUE(lot_id, round_no)

round_eligibility(
  lot_round_id REFERENCES lot_rounds ON DELETE CASCADE,
  member_id REFERENCES members
)
PRIMARY KEY(lot_round_id, member_id)

-- ─── Offerte ───────────────────────────────────────────────────────────────
bids(
  id, lot_round_id REFERENCES lot_rounds ON DELETE CASCADE,
  member_id REFERENCES members,
  amount INTEGER NOT NULL CHECK (amount >= 1),
  amount_set_at TIMESTAMPTZ NOT NULL,   -- quando è stata fissata QUESTA cifra
  created_at TIMESTAMPTZ NOT NULL,
  withdrawn_at TIMESTAMPTZ
)
UNIQUE(lot_round_id, member_id)   -- l'override è un UPDATE, non una nuova riga

-- ─── Rose ──────────────────────────────────────────────────────────────────
assignments(
  id, auction_id, member_id REFERENCES members,
  player_id REFERENCES players,
  price INTEGER NOT NULL,
  lot_id REFERENCES lots,
  source TEXT,                 -- AUCTION | MANUAL
  created_at, voided_at
)
CREATE UNIQUE INDEX one_owner_per_player
  ON assignments(auction_id, player_id) WHERE voided_at IS NULL;

-- ─── Rettifiche budget ─────────────────────────────────────────────────────
ledger(
  id, auction_id, member_id, delta INTEGER, reason TEXT,
  actor_user_id, created_at
)

-- ─── Audit ─────────────────────────────────────────────────────────────────
events(
  id BIGSERIAL, auction_id, type TEXT, payload JSONB, created_at
)
```

### Due scelte da rispettare

**Il credito non è una colonna mutabile.**
`crediti(m) = m.budget_initial + Σ ledger.delta − Σ assignments.price (voided_at IS NULL)`
Le rettifiche manuali del manager sono righe di `ledger`. Gli annullamenti sono `voided_at`,
mai `DELETE`. In un'asta live serve poter annullare e riassegnare, non la correzione
distruttiva di un numero.

**Il listone è copiato dentro l'asta.** `players` ha `auction_id`: la lista si congela al momento
dell'import. Se il file cambia l'anno prossimo, le aste passate restano coerenti.

---

## 4. Macchina a stati — il cuore dell'applicazione

### Stati

```
DRAFT ──(seats pieni + listone importato + validazione ok)──> READY
READY ──(owner: start, sceglie ruolo iniziale + seat iniziale)──> LIVE
LIVE  <──> PAUSED        (owner)
LIVE  ──(tutte le rose complete)──> COMPLETED
```

### Sotto-fasi di LIVE (`auctions.phase`)

```
                ┌──────────────────┐
                │  WAITING_PICK    │  deadline = pick_seconds
                └────────┬─────────┘
         pick(playerId)  │  oppure timeout → auto-pick (fvm più alto)
                         ▼
                ┌──────────────────┐
        ┌──────►│    LOT_OPEN      │  deadline = bid_seconds
        │       └────────┬─────────┘
        │                │ timeout → valuta le offerte
        │       ┌────────┴──────────────────────────┐
        │       │                                   │
        │  max unico                     pareggio sul max
        │       │                                   │
        │       │                  round_no = 1 ────┤──── round_no = 2
        │       │                          │        │        │
        │       │                          ▼        │        ▼
        │       │              ┌──────────────────┐ │  risolvi per
        └───────┼──────────────┤  LOT_TIE_PREP    │ │  amount_set_at ASC
     round 2    │              └──────────────────┘ │        │
                │                deadline = 10s     │        │
                ▼                                   ▼        ▼
       ┌──────────────────┐
       │   LOT_REVEAL     │  deadline = reveal_seconds
       └────────┬─────────┘  l'assegnazione è COMMITTATA all'ingresso in questa fase
                │
                ▼
       avanza turno → WAITING_PICK  (o COMPLETED)
```

### Dettaglio delle transizioni

**`READY → LIVE`** (azione owner, parametro: `startSeatIndex`)
- `role_order` è già stato definito in fase di creazione (drag & drop). All'avvio non si sceglie
  più il ruolo: il primo elemento di `role_order` **è** il ruolo iniziale.
- `current_role = role_order[0]`, `current_seat_index = startSeatIndex`
- `phase = WAITING_PICK`, `phase_deadline = now() + pick_seconds`
- **PRECONDIZIONE**: tutti i membri in stato `LIVE` (vedi §7 Presence).

**`WAITING_PICK → LOT_OPEN`** — `pickPlayer(playerId)` oppure timeout
- Validazioni: il chiamante è il membro a `current_seat_index`; il giocatore appartiene ad
  `auction_id`, ha `role = current_role`, non è già assegnato, non è `out_of_list`.
- Su timeout: auto-pick con `ORDER BY fvm DESC, quot DESC, ext_id ASC LIMIT 1` fra i disponibili
  del ruolo corrente. `auto_called = true`.
- Crea `lots` (status `OPEN`, `current_round = 1`) e `lot_rounds` (round 1, `min_amount = 1`,
  `ends_at = now() + bid_seconds`).
- `round_eligibility` = tutti i membri con slot libero nel `current_role` **e** `max_bid ≥ 1`.
- **Crea automaticamente l'offerta a 1 del chiamante**, con `amount_set_at = now()`.
  Il chiamante è sempre vincolato: non può ritirare, può solo rilanciare.

**`LOT_OPEN → ...`** — timeout del round
- Considera le offerte non ritirate del round corrente. `max = MAX(amount)`.
- Vincitori = offerte con `amount = max`.
- Se **un solo** vincitore → `LOT_REVEAL`.
- Se **più** vincitori e `round_no = 1` → `LOT_TIE_PREP`, `phase_deadline = now() + tie_prep_seconds`.
- Se **più** vincitori e `round_no = 2` → vince `MIN(amount_set_at)`; a parità esatta di
  timestamp (praticamente impossibile) → `MIN(bids.id)`. → `LOT_REVEAL`.

**`LOT_TIE_PREP → LOT_OPEN` (round 2)**
- Crea `lot_rounds` round 2 con `min_amount = <importo pareggiato>`, `ends_at = now() + bid_seconds`.
- `round_eligibility` = solo i pareggianti.
- **CARRY-FORWARD**: copia l'offerta di ciascun pareggiante nel nuovo round **preservando
  l'`amount_set_at` originale**. Chi non fa nulla "sta" sulla propria cifra.
  Questo è ciò che implementa la regola dello stallo: se nessuno rilancia, gli importi restano
  pari e vince il timestamp ereditato dal round 1, cioè chi era arrivato per primo a quella cifra.
- `lots.current_round = 2`. Il ritiro dell'offerta è **disabilitato** nel round 2.

**`→ LOT_REVEAL`**
- **L'assegnazione viene committata all'ingresso in questa fase**, non alla fine:
  `INSERT INTO assignments (source='AUCTION')`, `lots.status='RESOLVED'`, `winner_member_id`,
  `final_price`.
- I 10 secondi di reveal sono puramente presentazionali. Il client mostra tutte le offerte di
  tutti i round.

**`LOT_REVEAL → WAITING_PICK | COMPLETED`**
- Se tutti i membri hanno il `current_role` pieno → avanza al ruolo successivo in `role_order`.
- Se tutti i ruoli sono pieni per tutti → `COMPLETED`.
- Altrimenti `current_seat_index` = prossimo seat in ordine crescente circolare che abbia uno
  slot libero nel (nuovo) `current_role`. La rotazione è indipendente da chi ha vinto il lotto.
- `phase = WAITING_PICK`, `phase_deadline = now() + pick_seconds`.

**`LIVE ↔ PAUSED`**
- Su pause: `status='PAUSED'`, `paused_at = now()`. I timer in memoria vengono cancellati.
- Su resume: `phase_deadline += (now() - paused_at)`, `paused_at = NULL`, timer riarmato.
  **La pausa non deve mai far scadere silenziosamente un countdown in corso.**

---

## 5. Regole di dominio (INVARIANTI — devono avere un test)

| # | Invariante |
|---|---|
| **I1** | Al massimo un `lots` con `status='OPEN'` per asta (indice unico parziale). |
| **I2** | Un giocatore ha al massimo un `assignment` non annullato per asta (indice unico parziale). |
| **I3** | Per ogni membro: `crediti ≥ (slot_totali − giocatori_posseduti)`. Ogni slot residuo deve restare comprabile ad almeno 1. Le rettifiche manuali che violano I3 vanno rifiutate con errore esplicito. |
| **I4** | Nessun membro supera gli slot del proprio ruolo (`slots_p/d/c/a`). |
| **I5** | `max_bid(m) = crediti(m) − (slot_totali − posseduti(m) − 1)`. Calcolata sugli slot **totali** (25), non sul ruolo corrente. Ogni offerta è validata `min_amount ≤ amount ≤ max_bid` **al momento del submit, lato server**. |
| **I6** | In un round di spareggio, chi offre deve essere in `round_eligibility` e `amount ≥ min_amount`. Poiché i pareggianti avevano tutti lo stesso importo, `min_amount` coincide con l'offerta precedente di ciascuno: nel round 2 si può solo confermare o rilanciare, mai scendere. |
| **I7** | Ogni transizione è idempotente: eseguirla due volte non cambia lo stato. |
| **I8** | **Nessun importo di offerta lascia il server mentre `phase = LOT_OPEN`.** Vale per tutti i client, inclusi il portale manager e la vista TV. L'unica eccezione è l'offerta del richiedente stesso. |
| **I9** | All'import: per ogni ruolo, `giocatori_disponibili ≥ slot_ruolo × seats`. Altrimenti l'import fallisce con messaggio esplicito. |
| **I10** | **La UI è funzione dello snapshot, mai degli eventi ricevuti.** Nessun pezzo di stato può dipendere da "ho ricevuto la notifica". Chi si ricollega a metà lotto deve trovare esattamente la stessa schermata di chi non si è mai disconnesso. Vedi §8bis. |

---

## 6. Concorrenza — la regola che rende tutto il resto semplice

**Ogni mutazione di un'asta passa da un'unica funzione che apre una transazione e prende il lock
sulla riga dell'asta.**

```ts
// lib/engine/mutate.ts
export async function withAuctionLock<T>(
  auctionId: string,
  fn: (tx: Tx, auction: Auction) => Promise<T>
): Promise<T> {
  const result = await db.transaction(async (tx) => {
    const [auction] = await tx
      .select().from(auctions)
      .where(eq(auctions.id, auctionId))
      .for('update');                          // ← punto di serializzazione unico
    if (!auction) throw new NotFound();
    const out = await fn(tx, auction);
    await tx.update(auctions)
      .set({ stateVersion: sql`${auctions.stateVersion} + 1` })
      .where(eq(auctions.id, auctionId));
    return out;
  });
  broadcast(auctionId);                        // ← fuori dalla transazione
  return result;
}
```

Tutto passa di qui: `pickPlayer`, `placeBid`, `withdrawBid`, `advancePhase`, `pause`, `resume`,
`manualAssign`, `voidAssignment`, `adjustBudget`.

Con `FOR UPDATE` non esistono race condition sull'asta. Non serve nessun altro meccanismo di lock.

Le transizioni temporali sono comunque **guardate**: `advancePhase` rilegge `phase` e
`phase_deadline` dentro la transazione e non fa nulla se `now() < phase_deadline` o se la fase
è già cambiata. Questo le rende idempotenti e sicure anche se il timer scatta due volte (I7).

---

## 7. Timer e presence

### Scheduler

```
lib/engine/scheduler.ts

  arm(auctionId, deadline)   → setTimeout(() => advancePhase(auctionId), delay)
  cancel(auctionId)
  sweep()                    → ogni 1000ms:
                                SELECT id FROM auctions
                                WHERE status='LIVE' AND phase_deadline <= now()
                                → advancePhase(id) per ciascuna
  bootRecovery()             → all'avvio del processo: sweep() + arm() per tutte le aste LIVE
```

Il `setTimeout` è la via veloce. Il **sweep è la rete di sicurezza**: se il processo viene
riavviato a metà asta (deploy, crash, `pm2 restart`), i timer in memoria muoiono ma lo stato
riparte dal DB entro un secondo, senza intervento. Non saltare il sweep.

Inizializzazione in `instrumentation.ts` (Next.js `register()`), con guardia contro la doppia
esecuzione in dev.

### Presence

- La connessione SSE registra il membro come connesso.
- Heartbeat `POST /api/auctions/:id/heartbeat` ogni 10s con `{ visible: boolean }`
  (Page Visibility API) → aggiorna `members.last_seen_at` e `members.is_visible`.
- Stato derivato:
  - `LIVE` — `last_seen_at` < 15s fa **e** `is_visible = true`
  - `IDLE` — `last_seen_at` < 15s fa, tab in background
  - `OFFLINE` — altrimenti
- `READY → LIVE` richiede **tutti** i membri in `LIVE`. La lobby mostra i pallini di stato.
- A asta iniziata: nessuna pausa automatica se qualcuno cade. Il portale manager mostra un alert;
  i timer gestiscono il resto (auto-pick, auto-bid a 1).

---

## 8. Realtime: protocollo SSE

**Endpoint**: `GET /api/auctions/:id/stream` (runtime `nodejs`)

Un solo tipo di evento utile: `snapshot`. **Ad ogni transizione il server invia lo stato completo
sanificato.** Con 10 utenti e pochi KB per snapshot il costo è irrilevante, e sparisce del tutto
la classe di bug da merge di delta e da desync al reconnect.

```ts
type Snapshot = {
  serverNow: string          // ISO — per la sincronizzazione dell'orologio client
  stateVersion: number       // il client scarta gli snapshot con version inferiore
  auction: { id, name, status, phase, phaseDeadline, currentRole, roleOrder, ... }
  members: Array<{
    id, teamName, displayName, seatIndex,
    credits, maxBid, slotsFilled: {P,D,C,A},
    presence: 'LIVE' | 'IDLE' | 'OFFLINE',
    roster: Array<{ playerId, name, role, team, price }>
  }>
  currentLot: null | {
    id, roundNo, minAmount, endsAt,
    player: { id, name, role, team, fvm },
    calledByMemberId,
    eligibleMemberIds: string[],
    bidStatus: Array<{ memberId, hasBid: boolean }>,   // ← MAI l'importo durante LOT_OPEN
    reveal: null | {                                   // ← popolato solo in LOT_REVEAL
      winnerMemberId, price,
      rounds: Array<{ roundNo, bids: Array<{ memberId, amount, amountSetAt }> }>
    }
  }
  myBid: null | { amount, amountSetAt }   // solo la propria; assente sulla vista TV
}
```

**Sanificazione**: esiste **una sola** funzione `serializeSnapshot(auctionState, viewerMemberId | null)`.
Nessun altro punto del codice serializza lo stato dell'asta. È l'unico modo per garantire I8 per
costruzione invece che per attenzione.

**Sincronizzazione orologio**: il client calcola `offset = serverNow − Date.now()` a ogni snapshot
e rende i countdown come `deadline − (Date.now() + offset)`. Non fidarsi mai dell'orologio del client.

**Il client non chiude mai un round.** Quando il countdown arriva a zero mostra "in chiusura…" e
aspetta lo snapshot successivo. La chiusura è esclusivamente server-side.

Keep-alive: commento SSE (`: ping`) ogni 15s. In nginx: `proxy_buffering off` sulla route dello stream.

---

## 8bis. Riconnessione e rientro nell'asta

Il modale d'asta **non è una notifica**: è una vista sullo stato corrente. Trattarlo come un
evento effimero è il modo più rapido per rendere l'app inutilizzabile a chi perde la
connessione, chiude il tab per sbaglio o ha il telefono che va in standby a metà round.

### Gerarchia della UI del partecipante

1. **Banner globale "Asta in corso"** — presente su tutte le pagine dell'app, dashboard inclusa,
   ogni volta che l'utente è membro di un'asta con `status IN ('LIVE','PAUSED')`. Cliccabile,
   porta a `/auctions/[id]/play`. È il modo con cui un utente rientrato trova la strada da solo.
2. **Card del lotto corrente** — elemento **permanente** del portale partecipante finché
   `currentLot != null`. Mostra giocatore, ruolo, squadra, countdown, la propria offerta attuale
   (se presente), lo stato delle buste altrui (solo booleano) e un pulsante `Apri offerta`.
   La card non sparisce mai chiudendo il modale.
3. **Modale** — overlay sopra la card. Si apre in automatico quando
   `phase === 'LOT_OPEN' && sonoIdoneo && dismissedLotId !== currentLot.id`.
   `dismissedLotId` vive **solo** nello state del componente, non è persistito e non è mai
   sincronizzato: se chiudo il modale posso sempre riaprirlo dalla card, e al lotto successivo
   si riapre da solo.

### Cosa deve succedere al rientro

Il client si riconnette all'SSE e riceve immediatamente uno snapshot completo. Da quello solo,
senza nessuna storia degli eventi persi, ricostruisce:
fase corrente, tempo residuo (via `serverNow`), la propria offerta già salvata, la propria
idoneità e il pannello di reveal se il lotto è già stato risolto.

Casi da gestire esplicitamente:

- **Rientro durante `LOT_OPEN`** → card + modale aperto, con la propria offerta precompilata se
  già inviata. Se è il proprio lotto chiamato, l'auto-bid a 1 è già a DB e viene mostrato.
- **Rientro durante `LOT_TIE_PREP`** → countdown di preparazione, con indicazione se si è o meno
  fra i pareggianti.
- **Rientro durante `LOT_REVEAL`** → pannello dei risultati per il tempo residuo dei 10 secondi.
- **Rientro durante `WAITING_PICK` quando è il proprio turno** → schermata di scelta con il tempo
  residuo reale. Se il tempo è già scaduto mentre si era offline, l'auto-pick è già avvenuto e si
  vede il lotto conseguente: nessuna schermata fantasma.
- **Rientro a `status = PAUSED`** → schermata di attesa con lo stato congelato.

### Presence e reconnect

L'`EventSource` riconnette da solo. Sul server, la chiusura dello stream rimuove il controller dal
registro; non serve altro. `last_seen_at` continua ad essere aggiornato dall'heartbeat, che è
indipendente dall'SSE: così un tab con lo stream rotto ma la pagina viva risulta comunque presente.

---

## 9. Superficie applicativa (Server Actions / Route Handlers)

```
Setup
  createAuction(name, seats /* 8|10|12 */, budget, timers, slots, roleOrder)
  updateAuctionSettings(auctionId, patch)      -- i timer si applicano dal lotto successivo
  importPlayers(auctionId, file)               -- xlsx, valida I9
  createInvite(auctionId)                      -> { url }
  joinAuction(token, teamName)
  leaveAuction / removeMember(memberId)        -- solo in DRAFT/READY

Live
  heartbeat(auctionId, visible)
  startAuction(auctionId, startSeatIndex)
  pauseAuction(auctionId) / resumeAuction(auctionId)
  pickPlayer(auctionId, playerId)
  placeBid(auctionId, amount)                  -- upsert; aggiorna amount_set_at
  withdrawBid(auctionId)                       -- vietato al chiamante e nel round 2

Override manager — **consentiti solo senza un lotto in contesa: `phase ∉ {'LOT_OPEN','LOT_TIE_PREP'}`**,
regola valida anche in `PAUSED` (la pausa congela la fase, non la azzera). Toccare le rose mentre
le buste sono aperte è l'unico modo per corrompere uno stato coerente: va bloccato lato server,
non solo disabilitato nella UI. Non esiste undo: un lotto sbagliato si corregge con
`voidAssignment` + `manualAssign`; la rotazione dei turni non torna indietro.

  manualAssign(auctionId, memberId, playerId, price, force?)
                                               -- valida I2/I3/I4; `force` può derogare a I4
                                               -- (slot in eccesso), MAI a I3 (crediti)
  voidAssignment(assignmentId)                 -- "cancella" un giocatore da una rosa:
                                               -- voided_at, mai DELETE
  adjustBudget(auctionId, memberId, delta, reason)   -- rifiutata se violerebbe I3
  exportXlsx(auctionId)                        -- riempie FantaSquadra + Costo del file originale
```

Ogni azione: verifica autorizzazione → `withAuctionLock` → validazione invarianti → mutazione →
riga in `events`. Le validazioni sono **sempre** server-side; la UI le duplica solo per UX.

---

## 10. Struttura del progetto

```
app/
  (auth)/signin/
  dashboard/                        # aste dell'utente
  auctions/[id]/
    setup/                          # config, import, inviti (owner)
    lobby/                          # presence, "sono pronto", avvio
    play/                           # portale partecipante
    manage/                         # portale manager (owner)
  tv/[publicToken]/                 # vista proiettabile, sola lettura
  admin/                            # is_admin: elenco aste e utenti
  api/
    auctions/[id]/stream/route.ts   # SSE
    auctions/[id]/heartbeat/route.ts
    auth/[...nextauth]/route.ts

lib/
  db/           schema.ts, migrations/
  engine/
    rules.ts        # FUNZIONI PURE: maxBid, eligibility, resolveRound, nextSeat, nextRole
    machine.ts      # FUNZIONI PURE: transition(state, event, now) -> newState
    mutate.ts       # withAuctionLock
    actions.ts      # pick, bid, withdraw, pause, ...
    scheduler.ts
    snapshot.ts     # serializeSnapshot — unico punto di sanificazione
  realtime/     broadcast.ts (Map<auctionId, Set<controller>>)
  import/       parseListone.ts, exportListone.ts
  auth.ts

components/
  auction/      BidModal, RevealPanel, RosterGrid, Countdown, PresenceDots, ...
```

---

## 11. Fasi di build

Ogni fase ha criteri di accettazione verificabili. **Non passare alla successiva senza averli soddisfatti.**
L'ordine è deliberato: il motore dell'asta viene prima della UI, perché è lì che si rompe tutto.

### Fase 0 — Scaffold
Next.js 15 + Tailwind + shadcn + Drizzle + Postgres locale + Auth.js con Google.
✅ Login Google funzionante, `display_name` obbligatorio al primo accesso.

### Fase 1 — Setup asta
CRUD asta, import xlsx con validazione I9, inviti con token, join con nome squadra, lobby.
Form di creazione: selettore partecipanti a **8 / 10 / 12** (segmented control, non input libero),
budget, timer, slot per ruolo, e **ordine dei ruoli riordinabile via drag & drop** (`dnd-kit`,
lista di 4 elementi, default `P → D → C → A`). L'ordine resta modificabile in setup finché
`status ∈ {DRAFT, READY}`.
✅ Due utenti diversi entrano nella stessa asta da link e vedono i reciproci nomi squadra.
✅ L'import di un listone insufficiente per un ruolo viene rifiutato con messaggio chiaro.
✅ Riordinando i ruoli e avviando, l'asta parte dal primo ruolo della lista e li percorre nell'ordine scelto.

### Fase 2 — Motore, funzioni pure, con test ⚠️ FASE CRITICA
`lib/engine/rules.ts` e `lib/engine/machine.ts` come **funzioni pure**: nessun DB, nessuna rete,
nessun `Date.now()` interno (il tempo si passa come parametro). Lo stato dell'asta è un oggetto
in memoria; `transition(state, event, now)` restituisce il nuovo stato.

✅ Tutti i test di §12 passano. Zero righe di UI scritte finora.

Questa è la fase che l'anno scorso è saltata. L'intera logica dell'asta deve essere collaudabile
in millisecondi da riga di comando, senza browser, senza timer reali, senza database.

### Fase 3 — Persistenza e timer
Mapping delle funzioni pure sul DB, `withAuctionLock`, scheduler + sweep + boot recovery.
✅ Un'asta completa si svolge da sola pilotata via script/curl, senza UI.
✅ `pm2 restart` a metà round: l'asta prosegue correttamente entro 1 secondo.

### Fase 4 — SSE e snapshot
`serializeSnapshot`, broadcast, client hook `useAuctionStream` con clock offset.
✅ Test automatico: durante `LOT_OPEN`, il JSON ricevuto da un client non contiene nessun importo
   di offerte altrui. Verificato anche per manager e vista TV.

### Fase 5 — Portale partecipante
Rosa, crediti, offerta massima, banner globale "asta in corso", card permanente del lotto,
modale d'asta, submit/override/ritiro, feedback di salvataggio, countdown, pannello reveal.
Tutto secondo §8bis.
✅ Un'asta a 4 partecipanti su 4 browser reali si conclude senza desync.
✅ Chiudo il modale, lo riapro dalla card, la mia offerta è ancora lì.
✅ Killo il tab a metà round e rientro da zero: ritrovo esattamente la stessa schermata degli altri,
   con countdown corretto e offerta già salvata precompilata.
✅ Vado offline mentre è il mio turno di chiamata, rientro a timer scaduto: vedo il lotto generato
   dall'auto-pick con la mia offerta automatica a 1, nessuna schermata di scelta fantasma.

### Fase 6 — Portale manager e vista TV
Recap rose, budget, avvio/pausa, scelta del seat iniziale, alert presence.
Vista TV: layout ad alto contrasto, tipografia grande, lotto in corso + countdown + reveal.
✅ La vista TV aperta in incognito, senza login, mostra tutto tranne gli importi a busta chiusa.

### Fase 7 — Override e chiusura
Assegnazione manuale, void (cancellazione di un giocatore da una rosa), rettifiche budget con
ledger, export xlsx. Niente undo: un lotto sbagliato si corregge con void + assegnazione manuale.
✅ Void di un'assegnazione + riassegnazione manuale: crediti e rose tornano coerenti, il
   giocatore risulta assegnato una sola volta (I2), la riga annullata resta a DB con `voided_at`.
✅ L'export riempie `FantaSquadra` e `Costo` nel formato del file originale.

### Fase 8 — Deploy
Ploi su Hetzner CX22, Postgres locale, nginx (`proxy_buffering off` sullo stream), Let's Encrypt,
`pg_dump` giornaliero in cron, `pm2` con `--max-memory-restart`.
✅ Un'asta completa a 8 partecipanti in produzione.

---

## 12. Casi di test (Fase 2 — da scrivere PRIMA dell'implementazione)

**Risoluzione**
1. Tre offerte diverse → vince la più alta.
2. Nessuno offre oltre il chiamante → assegnato al chiamante a 1.
3. Il chiamante lascia scadere il pick timer → auto-pick del `fvm` più alto del ruolo corrente + auto-bid a 1.
4. Auto-pick con due giocatori a pari `fvm` → risolve deterministicamente su `quot` poi `ext_id`.

**Override delle offerte**
5. Offro 30, poi 50 → vale 50 con `amount_set_at` del secondo submit.
6. A offre 50 a t=2s. B offre 30 a t=1s poi 50 a t=25s. Pareggio → il round 2 apre; se nessuno rilancia, vince A.
7. Ritiro l'offerta → sono escluso dalla risoluzione.
8. Il chiamante prova a ritirare → rifiutato.

**Spareggio**
9. Pareggio a 2 → round 2 con solo i pareggianti, `min_amount` = importo pareggiato.
10. Round 2, uno rilancia → vince lui.
11. Round 2, nessuno rilancia (stallo) → vince il carry-forward con `amount_set_at` più vecchio.
12. Round 2, entrambi rilanciano allo stesso importo → vince chi ha submittato prima nel round 2.
13. Pareggio a 3 → tutti e tre in round 2.
14. Un pareggiante prova a offrire sotto `min_amount` → rifiutato.
15. Un non-pareggiante prova a offrire nel round 2 → rifiutato.

**Budget e slot**
16. `max_bid` con 500 crediti e 0 giocatori su 25 slot → 476.
17. Un membro con crediti = slot residui può offrire solo 1.
18. Offerta > `max_bid` → rifiutata lato server anche se la UI l'aveva permessa.
19. Membro con ruolo corrente pieno → non è in `round_eligibility` e il suo turno viene saltato.
20. Rettifica manuale che porterebbe i crediti sotto gli slot residui → rifiutata (I3).

**Rotazione**
21. `role_order = ['C','A','P','D']` scelto a creazione → l'asta parte da C e percorre A, P, D.
22. Ultimo slot di un ruolo riempito → passaggio automatico al ruolo successivo in `role_order`.
23. Rotazione dei seat che salta i membri con ruolo pieno, con wrap-around.
24. Ultima assegnazione dell'ultimo ruolo di `role_order` → `COMPLETED`.
25. `role_order` non permutazione valida di P,D,C,A → creazione rifiutata.

**Robustezza**
26. `advancePhase` chiamata due volte sullo stesso deadline → un solo effetto (I7).
27. Due `pickPlayer` concorrenti sullo stesso lotto → uno solo passa.
28. Due membri offrono sullo stesso giocatore nello stesso millisecondo → nessun doppio assegnamento.
29. Pausa a metà round e resume dopo 5 minuti → il countdown riprende dal tempo residuo, non scaduto.
30. Offerta inviata 200ms dopo `ends_at` → rifiutata.

**Riconnessione** (test sullo snapshot, non sulla UI — §8bis, I10)
31. Snapshot generato a `LOT_OPEN` per un membro che ha già offerto → contiene `myBid` valorizzato.
32. Snapshot generato per un membro non idoneo → `myBid = null`, non compare in `eligibleMemberIds`.
33. Snapshot durante `WAITING_PICK` dopo che il turno è scaduto e l'auto-pick è avvenuto → la fase
    è già `LOT_OPEN`, mai `WAITING_PICK` residuo.
34. Due snapshot consecutivi hanno `stateVersion` strettamente crescente.

**Override e correzioni**
35. `manualAssign` durante `LOT_OPEN` → rifiutata.
36. `voidAssignment` → il giocatore torna disponibile, i crediti del membro risalgono, la riga
    resta a DB con `voided_at` valorizzato.
37. `voidAssignment` + `manualAssign` correttivo → rosa e crediti coerenti, nessun doppio
    assegnamento (I2).
38. `voidAssignment` con un lotto in contesa (`LOT_OPEN` o `LOT_TIE_PREP`) → rifiutata.
39. `adjustBudget` con delta negativo che violerebbe I3 → rifiutata.
40. `manualAssign` di un giocatore già assegnato → rifiutata (I2), anche con `force`.
41. Il caso "unico idoneo": tutti gli altri hanno il ruolo pieno → il chiamante prende il giocatore
    a 1 senza errori.

---

## 13. Import ed export del listone

**Import.** Foglio `Lista calciatori`, intestazione in riga 1.
Mapping: `#`→`ext_id`, `Nome`→`name`, `Sq.`→`team`, `R.`→`role`, `R.MANTRA`→`role_mantra`,
`FVM/1000`→`fvm`, `QUOT.`→`quot`, `Fuori lista` valorizzato → `out_of_list = true`.
Le colonne `Under`, `PGv`, `MV`, `FM` si ignorano (`Under` contiene l'età, non un flag).
I giocatori `out_of_list` sono **esclusi** dal pool per default, con toggle in configurazione.
Validazione I9 prima del commit.

Riferimento sul file di esempio: 495 righe — P 61, D 177, C 172, A 85.
Con slot 3/8/8/6 il vincolo stringente è il ruolo A (85 attaccanti). A 12 partecipanti servono
72 attaccanti, 36 portieri, 96 difensori e 96 centrocampisti: **questo listone regge tutti e tre
i tagli 8 / 10 / 12**, con l'attacco come margine più sottile (13 giocatori di riserva a 12
partecipanti). La validazione I9 resta comunque obbligatoria, perché il listone dell'anno
prossimo potrebbe essere diverso.

**Export.** Rigenera lo stesso file riempiendo `FantaSquadra` con `members.team_name` e `Costo`
con `assignments.price`, così è reimportabile su Fantacalcio.it.

---

## 14. Regole per chi implementa

1. **Mai un timer che decide.** Il client renderizza i countdown, non li usa mai per cambiare stato.
2. **Mai un `Date.now()` dentro le funzioni pure.** Il tempo si passa come parametro: è ciò che
   rende testabile l'intera macchina a stati.
3. **Mai serializzare lo stato dell'asta fuori da `serializeSnapshot`.**
4. **Mai mutare l'asta fuori da `withAuctionLock`.**
5. **Mai un `DELETE` o un `UPDATE` distruttivo su `assignments` e `ledger`.** Solo `voided_at` e
   righe compensative.
6. **Mai fidarsi della validazione client.** La UI disabilita il pulsante, il server rifiuta comunque.
7. **Mai far dipendere la UI da un evento ricevuto.** Ogni schermata è una funzione pura dello
   snapshot corrente. Se una schermata è raggiungibile solo da chi era connesso al momento giusto,
   è un bug.
8. Ogni transizione scrive una riga in `events`. Quando qualcosa andrà storto durante un'asta vera,
   quella tabella sarà l'unica cosa che permetterà di capire cosa è successo.

---

## 15. Ambiente di sviluppo locale e collaudo

Un'asta a 8 partecipanti non si testa a mano. Senza l'harness descritto qui, ogni ciclo di prova
costa mezz'ora e il progetto si ferma. **Questi strumenti si costruiscono in Fase 0 e Fase 3, non alla fine.**

### Setup base

Postgres in Docker, app sull'host (niente Docker per Next.js: HMR più veloce, debug diretto).

```yaml
# docker-compose.yml
services:
  db:
    image: postgres:16-alpine
    environment: { POSTGRES_PASSWORD: dev, POSTGRES_DB: asta }
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
volumes: { pgdata: }
```

```
pnpm db:push        # drizzle-kit push
pnpm db:seed        # vedi sotto
pnpm dev
```

### Login di sviluppo (indispensabile)

Google OAuth funziona anche su `http://localhost:3000` (va aggiunto come redirect URI autorizzato
nella console Google Cloud), ma **testare a 8 richiederebbe 8 account Google reali**: impraticabile.

Aggiungere un **Credentials provider attivo solo fuori produzione**:

```ts
// lib/auth.ts
providers: [
  Google({ ... }),
  ...(process.env.NODE_ENV !== 'production' ? [
    Credentials({
      id: 'dev',
      credentials: { userId: {} },
      authorize: async ({ userId }) => db.query.users.findFirst({ where: eq(users.id, userId) })
    })
  ] : [])
]
```

Nella pagina di signin, in dev, una lista di pulsanti "Entra come Marco / Luca / …" sugli utenti
seeded. Un click, sessione pronta. **Da verificare con un test che in `NODE_ENV=production` il
provider `dev` non esista.**

### Seed

`pnpm db:seed` deve produrre in un colpo solo:
- 12 utenti fittizi con nome e cognome
- il listone importato dal file `.xlsx` di esempio in `fixtures/`
- un'asta `READY` a 8 partecipanti, tutti già joinati con nome squadra
- un'asta `LIVE` congelata a metà (rose parzialmente riempite), per lavorare sulla UI senza
  dover rigiocare tutto da capo ogni volta

Flag `--auction-status=draft|ready|live|mid|completed` per generare lo stato che serve.

### Timer accelerati

Variabile `DEV_TIME_SCALE` (default 1). In dev, `bid_seconds=3, pick_seconds=3, reveal_seconds=2`
fa girare un'asta completa a 8 (200 lotti) in pochi minuti invece che in due ore. Senza questo, il
test end-to-end non lo farai mai.

### Bot partecipanti

Script `pnpm bots --auction=<id> --count=7 --strategy=random`: N client headless che si
autenticano col provider dev, aprono l'SSE, e reagiscono agli snapshot:
- se è il loro turno → chiamano un giocatore a caso del ruolo corrente
- se il lotto è aperto e sono idonei → offrono un importo casuale entro `max_bid`
- rispettano `min_amount` nei round di spareggio

Strategie: `random`, `aggressive` (offre sempre il massimo), `passive` (offre sempre 1),
`tie` (offre sempre esattamente lo stesso importo, per forzare gli spareggi a comando).

Con i bot più **un browser reale**, testi il tuo portale dentro un'asta viva. Con `--strategy=tie`
riproduci il pareggio, che a mano è quasi impossibile da innescare.

### Test da telefono in rete locale

`next dev -H 0.0.0.0`, poi si raggiunge da `http://<ip-lan>:3000` sul telefono. Il provider dev
rende superflua la configurazione OAuth per host non-localhost. **Il portale partecipante va
provato su un telefono vero prima di considerare chiusa la Fase 5**, non sul simulatore del browser.

### Vincolo mobile-first (Fase 5)

I partecipanti offrono **dal telefono**, in una stanza, con il portale manager proiettato in TV.
Il portale partecipante è un'app mobile con un adattamento desktop, non il contrario:

- input importo con `inputMode="numeric"` e tastierino numerico, mai spinner
- pulsante di conferma nella metà inferiore dello schermo, target ≥ 44px
- countdown e offerta massima sempre visibili senza scroll, anche con tastiera aperta
- feedback di salvataggio immediato e inequivocabile (l'ansia da "è passata?" a 5 secondi dalla
  scadenza è il vero problema di UX di questa app)
- nessun hover come unico canale informativo

Il portale manager e la vista TV, al contrario, sono desktop-only e possono ignorare il mobile.

---

## 16. Come lavorare con Claude Code su questo progetto

1. **Questo file va in `CLAUDE.md`**, così resta nel contesto a ogni sessione.
2. **Una fase per sessione, contesto pulito fra una fase e l'altra.** Non tentare di percorrere
   Fase 2 → Fase 5 in una singola conversazione: verso la fine avrà perso i vincoli dell'inizio.
3. **I criteri ✅ di ogni fase sono cancelli, non suggerimenti.** Nessuna fase si apre se la
   precedente non è verde.
4. **`docs/DECISIONS.md` in append-only**: ogni deviazione dal piano si annota lì con la
   motivazione. È la memoria fra una sessione e l'altra.
5. **Nessuna astrazione prima del secondo chiamante.** Niente repository pattern, niente
   generic service layer, niente event sourcing. La codebase deve restare leggibile in un pomeriggio.
6. **Regola ESLint**: import di `lib/db` vietato fuori da `lib/engine/**`. Rende meccanicamente
   impossibile la scorciatoia che rompe I8 e la regola del lock.
7. **Fake timers obbligatori** nei test (`vi.useFakeTimers()`). Nessun `sleep` reale in test.
8. **Guardia singleton sullo scheduler**: in dev, HMR rieseguirà `instrumentation.ts`. Senza
   `globalThis.__scheduler ??= start()` ti ritrovi due interval che fanno avanzare la stessa asta.

---

## 17. Guardrail operativi

Regole che non riguardano il codice ma il fatto che questa app girerà **una sera sola all'anno,
in diretta, con dieci persone che aspettano**. Un bug che in un SaaS è un ticket, qui è la serata rovinata.

### Regole trasversali

- **Tutti i timestamp sono `TIMESTAMPTZ`, il server gira in UTC.** La conversione a `Europe/Rome`
  avviene solo in fase di rendering. Nessun `Date` naive da nessuna parte.
- **Gli inviti smettono di funzionare quando `status ∉ {DRAFT, READY}`.** Nessuno entra ad asta iniziata.
- **La rimozione di un membro ad asta iniziata non è supportata.** Se serve, si mette in pausa e si
  usano gli override manuali.
- **Ogni transizione produce una riga di log strutturata su stdout** (`{auctionId, from, to, lotId,
  actor, ts}`), oltre alla riga in `events`. Con `pm2 logs` si segue l'asta in diretta dal terminale.
- **Ogni azione rifiutata restituisce un codice di errore tipizzato**, non una stringa generica.
  La UI mostra un messaggio comprensibile: durante un countdown di 30 secondi, "Errore" senza
  spiegazione è inutilizzabile.

### Checklist pre-asta (da eseguire il giorno stesso)

1. `pg_dump` completo e copia scaricata in locale.
2. Asta di prova a 8 bot con timer accelerati, portata a `COMPLETED`, su **produzione**.
3. Cancellazione dell'asta di prova, verifica che l'asta vera sia in `READY`.
4. Vista TV aperta sul dispositivo di proiezione, testata con un lotto finto.
5. Ogni partecipante fa login e compare `LIVE` in lobby **prima** che si inizi.
6. `pm2 logs` aperto su un terminale, visibile all'owner per tutta la durata.

### Runbook — cosa fare se qualcosa va storto in diretta

| Sintomo | Azione |
|---|---|
| Un partecipante non riesce a offrire | Pausa. Verifica presence e `max_bid`. Se serve, il manager offre per lui via `manualAssign` a fine lotto. |
| Un lotto si è chiuso con l'esito sbagliato | Pausa → `voidAssignment` dell'assegnazione errata → `manualAssign` con l'esito corretto → resume. La rotazione dei turni non torna indietro. |
| Un client resta indietro | Ricarica la pagina. Lo snapshot ricostruisce tutto; nessun dato è nel client. |
| Il server non risponde | `pm2 restart`. Lo stato è tutto a DB, il boot recovery riprende entro 1s. Se il downtime era minore del tempo residuo il round prosegue; altrimenti lo sweep lo chiude con le offerte già a DB. Esito sbagliato? Pausa → `voidAssignment` → `manualAssign`. |
| Dubbio su cosa sia successo | `SELECT * FROM events WHERE auction_id = ... ORDER BY id DESC LIMIT 50` |

**La pausa è sempre l'azione giusta come primo passo.** Non c'è nessuno stato in cui mettere in
pausa peggiori la situazione: i deadline vengono congelati e ripristinati, non persi.
