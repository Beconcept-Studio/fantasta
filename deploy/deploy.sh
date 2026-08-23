#!/usr/bin/env bash
#
# Il deploy di produzione (F8-01). È lo script che si incolla nel campo
# "Deploy script" del sito su Ploi, e che si può lanciare a mano dal server:
#
#   cd /home/ploi/fantasta.rggndr.it && ./deploy/deploy.sh
#
# Cosa fa, nell'ordine: si rifiuta di partire se c'è un'asta in corso, aggiorna
# il codice, installa, compila, **copia a mano gli asset statici** e ricarica pm2.
#
# Cosa NON fa, di proposito: non applica lo schema al database. `pnpm db:push`
# resta un comando manuale (vedi CLAUDE.md). Un `push` automatico a ogni
# deploy significherebbe una modifica di schema che parte da sola mentre otto
# persone stanno offrendo, e drizzle-kit non chiede il permesso a nessuno
# (`strict: false`, DECISIONS 2026-08-07).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BRANCH="${DEPLOY_BRANCH:-main}"

echo "▸ deploy di $(basename "$ROOT") — branch $BRANCH"

# ─── nvm ─────────────────────────────────────────────────────────────────────
# Ploi installa Node per l'utente `ploi` via nvm, e uno script non interattivo
# non legge `.bashrc`: senza questo, `node` e `pnpm` non esistono.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
fi

# ─── Guardia: mai un deploy ad asta viva ─────────────────────────────────────
# Un deploy fa ripartire il processo. Il boot recovery riprende entro un secondo
# (F3-14) e lo stato è tutto a database, quindi non si perde niente — ma un
# `pnpm build` dura un minuto, e un minuto di silenzio con dieci persone che
# aspettano è un minuto di panico. Se serve davvero:
#   DEPLOY_DURING_AUCTION=1 ./deploy/deploy.sh
#
# ⚠ **Le aste simulate non contano**, e questa riga è stata aggiunta dopo che il
# caso è successo (2026-08-12, rilascio di v1.9.0): una simulazione lasciata in
# pausa mesi prima bloccava ogni deploy, e non c'era modo di chiuderla —
# `deleteAuction` rifiuta `LIVE` e `PAUSED` anche a un amministratore, e a
# `COMPLETED` si arriva solo giocando. Il rimedio era ricordarsi ogni volta la
# variabile d'ambiente, cioè **trasformare una guardia in un rumore da
# ignorare**: il modo esatto in cui una guardia smette di proteggere il giorno
# che serve davvero. E il motivo per cui la guardia esiste — «dieci persone che
# aspettano» — in una simulazione non c'è: aspettano dei bot, che il boot
# recovery rimette in moto da soli.
#
# ⚠ Le simulate in corso vengono comunque **dette**, non ignorate in silenzio:
# un deploy che passa senza spiegare cosa ha scavalcato insegna a non leggere il
# suo output.
if [ "${DEPLOY_DURING_AUCTION:-0}" != "1" ] && command -v psql >/dev/null 2>&1 && [ -f .env ]; then
  DB_URL="$(sed -n 's/^DATABASE_URL=["'"'"']\{0,1\}\([^"'"'"']*\)["'"'"']\{0,1\}$/\1/p' .env | tail -1)"
  if [ -n "$DB_URL" ]; then
    LIVE="$(psql "$DB_URL" -tAc "select count(*) from auctions where status in ('LIVE','PAUSED') and is_simulated = false" 2>/dev/null || echo "")"
    if [ -n "$LIVE" ] && [ "$LIVE" != "0" ]; then
      echo "✗ Ci sono $LIVE aste reali in stato LIVE o PAUSED: deploy annullato." >&2
      echo "  Se è deliberato: DEPLOY_DURING_AUCTION=1 ./deploy/deploy.sh" >&2
      exit 1
    fi
    SIM="$(psql "$DB_URL" -tAc "select count(*) from auctions where status in ('LIVE','PAUSED') and is_simulated = true" 2>/dev/null || echo "")"
    if [ -n "$SIM" ] && [ "$SIM" != "0" ]; then
      echo "▸ $SIM aste simulate in corso: non bloccano il deploy (aspettano dei bot)."
    fi
  fi
fi

# ─── Codice ──────────────────────────────────────────────────────────────────
# `reset --hard` e non `pull`: il server è una copia di git, non un posto dove si
# scrive. ⚠ Qualunque modifica fatta a mano nei file tracciati viene buttata —
# `.env` no, perché è ignorato. Se hai toccato del codice sul server, committalo
# o copialo via **prima** di lanciare il deploy.
git fetch --quiet origin "$BRANCH"

