# M5 — Identità: registrazione con email e password

> **Stato:** in corso · **Aperta il** 2026-08-10
> **Tocca lo schema del database?** **Sì**, e non solo in modo additivo: due colonne nuove con
> default, una tabella nuova, **un `UNIQUE` parziale** e — la parte che non si vede — **un backfill**
> senza il quale il giorno del deploy tutti gli utenti esistenti finiscono davanti a una schermata
> che chiede un codice. La procedura completa è in §10.
>
> **Invarianti coinvolti:** **nessuno di I1–I10.** Non è una distrazione, è il perimetro: questa
> macro non tocca il motore, la macchina a stati, lo snapshot né una sola rotta di gioco. Se un
> giorno un task di M5 sfiora `lib/engine/machine.ts` o `serializeSnapshot`, quel task è fuori posto.
> **Regole coinvolte:** 2 (per analogia — il tempo è un parametro), 6 (la UI disabilita, il server
> rifiuta), 8 (niente astrazioni prima del secondo chiamante).
>
> ⚠ **Questa macro contraddice `docs/PLAN.md` §2 di proposito.** Vedi §1.

## Obiettivo

Oggi si entra solo con Google. Funziona, ed è stata la scelta giusta per arrivare in produzione:
zero password da conservare, zero email da mandare, zero recuperi da progettare. Ma pretende che
ogni partecipante abbia un account Google e che sia disposto a usarlo qui — e la sera dell'asta la
persona che non ce l'ha, o che non vuole collegarlo, non è un caso di studio: è un amico in piedi
accanto alla TV che non riesce a entrare.

Questa macro apre la seconda strada: **email e password**, con l'indirizzo verificato da un codice
prima di poter fare qualunque altra cosa. E poiché una password è una cosa che si dimentica, apre
anche il recupero — non come extra, ma perché l'alternativa al recupero è una `UPDATE` a mano sul
server mentre dodici persone aspettano.

Il grosso del lavoro, però, non è la registrazione. È **tenere una persona su una riga sola**. Nel
momento in cui esistono due modi di entrare, la stessa persona può presentarsi da due porte con lo
stesso indirizzo, e un'applicazione che glielo consente si ritrova due utenti, due dashboard e
un'asta appesa a quello sbagliato. §2 esiste per questo, ed è la sezione da leggere due volte.

## Richieste che ci confluiscono

Tolta da `docs/REQUESTS.md` il 2026-08-10, insieme a quella di M6 — il quaderno resta vuoto.

- **Registrazione con email.** «Voglio implementare la possibilità di registrarsi con email e
  password. Voglio un processo di registrazione e login semplice. Voglio che durante la registrazione
  venga inserito il controllo della email (inviamo una email con codice) da inserire nello step
  successivo. Se corretto verifica la email e permette il login.»

Il quaderno non parlava di «password dimenticata», e in fase di spec è stata **aggiunta di comune
accordo**: la macchina dei codici la costruiamo comunque per la verifica, quindi il recupero costa
una colonna, una rotta e un form — mentre non averlo costa una sessione SSH nel momento peggiore.
Effetto collaterale gradito: la colonna `purpose` nasce con **due** valori invece di uno, e non è
quindi un'astrazione prima del secondo chiamante.

Non entra nulla che riguardi il pannello di amministrazione: è M6.

---

## Spec

### 1. Perché ci si discosta da PLAN §2

`docs/PLAN.md` §2 dice, testualmente: «Login unicamente con **Google OAuth**. Nessuna password,
nessun invio email.» Questa macro fa esattamente le tre cose che quella riga esclude.

È legittimo — `PLAN.md` è **archivio**, e ciò che resta vincolante per sempre sono i suoi invarianti
I1–I10, nessuno dei quali viene sfiorato qui — ma non è indolore, e va scritto perché fra sei mesi
la differenza fra «ci siamo discostati con cognizione» e «qualcuno non aveva letto» non si ricostruisce.
Va in `docs/DECISIONS.md` con la data.

Quello che §2 aveva ragione a temere resta vero e resta rispettato: una password è un segreto da
custodire, e un invio email è una dipendenza esterna. La prima la custodiamo con `crypto.scrypt`
(§5) e non la vediamo mai in chiaro fuori dalla richiesta che la porta; la seconda è SMTP e nulla
più (§7), sostituibile cambiando quattro variabili in `.env`.

