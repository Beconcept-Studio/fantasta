# M20 — Il marchio nel nav, e l'app che si installa sul telefono

> **Stato:** **pianificata**, non aperta. Nasce dall'unica richiesta che l'owner ha scritto nel
> quaderno dopo `v1.19.2`, ed è una macro sola perché le due metà — il marchio e l'installabilità —
> vengono **dallo stesso disegno** e si generano dallo stesso file sorgente (§0).
>
> ⚠ **Tocca lo schema del database? No. Tocca il motore? No. Backfill? No.** Nessun `pnpm db:push`,
> nessun passo a mano sul server, nessuna dipendenza nuova in `package.json`. Non si aggiunge un
> campo a `serializeSnapshot`, non nasce una Server Action, non si scrive niente su nessuna tabella.
> **Il rilascio finisce col deploy** — con una verifica in più subito dopo, che §7 spiega e che non è
> una formalità.
>
> **Invarianti coinvolti: nessuno, e va detto invece di darlo per scontato.**
> **I8** non è in gioco: questa macro non tocca lo snapshot, non aggiunge un campo, non legge
> un'offerta. **I10 / `PLAN §8bis`** non è in gioco: non introduce stato locale in nessuna schermata
> e non aggiunge una vista raggiungibile solo da chi era connesso — il manifest è una risorsa statica
> e il marchio è un `path`.
> **Regole coinvolte:** **8** (il marchio è un componente con **un solo chiamante**: sta nel file di
> chi lo usa, non in un file suo — §1); **la regola del `dark:`** (niente varianti scure nel codice
> nuovo, e la TV non si tocca: la navbar lì restituisce già `null`).
> **Decisione ribaltata:** `DECISIONS.md` 2026-08-18 — «nessun manifest, nessuna PWA, nessun service
> worker» (§0).

## §0 — Perché una macro sola, e cosa ribalta

Le due metà della richiesta sembrano due cose e sono una: **`fixtures/logo.png` è la sorgente di
tutte le icone** — linguetta, iOS, manifest — e `fixtures/logo.svg` è lo stesso marchio in vettore
per il nav. Un tag solo, un rollback solo: tornare indietro sul manifest senza tornare indietro sul
marchio non è uno scenario che qualcuno vorrà mai.

⚠ **E questa macro ribalta una decisione scritta.** `docs/DECISIONS.md` del 2026-08-18, la voce
sull'icona fuori macro, dice per iscritto:

> nessun manifest, nessuna PWA, nessun service worker

con la motivazione — «un manifest la renderebbe installabile, cioè aggiungerebbe una superficie da
mantenere che nessuno ha chiesto» — e chiude con «per non ritrovarselo proposto come idea nuova».
Adesso l'installabilità **è** chiesta, dall'owner, in prima persona. La decisione era giusta quando
è stata presa e resta la ragione per cui allora non si è fatto: cambia il fatto, non il
ragionamento. Va scritta in `DECISIONS.md` come **ribaltamento datato**, altrimenti fra sei mesi le
due voci si contraddicono senza spiegarsi.

⚠ **Il ribaltamento ha una conseguenza concreta, non solo retorica.** Quella voce spiega perché la
misura **192** era stata saltata *di proposito*: «il 192 serve a un manifest, e questa applicazione
non ne ha uno». Adesso ce l'ha, quindi il 192 serve, e serve anche il posto da cui servirlo (§3).

## Obiettivo

Due cose, e la seconda è quella che si vede la sera dell'asta.

La prima: **il marchio non è da nessuna parte nell'applicazione**. Sta nella linguetta del browser da
`v1.15.1` — ma quello era il cerchio blu, che adesso non è più il marchio — e dentro le pagine il nome
dell'app è una parola in grassetto. Chi apre il portale non vede niente che dica «questa app è
questa».

La seconda: **oggi si arriva all'app dal browser, ogni volta.** Chi la usa dal telefono la tiene in
una linguetta di Safari fra le altre, o si ricorda l'indirizzo. La sera dell'asta, con dodici persone
nella stessa stanza che devono aprire lo stesso portale in fretta, «l'icona sulla schermata home» non
è una comodità estetica: è la differenza fra un tocco e un giro nella cronologia.

Il tema, in una riga: *il marchio si vede dentro l'app, e l'app si mette sulla schermata home come
un'app.*

## Richieste che ci confluiscono

Tolta da `docs/REQUESTS.md` il 2026-08-27.

