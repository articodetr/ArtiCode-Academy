#!/usr/bin/env bash
# ArtiCode Academy — the nightly backup (MOD-17-T04, D-R92). Run by cron in the
# `backup` container, or by hand: `docker compose exec backup backup.sh`.
#
#   backup.sh               dump, checksum, retention, optional offsite copy
#   backup.sh --prune-only  retention alone (e.g. after lowering BACKUP_RETENTION_DAYS)
#
# 1. `pg_dump -Fc` of POSTGRES_DB as DB_MIGRATOR_USER (the database owner — never
#    the superuser; the password comes from the libpq password file) into
#    BACKUP_DIR/<db>-YYYYMMDDTHHMMSSZ.dump (UTC), written under a hidden temporary
#    name and linked into place only when complete, with <name>.dump.sha256 beside it;
# 2. retention: removes the dumps — and their .sha256 / .age companions — whose NAME
#    timestamp is more than BACKUP_RETENTION_DAYS days old; never the newest dump,
#    never a file that does not match the naming pattern;
# 3. offsite copy, only when BACKUP_REMOTE and BACKUP_AGE_RECIPIENT are both set:
#    `age -r` encrypts the dump, `rclone copyto` uploads <name>.dump.age and
#    <name>.dump.sha256 (the checksum of the decrypted dump).
# One log line per step; any failure exits non-zero. The outcome is also written
# to BACKUP_DIR/backup-last.json (read by the container's health check).
set -euo pipefail
ARTICODE_JOB=backup
# shellcheck source=common.sh
. /usr/local/lib/articode-backup/common.sh

prune_only=false
case ${1:-} in
  '') ;;
  --prune-only) prune_only=true ;;
  -h | --help)
    sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *) die "unknown argument '$1' (use --prune-only or nothing)" ;;
esac

require_config