### 2. Le due strade d'ingresso, e l'aggancio asimmetrico

**Una persona, una riga in `users`.** Non è un obiettivo di pulizia: è la differenza fra «la mia
asta è nella dashboard» e «la mia asta non c'è più».

Oggi il meccanismo che lo rompe è visibile a occhio in `upsertGoogleUser`: l'`onConflictDoUpdate` è
su `google_sub`, quindi se Mario si è registrato con `mario@gmail.com` e una password, e poi clicca
«Entra con Google» con l'account Google che ha quello stesso indirizzo, **nessuna riga ha quel
`google_sub` e Postgres inserisce una riga nuova**. Mario si ritrova senza nome, davanti
all'onboarding, con una dashboard vuota. Non è un caso limite: è quello che succede la prima volta.

**L'email diventa la chiave d'identità.** `UNIQUE` su `lower(email)`, parziale su
`email IS NOT NULL` — così le righe senza email (i bot, gli utenti del seed) restano legali.
Normalizzazione: `trim` e `lower`, e nient'altro. Niente punti di Gmail, niente `+tag`: sono
convenzioni di un provider, e indovinarle vorrebbe dire trattare due indirizzi diversi come lo
stesso.

⚠ Il vincolo è a **database**, non nel codice. È la stessa logica degli indici parziali di I1 e I2:
se una regola si può rendere *impossibile* invece che sorvegliata, si rende impossibile. Il giorno
in cui sbaglio una `if`, Postgres rifiuta comunque.

**Il login Google cerca per `google_sub`, poi per email, e si aggancia.** Se trova una riga con
quell'indirizzo le scrive dentro il `google_sub` invece di crearne una seconda. L'aggancio è lecito
perché Google asserisce `email_verified`: se è vero, quella persona controlla quella casella, che è
esattamente la prova che darebbe il nostro codice.

**Google senza email verificata non entra.** `email_verified: false`, o email assente dal profilo,
significa che non possiamo agganciare per email; e agganciare su un'asserzione debole vale meno che
chiudere la porta. Rifiuto con messaggio esplicito.

**L'email non si riscrive più a ogni login Google.** Oggi `upsertGoogleUser` la aggiorna ogni volta.
Con il `UNIQUE` addosso, il giorno in cui un account Google cambia indirizzo verso uno già preso da
un'altra riga quell'`UPDATE` fallisce e **il login diventa un 500 senza spiegazione**. L'email si
scrive alla creazione e all'aggancio, poi si lascia stare.

**L'aggancio è asimmetrico, e la direzione conta:**

| Da | A | |
|---|---|---|
| email+password | Google | **Sì.** Si aggancia il `google_sub` alla riga esistente. Da quel momento due strade, un account. |
| Google | email+password | **No.** `/signup` su un indirizzo che ha già un `google_sub` risponde «questo indirizzo è già registrato con Google, entra da lì». |

Il rifiuto nella seconda direzione tiene vera una frase semplice — *un account nato da Google entra
da Google* — e ci risparmia per sempre la domanda «cosa succede se cambio la password di un account
Google». Aggiungere una password a un account Google esistente sarebbe un reset travestito: se un
giorno lo vogliamo, lo vogliamo dichiarato.

#### ⚠ La regola che chiude un furto d'account

Aprire la prima direzione, da sola, aprirebbe questo:

1. Un malintenzionato scrive **il tuo** indirizzo su `/signup` con una password sua.
2. Non inserisce il codice — non gli arriva, non gli serve. La riga esiste, non verificata, col suo
   hash dentro.
3. Tu entri da Google con quell'indirizzo. Noi ti agganciamo a quella riga.
4. Da quel momento **lui ha la tua password**: ha fatto la parte facile e ha lasciato a te quella
   difficile.

La regola che lo chiude: **un aggancio Google su una riga non verificata azzera `password_hash`** (e
consuma i codici vivi). Chi entra da Google ha dimostrato di avere la casella; quella password l'ha
scritta qualcuno che non ha dimostrato niente, quindi non ha nessuna pretesa. Se l'avevi messa tu
non perdi nulla che non puoi rifare — da quel momento entri da Google, e puoi rimetterla dal
recupero. Se invece la riga **era già verificata**, la password resta: le due prove ci sono
entrambe, e restano entrambe le strade.

