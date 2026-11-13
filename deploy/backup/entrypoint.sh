#!/usr/bin/env bash
# ArtiCode Academy — entrypoint of the `backup` container (MOD-17-T04, D-R92, D-R95).
#
#   (no arguments)   prepares the jobs, then runs cron in the foreground as PID 1;
#   <command…>       prepares the jobs, then runs that command instead — e.g.
#                    `docker compose run --rm backup restore.sh --yes <dump>`.
#
# Preparing = checking the settings, writing the migrator's password into a libpq
# password file and the job settings into an env file (both mode 600, owned by
# `postgres`, under /run/articode-backup — cron passes no environment to its jobs),
# and rendering the crontab. The password never appears in an argument or a log,
# and it is removed from the environment before cron starts.
#
# Settings (environment):
#   POSTGRES_DB, DB_MIGRATOR_USER, DB_MIGRATOR_PASSWORD   required
#   PGHOST (db), PGPORT (5432)                            the database server
#   BACKUP_RETENTION_DAYS (14)                            local dumps kept, by name date
#   BACKUP_REMOTE + BACKUP_AGE_RECIPIENT                  both set = offsite copy:
#        an rclone destination (`remote:bucket/path`; credentials in RCLONE_CONFIG_*
#        variables, never in BACKUP_REMOTE) and an age public key (`age1…`)
#   BACKUP_SCHEDULE ("30 2 * * *"), BACKUP_DRILL_SCHEDULE ("0 4 1 * *"), TZ (UTC)
set -euo pipefail

ARTICODE_JOB=entrypoint
RUN_DIR=/run/articode-backup
JOB_USER=postgres
CRON_TEMPLATE=/etc/articode-backup/crontab
CRON_FILE=/etc/cron.d/articode-backup

