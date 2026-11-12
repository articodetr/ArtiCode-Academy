// TEST-176 — MOD-12-T03 (assignments): the writers of MOD-08 call the
// notification engine (roadmap §4j.5 T03; owner decisions D-R80/D-R81/D-R83).
// The suite drives the real routes against the live development database and
// then reads the `notifications` table:
//
//   assignment.published   POST /api/assignments/:id/status (publish) — a class
//                          event: the students with an active enrollment and
//                          their guardians, ONE row for a guardian of two
//                          children, naming both
//   submission.graded      POST /api/submissions/:id/review (grade)  — student
//   submission.returned    POST /api/submissions/:id/review (return)   events:
//                          the attempt's student and their guardians
//
// Nothing else in the module tells anybody anything: creating, editing,
// closing, reopening or deleting an assignment, handing an attempt in, a
// refused request, or a review that writes nothing. A notification never
// carries the feedback, the reason of a status action, the instructions, the
// answer or the reviewer's name — the suite sends recognisable markers through
// the routes and looks for them in every row.
//
// The e2e configuration forces MAIL_TRANSPORT=none: nothing is e-mailed, a
// recipient with a confirmed address gets `skipped` and one without it `none`.
// Skipped when no database is reachable. Fixtures carry a unique prefix and
// are deleted at the end — enrollments first (they restrict their class), the
// classes (teachers, lessons, assignments and submissions cascade), the
// course, the room and its branch, then the users (their notifications and
// guardian links cascade) and the role. Other suites share this database, so
// notifications are found above an id watermark and by fixture recipient, and
// audit events by fixture actor.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { PasswordService } from '../src/auth/password.service.js';
import type { LocaleCode } from '../src/authorization/localized-text.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import type { NotificationEventKey, NotificationEventParams } from '../src/notifications/notifications.events.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import type { NotificationBatch } from '../src/notifications/notifications.service.js';
import { childrenSuffix, renderNotification } from '../src/notifications/notifications.templates.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `Q${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-176 supertest';
const CLASSES = '/api/classes';
const ASSIGNMENTS = '/api/assignments';
const SUBMISSIONS = '/api/submissions';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
/** `data.link` of every assignment notification: the page where the recipient already sees the assignment. */
const LINK = '/my-assignments';

// What a notification must never carry (D-R83). Each marker travels through a route and is then searched for in every row.
const REASON_MARK = `REASON-${RUN}`;
const FEEDBACK_MARK = `FEEDBACK-${RUN}`;
const GRADER_MARK = `GRADER-${RUN}`;
const ANSWER_MARK = `ANSWER-${RUN}`;
const INSTRUCTIONS_MARK = `INSTRUCTIONS-${RUN}`;
const MARKERS = [REASON_MARK, FEEDBACK_MARK, GRADER_MARK, ANSWER_MARK, INSTRUCTIONS_MARK];

const CLASS_NAME = { ar: 'فصل الإشعارات', en: 'Notifications class' };
const ESSAY = { ar: 'واجب المقال', en: 'Essay' };
const LATE = { ar: 'واجب متأخر' };
const UNDATED = { ar: 'واجب مفتوح', en: 'Open task' };
const DUE = '2031-03-10T09:00:00.000Z';
const DUE_AT = new Date(DUE);
const PAST_DUE = '2020-01-01T00:00:00.000Z';
/** The names a guardian's copy mentions the children by: the display name, else the full name. */
const CHILD_NAMES: Record<string, string> = { student1: 'Sami', student2: 'Fixture student2' };

const ASSIGNMENT_KEYS = [
  'activeStudents',
  'allowLate',
  'class',
  'closedAt',
  'createdAt',
  'dueAt',
  'id',
  'instructions',
  'latePenaltyPercent',
  'lesson',
  'maxAttempts',
  'maxScore',
  'publishedAt',
  'status',
  'submissions',
  'timeZone',
  'title',
  'updatedAt',
  'weight',
];
const SUBMISSION_KEYS = [
  'assignment',
  'attemptNo',
  'attempts',
  'attemptsAllowed',
  'feedback',
  'gradedAt',
  'gradedBy',
  'history',
  'id',
  'isLate',
  'linkUrl',
  'score',
  'status',
  'student',
  'submittedAt',
  'textAnswer',
];

type Row = Prisma.NotificationGetPayload<object>;
type AuditRow = Prisma.AuditLogGetPayload<object>;

/** What one request left behind. */
interface Observed<T> {
  res: T;
  /** Notifications written for a fixture user. */
  rows: Row[];
  /** Audit events recorded for a fixture actor. */
  events: AuditRow[];
  /** What the writer handed to the dispatcher once its transaction had resolved. */
  batches: NotificationBatch[];
}

