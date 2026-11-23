// TEST-324 — KI-151: the «total» of «submitted / total» on assignments and
// exams counts the active and completed enrollments, so a completed class no
// longer shows `4 / 0`. A withdrawn student is left out. Fixtures carry a
// unique prefix and are deleted at the end. Skipped when no database is reachable.
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
const PREFIX = `RT${RUN}`;
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

const available = DATABASE_URL ? await canConnect(DATABASE_URL) : false;

describe.skipIf(!available)('KI-151 class roster totals (e2e, TEST-324)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let token: string;
  let classId: string;
  const userIds: string[] = [];

  async function createUser(name: string, roleKey: string, password?: string): Promise<string> {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey }, select: { id: true } });
    const user = await prisma.user.create({
      data: { email: `${name}-${RUN}@example.test`.toLowerCase(), fullName: `Test ${name}`, passwordHash: password, status: 'active', roles: { create: [{ roleId: role.id }] } },
      select: { id: true },
    });
    userIds.push(user.id);
    return user.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    await createUser('admin', 'academy_admin', await new PasswordService().hash(PASSWORD));
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ identifier: `admin-${RUN}@example.test`.toLowerCase(), password: PASSWORD }).expect(200);
    token = login.body.accessToken as string;
    const done1 = await createUser('done1', 'student');
    const done2 = await createUser('done2', 'student');
    const left = await createUser('left', 'student');
    const course = await prisma.course.create({ data: { code: `${PREFIX}-C`, name: { ar: 'دورة' }, status: 'published' }, select: { id: true } });
    const klass = await prisma.class.create({
      data: {
        courseId: course.id,
        code: `${PREFIX}-K`,
        name: { ar: 'فصل مكتمل' },
        capacity: 10,
        status: 'completed',
        enrollments: {
          create: [
            { studentUserId: done1, status: 'completed', activatedAt: new Date(), completedAt: new Date(), source: 'admin' },
            { studentUserId: done2, status: 'completed', activatedAt: new Date(), completedAt: new Date(), source: 'admin' },
            { studentUserId: left, status: 'withdrawn', activatedAt: new Date(), withdrawnAt: new Date(), source: 'admin' },
          ],
        },
      },
      select: { id: true },
    });
    classId = klass.id;
    await prisma.assignment.create({ data: { classId, title: { ar: 'واجب' }, status: 'closed', publishedAt: new Date(), closedAt: new Date(), maxScore: 10 }, select: { id: true } });
    await prisma.exam.create({ data: { classId, title: { ar: 'اختبار' }, type: 'quiz', status: 'scheduled', maxScore: 10 }, select: { id: true } });
  }, 120_000);

  afterAll(async () => {
    try {
      if (prisma && classId) {
        await prisma.enrollment.deleteMany({ where: { classId } });
        await prisma.class.deleteMany({ where: { id: classId } });
        await prisma.course.deleteMany({ where: { code: `${PREFIX}-C` } });
      }
    } finally {
      if (prisma) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('counts the completed students of a completed class and leaves out the withdrawn one', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const assignments = await request(app.getHttpServer()).get(`/api/assignments?classId=${classId}`).set(auth).expect(200);
    expect(assignments.body.items[0].activeStudents).toBe(2);
    const exams = await request(app.getHttpServer()).get(`/api/exams?classId=${classId}`).set(auth).expect(200);
    expect(exams.body.items[0].activeStudents).toBe(2);
  });
});
