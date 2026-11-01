// TEST-041 — MOD-04-T03 courses (GET /api/courses, GET/PATCH/DELETE
// /api/courses/:id, POST /api/courses, POST /api/courses/:id/status) against
// the live development database. Skipped when no database is reachable.
// Fixture users, roles, levels and courses carry a unique prefix and are
// deleted at the end (their audit rows stay — KI-032). Every list query is
// narrowed with `q` = the fixture prefix so courses of other clients never
// change the expectations; audit events are counted by fixture actor above an
// id watermark, as in TEST-030.
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
const PREFIX = `C${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-041 supertest';
const COURSES = '/api/courses';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const DTO_KEYS = [
  'code',
  'createdAt',
  'description',
  'durationHours',
  'id',
  'level',
  'maxAge',
  'minAge',
  'name',
  'sessionsCount',
  'status',
  'summary',
  'syllabusCount',
  'updatedAt',
];

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

describe.skipIf(!available)('MOD-04 courses (e2e, TEST-041)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let levelId: string;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
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

  async function createCourse(suffix: string, extra: Record<string, unknown> = {}): Promise<{ id: string; code: string; status: string }> {
    const res = await api().post(COURSES).set(bearer('manager')).send({ code: code(suffix), name: { ar: `دورة ${suffix}` }, ...extra }).expect(201);
    return res.body as { id: string; code: string; status: string };
  }

  const setStatus = (id: string, action: string) => api().post(`${COURSES}/${id}/status`).set(bearer('manager')).send({ action });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    const max = await prisma.level.aggregate({ _max: { sortOrder: true } });
    levelId = (
      await prisma.level.create({ data: { code: `L${RUN}`.slice(0, 16), name: { ar: 'مستوى اختبار' }, sortOrder: (max._max.sortOrder ?? -1) + 1 }, select: { id: true } })
    ).id;

    const manager = await createRole('csmanager', ['courses.read', 'courses.manage']);
    const reader = await createRole('csreader', ['courses.read']);
    const outsider = await createRole('csoutsider', ['audit.read']);
    await createUser('manager', [manager]);
    await createUser('reader', [reader]);
    await createUser('outsider', [outsider]);
    for (const name of ['manager', 'reader', 'outsider']) tokens[name] = await login(email(name));
  });

  afterAll(async () => {
    try {
      await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
      await prisma.level.deleteMany({ where: { id: levelId } });
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('creates a draft with a normalised code, the level, decimal hours, the creator and exactly one courses.created; refuses invalid bodies without an event', async () => {
    const m = await mark();
    const res = await api()
      .post(COURSES)
      .set(bearer('manager'))
      .send({
        code: ` ${code('A').toLowerCase()} `,
        name: { ar: 'أساسيات بايثون', en: 'Python Basics' },
        summary: { ar: 'ملخص' },
        levelId,
        durationHours: 24.5,
        sessionsCount: 12,
        minAge: 10,
        maxAge: 14,
      })
      .expect(201);
    expect(Object.keys(res.body).sort()).toEqual(DTO_KEYS);
    expect(res.body).toMatchObject({
      code: code('A'),
      status: 'draft',
      durationHours: 24.5,
      sessionsCount: 12,
      minAge: 10,
      maxAge: 14,
      summary: { ar: 'ملخص' },
      description: null,
      syllabusCount: 0,
      level: { id: levelId, isActive: true },
    });
    const stored = await prisma.course.findUniqueOrThrow({ where: { id: res.body.id }, select: { createdById: true } });
    expect(stored.createdById).toBe(fx['manager']);
    const events = await eventsSince(m);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'courses.created', entityType: 'courses', entityId: res.body.id, metadata: { code: code('A'), status: 'draft' } });

    const m2 = await mark();
    const duplicate = await api().post(COURSES).set(bearer('manager')).send({ code: code('A').toLowerCase(), name: { ar: 'مكرر' } });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({ code: 'course_code_taken', courseCode: code('A') });
    const unknownLevel = await api().post(COURSES).set(bearer('manager')).send({ code: code('U'), name: { ar: 'م' }, levelId: NIL_ID });
    expect(unknownLevel.status).toBe(404);
    expect(unknownLevel.body).toMatchObject({ code: 'level_not_found', levelId: NIL_ID });
    const ages = await api().post(COURSES).set(bearer('manager')).send({ code: code('G'), name: { ar: 'م' }, minAge: 12, maxAge: 9 });
    expect(ages.status).toBe(400);
    expect(ages.body).toMatchObject({ code: 'age_range_invalid', minAge: 12, maxAge: 9 });
    const invalid: Record<string, unknown>[] = [
      { code: code('B'), name: { en: 'no arabic' } },
      { code: 'HAS SPACE', name: { ar: 'م' } },
      { code: code('B'), name: { ar: 'م' }, durationHours: 1.25 },
      { code: code('B'), name: { ar: 'م' }, durationHours: 0 },
      { code: code('B'), name: { ar: 'م' }, sessionsCount: '12' },
      { code: code('B'), name: { ar: 'م' }, minAge: -1 },
      { code: code('B'), name: { ar: 'م' }, status: 'published' },
      { code: code('B'), name: { ar: 'م' }, levelId: 'nope' },
    ];
    for (const body of invalid) {
      const bad = await api().post(COURSES).set(bearer('manager')).send(body);
      expect(bad.status, JSON.stringify(body)).toBe(400);
    }
    expect(await eventsSince(m2)).toEqual([]);
  });

  it('AC1/AC2 — courses.read alone sees published courses only (list and detail), may not filter other states; the manager sees and filters every state', async () => {
    const draft = await createCourse('V1');
    const published = await createCourse('V2');
    await setStatus(published.id, 'publish').expect(200);
    const archived = await createCourse('V3');
    await setStatus(archived.id, 'archive').expect(200);

    const asReader = await api().get(COURSES).query({ q: `${PREFIX}-V`, limit: 50 }).set(bearer('reader')).expect(200);
    expect(asReader.body.items.map((item: { code: string }) => item.code)).toEqual([code('V2')]);
    await api().get(`${COURSES}/${draft.id}`).set(bearer('reader')).expect(404);
    await api().get(`${COURSES}/${archived.id}`).set(bearer('reader')).expect(404);
    await api().get(`${COURSES}/${published.id}`).set(bearer('reader')).expect(200);
    const filtered = await api().get(COURSES).query({ status: 'draft' }).set(bearer('reader'));
    expect(filtered.status).toBe(403);
    expect(filtered.body).toMatchObject({ code: 'permission_denied', missing: ['courses.manage'] });
    await api().get(COURSES).query({ status: 'published', q: `${PREFIX}-V` }).set(bearer('reader')).expect(200);
    await api().get(COURSES).set(bearer('outsider')).expect(403);
    await api().get(COURSES).expect(401);

    const asManager = await api().get(COURSES).query({ q: `${PREFIX}-V`, limit: 50 }).set(bearer('manager')).expect(200);
    expect(asManager.body.items.map((item: { code: string }) => item.code)).toEqual([code('V1'), code('V2'), code('V3')]);
    const archivedOnly = await api().get(COURSES).query({ q: `${PREFIX}-V`, status: 'archived' }).set(bearer('manager')).expect(200);
    expect(archivedOnly.body.items.map((item: { code: string }) => item.code)).toEqual([code('V3')]);
    const byLevel = await api().get(COURSES).query({ levelId, q: PREFIX }).set(bearer('manager')).expect(200);
    expect(byLevel.body.items.map((item: { code: string }) => item.code)).toEqual([code('A')]);
    await api().get(`${COURSES}/${draft.id}`).set(bearer('manager')).expect(200);
  });

  it('AC4 — the status machine: allowed transitions write one courses.status.changed each; the others are 409 invalid_transition with the allowed actions', async () => {
    const course = await createCourse('S');
    const m = await mark();
    const published = await setStatus(course.id, 'publish').expect(200);
    expect(published.body.status).toBe('published');
    const again = await setStatus(course.id, 'publish');
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'invalid_transition', from: 'published', action: 'publish', allowed: ['unpublish', 'archive'] });
    await setStatus(course.id, 'unpublish').expect(200);
    await setStatus(course.id, 'archive').expect(200);
    const restoreFirst = await setStatus(course.id, 'publish');
    expect(restoreFirst.body).toMatchObject({ code: 'invalid_transition', from: 'archived', allowed: ['restore'] });
    const restored = await setStatus(course.id, 'restore').expect(200);
    expect(restored.body.status).toBe('draft');
    await setStatus(course.id, 'delete').expect(400);
    await api().post(`${COURSES}/${NIL_ID}/status`).set(bearer('manager')).send({ action: 'publish' }).expect(404);

    const events = await eventsSince(m);
    expect(events.map((event) => event.metadata)).toEqual([
      { code: code('S'), action: 'publish', from: 'draft', to: 'published' },
      { code: code('S'), action: 'unpublish', from: 'published', to: 'draft' },
      { code: code('S'), action: 'archive', from: 'draft', to: 'archived' },
      { code: code('S'), action: 'restore', from: 'archived', to: 'draft' },
    ]);
    expect(events.every((event) => event.action === 'courses.status.changed' && event.entityId === course.id)).toBe(true);
  });

  it('AC5 — only a draft is deleted (its syllabus with it); published and archived courses answer 409 course_not_deletable', async () => {
    const published = await createCourse('D1');
    await setStatus(published.id, 'publish').expect(200);
    const m = await mark();
    const refused = await api().delete(`${COURSES}/${published.id}`).set(bearer('manager'));
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'course_not_deletable', status: 'published' });
    await setStatus(published.id, 'archive').expect(200);
    const archived = await api().delete(`${COURSES}/${published.id}`).set(bearer('manager'));
    expect(archived.body).toMatchObject({ code: 'course_not_deletable', status: 'archived' });

    const draft = await createCourse('D2');
    await prisma.courseSyllabusItem.create({ data: { courseId: draft.id, sortOrder: 0, title: { ar: 'بند' } } });
    const m2 = await mark();
    await api().delete(`${COURSES}/${draft.id}`).set(bearer('manager')).expect(204);
    expect(await prisma.courseSyllabusItem.count({ where: { courseId: draft.id } })).toBe(0);
    const events = await eventsSince(m2);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'courses.deleted', entityId: draft.id, metadata: { code: code('D2') } });
    await api().delete(`${COURSES}/${draft.id}`).set(bearer('manager')).expect(404);
    expect((await eventsSince(m)).map((event) => event.action)).toEqual(['courses.status.changed', 'courses.created', 'courses.deleted']);
  });

  it('PATCH writes only what changes (one courses.updated), clears with null, merges the age range and refuses empty bodies, taken codes and unknown references', async () => {
    const course = await createCourse('P', { minAge: 8, maxAge: 12, summary: { ar: 'ملخص' }, durationHours: 10 });
    const m = await mark();
    const res = await api()
      .patch(`${COURSES}/${course.id}`)
      .set(bearer('manager'))
      .send({ summary: null, maxAge: 16, durationHours: 10, levelId, name: { ar: 'دورة P' } })
      .expect(200);
    expect(res.body).toMatchObject({ summary: null, maxAge: 16, durationHours: 10, level: { id: levelId } });
    const events = await eventsSince(m);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'courses.updated', metadata: { code: code('P'), fields: ['summary', 'levelId', 'maxAge'] } });
    const stored = await prisma.$queryRaw<{ isnull: boolean }[]>`SELECT summary IS NULL AS isnull FROM courses WHERE id = ${course.id}::uuid`;
    expect(stored[0]!.isnull).toBe(true);

    const m2 = await mark();
    await api().patch(`${COURSES}/${course.id}`).set(bearer('manager')).send({ maxAge: 16, summary: null }).expect(200);
    const empty = await api().patch(`${COURSES}/${course.id}`).set(bearer('manager')).send({});
    expect(empty.body.code).toBe('nothing_to_update');
    const ages = await api().patch(`${COURSES}/${course.id}`).set(bearer('manager')).send({ minAge: 17 });
    expect(ages.body).toMatchObject({ code: 'age_range_invalid', minAge: 17, maxAge: 16 });
    const taken = await api().patch(`${COURSES}/${course.id}`).set(bearer('manager')).send({ code: code('A') });
    expect(taken.status).toBe(409);
    const noLevel = await api().patch(`${COURSES}/${course.id}`).set(bearer('manager')).send({ levelId: NIL_ID });
    expect(noLevel.status).toBe(404);
    await api().patch(`${COURSES}/${course.id}`).set(bearer('manager')).send({ name: null }).expect(400);
    await api().patch(`${COURSES}/${course.id}`).set(bearer('manager')).send({ status: 'published' }).expect(400);
    await api().patch(`${COURSES}/${NIL_ID}`).set(bearer('manager')).send({ maxAge: 3 }).expect(404);
    const asReader = await api().patch(`${COURSES}/${course.id}`).set(bearer('reader')).send({ maxAge: 3 });
    expect(asReader.body).toMatchObject({ code: 'permission_denied', missing: ['courses.manage'] });
    expect(await eventsSince(m2)).toEqual([]);
  });

  it('AC7 — keyset pages are stable in both sorts, a foreign cursor is 400 cursor_invalid, and % / _ in q are literal', async () => {
    for (const suffix of ['K1', 'K2', 'K3', 'K4', 'K5']) await createCourse(suffix);
    const walk = async (query: Record<string, unknown>): Promise<string[]> => {
      const codes: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const res = await api().get(COURSES).query({ ...query, limit: 2, ...(cursor ? { cursor } : {}) }).set(bearer('manager')).expect(200);
        codes.push(...res.body.items.map((item: { code: string }) => item.code));
        if (!res.body.nextCursor) break;
        cursor = res.body.nextCursor;
      }
      return codes;
    };
    const expected = ['K1', 'K2', 'K3', 'K4', 'K5'].map(code);
    expect(await walk({ q: `${PREFIX}-K` })).toEqual(expected);
    expect(await walk({ q: `${PREFIX}-K`, order: 'desc' })).toEqual([...expected].reverse());
    expect(await walk({ q: `${PREFIX}-K`, sort: 'createdAt' })).toEqual([...expected].reverse());

    const first = await api().get(COURSES).query({ q: `${PREFIX}-K`, limit: 2 }).set(bearer('manager')).expect(200);
    const foreign = await api().get(COURSES).query({ q: `${PREFIX}-K`, limit: 2, order: 'desc', cursor: first.body.nextCursor }).set(bearer('manager'));
    expect(foreign.status).toBe(400);
    expect(foreign.body.code).toBe('cursor_invalid');

    const literal = await api().get(COURSES).query({ q: `${PREFIX}-K%` }).set(bearer('manager')).expect(200);
    expect(literal.body.items).toEqual([]);
    const underscore = await api().get(COURSES).query({ q: `${PREFIX}_K` }).set(bearer('manager')).expect(200);
    expect(underscore.body.items).toEqual([]);
    const byName = await api().get(COURSES).query({ q: 'أساسيات بايثون' }).set(bearer('manager')).expect(200);
    expect(byName.body.items.map((item: { code: string }) => item.code)).toContain(code('A'));
  });

  it(
    'checks the Origin of writing requests and documents the routes in OpenAPI',
    async () => {
      const hostile = await api().post(COURSES).set({ ...bearer('manager'), Origin: 'https://evil.example' }).send({ code: code('O'), name: { ar: 'م' } });
      expect(hostile.status).toBe(403);
      expect(hostile.body.code).toBe('origin_forbidden');
      expect(await prisma.course.count({ where: { code: code('O') } })).toBe(0);

      const docs = await api().get('/api/docs-json').expect(200);
      const paths = docs.body.paths as Record<string, Record<string, unknown>>;
      expect(Object.keys(paths['/api/courses'] ?? {}).sort()).toEqual(['get', 'post']);
      expect(Object.keys(paths['/api/courses/{id}'] ?? {}).sort()).toEqual(['delete', 'get', 'patch']);
      expect(Object.keys(paths['/api/courses/{id}/status'] ?? {})).toEqual(['post']);
      const schemas = docs.body.components.schemas as Record<string, unknown>;
      for (const name of ['CourseDto', 'CourseListDto', 'CreateCourseDto', 'UpdateCourseDto', 'ChangeCourseStatusDto']) expect(schemas).toHaveProperty(name);
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
