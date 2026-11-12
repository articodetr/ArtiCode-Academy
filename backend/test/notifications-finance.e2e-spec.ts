// TEST-177 — MOD-12-T04 (finance): the invoice and payment writers of MOD-11
// call the notification engine (roadmap §4j.5 T04; owner decisions D-R80,
// D-R81, D-R83): `invoice.issued`, `invoice.cancelled`, `payment.recorded` and
// `payment.reversed`, for the invoice's student and their guardians. Every
// write goes through the real routes; the `notifications` table is read
// straight from the database, above an id watermark and for the fixture users
// only, because other suites share it. Skipped when no database is reachable.
//
// Fixtures (through Prisma, deleted at the end; the invoice and receipt
// numbers they consume stay consumed): a clerk (`invoices.manage` +
// `fee_plans.manage`), a cashier (`payments.record`) and a refunder
// (`payments.refund`) with custom roles; three students with the seeded
// `student` role — two enrolled in one class, the third soft-deleted later; a
// guardian with the seeded `guardian` role linked to all three; a user linked
// to the first student WITHOUT that role. Everybody has a language of their
// own, so the wording is known.
//
// The mail transport is replaced by a recorder that calls itself `none` — what
// the e2e runs configure: a due e-mail is `skipped`, nothing is queued or
// sent. One test renames it to prove that every writer hands its e-mails to
// the dispatcher after the commit, and that such an e-mail carries no amount.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { PasswordService } from '../src/auth/password.service.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { addDays } from '../src/finance/fee-plans.rules.js';
import { dayIn } from '../src/finance/invoices.calc.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { MAIL_TRANSPORT } from '../src/mail/mail.transport.js';
import type { MailDeliveryResult, MailMessage, MailTransport } from '../src/mail/mail.transport.js';
import { NotificationDispatcher } from '../src/notifications/notifications.dispatcher.js';
import type { NotificationEventKey, NotificationEventParams } from '../src/notifications/notifications.events.js';
import { childrenSuffix, formatDay, renderNotification } from '../src/notifications/notifications.templates.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `NF${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-177 supertest';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const LINK = '/my-invoices';
const INVOICE_NUMBER = /^INV-\d{4}-\d{5,}$/;
const RECEIPT_NUMBER = /^RCPT-\d{4}-\d{5,}$/;

/** What the office types and who the office is — none of it may reach a notification. */
const MARK = {
  note: `NOTE-${RUN}`,
  discount: `DISCOUNT-${RUN}`,
  reference: `REFERENCE-${RUN}`,
  payer: `PAYER-${RUN}`,
  reversal: `REVERSAL-REASON-${RUN}`,
  cancellation: `CANCEL-REASON-${RUN}`,
  staff: `STAFF-${RUN}`,
} as const;

/** The people a notification may or may not reach. `verified`: the address is confirmed, so an e-mail copy is due. */
const PEOPLE = {
  s1: { role: 'student', locale: 'en', verified: true, displayName: 'Ahmad' },
  s2: { role: 'student', locale: 'ar', verified: false, displayName: null },
  s3: { role: 'student', locale: 'en', verified: true, displayName: null },
  guardian: { role: 'guardian', locale: 'ar', verified: true, displayName: null },
  linked: { role: null, locale: 'en', verified: true, displayName: null },
} as const;
type Person = keyof typeof PEOPLE;
/** The name a guardian's copy ends with. */
const calledAs = (person: Person) => PEOPLE[person].displayName ?? `Fixture ${person}`;

type Row = Prisma.NotificationGetPayload<object>;

interface Expected<K extends NotificationEventKey> {
  /** The student the event is about. */
  student: Person;
  /** Who gets a copy. */
  recipients: readonly Person[];
  /** Exactly what the writer must hand to the engine. */
  params: NotificationEventParams[K];
  /** The ids `data` carries beside the link. */
  ids: Record<string, string>;
}

