// TEST-121 — the Stage 3 gate (task C5, CH-0109): the first complete student
// journey through the API against the live development database — WF-05 (a
// level and a published course with a syllabus), WF-03 (a class and its lead
// teacher), WF-06 (a room, the weekly schedule and the lesson generated from
// it), WF-04 (the class opened, the guardian linked, the student enrolled) and
// WF-12 (the teacher binds the generated lesson to a syllabus item, records
// attendance and completes it), read back by the student, the guardian and
// the teacher through "my classes", "my schedule", "my lessons" and the
// lessons list, and by the manager in the audit log. Every write goes through
// the API by a manager holding a custom role with the keys the journey needs
// (never academy_admin itself — TEST-026's last-admin test must not see it);
// the teacher, the student and the guardian hold the seeded system roles. The
// module gates stay in their own suites (TEST-046, TEST-052, TEST-075,
// TEST-120); this one chains the four modules of the stage once, end to end.
// Skipped when no database is reachable. Fixtures carry a unique prefix and
// are deleted at the end (their audit rows stay — KI-032).
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readSettings } from '../src/academy/academy.settings.js';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { PasswordService } from '../src/auth/password.service.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { datesBetween, weekdayOf, zonedInstant } from '../src/schedule/lesson-generation.plan.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
/** Prefix of the level, course, class and room codes (within every code pattern of the stage). */
const PREFIX = `Q${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-121 supertest';
const LEVELS = '/api/levels';
const COURSES = '/api/courses';
const CLASSES = '/api/classes';
const ROOMS = '/api/rooms';
const LESSONS = '/api/lessons';
const AUDIT = '/api/audit-logs';
/** A past calendar week (Sunday to Saturday) — every weekday occurs exactly once, so one slot generates exactly one lesson that has already started. */
const WEEK_FROM = '2026-10-04';
const WEEK_TO = '2026-10-10';

interface MyClassItem {
  enrollmentId: string;
  enrollmentStatus: string;
  relation: string;
  student: { id: string };
  class: { id: string; code: string; status: string };
}

interface MyScheduleItem {
  id: string;
  relation: string;
  student: { id: string } | null;
  class: { id: string };
}

interface MyLessonItem {
  id: string;
  status: string;
  relation: string;
  startsAt: string;
  student: { id: string };
  teacher: Record<string, unknown> | null;
  syllabusItem: { id: string; sortOrder: number } | null;
  attendance: { status: string; minutesLate: number | null; recordedAt: string } | null;
}

async function canConnect(url: string): Promise<boolean> {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 3000 }) });
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

describe.skipIf(!available)('Stage 3 gate — the complete student journey: course → class → schedule → enrollment → lesson → attendance (e2e, TEST-121)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let academyTimeZone: string;
  /** The weekday of the single weekly slot — the first working day of the academy, else Sunday. */
  let weekday: number;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
  const nonAuth = (log: { body: { items: { action: string; entityType: string | null; entityId: string | null }[] } }) =>
    log.body.items.filter((item) => !item.action.startsWith('auth.')).map((item) => [item.action, item.entityType, item.entityId]);

  async function createUser(name: string, roleIds: string[]): Promise<void> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Test ${name}`,
        passwordHash: await passwords.hash(PASSWORD),
        status: 'active',
        roles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
  }

  async function login(identifier: string): Promise<string> {
    const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier, password: PASSWORD }).expect(200);
    return res.body.accessToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    const academy = await prisma.academy.findFirstOrThrow({ select: { timezone: true, settings: true } });
    academyTimeZone = academy.timezone;
    weekday = (readSettings(academy.settings).scheduling.workingDays ?? [0])[0]!;

    // The manager holds every key the journey writes or reads with, as a
    // custom role (ROLE-07) — the stage's modules plus the guardian link of
    // MOD-03-T09 and the audit log; the others hold the real system roles.
    const manager = await prisma.role.create({
      data: {
        key: `test_stage3_${RUN.toLowerCase()}`,
        label: { ar: 'دور اختبار بوابة Stage 3' },
        permissions: {
          create: [
            'courses.read',
            'courses.manage',
            'classes.read',
            'classes.manage',
            'classes.teachers.assign',
            'enrollments.read',
            'enrollments.manage',
            'schedule.read',
            'schedule.manage',
            'lessons.read',
            'attendance.read',
            'guardians.link',
            'audit.read',
          ].map((permissionKey) => ({ permissionKey })),
        },
      },
      select: { id: true },
    });
    createdRoleIds.push(manager.id);
    await createUser('manager', [manager.id]);
    await createUser('teacher', [await systemRole('teacher')]);
    await createUser('student', [await systemRole('student')]);
    await createUser('guardian', [await systemRole('guardian')]);
    for (const name of ['manager', 'teacher', 'student', 'guardian']) tokens[name] = await login(email(name));
  });

  afterAll(async () => {
    try {
      // Enrollments first (Restrict on the class); the class takes its teachers, slots, lessons and attendance (Cascade); then the course (its items cascade) before its level, then the room (Restrict from slots/lessons) and the guardian link.
      await prisma.enrollment.deleteMany({ where: { class: { code: { startsWith: PREFIX } } } });
      await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
      await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
      await prisma.level.deleteMany({ where: { code: { startsWith: PREFIX } } });
      await prisma.room.deleteMany({ where: { code: { startsWith: PREFIX } } });
      if (fx['guardian']) await prisma.guardianStudent.deleteMany({ where: { guardianUserId: fx['guardian'] } });
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('a manager publishes a course, builds a class with its teacher and weekly schedule, enrolls a student and generates the lesson; the teacher records attendance; the student, the guardian and the teacher read their own views; the audit log holds every write', async () => {
    // Before the journey the learners have nothing.
    for (const name of ['student', 'guardian']) {
      expect((await api().get('/api/me/classes').set(bearer(name)).expect(200)).body.items).toEqual([]);
      expect((await api().get('/api/me/schedule').set(bearer(name)).expect(200)).body.items).toEqual([]);
      expect((await api().get('/api/me/lessons').set(bearer(name)).expect(200)).body.items).toEqual([]);
    }

    // 1. WF-05 — a level, a course on it with a two-item syllabus, published; the student sees the published course and its syllabus (courses.read by seed).
    const level = await api().post(LEVELS).set(bearer('manager')).send({ code: code('L'), name: { ar: 'مستوى البوابة' } }).expect(201);
    const levelId = level.body.id as string;
    const course = await api()
      .post(COURSES)
      .set(bearer('manager'))
      .send({ code: code('CRS'), name: { ar: 'دورة البوابة', en: 'Gate course' }, levelId, durationHours: 20 })
      .expect(201);
    const courseId = course.body.id as string;
    expect(course.body).toMatchObject({ code: code('CRS'), status: 'draft' });
    const syllabus = await api()
      .put(`${COURSES}/${courseId}/syllabus`)
      .set(bearer('manager'))
      .send({ items: [{ title: { ar: 'المقدمة' }, estimatedMinutes: 60 }, { title: { ar: 'التطبيق' } }] })
      .expect(200);
    const items = (syllabus.body.items as { id: string }[]).map((item) => item.id);
    expect(items).toHaveLength(2);
    // A draft is invisible to the student (D-R13) until it is published.
    expect((await api().get(`${COURSES}/${courseId}`).set(bearer('student')).expect(404)).body.code).toBe('course_not_found');
    expect((await api().post(`${COURSES}/${courseId}/status`).set(bearer('manager')).send({ action: 'publish' }).expect(200)).body.status).toBe('published');
    expect((await api().get(`${COURSES}/${courseId}`).set(bearer('student')).expect(200)).body).toMatchObject({ id: courseId, status: 'published', level: { id: levelId } });
    expect((await api().get(`${COURSES}/${courseId}/syllabus`).set(bearer('student')).expect(200)).body.items).toHaveLength(2);

    // 2. WF-03 — a planned class for the course and its lead teacher; the teacher sees the class only once assigned (D-R16).
    const created = await api().post(CLASSES).set(bearer('manager')).send({ courseId, code: code('A'), name: { ar: 'فصل البوابة', en: 'Gate class' }, capacity: 5 }).expect(201);
    const classId = created.body.id as string;
    expect(created.body).toMatchObject({ code: code('A'), status: 'planned', teachers: [], enrolledCount: 0, course: { id: courseId, status: 'published' } });
    expect((await api().get(`${CLASSES}/${classId}`).set(bearer('teacher')).expect(404)).body.code).toBe('class_not_found');
    await api().put(`${CLASSES}/${classId}/teachers`).set(bearer('manager')).send({ teachers: [{ userId: fx['teacher'], role: 'lead' }] }).expect(200);
    expect((await api().get(`${CLASSES}/${classId}`).set(bearer('teacher')).expect(200)).body.teachers).toMatchObject([{ userId: fx['teacher'], role: 'lead' }]);
    // The student may not build classes (403 — classes.manage is no learner key).
    expect((await api().post(CLASSES).set(bearer('student')).send({ courseId, code: code('X'), name: { ar: 'فصل' }, capacity: 1 }).expect(403)).body.code).toBe('permission_denied');

    // 3. WF-06 (MOD-07) — a room at the academy's site and one weekly slot in it with the lead teacher; the assigned teacher reads the schedule.
    const room = await api().post(ROOMS).set(bearer('manager')).send({ code: code('R'), name: { ar: 'قاعة البوابة' }, capacity: 12 }).expect(201);
    const roomId = room.body.id as string;
    expect(room.body).toMatchObject({ code: code('R'), branch: null, isActive: true });
    const schedule = await api()
      .put(`${CLASSES}/${classId}/schedule`)
      .set(bearer('manager'))
      .send({ slots: [{ weekday, startTime: '09:00', endTime: '10:00', roomId, teacherUserId: fx['teacher'], effectiveFrom: '2026-01-01' }] });
    expect(schedule.status, JSON.stringify(schedule.body)).toBe(200);
    const slotId = (schedule.body.slots as { id: string }[])[0]!.id;
    expect(schedule.body.slots).toMatchObject([{ weekday, startTime: '09:00', endTime: '10:00', room: { id: roomId, branch: null }, teacher: { userId: fx['teacher'] } }]);
    expect((await api().get(`${CLASSES}/${classId}/schedule`).set(bearer('teacher')).expect(200)).body.slots).toHaveLength(1);

    // 4. WF-04 — the class opens, the guardian is linked to the student (MOD-03-T09) and the student is enrolled straight to active.
    expect((await api().post(`${CLASSES}/${classId}/status`).set(bearer('manager')).send({ action: 'open' }).expect(200)).body.status).toBe('open');
    await api().post(`/api/users/${fx['student']}/guardians`).set(bearer('manager')).send({ guardianId: fx['guardian'], relationship: 'mother', isPrimary: true }).expect(201);
    const enrollment = await api().post(`${CLASSES}/${classId}/enrollments`).set(bearer('manager')).send({ studentId: fx['student'] }).expect(201);
    const enrollmentId = enrollment.body.id as string;
    expect(enrollment.body).toMatchObject({ classId, status: 'active', source: 'admin', student: { id: fx['student'] } });
    // The teacher reads the roster without contact fields and may not enroll (403); the guardian may not read it at all (403).
    const roster = await api().get(`${CLASSES}/${classId}/enrollments`).set(bearer('teacher')).expect(200);
    expect(roster.body.items).toMatchObject([{ status: 'active', student: { id: fx['student'], email: null, phone: null } }]);
    await api().post(`${CLASSES}/${classId}/enrollments`).set(bearer('teacher')).send({ studentId: fx['guardian'] }).expect(403);
    await api().get(`${CLASSES}/${classId}/enrollments`).set(bearer('guardian')).expect(403);

    // 5. The learners' first readings: the class in "my classes" (self / child) and the slot in "my schedule" (self / child), the teacher's slot too.
    const expectedClass = { id: classId, code: code('A'), status: 'open' };
    const mineStudent = await api().get('/api/me/classes').set(bearer('student')).expect(200);
    expect(mineStudent.body.items as MyClassItem[]).toMatchObject([{ enrollmentId, enrollmentStatus: 'active', relation: 'self', student: { id: fx['student'] }, class: expectedClass }]);
    const mineGuardian = await api().get('/api/me/classes').set(bearer('guardian')).expect(200);
    expect(mineGuardian.body.items as MyClassItem[]).toMatchObject([{ enrollmentId, relation: 'child', student: { id: fx['student'] }, class: expectedClass }]);
    const scheduleOf = async (name: string) =>
      ((await api().get('/api/me/schedule').set(bearer(name)).expect(200)).body.items as MyScheduleItem[]).map((item) => [item.id, item.relation, item.student?.id ?? null, item.class.id]);
    expect(await scheduleOf('student')).toEqual([[slotId, 'self', fx['student'], classId]]);
    expect(await scheduleOf('guardian')).toEqual([[slotId, 'child', fx['student'], classId]]);
    expect(await scheduleOf('teacher')).toEqual([[slotId, 'teacher', null, classId]]);
    // The academy timetable needs schedule.manage or classes.manage: the manager reads the class's slot, the student is refused.
    expect((await api().get('/api/schedule').query({ classId }).set(bearer('manager')).expect(200)).body.slots).toMatchObject([{ id: slotId, timeZone: academyTimeZone, class: { id: classId } }]);
    await api().get('/api/schedule').set(bearer('student')).expect(403);

    // 6. WF-06 (generation) — the lessons of a past week: the slot occurs once, so exactly one lesson, already started, taught by the slot's teacher in the room.
    const lessonDate = datesBetween(WEEK_FROM, WEEK_TO).find((date) => weekdayOf(date) === weekday)!;
    const generated = await api().post(`${CLASSES}/${classId}/schedule/generate`).set(bearer('manager')).send({ from: WEEK_FROM, to: WEEK_TO });
    expect(generated.status, JSON.stringify(generated.body).slice(0, 400)).toBe(200);
    expect(generated.body).toMatchObject({ classId, slots: 1, occurrences: 1, created: 1, existing: 0 });
    const lesson = (generated.body.lessons as { id: string; startsAt: string; scheduleId: string | null; status: string; teacher: { userId: string }; room: { id: string } | null; syllabusItem: unknown }[])[0]!;
    expect(lesson).toMatchObject({
      startsAt: zonedInstant(lessonDate, '09:00', academyTimeZone).toISOString(),
      scheduleId: slotId,
      status: 'scheduled',
      teacher: { userId: fx['teacher'] },
      room: { id: roomId },
      syllabusItem: null,
    });
    const lessonId = lesson.id;

    // 7. WF-12 — the teacher binds the lesson to the first syllabus item, reads the sheet (the student, no record yet) and records them present; the student may not record.
    expect((await api().patch(`${LESSONS}/${lessonId}`).set(bearer('teacher')).send({ syllabusItemId: items[0] }).expect(200)).body.syllabusItem).toMatchObject({ id: items[0], sortOrder: 0 });
    const sheet = await api().get(`${LESSONS}/${lessonId}/attendance`).set(bearer('teacher')).expect(200);
    expect(sheet.body).toMatchObject({ lessonId, classId, recordable: true, closedReason: null, counts: { recorded: 0 } });
    expect(sheet.body.items).toMatchObject([{ student: { id: fx['student'], email: null }, enrollmentStatus: 'active', record: null }]);
    const recorded = await api().put(`${LESSONS}/${lessonId}/attendance`).set(bearer('teacher')).send({ records: [{ studentId: fx['student'], status: 'present' }] }).expect(200);
    expect(recorded.body.counts).toMatchObject({ recorded: 1, present: 1, absent: 0, late: 0, excused: 0 });
    expect(recorded.body.items).toMatchObject([{ student: { id: fx['student'] }, record: { status: 'present', recordedBy: { userId: fx['teacher'] } } }]);
    await api().put(`${LESSONS}/${lessonId}/attendance`).set(bearer('student')).send({ records: [{ studentId: fx['student'], status: 'present' }] }).expect(403);
    // The lesson has started, so the teacher completes it.
    expect((await api().post(`${LESSONS}/${lessonId}/status`).set(bearer('teacher')).send({ action: 'complete' }).expect(200)).body.status).toBe('completed');

    // 8. The learners' last readings: the completed lesson on its syllabus item with the student's own attendance — for the student (self) and the guardian (child), the teacher by name only; the student's lessons.read opens no lesson directly.
    const lessonsOf = async (name: string) => (await api().get('/api/me/lessons').set(bearer(name)).expect(200)).body.items as MyLessonItem[];
    const forStudent = await lessonsOf('student');
    expect(forStudent).toHaveLength(1);
    expect(forStudent[0]).toMatchObject({
      id: lessonId,
      status: 'completed',
      relation: 'self',
      startsAt: lesson.startsAt,
      student: { id: fx['student'] },
      teacher: { fullName: 'Test teacher' },
      syllabusItem: { id: items[0], sortOrder: 0 },
      attendance: { status: 'present', minutesLate: null },
    });
    expect(forStudent[0]!.teacher).not.toHaveProperty('userId');
    for (const key of ['note', 'recordedBy', 'recordedById']) expect(forStudent[0]!.attendance).not.toHaveProperty(key);
    const forGuardian = await lessonsOf('guardian');
    expect(forGuardian.map((item) => [item.id, item.relation, item.student.id, item.attendance?.status ?? null])).toEqual([[lessonId, 'child', fx['student'], 'present']]);
    expect((await api().get(`${LESSONS}/${lessonId}`).set(bearer('student')).expect(404)).body.code).toBe('lesson_not_found');
    expect((await api().get(LESSONS).query({ classId }).set(bearer('student')).expect(200)).body.items).toEqual([]);
    // The teacher's lessons list carries the counts; "my lessons" is empty for the teacher (API-093 is theirs).
    expect((await api().get(LESSONS).query({ classId }).set(bearer('teacher')).expect(200)).body.items).toMatchObject([{ id: lessonId, status: 'completed', attendance: { recorded: 1, present: 1 } }]);
    expect(await lessonsOf('teacher')).toEqual([]);

    // 9. The audit log: every write of the manager in order (newest first) and the teacher's three — nothing for the refused requests.
    expect(nonAuth(await api().get(AUDIT).query({ actorUserId: fx['manager'], limit: 50 }).set(bearer('manager')).expect(200))).toEqual([
      ['lessons.created', 'classes', classId],
      ['enrollments.created', 'enrollments', enrollmentId],
      ['guardians.linked', 'users', fx['student']],
      ['classes.status.changed', 'classes', classId],
      ['classes.schedule.changed', 'classes', classId],
      ['rooms.created', 'rooms', roomId],
      ['classes.teachers.changed', 'classes', classId],
      ['classes.created', 'classes', classId],
      ['courses.status.changed', 'courses', courseId],
      ['courses.syllabus.changed', 'courses', courseId],
      ['courses.created', 'courses', courseId],
      ['levels.created', 'levels', levelId],
    ]);
    expect(nonAuth(await api().get(AUDIT).query({ actorUserId: fx['teacher'], limit: 50 }).set(bearer('manager')).expect(200))).toEqual([
      ['lessons.status.changed', 'lessons', lessonId],
      ['attendance.recorded', 'lessons', lessonId],
      ['lessons.updated', 'lessons', lessonId],
    ]);
    for (const name of ['teacher', 'student', 'guardian']) await api().get(AUDIT).set(bearer(name)).expect(403);
  });
});
