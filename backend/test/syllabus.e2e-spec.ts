// TEST-045 — MOD-04-T04 course syllabus (GET/PUT /api/courses/:id/syllabus)
// against the live development database. Skipped when no database is
// reachable. Fixture users, roles and courses carry a unique prefix and are
// deleted at the end (their audit rows stay — KI-032); audit events are
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
const PREFIX = `S${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-045 supertest';
const NIL_ID = '00000000-0000-0000-0000-000000000000';
const ITEM_KEYS = ['createdAt', 'description', 'estimatedMinutes', 'id', 'sortOrder', 'title', 'updatedAt'];

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

describe.skipIf(!available)('MOD-04 course syllabus (e2e, TEST-045)', () => {
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
  const actors = () => Object.values(fx);
  const path = (courseId: string) => `/api/courses/${courseId}/syllabus`;

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

  async function createCourse(suffix: string, publish = false): Promise<string> {
    const res = await api().post('/api/courses').set(bearer('manager')).send({ code: `${PREFIX}-${suffix}`, name: { ar: `دورة ${suffix}` } }).expect(201);
    if (publish) await api().post(`/api/courses/${res.body.id}/status`).set(bearer('manager')).send({ action: 'publish' }).expect(200);
    return res.body.id as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    const manager = await createRole('symanager', ['courses.read', 'courses.manage']);
    const reader = await createRole('syreader', ['courses.read']);
    const outsider = await createRole('syoutsider', ['audit.read']);
    await createUser('manager', [manager]);
    await createUser('reader', [reader]);
    await createUser('outsider', [outsider]);
    for (const name of ['manager', 'reader', 'outsider']) tokens[name] = await login(email(name));
  });

  afterAll(async () => {
    try {
      await prisma.course.deleteMany({ where: { code: { startsWith: PREFIX } } });
    } finally {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('AC1 — the syllabus follows the course visibility: published for courses.read, every state for courses.manage; writing needs courses.manage', async () => {
    const draft = await createCourse('V1');
    const published = await createCourse('V2', true);
    await api().get(path(published)).set(bearer('reader')).expect(200);
    const hidden = await api().get(path(draft)).set(bearer('reader'));
    expect(hidden.status).toBe(404);
    expect(hidden.body).toMatchObject({ code: 'course_not_found', courseId: draft });
    await api().get(path(draft)).set(bearer('manager')).expect(200);
    await api().get(path(published)).set(bearer('outsider')).expect(403);
    await api().get(path(published)).expect(401);
    const m = await mark();
    const denied = await api().put(path(published)).set(bearer('reader')).send({ items: [] });
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['courses.manage'] });
    await api().get(path(NIL_ID)).set(bearer('manager')).expect(404);
    await api().put(path(NIL_ID)).set(bearer('manager')).send({ items: [] }).expect(404);
    expect(await eventsSince(m)).toEqual([]);
  });

  it('creates, keeps, edits, moves and deletes items as a full replacement, with one courses.syllabus.changed per effective write', async () => {
    const courseId = await createCourse('R');
    const m = await mark();
    const first = await api()
      .put(path(courseId))
      .set(bearer('manager'))
      .send({
        items: [
          { title: { ar: 'مقدمة', en: 'Intro' }, estimatedMinutes: 45 },
          { title: { ar: 'متغيرات' }, description: { ar: 'أنواع البيانات' } },
          { title: { ar: 'شروط' }, estimatedMinutes: null },
        ],
      })
      .expect(200);
    expect(first.body.courseId).toBe(courseId);
    expect(first.body.items).toHaveLength(3);
    expect(Object.keys(first.body.items[0]).sort()).toEqual(ITEM_KEYS);
    expect(first.body.items.map((item: { sortOrder: number }) => item.sortOrder)).toEqual([0, 1, 2]);
    expect(first.body.items[0]).toMatchObject({ title: { ar: 'مقدمة', en: 'Intro' }, estimatedMinutes: 45, description: null });
    const [intro, vars, cond] = first.body.items as { id: string; title: { ar: string } }[];

    const course = await api().get(`/api/courses/${courseId}`).set(bearer('manager')).expect(200);
    expect(course.body.syllabusCount).toBe(3);

    // The stored syllabus again: nothing written (same rows, same updatedAt), nothing recorded.
    const same = await api()
      .put(path(courseId))
      .set(bearer('manager'))
      .send({
        items: [
          { id: intro!.id, title: { ar: 'مقدمة', en: 'Intro' }, estimatedMinutes: 45 },
          { id: vars!.id, title: { ar: 'متغيرات' }, description: { ar: 'أنواع البيانات' } },
          { id: cond!.id, title: { ar: 'شروط' } },
        ],
      })
      .expect(200);
    expect(same.body).toEqual(first.body);

    // Move cond first, edit vars (description cleared), drop intro, add one at the end.
    const second = await api()
      .put(path(courseId))
      .set(bearer('manager'))
      .send({
        items: [
          { id: cond!.id, title: { ar: 'شروط' } },
          { id: vars!.id, title: { ar: 'متغيرات' }, description: null, estimatedMinutes: 30 },
          { title: { ar: 'حلقات' } },
        ],
      })
      .expect(200);
    expect(second.body.items.map((item: { title: { ar: string } }) => item.title.ar)).toEqual(['شروط', 'متغيرات', 'حلقات']);
    expect(second.body.items.map((item: { id: string }) => item.id).slice(0, 2)).toEqual([cond!.id, vars!.id]);
    expect(second.body.items[1]).toMatchObject({ description: null, estimatedMinutes: 30 });
    const stored = await prisma.$queryRaw<{ isnull: boolean }[]>`SELECT description IS NULL AS isnull FROM course_syllabus_items WHERE id = ${vars!.id}::uuid`;
    expect(stored[0]!.isnull).toBe(true);

    const cleared = await api().put(path(courseId)).set(bearer('manager')).send({ items: [] }).expect(200);
    expect(cleared.body.items).toEqual([]);

    const events = await eventsSince(m);
    expect(events.map((event) => event.action)).toEqual(['courses.syllabus.changed', 'courses.syllabus.changed', 'courses.syllabus.changed']);
    expect(events.every((event) => event.entityType === 'courses' && event.entityId === courseId)).toBe(true);
    expect(events.map((event) => event.metadata)).toEqual([
      { code: `${PREFIX}-R`, added: 3, updated: 0, removed: 0, reordered: false, items: 3 },
      { code: `${PREFIX}-R`, added: 1, updated: 1, removed: 1, reordered: true, items: 3 },
      { code: `${PREFIX}-R`, added: 0, updated: 0, removed: 3, reordered: false, items: 0 },
    ]);
  });

  it('refuses items of another course, repeated ids and invalid items without writing', async () => {
    const own = await createCourse('O');
    const other = await createCourse('X');
    const otherItems = await api().put(path(other)).set(bearer('manager')).send({ items: [{ title: { ar: 'غريب' } }] }).expect(200);
    const foreignId = otherItems.body.items[0].id as string;
    const mine = await api().put(path(own)).set(bearer('manager')).send({ items: [{ title: { ar: 'لي' } }] }).expect(200);
    const myId = mine.body.items[0].id as string;

    const m = await mark();
    const foreign = await api().put(path(own)).set(bearer('manager')).send({ items: [{ id: myId, title: { ar: 'لي' } }, { id: foreignId, title: { ar: 'غريب' } }] });
    expect(foreign.status).toBe(400);
    expect(foreign.body).toMatchObject({ code: 'syllabus_invalid', unknown: [foreignId], duplicates: [] });
    const repeated = await api().put(path(own)).set(bearer('manager')).send({ items: [{ id: myId, title: { ar: 'لي' } }, { id: myId, title: { ar: 'مرة أخرى' } }] });
    expect(repeated.body).toMatchObject({ code: 'syllabus_invalid', unknown: [], duplicates: [myId] });
    const invalid: Record<string, unknown>[] = [
      { items: [{ title: { en: 'no arabic' } }] },
      { items: [{ title: { ar: 'م' }, estimatedMinutes: 0 }] },
      { items: [{ title: { ar: 'م' }, estimatedMinutes: '30' }] },
      { items: [{ title: { ar: 'م' }, estimatedMinutes: 1441 }] },
      { items: [{ title: { ar: 'م' }, sortOrder: 4 }] },
      { items: [{ id: 'nope', title: { ar: 'م' } }] },
      { items: Array.from({ length: 201 }, (_value, index) => ({ title: { ar: `بند ${index}` } })) },
      { items: 'all' },
      {},
    ];
    for (const body of invalid) {
      const bad = await api().put(path(own)).set(bearer('manager')).send(body);
      expect(bad.status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect(await eventsSince(m)).toEqual([]);
    const after = await api().get(path(own)).set(bearer('manager')).expect(200);
    expect(after.body.items.map((item: { id: string }) => item.id)).toEqual([myId]);
  });

  it(
    'documents both routes in OpenAPI and refuses a hostile Origin',
    async () => {
      const courseId = await createCourse('H');
      const hostile = await api().put(path(courseId)).set({ ...bearer('manager'), Origin: 'https://evil.example' }).send({ items: [{ title: { ar: 'م' } }] });
      expect(hostile.status).toBe(403);
      expect(hostile.body.code).toBe('origin_forbidden');
      expect(await prisma.courseSyllabusItem.count({ where: { courseId } })).toBe(0);

      const docs = await api().get('/api/docs-json').expect(200);
      const paths = docs.body.paths as Record<string, Record<string, unknown>>;
      expect(Object.keys(paths['/api/courses/{id}/syllabus'] ?? {}).sort()).toEqual(['get', 'put']);
      const schemas = docs.body.components.schemas as Record<string, unknown>;
      for (const name of ['SyllabusDto', 'SyllabusItemDto', 'ReplaceSyllabusDto', 'SyllabusItemInputDto']) expect(schemas).toHaveProperty(name);
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
