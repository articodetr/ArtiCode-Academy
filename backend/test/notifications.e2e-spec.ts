// TEST-175 — MOD-12-T02: the notification engine, «my notifications» and the
// e-mail preferences (API-167..172; owner decisions D-R80..D-R86, ADR-071).
// No writer of MOD-06..MOD-11 calls the engine yet (T03/T04), so this suite
// calls `NotificationsService` directly, inside real transactions, with the
// mail transport replaced by a scripted fake — nothing is ever e-mailed.
//
// It runs against the shared development database and `pickUp()` settles
// EVERY queued notification e-mail older than this suite's boot through that
// fake transport: never point it at a database whose queued e-mails matter.
// Skipped when no database is reachable.
import type { LoggerService } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { templateLocale } from '../src/mail/mail.templates.js';
import type { MailDeliveryResult, MailMessage, MailTransport } from '../src/mail/mail.transport.js';
import type { NotificationDispatcher as Dispatcher } from '../src/notifications/notifications.dispatcher.js';
import type { NotificationEventParams } from '../src/notifications/notifications.events.js';
import type { NotificationBatch, NotificationsService as Engine } from '../src/notifications/notifications.service.js';
import { renderNotification } from '../src/notifications/notifications.templates.js';
import type { PrismaService as AppPrisma } from '../src/prisma/prisma.service.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const { AppModule } = await import('../src/app.module.js');
const { APP_CREATE_OPTIONS, configureApp } = await import('../src/app.setup.js');
const { MAIL_TRANSPORT } = await import('../src/mail/mail.transport.js');
const { NotificationDispatcher } = await import('../src/notifications/notifications.dispatcher.js');
const { NotificationsService } = await import('../src/notifications/notifications.service.js');
const { PrismaService } = await import('../src/prisma/prisma.service.js');

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `N${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-175 supertest';
const INBOX = '/api/me/notifications';
const PREFERENCES = '/api/me/notification-preferences';
const ZERO_ID = '00000000-0000-0000-0000-000000000000';
const ITEM_KEYS = ['announcementId', 'body', 'category', 'createdAt', 'data', 'eventKey', 'id', 'readAt', 'student', 'title'];
const CATEGORIES = ['lessons', 'assignments', 'exams', 'grades', 'finance', 'announcements'];

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

/** A transport that records every message and answers as the test scripts it; its name is what `MAIL_TRANSPORT` would be. */
class ScriptedTransport implements MailTransport {
  name = 'recording';
  mode: 'sent' | 'logged' | 'failed' | 'throws' = 'sent';
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<MailDeliveryResult> {
    this.sent.push(message);
    if (this.mode === 'throws') throw new Error('scripted transport failure');
    if (this.mode === 'failed') return { transport: this.name, status: 'failed', messageId: null, failure: { reason: 'http', httpStatus: 500, providerCode: 'internal_server_error' } };
    if (this.mode === 'logged') return { transport: this.name, status: 'logged', messageId: null };
    return { transport: this.name, status: 'sent', messageId: `rec-${this.sent.length}` };
  }
}

/** Keeps every line the server logs, so the suite can prove what never reaches the log (AC7). */
class CapturingLogger implements LoggerService {
  readonly lines: string[] = [];
  private keep(parts: unknown[]): void {
    this.lines.push(parts.map((part) => (part instanceof Error ? `${part.message} ${part.stack ?? ''}` : String(part))).join(' '));
  }
  log(...parts: unknown[]): void {
    this.keep(parts);
  }
  error(...parts: unknown[]): void {
    this.keep(parts);
  }
  warn(...parts: unknown[]): void {
    this.keep(parts);
  }
  debug(...parts: unknown[]): void {
    this.keep(parts);
  }
  verbose(...parts: unknown[]): void {
    this.keep(parts);
  }
  fatal(...parts: unknown[]): void {
    this.keep(parts);
  }
}

type Row = Prisma.NotificationGetPayload<object>;

describe.skipIf(!available)('MOD-12 notification engine and «my notifications» (e2e, TEST-175)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let appPrisma: AppPrisma;
  let engine: Engine;
  let dispatcher: Dispatcher;
  let classId: string;
  let defaultLocale: 'ar' | 'en' | 'tr';
  const mailbox = new ScriptedTransport();
  const logger = new CapturingLogger();
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const createdUserIds: string[] = [];

  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  const mailsTo = (name: string) => mailbox.sent.filter((message) => message.to === email(name));
  const byRecipient = (rows: Row[]) => Object.fromEntries(Object.entries(fx).map(([name, userId]) => [name, rows.filter((row) => row.recipientUserId === userId)])) as Record<string, Row[]>;
  const recipientsOf = (rows: Row[]) =>
    Object.entries(byRecipient(rows))
      .filter(([, mine]) => mine.length > 0)
      .map(([name]) => name)
      .sort();

  const assignmentId = '019a0000-0000-7000-8000-0000000000a1';
  const submissionId = '019a0000-0000-7000-8000-0000000000a2';
  const invoiceId = '019a0000-0000-7000-8000-0000000000a3';
  const paymentId = '019a0000-0000-7000-8000-0000000000a4';
  const SCORE = '7.25';
  const graded = (): NotificationEventParams['submission.graded'] => ({ submissionId, assignmentId, classId, title: { ar: 'مقال', en: 'Essay' }, score: SCORE, maxScore: '19.75' });
  const published = (): NotificationEventParams['assignment.published'] => ({
    assignmentId,
    classId,
    title: { ar: 'مقال', en: 'Essay' },
    className: { ar: 'فصل الإشعارات', en: 'Notifications class' },
    dueAt: new Date('2026-12-01T09:00:00Z'),
    timeZone: 'Asia/Riyadh',
  });
  const paid = (): NotificationEventParams['payment.recorded'] => ({ paymentId, invoiceId, receiptNumber: `RCPT-${RUN}`, invoiceNumber: `INV-${RUN}`, amount: '654.32', currency: 'SAR' });

  /** The newest notification id in the table: rows written after it belong to the call under test. */
  async function watermark(): Promise<string> {
    return (await prisma.notification.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? ZERO_ID;
  }
  const since = (mark: string) => prisma.notification.findMany({ where: { recipientUserId: { in: createdUserIds }, id: { gt: mark } }, orderBy: { id: 'asc' } });

  /** Runs `write` in a transaction, hands the result to the dispatcher after the commit and waits until every e-mail is settled. */
  async function emit(write: (tx: Prisma.TransactionClient) => Promise<NotificationBatch>): Promise<{ batch: NotificationBatch; rows: Row[] }> {
    const mark = await watermark();
    const batch = await appPrisma.db.$transaction(write);
    engine.dispatch(batch);
    await dispatcher.whenIdle();
    return { batch, rows: await since(mark) };
  }

  interface UserOptions {
    roles?: string[];
    status?: 'active' | 'invited' | 'suspended' | 'archived';
    locale?: 'ar' | 'en' | null;
    verified?: boolean;
    deleted?: boolean;
    signsIn?: boolean;
    displayName?: string;
  }
  async function createUser(name: string, options: UserOptions = {}): Promise<void> {
    const status = options.status ?? 'active';
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Fixture ${name}`,
        displayName: options.displayName ?? null,
        locale: options.locale ?? null,
        status,
        passwordHash: options.signsIn ? await new PasswordService().hash(PASSWORD) : null,
        emailVerifiedAt: options.verified === false ? null : new Date(),
        deletedAt: options.deleted ? new Date() : null,
        roles: { create: (options.roles ?? []).map((roleId) => ({ roleId })) },
      },
      select: { id: true },
    });
    fx[name] = user.id;
    createdUserIds.push(user.id);
    if (options.signsIn) {
      tokens[name] = (await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(name), password: PASSWORD }).expect(200)).body.accessToken as string;
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_TRANSPORT)
      .useValue(mailbox)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    app.useLogger(logger);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    appPrisma = app.get(PrismaService);
    engine = app.get(NotificationsService);
    dispatcher = app.get(NotificationDispatcher);
    defaultLocale = (await prisma.academy.findFirst({ select: { defaultLocale: true } }))?.defaultLocale ?? 'ar';

    const role = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
    const student = await role('student');
    const guardian = await role('guardian');
    // Students first, in this order: a guardian's copy of a class event names them in the order of their ids.
    await createUser('student', { roles: [student], locale: 'en', signsIn: true, displayName: 'Ahmad' });
    await createUser('sibling', { roles: [student] });
    await createUser('pending', { roles: [student], status: 'invited' });
    await createUser('withdrawn', { roles: [student] });
    await createUser('ghost', { roles: [student], status: 'archived', deleted: true });
    await createUser('guardian', { roles: [guardian], locale: 'ar', signsIn: true });
    await createUser('unverified', { roles: [guardian], locale: 'en', verified: false });
    await createUser('norole', {});
    await createUser('suspended', { roles: [guardian], status: 'suspended' });
    await createUser('gone', { roles: [guardian], status: 'archived', deleted: true });
    await createUser('outsider', { roles: [student], signsIn: true });
    for (const [guardianName, studentName] of [
      ['guardian', 'student'],
      ['guardian', 'sibling'],
      ['guardian', 'pending'],
      ['guardian', 'ghost'],
      ['unverified', 'sibling'],
      // None of these three may receive anything: no `guardian` role, a suspended account, a soft-deleted one.
      ['norole', 'student'],
      ['suspended', 'student'],
      ['gone', 'student'],
    ] as const) {
      await prisma.guardianStudent.create({ data: { guardianUserId: id(guardianName), studentUserId: id(studentName), relationship: 'father' }, select: { studentUserId: true } });
    }
    const courseId = (await prisma.course.create({ data: { code: `${PREFIX}-C`, name: { ar: 'دورة الإشعارات' }, status: 'published' }, select: { id: true } })).id;
    classId = (await prisma.class.create({ data: { courseId, code: `${PREFIX}-A`, name: { ar: 'فصل الإشعارات' }, capacity: 20, status: 'running' }, select: { id: true } })).id;
    for (const [name, status] of [
      ['student', 'active'],
      ['sibling', 'active'],
      ['pending', 'active'],
      ['withdrawn', 'withdrawn'],
    ] as const) {
      await prisma.enrollment.create({ data: { classId, studentUserId: id(name), status }, select: { id: true } });
    }
    // Only what the server logs from here on is examined at the end (AC7).
    logger.lines.length = 0;
  }, 120_000);

  afterAll(async () => {
    try {
      if (dispatcher) await dispatcher.whenIdle();
      if (prisma && classId) {
        await prisma.enrollment.deleteMany({ where: { classId } });
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
      }
    } finally {
      // Deleting the recipients removes their notifications, preferences and links with them.
      if (prisma && createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('AC1: a notification is written with its write and is gone with a rolled-back transaction', async () => {
    const mark = await watermark();
    const rollback = new Error('rollback');
    let insideTransaction = 0;
    await expect(
      appPrisma.db.$transaction(async (tx) => {
        const batch = await engine.notifyStudents(tx, 'submission.graded', [{ studentId: id('student'), params: graded() }]);
        insideTransaction = batch.created;
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(insideTransaction).toBe(2);
    expect(await since(mark)).toEqual([]);
    expect(mailbox.sent).toHaveLength(0);

    const { batch, rows } = await emit((tx) => engine.notifyStudents(tx, 'submission.graded', [{ studentId: id('student'), params: graded() }]));
    expect(batch.created).toBe(2);
    expect(batch.queuedIds).toHaveLength(2);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.eventKey)).toEqual(['submission.graded', 'submission.graded']);
    expect(rows.map((row) => row.category)).toEqual(['assignments', 'assignments']);
    // No call, no notification: an empty list writes nothing and asks the database nothing.
    expect(await emit((tx) => engine.notifyStudents(tx, 'submission.graded', []))).toEqual({ batch: { created: 0, queuedIds: [] }, rows: [] });
  });

  it('AC2: a student event reaches the student and the eligible guardians only — one notification each, about that student; the e-mail carries the title and a link, never the score', async () => {
    const sentBefore = mailbox.sent.length;
    const { rows } = await emit((tx) => engine.notifyStudents(tx, 'submission.graded', [{ studentId: id('student'), params: graded() }]));
    // Not the linked user without the `guardian` role, not the suspended guardian, not the soft-deleted one, nobody unrelated.
    expect(recipientsOf(rows)).toEqual(['guardian', 'student']);
    const mine = byRecipient(rows);
    expect(mine['student']).toHaveLength(1);
    expect(mine['guardian']).toHaveLength(1);
    for (const row of rows) {
      expect(row.studentUserId).toBe(id('student'));
      expect(row.data).toEqual({ link: '/my-assignments', submissionId, assignmentId, classId });
      expect(row).toMatchObject({ readAt: null, announcementId: null, emailStatus: 'sent', emailFailure: null });
      expect(row.emailSentAt).toBeInstanceOf(Date);
      expect(row.emailMessageId).toMatch(/^rec-\d+$/);
    }
    // The in-app body states the score (the student sees it on «my assignments»); a guardian's copy names the child.
    expect(mine['student']![0]!.body).toBe('The submission for “Essay” was graded: 7.25 out of 19.75.');
    expect(mine['guardian']![0]!.body).toBe('صُحّح تسليم واجب «مقال»: الدرجة 7.25 من 19.75. الطالب: Ahmad.');

    const mails = mailbox.sent.slice(sentBefore);
    expect(mails.map((message) => message.to).sort()).toEqual([email('guardian'), email('student')].sort());
    const toStudent = mails.find((message) => message.to === email('student'))!;
    expect(toStudent).toMatchObject({ kind: 'notification', locale: 'en', subject: 'New notification: Assignment graded: Essay' });
    expect(toStudent.text).toContain('/my-assignments');
    for (const message of mails) {
      for (const secret of [SCORE, '19.75', 'out of', 'الدرجة']) {
        expect(message.subject).not.toContain(secret);
        expect(message.text).not.toContain(secret);
        expect(message.html).not.toContain(secret);
      }
    }

    // An invited student cannot sign in yet: only their guardian is told. A soft-deleted or unknown student yields nothing.
    const invited = await emit((tx) => engine.notifyStudents(tx, 'submission.graded', [{ studentId: id('pending'), params: graded() }]));
    expect(recipientsOf(invited.rows)).toEqual(['guardian']);
    expect(invited.rows[0]).toMatchObject({ studentUserId: id('pending'), body: 'صُحّح تسليم واجب «مقال»: الدرجة 7.25 من 19.75. الطالب: Fixture pending.' });
    const nobody = await emit((tx) =>
      engine.notifyStudents(tx, 'submission.graded', [
        { studentId: id('ghost'), params: graded() },
        { studentId: ZERO_ID, params: graded() },
      ]),
    );
    expect(nobody).toEqual({ batch: { created: 0, queuedIds: [] }, rows: [] });
    // Several students in one call: one notification per (recipient × student) — the guardian of two gets two.
    const two = await emit((tx) =>
      engine.notifyStudents(tx, 'payment.recorded', [
        { studentId: id('student'), params: paid() },
        { studentId: id('sibling'), params: paid() },
      ]),
    );
    expect(byRecipient(two.rows)['guardian']!.map((row) => row.studentUserId)).toEqual([id('student'), id('sibling')]);
    expect(recipientsOf(two.rows)).toEqual(['guardian', 'sibling', 'student', 'unverified']);
    expect(two.rows.every((row) => row.category === 'finance')).toBe(true);
  });

  it('AC3: a notification is worded in its recipient’s language, else the academy’s', async () => {
    const { rows } = await emit((tx) => engine.notifyStudents(tx, 'submission.graded', [{ studentId: id('sibling'), params: graded() }]));
    const mine = byRecipient(rows);
    // `sibling` has no language of their own → the academy default; `guardian` reads Arabic, `unverified` English.
    const expected = renderNotification('submission.graded', graded(), templateLocale(null, defaultLocale), defaultLocale);
    expect(mine['sibling']![0]).toMatchObject({ title: expected.title, body: expected.body });
    expect(mine['guardian']![0]!.title).toBe('صُحّح واجب: مقال');
    expect(mine['unverified']![0]).toMatchObject({ title: 'Assignment graded: Essay', body: 'The submission for “Essay” was graded: 7.25 out of 19.75. Student: Fixture sibling.' });
    // The e-mail follows the same language.
    expect(mailsTo('guardian').at(-1)).toMatchObject({ locale: 'ar', subject: 'لديك إشعار جديد: صُحّح واجب: مقال' });
  });

  it('a class event yields one notification per recipient: the active students of the class and their guardians, a guardian’s copy naming every child', async () => {
    const { batch, rows } = await emit((tx) => engine.notifyClass(tx, 'assignment.published', classId, published()));
    // Not the invited student himself, not the withdrawn one; the guardian of three children gets ONE notification.
    expect(recipientsOf(rows)).toEqual(['guardian', 'sibling', 'student', 'unverified']);
    expect(batch.created).toBe(4);
    const mine = byRecipient(rows);
    for (const name of ['guardian', 'sibling', 'student', 'unverified']) expect(mine[name], name).toHaveLength(1);
    expect(mine['student']![0]).toMatchObject({ studentUserId: id('student'), title: 'New assignment: Essay' });
    expect(mine['student']![0]!.body.startsWith('The assignment “Essay” was published in class “Notifications class”. It is due on ')).toBe(true);
    expect(mine['student']![0]!.body).not.toContain('Student');
    expect(mine['student']![0]!.data).toEqual({ link: '/my-assignments', assignmentId, classId });
    // Several children: no single student on the row; the body and `data.studentIds` name them, in the order of their ids.
    expect(mine['guardian']![0]!.studentUserId).toBeNull();
    expect(mine['guardian']![0]!.body.endsWith(' الطلاب: Ahmad، Fixture sibling، Fixture pending.')).toBe(true);
    expect(mine['guardian']![0]!.data).toEqual({ link: '/my-assignments', assignmentId, classId, studentIds: [id('student'), id('sibling'), id('pending')] });
    // One child: the row points at it.
    expect(mine['unverified']![0]).toMatchObject({ studentUserId: id('sibling'), emailStatus: 'none' });
    expect(mine['unverified']![0]!.body.endsWith(' Student: Fixture sibling.')).toBe(true);
    // A class nobody is actively enrolled in — or an unknown one — yields nothing.
    expect(await emit((tx) => engine.notifyClass(tx, 'assignment.published', ZERO_ID, published()))).toEqual({ batch: { created: 0, queuedIds: [] }, rows: [] });
  });

  it('a student event about a class follows the «my …» pages — an active or completed enrollment only; an event without a class has no such condition', async () => {
    await prisma.guardianStudent.create({ data: { guardianUserId: id('guardian'), studentUserId: id('withdrawn'), relationship: 'father' }, select: { studentUserId: true } });
    try {
      // `withdrawn` left the class: nothing about their work in it reaches them, or anybody on their behalf.
      const gone = await emit((tx) => engine.notifyStudents(tx, 'submission.graded', [{ studentId: id('withdrawn'), params: graded() }]));
      expect(gone).toEqual({ batch: { created: 0, queuedIds: [] }, rows: [] });
      // In one call with an enrolled student, only the enrolled one is told.
      const mixed = await emit((tx) =>
        engine.notifyStudents(tx, 'submission.graded', [
          { studentId: id('withdrawn'), params: graded() },
          { studentId: id('student'), params: graded() },
        ]),
      );
      expect(recipientsOf(mixed.rows)).toEqual(['guardian', 'student']);
      expect(mixed.rows.every((row) => row.studentUserId === id('student'))).toBe(true);

      // A completed enrollment still shows the class on the «my …» pages, so its student is told…
      await prisma.enrollment.updateMany({ where: { classId, studentUserId: id('sibling') }, data: { status: 'completed' } });
      try {
        const finished = await emit((tx) => engine.notifyStudents(tx, 'submission.graded', [{ studentId: id('sibling'), params: graded() }]));
        expect(recipientsOf(finished.rows)).toEqual(['guardian', 'sibling', 'unverified']);
        // …while a class event is for the students who are in the class now.
        const current = await emit((tx) => engine.notifyClass(tx, 'assignment.published', classId, published()));
        expect(recipientsOf(current.rows)).toEqual(['guardian', 'student']);
      } finally {
        await prisma.enrollment.updateMany({ where: { classId, studentUserId: id('sibling') }, data: { status: 'active' } });
      }

      // An event without a class — an invoice, a payment, a certificate — reaches the student whatever their enrollments.
      const money = await emit((tx) => engine.notifyStudents(tx, 'payment.recorded', [{ studentId: id('withdrawn'), params: paid() }]));
      expect(recipientsOf(money.rows)).toEqual(['guardian', 'withdrawn']);
      expect(money.rows.every((row) => row.studentUserId === id('withdrawn') && row.category === 'finance')).toBe(true);
    } finally {
      await prisma.guardianStudent.deleteMany({ where: { guardianUserId: id('guardian'), studentUserId: id('withdrawn') } });
    }
  });

  it('AC4: the e-mail copy is `none` when none is due, `skipped` without a transport, `sent` or `failed` after the transport answered — and a failed e-mail never fails the write', async () => {
    // Not due: an address nobody confirmed (`unverified`), and a category the recipient switched off.
    await prisma.notificationPreference.create({ data: { userId: id('student'), category: 'finance', emailEnabled: false } });
    let sentBefore = mailbox.sent.length;
    const muted = await emit((tx) => engine.notifyStudents(tx, 'payment.recorded', [{ studentId: id('student'), params: paid() }]));
    expect(byRecipient(muted.rows)['student']![0]).toMatchObject({ emailStatus: 'none', emailSentAt: null, emailMessageId: null, emailFailure: null });
    expect(byRecipient(muted.rows)['guardian']![0]!.emailStatus).toBe('sent');
    expect(mailbox.sent.slice(sentBefore).map((message) => message.to)).toEqual([email('guardian')]);
    // The switch is per category: another category still mails the same student.
    sentBefore = mailbox.sent.length;
    const other = await emit((tx) => engine.notifyStudents(tx, 'submission.graded', [{ studentId: id('student'), params: graded() }]));
    expect(byRecipient(other.rows)['student']![0]!.emailStatus).toBe('sent');
    const unverified = await emit((tx) => engine.notifyStudents(tx, 'submission.graded', [{ studentId: id('sibling'), params: graded() }]));
    expect(byRecipient(unverified.rows)['unverified']![0]).toMatchObject({ emailStatus: 'none', emailSentAt: null, emailFailure: null });
    expect(mailsTo('unverified')).toHaveLength(0);

    try {
      // No transport configured (`MAIL_TRANSPORT=none`): due e-mails are `skipped` at once and nothing is handed to the transport.
      mailbox.name = 'none';
      sentBefore = mailbox.sent.length;
      const skipped = await emit((tx) => engine.notifyStudents(tx, 'submission.graded', [{ studentId: id('student'), params: graded() }]));
      expect(skipped.batch).toEqual({ created: 2, queuedIds: [] });
      expect(skipped.rows.map((row) => row.emailStatus)).toEqual(['skipped', 'skipped']);
      expect(mailbox.sent).toHaveLength(sentBefore);
      mailbox.name = 'recording';

      // The development `log` transport: `sent`, without a provider id.
      mailbox.mode = 'logged';
      const logged = await emit((tx) => engine.notifyStudents(tx, 'submission.graded', [{ studentId: id('student'), params: graded() }]));
      for (const row of logged.rows) {
        expect(row).toMatchObject({ emailStatus: 'sent', emailMessageId: null, emailFailure: null });
        expect(row.emailSentAt).toBeInstanceOf(Date);
      }

      // The provider refuses, then the transport itself throws: the transaction has long committed; the rows say why.
      mailbox.mode = 'failed';
      const refused = await emit((tx) => engine.notifyStudents(tx, 'submission.graded', [{ studentId: id('student'), params: graded() }]));
      expect(refused.batch.created).toBe(2);
      expect(refused.rows.map((row) => [row.emailStatus, row.emailFailure, row.emailSentAt, row.emailMessageId])).toEqual([
        ['failed', 'http_500', null, null],
        ['failed', 'http_500', null, null],
      ]);
      mailbox.mode = 'throws';
      const thrown = await emit((tx) => engine.notifyStudents(tx, 'submission.graded', [{ studentId: id('student'), params: graded() }]));
      expect(thrown.rows.map((row) => [row.emailStatus, row.emailFailure])).toEqual([
        ['failed', 'error'],
        ['failed', 'error'],
      ]);
      // In the app the notification is there all the same.
      expect(thrown.rows.every((row) => row.title.length > 0 && row.readAt === null)).toBe(true);
    } finally {
      mailbox.name = 'recording';
      mailbox.mode = 'sent';
    }
    // A recipient who lost the address, its confirmation or the active account since the row was queued is not mailed.
    await prisma.user.update({ where: { id: id('sibling') }, data: { emailVerifiedAt: null } });
    const orphan = await prisma.notification.create({
      data: { recipientUserId: id('sibling'), eventKey: 'submission.graded', category: 'assignments', title: 'عنوان', body: 'نص', emailStatus: 'queued' },
      select: { id: true },
    });
    sentBefore = mailbox.sent.length;
    dispatcher.enqueue([orphan.id]);
    await dispatcher.whenIdle();
    expect(await prisma.notification.findUniqueOrThrow({ where: { id: orphan.id } })).toMatchObject({ emailStatus: 'skipped', emailFailure: 'recipient_unavailable', emailSentAt: null });
    expect(mailbox.sent).toHaveLength(sentBefore);
    await prisma.user.update({ where: { id: id('sibling') }, data: { emailVerifiedAt: new Date() } });
  });

  it('AC5: what an earlier process left queued is picked up once — sent when younger than a day, `stale` otherwise — and nothing is ever mailed twice', async () => {
    const queued = (createdAt: Date, title: string) =>
      prisma.notification.create({
        data: { recipientUserId: id('outsider'), eventKey: 'submission.graded', category: 'assignments', title, body: 'نص', data: { link: '/my-assignments' }, emailStatus: 'queued', createdAt },
        select: { id: true },
      });
    const hourOld = await queued(new Date(Date.now() - 60 * 60 * 1000), `PICKUP-${RUN}`);
    const dayOld = await queued(new Date(Date.now() - 25 * 60 * 60 * 1000), `STALE-${RUN}`);
    // Written by THIS process (after its boot): its own hand-over sends it, the pickup must leave it alone.
    const fresh = await queued(new Date(), `FRESH-${RUN}`);
    const state = async (rowId: string) => {
      const row = await prisma.notification.findUniqueOrThrow({ where: { id: rowId } });
      return [row.emailStatus, row.emailFailure];
    };

    const first = await dispatcher.pickUp();
    await dispatcher.whenIdle();
    expect(first.queued).toBeGreaterThanOrEqual(1);
    expect(first.stale).toBeGreaterThanOrEqual(1);
    expect(await state(hourOld.id)).toEqual(['sent', null]);
    expect(await state(dayOld.id)).toEqual(['failed', 'stale']);
    expect(await state(fresh.id)).toEqual(['queued', null]);
    // `outsider` has no language of their own: the subject is in the academy's.
    const announces = templateLocale(null, defaultLocale) === 'en' ? 'New notification' : 'لديك إشعار جديد';
    expect(mailsTo('outsider').map((message) => message.subject)).toEqual([`${announces}: PICKUP-${RUN}`]);

    // A second pickup, and handing the same ids over again, change nothing.
    await dispatcher.pickUp();
    dispatcher.enqueue([hourOld.id, dayOld.id, hourOld.id]);
    await dispatcher.whenIdle();
    expect(mailsTo('outsider')).toHaveLength(1);
    expect(await state(dayOld.id)).toEqual(['failed', 'stale']);

    // The fresh row goes out through the normal hand-over — once, however often its id arrives.
    dispatcher.enqueue([fresh.id, fresh.id]);
    dispatcher.enqueue([fresh.id]);
    await dispatcher.whenIdle();
    dispatcher.enqueue([fresh.id]);
    await dispatcher.whenIdle();
    expect(await state(fresh.id)).toEqual(['sent', null]);
    expect(mailsTo('outsider')).toHaveLength(2);
  });

  it('AC6: «my notifications» lists, counts and marks the caller’s own notifications only (API-167..170)', async () => {
    // A known set for the reader, on top of whatever the engine tests left: two finance rows and three lesson rows.
    for (const [category, eventKey] of [
      ['finance', 'invoice.issued'],
      ['lessons', 'lesson.cancelled'],
      ['finance', 'payment.recorded'],
      ['lessons', 'attendance.absent'],
      ['lessons', 'lesson.rescheduled'],
    ] as const) {
      await prisma.notification.create({ data: { recipientUserId: id('student'), eventKey, category, title: `عنوان ${eventKey}`, body: 'نص', data: { link: '/my-lessons' }, studentUserId: id('student') } });
    }
    const all = await prisma.notification.findMany({ where: { recipientUserId: id('student') }, orderBy: { id: 'desc' } });
    const foreign = (await prisma.notification.findFirstOrThrow({ where: { recipientUserId: id('guardian') }, orderBy: { id: 'desc' } })).id;
    expect(all.length).toBeGreaterThanOrEqual(8);

    // API-167: newest first, own rows only, exactly the documented fields — no e-mail state, no address.
    const firstPage = await api().get(INBOX).set(bearer('student')).expect(200);
    expect(firstPage.body.items.map((item: { id: string }) => item.id)).toEqual(all.slice(0, 20).map((row) => row.id));
    expect(firstPage.body.nextCursor).toBe(all.length > 20 ? all[19]!.id : null);
    const newest = firstPage.body.items[0];
    expect(Object.keys(newest).sort()).toEqual(ITEM_KEYS);
    expect(newest).toMatchObject({ id: all[0]!.id, eventKey: 'lesson.rescheduled', category: 'lessons', title: 'عنوان lesson.rescheduled', body: 'نص', data: { link: '/my-lessons' }, announcementId: null, readAt: null });
    expect(newest.student).toEqual({ id: id('student'), fullName: 'Fixture student', displayName: 'Ahmad' });
    expect(new Date(newest.createdAt as string).toISOString()).toBe(newest.createdAt);
    expect(JSON.stringify(firstPage.body)).not.toMatch(/email|@example\.test/i);

    // Keyset pages: no gap, no overlap, no cursor after the last row.
    const collected: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 50; page += 1) {
      const res = await api().get(INBOX).query({ limit: 3, ...(cursor ? { cursor } : {}) }).set(bearer('student')).expect(200);
      expect(res.body.items.length).toBeLessThanOrEqual(3);
      collected.push(...res.body.items.map((item: { id: string }) => item.id));
      cursor = res.body.nextCursor as string | null;
      if (!cursor) break;
      expect(cursor).toBe(collected.at(-1));
    }
    expect(collected).toEqual(all.map((row) => row.id));

    // Filters, ANDed.
    const finance = await api().get(INBOX).query({ category: 'finance', limit: 100 }).set(bearer('student')).expect(200);
    expect(finance.body.items.map((item: { id: string }) => item.id)).toEqual(all.filter((row) => row.category === 'finance').map((row) => row.id));
    const unreadBefore = all.filter((row) => row.readAt === null).map((row) => row.id);
    const unread = await api().get(INBOX).query({ unread: 'true', limit: 100 }).set(bearer('student')).expect(200);
    expect(unread.body.items.map((item: { id: string }) => item.id)).toEqual(unreadBefore);
    // `unread=false` is "all of them", not `Boolean("false")`.
    expect((await api().get(INBOX).query({ unread: 'false', limit: 100 }).set(bearer('student')).expect(200)).body.items).toHaveLength(all.length);
    for (const query of [{ unread: 'maybe' }, { category: 'sms' }, { limit: 0 }, { limit: 101 }, { cursor: 'not-a-cursor' }, { recipientUserId: id('guardian') }]) {
      await api().get(INBOX).query(query).set(bearer('student')).expect(400);
    }

    // API-168: the counter.
    expect((await api().get(`${INBOX}/unread-count`).set(bearer('student')).expect(200)).body).toEqual({ unread: unreadBefore.length });
    const guardianUnread = (await api().get(`${INBOX}/unread-count`).set(bearer('guardian')).expect(200)).body.unread as number;
    expect(guardianUnread).toBeGreaterThan(0);

    // API-169: read once; a repeat changes nothing; another user's notification is a 404, like an unknown one.
    const target = unreadBefore[0]!;
    const marked = await api().post(`${INBOX}/${target}/read`).set(bearer('student')).expect(200);
    expect(Object.keys(marked.body).sort()).toEqual(ITEM_KEYS);
    expect(marked.body.id).toBe(target);
    expect(typeof marked.body.readAt).toBe('string');
    const again = await api().post(`${INBOX}/${target}/read`).set(bearer('student')).expect(200);
    expect(again.body.readAt).toBe(marked.body.readAt);
    for (const missing of [foreign, ZERO_ID]) {
      const res = await api().post(`${INBOX}/${missing}/read`).set(bearer('student')).expect(404);
      expect(res.body).toMatchObject({ statusCode: 404, code: 'notification_not_found', notificationId: missing });
    }
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: foreign } })).readAt).toBeNull();
    await api().post(`${INBOX}/not-a-uuid/read`).set(bearer('student')).expect(400);
    expect((await api().get(`${INBOX}/unread-count`).set(bearer('student')).expect(200)).body).toEqual({ unread: unreadBefore.length - 1 });

    // API-170: one category, then everything; the answer is how many this call marked.
    const unreadFinance = all.filter((row) => row.readAt === null && row.category === 'finance' && row.id !== target).length;
    expect((await api().post(`${INBOX}/read-all`).set(bearer('student')).send({ category: 'finance' }).expect(200)).body).toEqual({ updated: unreadFinance });
    expect((await api().post(`${INBOX}/read-all`).set(bearer('student')).send({ category: 'finance' }).expect(200)).body).toEqual({ updated: 0 });
    await api().post(`${INBOX}/read-all`).set(bearer('student')).send({ category: 'sms' }).expect(400);
    await api().post(`${INBOX}/read-all`).set(bearer('student')).send({ everything: true }).expect(400);
    // No body at all marks every category.
    expect((await api().post(`${INBOX}/read-all`).set(bearer('student')).expect(200)).body).toEqual({ updated: unreadBefore.length - 1 - unreadFinance });
    expect((await api().get(`${INBOX}/unread-count`).set(bearer('student')).expect(200)).body).toEqual({ unread: 0 });
    expect((await api().get(INBOX).query({ unread: 'true' }).set(bearer('student')).expect(200)).body).toEqual({ items: [], nextCursor: null });
    // Nobody else's notifications moved.
    expect((await api().get(`${INBOX}/unread-count`).set(bearer('guardian')).expect(200)).body).toEqual({ unread: guardianUnread });

    // Signed out: nothing.
    await api().get(INBOX).expect(401);
    await api().get(`${INBOX}/unread-count`).expect(401);
    await api().post(`${INBOX}/read-all`).expect(401);
    await api().post(`${INBOX}/${target}/read`).expect(401);
  });

  it('the e-mail preferences are the caller’s own six switches; a change replaces the named categories only (API-171/172)', async () => {
    const allOn = CATEGORIES.map((category) => ({ category, emailEnabled: true }));
    const switches = (off: string[]) => CATEGORIES.map((category) => ({ category, emailEnabled: !off.includes(category) }));
    // The guardian changed nothing yet: everything on, the address confirmed, a transport configured.
    expect((await api().get(PREFERENCES).set(bearer('guardian')).expect(200)).body).toEqual({ categories: allOn, emailVerified: true, emailAvailable: true });
    // The student switched `finance` off in an earlier test (directly in the table).
    expect((await api().get(PREFERENCES).set(bearer('student')).expect(200)).body).toEqual({ categories: switches(['finance']), emailVerified: true, emailAvailable: true });

    const first = await api()
      .put(PREFERENCES)
      .set(bearer('guardian'))
      .send({ categories: [{ category: 'lessons', emailEnabled: false }, { category: 'exams', emailEnabled: false }] })
      .expect(200);
    expect(first.body).toEqual({ categories: switches(['lessons', 'exams']), emailVerified: true, emailAvailable: true });
    // Only the named category changes: `exams` stays off, `lessons` comes back on, `grades` goes off.
    const second = await api()
      .put(PREFERENCES)
      .set(bearer('guardian'))
      .send({ categories: [{ category: 'lessons', emailEnabled: true }, { category: 'grades', emailEnabled: false }] })
      .expect(200);
    expect(second.body.categories).toEqual(switches(['exams', 'grades']));
    expect((await api().get(PREFERENCES).set(bearer('guardian')).expect(200)).body.categories).toEqual(switches(['exams', 'grades']));
    // The engine obeys it: an exam event no longer mails the guardian, an assignment event still does.
    const exam = await emit((tx) =>
      engine.notifyStudents(tx, 'exam.results_published', [{ studentId: id('student'), params: { examId: assignmentId, classId, title: { ar: 'اختبار' }, result: 'absent', score: null, maxScore: '20' } }]),
    );
    expect(byRecipient(exam.rows)['guardian']![0]!.emailStatus).toBe('none');
    expect(byRecipient(exam.rows)['student']![0]!.emailStatus).toBe('sent');
    const assignment = await emit((tx) => engine.notifyStudents(tx, 'submission.graded', [{ studentId: id('student'), params: graded() }]));
    expect(byRecipient(assignment.rows)['guardian']![0]!.emailStatus).toBe('sent');

    // Refusals: nothing named, a category twice, an unknown category, a value that is not a JSON boolean, an unknown field.
    for (const body of [{}, { categories: [] }]) {
      const res = await api().put(PREFERENCES).set(bearer('guardian')).send(body).expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, code: 'nothing_to_update' });
    }
    for (const body of [
      { categories: [{ category: 'lessons', emailEnabled: true }, { category: 'lessons', emailEnabled: false }] },
      { categories: [{ category: 'sms', emailEnabled: true }] },
      { categories: [{ category: 'lessons', emailEnabled: 'no' }] },
      { categories: [{ category: 'lessons' }] },
      { categories: [{ category: 'lessons', emailEnabled: true, pushEnabled: true }] },
      { categories: 'lessons' },
      { categories: [{ category: 'lessons', emailEnabled: true }], userId: id('student') },
    ]) {
      const res = await api().put(PREFERENCES).set(bearer('guardian')).send(body).expect(400);
      expect(res.body.code).toBeUndefined();
    }
    expect((await api().get(PREFERENCES).set(bearer('guardian')).expect(200)).body.categories).toEqual(switches(['exams', 'grades']));
    // The student's switches did not move, and nobody reads them signed out.
    expect((await api().get(PREFERENCES).set(bearer('student')).expect(200)).body.categories).toEqual(switches(['finance']));
    await api().get(PREFERENCES).expect(401);
    await api().put(PREFERENCES).send({ categories: [{ category: 'lessons', emailEnabled: false }] }).expect(401);

    // Why no e-mail arrives although the switches are on: no confirmed address, or no transport at all.
    await prisma.user.update({ where: { id: id('outsider') }, data: { emailVerifiedAt: null } });
    expect((await api().get(PREFERENCES).set(bearer('outsider')).expect(200)).body).toEqual({ categories: allOn, emailVerified: false, emailAvailable: true });
    try {
      mailbox.name = 'none';
      expect((await api().get(PREFERENCES).set(bearer('outsider')).expect(200)).body).toMatchObject({ emailVerified: false, emailAvailable: false });
    } finally {
      mailbox.name = 'recording';
    }
  });

  it('D-R86/AC7: no notification, read mark or preference is audited, and the server log never carries an address, a title or a link', async () => {
    await dispatcher.whenIdle();
    // The fixture users signed in (auth events) and nothing else of theirs was ever recorded.
    const recorded = await prisma.auditLog.findMany({ where: { OR: [{ actorUserId: { in: createdUserIds } }, { entityId: { in: createdUserIds } }] }, select: { action: true } });
    expect(recorded.length).toBeGreaterThan(0);
    expect([...new Set(recorded.map((event) => event.action))].filter((action) => !action.startsWith('auth.'))).toEqual([]);
    expect(await prisma.auditLog.count({ where: { entityType: { in: ['notifications', 'notification_preferences'] }, entityId: { in: (await since(ZERO_ID)).map((row) => row.id) } } })).toBe(0);

    const log = logger.lines.join('\n');
    // The failing transport of AC4 was logged — by kind, never by content.
    expect(log).toContain('mail delivery failed (transport=recording, kind=notification)');
    for (const name of Object.keys(fx)) expect(log, `address of ${name}`).not.toContain(email(name));
    expect(log).not.toMatch(/@example\.test/);
    const rows = await since(ZERO_ID);
    expect(rows.length).toBeGreaterThan(20);
    for (const text of new Set(rows.flatMap((row) => [row.title, row.body]))) expect(log).not.toContain(text);
    for (const link of ['/my-assignments', '/my-lessons', '/my-invoices', '/my-exams']) expect(log).not.toContain(link);
    for (const subject of new Set(mailbox.sent.map((message) => message.subject))) expect(log).not.toContain(subject);
  });

  it('documents the six routes in OpenAPI under the notifications tag', async () => {
    const res = await api().get('/api/docs-json').expect(200);
    const paths = res.body.paths as Record<string, Record<string, { tags?: string[] }>>;
    const documented: Array<[string, string]> = [
      ['/api/me/notifications', 'get'],
      ['/api/me/notifications/unread-count', 'get'],
      ['/api/me/notifications/read-all', 'post'],
      ['/api/me/notifications/{id}/read', 'post'],
      ['/api/me/notification-preferences', 'get'],
      ['/api/me/notification-preferences', 'put'],
    ];
    for (const [path, method] of documented) {
      expect(paths[path]?.[method]?.tags, `${method.toUpperCase()} ${path}`).toEqual(['notifications']);
    }
    const schemas = res.body.components.schemas as Record<string, { properties?: Record<string, unknown> }>;
    expect(Object.keys(schemas['MyNotificationDto']!.properties!).sort()).toEqual(ITEM_KEYS);
    expect(Object.keys(schemas['NotificationPreferencesDto']!.properties!).sort()).toEqual(['categories', 'emailAvailable', 'emailVerified']);
  }, 20_000);
});
