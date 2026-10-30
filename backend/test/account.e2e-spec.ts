// TEST-020 — MOD-03-T03 invitations and account activation against the live
// development database: POST /api/users/:id/invitations (API-015),
// GET /api/account/invitations/:token (API-016) and
// POST /api/account/invitations/:token/accept (API-017); TEST-023 — MOD-03-T05
// password reset (API-019..API-021, nested block at the end). Skipped when no
// database is reachable. Fixtures carry a unique suffix and are deleted at the
// end (cascade removes roles, profiles, tokens and sessions; their audit rows
// stay — KI-032).
import { createHash } from 'node:crypto';
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
const NEW_PASSWORD = `Chosen-By-Invitee-${RUN}`;
const USERS = '/api/users';
const ACCOUNT = '/api/account/invitations';
/** base64url of 32 random bytes. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** No key of a response may look like a credential (the raw `token` is the documented exception). */
const SENSITIVE_KEY = /hash|password/i;
const INVITATION_TTL_MS = Number(process.env['AUTH_INVITATION_TTL_HOURS'] || 48) * 60 * 60 * 1000;

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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

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

function setCookieLines(res: SupertestResponse): string[] {
  const header = res.headers['set-cookie'];
  return Array.isArray(header) ? header : header ? [header] : [];
}

/** The refresh cookie value from a response, or undefined when absent. */
function refreshCookie(res: SupertestResponse): string | undefined {
  const line = setCookieLines(res).find((cookie) => cookie.startsWith(`${REFRESH_COOKIE_NAME}=`));
  if (!line) return undefined;
  const value = line.split(';')[0]!.slice(REFRESH_COOKIE_NAME.length + 1);
  return value.length > 0 ? value : undefined;
}

const systemRolePermissions = (key: string): readonly string[] => SYSTEM_ROLES.find((role) => role.key === key)!.permissions;

