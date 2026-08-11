# M7 — Le caricature dei calciatori

> **Stato:** **aperta** su `feature/07-caricature` il 2026-08-11 · Pianificata il 2026-08-11 ·
> Nessuna dipendenza da macro aperte (M6 è in v1.7.0, e il pannello che serve esiste già)
>
> **Tocca lo schema del database?** **No.** Nessuna tabella, nessuna colonna: «questa figurina ce
> l'abbiamo?» lo risponde il **file su disco**. Quindi **nessun `pnpm db:push`** e nessun backfill.
>
> ⚠ **Ma il deploy non finisce col deploy.** In produzione l'archivio nasce **vuoto**, e va riempito
> dal pannello (si carica il listone, si preme, sette secondi). Fino a quel momento l'applicazione
> funziona esattamente come prima — semplicemente non si vede nessuna figurina. È una differenza
> importante rispetto al backfill di M5, dove il passo mancante **rompeva** il login: qui il passo
> mancante non rompe niente, si vede e basta. Serve anche una variabile nuova nel `.env`
> (`CAMPIONCINI_EDITION`), con un default nel codice perché dimenticarla non rompa niente in silenzio.
>
> **Invarianti coinvolti:** **I8**, di striscio e in un modo che va detto: il giocatore in asta è
> pubblico per definizione — è la busta che è segreta — quindi mostrarne il volto non ci si avvicina
> nemmeno. **Regole coinvolte:** 3 (si tocca `serializeSnapshot`, di una riga), 6, 8.
>
> ⚠ Si apre **su richiesta esplicita dell'owner**, come tutte.

## Obiettivo

Quando un giocatore viene chiamato all'asta, la stanza guarda lo schermo e chiede «chi è?». Oggi
trova un nome, una squadra e un numero. Fantacalcio.it disegna per ogni giocatore una **figurina** —
la caricatura dentro una carta con lo scudetto e il ruolo — e quella figurina è esattamente la
risposta a quella domanda, a colpo d'occhio, da tre metri di distanza.

Questa macro la porta dentro: la scarica **una volta**, la tiene sul nostro disco, e la mostra nel
lotto in corso. Niente di più.

Il tema, detto in una riga: *si scarica una volta, si guarda per tutta la serata.*

## Richieste che ci confluiscono

Tolta da `docs/REQUESTS.md` il 2026-08-11 — il quaderno torna vuoto.

- **Caricature dei calciatori.** «Su questo sito trovi la lista dei calciatori del fantacalcio.
  Quello che vorrei avere sono le immagini dei calciatori: per ognuno c'è una caricatura. Mi
  servirebbe una funzione admin che: fetcha tutti i calciatori partendo da un listone di riferimento
  (possiamo avere una sezione admin dove lo carico); salva l'immagine che si trova nel profilo
  calciatore; crea una cartella con tutte le immagini, salvando l'immagine con l'ID presente sul
  listone. Con questo dato voglio poi poter inserire l'immagine del giocatore quando viene estratto
  nel lotto.»

**Un pezzo della richiesta è sparito durante la sessione di spec, ed è una buona notizia:** «fetcha
il profilo del calciatore ed estrai l'immagine» non serve. L'immagine si ricava **dall'id e basta**
(§2), quindi non c'è nessuno scraping di pagine HTML da scrivere e da tenere in piedi — è una `GET`
su un CDN. Quello che restava della richiesta è tutto qui dentro.

---

## Spec

### 1. Il collaudo che ha scritto questa spec

Questa sezione viene prima delle altre perché **le altre sono conseguenze sue**. Il 2026-08-11, prima
di scrivere una riga, il downloader è stato provato per davvero: un prototipo in Node — la stessa
`fetch` che userà l'applicazione, non `curl`, così un CDN che rifiutasse un client non-browser si
sarebbe visto subito — sui **495 id del listone vero** che stava nel database locale.

```text
495 su 495 scaricate · 0 errori · 0 403 · 0 risposte non-PNG
51,56 MB in 7,3 secondi · mediana 18ms · peggiore 234ms
concorrenza 4 · timeout 10s per richiesta · nessun 429
```

⚠ **Sette secondi, non tre minuti.** La prima versione di questa spec era costruita attorno a
un'operazione lunga: scaricamento a lotti da venticinque, la lista degli id parcheggiata in un file
`listone.json`, la pagina che si richiamava da sé, un pulsante «Ferma», una condizione di
terminazione per il caso «nessun progresso». Tutta quell'impalcatura serviva a sopravvivere a
un'attesa che non esiste. **Non si scrive niente di tutto questo** (§4).

