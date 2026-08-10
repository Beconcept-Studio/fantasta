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
if [ "${DEPLOY_DURING_AUCTION:-0}" != "1" ] && command -v psql >/dev/null 2>&1 && [ -f .env ]; then
  DB_URL="$(sed -n 's/^DATABASE_URL=["'"'"']\{0,1\}\([^"'"'"']*\)["'"'"']\{0,1\}$/\1/p' .env | tail -1)"
  if [ -n "$DB_URL" ]; then
    LIVE="$(psql "$DB_URL" -tAc "select count(*) from auctions where status in ('LIVE','PAUSED')" 2>/dev/null || echo "")"
    if [ -n "$LIVE" ] && [ "$LIVE" != "0" ]; then
      echo "✗ Ci sono $LIVE aste in stato LIVE o PAUSED: deploy annullato." >&2
      echo "  Se è deliberato: DEPLOY_DURING_AUCTION=1 ./deploy/deploy.sh" >&2
      exit 1
    fi
  fi
fi

# ─── Codice ──────────────────────────────────────────────────────────────────
# `reset --hard` e non `pull`: il server è una copia di git, non un posto dove si
# scrive. ⚠ Qualunque modifica fatta a mano nei file tracciati viene buttata —
# `.env` no, perché è ignorato. Se hai toccato del codice sul server, committalo
# o copialo via **prima** di lanciare il deploy.
git fetch --quiet origin "$BRANCH"
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
