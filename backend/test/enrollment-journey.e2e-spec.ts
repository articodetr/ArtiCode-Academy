// PORTAL-02 (#206) — the enrollment journey through the API: the cases the
// MOD-19 suites (catalog.e2e-spec.ts — TEST-241/TEST-243) leave open. Group 1
// covers the ways around the payment condition of `approve` (D-R125): a
// reversed payment, a cancelled invoice and a suspended student. Skipped when no
// database is reachable. Custom roles split the office as TEST-243 does: a
// director (courses, fee plans, classes), a registrar (`enrollments.manage`
// alone — approves, never records money), a cashier (`payments.record` +
// `invoices.read_all`) and a finance role (`payments.refund` + `invoices.manage`
// — reverses payments and cancels invoices, never approves). Every fixture
// carries a unique prefix and is deleted at the end (the invoice and receipt
// numbers stay consumed). Audit events are counted by entity above an id
// watermark.
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

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `B${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'PORTAL-02 supertest';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const PRICE = 800;

interface RequestView {
  id: string;
  status: string;
  state: string;
  payment: { state: string; total: number; paid: number; balance: number; invoices: { id: string; status: string }[] };
}

interface SchoolItem {
  enrollmentId: string;
  relation: string;
  course: { id: string };
  action: string | null;
  canLearn: boolean;
  progress: { total: number; completed: number; percent: number | null; isComplete: boolean };
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

describe.skipIf(!available)('PORTAL-02 the enrollment journey (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let markId: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  let seq = 0;

  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const roleId = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
  const events = (entityId: string) =>
    prisma.auditLog.findMany({ where: { id: { gt: markId }, entityId }, orderBy: { id: 'asc' }, select: { action: true, metadata: true } });
  const enroll = (as: string, classId: string) => api().post(`/api/catalog/classes/${classId}/enroll`).set(bearer(as)).send({});
  const approve = (enrollmentId: string) => api().post(`/api/enrollments/${enrollmentId}/status`).set(bearer('registrar')).send({ action: 'approve' });
  const pay = (invoiceId: string, amount: number) => api().post(`/api/invoices/${invoiceId}/payments`).set(bearer('cashier')).send({ amount, method: 'cash' });
  const requestOf = async (enrollmentId: string) => (await api().get(`/api/enrollment-requests/${enrollmentId}`).set(bearer('registrar')).expect(200)).body as RequestView;
  const enrollmentStatus = async (enrollmentId: string) => (await prisma.enrollment.findUniqueOrThrow({ where: { id: enrollmentId }, select: { status: true } })).status;
  const myClassIds = async (as: string) => ((await api().get('/api/me/classes').set(bearer(as)).expect(200)).body.items as { class: { id: string } }[]).map((item) => item.class.id);
  // «My School» (MOD-20, API-229..234).
  const mySchool = async (as: string) => (await api().get('/api/me/learning').set(bearer(as)).expect(200)).body.items as SchoolItem[];
  const workspace = (as: string, courseId: string) => api().get(`/api/me/learning/courses/${courseId}`).set(bearer(as));
  const openLesson = (as: string, itemId: string) => api().get(`/api/me/learning/items/${itemId}`).set(bearer(as));
  const completeLesson = (as: string, itemId: string) => api().post(`/api/me/learning/items/${itemId}/complete`).set(bearer(as)).send({});
  const noteKeys = async (student: string) =>
    (await prisma.notification.findMany({ where: { recipientUserId: fx[student]!, eventKey: { startsWith: 'enrollment.' } }, orderBy: { id: 'asc' }, select: { eventKey: true } })).map((note) => note.eventKey);

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
      data: { key: `test_b${name}_${RUN.toLowerCase()}`, label: { ar: `دور ${name}` }, permissions: { create: permissions.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  /** A published, paid course (a plan of its own priced at PRICE) with one open self-service class and a lead teacher, all through the API. */
  async function paidClass(capacity = 5): Promise<{ courseId: string; classId: string }> {
    const code = `${PREFIX}-P${++seq}`;
    const course = await api().post('/api/courses').set(bearer('director')).send({ code, name: { ar: `دورة ${code}` } }).expect(201);
    const courseId = course.body.id as string;
    await api().post(`/api/courses/${courseId}/status`).set(bearer('director')).send({ action: 'publish' }).expect(200);
    const plan = await api()
      .post('/api/fee-plans')
      .set(bearer('director'))
      .send({ name: { ar: `${PREFIX} رسوم ${seq}` }, courseId, lines: [{ description: { ar: 'رسوم الدورة' }, amount: PRICE }], installments: [{ percent: 100, dueOffsetDays: 0 }] })
      .expect(201);
    await api().patch(`/api/courses/${courseId}`).set(bearer('director')).send({ enrollmentFeePlanId: plan.body.id }).expect(200);
    const klass = await api()
      .post('/api/classes')
      .set(bearer('director'))
      .send({ courseId, code: `${code}-A`, name: { ar: `فصل ${code}` }, capacity, selfEnrollment: true })
      .expect(201);
    const classId = klass.body.id as string;
    await api().post(`/api/classes/${classId}/status`).set(bearer('director')).send({ action: 'open' }).expect(200);
    await api().put(`/api/classes/${classId}/teachers`).set(bearer('director')).send({ teachers: [{ userId: fx['teacher'], role: 'lead' }] }).expect(200);
    return { courseId, classId };
  }

  /** A published, FREE course with one open self-service class and a lead teacher, all through the API. */
  async function freeClass(): Promise<{ courseId: string; classId: string; code: string }> {
    const code = `${PREFIX}-F${++seq}`;
    const course = await api().post('/api/courses').set(bearer('director')).send({ code, name: { ar: `دورة ${code}` } }).expect(201);
    const courseId = course.body.id as string;
    await api().post(`/api/courses/${courseId}/status`).set(bearer('director')).send({ action: 'publish' }).expect(200);
    const klass = await api().post('/api/classes').set(bearer('director')).send({ courseId, code: `${code}-A`, name: { ar: `فصل ${code}` }, capacity: 5, selfEnrollment: true }).expect(201);
    const classId = klass.body.id as string;
    await api().post(`/api/classes/${classId}/status`).set(bearer('director')).send({ action: 'open' }).expect(200);
    await api().put(`/api/classes/${classId}/teachers`).set(bearer('director')).send({ teachers: [{ userId: fx['teacher'], role: 'lead' }] }).expect(200);
    return { courseId, classId, code };
  }

  /** One published, required text lesson in the course's curriculum (a fixture row, as my-learning.e2e-spec.ts does): what «My School» opens. */
  async function addLesson(courseId: string): Promise<string> {
    const row = await prisma.courseSyllabusItem.create({
      data: { courseId, sortOrder: 0, title: { ar: 'الدرس الأول' }, kind: 'text', content: { body: { ar: 'مرحباً بك في الدورة' } } },
      select: { id: true },
    });
    return row.id;
  }

  /** A self-service request of `student` in a new paid class: the pending enrollment and its issued invoice. */
  async function pendingRequest(student: string): Promise<{ classId: string; enrollmentId: string; invoiceId: string }> {
    const { classId } = await paidClass();
    const view = (await enroll(student, classId).expect(201)).body.enrollment as RequestView;
    expect(view).toMatchObject({ status: 'pending', state: 'pending_payment', payment: { state: 'unpaid', total: PRICE, balance: PRICE } });
    return { classId, enrollmentId: view.id, invoiceId: view.payment.invoices[0]!.id };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    markId = (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;

    await createUser('director', [await customRole('director', ['courses.read', 'courses.manage', 'fee_plans.manage', 'classes.read', 'classes.manage', 'classes.teachers.assign'])]);
    await createUser('registrar', [await customRole('registrar', ['enrollments.read', 'enrollments.manage'])]);
    await createUser('cashier', [await customRole('cashier', ['payments.record', 'invoices.read_all'])]);
    await createUser('finance', [await customRole('finance', ['payments.refund', 'invoices.manage', 'invoices.read_all'])]);
    await createUser('teacher', [await roleId('teacher')]);
    const student = await roleId('student');
    for (const key of ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9']) await createUser(key, [student]);
  }, 120_000);

  afterAll(async () => {
    try {
      if (prisma) {
        const enrollments = await prisma.enrollment.findMany({ where: { studentUserId: { in: createdUserIds } }, select: { id: true } });
        const enrollmentIds = enrollments.map((row) => row.id);
        // The office notifications a request wrote for the academy's real holders of enrollments.manage.
        if (enrollmentIds.length > 0) await prisma.$executeRaw`DELETE FROM notifications WHERE data ->> 'enrollmentId' = ANY(${enrollmentIds}::text[])`;
        // A lesson with progress is never deleted (Restrict): the students' progress goes before the courses.
        await prisma.learningProgress.deleteMany({ where: { studentUserId: { in: createdUserIds } } });
        await prisma.payment.deleteMany({ where: { invoice: { studentUserId: { in: createdUserIds } } } });
        await prisma.invoice.deleteMany({ where: { studentUserId: { in: createdUserIds } } });
        await prisma.enrollment.deleteMany({ where: { studentUserId: { in: createdUserIds } } });
        await prisma.lesson.deleteMany({ where: { class: { code: { startsWith: PREFIX } } } });
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.updateMany({ where: { code: { startsWith: PREFIX } }, data: { enrollmentFeePlanId: null } });
        await prisma.feePlan.deleteMany({ where: { name: { path: ['ar'], string_starts_with: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
      }
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  describe('group 1 — no way around the payment condition of approve (D-R125)', () => {
    it('F5: a payment reversed before approval makes the request unpaid again — approval is refused and writes nothing', async () => {
      const { classId, enrollmentId, invoiceId } = await pendingRequest('s1');
      const payment = (await pay(invoiceId, PRICE).expect(201)).body as { id: string };
      expect(await requestOf(enrollmentId)).toMatchObject({ state: 'pending_approval', payment: { state: 'paid', balance: 0 } });

      // Only a holder of payments.refund reverses; the reason is required.
      await api().post(`/api/payments/${payment.id}/reverse`).set(bearer('registrar')).send({ reason: 'Bounced cheque' }).expect(403);
      await api().post(`/api/payments/${payment.id}/reverse`).set(bearer('finance')).send({}).expect(400);
      await api().post(`/api/payments/${payment.id}/reverse`).set(bearer('finance')).send({ reason: 'Bounced cheque' }).expect(200);
      expect(await requestOf(enrollmentId)).toMatchObject({ state: 'pending_payment', payment: { state: 'unpaid', paid: 0, balance: PRICE } });

      const before = await events(enrollmentId);
      const refused = await approve(enrollmentId).expect(409);
      expect(refused.body).toMatchObject({ code: 'payment_required', paymentState: 'unpaid', invoices: [{ id: invoiceId, balance: PRICE }] });
      expect(await enrollmentStatus(enrollmentId)).toBe('pending');
      expect(await events(enrollmentId)).toEqual(before);
      expect(await myClassIds('s1')).not.toContain(classId);
    });

    it('F7: an invoice cancelled instead of paid leaves nothing paid — approval is refused with payment_required { missing }', async () => {
      const { classId, enrollmentId, invoiceId } = await pendingRequest('s2');
      await api().post(`/api/invoices/${invoiceId}/status`).set(bearer('finance')).send({ action: 'cancel', reason: 'Issued by mistake' }).expect(200);
      expect(await requestOf(enrollmentId)).toMatchObject({ state: 'pending_payment', payment: { state: 'missing', total: 0, balance: 0 } });

      const before = await events(enrollmentId);
      const refused = await approve(enrollmentId).expect(409);
      expect(refused.body).toMatchObject({ code: 'payment_required', paymentState: 'missing', invoices: [] });
      expect(await enrollmentStatus(enrollmentId)).toBe('pending');
      expect(await events(enrollmentId)).toEqual(before);
      // A cancelled invoice takes no money either.
      await pay(invoiceId, PRICE).expect(409, /invoice_not_issued/);
      expect(await myClassIds('s2')).not.toContain(classId);
    });

    it('F6: a student suspended after paying in full is not approved — 422 user_not_eligible, nothing written', async () => {
      const { enrollmentId, invoiceId } = await pendingRequest('s3');
      await pay(invoiceId, PRICE).expect(201);
      expect(await requestOf(enrollmentId)).toMatchObject({ state: 'pending_approval' });
      // The account's state is set directly: this test is about approve, not about the suspension route (API-027).
      await prisma.user.update({ where: { id: fx['s3']! }, data: { status: 'suspended' }, select: { id: true } });

      const before = await events(enrollmentId);
      const refused = await approve(enrollmentId).expect(422);
      expect(refused.body).toMatchObject({ code: 'user_not_eligible', userId: fx['s3'], status: 'suspended' });
      expect(await enrollmentStatus(enrollmentId)).toBe('pending');
      expect(await events(enrollmentId)).toEqual(before);
    });
  });

  // The v1 limits of roadmap §4p.5 (items 1–3): documented as intended, held down here so a change is deliberate.
  describe('group 2 — the documented v1 limits of a request (roadmap §4p.5)', () => {
    it('F2 (§4p.5 item 1): a request holds no seat — once the class fills, a paid request is refused with class_full and stays pending and paid', async () => {
      const { classId } = await paidClass(1);
      const first = (await enroll('s4', classId).expect(201)).body.enrollment as RequestView;
      const second = (await enroll('s5', classId).expect(201)).body.enrollment as RequestView;
      await pay(first.payment.invoices[0]!.id, PRICE).expect(201);
      await pay(second.payment.invoices[0]!.id, PRICE).expect(201);

      await approve(first.id).expect(200);
      const before = await events(second.id);
      const refused = await approve(second.id).expect(409);
      expect(refused.body).toMatchObject({ code: 'class_full', capacity: 1, enrolledCount: 1 });
      expect(await requestOf(second.id)).toMatchObject({ status: 'pending', state: 'pending_approval', payment: { state: 'paid', paid: PRICE } });
      expect(await events(second.id)).toEqual(before);
      expect(await myClassIds('s4')).toContain(classId);
      expect(await myClassIds('s5')).not.toContain(classId);
    });

    it('F3 (§4p.5 item 3): cancelling a class leaves its pending requests pending — their approval is refused with class_not_enrollable', async () => {
      const { classId, enrollmentId, invoiceId } = await pendingRequest('s6');
      await pay(invoiceId, PRICE).expect(201);
      await api().post(`/api/classes/${classId}/status`).set(bearer('director')).send({ action: 'cancel' }).expect(200);

      expect(await requestOf(enrollmentId)).toMatchObject({ status: 'pending', state: 'pending_approval' });
      const before = await events(enrollmentId);
      const refused = await approve(enrollmentId).expect(409);
      expect(refused.body).toMatchObject({ code: 'class_not_enrollable', status: 'cancelled' });
      expect(await enrollmentStatus(enrollmentId)).toBe('pending');
      expect(await events(enrollmentId)).toEqual(before);
    });

    it('F4 (§4p.5 item 2): reversing the payment after approval keeps the enrollment active — only the payment state goes back to unpaid', async () => {
      const { classId, enrollmentId, invoiceId } = await pendingRequest('s7');
      const payment = (await pay(invoiceId, PRICE).expect(201)).body as { id: string };
      await approve(enrollmentId).expect(200);

      await api().post(`/api/payments/${payment.id}/reverse`).set(bearer('finance')).send({ reason: 'Refunded' }).expect(200);
      expect(await enrollmentStatus(enrollmentId)).toBe('active');
      expect(await requestOf(enrollmentId)).toMatchObject({ status: 'active', state: 'enrolled', payment: { state: 'unpaid', paid: 0, balance: PRICE } });
      expect(await myClassIds('s7')).toContain(classId);
      // The reversal wrote no enrollment event: the office withdraws the student by hand if it wants to.
      expect((await events(enrollmentId)).map((event) => event.action)).toEqual(['enrollments.requested', 'enrollments.status.changed']);
    });
  });

  // Only the protections are held down here. Two behaviours found while exploring stay OUT of the tests on purpose,
  // pending the owner's decision (KI-140, KI-141): the "total 0 = paid" waiver of D-R125 is unreachable, so a full
  // scholarship needs a workaround (unpricing the whole course, or a replacement invoice discounted down to 0.01),
  // and a paid request is still approved after its course is archived.
  describe('group 3 — no zero-cost way into a paid course', () => {
    it('Q1: a request invoice cannot be waived to zero — a fully discounted invoice, a discount on the issued one and a zero-priced plan are all refused', async () => {
      const { classId, enrollmentId, invoiceId } = await pendingRequest('s1');
      const courseId = (await prisma.class.findUniqueOrThrow({ where: { id: classId }, select: { courseId: true } })).courseId;
      const invoicesBefore = await prisma.invoice.count({ where: { enrollmentId } });

      const zero = await api()
        .post('/api/invoices')
        .set(bearer('finance'))
        .send({ studentId: fx['s1'], enrollmentId, lines: [{ description: { ar: 'رسوم' }, amount: PRICE }], installments: [{ amount: 0.01, dueOn: '2026-12-31' }], discountAmount: PRICE, discountReason: 'منحة كاملة' })
        .expect(400);
      expect(zero.body).toMatchObject({ code: 'invoice_invalid' });
      expect(zero.body.problems).toContain('total_zero');
      expect((await api().patch(`/api/invoices/${invoiceId}`).set(bearer('finance')).send({ discountAmount: PRICE, discountReason: 'منحة كاملة' }).expect(409)).body).toMatchObject({
        code: 'invoice_not_draft',
        status: 'issued',
      });
      await api()
        .post('/api/fee-plans')
        .set(bearer('director'))
        .send({ name: { ar: `${PREFIX} صفر` }, courseId, lines: [{ description: { ar: 'صفر' }, amount: 0 }], installments: [{ percent: 100, dueOffsetDays: 0 }] })
        .expect(400);

      expect(await prisma.invoice.count({ where: { enrollmentId } })).toBe(invoicesBefore);
      expect(await requestOf(enrollmentId)).toMatchObject({ state: 'pending_payment', payment: { state: 'unpaid', balance: PRICE } });
    });

    it('Q1: making the course free later does not waive an invoice already issued — approval is still refused while it is unpaid', async () => {
      const { classId, enrollmentId, invoiceId } = await pendingRequest('s2');
      const courseId = (await prisma.class.findUniqueOrThrow({ where: { id: classId }, select: { courseId: true } })).courseId;
      await api().patch(`/api/courses/${courseId}`).set(bearer('director')).send({ enrollmentFeePlanId: null }).expect(200);

      const before = await events(enrollmentId);
      const refused = await approve(enrollmentId).expect(409);
      expect(refused.body).toMatchObject({ code: 'payment_required', paymentState: 'unpaid', invoices: [{ id: invoiceId, balance: PRICE }] });
      expect(await enrollmentStatus(enrollmentId)).toBe('pending');
      expect(await events(enrollmentId)).toEqual(before);
    });

    // Awaiting the owner's decision (raised on #206 and in the PORTAL-02 PR); written once the intended behaviour is decided.
    it.todo('Q1: a full scholarship for ONE student in a paid course — awaiting the owner’s decision (KI-140; today only workarounds exist)');
    it.todo('Q2: approving a paid request after its course is archived — awaiting the owner’s decision (today it is approved)');
  });

  // F1 — the whole journey of an existing student account, through the API only, from the catalog to a finished
  // lesson in «My School» (#206 item 5). The other suites stop at «my classes» / «my lessons».
  describe('group 4 — the journey from the catalog to «My School»', () => {
    it('F1a: a free course — browse, enroll, active at once, open and finish the lesson in «My School»', async () => {
      const { courseId, classId, code } = await freeClass();
      const lessonId = await addLesson(courseId);

      // Browse: the course is listed as free, its class open to the student.
      const list = await api().get('/api/catalog/courses').query({ q: code }).set(bearer('s8')).expect(200);
      expect(list.body.items).toEqual([expect.objectContaining({ id: courseId, pricing: 'free', price: null, mine: { enrolled: false, pending: false } })]);
      const detail = await api().get(`/api/catalog/courses/${courseId}`).set(bearer('s8')).expect(200);
      expect(detail.body.classes).toEqual([expect.objectContaining({ id: classId, enrollable: true, blocker: null })]);
      // Before enrolling, «My School» does not open the course.
      expect((await workspace('s8', courseId).expect(403)).body).toMatchObject({ code: 'not_enrolled' });

      // Enroll: active at once, and the student is told.
      const enrolled = await enroll('s8', classId).expect(201);
      expect(enrolled.body).toMatchObject({ outcome: 'enrolled', enrollment: { status: 'active', state: 'enrolled', payment: { state: 'not_required' } } });
      const enrollmentId = enrolled.body.enrollment.id as string;
      expect(await noteKeys('s8')).toEqual(['enrollment.activated']);

      // «My School»: the course is there, ready to start; the lesson opens and is finished.
      expect(await mySchool('s8')).toEqual([
        expect.objectContaining({ enrollmentId, relation: 'self', course: expect.objectContaining({ id: courseId }), action: 'start', canLearn: true, progress: expect.objectContaining({ total: 1, completed: 0, percent: 0 }) }),
      ]);
      await workspace('s8', courseId).expect(200);
      expect((await openLesson('s8', lessonId).expect(200)).body).toMatchObject({ progress: { state: 'not_started' } });
      expect((await completeLesson('s8', lessonId).expect(200)).body).toMatchObject({ progress: { state: 'completed', completionSource: 'manual' } });
      expect((await mySchool('s8'))[0]).toMatchObject({ progress: { completed: 1, percent: 100, isComplete: true } });
      expect((await events(enrollmentId)).map((event) => event.action)).toEqual(['enrollments.created']);
    });

    it('F1b: a paid course — request, invoice, payment, approval, then «My School» opens the course and its lesson', async () => {
      const { courseId, classId } = await paidClass();
      const lessonId = await addLesson(courseId);

      // Browse: the price is shown.
      const detail = await api().get(`/api/catalog/courses/${courseId}`).set(bearer('s9')).expect(200);
      expect(detail.body).toMatchObject({ pricing: 'paid', price: { amount: PRICE } });
      expect(detail.body.classes).toEqual([expect.objectContaining({ id: classId, enrollable: true })]);

      // Request: pending, with an invoice on «my invoices» and the request on «my requests»; the student is told.
      const requested = await enroll('s9', classId).expect(201);
      expect(requested.body).toMatchObject({ outcome: 'requested', enrollment: { status: 'pending', state: 'pending_payment', payment: { state: 'unpaid', balance: PRICE } } });
      const view = requested.body.enrollment as RequestView;
      const enrollmentId = view.id;
      const invoiceId = view.payment.invoices[0]!.id;
      expect(((await api().get('/api/me/invoices').set(bearer('s9')).expect(200)).body.items as { id: string }[]).map((invoice) => invoice.id)).toContain(invoiceId);
      expect(((await api().get('/api/me/enrollment-requests').set(bearer('s9')).expect(200)).body.items as RequestView[]).map((item) => [item.id, item.state])).toEqual([
        [enrollmentId, 'pending_payment'],
      ]);
      expect(await noteKeys('s9')).toEqual(['enrollment.requested']);

      // While pending, «My School» keeps the course closed — before and after the payment.
      expect(await mySchool('s9')).toEqual([]);
      expect((await workspace('s9', courseId).expect(403)).body).toMatchObject({ code: 'not_enrolled', reason: 'pending' });
      expect((await openLesson('s9', lessonId).expect(403)).body).toMatchObject({ code: 'not_enrolled', reason: 'pending' });
      await pay(invoiceId, PRICE).expect(201);
      expect(((await api().get('/api/me/enrollment-requests').set(bearer('s9')).expect(200)).body.items as RequestView[])[0]).toMatchObject({ state: 'pending_approval', payment: { state: 'paid' } });
      expect((await workspace('s9', courseId).expect(403)).body).toMatchObject({ reason: 'pending' });

      // Approval: active, the student is told, and «My School» opens the course and its lesson.
      await approve(enrollmentId).expect(200);
      expect(await noteKeys('s9')).toEqual(['enrollment.requested', 'enrollment.activated']);
      expect(await mySchool('s9')).toEqual([expect.objectContaining({ enrollmentId, course: expect.objectContaining({ id: courseId }), action: 'start', canLearn: true })]);
      await workspace('s9', courseId).expect(200);
      await openLesson('s9', lessonId).expect(200);
      expect((await completeLesson('s9', lessonId).expect(200)).body).toMatchObject({ progress: { state: 'completed' } });
      expect((await mySchool('s9'))[0]).toMatchObject({ progress: { percent: 100, isComplete: true } });

      // Exactly one event per write on the enrollment: the request, then the approval.
      expect((await events(enrollmentId)).map((event) => [event.action, (event.metadata as { action?: string }).action ?? null])).toEqual([
        ['enrollments.requested', null],
        ['enrollments.status.changed', 'approve'],
      ]);
    });
  });
});
