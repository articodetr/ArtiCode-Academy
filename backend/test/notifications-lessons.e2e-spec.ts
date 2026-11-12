// TEST-176 — MOD-12-T03 (lessons): the three notification events of MOD-06
// through the real routes, against the live development database (skipped
// when no database is reachable). Inside the transaction of its own write,
//   * `POST /api/lessons/:id/status` with `cancel` writes `lesson.cancelled`
//     — a class event: one notification per recipient (the students with an
//     active enrollment and their guardians, a guardian's copy naming their
//     children in the class), never the reason;
//   * `PATCH /api/lessons/:id` writes `lesson.rescheduled` when the time range
//     or the room of a scheduled lesson really changes — a class event that
//     describes the lesson after the change, in its display zone;
//   * `PUT /api/lessons/:id/attendance` writes `attendance.absent` — a student
//     event: one notification per (recipient × student) for every record the
//     batch creates as `absent` or changes to it, never the note.
// Nothing else notifies: not creating, completing, restoring or deleting a
// lesson, not a PATCH of other fields or without a difference, not a record
// that stays absent, and no refused request.
//
// Fixtures carry a unique prefix and are deleted at the end (deleting the
// users removes their notifications). Class A, taught by `teacher` (lead) and
// `teacher2` (assistant):
//
//   s1   en, confirmed address, shown as «Sami»   active      guardian, norole
//   s2   ar, unconfirmed address                  active      guardian
//   s3   en, confirmed address                    withdrawn   guardian
//
// `guardian` (ar, confirmed address) holds the `guardian` role; `norole` is
// linked to s1 without it; `foreign` teaches class B only; `clerk` sees every
// class but may write neither lessons nor attendance. The room `RZ` belongs
// to a branch in another time zone than the academy's; `RN` has neither a
// branch nor a name.
//
// The mail transport is replaced by a recorder named `none` — what
// `MAIL_TRANSPORT=none` of vitest.config.e2e.ts gives: nothing is e-mailed and
// a due e-mail is `skipped`. Only the two tests that prove the hand-over
// after the commit rename it `recording`, and then it merely keeps the
// messages. No mail ever leaves this suite.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { PasswordService } from '../src/auth/password.service.js';
import type { LocaleCode, LocalizedText } from '../src/authorization/localized-text.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import type { EnrollmentStatus } from '../src/generated/prisma/client.js';
import { MAIL_TRANSPORT } from '../src/mail/mail.transport.js';
import type { MailDeliveryResult, MailMessage, MailTransport } from '../src/mail/mail.transport.js';
import { NotificationDispatcher } from '../src/notifications/notifications.dispatcher.js';
import type { NotificationEventParams } from '../src/notifications/notifications.events.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import type { NotificationBatch } from '../src/notifications/notifications.service.js';
import { childrenSuffix, formatWhen, renderNotification } from '../src/notifications/notifications.templates.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `NL${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-176 supertest';
const CLASSES = '/api/classes';
const LESSONS = '/api/lessons';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const TEST_TIMEOUT = 30_000;
const LINK = '/my-lessons';
const ZERO = { recorded: 0, present: 0, absent: 0, late: 0, excused: 0 };

// What must never reach a notification: why a lesson was cancelled, the
// teacher's note on a record, a lesson's description, and the name of
// whoever cancelled, moved or recorded.
const REASON_MARK = `REASONMARK-${RUN}`;
const NOTE_MARK = `NOTEMARK-${RUN}`;
const DESCRIPTION_MARK = `DESCRIPTIONMARK-${RUN}`;
const STAFF_MARK = `STAFFMARK-${RUN}`;
const MARKS = [REASON_MARK, NOTE_MARK, DESCRIPTION_MARK, STAFF_MARK];

const CLASS_NAME: LocalizedText = { ar: 'فصل التنبيهات', en: 'Notices class' };
const SEMINAR: LocalizedText = { ar: 'قاعة الندوات', en: 'Seminar room' };
const titleOf = (name: string): LocalizedText => ({ ar: `درس ${name}`, en: `Lesson ${name}` });
/** Zones the branch may get: the first one whose wall clock differs from the academy's. */
const BRANCH_ZONES = ['Asia/Kathmandu', 'Asia/Tokyo'];

/** The wall clock of an instant in a zone, as both templates print it (`15:45`). */
function clock(instant: string, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone }).format(new Date(instant));
}

type Row = Prisma.NotificationGetPayload<object>;
type AuditRow = Prisma.AuditLogGetPayload<object>;
type Reply = request.Response;
type LessonParams = NotificationEventParams['lesson.cancelled'];
type RoomParam = NotificationEventParams['lesson.rescheduled']['room'];
type LessonEventKey = 'lesson.cancelled' | 'lesson.rescheduled' | 'attendance.absent';

interface Observed {
  res: Reply;
  /** The fixture users' notifications written by the request. */
  rows: Row[];
  /** The fixture actors' audit events recorded by the request. */
  events: AuditRow[];
}

interface UserOptions {
  roles?: string[];
  locale?: 'ar' | 'en';
  verified?: boolean;
  signsIn?: boolean;
  staff?: boolean;
  displayName?: string;
}

/** How the three recipients read: their language and what `MAIL_TRANSPORT=none` leaves as e-mail state (a confirmed address is `skipped`, an unconfirmed one `none`). */
const READERS = {
  s1: { locale: 'en', emailStatus: 'skipped' },
  s2: { locale: 'ar', emailStatus: 'none' },
  guardian: { locale: 'ar', emailStatus: 'skipped' },
} as const;
type Student = 's1' | 's2';

/**
 * Stands in for the configured transport. The engine reads its name: named
 * `none` it is never handed a notification e-mail (a due one is `skipped`),
 * as with `MAIL_TRANSPORT=none`; named `recording` it keeps what the
 * dispatcher sends and answers `sent`.
 */
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