/** Stands in for the mail transport. Called `none` nothing is queued; under another name it records what the dispatcher sends. */
class RecordingTransport implements MailTransport {
  name = 'none';
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<MailDeliveryResult> {
    this.sent.push(message);
    return { transport: this.name, status: 'sent', messageId: `rec-${this.sent.length}` };
  }
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

describe.skipIf(!available)('MOD-12 finance notifications (e2e, TEST-177)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let dispatcher: NotificationDispatcher;
  let passwords: PasswordService;
  let currency: string;
  let defaultLocale: 'ar' | 'en' | 'tr';
  let due1: string;
  let due2: string;
  let classId: string;
  let planId: string;
  /** A plan that prices another course: the class batch refuses it (422). */
  let foreignPlanId: string;
  let suiteMark: string;
  const mailbox = new RecordingTransport();
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const staffIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  /** Invoices and payments by the name the tests give them. */
  const invoices: Record<string, string> = {};
  const numbers: Record<string, string> = {};
  const payments: Record<string, string> = {};

  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const who = (userId: string | null) => (userId ? (Object.entries(fx).find(([, id]) => id === userId)?.[0] ?? userId) : null);

  const createInvoice = (body: object, as = 'clerk') => api().post('/api/invoices').set(bearer(as)).send(body);
  const changeStatus = (invoiceId: string, body: object, as = 'clerk') => api().post(`/api/invoices/${invoiceId}/status`).set(bearer(as)).send(body);
  const pay = (invoiceId: string, body: object, as = 'cashier') => api().post(`/api/invoices/${invoiceId}/payments`).set(bearer(as)).send(body);
  const reverse = (paymentId: string, body: object, as = 'refunder') => api().post(`/api/payments/${paymentId}/reverse`).set(bearer(as)).send(body);
  const invoiceClass = (body: object, as = 'clerk', id = classId) => api().post(`/api/classes/${id}/invoices`).set(bearer(as)).send(body);

  /** The body of a response that must have this status; the body is in the failure message. */
  function body(res: Response, status: number): any {
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body;
  }

  /** A one-line, one-installment draft for a student, through the API. */
  async function draftFor(student: Person, amount: number, dueOn: string): Promise<string> {
    const created = body(await createInvoice({ studentId: fx[student], lines: [{ description: { ar: 'رسوم' }, amount }], installments: [{ amount, dueOn }], notes: MARK.note }), 201);
    expect(created).toMatchObject({ status: 'draft', number: null });
    return created.id as string;
  }

  /** The first due day the API shows for an invoice. */
  async function firstDueOf(invoiceId: string): Promise<string> {
    const invoice = body(await api().get(`/api/invoices/${invoiceId}`).set(bearer('clerk')), 200);
    return invoice.installments[0].dueOn as string;
  }

  /** The newest notification id: what a request writes comes after it. */
  async function watermark(): Promise<string> {
    return (await prisma.notification.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;
  }
  const since = (mark: string): Promise<Row[]> => prisma.notification.findMany({ where: { id: { gt: mark }, recipientUserId: { in: createdUserIds } }, orderBy: { id: 'asc' } });

  async function auditMark(): Promise<string> {
    return (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;
  }
  const auditSince = async (mark: string) =>
    (await prisma.auditLog.findMany({ where: { id: { gt: mark }, actorUserId: { in: staffIds } }, orderBy: { id: 'asc' } })).map((event) => [event.action, event.entityId, event.metadata]);

  const plain = (row: Row) => ({
    to: who(row.recipientUserId),
    about: who(row.studentUserId),
    eventKey: row.eventKey,
    category: row.category,
    title: row.title,
    body: row.body,
    data: row.data,
    readAt: row.readAt,
    announcementId: row.announcementId,
    emailStatus: row.emailStatus,
  });
  const inOrder = <T extends { to: string | null; about: string | null }>(items: T[]): T[] => [...items].sort((a, b) => `${a.to}/${a.about}`.localeCompare(`${b.to}/${b.about}`));

  /**
   * The rows of one request are exactly these: one per (recipient × student),
   * worded in the recipient's language from exactly these parameters, a
   * guardian's copy naming the child; `finance`, unread, pointing at «my
   * invoices» with the ids alone; the e-mail copy `skipped` for a confirmed
   * address and `none` for an unconfirmed one (no transport).
   */
  function expectNotified<K extends NotificationEventKey>(rows: Row[], key: K, expected: ReadonlyArray<Expected<K>>): void {
    const wanted = expected.flatMap((item) =>
      item.recipients.map((recipient) => {
        const reader = PEOPLE[recipient];
        const text = renderNotification(key, item.params, reader.locale, defaultLocale);
        return {
          to: recipient as string,
          about: item.student as string,
          eventKey: key as string,
          category: 'finance',
          title: text.title,
          body: recipient === item.student ? text.body : `${text.body} ${childrenSuffix([calledAs(item.student)], reader.locale)}`,
          data: { link: LINK, ...item.ids },
          readAt: null,
          announcementId: null,
          emailStatus: reader.verified ? 'skipped' : 'none',
        };
      }),
    );
    expect(inOrder(rows.map(plain))).toEqual(inOrder(wanted));
  }

  /** No title, body or data carries a note, a reason, a reference, a payer or a staff name. */
  function expectNoLeak(rows: Row[]): void {
    for (const row of rows) {
      const text = `${row.title}\n${row.body}\n${JSON.stringify(row.data)}`;
      for (const [what, marker] of Object.entries(MARK)) expect(text, `${row.eventKey} carries the ${what}`).not.toContain(marker);
    }
  }
  const rowOf = (rows: Row[], recipient: Person): Row => rows.find((row) => row.recipientUserId === fx[recipient])!;

  async function createRole(key: string, keys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_${key}_${RUN.toLowerCase()}`, label: { ar: `دور اختبار ${key}` }, permissions: { create: keys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(name: string, data: { fullName: string; displayName: string | null; locale: 'ar' | 'en'; verified: boolean; roleIds: string[]; signsIn: boolean }): Promise<void> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: data.fullName,
        displayName: data.displayName,
        locale: data.locale,
        status: 'active',
        passwordHash: data.signsIn ? await passwords.hash(PASSWORD) : null,
        emailVerifiedAt: data.verified ? new Date() : null,
        roles: { create: data.roleIds.map((roleId) => ({ roleId })) },
      },
      select: { id: true },
    });
    fx[name] = user.id;
    createdUserIds.push(user.id);
    if (data.signsIn) tokens[name] = body(await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(name), password: PASSWORD }), 200).accessToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_TRANSPORT)
      .useValue(mailbox)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    dispatcher = app.get(NotificationDispatcher);
    passwords = new PasswordService();
    const academy = await prisma.academy.findFirstOrThrow({ select: { currency: true, timezone: true, defaultLocale: true } });
    currency = academy.currency;
    defaultLocale = academy.defaultLocale;
    // The first due day lies ahead, so nothing here is overdue.
    const today = dayIn(academy.timezone, new Date());
    due1 = addDays(today, 3);
    due2 = addDays(today, 33);

    for (const [name, keys] of [
      ['clerk', ['invoices.manage', 'fee_plans.manage']],
      ['cashier', ['payments.record']],
      ['refunder', ['payments.refund']],
    ] as const) {
      await createUser(name, { fullName: `${name} ${MARK.staff}`, displayName: null, locale: 'en', verified: true, roleIds: [await createRole(`nf${name}`, keys)], signsIn: true });
      staffIds.push(fx[name]!);
    }
    const seeded = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
    const roleIds = { student: await seeded('student'), guardian: await seeded('guardian') };
    for (const name of Object.keys(PEOPLE) as Person[]) {
      const person = PEOPLE[name];
      await createUser(name, {
        fullName: `Fixture ${name}`,
        displayName: person.displayName,
        locale: person.locale,
        verified: person.verified,
        roleIds: person.role ? [roleIds[person.role]] : [],
        signsIn: false,
      });
    }
    for (const [guardianName, studentName] of [
      ['guardian', 's1'],
      ['guardian', 's2'],
      ['guardian', 's3'],
      // A link without the `guardian` role grants nothing.
      ['linked', 's1'],
    ] as const) {
      await prisma.guardianStudent.create({ data: { guardianUserId: fx[guardianName]!, studentUserId: fx[studentName]!, relationship: 'father' }, select: { studentUserId: true } });
    }
    const courseId = (await prisma.course.create({ data: { code: `${PREFIX}-C`, name: { ar: 'دورة إشعارات المالية' }, status: 'published' }, select: { id: true } })).id;
    classId = (await prisma.class.create({ data: { courseId, code: `${PREFIX}-A`, name: { ar: 'فصل إشعارات المالية' }, capacity: 10, status: 'running' }, select: { id: true } })).id;
    // In this order: the class batch invoices the enrollments in the order of their ids.
    for (const name of ['s1', 's2'] as const) await prisma.enrollment.create({ data: { classId, studentUserId: fx[name]!, status: 'active' }, select: { id: true } });
    const otherCourseId = (await prisma.course.create({ data: { code: `${PREFIX}-X`, name: { ar: 'دورة أخرى' }, status: 'published' }, select: { id: true } })).id;
    foreignPlanId = (
      await prisma.feePlan.create({
        data: { name: { ar: `خطة دورة أخرى ${PREFIX}` }, courseId: otherCourseId, lines: [{ description: { ar: 'رسوم' }, amount: 100 }], installments: [{ percent: 100, dueOffsetDays: 0 }] },
        select: { id: true },
      })
    ).id;
    suiteMark = await watermark();
  }, 120_000);

  afterAll(async () => {
    try {
      if (dispatcher) await dispatcher.whenIdle();
      if (prisma) {
        await prisma.payment.deleteMany({ where: { invoice: { studentUserId: { in: createdUserIds } } } });
        await prisma.invoice.deleteMany({ where: { studentUserId: { in: createdUserIds } } });
        await prisma.feePlan.deleteMany({ where: { id: { in: [planId, foreignPlanId].filter((id) => id !== undefined) } } });
        if (classId) await prisma.enrollment.deleteMany({ where: { classId } });
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
      }
    } finally {
      // Deleting the recipients removes their notifications and links with them.
      if (prisma && createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (prisma && createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  }, 60_000);

  it(
    'a draft notifies nobody: created by hand, edited, created for a class and deleted — nor does a fee plan',
    async () => {
      const mark = await watermark();
      const audit = await auditMark();
      const plan = body(
        await api()
          .post('/api/fee-plans')
          .set(bearer('clerk'))
          .send({ name: { ar: `خطة ${PREFIX}` }, classId, lines: [{ description: { ar: 'رسوم الفصل' }, amount: 900 }], installments: [{ percent: 100, dueOffsetDays: 7 }] }),
        201,
      );
      planId = plan.id as string;

      const draft = body(
        await createInvoice({
          studentId: fx['s1'],
          lines: [
            { description: { ar: 'رسوم الدورة' }, amount: 1000 },
            { description: { ar: 'الكتب' }, amount: 500 },
          ],
          discountAmount: 100,
          discountReason: MARK.discount,
          installments: [
            { amount: 700, dueOn: due1 },
            { amount: 700, dueOn: due2 },
          ],
          notes: MARK.note,
        }),
        201,
      );
      invoices['A'] = draft.id as string;
      expect(draft).toMatchObject({ status: 'draft', number: null, total: 1400, currency });
      const edited = body(
        await api()
          .patch(`/api/invoices/${invoices['A']}`)
          .set(bearer('clerk'))
          .send({
            installments: [
              { amount: 800.25, dueOn: due1 },
              { amount: 599.75, dueOn: due2 },
            ],
          }),
        200,
      );
      expect(edited).toMatchObject({ status: 'draft', total: 1400 });

      // The class batch without `issue` leaves drafts.
      const batch = body(await invoiceClass({ feePlanId: planId }), 200);
      expect((batch.created as { student: { id: string }; status: string; number: string | null; total: number }[]).map((invoice) => [who(invoice.student.id), invoice.status, invoice.number, invoice.total])).toEqual([
        ['s1', 'draft', null, 900],
        ['s2', 'draft', null, 900],
      ]);
      const [spare, kept] = batch.created as [{ id: string }, { id: string }];
      invoices['B'] = kept.id;
      await api().delete(`/api/invoices/${spare.id}`).set(bearer('clerk')).expect(204);

      expect(await since(mark)).toEqual([]);
      // The routes recorded what they always did.
      expect((await auditSince(audit)).map(([action, entityId]) => [action, entityId])).toEqual([
        ['fee_plans.created', planId],
        ['invoices.created', invoices['A']],
        ['invoices.updated', invoices['A']],
        ['invoices.batch_created', classId],
        ['invoices.deleted', spare.id],
      ]);
    },
    30_000,
  );

  it(
    'issuing an invoice tells the student and the guardian — one notification each, about that student — its number, its total in the invoice currency and the first due day',
    async () => {
      const mark = await watermark();
      const audit = await auditMark();
      const issued = body(await changeStatus(invoices['A']!, { action: 'issue' }), 200);
      expect(issued).toMatchObject({ id: invoices['A'], status: 'issued', total: 1400, currency, issuedBy: { fullName: `clerk ${MARK.staff}` } });
      expect(issued.number).toMatch(INVOICE_NUMBER);
      numbers['A'] = issued.number as string;

      const rows = await since(mark);
      // Not the linked user without the `guardian` role, not the clerk, nobody else.
      expectNotified(rows, 'invoice.issued', [
        {
          student: 's1',
          recipients: ['s1', 'guardian'],
          params: { invoiceId: invoices['A']!, number: numbers['A'], total: '1400.00', currency, firstDueOn: due1 },
          ids: { invoiceId: invoices['A']! },
        },
      ]);
      const own = rowOf(rows, 's1');
      expect(own.title).toContain(numbers['A']);
      expect(own.body).toContain(numbers['A']);
      expect(own.body).toContain(`1400.00 ${currency}`);
      // The earliest installment, not the later one.
      expect(own.body).toContain(formatDay(due1, 'en'));
      expect(own.body).not.toContain(formatDay(due2, 'en'));
      const guardians = rowOf(rows, 'guardian');
      expect(guardians.body).toContain(`1400.00 ${currency}`);
      expect(guardians.body).toContain(formatDay(due1, 'ar'));
      expect(guardians.body.endsWith(childrenSuffix(['Ahmad'], 'ar'))).toBe(true);
      // Never the internal note, the discount reason or who issued it.
      expectNoLeak(rows);
      expect(await auditSince(audit)).toEqual([['invoices.issued', invoices['A'], { number: numbers['A'], studentId: fx['s1'], currency, total: 1400, installments: 2 }]]);
    },
    30_000,
  );

  it(
    'a recorded payment tells them the receipt and its amount — never the note, the reference, the payer or the recorder',
    async () => {
      const mark = await watermark();
      const audit = await auditMark();
      const paid = body(await pay(invoices['A']!, { amount: 600.5, method: 'bank_transfer', reference: MARK.reference, payerName: MARK.payer, notes: MARK.note }), 201);
      expect(paid).toMatchObject({
        amount: 600.5,
        currency,
        status: 'completed',
        reference: MARK.reference,
        payerName: MARK.payer,
        notes: MARK.note,
        recordedBy: { fullName: `cashier ${MARK.staff}` },
        invoice: { id: invoices['A'], number: numbers['A'], paid: 600.5, balance: 799.5, paymentState: 'partial' },
      });
      expect(paid.number).toMatch(RECEIPT_NUMBER);
      payments['p1'] = paid.id as string;
      numbers['p1'] = paid.number as string;

      const rows = await since(mark);
      expectNotified(rows, 'payment.recorded', [
        {
          student: 's1',
          recipients: ['s1', 'guardian'],
          params: { paymentId: payments['p1'], invoiceId: invoices['A']!, receiptNumber: numbers['p1'], invoiceNumber: numbers['A']!, amount: '600.50', currency },
          ids: { paymentId: payments['p1'], invoiceId: invoices['A']! },
        },
      ]);
      for (const row of rows) {
        expect(row.title).toContain(numbers['p1']);
        expect(row.body).toContain(numbers['p1']);
        expect(row.body).toContain(numbers['A']);
        expect(row.body).toContain(`600.50 ${currency}`);
      }
      expectNoLeak(rows);
      expect(await auditSince(audit)).toEqual([
        ['payments.recorded', payments['p1'], { invoiceId: invoices['A'], invoiceNumber: numbers['A'], number: numbers['p1'], amount: 600.5, currency, method: 'bank_transfer' }],
      ]);
    },
    30_000,
  );

  it(
    'a reversed payment tells them the receipt — never the reason; a second reversal tells nobody',
    async () => {
      const mark = await watermark();
      const audit = await auditMark();
      const reversed = body(await reverse(payments['p1']!, { reason: MARK.reversal }), 200);
      expect(reversed).toMatchObject({ id: payments['p1'], status: 'reversed', reverseReason: MARK.reversal, reversedBy: { fullName: `refunder ${MARK.staff}` }, invoice: { paid: 0, balance: 1400, paymentState: 'unpaid' } });

      const rows = await since(mark);
      expectNotified(rows, 'payment.reversed', [
        {
          student: 's1',
          recipients: ['s1', 'guardian'],
          params: { paymentId: payments['p1']!, invoiceId: invoices['A']!, receiptNumber: numbers['p1']!, invoiceNumber: numbers['A']! },
          ids: { paymentId: payments['p1']!, invoiceId: invoices['A']! },
        },
      ]);
      for (const row of rows) {
        expect(row.title).toContain(numbers['p1']);
        expect(row.body).toContain(numbers['A']);
        // The amount is not repeated either.
        expect(row.body).not.toContain('600.5');
      }
      expectNoLeak(rows);
      expect(await auditSince(audit)).toEqual([
        ['payments.reversed', payments['p1'], { invoiceId: invoices['A'], invoiceNumber: numbers['A'], number: numbers['p1'], amount: 600.5, reason: MARK.reversal }],
      ]);

      const again = await watermark();
      expect(body(await reverse(payments['p1']!, { reason: MARK.reversal }), 409)).toMatchObject({ code: 'payment_reversed', paymentId: payments['p1'] });
      expect(await since(again)).toEqual([]);
    },
    30_000,
  );

  it(
    'a cancelled invoice tells them its number — never the reason; the guardian of two students has one notification per invoice',
    async () => {
      // The draft the class batch left for the second student, issued through the status route.
      let mark = await watermark();
      const issued = body(await changeStatus(invoices['B']!, { action: 'issue' }), 200);
      numbers['B'] = issued.number as string;
      const dueOn = await firstDueOf(invoices['B']!);
      // The second student's address is unconfirmed: no e-mail copy is due (`none`).
      expectNotified(await since(mark), 'invoice.issued', [
        { student: 's2', recipients: ['s2', 'guardian'], params: { invoiceId: invoices['B']!, number: numbers['B'], total: '900.00', currency, firstDueOn: dueOn }, ids: { invoiceId: invoices['B']! } },
      ]);
      const guardianIssued = await prisma.notification.findMany({ where: { recipientUserId: fx['guardian']!, eventKey: 'invoice.issued', id: { gt: suiteMark } }, orderBy: { id: 'asc' } });
      expect(guardianIssued.map((row) => [who(row.studentUserId), row.data])).toEqual([
        ['s1', { link: LINK, invoiceId: invoices['A'] }],
        ['s2', { link: LINK, invoiceId: invoices['B'] }],
      ]);

      mark = await watermark();
      const audit = await auditMark();
      const cancelled = body(await changeStatus(invoices['B']!, { action: 'cancel', reason: MARK.cancellation }), 200);
      expect(cancelled).toMatchObject({ status: 'cancelled', number: numbers['B'], cancelReason: MARK.cancellation });
      const rows = await since(mark);
      expectNotified(rows, 'invoice.cancelled', [{ student: 's2', recipients: ['s2', 'guardian'], params: { invoiceId: invoices['B']!, number: numbers['B'] }, ids: { invoiceId: invoices['B']! } }]);
      for (const row of rows) {
        expect(row.title).toContain(numbers['B']);
        expect(row.body).toContain(numbers['B']);
      }
      expect(rowOf(rows, 'guardian').body.endsWith(childrenSuffix(['Fixture s2'], 'ar'))).toBe(true);
      expectNoLeak(rows);
      expect(await auditSince(audit)).toEqual([['invoices.cancelled', invoices['B'], { number: numbers['B'], studentId: fx['s2'], reason: MARK.cancellation }]]);
    },
    30_000,
  );

  it(
    'the class batch that issues at once notifies like `issue`: one notification per (recipient × student) from one request; a repeat creates and notifies nothing',
    async () => {
      // Both enrollments are free again: the first student's batch draft was deleted, the second's invoice is cancelled.
      const mark = await watermark();
      const audit = await auditMark();
      const batch = body(await invoiceClass({ feePlanId: planId, issue: true }), 200);
      const created = batch.created as { id: string; number: string; status: string; total: number; student: { id: string } }[];
      expect(created.map((invoice) => [who(invoice.student.id), invoice.status, invoice.total])).toEqual([
        ['s1', 'issued', 900],
        ['s2', 'issued', 900],
      ]);
      expect(batch.skipped).toEqual([]);
      const [first, second] = created as [(typeof created)[number], (typeof created)[number]];
      expect(first.number).toMatch(INVOICE_NUMBER);
      expect(second.number).not.toBe(first.number);
      invoices['batchS1'] = first.id;

      const rows = await since(mark);
      expectNotified(rows, 'invoice.issued', [
        {
          student: 's1',
          recipients: ['s1', 'guardian'],
          params: { invoiceId: first.id, number: first.number, total: '900.00', currency, firstDueOn: await firstDueOf(first.id) },
          ids: { invoiceId: first.id },
        },
        {
          student: 's2',
          recipients: ['s2', 'guardian'],
          params: { invoiceId: second.id, number: second.number, total: '900.00', currency, firstDueOn: await firstDueOf(second.id) },
          ids: { invoiceId: second.id },
        },
      ]);
      // The guardian of both: two notifications, one per invoice — never one naming both children.
      expect(rows.filter((row) => row.recipientUserId === fx['guardian']).map((row) => [who(row.studentUserId), (row.data as { invoiceId: string }).invoiceId])).toEqual([
        ['s1', first.id],
        ['s2', second.id],
      ]);
      expectNoLeak(rows);
      const events = await auditSince(audit);
      expect(events.map(([action, entityId]) => [action, entityId])).toEqual([['invoices.batch_created', classId]]);
      expect(events[0]![2]).toMatchObject({ feePlanId: planId, issued: true, count: 2, invoiceIds: [first.id, second.id], skipped: 0 });

      const again = await watermark();
      const repeat = body(await invoiceClass({ feePlanId: planId, issue: true }), 200);
      expect(repeat.created).toEqual([]);
      expect((repeat.skipped as { reason: string }[]).map((skip) => skip.reason)).toEqual(['already_invoiced', 'already_invoiced']);
      expect(await since(again)).toEqual([]);
    },
    30_000,
  );

  it(
    'a refused request notifies nobody: over the balance, an invoice that is not issued, an invoice with a payment, a second reversal, a caller without the key, an unknown id, an invalid body',
    async () => {
      // An issued invoice with one completed payment (A), a draft (D), a cancelled invoice (B), a reversed payment (p1).
      payments['p2'] = body(await pay(invoices['A']!, { amount: 100, method: 'cash' }), 201).id as string;
      invoices['D'] = await draftFor('s2', 300, due1);
      const mark = await watermark();
      const audit = await auditMark();
      const cash = { amount: 10, method: 'cash' };

      expect(body(await pay(invoices['A']!, { amount: 1300.01, method: 'cash' }), 409)).toMatchObject({ code: 'payment_exceeds_balance', amount: 1300.01, balance: 1300 });
      expect(body(await pay(invoices['D']!, cash), 409)).toMatchObject({ code: 'invoice_not_issued', status: 'draft' });
      expect(body(await pay(invoices['B']!, cash), 409)).toMatchObject({ code: 'invoice_not_issued', status: 'cancelled' });
      expect(body(await changeStatus(invoices['A']!, { action: 'cancel', reason: MARK.cancellation }), 409)).toMatchObject({ code: 'invoice_has_payments', paymentCount: 1 });
      expect(body(await changeStatus(invoices['A']!, { action: 'issue' }), 409)).toMatchObject({ code: 'invalid_transition', from: 'issued' });
      expect(body(await changeStatus(invoices['D']!, { action: 'cancel', reason: MARK.cancellation }), 409)).toMatchObject({ code: 'invalid_transition', from: 'draft' });
      expect(body(await changeStatus(invoices['B']!, { action: 'issue' }), 409)).toMatchObject({ code: 'invalid_transition', from: 'cancelled' });
      expect(body(await reverse(payments['p1']!, { reason: MARK.reversal }), 409)).toMatchObject({ code: 'payment_reversed' });
      // A caller without the key of the route.
      expect(body(await changeStatus(invoices['D']!, { action: 'issue' }, 'cashier'), 403)).toMatchObject({ code: 'permission_denied', missing: ['invoices.manage'] });
      expect(body(await changeStatus(invoices['A']!, { action: 'cancel', reason: MARK.cancellation }, 'refunder'), 403)).toMatchObject({ code: 'permission_denied' });
      expect(body(await pay(invoices['A']!, cash, 'clerk'), 403)).toMatchObject({ code: 'permission_denied', missing: ['payments.record'] });
      expect(body(await reverse(payments['p2']!, { reason: MARK.reversal }, 'cashier'), 403)).toMatchObject({ code: 'permission_denied', missing: ['payments.refund'] });
      expect(body(await invoiceClass({ feePlanId: planId, issue: true }, 'cashier'), 403)).toMatchObject({ code: 'permission_denied' });
      // Nothing with this id.
      expect(body(await changeStatus(NIL_ID, { action: 'issue' }), 404)).toMatchObject({ code: 'invoice_not_found' });
      expect(body(await pay(NIL_ID, cash), 404)).toMatchObject({ code: 'invoice_not_found' });
      expect(body(await reverse(NIL_ID, { reason: MARK.reversal }), 404)).toMatchObject({ code: 'payment_not_found' });
      expect(body(await invoiceClass({ feePlanId: planId, issue: true }, 'clerk', NIL_ID), 404)).toMatchObject({ code: 'class_not_found' });
      // A plan that prices another course.
      expect(body(await invoiceClass({ feePlanId: foreignPlanId, issue: true }), 422)).toMatchObject({ code: 'fee_plan_mismatch', feePlanId: foreignPlanId, classId });
      // A body the route does not accept.
      body(await changeStatus(invoices['A']!, { action: 'cancel' }), 400);
      body(await pay(invoices['A']!, { amount: 0, method: 'cash' }), 400);
      body(await reverse(payments['p2']!, {}), 400);

      expect(await since(mark)).toEqual([]);
      expect(await auditSince(audit)).toEqual([]);
      // The refused requests changed nothing: the payment stands, the invoice is still issued.
      expect(await prisma.invoice.findUniqueOrThrow({ where: { id: invoices['A']! }, select: { status: true, paidAmount: true } })).toMatchObject({ status: 'issued' });
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: payments['p2']! }, select: { status: true } })).status).toBe('completed');
    },
    60_000,
  );

  it(
    'the invoice of a soft-deleted student notifies nobody — not the guardian either',
    async () => {
      // Created while the account was live; the office still settles it afterwards.
      const invoiceId = await draftFor('s3', 500, due1);
      await prisma.user.update({ where: { id: fx['s3']! }, data: { deletedAt: new Date(), status: 'archived' } });
      const mark = await watermark();
      expect(body(await changeStatus(invoiceId, { action: 'issue' }), 200)).toMatchObject({ status: 'issued' });
      const paid = body(await pay(invoiceId, { amount: 50, method: 'cash' }), 201);
      expect(body(await reverse(paid.id as string, { reason: MARK.reversal }), 200)).toMatchObject({ status: 'reversed' });
      expect(body(await changeStatus(invoiceId, { action: 'cancel', reason: MARK.cancellation }), 200)).toMatchObject({ status: 'cancelled' });
      expect(await since(mark)).toEqual([]);
    },
    30_000,
  );

  it(
    'the amounts are worded in the currency of the invoice — not in whatever the academy uses today',
    async () => {
      // As if the academy had changed its currency after the draft was written: an invoice keeps the currency of its creation (D-R59).
      const foreign = currency === 'XTS' ? 'XXX' : 'XTS';
      const invoiceId = await draftFor('s2', 75.5, due1);
      await prisma.invoice.update({ where: { id: invoiceId }, data: { currency: foreign } });

      let mark = await watermark();
      const issued = body(await changeStatus(invoiceId, { action: 'issue' }), 200);
      expect(issued).toMatchObject({ status: 'issued', currency: foreign, total: 75.5 });
      let rows = await since(mark);
      expectNotified(rows, 'invoice.issued', [
        { student: 's2', recipients: ['s2', 'guardian'], params: { invoiceId, number: issued.number as string, total: '75.50', currency: foreign, firstDueOn: due1 }, ids: { invoiceId } },
      ]);
      for (const row of rows) expect(row.body).toContain(`75.50 ${foreign}`);

      mark = await watermark();
      const paid = body(await pay(invoiceId, { amount: 75.5, method: 'cash' }), 201);
      expect(paid).toMatchObject({ currency: foreign, invoice: { paid: 75.5, balance: 0, paymentState: 'paid' } });
      rows = await since(mark);
      expectNotified(rows, 'payment.recorded', [
        {
          student: 's2',
          recipients: ['s2', 'guardian'],
          params: { paymentId: paid.id as string, invoiceId, receiptNumber: paid.number as string, invoiceNumber: issued.number as string, amount: '75.50', currency: foreign },
          ids: { paymentId: paid.id as string, invoiceId },
        },
      ]);
      for (const row of rows) expect(row.body).toContain(`75.50 ${foreign}`);
    },
    30_000,
  );

  it(
    'with a transport every writer hands its e-mails to the dispatcher after the commit; the e-mail carries the title and the link — never an amount, a note or a reason',
    async () => {
      const invoiceId = await draftFor('s1', 1234.56, due1);
      const mark = await watermark();
      const sentBefore = mailbox.sent.length;
      mailbox.name = 'recording';
      try {
        body(await changeStatus(invoiceId, { action: 'issue' }), 200);
        const paid = body(await pay(invoiceId, { amount: 234.56, method: 'card', notes: MARK.note, payerName: MARK.payer }), 201);
        body(await reverse(paid.id as string, { reason: MARK.reversal }), 200);
        body(await changeStatus(invoiceId, { action: 'cancel', reason: MARK.cancellation }), 200);
        // The class batch too: the first student's batch invoice is cancelled, so the batch issues one again.
        body(await changeStatus(invoices['batchS1']!, { action: 'cancel', reason: MARK.cancellation }), 200);
        const batch = body(await invoiceClass({ feePlanId: planId, issue: true }), 200);
        expect((batch.created as { student: { id: string }; status: string }[]).map((invoice) => [who(invoice.student.id), invoice.status])).toEqual([['s1', 'issued']]);
        await dispatcher.whenIdle();
      } finally {
        mailbox.name = 'none';
      }

      const rows = await since(mark);
      // Six writes, each for the student and the guardian — both with a confirmed address.
      expect(rows.map((row) => [row.eventKey, who(row.recipientUserId)])).toEqual(
        ['invoice.issued', 'payment.recorded', 'payment.reversed', 'invoice.cancelled', 'invoice.cancelled', 'invoice.issued'].flatMap((key) => [
          [key, 's1'],
          [key, 'guardian'],
        ]),
      );
      for (const row of rows) {
        expect(row, row.eventKey).toMatchObject({ emailStatus: 'sent', emailFailure: null });
        expect(row.emailSentAt).toBeInstanceOf(Date);
        expect(row.emailMessageId).toMatch(/^rec-\d+$/);
      }
      // In the app the amounts are there …
      expect(rows.filter((row) => row.eventKey === 'invoice.issued')[0]!.body).toContain(`1234.56 ${currency}`);
      expect(rows.filter((row) => row.eventKey === 'payment.recorded')[0]!.body).toContain(`234.56 ${currency}`);
      // … in the e-mail never: the title (a document number) and the link to «my invoices».
      const mails = mailbox.sent.slice(sentBefore);
      expect(mails).toHaveLength(rows.length);
      for (const row of rows) {
        const to = email(who(row.recipientUserId)!);
        expect(mails.filter((mail) => mail.to === to && mail.subject.endsWith(row.title)), `${row.eventKey} to ${to}`).toHaveLength(1);
      }
      for (const mail of mails) {
        expect(mail.kind).toBe('notification');
        expect(mail.text).toContain(LINK);
        for (const hidden of ['234.56', '900.00', ...Object.values(MARK)]) {
          expect(mail.subject).not.toContain(hidden);
          expect(mail.text).not.toContain(hidden);
          expect(mail.html).not.toContain(hidden);
        }
      }
    },
    60_000,
  );

  it(
    'every notification of the run is `finance`, unread and points at «my invoices»; only the two live students and their guardian received any',
    async () => {
      const rows = await since(suiteMark);
      expect([...new Set(rows.map((row) => row.category))]).toEqual(['finance']);
      expect([...new Set(rows.map((row) => (row.data as { link?: string }).link))]).toEqual([LINK]);
      // Never the linked user without the `guardian` role, the soft-deleted student or a member of staff.
      expect([...new Set(rows.map((row) => who(row.recipientUserId)))].sort()).toEqual(['guardian', 's1', 's2']);
      expect(rows.every((row) => row.readAt === null && row.announcementId === null && row.studentUserId !== null)).toBe(true);
      const counts: Record<string, number> = {};
      for (const row of rows) counts[row.eventKey] = (counts[row.eventKey] ?? 0) + 1;
      // Two per write (the student and the guardian): seven invoices of live students issued, four payments recorded, two reversed, three invoices cancelled.
      expect(counts).toEqual({ 'invoice.issued': 14, 'payment.recorded': 8, 'payment.reversed': 4, 'invoice.cancelled': 6 });
      expectNoLeak(rows);
      // D-R86: a notification is never audited — the staff's events are the finance writes and their sign-ins.
      const actions = (await prisma.auditLog.findMany({ where: { actorUserId: { in: staffIds } }, select: { action: true } })).map((event) => event.action);
      expect([...new Set(actions)].filter((action) => !/^(auth|fee_plans|invoices|payments)\./.test(action))).toEqual([]);
    },
    30_000,
  );
});