interface UserOptions {
  roles?: string[];
  locale?: 'ar' | 'en';
  verified?: boolean;
  signsIn?: boolean;
  fullName?: string;
  displayName?: string;
}

/** The wall clock of an instant in a zone (`HH:MM`), computed apart from the templates. */
function clock(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant);
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

describe.skipIf(!available)('MOD-12 notifications of the assignment writers (e2e, TEST-176)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let academyTimeZone: string;
  let defaultLocale: LocaleCode;
  /** The zone of the branch whose room holds the lesson of the first assignment (D-R41). */
  let branchZone: string;
  let lessonId: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  /** Fixture user ids by name. */
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const classes: Record<string, string> = {};
  const assignments: Record<string, string> = {};
  const submissions: Record<string, string> = {};
  const actors: string[] = [];
  /** Every batch a writer handed to `NotificationsService.dispatch()`, in order. */
  const handedOver: NotificationBatch[] = [];

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name.toLowerCase()}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  const createDraft = (body: object, as = 'teacher') => api().post(`${CLASSES}/${classes['A']}/assignments`).set(bearer(as)).send(body);
  const act = (assignment: string, body: object, as = 'teacher') => api().post(`${ASSIGNMENTS}/${assignments[assignment]}/status`).set(bearer(as)).send(body);
  const submit = (assignment: string, body: object, as: string) => api().post(`${ASSIGNMENTS}/${assignments[assignment]}/submissions`).set(bearer(as)).send(body);
  const review = (submission: string, body: object, as = 'teacher') => api().post(`${SUBMISSIONS}/${submissions[submission]}/review`).set(bearer(as)).send(body);

  /** The newest notification id in the table: rows written after it belong to the request under test. */
  async function newestNotification(): Promise<string> {
    return (await prisma.notification.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;
  }
  const since = (mark: string) => prisma.notification.findMany({ where: { id: { gt: mark }, recipientUserId: { in: createdUserIds } }, orderBy: { id: 'asc' } });
  async function newestAuditEvent(): Promise<string> {
    return (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;
  }
  const eventsSince = (mark: string) => prisma.auditLog.findMany({ where: { id: { gt: mark }, actorUserId: { in: actors } }, orderBy: { id: 'asc' } });

  /** Sends one request and collects what it wrote: notifications, audit events and hand-overs to the dispatcher. */
  async function observe<T>(send: () => PromiseLike<T>): Promise<Observed<T>> {
    const notificationMark = await newestNotification();
    const auditMark = await newestAuditEvent();
    handedOver.length = 0;
    const res = await send();
    return { res, rows: await since(notificationMark), events: await eventsSince(auditMark), batches: [...handedOver] };
  }

  const nameOf = (userId: string) => Object.keys(fx).find((name) => fx[name] === userId) ?? userId;
  const recipientsOf = (rows: Row[]) => rows.map((row) => nameOf(row.recipientUserId)).sort();
  /** The single row of a recipient among the rows of one request. */
  function rowFor(rows: Row[], name: string): Row {
    const mine = rows.filter((row) => row.recipientUserId === id(name));
    expect(mine, `rows of ${name}`).toHaveLength(1);
    return mine[0]!;
  }
  /** The guardian's two children in the class in the order of their ids — the order a class event names them in. */
  const children = () => ['student1', 'student2'].sort((a, b) => (id(a) < id(b) ? -1 : 1));

  /** What the engine words for this event, these parameters and this reader (the wording itself is TEST-175's subject). */
  function worded<K extends NotificationEventKey>(key: K, params: NotificationEventParams[K], locale: 'ar' | 'en', childNames: readonly string[] = []): { title: string; body: string } {
    const rendered = renderNotification(key, params, locale, defaultLocale);
    const suffix = childrenSuffix(childNames, locale);
    return { title: rendered.title, body: suffix ? `${rendered.body} ${suffix}` : rendered.body };
  }

  /** No title, body or data of these rows carries a reason, a feedback, an answer, the instructions or the reviewer's name. */
  function expectNoLeak(rows: Row[]): void {
    for (const row of rows) {
      const text = [row.title, row.body, JSON.stringify(row.data)].join('\n');
      for (const marker of MARKERS) expect(text, `${row.eventKey} carries ${marker}`).not.toContain(marker);
    }
  }
  /** A refused request: no notification, no audit event, and the writer never reached the hand-over to the dispatcher. */
  function expectRefused(seen: Observed<unknown>, label: string): void {
    expect(seen.rows, label).toEqual([]);
    expect(seen.events, label).toEqual([]);
    expect(seen.batches, label).toEqual([]);
  }
  /** A request that went through and concerns no recipient: nothing written, nothing for the dispatcher. */
  function expectSilent(seen: Observed<unknown>, label: string): void {
    expect(seen.rows, label).toEqual([]);
    expect(seen.batches.filter((batch) => batch.created > 0 || batch.queuedIds.length > 0), label).toEqual([]);
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
        fullName: options.fullName ?? `Fixture ${name}`,
        displayName: options.displayName ?? null,
        // An explicit language, so the wording never depends on the academy's default.
        locale: options.locale ?? 'ar',
        status: 'active',
        passwordHash: options.signsIn ? await passwords.hash(PASSWORD) : null,
        emailVerifiedAt: options.verified === false ? null : new Date(),
        roles: { create: (options.roles ?? []).map((roleId) => ({ roleId })) },
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    if (options.signsIn) {
      const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(name), password: PASSWORD }).expect(200);
      tokens[name] = res.body.accessToken as string;
      actors.push(user.id);
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    // Every hand-over to the dispatcher is recorded — and still happens.
    const engine = app.get(NotificationsService);
    const dispatch = engine.dispatch.bind(engine);
    vi.spyOn(engine, 'dispatch').mockImplementation((batch) => {
      handedOver.push(batch);
      dispatch(batch);
    });

    const academy = await prisma.academy.findFirstOrThrow({ select: { timezone: true, defaultLocale: true } });
    academyTimeZone = academy.timezone;
    defaultLocale = academy.defaultLocale;
    // D-R41: a branch whose wall clock differs from the academy's at the due instant of the first assignment.
    branchZone = ['Asia/Tokyo', 'Europe/Berlin', 'America/New_York'].find((zone) => clock(DUE_AT, zone) !== clock(DUE_AT, academyTimeZone))!;

    const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
    const teacherRole = await systemRole('teacher');
    const studentRole = await systemRole('student');
    const guardianRole = await systemRole('guardian');
    const grading = await createRole('qgrader', ['classes.read', 'assignments.read', 'assignments.manage', 'assignments.grade']);
    // The reviewer's names are markers: the review route names them in its answer, a notification never does.
    await createUser('teacher', { roles: [grading, teacherRole], signsIn: true, fullName: `Teacher ${GRADER_MARK}`, displayName: `Ustadh ${GRADER_MARK}` });
    await createUser('foreign', { roles: [grading, teacherRole], signsIn: true });
    await createUser('student1', { roles: [studentRole], locale: 'en', signsIn: true, displayName: CHILD_NAMES['student1']! });
    // Nobody confirmed this student's address: notified in the app, never by e-mail.
    await createUser('student2', { roles: [studentRole], locale: 'ar', verified: false, signsIn: true });
    await createUser('withdrawn', { roles: [studentRole] });
    await createUser('outsider', { roles: [studentRole] });
    await createUser('guardian', { roles: [guardianRole], locale: 'ar' });
    // Linked to a student without holding the `guardian` role: links alone grant nothing (D-R81).
    await createUser('linked', { locale: 'en' });
    for (const [guardianName, studentName] of [
      ['guardian', 'student1'],
      ['guardian', 'student2'],
      ['guardian', 'withdrawn'],
      ['linked', 'student1'],
    ] as const) {
      await prisma.guardianStudent.create({ data: { guardianUserId: id(guardianName), studentUserId: id(studentName), relationship: 'father' }, select: { studentUserId: true } });
    }

    const courseId = (await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة إشعارات الواجبات' }, status: 'published' }, select: { id: true } })).id;
    for (const [suffix, name, teacher] of [
      ['A', CLASS_NAME, 'teacher'],
      ['B', { ar: 'فصل آخر' }, 'foreign'],
    ] as const) {
      classes[suffix] = (
        await prisma.class.create({
          data: { courseId, code: code(suffix), name, capacity: 20, status: 'running', teachers: { create: [{ teacherUserId: id(teacher), role: 'lead' }] } },
          select: { id: true },
        })
      ).id;
    }
    for (const [suffix, student, status] of [
      ['A', 'student1', 'active'],
      ['A', 'student2', 'active'],
      ['A', 'withdrawn', 'withdrawn'],
      ['B', 'outsider', 'active'],
    ] as const) {
      await prisma.enrollment.create({ data: { classId: classes[suffix]!, studentUserId: id(student), status, activatedAt: new Date() }, select: { id: true } });
    }
    const branchId = (await prisma.branch.create({ data: { code: code('BR'), name: { ar: 'فرع بمنطقته' }, timezone: branchZone }, select: { id: true } })).id;
    const roomId = (await prisma.room.create({ data: { code: code('RM'), name: { ar: 'قاعة الفرع' }, branchId }, select: { id: true } })).id;
    lessonId = (
      await prisma.lesson.create({
        data: { classId: classes['A']!, roomId, title: { ar: 'درس الواجب' }, startsAt: new Date('2031-03-03T08:00:00Z'), endsAt: new Date('2031-03-03T09:00:00Z') },
        select: { id: true },
      })
    ).id;
  }, 120_000); // four accounts are hashed and signed in with Argon2 while other suites share the machine

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.enrollment.deleteMany({ where: { classId: { in: Object.values(classes) } } });
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.room.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.branch.deleteMany({ where: { code: { startsWith: PREFIX } } });
      }
    } finally {
      // Deleting the users removes their notifications and guardian links with them.
      if (prisma && createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (prisma && createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      vi.restoreAllMocks();
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it(
    'assignment.published — publishing tells the active students of the class and their guardians once each; a draft, a refused publish, closing and reopening tell nobody',
    async () => {
      // A draft is nobody's business yet: creating it, editing it and deleting another one write nothing.
      const beforeDrafts = await newestNotification();
      const draft = await createDraft({ title: ESSAY, instructions: { ar: INSTRUCTIONS_MARK }, lessonId, maxScore: 20, dueAt: DUE, maxAttempts: 2 });
      expect(draft.status, JSON.stringify(draft.body)).toBe(201);
      assignments['essay'] = draft.body.id as string;
      await api().patch(`${ASSIGNMENTS}/${assignments['essay']}`).set(bearer('teacher')).send({ weight: 10 }).expect(200);
      const scrap = await createDraft({ title: { ar: 'مسودة تُحذف' }, maxScore: 10 }).expect(201);
      await api().delete(`${ASSIGNMENTS}/${scrap.body.id as string}`).set(bearer('teacher')).expect(204);
      expect(await since(beforeDrafts)).toEqual([]);

      // Refused: the teacher of another class does not even see the assignment.
      const hidden = await observe(() => act('essay', { action: 'publish' }, 'foreign'));
      expect(hidden.res.status).toBe(404);
      expect(hidden.res.body).toMatchObject({ code: 'assignment_not_found', assignmentId: assignments['essay'] });
      expectRefused(hidden, 'publish by a teacher of another class');

      const published = await observe(() => act('essay', { action: 'publish', reason: REASON_MARK }));
      // The route answers what it always answered and records its one event — the reason in it.
      expect(published.res.status, JSON.stringify(published.res.body)).toBe(200);
      expect(Object.keys(published.res.body).sort()).toEqual([...ASSIGNMENT_KEYS].sort());
      expect(published.res.body).toMatchObject({ id: assignments['essay'], status: 'open', title: ESSAY, dueAt: DUE, timeZone: branchZone, closedAt: null, activeStudents: 2 });
      expect(typeof published.res.body.publishedAt).toBe('string');
      expect(published.events.map((event) => [event.action, event.entityType, event.entityId, event.actorUserId])).toEqual([
        ['assignments.status.changed', 'assignments', assignments['essay'], id('teacher')],
      ]);
      expect(published.events[0]!.metadata).toEqual({ classId: classes['A'], code: code('A'), action: 'publish', from: 'draft', to: 'open', reason: REASON_MARK });

      // One notification per recipient: the two active students and their guardian — not the withdrawn student, not
      // the linked user without the `guardian` role, not the student of another class, not a teacher.
      expect(recipientsOf(published.rows)).toEqual(['guardian', 'student1', 'student2']);
      expect(published.batches).toEqual([{ created: 3, queuedIds: [] }]);
      for (const row of published.rows) {
        expect(row).toMatchObject({ eventKey: 'assignment.published', category: 'assignments', readAt: null, announcementId: null, emailSentAt: null, emailMessageId: null });
      }
      const params = { assignmentId: assignments['essay']!, classId: classes['A']!, title: ESSAY, className: CLASS_NAME, dueAt: DUE_AT, timeZone: branchZone };
      const toStudent1 = rowFor(published.rows, 'student1');
      expect(toStudent1).toMatchObject({ ...worded('assignment.published', params, 'en'), studentUserId: id('student1'), emailStatus: 'skipped' });
      expect(toStudent1.title).toBe('New assignment: Essay');
      expect(toStudent1.body).toContain('“Essay”');
      expect(toStudent1.body).toContain('“Notifications class”');
      expect(toStudent1.data).toEqual({ link: LINK, assignmentId: assignments['essay'], classId: classes['A'] });
      // D-R41: the due instant is worded in the zone the assignment is shown in — the branch of its lesson's room, not the academy.
      expect(toStudent1.body).toContain(clock(DUE_AT, branchZone));
      expect(toStudent1.body).not.toContain(clock(DUE_AT, academyTimeZone));
      const toStudent2 = rowFor(published.rows, 'student2');
      expect(toStudent2).toMatchObject({ ...worded('assignment.published', params, 'ar'), studentUserId: id('student2'), emailStatus: 'none' });
      expect(toStudent2.title).toBe('واجب جديد: واجب المقال');
      expect(toStudent2.data).toEqual({ link: LINK, assignmentId: assignments['essay'], classId: classes['A'] });
      // The guardian of both: ONE row, no single student on it, naming the two children in the order of their ids.
      const toGuardian = rowFor(published.rows, 'guardian');
      const childNames = children().map((name) => CHILD_NAMES[name]!);
      expect(toGuardian).toMatchObject({ ...worded('assignment.published', params, 'ar', childNames), studentUserId: null, emailStatus: 'skipped' });
      for (const name of childNames) expect(toGuardian.body).toContain(name);
      expect(toGuardian.data).toEqual({ link: LINK, assignmentId: assignments['essay'], classId: classes['A'], studentIds: children().map(id) });
      expectNoLeak(published.rows);

      // Published once: a second `publish` is refused; closing and reopening change the status and tell nobody.
      const again = await observe(() => act('essay', { action: 'publish' }));
      expect(again.res.status).toBe(409);
      expect(again.res.body).toMatchObject({ code: 'invalid_transition', from: 'open', action: 'publish' });
      expectRefused(again, 'publish twice');
      for (const [action, status] of [
        ['close', 'closed'],
        ['reopen', 'open'],
      ] as const) {
        const moved = await observe(() => act('essay', { action, reason: REASON_MARK }));
        expect(moved.res.status, action).toBe(200);
        expect(moved.res.body, action).toMatchObject({ status });
        expect(moved.events.map((event) => [event.action, (event.metadata as { action?: string } | null)?.action])).toEqual([['assignments.status.changed', action]]);
        expectSilent(moved, action);
      }
    },
    60_000,
  );

  it(
    'assignment.published — an assignment without a lesson is worded in the academy’s zone, one without a due date says so, a title without an English form stays Arabic',
    async () => {
      const late = await createDraft({ title: LATE, maxScore: 12.5, dueAt: PAST_DUE, allowLate: true, latePenaltyPercent: 50 }).expect(201);
      assignments['late'] = late.body.id as string;
      const published = await observe(() => act('late', { action: 'publish' }));
      expect(published.res.status, JSON.stringify(published.res.body)).toBe(200);
      expect(published.res.body).toMatchObject({ status: 'open', dueAt: PAST_DUE, timeZone: academyTimeZone });
      expect(recipientsOf(published.rows)).toEqual(['guardian', 'student1', 'student2']);
      const params = { assignmentId: assignments['late']!, classId: classes['A']!, title: LATE, className: CLASS_NAME, dueAt: new Date(PAST_DUE), timeZone: academyTimeZone };
      const toStudent1 = rowFor(published.rows, 'student1');
      expect(toStudent1).toMatchObject(worded('assignment.published', params, 'en'));
      expect(toStudent1.title).toBe('New assignment: واجب متأخر');
      expect(toStudent1.body).toContain(clock(new Date(PAST_DUE), academyTimeZone));
      expect(rowFor(published.rows, 'student2')).toMatchObject(worded('assignment.published', params, 'ar'));

      const undated = await createDraft({ title: UNDATED, maxScore: 10 }).expect(201);
      assignments['undated'] = undated.body.id as string;
      const open = await observe(() => act('undated', { action: 'publish' }));
      expect(open.res.status, JSON.stringify(open.res.body)).toBe(200);
      expect(open.res.body).toMatchObject({ status: 'open', dueAt: null });
      expect(recipientsOf(open.rows)).toEqual(['guardian', 'student1', 'student2']);
      const noDue = { assignmentId: assignments['undated']!, classId: classes['A']!, title: UNDATED, className: CLASS_NAME, dueAt: null, timeZone: academyTimeZone };
      expect(rowFor(open.rows, 'student1')).toMatchObject(worded('assignment.published', noDue, 'en'));
      expect(rowFor(open.rows, 'student1').title).toBe('New assignment: Open task');
      expect(rowFor(open.rows, 'student1').body).toContain('no due date');
      expect(rowFor(open.rows, 'student2')).toMatchObject(worded('assignment.published', noDue, 'ar'));
      expect(rowFor(open.rows, 'guardian').data).toEqual({ link: LINK, assignmentId: assignments['undated'], classId: classes['A'], studentIds: children().map(id) });
      expectNoLeak([...published.rows, ...open.rows]);
    },
    60_000,
  );

  it(
    'submission.graded / submission.returned — a written review tells the attempt’s student and their guardian; an attempt handed in, a refused review and an identical review tell nobody',
    async () => {
      // A student hands work in: the teachers find it in the roster, nobody is notified.
      const handedIn = await observe(() => submit('essay', { textAnswer: ANSWER_MARK }, 'student1'));
      expect(handedIn.res.status, JSON.stringify(handedIn.res.body)).toBe(201);
      submissions['essay1'] = handedIn.res.body.id as string;
      expect(handedIn.events.map((event) => [event.action, event.actorUserId])).toEqual([['assignments.submitted', id('student1')]]);
      expectSilent(handedIn, 'an attempt handed in');

      const refusals: Array<[label: string, send: () => PromiseLike<{ status: number; body: unknown }>, status: number, errorCode: string | null]> = [
        ['a teacher of another class', () => review('essay1', { action: 'grade', score: 10, feedback: FEEDBACK_MARK }, 'foreign'), 404, 'submission_not_found'],
        ['a score above the maximum', () => review('essay1', { action: 'grade', score: 25 }), 400, 'score_out_of_range'],
        ['a return without feedback', () => review('essay1', { action: 'return' }), 400, 'feedback_required'],
        ['a review the reviewer never saw', () => review('essay1', { action: 'grade', score: 10, expectedGradedAt: '2020-01-01T00:00:00.000Z' }), 409, 'review_conflict'],
        ['a grade without a score', () => review('essay1', { action: 'grade' }), 400, null],
        ['a student, who holds no assignments.grade', () => review('essay1', { action: 'grade', score: 10 }, 'student2'), 403, 'permission_denied'],
      ];
      for (const [label, send, status, errorCode] of refusals) {
        const refused = await observe(send);
        expect(refused.res.status, label).toBe(status);
        if (errorCode) expect(refused.res.body, label).toMatchObject({ code: errorCode });
        expectRefused(refused, label);
      }

      // Graded: the student (who reads English) and the guardian (Arabic) — one row each, about that student.
      const feedback = `${FEEDBACK_MARK} well argued`;
      const graded = await observe(() => review('essay1', { action: 'grade', score: 17.5, feedback }));
      expect(graded.res.status, JSON.stringify(graded.res.body)).toBe(200);
      expect(Object.keys(graded.res.body).sort()).toEqual([...SUBMISSION_KEYS].sort());
      // The route still names the reviewer and returns the feedback to those who may read the submission…
      expect(graded.res.body).toMatchObject({
        id: submissions['essay1'],
        status: 'graded',
        score: 17.5,
        feedback,
        gradedBy: { fullName: `Teacher ${GRADER_MARK}`, displayName: `Ustadh ${GRADER_MARK}` },
      });
      expect(graded.events.map((event) => [event.action, event.entityType, event.entityId, event.actorUserId])).toEqual([
        ['assignments.graded', 'assignment_submissions', submissions['essay1'], id('teacher')],
      ]);
      expect(graded.events[0]!.metadata).toEqual({ assignmentId: assignments['essay'], classId: classes['A'], code: code('A'), studentId: id('student1'), attemptNo: 1, from: 'submitted', score: 17.5 });
      // …while the notifications carry the score out of the maximum, and neither of the two.
      expect(recipientsOf(graded.rows)).toEqual(['guardian', 'student1']);
      expect(graded.batches).toEqual([{ created: 2, queuedIds: [] }]);
      const about = { link: LINK, submissionId: submissions['essay1'], assignmentId: assignments['essay'], classId: classes['A'] };
      const ids = { submissionId: submissions['essay1']!, assignmentId: assignments['essay']!, classId: classes['A']!, title: ESSAY };
      for (const row of graded.rows) {
        expect(row).toMatchObject({ eventKey: 'submission.graded', category: 'assignments', studentUserId: id('student1'), readAt: null, announcementId: null, emailStatus: 'skipped', emailSentAt: null });
        expect(row.data).toEqual(about);
      }
      const gradedParams = { ...ids, score: '17.5', maxScore: '20' };
      expect(rowFor(graded.rows, 'student1')).toMatchObject(worded('submission.graded', gradedParams, 'en'));
      expect(rowFor(graded.rows, 'student1').title).toBe('Assignment graded: Essay');
      expect(rowFor(graded.rows, 'student1').body).toContain('17.5 out of 20');
      expect(rowFor(graded.rows, 'guardian')).toMatchObject(worded('submission.graded', gradedParams, 'ar', [CHILD_NAMES['student1']!]));
      expect(rowFor(graded.rows, 'guardian').body).toContain('17.5 من 20');
      expect(rowFor(graded.rows, 'guardian').body).toContain(CHILD_NAMES['student1']);
      expectNoLeak(graded.rows);

      // The same review again writes nothing: no event, no notification.
      const same = await observe(() => review('essay1', { action: 'grade', score: 17.5, feedback }));
      expect(same.res.status).toBe(200);
      expect(same.res.body).toMatchObject({ status: 'graded', score: 17.5, feedback, gradedAt: graded.res.body.gradedAt });
      expect(same.events).toEqual([]);
      expectSilent(same, 'an identical grade');

      // A reviewer who has not seen that grade is refused — nothing.
      const stale = await observe(() => review('essay1', { action: 'grade', score: 12, expectedGradedAt: null }));
      expect(stale.res.status).toBe(409);
      expect(stale.res.body).toMatchObject({ code: 'review_conflict', submissionId: submissions['essay1'], status: 'graded', gradedAt: graded.res.body.gradedAt });
      expectRefused(stale, 'a stale reviewer');

      // A corrected grade is a new write: one more notification each, with the new score.
      const corrected = await observe(() => review('essay1', { action: 'grade', score: 18, feedback, expectedGradedAt: graded.res.body.gradedAt as string }));
      expect(corrected.res.status, JSON.stringify(corrected.res.body)).toBe(200);
      expect(corrected.res.body).toMatchObject({ status: 'graded', score: 18 });
      expect(corrected.events.map((event) => event.action)).toEqual(['assignments.graded']);
      expect(recipientsOf(corrected.rows)).toEqual(['guardian', 'student1']);
      expect(corrected.batches).toEqual([{ created: 2, queuedIds: [] }]);
      const correctedParams = { ...ids, score: '18', maxScore: '20' };
      expect(rowFor(corrected.rows, 'student1')).toMatchObject({ ...worded('submission.graded', correctedParams, 'en'), eventKey: 'submission.graded', studentUserId: id('student1') });
      expect(rowFor(corrected.rows, 'student1').body).toContain('18 out of 20');
      expect(rowFor(corrected.rows, 'guardian')).toMatchObject({ ...worded('submission.graded', correctedParams, 'ar', [CHILD_NAMES['student1']!]), studentUserId: id('student1') });
      expectNoLeak(corrected.rows);

      // Returned for rework: `submission.returned` — the feedback itself stays in «my assignments».
      const rework = `${FEEDBACK_MARK} rewrite the ending`;
      const returned = await observe(() => review('essay1', { action: 'return', feedback: rework }));
      expect(returned.res.status, JSON.stringify(returned.res.body)).toBe(200);
      expect(returned.res.body).toMatchObject({ status: 'returned', score: null, feedback: rework, attempts: 1, attemptsAllowed: 3 });
      expect(returned.events.map((event) => [event.action, event.entityId, event.actorUserId])).toEqual([['assignments.returned', submissions['essay1'], id('teacher')]]);
      expect(returned.events[0]!.metadata).toEqual({ assignmentId: assignments['essay'], classId: classes['A'], code: code('A'), studentId: id('student1'), attemptNo: 1, from: 'graded' });
      expect(recipientsOf(returned.rows)).toEqual(['guardian', 'student1']);
      expect(returned.batches).toEqual([{ created: 2, queuedIds: [] }]);
      for (const row of returned.rows) {
        expect(row).toMatchObject({ eventKey: 'submission.returned', category: 'assignments', studentUserId: id('student1'), readAt: null, announcementId: null, emailStatus: 'skipped' });
        expect(row.data).toEqual(about);
      }
      expect(rowFor(returned.rows, 'student1')).toMatchObject(worded('submission.returned', ids, 'en'));
      expect(rowFor(returned.rows, 'student1').title).toBe('Assignment returned for rework: Essay');
      expect(rowFor(returned.rows, 'guardian')).toMatchObject(worded('submission.returned', ids, 'ar', [CHILD_NAMES['student1']!]));
      expectNoLeak(returned.rows);

      const sameReturn = await observe(() => review('essay1', { action: 'return', feedback: rework }));
      expect(sameReturn.res.status).toBe(200);
      expect(sameReturn.events).toEqual([]);
      expectSilent(sameReturn, 'an identical return');
    },
    60_000,
  );

  it(
    'submission.graded — the score is the one stored on the attempt, without the late penalty; a guardian of two holds one row per child; an unconfirmed address is told in the app only',
    async () => {
      // Past the due date with `allowLate` and a 50 % penalty: the attempt is late.
      const handedIn = await observe(() => submit('late', { linkUrl: 'https://docs.example.com/late-answer' }, 'student2'));
      expect(handedIn.res.status, JSON.stringify(handedIn.res.body)).toBe(201);
      expect(handedIn.res.body).toMatchObject({ isLate: true, attemptNo: 1 });
      submissions['late2'] = handedIn.res.body.id as string;
      expectSilent(handedIn, 'a late attempt handed in');

      const graded = await observe(() => review('late2', { action: 'grade', score: 7.25 }));
      expect(graded.res.status, JSON.stringify(graded.res.body)).toBe(200);
      expect(graded.res.body).toMatchObject({ status: 'graded', score: 7.25, isLate: true, feedback: null });
      expect(graded.events.map((event) => event.action)).toEqual(['assignments.graded']);
      expect(recipientsOf(graded.rows)).toEqual(['guardian', 'student2']);
      expect(graded.batches).toEqual([{ created: 2, queuedIds: [] }]);
      // 7.25 of 12.5 as the teacher typed it — the gradebook alone halves it (3.63).
      const params = { submissionId: submissions['late2']!, assignmentId: assignments['late']!, classId: classes['A']!, title: LATE, score: '7.25', maxScore: '12.5' };
      const toStudent2 = rowFor(graded.rows, 'student2');
      expect(toStudent2).toMatchObject({ ...worded('submission.graded', params, 'ar'), eventKey: 'submission.graded', studentUserId: id('student2'), emailStatus: 'none', readAt: null });
      expect(toStudent2.body).toContain('7.25 من 12.5');
      expect(toStudent2.body).not.toContain('3.6');
      // A student event is about one student: this row of the guardian is about student2 alone, beside those about student1.
      const toGuardian = rowFor(graded.rows, 'guardian');
      expect(toGuardian).toMatchObject({ ...worded('submission.graded', params, 'ar', [CHILD_NAMES['student2']!]), studentUserId: id('student2'), emailStatus: 'skipped' });
      expect(toGuardian.body).not.toContain(CHILD_NAMES['student1']);
      for (const row of graded.rows) expect(row.data).toEqual({ link: LINK, submissionId: submissions['late2'], assignmentId: assignments['late'], classId: classes['A'] });
      expectNoLeak(graded.rows);
    },
    60_000,
  );

  it(
    'nobody else was told anything, nothing was e-mailed and no notification reached the audit log (D-R86)',
    async () => {
      const all = await since(NIL_ID);
      const perRecipient = Object.fromEntries(Object.keys(fx).map((name) => [name, all.filter((row) => row.recipientUserId === id(name)).length]));
      // Three published assignments each; two grades and a return of student1's attempt; one grade of student2's.
      expect(perRecipient).toEqual({ teacher: 0, foreign: 0, student1: 6, student2: 4, withdrawn: 0, outsider: 0, guardian: 7, linked: 0 });
      const perEvent = (key: string) => all.filter((row) => row.eventKey === key).length;
      expect([perEvent('assignment.published'), perEvent('submission.graded'), perEvent('submission.returned')]).toEqual([9, 6, 2]);
      for (const row of all) {
        expect(row).toMatchObject({ category: 'assignments', readAt: null, announcementId: null, emailSentAt: null, emailMessageId: null, emailFailure: null });
        // MAIL_TRANSPORT=none: `skipped` for a confirmed address, `none` for student2's unconfirmed one.
        expect(row.emailStatus, nameOf(row.recipientUserId)).toBe(row.recipientUserId === id('student2') ? 'none' : 'skipped');
      }
      expectNoLeak(all);

      // The fixture actors recorded their sign-ins and the assignment events they always recorded — nothing new.
      const recorded = await prisma.auditLog.findMany({ where: { actorUserId: { in: actors } }, select: { action: true } });
      expect([...new Set(recorded.map((event) => event.action))].filter((action) => !action.startsWith('auth.')).sort()).toEqual([
        'assignments.created',
        'assignments.deleted',
        'assignments.graded',
        'assignments.returned',
        'assignments.status.changed',
        'assignments.submitted',
        'assignments.updated',
      ]);
      expect(await prisma.auditLog.count({ where: { entityId: { in: all.map((row) => row.id) } } })).toBe(0);
    },
    60_000,
  );
});
