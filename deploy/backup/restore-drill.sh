#!/usr/bin/env bash
# ArtiCode Academy — the monthly restore drill (MOD-17-T04, D-R92). Run by cron in
# the `backup` container, or by hand: `docker compose exec backup restore-drill.sh [dump]`.
#
# Proves a dump (default: the newest in BACKUP_DIR) restores, without touching the
# live server and without CREATEDB anywhere:
#   1. the dump matches its <dump>.sha256;
#   2. reads, read-only, the live database's locale and newest applied migration;
#   3. `initdb` of a throwaway cluster in a temporary folder of this container, as
#      `postgres`, listening on a unix socket only; creates the migrator role
#      (NOSUPERUSER NOCREATEDB, like production), the roles the dump grants to, and
#      the database owned by the migrator; restores the dump as the migrator through
#      the same one-transaction path as restore.sh;
#   4. checks: `_prisma_migrations` has finished rows, none failed or only rolled back,
#      and its newest finished migration equals the live one; `academy` holds exactly
#      one row; `roles` and `permissions` are not empty; prints core row counts;
#   5. stops and deletes the cluster.
# Writes a one-line JSON result to stdout and to BACKUP_DIR/drill-last.json
# ({"result":"pass"|"fail",…}); exits 1 with the reason when the dump is damaged,
# truncated or incomplete.
set -euo pipefail
ARTICODE_JOB=restore-drill
# shellcheck source=common.sh
. /usr/local/lib/articode-backup/common.sh

CORE_TABLES=(academy users roles permissions user_roles audit_logs courses classes enrollments lessons
  attendance_records assignments exams final_grades certificates invoices payments notifications)

started=$(date -u +%s)
dump_name='' work='' cluster_up=false

record() { # record <json>: stdout + drill-last.json
  printf '%s\n' "$1"
  write_json "$BACKUP_DIR/drill-last.json" "$1"
}
fail() {
  log "FAIL: $*" >&2
  record "{\"result\":\"fail\",\"at\":\"$(now_iso)\",\"dump\":$( [[ -n $dump_name ]] && json_str "$dump_name" || printf null),\"reason\":$(json_str "$*"),\"seconds\":$(($(date -u +%s) - started))}"
  exit 1
}
cleanup() {
  if $cluster_up; then
    pg_ctl --pgdata="$work/data" --mode=immediate --wait stop >/dev/null 2>&1 || true
  fi
  [[ -n $work ]] && rm -rf -- "$work"
  return 0
}
trap cleanup EXIT