# ─── Niente di nuovo? Si esce subito ────────────────────────────────────────
# ⚠ **Non è un'ottimizzazione: è la seconda difesa** contro ciò che è successo il
# 2026-08-23 (DECISIONS alla data). Un webhook aggiunto a mano deployava a ogni
# push su qualunque branch, e questo script compila sempre `main`: il deploy che
# partiva da un push su `dev` occupava per due minuti e mezzo la finestra in cui
# doveva entrare il push su `main`, che arrivava pochi secondi dopo e non
# produceva un secondo deploy. Due rilasci sono finiti in produzione alla
# versione precedente, con Ploi che segnalava successo.
#
# Un deploy che esce in un secondo quando non c'è niente da fare non occupa più
# niente, e il push su `main` trova la strada libera. L'hook è stato corretto e
# oggi filtra il branch — questa riga serve il giorno che qualcuno ne rimette uno
# a mano, che è già accaduto una volta.
#
# ⚠ **Confrontare i commit non basta.** Se una build precedente è morta a metà,
# `HEAD` è già quello giusto e il codice in esecuzione no: uscire qui lascerebbe
# la produzione indietro dicendo «tutto a posto», cioè lo stesso guasto silenzioso
# da cui nasce questo blocco. Quindi si guarda anche che `.next/BUILD_ID` sia più
# recente del commit; se manca o è più vecchio, si ricompila. **Nel dubbio si
# lavora, non si salta** — ed è anche la ragione per cui uno scarto di orologio fra
# la macchina di chi committa e il server è innocuo: sposta la decisione verso il
# ricompilare.
#
# Per rideployare **la stessa versione** — recupero a mano, ecosystem file
# toccato, build sospetta:
#
#   DEPLOY_FORCE=1 ./deploy/deploy.sh
#
if [ "${DEPLOY_FORCE:-0}" != "1" ] && [ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$BRANCH")" ]; then
  HEAD_TS="$(git log -1 --format=%ct HEAD)"
  BUILD_TS="$(stat -c %Y .next/BUILD_ID 2>/dev/null || echo 0)"
  if [ "$BUILD_TS" -gt "$HEAD_TS" ]; then
    echo "▸ niente di nuovo su origin/$BRANCH: in produzione c'è già $(git log --oneline -1)"
    echo "  build del $(stat -c %y .next/BUILD_ID) — nessuna ricompilazione, nessun riavvio."
    echo "  Per rideployare comunque: DEPLOY_FORCE=1 ./deploy/deploy.sh"
    exit 0
  fi
  echo "▸ il commit è già quello giusto ma la build è più vecchia: ricompilo."
fi

git reset --hard "origin/$BRANCH"

# `--prod=false` è obbligatorio, non un dettaglio: `next build` ha bisogno di
# `typescript`, `tailwindcss`, `@tailwindcss/postcss` ed `eslint-config-next`,
# che stanno tutti in devDependencies. Con `NODE_ENV=production` nell'ambiente,
# pnpm le salterebbe e la build morirebbe sul primo import di Tailwind.
# Servono anche dopo: `tsx` fa girare seed e bot, `drizzle-kit` il push.
pnpm install --frozen-lockfile --prod=false

# ─── Build ───────────────────────────────────────────────────────────────────
pnpm build

# ⚠ `output: 'standalone'` **non copia** né `.next/static` né `public/`: sono i
# soli due pezzi che restano fuori dalla cartella autoconsistente. Senza la
# prima, la pagina si carica senza CSS e senza idratazione — quindi il portale
# resta fermo su "Mi collego all'asta…", non parte nessuno stream, e sembra un
# bug del realtime mentre è un file mancante.
echo "▸ copio gli asset statici dentro .next/standalone"
rm -rf .next/standalone/.next/static
cp -r .next/static .next/standalone/.next/static
# `public/` oggi non esiste in questo progetto: il giorno che ci si mette una
# favicon, questa riga la porta di là senza che nessuno ci ripensi.
if [ -d public ]; then
  rm -rf .next/standalone/public
  cp -r public .next/standalone/public
fi

# Controllo esplicito: se il CSS non è al suo posto, meglio fallire il deploy
# che scoprirlo dal telefono di un partecipante.
if ! ls .next/standalone/.next/static/css/*.css >/dev/null 2>&1; then
  echo "✗ Nessun CSS in .next/standalone/.next/static/css: la copia non ha funzionato." >&2
  exit 1
fi

# ─── pm2 ─────────────────────────────────────────────────────────────────────
# `reload` in fork mode è un restart: nessun downtime a zero, ma il boot
# recovery lo copre. `--update-env` rilegge `.env` tramite l'ecosystem file.
if pm2 describe asta >/dev/null 2>&1; then
  pm2 reload deploy/ecosystem.config.cjs --update-env
else
  pm2 start deploy/ecosystem.config.cjs
fi
pm2 save --force

# L'ultima riga del log di Ploi dice *quale* commit sta girando: senza, per
# sapere se un deploy automatico è arrivato davvero bisogna entrare sul server
# e chiederlo a git.
echo "✓ deploy completato — in produzione: $(git log --oneline -1)"
echo "  pm2 logs asta   per seguire l'app in diretta"
