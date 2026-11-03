// TEST-047 — MOD-05-T01 schema (migration 20261103123442_mod05_classes_teachers_enrollments):
// classes, class_teachers, enrollments. Runs against the local development
// database as the APPLICATION role and is skipped when no database is
// reachable (like TEST-007 and TEST-039). Every test runs inside a transaction
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
const MIGRATION = '20261103123442_mod05_classes_teachers_enrollments';

// PostgreSQL SQLSTATE codes
const UNIQUE_VIOLATION = '23505';
const RESTRICT_VIOLATION = '23001';
const NOT_NULL_VIOLATION = '23502';
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

describe.skipIf(!available)('database schema — MOD-05 classes, class teachers, enrollments (e2e, TEST-047)', () => {
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
  const tag = `k${Date.now().toString(36)}`.slice(0, 10).toUpperCase();
  const COURSE_SQL = `INSERT INTO courses (code, name, status) VALUES ($1, '{"ar":"دورة"}', 'published') RETURNING id`;
  const CLASS_SQL = `INSERT INTO classes (course_id, code, name, capacity) VALUES ($1, $2, $3::jsonb, $4) RETURNING id, status`;
  const USER_SQL = `INSERT INTO users (full_name, email) VALUES ($1, $2) RETURNING id`;

  async function course(client: PoolClient, suffix: string): Promise<string> {
    return (await client.query<{ id: string }>(COURSE_SQL, [`${tag}-${suffix}`])).rows[0]!.id;
  }
  async function klass(client: PoolClient, courseId: string, suffix: string, capacity = 20): Promise<string> {
    return (await client.query<{ id: string }>(CLASS_SQL, [courseId, `${tag}-${suffix}`, '{"ar":"فصل"}', capacity])).rows[0]!.id;
  }
  async function user(client: PoolClient, name: string): Promise<string> {
    return (await client.query<{ id: string }>(USER_SQL, [name, `${tag.toLowerCase()}-${name}@example.com`])).rows[0]!.id;
  }

  it('is applied after the MOD-04 migration and creates the four enums with their values', async () => {
    const migrations = await pool.query<{ migration_name: string; ok: boolean }>(
      `SELECT migration_name, finished_at IS NOT NULL AND rolled_back_at IS NULL AS ok FROM _prisma_migrations ORDER BY started_at`,
    );
    const names = migrations.rows.map((row) => row.migration_name);
    expect(names).toContain(MIGRATION);
    expect(names.indexOf(MIGRATION)).toBeGreaterThan(names.indexOf('20261101201101_mod04_courses_levels_syllabus'));
    expect(migrations.rows.every((row) => row.ok)).toBe(true);

    const values = async (type: string) => (await pool.query<{ v: string }>(`SELECT unnest(enum_range(NULL::${type}))::text AS v`)).rows.map((row) => row.v);
    expect(await values('class_status')).toEqual(['planned', 'open', 'running', 'completed', 'cancelled']);
    expect(await values('class_teacher_role')).toEqual(['lead', 'assistant']);
    expect(await values('enrollment_status')).toEqual(['pending', 'active', 'completed', 'withdrawn', 'cancelled']);
    expect(await values('enrollment_source')).toEqual(['admin', 'self', 'import', 'transfer']);
  });

  it('defaults a class to planned and an enrollment source to admin; the enrollment status has no default', async () => {
    await inRollback(async (client) => {
      const courseId = await course(client, 'D');
      const created = await client.query<{ id: string; status: string }>(CLASS_SQL, [courseId, `${tag}-D1`, '{"ar":"فصل"}', 10]);
      expect(created.rows[0]!.status).toBe('planned');
      await expectSqlError(client, `UPDATE classes SET status = 'archived' WHERE id = $1`, [created.rows[0]!.id], INVALID_TEXT);

      const student = await user(client, 'student-d');
      await expectSqlError(client, `INSERT INTO enrollments (class_id, student_user_id) VALUES ($1, $2)`, [created.rows[0]!.id, student], NOT_NULL_VIOLATION);
      const enrollment = await client.query<{ source: string; enrolled_at: Date | null }>(
        `INSERT INTO enrollments (class_id, student_user_id, status) VALUES ($1, $2, 'active') RETURNING source, enrolled_at`,
        [created.rows[0]!.id, student],
      );
      expect(enrollment.rows[0]).toMatchObject({ source: 'admin' });
      expect(enrollment.rows[0]!.enrolled_at).toBeInstanceOf(Date);
    });
  });

  it('enforces the hand-written CHECKs (localized name with ar, trimmed code, positive capacity, date order)', async () => {
    await inRollback(async (client) => {
      const courseId = await course(client, 'C');
      await expectSqlError(client, CLASS_SQL, [courseId, `${tag}-C1`, '{"en":"no arabic"}', 10], CHECK_VIOLATION);
      await expectSqlError(client, CLASS_SQL, [courseId, `${tag}-C2`, '"plain text"', 10], CHECK_VIOLATION);
      await expectSqlError(client, CLASS_SQL, [courseId, ` ${tag}-C3`, '{"ar":"مسافة"}', 10], CHECK_VIOLATION);
      await expectSqlError(client, CLASS_SQL, [courseId, '', '{"ar":"فارغ"}', 10], CHECK_VIOLATION);
      await expectSqlError(client, CLASS_SQL, [courseId, `${tag}-C4`, '{"ar":"صفر"}', 0], CHECK_VIOLATION);
      await expectSqlError(client, CLASS_SQL, [courseId, `${tag}-C5`, '{"ar":"سالب"}', -3], CHECK_VIOLATION);
      const DATED_SQL = `INSERT INTO classes (course_id, code, name, capacity, starts_on, ends_on) VALUES ($1, $2, '{"ar":"فصل"}', 10, $3, $4)`;
      await expectSqlError(client, DATED_SQL, [courseId, `${tag}-C6`, '2026-12-01', '2026-11-30'], CHECK_VIOLATION);
      await client.query(DATED_SQL, [courseId, `${tag}-C7`, '2026-12-01', '2026-12-01']);
      await client.query(DATED_SQL, [courseId, `${tag}-C8`, null, '2026-12-01']);
      await client.query(
        `INSERT INTO classes (course_id, code, name, capacity, notes) VALUES ($1, $2, '{"ar":"فصل","en":"Class"}', 1, 'ملاحظة')`,
        [courseId, `${tag}-C9`],
      );
    });
  });

  it('keeps class codes unique, allows one lead per class, and one enrollment per student and class', async () => {
    await inRollback(async (client) => {
      const courseId = await course(client, 'U');
      const classId = await klass(client, courseId, 'U1');
      await expectSqlError(client, CLASS_SQL, [courseId, `${tag}-U1`, '{"ar":"مكرر"}', 5], UNIQUE_VIOLATION);

      const [lead, other, assistant1, assistant2] = [await user(client, 'lead'), await user(client, 'other'), await user(client, 'as1'), await user(client, 'as2')];
      const TEACHER_SQL = `INSERT INTO class_teachers (class_id, teacher_user_id, role) VALUES ($1, $2, $3)`;
      await client.query(TEACHER_SQL, [classId, lead, 'lead']);
      await expectSqlError(client, TEACHER_SQL, [classId, other, 'lead'], UNIQUE_VIOLATION);
      await client.query(TEACHER_SQL, [classId, assistant1, 'assistant']);
      await client.query(TEACHER_SQL, [classId, assistant2, 'assistant']);
      // The same person twice in one class is the primary key.
      await expectSqlError(client, TEACHER_SQL, [classId, assistant1, 'assistant'], UNIQUE_VIOLATION);
      // Another class may have its own lead; demoting the lead frees the slot.
      const second = await klass(client, courseId, 'U2');
      await client.query(TEACHER_SQL, [second, other, 'lead']);
      await client.query(`UPDATE class_teachers SET role = 'assistant' WHERE class_id = $1 AND teacher_user_id = $2`, [classId, lead]);
      await client.query(TEACHER_SQL, [classId, other, 'lead']);

      const student = await user(client, 'student-u');
      const ENROLL_SQL = `INSERT INTO enrollments (class_id, student_user_id, status) VALUES ($1, $2, $3)`;
      await client.query(ENROLL_SQL, [classId, student, 'active']);
      await expectSqlError(client, ENROLL_SQL, [classId, student, 'pending'], UNIQUE_VIOLATION);
      await client.query(ENROLL_SQL, [second, student, 'active']);
    });
  });

  it('applies the delete rules: course restrict, teachers cascade, enrollments restrict, people restrict, creators set null', async () => {
    await inRollback(async (client) => {
      const creator = await user(client, 'creator');
      const courseId = await course(client, 'R');
      const classId = (
        await client.query<{ id: string }>(
          `INSERT INTO classes (course_id, code, name, capacity, created_by) VALUES ($1, $2, '{"ar":"فصل"}', 10, $3) RETURNING id`,
          [courseId, `${tag}-R1`, creator],
        )
      ).rows[0]!.id;
      const teacher = await user(client, 'teacher-r');
      const student = await user(client, 'student-r');
      await client.query(`INSERT INTO class_teachers (class_id, teacher_user_id, role, assigned_by) VALUES ($1, $2, 'lead', $3)`, [classId, teacher, creator]);
      const enrollment = (
        await client.query<{ id: string }>(
          `INSERT INTO enrollments (class_id, student_user_id, status, created_by) VALUES ($1, $2, 'active', $3) RETURNING id`,
          [classId, student, creator],
        )
      ).rows[0]!.id;

      await expectSqlError(client, `DELETE FROM courses WHERE id = $1`, [courseId], RESTRICT_VIOLATION);
      await expectSqlError(client, `DELETE FROM classes WHERE id = $1`, [classId], RESTRICT_VIOLATION);
      await expectSqlError(client, `DELETE FROM users WHERE id = $1`, [teacher], RESTRICT_VIOLATION);
      await expectSqlError(client, `DELETE FROM users WHERE id = $1`, [student], RESTRICT_VIOLATION);

      // Removing the creator clears the three "by" columns.
      await client.query(`DELETE FROM users WHERE id = $1`, [creator]);
      const byClass = await client.query(`SELECT created_by FROM classes WHERE id = $1`, [classId]);
      const byTeacher = await client.query(`SELECT assigned_by FROM class_teachers WHERE class_id = $1`, [classId]);
      const byEnrollment = await client.query(`SELECT created_by FROM enrollments WHERE id = $1`, [enrollment]);
      expect([byClass.rows[0]!.created_by, byTeacher.rows[0]!.assigned_by, byEnrollment.rows[0]!.created_by]).toEqual([null, null, null]);

      // Without enrollments the class can go, and its teachers go with it.
      await client.query(`DELETE FROM enrollments WHERE id = $1`, [enrollment]);
      await client.query(`DELETE FROM classes WHERE id = $1`, [classId]);
      const teachers = await client.query(`SELECT 1 FROM class_teachers WHERE class_id = $1`, [classId]);
      expect(teachers.rows).toHaveLength(0);
      await client.query(`DELETE FROM courses WHERE id = $1`, [courseId]);
    });
  });

  it('round-trips through the generated Prisma client (dates, enums, relations) and rolls back', async () => {
    const rollback = new Error('rollback');
    await expect(
      prisma.$transaction(async (tx) => {
        const teacher = await tx.user.create({ data: { fullName: 'Prisma teacher', email: `${tag.toLowerCase()}-pt@example.com` } });
        const student = await tx.user.create({ data: { fullName: 'Prisma student', email: `${tag.toLowerCase()}-ps@example.com` } });
        const created = await tx.course.create({
          data: {
            code: `${tag}-PC`,
            name: { ar: 'بايثون' },
            status: 'published',
            classes: {
              create: {
                code: `${tag}-PK`,
                name: { ar: 'فصل المساء', en: 'Evening class' },
                capacity: 12,
                startsOn: new Date('2026-12-01T00:00:00.000Z'),
                endsOn: new Date('2027-01-31T00:00:00.000Z'),
                teachers: { create: [{ teacherUserId: teacher.id, role: 'lead' }] },
                enrollments: { create: [{ studentUserId: student.id, status: 'active', activatedAt: new Date() }] },
              },
            },
          },
          include: { classes: { include: { teachers: true, enrollments: true } } },
        });
        const made = created.classes[0]!;
        expect(made.status).toBe('planned');
        expect(made.startsOn?.toISOString().slice(0, 10)).toBe('2026-12-01');
        expect(made.teachers.map((row) => row.role)).toEqual(['lead']);
        expect(made.enrollments.map((row) => [row.status, row.source])).toEqual([['active', 'admin']]);
        expect(made.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
        const active = await tx.enrollment.count({ where: { classId: made.id, status: 'active' } });
        expect(active).toBe(1);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(await prisma.class.count({ where: { code: `${tag}-PK` } })).toBe(0);
  });
});
