// TEST-176 — MOD-12-T03 (final grades and certificates): the three student
// events of the grades and certificates writers — `grades.finalized`
// (API-127), `certificate.issued` (API-132) and `certificate.revoked`
// (API-133) — written through the real routes against the live development
// database and read back from `notifications`. Skipped when no database is
// reachable. Fixture users (a manager with a custom role, a teacher with the
// system `teacher` role, an issuer with `certificates.issue` alone, a revoker
// with `certificates.revoke` alone, a class manager without any grades or
// certificates key; four students with the system role, a guardian with the
// system role linked to two of them and a user linked to the first one
// without that role), roles, a course, a class with its exam and results
// (through the API) and a non-default grade scheme (through Prisma) carry a
// unique prefix and are deleted at the end — certificates first; deleting the
// users removes their notifications. `MAIL_TRANSPORT=none` in e2e: a confirmed
// address is `skipped`, an unconfirmed one `none`, nothing is ever sent — so
// the hand-over to `dispatch()` is watched instead (once per effective write,
// after the commit, never after a refusal). Notifications are found above an
// id watermark and by fixture recipient (the database is shared), audit events
// by fixture actor. Advances the development database's certificate serial
// counter like TEST-135.
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
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import type { NotificationEventParams } from '../src/notifications/notifications.events.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import type { NotificationBatch } from '../src/notifications/notifications.service.js';
import { renderNotification } from '../src/notifications/notifications.templates.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `NG${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-176 supertest';
const CLASSES = '/api/classes';
const EXAMS = '/api/exams';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const CLASS_CODE = `${PREFIX}-A`;
const CLASS_NAME: LocalizedText = { ar: 'فصل إشعار الدرجات', en: 'Graded class' };
const COURSE_NAME: LocalizedText = { ar: 'دورة إشعار الشهادات', en: 'Certified course' };
/** What the course is called after its certificates were issued — no notification may say it. */
const RENAMED: LocalizedText = { ar: 'دورة بعد إعادة التسمية', en: 'Renamed course' };
/** Recognisable texts that must never reach a notification: the revocation reason and every staff name. */
const REASON = `REVOKE-REASON-${RUN}`;
const STAFF_MARK = `STAFF-${RUN}`;

interface Band {
  label: LocalizedText;
  letter: string | null;
}
const FAIL: Band = { label: { ar: 'راسب', en: 'Fail' }, letter: 'F' };
const PASS: Band = { label: { ar: 'ناجح', en: 'Pass' }, letter: 'P' };
/** A band without a letter: the notification then words the label alone. */
const TOP: Band = { label: { ar: 'ممتاز', en: 'Excellent' }, letter: null };

/** The three events of this slice and the page each one links to. */
type SliceKey = 'grades.finalized' | 'certificate.issued' | 'certificate.revoked';
const LINKS: Record<SliceKey, string> = { 'grades.finalized': '/my-grades', 'certificate.issued': '/my-certificates', 'certificate.revoked': '/my-certificates' };
const SLICE_KEYS: readonly string[] = Object.keys(LINKS);

/** The language each possible recipient reads, set explicitly so the wording is predictable. */
const READS: Record<string, 'ar' | 'en'> = { s1: 'en', s2: 'ar', s3: 'ar', s4: 'en', guardian: 'ar', norole: 'en' };
/** How a guardian's copy names the child: the display name, else the full name. */
const CHILD_NAMES: Record<string, string> = { s1: 'Salma', s2: 'Fixture s2' };

type Row = Prisma.NotificationGetPayload<object>;

/**
 * One call of `dispatch()` by a writer: how many notifications its batch
 * counts, how many e-mails it queued (none without a transport), and how many
 * of the request's notifications another connection saw at that very moment —
 * all of them only if the writer's transaction had already committed.
 */
interface HandOver {
  created: number;
  queued: number;
  committed: number;
}