⚠ **E il `403` non esiste, per un id vero.** A chi non ha la foto quel CDN non risponde «non ce
l'ho»: restituisce una **sagoma senza volto con la maglia del suo club** — 144 giocatori su 495, il
29%, in 20 varianti (19 maglie più il portiere generico). Il `403` arriva solo per id che non sono
giocatori (provato con `1` e `99999`). Cadono quindi anche i marcatori `.none` che la prima versione
prevedeva per non riprovare all'infinito gli assenti: non c'è nessun assente da marcare.

**La lezione, per la prossima volta che qualcosa va scaricato da fuori:** venti richieste vere hanno
tolto tre pezzi di architettura. La domanda «l'hai provato?» è arrivata dall'owner, non da me.

### 2. L'URL, e l'unica cosa che cambierà

L'immagine si costruisce dall'id, che è la colonna `#` del listone — la stessa che noi salviamo già in
`players.ext_id`:

```text
https://content.fantacalcio.it/web/campioncini/<edizione>/card/<extId>.png
```

Il `?v=644` che si vede negli URL del sito è un anti-cache e si omette. Il formato è **`card`,
255×378**, e si scarica **solo quello**: esistono anche `medium` (120×160) e `small` (60×80), che sono
la caricatura sola su fondo trasparente, ma un formato solo vuol dire un file per giocatore, un URL,
un solo caso «manca» — e la `card` sta bene su tutti e due gli schermi che la mostrano (§6).

⚠ **`<edizione>` è l'unica parte che invecchia.** Oggi è `21`; `20` risponde ancora, `22` no, quindi è
la stagione e l'anno prossimo cambierà. Sta in **`CAMPIONCINI_EDITION` nel `.env`**, con `"21"` come
default nel codice: una variabile assente non deve rompere niente, e una variabile sbagliata si vede
subito (nessuna figurina scaricata). Ad agosto prossimo la si cambia sul server, con il `pm2 reload
deploy/ecosystem.config.cjs --update-env` che ogni modifica di `.env` pretende — ed è un passo a mano
che va scritto nel `CHANGELOG.md` di questa versione, perché fra dodici mesi non se lo ricorderà
nessuno.

### 3. L'archivio, e la sola difesa che serve

I file stanno in **`storage/campioncini/<extId>.png`**, e nel nome c'è **solo l'id**: mettere anche il
nome del giocatore renderebbe orfano il file il giorno che il listone scrive «Martinez L.» in un altro
modo.

**Perché `storage/` e non `public/`.** In produzione il server standalone fa `process.chdir(__dirname)`,
quindi la sua `public/` è `.next/standalone/public` — e `deploy/deploy.sh` fa `rm -rf
.next/standalone/public` prima di ricopiarla. Tutto ciò che l'applicazione scrivesse là dentro **lo
cancellerebbe il deploy successivo, senza dire niente**. `storage/` invece non la sfiora nessuno:
`git reset --hard` non rimuove i file non tracciati e `pnpm build` non ci entra, quindi l'archivio
sopravvive a ogni rilascio e anche a un rollback a un tag precedente. Va in `.gitignore`.

Il percorso lo calcola **`deploy/ecosystem.config.cjs`**, che già fa `ROOT = path.resolve(__dirname,
"..")` per pm2: passa `MEDIA_DIR: path.join(ROOT, "storage")` nell'ambiente del processo, e così **in
produzione non c'è nessun percorso da mettere a mano**. In sviluppo il default è `<cwd>/storage`, che
sotto `pnpm dev` è la radice del progetto.

Le serve una rotta dell'applicazione, `GET /api/campioncini/<extId>.png`, con `ETag` (da dimensione e
mtime) e `Cache-Control` di un giorno: durante una serata ogni browser scarica ogni figurina una volta
sola.

⚠ **La difesa che questa rotta deve avere, ed è una sola:** il parametro accetta **soltanto
`^\d+\.png$`**, e il percorso si costruisce da un intero, mai concatenando una stringa che arriva da
fuori. È la difesa contro il path traversal — `/api/campioncini/..%2f..%2f.env.png` non deve nemmeno
arrivare al filesystem — ed è il primo test che si scrive.

Se un giorno servisse più velocità, un `location /api/campioncini/` in nginx con un `alias` sulla
cartella la servirebbe senza passare da Node, **allo stesso URL e senza toccare l'applicazione**. Non
si fa adesso: 118 KB con `ETag` a dodici telefoni non è un problema che abbiamo.

### 4. Lo scaricamento: un click

