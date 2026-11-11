// TEST-171 — MOD-13-T05 the WF-14 journey «a report from real data» (roadmap §4k.5 T05) through
// the API against the live development database. Skipped when no database is reachable.
// Writers: a director (custom role for the class, enrollment and finance keys), a teacher with
// the seeded `teacher` role and a student with the seeded `student` role. Readers: a clerk with
// the seeded `staff` role (attendance + financial reports) and an academic reader (custom role
// with reports.academic.view). Every report reads the suite's own course or class, so the shared
// dev DB never pollutes a number; the readers record no audit event. Everything is deleted at the end.
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
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const TAG = `RPJ-${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 4)}`.toUpperCase();
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-171 supertest';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const DIRECTOR_KEYS = ['users.read', 'courses.read', 'classes.read', 'classes.manage', 'classes.teachers.assign', 'enrollments.read', 'enrollments.manage', 'fee_plans.manage', 'invoices.manage', 'payments.record', 'payments.refund'];

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

describe.skipIf(!available)('MOD-13 the WF-14 journey «a report from real data» (e2e, TEST-171)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  let courseId = '';
  let classId = '';

  const email = (name: string) => `${name}-${RUN}@example.test`;
  const api = () => request(app.getHttpServer());
  const as = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

  async function roleId(key: string, permissionKeys?: readonly string[]): Promise<string> {
    if (!permissionKeys) return (await prisma.role.findUnique({ where: { key }, select: { id: true } }))!.id;
    const role = await prisma.role.create({
      data: { key: `test_${key}_${RUN}`, label: { ar: `دور اختبار ${key}` }, permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(name: string, role: string): Promise<void> {
    const user = await prisma.user.create({
      data: { email: email(name), fullName: `Journey ${name} ${RUN}`, passwordHash: await passwords.hash(PASSWORD), status: 'active', roles: { create: [{ roleId: role }] } },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(name), password: PASSWORD }).expect(200);
    tokens[name] = res.body.accessToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    await createUser('director', await roleId('director', DIRECTOR_KEYS));
    await createUser('teacher', await roleId('teacher'));
    await createUser('student', await roleId('student'));
    await createUser('clerk', await roleId('staff'));
    await createUser('reader', await roleId('reader', ['reports.academic.view']));
    courseId = (await prisma.course.create({ data: { code: TAG, name: { ar: `دورة ${TAG}` }, status: 'published' }, select: { id: true } })).id;
  }, 60_000);

  afterAll(async () => {
    try {
      if (prisma) {
        const invoices = await prisma.invoice.findMany({ where: { studentUserId: { in: createdUserIds } }, select: { id: true } });
        await prisma.payment.deleteMany({ where: { invoiceId: { in: invoices.map((row) => row.id) } } });
        await prisma.invoice.deleteMany({ where: { id: { in: invoices.map((row) => row.id) } } });
        // Enrollments hold their class and take the final grade; the class takes lessons, attendance, assignments, attempts, exams, results and the fee plan.
        await prisma.enrollment.deleteMany({ where: { class: { courseId } } });
        await prisma.class.deleteMany({ where: { courseId } });
        await prisma.course.deleteMany({ where: { id: courseId } });
      }
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('WF-14 — real attendance, grades and money show in every report, for the right readers only, and reading records nothing', async () => {
    // 1. The director runs a class: the teacher as lead, the student enrolled.
    const klass = await api().post('/api/classes').set(as('director')).send({ courseId, code: `${TAG}-A`, name: { ar: 'فصل الرحلة' }, capacity: 5 }).expect(201);
    classId = klass.body.id as string;
    await api().put(`/api/classes/${classId}/teachers`).set(as('director')).send({ teachers: [{ userId: fx['teacher'], role: 'lead' }] }).expect(200);
    await api().post(`/api/classes/${classId}/status`).set(as('director')).send({ action: 'open' }).expect(200);
    await api().post(`/api/classes/${classId}/enrollments`).set(as('director')).send({ studentId: fx['student'] }).expect(201);
    await api().post(`/api/classes/${classId}/status`).set(as('director')).send({ action: 'start' }).expect(200);

    // 2. The teacher gives a lesson that started two hours ago: the student present.
    const lesson = await api().post(`/api/classes/${classId}/lessons`).set(as('teacher')).send({ title: { ar: 'درس الرحلة' }, startsAt: ago(120), endsAt: ago(60) }).expect(201);
    await api().put(`/api/lessons/${lesson.body.id}/attendance`).set(as('teacher')).send({ records: [{ studentId: fx['student'], status: 'present' }] }).expect(200);
    await api().post(`/api/lessons/${lesson.body.id}/status`).set(as('teacher')).send({ action: 'complete' }).expect(200);

    // 3. An assignment submitted by the student and graded 8/10; 4. an exam scored 16/20; 5. the final grade (80 %).
    const assignment = await api().post(`/api/classes/${classId}/assignments`).set(as('teacher')).send({ title: { ar: 'واجب الرحلة' }, maxScore: 10, weight: 50 }).expect(201);
    await api().post(`/api/assignments/${assignment.body.id}/status`).set(as('teacher')).send({ action: 'publish' }).expect(200);
    const attempt = await api().post(`/api/assignments/${assignment.body.id}/submissions`).set(as('student')).send({ textAnswer: 'إجابة', attemptNo: 1 }).expect(201);
    await api().post(`/api/submissions/${attempt.body.id}/review`).set(as('teacher')).send({ action: 'grade', score: 8, expectedGradedAt: null }).expect(200);
    await api().post(`/api/assignments/${assignment.body.id}/status`).set(as('teacher')).send({ action: 'close' }).expect(200);
    const exam = await api().post(`/api/classes/${classId}/exams`).set(as('teacher')).send({ title: { ar: 'اختبار الرحلة' }, type: 'quiz', maxScore: 20, passScore: 10, weight: 50, scheduledAt: ago(60) }).expect(201);
    await api().post(`/api/exams/${exam.body.id}/status`).set(as('teacher')).send({ action: 'schedule' }).expect(200);
    await api().put(`/api/exams/${exam.body.id}/results`).set(as('teacher')).send({ results: [{ studentId: fx['student'], status: 'scored', score: 16 }] }).expect(200);
    await api().post(`/api/exams/${exam.body.id}/status`).set(as('teacher')).send({ action: 'publish' }).expect(200);
    await api().post(`/api/classes/${classId}/final-grades`).set(as('teacher')).send({}).expect(200);

    // 6. Money: 600 invoiced from a plan, 400 paid in cash, 100 by card reversed.
    const plan = await api().post('/api/fee-plans').set(as('director')).send({ name: { ar: `خطة ${TAG}` }, classId, lines: [{ description: { ar: 'رسوم' }, amount: 600 }], installments: [{ percent: 100, dueOffsetDays: 0 }] }).expect(201);
    const batch = await api().post(`/api/classes/${classId}/invoices`).set(as('director')).send({ feePlanId: plan.body.id, issue: true }).expect(200);
    const invoice = batch.body.created[0] as { id: string; currency: string };
    await api().post(`/api/invoices/${invoice.id}/payments`).set(as('director')).send({ amount: 400, method: 'cash' }).expect(201);
    const card = await api().post(`/api/invoices/${invoice.id}/payments`).set(as('director')).send({ amount: 100, method: 'card' }).expect(201);
    await api().post(`/api/payments/${card.body.id}/reverse`).set(as('director')).send({ reason: 'خطأ' }).expect(200);

    // 7. The readers. Nothing they read is audited.
    const latest = (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;
    const byClass = await api().get(`/api/reports/attendance/classes?classId=${classId}`).set(as('clerk')).expect(200);
    expect(byClass.body.rows).toEqual([expect.objectContaining({ lessons: 1, completedLessons: 1, recordedLessons: 1, completedWithoutAttendance: 0, attendanceRate: 100 })]);
    const byStudent = await api().get(`/api/reports/attendance/students?classId=${classId}`).set(as('clerk')).expect(200);
    expect(byStudent.body.rows).toEqual([expect.objectContaining({ student: { id: fx['student'], fullName: `Journey student ${RUN}`, displayName: null }, enrollmentStatus: 'active', absenceRate: 0 })]);
    // The clerk (seeded staff) holds no academic key; the academic reader holds no other.
    expect((await api().get(`/api/reports/academic/classes?classId=${classId}`).set(as('clerk'))).status).toBe(403);
    expect((await api().get(`/api/reports/financial/collections?classId=${classId}`).set(as('reader'))).status).toBe(403);
    const performance = await api().get(`/api/reports/academic/classes?classId=${classId}`).set(as('reader')).expect(200);
    expect(performance.body.rows).toEqual([expect.objectContaining({ finalGrades: 1, averagePercent: 80 })]);
    const submissions = await api().get(`/api/reports/academic/assignments?classId=${classId}`).set(as('reader')).expect(200);
    expect(submissions.body.rows).toEqual([expect.objectContaining({ students: 1, submitted: 1, onTime: 1, graded: 1, averagePercent: 80 })]);
    const results = await api().get(`/api/reports/academic/exams?classId=${classId}`).set(as('reader')).expect(200);
    expect(results.body.rows).toEqual([expect.objectContaining({ scored: 1, averagePercent: 80, passed: 1, passRate: 100 })]);
    const collections = await api().get(`/api/reports/financial/collections?classId=${classId}`).set(as('clerk')).expect(200);
    expect(collections.body.rows).toEqual([expect.objectContaining({ method: 'cash', currency: invoice.currency, payments: 1, amount: 400 })]);
    expect(collections.body.reversed).toEqual([expect.objectContaining({ method: 'card', amount: 100 })]);
    const receivables = await api().get(`/api/reports/financial/receivables?classId=${classId}`).set(as('clerk')).expect(200);
    expect(receivables.body.rows).toEqual([expect.objectContaining({ student: expect.objectContaining({ id: fx['student'] }), total: 600, paid: 400, balance: 200, overdue: 0 })]);
    const revenue = await api().get(`/api/reports/financial/revenue?courseId=${courseId}`).set(as('clerk')).expect(200);
    expect(revenue.body.rows).toEqual([expect.objectContaining({ course: expect.objectContaining({ id: courseId }), currency: invoice.currency, invoices: 1, invoiced: 600, payments: 1, collected: 400 })]);
    const overview = await api().get('/api/reports/overview').set(as('clerk')).expect(200);
    expect(overview.body.academic).toBeNull();
    expect(overview.body.attendance).not.toBeNull();
    expect(overview.body.financial).not.toBeNull();
    // The teacher and the student read no report at all.
    for (const who of ['teacher', 'student']) expect((await api().get('/api/reports/overview').set(as(who))).body).toMatchObject({ code: 'permission_denied' });
    expect(await prisma.auditLog.count({ where: { id: { gt: latest }, actorUserId: { in: createdUserIds } } })).toBe(0);
  }, 60_000);
});
