// TEST-124 — MOD-08-T03 submissions and review (API-108..API-111) against the
// live development database. Skipped when no database is reachable. Fixture
// users (teachers with the system `teacher` role, students with `student`, a
// guardian with `guardian` and a linked user without it), roles, a published
// course, classes, enrollments, assignments and submissions carry a unique
// prefix and are deleted at the end — enrollments first (they restrict their
// class), then the classes (assignments and submissions cascade), the course,
// the users (their guardian links cascade) and the roles. Audit events are
// counted by fixture actor above an id watermark.
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
import type { EnrollmentStatus } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `S${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-124 supertest';
const CLASSES = '/api/classes';
const ASSIGNMENTS = '/api/assignments';
const SUBMISSIONS = '/api/submissions';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const SUBMISSION_KEYS = [
  'assignment',
  'attemptNo',
  'attempts',
  'attemptsAllowed',
  'feedback',
  'gradedAt',
  'gradedBy',
  'history',
  'id',
  'isLate',
  'linkUrl',
  'score',
  'status',
  'student',
  'submittedAt',
  'textAnswer',
];

interface SubmissionBody {
  id: string;
  assignment: { id: string; classId: string; maxScore: number; status: string; dueAt: string | null };
  student: { id: string; fullName: string; displayName: string | null };
  attemptNo: number;
  isLate: boolean;
  textAnswer: string | null;
  linkUrl: string | null;
  status: string;
  score: number | null;
  feedback: string | null;
  gradedBy: { fullName: string; displayName: string | null } | null;
  gradedAt: string | null;
  attempts: number;
  attemptsAllowed: number;
  history: { id: string; attemptNo: number; status: string; score: number | null }[];
}

interface RosterItem {
  student: { id: string; email: string | null };
  enrollmentStatus: string | null;
  attempts: number;
  attemptsAllowed: number;
  latest: { id: string; attemptNo: number; status: string; score: number | null } | null;
  lastGradedScore: number | null;
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

describe.skipIf(!available)('MOD-08 submissions and review (e2e, TEST-124)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let courseId: string;
  let academyTimeZone: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const classes: Record<string, string> = {};
  const assignments: Record<string, string> = {};
  const actors: string[] = [];

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name.toLowerCase()}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  const submit = (assignment: string, body: object, as: string) => api().post(`${ASSIGNMENTS}/${assignments[assignment] ?? assignment}/submissions`).set(bearer(as)).send(body);
  const roster = (assignment: string, as = 'teacher') => api().get(`${ASSIGNMENTS}/${assignments[assignment] ?? assignment}/submissions`).set(bearer(as));
  const read = (submissionId: string, as: string) => api().get(`${SUBMISSIONS}/${submissionId}`).set(bearer(as));
  const review = (submissionId: string, body: object, as = 'teacher') => api().post(`${SUBMISSIONS}/${submissionId}/review`).set(bearer(as)).send(body);

  async function createRole(name: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_${name}_${RUN.toLowerCase()}`, label: { ar: `دور اختبار ${name}` }, permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(name: string, roleIds: string[]): Promise<void> {
    const user = await prisma.user.create({
      data: { email: email(name), fullName: `Test ${name}`, passwordHash: await passwords.hash(PASSWORD), status: 'active', roles: { create: roleIds.map((roleId) => ({ roleId })) } },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(name), password: PASSWORD }).expect(200);
    tokens[name] = res.body.accessToken as string;
    actors.push(user.id);
  }

  async function mark(): Promise<string> {
    const latest = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return latest?.id ?? NIL_ID;
  }
  const eventsSince = (markId: string) => prisma.auditLog.findMany({ where: { id: { gt: markId }, actorUserId: { in: actors } }, orderBy: { id: 'asc' } });

  async function createClass(suffix: string, teachers: string[]): Promise<void> {
    const res = await api().post(CLASSES).set(bearer('manager')).send({ courseId, code: code(suffix), name: { ar: `فصل ${suffix}` }, capacity: 10 }).expect(201);
    classes[suffix] = res.body.id as string;
    await api()
      .put(`${CLASSES}/${classes[suffix]}/teachers`)
      .set(bearer('manager'))
      .send({ teachers: teachers.map((userId, index) => ({ userId, role: index === 0 ? 'lead' : 'assistant' })) })
      .expect(200);
    await api().post(`${CLASSES}/${classes[suffix]}/status`).set(bearer('manager')).send({ action: 'open' }).expect(200);
  }

  async function enroll(suffix: string, student: string, status: EnrollmentStatus = 'active'): Promise<void> {
    await prisma.enrollment.create({ data: { classId: classes[suffix]!, studentUserId: id(student), status, activatedAt: new Date() }, select: { id: true } });
  }

  async function createAssignment(name: string, suffix: string, over: Record<string, unknown>, actions: string[] = ['publish']): Promise<void> {
    const res = await api()
      .post(`${CLASSES}/${classes[suffix]}/assignments`)
      .set(bearer('manager'))
      .send({ title: { ar: `واجب ${name}` }, maxScore: 20, ...over })
      .expect(201);
    assignments[name] = res.body.id as string;
    for (const action of actions) await api().post(`${ASSIGNMENTS}/${assignments[name]}/status`).set(bearer('manager')).send({ action }).expect(200);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    academyTimeZone = (await prisma.academy.findFirstOrThrow({ select: { timezone: true } })).timezone;

    courseId = (await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة التسليم' }, status: 'published' }, select: { id: true } })).id;
    const systemRole = async (key: string) => (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
    const teacherRole = await systemRole('teacher');
    const studentRole = await systemRole('student');
    const guardianRole = await systemRole('guardian');
    const manager = await createRole('smanager', ['classes.read', 'classes.manage', 'classes.teachers.assign', 'assignments.read', 'assignments.manage', 'assignments.grade']);
    const grading = await createRole('sgrader', ['classes.read', 'assignments.read', 'assignments.manage', 'assignments.grade']);
    const reading = await createRole('sreader', ['classes.read', 'assignments.read', 'assignments.manage']);
    const outsider = await createRole('soutsider', ['courses.read']);
    const noGrade = await createRole('snograde', ['classes.read', 'classes.manage', 'assignments.read']);
    await createUser('manager', [manager]);
    await createUser('teacher', [grading, teacherRole]);
    await createUser('assistant', [reading, teacherRole]);
    await createUser('teacher2', [grading, teacherRole]);
    await createUser('outsider', [outsider]);
    await createUser('nograder', [noGrade]);
    for (const student of ['student1', 'student2', 'student3', 'student4']) await createUser(student, [studentRole]);
    await createUser('guardian', [guardianRole]);
    await createUser('linkedNoRole', [outsider]);
    for (const guardian of ['guardian', 'linkedNoRole']) {
      await prisma.guardianStudent.create({ data: { guardianUserId: id(guardian), studentUserId: id('student1'), relationship: 'father' }, select: { studentUserId: true } });
    }

    await createClass('A', [id('teacher'), id('assistant')]);
    await createClass('B', [id('teacher2')]);
    await enroll('A', 'student1');
    await enroll('A', 'student2');
    await enroll('A', 'student3', 'withdrawn');
    await enroll('B', 'student4');

    await createAssignment('one', 'A', { maxAttempts: 1, dueAt: '2030-01-01T00:00:00Z' });
    await createAssignment('late', 'A', { dueAt: '2020-01-01T00:00:00Z', allowLate: true, latePenaltyPercent: 10 });
    await createAssignment('past', 'A', { dueAt: '2020-01-01T00:00:00Z' });
    await createAssignment('draft', 'A', {}, []);
    await createAssignment('closed', 'A', {}, ['publish', 'close']);
    await createAssignment('race', 'A', { maxAttempts: 1 });
    await createAssignment('guard', 'A', { maxAttempts: 2 });
  }, 30_000); // eleven accounts hashed and signed in with Argon2 take ~10 s on a slow machine

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.enrollment.deleteMany({ where: { classId: { in: Object.values(classes) } } });
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

  it('AC1 — an actively enrolled student submits text and/or a link to an open assignment; one event by the student', async () => {
    const m = await mark();
    const res = await submit('one', { textAnswer: '  إجابتي الأولى  ' }, 'student1');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const body = res.body as SubmissionBody;
    expect(Object.keys(body).sort()).toEqual([...SUBMISSION_KEYS].sort());
    expect(body).toMatchObject({
      assignment: { id: assignments['one'], classId: classes['A'], maxScore: 20, status: 'open', dueAt: '2030-01-01T00:00:00.000Z' },
      student: { id: id('student1'), fullName: 'Test student1', displayName: null },
      attemptNo: 1,
      isLate: false,
      textAnswer: 'إجابتي الأولى',
      linkUrl: null,
      status: 'submitted',
      score: null,
      feedback: null,
      gradedBy: null,
      gradedAt: null,
      attempts: 1,
      attemptsAllowed: 1,
    });
    // MOD-08-T07: the assignment says whether late work is taken and the zone its due date reads in; the history lists the attempts.
    expect(body.assignment).toMatchObject({ allowLate: false, timeZone: academyTimeZone });
    expect(body.history).toEqual([{ id: body.id, attemptNo: 1, submittedAt: expect.any(String), isLate: false, status: 'submitted', score: null, gradedAt: null }]);
    fx['sub1'] = body.id;
    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.entityType, event.entityId, event.actorUserId])).toEqual([['assignments.submitted', 'assignment_submissions', body.id, id('student1')]]);
    expect(events[0]!.metadata).toEqual({ assignmentId: assignments['one'], classId: classes['A'], code: code('A'), attemptNo: 1, isLate: false });

    const linkOnly = await submit('one', { linkUrl: 'https://docs.example.com/s2' }, 'student2');
    expect(linkOnly.status).toBe(201);
    expect(linkOnly.body).toMatchObject({ textAnswer: null, linkUrl: 'https://docs.example.com/s2', attemptNo: 1 });
    fx['sub2'] = linkOnly.body.id as string;
    const late = await submit('late', { textAnswer: 'متأخر' }, 'student1');
    expect(late.status).toBe(201);
    expect(late.body).toMatchObject({ isLate: true, assignment: { allowLate: true } });
  });

  it('AC2 — refusals: no content, bad link, not enrolled, withdrawn, draft, closed, past due, exhausted, no key, unknown — all without an event', async () => {
    const m = await mark();
    expect((await submit('one', {}, 'student2')).body).toMatchObject({ code: 'submission_invalid' });
    expect((await submit('one', { textAnswer: '   ' }, 'student2')).body).toMatchObject({ code: 'submission_invalid' });
    expect((await submit('one', { linkUrl: 'http://docs.example.com/x' }, 'student2')).status).toBe(400);
    expect((await submit('one', { textAnswer: 'x', fileId: NIL_ID }, 'student2')).status).toBe(400);
    const other = await submit('one', { textAnswer: 'x' }, 'student4');
    expect(other.status).toBe(403);
    expect(other.body).toMatchObject({ code: 'not_enrolled', classId: classes['A'] });
    expect((await submit('one', { textAnswer: 'x' }, 'student3')).body).toMatchObject({ code: 'not_enrolled' });
    expect((await submit('draft', { textAnswer: 'x' }, 'student1')).body).toMatchObject({ code: 'assignment_closed', reason: 'not_published', dueAt: null });
    expect((await submit('closed', { textAnswer: 'x' }, 'student1')).body).toMatchObject({ code: 'assignment_closed', reason: 'closed' });
    const past = await submit('past', { textAnswer: 'x' }, 'student1');
    expect(past.status).toBe(409);
    expect(past.body).toMatchObject({ code: 'assignment_closed', reason: 'past_due', dueAt: '2020-01-01T00:00:00.000Z' });
    const exhausted = await submit('one', { textAnswer: 'مرة ثانية' }, 'student1');
    expect(exhausted.status).toBe(409);
    expect(exhausted.body).toMatchObject({ code: 'attempts_exhausted', maxAttempts: 1, attempts: 1 });
    expect((await submit('one', { textAnswer: 'x' }, 'teacher')).status).toBe(403); // no assignments.submit
    expect((await submit(NIL_ID, { textAnswer: 'x' }, 'student1')).body).toMatchObject({ code: 'assignment_not_found' });
    expect(await eventsSince(m)).toEqual([]);
  });

  it('AC3 — the roster lists the active and completed students with their attempts, in the caller’s projection; other teachers 404, no key 403', async () => {
    const res = await roster('one');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ assignment: { id: assignments['one'], maxScore: 20 }, maxAttempts: 1 });
    const items = res.body.items as RosterItem[];
    expect(items.map((item) => item.student.id)).toEqual([id('student1'), id('student2')]); // the withdrawn student3 holds nothing here
    expect(items[0]).toMatchObject({ enrollmentStatus: 'active', attempts: 1, attemptsAllowed: 1, latest: { id: fx['sub1'], attemptNo: 1, status: 'submitted', score: null }, lastGradedScore: null });
    expect(items[0]!.student.email).toBeNull(); // no users.read_contact
    expect(JSON.stringify(res.body)).not.toContain('إجابتي'); // no answer text in the roster
    expect((await roster('one', 'assistant')).status).toBe(200);
    expect((await roster('one', 'teacher2')).body).toMatchObject({ code: 'assignment_not_found' });
    expect((await roster('one', 'outsider')).status).toBe(403);
    expect((await roster('one', 'student1')).body).toMatchObject({ code: 'assignment_not_found' }); // students hold assignments.read but teach nothing
  });

  it('AC4 — a grading teacher grades (0..maxScore) and returns with feedback; a return grants one more attempt; an identical review writes nothing; a closed assignment stays reviewable', async () => {
    const sub1 = fx['sub1']!;
    const m = await mark();
    expect((await review(sub1, { action: 'grade', score: 10 }, 'nograder')).status).toBe(403); // classes.manage + assignments.read, no assignments.grade (the seeded teacher role carries it)
    expect((await review(sub1, { action: 'grade', score: 10 }, 'teacher2')).body).toMatchObject({ code: 'submission_not_found' });
    expect((await review(sub1, { action: 'grade', score: 25 })).body).toMatchObject({ code: 'score_out_of_range', score: 25, maxScore: 20 });
    expect((await review(sub1, { action: 'grade', score: -1 })).body).toMatchObject({ code: 'score_out_of_range' });
    expect((await review(sub1, { action: 'grade' })).status).toBe(400);
    expect((await review(sub1, { action: 'grade', score: '10' })).status).toBe(400);
    expect((await review(sub1, { action: 'return', score: 10, feedback: 'x' })).status).toBe(400);
    expect((await review(sub1, { action: 'return' })).body).toMatchObject({ code: 'feedback_required' });
    expect((await review(NIL_ID, { action: 'grade', score: 1 })).body).toMatchObject({ code: 'submission_not_found' });
    expect(await eventsSince(m)).toEqual([]);

    const graded = await review(sub1, { action: 'grade', score: 17.5, feedback: ' جيد ' });
    expect(graded.status, JSON.stringify(graded.body)).toBe(200);
    expect(graded.body).toMatchObject({ status: 'graded', score: 17.5, feedback: 'جيد', gradedBy: { fullName: 'Test teacher' } });
    expect(typeof graded.body.gradedAt).toBe('string');
    await review(sub1, { action: 'grade', score: 17.5, feedback: 'جيد' }).expect(200); // identical — nothing written
    await review(sub1, { action: 'grade', score: 18 }).expect(200); // the feedback is cleared with it
    const returned = await review(sub1, { action: 'return', feedback: 'أكمل السؤال الثاني' });
    expect(returned.body).toMatchObject({ status: 'returned', score: null, feedback: 'أكمل السؤال الثاني', attempts: 1, attemptsAllowed: 2 });
    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.entityId])).toEqual([
      ['assignments.graded', sub1],
      ['assignments.graded', sub1],
      ['assignments.returned', sub1],
    ]);
    expect(events[0]!.metadata).toEqual({ assignmentId: assignments['one'], classId: classes['A'], code: code('A'), studentId: id('student1'), attemptNo: 1, from: 'submitted', score: 17.5 });
    expect(events[2]!.metadata).toMatchObject({ from: 'graded' });
    expect(events[2]!.metadata).not.toHaveProperty('score');

    // The returned attempt grants a second one; then the roster follows the latest attempt and the latest graded score.
    const second = await submit('one', { textAnswer: 'إجابة معدَّلة' }, 'student1');
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.body).toMatchObject({ attemptNo: 2, attempts: 2, attemptsAllowed: 2 });
    expect((second.body as SubmissionBody).history.map((attempt) => [attempt.attemptNo, attempt.status])).toEqual([[1, 'returned'], [2, 'submitted']]);
    expect((await submit('one', { textAnswer: 'ثالثة' }, 'student1')).body).toMatchObject({ code: 'attempts_exhausted', maxAttempts: 2, attempts: 2 });
    await api().post(`${ASSIGNMENTS}/${assignments['one']}/status`).set(bearer('manager')).send({ action: 'close' }).expect(200);
    expect((await review(second.body.id as string, { action: 'grade', score: 19 })).body).toMatchObject({ status: 'graded', score: 19 });
    const item = ((await roster('one').expect(200)).body.items as RosterItem[]).find((entry) => entry.student.id === id('student1'))!;
    expect(item).toMatchObject({ attempts: 2, attemptsAllowed: 2, latest: { attemptNo: 2, status: 'graded', score: 19 }, lastGradedScore: 19 });
  });

  it('AC5 — a submission is read by its student, their guardian (role + link) and the class’s teachers; anyone else 404', async () => {
    const sub1 = fx['sub1']!;
    expect((await read(sub1, 'student1').expect(200)).body).toMatchObject({ id: sub1, student: { id: id('student1') }, textAnswer: 'إجابتي الأولى' });
    expect((await read(sub1, 'guardian').expect(200)).body).toMatchObject({ id: sub1 });
    expect((await read(sub1, 'teacher').expect(200)).body).toMatchObject({ id: sub1 });
    expect((await read(sub1, 'assistant').expect(200)).body).toMatchObject({ id: sub1 });
    expect((await read(sub1, 'manager').expect(200)).body).toMatchObject({ id: sub1 });
    for (const stranger of ['student2', 'linkedNoRole', 'teacher2', 'outsider']) {
      const res = await read(sub1, stranger);
      expect(res.status, stranger).toBe(404);
      expect(res.body).toMatchObject({ code: 'submission_not_found' });
    }
    expect((await api().get(`${SUBMISSIONS}/${sub1}`)).status).toBe(401);
    const keys = Object.keys((await read(sub1, 'guardian')).body as object);
    for (const forbidden of ['email', 'phone', 'gradedById', 'studentUserId']) expect(keys).not.toContain(forbidden);
  });

  it('AC6 — two simultaneous submissions for the last attempt: one is created, the other is attempts_exhausted', async () => {
    const results = await Promise.all([submit('race', { textAnswer: 'أ' }, 'student2'), submit('race', { textAnswer: 'ب' }, 'student2')]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(results.find((res) => res.status === 409)!.body).toMatchObject({ code: 'attempts_exhausted' });
    expect(await prisma.assignmentSubmission.count({ where: { assignmentId: assignments['race']!, studentUserId: id('student2') } })).toBe(1);
  });

  it('AC7 — MOD-08-T07: attemptNo guards a retried submission and expectedGradedAt guards a concurrent review; refusals write nothing', async () => {
    const m = await mark();
    const first = await submit('guard', { textAnswer: 'الأولى', attemptNo: 1 }, 'student2');
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const sub = first.body.id as string;
    const retry = await submit('guard', { textAnswer: 'الأولى', attemptNo: 1 }, 'student2'); // the response of the first try was lost
    expect(retry.status).toBe(409);
    expect(retry.body).toMatchObject({ code: 'attempt_conflict', expected: 1, next: 2 });
    expect((await submit('guard', { textAnswer: 'x', attemptNo: '2' }, 'student2')).status).toBe(400); // a JSON integer
    expect((await submit('guard', { textAnswer: 'x', attemptNo: 0 }, 'student2')).status).toBe(400);
    expect((await review(sub, { action: 'grade', score: 10, expectedGradedAt: 'yesterday' })).status).toBe(400);

    const graded = await review(sub, { action: 'grade', score: 10, expectedGradedAt: null }); // no review seen yet
    expect(graded.status, JSON.stringify(graded.body)).toBe(200);
    const gradedAt = graded.body.gradedAt as string;
    const stale = await review(sub, { action: 'grade', score: 12, expectedGradedAt: null }, 'manager'); // a second reviewer who saw no review
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ code: 'review_conflict', submissionId: sub, status: 'graded', gradedAt });
    const returned = await review(sub, { action: 'return', feedback: 'أعد الحل', expectedGradedAt: gradedAt }, 'manager');
    expect(returned.status, JSON.stringify(returned.body)).toBe(200);
    expect((await review(sub, { action: 'grade', score: 11, expectedGradedAt: gradedAt })).body).toMatchObject({ code: 'review_conflict', status: 'returned' });

    const second = await submit('guard', { linkUrl: 'https://docs.example.com/g2', attemptNo: 2 }, 'student2');
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    const history = ((await read(second.body.id as string, 'teacher').expect(200)).body as SubmissionBody).history;
    expect(history.map((attempt) => [attempt.id, attempt.attemptNo, attempt.status])).toEqual([
      [sub, 1, 'returned'],
      [second.body.id, 2, 'submitted'],
    ]);
    const events = await eventsSince(m);
    expect(events.map((event) => [event.action, event.actorUserId])).toEqual([
      ['assignments.submitted', id('student2')],
      ['assignments.graded', id('teacher')],
      ['assignments.returned', id('manager')],
      ['assignments.submitted', id('student2')],
    ]);
  });

  it(
    'documents the routes in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths['/api/assignments/{id}/submissions']).sort()).toEqual(['get', 'post']);
      expect(Object.keys(docs.body.paths['/api/submissions/{id}'])).toEqual(['get']);
      expect(Object.keys(docs.body.paths['/api/submissions/{id}/review'])).toEqual(['post']);
      for (const schema of ['SubmissionDto', 'SubmissionRosterDto', 'SubmissionRosterItemDto', 'SubmissionSummaryDto', 'SubmitAssignmentDto', 'ReviewSubmissionDto']) {
        expect(docs.body.components.schemas).toHaveProperty(schema);
      }
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
