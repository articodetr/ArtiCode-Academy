// TEST-133 — the MOD-09 module gate (MOD-09-T07, CH-0172): WF-07 v1 "an exam
// with recorded results" and WF-08 "computing the grades" through the API
// against the live development database. A manager prepares the class
// (WF-03/WF-04: a class of a published course, its lead teacher, open, three
// active enrollments). WF-07 (D-R42/D-R47): the teacher (the seeded `teacher`
// system role) creates a draft exam with a weight, schedules it, records the
// results sheet — two scores and an excused student — corrects one score and
// publishes it; the learners see the exam once scheduled and their own result
// only once published. WF-08 (D-R43..D-R46): the teacher sets a weighted
// assignment with a late penalty, two students submit on time and one late,
// the teacher grades them; the gradebook computes each student's weighted
// average (the late penalty applied, the excused exam left out); a manager
// adds a grade scheme; finalization is refused while the class is open and
// while an assignment is open, then fixes every final grade with its band;
// «my grades» shows each student and the guardian their own; a later grade
// marks a final grade stale and finalizing again updates it; withdrawing and
// finalizing again restore them. The manager reads the journey's events in
// GET /api/audit-logs. Skipped when no database is reachable. Fixtures carry a
// unique prefix and are deleted at the end (their audit rows stay — KI-032).
// The browser journey waits for MOD-09-T08 (a collaborator task).
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
/** Prefix of the course and class codes. */
const PREFIX = `J${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-133 supertest';
const CLASSES = '/api/classes';
const ASSIGNMENTS = '/api/assignments';
const EXAMS = '/api/exams';
const MY_EXAMS = '/api/me/exams';
const MY_GRADES = '/api/me/grades';
const SCHEMES = '/api/grade-schemes';
const AUDIT = '/api/audit-logs';
const HOUR = 3_600_000;
/** An instant relative to now, as the API takes and returns it (UTC, milliseconds). */
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

interface MyExamItem {
  id: string;
  status: string;
  relation: string;
  student: { id: string };
  result: { status: string; score: number | null; feedback: string | null } | null;
}

interface FinalBody {
  percent: number;
  label: { ar: string };
  letter: string | null;
  isPass: boolean;
  stale: boolean;
  schemeId: string;
}

interface GradebookBody {
  components: { kind: string; id: string; weight: number | null; counted: boolean }[];
  students: {
    student: { id: string };
    cells: { id: string; status: string; score: number | null; effectiveScore: number | null; late: boolean }[];
    current: number | null;
    projected: number | null;
    final: FinalBody | null;
  }[];
  readiness: { openAssignments: number; awaitingReview: number; unpublishedExams: number; weightedComponents: number; ready: boolean };
}

interface MyGradeItem {
  relation: string;
  student: { id: string };
  class: { id: string };
  components: { kind: string; id: string; weight: number | null; maxScore: number; status: string; score: number | null; effectiveScore: number | null; late: boolean }[];
  final: { percent: number; label: { ar: string }; letter: string | null; isPass: boolean; finalizedAt: string } | null;
}

interface AuditItem {
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
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

describe.skipIf(!available)('WF-07/WF-08 exam and grades journey — the MOD-09 gate (e2e, TEST-133)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let courseId: string;
  let academyTimeZone: string;
  let schemeId: string | undefined;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
  const myExams = (name: string, query: Record<string, string> = {}) => api().get(MY_EXAMS).query(query).set(bearer(name));
  const myGrades = (name: string, query: Record<string, string> = {}) => api().get(MY_GRADES).query(query).set(bearer(name));
  const examAction = (examId: string, action: string) => api().post(`${EXAMS}/${examId}/status`).set(bearer('teacher')).send({ action });
  const results = (examId: string, rows: object[], as = 'teacher') => api().put(`${EXAMS}/${examId}/results`).set(bearer(as)).send({ results: rows });
  const assignmentAction = (assignmentId: string, action: string) => api().post(`${ASSIGNMENTS}/${assignmentId}/status`).set(bearer('teacher')).send({ action });
  const submit = (assignmentId: string, as: string) => api().post(`${ASSIGNMENTS}/${assignmentId}/submissions`).set(bearer(as)).send({ textAnswer: `حل ${as}` });
  const grade = (submissionId: string, score: number) => api().post(`/api/submissions/${submissionId}/review`).set(bearer('teacher')).send({ action: 'grade', score });
  const gradebook = (classId: string) => api().get(`${CLASSES}/${classId}/gradebook`).set(bearer('teacher'));
  const finalize = (classId: string, body: object) => api().post(`${CLASSES}/${classId}/final-grades`).set(bearer('teacher')).send(body);
  const studentOf = (body: GradebookBody, name: string) => body.students.find((entry) => entry.student.id === fx[name])!;
  const finals = (body: GradebookBody) => ['student1', 'student2', 'student3'].map((name) => studentOf(body, name).final);
  const events = async (actor: string): Promise<AuditItem[]> =>
    ((await api().get(AUDIT).query({ actorUserId: fx[actor]!, limit: 50 }).set(bearer('manager')).expect(200)).body.items as AuditItem[]).filter((item) => !item.action.startsWith('auth.'));

  async function createUser(name: string, roleIds: string[]): Promise<void> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Test ${name}`,
        passwordHash: await passwords.hash(PASSWORD),
        status: 'active',
        roles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
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
    academyTimeZone = (await prisma.academy.findFirstOrThrow({ select: { timezone: true } })).timezone;

    // The manager holds the keys the preparation and the grade scheme need
    // without the academy_admin role itself (so TEST-026's last-admin test never
    // touches it); everyone else holds the real system role.
    const manager = await prisma.role.create({
      data: {
        key: `test_wf08_${RUN.toLowerCase()}`,
        label: { ar: 'دور اختبار WF-08' },
        permissions: {
          create: ['classes.read', 'classes.manage', 'classes.teachers.assign', 'enrollments.read', 'enrollments.manage', 'academy.settings.manage', 'audit.read'].map((permissionKey) => ({ permissionKey })),
        },
      },
      select: { id: true },
    });
    createdRoleIds.push(manager.id);
    await createUser('manager', [manager.id]);
    await createUser('teacher', [await systemRole('teacher')]);
    const student = await systemRole('student');
    for (const name of ['student1', 'student2', 'student3']) await createUser(name, [student]);
    await createUser('guardian', [await systemRole('guardian')]);

    // Preconditions from other journeys: a published course (WF-05) and the guardian link of student1 (MOD-03-T09).
    courseId = (await prisma.course.create({ data: { code: `${PREFIX}-CRS`, name: { ar: 'دورة رحلة الدرجات' }, status: 'published' }, select: { id: true } })).id;
    await prisma.guardianStudent.create({ data: { guardianUserId: fx['guardian']!, studentUserId: fx['student1']!, relationship: 'mother', isPrimary: true } });
  }, 60_000);

  afterAll(async () => {
    try {
      // Final grades (Restrict on the scheme) and enrollments (Restrict on the class) first; the class takes its teachers, exams, results, assignments and submissions (Cascade); then the course and the scheme.
      if (prisma) {
        await prisma.finalGrade.deleteMany({ where: { enrollment: { class: { code: { startsWith: PREFIX } } } } });
        await prisma.enrollment.deleteMany({ where: { class: { code: { startsWith: PREFIX } } } });
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
        if (schemeId) await prisma.gradeScheme.deleteMany({ where: { id: schemeId } });
      }
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('the teacher records and publishes an exam, grades a weighted assignment, finalizes the class with a scheme, corrects, withdraws and finalizes again; students and a guardian see their own; the events are in the audit log', async () => {
    // Before the journey nobody has an exam or a grade.
    for (const name of ['student1', 'guardian']) {
      expect((await myExams(name).expect(200)).body).toEqual({ items: [], nextCursor: null });
      expect((await myGrades(name).expect(200)).body).toEqual({ items: [] });
    }

    // 0. Preconditions (WF-03/WF-04): the manager creates the class, assigns the lead teacher, opens it and enrolls three students.
    const code = `${PREFIX}-A`;
    const classId = (await api().post(CLASSES).set(bearer('manager')).send({ courseId, code, name: { ar: 'فصل رحلة الدرجات' }, capacity: 5 }).expect(201)).body.id as string;
    await api().put(`${CLASSES}/${classId}/teachers`).set(bearer('manager')).send({ teachers: [{ userId: fx['teacher'], role: 'lead' }] }).expect(200);
    await api().post(`${CLASSES}/${classId}/status`).set(bearer('manager')).send({ action: 'open' }).expect(200);
    for (const name of ['student1', 'student2', 'student3']) await api().post(`${CLASSES}/${classId}/enrollments`).set(bearer('manager')).send({ studentId: fx[name] }).expect(201);

    // ── WF-07 — an exam with recorded results (D-R42/D-R47) ──
    // 1. The teacher creates a draft midterm (max 50, pass 25, weight 60) for tomorrow; a student cannot; a draft takes no result and is invisible to learners.
    const scheduledAt = at(24 * HOUR);
    const draft = await api()
      .post(`${CLASSES}/${classId}/exams`)
      .set(bearer('teacher'))
      .send({ title: { ar: 'اختبار منتصف الفصل', en: 'Midterm' }, type: 'midterm', scheduledAt, durationMinutes: 90, maxScore: 50, passScore: 25, weight: 60 })
      .expect(201);
    const examId = draft.body.id as string;
    expect(draft.body).toMatchObject({
      class: { id: classId, code, status: 'open' },
      lesson: null,
      title: { ar: 'اختبار منتصف الفصل', en: 'Midterm' },
      type: 'midterm',
      status: 'draft',
      scheduledAt,
      durationMinutes: 90,
      timeZone: academyTimeZone,
      maxScore: 50,
      passScore: 25,
      weight: 60,
      publishedAt: null,
      results: { students: 0, scored: 0, absent: 0, excused: 0 },
      activeStudents: 3,
    });
    expect((await api().post(`${CLASSES}/${classId}/exams`).set(bearer('student1')).send({ title: { ar: 'اختبار' }, type: 'quiz', maxScore: 5 }).expect(403)).body.code).toBe('permission_denied');
    expect((await results(examId, [{ studentId: fx['student1'], status: 'scored', score: 40 }]).expect(409)).body).toMatchObject({ code: 'exam_not_recordable', reason: 'not_scheduled' });
    expect((await myExams('student1').expect(200)).body.items).toEqual([]);

    // 2. The teacher schedules it: the learners see the exam, without a result.
    expect((await examAction(examId, 'schedule').expect(200)).body).toMatchObject({ status: 'scheduled', publishedAt: null });
    expect(((await myExams('student1').expect(200)).body.items as MyExamItem[]).map((item) => [item.id, item.status, item.relation, item.result])).toEqual([[examId, 'scheduled', 'self', null]]);

    // 3. The results sheet: a score above the maximum is refused and a student cannot record; then two scores and an excused student, a correction, and an identical batch that writes nothing.
    expect((await results(examId, [{ studentId: fx['student1'], status: 'scored', score: 55 }]).expect(400)).body).toMatchObject({ code: 'score_out_of_range', score: 55, maxScore: 50, studentId: fx['student1'] });
    expect((await results(examId, [{ studentId: fx['student1'], status: 'scored', score: 50 }], 'student1').expect(403)).body.code).toBe('permission_denied');
    const recorded = await results(examId, [
      { studentId: fx['student1'], status: 'scored', score: 42, feedback: 'أداء ممتاز' },
      { studentId: fx['student2'], status: 'scored', score: 30 },
      { studentId: fx['student3'], status: 'excused' },
    ]).expect(200);
    expect(recorded.body).toMatchObject({ examId, classId, examStatus: 'scheduled', maxScore: 50, recordable: true, closedReason: null, counts: { students: 3, scored: 2, absent: 0, excused: 1 } });
    const sheet = recorded.body.items as { student: { id: string; email: string | null }; enrollmentStatus: string; result: { status: string; score: number | null; recordedBy: { fullName: string } | null } | null }[];
    expect(sheet.map((row) => [row.student.id, row.student.email, row.enrollmentStatus, row.result?.status, row.result?.score, row.result?.recordedBy?.fullName])).toEqual([
      [fx['student1'], null, 'active', 'scored', 42, 'Test teacher'],
      [fx['student2'], null, 'active', 'scored', 30, 'Test teacher'],
      [fx['student3'], null, 'active', 'excused', null, 'Test teacher'],
    ]);
    const corrected = await results(examId, [{ studentId: fx['student2'], status: 'scored', score: 35 }]).expect(200);
    expect(corrected.body.counts).toEqual({ students: 3, scored: 2, absent: 0, excused: 1 });
    await results(examId, [{ studentId: fx['student2'], status: 'scored', score: 35 }]).expect(200); // identical — no write, no event

    // 4. Unpublished results stay hidden from the learners.
    expect(((await myExams('student2').expect(200)).body.items as MyExamItem[]).map((item) => item.result)).toEqual([null]);

    // 5. The teacher publishes: each learner sees their own result — never the weight or the recorder.
    const published = await examAction(examId, 'publish').expect(200);
    expect(published.body).toMatchObject({ status: 'published', results: { students: 3, scored: 2, absent: 0, excused: 1 } });
    expect(typeof published.body.publishedAt).toBe('string');
    const exams1 = await myExams('student1').expect(200);
    expect((exams1.body.items as MyExamItem[]).map((item) => [item.id, item.status, item.relation, item.result])).toEqual([[examId, 'published', 'self', { status: 'scored', score: 42, feedback: 'أداء ممتاز' }]]);
    for (const forbidden of ['weight', 'recordedBy', 'recorded_by']) expect(JSON.stringify(exams1.body)).not.toContain(forbidden);
    expect(((await myExams('guardian').expect(200)).body.items as MyExamItem[]).map((item) => [item.relation, item.student.id, item.result?.score])).toEqual([['child', fx['student1'], 42]]);
    expect(((await myExams('student2').expect(200)).body.items as MyExamItem[]).map((item) => item.result)).toEqual([{ status: 'scored', score: 35, feedback: null }]);
    expect(((await myExams('student3').expect(200)).body.items as MyExamItem[]).map((item) => item.result)).toEqual([{ status: 'excused', score: null, feedback: null }]);

    // ── WF-08 — computing the grades (D-R43..D-R46) ──
    // 6. A weighted assignment (max 20, weight 40, late work with a 10 % penalty): student1 and student3 submit on time; the teacher moves the due date to an hour ago; student2 submits late.
    const assignment = await api()
      .post(`${CLASSES}/${classId}/assignments`)
      .set(bearer('teacher'))
      .send({ title: { ar: 'واجب موزون' }, maxScore: 20, weight: 40, dueAt: at(48 * HOUR), allowLate: true, latePenaltyPercent: 10, maxAttempts: 1 })
      .expect(201);
    const assignmentId = assignment.body.id as string;
    await assignmentAction(assignmentId, 'publish').expect(200);
    const sub1 = (await submit(assignmentId, 'student1').expect(201)).body.id as string;
    const sub3 = (await submit(assignmentId, 'student3').expect(201)).body.id as string;
    await api().patch(`${ASSIGNMENTS}/${assignmentId}`).set(bearer('teacher')).send({ dueAt: at(-HOUR) }).expect(200);
    const late = await submit(assignmentId, 'student2').expect(201);
    expect(late.body).toMatchObject({ attemptNo: 1, isLate: true });
    const sub2 = late.body.id as string;

    // 7. The teacher grades the three attempts: 18, 16 (late) and 12.
    for (const [submissionId, score] of [
      [sub1, 18],
      [sub2, 16],
      [sub3, 12],
    ] as const) {
      expect((await grade(submissionId, score).expect(200)).body).toMatchObject({ status: 'graded', score });
    }

    // 8. The gradebook is computed on read (D-R43/D-R44): 100 × Σ(w × effective ÷ max) ÷ Σw — the late penalty applied, the excused exam left out; nothing is final yet.
    const before = (await gradebook(classId).expect(200)).body as GradebookBody;
    expect(before.components.map((component) => [component.kind, component.id, component.weight, component.counted])).toEqual([
      ['assignment', assignmentId, 40, true],
      ['exam', examId, 60, true],
    ]);
    const s2 = studentOf(before, 'student2');
    expect(s2.cells.map((cell) => [cell.status, cell.score, cell.effectiveScore, cell.late])).toEqual([
      ['graded', 16, 14.4, true],
      ['scored', 35, 35, false],
    ]);
    // student1: 40 × 18/20 + 60 × 42/50 = 86.4; student2: 40 × 14.4/20 + 60 × 35/50 = 70.8; student3: (40 × 12/20) ÷ 40 = 60 (the exam excused).
    expect(['student1', 'student2', 'student3'].map((name) => [studentOf(before, name).current, studentOf(before, name).projected, studentOf(before, name).final])).toEqual([
      [86.4, 86.4, null],
      [70.8, 70.8, null],
      [60, 60, null],
    ]);
    expect(studentOf(before, 'student3').cells[1]).toMatchObject({ status: 'excused', score: null, effectiveScore: null });
    expect(before.readiness).toEqual({ openAssignments: 1, awaitingReview: 0, unpublishedExams: 0, weightedComponents: 2, ready: false });
    // No running average for the learners (D-R48): «my grades» shows the components and no final grade yet.
    const early = (await myGrades('student1').expect(200)).body.items as MyGradeItem[];
    expect(early.map((item) => [item.class.id, item.relation, item.components.length, item.final])).toEqual([[classId, 'self', 2, null]]);

    // 9. The manager (academy.settings.manage) adds a grade scheme (D-R46); the teacher cannot.
    const bands = [
      { minPercent: 0, label: { ar: 'راسب' }, letter: 'F', isPass: false },
      { minPercent: 50, label: { ar: 'مقبول' }, letter: 'D', isPass: true },
      { minPercent: 65, label: { ar: 'جيد' }, letter: 'C', isPass: true },
      { minPercent: 80, label: { ar: 'ممتاز' }, letter: 'A', isPass: true },
    ];
    expect((await api().post(SCHEMES).set(bearer('teacher')).send({ name: { ar: `${PREFIX} سلّم` }, bands }).expect(403)).body.code).toBe('permission_denied');
    const scheme = await api().post(SCHEMES).set(bearer('manager')).send({ name: { ar: `${PREFIX} سلّم` }, bands }).expect(201);
    schemeId = scheme.body.id as string;
    expect(scheme.body).toMatchObject({ isActive: true, bands: bands.map((band) => expect.objectContaining({ minPercent: band.minPercent, letter: band.letter, isPass: band.isPass })) });

    // 10. Finalization (D-R45) is refused while the class is open, then while the assignment is open; once the teacher closes it, every active student gets a final grade with its band.
    expect((await finalize(classId, { schemeId }).expect(409)).body).toMatchObject({ code: 'class_not_gradable', status: 'open' });
    await api().post(`${CLASSES}/${classId}/status`).set(bearer('manager')).send({ action: 'start' }).expect(200);
    expect((await finalize(classId, { schemeId }).expect(409)).body).toMatchObject({ code: 'grades_not_ready', openAssignments: 1, awaitingReview: 0, unpublishedExams: 0 });
    await assignmentAction(assignmentId, 'close').expect(200);
    const fixed = (await finalize(classId, { schemeId }).expect(200)).body as GradebookBody;
    expect(fixed.readiness.ready).toBe(true);
    expect(finals(fixed)).toEqual([
      expect.objectContaining({ percent: 86.4, label: { ar: 'ممتاز' }, letter: 'A', isPass: true, stale: false, schemeId }),
      expect.objectContaining({ percent: 70.8, label: { ar: 'جيد' }, letter: 'C', isPass: true, stale: false, schemeId }),
      expect.objectContaining({ percent: 60, label: { ar: 'مقبول' }, letter: 'D', isPass: true, stale: false, schemeId }),
    ]);

    // 11. «My grades» (D-R48): each student sees their own components and final grade; the guardian the child's; a teacher holds neither key.
    const grades1 = await myGrades('student1').expect(200);
    expect(grades1.body.items).toEqual([
      expect.objectContaining({
        relation: 'self',
        enrollmentStatus: 'active',
        student: expect.objectContaining({ id: fx['student1'] }),
        class: expect.objectContaining({ id: classId, code }),
        components: [
          { kind: 'assignment', id: assignmentId, title: { ar: 'واجب موزون' }, weight: 40, maxScore: 20, status: 'graded', score: 18, effectiveScore: 18, late: false },
          { kind: 'exam', id: examId, title: { ar: 'اختبار منتصف الفصل', en: 'Midterm' }, weight: 60, maxScore: 50, status: 'scored', score: 42, effectiveScore: 42, late: false },
        ],
        final: { percent: 86.4, label: { ar: 'ممتاز' }, letter: 'A', isPass: true, finalizedAt: expect.any(String) },
      }),
    ]);
    for (const forbidden of ['breakdown', 'gradedBy', 'recordedBy', 'finalizedBy', 'schemeId', 'current', 'projected']) expect(JSON.stringify(grades1.body)).not.toContain(forbidden);
    const child = (await myGrades('guardian').expect(200)).body.items as MyGradeItem[];
    expect(child.map((item) => [item.relation, item.student.id, item.final?.percent, item.final?.letter])).toEqual([['child', fx['student1'], 86.4, 'A']]);
    expect((await myGrades('guardian', { studentId: fx['student2']! }).expect(200)).body.items).toEqual([]);
    const grades2 = (await myGrades('student2').expect(200)).body.items as MyGradeItem[];
    expect(grades2.map((item) => [item.components[0]!.effectiveScore, item.components[0]!.late, item.final?.percent])).toEqual([[14.4, true, 70.8]]);
    expect(((await myGrades('student3').expect(200)).body.items as MyGradeItem[]).map((item) => [item.components[1]!.status, item.final?.percent])).toEqual([['excused', 60]]);
    expect((await myGrades('teacher').expect(403)).body).toMatchObject({ code: 'permission_denied', missing: ['grades.read_own', 'grades.read_linked'] });

    // 12. A later grade marks the final grade stale (the closed assignment keeps its reviews open — D-R39); finalizing again updates only that student.
    await grade(sub2, 18).expect(200); // 18 late → 16.2; 40 × 16.2/20 + 42 = 74.4
    const stale = (await gradebook(classId).expect(200)).body as GradebookBody;
    expect(studentOf(stale, 'student2')).toMatchObject({ projected: 74.4, final: { percent: 70.8, stale: true } });
    expect(studentOf(stale, 'student1').final).toMatchObject({ stale: false });
    const refixed = (await finalize(classId, { schemeId }).expect(200)).body as GradebookBody;
    expect(studentOf(refixed, 'student2').final).toMatchObject({ percent: 74.4, letter: 'C', stale: false });

    // 13. Withdrawing removes every final grade of the class (the learners see none); finalizing again restores them.
    const withdrawn = (await api().delete(`${CLASSES}/${classId}/final-grades`).set(bearer('teacher')).expect(200)).body as GradebookBody;
    expect(finals(withdrawn)).toEqual([null, null, null]);
    expect(((await myGrades('student1').expect(200)).body.items as MyGradeItem[]).map((item) => item.final)).toEqual([null]);
    const again = (await finalize(classId, { schemeId }).expect(200)).body as GradebookBody;
    expect(finals(again).map((final) => [final?.percent, final?.letter])).toEqual([
      [86.4, 'A'],
      [74.4, 'C'],
      [60, 'D'],
    ]);
    expect(await prisma.finalGrade.count({ where: { enrollment: { classId } } })).toBe(3);

    // 14. The audit log: the teacher's events newest first — nothing for the refused requests or the identical batch — then the students' submissions and the manager's preparation.
    const teacherEvents = await events('teacher');
    expect(teacherEvents.map((item) => [item.action, item.entityType, item.entityId])).toEqual([
      ['grades.finalized', 'classes', classId],
      ['grades.withdrawn', 'classes', classId],
      ['grades.finalized', 'classes', classId],
      ['assignments.graded', 'assignment_submissions', sub2],
      ['grades.finalized', 'classes', classId],
      ['assignments.status.changed', 'assignments', assignmentId],
      ['assignments.graded', 'assignment_submissions', sub3],
      ['assignments.graded', 'assignment_submissions', sub2],
      ['assignments.graded', 'assignment_submissions', sub1],
      ['assignments.updated', 'assignments', assignmentId],
      ['assignments.status.changed', 'assignments', assignmentId],
      ['assignments.created', 'assignments', assignmentId],
      ['exams.status.changed', 'exams', examId],
      ['exams.results.recorded', 'exams', examId],
      ['exams.results.recorded', 'exams', examId],
      ['exams.status.changed', 'exams', examId],
      ['exams.created', 'exams', examId],
    ]);
    expect(teacherEvents.map((item) => item.metadata).filter((_, index) => [0, 1, 2, 4].includes(index))).toEqual([
      { code, schemeId, created: 3, updated: 0 },
      { code, count: 3 },
      { code, schemeId, created: 0, updated: 1 },
      { code, schemeId, created: 3, updated: 0 },
    ]);
    expect(teacherEvents[12]!.metadata).toEqual({ classId, code, action: 'publish', from: 'scheduled', to: 'published' });
    expect(teacherEvents[13]!.metadata).toEqual({ classId, code, created: 0, updated: 1, counts: { students: 3, scored: 2, absent: 0, excused: 1 } });
    expect(teacherEvents[14]!.metadata).toEqual({ classId, code, created: 3, updated: 0, counts: { students: 3, scored: 2, absent: 0, excused: 1 } });
    expect(teacherEvents[15]!.metadata).toEqual({ classId, code, action: 'schedule', from: 'draft', to: 'scheduled' });
    expect(teacherEvents[16]!.metadata).toEqual({ classId, code, type: 'midterm' });
    for (const [name, submissionId, isLate] of [
      ['student1', sub1, false],
      ['student2', sub2, true],
      ['student3', sub3, false],
    ] as const) {
      expect((await events(name)).map((item) => [item.action, item.entityId, item.metadata?.['isLate']]), name).toEqual([['assignments.submitted', submissionId, isLate]]);
    }
    expect((await events('manager')).map((item) => [item.action, item.entityId])).toEqual([
      ['classes.status.changed', classId],
      ['grade_schemes.created', schemeId],
      ['enrollments.created', expect.any(String)],
      ['enrollments.created', expect.any(String)],
      ['enrollments.created', expect.any(String)],
      ['classes.status.changed', classId],
      ['classes.teachers.changed', classId],
      ['classes.created', classId],
    ]);
    expect((await events('guardian'))).toEqual([]);
    await api().get(AUDIT).set(bearer('teacher')).expect(403);
  }, 60_000);
});
