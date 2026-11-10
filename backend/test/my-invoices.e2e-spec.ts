// TEST-164 — MOD-11-T05 «my invoices» (API-155; D-R65) against the live
// development database. Skipped when no database is reachable. Fixture users
// (a clerk with `invoices.manage`, a cashier with `payments.record`, a
// refunder with `payments.refund`, three students with the seeded `student`
// role — one soft-deleted later, a guardian with the seeded `guardian` role,
// a user who is both student and guardian, a user linked without the guardian
// role, a user with neither key), roles, a course, a class, an enrollment and
// the guardian links (through Prisma), the invoices and payments (through the
// API) carry a unique prefix and are deleted at the end; the numbers they
// consume stay consumed.
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
import { addDays } from '../src/finance/fee-plans.rules.js';
import { dayIn } from '../src/finance/invoices.calc.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `M${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-164 supertest';
const MINE = '/api/me/invoices';

interface MyInvoiceBody {
  id: string;
  number: string | null;
  status: string;
  relation: string;
  student: { id: string };
  enrollment: { id: string; class: { id: string } } | null;
  total: number;
  paid: number;
  balance: number;
  paymentState: string;
  overdue: boolean;
  nextDue: { seq: number; remaining: number } | null;
  cancelReason: string | null;
  lines: { amount: number }[];
  installments: { paid: number; remaining: number; status: string; overdue: boolean }[];
  payments: Record<string, unknown>[];
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

describe.skipIf(!available)('MOD-11 «my invoices» (e2e, TEST-164)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let today: string;
  let classId: string;
  let enrollmentId: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const invoices: Record<string, string> = {};
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const mine = (as: string, query: Record<string, string> = {}) => api().get(MINE).query(query).set(bearer(as));
  const ids = (body: { items: MyInvoiceBody[] }) => body.items.map((item) => item.id);
  const roleId = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;

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
      data: { email: email(key), fullName: `Test ${key}`, passwordHash: await passwords.hash(PASSWORD), status: 'active', roles: { create: roleIds.map((id) => ({ roleId: id })) } },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[key] = user.id;
    tokens[key] = (await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(key), password: PASSWORD }).expect(200)).body.accessToken as string;
  }

  /** An invoice through the API (clerk), issued unless asked otherwise. */
  async function makeInvoice(key: string, studentKey: string, extra: object = {}, issue = true): Promise<string> {
    const created = await api()
      .post('/api/invoices')
      .set(bearer('clerk'))
      .send({
        studentId: fx[studentKey],
        lines: [{ description: { ar: 'رسوم' }, amount: 1500 }],
        installments: [
          { amount: 750, dueOn: addDays(today, -5) },
          { amount: 750, dueOn: addDays(today, 25) },
        ],
        notes: 'ملاحظة داخلية لا يراها الطالب',
        ...extra,
      })
      .expect(201);
    invoices[key] = created.body.id as string;
    if (issue) await api().post(`/api/invoices/${invoices[key]}/status`).set(bearer('clerk')).send({ action: 'issue' }).expect(200);
    return invoices[key];
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    today = dayIn((await prisma.academy.findFirstOrThrow({ select: { timezone: true } })).timezone, new Date());
    const student = await roleId('student');
    const guardian = await roleId('guardian');
    await createUser('clerk', [await createRole('mclerk', ['invoices.manage'])]);
    await createUser('cashier', [await createRole('mcashier', ['payments.record'])]);
    await createUser('refunder', [await createRole('mrefunder', ['payments.refund'])]);
    await createUser('s1', [student]);
    await createUser('s2', [student]);
    await createUser('s3', [student]);
    await createUser('g1', [guardian]);
    await createUser('both', [student, guardian]);
    await createUser('linked', [await createRole('mlinked', ['invoices.read_linked'])]);
    await createUser('nokeys', [await createRole('mnokeys', ['classes.read'])]);
    for (const [guardianKey, studentKey] of [
      ['g1', 's2'],
      ['g1', 's3'],
      ['both', 's2'],
      ['linked', 's2'],
    ] as const) {
      await prisma.guardianStudent.create({ data: { guardianUserId: fx[guardianKey]!, studentUserId: fx[studentKey]!, relationship: 'father' }, select: { studentUserId: true } });
    }
    const courseId = (await prisma.course.create({ data: { code: `${PREFIX}-C`, name: { ar: 'دورة فواتيري' }, status: 'published' }, select: { id: true } })).id;
    classId = (await prisma.class.create({ data: { courseId, code: `${PREFIX}-A`, name: { ar: 'فصل فواتيري' }, capacity: 10, status: 'running' }, select: { id: true } })).id;
    enrollmentId = (await prisma.enrollment.create({ data: { classId, studentUserId: fx['s1']!, status: 'active' }, select: { id: true } })).id;

    await makeInvoice('I1', 's1', { enrollmentId, discountAmount: 0 });
    // 900 paid (the first installment and 150 of the second), and 100 paid then reversed.
    await api().post(`/api/invoices/${invoices['I1']}/payments`).set(bearer('cashier')).send({ amount: 900, method: 'cash', payerName: 'ولي الأمر', reference: 'R-1', notes: 'داخلي' }).expect(201);
    const wrong = await api().post(`/api/invoices/${invoices['I1']}/payments`).set(bearer('cashier')).send({ amount: 100, method: 'card' }).expect(201);
    await api().post(`/api/payments/${wrong.body.id}/reverse`).set(bearer('refunder')).send({ reason: 'خطأ' }).expect(200);
    await makeInvoice('D1', 's1', {}, false);
    await makeInvoice('C1', 's1');
    await api().post(`/api/invoices/${invoices['C1']}/status`).set(bearer('clerk')).send({ action: 'cancel', reason: 'فاتورة مكررة' }).expect(200);
    await makeInvoice('I2', 's2');
    await makeInvoice('I3', 's3');
    await makeInvoice('I4', 'both');
    await prisma.user.update({ where: { id: fx['s3']! }, data: { deletedAt: new Date(), status: 'archived' } });
  }, 120_000);

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.payment.deleteMany({ where: { invoice: { studentUserId: { in: createdUserIds } } } });
        await prisma.invoice.deleteMany({ where: { studentUserId: { in: createdUserIds } } });
        await prisma.enrollment.deleteMany({ where: { classId } });
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

  it('AC1 — a student sees their issued and cancelled invoices with the installments and the valid receipts — never a draft, the note, the issuer, the plan, a recorder or a reversed payment; filters narrow', async () => {
    const body = (await mine('s1').expect(200)).body as { items: MyInvoiceBody[] };
    expect(ids(body)).toEqual([invoices['C1'], invoices['I1']]);
    const [cancelled, issued] = body.items as [MyInvoiceBody, MyInvoiceBody];
    expect(cancelled).toMatchObject({ status: 'cancelled', relation: 'self', cancelReason: 'فاتورة مكررة', overdue: false, nextDue: null, payments: [] });
    expect(issued).toMatchObject({
      status: 'issued',
      relation: 'self',
      student: { id: fx['s1'] },
      enrollment: { id: enrollmentId, class: { id: classId } },
      total: 1500,
      paid: 900,
      balance: 600,
      paymentState: 'partial',
      overdue: false,
      nextDue: { seq: 2, remaining: 600 },
    });
    expect(issued.number).toMatch(/^INV-\d{4}-\d{5,}$/);
    expect(issued.installments.map((part) => [part.paid, part.remaining, part.status, part.overdue])).toEqual([
      [750, 0, 'paid', false],
      [150, 600, 'partial', false],
    ]);
    expect(issued.payments).toHaveLength(1);
    expect(issued.payments[0]).toMatchObject({ amount: 900, method: 'cash', payerName: 'ولي الأمر', reference: 'R-1' });
    expect(Object.keys(issued.payments[0]!).sort()).toEqual(['amount', 'id', 'method', 'number', 'paidAt', 'payerName', 'reference']);
    for (const item of body.items) for (const hidden of ['notes', 'issuedBy', 'feePlan']) expect(item, hidden).not.toHaveProperty(hidden);

    expect(ids((await mine('s1', { status: 'issued' })).body)).toEqual([invoices['I1']]);
    expect(ids((await mine('s1', { status: 'cancelled' })).body)).toEqual([invoices['C1']]);
    expect(ids((await mine('s1', { classId })).body)).toEqual([invoices['I1']]);
    expect(ids((await mine('s1', { studentId: fx['s2']! })).body)).toEqual([]);
    expect((await mine('s1', { status: 'draft' })).status).toBe(400);
    expect((await mine('s1', { studentId: 'nope' })).status).toBe(400);
  });

  it('AC2 — a guardian sees the linked, not soft-deleted children’s invoices (child); a student-guardian sees both; a link without the guardian role grants nothing', async () => {
    const guardian = (await mine('g1').expect(200)).body as { items: MyInvoiceBody[] };
    expect(guardian.items.map((item) => [item.id, item.relation, item.student.id])).toEqual([[invoices['I2'], 'child', fx['s2']]]);
    expect(ids((await mine('g1', { studentId: fx['s2']! })).body)).toEqual([invoices['I2']]);
    expect(ids((await mine('g1', { studentId: fx['s3']! })).body)).toEqual([]); // soft-deleted child
    const both = (await mine('both').expect(200)).body as { items: MyInvoiceBody[] };
    expect(both.items.map((item) => [item.id, item.relation])).toEqual([
      [invoices['I4'], 'self'],
      [invoices['I2'], 'child'],
    ]);
    expect((await mine('linked').expect(200)).body).toEqual({ items: [] });
  });

  it('AC3 — a caller with neither key is refused naming both; office keys do not open «my invoices»', async () => {
    for (const as of ['nokeys', 'clerk', 'cashier']) {
      const denied = await mine(as);
      expect(denied.status, as).toBe(403);
      expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['invoices.read_own', 'invoices.read_linked'] });
    }
  });

  it(
    'documents the route in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths['/api/me/invoices'])).toEqual(['get']);
      for (const schema of ['MyInvoiceListDto', 'MyInvoiceItemDto', 'MyInvoicePaymentDto']) expect(docs.body.components.schemas).toHaveProperty(schema);
      const item = docs.body.components.schemas['MyInvoiceItemDto'] as { properties: Record<string, unknown> };
      for (const hidden of ['notes', 'issuedBy', 'feePlan']) expect(item.properties, hidden).not.toHaveProperty(hidden);
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
