// TEST-179 — the MOD-12 module gate and the Stage 5 gate «invoice → payment →
// notification» (MOD-12-T06; roadmap §4j.5; owner decisions D-R79..D-R86):
// WF-15 "a notification from a real event" through the API against the live
// development database. Skipped when no database is reachable.
//
// Four people with the seeded system roles: a teacher (`teacher`) who leads
// the class, an office clerk (`staff` — invoices and payments), a student
// (`student`, reads English) with an active enrollment and that student's
// guardian (`guardian`, reads Arabic) — both with a confirmed address. The
// course, the running class with its lead teacher, the enrollment and the
// guardian link come from Prisma (WF-03/WF-04 are other journeys); every
// write of the journey goes through its real route, and after each one the
// student and the guardian read «my notifications» and the unread counter as
// the frontend would:
//
//   1. the teacher creates an assignment (a draft tells nobody) and publishes
//      it                                    → `assignment.published`
//   2. the student hands the work in (tells nobody), the teacher grades it
//                                            → `submission.graded`
//   3. the clerk writes an invoice (a draft tells nobody), issues it
//                                            → `invoice.issued`
//      and records a first payment           → `payment.recorded`
//   4. the teacher announces to the class    → `announcement`
//   5. the inbox: everything newest first, by category, unread only
//   6. read marks: one notification, one category, everything — the counter
//      follows and the guardian's inbox does not move
//   7. ownership: the guardian's notification does not exist for the student
//   8. e-mail: the runs have no mail transport, so every copy that was due is
//      `skipped`; the guardian switches one category off and the next event
//      of that category leaves their copy `none`
//   9. nobody else was told anything, and no notification carries a feedback,
//      a note or a payer
//  10. the audit trail: the ten writes, in order — and nothing for any read,
//      mark or preference
//  11. the rows the journey left in the database, counted — the cleanup
//      removes them and counts again
//
// Nothing is stubbed: the mail transport is what vitest.config.e2e.ts forces
// (`MAIL_TRANSPORT=none`), so nothing is ever e-mailed. The announcement goes
// to the fixture class only — never to an academy audience, which would reach
// real accounts of the shared database. Fixtures carry a unique prefix and
// are deleted at the end, which the suite then verifies; the audit rows stay
// (append-only — KI-032) and the invoice and receipt numbers stay consumed.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { PasswordService } from '../src/auth/password.service.js';
import type { LocaleCode } from '../src/authorization/localized-text.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { addDays } from '../src/finance/fee-plans.rules.js';
import { dayIn } from '../src/finance/invoices.calc.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { MailService } from '../src/mail/mail.service.js';
import type { NotificationEventKey, NotificationEventParams } from '../src/notifications/notifications.events.js';
import { childrenSuffix, renderNotification } from '../src/notifications/notifications.templates.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
/** Prefix of the course and class codes. */
const PREFIX = `NJ${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-179 supertest';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const INBOX = '/api/me/notifications';
const PREFERENCES = '/api/me/notification-preferences';
const HOUR = 3_600_000;
/** An instant relative to now, as the API takes and returns it (UTC, milliseconds). */
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
/** The six categories in the order the preferences list them. */
const CATEGORIES = ['lessons', 'assignments', 'exams', 'grades', 'finance', 'announcements'] as const;

/** Whose inbox the journey reads, and the language their notifications are worded in. */
const READERS = ['student', 'guardian'] as const;
type Reader = (typeof READERS)[number];
type Person = Reader | 'teacher' | 'office';
const LOCALE = { student: 'en', guardian: 'ar' } as const;
/** The name a guardian's copy mentions the child by: the display name. */
const STUDENT_NAME = 'Lina';

const CLASS_NAME = { ar: 'فصل رحلة الإشعارات', en: 'Notifications journey class' };
const HOMEWORK = { ar: 'واجب الوحدة الأولى', en: 'Unit one homework' };
const REVISION = { ar: 'ورقة المراجعة', en: 'Revision sheet' };
/** Marks inside the announcement's title and body: they reach every recipient and never the audit log. */
const TITLE_MARK = `TITLE-${RUN}`;
const BODY_MARK = `BODY-${RUN}`;
/** The sender's own words, delivered as typed: two languages, markup that stays text, line breaks. */
const ANNOUNCEMENT_TITLE = `تأجيل درس الغد — Tomorrow's lesson moves <to> room 4 (${TITLE_MARK})`;
const ANNOUNCEMENT_BODY = `السلام عليكم،\nيُؤجَّل درس الغد إلى يوم الخميس في الموعد نفسه.\n\nTomorrow's lesson moves to Thursday & keeps its hour (${BODY_MARK})`;
/** What the teacher and the office type for themselves or for the record: no notification may carry it (D-R83). */
const FEEDBACK = `FEEDBACK-${RUN} well argued`;
const OFFICE_NOTE = `NOTE-${RUN}`;
const PAYER = `PAYER-${RUN}`;

