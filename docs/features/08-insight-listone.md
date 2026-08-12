# M8 — Insight sul listone: titolarità, rigoristi, calci piazzati

> **Stato:** **aperta** su `feature/08-insight-listone` il 2026-08-11 · Spec scritta il 2026-08-11,
> **riscritta lo stesso giorno dopo il collaudo delle fonti** (§1), e corretta ancora **scrivendo il
> codice** (§1, la correzione dei numeri della fonte B) · Nessuna dipendenza da macro aperte: non ce ne sono, e M7 (v1.8.0) ha
> già portato in casa tutto ciò che serve — il pannello, l'archivio figurine, l'`ext_id` come chiave
> verso il mondo di fuori.
>
> **Tocca lo schema del database?** **Sì**, in modo additivo: **una tabella nuova**
> (`player_insights`) e **una colonna** (`users.is_pro`, `boolean not null default false`). Nessuna
> colonna sparisce, nessun tipo cambia → **niente `pg_dump` preventivo**, ma `pnpm db:push` sul
> server **va dato a mano dopo il deploy**:
>
> ```bash
> cd /home/ploi/fantasta.rggndr.it && pnpm db:push
> pm2 reload deploy/ecosystem.config.cjs --update-env
> ```
>
> ⚠ E ci sono **due backfill che nessuno ti ricorda**: la tabella nasce **vuota** (si riempie da
> Admin → Listone, come l'archivio figurine di M7) e `is_pro` nasce **`false` per tutti**. Il giorno
> del deploy la feature è quindi invisibile a chiunque e sembra non funzionare. Procedura in §10.
>
> **Invarianti coinvolti:** **I8 — non cambia, ed è il punto.** Questa macro non aggiunge un solo
> campo a `serializeSnapshot`: gli insight viaggiano nel pool, non nello snapshot, e §6 esiste solo
> per spiegare perché. I9 (il pool per ruolo non cambia: `player_insights` non filtra niente). I10.
> **Regole coinvolte:** **6** (la UI non nasconde, il server omette — §6), 7, 8.
>
> ⚠ Si apre **su richiesta esplicita dell'owner**, come tutte.

## Obiettivo

Durante `PICK_MINE` si scorre una lista di quaranta nomi con accanto `fvm` e si sceglie. Durante
`LOT_OPEN` si guarda una figurina, un nome e `fvm`, e si decide quanto vale. `fvm` è una quotazione:
dice quanto costa un giocatore sul mercato, non se gioca.

Le domande che si fanno davvero a un'asta — **parte titolare? tira i rigori? batte i piazzati?** —
oggi non hanno risposta dentro l'applicazione. Si risolvono con un telefono in mano e un'altra app
aperta, che in una fase a tempo di dieci secondi vuol dire che non si risolvono.

Questa macro le porta dentro, e le porta dentro **da fonti pubbliche interrogabili dal server**:
nessun token, nessuna credenziale di terze parti, nessun upload nuovo.

Il tema, detto in una riga: *`fvm` dice quanto costa, questi numeri dicono se gioca.*

## Richieste che ci confluiscono

Nessuna da `docs/REQUESTS.md` — il quaderno è vuoto. Nasce da una richiesta diretta dell'owner del
2026-08-11: più informazioni nella pagina `/play`, e le sole macro dentro il modale d'offerta.

---

## Spec

### 1. Il collaudo che ha scritto questa spec

Questa sezione viene prima delle altre perché **le altre sono conseguenze sue**, ed è il metodo di
M7 §1 applicato una seconda volta. Il 2026-08-11, prima di congelare la spec, le due fonti sono
state chiamate per davvero con la stessa `fetch` di Node che userà l'applicazione — non `curl`, così
un server che rifiutasse un client non-browser si sarebbe visto subito.

```text
A  api.fantalab.it/v2/listone         200 · application/json · 508 KB · 1,16 s · nessuna auth
B  fantacalcio.it/rigoristi-serie-a   200 · text/html       · 168 KB · 0,85 s · nessuna auth
```

Il join fra le due è **perfetto**: 92 giocatori designati su 92 agganciati per `ext_id`, zero
squadre discordanti, e le stesse venti squadre scritte allo stesso modo — `Atalanta`, non `Ata` —
in entrambe le fonti **e** nella colonna `Sq.` del listone. **Nessuna mappa di sigle da mantenere**,
in nessun punto della macro.

⚠ **Correzione del 2026-08-11, scritta scrivendo il parser.** La prima stesura di questa sezione
diceva 87 designati, 57 rigoristi e 56 piazzati, e ne ricavava un argomento: «i `src` dei campioncini
sono 92 ma i designati 87, quindi l'id va preso dall'`href`». **Era sbagliato, e l'errore era nel mio
script d'analisi, non nella pagina.** Ogni squadra ha esattamente **tre** rigoristi e **tre**
piazzati — 120 righe, **92** giocatori distinti — e i cinque «di troppo» erano cinque nomi con
l'accento che il regex dello script scartava, perché nello slug l'accento arriva come entità HTML:
`…/serie-a/squadre/roma/soul&#xE8;/5734`. Sono Soulè, Bernabè, Calò, Tourè E. e Laurientè, e ora sono
un test col loro nome dentro (`tests/parse-insights.test.ts`). **L'`href` resta la strada giusta, ma
per un'altra ragione**: il `src` contiene l'edizione delle figurine (`/21/`), che cambia ogni
stagione — la stessa `CAMPIONCINI_EDITION` che M7 ha dovuto mettere nel `.env`.

La lezione non è «controlla i regex»: è che **un conteggio ottenuto con uno script usa-e-getta non è
un dato verificato**, e in una spec va marcato come tale finché non lo conferma il codice vero.

⚠ **Ma il collaudo ha smentito quattro cose che la prima stesura dava per certe**, e ognuna ha
tolto una colonna o un pezzo di UI:

| # | La spec diceva | La fonte dice |
|---|---|---|
| 1 | i numeri sono tutti della stagione conclusa (`display_stats_season: "previous"`) | **329 sono `current`, 168 `previous`**: nella stessa tabella convivono due stagioni |
| 2 | rigoristi, punizioni e corner, tre gerarchie | **due liste per squadra**, `Rigori` e `Calci piazzati`, esattamente tre nomi ciascuna. La parola «Punizioni» compare **zero volte** nell'HTML |
| 3 | `fmv_subin` è una delle tre fmv per contesto | **`0` per tutti e 497.** `fmv_home`/`fmv_away` invece sono valorizzate per 356 |
| 4 | `injured` risponde a «si rompe?» | **è un conteggio, non uno stato** — valori 0–5, e correla al *contrario*: media presenze **20,3** per `injured = 0` contro **24,5** per `injured > 0`. Chi gioca di più si fa male di più |

E tre trappole più piccole, che nel codice contano quanto le quattro sopra:

- **`starts_eleven` può superare 38.** Thiam 42/42, Stankovic A. 39 presenze, e in due casi
  `starts_eleven > presenze`. Una quota titolare calcolata su 38 giornate darebbe **110%** (§5).
- **`presenze` ≠ `display_presenze` in 32 righe**, e nei due sensi (Adzic 4→1, Carboni F. 2→10).
  Sono **tutte `previous`**, il che le fa uscire di scena da sé (§5).
- **L'`ext_id` della pagina B va estratto dagli `href`, e con un regex che accetta le entità HTML**
  — cinque slug su 92 hanno l'accento scritto come `&#xE8;` (§1, la correzione qui sopra).

**La lezione, di nuovo:** due richieste vere hanno tolto una tabella, quattro colonne e un pezzo di
interfaccia. La prima stesura di questa spec era più ricca e diceva cose false.

### 2. Le due fonti, e perché sono queste

| # | Fonte | Auth | Cosa porta |
|---|---|---|---|
| A | `GET https://api.fantalab.it/v2/listone` | **nessuna** | 497 giocatori: `fantacalcio_id`, `starts_eleven`, `min_playing_time`, `display_presenze`, `display_stats_season`, rigori storici, `fmv_home/away`, `full_name`, `team_name` |
| B | `GET https://www.fantacalcio.it/rigoristi-serie-a` | **nessuna** | 20 squadre × 2 liste da tre nomi: `Rigori` e `Calci piazzati`, gerarchizzate — 120 righe, 92 giocatori distinti |

Entrambe sono **GET pubbliche**, verificate senza credenziali (§1). Il server le chiama, parsa,
scrive. Non c'è un segreto da custodire, non c'è un token che scade, non c'è niente da ricordarsi.

**L'envelope della fonte A va validato, non solo letto:** `{version, season, season_id, count,
players}`, con `count === players.length` e `season` che oggi vale `s_2025_2026`. È lì che si
accorge di un cambio di forma, prima di scrivere 497 righe sbagliate.

**Perché non i file .xlsx di Fantacalcio.it.** Il file *Quotazioni* è ridondante con
`fixtures/listone.xlsx` (che ha in più `Fuori lista`, da cui dipende I9). Il file *Statistiche*
copre bene `Pv, Mv, Fm, Gf, Gs, Rp, Rc, R+, R-, Ass, Amm, Esp` — i numeri combaciano esatti con la
fonte A — ma **non ha `starts_eleven` né `min_playing_time`**, e sono proprio quelli che servono.
Due giocatori reali, dalla risposta vera:

| | presenze | da titolare | minuti | media |
|---|---|---|---|---|
| Berardi (`ext_id` 531) | 26 | **24** | 1971 | 76' |
| Bernardeschi (`ext_id` 184) | 24 | **12** | 1212 | 50' |

Dal file leggi `Pv 26` e `Pv 24` e li tratti da pari. Uno è un titolare che si è fermato, l'altro
entra dalla panchina una volta su due. **`Pv` misura «ha preso il voto», non «è partito».**

Sostituire due upload manuali con una `fetch` pubblica che dà *di più* non è una dipendenza in più:
è una in meno da maneggiare.

⚠ **Il file `fixtures/listone.xlsx` (export Leghe) resta la fonte di verità del listone d'asta.**
`parseListone.ts` non si tocca. Questa macro non decide chi c'è nell'asta — la arricchisce. Un file
definisce l'asta, gli altri la commentano.

### 3. La tensione da tenere a mente: `players` è per-asta, questo no

`schema.ts` è esplicito: *«Il listone è copiato dentro l'asta. `players.auction_id` congela la lista
al momento dell'import»*. 495 righe per asta nel listone di prova, cancellate in cascata.

`player_insights` **non segue quel ciclo di vita**: è globale, chiave `ext_id`, un refresh
dall'admin serve tutte le aste, e sopravvive alla cancellazione di un'asta. Il precedente esiste già
ed è l'archivio figurine di M7, tenuto fuori dal ciclo dell'asta di proposito (`DECISIONS.md`,
2026-08-11). Qui la ragione è la stessa: un dato di mercato non è un fatto dell'asta.

Conseguenza da scrivere nel test, non solo qui: **l'asta deve funzionare con `player_insights`
vuota.** `LEFT JOIN`, default espliciti, e nessun dato di questa macro su un percorso critico.

⚠ **E i due elenchi non coincidono.** Misurato: dei 495 `ext_id` del listone di prova,
**487 trovano una riga nella fonte A (98,4%)**; gli 8 che non la trovano sono Djimsiti, Angelino,
Gutierrez, Bjarkason, Vogliacco, Ciocci, Fruchtl, Rossi F. — e la fonte A ha 10 giocatori che il
listone non ha. Quindi: **il denominatore della copertura è il listone dell'asta, non 497**, e una
soglia di fallimento va tarata **attorno al 90%**, non al 99% — al 99% l'import fallirebbe oggi, su
dati sani.

### 4. Lo schema

```ts
export const playerInsights = pgTable("player_insights", {
  /** La colonna `#` del file Fantacalcio.it — la stessa di `players.ext_id`. */
  extId: integer("ext_id").primaryKey(),
  /** L'uuid Fantalab (`player_id`): non serve a niente oggi, ma è l'unico modo di
   *  ritrovare la stessa riga se un giorno la fonte cambia l'id pubblico. */
  fantalabId: uuid("fantalab_id"),
  fullName: text("full_name"),
  team: text("team").notNull(),

  /**
   * ⚠ **A quale stagione appartengono i numeri qui sotto.** `"current"` o
   * `"previous"`, copiato da `display_stats_season`: nella risposta convivono
   * (329 e 168, §1). Senza questa colonna un numero del 24/25 finisce accanto a
   * uno del 25/26 e nessuno può accorgersene.
   */
  statsSeason: text("stats_season").notNull(),

  /** Fonte A. `presenze` è `display_presenze`, cioè quello che il sito mostra. */
  presenze: integer("presenze").notNull(),
  startsEleven: integer("starts_eleven").notNull(),
  minPlayingTime: integer("min_playing_time").notNull(),
  rigoriFatti: integer("rigori_fatti").notNull(),
  rigoriSbagliati: integer("rigori_sbagliati").notNull(),
  rigoriParati: integer("rigori_parati").notNull(),
  fmvHome: real("fmv_home"),
  fmvAway: real("fmv_away"),

  /** Fonte B. `1` = primo della gerarchia. `null` = non designato, che è un'informazione. */
  rigoristaRank: integer("rigorista_rank"),
  piazzatiRank: integer("piazzati_rank"),

  /** Due timestamp perché due fonti indipendenti: il pannello dice quale è vecchia. */
  listoneUpdatedAt: timestamp("listone_updated_at", { withTimezone: true }),
  setPiecesUpdatedAt: timestamp("set_pieces_updated_at", { withTimezone: true }),
});
```

`real` **non è ancora importato** in `lib/db/schema.ts`: va aggiunto all'elenco dei tipi
`drizzle-orm/pg-core` in cima al file.

E su `users`:

```ts
isPro: boolean("is_pro").notNull().default(false),
```

**Nessun `CHECK` `NOT (is_pro AND is_bot)`.** Un bot con `is_pro` è insensato ma innocuo;
`users_admin_not_bot_check` esiste perché lì il conflitto è reale (un bot amministratore). Non si
moltiplicano i vincoli per simmetria.

**Il parser della fonte B, in tre righe di specifica**, perché è la parte fragile e il modo di
estrarre l'id decide se funziona:

- Si parte dai **20 blocchi squadra**, riconosciuti da `<span class="team-name">Atalanta</span>`.
- Dentro ogni blocco, le liste sono coppie `<header>Rigori</header><ol>…</ol>` e
  `<header>Calci piazzati</header><ol>…</ol>`. Il **rank è la posizione nell'`<ol>`**.
- L'`ext_id` si legge dall'**`href` del link giocatore** — `…/serie-a/squadre/atalanta/scamacca/2137`
  — che è presente in tutte e due le liste. Non dal `src` della figurina, che fuori dalle liste
  pesca cinque id di troppo, e non da `data-id`, che c'è solo su alcune `<li>`.
- **Fallisce forte**: squadre ≠ 20, una lista assente, un `<ol>` vuoto, un id non numerico.
  `SOURCE_UNREACHABLE` e `SOURCE_SCHEMA`.

### 5. I numeri, e cosa dicono davvero

**Si mostrano solo i numeri della stagione corrente** — i 329 con `stats_season = "current"`. Per
gli altri 168 la riga dice **`—`**, e non è una perdita gratuita: sono i giocatori che nell'ultima
stagione non hanno dati (arrivati da fuori, o fermi), quindi il `—` è la risposta vera. Questa
scelta cancella da sé il problema delle 32 righe con `presenze` discordante da `display_presenze`
(§1): sono **tutte `previous`**, e non arrivano a schermo.

⚠ **`—` e `0` non si scrivono allo stesso modo.** Un giocatore senza dati e un giocatore che non è
mai partito titolare sono due cose diverse, e all'asta si pagano in modo diverso.

Tre funzioni pure in `lib/domain.ts` (zero dipendenze, client-safe: le usa il server per ordinare e
il client per mostrare):

```ts
/** Le giornate di una stagione di Serie A. Una costante con un nome, non un 38 sparso in tre file. */
export const GIORNATE = 38;

