// TEST-261 — MOD-20 LRN-T06 «new lessons» notification (roadmap §4q, D-R146):
// an API-227 write (`PUT /api/courses/:id/curriculum`) that makes lessons
// newly published — created published, or switched from unpublished to
// published — tells every `open` or `running` class of the course ONCE
// (`curriculum.lessons_published`, category `lessons`, link `/my-school`):
// the active students of the class and their guardians holding the `guardian`
// role (the MOD-12 `notifyClass()` rule), a guardian of two children in one
// class getting one row naming both. Nothing for a planned or completed class,
// a withdrawn student, a linked user without the `guardian` role, another
// course's class, a write that publishes nothing (a rename, a move, an
// unpublish, a draft, a level's release day), an identical write, a refused
// write, or the content write API-228. The audit trail stays exactly one
// `courses.curriculum.changed` per effective write.
//
// The e2e configuration forces MAIL_TRANSPORT=none: nothing is e-mailed, a
// recipient with a confirmed address gets `skipped` and one without it `none`.
// Skipped when no database is reachable. Fixtures carry a unique prefix and are
// deleted at the end — the notifications of the fixture users first, then the
// guardian links, the enrollments (they restrict their class), the classes,
// the courses, the users and the role. Other suites share this database, so
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
import type { ClassStatus, EnrollmentStatus, Prisma } from '../src/generated/prisma/client.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import type { NotificationBatch } from '../src/notifications/notifications.service.js';
import { childrenSuffix, renderNotification } from '../src/notifications/notifications.templates.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `W${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-261 supertest';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const EVENT_KEY = 'curriculum.lessons_published';
const LINK = '/my-school';
const COURSE_NAME = { ar: 'دورة مدرستي', en: 'My School course' };
/** The names a guardian's copy mentions the children by: the display name, else the full name. */
const CHILD_NAMES: Record<string, string> = { student1: 'Sami', student2: 'Fixture student2', student3: 'Fixture student3' };

type Row = Prisma.NotificationGetPayload<object>;
type AuditRow = Prisma.AuditLogGetPayload<object>;

interface Observed {
  res: request.Response;
  rows: Row[];
  events: AuditRow[];
  batches: NotificationBatch[];
}

interface ItemView {
  id: string;
  title: { ar: string; en?: string };
  description: { ar: string } | null;
  estimatedMinutes: number | null;
  isRequired: boolean;
  isPublished: boolean;
}
interface SectionView {
  id: string;
  title: { ar: string } | null;
  description: { ar: string } | null;
  releaseAfterDays: number | null;
  items: ItemView[];
}
interface CurriculumView {
  sections: SectionView[];
  looseItems: ItemView[];
}

interface UserOptions {
  roles?: string[];
  locale?: 'ar' | 'en';
  verified?: boolean;
  signsIn?: boolean;
  displayName?: string;
}

const lesson = (ar: string, overrides: Record<string, unknown> = {}) => ({ title: { ar }, isRequired: true, isPublished: true, ...overrides });
const keep = (item: ItemView, overrides: Record<string, unknown> = {}) => ({
  id: item.id,
  title: item.title,
  description: item.description,
  estimatedMinutes: item.estimatedMinutes,
  isRequired: item.isRequired,
  isPublished: item.isPublished,
  ...overrides,
});
const bodyOf = (view: CurriculumView) => ({
  sections: view.sections.map((section) => ({
    id: section.id,
    title: section.title,
    description: section.description,
    releaseAfterDays: section.releaseAfterDays,
    items: section.items.map((item) => keep(item)),
  })),
  looseItems: view.looseItems.map((item) => keep(item)),
});

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

