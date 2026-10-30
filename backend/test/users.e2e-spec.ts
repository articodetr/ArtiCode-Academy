// TEST-011 — MOD-03-T01 (GET /api/users, GET /api/users/:id), MOD-03-T02
// (POST /api/users) and MOD-03-T04 (PATCH /api/users/:id), and TEST-026 —
// MOD-03-T06 (POST /api/users/:id/status, DELETE /api/users/:id) against the
// live development database, including the reduced projection of D-R07.
// Skipped when no database is reachable. Fixtures carry a unique suffix and
// are deleted at the end (cascade removes their roles, profiles, guardian
// links and tokens; their audit rows stay — KI-032).
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { REFRESH_COOKIE_NAME } from '../src/auth/cookies.js';
import { PasswordService } from '../src/auth/password.service.js';
import { PERMISSION_KEYS } from '../src/authorization/permission-catalog.js';
import { SYSTEM_ROLES } from '../src/authorization/system-roles.js';
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
/** Fields hidden from callers without `users.read_contact` (D-R07). */
const CONTACT_FIELDS = ['email', 'username', 'phone', 'emailVerifiedAt', 'lastLoginAt', 'lockedUntil'] as const;
const SUMMARY_KEYS = [
  'avatarUrl', 'createdAt', 'deletedAt', 'displayName', 'email', 'emailVerifiedAt', 'fullName', 'fullNameLatin',
  'id', 'lastLoginAt', 'locale', 'lockedUntil', 'phone', 'status', 'updatedAt', 'username',
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
  email: string | null;
  username: string | null;
  phone: string | null;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  lockedUntil: string | null;
}

const systemRolePermissions = (key: string): readonly string[] => SYSTEM_ROLES.find((role) => role.key === key)!.permissions;

