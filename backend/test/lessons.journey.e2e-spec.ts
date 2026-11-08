// TEST-120 — the MOD-06 module gate (MOD-06-T05, CH-0104): the MOD-06 part of
// WF-06 "schedule a lesson" (a manual lesson and its cancellation) and WF-12
// "record attendance" through the API against the live development database.
// A manager prepares the class (WF-03/WF-04: a planned class for a published
// course with a syllabus, its lead teacher, open, two active enrollments);
// the teacher (the seeded `teacher` system role) creates a lesson bound to a
// syllabus item and a second one that they cancel with a reason, then records
// attendance for the started lesson (one present, one late); each student
// (the seeded `student` role) sees both lessons and their own attendance in
// GET /api/me/lessons, and so does the guardian (the seeded `guardian` role)
// of one of them — never the teacher's note, the recorder or the cancellation
// reason. The manager reads the journey's events in GET /api/audit-logs.
// Skipped when no database is reachable. Fixtures carry a unique prefix and
// are deleted at the end (their audit rows stay — KI-032). The browser
// journey waits for MOD-06-T06 (J-F09).
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { PasswordService } from '../src/auth/password.service.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
/** Prefix of the course and class codes. */
const PREFIX = `G${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-120 supertest';
const CLASSES = '/api/classes';
const LESSONS = '/api/lessons';
const MY_LESSONS = '/api/me/lessons';
const AUDIT = '/api/audit-logs';
const HOUR = 3_600_000;
/** An instant relative to now, as the API takes and returns it (UTC, milliseconds). */
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

interface MyLessonItem {
  id: string;
  status: string;
  relation: string;
  student: { id: string; fullName: string };
  teacher: Record<string, unknown> | null;
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

describe.skipIf(!available)('WF-06/WF-12 lesson and attendance journey — the MOD-06 gate (e2e, TEST-120)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let courseId: string;
  const items: string[] = [];
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
  const myLessons = (name: string, query: Record<string, string> = {}) => api().get(MY_LESSONS).query(query).set(bearer(name));
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

    // The manager holds the keys the journey needs without the academy_admin
    // role itself (so TEST-026's last-admin test never touches it) — and reads
    // lessons through classes.manage; everyone else holds the real system role.
    const manager = await prisma.role.create({
      data: {
        key: `test_wf12_${RUN.toLowerCase()}`,
        label: { ar: 'دور اختبار WF-06/WF-12' },
        permissions: {
          create: [
            'classes.read',
            'classes.manage',
            'classes.teachers.assign',
            'enrollments.read',
            'enrollments.manage',
            'lessons.read',
            'attendance.read',
            'users.read_contact',
            'audit.read',
          ].map((permissionKey) => ({ permissionKey })),
        },
      },
      select: { id: true },
    });
    createdRoleIds.push(manager.id);
    await createUser('manager', [manager.id]);
    await createUser('teacher', [await systemRole('teacher')]);
    const student = await systemRole('student');
    await createUser('student1', [student]);
    await createUser('student2', [student]);
    await createUser('guardian', [await systemRole('guardian')]);
    for (const name of ['manager', 'teacher', 'student1', 'student2', 'guardian']) tokens[name] = await login(email(name));

    // Preconditions from other journeys: a published course with a syllabus (WF-05) and the guardian link of student1 (MOD-03-T09).
    const course = await prisma.course.create({
      data: {
        code: `${PREFIX}-CRS`,
        name: { ar: 'دورة رحلة الدروس' },
        status: 'published',
        syllabusItems: { create: [{ sortOrder: 1, title: { ar: 'المقدمة' } }, { sortOrder: 2, title: { ar: 'التطبيق' } }] },
      },
      select: { id: true, syllabusItems: { orderBy: { sortOrder: 'asc' }, select: { id: true } } },
    });
    courseId = course.id;
    items.push(...course.syllabusItems.map((item) => item.id));
    await prisma.guardianStudent.create({ data: { guardianUserId: fx['guardian']!, studentUserId: fx['student1']!, relationship: 'father', isPrimary: true } });
  });

  afterAll(async () => {
    try {
      // Enrollments first (Restrict on the class); the class takes its teachers, lessons and attendance (Cascade); then the course (Restrict on classes, its items cascade).
      await prisma.enrollment.deleteMany({ where: { class: { code: { startsWith: PREFIX } } } });
      await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
      await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('the teacher of a prepared class creates a lesson on a syllabus item, cancels a second one and records attendance; both students and a guardian see their own lessons and attendance; the events are in the audit log', async () => {
    // Before the journey nobody has a lesson.
    for (const name of ['student1', 'student2', 'guardian']) expect((await myLessons(name).expect(200)).body).toEqual({ items: [], nextCursor: null });

    // 0. Preconditions (WF-03/WF-04): the manager creates the class, assigns the lead teacher, opens it and enrolls both students.
    const created = await api().post(CLASSES).set(bearer('manager')).send({ courseId, code: `${PREFIX}-A`, name: { ar: 'فصل رحلة الدروس' }, capacity: 2 }).expect(201);
    const classId = created.body.id as string;
    await api().put(`${CLASSES}/${classId}/teachers`).set(bearer('manager')).send({ teachers: [{ userId: fx['teacher'], role: 'lead' }] }).expect(200);
    await api().post(`${CLASSES}/${classId}/status`).set(bearer('manager')).send({ action: 'open' }).expect(200);
    for (const name of ['student1', 'student2']) await api().post(`${CLASSES}/${classId}/enrollments`).set(bearer('manager')).send({ studentId: fx[name] }).expect(201);

    // 1. WF-06 (MOD-06 part) — the teacher creates a lesson that started two hours ago, bound to the first syllabus item; the lead teacher is the default.
    const l1Start = at(-2 * HOUR);
    const l1End = at(-1 * HOUR);
    const l2Start = at(24 * HOUR);
    const l2End = at(25 * HOUR);
    const l1 = await api()
      .post(`${CLASSES}/${classId}/lessons`)
      .set(bearer('teacher'))
      .send({ title: { ar: 'الدرس الأول', en: 'Lesson one' }, startsAt: l1Start, endsAt: l1End, syllabusItemId: items[0] })
      .expect(201);
    const lesson1 = l1.body.id as string;
    expect(l1.body).toMatchObject({
      class: { id: classId, code: `${PREFIX}-A`, status: 'open', course: { id: courseId, code: `${PREFIX}-CRS` } },
      title: { ar: 'الدرس الأول', en: 'Lesson one' },
      startsAt: l1Start,
      endsAt: l1End,
      status: 'scheduled',
      teacher: { userId: fx['teacher'], fullName: 'Test teacher' },
      syllabusItem: { id: items[0], sortOrder: 1 },
      cancellationReason: null,
      attendanceTakenAt: null,
      attendance: { recorded: 0, present: 0, absent: 0, late: 0, excused: 0 },
    });
    // A student holds lessons.read by seed, never lessons.manage.
    const refused = await api().post(`${CLASSES}/${classId}/lessons`).set(bearer('student1')).send({ title: { ar: 'درس' }, startsAt: l2Start, endsAt: l2End }).expect(403);
    expect(refused.body.code).toBe('permission_denied');

    // 2. WF-06 — a second lesson tomorrow, cancelled by the teacher with a reason; the attendance of a cancelled lesson is closed.
    const l2 = await api()
      .post(`${CLASSES}/${classId}/lessons`)
      .set(bearer('teacher'))
      .send({ title: { ar: 'الدرس الثاني' }, startsAt: l2Start, endsAt: l2End, syllabusItemId: items[1] })
      .expect(201);
    const lesson2 = l2.body.id as string;
    const cancelled = await api().post(`${LESSONS}/${lesson2}/status`).set(bearer('teacher')).send({ action: 'cancel', reason: 'المعلم في مهمة' }).expect(200);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancellationReason: 'المعلم في مهمة' });
    const closed = await api().put(`${LESSONS}/${lesson2}/attendance`).set(bearer('teacher')).send({ records: [{ studentId: fx['student1'], status: 'present' }] }).expect(409);
    expect(closed.body).toMatchObject({ code: 'attendance_closed', reason: 'cancelled' });

    // 3. WF-12 — the sheet of the started lesson lists both students (D-R07 projection, no record yet); the teacher records one present and one late with a note.
    const sheet = await api().get(`${LESSONS}/${lesson1}/attendance`).set(bearer('teacher')).expect(200);
    expect(sheet.body).toMatchObject({ lessonId: lesson1, classId, lessonStatus: 'scheduled', recordable: true, closedReason: null, attendanceTakenAt: null, counts: { recorded: 0 } });
    const blank = sheet.body.items as { student: { id: string; email: string | null }; enrollmentStatus: string; record: unknown }[];
    expect(blank.map((item) => [item.student.id, item.student.email, item.enrollmentStatus, item.record])).toEqual([
      [fx['student1'], null, 'active', null],
      [fx['student2'], null, 'active', null],
    ]);
    const records = [
      { studentId: fx['student1'], status: 'present' },
      { studentId: fx['student2'], status: 'late', minutesLate: 10, note: 'وصل بعد البداية' },
    ];
    const recorded = await api().put(`${LESSONS}/${lesson1}/attendance`).set(bearer('teacher')).send({ records }).expect(200);
    expect(recorded.body).toMatchObject({ recordable: true, counts: { recorded: 2, present: 1, absent: 0, late: 1, excused: 0 } });
    expect(typeof recorded.body.attendanceTakenAt).toBe('string');
    const taken = recorded.body.items as { student: { id: string }; record: { status: string; minutesLate: number | null; note: string | null; recordedBy: { userId: string } } }[];
    expect(taken.map((item) => [item.student.id, item.record.status, item.record.minutesLate, item.record.note, item.record.recordedBy.userId])).toEqual([
      [fx['student1'], 'present', null, null, fx['teacher']],
      [fx['student2'], 'late', 10, 'وصل بعد البداية', fx['teacher']],
    ]);
    // The same batch again: 200, nothing written (one attendance.recorded in the log below).
    expect((await api().put(`${LESSONS}/${lesson1}/attendance`).set(bearer('teacher')).send({ records }).expect(200)).body.attendanceTakenAt).toBe(recorded.body.attendanceTakenAt);

    // 4. Student1: both lessons in time order — the first with their own attendance, the second as cancelled without its reason; the teacher by name only.
    const mine1 = await myLessons('student1').expect(200);
    expect(mine1.body.nextCursor).toBeNull();
    const [first, second] = mine1.body.items as MyLessonItem[];
    expect(mine1.body.items).toHaveLength(2);
    expect(first).toMatchObject({
      id: lesson1,
      status: 'scheduled',
      startsAt: l1Start,
      endsAt: l1End,
      relation: 'self',
      student: { id: fx['student1'], fullName: 'Test student1' },
      teacher: { fullName: 'Test teacher', displayName: null },
      syllabusItem: { id: items[0], sortOrder: 1 },
      class: { id: classId, code: `${PREFIX}-A`, status: 'open', course: { id: courseId, code: `${PREFIX}-CRS` } },
      attendance: { status: 'present', minutesLate: null },
    });
    expect(typeof first!.attendance?.recordedAt).toBe('string');
    expect(second).toMatchObject({ id: lesson2, status: 'cancelled', relation: 'self', student: { id: fx['student1'] }, attendance: null });
    for (const item of [first!, second!]) {
      for (const key of ['cancellationReason', 'attendanceTakenAt', 'scheduleId']) expect(item).not.toHaveProperty(key);
      expect(item.teacher).not.toHaveProperty('userId');
    }
    for (const key of ['note', 'recordedBy', 'recordedById']) expect(first!.attendance).not.toHaveProperty(key);
    // Student2: the same lessons with their own late record; the status filter narrows to the cancelled one.
    const mine2 = await myLessons('student2', { classId }).expect(200);
    expect((mine2.body.items as MyLessonItem[]).map((item) => [item.id, item.student.id, item.attendance])).toEqual([
      [lesson1, fx['student2'], { status: 'late', minutesLate: 10, recordedAt: expect.any(String) }],
      [lesson2, fx['student2'], null],
    ]);
    expect((await myLessons('student2', { status: 'cancelled' }).expect(200)).body.items.map((item: MyLessonItem) => item.id)).toEqual([lesson2]);

    // 5. The guardian of student1: the same two lessons for the child with the child's attendance — and nothing of student2.
    const child = await myLessons('guardian').expect(200);
    expect((child.body.items as MyLessonItem[]).map((item) => [item.id, item.relation, item.student.id, item.attendance?.status ?? null])).toEqual([
      [lesson1, 'child', fx['student1'], 'present'],
      [lesson2, 'child', fx['student1'], null],
    ]);
    expect((await myLessons('guardian', { studentId: fx['student2']! }).expect(200)).body.items).toEqual([]);

    // 6. Learners read only their own: the seeded lessons.read of a student opens an empty list and no lesson; the guardian's attendance.read reaches no sheet.
    expect((await api().get(LESSONS).query({ classId }).set(bearer('student1')).expect(200)).body.items).toEqual([]);
    expect((await api().get(`${LESSONS}/${lesson1}`).set(bearer('student1')).expect(404)).body.code).toBe('lesson_not_found');
    await api().get(LESSONS).set(bearer('guardian')).expect(403);
    expect((await api().get(`${LESSONS}/${lesson1}/attendance`).set(bearer('guardian')).expect(404)).body.code).toBe('lesson_not_found');
    await api().put(`${LESSONS}/${lesson1}/attendance`).set(bearer('student1')).send({ records: [{ studentId: fx['student1'], status: 'present' }] }).expect(403);

    // 7. The manager (classes.manage + lessons.read) sees both lessons with the counts and the cancellation reason; "my lessons" is empty for the teacher (API-093 is theirs).
    const all = await api().get(LESSONS).query({ classId }).set(bearer('manager')).expect(200);
    const listed = all.body.items as { id: string; status: string; attendance: { recorded: number }; cancellationReason: string | null }[];
    expect(listed.map((item) => [item.id, item.status, item.attendance.recorded, item.cancellationReason])).toEqual([
      [lesson1, 'scheduled', 2, null],
      [lesson2, 'cancelled', 0, 'المعلم في مهمة'],
    ]);
    expect((await myLessons('teacher').expect(200)).body.items).toEqual([]);

    // 8. The audit log: the teacher's events newest first — one attendance.recorded despite the repeated batch, nothing for the refused requests — and the preparation by the manager.
    expect(nonAuth(await api().get(AUDIT).query({ actorUserId: fx['teacher'], limit: 50 }).set(bearer('manager')).expect(200))).toEqual([
      ['attendance.recorded', 'lessons', lesson1],
      ['lessons.status.changed', 'lessons', lesson2],
      ['lessons.created', 'classes', classId],
      ['lessons.created', 'classes', classId],
    ]);
    expect(nonAuth(await api().get(AUDIT).query({ actorUserId: fx['manager'], limit: 50 }).set(bearer('manager')).expect(200)).map(([action]) => action)).toEqual([
      'enrollments.created',
      'enrollments.created',
      'classes.status.changed',
      'classes.teachers.changed',
      'classes.created',
    ]);
    await api().get(AUDIT).set(bearer('teacher')).expect(403);
  });
});
