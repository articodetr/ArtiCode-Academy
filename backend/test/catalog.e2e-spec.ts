// TEST-241 / TEST-243 — MOD-19 (roadmap §4p; D-R121..D-R129, ADR-077): the
// course catalog, self-service enrollment and the enrollment requests through
// the API. Skipped when no database is reachable. Custom roles split the
// office: a director (courses, fee plans, classes), a registrar
// (`enrollments.manage` alone — approves, never records money), a cashier
// (`payments.record` + `invoices.read_all` — records money, never approves),
// and a course writer without `fee_plans.manage`; the teacher, students and
// guardian hold the seeded roles. Every fixture carries a unique prefix and
// is deleted at the end (the invoice and receipt numbers stay consumed); the
// notifications a request wrote for the academy's real office are deleted by
// enrollment id. Audit events are counted by entity above an id watermark.
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
import { dayIn } from '../src/finance/invoices.calc.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `K${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-243 supertest';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const COVER = 'https://cdn.example.org/courses/catalog-test.jpg';

interface RequestView {
  id: string;
  status: string;
  state: string;
  source: string;
  requestedAt: string | null;
  rejectionReason: string | null;
  class: { id: string; code: string };
  course: { id: string; pricing: string };
  payment: { state: string; required: boolean; total: number; paid: number; balance: number; invoices: { id: string; number: string | null; status: string; payments: unknown }[] };
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

describe.skipIf(!available)('MOD-19 catalog and enrollment requests (e2e, TEST-241/TEST-243)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let currency: string;
  let markId: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const roleId = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
  const events = (entityId: string) =>
    prisma.auditLog.findMany({ where: { id: { gt: markId }, entityId }, orderBy: { id: 'asc' }, select: { action: true, actorUserId: true, metadata: true } });
  const notes = (recipient: string) =>
    prisma.notification.findMany({ where: { recipientUserId: fx[recipient]!, eventKey: { startsWith: 'enrollment.' } }, orderBy: { id: 'asc' }, select: { eventKey: true, title: true, body: true, data: true } });
  const enroll = (as: string, classId: string) => api().post(`/api/catalog/classes/${classId}/enroll`).set(bearer(as)).send({});
  const action = (as: string, enrollmentId: string, body: Record<string, string>) => api().post(`/api/enrollments/${enrollmentId}/status`).set(bearer(as)).send(body);
  const pay = (invoiceId: string, amount: number) => api().post(`/api/invoices/${invoiceId}/payments`).set(bearer('cashier')).send({ amount, method: 'cash' });
  const myLessonIds = async (as: string) => ((await api().get('/api/me/lessons').set(bearer(as)).expect(200)).body.items as { id: string }[]).map((item) => item.id);
  const myClassIds = async (as: string) => ((await api().get('/api/me/classes').set(bearer(as)).expect(200)).body.items as { class: { id: string } }[]).map((item) => item.class.id);

  async function createUser(key: string, roleIds: string[]): Promise<void> {
    const user = await prisma.user.create({
      data: { email: email(key), fullName: `Test ${key}`, passwordHash: await passwords.hash(PASSWORD), status: 'active', roles: { create: roleIds.map((id) => ({ roleId: id })) } },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[key] = user.id;
    tokens[key] = (await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(key), password: PASSWORD }).expect(200)).body.accessToken as string;
  }

  async function customRole(name: string, permissions: string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_k${name}_${RUN.toLowerCase()}`, label: { ar: `دور ${name}` }, permissions: { create: permissions.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  /** A published course through the API (the director), with a self-service class open and a lead teacher. */
  async function publishedCourseWithClass(code: string, capacity: number): Promise<{ courseId: string; classId: string }> {
    const course = await api().post('/api/courses').set(bearer('director')).send({ code: `${PREFIX}-${code}`, name: { ar: `دورة ${code}`, en: `Course ${code}` }, sessionsCount: 8, coverImageUrl: COVER }).expect(201);
    await api().post(`/api/courses/${course.body.id}/status`).set(bearer('director')).send({ action: 'publish' }).expect(200);
    const klass = await api()
      .post('/api/classes')
      .set(bearer('director'))
      .send({ courseId: course.body.id, code: `${PREFIX}-${code}-A`, name: { ar: `فصل ${code}` }, capacity, selfEnrollment: true })
      .expect(201);
    expect(klass.body.selfEnrollment).toBe(true);
    await api().post(`/api/classes/${klass.body.id}/status`).set(bearer('director')).send({ action: 'open' }).expect(200);
    await api().put(`/api/classes/${klass.body.id}/teachers`).set(bearer('director')).send({ teachers: [{ userId: fx['teacher'], role: 'lead' }] }).expect(200);
    return { courseId: course.body.id as string, classId: klass.body.id as string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    currency = (await prisma.academy.findFirstOrThrow({ select: { currency: true } })).currency;
    markId = (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;

    await createUser('director', [await customRole('director', ['courses.read', 'courses.manage', 'fee_plans.manage', 'classes.read', 'classes.manage', 'classes.teachers.assign'])]);
    await createUser('registrar', [await customRole('registrar', ['enrollments.read', 'enrollments.manage'])]);
    await createUser('cashier', [await customRole('cashier', ['payments.record', 'invoices.read_all'])]);
    await createUser('writer', [await customRole('writer', ['courses.read', 'courses.manage'])]);
    await createUser('teacher', [await roleId('teacher')]);
    const student = await roleId('student');
    for (const key of ['s1', 's2', 's3', 's4']) await createUser(key, [student]);
    await createUser('g1', [await roleId('guardian')]);
    await prisma.guardianStudent.create({ data: { guardianUserId: fx['g1']!, studentUserId: fx['s1']!, relationship: 'mother' }, select: { studentUserId: true } });

    const free = await publishedCourseWithClass('FREE', 2);
    ids['freeCourse'] = free.courseId;
    ids['freeClass'] = free.classId;
    // A weekly slot without a room: the catalog shows it in the academy's zone.
    await prisma.classSchedule.create({
      data: {
        classId: free.classId,
        weekday: 1,
        startTime: new Date('1970-01-01T17:00:00.000Z'),
        endTime: new Date('1970-01-01T18:30:00.000Z'),
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
      select: { id: true },
    });
    const paid = await publishedCourseWithClass('PAID', 5);
    ids['paidCourse'] = paid.courseId;
    ids['paidClass'] = paid.classId;
    // A lesson of the paid class, tomorrow: «my lessons» shows it only once the enrollment is active.
    const startsAt = new Date(Date.now() + 24 * 3600 * 1000);
    ids['paidLesson'] = (
      await prisma.lesson.create({ data: { classId: paid.classId, title: { ar: 'درس مدفوع' }, startsAt, endsAt: new Date(startsAt.getTime() + 3600 * 1000) }, select: { id: true } })
    ).id;
    // A draft course with a class open to self-service: invisible in the catalog, refused on enroll.
    const draft = await prisma.course.create({ data: { code: `${PREFIX}-DRAFT`, name: { ar: 'مسودة' }, status: 'draft' }, select: { id: true } });
    ids['draftCourse'] = draft.id;
    ids['draftClass'] = (
      await prisma.class.create({ data: { courseId: draft.id, code: `${PREFIX}-DRAFT-A`, name: { ar: 'فصل مسودة' }, capacity: 5, status: 'open', selfEnrollment: true }, select: { id: true } })
    ).id;
    const archived = await prisma.course.create({ data: { code: `${PREFIX}-ARCH`, name: { ar: 'مؤرشفة' }, status: 'archived' }, select: { id: true } });
    ids['archivedCourse'] = archived.id;
    // An open class of the free course NOT opened to self-service.
    ids['closedClass'] = (
      await prisma.class.create({ data: { courseId: free.courseId, code: `${PREFIX}-FREE-B`, name: { ar: 'فصل مغلق' }, capacity: 5, status: 'open' }, select: { id: true } })
    ).id;
  }, 120_000);

  afterAll(async () => {
    try {
      if (prisma) {
        const enrollments = await prisma.enrollment.findMany({ where: { studentUserId: { in: createdUserIds } }, select: { id: true } });
        const enrollmentIds = enrollments.map((row) => row.id);
        // The office notifications a request wrote for the academy's real holders of enrollments.manage.
        if (enrollmentIds.length > 0) await prisma.$executeRaw`DELETE FROM notifications WHERE data ->> 'enrollmentId' = ANY(${enrollmentIds}::text[])`;
        await prisma.payment.deleteMany({ where: { invoice: { studentUserId: { in: createdUserIds } } } });
        await prisma.invoice.deleteMany({ where: { studentUserId: { in: createdUserIds } } });
        await prisma.enrollment.deleteMany({ where: { studentUserId: { in: createdUserIds } } });
        await prisma.lesson.deleteMany({ where: { class: { code: { startsWith: PREFIX } } } });
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.updateMany({ where: { code: { startsWith: PREFIX } }, data: { enrollmentFeePlanId: null } });
        await prisma.feePlan.deleteMany({ where: { name: { path: ['ar'], string_starts_with: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.subject.deleteMany({ where: { code: { startsWith: PREFIX } } });
      }
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('TEST-241: the catalog shows published courses only, with their open classes, price and the reader’s own state', async () => {
    const list = await api().get('/api/catalog/courses').query({ q: PREFIX }).set(bearer('s1')).expect(200);
    const codes = (list.body.items as { code: string }[]).map((item) => item.code);
    expect(codes).toEqual([`${PREFIX}-FREE`, `${PREFIX}-PAID`]);
    const card = (list.body.items as Record<string, unknown>[])[0]!;
    expect(card).toMatchObject({
      coverImageUrl: COVER,
      sessionsCount: 8,
      pricing: 'free',
      price: null,
      openClasses: 1,
      availableClasses: 1,
      teachers: [{ fullName: 'Test teacher' }],
      mine: { enrolled: false, pending: false },
    });
    // Draft and archived courses: 404 in the catalog, and a draft course's open class takes nobody.
    await api().get(`/api/catalog/courses/${ids['draftCourse']}`).set(bearer('s1')).expect(404, /course_not_found/);
    await api().get(`/api/catalog/courses/${ids['archivedCourse']}`).set(bearer('s1')).expect(404, /course_not_found/);
    await enroll('s1', ids['draftClass']!).expect(404, /class_not_found/);
    // A class the office did not open to self-service is not listed and refuses a self-service enrollment.
    await enroll('s1', ids['closedClass']!).expect(404, /class_not_found/);

    const detail = await api().get(`/api/catalog/courses/${ids['freeCourse']}`).set(bearer('s1')).expect(200);
    expect(detail.body.selfService).toEqual({ allowed: true, reason: null });
    expect(detail.body.classes).toHaveLength(1);
    expect(detail.body.classes[0]).toMatchObject({
      id: ids['freeClass'],
      status: 'open',
      capacity: 2,
      enrolledCount: 0,
      seatsLeft: 2,
      leadTeacher: { fullName: 'Test teacher' },
      enrollable: true,
      blocker: null,
      myEnrollment: null,
    });
    expect(detail.body.classes[0].schedule).toEqual([expect.objectContaining({ weekday: 1, startTime: '17:00', endTime: '18:30', effectiveTo: null })]);
    // Filters: nothing is priced yet; availability.
    const paidOnly = await api().get('/api/catalog/courses').query({ q: PREFIX, pricing: 'paid' }).set(bearer('s1')).expect(200);
    expect(paidOnly.body.items).toEqual([]);
    const open = await api().get('/api/catalog/courses').query({ q: PREFIX, available: 'true' }).set(bearer('s1')).expect(200);
    expect((open.body.items as { code: string }[]).map((item) => item.code)).toEqual([`${PREFIX}-FREE`, `${PREFIX}-PAID`]);
    await api().get('/api/catalog/courses').query({ available: 'maybe' }).set(bearer('s1')).expect(400);
    // A teacher reads the catalog but may not enroll themself; a guardian neither.
    const asTeacher = await api().get(`/api/catalog/courses/${ids['freeCourse']}`).set(bearer('teacher')).expect(200);
    expect(asTeacher.body.selfService).toEqual({ allowed: false, reason: 'no_permission' });
    expect(asTeacher.body.classes[0].blocker).toBe('not_allowed');
    await enroll('teacher', ids['freeClass']!).expect(403, /permission_denied/);
    await enroll('g1', ids['freeClass']!).expect(403, /permission_denied/);
  });

  it('PORTAL-04: every card and detail carries the school subject as { id, name } only, and subjectId filters the list (unknown = nothing)', async () => {
    const subjectAt = async (suffix: string, isActive: boolean) => {
      const max = await prisma.subject.aggregate({ _max: { sortOrder: true } });
      return prisma.subject.create({
        data: { code: `${PREFIX}${suffix}`.slice(0, 16), name: { ar: `مادة ${suffix}`, en: `Subject ${suffix}` }, isActive, sortOrder: (max._max.sortOrder ?? -1) + 1 },
        select: { id: true, code: true },
      });
    };
    const math = await subjectAt('M', true);
    const retired = await subjectAt('R', true);
    await api().patch(`/api/courses/${ids['freeCourse']}`).set(bearer('director')).send({ subjectId: math.id }).expect(200);
    await api().patch(`/api/courses/${ids['paidCourse']}`).set(bearer('director')).send({ subjectId: retired.id }).expect(200);
    // Deactivated after it was given: the course keeps it and the catalog still names it — by id and name, never its code or state.
    await prisma.subject.update({ where: { id: retired.id }, data: { isActive: false }, select: { id: true } });

    const list = await api().get('/api/catalog/courses').query({ q: PREFIX }).set(bearer('s1')).expect(200);
    const subjects = (list.body.items as { code: string; subject: unknown }[]).map((item) => [item.code, item.subject]);
    expect(subjects).toEqual([
      [`${PREFIX}-FREE`, { id: math.id, name: { ar: 'مادة M', en: 'Subject M' } }],
      [`${PREFIX}-PAID`, { id: retired.id, name: { ar: 'مادة R', en: 'Subject R' } }],
    ]);
    expect(JSON.stringify(list.body)).not.toContain(math.code);
    const detail = await api().get(`/api/catalog/courses/${ids['freeCourse']}`).set(bearer('s1')).expect(200);
    expect(detail.body.subject).toEqual({ id: math.id, name: { ar: 'مادة M', en: 'Subject M' } });

    const byMath = await api().get('/api/catalog/courses').query({ q: PREFIX, subjectId: math.id }).set(bearer('s1')).expect(200);
    expect((byMath.body.items as { code: string }[]).map((item) => item.code)).toEqual([`${PREFIX}-FREE`]);
    const byRetired = await api().get('/api/catalog/courses').query({ q: PREFIX, subjectId: retired.id }).set(bearer('s1')).expect(200);
    expect((byRetired.body.items as { code: string }[]).map((item) => item.code)).toEqual([`${PREFIX}-PAID`]);
    const none = await api().get('/api/catalog/courses').query({ q: PREFIX, subjectId: NIL_ID }).set(bearer('s1')).expect(200);
    expect(none.body.items).toEqual([]);
    await api().get('/api/catalog/courses').query({ subjectId: 'nope' }).set(bearer('s1')).expect(400);
    // A course without a subject says null.
    await api().patch(`/api/courses/${ids['paidCourse']}`).set(bearer('director')).send({ subjectId: null }).expect(200);
    const cleared = await api().get(`/api/catalog/courses/${ids['paidCourse']}`).set(bearer('s1')).expect(200);
    expect(cleared.body.subject).toBeNull();
  });

  it('TEST-241: a free course enrolls the student at once, refuses a second time and a full class', async () => {
    const first = await enroll('s1', ids['freeClass']!).expect(201);
    expect(first.body.outcome).toBe('enrolled');
    expect(first.body.enrollment).toMatchObject({ status: 'active', state: 'enrolled', source: 'self', requestedAt: null, payment: { state: 'not_required', required: false } });
    ids['s1Free'] = first.body.enrollment.id as string;
    expect(await myClassIds('s1')).toContain(ids['freeClass']);
    await enroll('s1', ids['freeClass']!).expect(409, /already_enrolled/);

    await enroll('s2', ids['freeClass']!).expect(201);
    const full = await enroll('s3', ids['freeClass']!).expect(409);
    expect(full.body).toMatchObject({ code: 'class_full', capacity: 2, enrolledCount: 2 });
    const detail = await api().get(`/api/catalog/courses/${ids['freeCourse']}`).set(bearer('s3')).expect(200);
    expect(detail.body.classes[0]).toMatchObject({ seatsLeft: 0, enrollable: false, blocker: 'class_full' });
    const own = await api().get(`/api/catalog/courses/${ids['freeCourse']}`).set(bearer('s1')).expect(200);
    expect(own.body).toMatchObject({ mine: { enrolled: true, pending: false } });
    expect(own.body.classes[0]).toMatchObject({ blocker: 'already_enrolled', myEnrollment: { status: 'active', state: 'enrolled' } });

    // Exactly one event per enrollment, by the student; the activation notification for the student and their guardian.
    expect(await events(ids['s1Free'])).toEqual([
      expect.objectContaining({ action: 'enrollments.created', actorUserId: fx['s1'], metadata: expect.objectContaining({ source: 'self', status: 'active' }) }),
    ]);
    expect((await notes('s1')).map((note) => note.eventKey)).toEqual(['enrollment.activated']);
    expect((await notes('g1')).map((note) => note.eventKey)).toEqual(['enrollment.activated']);
  });

  it('TEST-243: pricing a course needs fee_plans.manage and a fitting active plan; a plan pricing a course is not deleted', async () => {
    const plan = await api()
      .post('/api/fee-plans')
      .set(bearer('director'))
      .send({
        name: { ar: `${PREFIX} رسوم`, en: 'Course fee' },
        courseId: ids['paidCourse'],
        lines: [{ description: { ar: 'رسوم الدورة' }, amount: 1000 }],
        installments: [{ percent: 100, dueOffsetDays: 0 }],
      })
      .expect(201);
    ids['plan'] = plan.body.id as string;
    const classPlan = await api()
      .post('/api/fee-plans')
      .set(bearer('director'))
      .send({ name: { ar: `${PREFIX} فصل` }, classId: ids['paidClass'], lines: [{ description: { ar: 'رسوم' }, amount: 10 }], installments: [{ percent: 100, dueOffsetDays: 0 }] })
      .expect(201);

    const denied = await api().patch(`/api/courses/${ids['paidCourse']}`).set(bearer('writer')).send({ enrollmentFeePlanId: ids['plan'] }).expect(403);
    expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['fee_plans.manage'] });
    await api().patch(`/api/courses/${ids['paidCourse']}`).set(bearer('director')).send({ enrollmentFeePlanId: classPlan.body.id }).expect(422, /fee_plan_mismatch/);
    const priced = await api().patch(`/api/courses/${ids['paidCourse']}`).set(bearer('director')).send({ enrollmentFeePlanId: ids['plan'] }).expect(200);
    expect(priced.body).toMatchObject({ pricing: 'paid', enrollmentFeePlan: { id: ids['plan'], total: 1000, currency, isActive: true, installments: 1 } });
    await api().delete(`/api/fee-plans/${ids['plan']}`).set(bearer('director')).expect(409, /fee_plan_in_use/);

    const card = await api().get(`/api/catalog/courses/${ids['paidCourse']}`).set(bearer('s1')).expect(200);
    expect(card.body).toMatchObject({ pricing: 'paid', price: { amount: 1000, currency, installments: 1 } });
    const paidOnly = await api().get('/api/catalog/courses').query({ q: PREFIX, pricing: 'paid' }).set(bearer('s1')).expect(200);
    expect((paidOnly.body.items as { code: string }[]).map((item) => item.code)).toEqual([`${PREFIX}-PAID`]);
    // The free class is full by now: only the paid course is available.
    const open = await api().get('/api/catalog/courses').query({ q: PREFIX, available: 'true' }).set(bearer('s1')).expect(200);
    expect((open.body.items as { code: string }[]).map((item) => item.code)).toEqual([`${PREFIX}-PAID`]);
    expect(card.body.classes[0]).toMatchObject({ enrollable: true, blocker: null });
  });

  it('TEST-243: a paid request needs both a full payment and the office’s approval before the class opens to the student', async () => {
    const requested = await enroll('s1', ids['paidClass']!).expect(201);
    expect(requested.body.outcome).toBe('requested');
    const view = requested.body.enrollment as RequestView;
    expect(view).toMatchObject({ status: 'pending', state: 'pending_payment', source: 'self', payment: { state: 'unpaid', required: true, total: 1000, paid: 0, balance: 1000 } });
    expect(view.payment.invoices).toEqual([expect.objectContaining({ status: 'issued', number: expect.stringMatching(/^INV-\d{4}-\d{5}$/), payments: null })]);
    const enrollmentId = view.id;
    const invoiceId = view.payment.invoices[0]!.id;
    ids['s1Paid'] = enrollmentId;
    await enroll('s1', ids['paidClass']!).expect(409, /request_pending/);

    // Pending: no access to the class's lessons or to «my classes»; the invoice is on «my invoices»; the request on «my requests».
    expect(await myLessonIds('s1')).not.toContain(ids['paidLesson']);
    expect(await myClassIds('s1')).not.toContain(ids['paidClass']);
    const invoices = (await api().get('/api/me/invoices').set(bearer('s1')).expect(200)).body.items as { id: string }[];
    expect(invoices.map((invoice) => invoice.id)).toContain(invoiceId);
    const mine = (await api().get('/api/me/enrollment-requests').set(bearer('s1')).expect(200)).body.items as RequestView[];
    expect(mine.map((item) => [item.id, item.state])).toEqual([[enrollmentId, 'pending_payment']]);

    // The office sees it; teachers and the cashier do not manage requests; the cashier's detail needs enrollments.manage too.
    const office = await api().get('/api/enrollment-requests').query({ state: 'pending_payment', courseId: ids['paidCourse'] }).set(bearer('registrar')).expect(200);
    expect((office.body.items as { id: string; approveBlocker: string; allowedActions: string[] }[]).map((item) => [item.id, item.approveBlocker, item.allowedActions])).toEqual([
      [enrollmentId, 'payment_required', ['approve', 'reject']],
    ]);
    expect(office.body.pendingCount).toBeGreaterThanOrEqual(1);
    const registrarDetail = await api().get(`/api/enrollment-requests/${enrollmentId}`).set(bearer('registrar')).expect(200);
    expect(registrarDetail.body.payment.invoices[0].payments).toBeNull();
    await api().get('/api/enrollment-requests').set(bearer('teacher')).expect(403);
    await api().get(`/api/enrollment-requests/${enrollmentId}`).set(bearer('cashier')).expect(403);

    // Approval alone: refused while unpaid, by the registrar; never possible for the cashier or a teacher.
    const unpaid = await action('registrar', enrollmentId, { action: 'approve' }).expect(409);
    expect(unpaid.body).toMatchObject({ code: 'payment_required', paymentState: 'unpaid', invoices: [{ id: invoiceId, balance: 1000 }] });
    await action('cashier', enrollmentId, { action: 'approve' }).expect(403);
    await action('teacher', enrollmentId, { action: 'approve' }).expect(403);
    await api().post(`/api/invoices/${invoiceId}/payments`).set(bearer('teacher')).send({ amount: 1000, method: 'cash' }).expect(403);
    await api().post(`/api/invoices/${invoiceId}/payments`).set(bearer('s1')).send({ amount: 1000, method: 'cash' }).expect(403);

    // A partial payment is not enough; a full payment alone does not activate.
    await pay(invoiceId, 400).expect(201);
    expect((await action('registrar', enrollmentId, { action: 'approve' }).expect(409)).body).toMatchObject({ paymentState: 'partial', invoices: [{ balance: 600 }] });
    await pay(invoiceId, 600).expect(201);
    const settled = (await api().get('/api/me/enrollment-requests').set(bearer('s1')).expect(200)).body.items as RequestView[];
    expect(settled[0]).toMatchObject({ status: 'pending', state: 'pending_approval', payment: { state: 'paid', balance: 0 } });
    expect(await myLessonIds('s1')).not.toContain(ids['paidLesson']);
    const financeDetail = await api().get(`/api/enrollment-requests/${enrollmentId}`).set(bearer('registrar')).expect(200);
    expect(financeDetail.body).toMatchObject({ state: 'pending_approval', approveBlocker: null });

    // Both: the registrar approves and the class opens to the student.
    const approved = await action('registrar', enrollmentId, { action: 'approve' }).expect(200);
    expect(approved.body).toMatchObject({ status: 'active', paymentState: null });
    expect(await myLessonIds('s1')).toContain(ids['paidLesson']);
    expect(await myClassIds('s1')).toContain(ids['paidClass']);
    await action('registrar', enrollmentId, { action: 'approve' }).expect(409, /invalid_transition/);

    // Exactly one event per write on the enrollment; the refusals recorded nothing.
    expect((await events(enrollmentId)).map((event) => [event.action, event.actorUserId, (event.metadata as { action?: string }).action ?? null])).toEqual([
      ['enrollments.requested', fx['s1'], null],
      ['enrollments.status.changed', fx['registrar'], 'approve'],
    ]);
    expect((await events(enrollmentId))[0]!.metadata).toMatchObject({ source: 'self', invoiceId, total: 1000, currency, status: 'pending' });
    // The student and guardian were told twice (request, activation); the office once — never the requester.
    expect((await notes('s1')).map((note) => note.eventKey)).toEqual(['enrollment.activated', 'enrollment.requested', 'enrollment.activated']);
    expect((await notes('g1')).map((note) => note.eventKey)).toEqual(['enrollment.activated', 'enrollment.requested', 'enrollment.activated']);
    const office1 = await notes('registrar');
    expect(office1.map((note) => [note.eventKey, (note.data as { enrollmentId: string }).enrollmentId])).toEqual([['enrollment.request_received', enrollmentId]]);
    expect(office1[0]!.title).not.toContain('1000');
    expect((await notes('cashier')).length).toBe(0);
  });

  it('TEST-243: a rejection needs a reason and cancels the unpaid invoice; a closed request can be asked again; the student cancels their own', async () => {
    const first = (await enroll('s2', ids['paidClass']!).expect(201)).body.enrollment as RequestView;
    await action('registrar', first.id, { action: 'reject' }).expect(400, /rejection_reason_required/);
    const rejected = await action('registrar', first.id, { action: 'reject', reason: 'Level test needed first' }).expect(200);
    expect(rejected.body).toMatchObject({ status: 'cancelled', rejectionReason: 'Level test needed first' });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: first.payment.invoices[0]!.id }, select: { status: true } })).status).toBe('cancelled');
    const mine = ((await api().get('/api/me/enrollment-requests').set(bearer('s2')).expect(200)).body.items as RequestView[])[0]!;
    expect(mine).toMatchObject({ state: 'rejected', rejectionReason: 'Level test needed first', payment: { state: 'missing' } });
    const rejection = (await notes('s2')).find((note) => note.eventKey === 'enrollment.rejected')!;
    expect(`${rejection.title} ${rejection.body}`).not.toContain('Level test needed first');
    // The office reactivating a request that never was active in a paid course is refused (no bypass — D-R127).
    await action('registrar', first.id, { action: 'reactivate' }).expect(409, /payment_required/);

    // Asked again: the same row reopens with a new invoice.
    const again = (await enroll('s2', ids['paidClass']!).expect(201)).body.enrollment as RequestView;
    expect(again).toMatchObject({ id: first.id, state: 'pending_payment', rejectionReason: null });
    expect(again.payment.invoices.map((invoice) => invoice.status)).toEqual(['cancelled', 'issued']);
    // Another student cannot cancel it; its owner can, once.
    await api().post(`/api/me/enrollment-requests/${first.id}/cancel`).set(bearer('s3')).expect(404, /request_not_found/);
    const cancelled = await api().post(`/api/me/enrollment-requests/${first.id}/cancel`).set(bearer('s2')).expect(200);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', state: 'cancelled', payment: { state: 'missing' } });
    await api().post(`/api/me/enrollment-requests/${first.id}/cancel`).set(bearer('s2')).expect(409, /invalid_transition/);

    // A request with money on it is neither rejected nor cancelled until the payment is reversed.
    const paid = (await enroll('s3', ids['paidClass']!).expect(201)).body.enrollment as RequestView;
    await pay(paid.payment.invoices[0]!.id, 100).expect(201);
    expect((await api().post(`/api/me/enrollment-requests/${paid.id}/cancel`).set(bearer('s3')).expect(409)).body).toMatchObject({ code: 'request_has_payments', paymentCount: 1 });
    await action('registrar', paid.id, { action: 'reject', reason: 'Full' }).expect(409, /request_has_payments/);

    expect((await events(first.id)).map((event) => [event.action, (event.metadata as { action?: string }).action ?? null])).toEqual([
      ['enrollments.requested', null],
      ['enrollments.status.changed', 'reject'],
      ['enrollments.requested', null],
      ['enrollments.status.changed', 'cancel_request'],
    ]);
  });

  it('TEST-243: the office enrolls a student by hand — a paid course gives a request with its invoice, never an active seat without payment', async () => {
    const manual = await api().post(`/api/classes/${ids['paidClass']}/enrollments`).set(bearer('registrar')).send({ studentId: fx['s4'] }).expect(201);
    expect(manual.body).toMatchObject({ status: 'pending', source: 'admin', paymentState: 'unpaid', requestedAt: expect.any(String) });
    const view = (await api().get(`/api/enrollment-requests/${manual.body.id}`).set(bearer('registrar')).expect(200)).body as RequestView;
    await action('registrar', manual.body.id as string, { action: 'approve' }).expect(409, /payment_required/);
    await pay(view.payment.invoices[0]!.id, 1000).expect(201);
    await action('registrar', manual.body.id as string, { action: 'approve' }).expect(200);
    // The roster shows the request fields; an office request did not notify the office.
    const roster = await api().get(`/api/classes/${ids['paidClass']}/enrollments`).set(bearer('registrar')).expect(200);
    const s4 = (roster.body.items as { student: { id: string }; status: string; source: string }[]).find((item) => item.student.id === fx['s4'])!;
    expect(s4).toMatchObject({ status: 'active', source: 'admin' });
    expect((await notes('s4')).map((note) => note.eventKey)).toEqual(['enrollment.requested', 'enrollment.activated']);
    expect((await events(manual.body.id as string)).map((event) => [event.action, event.actorUserId])).toEqual([
      ['enrollments.requested', fx['registrar']],
      ['enrollments.status.changed', fx['registrar']],
    ]);
    // A free course still enrolls straight to active (API-058 as before).
    const free = await api().post(`/api/classes/${ids['closedClass']}/enrollments`).set(bearer('registrar')).send({ studentId: fx['s4'] }).expect(201);
    expect(free.body).toMatchObject({ status: 'active', source: 'admin', requestedAt: null, paymentState: null });
  });

  it('TEST-243: concurrent requests — two students for the last seat, one student twice for a paid class — never double-book or double-invoice', async () => {
    const race = await publishedCourseWithClass('RACE', 1);
    const [a, b] = await Promise.all([enroll('s3', race.classId), enroll('s4', race.classId)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect([a, b].find((response) => response.status === 409)!.body.code).toBe('class_full');
    expect(await prisma.enrollment.count({ where: { classId: race.classId, status: 'active' } })).toBe(1);

    // The same student twice at once on the paid class: one request, one invoice.
    const twice = await Promise.all([enroll('s4', ids['paidClass']!), enroll('s4', ids['paidClass']!)]);
    // s4 already holds an active enrollment there (the office's request, approved above): both are refused, nothing is written.
    expect(twice.map((response) => response.status)).toEqual([409, 409]);
    const fresh = await Promise.all([enroll('s1', race.classId), enroll('s1', race.classId)]);
    expect(fresh.map((response) => response.status).sort()).toEqual([409, 409]);
    const paidTwice = await publishedCourseWithClass('PAID2', 3);
    await api().patch(`/api/courses/${paidTwice.courseId}`).set(bearer('director')).send({ enrollmentFeePlanId: ids['plan'] }).expect(422, /fee_plan_mismatch/);
    const general = await api()
      .post('/api/fee-plans')
      .set(bearer('director'))
      .send({ name: { ar: `${PREFIX} عامة` }, lines: [{ description: { ar: 'رسوم' }, amount: 50 }], installments: [{ percent: 100, dueOffsetDays: 0 }] })
      .expect(201);
    await api().patch(`/api/courses/${paidTwice.courseId}`).set(bearer('director')).send({ enrollmentFeePlanId: general.body.id }).expect(200);
    const double = await Promise.all([enroll('s2', paidTwice.classId), enroll('s2', paidTwice.classId)]);
    expect(double.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(double.find((response) => response.status === 409)!.body.code).toBe('request_pending');
    const rows = await prisma.enrollment.findMany({ where: { classId: paidTwice.classId, studentUserId: fx['s2']! }, select: { id: true, _count: { select: { invoices: true } } } });
    expect(rows.map((row) => row._count.invoices)).toEqual([1]);
    await api().patch(`/api/courses/${paidTwice.courseId}`).set(bearer('director')).send({ enrollmentFeePlanId: null }).expect(200);
  });

  it('TEST-243: a deactivated plan closes paid requests without touching existing enrollments', async () => {
    await api().patch(`/api/fee-plans/${ids['plan']}`).set(bearer('director')).send({ isActive: false }).expect(200);
    const detail = await api().get(`/api/catalog/courses/${ids['paidCourse']}`).set(bearer('s2')).expect(200);
    expect(detail.body).toMatchObject({ pricing: 'paid', price: null, availableClasses: 0 });
    expect(detail.body.classes[0]).toMatchObject({ enrollable: false, blocker: 'price_unavailable' });
    expect((await enroll('s2', ids['paidClass']!).expect(409)).body).toMatchObject({ code: 'course_price_unavailable', feePlanId: ids['plan'] });
    // s1's approved enrollment stays active.
    expect(await myClassIds('s1')).toContain(ids['paidClass']);
    await api().patch(`/api/fee-plans/${ids['plan']}`).set(bearer('director')).send({ isActive: true }).expect(200);
  });
});