- **Nuovo logo e Manifest per web app.** «Ho caricato un nuovo logo per l'app. In /fixtures trovi
  logo.svg, da inserire nel nav vicino al titolo "Fantasta". logo.png invece è un'immagine square da
  usare per favicon, e come immagine dell'app che si scarica quando si installa la web app su uno
  smartphone. A tal proposito voglio che l'app diventi scaricabile (quindi una PWA), in modo che da
  iPhone (e se possibile anche da altri dispositivi) mi possa salvare il segnalibro (come se fosse
  un'app) sullo smartphone.»

**Quattro decisioni dell'owner, prese il 2026-08-27**, tutte prima di scrivere una riga:

1. **Nessun service worker.** iOS non lo richiede per installare in standalone; Chrome sì, per il
   banner «Installa app». Si accetta di perdere quel banner (su Android resta la scorciatoia) per non
   mettere una cache sopra un'applicazione che a ogni deploy ha già due minuti di chunk 404 (§5).
2. **Logo *e* scritta nel nav**, non il logo al posto della scritta. Il marchio è una «F», non un
   lettering: la parola accanto non è una ripetizione (§1).
3. **Macro M20, non un intervento fuori macro** come fu l'icona il 2026-08-18: qui nasce una cartella
   nuova, nasce un manifest, e si ribalta una decisione scritta.
4. **Il numero 19 resta bruciato.** `CLAUDE.md` e l'indice delle macro rimandano a
   `git show e381389:docs/features/19-deploy-senza-finestra-cieca.md` per la M19 cancellata: riusare
   il numero renderebbe illeggibile quel rimando.

## Cosa dicono i due file, misurato

Non «guardato»: misurato, perché tre scelte della spec dipendono da questi numeri.

**`fixtures/logo.svg`** — 602×800, **un solo `path` nero**, monocromatico. Porta anche un
`clipPath` che è un rettangolo a tela piena, cioè **inerte**: rumore dell'export da Figma.

**`fixtures/logo.png`** — 1080×1080, RGBA con **alpha interamente opaco** (min e max entrambi 255).
Il marchio è bianco, il fondo è un gradiente verde → giallo → blu notte con grana. Riquadro del
bianco: dal 33% al 67% in orizzontale, dal 27% al 73% in verticale — cioè **34% × 46%, centrato
esatto** (50%, 50%).

Da qui, tre conseguenze:

1. **Niente da appiattire.** Il problema per cui `apple-icon.png` esisteva in quella forma — iOS
   riempie la trasparenza di nero e mette gli angoli neri attorno al disegno — **non esiste più**:
   l'immagine è già opaca a tela piena. L'icona di iOS diventa un ridimensionamento e una conversione
   a RGB.
2. **Un solo file fa anche da `maskable`.** La zona sicura di Android è il cerchio interno all'80%,
   cioè un raggio del 40% dal centro. L'angolo del marchio più lontano dal centro sta a
   √(0,17² + 0,23²) = **28,6%**. Nessun margine da aggiungere, nessun secondo file.
3. **A 16 pixel il marchio non si legge come forma**, e si è deciso di accettarlo: largo il 34% di
   16px fa 5,4 pixel. Le rese sono state guardate ingrandite, tela piena contro un ritaglio stretto,
   e ha vinto la tela piena — a **32 e 48** il marchio è già netto, e il ritaglio a misura grande
   **perde il blu notte**, cioè darebbe due icone visibilmente diverse per la stessa app. A 16px il
   riconoscimento lo fa il campo di colore, che è quello che fa la maggior parte delle favicon.

---

## Spec

### §1 — Il marchio nel nav

Il `path` va **inline in `components/nav/navbar.tsx`**, come funzione `Logo()` in fondo al file, e
**non** in `components/nav/logo.tsx`: ha **un solo chiamante** e la regola 8 vale anche per un
componente di sei righe. Il giorno che un secondo posto lo vuole — la pagina di accesso, la TV — si
sposta in un file suo, e quel giorno ci sarà un secondo chiamante che lo giustifica.

Tre dettagli che non sono gusto:

- **`fill="currentColor"`, non `fill="black"`.** Così segue il colore del testo accanto invece di
  congelarsi. Non serve oggi — la navbar è chiara e il testo è quasi nero — ma è ciò che evita un
  marchio nero su fondo nero il giorno che qualcosa cambia, e costa una parola.
- **Il `clipPath` si butta**, con il suo `<defs>` e il suo `id`. È inerte, e ⚠ un SVG inline
  condivide lo spazio dei nomi degli `id` con tutta la pagina: gli identificativi generati da Figma
  (`clip0_262_27`) in una pagina sono un rischio piccolo e gratuito da evitare.
- **`aria-hidden="true"`.** Il nome dell'app è scritto accanto in testo: un `<title>` nell'SVG
  farebbe leggere «Fantasta Fantasta».

Il `<Link href="/dashboard">` che c'è già diventa `flex items-center gap-2` e contiene marchio e
parola. Misura di partenza `h-5 w-auto` (20px di altezza → ~15px di larghezza, il marchio è
verticale): **è una misura da guardare, non da dedurre**, e il task M20-02 la guarda sul telefono
prima di fissarla. Il resto della navbar non si tocca: a 375px a sinistra c'era solo il titolo, e
quindici pixel ci stanno.

Su `/tv/` non cambia niente — la navbar lì restituisce già `null` (`pathname.startsWith("/tv/")`).

### §2 — Le icone, da `logo.png`

`scripts/genera-icone.py` si **riscrive**, e resta com'è nella sua natura: **non chiamato da niente**
— né build, né `tsc`, né ESLint — con i file che produce **committati**. Un'icona cambia una volta
all'anno; un passo di build sarebbe un costo permanente per un lavoro che si fa una volta. E `sharp`
continua a non essere utilizzabile: c'è sotto `node_modules/.pnpm` perché lo porta Next, ma con
`pnpm` non è issato e un `require("sharp")` dalla radice risponde `MODULE_NOT_FOUND`.

Cosa cambia nella ricetta:

| nella ricetta | prima (`v1.15.1`) | adesso |
| --- | --- | --- |
| sorgente | `fixtures/favicon-512.png` | `fixtures/logo.png` |
| appiattimento iOS | sul blu del disegno | **nessuno**: l'alpha è già opaco, basta `convert("RGB")` |
| maschera di contrasto | no | **no**, e per la stessa ragione: nessun dettaglio fine da recuperare |
| ritaglio | non c'era la domanda | **no**, tela piena (le rese sono state guardate) |
| misure | 16/32/48 · 180 · 512 | 16/32/48 · 180 · **192** · 512 |

Cinque file in uscita: `app/favicon.ico` (16/32/48 dentro, scritto byte per byte come oggi — Pillow
ridimensionerebbe da sé, buttando via le rese preparate a mano, che sono l'unica ragione per cui un
ICO multi-misura esiste), `app/icon.png` (512), `app/apple-icon.png` (180, RGB senza alpha),
`public/icon-192.png` e `public/icon-512.png`.

⚠ **`fixtures/favicon-512.png` si cancella.** Non è più la sorgente di niente, e tenerlo accanto a
`logo.png` lascia in piedi il dubbio su quale dei due comandi. Git lo conserva.

⚠ **Due note della voce 2026-08-18 vanno riportate qui, perché resteranno vere e sembreranno errori.**
La prima: sul `.ico` Next dichiara `sizes="16x16"` perché legge la prima voce dell'indice e non tutte
e tre — le tre misure ci sono, e correggerlo vorrebbe dire scrivere `metadata.icons` a mano. La
seconda: in produzione **`/favicon.ico` non arriva a Node**, lo intercetta un `location = /favicon.ico`
del boilerplate di Ploi, ed è preesistente e deciso di lasciarlo. Nessuna delle due è roba che questa
macro rompe o aggiusta.

### §3 — `public/` nasce, e ha una trappola

**Oggi non esiste.** Nasce qui, e per un motivo preciso: il manifest deve dichiarare le sue icone con
un **URL stabile**, e le rotte che Next genera dai file dentro `app/` portano un hash che cambia col
contenuto.

- **Piatta, senza sottocartella `icons/`.** Due file non sono una cartella.
- ⚠ **I nomi non possono essere `icon.png`**: collide con la rotta `/icon.png` che Next genera da
  `app/icon.png`. Da qui `icon-192.png` e `icon-512.png`, e il motivo va scritto accanto ai file
  perché un rinomino «per pulizia» romperebbe l'installazione.
- **Il 512 esiste due volte** — `app/icon.png` e `public/icon-512.png` — stessi byte, due consumatori
  diversi (il `<link>` che Next genera da sé, e il manifest), **una sola sorgente**: lo stesso
  script, dallo stesso PNG. È il prezzo per non ribaltare *anche* la decisione «niente
  `metadata.icons` scritto a mano», che tenerebbe allineate due verità per la stessa cosa. Sono byte
  duplicati, non una decisione duplicata.
- ⚠ **`public/` non è in `.gitignore`, ed è nominata lì solo in un commento**: la riga che ignora
  `/storage` spiega che l'archivio delle figurine sta fuori da `public/` *di proposito* (M7, vedi
  `lib/campioncini.ts`). Le due icone qui dentro **vanno committate**, e quella scelta non si tocca:
  nessuna figurina finisce in `public/`.

