// PORTAL-04 — the school subjects (GET/POST /api/subjects, PATCH/DELETE
// /api/subjects/:id, PUT /api/subjects/order), a mirror of TEST-040 (levels),
// against the live development database (TEST id not reserved yet). Skipped
// when no database is reachable. Fixture users, roles, subjects and courses
// carry a unique suffix and are deleted at the end (their audit rows stay —
// KI-032); subjects other clients created are only touched by the reorder
// test, which restores the original order. Audit events are counted by
// fixture actor above an id watermark, as in TEST-030.
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
const USER_AGENT = 'PORTAL-04 subjects supertest';
const SUBJECTS = '/api/subjects';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const DTO_KEYS = ['code', 'courseCount', 'createdAt', 'id', 'isActive', 'name', 'sortOrder', 'updatedAt'];

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

describe.skipIf(!available)('PORTAL-04 subjects (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const createdCourseIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  /** Every subject id in order before the suite (restored by the reorder test). */
  let originalOrder: string[] = [];

  const code = (suffix: string) => `S${RUN}${suffix}`.slice(0, 16);
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

  async function createSubject(suffix: string, extra: Record<string, unknown> = {}): Promise<{ id: string; code: string; sortOrder: number }> {
    const res = await api()
      .post(SUBJECTS)
      .set(bearer('manager'))
      .send({ code: code(suffix), name: { ar: `مادة ${suffix}` }, ...extra })
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

    originalOrder = (await prisma.subject.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true } })).map((row) => row.id);

    const manager = await createRole('sbmanager', ['courses.read', 'courses.manage']);
    const reader = await createRole('sbreader', ['courses.read']);
    const outsider = await createRole('sboutsider', ['audit.read']);
    await createUser('manager', [manager]);
    await createUser('reader', [reader]);
    await createUser('outsider', [outsider]);
    for (const name of ['manager', 'reader', 'outsider']) tokens[name] = await login(email(name));
  });

  afterAll(async () => {
    try {
      if (createdCourseIds.length > 0) await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
      await prisma.subject.deleteMany({ where: { code: { startsWith: `S${RUN}` } } });
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('reading needs courses.read, every write courses.manage (403 with the missing key, no event); anonymous is 401', async () => {
    await api().get(SUBJECTS).expect(401);
    const denied = await api().get(SUBJECTS).set(bearer('outsider')).expect(403);
    expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['courses.read'] });

    const m = await mark();
    // Thunks: supertest must not build several requests on one server before the first is sent.
    const attempts = [
      () => api().post(SUBJECTS).set(bearer('reader')).send({ code: code('R'), name: { ar: 'ق' } }),
      () => api().put(`${SUBJECTS}/order`).set(bearer('reader')).send({ subjectIds: [] }),
      () => api().patch(`${SUBJECTS}/${NIL_ID}`).set(bearer('reader')).send({ isActive: false }),
      () => api().delete(`${SUBJECTS}/${NIL_ID}`).set(bearer('reader')),
    ];
    for (const attempt of attempts) {
      const res = await attempt();
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'permission_denied', missing: ['courses.manage'] });
    }
    expect(await eventsSince(m)).toEqual([]);
  });

  it('creating appends at the end with a normalised code and exactly one subjects.created; duplicates and invalid bodies change nothing', async () => {
    const before = await prisma.subject.aggregate({ _max: { sortOrder: true } });
    const m = await mark();
    const res = await api()
      .post(SUBJECTS)
      .set(bearer('manager'))
      .send({ code: `  ${code('A').toLowerCase()} `, name: { ar: 'الرياضيات', en: 'Mathematics', tr: '  ' } })
      .expect(201);
    expect(Object.keys(res.body).sort()).toEqual(DTO_KEYS);
    expect(res.body).toMatchObject({
      code: code('A'),
      name: { ar: 'الرياضيات', en: 'Mathematics' },
      isActive: true,
      courseCount: 0,
      sortOrder: (before._max.sortOrder ?? -1) + 1,
    });
    const events = await eventsSince(m);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'subjects.created',
      actorUserId: fx['manager'],
      entityType: 'subjects',
      entityId: res.body.id,
      metadata: { code: code('A'), sortOrder: res.body.sortOrder },
      userAgent: USER_AGENT,
    });

    const m2 = await mark();
    const duplicate = await api().post(SUBJECTS).set(bearer('manager')).send({ code: code('A').toLowerCase(), name: { ar: 'مكرر' } });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({ code: 'subject_code_taken', subjectCode: code('A') });
    const invalid: Record<string, unknown>[] = [
      { code: code('B'), name: { en: 'no arabic' } },
      { code: code('B'), name: 'plain text' },
      { code: code('B') },
      { code: 'HAS SPACE', name: { ar: 'م' } },
      { code: '', name: { ar: 'م' } },
      { code: 'A'.repeat(17), name: { ar: 'م' } },
      { code: code('B'), name: { ar: 'م' }, isActive: 'yes' },
      { code: code('B'), name: { ar: 'م' }, sortOrder: 3 },
      { code: code('B'), name: { ar: 'م' }, description: { ar: 'x' } },
    ];
    for (const body of invalid) {
      const bad = await api().post(SUBJECTS).set(bearer('manager')).send(body);
      expect(bad.status, JSON.stringify(body)).toBe(400);
    }
    expect(await eventsSince(m2)).toEqual([]);
  });

  it('inactive subjects and course counts are visible to managers only', async () => {
    const hidden = await createSubject('H', { isActive: false });
    const asReader = await api().get(SUBJECTS).set(bearer('reader')).expect(200);
    expect(asReader.body.items.map((item: { id: string }) => item.id)).not.toContain(hidden.id);
    for (const item of asReader.body.items) {
      expect(Object.keys(item).sort()).toEqual(DTO_KEYS);
      expect(item.isActive).toBe(true);
      expect(item.courseCount).toBeNull();
    }
    const asManager = await api().get(SUBJECTS).set(bearer('manager')).expect(200);
    const found = asManager.body.items.find((item: { id: string }) => item.id === hidden.id);
    expect(found).toMatchObject({ isActive: false, courseCount: 0 });
    const orders = asManager.body.items.map((item: { sortOrder: number }) => item.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('PATCH writes only what changes with one subjects.updated and refuses empty bodies, nulls, taken codes and unknown ids', async () => {
    const sub = await createSubject('P');
    const m = await mark();
    const res = await api()
      .patch(`${SUBJECTS}/${sub.id}`)
      .set(bearer('manager'))
      .send({ name: { ar: 'مادة P', en: 'Subject P' }, isActive: false, code: code('P') })
      .expect(200);
    expect(res.body).toMatchObject({ name: { ar: 'مادة P', en: 'Subject P' }, isActive: false, code: code('P'), courseCount: 0 });
    const events = await eventsSince(m);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'subjects.updated', entityId: sub.id, metadata: { code: code('P'), fields: ['name', 'isActive'] } });

    const renamed = await api().patch(`${SUBJECTS}/${sub.id}`).set(bearer('manager')).send({ code: `${code('P')}2`.toLowerCase() }).expect(200);
    expect(renamed.body.code).toBe(`${code('P')}2`);

    const m2 = await mark();
    await api().patch(`${SUBJECTS}/${sub.id}`).set(bearer('manager')).send({ isActive: false }).expect(200);
    const empty = await api().patch(`${SUBJECTS}/${sub.id}`).set(bearer('manager')).send({});
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe('nothing_to_update');
    for (const body of [{ name: null }, { code: null }, { isActive: null }, { isActive: 'no' }, { description: null }]) {
      const bad = await api().patch(`${SUBJECTS}/${sub.id}`).set(bearer('manager')).send(body);
      expect(bad.status, JSON.stringify(body)).toBe(400);
    }
    const other = await createSubject('Q');
    const taken = await api().patch(`${SUBJECTS}/${sub.id}`).set(bearer('manager')).send({ code: other.code.toLowerCase() });
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ code: 'subject_code_taken', subjectCode: other.code });
    const missing = await api().patch(`${SUBJECTS}/${NIL_ID}`).set(bearer('manager')).send({ isActive: true });
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: 'subject_not_found', subjectId: NIL_ID });
    await api().patch(`${SUBJECTS}/not-a-uuid`).set(bearer('manager')).send({ isActive: true }).expect(400);
    // Only the fixture subject Q was created in between.
    expect((await eventsSince(m2)).map((event) => event.action)).toEqual(['subjects.created']);
  });

  it('a subject used by a course cannot be deleted (409 subject_in_use with the count); an unused one is deleted with one subjects.deleted', async () => {
    const used = await createSubject('U');
    const course = await prisma.course.create({ data: { code: `S${RUN}-C`, name: { ar: 'دورة' }, subjectId: used.id }, select: { id: true } });
    createdCourseIds.push(course.id);
    const m = await mark();
    const refused = await api().delete(`${SUBJECTS}/${used.id}`).set(bearer('manager'));
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'subject_in_use', courseCount: 1 });
    const list = await api().get(SUBJECTS).set(bearer('manager')).expect(200);
    expect(list.body.items.find((item: { id: string }) => item.id === used.id).courseCount).toBe(1);
    expect(await eventsSince(m)).toEqual([]);
    expect(await prisma.subject.count({ where: { id: used.id } })).toBe(1);

    const free = await createSubject('F');
    const m2 = await mark();
    await api().delete(`${SUBJECTS}/${free.id}`).set(bearer('manager')).expect(204);
    const events = await eventsSince(m2);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'subjects.deleted', entityType: 'subjects', entityId: free.id, metadata: { code: free.code } });
    const again = await api().delete(`${SUBJECTS}/${free.id}`).set(bearer('manager'));
    expect(again.status).toBe(404);
    expect(again.body).toMatchObject({ code: 'subject_not_found', subjectId: free.id });
  });

  it('reorder needs every subject exactly once; a swap writes one subjects.reordered, the same order nothing; the original order is restored', async () => {
    const x = await createSubject('X');
    const y = await createSubject('Y');
    const current = (await prisma.subject.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true } })).map((row) => row.id);
    try {
      const m = await mark();
      const bad = [current.slice(1), [...current, NIL_ID], [current[0], ...current]];
      for (const subjectIds of bad) {
        const res = await api().put(`${SUBJECTS}/order`).set(bearer('manager')).send({ subjectIds });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('subject_order_invalid');
      }
      const detail = await api().put(`${SUBJECTS}/order`).set(bearer('manager')).send({ subjectIds: [current[0], ...current] });
      expect(detail.body).toMatchObject({ missing: [], unknown: [], duplicates: [current[0]] });
      const unknown = await api().put(`${SUBJECTS}/order`).set(bearer('manager')).send({ subjectIds: [...current, NIL_ID] });
      expect(unknown.body).toMatchObject({ missing: [], unknown: [NIL_ID], duplicates: [] });
      await api().put(`${SUBJECTS}/order`).set(bearer('manager')).send({ subjectIds: ['nope'] }).expect(400);
      await api().put(`${SUBJECTS}/order`).set(bearer('manager')).send({ levelIds: current }).expect(400);
      expect(await eventsSince(m)).toEqual([]);

      // Swap the two fixture subjects (adjacent at the end); everything else keeps its place.
      const swapped = current.map((id) => (id === x.id ? y.id : id === y.id ? x.id : id));
      const m2 = await mark();
      const res = await api().put(`${SUBJECTS}/order`).set(bearer('manager')).send({ subjectIds: swapped }).expect(200);
      expect(res.body.items.map((item: { id: string }) => item.id)).toEqual(swapped);
      expect(res.body.items.map((item: { sortOrder: number }) => item.sortOrder)).toEqual(swapped.map((_id, index) => index));
      const events = await eventsSince(m2);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ action: 'subjects.reordered', entityType: 'subjects', entityId: null, metadata: { subjectIds: swapped } });

      const m3 = await mark();
      await api().put(`${SUBJECTS}/order`).set(bearer('manager')).send({ subjectIds: swapped }).expect(200);
      expect(await eventsSince(m3)).toEqual([]);
    } finally {
      // Put the pre-existing subjects back in their original relative order.
      const now = (await prisma.subject.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true } })).map((row) => row.id);
      const restored = [...originalOrder.filter((id) => now.includes(id)), ...now.filter((id) => !originalOrder.includes(id))];
      await api().put(`${SUBJECTS}/order`).set(bearer('manager')).send({ subjectIds: restored }).expect(200);
    }
  });

  it(
    'checks the Origin of writing requests and documents the routes in OpenAPI',
    async () => {
      const hostile = await api().post(SUBJECTS).set({ ...bearer('manager'), Origin: 'https://evil.example' }).send({ code: code('O'), name: { ar: 'م' } });
      expect(hostile.status).toBe(403);
      expect(hostile.body.code).toBe('origin_forbidden');
      expect(await prisma.subject.count({ where: { code: code('O') } })).toBe(0);

      const docs = await api().get('/api/docs-json').expect(200);
      const paths = docs.body.paths as Record<string, Record<string, unknown>>;
      expect(Object.keys(paths['/api/subjects'] ?? {}).sort()).toEqual(['get', 'post']);
      expect(Object.keys(paths['/api/subjects/order'] ?? {})).toEqual(['put']);
      expect(Object.keys(paths['/api/subjects/{id}'] ?? {}).sort()).toEqual(['delete', 'patch']);
      const schemas = docs.body.components.schemas as Record<string, { properties?: Record<string, unknown> }>;
      for (const name of ['SubjectDto', 'SubjectListDto', 'CreateSubjectDto', 'UpdateSubjectDto', 'ReorderSubjectsDto']) expect(schemas).toHaveProperty(name);
      expect(Object.keys(schemas['SubjectDto']!.properties ?? {}).sort()).toEqual(DTO_KEYS);
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
