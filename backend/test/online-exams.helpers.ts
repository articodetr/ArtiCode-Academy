// Shared harness of the MOD-09 phase 2 e2e suites (TEST-281..TEST-286): question
// banks, the questions of an exam, attempts, grading and the journey. Import it
// from a suite in test/ — this file is not a test itself (the e2e glob is
// `**/*.e2e-spec.ts`).
//
//   `available`               true when the development database answers; every
//                             suite is `describe.skipIf(!available)`.
//   `bootHarness(testId)`     builds the real application (AppModule + configureApp,
//                             as main.ts) and a Prisma client for fixtures and
//                             assertions, and returns the helpers below. Call
//                             `close()` in afterAll: it deletes every row the
//                             suite created (its classes cascade to their exams,
//                             questions, attempts, answers and results).
//
// Fixture rows carry a prefix unique to the run. Courses, classes, teacher
// assignments and enrollments are written through Prisma — the suites of
// MOD-04/MOD-05 cover those routes — while everything of this phase goes
// through the HTTP API. Audit events are read above an id watermark and
// filtered by the fixture actors or by the entity, so another client of a
// shared database never pollutes the counts.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { PasswordService } from '../src/auth/password.service.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { ClassStatus, EnrollmentStatus } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

export const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
export const NIL_ID = '00000000-0000-0000-0000-000000000000';
const PASSWORD = 'Correct-Horse-Battery-9';

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

export const available = DATABASE_URL ? await canConnect(DATABASE_URL) : false;

export interface AuditRow {
  id: string;
  action: string;
  actorUserId: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
}

export interface OptionInput {
  text: { ar: string; en?: string };
  isCorrect: boolean;
}

export type Harness = Awaited<ReturnType<typeof bootHarness>>;

/** A `single_choice` body: `options` are Arabic texts, `correct` the index of the right one (-1 = none). */
export function choiceBody(prompt: string, options: readonly string[], correct: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'single_choice',
    status: 'ready',
    prompt: { ar: prompt },
    options: options.map((text, index): OptionInput => ({ text: { ar: text }, isCorrect: index === correct })),
    ...over,
  };
}

/** A `true_false` body. */
export function trueFalseBody(prompt: string, answer: boolean | null, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: 'true_false', status: 'ready', prompt: { ar: prompt }, ...(answer === null ? {} : { correctAnswer: answer }), ...over };
}

