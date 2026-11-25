// TEST-247 — MOD-20 «My School», the learner's side (roadmap §4q, API-229..234;
// D-R132..D-R135, D-R139) against the live development database. Skipped when
// no database is reachable. Fixtures (a published course with three levels —
// the third empty — and lessons of kinds text, file video (100 s), YouTube
// video, live, an optional and an unpublished lesson plus one outside every
// level; three classes of the course with a lead teacher; students enrolled
// active / completed / pending / not at all; a guardian linked to a student;
// MOD-06 sessions covering the live lesson with attendance, an assignment and
// an exam) carry a unique prefix and are deleted at the end — learning
// progress and attendance first (Restrict), then enrollments, classes
// (sessions, assignments and exams cascade), the course (levels and lessons
// cascade), users and nothing else. The learner routes record no audit event:
// the events of the student fixtures are counted above an id watermark taken
// after their sign-ins. Since LRN-T06 (D-R143) also each class's next session
// on «My School» and the class's sessions in the workspace (AC6, AC10); the
// release of a level by date (D-R145) is TEST-262 (learning-release.e2e-spec.ts).
import { randomUUID } from 'node:crypto';
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
import { completionPercentOf } from '../src/learning/my-learning.policy.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `L${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-247 supertest';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const BASE = '/api/me/learning';
const COVER = 'https://cdn.example.org/courses/my-school.jpg';
const SECRET_KEY = /hash|password|token/i;
// `note` is not listed: a live lesson's content carries its author's `note`; the attendance note is checked by its text (AC6).
const FORBIDDEN_KEYS = new Set(['email', 'username', 'phone', 'emailVerifiedAt', 'lastLoginAt', 'recordedBy', 'recordedById', 'recordedAt', 'cancellationReason', 'createdBy', 'createdById', 'withdrawalReason', 'watchedRanges', 'teacherUserId']);
const COURSE_ITEM_KEYS = ['action', 'canLearn', 'class', 'course', 'enrollment', 'enrollmentId', 'lastActivityAt', 'lastLesson', 'leadTeacher', 'nextSession', 'progress', 'relation', 'student'];
const LESSON_KEYS = [
  'assignments',
  'completionMode',
  'completionPercent',
  'content',
  'courseId',
  'description',
  'durationSeconds',
  'estimatedMinutes',
  'exams',
  'id',
  'isRequired',
  'kind',
  'neighbors',
  'progress',
  'resources',
  'section',
  'sessions',
  'title',
];

interface Counts {
  total: number;
  required: number;
  completed: number;
  completedRequired: number;
  percent: number | null;
  isComplete: boolean;
  completedAt: string | null;
}
interface CourseItem {
  enrollmentId: string;
  relation: 'self' | 'child';
  student: { id: string };
  class: { id: string };
  course: { subject: { id: string; name: unknown } | null } & Record<string, unknown>;
  progress: Counts;
  lastLesson: { id: string; sectionNumber: number; sectionTitle: unknown; openedAt: string } | null;
  lastActivityAt: string | null;
  action: string | null;
  canLearn: boolean;
  nextSession: Record<string, unknown> | null;
}
interface WorkspaceBody {
  sections: { id: string | null; number: number; title: unknown; items: { id: string; state: string; completedAt: string | null; available: boolean }[]; progress: Counts; isOpen: boolean; opensOn: string | null }[];
  progress: Counts;
  resume: { itemId: string; reason: string; positionSeconds: number | null } | null;
  sessions: { id: string; status: string; meetingUrl: string | null; syllabusItemId: string | null; attendance: unknown }[];
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

/** Every key of a JSON value, at any depth. */
function keysDeep(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((entry) => keysDeep(entry, into));
  else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      into.push(key);
      keysDeep(entry, into);
    }
  }
  return into;
}

const available = DATABASE_URL ? await canConnect(DATABASE_URL) : false;