/** A notification as «my notifications» answers it (API-167): exactly these ten fields — no e-mail state, no address. */
interface InboxItem {
  id: string;
  eventKey: string;
  category: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  student: { id: string; fullName: string; displayName: string | null } | null;
  announcementId: string | null;
  readAt: string | null;
  createdAt: string;
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

describe.skipIf(!available)('WF-15 notification journey — the MOD-12 and Stage 5 gate (e2e, TEST-179)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let academyTimeZone: string;
  let defaultLocale: LocaleCode;
  let currency: string;
  let today: string;
  let classId: string;
  let enrollmentId: string;
  const createdUserIds: string[] = [];
  const fx = {} as Record<Person, string>;
  const tokens = {} as Record<Person, string>;
  /** The newest notification each reader has seen so far: whatever their inbox lists above it is new. */
  const newest: Record<Reader, string> = { student: NIL_ID, guardian: NIL_ID };

  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: Person) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const who = (userId: string | null) => (userId ? (Object.entries(fx).find(([, id]) => id === userId)?.[0] ?? userId) : null);

  /** «My notifications» of a signed-in user (API-167), newest first. */
  async function inbox(as: Person, query: Record<string, string> = {}): Promise<{ items: InboxItem[]; nextCursor: string | null }> {
    return (await api().get(INBOX).query({ limit: '100', ...query }).set(bearer(as)).expect(200)).body as { items: InboxItem[]; nextCursor: string | null };
  }
  /** The number the header bell shows (API-168). */
  async function unread(as: Person): Promise<number> {
    return (await api().get(`${INBOX}/unread-count`).set(bearer(as)).expect(200)).body.unread as number;
  }
  /** What a reader's inbox gained since they last looked, oldest first — read through the API, like the page. */
  async function news(reader: Reader): Promise<InboxItem[]> {
    const { items } = await inbox(reader);
    const fresh = items.filter((item) => item.id > newest[reader]).reverse();
    if (items[0]) newest[reader] = items[0].id;
    return fresh;
  }
  /** A write that concerns nobody yet: neither inbox gained anything. */
  async function nothingNew(label: string): Promise<void> {
    for (const reader of READERS) expect(await news(reader), `${label} → ${reader}`).toEqual([]);
  }
  async function expectUnread(expected: Record<Reader, number>): Promise<void> {
    for (const reader of READERS) expect(await unread(reader), `unread counter of ${reader}`).toBe(expected[reader]);
  }

  /**
   * An automatic notification as its reader must find it: worded in the
   * reader's language from exactly these parameters (the wording itself is
   * TEST-175's subject), a guardian's copy naming the child; about the
   * student, unread, `data` holding the frontend path and the ids alone.
   */
  function automatic<K extends NotificationEventKey>(reader: Reader, key: K, category: string, params: NotificationEventParams[K], data: Record<string, string>): InboxItem {
    const locale = LOCALE[reader];
    const text = renderNotification(key, params, locale, defaultLocale);
    return {
      id: expect.any(String),
      eventKey: key,
      category,
      title: text.title,
      body: reader === 'guardian' ? `${text.body} ${childrenSuffix([STUDENT_NAME], locale)}` : text.body,
      data,
      student: { id: fx.student, fullName: 'Fixture student', displayName: STUDENT_NAME },
      announcementId: null,
      readAt: null,
      createdAt: expect.any(String),
    };
  }
  /** One event reached both readers: each inbox gained exactly one notification, this one. Returns the two as the API answered them. */
  async function bothReceived<K extends NotificationEventKey>(key: K, category: string, params: NotificationEventParams[K], data: Record<string, string>): Promise<Record<Reader, InboxItem>> {
    const received = {} as Record<Reader, InboxItem>;
    for (const reader of READERS) {
      const fresh = await news(reader);
      expect(fresh, `${key} → ${reader}`).toEqual([automatic(reader, key, category, params, data)]);
      received[reader] = fresh[0]!;
    }
    return received;
  }