Questa è la regola più importante della macro, ed è la meno ovvia rileggendo il codice. Ha un test
suo, e nel codice ha un commento che spiega l'attacco — non la regola, l'attacco: una regola senza
il suo attacco accanto è una riga che il prossimo semplifica.

### 3. La scala di `requireUser()`

`requireUser()` fa già due gradini: nessuna sessione → `/signin`, nessun `display_name` →
`/onboarding`. Ne guadagna un terzo, **in mezzo**:

```
sessione?  no → /signin
verificato? no → /verify
ha un nome? no → /onboarding
                 → la pagina
```

Tre ragioni per cui la verifica è un gradino della scala e non un flusso a parte con un token suo.
La prima: **una sessione esiste già**, quindi il reinvio del codice è una server action autenticata
invece di una rotta pubblica da proteggere a mano, e il rate limit è per utente perché *c'è* un
utente. La seconda: è la forma che l'app ha già, e una scala con tre gradini si legge in una
funzione sola. La terza: **la verifica viene prima dell'onboarding** di proposito — non si raccoglie
il nome di qualcuno per un indirizzo che potrebbe non esistere.

Conseguenza sul form di registrazione: chiede **solo email e password**. Il nome continua a
scriversi nell'unico posto in cui si scrive oggi.

⚠ **Accesso rigido**: non verificato non fa nulla. Non crea aste, non entra in un'asta su invito,
non gioca. È una scelta consapevole e ha un prezzo dichiarato — vedi §9, «la finestra senza rimedio».

⚠ Task collegato: **la scala vale solo per chi ci passa.** Va verificato che nessuna pagina usi
`currentUser()` scavalcando `requireUser()`. Il sospetto è `/join/[token]`.

### 4. Il codice, e il recupero della password

Una tabella sola per due scopi:

```
email_codes
  id           uuid pk
  user_id      uuid not null → users(id) on delete cascade
  purpose      text not null   -- 'VERIFY_EMAIL' | 'RESET_PASSWORD'
  code_hash    text not null
  expires_at   timestamptz not null
  attempts     integer not null default 0
  consumed_at  timestamptz
  created_at   timestamptz not null default now()
```

I due valori di `purpose` stanno in `lib/domain.ts` come tutto il resto del vocabolario, non nello
schema: è la regola in testa a quel file.

**Sei cifre, hashate con sha256.** E qui va detta la verità nel commento, altrimenti qualcuno
confonderà l'hash con una difesa: con sei cifre l'entropia è un milione, quindi chi ha il database
rompe l'hash in un secondo. Non serve a quello. Serve a **non lasciare credenziali vive dentro un
`pg_dump`**, in una riga di log, in uno screenshot di una tabella. Le difese vere sono le quattro
righe seguenti.

| Difesa | Valore | Perché |
|---|---|---|
| Scadenza | **15 minuti** | Dieci sono tirati se la posta arriva lenta, trenta sono generosi per un segreto da sei cifre. Il numero finisce anche nel testo dell'email. |
| Tentativi | **5, poi il codice è bruciato** | È *questa* la sicurezza dello schema: con cinque prove per codice, indovinarne uno su un milione non si fa. |
| Un solo codice vivo per `(user_id, purpose)` | chiederne uno nuovo consuma il precedente | Venti reinvii non devono diventare venti chiavi valide, né lasciare la persona a chiedersi quale delle venti email sia quella giusta. |
| Reinvio | **60 secondi** fra due invii | Non trasformare il server in un cannone di posta puntato sull'indirizzo di qualcuno, e non bruciare la quota MailerSend. |

⚠ Il limite sul reinvio si legge dal `created_at` dell'ultima riga: **è un rate limit che vive nel
database**, quindi sopravvive a un riavvio del processo e non ha bisogno del limitatore in memoria
di §6. Alcuni limiti sono gratis perché il fatto è già registrato.

**Scaduto non è mai un vicolo cieco.** La schermata dice «scaduto» e ha il pulsante per farsene
mandare un altro. Stesso principio dell'invio fallito di §7: l'account non verificato resta lì, non
si perde niente, e chi ha già scritto la password non deve riscriverla.