### §4 — Il manifest

`app/manifest.ts`, che Next serve su `/manifest.webmanifest` e per cui emette il `<link>` da sé.
Nessun `middleware.ts` in questo progetto — l'autenticazione è per pagina, con `requireUser()` —
quindi la rotta è pubblica, come deve essere: il browser scarica il manifest **senza credenziali**.

```ts
{
  name: "Fantasta — Asta Fantacalcio",
  short_name: "Fantasta",
  description: "Asta di Fantacalcio a busta chiusa, in diretta.",
  lang: "it",
  start_url: "/",
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#ffffff",
  icons: [ /* quattro voci, due file: vedi sotto */ ],
}
```

Le scelte che non sono ovvie:

- **`start_url: "/"`** e non `/dashboard`: la radice smista già da sé per stato di sessione
  (`signin` → `verify` → `onboarding` → `dashboard`, `app/page.tsx`). Puntare alla dashboard vorrebbe
  dire che l'app installata si apre su un redirect per chi non è entrato.
- **Nessun `orientation`.** Il portale è verticale e la TV è orizzontale, e sono la stessa
  applicazione: fissare un orientamento nel manifest sarebbe una scelta di una vista imposta
  all'altra.
- **`theme_color` e `background_color` bianchi.** Il bianco è `--background` (`oklch(1 0 0)`), e la
  navbar è `bg-background`: una barra di stato colorata sopra una navbar bianca si legge come un
  difetto di allineamento, non come un tocco di marchio. Il `background_color` è anche il colore
  dello splash su Android, e l'app apre bianca — così non c'è un lampo di colore.
