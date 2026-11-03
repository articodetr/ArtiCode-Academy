// TEST-050 — MOD-05-T04 enrollments (GET/POST /api/classes/:id/enrollments,
// POST /api/enrollments/:id/status), against the live development database.
// Skipped when no database is reachable. Fixture users, roles, the course,
// classes, teacher assignments and enrollments carry a unique prefix and are
// deleted at the end (their audit rows stay — KI-032). Classes are written
// with Prisma in the state each test needs (their API is TEST-048); teacher
// assignments too (TEST-049). Audit events are counted by fixture actor above
// an id watermark, as in TEST-030, so other clients of the shared dev DB never
// change the counts.
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
import type { ClassStatus, EnrollmentStatus, UserStatus } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `E${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-050 supertest';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const ENROLLMENT_KEYS = [
  'activatedAt',
  'classId',
  'completedAt',
  'createdAt',
  'enrolledAt',
  'id',
  'source',
  'status',
  'student',
  'updatedAt',
  'withdrawalReason',
  'withdrawnAt',
];
const STUDENT_KEYS = ['avatarUrl', 'deletedAt', 'displayName', 'email', 'fullName', 'fullNameLatin', 'id', 'phone', 'status', 'username'];

interface EnrollmentBody {
  id: string;
  classId: string;
  status: string;
  source: string;
  activatedAt: string | null;
  completedAt: string | null;
  withdrawnAt: string | null;
  withdrawalReason: string | null;
  student: { id: string; email: string | null };
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

/** Every key at any depth — responses must never carry a hash or a password field. */
function deepKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) deepKeys(item, keys);
  else if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      keys.push(key);
      deepKeys(inner, keys);
    }
  }
  return keys;
}

const available = DATABASE_URL ? await canConnect(DATABASE_URL) : false;

describe.skipIf(!available)('MOD-05 enrollments (e2e, TEST-050)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let courseId: string;
  let studentRoleId: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const students: Record<string, string> = {};
  const classes: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const actors = () => Object.values(fx);
  const roster = (classId: string) => `/api/classes/${classId}/enrollments`;
  const statusPath = (enrollmentId: string) => `/api/enrollments/${enrollmentId}/status`;

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

  /** A user who can be enrolled (or not): no password, the `student` role unless `role: false`. */
  async function createStudent(name: string, options: { status?: UserStatus; role?: boolean; deleted?: boolean } = {}): Promise<void> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Student ${name}`,
        status: options.status ?? 'active',
        deletedAt: options.deleted ? new Date() : null,
        roles: options.role === false ? undefined : { create: [{ roleId: studentRoleId }] },
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    students[name] = user.id;
  }

  async function createClass(suffix: string, status: ClassStatus, capacity: number): Promise<void> {
    const row = await prisma.class.create({
      data: { courseId, code: code(suffix), name: { ar: `فصل ${suffix}` }, capacity, status },
      select: { id: true },
    });
    classes[suffix] = row.id;
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

  const enroll = (classSuffix: string, studentName: string, as = 'manager') =>
    api().post(roster(classes[classSuffix]!)).set(bearer(as)).send({ studentId: students[studentName] });

  const act = (enrollmentId: string, action: string, reason?: string) =>
    api().post(statusPath(enrollmentId)).set(bearer('manager')).send(reason === undefined ? { action } : { action, reason });

  /** Sessions of this database waiting on a lock (the API and this client share the app role, so they are visible). */
  async function lockWaiters(): Promise<number> {
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
    return rows[0]?.n ?? 0;
  }

  /**
   * Runs `requests` while another transaction holds `FOR UPDATE` on the class
   * row, and releases it once `waiters` sessions wait on a lock (or after 3 s),
   * so the requests' transactions are all in flight together.
   */
  async function withClassRowHeld<T>(classId: string, waiters: number, requests: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const lockTaken = new Promise<void>((resolve) => (held = resolve));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM classes WHERE id = ${classId}::uuid FOR UPDATE`;
        held();
        await released;
      },
      { timeout: 10_000 },
    );
    await lockTaken;
    const pending = requests();
    const deadline = Date.now() + 3000;
    while ((await lockWaiters()) < waiters && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    release();
    await holder;
    return pending;
  }

  async function seed(classSuffix: string, studentName: string, status: EnrollmentStatus): Promise<string> {
    const row = await prisma.enrollment.create({
      data: { classId: classes[classSuffix]!, studentUserId: students[studentName]!, status },
      select: { id: true },
    });
    return row.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    studentRoleId = (await prisma.role.findUniqueOrThrow({ where: { key: 'student' }, select: { id: true } })).id;
    courseId = (
      await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة التسجيلات' }, status: 'published' }, select: { id: true } })
    ).id;

    // The manager sees contact fields (full projection); teachers do not.
    const manager = await createRole('enmanager', ['classes.read', 'classes.manage', 'enrollments.read', 'enrollments.manage', 'users.read_contact']);
    const teacher = await createRole('enteacher', ['classes.read', 'enrollments.read']);
    const outsider = await createRole('enoutsider', ['classes.read']);
    await createUser('manager', [manager]);
    await createUser('teacher', [teacher]);
    await createUser('stranger', [teacher]);
    await createUser('outsider', [outsider]);
    for (const name of ['manager', 'teacher', 'stranger', 'outsider']) tokens[name] = await login(email(name));

    for (const index of [1, 2, 3, 4, 5, 6, 7, 8, 9]) await createStudent(`s${index}`);
    await createStudent('invited', { status: 'invited' });
    await createStudent('suspended', { status: 'suspended' });
    await createStudent('norole', { role: false });
    await createStudent('deleted', { status: 'archived', deleted: true });

    await createClass('A', 'open', 3);
    await createClass('P', 'planned', 5);
    await createClass('F', 'open', 1);
    await createClass('R', 'running', 1);
    await prisma.classTeacher.create({ data: { classId: classes['A']!, teacherUserId: fx['teacher']!, role: 'lead' } });
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

  it('AC4 — enrolls a student straight to active with the creator and exactly one enrollments.created; refuses the rest without a write or an event', async () => {
    const m = await mark();
    const res = await enroll('A', 's1').expect(201);
    const body = res.body as EnrollmentBody;
    expect(Object.keys(body).sort()).toEqual(ENROLLMENT_KEYS);
    expect(Object.keys(res.body.student).sort()).toEqual(STUDENT_KEYS);
    expect(body).toMatchObject({ classId: classes['A'], status: 'active', source: 'admin', completedAt: null, withdrawnAt: null, withdrawalReason: null });
    expect(body.activatedAt).not.toBeNull();
    expect(body.student).toMatchObject({ id: students['s1'], email: email('s1') });
    expect(deepKeys(res.body).filter((key) => /hash|password/i.test(key))).toEqual([]);
    const row = await prisma.enrollment.findUniqueOrThrow({ where: { id: body.id }, select: { createdById: true, status: true } });
    expect(row).toEqual({ createdById: fx['manager'], status: 'active' });

    // An invited student is eligible too.
    const invited = await enroll('A', 'invited').expect(201);
    const events = await eventsSince(m);
    expect(events.map((event) => event.action)).toEqual(['enrollments.created', 'enrollments.created']);
    expect(events[0]).toMatchObject({ entityType: 'enrollments', entityId: body.id, actorUserId: fx['manager'] });
    expect(events[0]!.metadata).toEqual({ classId: classes['A'], classCode: code('A'), studentUserId: students['s1'], status: 'active', source: 'admin' });
    expect(events[1]!.entityId).toBe(invited.body.id);

    // The class detail of T02 counts the active enrollments.
    const detail = await api().get(`/api/classes/${classes['A']}`).set(bearer('manager')).expect(200);
    expect(detail.body.enrolledCount).toBe(2);

    const refusal = await mark();
    const again = await enroll('A', 's1').expect(409);
    expect(again.body).toMatchObject({ code: 'already_enrolled', enrollmentId: body.id, status: 'active' });
    expect((await enroll('A', 'norole').expect(422)).body).toMatchObject({ code: 'not_a_student', userId: students['norole'] });
    expect((await enroll('A', 'suspended').expect(422)).body).toMatchObject({ code: 'user_not_eligible', status: 'suspended' });
    expect((await enroll('A', 'deleted').expect(404)).body).toMatchObject({ code: 'user_not_found', userId: students['deleted'] });
    const unknownStudent = await api().post(roster(classes['A']!)).set(bearer('manager')).send({ studentId: NIL_ID }).expect(404);
    expect(unknownStudent.body.code).toBe('user_not_found');
    const unknownClass = await api().post(roster(NIL_ID)).set(bearer('manager')).send({ studentId: students['s2'] }).expect(404);
    expect(unknownClass.body).toMatchObject({ code: 'class_not_found', classId: NIL_ID });
    await api().post(roster(classes['A']!)).set(bearer('manager')).send({}).expect(400);
    await api().post(roster(classes['A']!)).set(bearer('manager')).send({ studentId: 'not-a-uuid' }).expect(400);
    await api().post(roster(classes['A']!)).set(bearer('manager')).send({ studentId: students['s2'], status: 'completed' }).expect(400);
    await api().post(roster('not-a-uuid')).set(bearer('manager')).send({ studentId: students['s2'] }).expect(400);
    expect(await eventsSince(refusal)).toHaveLength(0);
    expect(await prisma.enrollment.count({ where: { classId: classes['A'] } })).toBe(2);
  });

  it('AC2 — a class that is neither open nor running is 409 class_not_enrollable', async () => {
    const m = await mark();
    const res = await enroll('P', 's2').expect(409);
    expect(res.body).toMatchObject({ code: 'class_not_enrollable', status: 'planned' });
    for (const status of ['completed', 'cancelled'] as const) {
      await prisma.class.update({ where: { id: classes['P']! }, data: { status } });
      expect((await enroll('P', 's2').expect(409)).body).toMatchObject({ code: 'class_not_enrollable', status });
    }
    await prisma.class.update({ where: { id: classes['P']! }, data: { status: 'planned' } });
    expect(await eventsSince(m)).toHaveLength(0);
    expect(await prisma.enrollment.count({ where: { classId: classes['P'] } })).toBe(0);
  });

  it('AC3 — the capacity is hard: a full class is 409 class_full, and concurrent requests for the last seat let exactly one through', async () => {
    const m = await mark();
    await enroll('F', 's2').expect(201);
    const full = await enroll('F', 's3').expect(409);
    expect(full.body).toMatchObject({ code: 'class_full', capacity: 1, enrolledCount: 1 });
    expect((await eventsSince(m)).map((event) => event.action)).toEqual(['enrollments.created']);

    // Four students race for the single seat of class R. Requests through the
    // HTTP pipeline rarely overlap on their own, so the test holds FOR UPDATE
    // on the class row until all four transactions wait on it: with the
    // FOR NO KEY UPDATE lock of the service they then run one after the
    // other; without it they would all count zero, block only at the
    // insert's foreign-key lock, and all four would get the seat.
    const race = await mark();
    const results = await withClassRowHeld(classes['R']!, 4, () => Promise.all(['s4', 's5', 's6', 's7'].map((name) => enroll('R', name))));
    const statuses = results.map((res) => res.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409]);
    for (const res of results.filter((r) => r.status === 409)) expect(res.body).toMatchObject({ code: 'class_full', capacity: 1, enrolledCount: 1 });
    expect(await prisma.enrollment.count({ where: { classId: classes['R'], status: 'active' } })).toBe(1);
    expect(await prisma.enrollment.count({ where: { classId: classes['R'] } })).toBe(1);
    const events = await eventsSince(race);
    expect(events.map((event) => event.action)).toEqual(['enrollments.created']);
    expect(events[0]!.entityId).toBe(results.find((res) => res.status === 201)!.body.id);
  });

  it('AC5 — the enrollment actions write one enrollments.status.changed each; the rest is 409 invalid_transition with the allowed actions', async () => {
    const id = (await enroll('A', 's8').expect(201)).body.id as string;
    const m = await mark();

    const withdrawn = await act(id, 'withdraw', '  moved away  ').expect(200);
    expect(withdrawn.body).toMatchObject({ id, status: 'withdrawn', withdrawalReason: 'moved away' });
    expect(withdrawn.body.withdrawnAt).not.toBeNull();
    const repeat = await act(id, 'withdraw').expect(409);
    expect(repeat.body).toMatchObject({ code: 'invalid_transition', from: 'withdrawn', action: 'withdraw', allowed: ['reactivate'] });

    const reactivated = await act(id, 'reactivate').expect(200);
    expect(reactivated.body).toMatchObject({ status: 'active', withdrawnAt: null, withdrawalReason: null, completedAt: null });
    expect(new Date(reactivated.body.activatedAt as string).getTime()).toBeGreaterThanOrEqual(new Date(withdrawn.body.withdrawnAt as string).getTime());

    const completed = await act(id, 'complete').expect(200);
    expect(completed.body.status).toBe('completed');
    expect(completed.body.completedAt).not.toBeNull();
    const final = await act(id, 'reactivate').expect(409);
    expect(final.body).toMatchObject({ code: 'invalid_transition', from: 'completed', allowed: [] });

    const cancelId = (await enroll('A', 's9').expect(201)).body.id as string;
    expect((await act(cancelId, 'cancel', 'entered by mistake').expect(200)).body.status).toBe('cancelled');

    const events = await eventsSince(m);
    expect(events.map((event) => event.action)).toEqual([
      'enrollments.status.changed',
      'enrollments.status.changed',
      'enrollments.status.changed',
      'enrollments.created',
      'enrollments.status.changed',
    ]);
    expect(events[0]).toMatchObject({ entityType: 'enrollments', entityId: id });
    expect(events[0]!.metadata).toEqual({
      classId: classes['A'],
      classCode: code('A'),
      studentUserId: students['s8'],
      action: 'withdraw',
      from: 'active',
      to: 'withdrawn',
      reason: 'moved away',
    });
    expect(events[1]!.metadata).toMatchObject({ action: 'reactivate', from: 'withdrawn', to: 'active' });
    expect(events[1]!.metadata).not.toHaveProperty('reason');
    expect(events[4]!.metadata).toMatchObject({ action: 'cancel', from: 'active', to: 'cancelled', reason: 'entered by mistake' });

    const refusal = await mark();
    await act(id, 'archive').expect(400);
    await act(id, 'withdraw', 'x'.repeat(501)).expect(400);
    expect((await act(NIL_ID, 'withdraw').expect(404)).body).toMatchObject({ code: 'enrollment_not_found', enrollmentId: NIL_ID });
    expect(await eventsSince(refusal)).toHaveLength(0);
  });

  it('AC5 — reactivate checks the class like a new enrollment: class_full on a full class, class_not_enrollable on a planned one', async () => {
    // F holds s2 (active, capacity 1) since AC3; P is planned.
    const onFull = await seed('F', 's3', 'withdrawn');
    const onPlanned = await seed('P', 's4', 'cancelled');
    const m = await mark();
    expect((await act(onFull, 'reactivate').expect(409)).body).toMatchObject({ code: 'class_full', capacity: 1, enrolledCount: 1 });
    expect((await act(onPlanned, 'reactivate').expect(409)).body).toMatchObject({ code: 'class_not_enrollable', status: 'planned' });
    expect(await eventsSince(m)).toHaveLength(0);
    expect((await prisma.enrollment.findUniqueOrThrow({ where: { id: onFull }, select: { status: true } })).status).toBe('withdrawn');

    // Once the seat is free again, the reactivation goes through.
    await prisma.class.update({ where: { id: classes['F']! }, data: { capacity: 2 } });
    expect((await act(onFull, 'reactivate').expect(200)).body.status).toBe('active');
  });

  it('AC1 — writes need enrollments.manage; the roster is for enrollment managers and assigned teachers only, in the caller’s projection', async () => {
    const m = await mark();
    const denied = await enroll('A', 's3', 'teacher').expect(403);
    expect(denied.body.code).toBe('permission_denied');
    const enrollmentId = (await prisma.enrollment.findFirstOrThrow({ where: { classId: classes['A'] }, select: { id: true } })).id;
    await api().post(statusPath(enrollmentId)).set(bearer('teacher')).send({ action: 'withdraw' }).expect(403);
    expect(await eventsSince(m)).toHaveLength(0);

    // The assigned teacher reads the roster without contact fields.
    const teacherView = await api().get(roster(classes['A']!)).set(bearer('teacher')).expect(200);
    expect(teacherView.body.items.length).toBeGreaterThan(0);
    for (const item of teacherView.body.items as EnrollmentBody[]) {
      expect(item.classId).toBe(classes['A']);
      expect(item.student.email).toBeNull();
    }
    expect(deepKeys(teacherView.body).filter((key) => /hash|password/i.test(key))).toEqual([]);

    // A teacher of another class and a caller without enrollments.read do not.
    expect((await api().get(roster(classes['A']!)).set(bearer('stranger')).expect(404)).body).toMatchObject({ code: 'class_not_found' });
    expect((await api().get(roster(classes['A']!)).set(bearer('outsider')).expect(403)).body.code).toBe('permission_denied');
    expect((await api().get(roster(NIL_ID)).set(bearer('manager')).expect(404)).body.code).toBe('class_not_found');

    // The manager reads any roster with contact fields, filters and pages it.
    const all = await api().get(roster(classes['A']!)).set(bearer('manager')).expect(200);
    const ids = (all.body.items as EnrollmentBody[]).map((item) => item.id);
    expect(ids).toEqual([...ids].sort());
    expect((all.body.items as EnrollmentBody[]).every((item) => item.student.email !== null)).toBe(true);
    expect(all.body.nextCursor).toBeNull();
    const active = await api().get(roster(classes['A']!)).query({ status: 'active' }).set(bearer('manager')).expect(200);
    expect((active.body.items as EnrollmentBody[]).every((item) => item.status === 'active')).toBe(true);
    expect(active.body.items.length).toBeLessThan(ids.length);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await api()
        .get(roster(classes['A']!))
        .query(cursor ? { limit: 1, cursor } : { limit: 1 })
        .set(bearer('manager'))
        .expect(200);
      expect(page.body.items.length).toBeLessThanOrEqual(1);
      seen.push(...(page.body.items as EnrollmentBody[]).map((item) => item.id));
      cursor = page.body.nextCursor as string | null;
    } while (cursor !== null);
    expect(seen).toEqual(ids);

    const foreign = await api().get('/api/classes').query({ limit: 1 }).set(bearer('manager')).expect(200);
    if (foreign.body.nextCursor) {
      const bad = await api().get(roster(classes['A']!)).query({ cursor: foreign.body.nextCursor }).set(bearer('manager')).expect(400);
      expect(bad.body.code).toBe('cursor_invalid');
    }
    await api().get(roster(classes['A']!)).query({ status: 'waiting' }).set(bearer('manager')).expect(400);
    await api().get(roster(classes['A']!)).query({ limit: 101 }).set(bearer('manager')).expect(400);
  });

  it(
    'checks the Origin of writing requests and documents the routes in OpenAPI',
    async () => {
      const hostile = await api()
        .post(roster(classes['A']!))
        .set({ ...bearer('manager'), Origin: 'https://evil.example' })
        .send({ studentId: students['s3'] });
      expect(hostile.status).toBe(403);
      expect(hostile.body.code).toBe('origin_forbidden');
      expect(await prisma.enrollment.count({ where: { classId: classes['A'], studentUserId: students['s3'] } })).toBe(0);

      const docs = await api().get('/api/docs-json').expect(200);
      const paths = docs.body.paths as Record<string, Record<string, unknown>>;
      expect(Object.keys(paths['/api/classes/{id}/enrollments'] ?? {}).sort()).toEqual(['get', 'post']);
      expect(Object.keys(paths['/api/enrollments/{id}/status'] ?? {})).toEqual(['post']);
      const schemas = docs.body.components.schemas as Record<string, unknown>;
      for (const name of ['EnrollmentDto', 'EnrollmentListDto', 'EnrollmentStudentDto', 'CreateEnrollmentDto', 'ChangeEnrollmentStatusDto']) {
        expect(schemas).toHaveProperty(name);
      }
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
