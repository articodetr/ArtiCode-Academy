// TEST-165 — the MOD-11 gate: the WF-10 journey through the API (roadmap
// §4i.5 T06; D-R58..D-R65). Skipped when no database is reachable. A clerk
// with the seeded `staff` role (fee plans, invoices and payments), an
// accountant with a custom role (`payments.refund` + `invoices.read_all` —
// the seed gives `payments.refund` to the admin alone), a teacher, two
// students and a guardian with the seeded roles; the course, the running
// class, its two active enrollments and the guardian link come from Prisma,
// everything else from the API. Every fixture carries a unique prefix and is
// deleted at the end; the invoice and receipt numbers stay consumed. The audit
// trail is checked exactly, by fixture actor above an id watermark.
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
const PREFIX = `F${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-165 supertest';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const SEQ = (number: string | null | undefined) => Number(String(number ?? '').split('-').pop());

interface Installment {
  seq: number;
  amount: number;
  dueOn: string;
  paid: number;
  remaining: number;
  status: string;
  overdue: boolean;
}
interface InvoiceLike {
  id: string;
  number: string | null;
  status: string;
  student: { id: string };
  total: number;
  paid: number;
  balance: number;
  paymentState: string;
  nextDue: { seq: number; remaining: number } | null;
  relation?: string;
  installments: Installment[];
  payments: { id: string; number: string; amount: number; status?: string }[];
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

describe.skipIf(!available)('MOD-11 WF-10 journey (e2e, TEST-165)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let today: string;
  let currency: string;
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
  const roleId = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
  const mine = async (as: string, query: Record<string, string> = {}) => (await api().get('/api/me/invoices').query(query).set(bearer(as)).expect(200)).body.items as InvoiceLike[];

  async function createUser(key: string, roleIds: string[]): Promise<void> {
    const user = await prisma.user.create({
      data: { email: email(key), fullName: `Test ${key}`, passwordHash: await passwords.hash(PASSWORD), status: 'active', roles: { create: roleIds.map((id) => ({ roleId: id })) } },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[key] = user.id;
    actors.push(user.id);
    tokens[key] = (await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(key), password: PASSWORD }).expect(200)).body.accessToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    const academy = await prisma.academy.findFirstOrThrow({ select: { timezone: true, currency: true } });
    today = dayIn(academy.timezone, new Date());
    currency = academy.currency;
    const accountantRole = await prisma.role.create({
      data: { key: `test_faccountant_${RUN.toLowerCase()}`, label: { ar: 'محاسب اختبار' }, permissions: { create: ['payments.refund', 'invoices.read_all'].map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(accountantRole.id);
    await createUser('staff', [await roleId('staff')]);
    await createUser('accountant', [accountantRole.id]);
    await createUser('teacher', [await roleId('teacher')]);
    const student = await roleId('student');
    await createUser('s1', [student]);
    await createUser('s2', [student]);
    await createUser('g1', [await roleId('guardian')]);
    await prisma.guardianStudent.create({ data: { guardianUserId: fx['g1']!, studentUserId: fx['s1']!, relationship: 'mother' }, select: { studentUserId: true } });
    courseId = (await prisma.course.create({ data: { code: `${PREFIX}-C`, name: { ar: 'دورة رحلة المالية' }, status: 'published' }, select: { id: true } })).id;
    classId = (await prisma.class.create({ data: { courseId, code: `${PREFIX}-A`, name: { ar: 'فصل رحلة المالية' }, capacity: 10, status: 'running' }, select: { id: true } })).id;
    for (const key of ['s1', 's2']) await prisma.enrollment.create({ data: { classId, studentUserId: fx[key]!, status: 'active' }, select: { id: true } });
  }, 90_000);

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.payment.deleteMany({ where: { invoice: { studentUserId: { in: createdUserIds } } } });
        await prisma.invoice.deleteMany({ where: { studentUserId: { in: createdUserIds } } });
        await prisma.feePlan.deleteMany({ where: { id: { in: planIds } } });
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

  it(
    'WF-10: a fee plan → the class invoiced and issued → «my invoices» → two payments on the installments → a reversal → cancel refused, then allowed after the last reversal → a full payment → the exact audit trail',
    async () => {
      const markId = (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;

      // 1. The clerk (seeded staff role) writes the course's fee plan: 1,500 in two halves, today and in 30 days.
      const plan = await api()
        .post('/api/fee-plans')
        .set(bearer('staff'))
        .send({
          name: { ar: 'رسوم الفصل الأول', en: 'Term 1 fees' },
          courseId,
          lines: [
            { description: { ar: 'رسوم الدورة' }, amount: 1200 },
            { description: { ar: 'الكتب' }, amount: 300 },
          ],
          installments: [
            { percent: 50, dueOffsetDays: 0 },
            { percent: 50, dueOffsetDays: 30 },
          ],
        })
        .expect(201);
      planIds.push(plan.body.id as string);
      expect(plan.body).toMatchObject({ total: 1500, isActive: true });

      // 2. The class is invoiced from the plan and issued at once: one invoice per active enrollment, consecutive numbers.
      const batch = await api().post(`/api/classes/${classId}/invoices`).set(bearer('staff')).send({ feePlanId: plan.body.id, issue: true }).expect(200);
      const created = batch.body.created as InvoiceLike[];
      expect(created.map((invoice) => [invoice.student.id, invoice.status, invoice.total])).toEqual([
        [fx['s1'], 'issued', 1500],
        [fx['s2'], 'issued', 1500],
      ]);
      expect(SEQ(created[1]!.number)).toBe(SEQ(created[0]!.number) + 1);
      expect(batch.body.skipped).toEqual([]);
      const [first, second] = created as [InvoiceLike, InvoiceLike];
      // The same batch again creates nothing.
      const again = await api().post(`/api/classes/${classId}/invoices`).set(bearer('staff')).send({ feePlanId: plan.body.id, issue: true }).expect(200);
      expect(again.body.created).toEqual([]);
      expect((again.body.skipped as { reason: string }[]).map((skip) => skip.reason)).toEqual(['already_invoiced', 'already_invoiced']);

      // 3. «My invoices»: the student and the guardian see the issued invoice, unpaid; the teacher holds no finance key.
      let own = await mine('s1');
      expect(own.map((invoice) => [invoice.id, invoice.relation, invoice.paymentState, invoice.balance])).toEqual([[first.id, 'self', 'unpaid', 1500]]);
      expect(own[0]!.installments.map((part) => [part.amount, part.dueOn])).toEqual([
        [750, today],
        [750, addDays(today, 30)],
      ]);
      expect(own[0]).not.toHaveProperty('notes');
      expect((await mine('g1')).map((invoice) => [invoice.id, invoice.relation])).toEqual([[first.id, 'child']]);
      expect((await mine('s2')).map((invoice) => invoice.id)).toEqual([second.id]);
      expect((await api().get('/api/me/invoices').set(bearer('teacher'))).status).toBe(403);
      expect((await api().get('/api/invoices').set(bearer('teacher'))).status).toBe(403);

      // 4. Two payments on the first student's invoice: the oldest installment first.
      const p750 = await api().post(`/api/invoices/${first.id}/payments`).set(bearer('staff')).send({ amount: 750, method: 'cash', payerName: 'الأم' }).expect(201);
      expect(p750.body.invoice).toMatchObject({ paid: 750, balance: 750, paymentState: 'partial' });
      const p500 = await api().post(`/api/invoices/${first.id}/payments`).set(bearer('staff')).send({ amount: 500, method: 'bank_transfer', reference: 'TRX-500' }).expect(201);
      expect(SEQ(p500.body.number)).toBe(SEQ(p750.body.number) + 1);
      own = await mine('s1');
      expect(own[0]).toMatchObject({ paid: 1250, balance: 250, paymentState: 'partial', nextDue: { seq: 2, remaining: 250 } });
      expect(own[0]!.installments.map((part) => [part.paid, part.remaining, part.status])).toEqual([
        [750, 0, 'paid'],
        [500, 250, 'partial'],
      ]);
      expect(own[0]!.payments.map((payment) => payment.number)).toEqual([p500.body.number, p750.body.number]);
      // Never above the balance.
      expect((await api().post(`/api/invoices/${first.id}/payments`).set(bearer('staff')).send({ amount: 250.01, method: 'cash' })).body).toMatchObject({
        code: 'payment_exceeds_balance',
        amount: 250.01,
        balance: 250,
      });

      // 5. The 500 was a mistake: the accountant reverses it with a reason; it stays on record, out of «my invoices».
      const reversed = await api().post(`/api/payments/${p500.body.id}/reverse`).set(bearer('accountant')).send({ reason: 'مبلغ خاطئ' }).expect(200);
      expect(reversed.body).toMatchObject({ status: 'reversed', invoice: { paid: 750, balance: 750 } });
      expect((await api().post(`/api/payments/${p500.body.id}/reverse`).set(bearer('staff')).send({ reason: 'x' })).status).toBe(403);
      own = await mine('s1');
      expect(own[0]!.payments.map((payment) => payment.number)).toEqual([p750.body.number]);
      expect((await mine('g1'))[0]).toMatchObject({ paid: 750 });

      // 6. An invoice with a completed payment cannot be cancelled; after the last reversal it can, with a reason.
      expect((await api().post(`/api/invoices/${first.id}/status`).set(bearer('staff')).send({ action: 'cancel', reason: 'خطة خاطئة' })).body).toMatchObject({
        code: 'invoice_has_payments',
        paymentCount: 1,
      });
      await api().post(`/api/payments/${p750.body.id}/reverse`).set(bearer('accountant')).send({ reason: 'إلغاء الفاتورة' }).expect(200);
      const cancelled = await api().post(`/api/invoices/${first.id}/status`).set(bearer('staff')).send({ action: 'cancel', reason: 'خطة خاطئة' }).expect(200);
      expect(cancelled.body).toMatchObject({ status: 'cancelled', paid: 0, cancelReason: 'خطة خاطئة', number: first.number });
      expect((await api().post(`/api/invoices/${first.id}/payments`).set(bearer('staff')).send({ amount: 10, method: 'cash' })).body).toMatchObject({
        code: 'invoice_not_issued',
        status: 'cancelled',
      });
      own = await mine('s1');
      expect(own[0]).toMatchObject({ id: first.id, status: 'cancelled', payments: [] });
      const receipts = await api().get('/api/payments').query({ invoiceId: first.id }).set(bearer('accountant')).expect(200);
      expect((receipts.body.items as { id: string; status: string }[]).map((payment) => [payment.id, payment.status])).toEqual([
        [p500.body.id, 'reversed'],
        [p750.body.id, 'reversed'],
      ]);

      // 7. The second student pays in full; the office lists and filters.
      const full = await api().post(`/api/invoices/${second.id}/payments`).set(bearer('staff')).send({ amount: 1500, method: 'card' }).expect(201);
      expect(full.body.invoice).toMatchObject({ paid: 1500, balance: 0, paymentState: 'paid' });
      expect((await mine('s2'))[0]).toMatchObject({ paymentState: 'paid', nextDue: null });
      const paidList = await api().get('/api/invoices').query({ classId, balance: 'paid' }).set(bearer('accountant')).expect(200);
      expect((paidList.body.items as InvoiceLike[]).map((invoice) => invoice.id)).toEqual([second.id]);
      const classList = await api().get('/api/invoices').query({ classId }).set(bearer('staff')).expect(200);
      expect((classList.body.items as InvoiceLike[]).map((invoice) => [invoice.id, invoice.status])).toEqual([
        [second.id, 'issued'],
        [first.id, 'cancelled'],
      ]);

      // 8. The audit trail, exactly: the clerk's and the accountant's writes; nothing for the readers.
      const events = await prisma.auditLog.findMany({ where: { id: { gt: markId }, actorUserId: { in: actors } }, orderBy: { id: 'asc' } });
      const name = (id: string | null) => Object.entries(fx).find(([, value]) => value === id)?.[0];
      expect(events.map((event) => [name(event.actorUserId), event.action, event.entityId])).toEqual([
        ['staff', 'fee_plans.created', plan.body.id],
        ['staff', 'invoices.batch_created', classId],
        ['staff', 'payments.recorded', p750.body.id],
        ['staff', 'payments.recorded', p500.body.id],
        ['accountant', 'payments.reversed', p500.body.id],
        ['accountant', 'payments.reversed', p750.body.id],
        ['staff', 'invoices.cancelled', first.id],
        ['staff', 'payments.recorded', full.body.id],
      ]);
      expect(events[1]!.metadata).toMatchObject({ feePlanId: plan.body.id, issued: true, count: 2, skipped: 0, currency, total: 1500 });
      expect(events[6]!.metadata).toEqual({ number: first.number, studentId: fx['s1'], reason: 'خطة خاطئة' });
    },
    60_000,
  );
});
