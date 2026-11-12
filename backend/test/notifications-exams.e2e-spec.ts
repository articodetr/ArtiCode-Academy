// TEST-176 — MOD-12-T03 (exams): the two notification events of MOD-09 through
// the real routes, against the live development database (skipped when no
// database is reachable). `POST /api/exams/:id/status` writes, inside its own
// transaction,
//   * with `schedule`: `exam.scheduled` — a class event, one notification per
//     recipient (the students with an active enrollment and their guardians,
//     a guardian's copy naming their children in the class);
//   * with `publish`: `exam.results_published` — a student event, one
//     notification per (recipient × student holding a result), each with that
//     student's own result and never the feedback or the recorder.
// Nothing else notifies: not creating, editing or deleting an exam, not
// `unschedule` / `unpublish`, not recording results, and no refused request.
// Besides the rows, the suite watches the hand-over to the dispatcher (a spy
// on `NotificationsService.dispatch()`: once per effective write, after the
// commit, never on a refusal) and scripts one failure after the engine wrote
// its rows, to show that the status change, its audit event and its
// notifications are one transaction.
//
// Fixtures carry a unique prefix and are deleted at the end (deleting the
// users removes their notifications). Class A, taught by `teacher`:
//
//   s1     en, confirmed address    active      scored (with feedback)   guardian, norole
//   s2     ar, unconfirmed address  active      absent (with feedback)   guardian
//   s3     en                       completed   excused                  guardian2
//   s4     ar                       active      no result at first       guardian2
//   gone   en                       withdrawn   —                        —
//
// `guardian` (en) and `guardian2` (ar, unconfirmed address) hold the
// `guardian` role; `norole` is linked to s1 without it; `foreign` is a teacher
// of no class here. Exam A1 is held in a lesson whose room belongs to a branch
// in another time zone than the academy's. The mail transport is `none`
// (vitest.config.e2e.ts): nothing is e-mailed, a due e-mail is `skipped`.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { PasswordService } from '../src/auth/password.service.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { EnrollmentStatus, Prisma } from '../src/generated/prisma/client.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import type { NotificationBatch } from '../src/notifications/notifications.service.js';
import { formatWhen } from '../src/notifications/notifications.templates.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `NX${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-176 supertest';
const CLASSES = '/api/classes';
const EXAMS = '/api/exams';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const TEST_TIMEOUT = 30_000;
const EXAM_KEYS = [
  'activeStudents',
  'class',
  'createdAt',
  'description',
  'durationMinutes',
  'id',
  'lesson',
  'maxScore',
  'passScore',
  'publishedAt',
  'results',
  'scheduledAt',
  'status',
  'timeZone',
  'title',
  'type',
  'updatedAt',
  'weight',
];

// What must never reach a notification: the reason of the action, the teacher's
// feedback, the exam's description and the name of whoever acted or recorded.
const REASON_MARK = `REASONMARK-${RUN}`;
const FEEDBACK_MARK = `FEEDBACKMARK-${RUN}`;
const DESCRIPTION_MARK = `DESCRIPTIONMARK-${RUN}`;
const TEACHER_MARK = `TEACHERMARK-${RUN}`;
const TEACHER_NICK_MARK = `NICKMARK-${RUN}`;
const MARKS = [REASON_MARK, FEEDBACK_MARK, DESCRIPTION_MARK, TEACHER_MARK, TEACHER_NICK_MARK];

const MIDTERM = { ar: 'منتصف الدورة', en: 'Midterm' };
const QUIZ = { ar: 'اختبار قصير', en: 'Quiz' };
const CLASS_NAME = { ar: 'فصل الإشعارات', en: 'Notifications class' };
/** When exam A1 takes place — a Friday, 08:30 UTC. */
const AT = '2030-03-01T08:30:00.000Z';
/** Its wall clock in the two zones the branch may get (neither has changed its clocks by 1 March). */
const BRANCH_ZONES = [
  { name: 'Asia/Tokyo', clock: '17:30' },
  { name: 'America/New_York', clock: '03:30' },
];
const LINK = '/my-exams';

type Row = Prisma.NotificationGetPayload<object>;
type AuditRow = Prisma.AuditLogGetPayload<object>;
type Reply = request.Response;

/**
 * One hand-over to the dispatcher (`NotificationsService.dispatch()`): how many
 * notifications the batch says were written, how many of their e-mails wait,
 * and how many of the request's notifications another connection could read
 * at that very moment — the whole batch, when the transaction had committed.
 */
interface HandOver {
  created: number;
  queued: number;
  committed: number;
}

interface Observed {
  res: Reply;
  /** The fixture users' notifications written by the request. */
  rows: Row[];
  /** The fixture actors' audit events recorded by the request. */
  events: AuditRow[];
  /** What the request handed to the dispatcher. */
  handed: HandOver[];
}

