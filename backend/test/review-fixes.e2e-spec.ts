// TEST-326/TEST-327 — KI-155..KI-159: a refund leaves no free reactivation; an unchanged final grade can be re-confirmed, also
// behind an issued certificate; a removed exam marks the final grade out of date; completing a class frees its future
// lessons. Fixtures carry a unique prefix and are deleted at the end. Skipped when no database is reachable.
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
import { refundLeftNothingPaid } from '../src/enrollments/enrollment-requests.policy.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `RF${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const PRICE = 500;

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

describe.skipIf(!available)('review fixes KI-155..KI-159 (e2e, TEST-326, TEST-327)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let token: string;
  const userIds: string[] = [];
  let seq = 0;
  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function student(): Promise<string> {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: 'student' }, select: { id: true } });
    const row = await prisma.user.create({ data: { email: `s${++seq}-${RUN}@example.test`.toLowerCase(), fullName: `${PREFIX} ${seq}`, status: 'active', roles: { create: [{ roleId: role.id }] } }, select: { id: true } });
    userIds.push(row.id);
    return row.id;
  }

  /** A running class with one active student, a graded assignment (90%, weight 50) and a published exam (weight 50). */
  async function gradedClass(withResult: boolean) {
    const studentId = await student();
    const code = `${PREFIX}-G${++seq}`;
    const course = await prisma.course.create({ data: { code, name: { ar: code }, status: 'published' }, select: { id: true } });
    const klass = await prisma.class.create({
      data: { courseId: course.id, code, name: { ar: code }, capacity: 5, status: 'running', enrollments: { create: [{ studentUserId: studentId, status: 'active', activatedAt: new Date(), source: 'admin' }] } },
      select: { id: true },
    });
    const assignment = await prisma.assignment.create({ data: { classId: klass.id, title: { ar: 'واجب' }, status: 'closed', publishedAt: new Date(), closedAt: new Date(), maxScore: 100, weight: 50 }, select: { id: true } });
    await prisma.assignmentSubmission.create({ data: { assignmentId: assignment.id, studentUserId: studentId, attemptNo: 1, textAnswer: 'x', status: 'graded', score: 90, gradedAt: new Date() }, select: { id: true } });
    const exam = await prisma.exam.create({ data: { classId: klass.id, title: { ar: 'اختبار' }, type: 'quiz', status: 'published', publishedAt: new Date(), maxScore: 100, weight: 50 }, select: { id: true } });
    if (withResult) await prisma.examResult.create({ data: { examId: exam.id, studentUserId: studentId, status: 'scored', score: 70 }, select: { examId: true } });
    return { classId: klass.id, examId: exam.id };
  }

  const finalize = (classId: string) => api().post(`/api/classes/${classId}/final-grades`).set(auth()).send({});
  const finalOf = async (classId: string) => (await api().get(`/api/classes/${classId}/gradebook`).set(auth()).expect(200)).body.students[0].final as { percent: number; stale: boolean };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: 'academy_admin' }, select: { id: true } });
    const email = `admin-${RUN}@example.test`.toLowerCase();
    const admin = await prisma.user.create({ data: { email, fullName: `${PREFIX} admin`, passwordHash: await new PasswordService().hash(PASSWORD), status: 'active', roles: { create: [{ roleId: role.id }] } }, select: { id: true } });
    userIds.push(admin.id);
    token = (await api().post('/api/auth/login').send({ identifier: email, password: PASSWORD }).expect(200)).body.accessToken as string;
  }, 120_000);

  afterAll(async () => {
    try {
      if (prisma) {
        const classes = { code: { startsWith: PREFIX } };
        await prisma.certificate.deleteMany({ where: { class: classes } });
        await prisma.payment.deleteMany({ where: { invoice: { enrollment: { class: classes } } } });
        await prisma.invoice.deleteMany({ where: { enrollment: { class: classes } } });
        await prisma.finalGrade.deleteMany({ where: { enrollment: { class: classes } } });
        await prisma.examResult.deleteMany({ where: { exam: { class: classes } } });
        await prisma.assignmentSubmission.deleteMany({ where: { assignment: { class: classes } } });
        await prisma.enrollment.deleteMany({ where: { class: classes } });
        await prisma.class.deleteMany({ where: classes });
        await prisma.course.updateMany({ where: { code: { startsWith: PREFIX } }, data: { enrollmentFeePlanId: null } });
        await prisma.feePlan.deleteMany({ where: { course: { code: { startsWith: PREFIX } } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
      }
    } finally {
      if (prisma) {
        await prisma.notification.deleteMany({ where: { recipientUserId: { in: userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('KI-155 — the rule: only a refund that left nothing paid blocks a reactivation', () => {
    expect(refundLeftNothingPaid(1, 'missing')).toBe(true);
    expect(refundLeftNothingPaid(1, 'unpaid')).toBe(true);
    expect(refundLeftNothingPaid(1, 'partial')).toBe(false);
    expect(refundLeftNothingPaid(1, 'paid')).toBe(false);
    expect(refundLeftNothingPaid(0, 'unpaid')).toBe(false);
  });

  it('KI-155 — a withdrawn, refunded student is not reactivated until the course is paid again', async () => {
    const code = `${PREFIX}-P${++seq}`;
    const course = await api().post('/api/courses').set(auth()).send({ code, name: { ar: code } }).expect(201);
    const courseId = course.body.id as string;
    await api().post(`/api/courses/${courseId}/status`).set(auth()).send({ action: 'publish' }).expect(200);
    const plan = await api().post('/api/fee-plans').set(auth()).send({ name: { ar: code }, courseId, lines: [{ description: { ar: 'رسوم' }, amount: PRICE }], installments: [{ percent: 100, dueOffsetDays: 0 }] }).expect(201);
    await api().patch(`/api/courses/${courseId}`).set(auth()).send({ enrollmentFeePlanId: plan.body.id }).expect(200);
    const klass = await api().post('/api/classes').set(auth()).send({ courseId, code: `${code}-A`, name: { ar: code }, capacity: 5 }).expect(201);
    const classId = klass.body.id as string;
    await api().post(`/api/classes/${classId}/status`).set(auth()).send({ action: 'open' }).expect(200);
    const studentId = await student();
    const enrolled = await api().post(`/api/classes/${classId}/enrollments`).set(auth()).send({ studentId }).expect(201);
    const enrollmentId = enrolled.body.id as string;
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { enrollmentId, status: 'issued' }, select: { id: true } });
    const status = (action: string) => api().post(`/api/enrollments/${enrollmentId}/status`).set(auth()).send({ action });
    const payment = await api().post(`/api/invoices/${invoice.id}/payments`).set(auth()).send({ amount: PRICE, method: 'cash' }).expect(201);
    await status('approve').expect(200);
    await status('withdraw').expect(200);
    await api().post(`/api/payments/${payment.body.id}/reverse`).set(auth()).send({ reason: 'Refunded' }).expect(200);
    await api().post(`/api/invoices/${invoice.id}/status`).set(auth()).send({ action: 'cancel', reason: 'Refunded' }).expect(200);

    const refused = await status('reactivate').expect(409);
    expect(refused.body).toMatchObject({ code: 'payment_required' });
    expect((await prisma.enrollment.findUniqueOrThrow({ where: { id: enrollmentId }, select: { status: true } })).status).toBe('withdrawn');
  });

  it('KI-156 — an unchanged final grade can be confirmed again, also behind an issued certificate, and a changed one still cannot', async () => {
    const { classId, examId } = await gradedClass(true);
    await finalize(classId).expect(200);
    await api().post(`/api/classes/${classId}/status`).set(auth()).send({ action: 'complete' }).expect(200);
    await api().post(`/api/classes/${classId}/certificates`).set(auth()).send({}).expect(200);

    await api().patch(`/api/exams/${examId}`).set(auth()).send({ title: { ar: 'عنوان مصحَّح' } }).expect(200);
    expect((await finalOf(classId)).stale).toBe(true);
    const confirmed = await finalize(classId).expect(200);
    expect(confirmed.body.students[0].final).toMatchObject({ percent: 80, stale: false });

    const again = await finalize(classId).expect(409);
    expect(again.body).toMatchObject({ code: 'grades_certified' });
    await prisma.examResult.updateMany({ where: { examId }, data: { score: 50 } });
    expect((await finalize(classId).expect(409)).body).toMatchObject({ code: 'grades_certified' });
    expect((await finalOf(classId)).percent).toBe(80);
  });

  it('KI-157 — removing a counted exam marks the final grade out of date until it is fixed again', async () => {
    const { classId, examId } = await gradedClass(false);
    await finalize(classId).expect(200);
    expect(await finalOf(classId)).toMatchObject({ percent: 45, stale: false });
    await api().post(`/api/exams/${examId}/status`).set(auth()).send({ action: 'unpublish' }).expect(200);
    await api().post(`/api/exams/${examId}/status`).set(auth()).send({ action: 'unschedule' }).expect(200);
    expect(await finalOf(classId)).toMatchObject({ percent: 45, stale: true });
    await finalize(classId).expect(200);
    expect(await finalOf(classId)).toMatchObject({ percent: 90, stale: false });
  });

  it('KI-159 — an e-mail change retires the open invitation and reset links; a password change retires the reset links', async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: 'student' }, select: { id: true } });
    const hash = await new PasswordService().hash(PASSWORD);
    const account = async (status: 'invited' | 'active') => {
      const email = `link${++seq}-${RUN}@example.test`.toLowerCase();
      const row = await prisma.user.create({ data: { email, fullName: `${PREFIX} ${seq}`, status, passwordHash: status === 'active' ? hash : null, roles: { create: [{ roleId: role.id }] } }, select: { id: true } });
      userIds.push(row.id);
      return { id: row.id, email };
    };
    const newEmail = () => `moved${++seq}-${RUN}@example.test`.toLowerCase();

    const invited = await account('invited');
    const invitation = await api().post(`/api/users/${invited.id}/invitations`).set(auth()).send({}).expect(201);
    await api().patch(`/api/users/${invited.id}`).set(auth()).send({ fullName: `${PREFIX} renamed` }).expect(200);
    await api().get(`/api/account/invitations/${invitation.body.token}`).expect(200); // another field keeps the link
    await api().patch(`/api/users/${invited.id}`).set(auth()).send({ email: newEmail() }).expect(200);
    await api().post(`/api/account/invitations/${invitation.body.token}/accept`).send({ password: 'Another-Good-Pass-77' }).expect(409);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: invited.id }, select: { status: true, passwordHash: true } }))).toEqual({ status: 'invited', passwordHash: null });
    const fresh = await api().post(`/api/users/${invited.id}/invitations`).set(auth()).send({}).expect(201);
    await api().get(`/api/account/invitations/${fresh.body.token}`).expect(200);

    const moved = await account('active');
    const reset = await api().post(`/api/users/${moved.id}/password-reset`).set(auth()).send({}).expect(201);
    await api().patch(`/api/users/${moved.id}`).set(auth()).send({ email: newEmail() }).expect(200);
    await api().post(`/api/account/password-reset/${reset.body.token}/confirm`).send({ newPassword: 'Another-Good-Pass-77' }).expect(404);

    const self = await account('active');
    const selfReset = await api().post(`/api/users/${self.id}/password-reset`).set(auth()).send({}).expect(201);
    const login = await api().post('/api/auth/login').send({ identifier: self.email, password: PASSWORD }).expect(200);
    await api().post('/api/auth/password').set('Authorization', `Bearer ${login.body.accessToken}`).send({ currentPassword: PASSWORD, newPassword: 'Changed-Good-Pass-88' }).expect((res) => expect([200, 204]).toContain(res.status));
    await api().post(`/api/account/password-reset/${selfReset.body.token}/confirm`).send({ newPassword: 'Another-Good-Pass-77' }).expect(404);
  });

  it('KI-158 — completing a class cancels only its future scheduled lessons and frees their room', async () => {
    const { classId } = await gradedClass(true);
    const hour = 3600_000;
    const room = await prisma.room.create({ data: { code: `R${RUN}`.slice(0, 16), name: { ar: 'قاعة' }, kind: 'classroom' }, select: { id: true } });
    const lesson = (startsAt: number) =>
      prisma.lesson.create({ data: { classId, roomId: room.id, title: { ar: 'حصة' }, deliveryMode: 'in_person', startsAt: new Date(startsAt), endsAt: new Date(startsAt + hour) }, select: { id: true } });
    const past = await lesson(Date.now() - 48 * hour);
    const future = await lesson(Date.now() + 48 * hour);
    const startsAt = await prisma.lesson.findUniqueOrThrow({ where: { id: future.id }, select: { startsAt: true, endsAt: true } });
    await api().post(`/api/classes/${classId}/status`).set(auth()).send({ action: 'complete' }).expect(200);

    expect((await prisma.lesson.findUniqueOrThrow({ where: { id: past.id }, select: { status: true } })).status).toBe('scheduled');
    expect((await prisma.lesson.findUniqueOrThrow({ where: { id: future.id }, select: { status: true } })).status).toBe('cancelled');
    const other = await gradedClass(true);
    const freed = await prisma.lesson.create({ data: { classId: other.classId, roomId: room.id, title: { ar: 'حصة أخرى' }, deliveryMode: 'in_person', startsAt: startsAt.startsAt, endsAt: startsAt.endsAt }, select: { id: true } });
    expect(freed.id).toBeTruthy();
    await prisma.lesson.deleteMany({ where: { roomId: room.id } });
    await prisma.room.delete({ where: { id: room.id } });
  });
});
