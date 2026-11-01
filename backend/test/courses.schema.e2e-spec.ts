// TEST-039 — MOD-04-T01 schema (migration 20261101201101_mod04_courses_levels_syllabus):
// levels, courses, course_syllabus_items. Runs against the local development
// database as the APPLICATION role and is skipped when no database is
// reachable (like TEST-007). Every test runs inside a transaction that is
// rolled back, so nothing is left behind.
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
const MIGRATION = '20261101201101_mod04_courses_levels_syllabus';

// PostgreSQL SQLSTATE codes
const UNIQUE_VIOLATION = '23505';
const RESTRICT_VIOLATION = '23001';
const CHECK_VIOLATION = '23514';
const INVALID_TEXT = '22P02';

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

describe.skipIf(!available)('database schema — MOD-04 courses, levels, syllabus (e2e, TEST-039)', () => {
  let pool: Pool;
  let prisma: PrismaClient;

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
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

  // Unique values per run so a parallel e2e file never collides with this one.
  const tag = `t${Date.now().toString(36)}`.slice(0, 10).toUpperCase();
  const LEVEL_SQL = `INSERT INTO levels (code, name, sort_order) VALUES ($1, $2::jsonb, $3) RETURNING id`;
  const COURSE_SQL = `INSERT INTO courses (code, name, level_id) VALUES ($1, $2::jsonb, $3) RETURNING id, status`;

  /** A free sort_order above everything in the shared dev database. */
  async function nextLevelOrder(client: PoolClient): Promise<number> {
    const { rows } = await client.query<{ n: number }>(`SELECT COALESCE(MAX(sort_order), -1)::int + 1 AS n FROM levels`);
    return rows[0]!.n;
  }

  it('is applied after the first migrations and creates the enum with its three states', async () => {
    const migrations = await pool.query<{ migration_name: string; ok: boolean }>(
      `SELECT migration_name, finished_at IS NOT NULL AND rolled_back_at IS NULL AS ok FROM _prisma_migrations ORDER BY started_at`,
    );
    const names = migrations.rows.map((row) => row.migration_name);
    expect(names).toContain(MIGRATION);
    expect(names.indexOf(MIGRATION)).toBeGreaterThan(names.indexOf('20261029150949_init_identity_academy'));
    expect(migrations.rows.every((row) => row.ok)).toBe(true);

    const values = await pool.query<{ v: string }>(`SELECT unnest(enum_range(NULL::course_status))::text AS v`);
    expect(values.rows.map((row) => row.v)).toEqual(['draft', 'published', 'archived']);
  });

  it('makes both order uniques DEFERRABLE INITIALLY DEFERRED constraints', async () => {
    const { rows } = await pool.query<{ conname: string; contype: string; deferrable: boolean; deferred: boolean }>(
      `SELECT conname, contype, condeferrable AS deferrable, condeferred AS deferred
         FROM pg_constraint
        WHERE conname IN ('uq_levels_sort_order', 'uq_course_syllabus_items_course_order')
        ORDER BY conname`,
    );
    expect(rows).toEqual([
      { conname: 'uq_course_syllabus_items_course_order', contype: 'u', deferrable: true, deferred: true },
      { conname: 'uq_levels_sort_order', contype: 'u', deferrable: true, deferred: true },
    ]);
  });

  it('defaults new courses to draft and rejects unknown states', async () => {
    await inRollback(async (client) => {
      const course = await client.query<{ id: string; status: string }>(COURSE_SQL, [`${tag}-D`, '{"ar":"دورة"}', null]);
      expect(course.rows[0]!.status).toBe('draft');
      await expectSqlError(client, `UPDATE courses SET status = 'deleted' WHERE id = $1`, [course.rows[0]!.id], INVALID_TEXT);
      await client.query(`UPDATE courses SET status = 'published' WHERE id = $1`, [course.rows[0]!.id]);
      await client.query(`UPDATE courses SET status = 'archived' WHERE id = $1`, [course.rows[0]!.id]);
    });
  });

  it('enforces the hand-written CHECKs (localized text with ar, trimmed codes, positive numbers, age range)', async () => {
    await inRollback(async (client) => {
      const order = await nextLevelOrder(client);
      await expectSqlError(client, LEVEL_SQL, [`${tag}-A`, '{"en":"no arabic"}', order], CHECK_VIOLATION);
      await expectSqlError(client, LEVEL_SQL, [`${tag}-B`, '"plain text"', order], CHECK_VIOLATION);
      await expectSqlError(client, LEVEL_SQL, [` ${tag}`, '{"ar":"مسافة"}', order], CHECK_VIOLATION);
      await expectSqlError(client, LEVEL_SQL, ['', '{"ar":"فارغ"}', order], CHECK_VIOLATION);
      await expectSqlError(client, LEVEL_SQL, [`${tag}-N`, '{"ar":"سالب"}', -1], CHECK_VIOLATION);
      await expectSqlError(
        client,
        `INSERT INTO levels (code, name, description, sort_order) VALUES ($1, '{"ar":"م"}', '{"en":"x"}', $2)`,
        [`${tag}-C`, order],
        CHECK_VIOLATION,
      );

      await expectSqlError(client, COURSE_SQL, [`${tag}-E`, '{"en":"no arabic"}', null], CHECK_VIOLATION);
      await expectSqlError(client, COURSE_SQL, [`${tag} `, '{"ar":"مسافة"}', null], CHECK_VIOLATION);
      const withColumn = (column: string) =>
        `INSERT INTO courses (code, name, ${column}) VALUES ($1, '{"ar":"دورة"}', $2)`;
      await expectSqlError(client, withColumn('summary'), [`${tag}-S`, '{"en":"x"}'], CHECK_VIOLATION);
      await expectSqlError(client, withColumn('description'), [`${tag}-T`, '[]'], CHECK_VIOLATION);
      await expectSqlError(client, withColumn('duration_hours'), [`${tag}-H`, 0], CHECK_VIOLATION);
      await expectSqlError(client, withColumn('sessions_count'), [`${tag}-K`, 0], CHECK_VIOLATION);
      await expectSqlError(client, withColumn('min_age'), [`${tag}-M`, -1], CHECK_VIOLATION);
      await expectSqlError(
        client,
        `INSERT INTO courses (code, name, min_age, max_age) VALUES ($1, '{"ar":"دورة"}', 12, 10)`,
        [`${tag}-R`],
        CHECK_VIOLATION,
      );
      await client.query(
        `INSERT INTO courses (code, name, summary, duration_hours, sessions_count, min_age, max_age)
         VALUES ($1, '{"ar":"دورة","en":"Course"}', '{"ar":"ملخص"}', 12.5, 10, 8, 8)`,
        [`${tag}-OK`],
      );

      const course = await client.query<{ id: string }>(COURSE_SQL, [`${tag}-SY`, '{"ar":"دورة"}', null]);
      const courseId = course.rows[0]!.id;
      const ITEM_SQL = `INSERT INTO course_syllabus_items (course_id, sort_order, title, estimated_minutes) VALUES ($1, $2, $3::jsonb, $4)`;
      await expectSqlError(client, ITEM_SQL, [courseId, 0, '{"en":"x"}', null], CHECK_VIOLATION);
      await expectSqlError(client, ITEM_SQL, [courseId, -1, '{"ar":"بند"}', null], CHECK_VIOLATION);
      await expectSqlError(client, ITEM_SQL, [courseId, 0, '{"ar":"بند"}', 0], CHECK_VIOLATION);
      await client.query(ITEM_SQL, [courseId, 0, '{"ar":"بند"}', 45]);
    });
  });

  it('keeps level and course codes unique', async () => {
    await inRollback(async (client) => {
      const order = await nextLevelOrder(client);
      await client.query(LEVEL_SQL, [`${tag}-U`, '{"ar":"مستوى"}', order]);
      await expectSqlError(client, LEVEL_SQL, [`${tag}-U`, '{"ar":"مكرر"}', order + 1], UNIQUE_VIOLATION);
      await client.query(COURSE_SQL, [`${tag}-UC`, '{"ar":"دورة"}', null]);
      await expectSqlError(client, COURSE_SQL, [`${tag}-UC`, '{"ar":"مكررة"}', null], UNIQUE_VIOLATION);
    });
  });

  it('lets a transaction swap sort orders and rejects a duplicate when the constraint is checked', async () => {
    await inRollback(async (client) => {
      const order = await nextLevelOrder(client);
      const a = (await client.query<{ id: string }>(LEVEL_SQL, [`${tag}-L1`, '{"ar":"أ"}', order])).rows[0]!.id;
      const b = (await client.query<{ id: string }>(LEVEL_SQL, [`${tag}-L2`, '{"ar":"ب"}', order + 1])).rows[0]!.id;
      // Swap with two plain statements: legal only because the unique is deferred.
      await client.query(`UPDATE levels SET sort_order = $2 WHERE id = $1`, [a, order + 1]);
      await client.query(`UPDATE levels SET sort_order = $2 WHERE id = $1`, [b, order]);
      await client.query('SET CONSTRAINTS uq_levels_sort_order IMMEDIATE');
      await client.query('SET CONSTRAINTS uq_levels_sort_order DEFERRED');
      await client.query(`UPDATE levels SET sort_order = $2 WHERE id = $1`, [a, order]);
      await expectSqlError(client, 'SET CONSTRAINTS uq_levels_sort_order IMMEDIATE', [], UNIQUE_VIOLATION);

      const course = await client.query<{ id: string }>(COURSE_SQL, [`${tag}-SW`, '{"ar":"دورة"}', null]);
      const courseId = course.rows[0]!.id;
      const ITEM_SQL = `INSERT INTO course_syllabus_items (course_id, sort_order, title) VALUES ($1, $2, '{"ar":"بند"}') RETURNING id`;
      const first = (await client.query<{ id: string }>(ITEM_SQL, [courseId, 0])).rows[0]!.id;
      const second = (await client.query<{ id: string }>(ITEM_SQL, [courseId, 1])).rows[0]!.id;
      await client.query(`UPDATE course_syllabus_items SET sort_order = 1 WHERE id = $1`, [first]);
      await client.query(`UPDATE course_syllabus_items SET sort_order = 0 WHERE id = $1`, [second]);
      await client.query('SET CONSTRAINTS uq_course_syllabus_items_course_order IMMEDIATE');
      // The same order in another course is fine.
      const other = await client.query<{ id: string }>(COURSE_SQL, [`${tag}-SW2`, '{"ar":"أخرى"}', null]);
      await client.query(ITEM_SQL, [other.rows[0]!.id, 0]);
    });
  });

  it('applies the delete rules: level restrict, syllabus cascade, creator set null', async () => {
    await inRollback(async (client) => {
      const order = await nextLevelOrder(client);
      const level = (await client.query<{ id: string }>(LEVEL_SQL, [`${tag}-DL`, '{"ar":"مستوى"}', order])).rows[0]!.id;
      const user = await client.query<{ id: string }>(
        `INSERT INTO users (full_name, email) VALUES ('creator', $1) RETURNING id`,
        [`${tag.toLowerCase()}-creator@example.com`],
      );
      const course = await client.query<{ id: string }>(
        `INSERT INTO courses (code, name, level_id, created_by) VALUES ($1, '{"ar":"دورة"}', $2, $3) RETURNING id`,
        [`${tag}-DC`, level, user.rows[0]!.id],
      );
      const courseId = course.rows[0]!.id;
      await client.query(`INSERT INTO course_syllabus_items (course_id, sort_order, title) VALUES ($1, 0, '{"ar":"بند"}')`, [courseId]);

      await expectSqlError(client, `DELETE FROM levels WHERE id = $1`, [level], RESTRICT_VIOLATION);

      await client.query(`DELETE FROM users WHERE id = $1`, [user.rows[0]!.id]);
      const creator = await client.query<{ created_by: string | null }>(`SELECT created_by FROM courses WHERE id = $1`, [courseId]);
      expect(creator.rows[0]!.created_by).toBeNull();

      await client.query(`DELETE FROM courses WHERE id = $1`, [courseId]);
      const items = await client.query(`SELECT 1 FROM course_syllabus_items WHERE course_id = $1`, [courseId]);
      expect(items.rows).toHaveLength(0);
      await client.query(`DELETE FROM levels WHERE id = $1`, [level]);
    });
  });

  it('round-trips through the generated Prisma client (Decimal, enum, relations) and rolls back', async () => {
    const rollback = new Error('rollback');
    await expect(
      prisma.$transaction(async (tx) => {
        const max = await tx.level.aggregate({ _max: { sortOrder: true } });
        const level = await tx.level.create({
          data: { code: `${tag}-P`, name: { ar: 'متوسط', en: 'Intermediate' }, sortOrder: (max._max.sortOrder ?? -1) + 1 },
        });
        const course = await tx.course.create({
          data: {
            code: `${tag}-PC`,
            name: { ar: 'بايثون', en: 'Python' },
            levelId: level.id,
            durationHours: '24.5',
            syllabusItems: { create: [{ sortOrder: 0, title: { ar: 'مقدمة' }, estimatedMinutes: 60 }, { sortOrder: 1, title: { ar: 'متغيرات' } }] },
          },
          include: { level: true, syllabusItems: { orderBy: { sortOrder: 'asc' } } },
        });
        expect(course.status).toBe('draft');
        expect(course.durationHours?.toString()).toBe('24.5');
        expect(course.level?.code).toBe(`${tag}-P`);
        expect(course.syllabusItems.map((item) => item.sortOrder)).toEqual([0, 1]);
        expect(course.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    const leftover = await prisma.course.count({ where: { code: `${tag}-PC` } });
    expect(leftover).toBe(0);
  });
});