**Le decisioni pure stanno in `lib/engine/account-rules.ts` e ricevono `now` come parametro.**
Scaduto? Troppi tentativi? Può reinviare? Sono funzioni senza database e senza `Date.now()` dentro,
sul modello di `lib/engine/setup-rules.ts` che esiste già — è la regola 2 applicata per analogia, e
serve a poterle collaudare con i fake timer invece che con un `sleep`.

#### Il recupero della password

Stessa macchina, `purpose = 'RESET_PASSWORD'`, e **un codice, non un link**: niente token negli URL
da farsi inoltrare per sbaglio, e una schermata in meno da scrivere.

`/forgot` chiede l'indirizzo, `/reset` chiede codice e password nuova. Due vincoli:

- **Funziona solo se `password_hash` esiste già.** Un account di solo Google che chiede «password
  dimenticata» non se la vede creare dal nulla: sarebbe la direzione Google → password di §2 per
  un'altra strada. Messaggio esplicito: «questo account entra con Google».
- ⚠ **Il flusso è non autenticato**, al contrario di `/verify`: chi lo usa è per definizione fuori.
  Quindi il codice si cerca per *(email, purpose)* e le difese non possono appoggiarsi a una
  sessione — i cinque tentativi della tabella valgono comunque, e sopra ci va il limite per IP di §6.

⚠ **Un limite noto, da scrivere in `DECISIONS.md` invece di scoprirlo:** un reset **non invalida le
sessioni già aperte altrove**, perché le sessioni sono JWT e non righe a database (P17). Revocarle
vorrebbe dire una colonna `sessions_valid_from` e un controllo nel callback `jwt` — complessità
reale per una minaccia che, con dodici amici e il dato «chi ha pagato Lautaro 180», non la giustifica.

#### Sull'enumerazione degli account: scelta esplicita

**Non ci difendiamo.** Diciamo «questo indirizzo è già registrato con Google», che è utile, e non
aggiungiamo ritardi finti per pareggiare i tempi di risposta fra un indirizzo esistente e uno no.
Va in `DECISIONS.md` come decisione, così fra sei mesi non sembra una dimenticanza.

### 5. La password: `crypto.scrypt`

`lib/engine/password.ts`. **Niente dipendenze nuove**: `crypto.scrypt` sta nella libreria standard
di Node.

La ragione per cui non è `bcryptjs` è il processo unico. `bcryptjs` è JavaScript puro: mezzo secondo
di CPU per hash, che l'event loop si mangia a fette. `crypto.scrypt` è nativo e **asincrono** — gira
sul threadpool di libuv, quindi non blocca il loop. In un'app che tiene aperti dodici stream SSE
mentre scorre un countdown, mezzo secondo di loop bloccato è mezzo secondo in cui nessuno riceve uno
snapshot.

Parametri: **N=2^15, r=8, p=1**, `maxmem` alzato di conseguenza (~32 MB per hash, circa un decimo di
secondo su una CX22). N=2^16 sarebbe più robusto e costerebbe 64 MB per hash concorrente: con il
rate limit di §6 davanti, 2^15 è la misura giusta per una macchina da 2 vCPU e 4 GB.

Salt da 16 byte da `crypto.randomBytes`, formato `scrypt$N$r$p$salt$hash` in una colonna `text` —
così i parametri viaggiano col valore e alzarli domani non invalida gli hash di ieri. Confronto con
`crypto.timingSafeEqual`, mai con `===`.

**Politica della password: minimo 10 caratteri, massimo 200, nessuna regola di composizione.** È la
raccomandazione corrente (la lunghezza vale più dei simboli obbligatori) ed è una cosa in meno
contro cui combattere alle 21:00. Il massimo serve solo a limitare l'input dato a scrypt.

### 6. Il rate limit, in processo

`lib/rate-limit.ts`. Una `Map` **su `globalThis`**, come ogni singleton di processo in questo
progetto — non in una variabile di modulo: Next compila `instrumentation.ts` e i route handler in
bundle separati, ed è così che in passato registro SSE e hook di broadcast si sono trovati in due
mondi diversi.

