// TEST-178 — MOD-12-T05 (announcements): manual announcements through the real
// routes (API-173 `POST /api/announcements`, API-174 `GET /api/announcements`,
// API-175 `GET /api/announcements/:id`; owner decision D-R85) against the live
// development database. Skipped when no database is reachable.
//
// Fixture users (teachers with the seeded `teacher` role — it holds
// `notifications.send` — a manager whose custom role holds
// `notifications.send` + `classes.manage`, a clerk with `classes.manage`
// alone, students, guardians and people who must receive nothing — and, for
// one test, a crowd of 2,050 students that fills three INSERT statements), four
// classes and their announcements carry a unique prefix and are deleted at the
// end. The notifications of a request are read by its announcement id, the
// audit events by fixture actor above an id watermark, so other clients of
// the shared database never pollute the counts.
//
// Two things are stubbed, and only these:
//   * the mail transport is a recording fake named `none` (what the e2e runs
//     use), renamed for one test to prove the hand-over to the dispatcher —
//     nothing is ever e-mailed;
//   * an ACADEMY audience resolves to everyone in the database who holds the
//     role — real development accounts and the fixture users of suites running
//     at the same moment, whose own assertions an unexpected notification
//     would break. For the whole suite `AnnouncementsService.audienceMembers()`
//     therefore runs its real queries and then drops every user this suite did
//     not create (`found` keeps what the database really answered): the suite
//     writes no notification into anybody else's inbox, not even if a check it
//     tests should fail one day. A class audience holds fixture users only, so
//     nothing is dropped there. `audience_too_large` hands the service 5,001
//     made-up members instead of creating 5,001 users.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { PasswordService } from '../src/auth/password.service.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { MAIL_TRANSPORT } from '../src/mail/mail.transport.js';
import type { MailDeliveryResult, MailMessage, MailTransport } from '../src/mail/mail.transport.js';
import { AnnouncementsService } from '../src/notifications/announcements.service.js';
import { NotificationDispatcher } from '../src/notifications/notifications.dispatcher.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `AN${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-178 supertest';
const ANNOUNCEMENTS = '/api/announcements';
const INBOX = '/api/me/notifications';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
/** A test here is a few dozen requests against a database other suites share: each states its own, generous limit (KI-040). */
const TEST_TIMEOUT = 30_000;
const ANNOUNCEMENT_KEYS = ['audience', 'body', 'class', 'createdAt', 'id', 'recipientCount', 'sendEmail', 'sender', 'title'];
const DETAIL_KEYS = [...ANNOUNCEMENT_KEYS, 'email', 'readCount'].sort();
const INBOX_ITEM_KEYS = ['announcementId', 'body', 'category', 'createdAt', 'data', 'eventKey', 'id', 'readAt', 'student', 'title'];
const NO_EMAIL = { none: 0, queued: 0, sent: 0, failed: 0, skipped: 0 };
/** Recognisable words of the sender: they must reach every recipient verbatim and appear in no audit event and no e-mail body. */
const TITLE_MARK = `TITLE-${RUN}`;
const BODY_MARK = `BODY-${RUN}`;
/** Two characters to the eye, four to PostgreSQL's `char_length`: each heart carries a variation selector. */
const HEARTS = '\u2764\uFE0F\u2764\uFE0F';
const TITLE = `Tomorrow's lesson moves <to> room 4 & ${TITLE_MARK}`;
const BODY = `السلام عليكم،\nFirst line <b>not bold</b> & "quoted"\n\n  Second paragraph — ${BODY_MARK}`;

interface AnnouncementBody {
  id: string;
  audience: Record<string, unknown>;
  class: { id: string; code: string; name: Record<string, string> } | null;
  title: string;
  body: string;
  sendEmail: boolean;
  recipientCount: number;
  sender: { id: string; fullName: string; displayName: string | null } | null;
  createdAt: string;
}

type Row = Prisma.NotificationGetPayload<object>;

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

/** Records every message and answers "sent"; its name is what `MAIL_TRANSPORT` would be — `none` unless a test renames it. */
class RecordingTransport implements MailTransport {
  name = 'none';
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<MailDeliveryResult> {
    this.sent.push(message);
    return { transport: this.name, status: 'sent', messageId: `rec-${this.sent.length}` };
  }
}

