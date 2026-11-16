// TEST-224 — the sender of an announcement in «my notifications» (API-167
// `GET /api/me/notifications`, API-169 `POST /api/me/notifications/:id/read`):
// `sender { fullName, displayName } | null`, names only, against the live
// development database. Skipped when no database is reachable.
//
// Fixture users (a teacher with the seeded `teacher` role — it holds
// `notifications.send` —, an announcer whose custom role holds
// `notifications.send` + `classes.manage`, and one student), one course, one
// class with one lesson carry a unique prefix and are deleted at the end. Both
// announcements go to that CLASS, whose only enrolled student is a fixture, so
// nobody else's inbox receives anything (the rule of TEST-178). The lesson is
// cancelled through API-097 to produce a real automatic notification
// (`lesson.cancelled`), which must carry no sender.
//
// The mail transport is a recording fake named `none` (what the e2e runs use):
// nothing is ever e-mailed.
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
import { PrismaClient } from '../src/generated/prisma/client.js';
import { MAIL_TRANSPORT } from '../src/mail/mail.transport.js';
import type { MailDeliveryResult, MailMessage, MailTransport } from '../src/mail/mail.transport.js';
import { NotificationDispatcher } from '../src/notifications/notifications.dispatcher.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `NS${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-224 supertest';
const INBOX = '/api/me/notifications';
const TEST_TIMEOUT = 30_000;
const SENDER_KEYS = ['displayName', 'fullName'];
/** A teacher's display name to tell the two names apart. */
const DISPLAY_NAME = `Ustadh ${RUN}`;

interface InboxItem {
  id: string;
  eventKey: string;
  category: string;
  announcementId: string | null;
  sender: { fullName: string; displayName: string | null } | null;
  [key: string]: unknown;
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

/** Records every message and answers "sent"; named `none`, so every e-mail copy is `skipped` and nothing is handed over. */
class RecordingTransport implements MailTransport {
  readonly name = 'none';
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<MailDeliveryResult> {
    this.sent.push(message);
    return { transport: this.name, status: 'sent', messageId: `rec-${this.sent.length}` };
  }
}

describe.skipIf(!available)('MOD-12 «my notifications» — the announcement sender (e2e, TEST-224)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let dispatcher: NotificationDispatcher;
  const mailbox = new RecordingTransport();
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  let classId = '';
  let courseId = '';
  let lessonId = '';
  /** Announcements by a name the later tests refer to. */
  const sent: Record<string, string> = {};

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name.toLowerCase()}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;

