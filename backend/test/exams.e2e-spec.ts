// TEST-129 — MOD-09-T03 exams (API-113..API-118) against the live development
// database. Skipped when no database is reachable. Fixture users (a manager
// with a custom role, teachers with the system `teacher` role, a reader whose
// custom role holds `classes.manage` + `exams.read` without `exams.manage`, a student, an
// outsider), roles, a published course, classes, a lesson and exams carry a
// unique prefix and are deleted at the end — the classes cascade to their
// exams and results. Results are written through Prisma here (the results
// sheet is T04). Audit events are counted by fixture actor above an id watermark.
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
const PREFIX = `X${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-129 supertest';
const CLASSES = '/api/classes';
const EXAMS = '/api/exams';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const EXAM_KEYS = [
  'activeStudents',
  'class',
  'createdAt',
  'description',
  'durationMinutes',
  'id',
  'lesson',
  'maxScore',
  'passScore',
  'publishedAt',
  'results',
  'scheduledAt',
  'status',
  'timeZone',
  'title',
  'type',
  'updatedAt',
  'weight',
];

interface ExamBody {
  id: string;
  status: string;
  type: string;
  scheduledAt: string | null;
  maxScore: number;
  passScore: number | null;
  weight: number | null;
  publishedAt: string | null;
  results: { students: number; scored: number; absent: number; excused: number };
  activeStudents: number;
  class: { id: string };
  lesson: { id: string } | null;
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

describe.skipIf(!available)('MOD-09 exams (e2e, TEST-129)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let courseId: string;
  let academyTimeZone: string;
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
  const createExam = (suffix: string, body: object, as = 'teacher') => api().post(`${CLASSES}/${classes[suffix] ?? suffix}/exams`).set(bearer(as)).send(body);
  const listExams = (as: string, query: Record<string, string> = {}) => api().get(EXAMS).query(query).set(bearer(as));
  const readExam = (examId: string, as = 'teacher') => api().get(`${EXAMS}/${examId}`).set(bearer(as));
  const patchExam = (examId: string, body: object, as = 'teacher') => api().patch(`${EXAMS}/${examId}`).set(bearer(as)).send(body);
  const act = (examId: string, action: string, as = 'teacher', reason?: string) => api().post(`${EXAMS}/${examId}/status`).set(bearer(as)).send({ action, ...(reason ? { reason } : {}) });
  const names = (items: ExamBody[]) => items.map((item) => Object.keys(exams).find((key) => exams[key] === item.id));
  const base = (over: object = {}) => ({ title: { ar: 'اختبار قصير' }, type: 'quiz', maxScore: 20, ...over });

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

  async function createClass(suffix: string, teachers: string[], actions: string[] = ['open']): Promise<void> {
    const res = await api().post(CLASSES).set(bearer('manager')).send({ courseId, code: code(suffix), name: { ar: `فصل ${suffix}` }, capacity: 10 }).expect(201);
    classes[suffix] = res.body.id as string;
    if (teachers.length > 0) {
      await api()
        .put(`${CLASSES}/${classes[suffix]}/teachers`)
        .set(bearer('manager'))
        .send({ teachers: teachers.map((userId, index) => ({ userId, role: index === 0 ? 'lead' : 'assistant' })) })
        .expect(200);
    }
    for (const action of actions) await api().post(`${CLASSES}/${classes[suffix]}/status`).set(bearer('manager')).send({ action }).expect(200);
  }

  async function result(examId: string, student: string, status: 'scored' | 'absent' | 'excused', score: number | null = null): Promise<void> {
    await prisma.examResult.create({ data: { examId, studentUserId: id(student), status, score }, select: { examId: true } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    academyTimeZone = (await prisma.academy.findFirstOrThrow({ select: { timezone: true } })).timezone;

    courseId = (await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة الاختبارات' }, status: 'published' }, select: { id: true } })).id;
    const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
    const teacherRole = await systemRole('teacher');
    await createUser('manager', [await createRole('xmanager', ['classes.read', 'classes.manage', 'classes.teachers.assign', 'exams.read', 'exams.manage', 'exams.grade'])]);
    await createUser('teacher', [teacherRole]);
    await createUser('teacher2', [teacherRole]);
    // Sees every class through classes.manage but holds exams.read alone (the seeded teacher role carries exams.manage, so a class teacher cannot be read-only).
    await createUser('reader', [await createRole('xreader', ['classes.read', 'classes.manage', 'exams.read'])]);
    await createUser('student', [await systemRole('student')]);
    await createUser('outsider', [await createRole('xoutsider', ['courses.read'])]);

    await createClass('A', [id('teacher')]);
    await createClass('B', [id('teacher2')]);
    await createClass('C', [id('teacher')], ['open', 'cancel']); // cancelled
    await createClass('D', [id('teacher')], ['open', 'start', 'complete']); // completed
    await createClass('E', [id('teacher')]); // cancelled later, after an exam exists
    await createClass('F', [id('teacher')], ['open', 'start']); // completed later, after an exam exists
    await prisma.enrollment.create({ data: { classId: classes['A']!, studentUserId: id('student'), status: 'active' }, select: { id: true } });
    fx['lessonA'] = (await prisma.lesson.create({ data: { classId: classes['A']!, title: { ar: 'درس الاختبار' }, startsAt: new Date('2030-03-01T08:00:00Z'), endsAt: new Date('2030-03-01T09:00:00Z') }, select: { id: true } })).id;
    fx['lessonB'] = (await prisma.lesson.create({ data: { classId: classes['B']!, title: { ar: 'درس آخر' }, startsAt: new Date('2030-03-02T08:00:00Z'), endsAt: new Date('2030-03-02T09:00:00Z') }, select: { id: true } })).id;
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

  it('AC1 — an assigned teacher creates a draft exam for a planned, open or running class, optionally in one of its lessons; one event; others cannot', async () => {
    const m = await mark();
    const res = await createExam('A', base({ title: { ar: 'منتصف الدورة', en: 'Midterm' }, type: 'midterm', lessonId: id('lessonA'), scheduledAt: '2030-03-01T11:00:00+03:00', durationMinutes: 60, maxScore: 50, passScore: 25, weight: 30, description: { ar: 'الفصول 1–4' } }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const body = res.body as ExamBody;
    expect(Object.keys(body).sort()).toEqual(EXAM_KEYS);
    expect(body).toMatchObject({
      status: 'draft',
      type: 'midterm',
      scheduledAt: '2030-03-01T08:00:00.000Z',
      maxScore: 50,
      passScore: 25,
      weight: 30,
      publishedAt: null,
      results: { students: 0, scored: 0, absent: 0, excused: 0 },
      activeStudents: 1,
      class: { id: classes['A'] },
      lesson: { id: id('lessonA') },
    });
    expect(res.body).toMatchObject({ timeZone: academyTimeZone, description: { ar: 'الفصول 1–4' }, durationMinutes: 60 });
    exams['A1'] = body.id;
    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.entityType, event.entityId, event.actorUserId])).toEqual([['exams.created', 'exams', body.id, id('teacher')]]);
    expect(events[0]!.metadata).toEqual({ classId: classes['A'], code: code('A'), type: 'midterm' });

    exams['A2'] = (await createExam('A', base({ scheduledAt: '2030-02-01T10:00:00Z' })).expect(201)).body.id as string;
    exams['A3'] = (await createExam('A', base({ type: 'project' })).expect(201)).body.id as string; // undated
    exams['B1'] = (await createExam('B', base({ scheduledAt: '2030-01-15T10:00:00Z' }), 'teacher2').expect(201)).body.id as string;
    exams['F1'] = (await createExam('F', base({ type: 'final', weight: 50 })).expect(201)).body.id as string;
    exams['E1'] = (await createExam('E', base()).expect(201)).body.id as string;
    expect((await createExam('A', base(), 'teacher2')).body).toMatchObject({ code: 'class_not_found' }); // not assigned to A
    expect((await createExam('A', base(), 'reader')).status).toBe(403); // exams.read without exams.manage
    expect((await createExam('A', base(), 'student')).status).toBe(403);
    expect((await createExam(NIL_ID, base(), 'manager')).body).toMatchObject({ code: 'class_not_found' });
  });

  it('AC2 — refuses a completed or cancelled class, a lesson of another class, a pass score above the maximum and malformed bodies, without an event', async () => {
    // Close E and F now that each holds an exam.
    await api().post(`${CLASSES}/${classes['E']}/status`).set(bearer('manager')).send({ action: 'cancel' }).expect(200);
    await api().post(`${CLASSES}/${classes['F']}/status`).set(bearer('manager')).send({ action: 'complete' }).expect(200);
    const m = await mark();
    expect((await createExam('C', base())).body).toMatchObject({ code: 'class_closed', status: 'cancelled' });
    expect((await createExam('D', base())).body).toMatchObject({ code: 'class_closed', status: 'completed' });
    expect((await createExam('A', base({ lessonId: id('lessonB') }))).body).toMatchObject({ code: 'lesson_mismatch', lessonId: id('lessonB'), classId: classes['A'] });
    expect((await createExam('A', base({ lessonId: NIL_ID }))).body).toMatchObject({ code: 'lesson_not_found' });
    const pass = await createExam('A', base({ passScore: 21 }));
    expect(pass.status).toBe(400);
    expect(pass.body).toMatchObject({ code: 'pass_score_invalid', passScore: 21, maxScore: 20 });
    const malformed: object[] = [
      { title: { ar: 'x' }, maxScore: 20 }, // no type
      base({ type: 'placement' }), // not a first-version type
      base({ maxScore: '20' }),
      base({ maxScore: 0 }),
      base({ durationMinutes: 0 }),
      base({ durationMinutes: 721 }),
      base({ durationMinutes: 30.5 }),
      base({ passScore: -1 }),
      base({ weight: 1000 }),
      base({ scheduledAt: '2030-03-01T08:00:00' }), // no offset
      base({ title: { en: 'no arabic' } }),
      base({ status: 'scheduled' }), // not a create field
    ];
    for (const body of malformed) expect((await createExam('A', body)).status, JSON.stringify(body)).toBe(400);
    expect(await eventsSince(m)).toEqual([]);
  });

  it('AC3 — reads follow the class visibility; filters, result counts and keyset pages in both orders', async () => {
    await result(exams['A1']!, 'student', 'scored', 41.5);
    const all = (await listExams('manager', { classId: classes['A']! }).expect(200)).body.items as ExamBody[];
    expect(names(all)).toEqual(['A2', 'A1', 'A3']); // by date, undated last
    expect(all.find((item) => item.id === exams['A1'])).toMatchObject({ results: { students: 1, scored: 1, absent: 0, excused: 0 }, activeStudents: 1 });
    expect(names((await listExams('teacher').expect(200)).body.items as ExamBody[]).sort()).toEqual(['A1', 'A2', 'A3', 'E1', 'F1'].sort());
    expect(names((await listExams('teacher2').expect(200)).body.items as ExamBody[])).toEqual(['B1']);
    expect(names((await listExams('reader', { classId: classes['A']! }).expect(200)).body.items as ExamBody[])).toEqual(['A2', 'A1', 'A3']);
    expect((await listExams('student').expect(200)).body.items).toEqual([]); // exams.read, no assigned class
    expect((await readExam(exams['A1']!, 'student')).body).toMatchObject({ code: 'exam_not_found' });
    expect((await readExam(exams['A1']!, 'teacher2')).body).toMatchObject({ code: 'exam_not_found' });
    expect((await listExams('outsider')).status).toBe(403);
    expect((await readExam(exams['A1']!, 'reader').expect(200)).body).toMatchObject({ id: exams['A1'], type: 'midterm' });

    expect(names((await listExams('manager', { classId: classes['A']!, type: 'project' }).expect(200)).body.items)).toEqual(['A3']);
    expect(names((await listExams('manager', { classId: classes['A']!, from: '2030-02-15T00:00:00Z', to: '2030-12-31T00:00:00Z' }).expect(200)).body.items)).toEqual(['A1']);
    expect(names((await listExams('manager', { classId: classes['A']!, status: 'draft' }).expect(200)).body.items)).toEqual(['A2', 'A1', 'A3']);

    async function pages(order: string): Promise<(string | undefined)[]> {
      const seen: (string | undefined)[] = [];
      let cursor: string | null = null;
      do {
        const res = await listExams('manager', { classId: classes['A']!, limit: '1', order, ...(cursor ? { cursor } : {}) }).expect(200);
        seen.push(...names(res.body.items as ExamBody[]));
        cursor = res.body.nextCursor as string | null;
      } while (cursor);
      return seen;
    }
    expect(await pages('asc')).toEqual(['A2', 'A1', 'A3']);
    expect(await pages('desc')).toEqual(['A1', 'A2', 'A3']);
    expect((await listExams('manager', { cursor: 'garbage' })).body).toMatchObject({ code: 'cursor_invalid' });
    const badQueries: Record<string, string>[] = [{ status: 'open' }, { type: 'placement' }, { from: '2030-01-01' }, { limit: '0' }, { order: 'up' }];
    for (const query of badQueries) {
      expect((await listExams('manager', query)).status, JSON.stringify(query)).toBe(400);
    }
  });

  it('AC4 — PATCH writes the smallest change; maxScore is locked once a result exists; the pass score stays within the maximum; a cancelled class freezes its exams, a completed one does not', async () => {
    const a1 = exams['A1']!;
    const m = await mark();
    await patchExam(a1, { title: { ar: 'منتصف الدورة', en: 'Midterm' }, maxScore: 50 }).expect(200); // identical
    expect(await eventsSince(m)).toEqual([]);
    const locked = await patchExam(a1, { maxScore: 40, weight: 35 });
    expect(locked.status).toBe(409);
    expect(locked.body).toMatchObject({ code: 'exam_locked', status: 'draft', fields: ['maxScore'], resultCount: 1 });
    const edited = await patchExam(a1, { weight: 35, scheduledAt: null, durationMinutes: null, description: null });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body).toMatchObject({ weight: 35, scheduledAt: null, durationMinutes: null, description: null });
    expect((await patchExam(exams['A2']!, { maxScore: 10, passScore: 12 })).body).toMatchObject({ code: 'pass_score_invalid', passScore: 12, maxScore: 10 });
    expect((await patchExam(exams['A2']!, { lessonId: id('lessonB') })).body).toMatchObject({ code: 'lesson_mismatch' });
    expect((await patchExam(exams['A2']!, {})).body).toMatchObject({ code: 'nothing_to_update' });
    expect((await patchExam(exams['A2']!, { type: null })).status).toBe(400);
    expect((await patchExam(exams['A2']!, { weight: 5 }, 'reader')).status).toBe(403);
    expect((await patchExam(exams['B1']!, { weight: 5 })).body).toMatchObject({ code: 'exam_not_found' });
    expect((await patchExam(exams['E1']!, { weight: 5 })).body).toMatchObject({ code: 'class_closed', status: 'cancelled' });
    expect((await patchExam(exams['F1']!, { weight: 60 })).body).toMatchObject({ weight: 60 }); // a completed class keeps its exams open
    expect((await eventsSince(m)).map((event) => [event.action, event.entityId, event.metadata])).toEqual([
      ['exams.updated', a1, { classId: classes['A'], code: code('A'), fields: ['description', 'scheduledAt', 'durationMinutes', 'weight'] }],
      ['exams.updated', exams['F1'], { classId: classes['F'], code: code('F'), fields: ['weight'] }],
    ]);
  });

  it('AC5 — status actions move draft → scheduled → published and back; invalid transitions, unscheduling an exam with results and forward moves of a cancelled class are refused', async () => {
    const a2 = exams['A2']!;
    const m = await mark();
    expect((await act(a2, 'publish')).body).toMatchObject({ code: 'invalid_transition', from: 'draft', action: 'publish', allowed: ['schedule'] });
    expect((await act(a2, 'schedule', 'teacher', 'الموعد ثابت')).body).toMatchObject({ status: 'scheduled', publishedAt: null });
    await act(a2, 'unschedule').expect(200);
    await act(a2, 'schedule').expect(200);
    const published = await act(a2, 'publish');
    expect(published.body).toMatchObject({ status: 'published' });
    expect(typeof published.body.publishedAt).toBe('string');
    expect((await act(a2, 'unpublish')).body).toMatchObject({ status: 'scheduled', publishedAt: null });
    await result(a2, 'student', 'absent');
    expect((await act(a2, 'unschedule')).body).toMatchObject({ code: 'exam_has_results', action: 'unschedule', resultCount: 1 });
    expect((await act(exams['E1']!, 'schedule')).body).toMatchObject({ code: 'class_closed' });
    expect((await act(a2, 'archive')).status).toBe(400);
    expect((await act(a2, 'publish', 'reader')).status).toBe(403);
    await act(exams['F1']!, 'schedule').expect(200); // a completed class: allowed
    expect((await eventsSince(m)).map((event) => [event.action, (event.metadata as { action: string }).action, (event.metadata as { to: string }).to])).toEqual([
      ['exams.status.changed', 'schedule', 'scheduled'],
      ['exams.status.changed', 'unschedule', 'draft'],
      ['exams.status.changed', 'schedule', 'scheduled'],
      ['exams.status.changed', 'publish', 'published'],
      ['exams.status.changed', 'unpublish', 'scheduled'],
      ['exams.status.changed', 'schedule', 'scheduled'],
    ]);
    const first = (await eventsSince(m))[0]!;
    expect(first.metadata).toEqual({ classId: classes['A'], code: code('A'), action: 'schedule', from: 'draft', to: 'scheduled', reason: 'الموعد ثابت' });
  });

  it('AC6 — deletes a draft or scheduled exam without results, also of a cancelled class; anything else is exam_not_deletable', async () => {
    const m = await mark();
    expect((await api().delete(`${EXAMS}/${exams['A1']}`).set(bearer('teacher'))).body).toMatchObject({ code: 'exam_not_deletable', status: 'draft', resultCount: 1 });
    expect((await api().delete(`${EXAMS}/${exams['A2']}`).set(bearer('teacher'))).body).toMatchObject({ code: 'exam_not_deletable', status: 'scheduled', resultCount: 1 });
    expect((await api().delete(`${EXAMS}/${exams['A3']}`).set(bearer('reader'))).status).toBe(403);
    await api().delete(`${EXAMS}/${exams['A3']}`).set(bearer('teacher')).expect(204);
    await api().delete(`${EXAMS}/${exams['E1']}`).set(bearer('teacher')).expect(204); // cancelled class
    await api().post(`${EXAMS}/${exams['F1']}/status`).set(bearer('teacher')).send({ action: 'publish' }).expect(200);
    expect((await api().delete(`${EXAMS}/${exams['F1']}`).set(bearer('teacher'))).body).toMatchObject({ code: 'exam_not_deletable', status: 'published', resultCount: 0 });
    expect((await api().delete(`${EXAMS}/${NIL_ID}`).set(bearer('teacher'))).body).toMatchObject({ code: 'exam_not_found' });
    expect(await prisma.exam.count({ where: { id: { in: [exams['A3']!, exams['E1']!] } } })).toBe(0);
    expect((await eventsSince(m)).map((event) => [event.action, event.entityId])).toEqual([
      ['exams.deleted', exams['A3']],
      ['exams.deleted', exams['E1']],
      ['exams.status.changed', exams['F1']],
    ]);
  });

  it(
    'documents the routes in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths['/api/exams'])).toEqual(['get']);
      expect(Object.keys(docs.body.paths['/api/exams/{id}']).sort()).toEqual(['delete', 'get', 'patch']);
      expect(Object.keys(docs.body.paths['/api/exams/{id}/status'])).toEqual(['post']);
      expect(Object.keys(docs.body.paths['/api/classes/{id}/exams'])).toEqual(['post']);
      for (const schema of ['ExamDto', 'ExamListDto', 'ExamResultCountsDto', 'CreateExamDto', 'UpdateExamDto', 'ChangeExamStatusDto']) expect(docs.body.components.schemas).toHaveProperty(schema);
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