[[ $# -le 1 ]] || fail "usage: restore-drill.sh [dump]"
require_config

exec 8>"$BACKUP_DIR/.drill.lock"
flock -n 8 || fail "another restore drill is running"

if [[ $# -eq 1 ]]; then
  dump=$1
  [[ $dump == */* ]] || dump="$BACKUP_DIR/$dump"
else
  dump=$(newest_dump)
  [[ -n $dump ]] || fail "no dump named ${POSTGRES_DB}-YYYYMMDDTHHMMSSZ.dump in $BACKUP_DIR"
fi
dump_name=${dump##*/}
log "drill: $dump_name"

# 1. checksum
verify_sha256 "$dump" || fail "$VERIFY_ERROR"
bytes=$(stat -c %s "$dump")
log "drill: sha256 ok (${DUMP_SHA256:0:16}..., $bytes bytes)"

# 2. the live database, read-only
live=$(PGOPTIONS="${PGOPTIONS:-} -c default_transaction_read_only=on" psql "${LIVE[@]}" --no-psqlrc --tuples-only --no-align \
  --field-separator='|' --set=ON_ERROR_STOP=1 --command \
  "SELECT d.datlocprovider, d.datcollate, d.datctype,
          (SELECT max(migration_name) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)
     FROM pg_database d WHERE d.datname = current_database()" 2>&1) ||
  fail "cannot read the live database $POSTGRES_DB on $PGHOST:$PGPORT: $(error_summary "$live")"
IFS='|' read -r live_provider live_collate live_ctype live_newest <<<"$live"
log "drill: live database newest migration ${live_newest:-none}"

# 3. a throwaway cluster on a unix socket (an interrupted drill's folder goes first —
#    we hold the drill lock, so none is in use)
rm -rf -- "${TMPDIR:-/tmp}"/articode-drill.*
work=$(mktemp -d "${TMPDIR:-/tmp}/articode-drill.XXXXXX")
init_log=$(initdb --pgdata="$work/data" --username=articode_drill --auth=trust --encoding=UTF8 \
  --locale=C.UTF-8 --no-sync --no-instructions 2>&1) || fail "initdb failed: $(error_summary "$init_log")"
if ! pg_ctl --pgdata="$work/data" --log="$work/server.log" --wait --timeout=60 --silent start \
  -o "-c listen_addresses='' -c unix_socket_directories='$work' -c fsync=off -c full_page_writes=off -c synchronous_commit=off -c max_locks_per_transaction=256" \
  >/dev/null; then
  fail "the throwaway server did not start: $(tail -n 1 "$work/server.log" 2>/dev/null)"
fi
cluster_up=true
admin=(--host="$work" --username=articode_drill --no-psqlrc --quiet --set=ON_ERROR_STOP=1)

# Roles the dump grants privileges to (its ACL entries), besides the migrator.
grantees=$(pg_restore --list "$dump" 2>/dev/null | grep -E '^[0-9]+; [0-9]+ [0-9]+ (DEFAULT )?ACL ' >"$work/acl.list" || true
  pg_restore --use-list="$work/acl.list" --file=- "$dump" 2>/dev/null |
    grep -oE '\b(TO|FROM|FOR ROLE) ("[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)' |
    sed -E 's/^(TO|FROM|FOR ROLE) //; s/^"(.*)"$/\1/' | sort -u || true)
if [[ $live_provider != c || -z $live_collate ]]; then
  log "drill: the live database uses locale provider '$live_provider' - the drill database uses libc C.UTF-8"
  live_collate=C.UTF-8 live_ctype=C.UTF-8
fi
if ! setup=$( {
  printf '%s\n' "SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', :'migrator')\\gexec"
  while IFS= read -r role; do
    [[ -n $role && $role != PUBLIC && $role != pg_* && $role != "$DB_MIGRATOR_USER" ]] || continue
    printf "SELECT format('CREATE ROLE %%I NOLOGIN', %s) WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = %s)\\\\gexec\n" \
      "\$r\$$role\$r\$" "\$r\$$role\$r\$"
  done <<<"$grantees"
  printf '%s\n' "SELECT format('CREATE DATABASE %I OWNER %I TEMPLATE template0 ENCODING %L LOCALE_PROVIDER libc LC_COLLATE %L LC_CTYPE %L',
                  :'db', :'migrator', 'UTF8', :'collate', :'ctype')\\gexec"
} | psql "${admin[@]}" --dbname=postgres --set=migrator="$DB_MIGRATOR_USER" --set=db="$POSTGRES_DB" \
  --set=collate="$live_collate" --set=ctype="$live_ctype" 2>&1); then
  fail "could not prepare the throwaway cluster: $(error_summary "$setup")"
fi

drill_conn=(--host="$work" --username="$DB_MIGRATOR_USER" --dbname="$POSTGRES_DB")
if ! restore_err=$(apply_dump "$dump" "${drill_conn[@]}" 2>&1); then
  fail "the dump does not restore (damaged, truncated or incomplete): $(error_summary "$restore_err")"
fi
log "drill: restored into the throwaway cluster in $(($(date -u +%s) - started)) s"

# 4. checks
q() { psql "${drill_conn[@]}" --no-psqlrc --tuples-only --no-align --set=ON_ERROR_STOP=1 --command "$1" 2>&1; }
exists=$(q "SELECT to_regclass('public._prisma_migrations') IS NOT NULL") || fail "cannot query the restored database: $(error_summary "$exists")"
[[ $exists == t ]] || fail "the restored database has no _prisma_migrations table - not a migrated ArtiCode database"
stats=$(q "SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
                  count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL),
                  (SELECT count(DISTINCT x.migration_name) FROM _prisma_migrations x
                    WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations y WHERE y.migration_name = x.migration_name
                                       AND y.finished_at IS NOT NULL AND y.rolled_back_at IS NULL)),
                  coalesce(max(migration_name) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL), '')
             FROM _prisma_migrations") || fail "cannot read _prisma_migrations: $(error_summary "$stats")"
IFS='|' read -r finished failed rolled_back newest <<<"$stats"
((finished >= 1)) || fail "_prisma_migrations holds no finished migration"
((failed == 0)) || fail "_prisma_migrations holds $failed failed (unfinished) migration row(s)"
((rolled_back == 0)) || fail "_prisma_migrations holds $rolled_back migration(s) that were only rolled back"
[[ $newest == "$live_newest" ]] ||
  fail "the dump's newest migration ($newest) differs from the live database's (${live_newest:-none}) - take a new backup"
core=$(q "SELECT (SELECT count(*) FROM public.academy), (SELECT count(*) FROM public.roles), (SELECT count(*) FROM public.permissions)") ||
  fail "a core table is missing from the restored database: $(error_summary "$core")"
IFS='|' read -r academy roles permissions <<<"$core"
((academy == 1)) || fail "the academy table holds $academy rows (expected exactly 1)"
((roles > 0)) || fail "the roles table is empty"
((permissions > 0)) || fail "the permissions table is empty"
tables=$(printf "'%s'," "${CORE_TABLES[@]}")
counts=$(q "SELECT coalesce(json_object_agg(t, n ORDER BY o), '{}')::text FROM (
              SELECT t, o, (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', t), false, true, '')))[1]::text::bigint AS n
                FROM unnest(ARRAY[${tables%,}]) WITH ORDINALITY AS u(t, o)
               WHERE to_regclass(format('public.%I', t)) IS NOT NULL) s") || fail "cannot count rows: $(error_summary "$counts")"
counts=${counts//' : '/:}
counts=${counts//', '/,}
counts=${counts/#'{ '/'{'}
counts=${counts/%' }'/'}'}
log "drill: checks passed - $finished migrations (newest $newest = live), row counts $counts"

# 5. the cluster goes away (trap), the result stays
pg_ctl --pgdata="$work/data" --mode=fast --wait stop >/dev/null 2>&1 && cluster_up=false
record "{\"result\":\"pass\",\"at\":\"$(now_iso)\",\"dump\":$(json_str "$dump_name"),\"bytes\":$bytes,\"sha256\":\"$DUMP_SHA256\",\"seconds\":$(($(date -u +%s) - started)),\"migrations\":{\"finished\":$finished,\"newest\":$(json_str "$newest"),\"live\":$(json_str "$live_newest")},\"counts\":$counts}"
