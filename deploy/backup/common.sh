# shellcheck shell=bash
# ArtiCode Academy — shared by backup.sh, restore.sh and restore-drill.sh
# (MOD-17-T04, D-R92). Sourced, never run. It
#   - re-executes the calling script as `postgres` when started as root (cron and
#     `docker exec` start as root; initdb refuses root; the dumps belong to the
#     user that prunes them);
#   - loads the settings the entrypoint saved for the jobs (cron passes no
#     environment) without overriding a variable that is already set;
#   - points libpq at the password file written by the entrypoint: no password is
#     ever an argument (`ps`) or in a log.

ARTICODE_RUN_DIR=/run/articode-backup
ARTICODE_JOB_USER=postgres

if [[ $(id -u) -eq 0 ]]; then
  # cron starts its jobs in root's home, which `postgres` cannot enter.
  cd /
  exec gosu "$ARTICODE_JOB_USER" "$0" "$@"
fi

# shellcheck source=/dev/null
[[ -r $ARTICODE_RUN_DIR/env ]] && . "$ARTICODE_RUN_DIR/env"

umask 077
# A crash must not leave a core file (it would hold data) in the dump folder.
ulimit -c 0
export PATH="/usr/lib/postgresql/${PG_MAJOR:-18}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export LANG="${LANG:-en_US.utf8}"
export PGHOST="${PGHOST:-db}" PGPORT="${PGPORT:-5432}"
export PGPASSFILE="$ARTICODE_RUN_DIR/pgpass"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"
export PGAPPNAME="articode-${ARTICODE_JOB:-backup}"
# libpq prefers PGPASSWORD to the password file; neither it nor the migrator's
# password reaches a child process.
unset PGPASSWORD DB_MIGRATOR_PASSWORD
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