describe.skipIf(!available)('MOD-03-T03 invitations and account activation (e2e, TEST-020)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];
  /** Fixture name → user id. */
  const fx: Record<string, string> = {};
  /** Access tokens of the callers and the raw invitation tokens handed out during the run. */
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

  async function login(identifier: string, password = PASSWORD): Promise<string> {
    const res = await api().post('/api/auth/login').send({ identifier, password }).expect(200);
    return res.body.accessToken as string;
  }

  /** Creates an invitee exactly as an admin would (POST /api/users, T02). */
  async function createViaApi(caller: string, body: Record<string, unknown>): Promise<string> {
    const res = await api().post(USERS).set(bearer(caller)).send(body).expect(201);
    createdUserIds.push(res.body.id as string);
    return res.body.id as string;
  }

  const issue = (caller: string, userId: string) => api().post(`${USERS}/${userId}/invitations`).set(bearer(caller));
  const preview = (token: string) => api().get(`${ACCOUNT}/${token}`);
  const accept = (token: string, password: string) => api().post(`${ACCOUNT}/${token}/accept`).send({ password });
  const tokenRows = (userId: string) => prisma.verificationToken.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  const events = (entityId: string, action: string) =>
    prisma.auditLog.findMany({ where: { entityId, action }, orderBy: { createdAt: 'asc' } });
  const account = (id: string) => prisma.user.findUnique({ where: { id }, select: { status: true, passwordHash: true } });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();

    const superuser = await createRole('superuser', PERMISSION_KEYS);
    const registrar = await createRole('registrar', systemRolePermissions('staff'));
    await createUser('admin', { roleIds: [superuser] });
    await createUser('staffer', { roleIds: [registrar] });
    await createUser('plain');
    await createUser('suspended', { status: 'suspended' });
    await createUser('archived', { status: 'archived' });
    await createUser('deleted', { status: 'invited', withPassword: false, deletedAt: new Date() });
    for (const name of ['admin', 'staffer', 'plain']) tokens[name] = await login(email(name));

    fx['teacher'] = await createViaApi('admin', {
      kind: 'teacher',
      email: email('teacher'),
      fullName: 'Fixture Teacher',
      displayName: 'Ms. Teacher',
      locale: 'en',
    });
    fx['student'] = await createViaApi('admin', { kind: 'student', username: `fixture_student_${RUN}`, fullName: 'Fixture Student' });
    fx['manager'] = await createViaApi('admin', {
      kind: 'staff',
      email: email('manager'),
      fullName: 'Fixture Manager',
      roleKeys: ['academy_admin'],
    });
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('issuing needs a token, users.create, a UUID and an existing non-deleted user', async () => {
    expect((await api().post(`${USERS}/${fx['teacher']}/invitations`).expect(401)).body.code).toBe('unauthenticated');
    expect((await issue('plain', fx['teacher']!).expect(403)).body).toMatchObject({
      code: 'permission_denied',
      missing: ['users.create'],
    });
    await issue('admin', 'not-a-uuid').expect(400);
    expect((await issue('admin', '00000000-0000-7000-8000-000000000000').expect(404)).body.code).toBe('user_not_found');
    expect((await issue('admin', fx['deleted']!).expect(404)).body.code).toBe('user_not_found');
    expect(await tokenRows(fx['teacher']!)).toEqual([]);
  });

  it('issues a one-time token, stores only its hash and records one audit event without the token (AC 1)', async () => {
    const before = Date.now();
    const res = await issue('admin', fx['teacher']!).expect(201);
    const { userId, token, link, expiresAt, delivery } = res.body as {
      userId: string;
      token: string;
      link: string;
      expiresAt: string;
      delivery: { transport: string; status: string };
    };

    expect(userId).toBe(fx['teacher']);
    expect(token).toMatch(TOKEN_PATTERN);
    expect(link.endsWith(`/invite/${token}`)).toBe(true);
    expect(Math.abs(new Date(expiresAt).getTime() - before - INVITATION_TTL_MS)).toBeLessThan(60_000);
    // No mail provider before LR-01 (D-R08): nothing is sent, the link is handed over manually.
    expect(['none', 'log']).toContain(delivery.transport);
    expect(['skipped', 'logged']).toContain(delivery.status);
    expect([...collectKeys(res.body)].filter((key) => SENSITIVE_KEY.test(key))).toEqual([]);

    const rows = await tokenRows(fx['teacher']!);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      purpose: 'invitation',
      tokenHash: sha256(token),
      consumedAt: null,
      metadata: { roles: ['teacher'], issuedBy: fx['admin'] },
    });
    expect(rows[0]!.expiresAt.toISOString()).toBe(expiresAt);
    expect(JSON.stringify(rows)).not.toContain(token);

    const issued = await events(fx['teacher']!, 'users.invitation.issued');
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({
      actorUserId: fx['admin'],
      entityType: 'users',
      metadata: { roles: ['teacher'], superseded: 0, invitationId: rows[0]!.id },
    });
    const everything = JSON.stringify(await prisma.auditLog.findMany({ where: { entityId: fx['teacher']! } }));
    expect(everything).not.toContain(token);
    expect(everything).not.toContain(email('teacher'));
    expect(everything).not.toContain('/invite/');
    expect(await account(fx['teacher']!)).toEqual({ status: 'invited', passwordHash: null });
    tokens['teacherInvite1'] = token;
  });

  it('previews a usable invitation with masked identifiers; malformed or unknown tokens are 404', async () => {
    const res = await preview(tokens['teacherInvite1']!).expect(200);
    expect(res.body).toEqual({
      fullName: 'Fixture Teacher',
      displayName: 'Ms. Teacher',
      locale: 'en',
      email: 't***@example.test',
      username: null,
      roles: ['teacher'],
      expiresAt: expect.any(String),
    });
    expect((await preview('garbage').expect(404)).body.code).toBe('invitation_invalid');
    expect((await preview('A'.repeat(43)).expect(404)).body.code).toBe('invitation_invalid');
    expect((await accept('A'.repeat(43), NEW_PASSWORD).expect(404)).body.code).toBe('invitation_invalid');
  });

  it('a new invitation supersedes the pending one (AC 4)', async () => {
    const res = await issue('admin', fx['teacher']!).expect(201);
    const second = res.body.token as string;
    expect(second).not.toBe(tokens['teacherInvite1']);

    expect((await preview(tokens['teacherInvite1']!).expect(409)).body.code).toBe('invitation_consumed');
    expect((await accept(tokens['teacherInvite1']!, NEW_PASSWORD).expect(409)).body.code).toBe('invitation_consumed');
    await preview(second).expect(200);

    const rows = await tokenRows(fx['teacher']!);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.consumedAt).not.toBeNull();
    expect(rows[1]!.consumedAt).toBeNull();
    const issued = await events(fx['teacher']!, 'users.invitation.issued');
    expect(issued.map((event) => (event.metadata as { superseded: number }).superseded)).toEqual([0, 1]);
    expect(await account(fx['teacher']!)).toEqual({ status: 'invited', passwordHash: null });
    tokens['teacherInvite2'] = second;
  });

  it('refuses a weak password or an unknown body field without touching the token or the account', async () => {
    const token = tokens['teacherInvite2']!;
    await accept(token, 'short').expect(400);
    expect((await accept(token, ' '.repeat(12)).expect(400)).body).toMatchObject({ code: 'password_weak' });
    await api().post(`${ACCOUNT}/${token}/accept`).send({ password: NEW_PASSWORD, extra: 1 }).expect(400);

    expect((await tokenRows(fx['teacher']!))[1]!.consumedAt).toBeNull();
    expect(await account(fx['teacher']!)).toEqual({ status: 'invited', passwordHash: null });
    expect(await events(fx['teacher']!, 'users.invitation.accepted')).toEqual([]);
  });

  it('accepts: sets the password, activates the account and opens a session; the e-mail stays unverified (AC 5, 9)', async () => {
    const token = tokens['teacherInvite2']!;
    const res = await accept(token, NEW_PASSWORD).expect(200);
    expect(res.body).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: expect.any(Number),
      user: { id: fx['teacher'], status: 'active', roles: ['teacher'], mustChangePassword: false, email: email('teacher') },
    });
    expect(res.body.user.permissions).toContain('lessons.manage');
    expect(JSON.stringify(res.body)).not.toMatch(/\$argon2|Chosen-By/);
    const cookie = refreshCookie(res);
    expect(cookie).toBeDefined();
    const attributes = setCookieLines(res).find((line) => line.startsWith(`${REFRESH_COOKIE_NAME}=`)) ?? '';
    expect(attributes).toMatch(/HttpOnly/i);
    expect(attributes).toMatch(/SameSite=Strict/i);
    expect(attributes).toMatch(/Path=\/api\/auth/);

    // The session works like one opened by login, and so does the refresh cookie.
    const me = await api().get('/api/auth/me').set({ Authorization: `Bearer ${res.body.accessToken}` }).expect(200);
    expect(me.body).toMatchObject({ id: fx['teacher'], status: 'active', roles: ['teacher'] });
    const refreshed = await api().post('/api/auth/refresh').set('Cookie', `${REFRESH_COOKIE_NAME}=${cookie}`).expect(200);
    expect(refreshed.body.user.id).toBe(fx['teacher']);
    // And the chosen password signs in.
    expect(await login(email('teacher'), NEW_PASSWORD)).toEqual(expect.any(String));

    const user = await prisma.user.findUnique({ where: { id: fx['teacher']! } });
    expect(user).toMatchObject({ status: 'active', emailVerifiedAt: null, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null });
    expect(user!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user!.passwordChangedAt).not.toBeNull();
    expect(user!.lastLoginAt).not.toBeNull();
    const rows = await tokenRows(fx['teacher']!);
    expect(rows.every((row) => row.consumedAt !== null)).toBe(true);

    const accepted = await events(fx['teacher']!, 'users.invitation.accepted');
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ actorUserId: fx['teacher'], entityType: 'users', metadata: { roles: ['teacher'], invitationId: rows[1]!.id } });
    const logins = await events(fx['teacher']!, 'auth.login.succeeded');
    expect(logins.length).toBeGreaterThanOrEqual(2);
    expect(logins[0]!.metadata).toMatchObject({ via: 'invitation' });
    expect(JSON.stringify([...accepted, ...logins])).not.toMatch(/Chosen-By|\$argon2|token/i);
  });

  it('uses a token once: a second acceptance and later previews are 409, and an active account cannot be re-invited (AC 2)', async () => {
    expect((await accept(tokens['teacherInvite2']!, NEW_PASSWORD).expect(409)).body.code).toBe('invitation_consumed');
    expect((await preview(tokens['teacherInvite2']!).expect(409)).body.code).toBe('invitation_consumed');
    expect((await issue('admin', fx['teacher']!).expect(409)).body).toMatchObject({ code: 'user_not_invitable', status: 'active' });
    expect(await tokenRows(fx['teacher']!)).toHaveLength(2);
  });

  it('rejects an expired invitation and leaves the account untouched (AC 3); a username-only account gets no mail', async () => {
    const res = await issue('admin', fx['student']!).expect(201);
    expect(res.body.delivery.status).toBe('skipped');
    const token = res.body.token as string;
    await prisma.verificationToken.update({ where: { tokenHash: sha256(token) }, data: { expiresAt: new Date(Date.now() - 60_000) } });

    expect((await preview(token).expect(410)).body).toMatchObject({ code: 'invitation_expired', expiredAt: expect.any(String) });
    expect((await accept(token, NEW_PASSWORD).expect(410)).body.code).toBe('invitation_expired');
    expect(await account(fx['student']!)).toEqual({ status: 'invited', passwordHash: null });
    expect(await events(fx['student']!, 'users.invitation.accepted')).toEqual([]);

    // A fresh invitation replaces the expired one; the preview masks the username.
    const again = await issue('admin', fx['student']!).expect(201);
    const view = await preview(again.body.token as string).expect(200);
    expect(view.body).toMatchObject({ fullName: 'Fixture Student', email: null, username: 'fi***', roles: ['student'] });
  });

  it('invites only accounts awaiting activation (AC 6)', async () => {
    for (const [name, status] of [
      ['suspended', 'suspended'],
      ['archived', 'archived'],
      ['plain', 'active'],
    ] as const) {
      expect((await issue('admin', fx[name]!).expect(409)).body).toMatchObject({ code: 'user_not_invitable', status });
      expect(await tokenRows(fx[name]!)).toEqual([]);
      expect(await events(fx[name]!, 'users.invitation.issued')).toEqual([]);
    }
  });

  it('applies the no-exceeding rule to the issuer (SEC-R-13, AC 8)', async () => {
    const teacher = await createViaApi('admin', { kind: 'teacher', email: email('teacher2'), fullName: 'Fixture Teacher Two' });

    const denied = await issue('staffer', teacher).expect(403);
    expect(denied.body.code).toBe('permission_denied');
    expect(denied.body.missing).toContain('lessons.manage');
    expect(denied.body.missing).not.toContain('users.read');
    expect(denied.body.missing).toEqual([...denied.body.missing].sort());
    expect(await tokenRows(teacher)).toEqual([]);
    expect(await events(teacher, 'users.invitation.issued')).toEqual([]);

    const adminDenied = await issue('staffer', fx['manager']!).expect(403);
    expect(adminDenied.body.missing).toContain('roles.manage');

    // The learner baseline and a same-level staff account are within the staffer's reach.
    await issue('staffer', fx['student']!).expect(201);
    const clerk = await createViaApi('admin', { kind: 'staff', email: email('clerk'), fullName: 'Fixture Clerk' });
    await issue('staffer', clerk).expect(201);
    // The admin may invite the admin-to-be and the teacher.
    await issue('admin', fx['manager']!).expect(201);
    await issue('admin', teacher).expect(201);
  });

  it('public routes check the Origin and rate-limit acceptance attempts per IP (AC 7)', async () => {
    const token = 'B'.repeat(43);
    const foreign = await api()
      .post(`${ACCOUNT}/${token}/accept`)
      .set('Origin', 'https://evil.example')
      .send({ password: NEW_PASSWORD })
      .expect(403);
    expect(foreign.body.code).toBe('origin_forbidden');

    let limited = false;
    for (let attempt = 0; attempt < 25 && !limited; attempt += 1) {
      const res = await accept(token, NEW_PASSWORD);
      if (res.status === 429) {
        expect(res.body.code).toBe('rate_limited');
        limited = true;
      } else {
        expect(res.status).toBe(404);
      }
    }
    expect(limited).toBe(true);
  });

  // 20 s: the first OpenAPI build can exceed Vitest's 5 s under parallel e2e load (KI-040).
  it(
    'documents the three routes in the OpenAPI document',
    async () => {
      const doc = await api().get('/api/docs-json').expect(200);
      const paths = doc.body.paths as Record<string, Record<string, { security?: unknown[] }>>;
      expect(Object.keys(paths)).toEqual(
        expect.arrayContaining(['/api/users/{id}/invitations', '/api/account/invitations/{token}', '/api/account/invitations/{token}/accept']),
      );
      expect(paths['/api/users/{id}/invitations']!['post']!.security).toEqual([{ bearer: [] }]);
      expect(paths['/api/account/invitations/{token}']!['get']!.security).toBeUndefined();
      expect(paths['/api/account/invitations/{token}/accept']!['post']!.security).toBeUndefined();
    },
    20_000,
  );

  // TEST-023 — MOD-03-T05 password reset: POST /api/users/:id/password-reset
  // (API-019), POST /api/account/password-reset/:token/confirm (API-020) and
  // the disabled self-service request POST /api/account/password-reset/request
  // (API-021; the enabled path is password-reset.e2e-spec.ts).
  describe('password reset (T05, TEST-023)', () => {
    const RESET = '/api/account/password-reset';
    const RESET_PASSWORD = `Reset-By-Holder-${RUN}`;
    const RESET_TTL_MS = Number(process.env['AUTH_PASSWORD_RESET_TTL_MINUTES'] || 30) * 60 * 1000;

    const issueReset = (caller: string, userId: string) => api().post(`${USERS}/${userId}/password-reset`).set(bearer(caller));
    const confirm = (token: string, newPassword: string) => api().post(`${RESET}/${token}/confirm`).send({ newPassword });
    const requestReset = (identifier: unknown) => api().post(`${RESET}/request`).send({ identifier });
    const resetRows = (userId: string) =>
      prisma.verificationToken.findMany({ where: { userId, purpose: 'password_reset' }, orderBy: { createdAt: 'asc' } });
    const flags = (id: string) =>
      prisma.user.findUniqueOrThrow({
        where: { id },
        select: { mustChangePassword: true, failedLoginCount: true, lockedUntil: true, passwordChangedAt: true },
      });
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    /** The first session of the account whose password gets reset: access token + refresh cookie. */
    let oldSession: { accessToken: string; cookie: string };

    beforeAll(async () => {
      const teacherRole = await prisma.role.findUniqueOrThrow({ where: { key: 'teacher' }, select: { id: true } });
      const studentRole = await prisma.role.findUniqueOrThrow({ where: { key: 'student' }, select: { id: true } });
      const updater = await createRole('updater', ['users.update']);
      await createUser('updater', { roleIds: [updater] });
      tokens['updater'] = await login(email('updater'));

      await createUser('resettee', { roleIds: [teacherRole.id], displayName: 'Mr. Resettee', locale: 'en' });
      await createUser('learner', { roleIds: [studentRole.id] });
      await createUser('noroles');
      fx['invitedOne'] = await createViaApi('admin', { kind: 'student', email: email('invited-one'), fullName: 'Fixture Invited' });

      const first = await api().post('/api/auth/login').send({ identifier: email('resettee'), password: PASSWORD }).expect(200);
      oldSession = { accessToken: first.body.accessToken as string, cookie: refreshCookie(first)! };
    });

    it('issuing needs a token, users.update, a UUID and an existing non-deleted user', async () => {
      expect((await api().post(`${USERS}/${fx['resettee']}/password-reset`).expect(401)).body.code).toBe('unauthenticated');
      expect((await issueReset('plain', fx['resettee']!).expect(403)).body).toMatchObject({
        code: 'permission_denied',
        missing: ['users.update'],
      });
      await issueReset('admin', 'not-a-uuid').expect(400);
      expect((await issueReset('admin', '00000000-0000-7000-8000-000000000000').expect(404)).body.code).toBe('user_not_found');
      expect((await issueReset('admin', fx['deleted']!).expect(404)).body.code).toBe('user_not_found');
      expect(await resetRows(fx['resettee']!)).toEqual([]);
    });

    it('issues a one-time token, stores only its hash, flags the account and records one event without the token (AC 1, 5)', async () => {
      const before = Date.now();
      const res = await issueReset('admin', fx['resettee']!).expect(201);
      const { userId, token, link, expiresAt, delivery } = res.body as {
        userId: string;
        token: string;
        link: string;
        expiresAt: string;
        delivery: { transport: string; status: string };
      };

      expect(userId).toBe(fx['resettee']);
      expect(token).toMatch(TOKEN_PATTERN);
      expect(link.endsWith(`/reset-password/${token}`)).toBe(true);
      expect(Math.abs(new Date(expiresAt).getTime() - before - RESET_TTL_MS)).toBeLessThan(60_000);
      expect(['none', 'log']).toContain(delivery.transport);
      expect(['skipped', 'logged']).toContain(delivery.status);
      expect([...collectKeys(res.body)].filter((key) => SENSITIVE_KEY.test(key))).toEqual([]);

      const rows = await resetRows(fx['resettee']!);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ tokenHash: sha256(token), consumedAt: null, metadata: { via: 'admin', issuedBy: fx['admin'] } });
      expect(rows[0]!.expiresAt.toISOString()).toBe(expiresAt);
      expect(JSON.stringify(rows)).not.toContain(token);

      // The account is flagged, but nothing else changes: the existing session keeps working.
      expect(await flags(fx['resettee']!)).toMatchObject({ mustChangePassword: true, passwordChangedAt: null });
      const me = await api().get('/api/auth/me').set({ Authorization: `Bearer ${oldSession.accessToken}` }).expect(200);
      expect(me.body.mustChangePassword).toBe(true);

      const issued = await events(fx['resettee']!, 'users.password_reset.issued');
      expect(issued).toHaveLength(1);
      expect(issued[0]).toMatchObject({
        actorUserId: fx['admin'],
        entityType: 'users',
        metadata: { resetId: rows[0]!.id, via: 'admin', superseded: 0, expiresAt },
      });
      const everything = JSON.stringify(await prisma.auditLog.findMany({ where: { entityId: fx['resettee']! } }));
      expect(everything).not.toContain(token);
      expect(everything).not.toContain(email('resettee'));
      expect(everything).not.toContain('/reset-password/');
      tokens['reset1'] = token;
    });

    it('a new reset supersedes the pending one; the old link is simply invalid', async () => {
      const res = await issueReset('admin', fx['resettee']!).expect(201);
      const second = res.body.token as string;
      expect(second).not.toBe(tokens['reset1']);
      expect((await confirm(tokens['reset1']!, RESET_PASSWORD).expect(404)).body.code).toBe('reset_invalid');

      const rows = await resetRows(fx['resettee']!);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.consumedAt).not.toBeNull();
      expect(rows[1]!.consumedAt).toBeNull();
      const issued = await events(fx['resettee']!, 'users.password_reset.issued');
      expect(issued.map((event) => (event.metadata as { superseded: number }).superseded)).toEqual([0, 1]);
      tokens['reset2'] = second;
    });

    it('applies the no-exceeding rule to the issuer (SEC-R-15)', async () => {
      const denied = await issueReset('updater', fx['resettee']!).expect(403);
      expect(denied.body.code).toBe('permission_denied');
      expect(denied.body.missing).toContain('lessons.manage');
      expect(denied.body.missing).toEqual([...denied.body.missing].sort());
      expect(await resetRows(fx['resettee']!)).toHaveLength(2);
      expect(await events(fx['resettee']!, 'users.password_reset.issued')).toHaveLength(2);

      // The learner baseline and an account without roles are within the updater's reach.
      await issueReset('updater', fx['learner']!).expect(201);
      await issueReset('updater', fx['noroles']!).expect(201);
      expect((await resetRows(fx['learner']!))[0]!.metadata).toMatchObject({ via: 'admin', issuedBy: fx['updater'] });
    });

    it('resets only active accounts: invited, suspended and archived ones are 409 without a token', async () => {
      for (const [name, status] of [
        ['invitedOne', 'invited'],
        ['suspended', 'suspended'],
        ['archived', 'archived'],
      ] as const) {
        expect((await issueReset('admin', fx[name]!).expect(409)).body).toMatchObject({ code: 'user_not_resettable', status });
        expect(await resetRows(fx[name]!)).toEqual([]);
        expect(await events(fx[name]!, 'users.password_reset.issued')).toEqual([]);
      }
    });

    it('refuses a weak, unchanged or unknown-field body and malformed tokens without touching the token or the account', async () => {
      const token = tokens['reset2']!;
      await confirm(token, 'short').expect(400);
      expect((await confirm(token, ' '.repeat(12)).expect(400)).body).toMatchObject({ code: 'password_weak' });
      expect((await confirm(token, PASSWORD).expect(400)).body).toMatchObject({
        code: 'password_weak',
        problems: ['different from the current password'],
      });
      await api().post(`${RESET}/${token}/confirm`).send({ newPassword: RESET_PASSWORD, password: RESET_PASSWORD }).expect(400);
      expect((await confirm('garbage', RESET_PASSWORD).expect(404)).body.code).toBe('reset_invalid');
      expect((await confirm('A'.repeat(43), RESET_PASSWORD).expect(404)).body.code).toBe('reset_invalid');
      // An invitation token is not a reset token.
      expect((await confirm(tokens['teacherInvite2']!, RESET_PASSWORD).expect(404)).body.code).toBe('reset_invalid');

      expect((await resetRows(fx['resettee']!))[1]!.consumedAt).toBeNull();
      expect(await flags(fx['resettee']!)).toMatchObject({ mustChangePassword: true, passwordChangedAt: null });
      expect(await events(fx['resettee']!, 'auth.password.reset')).toEqual([]);
    });

    it('confirms: new password, account unlocked, every session revoked, older access tokens dead, fresh session opened (AC 2, 3)', async () => {
      // A locked account with a failed-login history, as after a forgotten password.
      await prisma.user.update({
        where: { id: fx['resettee']! },
        data: { failedLoginCount: 3, lockedUntil: new Date(Date.now() + 10 * 60 * 1000) },
      });
      // Access tokens carry `iat` in seconds: make sure the old one predates the change by a full second.
      await sleep(1100);

      const res = await confirm(tokens['reset2']!, RESET_PASSWORD).expect(200);
      expect(res.body).toMatchObject({
        tokenType: 'Bearer',
        expiresIn: expect.any(Number),
        user: { id: fx['resettee'], status: 'active', roles: ['teacher'], mustChangePassword: false, email: email('resettee') },
      });
      expect(JSON.stringify(res.body)).not.toMatch(/\$argon2|Reset-By/);
      const cookie = refreshCookie(res);
      expect(cookie).toBeDefined();
      const attributes = setCookieLines(res).find((line) => line.startsWith(`${REFRESH_COOKIE_NAME}=`)) ?? '';
      expect(attributes).toMatch(/HttpOnly/i);
      expect(attributes).toMatch(/SameSite=Strict/i);

      // The new session works; the old access token and the old cookie do not.
      await api().get('/api/auth/me').set({ Authorization: `Bearer ${res.body.accessToken}` }).expect(200);
      expect((await api().get('/api/auth/me').set({ Authorization: `Bearer ${oldSession.accessToken}` }).expect(401)).body.code).toBe('token_invalid');
      await api().post('/api/auth/refresh').set('Cookie', `${REFRESH_COOKIE_NAME}=${oldSession.cookie}`).expect(401);
      const refreshed = await api().post('/api/auth/refresh').set('Cookie', `${REFRESH_COOKIE_NAME}=${cookie}`).expect(200);
      expect(refreshed.body.user.id).toBe(fx['resettee']);
      // The new password signs in, the old one does not, and the lock is gone.
      expect((await api().post('/api/auth/login').send({ identifier: email('resettee'), password: PASSWORD }).expect(401)).body.code).toBe('invalid_credentials');
      expect(await login(email('resettee'), RESET_PASSWORD)).toEqual(expect.any(String));

      const user = await prisma.user.findUniqueOrThrow({ where: { id: fx['resettee']! } });
      expect(user).toMatchObject({ status: 'active', mustChangePassword: false, failedLoginCount: 0, lockedUntil: null });
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.passwordChangedAt).not.toBeNull();
      const rows = await resetRows(fx['resettee']!);
      expect(rows.every((row) => row.consumedAt !== null)).toBe(true);
      const families = await prisma.refreshToken.findMany({ where: { userId: fx['resettee']! }, select: { revokedAt: true } });
      // Sessions before the reset are revoked; only the one opened by the reset and the login just above survive.
      expect(families.filter((row) => row.revokedAt === null).length).toBeLessThanOrEqual(2);

      const reset = await events(fx['resettee']!, 'auth.password.reset');
      expect(reset).toHaveLength(1);
      expect(reset[0]).toMatchObject({ actorUserId: fx['resettee'], entityType: 'users', metadata: { resetId: rows[1]!.id } });
      expect((reset[0]!.metadata as { revokedSessions: number }).revokedSessions).toBeGreaterThanOrEqual(1);
      const logins = await events(fx['resettee']!, 'auth.login.succeeded');
      expect(logins.some((event) => (event.metadata as { via?: string }).via === 'password_reset')).toBe(true);
      expect(JSON.stringify([...reset, ...logins])).not.toMatch(/Reset-By|\$argon2|token/i);
    });

    it('uses a reset token once (AC 1)', async () => {
      expect((await confirm(tokens['reset2']!, `${RESET_PASSWORD}-again`).expect(404)).body.code).toBe('reset_invalid');
      expect(await resetRows(fx['resettee']!)).toHaveLength(2);
      expect(await events(fx['resettee']!, 'auth.password.reset')).toHaveLength(1);
    });

    it('rejects an expired reset and leaves the account untouched (AC 1)', async () => {
      const res = await issueReset('admin', fx['learner']!).expect(201);
      const token = res.body.token as string;
      await prisma.verificationToken.update({ where: { tokenHash: sha256(token) }, data: { expiresAt: new Date(Date.now() - 60_000) } });

      expect((await confirm(token, RESET_PASSWORD).expect(410)).body).toMatchObject({ code: 'reset_expired', expiredAt: expect.any(String) });
      expect(await flags(fx['learner']!)).toMatchObject({ mustChangePassword: true, passwordChangedAt: null });
      expect(await login(email('learner'))).toEqual(expect.any(String));
      expect(await events(fx['learner']!, 'auth.password.reset')).toEqual([]);
    });

    it('refuses the self-service request as a whole while it is disabled, and never creates a token (AC 4)', async () => {
      expect((await requestReset(email('resettee')).expect(403)).body.code).toBe('reset_disabled');
      expect((await requestReset(`nobody-${RUN}@example.test`).expect(403)).body.code).toBe('reset_disabled');
      await requestReset('').expect(400);
      await api().post(`${RESET}/request`).send({}).expect(400);
      expect(await resetRows(fx['resettee']!)).toHaveLength(2);
      expect(await events(fx['resettee']!, 'users.password_reset.issued')).toHaveLength(2);
    });

    it('public routes check the Origin and rate-limit confirmation attempts per IP', async () => {
      const token = 'C'.repeat(43);
      expect((await api().post(`${RESET}/${token}/confirm`).set('Origin', 'https://evil.example').send({ newPassword: RESET_PASSWORD }).expect(403)).body.code).toBe(
        'origin_forbidden',
      );
      expect((await api().post(`${RESET}/request`).set('Origin', 'https://evil.example').send({ identifier: 'x' }).expect(403)).body.code).toBe('origin_forbidden');

      let limited = false;
      for (let attempt = 0; attempt < 25 && !limited; attempt += 1) {
        const res = await confirm(token, RESET_PASSWORD);
        if (res.status === 429) {
          expect(res.body.code).toBe('rate_limited');
          limited = true;
        } else {
          expect(res.status).toBe(404);
        }
      }
      expect(limited).toBe(true);
    });

    it(
      'documents the three routes in the OpenAPI document',
      async () => {
        const doc = await api().get('/api/docs-json').expect(200);
        const paths = doc.body.paths as Record<string, Record<string, { security?: unknown[] }>>;
        expect(Object.keys(paths)).toEqual(
          expect.arrayContaining(['/api/users/{id}/password-reset', '/api/account/password-reset/request', '/api/account/password-reset/{token}/confirm']),
        );
        expect(paths['/api/users/{id}/password-reset']!['post']!.security).toEqual([{ bearer: [] }]);
        expect(paths['/api/account/password-reset/request']!['post']!.security).toBeUndefined();
        expect(paths['/api/account/password-reset/{token}/confirm']!['post']!.security).toBeUndefined();
      },
      20_000,
    );
  });
});