interface UserOptions {
  roles?: string[];
  locale?: 'ar' | 'en';
  verified?: boolean;
  signsIn?: boolean;
  fullName?: string;
  displayName?: string;
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

describe.skipIf(!available)('MOD-12 notifications of the exams module (e2e, TEST-176)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let engine: NotificationsService;
  let academyTimeZone: string;
  let zone: { name: string; clock: string };
  let lessonId: string;
  /** Filled by the spy on `dispatch()` while a request is observed. */
  let handOvers: Array<{ batch: NotificationBatch; committed: Promise<number> }> = [];
  let observedSince = NIL_ID;
  const createdUserIds: string[] = [];
  const actors: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const classes: Record<string, string> = {};
  const exams: Record<string, string> = {};

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name.toLowerCase()}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  const exam = (name: string) => exams[name]!;
  /** The name a guardian's copy mentions a child by. */
  const shown = (name: string) => (name === 's1' ? 'Sami' : `Fixture ${name}`);
  /** Fixture names in the order of their user ids — the order a guardian's copy lists children in. */
  const inIdOrder = (...names: string[]) => [...names].sort((a, b) => (id(a) < id(b) ? -1 : 1));

  const createExam = (classKey: string, body: object, as = 'teacher') => api().post(`${CLASSES}/${classes[classKey]}/exams`).set(bearer(as)).send(body);
  const act = (examId: string, action: string, as = 'teacher', reason?: string) => api().post(`${EXAMS}/${examId}/status`).set(bearer(as)).send({ action, ...(reason ? { reason } : {}) });
  const record = (examId: string, results: object[], as = 'teacher') => api().put(`${EXAMS}/${examId}/results`).set(bearer(as)).send({ results });

  const byRecipient = (rows: Row[]) => Object.fromEntries(Object.entries(fx).map(([name, userId]) => [name, rows.filter((row) => row.recipientUserId === userId)])) as Record<string, Row[]>;
  const recipientsOf = (rows: Row[]) =>
    Object.entries(byRecipient(rows))
      .filter(([, mine]) => mine.length > 0)
      .map(([name]) => name)
      .sort();
  /** Every notification of one kind that points at this exam, whoever received it — fixture user or not. */
  const aboutExam = (examId: string, eventKey: string) => prisma.notification.count({ where: { eventKey, data: { path: ['examId'], equals: examId } } });

  function expectNoLeak(rows: Row[]): void {
    for (const row of rows) {
      const text = `${row.title}\n${row.body}\n${JSON.stringify(row.data)}`;
      for (const mark of MARKS) expect(text, `${row.eventKey} to ${row.recipientUserId}`).not.toContain(mark);
    }
  }