describe.skipIf(!available)('MOD-20 «new lessons» notification of the curriculum writer (e2e, TEST-261)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let defaultLocale: LocaleCode;
  let courseId: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const classes: Record<string, string> = {};
  const actors: string[] = [];
  const handedOver: NotificationBatch[] = [];

  const email = (name: string) => `${name.toLowerCase()}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  const path = () => `/api/courses/${courseId}/curriculum`;
  const read = async () => (await api().get(path()).set(bearer('manager')).expect(200)).body as CurriculumView;
  const put = (body: unknown) => api().put(path()).set(bearer('manager')).send(body as object);

  async function newestNotification(): Promise<string> {
    return (await prisma.notification.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;
  }
  async function newestAuditEvent(): Promise<string> {
    return (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;
  }
  async function observe(send: () => PromiseLike<request.Response>): Promise<Observed> {
    const notificationMark = await newestNotification();
    const auditMark = await newestAuditEvent();
    handedOver.length = 0;
    const res = await send();
    const rows = await prisma.notification.findMany({ where: { id: { gt: notificationMark }, recipientUserId: { in: createdUserIds } }, orderBy: { id: 'asc' } });
    const events = await prisma.auditLog.findMany({ where: { id: { gt: auditMark }, actorUserId: { in: actors } }, orderBy: { id: 'asc' } });
    return { res, rows, events, batches: [...handedOver] };
  }

  const nameOf = (userId: string) => Object.keys(fx).find((name) => fx[name] === userId) ?? userId;
  const recipientsOf = (rows: Row[]) => rows.map((row) => nameOf(row.recipientUserId)).sort();
  /** The children of the guardian in a class, in the order of their ids — the order a class event names them in. */
  const byId = (names: string[]) => [...names].sort((a, b) => (id(a) < id(b) ? -1 : 1));

  function worded(count: number, locale: 'ar' | 'en', childNames: readonly string[] = []): { title: string; body: string } {
    const rendered = renderNotification(EVENT_KEY, { courseId, courseName: COURSE_NAME, count }, locale, defaultLocale);
    const suffix = childrenSuffix(childNames, locale);
    return { title: rendered.title, body: suffix ? `${rendered.body} ${suffix}` : rendered.body };
  }

  /** The rows of one publishing write: the five recipients of the open and the running class, each worded for `count`. */
  function expectPublished(seen: Observed, count: number): void {
    expect(seen.res.status, JSON.stringify(seen.res.body)).toBe(200);
    expect(seen.events.map((event) => [event.action, event.entityType, event.entityId, event.actorUserId])).toEqual([['courses.curriculum.changed', 'courses', courseId, id('manager')]]);
    // The open class: two active students and their guardian (one row naming both); the running class: its student and the
    // same guardian again — never the planned or completed class, the withdrawn student, the linked user without the
    // `guardian` role, the student of another course, or the manager.
    expect(recipientsOf(seen.rows)).toEqual(['guardian', 'guardian', 'student1', 'student2', 'student3']);
    expect(seen.batches).toEqual([{ created: 5, queuedIds: [] }]);
    for (const row of seen.rows) {
      expect(row).toMatchObject({ eventKey: EVENT_KEY, category: 'lessons', readAt: null, announcementId: null, emailSentAt: null });
      expect((row.data as { link?: string; courseId?: string }).link).toBe(LINK);
      expect((row.data as { courseId?: string }).courseId).toBe(courseId);
    }
    const only = (name: string) => {
      const mine = seen.rows.filter((row) => row.recipientUserId === id(name));
      expect(mine, name).toHaveLength(1);
      return mine[0]!;
    };
    expect(only('student1')).toMatchObject({ ...worded(count, 'en'), studentUserId: id('student1'), emailStatus: 'skipped', data: { link: LINK, courseId } });
    expect(only('student2')).toMatchObject({ ...worded(count, 'ar'), studentUserId: id('student2'), emailStatus: 'none', data: { link: LINK, courseId } });
    expect(only('student3')).toMatchObject({ ...worded(count, 'ar'), studentUserId: id('student3'), data: { link: LINK, courseId } });
    const guardianRows = seen.rows.filter((row) => row.recipientUserId === id('guardian'));
    const both = byId(['student1', 'student2']);
    const ofOpen = guardianRows.find((row) => row.studentUserId === null)!;
    expect(ofOpen).toMatchObject({ ...worded(count, 'ar', both.map((name) => CHILD_NAMES[name]!)), data: { link: LINK, courseId, studentIds: both.map(id) } });
    const ofRunning = guardianRows.find((row) => row.studentUserId === id('student3'))!;
    expect(ofRunning).toMatchObject({ ...worded(count, 'ar', [CHILD_NAMES['student3']!]), data: { link: LINK, courseId } });
  }

  /** A write that went through and tells nobody: the hand-overs, if any, carry nothing. */
  function expectSilent(seen: Observed, label: string): void {
    expect(seen.rows, label).toEqual([]);
    expect(seen.batches.filter((batch) => batch.created > 0 || batch.queuedIds.length > 0), label).toEqual([]);
  }

  async function createUser(name: string, options: UserOptions = {}): Promise<void> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Fixture ${name}`,
        displayName: options.displayName ?? null,
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

  async function createClass(key: string, ofCourse: string, status: ClassStatus): Promise<void> {
    const klass = await prisma.class.create({ data: { courseId: ofCourse, code: `${PREFIX}-${key}`, name: { ar: `فصل ${key}` }, capacity: 20, status }, select: { id: true } });
    classes[key] = klass.id;
  }

  async function enroll(student: string, classKey: string, status: EnrollmentStatus = 'active'): Promise<void> {
    await prisma.enrollment.create({
      data: { classId: classes[classKey]!, studentUserId: id(student), status, activatedAt: new Date(), ...(status === 'withdrawn' ? { withdrawnAt: new Date() } : {}) },
      select: { id: true },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    const engine = app.get(NotificationsService);
    const dispatch = engine.dispatch.bind(engine);
    vi.spyOn(engine, 'dispatch').mockImplementation((batch) => {
      handedOver.push(batch);
      dispatch(batch);
    });
    defaultLocale = (await prisma.academy.findFirstOrThrow({ select: { defaultLocale: true } })).defaultLocale;

    const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
    const studentRole = await systemRole('student');
    const guardianRole = await systemRole('guardian');
    const manager = await prisma.role.create({
      data: { key: `test_w_manager_${RUN.toLowerCase()}`, label: { ar: 'دور اختبار المنهج' }, permissions: { create: ['courses.read', 'courses.manage'].map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(manager.id);
    await createUser('manager', { roles: [manager.id], signsIn: true });
    await createUser('student1', { roles: [studentRole], locale: 'en', displayName: CHILD_NAMES['student1']! });
    // Nobody confirmed this student's address: notified in the app, never by e-mail.
    await createUser('student2', { roles: [studentRole], verified: false });
    await createUser('student3', { roles: [studentRole] });
    for (const name of ['planned', 'finished', 'withdrawn', 'elsewhere']) await createUser(name, { roles: [studentRole] });
    await createUser('guardian', { roles: [guardianRole] });
    // Linked to a student without holding the `guardian` role: links alone grant nothing (D-R81).
    await createUser('linked', { locale: 'en' });
    for (const [guardianName, studentName] of [
      ['guardian', 'student1'],
      ['guardian', 'student2'],
      ['guardian', 'student3'],
      ['guardian', 'planned'],
      ['guardian', 'finished'],
      ['linked', 'student1'],
    ] as const) {
      await prisma.guardianStudent.create({ data: { guardianUserId: id(guardianName), studentUserId: id(studentName), relationship: 'father' }, select: { studentUserId: true } });
    }

    courseId = (await prisma.course.create({ data: { code: `${PREFIX}-CRS`, name: COURSE_NAME, status: 'published' }, select: { id: true } })).id;
    const otherCourseId = (await prisma.course.create({ data: { code: `${PREFIX}-OTH`, name: { ar: 'دورة أخرى' }, status: 'published' }, select: { id: true } })).id;
    await createClass('OPEN', courseId, 'open');
    await createClass('RUN', courseId, 'running');
    await createClass('PLAN', courseId, 'planned');
    await createClass('DONE', courseId, 'completed');
    await createClass('OTHER', otherCourseId, 'open');
    await enroll('student1', 'OPEN');
    await enroll('student2', 'OPEN');
    await enroll('withdrawn', 'OPEN', 'withdrawn');
    await enroll('student3', 'RUN');
    await enroll('planned', 'PLAN');
    // An active enrollment in a completed class: the class's status decides, not the enrollment's.
    await enroll('finished', 'DONE');
    await enroll('elsewhere', 'OTHER');
  }, 120_000);

  afterAll(async () => {
    try {
      if (prisma) {
        if (createdUserIds.length > 0) {
          await prisma.notification.deleteMany({ where: { recipientUserId: { in: createdUserIds } } });
          await prisma.guardianStudent.deleteMany({ where: { OR: [{ guardianUserId: { in: createdUserIds } }, { studentUserId: { in: createdUserIds } }] } });
        }
        if (Object.keys(classes).length > 0) await prisma.enrollment.deleteMany({ where: { classId: { in: Object.values(classes) } } });
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
      }
    } finally {
      if (prisma && createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (prisma && createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      vi.restoreAllMocks();
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('publishing two lessons in one PUT writes ONE notification per recipient of each open or running class of the course', async () => {
    const seen = await observe(() =>
      put({ sections: [{ title: { ar: 'المستوى الأول' }, items: [lesson('أ'), lesson('ب'), lesson('مسودة', { isPublished: false })] }], looseItems: [] }),
    );
    expectPublished(seen, 2);
    const student1 = seen.rows.find((row) => row.recipientUserId === id('student1'))!;
    expect(student1.title).toBe('New lessons in My School course');
    expect(student1.body).toContain('2 new lessons');
    const student2 = seen.rows.find((row) => row.recipientUserId === id('student2'))!;
    expect(student2.title).toBe('دروس جديدة في دورة مدرستي');
    expect(student2.body).toContain('درسان جديدان');
  });

  it('a write that publishes nothing tells nobody: rename, move, unpublish, a new draft, a release day; an identical write; a refused write; the content write API-228', async () => {
    const view = await read();
    const [a, b, draft] = view.sections[0]!.items as [ItemView, ItemView, ItemView];

    const quiet = await observe(() =>
      put({
        sections: [
          { id: view.sections[0]!.id, title: view.sections[0]!.title, releaseAfterDays: 7, items: [keep(b, { isPublished: false }), keep(a, { title: { ar: 'أ معدل' } })] },
          { items: [keep(draft), lesson('مسودة ثانية', { isPublished: false })] },
        ],
      }),
    );
    expect(quiet.res.status, JSON.stringify(quiet.res.body)).toBe(200);
    expect(quiet.events.map((event) => event.action)).toEqual(['courses.curriculum.changed']);
    expectSilent(quiet, 'publishes nothing');

    const after = quiet.res.body as CurriculumView;
    const same = await observe(() => put(bodyOf(after)));
    expect(same.res.status).toBe(200);
    expect(same.events).toEqual([]);
    expectSilent(same, 'identical');

    const refused = await observe(() => put({ sections: [{ id: after.sections[0]!.id, releaseAfterDays: 366, items: [] }] }));
    expect(refused.res.status).toBe(400);
    expect(refused.events).toEqual([]);
    expect(refused.rows).toEqual([]);
    expect(refused.batches).toEqual([]);

    const published = after.sections[0]!.items.find((item) => item.isPublished)!;
    const content = await observe(() =>
      api()
        .put(`${path()}/items/${published.id}/content`)
        .set(bearer('manager'))
        .send({ kind: 'text', content: { body: { ar: 'نص الدرس' } }, resources: [] }),
    );
    expect(content.res.status, JSON.stringify(content.res.body)).toBe(200);
    expect(content.events.map((event) => event.action)).toEqual(['courses.curriculum.content.changed']);
    expect(content.rows).toEqual([]);
    expect(content.batches).toEqual([]);
  });

  it('switching unpublished lessons to published counts them — one lesson is worded in the singular', async () => {
    const view = await read();
    const body = bodyOf(view);
    // The level's first lesson (B, unpublished in the previous test) goes back to published: one lesson newly published.
    const first = body.sections[0]!.items[0]!;
    expect(first.isPublished).toBe(false);
    first.isPublished = true;
    const seen = await observe(() => put(body));
    expectPublished(seen, 1);
    const student1 = seen.rows.find((row) => row.recipientUserId === id('student1'))!;
    expect(student1).toMatchObject({ title: 'New lesson in My School course', body: 'A new lesson was published in the course “My School course”. Open “My School” to continue learning.' });
    expect(seen.rows.find((row) => row.recipientUserId === id('student2'))!.title).toBe('درس جديد في دورة مدرستي');

    // The two drafts of the second level and a new published lesson in one write: three lessons.
    const next = bodyOf(seen.res.body as CurriculumView);
    for (const item of next.sections[1]!.items) item.isPublished = true;
    const three = await observe(() => put({ ...next, looseItems: [...next.looseItems, lesson('حر', { isRequired: false })] }));
    expectPublished(three, 3);
    expect(three.rows.find((row) => row.recipientUserId === id('student2'))!.body).toContain('3 دروس جديدة');
  });
});
