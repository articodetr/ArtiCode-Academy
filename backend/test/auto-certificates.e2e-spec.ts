// TEST-323 — CH-0363: the automatic course-completion certificate. Finishing
// every required published lesson issues one certificate without a grade, for
// the student's own enrollment, with its notification and one audit event.
// One per student and course; a revoked one is never reissued automatically.
// Fixtures carry a unique prefix and are deleted at the end. Skipped when no
// database is reachable.
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
const PREFIX = `AC${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-323 supertest';

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

describe.skipIf(!available)('CH-0363 automatic certificates (e2e, TEST-323)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  const users: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const courses: string[] = [];

  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const complete = (as: string, itemId: string) => api().post(`/api/me/learning/items/${itemId}/complete`).set(bearer(as)).send({});
  const certificatesOf = (student: string, courseId: string) => prisma.certificate.findMany({ where: { studentUserId: users[student]!, courseId } });

  async function createUser(name: string, roleKey: string): Promise<void> {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey }, select: { id: true } });
    const email = `${name}-${RUN}@example.test`.toLowerCase();
    const user = await prisma.user.create({
      data: { email, fullName: `Test ${name}`, passwordHash: await passwords.hash(PASSWORD), status: 'active', roles: { create: [{ roleId: role.id }] } },
      select: { id: true },
    });
    users[name] = user.id;
    const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email, password: PASSWORD }).expect(200);
    tokens[name] = res.body.accessToken as string;
  }

  async function createCourse(suffix: string, kinds: readonly ('text' | 'live')[]) {
    const course = await prisma.course.create({ data: { code: `${PREFIX}-${suffix}`, name: { ar: `دورة ${suffix}` }, status: 'published' }, select: { id: true } });
    courses.push(course.id);
    const items: string[] = [];
    for (const [sortOrder, kind] of kinds.entries()) {
      const item = await prisma.courseSyllabusItem.create({
        data: { courseId: course.id, sortOrder, kind, title: { ar: `درس ${sortOrder}` }, content: kind === 'text' ? { body: { ar: 'نص' } } : { note: null } },
        select: { id: true },
      });
      items.push(item.id);
    }
    return { courseId: course.id, items };
  }

  async function createClass(courseId: string, suffix: string, students: readonly string[]): Promise<string> {
    const row = await prisma.class.create({
      data: {
        courseId,
        code: `${PREFIX}-${suffix}`,
        name: { ar: `فصل ${suffix}` },
        capacity: 10,
        status: 'running',
        teachers: { create: [{ teacherUserId: users['teacher']!, role: 'lead' }] },
        enrollments: { create: students.map((name) => ({ studentUserId: users[name]!, status: 'active' as const, activatedAt: new Date(), source: 'admin' as const })) },
      },
      select: { id: true },
    });
    return row.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    for (const name of ['s1', 's2', 's3', 's4', 's5']) await createUser(name, 'student');
    await createUser('teacher', 'teacher');
  }, 120_000);

  afterAll(async () => {
    try {
      if (prisma && courses.length > 0) {
        await prisma.certificate.deleteMany({ where: { courseId: { in: courses } } });
        await prisma.learningProgress.deleteMany({ where: { courseId: { in: courses } } });
        await prisma.attendanceRecord.deleteMany({ where: { studentUserId: { in: Object.values(users) } } });
        await prisma.enrollment.deleteMany({ where: { class: { courseId: { in: courses } } } });
        await prisma.class.deleteMany({ where: { courseId: { in: courses } } });
        await prisma.course.deleteMany({ where: { id: { in: courses } } });
      }
    } finally {
      if (prisma) await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('AC1 — the last required lesson issues one certificate without a grade, with its notification and one system audit event', async () => {
    const { courseId, items } = await createCourse('A', ['text', 'text']);
    const classId = await createClass(courseId, 'A', ['s1']);
    const first = await complete('s1', items[0]!).expect(200);
    expect(first.body.certificate).toBeNull();
    expect(await certificatesOf('s1', courseId)).toHaveLength(0);

    const last = await complete('s1', items[1]!).expect(200);
    expect(last.body.certificate).toEqual({ id: expect.any(String), serial: expect.any(String) });
    const [row, ...others] = await certificatesOf('s1', courseId);
    expect(others).toHaveLength(0);
    expect(row).toMatchObject({ status: 'issued', percent: null, bandLabel: null, bandLetter: null, issuedById: null, classId });

    const mine = await api().get('/api/me/certificates').set(bearer('s1')).expect(200);
    expect(mine.body.items[0]).toMatchObject({ id: row!.id, grade: null, snapshot: { grade: null } });
    const verified = await api().get(`/api/certificates/verify/${row!.verificationCode}`).expect(200);
    expect(verified.body).toMatchObject({ status: 'issued', grade: null });

    expect(await prisma.notification.count({ where: { recipientUserId: users['s1']!, eventKey: 'certificate.issued' } })).toBe(1);
    const events = await prisma.auditLog.findMany({ where: { action: 'certificates.issued', entityId: classId }, select: { actorUserId: true, metadata: true } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorUserId: null, metadata: { source: 'course_completion', certificateIds: [row!.id] } });
  });

  it('AC2 — completing again issues nothing more', async () => {
    const { courseId, items } = await createCourse('B', ['text']);
    await createClass(courseId, 'B', ['s2']);
    await complete('s2', items[0]!).expect(200);
    const again = await complete('s2', items[0]!).expect(200);
    expect(again.body).toMatchObject({ completedNow: false, certificate: null });
    expect(await certificatesOf('s2', courseId)).toHaveLength(1);
  });

  it('AC3 — one certificate per course across its classes, and a revoked one is not reissued', async () => {
    const { courseId, items } = await createCourse('C', ['text', 'text']);
    await createClass(courseId, 'C1', ['s3']);
    await createClass(courseId, 'C2', ['s3']);
    await complete('s3', items[0]!).expect(200);
    await complete('s3', items[1]!).expect(200);
    const [issued] = await certificatesOf('s3', courseId);
    expect(await certificatesOf('s3', courseId)).toHaveLength(1);

    await prisma.certificate.update({ where: { id: issued!.id }, data: { status: 'revoked', revokedAt: new Date(), revokeReason: 'test' } });
    const added = await prisma.courseSyllabusItem.create({ data: { courseId, sortOrder: 2, kind: 'text', title: { ar: 'درس جديد' }, content: { body: { ar: 'نص' } } }, select: { id: true } });
    const res = await complete('s3', added.id).expect(200);
    expect(res.body.certificate).toBeNull();
    expect(await certificatesOf('s3', courseId)).toHaveLength(1);
  });

  it('AC4 — a required live lesson finishes the course when the teacher records attendance; an absence does not', async () => {
    const { courseId, items } = await createCourse('D', ['text', 'live']);
    const classId = await createClass(courseId, 'D', ['s4', 's5']);
    const lesson = await prisma.lesson.create({
      data: {
        classId,
        syllabusItemId: items[1]!,
        title: { ar: 'حصة' },
        deliveryMode: 'in_person',
        startsAt: new Date(Date.now() - 3 * 3600_000),
        endsAt: new Date(Date.now() - 2 * 3600_000),
        teacherUserId: users['teacher']!,
      },
      select: { id: true },
    });
    await complete('s4', items[0]!).expect(200);
    await complete('s5', items[0]!).expect(200);
    await api()
      .put(`/api/lessons/${lesson.id}/attendance`)
      .set(bearer('teacher'))
      .send({ records: [{ studentId: users['s4'], status: 'present' }, { studentId: users['s5'], status: 'absent' }] })
      .expect(200);
    expect(await certificatesOf('s4', courseId)).toHaveLength(1);
    expect(await certificatesOf('s5', courseId)).toHaveLength(0);
  });
});