interface GradebookBody {
  students: { student: { id: string }; final: { percent: number; letter: string | null; isPass: boolean } | null }[];
}
interface CertificateBody {
  id: string;
  serial: string;
  status: string;
  student: { id: string };
}
interface IssueBody {
  issued: CertificateBody[];
  skipped: { enrollmentId: string; studentId: string; reason: string }[];
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

describe.skipIf(!available)('MOD-12 notifications of final grades and certificates (e2e, TEST-176)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let defaultLocale: LocaleCode;
  let courseId: string;
  let schemeId: string;
  let classId = '';
  let examId: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const actors: string[] = [];
  const certificates: Record<string, CertificateBody> = {};
  /** What the writers handed to `dispatch()` since the request under test began. */
  const handedOver: Array<{ batch: NotificationBatch; committed: Promise<number> }> = [];
  let observedFrom = NIL_ID;

  const email =(name: string) => `${name.toLowerCase()}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  const staffName = (name: string) => `${STAFF_MARK} ${name}`;

  // The four writes of this slice.
  const finalize = (target: string, as = 'teacher') => api().post(`${CLASSES}/${target}/final-grades`).set(bearer(as)).send({ schemeId });
  const withdraw = (target: string, as = 'teacher') => api().delete(`${CLASSES}/${target}/final-grades`).set(bearer(as));
  const issue = (target: string, as = 'issuer') => api().post(`${CLASSES}/${target}/certificates`).set(bearer(as)).send({});
  const revoke = (certificateId: string, body: object, as = 'revoker') => api().post(`/api/certificates/${certificateId}/revoke`).set(bearer(as)).send(body);

  const finalGrade = (percent: string, band: Band): NotificationEventParams['grades.finalized'] => ({ classId, className: CLASS_NAME, percent, bandLabel: band.label, bandLetter: band.letter });
  const certified = (certificate: CertificateBody): NotificationEventParams['certificate.issued'] => ({ certificateId: certificate.id, serial: certificate.serial, courseName: COURSE_NAME });

  async function createRole(name: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_${name}_${RUN.toLowerCase()}`, label: { ar: `دور اختبار ${name}` }, permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  /** A member of staff: signs in, acts, and carries a recognisable name no notification may contain. */
  async function createStaff(name: string, roleIds: string[]): Promise<void> {
    const user = await prisma.user.create({
      data: { email: email(name), fullName: staffName(name), locale: 'en', passwordHash: await passwords.hash(PASSWORD), status: 'active', emailVerifiedAt: new Date(), roles: { create: roleIds.map((roleId) => ({ roleId })) } },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    actors.push(user.id);
    const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(name), password: PASSWORD }).expect(200);
    tokens[name] = res.body.accessToken as string;
  }

  /** A possible recipient: never signs in here — the routes under test are the staff's. */
  async function createRecipient(name: string, roleIds: string[], options: { displayName?: string; verified?: boolean } = {}): Promise<void> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Fixture ${name}`,
        displayName: options.displayName ?? null,
        locale: READS[name]!,
        status: 'active',
        emailVerifiedAt: options.verified === false ? null : new Date(),
        roles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
  }

  /** The newest notification id in the table: rows written after it belong to the request under test. */
  async function watermark(): Promise<string> {
    return (await prisma.notification.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;
  }
  const since = (mark: string) => prisma.notification.findMany({ where: { id: { gt: mark }, recipientUserId: { in: createdUserIds } }, orderBy: { id: 'asc' } });

  /** Sends one request and returns it with the notifications it wrote for any fixture user and what it handed to `dispatch()`. */
  async function observe(send: () => PromiseLike<request.Response>): Promise<{ res: request.Response; rows: Row[]; handOvers: HandOver[] }> {
    const mark = await watermark();
    observedFrom = mark;
    handedOver.length = 0;
    const res = await send();
    const rows = await since(mark);
    const handOvers = await Promise.all(handedOver.map(async ({ batch, committed }) => ({ created: batch.created, queued: batch.queuedIds.length, committed: await committed })));
    return { res, rows, handOvers };
  }

  /** A request that must notify nobody: a refusal, or a write without a difference. */
  async function silent(send: () => PromiseLike<request.Response>): Promise<request.Response> {
    const { res, rows, handOvers } = await observe(send);
    const after = `after ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`;
    expect(rows.map((row) => `${row.eventKey} to ${row.recipientUserId}`), after).toEqual([]);
    // Nothing reaches the e-mail queue either: no hand-over at all after a refusal, at most an empty one after a write without a difference.
    if (res.status >= 400) expect(handOvers, after).toEqual([]);
    else expect(handOvers.filter((entry) => entry.created > 0 || entry.queued > 0), after).toEqual([]);
    return res;
  }

  async function auditMark(): Promise<string> {
    return (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;
  }
  const eventsSince = (mark: string) => prisma.auditLog.findMany({ where: { id: { gt: mark }, actorUserId: { in: actors } }, orderBy: { id: 'asc' } });

  /** The fixture users who hold at least one of these rows, by name. */
  const recipientsOf = (rows: Row[]) =>
    Object.keys(fx)
      .filter((name) => rows.some((row) => row.recipientUserId === fx[name]))
      .sort();
  const textOf = (row: Row) => `${row.title}\n${row.body}\n${JSON.stringify(row.data)}`;

  /**
   * Exactly one notification for `recipient` about `student`, worded from
   * `params` in the recipient's language, with the link and the ids alone in
   * `data`. A guardian's copy is the same sentence followed by the child.
   */
  function expectNotice<K extends SliceKey>(rows: Row[], recipient: string, student: string, key: K, params: NotificationEventParams[K], ids: Record<string, string>): Row {
    const found = rows.filter((row) => row.recipientUserId === id(recipient) && row.studentUserId === id(student));
    expect(found.map((row) => row.eventKey), `${key} for ${recipient} about ${student}`).toEqual([key]);
    const row = found[0]!;
    const worded = renderNotification(key, params, READS[recipient]!, defaultLocale);
    expect(row).toMatchObject({ category: 'grades', title: worded.title, readAt: null, announcementId: null });
    expect(row.data).toEqual({ link: LINKS[key], ...ids });
    if (recipient === student) {
      expect(row.body).toBe(worded.body);
    } else {
      expect(row.body.startsWith(`${worded.body} `), row.body).toBe(true);
      expect(row.body.slice(worded.body.length)).toContain(CHILD_NAMES[student]!);
    }
    return row;
  }

  /** The status and the stable error code of an answer. */
  const verdict = (res: request.Response) => [res.status, (res.body as { code?: string }).code ?? null];

  async function classAction(action: string): Promise<void> {
    await api().post(`${CLASSES}/${classId}/status`).set(bearer('manager')).send({ action }).expect(200);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    defaultLocale = (await prisma.academy.findFirst({ select: { defaultLocale: true } }))?.defaultLocale ?? 'ar';

    // ADR-071: a writer hands its batch to `dispatch()` only after its transaction has committed. Without a transport
    // nothing is ever queued, so the hand-over itself is watched: at that very moment another connection — this
    // suite's own — must already see the notifications the batch counts. The real `dispatch()` still runs.
    const engine = app.get(NotificationsService);
    const dispatch = engine.dispatch.bind(engine);
    vi.spyOn(engine, 'dispatch').mockImplementation((batch) => {
      const committed = prisma.notification.count({ where: { id: { gt: observedFrom }, recipientUserId: { in: createdUserIds } } }).then(
        (count) => count,
        () => -1,
      );
      handedOver.push({ batch, committed });
      dispatch(batch);
    });

    courseId = (await prisma.course.create({ data: { code: `${PREFIX}-CRS`, name: COURSE_NAME, status: 'published' }, select: { id: true } })).id;
    schemeId = (
      await prisma.gradeScheme.create({
        data: {
          name: { ar: `${PREFIX} سلّم` },
          bands: {
            create: [
              { minPercent: 0, label: FAIL.label, letter: FAIL.letter, isPass: false },
              { minPercent: 50, label: PASS.label, letter: PASS.letter, isPass: true },
              { minPercent: 90, label: TOP.label, letter: TOP.letter, isPass: true },
            ],
          },
        },
        select: { id: true },
      })
    ).id;

    const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
    await createStaff('manager', [await createRole('ngmanager', ['classes.read', 'classes.manage', 'classes.teachers.assign'])]);
    await createStaff('teacher', [await systemRole('teacher')]);
    await createStaff('issuer', [await createRole('ngissuer', ['certificates.issue'])]);
    await createStaff('revoker', [await createRole('ngrevoker', ['certificates.revoke'])]);
    // Sees every class, but holds neither grades.manage nor a certificates key.
    await createStaff('nokeys', [await createRole('ngnokeys', ['classes.read', 'classes.manage'])]);
    const studentRole = await systemRole('student');
    await createRecipient('s1', [studentRole], { displayName: CHILD_NAMES['s1']! });
    await createRecipient('s2', [studentRole], { verified: false });
    await createRecipient('s3', [studentRole]);
    await createRecipient('s4', [studentRole]);
    await createRecipient('guardian', [await systemRole('guardian')]);
    await createRecipient('norole', []);
    for (const [guardian, student] of [
      ['guardian', 's1'],
      ['guardian', 's2'],
      // Linked like a guardian, without the `guardian` role: receives nothing (D-R81).
      ['norole', 's1'],
    ] as const) {
      await prisma.guardianStudent.create({ data: { guardianUserId: id(guardian), studentUserId: id(student), relationship: 'father' }, select: { studentUserId: true } });
    }

    // An open class with its lead teacher and four students; one weighted exam (max 100, weight 100) with results, not published yet:
    // s1 80.5 and s2 70 pass, s3 is excused (nothing to grade — a finalization skips them), s4 fails with 30.
    classId = (await api().post(CLASSES).set(bearer('manager')).send({ courseId, code: CLASS_CODE, name: CLASS_NAME, capacity: 10 }).expect(201)).body.id as string;
    await api().put(`${CLASSES}/${classId}/teachers`).set(bearer('manager')).send({ teachers: [{ userId: id('teacher'), role: 'lead' }] }).expect(200);
    await classAction('open');
    for (const student of ['s1', 's2', 's3', 's4']) {
      await prisma.enrollment.create({ data: { classId, studentUserId: id(student), status: 'active', activatedAt: new Date() }, select: { id: true } });
    }
    examId = (await api().post(`${CLASSES}/${classId}/exams`).set(bearer('teacher')).send({ title: { ar: 'الاختبار النهائي', en: 'Final exam' }, type: 'final', maxScore: 100, weight: 100 }).expect(201)).body.id as string;
    await api().post(`${EXAMS}/${examId}/status`).set(bearer('teacher')).send({ action: 'schedule' }).expect(200);
    await api()
      .put(`${EXAMS}/${examId}/results`)
      .set(bearer('teacher'))
      .send({
        results: [
          { studentId: id('s1'), status: 'scored', score: 80.5 },
          { studentId: id('s2'), status: 'scored', score: 70 },
          { studentId: id('s3'), status: 'excused' },
          { studentId: id('s4'), status: 'scored', score: 30 },
        ],
      })
      .expect(200);
  }, 120_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    try {
      if (prisma) {
        const classIds = classId ? [classId] : [];
        await prisma.certificate.deleteMany({ where: { classId: { in: classIds } } });
        await prisma.finalGrade.deleteMany({ where: { enrollment: { classId: { in: classIds } } } });
        await prisma.enrollment.deleteMany({ where: { classId: { in: classIds } } });
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
        if (schemeId) await prisma.gradeScheme.deleteMany({ where: { id: schemeId } });
      }
    } finally {
      // Deleting the recipients removes their notifications and guardian links with them.
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('a refused finalization, an empty withdrawal and a refused issuing notify nobody', async () => {
    const audit = await auditMark();
    // The class is still open: not gradable.
    const notGradable = await silent(() => finalize(classId));
    expect(verdict(notGradable)).toEqual([409, 'class_not_gradable']);
    expect(notGradable.body).toMatchObject({ classId, status: 'open' });
    await classAction('start');
    // Running, but the weighted exam is not published.
    const notReady = await silent(() => finalize(classId));
    expect(verdict(notReady)).toEqual([409, 'grades_not_ready']);
    expect(notReady.body).toMatchObject({ openAssignments: 0, awaitingReview: 0, unpublishedExams: 1 });
    // A caller without grades.manage; a class nobody knows.
    expect(verdict(await silent(() => finalize(classId, 'nokeys')))).toEqual([403, 'permission_denied']);
    expect(verdict(await silent(() => finalize(NIL_ID)))).toEqual([404, 'class_not_found']);
    // Nothing to withdraw yet; certificates only for a completed class, and only with certificates.issue.
    expect(verdict(await silent(() => withdraw(classId)))).toEqual([200, null]);
    expect(verdict(await silent(() => issue(classId)))).toEqual([409, 'class_not_completed']);
    expect(verdict(await silent(() => issue(classId, 'nokeys')))).toEqual([403, 'permission_denied']);
    // Only the class `start` above was recorded.
    expect((await eventsSince(audit)).map((event) => event.action)).toEqual(['classes.status.changed']);
  }, 60_000);

  it('a finalization tells each graded student their own percentage and band, and the guardian once per child — nobody else; an identical run tells nobody', async () => {
    await api().post(`${EXAMS}/${examId}/status`).set(bearer('teacher')).send({ action: 'publish' }).expect(200);
    const audit = await auditMark();
    const { res, rows, handOvers } = await observe(() => finalize(classId));
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // The route's own answer and its one audit event are what they were.
    const finals =Object.fromEntries((res.body as GradebookBody).students.map((entry) => [entry.student.id, entry.final ? [entry.final.percent, entry.final.letter, entry.final.isPass] : null]));
    expect(finals).toEqual({ [id('s1')]: [80.5, 'P', true], [id('s2')]: [70, 'P', true], [id('s3')]: null, [id('s4')]: [30, 'F', false] });
    const events = await eventsSince(audit);
    expect(events.map((event) => [event.action, event.entityType, event.entityId, event.actorUserId])).toEqual([['grades.finalized', 'classes', classId, id('teacher')]]);
    expect(events[0]!.metadata).toEqual({ code: CLASS_CODE, schemeId, created: 3, updated: 0, skipped: 1 });

    // One notification per (recipient × student): three graded students, and the guardian of two of them twice.
    // Not the excused student (skipped, no final grade), not the linked user without the `guardian` role, no member of staff.
    expect(rows).toHaveLength(5);
    expect(recipientsOf(rows)).toEqual(['guardian', 's1', 's2', 's4']);
    const ids = { classId };
    const own = expectNotice(rows, 's1', 's1', 'grades.finalized', finalGrade('80.5', PASS), ids);
    expectNotice(rows, 's2', 's2', 'grades.finalized', finalGrade('70', PASS), ids);
    expectNotice(rows, 's4', 's4', 'grades.finalized', finalGrade('30', FAIL), ids);
    expectNotice(rows, 'guardian', 's1', 'grades.finalized', finalGrade('80.5', PASS), ids);
    expectNotice(rows, 'guardian', 's2', 'grades.finalized', finalGrade('70', PASS), ids);
    // The stored 80.50 is worded without its trailing zero, with the band and the class in the reader's language.
    expect(own.body).toContain('80.5');
    expect(own.body).not.toContain('80.50');
    expect(own.body).toContain('Pass');
    expect(own.title).toContain('Graded class');
    const stored = await prisma.finalGrade.findFirstOrThrow({ where: { enrollment: { classId, studentUserId: id('s1') } }, select: { percent: true, bandLabel: true, bandLetter: true } });
    expect([stored.percent.toFixed(2), stored.bandLabel, stored.bandLetter]).toEqual(['80.50', PASS.label, 'P']);
    // E-mail copies (no transport in e2e): due for a confirmed address, not for an unconfirmed one.
    expect(rows.map((row) => [recipientsOf([row])[0], row.emailStatus]).sort()).toEqual([
      ['guardian', 'skipped'],
      ['guardian', 'skipped'],
      ['s1', 'skipped'],
      ['s2', 'none'],
      ['s4', 'skipped'],
    ]);
    for (const row of rows) expect(textOf(row)).not.toContain(STAFF_MARK); // never who fixed the grades
    // Handed to the dispatcher once, after the commit: the five rows were already visible to another connection.
    expect(handOvers).toEqual([{ created: 5, queued: 0, committed: 5 }]);

    // The same finalization again writes nothing: no event, no notification.
    const again = await auditMark();
    expect(verdict(await silent(() => finalize(classId)))).toEqual([200, null]);
    expect(await eventsSince(again)).toEqual([]);
  }, 60_000);

  it('after one student’s result is corrected, a new finalization tells that student and their guardian only', async () => {
    await api()
      .put(`${EXAMS}/${examId}/results`)
      .set(bearer('teacher'))
      .send({ results: [{ studentId: id('s1'), status: 'scored', score: 91.25 }] })
      .expect(200);
    const audit = await auditMark();
    const { res, rows, handOvers } = await observe(() => finalize(classId));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await eventsSince(audit)).map((event) => [event.action, event.metadata])).toEqual([['grades.finalized', { code: CLASS_CODE, schemeId, created: 0, updated: 1, skipped: 1 }]]);

    expect(rows).toHaveLength(2);
    expect(handOvers).toEqual([{ created: 2, queued: 0, committed: 2 }]);
    expect(recipientsOf(rows)).toEqual(['guardian', 's1']);
    const own = expectNotice(rows, 's1', 's1', 'grades.finalized', finalGrade('91.25', TOP), { classId });
    expectNotice(rows, 'guardian', 's1', 'grades.finalized', finalGrade('91.25', TOP), { classId });
    // The new band has no letter: the label alone.
    expect(own.body).toContain('91.25');
    expect(own.body).toContain('Excellent');
    expect(own.body).not.toContain('(');
  }, 60_000);

  it('a finalization that changes only what no student sees — the breakdown — rewrites the grades and tells nobody', async () => {
    // The only weighted component gets another weight: every percentage and band stays, the stored breakdown changes.
    await api().patch(`${EXAMS}/${examId}`).set(bearer('teacher')).send({ weight: 50 }).expect(200);
    try {
      const audit = await auditMark();
      const { res, rows } = await observe(() => finalize(classId));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const events = await eventsSince(audit);
      expect(events.map((event) => event.action)).toEqual(['grades.finalized']);
      expect((events[0]!.metadata as { created: number; updated: number }).created).toBe(0);
      expect((events[0]!.metadata as { created: number; updated: number }).updated).toBeGreaterThan(0);
      // The rows were rewritten, yet «my grades» shows each student exactly what it showed before: nothing to announce.
      expect(rows).toEqual([]);
    } finally {
      await api().patch(`${EXAMS}/${examId}`).set(bearer('teacher')).send({ weight: 100 }).expect(200);
    }
  }, 60_000);

  it('a withdrawal tells nobody; fixing the grades anew tells everyone again', async () => {
    expect(verdict(await silent(() => withdraw(classId, 'nokeys')))).toEqual([403, 'permission_denied']);
    const audit = await auditMark();
    const res = await silent(() => withdraw(classId));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body as GradebookBody).students.every((entry) => entry.final === null)).toBe(true);
    expect((await eventsSince(audit)).map((event) => [event.action, event.metadata])).toEqual([['grades.withdrawn', { code: CLASS_CODE, count: 3 }]]);

    const { rows, handOvers } = await observe(() => finalize(classId));
    expect(rows.map((row) => row.eventKey)).toEqual(Array.from({ length: 5 }, () => 'grades.finalized'));
    expect(handOvers).toEqual([{ created: 5, queued: 0, committed: 5 }]);
    expect(recipientsOf(rows)).toEqual(['guardian', 's1', 's2', 's4']);
    expectNotice(rows, 'guardian', 's1', 'grades.finalized', finalGrade('91.25', TOP), { classId });
    expectNotice(rows, 'guardian', 's2', 'grades.finalized', finalGrade('70', PASS), { classId });
  }, 60_000);

  it('issuing tells each certified student and their guardian the serial — not the students who got none; a repeat and the locked grades tell nobody', async () => {
    await classAction('complete');
    const audit = await auditMark();
    const { res, rows, handOvers } = await observe(() => issue(classId));
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // The route's own answer and its one audit event are what they were.
    const body = res.body as IssueBody;
    expect(Object.fromEntries(body.issued.map((certificate) => [certificate.student.id, certificate.status]))).toEqual({ [id('s1')]: 'issued', [id('s2')]: 'issued' });
    expect(Object.fromEntries(body.skipped.map((entry) => [entry.studentId, entry.reason]))).toEqual({ [id('s3')]: 'no_final_grade', [id('s4')]: 'not_passed' });
    const events = await eventsSince(audit);
    expect(events.map((event) => [event.action, event.entityType, event.entityId, event.actorUserId])).toEqual([['certificates.issued', 'classes', classId, id('issuer')]]);
    expect(events[0]!.metadata).toEqual({ code: CLASS_CODE, count: 2, certificateIds: body.issued.map((certificate) => certificate.id), skipped: 2 });
    for (const student of ['s1', 's2']) certificates[student] = body.issued.find((certificate) => certificate.student.id === id(student))!;

    // One notification per (recipient × certified student): each student their own serial, the guardian both.
    expect(rows).toHaveLength(4);
    expect(handOvers).toEqual([{ created: 4, queued: 0, committed: 4 }]);
    expect(recipientsOf(rows)).toEqual(['guardian', 's1', 's2']);
    for (const student of ['s1', 's2']) {
      const certificate = certificates[student]!;
      const classmate = certificates[student === 's1' ? 's2' : 's1']!;
      for (const recipient of [student, 'guardian']) {
        const row = expectNotice(rows, recipient, student, 'certificate.issued', certified(certificate), { certificateId: certificate.id });
        expect(row.body).toContain(certificate.serial);
        expect(textOf(row)).not.toContain(classmate.serial);
        expect(textOf(row)).not.toContain(STAFF_MARK); // never who issued it
      }
    }
    expect(rows.find((row) => row.recipientUserId === id('s1'))!.title).toContain('Certified course');

    // Nothing left to issue; the certified class's grades are locked (D-R54): no write, no event, no notification.
    const again = await auditMark();
    const repeat = await silent(() => issue(classId));
    expect(verdict(repeat)).toEqual([200, null]);
    expect((repeat.body as IssueBody).issued).toEqual([]);
    expect(verdict(await silent(() => finalize(classId)))).toEqual([409, 'grades_certified']);
    expect(verdict(await silent(() => withdraw(classId)))).toEqual([409, 'grades_certified']);
    expect(await eventsSince(again)).toEqual([]);
  }, 60_000);

  it('a revocation tells the student and their guardian the serial — never the reason or who revoked; refusals and a second revocation tell nobody', async () => {
    const certificate = certificates['s1']!;
    // Renamed since the certificate was issued: the notification names the course as the certificate prints it.
    await prisma.course.update({ where: { id: courseId }, data: { name: RENAMED }, select: { id: true } });

    // Without certificates.revoke; without a reason; a certificate nobody knows.
    expect(verdict(await silent(() => revoke(certificate.id, { reason: REASON }, 'issuer')))).toEqual([403, 'permission_denied']);
    expect(verdict(await silent(() => revoke(certificate.id, { reason: REASON }, 'nokeys')))).toEqual([403, 'permission_denied']);
    expect((await silent(() => revoke(certificate.id, {}))).status).toBe(400);
    expect(verdict(await silent(() => revoke(NIL_ID, { reason: REASON })))).toEqual([404, 'certificate_not_found']);

    const audit = await auditMark();
    const { res, rows, handOvers } = await observe(() => revoke(certificate.id, { reason: REASON }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // The route's own answer and its one audit event are what they were — the reason stays there, for the office.
    expect(res.body).toMatchObject({ id: certificate.id, serial: certificate.serial, status: 'revoked', revokeReason: REASON, revokedBy: { fullName: staffName('revoker') }, course: { name: RENAMED } });
    const events = await eventsSince(audit);
    expect(events.map((event) => [event.action, event.entityType, event.entityId, event.actorUserId])).toEqual([['certificates.revoked', 'certificates', certificate.id, id('revoker')]]);
    expect(events[0]!.metadata).toEqual({ serial: certificate.serial, classId, reason: REASON });

    expect(rows).toHaveLength(2);
    expect(handOvers).toEqual([{ created: 2, queued: 0, committed: 2 }]);
    expect(recipientsOf(rows)).toEqual(['guardian', 's1']);
    for (const recipient of ['s1', 'guardian']) {
      const row = expectNotice(rows, recipient, 's1', 'certificate.revoked', certified(certificate), { certificateId: certificate.id });
      expect(row.body).toContain(certificate.serial);
      for (const secret of [REASON, STAFF_MARK, RENAMED.ar, RENAMED.en!]) expect(textOf(row), secret).not.toContain(secret);
    }

    // Final (D-R55): revoking it again is refused and tells nobody.
    const second = await silent(() => revoke(certificate.id, { reason: REASON }));
    expect(verdict(second)).toEqual([409, 'certificate_revoked']);
    expect(second.body).toMatchObject({ certificateId: certificate.id });
    expect((await eventsSince(audit)).map((event) => event.action)).toEqual(['certificates.revoked']);
  }, 60_000);

  it('over the whole run: only the graded students and the guardian with the role were told; every notification is unread, carries ids alone and no secret; none is audited', async () => {
    const all = await prisma.notification.findMany({ where: { recipientUserId: { in: createdUserIds } }, orderBy: { id: 'asc' } });
    const mine = all.filter((row) => SLICE_KEYS.includes(row.eventKey));
    // 5 + 2 + 5 final grades (two full finalizations and one correction), 4 certificates issued, 1 revoked for 2 readers.
    const counts: Record<string, number> = {};
    for (const row of mine) counts[row.eventKey] = (counts[row.eventKey] ?? 0) + 1;
    expect(counts).toEqual({ 'grades.finalized': 12, 'certificate.issued': 4, 'certificate.revoked': 2 });
    // Never the excused student, the linked user without the `guardian` role, or a member of staff.
    expect(recipientsOf(mine)).toEqual(['guardian', 's1', 's2', 's4']);
    // The user without the role received nothing at all — whatever other writers of this class notify.
    expect(all.filter((row) => row.recipientUserId === id('norole'))).toEqual([]);
    for (const row of mine) {
      expect(row).toMatchObject({ category: 'grades', readAt: null, announcementId: null });
      expect(row.studentUserId).not.toBeNull();
      expect(Object.keys(row.data as Record<string, unknown>).sort()).toEqual(row.eventKey === 'grades.finalized' ? ['classId', 'link'] : ['certificateId', 'link']);
      for (const secret of [REASON, STAFF_MARK]) expect(textOf(row), `${row.eventKey}: ${secret}`).not.toContain(secret);
    }
    // D-R86: a notification is not an audit event.
    expect(await prisma.auditLog.count({ where: { entityType: 'notifications', entityId: { in: all.map((row) => row.id) } } })).toBe(0);
  }, 60_000);
});
