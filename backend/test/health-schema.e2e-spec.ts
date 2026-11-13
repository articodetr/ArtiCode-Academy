// TEST-202 (e2e part) — MOD-17-T03: GET /api/health/ready (API-004) compares the
// newest migration shipped with the build with `_prisma_migrations` of the real
// development database, read as the APPLICATION role (the default privileges of
// docker/postgres/initdb/10-roles.sh). The shipped folder is the MIGRATIONS_DIR
// provider, pointed here at the real backend/prisma/migrations and at temporary
// folders. Nothing is written to the database. Skipped when no database is
// reachable.
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const { AppModule } = await import('../src/app.module.js');
const { APP_CREATE_OPTIONS, configureApp } =
  await import('../src/app.setup.js');
const { MIGRATIONS_DIR } = await import('../src/health/schema-version.js');

const DATABASE_URL =
  process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const REAL_MIGRATIONS = join(process.cwd(), 'prisma', 'migrations');
const FUTURE = '29991231235959_future';

async function canConnect(url: string): Promise<boolean> {
  const client = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url,
      connectionTimeoutMillis: 3000,
    }),
  });
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.$disconnect();
  }
}

const available = DATABASE_URL ? await canConnect(DATABASE_URL) : false;

/** The real migration folders, oldest first — read here without the code under test. */
function realMigrations(): string[] {
  return readdirSync(REAL_MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .filter((entry) =>
      existsSync(join(REAL_MIGRATIONS, entry.name, 'migration.sql')),
    )
    .map((entry) => entry.name)
    .sort();
}

async function appWith(migrationsDir: string): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MIGRATIONS_DIR)
    .useValue(migrationsDir)
    .compile();
  const app =
    moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
  configureApp(app);
  await app.init();
  return app;
}

async function readiness(migrationsDir: string) {
  const app = await appWith(migrationsDir);
  try {
    return await request(app.getHttpServer()).get('/api/health/ready');
  } finally {
    await app.close();
  }
}

describe.skipIf(!available)(
  'readiness knows the schema version (e2e, TEST-202)',
  () => {
    let names: string[];
    let newest: string;
    let older: string;
    let scratch: string;

    beforeAll(async () => {
      names = realMigrations();
      expect(
        names.length,
        'backend/prisma/migrations holds at least two migrations',
      ).toBeGreaterThanOrEqual(2);
      newest = names.at(-1)!;
      older = names.at(-2)!;
      scratch = await mkdtemp(join(tmpdir(), 'articode-ready-'));
    });

    afterAll(async () => {
      if (scratch) await rm(scratch, { recursive: true, force: true });
    });

    /** A temporary shipped folder holding `migrations` (each with a migration.sql). */
    async function shipped(
      label: string,
      migrations: string[],
    ): Promise<string> {
      const dir = join(scratch, label);
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'migration_lock.toml'),
        'provider = "postgresql"\n',
      );
      for (const name of migrations) {
        await mkdir(join(dir, name));
        await writeFile(
          join(dir, name, 'migration.sql'),
          '-- test copy, never applied\n',
        );
      }
      return dir;
    }

    it('is ready with the real migrations: the database holds the newest one (current)', async () => {
      const res = await readiness(REAL_MIGRATIONS);

      expect(
        res.status,
        `run \`npm run prisma:deploy\` if the dev DB lags: ${JSON.stringify(res.body)}`,
      ).toBe(200);
      expect(res.body.status).toBe('ready');
      expect(res.body).not.toHaveProperty('reason');
      expect(res.body.checks.database.status).toBe('up');
      expect(res.body.checks.schema).toEqual({
        status: 'current',
        expected: newest,
        applied: newest,
      });
    });

    it('answers 503 schema_outdated when the build ships a migration the database lacks', async () => {
      const res = await readiness(await shipped('outdated', [newest, FUTURE]));

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('not_ready');
      expect(res.body.reason).toBe('schema_outdated');
      expect(res.body.checks.database.status).toBe('up');
      expect(res.body.checks.schema).toEqual({
        status: 'outdated',
        expected: FUTURE,
        applied: newest,
      });
    });

    it('stays ready when the database is ahead of an older build (ahead)', async () => {
      const res = await readiness(await shipped('ahead', [older]));

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
      expect(res.body).not.toHaveProperty('reason');
      expect(res.body.checks.schema).toEqual({
        status: 'ahead',
        expected: older,
        applied: newest,
      });
    });

    it('does not check the schema without a shipped migrations folder (unchecked)', async () => {
      const res = await readiness(join(scratch, 'missing'));

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
      expect(res.body.checks.schema).toEqual({
        status: 'unchecked',
        expected: null,
        applied: null,
      });
    });

    it('documents checks.schema and reason in OpenAPI', async () => {
      const app = await appWith(REAL_MIGRATIONS);
      try {
        const docs = await request(app.getHttpServer())
          .get('/api/docs-json')
          .expect(200);
        const schemas = docs.body.components.schemas;
        expect(schemas.ReadinessChecksDto.properties).toHaveProperty('schema');
        expect(schemas.ReadinessResponseDto.properties.reason.enum).toEqual([
          'database_unavailable',
          'schema_outdated',
          'schema_unverified',
        ]);
        expect(schemas.SchemaCheckDto.properties.status.enum).toEqual([
          'current',
          'ahead',
          'outdated',
          'unchecked',
          'error',
        ]);
        expect(schemas.SchemaCheckDto.properties.expected).toMatchObject({
          type: 'string',
          nullable: true,
        });
        expect(schemas.SchemaCheckDto.properties.applied).toMatchObject({
          type: 'string',
          nullable: true,
        });
        expect(schemas.SchemaCheckDto.required).toEqual(
          expect.arrayContaining(['status', 'expected', 'applied']),
        );
      } finally {
        await app.close();
      }
    });
  },
);