- ⚠ **Quattro voci di icona per due file, e non due voci con `purpose: "any maskable"`.**
  Il tipo di Next è `purpose?: 'any' | 'maskable' | 'monochrome'`: la stringa doppia, che la
  specifica del W3C ammette, **sarebbe un errore di typecheck**, cioè una build rossa al gate.
  Verificato in `node_modules/next/dist/lib/metadata/types/manifest-types.d.ts`, non dedotto. Quindi
  `icon-192` e `icon-512`, ognuno una volta con `any` e una volta con `maskable`. Funziona perché il
  disegno è a tela piena col marchio centrato (§0, punto 2): la stessa immagine è giusta ritagliata e
  non ritagliata.

### §5 — iOS, e le tre cose che *non* si fanno

Nel `metadata` di `app/layout.tsx`:

```ts
appleWebApp: { capable: true, title: "Fantasta", statusBarStyle: "default" }
```

Next lo traduce in `apple-mobile-web-app-capable`, `-title` e `-status-bar-style`. Serve perché
Safari legge ancora questi meta oltre al manifest, e le due dichiarazioni insieme sono deliberatamente
ridondanti — come `proxy_buffering off` e `X-Accel-Buffering` sulla rotta dello stream.
`statusBarStyle: "default"` e non `black-translucent`: `default` lascia la barra di stato **fuori**
dalla pagina, cioè non apre il capitolo delle safe area.

**Le tre cose che non si fanno, e ognuna per una ragione sua:**

