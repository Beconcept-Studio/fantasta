#!/usr/bin/env bash
#
# La prova del restore (F8-04). Un backup non provato non è un backup: questo
# script ripristina un dump su un database **nuovo e separato**, conta le righe
# che contano e poi lo butta. Non tocca mai il database di produzione.
#
#   /home/ploi/fantasta.rggndr.it/deploy/db-restore-check.sh                  # l'ultimo dump
#   /home/ploi/fantasta.rggndr.it/deploy/db-restore-check.sh ~/backups/asta-2026-08-08_0415.sql.gz
#   KEEP_DB=1 /home/ploi/fantasta.rggndr.it/deploy/db-restore-check.sh        # non cancella la copia
#
# Serve `sudo` senza password verso l'utente `postgres` (su Ploi l'utente `ploi`
# ce l'ha): creare e cancellare database non è una cosa che l'utente
# dell'applicazione debba poter fare.
set -euo pipefail

DEST="${BACKUP_DIR:-$HOME/backups}"
CHECK_DB="${CHECK_DB:-asta_restore_check}"

DUMP="${1:-}"
if [ -z "$DUMP" ]; then
  # shellcheck disable=SC2012
  DUMP="$(ls -1t "$DEST"/asta-*.sql.gz 2>/dev/null | head -1 || true)"
fi
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "✗ Nessun dump da ripristinare (cercato in $DEST)." >&2
  exit 1
fi

echo "▸ ripristino $DUMP su un database di prova ($CHECK_DB)"

sudo -u postgres dropdb --if-exists "$CHECK_DB"
sudo -u postgres createdb "$CHECK_DB"

# `--no-owner` era già nel dump, quindi tutto finisce all'utente `postgres`:
# qui non ci deve girare l'app, solo delle SELECT di controllo.
if ! gunzip -c "$DUMP" | sudo -u postgres psql --quiet --set ON_ERROR_STOP=on -d "$CHECK_DB" >/dev/null; then
  echo "✗ Il restore è fallito. Il dump non è utilizzabile." >&2
  exit 1
fi

echo "▸ conteggi sul database ripristinato:"
sudo -u postgres psql -d "$CHECK_DB" -c "
  select 'auctions' as tabella, count(*) from auctions
  union all select 'members', count(*) from members
  union all select 'players', count(*) from players
  union all select 'lots', count(*) from lots
  union all select 'bids', count(*) from bids
  union all select 'assignments', count(*) from assignments
  union all select 'ledger', count(*) from ledger
  union all select 'events', count(*) from events
  order by 1;
"

# La prova vera: le rose ricostruite dal dump devono ancora rispettare I2 —
# nessun giocatore assegnato due volte nella stessa asta fra le righe vive.
DUPES="$(sudo -u postgres psql -tAd "$CHECK_DB" -c "
  select count(*) from (
    select auction_id, player_id from assignments
    where voided_at is null
    group by auction_id, player_id having count(*) > 1
  ) t;
")"
if [ "$DUPES" != "0" ]; then
  echo "✗ I2 violata nel dump ripristinato: $DUPES giocatori assegnati più di una volta." >&2
  exit 1
fi
echo "✓ I2 rispettata: nessun giocatore assegnato due volte."

if [ "${KEEP_DB:-0}" = "1" ]; then
  echo "▸ $CHECK_DB lasciato in piedi (KEEP_DB=1). Cancellalo con:"
  echo "    sudo -u postgres dropdb $CHECK_DB"
else
  sudo -u postgres dropdb "$CHECK_DB"
  echo "✓ database di prova rimosso"
fi

echo "✓ restore provato con successo su $DUMP"
