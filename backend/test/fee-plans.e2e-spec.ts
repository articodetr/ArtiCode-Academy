// TEST-161 — MOD-11-T02 fee plans (API-140..API-143; D-R60) against the live
// development database. Skipped when no database is reachable. Fixture users
// (a planner with `fee_plans.manage`, a clerk with `invoices.manage` alone, a
// user without either key, a student), roles, a course and a class (through
// Prisma), the plans (through the API) and one invoice made from a plan
// (through Prisma — the invoice API is T03) carry a unique prefix and are
// deleted at the end. Audit events are counted by fixture actor above an id
// watermark.
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
const PREFIX = `P${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-161 supertest';
const PLANS = '/api/fee-plans';
const NIL_ID = '00000000-0000-0000-0000-000000000000';

interface PlanBody {
  id: string;
  name: { ar: string };
  course: { id: string } | null;
  class: { id: string } | null;
  lines: { description: { ar: string }; amount: number }[];
  installments: { percent: number; dueOffsetDays: number }[];
  total: number;
  isActive: boolean;
  invoiceCount: number | null;
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

describe.skipIf(!available)('MOD-11 fee plans (e2e, TEST-161)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let courseId: string;
  let classId: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const planIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const actors: string[] = [];

  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const name = (suffix: string) => ({ ar: `${PREFIX} ${suffix}` });
  const lines = [
    { description: { ar: 'رسوم الدورة' }, amount: 2400 },
    { description: { ar: 'الكتب' }, amount: 600.5 },
  ];
  const shares = [
    { percent: 50, dueOffsetDays: 0 },
    { percent: 50, dueOffsetDays: 30 },
  ];
  const create = (body: object, as = 'planner') => api().post(PLANS).set(bearer(as)).send(body);
  const list = (as: string, query: Record<string, string> = {}) => api().get(PLANS).query(query).set(bearer(as));

  async function createRole(key: string, keys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_${key}_${RUN.toLowerCase()}`, label: { ar: `دور اختبار ${key}` }, permissions: { create: keys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(key: string, roleIds: string[]): Promise<void> {
    const user = await prisma.user.create({
      data: { email: email(key), fullName: `Test ${key}`, passwordHash: await passwords.hash(PASSWORD), status: 'active', roles: { create: roleIds.map((roleId) => ({ roleId })) } },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[key] = user.id;
    actors.push(user.id);
    tokens[key] = (await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(key), password: PASSWORD }).expect(200)).body.accessToken as string;
  }

  async function mark(): Promise<string> {
    return (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;
  }
  const eventsSince = (markId: string) => prisma.auditLog.findMany({ where: { id: { gt: markId }, actorUserId: { in: actors } }, orderBy: { id: 'asc' } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    await createUser('planner', [await createRole('fplanner', ['fee_plans.manage'])]);
    await createUser('clerk', [await createRole('fclerk', ['invoices.manage'])]);
    await createUser('nokeys', [await createRole('fnokeys', ['payments.record'])]);
    await createUser('student', [(await prisma.role.findUniqueOrThrow({ where: { key: 'student' }, select: { id: true } })).id]);
    courseId = (await prisma.course.create({ data: { code: `${PREFIX}-CRS`, name: { ar: 'دورة الرسوم' }, status: 'published' }, select: { id: true } })).id;
    classId = (await prisma.class.create({ data: { courseId, code: `${PREFIX}-A`, name: { ar: 'فصل الرسوم' }, capacity: 10 }, select: { id: true } })).id;
  }, 60_000);

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.invoice.deleteMany({ where: { studentUserId: { in: createdUserIds } } });
        await prisma.feePlan.deleteMany({ where: { id: { in: planIds } } });
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

  it('AC1 — a plan is created with its lines, shares and total (one event); a course or a class but not both; the rules and the body are checked; only fee_plans.manage writes', async () => {
    const m = await mark();
    const general = await create({ name: name('عامة'), lines, installments: shares });
    expect(general.status, JSON.stringify(general.body)).toBe(201);
    const plan = general.body as PlanBody;
    planIds.push(plan.id);
    expect(plan).toMatchObject({ name: name('عامة'), course: null, class: null, lines, installments: shares, total: 3000.5, isActive: true, invoiceCount: 0 });
    const forCourse = (await create({ name: name('دورة'), courseId, lines, installments: [{ percent: 100, dueOffsetDays: 0 }] }).expect(201)).body as PlanBody;
    planIds.push(forCourse.id);
    expect(forCourse.course).toMatchObject({ id: courseId, code: `${PREFIX}-CRS` });
    const forClass = (await create({ name: name('فصل'), classId, lines: [{ description: { ar: 'رسوم' }, amount: 1000 }], installments: [{ percent: 33.33, dueOffsetDays: 0 }, { percent: 33.33, dueOffsetDays: 30 }, { percent: 33.34, dueOffsetDays: 60 }] }).expect(201)).body as PlanBody;
    planIds.push(forClass.id);
    expect(forClass.class).toMatchObject({ id: classId });

    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.entityType, event.entityId])).toEqual([
      ['fee_plans.created', 'fee_plans', plan.id],
      ['fee_plans.created', 'fee_plans', forCourse.id],
      ['fee_plans.created', 'fee_plans', forClass.id],
    ]);
    expect(events[0]!.metadata).toEqual({ courseId: null, classId: null, total: 3000.5, installments: 2 });

    const m2 = await mark();
    expect((await create({ name: name('x'), courseId, classId, lines, installments: shares })).body).toMatchObject({ code: 'fee_plan_invalid', problems: ['course_and_class'] });
    expect((await create({ name: name('x'), lines, installments: [{ percent: 40, dueOffsetDays: 0 }, { percent: 50, dueOffsetDays: 10 }] })).body).toMatchObject({ problems: ['percent_sum'] });
    expect((await create({ name: name('x'), lines, installments: [{ percent: 50, dueOffsetDays: 30 }, { percent: 50, dueOffsetDays: 0 }] })).body).toMatchObject({ problems: ['offsets_not_ascending'] });
    expect((await create({ name: name('x'), courseId: NIL_ID, lines, installments: shares })).body).toMatchObject({ code: 'course_not_found' });
    expect((await create({ name: name('x'), classId: NIL_ID, lines, installments: shares })).body).toMatchObject({ code: 'class_not_found' });
    for (const bad of [
      { name: name('x'), lines: [], installments: shares },
      { name: name('x'), lines: [{ description: { ar: 'r' }, amount: 0 }], installments: shares },
      { name: name('x'), lines: [{ description: { ar: 'r' }, amount: 10.005 }], installments: shares },
      { name: name('x'), lines: [{ description: { ar: 'r' }, amount: '100' }], installments: shares },
      { name: name('x'), lines, installments: Array.from({ length: 25 }, (_, i) => ({ percent: 4, dueOffsetDays: i })) },
      { name: name('x'), lines, installments: [{ percent: 100, dueOffsetDays: -1 }] },
      { name: { en: 'no arabic' }, lines, installments: shares },
    ]) {
      expect((await create(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await create({ name: name('x'), lines, installments: shares }, 'clerk')).status).toBe(403);
    expect(await eventsSince(m2)).toEqual([]);
  });

  it('AC2 — the planner lists every plan with its invoice count; the clerk the active ones without counts; filters; neither key is a 403', async () => {
    const all = (await list('planner').expect(200)).body.items as PlanBody[];
    const mine = all.filter((plan) => planIds.includes(plan.id));
    expect(mine.map((plan) => [plan.id, plan.invoiceCount])).toEqual(planIds.map((id) => [id, 0]));
    const clerk = (await list('clerk').expect(200)).body.items as PlanBody[];
    expect(clerk.filter((plan) => planIds.includes(plan.id)).every((plan) => plan.invoiceCount === null)).toBe(true);
    expect(((await list('planner', { courseId })).body.items as PlanBody[]).map((plan) => plan.id)).toEqual([planIds[1]]);
    expect(((await list('planner', { classId })).body.items as PlanBody[]).map((plan) => plan.id)).toEqual([planIds[2]]);
    const denied = await list('nokeys');
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['fee_plans.manage', 'invoices.manage'] });
    expect((await list('student')).status).toBe(403);
  });

  it('AC3 — an update changes only what differs (one event), keeps the rules after the merge, and an inactive plan leaves the clerk’s list', async () => {
    const [general, forCourse] = planIds;
    const m = await mark();
    const renamed = await api().patch(`${PLANS}/${general}`).set(bearer('planner')).send({ name: name('عامة ٢'), lines }).expect(200);
    expect(renamed.body).toMatchObject({ name: name('عامة ٢'), total: 3000.5 });
    await api().patch(`${PLANS}/${general}`).set(bearer('planner')).send({ name: name('عامة ٢') }).expect(200); // same: nothing
    expect((await api().patch(`${PLANS}/${forCourse}`).set(bearer('planner')).send({ classId })).body).toMatchObject({ code: 'fee_plan_invalid', problems: ['course_and_class'] });
    const moved = await api().patch(`${PLANS}/${forCourse}`).set(bearer('planner')).send({ courseId: null, classId }).expect(200);
    expect(moved.body).toMatchObject({ course: null, class: { id: classId } });
    await api().patch(`${PLANS}/${general}`).set(bearer('planner')).send({ isActive: false }).expect(200);
    expect(((await list('clerk')).body.items as PlanBody[]).map((plan) => plan.id)).not.toContain(general);
    expect((await api().patch(`${PLANS}/${general}`).set(bearer('planner')).send({})).body).toMatchObject({ code: 'nothing_to_update' });
    expect((await api().patch(`${PLANS}/${NIL_ID}`).set(bearer('planner')).send({ isActive: true })).body).toMatchObject({ code: 'fee_plan_not_found' });
    expect((await api().patch(`${PLANS}/${general}`).set(bearer('planner')).send({ isActive: 'yes' })).status).toBe(400);
    expect((await eventsSince(m)).map((event) => [event.action, event.entityId, event.metadata])).toEqual([
      ['fee_plans.updated', general, { fields: ['name'] }],
      ['fee_plans.updated', forCourse, { fields: ['courseId', 'classId'] }],
      ['fee_plans.updated', general, { fields: ['isActive'] }],
    ]);
  });

  it('AC4 — a plan an invoice was made from is not deleted (fee_plan_in_use); an unused one is, with one event', async () => {
    const [general, , forClass] = planIds;
    await prisma.invoice.create({ data: { studentUserId: fx['student']!, feePlanId: forClass, currency: 'SAR', subtotal: 1000, totalAmount: 1000 }, select: { id: true } });
    const m = await mark();
    expect((await api().delete(`${PLANS}/${forClass}`).set(bearer('planner'))).body).toMatchObject({ code: 'fee_plan_in_use', invoiceCount: 1 });
    expect(((await list('planner', { classId })).body.items as PlanBody[]).find((plan) => plan.id === forClass)!.invoiceCount).toBe(1);
    expect((await api().delete(`${PLANS}/${general}`).set(bearer('clerk'))).status).toBe(403);
    await api().delete(`${PLANS}/${general}`).set(bearer('planner')).expect(204);
    expect((await api().delete(`${PLANS}/${general}`).set(bearer('planner'))).body).toMatchObject({ code: 'fee_plan_not_found' });
    expect((await eventsSince(m)).map((event) => [event.action, event.entityId])).toEqual([['fee_plans.deleted', general]]);
  });

  it(
    'documents the routes in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths['/api/fee-plans']).sort()).toEqual(['get', 'post']);
      expect(Object.keys(docs.body.paths['/api/fee-plans/{id}']).sort()).toEqual(['delete', 'patch']);
      for (const schema of ['CreateFeePlanDto', 'UpdateFeePlanDto', 'FeePlanDto', 'FeePlanListDto']) expect(docs.body.components.schemas).toHaveProperty(schema);
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
