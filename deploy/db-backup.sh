#!/usr/bin/env bash
#
# Il backup del database (F8-04). Gira ogni giorno da cron e si può lanciare a
# mano — è il punto 1 della checklist pre-asta di PLAN §17:
#
#   /home/ploi/fantasta.rggndr.it/deploy/db-backup.sh
#
# Crontab (l'ora è UTC, come tutto sul server):
#   15 4 * * * /home/ploi/asta/deploy/db-backup.sh >> /home/ploi/backups/backup.log 2>&1
#
# Formato: SQL semplice, compresso con gzip. Non il formato `custom` di
# `pg_dump`: un dump che si legge con `zless` e si ripristina con `psql` è un
# dump che riesci a usare anche alle undici di sera senza rileggere il manuale,
# e questo database sta in pochi megabyte.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${BACKUP_DIR:-$HOME/backups}"
KEEP="${BACKUP_KEEP:-14}"

# La stessa `DATABASE_URL` dell'applicazione: un solo posto in cui è scritta la
# password (`.env`, che non è in git).
if [ ! -f "$ROOT/.env" ]; then
  echo "✗ Manca $ROOT/.env" >&2
  exit 1
fi
DB_URL="$(sed -n 's/^DATABASE_URL=["'"'"']\{0,1\}\([^"'"'"']*\)["'"'"']\{0,1\}$/\1/p' "$ROOT/.env" | tail -1)"
if [ -z "$DB_URL" ]; then
  echo "✗ DATABASE_URL non trovata in $ROOT/.env" >&2
  exit 1
fi

mkdir -p "$DEST"
STAMP="$(date -u +%Y-%m-%d_%H%M)"
FILE="$DEST/asta-$STAMP.sql.gz"

# `--clean` mette in testa i DROP: il dump si ripristina anche su un database
# che contiene già qualcosa, che è la condizione in cui ti trovi quando serve.
pg_dump --clean --if-exists --no-owner --no-privileges "$DB_URL" | gzip -9 > "$FILE"

# Un dump vuoto è peggio di nessun dump, perché sembra un backup riuscito.
SIZE="$(wc -c < "$FILE")"
if [ "$SIZE" -lt 1024 ]; then
  echo "✗ $FILE è di soli $SIZE byte: qualcosa è andato storto." >&2
  exit 1
fi
if ! gzip -t "$FILE"; then
  echo "✗ $FILE non è un gzip valido." >&2
  exit 1
fi

echo "✓ $(date -u +%FT%TZ) — $FILE ($(du -h "$FILE" | cut -f1))"

# Retention: teniamo gli ultimi $KEEP dump e buttiamo i più vecchi.
# shellcheck disable=SC2012
ls -1t "$DEST"/asta-*.sql.gz 2>/dev/null | tail -n "+$((KEEP + 1))" | while read -r old; do
  echo "  rimuovo $old"
  rm -f "$old"
done
