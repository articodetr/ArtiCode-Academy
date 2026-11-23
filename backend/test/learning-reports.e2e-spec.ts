// TEST-248 (part 1) — MOD-20 «My School» (roadmap §4q, D-R137): the learning
// progress of a class (API-235, GET /api/classes/:id/learning-progress)
// against the live development database. Skipped when no database is
// reachable. The suite builds its own course, lessons, classes, enrollments
// and `learning_progress` rows through Prisma (unique code prefix) and deletes
// exactly what it created; the teachers and students hold the seeded roles,
// the office custom roles. Audit events are counted by fixture actor above an
// id watermark, so other clients of the shared database never pollute them.
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
const PREFIX = `LP${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-248 learning-progress supertest';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const STUDENT_KEYS = ['avatarUrl', 'deletedAt', 'displayName', 'email', 'fullName', 'fullNameLatin', 'id', 'phone', 'status', 'username'];

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

interface StudentRow {
  enrollmentId: string;
  enrollmentStatus: string;
  student: Record<string, unknown> & { id: string; email: string | null };
  progress: { total: number; required: number; completed: number; completedRequired: number; percent: number | null; isComplete: boolean; completedAt: string | null };
  lastActivityAt: string | null;
  lastLesson: { id: string; title: { ar: string } } | null;
}

describe.skipIf(!available)('MOD-20 class learning progress (e2e, TEST-248 part 1)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let markId: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const enrollmentIds: Record<string, string> = {};
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
  const times: Record<string, Date> = {};

  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const read = (as: string, classId: string) => api().get(`/api/classes/${classId}/learning-progress`).set(bearer(as));
  const roleId = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;

  async function customRole(name: string, permissions: string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_lp${name}_${RUN.toLowerCase()}`, label: { ar: `دور ${name}` }, permissions: { create: permissions.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(key: string, roleIds: string[], login = true): Promise<void> {
    const user = await prisma.user.create({
      data: { email: email(key), fullName: `Test ${key} ${RUN}`, passwordHash: await passwords.hash(PASSWORD), status: 'active', roles: { create: roleIds.map((id) => ({ roleId: id })) } },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[key] = user.id;
    if (login) tokens[key] = (await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(key), password: PASSWORD }).expect(200)).body.accessToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    markId = (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;

    const teacher = await roleId('teacher');
    const student = await roleId('student');
    await createUser('t1', [teacher]);
    await createUser('t2', [teacher]);
    await createUser('registrar', [await customRole('registrar', ['enrollments.read', 'enrollments.manage', 'users.read_contact'])]);
    await createUser('manager', [await customRole('manager', ['enrollments.manage'])]);
    // A student who also holds enrollments.read: passes the guard, still never reads the class.
    await createUser('s1', [student, await customRole('curious', ['enrollments.read'])]);
    await createUser('s2', [student], false);
    await createUser('s3', [student], false);
    await createUser('s4', [student], false);
    await createUser('s5', [student]);

    // One course: two required lessons, one optional, one required but unpublished (outside every count).
    const course = await prisma.course.create({ data: { code: `${PREFIX}-C`, name: { ar: `دورة ${RUN}`, en: `Course ${RUN}` }, status: 'published' }, select: { id: true } });
    ids['course'] = course.id;
    const section = await prisma.courseSection.create({ data: { courseId: course.id, sortOrder: 0, title: { ar: 'المستوى التمهيدي' } }, select: { id: true } });
    const lesson = (sortOrder: number, key: string, extra: { isRequired?: boolean; isPublished?: boolean; sectionId?: string | null }) =>
      prisma.courseSyllabusItem.create({
        data: { courseId: course.id, sortOrder, title: { ar: `درس ${key}`, en: `Lesson ${key}` }, sectionId: extra.sectionId ?? null, isRequired: extra.isRequired ?? true, isPublished: extra.isPublished ?? true },
        select: { id: true },
      });
    ids['l1'] = (await lesson(0, 'L1', { sectionId: section.id })).id;
    ids['l2'] = (await lesson(1, 'L2', { sectionId: section.id })).id;
    ids['l3'] = (await lesson(2, 'L3', { isRequired: false })).id;
    ids['l4'] = (await lesson(3, 'L4', { isPublished: false })).id;

    const klass = (code: string, status: 'open' | 'running') =>
      prisma.class.create({ data: { courseId: course.id, code: `${PREFIX}-${code}`, name: { ar: `فصل ${code}` }, capacity: 10, status }, select: { id: true } });
    ids['classA'] = (await klass('A', 'running')).id;
    ids['classB'] = (await klass('B', 'open')).id;
    await prisma.classTeacher.create({ data: { classId: ids['classA']!, teacherUserId: fx['t1']!, role: 'lead' }, select: { classId: true } });
    await prisma.classTeacher.create({ data: { classId: ids['classB']!, teacherUserId: fx['t2']!, role: 'lead' }, select: { classId: true } });

    // Enrollment order = creation order (UUIDv7): s1, s2, s3, s4, s5 in class A; s1 again in class B.
    const enroll = async (key: string, classId: string, status: 'active' | 'completed' | 'pending' | 'withdrawn') => {
      const row = await prisma.enrollment.create({
        data: {
          classId,
          studentUserId: fx[key]!,
          status,
          activatedAt: status === 'pending' ? null : at(600),
          completedAt: status === 'completed' ? at(60) : null,
          withdrawnAt: status === 'withdrawn' ? at(60) : null,
          requestedAt: status === 'pending' ? at(30) : null,
        },
        select: { id: true },
      });
      return row.id;
    };
    enrollmentIds['s1'] = await enroll('s1', ids['classA']!, 'active');
    enrollmentIds['s2'] = await enroll('s2', ids['classA']!, 'completed');
    enrollmentIds['s3'] = await enroll('s3', ids['classA']!, 'pending');
    enrollmentIds['s4'] = await enroll('s4', ids['classA']!, 'withdrawn');
    enrollmentIds['s5'] = await enroll('s5', ids['classA']!, 'active');
    enrollmentIds['s1B'] = await enroll('s1', ids['classB']!, 'active');

    // The learners' own rows (what «My School» reads).
    const progress = (key: string, item: string, state: { completedAt?: Date; firstOpenedAt: Date; lastOpenedAt: Date }) =>
      prisma.learningProgress.create({
        data: {
          studentUserId: fx[key]!,
          syllabusItemId: ids[item]!,
          courseId: course.id,
          status: state.completedAt ? 'completed' : 'in_progress',
          completionSource: state.completedAt ? 'manual' : null,
          completedAt: state.completedAt ?? null,
          firstOpenedAt: state.firstOpenedAt,
          lastOpenedAt: state.lastOpenedAt,
        },
        select: { syllabusItemId: true },
      });
    times['s1l1Done'] = at(170);
    times['s1l2Opened'] = at(30);
    await progress('s1', 'l1', { firstOpenedAt: at(180), lastOpenedAt: at(180), completedAt: times['s1l1Done'] });
    await progress('s1', 'l2', { firstOpenedAt: at(60), lastOpenedAt: times['s1l2Opened'] });
    times['s2l2Done'] = at(240);
    times['s2l4Opened'] = at(10);
    await progress('s2', 'l1', { firstOpenedAt: at(320), lastOpenedAt: at(320), completedAt: at(300) });
    await progress('s2', 'l2', { firstOpenedAt: at(260), lastOpenedAt: at(260), completedAt: times['s2l2Done'] });
    await progress('s2', 'l3', { firstOpenedAt: at(220), lastOpenedAt: at(220), completedAt: at(210) });
    // The unpublished lesson opened last: activity, but neither progress nor «last lesson».
    await progress('s2', 'l4', { firstOpenedAt: at(15), lastOpenedAt: times['s2l4Opened'] });
    await progress('s4', 'l1', { firstOpenedAt: at(100), lastOpenedAt: at(100), completedAt: at(95) });
  }, 120_000);

  afterAll(async () => {
    try {
      if (prisma && createdUserIds.length > 0) {
        await prisma.certificate.deleteMany({ where: { studentUserId: { in: createdUserIds } } });
        await prisma.learningProgress.deleteMany({ where: { studentUserId: { in: createdUserIds } } });
        await prisma.enrollment.deleteMany({ where: { studentUserId: { in: createdUserIds } } });
        await prisma.classTeacher.deleteMany({ where: { class: { code: { startsWith: PREFIX } } } });
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
      }
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('AC1 — a teacher of the class reads the active and completed enrollments in enrollment order, with the same numbers the learners’ own rows give', async () => {
    const res = await read('t1', ids['classA']!).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['classId', 'course', 'students', 'totals']);
    expect(res.body.classId).toBe(ids['classA']);
    expect(res.body.course).toEqual({ id: ids['course'], code: `${PREFIX}-C`, name: { ar: `دورة ${RUN}`, en: `Course ${RUN}` } });
    // Published lessons only: L1, L2 (required) and L3 (optional); the unpublished L4 counts nowhere.
    expect(res.body.totals).toEqual({ lessons: 3, required: 2 });

    const students = res.body.students as StudentRow[];
    // Pending (s3) and withdrawn (s4) are not listed.
    expect(students.map((row) => row.enrollmentId)).toEqual([enrollmentIds['s1'], enrollmentIds['s2'], enrollmentIds['s5']]);
    expect(students.map((row) => row.enrollmentStatus)).toEqual(['active', 'completed', 'active']);
    for (const row of students) {
      expect(Object.keys(row).sort()).toEqual(['enrollmentId', 'enrollmentStatus', 'lastActivityAt', 'lastLesson', 'progress', 'student']);
      expect(Object.keys(row.student).sort()).toEqual(STUDENT_KEYS);
    }
    const [s1, s2, s5] = students;

    // One completed required lesson of two → 50.
    expect(s1!.student.id).toBe(fx['s1']);
    expect(s1!.progress).toEqual({ total: 3, required: 2, completed: 1, completedRequired: 1, percent: 50, isComplete: false, completedAt: null });
    expect(s1!.lastActivityAt).toBe(times['s1l2Opened']!.toISOString());
    expect(s1!.lastLesson).toEqual({ id: ids['l2'], title: { ar: 'درس L2', en: 'Lesson L2' } });

    // Everything required (and the optional one) done; complete at the last required completion.
    expect(s2!.progress).toEqual({ total: 3, required: 2, completed: 3, completedRequired: 2, percent: 100, isComplete: true, completedAt: times['s2l2Done']!.toISOString() });
    expect(s2!.lastActivityAt).toBe(times['s2l4Opened']!.toISOString());
    expect(s2!.lastLesson).toBeNull();

    // Nothing opened yet.
    expect(s5!.progress).toEqual({ total: 3, required: 2, completed: 0, completedRequired: 0, percent: 0, isComplete: false, completedAt: null });
    expect(s5!.lastActivityAt).toBeNull();
    expect(s5!.lastLesson).toBeNull();

    // The teacher's projection (D-R07): no contact fields without users.read_contact.
    for (const row of students) {
      expect(row.student.email).toBeNull();
      expect(row.student.phone).toBeNull();
      expect(row.student.username).toBeNull();
    }
    expect(JSON.stringify(res.body)).not.toMatch(/hash|password/i);
  });

  it('AC2 — a holder of enrollments.manage reads any class, in their own projection; the progress follows the student across the classes of the course', async () => {
    const asOffice = await read('registrar', ids['classA']!).expect(200);
    const rows = asOffice.body.students as StudentRow[];
    expect(rows.map((row) => row.student.email)).toEqual([email('s1'), email('s2'), email('s5')]);
    const asTeacher = await read('t1', ids['classA']!).expect(200);
    // The numbers do not depend on the reader.
    expect(rows.map((row) => [row.progress, row.lastActivityAt, row.lastLesson])).toEqual(
      (asTeacher.body.students as StudentRow[]).map((row) => [row.progress, row.lastActivityAt, row.lastLesson]),
    );

    // The teacher of class B sees s1 there with the same course progress (D-R133).
    const other = await read('t2', ids['classB']!).expect(200);
    expect((other.body.students as StudentRow[]).map((row) => row.enrollmentId)).toEqual([enrollmentIds['s1B']]);
    expect((other.body.students as StudentRow[])[0]!.progress).toEqual(rows[0]!.progress);
    expect((other.body.students as StudentRow[])[0]!.lastLesson).toEqual(rows[0]!.lastLesson);
  });

  it('AC3 — a teacher of another class, a student holding enrollments.read and an unknown class are 404 class_not_found; without enrollments.read 403', async () => {
    for (const as of ['t2', 's1']) {
      const res = await read(as, ids['classA']!);
      expect(res.status, as).toBe(404);
      expect(res.body).toMatchObject({ statusCode: 404, code: 'class_not_found' });
    }
    expect((await read('registrar', '0192f0b0-0000-7000-8000-0000000000ff').expect(404)).body.code).toBe('class_not_found');
    await read('registrar', 'not-a-uuid').expect(400);

    for (const as of ['manager', 's5']) {
      const res = await read(as, ids['classA']!);
      expect(res.status, as).toBe(403);
      expect(res.body).toMatchObject({ code: 'permission_denied', missing: ['enrollments.read'] });
    }
    await api().get(`/api/classes/${ids['classA']}/learning-progress`).set('User-Agent', USER_AGENT).expect(401);
  });

  it('AC4 — reading records no audit event', async () => {
    await read('registrar', ids['classA']!).expect(200);
    const actors = createdUserIds;
    const events = await prisma.auditLog.findMany({
      where: { id: { gt: markId }, actorUserId: { in: actors }, NOT: { action: { startsWith: 'auth.' } } },
      select: { action: true },
    });
    expect(events).toEqual([]);
  });

  it(
    'documents the route in OpenAPI with the bearer scheme',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      const path = docs.body.paths['/api/classes/{id}/learning-progress'];
      expect(Object.keys(path)).toEqual(['get']);
      expect(path.get.security).toEqual([{ bearer: [] }]);
      for (const status of ['200', '401', '403', '404']) expect(path.get.responses).toHaveProperty(status);
      expect(docs.body.components.schemas).toHaveProperty('ClassLearningProgressDto');
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
