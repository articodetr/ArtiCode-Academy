// TEST-123 — MOD-08-T02 assignments (API-102..API-107) against the live
// development database. Skipped when no database is reachable. Fixture users
// (two holding the system `teacher` role, two holding `student`), roles, a
// published course, classes, lessons, enrollments, assignments and
// submissions carry a unique prefix and are deleted at the end — enrollments
// first (they restrict their class), then the classes (lessons, assignments
// and submissions cascade), the course, the users and the roles. Submissions
// are written with Prisma (the submission API is T03). Audit events are
// counted by fixture actor above an id watermark.
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
const PREFIX = `W${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-123 supertest';
const CLASSES = '/api/classes';
const ASSIGNMENTS = '/api/assignments';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const ASSIGNMENT_KEYS = [
  'activeStudents',
  'allowLate',
  'class',
  'closedAt',
  'createdAt',
  'dueAt',
  'id',
  'instructions',
  'latePenaltyPercent',
  'lesson',
  'maxAttempts',
  'maxScore',
  'publishedAt',
  'status',
  'submissions',
  'timeZone',
  'title',
  'updatedAt',
  'weight',
];

interface AssignmentBody {
  id: string;
  class: { id: string; code: string; status: string; course: { id: string; code: string } };
  lesson: { id: string; startsAt: string } | null;
  title: Record<string, string>;
  instructions: Record<string, string> | null;
  maxScore: number;
  weight: number | null;
  status: string;
  publishedAt: string | null;
  closedAt: string | null;
  dueAt: string | null;
  timeZone: string;
  allowLate: boolean;
  latePenaltyPercent: number | null;
  maxAttempts: number;
  submissions: { students: number; submitted: number; graded: number; returned: number };
  activeStudents: number;
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

describe.skipIf(!available)('MOD-08 assignments (e2e, TEST-123)', () => {
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
  const lessons: Record<string, string> = {};
  const actors: string[] = [];

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  const create = (classId: string, body: object, as = 'manager') => api().post(`${CLASSES}/${classId}/assignments`).set(bearer(as)).send(body);
  const patch = (assignmentId: string, body: object, as = 'manager') => api().patch(`${ASSIGNMENTS}/${assignmentId}`).set(bearer(as)).send(body);
  const act = (assignmentId: string, action: string, reason?: string, as = 'manager') =>
    api().post(`${ASSIGNMENTS}/${assignmentId}/status`).set(bearer(as)).send(reason === undefined ? { action } : { action, reason });
  const get = (assignmentId: string, as = 'manager') => api().get(`${ASSIGNMENTS}/${assignmentId}`).set(bearer(as));
  const list = (query: Record<string, string> = {}, as = 'manager') => api().get(ASSIGNMENTS).query(query).set(bearer(as));
  const remove = (assignmentId: string, as = 'manager') => api().delete(`${ASSIGNMENTS}/${assignmentId}`).set(bearer(as));
  const ours = (items: AssignmentBody[]) => items.filter((entry) => Object.values(classes).includes(entry.class.id));
  const minimal = (over: Record<string, unknown> = {}) => ({ title: { ar: 'واجب' }, maxScore: 10, ...over });
  const submit = (assignmentId: string, student: string, attemptNo = 1) =>
    prisma.assignmentSubmission.create({ data: { assignmentId, studentUserId: id(student), attemptNo, textAnswer: 'إجابة' }, select: { id: true } });

  async function createRole(name: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_${name}_${RUN.toLowerCase()}`, label: { ar: `دور اختبار ${name}` }, permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(name: string, roleIds: string[], login = true): Promise<void> {
    const user = await prisma.user.create({
      data: { email: email(name), fullName: `Test ${name}`, passwordHash: login ? await passwords.hash(PASSWORD) : null, status: 'active', roles: { create: roleIds.map((roleId) => ({ roleId })) } },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    if (login) {
      const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(name), password: PASSWORD }).expect(200);
      tokens[name] = res.body.accessToken as string;
      actors.push(user.id);
    }
  }

  async function mark(): Promise<string> {
    const latest = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return latest?.id ?? NIL_ID;
  }
  const eventsSince = (markId: string) => prisma.auditLog.findMany({ where: { id: { gt: markId }, actorUserId: { in: actors } }, orderBy: { id: 'asc' } });

  async function createClass(suffix: string, teachers: string[], actions: string[] = []): Promise<string> {
    const res = await api().post(CLASSES).set(bearer('manager')).send({ courseId, code: code(suffix), name: { ar: `فصل ${suffix}` }, capacity: 10 }).expect(201);
    const classId = res.body.id as string;
    if (teachers.length > 0) {
      await api()
        .put(`${CLASSES}/${classId}/teachers`)
        .set(bearer('manager'))
        .send({ teachers: teachers.map((userId, index) => ({ userId, role: index === 0 ? 'lead' : 'assistant' })) })
        .expect(200);
    }
    for (const action of actions) await api().post(`${CLASSES}/${classId}/status`).set(bearer('manager')).send({ action }).expect(200);
    classes[suffix] = classId;
    return classId;
  }

  async function classAction(suffix: string, action: string): Promise<void> {
    await api().post(`${CLASSES}/${classes[suffix]}/status`).set(bearer('manager')).send({ action }).expect(200);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    academyTimeZone = (await prisma.academy.findFirstOrThrow({ select: { timezone: true } })).timezone;

    courseId = (await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة الواجبات' }, status: 'published' }, select: { id: true } })).id;

    const teacherRoleId = (await prisma.role.findUniqueOrThrow({ where: { key: 'teacher' }, select: { id: true } })).id;
    const studentRoleId = (await prisma.role.findUniqueOrThrow({ where: { key: 'student' }, select: { id: true } })).id;
    const manager = await createRole('wmanager', ['classes.read', 'classes.manage', 'classes.teachers.assign', 'assignments.read', 'assignments.manage']);
    const teaching = await createRole('wteacher', ['classes.read', 'assignments.read', 'assignments.manage']);
    const staff = await createRole('wstaff', ['classes.read', 'classes.manage', 'assignments.read']);
    const outsider = await createRole('woutsider', ['courses.read']);
    await createUser('manager', [manager]);
    await createUser('teacher', [teaching, teacherRoleId]);
    await createUser('teacher2', [teaching, teacherRoleId]);
    await createUser('staff', [staff]);
    await createUser('outsider', [outsider]);
    await createUser('student1', [studentRoleId], false);
    await createUser('student2', [studentRoleId], false);

    await createClass('A', [id('teacher'), id('teacher2')], ['open']);
    await createClass('B', [id('teacher2')], ['open']);
    await createClass('C', [id('teacher')], ['open']);
    await createClass('D', [id('teacher')], ['open', 'start', 'complete']);
    await createClass('E', [id('teacher')], ['open', 'start']);
    for (const student of ['student1', 'student2']) {
      await prisma.enrollment.create({ data: { classId: classes['A']!, studentUserId: id(student), status: 'active', activatedAt: new Date() }, select: { id: true } });
    }
    for (const suffix of ['A', 'B']) {
      lessons[suffix] = (
        await prisma.lesson.create({
          data: { classId: classes[suffix]!, title: { ar: `درس ${suffix}` }, startsAt: new Date('2026-11-12T10:00:00Z'), endsAt: new Date('2026-11-12T11:00:00Z') },
          select: { id: true },
        })
      ).id;
    }
  });

  afterAll(async () => {
    try {
      if (prisma) {
        const classIds = Object.values(classes);
        await prisma.enrollment.deleteMany({ where: { classId: { in: classIds } } });
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

  it('AC1 — a teacher creates and reads the assignments of their assigned classes only; staff reads everything and writes nothing; no key is 403; anonymous 401', async () => {
    const m = await mark();
    const created = await create(
      classes['A']!,
      {
        title: { ar: 'واجب الكسور', en: 'Fractions' },
        instructions: { ar: 'حلّ تمارين الصفحة 12' },
        lessonId: lessons['A'],
        maxScore: 20,
        weight: 10,
        dueAt: '2026-11-20T23:59:00+03:00',
        allowLate: true,
        latePenaltyPercent: 10,
        maxAttempts: 2,
      },
      'teacher',
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const body = created.body as AssignmentBody;
    expect(Object.keys(body).sort()).toEqual([...ASSIGNMENT_KEYS].sort());
    expect(body).toMatchObject({
      class: { id: classes['A'], code: code('A'), status: 'open', course: { id: courseId, code: code('CRS') } },
      lesson: { id: lessons['A'], startsAt: '2026-11-12T10:00:00.000Z' },
      title: { ar: 'واجب الكسور', en: 'Fractions' },
      instructions: { ar: 'حلّ تمارين الصفحة 12' },
      maxScore: 20,
      weight: 10,
      status: 'draft',
      publishedAt: null,
      closedAt: null,
      dueAt: '2026-11-20T20:59:00.000Z',
      timeZone: academyTimeZone, // D-R41: the linked lesson has no room → the academy's zone
      allowLate: true,
      latePenaltyPercent: 10,
      maxAttempts: 2,
      submissions: { students: 0, submitted: 0, graded: 0, returned: 0 },
      activeStudents: 2,
    });
    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.entityType, event.entityId])).toEqual([['assignments.created', 'assignments', body.id]]);
    expect(events[0]!.metadata).toEqual({ classId: classes['A'], code: code('A') });

    // The assistant writes in A too, with the defaults; nobody but a manager in B (teacher is not assigned there → 404, not 403).
    const minimalOne = await create(classes['A']!, minimal(), 'teacher2');
    expect(minimalOne.status).toBe(201);
    expect(minimalOne.body).toMatchObject({ status: 'draft', instructions: null, lesson: null, weight: null, dueAt: null, allowLate: false, latePenaltyPercent: null, maxAttempts: 1, maxScore: 10 });
    const hidden = await create(classes['B']!, minimal(), 'teacher');
    expect(hidden.status).toBe(404);
    expect(hidden.body).toMatchObject({ code: 'class_not_found', classId: classes['B'] });
    const inB = await create(classes['B']!, minimal()).expect(201);
    const notVisible = await get(inB.body.id, 'teacher');
    expect(notVisible.status).toBe(404);
    expect(notVisible.body).toMatchObject({ code: 'assignment_not_found', assignmentId: inB.body.id });
    expect(ours((await list({}, 'teacher').expect(200)).body.items).every((entry) => entry.class.id === classes['A'])).toBe(true);
    expect((await get(body.id, 'teacher').expect(200)).body).toMatchObject({ id: body.id, status: 'draft' });

    // Staff (classes.manage + assignments.read) reads every class and writes nothing.
    const seen = ours((await list({}, 'staff').expect(200)).body.items).map((entry) => entry.class.id);
    expect(seen).toContain(classes['A']);
    expect(seen).toContain(classes['B']);
    expect((await create(classes['A']!, minimal(), 'staff')).status).toBe(403);
    expect((await patch(body.id, { weight: 5 }, 'staff')).status).toBe(403);
    expect((await list({}, 'outsider')).status).toBe(403);
    expect((await api().get(ASSIGNMENTS)).status).toBe(401);
  });

  it('AC2 — creation rules: closed class, foreign or unknown lesson, late penalty without allowLate, raw numbers and booleans — all refused without an event', async () => {
    const m = await mark();
    const closed = await create(classes['D']!, minimal(), 'teacher');
    expect(closed.status).toBe(409);
    expect(closed.body).toMatchObject({ code: 'class_closed', classId: classes['D'], status: 'completed' });
    const mismatch = await create(classes['A']!, minimal({ lessonId: lessons['B'] }));
    expect(mismatch.status).toBe(422);
    expect(mismatch.body).toMatchObject({ code: 'lesson_mismatch', lessonId: lessons['B'], classId: classes['A'] });
    const unknownLesson = await create(classes['A']!, minimal({ lessonId: NIL_ID }));
    expect(unknownLesson.status).toBe(404);
    expect(unknownLesson.body).toMatchObject({ code: 'lesson_not_found', lessonId: NIL_ID });
    const penalty = await create(classes['A']!, minimal({ latePenaltyPercent: 10 }));
    expect(penalty.status).toBe(400);
    expect(penalty.body).toMatchObject({ code: 'late_penalty_invalid', allowLate: false, latePenaltyPercent: 10 });
    expect((await create(NIL_ID, minimal())).body).toMatchObject({ code: 'class_not_found' });
    const badBodies: Record<string, unknown>[] = [
      minimal({ maxScore: '10' }),
      minimal({ maxScore: 0 }),
      minimal({ maxScore: 10.123 }),
      minimal({ maxScore: 10000 }),
      minimal({ maxAttempts: 0 }),
      minimal({ maxAttempts: 1.5 }),
      minimal({ allowLate: 'yes' }),
      minimal({ weight: -1 }),
      minimal({ allowLate: true, latePenaltyPercent: 101 }),
      minimal({ dueAt: '2026-11-20' }),
      minimal({ instructions: { en: 'no arabic' } }),
      minimal({ title: { en: 'no arabic' } }),
      minimal({ status: 'open' }),
      { title: { ar: 'بلا درجة' } },
    ];
    for (const bad of badBodies) {
      expect((await create(classes['A']!, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(await eventsSince(m)).toEqual([]);
  });

  it('AC3 — PATCH writes the smallest diff; the grading rules lock after a submission and a closed assignment accepts nothing; the late policy is checked after the merge', async () => {
    const x = (await create(classes['A']!, minimal({ maxScore: 20, weight: 10, dueAt: '2026-11-25T10:00:00Z', allowLate: true, latePenaltyPercent: 10 }), 'teacher').expect(201)).body as AssignmentBody;
    const m = await mark();
    expect((await patch(x.id, {}, 'teacher')).body).toMatchObject({ code: 'nothing_to_update' });
    expect((await patch(x.id, { maxScore: 20, title: { ar: 'واجب' }, dueAt: '2026-11-25T13:00:00+03:00' }, 'teacher')).status).toBe(200);
    expect(await eventsSince(m)).toEqual([]); // identical values (the due date in another offset) — nothing written

    const changed = await patch(x.id, { title: { ar: 'واجب معدَّل' }, weight: null, dueAt: null }, 'teacher');
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body).toMatchObject({ title: { ar: 'واجب معدَّل' }, weight: null, dueAt: null });
    const late = await patch(x.id, { allowLate: false }, 'teacher');
    expect(late.status).toBe(400);
    expect(late.body).toMatchObject({ code: 'late_penalty_invalid', allowLate: false, latePenaltyPercent: 10 });
    expect((await patch(x.id, { allowLate: false, latePenaltyPercent: null }, 'teacher')).body).toMatchObject({ allowLate: false, latePenaltyPercent: null });
    expect((await patch(x.id, { lessonId: lessons['B'] }, 'teacher')).body).toMatchObject({ code: 'lesson_mismatch' });
    expect((await patch(x.id, { maxScore: 'x' }, 'teacher')).status).toBe(400);

    await act(x.id, 'publish', undefined, 'teacher').expect(200);
    await submit(x.id, 'student1');
    const lockedRule = await patch(x.id, { maxScore: 30, weight: 5 }, 'teacher');
    expect(lockedRule.status).toBe(409);
    expect(lockedRule.body).toMatchObject({ code: 'assignment_locked', status: 'open', fields: ['maxScore'], submissionCount: 1 });
    expect((await patch(x.id, { maxAttempts: 3 }, 'teacher')).body).toMatchObject({ code: 'assignment_locked', fields: ['maxAttempts'] });
    expect((await patch(x.id, { weight: 5, lessonId: lessons['A'] }, 'teacher')).body).toMatchObject({ weight: 5, lesson: { id: lessons['A'] } });
    const counted = (await get(x.id).expect(200)).body as AssignmentBody;
    expect(counted.submissions).toEqual({ students: 1, submitted: 1, graded: 0, returned: 0 });
    expect(counted.activeStudents).toBe(2);

    await act(x.id, 'close', undefined, 'teacher').expect(200);
    expect((await patch(x.id, { title: { ar: 'بعد الإغلاق' } }, 'teacher')).body).toMatchObject({ code: 'assignment_locked', status: 'closed', fields: ['title'] });

    const events = await eventsSince(m);
    expect(events.map((event) => event.action)).toEqual([
      'assignments.updated',
      'assignments.updated',
      'assignments.status.changed',
      'assignments.updated',
      'assignments.status.changed',
    ]);
    expect(events[0]!.metadata).toEqual({ classId: classes['A'], code: code('A'), fields: ['title', 'weight', 'dueAt'] });
    expect(events[1]!.metadata).toMatchObject({ fields: ['allowLate', 'latePenaltyPercent'] });
    expect(events[3]!.metadata).toMatchObject({ fields: ['lessonId', 'weight'] });
  });

  it('AC4 — publish, close and reopen move the status and its instants; anything else is invalid_transition; a closed class keeps close and deleting a draft only', async () => {
    const y = (await create(classes['A']!, minimal()).expect(201)).body as AssignmentBody;
    const m = await mark();
    const published = (await act(y.id, 'publish').expect(200)).body as AssignmentBody;
    expect(published.status).toBe('open');
    expect(typeof published.publishedAt).toBe('string');
    const again = await act(y.id, 'publish');
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'invalid_transition', from: 'open', action: 'publish', allowed: ['close'] });
    const closedOne = (await act(y.id, 'close', 'انتهى الموعد').expect(200)).body as AssignmentBody;
    expect(closedOne).toMatchObject({ status: 'closed', publishedAt: published.publishedAt });
    expect(typeof closedOne.closedAt).toBe('string');
    expect((await act(y.id, 'reopen').expect(200)).body).toMatchObject({ status: 'open', closedAt: null, publishedAt: published.publishedAt });
    expect((await act(y.id, 'start')).status).toBe(400);
    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, (event.metadata as { action: string }).action])).toEqual([
      ['assignments.status.changed', 'publish'],
      ['assignments.status.changed', 'close'],
      ['assignments.status.changed', 'reopen'],
    ]);
    expect(events[1]!.metadata).toEqual({ classId: classes['A'], code: code('A'), action: 'close', from: 'open', to: 'closed', reason: 'انتهى الموعد' });

    // Class E completes with an open and a draft assignment: close and deleting the draft stay possible, nothing else.
    const open = (await create(classes['E']!, minimal(), 'teacher').expect(201)).body as AssignmentBody;
    const draft = (await create(classes['E']!, minimal(), 'teacher').expect(201)).body as AssignmentBody;
    await act(open.id, 'publish', undefined, 'teacher').expect(200);
    await classAction('E', 'complete');
    expect((await act(draft.id, 'publish', undefined, 'teacher')).body).toMatchObject({ code: 'class_closed', status: 'completed' });
    expect((await patch(draft.id, { title: { ar: 'متأخر' } }, 'teacher')).body).toMatchObject({ code: 'class_closed' });
    expect((await act(open.id, 'close', undefined, 'teacher').expect(200)).body).toMatchObject({ status: 'closed' });
    expect((await act(open.id, 'reopen', undefined, 'teacher')).body).toMatchObject({ code: 'class_closed' });
    await remove(draft.id, 'teacher').expect(204);
  });

  it('AC5 — DELETE removes a draft without submissions only, with one event; others are assignment_not_deletable; invisible is 404 and no key is 403', async () => {
    const draft = (await create(classes['A']!, minimal(), 'teacher').expect(201)).body as AssignmentBody;
    const open = (await create(classes['A']!, minimal(), 'teacher').expect(201)).body as AssignmentBody;
    const withSubmission = (await create(classes['A']!, minimal(), 'teacher').expect(201)).body as AssignmentBody;
    await act(open.id, 'publish', undefined, 'teacher').expect(200);
    await submit(withSubmission.id, 'student2');
    const inB = (await create(classes['B']!, minimal()).expect(201)).body as AssignmentBody;
    const m = await mark();
    expect((await remove(open.id, 'teacher')).body).toMatchObject({ code: 'assignment_not_deletable', status: 'open', submissionCount: 0 });
    expect((await remove(withSubmission.id, 'teacher')).body).toMatchObject({ code: 'assignment_not_deletable', status: 'draft', submissionCount: 1 });
    expect((await remove(inB.id, 'teacher')).status).toBe(404);
    expect((await remove(draft.id, 'staff')).status).toBe(403);
    await remove(draft.id, 'teacher').expect(204);
    expect((await get(draft.id)).status).toBe(404);
    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.entityId])).toEqual([['assignments.deleted', draft.id]]);
    expect(events[0]!.metadata).toEqual({ classId: classes['A'], code: code('A') });
  });

  it('AC6 — the list pages by due date with the undated last in both orders, and filters by class, lesson, status and due range', async () => {
    const at = (title: string, dueAt?: string, over: Record<string, unknown> = {}) =>
      create(classes['C']!, minimal({ title: { ar: title }, ...(dueAt ? { dueAt } : {}), ...over }), 'teacher').expect(201);
    const d1 = (await at('d1', '2026-12-01T10:00:00Z')).body.id as string;
    const d2 = (await at('d2', '2026-12-02T10:00:00Z')).body.id as string;
    const d2b = (await at('d2b', '2026-12-02T13:00:00+03:00')).body.id as string; // the same instant as d2
    const n1 = (await at('n1')).body.id as string;
    const n2 = (await at('n2')).body.id as string;
    await act(d1, 'publish', undefined, 'teacher').expect(200);

    async function pages(query: Record<string, string>): Promise<string[]> {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const res = await list({ classId: classes['C']!, limit: '2', ...query, ...(cursor ? { cursor } : {}) }, 'teacher').expect(200);
        seen.push(...(res.body.items as AssignmentBody[]).map((entry) => entry.id));
        cursor = res.body.nextCursor as string | null;
      } while (cursor);
      return seen;
    }
    expect(await pages({})).toEqual([d1, d2, d2b, n1, n2]);
    expect(await pages({ order: 'desc' })).toEqual([d2b, d2, d1, n2, n1]);
    expect(await pages({ dueFrom: '2026-12-02T00:00:00Z' })).toEqual([d2, d2b]);
    expect(await pages({ dueTo: '2026-12-01T23:59:59+03:00' })).toEqual([d1]);
    expect(await pages({ status: 'open' })).toEqual([d1]);
    expect(await pages({ status: 'draft', order: 'desc' })).toEqual([d2b, d2, n2, n1]);
    const linked = (await create(classes['A']!, minimal({ lessonId: lessons['A'] })).expect(201)).body.id as string;
    expect((await list({ lessonId: lessons['A']! }).expect(200)).body.items.map((entry: AssignmentBody) => entry.id)).toContain(linked);
    expect(ours((await list({ lessonId: lessons['B']! }).expect(200)).body.items)).toEqual([]);

    expect((await list({ cursor: 'garbage' })).body).toMatchObject({ code: 'cursor_invalid' });
    const firstPage = await list({ classId: classes['C']!, limit: '1' }).expect(200);
    expect((await list({ classId: classes['C']!, limit: '1', order: 'desc', cursor: firstPage.body.nextCursor as string })).body).toMatchObject({ code: 'cursor_invalid' });
    const badQueries: Record<string, string>[] = [{ dueFrom: '2026-12-01' }, { status: 'done' }, { limit: '0' }, { limit: '101' }, { order: 'sideways' }, { classId: 'x' }, { q: 'x' }];
    for (const query of badQueries) {
      expect((await list(query)).status, JSON.stringify(query)).toBe(400);
    }
  });

  it(
    'documents the routes in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths['/api/classes/{id}/assignments'])).toEqual(['post']);
      expect(Object.keys(docs.body.paths['/api/assignments']).sort()).toEqual(['get']);
      expect(Object.keys(docs.body.paths['/api/assignments/{id}']).sort()).toEqual(['delete', 'get', 'patch']);
      expect(Object.keys(docs.body.paths['/api/assignments/{id}/status'])).toEqual(['post']);
      for (const schema of ['AssignmentDto', 'AssignmentListDto', 'CreateAssignmentDto', 'UpdateAssignmentDto', 'ChangeAssignmentStatusDto', 'SubmissionCountsDto', 'AssignmentInstructionsDto']) {
        expect(docs.body.components.schemas).toHaveProperty(schema);
      }
      expect(docs.body.components.schemas.AssignmentDto.properties.dueAt).toMatchObject({ type: 'string', nullable: true });
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
