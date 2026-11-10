// TEST-130 — MOD-09-T04 «my exams» (API-121) against the live development
// database. Skipped when no database is reachable. Fixture users (a manager, a
// teacher, students, a guardian with the system role linked to two of them, a
// linked user without the role), roles, a published course, classes,
// enrollments, exams and results (through the API) carry a unique prefix and
// are deleted at the end.
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
const PREFIX = `Y${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-130 supertest';
const CLASSES = '/api/classes';
const EXAMS = '/api/exams';
const MY_EXAMS = '/api/me/exams';
const ITEM_KEYS = ['class', 'description', 'durationMinutes', 'id', 'lesson', 'maxScore', 'passScore', 'publishedAt', 'relation', 'result', 'scheduledAt', 'status', 'student', 'timeZone', 'title', 'type'];

interface ItemBody {
  id: string;
  status: string;
  relation: string;
  student: { id: string };
  result: { status: string; score: number | null; feedback: string | null } | null;
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

describe.skipIf(!available)('MOD-09 «my exams» (e2e, TEST-130)', () => {
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

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name.toLowerCase()}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  const mine = (as: string, query: Record<string, string> = {}) => api().get(MY_EXAMS).query(query).set(bearer(as));
  const pairs = (items: ItemBody[]) => items.map((entry) => `${Object.keys(exams).find((key) => exams[key] === entry.id)}:${Object.keys(fx).find((key) => fx[key] === entry.student.id)}`);
  const names = (items: ItemBody[]) => items.map((entry) => Object.keys(exams).find((key) => exams[key] === entry.id));

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

  async function classAction(suffix: string, action: string): Promise<void> {
    await api().post(`${CLASSES}/${classes[suffix]}/status`).set(bearer('manager')).send({ action }).expect(200);
  }

  async function createClass(suffix: string): Promise<void> {
    const res = await api().post(CLASSES).set(bearer('manager')).send({ courseId, code: code(suffix), name: { ar: `فصل ${suffix}` }, capacity: 10 }).expect(201);
    classes[suffix] = res.body.id as string;
    await api().put(`${CLASSES}/${classes[suffix]}/teachers`).set(bearer('manager')).send({ teachers: [{ userId: id('teacher'), role: 'lead' }] }).expect(200);
    await classAction(suffix, 'open');
  }

  async function enroll(suffix: string, student: string, status: EnrollmentStatus = 'active'): Promise<void> {
    await prisma.enrollment.create({ data: { classId: classes[suffix]!, studentUserId: id(student), status, activatedAt: new Date() }, select: { id: true } });
  }

  async function createExam(name: string, suffix: string, scheduledAt: string | null, actions: string[], results: object[] = []): Promise<void> {
    const res = await api()
      .post(`${CLASSES}/${classes[suffix]}/exams`)
      .set(bearer('teacher'))
      .send({ title: { ar: `اختبار ${name}` }, type: 'quiz', maxScore: 20, weight: 25, ...(scheduledAt ? { scheduledAt } : {}) })
      .expect(201);
    exams[name] = res.body.id as string;
    if (actions.includes('schedule')) await api().post(`${EXAMS}/${exams[name]}/status`).set(bearer('teacher')).send({ action: 'schedule' }).expect(200);
    if (results.length > 0) await api().put(`${EXAMS}/${exams[name]}/results`).set(bearer('teacher')).send({ results }).expect(200);
    if (actions.includes('publish')) await api().post(`${EXAMS}/${exams[name]}/status`).set(bearer('teacher')).send({ action: 'publish' }).expect(200);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    courseId = (await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة اختباراتي' }, status: 'published' }, select: { id: true } })).id;
    const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
    await createUser('manager', [await createRole('ymanager', ['classes.read', 'classes.manage', 'classes.teachers.assign', 'exams.read', 'exams.manage', 'exams.grade'])]);
    await createUser('teacher', [await systemRole('teacher')]);
    for (const student of ['s1', 's2']) await createUser(student, [await systemRole('student')]);
    await createUser('guardian', [await systemRole('guardian')]);
    await createUser('linkedNoRole', [await createRole('youtsider', ['courses.read'])]);
    for (const [guardian, student] of [['guardian', 's1'], ['guardian', 's2'], ['linkedNoRole', 's1']] as const) {
      await prisma.guardianStudent.create({ data: { guardianUserId: id(guardian), studentUserId: id(student), relationship: 'mother' }, select: { studentUserId: true } });
    }

    await createClass('A');
    await createClass('B');
    await createClass('C');
    await enroll('A', 's1');
    await enroll('A', 's2');
    await enroll('B', 's2');
    await enroll('C', 's1');
    await createExam('A1', 'A', '2030-01-10T08:00:00Z', ['schedule'], [{ studentId: id('s1'), status: 'scored', score: 11 }]); // results not published
    await createExam('A2', 'A', '2030-01-20T08:00:00Z', ['schedule', 'publish'], [
      { studentId: id('s1'), status: 'scored', score: 18, feedback: 'ممتاز' },
      { studentId: id('s2'), status: 'absent' },
    ]);
    await createExam('A3', 'A', '2030-01-05T08:00:00Z', []); // draft — never listed
    await createExam('B1', 'B', '2030-01-15T08:00:00Z', ['schedule', 'publish']);
    await createExam('C1', 'C', null, ['schedule']);
    await classAction('C', 'start');
    await classAction('C', 'complete'); // s1's enrollment becomes completed: still owned
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

  it('AC1 — a student sees the scheduled and published exams of their current and finished classes (no draft), with their own result only once published', async () => {
    const res = await mine('s1');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = res.body.items as ItemBody[];
    expect(names(items)).toEqual(['A1', 'A2', 'C1']); // by date, undated last; A3 is a draft, B1 another class
    expect(Object.keys(items[0]!).sort()).toEqual(ITEM_KEYS);
    expect(items.every((entry) => entry.relation === 'self' && entry.student.id === id('s1'))).toBe(true);
    expect(items[0]).toMatchObject({ status: 'scheduled', result: null }); // recorded, not published
    expect(items[1]).toMatchObject({ status: 'published', result: { status: 'scored', score: 18, feedback: 'ممتاز' } });
    expect(items[2]).toMatchObject({ status: 'scheduled', scheduledAt: null, result: null });
    const serialized = JSON.stringify(res.body);
    for (const forbidden of ['weight', 'recordedBy', 'createdBy']) expect(serialized).not.toContain(forbidden);
    expect(serialized).not.toContain('"score":11'); // the unpublished result never leaks
  });

  it('AC2 — a guardian with the role sees each child’s items (nobody else’s result); a link without the role, a teacher and a manager see nothing', async () => {
    const items = (await mine('guardian').expect(200)).body.items as ItemBody[];
    expect(items.every((entry) => entry.relation === 'child')).toBe(true);
    const sorted = [id('s1'), id('s2')].sort();
    const first = sorted[0] === id('s1') ? 's1' : 's2';
    const second = first === 's1' ? 's2' : 's1';
    expect(pairs(items)).toEqual([`A1:${first}`, `A1:${second}`, 'B1:s2', `A2:${first}`, `A2:${second}`, 'C1:s1']);
    expect(items.find((entry) => entry.id === exams['A2'] && entry.student.id === id('s2'))!.result).toMatchObject({ status: 'absent', score: null });
    expect(items.find((entry) => entry.id === exams['B1'])!.result).toBeNull(); // published, no result for s2
    expect(pairs((await mine('guardian', { studentId: id('s2') }).expect(200)).body.items)).toEqual(['A1:s2', 'B1:s2', 'A2:s2']);
    for (const nobody of ['linkedNoRole', 'teacher', 'manager']) expect((await mine(nobody).expect(200)).body, nobody).toEqual({ items: [], nextCursor: null });
    expect((await api().get(MY_EXAMS)).status).toBe(401);
  });

  it('AC3 — filters (status, class, student, date range) and keyset pages in both orders; invalid queries are 400', async () => {
    expect(names((await mine('s1', { status: 'published' }).expect(200)).body.items)).toEqual(['A2']);
    expect(names((await mine('s1', { classId: classes['C']! }).expect(200)).body.items)).toEqual(['C1']);
    expect((await mine('s1', { classId: classes['B']! }).expect(200)).body.items).toEqual([]);
    expect((await mine('s1', { studentId: id('s2') }).expect(200)).body.items).toEqual([]);
    expect(names((await mine('s1', { from: '2030-01-15T00:00:00Z', to: '2030-01-31T00:00:00Z' }).expect(200)).body.items)).toEqual(['A2']);
    async function pages(order: string): Promise<(string | undefined)[]> {
      const seen: (string | undefined)[] = [];
      let cursor: string | null = null;
      do {
        const res = await mine('s1', { limit: '1', order, ...(cursor ? { cursor } : {}) }).expect(200);
        seen.push(...names(res.body.items as ItemBody[]));
        cursor = res.body.nextCursor as string | null;
      } while (cursor);
      return seen;
    }
    expect(await pages('asc')).toEqual(['A1', 'A2', 'C1']);
    expect(await pages('desc')).toEqual(['A2', 'A1', 'C1']);
    expect((await mine('s1', { cursor: 'garbage' })).body).toMatchObject({ code: 'cursor_invalid' });
    const badQueries: Record<string, string>[] = [{ status: 'draft' }, { studentId: 'x' }, { from: '2030-01-01' }, { limit: '0' }, { order: 'up' }];
    for (const query of badQueries) expect((await mine('s1', query)).status, JSON.stringify(query)).toBe(400);
  });

  it(
    'documents the route in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths['/api/me/exams'])).toEqual(['get']);
      for (const schema of ['MyExamListDto', 'MyExamItemDto', 'MyExamResultDto']) expect(docs.body.components.schemas).toHaveProperty(schema);
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