⚠ **Il vincolo che rende semplice tutto il resto rende esatto anche questo.** Con `exec_mode: "fork"`
e `instances: 1` esiste un processo solo, quindi una `Map` in memoria è un contatore **globale e
corretto**, non un'approssimazione per nodo. Niente Redis, e non perché ce lo vietiamo: perché non
servirebbe a nulla.

Copre **due cose sole**:

- **Login** — dieci tentativi falliti per email in quindici minuti, azzerati al successo; più un
  tetto per IP, che è ciò che ferma chi spara su molti indirizzi diversi.
- **Registrazione** — pochi account per IP all'ora.

Verifica del codice e reinvio **non passano da qui**: cinque tentativi e sessanta secondi sono già
righe nella tabella (§4).

Due dettagli che mordono se saltati. **Dietro nginx l'IP vero sta in `X-Forwarded-For`**, e va
verificato che il nostro nginx lo imposti: se non lo fa, il limite per IP è un limite su un IP solo,
cioè un limite globale mascherato — ed è un task, non un'assunzione. E **una `Map` che non sfratta
nessuno è una perdita lenta** in un processo che gira per mesi: scadenza pigra al tocco più un tetto
sul numero di chiavi. Nessun timer, niente da schedulare.

### 7. L'invio delle email

`lib/mail.ts` — **non importa `lib/db`**, quindi non ha bisogno di stare in `lib/engine`.
`nodemailer` sopra l'SMTP di MailerSend, che l'owner usa già.

```
SMTP_HOST  SMTP_PORT  SMTP_USER  SMTP_PASS  MAIL_FROM
```

SMTP generico e non l'SDK del provider: cambiare fornitore è cambiare quattro variabili in `.env`,
non una riga di codice. `nodemailer` non è nulla di ciò che lo stack vieta — non è una coda, non è
un worker, non è un servizio di scheduling — ma è comunque una dipendenza esterna nuova, quindi va
in `DECISIONS.md`. **Timeout di dieci secondi**: è una chiamata di rete dentro una richiesta, in un
processo solo.

⚠ **Dopo aver toccato `.env` in produzione** serve `pm2 reload deploy/ecosystem.config.cjs
--update-env`, **non** `pm2 restart asta`.

**Fuori produzione non si configura nessun trasporto: il codice va su stdout.** È la stessa forma
del provider `dev` e della riga di `DELETE_AUCTION` — l'intero flusso si collauda in locale senza
credenziali SMTP, e in produzione non esiste nessun modo di leggere un codice che non sia la casella
di posta.

**L'ordine è: si crea l'utente, poi si prova a mandare.** Un invio fallito lascia un account
esistente e non verificato, e la schermata successiva è quella di sempre — «inserisci il codice» col
pulsante per rimandarlo. Un errore di rete non deve mai perdere una registrazione, né bruciare un
indirizzo, né far riscrivere la password a chi l'aveva già scritta. Il codice non compare mai nella
risposta HTTP.

### 8. Il test dei provider — aggiornato, non indebolito

`tests/auth-providers.test.ts` asserisce che in produzione la lista sia **esattamente**
`["google"]`. Aggiungere il provider `email` la fa diventare `["google", "email"]`: quel test
**cambia valore atteso**, e va fatto con attenzione perché è uno dei presidi del progetto.

Cosa resta identico: l'asserzione è ancora un'**uguaglianza esatta** — quindi un provider aggiunto
per sbaglio domani la fa fallire ancora — e il test «in produzione NON pubblica `dev`» non si tocca.
Ciò che il file proteggeva è protetto come prima; cambia solo quanti provider legittimi esistono.

**Il filtro del provider `dev` non si tocca.** Selezionare «chi ha `google_sub` nullo» cattura anche
gli utenti registrati con email, ma è irrilevante: quel provider in produzione non esiste, e in
locale vedere il proprio account di prova nella lista è comodo.

### 9. Il seed, la prova in locale, e la finestra senza rimedio

**Il seed deve scrivere `email_verified_at`.** I dodici utenti di prova non hanno `google_sub` né
password: nascerebbero non verificati, e il provider `dev` li lascerebbe tutti fermi su `/verify` —
la prova in locale si rompe al primo login. Il seed scrive anche **una password nota** per tutti, così
la strada email+password si collauda in locale senza posta. `docs/HOWTO-PROVA-LOCALE.md` si aggiorna.