  /** The newest ids: what is written after them belongs to the request under test (other suites share this database). */
  async function newestNotificationId(): Promise<string> {
    return (await prisma.notification.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;
  }
  async function newestAuditId(): Promise<string> {
    return (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;
  }

  const fixtureNotificationsSince = (mark: string): Prisma.NotificationWhereInput => ({ id: { gt: mark }, recipientUserId: { in: createdUserIds } });

  /** Sends one request and returns what it left behind. */
  async function observe(send: () => PromiseLike<Reply>): Promise<Observed> {
    const notificationMark = await newestNotificationId();
    const auditMark = await newestAuditId();
    handOvers = [];
    observedSince = notificationMark;
    const res = await send();
    const handed: HandOver[] = [];
    for (const { batch, committed } of handOvers) handed.push({ created: batch.created, queued: batch.queuedIds.length, committed: await committed });
    return {
      res,
      rows: await prisma.notification.findMany({ where: fixtureNotificationsSince(notificationMark), orderBy: { id: 'asc' } }),
      events: await prisma.auditLog.findMany({ where: { id: { gt: auditMark }, actorUserId: { in: actors } }, orderBy: { id: 'asc' } }),
      handed,
    };
  }

  async function createUser(name: string, options: UserOptions = {}): Promise<void> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: options.fullName ?? `Fixture ${name}`,
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

  async function createClass(key: string, name: object, students: Array<[string, EnrollmentStatus]>): Promise<void> {
    const courseId = (await prisma.course.findFirstOrThrow({ where: { code: code('CRS') }, select: { id: true } })).id;
    classes[key] = (await prisma.class.create({ data: { courseId, code: code(key), name, capacity: 20, status: 'running' }, select: { id: true } })).id;
    await prisma.classTeacher.create({ data: { classId: classes[key]!, teacherUserId: id('teacher'), role: 'lead' }, select: { classId: true } });
    for (const [student, status] of students) {
      await prisma.enrollment.create({ data: { classId: classes[key]!, studentUserId: id(student), status, activatedAt: new Date() }, select: { id: true } });
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    // Every hand-over to the dispatcher is noted, with what this suite's own connection can read at that moment
    // (`.then()` sends the query at once): a notification still inside an open transaction would not be counted.
    engine = app.get(NotificationsService);
    const dispatch = engine.dispatch.bind(engine);
    vi.spyOn(engine, 'dispatch').mockImplementation((batch) => {
      handOvers.push({ batch, committed: prisma.notification.count({ where: fixtureNotificationsSince(observedSince) }).then((count) => count) });
      dispatch(batch);
    });
    academyTimeZone = (await prisma.academy.findFirstOrThrow({ select: { timezone: true } })).timezone;
    // A branch zone whose wording of the exam's time differs from the academy's.
    const at = new Date(AT);
    zone = BRANCH_ZONES.find((entry) => formatWhen(at, entry.name, 'en') !== formatWhen(at, academyTimeZone, 'en'))!;

    const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
    const teacherRole = await systemRole('teacher');
    const studentRole = await systemRole('student');
    const guardianRole = await systemRole('guardian');
    await createUser('teacher', { roles: [teacherRole], signsIn: true, fullName: TEACHER_MARK, displayName: TEACHER_NICK_MARK });
    await createUser('foreign', { roles: [teacherRole], signsIn: true });
    await createUser('s1', { roles: [studentRole], locale: 'en', signsIn: true, displayName: 'Sami' });
    await createUser('s2', { roles: [studentRole], locale: 'ar', verified: false });
    await createUser('s3', { roles: [studentRole], locale: 'en' });
    await createUser('s4', { roles: [studentRole], locale: 'ar' });
    await createUser('gone', { roles: [studentRole], locale: 'en' });
    await createUser('guardian', { roles: [guardianRole], locale: 'en' });
    await createUser('guardian2', { roles: [guardianRole], locale: 'ar', verified: false });
    await createUser('norole', { locale: 'en' });
    for (const [guardian, student] of [
      ['guardian', 's1'],
      ['guardian', 's2'],
      ['guardian2', 's3'],
      ['guardian2', 's4'],
      // Linked, but without the `guardian` role: receives nothing.
      ['norole', 's1'],
    ] as const) {
      await prisma.guardianStudent.create({ data: { guardianUserId: id(guardian), studentUserId: id(student), relationship: 'mother' }, select: { studentUserId: true } });
    }

    await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة إشعارات الاختبارات' }, status: 'published' }, select: { id: true } });
    await createClass('A', CLASS_NAME, [
      ['s1', 'active'],
      ['s2', 'active'],
      ['s3', 'completed'],
      ['s4', 'active'],
      ['gone', 'withdrawn'],
    ]);
    // The class of the refusals; it is cancelled in its test.
    await createClass('C', { ar: 'فصل يُلغى', en: 'Class to cancel' }, [['s1', 'active']]);
    const branchId = (await prisma.branch.create({ data: { code: PREFIX, name: { ar: 'فرع الإشعارات' }, timezone: zone.name }, select: { id: true } })).id;
    const roomId = (await prisma.room.create({ data: { branchId, code: `${PREFIX}R`, name: { ar: 'قاعة الاختبار' } }, select: { id: true } })).id;
    lessonId = (
      await prisma.lesson.create({
        data: { classId: classes['A']!, roomId, title: { ar: 'درس الاختبار' }, startsAt: new Date('2030-03-01T08:00:00Z'), endsAt: new Date('2030-03-01T10:00:00Z') },
        select: { id: true },
      })
    ).id;
  }, 120_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    try {
      if (prisma) {
        await prisma.enrollment.deleteMany({ where: { classId: { in: Object.values(classes) } } });
        // The classes take their teachers, lessons, exams and results with them.
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.room.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.branch.deleteMany({ where: { code: { startsWith: PREFIX } } });
      }
    } finally {
      // Deleting the recipients removes their notifications and guardian links with them.
      if (prisma && createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it(
    'creating, editing and deleting an exam notify nobody',
    async () => {
      const created = await observe(() =>
        createExam('A', { title: MIDTERM, description: { ar: DESCRIPTION_MARK }, type: 'midterm', lessonId, scheduledAt: '2030-03-01T11:30:00+03:00', durationMinutes: 60, maxScore: 40, passScore: 20, weight: 30 }),
      );
      expect(created.res.status, JSON.stringify(created.res.body)).toBe(201);
      // D-R41: the zone of the lesson's room branch, not the academy's.
      expect(created.res.body).toMatchObject({ status: 'draft', scheduledAt: AT, timeZone: zone.name, activeStudents: 3 });
      expect(zone.name).not.toBe(academyTimeZone);
      exams['A1'] = created.res.body.id as string;
      expect(created.rows).toEqual([]);
      expect(created.handed).toEqual([]);
      expect(created.events.map((event) => event.action)).toEqual(['exams.created']);

      exams['A2'] = (await createExam('A', { title: QUIZ, type: 'quiz', maxScore: 10 }).expect(201)).body.id as string;
      const draft = (await createExam('A', { title: { ar: 'مسودة' }, type: 'practice', maxScore: 5 }).expect(201)).body.id as string;
      const edited = await observe(() => api().patch(`${EXAMS}/${draft}`).set(bearer('teacher')).send({ title: { ar: 'مسودة معدّلة' }, scheduledAt: '2030-04-01T09:00:00Z' }));
      expect(edited.res.status, JSON.stringify(edited.res.body)).toBe(200);
      expect(edited.rows).toEqual([]);
      expect(edited.handed).toEqual([]);
      expect(edited.events.map((event) => event.action)).toEqual(['exams.updated']);
      const removed = await observe(() => api().delete(`${EXAMS}/${draft}`).set(bearer('teacher')));
      expect(removed.res.status).toBe(204);
      expect(removed.rows).toEqual([]);
      expect(removed.handed).toEqual([]);
      expect(removed.events.map((event) => event.action)).toEqual(['exams.deleted']);
    },
    TEST_TIMEOUT,
  );

  it(
    'schedule → `exam.scheduled`: one notification per recipient — the active students and their guardians, a guardian of two children ONE naming both — with the time in the exam’s zone',
    async () => {
      const { res, rows, events, handed } = await observe(() => act(exam('A1'), 'schedule', 'teacher', REASON_MARK));
      // The route answers and records what it always did.
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(EXAM_KEYS);
      expect(res.body).toMatchObject({ id: exam('A1'), status: 'scheduled', publishedAt: null, scheduledAt: AT, timeZone: zone.name, results: { students: 0, scored: 0, absent: 0, excused: 0 }, activeStudents: 3 });
      expect(events.map((event) => [event.action, event.entityType, event.entityId, event.actorUserId, event.metadata])).toEqual([
        ['exams.status.changed', 'exams', exam('A1'), id('teacher'), { classId: classes['A'], code: code('A'), action: 'schedule', from: 'draft', to: 'scheduled', reason: REASON_MARK }],
      ]);

      // Not s3 (enrollment completed), not the withdrawn student, not the linked user without the role, no teacher.
      expect(recipientsOf(rows)).toEqual(['guardian', 'guardian2', 's1', 's2', 's4']);
      expect(rows).toHaveLength(5);
      expect(await aboutExam(exam('A1'), 'exam.scheduled')).toBe(5);
      // One hand-over to the dispatcher, after the commit: all five were readable; no e-mail waits without a transport.
      expect(handed).toEqual([{ created: 5, queued: 0, committed: 5 }]);
      for (const row of rows) expect(row).toMatchObject({ eventKey: 'exam.scheduled', category: 'exams', readAt: null, announcementId: null });
      const mine = byRecipient(rows);
      const data = { link: LINK, examId: exam('A1'), classId: classes['A'] };

      // The wall clock of the exam's own zone — the room's branch — and not the academy's.
      const at = new Date(AT);
      const en = `The exam “Midterm” of class “Notifications class” is scheduled for ${formatWhen(at, zone.name, 'en')}.`;
      const ar = `اختبار «منتصف الدورة» في فصل «فصل الإشعارات» موعده ${formatWhen(at, zone.name, 'ar')}.`;
      expect(en).toContain(zone.clock);
      expect(ar).toContain(zone.clock);
      expect(en).not.toContain(formatWhen(at, academyTimeZone, 'en'));

      // Each student once, in their own language; a confirmed address would be mailed (no transport here), an unconfirmed one never.
      expect(mine['s1']![0]).toMatchObject({ studentUserId: id('s1'), title: 'Exam scheduled: Midterm', body: en, emailStatus: 'skipped' });
      expect(mine['s2']![0]).toMatchObject({ studentUserId: id('s2'), title: 'اختبار مجدول: منتصف الدورة', body: ar, emailStatus: 'none' });
      expect(mine['s4']![0]).toMatchObject({ studentUserId: id('s4'), title: 'اختبار مجدول: منتصف الدورة', body: ar, emailStatus: 'skipped' });
      for (const name of ['s1', 's2', 's4']) expect(mine[name]![0]!.data, name).toEqual(data);

      // Two children in the class: ONE notification, no single student on the row, both named in the order of their ids.
      const children = inIdOrder('s1', 's2');
      expect(mine['guardian']).toHaveLength(1);
      expect(mine['guardian']![0]).toMatchObject({ studentUserId: null, title: 'Exam scheduled: Midterm', body: `${en} Students: ${children.map(shown).join(', ')}.`, emailStatus: 'skipped' });
      expect(mine['guardian']![0]!.data).toEqual({ ...data, studentIds: children.map(id) });
      // One child with an active enrollment (s3's is completed): the row points at that child.
      expect(mine['guardian2']).toHaveLength(1);
      expect(mine['guardian2']![0]).toMatchObject({ studentUserId: id('s4'), title: 'اختبار مجدول: منتصف الدورة', body: `${ar} الطالب: ${shown('s4')}.`, emailStatus: 'none' });
      expect(mine['guardian2']![0]!.data).toEqual(data);
      expectNoLeak(rows);
    },
    TEST_TIMEOUT,
  );

  it(
    'an undated exam is announced without a time; `unschedule` and a later edit tell nobody; scheduling it again is a new write',
    async () => {
      const first = await observe(() => act(exam('A2'), 'schedule'));
      expect(first.res.body).toMatchObject({ status: 'scheduled', scheduledAt: null, timeZone: academyTimeZone });
      expect(recipientsOf(first.rows)).toEqual(['guardian', 'guardian2', 's1', 's2', 's4']);
      expect(first.rows).toHaveLength(5);
      const mine = byRecipient(first.rows);
      expect(mine['s1']![0]).toMatchObject({ title: 'Exam scheduled: Quiz', body: 'The exam “Quiz” of class “Notifications class” was scheduled; its time will follow.' });
      expect(mine['s2']![0]).toMatchObject({ title: 'اختبار مجدول: اختبار قصير', body: 'اختبار «اختبار قصير» في فصل «فصل الإشعارات» جُدول وسيُعلن موعده لاحقاً.' });
      expect(mine['s1']![0]!.data).toEqual({ link: LINK, examId: exam('A2'), classId: classes['A'] });

      // Editing a scheduled exam — even giving it its date — is not one of the events.
      const dated = await observe(() => api().patch(`${EXAMS}/${exam('A2')}`).set(bearer('teacher')).send({ scheduledAt: '2030-05-02T09:00:00Z' }));
      expect(dated.res.body).toMatchObject({ status: 'scheduled', scheduledAt: '2030-05-02T09:00:00.000Z' });
      expect(dated.rows).toEqual([]);
      const back = await observe(() => act(exam('A2'), 'unschedule', 'teacher', REASON_MARK));
      expect(back.res.body).toMatchObject({ status: 'draft' });
      expect(back.rows).toEqual([]);
      expect(back.events.map((event) => [event.action, (event.metadata as { action: string }).action])).toEqual([['exams.status.changed', 'unschedule']]);

      // draft → scheduled once more: an effective write, so the class is told again — now with the date, in the academy's zone.
      const again = await observe(() => act(exam('A2'), 'schedule'));
      expect(again.rows).toHaveLength(5);
      expect(byRecipient(again.rows)['s1']![0]!.body).toBe(`The exam “Quiz” of class “Notifications class” is scheduled for ${formatWhen(new Date('2030-05-02T09:00:00Z'), academyTimeZone, 'en')}.`);
      expect(await aboutExam(exam('A2'), 'exam.scheduled')).toBe(10);
      expectNoLeak([...first.rows, ...again.rows]);
    },
    TEST_TIMEOUT,
  );

  it(
    'recording results notifies nobody — the results stay hidden until they are published',
    async () => {
      const batch = [
        { studentId: id('s1'), status: 'scored', score: 17.25, feedback: FEEDBACK_MARK },
        { studentId: id('s2'), status: 'absent', feedback: FEEDBACK_MARK },
        { studentId: id('s3'), status: 'excused' },
      ];
      const recorded = await observe(() => record(exam('A1'), batch));
      expect(recorded.res.status, JSON.stringify(recorded.res.body)).toBe(200);
      expect(recorded.res.body.counts).toEqual({ students: 3, scored: 1, absent: 1, excused: 1 });
      expect(recorded.rows).toEqual([]);
      expect(recorded.events.map((event) => event.action)).toEqual(['exams.results.recorded']);
      // The same batch again writes nothing at all.
      const repeated = await observe(() => record(exam('A1'), batch));
      expect(repeated.res.status).toBe(200);
      expect(repeated.rows).toEqual([]);
      expect(repeated.events).toEqual([]);
    },
    TEST_TIMEOUT,
  );

  it(
    'a refused request writes no notification: 400, 403, 404, 409 and 422 — a teacher of another class, an invalid transition, an exam holding results, a cancelled class',
    async () => {
      exams['A4'] = (await createExam('A', { title: { ar: 'مسودة باقية' }, type: 'oral', maxScore: 10 }).expect(201)).body.id as string;
      exams['C1'] = (await createExam('C', { title: { ar: 'مسودة الفصل الملغى' }, type: 'quiz', maxScore: 10 }).expect(201)).body.id as string;
      exams['C2'] = (await createExam('C', { title: { ar: 'مجدول الفصل الملغى' }, type: 'quiz', maxScore: 10 }).expect(201)).body.id as string;
      await act(exam('C2'), 'schedule').expect(200);
      await record(exam('C2'), [{ studentId: id('s1'), status: 'scored', score: 7 }]).expect(200);
      // Cancelled straight in the table, so s1's enrollment stays active: a notification written before the refusal would show.
      await prisma.class.update({ where: { id: classes['C']! }, data: { status: 'cancelled' }, select: { id: true } });

      const refusals: Array<[string, () => PromiseLike<Reply>, number, string | null]> = [
        ['a teacher of another class schedules', () => act(exam('A4'), 'schedule', 'foreign'), 404, 'exam_not_found'],
        ['a teacher of another class publishes', () => act(exam('A1'), 'publish', 'foreign'), 404, 'exam_not_found'],
        ['a student holds no exams.manage', () => act(exam('A1'), 'publish', 's1'), 403, 'permission_denied'],
        ['an unknown exam', () => act(NIL_ID, 'schedule'), 404, 'exam_not_found'],
        ['an unknown action', () => act(exam('A1'), 'archive'), 400, null],
        ['publishing a draft', () => act(exam('A4'), 'publish'), 409, 'invalid_transition'],
        ['scheduling a scheduled exam again', () => act(exam('A1'), 'schedule'), 409, 'invalid_transition'],
        ['unscheduling an exam that holds results', () => act(exam('A1'), 'unschedule'), 409, 'exam_has_results'],
        ['scheduling in a cancelled class', () => act(exam('C1'), 'schedule'), 409, 'class_closed'],
        ['publishing in a cancelled class', () => act(exam('C2'), 'publish'), 409, 'class_closed'],
        ['a result for a withdrawn student', () => record(exam('A1'), [{ studentId: id('gone'), status: 'absent' }]), 422, 'not_enrolled'],
      ];
      for (const [label, send, status, errorCode] of refusals) {
        const { res, rows, events, handed } = await observe(send);
        expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(status);
        if (errorCode) expect(res.body.code, label).toBe(errorCode);
        expect(rows, label).toEqual([]);
        expect(events, label).toEqual([]);
        expect(handed, label).toEqual([]);
      }
      expect(await aboutExam(exam('A1'), 'exam.results_published')).toBe(0);
      expect(await aboutExam(exam('C1'), 'exam.scheduled')).toBe(0);
      expect(await aboutExam(exam('C2'), 'exam.results_published')).toBe(0);
    },
    60_000,
  );

  it(
    'the notifications belong to the write: when the transaction fails after they were written, nothing of it stays — no status change, no audit event, no notification — and nothing is handed over',
    async () => {
      // The engine writes its rows for real and then fails, once per action. Nest logs the scripted error as an
      // unexpected one — that line is expected in this suite's output.
      const failure = new Error('TEST-176: scripted failure after the notification write');
      const written: number[] = [];
      const arm = {
        schedule: () => {
          const real = engine.notifyClass.bind(engine);
          return vi.spyOn(engine, 'notifyClass').mockImplementationOnce(async (...args: Parameters<typeof real>) => {
            written.push((await real(...args)).created);
            throw failure;
          });
        },
        publish: () => {
          const real = engine.notifyStudents.bind(engine);
          return vi.spyOn(engine, 'notifyStudents').mockImplementationOnce(async (...args: Parameters<typeof real>) => {
            written.push((await real(...args)).created);
            throw failure;
          });
        },
      };
      for (const [action, name, stays, expected] of [
        ['schedule', 'A4', 'draft', 5],
        ['publish', 'A1', 'scheduled', 6],
      ] as const) {
        written.length = 0;
        const spy = arm[action]();
        try {
          const { res, rows, events, handed } = await observe(() => act(exam(name), action));
          expect(res.status, action).toBe(500);
          // The notifications were written inside the transaction …
          expect(written, action).toEqual([expected]);
          // … and went with it: the status change, its audit event and the notifications stand or fall together.
          expect(rows, action).toEqual([]);
          expect(events, action).toEqual([]);
          expect(await prisma.exam.findUniqueOrThrow({ where: { id: exam(name) }, select: { status: true, publishedAt: true } }), action).toEqual({ status: stays, publishedAt: null });
          expect(handed, action).toEqual([]);
        } finally {
          spy.mockRestore();
        }
      }
    },
    TEST_TIMEOUT,
  );

  it(
    'publish → `exam.results_published`: one notification per (recipient × student holding a result), each with that student’s own result — never the feedback or the recorder',
    async () => {
      const { res, rows, events, handed } = await observe(() => act(exam('A1'), 'publish', 'teacher', REASON_MARK));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(EXAM_KEYS);
      expect(res.body).toMatchObject({ id: exam('A1'), status: 'published', results: { students: 3, scored: 1, absent: 1, excused: 1 } });
      expect(typeof res.body.publishedAt).toBe('string');
      expect(events.map((event) => [event.action, event.entityType, event.entityId, event.actorUserId, event.metadata])).toEqual([
        ['exams.status.changed', 'exams', exam('A1'), id('teacher'), { classId: classes['A'], code: code('A'), action: 'publish', from: 'scheduled', to: 'published', reason: REASON_MARK }],
      ]);

      // s4 holds no result: nothing for them and nothing about them for their guardian. Not the linked user without the role, no teacher.
      expect(recipientsOf(rows)).toEqual(['guardian', 'guardian2', 's1', 's2', 's3']);
      expect(rows).toHaveLength(6);
      expect(await aboutExam(exam('A1'), 'exam.results_published')).toBe(6);
      expect(handed).toEqual([{ created: 6, queued: 0, committed: 6 }]);
      for (const row of rows) {
        expect(row).toMatchObject({ eventKey: 'exam.results_published', category: 'exams', readAt: null, announcementId: null });
        expect(row.data).toEqual({ link: LINK, examId: exam('A1'), classId: classes['A'] });
      }
      const mine = byRecipient(rows);
      const titleEn = 'Exam result published: Midterm';
      const titleAr = 'نُشرت نتيجة اختبار: منتصف الدورة';
      // Each student: their own result, in their own language. s3 takes part although their enrollment is completed.
      expect(mine['s1']).toHaveLength(1);
      expect(mine['s1']![0]).toMatchObject({ studentUserId: id('s1'), title: titleEn, body: 'Result of the exam “Midterm”: 17.25 out of 40.', emailStatus: 'skipped' });
      expect(mine['s2']).toHaveLength(1);
      expect(mine['s2']![0]).toMatchObject({ studentUserId: id('s2'), title: titleAr, body: 'نتيجة اختبار «منتصف الدورة»: غائب.', emailStatus: 'none' });
      expect(mine['s3']).toHaveLength(1);
      expect(mine['s3']![0]).toMatchObject({ studentUserId: id('s3'), title: titleEn, body: 'Result of the exam “Midterm”: excused.', emailStatus: 'skipped' });
      // The guardian of two: one notification per child, in the order of the children's ids.
      const bodyAbout: Record<string, string> = {
        s1: 'Result of the exam “Midterm”: 17.25 out of 40. Student: Sami.',
        s2: 'Result of the exam “Midterm”: absent. Student: Fixture s2.',
      };
      expect(mine['guardian']!.map((row) => [row.studentUserId, row.title, row.body, row.emailStatus])).toEqual(inIdOrder('s1', 's2').map((name) => [id(name), titleEn, bodyAbout[name], 'skipped']));
      // The guardian of s3 and s4: s3's result only.
      expect(mine['guardian2']!.map((row) => [row.studentUserId, row.title, row.body, row.emailStatus])).toEqual([[id('s3'), titleAr, 'نتيجة اختبار «منتصف الدورة»: معذور. الطالب: Fixture s3.', 'none']]);
      // A score reaches the student it belongs to and their guardian, nobody else.
      for (const row of rows) expect(row.body.includes('17.25'), row.recipientUserId).toBe(row.studentUserId === id('s1'));
      expectNoLeak(rows);

      // The student reads it in «my notifications», newest first.
      const inbox = await api().get('/api/me/notifications').query({ category: 'exams', limit: 1 }).set(bearer('s1')).expect(200);
      expect(inbox.body.items[0]).toMatchObject({
        id: mine['s1']![0]!.id,
        eventKey: 'exam.results_published',
        title: titleEn,
        body: 'Result of the exam “Midterm”: 17.25 out of 40.',
        data: { link: LINK, examId: exam('A1'), classId: classes['A'] },
        student: { id: id('s1'), fullName: 'Fixture s1', displayName: 'Sami' },
        readAt: null,
      });

      // Publishing a published exam is refused and tells nobody a second time.
      const twice = await observe(() => act(exam('A1'), 'publish'));
      expect(twice.res.body).toMatchObject({ statusCode: 409, code: 'invalid_transition', from: 'published' });
      expect(twice.rows).toEqual([]);
      expect(twice.events).toEqual([]);
      expect(twice.handed).toEqual([]);
    },
    TEST_TIMEOUT,
  );

  it(
    'a correction on a published exam and `unpublish` tell nobody; publishing again is a new write with the results of that moment',
    async () => {
      // Also not on an already published exam: s1's score is corrected and s4 gets a first result.
      const corrected = await observe(() =>
        record(exam('A1'), [
          { studentId: id('s1'), status: 'scored', score: 18, feedback: FEEDBACK_MARK },
          { studentId: id('s4'), status: 'scored', score: 9.5 },
        ]),
      );
      expect(corrected.res.status, JSON.stringify(corrected.res.body)).toBe(200);
      expect(corrected.res.body).toMatchObject({ examStatus: 'published', counts: { students: 4, scored: 2, absent: 1, excused: 1 } });
      expect(corrected.rows).toEqual([]);
      expect(corrected.events.map((event) => event.action)).toEqual(['exams.results.recorded']);

      const hidden = await observe(() => act(exam('A1'), 'unpublish'));
      expect(hidden.res.body).toMatchObject({ status: 'scheduled', publishedAt: null });
      expect(hidden.rows).toEqual([]);
      expect(hidden.events.map((event) => [event.action, (event.metadata as { action: string }).action])).toEqual([['exams.status.changed', 'unpublish']]);

      const { res, rows, handed } = await observe(() => act(exam('A1'), 'publish'));
      expect(res.body).toMatchObject({ status: 'published', results: { students: 4, scored: 2, absent: 1, excused: 1 } });
      // Four results now: every student and one row per child for both guardians.
      expect(recipientsOf(rows)).toEqual(['guardian', 'guardian2', 's1', 's2', 's3', 's4']);
      expect(rows).toHaveLength(8);
      expect(handed).toEqual([{ created: 8, queued: 0, committed: 8 }]);
      expect(await aboutExam(exam('A1'), 'exam.results_published')).toBe(14);
      const mine = byRecipient(rows);
      // `18.00` and `40.00` are worded without trailing zeros.
      expect(mine['s1']!.map((row) => row.body)).toEqual(['Result of the exam “Midterm”: 18 out of 40.']);
      expect(mine['s4']!.map((row) => [row.studentUserId, row.body])).toEqual([[id('s4'), 'نتيجة اختبار «منتصف الدورة»: 9.5 من 40.']]);
      const arabicAbout: Record<string, string> = {
        s3: 'نتيجة اختبار «منتصف الدورة»: معذور. الطالب: Fixture s3.',
        s4: 'نتيجة اختبار «منتصف الدورة»: 9.5 من 40. الطالب: Fixture s4.',
      };
      expect(mine['guardian2']!.map((row) => [row.studentUserId, row.body])).toEqual(inIdOrder('s3', 's4').map((name) => [id(name), arabicAbout[name]]));
      expect(mine['guardian']!.map((row) => row.studentUserId)).toEqual(inIdOrder('s1', 's2').map(id));
      expectNoLeak(rows);
    },
    TEST_TIMEOUT,
  );

  it(
    'an exam published without any result tells nobody, and nobody outside the audience ever received anything',
    async () => {
      const { res, rows, events } = await observe(() => act(exam('A2'), 'publish'));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ status: 'published', results: { students: 0, scored: 0, absent: 0, excused: 0 } });
      expect(rows).toEqual([]);
      expect(events.map((event) => event.action)).toEqual(['exams.status.changed']);
      expect(await aboutExam(exam('A2'), 'exam.results_published')).toBe(0);

      // Over the whole run: the linked user without the `guardian` role, the withdrawn student and the teachers hold no notification.
      expect(await prisma.notification.count({ where: { recipientUserId: { in: ['norole', 'gone', 'teacher', 'foreign'].map(id) } } })).toBe(0);
      // And the fixture users received these two events only, all in the `exams` category.
      const kinds = await prisma.notification.groupBy({ by: ['eventKey', 'category'], where: { recipientUserId: { in: createdUserIds } }, orderBy: { eventKey: 'asc' } });
      expect(kinds).toEqual([
        { eventKey: 'exam.results_published', category: 'exams' },
        { eventKey: 'exam.scheduled', category: 'exams' },
      ]);
      // D-R86: a notification is never an audit event — the fixture actors recorded exam writes and sign-ins only.
      const actions = await prisma.auditLog.findMany({ where: { actorUserId: { in: actors } }, distinct: ['action'], select: { action: true } });
      expect(actions.map((event) => event.action).filter((action) => !action.startsWith('exams.') && !action.startsWith('auth.'))).toEqual([]);
    },
    TEST_TIMEOUT,
  );
});