log() { printf '%s %s: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${ARTICODE_JOB:-backup}" "$*"; }
warn() { log "WARNING: $*" >&2; }
die() {
  log "ERROR: $*" >&2
  exit 1
}

# Checks what every job needs; dies with a clear message otherwise.
require_config() {
  [[ -n ${POSTGRES_DB:-} ]] || die "POSTGRES_DB is not set"
  [[ $POSTGRES_DB =~ ^[A-Za-z0-9_][A-Za-z0-9_-]*$ ]] || die "POSTGRES_DB may hold letters, digits, '_' and '-' only (it names the dump files)"
  [[ -n ${DB_MIGRATOR_USER:-} ]] || die "DB_MIGRATOR_USER is not set"
  [[ $BACKUP_RETENTION_DAYS =~ ^[0-9]{1,4}$ ]] && ((10#$BACKUP_RETENTION_DAYS >= 1)) ||
    die "BACKUP_RETENTION_DAYS must be a whole number of days, 1 to 9999 (is '$BACKUP_RETENTION_DAYS')"
  [[ -r $PGPASSFILE ]] || die "no password file at $PGPASSFILE — the container entrypoint writes it from DB_MIGRATOR_PASSWORD"
  [[ -d $BACKUP_DIR && -w $BACKUP_DIR ]] || die "$BACKUP_DIR is not a writable directory for $(id -un)"
  LIVE=(--host="$PGHOST" --port="$PGPORT" --username="$DB_MIGRATOR_USER" --dbname="$POSTGRES_DB" --no-password)
}

# <db>-YYYYMMDDTHHMMSSZ.dump — the only names a job creates, reads by default or prunes.
dump_regex() { printf '^%s-([0-9]{8}T[0-9]{6}Z)\\.dump$' "$POSTGRES_DB"; }

# Epoch seconds of a name timestamp (YYYYMMDDTHHMMSSZ); fails on an impossible date.
stamp_epoch() {
  local t=$1
  date -u -d "${t:0:4}-${t:4:2}-${t:6:2}T${t:9:2}:${t:11:2}:${t:13:2}Z" +%s 2>/dev/null
}

# The newest dump in BACKUP_DIR by its name timestamp, skipping impossible dates
# (empty when there is none).
newest_dump() {
  local re f base
  re=$(dump_regex)
  for base in $(for f in "$BACKUP_DIR"/*.dump; do [[ -f $f ]] && printf '%s\n' "${f##*/}"; done | sort -r); do
    [[ $base =~ $re ]] && stamp_epoch "${BASH_REMATCH[1]}" >/dev/null || continue
    printf '%s/%s\n' "$BACKUP_DIR" "$base"
    return 0
  done
  return 0
}

# verify_sha256 <dump>: the dump matches <dump>.sha256 (`sha256sum` format).
# On failure sets VERIFY_ERROR and returns 1; on success sets DUMP_SHA256.
verify_sha256() {
  local dump=$1 expected actual
  VERIFY_ERROR='' DUMP_SHA256=''
  if [[ ! -f $dump ]]; then
    VERIFY_ERROR="no such dump: $dump"
    return 1
  fi
  if [[ ! -f $dump.sha256 ]]; then
    VERIFY_ERROR="no checksum file ${dump##*/}.sha256 beside the dump"
    return 1
  fi
  read -r expected _ <"$dump.sha256" || true
  if [[ ! $expected =~ ^[0-9a-f]{64}$ ]]; then
    VERIFY_ERROR="${dump##*/}.sha256 holds no sha256 checksum"
    return 1
  fi
  actual=$(sha256sum <"$dump")
  actual=${actual%% *}
  if [[ $actual != "$expected" ]]; then
    VERIFY_ERROR="sha256 mismatch for ${dump##*/}: the file is damaged, truncated or not the dump the checksum was written for"
    return 1
  fi
  DUMP_SHA256=$actual
}

# apply_dump <dump> <psql connection options…>
# Replaces the database's content with the dump's in ONE transaction: every object
# the connecting role (the migrator, the database owner) owns is dropped first —
# so nothing a newer migration created survives — then the dump's statements
# follow, rendered by `pg_restore --clean --if-exists --no-owner --role
# --single-transaction` and applied by psql with ON_ERROR_STOP. pg_restore writes
# its COMMIT only after it has read the whole archive: a truncated or corrupt dump,
# or any failing statement, leaves the database exactly as it was.
apply_dump() {
  local dump=$1
  shift
  {
    printf '%s\n' "SET client_min_messages = error;" \
      "SET lock_timeout = '${BACKUP_RESTORE_LOCK_TIMEOUT:-30s}';" \
      'BEGIN;' \
      'DROP OWNED BY CURRENT_USER;'
    pg_restore --clean --if-exists --no-owner --role="$DB_MIGRATOR_USER" --single-transaction --file=- "$dump"
  } | psql --no-psqlrc --quiet --set=ON_ERROR_STOP=1 "$@" >/dev/null
}

# JSON string literal of $1 (controls escaped or dropped).
json_str() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\t'/\\t}
  s=${s//[$'\x01'-$'\x08'$'\x0b'$'\x0c'$'\x0e'-$'\x1f']/}
  printf '"%s"' "$s"
}

# write_json <file> <json>: atomically, beside the dumps.
write_json() {
  local file=$1 json=$2
  if printf '%s\n' "$json" >"$file.partial" && mv -f "$file.partial" "$file"; then
    return 0
  fi
  rm -f "$file.partial"
  warn "could not write $file"
}

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# The line worth reporting from a failed restore's stderr: pg_restore's own error,
# else the first server error — never psql's DETAIL/CONTEXT lines, which can quote
# row data from the dump into a log or a result file.
error_summary() {
  local text=$1 line
  line=$(grep -m 1 -E '^pg_restore: error:' <<<"$text" || true)
  [[ -n $line ]] || line=$(grep -m 1 -E '(ERROR|FATAL|error):' <<<"$text" || true)
  [[ -n $line ]] || line="no error message (exit status only)"
  printf '%s' "${line:0:240}"
}