/** The refresh cookie value from a response, or undefined when absent. */
function refreshCookie(res: SupertestResponse): string | undefined {
  const header = res.headers['set-cookie'];
  const lines: string[] = Array.isArray(header) ? header : header ? [header] : [];
  const line = lines.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE_NAME}=`));
  if (!line) return undefined;
  const value = line.split(';')[0]!.slice(REFRESH_COOKIE_NAME.length + 1);
  return value.length > 0 ? value : undefined;
}

describe.skipIf(!available)('MOD-03 users list, detail, creation, update and account status (e2e, TEST-011, TEST-026)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  /** Fixture name → user id. */
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const email = (name: string) => `${name}-${RUN}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}` });

  async function createRole(name: string, permissionKeys: readonly string[]): Promise<string> {
    const role = await prisma.role.create({
      data: {
        key: `test_${name}_${RUN}`,
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

  /** POST /api/users as `caller`; a 201 registers the new user for cleanup. */
  async function create(caller: string, body: Record<string, unknown>) {
    const res = await api().post(USERS).set(bearer(caller)).send(body);
    if (res.status === 201) createdUserIds.push(res.body.id as string);
    return res;
  }

  /** Follows `nextCursor` until exhausted; returns the pages' items in order. */
  async function walkPages(caller: string, params: Record<string, string>): Promise<ListItem[][]> {
    const pages: ListItem[][] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard += 1) {
      const query = new URLSearchParams({ ...params, ...(cursor ? { cursor } : {}) }).toString();
      const res = await api().get(`${USERS}?${query}`).set(bearer(caller)).expect(200);
      pages.push(res.body.items as ListItem[]);
      cursor = res.body.nextCursor as string | null;
      if (!cursor) return pages;
    }
    throw new Error('pagination did not terminate');
  }

  /** Ids of the live (non-deleted) fixtures created in beforeAll, in creation order. */
  const liveFixtureIds = () =>
    ['reader', 'manager', 'plain', 'creator', 'registrar', 'assigner', 'superuser', 'alpha', 'bravo', 'charlie', 'delta', 'foxtrot', 'golf']
      .map((name) => fx[name]!);

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
    const reader = await createRole('reader', ['users.read']);
    const manager = await createRole('manager', ['users.read', 'users.read_contact', 'users.deactivate']);
    const creator = await createRole('creator', ['users.create']);
    const registrar = await createRole('registrar', systemRolePermissions('staff'));
    const assigner = await createRole('assigner', ['users.create', 'users.roles.assign']);
    const superuser = await createRole('superuser', PERMISSION_KEYS);

    // Callers.
    await createUser('reader', { roleIds: [reader] });
    await createUser('manager', { roleIds: [manager] });
    await createUser('plain');
    await createUser('creator', { roleIds: [creator] });
    await createUser('registrar', { roleIds: [registrar] });
    await createUser('assigner', { roleIds: [assigner] });
    await createUser('superuser', { roleIds: [superuser] });
    // Subjects (creation order matters for the pagination test).
    await createUser('alpha', {
      fullName: 'Fixture Alpha',
      fullNameLatin: 'Alpha Fixture',
      phone: '+905550000001',
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

    for (const name of ['reader', 'manager', 'plain', 'creator', 'registrar', 'assigner', 'superuser']) {
      tokens[name] = await login(email(name));
    }
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  // ------------------------------------------------------------ T01 reads

  it('requires a token and the users.read permission (T01 AC 1)', async () => {
    expect((await api().get(USERS).expect(401)).body.code).toBe('unauthenticated');
    expect((await api().get(`${USERS}/${fx['alpha']}`).expect(401)).body.code).toBe('unauthenticated');

    const list = await api().get(USERS).set(bearer('plain')).expect(403);
    expect(list.body).toMatchObject({ code: 'permission_denied', missing: ['users.read'] });
    const detail = await api().get(`${USERS}/${fx['alpha']}`).set(bearer('plain')).expect(403);
    expect(detail.body).toMatchObject({ code: 'permission_denied', missing: ['users.read'] });
  });

  it('lists users with their role keys and without any credential-like field (T01 AC 2)', async () => {
    const res = await api().get(`${USERS}?q=${RUN}&limit=100`).set(bearer('manager')).expect(200);
    const items = res.body.items as ListItem[];
    expect(res.body.nextCursor).toBeNull();
    expect(new Set(items.map((item) => item.id))).toEqual(new Set(liveFixtureIds()));

    const alpha = items.find((item) => item.id === fx['alpha'])!;
    expect(alpha).toMatchObject({
      fullName: 'Fixture Alpha', status: 'active', roles: ['student'], deletedAt: null, email: email('alpha'), phone: '+905550000001',
    });
    expect(Object.keys(alpha).sort()).toEqual([...SUMMARY_KEYS, 'roles'].sort());
    const sensitive = [...collectKeys(res.body)].filter((key) => SENSITIVE_KEY.test(key));
    expect(sensitive).toEqual([]);
    expect(JSON.stringify(res.body)).not.toMatch(/\$argon2|Correct-Horse/);
  });

  it('hides contact data, login identifiers and security timestamps from callers without users.read_contact (D-R07)', async () => {
    // Same keys as the full projection — the contract does not change with the caller — but null values.
    const reduced = await api().get(`${USERS}?q=Fixture%20Alpha&limit=100`).set(bearer('reader')).expect(200);
    const items = reduced.body.items as ListItem[];
    expect(items.map((item) => item.id)).toContain(fx['alpha']);
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual([...SUMMARY_KEYS, 'roles'].sort());
      for (const field of CONTACT_FIELDS) expect(item[field], `${item.id}.${field}`).toBeNull();
      expect(item.fullName).toEqual(expect.any(String));
    }
    expect(items.find((item) => item.id === fx['alpha'])!.roles).toEqual(['student']);

    // The search must not become an oracle for the hidden fields.
    const byEmail = async (caller: string, q: string) =>
      ((await api().get(`${USERS}?limit=100&q=${encodeURIComponent(q)}`).set(bearer(caller)).expect(200)).body.items as ListItem[]).map((i) => i.id);
    expect(await byEmail('reader', `alpha-${RUN}@`)).toEqual([]);
    expect(await byEmail('reader', `fixture_f_${RUN}`)).toEqual([]);
    expect(await byEmail('reader', RUN)).toEqual([]);
    expect(await byEmail('manager', `alpha-${RUN}@`)).toEqual([fx['alpha']]);
    expect(await byEmail('manager', `fixture_f_${RUN}`)).toEqual([fx['foxtrot']]);
    // Names remain searchable for everyone.
    expect(await byEmail('reader', 'Alpha Fixture')).toEqual([fx['alpha']]);

    const detail = await api().get(`${USERS}/${fx['alpha']}`).set(bearer('reader')).expect(200);
    for (const field of CONTACT_FIELDS) expect(detail.body[field], field).toBeNull();
    expect(detail.body.guardians).toEqual([
      { userId: fx['charlie'], fullName: 'Fixture Charlie', displayName: null, relationship: 'mother', isPrimary: true },
    ]);
    // Even the caller's own record is reduced; the manager sees the reader's last login.
    expect((await api().get(`${USERS}/${fx['reader']}`).set(bearer('reader')).expect(200)).body.lastLoginAt).toBeNull();
    expect((await api().get(`${USERS}/${fx['reader']}`).set(bearer('manager')).expect(200)).body.lastLoginAt).toEqual(expect.any(String));
  });

  it('searches e-mail, username and names case-insensitively with literal wildcards (T01 AC 3)', async () => {
    const ids = async (q: string) =>
      ((await api().get(`${USERS}?limit=100&q=${encodeURIComponent(q)}`).set(bearer('manager')).expect(200)).body.items as ListItem[])
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

  it('applies status and role filters together with the search (T01 AC 3)', async () => {
    const ids = async (params: string) =>
      ((await api().get(`${USERS}?limit=100&q=${RUN}&${params}`).set(bearer('manager')).expect(200)).body.items as ListItem[])
        .map((item) => item.id);

    expect(await ids('status=suspended')).toEqual([fx['delta']]);
    expect(await ids('status=invited')).toEqual([fx['foxtrot']]);
    expect(await ids('role=teacher')).toEqual([fx['bravo']]);
    expect(await ids('role=student&status=active')).toEqual([fx['alpha']]);
    expect(await ids('role=student&status=suspended')).toEqual([]);
    expect(await ids('role=guardian')).toEqual([fx['charlie']]);
  });

  it('hides soft-deleted users unless includeDeleted is both requested and permitted', async () => {
    const byDefault = await api().get(`${USERS}?q=${RUN}&limit=100`).set(bearer('manager')).expect(200);
    expect((byDefault.body.items as ListItem[]).some((item) => item.id === fx['echo'])).toBe(false);

    const denied = await api().get(`${USERS}?q=${RUN}&includeDeleted=true`).set(bearer('reader')).expect(403);
    expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['users.deactivate'] });

    const allowed = await api().get(`${USERS}?q=${RUN}&limit=100&includeDeleted=true`).set(bearer('manager')).expect(200);
    const echo = (allowed.body.items as ListItem[]).find((item) => item.id === fx['echo']);
    expect(echo).toBeDefined();
    expect(echo!.deletedAt).toEqual(expect.any(String));
    expect(echo!.status).toBe('archived');
    expect((allowed.body.items as ListItem[]).length).toBe(liveFixtureIds().length + 1);

    // "false" must stay false (the ValidationPipe's implicit conversion would turn it into true).
    const explicitFalse = await api().get(`${USERS}?q=${RUN}&limit=100&includeDeleted=false`).set(bearer('manager')).expect(200);
    expect((explicitFalse.body.items as ListItem[]).some((item) => item.id === fx['echo'])).toBe(false);
  });

  it('paginates without duplicates or gaps, by creation order and by name (T01 AC 4)', async () => {
    const expected = liveFixtureIds();

    // Default: newest first by the time-ordered primary key.
    const newest = await walkPages('manager', { q: RUN, limit: '5' });
    expect(newest.map((page) => page.length)).toEqual([5, 5, 3]);
    expect(newest.flat().map((item) => item.id)).toEqual([...expected].reverse());

    const oldest = await walkPages('manager', { q: RUN, limit: '5', sort: 'createdAt', order: 'asc' });
    expect(oldest.flat().map((item) => item.id)).toEqual(expected);

    for (const order of ['asc', 'desc'] as const) {
      const byName = await walkPages('manager', { q: RUN, limit: '3', sort: 'fullName', order });
      const flat = byName.flat();
      expect(byName.map((page) => page.length)).toEqual([3, 3, 3, 3, 1]);
      expect(new Set(flat.map((item) => item.id))).toEqual(new Set(expected));
      expect(flat).toHaveLength(expected.length);
      const names = flat.map((item) => item.fullName);
      const sorted = [...names].sort((a, b) => a.localeCompare(b, 'en'));
      expect(names).toEqual(order === 'asc' ? sorted : sorted.reverse());
    }
  });

  it('rejects a cursor from another sort order and a malformed cursor with cursor_invalid (T01 AC 6)', async () => {
    const first = await api().get(`${USERS}?q=${RUN}&limit=2`).set(bearer('manager')).expect(200);
    const cursor = first.body.nextCursor as string;
    expect(cursor).toEqual(expect.any(String));

    const mismatch = await api()
      .get(`${USERS}?q=${RUN}&limit=2&sort=fullName&cursor=${encodeURIComponent(cursor)}`)
      .set(bearer('manager'))
      .expect(400);
    expect(mismatch.body.code).toBe('cursor_invalid');
    const malformed = await api().get(`${USERS}?q=${RUN}&cursor=not-a-cursor`).set(bearer('manager')).expect(400);
    expect(malformed.body.code).toBe('cursor_invalid');
  });

  it('returns the detail with labelled roles, profile summaries and guardian links (T01 AC 2)', async () => {
    const alpha = await api().get(`${USERS}/${fx['alpha']}`).set(bearer('manager')).expect(200);
    expect(alpha.body).toMatchObject({
      id: fx['alpha'],
      email: email('alpha'),
      phone: '+905550000001',
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
    expect(alpha.body).not.toHaveProperty('notes');

    const bravo = await api().get(`${USERS}/${fx['bravo']}`).set(bearer('manager')).expect(200);
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

    const charlie = await api().get(`${USERS}/${fx['charlie']}`).set(bearer('manager')).expect(200);
    expect(charlie.body.students).toEqual([
      { userId: fx['alpha'], fullName: 'Fixture Alpha', displayName: null, relationship: 'mother', isPrimary: true },
    ]);
    expect(charlie.body.guardians).toEqual([]);

    // The manager's own last login is recorded by MOD-01 and visible with users.read_contact.
    const manager = await api().get(`${USERS}/${fx['manager']}`).set(bearer('manager')).expect(200);
    expect(manager.body.lastLoginAt).toEqual(expect.any(String));
  });

  it('answers 404 user_not_found for unknown and soft-deleted users and 400 for a malformed id (T01 AC 5, AC 6)', async () => {
    const unknown = await api().get(`${USERS}/00000000-0000-7000-8000-000000000000`).set(bearer('reader')).expect(404);
    expect(unknown.body.code).toBe('user_not_found');
    const deleted = await api().get(`${USERS}/${fx['echo']}`).set(bearer('manager')).expect(404);
    expect(deleted.body.code).toBe('user_not_found');

    const denied = await api().get(`${USERS}/${fx['echo']}?includeDeleted=true`).set(bearer('reader')).expect(403);
    expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['users.deactivate'] });
    const resolved = await api().get(`${USERS}/${fx['echo']}?includeDeleted=true`).set(bearer('manager')).expect(200);
    expect(resolved.body.deletedAt).toEqual(expect.any(String));

    await api().get(`${USERS}/not-a-uuid`).set(bearer('reader')).expect(400);
  });

  it('rejects invalid query parameters with 400 (T01 AC 6)', async () => {
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
      const res = await api().get(`${USERS}?${params}`).set(bearer('manager'));
      expect(res.status, params).toBe(400);
    }
    // An empty or blank `q` is treated as absent, not as an error.
    await api().get(`${USERS}?q=&limit=1`).set(bearer('manager')).expect(200);
    await api().get(`${USERS}?q=%20%20&limit=1`).set(bearer('manager')).expect(200);
    await api().get(`${USERS}/${fx['alpha']}?unknown=1`).set(bearer('manager')).expect(400);
  });

  it('serves a full page and a detail within a basic latency budget (performance smoke)', async () => {
    const startedList = performance.now();
    const page = await api().get(`${USERS}?limit=100`).set(bearer('manager')).expect(200);
    const listMs = performance.now() - startedList;
    expect((page.body.items as ListItem[]).length).toBeLessThanOrEqual(100);
    expect(listMs, `list took ${listMs.toFixed(0)} ms`).toBeLessThan(2000);

    const startedDetail = performance.now();
    await api().get(`${USERS}/${fx['alpha']}`).set(bearer('manager')).expect(200);
    const detailMs = performance.now() - startedDetail;
    expect(detailMs, `detail took ${detailMs.toFixed(0)} ms`).toBeLessThan(1000);
  });

  // ---------------------------------------------------------- T02 create

  it('creates a student with profile and default role in one transaction, invited and without a password (T02 AC 4, 6, 7)', async () => {
    const res = await create('creator', {
      kind: 'student',
      email: `  New.Student-${RUN}@Example.TEST `,
      phone: '+905551234567',
      fullName: '  طالب جديد ',
      fullNameLatin: 'New Student',
      locale: 'ar',
      studentProfile: { studentNumber: `NS-${RUN}`, dateOfBirth: '2013-03-04', enrolledOn: '2026-09-15', notes: 'allergic to peanuts' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      email: `new.student-${RUN}@example.test`,
      username: null,
      phone: '+905551234567',
      fullName: 'طالب جديد',
      fullNameLatin: 'New Student',
      locale: 'ar',
      status: 'invited',
      emailVerifiedAt: null,
      lastLoginAt: null,
      roles: [{ key: 'student', label: { ar: 'طالب', en: 'Student' } }],
      studentProfile: { studentNumber: `NS-${RUN}`, dateOfBirth: '2013-03-04', enrolledOn: '2026-09-15' },
      employeeProfile: null,
      guardians: [],
      students: [],
    });
    expect(res.body).not.toHaveProperty('notes');
    expect([...collectKeys(res.body)].filter((key) => SENSITIVE_KEY.test(key))).toEqual([]);

    const id = res.body.id as string;
    const row = await prisma.user.findUniqueOrThrow({
      where: { id },
      select: { passwordHash: true, status: true, mustChangePassword: true, roles: { select: { assignedById: true, role: { select: { key: true } } } }, studentProfile: { select: { notes: true } } },
    });
    expect(row.passwordHash).toBeNull();
    expect(row.status).toBe('invited');
    expect(row.roles).toEqual([{ assignedById: fx['creator'], role: { key: 'student' } }]);
    expect(row.studentProfile!.notes).toBe('allergic to peanuts');

    const events = await prisma.auditLog.findMany({ where: { action: 'users.created', entityId: id } });
    expect(events).toHaveLength(1);
    expect(events[0]!.actorUserId).toBe(fx['creator']);
    expect(events[0]!.entityType).toBe('users');
    expect(events[0]!.metadata).toEqual({ kind: 'student', roles: ['student'], profile: 'student' });
    expect(JSON.stringify(events[0]!.metadata)).not.toMatch(new RegExp(RUN));
    expect(JSON.stringify(events[0]!.metadata)).not.toMatch(/example\.test|\+9055|طالب/);

    // AC 7: the account cannot sign in before activation (MOD-01 behaviour, no password set).
    const login = await api().post('/api/auth/login').send({ identifier: `new.student-${RUN}@example.test`, password: PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.code).toBe('account_not_activated');

    // The new user shows up in the list (manager) with the invited status.
    const listed = await api().get(`${USERS}?q=${encodeURIComponent(`new.student-${RUN}`)}`).set(bearer('manager')).expect(200);
    expect((listed.body.items as ListItem[]).map((item) => item.id)).toEqual([id]);
  });

  it('creates teachers, staff and guardians with the matching profile and role (T02 AC 4)', async () => {
    const teacher = await create('creator', {
      kind: 'teacher',
      email: email('new-teacher'),
      fullName: 'New Teacher',
      employeeProfile: { employeeNumber: `T-${RUN}`, jobTitle: 'Physics teacher', specialization: 'Physics', hiredOn: '2026-01-15' },
    });
    expect(teacher.status, JSON.stringify(teacher.body)).toBe(403); // creator lacks the teacher's management permissions
    expect(teacher.body.code).toBe('permission_denied');

    const teacherBySuperuser = await create('superuser', {
      kind: 'teacher',
      email: email('new-teacher'),
      fullName: 'New Teacher',
      employeeProfile: { employeeNumber: `T-${RUN}`, jobTitle: 'Physics teacher', specialization: 'Physics', hiredOn: '2026-01-15' },
    });
    expect(teacherBySuperuser.status, JSON.stringify(teacherBySuperuser.body)).toBe(201);
    expect(teacherBySuperuser.body).toMatchObject({
      status: 'invited',
      roles: [{ key: 'teacher' }],
      studentProfile: null,
      employeeProfile: { employeeNumber: `T-${RUN}`, kind: 'teacher', jobTitle: 'Physics teacher', specialization: 'Physics', hiredOn: '2026-01-15', isActive: true },
    });

    // Staff by username only (no e-mail), normalised to lower case; the registrar (staff permissions) may create staff.
    const staff = await create('registrar', { kind: 'staff', username: ` New.Staff-${RUN} `, fullName: 'New Staff', employeeProfile: { jobTitle: 'Registrar' } });
    expect(staff.status, JSON.stringify(staff.body)).toBe(201);
    expect(staff.body).toMatchObject({
      email: null,
      username: `new.staff-${RUN}`,
      roles: [{ key: 'staff' }],
      employeeProfile: { employeeNumber: null, kind: 'staff', jobTitle: 'Registrar', specialization: null, hiredOn: null, isActive: true },
      studentProfile: null,
    });

    const guardian = await create('registrar', { kind: 'guardian', email: email('new-guardian'), fullName: 'New Guardian', phone: '+905559876543' });
    expect(guardian.status, JSON.stringify(guardian.body)).toBe(201);
    expect(guardian.body).toMatchObject({ roles: [{ key: 'guardian' }], studentProfile: null, employeeProfile: null, students: [] });

    const student = await create('registrar', { kind: 'student', email: email('new-student-2'), fullName: 'Second Student' });
    expect(student.status, JSON.stringify(student.body)).toBe(201);
    expect(student.body.studentProfile).toEqual({ studentNumber: null, dateOfBirth: null, enrolledOn: null });

    const events = await prisma.auditLog.findMany({
      where: { action: 'users.created', entityId: { in: [teacherBySuperuser.body.id, staff.body.id, guardian.body.id, student.body.id] } },
      select: { metadata: true },
    });
    expect(events.map((event) => (event.metadata as { kind: string; profile: string | null }).profile).sort()).toEqual(
      [null, 'employee', 'employee', 'student'].sort(),
    );
  });

  it('rejects duplicate e-mails, usernames and reference numbers with 409 and rolls the transaction back (T02 AC 2, 6)', async () => {
    const dupEmail = await create('creator', { kind: 'guardian', email: email('alpha').toUpperCase(), fullName: 'Dup Email' });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body.code).toBe('email_in_use');

    const dupUsername = await create('creator', { kind: 'guardian', username: `FIXTURE-GOLF-${RUN}`, fullName: 'Dup Username' });
    expect(dupUsername.status).toBe(409);
    expect(dupUsername.body.code).toBe('username_in_use');

    // Soft-deleted users keep their identifiers reserved.
    const dupDeleted = await create('creator', { kind: 'guardian', email: email('echo'), fullName: 'Dup Deleted' });
    expect(dupDeleted.status).toBe(409);
    expect(dupDeleted.body.code).toBe('email_in_use');

    // The user row is inserted before the profile; a duplicate student number fails inside the
    // transaction, so neither the user nor the audit event survives (AC 6).
    const rollbackEmail = email('rollback');
    const dupNumber = await create('creator', {
      kind: 'student',
      email: rollbackEmail,
      fullName: 'Rollback Student',
      studentProfile: { studentNumber: `S-${RUN}` },
    });
    expect(dupNumber.status).toBe(409);
    expect(dupNumber.body.code).toBe('student_number_in_use');
    expect(await prisma.user.findUnique({ where: { email: rollbackEmail } })).toBeNull();
    const since = new Date(Date.now() - 60_000);
    const stray = await prisma.auditLog.findMany({
      where: { action: 'users.created', actorUserId: fx['creator'], createdAt: { gte: since } },
      select: { entityId: true },
    });
    for (const event of stray) {
      expect(await prisma.user.findUnique({ where: { id: event.entityId! }, select: { id: true } })).not.toBeNull();
    }

    const dupEmployee = await create('superuser', {
      kind: 'teacher',
      email: email('rollback-2'),
      fullName: 'Rollback Teacher',
      employeeProfile: { employeeNumber: `T-${RUN}` },
    });
    expect(dupEmployee.status).toBe(409);
    expect(dupEmployee.body.code).toBe('employee_number_in_use');
    expect(await prisma.user.findUnique({ where: { email: email('rollback-2') } })).toBeNull();
  });

  it('rejects invalid input with 400 and incompatible profiles with 422 (T02 AC 3)', async () => {
    const noIdentifier = await create('creator', { kind: 'guardian', fullName: 'Nobody' });
    expect(noIdentifier.status).toBe(400);
    expect(noIdentifier.body.code).toBe('identifier_required');
    const blankIdentifiers = await create('creator', { kind: 'guardian', fullName: 'Nobody', email: '  ', username: '' });
    expect(blankIdentifiers.body.code).toBe('identifier_required');

    const invalidBodies: Array<[string, Record<string, unknown>]> = [
      ['bad email', { kind: 'guardian', email: 'not-an-email', fullName: 'X Y' }],
      ['bad username', { kind: 'guardian', username: 'ab', fullName: 'X Y' }],
      ['username with spaces', { kind: 'guardian', username: 'sara ahmed', fullName: 'X Y' }],
      ['bad phone', { kind: 'guardian', email: email('v1'), phone: '0555 123', fullName: 'X Y' }],
      ['short name', { kind: 'guardian', email: email('v2'), fullName: 'X' }],
      ['bad locale', { kind: 'guardian', email: email('v3'), fullName: 'X Y', locale: 'fr' }],
      ['unknown kind', { kind: 'admin', email: email('v4'), fullName: 'X Y' }],
      ['missing kind', { email: email('v5'), fullName: 'X Y' }],
      ['unknown field', { kind: 'guardian', email: email('v6'), fullName: 'X Y', passwordHash: 'x' }],
      ['password supplied', { kind: 'guardian', email: email('v7'), fullName: 'X Y', password: 'Correct-Horse-Battery-9' }],
      ['impossible date', { kind: 'student', email: email('v8'), fullName: 'X Y', studentProfile: { dateOfBirth: '2026-02-30' } }],
      ['datetime instead of date', { kind: 'student', email: email('v9'), fullName: 'X Y', studentProfile: { enrolledOn: '2026-09-01T00:00:00Z' } }],
      ['nested unknown field', { kind: 'student', email: email('v10'), fullName: 'X Y', studentProfile: { grade: 5 } }],
      ['bad role key pattern', { kind: 'guardian', email: email('v11'), fullName: 'X Y', roleKeys: ['Academy-Admin'] }],
      ['roleKeys not an array', { kind: 'guardian', email: email('v12'), fullName: 'X Y', roleKeys: 'teacher' }],
      ['duplicate role keys', { kind: 'guardian', email: email('v13'), fullName: 'X Y', roleKeys: ['teacher', 'teacher'] }],
      ['bad reference number', { kind: 'student', email: email('v14'), fullName: 'X Y', studentProfile: { studentNumber: 'S 1' } }],
    ];
    for (const [label, body] of invalidBodies) {
      const res = await create('superuser', body);
      expect(res.status, label).toBe(400);
      expect(res.body.statusCode, label).toBe(400);
    }

    const studentProfileOnTeacher = await create('superuser', { kind: 'teacher', email: email('v15'), fullName: 'X Y', studentProfile: { studentNumber: `Z-${RUN}` } });
    expect(studentProfileOnTeacher.status).toBe(422);
    expect(studentProfileOnTeacher.body.code).toBe('profile_mismatch');
    const employeeProfileOnStudent = await create('superuser', { kind: 'student', email: email('v16'), fullName: 'X Y', employeeProfile: { jobTitle: 'x' } });
    expect(employeeProfileOnStudent.status).toBe(422);
    expect(employeeProfileOnStudent.body.code).toBe('profile_mismatch');
    const employeeProfileOnGuardian = await create('superuser', { kind: 'guardian', email: email('v17'), fullName: 'X Y', employeeProfile: {} });
    expect(employeeProfileOnGuardian.body.code).toBe('profile_mismatch');

    const unknownRole = await create('superuser', { kind: 'guardian', email: email('v18'), fullName: 'X Y', roleKeys: ['no_such_role'] });
    expect(unknownRole.status).toBe(400);
    expect(unknownRole.body).toMatchObject({ code: 'role_unknown', roleKeys: ['no_such_role'] });

    // Nothing above left a row behind.
    expect(await prisma.user.count({ where: { email: { startsWith: 'v', endsWith: email('').slice(1) } } })).toBe(0);
  });

  it('requires users.create, and users.roles.assign for any extra role (T02 AC 1, AC 5)', async () => {
    for (const caller of ['reader', 'manager', 'plain']) {
      const res = await create(caller, { kind: 'guardian', email: email(`denied-${caller}`), fullName: 'Denied' });
      expect(res.status, caller).toBe(403);
      expect(res.body, caller).toMatchObject({ code: 'permission_denied', missing: ['users.create'] });
    }
    expect((await api().post(USERS).send({ kind: 'guardian', email: email('anon'), fullName: 'Anon' }).expect(401)).body.code).toBe('unauthenticated');

    const extra = await create('creator', { kind: 'student', email: email('extra'), fullName: 'Extra Roles', roleKeys: ['guardian'] });
    expect(extra.status).toBe(403);
    expect(extra.body).toMatchObject({ code: 'permission_denied', missing: ['users.roles.assign'] });
    // Listing the kind's own role is not an extra role.
    const redundant = await create('creator', { kind: 'student', email: email('redundant'), fullName: 'Redundant Role', roleKeys: ['student'] });
    expect(redundant.status, JSON.stringify(redundant.body)).toBe(201);
    expect(redundant.body.roles.map((role: { key: string }) => role.key)).toEqual(['student']);
    expect(await prisma.user.findUnique({ where: { email: email('extra') } })).toBeNull();
  });

  it('never lets a creator confer permissions they do not hold — admin accounts need an admin (T02 AC 5, D-R03)', async () => {
    // users.roles.assign alone cannot mint an academy admin.
    const minted = await create('assigner', { kind: 'staff', email: email('minted-admin'), fullName: 'Minted Admin', roleKeys: ['academy_admin'] });
    expect(minted.status).toBe(403);
    expect(minted.body.code).toBe('permission_denied');
    expect(minted.body.missing).toContain('roles.manage');
    expect(minted.body.missing).toContain('users.deactivate');
    expect(minted.body.missing).not.toContain('users.create');
    expect(minted.body.missing).not.toContain('users.roles.assign');
    expect(minted.body.missing).not.toContain('courses.read'); // learner baseline is exempt
    expect(await prisma.user.findUnique({ where: { email: email('minted-admin') } })).toBeNull();

    // Staff permissions: learners and other staff yes, teachers no (grades/lessons/exams management).
    const teacher = await create('registrar', { kind: 'teacher', email: email('staff-made-teacher'), fullName: 'Staff Made Teacher' });
    expect(teacher.status).toBe(403);
    expect(teacher.body.missing).toContain('grades.manage');
    expect(teacher.body.missing).toContain('lessons.manage');
    expect(teacher.body.missing).not.toContain('courses.read');
    expect(teacher.body.missing).not.toContain('users.read');

    // An academy admin (every permission) may create anyone, including another admin.
    const admin = await create('superuser', { kind: 'staff', email: email('second-admin'), fullName: 'Second Admin', roleKeys: ['academy_admin'] });
    expect(admin.status, JSON.stringify(admin.body)).toBe(201);
    expect(admin.body.roles.map((role: { key: string }) => role.key)).toEqual(['academy_admin', 'staff']);
    expect(admin.body.employeeProfile.kind).toBe('staff');
    const grants = await prisma.userRole.findMany({ where: { userId: admin.body.id }, select: { assignedById: true } });
    expect(grants).toHaveLength(2);
    expect(grants.every((grant) => grant.assignedById === fx['superuser'])).toBe(true);
    const event = await prisma.auditLog.findFirstOrThrow({ where: { action: 'users.created', entityId: admin.body.id } });
    expect(event.metadata).toEqual({ kind: 'staff', roles: ['academy_admin', 'staff'], profile: 'employee' });

    // Compatible extra system roles share the employee profile; incompatible ones are refused.
    const combined = await create('superuser', { kind: 'teacher', email: email('teacher-staff'), fullName: 'Teacher And Staff', roleKeys: ['staff', 'guardian'] });
    expect(combined.status, JSON.stringify(combined.body)).toBe(201);
    expect(combined.body.roles.map((role: { key: string }) => role.key)).toEqual(['guardian', 'staff', 'teacher']);
    expect(combined.body.employeeProfile.kind).toBe('teacher');
    expect(combined.body.studentProfile).toBeNull();

    const studentTeacher = await create('superuser', { kind: 'student', email: email('student-teacher'), fullName: 'Student Teacher', roleKeys: ['teacher'] });
    expect(studentTeacher.status).toBe(422);
    expect(studentTeacher.body).toMatchObject({ code: 'employee_kind_required', roleKeys: ['teacher'] });
    const guardianStudent = await create('superuser', { kind: 'guardian', email: email('guardian-student'), fullName: 'Guardian Student', roleKeys: ['student'] });
    expect(guardianStudent.status).toBe(422);
    expect(guardianStudent.body.code).toBe('profile_mismatch');
  });

  it('serialises concurrent creations of the same identifier: one account, one audit event (T02 AC 2, 6)', async () => {
    const shared = email('race');
    const attempts = await Promise.all(
      Array.from({ length: 6 }, (_, i) => create('creator', { kind: 'guardian', email: shared, fullName: `Racer ${i}` })),
    );
    const statuses = attempts.map((res) => res.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
    for (const res of attempts.filter((r) => r.status === 409)) expect(res.body.code).toBe('email_in_use');
    const winner = attempts.find((res) => res.status === 201)!;
    expect(await prisma.user.count({ where: { email: shared } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'users.created', entityId: winner.body.id } })).toBe(1);
    const created = await prisma.user.findMany({ where: { fullName: { startsWith: 'Racer ' } }, select: { id: true } });
    expect(created).toHaveLength(1);
  });

  it('documents the creation endpoint in OpenAPI', async () => {
    const res = await api().get('/api/docs-json').expect(200);
    expect(res.body.paths['/api/users']).toHaveProperty('post');
    expect(res.body.paths['/api/users'].post.responses).toHaveProperty('201');
    expect(res.body.paths['/api/users'].post.responses).toHaveProperty('409');
    expect(res.body.paths['/api/users'].post.responses).toHaveProperty('422');
  });
  // ------------------------------------------------------------ T04 update

  describe('PATCH /api/users/:id (T04)', () => {
    /** Subjects created through API-014 inside this block (create() registers them for cleanup). */
    const subject: Record<string, string> = {};

    const patch = (caller: string, id: string, body: Record<string, unknown>) => api().patch(`${USERS}/${id}`).set(bearer(caller)).send(body);
    const updateEvents = (id: string) =>
      prisma.auditLog.findMany({ where: { action: 'users.updated', entityId: id }, orderBy: { createdAt: 'asc' } });

    beforeAll(async () => {
      const updater = await createRole('updater', ['users.update']);
      await createUser('updater', { roleIds: [updater] });
      tokens['updater'] = await login(email('updater'));

      const created: Array<[string, Record<string, unknown>]> = [
        ['student', { kind: 'student', email: email('patch-student'), fullName: 'Patch Student', studentProfile: { studentNumber: `PS-${RUN}`, dateOfBirth: '2012-05-01' } }],
        ['teacher', { kind: 'teacher', username: `patch_teacher_${RUN}`, fullName: 'Patch Teacher', employeeProfile: { employeeNumber: `PT-${RUN}`, jobTitle: 'Math' } }],
        ['teacher2', { kind: 'teacher', username: `patch_teacher2_${RUN}`, fullName: 'Patch Teacher Two', employeeProfile: { employeeNumber: `PT2-${RUN}` } }],
        ['guardian', { kind: 'guardian', email: email('patch-guardian'), fullName: 'Patch Guardian', locale: 'ar' }],
      ];
      for (const [name, body] of created) {
        const res = await create('superuser', body);
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        subject[name] = res.body.id as string;
      }
    });

    it('requires users.update; the response follows the caller’s projection (T04 AC 1, D-R07)', async () => {
      const id = subject['student']!;
      for (const caller of ['reader', 'manager', 'plain', 'creator', 'assigner']) {
        const res = await patch(caller, id, { displayName: 'Denied' });
        expect(res.status, caller).toBe(403);
        expect(res.body, caller).toMatchObject({ code: 'permission_denied', missing: ['users.update'] });
      }
      expect((await api().patch(`${USERS}/${id}`).send({ displayName: 'Anon' }).expect(401)).body.code).toBe('unauthenticated');
      expect(await updateEvents(id)).toHaveLength(0);

      // users.update without users.read_contact: the change is applied, the contact fields come back null.
      const reduced = await patch('updater', id, { displayName: 'Reduced View' });
      expect(reduced.status, JSON.stringify(reduced.body)).toBe(200);
      expect(reduced.body.displayName).toBe('Reduced View');
      for (const field of CONTACT_FIELDS) expect(reduced.body[field], field).toBeNull();
      expect(await prisma.user.findUniqueOrThrow({ where: { id }, select: { email: true } })).toEqual({ email: email('patch-student') });

      // Staff defaults carry users.update and users.read_contact.
      const staff = await patch('registrar', id, { displayName: 'Staff View' });
      expect(staff.status).toBe(200);
      expect(staff.body.email).toBe(email('patch-student'));
      expect(await updateEvents(id)).toHaveLength(2);
    });

    it('updates identity, preferences and profile fields in one transaction with one audit event naming the fields only (T04 AC 6)', async () => {
      const id = subject['student']!;
      const before = await prisma.user.findUniqueOrThrow({ where: { id }, select: { updatedAt: true } });
      const eventsBefore = (await updateEvents(id)).length;
      const res = await patch('superuser', id, {
        email: `  Patched.Student-${RUN}@Example.TEST `,
        username: `Patched_Student_${RUN}`,
        phone: '+905557654321',
        fullName: '  طالبة معدَّلة ',
        fullNameLatin: 'Patched Student',
        displayName: null,
        avatarUrl: 'https://cdn.example.test/avatars/patched.png',
        locale: 'en',
        studentProfile: { studentNumber: `PS2-${RUN}`, dateOfBirth: '2012-05-02', enrolledOn: '2026-09-01', notes: 'moved from branch A' },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({
        id,
        email: `patched.student-${RUN}@example.test`,
        username: `patched_student_${RUN}`,
        phone: '+905557654321',
        fullName: 'طالبة معدَّلة',
        fullNameLatin: 'Patched Student',
        displayName: null,
        avatarUrl: 'https://cdn.example.test/avatars/patched.png',
        locale: 'en',
        status: 'invited',
        emailVerifiedAt: null,
        roles: [{ key: 'student', label: { ar: 'طالب', en: 'Student' } }],
        studentProfile: { studentNumber: `PS2-${RUN}`, dateOfBirth: '2012-05-02', enrolledOn: '2026-09-01' },
        employeeProfile: null,
      });
      expect(res.body).not.toHaveProperty('notes');
      expect([...collectKeys(res.body)].filter((key) => SENSITIVE_KEY.test(key))).toEqual([]);
      expect(new Date(res.body.updatedAt as string).getTime()).toBeGreaterThan(before.updatedAt.getTime());
      const row = await prisma.user.findUniqueOrThrow({ where: { id }, select: { studentProfile: { select: { notes: true } } } });
      expect(row.studentProfile!.notes).toBe('moved from branch A');

      const events = await updateEvents(id);
      expect(events).toHaveLength(eventsBefore + 1);
      const event = events.at(-1)!;
      expect(event.actorUserId).toBe(fx['superuser']);
      expect(event.entityType).toBe('users');
      expect(event.metadata).toEqual({
        fields: [
          'email', 'username', 'phone', 'fullName', 'fullNameLatin', 'displayName', 'avatarUrl', 'locale',
          'studentProfile.studentNumber', 'studentProfile.dateOfBirth', 'studentProfile.enrolledOn', 'studentProfile.notes',
        ],
      });
      expect(JSON.stringify(event.metadata)).not.toMatch(new RegExp(RUN));
      expect(JSON.stringify(event.metadata)).not.toMatch(/example\.test|\+9055|معدَّلة|branch|cdn/);
    });

    it('drops the e-mail verification when the address changes, ignores unchanged values and clears optional fields with null (T04 AC 3)', async () => {
      const id = subject['guardian']!;
      await prisma.user.update({ where: { id }, data: { emailVerifiedAt: new Date('2026-10-01T00:00:00Z'), phone: '+905550000099', displayName: 'G' } });

      // Same address (written differently) and same phone → nothing changes, no event.
      const same = await patch('superuser', id, { email: ` ${email('patch-guardian').toUpperCase()} `, phone: '+905550000099' });
      expect(same.status, JSON.stringify(same.body)).toBe(200);
      expect(same.body.emailVerifiedAt).toBe('2026-10-01T00:00:00.000Z');
      expect(await updateEvents(id)).toHaveLength(0);

      const changed = await patch('superuser', id, { email: email('patch-guardian-2') });
      expect(changed.status).toBe(200);
      expect(changed.body.email).toBe(email('patch-guardian-2'));
      expect(changed.body.emailVerifiedAt).toBeNull();
      let events = await updateEvents(id);
      expect(events).toHaveLength(1);
      expect(events[0]!.metadata).toEqual({ fields: ['email', 'emailVerifiedAt'] });

      // null clears optional fields; a username may replace the e-mail…
      const cleared = await patch('superuser', id, {
        phone: null, displayName: '', fullNameLatin: null, locale: null, avatarUrl: null,
        username: `Patch_Guardian_${RUN}`, email: null,
      });
      expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
      expect(cleared.body).toMatchObject({
        phone: null, displayName: null, fullNameLatin: null, locale: null, avatarUrl: null,
        email: null, username: `patch_guardian_${RUN}`, emailVerifiedAt: null,
      });
      events = await updateEvents(id);
      expect(events).toHaveLength(2);
      expect(events[1]!.metadata).toEqual({ fields: ['email', 'username', 'phone', 'displayName', 'locale'] });

      // …but the account can never be left without any login identifier.
      const orphaned = await patch('superuser', id, { username: null });
      expect(orphaned.status).toBe(400);
      expect(orphaned.body.code).toBe('identifier_required');
      expect(await updateEvents(id)).toHaveLength(2);
    });

    it('rejects duplicate identifiers and reference numbers with 409 and leaves the account untouched (T04 AC 2)', async () => {
      const teacher = subject['teacher']!;
      const student = subject['student']!;
      const before = await prisma.user.findUniqueOrThrow({ where: { id: teacher }, select: { updatedAt: true, employeeProfile: { select: { updatedAt: true } } } });
      const cases: Array<[string, string, Record<string, unknown>, string]> = [
        ['e-mail of another user', teacher, { email: email('alpha') }, 'email_in_use'],
        ['e-mail of a soft-deleted user', teacher, { email: email('echo') }, 'email_in_use'],
        ['username of another user', teacher, { username: `fixture-golf-${RUN}` }, 'username_in_use'],
        ['employee number of another employee', teacher, { employeeProfile: { employeeNumber: `PT2-${RUN}` } }, 'employee_number_in_use'],
        ['student number of another student', student, { studentProfile: { studentNumber: `S-${RUN}` } }, 'student_number_in_use'],
        ['e-mail and username together', teacher, { email: email('alpha'), username: `fixture-golf-${RUN}` }, 'email_in_use'],
      ];
      for (const [label, id, body, code] of cases) {
        const res = await patch('superuser', id, body);
        expect(res.status, label).toBe(409);
        expect(res.body.code, label).toBe(code);
      }
      // Keeping one's own identifiers is not a clash.
      const own = await patch('superuser', teacher, { username: `patch_teacher_${RUN}`, employeeProfile: { employeeNumber: `PT-${RUN}` } });
      expect(own.status, JSON.stringify(own.body)).toBe(200);

      const after = await prisma.user.findUniqueOrThrow({ where: { id: teacher }, select: { updatedAt: true, employeeProfile: { select: { updatedAt: true } } } });
      expect(after).toEqual(before);
      expect(await updateEvents(teacher)).toHaveLength(0);
    });

    it('rejects undeclared fields, invalid values and an empty body with 400, and unknown or deleted users with 404 (T04 AC 4)', async () => {
      const id = subject['student']!;
      const eventsBefore = (await updateEvents(id)).length;
      const invalid: Array<[string, Record<string, unknown>]> = [
        ['status (T06)', { status: 'active' }],
        ['password hash', { passwordHash: 'x' }],
        ['password', { password: 'Correct-Horse-Battery-9' }],
        ['roleKeys (T07)', { roleKeys: ['teacher'] }],
        ['kind', { kind: 'teacher' }],
        ['emailVerifiedAt', { emailVerifiedAt: '2026-10-01T00:00:00Z' }],
        ['fullName null', { fullName: null }],
        ['fullName blank', { fullName: '   ' }],
        ['fullName too short', { fullName: 'X' }],
        ['bad email', { email: 'not-an-email' }],
        ['bad username', { username: 'ab' }],
        ['bad phone', { phone: '0555 123' }],
        ['bad locale', { locale: 'fr' }],
        ['avatar url without http(s)', { avatarUrl: 'javascript:alert(1)' }],
        ['relative avatar url', { avatarUrl: '/avatars/x.png' }],
        ['impossible date', { studentProfile: { dateOfBirth: '2026-02-30' } }],
        ['datetime instead of date', { studentProfile: { enrolledOn: '2026-09-01T00:00:00Z' } }],
        ['nested unknown field', { studentProfile: { grade: 5 } }],
        ['employee isActive (T06)', { employeeProfile: { isActive: false } }],
        ['employee kind (T07)', { employeeProfile: { kind: 'staff' } }],
        ['bad reference number', { studentProfile: { studentNumber: 'S 1' } }],
        ['profile not an object', { studentProfile: 'x' }],
      ];
      for (const [label, body] of invalid) {
        const res = await patch('superuser', id, body);
        expect(res.status, label).toBe(400);
        expect(res.body.statusCode, label).toBe(400);
      }
      for (const body of [{}, { studentProfile: {} }, { employeeProfile: {} }]) {
        const res = await patch('superuser', id, body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(res.body.code, JSON.stringify(body)).toBe('nothing_to_update');
      }
      expect((await patch('superuser', 'not-a-uuid', { displayName: 'x' })).status).toBe(400);
      const unknown = await patch('superuser', '00000000-0000-7000-8000-000000000000', { displayName: 'x' });
      expect(unknown.status).toBe(404);
      expect(unknown.body.code).toBe('user_not_found');
      const deleted = await patch('superuser', fx['echo']!, { displayName: 'x' });
      expect(deleted.status).toBe(404);
      expect(deleted.body.code).toBe('user_not_found');
      expect(await updateEvents(id)).toHaveLength(eventsBefore);
      expect(await updateEvents(fx['echo']!)).toHaveLength(0);
    });

    it('answers 422 profile_mismatch for a profile the user does not have, writing nothing (T04 AC 5)', async () => {
      const cases: Array<[string, Record<string, unknown>]> = [
        [subject['teacher']!, { studentProfile: { studentNumber: `X-${RUN}` } }],
        [subject['student']!, { employeeProfile: { jobTitle: 'x' } }],
        [subject['guardian']!, { studentProfile: { notes: 'x' } }],
        [subject['guardian']!, { employeeProfile: { jobTitle: 'x' }, fullName: 'Still Guardian' }],
      ];
      for (const [id, body] of cases) {
        const res = await patch('superuser', id, body);
        expect(res.status, JSON.stringify(body)).toBe(422);
        expect(res.body.code).toBe('profile_mismatch');
      }
      // Not even the valid fullName sent alongside was written.
      expect((await prisma.user.findUniqueOrThrow({ where: { id: subject['guardian'] }, select: { fullName: true } })).fullName).toBe('Patch Guardian');
      expect(await updateEvents(subject['guardian']!)).toHaveLength(2);
    });

    it('does not let a caller change the login identifiers of a user holding permissions the caller lacks (SEC-R-15)', async () => {
      const admin = fx['superuser']!;
      for (const body of [{ email: email('hijacked') }, { username: `hijacked_${RUN}` }, { email: null, username: `hijacked_${RUN}` }, { fullName: 'Hijacked', email: email('hijacked') }]) {
        const res = await patch('updater', admin, body);
        expect(res.status, JSON.stringify(body)).toBe(403);
        expect(res.body.code).toBe('permission_denied');
        expect(res.body.missing).toContain('roles.manage');
        expect(res.body.missing).not.toContain('users.update');
      }
      // A staff member holds users.update but not a teacher's permissions either.
      const byStaff = await patch('registrar', subject['teacher']!, { email: email('hijacked-teacher') });
      expect(byStaff.status).toBe(403);
      expect(byStaff.body.code).toBe('permission_denied');
      expect(await prisma.user.findUniqueOrThrow({ where: { id: admin }, select: { email: true, fullName: true } })).toEqual({ email: email('superuser'), fullName: 'Test superuser' });
      expect(await prisma.user.findUniqueOrThrow({ where: { id: subject['teacher'] }, select: { email: true } })).toEqual({ email: null });
      expect(await updateEvents(admin)).toHaveLength(0);

      // Other fields of the same user are not covered by the rule…
      const name = await patch('updater', admin, { displayName: 'Boss' });
      expect(name.status, JSON.stringify(name.body)).toBe(200);
      // …and the identifiers of a learner (baseline permissions) or of oneself are allowed.
      const learner = await patch('updater', subject['student']!, { username: `updated_by_updater_${RUN}` });
      expect(learner.status, JSON.stringify(learner.body)).toBe(200);
      const self = await patch('updater', fx['updater']!, { username: `updater_${RUN}` });
      expect(self.status, JSON.stringify(self.body)).toBe(200);
      const staffOnTeacherName = await patch('registrar', subject['teacher']!, { displayName: 'Renamed by staff' });
      expect(staffOnTeacherName.status).toBe(200);
    });

    it('documents the update endpoint in OpenAPI', async () => {
      const res = await api().get('/api/docs-json').expect(200);
      const operation = res.body.paths['/api/users/{id}'].patch;
      expect(operation).toBeDefined();
      for (const status of ['200', '400', '401', '403', '404', '409', '422']) expect(operation.responses, status).toHaveProperty(status);
    });
  });

  // ------------------------------------------------------------ T06 status

  describe('POST /api/users/:id/status and DELETE /api/users/:id (T06, TEST-026)', () => {
    const STATUS_ACTIONS = ['activate', 'suspend', 'archive', 'restore', 'unlock'] as const;
    const ME = '/api/auth/me';
    const REFRESH = '/api/auth/refresh';

    const status = (caller: string, id: string, body: Record<string, unknown>) =>
      api().post(`${USERS}/${id}/status`).set(bearer(caller)).send(body);
    const remove = (caller: string, id: string, body?: Record<string, unknown>) => {
      const req = api().delete(`${USERS}/${id}`).set(bearer(caller));
      return body ? req.send(body) : req;
    };
    const statusEvents = (id: string) =>
      prisma.auditLog.findMany({
        where: { action: { in: ['users.status.changed', 'users.deleted'] }, entityId: id },
        orderBy: { createdAt: 'asc' },
      });
    const sessionsOf = (id: string) => prisma.refreshToken.findMany({ where: { userId: id }, select: { revokedAt: true } });
    const rowOf = (id: string) =>
      prisma.user.findUniqueOrThrow({ where: { id }, select: { status: true, deletedAt: true, lockedUntil: true, failedLoginCount: true, updatedAt: true } });
    const tryLogin = (name: string) => api().post('/api/auth/login').send({ identifier: email(name), password: PASSWORD });

    /** A full session of a fixture: access token plus refresh cookie. */
    async function session(name: string): Promise<{ accessToken: string; cookie: string }> {
      const res = await tryLogin(name).expect(200);
      return { accessToken: res.body.accessToken as string, cookie: `${REFRESH_COOKIE_NAME}=${refreshCookie(res)!}` };
    }

    let adminRoleId: string;

    beforeAll(async () => {
      adminRoleId = (await prisma.role.findUniqueOrThrow({ where: { key: 'academy_admin' }, select: { id: true } })).id;
      const studentRoleId = (await prisma.role.findUniqueOrThrow({ where: { key: 'student' }, select: { id: true } })).id;
      const deactivator = await createRole('deactivator', ['users.read', 'users.deactivate']);
      const unlocker = await createRole('unlocker', ['users.update']);
      await createUser('deactivator', { roleIds: [deactivator] });
      await createUser('unlocker', { roleIds: [unlocker] });
      for (const name of ['deactivator', 'unlocker']) tokens[name] = await login(email(name));

      // Subjects: active learners with a password, one pending, one archived, two real academy admins.
      for (const name of ['victim', 'doomed', 'locked']) await createUser(name, { roleIds: [studentRoleId] });
      await createUser('dormant', { status: 'pending' });
      await createUser('shelved', { status: 'archived' });
      await createUser('admin-a', { roleIds: [adminRoleId] });
      await createUser('admin-b', { roleIds: [adminRoleId] });
    });

    it('requires a token and users.deactivate — users.update suffices for unlock only (T06 permissions)', async () => {
      const id = fx['victim']!;
      expect((await api().post(`${USERS}/${id}/status`).send({ action: 'suspend' }).expect(401)).body.code).toBe('unauthenticated');
      expect((await api().delete(`${USERS}/${id}`).expect(401)).body.code).toBe('unauthenticated');

      for (const action of ['activate', 'suspend', 'archive', 'restore']) {
        for (const caller of ['reader', 'plain', 'creator', 'unlocker']) {
          const res = await status(caller, id, { action });
          expect(res.status, `${caller} ${action}`).toBe(403);
          expect(res.body, `${caller} ${action}`).toMatchObject({ code: 'permission_denied', missing: ['users.deactivate'] });
        }
      }
      for (const caller of ['reader', 'plain', 'creator', 'unlocker']) {
        const res = await remove(caller, id);
        expect(res.status, caller).toBe(403);
        expect(res.body, caller).toMatchObject({ code: 'permission_denied', missing: ['users.deactivate'] });
      }
      for (const caller of ['reader', 'plain', 'creator']) {
        const res = await status(caller, id, { action: 'unlock' });
        expect(res.status, caller).toBe(403);
        expect(res.body, caller).toMatchObject({ code: 'permission_denied', missing: ['users.update'] });
      }
      // Nothing is locked: both holders get an idempotent 200 and nothing is written.
      expect((await status('unlocker', id, { action: 'unlock' })).status).toBe(200);
      expect((await status('deactivator', id, { action: 'unlock' })).status).toBe(200);
      expect((await rowOf(id)).status).toBe('active');
      expect(await statusEvents(id)).toHaveLength(0);
    });

    it('does not let a caller act on an account whose roles confer permissions the caller lacks (SEC-R-17)', async () => {
      const cases: Array<[string, string, string, string]> = [
        ['deactivator', fx['superuser']!, 'suspend', 'roles.manage'],
        ['deactivator', fx['superuser']!, 'archive', 'roles.manage'],
        ['deactivator', fx['bravo']!, 'suspend', 'lessons.manage'],
        ['deactivator', fx['bravo']!, 'unlock', 'lessons.manage'],
        ['unlocker', fx['superuser']!, 'unlock', 'roles.manage'],
        ['unlocker', fx['bravo']!, 'unlock', 'lessons.manage'],
      ];
      for (const [caller, id, action, missing] of cases) {
        const res = await status(caller, id, { action });
        expect(res.status, `${caller} ${action}`).toBe(403);
        expect(res.body.code, `${caller} ${action}`).toBe('permission_denied');
        expect(res.body.missing, `${caller} ${action}`).toContain(missing);
        // The refusal names the target's excess, not the guard's key (the deactivator holds users.deactivate).
        if (caller === 'deactivator') expect(res.body.missing, `${caller} ${action}`).not.toContain('users.deactivate');
      }
      const byDelete = await remove('deactivator', fx['bravo']!);
      expect(byDelete.status).toBe(403);
      expect(byDelete.body.code).toBe('permission_denied');
      for (const id of [fx['superuser']!, fx['bravo']!]) {
        expect(await rowOf(id)).toMatchObject({ status: 'active', deletedAt: null });
        expect(await statusEvents(id)).toHaveLength(0);
      }
      // A learner (baseline permissions) is within reach of the deactivator — proven by the suspend flow below.
    });

    it('answers 409 invalid_transition with { from, action, allowed } for every disallowed transition, writing nothing (T06 AC 1)', async () => {
      const invited = fx['foxtrot']!;
      const pending = fx['dormant']!;
      const active = fx['victim']!;
      const suspended = fx['delta']!;
      const archived = fx['shelved']!;
      const deleted = fx['echo']!;
      const cases: Array<[string, string, string, string[]]> = [
        [invited, 'activate', 'invited', ['delete']],
        [invited, 'suspend', 'invited', ['delete']],
        [invited, 'unlock', 'invited', ['delete']],
        [pending, 'suspend', 'pending', ['activate', 'delete']],
        [pending, 'restore', 'pending', ['activate', 'delete']],
        [pending, 'unlock', 'pending', ['activate', 'delete']],
        [active, 'activate', 'active', ['suspend', 'archive', 'unlock', 'delete']],
        [active, 'restore', 'active', ['suspend', 'archive', 'unlock', 'delete']],
        [suspended, 'suspend', 'suspended', ['activate', 'archive', 'delete']],
        [suspended, 'restore', 'suspended', ['activate', 'archive', 'delete']],
        [suspended, 'unlock', 'suspended', ['activate', 'archive', 'delete']],
        [archived, 'activate', 'archived', ['restore', 'delete']],
        [archived, 'suspend', 'archived', ['restore', 'delete']],
        [archived, 'archive', 'archived', ['restore', 'delete']],
        [deleted, 'restore', 'deleted', []],
        [deleted, 'activate', 'deleted', []],
        [deleted, 'unlock', 'deleted', []],
      ];
      for (const [id, action, from, allowed] of cases) {
        const res = await status('superuser', id, { action });
        expect(res.status, `${action} from ${from}`).toBe(409);
        expect(res.body, `${action} from ${from}`).toMatchObject({ code: 'invalid_transition', from, action, allowed });
      }
      const again = await remove('superuser', deleted);
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ code: 'invalid_transition', from: 'deleted', action: 'delete', allowed: [] });
      // Without users.deactivate a soft-deleted account does not even exist (same rule as the list and the detail).
      const hidden = await status('unlocker', deleted, { action: 'unlock' });
      expect(hidden.status).toBe(404);
      expect(hidden.body.code).toBe('user_not_found');

      for (const id of [invited, pending, active, suspended, archived, deleted]) expect(await statusEvents(id), id).toHaveLength(0);
      expect(await rowOf(suspended)).toMatchObject({ status: 'suspended', deletedAt: null });
      expect((await rowOf(deleted)).status).toBe('archived');
    });

    it('refuses suspend, archive and delete on one’s own account with 403 self_forbidden (T06 AC 2)', async () => {
      for (const caller of ['deactivator', 'superuser']) {
        const me = fx[caller]!;
        for (const action of ['suspend', 'archive']) {
          const res = await status(caller, me, { action });
          expect(res.status, `${caller} ${action}`).toBe(403);
          expect(res.body, `${caller} ${action}`).toMatchObject({ code: 'self_forbidden', action });
        }
        const res = await remove(caller, me, { reason: 'bye' });
        expect(res.status, caller).toBe(403);
        expect(res.body, caller).toMatchObject({ code: 'self_forbidden', action: 'delete' });
        // activate/restore cannot apply to oneself (the caller is active); unlock is harmless.
        expect((await status(caller, me, { action: 'activate' })).body.code).toBe('invalid_transition');
        expect((await status(caller, me, { action: 'unlock' })).status).toBe(200);
        expect(await rowOf(me)).toMatchObject({ status: 'active', deletedAt: null });
        expect(await statusEvents(me)).toHaveLength(0);
      }
    });

    it('suspends an account — sessions revoked at once, /me, refresh and login refused, one event — and activate, archive and restore follow the state machine (T06 AC 4, AC 6)', async () => {
      const id = fx['victim']!;
      const live = await session('victim');
      await api().get(ME).set('Authorization', `Bearer ${live.accessToken}`).expect(200);

      const res = await status('deactivator', id, { action: 'suspend', reason: '  Repeated violations of the rules  ' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ id, status: 'suspended', deletedAt: null, roles: [{ key: 'student' }] });
      // The deactivator holds no users.read_contact: reduced projection, never a credential-like key.
      for (const field of CONTACT_FIELDS) expect(res.body[field], field).toBeNull();
      expect([...collectKeys(res.body)].filter((key) => SENSITIVE_KEY.test(key))).toEqual([]);

      // Immediate loss of access: the access token, the cookie and a new login.
      expect((await api().get(ME).set('Authorization', `Bearer ${live.accessToken}`).expect(403)).body.code).toBe('account_suspended');
      await api().post(REFRESH).set('Cookie', live.cookie).expect(401);
      expect((await tryLogin('victim').expect(403)).body.code).toBe('account_suspended');
      const sessions = await sessionsOf(id);
      expect(sessions).toHaveLength(1);
      expect(sessions.every((token) => token.revokedAt !== null)).toBe(true);

      let events = await statusEvents(id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ action: 'users.status.changed', actorUserId: fx['deactivator'], entityType: 'users' });
      expect(events[0]!.metadata).toEqual({ action: 'suspend', from: 'active', to: 'suspended', reason: 'Repeated violations of the rules', revokedSessions: 1 });
      expect(JSON.stringify(events[0]!.metadata)).not.toMatch(/example\.test|@/);

      // activate: back in service with a fresh login; the revoked cookie stays dead.
      const back = await status('superuser', id, { action: 'activate' });
      expect(back.status, JSON.stringify(back.body)).toBe(200);
      expect(back.body).toMatchObject({ status: 'active', email: email('victim') });
      await api().post(REFRESH).set('Cookie', live.cookie).expect(401);
      const second = await session('victim');
      await api().get(ME).set('Authorization', `Bearer ${second.accessToken}`).expect(200);

      // archive: looks like an unknown account to login and to the session; restore: active again.
      const archived = await status('superuser', id, { action: 'archive', reason: 'Left the academy' });
      expect(archived.status).toBe(200);
      expect(archived.body.status).toBe('archived');
      expect((await api().get(ME).set('Authorization', `Bearer ${second.accessToken}`).expect(401)).body.code).toBe('session_invalid');
      expect((await tryLogin('victim').expect(401)).body.code).toBe('invalid_credentials');
      expect((await sessionsOf(id)).every((token) => token.revokedAt !== null)).toBe(true);
      const restored = await status('superuser', id, { action: 'restore' });
      expect(restored.status).toBe(200);
      expect(restored.body.status).toBe('active');
      await session('victim');

      events = await statusEvents(id);
      expect(events.map((event) => event.metadata)).toEqual([
        { action: 'suspend', from: 'active', to: 'suspended', reason: 'Repeated violations of the rules', revokedSessions: 1 },
        { action: 'activate', from: 'suspended', to: 'active', reason: null },
        { action: 'archive', from: 'active', to: 'archived', reason: 'Left the academy', revokedSessions: 1 },
        { action: 'restore', from: 'archived', to: 'active', reason: null },
      ]);
      expect(events.every((event) => event.action === 'users.status.changed' && event.actorUserId !== null)).toBe(true);
    });

    it('unlock clears the failed-login lock of an active account with one event, and is a no-op when nothing is locked (T06)', async () => {
      const id = fx['locked']!;
      const until = new Date(Date.now() + 10 * 60_000);
      until.setMilliseconds(0);
      await prisma.user.update({ where: { id }, data: { lockedUntil: until, failedLoginCount: 0 } });
      expect((await tryLogin('locked').expect(423)).body.code).toBe('account_locked');

      const res = await status('unlocker', id, { action: 'unlock', reason: 'Identity confirmed by phone' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.status).toBe('active');
      expect(await rowOf(id)).toMatchObject({ status: 'active', lockedUntil: null, failedLoginCount: 0 });
      await tryLogin('locked').expect(200);
      let events = await statusEvents(id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ action: 'users.status.changed', actorUserId: fx['unlocker'] });
      expect(events[0]!.metadata).toEqual({
        action: 'unlock', from: 'active', to: 'active', reason: 'Identity confirmed by phone', lockedUntil: until.toISOString(), failedAttempts: 0,
      });

      // Failed attempts without a lock are cleared as well (users.deactivate holders may unlock too).
      await prisma.user.update({ where: { id }, data: { failedLoginCount: 3 } });
      expect((await status('deactivator', id, { action: 'unlock' })).status).toBe(200);
      expect((await rowOf(id)).failedLoginCount).toBe(0);
      events = await statusEvents(id);
      expect(events).toHaveLength(2);
      expect(events[1]!.metadata).toEqual({ action: 'unlock', from: 'active', to: 'active', reason: null, lockedUntil: null, failedAttempts: 3 });

      // Nothing to clear: 200, nothing written, no event.
      const before = await rowOf(id);
      const noop = await status('unlocker', id, { action: 'unlock' });
      expect(noop.status).toBe(200);
      expect((await rowOf(id)).updatedAt).toEqual(before.updatedAt);
      expect(await statusEvents(id)).toHaveLength(2);
    });

    it('never takes the last active academy admin out of service, even under concurrent requests (T06 AC 3)', async () => {
      const a = fx['admin-a']!;
      const b = fx['admin-b']!;
      // The rule counts every active admin of the database: the others are set aside for this test only and restored afterwards.
      const others = await prisma.user.findMany({
        where: { id: { notIn: [a, b] }, status: 'active', deletedAt: null, roles: { some: { roleId: adminRoleId } } },
        select: { id: true },
      });
      const otherIds = others.map((row) => row.id);
      await prisma.user.updateMany({ where: { id: { in: otherIds } }, data: { status: 'suspended' } });
      try {
        // Two admins left: suspending both at the same time leaves exactly one.
        const [resA, resB] = await Promise.all([status('superuser', a, { action: 'suspend' }), status('superuser', b, { action: 'suspend' })]);
        expect([resA.status, resB.status].sort()).toEqual([200, 409]);
        const loser = resA.status === 409 ? resA : resB;
        expect(loser.body.code).toBe('last_admin');
        const remaining = resA.status === 200 ? b : a;
        const benched = resA.status === 200 ? a : b;
        expect(await rowOf(remaining)).toMatchObject({ status: 'active', deletedAt: null });
        expect(await statusEvents(remaining)).toHaveLength(0);
        expect(await statusEvents(benched)).toHaveLength(1);

        for (const action of ['suspend', 'archive']) {
          const res = await status('superuser', remaining, { action, reason: 'should not happen' });
          expect(res.status, action).toBe(409);
          expect(res.body.code, action).toBe('last_admin');
        }
        const del = await remove('superuser', remaining);
        expect(del.status).toBe(409);
        expect(del.body.code).toBe('last_admin');
        expect(await rowOf(remaining)).toMatchObject({ status: 'active', deletedAt: null });
        expect(await statusEvents(remaining)).toHaveLength(0);

        // A suspended admin is outside the quorum: archiving it is fine; restoring it makes two admins again.
        expect((await status('superuser', benched, { action: 'archive' })).status).toBe(200);
        expect((await status('superuser', benched, { action: 'restore' })).status).toBe(200);
        expect((await remove('superuser', remaining, { reason: 'handover done' })).status).toBe(200);
        const last = await remove('superuser', benched);
        expect(last.status).toBe(409);
        expect(last.body.code).toBe('last_admin');
        expect(await rowOf(benched)).toMatchObject({ status: 'active', deletedAt: null });
      } finally {
        await prisma.user.updateMany({ where: { id: { in: otherIds } }, data: { status: 'active' } });
      }
    });

    it('soft-deletes an account: hidden from the list, cannot sign in, e-mail reserved, nothing applies afterwards, one event (T06 AC 5, AC 6)', async () => {
      const id = fx['doomed']!;
      const live = await session('doomed');

      const res = await remove('superuser', id, { reason: 'Duplicate account' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({ id, status: 'archived', email: email('doomed') });
      expect(res.body.deletedAt).toEqual(expect.any(String));
      expect([...collectKeys(res.body)].filter((key) => SENSITIVE_KEY.test(key))).toEqual([]);

      // Access is gone and the account looks unknown to login.
      expect((await api().get(ME).set('Authorization', `Bearer ${live.accessToken}`).expect(401)).body.code).toBe('session_invalid');
      await api().post(REFRESH).set('Cookie', live.cookie).expect(401);
      expect((await tryLogin('doomed').expect(401)).body.code).toBe('invalid_credentials');
      expect((await sessionsOf(id)).every((token) => token.revokedAt !== null)).toBe(true);

      // Hidden from the list and the detail unless includeDeleted.
      const listed = await api().get(`${USERS}?q=doomed`).set(bearer('superuser')).expect(200);
      expect((listed.body.items as ListItem[]).map((item) => item.id)).not.toContain(id);
      const withDeleted = await api().get(`${USERS}?q=doomed&includeDeleted=true`).set(bearer('superuser')).expect(200);
      expect((withDeleted.body.items as ListItem[]).map((item) => item.id)).toContain(id);
      expect((await api().get(`${USERS}/${id}`).set(bearer('superuser')).expect(404)).body.code).toBe('user_not_found');
      expect((await api().get(`${USERS}/${id}?includeDeleted=true`).set(bearer('superuser')).expect(200)).body.status).toBe('archived');

      // The e-mail stays reserved by the unique index.
      const clash = await create('superuser', { kind: 'student', email: email('doomed'), fullName: 'Doomed Again' });
      expect(clash.status).toBe(409);
      expect(clash.body.code).toBe('email_in_use');

      // Nothing applies to a deleted account any more.
      for (const action of STATUS_ACTIONS) {
        const res = await status('superuser', id, { action });
        expect(res.status, action).toBe(409);
        expect(res.body, action).toMatchObject({ code: 'invalid_transition', from: 'deleted', action, allowed: [] });
      }
      expect((await remove('superuser', id)).body).toMatchObject({ code: 'invalid_transition', from: 'deleted' });

      const events = await statusEvents(id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ action: 'users.deleted', actorUserId: fx['superuser'], entityType: 'users' });
      expect(events[0]!.metadata).toEqual({ action: 'delete', from: 'active', to: 'archived', reason: 'Duplicate account', revokedSessions: 1 });

      // A client may send no body at all; any non-deleted state can be deleted.
      const pending = await remove('deactivator', fx['dormant']!);
      expect(pending.status, JSON.stringify(pending.body)).toBe(200);
      expect(pending.body.status).toBe('archived');
      expect(pending.body.deletedAt).toEqual(expect.any(String));
      const pendingEvents = await statusEvents(fx['dormant']!);
      expect(pendingEvents).toHaveLength(1);
      expect(pendingEvents[0]!.metadata).toEqual({ action: 'delete', from: 'pending', to: 'archived', reason: null, revokedSessions: 0 });
    });

    it('rejects unknown actions, undeclared fields and bad reasons with 400 and unknown users with 404, writing nothing (T06)', async () => {
      const id = fx['victim']!;
      const eventsBefore = (await statusEvents(id)).length;
      const invalid: Array<[string, Record<string, unknown>]> = [
        ['no action', {}],
        ['delete as a status action', { action: 'delete' }],
        ['upper-case action', { action: 'SUSPEND' }],
        ['action not a string', { action: ['suspend'] }],
        ['undeclared field', { action: 'suspend', status: 'suspended' }],
        ['reason too long', { action: 'suspend', reason: 'x'.repeat(501) }],
      ];
      // (A non-string `reason` is coerced by the global implicit conversion — KI-039 — so only the length and the field list are checked here.)
      for (const [label, body] of invalid) {
        const res = await status('superuser', id, body);
        expect(res.status, label).toBe(400);
        expect(res.body.statusCode, label).toBe(400);
      }
      for (const [label, body] of [['undeclared field', { force: true }], ['reason too long', { reason: 'x'.repeat(501) }]] as Array<[string, Record<string, unknown>]>) {
        const res = await remove('superuser', id, body);
        expect(res.status, label).toBe(400);
      }
      expect((await status('superuser', 'not-a-uuid', { action: 'suspend' })).status).toBe(400);
      expect((await remove('superuser', 'not-a-uuid')).status).toBe(400);
      const unknownId = '00000000-0000-7000-8000-000000000000';
      expect((await status('superuser', unknownId, { action: 'suspend' })).body).toMatchObject({ statusCode: 404, code: 'user_not_found' });
      expect((await remove('superuser', unknownId)).body).toMatchObject({ statusCode: 404, code: 'user_not_found' });
      expect(await rowOf(id)).toMatchObject({ status: 'active', deletedAt: null });
      expect(await statusEvents(id)).toHaveLength(eventsBefore);
    });

    it('documents the status and delete endpoints in OpenAPI', async () => {
      const res = await api().get('/api/docs-json').expect(200);
      const change = res.body.paths['/api/users/{id}/status'].post;
      const del = res.body.paths['/api/users/{id}'].delete;
      expect(change).toBeDefined();
      expect(del).toBeDefined();
      for (const code of ['200', '400', '401', '403', '404', '409']) {
        expect(change.responses, `status ${code}`).toHaveProperty(code);
        expect(del.responses, `delete ${code}`).toHaveProperty(code);
      }
      expect(change.requestBody).toBeDefined();
    });
  });
});
