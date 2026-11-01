// TEST-040 — MOD-04-T02 course levels (GET/POST /api/levels, PATCH/DELETE
// /api/levels/:id, PUT /api/levels/order) against the live development
// database. Skipped when no database is reachable. Fixture users, roles,
// levels and courses carry a unique suffix and are deleted at the end (their
// audit rows stay — KI-032); levels other clients created are only touched by
// the reorder test, which restores the original order. Audit events are
// counted by fixture actor above an id watermark, as in TEST-030.
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
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-040 supertest';
const LEVELS = '/api/levels';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const DTO_KEYS = ['code', 'courseCount', 'createdAt', 'description', 'id', 'isActive', 'name', 'sortOrder', 'updatedAt'];

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

describe.skipIf(!available)('MOD-04 levels (e2e, TEST-040)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const createdCourseIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  /** Every level id in order before the suite (restored by the reorder test). */
  let originalOrder: string[] = [];

  const code = (suffix: string) => `T${RUN}${suffix}`.slice(0, 16);
  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const actors = () => Object.values(fx);

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

  async function mark(): Promise<string> {
    const latest = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return latest?.id ?? NIL_ID;
  }

  const eventsSince = (markId: string) =>
    prisma.auditLog.findMany({ where: { id: { gt: markId }, actorUserId: { in: actors() } }, orderBy: { id: 'asc' } });

  async function createLevel(suffix: string, extra: Record<string, unknown> = {}): Promise<{ id: string; code: string; sortOrder: number }> {
    const res = await api()
      .post(LEVELS)
      .set(bearer('manager'))
      .send({ code: code(suffix), name: { ar: `مستوى ${suffix}` }, ...extra })
      .expect(201);
    return res.body as { id: string; code: string; sortOrder: number };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    originalOrder = (await prisma.level.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true } })).map((row) => row.id);

    const manager = await createRole('lvmanager', ['courses.read', 'courses.manage']);
    const reader = await createRole('lvreader', ['courses.read']);
    const outsider = await createRole('lvoutsider', ['audit.read']);
    await createUser('manager', [manager]);
    await createUser('reader', [reader]);
    await createUser('outsider', [outsider]);
    for (const name of ['manager', 'reader', 'outsider']) tokens[name] = await login(email(name));
  });

  afterAll(async () => {
    try {
      if (createdCourseIds.length > 0) await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
      await prisma.level.deleteMany({ where: { code: { startsWith: `T${RUN}` } } });
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('AC1 — reading needs courses.read, every write courses.manage (403 with the missing key, no event); anonymous is 401', async () => {
    await api().get(LEVELS).expect(401);
    const denied = await api().get(LEVELS).set(bearer('outsider')).expect(403);
    expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['courses.read'] });

    const m = await mark();
    // Thunks: supertest must not build several requests on one server before the first is sent.
    const attempts = [
      () => api().post(LEVELS).set(bearer('reader')).send({ code: code('R'), name: { ar: 'ق' } }),
      () => api().put(`${LEVELS}/order`).set(bearer('reader')).send({ levelIds: [] }),
      () => api().patch(`${LEVELS}/${NIL_ID}`).set(bearer('reader')).send({ isActive: false }),
      () => api().delete(`${LEVELS}/${NIL_ID}`).set(bearer('reader')),
    ];
    for (const attempt of attempts) {
      const res = await attempt();
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'permission_denied', missing: ['courses.manage'] });
    }
    expect(await eventsSince(m)).toEqual([]);
  });

  it('AC2 — creating appends at the end with a normalised code and exactly one levels.created; duplicates and invalid bodies change nothing', async () => {
    const before = await prisma.level.aggregate({ _max: { sortOrder: true } });
    const m = await mark();
    const res = await api()
      .post(LEVELS)
      .set(bearer('manager'))
      .send({ code: `  ${code('A').toLowerCase()} `, name: { ar: 'مبتدئ', en: 'Beginner', tr: '  ' } })
      .expect(201);
    expect(Object.keys(res.body).sort()).toEqual(DTO_KEYS);
    expect(res.body).toMatchObject({
      code: code('A'),
      name: { ar: 'مبتدئ', en: 'Beginner' },
      description: null,
      isActive: true,
      courseCount: 0,
      sortOrder: (before._max.sortOrder ?? -1) + 1,
    });
    const events = await eventsSince(m);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'levels.created',
      actorUserId: fx['manager'],
      entityType: 'levels',
      entityId: res.body.id,
      metadata: { code: code('A'), sortOrder: res.body.sortOrder },
      userAgent: USER_AGENT,
    });

    const m2 = await mark();
    const duplicate = await api().post(LEVELS).set(bearer('manager')).send({ code: code('A').toLowerCase(), name: { ar: 'مكرر' } });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({ code: 'level_code_taken', levelCode: code('A') });
    const invalid: Record<string, unknown>[] = [
      { code: code('B'), name: { en: 'no arabic' } },
      { code: code('B'), name: 'plain text' },
      { code: 'HAS SPACE', name: { ar: 'م' } },
      { code: '', name: { ar: 'م' } },
      { code: 'A'.repeat(17), name: { ar: 'م' } },
      { code: code('B'), name: { ar: 'م' }, isActive: 'yes' },
      { code: code('B'), name: { ar: 'م' }, sortOrder: 3 },
      { code: code('B'), name: { ar: 'م' }, description: { en: 'x' } },
    ];
    for (const body of invalid) {
      const bad = await api().post(LEVELS).set(bearer('manager')).send(body);
      expect(bad.status, JSON.stringify(body)).toBe(400);
    }
    expect(await eventsSince(m2)).toEqual([]);
  });

  it('AC5 — inactive levels and course counts are visible to managers only', async () => {
    const hidden = await createLevel('H', { isActive: false });
    const asReader = await api().get(LEVELS).set(bearer('reader')).expect(200);
    expect(asReader.body.items.map((item: { id: string }) => item.id)).not.toContain(hidden.id);
    for (const item of asReader.body.items) {
      expect(item.isActive).toBe(true);
      expect(item.courseCount).toBeNull();
    }
    const asManager = await api().get(LEVELS).set(bearer('manager')).expect(200);
    const found = asManager.body.items.find((item: { id: string }) => item.id === hidden.id);
    expect(found).toMatchObject({ isActive: false, courseCount: 0 });
    const orders = asManager.body.items.map((item: { sortOrder: number }) => item.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('PATCH writes only what changes with one levels.updated, clears a description to SQL NULL and refuses empty bodies, taken codes and unknown ids', async () => {
    const lvl = await createLevel('P', { description: { ar: 'وصف' } });
    const m = await mark();
    const res = await api()
      .patch(`${LEVELS}/${lvl.id}`)
      .set(bearer('manager'))
      .send({ name: { ar: `مستوى P`, en: 'Level P' }, description: null, isActive: false, code: code('P') })
      .expect(200);
    expect(res.body).toMatchObject({ name: { ar: 'مستوى P', en: 'Level P' }, description: null, isActive: false, code: code('P') });
    const events = await eventsSince(m);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'levels.updated', entityId: lvl.id, metadata: { code: code('P'), fields: ['name', 'description', 'isActive'] } });
    const stored = await prisma.$queryRaw<{ isnull: boolean }[]>`SELECT description IS NULL AS isnull FROM levels WHERE id = ${lvl.id}::uuid`;
    expect(stored[0]!.isnull).toBe(true);

    const m2 = await mark();
    await api().patch(`${LEVELS}/${lvl.id}`).set(bearer('manager')).send({ isActive: false, description: null }).expect(200);
    const empty = await api().patch(`${LEVELS}/${lvl.id}`).set(bearer('manager')).send({});
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe('nothing_to_update');
    const other = await createLevel('Q');
    const taken = await api().patch(`${LEVELS}/${lvl.id}`).set(bearer('manager')).send({ code: other.code.toLowerCase() });
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ code: 'level_code_taken' });
    const missing = await api().patch(`${LEVELS}/${NIL_ID}`).set(bearer('manager')).send({ isActive: true });
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: 'level_not_found', levelId: NIL_ID });
    await api().patch(`${LEVELS}/not-a-uuid`).set(bearer('manager')).send({ isActive: true }).expect(400);
    // Only the fixture level Q was created in between.
    expect((await eventsSince(m2)).map((event) => event.action)).toEqual(['levels.created']);
  });

  it('AC3 — a level used by a course cannot be deleted (409 level_in_use with the count); an unused one is deleted with one levels.deleted', async () => {
    const used = await createLevel('U');
    const course = await prisma.course.create({ data: { code: `T${RUN}-C`, name: { ar: 'دورة' }, levelId: used.id }, select: { id: true } });
    createdCourseIds.push(course.id);
    const m = await mark();
    const refused = await api().delete(`${LEVELS}/${used.id}`).set(bearer('manager'));
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'level_in_use', courseCount: 1 });
    const list = await api().get(LEVELS).set(bearer('manager')).expect(200);
    expect(list.body.items.find((item: { id: string }) => item.id === used.id).courseCount).toBe(1);
    expect(await eventsSince(m)).toEqual([]);

    const free = await createLevel('F');
    const m2 = await mark();
    await api().delete(`${LEVELS}/${free.id}`).set(bearer('manager')).expect(204);
    const events = await eventsSince(m2);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'levels.deleted', entityId: free.id, metadata: { code: free.code } });
    const again = await api().delete(`${LEVELS}/${free.id}`).set(bearer('manager'));
    expect(again.status).toBe(404);
    expect(again.body.code).toBe('level_not_found');
  });

  it('AC4 — reorder needs every level exactly once; a swap writes one levels.reordered, the same order nothing; the original order is restored', async () => {
    const x = await createLevel('X');
    const y = await createLevel('Y');
    const current = (await prisma.level.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true } })).map((row) => row.id);
    try {
      const m = await mark();
      const bad = [
        current.slice(1),
        [...current, NIL_ID],
        [current[0], ...current],
      ];
      for (const levelIds of bad) {
        const res = await api().put(`${LEVELS}/order`).set(bearer('manager')).send({ levelIds });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('level_order_invalid');
      }
      const detail = await api().put(`${LEVELS}/order`).set(bearer('manager')).send({ levelIds: [current[0], ...current] });
      expect(detail.body).toMatchObject({ missing: [], unknown: [], duplicates: [current[0]] });
      await api().put(`${LEVELS}/order`).set(bearer('manager')).send({ levelIds: ['nope'] }).expect(400);
      expect(await eventsSince(m)).toEqual([]);

      // Swap the two fixture levels (adjacent at the end); everything else keeps its place.
      const swapped = current.map((id) => (id === x.id ? y.id : id === y.id ? x.id : id));
      const m2 = await mark();
      const res = await api().put(`${LEVELS}/order`).set(bearer('manager')).send({ levelIds: swapped }).expect(200);
      expect(res.body.items.map((item: { id: string }) => item.id)).toEqual(swapped);
      expect(res.body.items.map((item: { sortOrder: number }) => item.sortOrder)).toEqual(swapped.map((_id, index) => index));
      const events = await eventsSince(m2);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ action: 'levels.reordered', entityType: 'levels', entityId: null, metadata: { levelIds: swapped } });

      const m3 = await mark();
      await api().put(`${LEVELS}/order`).set(bearer('manager')).send({ levelIds: swapped }).expect(200);
      expect(await eventsSince(m3)).toEqual([]);
    } finally {
      // Put the pre-existing levels back in their original relative order.
      const now = (await prisma.level.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true } })).map((row) => row.id);
      const restored = [...originalOrder.filter((id) => now.includes(id)), ...now.filter((id) => !originalOrder.includes(id))];
      await api().put(`${LEVELS}/order`).set(bearer('manager')).send({ levelIds: restored }).expect(200);
    }
  });

  it(
    'checks the Origin of writing requests and documents the routes in OpenAPI',
    async () => {
      const hostile = await api().post(LEVELS).set({ ...bearer('manager'), Origin: 'https://evil.example' }).send({ code: code('O'), name: { ar: 'م' } });
      expect(hostile.status).toBe(403);
      expect(hostile.body.code).toBe('origin_forbidden');
      expect(await prisma.level.count({ where: { code: code('O') } })).toBe(0);

      const docs = await api().get('/api/docs-json').expect(200);
      const paths = docs.body.paths as Record<string, Record<string, unknown>>;
      expect(Object.keys(paths['/api/levels'] ?? {}).sort()).toEqual(['get', 'post']);
      expect(Object.keys(paths['/api/levels/order'] ?? {})).toEqual(['put']);
      expect(Object.keys(paths['/api/levels/{id}'] ?? {}).sort()).toEqual(['delete', 'patch']);
      const schemas = docs.body.components.schemas as Record<string, unknown>;
      for (const name of ['LevelDto', 'LevelListDto', 'CreateLevelDto', 'UpdateLevelDto', 'ReorderLevelsDto']) expect(schemas).toHaveProperty(name);
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
