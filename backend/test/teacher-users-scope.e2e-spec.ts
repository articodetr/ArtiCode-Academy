// TEST-325 — KI-153: a teacher reads only the people of their own classes: their
// students, co-teachers and those students' guardians. Other users are absent
// from the list and answer 404. An academy admin still reads everyone. Fixtures
// carry a unique prefix and are deleted at the end. Skipped without a database.
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
const PREFIX = `TU${RUN}`;
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

describe.skipIf(!available)('KI-153 teacher user scope (e2e, TEST-325)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  const u: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const emailOf = (name: string) => `${name}-${RUN}@example.test`.toLowerCase();
  const get = (as: string, path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${tokens[as]}`);

  async function createUser(name: string, roleKey: string, hash?: string): Promise<void> {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey }, select: { id: true } });
    const row = await prisma.user.create({
      data: { email: emailOf(name), fullName: `${PREFIX} ${name}`, passwordHash: hash, status: 'active', roles: { create: [{ roleId: role.id }] } },
      select: { id: true },
    });
    u[name] = row.id;
    if (hash) tokens[name] = (await request(app.getHttpServer()).post('/api/auth/login').send({ identifier: emailOf(name), password: PASSWORD }).expect(200)).body.accessToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    const hash = await new PasswordService().hash(PASSWORD);
    await createUser('teacher', 'teacher', hash);
    await createUser('admin', 'academy_admin', hash);
    await createUser('coteacher', 'teacher');
    await createUser('otherteacher', 'teacher');
    await createUser('mine', 'student');
    await createUser('other', 'student');
    await createUser('guardian', 'guardian');
    await createUser('otherguardian', 'guardian');
    await prisma.guardianStudent.createMany({
      data: [
        { guardianUserId: u['guardian']!, studentUserId: u['mine']!, relationship: 'mother', isPrimary: true },
        { guardianUserId: u['guardian']!, studentUserId: u['other']!, relationship: 'mother', isPrimary: true },
        { guardianUserId: u['otherguardian']!, studentUserId: u['other']!, relationship: 'father', isPrimary: false },
      ],
    });
    const course = await prisma.course.create({ data: { code: `${PREFIX}-C`, name: { ar: 'دورة' }, status: 'published' }, select: { id: true } });
    await prisma.class.create({
      data: {
        courseId: course.id, code: `${PREFIX}-A`, name: { ar: 'فصلي' }, capacity: 10, status: 'running',
        teachers: { create: [{ teacherUserId: u['teacher']!, role: 'lead' }, { teacherUserId: u['coteacher']!, role: 'assistant' }] },
        enrollments: { create: [{ studentUserId: u['mine']!, status: 'active', activatedAt: new Date(), source: 'admin' }] },
      },
      select: { id: true },
    });
    await prisma.class.create({
      data: {
        courseId: course.id, code: `${PREFIX}-B`, name: { ar: 'فصل آخر' }, capacity: 10, status: 'running',
        teachers: { create: [{ teacherUserId: u['otherteacher']!, role: 'lead' }] },
        enrollments: { create: [{ studentUserId: u['other']!, status: 'active', activatedAt: new Date(), source: 'admin' }] },
      },
      select: { id: true },
    });
  }, 120_000);

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.enrollment.deleteMany({ where: { class: { code: { startsWith: PREFIX } } } });
        await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
        await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
      }
    } finally {
      if (prisma) await prisma.user.deleteMany({ where: { id: { in: Object.values(u) } } });
      await prisma?.$disconnect();
      await app?.close();
    }
  });

  it('lists only the teacher, their students, co-teachers and those students’ guardians', async () => {
    const res = await get('teacher', `/api/users?q=${PREFIX}&limit=100`).expect(200);
    const ids = (res.body.items as { id: string }[]).map((item) => item.id).sort();
    expect(ids).toEqual([u['teacher']!, u['coteacher']!, u['mine']!, u['guardian']!].sort());
  });

  it('answers 404 for anyone else, and hides another child of a visible guardian', async () => {
    await get('teacher', `/api/users/${u['mine']}`).expect(200);
    const guardianDetail = await get('teacher', `/api/users/${u['guardian']}`).expect(200);
    expect((guardianDetail.body.students as { userId: string }[]).map((link) => link.userId)).toEqual([u['mine']]);
    for (const name of ['other', 'otherteacher', 'otherguardian', 'admin']) await get('teacher', `/api/users/${u[name]}`).expect(404);
    await get('teacher', `/api/users/${u['other']}/guardians`).expect(404);
    const children = await get('teacher', `/api/users/${u['guardian']}/students`).expect(200);
    expect((children.body.items as { user: { id: string } }[]).map((item) => item.user.id)).toEqual([u['mine']]);
  });

  it('leaves an academy admin reading everyone', async () => {
    const res = await get('admin', `/api/users?q=${PREFIX}&limit=100`).expect(200);
    expect(res.body.items).toHaveLength(8);
    await get('admin', `/api/users/${u['other']}`).expect(200);
  });
});
