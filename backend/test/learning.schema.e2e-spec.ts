// TEST-245 — MOD-20 «My School» schema (migration 20261119131517_mod20_learning;
// roadmap §4q, D-R130..D-R135): the `course_sections` table with its deferred
// order unique, the new curriculum columns of `course_syllabus_items` (kind,
// content object, resources array of at most 20, level SetNull) and the
// `learning_progress` table — its hand-written CHECKs (a completion says when
// and how, and only a completion does; the played time never exceeds the media
// it was measured against; ranges an array), the composite foreign key that
// keeps its course equal to the lesson's course, and Restrict on the lesson,
// the course and the student. Runs against the local development database as
// the APPLICATION role and is skipped when no database is reachable (like
// TEST-134). Every data test runs inside a transaction that is rolled back, so
// it leaves nothing behind.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config as loadDotenv } from 'dotenv';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const MIGRATION = '20261119131517_mod20_learning';
const PREVIOUS_MIGRATION = '20261119094146_mod19_catalog_enrollment_requests';

// PostgreSQL SQLSTATE codes
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
/** ON DELETE RESTRICT is checked immediately and reports restrict_violation. */
const RESTRICT_VIOLATION = '23001';

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

describe.skipIf(!available)('database schema — MOD-20 curriculum and learning progress (e2e, TEST-245)', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  });

  afterAll(async () => {
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

  /** Asserts that `sql` fails with the given SQLSTATE (and constraint) without aborting the transaction. */
  async function expectSqlError(client: PoolClient, sql: string, params: unknown[], code: string, constraint?: string): Promise<void> {
    await client.query('SAVEPOINT expect_error');
    let caught: { code?: string; constraint?: string } | undefined;
    try {
      await client.query(sql, params);
    } catch (error) {
      caught = error as { code?: string; constraint?: string };
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT expect_error');
    }
    expect(caught, `expected SQLSTATE ${code} for: ${sql}`).toBeDefined();
    expect(caught?.code, sql).toBe(code);
    if (constraint) expect(caught?.constraint, sql).toBe(constraint);
  }

  // Unique values per run so a parallel e2e file never collides with this one.
  const tag = `L${Date.now().toString(36)}`.slice(0, 10).toUpperCase();

  async function course(client: PoolClient, suffix: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(`INSERT INTO courses (code, name, status) VALUES ($1, '{"ar":"دورة"}', 'published') RETURNING id`, [`${tag}-${suffix}`]);
    return rows[0]!.id;
  }
  async function section(client: PoolClient, courseId: string, sortOrder: number, title: string | null = null): Promise<string> {
    const { rows } = await client.query<{ id: string }>(`INSERT INTO course_sections (course_id, sort_order, title) VALUES ($1, $2, $3::jsonb) RETURNING id`, [courseId, sortOrder, title]);
    return rows[0]!.id;
  }
  async function lesson(client: PoolClient, courseId: string, sortOrder: number, sectionId: string | null = null): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO course_syllabus_items (course_id, sort_order, title, section_id) VALUES ($1, $2, '{"ar":"درس"}', $3) RETURNING id`,
      [courseId, sortOrder, sectionId],
    );
    return rows[0]!.id;
  }
  async function student(client: PoolClient, name: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(`INSERT INTO users (full_name, email) VALUES ($1, $2) RETURNING id`, [name, `${tag.toLowerCase()}-${name}@example.com`]);
    return rows[0]!.id;
  }

  const PROGRESS_SQL = `INSERT INTO learning_progress
      (student_user_id, syllabus_item_id, course_id, status, completion_source, first_opened_at, last_opened_at, completed_at,
       position_seconds, media_duration_seconds, watched_seconds, watched_ranges)
    VALUES ($1, $2, $3, $4::learning_status, $5::learning_completion_source, now(), now(), $6, $7, $8, $9, $10::jsonb)`;

  interface ProgressOver {
    status: string;
    source: string | null;
    completedAt: string | null;
    position: number | null;
    duration: number | null;
    watched: number;
    ranges: string;
  }
  function progressParams(studentId: string, itemId: string, courseId: string, over: Partial<ProgressOver> = {}): unknown[] {
    const p: ProgressOver = { status: 'in_progress', source: null, completedAt: null, position: null, duration: null, watched: 0, ranges: '[]', ...over };
    return [studentId, itemId, courseId, p.status, p.source, p.completedAt, p.position, p.duration, p.watched, p.ranges];
  }

  it('is applied after the MOD-19 migration, with the three enums and the defaults of the new columns', async () => {
    const migrations = await pool.query<{ migration_name: string; ok: boolean }>(
      `SELECT migration_name, finished_at IS NOT NULL AND rolled_back_at IS NULL AS ok FROM _prisma_migrations ORDER BY started_at`,
    );
    const names = migrations.rows.map((row) => row.migration_name);
    expect(names).toContain(MIGRATION);
    expect(names.indexOf(MIGRATION)).toBeGreaterThan(names.indexOf(PREVIOUS_MIGRATION));
    expect(migrations.rows.every((row) => row.ok)).toBe(true);
    const enumValues = async (name: string) => (await pool.query<{ v: string }>(`SELECT unnest(enum_range(NULL::${name}))::text AS v`)).rows.map((row) => row.v);
    expect(await enumValues('learning_item_kind')).toEqual(['text', 'video', 'audio', 'pdf', 'image', 'file', 'live']);
    expect(await enumValues('learning_status')).toEqual(['in_progress', 'completed']);
    expect(await enumValues('learning_completion_source')).toEqual(['manual', 'playback']);

    await inRollback(async (client) => {
      const courseId = await course(client, 'D');
      const itemId = await lesson(client, courseId, 0);
      const item = await client.query<Record<string, unknown>>(
        `SELECT kind::text AS kind, content, resources, is_required, is_published, section_id FROM course_syllabus_items WHERE id = $1`,
        [itemId],
      );
      // Every existing syllabus item keeps its meaning: a published, required text lesson outside any level.
      expect(item.rows[0]).toEqual({ kind: 'text', content: null, resources: [], is_required: true, is_published: true, section_id: null });
      const sectionId = await section(client, courseId, 0);
      const level = await client.query<Record<string, unknown>>(`SELECT title, description FROM course_sections WHERE id = $1`, [sectionId]);
      expect(level.rows[0]).toEqual({ title: null, description: null });
      const studentId = await student(client, 'ds');
      await client.query(PROGRESS_SQL, progressParams(studentId, itemId, courseId));
      const progress = await client.query<Record<string, unknown>>(
        `SELECT watched_seconds, watched_ranges, position_seconds, media_duration_seconds, completed_at, completion_source, last_playback_at FROM learning_progress WHERE syllabus_item_id = $1`,
        [itemId],
      );
      expect(progress.rows[0]).toEqual({
        watched_seconds: 0,
        watched_ranges: [],
        position_seconds: null,
        media_duration_seconds: null,
        completed_at: null,
        completion_source: null,
        last_playback_at: null,
      });
    });
  });

  it('enforces the course_sections CHECKs: a localized title and description need `ar`, the position is not negative', async () => {
    await inRollback(async (client) => {
      const courseId = await course(client, 'S');
      const insert = `INSERT INTO course_sections (course_id, sort_order, title, description) VALUES ($1, $2, $3::jsonb, $4::jsonb)`;
      await expectSqlError(client, insert, [courseId, 0, '{"en":"Basics"}', null], CHECK_VIOLATION, 'ck_course_sections_title_localized');
      await expectSqlError(client, insert, [courseId, 0, '"أساسيات"', null], CHECK_VIOLATION, 'ck_course_sections_title_localized');
      await expectSqlError(client, insert, [courseId, 0, null, '["وصف"]'], CHECK_VIOLATION, 'ck_course_sections_description_localized');
      await expectSqlError(client, insert, [courseId, 0, null, '{"tr":"Açıklama"}'], CHECK_VIOLATION, 'ck_course_sections_description_localized');
      await expectSqlError(client, insert, [courseId, -1, null, null], CHECK_VIOLATION, 'ck_course_sections_sort_order_nonnegative');
      // A JSON null is not the database NULL: it is refused like any non-object.
      await expectSqlError(client, insert, [courseId, 0, 'null', null], CHECK_VIOLATION, 'ck_course_sections_title_localized');
      await client.query(insert, [courseId, 0, '{"ar":"أساسيات","en":"Basics"}', '{"ar":"وصف"}']);
      await client.query(insert, [courseId, 1, null, null]);
    });
  });

  it('defers the level order unique to the commit: two levels swap in one transaction, a real duplicate fails', async () => {
    await inRollback(async (client) => {
      const courseId = await course(client, 'O');
      const first = await section(client, courseId, 0, '{"ar":"الأول"}');
      const second = await section(client, courseId, 1, '{"ar":"الثاني"}');
      // The swap passes through a duplicate (both at 1) — legal while the check is deferred.
      await client.query(`UPDATE course_sections SET sort_order = 1 WHERE id = $1`, [first]);
      await client.query(`UPDATE course_sections SET sort_order = 0 WHERE id = $1`, [second]);
      await client.query(`SET CONSTRAINTS uq_course_sections_course_order IMMEDIATE`);
      const order = await client.query<{ id: string }>(`SELECT id FROM course_sections WHERE course_id = $1 ORDER BY sort_order`, [courseId]);
      expect(order.rows.map((row) => row.id)).toEqual([second, first]);
      await client.query(`SET CONSTRAINTS uq_course_sections_course_order DEFERRED`);
      // A duplicate left in place fails when the constraint is checked.
      await client.query(`UPDATE course_sections SET sort_order = 0 WHERE id = $1`, [first]);
      await expectSqlError(client, `SET CONSTRAINTS uq_course_sections_course_order IMMEDIATE`, [], UNIQUE_VIOLATION, 'uq_course_sections_course_order');
    });
    const deferrable = await pool.query<{ condeferrable: boolean; condeferred: boolean }>(
      `SELECT condeferrable, condeferred FROM pg_constraint WHERE conname = 'uq_course_sections_course_order'`,
    );
    expect(deferrable.rows).toEqual([{ condeferrable: true, condeferred: true }]);
  });

  it('enforces the content object and the resources array of at most 20, and clears a lesson’s level when the level goes', async () => {
    await inRollback(async (client) => {
      const courseId = await course(client, 'C');
      const levelId = await section(client, courseId, 0);
      const itemId = await lesson(client, courseId, 0, levelId);
      const setContent = `UPDATE course_syllabus_items SET content = $2::jsonb WHERE id = $1`;
      await expectSqlError(client, setContent, [itemId, '"plain text"'], CHECK_VIOLATION, 'ck_course_syllabus_items_content_object');
      await expectSqlError(client, setContent, [itemId, '[{"url":"https://x.org/a.pdf"}]'], CHECK_VIOLATION, 'ck_course_syllabus_items_content_object');
      await expectSqlError(client, setContent, [itemId, 'null'], CHECK_VIOLATION, 'ck_course_syllabus_items_content_object');
      await client.query(setContent, [itemId, '{"url":"https://x.org/a.pdf"}']);
      await client.query(`UPDATE course_syllabus_items SET content = NULL WHERE id = $1`, [itemId]);

      const setResources = `UPDATE course_syllabus_items SET resources = $2::jsonb WHERE id = $1`;
      const resource = { title: { ar: 'ملف' }, url: 'https://x.org/a.pdf' };
      await expectSqlError(client, setResources, [itemId, JSON.stringify(Array.from({ length: 21 }, () => resource))], CHECK_VIOLATION, 'ck_course_syllabus_items_resources_array');
      await expectSqlError(client, setResources, [itemId, JSON.stringify(resource)], CHECK_VIOLATION, 'ck_course_syllabus_items_resources_array');
      await expectSqlError(client, `UPDATE course_syllabus_items SET resources = NULL WHERE id = $1`, [itemId], '23502'); // NOT NULL
      await client.query(setResources, [itemId, JSON.stringify(Array.from({ length: 20 }, () => resource))]);

      await client.query(`DELETE FROM course_sections WHERE id = $1`, [levelId]);
      const after = await client.query<{ section_id: string | null }>(`SELECT section_id FROM course_syllabus_items WHERE id = $1`, [itemId]);
      expect(after.rows[0]).toEqual({ section_id: null });
    });
  });

  it('enforces the learning_progress CHECKs: completion exactly with its instant and source, played time within the media', async () => {
    await inRollback(async (client) => {
      const courseId = await course(client, 'P');
      const studentId = await student(client, 'ps');
      const items: string[] = [];
      for (const order of [0, 1, 2, 3, 4]) items.push(await lesson(client, courseId, order));
      const [a, b, c, d, e] = items as [string, string, string, string, string];
      const when = '2026-11-19T10:00:00Z';
      const fail = (itemId: string, over: Partial<ProgressOver>, constraint: string) =>
        expectSqlError(client, PROGRESS_SQL, progressParams(studentId, itemId, courseId, over), CHECK_VIOLATION, constraint);

      await fail(a, { status: 'completed', source: 'manual' }, 'ck_learning_progress_completed_at');
      await fail(a, { status: 'in_progress', completedAt: when }, 'ck_learning_progress_completed_at');
      await fail(a, { status: 'completed', completedAt: when }, 'ck_learning_progress_completion_source');
      await fail(a, { status: 'in_progress', source: 'playback' }, 'ck_learning_progress_completion_source');
      await fail(a, { position: -1 }, 'ck_learning_progress_position');
      await fail(a, { duration: 0 }, 'ck_learning_progress_media_duration');
      await fail(a, { watched: -1 }, 'ck_learning_progress_watched_seconds');
      await fail(a, { duration: 600, watched: 601 }, 'ck_learning_progress_watched_seconds');
      await fail(a, { ranges: '{"0":[0,10]}' }, 'ck_learning_progress_watched_ranges_array');
      await fail(a, { ranges: JSON.stringify(Array.from({ length: 201 }, (_v, i) => [i * 2, i * 2 + 1])) }, 'ck_learning_progress_watched_ranges_array');

      // Valid rows: opened only; completed by the button; completed by playback with the whole media played; 200 ranges.
      await client.query(PROGRESS_SQL, progressParams(studentId, a, courseId));
      await client.query(PROGRESS_SQL, progressParams(studentId, b, courseId, { status: 'completed', source: 'manual', completedAt: when }));
      await client.query(PROGRESS_SQL, progressParams(studentId, c, courseId, { status: 'completed', source: 'playback', completedAt: when, position: 600, duration: 600, watched: 600, ranges: '[[0,600]]' }));
      await client.query(PROGRESS_SQL, progressParams(studentId, d, courseId, { duration: 1000, watched: 200, ranges: JSON.stringify(Array.from({ length: 200 }, (_v, i) => [i * 5, i * 5 + 1])) }));
      // Watched seconds without a known duration are not bounded by it.
      await client.query(PROGRESS_SQL, progressParams(studentId, e, courseId, { watched: 30, position: 30 }));
      // One row per (student, lesson).
      await expectSqlError(client, PROGRESS_SQL, progressParams(studentId, a, courseId), UNIQUE_VIOLATION, 'learning_progress_pkey');
    });
  });

  it('keeps a progress row on its lesson’s own course (composite foreign key) and restricts deleting the lesson, the course and the student', async () => {
    await inRollback(async (client) => {
      const courseId = await course(client, 'F');
      const otherCourseId = await course(client, 'G');
      const itemId = await lesson(client, courseId, 0);
      const studentId = await student(client, 'fs');
      await expectSqlError(
        client,
        PROGRESS_SQL,
        progressParams(studentId, itemId, otherCourseId),
        FOREIGN_KEY_VIOLATION,
        'learning_progress_syllabus_item_id_course_id_fkey',
      );
      await client.query(PROGRESS_SQL, progressParams(studentId, itemId, courseId));
      // The course of a row cannot drift away from its lesson's either.
      await expectSqlError(client, `UPDATE learning_progress SET course_id = $2 WHERE syllabus_item_id = $1`, [itemId, otherCourseId], FOREIGN_KEY_VIOLATION);
      await expectSqlError(client, `DELETE FROM course_syllabus_items WHERE id = $1`, [itemId], RESTRICT_VIOLATION, 'learning_progress_syllabus_item_id_course_id_fkey');
      await expectSqlError(client, `DELETE FROM courses WHERE id = $1`, [courseId], RESTRICT_VIOLATION);
      await expectSqlError(client, `DELETE FROM users WHERE id = $1`, [studentId], RESTRICT_VIOLATION, 'learning_progress_student_user_id_fkey');
      // Once the progress row goes, the lesson can be deleted.
      await client.query(`DELETE FROM learning_progress WHERE syllabus_item_id = $1`, [itemId]);
      await client.query(`DELETE FROM course_syllabus_items WHERE id = $1`, [itemId]);
    });
  });

  it('names the hand-written CHECKs and the keys of the migration', async () => {
    const constraints = await pool.query<{ table_name: string; conname: string; contype: string }>(
      `SELECT conrelid::regclass::text AS table_name, conname, contype::text AS contype
         FROM pg_constraint
        WHERE contype IN ('c', 'u', 'f')
          AND (conrelid = ANY($1::regclass[]) OR (conrelid = 'course_syllabus_items'::regclass AND (conname LIKE 'ck_course_syllabus_items_content%' OR conname LIKE 'ck_course_syllabus_items_resources%' OR conname LIKE '%section%')))
        ORDER BY conrelid::regclass::text COLLATE "C", conname::text COLLATE "C"`,
      [['course_sections', 'learning_progress']],
    );
    expect(constraints.rows).toEqual([
      { table_name: 'course_sections', conname: 'ck_course_sections_description_localized', contype: 'c' },
      { table_name: 'course_sections', conname: 'ck_course_sections_sort_order_nonnegative', contype: 'c' },
      { table_name: 'course_sections', conname: 'ck_course_sections_title_localized', contype: 'c' },
      { table_name: 'course_sections', conname: 'course_sections_course_id_fkey', contype: 'f' },
      { table_name: 'course_sections', conname: 'uq_course_sections_course_order', contype: 'u' },
      { table_name: 'course_syllabus_items', conname: 'ck_course_syllabus_items_content_object', contype: 'c' },
      { table_name: 'course_syllabus_items', conname: 'ck_course_syllabus_items_resources_array', contype: 'c' },
      { table_name: 'course_syllabus_items', conname: 'course_syllabus_items_section_id_fkey', contype: 'f' },
      { table_name: 'learning_progress', conname: 'ck_learning_progress_completed_at', contype: 'c' },
      { table_name: 'learning_progress', conname: 'ck_learning_progress_completion_source', contype: 'c' },
      { table_name: 'learning_progress', conname: 'ck_learning_progress_media_duration', contype: 'c' },
      { table_name: 'learning_progress', conname: 'ck_learning_progress_position', contype: 'c' },
      { table_name: 'learning_progress', conname: 'ck_learning_progress_watched_ranges_array', contype: 'c' },
      { table_name: 'learning_progress', conname: 'ck_learning_progress_watched_seconds', contype: 'c' },
      { table_name: 'learning_progress', conname: 'learning_progress_course_id_fkey', contype: 'f' },
      { table_name: 'learning_progress', conname: 'learning_progress_student_user_id_fkey', contype: 'f' },
      { table_name: 'learning_progress', conname: 'learning_progress_syllabus_item_id_course_id_fkey', contype: 'f' },
    ]);
    // The target of the composite key: a unique index on (id, course_id).
    const index = await pool.query<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_course_syllabus_items_id_course'`);
    expect(index.rows[0]!.indexdef).toMatch(/UNIQUE INDEX uq_course_syllabus_items_id_course ON public\.course_syllabus_items USING btree \(id, course_id\)$/);
  });
});