  /** The student's whole inbox (fixtures only reach it), newest first. */
  async function inbox(name: string, query: Record<string, string | number> = {}): Promise<InboxItem[]> {
    const res = await api().get(INBOX).query({ limit: 100, ...query }).set(bearer(name));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.items as InboxItem[];
  }
  async function itemOf(name: string, announcementId: string): Promise<InboxItem> {
    const item = (await inbox(name, { category: 'announcements' })).find((entry) => entry.announcementId === announcementId);
    expect(item, `the notification of announcement ${announcementId}`).toBeDefined();
    return item!;
  }
  async function announce(as: string, name: string): Promise<void> {
    const res = await api()
      .post('/api/announcements')
      .set(bearer(as))
      .send({ audience: { kind: 'class', classId, students: true }, title: `${name} ${RUN}`, body: `Body of ${name}` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    sent[name] = res.body.id as string;
  }

  async function createUser(name: string, roleIds: string[], displayName: string | null = null): Promise<void> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Fixture ${name}`,
        displayName,
        status: 'active',
        passwordHash: await new PasswordService().hash(PASSWORD),
        emailVerifiedAt: new Date(),
        roles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
      select: { id: true },
    });
    fx[name] = user.id;
    createdUserIds.push(user.id);
    const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(name), password: PASSWORD }).expect(200);
    tokens[name] = res.body.accessToken as string;
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

    const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
    const teacher = await systemRole('teacher');
    const student = await systemRole('student');
    const teacherKeys = (await prisma.rolePermission.findMany({ where: { roleId: teacher, permissionKey: { in: ['notifications.send', 'lessons.manage'] } }, select: { permissionKey: true } }))
      .map((row) => row.permissionKey)
      .sort();
    expect(teacherKeys, 'the seeded `teacher` role must hold notifications.send and lessons.manage').toEqual(['lessons.manage', 'notifications.send']);
    const announcer = await prisma.role.create({
      data: {
        key: `test_announcer_${RUN.toLowerCase()}`,
        label: { ar: 'دور اختبار المرسل' },
        permissions: { create: ['notifications.send', 'classes.manage'].map((permissionKey) => ({ permissionKey })) },
      },
      select: { id: true },
    });
    createdRoleIds.push(announcer.id);

    await createUser('teacher', [teacher], DISPLAY_NAME);
    await createUser('announcer', [announcer.id]); // no display name; teaches nothing, so the account can go for good
    await createUser('student', [student]);

    courseId = (await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة المرسل' }, status: 'published' }, select: { id: true } })).id;
    classId = (
      await prisma.class.create({
        data: { courseId, code: code('A'), name: { ar: 'فصل المرسل' }, capacity: 10, status: 'running', teachers: { create: [{ teacherUserId: id('teacher'), role: 'lead' }] } },
        select: { id: true },
      })
    ).id;
    await prisma.enrollment.create({ data: { classId, studentUserId: id('student'), status: 'active' }, select: { id: true } });
    const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    lessonId = (
      await prisma.lesson.create({
        data: { classId, title: { ar: 'درس المرسل', en: 'Sender lesson' }, startsAt, endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000), teacherUserId: id('teacher'), createdById: id('teacher') },
        select: { id: true },
      })
    ).id;
  }, 120_000);

  afterAll(async () => {
    try {
      if (dispatcher) await dispatcher.whenIdle();
      if (prisma) {
        // An announcement outlives its sender (SET NULL): delete the class's announcements first — their notifications go with them.
        if (classId) await prisma.announcement.deleteMany({ where: { OR: [{ classId }, { senderUserId: { in: createdUserIds } }] } });
        if (classId) await prisma.enrollment.deleteMany({ where: { classId } });
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
      }
    } finally {
      if (prisma && createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (prisma && createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('AC1 — a class announcement names its sender in the recipient’s inbox and in the read mark: full and display name, nothing else', { timeout: TEST_TIMEOUT }, async () => {
    await announce('teacher', 'first');
    const item = await itemOf('student', sent['first']!);
    expect(item).toMatchObject({ eventKey: 'announcement', category: 'announcements', announcementId: sent['first'] });
    expect(item.sender).toEqual({ fullName: 'Fixture teacher', displayName: DISPLAY_NAME });
    expect(Object.keys(item.sender!).sort()).toEqual(SENDER_KEYS);
    // Names only: never the sender's id or address anywhere in the item.
    const text = JSON.stringify(item);
    expect(text).not.toContain(id('teacher'));
    expect(text).not.toContain(email('teacher'));

    const marked = await api().post(`${INBOX}/${item.id}/read`).set(bearer('student')).expect(200);
    expect(marked.body.sender).toEqual({ fullName: 'Fixture teacher', displayName: DISPLAY_NAME });
  });

  it('AC2 — a sender without a display name reads displayName null; a soft-deleted sender is still named', { timeout: TEST_TIMEOUT }, async () => {
    await announce('announcer', 'second');
    expect((await itemOf('student', sent['second']!)).sender).toEqual({ fullName: 'Fixture announcer', displayName: null });

    // Soft delete (what DELETE /api/users/:id leaves behind): the account row stays, so does the name — as for a teacher or a reviewer elsewhere.
    await prisma.user.update({ where: { id: id('announcer') }, data: { deletedAt: new Date(), status: 'archived' }, select: { id: true } });
    expect((await itemOf('student', sent['second']!)).sender).toEqual({ fullName: 'Fixture announcer', displayName: null });
  });

  it('AC3 — when the sender account is gone (sender_user_id SET NULL) the announcement keeps no sender: null', { timeout: TEST_TIMEOUT }, async () => {
    await prisma.user.delete({ where: { id: id('announcer') }, select: { id: true } });
    const row = await prisma.announcement.findUniqueOrThrow({ where: { id: sent['second']! }, select: { senderUserId: true } });
    expect(row.senderUserId).toBeNull();
    const item = await itemOf('student', sent['second']!);
    expect(item.sender).toBeNull();
    // The teacher's announcement next to it is untouched.
    expect((await itemOf('student', sent['first']!)).sender).toEqual({ fullName: 'Fixture teacher', displayName: DISPLAY_NAME });
  });

  it('AC4 — an automatic notification (a lesson cancelled through API-097) has sender null', { timeout: TEST_TIMEOUT }, async () => {
    const res = await api().post(`/api/lessons/${lessonId}/status`).set(bearer('teacher')).send({ action: 'cancel', reason: `Reason ${RUN}` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = await inbox('student');
    const automatic = items.filter((item) => item.announcementId === null);
    expect(automatic.map((item) => item.eventKey)).toEqual(['lesson.cancelled']);
    expect(automatic[0]!.sender).toBeNull();
    expect(automatic[0]!.category).toBe('lessons');
    // Every item of the page carries the key, set or null.
    for (const item of items) expect(item).toHaveProperty('sender');
    expect(items.filter((item) => item.sender !== null).map((item) => item.announcementId)).toEqual([sent['first']]);
  });

  it(
    'AC5 — the OpenAPI document gives MyNotificationDto a nullable sender with the two name fields',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      const schemas = docs.body.components.schemas as Record<string, { properties: Record<string, Record<string, unknown>> }>;
      expect(schemas['MyNotificationDto']!.properties).toHaveProperty('sender');
      expect(Object.keys(schemas['NotificationSenderDto']!.properties).sort()).toEqual(SENDER_KEYS);
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