1. ⚠ **Nessun `viewport-fit=cover`.** L'applicazione ha già quattro `env(safe-area-inset-*)` con
   fallback — [portal.tsx:239](../../app/auctions/[id]/play/portal.tsx#L239),
   [bid-modal.tsx:186](../../components/auction/bid-modal.tsx#L186),
   [pick-panel.tsx:227](../../components/auction/pick-panel.tsx#L227),
   [portal-header.tsx:44](../../components/auction/portal-header.tsx#L44) — e **senza
   `viewport-fit=cover` quegli `env()` valgono 0**, quindi oggi vincono i fallback e i layout sono
   quelli che l'owner ha guardato e approvato. Accenderlo cambierebbe quattro layout, di cui due sono
   il modale d'offerta e la barra incollata del portale, per un guadagno che nessuno ha chiesto. È
   una riga da non aggiungere, e questo è il punto in cui c'è scritto perché.
2. **Nessun service worker** (decisione 1 dell'owner). Su iPhone non serve: l'installazione in
   standalone non lo richiede. Su Android costa il banner «Installa app», e resta la scorciatoia. In
   cambio non si mette una cache davanti a un'applicazione che a ogni deploy ha **due minuti** in cui
   `/_next/static/chunks/*` risponde 404 (`CLAUDE.md`, regole di produzione): un service worker che
   serve una pagina vecchia con riferimenti a chunk morti è quel guasto reso permanente, e il rimedio
   sarebbe una disinstallazione che nessuno sa fare da un telefono.
3. **Nessuna schermata di avvio iOS** (`apple-touch-startup-image`): vorrebbe un'immagine per ogni
   misura di iPhone, cioè una decina di file da mantenere perché il primo mezzo secondo sia colorato
   invece che bianco.

### §6 — Le due cose che cambiano per chi installa, e vanno dette a voce

Non sono difetti da correggere: sono **come funziona**, e stanno qui perché la sera dell'asta nessuno
le scopra da sé.

1. ⚠ **Chi installa rientra da zero.** Le web app aggiunte alla schermata home su iOS hanno un
   contenitore cookie **separato** da Safari: la sessione aperta nel browser non passa nell'app
   installata. E il giro **Google OAuth in standalone** è storicamente il punto fragile delle PWA su
   iOS — va provato su un iPhone vero, non dedotto (task M20-05). Se non regge, la via c'è già e non
   va costruita: l'accesso con **email e password** di M5.
2. **Senza barra degli indirizzi il ricarico è un pull-to-refresh.** La versione si legge ancora — la
   navbar la mostra, ed è lei il controllo a vista dopo un deploy — ma il rimedio documentato per la
   finestra cieca del deploy («si risolve con un ricarico») su un'app installata è un gesto diverso.
   Va scritto nel `CHANGELOG.md`, che è ciò che l'owner rilegge.

### §7 — Perché la verifica *dopo* il deploy non è una formalità

Questa macro introduce **due percorsi nuovi che devono rispondere da fuori** — `/manifest.webmanifest`
e le due icone di `public/` — e ha una proprietà spiacevole: se uno dei tre dà 404, **l'app non è
installabile e in locale funziona tutto**. Non c'è nessun sintomo che si veda da qui.

E il precedente esiste, in questo stesso progetto e per questo stesso motivo. Il 2026-08-18, verificando
dall'esterno che le tre icone di `v1.15.1` rispondessero, si è scoperto che **`/favicon.ico` in
produzione non arriva a Node**: nel server block generato da Ploi c'è un `location = /favicon.ico` che
nginx risolve **dal disco**, e con `output: 'standalone'` quel file sul disco non c'è.
`deploy/nginx-asta.conf` sostituisce il `location /` di Ploi, **non** il resto del suo boilerplate,
quindi quel blocco non l'avevamo mai visto.

**Cosa questo dice su M20, e cosa non dice.** Il rischio è **basso e per una ragione misurata**: quel
match è **esatto** sul percorso, non per estensione — `/qualsiasi-cosa.ico` arriva a Node senza
problemi — e sappiamo che i `.png` ci arrivano perché `app/icon.png` in produzione **risponde 200**.
Se il boilerplate di Ploi avesse un blocco per estensione sugli asset statici, quella non risponderebbe.

Ma «basso» non è «zero», il controllo costa tre secondi, e ha un modo preciso di essere letto: ⚠ **il
404 di nginx si distingue dal 404 di Next per l'intestazione `x-powered-by: Next.js`, che nel primo
non c'è.** È lo stesso ragionamento per cui `CLAUDE.md` dice che un `HTTP 200` non è una verifica di
deploy: la risposta giusta e la risposta sbagliata si somigliano, e a distinguerle è un'intestazione.

Se un giorno uno di quei percorsi venisse intercettato, il rimedio è già scritto in
`deploy/nginx-asta.conf` per il caso di `/favicon.ico`: da Ploi → il sito → Manage → Nginx
configuration si **cancella** il blocco che intercetta, così il percorso ricade nel `location /`. ⚠ E
non si aggiunge un `location` nostro accanto: due match esatti sullo stesso percorso nello stesso
server block e nginx **rifiuta di ripartire**.

---

## Task

> Da rifinire all'apertura della macro. Sono la traduzione della spec, non un impegno preso nella
> sessione in cui è stata scritta.

- [x] **M20-01** — Aprire `feature/20-marchio-e-app-installabile` da `dev`. Rileggere questo file, la
      voce `DECISIONS.md` del 2026-08-18 sull'icona (**tutta**: metà di questa spec è scritta contro
      quella) e le regole di produzione di `CLAUDE.md`. `pnpm test` verde come baseline, col numero
      annotato qui. `git add` dei due file sorgente in `fixtures/` — sono arrivati untracked, e un
      commit che li dimentica lascia una macro che non si può rigenerare
      → **Baseline: 914 test, 52 file.** I due file di `fixtures/` erano già committati in `c69784a`
      insieme alla spec, quindi quel pezzo era fatto: `git ls-files fixtures/` li vede entrambi.
      ⚠ **Il primo `pnpm test` è stato rosso, e non per un test**: 914 test verdi ma
      `tests/db/admin.test.ts` è morto nell'`afterAll`, con
      `update or delete on table "users" violates foreign key constraint "members_user_id_users_id_fk"`
      — `dropUsers` prima che i membri di quel giro fossero via. **Non riprodotto**: il file da solo
      passa (29 test), e la suite intera al secondo giro è verde tutta (914/52). Guardato il database
      dopo: il cascade su `members.auction_id` c'è (`confdeltype = c`), **zero** membri orfani, e i
      65 utenti `@test.invalid` residui sono la perdita nota di `makeGameAuction`, che non traccia i
      suoi otto utenti. Cioè: un flake di teardown fra file, **causa non identificata**, e fuori dal
      perimetro di M20 — annotato qui e non inseguito, come M18 aveva già annotato di non aggiustare
      una terza volta la stessa misura
- [x] **M20-02** — Il marchio nel nav (§1): `Logo()` in fondo a `components/nav/navbar.tsx`, il
      `<Link>` a `flex items-center gap-2`, `currentColor`, `aria-hidden`, `clipPath` buttato.
      **Guardarlo prima di fissare la misura**: portale sul telefono in LAN a 375px, pagina di accesso
      (dove la navbar è il solo logo senza sessione), dashboard. `h-5` è un punto di partenza, non un
      risultato. **Nessun `dark:`**
      → **Fatto il codice, e la misura è cambiata: `h-6`, non `h-5`.** `Logo()` in fondo a
      `navbar.tsx`, `clipPath` e `<defs>` buttati, `currentColor`, `aria-hidden`, nessun `dark:`.
      La misura è stata **guardata a 375px** — tre altezze a confronto in un banco di prova statico
      con i valori esatti dei token e il font Geist, invece di accendere l'app (in locale c'è la
      simulazione «Prova» in `LIVE`, e il tick dei bot l'avrebbe fatta proseguire da sé). Cosa si è
      visto: a `h-5` il marchio sta timido accanto a «Fantasta» in semibold, a `h-7` la domina.
      E una ragione **misurata** che non era nella spec: **24px è la `line-height` del `text-base`
      accanto**, quindi sulla pagina di accesso la barra resta alta 45px come prima; `h-7` la
      porterebbe a 49, cioè il marchio si pagherebbe con l'altezza di ogni pagina.
      → ⚠ **Trovato quello che la spec dava per gratis.** §1 dice «a 375px a sinistra c'era solo il
      titolo, e quindici pixel ci stanno»: ci stanno, ma **li paga il nome dell'utente**, perché è lui
      l'unico elemento con `min-w-0 truncate`. Misurato: la riga non va mai a capo (`nav.scrollWidth`
      = 375 in ogni caso), ma il nome sulla dashboard di un amministratore passa da **61px a 35**, e
      nel portale — senza il pulsante Admin — un nome lungo passa da **intero a troncato** (134px →
      115). `h-5` ne restituirebbe tre pixel, cioè non cambierebbe quel caso: la scelta è fra il
      marchio e il nome intero, non fra due altezze. **La verifica 3 della spec va letta così**: non
      va a capo, sì; «non tronca il nome più di prima» **è falso**, e il numero è 23–26px.
      → **La guardata sul telefono in LAN è stata fatta insieme a M20-05**, dall'owner, e il marchio
      nel nav va bene com'è: `h-6` resta. Nessuna misura ritoccata dopo il telefono
- [x] **M20-03** — Le icone (§2): riscrivere `scripts/genera-icone.py`, dargli a mano, committare i
      cinque file, cancellare `fixtures/favicon-512.png`. Guardare le rese ingrandite **prima** di
      committarle, come si fece a `v1.15.1`, e riletto il `.ico` per controllo che le tre misure ci
      siano davvero
      → **Fatto, cinque file.** `app/favicon.ico` (riletto: `[(16,16), (32,32), (48,48)]`, le tre
      misure ci sono), `app/icon.png` 512, `app/apple-icon.png` 180, `public/icon-192.png`,
      `public/icon-512.png`. I due 512 hanno **gli stessi byte** (sha256 identico, verificato).
      `fixtures/favicon-512.png` cancellato con `git rm`.
      → **I numeri della spec su `logo.png` sono confermati misurandoli di nuovo**: 1080×1080, alpha
      `(255, 255)` cioè opaco su tutta l'immagine, bianco dal 33 al 67% in orizzontale e dal 27 al 73
      in verticale. Quindi l'appiattimento di iOS è davvero sparito: `apple_icon()` è una riduzione e
      un `convert("RGB")`.
      → **Guardate le rese ingrandite, e dicono quello che la spec prevedeva**: a 48 il marchio è
      netto, a 32 è leggibile, a 16 è un campo di colore col bianco che diventa una macchia — accettato
      in §0. Guardato anche il **ritaglio circolare di Android** simulato all'80%: il marchio non
      viene sfiorato, come diceva il conto del 28,6% contro il 40%. ⚠ È una **simulazione**, non un
      dispositivo: la verifica 11 resta **non verificata** finché un Android vero non c'è.
      → ⚠ **Una cosa in più, non prevista dalla spec, con i numeri accanto**: i PNG escono in **RGB e
      non RGBA**. L'alpha della sorgente è 255 su tutta l'immagine, cioè un canale che non porta
      informazione, e portarselo dietro costava **89 KB** — il 512 passa da 510 a 431 KB, il 192 da 60
      a 48. Restano file grossi (452 KB il 512 su disco) e la ragione va saputa prima di sospettare un
      errore: la **grana** del gradiente è rumore, ed è esattamente ciò che un compressore senza
      perdita non può togliere. Se 452 KB per l'icona che il telefono scarica all'installazione sono
      troppi, la strada è una sorgente meno granulosa, non un'opzione dello script
- [x] **M20-04** — Il manifest e iOS (§3, §4, §5): `public/` con le due icone e il commento sul
      perché i nomi sono quelli, `app/manifest.ts` con le quattro voci, `appleWebApp` nel layout. Più
      `tests/manifest.test.ts`: i campi che contano, le quattro voci di icona, e che i due file
      dichiarati **esistano su disco** — costa poco e prende un rinomino, che è il modo esatto in cui
      questa macro può rompersi in silenzio. In locale: `/manifest.webmanifest` risponde JSON valido e
      il `<link rel="manifest">` è nella pagina
      → **Fatto tutto, e provato con l'app accesa.** `public/README.md` accanto alle due icone (il
      perché dei nomi, e che si rigenerano dallo script); `app/manifest.ts` con le quattro voci;
      `appleWebApp` nel `metadata` del layout, più il perché di **nessun `viewport-fit=cover`**
      scritto sopra `viewport`, che è il punto in cui verrà proposto.
      → **`tests/manifest.test.ts`, 3 test, e il terzo è provato al contrario**: rinominato
      `public/icon-192.png` in `icon.png` — cioè esattamente l'errore «per pulizia» — il test **fallisce**
      con il messaggio giusto. Rinominato indietro subito.
      → **Come è stata fatta la prova locale senza toccare niente dell'owner**: in locale c'è la
      simulazione «Prova» in `LIVE/WAITING_PICK`, e accendere l'app avrebbe fatto partire il tick dei
      bot su quell'asta. Quindi il dev server è girato su un database **usa-e-getta** (`asta_m20`,
      creato, `db:push`, e cancellato alla fine) sulla porta 3001. Riletta dopo: «Prova» è ancora
      `LIVE/WAITING_PICK`.
      → **Cosa ha risposto**: `/manifest.webmanifest` → `200` con
      `content-type: application/manifest+json`, JSON valido, quattro voci di icona, `display:
      standalone`, e **senza sessione**; `/icon-192.png` e `/icon-512.png` → `200 image/png`; le tre
      icone di `app/` → `200`. Nella pagina di accesso ci sono `<link rel="manifest">` e i meta di
      Apple. Confermato anche il `sizes="16x16"` sul `.ico` che §2 dice di non «aggiustare».
      → ⚠ **Trovato un errore nella spec, e va saputo prima di M20-05.** §5 dice che Next traduce
      `appleWebApp.capable` in `apple-mobile-web-app-capable`. **Non è così**: Next 15.5.23 emette
      **`mobile-web-app-capable`** (letto in `next/dist/lib/metadata/generate/basic.js`, riga 263, e
      visto nella pagina servita). Gli altri due meta sono quelli previsti,
      `apple-mobile-web-app-title` e `-status-bar-style`. Il nome legacy con il prefisso `apple-`
      **non c'è**, e nessuno lo può aggiungere passando da `appleWebApp`. Cosa significa: su iOS
      moderno lo standalone lo decide `display: standalone` del manifest, quindi *dovrebbe* bastare —
      ma «dovrebbe» è precisamente ciò che M20-05 esiste per non dire. **Nessun rimedio inventato
      qui**: se sull'iPhone l'app non si apre senza barra degli indirizzi, il primo tentativo è quel
      meta legacy scritto a mano in `metadata.other`, e sarà una riga con una prova dietro
- [x] **M20-05** — **Provare l'installazione su un iPhone vero**, con `pnpm dev:lan`. Aggiungi alla
      schermata home → l'icona è il marchio (non uno screenshot della pagina), il nome è «Fantasta»,
      si apre **senza barra degli indirizzi**, e **si entra**: prima con email e password, poi con
      Google (§6, punto 1). ⚠ Se il giro Google non torna dentro l'app, non si inventa un rimedio: si
      annota qui cosa fa, e la nota di §6 diventa una riga del `CHANGELOG.md`. Guardare anche il
      modale d'offerta in standalone, che è il posto dove le safe area si vedrebbero (§5, punto 1)
      → **Provato dall'owner sul suo iPhone, con `pnpm dev:lan` sul database vero, e funziona tutto**
      — icona, nome, apertura senza barra degli indirizzi, accesso, e il modale d'offerta. ⚠ **Il
      punto che questo task esisteva per sciogliere si è sciolto: il giro Google torna dentro l'app
      installata**, quindi la strada alternativa di M5 resta una strada e non un rimedio necessario.
      L'esito è **riportato dall'owner**, non misurato da qui: la sessione era la sua, sul suo
      telefono.
      → Da segnare anche perché è una **buona notizia inattesa**: la prova è passata su **HTTP** in
      LAN, non su HTTPS. Prima di darla all'owner era stato detto il contrario — che uno standalone
      mancato sulla LAN sarebbe stato ambiguo, perché l'installazione guidata dal manifest chiede
      normalmente un contesto sicuro. Non c'è stato bisogno di distinguere: ha funzionato lì. E
      `mobile-web-app-capable` al posto del nome legacy con prefisso `apple-` (vedi M20-04) **non ha
      impedito niente**, che era il dubbio vero. Nessun meta aggiunto a mano
- [x] **M20-06** — Gate: `pnpm test`, `pnpm typecheck`, `pnpm build` verdi (⚠ build con dev server
      spento, e `lsof -nP -iTCP -sTCP:LISTEN | grep node` prima; la prima build dopo una sessione di
      `pnpm dev` può morire da sola e passare identica al secondo giro). Documentazione:
      `DECISIONS.md` col **ribaltamento datato** della voce 2026-08-18 e le quattro decisioni del
      2026-08-27; `ARCHITECTURE.md`; `CHANGELOG.md` con le due cose di §6 scritte per l'owner;
      `features/README.md`
      → **Gate verde al primo giro**, con `lsof` dato prima e nessun dev server acceso: `pnpm test`
      **917 test, 53 file** (baseline 914 + i tre del manifest), `pnpm typecheck` muto, `pnpm build`
      pulita — e nell'elenco delle rotte c'è `○ /manifest.webmanifest`, cioè è compilata **statica**.
      Nessun `dark:` nel codice nuovo, `lib/db/schema.ts` non toccato (`git diff --stat` sul branch).
      → **Documentazione fatta**: `DECISIONS.md` con la voce del 2026-08-27 (il ribaltamento datato, le
      quattro decisioni, e le quattro cose trovate lavorando); `ARCHITECTURE.md` con il marchio dentro
      il capitolo della navbar e una sezione nuova, «L'app che si installa sul telefono»;
      `features/README.md` con M20 passata a «in corso» e dove è arrivata.
      → ⚠ **Il `CHANGELOG.md` e il numero di versione restano da scrivere, ed è di proposito**: §6
      punto 1 dice che l'esito del giro Google **diventa una riga del changelog**, e quell'esito lo sa
      solo M20-05. Scriverlo prima vorrebbe dire scrivere una promessa. Il rito lo mette comunque su
      `dev` dopo il merge della feature, quindi l'ordine torna: iPhone → changelog e `1.20.0` → `main`
- [x] **M20-07** — **Dopo il deploy**, e non è una formalità (§7): la versione dalla navbar, poi
      `curl -I` sul manifest e su **entrambe** le icone di `public/`, guardando `x-powered-by:
      Next.js`. Se un'icona dà 404 l'app non è installabile, e il 404 di nginx si riconosce proprio da
      quell'intestazione **mancante**
      → **Fatto, e i tre percorsi nuovi rispondono.** Push su `main` alle **16:02:54 UTC**, la navbar
      è passata a `1.20.0` fra le **16:05:03 e le 16:05:23** — due minuti e mezzo, cioè la finestra
      solita. Poi: `/manifest.webmanifest` → `200 application/manifest+json`, JSON valido, `display:
      standalone`, quattro voci di icona, **senza sessione**; `/icon-192.png` e `/icon-512.png` → `200
      image/png`. Nella pagina servita ci sono il `<link rel="manifest">` e i tre meta.
      → **E una prova più forte di un `200`**, nello spirito della regola per cui un `HTTP 200` non
      verifica un deploy: scaricate le due icone e confrontato lo **sha256** con i file locali —
      **identici** entrambi. Non è solo «qualcuno risponde a quel percorso»: è che risponde con i
      nostri byte.
      → ⚠ **§7 sbagliava il metodo, e va corretto qui perché la prossima volta manderebbe fuori
      strada.** Diceva di distinguere il 404 di nginx dal 404 di Next per l'intestazione `x-powered-by:
      Next.js`. In produzione quell'intestazione **non c'è su nessuna risposta `200`** — nemmeno su
      `/icon.png` e `/apple-icon.png`, che sono rotte generate da Next e che nginx non può servire dal
      disco. Quindi la sua assenza su un `200` non significa niente. Vale invece sui **404**, ed è
      verificato in entrambe le direzioni: `/non-esiste-m20.png` → `404` **con** `x-powered-by`, cioè i
      `.png` arrivano a Node; `/favicon.ico` → `404` **senza**, 146 byte, che è esattamente il 404 di
      nginx descritto nella voce del 2026-08-18. **La regola giusta è: l'intestazione distingue chi
      risponde a un 404, non chi risponde a un 200** — e a un `200` si chiede il contenuto, non
      l'intestazione.
      → `/favicon.ico` è ancora intercettato da nginx, come nel 2026-08-18: **preesistente, deciso di
      lasciarlo**, e questa macro non lo tocca. Confermato che il match è esatto sul percorso e non per
      estensione, altrimenti le due icone nuove non sarebbero arrivate.
      → ⚠ **Una conseguenza da sapere: `public/README.md` è servito** (`/README.md` → `200
      text/markdown`), come la nota nel file stesso dichiarava. È documentazione, non c'è niente da
      proteggere; se l'owner preferisce non averlo su un URL pubblico, la nota si sposta dentro
      `app/manifest.ts` e nello script, e si perde solo il fatto che stia *accanto* ai file

## Verifica

1. `pnpm test`, `pnpm typecheck` e `pnpm build` verdi.
2. **Il marchio è nella navbar, a sinistra di «Fantasta»**, su dashboard, portale e pagina di
   accesso — e **non** sulla vista TV.
3. **A 375px la navbar non va a capo** e non tronca il nome dell'utente più di prima.
4. **Il marchio è nero come il testo accanto** (è `currentColor`, non un nero scritto a mano).
5. **La linguetta del browser mostra il gradiente**, non il cerchio blu e non il quadratino di
   Next.js. ⚠ Le icone sono la cosa che i browser tengono in cache più a lungo: se si vede la
   vecchia, `Cmd+Shift+R` o chiudere e riaprire la linguetta — e sul telefono rimuovere e
   riaggiungere il collegamento.
6. **`/manifest.webmanifest` risponde** JSON valido, con quattro voci di icona e `display:
   standalone`, **senza sessione** (in una finestra anonima).
7. **`/icon-192.png` e `/icon-512.png` rispondono 200** con `content-type: image/png`.
8. **Da iPhone: «Aggiungi alla schermata Home»** mette il marchio, il nome «Fantasta», e l'app si
   apre **senza barra degli indirizzi**.
9. **Dentro l'app installata si entra**, con email e password. Il giro Google è provato e il suo
   esito è **scritto** in M20-05, qualunque sia.
10. **Il modale d'offerta in standalone non finisce sotto la barra home** dell'iPhone.
11. **Su Android l'icona è ritagliata dal sistema senza tagliare il marchio** (è la prova del
    `maskable`). Se un dispositivo Android non c'è, si dichiara non verificato invece di dedurlo.
12. **`fixtures/logo.svg` e `fixtures/logo.png` sono committati** e `fixtures/favicon-512.png` non
    c'è più.
13. **Nessun service worker** in giro: nessun file, nessuna registrazione, e in
    `chrome://serviceworker-internals` niente per questo dominio.
14. **Niente `dark:` nel codice nuovo**, e la TV resta bianco su nero com'era.
15. **Nessun `pnpm db:push`, nessun backfill**: verificato sul diff `origin/main..dev`, non dedotto —
    `lib/db/schema.ts` non è toccato.
