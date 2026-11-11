// TEST-168 — MOD-13-T02 academic reports (API-158..160; roadmap §4k, D-R66..D-R73)
// against the live development database. Skipped when no database is reachable.
// The suite builds its own course, classes, students, grade scheme, final grades,
// assignments with attempts and exams with results straight through Prisma (codes
// carry a unique tag), reads the reports filtered by its own course and deletes
// everything at the end. Fixture users/roles carry a unique suffix (KI-032).
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
import { zonedInstant } from '../src/schedule/lesson-generation.plan.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const TAG = `RPK-${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 4)}`.toUpperCase();
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-168 supertest';
const BASE = '/api/reports/academic';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const PERIOD = 'from=2025-03-01&to=2025-03-31';

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

describe.skipIf(!available)('MOD-13 academic reports (e2e, TEST-168)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let zone: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let courseId: string;
  let schemeId: string;

  const email = (name: string) => `${name}-${RUN}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const at = (date: string, time = '10:00') => zonedInstant(date, time, zone);
  const get = (path: string, who = 'reporter') => api().get(`${BASE}/${path}`).set(bearer(who));

  async function createRole(name: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_${name}_${RUN}`, label: { ar: `دور اختبار ${name}` }, permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(name: string, roleIds: string[] = [], withPassword = true): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Academic ${name} ${RUN}`,
        passwordHash: withPassword ? await passwords.hash(PASSWORD) : null,
        status: 'active',
        roles: roleIds.length > 0 ? { create: roleIds.map((roleId) => ({ roleId })) } : undefined,
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    return user.id;
  }

  async function login(identifier: string): Promise<string> {
    const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier, password: PASSWORD }).expect(200);
    return res.body.accessToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    zone = (await prisma.academy.findFirst({ select: { timezone: true } }))?.timezone ?? 'UTC';

    await createUser('reporter', [await createRole('reporter', ['reports.academic.view'])]);
    await createUser('attendance', [await createRole('attendance', ['reports.attendance.view'])]);
    for (const name of ['reporter', 'attendance']) tokens[name] = await login(email(name));
    for (const name of ['s1', 's2', 's3']) await createUser(name, [], false);

    courseId = (await prisma.course.create({ data: { code: TAG, name: { ar: `دورة ${TAG}` }, status: 'published' }, select: { id: true } })).id;
    const classA = (await prisma.class.create({ data: { courseId, code: `${TAG}-A`, name: { ar: 'فصل أ' }, capacity: 20, status: 'completed' }, select: { id: true } })).id;
    const classB = (await prisma.class.create({ data: { courseId, code: `${TAG}-B`, name: { ar: 'فصل ب' }, capacity: 20, status: 'running' }, select: { id: true } })).id;
    ids['A'] = classA;
    ids['B'] = classB;
    const enroll = async (classId: string, student: string, status: 'active' | 'completed' | 'withdrawn') =>
      (await prisma.enrollment.create({ data: { classId, studentUserId: fx[student]!, status, withdrawnAt: status === 'withdrawn' ? new Date() : null }, select: { id: true } })).id;
    const eA1 = await enroll(classA, 's1', 'completed');
    const eA2 = await enroll(classA, 's2', 'completed');
    const eA3 = await enroll(classA, 's3', 'withdrawn');
    const eB1 = await enroll(classB, 's1', 'active');
    const eB2 = await enroll(classB, 's2', 'active');

    // API-158 — a scheme of the suite's own and five final grades, one finalized after the period.
    schemeId = (await prisma.gradeScheme.create({ data: { name: { ar: `سلّم ${TAG}` }, isDefault: false, isActive: true }, select: { id: true } })).id;
    const grade = (enrollmentId: string, percent: string, label: string, letter: string, isPass: boolean, finalizedAt: Date) =>
      prisma.finalGrade.create({ data: { enrollmentId, percent, schemeId, bandLabel: { ar: label }, bandLetter: letter, isPass, breakdown: [], finalizedAt } });
    await grade(eA1, '86.40', 'جيد جداً', 'B', true, at('2025-03-30'));
    await grade(eA2, '92.00', 'ممتاز', 'A', true, at('2025-03-30'));
    await grade(eA3, '40.00', 'راسب', 'F', false, at('2025-03-30'));
    await grade(eB1, '70.50', 'جيد جداً', 'B', true, at('2025-03-31', '23:00'));
    await grade(eB2, '99.00', 'ممتاز', 'A', true, at('2025-04-05'));

    // API-159 — class B: X1 (graded on time; returned then graded late with a 10 % penalty), X2 (undated, one waiting), a draft and one due after the period.
    const assignment = async (key: string, data: { status: 'draft' | 'open' | 'closed'; publishedAt: Date | null; dueAt: Date | null; maxScore: string; latePenaltyPercent?: string }) => {
      ids[key] = (
        await prisma.assignment.create({
          data: { classId: classB, title: { ar: `واجب ${key}` }, status: data.status, publishedAt: data.publishedAt, dueAt: data.dueAt, maxScore: data.maxScore, allowLate: data.latePenaltyPercent !== undefined, latePenaltyPercent: data.latePenaltyPercent ?? null, maxAttempts: 3 },
          select: { id: true },
        })
      ).id;
    };
    await assignment('X1', { status: 'open', publishedAt: at('2025-03-01'), dueAt: at('2025-03-10'), maxScore: '20', latePenaltyPercent: '10' });
    await assignment('X2', { status: 'closed', publishedAt: at('2025-03-05'), dueAt: null, maxScore: '10' });
    await assignment('X3', { status: 'draft', publishedAt: null, dueAt: at('2025-03-12'), maxScore: '10' });
    await assignment('X4', { status: 'open', publishedAt: at('2025-03-01'), dueAt: at('2025-04-10'), maxScore: '10' });
    const attempt = (key: string, student: string, attemptNo: number, data: { status: 'submitted' | 'graded' | 'returned'; isLate?: boolean; score?: string }) =>
      prisma.assignmentSubmission.create({
        data: {
          assignmentId: ids[key]!,
          studentUserId: fx[student]!,
          attemptNo,
          textAnswer: 'إجابة',
          isLate: data.isLate ?? false,
          status: data.status,
          score: data.score ?? null,
          feedback: data.status === 'returned' ? 'أعد المحاولة' : null,
          gradedAt: data.status === 'submitted' ? null : at('2025-03-12'),
        },
      });
    await attempt('X1', 's1', 1, { status: 'graded', score: '18' });
    await attempt('X1', 's2', 1, { status: 'returned', isLate: true });
    await attempt('X1', 's2', 2, { status: 'graded', isLate: true, score: '16' });
    await attempt('X2', 's1', 1, { status: 'submitted' });
    await attempt('X4', 's1', 1, { status: 'graded', score: '10' });

    // API-160 — class A (completed: its exams stay open, D-R33): E1 midterm with a pass score, E2 quiz published undated, E3 only scheduled.
    const exam = async (key: string, data: { type: 'midterm' | 'quiz'; status: 'scheduled' | 'published'; scheduledAt: Date | null; publishedAt: Date | null; maxScore: string; passScore?: string }) => {
      ids[key] = (
        await prisma.exam.create({
          data: { classId: classA, title: { ar: `اختبار ${key}` }, type: data.type, status: data.status, scheduledAt: data.scheduledAt, publishedAt: data.publishedAt, maxScore: data.maxScore, passScore: data.passScore ?? null },
          select: { id: true },
        })
      ).id;
    };
    await exam('E1', { type: 'midterm', status: 'published', scheduledAt: at('2025-03-20'), publishedAt: at('2025-03-21'), maxScore: '50', passScore: '25' });
    await exam('E2', { type: 'quiz', status: 'published', scheduledAt: null, publishedAt: at('2025-03-25'), maxScore: '20' });
    await exam('E3', { type: 'quiz', status: 'scheduled', scheduledAt: at('2025-03-26'), publishedAt: null, maxScore: '20' });
    await prisma.examResult.createMany({
      data: [
        { examId: ids['E1']!, studentUserId: fx['s1']!, status: 'scored', score: '40' },
        { examId: ids['E1']!, studentUserId: fx['s2']!, status: 'absent' },
        { examId: ids['E1']!, studentUserId: fx['s3']!, status: 'excused' },
        { examId: ids['E2']!, studentUserId: fx['s1']!, status: 'scored', score: '15' },
        { examId: ids['E3']!, studentUserId: fx['s1']!, status: 'scored', score: '20' },
      ],
    });
  }, 40_000);

  afterAll(async () => {
    try {
      if (prisma) {
        // Enrollments hold their class (Restrict) and take the final grades with them; a class takes its assignments, attempts, exams and results.
        await prisma.enrollment.deleteMany({ where: { class: { courseId } } });
        await prisma.class.deleteMany({ where: { courseId } });
        await prisma.course.deleteMany({ where: { id: courseId } });
        if (schemeId) await prisma.gradeScheme.deleteMany({ where: { id: schemeId } });
      }
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('AC1 — only reports.academic.view reads (the attendance key is not enough); nothing is audited', async () => {
    const latest = (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;
    for (const path of ['classes', 'assignments', 'exams']) {
      const denied = await get(`${path}?courseId=${courseId}`, 'attendance').expect(403);
      expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['reports.academic.view'] });
      await get(`${path}?courseId=${courseId}&${PERIOD}`).expect(200);
    }
    expect(await prisma.auditLog.count({ where: { id: { gt: latest }, actorUserId: { in: Object.values(fx) } } })).toBe(0);
  });

  it('AC2 — class and course performance from the final grades finalized in the period, with the frozen bands', async () => {
    const res = await get(`classes?courseId=${courseId}&${PERIOD}`).expect(200);
    expect(res.body).toMatchObject({ period: { from: '2025-03-01', to: '2025-03-31' }, timeZone: zone, truncated: false });
    expect(res.body.rows).toEqual([
      {
        class: { id: ids['A'], code: `${TAG}-A`, name: { ar: 'فصل أ' }, status: 'completed' },
        course: { id: courseId, code: TAG, name: { ar: `دورة ${TAG}` } },
        finalGrades: 3,
        averagePercent: 72.8,
        passed: 2,
        passRate: 66.67,
        bands: [
          { label: { ar: 'ممتاز' }, letter: 'A', count: 1 },
          { label: { ar: 'جيد جداً' }, letter: 'B', count: 1 },
          { label: { ar: 'راسب' }, letter: 'F', count: 1 },
        ],
      },
      {
        class: { id: ids['B'], code: `${TAG}-B`, name: { ar: 'فصل ب' }, status: 'running' },
        course: { id: courseId, code: TAG, name: { ar: `دورة ${TAG}` } },
        finalGrades: 1,
        averagePercent: 70.5,
        passed: 1,
        passRate: 100,
        bands: [{ label: { ar: 'جيد جداً' }, letter: 'B', count: 1 }],
      },
    ]);
    // A course mean is over every grade (288.9 ÷ 4 = 72.225 → 72.23), not a mean of the class means.
    expect(res.body.courses).toEqual([{ course: { id: courseId, code: TAG, name: { ar: `دورة ${TAG}` } }, classes: 2, finalGrades: 4, averagePercent: 72.23, passed: 3, passRate: 75 }]);
    expect(res.body.totals).toEqual({ classes: 2, finalGrades: 4, averagePercent: 72.23, passed: 3, passRate: 75 });
    const onlyB = await get(`classes?classId=${ids['B']}&${PERIOD}`).expect(200);
    expect(onlyB.body.rows.map((row: { class: { id: string } }) => row.class.id)).toEqual([ids['B']]);
  });

  it('AC3 — assignment submissions: on time and late, not submitted, the latest attempt’s state and the mean after the late penalty; drafts and later ones out', async () => {
    const res = await get(`assignments?courseId=${courseId}&${PERIOD}`).expect(200);
    expect(res.body.rows.map((row: { assignment: { id: string } }) => row.assignment.id)).toEqual([ids['X2'], ids['X1']]);
    const [x2, x1] = res.body.rows;
    expect(x1).toMatchObject({
      assignment: { id: ids['X1'], title: { ar: 'واجب X1' }, status: 'open', maxScore: 20, latePenaltyPercent: 10 },
      class: { id: ids['B'] },
      students: 2,
      submitted: 2,
      onTime: 1,
      late: 1,
      notSubmitted: 0,
      awaitingReview: 0,
      graded: 2,
      returned: 0,
      submissionRate: 100,
      onTimeRate: 50,
      // 18/20 = 90 and 16 × 0.9 / 20 = 72 → 81.
      averagePercent: 81,
    });
    expect(x2).toMatchObject({ assignment: { status: 'closed', dueAt: null }, students: 2, submitted: 1, onTime: 1, late: 0, notSubmitted: 1, awaitingReview: 1, graded: 0, submissionRate: 50, onTimeRate: 50, averagePercent: null });
    expect(res.body.totals).toEqual({ assignments: 2, students: 4, submitted: 3, onTime: 2, late: 1, notSubmitted: 1, awaitingReview: 1, graded: 2, returned: 0, submissionRate: 75, onTimeRate: 50, averagePercent: 81 });
    const open = await get(`assignments?courseId=${courseId}&${PERIOD}&status=open`).expect(200);
    expect(open.body.rows.map((row: { assignment: { id: string } }) => row.assignment.id)).toEqual([ids['X1']]);
    expect((await get(`assignments?status=draft`)).status).toBe(400);
  });

  it('AC4 — exam results: absent counts 0 and excused is left out of the mean; min/max of the scored; the pass rate against the pass score', async () => {
    const res = await get(`exams?courseId=${courseId}&${PERIOD}`).expect(200);
    expect(res.body.rows.map((row: { exam: { id: string } }) => row.exam.id)).toEqual([ids['E1'], ids['E2']]);
    const [e1, e2] = res.body.rows;
    expect(e1).toMatchObject({
      exam: { id: ids['E1'], title: { ar: 'اختبار E1' }, type: 'midterm', maxScore: 50, passScore: 25 },
      class: { id: ids['A'], status: 'completed' },
      students: 3,
      scored: 1,
      absent: 1,
      excused: 1,
      missing: 0,
      averagePercent: 40,
      minPercent: 80,
      maxPercent: 80,
      passed: 1,
      passRate: 50,
    });
    expect(e2).toMatchObject({ exam: { type: 'quiz', scheduledAt: null, passScore: null }, students: 2, scored: 1, absent: 0, excused: 0, missing: 1, averagePercent: 75, minPercent: 75, maxPercent: 75, passed: null, passRate: null });
    // (80 + 0 + 75) ÷ 3 = 51.67; one pass of two judged results.
    expect(res.body.totals).toEqual({ exams: 2, students: 5, scored: 2, absent: 1, excused: 1, missing: 1, averagePercent: 51.67, passRate: 50 });
    const quizzes = await get(`exams?courseId=${courseId}&${PERIOD}&type=quiz`).expect(200);
    expect(quizzes.body.rows.map((row: { exam: { id: string } }) => row.exam.id)).toEqual([ids['E2']]);
    expect((await get(`exams?type=essay`)).status).toBe(400);
    expect((await get(`exams?from=2025-04-01&to=2025-03-01`)).body).toMatchObject({ code: 'report_range_invalid' });
  });

  it(
    'documents the three routes in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      for (const path of ['classes', 'assignments', 'exams']) expect(Object.keys(docs.body.paths[`${BASE}/${path}`])).toEqual(['get']);
      for (const schema of ['ClassPerformanceReportDto', 'AssignmentSubmissionsReportDto', 'ExamResultsReportDto']) expect(docs.body.components.schemas).toHaveProperty(schema);
    },
    20_000,
  );
});
