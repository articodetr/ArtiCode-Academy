// TEST-125 — MOD-08-T04 «my assignments» (API-112) against the live
// development database. Skipped when no database is reachable. Fixture users
// (a teacher with the system `teacher` role, students with `student`, a
// guardian with `guardian` and a linked user without it), roles, a published
// course, classes, enrollments, assignments and submissions carry a unique
// prefix and are deleted at the end — enrollments first (they restrict their
// class), then the classes (assignments and submissions cascade), the course,
// the users (their guardian links cascade) and the roles.
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
const PREFIX = `M${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-125 supertest';
const CLASSES = '/api/classes';
const ASSIGNMENTS = '/api/assignments';
const MY_ASSIGNMENTS = '/api/me/assignments';
const ITEM_KEYS = [
  'allowLate',
  'attempts',
  'attemptsAllowed',
  'class',
  'closedAt',
  'dueAt',
  'id',
  'instructions',
  'latePenaltyPercent',
  'latest',
  'lesson',
  'maxAttempts',
  'maxScore',
  'publishedAt',
  'relation',
  'status',
  'student',
  'timeZone',
  'title',
];

interface ItemBody {
  id: string;
  status: string;
  dueAt: string | null;
  relation: string;
  student: { id: string; fullName: string; displayName: string | null };
  attempts: number;
  attemptsAllowed: number;
  latest: { id: string; attemptNo: number; status: string; score: number | null; feedback: string | null } | null;
  class: { id: string };
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

describe.skipIf(!available)('MOD-08 «my assignments» (e2e, TEST-125)', () => {
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
  const assignments: Record<string, string> = {};

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name.toLowerCase()}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  const mine = (as: string, query: Record<string, string> = {}) => api().get(MY_ASSIGNMENTS).query(query).set(bearer(as));
  const names = (items: ItemBody[]) => items.map((item) => Object.keys(assignments).find((key) => assignments[key] === item.id));
  const pairs = (items: ItemBody[]) => items.map((item) => `${Object.keys(assignments).find((key) => assignments[key] === item.id)}:${Object.keys(fx).find((key) => fx[key] === item.student.id)}`);

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
  }

  async function createClass(suffix: string): Promise<void> {
    const res = await api().post(CLASSES).set(bearer('manager')).send({ courseId, code: code(suffix), name: { ar: `فصل ${suffix}` }, capacity: 10 }).expect(201);
    classes[suffix] = res.body.id as string;
    await api().put(`${CLASSES}/${classes[suffix]}/teachers`).set(bearer('manager')).send({ teachers: [{ userId: id('teacher'), role: 'lead' }] }).expect(200);
    await api().post(`${CLASSES}/${classes[suffix]}/status`).set(bearer('manager')).send({ action: 'open' }).expect(200);
  }

  async function enroll(suffix: string, student: string, status: EnrollmentStatus = 'active'): Promise<void> {
    await prisma.enrollment.create({ data: { classId: classes[suffix]!, studentUserId: id(student), status, activatedAt: new Date() }, select: { id: true } });
  }

  async function createAssignment(name: string, suffix: string, dueAt: string | null, actions: string[] = ['publish']): Promise<void> {
    const res = await api()
      .post(`${CLASSES}/${classes[suffix]}/assignments`)
      .set(bearer('manager'))
      .send({ title: { ar: `واجب ${name}` }, maxScore: 20, weight: 10, ...(dueAt ? { dueAt } : {}) })
      .expect(201);
    assignments[name] = res.body.id as string;
    for (const action of actions) await api().post(`${ASSIGNMENTS}/${assignments[name]}/status`).set(bearer('manager')).send({ action }).expect(200);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    academyTimeZone = (await prisma.academy.findFirstOrThrow({ select: { timezone: true } })).timezone;

    courseId = (await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة واجباتي' }, status: 'published' }, select: { id: true } })).id;
    const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
    const manager = await createRole('mmanager', ['classes.read', 'classes.manage', 'classes.teachers.assign', 'assignments.read', 'assignments.manage', 'assignments.grade']);
    const outsider = await createRole('moutsider', ['courses.read']);
    await createUser('manager', [manager]);
    await createUser('teacher', [await systemRole('teacher')]);
    for (const student of ['s1', 's2', 's3']) await createUser(student, [await systemRole('student')]);
    await createUser('guardian', [await systemRole('guardian')]);
    await createUser('linkedNoRole', [outsider]);
    for (const [guardian, student] of [['guardian', 's1'], ['guardian', 's2'], ['linkedNoRole', 's1']] as const) {
      await prisma.guardianStudent.create({ data: { guardianUserId: id(guardian), studentUserId: id(student), relationship: 'mother' }, select: { studentUserId: true } });
    }

    await createClass('A');
    await createClass('B');
    await createClass('C');
    await enroll('A', 's1');
    await enroll('A', 's2');
    await enroll('A', 's3', 'withdrawn');
    await enroll('B', 's2');
    await enroll('C', 's1', 'completed');

    await createAssignment('A1', 'A', '2026-12-01T10:00:00Z');
    await createAssignment('A2', 'A', '2026-12-05T10:00:00Z');
    await createAssignment('A3', 'A', '2026-12-02T10:00:00Z', []); // draft — never listed
    await createAssignment('A4', 'A', null, ['publish', 'close']);
    await createAssignment('B1', 'B', '2026-12-03T10:00:00Z');
    await createAssignment('C1', 'C', '2026-11-30T10:00:00Z');

    // s1 submits A1 and is graded with feedback; s2 submits A2.
    const sub = await api().post(`${ASSIGNMENTS}/${assignments['A1']}/submissions`).set(bearer('s1')).send({ textAnswer: 'إجابة s1' }).expect(201);
    await api().post(`/api/submissions/${sub.body.id}/review`).set(bearer('manager')).send({ action: 'grade', score: 16, feedback: 'أحسنت' }).expect(200);
    await api().post(`${ASSIGNMENTS}/${assignments['A2']}/submissions`).set(bearer('s2')).send({ linkUrl: 'https://docs.example.com/s2' }).expect(201);
  });

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

  it('AC1 — a student sees the open and closed assignments of their current and finished classes (no draft, no other class) with their own latest attempt and its review', async () => {
    const res = await mine('s1');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = res.body.items as ItemBody[];
    expect(names(items)).toEqual(['C1', 'A1', 'A2', 'A4']); // by due date, undated last; A3 is a draft, B1 another class
    expect(res.body.nextCursor).toBeNull();
    expect(Object.keys(items[0]!).sort()).toEqual([...ITEM_KEYS].sort());
    expect(items.every((item) => item.relation === 'self' && item.student.id === id('s1'))).toBe(true);
    const a1 = items[1]!;
    expect(a1).toMatchObject({
      status: 'open',
      dueAt: '2026-12-01T10:00:00.000Z',
      attempts: 1,
      attemptsAllowed: 1,
      latest: { attemptNo: 1, status: 'graded', score: 16, feedback: 'أحسنت' },
      student: { id: id('s1'), fullName: 'Test s1', displayName: null },
    });
    expect(a1).toMatchObject({ timeZone: academyTimeZone, maxScore: 20, allowLate: false });
    expect(items[2]).toMatchObject({ latest: null, attempts: 0 });
    expect(items[3]).toMatchObject({ status: 'closed', dueAt: null });
    const serialized = JSON.stringify(res.body);
    for (const forbidden of ['weight', 'gradedBy', 'textAnswer', 'linkUrl', 'createdBy', 'إجابة s1']) expect(serialized).not.toContain(forbidden);
  });

  it('AC2 — a guardian with the role sees each child’s items (one per assignment and child, nobody else’s attempt); links without the role, a withdrawn student and a teacher see nothing', async () => {
    const items = (await mine('guardian').expect(200)).body.items as ItemBody[];
    expect(items.every((item) => item.relation === 'child')).toBe(true);
    const sortedChildren = [id('s1'), id('s2')].sort();
    const first = sortedChildren[0] === id('s1') ? 's1' : 's2';
    const second = first === 's1' ? 's2' : 's1';
    expect(pairs(items)).toEqual(['C1:s1', `A1:${first}`, `A1:${second}`, 'B1:s2', `A2:${first}`, `A2:${second}`, `A4:${first}`, `A4:${second}`]);
    const s2OnA1 = items.find((item) => item.id === assignments['A1'] && item.student.id === id('s2'))!;
    expect(s2OnA1.latest).toBeNull(); // s1's submission never shows on s2's item
    expect(items.find((item) => item.id === assignments['A2'] && item.student.id === id('s2'))!.latest).toMatchObject({ status: 'submitted' });
    expect(pairs((await mine('guardian', { studentId: id('s2') }).expect(200)).body.items)).toEqual(['A1:s2', 'B1:s2', 'A2:s2', 'A4:s2']);
    for (const nobody of ['linkedNoRole', 's3', 'teacher', 'manager']) {
      const res = await mine(nobody);
      expect(res.status, nobody).toBe(200);
      expect(res.body, nobody).toEqual({ items: [], nextCursor: null });
    }
    expect((await api().get(MY_ASSIGNMENTS)).status).toBe(401);
  });

  it('AC3 — filters (status, pending, class, student, due range) and keyset pages in both orders; invalid queries are 400', async () => {
    expect(names((await mine('s1', { status: 'closed' }).expect(200)).body.items)).toEqual(['A4']);
    expect(names((await mine('s1', { pending: 'true' }).expect(200)).body.items)).toEqual(['C1', 'A2', 'A4']);
    expect(names((await mine('s1', { pending: 'false' }).expect(200)).body.items)).toEqual(['C1', 'A1', 'A2', 'A4']);
    // Pending for a guardian: the item of the child who submitted is dropped, the other child's kept.
    const pending = (await mine('guardian', { pending: 'true', classId: classes['A']! }).expect(200)).body.items as ItemBody[];
    expect(pending.filter((item) => item.id === assignments['A1']).map((item) => item.student.id)).toEqual([id('s2')]);
    expect(pending.filter((item) => item.id === assignments['A2']).map((item) => item.student.id)).toEqual([id('s1')]);
    expect((await mine('s1', { classId: classes['B']! }).expect(200)).body.items).toEqual([]); // a class s1 does not own
    expect((await mine('s1', { studentId: id('s2') }).expect(200)).body.items).toEqual([]); // a student s1 does not own
    expect(names((await mine('s1', { dueFrom: '2026-12-01T00:00:00Z', dueTo: '2026-12-04T23:59:59Z' }).expect(200)).body.items)).toEqual(['A1']);

    async function pages(as: string, query: Record<string, string>): Promise<string[]> {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const res = await mine(as, { limit: '1', ...query, ...(cursor ? { cursor } : {}) }).expect(200);
        seen.push(...pairs(res.body.items as ItemBody[]));
        cursor = res.body.nextCursor as string | null;
      } while (cursor);
      return seen;
    }
    expect(await pages('s1', {})).toEqual(['C1:s1', 'A1:s1', 'A2:s1', 'A4:s1']);
    expect(await pages('s1', { order: 'desc' })).toEqual(['A2:s1', 'A1:s1', 'C1:s1', 'A4:s1']);
    expect((await mine('guardian', { limit: '1' }).expect(200)).body.items).toHaveLength(1); // C1 — only s1 owns class C

    expect((await mine('s1', { cursor: 'garbage' })).body).toMatchObject({ code: 'cursor_invalid' });
    const badQueries: Record<string, string>[] = [{ status: 'draft' }, { pending: 'yes' }, { studentId: 'x' }, { dueFrom: '2026-12-01' }, { limit: '0' }, { order: 'up' }];
    for (const query of badQueries) {
      expect((await mine('s1', query)).status, JSON.stringify(query)).toBe(400);
    }
  });

  it(
    'documents the route in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths['/api/me/assignments'])).toEqual(['get']);
      for (const schema of ['MyAssignmentListDto', 'MyAssignmentItemDto', 'MyAssignmentLatestDto']) expect(docs.body.components.schemas).toHaveProperty(schema);
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
