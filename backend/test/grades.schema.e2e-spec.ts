// TEST-127 — MOD-09-T01 schema (migration 20261110165437_mod09_exams_grades):
// the `exams`, `exam_results`, `grade_schemes`, `grade_scheme_bands` and
// `final_grades` tables, their three enums, the hand-written CHECKs (localized
// texts, positive max score, pass score within it, weight, duration, published
// instant, score only when scored, a default scheme is active, band range and
// letter, final percent, breakdown array), the "one default scheme" partial
// unique index, the one-result-per-student key, the one-band-per-minimum key
// and the referential actions. Runs against the local development database as
// the APPLICATION role and is skipped when no database is reachable (like
// TEST-007/TEST-076/TEST-122). Every data test runs inside a transaction that
// is rolled back.
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
const MIGRATION = '20261110165437_mod09_exams_grades';
const PREVIOUS_MIGRATION = '20261109135154_mod08_assignments_submissions';
const TABLES = ['exams', 'exam_results', 'grade_schemes', 'grade_scheme_bands', 'final_grades'] as const;

// PostgreSQL SQLSTATE codes
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
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

describe.skipIf(!available)('database schema — MOD-09 exams and grades (e2e, TEST-127)', () => {
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
    expect(caught?.code).toBe(code);
    if (constraint) expect(caught?.constraint).toBe(constraint);
  }

  // Unique values per run so a parallel e2e file never collides with this one.
  const tag = `G${Date.now().toString(36)}`.slice(0, 10).toUpperCase();
  const TITLE = '{"ar":"اختبار"}';
  const PUBLISHED = '2026-11-20T10:00:00Z';
  const EXAM_SQL = `INSERT INTO exams (class_id, lesson_id, title, description, type, status, scheduled_at, duration_minutes, max_score, pass_score, weight, published_at, created_by)
                    VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::exam_type, $6::exam_status, $7, $8, $9, $10, $11, $12, $13) RETURNING id`;
  const RESULT_SQL = `INSERT INTO exam_results (exam_id, student_user_id, status, score, feedback, recorded_by)
                      VALUES ($1, $2, $3::exam_result_status, $4, $5, $6)`;
  const SCHEME_SQL = `INSERT INTO grade_schemes (name, is_default, is_active) VALUES ($1::jsonb, $2, $3) RETURNING id`;
  const BAND_SQL = `INSERT INTO grade_scheme_bands (scheme_id, min_percent, label, letter, is_pass) VALUES ($1, $2, $3::jsonb, $4, $5) RETURNING id`;
  const FINAL_SQL = `INSERT INTO final_grades (enrollment_id, percent, scheme_id, band_label, band_letter, is_pass, breakdown, finalized_by)
                     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8)`;

  interface ExamOver {
    lessonId: string | null;
    title: string;
    description: string | null;
    type: string;
    status: string;
    scheduledAt: string | null;
    durationMinutes: number | null;
    maxScore: number;
    passScore: number | null;
    weight: number | null;
    publishedAt: string | null;
    createdBy: string | null;
  }
  /** An exam with defaults: a draft quiz worth 100, no lesson, no date, no weight. */
  function examParams(classId: string, over: Partial<ExamOver> = {}): unknown[] {
    const e: ExamOver = {
      lessonId: null,
      title: TITLE,
      description: null,
      type: 'quiz',
      status: 'draft',
      scheduledAt: null,
      durationMinutes: null,
      maxScore: 100,
      passScore: null,
      weight: null,
      publishedAt: null,
      createdBy: null,
      ...over,
    };
    return [classId, e.lessonId, e.title, e.description, e.type, e.status, e.scheduledAt, e.durationMinutes, e.maxScore, e.passScore, e.weight, e.publishedAt, e.createdBy];
  }
  async function exam(client: PoolClient, classId: string, over: Partial<ExamOver> = {}): Promise<string> {
    return (await client.query<{ id: string }>(EXAM_SQL, examParams(classId, over))).rows[0]!.id;
  }

  /** A grade scheme with a failing band at 0 and a passing band at 60. */
  async function scheme(client: PoolClient, isDefault = false): Promise<string> {
    const id = (await client.query<{ id: string }>(SCHEME_SQL, ['{"ar":"سلّم"}', isDefault, true])).rows[0]!.id;
    await client.query(BAND_SQL, [id, 0, '{"ar":"راسب"}', 'F', false]);
    await client.query(BAND_SQL, [id, 60, '{"ar":"ناجح"}', null, true]);
    return id;
  }

  async function klass(client: PoolClient, suffix: string): Promise<string> {
    const course = await client.query<{ id: string }>(`INSERT INTO courses (code, name, status) VALUES ($1, '{"ar":"دورة"}', 'published') RETURNING id`, [`${tag}-${suffix}`]);
    const created = await client.query<{ id: string }>(`INSERT INTO classes (course_id, code, name, capacity) VALUES ($1, $2, '{"ar":"فصل"}', 20) RETURNING id`, [
      course.rows[0]!.id,
      `${tag}-${suffix}`,
    ]);
    return created.rows[0]!.id;
  }
  async function lesson(client: PoolClient, classId: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO lessons (class_id, title, starts_at, ends_at) VALUES ($1, '{"ar":"درس"}', '2026-11-10T10:00:00Z', '2026-11-10T11:00:00Z') RETURNING id`,
      [classId],
    );
    return rows[0]!.id;
  }
  async function user(client: PoolClient, name: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(`INSERT INTO users (full_name, email) VALUES ($1, $2) RETURNING id`, [name, `${tag.toLowerCase()}-${name}@example.com`]);
    return rows[0]!.id;
  }
  async function enrollment(client: PoolClient, classId: string, studentId: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(`INSERT INTO enrollments (class_id, student_user_id, status) VALUES ($1, $2, 'active') RETURNING id`, [classId, studentId]);
    return rows[0]!.id;
  }
  const count = async (client: PoolClient, sql: string, params: unknown[]) => (await client.query<{ n: number }>(sql, params)).rows[0]!.n;

  it('is applied after the MOD-08 migration, with the three enums and the defaults of the five tables', async () => {
    const migrations = await pool.query<{ migration_name: string; ok: boolean }>(
      `SELECT migration_name, finished_at IS NOT NULL AND rolled_back_at IS NULL AS ok FROM _prisma_migrations ORDER BY started_at`,
    );
    const names = migrations.rows.map((row) => row.migration_name);
    expect(names).toContain(MIGRATION);
    expect(names.indexOf(MIGRATION)).toBeGreaterThan(names.indexOf(PREVIOUS_MIGRATION));
    expect(migrations.rows.every((row) => row.ok)).toBe(true);

    const enums = async (name: string) => (await pool.query<{ v: string }>(`SELECT unnest(enum_range(NULL::${name}))::text AS v`)).rows.map((row) => row.v);
    expect(await enums('exam_type')).toEqual(['quiz', 'midterm', 'final', 'project', 'oral', 'practice', 'other']);
    expect(await enums('exam_status')).toEqual(['draft', 'scheduled', 'published']);
    expect(await enums('exam_result_status')).toEqual(['scored', 'absent', 'excused']);

    await inRollback(async (client) => {
      const classId = await klass(client, 'D');
      const created = await client.query<Record<string, unknown>>(
        `INSERT INTO exams (class_id, title, type, max_score) VALUES ($1, $2::jsonb, 'final', 50)
         RETURNING status, lesson_id, description, scheduled_at, duration_minutes, pass_score, weight, published_at, created_by`,
        [classId, TITLE],
      );
      expect(created.rows[0]).toEqual({
        status: 'draft',
        lesson_id: null,
        description: null,
        scheduled_at: null,
        duration_minutes: null,
        pass_score: null,
        weight: null,
        published_at: null,
        created_by: null,
      });
      const examId = await exam(client, classId);
      const student = await user(client, 'd');
      const result = await client.query<Record<string, unknown>>(
        `INSERT INTO exam_results (exam_id, student_user_id, status) VALUES ($1, $2, 'absent')
         RETURNING score, feedback, recorded_by, recorded_at IS NOT NULL AS recorded`,
        [examId, student],
      );
      expect(result.rows[0]).toEqual({ score: null, feedback: null, recorded_by: null, recorded: true });
      const schemeRow = await client.query<Record<string, unknown>>(`INSERT INTO grade_schemes (name) VALUES ('{"ar":"سلّم"}') RETURNING is_default, is_active`);
      expect(schemeRow.rows[0]).toEqual({ is_default: false, is_active: true });
    });
  });

  it('gives the application role DML without TRUNCATE on the five tables, and adds no extension', async () => {
    for (const table of TABLES) {
      const privileges = await pool.query<{ dml: boolean; truncate: boolean }>(
        `SELECT has_table_privilege(current_user, $1, 'SELECT, INSERT, UPDATE, DELETE') AS dml,
                has_table_privilege(current_user, $1, 'TRUNCATE') AS truncate`,
        [table],
      );
      expect(privileges.rows[0], table).toEqual({ dml: true, truncate: false });
    }
    const extensions = await pool.query<{ extname: string }>(`SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY 1`);
    expect(extensions.rows.map((row) => row.extname)).toEqual(['btree_gist']);
  });

  it('enforces the exams CHECKs (localized texts, positive max score, pass score within it, weight, duration, published instant) — AC2', async () => {
    await inRollback(async (client) => {
      const classId = await klass(client, 'C');
      await expectSqlError(client, EXAM_SQL, examParams(classId, { title: '{"en":"no arabic"}' }), CHECK_VIOLATION, 'ck_exams_title_localized');
      await expectSqlError(client, EXAM_SQL, examParams(classId, { title: '"plain"' }), CHECK_VIOLATION, 'ck_exams_title_localized');
      await expectSqlError(client, EXAM_SQL, examParams(classId, { description: '{"en":"no arabic"}' }), CHECK_VIOLATION, 'ck_exams_description_localized');
      await expectSqlError(client, EXAM_SQL, examParams(classId, { maxScore: 0 }), CHECK_VIOLATION, 'ck_exams_max_score_positive');
      await expectSqlError(client, EXAM_SQL, examParams(classId, { maxScore: 20, passScore: 21 }), CHECK_VIOLATION, 'ck_exams_pass_score_range');
      await expectSqlError(client, EXAM_SQL, examParams(classId, { passScore: -1 }), CHECK_VIOLATION, 'ck_exams_pass_score_range');
      await expectSqlError(client, EXAM_SQL, examParams(classId, { weight: -0.5 }), CHECK_VIOLATION, 'ck_exams_weight_non_negative');
      await expectSqlError(client, EXAM_SQL, examParams(classId, { durationMinutes: 0 }), CHECK_VIOLATION, 'ck_exams_duration_range');
      await expectSqlError(client, EXAM_SQL, examParams(classId, { durationMinutes: 721 }), CHECK_VIOLATION, 'ck_exams_duration_range');
      // The results are published exactly when the exam is.
      await expectSqlError(client, EXAM_SQL, examParams(classId, { status: 'published' }), CHECK_VIOLATION, 'ck_exams_published_at');
      await expectSqlError(client, EXAM_SQL, examParams(classId, { status: 'scheduled', publishedAt: PUBLISHED }), CHECK_VIOLATION, 'ck_exams_published_at');
      // Valid: a description with `ar`, a pass score equal to the max, a weight of 0, 720 minutes, a scheduled and a published exam.
      await exam(client, classId, { description: '{"ar":"الوصف","en":"About"}', maxScore: 20, passScore: 20, weight: 0, durationMinutes: 720, type: 'project' });
      await exam(client, classId, { status: 'scheduled', scheduledAt: '2026-11-20T08:00:00Z', durationMinutes: 60 });
      await exam(client, classId, { status: 'published', publishedAt: PUBLISHED, weight: 30, type: 'final' });
    });
  });

  it('enforces the result CHECKs (score only when scored, non-negative) and one result per student and exam — AC2, AC3', async () => {
    await inRollback(async (client) => {
      const classId = await klass(client, 'R');
      const examId = await exam(client, classId, { status: 'scheduled' });
      const s1 = await user(client, 's1');
      const s2 = await user(client, 's2');
      const s3 = await user(client, 's3');
      await expectSqlError(client, RESULT_SQL, [examId, s1, 'scored', null, null, null], CHECK_VIOLATION, 'ck_exam_results_score_only_scored');
      await expectSqlError(client, RESULT_SQL, [examId, s1, 'absent', 10, null, null], CHECK_VIOLATION, 'ck_exam_results_score_only_scored');
      await expectSqlError(client, RESULT_SQL, [examId, s1, 'excused', 0, null, null], CHECK_VIOLATION, 'ck_exam_results_score_only_scored');
      await expectSqlError(client, RESULT_SQL, [examId, s1, 'scored', -1, null, null], CHECK_VIOLATION, 'ck_exam_results_score_non_negative');
      // Valid: a score of 0 with feedback, an absence, an excuse; the same student twice is refused.
      await client.query(RESULT_SQL, [examId, s1, 'scored', 0, 'حاول مجدداً', null]);
      await client.query(RESULT_SQL, [examId, s2, 'absent', null, null, null]);
      await client.query(RESULT_SQL, [examId, s3, 'excused', null, 'عذر طبي', null]);
      await expectSqlError(client, RESULT_SQL, [examId, s1, 'scored', 5, null, null], UNIQUE_VIOLATION, 'exam_results_pkey');
      expect(await count(client, `SELECT count(*)::int AS n FROM exam_results WHERE exam_id = $1`, [examId])).toBe(3);
    });
  });

  it('enforces the grade scheme rules: localized names and labels, one default scheme that is active, one band per minimum in 0..100, trimmed letters — AC2, AC3', async () => {
    await inRollback(async (client) => {
      // Leave any default the development database already holds out of the way of this test (rolled back).
      await client.query(`UPDATE grade_schemes SET is_default = false WHERE is_default`);
      await expectSqlError(client, SCHEME_SQL, ['{"en":"no arabic"}', false, true], CHECK_VIOLATION, 'ck_grade_schemes_name_localized');
      await expectSqlError(client, SCHEME_SQL, ['{"ar":"سلّم"}', true, false], CHECK_VIOLATION, 'ck_grade_schemes_default_active');
      const first = await scheme(client, true);
      await expectSqlError(client, SCHEME_SQL, ['{"ar":"سلّم ثانٍ"}', true, true], UNIQUE_VIOLATION, 'uq_grade_schemes_default');
      const second = await scheme(client, false); // any number of non-default schemes
      await expectSqlError(client, `UPDATE grade_schemes SET is_active = false WHERE id = $1`, [first], CHECK_VIOLATION, 'ck_grade_schemes_default_active');

      await expectSqlError(client, BAND_SQL, [second, 60, '{"ar":"مكرر"}', null, true], UNIQUE_VIOLATION, 'uq_grade_scheme_bands_min');
      await expectSqlError(client, BAND_SQL, [second, 100.01, '{"ar":"فوق"}', null, true], CHECK_VIOLATION, 'ck_grade_scheme_bands_min_percent_range');
      await expectSqlError(client, BAND_SQL, [second, -1, '{"ar":"تحت"}', null, false], CHECK_VIOLATION, 'ck_grade_scheme_bands_min_percent_range');
      await expectSqlError(client, BAND_SQL, [second, 90, '{"en":"no arabic"}', null, true], CHECK_VIOLATION, 'ck_grade_scheme_bands_label_localized');
      await expectSqlError(client, BAND_SQL, [second, 90, '{"ar":"ممتاز"}', ' A', true], CHECK_VIOLATION, 'ck_grade_scheme_bands_letter_trimmed');
      await expectSqlError(client, BAND_SQL, [second, 90, '{"ar":"ممتاز"}', '', true], CHECK_VIOLATION, 'ck_grade_scheme_bands_letter_trimmed');
      await client.query(BAND_SQL, [second, 100, '{"ar":"كامل","en":"Perfect"}', 'A+', true]);
      // Bands go with their scheme.
      await client.query(`DELETE FROM grade_schemes WHERE id = $1`, [second]);
      expect(await count(client, `SELECT count(*)::int AS n FROM grade_scheme_bands WHERE scheme_id = $1`, [second])).toBe(0);
    });
  });

  it('enforces the final grade CHECKs (percent 0..100, localized band label, trimmed letter, breakdown array) and one per enrollment — AC2, AC3', async () => {
    await inRollback(async (client) => {
      const classId = await klass(client, 'F');
      const schemeId = await scheme(client);
      const e1 = await enrollment(client, classId, await user(client, 'f1'));
      const valid = (over: Partial<{ percent: number; label: string; letter: string | null; breakdown: string }> = {}) => {
        const f = { percent: 87.5, label: '{"ar":"جيد جداً"}', letter: 'B+', breakdown: '[{"kind":"exam","weight":30}]', ...over };
        return [e1, f.percent, schemeId, f.label, f.letter, true, f.breakdown, null];
      };
      await expectSqlError(client, FINAL_SQL, valid({ percent: 100.01 }), CHECK_VIOLATION, 'ck_final_grades_percent_range');
      await expectSqlError(client, FINAL_SQL, valid({ percent: -0.01 }), CHECK_VIOLATION, 'ck_final_grades_percent_range');
      await expectSqlError(client, FINAL_SQL, valid({ label: '{"en":"Very good"}' }), CHECK_VIOLATION, 'ck_final_grades_band_label_localized');
      await expectSqlError(client, FINAL_SQL, valid({ letter: 'B+ ' }), CHECK_VIOLATION, 'ck_final_grades_band_letter_trimmed');
      await expectSqlError(client, FINAL_SQL, valid({ breakdown: '{"kind":"exam"}' }), CHECK_VIOLATION, 'ck_final_grades_breakdown_array');
      await client.query(FINAL_SQL, valid());
      await expectSqlError(client, FINAL_SQL, valid({ percent: 90 }), UNIQUE_VIOLATION, 'final_grades_pkey');
      const row = await client.query<{ percent: string; finalized: boolean }>(`SELECT percent::text, finalized_at IS NOT NULL AS finalized FROM final_grades WHERE enrollment_id = $1`, [e1]);
      expect(row.rows[0]).toEqual({ percent: '87.50', finalized: true });
    });
  });

  it('cascades a deleted class to its exams and results, clears the lesson, creator, recorder and finalizer links, restricts students and used schemes, and deletes a final grade with its enrollment — AC4', async () => {
    await inRollback(async (client) => {
      const classId = await klass(client, 'FK');
      const lessonId = await lesson(client, classId);
      const creator = await user(client, 'fkcreator');
      const recorder = await user(client, 'fkrecorder');
      const student = await user(client, 'fkstudent');
      const examId = await exam(client, classId, { lessonId, createdBy: creator, status: 'scheduled' });
      await client.query(RESULT_SQL, [examId, student, 'scored', 42, null, recorder]);

      await expectSqlError(client, `DELETE FROM users WHERE id = $1`, [student], RESTRICT_VIOLATION, 'exam_results_student_user_id_fkey');

      await client.query(`DELETE FROM lessons WHERE id = $1`, [lessonId]);
      await client.query(`DELETE FROM users WHERE id = $1`, [creator]);
      await client.query(`DELETE FROM users WHERE id = $1`, [recorder]);
      expect((await client.query(`SELECT lesson_id, created_by FROM exams WHERE id = $1`, [examId])).rows[0]).toEqual({ lesson_id: null, created_by: null });
      expect((await client.query(`SELECT recorded_by, score::text AS score FROM exam_results WHERE exam_id = $1`, [examId])).rows[0]).toEqual({ recorded_by: null, score: '42.00' });

      // A final grade: its scheme cannot go while it is used; it goes with its enrollment; its finalizer link is cleared.
      const otherClass = await klass(client, 'FG');
      const finalizer = await user(client, 'fkfinalizer');
      const enrollmentId = await enrollment(client, otherClass, await user(client, 'fkgraded'));
      const schemeId = await scheme(client);
      await client.query(FINAL_SQL, [enrollmentId, 75, schemeId, '{"ar":"جيد"}', null, true, '[]', finalizer]);
      await expectSqlError(client, `DELETE FROM grade_schemes WHERE id = $1`, [schemeId], RESTRICT_VIOLATION, 'final_grades_scheme_id_fkey');
      await client.query(`DELETE FROM users WHERE id = $1`, [finalizer]);
      expect((await client.query(`SELECT finalized_by FROM final_grades WHERE enrollment_id = $1`, [enrollmentId])).rows[0]).toEqual({ finalized_by: null });
      await client.query(`DELETE FROM enrollments WHERE id = $1`, [enrollmentId]);
      expect(await count(client, `SELECT count(*)::int AS n FROM final_grades WHERE enrollment_id = $1`, [enrollmentId])).toBe(0);
      await client.query(`DELETE FROM grade_schemes WHERE id = $1`, [schemeId]);

      // The exam goes with its class, and the result with the exam; then the student can go.
      await client.query(`DELETE FROM classes WHERE id = $1`, [classId]);
      expect(await count(client, `SELECT count(*)::int AS n FROM exams WHERE id = $1`, [examId])).toBe(0);
      expect(await count(client, `SELECT count(*)::int AS n FROM exam_results WHERE exam_id = $1`, [examId])).toBe(0);
      await client.query(`DELETE FROM users WHERE id = $1`, [student]);
    });
  });

  it('names the CHECKs, the keys and the partial unique index as the migration does', async () => {
    const constraints = await pool.query<{ table_name: string; conname: string; contype: string }>(
      `SELECT conrelid::regclass::text AS table_name, conname, contype::text AS contype
         FROM pg_constraint WHERE conrelid = ANY($1::regclass[]) AND contype IN ('c', 'u')
        ORDER BY conrelid::regclass::text COLLATE "C", conname::text COLLATE "C"`,
      [[...TABLES]],
    );
    expect(constraints.rows).toEqual([
      { table_name: 'exam_results', conname: 'ck_exam_results_score_non_negative', contype: 'c' },
      { table_name: 'exam_results', conname: 'ck_exam_results_score_only_scored', contype: 'c' },
      { table_name: 'exams', conname: 'ck_exams_description_localized', contype: 'c' },
      { table_name: 'exams', conname: 'ck_exams_duration_range', contype: 'c' },
      { table_name: 'exams', conname: 'ck_exams_max_score_positive', contype: 'c' },
      { table_name: 'exams', conname: 'ck_exams_pass_score_range', contype: 'c' },
      { table_name: 'exams', conname: 'ck_exams_published_at', contype: 'c' },
      { table_name: 'exams', conname: 'ck_exams_title_localized', contype: 'c' },
      { table_name: 'exams', conname: 'ck_exams_weight_non_negative', contype: 'c' },
      { table_name: 'final_grades', conname: 'ck_final_grades_band_label_localized', contype: 'c' },
      { table_name: 'final_grades', conname: 'ck_final_grades_band_letter_trimmed', contype: 'c' },
      { table_name: 'final_grades', conname: 'ck_final_grades_breakdown_array', contype: 'c' },
      { table_name: 'final_grades', conname: 'ck_final_grades_percent_range', contype: 'c' },
      { table_name: 'grade_scheme_bands', conname: 'ck_grade_scheme_bands_label_localized', contype: 'c' },
      { table_name: 'grade_scheme_bands', conname: 'ck_grade_scheme_bands_letter_trimmed', contype: 'c' },
      { table_name: 'grade_scheme_bands', conname: 'ck_grade_scheme_bands_min_percent_range', contype: 'c' },
      { table_name: 'grade_schemes', conname: 'ck_grade_schemes_default_active', contype: 'c' },
      { table_name: 'grade_schemes', conname: 'ck_grade_schemes_name_localized', contype: 'c' },
    ]);
    const indexes = await pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE indexname IN ('uq_grade_schemes_default', 'uq_grade_scheme_bands_min') ORDER BY indexname`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual(['uq_grade_scheme_bands_min', 'uq_grade_schemes_default']);
    expect(indexes.rows[0]!.indexdef).toMatch(/UNIQUE INDEX uq_grade_scheme_bands_min ON public\.grade_scheme_bands USING btree \(scheme_id, min_percent\)$/);
    expect(indexes.rows[1]!.indexdef).toMatch(/UNIQUE INDEX uq_grade_schemes_default ON public\.grade_schemes USING btree \(is_default\) WHERE is_default$/);
  });

  it('round-trips through the generated Prisma client and rolls back', async () => {
    const marker = new Error('rollback');
    await expect(
      prisma.$transaction(async (tx) => {
        const course = await tx.course.create({ data: { code: `${tag}-P`, name: { ar: 'دورة' }, status: 'published' } });
        const created = await tx.class.create({ data: { courseId: course.id, code: `${tag}-P`, name: { ar: 'فصل' }, capacity: 10 } });
        const student = await tx.user.create({ data: { fullName: 'Prisma student', email: `${tag.toLowerCase()}-prisma@example.com` } });
        const enrolled = await tx.enrollment.create({ data: { classId: created.id, studentUserId: student.id, status: 'active' } });
        const row = await tx.exam.create({
          data: {
            classId: created.id,
            title: { ar: 'الاختبار النهائي', en: 'Final exam' },
            type: 'final',
            status: 'published',
            publishedAt: new Date(PUBLISHED),
            scheduledAt: new Date('2026-11-19T08:00:00Z'),
            durationMinutes: 90,
            maxScore: 50,
            passScore: 25,
            weight: 40,
            results: { create: [{ studentUserId: student.id, status: 'scored', score: 41.5, feedback: 'ممتاز' }] },
          },
          include: { results: true },
        });
        expect(row).toMatchObject({ type: 'final', status: 'published', durationMinutes: 90, lessonId: null, createdById: null });
        expect(row.maxScore.toString()).toBe('50');
        expect(row.results[0]).toMatchObject({ status: 'scored', feedback: 'ممتاز', recordedById: null });
        expect(row.results[0]!.score!.toString()).toBe('41.5');

        const gradeScheme = await tx.gradeScheme.create({
          data: { name: { ar: 'سلّم تجريبي' }, bands: { create: [{ minPercent: 0, label: { ar: 'راسب' }, isPass: false }, { minPercent: 50, label: { ar: 'ناجح' }, letter: 'P', isPass: true }] } },
          include: { bands: { orderBy: { minPercent: 'asc' } } },
        });
        expect(gradeScheme.bands.map((band) => [band.minPercent.toString(), band.isPass])).toEqual([
          ['0', false],
          ['50', true],
        ]);
        await tx.finalGrade.create({
          data: { enrollmentId: enrolled.id, percent: 83, schemeId: gradeScheme.id, bandLabel: { ar: 'ناجح' }, bandLetter: 'P', isPass: true, breakdown: [{ kind: 'exam', id: row.id, weight: 40 }] },
        });
        const read = await tx.enrollment.findUniqueOrThrow({ where: { id: enrolled.id }, include: { finalGrade: { include: { scheme: true } }, class: { include: { exams: true } } } });
        expect(read.finalGrade).toMatchObject({ isPass: true, bandLetter: 'P', breakdown: [{ kind: 'exam', id: row.id, weight: 40 }] });
        expect(read.finalGrade!.scheme.isDefault).toBe(false);
        expect(read.class.exams).toHaveLength(1);
        throw marker;
      }),
    ).rejects.toBe(marker);
    expect(await prisma.exam.count({ where: { class: { code: `${tag}-P` } } })).toBe(0);
  });
});
