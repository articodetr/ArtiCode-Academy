// TEST-163 — MOD-11-T04 payments and receipts (API-151..API-154; D-R62,
// D-R63, D-R65) against the live development database. Skipped when no
// database is reachable. Fixture users (a clerk with `invoices.manage`, a
// cashier with `payments.record`, a refunder with `payments.refund` alone, an
// auditor with `invoices.read_all`, a planner with `fee_plans.manage` alone,
// two students) and roles (through Prisma), the invoices and payments (through
// the API) carry a unique prefix and are deleted at the end; the invoice and
// receipt numbers they consume stay consumed. Audit events are counted by
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
import { addDays } from '../src/finance/fee-plans.rules.js';
import { dayIn } from '../src/finance/invoices.calc.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-163 supertest';
const PAYMENTS = '/api/payments';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const RECEIPT = /^RCPT-(\d{4})-(\d{5,})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

interface PaymentBody {
  id: string;
  number: string;
  invoice: { id: string; number: string | null; status: string; currency: string; total: number; paid: number; balance: number; paymentState: string };
  student: { id: string; fullName: string };
  amount: number;
  currency: string;
  method: string;
  status: string;
  paidAt: string;
  reference: string | null;
  payerName: string | null;
  notes: string | null;
  recordedBy: { fullName: string } | null;
  reversedAt: string | null;
  reversedBy: { fullName: string } | null;
  reverseReason: string | null;
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

describe.skipIf(!available)('MOD-11 payments (e2e, TEST-163)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let currency: string;
  let today: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const invoices: Record<string, string> = {};
  const payments: Record<string, PaymentBody> = {};
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const actors: string[] = [];

  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const pay = (invoiceId: string, body: object, as = 'cashier') => api().post(`/api/invoices/${invoiceId}/payments`).set(bearer(as)).send(body);
  const reverse = (paymentId: string, body: object, as = 'refunder') => api().post(`${PAYMENTS}/${paymentId}/reverse`).set(bearer(as)).send(body);
  const list = (as: string, query: Record<string, string>) => api().get(PAYMENTS).query(query).set(bearer(as));
  const ids = (body: { items: PaymentBody[] }) => body.items.map((item) => item.id);
  const invoice = (id: string) => api().get(`/api/invoices/${id}`).set(bearer('clerk'));

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

  /** An invoice through the API (clerk), issued unless asked otherwise. */
  async function makeInvoice(key: string, studentKey: string, amounts: number[], issue = true): Promise<string> {
    const total = amounts.reduce((sum, amount) => sum + amount, 0);
    const created = await api()
      .post('/api/invoices')
      .set(bearer('clerk'))
      .send({
        studentId: fx[studentKey],
        lines: [{ description: { ar: 'رسوم' }, amount: total }],
        installments: amounts.map((amount, index) => ({ amount, dueOn: addDays(today, index === 0 ? -5 : 25 * index) })),
      })
      .expect(201);
    invoices[key] = created.body.id as string;
    if (issue) await api().post(`/api/invoices/${invoices[key]}/status`).set(bearer('clerk')).send({ action: 'issue' }).expect(200);
    return invoices[key];
  }

  async function mark(): Promise<string> {
    return (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;
  }
  const eventsSince = (markId: string) => prisma.auditLog.findMany({ where: { id: { gt: markId }, actorUserId: { in: actors } }, orderBy: { id: 'asc' } });

  /** Sessions of this database waiting on a lock (the API and this client share the app role, so they are visible). */
  async function lockWaiters(): Promise<number> {
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
    return rows[0]?.n ?? 0;
  }

  /** Runs `requests` while another transaction holds the invoice row, released once `waiters` sessions wait (or after 3 s). */
  async function withInvoiceRowHeld<T>(invoiceId: string, waiters: number, requests: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let held!: () => void;
    const lockTaken = new Promise<void>((resolve) => (held = resolve));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`;
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    const academy = await prisma.academy.findFirstOrThrow({ select: { currency: true, timezone: true } });
    currency = academy.currency;
    today = dayIn(academy.timezone, new Date());
    await createUser('clerk', [await createRole('pclerk', ['invoices.manage'])]);
    await createUser('cashier', [await createRole('pcashier', ['payments.record'])]);
    await createUser('refunder', [await createRole('prefunder', ['payments.refund'])]);
    await createUser('auditor', [await createRole('pauditor', ['invoices.read_all'])]);
    await createUser('planner', [await createRole('pplanner', ['fee_plans.manage'])]);
    const studentRole = (await prisma.role.findUniqueOrThrow({ where: { key: 'student' }, select: { id: true } })).id;
    await createUser('s1', [studentRole]);
    await createUser('s2', [studentRole]);
    await makeInvoice('I', 's1', [750, 750]);
    await makeInvoice('D', 's1', [300], false);
    await makeInvoice('C', 's2', [400]);
    await api().post(`/api/invoices/${invoices['C']}/status`).set(bearer('clerk')).send({ action: 'cancel', reason: 'اختبار' }).expect(200);
    await makeInvoice('R', 's2', [1000]);
  }, 90_000);

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.payment.deleteMany({ where: { invoice: { studentUserId: { in: createdUserIds } } } });
        await prisma.invoice.deleteMany({ where: { studentUserId: { in: createdUserIds } } });
      }
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('AC1 — a payment of an issued invoice gets a receipt RCPT-YYYY-NNNNN, moves the paid amount (oldest installment first) and records one event; the balance, the invoice state and the keys are checked before any write', async () => {
    const m = await mark();
    const first = await pay(invoices['I']!, { amount: 600, method: 'cash' });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const p1 = first.body as PaymentBody;
    payments['p1'] = p1;
    expect(p1.number).toMatch(RECEIPT);
    expect(RECEIPT.exec(p1.number)![1]).toBe(today.slice(0, 4));
    expect(p1).toMatchObject({
      amount: 600,
      currency,
      method: 'cash',
      status: 'completed',
      reference: null,
      payerName: null,
      recordedBy: { fullName: 'Test cashier' },
      reversedAt: null,
      reversedBy: null,
      student: { id: fx['s1'], fullName: 'Test s1' },
      invoice: { id: invoices['I'], status: 'issued', currency, total: 1500, paid: 600, balance: 900, paymentState: 'partial' },
    });
    expect(Math.abs(Date.parse(p1.paidAt) - Date.now())).toBeLessThan(60_000);
    const afterFirst = (await invoice(invoices['I']!).expect(200)).body as { overdue: boolean; installments: { paid: number; remaining: number; status: string; overdue: boolean }[] };
    expect(afterFirst.overdue).toBe(true);
    expect(afterFirst.installments.map((part) => [part.paid, part.remaining, part.status, part.overdue])).toEqual([
      [600, 150, 'partial', true],
      [0, 750, 'unpaid', false],
    ]);

    const yesterday = new Date(Date.now() - DAY_MS).toISOString();
    const p2 = (await pay(invoices['I']!, { amount: 900, method: 'bank_transfer', reference: '  TRX-77  ', payerName: 'ولي الأمر', paidAt: yesterday, notes: 'دفعة كاملة' }).expect(201)).body as PaymentBody;
    payments['p2'] = p2;
    expect(Number(RECEIPT.exec(p2.number)![2])).toBe(Number(RECEIPT.exec(p1.number)![2]) + 1);
    expect(p2).toMatchObject({ reference: 'TRX-77', payerName: 'ولي الأمر', notes: 'دفعة كاملة', paidAt: yesterday, invoice: { paid: 1500, balance: 0, paymentState: 'paid' } });
    const settled = (await invoice(invoices['I']!).expect(200)).body as { overdue: boolean; nextDue: unknown; payments: { number: string }[] };
    expect(settled).toMatchObject({ overdue: false, nextDue: null });
    expect(settled.payments.map((payment) => payment.number)).toEqual([p2.number, p1.number]);
    expect((await eventsSince(m)).map((event) => [event.action, event.entityType, event.entityId, event.metadata])).toEqual([
      ['payments.recorded', 'payments', p1.id, { invoiceId: invoices['I'], invoiceNumber: p1.invoice.number, number: p1.number, amount: 600, currency, method: 'cash' }],
      ['payments.recorded', 'payments', p2.id, { invoiceId: invoices['I'], invoiceNumber: p1.invoice.number, number: p2.number, amount: 900, currency, method: 'bank_transfer' }],
    ]);

    const m2 = await mark();
    expect((await pay(invoices['I']!, { amount: 0.01, method: 'cash' })).body).toMatchObject({ code: 'payment_exceeds_balance', amount: 0.01, balance: 0 });
    expect((await pay(invoices['R']!, { amount: 1000.01, method: 'cash' })).body).toMatchObject({ code: 'payment_exceeds_balance', amount: 1000.01, balance: 1000 });
    expect((await pay(invoices['D']!, { amount: 10, method: 'cash' })).body).toMatchObject({ code: 'invoice_not_issued', status: 'draft' });
    expect((await pay(invoices['C']!, { amount: 10, method: 'cash' })).body).toMatchObject({ code: 'invoice_not_issued', status: 'cancelled' });
    expect((await pay(NIL_ID, { amount: 10, method: 'cash' })).body).toMatchObject({ code: 'invoice_not_found' });
    for (const bad of [
      { amount: 0, method: 'cash' },
      { amount: -5, method: 'cash' },
      { amount: 10.005, method: 'cash' },
      { amount: '100', method: 'cash' },
      { amount: 10, method: 'bitcoin' },
      { amount: 10 },
      { amount: 10, method: 'cash', paidAt: new Date(Date.now() + DAY_MS).toISOString() },
      { amount: 10, method: 'cash', paidAt: '2026-11-10T10:00:00' },
      { amount: 10, method: 'cash', paidAt: '2026-02-30T10:00:00Z' },
      { amount: 10, method: 'cash', currency: 'USD' },
      { amount: 10, method: 'cash', reference: '   ' },
    ]) {
      expect((await pay(invoices['R']!, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    for (const as of ['clerk', 'auditor', 'refunder', 's1']) expect((await pay(invoices['R']!, { amount: 10, method: 'cash' }, as)).status, as).toBe(403);
    expect(await eventsSince(m2)).toEqual([]);
  });

  it('AC2 — two payments of the whole balance at the same moment: the invoice-row lock lets one through and refuses the other', async () => {
    const m = await mark();
    const results = await withInvoiceRowHeld(invoices['R']!, 2, () =>
      Promise.all([pay(invoices['R']!, { amount: 1000, method: 'cash' }), pay(invoices['R']!, { amount: 1000, method: 'card' })]),
    );
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(results.find((result) => result.status === 409)!.body).toMatchObject({ code: 'payment_exceeds_balance', amount: 1000, balance: 0 });
    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: invoices['R']! }, select: { paidAmount: true } });
    expect(stored.paidAmount.toFixed(2)).toBe('1000.00');
    expect((await eventsSince(m)).map((event) => event.action)).toEqual(['payments.recorded']);
  });

  it('AC3 — the receipts are listed newest first with their invoice, filtered and paged; read with any of the three keys', async () => {
    const { p1, p2 } = payments as { p1: PaymentBody; p2: PaymentBody };
    expect(ids((await list('cashier', { invoiceId: invoices['I']! }).expect(200)).body)).toEqual([p2.id, p1.id]);
    expect(ids((await list('auditor', { studentId: fx['s1']! })).body)).toEqual([p2.id, p1.id]);
    expect(ids((await list('clerk', { studentId: fx['s1']!, method: 'bank_transfer' })).body)).toEqual([p2.id]);
    expect(ids((await list('clerk', { studentId: fx['s1']!, status: 'reversed' })).body)).toEqual([]);
    const window = { studentId: fx['s1']!, from: new Date(Date.now() - 2 * DAY_MS).toISOString(), to: new Date(Date.now() - 60 * 60 * 1000).toISOString() };
    expect(ids((await list('clerk', window)).body)).toEqual([p2.id]);
    expect(ids((await list('clerk', { studentId: fx['s1']!, q: p1.number.slice(-6).toLowerCase() })).body)).toEqual([p1.id]);
    const page1 = await list('cashier', { studentId: fx['s1']!, limit: '1' }).expect(200);
    expect(ids(page1.body)).toEqual([p2.id]);
    const page2 = await list('cashier', { studentId: fx['s1']!, limit: '1', cursor: page1.body.nextCursor as string }).expect(200);
    expect(ids(page2.body)).toEqual([p1.id]);
    expect(page2.body.nextCursor).toBeNull();
    expect((await list('cashier', { cursor: 'not-a-cursor' })).body).toMatchObject({ code: 'cursor_invalid' });
    expect((await list('cashier', { from: '2026-11-10' })).status).toBe(400);
    expect((await list('cashier', { method: 'bitcoin' })).status).toBe(400);

    const receipt = await api().get(`${PAYMENTS}/${p1.id}`).set(bearer('auditor')).expect(200);
    expect(receipt.body).toMatchObject({ id: p1.id, number: p1.number, invoice: { id: invoices['I'], paid: 1500 }, student: { id: fx['s1'] } });
    expect((await api().get(`${PAYMENTS}/${NIL_ID}`).set(bearer('clerk'))).body).toMatchObject({ code: 'payment_not_found' });
    const denied = await list('planner', {});
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['invoices.read_all', 'invoices.manage', 'payments.record'] });
    expect((await api().get(`${PAYMENTS}/${p1.id}`).set(bearer('refunder'))).status).toBe(403);
    expect((await list('s1', {})).status).toBe(403);
  });

  it('AC4 — a payment is reversed once, with a reason, by payments.refund: it stays on record, the amount leaves the invoice and the balance can be paid again', async () => {
    const { p2 } = payments as { p2: PaymentBody };
    const m = await mark();
    expect((await reverse(p2.id, {})).status).toBe(400);
    expect((await reverse(p2.id, { reason: '   ' })).status).toBe(400);
    expect((await reverse(p2.id, { reason: 'شيك مرتجع' }, 'cashier')).status).toBe(403);
    expect((await reverse(p2.id, { reason: 'شيك مرتجع' }, 'clerk')).status).toBe(403);
    expect((await reverse(NIL_ID, { reason: 'x' })).body).toMatchObject({ code: 'payment_not_found' });
    expect(await eventsSince(m)).toEqual([]);

    const reversed = (await reverse(p2.id, { reason: '  شيك مرتجع ' }).expect(200)).body as PaymentBody;
    expect(reversed).toMatchObject({ status: 'reversed', reverseReason: 'شيك مرتجع', reversedBy: { fullName: 'Test refunder' }, amount: 900, invoice: { paid: 600, balance: 900, paymentState: 'partial' } });
    expect(reversed.reversedAt).not.toBeNull();
    const again = await reverse(p2.id, { reason: 'مرة ثانية' });
    expect(again.body).toMatchObject({ code: 'payment_reversed', paymentId: p2.id, reversedAt: reversed.reversedAt });
    expect(ids((await list('clerk', { studentId: fx['s1']!, status: 'reversed' })).body)).toEqual([p2.id]);
    const after = (await invoice(invoices['I']!).expect(200)).body as { paid: number; overdue: boolean; payments: { number: string; status: string }[] };
    expect(after).toMatchObject({ paid: 600, overdue: true });
    expect(after.payments.map((payment) => [payment.number, payment.status])).toEqual([
      [p2.number, 'reversed'],
      [payments['p1']!.number, 'completed'],
    ]);
    // The balance is free again.
    const p3 = (await pay(invoices['I']!, { amount: 900, method: 'card' }).expect(201)).body as PaymentBody;
    expect(p3.invoice).toMatchObject({ paid: 1500, balance: 0, paymentState: 'paid' });
    expect((await eventsSince(m)).map((event) => [event.action, event.entityId, event.metadata])).toEqual([
      ['payments.reversed', p2.id, { invoiceId: invoices['I'], invoiceNumber: p2.invoice.number, number: p2.number, amount: 900, reason: 'شيك مرتجع' }],
      ['payments.recorded', p3.id, { invoiceId: invoices['I'], invoiceNumber: p2.invoice.number, number: p3.number, amount: 900, currency, method: 'card' }],
    ]);
  });

  it(
    'documents the routes in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths['/api/invoices/{id}/payments'])).toEqual(['post']);
      expect(Object.keys(docs.body.paths['/api/payments'])).toEqual(['get']);
      expect(Object.keys(docs.body.paths['/api/payments/{id}'])).toEqual(['get']);
      expect(Object.keys(docs.body.paths['/api/payments/{id}/reverse'])).toEqual(['post']);
      for (const schema of ['RecordPaymentDto', 'ReversePaymentDto', 'PaymentDto', 'PaymentListDto', 'PaymentInvoiceDto']) expect(docs.body.components.schemas).toHaveProperty(schema);
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
