// TEST-011 — MOD-03-T01: GET /api/users and GET /api/users/:id against the live
// development database. Skipped when no database is reachable. Fixtures carry a
// unique suffix and are deleted at the end (cascade removes their roles,
// profiles, guardian links and tokens; their audit rows stay — KI-032).
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
import type { Prisma } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const USERS = '/api/users';
/** No key of a users response may look like a credential (AC 2 of MOD-03-T01). */
const SENSITIVE_KEY = /hash|password/i;

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

/** Every object key anywhere inside a JSON value. */
function collectKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      out.add(key);
      collectKeys(nested, out);
    }
  }
  return out;
}

interface ListItem {
  id: string;
  fullName: string;
  roles: string[];
  deletedAt: string | null;
  status: string;
}

describe.skipIf(!available)('MOD-03-T01 users list and detail (e2e, TEST-011)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  /** Fixture name → user id. */
  const fx: Record<string, string> = {};
  let readerToken = '';
  let managerToken = '';
  let plainToken = '';

  const email = (name: string) => `${name}-${RUN}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createUser(
    name: string,
    data: Partial<Prisma.UserCreateInput> & { roleIds?: string[]; withPassword?: boolean } = {},
  ): Promise<string> {
    const { roleIds, withPassword = true, ...rest } = data;
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Test ${name}`,
        passwordHash: withPassword ? await passwords.hash(PASSWORD) : null,
        status: 'active',
        roles: roleIds ? { create: roleIds.map((roleId) => ({ roleId })) } : undefined,
        ...rest,
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    return user.id;
  }

  async function login(identifier: string): Promise<string> {
    const res = await api().post('/api/auth/login').send({ identifier, password: PASSWORD }).expect(200);
    return res.body.accessToken as string;
  }

  /** Follows `nextCursor` until exhausted; returns the pages' items in order. */
  async function walkPages(token: string, params: Record<string, string>): Promise<ListItem[][]> {
    const pages: ListItem[][] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard += 1) {
      const query = new URLSearchParams({ ...params, ...(cursor ? { cursor } : {}) }).toString();
      const res = await api().get(`${USERS}?${query}`).set(bearer(token)).expect(200);
      pages.push(res.body.items as ListItem[]);
      cursor = res.body.nextCursor as string | null;
      if (!cursor) return pages;
    }
    throw new Error('pagination did not terminate');
  }

  /** Ids of the live (non-deleted) fixtures, in creation order. */
  const liveFixtureIds = () =>
    ['reader', 'manager', 'plain', 'alpha', 'bravo', 'charlie', 'delta', 'foxtrot', 'golf'].map((name) => fx[name]!);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    const systemRoles = await prisma.role.findMany({
      where: { key: { in: ['student', 'teacher', 'guardian'] } },
      select: { id: true, key: true },
    });
    const systemRole = (key: string) => systemRoles.find((role) => role.key === key)!.id;
    const reader = await prisma.role.create({
      data: {
        key: `test_users_reader_${RUN}`,
        label: { ar: 'قارئ مستخدمين (اختبار)' },
        permissions: { create: [{ permissionKey: 'users.read' }] },
      },
      select: { id: true },
    });
    const manager = await prisma.role.create({
      data: {
        key: `test_users_manager_${RUN}`,
        label: { ar: 'مدير مستخدمين (اختبار)' },
        permissions: { create: [{ permissionKey: 'users.read' }, { permissionKey: 'users.deactivate' }] },
      },
      select: { id: true },
    });
    createdRoleIds.push(reader.id, manager.id);

    // Callers.
    await createUser('reader', { roleIds: [reader.id] });
    await createUser('manager', { roleIds: [manager.id] });
    await createUser('plain');
    // Subjects (creation order matters for the pagination test).
    await createUser('alpha', {
      fullName: 'Fixture Alpha',
      fullNameLatin: 'Alpha Fixture',
      roleIds: [systemRole('student')],
      studentProfile: {
        create: { studentNumber: `S-${RUN}`, dateOfBirth: new Date('2012-05-01'), enrolledOn: new Date('2026-09-01') },
      },
    });
    await createUser('bravo', {
      fullName: 'Fixture Bravo',
      roleIds: [systemRole('teacher')],
      employeeProfile: { create: { kind: 'teacher', jobTitle: 'Mathematics', hiredOn: new Date('2025-02-10') } },
    });
    await createUser('charlie', {
      fullName: 'Fixture Charlie',
      roleIds: [systemRole('guardian')],
      guardianOf: { create: [{ studentUserId: fx['alpha']!, relationship: 'mother', isPrimary: true }] },
    });
    await createUser('delta', { fullName: 'Fixture Delta سارة', status: 'suspended' });
    await createUser('echo', { fullName: 'Fixture Echo', status: 'archived', deletedAt: new Date() });
    await createUser('foxtrot', {
      fullName: 'Fixture Foxtrot',
      email: null,
      username: `fixture_f_${RUN}`,
      status: 'invited',
      withPassword: false,
    });
    await createUser('golf', { fullName: 'Fixture Golf', displayName: 'Golfer', username: `fixture-golf-${RUN}` });

    readerToken = await login(email('reader'));
    managerToken = await login(email('manager'));
    plainToken = await login(email('plain'));
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('requires a token and the users.read permission (AC 1)', async () => {
    expect((await api().get(USERS).expect(401)).body.code).toBe('unauthenticated');
    expect((await api().get(`${USERS}/${fx['alpha']}`).expect(401)).body.code).toBe('unauthenticated');

    const list = await api().get(USERS).set(bearer(plainToken)).expect(403);
    expect(list.body).toMatchObject({ code: 'permission_denied', missing: ['users.read'] });
    const detail = await api().get(`${USERS}/${fx['alpha']}`).set(bearer(plainToken)).expect(403);
    expect(detail.body).toMatchObject({ code: 'permission_denied', missing: ['users.read'] });
  });

  it('lists users with their role keys and without any credential-like field (AC 2)', async () => {
    const res = await api().get(`${USERS}?q=${RUN}&limit=100`).set(bearer(readerToken)).expect(200);
    const items = res.body.items as ListItem[];
    expect(res.body.nextCursor).toBeNull();
    expect(new Set(items.map((item) => item.id))).toEqual(new Set(liveFixtureIds()));

    const alpha = items.find((item) => item.id === fx['alpha'])!;
    expect(alpha).toMatchObject({ fullName: 'Fixture Alpha', status: 'active', roles: ['student'], deletedAt: null });
    expect(Object.keys(alpha).sort()).toEqual(
      [
        'avatarUrl', 'createdAt', 'deletedAt', 'displayName', 'email', 'emailVerifiedAt', 'fullName', 'fullNameLatin',
        'id', 'lastLoginAt', 'locale', 'lockedUntil', 'phone', 'roles', 'status', 'updatedAt', 'username',
      ].sort(),
    );
    const sensitive = [...collectKeys(res.body)].filter((key) => SENSITIVE_KEY.test(key));
    expect(sensitive).toEqual([]);
    expect(JSON.stringify(res.body)).not.toMatch(/\$argon2|Correct-Horse/);
  });

  it('searches e-mail, username and names case-insensitively with literal wildcards (AC 3)', async () => {
    const ids = async (q: string) =>
      ((await api().get(`${USERS}?limit=100&q=${encodeURIComponent(q)}`).set(bearer(readerToken)).expect(200)).body.items as ListItem[])
        .map((item) => item.id);

    expect(new Set(await ids(RUN.toUpperCase()))).toEqual(new Set(liveFixtureIds()));
    expect(await ids(`FIXTURE-GOLF-${RUN}`)).toEqual([fx['golf']]);
    expect(await ids('سارة')).toEqual([fx['delta']]);
    expect(await ids(`alpha-${RUN}@`)).toEqual([fx['alpha']]);
    expect(await ids('Alpha Fixture')).toEqual([fx['alpha']]); // Latin name
    expect(await ids('golfer')).toEqual([fx['golf']]); // display name
    // `%` and `_` are matched literally, not as LIKE wildcards.
    expect(await ids(`_f_${RUN}`)).toEqual([fx['foxtrot']]);
    expect(await ids('%')).toEqual([]);
    expect(await ids(`%-${RUN}`)).toEqual([]);
  });

  it('applies status and role filters together with the search (AC 3)', async () => {
    const ids = async (params: string) =>
      ((await api().get(`${USERS}?limit=100&q=${RUN}&${params}`).set(bearer(readerToken)).expect(200)).body.items as ListItem[])
        .map((item) => item.id);

    expect(await ids('status=suspended')).toEqual([fx['delta']]);
    expect(await ids('status=invited')).toEqual([fx['foxtrot']]);
    expect(await ids('role=teacher')).toEqual([fx['bravo']]);
    expect(await ids('role=student&status=active')).toEqual([fx['alpha']]);
    expect(await ids('role=student&status=suspended')).toEqual([]);
    expect(await ids('role=guardian')).toEqual([fx['charlie']]);
  });

  it('hides soft-deleted users unless includeDeleted is both requested and permitted', async () => {
    const byDefault = await api().get(`${USERS}?q=${RUN}&limit=100`).set(bearer(managerToken)).expect(200);
    expect((byDefault.body.items as ListItem[]).some((item) => item.id === fx['echo'])).toBe(false);

    const denied = await api().get(`${USERS}?q=${RUN}&includeDeleted=true`).set(bearer(readerToken)).expect(403);
    expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['users.deactivate'] });

    const allowed = await api().get(`${USERS}?q=${RUN}&limit=100&includeDeleted=true`).set(bearer(managerToken)).expect(200);
    const echo = (allowed.body.items as ListItem[]).find((item) => item.id === fx['echo']);
    expect(echo).toBeDefined();
    expect(echo!.deletedAt).toEqual(expect.any(String));
    expect(echo!.status).toBe('archived');
    expect((allowed.body.items as ListItem[]).length).toBe(liveFixtureIds().length + 1);

    // "false" must stay false (the ValidationPipe's implicit conversion would turn it into true).
    const explicitFalse = await api().get(`${USERS}?q=${RUN}&limit=100&includeDeleted=false`).set(bearer(readerToken)).expect(200);
    expect((explicitFalse.body.items as ListItem[]).some((item) => item.id === fx['echo'])).toBe(false);
  });

  it('paginates without duplicates or gaps, by creation order and by name (AC 4)', async () => {
    const expected = liveFixtureIds();

    // Default: newest first by the time-ordered primary key.
    const newest = await walkPages(readerToken, { q: RUN, limit: '4' });
    expect(newest.map((page) => page.length)).toEqual([4, 4, 1]);
    expect(newest.flat().map((item) => item.id)).toEqual([...expected].reverse());

    const oldest = await walkPages(readerToken, { q: RUN, limit: '4', sort: 'createdAt', order: 'asc' });
    expect(oldest.flat().map((item) => item.id)).toEqual(expected);

    for (const order of ['asc', 'desc'] as const) {
      const byName = await walkPages(readerToken, { q: RUN, limit: '2', sort: 'fullName', order });
      const flat = byName.flat();
      expect(byName.map((page) => page.length)).toEqual([2, 2, 2, 2, 1]);
      expect(new Set(flat.map((item) => item.id))).toEqual(new Set(expected));
      expect(flat).toHaveLength(expected.length);
      const names = flat.map((item) => item.fullName);
      const sorted = [...names].sort((a, b) => a.localeCompare(b, 'en'));
      expect(names).toEqual(order === 'asc' ? sorted : sorted.reverse());
    }
  });

  it('rejects a cursor from another sort order and a malformed cursor with cursor_invalid (AC 6)', async () => {
    const first = await api().get(`${USERS}?q=${RUN}&limit=2`).set(bearer(readerToken)).expect(200);
    const cursor = first.body.nextCursor as string;
    expect(cursor).toEqual(expect.any(String));

    const mismatch = await api()
      .get(`${USERS}?q=${RUN}&limit=2&sort=fullName&cursor=${encodeURIComponent(cursor)}`)
      .set(bearer(readerToken))
      .expect(400);
    expect(mismatch.body.code).toBe('cursor_invalid');
    const malformed = await api().get(`${USERS}?q=${RUN}&cursor=not-a-cursor`).set(bearer(readerToken)).expect(400);
    expect(malformed.body.code).toBe('cursor_invalid');
  });

  it('returns the detail with labelled roles, profile summaries and guardian links (AC 2)', async () => {
    const alpha = await api().get(`${USERS}/${fx['alpha']}`).set(bearer(readerToken)).expect(200);
    expect(alpha.body).toMatchObject({
      id: fx['alpha'],
      email: email('alpha'),
      fullName: 'Fixture Alpha',
      status: 'active',
      roles: [{ key: 'student', label: { ar: 'طالب', en: 'Student' } }],
      studentProfile: { studentNumber: `S-${RUN}`, dateOfBirth: '2012-05-01', enrolledOn: '2026-09-01' },
      employeeProfile: null,
      guardians: [{ userId: fx['charlie'], fullName: 'Fixture Charlie', relationship: 'mother', isPrimary: true }],
      students: [],
      lastLoginAt: null,
      deletedAt: null,
    });
    expect([...collectKeys(alpha.body)].filter((key) => SENSITIVE_KEY.test(key))).toEqual([]);

    const bravo = await api().get(`${USERS}/${fx['bravo']}`).set(bearer(readerToken)).expect(200);
    expect(bravo.body.roles.map((role: { key: string }) => role.key)).toEqual(['teacher']);
    expect(bravo.body.employeeProfile).toEqual({
      employeeNumber: null,
      kind: 'teacher',
      jobTitle: 'Mathematics',
      specialization: null,
      hiredOn: '2025-02-10',
      isActive: true,
    });
    expect(bravo.body.studentProfile).toBeNull();

    const charlie = await api().get(`${USERS}/${fx['charlie']}`).set(bearer(readerToken)).expect(200);
    expect(charlie.body.students).toEqual([
      { userId: fx['alpha'], fullName: 'Fixture Alpha', displayName: null, relationship: 'mother', isPrimary: true },
    ]);
    expect(charlie.body.guardians).toEqual([]);

    // The caller's own last login is recorded by MOD-01 and visible here.
    const reader = await api().get(`${USERS}/${fx['reader']}`).set(bearer(readerToken)).expect(200);
    expect(reader.body.lastLoginAt).toEqual(expect.any(String));
  });

  it('answers 404 user_not_found for unknown and soft-deleted users and 400 for a malformed id (AC 5, AC 6)', async () => {
    const unknown = await api().get(`${USERS}/00000000-0000-7000-8000-000000000000`).set(bearer(readerToken)).expect(404);
    expect(unknown.body.code).toBe('user_not_found');
    const deleted = await api().get(`${USERS}/${fx['echo']}`).set(bearer(managerToken)).expect(404);
    expect(deleted.body.code).toBe('user_not_found');

    const denied = await api().get(`${USERS}/${fx['echo']}?includeDeleted=true`).set(bearer(readerToken)).expect(403);
    expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['users.deactivate'] });
    const resolved = await api().get(`${USERS}/${fx['echo']}?includeDeleted=true`).set(bearer(managerToken)).expect(200);
    expect(resolved.body.deletedAt).toEqual(expect.any(String));

    await api().get(`${USERS}/not-a-uuid`).set(bearer(readerToken)).expect(400);
  });

  it('rejects invalid query parameters with 400 (AC 6)', async () => {
    const invalid = [
      'limit=0',
      'limit=101',
      'limit=abc',
      'limit=1.5',
      'status=bogus',
      'role=Bad-Key',
      'sort=email',
      'order=sideways',
      'includeDeleted=maybe',
      'unknown=1',
    ];
    for (const params of invalid) {
      const res = await api().get(`${USERS}?${params}`).set(bearer(managerToken));
      expect(res.status, params).toBe(400);
    }
    // An empty or blank `q` is treated as absent, not as an error.
    await api().get(`${USERS}?q=&limit=1`).set(bearer(managerToken)).expect(200);
    await api().get(`${USERS}?q=%20%20&limit=1`).set(bearer(managerToken)).expect(200);
    await api().get(`${USERS}/${fx['alpha']}?unknown=1`).set(bearer(managerToken)).expect(400);
  });

  it('serves a full page and a detail within a basic latency budget (performance smoke)', async () => {
    const startedList = performance.now();
    const page = await api().get(`${USERS}?limit=100`).set(bearer(managerToken)).expect(200);
    const listMs = performance.now() - startedList;
    expect((page.body.items as ListItem[]).length).toBeLessThanOrEqual(100);
    expect(listMs, `list took ${listMs.toFixed(0)} ms`).toBeLessThan(2000);

    const startedDetail = performance.now();
    await api().get(`${USERS}/${fx['alpha']}`).set(bearer(managerToken)).expect(200);
    const detailMs = performance.now() - startedDetail;
    expect(detailMs, `detail took ${detailMs.toFixed(0)} ms`).toBeLessThan(1000);
  });
});
