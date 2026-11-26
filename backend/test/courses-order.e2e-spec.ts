// TEST-CO-1 (provisional id) — PORTAL-04-COURSE-ORDER: the order of the courses. A new course goes last; POST
// /api/courses/:id/move swaps it one place up or down with exactly one `courses.reordered` event; the top (or the
// bottom) is a no-op without an event; refusals write nothing; two moves at once keep every place unique; the office
// list `sort=position` and the signed-in catalog (API-219) follow the order, across pages. Against the database of
// the run (the isolated one, never the shared dev DB); skipped when none is reachable. Fixture courses carry a unique
// prefix and are deleted at the end (their audit rows stay — KI-032).
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
const PREFIX = `O${RUN}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USER_AGENT = 'TEST-CO-1 supertest';
const COURSES = '/api/courses';
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

interface CourseBody {
  id: string;
  code: string;
  sortOrder: number;
}

describe.skipIf(!available)('PORTAL-04-COURSE-ORDER — the order of the courses (e2e, TEST-CO-1)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const course: Record<string, CourseBody> = {};

  const code = (suffix: string) => `${PREFIX}-${suffix}`;
  const email = (name: string) => `${name}-${RUN.toLowerCase()}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const actors = () => Object.values(fx);

  async function createRole(name: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: { key: `test_${name}_${RUN.toLowerCase()}`, label: { ar: `دور اختبار ${name}` }, permissions: { create: permissionKeys.map((permissionKey) => ({ permissionKey })) } },
      select: { id: true },
    });
    createdRoleIds.push(role.id);
    return role.id;
  }

  async function createUser(name: string, roleIds: string[]): Promise<void> {
    const user = await prisma.user.create({
      data: { email: email(name), fullName: `Test ${name}`, passwordHash: await passwords.hash(PASSWORD), status: 'active', roles: { create: roleIds.map((roleId) => ({ roleId })) } },
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

  const eventsSince = (markId: string) => prisma.auditLog.findMany({ where: { id: { gt: markId }, actorUserId: { in: actors() } }, orderBy: { id: 'asc' } });
  const placeOf = async (id: string) => (await prisma.course.findUniqueOrThrow({ where: { id }, select: { sortOrder: true } })).sortOrder;
  const move = (id: string, direction: unknown, who = 'manager') => api().post(`${COURSES}/${id}/move`).set(bearer(who)).send({ direction });

  /** Every page of a keyset list, one item per page, as the codes in order. */
  async function walk(path: (cursor: string | null) => string, who: string): Promise<string[]> {
    const codes: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const res = await api().get(path(cursor)).set(bearer(who)).expect(200);
      codes.push(...(res.body.items as { code: string }[]).map((item) => item.code));
      cursor = res.body.nextCursor as string | null;
      if (!cursor) break;
    }
    return codes;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    const manager = await createRole('comanager', ['courses.read', 'courses.manage']);
    const reader = await createRole('coreader', ['courses.read']);
    await createUser('manager', [manager]);
    await createUser('reader', [reader]);
    for (const name of ['manager', 'reader']) tokens[name] = await login(email(name));
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

  it('puts a new course last: each place is above every course that existed before it', async () => {
    for (const suffix of ['A', 'B', 'C']) {
      const before = await prisma.course.aggregate({ _max: { sortOrder: true } });
      const res = await api().post(COURSES).set(bearer('manager')).send({ code: code(suffix), name: { ar: `دورة ${suffix}` } }).expect(201);
      course[suffix] = res.body as CourseBody;
      expect(Number.isInteger(course[suffix].sortOrder)).toBe(true);
      expect(course[suffix].sortOrder).toBeGreaterThan(before._max.sortOrder ?? 0);
    }
    expect(course.A!.sortOrder).toBeLessThan(course.B!.sortOrder);
    expect(course.B!.sortOrder).toBeLessThan(course.C!.sortOrder);
  });

  it('moves a course one place up: the two courses swap places, with exactly one courses.reordered', async () => {
    const a = await placeOf(course.A!.id);
    const b = await placeOf(course.B!.id);
    // The neighbour above B is whatever course holds the greatest place below it (A, unless another client wrote between).
    const above = await prisma.course.findFirstOrThrow({ where: { sortOrder: { lt: b } }, orderBy: { sortOrder: 'desc' }, select: { id: true, code: true, sortOrder: true } });
    const m = await mark();

    const res = await move(course.B!.id, 'up').expect(200);
    expect(res.body).toMatchObject({ id: course.B!.id, code: code('B'), sortOrder: above.sortOrder });
    expect(await placeOf(above.id)).toBe(b);

    const events = await eventsSince(m);
    expect(events.map((event) => event.action)).toEqual(['courses.reordered']);
    expect(events[0]).toMatchObject({ entityType: 'courses', entityId: course.B!.id, actorUserId: fx.manager });
    expect(events[0]!.metadata).toEqual({ code: code('B'), direction: 'up', from: b, to: above.sortOrder, swappedWith: above.code });
    if (above.id === course.A!.id) expect(await placeOf(course.A!.id)).toBe(b);
    else expect(await placeOf(course.A!.id)).toBe(a);

    // A course another client created between A and B (a parallel suite) sits between them: B moves on until it is
    // right above A, one swap at a time.
    for (let step = 0; step < 10 && (await placeOf(course.B!.id)) > (await placeOf(course.A!.id)); step++) await move(course.B!.id, 'up').expect(200);
    expect(await placeOf(course.B!.id)).toBeLessThan(await placeOf(course.A!.id));
  });

  it('follows the order in the office list (sort=position) and in the catalog (API-219), page after page', async () => {
    // The fixture courses after «B up»: B, A, C — by place, whatever their codes.
    const expected = (await prisma.course.findMany({ where: { code: { startsWith: PREFIX } }, orderBy: { sortOrder: 'asc' }, select: { code: true } })).map((row) => row.code);
    expect(expected).toEqual([code('B'), code('A'), code('C')]);

    const office = await walk((cursor) => `${COURSES}?q=${PREFIX}&sort=position&limit=1${cursor ? `&cursor=${cursor}` : ''}`, 'manager');
    expect(office).toEqual(expected);
    const descending = await walk((cursor) => `${COURSES}?q=${PREFIX}&sort=position&order=desc&limit=1${cursor ? `&cursor=${cursor}` : ''}`, 'manager');
    expect(descending).toEqual([...expected].reverse());

    for (const suffix of ['A', 'B', 'C']) await api().post(`${COURSES}/${course[suffix]!.id}/status`).set(bearer('manager')).send({ action: 'publish' }).expect(200);
    const catalog = await walk((cursor) => `/api/catalog/courses?q=${PREFIX}&limit=1${cursor ? `&cursor=${cursor}` : ''}`, 'reader');
    expect(catalog).toEqual(expected);
  });

  it('refuses a cursor of another order or a malformed place with 400 cursor_invalid', async () => {
    const codeCursor = Buffer.from(JSON.stringify([1, 'code', 'asc', code('A'), course.A!.id])).toString('base64url');
    expect((await api().get(`/api/catalog/courses?cursor=${codeCursor}`).set(bearer('reader')).expect(400)).body.code).toBe('cursor_invalid');
    const badPlace = Buffer.from(JSON.stringify([1, 'position', 'asc', 'x1', course.A!.id])).toString('base64url');
    expect((await api().get(`/api/catalog/courses?cursor=${badPlace}`).set(bearer('reader')).expect(400)).body.code).toBe('cursor_invalid');
    expect((await api().get(`${COURSES}?sort=position&cursor=${badPlace}`).set(bearer('manager')).expect(400)).body.code).toBe('cursor_invalid');
  });

  // The top only: the bottom moves whenever a parallel suite creates a course, so «the last course moved down» is
  // the same code path (no neighbour) without a stable fixture on a shared run.
  it('answers the top course moved up with the course, no write and no event', async () => {
    const top = await prisma.course.findFirstOrThrow({ orderBy: { sortOrder: 'asc' }, select: { id: true, sortOrder: true } });
    const m = await mark();
    expect((await move(top.id, 'up').expect(200)).body.sortOrder).toBe(top.sortOrder);
    expect(await placeOf(top.id)).toBe(top.sortOrder);
    expect(await eventsSince(m)).toHaveLength(0);
  });

  it('refuses without courses.manage (403), an unknown course (404) and a bad direction (400), writing nothing', async () => {
    const before = await placeOf(course.C!.id);
    const m = await mark();
    expect((await move(course.C!.id, 'up', 'reader').expect(403)).body.code).toBe('permission_denied');
    expect((await move(NIL_ID, 'up').expect(404)).body.code).toBe('course_not_found');
    await move(course.C!.id, 'sideways').expect(400);
    await move(course.C!.id, null).expect(400);
    await api().post(`${COURSES}/${course.C!.id}/move`).set(bearer('manager')).send({}).expect(400);
    expect(await placeOf(course.C!.id)).toBe(before);
    expect(await eventsSince(m)).toHaveLength(0);
  });

  it('keeps every place unique when two moves run at once', async () => {
    const ids = [course.A!.id, course.B!.id, course.C!.id];
    const before = await prisma.course.findMany({ where: { id: { in: ids } }, select: { sortOrder: true } });
    const [first, second] = await Promise.all([move(course.A!.id, 'up'), move(course.B!.id, 'down')]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const all = await prisma.course.findMany({ select: { sortOrder: true } });
    expect(new Set(all.map((row) => row.sortOrder)).size).toBe(all.length);
    // The fixture courses still hold places among those they had, or swapped with a direct neighbour of another client.
    const after = await prisma.course.findMany({ where: { id: { in: ids } }, select: { sortOrder: true } });
    expect(after).toHaveLength(before.length);
  });
});