  async function createUser(name: Person, roleKey: string, profile: { locale?: 'ar' | 'en'; displayName?: string } = {}): Promise<void> {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey }, select: { id: true } });
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Fixture ${name}`,
        displayName: profile.displayName ?? null,
        locale: profile.locale ?? null,
        status: 'active',
        passwordHash: await passwords.hash(PASSWORD),
        // A confirmed address: an e-mail copy of every notification is due.
        emailVerifiedAt: new Date(),
        roles: { create: [{ roleId: role.id }] },
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(name), password: PASSWORD }).expect(200);
    tokens[name] = res.body.accessToken as string;
  }

  /** The rows of this run in the shared database, counted the way the cleanup is verified: all there after the journey, none after the cleanup. */
  async function footprint(): Promise<Record<string, number>> {
    const mine = { in: createdUserIds };
    const ofTheClass = { class: { code: { startsWith: PREFIX } } };
    return {
      users: await prisma.user.count({ where: { email: { endsWith: `-${RUN.toLowerCase()}@example.test` } } }),
      guardianLinks: await prisma.guardianStudent.count({ where: { OR: [{ guardianUserId: mine }, { studentUserId: mine }] } }),
      courses: await prisma.course.count({ where: { code: { startsWith: PREFIX } } }),
      classes: await prisma.class.count({ where: { code: { startsWith: PREFIX } } }),
      enrollments: await prisma.enrollment.count({ where: { OR: [{ studentUserId: mine }, ofTheClass] } }),
      assignments: await prisma.assignment.count({ where: ofTheClass }),
      submissions: await prisma.assignmentSubmission.count({ where: { studentUserId: mine } }),
      invoices: await prisma.invoice.count({ where: { studentUserId: mine } }),
      payments: await prisma.payment.count({ where: { invoice: { studentUserId: mine } } }),
      // An announcement that lost its sender and its class would still carry the run's mark in its title.
      announcements: await prisma.announcement.count({ where: { title: { contains: TITLE_MARK } } }),
      notifications: await prisma.notification.count({ where: { recipientUserId: mine } }),
      preferences: await prisma.notificationPreference.count({ where: { userId: mine } }),
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    // The journey runs on the real mail configuration of the e2e runs — no transport — so nothing is ever e-mailed.
    expect(app.get(MailService).transportName, 'the e2e runs must have no mail transport (vitest.config.e2e.ts)').toBe('none');
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    const academy = await prisma.academy.findFirstOrThrow({ select: { timezone: true, defaultLocale: true, currency: true } });
    academyTimeZone = academy.timezone;
    defaultLocale = academy.defaultLocale;
    currency = academy.currency;
    today = dayIn(academy.timezone, new Date());

    // Everyone holds a seeded system role and nothing else.
    await createUser('teacher', 'teacher');
    await createUser('office', 'staff');
    await createUser('student', 'student', { locale: 'en', displayName: STUDENT_NAME });
    await createUser('guardian', 'guardian', { locale: 'ar' });

    // Preconditions from other journeys: the guardian link (MOD-03-T09), a published course (WF-05) and a running
    // class with its lead teacher and the student's active enrollment (WF-03/WF-04).
    await prisma.guardianStudent.create({ data: { guardianUserId: fx.guardian, studentUserId: fx.student, relationship: 'mother', isPrimary: true }, select: { studentUserId: true } });
    const courseId = (await prisma.course.create({ data: { code: `${PREFIX}-C`, name: { ar: 'دورة رحلة الإشعارات' }, status: 'published' }, select: { id: true } })).id;
    classId = (
      await prisma.class.create({
        data: { courseId, code: `${PREFIX}-A`, name: CLASS_NAME, capacity: 10, status: 'running', teachers: { create: [{ teacherUserId: fx.teacher, role: 'lead' }] } },
        select: { id: true },
      })
    ).id;
    enrollmentId = (await prisma.enrollment.create({ data: { classId, studentUserId: fx.student, status: 'active', activatedAt: new Date() }, select: { id: true } })).id;
  }, 120_000); // four accounts are hashed and signed in with Argon2 while other suites share the machine

  afterAll(async () => {
    try {
      if (prisma) {
        try {
          // An announcement outlives its sender and its class (SET NULL): it goes first, its notifications with it.
          await prisma.announcement.deleteMany({ where: { OR: [{ senderUserId: { in: createdUserIds } }, { class: { code: { startsWith: PREFIX } } }] } });
          // Payments restrict their invoice; invoices and enrollments restrict their student; enrollments restrict their class.
          await prisma.payment.deleteMany({ where: { invoice: { studentUserId: { in: createdUserIds } } } });
          await prisma.invoice.deleteMany({ where: { studentUserId: { in: createdUserIds } } });
          await prisma.enrollment.deleteMany({ where: { class: { code: { startsWith: PREFIX } } } });
          // The class takes its teachers, assignments and submissions with it (Cascade); then the course.
          await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
          await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
        } finally {
          // The users take their notifications, e-mail preferences, sessions and the guardian link with them.
          if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
        }
        // Nothing of the run is left in the shared database.
        const left = await footprint();
        expect(left).toEqual(Object.fromEntries(Object.keys(left).map((table) => [table, 0])));
      }
    } finally {
      await prisma?.$disconnect();
      await app?.close();
    }
  }, 60_000);

  it(
    'WF-15: a published assignment, its grade, an issued invoice, a payment and a class announcement each reach the student and the guardian in «my notifications»; the counter and the read marks follow; the e-mail copies are `skipped` or `none`; the audit log holds the writes and no read',
    async () => {
      const markId = (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;

      // 0. The accounts are new: nobody has a notification yet.
      for (const person of ['student', 'guardian', 'teacher', 'office'] as const) {
        expect(await inbox(person), person).toEqual({ items: [], nextCursor: null });
        expect(await unread(person), person).toBe(0);
      }

      // 1. The teacher sets an assignment for the class, due in two days. A draft is nobody's business yet …
      const dueAt = at(48 * HOUR);
      const draft = await api()
        .post(`/api/classes/${classId}/assignments`)
        .set(bearer('teacher'))
        .send({ title: HOMEWORK, instructions: { ar: 'حلّ التمارين من 1 إلى 5' }, maxScore: 20, dueAt })
        .expect(201);
      const assignmentId = draft.body.id as string;
      expect(draft.body).toMatchObject({ status: 'draft', publishedAt: null, title: HOMEWORK, dueAt });
      await nothingNew('a draft assignment');
      // … publishing it tells the class: one notification for the student, one for the guardian, each in their own language.
      const published = await api().post(`/api/assignments/${assignmentId}/status`).set(bearer('teacher')).send({ action: 'publish' }).expect(200);
      expect(published.body).toMatchObject({ id: assignmentId, status: 'open', dueAt, timeZone: academyTimeZone });
      const homework = await bothReceived(
        'assignment.published',
        'assignments',
        { assignmentId, classId, title: HOMEWORK, className: CLASS_NAME, dueAt: new Date(dueAt), timeZone: academyTimeZone },
        { link: '/my-assignments', assignmentId, classId },
      );
      expect(homework.student.title).toBe('New assignment: Unit one homework');
      expect(homework.student.body).toContain('Notifications journey class');
      expect(homework.guardian.title).toBe('واجب جديد: واجب الوحدة الأولى');
      expect(homework.guardian.body).toContain('فصل رحلة الإشعارات');
      // A guardian's copy names the child it is about; the student's own copy names nobody.
      expect(homework.guardian.body).toContain(`الطالب: ${STUDENT_NAME}.`);
      expect(homework.student.body).not.toContain(STUDENT_NAME);
      await expectUnread({ student: 1, guardian: 1 });

      // 2. The student hands the work in — the teacher finds it in the roster, nobody is notified …
      const submitted = await api().post(`/api/assignments/${assignmentId}/submissions`).set(bearer('student')).send({ textAnswer: 'إجابات التمارين 1–5' }).expect(201);
      const submissionId = submitted.body.id as string;
      expect(submitted.body).toMatchObject({ attemptNo: 1, isLate: false, status: 'submitted' });
      await nothingNew('a submission');
      // … and the teacher grades it: the student and the guardian are told.
      const graded = await api().post(`/api/submissions/${submissionId}/review`).set(bearer('teacher')).send({ action: 'grade', score: 17.5, feedback: FEEDBACK }).expect(200);
      expect(graded.body).toMatchObject({ id: submissionId, status: 'graded', score: 17.5, feedback: FEEDBACK });
      const grade = await bothReceived(
        'submission.graded',
        'assignments',
        { submissionId, assignmentId, classId, title: HOMEWORK, score: '17.5', maxScore: '20' },
        { link: '/my-assignments', submissionId, assignmentId, classId },
      );
      // The title is all an e-mail would carry of the event: it names the assignment and never the score …
      expect(grade.student.title).toBe('Assignment graded: Unit one homework');
      expect(grade.guardian.title).toBe('صُحّح واجب: واجب الوحدة الأولى');
      for (const reader of READERS) expect(grade[reader].title, reader).not.toMatch(/\d/);
      // … while the body, inside the app, states what «my assignments» shows them anyway.
      expect(grade.student.body).toContain('17.5 out of 20');
      expect(grade.guardian.body).toContain('17.5 من 20');
      await expectUnread({ student: 2, guardian: 2 });

      // 3. The office writes the student's invoice for this enrollment. A draft tells nobody …
      const dueOn = addDays(today, 7);
      const invoice = await api()
        .post('/api/invoices')
        .set(bearer('office'))
        .send({
          studentId: fx.student,
          enrollmentId,
          lines: [{ description: { ar: 'رسوم الدورة', en: 'Course fees' }, amount: 1234.5 }],
          installments: [{ amount: 1234.5, dueOn }],
          notes: OFFICE_NOTE,
        })
        .expect(201);
      const invoiceId = invoice.body.id as string;
      expect(invoice.body).toMatchObject({ status: 'draft', number: null, total: 1234.5, currency });
      await nothingNew('a draft invoice');
      // … issuing it tells both: the invoice number in the title, the total and the first due day in the body only.
      const issued = await api().post(`/api/invoices/${invoiceId}/status`).set(bearer('office')).send({ action: 'issue' }).expect(200);
      expect(issued.body).toMatchObject({ id: invoiceId, status: 'issued', total: 1234.5, currency });
      const invoiceNumber = issued.body.number as string;
      expect(invoiceNumber).toMatch(/^INV-\d{4}-\d{5,}$/);
      const bill = await bothReceived('invoice.issued', 'finance', { invoiceId, number: invoiceNumber, total: '1234.50', currency, firstDueOn: dueOn }, { link: '/my-invoices', invoiceId });
      expect(bill.student.title).toBe(`New invoice: ${invoiceNumber}`);
      expect(bill.guardian.title).toBe(`فاتورة جديدة: ${invoiceNumber}`);
      for (const reader of READERS) {
        expect(bill[reader].title, reader).not.toContain('1234.50');
        expect(bill[reader].body, reader).toContain(`1234.50 ${currency}`);
      }
      await expectUnread({ student: 3, guardian: 3 });

      // The office records a first payment: the receipt number in the title, its amount in the body only.
      const paid = await api().post(`/api/invoices/${invoiceId}/payments`).set(bearer('office')).send({ amount: 500, method: 'cash', payerName: PAYER, notes: OFFICE_NOTE }).expect(201);
      expect(paid.body).toMatchObject({ amount: 500, currency, status: 'completed', invoice: { id: invoiceId, number: invoiceNumber, paid: 500, balance: 734.5, paymentState: 'partial' } });
      const paymentId = paid.body.id as string;
      const receiptNumber = paid.body.number as string;
      expect(receiptNumber).toMatch(/^RCPT-\d{4}-\d{5,}$/);
      const receipt = await bothReceived(
        'payment.recorded',
        'finance',
        { paymentId, invoiceId, receiptNumber, invoiceNumber, amount: '500.00', currency },
        { link: '/my-invoices', paymentId, invoiceId },
      );
      expect(receipt.student.title).toBe(`Payment recorded: ${receiptNumber}`);
      expect(receipt.guardian.title).toBe(`سُجّلت دفعة: ${receiptNumber}`);
      for (const reader of READERS) {
        expect(receipt[reader].title, reader).not.toContain('500.00');
        expect(receipt[reader].body, reader).toContain(`500.00 ${currency}`);
        expect(receipt[reader].body, reader).toContain(invoiceNumber);
      }
      await expectUnread({ student: 4, guardian: 4 });

      // 4. The teacher announces to the students of the class and their guardians, and asks for an e-mail copy as well.
      const announced = await api()
        .post('/api/announcements')
        .set(bearer('teacher'))
        .send({ audience: { kind: 'class', classId, students: true, guardians: true }, title: ANNOUNCEMENT_TITLE, body: ANNOUNCEMENT_BODY, sendEmail: true })
        .expect(201);
      const announcementId = announced.body.id as string;
      const audience = { kind: 'class', classId, students: true, guardians: true, teachers: false };
      expect(announced.body).toMatchObject({
        audience,
        class: { id: classId, code: `${PREFIX}-A` },
        title: ANNOUNCEMENT_TITLE,
        body: ANNOUNCEMENT_BODY,
        sendEmail: true,
        recipientCount: 2,
        sender: { id: fx.teacher, fullName: 'Fixture teacher', displayName: null },
      });
      // Each of the two finds it once — the sender's words as typed, the same for the reader of English and of Arabic, about nobody in particular.
      for (const reader of READERS) {
        expect(await news(reader), `announcement → ${reader}`).toEqual([
          {
            id: expect.any(String),
            eventKey: 'announcement',
            category: 'announcements',
            title: ANNOUNCEMENT_TITLE,
            body: ANNOUNCEMENT_BODY,
            data: { link: '/notifications', announcementId, classId },
            student: null,
            announcementId,
            readAt: null,
            createdAt: expect.any(String),
          },
        ]);
      }
      await expectUnread({ student: 5, guardian: 5 });

      // 5. The student's inbox: the whole journey newest first, by category, and the unread ones — all five so far.
      const whole = await inbox('student');
      expect(whole.nextCursor).toBeNull();
      expect(whole.items.map((item) => [item.eventKey, item.category])).toEqual([
        ['announcement', 'announcements'],
        ['payment.recorded', 'finance'],
        ['invoice.issued', 'finance'],
        ['submission.graded', 'assignments'],
        ['assignment.published', 'assignments'],
      ]);
      const ids = whole.items.map((item) => item.id);
      expect([...ids].sort().reverse()).toEqual(ids);
      for (const [category, keys] of [
        ['assignments', ['submission.graded', 'assignment.published']],
        ['finance', ['payment.recorded', 'invoice.issued']],
        ['announcements', ['announcement']],
        ['lessons', []],
        ['exams', []],
        ['grades', []],
      ] as const) {
        expect((await inbox('student', { category })).items.map((item) => item.eventKey), category).toEqual(keys);
      }
      expect((await inbox('student', { unread: 'true' })).items.map((item) => item.id)).toEqual(ids);
      expect(await unread('student')).toBe(5);

      // 6. Read marks. One notification (the published assignment) …
      const oldest = ids.at(-1)!;
      const marked = await api().post(`${INBOX}/${oldest}/read`).set(bearer('student')).expect(200);
      expect(marked.body).toMatchObject({ id: oldest, eventKey: 'assignment.published' });
      expect(typeof marked.body.readAt).toBe('string');
      expect(await unread('student')).toBe(4);
      expect((await inbox('student', { unread: 'true' })).items.map((item) => item.eventKey)).toEqual(['announcement', 'payment.recorded', 'invoice.issued', 'submission.graded']);
      // … then everything of one category …
      expect((await api().post(`${INBOX}/read-all`).set(bearer('student')).send({ category: 'finance' }).expect(200)).body).toEqual({ updated: 2 });
      expect(await unread('student')).toBe(2);
      expect((await inbox('student', { unread: 'true' })).items.map((item) => item.eventKey)).toEqual(['announcement', 'submission.graded']);
      // … then everything that is left. The notifications stay in the inbox, read.
      expect((await api().post(`${INBOX}/read-all`).set(bearer('student')).expect(200)).body).toEqual({ updated: 2 });
      expect(await unread('student')).toBe(0);
      expect(await inbox('student', { unread: 'true' })).toEqual({ items: [], nextCursor: null });
      const afterMarks = (await inbox('student')).items;
      expect(afterMarks.map((item) => item.id)).toEqual(ids);
      expect(afterMarks.filter((item) => typeof item.readAt === 'string')).toHaveLength(5);
      // The guardian's inbox did not move: the same five, all unread.
      const guardians = (await inbox('guardian')).items;
      expect(guardians.map((item) => [item.eventKey, item.readAt])).toEqual([
        ['announcement', null],
        ['payment.recorded', null],
        ['invoice.issued', null],
        ['submission.graded', null],
        ['assignment.published', null],
      ]);
      expect(await unread('guardian')).toBe(5);

      // 7. Ownership: the guardian's notification does not exist for the student — a 404 like an unknown id, and nothing is marked.
      const foreignId = guardians[0]!.id;
      const foreign = await api().post(`${INBOX}/${foreignId}/read`).set(bearer('student')).expect(404);
      expect(foreign.body).toMatchObject({ statusCode: 404, code: 'notification_not_found', notificationId: foreignId });
      expect(await unread('guardian')).toBe(5);

      // 8. E-mail. The runs have no mail transport: every copy that was due — a confirmed address, the category left on — is `skipped`.
      const rows = await prisma.notification.findMany({ where: { recipientUserId: { in: [fx.student, fx.guardian] } }, orderBy: { id: 'asc' } });
      expect(rows).toHaveLength(10);
      for (const row of rows) {
        expect(row, `${row.eventKey} → ${who(row.recipientUserId)}`).toMatchObject({ emailStatus: 'skipped', emailSentAt: null, emailMessageId: null, emailFailure: null });
      }
      // The sender reads what became of the announcement (API-175): counts only — one of the two has read it.
      expect((await api().get(`/api/announcements/${announcementId}`).set(bearer('teacher')).expect(200)).body).toMatchObject({
        id: announcementId,
        recipientCount: 2,
        readCount: 1,
        email: { none: 0, queued: 0, sent: 0, failed: 0, skipped: 2 },
      });
      // The guardian's switches are all on; the answer also says why no e-mail arrives — the academy has no transport.
      expect((await api().get(PREFERENCES).set(bearer('guardian')).expect(200)).body).toEqual({
        categories: CATEGORIES.map((category) => ({ category, emailEnabled: true })),
        emailVerified: true,
        emailAvailable: false,
      });
      // The guardian switches the e-mail of one category off …
      const switched = await api().put(PREFERENCES).set(bearer('guardian')).send({ categories: [{ category: 'assignments', emailEnabled: false }] }).expect(200);
      expect(switched.body).toEqual({
        categories: CATEGORIES.map((category) => ({ category, emailEnabled: category !== 'assignments' })),
        emailVerified: true,
        emailAvailable: false,
      });
      // … and the next event of that category — a second assignment, without a due date — still reaches both inboxes …
      const second = await api().post(`/api/classes/${classId}/assignments`).set(bearer('teacher')).send({ title: REVISION, maxScore: 10 }).expect(201);
      const secondId = second.body.id as string;
      await api().post(`/api/assignments/${secondId}/status`).set(bearer('teacher')).send({ action: 'publish' }).expect(200);
      const revision = await bothReceived(
        'assignment.published',
        'assignments',
        { assignmentId: secondId, classId, title: REVISION, className: CLASS_NAME, dueAt: null, timeZone: academyTimeZone },
        { link: '/my-assignments', assignmentId: secondId, classId },
      );
      expect(revision.student.title).toBe('New assignment: Revision sheet');
      expect(revision.student.body).toContain('no due date');
      await expectUnread({ student: 1, guardian: 6 });
      // … while only the student's e-mail copy is still due: the guardian's is `none`.
      const copies = await prisma.notification.findMany({ where: { id: { in: [revision.student.id, revision.guardian.id] } }, select: { recipientUserId: true, emailStatus: true } });
      expect(Object.fromEntries(copies.map((row) => [who(row.recipientUserId), row.emailStatus]))).toEqual({ student: 'skipped', guardian: 'none' });

      // 9. Nobody else was told anything — not the teacher, not the office — and both readers hold exactly the six of the journey,
      // none of which carries the teacher's feedback, the office's note or the payer.
      for (const staff of ['teacher', 'office'] as const) {
        expect(await inbox(staff), staff).toEqual({ items: [], nextCursor: null });
        expect(await unread(staff), staff).toBe(0);
      }
      for (const reader of READERS) {
        const told = (await inbox(reader)).items;
        expect(told.map((item) => item.eventKey), reader).toEqual(['assignment.published', 'announcement', 'payment.recorded', 'invoice.issued', 'submission.graded', 'assignment.published']);
        for (const hidden of [FEEDBACK, OFFICE_NOTE, PAYER]) expect(JSON.stringify(told), `${reader} reads ${hidden}`).not.toContain(hidden);
      }

      // 10. The audit trail of the journey: everything recorded by its four people, about them or about their notifications.
      // The ten writes, in order — and nothing for reading an inbox or a counter, for a read mark (the refused one included),
      // for the preference change or for a notification itself (D-R86): the student's only event is the submission, the
      // guardian has none.
      const notificationIds = (await prisma.notification.findMany({ where: { recipientUserId: { in: createdUserIds } }, select: { id: true } })).map((row) => row.id);
      expect(notificationIds).toHaveLength(12);
      const events = await prisma.auditLog.findMany({
        where: { id: { gt: markId }, OR: [{ actorUserId: { in: createdUserIds } }, { entityId: { in: [...createdUserIds, ...notificationIds] } }] },
        orderBy: { id: 'asc' },
      });
      expect(events.map((event) => [who(event.actorUserId), event.action, event.entityType, event.entityId])).toEqual([
        ['teacher', 'assignments.created', 'assignments', assignmentId],
        ['teacher', 'assignments.status.changed', 'assignments', assignmentId],
        ['student', 'assignments.submitted', 'assignment_submissions', submissionId],
        ['teacher', 'assignments.graded', 'assignment_submissions', submissionId],
        ['office', 'invoices.created', 'invoices', invoiceId],
        ['office', 'invoices.issued', 'invoices', invoiceId],
        ['office', 'payments.recorded', 'payments', paymentId],
        ['teacher', 'notifications.announcement.sent', 'announcements', announcementId],
        ['teacher', 'assignments.created', 'assignments', secondId],
        ['teacher', 'assignments.status.changed', 'assignments', secondId],
      ]);
      // The announcement's event carries its audience and a count — never the sender's words.
      expect(events[7]!.metadata).toEqual({ audience, recipients: 2 });
      const recorded = JSON.stringify(events);
      for (const words of [TITLE_MARK, BODY_MARK, 'room 4', 'الخميس']) expect(recorded, words).not.toContain(words);

      // 11. What the journey left in the shared database — exactly what the cleanup removes and then looks for in vain.
      expect(await footprint()).toEqual({
        users: 4,
        guardianLinks: 1,
        courses: 1,
        classes: 1,
        enrollments: 1,
        assignments: 2,
        submissions: 1,
        invoices: 1,
        payments: 1,
        announcements: 1,
        notifications: 12,
        preferences: 1,
      });
    },
    120_000,
  );
});
