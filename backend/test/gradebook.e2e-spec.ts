// TEST-131 — MOD-09-T05 gradebook and final grades (API-126..API-128) against
// the live development database. Skipped when no database is reachable.
// Fixture users (a manager with a custom role, teachers with the system
// `teacher` role, a reader with `grades.read_all` alone, a class manager
// without any grades key, students), roles, a published course, classes,
// enrollments, assignments with submissions and reviews, exams with results
// (all through the API) and a non-default grade scheme (through Prisma, so the
// academy's default is never touched) carry a unique prefix and are deleted
// at the end. Audit events are counted by fixture actor above an id watermark.
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
import type { EnrollmentStatus } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `G${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-131 supertest';
const CLASSES = '/api/classes';
const ASSIGNMENTS = '/api/assignments';
const EXAMS = '/api/exams';
const NIL_ID = '00000000-0000-0000-0000-000000000000';

interface GradebookBody {
  components: { kind: string; id: string; weight: number | null; counted: boolean }[];
  students: {
    enrollmentStatus: string;
    student: { id: string };
    cells: { id: string; status: string; score: number | null; effectiveScore: number | null; late: boolean }[];
    current: number | null;
    projected: number | null;
    final: { percent: number; label: { ar: string }; letter: string | null; isPass: boolean; stale: boolean; schemeId: string } | null;
  }[];
  readiness: { openAssignments: number; awaitingReview: number; unpublishedExams: number; weightedComponents: number; ready: boolean };
  defaultScheme: { id: string } | null;
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

describe.skipIf(!available)('MOD-09 gradebook and final grades (e2e, TEST-131)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let courseId: string;
  let schemeId: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const classes: Record<string, string> = {};
  const items: Record<string, string> = {};
  const actors: string[] = [];

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name.toLowerCase()}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  const gradebook = (suffix: string, as = 'teacher') => api().get(`${CLASSES}/${classes[suffix] ?? suffix}/gradebook`).set(bearer(as));
  const finalize = (suffix: string, body: object = {}, as = 'teacher') => api().post(`${CLASSES}/${classes[suffix] ?? suffix}/final-grades`).set(bearer(as)).send(body);
  const withdraw = (suffix: string, as = 'teacher') => api().delete(`${CLASSES}/${classes[suffix] ?? suffix}/final-grades`).set(bearer(as));
  const studentOf = (body: GradebookBody, name: string) => body.students.find((entry) => entry.student.id === id(name))!;

  async function createRole(name: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_${name}_${RUN.toLowerCase()}`, label: { ar: `دور اختبار ${name}` }, permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(name: string, roleIds: string[]): Promise<void> {
    const user = await prisma.user.create({
      data: { email: email(name), fullName: `Test ${name}`, passwordHash: await passwords.hash(PASSWORD), status: 'active', roles: { create: roleIds.map((roleId) => ({ roleId })) } },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(name), password: PASSWORD }).expect(200);
    tokens[name] = res.body.accessToken as string;
    actors.push(user.id);
  }

  async function mark(): Promise<string> {
    const latest = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return latest?.id ?? NIL_ID;
  }
  const eventsSince = (markId: string) => prisma.auditLog.findMany({ where: { id: { gt: markId }, actorUserId: { in: actors } }, orderBy: { id: 'asc' } });

  async function classAction(suffix: string, action: string): Promise<void> {
    await api().post(`${CLASSES}/${classes[suffix]}/status`).set(bearer('manager')).send({ action }).expect(200);
  }

  async function createClass(suffix: string, teacher: string): Promise<void> {
    const res = await api().post(CLASSES).set(bearer('manager')).send({ courseId, code: code(suffix), name: { ar: `فصل ${suffix}` }, capacity: 10 }).expect(201);
    classes[suffix] = res.body.id as string;
    await api().put(`${CLASSES}/${classes[suffix]}/teachers`).set(bearer('manager')).send({ teachers: [{ userId: id(teacher), role: 'lead' }] }).expect(200);
    await classAction(suffix, 'open');
  }

  async function enroll(suffix: string, student: string, status: EnrollmentStatus = 'active'): Promise<void> {
    await prisma.enrollment.create({ data: { classId: classes[suffix]!, studentUserId: id(student), status, activatedAt: new Date() }, select: { id: true } });
  }

  async function submit(assignment: string, student: string): Promise<string> {
    return (await api().post(`${ASSIGNMENTS}/${items[assignment]}/submissions`).set(bearer(student)).send({ textAnswer: `حل ${student}` }).expect(201)).body.id as string;
  }

  async function review(submissionId: string, body: object): Promise<void> {
    await api().post(`/api/submissions/${submissionId}/review`).set(bearer('teacher')).send(body).expect(200);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    courseId = (await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة الدرجات' }, status: 'published' }, select: { id: true } })).id;
    schemeId = (
      await prisma.gradeScheme.create({
        data: {
          name: { ar: `${PREFIX} سلّم` },
          bands: {
            create: [
              { minPercent: 0, label: { ar: 'راسب' }, letter: 'F', isPass: false },
              { minPercent: 50, label: { ar: 'ناجح' }, letter: 'P', isPass: true },
              { minPercent: 85, label: { ar: 'ممتاز' }, letter: 'A', isPass: true },
            ],
          },
        },
        select: { id: true },
      })
    ).id;
    const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
    const teacherRole = await systemRole('teacher');
    const studentRole = await systemRole('student');
    await createUser('manager', [
      await createRole('gmanager', ['classes.read', 'classes.manage', 'classes.teachers.assign', 'assignments.read', 'assignments.manage', 'assignments.grade', 'exams.read', 'exams.manage', 'exams.grade', 'grades.read_all', 'grades.manage']),
    ]);
    await createUser('teacher', [teacherRole]);
    await createUser('teacher2', [teacherRole]);
    await createUser('reader', [await createRole('greader', ['classes.read', 'classes.manage', 'grades.read_all'])]);
    await createUser('nogrades', [await createRole('gnogrades', ['classes.read', 'classes.manage'])]);
    for (const student of ['s1', 's2', 's3']) await createUser(student, [studentRole]);

    await createClass('A', 'teacher');
    await createClass('B', 'teacher');
    await enroll('A', 's1');
    await enroll('A', 's2');
    await enroll('A', 's3', 'withdrawn');
    // H1: weighted 30, max 20, late work taken with a 10 % penalty — due in the past, so every attempt is late.
    const h1 = await api()
      .post(`${CLASSES}/${classes['A']}/assignments`)
      .set(bearer('teacher'))
      .send({ title: { ar: 'واجب موزون' }, maxScore: 20, weight: 30, dueAt: '2020-01-01T00:00:00Z', allowLate: true, latePenaltyPercent: 10 })
      .expect(201);
    items['H1'] = h1.body.id as string;
    await api().post(`${ASSIGNMENTS}/${items['H1']}/status`).set(bearer('teacher')).send({ action: 'publish' }).expect(200);
    // H2: informational (no weight), stays open.
    items['H2'] = (await api().post(`${CLASSES}/${classes['A']}/assignments`).set(bearer('teacher')).send({ title: { ar: 'واجب للتدريب' }, maxScore: 10 }).expect(201)).body.id as string;
    await api().post(`${ASSIGNMENTS}/${items['H2']}/status`).set(bearer('teacher')).send({ action: 'publish' }).expect(200);
    // E1: weighted 70, max 50, scheduled with results, not published yet.
    items['E1'] = (await api().post(`${CLASSES}/${classes['A']}/exams`).set(bearer('teacher')).send({ title: { ar: 'الاختبار النهائي' }, type: 'final', maxScore: 50, weight: 70 }).expect(201)).body.id as string;
    await api().post(`${EXAMS}/${items['E1']}/status`).set(bearer('teacher')).send({ action: 'schedule' }).expect(200);
    await api()
      .put(`${EXAMS}/${items['E1']}/results`)
      .set(bearer('teacher'))
      .send({ results: [{ studentId: id('s1'), status: 'scored', score: 40 }, { studentId: id('s2'), status: 'excused' }] })
      .expect(200);
    fx['sub1'] = await submit('H1', 's1');
    await review(fx['sub1'], { action: 'grade', score: 18 });
    fx['sub2'] = await submit('H1', 's2'); // waits for review
    // Class B: one published exam without a weight.
    await enroll('B', 's1');
    items['EB'] = (await api().post(`${CLASSES}/${classes['B']}/exams`).set(bearer('teacher')).send({ title: { ar: 'تدريب' }, type: 'practice', maxScore: 10 }).expect(201)).body.id as string;
    await api().post(`${EXAMS}/${items['EB']}/status`).set(bearer('teacher')).send({ action: 'schedule' }).expect(200);
    await api().post(`${EXAMS}/${items['EB']}/status`).set(bearer('teacher')).send({ action: 'publish' }).expect(200);
    await classAction('B', 'start');
  }, 90_000);

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.finalGrade.deleteMany({ where: { enrollment: { classId: { in: Object.values(classes) } } } });
        await prisma.enrollment.deleteMany({ where: { classId: { in: Object.values(classes) } } });
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
        if (schemeId) await prisma.gradeScheme.deleteMany({ where: { id: schemeId } });
      }
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('AC1 — the gradebook is computed on read: cells with the late penalty and the excused exam, current and projected averages, readiness; class visibility and grades.read_all', async () => {
    const res = await gradebook('A');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as GradebookBody;
    expect(body.components.map((component) => [component.id, component.counted])).toEqual([
      [items['H1'], true],
      [items['H2'], false],
      [items['E1'], true],
    ]);
    expect(body.students.map((entry) => entry.student.id)).toEqual([id('s1'), id('s2')]); // not the withdrawn s3
    const s1 = studentOf(body, 's1');
    expect(s1.cells[0]).toMatchObject({ status: 'graded', score: 18, effectiveScore: 16.2, late: true });
    expect(s1.cells[2]).toMatchObject({ status: 'scored', score: 40, effectiveScore: 40 });
    expect(s1).toMatchObject({ current: 80.3, projected: 80.3, final: null });
    const s2 = studentOf(body, 's2');
    expect(s2.cells[0]).toMatchObject({ status: 'awaiting_review', score: null });
    expect(s2.cells[2]).toMatchObject({ status: 'excused' });
    expect(s2).toMatchObject({ current: null, projected: 0 }); // H1 missing (0 in the projection), E1 excused
    expect(body.readiness).toEqual({ openAssignments: 1, awaitingReview: 1, unpublishedExams: 1, weightedComponents: 2, ready: false });
    expect(body.defaultScheme).not.toBeNull();

    expect((await gradebook('A', 'reader')).status).toBe(200);
    expect((await gradebook('A', 'teacher2')).body).toMatchObject({ code: 'class_not_found' });
    expect((await gradebook('A', 'nogrades')).status).toBe(403);
    expect((await gradebook('A', 's1')).status).toBe(403);
    expect((await gradebook(NIL_ID)).body).toMatchObject({ code: 'class_not_found' });
  });

  it('AC2 — finalization is refused for an open class, while grades are pending, without a weighted component, with an unknown scheme and without grades.manage — no event', async () => {
    const m = await mark();
    expect((await finalize('A', { schemeId })).body).toMatchObject({ code: 'class_not_gradable', status: 'open' });
    await classAction('A', 'start');
    const pending = await finalize('A', { schemeId });
    expect(pending.status).toBe(409);
    expect(pending.body).toMatchObject({ code: 'grades_not_ready', openAssignments: 1, awaitingReview: 1, unpublishedExams: 1 });
    expect((await finalize('B', { schemeId })).body).toMatchObject({ code: 'grades_not_ready', reason: 'no_weighted_components' });
    expect((await finalize('A', { schemeId: NIL_ID })).body).toMatchObject({ code: 'grade_scheme_not_found' });
    expect((await finalize('A', { schemeId: 'x' })).status).toBe(400);
    expect((await finalize('A', { schemeId }, 'reader')).status).toBe(403);
    expect((await finalize('A', { schemeId }, 'teacher2')).body).toMatchObject({ code: 'class_not_found' });
    // Only the class `start` above is recorded — no grades event.
    expect((await eventsSince(m)).map((event) => event.action)).toEqual(['classes.status.changed']);
  });

  it('AC3 — once nothing is pending, every active student gets a final grade with the band and the breakdown; a repeated run writes nothing', async () => {
    await api().post(`${ASSIGNMENTS}/${items['H1']}/status`).set(bearer('teacher')).send({ action: 'close' }).expect(200);
    await review(fx['sub2']!, { action: 'grade', score: 15 });
    await api().post(`${EXAMS}/${items['E1']}/status`).set(bearer('teacher')).send({ action: 'publish' }).expect(200);
    const m = await mark();
    const res = await finalize('A', { schemeId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as GradebookBody;
    expect(body.readiness.ready).toBe(true);
    // s1: 30 × 16.2/20 + 70 × 40/50 = 80.3 → ناجح; s2: (30 × 13.5/20) ÷ 30 = 67.5 (the exam excused) → ناجح
    expect(studentOf(body, 's1').final).toMatchObject({ percent: 80.3, label: { ar: 'ناجح' }, letter: 'P', isPass: true, stale: false, schemeId });
    expect(studentOf(body, 's2').final).toMatchObject({ percent: 67.5, letter: 'P', isPass: true, stale: false });
    const stored = await prisma.finalGrade.findFirstOrThrow({ where: { enrollment: { classId: classes['A']!, studentUserId: id('s1') } } });
    expect(stored.breakdown).toEqual([
      { kind: 'assignment', id: items['H1'], title: { ar: 'واجب موزون' }, weight: 30, maxScore: 20, status: 'graded', score: 18, effectiveScore: 16.2, late: true },
      { kind: 'exam', id: items['E1'], title: { ar: 'الاختبار النهائي' }, weight: 70, maxScore: 50, status: 'scored', score: 40, effectiveScore: 40, late: false },
    ]);
    await finalize('A', { schemeId }).expect(200); // identical
    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.entityType, event.entityId, event.actorUserId])).toEqual([['grades.finalized', 'classes', classes['A'], id('teacher')]]);
    expect(events[0]!.metadata).toEqual({ code: code('A'), schemeId, created: 2, updated: 0 });
  });

  it('AC4 — a later grade marks the final grade stale; finalizing again updates only what differs', async () => {
    await review(fx['sub1']!, { action: 'grade', score: 20 });
    const stale = (await gradebook('A').expect(200)).body as GradebookBody;
    expect(studentOf(stale, 's1')).toMatchObject({ projected: 83, final: { percent: 80.3, stale: true } }); // 30 × 18/20 + 56 = 83
    expect(studentOf(stale, 's2').final).toMatchObject({ stale: false });
    const m = await mark();
    const res = await finalize('A', { schemeId });
    expect(studentOf(res.body as GradebookBody, 's1').final).toMatchObject({ percent: 83, stale: false });
    expect((await eventsSince(m)).map((event) => event.metadata)).toEqual([{ code: code('A'), schemeId, created: 0, updated: 1 }]);
    // A completed class keeps its grades open: finalizing after the class completes still works.
    await classAction('A', 'complete');
    await finalize('A', { schemeId }).expect(200);
  });

  it('AC5 — withdrawing deletes the class’s final grades with one event; nothing to withdraw writes nothing', async () => {
    const m = await mark();
    expect((await withdraw('A', 'reader')).status).toBe(403);
    const res = await withdraw('A');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body as GradebookBody).students.every((entry) => entry.final === null)).toBe(true);
    await withdraw('A').expect(200);
    expect((await eventsSince(m)).map((event) => [event.action, event.metadata])).toEqual([['grades.withdrawn', { code: code('A'), count: 2 }]]);
    expect(await prisma.finalGrade.count({ where: { enrollment: { classId: classes['A']! } } })).toBe(0);
  });

  it(
    'documents the routes in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths['/api/classes/{id}/gradebook'])).toEqual(['get']);
      expect(Object.keys(docs.body.paths['/api/classes/{id}/final-grades']).sort()).toEqual(['delete', 'post']);
      for (const schema of ['GradebookDto', 'GradebookStudentDto', 'GradebookCellDto', 'GradebookComponentDto', 'FinalGradeDto', 'GradebookReadinessDto', 'FinalizeGradesDto']) {
        expect(docs.body.components.schemas).toHaveProperty(schema);
      }
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