describe.skipIf(!available)('MOD-12 announcements (e2e, TEST-178)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let announcements: AnnouncementsService;
  let dispatcher: NotificationDispatcher;
  let membersSpy: MockInstance<AnnouncementsService['audienceMembers']>;
  /** The ids the audience queries really returned, one entry per request that reached them. */
  const found: string[][] = [];
  const mailbox = new RecordingTransport();
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const classes: Record<string, string> = {};
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const actors: string[] = [];
  /** Announcements by a name the later tests refer to. */
  const sent: Record<string, string> = {};

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name.toLowerCase()}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  const ids = (...names: string[]) => names.map(id).sort();
  const nameOf = (userId: string) => Object.keys(fx).find((name) => fx[name] === userId) ?? userId;
  const post = (as: string, body: object) => api().post(ANNOUNCEMENTS).set(bearer(as)).send(body);
  const list = (as: string, query: Record<string, string | number> = {}) => api().get(ANNOUNCEMENTS).query(query).set(bearer(as));
  const read = (as: string, announcementId: string) => api().get(`${ANNOUNCEMENTS}/${announcementId}`).set(bearer(as));
  const toClass = (suffix: string, groups: object) => ({ kind: 'class', classId: classes[suffix], ...groups });
  const message = (audience: object, over: object = {}) => ({ audience, title: TITLE, body: BODY, ...over });

  /** Every notification of an announcement — whoever received it. */
  const rowsOf = (announcementId: string) => prisma.notification.findMany({ where: { announcementId }, orderBy: { id: 'asc' } });
  const recipientsOf = (rows: Row[]) => rows.map((row) => nameOf(row.recipientUserId)).sort();

  async function mark(): Promise<{ audit: string; announcement: string }> {
    const audit = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    const announcement = await prisma.announcement.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return { audit: audit?.id ?? NIL_ID, announcement: announcement?.id ?? NIL_ID };
  }
  /** What the fixture actors caused since the mark: their audit events and the announcements they sent. */
  async function since(m: { audit: string; announcement: string }) {
    const events = await prisma.auditLog.findMany({ where: { id: { gt: m.audit }, actorUserId: { in: actors } }, orderBy: { id: 'asc' } });
    const written = await prisma.announcement.findMany({ where: { id: { gt: m.announcement }, senderUserId: { in: actors } }, orderBy: { id: 'asc' }, select: { id: true } });
    return { events, announcements: written.map((row) => row.id) };
  }
  const NOTHING = { events: [], announcements: [] };

  /** Sends and expects 201; keeps the id under `name` when one is given. */
  async function announce(as: string, body: object, name?: string): Promise<AnnouncementBody> {
    const res = await post(as, body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    if (name) sent[name] = res.body.id as string;
    return res.body as AnnouncementBody;
  }

  /**
   * From here on an audience keeps only the users this suite created (see the
   * header). The service's real queries run first — `found` collects the ids
   * they returned, request by request — so the rule is exercised against the
   * database; only what is written is narrowed.
   */
  function keepOwnUsersOnly(): typeof membersSpy {
    const original = announcements.audienceMembers.bind(announcements);
    return vi.spyOn(announcements, 'audienceMembers').mockImplementation(async (tx, audience) => {
      const groups = await original(tx, audience);
      found.push(groups.flat().map((member) => member.id));
      return groups.map((group) => group.filter((member) => createdUserIds.includes(member.id)));
    });
  }

  async function createRole(name: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_${name}_${RUN.toLowerCase()}`, label: { ar: `دور اختبار ${name}` }, permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
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
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Fixture ${name}`,
        displayName: options.displayName ?? null,
        locale: options.locale ?? null,
        status: options.status ?? 'active',
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
      const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(name), password: PASSWORD }).expect(200);
      tokens[name] = res.body.accessToken as string;
      actors.push(user.id);
    }
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
    announcements = app.get(AnnouncementsService);
    dispatcher = app.get(NotificationDispatcher);
    membersSpy = keepOwnUsersOnly();

    const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
    const teacher = await systemRole('teacher');
    const student = await systemRole('student');
    const guardian = await systemRole('guardian');
    const staff = await systemRole('staff');
    // The suite stands on the seeded teacher role: it may announce, and it sees only the classes it teaches.
    const teacherKeys = (await prisma.rolePermission.findMany({ where: { roleId: teacher, permissionKey: { in: ['notifications.send', 'classes.manage'] } }, select: { permissionKey: true } })).map((row) => row.permissionKey);
    expect(teacherKeys, 'the seeded `teacher` role must hold notifications.send and not classes.manage').toEqual(['notifications.send']);

    // Senders and readers.
    await createUser('teacher', { roles: [teacher], locale: 'ar', signsIn: true, displayName: 'Ustadh' });
    await createUser('assistant', { roles: [teacher], locale: 'en', signsIn: true });
    await createUser('teacher2', { roles: [teacher], signsIn: true });
    // The seeded `staff` role on top makes the manager a member of the academy audience `staff` — and the sender never receives.
    await createUser('manager', { roles: [await createRole('announcer', ['notifications.send', 'classes.manage']), staff], signsIn: true });
    await createUser('clerk', { roles: [await createRole('clerk', ['classes.read', 'classes.manage'])], signsIn: true });
    // The people of class A.
    await createUser('student1', { roles: [student], locale: 'en', signsIn: true });
    await createUser('student2', { roles: [student], locale: 'ar', verified: false });
    await createUser('student3', { roles: [student], locale: null });
    await createUser('both', { roles: [student, guardian], locale: 'ar' }); // a classmate who is also the guardian of student1
    await createUser('withdrawn', { roles: [student] }); // an active account whose enrollment is withdrawn
    await createUser('invited', { roles: [student], status: 'invited' }); // enrolled, but cannot sign in yet
    await createUser('ghost', { roles: [student], status: 'archived', deleted: true }); // enrolled, soft-deleted
    // Soft-deleted with the status still `active` — a state the API never leaves behind, but the table allows: the two rules are checked apart.
    await createUser('erased', { roles: [student], deleted: true });
    await createUser('guardian', { roles: [guardian], locale: 'ar', signsIn: true }); // two children in the class
    await createUser('norole', {}); // linked to student1 without the `guardian` role
    await createUser('suspended', { roles: [guardian], status: 'suspended' }); // linked to student1, account suspended
    await createUser('ofInvited', { roles: [guardian], locale: 'en' });
    await createUser('ofGhost', { roles: [guardian] });
    await createUser('ofWithdrawn', { roles: [guardian] });
    // Outside class A.
    await createUser('outsider', { roles: [student] }); // the only student of class B
    await createUser('staff', { roles: [staff] });

    for (const [guardianName, studentName] of [
      ['guardian', 'student1'],
      ['guardian', 'student2'],
      ['both', 'student1'],
      ['norole', 'student1'],
      ['suspended', 'student1'],
      ['ofInvited', 'invited'],
      ['ofGhost', 'ghost'],
      ['ofWithdrawn', 'withdrawn'],
    ] as const) {
      await prisma.guardianStudent.create({ data: { guardianUserId: id(guardianName), studentUserId: id(studentName), relationship: 'father' }, select: { studentUserId: true } });
    }

    const courseId = (await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة الإعلانات' }, status: 'published' }, select: { id: true } })).id;
    const createClass = async (suffix: string, teachers: Array<[string, 'lead' | 'assistant']>) => {
      const klass = await prisma.class.create({
        data: { courseId, code: code(suffix), name: { ar: `فصل ${suffix}`, en: `Class ${suffix}` }, capacity: 30, status: 'running', teachers: { create: teachers.map(([name, role]) => ({ teacherUserId: id(name), role })) } },
        select: { id: true },
      });
      classes[suffix] = klass.id;
    };
    await createClass('A', [['teacher', 'lead'], ['assistant', 'assistant']]);
    await createClass('B', [['teacher2', 'lead']]);
    await createClass('C', [['teacher', 'lead']]); // nobody enrolled, nobody else teaches it
    await createClass('D', [['teacher2', 'lead']]); // the class of the crowd: the test that needs 2,050 students enrolls them
    for (const [suffix, name, status] of [
      ['A', 'student1', 'active'],
      ['A', 'student2', 'active'],
      ['A', 'student3', 'active'],
      ['A', 'both', 'active'],
      ['A', 'withdrawn', 'withdrawn'],
      ['A', 'invited', 'active'],
      ['A', 'ghost', 'active'],
      ['A', 'erased', 'active'],
      ['B', 'outsider', 'active'],
    ] as const) {
      await prisma.enrollment.create({ data: { classId: classes[suffix]!, studentUserId: id(name), status }, select: { id: true } });
    }
    // E-mail switches (D-R84): `announcements` off for student3; another category off, and this one explicitly on, change nothing.
    await prisma.notificationPreference.createMany({
      data: [
        { userId: id('student3'), category: 'announcements', emailEnabled: false },
        { userId: id('guardian'), category: 'lessons', emailEnabled: false },
        { userId: id('both'), category: 'announcements', emailEnabled: true },
      ],
    });
  }, 120_000);

  afterAll(async () => {
    try {
      if (dispatcher) await dispatcher.whenIdle();
      if (prisma) {
        // An announcement outlives its sender and its class (SET NULL): delete them first — their notifications go with them.
        await prisma.announcement.deleteMany({ where: { OR: [{ senderUserId: { in: createdUserIds } }, { classId: { in: Object.values(classes) } }] } });
        await prisma.enrollment.deleteMany({ where: { classId: { in: Object.values(classes) } } });
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
      }
    } finally {
      if (prisma && createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (prisma && createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      membersSpy?.mockRestore();
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('AC1 — a teacher announces to the students and guardians of a class they teach: each recipient once, the words as typed, one audit event without them', { timeout: TEST_TIMEOUT }, async () => {
    const m = await mark();
    const res = await post('teacher', { audience: toClass('A', { students: true, guardians: true }), title: `  ${TITLE}\n`, body: `\n ${BODY}  ` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const body = res.body as AnnouncementBody;
    sent['first'] = body.id;
    expect(Object.keys(body).sort()).toEqual(ANNOUNCEMENT_KEYS);
    expect(body).toMatchObject({
      // Normalised: the three groups spelled out.
      audience: { kind: 'class', classId: classes['A'], students: true, guardians: true, teachers: false },
      class: { id: classes['A'], code: code('A'), name: { ar: 'فصل A', en: 'Class A' } },
      // Trimmed at both ends, otherwise untouched: markup stays text, line breaks and inner spaces stay.
      title: TITLE,
      body: BODY,
      sendEmail: false,
      recipientCount: 6,
      sender: { id: id('teacher'), fullName: 'Fixture teacher', displayName: 'Ustadh' },
    });
    expect(Object.keys(body.audience).sort()).toEqual(['classId', 'guardians', 'kind', 'students', 'teachers']);
    expect(new Date(body.createdAt).toISOString()).toBe(body.createdAt);

    // Who received it. Students: an active enrollment AND an active account — not the withdrawn enrollment, not the
    // invited account, not the soft-deleted ones (archived, or still marked active). Guardians: a link and the role
    // and an active account — the father of two children ONCE, the classmate who is also a guardian ONCE, the guardian
    // of the invited student (his child is in the class); not the linked user without the role, not the suspended
    // guardian, not the guardian of the soft-deleted or of the withdrawn student. Never the sender, and not the
    // assistant: `teachers` was not asked for.
    const rows = await rowsOf(body.id);
    expect(recipientsOf(rows)).toEqual(['both', 'guardian', 'ofInvited', 'student1', 'student2', 'student3']);
    expect(rows).toHaveLength(body.recipientCount);
    for (const row of rows) {
      expect(row, nameOf(row.recipientUserId)).toMatchObject({
        eventKey: 'announcement',
        category: 'announcements',
        // The same words for a reader of Arabic, of English and of the academy's language: nothing is translated.
        title: TITLE,
        body: BODY,
        data: { link: '/notifications', announcementId: body.id, classId: classes['A'] },
        announcementId: body.id,
        studentUserId: null,
        readAt: null,
        // No e-mail was asked for: none is due, whatever the address and the switches.
        emailStatus: 'none',
        emailSentAt: null,
        emailMessageId: null,
        emailFailure: null,
      });
    }
    expect(await prisma.announcement.findUniqueOrThrow({ where: { id: body.id } })).toMatchObject({
      senderUserId: id('teacher'),
      classId: classes['A'],
      audience: { kind: 'class', classId: classes['A'], students: true, guardians: true, teachers: false },
      title: TITLE,
      body: BODY,
      sendEmail: false,
      recipientCount: 6,
    });

    // Exactly one audit event, on the announcement, with ids and a count — never the sender's words.
    const after = await since(m);
    expect(after.announcements).toEqual([body.id]);
    expect(after.events.map((event) => [event.action, event.entityType, event.entityId, event.actorUserId])).toEqual([['notifications.announcement.sent', 'announcements', body.id, id('teacher')]]);
    expect(after.events[0]!.metadata).toEqual({ audience: { kind: 'class', classId: classes['A'], students: true, guardians: true, teachers: false }, recipients: 6 });
    expect(after.events[0]!.userAgent).toBe(USER_AGENT);
    const recorded = JSON.stringify(after.events);
    for (const words of [TITLE_MARK, BODY_MARK, 'not bold', 'room 4']) expect(recorded).not.toContain(words);
    // Nothing was handed to the mail transport.
    expect(mailbox.sent).toHaveLength(0);

    // API-175 answers the same announcement, plus what became of it.
    const detail = await read('teacher', body.id).expect(200);
    expect(Object.keys(detail.body).sort()).toEqual(DETAIL_KEYS);
    expect(detail.body).toEqual({ ...body, readCount: 0, email: { ...NO_EMAIL, none: 6 } });
  });

  it('the recipients find it in «my notifications» and mark it read; the sender sees how many did', { timeout: TEST_TIMEOUT }, async () => {
    const m = await mark();
    const announcementId = sent['first']!;
    const inboxOf = async (name: string, unread = false) =>
      (await api().get(INBOX).query({ category: 'announcements', limit: 100, ...(unread ? { unread: 'true' } : {}) }).set(bearer(name)).expect(200)).body.items as Array<Record<string, unknown>>;
    /** This announcement among the reader's unread notifications (the whole counter may move with what other suites send). */
    const unreadOf = async (name: string) => (await inboxOf(name, true)).filter((item) => item['announcementId'] === announcementId).length;

    const mine = (await inboxOf('student1')).filter((item) => item['announcementId'] === announcementId);
    expect(mine).toHaveLength(1);
    expect(Object.keys(mine[0]!).sort()).toEqual(INBOX_ITEM_KEYS);
    expect(mine[0]).toMatchObject({
      eventKey: 'announcement',
      category: 'announcements',
      title: TITLE,
      body: BODY,
      data: { link: '/notifications', announcementId, classId: classes['A'] },
      // An announcement is about nobody in particular — also for the father of two children in the class.
      student: null,
      announcementId,
      readAt: null,
    });
    const fathers = (await inboxOf('guardian')).filter((item) => item['announcementId'] === announcementId);
    expect(fathers).toHaveLength(1);
    expect(fathers[0]).toMatchObject({ title: TITLE, body: BODY, student: null });
    // The sender and a teacher who was not addressed have nothing.
    for (const name of ['teacher', 'assistant']) expect((await inboxOf(name)).filter((item) => item['announcementId'] === announcementId)).toEqual([]);

    // It counts as unread until its reader marks it — like every notification.
    expect(await unreadOf('student1')).toBe(1);
    expect((await api().get(`${INBOX}/unread-count`).set(bearer('student1')).expect(200)).body.unread).toBeGreaterThanOrEqual(1);
    const marked = await api().post(`${INBOX}/${mine[0]!['id'] as string}/read`).set(bearer('student1')).expect(200);
    expect(marked.body).toMatchObject({ id: mine[0]!['id'], announcementId });
    expect(typeof marked.body.readAt).toBe('string');
    expect(await unreadOf('student1')).toBe(0);
    expect((await read('teacher', announcementId).expect(200)).body).toMatchObject({ readCount: 1, recipientCount: 6 });
    // Marking everything of the category works for an announcement like for any notification.
    expect(await unreadOf('guardian')).toBe(1);
    const all = await api().post(`${INBOX}/read-all`).set(bearer('guardian')).send({ category: 'announcements' }).expect(200);
    expect(all.body.updated).toBeGreaterThanOrEqual(1);
    expect(await unreadOf('guardian')).toBe(0);
    expect((await read('teacher', announcementId).expect(200)).body).toMatchObject({ readCount: 2, email: { ...NO_EMAIL, none: 6 } });
    // A recipient is not a reader of the announcement itself: that takes `notifications.send`.
    expect((await read('student1', announcementId)).status).toBe(403);

    // Reading an inbox, marking as read and reading an announcement record nothing.
    expect(await since(m)).toEqual(NOTHING);
  });

  it('the groups of a class audience: `teachers` reaches the co-teacher and never the sender; an assistant announces too; a holder of `classes.manage` reaches any class', { timeout: TEST_TIMEOUT }, async () => {
    const m = await mark();
    // Teachers only: the assistant — the lead teacher is the sender.
    const toTeachers = await announce('teacher', message(toClass('A', { teachers: true })), 'teachers');
    expect(toTeachers).toMatchObject({ recipientCount: 1, audience: { kind: 'class', classId: classes['A'], students: false, guardians: false, teachers: true } });
    expect(recipientsOf(await rowsOf(toTeachers.id))).toEqual(['assistant']);

    // An assistant teaches the class as well: the students and the other teacher, not themself.
    const byAssistant = await announce('assistant', message(toClass('A', { students: true, teachers: true })), 'byAssistant');
    expect(byAssistant).toMatchObject({ recipientCount: 5, sender: { id: id('assistant'), fullName: 'Fixture assistant', displayName: null } });
    expect(recipientsOf(await rowsOf(byAssistant.id))).toEqual(['both', 'student1', 'student2', 'student3', 'teacher']);

    // Guardians only: each once — the classmate-guardian included, who gets no second copy as a student.
    const toGuardians = await announce('teacher', message(toClass('A', { guardians: true, students: false })), 'guardians');
    expect(recipientsOf(await rowsOf(toGuardians.id))).toEqual(['both', 'guardian', 'ofInvited']);
    expect(toGuardians.recipientCount).toBe(3);

    // All three groups of a class the manager does not teach.
    const byManager = await announce('manager', message(toClass('B', { students: true, guardians: true, teachers: true })), 'managerB');
    expect(byManager).toMatchObject({ recipientCount: 2, class: { id: classes['B'], code: code('B') }, sender: { id: id('manager') } });
    expect(recipientsOf(await rowsOf(byManager.id))).toEqual(['outsider', 'teacher2']);
    for (const row of await rowsOf(byManager.id)) expect(row.data).toEqual({ link: '/notifications', announcementId: byManager.id, classId: classes['B'] });

    // One event per announcement, by its sender.
    const after = await since(m);
    expect(after.announcements).toEqual([toTeachers.id, byAssistant.id, toGuardians.id, byManager.id]);
    expect(after.events.map((event) => [event.action, event.entityId, event.actorUserId, (event.metadata as { recipients: number }).recipients])).toEqual([
      ['notifications.announcement.sent', toTeachers.id, id('teacher'), 1],
      ['notifications.announcement.sent', byAssistant.id, id('assistant'), 5],
      ['notifications.announcement.sent', toGuardians.id, id('teacher'), 3],
      ['notifications.announcement.sent', byManager.id, id('manager'), 2],
    ]);
  });

  it('an announcement does not wait for a writer that holds the class row', { timeout: TEST_TIMEOUT }, async () => {
    // Every writer under a class holds its row `FOR NO KEY UPDATE` while it works (enrolling, scheduling, creating an
    // exam — the MOD-05 lock). An announcement changes nothing of the class: it is sent, and answered, while that lock
    // is held. Were it to take a conflicting lock, the request below would wait for this transaction, which waits for it.
    const announced = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM classes WHERE id = ${classes['A']}::uuid FOR NO KEY UPDATE`;
        return announce('teacher', message(toClass('A', { teachers: true })));
      },
      // Well inside the test's own limit: a request that waits for the lock fails here, with the reason in sight.
      { timeout: 10_000 },
    );
    expect(announced).toMatchObject({ recipientCount: 1, class: { id: classes['A'] } });
    expect(recipientsOf(await rowsOf(announced.id))).toEqual(['assistant']);
  });

  it('a class the caller neither teaches nor manages answers 404 like an unknown one; nothing is written', { timeout: TEST_TIMEOUT }, async () => {
    const m = await mark();
    const refused: Array<[string, string]> = [
      ['teacher2', classes['A']!], // teaches B only
      ['teacher', classes['B']!],
      ['assistant', classes['C']!],
      ['teacher', NIL_ID],
      ['manager', NIL_ID], // unknown for everybody
    ];
    for (const [as, classId] of refused) {
      const res = await post(as, message({ kind: 'class', classId, students: true, guardians: true, teachers: true }));
      expect(res.status, `${as} → ${classId}`).toBe(404);
      expect(res.body).toMatchObject({ statusCode: 404, code: 'class_not_found', classId });
    }
    expect(await since(m)).toEqual(NOTHING);
  });

  it('an audience that reaches nobody is 422 audience_empty; nothing is written', { timeout: TEST_TIMEOUT }, async () => {
    const m = await mark();
    const empty: object[] = [
      toClass('C', { students: true }), // nobody is enrolled
      toClass('C', { students: true, guardians: true }),
      toClass('C', { teachers: true }), // its only teacher is the sender
      toClass('C', { students: true, guardians: true, teachers: true }),
    ];
    for (const audience of empty) {
      const res = await post('teacher', message(audience));
      expect(res.status, JSON.stringify(audience)).toBe(422);
      expect(res.body).toMatchObject({ statusCode: 422, code: 'audience_empty' });
    }
    // The same class has somebody for a sender who is not its only teacher.
    const byManager = await announce('manager', message(toClass('C', { teachers: true })));
    expect(recipientsOf(await rowsOf(byManager.id))).toEqual(['teacher']);
    const after = await since(m);
    expect(after.announcements).toEqual([byManager.id]);
    expect(after.events).toHaveLength(1);
  });

  it('more than 5,000 recipients is 422 audience_too_large with both numbers; nothing is written', { timeout: TEST_TIMEOUT }, async () => {
    const m = await mark();
    // 5,001 members that do not exist stand in for a very large class: the limit must stop the request before any insert.
    // The second group repeats ten of the first: the limit counts people, not memberships.
    const crowd = Array.from({ length: 5001 }, () => ({ id: randomUUID(), email: null, emailVerifiedAt: null }));
    const calls = membersSpy.mock.calls.length;
    membersSpy.mockResolvedValueOnce([crowd.slice(0, 3000), crowd.slice(2990)]);
    const res = await post('teacher', message(toClass('A', { students: true, guardians: true, teachers: true }), { sendEmail: true }));
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body).toMatchObject({ statusCode: 422, code: 'audience_too_large', recipients: 5001, max: 5000 });
    expect(membersSpy.mock.calls.length).toBe(calls + 1);
    expect(await since(m)).toEqual(NOTHING);
    // The real audience of the same request is far below the limit.
    expect((await announce('teacher', message(toClass('A', { students: true, guardians: true, teachers: true })))).recipientCount).toBe(7);
  });

  it('an audience of more than 1,000 is written in several statements: every recipient has exactly one notification', { timeout: 60_000 }, async () => {
    // The engine writes 1,000 rows per INSERT (`NOTIFICATION_INSERT_CHUNK`): 2,050 students and their teacher take
    // two full statements and a third with the last 51 — the path no class-sized announcement reaches.
    const CROWD = 2050;
    const crowd = await prisma.user.createManyAndReturn({
      // Every second address is confirmed: the e-mail state is decided row by row across the statements, too.
      data: Array.from({ length: CROWD }, (_, index) => ({ email: email(`crowd${index}`), fullName: `Fixture crowd ${index}`, status: 'active' as const, emailVerifiedAt: index % 2 === 0 ? new Date() : null })),
      select: { id: true },
    });
    createdUserIds.push(...crowd.map((user) => user.id));
    await prisma.enrollment.createMany({ data: crowd.map((user) => ({ classId: classes['D']!, studentUserId: user.id, status: 'active' as const })) });

    const m = await mark();
    const big = await announce('manager', message(toClass('D', { students: true, teachers: true }), { sendEmail: true }));
    expect(big).toMatchObject({ recipientCount: CROWD + 1, class: { id: classes['D'], code: code('D') }, sendEmail: true });
    const rows = await rowsOf(big.id);
    expect(rows).toHaveLength(CROWD + 1);
    // Nobody twice, nobody missing: the crowd and the class's teacher.
    expect(new Set(rows.map((row) => row.recipientUserId))).toEqual(new Set([...crowd.map((user) => user.id), id('teacher2')]));
    for (const row of rows) expect(row).toMatchObject({ announcementId: big.id, eventKey: 'announcement', title: TITLE, body: BODY });
    // No transport: the copies that were due are `skipped` — the confirmed half and the teacher — the rest `none`.
    expect((await read('manager', big.id).expect(200)).body).toMatchObject({ recipientCount: CROWD + 1, readCount: 0, email: { ...NO_EMAIL, skipped: CROWD / 2 + 1, none: CROWD / 2 } });
    expect(mailbox.sent).toHaveLength(0);
    // Still one announcement and one event, whatever the number of statements.
    const after = await since(m);
    expect(after.announcements).toEqual([big.id]);
    expect(after.events.map((event) => [event.action, event.entityId, event.actorUserId])).toEqual([['notifications.announcement.sent', big.id, id('manager')]]);
    expect(after.events[0]!.metadata).toEqual({ audience: { kind: 'class', classId: classes['D'], students: true, guardians: false, teachers: true }, recipients: CROWD + 1 });
  });

  it('every shape that is not an audience is 400 audience_invalid with its problems — before the permission and the class are looked at; nothing is written', { timeout: TEST_TIMEOUT }, async () => {
    const m = await mark();
    const A = classes['A']!;
    const invalid: Array<[object, string[]]> = [
      [{ kind: 'everyone' }, ['kind_unknown']],
      [{ kind: 'Class', classId: A, students: true }, ['kind_unknown']],
      [{ kind: '' }, ['kind_unknown']],
      [{ kind: 'class', students: true }, ['class_id_required']],
      [{ kind: 'class', classId: A }, ['recipient_group_required']],
      [{ kind: 'class', classId: A, students: false, guardians: false, teachers: false }, ['recipient_group_required']],
      [{ kind: 'class', classId: A, students: true, roleKeys: ['student'] }, ['role_keys_not_allowed']],
      [{ kind: 'class', classId: A, students: true, roleKeys: [] }, ['role_keys_not_allowed']],
      [{ kind: 'class', roleKeys: ['student'] }, ['class_id_required', 'recipient_group_required', 'role_keys_not_allowed']],
      [{ kind: 'academy', roleKeys: ['student'], classId: A }, ['class_fields_not_allowed']],
      [{ kind: 'academy', roleKeys: ['student'], students: true }, ['class_fields_not_allowed']],
      [{ kind: 'academy', roleKeys: ['student'], guardians: false }, ['class_fields_not_allowed']],
      [{ kind: 'academy', roleKeys: ['student'], teachers: true }, ['class_fields_not_allowed']],
      [{ kind: 'academy' }, ['role_keys_required']],
      [{ kind: 'academy', roleKeys: [] }, ['role_keys_required']],
      [{ kind: 'academy', roleKeys: ['student', 'academy_admin'] }, ['role_keys_unknown']],
      [{ kind: 'academy', roleKeys: ['Student'] }, ['role_keys_unknown']],
      [{ kind: 'academy', roleKeys: ['student', 'student'] }, ['role_keys_duplicate']],
      [{ kind: 'academy', roleKeys: ['student', 'guardian', 'teacher', 'staff', 'staff'] }, ['role_keys_duplicate']],
      [{ kind: 'academy', roleKeys: ['x', 'x'], classId: A }, ['class_fields_not_allowed', 'role_keys_unknown', 'role_keys_duplicate']],
    ];
    // The manager may send anything valid; the teacher may not announce to the academy — both get the same 400 first.
    for (const as of ['manager', 'teacher']) {
      for (const [audience, problems] of invalid) {
        const res = await post(as, message(audience));
        expect(res.status, `${as}: ${JSON.stringify(audience)}`).toBe(400);
        expect(res.body, JSON.stringify(audience)).toMatchObject({ statusCode: 400, code: 'audience_invalid', problems });
      }
    }
    // A class nobody may see, with no group: the shape is judged first.
    expect((await post('teacher2', message({ kind: 'class', classId: A }))).body).toMatchObject({ code: 'audience_invalid', problems: ['recipient_group_required'] });
    expect(await since(m)).toEqual(NOTHING);
  });

  it('validates the body: title 1..200 and body 1..4,000 characters after trimming, plain JSON types, no unknown field; nothing is written', { timeout: TEST_TIMEOUT }, async () => {
    const m = await mark();
    const audience = toClass('A', { teachers: true });
    const malformed: object[] = [
      { audience, body: BODY }, // no title
      { audience, title: TITLE }, // no body
      message(audience, { title: '   ' }),
      message(audience, { body: ' \n\t ' }),
      message(audience, { title: 'ع'.repeat(201) }),
      message(audience, { body: 'ب'.repeat(4001) }),
      // Characters are counted as the database counts them: two hearts with their variation selectors are four.
      message(audience, { title: 'ع'.repeat(197) + HEARTS }),
      message(audience, { body: 'ب'.repeat(3997) + HEARTS }),
      message(audience, { title: '\u{1F600}'.repeat(201) }),
      message(audience, { title: 42 }), // not turned into the text "42"
      message(audience, { body: true }),
      message(audience, { title: null }),
      message(audience, { title: ['a title'] }),
      message(audience, { title: `nul\u0000byte` }),
      message(audience, { body: `nul\u0000byte` }),
      message(audience, { sendEmail: 'yes' }),
      message(audience, { sendEmail: 1 }),
      message(audience, { scheduledAt: '2030-01-01T08:00:00Z' }), // no scheduling
      message(audience, { senderUserId: id('manager') }),
      { title: TITLE, body: BODY }, // no audience
      message(null as unknown as object),
      message('class' as unknown as object),
      message([audience]),
      message({ classId: classes['A'], teachers: true }), // no kind
      message({ kind: 'class', classId: 'not-a-uuid', teachers: true }),
      message({ kind: 'class', classId: classes['A'], teachers: 'true' }),
      message({ kind: 'class', classId: classes['A'], students: 1 }),
      message({ kind: 'class', classId: classes['A'], teachers: true, everyone: true }),
      message({ kind: 'academy', roleKeys: 'student' }),
      message({ kind: 'academy', roleKeys: [1, 2] }),
      message({ kind: 'academy', roleKeys: Array.from({ length: 17 }, () => 'student') }),
    ];
    for (const body of malformed) {
      const res = await post('manager', body);
      expect(res.status, JSON.stringify(body).slice(0, 160)).toBe(400);
      // An ordinary validation error: no `code` of the dictionary.
      expect(res.body.code, JSON.stringify(body).slice(0, 160)).toBeUndefined();
    }
    expect(await since(m)).toEqual(NOTHING);

    // The longest texts fit — counted in characters, not bytes — and come back as typed.
    const longest = await announce('teacher', { audience, title: 'ع'.repeat(200), body: 'ب'.repeat(4000) });
    expect(longest.title).toBe('ع'.repeat(200));
    expect(longest.body).toBe('ب'.repeat(4000));
    const [row] = await rowsOf(longest.id);
    expect(row).toMatchObject({ recipientUserId: id('assistant'), title: 'ع'.repeat(200), body: 'ب'.repeat(4000) });
    // The same limits in the database's count: 200 and 4,000 code points fit, whatever they take in UTF-16.
    const symbols = await announce('teacher', { audience, title: 'ع'.repeat(196) + HEARTS, body: 'ب'.repeat(3996) + HEARTS });
    expect(symbols).toMatchObject({ title: 'ع'.repeat(196) + HEARTS, body: 'ب'.repeat(3996) + HEARTS });
    expect((await announce('teacher', { audience, title: '\u{1F600}'.repeat(200), body: '\u{1F600}' })).title).toBe('\u{1F600}'.repeat(200));
    // One character each is enough.
    expect(await announce('teacher', { audience, title: 'ع', body: '.' })).toMatchObject({ title: 'ع', body: '.', recipientCount: 1 });
    expect((await since(m)).events).toHaveLength(4);
  });

  it('an academy audience needs `classes.manage` too — then it reaches every active holder of the roles, each once, never the sender', { timeout: TEST_TIMEOUT }, async () => {
    const m = await mark();
    // A teacher holds `notifications.send` alone: 403, naming the key that is missing.
    for (const as of ['teacher', 'assistant', 'teacher2']) {
      const res = await post(as, message({ kind: 'academy', roleKeys: ['student'] }));
      expect(res.status, as).toBe(403);
      expect(res.body).toMatchObject({ statusCode: 403, code: 'permission_denied', missing: ['classes.manage'] });
    }
    expect(await since(m)).toEqual(NOTHING);

    // Students and guardians, the keys in any order.
    const firstQuery = found.length;
    const learners = await announce('manager', message({ kind: 'academy', roleKeys: ['guardian', 'student'] }), 'academy');
    // Every active account that holds one of the two roles — enrolled anywhere or not; the holder of both ONCE.
    // Not the invited student, not the soft-deleted one, not the suspended guardian, not the linked user without
    // a role; no teacher, no staff.
    const expected = ['both', 'guardian', 'ofGhost', 'ofInvited', 'ofWithdrawn', 'outsider', 'student1', 'student2', 'student3', 'withdrawn'];
    const rows = await rowsOf(learners.id);
    expect(recipientsOf(rows)).toEqual(expected);
    expect(learners).toMatchObject({
      // Normalised: the fixed order of the keys.
      audience: { kind: 'academy', roleKeys: ['student', 'guardian'] },
      class: null,
      recipientCount: expected.length,
      sender: { id: id('manager') },
    });
    expect(Object.keys(learners.audience).sort()).toEqual(['kind', 'roleKeys']);
    for (const row of rows) {
      expect(row).toMatchObject({ eventKey: 'announcement', category: 'announcements', title: TITLE, body: BODY, announcementId: learners.id, studentUserId: null, emailStatus: 'none' });
      // No class: the link and the announcement only.
      expect(row.data).toEqual({ link: '/notifications', announcementId: learners.id });
    }
    expect(await prisma.announcement.findUniqueOrThrow({ where: { id: learners.id } })).toMatchObject({ classId: null, senderUserId: id('manager'), recipientCount: expected.length });
    // What the database itself answered, before the suite dropped the users of others: every eligible fixture user,
    // none of the ineligible ones, nobody twice.
    const answered = found[firstQuery]!;
    expect(new Set(answered).size).toBe(answered.length);
    expect(answered.filter((userId) => createdUserIds.includes(userId)).sort()).toEqual(ids(...expected));

    // The sender holds the `staff` role — the query finds them, the announcement leaves them out; the other holder is reached.
    const toStaff = await announce('manager', message({ kind: 'academy', roleKeys: ['staff'] }));
    expect(recipientsOf(await rowsOf(toStaff.id))).toEqual(['staff']);
    expect(toStaff.recipientCount).toBe(1);
    expect(found[firstQuery + 1]!).toEqual(expect.arrayContaining(ids('manager', 'staff')));
    // Two employee roles at once.
    const toEmployees = await announce('manager', message({ kind: 'academy', roleKeys: ['staff', 'teacher'] }));
    expect(toEmployees).toMatchObject({ audience: { kind: 'academy', roleKeys: ['teacher', 'staff'] }, recipientCount: 4 });
    expect(recipientsOf(await rowsOf(toEmployees.id))).toEqual(['assistant', 'staff', 'teacher', 'teacher2']);

    // All four roles: everybody above, once — a custom role is none of the four.
    const everyone = await announce('manager', message({ kind: 'academy', roleKeys: ['staff', 'teacher', 'guardian', 'student'] }));
    expect(recipientsOf(await rowsOf(everyone.id))).toEqual([...expected, 'assistant', 'staff', 'teacher', 'teacher2'].sort());
    expect(everyone.audience).toEqual({ kind: 'academy', roleKeys: ['student', 'guardian', 'teacher', 'staff'] });

    const after = await since(m);
    expect(after.announcements).toEqual([learners.id, toStaff.id, toEmployees.id, everyone.id]);
    expect(after.events.map((event) => [event.action, event.entityType, event.entityId, event.actorUserId])).toEqual(
      [learners.id, toStaff.id, toEmployees.id, everyone.id].map((announcementId) => ['notifications.announcement.sent', 'announcements', announcementId, id('manager')]),
    );
    expect(after.events[0]!.metadata).toEqual({ audience: { kind: 'academy', roleKeys: ['student', 'guardian'] }, recipients: expected.length });
    expect(after.events[2]!.metadata).toEqual({ audience: { kind: 'academy', roleKeys: ['teacher', 'staff'] }, recipients: 4 });
    expect(JSON.stringify(after.events)).not.toContain(TITLE_MARK);
    expect(JSON.stringify(after.events)).not.toContain(BODY_MARK);
  });

  it('`sendEmail` asks for an e-mail copy only where one is due: a confirmed address and the `announcements` category left on', { timeout: TEST_TIMEOUT }, async () => {
    const audience = toClass('A', { students: true, guardians: true });
    const statusByName = async (announcementId: string) => Object.fromEntries((await rowsOf(announcementId)).map((row) => [nameOf(row.recipientUserId), row.emailStatus]));

    // No transport (`MAIL_TRANSPORT=none`): what is due is `skipped` at once, the rest `none`.
    const skipped = await announce('teacher', message(audience, { sendEmail: true }), 'skipped');
    expect(skipped.sendEmail).toBe(true);
    expect(await statusByName(skipped.id)).toEqual({
      student1: 'skipped',
      student2: 'none', // an address nobody confirmed
      student3: 'none', // switched the `announcements` category off
      both: 'skipped', // the switch explicitly on
      guardian: 'skipped', // another category off changes nothing here
      ofInvited: 'skipped',
    });
    expect(mailbox.sent).toHaveLength(0);
    expect((await read('teacher', skipped.id).expect(200)).body).toMatchObject({ sendEmail: true, readCount: 0, email: { ...NO_EMAIL, none: 2, skipped: 4 } });

    // `sendEmail: false` says so explicitly: nothing is due for anybody.
    const silent = await announce('teacher', message(audience, { sendEmail: false }));
    expect(new Set(Object.values(await statusByName(silent.id)))).toEqual(new Set(['none']));
    expect((await read('teacher', silent.id).expect(200)).body).toMatchObject({ sendEmail: false, email: { ...NO_EMAIL, none: 6 } });

    // With a transport the due copies are queued inside the transaction and leave after the commit, through the
    // notification dispatcher: the title and a link — never the body.
    try {
      mailbox.name = 'recording';
      const mailed = await announce('teacher', message(toClass('A', { students: true }), { sendEmail: true }), 'mailed');
      await dispatcher.whenIdle();
      expect(await statusByName(mailed.id)).toEqual({ student1: 'sent', student2: 'none', student3: 'none', both: 'sent' });
      expect(mailbox.sent.map((mail) => mail.to).sort()).toEqual([email('both'), email('student1')].sort());
      const toStudent = mailbox.sent.find((mail) => mail.to === email('student1'))!;
      expect(toStudent).toMatchObject({ kind: 'notification', locale: 'en', subject: `New notification: ${TITLE}` });
      expect(toStudent.text).toContain('/notifications');
      for (const mail of mailbox.sent) {
        for (const part of [mail.subject, mail.text, mail.html]) {
          expect(part).not.toContain(BODY_MARK);
          expect(part).not.toContain('not bold');
        }
        // The title is text in the HTML copy too.
        expect(mail.html).toContain('&lt;to&gt; room 4 &amp;');
        expect(mail.html).not.toContain('<to>');
      }
      for (const row of (await rowsOf(mailed.id)).filter((sentRow) => sentRow.emailStatus === 'sent')) {
        expect(row.emailSentAt).toBeInstanceOf(Date);
        expect(row.emailMessageId).toMatch(/^rec-\d+$/);
      }
      expect((await read('teacher', mailed.id).expect(200)).body).toMatchObject({ recipientCount: 4, email: { ...NO_EMAIL, none: 2, sent: 2 } });
    } finally {
      mailbox.name = 'none';
    }
  });

  it('API-174 — a sender lists their own announcements, a holder of `classes.manage` all of them; newest first, keyset pages, the class filter', { timeout: TEST_TIMEOUT }, async () => {
    const sentBy = async (name: string) => (await prisma.announcement.findMany({ where: { senderUserId: id(name) }, orderBy: { id: 'desc' }, select: { id: true } })).map((row) => row.id);
    const idsOf = (res: { body: { items: Array<{ id: string }> } }) => res.body.items.map((item) => item.id);
    // The default page holds 20: the teacher needs more announcements than that for the default to show at all.
    for (let count = (await sentBy('teacher')).length; count <= 20; count += 1) await announce('teacher', message(toClass('A', { teachers: true })));
    const m = await mark();
    const mine = await sentBy('teacher');
    expect(mine.length).toBeGreaterThan(20);

    // Own announcements only, newest first, in the shape of API-173's answer.
    const first = await list('teacher', { limit: 100 }).expect(200);
    expect(idsOf(first)).toEqual(mine);
    expect(first.body.nextCursor).toBeNull();
    for (const item of first.body.items as AnnouncementBody[]) {
      expect(Object.keys(item).sort()).toEqual(ANNOUNCEMENT_KEYS);
      expect(item.sender).toEqual({ id: id('teacher'), fullName: 'Fixture teacher', displayName: 'Ustadh' });
    }
    expect((first.body.items as AnnouncementBody[]).find((item) => item.id === sent['first'])).toMatchObject({
      audience: { kind: 'class', classId: classes['A'], students: true, guardians: true, teachers: false },
      class: { id: classes['A'], code: code('A'), name: { ar: 'فصل A', en: 'Class A' } },
      title: TITLE,
      body: BODY,
      sendEmail: false,
      recipientCount: 6,
    });
    expect(idsOf(await list('assistant').expect(200))).toEqual(await sentBy('assistant'));
    expect(idsOf(await list('assistant').expect(200))).toEqual([sent['byAssistant']]);
    // A teacher who sent nothing has an empty list — not the announcements of the class next door.
    expect((await list('teacher2').expect(200)).body).toEqual({ items: [], nextCursor: null });

    // Keyset pages: no gap, no overlap, no cursor after the last row; the default page holds 20.
    const collected: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 50; page += 1) {
      const res = await list('teacher', { limit: 3, ...(cursor ? { cursor } : {}) }).expect(200);
      expect(res.body.items.length).toBeLessThanOrEqual(3);
      collected.push(...idsOf(res));
      cursor = res.body.nextCursor as string | null;
      if (!cursor) break;
      expect(res.body.items).toHaveLength(3);
      expect(cursor).toBe(collected.at(-1));
    }
    expect(collected).toEqual(mine);
    // Without `limit`: the newest 20, and a cursor because more follow.
    const defaultPage = await list('teacher').expect(200);
    expect(idsOf(defaultPage)).toEqual(mine.slice(0, 20));
    expect(defaultPage.body.nextCursor).toBe(mine[19]);
    // A cursor older than everything: an empty last page.
    expect((await list('teacher', { cursor: NIL_ID }).expect(200)).body).toEqual({ items: [], nextCursor: null });

    // The class filter.
    const toA = (await prisma.announcement.findMany({ where: { classId: classes['A'], senderUserId: id('teacher') }, orderBy: { id: 'desc' }, select: { id: true } })).map((row) => row.id);
    expect(idsOf(await list('teacher', { classId: classes['A']!, limit: 100 }).expect(200))).toEqual(toA);
    expect((await list('teacher', { classId: classes['B']! }).expect(200)).body).toEqual({ items: [], nextCursor: null });
    expect((await list('teacher', { classId: NIL_ID }).expect(200)).body).toEqual({ items: [], nextCursor: null });

    // With `classes.manage`: everybody's. Class by class the list is exact (nobody else announces to these classes).
    const everyoneToA = (await prisma.announcement.findMany({ where: { classId: classes['A'] }, orderBy: { id: 'desc' }, select: { id: true, senderUserId: true } }));
    const managerA = await list('manager', { classId: classes['A']!, limit: 100 }).expect(200);
    expect(idsOf(managerA)).toEqual(everyoneToA.map((row) => row.id));
    expect(new Set(everyoneToA.map((row) => nameOf(row.senderUserId!)))).toEqual(new Set(['teacher', 'assistant']));
    expect(idsOf(await list('manager', { classId: classes['B']! }).expect(200))).toEqual([sent['managerB']]);
    // Paged with the filter, too.
    const pageOne = await list('manager', { classId: classes['A']!, limit: 2 }).expect(200);
    expect(idsOf(pageOne)).toEqual(everyoneToA.slice(0, 2).map((row) => row.id));
    expect(pageOne.body.nextCursor).toBe(everyoneToA[1]!.id);
    expect(idsOf(await list('manager', { classId: classes['A']!, limit: 2, cursor: pageOne.body.nextCursor as string }).expect(200))).toEqual(everyoneToA.slice(2, 4).map((row) => row.id));
    // Without a filter: the whole academy's, newest first — this suite's announcements all among them, academy ones included.
    const ours = (await prisma.announcement.findMany({ where: { senderUserId: { in: actors } }, orderBy: { id: 'desc' }, select: { id: true } })).map((row) => row.id);
    const everything: string[] = [];
    cursor = null;
    for (let page = 0; page < 50 && everything.filter((announcementId) => ours.includes(announcementId)).length < ours.length; page += 1) {
      const res = await list('manager', { limit: 100, ...(cursor ? { cursor } : {}) }).expect(200);
      everything.push(...idsOf(res));
      cursor = res.body.nextCursor as string | null;
      if (!cursor) break;
    }
    expect(everything.filter((announcementId) => ours.includes(announcementId))).toEqual(ours);
    expect([...everything].sort().reverse()).toEqual(everything);
    expect(ours).toContain(sent['academy']);

    const refused: Array<Record<string, string | number>> = [{ limit: 0 }, { limit: 101 }, { limit: 'many' }, { cursor: 'not-a-cursor' }, { classId: 'not-a-uuid' }, { senderUserId: id('teacher') }, { order: 'asc' }];
    for (const query of refused) expect((await list('manager', query)).status, JSON.stringify(query)).toBe(400);
    // Listing records nothing.
    expect(await since(m)).toEqual(NOTHING);
  });

  it('API-175 — the sender reads their own announcement, a holder of `classes.manage` any; for everybody else it does not exist', { timeout: TEST_TIMEOUT }, async () => {
    const m = await mark();
    const announcementId = sent['first']!;
    const own = await read('teacher', announcementId).expect(200);
    expect(Object.keys(own.body).sort()).toEqual(DETAIL_KEYS);
    expect(own.body).toMatchObject({ id: announcementId, title: TITLE, body: BODY, recipientCount: 6, readCount: 2, email: { ...NO_EMAIL, none: 6 }, sender: { id: id('teacher') } });
    // The manager sent none of these.
    expect((await read('manager', announcementId).expect(200)).body).toEqual(own.body);
    expect((await read('manager', sent['byAssistant']!).expect(200)).body).toMatchObject({ sender: { id: id('assistant') }, recipientCount: 5 });
    expect((await read('manager', sent['academy']!).expect(200)).body).toMatchObject({ class: null, audience: { kind: 'academy', roleKeys: ['student', 'guardian'] }, readCount: 0 });
    // Counts only: no recipient, no address.
    expect(JSON.stringify(own.body)).not.toMatch(/@example\.test|recipientUserId|recipients"/);

    // Another teacher — even one of the same class, even one it was addressed to — gets the 404 of an unknown id.
    const hidden: Array<[string, string]> = [
      ['teacher2', announcementId],
      ['assistant', announcementId], // teaches class A, did not send it
      ['assistant', sent['teachers']!], // received it
      ['teacher', sent['byAssistant']!],
      ['teacher', sent['managerB']!],
      ['teacher', sent['academy']!],
      ['teacher', NIL_ID],
      ['manager', NIL_ID],
    ];
    for (const [as, target] of hidden) {
      const res = await read(as, target);
      expect(res.status, `${as} → ${target}`).toBe(404);
      expect(res.body).toMatchObject({ statusCode: 404, code: 'announcement_not_found', announcementId: target });
    }
    expect((await read('teacher', 'not-a-uuid')).status).toBe(400);
    expect(await since(m)).toEqual(NOTHING);
  });

  it('without `notifications.send` the three routes answer 403 — `classes.manage` alone opens nothing; signed out 401', { timeout: TEST_TIMEOUT }, async () => {
    const m = await mark();
    const valid = message(toClass('A', { students: true }));
    for (const as of ['clerk', 'student1', 'guardian']) {
      for (const res of [await post(as, valid), await post(as, message({ kind: 'academy', roleKeys: ['student'] })), await list(as), await read(as, sent['first']!), await read(as, NIL_ID)]) {
        expect(res.status, as).toBe(403);
        expect(res.body).toMatchObject({ statusCode: 403, code: 'permission_denied', missing: ['notifications.send'] });
      }
    }
    // The key is asked for before the body is read.
    expect((await post('clerk', { nonsense: true })).status).toBe(403);
    expect((await api().post(ANNOUNCEMENTS).send(valid)).status).toBe(401);
    expect((await api().get(ANNOUNCEMENTS)).status).toBe(401);
    expect((await api().get(`${ANNOUNCEMENTS}/${sent['first']}`)).status).toBe(401);
    expect(await since(m)).toEqual(NOTHING);
  });

  it('documents the three routes in OpenAPI under the notifications tag', async () => {
    const res = await api().get('/api/docs-json').expect(200);
    const paths = res.body.paths as Record<string, Record<string, { tags?: string[]; responses?: Record<string, unknown> }>>;
    const documented: Array<[string, string, string]> = [
      ['/api/announcements', 'post', '201'],
      ['/api/announcements', 'get', '200'],
      ['/api/announcements/{id}', 'get', '200'],
    ];
    for (const [path, method, status] of documented) {
      expect(paths[path]?.[method]?.tags, `${method.toUpperCase()} ${path}`).toEqual(['notifications']);
      expect(Object.keys(paths[path]![method]!.responses!), `${method.toUpperCase()} ${path}`).toContain(status);
    }
    expect(Object.keys(paths['/api/announcements']!['post']!.responses!)).toEqual(expect.arrayContaining(['201', '400', '401', '403', '404', '422']));
    const schemas = res.body.components.schemas as Record<string, { properties?: Record<string, { enum?: string[]; items?: { enum?: string[] } }>; required?: string[] }>;
    expect(Object.keys(schemas['AnnouncementDto']!.properties!).sort()).toEqual(ANNOUNCEMENT_KEYS);
    expect(Object.keys(schemas['AnnouncementDetailDto']!.properties!).sort()).toEqual(DETAIL_KEYS);
    expect(Object.keys(schemas['AnnouncementEmailCountsDto']!.properties!).sort()).toEqual(['failed', 'none', 'queued', 'sent', 'skipped']);
    expect(Object.keys(schemas['CreateAnnouncementDto']!.properties!).sort()).toEqual(['audience', 'body', 'sendEmail', 'title']);
    expect(schemas['CreateAnnouncementDto']!.required!.sort()).toEqual(['audience', 'body', 'title']);
    const audience = schemas['AnnouncementAudienceDto']!;
    expect(Object.keys(audience.properties!).sort()).toEqual(['classId', 'guardians', 'kind', 'roleKeys', 'students', 'teachers']);
    expect(audience.properties!['kind']!.enum).toEqual(['class', 'academy']);
    expect(audience.properties!['roleKeys']!.items!.enum).toEqual(['student', 'guardian', 'teacher', 'staff']);
  }, 20_000);
});