log() { printf '%s %s: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ARTICODE_JOB" "$*"; }
warn() { log "WARNING: $*" >&2; }
die() {
  log "ERROR: $*" >&2
  exit 1
}

[[ $(id -u) -eq 0 ]] || die "start this container as root: cron needs it, and every job runs as $JOB_USER"

[[ -n ${POSTGRES_DB:-} ]] || die "POSTGRES_DB is required"
[[ -n ${DB_MIGRATOR_USER:-} ]] || die "DB_MIGRATOR_USER is required"
[[ -n ${DB_MIGRATOR_PASSWORD:-} ]] || die "DB_MIGRATOR_PASSWORD is required (backups run as the migrator, the database owner)"
[[ $DB_MIGRATOR_PASSWORD != *$'\n'* ]] || die "DB_MIGRATOR_PASSWORD contains a line break, which a password file cannot hold"
export PGHOST="${PGHOST:-db}" PGPORT="${PGPORT:-5432}"
export BACKUP_DIR="${BACKUP_DIR:-/backups}" BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
export BACKUP_SCHEDULE="${BACKUP_SCHEDULE:-30 2 * * *}" BACKUP_DRILL_SCHEDULE="${BACKUP_DRILL_SCHEDULE:-0 4 1 * *}"
export TZ="${TZ:-UTC}"

[[ $POSTGRES_DB =~ ^[A-Za-z0-9_][A-Za-z0-9_-]*$ ]] || die "POSTGRES_DB may hold letters, digits, '_' and '-' only (it names the dump files)"
[[ $PGPORT =~ ^[0-9]{1,5}$ ]] || die "PGPORT must be a port number"
[[ $BACKUP_RETENTION_DAYS =~ ^[0-9]{1,4}$ ]] && ((10#$BACKUP_RETENTION_DAYS >= 1)) ||
  die "BACKUP_RETENTION_DAYS must be a whole number of days, 1 to 9999"
[[ -f /usr/share/zoneinfo/$TZ || $TZ == UTC ]] || die "TZ '$TZ' is not a known time zone"

# A schedule is five cron fields or one @keyword; anything else would be dropped
# silently by cron, so it stops the container here instead.
check_schedule() {
  local name=$1 value=$2
  if [[ $value =~ ^@(yearly|annually|monthly|weekly|daily|midnight|hourly)$ ]]; then return 0; fi
  [[ $value =~ ^[[:space:]]*[0-9A-Za-z*/,-]+([[:space:]]+[0-9A-Za-z*/,-]+){4}[[:space:]]*$ ]] ||
    die "$name must be five cron fields (minute hour day month weekday) or an @keyword — is '$value'"
}
check_schedule BACKUP_SCHEDULE "$BACKUP_SCHEDULE"
check_schedule BACKUP_DRILL_SCHEDULE "$BACKUP_DRILL_SCHEDULE"

offsite="off"
if [[ -n ${BACKUP_REMOTE:-} || -n ${BACKUP_AGE_RECIPIENT:-} ]]; then
  if [[ -z ${BACKUP_REMOTE:-} || -z ${BACKUP_AGE_RECIPIENT:-} ]]; then
    warn "the offsite copy needs both BACKUP_REMOTE and BACKUP_AGE_RECIPIENT — only one is set, so dumps stay local"
  else
    # rclone takes options inside a connection string (`:s3,secret_access_key=…:`),
    # which would put a secret on the command line of every upload.
    [[ $BACKUP_REMOTE != *=* ]] || die "BACKUP_REMOTE holds '=': put the remote's options and credentials in RCLONE_CONFIG_<REMOTE>_<OPTION> variables instead"
    if ! age -r "$BACKUP_AGE_RECIPIENT" -o /dev/null </dev/null 2>/dev/null; then
      warn "BACKUP_AGE_RECIPIENT is not a valid age recipient — every offsite copy will fail"
    fi
    offsite="to $BACKUP_REMOTE (age-encrypted)"
  fi
fi

# --- the password file and the job settings, readable by the job user only ---------
umask 077
install -d -o "$JOB_USER" -g "$JOB_USER" -m 700 "$RUN_DIR"

# libpq: hostname:port:database:username:password, ':' and '\' escaped.
escape_pgpass() {
  local v=${1//\\/\\\\}
  printf '%s' "${v//:/\\:}"
}
{
  printf '%s:%s:*:%s:' "$(escape_pgpass "$PGHOST")" "$PGPORT" "$(escape_pgpass "$DB_MIGRATOR_USER")"
  escape_pgpass "$DB_MIGRATOR_PASSWORD"
  printf '\n'
} >"$RUN_DIR/pgpass.partial"
chown "$JOB_USER:$JOB_USER" "$RUN_DIR/pgpass.partial"
chmod 600 "$RUN_DIR/pgpass.partial"
mv -f "$RUN_DIR/pgpass.partial" "$RUN_DIR/pgpass"
unset DB_MIGRATOR_PASSWORD

# Only what the jobs read — never a password. `%q` quotes for bash; a variable set
# by the caller (`docker exec -e …`) wins over the saved value.
{
  printf '# Written by the entrypoint at %s for the backup jobs — do not edit.\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  for name in $(compgen -e); do
    case $name in
      PGPASSWORD | PGPASSFILE | PGDATA) continue ;;
      PGHOST | PGPORT | PG[A-Z]* | PG_MAJOR | POSTGRES_DB | DB_MIGRATOR_USER | BACKUP_* | RCLONE_* | TZ | LANG) ;;
      *) continue ;;
    esac
    printf '[[ -v %s ]] || export %s=%q\n' "$name" "$name" "${!name}"
  done
} >"$RUN_DIR/env.partial"
chown "$JOB_USER:$JOB_USER" "$RUN_DIR/env.partial"
chmod 600 "$RUN_DIR/env.partial"
mv -f "$RUN_DIR/env.partial" "$RUN_DIR/env"
umask 022

# --- the dump folder ----------------------------------------------------------------
install -d "$BACKUP_DIR"
if ! gosu "$JOB_USER" test -w "$BACKUP_DIR"; then
  chown "$JOB_USER:$JOB_USER" "$BACKUP_DIR"
  log "$BACKUP_DIR handed to $JOB_USER (uid $(id -u "$JOB_USER"))"
fi
# The dumps hold password hashes and personal data: the job user alone reads them.
[[ $(stat -c %U "$BACKUP_DIR") != "$JOB_USER" ]] || chmod 700 "$BACKUP_DIR"
if ! grep -q " $BACKUP_DIR " /proc/self/mountinfo; then
  warn "$BACKUP_DIR is not a mounted volume — the dumps would be lost with the container"
fi

# --- the crontab ----------------------------------------------------------------------
crontab_text=$(<"$CRON_TEMPLATE")
crontab_text=${crontab_text//@BACKUP_SCHEDULE@/"$BACKUP_SCHEDULE"}
crontab_text=${crontab_text//@BACKUP_DRILL_SCHEDULE@/"$BACKUP_DRILL_SCHEDULE"}
printf '%s\n' "$crontab_text" >"$CRON_FILE.partial"
chmod 644 "$CRON_FILE.partial"
mv -f "$CRON_FILE.partial" "$CRON_FILE"

if [[ $# -gt 0 ]]; then
  exec "$@"
fi

log "ready: database $POSTGRES_DB on $PGHOST:$PGPORT as $DB_MIGRATOR_USER; dumps in $BACKUP_DIR kept $BACKUP_RETENTION_DAYS days; offsite copy $offsite"
log "schedule ($TZ): backup '$BACKUP_SCHEDULE', restore drill '$BACKUP_DRILL_SCHEDULE'"
exec cron -f
