// TEST-030 — MOD-03-T10 audit coverage of every writer route of T02..T09 and
// the filters of GET /api/audit-logs (API-011) against the live development
// database. Skipped when no database is reachable. Fixtures carry a unique
// suffix and are deleted at the end (their audit rows stay with a NULL actor —
// the log is append-only by design, KI-032).
//
// Counting strategy: events are read back by actor. Every actor here is a
// fixture of this run, so events written meanwhile by other clients of the
// shared development database (another session's dev server, another e2e
// file) never land in the counts.
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { assertNoSecrets } from '../src/audit/audit.service.js';
import { PasswordService } from '../src/auth/password.service.js';
import { PERMISSION_KEYS } from '../src/authorization/permission-catalog.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const INVITE_PASSWORD = 'Invited-Horse-Battery-7';
const RESET_PASSWORD = 'Reset-Horse-Battery-8';
const USER_AGENT = 'TEST-030 supertest';
const USERS = '/api/users';
const AUDIT = '/api/audit-logs';
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

interface Item {
  id: string;
  action: string;
  actorUserId: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface ExpectedEvent {
  action: string;
  actorUserId: string;
  entityType?: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}

describe.skipIf(!available)('MOD-03-T10 audit coverage and audit-log filters (e2e, TEST-030)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  const fx: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  /** One-time tokens handed over by the API — must never appear in the log. */
  const secrets: string[] = [PASSWORD, INVITE_PASSWORD, RESET_PASSWORD];
  let customRoleId = '';

  // E-mail addresses are stored lower-case (CHECK ck_users_email_lowercase).
  const email = (name: string) => `${name.toLowerCase()}-${RUN}@example.test`;
  const api = () => request(app.getHttpServer());
  const bearer = (name: string) => ({ Authorization: `Bearer ${tokens[name]}`, 'User-Agent': USER_AGENT });
  const anonymous = () => ({ 'User-Agent': USER_AGENT });
  const actors = () => Object.values(fx);

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

  async function createUser(name: string, roleIds: string[] = []): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: email(name),
        fullName: `Test ${name}`,
        passwordHash: await passwords.hash(PASSWORD),
        status: 'active',
        roles: roleIds.length > 0 ? { create: roleIds.map((roleId) => ({ roleId })) } : undefined,
      },
      select: { id: true },
    });
    createdUserIds.push(user.id);
    fx[name] = user.id;
    return user.id;
  }

  async function login(identifier: string, password = PASSWORD): Promise<string> {
    const res = await api().post('/api/auth/login').set(anonymous()).send({ identifier, password }).expect(200);
    return res.body.accessToken as string;
  }

  /** Id of the newest event (UUIDv7 = insertion order); events of a step are those above it. */
  async function mark(): Promise<string> {
    const latest = await prisma.auditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    return latest?.id ?? NIL_ID;
  }

  const since = (markId: string) =>
    prisma.auditLog.findMany({ where: { id: { gt: markId }, actorUserId: { in: actors() } }, orderBy: { id: 'asc' } });

  /** The step wrote exactly the expected events (in order) by the fixture actors — and nothing else. */
  async function expectEvents(markId: string, expected: ExpectedEvent[]): Promise<void> {
    const rows = await since(markId);
    expect(rows.map((row) => row.action)).toEqual(expected.map((event) => event.action));
    rows.forEach((row, index) => {
      const want = expected[index]!;
      expect(row.actorUserId).toBe(want.actorUserId);
      expect(row.entityType).toBe(want.entityType ?? 'users');
      expect(row.entityId).toBe(want.entityId);
      if (want.metadata) expect(row.metadata).toMatchObject(want.metadata);
      // requestContext() reached the event: the loopback peer and the agent header sent by this suite.
      expect(row.ipAddress).toMatch(/127\.0\.0\.1|::1/);
      expect(row.userAgent).toBe(USER_AGENT);
    });
  }

  const listAs = (caller: string, query: string) => api().get(`${AUDIT}?${query}`).set(bearer(caller));
  const items = async (caller: string, query: string): Promise<{ items: Item[]; nextCursor: string | null }> =>
    (await listAs(caller, query).expect(200)).body;
  const dbIds = async (where: Record<string, unknown>) =>
    (await prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, select: { id: true } })).map((row) => row.id);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    const superuser = await createRole('superuser', PERMISSION_KEYS);
    const auditor = await createRole('auditor', ['audit.read']);
    await createUser('admin', [superuser]);
    await createUser('auditor', [auditor]);
    await createUser('plain');
    for (const name of ['admin', 'auditor', 'plain']) tokens[name] = await login(email(name));
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('T02 — POST /api/users records exactly one users.created per account, inside its transaction', async () => {
    for (const [name, kind] of [
      ['teacher', 'teacher'],
      ['student', 'student'],
      ['guardian', 'guardian'],
    ] as const) {
      const m = await mark();
      const res = await api().post(USERS).set(bearer('admin')).send({ kind, email: email(name), fullName: `T10 ${name}` });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      fx[name] = res.body.id;
      createdUserIds.push(res.body.id);
      await expectEvents(m, [
        {
          action: 'users.created',
          actorUserId: fx['admin']!,
          entityId: res.body.id,
          metadata: { kind, roles: [kind], profile: kind === 'guardian' ? null : kind === 'student' ? 'student' : 'employee' },
        },
      ]);
    }
  });

  it('T03 — the invitation is issued (one event by the issuer) and accepted (acceptance + session by the invitee)', async () => {
    const issued = await mark();
    const invitation = await api().post(`${USERS}/${fx['teacher']}/invitations`).set(bearer('admin')).expect(201);
    secrets.push(invitation.body.token, invitation.body.link);
    await expectEvents(issued, [
      {
        action: 'users.invitation.issued',
        actorUserId: fx['admin']!,
        entityId: fx['teacher']!,
        metadata: { roles: ['teacher'], superseded: 0 },
      },
    ]);

    const accepted = await mark();
    await api()
      .post(`/api/account/invitations/${invitation.body.token}/accept`)
      .set(anonymous())
      .send({ password: INVITE_PASSWORD })
      .expect(200);
    await expectEvents(accepted, [
      { action: 'users.invitation.accepted', actorUserId: fx['teacher']!, entityId: fx['teacher']!, metadata: { roles: ['teacher'] } },
      { action: 'auth.login.succeeded', actorUserId: fx['teacher']!, entityId: fx['teacher']!, metadata: { via: 'invitation' } },
    ]);
  });

  it('T04 — PATCH /api/users/:id records one users.updated carrying field names only', async () => {
    const m = await mark();
    await api().patch(`${USERS}/${fx['teacher']}`).set(bearer('admin')).send({ displayName: 'Audited Teacher' }).expect(200);
    await expectEvents(m, [
      { action: 'users.updated', actorUserId: fx['admin']!, entityId: fx['teacher']!, metadata: { fields: ['displayName'] } },
    ]);
  });

  it('T05 — the reset is issued (one event by the issuer) and confirmed (reset + session by the account holder)', async () => {
    const issued = await mark();
    const reset = await api().post(`${USERS}/${fx['teacher']}/password-reset`).set(bearer('admin')).expect(201);
    secrets.push(reset.body.token, reset.body.link);
    await expectEvents(issued, [
      {
        action: 'users.password_reset.issued',
        actorUserId: fx['admin']!,
        entityId: fx['teacher']!,
        metadata: { via: 'admin', superseded: 0 },
      },
    ]);

    const confirmed = await mark();
    await api()
      .post(`/api/account/password-reset/${reset.body.token}/confirm`)
      .set(anonymous())
      .send({ newPassword: RESET_PASSWORD })
      .expect(200);
    await expectEvents(confirmed, [
      { action: 'auth.password.reset', actorUserId: fx['teacher']!, entityId: fx['teacher']!, metadata: { revokedSessions: 1 } },
      { action: 'auth.login.succeeded', actorUserId: fx['teacher']!, entityId: fx['teacher']!, metadata: { via: 'password_reset' } },
    ]);
  });

  it('T08 — role create, label update, permission replacement and delete record one event each', async () => {
    const key = `test_t10_${RUN}`;
    let m = await mark();
    const created = await api()
      .post('/api/roles')
      .set(bearer('admin'))
      .send({ key, label: { ar: 'دور T10' }, permissions: ['courses.read'] })
      .expect(201);
    customRoleId = created.body.id;
    createdRoleIds.push(customRoleId);
    await expectEvents(m, [
      { action: 'roles.created', actorUserId: fx['admin']!, entityType: 'roles', entityId: customRoleId, metadata: { key, permissions: ['courses.read'] } },
    ]);

    m = await mark();
    await api().patch(`/api/roles/${customRoleId}`).set(bearer('admin')).send({ label: { ar: 'دور T10 معدَّل' } }).expect(200);
    await expectEvents(m, [
      { action: 'roles.updated', actorUserId: fx['admin']!, entityType: 'roles', entityId: customRoleId, metadata: { key, fields: ['label'] } },
    ]);

    m = await mark();
    await api().patch(`/api/roles/${customRoleId}`).set(bearer('admin')).send({ permissions: ['courses.read', 'users.read'] }).expect(200);
    await expectEvents(m, [
      {
        action: 'roles.permissions.changed',
        actorUserId: fx['admin']!,
        entityType: 'roles',
        entityId: customRoleId,
        metadata: { key, added: ['users.read'], removed: [], fields: [] },
      },
    ]);

    m = await mark();
    await api().delete(`/api/roles/${customRoleId}`).set(bearer('admin')).expect(204);
    await expectEvents(m, [
      {
        action: 'roles.deleted',
        actorUserId: fx['admin']!,
        entityType: 'roles',
        entityId: customRoleId,
        metadata: { key, permissions: ['courses.read', 'users.read'] },
      },
    ]);
  });

  it('rejected and invalid requests record nothing — validation, constraint, permission, business-rule failures', async () => {
    const m = await mark();
    await api().post(USERS).set(bearer('admin')).send({ kind: 'teacher' }).expect(400);
    expect((await api().post(USERS).set(bearer('admin')).send({ kind: 'guardian', email: email('teacher'), fullName: 'Dup' }).expect(409)).body.code).toBe(
      'email_in_use',
    );
    expect((await api().patch(`${USERS}/${fx['teacher']}`).set(bearer('admin')).send({}).expect(400)).body.code).toBe('nothing_to_update');
    expect((await api().post('/api/roles').set(bearer('plain')).send({ key: `test_denied_${RUN}`, label: { ar: 'x' }, permissions: [] }).expect(403)).body.code).toBe(
      'permission_denied',
    );
    expect(
      (await api().post(`${USERS}/${fx['student']}/guardians`).set(bearer('admin')).send({ guardianId: fx['plain'], relationship: 'other' }).expect(422)).body
        .code,
    ).toBe('not_a_guardian');
    expect((await api().post(`${USERS}/${fx['teacher']}/status`).set(bearer('admin')).send({ action: 'activate' }).expect(409)).body.code).toBe(
      'invalid_transition',
    );
    await api().put(`${USERS}/${fx['teacher']}/roles`).set(bearer('admin')).send({ roleKeys: ['no_such_role'] }).expect(400);
    await listAs('admin', 'limit=5').expect(200);
    expect(await since(m)).toEqual([]);
  });

  it('T07 — PUT /api/users/:id/roles records one users.roles.changed with the diff', async () => {
    const m = await mark();
    await api().put(`${USERS}/${fx['teacher']}/roles`).set(bearer('admin')).send({ roleKeys: ['teacher', 'guardian'] }).expect(200);
    await expectEvents(m, [
      {
        action: 'users.roles.changed',
        actorUserId: fx['admin']!,
        entityId: fx['teacher']!,
        metadata: { added: ['guardian'], removed: [], roles: ['guardian', 'teacher'] },
      },
    ]);
  });

  it('T09 — guardian link, update and unlink record one event each on the student', async () => {
    let m = await mark();
    await api()
      .post(`${USERS}/${fx['student']}/guardians`)
      .set(bearer('admin'))
      .send({ guardianId: fx['guardian'], relationship: 'father', isPrimary: true })
      .expect(201);
    await expectEvents(m, [
      {
        action: 'guardians.linked',
        actorUserId: fx['admin']!,
        entityId: fx['student']!,
        metadata: { guardianUserId: fx['guardian'], studentUserId: fx['student'], relationship: 'father', isPrimary: true },
      },
    ]);

    m = await mark();
    await api().patch(`${USERS}/${fx['student']}/guardians/${fx['guardian']}`).set(bearer('admin')).send({ relationship: 'mother' }).expect(200);
    await expectEvents(m, [
      {
        action: 'guardians.updated',
        actorUserId: fx['admin']!,
        entityId: fx['student']!,
        metadata: { guardianUserId: fx['guardian'], relationship: 'mother', isPrimary: true, fields: ['relationship'] },
      },
    ]);

    m = await mark();
    await api().delete(`${USERS}/${fx['student']}/guardians/${fx['guardian']}`).set(bearer('admin')).expect(204);
    await expectEvents(m, [
      {
        action: 'guardians.unlinked',
        actorUserId: fx['admin']!,
        entityId: fx['student']!,
        metadata: { guardianUserId: fx['guardian'], relationship: 'mother', isPrimary: true },
      },
    ]);
  });

  it('T06 — suspend records one users.status.changed, soft delete one users.deleted', async () => {
    let m = await mark();
    await api().post(`${USERS}/${fx['teacher']}/status`).set(bearer('admin')).send({ action: 'suspend', reason: 'T10 coverage' }).expect(200);
    await expectEvents(m, [
      {
        action: 'users.status.changed',
        actorUserId: fx['admin']!,
        entityId: fx['teacher']!,
        metadata: { action: 'suspend', from: 'active', to: 'suspended', reason: 'T10 coverage', revokedSessions: 1 },
      },
    ]);

    m = await mark();
    await api().delete(`${USERS}/${fx['guardian']}`).set(bearer('admin')).send({ reason: 'T10 coverage' }).expect(200);
    await expectEvents(m, [
      {
        action: 'users.deleted',
        actorUserId: fx['admin']!,
        entityId: fx['guardian']!,
        metadata: { action: 'delete', from: 'invited', to: 'archived', reason: 'T10 coverage' },
      },
    ]);
  });

  it('filters by actor, action prefix (literal, `_` is no wildcard) and entity — audit.read alone suffices', async () => {
    const admin = fx['admin']!;
    const byActor = await items('auditor', `actorUserId=${admin}`);
    expect(byActor.items.length).toBeGreaterThanOrEqual(17);
    expect(byActor.items.map((item) => item.id)).toEqual(await dbIds({ actorUserId: admin }));
    expect(byActor.items.every((item) => item.actorUserId === admin)).toBe(true);
    expect(byActor.nextCursor).toBeNull();

    const usersEvents = await items('auditor', `actorUserId=${admin}&action=users.`);
    expect(usersEvents.items.length).toBeGreaterThan(0);
    expect(usersEvents.items.every((item) => item.action.startsWith('users.'))).toBe(true);
    expect(usersEvents.items.map((item) => item.id)).toEqual(await dbIds({ actorUserId: admin, action: { startsWith: 'users.' } }));

    const exact = await items('auditor', `actorUserId=${admin}&action=users.status.changed`);
    expect(exact.items.map((item) => item.action)).toEqual(['users.status.changed']);

    // Unescaped, `users_` would be the LIKE pattern `users_%` and match every `users.` event (KI-034).
    expect((await items('auditor', `actorUserId=${admin}&action=users_`)).items).toEqual([]);

    const teacher = await items('auditor', `entityType=users&entityId=${fx['teacher']}`);
    expect(teacher.items.map((item) => item.id)).toEqual(await dbIds({ entityType: 'users', entityId: fx['teacher'] }));
    expect(new Set(teacher.items.map((item) => item.actorUserId))).toEqual(new Set([admin, fx['teacher']]));
    expect(teacher.items.map((item) => item.action)).toEqual(
      expect.arrayContaining(['users.created', 'users.invitation.issued', 'users.invitation.accepted', 'auth.login.succeeded', 'users.status.changed']),
    );

    const roles = await items('auditor', `entityType=roles&entityId=${customRoleId}&action=roles.`);
    expect(roles.items.map((item) => item.action)).toEqual(['roles.deleted', 'roles.permissions.changed', 'roles.updated', 'roles.created']);

    expect((await items('auditor', `entityType=roles&entityId=${fx['teacher']}`)).items).toEqual([]);
  });

  it('paginates exactly with the keyset cursor — no duplicate and no gap even for events written in the same millisecond (KI-042)', async () => {
    const admin = fx['admin']!;
    const expected = await dbIds({ actorUserId: admin });

    const collected: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: { items: Item[]; nextCursor: string | null } = await items('auditor', `actorUserId=${admin}&limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      expect(page.items).toHaveLength(1);
      collected.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages <= expected.length + 1);
    expect(collected).toEqual(expected);
    expect(new Set(collected).size).toBe(expected.length);

    const first = await items('auditor', `actorUserId=${admin}&action=roles.&limit=3`);
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).toBe(first.items[2]!.id);
    const second = await items('auditor', `actorUserId=${admin}&action=roles.&limit=3&cursor=${first.nextCursor}`);
    expect(second.items.map((item) => item.action)).toEqual(['roles.created']);
    expect(second.nextCursor).toBeNull();

    // The full page gives no cursor when nothing older exists.
    const all = await items('auditor', `actorUserId=${admin}&action=roles.&limit=4`);
    expect(all.items).toHaveLength(4);
    expect(all.nextCursor).toBeNull();

    // `before` stays a plain time bound.
    expect((await items('auditor', `actorUserId=${admin}&before=1970-01-02T00:00:00.000Z`)).items).toEqual([]);
    const future = new Date(Date.now() + 60_000).toISOString();
    expect((await items('auditor', `actorUserId=${admin}&before=${future}`)).items.map((item) => item.id)).toEqual(expected);
  });

  it('rejects malformed filters, unknown parameters and entityId without entityType with 400; 403 without audit.read', async () => {
    for (const query of [
      'actorUserId=not-a-uuid',
      'action=Users.',
      'action=users%25',
      'action=.users',
      'entityType=Users',
      `entityId=${fx['teacher']}`,
      'cursor=garbage',
      'limit=0',
      'limit=201',
      'limit=abc',
      'before=yesterday',
      'unknown=1',
    ]) {
      const res = await listAs('auditor', query);
      expect(res.status, query).toBe(400);
    }
    const pairing = await listAs('auditor', `entityId=${fx['teacher']}`).expect(400);
    expect(JSON.stringify(pairing.body.message)).toContain('entityType is required when entityId is given');

    // Blank filters count as absent.
    await listAs('auditor', 'action=&actorUserId=&entityType=&entityId=&cursor=&limit=1').expect(200);

    expect((await listAs('plain', 'limit=1').expect(403)).body).toMatchObject({ code: 'permission_denied', missing: ['audit.read'] });
    await api().get(AUDIT).set(anonymous()).expect(401);
  });

  it('exposes no secret, token, link, password or contact data in any event of this run (assertNoSecrets + raw values)', async () => {
    const everything = [
      ...(await items('auditor', `actorUserId=${fx['admin']}&limit=200`)).items,
      ...(await items('auditor', `actorUserId=${fx['teacher']}&limit=200`)).items,
    ];
    expect(everything.length).toBeGreaterThanOrEqual(21);
    for (const item of everything) {
      expect(() => assertNoSecrets(item.metadata)).not.toThrow();
    }
    const serialized = JSON.stringify(everything);
    for (const secret of secrets) expect(serialized).not.toContain(secret);
    expect(serialized).not.toMatch(/\$argon2|example\.test|Audited Teacher|T10 teacher/);
    expect(serialized).not.toContain(`@`);
  });

  it(
    'documents the filters in OpenAPI',
    async () => {
      const res = await api().get('/api/docs-json').expect(200);
      const operation = res.body.paths[AUDIT]?.get;
      expect(operation).toBeDefined();
      expect(operation.security).toEqual([{ bearer: [] }]);
      const names = (operation.parameters as { name: string }[]).map((parameter) => parameter.name).sort();
      expect(names).toEqual(['action', 'actorUserId', 'before', 'cursor', 'entityId', 'entityType', 'limit']);
    },
    20_000,
  );
});
