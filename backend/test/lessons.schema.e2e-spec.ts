// TEST-076 — MOD-06-T01 schema (migration 20261106123612_mod06_lessons_attendance):
// the `lessons` and `attendance_records` tables, their three enums, the
// hand-written CHECKs, the two EXCLUDE constraints (teacher and room
// double-booking between non-cancelled lessons — D-R34) on the `btree_gist`
// extension created by MOD-07-T01, and the referential actions. Runs against
// the local development database as the APPLICATION role and is skipped when
// no database is reachable (like TEST-007/TEST-047/TEST-070). Every data test
// runs inside a transaction that is rolled back.
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
const MIGRATION = '20261106123612_mod06_lessons_attendance';
const PREVIOUS_MIGRATION = '20261104144352_mod07_rooms_class_schedules';

// PostgreSQL SQLSTATE codes
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
/** ON DELETE RESTRICT is checked immediately and reports restrict_violation. */
const RESTRICT_VIOLATION = '23001';
const EXCLUSION_VIOLATION = '23P01';

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

describe.skipIf(!available)('database schema — MOD-06 lessons and attendance (e2e, TEST-076)', () => {
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
  const tag = `L${Date.now().toString(36)}`.slice(0, 10).toUpperCase();
  const TITLE = '{"ar":"درس"}';
  const LESSON_SQL = `INSERT INTO lessons (class_id, title, description, starts_at, ends_at, room_id, teacher_user_id, status, meeting_url, syllabus_item_id, schedule_id, created_by)
                      VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7, $8::lesson_status, $9, $10, $11, $12) RETURNING id`;
  const ATTENDANCE_SQL = `INSERT INTO attendance_records (lesson_id, student_user_id, status, minutes_late, note, recorded_by)
                          VALUES ($1, $2, $3::attendance_status, $4, $5, $6) RETURNING lesson_id`;

  interface LessonOver {
    title: string;
    description: string | null;
    start: string;
    end: string;
    roomId: string | null;
    teacherId: string | null;
    status: string;
    meetingUrl: string | null;
    syllabusItemId: string | null;
    scheduleId: string | null;
    createdBy: string | null;
  }
  /** A lesson with defaults: 2026-11-10 10:00–11:30 UTC, scheduled, no room, no teacher. */
  function lessonParams(classId: string, over: Partial<LessonOver> = {}): unknown[] {
    const l: LessonOver = {
      title: TITLE,
      description: null,
      start: '2026-11-10T10:00:00Z',
      end: '2026-11-10T11:30:00Z',
      roomId: null,
      teacherId: null,
      status: 'scheduled',
      meetingUrl: null,
      syllabusItemId: null,
      scheduleId: null,
      createdBy: null,
      ...over,
    };
    return [classId, l.title, l.description, l.start, l.end, l.roomId, l.teacherId, l.status, l.meetingUrl, l.syllabusItemId, l.scheduleId, l.createdBy];
  }
  async function lesson(client: PoolClient, classId: string, over: Partial<LessonOver> = {}): Promise<string> {
    return (await client.query<{ id: string }>(LESSON_SQL, lessonParams(classId, over))).rows[0]!.id;
  }
  async function klass(client: PoolClient, suffix: string): Promise<{ classId: string; courseId: string }> {
    const course = await client.query<{ id: string }>(
      `INSERT INTO courses (code, name, status) VALUES ($1, '{"ar":"دورة"}', 'published') RETURNING id`,
      [`${tag}-${suffix}`],
    );
    const created = await client.query<{ id: string }>(
      `INSERT INTO classes (course_id, code, name, capacity) VALUES ($1, $2, '{"ar":"فصل"}', 20) RETURNING id`,
      [course.rows[0]!.id, `${tag}-${suffix}`],
    );
    return { classId: created.rows[0]!.id, courseId: course.rows[0]!.id };
  }
  async function room(client: PoolClient, suffix: string): Promise<string> {
    return (await client.query<{ id: string }>(`INSERT INTO rooms (code, name) VALUES ($1, '{"ar":"قاعة"}') RETURNING id`, [`${tag}-${suffix}`])).rows[0]!.id;
  }
  async function user(client: PoolClient, name: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(`INSERT INTO users (full_name, email) VALUES ($1, $2) RETURNING id`, [
      name,
      `${tag.toLowerCase()}-${name}@example.com`,
    ]);
    return rows[0]!.id;
  }

  it('is applied after the MOD-07 migration, with the three enums and the lesson defaults', async () => {
    const migrations = await pool.query<{ migration_name: string; ok: boolean }>(
      `SELECT migration_name, finished_at IS NOT NULL AND rolled_back_at IS NULL AS ok FROM _prisma_migrations ORDER BY started_at`,
    );
    const names = migrations.rows.map((row) => row.migration_name);
    expect(names).toContain(MIGRATION);
    expect(names.indexOf(MIGRATION)).toBeGreaterThan(names.indexOf(PREVIOUS_MIGRATION));
    expect(migrations.rows.every((row) => row.ok)).toBe(true);

    const enums = async (name: string) => (await pool.query<{ v: string }>(`SELECT unnest(enum_range(NULL::${name}))::text AS v`)).rows.map((row) => row.v);
    expect(await enums('delivery_mode')).toEqual(['in_person', 'live_online', 'recorded', 'hybrid']);
    expect(await enums('lesson_status')).toEqual(['scheduled', 'in_progress', 'completed', 'cancelled']);
    expect(await enums('attendance_status')).toEqual(['present', 'absent', 'late', 'excused']);

    await inRollback(async (client) => {
      const { classId } = await klass(client, 'D');
      const created = await client.query<Record<string, unknown>>(
        `INSERT INTO lessons (class_id, title, starts_at, ends_at) VALUES ($1, $2::jsonb, '2026-11-10T10:00:00Z', '2026-11-10T11:00:00Z')
         RETURNING delivery_mode, status, description, room_id, teacher_user_id, meeting_url, cancellation_reason, attendance_taken_at, syllabus_item_id, schedule_id, created_by`,
        [classId, TITLE],
      );
      expect(created.rows[0]).toEqual({
        delivery_mode: 'in_person',
        status: 'scheduled',
        description: null,
        room_id: null,
        teacher_user_id: null,
        meeting_url: null,
        cancellation_reason: null,
        attendance_taken_at: null,
        syllabus_item_id: null,
        schedule_id: null,
        created_by: null,
      });
    });
  });

  it('gives the application role DML without TRUNCATE on both tables, and adds no second extension', async () => {
    for (const table of ['lessons', 'attendance_records']) {
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

  it('enforces the lessons CHECKs (localized title and description, end after start, https meeting link)', async () => {
    await inRollback(async (client) => {
      const { classId } = await klass(client, 'C');
      await expectSqlError(client, LESSON_SQL, lessonParams(classId, { title: '{"en":"no arabic"}' }), CHECK_VIOLATION, 'ck_lessons_title_localized');
      await expectSqlError(client, LESSON_SQL, lessonParams(classId, { title: '"plain text"' }), CHECK_VIOLATION, 'ck_lessons_title_localized');
      await expectSqlError(client, LESSON_SQL, lessonParams(classId, { description: '{"en":"no arabic"}' }), CHECK_VIOLATION, 'ck_lessons_description_localized');
      await expectSqlError(client, LESSON_SQL, lessonParams(classId, { description: '[]' }), CHECK_VIOLATION, 'ck_lessons_description_localized');
      await expectSqlError(client, LESSON_SQL, lessonParams(classId, { start: '2026-11-10T10:00:00Z', end: '2026-11-10T10:00:00Z' }), CHECK_VIOLATION, 'ck_lessons_times');
      await expectSqlError(client, LESSON_SQL, lessonParams(classId, { start: '2026-11-10T11:00:00Z', end: '2026-11-10T10:00:00Z' }), CHECK_VIOLATION, 'ck_lessons_times');
      await expectSqlError(client, LESSON_SQL, lessonParams(classId, { meetingUrl: 'http://meet.example.com/x' }), CHECK_VIOLATION, 'ck_lessons_meeting_url_https');
      await expectSqlError(client, LESSON_SQL, lessonParams(classId, { meetingUrl: 'meet.example.com' }), CHECK_VIOLATION, 'ck_lessons_meeting_url_https');
      // Valid: a description with `ar`, an https link, a lesson in the past (D-R33 (2)), a 12-hour lesson (the duration limit is a service rule).
      await lesson(client, classId, { description: '{"ar":"وصف","en":"Description"}', meetingUrl: 'https://meet.example.com/x' });
      await lesson(client, classId, { start: '2020-01-01T08:00:00Z', end: '2020-01-01T20:00:00Z' });
    });
  });

  it('enforces the attendance CHECKs and the one-record-per-student key (AC2, AC3)', async () => {
    await inRollback(async (client) => {
      const { classId } = await klass(client, 'A');
      const lessonId = await lesson(client, classId);
      const s1 = await user(client, 's1');
      const s2 = await user(client, 's2');
      const s3 = await user(client, 's3');
      await expectSqlError(client, ATTENDANCE_SQL, [lessonId, s1, 'late', 0, null, null], CHECK_VIOLATION, 'ck_attendance_records_minutes_late_positive');
      await expectSqlError(client, ATTENDANCE_SQL, [lessonId, s1, 'late', -5, null, null], CHECK_VIOLATION, 'ck_attendance_records_minutes_late_positive');
      await expectSqlError(client, ATTENDANCE_SQL, [lessonId, s1, 'present', 10, null, null], CHECK_VIOLATION, 'ck_attendance_records_minutes_late_only_late');
      await expectSqlError(client, ATTENDANCE_SQL, [lessonId, s1, 'excused', 1, null, null], CHECK_VIOLATION, 'ck_attendance_records_minutes_late_only_late');
      // The status has no default.
      await expectSqlError(client, `INSERT INTO attendance_records (lesson_id, student_user_id) VALUES ($1, $2)`, [lessonId, s1], '23502');

      await client.query(ATTENDANCE_SQL, [lessonId, s1, 'late', 10, 'تأخر عن الحافلة', null]);
      await client.query(ATTENDANCE_SQL, [lessonId, s2, 'late', null, null, null]);
      await client.query(ATTENDANCE_SQL, [lessonId, s3, 'present', null, null, null]);
      await expectSqlError(client, ATTENDANCE_SQL, [lessonId, s1, 'present', null, null, null], UNIQUE_VIOLATION, 'attendance_records_pkey');
      // The same student in another lesson is fine.
      const other = await lesson(client, classId, { start: '2026-11-11T10:00:00Z', end: '2026-11-11T11:00:00Z' });
      await client.query(ATTENDANCE_SQL, [other, s1, 'absent', null, null, null]);
    });
  });

  it('refuses two overlapping lessons in one room (AC4), whatever the class, and accepts back-to-back, cancelled and room-less lessons', async () => {
    await inRollback(async (client) => {
      const a = (await klass(client, 'RA')).classId;
      const b = (await klass(client, 'RB')).classId;
      const r = await room(client, 'R');
      await lesson(client, a, { roomId: r, start: '2026-11-10T10:00:00Z', end: '2026-11-10T11:30:00Z' });

      await expectSqlError(client, LESSON_SQL, lessonParams(b, { roomId: r, start: '2026-11-10T11:00:00Z', end: '2026-11-10T12:00:00Z' }), EXCLUSION_VIOLATION, 'ex_lessons_room');
      await expectSqlError(client, LESSON_SQL, lessonParams(b, { roomId: r, start: '2026-11-10T09:00:00Z', end: '2026-11-10T13:00:00Z' }), EXCLUSION_VIOLATION, 'ex_lessons_room');
      await expectSqlError(client, LESSON_SQL, lessonParams(a, { roomId: r, start: '2026-11-10T10:30:00Z', end: '2026-11-10T10:45:00Z' }), EXCLUSION_VIOLATION, 'ex_lessons_room');
      // A completed lesson still holds the room; a cancelled one does not.
      await expectSqlError(client, LESSON_SQL, lessonParams(b, { roomId: r, start: '2026-11-10T11:00:00Z', end: '2026-11-10T12:00:00Z', status: 'completed' }), EXCLUSION_VIOLATION, 'ex_lessons_room');
      await lesson(client, b, { roomId: r, start: '2026-11-10T11:00:00Z', end: '2026-11-10T12:00:00Z', status: 'cancelled' });

      // Back-to-back lessons share the boundary only: [10:00, 11:30) then [11:30, 12:30).
      await lesson(client, b, { roomId: r, start: '2026-11-10T11:30:00Z', end: '2026-11-10T12:30:00Z' });
      await lesson(client, b, { roomId: r, start: '2026-11-10T09:00:00Z', end: '2026-11-10T10:00:00Z' });
      // Another day, and no room.
      await lesson(client, b, { roomId: r, start: '2026-11-11T10:00:00Z', end: '2026-11-11T11:30:00Z' });
      await lesson(client, b, { roomId: null, start: '2026-11-10T10:00:00Z', end: '2026-11-10T11:30:00Z' });

      // Cancelling a lesson frees its room for an overlapping one; restoring it is then refused.
      const held = await lesson(client, a, { roomId: r, start: '2026-12-01T10:00:00Z', end: '2026-12-01T11:00:00Z' });
      await client.query(`UPDATE lessons SET status = 'cancelled' WHERE id = $1`, [held]);
      await lesson(client, b, { roomId: r, start: '2026-12-01T10:30:00Z', end: '2026-12-01T11:30:00Z' });
      await expectSqlError(client, `UPDATE lessons SET status = 'scheduled' WHERE id = $1`, [held], EXCLUSION_VIOLATION, 'ex_lessons_room');
    });
  });

  it('refuses a teacher in two overlapping lessons (AC4), in different rooms too, and accepts a lesson without a teacher', async () => {
    await inRollback(async (client) => {
      const a = (await klass(client, 'TA')).classId;
      const b = (await klass(client, 'TB')).classId;
      const teacher = await user(client, 'teacher');
      const other = await user(client, 'other');
      const r1 = await room(client, 'T1');
      const r2 = await room(client, 'T2');
      await lesson(client, a, { roomId: r1, teacherId: teacher, start: '2026-11-12T08:00:00Z', end: '2026-11-12T09:30:00Z' });

      await expectSqlError(client, LESSON_SQL, lessonParams(b, { roomId: r2, teacherId: teacher, start: '2026-11-12T09:00:00Z', end: '2026-11-12T10:00:00Z' }), EXCLUSION_VIOLATION, 'ex_lessons_teacher');
      await expectSqlError(client, LESSON_SQL, lessonParams(b, { roomId: null, teacherId: teacher, start: '2026-11-12T08:00:00Z', end: '2026-11-12T09:30:00Z' }), EXCLUSION_VIOLATION, 'ex_lessons_teacher');

      await lesson(client, b, { roomId: r2, teacherId: teacher, start: '2026-11-12T09:30:00Z', end: '2026-11-12T10:30:00Z' });
      await lesson(client, b, { roomId: r2, teacherId: other, start: '2026-11-12T08:00:00Z', end: '2026-11-12T09:00:00Z' });
      await lesson(client, b, { roomId: null, teacherId: null, start: '2026-11-12T08:00:00Z', end: '2026-11-12T09:30:00Z' });
      await lesson(client, b, { roomId: null, teacherId: teacher, start: '2026-11-12T08:00:00Z', end: '2026-11-12T09:30:00Z', status: 'cancelled' });
    });
  });

  it('cascades a deleted lesson to its attendance and a deleted class to its lessons; clears syllabus item, slot, creator and recorder links; restricts rooms, teachers and students (AC5)', async () => {
    await inRollback(async (client) => {
      const { classId, courseId } = await klass(client, 'FK');
      const item = (await client.query<{ id: string }>(`INSERT INTO course_syllabus_items (course_id, sort_order, title) VALUES ($1, 1, $2::jsonb) RETURNING id`, [courseId, TITLE])).rows[0]!.id;
      const slot = (
        await client.query<{ id: string }>(
          `INSERT INTO class_schedules (class_id, weekday, start_time, end_time, effective_from) VALUES ($1, 2, '10:00', '11:30', '2026-01-01') RETURNING id`,
          [classId],
        )
      ).rows[0]!.id;
      const r = await room(client, 'FK');
      const teacher = await user(client, 'fkteacher');
      const creator = await user(client, 'fkcreator');
      const student = await user(client, 'fkstudent');
      const recorder = await user(client, 'fkrecorder');
      const lessonId = await lesson(client, classId, { roomId: r, teacherId: teacher, syllabusItemId: item, scheduleId: slot, createdBy: creator });
      await client.query(ATTENDANCE_SQL, [lessonId, student, 'present', null, null, recorder]);

      await expectSqlError(client, `DELETE FROM rooms WHERE id = $1`, [r], RESTRICT_VIOLATION, 'lessons_room_id_fkey');
      await expectSqlError(client, `DELETE FROM users WHERE id = $1`, [teacher], RESTRICT_VIOLATION, 'lessons_teacher_user_id_fkey');
      await expectSqlError(client, `DELETE FROM users WHERE id = $1`, [student], RESTRICT_VIOLATION, 'attendance_records_student_user_id_fkey');

      await client.query(`DELETE FROM course_syllabus_items WHERE id = $1`, [item]);
      await client.query(`DELETE FROM class_schedules WHERE id = $1`, [slot]);
      await client.query(`DELETE FROM users WHERE id = $1`, [creator]);
      await client.query(`DELETE FROM users WHERE id = $1`, [recorder]);
      const after = await client.query<{ syllabus_item_id: string | null; schedule_id: string | null; created_by: string | null }>(
        `SELECT syllabus_item_id, schedule_id, created_by FROM lessons WHERE id = $1`,
        [lessonId],
      );
      expect(after.rows[0]).toEqual({ syllabus_item_id: null, schedule_id: null, created_by: null });
      const record = await client.query<{ recorded_by: string | null }>(`SELECT recorded_by FROM attendance_records WHERE lesson_id = $1`, [lessonId]);
      expect(record.rows[0]!.recorded_by).toBeNull();

      await client.query(`DELETE FROM lessons WHERE id = $1`, [lessonId]);
      expect((await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM attendance_records WHERE lesson_id = $1`, [lessonId])).rows[0]!.n).toBe(0);
      // With the lesson gone the room and the teacher can go.
      await client.query(`DELETE FROM rooms WHERE id = $1`, [r]);
      await client.query(`DELETE FROM users WHERE id = $1`, [teacher]);

      const second = await lesson(client, classId);
      await client.query(`DELETE FROM classes WHERE id = $1`, [classId]);
      expect((await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM lessons WHERE id = $1`, [second])).rows[0]!.n).toBe(0);
    });
  });

  it('names the CHECKs and the EXCLUDE constraints as the migration does, on gist over tstzrange', async () => {
    const constraints = await pool.query<{ table_name: string; conname: string; contype: string }>(
      `SELECT conrelid::regclass::text AS table_name, conname, contype::text AS contype
         FROM pg_constraint WHERE conrelid IN ('lessons'::regclass, 'attendance_records'::regclass) AND contype IN ('c', 'x')
        ORDER BY 1, 2`,
    );
    expect(constraints.rows).toEqual([
      { table_name: 'attendance_records', conname: 'ck_attendance_records_minutes_late_only_late', contype: 'c' },
      { table_name: 'attendance_records', conname: 'ck_attendance_records_minutes_late_positive', contype: 'c' },
      { table_name: 'lessons', conname: 'ck_lessons_description_localized', contype: 'c' },
      { table_name: 'lessons', conname: 'ck_lessons_meeting_url_https', contype: 'c' },
      { table_name: 'lessons', conname: 'ck_lessons_times', contype: 'c' },
      { table_name: 'lessons', conname: 'ck_lessons_title_localized', contype: 'c' },
      { table_name: 'lessons', conname: 'ex_lessons_room', contype: 'x' },
      { table_name: 'lessons', conname: 'ex_lessons_teacher', contype: 'x' },
    ]);
    const exclusion = await pool.query<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname IN ('ex_lessons_room', 'ex_lessons_teacher') ORDER BY 1`,
    );
    expect(exclusion.rows[0]!.def).toMatch(/^EXCLUDE USING gist \(room_id WITH =, tstzrange\(starts_at, ends_at\) WITH &&\) WHERE \(\(\(room_id IS NOT NULL\) AND \(status <> 'cancelled'::lesson_status\)\)\)$/);
    expect(exclusion.rows[1]!.def).toMatch(/^EXCLUDE USING gist \(teacher_user_id WITH =, tstzrange\(starts_at, ends_at\) WITH &&\) WHERE \(\(\(teacher_user_id IS NOT NULL\) AND \(status <> 'cancelled'::lesson_status\)\)\)$/);
  });

  it('round-trips through the generated Prisma client and rolls back', async () => {
    const marker = new Error('rollback');
    await expect(
      prisma.$transaction(async (tx) => {
        const course = await tx.course.create({ data: { code: `${tag}-P`, name: { ar: 'دورة' }, status: 'published' } });
        const created = await tx.class.create({ data: { courseId: course.id, code: `${tag}-P`, name: { ar: 'فصل' }, capacity: 10 } });
        const student = await tx.user.create({ data: { fullName: 'Prisma student', email: `${tag.toLowerCase()}-prisma@example.com` } });
        const lessonRow = await tx.lesson.create({
          data: {
            classId: created.id,
            title: { ar: 'الدرس الأول', en: 'Lesson 1' },
            deliveryMode: 'live_online',
            meetingUrl: 'https://meet.example.com/p',
            startsAt: new Date('2026-11-10T10:00:00Z'),
            endsAt: new Date('2026-11-10T11:30:00Z'),
            attendance: { create: [{ studentUserId: student.id, status: 'late', minutesLate: 5 }] },
          },
          include: { attendance: true },
        });
        expect(lessonRow).toMatchObject({ status: 'scheduled', deliveryMode: 'live_online', roomId: null, teacherUserId: null, attendanceTakenAt: null });
        expect(lessonRow.attendance).toHaveLength(1);
        expect(lessonRow.attendance[0]).toMatchObject({ status: 'late', minutesLate: 5, note: null, recordedById: null });

        const read = await tx.class.findUniqueOrThrow({ where: { id: created.id }, include: { lessons: { include: { attendance: { include: { student: true } } } } } });
        expect(read.lessons).toHaveLength(1);
        expect(read.lessons[0]!.attendance[0]!.student.fullName).toBe('Prisma student');
        throw marker;
      }),
    ).rejects.toBe(marker);
    expect(await prisma.lesson.count({ where: { class: { code: `${tag}-P` } } })).toBe(0);
  });
});
