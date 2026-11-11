// TEST-169 — MOD-13-T03 financial reports (API-161..163; roadmap §4k, D-R66..D-R73)
// against the live development database. Skipped when no database is reachable.
// The suite builds its own course, class, students, invoices (two currencies,
// a cancelled one and a draft), installments due relative to today and
// payments (one reversed) straight through Prisma (numbers carry a unique tag),
// reads the reports filtered by its own course and deletes everything at the end.
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
import type { PaymentMethod } from '../src/generated/prisma/client.js';
import { addDays, zonedInstant } from '../src/schedule/lesson-generation.plan.js';
import { calendarDateIn } from '../src/schedule/schedule.time.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const TAG = `RPF-${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 4)}`.toUpperCase();
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-169 supertest';
const BASE = '/api/reports/financial';
const NIL_ID = '00000000-0000-0000-0000-000000000000';

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

describe.skipIf(!available)('MOD-13 financial reports (e2e, TEST-169)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let zone: string;
  let today: string;
  let cur: string;
  let other: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const inv: Record<string, string> = {};
  let courseId: string;

  const email = (name: string) => `${name}-${RUN}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const at = (date: string, time = '10:00') => zonedInstant(date, time, zone);
  const get = (path: string, who = 'reporter') => api().get(`${BASE}/${path}`).set(bearer(who));

  async function createRole(name: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_${name}_${RUN}`, label: { ar: `دور اختبار ${name}` }, permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(name: string, roleIds: string[] = [], withPassword = true): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Finance ${name} ${RUN}`,
        passwordHash: withPassword ? await passwords.hash(PASSWORD) : null,
        status: 'active',
        roles: roleIds.length > 0 ? { create: roleIds.map((roleId) => ({ roleId })) } : undefined,
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    return user.id;
  }

  async function login(identifier: string): Promise<string> {
    const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier, password: PASSWORD }).expect(200);
    return res.body.accessToken as string;
  }

  interface InvoiceSpec {
    student: string;
    enrollmentId: string | null;
    status: 'draft' | 'issued' | 'cancelled';
    currency: string;
    subtotal: string;
    discount?: string;
    paid?: string;
    issuedOn?: string;
    installments: [string, string][];
  }
  async function invoice(key: string, spec: InvoiceSpec): Promise<string> {
    const discount = spec.discount ?? '0';
    const total = (Number(spec.subtotal) - Number(discount)).toFixed(2);
    const row = await prisma.invoice.create({
      data: {
        number: spec.status === 'draft' ? null : `${TAG}-${key}`,
        studentUserId: fx[spec.student]!,
        enrollmentId: spec.enrollmentId,
        status: spec.status,
        currency: spec.currency,
        subtotal: spec.subtotal,
        discountAmount: discount,
        discountReason: Number(discount) > 0 ? 'منحة' : null,
        totalAmount: total,
        paidAmount: spec.paid ?? '0',
        issuedAt: spec.status === 'draft' ? null : at(spec.issuedOn ?? '2025-03-02'),
        cancelledAt: spec.status === 'cancelled' ? at('2025-03-04') : null,
        cancelReason: spec.status === 'cancelled' ? 'خطأ' : null,
        installments: { create: spec.installments.map(([amount, dueOn], index) => ({ seq: index + 1, amount, dueOn: new Date(`${dueOn}T00:00:00.000Z`) })) },
      },
      select: { id: true },
    });
    inv[key] = row.id;
    return row.id;
  }

  async function payment(key: string, invoiceKey: string, amount: string, method: PaymentMethod, paidOn: string, currency: string, reversed = false): Promise<void> {
    await prisma.payment.create({
      data: {
        number: `${TAG}-${key}`,
        invoiceId: inv[invoiceKey]!,
        amount,
        currency,
        method,
        status: reversed ? 'reversed' : 'completed',
        paidAt: at(paidOn),
        reversedAt: reversed ? at(paidOn, '12:00') : null,
        reverseReason: reversed ? 'خطأ إدخال' : null,
      },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    const academy = await prisma.academy.findFirst({ select: { timezone: true, currency: true } });
    zone = academy?.timezone ?? 'UTC';
    cur = academy?.currency ?? 'SAR';
    other = cur === 'EUR' ? 'USD' : 'EUR';
    today = calendarDateIn(zone);

    await createUser('reporter', [await createRole('reporter', ['reports.financial.view'])]);
    await createUser('academic', [await createRole('academic', ['reports.academic.view'])]);
    for (const name of ['reporter', 'academic']) tokens[name] = await login(email(name));
    for (const name of ['s1', 's2']) await createUser(name, [], false);

    courseId = (await prisma.course.create({ data: { code: TAG, name: { ar: `دورة ${TAG}` }, status: 'published' }, select: { id: true } })).id;
    const classA = (await prisma.class.create({ data: { courseId, code: `${TAG}-A`, name: { ar: 'فصل أ' }, capacity: 20, status: 'running' }, select: { id: true } })).id;
    const e1 = (await prisma.enrollment.create({ data: { classId: classA, studentUserId: fx['s1']!, status: 'active' }, select: { id: true } })).id;
    const e2 = (await prisma.enrollment.create({ data: { classId: classA, studentUserId: fx['s2']!, status: 'active' }, select: { id: true } })).id;

    // I1: s1, 1300 − 100 = 1200, 600 paid → covers the first part (due 100 days ago); 300 overdue by 45 days; 300 due in 20 days.
    await invoice('I1', { student: 's1', enrollmentId: e1, status: 'issued', currency: cur, subtotal: '1300', discount: '100', paid: '600', issuedOn: '2025-03-02', installments: [['600', addDays(today, -100)], ['300', addDays(today, -45)], ['300', addDays(today, 20)]] });
    // I2: s2, 500 unpaid → 300 overdue by 100 days, 200 by 10 days.
    await invoice('I2', { student: 's2', enrollmentId: e2, status: 'issued', currency: cur, subtotal: '500', issuedOn: '2025-03-10', installments: [['300', addDays(today, -100)], ['200', addDays(today, -10)]] });
    // I3: s2 in another currency, nothing overdue yet.
    await invoice('I3', { student: 's2', enrollmentId: e2, status: 'issued', currency: other, subtotal: '100', issuedOn: '2025-03-12', installments: [['100', addDays(today, 5)]] });
    // I4: s1, paid in full (in April) — no balance.
    await invoice('I4', { student: 's1', enrollmentId: e1, status: 'issued', currency: cur, subtotal: '50', paid: '50', issuedOn: '2025-03-15', installments: [['50', '2025-03-15']] });
    // I5 cancelled, I6 draft — never invoiced, never receivable.
    await invoice('I5', { student: 's1', enrollmentId: e1, status: 'cancelled', currency: cur, subtotal: '999', issuedOn: '2025-03-03', installments: [['999', addDays(today, -30)]] });
    await invoice('I6', { student: 's2', enrollmentId: e2, status: 'draft', currency: cur, subtotal: '777', installments: [['777', addDays(today, -30)]] });

    await payment('P1', 'I1', '600', 'cash', '2025-03-05', cur);
    await payment('P2', 'I1', '200', 'bank_transfer', '2025-03-20', cur, true);
    await payment('P4', 'I4', '50', 'card', '2025-04-02', cur);
  }, 40_000);

  afterAll(async () => {
    try {
      if (prisma) {
        const invoiceIds = Object.values(inv);
        // Payments hold their invoice (Restrict); invoices hold their student (Restrict) and take lines and installments with them.
        if (invoiceIds.length > 0) {
          await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
          await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
        }
        await prisma.enrollment.deleteMany({ where: { class: { courseId } } });
        await prisma.class.deleteMany({ where: { courseId } });
        await prisma.course.deleteMany({ where: { id: courseId } });
      }
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('AC1 — only reports.financial.view reads (the academic key is not enough); nothing is audited', async () => {
    const latest = (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;
    for (const path of ['collections', 'receivables', 'revenue']) {
      const denied = await get(`${path}?courseId=${courseId}`, 'academic').expect(403);
      expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['reports.financial.view'] });
      await get(`${path}?courseId=${courseId}`).expect(200);
    }
    expect(await prisma.auditLog.count({ where: { id: { gt: latest }, actorUserId: { in: Object.values(fx) } } })).toBe(0);
  });

  it('AC2 — collections by month × method × currency; the reversed payment apart; the method filter', async () => {
    const march = await get(`collections?courseId=${courseId}&from=2025-03-01&to=2025-03-31`).expect(200);
    expect(march.body).toMatchObject({ period: { from: '2025-03-01', to: '2025-03-31' }, timeZone: zone, truncated: false });
    expect(march.body.rows).toEqual([{ month: '2025-03', method: 'cash', currency: cur, payments: 1, amount: 600 }]);
    expect(march.body.reversed).toEqual([{ month: '2025-03', method: 'bank_transfer', currency: cur, payments: 1, amount: 200 }]);
    expect(march.body.totals).toEqual([{ currency: cur, payments: 1, amount: 600, reversedPayments: 1, reversedAmount: 200 }]);

    const spring = await get(`collections?courseId=${courseId}&from=2025-03-01&to=2025-04-30`).expect(200);
    expect(spring.body.rows).toEqual([
      { month: '2025-03', method: 'cash', currency: cur, payments: 1, amount: 600 },
      { month: '2025-04', method: 'card', currency: cur, payments: 1, amount: 50 },
    ]);
    const cash = await get(`collections?courseId=${courseId}&from=2025-03-01&to=2025-04-30&method=cash`).expect(200);
    expect(cash.body.rows).toHaveLength(1);
    expect(cash.body.reversed).toEqual([]);
    expect((await get('collections?method=crypto')).status).toBe(400);
  });

  it('AC3 — receivables as of today: the paid amount covers the oldest part first, the aging buckets, the second currency apart; cancelled, draft and settled out', async () => {
    const res = await get(`receivables?courseId=${courseId}`).expect(200);
    expect(res.body).toMatchObject({ period: null, asOf: today, timeZone: zone, truncated: false });
    const zero = { days1To30: 0, days31To60: 0, days61To90: 0, days91Plus: 0 };
    expect(res.body.rows).toEqual([
      {
        student: { id: fx['s2'], fullName: `Finance s2 ${RUN}`, displayName: null },
        currency: cur,
        invoices: 1,
        total: 500,
        paid: 0,
        balance: 500,
        overdue: 500,
        oldestOverdueDueOn: addDays(today, -100),
        daysOverdue: 100,
        aging: { ...zero, days1To30: 200, days91Plus: 300 },
      },
      {
        student: { id: fx['s1'], fullName: `Finance s1 ${RUN}`, displayName: null },
        currency: cur,
        invoices: 1,
        total: 1200,
        paid: 600,
        balance: 600,
        overdue: 300,
        oldestOverdueDueOn: addDays(today, -45),
        daysOverdue: 45,
        aging: { ...zero, days31To60: 300 },
      },
      {
        student: { id: fx['s2'], fullName: `Finance s2 ${RUN}`, displayName: null },
        currency: other,
        invoices: 1,
        total: 100,
        paid: 0,
        balance: 100,
        overdue: 0,
        oldestOverdueDueOn: null,
        daysOverdue: null,
        aging: zero,
      },
    ]);
    const totals = [
      { currency: cur, students: 2, invoices: 2, total: 1700, paid: 600, balance: 1100, overdue: 800, aging: { ...zero, days1To30: 200, days31To60: 300, days91Plus: 300 } },
      { currency: other, students: 1, invoices: 1, total: 100, paid: 0, balance: 100, overdue: 0, aging: zero },
    ].sort((a, b) => a.currency.localeCompare(b.currency));
    expect(res.body.totals).toEqual(totals);

    const overdue = await get(`receivables?courseId=${courseId}&overdueOnly=true`).expect(200);
    expect(overdue.body.rows.map((row: { student: { id: string }; currency: string }) => [row.student.id, row.currency])).toEqual([
      [fx['s2'], cur],
      [fx['s1'], cur],
    ]);
    const all = await get(`receivables?courseId=${courseId}&overdueOnly=false`).expect(200);
    expect(all.body.rows).toHaveLength(3);
    for (const query of ['overdueOnly=yes', 'from=2025-03-01']) expect((await get(`receivables?${query}`)).status, query).toBe(400);
  });

  it('AC4 — revenue per course × month × currency: invoiced by issue day (cancelled and draft out), collected by payment day', async () => {
    const march = await get(`revenue?courseId=${courseId}&from=2025-03-01&to=2025-03-31`).expect(200);
    const course = { id: courseId, code: TAG, name: { ar: `دورة ${TAG}` } };
    const rows = [
      { course, month: '2025-03', currency: cur, invoices: 3, invoiced: 1750, discounts: 100, payments: 1, collected: 600 },
      { course, month: '2025-03', currency: other, invoices: 1, invoiced: 100, discounts: 0, payments: 0, collected: 0 },
    ].sort((a, b) => a.currency.localeCompare(b.currency));
    expect(march.body.rows).toEqual(rows);
    expect(march.body.totals).toEqual(rows.map(({ currency, invoices, invoiced, discounts, payments, collected }) => ({ currency, invoices, invoiced, discounts, payments, collected })));

    const april = await get(`revenue?courseId=${courseId}&from=2025-04-01&to=2025-04-30`).expect(200);
    expect(april.body.rows).toEqual([{ course, month: '2025-04', currency: cur, invoices: 0, invoiced: 0, discounts: 0, payments: 1, collected: 50 }]);
    expect((await get(`revenue?from=2025-03-10&to=2025-03-01`)).body).toMatchObject({ code: 'report_range_invalid' });
  });

  it(
    'documents the three routes in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      for (const path of ['collections', 'receivables', 'revenue']) expect(Object.keys(docs.body.paths[`${BASE}/${path}`])).toEqual(['get']);
      for (const schema of ['CollectionsReportDto', 'ReceivablesReportDto', 'RevenueReportDto']) expect(docs.body.components.schemas).toHaveProperty(schema);
    },
    20_000,
  );
});
