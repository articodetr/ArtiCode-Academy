// TEST-280 — MOD-09 phase 2 schema (migration 20261122074941_mod09_online_exams):
// the five columns added to `exams` and the one added to `exam_results` with
// their defaults (every row that existed before stays `manual`), the six new
// tables `question_banks`, `questions`, `question_options`, `exam_questions`,
// `exam_attempts` and `exam_answers`, their seven enums, the 31 hand-written
// CHECKs, the "one attempt in progress" partial unique index, the sweeper's
// partial index and the referential actions. Runs against the development
// database as the APPLICATION role and is skipped when no database is
// reachable (like TEST-127). Every data test runs inside a transaction that is
// rolled back.
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
const MIGRATION = '20261122074941_mod09_online_exams';
const PREVIOUS_MIGRATION = '20261119175134_mod20_level_release';
const TABLES = ['question_banks', 'questions', 'question_options', 'exam_questions', 'exam_attempts', 'exam_answers'] as const;

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

describe.skipIf(!available)('database schema — MOD-09 phase 2 online exams (e2e, TEST-280)', () => {
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
  const tag = `O${Date.now().toString(36)}`.slice(0, 10).toUpperCase();
  const TEXT = '{"ar":"نص"}';
  const OPENS = '2026-12-01T08:00:00Z';
  const CLOSES = '2026-12-01T10:00:00Z';
  const SNAPSHOT = '{"type":"true_false","prompt":{"ar":"سؤال"},"explanation":null,"options":[],"correctBoolean":true}';

  async function klass(client: PoolClient, suffix: string): Promise<{ classId: string; courseId: string }> {
    const course = await client.query<{ id: string }>(`INSERT INTO courses (code, name, status) VALUES ($1, '{"ar":"دورة"}', 'published') RETURNING id`, [`${tag}-${suffix}`]);
    const created = await client.query<{ id: string }>(`INSERT INTO classes (course_id, code, name, capacity) VALUES ($1, $2, '{"ar":"فصل"}', 20) RETURNING id`, [
      course.rows[0]!.id,
      `${tag}-${suffix}`,
    ]);
    return { classId: created.rows[0]!.id, courseId: course.rows[0]!.id };
  }
  async function user(client: PoolClient, name: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(`INSERT INTO users (full_name, email) VALUES ($1, $2) RETURNING id`, [name, `${tag.toLowerCase()}-${name}@example.com`]);
    return rows[0]!.id;
  }
  /** A manual draft exam worth 10, as every exam before this migration. */
  async function manualExam(client: PoolClient, classId: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(`INSERT INTO exams (class_id, title, type, max_score) VALUES ($1, $2::jsonb, 'quiz', 10) RETURNING id`, [classId, TEXT]);
    return rows[0]!.id;
  }
  /** An online exam: a draft unless `status` says otherwise (then with its whole window and time limit). */
  async function onlineExam(client: PoolClient, classId: string, status: 'draft' | 'scheduled' = 'scheduled'): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO exams (class_id, title, type, max_score, delivery, status, scheduled_at, closes_at, duration_minutes, attempts_allowed)
       VALUES ($1, $2::jsonb, 'quiz', 10, 'online', $3::exam_status, $4, $5, $6, 2) RETURNING id`,
      [classId, TEXT, status, status === 'draft' ? null : OPENS, status === 'draft' ? null : CLOSES, status === 'draft' ? null : 30],
    );
    return rows[0]!.id;
  }
  async function bank(client: PoolClient, over: { courseId?: string | null; createdBy?: string | null } = {}): Promise<string> {
    const { rows } = await client.query<{ id: string }>(`INSERT INTO question_banks (name, course_id, created_by) VALUES ($1::jsonb, $2, $3) RETURNING id`, [
      TEXT,
      over.courseId ?? null,
      over.createdBy ?? null,
    ]);
    return rows[0]!.id;
  }
  const QUESTION_SQL = `INSERT INTO questions (bank_id, type, status, prompt, explanation, points, correct_boolean, tags)
                        VALUES ($1, $2::question_type, $3::question_status, $4::jsonb, $5::jsonb, $6, $7, $8::text[]) RETURNING id`;
  interface QuestionOver {
    type: string;
    status: string;
    prompt: string;
    explanation: string | null;
    points: number;
    correctBoolean: boolean | null;
    tags: string[];
  }
  function questionParams(bankId: string, over: Partial<QuestionOver> = {}): unknown[] {
    const q: QuestionOver = { type: 'true_false', status: 'ready', prompt: TEXT, explanation: null, points: 1, correctBoolean: true, tags: [], ...over };
    return [bankId, q.type, q.status, q.prompt, q.explanation, q.points, q.correctBoolean, q.tags];
  }
  async function question(client: PoolClient, bankId: string, over: Partial<QuestionOver> = {}): Promise<string> {
    return (await client.query<{ id: string }>(QUESTION_SQL, questionParams(bankId, over))).rows[0]!.id;
  }
  const OPTION_SQL = `INSERT INTO question_options (question_id, text, is_correct, sort_order) VALUES ($1, $2::jsonb, $3, $4) RETURNING id`;
  const EXAM_QUESTION_SQL = `INSERT INTO exam_questions (exam_id, question_id, sort_order, points, snapshot) VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`;
  async function examQuestion(client: PoolClient, examId: string, questionId: string, sortOrder = 0, points = 10, snapshot: string | null = SNAPSHOT): Promise<string> {
    return (await client.query<{ id: string }>(EXAM_QUESTION_SQL, [examId, questionId, sortOrder, points, snapshot])).rows[0]!.id;
  }
  const ATTEMPT_SQL = `INSERT INTO exam_attempts (exam_id, student_user_id, attempt_no, status, started_at, expires_at, submitted_at, score, max_score, question_count, correct_count, graded_at)
                       VALUES ($1, $2, $3, $4::exam_attempt_status, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`;
  interface AttemptOver {
    attemptNo: number;
    status: string;
    startedAt: string;
    expiresAt: string;
    submittedAt: string | null;
    score: number | null;
    maxScore: number;
    questionCount: number;
    correctCount: number | null;
    gradedAt: string | null;
  }
  /** An attempt in progress by default; `finished()` gives the columns of a submitted one. */
  function attemptParams(examId: string, studentId: string, over: Partial<AttemptOver> = {}): unknown[] {
    const a: AttemptOver = {
      attemptNo: 1,
      status: 'in_progress',
      startedAt: '2026-12-01T08:05:00Z',
      expiresAt: '2026-12-01T08:35:00Z',
      submittedAt: null,
      score: null,
      maxScore: 10,
      questionCount: 1,
      correctCount: null,
      gradedAt: null,
      ...over,
    };
    return [examId, studentId, a.attemptNo, a.status, a.startedAt, a.expiresAt, a.submittedAt, a.score, a.maxScore, a.questionCount, a.correctCount, a.gradedAt];
  }
  const finished = (over: Partial<AttemptOver> = {}): Partial<AttemptOver> => ({
    status: 'submitted',
    submittedAt: '2026-12-01T08:20:00Z',
    score: 10,
    correctCount: 1,
    gradedAt: '2026-12-01T08:20:00Z',
    ...over,
  });
  async function attempt(client: PoolClient, examId: string, studentId: string, over: Partial<AttemptOver> = {}): Promise<string> {
    return (await client.query<{ id: string }>(ATTEMPT_SQL, attemptParams(examId, studentId, over))).rows[0]!.id;
  }
  const ANSWER_SQL = `INSERT INTO exam_answers (attempt_id, exam_question_id, response, is_correct, points_awarded, answered_at) VALUES ($1, $2, $3::jsonb, $4, $5, $6)`;
  const count = async (client: PoolClient, sql: string, params: unknown[]) => (await client.query<{ n: number }>(sql, params)).rows[0]!.n;

  it('is applied after the MOD-20 level-release migration, with the seven enums', async () => {
    const migrations = await pool.query<{ migration_name: string; ok: boolean }>(
      `SELECT migration_name, finished_at IS NOT NULL AND rolled_back_at IS NULL AS ok FROM _prisma_migrations ORDER BY started_at`,
    );
    const names = migrations.rows.map((row) => row.migration_name);
    expect(names).toContain(MIGRATION);
    expect(names.indexOf(MIGRATION)).toBeGreaterThan(names.indexOf(PREVIOUS_MIGRATION));
    expect(migrations.rows.every((row) => row.ok)).toBe(true);

    const enums = async (name: string) => (await pool.query<{ v: string }>(`SELECT unnest(enum_range(NULL::${name}))::text AS v`)).rows.map((row) => row.v);
    expect(await enums('exam_delivery')).toEqual(['manual', 'online']);
    expect(await enums('exam_results_release')).toEqual(['on_publish', 'on_submit']);
    expect(await enums('exam_result_source')).toEqual(['manual', 'online']);
    expect(await enums('question_type')).toEqual(['single_choice', 'true_false']);
    expect(await enums('question_status')).toEqual(['draft', 'ready', 'archived']);
    expect(await enums('question_difficulty')).toEqual(['easy', 'medium', 'hard']);
    expect(await enums('exam_attempt_status')).toEqual(['in_progress', 'submitted', 'timed_out']);
    // The first phase's lifecycle is untouched: no online state was added (D-R151).
    expect(await enums('exam_status')).toEqual(['draft', 'scheduled', 'published']);
  });

  it('keeps an exam and a result written the old way manual, with the defaults of the new columns — AC1', async () => {
    await inRollback(async (client) => {
      const { classId } = await klass(client, 'D');
      const created = await client.query<Record<string, unknown>>(
        `INSERT INTO exams (class_id, title, type, max_score) VALUES ($1, $2::jsonb, 'final', 50)
         RETURNING delivery, closes_at, attempts_allowed, results_release, reveal_answers`,
        [classId, TEXT],
      );
      expect(created.rows[0]).toEqual({ delivery: 'manual', closes_at: null, attempts_allowed: 1, results_release: 'on_publish', reveal_answers: false });
      const examId = await manualExam(client, classId);
      const student = await user(client, 'd');
      const result = await client.query<Record<string, unknown>>(`INSERT INTO exam_results (exam_id, student_user_id, status) VALUES ($1, $2, 'absent') RETURNING source`, [examId, student]);
      expect(result.rows[0]).toEqual({ source: 'manual' });

      const bankId = await bank(client);
      const defaults = await client.query<Record<string, unknown>>(
        `INSERT INTO questions (bank_id, type, prompt) VALUES ($1, 'single_choice', $2::jsonb)
         RETURNING status, points::text AS points, correct_boolean, difficulty, tags, explanation, created_by`,
        [bankId, TEXT],
      );
      expect(defaults.rows[0]).toEqual({ status: 'draft', points: '1.00', correct_boolean: null, difficulty: null, tags: [], explanation: null, created_by: null });
    });
  });

  it('gives the application role DML without TRUNCATE on the six tables, and adds no extension', async () => {
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

  it('enforces the online settings of an exam: attempts 1..20, a window that closes after it opens, nothing online on a manual exam, a whole window once the learners see it — AC2', async () => {
    await inRollback(async (client) => {
      const { classId } = await klass(client, 'E');
      const manual = await manualExam(client, classId);
      const draft = await onlineExam(client, classId, 'draft');
      const scheduled = await onlineExam(client, classId);

      for (const value of [0, 21]) {
        await expectSqlError(client, `UPDATE exams SET attempts_allowed = $2 WHERE id = $1`, [scheduled, value], CHECK_VIOLATION, 'ck_exams_attempts_allowed_range');
      }
      await client.query(`UPDATE exams SET attempts_allowed = 20 WHERE id = $1`, [scheduled]);
      await expectSqlError(client, `UPDATE exams SET closes_at = scheduled_at WHERE id = $1`, [scheduled], CHECK_VIOLATION, 'ck_exams_closes_after_opens');
      await expectSqlError(client, `UPDATE exams SET closes_at = scheduled_at - interval '1 minute' WHERE id = $1`, [scheduled], CHECK_VIOLATION, 'ck_exams_closes_after_opens');

      // A manual exam carries no online setting — one at a time.
      await expectSqlError(client, `UPDATE exams SET closes_at = $2 WHERE id = $1`, [manual, CLOSES], CHECK_VIOLATION, 'ck_exams_manual_settings');
      await expectSqlError(client, `UPDATE exams SET attempts_allowed = 2 WHERE id = $1`, [manual], CHECK_VIOLATION, 'ck_exams_manual_settings');
      await expectSqlError(client, `UPDATE exams SET results_release = 'on_submit' WHERE id = $1`, [manual], CHECK_VIOLATION, 'ck_exams_manual_settings');
      await expectSqlError(client, `UPDATE exams SET reveal_answers = true WHERE id = $1`, [manual], CHECK_VIOLATION, 'ck_exams_manual_settings');
      // …and an online exam cannot become manual while it still carries them.
      await expectSqlError(client, `UPDATE exams SET delivery = 'manual' WHERE id = $1`, [scheduled], CHECK_VIOLATION, 'ck_exams_manual_settings');

      // An online draft may be incomplete; a scheduled one needs the opening, the closing and the time limit.
      await client.query(`UPDATE exams SET results_release = 'on_submit', reveal_answers = true WHERE id = $1`, [draft]);
      await expectSqlError(client, `UPDATE exams SET status = 'scheduled' WHERE id = $1`, [draft], CHECK_VIOLATION, 'ck_exams_online_window');
      for (const column of ['scheduled_at', 'closes_at', 'duration_minutes']) {
        await expectSqlError(client, `UPDATE exams SET ${column} = NULL WHERE id = $1`, [scheduled], CHECK_VIOLATION, 'ck_exams_online_window');
      }
      // A manual exam is scheduled without any of them, as before.
      await client.query(`UPDATE exams SET status = 'scheduled' WHERE id = $1`, [manual]);
    });
  });

  it('keeps an online result a score: an online row is never absent or excused — AC2', async () => {
    await inRollback(async (client) => {
      const { classId } = await klass(client, 'R');
      const examId = await onlineExam(client, classId);
      const student = await user(client, 'r');
      await expectSqlError(
        client,
        `INSERT INTO exam_results (exam_id, student_user_id, status, source) VALUES ($1, $2, 'absent', 'online')`,
        [examId, student],
        CHECK_VIOLATION,
        'ck_exam_results_online_scored',
      );
      await client.query(`INSERT INTO exam_results (exam_id, student_user_id, status, score, source) VALUES ($1, $2, 'scored', 7.5, 'online')`, [examId, student]);
      await expectSqlError(client, `UPDATE exam_results SET status = 'excused', score = NULL WHERE exam_id = $1`, [examId], CHECK_VIOLATION, 'ck_exam_results_online_scored');
      // The manual sheet still records an absent student of an online exam.
      await client.query(`INSERT INTO exam_results (exam_id, student_user_id, status) VALUES ($1, $2, 'excused')`, [examId, await user(client, 'r2')]);
    });
  });

  it('enforces the bank and question CHECKs: localized texts, positive points, the boolean key of true/false questions only, at most ten tags — AC2', async () => {
    await inRollback(async (client) => {
      await expectSqlError(client, `INSERT INTO question_banks (name) VALUES ('{"en":"Bank"}')`, [], CHECK_VIOLATION, 'ck_question_banks_name_localized');
      await expectSqlError(client, `INSERT INTO question_banks (name) VALUES ('"بنك"')`, [], CHECK_VIOLATION, 'ck_question_banks_name_localized');
      await expectSqlError(client, `INSERT INTO question_banks (name, description) VALUES ($1::jsonb, '{"en":"x"}')`, [TEXT], CHECK_VIOLATION, 'ck_question_banks_description_localized');
      const bankId = await bank(client);

      await expectSqlError(client, QUESTION_SQL, questionParams(bankId, { prompt: '{"en":"Question"}' }), CHECK_VIOLATION, 'ck_questions_prompt_localized');
      await expectSqlError(client, QUESTION_SQL, questionParams(bankId, { explanation: '[]' }), CHECK_VIOLATION, 'ck_questions_explanation_localized');
      for (const points of [0, -1]) await expectSqlError(client, QUESTION_SQL, questionParams(bankId, { points }), CHECK_VIOLATION, 'ck_questions_points_positive');
      // The boolean key belongs to true/false questions…
      await expectSqlError(client, QUESTION_SQL, questionParams(bankId, { type: 'single_choice', correctBoolean: false }), CHECK_VIOLATION, 'ck_questions_boolean_key_type');
      // …and a ready true/false question has it; a draft may still lack it.
      await expectSqlError(client, QUESTION_SQL, questionParams(bankId, { correctBoolean: null }), CHECK_VIOLATION, 'ck_questions_ready_true_false_key');
      const draft = await question(client, bankId, { status: 'draft', correctBoolean: null });
      await expectSqlError(client, `UPDATE questions SET status = 'ready' WHERE id = $1`, [draft], CHECK_VIOLATION, 'ck_questions_ready_true_false_key');
      await client.query(`UPDATE questions SET status = 'archived' WHERE id = $1`, [draft]);
      await question(client, bankId, { type: 'single_choice', correctBoolean: null });

      const eleven = Array.from({ length: 11 }, (_, index) => `t${index}`);
      await expectSqlError(client, QUESTION_SQL, questionParams(bankId, { tags: eleven }), CHECK_VIOLATION, 'ck_questions_tags_limit');
      await expectSqlError(client, `UPDATE questions SET tags = NULL WHERE id = $1`, [draft], CHECK_VIOLATION, 'ck_questions_tags_limit');
      await question(client, bankId, { tags: eleven.slice(0, 10) });
    });
  });

  it('enforces the option rules: a localized text, a position from 0 and one option per position — AC2, AC3', async () => {
    await inRollback(async (client) => {
      const questionId = await question(client, await bank(client), { type: 'single_choice', correctBoolean: null });
      await client.query(OPTION_SQL, [questionId, TEXT, true, 0]);
      await client.query(OPTION_SQL, [questionId, TEXT, false, 1]);
      await expectSqlError(client, OPTION_SQL, [questionId, '{"en":"A"}', false, 2], CHECK_VIOLATION, 'ck_question_options_text_localized');
      await expectSqlError(client, OPTION_SQL, [questionId, TEXT, false, -1], CHECK_VIOLATION, 'ck_question_options_sort_order');
      await expectSqlError(client, OPTION_SQL, [questionId, TEXT, false, 1], UNIQUE_VIOLATION, 'uq_question_options_order');
    });
  });

  it('links a question to an exam once, at one position, with positive points and a well-shaped frozen copy — AC2, AC3', async () => {
    await inRollback(async (client) => {
      const { classId } = await klass(client, 'Q');
      const examId = await onlineExam(client, classId, 'draft');
      const bankId = await bank(client);
      const first = await question(client, bankId);
      const second = await question(client, bankId);
      // A draft exam links questions without a frozen copy.
      await examQuestion(client, examId, first, 0, 5, null);
      await expectSqlError(client, EXAM_QUESTION_SQL, [examId, first, 1, 5, null], UNIQUE_VIOLATION, 'uq_exam_questions_question');
      await expectSqlError(client, EXAM_QUESTION_SQL, [examId, second, 0, 5, null], UNIQUE_VIOLATION, 'uq_exam_questions_order');
      await expectSqlError(client, EXAM_QUESTION_SQL, [examId, second, 1, 0, null], CHECK_VIOLATION, 'ck_exam_questions_points_positive');
      await expectSqlError(client, EXAM_QUESTION_SQL, [examId, second, -1, 5, null], CHECK_VIOLATION, 'ck_exam_questions_sort_order');
      for (const snapshot of ['[]', 'null', '{"type":"true_false"}', '{"type":"true_false","prompt":{"ar":"س"}}']) {
        await expectSqlError(client, EXAM_QUESTION_SQL, [examId, second, 1, 5, snapshot], CHECK_VIOLATION, 'ck_exam_questions_snapshot_shape');
      }
      await examQuestion(client, examId, second, 1, 5);
      // The same question may be linked to another exam.
      await examQuestion(client, await onlineExam(client, classId, 'draft'), first, 0, 10, null);
    });
  });

  it('enforces the attempt rules: a number 1..20 once per student and exam, a deadline after the start, a result exactly when finished and within the maximum — AC2, AC3', async () => {
    await inRollback(async (client) => {
      const { classId } = await klass(client, 'A');
      const examId = await onlineExam(client, classId);
      const student = await user(client, 'a');
      const other = await user(client, 'a2');

      for (const attemptNo of [0, 21]) {
        await expectSqlError(client, ATTEMPT_SQL, attemptParams(examId, student, { attemptNo }), CHECK_VIOLATION, 'ck_exam_attempts_attempt_no_range');
      }
      await expectSqlError(client, ATTEMPT_SQL, attemptParams(examId, student, { expiresAt: '2026-12-01T08:05:00Z' }), CHECK_VIOLATION, 'ck_exam_attempts_expires_after_start');
      await expectSqlError(client, ATTEMPT_SQL, attemptParams(examId, student, { maxScore: 0 }), CHECK_VIOLATION, 'ck_exam_attempts_max_score_positive');
      await expectSqlError(client, ATTEMPT_SQL, attemptParams(examId, student, { questionCount: 0 }), CHECK_VIOLATION, 'ck_exam_attempts_question_count_positive');

      // In progress: no result column at all.
      await expectSqlError(client, ATTEMPT_SQL, attemptParams(examId, student, { submittedAt: '2026-12-01T08:20:00Z' }), CHECK_VIOLATION, 'ck_exam_attempts_submitted_at');
      await expectSqlError(client, ATTEMPT_SQL, attemptParams(examId, student, { score: 5 }), CHECK_VIOLATION, 'ck_exam_attempts_score_when_finished');
      await expectSqlError(client, ATTEMPT_SQL, attemptParams(examId, student, { correctCount: 1 }), CHECK_VIOLATION, 'ck_exam_attempts_correct_count_when_finished');
      await expectSqlError(client, ATTEMPT_SQL, attemptParams(examId, student, { gradedAt: '2026-12-01T08:20:00Z' }), CHECK_VIOLATION, 'ck_exam_attempts_graded_at_when_finished');
      // Finished (either way): every result column.
      for (const status of ['submitted', 'timed_out']) {
        await expectSqlError(client, ATTEMPT_SQL, attemptParams(examId, student, finished({ status, submittedAt: null })), CHECK_VIOLATION, 'ck_exam_attempts_submitted_at');
        await expectSqlError(client, ATTEMPT_SQL, attemptParams(examId, student, finished({ status, score: null })), CHECK_VIOLATION, 'ck_exam_attempts_score_when_finished');
        await expectSqlError(client, ATTEMPT_SQL, attemptParams(examId, student, finished({ status, correctCount: null })), CHECK_VIOLATION, 'ck_exam_attempts_correct_count_when_finished');
        await expectSqlError(client, ATTEMPT_SQL, attemptParams(examId, student, finished({ status, gradedAt: null })), CHECK_VIOLATION, 'ck_exam_attempts_graded_at_when_finished');
      }
      for (const score of [-0.01, 10.01]) {
        await expectSqlError(client, ATTEMPT_SQL, attemptParams(examId, student, finished({ score })), CHECK_VIOLATION, 'ck_exam_attempts_score_range');
      }
      for (const correctCount of [-1, 2]) {
        await expectSqlError(client, ATTEMPT_SQL, attemptParams(examId, student, finished({ correctCount })), CHECK_VIOLATION, 'ck_exam_attempts_correct_count_range');
      }

      await attempt(client, examId, student, finished({ score: 0, correctCount: 0 }));
      await expectSqlError(client, ATTEMPT_SQL, attemptParams(examId, student, finished()), UNIQUE_VIOLATION, 'uq_exam_attempts_no');
      // One attempt in progress per student and exam; a finished one does not count, another student's neither.
      await attempt(client, examId, student, { attemptNo: 2 });
      await expectSqlError(client, ATTEMPT_SQL, attemptParams(examId, student, { attemptNo: 3 }), UNIQUE_VIOLATION, 'uq_exam_attempts_in_progress');
      await attempt(client, examId, other);
      await client.query(
        `UPDATE exam_attempts SET status = 'timed_out', submitted_at = expires_at, score = 0, correct_count = 0, graded_at = expires_at WHERE exam_id = $1 AND student_user_id = $2 AND attempt_no = 2`,
        [examId, student],
      );
      await attempt(client, examId, student, { attemptNo: 3 });
    });
  });

  it('enforces the answer rules: one answer per question of an attempt, an object response, a grade whose two columns come together — AC2, AC3', async () => {
    await inRollback(async (client) => {
      const { classId } = await klass(client, 'N');
      const examId = await onlineExam(client, classId);
      const examQuestionId = await examQuestion(client, examId, await question(client, await bank(client)));
      const attemptId = await attempt(client, examId, await user(client, 'n'));
      const at = '2026-12-01T08:10:00Z';

      for (const response of ['true', '"a"', '[true]', 'null']) {
        await expectSqlError(client, ANSWER_SQL, [attemptId, examQuestionId, response, null, null, at], CHECK_VIOLATION, 'ck_exam_answers_response_object');
      }
      await expectSqlError(client, ANSWER_SQL, [attemptId, examQuestionId, '{"value":true}', true, null, at], CHECK_VIOLATION, 'ck_exam_answers_graded_together');
      await expectSqlError(client, ANSWER_SQL, [attemptId, examQuestionId, '{"value":true}', null, 10, at], CHECK_VIOLATION, 'ck_exam_answers_graded_together');
      await expectSqlError(client, ANSWER_SQL, [attemptId, examQuestionId, '{"value":true}', false, -1, at], CHECK_VIOLATION, 'ck_exam_answers_points_non_negative');
      await client.query(ANSWER_SQL, [attemptId, examQuestionId, '{"value":true}', null, null, at]);
      await expectSqlError(client, ANSWER_SQL, [attemptId, examQuestionId, '{"value":false}', null, null, at], UNIQUE_VIOLATION, 'exam_answers_pkey');
      await client.query(`UPDATE exam_answers SET is_correct = true, points_awarded = 10 WHERE attempt_id = $1`, [attemptId]);
    });
  });

  it('cascades an exam to its questions, attempts and answers and a bank to its questions and options, restricts a linked question and a student, and clears the course and author links — AC4', async () => {
    await inRollback(async (client) => {
      const { classId, courseId } = await klass(client, 'C');
      const author = await user(client, 'author');
      const student = await user(client, 'student');
      const bankId = await bank(client, { courseId, createdBy: author });
      const linked = await question(client, bankId, { type: 'single_choice', correctBoolean: null });
      await client.query(`UPDATE questions SET created_by = $2 WHERE id = $1`, [linked, author]);
      await client.query(OPTION_SQL, [linked, TEXT, true, 0]);
      const free = await question(client, bankId);
      const examId = await onlineExam(client, classId);
      const examQuestionId = await examQuestion(client, examId, linked);
      const attemptId = await attempt(client, examId, student);
      await client.query(ANSWER_SQL, [attemptId, examQuestionId, '{"optionId":"x"}', null, null, '2026-12-01T08:10:00Z']);

      // Restrict: a question an exam links, the bank that holds it, a student with an attempt.
      await expectSqlError(client, `DELETE FROM questions WHERE id = $1`, [linked], RESTRICT_VIOLATION, 'exam_questions_question_id_fkey');
      await expectSqlError(client, `DELETE FROM question_banks WHERE id = $1`, [bankId], RESTRICT_VIOLATION, 'exam_questions_question_id_fkey');
      await expectSqlError(client, `DELETE FROM users WHERE id = $1`, [student], RESTRICT_VIOLATION, 'exam_attempts_student_user_id_fkey');
      // A question no exam links goes, with nothing else.
      await client.query(`DELETE FROM questions WHERE id = $1`, [free]);

      // SetNull: the author of a bank and of a question; the bank's course is cleared below with the class.
      await client.query(`DELETE FROM users WHERE id = $1`, [author]);
      expect((await client.query(`SELECT created_by FROM question_banks WHERE id = $1`, [bankId])).rows[0]).toEqual({ created_by: null });
      expect((await client.query(`SELECT created_by FROM questions WHERE id = $1`, [linked])).rows[0]).toEqual({ created_by: null });

      // Cascade: the exam takes its links, attempts and answers; the bank's question stays.
      await client.query(`DELETE FROM exams WHERE id = $1`, [examId]);
      expect(await count(client, `SELECT count(*)::int AS n FROM exam_questions WHERE exam_id = $1`, [examId])).toBe(0);
      expect(await count(client, `SELECT count(*)::int AS n FROM exam_attempts WHERE exam_id = $1`, [examId])).toBe(0);
      expect(await count(client, `SELECT count(*)::int AS n FROM exam_answers WHERE attempt_id = $1`, [attemptId])).toBe(0);
      expect(await count(client, `SELECT count(*)::int AS n FROM questions WHERE id = $1`, [linked])).toBe(1);

      // The course goes (its class first): the bank outlives it, unfiled.
      await client.query(`DELETE FROM classes WHERE id = $1`, [classId]);
      await client.query(`DELETE FROM courses WHERE id = $1`, [courseId]);
      expect((await client.query(`SELECT course_id FROM question_banks WHERE id = $1`, [bankId])).rows[0]).toEqual({ course_id: null });

      // Cascade: the bank takes its questions and their options.
      await client.query(`DELETE FROM question_banks WHERE id = $1`, [bankId]);
      expect(await count(client, `SELECT count(*)::int AS n FROM questions WHERE bank_id = $1`, [bankId])).toBe(0);
      expect(await count(client, `SELECT count(*)::int AS n FROM question_options WHERE question_id = $1`, [linked])).toBe(0);
    });
  });

  it('names the CHECKs, the keys and the partial indexes as the migration does', async () => {
    const checks = await pool.query<{ table_name: string; conname: string }>(
      `SELECT c.conrelid::regclass::text AS table_name, c.conname
         FROM pg_constraint c
        WHERE c.contype = 'c' AND c.conname = ANY($1::text[])
        ORDER BY 1, 2`,
      [
        [
          'ck_exams_attempts_allowed_range',
          'ck_exams_closes_after_opens',
          'ck_exams_manual_settings',
          'ck_exams_online_window',
          'ck_exam_results_online_scored',
          'ck_question_banks_name_localized',
          'ck_question_banks_description_localized',
          'ck_questions_prompt_localized',
          'ck_questions_explanation_localized',
          'ck_questions_points_positive',
          'ck_questions_boolean_key_type',
          'ck_questions_ready_true_false_key',
          'ck_questions_tags_limit',
          'ck_question_options_text_localized',
          'ck_question_options_sort_order',
          'ck_exam_questions_points_positive',
          'ck_exam_questions_sort_order',
          'ck_exam_questions_snapshot_shape',
          'ck_exam_attempts_attempt_no_range',
          'ck_exam_attempts_expires_after_start',
          'ck_exam_attempts_max_score_positive',
          'ck_exam_attempts_question_count_positive',
          'ck_exam_attempts_submitted_at',
          'ck_exam_attempts_score_when_finished',
          'ck_exam_attempts_correct_count_when_finished',
          'ck_exam_attempts_graded_at_when_finished',
          'ck_exam_attempts_score_range',
          'ck_exam_attempts_correct_count_range',
          'ck_exam_answers_response_object',
          'ck_exam_answers_graded_together',
          'ck_exam_answers_points_non_negative',
        ],
      ],
    );
    expect(checks.rows).toHaveLength(31);
    const perTable: Record<string, number> = {};
    for (const row of checks.rows) perTable[row.table_name] = (perTable[row.table_name] ?? 0) + 1;
    expect(perTable).toEqual({ exams: 4, exam_results: 1, question_banks: 2, questions: 6, question_options: 2, exam_questions: 3, exam_attempts: 10, exam_answers: 3 });

    const indexes = await pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1::text[]) ORDER BY 1`,
      [
        [
          'uq_exam_attempts_in_progress',
          'ix_exam_attempts_expiry',
          'uq_exam_attempts_no',
          'uq_exam_questions_question',
          'uq_exam_questions_order',
          'uq_question_options_order',
          'questions_tags_idx',
        ],
      ],
    );
    const byName = Object.fromEntries(indexes.rows.map((row) => [row.indexname, row.indexdef]));
    expect(Object.keys(byName)).toHaveLength(7);
    expect(byName['uq_exam_attempts_in_progress']).toMatch(/UNIQUE INDEX .* \(exam_id, student_user_id\) WHERE \(status = 'in_progress'::exam_attempt_status\)/);
    expect(byName['ix_exam_attempts_expiry']).toMatch(/INDEX .* \(expires_at\) WHERE \(status = 'in_progress'::exam_attempt_status\)/);
    expect(byName['ix_exam_attempts_expiry']).not.toMatch(/UNIQUE/);
    expect(byName['questions_tags_idx']).toMatch(/USING gin \(tags\)/);
  });

  it('round-trips through the generated Prisma client and rolls back', async () => {
    const ROLLBACK = 'rollback-on-purpose';
    await expect(
      prisma.$transaction(async (tx) => {
        const course = await tx.course.create({ data: { code: `${tag}-P`, name: { ar: 'دورة' }, status: 'published' }, select: { id: true } });
        const klassRow = await tx.class.create({ data: { courseId: course.id, code: `${tag}-P`, name: { ar: 'فصل' }, capacity: 5 }, select: { id: true } });
        const student = await tx.user.create({ data: { fullName: 'Prisma Student', email: `${tag.toLowerCase()}-p@example.com` }, select: { id: true } });
        const bankRow = await tx.questionBank.create({ data: { name: { ar: 'بنك' }, courseId: course.id }, select: { id: true } });
        const choice = await tx.question.create({
          data: {
            bankId: bankRow.id,
            type: 'single_choice',
            status: 'ready',
            prompt: { ar: 'ما ناتج 2 + 3؟' },
            points: '2.50',
            difficulty: 'easy',
            tags: ['arithmetic'],
            options: { create: [{ text: { ar: '4' }, isCorrect: false, sortOrder: 0 }, { text: { ar: '5' }, isCorrect: true, sortOrder: 1 }] },
          },
          select: { id: true, points: true, tags: true, options: { orderBy: { sortOrder: 'asc' }, select: { id: true, isCorrect: true } } },
        });
        expect(choice.points.toString()).toBe('2.5');
        expect(choice.tags).toEqual(['arithmetic']);
        expect(choice.options.map((option) => option.isCorrect)).toEqual([false, true]);
        expect(await tx.question.count({ where: { bankId: bankRow.id, tags: { has: 'arithmetic' } } })).toBe(1);

        const examRow = await tx.exam.create({
          data: {
            classId: klassRow.id,
            title: { ar: 'اختبار إلكتروني' },
            type: 'quiz',
            maxScore: '2.50',
            delivery: 'online',
            status: 'scheduled',
            scheduledAt: new Date(OPENS),
            closesAt: new Date(CLOSES),
            durationMinutes: 20,
            attemptsAllowed: 2,
            resultsRelease: 'on_submit',
            revealAnswers: true,
          },
          select: { id: true, delivery: true, resultsRelease: true },
        });
        expect(examRow).toMatchObject({ delivery: 'online', resultsRelease: 'on_submit' });
        const snapshot = { type: 'single_choice', prompt: { ar: 'ما ناتج 2 + 3؟' }, explanation: null, options: choice.options.map((option) => ({ id: option.id, text: { ar: '…' }, isCorrect: option.isCorrect })), correctBoolean: null };
        const link = await tx.examQuestion.create({ data: { examId: examRow.id, questionId: choice.id, sortOrder: 0, points: '2.50', snapshot }, select: { id: true } });
        const startedAt = new Date('2026-12-01T08:05:00Z');
        const attemptRow = await tx.examAttempt.create({
          data: { examId: examRow.id, studentUserId: student.id, attemptNo: 1, startedAt, expiresAt: new Date('2026-12-01T08:25:00Z'), maxScore: '2.50', questionCount: 1 },
          select: { id: true, status: true, score: true },
        });
        expect(attemptRow).toMatchObject({ status: 'in_progress', score: null });
        await tx.examAnswer.create({ data: { attemptId: attemptRow.id, examQuestionId: link.id, response: { optionId: choice.options[1]!.id }, answeredAt: startedAt } });
        const graded = await tx.examAttempt.update({
          where: { id: attemptRow.id },
          data: { status: 'submitted', submittedAt: startedAt, score: '2.50', correctCount: 1, gradedAt: startedAt },
          select: { status: true, score: true, answers: { select: { response: true } } },
        });
        expect(graded.status).toBe('submitted');
        expect(graded.score?.toString()).toBe('2.5');
        expect(graded.answers).toEqual([{ response: { optionId: choice.options[1]!.id } }]);
        const result = await tx.examResult.create({ data: { examId: examRow.id, studentUserId: student.id, status: 'scored', score: '2.50', source: 'online' }, select: { source: true, recordedById: true } });
        expect(result).toEqual({ source: 'online', recordedById: null });
        throw new Error(ROLLBACK);
      }),
    ).rejects.toThrow(ROLLBACK);
    expect(await prisma.course.count({ where: { code: `${tag}-P` } })).toBe(0);
  });
});