# Removes old dumps by their name timestamp; sets KEPT and REMOVED (dump groups).
retention() {
  local re cutoff now newest='' f base stamp epoch group
  local -A stamps=() has_dump=() epochs=()
  KEPT=0 REMOVED=0
  re="^${POSTGRES_DB}-([0-9]{8}T[0-9]{6}Z)\\.dump(\\.sha256|\\.age)?$"
  now=$(date -u +%s)
  cutoff=$((now - 10#$BACKUP_RETENTION_DAYS * 86400))
  for f in "$BACKUP_DIR"/*; do
    base=${f##*/}
    [[ -f $f && $base =~ $re ]] || continue
    stamps[${BASH_REMATCH[1]}]=1
    [[ -n ${BASH_REMATCH[2]} ]] || has_dump[${BASH_REMATCH[1]}]=1
  done
  # The newest dump with a real date is kept whatever its age.
  for stamp in $(printf '%s\n' "${!stamps[@]}" | sort -r); do
    epoch=$(stamp_epoch "$stamp") || continue
    epochs[$stamp]=$epoch
    if [[ -z $newest && -n ${has_dump[$stamp]:-} ]]; then newest=$stamp; fi
  done
  for stamp in $(printf '%s\n' "${!stamps[@]}" | sort); do
    if [[ -z ${epochs[$stamp]:-} ]]; then
      warn "retention: ${POSTGRES_DB}-$stamp.* carries an impossible date - kept"
      KEPT=$((KEPT + 1))
      continue
    fi
    epoch=${epochs[$stamp]}
    if [[ $stamp == "$newest" ]] || ((epoch >= cutoff)); then
      KEPT=$((KEPT + 1))
      continue
    fi
    group=''
    for f in "$BACKUP_DIR/${POSTGRES_DB}-$stamp".dump{,.sha256,.age}; do
      [[ -f $f ]] || continue
      rm -f -- "$f"
      group+=" ${f##*/}"
    done
    log "retention: removed$group ($(((now - epoch) / 86400)) days old)"
    REMOVED=$((REMOVED + 1))
  done
}

# A backup and a restore never overlap; neither do two backups.
exec 9>"$BACKUP_DIR/.backup.lock"
flock -w 600 9 || die "another backup or restore has held the lock for 10 minutes"

if $prune_only; then
  retention
  log "retention: kept $KEPT dumps, removed $REMOVED (older than $BACKUP_RETENTION_DAYS days; the newest is always kept)"
  exit 0
fi

started=$(date -u +%s)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="${POSTGRES_DB}-$stamp.dump"
final="$BACKUP_DIR/$name"
partial="$BACKUP_DIR/.$name.partial"
sha_partial="$BACKUP_DIR/.$name.sha256.partial"
age_partial="$BACKUP_DIR/.$name.age.partial"
step="start"
offsite="off"

finish() {
  local code=$?
  rm -f -- "$partial" "$sha_partial" "$age_partial"
  if ((code != 0)); then
    log "FAILED at step '$step' (exit $code)" >&2
    write_json "$BACKUP_DIR/backup-last.json" \
      "{\"result\":\"fail\",\"at\":\"$(now_iso)\",\"dump\":$(json_str "$name"),\"step\":$(json_str "$step"),\"exit\":$code}"
  fi
}
trap finish EXIT

# Leftovers of an interrupted run (we hold the lock, so none is in use).
find "$BACKUP_DIR" -maxdepth 1 -type f -name ".${POSTGRES_DB}-*.partial" -delete

step="dump"
[[ ! -e $final ]] || die "$name exists already - one backup per second at most"
log "dump: $POSTGRES_DB on $PGHOST:$PGPORT as $DB_MIGRATOR_USER -> $name"
pg_dump "${LIVE[@]}" --format=custom --file="$partial"
step="checksum"
sum=$(sha256sum <"$partial")
sum=${sum%% *}
printf '%s  %s\n' "$sum" "$name" >"$sha_partial"
# A hard link never replaces an existing file: the final name appears complete or not at all.
ln -- "$partial" "$final"
rm -f -- "$partial"
mv -f -- "$sha_partial" "$final.sha256"
bytes=$(stat -c %s "$final")
log "dump: done - $name, $bytes bytes, sha256 ${sum:0:16}..., $(($(date -u +%s) - started)) s"

step="retention"
retention
log "retention: kept $KEPT dumps, removed $REMOVED (older than $BACKUP_RETENTION_DAYS days; the newest is always kept)"

if [[ -n ${BACKUP_REMOTE:-} && -n ${BACKUP_AGE_RECIPIENT:-} ]]; then
  [[ $BACKUP_REMOTE != *=* ]] || die "BACKUP_REMOTE holds '=': put the remote's options in RCLONE_CONFIG_* variables"
  remote=${BACKUP_REMOTE%/}
  [[ $remote == *: ]] || remote+=/
  step="offsite encrypt"
  age -r "$BACKUP_AGE_RECIPIENT" -o "$age_partial" -- "$final"
  step="offsite upload"
  rclone copyto --quiet "$age_partial" "${remote}$name.age"
  rclone copyto --quiet "$final.sha256" "${remote}$name.sha256"
  rm -f -- "$age_partial"
  offsite="copied"
  log "offsite: $name.age and $name.sha256 uploaded to ${remote%/}"
elif [[ -n ${BACKUP_REMOTE:-} || -n ${BACKUP_AGE_RECIPIENT:-} ]]; then
  warn "offsite: skipped - BACKUP_REMOTE and BACKUP_AGE_RECIPIENT must both be set"
  offsite="incomplete settings"
fi

step="record"
write_json "$BACKUP_DIR/backup-last.json" \
  "{\"result\":\"pass\",\"at\":\"$(now_iso)\",\"dump\":$(json_str "$name"),\"bytes\":$bytes,\"sha256\":\"$sum\",\"seconds\":$(($(date -u +%s) - started)),\"retention\":{\"days\":$((10#$BACKUP_RETENTION_DAYS)),\"kept\":$KEPT,\"removed\":$REMOVED},\"offsite\":$(json_str "$offsite")}"
log "complete: $name"
