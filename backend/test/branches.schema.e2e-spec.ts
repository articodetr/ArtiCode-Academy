// TEST-067 — MOD-02-T05 schema (O8, migration 20261104092731_mod02_branches):
// the `branches` table and its hand-written constraints. Runs against the local
// development database as the APPLICATION role and is skipped when no database
// is reachable (like TEST-007/TEST-039). Every test runs inside a transaction
// that is rolled back, so nothing is left behind.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config as loadDotenv } from 'dotenv';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const MIGRATION = '20261104092731_mod02_branches';

// PostgreSQL SQLSTATE codes
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

async function canConnect(url: string): Promise<boolean> {
  const probe = new Pool({ connectionString: url, connectionTimeoutMillis: 3000, max: 1 });
  try {
    await probe.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

const available = DATABASE_URL ? await canConnect(DATABASE_URL) : false;

describe.skipIf(!available)('database schema — MOD-02 branches (e2e, TEST-067)', () => {
  let pool: Pool;
  let prisma: PrismaClient;

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await pool?.end();
  });

  /** Runs `fn` in a transaction that is always rolled back. */
  async function inRollback<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      return await fn(client);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  /** Asserts that `sql` fails with the given SQLSTATE without aborting the transaction. */
  async function expectSqlError(client: PoolClient, sql: string, params: unknown[], code: string): Promise<void> {
    await client.query('SAVEPOINT expect_error');
    let caught: { code?: string } | undefined;
    try {
      await client.query(sql, params);
    } catch (error) {
      caught = error as { code?: string };
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT expect_error');
    }
    expect(caught, `expected SQLSTATE ${code} for: ${sql}`).toBeDefined();
    expect(caught?.code).toBe(code);
  }

  // Unique codes per run so a parallel e2e file never collides with this one.
  const tag = `B${Date.now().toString(36)}`.slice(0, 10).toUpperCase();
  const BRANCH_SQL = `INSERT INTO branches (code, name, address, is_main, is_active) VALUES ($1, $2::jsonb, $3::jsonb, $4, $5) RETURNING id, is_main, is_active, created_at, updated_at`;
  const NAME = '{"ar":"فرع"}';

  /** The shared dev database may already hold a main branch: demote it inside the rolled-back transaction. */
  async function withoutMain(client: PoolClient): Promise<void> {
    await client.query(`UPDATE branches SET is_main = false WHERE is_main`);
  }

  it('is applied after the MOD-05 migration and creates the table with its defaults', async () => {
    const migrations = await pool.query<{ migration_name: string; ok: boolean }>(
      `SELECT migration_name, finished_at IS NOT NULL AND rolled_back_at IS NULL AS ok FROM _prisma_migrations ORDER BY started_at`,
    );
    const names = migrations.rows.map((row) => row.migration_name);
    expect(names).toContain(MIGRATION);
    expect(names.indexOf(MIGRATION)).toBeGreaterThan(names.indexOf('20261103123442_mod05_classes_teachers_enrollments'));
    expect(migrations.rows.every((row) => row.ok)).toBe(true);

    await inRollback(async (client) => {
      const { rows } = await client.query<{ is_main: boolean; is_active: boolean; created_at: Date; updated_at: Date }>(
        `INSERT INTO branches (code, name) VALUES ($1, $2::jsonb) RETURNING is_main, is_active, created_at, updated_at`,
        [`${tag}-D`, NAME],
      );
      expect(rows[0]).toMatchObject({ is_main: false, is_active: true });
      expect(rows[0]!.created_at).toBeInstanceOf(Date);
      expect(rows[0]!.updated_at).toBeInstanceOf(Date);
    });
  });

  it('enforces the hand-written CHECKs (localized name and address, trimmed code, active main branch)', async () => {
    await inRollback(async (client) => {
      await withoutMain(client);
      await expectSqlError(client, BRANCH_SQL, [`${tag}-A`, '{"en":"no arabic"}', null, false, true], CHECK_VIOLATION);
      await expectSqlError(client, BRANCH_SQL, [`${tag}-B`, '"plain text"', null, false, true], CHECK_VIOLATION);
      await expectSqlError(client, BRANCH_SQL, [`${tag}-C`, NAME, '{"en":"street"}', false, true], CHECK_VIOLATION);
      await expectSqlError(client, BRANCH_SQL, [`${tag}-E`, NAME, '["street"]', false, true], CHECK_VIOLATION);
      await expectSqlError(client, BRANCH_SQL, [` ${tag}`, NAME, null, false, true], CHECK_VIOLATION);
      await expectSqlError(client, BRANCH_SQL, ['', NAME, null, false, true], CHECK_VIOLATION);
      // A main branch is an active one — on insert and on a later update.
      await expectSqlError(client, BRANCH_SQL, [`${tag}-F`, NAME, null, true, false], CHECK_VIOLATION);
      const main = await client.query<{ id: string }>(BRANCH_SQL, [`${tag}-G`, NAME, '{"ar":"شارع","en":"Street"}', true, true]);
      await expectSqlError(client, `UPDATE branches SET is_active = false WHERE id = $1`, [main.rows[0]!.id], CHECK_VIOLATION);
      await client.query(`UPDATE branches SET is_main = false, is_active = false WHERE id = $1`, [main.rows[0]!.id]);
    });
  });

  it('allows at most one main branch and any number of other branches', async () => {
    await inRollback(async (client) => {
      await withoutMain(client);
      await client.query(BRANCH_SQL, [`${tag}-M1`, NAME, null, true, true]);
      await expectSqlError(client, BRANCH_SQL, [`${tag}-M2`, NAME, null, true, true], UNIQUE_VIOLATION);
      await client.query(BRANCH_SQL, [`${tag}-O1`, NAME, null, false, true]);
      await client.query(BRANCH_SQL, [`${tag}-O2`, NAME, null, false, false]);
      const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM branches WHERE is_main`);
      expect(rows[0]!.n).toBe(1);
    });
  });

  it('keeps branch codes unique', async () => {
    await inRollback(async (client) => {
      await client.query(BRANCH_SQL, [`${tag}-U`, NAME, null, false, true]);
      await expectSqlError(client, BRANCH_SQL, [`${tag}-U`, '{"ar":"آخر"}', null, false, true], UNIQUE_VIOLATION);
    });
  });

  it('names the partial unique index and the CHECKs as the migration does', async () => {
    const checks = await pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'branches'::regclass AND contype = 'c' ORDER BY conname`,
    );
    expect(checks.rows.map((row) => row.conname)).toEqual([
      'ck_branches_address_localized',
      'ck_branches_code_trimmed',
      'ck_branches_main_active',
      'ck_branches_name_localized',
    ]);
    const index = await pool.query<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_branches_main'`);
    expect(index.rows).toHaveLength(1);
    expect(index.rows[0]!.indexdef).toMatch(/UNIQUE INDEX uq_branches_main ON public\.branches USING btree \(is_main\) WHERE is_main/);
  });

  it('round-trips through the generated Prisma client and rolls back', async () => {
    const marker = new Error('rollback');
    await expect(
      prisma.$transaction(async (tx) => {
        const created = await tx.branch.create({
          data: { code: `${tag}-P`, name: { ar: 'فرع الاختبار', en: 'Test branch' }, phone: '+966500000000', timezone: 'Asia/Riyadh' },
        });
        expect(created).toMatchObject({ code: `${tag}-P`, isMain: false, isActive: true, address: null, timezone: 'Asia/Riyadh' });
        const read = await tx.branch.findUniqueOrThrow({ where: { code: `${tag}-P` } });
        expect(read.name).toEqual({ ar: 'فرع الاختبار', en: 'Test branch' });
        throw marker;
      }),
    ).rejects.toBe(marker);
    expect(await prisma.branch.count({ where: { code: `${tag}-P` } })).toBe(0);
  });
});
