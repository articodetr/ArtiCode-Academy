// Prisma CLI configuration of the PLATFORM database `articode_platform`
// (MOD-18, master doc 6.6.2/6.6.3). Every platform command names it:
//
//   npx prisma generate       --config prisma.platform.config.ts
//   npx prisma migrate dev    --config prisma.platform.config.ts   (npm run platform:migrate)
//   npx prisma migrate deploy --config prisma.platform.config.ts   (npm run platform:deploy)
//
// The CLI connects as the platform MIGRATOR role (owns articode_platform) — never
// as an academy role and never to an academy database: there is no fallback to
// DATABASE_URL / MIGRATION_DATABASE_URL here (ADR-019 pattern, own roles).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';
import { platformPostgresUrlFromEnv } from './src/config/database-url.js';

const backendDir = dirname(fileURLToPath(import.meta.url));

// backend/.env first (wins), then the root .env — the same files as
// prisma.config.ts. A missing URL only fails commands that need the database
// (migrate, studio), never `generate`.
loadDotenv({
  path: [resolve(backendDir, '.env'), resolve(backendDir, '..', '.env')],
  quiet: true,
});

/**
 * PLATFORM_MIGRATION_DATABASE_URL when set explicitly; otherwise derived from
 * PLATFORM_DB_MIGRATOR_USER / PLATFORM_DB_MIGRATOR_PASSWORD (+ DB_HOST,
 * POSTGRES_PORT, PLATFORM_DB_NAME).
 */
function platformMigrationDatabaseUrl(): string | undefined {
  return (
    process.env['PLATFORM_MIGRATION_DATABASE_URL'] ||
    platformPostgresUrlFromEnv(process.env, 'migrator')
  );
}

export default defineConfig({
  schema: 'prisma/platform/schema.prisma',
  migrations: {
    path: 'prisma/platform/migrations',
    // No seed yet (MOD-18-T01): the first platform user comes with a later task.
  },
  datasource: {
    url: platformMigrationDatabaseUrl(),
  },
});
