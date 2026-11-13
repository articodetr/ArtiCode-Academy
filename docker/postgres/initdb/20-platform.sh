#!/usr/bin/env bash
# The PLATFORM database and its two least-privilege roles (MOD-18-T01, master doc
# 6.6.2/6.6.3; the ADR-019 pattern of 10-roles.sh):
#
#   PLATFORM_DB_NAME               the control-plane database (default articode_platform)
#   PLATFORM_DB_MIGRATOR_USER      owns that database and its schema; runs
#                                  `prisma migrate --config prisma.platform.config.ts`
#                                  (default platform_migrator)
#   PLATFORM_DB_APP_USER           SELECT / INSERT / UPDATE / DELETE only (default platform_app)
#
# It lives on the same PostgreSQL server as the academy database in development,
# with roles of its own: the academy roles (10-roles.sh) cannot connect to the
# platform database and the platform roles cannot connect to the academy database
# — each database grants CONNECT to its own two roles only.
#
# The postgres image runs this file automatically on the FIRST start of an empty
# volume, after 10-roles.sh. For a volume that already exists, run it once by hand;
# it is idempotent (roles and the database are created only when missing,
# passwords and grants are re-applied), so it is also the way to rotate a password:
#
#   docker compose exec -T postgres bash /docker-entrypoint-initdb.d/20-platform.sh
#
# Without PLATFORM_DB_MIGRATOR_PASSWORD or PLATFORM_DB_APP_PASSWORD it creates
# nothing and succeeds, so an academy-only setup (an older .env, an academy compose
# project of deploy/compose.academy.yaml, which mounts this folder too) keeps working.
#
#   DB_MIGRATOR_CREATEDB  optional, true (default) | false — the same switch as
#                         10-roles.sh: `prisma migrate dev` needs CREATEDB for its
#                         shadow database, `migrate deploy` does not.
set -eo pipefail

# Everything runs inside a function that returns — never exits: the postgres image
# SOURCES an init script that is not executable (this file is 100644 in git, so on
# Linux it is sourced into docker-entrypoint.sh), and an `exit` there would end the
# entrypoint itself. Locals keep the entrypoint's shell clean.
platform_db_init() {
  : "${POSTGRES_USER:?POSTGRES_USER is required}"

  local platform_db="${PLATFORM_DB_NAME:-articode_platform}"
  local platform_migrator="${PLATFORM_DB_MIGRATOR_USER:-platform_migrator}"
  local platform_app="${PLATFORM_DB_APP_USER:-platform_app}"

  if [ -z "${PLATFORM_DB_MIGRATOR_PASSWORD:-}" ] || [ -z "${PLATFORM_DB_APP_PASSWORD:-}" ]; then
    echo "platform database skipped: PLATFORM_DB_MIGRATOR_PASSWORD and PLATFORM_DB_APP_PASSWORD are not both set"
    return 0
  fi

  local migrator_createdb
  case "${DB_MIGRATOR_CREATEDB:-true}" in
    true) migrator_createdb=CREATEDB ;;
    false) migrator_createdb=NOCREATEDB ;;
    *) echo "DB_MIGRATOR_CREATEDB must be true or false" >&2; return 1 ;;
  esac

  # Step 1 — roles and database, on the database the image created (POSTGRES_DB,
  # the academy database in development; it always exists). CREATE DATABASE cannot
  # run inside a transaction block: psql runs each \gexec statement on its own (no -1).
  psql -v ON_ERROR_STOP=1 --no-password --username "$POSTGRES_USER" --dbname "${POSTGRES_DB:-postgres}" \
    -v db="$platform_db" \
    -v migrator="$platform_migrator" -v migrator_password="$PLATFORM_DB_MIGRATOR_PASSWORD" \
    -v migrator_createdb="$migrator_createdb" \
    -v app="$platform_app" -v app_password="$PLATFORM_DB_APP_PASSWORD" <<'SQL'
-- CREATE ROLE / CREATE DATABASE have no IF NOT EXISTS: generate them only when missing.
SELECT format('CREATE ROLE %I', :'migrator')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migrator')\gexec
SELECT format('CREATE ROLE %I', :'app')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app')\gexec

-- Same attributes as the academy roles of 10-roles.sh.
ALTER ROLE :"migrator" WITH LOGIN PASSWORD :'migrator_password'
  NOSUPERUSER NOCREATEROLE :migrator_createdb NOREPLICATION NOBYPASSRLS NOINHERIT;
ALTER ROLE :"app" WITH LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS NOINHERIT;

SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'migrator')
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db')\gexec

-- The migrator owns the database, hence its public schema (pg_database_owner).
-- Only the two platform roles may connect (an academy role gets "permission denied").
ALTER DATABASE :"db" OWNER TO :"migrator";
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO :"migrator", :"app";
SQL

  # Step 2 — schema privileges, inside the platform database (as 10-roles.sh).
  psql -v ON_ERROR_STOP=1 --no-password --username "$POSTGRES_USER" --dbname "$platform_db" \
    -v migrator="$platform_migrator" -v app="$platform_app" <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app";
SQL

  echo "platform database ready: ${platform_db} — ${platform_migrator} (owner/migrations, ${migrator_createdb}), ${platform_app} (application)"
}

platform_db_init
