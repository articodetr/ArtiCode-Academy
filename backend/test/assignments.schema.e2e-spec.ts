// TEST-122 — MOD-08-T01 schema (migration 20261109135154_mod08_assignments_submissions):
// the `assignments` and `assignment_submissions` tables, their two enums, the
// hand-written CHECKs (localized texts, positive max score, late-penalty rules,
// text-or-link submissions, https links, score only when graded, review instant,
// feedback on return), the one-row-per-attempt key and the referential actions.
// Runs against the local development database as the APPLICATION role and is
// skipped when no database is reachable (like TEST-007/TEST-047/TEST-076).
// Every data test runs inside a transaction that is rolled back.
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
const MIGRATION = '20261109135154_mod08_assignments_submissions';
const PREVIOUS_MIGRATION = '20261106123612_mod06_lessons_attendance';

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

describe.skipIf(!available)('database schema — MOD-08 assignments and submissions (e2e, TEST-122)', () => {
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
  const tag = `W${Date.now().toString(36)}`.slice(0, 10).toUpperCase();
  const TITLE = '{"ar":"واجب"}';
  const ASSIGNMENT_SQL = `INSERT INTO assignments (class_id, lesson_id, title, instructions, max_score, weight, status, published_at, due_at, allow_late, late_penalty_percent, max_attempts, created_by)
                          VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7::assignment_status, $8, $9, $10, $11, $12, $13) RETURNING id`;
  const SUBMISSION_SQL = `INSERT INTO assignment_submissions (assignment_id, student_user_id, attempt_no, text_answer, link_url, status, score, feedback, graded_by, graded_at)
                          VALUES ($1, $2, $3, $4, $5, $6::submission_status, $7, $8, $9, $10) RETURNING id`;

  interface AssignmentOver {
    lessonId: string | null;
    title: string;
    instructions: string | null;
    maxScore: number;
    weight: number | null;
    status: string;
    publishedAt: string | null;
    dueAt: string | null;
    allowLate: boolean;
    latePenaltyPercent: number | null;
    maxAttempts: number;
    createdBy: string | null;
  }
  /** An assignment with defaults: a draft worth 100, no lesson, no due date, one attempt. */
  function assignmentParams(classId: string, over: Partial<AssignmentOver> = {}): unknown[] {
    const a: AssignmentOver = {
      lessonId: null,
      title: TITLE,
      instructions: null,
      maxScore: 100,
      weight: null,
      status: 'draft',
      publishedAt: null,
      dueAt: null,
      allowLate: false,
      latePenaltyPercent: null,
      maxAttempts: 1,
      createdBy: null,
      ...over,
    };
    return [classId, a.lessonId, a.title, a.instructions, a.maxScore, a.weight, a.status, a.publishedAt, a.dueAt, a.allowLate, a.latePenaltyPercent, a.maxAttempts, a.createdBy];
  }
  async function assignment(client: PoolClient, classId: string, over: Partial<AssignmentOver> = {}): Promise<string> {
    return (await client.query<{ id: string }>(ASSIGNMENT_SQL, assignmentParams(classId, over))).rows[0]!.id;
  }

  interface SubmissionOver {
    attemptNo: number;
    textAnswer: string | null;
    linkUrl: string | null;
    status: string;
    score: number | null;
    feedback: string | null;
    gradedBy: string | null;
    gradedAt: string | null;
  }
  /** A submission with defaults: attempt 1, a text answer, `submitted`, no review. */
  function submissionParams(assignmentId: string, studentId: string, over: Partial<SubmissionOver> = {}): unknown[] {
    const s: SubmissionOver = { attemptNo: 1, textAnswer: 'إجابتي', linkUrl: null, status: 'submitted', score: null, feedback: null, gradedBy: null, gradedAt: null, ...over };
    return [assignmentId, studentId, s.attemptNo, s.textAnswer, s.linkUrl, s.status, s.score, s.feedback, s.gradedBy, s.gradedAt];
  }
  async function submission(client: PoolClient, assignmentId: string, studentId: string, over: Partial<SubmissionOver> = {}): Promise<string> {
    return (await client.query<{ id: string }>(SUBMISSION_SQL, submissionParams(assignmentId, studentId, over))).rows[0]!.id;
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
  const REVIEWED = '2026-11-12T10:00:00Z';

  it('is applied after the MOD-06 migration, with the two enums and the assignment and submission defaults', async () => {
    const migrations = await pool.query<{ migration_name: string; ok: boolean }>(
      `SELECT migration_name, finished_at IS NOT NULL AND rolled_back_at IS NULL AS ok FROM _prisma_migrations ORDER BY started_at`,
    );
    const names = migrations.rows.map((row) => row.migration_name);
    expect(names).toContain(MIGRATION);
    expect(names.indexOf(MIGRATION)).toBeGreaterThan(names.indexOf(PREVIOUS_MIGRATION));
    expect(migrations.rows.every((row) => row.ok)).toBe(true);

    const enums = async (name: string) => (await pool.query<{ v: string }>(`SELECT unnest(enum_range(NULL::${name}))::text AS v`)).rows.map((row) => row.v);
    expect(await enums('assignment_status')).toEqual(['draft', 'open', 'closed', 'grading', 'graded']);
    expect(await enums('submission_status')).toEqual(['submitted', 'graded', 'returned']);

    await inRollback(async (client) => {
      const classId = await klass(client, 'D');
      const created = await client.query<Record<string, unknown>>(
        `INSERT INTO assignments (class_id, title, max_score) VALUES ($1, $2::jsonb, 10)
         RETURNING status, allow_late, max_attempts, lesson_id, instructions, weight, published_at, closed_at, due_at, late_penalty_percent, created_by`,
        [classId, TITLE],
      );
      expect(created.rows[0]).toEqual({
        status: 'draft',
        allow_late: false,
        max_attempts: 1,
        lesson_id: null,
        instructions: null,
        weight: null,
        published_at: null,
        closed_at: null,
        due_at: null,
        late_penalty_percent: null,
        created_by: null,
      });
      const student = await user(client, 'd');
      const assignmentId = await assignment(client, classId);
      const sub = await client.query<Record<string, unknown>>(
        `INSERT INTO assignment_submissions (assignment_id, student_user_id, text_answer) VALUES ($1, $2, 'نص')
         RETURNING attempt_no, is_late, status, link_url, score, feedback, graded_by, graded_at, submitted_at IS NOT NULL AS submitted`,
        [assignmentId, student],
      );
      expect(sub.rows[0]).toEqual({ attempt_no: 1, is_late: false, status: 'submitted', link_url: null, score: null, feedback: null, graded_by: null, graded_at: null, submitted: true });
    });
  });

  it('gives the application role DML without TRUNCATE on both tables, and adds no extension', async () => {
    for (const table of ['assignments', 'assignment_submissions']) {
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

  it('enforces the assignments CHECKs (localized texts, positive max score, weight, late penalty, attempts, published_at) — AC2', async () => {
    await inRollback(async (client) => {
      const classId = await klass(client, 'C');
      await expectSqlError(client, ASSIGNMENT_SQL, assignmentParams(classId, { title: '{"en":"no arabic"}' }), CHECK_VIOLATION, 'ck_assignments_title_localized');
      await expectSqlError(client, ASSIGNMENT_SQL, assignmentParams(classId, { title: '"plain"' }), CHECK_VIOLATION, 'ck_assignments_title_localized');
      await expectSqlError(client, ASSIGNMENT_SQL, assignmentParams(classId, { instructions: '{"en":"no arabic"}' }), CHECK_VIOLATION, 'ck_assignments_instructions_localized');
      await expectSqlError(client, ASSIGNMENT_SQL, assignmentParams(classId, { maxScore: 0 }), CHECK_VIOLATION, 'ck_assignments_max_score_positive');
      await expectSqlError(client, ASSIGNMENT_SQL, assignmentParams(classId, { maxScore: -1 }), CHECK_VIOLATION, 'ck_assignments_max_score_positive');
      await expectSqlError(client, ASSIGNMENT_SQL, assignmentParams(classId, { weight: -0.5 }), CHECK_VIOLATION, 'ck_assignments_weight_non_negative');
      await expectSqlError(client, ASSIGNMENT_SQL, assignmentParams(classId, { allowLate: true, latePenaltyPercent: 101 }), CHECK_VIOLATION, 'ck_assignments_late_penalty_range');
      await expectSqlError(client, ASSIGNMENT_SQL, assignmentParams(classId, { allowLate: true, latePenaltyPercent: -1 }), CHECK_VIOLATION, 'ck_assignments_late_penalty_range');
      await expectSqlError(client, ASSIGNMENT_SQL, assignmentParams(classId, { allowLate: false, latePenaltyPercent: 10 }), CHECK_VIOLATION, 'ck_assignments_late_penalty_only_allow_late');
      await expectSqlError(client, ASSIGNMENT_SQL, assignmentParams(classId, { maxAttempts: 0 }), CHECK_VIOLATION, 'ck_assignments_max_attempts_positive');
      await expectSqlError(client, ASSIGNMENT_SQL, assignmentParams(classId, { status: 'open' }), CHECK_VIOLATION, 'ck_assignments_published_at_for_non_draft');
      await expectSqlError(client, ASSIGNMENT_SQL, assignmentParams(classId, { status: 'closed' }), CHECK_VIOLATION, 'ck_assignments_published_at_for_non_draft');
      // Valid: instructions with `ar`, a weight of 0, a 100 % penalty with late submissions allowed, several attempts, an open assignment with its instant.
      await assignment(client, classId, { instructions: '{"ar":"التعليمات","en":"Instructions"}', weight: 0, allowLate: true, latePenaltyPercent: 100, maxAttempts: 3 });
      await assignment(client, classId, { status: 'open', publishedAt: '2026-11-10T08:00:00Z', dueAt: '2026-11-20T20:00:00Z' });
      await assignment(client, classId, { status: 'closed', publishedAt: '2026-11-10T08:00:00Z' });
    });
  });

  it('enforces the submission CHECKs (text or link, https link, attempt, score only when graded, review instant, feedback on return) and one row per attempt — AC2, AC3', async () => {
    await inRollback(async (client) => {
      const classId = await klass(client, 'S');
      const assignmentId = await assignment(client, classId, { status: 'open', publishedAt: '2026-11-10T08:00:00Z', maxAttempts: 2 });
      const s1 = await user(client, 's1');
      const s2 = await user(client, 's2');
      const teacher = await user(client, 'teacher');
      await expectSqlError(client, SUBMISSION_SQL, submissionParams(assignmentId, s1, { textAnswer: null, linkUrl: null }), CHECK_VIOLATION, 'ck_assignment_submissions_content');
      await expectSqlError(client, SUBMISSION_SQL, submissionParams(assignmentId, s1, { textAnswer: null, linkUrl: 'http://docs.example.com/a' }), CHECK_VIOLATION, 'ck_assignment_submissions_link_url_https');
      await expectSqlError(client, SUBMISSION_SQL, submissionParams(assignmentId, s1, { attemptNo: 0 }), CHECK_VIOLATION, 'ck_assignment_submissions_attempt_no_positive');
      await expectSqlError(client, SUBMISSION_SQL, submissionParams(assignmentId, s1, { status: 'graded', score: -1, gradedBy: teacher, gradedAt: REVIEWED }), CHECK_VIOLATION, 'ck_assignment_submissions_score_non_negative');
      // A score belongs to `graded` only, and `graded` needs one.
      await expectSqlError(client, SUBMISSION_SQL, submissionParams(assignmentId, s1, { score: 50 }), CHECK_VIOLATION, 'ck_assignment_submissions_score_only_graded');
      await expectSqlError(client, SUBMISSION_SQL, submissionParams(assignmentId, s1, { status: 'graded', gradedBy: teacher, gradedAt: REVIEWED }), CHECK_VIOLATION, 'ck_assignment_submissions_score_only_graded');
      // Graded and returned rows carry the review instant; a fresh one does not.
      await expectSqlError(client, SUBMISSION_SQL, submissionParams(assignmentId, s1, { status: 'graded', score: 50, gradedBy: teacher }), CHECK_VIOLATION, 'ck_assignment_submissions_reviewed_at');
      await expectSqlError(client, SUBMISSION_SQL, submissionParams(assignmentId, s1, { gradedAt: REVIEWED }), CHECK_VIOLATION, 'ck_assignment_submissions_reviewed_at');
      await expectSqlError(client, SUBMISSION_SQL, submissionParams(assignmentId, s1, { status: 'returned', gradedBy: teacher, gradedAt: REVIEWED }), CHECK_VIOLATION, 'ck_assignment_submissions_feedback_on_return');

      // Valid rows: a link-only first attempt, a graded one and a returned one; the same attempt twice is refused.
      await submission(client, assignmentId, s1, { textAnswer: null, linkUrl: 'https://docs.example.com/a' });
      await expectSqlError(client, SUBMISSION_SQL, submissionParams(assignmentId, s1), UNIQUE_VIOLATION, 'uq_assignment_submissions_attempt');
      await submission(client, assignmentId, s1, { attemptNo: 2, status: 'graded', score: 87.5, feedback: 'أحسنت', gradedBy: teacher, gradedAt: REVIEWED });
      await submission(client, assignmentId, s2, { status: 'returned', feedback: 'أكمل السؤال الثاني', gradedBy: teacher, gradedAt: REVIEWED });
      // A graded row without a grader (the grader's account may be deleted — SetNull) is still consistent.
      await submission(client, assignmentId, s2, { attemptNo: 2, status: 'graded', score: 0, gradedAt: REVIEWED });
      expect((await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM assignment_submissions WHERE assignment_id = $1`, [assignmentId])).rows[0]!.n).toBe(4);
    });
  });

  it('cascades a deleted class to its assignments and submissions, clears the lesson, creator and grader links, restricts students — AC4', async () => {
    await inRollback(async (client) => {
      const classId = await klass(client, 'FK');
      const lessonId = await lesson(client, classId);
      const creator = await user(client, 'fkcreator');
      const student = await user(client, 'fkstudent');
      const grader = await user(client, 'fkgrader');
      const assignmentId = await assignment(client, classId, { lessonId, createdBy: creator, status: 'open', publishedAt: '2026-11-10T08:00:00Z' });
      const submissionId = await submission(client, assignmentId, student, { status: 'graded', score: 70, gradedBy: grader, gradedAt: REVIEWED });

      await expectSqlError(client, `DELETE FROM users WHERE id = $1`, [student], RESTRICT_VIOLATION, 'assignment_submissions_student_user_id_fkey');

      await client.query(`DELETE FROM lessons WHERE id = $1`, [lessonId]);
      await client.query(`DELETE FROM users WHERE id = $1`, [creator]);
      await client.query(`DELETE FROM users WHERE id = $1`, [grader]);
      const after = await client.query<{ lesson_id: string | null; created_by: string | null }>(`SELECT lesson_id, created_by FROM assignments WHERE id = $1`, [assignmentId]);
      expect(after.rows[0]).toEqual({ lesson_id: null, created_by: null });
      const graded = await client.query<{ graded_by: string | null; status: string; score: string }>(`SELECT graded_by, status, score::text FROM assignment_submissions WHERE id = $1`, [submissionId]);
      expect(graded.rows[0]).toEqual({ graded_by: null, status: 'graded', score: '70.00' });

      // The assignment goes with its class, and the submission with the assignment.
      await client.query(`DELETE FROM classes WHERE id = $1`, [classId]);
      expect((await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM assignments WHERE id = $1`, [assignmentId])).rows[0]!.n).toBe(0);
      expect((await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM assignment_submissions WHERE id = $1`, [submissionId])).rows[0]!.n).toBe(0);
      // With the submission gone the student can go.
      await client.query(`DELETE FROM users WHERE id = $1`, [student]);
    });
  });

  it('names the CHECKs and the attempt key as the migration does', async () => {
    const constraints = await pool.query<{ table_name: string; conname: string; contype: string }>(
      `SELECT conrelid::regclass::text AS table_name, conname, contype::text AS contype
         FROM pg_constraint WHERE conrelid IN ('assignments'::regclass, 'assignment_submissions'::regclass) AND contype IN ('c', 'u')
        ORDER BY conrelid::regclass::text COLLATE "C", conname::text COLLATE "C"`,
    );
    expect(constraints.rows).toEqual([
      { table_name: 'assignment_submissions', conname: 'ck_assignment_submissions_attempt_no_positive', contype: 'c' },
      { table_name: 'assignment_submissions', conname: 'ck_assignment_submissions_content', contype: 'c' },
      { table_name: 'assignment_submissions', conname: 'ck_assignment_submissions_feedback_on_return', contype: 'c' },
      { table_name: 'assignment_submissions', conname: 'ck_assignment_submissions_link_url_https', contype: 'c' },
      { table_name: 'assignment_submissions', conname: 'ck_assignment_submissions_reviewed_at', contype: 'c' },
      { table_name: 'assignment_submissions', conname: 'ck_assignment_submissions_score_non_negative', contype: 'c' },
      { table_name: 'assignment_submissions', conname: 'ck_assignment_submissions_score_only_graded', contype: 'c' },
      { table_name: 'assignments', conname: 'ck_assignments_instructions_localized', contype: 'c' },
      { table_name: 'assignments', conname: 'ck_assignments_late_penalty_only_allow_late', contype: 'c' },
      { table_name: 'assignments', conname: 'ck_assignments_late_penalty_range', contype: 'c' },
      { table_name: 'assignments', conname: 'ck_assignments_max_attempts_positive', contype: 'c' },
      { table_name: 'assignments', conname: 'ck_assignments_max_score_positive', contype: 'c' },
      { table_name: 'assignments', conname: 'ck_assignments_published_at_for_non_draft', contype: 'c' },
      { table_name: 'assignments', conname: 'ck_assignments_title_localized', contype: 'c' },
      { table_name: 'assignments', conname: 'ck_assignments_weight_non_negative', contype: 'c' },
    ]);
    const unique = await pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'assignment_submissions' AND indexname = 'uq_assignment_submissions_attempt'`,
    );
    expect(unique.rows[0]?.indexdef).toMatch(/UNIQUE INDEX uq_assignment_submissions_attempt ON public\.assignment_submissions USING btree \(assignment_id, student_user_id, attempt_no\)$/);
  });

  it('round-trips through the generated Prisma client and rolls back', async () => {
    const marker = new Error('rollback');
    await expect(
      prisma.$transaction(async (tx) => {
        const course = await tx.course.create({ data: { code: `${tag}-P`, name: { ar: 'دورة' }, status: 'published' } });
        const created = await tx.class.create({ data: { courseId: course.id, code: `${tag}-P`, name: { ar: 'فصل' }, capacity: 10 } });
        const student = await tx.user.create({ data: { fullName: 'Prisma student', email: `${tag.toLowerCase()}-prisma@example.com` } });
        const row = await tx.assignment.create({
          data: {
            classId: created.id,
            title: { ar: 'الواجب الأول', en: 'Assignment 1' },
            maxScore: 20,
            status: 'open',
            publishedAt: new Date('2026-11-10T08:00:00Z'),
            dueAt: new Date('2026-11-20T20:00:00Z'),
            allowLate: true,
            latePenaltyPercent: 10,
            maxAttempts: 2,
            submissions: { create: [{ studentUserId: student.id, textAnswer: 'إجابة', linkUrl: 'https://docs.example.com/p', isLate: true }] },
          },
          include: { submissions: true },
        });
        expect(row).toMatchObject({ status: 'open', allowLate: true, maxAttempts: 2, lessonId: null, closedAt: null, createdById: null });
        expect(row.maxScore.toString()).toBe('20');
        expect(row.submissions).toHaveLength(1);
        expect(row.submissions[0]).toMatchObject({ attemptNo: 1, isLate: true, status: 'submitted', score: null, feedback: null, gradedById: null, gradedAt: null });

        const read = await tx.class.findUniqueOrThrow({ where: { id: created.id }, include: { assignments: { include: { submissions: { include: { student: true } } } } } });
        expect(read.assignments).toHaveLength(1);
        expect(read.assignments[0]!.submissions[0]!.student.fullName).toBe('Prisma student');
        throw marker;
      }),
    ).rejects.toBe(marker);
    expect(await prisma.assignment.count({ where: { class: { code: `${tag}-P` } } })).toBe(0);
  });
});
