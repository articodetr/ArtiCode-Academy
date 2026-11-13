// TEST-008 — MOD-01 authentication against the live development database.
// Skipped when no database is reachable. Fixture users are created with a
// unique suffix and deleted at the end (cascade removes their tokens; their
// audit rows stay, as the log is append-only by design).
import { randomBytes, randomInt } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { bootstrapFirstAdmin } from '../src/auth/bootstrap-admin.js';
import { REFRESH_COOKIE_NAME } from '../src/auth/cookies.js';
import { PasswordService } from '../src/auth/password.service.js';
import { uuidV7Time } from '../src/auth/refresh-family.js';
import { TokenService } from '../src/auth/token.service.js';
import { ACADEMY_ADMIN_ROLE_KEY } from '../src/authorization/system-roles.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { UserStatus } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const LOGIN = '/api/auth/login';

type SupertestTest = ReturnType<ReturnType<typeof request>['post']>;

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

/** The refresh cookie value from a response, or undefined when cleared/absent. */
function refreshCookie(res: SupertestResponse): string | undefined {
  const header = res.headers['set-cookie'];
  const cookies: string[] = Array.isArray(header) ? header : header ? [header] : [];
  const line = cookies.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE_NAME}=`));
  if (!line) return undefined;
  const value = line.split(';')[0]!.slice(REFRESH_COOKIE_NAME.length + 1);
  return value.length > 0 ? value : undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A UUIDv7 whose timestamp is `at` (RFC 9562 layout, random bits from crypto) — to make a family look older. */
function uuidV7At(at: Date): string {
  const random = (digits: number) => randomBytes(digits).toString('hex').slice(0, digits);
  const hex = `${at.getTime().toString(16).padStart(12, '0')}7${random(3)}${(8 + randomInt(4)).toString(16)}${random(15)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function cookieAttributes(res: SupertestResponse): string {
  const header = res.headers['set-cookie'];
  const cookies: string[] = Array.isArray(header) ? header : header ? [header] : [];
  return cookies.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE_NAME}=`)) ?? '';
}

describe.skipIf(!available)('MOD-01 authentication (e2e, TEST-008)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  const createdUserIds: string[] = [];
  const createdRoleIds: string[] = [];

  const email = (name: string) => `${name}-${RUN}@example.test`;

  async function createUser(
    name: string,
    options: { status?: UserStatus; password?: string | null; roleIds?: string[]; deleted?: boolean; username?: string } = {},
  ): Promise<{ id: string; email: string }> {
    const passwordHash = options.password === null ? null : await passwords.hash(options.password ?? PASSWORD);
    const user = await prisma.user.create({
      data: {
        email: email(name),
        username: options.username,
        fullName: `Test ${name}`,
        passwordHash,
        status: options.status ?? 'active',
        deletedAt: options.deleted ? new Date() : null,
        roles: options.roleIds ? { create: options.roleIds.map((roleId) => ({ roleId })) } : undefined,
      },
      select: { id: true, email: true },
    });
    createdUserIds.push(user.id);
    return { id: user.id, email: user.email! };
  }

  /** Not async on purpose: the returned supertest Test keeps its `.expect()` chain. */
  function login(identifier: string, password = PASSWORD): SupertestTest {
    return request(app.getHttpServer()).post(LOGIN).send({ identifier, password });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    if (createdRoleIds.length > 0) await prisma.role.deleteMany({ where: { id: { in: createdRoleIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('signs in with the e-mail, returns an access token and sets an httpOnly refresh cookie', async () => {
    const user = await createUser('login');
    const res = await login(user.email.toUpperCase()).expect(200);

    expect(res.body.tokenType).toBe('Bearer');
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.expiresIn).toBeGreaterThan(0);
    expect(res.body.user).toMatchObject({ id: user.id, email: user.email, status: 'active', roles: [], permissions: [] });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|refreshToken|tokenHash/);

    const attributes = cookieAttributes(res);
    expect(attributes).toMatch(/HttpOnly/i);
    expect(attributes).toMatch(/SameSite=Strict/i);
    expect(attributes).toMatch(/Path=\/api\/auth/);
    const cookie = refreshCookie(res)!;
    const stored = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).not.toBe(cookie);
    expect(stored[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    const refreshed = await prisma.user.findUnique({ where: { id: user.id } });
    expect(refreshed!.lastLoginAt).not.toBeNull();
  });

  it('signs in with a username too and rejects unknown fields (ValidationPipe)', async () => {
    await createUser('byname', { username: `student-${RUN}` });
    await login(`STUDENT-${RUN}`).expect(200);
    const res = await request(app.getHttpServer())
      .post(LOGIN)
      .send({ identifier: `student-${RUN}`, password: PASSWORD, extra: 'nope' })
      .expect(400);
    expect(res.body.message).toEqual(expect.arrayContaining([expect.stringMatching(/extra/)]));
  });

  it('rejects a wrong password and an unknown identifier with the same error', async () => {
    const user = await createUser('wrong');
    const wrong = await login(user.email, 'not-the-password').expect(401);
    expect(wrong.body.code).toBe('invalid_credentials');
    const unknown = await login(`nobody-${RUN}@example.test`).expect(401);
    expect(unknown.body.code).toBe('invalid_credentials');
    expect(unknown.body.message).toBe(wrong.body.message);
  });

  it('refuses suspended, pending, not-activated and soft-deleted accounts', async () => {
    const suspended = await createUser('suspended', { status: 'suspended' });
    expect((await login(suspended.email).expect(403)).body.code).toBe('account_suspended');

    const pending = await createUser('pending', { status: 'pending' });
    expect((await login(pending.email).expect(403)).body.code).toBe('account_pending');

    const invited = await createUser('invited', { status: 'invited', password: null });
    expect((await login(invited.email).expect(403)).body.code).toBe('account_not_activated');

    const deleted = await createUser('deleted', { deleted: true });
    expect((await login(deleted.email).expect(401)).body.code).toBe('invalid_credentials');

    const archived = await createUser('archived', { status: 'archived' });
    expect((await login(archived.email).expect(401)).body.code).toBe('invalid_credentials');
  });

  it('protects routes: no token, bad token and expired token are rejected; a valid one reaches /me', async () => {
    const user = await createUser('me');
    expect((await request(app.getHttpServer()).get('/api/auth/me').expect(401)).body.code).toBe('unauthenticated');
    expect(
      (await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', 'Bearer not.a.jwt').expect(401)).body.code,
    ).toBe('token_invalid');

    const tokens = app.get(TokenService);
    const expired = await tokens.signAccessToken({ userId: user.id, roles: [] }, -60);
    expect(
      (await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${expired.token}`).expect(401))
        .body.code,
    ).toBe('token_expired');

    const session = await login(user.email).expect(200);
    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${session.body.accessToken}`)
      .expect(200);
    expect(me.body).toMatchObject({ id: user.id, fullName: 'Test me', roles: [], permissions: [] });
    expect(me.body).not.toHaveProperty('passwordHash');

    // A valid token stops working once the account is suspended.
    await prisma.user.update({ where: { id: user.id }, data: { status: 'suspended' } });
    expect(
      (await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${session.body.accessToken}`).expect(403))
        .body.code,
    ).toBe('account_suspended');
  });

  it('enforces permissions: audit.read opens the audit log, its absence yields 403', async () => {
    const auditor = await prisma.role.create({
      data: { key: `test_auditor_${RUN}`, label: { ar: 'مدقق اختبار' }, permissions: { create: { permissionKey: 'audit.read' } } },
      select: { id: true },
    });
    createdRoleIds.push(auditor.id);
    const reader = await createUser('auditor', { roleIds: [auditor.id] });
    const plain = await createUser('plain');

    const plainSession = await login(plain.email).expect(200);
    const denied = await request(app.getHttpServer())
      .get('/api/audit-logs')
      .set('Authorization', `Bearer ${plainSession.body.accessToken}`)
      .expect(403);
    expect(denied.body).toMatchObject({ code: 'permission_denied', missing: ['audit.read'] });

    const readerSession = await login(reader.email).expect(200);
    expect(readerSession.body.user.permissions).toEqual(['audit.read']);
    const allowed = await request(app.getHttpServer())
      .get('/api/audit-logs?limit=20')
      .set('Authorization', `Bearer ${readerSession.body.accessToken}`)
      .expect(200);
    const mine = allowed.body.items.filter((item: { actorUserId: string | null }) => item.actorUserId === reader.id);
    expect(mine.some((item: { action: string }) => item.action === 'auth.login.succeeded')).toBe(true);
    // Event names such as `auth.password.changed` are fine; secrets and hashes are not.
    expect(JSON.stringify(allowed.body)).not.toMatch(/passwordHash|tokenHash|accessToken|\$argon2|Correct-Horse/);
  });

  it('rotates the refresh token and revokes the whole family when a retired token is replayed', async () => {
    const user = await createUser('rotate');
    const first = await login(user.email).expect(200);
    const cookieA = refreshCookie(first)!;

    const second = await request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', `${REFRESH_COOKIE_NAME}=${cookieA}`).expect(200);
    const cookieB = refreshCookie(second)!;
    expect(cookieB).not.toBe(cookieA);
    expect(second.body.accessToken).toBeTypeOf('string');
    expect(second.body.user.id).toBe(user.id);

    // Replaying A (already rotated) is reuse: the family dies, including B.
    const replay = await request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', `${REFRESH_COOKIE_NAME}=${cookieA}`).expect(401);
    expect(replay.body.code).toBe('refresh_reused');
    const afterReplay = await request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', `${REFRESH_COOKIE_NAME}=${cookieB}`).expect(401);
    expect(afterReplay.body.code).toBe('refresh_reused');

    const tokens = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(tokens).toHaveLength(2);
    expect(tokens.every((token) => token.revokedAt !== null)).toBe(true);
    expect(new Set(tokens.map((token) => token.familyId)).size).toBe(1);
    const reuseEvents = await prisma.auditLog.count({ where: { actorUserId: user.id, action: 'auth.refresh.reuse_detected' } });
    expect(reuseEvents).toBeGreaterThanOrEqual(1);

    expect((await request(app.getHttpServer()).post('/api/auth/refresh').expect(401)).body.code).toBe('refresh_missing');
    expect(
      (await request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', `${REFRESH_COOKIE_NAME}=forged`).expect(401)).body.code,
    ).toBe('refresh_invalid');
  });

  it('ends a session at its family deadline, whatever its token says (MOD-01-H03, TEST-065)', async () => {
    const tokens = app.get(TokenService);
    const refreshWith = (cookie: string) =>
      request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', `${REFRESH_COOKIE_NAME}=${cookie}`);
    const user = await createUser('family-cap');

    // At sign-in PostgreSQL generates the family id with uuidv7(): it carries the sign-in time.
    const before = Date.now();
    const first = await login(user.email).expect(200);
    const signedIn = await prisma.refreshToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(Math.abs(uuidV7Time(signedIn.familyId)!.getTime() - before)).toBeLessThan(60_000);
    expect(signedIn.expiresAt.getTime() - before).toBeGreaterThan(tokens.refreshTtlMs - 60_000);

    // Three days before the deadline: the rotation works, but the new token and its cookie stop at the deadline.
    const nearFamily = uuidV7At(new Date(Date.now() - tokens.refreshFamilyMaxMs + 3 * DAY_MS));
    await prisma.refreshToken.update({ where: { id: signedIn.id }, data: { familyId: nearFamily } });
    const rotated = await refreshWith(refreshCookie(first)!).expect(200);
    const next = await prisma.refreshToken.findFirstOrThrow({ where: { userId: user.id, revokedAt: null } });
    expect(next.familyId).toBe(nearFamily);
    expect(next.expiresAt.getTime()).toBe(tokens.familyDeadline(nearFamily)!.getTime());
    const maxAge = Number(/Max-Age=(\d+)/i.exec(cookieAttributes(rotated))?.[1]);
    expect(maxAge).toBeGreaterThan((3 * DAY_MS) / 1000 - 120);
    expect(maxAge).toBeLessThanOrEqual((3 * DAY_MS) / 1000);

    // Past the deadline: refused although the token itself is still valid, and that token is revoked.
    await prisma.refreshToken.update({ where: { id: next.id }, data: { familyId: uuidV7At(new Date(Date.now() - tokens.refreshFamilyMaxMs - DAY_MS)) } });
    expect(next.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect((await refreshWith(refreshCookie(rotated)!).expect(401)).body.code).toBe('refresh_expired');
    expect((await prisma.refreshToken.findUniqueOrThrow({ where: { id: next.id } })).revokedAt).not.toBeNull();
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(2);

    // A family id that is not a UUIDv7 has no known start: treated as expired (fail closed).
    const other = await login(user.email).expect(200);
    const otherRow = await prisma.refreshToken.findFirstOrThrow({ where: { userId: user.id, revokedAt: null } });
    await prisma.refreshToken.update({ where: { id: otherRow.id }, data: { familyId: '9b2f6a1e-4c3d-4f5a-8b6c-7d8e9f0a1b2c' } });
    expect((await refreshWith(refreshCookie(other)!).expect(401)).body.code).toBe('refresh_expired');
  });

  it('logs out of the current device and of all devices', async () => {
    const user = await createUser('logout');
    const sessionA = await login(user.email).expect(200);
    const cookieA = refreshCookie(sessionA)!;
    const logout = await request(app.getHttpServer()).post('/api/auth/logout').set('Cookie', `${REFRESH_COOKIE_NAME}=${cookieA}`).expect(204);
    expect(cookieAttributes(logout)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(
      (await request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', `${REFRESH_COOKIE_NAME}=${cookieA}`).expect(401)).body.code,
    ).toBe('refresh_reused');

    const sessionB = await login(user.email).expect(200);
    const sessionC = await login(user.email).expect(200);
    await request(app.getHttpServer())
      .post('/api/auth/logout-all')
      .set('Authorization', `Bearer ${sessionB.body.accessToken}`)
      .expect(204);
    for (const session of [sessionB, sessionC]) {
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE_NAME}=${refreshCookie(session)!}`)
        .expect(401);
    }
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect(await request(app.getHttpServer()).post('/api/auth/logout').expect(204));
  });

  it('changes the password, invalidates older access tokens and other sessions', async () => {
    const user = await createUser('password');
    const other = await login(user.email).expect(200);
    const current = await login(user.email).expect(200);
    const bearer = `Bearer ${current.body.accessToken}`;
    const cookie = `${REFRESH_COOKIE_NAME}=${refreshCookie(current)!}`;
    // `iat` has second precision: make sure the change lands in a later second than the tokens.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect(
      (await request(app.getHttpServer()).post('/api/auth/password').set('Authorization', bearer).set('Cookie', cookie)
        .send({ currentPassword: 'wrong-password', newPassword: 'Another-Good-Password-1' }).expect(400)).body.code,
    ).toBe('password_invalid');
    expect(
      (await request(app.getHttpServer()).post('/api/auth/password').set('Authorization', bearer).set('Cookie', cookie)
        .send({ currentPassword: PASSWORD, newPassword: 'short' }).expect(400)).body.message,
    ).toEqual(expect.arrayContaining([expect.stringMatching(/newPassword/)]));

    await request(app.getHttpServer()).post('/api/auth/password').set('Authorization', bearer).set('Cookie', cookie)
      .send({ currentPassword: PASSWORD, newPassword: 'Another-Good-Password-1' }).expect(204);

    // Old password gone, new one works.
    expect((await login(user.email, PASSWORD).expect(401)).body.code).toBe('invalid_credentials');
    await login(user.email, 'Another-Good-Password-1').expect(200);
    // The access token issued before the change is dead; the current cookie still refreshes.
    expect((await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', bearer).expect(401)).body.code).toBe('token_invalid');
    await request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', cookie).expect(200);
    // The other session was revoked.
    await request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', `${REFRESH_COOKIE_NAME}=${refreshCookie(other)!}`).expect(401);
  });

  it('locks the account after repeated failures and records the events', async () => {
    const user = await createUser('lockout');
    for (let attempt = 1; attempt < 5; attempt += 1) {
      expect((await login(user.email, 'wrong').expect(401)).body.code).toBe('invalid_credentials');
    }
    // The fifth failure locks immediately and says so.
    const locked = await login(user.email, 'wrong').expect(423);
    expect(locked.body.code).toBe('account_locked');
    expect(locked.body.retryAfterSeconds).toBeGreaterThan(0);
    // Even the right password is refused while locked.
    expect((await login(user.email).expect(423)).body.code).toBe('account_locked');

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row!.lockedUntil).not.toBeNull();
    const events = await prisma.auditLog.findMany({ where: { actorUserId: user.id }, select: { action: true, metadata: true } });
    expect(events.filter((event) => event.action === 'auth.login.failed')).toHaveLength(4);
    expect(events.filter((event) => event.action === 'auth.login.locked').length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(events)).not.toMatch(/wrong|password/i);

    // Clearing the lock restores access and resets the counter.
    await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: null } });
    await login(user.email).expect(200);
    expect((await prisma.user.findUnique({ where: { id: user.id } }))!.failedLoginCount).toBe(0);
  });

  it('rate-limits repeated login attempts per identifier', async () => {
    const identifier = `limited-${RUN}@example.test`;
    let last: SupertestResponse | undefined;
    for (let attempt = 1; attempt <= 11; attempt += 1) {
      last = await login(identifier, 'whatever');
      if (last.status === 429) break;
    }
    expect(last!.status).toBe(429);
    expect(last!.body.code).toBe('rate_limited');
    // Other identifiers from the same client are unaffected.
    expect((await login(`someone-else-${RUN}@example.test`, 'whatever')).status).toBe(401);
  });

  it('never rate-limits /me, logout and logout-all (KI-082: @SkipThrottle must name the "login" throttler)', async () => {
    const user = await createUser('unthrottled');
    const session = await login(user.email).expect(200);
    const bearer = `Bearer ${session.body.accessToken}`;
    // 12 > the "login" throttler's 10 per 15 minutes per client and route.
    for (let call = 1; call <= 12; call += 1) {
      const me = await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', bearer);
      expect(me.status, `GET /api/auth/me call ${call}`).toBe(200);
      const logout = await request(app.getHttpServer()).post('/api/auth/logout');
      expect(logout.status, `POST /api/auth/logout call ${call}`).toBe(204);
      const logoutAll = await request(app.getHttpServer()).post('/api/auth/logout-all').set('Authorization', bearer);
      expect(logoutAll.status, `POST /api/auth/logout-all call ${call}`).toBe(204);
    }
  });

  it('bootstraps the first academy admin at most once and refuses a second one', async () => {
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: ACADEMY_ADMIN_ROLE_KEY }, select: { id: true } });
    const existingAdmins = await prisma.user.count({
      where: { deletedAt: null, status: { not: 'archived' }, roles: { some: { roleId: adminRole.id } } },
    });
    const input = { email: email('bootstrap'), fullName: 'Bootstrap Admin', password: 'Bootstrap-Password-12' };

    if (existingAdmins === 0) {
      const created = await bootstrapFirstAdmin(prisma, input, passwords);
      expect(created.outcome).toBe('created');
      if (created.outcome === 'created') createdUserIds.push(created.userId);

      const again = await bootstrapFirstAdmin(prisma, input, passwords);
      expect(again).toEqual({ outcome: 'already_bootstrapped', userId: (created as { userId: string }).userId });

      const session = await login(input.email, input.password).expect(200);
      expect(session.body.user.roles).toEqual([ACADEMY_ADMIN_ROLE_KEY]);
      expect(session.body.user.permissions).toContain('audit.read');
      expect(session.body.user.mustChangePassword).toBe(false);
      const event = await prisma.auditLog.findFirst({ where: { action: 'auth.bootstrap.admin_created', entityId: session.body.user.id } });
      expect(event).not.toBeNull();
      expect(JSON.stringify(event!.metadata)).not.toMatch(/Bootstrap-Password/);
    }

    const refused = await bootstrapFirstAdmin(prisma, { ...input, email: email('second-admin') }, passwords);
    expect(refused).toEqual({ outcome: 'refused', reason: 'admin_exists' });
    await expect(bootstrapFirstAdmin(prisma, { ...input, password: 'short' }, passwords)).rejects.toThrow(/password/);
  });
});
