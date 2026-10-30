// TEST-024 — MOD-03-T08 (GET /api/roles, GET /api/permissions, POST /api/roles,
// PATCH /api/roles/:id, DELETE /api/roles/:id) against the live development
// database. Skipped when no database is reachable. Fixtures carry a unique
// suffix and are deleted at the end (their audit rows stay — KI-032). The
// seed test (AC 5) edits the permissions of the system role `guardian` and
// restores the seeded defaults in a finally block.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedCatalog } from '../prisma/seed.js';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { PasswordService } from '../src/auth/password.service.js';
import { PERMISSION_CATALOG, PERMISSION_KEYS } from '../src/authorization/permission-catalog.js';
import { SYSTEM_ROLE_KEYS, SYSTEM_ROLES } from '../src/authorization/system-roles.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const ROLES = '/api/roles';
const PERMISSIONS = '/api/permissions';
const SENSITIVE_KEY = /hash|password/i;
const ROLE_KEYS = ['createdAt', 'description', 'id', 'isDefaultForSignup', 'isSystem', 'key', 'label', 'permissions', 'updatedAt', 'userCount'];
/** A deprecated catalog key planted for AC 1 (never offered, never grantable). */
const DEPRECATED_KEY = `test.deprecated_${RUN}`;

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

interface RoleItem {
  id: string;
  key: string;
  label: { ar: string; en?: string; tr?: string };
  description: { ar: string; en?: string; tr?: string } | null;
  isSystem: boolean;
  isDefaultForSignup: boolean;
  userCount: number;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

const systemRolePermissions = (key: string): readonly string[] => SYSTEM_ROLES.find((role) => role.key === key)!.permissions;
const sorted = (keys: Iterable<string>): string[] => [...keys].sort();

describe.skipIf(!available)('MOD-03 roles and permissions management (e2e, TEST-024)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const roleIds: Record<string, string> = {};
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
    roleIds[name] = role.id;
    return role.id;
  }

