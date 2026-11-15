// TEST-214 (CH-0226) — API-200 GET /api/users/:id/enrollments: one student's
// enrollments across every class, for a holder of `enrollments.manage` or
// `invoices.manage`, against the live development database. Skipped when no
// database is reachable. Fixtures carry a unique prefix and are deleted at the
// end; audit events are counted by fixture actor above an id watermark (reads
// record none).
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
const PREFIX = `SE${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const ITEM_KEYS = ['activatedAt', 'class', 'completedAt', 'enrolledAt', 'id', 'source', 'status', 'withdrawalReason', 'withdrawnAt'];
const CLASS_KEYS = ['code', 'course', 'endsOn', 'id', 'leadTeacher', 'name', 'startsOn', 'status'];

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

describe.skipIf(!available)("API-200 a student's enrollments (e2e, TEST-214)", () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let studentRoleId: string;
  let courseId: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const classes: Record<string, string> = {};
  const enrollments: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const path = (userId: string) => `/api/users/${userId}/enrollments`;
  const read = (as: string, userId: string, query = '') =>
    api().get(`${path(userId)}${query}`).set('Authorization', `Bearer ${tokens[as]}`);

  async function createRole(name: string, keys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_${name}_${RUN.toLowerCase()}`, label: { ar: `دور ${name}` }, permissions: { create: keys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(name: string, roleIds: string[], options: { password?: boolean; deleted?: boolean } = {}): Promise<void> {
    const passwords = new PasswordService();
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Test ${name}`,
        passwordHash: options.password === false ? null : await passwords.hash(PASSWORD),
        status: options.deleted ? 'archived' : 'active',
        deletedAt: options.deleted ? new Date() : null,
        roles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
  }

  async function login(name: string): Promise<void> {
    const res = await api().post('/api/auth/login').send({ identifier: email(name), password: PASSWORD }).expect(200);
    tokens[name] = res.body.accessToken as string;
  }

  async function enroll(key: string, classSuffix: string, student: string, status: EnrollmentStatus, extra: Record<string, unknown> = {}) {
    const row = await prisma.enrollment.create({
      data: { classId: classes[classSuffix]!, studentUserId: fx[student]!, status, ...extra },
      select: { id: true },
    });
    enrollments[key] = row.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });

    studentRoleId = (await prisma.role.findUniqueOrThrow({ where: { key: 'student' }, select: { id: true } })).id;
    courseId = (
      await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة', en: 'Course' }, status: 'published' }, select: { id: true } })
    ).id;

    await createUser('manager', [await createRole('semanager', ['enrollments.manage'])]);
    await createUser('invoicer', [await createRole('seinvoicer', ['invoices.manage'])]);
    await createUser('teacher', [await createRole('seteacher', ['classes.read', 'enrollments.read', 'users.read'])]);
    for (const name of ['manager', 'invoicer', 'teacher']) await login(name);
    await createUser('student', [studentRoleId], { password: false });
    await createUser('other', [studentRoleId], { password: false });
    await createUser('gone', [studentRoleId], { password: false, deleted: true });
    await createUser('nobody', [], { password: false });

    for (const suffix of ['A', 'B', 'C']) {
      classes[suffix] = (
        await prisma.class.create({
          data: { courseId, code: code(suffix), name: { ar: `فصل ${suffix}` }, capacity: 10, status: 'running', startsOn: new Date('2026-11-01') },
          select: { id: true },
        })
      ).id;
    }
    await prisma.classTeacher.create({ data: { classId: classes['A']!, teacherUserId: fx['teacher']!, role: 'lead' } });

    // Created in this order, so newest first is C, B, A.
    await enroll('a', 'A', 'student', 'completed', { completedAt: new Date() });
    await enroll('b', 'B', 'student', 'withdrawn', { withdrawnAt: new Date(), withdrawalReason: 'moved to another city' });
    await enroll('c', 'C', 'student', 'active', { activatedAt: new Date() });
    await enroll('other', 'A', 'other', 'active', { activatedAt: new Date() });
    await enroll('gone', 'B', 'gone', 'completed', { completedAt: new Date() });
  });

  afterAll(async () => {
    if (!prisma) {
      await app?.close();
      return;
    }
    try {
      await prisma.enrollment.deleteMany({ where: { class: { code: { startsWith: PREFIX } } } });
      await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
      await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('AC1: enrollments.manage reads every class of the student, newest first, with the class summary and the withdrawal reason — and records nothing', async () => {
    const watermark = (await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } }))?.id ?? NIL_ID;
    const res = await read('manager', fx['student']!).expect(200);

    expect(Object.keys(res.body)).toEqual(['items']);
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([enrollments['c'], enrollments['b'], enrollments['a']]);
    for (const item of res.body.items) {
      expect(Object.keys(item).sort()).toEqual(ITEM_KEYS);
      expect(Object.keys(item.class).sort()).toEqual(CLASS_KEYS);
    }
    const [c, b, a] = res.body.items;
    expect(c).toMatchObject({ status: 'active', source: 'admin', withdrawalReason: null, class: { id: classes['C'], code: code('C'), leadTeacher: null } });
    expect(b).toMatchObject({ status: 'withdrawn', withdrawalReason: 'moved to another city' });
    expect(b.withdrawnAt).toEqual(expect.any(String));
    expect(a.class).toEqual({
      id: classes['A'],
      code: code('A'),
      name: { ar: 'فصل A' },
      status: 'running',
      startsOn: '2026-11-01',
      endsOn: null,
      course: { id: courseId, code: code('CRS'), name: { ar: 'دورة', en: 'Course' } },
      leadTeacher: { fullName: 'Test teacher', displayName: null },
    });
    expect(JSON.stringify(res.body)).not.toContain(fx['other']!);

    const events = await prisma.auditLog.count({ where: { id: { gt: watermark }, actorUserId: { in: Object.values(fx) } } });
    expect(events).toBe(0);
  });

  it('AC2: invoices.manage alone reads the same list without the withdrawal reason; status filters', async () => {
    const res = await read('invoicer', fx['student']!).expect(200);
    expect(res.body.items).toHaveLength(3);
    expect(res.body.items.every((item: { withdrawalReason: string | null }) => item.withdrawalReason === null)).toBe(true);

    const active = await read('invoicer', fx['student']!, '?status=active').expect(200);
    expect(active.body.items.map((item: { id: string }) => item.id)).toEqual([enrollments['c']]);
    expect((await read('invoicer', fx['student']!, '?status=pending').expect(200)).body.items).toEqual([]);
  });

  it('AC3: a soft-deleted student keeps their history; a user who is not a student has an empty list; an unknown id is 404', async () => {
    const gone = await read('manager', fx['gone']!).expect(200);
    expect(gone.body.items.map((item: { id: string }) => item.id)).toEqual([enrollments['gone']]);
    expect((await read('manager', fx['nobody']!).expect(200)).body).toEqual({ items: [] });

    const unknown = await read('manager', NIL_ID).expect(404);
    expect(unknown.body).toMatchObject({ code: 'user_not_found', userId: NIL_ID });
  });

  it('AC4: neither key is 403 with both keys missing (a teacher of the class too); bad input is 400; no session is 401', async () => {
    const denied = await read('teacher', fx['student']!).expect(403);
    expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['enrollments.manage', 'invoices.manage'] });

    await read('manager', 'not-a-uuid').expect(400);
    await read('manager', fx['student']!, '?status=graduated').expect(400);
    await read('manager', fx['student']!, '?limit=5').expect(400);
    await api().get(path(fx['student']!)).expect(401);
  });

  it('AC5: documented in OpenAPI', async () => {
    const docs = await api().get('/api/docs-json').expect(200);
    expect(Object.keys(docs.body.paths['/api/users/{id}/enrollments'])).toEqual(['get']);
  });
});
