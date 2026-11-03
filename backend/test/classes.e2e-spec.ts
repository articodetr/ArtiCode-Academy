// TEST-048 — MOD-05-T02 classes (GET /api/classes, GET/PATCH/DELETE
// /api/classes/:id, POST /api/classes, POST /api/classes/:id/status) and the
// "course with classes" guard of DELETE /api/courses/:id (AC7), against the
// live development database. Skipped when no database is reachable. Fixture
// users, roles, courses, classes, teacher assignments and enrollments carry a
// unique prefix and are deleted at the end (their audit rows stay — KI-032).
// Teacher assignments (T03) and enrollments (T04) have no API yet, so they are
// written with Prisma. Every list query is narrowed with `q` so classes of
// other clients never change the expectations; audit events are counted by
// fixture actor above an id watermark, as in TEST-030.
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
const PREFIX = `K${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-048 supertest';
const CLASSES = '/api/classes';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const DTO_KEYS = [
  'capacity',
  'code',
  'course',
  'createdAt',
  'endsOn',
  'enrolledCount',
  'id',
  'name',
  'notes',
  'startsOn',
  'status',
  'teachers',
  'updatedAt',
];

interface ClassBody {
  id: string;
  code: string;
  status: string;
  capacity: number;
  enrolledCount: number;
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

describe.skipIf(!available)('MOD-05 classes (e2e, TEST-048)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let publishedCourseId: string;
  let draftCourseId: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const studentIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const actors = () => Object.values(fx);
  const codes = (body: { items: { code: string }[] }) => body.items.map((item) => item.code);

  async function createRole(name: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: {
        key: `test_${name}_${RUN.toLowerCase()}`,
        label: { ar: `دور اختبار ${name}` },
        permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) },
      },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

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

  async function mark(): Promise<string> {
    const latest = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return latest?.id ?? NIL_ID;
  }

  const eventsSince = (markId: string) =>
    prisma.auditLog.findMany({ where: { id: { gt: markId }, actorUserId: { in: actors() } }, orderBy: { id: 'asc' } });

  async function createClass(suffix: string, extra: Record<string, unknown> = {}): Promise<ClassBody> {
    const res = await api()
      .post(CLASSES)
      .set(bearer('manager'))
      .send({ courseId: publishedCourseId, code: code(suffix), name: { ar: `فصل ${suffix}` }, capacity: 10, ...extra })
      .expect(201);
    return res.body as ClassBody;
  }

  const setStatus = (id: string, action: string, reason?: string) =>
    api().post(`${CLASSES}/${id}/status`).set(bearer('manager')).send(reason === undefined ? { action } : { action, reason });

  /** Moves a class along the machine with the API (planned → open → running). */
  async function advance(id: string, ...actions: string[]): Promise<void> {
    for (const action of actions) await setStatus(id, action).expect(200);
  }

  async function enroll(classId: string, studentUserId: string, status: EnrollmentStatus): Promise<string> {
    const row = await prisma.enrollment.create({ data: { classId, studentUserId, status }, select: { id: true } });
    return row.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    publishedCourseId = (
      await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة الفصول' }, status: 'published' }, select: { id: true } })
    ).id;
    draftCourseId = (await prisma.course.create({ data: { code: code('DRF'), name: { ar: 'مسودة' } }, select: { id: true } })).id;

    // The manager also holds courses.manage for the AC7 course delete.
    const manager = await createRole('clmanager', ['classes.read', 'classes.manage', 'courses.read', 'courses.manage']);
    const reader = await createRole('clreader', ['classes.read']);
    const outsider = await createRole('cloutsider', ['courses.read']);
    await createUser('manager', [manager]);
    await createUser('teacher', [reader]);
    await createUser('assistant', [reader]);
    await createUser('outsider', [outsider]);
    for (const name of ['manager', 'teacher', 'assistant', 'outsider']) tokens[name] = await login(email(name));

    for (const index of [1, 2, 3]) {
      const student = await prisma.user.create({ data: { email: email(`student${index}`), fullName: `Student ${index}`, status: 'active' }, select: { id: true } });
      createdUserIds.push(student.id);
      studentIds.push(student.id);
    }
  });

  afterAll(async () => {
    try {
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

  it('AC2 — creates a planned class of a published course with a normalised code, the creator and exactly one classes.created; refuses everything else without an event', async () => {
    const m = await mark();
    const res = await api()
      .post(CLASSES)
      .set(bearer('manager'))
      .send({
        courseId: publishedCourseId,
        code: ` ${code('A').toLowerCase()} `,
        name: { ar: 'بايثون — الفصل أ', en: 'Python — class A' },
        capacity: 20,
        startsOn: '2026-11-10',
        endsOn: '2026-12-20',
        notes: '  القاعة 4  ',
      })
      .expect(201);
    expect(Object.keys(res.body).sort()).toEqual(DTO_KEYS);
    expect(res.body).toMatchObject({
      code: code('A'),
      status: 'planned',
      capacity: 20,
      startsOn: '2026-11-10',
      endsOn: '2026-12-20',
      notes: 'القاعة 4',
      teachers: [],
      enrolledCount: 0,
      course: { id: publishedCourseId, code: code('CRS'), status: 'published', name: { ar: 'دورة الفصول' } },
    });
    const stored = await prisma.class.findUniqueOrThrow({ where: { id: res.body.id }, select: { createdById: true } });
    expect(stored.createdById).toBe(fx['manager']);
    const events = await eventsSince(m);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'classes.created',
      entityType: 'classes',
      entityId: res.body.id,
      metadata: { code: code('A'), courseId: publishedCourseId, status: 'planned' },
    });

    const m2 = await mark();
    const duplicate = await api().post(CLASSES).set(bearer('manager')).send({ courseId: publishedCourseId, code: code('A').toLowerCase(), name: { ar: 'م' }, capacity: 5 });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({ code: 'class_code_taken', classCode: code('A') });
    const draft = await api().post(CLASSES).set(bearer('manager')).send({ courseId: draftCourseId, code: code('X'), name: { ar: 'م' }, capacity: 5 });
    expect(draft.status).toBe(422);
    expect(draft.body).toMatchObject({ code: 'course_not_published', courseId: draftCourseId, status: 'draft' });
    const unknown = await api().post(CLASSES).set(bearer('manager')).send({ courseId: NIL_ID, code: code('X'), name: { ar: 'م' }, capacity: 5 });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ code: 'course_not_found', courseId: NIL_ID });
    const dates = await api()
      .post(CLASSES)
      .set(bearer('manager'))
      .send({ courseId: publishedCourseId, code: code('X'), name: { ar: 'م' }, capacity: 5, startsOn: '2026-12-01', endsOn: '2026-11-30' });
    expect(dates.status).toBe(400);
    expect(dates.body).toMatchObject({ code: 'date_range_invalid', startsOn: '2026-12-01', endsOn: '2026-11-30' });
    const base = { courseId: publishedCourseId, code: code('X'), name: { ar: 'م' }, capacity: 5 };
    const invalid: Record<string, unknown>[] = [
      { ...base, name: { en: 'no arabic' } },
      { ...base, code: 'HAS SPACE' },
      { ...base, capacity: 0 },
      { ...base, capacity: '5' },
      { ...base, capacity: 1.5 },
      { ...base, capacity: 40000 },
      { ...base, startsOn: '2026-02-30' },
      { ...base, status: 'open' },
      { ...base, courseId: 'nope' },
      { code: code('X'), name: { ar: 'م' }, capacity: 5 },
    ];
    for (const body of invalid) {
      const bad = await api().post(CLASSES).set(bearer('manager')).send(body);
      expect(bad.status, JSON.stringify(body)).toBe(400);
    }
    expect(await eventsSince(m2)).toEqual([]);
  });

  it('AC1 — classes.read alone sees only the assigned classes (list and detail, lead first); writes need classes.manage; the manager sees and filters everything', async () => {
    const mine = await createClass('V1');
    const shared = await createClass('V2');
    const other = await createClass('V3');
    // The assistant was assigned before the lead: the lead still comes first.
    await prisma.classTeacher.create({ data: { classId: shared.id, teacherUserId: fx['assistant']!, role: 'assistant', assignedAt: new Date('2026-01-01T00:00:00Z') } });
    await prisma.classTeacher.create({ data: { classId: shared.id, teacherUserId: fx['teacher']!, role: 'lead' } });
    await prisma.classTeacher.create({ data: { classId: mine.id, teacherUserId: fx['teacher']!, role: 'assistant' } });

    const asTeacher = await api().get(CLASSES).query({ q: `${PREFIX}-V`, limit: 50 }).set(bearer('teacher')).expect(200);
    expect(codes(asTeacher.body)).toEqual([code('V1'), code('V2')]);
    const asAssistant = await api().get(CLASSES).query({ q: `${PREFIX}-V` }).set(bearer('assistant')).expect(200);
    expect(codes(asAssistant.body)).toEqual([code('V2')]);
    const detail = await api().get(`${CLASSES}/${shared.id}`).set(bearer('teacher')).expect(200);
    expect(detail.body.teachers.map((teacher: { userId: string; role: string; fullName: string }) => [teacher.role, teacher.fullName])).toEqual([
      ['lead', 'Test teacher'],
      ['assistant', 'Test assistant'],
    ]);
    const hidden = await api().get(`${CLASSES}/${other.id}`).set(bearer('teacher'));
    expect(hidden.status).toBe(404);
    expect(hidden.body).toMatchObject({ code: 'class_not_found', classId: other.id });
    // A teacherId filter cannot widen the teacher's view.
    const widened = await api().get(CLASSES).query({ q: `${PREFIX}-V`, teacherId: fx['assistant'] }).set(bearer('teacher')).expect(200);
    expect(codes(widened.body)).toEqual([code('V2')]);

    const m = await mark();
    const writes = [
      () => api().post(CLASSES).set(bearer('teacher')).send({ courseId: publishedCourseId, code: code('W'), name: { ar: 'م' }, capacity: 5 }),
      () => api().patch(`${CLASSES}/${mine.id}`).set(bearer('teacher')).send({ capacity: 5 }),
      () => api().post(`${CLASSES}/${mine.id}/status`).set(bearer('teacher')).send({ action: 'open' }),
      () => api().delete(`${CLASSES}/${mine.id}`).set(bearer('teacher')),
    ];
    for (const write of writes) {
      const res = await write();
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'permission_denied', missing: ['classes.manage'] });
    }
    expect(await eventsSince(m)).toEqual([]);
    await api().get(CLASSES).set(bearer('outsider')).expect(403);
    await api().get(`${CLASSES}/${mine.id}`).set(bearer('outsider')).expect(403);
    await api().get(CLASSES).expect(401);

    const asManager = await api().get(CLASSES).query({ q: `${PREFIX}-V`, limit: 50 }).set(bearer('manager')).expect(200);
    expect(codes(asManager.body)).toEqual([code('V1'), code('V2'), code('V3')]);
    const byTeacher = await api().get(CLASSES).query({ q: PREFIX, teacherId: fx['assistant'] }).set(bearer('manager')).expect(200);
    expect(codes(byTeacher.body)).toEqual([code('V2')]);
    const byCourse = await api().get(CLASSES).query({ q: `${PREFIX}-V`, courseId: publishedCourseId }).set(bearer('manager')).expect(200);
    expect(codes(byCourse.body)).toHaveLength(3);
    await setStatus(other.id, 'open').expect(200);
    const byStatus = await api().get(CLASSES).query({ q: `${PREFIX}-V`, status: 'open' }).set(bearer('manager')).expect(200);
    expect(codes(byStatus.body)).toEqual([code('V3')]);
  });

  it('AC3 — the status machine: allowed transitions write one classes.status.changed each (with the reason); the others are 409 invalid_transition with the allowed actions', async () => {
    const klass = await createClass('S');
    const m = await mark();
    const opened = await setStatus(klass.id, 'open', '  التسجيل مفتوح  ').expect(200);
    expect(opened.body.status).toBe('open');
    const early = await setStatus(klass.id, 'complete');
    expect(early.status).toBe(409);
    expect(early.body).toMatchObject({ code: 'invalid_transition', from: 'open', action: 'complete', allowed: ['start', 'cancel'] });
    await setStatus(klass.id, 'start').expect(200);
    const completed = await setStatus(klass.id, 'complete').expect(200);
    expect(completed.body.status).toBe('completed');
    const terminal = await setStatus(klass.id, 'cancel');
    expect(terminal.body).toMatchObject({ code: 'invalid_transition', from: 'completed', action: 'cancel', allowed: [] });

    const other = await createClass('S2');
    await setStatus(other.id, 'restore').expect(409);
    await setStatus(other.id, 'cancel').expect(200);
    const restored = await setStatus(other.id, 'restore').expect(200);
    expect(restored.body.status).toBe('planned');
    await setStatus(other.id, 'delete').expect(400);
    await setStatus(other.id, 'open', 'x'.repeat(501)).expect(400);
    await api().post(`${CLASSES}/${NIL_ID}/status`).set(bearer('manager')).send({ action: 'open' }).expect(404);

    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.entityId, event.metadata])).toEqual([
      ['classes.status.changed', klass.id, { code: code('S'), action: 'open', from: 'planned', to: 'open', reason: 'التسجيل مفتوح' }],
      ['classes.status.changed', klass.id, { code: code('S'), action: 'start', from: 'open', to: 'running' }],
      ['classes.status.changed', klass.id, { code: code('S'), action: 'complete', from: 'running', to: 'completed', affectedEnrollments: 0 }],
      ['classes.created', other.id, { code: code('S2'), courseId: publishedCourseId, status: 'planned' }],
      ['classes.status.changed', other.id, { code: code('S2'), action: 'cancel', from: 'planned', to: 'cancelled', affectedEnrollments: 0 }],
      ['classes.status.changed', other.id, { code: code('S2'), action: 'restore', from: 'cancelled', to: 'planned' }],
    ]);
  });

  it('AC4 — complete and cancel move the active enrollments in the same transaction (one event with their count); restore does not reactivate them', async () => {
    const [first, second, third] = studentIds as [string, string, string];
    const running = await createClass('E1');
    await advance(running.id, 'open', 'start');
    const done1 = await enroll(running.id, first, 'active');
    const done2 = await enroll(running.id, second, 'active');
    const withdrawn = await enroll(running.id, third, 'withdrawn');
    expect((await api().get(`${CLASSES}/${running.id}`).set(bearer('manager')).expect(200)).body.enrolledCount).toBe(2);

    const m = await mark();
    const completed = await setStatus(running.id, 'complete').expect(200);
    expect(completed.body).toMatchObject({ status: 'completed', enrolledCount: 0 });
    const rows = await prisma.enrollment.findMany({ where: { classId: running.id }, select: { id: true, status: true, completedAt: true } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(done1)).toMatchObject({ status: 'completed' });
    expect(byId.get(done2)).toMatchObject({ status: 'completed' });
    expect(byId.get(done1)!.completedAt).toBeInstanceOf(Date);
    expect(byId.get(withdrawn)).toMatchObject({ status: 'withdrawn', completedAt: null });

    const open = await createClass('E2');
    await advance(open.id, 'open');
    const cancelledOne = await enroll(open.id, first, 'active');
    const m2 = await mark();
    await setStatus(open.id, 'cancel', 'لا مدرّس').expect(200);
    await setStatus(open.id, 'restore').expect(200);
    const after = await prisma.enrollment.findUniqueOrThrow({ where: { id: cancelledOne }, select: { status: true } });
    expect(after.status).toBe('cancelled');

    const events = await eventsSince(m);
    expect(events.filter((event) => event.id > m2).map((event) => event.metadata)).toEqual([
      { code: code('E2'), action: 'cancel', from: 'open', to: 'cancelled', reason: 'لا مدرّس', affectedEnrollments: 1 },
      { code: code('E2'), action: 'restore', from: 'cancelled', to: 'planned' },
    ]);
    expect(events[0]).toMatchObject({
      action: 'classes.status.changed',
      entityId: running.id,
      metadata: { code: code('E1'), action: 'complete', from: 'running', to: 'completed', affectedEnrollments: 2 },
    });
  });

  it('AC5 — PATCH writes only what changes (one classes.updated), clears with null, merges the date range, keeps the capacity at or above the active enrollments and refuses the rest', async () => {
    const [first, second, third] = studentIds as [string, string, string];
    const klass = await createClass('P', { capacity: 3, startsOn: '2026-11-10', notes: 'ملاحظة' });
    await advance(klass.id, 'open');
    await enroll(klass.id, first, 'active');
    await enroll(klass.id, second, 'active');
    await enroll(klass.id, third, 'withdrawn');

    const m = await mark();
    const below = await api().patch(`${CLASSES}/${klass.id}`).set(bearer('manager')).send({ capacity: 1 });
    expect(below.status).toBe(409);
    expect(below.body).toMatchObject({ code: 'capacity_below_enrolled', capacity: 1, enrolledCount: 2 });
    expect(await eventsSince(m)).toEqual([]);

    const res = await api()
      .patch(`${CLASSES}/${klass.id}`)
      .set(bearer('manager'))
      .send({ capacity: 2, notes: null, endsOn: '2026-12-01', name: { ar: 'فصل P' } })
      .expect(200);
    expect(res.body).toMatchObject({ capacity: 2, notes: null, endsOn: '2026-12-01', startsOn: '2026-11-10', enrolledCount: 2 });
    const events = await eventsSince(m);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'classes.updated', entityId: klass.id, metadata: { code: code('P'), fields: ['capacity', 'endsOn', 'notes'] } });

    const m2 = await mark();
    await api().patch(`${CLASSES}/${klass.id}`).set(bearer('manager')).send({ capacity: 2, notes: '  ' }).expect(200);
    const empty = await api().patch(`${CLASSES}/${klass.id}`).set(bearer('manager')).send({});
    expect(empty.body.code).toBe('nothing_to_update');
    const range = await api().patch(`${CLASSES}/${klass.id}`).set(bearer('manager')).send({ startsOn: '2026-12-02' });
    expect(range.body).toMatchObject({ code: 'date_range_invalid', startsOn: '2026-12-02', endsOn: '2026-12-01' });
    const taken = await api().patch(`${CLASSES}/${klass.id}`).set(bearer('manager')).send({ code: code('A') });
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ code: 'class_code_taken', classCode: code('A') });
    for (const body of [{ capacity: null }, { name: null }, { courseId: draftCourseId }, { status: 'running' }, { capacity: '4' }]) {
      const bad = await api().patch(`${CLASSES}/${klass.id}`).set(bearer('manager')).send(body);
      expect(bad.status, JSON.stringify(body)).toBe(400);
    }
    await api().patch(`${CLASSES}/${NIL_ID}`).set(bearer('manager')).send({ capacity: 3 }).expect(404);
    expect(await eventsSince(m2)).toEqual([]);
  });

  it('AC6 — only a planned class without any enrollment is deleted (its teachers with it); the others answer 409 class_not_deletable', async () => {
    const [first] = studentIds as [string];
    const planned = await createClass('D1');
    await prisma.classTeacher.create({ data: { classId: planned.id, teacherUserId: fx['teacher']!, role: 'lead' } });
    const withEnrollment = await createClass('D2');
    await enroll(withEnrollment.id, first, 'withdrawn');
    const opened = await createClass('D3');
    await advance(opened.id, 'open');

    const m = await mark();
    const refused = await api().delete(`${CLASSES}/${withEnrollment.id}`).set(bearer('manager'));
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'class_not_deletable', status: 'planned', enrollmentCount: 1 });
    const notPlanned = await api().delete(`${CLASSES}/${opened.id}`).set(bearer('manager'));
    expect(notPlanned.body).toMatchObject({ code: 'class_not_deletable', status: 'open', enrollmentCount: 0 });
    expect(await eventsSince(m)).toEqual([]);

    await api().delete(`${CLASSES}/${planned.id}`).set(bearer('manager')).expect(204);
    expect(await prisma.classTeacher.count({ where: { classId: planned.id } })).toBe(0);
    const events = await eventsSince(m);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'classes.deleted', entityId: planned.id, metadata: { code: code('D1') } });
    await api().delete(`${CLASSES}/${planned.id}`).set(bearer('manager')).expect(404);
  });

  it('AC7 — a draft course that still has classes is 409 course_in_use, not 500; without classes it is deleted', async () => {
    const course = await prisma.course.create({ data: { code: code('CR7'), name: { ar: 'دورة للحذف' }, status: 'published' }, select: { id: true } });
    await api().post(CLASSES).set(bearer('manager')).send({ courseId: course.id, code: code('C7'), name: { ar: 'م' }, capacity: 5 }).expect(201);
    await api().post(`/api/courses/${course.id}/status`).set(bearer('manager')).send({ action: 'unpublish' }).expect(200);

    const m = await mark();
    const refused = await api().delete(`/api/courses/${course.id}`).set(bearer('manager'));
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'course_in_use', classCount: 1 });
    expect(await prisma.course.count({ where: { id: course.id } })).toBe(1);
    expect(await eventsSince(m)).toEqual([]);

    const klass = await prisma.class.findUniqueOrThrow({ where: { code: code('C7') }, select: { id: true } });
    await api().delete(`${CLASSES}/${klass.id}`).set(bearer('manager')).expect(204);
    await api().delete(`/api/courses/${course.id}`).set(bearer('manager')).expect(204);
    expect((await eventsSince(m)).map((event) => event.action)).toEqual(['classes.deleted', 'courses.deleted']);
  });

  it('keyset pages are stable in both sorts, a foreign cursor is 400 cursor_invalid, and q matches codes and names literally', async () => {
    const tag = `T048-${RUN}`;
    for (const suffix of ['K1', 'K2', 'K3', 'K4', 'K5']) await createClass(suffix, { name: { ar: `${tag} فصل ${suffix}`, en: `${tag} 50% ${suffix}` } });
    const walk = async (query: Record<string, unknown>): Promise<string[]> => {
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const res = await api().get(CLASSES).query({ ...query, limit: 2, ...(cursor ? { cursor } : {}) }).set(bearer('manager')).expect(200);
        seen.push(...codes(res.body));
        if (!res.body.nextCursor) break;
        cursor = res.body.nextCursor;
      }
      return seen;
    };
    const expected = ['K1', 'K2', 'K3', 'K4', 'K5'].map(code);
    expect(await walk({ q: `${PREFIX}-K` })).toEqual(expected);
    expect(await walk({ q: `${PREFIX}-K`, order: 'desc' })).toEqual([...expected].reverse());
    expect(await walk({ q: `${PREFIX}-K`, sort: 'createdAt' })).toEqual([...expected].reverse());

    const first = await api().get(CLASSES).query({ q: `${PREFIX}-K`, limit: 2 }).set(bearer('manager')).expect(200);
    const foreign = await api().get(CLASSES).query({ q: `${PREFIX}-K`, limit: 2, sort: 'createdAt', cursor: first.body.nextCursor }).set(bearer('manager'));
    expect(foreign.status).toBe(400);
    expect(foreign.body.code).toBe('cursor_invalid');

    expect((await api().get(CLASSES).query({ q: `${PREFIX}-K%` }).set(bearer('manager')).expect(200)).body.items).toEqual([]);
    expect((await api().get(CLASSES).query({ q: `${PREFIX}_K` }).set(bearer('manager')).expect(200)).body.items).toEqual([]);
    const byArabic = await api().get(CLASSES).query({ q: `${tag} فصل K3` }).set(bearer('manager')).expect(200);
    expect(codes(byArabic.body)).toEqual([code('K3')]);
    const byEnglish = await api().get(CLASSES).query({ q: `${tag.toLowerCase()} 50% k4`, limit: 50 }).set(bearer('manager')).expect(200);
    expect(codes(byEnglish.body)).toEqual([code('K4')]);
    const wildcard = await api().get(CLASSES).query({ q: `${tag} 5_%` }).set(bearer('manager')).expect(200);
    expect(wildcard.body.items).toEqual([]);
  });

  it(
    'checks the Origin of writing requests and documents the routes in OpenAPI',
    async () => {
      const hostile = await api()
        .post(CLASSES)
        .set({ ...bearer('manager'), Origin: 'https://evil.example' })
        .send({ courseId: publishedCourseId, code: code('O'), name: { ar: 'م' }, capacity: 5 });
      expect(hostile.status).toBe(403);
      expect(hostile.body.code).toBe('origin_forbidden');
      expect(await prisma.class.count({ where: { code: code('O') } })).toBe(0);

      const docs = await api().get('/api/docs-json').expect(200);
      const paths = docs.body.paths as Record<string, Record<string, unknown>>;
      expect(Object.keys(paths['/api/classes'] ?? {}).sort()).toEqual(['get', 'post']);
      expect(Object.keys(paths['/api/classes/{id}'] ?? {}).sort()).toEqual(['delete', 'get', 'patch']);
      expect(Object.keys(paths['/api/classes/{id}/status'] ?? {})).toEqual(['post']);
      const schemas = docs.body.components.schemas as Record<string, unknown>;
      for (const name of ['ClassDto', 'ClassListDto', 'CreateClassDto', 'UpdateClassDto', 'ChangeClassStatusDto', 'ClassTeacherDto', 'ClassCourseDto']) {
        expect(schemas).toHaveProperty(name);
      }
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
