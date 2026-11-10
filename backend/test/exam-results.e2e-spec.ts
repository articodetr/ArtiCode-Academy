// TEST-130 — MOD-09-T04 results sheet (API-119/API-120) against the live
// development database. Skipped when no database is reachable. Fixture users
// (a manager with a custom role, teachers with the system `teacher` role, a
// reader whose custom role holds `classes.manage` + `exams.read` without
// `exams.grade`, students, an outsider), roles, a published course, classes,
// enrollments and exams carry a unique prefix and are deleted at the end — the
// classes cascade to their exams and results. Audit events are counted by
// fixture actor above an id watermark.
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
const PREFIX = `R${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-130 supertest';
const CLASSES = '/api/classes';
const EXAMS = '/api/exams';
const NIL_ID = '00000000-0000-0000-0000-000000000000';

interface SheetItem {
  student: { id: string; email: string | null };
  enrollmentStatus: string | null;
  result: { status: string; score: number | null; feedback: string | null; recordedBy: { userId: string } | null } | null;
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

describe.skipIf(!available)('MOD-09 exam results sheet (e2e, TEST-130)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let courseId: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const classes: Record<string, string> = {};
  const exams: Record<string, string> = {};
  const actors: string[] = [];

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name.toLowerCase()}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  const sheet = (exam: string, as = 'teacher') => api().get(`${EXAMS}/${exams[exam] ?? exam}/results`).set(bearer(as));
  const record = (exam: string, results: object[], as = 'teacher') => api().put(`${EXAMS}/${exams[exam] ?? exam}/results`).set(bearer(as)).send({ results });
  const item = (items: SheetItem[], student: string) => items.find((entry) => entry.student.id === id(student));

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

  async function createExam(name: string, suffix: string, actions: string[] = ['schedule'], teacher = 'teacher'): Promise<void> {
    const res = await api().post(`${CLASSES}/${classes[suffix]}/exams`).set(bearer(teacher)).send({ title: { ar: `اختبار ${name}` }, type: 'quiz', maxScore: 20, weight: 20 }).expect(201);
    exams[name] = res.body.id as string;
    for (const action of actions) await api().post(`${EXAMS}/${exams[name]}/status`).set(bearer(teacher)).send({ action }).expect(200);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    courseId = (await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة النتائج' }, status: 'published' }, select: { id: true } })).id;
    const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
    const teacherRole = await systemRole('teacher');
    const studentRole = await systemRole('student');
    await createUser('manager', [await createRole('rmanager', ['classes.read', 'classes.manage', 'classes.teachers.assign', 'exams.read', 'exams.manage', 'exams.grade'])]);
    await createUser('teacher', [teacherRole]);
    await createUser('teacher2', [teacherRole]);
    await createUser('reader', [await createRole('rreader', ['classes.read', 'classes.manage', 'exams.read'])]);
    await createUser('outsider', [await createRole('routsider', ['courses.read'])]);
    for (const student of ['s1', 's2', 's3', 's4']) await createUser(student, [studentRole]);

    await createClass('A', 'teacher');
    await createClass('B', 'teacher2');
    await createClass('C', 'teacher');
    await createClass('F', 'teacher');
    await enroll('A', 's1');
    await enroll('A', 's2');
    await enroll('A', 's3', 'withdrawn');
    await enroll('B', 's4');
    await enroll('C', 's1');
    await enroll('F', 's1');
    await createExam('S', 'A');
    await createExam('D', 'A', []); // draft
    await createExam('X', 'C');
    await createExam('FIN', 'F');
    await classAction('C', 'cancel');
    await classAction('F', 'start');
    await classAction('F', 'complete');
  }, 60_000);

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.enrollment.deleteMany({ where: { classId: { in: Object.values(classes) } } });
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

  it('AC1 — the sheet lists the active and completed students (and anyone holding a result) in the caller’s projection, with recordable/closedReason; others 404, no key 403', async () => {
    const res = await sheet('S');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ examId: exams['S'], classId: classes['A'], examStatus: 'scheduled', maxScore: 20, recordable: true, closedReason: null, counts: { students: 0, scored: 0, absent: 0, excused: 0 } });
    const items = res.body.items as SheetItem[];
    expect(items.map((entry) => entry.student.id)).toEqual([id('s1'), id('s2')]); // the withdrawn s3 holds nothing
    expect(items.every((entry) => entry.result === null && entry.enrollmentStatus === 'active' && entry.student.email === null)).toBe(true);
    expect((await sheet('D')).body).toMatchObject({ examStatus: 'draft', recordable: false, closedReason: 'not_scheduled' });
    expect((await sheet('X')).body).toMatchObject({ recordable: false, closedReason: 'class_cancelled' });
    expect((await sheet('S', 'reader')).status).toBe(200);
    expect((await sheet('S', 'teacher2')).body).toMatchObject({ code: 'exam_not_found' });
    expect((await sheet('S', 's1')).body).toMatchObject({ code: 'exam_not_found' }); // the seeded student role holds exams.read but teaches no class
    expect((await sheet('S', 'outsider')).status).toBe(403);
    expect((await sheet(NIL_ID)).body).toMatchObject({ code: 'exam_not_found' });
  });

  it('AC2 — records a batch as a diff: each entry is the whole new state, unmentioned students stay, an identical batch writes nothing; one event per effective batch', async () => {
    const m = await mark();
    const first = await record('S', [
      { studentId: id('s1'), status: 'scored', score: 15.5, feedback: ' جيد ' },
      { studentId: id('s2'), status: 'absent' },
    ]);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.counts).toEqual({ students: 2, scored: 1, absent: 1, excused: 0 });
    const items = first.body.items as SheetItem[];
    expect(item(items, 's1')!.result).toMatchObject({ status: 'scored', score: 15.5, feedback: 'جيد', recordedBy: { userId: id('teacher') } });
    expect(item(items, 's2')!.result).toMatchObject({ status: 'absent', score: null, feedback: null });
    await record('S', [{ studentId: id('s1'), status: 'scored', score: 15.5, feedback: 'جيد' }]).expect(200); // identical
    const second = await record('S', [{ studentId: id('s1'), status: 'scored', score: 15.5 }], 'manager'); // feedback cleared; s2 untouched
    expect(item(second.body.items as SheetItem[], 's1')!.result).toMatchObject({ feedback: null, recordedBy: { userId: id('manager') } });
    expect(item(second.body.items as SheetItem[], 's2')!.result).toMatchObject({ status: 'absent' });
    await record('S', [{ studentId: id('s2'), status: 'excused', feedback: 'عذر طبي' }]).expect(200);
    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.entityType, event.entityId, event.actorUserId])).toEqual([
      ['exams.results.recorded', 'exams', exams['S'], id('teacher')],
      ['exams.results.recorded', 'exams', exams['S'], id('manager')],
      ['exams.results.recorded', 'exams', exams['S'], id('teacher')],
    ]);
    expect(events[0]!.metadata).toEqual({ classId: classes['A'], code: code('A'), created: 2, updated: 0, counts: { students: 2, scored: 1, absent: 1, excused: 0 } });
    expect(events[1]!.metadata).toMatchObject({ created: 0, updated: 1 });
  });

  it('AC3 — refuses before any write: duplicates, a draft exam, a cancelled class, a score above the maximum, students not enrolled, malformed entries, no key, an invisible exam', async () => {
    const m = await mark();
    expect((await record('S', [{ studentId: id('s1'), status: 'absent' }, { studentId: id('s1'), status: 'excused' }])).body).toMatchObject({ code: 'results_invalid', duplicates: [id('s1')] });
    expect((await record('D', [{ studentId: id('s1'), status: 'absent' }])).body).toMatchObject({ code: 'exam_not_recordable', reason: 'not_scheduled' });
    expect((await record('X', [{ studentId: id('s1'), status: 'absent' }])).body).toMatchObject({ code: 'class_closed', status: 'cancelled' });
    const above = await record('S', [{ studentId: id('s1'), status: 'scored', score: 21 }]);
    expect(above.status).toBe(400);
    expect(above.body).toMatchObject({ code: 'score_out_of_range', score: 21, maxScore: 20, studentId: id('s1') });
    const outside = await record('S', [{ studentId: id('s3'), status: 'absent' }, { studentId: id('s4'), status: 'absent' }, { studentId: id('s1'), status: 'absent' }]);
    expect(outside.status).toBe(422);
    expect(outside.body).toMatchObject({ code: 'not_enrolled', studentIds: [id('s3'), id('s4')] });
    const malformed: object[][] = [
      [],
      [{ studentId: id('s1'), status: 'scored' }], // no score
      [{ studentId: id('s1'), status: 'absent', score: 3 }],
      [{ studentId: id('s1'), status: 'scored', score: '15' }],
      [{ studentId: id('s1'), status: 'scored', score: 15.555 }],
      [{ studentId: id('s1'), status: 'present' }],
      [{ studentId: 'x', status: 'absent' }],
      [{ studentId: id('s1'), status: 'absent', feedback: 'ف'.repeat(501) }],
    ];
    for (const body of malformed) expect((await record('S', body)).status, JSON.stringify(body)).toBe(400);
    expect((await record('S', [{ studentId: id('s1'), status: 'absent' }], 'reader')).status).toBe(403); // exams.read without exams.grade
    expect((await record('S', [{ studentId: id('s1'), status: 'absent' }], 'teacher2')).body).toMatchObject({ code: 'exam_not_found' });
    expect(await eventsSince(m)).toEqual([]);
  });

  it('AC4 — results lock the exam’s maximum and its unscheduling; a withdrawn student keeps their result on the sheet but takes no new one; a completed class keeps corrections open', async () => {
    expect((await api().patch(`${EXAMS}/${exams['S']}`).set(bearer('teacher')).send({ maxScore: 10 })).body).toMatchObject({ code: 'exam_locked', fields: ['maxScore'], resultCount: 2 });
    expect((await api().post(`${EXAMS}/${exams['S']}/status`).set(bearer('teacher')).send({ action: 'unschedule' })).body).toMatchObject({ code: 'exam_has_results', resultCount: 2 });
    await prisma.enrollment.updateMany({ where: { classId: classes['A']!, studentUserId: id('s2') }, data: { status: 'withdrawn', withdrawnAt: new Date() } });
    const items = (await sheet('S').expect(200)).body.items as SheetItem[];
    expect(item(items, 's2')).toMatchObject({ enrollmentStatus: 'withdrawn', result: { status: 'excused' } });
    expect((await record('S', [{ studentId: id('s2'), status: 'absent' }])).body).toMatchObject({ code: 'not_enrolled', studentIds: [id('s2')] });
    const corrected = await record('FIN', [{ studentId: id('s1'), status: 'scored', score: 19 }]);
    expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
    expect(item(corrected.body.items as SheetItem[], 's1')!.result).toMatchObject({ score: 19 });
  });

  it('AC5 — two simultaneous batches on one exam serialise under the exam-row lock; both are written', async () => {
    await createExam('RACE', 'A');
    const results = await Promise.all([record('RACE', [{ studentId: id('s1'), status: 'scored', score: 10 }]), record('RACE', [{ studentId: id('s1'), status: 'scored', score: 12 }], 'manager')]);
    expect(results.map((res) => res.status)).toEqual([200, 200]);
    const stored = await prisma.examResult.findUniqueOrThrow({ where: { examId_studentUserId: { examId: exams['RACE']!, studentUserId: id('s1') } } });
    expect([10, 12]).toContain(Number(stored.score));
    expect(await prisma.examResult.count({ where: { examId: exams['RACE']! } })).toBe(1);
  });

  it(
    'documents the routes in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths['/api/exams/{id}/results']).sort()).toEqual(['get', 'put']);
      for (const schema of ['ExamResultsSheetDto', 'ExamResultItemDto', 'ExamResultDto', 'RecordExamResultsDto', 'ExamResultInputDto']) expect(docs.body.components.schemas).toHaveProperty(schema);
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