export async function bootHarness(testId: string) {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
  const prefix = `E${run}`;
  const userAgent = `${testId} supertest`;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
  configureApp(app);
  await app.init();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
  const passwords = new PasswordService();

  const users: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const classes: Record<string, string> = {};
  const courses: Record<string, string> = {};
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const createdBankIds: string[] = [];

  const code = (suffix: string) => `${prefix}-${suffix}`;
  const email = (name: string) => `${name.toLowerCase()}-${run.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const as = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': userAgent });
  const id = (name: string) => users[name]!;

  async function systemRole(key: string): Promise<string> {
    return (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;
  }

  async function createRole(name: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_${name}_${run.toLowerCase()}`, label: { ar: `دور اختبار ${name}` }, permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  /** An active account with these roles, signed in. */
  async function createUser(name: string, roleIds: readonly string[]): Promise<string> {
    const user = await prisma.user.create({
      data: { email: email(name), fullName: `Test ${name}`, passwordHash: await passwords.hash(PASSWORD), status: 'active', roles: { create: roleIds.map((roleId) => ({ roleId })) } },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    users[name] = user.id;
    const res = await api().post('/api/auth/login').set({ 'User-Agent': userAgent }).send({ identifier: email(name), password: PASSWORD }).expect(200);
    tokens[name] = res.body.accessToken as string;
    return user.id;
  }

  async function course(suffix: string): Promise<string> {
    const created = await prisma.course.create({ data: { code: code(suffix), name: { ar: `دورة ${suffix}`, en: `Course ${suffix}` }, status: 'published' }, select: { id: true } });
    courses[suffix] = created.id;
    return created.id;
  }

  /** A class of the course, taught by the named users (the first is the lead). */
  async function klass(suffix: string, courseSuffix: string, teachers: readonly string[], status: ClassStatus = 'open'): Promise<string> {
    const created = await prisma.class.create({
      data: {
        courseId: courses[courseSuffix]!,
        code: code(suffix),
        name: { ar: `فصل ${suffix}` },
        capacity: 20,
        status,
        teachers: { create: teachers.map((teacher, index) => ({ teacherUserId: id(teacher), role: index === 0 ? ('lead' as const) : ('assistant' as const) })) },
      },
      select: { id: true },
    });
    classes[suffix] = created.id;
    return created.id;
  }

  async function enroll(classSuffix: string, student: string, status: EnrollmentStatus = 'active'): Promise<string> {
    const created = await prisma.enrollment.create({ data: { classId: classes[classSuffix]!, studentUserId: id(student), status }, select: { id: true } });
    return created.id;
  }

  async function mark(): Promise<string> {
    const latest = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return latest?.id ?? NIL_ID;
  }

  /** The events of the fixture actors above the watermark, oldest first. */
  async function eventsSince(markId: string): Promise<AuditRow[]> {
    return prisma.auditLog.findMany({
      where: { id: { gt: markId }, actorUserId: { in: createdUserIds } },
      orderBy: { id: 'asc' },
      select: { id: true, action: true, actorUserId: true, entityType: true, entityId: true, metadata: true },
    });
  }

  /** The events on these entities above the watermark, whoever the actor (the server's own events have none). */
  async function eventsOn(markId: string, entityIds: readonly string[]): Promise<AuditRow[]> {
    return prisma.auditLog.findMany({
      where: { id: { gt: markId }, entityId: { in: [...entityIds] } },
      orderBy: { id: 'asc' },
      select: { id: true, action: true, actorUserId: true, entityType: true, entityId: true, metadata: true },
    });
  }

  // --- the routes of the phase -------------------------------------------------

  const BANKS = '/api/question-banks';
  const QUESTIONS = '/api/questions';
  const EXAMS = '/api/exams';

  /** Creates a bank through the API (201) and remembers it for the cleanup. */
  async function bank(user: string, body: Record<string, unknown>): Promise<{ id: string } & Record<string, unknown>> {
    const res = await api().post(BANKS).set(as(user)).send(body);
    if (res.status !== 201) throw new Error(`bank: ${res.status} ${JSON.stringify(res.body)}`);
    createdBankIds.push(res.body.id as string);
    return res.body;
  }

  /** Creates a question through the API (201). */
  async function question(user: string, bankId: string, body: Record<string, unknown>): Promise<{ id: string; options: { id: string; isCorrect: boolean }[] } & Record<string, unknown>> {
    const res = await api().post(`${BANKS}/${bankId}/questions`).set(as(user)).send(body);
    if (res.status !== 201) throw new Error(`question: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }

  const createExam = (user: string, classSuffix: string, body: Record<string, unknown>) => api().post(`/api/classes/${classes[classSuffix] ?? classSuffix}/exams`).set(as(user)).send(body);
  const readExam = (user: string, examId: string) => api().get(`${EXAMS}/${examId}`).set(as(user));
  const patchExam = (user: string, examId: string, body: Record<string, unknown>) => api().patch(`${EXAMS}/${examId}`).set(as(user)).send(body);
  const act = (user: string, examId: string, action: string) => api().post(`${EXAMS}/${examId}/status`).set(as(user)).send({ action });
  const readQuestions = (user: string, examId: string) => api().get(`${EXAMS}/${examId}/questions`).set(as(user));
  const link = (user: string, examId: string, entries: readonly { questionId: string; points?: number }[]) =>
    api()
      .put(`${EXAMS}/${examId}/questions`)
      .set(as(user))
      .send({ questions: entries });

  /** Deletes what the suite created. Enrollments first (Restrict), then the classes (they cascade to the exams of this phase), the banks, the courses, the users and the roles. */
  async function close(): Promise<void> {
    try {
      const classIds = Object.values(classes);
      if (classIds.length > 0) {
        await prisma.finalGrade.deleteMany({ where: { enrollment: { classId: { in: classIds } } } });
        await prisma.enrollment.deleteMany({ where: { classId: { in: classIds } } });
        await prisma.class.deleteMany({ where: { id: { in: classIds } } });
      }
      // Banks created by the fixture users, wherever they were created from.
      await prisma.questionBank.deleteMany({ where: { OR: [{ id: { in: createdBankIds } }, { createdById: { in: createdUserIds } }] } });
      await prisma.course.deleteMany({ where: { code: { startsWith: prefix } } });
    } finally {
      try {
        // Notifications cascade with their recipients; the append-only audit rows keep a NULL actor.
        if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
        if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      } finally {
        await prisma.$disconnect();
        await app.close();
      }
    }
  }

  return {
    app,
    prisma,
    run,
    prefix,
    users,
    tokens,
    classes,
    courses,
    createdUserIds,
    BANKS,
    QUESTIONS,
    EXAMS,
    code,
    email,
    api,
    as,
    id,
    systemRole,
    createRole,
    createUser,
    course,
    klass,
    enroll,
    mark,
    eventsSince,
    eventsOn,
    bank,
    question,
    createExam,
    readExam,
    patchExam,
    act,
    readQuestions,
    link,
    close,
  };
}
