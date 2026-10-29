#!/usr/bin/env bash
# Least-privilege database roles for ArtiCode Academy (KI-024, ADR-019).
#
#   POSTGRES_USER        superuser: cluster administration only (created by the image)
#   DB_MIGRATOR_USER     owns the database and its schema; runs `prisma migrate`
#   DB_APP_USER          SELECT / INSERT / UPDATE / DELETE only; used by the NestJS runtime
#
# The postgres image runs this file automatically on the FIRST start of an empty
# volume (/docker-entrypoint-initdb.d). For a volume that already exists, run it
# once by hand; it is idempotent (roles are created only when missing, passwords
# and grants are re-applied), so it is also the way to rotate a role password:
#
#   docker compose exec -T postgres bash /docker-entrypoint-initdb.d/10-roles.sh
#
# All values come from the root .env through compose.yaml; nothing is hard-coded.
set -eo pipefail

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${DB_MIGRATOR_USER:?DB_MIGRATOR_USER is required}"
: "${DB_MIGRATOR_PASSWORD:?DB_MIGRATOR_PASSWORD is required}"
: "${DB_APP_USER:?DB_APP_USER is required}"
: "${DB_APP_PASSWORD:?DB_APP_PASSWORD is required}"

# Local socket connection as the superuser (trusted inside the container).
psql -v ON_ERROR_STOP=1 --no-password --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v db="$POSTGRES_DB" \
  -v migrator="$DB_MIGRATOR_USER" -v migrator_password="$DB_MIGRATOR_PASSWORD" \
  -v app="$DB_APP_USER" -v app_password="$DB_APP_PASSWORD" <<'SQL'
-- CREATE ROLE has no IF NOT EXISTS: generate the statement only when the role is missing.
SELECT format('CREATE ROLE %I', :'migrator')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migrator')\gexec
SELECT format('CREATE ROLE %I', :'app')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app')\gexec

-- Migrator: CREATEDB only because `prisma migrate dev` creates a temporary shadow
-- database locally; a production migrator role does not need it (migrate deploy).
ALTER ROLE :"migrator" WITH LOGIN PASSWORD :'migrator_password'
  NOSUPERUSER NOCREATEROLE CREATEDB NOREPLICATION NOBYPASSRLS NOINHERIT;

-- Application: no DDL, no database/role creation, cannot bypass row-level security.
ALTER ROLE :"app" WITH LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS NOINHERIT;

-- The migrator owns the database, hence the public schema (pg_database_owner) and
-- every object its migrations create. Only the two roles may connect.
ALTER DATABASE :"db" OWNER TO :"migrator";
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO :"migrator", :"app";

-- Application privileges: existing objects now, future ones through default privileges
-- (which apply to objects created by the migrator, i.e. by migrations).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app";
SQL

echo "roles ready: ${DB_MIGRATOR_USER} (owner/migrations), ${DB_APP_USER} (application) on ${POSTGRES_DB}"