Una **sola server action**. Si carica il `.xlsx` nella sezione del pannello, il parser che c'è già lo
legge (è puro e non tocca il database), e per ogni id che non è già sul disco si scarica l'immagine.
Quattro richieste in parallelo, dieci secondi di timeout ciascuna. Alla fine l'azione risponde con i
numeri: quante scaricate, quante c'erano già, **quanti id senza immagine** — cioè i `403`, che per un
listone vero dovrebbero essere zero e non hanno niente a che vedere con le sagome di §5, che si
scaricano regolarmente — e quanti errori di rete.

**Il file `.xlsx` non si conserva** (P6, come l'import del listone): serve solo la lista di id, dentro
quella richiesta.

⚠ **Una scadenza a 20 secondi**, e non è pessimismo gratuito: `location /` in
`deploy/nginx-asta.conf` non imposta `proxy_read_timeout`, quindi vale il default di **60 secondi** —
il timeout lungo di un'ora è solo sulla rotta dello stream. Con sette secondi misurati il margine è di
tre volte; se un giorno il CDN fosse dieci volte più lento, l'azione si fermerebbe a 20 secondi e
direbbe quante ne restano. Si ripreme il pulsante e riprende: **il campo del file non si è svuotato**,
perché una server action non ricarica la pagina. **La scadenza è tre righe, non un sottosistema**: è
ciò che resta del batching dopo il collaudo.

Nessun lavoro in background, nessun singleton su `globalThis`, nessuna tabella di stato: **lo stato è
il disco.** «Mancante» vuol dire «file che non c'è», e questo rende l'operazione ripetibile per
costruzione — la si può dare due volte, e la seconda non scarica niente.

### 5. Le sagome senza volto restano

144 giocatori su 495 non hanno una caricatura e ricevono la sagoma con la maglia del club. **Si
salvano e si mostrano come tutte le altre**: un `200` è un `200`.

Non è pigrizia, sono tre ragioni. La sagoma è **riconoscibile per quello che è** — non ha scudetto né
nome stampato, mentre le figurine vere li hanno — quindi nessuno penserà che l'applicazione sia rotta.
Il riquadro del lotto **non cambia mai forma**, perché ogni giocatore del listone ha un'immagine: se
scartassimo le sagome, quasi un lotto su tre avrebbe un riquadro più corto e il pulsante d'offerta si
sposterebbe mentre un pollice lo sta cercando. E scartarle richiederebbe riconoscerle: venti hash
scritti nel codice che **cambiano alla prossima edizione**, cioè un riconoscimento che un giorno
smette di funzionare in silenzio — il modo peggiore di rompersi.

### 6. Dove si vede

**Due posti, e sono due.** Il portale del partecipante (`components/auction/lot-card.tsx`) e la vista
TV (`app/tv/[publicToken]/tv-view.tsx`). La regia **no**: `console.tsx` mostra il lotto come una riga
di testo, non come un riquadro, e chi sta in regia ha la TV nella stessa stanza.

| Dove | Misura | Perché |
|---|---|---|
| Portale | **68×100**, a sinistra del nome | Venti pixel di altezza in più sono il prezzo minimo perché la figurina sia una figurina invece di una macchia colorata. A 54×80 non costava niente e non si vedeva niente; a 81×120 si vede meglio e costa quaranta pixel su uno schermo da 667 |
| TV | Un terzo della larghezza | È lo schermo per cui la `card` è stata disegnata: a tre metri si leggono cornice e scudetto |

Scelte guardando i tre layout a dimensione reale, non a naso.

> ⚠ **Aggiornato in corso d'opera: i posti sono diventati tre.** Su richiesta dell'owner, dopo aver
> visto i primi due, la figurina è entrata anche nel **modale d'offerta**
> (`components/auction/bid-modal.tsx`), che è il posto dove si guarda il giocatore mentre si decide
> quanto mettere — cioè esattamente la domanda a cui questa macro serve a rispondere. Sta **a sinistra
> dell'intestazione** (nome, countdown, `max_bid`, barra) e non sopra il nome, dov'era nata: quel foglio
> arriva dal basso e con la tastiera aperta l'altezza è la risorsa scarsa, mentre lo spazio a sinistra
> del testo c'era già. Misura identica alla card che sta dietro — è lo stesso giocatore nello stesso
> momento. Restano fuori regia, rose e storico: §9 non cambia.

**Nello snapshot cambia un campo**: `extId` dentro il giocatore del lotto, in `serializeSnapshot` —
che è l'unico punto da cui lo stato esce (regola 3) e quindi l'unico posto dove si aggiunge. Nel pool
dei giocatori **non** ci va: il pool serve a scegliere chi chiamare, e nessuno ha chiesto le figurine lì
(regola 8).

**Il fallback è `onError` che nasconde l'immagine**, e il testo scorre a sinistra: nessun segnaposto
grigio, perché segnalerebbe un'assenza che non è un guasto. Copre l'unico caso rimasto — l'archivio
non ancora riempito — e in quel caso non ce l'ha nessuno, quindi il riquadro è uniforme comunque.

### 7. Il pannello: una terza voce

`Utenti`, `Aste`, **`Figurine`** in `lib/admin-nav.ts`, che di nuovo è l'unico posto dove etichetta,
titolo e segmento stanno sulla stessa riga. La pagina dice quante figurine ci sono nell'archivio, e ha
il form con il file e il pulsante.

⚠ **La server action nuova romperà un test di M6**, quello che enumera gli export di
`app/admin/actions.ts` con un'uguaglianza esatta. È esattamente il suo lavoro: obbliga a mettere la
guardia `requireAppAdmin()` e il nome nella lista **nello stesso momento**. Non si «aggiusta» il test
allentando l'uguaglianza.

### 8. Cosa non cambia

Il motore, la macchina a stati, il lock, il ledger, le rose, lo storico, la regia, lo scheduler, il
tick dei bot. Lo schema. Di `serializeSnapshot` una riga, e di `lot-card.tsx` e `tv-view.tsx` la parte
che disegna il giocatore.

### 9. Cosa non entra (regola 8)

Niente figurine nelle rose, nello storico e in regia (§6) · niente `medium` e `small`: un formato solo
(§2) · niente riconoscimento delle sagome (§5) · niente lavoro in background, niente coda, niente
tabella di avanzamento (§4) · niente scraping delle pagine dei giocatori: non serve (§2) · niente
ritaglio, ridimensionamento o conversione in WebP delle immagini — 51 MB stanno su un disco da 40 GB, e
un'immagine ritoccata è un'immagine che va ritoccata di nuovo alla prossima edizione · niente
cancellazione dell'archivio dal pannello: si cancella una cartella, e chi può farlo ha già un `ssh` ·
niente scaricamento automatico all'import del listone di un'asta, che legherebbe l'archivio alle aste
(valutato: l'archivio è globale e sopravvive alla cancellazione di un'asta, che da M6 è facile).

---

## Task

- [x] **M7-01** — Aprire `feature/07-caricature` da `dev`; rileggere questo file, e in particolare §1
      — le tre semplificazioni che il collaudo ha imposto sono la parte che si è tentati di rifare
      complicata
- [x] **M7-02** — `lib/campioncini.ts`: la parte pura in cima (l'URL da id ed edizione, il nome del
      file, la validazione dell'id) e sotto ciò che tocca il mondo — lo scaricamento e il conteggio
      dell'archivio — con `fetch` e cartella **iniettabili**, perché il test non tocchi la rete
- [x] **M7-03** — `.gitignore` (`/storage`), `MEDIA_DIR` calcolato da `ROOT` in
      `deploy/ecosystem.config.cjs`, `CAMPIONCINI_EDITION` in `.env.example` col default nel codice
- [x] **M7-04** — `GET /api/campioncini/<extId>.png`: `^\d+\.png$` e nient'altro, `ETag`, cache di un
      giorno, `404` se il file non c'è
- [x] **M7-05** — La server action: carica il listone, scarica ciò che manca, scadenza a 20 secondi,
      guardia `requireAppAdmin()` in cima. **E il nome aggiunto alla lista del test di M6**
- [x] **M7-06** — `lib/admin-nav.ts` + la pagina `/admin/figurine`: quante ce ne sono, il form, i
      numeri dell'ultima passata
- [x] **M7-07** — `extId` in `SnapshotPlayer` e in `serializeSnapshot`; verificare che il test I8 di
      F4-08 sia ancora d'accordo (guarda l'insieme esatto delle chiavi del lotto, e un campo nuovo
      **dentro** `player` potrebbe non bastargli)
      → **non gli bastava**: `player` era già una chiave di primo livello, quindi il test restava
      verde senza obbligare nessuno a guardare. Ora anche le chiavi del giocatore sono un insieme
      esatto, e la nuova asserzione è stata vista fallire togliendo `extId` dall'elenco atteso
- [x] **M7-08** — Il componente della figurina con `onError`, a 68×100 nel portale e a un terzo sulla
      TV
- [x] **M7-09** — Test: il percorso malevolo rifiutato (`..`, id non numerico, id enorme); `200`
      salva, `403` non salva, il timeout non salva; la scadenza ferma la passata e dice quante
      restano; ripetere la passata non riscarica niente; la rotta serve, nega e non esce dalla
      cartella
      → 39 test in `tests/campioncini.test.ts`; quelli del traversal scritti **prima** della rotta e
      visti fallire
- [x] **M7-10** — Gate: `pnpm test`, `pnpm typecheck`, `pnpm build` verdi (⚠ build con `pnpm dev`
      spento) → 575 test in 38 file, typecheck pulito, build compilata; e l'archivio è ancora lì
      dopo il `pnpm build`
- [x] **M7-11** — `docs/ARCHITECTURE.md`: il capitolo, scritto attorno a **cosa ha insegnato il
      collaudo** più che attorno al codice. `docs/DECISIONS.md`: le tre semplificazioni con il loro
      perché, le sagome tenute, e `storage/` invece di `public/` con la trappola del deploy
- [x] **M7-12** — Chiusura: merge `--no-ff` su `dev`, prova in locale, poi — **solo su richiesta
      dell'owner** — `CHANGELOG.md`, `package.json`, merge su `main`, tag, push. **Nessun `db:push`**;
      ma in produzione **l'archivio va riempito dal pannello**, e il changelog deve dirlo insieme al
      `pm2 reload --update-env` per la variabile nuova
      → **v1.8.0**, 2026-08-11. Due merge commit su `dev` invece di uno: il primo dopo M7-11, il
      secondo per le due richieste arrivate provando l'app (§6, il riquadro qui sopra)

## Com'è andata

Il collaudo di §1 si è riprodotto senza sorprese, questa volta chiamando il codice vero invece di un
prototipo: **495 su 495 in 3,2 secondi**, zero `403`, zero errori, 53 MB. La seconda passata sullo
stesso listone ha scaricato **zero** e l'ha detto. E le sagome senza volto sono ancora **144 su 495,
in 20 varianti** — contate confrontando i file identici fra loro, che è un modo di verificarle in una
riga di shell senza scrivere in produzione il riconoscimento che §5 vieta.

Le tre verifiche chieste all'apertura sono state fatte e non assunte:

- **`storage/` sopravvive.** Provato con un file finto prima di scrivere il downloader: sopravvive a
  `git reset --hard` (non è tracciato) e a `pnpm build`. `deploy/deploy.sh` non fa nessun `git clean`
  e tocca solo `.next/standalone/public`.
- **`MEDIA_DIR` arriva davvero.** Verificato valutando `deploy/ecosystem.config.cjs` con Node in una
  radice finta — non basta leggerlo: il `.env` locale non ha `AUTH_URL` e il file si rifiuta di
  valutarsi, quindi la prova voleva un ambiente completo. Finisce in `app.env`, e un `MEDIA_DIR`
  scritto a mano nel `.env` vince sul calcolo. Confermato anche il motivo per cui serve:
  `.next/standalone/server.js` fa `process.chdir(__dirname)` alla riga 6.
- **Il test I8**: vedi M7-07 qui sopra. È l'unica cosa di questa macro che ha cambiato un file di
  M6/F4 oltre a quanto previsto, ed è stata una scoperta della verifica, non una decisione a priori.

## Verifica

1. `pnpm test`, `pnpm typecheck` e `pnpm build` verdi.
2. ⚠ **`/api/campioncini/` non serve niente che non sia un intero**: `..%2f..%2f.env.png`, `abc.png`,
   `2764.png.txt` e un id di cinquanta cifre sono tutti rifiutati **senza toccare il filesystem**.
3. **Una passata a freddo** su un listone vero scarica ~495 figurine in una decina di secondi e
   risponde con i numeri; **la seconda passata non scarica niente** e lo dice.
4. **La scadenza funziona**: con un `fetch` finto e lento la passata si ferma a 20 secondi, dice
   quante restano, e ripremendo riprende da dove era.
5. **Un lotto mostra la figurina** sul portale a 68×100 e sulla TV a un terzo di larghezza, e il
   giocatore che nel database ha `ext_id` senza file **non lascia nessun buco**.
6. **Una sagoma senza volto si vede come le altre** (si prende un portiere di riserva: nel listone di
   prova sono 144 su 495).
7. ⚠ **Il test di M6 sulle server action si è rotto e l'ho sistemato aggiungendo la guardia**, non
   allentando l'uguaglianza.
8. **L'archivio sopravvive a un rilascio**: dopo un `pnpm build` e un riavvio le figurine ci sono
   ancora.
9. **Un'asta si gioca ancora**: una simulazione a 8 arriva a `COMPLETED`, e nei lotti si vedono le
   figurine.
