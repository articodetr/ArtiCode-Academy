// Prisma CLI configuration (generate, migrate, studio).
//
// The CLI connects as the MIGRATOR role (owns the schema, runs migrations) while
// the runtime connects as the APPLICATION role (DML only) through ConfigService
// (src/prisma/prisma.service.ts) — ADR-019 / KI-024. Both URLs are derived from
// the same variables of the repository root .env that compose.yaml reads.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';
import { postgresUrlFromEnv } from './src/config/database-url.js';

const backendDir = dirname(fileURLToPath(import.meta.url));

// backend/.env first (wins), then the root .env. Both are git-ignored and
// optional: a missing URL only fails commands that need the database
// (migrate, studio), never `generate`.
loadDotenv({
  path: [resolve(backendDir, '.env'), resolve(backendDir, '..', '.env')],
  quiet: true,
});

/**
 * MIGRATION_DATABASE_URL when set explicitly; otherwise derived from
 * DB_MIGRATOR_USER / DB_MIGRATOR_PASSWORD (+ DB_HOST, POSTGRES_PORT, POSTGRES_DB);
 * otherwise the single DATABASE_URL for one-role setups such as a throwaway CI database.
 */
function migrationDatabaseUrl(): string | undefined {
  return (
    process.env['MIGRATION_DATABASE_URL'] ||
    postgresUrlFromEnv(process.env, 'migrator') ||
    process.env['DATABASE_URL']
  );
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: migrationDatabaseUrl(),
  },
});