  async function createUser(name: string, roleIdList: string[] = []): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Test ${name}`,
        passwordHash: await passwords.hash(PASSWORD),
        status: 'active',
        roles: roleIdList.length > 0 ? { create: roleIdList.map((roleId) => ({ roleId })) } : undefined,
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

  /** POST /api/roles as `caller`; a 201 registers the role for cleanup. */
  async function createViaApi(caller: string, body: Record<string, unknown>) {
    const res = await api().post(ROLES).set(bearer(caller)).send(body);
    if (res.status === 201) createdRoleIds.push(res.body.id as string);
    return res;
  }

  const events = (action: string, entityId: string) =>
    prisma.auditLog.findMany({ where: { action, entityId }, orderBy: { createdAt: 'asc' } });
  const allEvents = (entityId: string) => prisma.auditLog.findMany({ where: { entityType: 'roles', entityId } });
  const grantsOf = async (roleId: string): Promise<string[]> =>
    sorted((await prisma.rolePermission.findMany({ where: { roleId }, select: { permissionKey: true } })).map((g) => g.permissionKey));
  const systemRoleId = async (key: string): Promise<string> =>
    (await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true } })).id;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    await prisma.permission.create({
      data: { key: DEPRECATED_KEY, module: 'TEST', description: { ar: 'مهمل' }, deprecatedAt: new Date() },
    });

    const superuser = await createRole('superuser', PERMISSION_KEYS);
    const reader = await createRole('reader', ['users.read']);
    // A limited role manager: staff defaults plus roles.manage — never grades/lessons management.
    const limited = await createRole('limited', [...systemRolePermissions('staff'), 'roles.manage']);
    // Held by `holder`; edited live in the AC 4 test.
    const live = await createRole('live', ['users.read']);
    // Granted to a user so that deleting it conflicts (AC 3).
    const granted = await createRole('granted', ['courses.read']);

    await createUser('superuser', [superuser]);
    await createUser('reader', [reader]);
    await createUser('limited', [limited]);
    await createUser('plain');
    await createUser('holder', [live, granted]);
    for (const name of ['superuser', 'reader', 'limited', 'plain', 'holder']) tokens[name] = await login(email(name));
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
    await prisma.permission.deleteMany({ where: { key: DEPRECATED_KEY } });
    await prisma.$disconnect();
    await app.close();
  });

  // ------------------------------------------------------------ guards

  it('requires a token, users.read for the list and roles.manage for everything else', async () => {
    const id = roleIds['live']!;
    expect((await api().get(ROLES).expect(401)).body.code).toBe('unauthenticated');
    expect((await api().get(PERMISSIONS).expect(401)).body.code).toBe('unauthenticated');
    expect((await api().post(ROLES).send({}).expect(401)).body.code).toBe('unauthenticated');
    expect((await api().patch(`${ROLES}/${id}`).send({}).expect(401)).body.code).toBe('unauthenticated');
    expect((await api().delete(`${ROLES}/${id}`).expect(401)).body.code).toBe('unauthenticated');

    const list = await api().get(ROLES).set(bearer('plain')).expect(403);
    expect(list.body).toMatchObject({ code: 'permission_denied', missing: ['users.read'] });

    for (const caller of ['reader', 'plain']) {
      expect((await api().get(PERMISSIONS).set(bearer(caller)).expect(403)).body.missing).toEqual(['roles.manage']);
      const body = { key: `test_denied_${RUN}`, label: { ar: 'x' }, permissions: ['courses.read'] };
      expect((await api().post(ROLES).set(bearer(caller)).send(body).expect(403)).body.missing).toEqual(['roles.manage']);
      expect((await api().patch(`${ROLES}/${id}`).set(bearer(caller)).send({ permissions: [] }).expect(403)).body.missing).toEqual(['roles.manage']);
      expect((await api().delete(`${ROLES}/${id}`).set(bearer(caller)).expect(403)).body.missing).toEqual(['roles.manage']);
    }
    expect(await prisma.role.findUnique({ where: { key: `test_denied_${RUN}` } })).toBeNull();
    expect(await grantsOf(id)).toEqual(['users.read']);
  });

  // ------------------------------------------------------------ reads

  it('lists system roles first with labels, user counts and active permissions, then custom roles by key', async () => {
    const res = await api().get(ROLES).set(bearer('reader')).expect(200);
    const items = res.body.items as RoleItem[];
    const systemItems = items.filter((item) => item.isSystem);
    const customItems = items.filter((item) => !item.isSystem);
    expect(items.slice(0, systemItems.length).every((item) => item.isSystem)).toBe(true);
    expect(sorted(systemItems.map((item) => item.key))).toEqual(sorted(SYSTEM_ROLE_KEYS));
    expect(systemItems.map((item) => item.key)).toEqual(sorted(systemItems.map((item) => item.key)));
    expect(customItems.map((item) => item.key)).toEqual(sorted(customItems.map((item) => item.key)));

    const admin = items.find((item) => item.key === 'academy_admin')!;
    expect(admin.permissions).toEqual(sorted(PERMISSION_KEYS));
    expect(admin.label).toEqual({ ar: 'مدير الأكاديمية', en: 'Academy Admin' });
    expect(admin.description?.ar).toBeTruthy();
    expect(admin.isDefaultForSignup).toBe(false);
    expect(items.find((item) => item.key === 'student')!.isDefaultForSignup).toBe(true);
    expect(Object.keys(admin).sort()).toEqual(ROLE_KEYS);

    const reader = items.find((item) => item.id === roleIds['reader'])!;
    expect(reader).toMatchObject({ key: `test_reader_${RUN}`, isSystem: false, userCount: 1, permissions: ['users.read'], description: null });
    expect(items.find((item) => item.id === roleIds['superuser'])!.permissions).toEqual(sorted(PERMISSION_KEYS));
    expect(items.find((item) => item.id === roleIds['live'])!.userCount).toBe(1);
    expect([...collectKeys(res.body)].filter((key) => SENSITIVE_KEY.test(key))).toEqual([]);
  });

  it('serves the active catalog grouped by module in declaration order, without deprecated keys', async () => {
    const res = await api().get(PERMISSIONS).set(bearer('limited')).expect(200);
    const groups = res.body.groups as { module: string; permissions: { key: string; description: { ar: string; en?: string } | null }[] }[];
    const keys = groups.flatMap((group) => group.permissions.map((permission) => permission.key));
    expect(res.body.total).toBe(keys.length);
    expect(sorted(keys)).toEqual(sorted(PERMISSION_KEYS));
    expect(keys).not.toContain(DEPRECATED_KEY);
    expect(groups.map((group) => group.module)).toEqual(sorted(groups.map((group) => group.module)));

    const mod03 = groups.find((group) => group.module === 'MOD-03')!;
    const catalogOrder = PERMISSION_CATALOG.filter((item) => item.module === 'MOD-03').map((item) => item.key);
    expect(mod03.permissions.map((permission) => permission.key)).toEqual(catalogOrder);
    expect(mod03.permissions.find((permission) => permission.key === 'roles.manage')!.description).toEqual({
      ar: 'إدارة الأدوار والصلاحيات',
      en: 'Manage roles and permissions',
    });
    for (const group of groups) {
      for (const permission of group.permissions) {
        expect(PERMISSION_CATALOG.find((item) => item.key === permission.key)!.module).toBe(group.module);
      }
    }
  });

  // ------------------------------------------------------------ create

  it('creates a custom role with its permissions in one transaction with one roles.created event', async () => {
    const before = Date.now();
    const res = await createViaApi('superuser', {
      key: `  Test_Librarian_${RUN}  `,
      label: { ar: 'أمين المكتبة', en: 'Librarian', tr: '  ' },
      description: { ar: 'يدير المكتبة' },
      permissions: ['lessons.read', 'courses.read', 'users.read'],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const key = `test_librarian_${RUN}`;
    expect(res.body).toMatchObject({
      key,
      label: { ar: 'أمين المكتبة', en: 'Librarian' },
      description: { ar: 'يدير المكتبة' },
      isSystem: false,
      isDefaultForSignup: false,
      userCount: 0,
      permissions: ['courses.read', 'lessons.read', 'users.read'],
    });
    expect(res.body.label).not.toHaveProperty('tr');
    expect(Object.keys(res.body).sort()).toEqual(ROLE_KEYS);
    expect(new Date(res.body.createdAt).getTime()).toBeGreaterThanOrEqual(before - 1000);

    const row = await prisma.role.findUniqueOrThrow({ where: { key }, select: { id: true, isSystem: true, label: true } });
    expect(row.id).toBe(res.body.id);
    expect(row.isSystem).toBe(false);
    expect(row.label).toEqual({ ar: 'أمين المكتبة', en: 'Librarian' });
    expect(await grantsOf(row.id)).toEqual(['courses.read', 'lessons.read', 'users.read']);

    const created = await events('roles.created', row.id);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ actorUserId: fx['superuser'], entityType: 'roles' });
    expect(created[0]!.metadata).toEqual({ key, permissions: ['courses.read', 'lessons.read', 'users.read'] });
    expect(await allEvents(row.id)).toHaveLength(1);

    const list = await api().get(ROLES).set(bearer('reader')).expect(200);
    const listed = (list.body.items as RoleItem[]).find((item) => item.id === row.id)!;
    expect(listed).toMatchObject({ key, userCount: 0, permissions: ['courses.read', 'lessons.read', 'users.read'] });
    expect(listed.isSystem).toBe(false);
  });

  it('rejects invalid bodies with 400, reserved or taken keys with 409 and unknown or deprecated permissions with permission_unknown (AC 1)', async () => {
    const valid = { key: `test_valid_${RUN}`, label: { ar: 'صالح' }, permissions: ['courses.read'] };
    const invalid: [string, Record<string, unknown>][] = [
      ['missing key', { label: valid.label, permissions: valid.permissions }],
      ['short key', { ...valid, key: 'ab' }],
      ['key with dash', { ...valid, key: 'role-with-dash' }],
      ['key with dot', { ...valid, key: 'roles.manage' }],
      ['key starting with digit', { ...valid, key: '1role' }],
      ['key too long', { ...valid, key: `a${'b'.repeat(64)}` }],
      ['missing label', { key: valid.key, permissions: valid.permissions }],
      ['label without ar', { ...valid, label: { en: 'No Arabic' } }],
      ['blank ar', { ...valid, label: { ar: '   ' } }],
      ['unknown locale', { ...valid, label: { ar: 'x', fr: 'y' } }],
      ['label as string', { ...valid, label: 'x' }],
      ['description without ar', { ...valid, description: { en: 'x' } }],
      ['missing permissions', { key: valid.key, label: valid.label }],
      ['permissions not an array', { ...valid, permissions: 'courses.read' }],
      ['duplicate permissions', { ...valid, permissions: ['courses.read', 'courses.read'] }],
      ['malformed permission', { ...valid, permissions: ['Courses.Read'] }],
      ['undeclared field', { ...valid, isSystem: true }],
      ['undeclared field 2', { ...valid, userCount: 0 }],
    ];
    for (const [name, body] of invalid) {
      const res = await createViaApi('superuser', body);
      expect(res.status, name).toBe(400);
      expect(res.body.code, name).toBeUndefined();
    }

    for (const reserved of ['teacher', 'academy_admin', 'STAFF']) {
      const res = await createViaApi('superuser', { ...valid, key: reserved });
      expect(res.status, reserved).toBe(409);
      expect(res.body).toMatchObject({ code: 'role_in_use', key: reserved.toLowerCase() });
    }
    const taken = await createViaApi('superuser', { ...valid, key: `test_reader_${RUN}` });
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ code: 'role_in_use', key: `test_reader_${RUN}` });

    const unknown = await createViaApi('superuser', { ...valid, permissions: ['courses.read', 'zzz.nothing', DEPRECATED_KEY] });
    expect(unknown.status).toBe(400);
    expect(unknown.body).toMatchObject({ code: 'permission_unknown', permissions: [DEPRECATED_KEY, 'zzz.nothing'] });
    const onlyDeprecated = await createViaApi('superuser', { ...valid, permissions: [DEPRECATED_KEY] });
    expect(onlyDeprecated.status).toBe(400);
    expect(onlyDeprecated.body).toMatchObject({ code: 'permission_unknown', permissions: [DEPRECATED_KEY] });

    expect(await prisma.role.findUnique({ where: { key: valid.key } })).toBeNull();
    expect(await prisma.role.count({ where: { key: { in: ['teacher', 'academy_admin', 'staff'] }, isSystem: false } })).toBe(0);
    const stray = await prisma.auditLog.findMany({ where: { action: 'roles.created', createdAt: { gte: new Date(Date.now() - 60_000) } } });
    expect(stray.filter((event) => (event.metadata as { key?: string } | null)?.key === valid.key)).toEqual([]);
  });

  it('never lets a role manager grant a permission they do not hold (AC 6, SEC-R-16)', async () => {
    // Staff + roles.manage cannot mint a teacher-like role …
    const overreach = await createViaApi('limited', {
      key: `test_overreach_${RUN}`,
      label: { ar: 'تجاوز' },
      permissions: ['users.read', 'grades.manage', 'lessons.manage', 'courses.read'],
    });
    expect(overreach.status).toBe(403);
    expect(overreach.body.code).toBe('permission_denied');
    expect(overreach.body.missing).toEqual(['grades.manage', 'lessons.manage']);
    expect(await prisma.role.findUnique({ where: { key: `test_overreach_${RUN}` } })).toBeNull();

    // … nor an admin-like one, even with roles.manage itself in the list.
    const admin = await createViaApi('limited', { key: `test_admin2_${RUN}`, label: { ar: 'مدير' }, permissions: PERMISSION_KEYS });
    expect(admin.status).toBe(403);
    expect(admin.body.missing).toContain('users.roles.assign');
    expect(admin.body.missing).toContain('audit.read');
    expect(admin.body.missing).not.toContain('roles.manage');
    expect(admin.body.missing).not.toContain('users.read');
    expect(admin.body.missing).not.toContain('courses.read'); // learner baseline is exempt

    // What they hold plus the learner baseline is fine.
    const allowed = await createViaApi('limited', {
      key: `test_registrar_${RUN}`,
      label: { ar: 'مسجّل' },
      permissions: ['users.read', 'users.create', 'enrollments.manage', 'courses.read', 'grades.read_own', 'roles.manage'],
    });
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(201);
    expect(allowed.body.permissions).toEqual(['courses.read', 'enrollments.manage', 'grades.read_own', 'roles.manage', 'users.create', 'users.read']);

    // The same rule on PATCH: adding is checked, removing never is.
    const id = allowed.body.id as string;
    const add = await api().patch(`${ROLES}/${id}`).set(bearer('limited')).send({ permissions: ['users.read', 'exams.grade'] });
    expect(add.status).toBe(403);
    expect(add.body.missing).toEqual(['exams.grade']);
    expect(await grantsOf(id)).toEqual(['courses.read', 'enrollments.manage', 'grades.read_own', 'roles.manage', 'users.create', 'users.read']);

    const teacherLike = await createViaApi('superuser', { key: `test_teacherlike_${RUN}`, label: { ar: 'شبه معلم' }, permissions: systemRolePermissions('teacher') });
    expect(teacherLike.status).toBe(201);
    const strip = await api().patch(`${ROLES}/${teacherLike.body.id}`).set(bearer('limited')).send({ permissions: ['courses.read'] });
    expect(strip.status, JSON.stringify(strip.body)).toBe(200);
    expect(strip.body.permissions).toEqual(['courses.read']);
    const stripped = await events('roles.permissions.changed', teacherLike.body.id as string);
    expect(stripped).toHaveLength(1);
    expect((stripped[0]!.metadata as { removed: string[] }).removed).toContain('grades.manage');
  });

  // ------------------------------------------------------------ update

  it('updates label, description and permissions with exactly one event per request and writes nothing when nothing differs', async () => {
    const created = await createViaApi('superuser', {
      key: `test_editable_${RUN}`,
      label: { ar: 'قابل للتعديل' },
      description: { ar: 'وصف' },
      permissions: ['courses.read', 'users.read'],
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const url = `${ROLES}/${id}`;

    // Label only → roles.updated with the field name.
    const label = await api().patch(url).set(bearer('superuser')).send({ label: { ar: 'قابل للتعديل', en: 'Editable' } }).expect(200);
    expect(label.body.label).toEqual({ ar: 'قابل للتعديل', en: 'Editable' });
    expect(label.body.permissions).toEqual(['courses.read', 'users.read']);
    let updated = await events('roles.updated', id);
    expect(updated).toHaveLength(1);
    expect(updated[0]!.metadata).toEqual({ key: `test_editable_${RUN}`, fields: ['label'] });
    expect(updated[0]!.actorUserId).toBe(fx['superuser']);

    // Same label again → no write, no event.
    const same = await api().patch(url).set(bearer('superuser')).send({ label: { ar: 'قابل للتعديل', en: 'Editable' } }).expect(200);
    expect(same.body.updatedAt).toBe(label.body.updatedAt);
    expect(await events('roles.updated', id)).toHaveLength(1);

    // Permissions only → roles.permissions.changed with added/removed.
    const perms = await api().patch(url).set(bearer('superuser')).send({ permissions: ['users.read', 'audit.read'] });
    expect(perms.status, JSON.stringify(perms.body)).toBe(200);
    expect(perms.body.permissions).toEqual(['audit.read', 'users.read']);
    expect(new Date(perms.body.updatedAt).getTime()).toBeGreaterThan(new Date(label.body.updatedAt).getTime());
    let changed = await events('roles.permissions.changed', id);
    expect(changed).toHaveLength(1);
    expect(changed[0]!.metadata).toEqual({ key: `test_editable_${RUN}`, added: ['audit.read'], removed: ['courses.read'], fields: [] });
    expect(await grantsOf(id)).toEqual(['audit.read', 'users.read']);

    // Identical set in another order → nothing.
    await api().patch(url).set(bearer('superuser')).send({ permissions: ['users.read', 'audit.read'] }).expect(200);
    expect(await events('roles.permissions.changed', id)).toHaveLength(1);

    // Description cleared + permissions changed in one request → one event only.
    const both = await api().patch(url).set(bearer('superuser')).send({ description: null, permissions: [] }).expect(200);
    expect(both.body.description).toBeNull();
    expect(both.body.permissions).toEqual([]);
    changed = await events('roles.permissions.changed', id);
    expect(changed).toHaveLength(2);
    expect(changed[1]!.metadata).toEqual({ key: `test_editable_${RUN}`, added: [], removed: ['audit.read', 'users.read'], fields: ['description'] });
    updated = await events('roles.updated', id);
    expect(updated).toHaveLength(1);
    expect(await allEvents(id)).toHaveLength(4); // created + updated + 2 × permissions.changed

    // Description set again and blank optional locale dropped.
    const desc = await api().patch(url).set(bearer('superuser')).send({ description: { ar: 'وصف جديد', en: '' } }).expect(200);
    expect(desc.body.description).toEqual({ ar: 'وصف جديد' });

    // Empty body and bodies with undeclared or invalid fields.
    for (const body of [{}, { key: 'new_key' }, { isSystem: false }, { label: { ar: '' } }, { permissions: ['Bad Key'] }, { permissions: ['users.read', 'users.read'] }, { description: 'x' }]) {
      const res = await api().patch(url).set(bearer('superuser')).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await api().patch(url).set(bearer('superuser')).send({}).expect(400)).body.code).toBe('nothing_to_update');
    const unknown = await api().patch(url).set(bearer('superuser')).send({ permissions: ['users.read', DEPRECATED_KEY] }).expect(400);
    expect(unknown.body).toMatchObject({ code: 'permission_unknown', permissions: [DEPRECATED_KEY] });
    expect(await grantsOf(id)).toEqual([]);
    expect(await allEvents(id)).toHaveLength(5);

    expect((await api().patch(`${ROLES}/not-a-uuid`).set(bearer('superuser')).send({ permissions: [] }).expect(400)).body.code).toBeUndefined();
    const missing = await api().patch(`${ROLES}/00000000-0000-7000-8000-000000000000`).set(bearer('superuser')).send({ permissions: [] }).expect(404);
    expect(missing.body).toMatchObject({ code: 'role_unknown', id: '00000000-0000-7000-8000-000000000000' });
  });

  it('keeps academy_admin immutable and the metadata of other system roles seed-owned (AC 2)', async () => {
    const adminId = await systemRoleId('academy_admin');
    for (const body of [{ permissions: ['users.read'] }, { label: { ar: 'x' } }, { description: null }, { permissions: PERMISSION_KEYS }]) {
      const res = await api().patch(`${ROLES}/${adminId}`).set(bearer('superuser')).send(body);
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect(res.body).toMatchObject({ code: 'role_immutable', key: 'academy_admin' });
    }
    expect(await grantsOf(adminId)).toEqual(sorted(PERMISSION_KEYS));
    expect(await allEvents(adminId)).toHaveLength(0);

    const teacherId = await systemRoleId('teacher');
    const label = await api().patch(`${ROLES}/${teacherId}`).set(bearer('superuser')).send({ label: { ar: 'معلم جديد' } }).expect(403);
    expect(label.body).toMatchObject({ code: 'role_immutable', key: 'teacher', fields: ['label'] });
    const both = await api()
      .patch(`${ROLES}/${teacherId}`)
      .set(bearer('superuser'))
      .send({ label: { ar: 'x' }, description: null, permissions: ['users.read'] })
      .expect(403);
    expect(both.body).toMatchObject({ code: 'role_immutable', key: 'teacher', fields: ['label', 'description'] });
    const teacher = await prisma.role.findUniqueOrThrow({ where: { id: teacherId }, select: { label: true } });
    expect((teacher.label as { ar: string }).ar).toBe('معلم');
    expect(await allEvents(teacherId)).toHaveLength(0);
  });

  it('applies a permission change to the role’s holders on their next request without a new login (AC 4)', async () => {
    const id = roleIds['live']!;
    const url = `${ROLES}/${id}`;
    await api().get('/api/users?limit=1').set(bearer('holder')).expect(200);
    expect((await api().get('/api/audit-logs?limit=1').set(bearer('holder')).expect(403)).body.missing).toEqual(['audit.read']);

    await api().patch(url).set(bearer('superuser')).send({ permissions: ['users.read', 'audit.read'] }).expect(200);
    await api().get('/api/audit-logs?limit=1').set(bearer('holder')).expect(200);
    await api().get('/api/users?limit=1').set(bearer('holder')).expect(200);

    await api().patch(url).set(bearer('superuser')).send({ permissions: ['audit.read'] }).expect(200);
    expect((await api().get('/api/users?limit=1').set(bearer('holder')).expect(403)).body.missing).toEqual(['users.read']);
    await api().get('/api/audit-logs?limit=1').set(bearer('holder')).expect(200);
    expect(await events('roles.permissions.changed', id)).toHaveLength(2);
  });

  // ------------------------------------------------------------ delete

  it('deletes custom roles nobody holds with one roles.deleted event; system roles are 403 and granted roles 409 (AC 3)', async () => {
    for (const key of SYSTEM_ROLE_KEYS) {
      const res = await api().delete(`${ROLES}/${await systemRoleId(key)}`).set(bearer('superuser')).expect(403);
      expect(res.body).toMatchObject({ code: 'role_immutable', key });
    }
    expect(await prisma.role.count({ where: { isSystem: true } })).toBe(SYSTEM_ROLE_KEYS.length);

    const grantedId = roleIds['granted']!;
    const inUse = await api().delete(`${ROLES}/${grantedId}`).set(bearer('superuser')).expect(409);
    expect(inUse.body).toMatchObject({ code: 'role_in_use', key: `test_granted_${RUN}`, userCount: 1 });
    expect(await prisma.role.findUnique({ where: { id: grantedId } })).not.toBeNull();
    expect(await allEvents(grantedId)).toHaveLength(0);

    await prisma.userRole.deleteMany({ where: { roleId: grantedId } });
    await api().delete(`${ROLES}/${grantedId}`).set(bearer('superuser')).expect(204);
    expect(await prisma.role.findUnique({ where: { id: grantedId } })).toBeNull();
    expect(await prisma.rolePermission.count({ where: { roleId: grantedId } })).toBe(0);
    const deleted = await events('roles.deleted', grantedId);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]!.metadata).toEqual({ key: `test_granted_${RUN}`, permissions: ['courses.read'] });
    expect(deleted[0]!.actorUserId).toBe(fx['superuser']);
    expect(await allEvents(grantedId)).toHaveLength(1);

    expect((await api().delete(`${ROLES}/${grantedId}`).set(bearer('superuser')).expect(404)).body.code).toBe('role_unknown');
    expect((await api().patch(`${ROLES}/${grantedId}`).set(bearer('superuser')).send({ permissions: [] }).expect(404)).body.code).toBe('role_unknown');
    await api().delete(`${ROLES}/not-a-uuid`).set(bearer('superuser')).expect(400);
    const list = await api().get(ROLES).set(bearer('reader')).expect(200);
    expect((list.body.items as RoleItem[]).some((item) => item.id === grantedId)).toBe(false);
  });

  // ------------------------------------------------------------ seed

  it('re-seeding keeps an admin’s permission edits on system roles other than academy_admin (AC 5)', async () => {
    const guardianId = await systemRoleId('guardian');
    const defaults = sorted(systemRolePermissions('guardian'));
    expect(await grantsOf(guardianId)).toEqual(defaults);
    const edited = sorted([...defaults.filter((key) => key !== 'invoices.read_linked'), 'certificates.read_own']);
    try {
      const res = await api().patch(`${ROLES}/${guardianId}`).set(bearer('superuser')).send({ permissions: edited }).expect(200);
      expect(res.body.permissions).toEqual(edited);
      const changed = await events('roles.permissions.changed', guardianId);
      expect(changed.at(-1)!.metadata).toEqual({ key: 'guardian', added: ['certificates.read_own'], removed: ['invoices.read_linked'], fields: [] });

      const summary = await prisma.$transaction((tx) => seedCatalog(tx));
      expect(summary.roles.created).toEqual([]);
      expect(summary.rolePermissions.added).toBe(0);
      expect(await grantsOf(guardianId)).toEqual(edited);
      expect(await grantsOf(await systemRoleId('academy_admin'))).toEqual(sorted(PERMISSION_KEYS));
      const list = await api().get(ROLES).set(bearer('reader')).expect(200);
      expect((list.body.items as RoleItem[]).find((item) => item.key === 'guardian')!.permissions).toEqual(edited);
    } finally {
      await prisma.$transaction([
        prisma.rolePermission.deleteMany({ where: { roleId: guardianId } }),
        prisma.rolePermission.createMany({ data: defaults.map((permissionKey) => ({ roleId: guardianId, permissionKey })) }),
      ]);
    }
    expect(await grantsOf(guardianId)).toEqual(defaults);
  });

  // ------------------------------------------------------------ cross-cutting

  it('checks the Origin of writing requests and documents the five routes in OpenAPI', async () => {
    const evil = await api()
      .post(ROLES)
      .set(bearer('superuser'))
      .set('Origin', 'https://evil.example')
      .send({ key: `test_csrf_${RUN}`, label: { ar: 'x' }, permissions: [] });
    expect(evil.status).toBe(403);
    expect(evil.body.code).toBe('origin_forbidden');
    expect(await prisma.role.findUnique({ where: { key: `test_csrf_${RUN}` } })).toBeNull();

    const docs = await api().get('/api/docs-json').expect(200);
    expect(Object.keys(docs.body.paths['/api/roles']).sort()).toEqual(['get', 'post']);
    expect(Object.keys(docs.body.paths['/api/roles/{id}']).sort()).toEqual(['delete', 'patch']);
    expect(Object.keys(docs.body.paths['/api/permissions'])).toEqual(['get']);
    expect(docs.body.paths['/api/roles'].post.responses).toHaveProperty('409');
    expect(docs.body.paths['/api/roles/{id}'].delete.responses).toHaveProperty('204');
    expect(docs.body.paths['/api/roles'].get.security).toEqual([{ bearer: [] }]);
  });
});
