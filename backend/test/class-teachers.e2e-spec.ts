// TEST-049 — MOD-05-T03 class teachers (PUT /api/classes/:id/teachers)
// against the live development database. Skipped when no database is
// reachable. Fixture users (some holding the system `teacher` role), roles,
// a published course and classes carry a unique prefix and are deleted at the
// end — classes first, since class_teachers.teacher_user_id is Restrict
// (their audit rows stay — KI-032). Audit events are counted by fixture actor
// above an id watermark, as in TEST-030.
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
import type { UserStatus } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const PREFIX = `J${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-049 supertest';
const CLASSES = '/api/classes';
const NIL_ID = '00000000-0000-0000-0000-000000000000';

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

describe.skipIf(!available)('MOD-05 class teachers (e2e, TEST-049)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let courseId: string;
  let teacherRoleId: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const actors: string[] = [];

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const id = (name: string) => fx[name]!;
  const teachersPath = (classId: string) => `${CLASSES}/${classId}/teachers`;
  const put = (classId: string, teachers: unknown, as = 'assigner') => api().put(teachersPath(classId)).set(bearer(as)).send({ teachers });

  async function createRole(name: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: {
        key: `test_${name}_${RUN.toLowerCase()}`,
        label: { ar: `دور اختبار ${name}` },
        permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) },
      },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(
    name: string,
    roleIds: string[],
    options: { status?: UserStatus; login?: boolean; deleted?: boolean } = {},
  ): Promise<void> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Test ${name}`,
        passwordHash: options.login ? await passwords.hash(PASSWORD) : null,
        status: options.status ?? 'active',
        deletedAt: options.deleted ? new Date() : null,
        roles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
  }

  async function login(name: string): Promise<void> {
    const res = await api().post('/api/auth/login').set({ 'User-Agent': USER_AGENT }).send({ identifier: email(name), password: PASSWORD }).expect(200);
    tokens[name] = res.body.accessToken as string;
  }

  async function mark(): Promise<string> {
    const latest = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return latest?.id ?? NIL_ID;
  }

  const eventsSince = (markId: string) =>
    prisma.auditLog.findMany({ where: { id: { gt: markId }, actorUserId: { in: actors } }, orderBy: { id: 'asc' } });

  async function createClass(suffix: string): Promise<string> {
    const res = await api().post(CLASSES).set(bearer('assigner')).send({ courseId, code: code(suffix), name: { ar: `فصل ${suffix}` }, capacity: 10 }).expect(201);
    return res.body.id as string;
  }

  const stored = (classId: string) =>
    prisma.classTeacher.findMany({ where: { classId }, orderBy: [{ role: 'asc' }, { teacherUserId: 'asc' }], select: { teacherUserId: true, role: true, assignedById: true, assignedAt: true } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    courseId = (await prisma.course.create({ data: { code: code('CRS'), name: { ar: 'دورة المعلمين' }, status: 'published' }, select: { id: true } })).id;
    teacherRoleId = (await prisma.role.findUniqueOrThrow({ where: { key: 'teacher' }, select: { id: true } })).id;

    const assigner = await createRole('ctassigner', ['classes.read', 'classes.manage', 'classes.teachers.assign']);
    const manager = await createRole('ctmanager', ['classes.read', 'classes.manage']);
    await createUser('assigner', [assigner], { login: true });
    await createUser('manager', [manager], { login: true });
    await createUser('t1', [teacherRoleId], { login: true });
    await createUser('t2', [teacherRoleId]);
    await createUser('t3', [teacherRoleId], { status: 'invited' });
    await createUser('suspended', [teacherRoleId], { status: 'suspended' });
    await createUser('deleted', [teacherRoleId], { status: 'archived', deleted: true });
    await createUser('plain', []);
    for (const name of ['assigner', 'manager', 't1']) await login(name);
    actors.push(id('assigner'), id('manager'), id('t1'));
  });

  afterAll(async () => {
    try {
      await prisma.class.deleteMany({ where: { code: { startsWith: PREFIX } } });
      await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('AC1/AC5 — needs classes.teachers.assign; assigns a lead and an assistant with one event, and the new teacher sees the class at once', async () => {
    const classId = await createClass('A');
    await api().get(`${CLASSES}/${classId}`).set(bearer('t1')).expect(404);

    const m = await mark();
    const refused = await put(classId, [{ userId: id('t1'), role: 'lead' }], 'manager');
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: 'permission_denied', missing: ['classes.teachers.assign'] });
    expect(await stored(classId)).toEqual([]);
    expect(await eventsSince(m)).toEqual([]);

    const res = await put(classId, [
      { userId: id('t2'), role: 'assistant' },
      { userId: id('t1'), role: 'lead' },
    ]).expect(200);
    expect(res.body.teachers.map((teacher: { userId: string; role: string; fullName: string }) => [teacher.userId, teacher.role, teacher.fullName])).toEqual([
      [id('t1'), 'lead', 'Test t1'],
      [id('t2'), 'assistant', 'Test t2'],
    ]);
    const rows = await stored(classId);
    expect(rows.every((row) => row.assignedById === id('assigner'))).toBe(true);
    const events = await eventsSince(m);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'classes.teachers.changed',
      entityType: 'classes',
      entityId: classId,
      metadata: {
        code: code('A'),
        added: [
          { userId: id('t2'), role: 'assistant' },
          { userId: id('t1'), role: 'lead' },
        ],
        removed: [],
        roleChanged: [],
      },
    });

    const list = await api().get(CLASSES).query({ q: code('A') }).set(bearer('t1')).expect(200);
    expect(list.body.items.map((item: { id: string }) => item.id)).toEqual([classId]);
    await api().get(`${CLASSES}/${classId}`).set(bearer('t1')).expect(200);
  });

  it('AC4 — an identical list (in any order) answers 200 without writing or recording anything', async () => {
    const classId = await createClass('I');
    await put(classId, [
      { userId: id('t1'), role: 'lead' },
      { userId: id('t2'), role: 'assistant' },
    ]).expect(200);
    const before = await stored(classId);
    const m = await mark();
    const res = await put(classId, [
      { userId: id('t2'), role: 'assistant' },
      { userId: id('t1'), role: 'lead' },
    ]).expect(200);
    expect(res.body.teachers).toHaveLength(2);
    expect(await stored(classId)).toEqual(before);
    expect(await eventsSince(m)).toEqual([]);
  });

  it('swaps the lead, adds and removes teachers in one event each, and an empty list removes everyone; a removed teacher loses the class', async () => {
    const classId = await createClass('S');
    await put(classId, [
      { userId: id('t1'), role: 'lead' },
      { userId: id('t2'), role: 'assistant' },
    ]).expect(200);

    const m = await mark();
    // The invited teacher (t3) is eligible; the lead moves from t1 to t2 in the same request.
    await put(classId, [
      { userId: id('t2'), role: 'lead' },
      { userId: id('t1'), role: 'assistant' },
      { userId: id('t3'), role: 'assistant' },
    ]).expect(200);
    expect((await stored(classId)).filter((row) => row.role === 'lead').map((row) => row.teacherUserId)).toEqual([id('t2')]);
    await put(classId, [{ userId: id('t2'), role: 'lead' }]).expect(200);
    await api().get(`${CLASSES}/${classId}`).set(bearer('t1')).expect(404);
    const emptied = await put(classId, []).expect(200);
    expect(emptied.body.teachers).toEqual([]);

    expect((await eventsSince(m)).map((event) => event.metadata)).toEqual([
      {
        code: code('S'),
        added: [{ userId: id('t3'), role: 'assistant' }],
        removed: [],
        roleChanged: [
          { userId: id('t2'), from: 'assistant', to: 'lead' },
          { userId: id('t1'), from: 'lead', to: 'assistant' },
        ],
      },
      { code: code('S'), added: [], removed: [id('t1'), id('t3')], roleChanged: [] },
      { code: code('S'), added: [], removed: [id('t2')], roleChanged: [] },
    ]);
  });

  it('AC2 — more than one lead or a repeated user is 400 teachers_invalid; malformed bodies are 400; nothing is written', async () => {
    const classId = await createClass('V');
    const m = await mark();
    const twoLeads = await put(classId, [
      { userId: id('t1'), role: 'lead' },
      { userId: id('t2'), role: 'lead' },
    ]);
    expect(twoLeads.status).toBe(400);
    expect(twoLeads.body).toMatchObject({ code: 'teachers_invalid', duplicates: [], leadCount: 2 });
    const repeated = await put(classId, [
      { userId: id('t1'), role: 'lead' },
      { userId: id('t1'), role: 'assistant' },
    ]);
    expect(repeated.body).toMatchObject({ code: 'teachers_invalid', duplicates: [id('t1')], leadCount: 1 });

    const tooMany = Array.from({ length: 21 }, () => ({ userId: randomUUID(), role: 'assistant' }));
    for (const teachers of [
      [{ userId: id('t1'), role: 'boss' }],
      [{ userId: 'nope', role: 'lead' }],
      [{ userId: id('t1') }],
      [{ userId: id('t1'), role: 'lead', extra: true }],
      'not-a-list',
      tooMany,
    ]) {
      const bad = await put(classId, teachers);
      expect(bad.status, JSON.stringify(teachers).slice(0, 80)).toBe(400);
    }
    await api().put(teachersPath(classId)).set(bearer('assigner')).send({}).expect(400);
    await api().put(`${CLASSES}/not-a-uuid/teachers`).set(bearer('assigner')).send({ teachers: [] }).expect(400);
    expect(await stored(classId)).toEqual([]);
    expect(await eventsSince(m)).toEqual([]);
  });

  it('AC3 — refuses a user without the teacher role (422), a suspended one (422), a deleted or unknown one (404) and an unknown class (404), writing nothing', async () => {
    const classId = await createClass('E');
    const m = await mark();
    const plain = await put(classId, [
      { userId: id('t1'), role: 'lead' },
      { userId: id('plain'), role: 'assistant' },
    ]);
    expect(plain.status).toBe(422);
    expect(plain.body).toMatchObject({ code: 'not_a_teacher', userId: id('plain') });
    const suspended = await put(classId, [{ userId: id('suspended'), role: 'assistant' }]);
    expect(suspended.status).toBe(422);
    expect(suspended.body).toMatchObject({ code: 'user_not_eligible', userId: id('suspended'), status: 'suspended' });
    const deleted = await put(classId, [{ userId: id('deleted'), role: 'assistant' }]);
    expect(deleted.status).toBe(404);
    expect(deleted.body).toMatchObject({ code: 'user_not_found', userId: id('deleted') });
    const unknown = await put(classId, [{ userId: NIL_ID, role: 'lead' }]);
    expect(unknown.body).toMatchObject({ code: 'user_not_found', userId: NIL_ID });
    const noClass = await put(NIL_ID, [{ userId: id('t1'), role: 'lead' }]);
    expect(noClass.status).toBe(404);
    expect(noClass.body).toMatchObject({ code: 'class_not_found', classId: NIL_ID });
    expect(await stored(classId)).toEqual([]);
    expect(await eventsSince(m)).toEqual([]);
  });

  it('re-checks only the rows it writes: a teacher suspended after assignment stays while others change, but cannot be given a new role', async () => {
    const classId = await createClass('K');
    await put(classId, [{ userId: id('t2'), role: 'assistant' }]).expect(200);
    await prisma.user.update({ where: { id: id('t2') }, data: { status: 'suspended' } });
    try {
      await put(classId, [
        { userId: id('t2'), role: 'assistant' },
        { userId: id('t1'), role: 'lead' },
      ]).expect(200);
      const promote = await put(classId, [{ userId: id('t2'), role: 'lead' }]);
      expect(promote.status).toBe(422);
      expect(promote.body).toMatchObject({ code: 'user_not_eligible', userId: id('t2'), status: 'suspended' });
    } finally {
      await prisma.user.update({ where: { id: id('t2') }, data: { status: 'active' } });
    }
  });

  it(
    'checks the Origin and documents the route in OpenAPI',
    async () => {
      const classId = await createClass('O');
      const hostile = await api()
        .put(teachersPath(classId))
        .set({ ...bearer('assigner'), Origin: 'https://evil.example' })
        .send({ teachers: [{ userId: id('t1'), role: 'lead' }] });
      expect(hostile.status).toBe(403);
      expect(hostile.body.code).toBe('origin_forbidden');
      expect(await stored(classId)).toEqual([]);

      const docs = await api().get('/api/docs-json').expect(200);
      const paths = docs.body.paths as Record<string, Record<string, unknown>>;
      expect(Object.keys(paths['/api/classes/{id}/teachers'] ?? {})).toEqual(['put']);
      const schemas = docs.body.components.schemas as Record<string, unknown>;
      for (const name of ['ReplaceClassTeachersDto', 'ClassTeacherInputDto']) expect(schemas).toHaveProperty(name);
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
