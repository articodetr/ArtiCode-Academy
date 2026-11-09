// TEST-126 — the MOD-08 module gate (MOD-08-T05, CH-0119): WF-13 "set, submit
// and review an assignment" through the API against the live development
// database. A manager prepares the class (WF-03/WF-04: a class of a published
// course, its lead teacher, open, two active enrollments); the teacher (the
// seeded `teacher` system role) creates a draft with a due date, a late
// policy and one attempt, publishes it, and — once the first student has
// submitted on time — finds the grading rules locked while the due date still
// moves; the second student submits late (allowed and marked); the teacher
// returns the first attempt with feedback, the student submits again (one
// more attempt, now late), the teacher grades both students, closes the
// assignment and corrects a score after closing (D-R39). Each student (the
// seeded `student` role) and the guardian (the seeded `guardian` role) of one
// of them see the assignment and their own latest attempt in
// GET /api/me/assignments — never the weight, the reviewer's id, the answer
// or another student's attempt. The manager reads the journey's events in
// GET /api/audit-logs. Skipped when no database is reachable. Fixtures carry
// a unique prefix and are deleted at the end (their audit rows stay —
// KI-032). The browser journey waits for MOD-08-T06 (a collaborator task).
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
const PREFIX = `W${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-126 supertest';
const CLASSES = '/api/classes';
const ASSIGNMENTS = '/api/assignments';
const SUBMISSIONS = '/api/submissions';
const MY_ASSIGNMENTS = '/api/me/assignments';
const AUDIT = '/api/audit-logs';
const HOUR = 3_600_000;
/** An instant relative to now, as the API takes and returns it (UTC, milliseconds). */
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

interface MyAssignmentItem {
  id: string;
  status: string;
  relation: string;
  student: { id: string };
  attempts: number;
  latest: { id: string; attemptNo: number; isLate: boolean; status: string; score: number | null; feedback: string | null } | null;
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

describe.skipIf(!available)('WF-13 assignment journey — the MOD-08 gate (e2e, TEST-126)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let courseId: string;
  let academyTimeZone: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
  const mine = (name: string, query: Record<string, string> = {}) => api().get(MY_ASSIGNMENTS).query(query).set(bearer(name));
  const act = (assignmentId: string, action: string) => api().post(`${ASSIGNMENTS}/${assignmentId}/status`).set(bearer('teacher')).send({ action });
  const patch = (assignmentId: string, body: object) => api().patch(`${ASSIGNMENTS}/${assignmentId}`).set(bearer('teacher')).send(body);
  const submit = (assignmentId: string, body: object, as: string) => api().post(`${ASSIGNMENTS}/${assignmentId}/submissions`).set(bearer(as)).send(body);
  const review = (submissionId: string, body: object, as = 'teacher') => api().post(`${SUBMISSIONS}/${submissionId}/review`).set(bearer(as)).send(body);
  const read = (submissionId: string, as: string) => api().get(`${SUBMISSIONS}/${submissionId}`).set(bearer(as));
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

    // The manager holds the keys the preparation needs without the academy_admin
    // role itself (so TEST-026's last-admin test never touches it) — and reads
    // every class's assignments through classes.manage; everyone else holds the
    // real system role.
    const manager = await prisma.role.create({
      data: {
        key: `test_wf13_${RUN.toLowerCase()}`,
        label: { ar: 'دور اختبار WF-13' },
        permissions: {
          create: ['classes.read', 'classes.manage', 'classes.teachers.assign', 'enrollments.read', 'enrollments.manage', 'assignments.read', 'audit.read'].map((permissionKey) => ({ permissionKey })),
        },
      },
      select: { id: true },
    });
    createdRoleIds.push(manager.id);
    await createUser('manager', [manager.id]);
    await createUser('teacher', [await systemRole('teacher')]);
    const student = await systemRole('student');
    await createUser('student1', [student]);
    await createUser('student2', [student]);
    await createUser('guardian', [await systemRole('guardian')]);

    // Preconditions from other journeys: a published course (WF-05) and the guardian link of student1 (MOD-03-T09).
    courseId = (await prisma.course.create({ data: { code: `${PREFIX}-CRS`, name: { ar: 'دورة رحلة الواجبات' }, status: 'published' }, select: { id: true } })).id;
    await prisma.guardianStudent.create({ data: { guardianUserId: fx['guardian']!, studentUserId: fx['student1']!, relationship: 'mother', isPrimary: true } });
  });

  afterAll(async () => {
    try {
      // Enrollments first (Restrict on the class); the class takes its teachers, assignments and submissions (Cascade); then the course.
      if (prisma) {
        await prisma.enrollment.deleteMany({ where: { class: { code: { startsWith: PREFIX } } } });
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
      }
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('the teacher of a prepared class sets an assignment, takes an on-time and a late submission, returns one, grades both, closes it and corrects a score; students and a guardian see their own; the events are in the audit log', async () => {
    // Before the journey nobody has an assignment.
    for (const name of ['student1', 'student2', 'guardian']) expect((await mine(name).expect(200)).body).toEqual({ items: [], nextCursor: null });

    // 0. Preconditions (WF-03/WF-04): the manager creates the class, assigns the lead teacher, opens it and enrolls both students.
    const created = await api().post(CLASSES).set(bearer('manager')).send({ courseId, code: `${PREFIX}-A`, name: { ar: 'فصل رحلة الواجبات' }, capacity: 5 }).expect(201);
    const classId = created.body.id as string;
    await api().put(`${CLASSES}/${classId}/teachers`).set(bearer('manager')).send({ teachers: [{ userId: fx['teacher'], role: 'lead' }] }).expect(200);
    await api().post(`${CLASSES}/${classId}/status`).set(bearer('manager')).send({ action: 'open' }).expect(200);
    for (const name of ['student1', 'student2']) await api().post(`${CLASSES}/${classId}/enrollments`).set(bearer('manager')).send({ studentId: fx[name] }).expect(201);

    // 1. The teacher creates a draft due in two days: late submissions allowed with a 10 % penalty (recorded for MOD-09 — D-R36), one attempt.
    const dueOnTime = at(48 * HOUR);
    const draft = await api()
      .post(`${CLASSES}/${classId}/assignments`)
      .set(bearer('teacher'))
      .send({ title: { ar: 'واجب الوحدة الأولى', en: 'Unit one homework' }, instructions: { ar: 'حلّ التمارين من 1 إلى 5' }, maxScore: 20, weight: 10, dueAt: dueOnTime, allowLate: true, latePenaltyPercent: 10, maxAttempts: 1 })
      .expect(201);
    const assignmentId = draft.body.id as string;
    expect(draft.body).toMatchObject({
      class: { id: classId, code: `${PREFIX}-A`, status: 'open', course: { id: courseId, code: `${PREFIX}-CRS` } },
      lesson: null,
      title: { ar: 'واجب الوحدة الأولى', en: 'Unit one homework' },
      instructions: { ar: 'حلّ التمارين من 1 إلى 5' },
      status: 'draft',
      publishedAt: null,
      closedAt: null,
      dueAt: dueOnTime,
      timeZone: academyTimeZone,
      maxScore: 20,
      weight: 10,
      allowLate: true,
      latePenaltyPercent: 10,
      maxAttempts: 1,
      submissions: { students: 0, submitted: 0, graded: 0, returned: 0 },
      activeStudents: 2,
    });
    // A student holds assignments.submit by seed, never assignments.manage; a draft is invisible to learners and takes no submission.
    expect((await api().post(`${CLASSES}/${classId}/assignments`).set(bearer('student1')).send({ title: { ar: 'واجب' }, maxScore: 5 }).expect(403)).body.code).toBe('permission_denied');
    expect((await mine('student1').expect(200)).body.items).toEqual([]);
    expect((await submit(assignmentId, { textAnswer: 'مبكر' }, 'student1').expect(409)).body).toMatchObject({ code: 'assignment_closed', reason: 'not_published' });

    // 2. The teacher publishes it.
    const published = await act(assignmentId, 'publish').expect(200);
    expect(published.body).toMatchObject({ status: 'open', closedAt: null });
    expect(typeof published.body.publishedAt).toBe('string');

    // 3. Student1 submits a text answer before the due date.
    const s1a1 = await submit(assignmentId, { textAnswer: '  إجابات التمارين 1–4  ' }, 'student1').expect(201);
    expect(s1a1.body).toMatchObject({
      assignment: { id: assignmentId, classId, maxScore: 20, status: 'open', dueAt: dueOnTime },
      student: { id: fx['student1'], fullName: 'Test student1', displayName: null },
      attemptNo: 1,
      isLate: false,
      textAnswer: 'إجابات التمارين 1–4',
      linkUrl: null,
      status: 'submitted',
      score: null,
      gradedBy: null,
      attempts: 1,
      attemptsAllowed: 1,
    });

    // 4. With a submission in, the grading rules are locked; the due date is not — the teacher moves it to an hour ago (the deadline has passed).
    const locked = await patch(assignmentId, { maxScore: 25 }).expect(409);
    expect(locked.body).toMatchObject({ code: 'assignment_locked', status: 'open', fields: ['maxScore'], submissionCount: 1 });
    const duePast = at(-HOUR);
    expect((await patch(assignmentId, { dueAt: duePast }).expect(200)).body).toMatchObject({ dueAt: duePast, maxScore: 20, submissions: { students: 1, submitted: 1 } });

    // 5. Student2 submits a link after the due date: accepted (allowLate) and marked late.
    const s2a1 = await submit(assignmentId, { linkUrl: 'https://docs.example.com/student2' }, 'student2').expect(201);
    expect(s2a1.body).toMatchObject({ attemptNo: 1, isLate: true, textAnswer: null, linkUrl: 'https://docs.example.com/student2', status: 'submitted' });

    // 6. The teacher's roster: both students in enrollment order with their latest attempt, in the D-R07 projection and without any answer.
    const roster = await api().get(`${ASSIGNMENTS}/${assignmentId}/submissions`).set(bearer('teacher')).expect(200);
    expect(roster.body).toMatchObject({ assignment: { id: assignmentId, maxScore: 20 }, maxAttempts: 1 });
    const rows = roster.body.items as { student: { id: string; email: string | null }; enrollmentStatus: string; attempts: number; latest: { id: string; isLate: boolean; status: string } | null }[];
    expect(rows.map((row) => [row.student.id, row.student.email, row.enrollmentStatus, row.attempts, row.latest?.id, row.latest?.isLate, row.latest?.status])).toEqual([
      [fx['student1'], null, 'active', 1, s1a1.body.id, false, 'submitted'],
      [fx['student2'], null, 'active', 1, s2a1.body.id, true, 'submitted'],
    ]);
    expect(JSON.stringify(roster.body)).not.toContain('إجابات');

    // 7. The teacher returns student1's attempt with feedback (one more attempt — D-R39); the new attempt comes after the due date, so it is late; a third is refused.
    const returned = await review(s1a1.body.id as string, { action: 'return', feedback: 'أكمل التمرين 5' }).expect(200);
    expect(returned.body).toMatchObject({ status: 'returned', score: null, feedback: 'أكمل التمرين 5', gradedBy: { fullName: 'Test teacher', displayName: null }, attempts: 1, attemptsAllowed: 2 });
    const s1a2 = await submit(assignmentId, { textAnswer: 'إجابات التمارين 1–5', linkUrl: 'https://docs.example.com/student1' }, 'student1').expect(201);
    expect(s1a2.body).toMatchObject({ attemptNo: 2, isLate: true, status: 'submitted', attempts: 2, attemptsAllowed: 2 });
    expect((await submit(assignmentId, { textAnswer: 'محاولة ثالثة' }, 'student1').expect(409)).body).toMatchObject({ code: 'attempts_exhausted', maxAttempts: 2, attempts: 2 });

    // 8. Grading: out of range refused, a student cannot review; student1's second attempt 18 with feedback, student2's 15. The late penalty is not applied here (D-R36).
    expect((await review(s1a2.body.id as string, { action: 'grade', score: 25 }).expect(400)).body).toMatchObject({ code: 'score_out_of_range', score: 25, maxScore: 20 });
    expect((await review(s1a2.body.id as string, { action: 'grade', score: 20 }, 'student1').expect(403)).body.code).toBe('permission_denied');
    const graded = await review(s1a2.body.id as string, { action: 'grade', score: 18, feedback: 'أحسنت' }).expect(200);
    expect(graded.body).toMatchObject({ status: 'graded', score: 18, feedback: 'أحسنت', gradedBy: { fullName: 'Test teacher', displayName: null } });
    expect(typeof graded.body.gradedAt).toBe('string');
    expect((await review(s2a1.body.id as string, { action: 'grade', score: 15 }).expect(200)).body).toMatchObject({ status: 'graded', score: 15, feedback: null });

    // 9. A submission is read by its student and their guardian (the reviewer by name only) — not by the other student, nor by the guardian of someone else.
    const own = await read(s1a2.body.id as string, 'student1').expect(200);
    expect(own.body).toMatchObject({ id: s1a2.body.id, textAnswer: 'إجابات التمارين 1–5', linkUrl: 'https://docs.example.com/student1', status: 'graded', score: 18, feedback: 'أحسنت' });
    expect(own.body.gradedBy).not.toHaveProperty('userId');
    expect((await read(s1a2.body.id as string, 'guardian').expect(200)).body).toMatchObject({ id: s1a2.body.id, student: { id: fx['student1'] } });
    for (const [submissionId, stranger] of [
      [s1a2.body.id as string, 'student2'],
      [s2a1.body.id as string, 'student1'],
      [s2a1.body.id as string, 'guardian'],
    ] as const) {
      expect((await read(submissionId, stranger).expect(404)).body.code, stranger).toBe('submission_not_found');
    }

    // 10. «My assignments»: each student sees the assignment with their own latest attempt and its review; the guardian sees the child's; nothing else.
    const mine1 = await mine('student1').expect(200);
    expect(mine1.body.nextCursor).toBeNull();
    expect(mine1.body.items).toEqual([
      expect.objectContaining({
        id: assignmentId,
        status: 'open',
        dueAt: duePast,
        maxScore: 20,
        allowLate: true,
        latePenaltyPercent: 10,
        maxAttempts: 1,
        timeZone: academyTimeZone,
        relation: 'self',
        student: expect.objectContaining({ id: fx['student1'] }),
        class: expect.objectContaining({ id: classId }),
        attempts: 2,
        attemptsAllowed: 2,
        latest: expect.objectContaining({ id: s1a2.body.id, attemptNo: 2, isLate: true, status: 'graded', score: 18, feedback: 'أحسنت' }),
      }),
    ]);
    const serialized = JSON.stringify(mine1.body);
    for (const forbidden of ['weight', 'gradedBy', 'textAnswer', 'linkUrl', 'إجابات']) expect(serialized).not.toContain(forbidden);
    const mine2 = (await mine('student2').expect(200)).body.items as MyAssignmentItem[];
    expect(mine2.map((item) => [item.id, item.relation, item.student.id, item.attempts, item.latest])).toEqual([
      [assignmentId, 'self', fx['student2'], 1, expect.objectContaining({ id: s2a1.body.id, attemptNo: 1, isLate: true, status: 'graded', score: 15, feedback: null })],
    ]);
    const child = (await mine('guardian').expect(200)).body.items as MyAssignmentItem[];
    expect(child.map((item) => [item.id, item.relation, item.student.id, item.latest?.id, item.latest?.score])).toEqual([[assignmentId, 'child', fx['student1'], s1a2.body.id, 18]]);
    expect((await mine('guardian', { studentId: fx['student2']! }).expect(200)).body.items).toEqual([]);
    expect((await mine('student1', { pending: 'true' }).expect(200)).body.items).toEqual([]);
    expect((await mine('teacher').expect(200)).body.items).toEqual([]); // API-102 is theirs

    // 11. Learners read only their own: the seeded assignments.read of a student or guardian opens an empty list, no assignment and no roster.
    for (const learner of ['student1', 'guardian']) expect((await api().get(ASSIGNMENTS).query({ classId }).set(bearer(learner)).expect(200)).body.items, learner).toEqual([]);
    expect((await api().get(`${ASSIGNMENTS}/${assignmentId}`).set(bearer('student1')).expect(404)).body.code).toBe('assignment_not_found');
    expect((await api().get(`${ASSIGNMENTS}/${assignmentId}/submissions`).set(bearer('student1')).expect(404)).body.code).toBe('assignment_not_found');

    // 12. The teacher closes the assignment: no submission any more, even a late one; reviews stay open (D-R39) — the teacher corrects student2's score.
    const closed = await act(assignmentId, 'close').expect(200);
    expect(closed.body).toMatchObject({ status: 'closed', submissions: { students: 2, submitted: 0, graded: 2, returned: 0 } });
    expect(typeof closed.body.closedAt).toBe('string');
    expect((await submit(assignmentId, { textAnswer: 'بعد الإغلاق' }, 'student2').expect(409)).body).toMatchObject({ code: 'assignment_closed', reason: 'closed' });
    expect((await review(s2a1.body.id as string, { action: 'grade', score: 16, feedback: 'صُحّحت الدرجة' }).expect(200)).body).toMatchObject({ status: 'graded', score: 16 });
    expect(((await mine('student2').expect(200)).body.items as MyAssignmentItem[]).map((item) => [item.status, item.latest?.score, item.latest?.feedback])).toEqual([['closed', 16, 'صُحّحت الدرجة']]);

    // 13. The manager (classes.manage + assignments.read) sees the class's assignment with the counts by each student's latest attempt.
    const list = await api().get(ASSIGNMENTS).query({ classId }).set(bearer('manager')).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ id: assignmentId, status: 'closed', submissions: { students: 2, submitted: 0, graded: 2, returned: 0 }, activeStudents: 2 });

    // 14. The audit log: the teacher's events newest first — nothing for the refused requests — then each student's submissions and the manager's preparation.
    const teacherEvents = await events('teacher');
    expect(teacherEvents.map((item) => [item.action, item.entityType, item.entityId])).toEqual([
      ['assignments.graded', 'assignment_submissions', s2a1.body.id],
      ['assignments.status.changed', 'assignments', assignmentId],
      ['assignments.graded', 'assignment_submissions', s2a1.body.id],
      ['assignments.graded', 'assignment_submissions', s1a2.body.id],
      ['assignments.returned', 'assignment_submissions', s1a1.body.id],
      ['assignments.updated', 'assignments', assignmentId],
      ['assignments.status.changed', 'assignments', assignmentId],
      ['assignments.created', 'assignments', assignmentId],
    ]);
    const code = `${PREFIX}-A`;
    expect(teacherEvents[1]!.metadata).toEqual({ classId, code, action: 'close', from: 'open', to: 'closed' });
    expect(teacherEvents[4]!.metadata).toEqual({ assignmentId, classId, code, studentId: fx['student1'], attemptNo: 1, from: 'submitted' });
    expect(teacherEvents[5]!.metadata).toEqual({ classId, code, fields: ['dueAt'] });
    expect(teacherEvents[6]!.metadata).toEqual({ classId, code, action: 'publish', from: 'draft', to: 'open' });
    expect((await events('student1')).map((item) => [item.action, item.entityId, item.metadata?.['attemptNo'], item.metadata?.['isLate']])).toEqual([
      ['assignments.submitted', s1a2.body.id, 2, true],
      ['assignments.submitted', s1a1.body.id, 1, false],
    ]);
    expect((await events('student2')).map((item) => [item.action, item.entityId, item.metadata?.['isLate']])).toEqual([['assignments.submitted', s2a1.body.id, true]]);
    expect((await events('manager')).map((item) => item.action)).toEqual(['enrollments.created', 'enrollments.created', 'classes.status.changed', 'classes.teachers.changed', 'classes.created']);
    await api().get(AUDIT).set(bearer('teacher')).expect(403);
  });
});