/**
 * Quante volte è partito titolare, in percentuale sulla stagione. È il numero
 * che decide all'asta.
 *
 * ⚠ **Il clamp a 1 non è difensivo, serve a due giocatori veri:** nella risposta
 * misurata Thiam ha `starts_eleven` 42 e Stankovic A. 39 presenze — più di una
 * stagione, perché il campo somma più competizioni. Senza clamp la card
 * scriverebbe «110% da titolare», che è la sola cosa peggiore di non scrivere
 * niente.
 */
export function quotaTitolare(i: PlayerInsights): number {
  return Math.min(1, i.startsEleven / GIORNATE);
}

/** Quando era in campo, quanto ci stava. Distingue il titolare dallo spezzone. */
export function minutiMedi(i: PlayerInsights): number | null {
  return i.presenze > 0 ? i.minPlayingTime / i.presenze : null;
}
```

`quotaTitolare` è su `GIORNATE`, non su `presenze`. Berardi 24/38 = **63%**, Bernardeschi 12/38 =
**32%**: separa i due casi che il file Statistiche confonde (§2). `startsEleven / presenze` darebbe
92% e 50%, che è un'altra domanda — «quando c'era, partiva?» — vera ma non quella che si fa mentre
scorre un timer.

**`injured` non entra.** È il campo che sembrava rispondere alla terza domanda dell'asta, e non lo
fa (§1). Lo stato «infortunato adesso» esiste in chiaro altrove ma non nel momento in cui serve:
il perché è in §9, con la misura.

### 6. ⚠ `is_pro`: il server omette, la UI non nasconde

`PoolPlayer` (`lib/realtime/types.ts`) è una **prop di un client component**
(`<Portal pool={pool} />`). Viene serializzata nel payload RSC e **arriva nel browser di chiunque
apra `/play`**, leggibile in DevTools in tre click.

Nascondere gli insight in JSX o in CSS **non è una protezione, è una decorazione.** È la regola 6 —
*mai fidarsi della validazione lato client* — applicata alla lettura invece che alla scrittura.

**Un solo punto di decisione, nella query.** Predicato puro in `lib/domain.ts`, sul modello di
`isAppAdmin`:

```ts
export function canSeeInsights(u: { isPro: boolean; isAdmin: boolean } | null | undefined): boolean {
  return u?.isPro === true || u?.isAdmin === true;
}
```

`is_admin` implica pro, altrimenti servirebbe auto-assegnarsi un flag per vedere i dati che si è
importati — e `lib/engine/admin.ts` vieta di toccare la propria riga.

⚠ **`listPickPool` ha due chiamanti, non uno**, e la prima stesura ne conosceva solo uno:
`app/auctions/[id]/play/page.tsx:41` e `app/auctions/[id]/manage/page.tsx:46` (la regia, che usa il
pool per gli override). **Entrambi passano `canSeeInsights(user)`**: un owner pro li vede anche in
regia, un owner non-pro no. Un predicato, due chiamate, nessuna eccezione da ricordare.

```ts
const pool = await listPickPool(id, canSeeInsights(user));
```

`listPickPool` fa il `LEFT JOIN player_insights` **solo se il flag è vero**. Il tipo rende l'assenza
esplicita, così il compilatore obbliga a gestirla:

```ts
export type PoolPlayer = {
  id: string; name: string; team: string; role: Role; fvm: number; quot: number;
  insights?: PlayerInsights;   // assente = viewer non-pro. Non `null`.
};
```

E degrada da sé: il lookup nel pool per `lot.player.id` dà `undefined` per un non-pro, e il blocco
non si renderizza. **Nessun `if (isPro)` sparso nei componenti.**

⚠ Il lookup può dare `undefined` **anche per un pro**, e va nel test invece di essere una sorpresa:
`listPickPool` **esclude i fuori lista** quando l'asta li esclude, quindi un giocatore assegnato a
mano dalla regia potrebbe non stare nel pool. Il blocco non si renderizza, ed è il comportamento
giusto.

**`SnapshotPlayer` resta intatto.** Metterci gli insight vorrebbe dire mandarli a tutti — lo
snapshot è uno, in broadcast SSE — e rompere `tests/db/i8.test.ts`, che da M7-07 confronta
l'insieme **esatto** delle chiavi del giocatore del lotto. Due motivi che puntano nello stesso
verso; basta il primo.

Nota di merito: siccome le fonti sono pubbliche, `is_pro` **non è una necessità di licenza**. È una
scelta di prodotto: un vantaggio informativo che si riserva. Va detto perché non venga difeso con un
argomento che non ha.

### 7. Dove si vede: due posti, e sono due

| Dove | Cosa mostra | Perché |
|---|---|---|
| `components/auction/pick-panel.tsx` (`/play`) | La **riga densa** accanto a `fvm`: quota titolare, minuti medi, badge rigorista e piazzati | Qui si scorre e si confronta: quaranta nomi, e la scelta è fra due o tre |
| `components/auction/bid-modal.tsx` | Le **sole macro**: quota titolare, rigorista, piazzati | Qui non si confronta, si decide una cifra. Dieci secondi, un pollice, e ogni numero in più è un numero che non si legge |

**La card del lotto no** (`lot-card.tsx`), e non è una dimenticanza: la card non sparisce mai ed è la
schermata che si guarda anche quando non si sta offrendo, mentre la domanda «quanto vale?» si fa nel
modale — dov'è già finita la figurina di M7, per la stessa ragione. Regola 8: due chiamanti, non
tre.

⚠ **Né `BidModal` né `LotCard` ricevono `pool` oggi.** Ce l'ha `portal.tsx`, che lo passa solo al
pick panel: la prop va aggiunta a `BidModal` (una riga, ma la prima stesura la dava per esistente).

Il badge dei piazzati dice **`Rigori 1°`** e **`Piazzati 2°`**, non un pallino colorato: la
gerarchia è l'informazione, e «secondo rigorista» vale molto meno di «primo».

### 8. Il perimetro — cosa questa macro non fa

- **Non tocca** `lib/engine/machine.ts`, `rules.ts`, `serializeSnapshot`, né una sola rotta di
  gioco. Se un task sfiora uno di questi, il task è fuori posto.
- **Non modifica** `parseListone.ts` né il formato dell'export.
- **Non introduce** worker, code, scheduler, Redis, provider esterni. Le due `fetch` sono sincrone
  dentro una server action. Il precedente è il downloader figurine di M7 — **495 download in 7,3 s**,
  e quella misura ha cancellato un intero sottosistema di batching dalla spec. Qui sono **due
  richieste, 2 secondi in tutto** (§1).
- **Non aggiunge nessuna eccezione all'allowlist ESLint.** `lib/engine/insights.ts` è l'unico modulo
  che importa `lib/db`, e `lib/engine/**` è già permesso; i tre parser stanno in `lib/import/`, che
  non è nell'elenco **perché sono puri** — bytes in, `Result` out, come `parseListone.ts`.
- **Non calcola** una FMV attesa. Se un giorno serve, è un'altra macro, e va progettata sapendo che
  è un'opinione — non un dato.
- **Non conserva** ciò che scarica oltre le colonne mappate: nessun HTML, nessun JSON grezzo,
  coerente con P6.

### 9. Le strade scartate, e perché

**`injured` come stato** (fonte A). Il campo esiste ma **è un conteggio di infortuni della
stagione**, non uno stato attuale: valori 0–5, e la correlazione va al contrario (§1). Su richiesta
dell'owner entra solo se si può sapere «è infortunato *adesso*», e la risposta è misurata:
`fantacalcio.it/infortunati-serie-a` risponde 200 con 125 KB **di sola navigazione** — i dati
arrivano lato client, quindi da server non c'è niente da leggere;
`fantacalcio.it/probabili-formazioni-serie-a` risponde 200 con 620 KB, ha le classi giuste
(`player-list starters`, `injured-list`, `doubts-list`), i testi ricchi
(*«Addai rottura tendine d'Achille, rientro da ottobre»*) e **479 `ext_id` già dentro gli href** —
ma **oggi contiene 0 titolari, 0 riserve, 4 infortunati e 1 dubbio in tutta la Serie A**, con la
giornata 1 segnaposto (`0 - 0`, `01/01 01:00`). Si popola quando serve a schierare, e **l'asta si fa
ad agosto**. Quindi il campo non entra affatto: un numero che sembra rispondere a una domanda a cui
non risponde è peggio di un numero assente.

⚠ Questa misura **corregge la prima stesura**, che dava i titolari attesi raggiungibili solo dal
`POST /guida` di Fantalab protetto da JWT: fantacalcio.it li serve pubblici, con l'`ext_id` dentro.
È **l'upgrade più ovvio di questa macro**, e va fatto a campionato in corso — non perché sia
difficile, ma perché prima non c'è niente da leggere.

**La griglia portieri.** Il file `Griglia_Portieri.xlsx` è una matrice 20×20 simmetrica, valori 0–16:
non è difficoltà, è **accoppiamento** (*«più basso è il numero e meno partite i portieri giocheranno
contemporaneamente in casa»*). Due fatti verificati, che vale la pena conservare perché decidono
qualunque implementazione futura: **la media di riga di ogni squadra è esattamente `9.00`, per tutte
e venti** — è una proprietà combinatoria del calendario, quindi *qualsiasi* indice per-squadra o
per-giocatore è provabilmente inutile, varrebbe 9.00 per chiunque, e l'informazione vive **solo**
nelle 190 coppie; e le coppie perfette (`0`) sono `Juv–Tor`, `Int–Mil`, `Laz–Rom`, cioè i derby, che
in casa non giocano mai la stessa giornata. È anche **la sola feature che nessun provider può dare**,
perché serve sapere chi possiedi già, e `assignments` ce l'ha in tempo reale: in `LOT_OPEN` su un
portiere del Como, con Svilar in rosa, la card direbbe `Roma–Como: 9 · nella media`. Resta fuori da
M8 per perimetro (decisione dell'owner, 2026-08-11): sarebbe l'unico upload nuovo, una tabella in
più e una mappa sigla → squadra da rigenerare a ogni promozione. **Candidata a una macro sua.**

**Gli indici dei creator Fantalab** (`ex_fmv`, `tit_index`, `aff_index`, `inf_index`). Sembravano il
cuore della feature. Non sono dati Fantalab: arrivano da `POST /v2/player-strategy`, che porta
`strategy_id` e `user_id` — sono **campi compilati a mano dai creator** dentro le loro strategie, e
nel record campione sono tutti `null`. Spiega anche l'anomalia che aveva insospettito: Di Gregorio
`tit_index: 1` con 36 presenze contro Carnesecchi `3` con 27 non era una scala mal documentata,
erano **due giudizi di due persone diverse**. E il profilo utente porta `credits: 10`,
`used_credits: 2`, `players_unlocked: [2 uuid]`, mentre ogni riga ha un campo `unlocked`: con ogni
probabilità **si sbloccano un giocatore alla volta, a pagamento**. Con dieci crediti non si coprono
497 giocatori. `starts_eleven / GIORNATE` è più utile *e* verificabile.

**`POST /guida` di Fantalab.** Più ricco della pagina pubblica — ballottaggi **con le percentuali**,
modulo, allenatore, giudizi testuali — ma risponde **401**: richiede un Bearer che è un JWT Firebase
da un'ora. Vorrebbe dire uno snippet nel browser e un upload manuale, cioè autenticazione dentro la
pipeline. Non vale quel pezzo, tanto più che la parte utile è pubblica altrove (qui sopra).

**Il file Statistiche di Fantacalcio.it.** Copre bene, i numeri combaciano, ma gli mancano i due
campi per cui la macro esiste (§2). Tenuto come fallback se la fonte A diventasse instabile.

### 10. ⚠ Il rilascio non finisce col merge

Tre passi a mano sul server, e nessuno te li ricorda:

1. `pnpm db:push` + `pm2 reload deploy/ecosystem.config.cjs --update-env` (in testa a questo file).
2. **La tabella nasce vuota.** Admin → Listone, i due pulsanti. Finché non si fa, `/play` è identico
   a prima — che è precisamente ciò che rende il passo facile da dimenticare. Stesso inciampo
   dell'archivio figurine di M7, e stessa cura: scriverlo nel `CHANGELOG.md`.
3. **`is_pro` nasce `false` per tutti.** Va deciso *prima* del deploy chi accendere, e acceso a mano
   dal pannello. Prima di quel momento la feature è invisibile anche a chi l'ha importata — tranne
   agli admin, che `canSeeInsights` copre per costruzione.

---

## Task

> Da rifinire all'apertura della macro. Sono la traduzione della spec, non un impegno preso nella
> sessione in cui è stata scritta.

- [x] **M8-01** — Aprire `feature/08-insight-listone` da `dev`; rileggere questo file, e in
      particolare §1: le quattro smentite del collaudo sono la parte che si è tentati di rimettere
      dentro. Verificare che `tests/db/i8.test.ts` e `tests/db/admin.test.ts` siano verdi **prima**
      di toccare qualcosa, così quando romperanno si sa perché
      → fatti: 34 test verdi prima di toccare qualunque cosa
- [x] **M8-02** — Rifare le due `GET` di §1 e **salvare le risposte in `fixtures/`**
      (`fantalab-listone.json`, `rigoristi.html`): sono le fixture dei due parser, e i numeri di §1
      vanno riconfermati sui byte veri del giorno in cui si apre la macro
      → rifatte: A 507 KB in 1,26 s, B 168 KB in 0,42 s, e i numeri di §1 riconfermati sui byte nuovi
- [x] **M8-03** — `lib/db/schema.ts`: `player_insights` (con `stats_season`), `users.is_pro`,
      `real` aggiunto agli import di `drizzle-orm/pg-core`. `pnpm db:push` in locale
      → più `PlayerInsightRow` fra i tipi inferiti
- [x] **M8-04** — `lib/domain.ts`: `GIORNATE`, `quotaTitolare` **con il clamp**, `minutiMedi`,
      `canSeeInsights`, e il tipo `PlayerInsights`. Zero dipendenze, con il loro test puro sul
      modello di `tests/auction-nav.test.ts` — **e il caso Thiam dentro il test**, perché il clamp
      senza il suo caso è una riga che qualcuno toglierà
      → **e una quinta funzione non prevista**, `showableInsights`: è l'unico punto in cui si decide che la stagione precedente non si mostra, e senza di lei quella regola sarebbe finita in due componenti
- [x] **M8-05** — `lib/import/parseFantalabListone.ts`: bytes → `Result<Insight[]>`. Valida
      l'envelope (`count === players.length`, `season`), i campi obbligatori, e **fallisce forte** su
      schema diverso: `SOURCE_UNREACHABLE` e `SOURCE_SCHEMA`. Mappa
      `presenze ← display_presenze` e `statsSeason ← display_stats_season`
      → i codici sono `SOURCE_UNREACHABLE` e `SOURCE_SCHEMA`, condivisi con l'altro parser: un codice per fonte non avrebbe aggiunto niente a chi legge il messaggio
- [x] **M8-06** — `lib/import/parseRigoristi.ts`: HTML → `Result<SetPiece[]>`, secondo le quattro
      righe di §4 — blocchi squadra, le due liste per `<header>`, rank dalla posizione nell'`<ol>`,
      `ext_id` dall'`href`. **Il test che si accorge quando la struttura cambia è il parser**, non un
      extra: sulla fixture deve trovare **20 squadre, 60 rigoristi, 60 piazzati, 92 id distinti**, e
      **i cinque nomi con l'accento** che un regex distratto perde (§1)
      → 20 squadre, 60 rigoristi, 60 piazzati, 92 id: i numeri della spec erano sbagliati e il parser li ha corretti (§1)
- [x] **M8-07** — `lib/engine/insights.ts`: le due `upsert` e le due `fetch` server-side, con
      timeout e un errore leggibile se la fonte risponde male. Unico posto che importa `lib/db`,
      **nessuna eccezione nuova all'allowlist ESLint**. La copertura si calcola contro il listone di
      un'asta e **fallisce sotto soglia** invece di scrivere `null` (soglia ~90%: la baseline reale è
      487/495, §3)
      → la soglia è diventata **continuità** invece di copertura, e il perché è in §1 e in `DECISIONS.md`
- [x] **M8-08** — `lib/engine/admin.ts`: `setUserPro` con `refuseNonAdmin`, che **ri-legge `is_admin`
      dal database** e non si fida del JWT
      → senza il divieto di toccare la propria riga, che in `setUserAdmin` esiste per una ragione che qui non c'è
- [x] **M8-09** — `app/admin/actions.ts`: `refreshListoneAction`, `refreshRigoristiAction`,
      `setUserProAction`. `requireAppAdmin()` **prima riga di ognuna**, e **la lista di uguaglianza
      esatta in `tests/db/admin.test.ts` va aggiornata**: 5 azioni diventano **8**
      → `refreshListoneInsightsAction`, `refreshSetPiecesAction`, `setUserProAction`: 5 → 8, e la lista aggiornata **dopo** aver visto il test rompersi
- [x] **M8-10** — `app/admin/`: la pagina Listone con i due pulsanti, i **due timestamp** e la
      copertura (`n/495 agganciati`, e i non agganciati per nome). Il toggle `is_pro` in
      `app/admin/users/page.tsx`. `lib/admin-nav.ts`: quarta voce
      → e la copertura è per asta, non aggregata
- [x] **M8-11** — `listPickPool(auctionId, withInsights)` + `PoolPlayer.insights?`. **Entrambi** i
      chiamanti passano `canSeeInsights(user)` (§6). **`SnapshotPlayer` non si tocca**
      → `extId` esce dal pool quando non serve: c'era solo per agganciare
- [x] **M8-12** — `pick-panel.tsx`: quota titolare, minuti medi, badge rigorista/piazzati accanto a
      `fvm`. Riga densa, si legge in mezzo secondo. L'assenza è **`—`, non `0`**
      → sotto la squadra, dove la riga era già su due righe: nessun cambio d'altezza
- [x] **M8-13** — `bid-modal.tsx`: la prop `pool` da `portal.tsx` e le **sole macro** (§7)
      → tre informazioni, non dieci
- [x] **M8-14** — Test con Postgres: **il pool di un non-pro non contiene la chiave `insights`** (si
      asserisce sull'oggetto, non sul render); **un'asta arriva a `COMPLETED` con `player_insights`
      vuota**; la copertura sotto soglia fa fallire l'import; un non-admin è rifiutato **su ognuna
      delle tre azioni nuove**; un giocatore `previous` esce come `—`
      → 16 test, in **un file solo**: `player_insights` è globale e due file in parallelo si guastano a vicenda
- [x] **M8-15** — Gate: `pnpm test`, `pnpm typecheck`, `pnpm build` verdi (⚠ build con `pnpm dev`
      spento)
      → 622 test in 41 file, typecheck pulito, build compilata a dev spento
- [x] **M8-16** — `docs/ARCHITECTURE.md`: il capitolo sulle fonti, scritto attorno a **cosa succede
      quando una fonte cambia forma**. `docs/DECISIONS.md`: perché una tabella globale e non colonne
      su `players`; perché i .xlsx sono stati scartati; perché `injured` non entra pur essendo
      disponibile; perché `is_pro` è prodotto e non licenza. Più `docs/features/README.md` e
      `docs/HOWTO-PROVA-LOCALE.md`
- [x] **M8-17** — Chiusura: merge `--no-ff` su `dev`, prova in locale, poi — **solo su richiesta
      esplicita** — `main`, tag `v1.9.0`, `CHANGELOG.md` **con i tre passi a mano scritti dentro**
      (§10)

## Com'è andata

Il collaudo di §1 si è riprodotto senza sorprese chiamando il codice vero invece di uno script:
**497 giocatori in 1,26 s** dalla fonte A, **168 KB in 0,42 s** dalla fonte B, e tutti i numeri di §1
riconfermati sui byte del giorno dopo. Le fixture sono in `fixtures/`.

Ma **la spec è stata corretta tre volte dal codice**, e le tre correzioni sono la parte da leggere
fra sei mesi:

- **I numeri della fonte B erano sbagliati nella spec, non nella pagina** (§1). Li aveva prodotti uno
  script d'analisi il cui regex scartava cinque nomi con l'accento. Il parser vero ha trovato 60
  rigoristi, 60 piazzati e 92 designati, e con essi è caduto anche l'argomento con cui la spec
  giustificava l'estrazione dall'`href` — che resta la scelta giusta, ma per un'altra ragione (il
  `src` contiene l'edizione delle figurine, che invecchia ogni stagione).
- **La soglia è diventata continuità.** La spec voleva far fallire l'import sotto una certa copertura
  dei listoni delle aste. Scrivendo il test si è visto che **una sola asta simulata la avvelena**:
  `ext_id` sintetici da 1 a 40 portano la copertura a zero e l'import fallirebbe su dati perfetti.
- **Una quinta funzione pura**, `showableInsights`, non prevista da §5: senza di lei la regola «la
  stagione precedente non si mostra» sarebbe finita scritta due volte, in due componenti.

E tre inciampi che i test hanno trovato e che non si sarebbero visti a occhio:

- **`max()` in SQL grezzo torna una stringa, non una `Date`.** Il tipo dichiarato era una promessa
  falsa; il test l'ha scoperta con un `getTime is not a function`, che in pagina si sarebbe visto
  alle nove di sera.
- **Due file di test si guastavano a vicenda.** `player_insights` è globale — non ha nessun
  `auction_id` da cui dipendere per isolarsi — e vitest gira i file in worker paralleli: verdi da
  soli, rossi nella suite. Ora sono un file solo, e c'è scritto perché non va spezzato.
- **`insightsCoverage` guardava solo le cinque aste più recenti**, quindi il suo test dipendeva da
  quante aste creavano gli altri file nel frattempo. Ha preso un parametro: il secondo chiamante è
  arrivato davvero (regola 8).

**La prova in locale è stata fatta con le fonti vere e guardando il payload, non lo schermo.** Le due
`fetch` chiamate dal codice dell'applicazione — non dal test, non da uno script — hanno risposto in
**1,65 s** in tutto: 497 righe, 92 designati, `unknown: 0`, e copertura **487/495** su entrambe le
aste vere del database locale. Il pannello mostra i due timestamp in ora italiana (07:25 per un
import delle 05:25 UTC) e gli otto nomi non agganciati, per nome.

E §6 è stato verificato **sopra HTTP**, che è il posto dove conta, su un'asta usa-e-getta creata col
listone vero e cancellata dopo:

| Chi apre `/play` | Payload | `startsEleven` nel sorgente |
|---|---|---|
| Utente senza permesso | 92 KB | **0 occorrenze** — e il listone c'è lo stesso: 490 `fvm`, Berardi compreso |
| Lo **stesso** utente, permesso acceso | 241 KB | 487 occorrenze, con `"insights":{…}` dentro la riga del giocatore |

Due richieste alla stessa pagina, con lo stesso utente e la stessa sessione: cambia solo la colonna
`is_pro`, e cambia **cosa arriva nel browser** — non cosa si vede. È la differenza che tutta §6 esiste
per ottenere, e a schermo non si sarebbe potuta distinguere.

Il perimetro deciso all'apertura è stato rispettato: niente griglia portieri, niente `injured`, e
`serializeSnapshot` non è stato toccato di una riga.

## Verifica

1. `pnpm test`, `pnpm typecheck` e `pnpm build` verdi.
2. **Un'asta si gioca con `player_insights` vuota** e arriva a `COMPLETED`. È il test che dimostra
   che nessun dato di questa macro sta su un percorso critico.
3. ⚠ **Il pool di un utente non-pro non contiene la chiave `insights`.** Si asserisce sull'oggetto
   restituito da `listPickPool`, non su cosa si vede a schermo: è la differenza fra un dato protetto
   e un dato nascosto. **E vale per tutti e due i chiamanti**, portale e regia.
4. **`currentLot.player` ha esattamente le chiavi di prima.** `tests/db/i8.test.ts` verde senza
   essere stato modificato.
5. **Ognuna delle tre azioni nuove rifiuta un non-admin**, chiamata direttamente e non dalla pagina.
6. **Un refresh con la fonte irraggiungibile non lascia la tabella a metà**, e lo dice con un errore
   leggibile invece di scrivere `null`.
7. **La copertura si vede nel pannello**: `n/495`, e i non agganciati per nome. Sotto soglia l'import
   **fallisce** — e la soglia è tarata sotto il 98,4% misurato, altrimenti fallisce su dati sani.
8. **`—` e `0` si distinguono a schermo**: un giocatore `previous` (nessun dato mostrabile) e uno con
   zero partenze da titolare non si scrivono allo stesso modo.
9. **Nessuna percentuale sopra il 100%**: Thiam, che ha `starts_eleven` 42, si vede al 100%.
10. **Nel modale d'offerta ci sono tre informazioni, non dieci** (§7), e il pollice arriva al campo
    dell'offerta senza scorrere.