describe.skipIf(!available)('MOD-20 my learning (e2e, TEST-247)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let markId: string;
  let academyTimeZone: string;
  let threshold: number;
  let courseId: string;
  let subjectId: string;
  const createdUserIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const sections: Record<string, string> = {};
  const items: Record<string, string> = {};
  const classes: Record<string, string> = {};
  const enrollments: Record<string, string> = {};
  const extra: Record<string, string> = {};

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name}-${RUN}@example.test`.toLowerCase();
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  const learning = (as: string) => api().get(BASE).set(bearer(as));
  const workspace = (as: string, course = courseId) => api().get(`${BASE}/courses/${course}`).set(bearer(as));
  const lesson = (as: string, itemId: string) => api().get(`${BASE}/items/${itemId}`).set(bearer(as));
  const visit = (as: string, itemId: string) => api().post(`${BASE}/items/${itemId}/visit`).set(bearer(as)).send({});
  const complete = (as: string, itemId: string) => api().post(`${BASE}/items/${itemId}/complete`).set(bearer(as)).send({});
  const playback = (as: string, itemId: string, body: unknown) => api().put(`${BASE}/items/${itemId}/playback`).set(bearer(as)).send(body as object);
  const progressRow = (student: string, item: string) =>
    prisma.learningProgress.findUnique({ where: { studentUserId_syllabusItemId: { studentUserId: id(student), syllabusItemId: items[item]! } } });
  const backdate = (student: string, item: string, seconds: number) =>
    prisma.learningProgress.update({
      where: { studentUserId_syllabusItemId: { studentUserId: id(student), syllabusItemId: items[item]! } },
      data: { lastOpenedAt: new Date(Date.now() - seconds * 1000), lastPlaybackAt: new Date(Date.now() - seconds * 1000) },
    });
  const itemNames = (list: { id: string }[]) => list.map((entry) => Object.entries(items).find(([, itemId]) => itemId === entry.id)?.[0] ?? entry.id);
  const workspaceItem = (body: WorkspaceBody, name: string) => body.sections.flatMap((section) => section.items).find((entry) => entry.id === items[name]);

  async function createUser(name: string, roleKey: string): Promise<void> {
    const roleId = (await prisma.role.findUniqueOrThrow({ where: { key: roleKey }, select: { id: true } })).id;
    const user = await prisma.user.create({
      data: { email: email(name), fullName: `Test ${name}`, passwordHash: await passwords.hash(PASSWORD), status: 'active', roles: { create: [{ roleId }] } },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(name), password: PASSWORD }).expect(200);
    tokens[name] = res.body.accessToken as string;
  }

  async function createItem(name: string, data: Record<string, unknown>): Promise<void> {
    const row = await prisma.courseSyllabusItem.create({ data: { courseId, title: { ar: `درس ${name}`, en: `Lesson ${name}` }, ...data } as never, select: { id: true } });
    items[name] = row.id;
  }

  async function createClass(suffix: string): Promise<void> {
    const row = await prisma.class.create({
      data: { courseId, code: code(suffix), name: { ar: `فصل ${suffix}` }, capacity: 10, status: 'open', teachers: { create: [{ teacherUserId: id('teacher'), role: 'lead' }] } },
      select: { id: true },
    });
    classes[suffix] = row.id;
  }

  async function enroll(suffix: string, student: string, status: 'active' | 'completed' | 'pending', enrolledAt: string): Promise<void> {
    const at = new Date(enrolledAt);
    const row = await prisma.enrollment.create({
      data: {
        classId: classes[suffix]!,
        studentUserId: id(student),
        status,
        enrolledAt: at,
        activatedAt: status === 'pending' ? null : at,
        completedAt: status === 'completed' ? new Date(at.getTime() + 3600_000) : null,
        requestedAt: status === 'pending' ? at : null,
        source: status === 'pending' ? 'self' : 'admin',
      },
      select: { id: true },
    });
    enrollments[`${suffix}:${student}`] = row.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    const academy = await prisma.academy.findFirstOrThrow({ select: { timezone: true, settings: true } });
    academyTimeZone = academy.timezone;
    threshold = completionPercentOf(academy.settings);

    for (const name of ['sA', 'sB', 'sC', 'sP', 'sN']) await createUser(name, 'student');
    await createUser('guardian', 'guardian');
    await createUser('teacher', 'teacher');
    await prisma.guardianStudent.create({ data: { guardianUserId: id('guardian'), studentUserId: id('sA'), relationship: 'mother', isPrimary: true }, select: { studentUserId: true } });

    // PORTAL-04: the course teaches a school subject — «My School» shows it instead of the difficulty level.
    const maxSubject = await prisma.subject.aggregate({ _max: { sortOrder: true } });
    subjectId = (
      await prisma.subject.create({
        data: { code: `${PREFIX}S`.slice(0, 16), name: { ar: 'الرياضيات', en: 'Mathematics' }, sortOrder: (maxSubject._max.sortOrder ?? -1) + 1 },
        select: { id: true },
      })
    ).id;
    courseId = (
      await prisma.course.create({
        data: { code: code('CRS'), name: { ar: 'دورة مدرستي', en: 'My School course' }, summary: { ar: 'ملخص الدورة' }, status: 'published', coverImageUrl: COVER, subjectId },
        select: { id: true },
      })
    ).id;
    sections['S1'] = (await prisma.courseSection.create({ data: { courseId, sortOrder: 0, title: { ar: 'الأساسيات' } }, select: { id: true } })).id;
    sections['S2'] = (await prisma.courseSection.create({ data: { courseId, sortOrder: 1, description: { ar: 'وصف المستوى الثاني' } }, select: { id: true } })).id;
    sections['S3'] = (await prisma.courseSection.create({ data: { courseId, sortOrder: 2, title: { ar: 'مستوى فارغ' } }, select: { id: true } })).id;
    await createItem('T1', {
      sectionId: sections['S1'],
      sortOrder: 0,
      kind: 'text',
      estimatedMinutes: 5,
      content: { body: { ar: 'فقرة أولى' } },
      resources: [{ title: { ar: 'ملخص' }, url: 'https://cdn.example.org/handout.pdf' }],
    });
    await createItem('V1', { sectionId: sections['S1'], sortOrder: 1, kind: 'video', content: { provider: 'file', url: 'https://cdn.example.org/lesson.mp4', durationSeconds: 100, captions: [] } });
    await createItem('Y1', {
      sectionId: sections['S2'],
      sortOrder: 2,
      kind: 'video',
      content: { provider: 'youtube', videoId: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', durationSeconds: null },
    });
    await createItem('L1', { sectionId: sections['S2'], sortOrder: 3, kind: 'live', content: { note: null } });
    await createItem('OPT', { sectionId: sections['S2'], sortOrder: 4, kind: 'text', isRequired: false });
    await createItem('HID', { sectionId: sections['S2'], sortOrder: 5, kind: 'text', isPublished: false });
    await createItem('LOOSE', { sectionId: null, sortOrder: 6, kind: 'text', content: { body: { ar: 'خارج المستويات' } } });

    await createClass('A');
    await createClass('B');
    await createClass('D'); // a class of the course sA is not in
    await enroll('B', 'sA', 'completed', '2026-01-01T09:00:00Z');
    await enroll('A', 'sA', 'active', '2026-02-01T09:00:00Z');
    await enroll('A', 'sB', 'active', '2026-02-01T09:00:00Z');
    await enroll('A', 'sC', 'completed', '2026-02-01T09:00:00Z');
    await enroll('A', 'sP', 'pending', '2026-02-02T09:00:00Z');

    // Every sign-in above recorded its event; the learner routes below must record none.
    markId = (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;
  }, 120_000);

  afterAll(async () => {
    try {
      if (prisma) {
        if (createdUserIds.length > 0) {
          await prisma.certificate.deleteMany({ where: { studentUserId: { in: createdUserIds } } });
          await prisma.learningProgress.deleteMany({ where: { studentUserId: { in: createdUserIds } } });
          await prisma.attendanceRecord.deleteMany({ where: { studentUserId: { in: createdUserIds } } });
        }
        if (Object.keys(classes).length > 0) await prisma.enrollment.deleteMany({ where: { classId: { in: Object.values(classes) } } });
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.subject.deleteMany({ where: { code: { startsWith: PREFIX } } });
      }
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('AC1 — «My School» lists the caller’s own enrollments (start) and a guardian’s children’s read-only; nobody else’s', async () => {
    const res = await learning('sA');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const list = res.body.items as CourseItem[];
    expect(list.map((entry) => [entry.class.id, entry.relation])).toEqual([
      [classes['A'], 'self'],
      [classes['B'], 'self'],
    ]); // no activity yet: the newest enrollment first
    expect(Object.keys(list[0]!).sort()).toEqual(COURSE_ITEM_KEYS);
    expect(Object.keys(list[0]!.course).sort()).toEqual(['code', 'coverImageUrl', 'id', 'level', 'name', 'resources', 'subject', 'summary']);
    expect(Object.keys(list[0]!.course.subject!).sort()).toEqual(['id', 'name']); // never the subject's code or state
    expect(list[0]).toMatchObject({
      enrollmentId: enrollments['A:sA'],
      relation: 'self',
      student: { id: id('sA'), fullName: 'Test sA', displayName: null },
      enrollment: { status: 'active', enrolledAt: '2026-02-01T09:00:00.000Z', activatedAt: '2026-02-01T09:00:00.000Z', completedAt: null },
      class: { id: classes['A'], code: code('A'), name: { ar: 'فصل A' }, status: 'open', startsOn: null, endsOn: null },
      course: { id: courseId, code: code('CRS'), name: { ar: 'دورة مدرستي', en: 'My School course' }, summary: { ar: 'ملخص الدورة' }, coverImageUrl: COVER, resources: [], level: null, subject: { id: subjectId, name: { ar: 'الرياضيات', en: 'Mathematics' } } },
      leadTeacher: { fullName: 'Test teacher', displayName: null },
      progress: { total: 6, required: 5, completed: 0, completedRequired: 0, percent: 0, isComplete: false, completedAt: null },
      lastLesson: null,
      lastActivityAt: null,
      action: 'start',
      canLearn: true,
      nextSession: null, // the class has no session yet (D-R143)
    });
    expect(list[1]).toMatchObject({ enrollmentId: enrollments['B:sA'], enrollment: { status: 'completed' }, action: 'start', canLearn: true, nextSession: null });

    const child = (await learning('guardian').expect(200)).body.items as CourseItem[];
    expect(child.map((entry) => [entry.enrollmentId, entry.relation, entry.student.id, entry.action, entry.canLearn])).toEqual([
      [enrollments['A:sA'], 'child', id('sA'), null, false],
      [enrollments['B:sA'], 'child', id('sA'), null, false],
    ]);
    expect(child[0]!.progress).toEqual(list[0]!.progress);

    expect((await learning('sN').expect(200)).body).toEqual({ items: [] });
    expect((await learning('teacher').expect(200)).body).toEqual({ items: [] }); // teaching is not learning
    expect((await learning('sP').expect(200)).body).toEqual({ items: [] }); // a request awaiting approval opens nothing
    await api().get(BASE).expect(401);
  });

  it('AC2 — the workspace opens for an own active or completed enrollment only; levels in order, the empty one and the unpublished lesson hidden; resume at the first lesson', async () => {
    const res = await workspace('sA');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as WorkspaceBody & Record<string, unknown>;
    expect(body).toMatchObject({
      course: { id: courseId, code: code('CRS'), name: { ar: 'دورة مدرستي', en: 'My School course' }, coverImageUrl: COVER },
      enrollment: { id: enrollments['A:sA'], status: 'active', class: { id: classes['A'], code: code('A'), name: { ar: 'فصل A' } } }, // active preferred over the completed B
      completionPercent: threshold,
      progress: { total: 6, required: 5, completed: 0, completedRequired: 0, percent: 0, isComplete: false, completedAt: null },
      resume: { itemId: items['T1'], reason: 'first', positionSeconds: null },
      sessions: [], // no MOD-06 session in class A yet (D-R143)
    });
    // No level has a release delay: every level is open, with no date (D-R145).
    expect(body.sections.map((section) => [section.isOpen, section.opensOn])).toEqual([
      [true, null],
      [true, null],
      [true, null],
    ]);
    expect(body.sections.flatMap((section) => section.items).every((entry) => entry.available)).toBe(true);
    expect(body.sections.map((section) => [section.id, section.number, itemNames(section.items)])).toEqual([
      [sections['S1'], 1, ['T1', 'V1']],
      [sections['S2'], 2, ['Y1', 'L1', 'OPT']],
      [null, 3, ['LOOSE']],
    ]);
    expect(body.sections[0]).toMatchObject({ title: { ar: 'الأساسيات' }, description: null, progress: { total: 2, required: 2, percent: 0 } });
    expect(body.sections[1]).toMatchObject({ title: null, description: { ar: 'وصف المستوى الثاني' }, progress: { total: 3, required: 2, percent: 0 } });
    expect(body.sections[2]).toMatchObject({ title: null, description: null });
    expect(workspaceItem(body, 'T1')).toEqual({
      id: items['T1'],
      title: { ar: 'درس T1', en: 'Lesson T1' },
      kind: 'text',
      isRequired: true,
      estimatedMinutes: 5,
      durationSeconds: 300,
      completionMode: 'manual',
      state: 'not_started',
      completedAt: null,
      available: true,
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      // J-F67: the lesson's own resources, as API-231 lists them (T1 carries one).
      resources: [{ title: { ar: 'ملخص' }, url: 'https://cdn.example.org/handout.pdf' }],
      exams: [],
    });
    expect(workspaceItem(body, 'V1')).toMatchObject({ kind: 'video', completionMode: 'playback', durationSeconds: 100 });
    expect(workspaceItem(body, 'Y1')).toMatchObject({ kind: 'video', completionMode: 'manual', durationSeconds: null });
    expect(workspaceItem(body, 'L1')).toMatchObject({ kind: 'live', completionMode: 'attendance' });
    expect(workspaceItem(body, 'OPT')).toMatchObject({ isRequired: false, completionMode: 'manual' });

    expect((await workspace('sC').expect(200)).body.enrollment).toMatchObject({ id: enrollments['A:sC'], status: 'completed' });
    expect((await workspace('sP').expect(403)).body).toMatchObject({ code: 'not_enrolled', courseId, reason: 'pending' });
    expect((await workspace('sN').expect(403)).body).toMatchObject({ code: 'not_enrolled', courseId, reason: 'not_enrolled' });
    expect((await workspace('guardian').expect(403)).body).toMatchObject({ code: 'not_enrolled', reason: 'not_enrolled' }); // children’s progress only on «My School»
    const unknown = randomUUID();
    expect((await workspace('sN', unknown).expect(404)).body).toMatchObject({ code: 'learning_course_not_found', courseId: unknown });
    await workspace('sA', 'not-a-uuid').expect(400);
  });

  it('AC3 — a lesson reads without writing; a level-2 lesson opens without touching level 1; a visit starts it and is idempotent; unpublished and unknown lessons are 404', async () => {
    const read = await lesson('sA', items['Y1']!);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(Object.keys(read.body).sort()).toEqual(LESSON_KEYS);
    expect(read.body).toMatchObject({
      id: items['Y1'],
      courseId,
      title: { ar: 'درس Y1', en: 'Lesson Y1' },
      description: null,
      kind: 'video',
      content: { provider: 'youtube', videoId: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', durationSeconds: null },
      resources: [],
      isRequired: true,
      section: { id: sections['S2'], number: 2, title: null },
      completionMode: 'manual',
      completionPercent: threshold,
      progress: { state: 'not_started', completedAt: null, completionSource: null, positionSeconds: null, watchedSeconds: 0, watchedPercent: null },
      neighbors: { previous: { id: items['V1'], title: { ar: 'درس V1', en: 'Lesson V1' }, available: true }, next: { id: items['L1'], available: true } },
      sessions: [],
      assignments: [],
      exams: [],
    });
    expect(await progressRow('sA', 'Y1')).toBeNull(); // reading never writes

    const text = (await lesson('sA', items['T1']!).expect(200)).body;
    expect(text).toMatchObject({
      content: { body: { ar: 'فقرة أولى' } },
      resources: [{ title: { ar: 'ملخص' }, url: 'https://cdn.example.org/handout.pdf' }],
      section: { id: sections['S1'], number: 1, title: { ar: 'الأساسيات' } },
      neighbors: { previous: null, next: { id: items['V1'] } },
      durationSeconds: 300,
    });
    expect((await lesson('sA', items['V1']!).expect(200)).body.progress).toMatchObject({ watchedPercent: 0 });
    expect((await lesson('sA', items['LOOSE']!).expect(200)).body).toMatchObject({ section: { id: null, number: 3, title: null }, neighbors: { previous: { id: items['OPT'] }, next: null } });
    expect((await lesson('sA', items['OPT']!).expect(200)).body.neighbors).toMatchObject({ previous: { id: items['L1'] }, next: { id: items['LOOSE'] } }); // the unpublished lesson is skipped

    const first = await visit('sA', items['Y1']!);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toEqual({ progress: { state: 'in_progress', completedAt: null, completionSource: null, positionSeconds: null, watchedSeconds: 0, watchedPercent: null } });
    const row1 = (await progressRow('sA', 'Y1'))!;
    expect(row1).toMatchObject({ status: 'in_progress', courseId, completedAt: null, completionSource: null });
    const second = await visit('sA', items['Y1']!).expect(200);
    expect(second.body.progress.state).toBe('in_progress');
    const row2 = (await progressRow('sA', 'Y1'))!;
    expect(row2.firstOpenedAt.toISOString()).toBe(row1.firstOpenedAt.toISOString());
    expect(row2.lastOpenedAt.getTime()).toBeGreaterThanOrEqual(row1.lastOpenedAt.getTime());
    expect(row2.status).toBe('in_progress'); // opening never completes

    for (const call of [() => lesson('sA', items['HID']!), () => visit('sA', items['HID']!), () => complete('sA', items['HID']!), () => playback('sA', items['HID']!, { positionSeconds: 0, ranges: [] })]) {
      expect((await call().expect(404)).body).toMatchObject({ code: 'lesson_not_found', itemId: items['HID'] });
    }
    const unknown = randomUUID();
    expect((await lesson('sA', unknown).expect(404)).body).toMatchObject({ code: 'lesson_not_found', itemId: unknown });
    expect((await lesson('sP', items['Y1']!).expect(403)).body).toMatchObject({ code: 'not_enrolled', reason: 'pending' });
    expect((await visit('sP', items['Y1']!).expect(403)).body).toMatchObject({ code: 'not_enrolled', reason: 'pending' });
    expect((await lesson('guardian', items['Y1']!).expect(403)).body).toMatchObject({ code: 'not_enrolled', reason: 'not_enrolled' });
    expect((await visit('sN', items['Y1']!).expect(403)).body).toMatchObject({ code: 'not_enrolled' });
    expect(await progressRow('sN', 'Y1')).toBeNull();
    await lesson('sA', 'nope').expect(400);

    // «My School» and the workspace follow the visit — in both classes of the course.
    const list = (await learning('sA').expect(200)).body.items as CourseItem[];
    for (const entry of list) {
      expect(entry).toMatchObject({ action: 'continue', lastLesson: { id: items['Y1'], sectionNumber: 2, sectionTitle: null } });
      expect(entry.lastActivityAt).toBe(row2.lastOpenedAt.toISOString());
      expect(entry.lastLesson!.openedAt).toBe(row2.lastOpenedAt.toISOString());
    }
    expect((await workspace('sA').expect(200)).body.resume).toEqual({ itemId: items['Y1'], reason: 'last', positionSeconds: null });
  });

  it('AC4 — a manual lesson completes once (idempotent, never reverts); a playback or live lesson refuses the button; another student’s state is never visible', async () => {
    const c1 = await complete('sA', items['Y1']!);
    expect(c1.status, JSON.stringify(c1.body)).toBe(200);
    expect(c1.body).toMatchObject({
      completedNow: true,
      progress: { state: 'completed', completionSource: 'manual', watchedPercent: null },
      section: { total: 3, required: 2, completed: 1, completedRequired: 1, percent: 50, isComplete: false },
      course: { total: 6, required: 5, completed: 1, completedRequired: 1, percent: 20, isComplete: false, completedAt: null },
    });
    expect(typeof c1.body.progress.completedAt).toBe('string');
    const c2 = await complete('sA', items['Y1']!).expect(200);
    expect(c2.body.completedNow).toBe(false);
    expect(c2.body.progress).toEqual(c1.body.progress);
    expect(c2.body.section).toEqual(c1.body.section);
    expect(c2.body.course).toEqual(c1.body.course);
    // Opening it again keeps it completed.
    expect((await visit('sA', items['Y1']!).expect(200)).body.progress).toMatchObject({ state: 'completed', completedAt: c1.body.progress.completedAt });
    expect((await progressRow('sA', 'Y1'))!.completedAt!.toISOString()).toBe(c1.body.progress.completedAt);

    expect((await complete('sA', items['V1']!).expect(409)).body).toMatchObject({ code: 'completion_by_playback', itemId: items['V1'], thresholdPercent: threshold });
    expect((await complete('sA', items['L1']!).expect(409)).body).toMatchObject({ code: 'completion_by_attendance', itemId: items['L1'] });
    expect((await playback('sA', items['Y1']!, { positionSeconds: 10, ranges: [[0, 10]] }).expect(409)).body).toMatchObject({ code: 'playback_not_tracked', itemId: items['Y1'] });
    expect((await playback('sA', items['T1']!, { positionSeconds: 10, ranges: [] }).expect(409)).body).toMatchObject({ code: 'playback_not_tracked' });
    expect(await progressRow('sA', 'V1')).toBeNull(); // a refused completion writes nothing
    expect(await progressRow('sA', 'T1')).toBeNull();

    // A lesson never opened can be completed directly.
    const text = await complete('sA', items['T1']!).expect(200);
    expect(text.body).toMatchObject({ completedNow: true, section: { total: 2, completedRequired: 1, percent: 50 }, course: { completedRequired: 2, percent: 40 } });

    // Student B, in the same class, sees none of it.
    expect((await lesson('sB', items['Y1']!).expect(200)).body.progress).toMatchObject({ state: 'not_started', completedAt: null });
    const other = (await workspace('sB').expect(200)).body as WorkspaceBody;
    expect(other.sections.flatMap((section) => section.items).every((entry) => entry.state === 'not_started')).toBe(true);
    expect(other.progress).toMatchObject({ completed: 0, percent: 0 });
    expect(other.resume).toEqual({ itemId: items['T1'], reason: 'first', positionSeconds: null });
  });

  it('AC5 — playback coverage is capped by the server clock, completes once at the threshold, never by seeking; the position is restored', async () => {
    await visit('sA', items['V1']!).expect(200);
    const claimed = await playback('sA', items['V1']!, { positionSeconds: 100, ranges: [[0, 100]] });
    expect(claimed.status, JSON.stringify(claimed.body)).toBe(200);
    expect(claimed.body).toMatchObject({ capped: true, completedNow: false, progress: { state: 'in_progress', positionSeconds: 100, completedAt: null } });
    expect(claimed.body.progress.watchedSeconds).toBeGreaterThanOrEqual(10);
    expect(claimed.body.progress.watchedSeconds).toBeLessThan(40);
    expect(claimed.body.progress.watchedPercent).toBe(claimed.body.progress.watchedSeconds); // a 100-second medium
    expect(claimed.body.course).toMatchObject({ completedRequired: 2 });
    const row = (await progressRow('sA', 'V1'))!;
    expect(row).toMatchObject({ mediaDurationSeconds: 100, positionSeconds: 100, status: 'in_progress' });
    expect(row.lastPlaybackAt).not.toBeNull();

    await backdate('sA', 'V1', 600);
    const full = await playback('sA', items['V1']!, { positionSeconds: 100, ranges: [[0, 100]] }).expect(200);
    expect(full.body).toMatchObject({
      capped: false,
      completedNow: true,
      progress: { state: 'completed', completionSource: 'playback', watchedSeconds: 100, watchedPercent: 100, positionSeconds: 100 },
      course: { completed: 3, completedRequired: 3, percent: 60, isComplete: false },
    });
    const again = await playback('sA', items['V1']!, { positionSeconds: 40, ranges: [[30, 40]] }).expect(200);
    expect(again.body).toMatchObject({ completedNow: false, progress: { state: 'completed', completedAt: full.body.progress.completedAt, positionSeconds: 40 } });
    expect((await complete('sA', items['V1']!).expect(409)).body.code).toBe('completion_by_playback');

    // Only the last seconds played: never complete, and the position is the resume point.
    await visit('sB', items['V1']!).expect(200);
    await backdate('sB', 'V1', 600);
    const tail = await playback('sB', items['V1']!, { positionSeconds: 60, ranges: [[85, 100]] }).expect(200);
    expect(tail.body).toMatchObject({ capped: false, completedNow: false, progress: { state: 'in_progress', watchedSeconds: 15, watchedPercent: 15, positionSeconds: 60 } });
    expect((await workspace('sB').expect(200)).body.resume).toEqual({ itemId: items['V1'], reason: 'last', positionSeconds: 60 });
    expect((await lesson('sB', items['V1']!).expect(200)).body.progress).toEqual({ state: 'in_progress', completedAt: null, completionSource: null, positionSeconds: 60, watchedSeconds: 15, watchedPercent: 15 });

    // Bodies are raw JSON numbers and pairs; nothing is written on a refusal.
    const bad: unknown[] = [
      { positionSeconds: '5', ranges: [] },
      { positionSeconds: -1, ranges: [] },
      { positionSeconds: 86_401, ranges: [] },
      { positionSeconds: 1 },
      { ranges: [] },
      { positionSeconds: 1, ranges: [[0]] },
      { positionSeconds: 1, ranges: [[0, 1, 2]] },
      { positionSeconds: 1, ranges: [[0, '5']] },
      { positionSeconds: 1, ranges: [[-1, 5]] },
      { positionSeconds: 1, ranges: Array.from({ length: 51 }, () => [0, 1]) },
      { positionSeconds: 1, ranges: [], studentId: id('sA') },
    ];
    for (const body of bad) expect((await playback('sB', items['V1']!, body)).status, JSON.stringify(body)).toBe(400);
    expect((await progressRow('sB', 'V1'))!).toMatchObject({ watchedSeconds: 15, positionSeconds: 60 });

    // A first save before any visit creates the row (and its clock starts now).
    const cold = await playback('sC', items['V1']!, { positionSeconds: 50, ranges: [[0, 50]] }).expect(200);
    expect(cold.body).toMatchObject({ capped: true, completedNow: false, progress: { state: 'in_progress', positionSeconds: 50 } });
    expect(cold.body.progress.watchedSeconds).toBeLessThan(50);
    expect((await playback('sP', items['V1']!, { positionSeconds: 1, ranges: [] }).expect(403)).body).toMatchObject({ code: 'not_enrolled', reason: 'pending' });
    expect((await playback('guardian', items['V1']!, { positionSeconds: 1, ranges: [] }).expect(403)).body.code).toBe('not_enrolled');
  });

  it('AC6 — a live lesson completes by attendance at a covering session; the lesson lists the sessions of the caller’s own classes with their assignments and exams; progress follows the student across classes', async () => {
    const hour = 3600_000;
    const at = (value: string) => new Date(value);
    const sessionA = await prisma.lesson.create({
      data: {
        classId: classes['A']!,
        syllabusItemId: items['L1']!,
        title: { ar: 'جلسة مباشرة' },
        startsAt: at('2026-03-01T10:00:00Z'),
        endsAt: new Date(at('2026-03-01T10:00:00Z').getTime() + hour),
        deliveryMode: 'live_online',
        meetingUrl: 'https://meet.example.com/live-a',
        status: 'completed',
      },
      select: { id: true },
    });
    const cancelled = await prisma.lesson.create({
      data: {
        classId: classes['A']!,
        syllabusItemId: items['L1']!,
        title: { ar: 'جلسة ملغاة' },
        startsAt: at('2026-03-08T10:00:00Z'),
        endsAt: new Date(at('2026-03-08T10:00:00Z').getTime() + hour),
        deliveryMode: 'live_online',
        meetingUrl: 'https://meet.example.com/live-cancelled',
        status: 'cancelled',
        cancellationReason: 'سبب داخلي',
      },
      select: { id: true },
    });
    const elsewhere = await prisma.lesson.create({
      data: { classId: classes['D']!, syllabusItemId: items['L1']!, title: { ar: 'جلسة فصل آخر' }, startsAt: at('2026-03-02T10:00:00Z'), endsAt: new Date(at('2026-03-02T10:00:00Z').getTime() + hour) },
      select: { id: true },
    });
    extra['sessionA'] = sessionA.id;
    await prisma.attendanceRecord.create({ data: { lessonId: sessionA.id, studentUserId: id('sA'), status: 'present', note: 'ملاحظة سرية' }, select: { lessonId: true } });
    // Present at a cancelled session only: that never completes a live lesson.
    await prisma.attendanceRecord.create({ data: { lessonId: cancelled.id, studentUserId: id('sB'), status: 'present' }, select: { lessonId: true } });
    const assignment = await prisma.assignment.create({
      data: { classId: classes['A']!, lessonId: sessionA.id, title: { ar: 'واجب الجلسة' }, maxScore: 10, status: 'open', publishedAt: new Date(), dueAt: at('2026-03-05T20:00:00Z') },
      select: { id: true },
    });
    await prisma.assignment.create({ data: { classId: classes['A']!, lessonId: sessionA.id, title: { ar: 'مسودة' }, maxScore: 10 }, select: { id: true } });
    const exam = await prisma.exam.create({
      data: { classId: classes['A']!, lessonId: sessionA.id, title: { ar: 'اختبار قصير' }, type: 'quiz', status: 'scheduled', maxScore: 20, scheduledAt: at('2026-03-01T10:30:00Z') },
      select: { id: true },
    });
    await prisma.exam.create({ data: { classId: classes['A']!, lessonId: sessionA.id, title: { ar: 'اختبار مسودة' }, type: 'quiz', maxScore: 20 }, select: { id: true } });

    const ws = (await workspace('sA').expect(200)).body as WorkspaceBody;
    // D-R143 — the workspace lists every session of the enrollment's class (A), cancelled ones without their link; never class D's.
    expect(ws.sessions).toEqual([
      {
        id: sessionA.id,
        title: { ar: 'جلسة مباشرة' },
        startsAt: '2026-03-01T10:00:00.000Z',
        endsAt: '2026-03-01T11:00:00.000Z',
        status: 'completed',
        deliveryMode: 'live_online',
        meetingUrl: 'https://meet.example.com/live-a',
        timeZone: academyTimeZone,
        syllabusItemId: items['L1'],
        attendance: { status: 'present', minutesLate: null },
      },
      {
        id: cancelled.id,
        title: { ar: 'جلسة ملغاة' },
        startsAt: '2026-03-08T10:00:00.000Z',
        endsAt: '2026-03-08T11:00:00.000Z',
        status: 'cancelled',
        deliveryMode: 'live_online',
        meetingUrl: null,
        timeZone: academyTimeZone,
        syllabusItemId: items['L1'],
        attendance: null,
      },
    ]);
    const wsB = (await workspace('sB').expect(200)).body as WorkspaceBody;
    expect(wsB.sessions.map((entry) => [entry.id, entry.attendance])).toEqual([
      [sessionA.id, null], // only the caller's own record
      [cancelled.id, { status: 'present', minutesLate: null }],
    ]);
    expect(workspaceItem(ws, 'L1')).toMatchObject({ state: 'completed', completedAt: '2026-03-01T10:00:00.000Z' });
    expect(ws.progress).toMatchObject({ completed: 4, completedRequired: 4, percent: 80 });
    expect(ws.sections[1]!.progress).toMatchObject({ completedRequired: 2, percent: 100, isComplete: true, completedAt: (await progressRow('sA', 'Y1'))!.completedAt!.toISOString() });

    const live = await lesson('sA', items['L1']!);
    expect(live.status, JSON.stringify(live.body)).toBe(200);
    expect(live.body).toMatchObject({
      kind: 'live',
      content: { note: null },
      completionMode: 'attendance',
      progress: { state: 'completed', completionSource: 'attendance', completedAt: '2026-03-01T10:00:00.000Z', watchedPercent: null },
    });
    expect(live.body.sessions.map((entry: { id: string }) => entry.id)).toEqual([sessionA.id, cancelled.id]); // class D is not the caller's
    expect(live.body.sessions).not.toContainEqual(expect.objectContaining({ id: elsewhere.id }));
    expect(live.body.sessions[0]).toEqual({
      id: sessionA.id,
      classId: classes['A'],
      title: { ar: 'جلسة مباشرة' },
      startsAt: '2026-03-01T10:00:00.000Z',
      endsAt: '2026-03-01T11:00:00.000Z',
      status: 'completed',
      deliveryMode: 'live_online',
      meetingUrl: 'https://meet.example.com/live-a',
      timeZone: academyTimeZone,
      attendance: { status: 'present', minutesLate: null },
    });
    expect(live.body.sessions[1]).toMatchObject({ id: cancelled.id, status: 'cancelled', meetingUrl: null, attendance: null });
    expect(live.body.assignments).toEqual([
      { id: assignment.id, classId: classes['A'], title: { ar: 'واجب الجلسة' }, dueAt: '2026-03-05T20:00:00.000Z', status: 'open', timeZone: academyTimeZone },
    ]);
    expect(live.body.exams).toEqual([{ id: exam.id, classId: classes['A'], title: { ar: 'اختبار قصير' }, type: 'quiz', scheduledAt: '2026-03-01T10:30:00.000Z', status: 'scheduled' }]);
    expect(JSON.stringify(live.body)).not.toContain('سرية');
    expect(JSON.stringify(live.body)).not.toContain('سبب داخلي');
    expect((await complete('sA', items['L1']!).expect(409)).body.code).toBe('completion_by_attendance');

    const forB = (await lesson('sB', items['L1']!).expect(200)).body;
    expect(forB.progress).toMatchObject({ state: 'not_started', completionSource: null });
    expect(forB.sessions[1]).toMatchObject({ id: cancelled.id, attendance: { status: 'present', minutesLate: null } });
    expect(forB.sessions[0].attendance).toBeNull(); // only the caller's own record

    const list = (await learning('sA').expect(200)).body.items as CourseItem[];
    expect(list).toHaveLength(2);
    expect(list[0]!.progress).toEqual(list[1]!.progress); // the same progress in both classes of the course
    expect(list[0]!.progress).toMatchObject({ completedRequired: 4, percent: 80 });
  });

  it('AC7 — every required lesson done: the course is complete (review) while an optional lesson stays open', async () => {
    const done = await complete('sA', items['LOOSE']!).expect(200);
    expect(done.body).toMatchObject({ completedNow: true, section: { total: 1, completedRequired: 1, percent: 100, isComplete: true }, course: { total: 6, completed: 5, completedRequired: 5, percent: 100, isComplete: true } });
    expect(done.body.course.completedAt).toBe(done.body.progress.completedAt);
    const list = (await learning('sA').expect(200)).body.items as CourseItem[];
    for (const entry of list) expect(entry).toMatchObject({ action: 'review', progress: { isComplete: true, percent: 100 } });
    const child = (await learning('guardian').expect(200)).body.items as CourseItem[];
    for (const entry of child) expect(entry).toMatchObject({ action: null, canLearn: false, progress: { isComplete: true } });
  });

  it('AC8 — when the last opened lesson is unpublished the resume moves on (`replaced`) and the lesson is 404', async () => {
    await visit('sC', items['OPT']!).expect(200);
    expect((await workspace('sC').expect(200)).body.resume).toEqual({ itemId: items['OPT'], reason: 'last', positionSeconds: null });
    await prisma.courseSyllabusItem.update({ where: { id: items['OPT']! }, data: { isPublished: false }, select: { id: true } });
    try {
      const body = (await workspace('sC').expect(200)).body as WorkspaceBody;
      expect(body.resume).toEqual({ itemId: items['LOOSE'], reason: 'replaced', positionSeconds: null }); // the first lesson after it not completed
      expect(itemNames(body.sections[1]!.items)).toEqual(['Y1', 'L1']);
      expect(body.progress).toMatchObject({ total: 5, required: 5 });
      expect((await lesson('sC', items['OPT']!).expect(404)).body.code).toBe('lesson_not_found');
      expect((await visit('sC', items['OPT']!).expect(404)).body.code).toBe('lesson_not_found');
      const card = ((await learning('sC').expect(200)).body.items as CourseItem[])[0]!;
      expect(card).toMatchObject({ lastLesson: null, action: 'continue' });
      expect(card.lastActivityAt).not.toBeNull();
    } finally {
      await prisma.courseSyllabusItem.update({ where: { id: items['OPT']! }, data: { isPublished: true }, select: { id: true } });
    }
  });

  it('AC9 — the learner routes record no audit event and expose no contact, secret or teacher-only field', async () => {
    const students = ['sA', 'sB', 'sC', 'sP', 'sN', 'guardian'].map(id);
    expect(await prisma.auditLog.findMany({ where: { id: { gt: markId }, actorUserId: { in: students } }, select: { action: true } })).toEqual([]);
    expect(await prisma.auditLog.count({ where: { id: { gt: markId }, entityId: courseId } })).toBe(0);
    const bodies = [
      (await learning('sA').expect(200)).body,
      (await learning('guardian').expect(200)).body,
      (await workspace('sA').expect(200)).body,
      (await lesson('sA', items['L1']!).expect(200)).body,
      (await lesson('sB', items['L1']!).expect(200)).body,
    ];
    for (const body of bodies) {
      const keys = keysDeep(body);
      expect(keys.filter((key) => SECRET_KEY.test(key))).toEqual([]);
      expect(keys.filter((key) => FORBIDDEN_KEYS.has(key))).toEqual([]);
    }
  });

  it('AC10 — «My School» shows each class’s next session (D-R143): the earliest not cancelled that has not ended; the workspace lists them all', async () => {
    const minute = 60_000;
    const now = Date.now();
    const lessonIn = async (suffix: string, data: Record<string, unknown>) =>
      (await prisma.lesson.create({ data: { classId: classes[suffix]!, title: { ar: `حصة ${suffix}` }, ...data } as never, select: { id: true } })).id;
    // Class A: a cancelled session soon, then the next one (linked to T1), then one linked to the unpublished lesson.
    const cancelledSoon = await lessonIn('A', { startsAt: new Date(now + 60 * minute), endsAt: new Date(now + 120 * minute), status: 'cancelled', meetingUrl: 'https://meet.example.com/cancelled-soon' });
    const nextA = await lessonIn('A', {
      syllabusItemId: items['T1'],
      title: { ar: 'الحصة القادمة', en: 'Next session' },
      startsAt: new Date(now + 2 * 24 * 60 * minute),
      endsAt: new Date(now + 2 * 24 * 60 * minute + 90 * minute),
      deliveryMode: 'live_online',
      meetingUrl: 'https://meet.example.com/next-a',
    });
    const draftLinked = await lessonIn('A', { syllabusItemId: items['HID'], startsAt: new Date(now + 3 * 24 * 60 * minute), endsAt: new Date(now + 3 * 24 * 60 * minute + 60 * minute) });
    // Class B: one that ended a minute ago, and one running now (it has not ended) linked to the unpublished lesson.
    await lessonIn('B', { startsAt: new Date(now - 61 * minute), endsAt: new Date(now - minute) });
    const runningB = await lessonIn('B', { syllabusItemId: items['HID'], startsAt: new Date(now - 10 * minute), endsAt: new Date(now + 50 * minute) });
    // Class D (not sA's) has a session sooner than all of them.
    await lessonIn('D', { startsAt: new Date(now + 5 * minute), endsAt: new Date(now + 30 * minute) });

    const list = (await learning('sA').expect(200)).body.items as CourseItem[];
    const byClass = new Map(list.map((entry) => [entry.class.id, entry]));
    const lessonA = await prisma.lesson.findUniqueOrThrow({ where: { id: nextA }, select: { startsAt: true, endsAt: true } });
    expect(byClass.get(classes['A']!)!.nextSession).toEqual({
      id: nextA,
      title: { ar: 'الحصة القادمة', en: 'Next session' },
      startsAt: lessonA.startsAt.toISOString(),
      endsAt: lessonA.endsAt.toISOString(),
      timeZone: academyTimeZone,
      deliveryMode: 'live_online',
      meetingUrl: 'https://meet.example.com/next-a',
      syllabusItemId: items['T1'],
    });
    expect(byClass.get(classes['B']!)!.nextSession).toMatchObject({ id: runningB, syllabusItemId: null, meetingUrl: null, deliveryMode: 'in_person' }); // a draft lesson is never named
    const child = (await learning('guardian').expect(200)).body.items as CourseItem[];
    expect(child.map((entry) => [entry.class.id, (entry.nextSession as { id: string } | null)?.id ?? null]).sort()).toEqual(
      [
        [classes['A'], nextA],
        [classes['B'], runningB],
      ].sort(),
    );

    const ws = (await workspace('sA').expect(200)).body as WorkspaceBody;
    expect(ws.sessions.slice(-3).map((entry) => [entry.id, entry.status, entry.meetingUrl, entry.syllabusItemId])).toEqual([
      [cancelledSoon, 'cancelled', null, null],
      [nextA, 'scheduled', 'https://meet.example.com/next-a', items['T1']],
      [draftLinked, 'scheduled', null, null],
    ]);
    expect(ws.sessions).toHaveLength(5); // the two of AC6 and these three — class A only
    expect(ws.sessions.map((entry) => entry.id)).not.toContain(runningB);
  });

  it(
    'documents the routes in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      expect(Object.keys(docs.body.paths['/api/me/learning'])).toEqual(['get']);
      expect(Object.keys(docs.body.paths['/api/me/learning/courses/{courseId}'])).toEqual(['get']);
      expect(Object.keys(docs.body.paths['/api/me/learning/items/{itemId}'])).toEqual(['get']);
      expect(Object.keys(docs.body.paths['/api/me/learning/items/{itemId}/visit'])).toEqual(['post']);
      expect(Object.keys(docs.body.paths['/api/me/learning/items/{itemId}/playback'])).toEqual(['put']);
      expect(Object.keys(docs.body.paths['/api/me/learning/items/{itemId}/complete'])).toEqual(['post']);
      const schemas = docs.body.components.schemas;
      for (const schema of [
        'MyLearningListDto',
        'MyLearningCourseDto',
        'MyLearningNextSessionDto',
        'LearningWorkspaceDto',
        'WorkspaceItemDto',
        'WorkspaceSessionDto',
        'LearningItemDto',
        'SavePlaybackDto',
        'LearningPlaybackResultDto',
        'LearningCompleteResultDto',
      ]) {
        expect(schemas).toHaveProperty(schema);
      }
      expect(schemas.MyLearningCourseDto.properties).toHaveProperty('nextSession');
      expect(schemas.LearningWorkspaceDto.properties).toHaveProperty('sessions');
      expect(schemas.WorkspaceSectionDto.properties.opensOn).toMatchObject({ type: 'string', nullable: true });
      expect(schemas.WorkspaceItemDto.properties.available).toMatchObject({ type: 'boolean' });
      expect(schemas.LearningNeighborDto.properties.available).toMatchObject({ type: 'boolean' });
      expect(schemas.SavePlaybackDto.properties.ranges).toMatchObject({ type: 'array', items: { type: 'array', items: { type: 'number' } } });
      expect(schemas.LearningItemDto.properties.content).toMatchObject({ type: 'object', additionalProperties: true, nullable: true });
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