⚠ **La finestra senza rimedio.** Fra M5 in produzione e M6 non esiste il pulsante «verifica a mano»:
se a un amico l'email non arriva, l'unico rimedio è una `UPDATE` sul server. Non la aggiro e non la
nascondo — la metto qui scritta per esteso, così alle 21:00 si copia invece di comporla sotto
pressione, e M6 la sostituisce con un pulsante:

```sql
UPDATE users SET email_verified_at = now() WHERE lower(email) = lower('...');
```

### 10. Lo schema, e la procedura in produzione

```
users  + password_hash      text
       + email_verified_at  timestamptz
       + UNIQUE parziale su lower(email) where email is not null

email_codes  (nuova, vedi §4)
```

⚠ **Prima del push**, perché il `UNIQUE` non distrugge niente ma **può far fallire il comando**:

```sql
SELECT lower(email), count(*) FROM users
WHERE email IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
```

Nessuna colonna sparisce e nessun tipo cambia, quindi **niente `pg_dump` preventivo obbligatorio** —
ma questa macro tocca il login, e un backup prima costa trenta secondi (`deploy/db-backup.sh`).

Sul server, a deploy finito, con nessuna asta `LIVE` o `PAUSED`:

```bash
cd /home/ploi/fantasta.rggndr.it && pnpm db:push
psql -c "UPDATE users SET email_verified_at = created_at WHERE google_sub IS NOT NULL"
pm2 reload deploy/ecosystem.config.cjs --update-env
```

⚠ **Il backfill non è opzionale, e `pnpm db:push` non lo fa.** In produzione ogni account è entrato
da Google e nessuno ha `email_verified_at`: senza quella `UPDATE`, al primo caricamento **tutti gli
utenti esistenti finiscono sulla schermata del codice**, owner compreso. Da lì uscirebbero — il
codice arriva davvero — ma è un incidente evitabile con una riga.

### 11. Dove vive il codice

| File | Cosa | Note |
|---|---|---|
| `lib/engine/accounts.ts` | registrazione, verifica, reset, aggancio Google | tocca `lib/db`, quindi **deve** stare in `lib/engine`: è la regola ESLint, e non si aggiungono eccezioni |
| `lib/engine/account-rules.ts` | le decisioni pure, con `now` come parametro | zero dipendenze, come `setup-rules.ts` |
| `lib/engine/password.ts` | `hashPassword` / `verifyPassword` su scrypt | |
| `lib/rate-limit.ts` | la `Map` su `globalThis` | non tocca il database |
| `lib/mail.ts` | `nodemailer`, e stdout fuori produzione | non tocca il database |
| `lib/domain.ts` | i due valori di `purpose` | il vocabolario sta qui, non nello schema |
| `lib/auth.ts` | il provider `email`, l'aggancio, la scala di `requireUser()` | è già fra le eccezioni enumerate della regola ESLint |
| `app/(auth)/signup`, `verify`, `forgot`, `reset` | le quattro pagine | |

### 12. Cosa non cambia

Il motore, la macchina a stati, `serializeSnapshot`, lo stream SSE, le rotte di gioco, i timer, lo
scheduler, i bot. Nessuna transizione nuova, nessun campo nuovo nello snapshot. Il portale resta
mobile-first, e queste quattro pagine nuove lo sono a loro volta — **si registra dal telefono**, come
si offre dal telefono.

### 13. Cosa non entra (regola 8)

Niente stop o sospensione degli utenti — è stato valutato in fase di spec e rimandato di proposito ·
niente pannello di amministrazione (M6) · niente aggiunta di una password a un account Google
(§2) · niente revoca delle sessioni aperte al cambio password (§4) · niente difesa
dall'enumerazione (§4) · niente 2FA, niente «ricordati di me», niente provider oltre Google ed
email · niente UI per cambiare la propria password da dentro l'app: chi la vuole cambiare passa da
`/forgot`, che è la stessa macchina e una schermata in meno.

---

## Task

- [x] **M5-01** — Aprire `feature/05-identita` da `dev`; scrivere questo file e
      `docs/features/06-amministrazione.md`, svuotare `docs/REQUESTS.md`, aggiornare
      `docs/features/README.md`
