// TEST-162 — MOD-11-T03 invoices (API-144..API-150; D-R59..D-R62, D-R64,
// D-R65) against the live development database. Skipped when no database is
// reachable. Fixture users (a clerk with `invoices.manage`, a cashier with
// `payments.record`, an auditor with `invoices.read_all`, a planner with
// `fee_plans.manage` alone, five students — one soft-deleted), roles, two
// courses, two classes, enrollments and fee plans (through Prisma), the
// invoices (through the API) and two payments (through Prisma — the payment
// API is T04) carry a unique prefix and are deleted at the end; the invoice
// numbers they consume stay consumed. Audit events are counted by fixture
// actor above an id watermark.
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
const PREFIX = `I${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-162 supertest';
const INVOICES = '/api/invoices';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const NUMBER = /^INV-(\d{4})-(\d{5,})$/;

interface InstallmentBody {
  seq: number;
  amount: number;
  dueOn: string;
  paid: number;
  remaining: number;
  status: string;
  overdue: boolean;
}

interface InvoiceBody {
  id: string;
  number: string | null;
  status: string;
  student: { id: string; fullName: string };
  enrollment: { id: string; class: { id: string; code: string } } | null;
  feePlan: { id: string } | null;
  currency: string;
  subtotal: number;
  discountAmount: number;
  discountReason: string | null;
  total: number;
  paid: number;
  balance: number;
  paymentState: string;
  overdue: boolean;
  nextDue: { seq: number; dueOn: string; remaining: number } | null;
  issuedAt: string | null;
  issuedBy: { fullName: string } | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  notes: string | null;
  lines?: { sortOrder: number; description: { ar: string }; amount: number }[];
  installments?: InstallmentBody[];
  payments?: { number: string; status: string }[];
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

describe.skipIf(!available)('MOD-11 invoices (e2e, TEST-162)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let currency: string;
  let today: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const planIds: Record<string, string> = {};
  const classes: Record<string, string> = {};
  const enrollments: Record<string, string> = {};
  const invoices: Record<string, string> = {};
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const actors: string[] = [];

  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const lines = [
    { description: { ar: 'رسوم الدورة' }, amount: 1000 },
    { description: { ar: 'الكتب' }, amount: 500 },
  ];
  const create = (body: object, as = 'clerk') => api().post(INVOICES).set(bearer(as)).send(body);
  const status = (id: string, body: object, as = 'clerk') => api().post(`${INVOICES}/${id}/status`).set(bearer(as)).send(body);
  const list = (as: string, query: Record<string, string> = {}) => api().get(INVOICES).query({ studentId: fx['s1']!, ...query }).set(bearer(as));
  const ids = (body: { items: InvoiceBody[] }) => body.items.map((item) => item.id);

  async function createRole(key: string, keys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_${key}_${RUN.toLowerCase()}`, label: { ar: `دور اختبار ${key}` }, permissions: { create: keys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(key: string, roleIds: string[], login = true): Promise<void> {
    const user = await prisma.user.create({
      data: { email: email(key), fullName: `Test ${key}`, passwordHash: await passwords.hash(PASSWORD), status: 'active', roles: { create: roleIds.map((roleId) => ({ roleId })) } },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[key] = user.id;
    actors.push(user.id);
    if (login) tokens[key] = (await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(key), password: PASSWORD }).expect(200)).body.accessToken as string;
  }

  async function mark(): Promise<string> {
    return (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;
  }
  const eventsSince = (markId: string) => prisma.auditLog.findMany({ where: { id: { gt: markId }, actorUserId: { in: actors } }, orderBy: { id: 'asc' } });

  /** A payment written straight to the table (the payment API is T04), with the invoice's paid amount kept as T04 will. */
  async function pay(invoiceId: string, amount: number, suffix: string): Promise<string> {
    const payment = await prisma.payment.create({
      data: { number: `${PREFIX}-R${suffix}`, invoiceId, amount, currency, method: 'cash', paidAt: new Date() },
      select: { id: true },
    });
    await prisma.invoice.update({ where: { id: invoiceId }, data: { paidAmount: { increment: amount } } });
    return payment.id;
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
    await createUser('clerk', [await createRole('iclerk', ['invoices.manage'])]);
    await createUser('cashier', [await createRole('icashier', ['payments.record'])]);
    await createUser('auditor', [await createRole('iauditor', ['invoices.read_all'])]);
    await createUser('planner', [await createRole('iplanner', ['fee_plans.manage'])]);
    const studentRole = (await prisma.role.findUniqueOrThrow({ where: { key: 'student' }, select: { id: true } })).id;
    for (const key of ['s1', 's2', 's3', 's4', 's5']) await createUser(key, [studentRole], key === 's1');
    await prisma.user.update({ where: { id: fx['s3']! }, data: { deletedAt: new Date(), status: 'archived' } });
    const courseA = (await prisma.course.create({ data: { code: `${PREFIX}-CA`, name: { ar: 'دورة أ' }, status: 'published' }, select: { id: true } })).id;
    const courseB = (await prisma.course.create({ data: { code: `${PREFIX}-CB`, name: { ar: 'دورة ب' }, status: 'published' }, select: { id: true } })).id;
    classes['A'] = (await prisma.class.create({ data: { courseId: courseA, code: `${PREFIX}-A`, name: { ar: 'فصل أ' }, capacity: 10, status: 'running' }, select: { id: true } })).id;
    classes['B'] = (await prisma.class.create({ data: { courseId: courseB, code: `${PREFIX}-B`, name: { ar: 'فصل ب' }, capacity: 10, status: 'running' }, select: { id: true } })).id;
    for (const [key, student, statusOf] of [
      ['e1', 's1', 'active'],
      ['e2', 's2', 'active'],
      ['e3', 's3', 'active'],
      ['e4', 's4', 'withdrawn'],
      ['e5', 's5', 'active'],
    ] as const) {
      enrollments[key] = (await prisma.enrollment.create({ data: { classId: classes['A'], studentUserId: fx[student]!, status: statusOf }, select: { id: true } })).id;
    }
    enrollments['eB'] = (await prisma.enrollment.create({ data: { classId: classes['B'], studentUserId: fx['s1']!, status: 'active' }, select: { id: true } })).id;
    const plan = async (key: string, data: { courseId?: string; classId?: string; isActive?: boolean }) => {
      planIds[key] = (
        await prisma.feePlan.create({
          data: { name: { ar: `${PREFIX} ${key}` }, lines, installments: [{ percent: 50, dueOffsetDays: 0 }, { percent: 50, dueOffsetDays: 30 }], ...data },
          select: { id: true },
        })
      ).id;
    };
    await plan('course', { courseId: courseA });
    await plan('classB', { classId: classes['B'] });
    await plan('inactive', { isActive: false });
  }, 90_000);

  afterAll(async () => {
    try {
      if (prisma) {
        const studentIds = createdUserIds;
        await prisma.payment.deleteMany({ where: { invoice: { studentUserId: { in: studentIds } } } });
        await prisma.invoice.deleteMany({ where: { studentUserId: { in: studentIds } } });
        await prisma.feePlan.deleteMany({ where: { id: { in: Object.values(planIds) } } });
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

  it('AC1 — a draft is created by hand or from a plan (copied lines, shares split from today), in the academy currency, with one event; every rule and key is checked before any write', async () => {
    const m = await mark();
    const manual = await create({
      studentId: fx['s1'],
      lines,
      discountAmount: 100,
      discountReason: 'منحة',
      installments: [
        { amount: 700, dueOn: addDays(today, -10) },
        { amount: 700, dueOn: addDays(today, 20) },
      ],
      notes: 'ملاحظة داخلية',
    });
    expect(manual.status, JSON.stringify(manual.body)).toBe(201);
    const a = manual.body as InvoiceBody;
    invoices['A'] = a.id;
    expect(a).toMatchObject({
      number: null,
      status: 'draft',
      student: { id: fx['s1'], fullName: 'Test s1' },
      enrollment: null,
      feePlan: null,
      currency,
      subtotal: 1500,
      discountAmount: 100,
      discountReason: 'منحة',
      total: 1400,
      paid: 0,
      balance: 1400,
      paymentState: 'unpaid',
      overdue: false,
      nextDue: null,
      issuedAt: null,
      notes: 'ملاحظة داخلية',
      lines: [
        { sortOrder: 0, description: { ar: 'رسوم الدورة' }, amount: 1000 },
        { sortOrder: 1, description: { ar: 'الكتب' }, amount: 500 },
      ],
      payments: [],
    });
    // A draft is never overdue, even with a past due day.
    expect(a.installments!.map((part) => [part.seq, part.amount, part.status, part.overdue])).toEqual([
      [1, 700, 'unpaid', false],
      [2, 700, 'unpaid', false],
    ]);

    const fromPlan = await create({ studentId: fx['s1'], enrollmentId: enrollments['e1'], feePlanId: planIds['course'] }).expect(201);
    const b = fromPlan.body as InvoiceBody;
    invoices['B'] = b.id;
    expect(b).toMatchObject({ enrollment: { id: enrollments['e1'], class: { id: classes['A'], code: `${PREFIX}-A` } }, feePlan: { id: planIds['course'] }, subtotal: 1500, total: 1500 });
    expect(b.installments!.map((part) => [part.amount, part.dueOn])).toEqual([
      [750, today],
      [750, addDays(today, 30)],
    ]);
    // A general plan (no course, no class) prices anything — here a student without an enrollment.
    const general = (await prisma.feePlan.create({ data: { name: { ar: `${PREFIX} عامة` }, lines: [{ description: { ar: 'رسم' }, amount: 0.05 }], installments: [{ percent: 50, dueOffsetDays: 0 }, { percent: 50, dueOffsetDays: 1 }] }, select: { id: true } })).id;
    planIds['general'] = general;
    const tiny = await create({ studentId: fx['s2'], feePlanId: general }).expect(201);
    invoices['T'] = tiny.body.id as string;
    expect((tiny.body as InvoiceBody).installments!.map((part) => part.amount)).toEqual([0.03, 0.02]);

    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.entityType, event.entityId])).toEqual([
      ['invoices.created', 'invoices', a.id],
      ['invoices.created', 'invoices', b.id],
      ['invoices.created', 'invoices', invoices['T']],
    ]);
    expect(events[0]!.metadata).toEqual({ studentId: fx['s1'], enrollmentId: null, feePlanId: null, currency, total: 1400, installments: 2 });
    expect(events[1]!.metadata).toMatchObject({ enrollmentId: enrollments['e1'], feePlanId: planIds['course'], total: 1500 });

    const m2 = await mark();
    const parts = [{ amount: 1500, dueOn: today }];
    const refusals: [object, string, object?][] = [
      [{ studentId: fx['s1'], feePlanId: planIds['course'], lines }, 'invoice_invalid', { problems: ['plan_with_lines'] }],
      [{ studentId: fx['s1'] }, 'invoice_invalid', { problems: ['lines_required'] }],
      [{ studentId: fx['s1'], lines }, 'invoice_invalid', { problems: ['lines_required'] }],
      [{ studentId: fx['s1'], lines, installments: [{ amount: 1000, dueOn: today }] }, 'invoice_invalid', { problems: ['installments_sum'] }],
      [{ studentId: fx['s1'], lines, installments: parts, discountReason: 'بلا خصم' }, 'invoice_invalid', { problems: ['discount_reason_without_discount'] }],
      [{ studentId: fx['s1'], lines, installments: [{ amount: 750, dueOn: addDays(today, 5) }, { amount: 750, dueOn: today }] }, 'invoice_invalid', { problems: ['due_dates_not_ascending'] }],
      [{ studentId: fx['s1'], lines, installments: parts, discountAmount: 1500 }, 'invoice_invalid', { problems: ['total_zero', 'installments_sum'] }],
      [{ studentId: NIL_ID, lines, installments: parts }, 'student_not_found', { studentId: NIL_ID }],
      [{ studentId: fx['auditor'], lines, installments: parts }, 'student_not_found'],
      [{ studentId: fx['s3'], lines, installments: parts }, 'student_not_found'],
      [{ studentId: fx['s2'], enrollmentId: enrollments['e1'], lines, installments: parts }, 'enrollment_mismatch', { enrollmentId: enrollments['e1'] }],
      [{ studentId: fx['s1'], enrollmentId: enrollments['e1'], feePlanId: planIds['classB'] }, 'fee_plan_mismatch', { feePlanId: planIds['classB'], classId: classes['A'] }],
      [{ studentId: fx['s1'], enrollmentId: enrollments['eB'], feePlanId: planIds['course'] }, 'fee_plan_mismatch'],
      [{ studentId: fx['s1'], feePlanId: planIds['inactive'] }, 'fee_plan_inactive'],
      [{ studentId: fx['s1'], feePlanId: NIL_ID }, 'fee_plan_not_found'],
    ];
    for (const [body, code, details] of refusals) expect((await create(body)).body, JSON.stringify(body)).toMatchObject({ code, ...details });
    expect((await create({ studentId: fx['s1'], enrollmentId: enrollments['eB'], feePlanId: planIds['classB'] })).status).toBe(201); // the class plan prices its own class
    invoices['CB'] = (await prisma.invoice.findFirstOrThrow({ where: { enrollmentId: enrollments['eB'] }, select: { id: true } })).id;
    for (const bad of [
      { studentId: fx['s1'], lines: [{ description: { ar: 'x' }, amount: '100' }], installments: parts },
      { studentId: fx['s1'], lines: [{ description: { ar: 'x' }, amount: 10.005 }], installments: parts },
      { studentId: fx['s1'], lines, installments: [{ amount: 1500, dueOn: '2026-02-30' }] },
      { studentId: fx['s1'], lines, installments: Array.from({ length: 25 }, () => ({ amount: 60, dueOn: today })) },
      { studentId: fx['s1'], lines: [], installments: parts },
      { studentId: fx['s1'], lines, installments: parts, discountAmount: -1 },
      { studentId: 'not-a-uuid', lines, installments: parts },
      { studentId: fx['s1'], lines, installments: parts, currency: 'USD' },
    ]) {
      expect((await create(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    for (const as of ['cashier', 'auditor', 'planner', 's1']) expect((await create({ studentId: fx['s1'], lines, installments: parts }, as)).status, as).toBe(403);
    expect((await eventsSince(m2)).map((event) => [event.action, event.entityId])).toEqual([['invoices.created', invoices['CB']]]);
  });

  it('AC2 — a draft is edited by the smallest change (one event) and stays valid; deleted while a draft (one event)', async () => {
    const c = (await create({ studentId: fx['s2'], lines, installments: [{ amount: 1500, dueOn: today }], notes: 'قبل' }).expect(201)).body as InvoiceBody;
    const patch = (body: object, as = 'clerk') => api().patch(`${INVOICES}/${c.id}`).set(bearer(as)).send(body);
    const m = await mark();
    const changed = await patch({
      discountAmount: 300,
      discountReason: 'خصم الأخوة',
      installments: [
        { amount: 600, dueOn: today },
        { amount: 600, dueOn: addDays(today, 15) },
      ],
      notes: null,
    }).expect(200);
    expect(changed.body).toMatchObject({ subtotal: 1500, discountAmount: 300, discountReason: 'خصم الأخوة', total: 1200, notes: null, status: 'draft' });
    expect((changed.body as InvoiceBody).installments!.map((part) => [part.seq, part.amount])).toEqual([
      [1, 600],
      [2, 600],
    ]);
    // The same values again — written as other numbers — change nothing.
    await patch({ discountAmount: 300.0, lines: [{ description: { ar: 'رسوم الدورة' }, amount: 1000.0 }, { description: { ar: 'الكتب' }, amount: 500 }] }).expect(200);
    expect((await patch({ discountAmount: 200 })).body).toMatchObject({ code: 'invoice_invalid', problems: ['installments_sum'] });
    expect((await patch({ discountAmount: 0 })).body).toMatchObject({ problems: ['discount_reason_without_discount', 'installments_sum'] });
    expect((await patch({ enrollmentId: enrollments['e1'] })).body).toMatchObject({ code: 'enrollment_mismatch' });
    const linked = await patch({ enrollmentId: enrollments['e2'] }).expect(200);
    expect(linked.body).toMatchObject({ enrollment: { id: enrollments['e2'] } });
    expect((await patch({})).body).toMatchObject({ code: 'nothing_to_update' });
    expect((await patch({ notes: 'x' }, 'cashier')).status).toBe(403);
    expect((await api().patch(`${INVOICES}/${NIL_ID}`).set(bearer('clerk')).send({ notes: 'x' })).body).toMatchObject({ code: 'invoice_not_found' });
    expect((await eventsSince(m)).map((event) => [event.action, event.entityId, event.metadata])).toEqual([
      ['invoices.updated', c.id, { fields: ['installments', 'discountAmount', 'discountReason', 'notes'] }],
      ['invoices.updated', c.id, { fields: ['enrollmentId'] }],
    ]);

    const m2 = await mark();
    expect((await api().delete(`${INVOICES}/${c.id}`).set(bearer('cashier'))).status).toBe(403);
    await api().delete(`${INVOICES}/${c.id}`).set(bearer('clerk')).expect(204);
    expect((await api().delete(`${INVOICES}/${c.id}`).set(bearer('clerk'))).body).toMatchObject({ code: 'invoice_not_found' });
    expect((await eventsSince(m2)).map((event) => [event.action, event.entityId, event.metadata])).toEqual([
      ['invoices.deleted', c.id, { studentId: fx['s2'], feePlanId: null, total: 1200 }],
    ]);
  });

  it('AC3 — issuing numbers the invoice INV-YYYY-NNNNN in the academy year and freezes it; paid parts, balance and overdue are computed on read; the list filters', async () => {
    const m = await mark();
    const a = (await status(invoices['A']!, { action: 'issue' }).expect(200)).body as InvoiceBody;
    expect(a.number).toMatch(NUMBER);
    expect(NUMBER.exec(a.number!)![1]).toBe(today.slice(0, 4));
    expect(a).toMatchObject({ status: 'issued', issuedBy: { fullName: 'Test clerk' }, overdue: true, nextDue: { seq: 1, dueOn: addDays(today, -10), remaining: 700 } });
    expect(a.installments!.map((part) => [part.status, part.overdue])).toEqual([
      ['unpaid', true],
      ['unpaid', false],
    ]);
    const b = (await status(invoices['B']!, { action: 'issue', reason: 'not read on issue' }).expect(200)).body as InvoiceBody;
    expect(Number(NUMBER.exec(b.number!)![2])).toBeGreaterThan(Number(NUMBER.exec(a.number!)![2]));
    expect((await eventsSince(m)).map((event) => [event.action, event.entityId, event.metadata])).toEqual([
      ['invoices.issued', a.id, { number: a.number, studentId: fx['s1'], currency, total: 1400, installments: 2 }],
      ['invoices.issued', b.id, { number: b.number, studentId: fx['s1'], currency, total: 1500, installments: 2 }],
    ]);

    const m2 = await mark();
    expect((await status(a.id, { action: 'issue' })).body).toMatchObject({ code: 'invalid_transition', from: 'issued', action: 'issue', allowed: ['cancel'] });
    expect((await api().patch(`${INVOICES}/${a.id}`).set(bearer('clerk')).send({ notes: 'x' })).body).toMatchObject({ code: 'invoice_not_draft', status: 'issued' });
    expect((await api().delete(`${INVOICES}/${a.id}`).set(bearer('clerk'))).body).toMatchObject({ code: 'invoice_not_draft', status: 'issued' });
    expect((await status(a.id, { action: 'issue' }, 'cashier')).status).toBe(403);
    expect((await status(a.id, { action: 'refund' })).status).toBe(400);
    expect(await eventsSince(m2)).toEqual([]);

    // 800 paid on B (written straight to the table — T04 is the payment API): the oldest part first.
    await pay(b.id, 800, '1');
    const paidB = (await api().get(`${INVOICES}/${b.id}`).set(bearer('cashier')).expect(200)).body as InvoiceBody;
    expect(paidB).toMatchObject({ paid: 800, balance: 700, paymentState: 'partial', overdue: false, nextDue: { seq: 2, remaining: 700 } });
    expect(paidB.installments!.map((part) => [part.paid, part.remaining, part.status])).toEqual([
      [750, 0, 'paid'],
      [50, 700, 'partial'],
    ]);
    expect(paidB.payments!.map((payment) => [payment.number, payment.status])).toEqual([[`${PREFIX}-R1`, 'completed']]);
    expect((await api().get(`${INVOICES}/${b.id}`).set(bearer('auditor'))).status).toBe(200);
    expect((await api().get(`${INVOICES}/${NIL_ID}`).set(bearer('auditor'))).body).toMatchObject({ code: 'invoice_not_found' });

    // Filters (always narrowed to the fixture student s1 by `list`).
    expect(ids((await list('auditor')).body)).toEqual([invoices['CB'], b.id, a.id]);
    expect(ids((await list('clerk', { status: 'issued' })).body)).toEqual([b.id, a.id]);
    expect(ids((await list('cashier', { balance: 'unpaid' })).body)).toEqual([a.id]);
    expect(ids((await list('cashier', { balance: 'partial' })).body)).toEqual([b.id]);
    expect(ids((await list('cashier', { balance: 'paid' })).body)).toEqual([]);
    expect(ids((await list('cashier', { overdue: 'true' })).body)).toEqual([a.id]);
    expect(ids((await list('cashier', { overdue: 'false' })).body)).toEqual([invoices['CB'], b.id]);
    expect(ids((await list('cashier', { classId: classes['A']! })).body)).toEqual([b.id]);
    expect(ids((await list('cashier', { feePlanId: planIds['classB']! })).body)).toEqual([invoices['CB']]);
    expect(ids((await list('cashier', { enrollmentId: enrollments['eB']! })).body)).toEqual([invoices['CB']]);
    expect(ids((await list('cashier', { q: a.number!.slice(-5).toLowerCase() })).body)).toEqual([a.id]);
    expect(ids((await list('cashier', { q: '%' })).body)).toEqual([]);
    const first = await list('cashier', { limit: '2' }).expect(200);
    expect(ids(first.body)).toEqual([invoices['CB'], b.id]);
    const second = await list('cashier', { limit: '2', cursor: first.body.nextCursor as string }).expect(200);
    expect(ids(second.body)).toEqual([a.id]);
    expect(second.body.nextCursor).toBeNull();
    expect((await list('cashier', { cursor: 'not-a-cursor' })).body).toMatchObject({ code: 'cursor_invalid' });
    expect((await list('cashier', { overdue: 'yes' })).status).toBe(400);
    const denied = await list('planner');
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['invoices.read_all', 'invoices.manage', 'payments.record'] });
    expect((await list('s1')).status).toBe(403);
    expect((await api().get(`${INVOICES}/${b.id}`).set(bearer('planner'))).status).toBe(403);
  });

  it('AC4 — cancelling needs a reason and no completed payment (reverse it first); one event; a cancelled invoice takes no action', async () => {
    const b = invoices['B']!;
    const m = await mark();
    expect((await status(b, { action: 'cancel' })).status).toBe(400);
    expect((await status(b, { action: 'cancel', reason: '   ' })).status).toBe(400);
    expect((await status(b, { action: 'cancel', reason: 'خطأ في الخطة' })).body).toMatchObject({ code: 'invoice_has_payments', paymentCount: 1 });
    expect((await status(invoices['T']!, { action: 'cancel', reason: 'مسودة' })).body).toMatchObject({ code: 'invalid_transition', from: 'draft', allowed: ['issue'] });
    expect(await eventsSince(m)).toEqual([]);

    // The payment reversed (T04 will do it through the API): it stays on the invoice, the paid amount returns.
    await prisma.payment.updateMany({ where: { invoiceId: b }, data: { status: 'reversed', reversedAt: new Date(), reverseReason: 'test' } });
    await prisma.invoice.update({ where: { id: b }, data: { paidAmount: 0 } });
    const m2 = await mark();
    const cancelled = (await status(b, { action: 'cancel', reason: 'خطأ في الخطة' }).expect(200)).body as InvoiceBody;
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelReason: 'خطأ في الخطة', paid: 0, overdue: false, nextDue: null });
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(cancelled.number).toMatch(NUMBER);
    expect(cancelled.payments!.map((payment) => payment.status)).toEqual(['reversed']);
    expect((await status(b, { action: 'cancel', reason: 'مرة ثانية' })).body).toMatchObject({ code: 'invalid_transition', from: 'cancelled', allowed: [] });
    expect((await status(b, { action: 'issue' })).body).toMatchObject({ code: 'invalid_transition', from: 'cancelled', allowed: [] });
    expect((await eventsSince(m2)).map((event) => [event.action, event.entityId, event.metadata])).toEqual([
      ['invoices.cancelled', b, { number: cancelled.number, studentId: fx['s1'], reason: 'خطأ في الخطة' }],
    ]);
  });

  it('AC5 — a class is invoiced from a plan for its active enrollments without a live invoice from that plan (deleted students skipped), issued with consecutive numbers; one event; a repeat creates nothing', async () => {
    const batch = (body: object, as = 'clerk', classId = classes['A']!) => api().post(`/api/classes/${classId}/invoices`).set(bearer(as)).send(body);
    // s2 already holds a draft from the course plan for e2; s1's invoice B (same plan, e1) is cancelled — it does not block.
    const held = (await create({ studentId: fx['s2'], enrollmentId: enrollments['e2'], feePlanId: planIds['course'] }).expect(201)).body as InvoiceBody;
    const m = await mark();
    const result = await batch({ feePlanId: planIds['course'], issue: true }).expect(200);
    const created = result.body.created as InvoiceBody[];
    expect(created.map((invoice) => [invoice.student.id, invoice.enrollment?.id, invoice.status, invoice.total])).toEqual([
      [fx['s1'], enrollments['e1'], 'issued', 1500],
      [fx['s5'], enrollments['e5'], 'issued', 1500],
    ]);
    const numbers = created.map((invoice) => Number(NUMBER.exec(invoice.number!)![2]));
    expect(numbers[1]).toBe(numbers[0]! + 1);
    expect(result.body.skipped).toEqual([
      { enrollmentId: enrollments['e2'], studentId: fx['s2'], reason: 'already_invoiced' },
      { enrollmentId: enrollments['e3'], studentId: fx['s3'], reason: 'student_deleted' },
    ]);
    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.entityType, event.entityId])).toEqual([['invoices.batch_created', 'classes', classes['A']]]);
    expect(events[0]!.metadata).toEqual({
      code: `${PREFIX}-A`,
      feePlanId: planIds['course'],
      issued: true,
      count: 2,
      invoiceIds: created.map((invoice) => invoice.id),
      skipped: 2,
      currency,
      total: 1500,
    });

    const m2 = await mark();
    const again = await batch({ feePlanId: planIds['course'] }).expect(200);
    expect(again.body.created).toEqual([]);
    expect((again.body.skipped as { reason: string }[]).map((skip) => skip.reason)).toEqual(['already_invoiced', 'already_invoiced', 'student_deleted', 'already_invoiced']);
    expect((await batch({ feePlanId: planIds['classB'] })).body).toMatchObject({ code: 'fee_plan_mismatch', feePlanId: planIds['classB'], classId: classes['A'] });
    expect((await batch({ feePlanId: planIds['inactive'] })).body).toMatchObject({ code: 'fee_plan_inactive' });
    expect((await batch({ feePlanId: NIL_ID })).body).toMatchObject({ code: 'fee_plan_not_found' });
    expect((await batch({ feePlanId: planIds['course'] }, 'clerk', NIL_ID)).body).toMatchObject({ code: 'class_not_found', classId: NIL_ID });
    expect((await batch({ feePlanId: planIds['course'], issue: 'yes' })).status).toBe(400);
    expect((await batch({ feePlanId: planIds['course'] }, 'auditor')).status).toBe(403);
    expect(await eventsSince(m2)).toEqual([]);
    // The drafts of the batch (none here) and the held draft stay editable; the issued ones are frozen.
    expect((await api().patch(`${INVOICES}/${created[0]!.id}`).set(bearer('clerk')).send({ notes: 'x' })).body).toMatchObject({ code: 'invoice_not_draft' });
    expect(held.status).toBe('draft');
  });

  it(
    'documents the routes in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths['/api/invoices']).sort()).toEqual(['get', 'post']);
      expect(Object.keys(docs.body.paths['/api/invoices/{id}']).sort()).toEqual(['delete', 'get', 'patch']);
      expect(Object.keys(docs.body.paths['/api/invoices/{id}/status'])).toEqual(['post']);
      expect(Object.keys(docs.body.paths['/api/classes/{id}/invoices'])).toEqual(['post']);
      for (const schema of ['CreateInvoiceDto', 'UpdateInvoiceDto', 'ChangeInvoiceStatusDto', 'IssueClassInvoicesDto', 'InvoiceDto', 'InvoiceListDto', 'ClassInvoicesResultDto']) {
        expect(docs.body.components.schemas).toHaveProperty(schema);
      }
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
