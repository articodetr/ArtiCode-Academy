// TEST-046 — WF-05 "create a course and its levels" (MOD-04-T07 backend half,
// task C2, CH-0051) through the API against the live development database: a
// manager creates a level, then a course on it with a three-item syllabus, and
// publishes it; a student (the seeded `student` system role) sees the course
// with its level and syllabus but never another draft; the manager reads the
// journey's events in GET /api/audit-logs, the student may not. Skipped when no
// database is reachable. Fixtures carry a unique prefix and are deleted at the
// end (their audit rows stay — KI-032). The browser journey of WF-05 is the
// owner's task O7.
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
/** Level code (≤ 16 characters) and prefix of the course codes. */
const PREFIX = `W${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-046 supertest';

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

describe.skipIf(!available)('WF-05 course and levels journey (e2e, TEST-046)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });

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

    // A manager without academy_admin (so TEST-026's last-admin test never touches it) and the real student role.
    const manager = await prisma.role.create({
      data: {
        key: `test_wf05_${RUN.toLowerCase()}`,
        label: { ar: 'دور اختبار WF-05' },
        permissions: { create: ['courses.read', 'courses.manage', 'audit.read'].map((permissionKey) => ({ permissionKey })) },
      },
      select: { id: true },
    });
    createdRoleIds.push(manager.id);
    const student = await prisma.role.findUniqueOrThrow({ where: { key: 'student' }, select: { id: true } });
    await createUser('manager', [manager.id]);
    await createUser('student', [student.id]);
    for (const name of ['manager', 'student']) tokens[name] = await login(email(name));
  });

  afterAll(async () => {
    try {
      // Courses first: their level is Restrict.
      await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
      await prisma.level.deleteMany({ where: { code: PREFIX } });
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('a manager builds and publishes a course with a three-item syllabus; a student sees it with its level and syllabus, never the draft; the events are in the audit log', async () => {
    // 1–4. The manager: level → course on the level → syllabus of three items → publish; plus a draft that stays hidden.
    const level = await api()
      .post('/api/levels')
      .set(bearer('manager'))
      .send({ code: PREFIX, name: { ar: 'مستوى WF-05', en: 'WF-05 level' } })
      .expect(201);
    const course = await api()
      .post('/api/courses')
      .set(bearer('manager'))
      .send({ code: `${PREFIX}-PUB`, name: { ar: 'دورة WF-05', en: 'WF-05 course' }, levelId: level.body.id })
      .expect(201);
    expect(course.body.status).toBe('draft');
    const titles = ['الدرس الأول', 'الدرس الثاني', 'الدرس الثالث'];
    const written = await api()
      .put(`/api/courses/${course.body.id}/syllabus`)
      .set(bearer('manager'))
      .send({ items: titles.map((ar, index) => ({ title: { ar }, ...(index === 1 ? { estimatedMinutes: 45 } : {}) })) })
      .expect(200);
    expect(written.body.items).toHaveLength(3);
    const published = await api().post(`/api/courses/${course.body.id}/status`).set(bearer('manager')).send({ action: 'publish' }).expect(200);
    expect(published.body.status).toBe('published');
    const draft = await api().post('/api/courses').set(bearer('manager')).send({ code: `${PREFIX}-DRAFT`, name: { ar: 'مسودة WF-05' } }).expect(201);

    // 5. The student: the published course with its level and syllabus; the draft does not exist for them.
    const list = await api().get('/api/courses').query({ q: PREFIX, limit: 50 }).set(bearer('student')).expect(200);
    expect(list.body.items.map((item: { code: string }) => item.code)).toEqual([`${PREFIX}-PUB`]);
    const detail = await api().get(`/api/courses/${course.body.id}`).set(bearer('student')).expect(200);
    expect(detail.body).toMatchObject({ code: `${PREFIX}-PUB`, status: 'published', syllabusCount: 3, level: { id: level.body.id, code: PREFIX } });
    const seen = await api().get(`/api/courses/${course.body.id}/syllabus`).set(bearer('student')).expect(200);
    expect(seen.body.items.map((item: { title: { ar: string } }) => item.title.ar)).toEqual(titles);
    expect(seen.body.items.map((item: { sortOrder: number }) => item.sortOrder)).toEqual([0, 1, 2]);
    expect(seen.body.items[1]).toMatchObject({ estimatedMinutes: 45 });
    expect((await api().get(`/api/courses/${draft.body.id}`).set(bearer('student')).expect(404)).body.code).toBe('course_not_found');
    await api().get(`/api/courses/${draft.body.id}/syllabus`).set(bearer('student')).expect(404);
    const levels = await api().get('/api/levels').set(bearer('student')).expect(200);
    expect(levels.body.items.map((item: { id: string }) => item.id)).toContain(level.body.id);
    // …and cannot write.
    await api().post(`/api/courses/${draft.body.id}/status`).set(bearer('student')).send({ action: 'publish' }).expect(403);
    await api().put(`/api/courses/${course.body.id}/syllabus`).set(bearer('student')).send({ items: [] }).expect(403);

    // 6. The audit log holds the journey's events (newest first) for the manager; the student may not read it.
    const log = await api().get('/api/audit-logs').query({ actorUserId: fx['manager'], limit: 50 }).set(bearer('manager')).expect(200);
    const journey = (log.body.items as { action: string; entityId: string | null }[]).filter((item) => !item.action.startsWith('auth.'));
    expect(journey.map((item) => [item.action, item.entityId])).toEqual([
      ['courses.created', draft.body.id],
      ['courses.status.changed', course.body.id],
      ['courses.syllabus.changed', course.body.id],
      ['courses.created', course.body.id],
      ['levels.created', level.body.id],
    ]);
    await api().get('/api/audit-logs').set(bearer('student')).expect(403);
  });
});