- [x] **M5-02** — Schema: `users.password_hash`, `users.email_verified_at`, la tabella `email_codes`,
      il `UNIQUE` parziale su `lower(email)`; i due valori di `purpose` in `lib/domain.ts`;
      `pnpm db:push` in locale
- [x] **M5-03** — `lib/engine/password.ts`: scrypt N=2^15/r=8/p=1, salt da 16 byte, formato
      `scrypt$…`, `timingSafeEqual`, la politica 10–200 caratteri
- [x] **M5-04** — `lib/engine/account-rules.ts`: scadenza, tentativi, reinvio — funzioni pure con
      `now` come parametro
- [x] **M5-05** — `lib/mail.ts`: `nodemailer` su SMTP, timeout dieci secondi, **stdout fuori
      produzione**; le variabili in `.env.example`
- [x] **M5-06** — `lib/rate-limit.ts`: `Map` su `globalThis`, scadenza pigra, tetto sulle chiavi;
      **verificare che nginx imposti `X-Forwarded-For`** e annotare l'esito
      → **Verificato: sì.** `deploy/nginx-asta.conf` imposta
      `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for` in **entrambi** i blocchi —
      `location /` (riga 61) e la rotta dello stream (riga 48). Il limite per IP è quindi un limite
      per IP vero e non un limite globale mascherato.
      ⚠ Con una conseguenza che vale la pena aver scritto: `$proxy_add_x_forwarded_for`
      **accoda** al valore ricevuto invece di sostituirlo, e quel valore lo scrive il client.
      `clientIp()` prende quindi l'**ultimo** elemento della lista, l'unico che ha scritto nginx.
      Prendere il primo — che è la lettura ovvia della specifica dell'header — avrebbe reso il
      limite aggirabile mandando un `X-Forwarded-For` a mano.
- [x] **M5-07** — `lib/engine/accounts.ts`: registrazione (utente prima, invio dopo), emissione del
      codice con consumo del precedente, verifica, reinvio
- [x] **M5-08** — `lib/auth.ts`: il provider `email`; l'aggancio Google per email; **il rifiuto se
      `email_verified` è falso**; l'email che non si riscrive più a ogni login; ⚠ **l'azzeramento di
      `password_hash` sull'aggancio a una riga non verificata**
- [x] **M5-09** — `requireUser()`: il terzo gradino verso `/verify`, in mezzo agli altri due; audit
      delle pagine che usano `currentUser()` scavalcando la scala (sospetto: `/join/[token]`)
      → **Audit svolto.** Il sospetto era infondato: `/join/[token]` usa già `requireUser()`, quindi
      il gradino nuovo lo protegge senza toccare quella pagina. I due punti che rifacevano la scala
      **a mano** erano altri, e sono stati allineati: `app/page.tsx` (la radice, che smista) e
      `app/onboarding/page.tsx` più la sua server action — senza il rimando, chi digitava
      `/onboarding` nella barra degli indirizzi saltava il gradino di mezzo.
      Gli altri usi di `currentUser()` restano corretti e sono di due specie: le pagine che la scala
      la **implementano** (`/signin`, `/verify`, `/onboarding`), dove `requireUser()` sarebbe un
      ciclo di redirect, e le **rotte API** (`stream`, `action`, `heartbeat`, i due export) più la
      navbar, dove a una `fetch` non si risponde con un redirect.
      ⚠ Le rotte API non hanno bisogno del gradino: un utente non verificato non può diventare
      membro di nessuna asta — `joinAuction` e `createAuction` passano da `requireUser()` — quindi
      da quelle rotte riceve già `FORBIDDEN` o `NOT_FOUND`.
- [x] **M5-10** — Recupero: `/forgot`, `/reset`, il rifiuto se `password_hash` è nullo, il limite per
      IP sul flusso non autenticato
- [x] **M5-11** — UI: `/signup` (solo email e password), `/verify` col reinvio e il conto dei
      tentativi, i due form del recupero, e i link dalla pagina `/signin`. Mobile-first
- [x] **M5-12** — `tests/auth-providers.test.ts`: valore atteso `["google", "email"]`, **uguaglianza
      esatta mantenuta**, il test su `dev` intatto