describe.skipIf(!available)('MOD-12 notifications of the lessons module (e2e, TEST-176)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let dispatcher: NotificationDispatcher;
  let academyTimeZone: string;
  let defaultLocale: LocaleCode;
  let branchZone: string;
  let syllabusItemId: string;
  const mailbox = new RecordingTransport();
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const actors: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const classes: Record<string, string> = {};
  const rooms: Record<string, string> = {};
  const lessons: Record<string, string> = {};

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name.toLowerCase()}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  /** The name a guardian's copy mentions a child by: the display name, else the full name. */
  const shown = (name: string) => (name === 's1' ? 'Sami' : `Person ${name}`);
  /** Fixture names in the order of their user ids — the order a guardian's copy of a class event lists children in. */
  const inIdOrder = (...names: string[]) => [...names].sort((a, b) => (id(a) < id(b) ? -1 : 1));

  const patch = (lesson: string, body: object, as = 'teacher') => api().patch(`${LESSONS}/${lessons[lesson] ?? lesson}`).set(bearer(as)).send(body);
  const act = (lesson: string, action: string, reason?: string, as = 'teacher') =>
    api().post(`${LESSONS}/${lessons[lesson] ?? lesson}/status`).set(bearer(as)).send(reason === undefined ? { action } : { action, reason });
  const put = (lesson: string, records: unknown, as = 'teacher') => api().put(`${LESSONS}/${lessons[lesson] ?? lesson}/attendance`).set(bearer(as)).send({ records });
  const rec = (student: string, status: string, extra: Record<string, unknown> = {}) => ({ studentId: id(student), status, ...extra });

  const byRecipient = (rows: Row[]) => Object.fromEntries(Object.entries(fx).map(([name, userId]) => [name, rows.filter((row) => row.recipientUserId === userId)])) as Record<string, Row[]>;
  const recipientsOf = (rows: Row[]) =>
    Object.entries(byRecipient(rows))
      .filter(([, mine]) => mine.length > 0)
      .map(([name]) => name)
      .sort();

  /** What the tests expect a notification to be worded from — built from the fixtures, never read back from the server. */
  const paramsOf = (lesson: string, startsAt: string, timeZone: string, lessonTitle: LocalizedText = titleOf(lesson)): LessonParams => ({
    lessonId: lessons[lesson]!,
    classId: classes['A']!,
    lessonTitle,
    className: CLASS_NAME,
    startsAt: new Date(startsAt),
    timeZone,
  });

  /** Title and body as a reader gets them: the template in their language, and for a guardian the children named at the end. */
  function worded<K extends LessonEventKey>(key: K, params: NotificationEventParams[K], locale: 'ar' | 'en', children: readonly string[] = []): { title: string; body: string } {
    const rendered = renderNotification(key, params, locale, defaultLocale);
    const suffix = childrenSuffix(children, locale);
    return { title: rendered.title, body: suffix ? `${rendered.body} ${suffix}` : rendered.body };
  }

  function expectNoLeak(rows: Row[]): void {
    for (const row of rows) {
      const text = `${row.title}\n${row.body}\n${JSON.stringify(row.data)}`;
      for (const mark of MARKS) expect(text, `${row.eventKey} to ${row.recipientUserId}`).not.toContain(mark);
    }
  }

  /**
   * A class event of class A: exactly three notifications — s1, s2 and ONE for
   * their guardian naming both (s3 is withdrawn, `norole` holds no guardian
   * role, the staff are never told). Returns the three rows by reader.
   */
  function expectClassEvent<K extends 'lesson.cancelled' | 'lesson.rescheduled'>(rows: Row[], key: K, params: NotificationEventParams[K]): Record<keyof typeof READERS, Row> {
    expect(recipientsOf(rows)).toEqual(['guardian', 's1', 's2']);
    expect(rows).toHaveLength(3);
    const mine = byRecipient(rows);
    const data = { link: LINK, lessonId: params.lessonId, classId: params.classId };
    const children = inIdOrder('s1', 's2');
    const common = { eventKey: key, category: 'lessons', readAt: null, announcementId: null };
    for (const student of ['s1', 's2'] as const) {
      const reader = READERS[student];
      expect(mine[student]![0], student).toMatchObject({ ...common, studentUserId: id(student), emailStatus: reader.emailStatus, ...worded(key, params, reader.locale) });
      expect(mine[student]![0]!.data, student).toEqual(data);
    }
    // Two children in the class: no single student on the row; the body and `data.studentIds` name both, in the order of their ids.
    expect(mine['guardian']![0]).toMatchObject({ ...common, studentUserId: null, emailStatus: READERS.guardian.emailStatus, ...worded(key, params, READERS.guardian.locale, children.map(shown)) });
    expect(mine['guardian']![0]!.data).toEqual({ ...data, studentIds: children.map(id) });
    expectNoLeak(rows);
    return { s1: mine['s1']![0]!, s2: mine['s2']![0]!, guardian: mine['guardian']![0]! };
  }

  /**
   * `attendance.absent` for `students`, in the order the request named them:
   * one notification per (recipient × student) — each student their own, the
   * guardian one per child, each naming that child alone.
   */
  function expectAbsences(rows: Row[], params: LessonParams, students: readonly Student[]): void {
    expect(recipientsOf(rows)).toEqual(['guardian', ...students].sort());
    expect(rows).toHaveLength(students.length * 2);
    const mine = byRecipient(rows);
    const data = { link: LINK, lessonId: params.lessonId, classId: params.classId };
    const common = { eventKey: 'attendance.absent', category: 'lessons', readAt: null, announcementId: null };
    for (const student of students) {
      const reader = READERS[student];
      expect(mine[student], student).toHaveLength(1);
      expect(mine[student]![0], student).toMatchObject({ ...common, studentUserId: id(student), emailStatus: reader.emailStatus, ...worded('attendance.absent', params, reader.locale) });
      expect(mine[student]![0]!.data, student).toEqual(data);
    }
    expect(mine['guardian']!.map((row) => row.studentUserId)).toEqual(students.map(id));
    mine['guardian']!.forEach((row, index) => {
      const child = students[index]!;
      expect(row, `guardian about ${child}`).toMatchObject({ ...common, emailStatus: READERS.guardian.emailStatus, ...worded('attendance.absent', params, READERS.guardian.locale, [shown(child)]) });
      // One child: the row itself points at it — no `studentIds`.
      expect(row.data, `guardian about ${child}`).toEqual(data);
    });
    expectNoLeak(rows);
  }

  /** The newest ids: what is written after them belongs to the request under test (other suites share this database). */
  async function newestNotificationId(): Promise<string> {
    return (await prisma.notification.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;
  }
  async function newestAuditId(): Promise<string> {
    return (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;
  }

  /**
   * Sends one request and returns what it left behind. Every lesson of this
   * suite belongs to class A, so a notification about that class in anybody
   * else's inbox — fixture user or not — would show up in the count.
   */
  async function observe(send: () => PromiseLike<Reply>): Promise<Observed> {
    const notificationMark = await newestNotificationId();
    const auditMark = await newestAuditId();
    const res = await send();
    const rows = await prisma.notification.findMany({ where: { id: { gt: notificationMark }, recipientUserId: { in: createdUserIds } }, orderBy: { id: 'asc' } });
    const aboutClass = await prisma.notification.count({ where: { id: { gt: notificationMark }, data: { path: ['classId'], equals: classes['A']! } } });
    expect(aboutClass, 'notifications about class A, whoever received them').toBe(rows.length);
    return { res, rows, events: await prisma.auditLog.findMany({ where: { id: { gt: auditMark }, actorUserId: { in: actors } }, orderBy: { id: 'asc' } }) };
  }

  /** A request that must leave nothing behind: no notification and no audit event. */
  async function expectNothing(send: () => PromiseLike<Reply>, status: number, errorCode?: string): Promise<Reply> {
    const { res, rows, events } = await observe(send);
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    if (errorCode !== undefined) expect(res.body.code, JSON.stringify(res.body)).toBe(errorCode);
    expect(rows, `notifications after a ${status}`).toEqual([]);
    expect(events, `audit events after a ${status}`).toEqual([]);
    return res;
  }

  async function createRole(name: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_${name}_${RUN.toLowerCase()}`, label: { ar: `دور اختبار ${name}` }, permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(name: string, options: UserOptions = {}): Promise<void> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: options.staff ? `${STAFF_MARK} ${name}` : `Person ${name}`,
        displayName: options.displayName ?? null,
        locale: options.locale ?? null,
        status: 'active',
        passwordHash: options.signsIn ? await passwords.hash(PASSWORD) : null,
        emailVerifiedAt: options.verified === false ? null : new Date(),
        roles: { create: (options.roles ?? []).map((roleId) => ({ roleId })) },
      },
      select: { id: true },
    });
    fx[name] = user.id;
    createdUserIds.push(user.id);
    if (options.signsIn) {
      const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(name), password: PASSWORD }).expect(200);
      tokens[name] = res.body.accessToken as string;
      actors.push(user.id);
    }
  }

  async function createClass(key: string, courseId: string, name: LocalizedText, teachers: string[], students: Array<[string, EnrollmentStatus]>): Promise<void> {
    classes[key] = (await prisma.class.create({ data: { courseId, code: code(key), name, capacity: 20, status: 'running' }, select: { id: true } })).id;
    for (const [index, teacher] of teachers.entries()) {
      await prisma.classTeacher.create({ data: { classId: classes[key]!, teacherUserId: id(teacher), role: index === 0 ? 'lead' : 'assistant' }, select: { classId: true } });
    }
    for (const [student, status] of students) {
      await prisma.enrollment.create({ data: { classId: classes[key]!, studentUserId: id(student), status }, select: { id: true } });
    }
  }

  /** A lesson of class A through API-095, 10:00–11:30 UTC on `day`; its teacher is the class's lead. */
  async function createLesson(name: string, day: string, extra: Record<string, unknown> = {}): Promise<void> {
    const res = await api()
      .post(`${CLASSES}/${classes['A']}/lessons`)
      .set(bearer('teacher'))
      .send({ title: titleOf(name), startsAt: `${day}T10:00:00Z`, endsAt: `${day}T11:30:00Z`, ...extra });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    lessons[name] = res.body.id as string;
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
    passwords = new PasswordService();
    dispatcher = app.get(NotificationDispatcher);
    const academy = await prisma.academy.findFirstOrThrow({ select: { timezone: true, defaultLocale: true } });
    academyTimeZone = academy.timezone;
    defaultLocale = academy.defaultLocale;
    // A branch zone whose wall clock at the lessons' hour differs from the academy's.
    branchZone = BRANCH_ZONES.find((zone) => clock('2027-03-01T10:00:00Z', zone) !== clock('2027-03-01T10:00:00Z', academyTimeZone))!;

    const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
    const teacherRole = await systemRole('teacher');
    const studentRole = await systemRole('student');
    const guardianRole = await systemRole('guardian');
    const teaching = await createRole('nlteacher', ['classes.read', 'lessons.read', 'lessons.manage', 'attendance.read', 'attendance.record']);
    const reading = await createRole('nlclerk', ['classes.read', 'classes.manage', 'lessons.read', 'attendance.read']);
    await createUser('teacher', { roles: [teaching, teacherRole], signsIn: true, staff: true });
    await createUser('teacher2', { roles: [teaching, teacherRole], staff: true });
    await createUser('foreign', { roles: [teaching, teacherRole], signsIn: true, staff: true });
    await createUser('clerk', { roles: [reading], signsIn: true, staff: true });
    await createUser('s1', { roles: [studentRole], locale: 'en', displayName: 'Sami' });
    await createUser('s2', { roles: [studentRole], locale: 'ar', verified: false });
    await createUser('s3', { roles: [studentRole], locale: 'en' });
    await createUser('guardian', { roles: [guardianRole], locale: 'ar' });
    await createUser('norole', { locale: 'en' });
    for (const [guardian, student] of [
      ['guardian', 's1'],
      ['guardian', 's2'],
      // s3 left the class: a class event is not about them, so the guardian's copy must not name them.
      ['guardian', 's3'],
      // Linked, but without the `guardian` role: receives nothing.
      ['norole', 's1'],
    ] as const) {
      await prisma.guardianStudent.create({ data: { guardianUserId: id(guardian), studentUserId: id(student), relationship: 'mother' }, select: { studentUserId: true } });
    }

    const course = await prisma.course.create({
      data: { code: code('CRS'), name: { ar: 'دورة تنبيهات الدروس' }, status: 'published', syllabusItems: { create: [{ sortOrder: 1, title: { ar: 'البند 1' } }] } },
      select: { id: true, syllabusItems: { select: { id: true } } },
    });
    syllabusItemId = course.syllabusItems[0]!.id;
    await createClass('A', course.id, CLASS_NAME, ['teacher', 'teacher2'], [
      ['s1', 'active'],
      ['s2', 'active'],
      ['s3', 'withdrawn'],
    ]);
    await createClass('B', course.id, { ar: 'فصل آخر' }, ['foreign'], []);
    const branchId = (await prisma.branch.create({ data: { code: code('BR'), name: { ar: 'فرع بعيد' }, timezone: branchZone }, select: { id: true } })).id;
    rooms['RZ'] = (await prisma.room.create({ data: { branchId, code: code('RZ'), name: SEMINAR }, select: { id: true } })).id;
    rooms['RN'] = (await prisma.room.create({ data: { code: code('RN') }, select: { id: true } })).id;
    rooms['RX'] = (await prisma.room.create({ data: { code: code('RX'), isActive: false }, select: { id: true } })).id;

    // Every lesson on a day of its own: they all share the lead teacher.
    await createLesson('LC', '2027-03-01', { roomId: rooms['RZ'] }); // cancelled, restored, cancelled again
    await createLesson('LD', '2026-01-12'); // completed
    await createLesson('LX', '2027-03-20'); // deleted
    await createLesson('LR', '2027-03-08'); // moved in time and room
    await createLesson('LK', '2027-03-10', { roomId: rooms['RN'] }); // holds RN for the double booking
    await createLesson('LQ', '2027-03-12'); // the target of the refusals
    await createLesson('LZ', '2027-03-15'); // cancelled, then refuses everything
    await createLesson('LP1', '2026-01-10', { roomId: rooms['RZ'] }); // attendance, in the branch's zone
    await createLesson('LP2', '2026-01-11', { roomId: rooms['RN'] }); // attendance, a room without a branch
    await createLesson('LP3', '2026-01-13'); // attendance, no room
    await createLesson('LM1', '2027-04-01'); // e-mail copies
    await createLesson('LM2', '2027-04-02');
    await createLesson('LM3', '2026-01-14');
    await createLesson('LW', '2027-04-05'); // the retried write
  }, 120_000);

  afterAll(async () => {
    try {
      if (dispatcher) await dispatcher.whenIdle();
      if (prisma) {
        await prisma.enrollment.deleteMany({ where: { classId: { in: Object.values(classes) } } });
        // The classes take their teachers, lessons and attendance records with them.
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.room.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.branch.deleteMany({ where: { code: { startsWith: PREFIX } } });
      }
    } finally {
      // Deleting the recipients removes their notifications and guardian links with them.
      if (prisma && createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (prisma && createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it(
    'lesson.cancelled — a cancellation tells the two active students and their guardian once each, in their language and the lesson’s zone, never why; creating, restoring, completing and deleting tell nobody',
    async () => {
      // Fourteen lessons were created through API-095 while s1 and s2 were enrolled: nobody was told.
      expect(await prisma.notification.count({ where: { recipientUserId: { in: createdUserIds } } })).toBe(0);
      expect(branchZone).not.toBe(academyTimeZone);

      const cancelled = await observe(() => act('LC', 'cancel', REASON_MARK));
      expect(cancelled.res.status, JSON.stringify(cancelled.res.body)).toBe(200);
      // The route answers as before: the teacher who cancelled reads the reason, in the lesson's zone (D-R41: its room's branch).
      expect(cancelled.res.body).toMatchObject({ id: lessons['LC'], status: 'cancelled', cancellationReason: REASON_MARK, timeZone: branchZone, startsAt: '2027-03-01T10:00:00.000Z' });
      expect(cancelled.events.map((event) => [event.action, event.entityId, event.metadata])).toEqual([
        ['lessons.status.changed', lessons['LC'], { classId: classes['A'], code: code('A'), action: 'cancel', from: 'scheduled', to: 'cancelled', reason: REASON_MARK }],
      ]);
      const mine = expectClassEvent(cancelled.rows, 'lesson.cancelled', paramsOf('LC', '2027-03-01T10:00:00Z', branchZone));
      // In words: the lesson and its class in the reader's language, the time on the wall clock of the room's branch.
      expect(mine.s1.title).toContain('Lesson LC');
      expect(mine.s1.body).toContain('Notices class');
      expect(mine.s1.body).not.toContain('Student');
      expect(mine.s2.title).toContain('درس LC');
      expect(mine.s2.body).toContain('فصل التنبيهات');
      expect(mine.guardian.body).toContain(`${shown(inIdOrder('s1', 's2')[0]!)}، ${shown(inIdOrder('s1', 's2')[1]!)}`);
      expect(mine.guardian.body).not.toContain(shown('s3'));
      for (const row of cancelled.rows) expect(row.body).toContain(clock('2027-03-01T10:00:00Z', branchZone));

      // Back on the plan: an audit event, nobody told.
      const restored = await observe(() => act('LC', 'restore'));
      expect(restored.res.status, JSON.stringify(restored.res.body)).toBe(200);
      expect(restored.res.body).toMatchObject({ status: 'scheduled', cancellationReason: null });
      expect(restored.events.map((event) => event.action)).toEqual(['lessons.status.changed']);
      expect(restored.rows).toEqual([]);
      // Cancelled once more — a new cancellation, told again; without a reason this time.
      const again = await observe(() => act('LC', 'cancel'));
      expect(again.res.status, JSON.stringify(again.res.body)).toBe(200);
      expectClassEvent(again.rows, 'lesson.cancelled', paramsOf('LC', '2027-03-01T10:00:00Z', branchZone));

      const completed = await observe(() => act('LD', 'complete'));
      expect(completed.res.status, JSON.stringify(completed.res.body)).toBe(200);
      expect(completed.res.body.status).toBe('completed');
      expect(completed.events.map((event) => event.action)).toEqual(['lessons.status.changed']);
      expect(completed.rows).toEqual([]);

      const removed = await observe(() => api().delete(`${LESSONS}/${lessons['LX']}`).set(bearer('teacher')));
      expect(removed.res.status).toBe(204);
      expect(removed.events.map((event) => event.action)).toEqual(['lessons.deleted']);
      expect(removed.rows).toEqual([]);
    },
    TEST_TIMEOUT,
  );

  it(
    'lesson.rescheduled — a new time or room of a scheduled lesson tells the class how the lesson stands now; other fields and a PATCH without a difference tell nobody',
    async () => {
      // The notification words the lesson as it stands after the change: its start, its end and its room.
      const room = (roomParam: RoomParam, params: LessonParams, endsAt: string): NotificationEventParams['lesson.rescheduled'] => ({ ...params, endsAt: new Date(endsAt), room: roomParam });

      // A new time, no room: worded in the academy's zone.
      const moved = await observe(() => patch('LR', { startsAt: '2027-03-09T12:00:00Z', endsAt: '2027-03-09T13:00:00Z' }));
      expect(moved.res.status, JSON.stringify(moved.res.body)).toBe(200);
      expect(moved.res.body).toMatchObject({ startsAt: '2027-03-09T12:00:00.000Z', endsAt: '2027-03-09T13:00:00.000Z', room: null, timeZone: academyTimeZone });
      expect(moved.events.map((event) => [event.action, event.metadata])).toEqual([['lessons.updated', { classId: classes['A'], code: code('A'), fields: ['startsAt', 'endsAt'] }]]);
      let mine = expectClassEvent(moved.rows, 'lesson.rescheduled', room(null, paramsOf('LR', '2027-03-09T12:00:00Z', academyTimeZone), '2027-03-09T13:00:00Z'));
      expect(mine.s1.title).toContain('Lesson LR');
      for (const row of moved.rows) expect(row.body).toContain(clock('2027-03-09T12:00:00Z', academyTimeZone));
      expect(mine.s1.body).toContain(formatWhen(new Date('2027-03-09T12:00:00Z'), academyTimeZone, 'en'));

      // Into the branch's room: the room is named in the reader's language, and the unchanged instant is now worded on the branch's wall clock.
      const housed = await observe(() => patch('LR', { roomId: rooms['RZ'] }));
      expect(housed.res.status, JSON.stringify(housed.res.body)).toBe(200);
      expect(housed.res.body).toMatchObject({ room: { id: rooms['RZ'], code: code('RZ') }, timeZone: branchZone });
      expect(housed.events.map((event) => event.metadata)).toEqual([{ classId: classes['A'], code: code('A'), fields: ['roomId'] }]);
      mine = expectClassEvent(housed.rows, 'lesson.rescheduled', room({ code: code('RZ'), name: SEMINAR }, paramsOf('LR', '2027-03-09T12:00:00Z', branchZone), '2027-03-09T13:00:00Z'));
      expect(mine.s1.body).toContain('Seminar room');
      expect(mine.s2.body).toContain('قاعة الندوات');
      expect(mine.guardian.body).toContain('قاعة الندوات');
      for (const row of housed.rows) expect(row.body).toContain(clock('2027-03-09T12:00:00Z', branchZone));
      expect(clock('2027-03-09T12:00:00Z', branchZone)).not.toBe(clock('2027-03-09T12:00:00Z', academyTimeZone));

      // The end alone moves: the time range changed.
      const longer = await observe(() => patch('LR', { endsAt: '2027-03-09T13:30:00Z' }));
      expect(longer.res.status, JSON.stringify(longer.res.body)).toBe(200);
      expect(longer.events.map((event) => event.metadata)).toEqual([{ classId: classes['A'], code: code('A'), fields: ['endsAt'] }]);
      expectClassEvent(longer.rows, 'lesson.rescheduled', room({ code: code('RZ'), name: SEMINAR }, paramsOf('LR', '2027-03-09T12:00:00Z', branchZone), '2027-03-09T13:30:00Z'));

      // A room without a name or a branch, and a new title in the same request: the notification carries the lesson as it is now.
      const MOVED_TITLE: LocalizedText = { ar: 'درس منقول', en: 'Moved lesson' };
      const renamed = await observe(() => patch('LR', { title: MOVED_TITLE, roomId: rooms['RN'] }));
      expect(renamed.res.status, JSON.stringify(renamed.res.body)).toBe(200);
      expect(renamed.res.body).toMatchObject({ title: MOVED_TITLE, room: { id: rooms['RN'] }, timeZone: academyTimeZone });
      expect(renamed.events.map((event) => event.metadata)).toEqual([{ classId: classes['A'], code: code('A'), fields: ['title', 'roomId'] }]);
      mine = expectClassEvent(renamed.rows, 'lesson.rescheduled', room({ code: code('RN'), name: null }, paramsOf('LR', '2027-03-09T12:00:00Z', academyTimeZone, MOVED_TITLE), '2027-03-09T13:30:00Z'));
      expect(mine.s1.title).toContain('Moved lesson');
      expect(mine.s1.body).toContain(code('RN'));
      expect(mine.s2.title).toContain('درس منقول');

      // Out of every room.
      const roomless = await observe(() => patch('LR', { roomId: null }));
      expect(roomless.res.status, JSON.stringify(roomless.res.body)).toBe(200);
      expect(roomless.res.body.room).toBeNull();
      mine = expectClassEvent(roomless.rows, 'lesson.rescheduled', room(null, paramsOf('LR', '2027-03-09T12:00:00Z', academyTimeZone, MOVED_TITLE), '2027-03-09T13:30:00Z'));
      expect(mine.s1.body).not.toContain(code('RN'));

      // The title alone.
      const RETITLED: LocalizedText = { ar: 'درس بعنوان جديد', en: 'Retitled lesson' };
      const retitled = await observe(() => patch('LR', { title: RETITLED }));
      expect(retitled.res.status, JSON.stringify(retitled.res.body)).toBe(200);
      expect(retitled.events.map((event) => event.metadata)).toEqual([{ classId: classes['A'], code: code('A'), fields: ['title'] }]);
      expect(retitled.rows).toEqual([]);
      // Every other field at once: description, delivery mode, teacher, syllabus item, meeting link.
      const others = await observe(() =>
        patch('LR', { description: { ar: DESCRIPTION_MARK }, deliveryMode: 'hybrid', teacherUserId: id('teacher2'), syllabusItemId, meetingUrl: `https://meet.example.com/${RUN.toLowerCase()}` }),
      );
      expect(others.res.status, JSON.stringify(others.res.body)).toBe(200);
      expect(others.events.map((event) => event.metadata)).toEqual([
        { classId: classes['A'], code: code('A'), fields: ['description', 'deliveryMode', 'teacherUserId', 'syllabusItemId', 'meetingUrl'] },
      ]);
      expect(others.rows).toEqual([]);
      // The stored values again — the same instant written with another offset: nothing is written, recorded or told.
      const same = await observe(() => patch('LR', { title: RETITLED, startsAt: '2027-03-09T15:00:00+03:00', endsAt: '2027-03-09T13:30:00Z', roomId: null }));
      expect(same.res.status, JSON.stringify(same.res.body)).toBe(200);
      expect(same.res.body).toEqual(others.res.body);
      expect(same.events).toEqual([]);
      expect(same.rows).toEqual([]);
    },
    TEST_TIMEOUT,
  );

  it(
    'attendance.absent — every record a batch creates as absent or changes to absent tells that student and their guardian; a repeat, a note on an absent record and any other status tell nobody',
    async () => {
      const inBranch = paramsOf('LP1', '2026-01-10T10:00:00Z', branchZone);
      const first = await observe(() => put('LP1', [rec('s2', 'absent', { note: NOTE_MARK }), rec('s1', 'absent', { note: `${NOTE_MARK} s1` })]));
      expect(first.res.status, JSON.stringify(first.res.body)).toBe(200);
      // The route answers as before: the teacher's sheet keeps the note.
      expect(first.res.body.counts).toEqual({ ...ZERO, recorded: 2, absent: 2 });
      expect(JSON.stringify(first.res.body.items)).toContain(NOTE_MARK);
      expect(first.events.map((event) => [event.action, event.entityId, event.metadata])).toEqual([
        ['attendance.recorded', lessons['LP1'], { classId: classes['A'], code: code('A'), created: 2, updated: 0, counts: { ...ZERO, recorded: 2, absent: 2 } }],
      ]);
      // Four notifications, in the order of the request: s2 and the guardian about s2, s1 and the guardian about s1.
      expectAbsences(first.rows, inBranch, ['s2', 's1']);
      const mine = byRecipient(first.rows);
      expect(mine['s1']![0]!.title).toContain('Lesson LP1');
      expect(mine['s1']![0]!.body).toContain('Notices class');
      expect(mine['guardian']![0]!.body.endsWith(`: ${shown('s2')}.`)).toBe(true);
      expect(mine['guardian']![1]!.body.endsWith(`: ${shown('s1')}.`)).toBe(true);
      // The lesson is held in the branch's room: the day and time are the branch's.
      for (const row of first.rows) expect(row.body).toContain(clock('2026-01-10T10:00:00Z', branchZone));

      // The same batch again: nothing written, nothing told.
      const repeated = await observe(() => put('LP1', [rec('s2', 'absent', { note: NOTE_MARK }), rec('s1', 'absent', { note: `${NOTE_MARK} s1` })]));
      expect(repeated.res.status, JSON.stringify(repeated.res.body)).toBe(200);
      expect(repeated.res.body).toEqual(first.res.body);
      expect(repeated.events).toEqual([]);
      expect(repeated.rows).toEqual([]);
      // A new note on a record that is absent already: written and audited, but no news.
      const noted = await observe(() => put('LP1', [rec('s1', 'absent', { note: `${NOTE_MARK} changed` })]));
      expect(noted.res.status, JSON.stringify(noted.res.body)).toBe(200);
      expect(noted.events.map((event) => event.metadata)).toEqual([{ classId: classes['A'], code: code('A'), created: 0, updated: 1, counts: { ...ZERO, recorded: 2, absent: 2 } }]);
      expect(noted.rows).toEqual([]);
      // Absent → present: no news either.
      const present = await observe(() => put('LP1', [rec('s2', 'present')]));
      expect(present.res.status, JSON.stringify(present.res.body)).toBe(200);
      expect(present.res.body.counts).toEqual({ ...ZERO, recorded: 2, present: 1, absent: 1 });
      expect(present.rows).toEqual([]);
      // Present → absent, in a batch that also touches the note of s1 (absent all along): one more absence, about s2 alone.
      const back = await observe(() => put('LP1', [rec('s1', 'absent', { note: NOTE_MARK }), rec('s2', 'absent')]));
      expect(back.res.status, JSON.stringify(back.res.body)).toBe(200);
      expect(back.events.map((event) => event.metadata)).toEqual([{ classId: classes['A'], code: code('A'), created: 0, updated: 2, counts: { ...ZERO, recorded: 2, absent: 2 } }]);
      expectAbsences(back.rows, inBranch, ['s2']);

      // A room without a branch: the academy's zone. Records created with another status tell nobody …
      const others = await observe(() => put('LP2', [rec('s1', 'late', { minutesLate: 5 }), rec('s2', 'excused', { note: NOTE_MARK })]));
      expect(others.res.status, JSON.stringify(others.res.body)).toBe(200);
      expect(others.events.map((event) => event.action)).toEqual(['attendance.recorded']);
      expect(others.rows).toEqual([]);
      // … and late → absent does.
      const late = await observe(() => put('LP2', [rec('s1', 'absent')]));
      expect(late.res.status, JSON.stringify(late.res.body)).toBe(200);
      expectAbsences(late.rows, paramsOf('LP2', '2026-01-11T10:00:00Z', academyTimeZone), ['s1']);
      for (const row of late.rows) expect(row.body).toContain(clock('2026-01-11T10:00:00Z', academyTimeZone));

      // No room at all — and a batch naming a student who left the class is refused whole: nobody is told, s1 included.
      const refused = await expectNothing(() => put('LP3', [rec('s1', 'absent'), rec('s3', 'absent')]), 422, 'not_enrolled');
      expect(refused.body.studentIds).toEqual([id('s3')]);
      expect(await prisma.attendanceRecord.count({ where: { lessonId: lessons['LP3'] } })).toBe(0);
      const alone = await observe(() => put('LP3', [rec('s1', 'absent', { note: NOTE_MARK })]));
      expect(alone.res.status, JSON.stringify(alone.res.body)).toBe(200);
      expectAbsences(alone.rows, paramsOf('LP3', '2026-01-13T10:00:00Z', academyTimeZone), ['s1']);
    },
    TEST_TIMEOUT,
  );

  it(
    'a refused request tells nobody: another class’s teacher (404), a missing key (403), a cancelled lesson (409), a double booking (409), a bad room or body (422/400)',
    async () => {
      const move = { startsAt: '2027-03-13T12:00:00Z', endsAt: '2027-03-13T13:00:00Z' };
      // The lesson does not exist for a teacher of another class.
      await expectNothing(() => act('LQ', 'cancel', REASON_MARK, 'foreign'), 404, 'lesson_not_found');
      await expectNothing(() => patch('LQ', move, 'foreign'), 404, 'lesson_not_found');
      await expectNothing(() => put('LP1', [rec('s1', 'absent')], 'foreign'), 404, 'lesson_not_found');
      await expectNothing(() => act(NIL_ID, 'cancel'), 404, 'lesson_not_found');
      // Seeing the class is not enough without the writing keys.
      await expectNothing(() => act('LQ', 'cancel', REASON_MARK, 'clerk'), 403, 'permission_denied');
      await expectNothing(() => patch('LQ', move, 'clerk'), 403, 'permission_denied');
      await expectNothing(() => put('LP1', [rec('s1', 'absent')], 'clerk'), 403, 'permission_denied');

      // A cancelled lesson: its cancellation was told once; nothing it refuses afterwards is.
      const cancelled = await observe(() => act('LZ', 'cancel', REASON_MARK));
      expect(cancelled.res.status, JSON.stringify(cancelled.res.body)).toBe(200);
      expectClassEvent(cancelled.rows, 'lesson.cancelled', paramsOf('LZ', '2027-03-15T10:00:00Z', academyTimeZone));
      await expectNothing(() => act('LZ', 'cancel', REASON_MARK), 409, 'invalid_transition');
      await expectNothing(() => patch('LZ', { startsAt: '2027-03-16T12:00:00Z', endsAt: '2027-03-16T13:00:00Z' }), 409, 'lesson_locked');
      const closed = await expectNothing(() => put('LZ', [rec('s1', 'absent')]), 409, 'attendance_closed');
      expect(closed.body.reason).toBe('cancelled');

      // Still scheduled, but the request cannot be carried out.
      await expectNothing(() => act('LQ', 'complete'), 409, 'lesson_not_started');
      await expectNothing(() => act('LQ', 'restore'), 409, 'invalid_transition');
      const early = await expectNothing(() => put('LQ', [rec('s1', 'absent')]), 409, 'attendance_closed');
      expect(early.body.reason).toBe('not_started');
      // The write itself is refused by the database: LK holds that room (and that teacher) at that time.
      const clash = await expectNothing(() => patch('LQ', { startsAt: '2027-03-10T10:30:00Z', endsAt: '2027-03-10T11:00:00Z', roomId: rooms['RN'] }), 409, 'lesson_conflict');
      expect(clash.body.conflictingLessonId).toBe(lessons['LK']);
      await expectNothing(() => patch('LQ', { roomId: rooms['RX'] }), 422, 'room_inactive');
      await expectNothing(() => patch('LQ', { roomId: NIL_ID }), 404, 'room_not_found');
      await expectNothing(() => patch('LQ', { startsAt: '2027-03-12T12:00:00Z' }), 400, 'time_range_invalid');
      await expectNothing(() => patch('LQ', {}), 400, 'nothing_to_update');
      await expectNothing(() => patch('LQ', { startsAt: '2027-03-13' }), 400);
      await expectNothing(() => act('LQ', 'postpone'), 400);
      await expectNothing(() => put('LP1', [rec('s1', 'gone')]), 400);
      await expectNothing(() => put('LP1', [rec('s1', 'absent'), rec('s1', 'absent')]), 400);

      // After all of it LQ stands where it stood, and nobody ever heard of it.
      expect((await api().get(`${LESSONS}/${lessons['LQ']}`).set(bearer('teacher')).expect(200)).body).toMatchObject({ status: 'scheduled', startsAt: '2027-03-12T10:00:00.000Z', room: null });
      expect(await prisma.notification.count({ where: { data: { path: ['lessonId'], equals: lessons['LQ']! } } })).toBe(0);
    },
    TEST_TIMEOUT,
  );

  it(
    'the e-mail copies leave after the commit: a confirmed address gets the title and the link — never the time, the class, a reason or a note',
    async () => {
      /** Sends the request with a transport configured, waits for the dispatcher and returns the settled rows with the messages handed over. */
      const delivered = async (send: () => PromiseLike<Reply>): Promise<{ rows: Record<string, Row[]>; mails: MailMessage[] }> => {
        const before = mailbox.sent.length;
        const { res, rows } = await observe(send);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        await dispatcher.whenIdle();
        const settled = await prisma.notification.findMany({ where: { id: { in: rows.map((row) => row.id) } }, orderBy: { id: 'asc' } });
        expect(settled).toHaveLength(rows.length);
        return { rows: byRecipient(settled), mails: mailbox.sent.slice(before) };
      };
      /** Two messages — to s1 (English) and to the guardian (Arabic) — each announcing its own row's title with the link, and nothing else of the event. */
      const expectCopies = (outcome: { rows: Record<string, Row[]>; mails: MailMessage[] }, hidden: string[]): void => {
        for (const name of ['s1', 'guardian']) {
          expect(outcome.rows[name], name).toHaveLength(1);
          expect(outcome.rows[name]![0], name).toMatchObject({ emailStatus: 'sent', emailFailure: null });
          expect(outcome.rows[name]![0]!.emailSentAt, name).toBeInstanceOf(Date);
          expect(outcome.rows[name]![0]!.emailMessageId, name).toMatch(/^rec-\d+$/);
        }
        expect(outcome.mails.map((message) => message.to).sort()).toEqual([email('guardian'), email('s1')].sort());
        const toStudent = outcome.mails.find((message) => message.to === email('s1'))!;
        expect(toStudent).toMatchObject({ kind: 'notification', locale: 'en', subject: `New notification: ${outcome.rows['s1']![0]!.title}` });
        const toGuardian = outcome.mails.find((message) => message.to === email('guardian'))!;
        expect(toGuardian).toMatchObject({ kind: 'notification', locale: 'ar', subject: `لديك إشعار جديد: ${outcome.rows['guardian']![0]!.title}` });
        for (const message of outcome.mails) {
          expect(message.text).toContain(LINK);
          for (const secret of [...MARKS, ...hidden, CLASS_NAME.ar, CLASS_NAME.en!]) {
            expect(message.subject).not.toContain(secret);
            expect(message.text).not.toContain(secret);
            expect(message.html).not.toContain(secret);
          }
        }
      };

      mailbox.name = 'recording';
      try {
        const cancelled = await delivered(() => act('LM1', 'cancel', REASON_MARK));
        expect(cancelled.rows['s1']![0]!.title).toContain('Lesson LM1');
        // s2 never confirmed an address: no e-mail was due, and none left.
        expect(cancelled.rows['s2']![0]).toMatchObject({ eventKey: 'lesson.cancelled', emailStatus: 'none', emailSentAt: null, emailMessageId: null });
        expectCopies(cancelled, [formatWhen(new Date('2027-04-01T10:00:00Z'), academyTimeZone, 'en'), formatWhen(new Date('2027-04-01T10:00:00Z'), academyTimeZone, 'ar')]);

        const moved = await delivered(() => patch('LM2', { startsAt: '2027-04-03T12:00:00Z', endsAt: '2027-04-03T13:00:00Z', roomId: rooms['RN'] }));
        expect(moved.rows['s2']![0]).toMatchObject({ eventKey: 'lesson.rescheduled', emailStatus: 'none' });
        expectCopies(moved, [formatWhen(new Date('2027-04-03T12:00:00Z'), academyTimeZone, 'en'), formatWhen(new Date('2027-04-03T12:00:00Z'), academyTimeZone, 'ar'), code('RN')]);

        const absent = await delivered(() => put('LM3', [rec('s1', 'absent', { note: NOTE_MARK })]));
        expect(absent.rows['s2']).toEqual([]);
        expect(absent.rows['s1']![0]!.eventKey).toBe('attendance.absent');
        expectCopies(absent, [formatWhen(new Date('2026-01-14T10:00:00Z'), academyTimeZone, 'en'), formatWhen(new Date('2026-01-14T10:00:00Z'), academyTimeZone, 'ar')]);
      } finally {
        mailbox.name = 'none';
      }
    },
    TEST_TIMEOUT,
  );

  it(
    'a write retried after a write conflict (KI-071) leaves one set of notifications and hands it over once — the one that committed',
    async () => {
      const db = app.get(PrismaService).db;
      const engine = app.get(NotificationsService);
      const realTransaction = db.$transaction.bind(db) as unknown as (run: unknown, options?: unknown) => Promise<unknown>;
      const mark = await newestNotificationId();
      let rolledBack = 0;
      // The first transaction that wrote notifications for the fixture users ends as a deadlock victim does: everything it wrote is rolled back and the caller gets P2034.
      const transaction = vi.spyOn(db, '$transaction').mockImplementation(((run: unknown, options?: unknown) => {
        if (typeof run !== 'function') return realTransaction(run, options);
        return realTransaction(async (tx: Prisma.TransactionClient) => {
          const result: unknown = await (run as (tx: Prisma.TransactionClient) => Promise<unknown>)(tx);
          const written = await tx.notification.count({ where: { id: { gt: mark }, recipientUserId: { in: createdUserIds } } });
          if (rolledBack === 0 && written > 0) {
            rolledBack = written;
            throw new Prisma.PrismaClientKnownRequestError('Transaction failed due to a write conflict or a deadlock (injected by TEST-176)', { code: 'P2034', clientVersion: Prisma.prismaVersion.client });
          }
          return result;
        }, options);
      }) as never);
      const dispatch = vi.spyOn(engine, 'dispatch');
      const sentBefore = mailbox.sent.length;
      mailbox.name = 'recording';
      try {
        const retried = await observe(() => act('LW', 'cancel', REASON_MARK));
        expect(retried.res.status, JSON.stringify(retried.res.body)).toBe(200);
        expect(retried.res.body).toMatchObject({ status: 'cancelled', cancellationReason: REASON_MARK });
        // The first attempt had written its three notifications; they went with it.
        expect(rolledBack).toBe(3);
        expect(recipientsOf(retried.rows)).toEqual(['guardian', 's1', 's2']);
        expect(retried.rows).toHaveLength(3);
        expect(retried.events.map((event) => event.action)).toEqual(['lessons.status.changed']);
        // Handed over once, after the second attempt: the batch names the committed rows whose e-mail is due.
        expect(dispatch).toHaveBeenCalledTimes(1);
        const batch = dispatch.mock.calls[0]![0] as NotificationBatch;
        const due = retried.rows.filter((row) => row.recipientUserId !== id('s2')).map((row) => row.id);
        expect(batch.created).toBe(3);
        expect([...batch.queuedIds].sort()).toEqual([...due].sort());
        await dispatcher.whenIdle();
        expect(mailbox.sent.slice(sentBefore).map((message) => message.to).sort()).toEqual([email('guardian'), email('s1')].sort());
        const settled = await prisma.notification.findMany({ where: { id: { in: due } }, select: { emailStatus: true } });
        expect(settled.map((row) => row.emailStatus)).toEqual(['sent', 'sent']);
      } finally {
        mailbox.name = 'none';
        transaction.mockRestore();
        dispatch.mockRestore();
      }

      // The client is whole again: the next write goes through at once, and tells nobody.
      const restored = await observe(() => act('LW', 'restore'));
      expect(restored.res.status, JSON.stringify(restored.res.body)).toBe(200);
      expect(restored.events.map((event) => event.action)).toEqual(['lessons.status.changed']);
      expect(restored.rows).toEqual([]);
    },
    TEST_TIMEOUT,
  );
});
