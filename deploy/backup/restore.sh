#!/usr/bin/env bash
# ArtiCode Academy — restore a dump into the LIVE database (MOD-17-T04, D-R92).
#
#   restore.sh [--yes] [--force] <dump>
#
# <dump> is a file name in BACKUP_DIR or a path inside the container. Without --yes
# it only checks and reports (a dry run). It is the in-container step of the
# documented procedure — stop `api`, `web` and `maintenance`; restore; run the
# `migrate` service (`prisma migrate deploy`); start them again:
#   1. the dump must match its <dump>.sha256 and be a readable pg_dump archive;
#   2. no other session may be connected to the database (--force skips this check);
#   3. as DB_MIGRATOR_USER (the database owner), in ONE transaction: every object the
#      migrator owns is dropped, then the dump is applied with `pg_restore --clean
#      --if-exists --no-owner --role=<migrator> --single-transaction` (rendered as SQL,
#      run by psql with ON_ERROR_STOP). Any error — or a dump that ends early — rolls
#      the whole transaction back: the database is either the dump's or unchanged.
# Exit codes: 0 restored, 1 failed (nothing changed), 2 refused (nothing changed).
set -euo pipefail
ARTICODE_JOB=restore
# shellcheck source=common.sh
. /usr/local/lib/articode-backup/common.sh

usage() {
  sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'
}
refuse() {
  log "REFUSED: $*" >&2
  exit 2
}

yes=false force=false dump=''
while (($# > 0)); do
  case $1 in
    --yes) yes=true ;;
    --force) force=true ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*) refuse "unknown option '$1'" ;;
    *)
      [[ -z $dump ]] || refuse "one dump at a time"
      dump=$1
      ;;
  esac
  shift
done
[[ -n $dump ]] || {
  usage >&2
  refuse "no dump given"
}
[[ $dump == */* ]] || dump="$BACKUP_DIR/$dump"

require_config

exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || refuse "a backup is running - wait for it to finish"

verify_sha256 "$dump" || die "$VERIFY_ERROR"
if ! entries=$(pg_restore --list "$dump" 2>&1); then
  die "${dump##*/} is not a readable pg_dump archive (pg_restore --list failed: $(error_summary "$entries"))"
fi
entries=$(grep -c '^[0-9]' <<<"$entries" || true)
log "verified ${dump##*/}: sha256 ${DUMP_SHA256:0:16}..., $entries archive entries"

sessions=$(psql "${LIVE[@]}" --no-psqlrc --tuples-only --no-align --set=ON_ERROR_STOP=1 --command \
  "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND usesysid IS NOT NULL") ||
  die "cannot reach $POSTGRES_DB on $PGHOST:$PGPORT as $DB_MIGRATOR_USER"
if ((sessions > 0)); then
  if $force; then
    warn "$sessions other session(s) connected to $POSTGRES_DB - continuing (--force)"
  else
    refuse "$sessions other session(s) are connected to $POSTGRES_DB: stop api, web and maintenance first (or pass --force)"
  fi
fi

$yes || refuse "this would replace every object of $POSTGRES_DB on $PGHOST:$PGPORT with ${dump##*/} - re-run with --yes to restore"

started=$(date -u +%s)
log "restore: ${dump##*/} -> $POSTGRES_DB on $PGHOST:$PGPORT as $DB_MIGRATOR_USER (one transaction)"
if ! restore_err=$(apply_dump "$dump" "${LIVE[@]}" 2>&1); then
  die "restore failed - the transaction was rolled back, $POSTGRES_DB is unchanged: $(error_summary "$restore_err")"
fi
newest=$(psql "${LIVE[@]}" --no-psqlrc --tuples-only --no-align --command \
  "SELECT coalesce(max(migration_name), 'none') FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL" 2>/dev/null || echo unknown)
log "restore: done in $(($(date -u +%s) - started)) s - newest migration in the database: $newest"
log "next: run the migrate service (prisma migrate deploy), then start api, web and maintenance"