- [x] **M5-13** — Test puri: `account-rules` con i fake timer (scaduto, quinto tentativo, reinvio
      prima dei 60 secondi), `password` (round-trip, hash diversi con lo stesso input, rifiuto sotto
      i 10 caratteri), `rate-limit` (soglia, azzeramento al successo, sfratto)
- [x] **M5-14** — Test con Postgres: **il furto d'account di §2** (aggancio a riga non verificata →
      `password_hash` nullo; aggancio a riga verificata → password intatta); nessuna seconda riga con
      la stessa email; il `UNIQUE` che rifiuta; registrazione su indirizzo già di Google rifiutata;
      reset rifiutato su account di solo Google; un codice nuovo consuma il precedente
- [x] **M5-15** — `pnpm db:seed`: `email_verified_at` e la password nota per i dodici utenti
- [x] **M5-16** — Gate: `pnpm test`, `pnpm typecheck`, `pnpm build` verdi (⚠ `pnpm build` con
      `pnpm dev` **spento**)
      → 495 test verdi su 35 file, `tsc --noEmit` pulito, build completata con le quattro rotte
      nuove (`/signup`, `/verify`, `/forgot`, `/reset`) nell'elenco.
- [x] **M5-17** — `docs/ARCHITECTURE.md`: il capitolo sull'identità — le due strade, l'aggancio
      asimmetrico e il perché, la scala di `requireUser()`. `docs/DECISIONS.md`: lo scostamento da
      PLAN §2, SMTP e `nodemailer`, scrypt invece di bcrypt, l'enumerazione non difesa, le sessioni
      non revocate al reset. `docs/HOWTO-PROVA-LOCALE.md`: il codice su stdout e la password del seed
- [ ] **M5-18** — Chiusura: merge `--no-ff` su `dev`, prova in locale, poi — **solo su richiesta
      dell'owner** — `CHANGELOG.md`, `package.json` a `1.6.0`, merge `--no-ff` su `main`, tag
      `v1.6.0`, push, e **`pnpm db:push` + il backfill a mano sul server** a deploy finito

## Verifica

1. `pnpm test`, `pnpm typecheck` e `pnpm build` verdi.
2. **Registrazione completa dal telefono** (`pnpm dev:lan`): email e password, il codice letto dallo
   stdout del dev server, `/verify`, poi `/onboarding` per il nome, poi la dashboard. Nessun secondo
   posto in cui si sceglie il nome.
3. **Non verificato non fa niente**: con l'account appena creato e il codice non inserito, ogni
   pagina protetta rimanda a `/verify` — comprese la creazione di un'asta e un link d'invito.
4. **Il codice**: sbagliato cinque volte lo brucia e chiede di rifarselo mandare; scaduto dopo
   quindici minuti (fake timer nel test, `expires_at` a mano in locale) lo dice e offre il pulsante;
   un reinvio prima di sessanta secondi viene rifiutato; un reinvio dopo invalida il precedente.
5. ⚠ **Il furto d'account non funziona**: si crea una riga non verificata con una password, poi si
   entra da Google con quello stesso indirizzo — l'account è uno solo, e la password di prima **non
   entra più**. Ripetendo su una riga già verificata, la password entra ancora.
6. **Una persona, una riga**: dopo l'aggancio, `SELECT count(*) FROM users WHERE lower(email) = …`
   restituisce 1, e la dashboard ha ancora dentro l'asta di prima.
7. **`/signup` su un indirizzo di Google** viene rifiutato con il messaggio che dice di entrare da
   Google. **`/forgot` su un account di solo Google** viene rifiutato con il messaggio che dice la
   stessa cosa.
8. **Recupero**: `/forgot` → codice → `/reset` → si entra con la password nuova e non con la vecchia.
9. **Google non verificato non entra** (si prova forzando `email_verified: false` nel profilo).
10. **Il rate limit morde**: undici login falliti di fila sulla stessa email vengono rifiutati con un
    messaggio che dice quanto aspettare, e un login riuscito azzera il contatore.
11. **Gli utenti che c'erano già**: sul database locale, una riga con `google_sub` e
    `email_verified_at` nullo eseguendo il backfill **non** viene mandata a `/verify`.
12. **Un'asta si gioca ancora**: una simulazione a 8 con 7 bot arriva a `COMPLETED`. Questa macro non
    tocca il motore, e il modo di dimostrarlo è che l'asta non si è accorta di niente.
