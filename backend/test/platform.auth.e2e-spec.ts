// TEST-208 (e2e) — MOD-18-T03 platform authentication (roadmap §4m.5;
// API-178..182 + logout-all): the whole session cycle with rotation and reuse
// detection, the family's absolute lifetime, the sign-in lock (which blocks new
// sign-ins only), the rate limit, a suspended account, academy credentials
// refused by the platform, the password change, both platform roles, the CLI
// account functions (bootstrap and create-user), and exactly the expected
// platform_audit_logs rows per request — counted above an id watermark by the
// fixture account they name — with no secret in any metadata.
//
// Skipped when the platform database is unreachable (test/platform/helpers.ts).
// Fixture accounts are deleted in afterAll (their tokens cascade; the actor of
// their append-only audit rows becomes NULL). No real super admin is created:
// the bootstrap is only exercised while this suite's fixture super admin
// exists, so it can only refuse.
import { randomBytes, randomInt } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REFRESH_COOKIE_NAME } from '../src/auth/cookies.js';
import { PasswordService } from '../src/auth/password.service.js';
import { TokenService } from '../src/auth/token.service.js';
import { validateEnv } from '../src/config/env.schema.js';
import type { Env } from '../src/config/env.schema.js';
import { bootstrapFirstPlatformAdmin, createPlatformUser } from '../src/platform/auth/platform-bootstrap.js';
import { PLATFORM_REFRESH_COOKIE_NAME } from '../src/platform/auth/platform-cookies.js';
import { PlatformTokenService } from '../src/platform/auth/platform-token.service.js';
import type { PlatformEnv } from '../src/platform/platform.env.schema.js';
import {
  PLATFORM_TEST_ORIGIN,
  PLATFORM_TEST_RUN,
  closePlatformTestDb,
  createPlatformTestApp,
  createPlatformUserFixture,
  deletePlatformUserFixtures,
  platformAccessTokenFor,
  platformDbReachable,
  platformTestDb,
} from './platform/helpers.js';
import type { PlatformUserFixture } from './platform/helpers.js';

const available = await platformDbReachable();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const NEW_PASSWORD = `new-${randomBytes(12).toString('base64url')}`;

function setCookies(res: SupertestResponse): string[] {
  const header = res.headers['set-cookie'];
  return Array.isArray(header) ? header : header ? [header] : [];
}

/** The `pla_refresh` line of a response, or ''. */
function cookieLine(res: SupertestResponse): string {
  return setCookies(res).find((cookie) => cookie.startsWith(`${PLATFORM_REFRESH_COOKIE_NAME}=`)) ?? '';
}

/** The `pla_refresh` value set by a response, or undefined when cleared or absent. */
function refreshCookie(res: SupertestResponse): string | undefined {
  const line = cookieLine(res);
  const value = line.split(';')[0]!.slice(PLATFORM_REFRESH_COOKIE_NAME.length + 1);
  return value.length > 0 ? value : undefined;
}

function cookieCleared(res: SupertestResponse): boolean {
  const line = cookieLine(res);
  return line.startsWith(`${PLATFORM_REFRESH_COOKIE_NAME}=;`) && /Expires=Thu, 01 Jan 1970/i.test(line);
}

/** A UUIDv7 whose timestamp is `at` (RFC 9562 layout) — to make a family look older. */
function uuidV7At(at: Date): string {
  const random = (digits: number) => randomBytes(digits).toString('hex').slice(0, digits);
  const hex = `${at.getTime().toString(16).padStart(12, '0')}7${random(3)}${(8 + randomInt(4)).toString(16)}${random(15)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** An access token of the ACADEMY API (its own TokenService, secret, issuer and audience). */
async function academyAccessToken(): Promise<string> {
  const env = validateEnv({ JWT_SECRET: process.env['JWT_SECRET'] });
  const tokens = new TokenService({ get: (key: keyof Env) => env[key] } as unknown as ConfigService<Env, true>);
  const signed = await tokens.signAccessToken({ userId: '019a7d00-0000-7000-8000-000000000001', roles: ['academy_admin'] });
  return signed.token;
}

/** The newest platform_audit_logs id (UUIDv7 = insertion order), or null on an empty log. */
async function auditMark(): Promise<string | null> {
  const last = await platformTestDb().platformAuditLog.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
  return last?.id ?? null;
}

/** The events about one account written after `mark`, oldest first. */
async function eventsSince(mark: string | null, entityId: string) {
  return platformTestDb().platformAuditLog.findMany({
    where: { entityId, ...(mark ? { id: { gt: mark } } : {}) },
    orderBy: { id: 'asc' },
    select: { action: true, actorPlatformUserId: true, entityType: true, metadata: true },
  });
}

describe.skipIf(!available)('platform authentication — MOD-18-T03 (e2e, TEST-208)', () => {
  let app: NestExpressApplication;
  const api = () => request(app.getHttpServer());
  const fixtureIds: string[] = [];
  /** Every password, token and cookie value of this run — none may appear in an audit row. */
  const secrets: string[] = [NEW_PASSWORD];
  let firstMark: string | null;
  let superAdmin: PlatformUserFixture;
  let support: PlatformUserFixture;

  async function fixture(input: Parameters<typeof createPlatformUserFixture>[0]): Promise<PlatformUserFixture> {
    const user = await createPlatformUserFixture(input);
    fixtureIds.push(user.id);
    secrets.push(user.password);
    return user;
  }

  function login(identifier: string, password: string) {
    return api().post('/api/auth/login').set('Origin', PLATFORM_TEST_ORIGIN).send({ identifier, password });
  }

  function refresh(cookie: string, name: string = PLATFORM_REFRESH_COOKIE_NAME) {
    return api().post('/api/auth/refresh').set('Origin', PLATFORM_TEST_ORIGIN).set('Cookie', `${name}=${cookie}`);
  }

  function me(token: string) {
    return api().get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  }

  /** Signs in and returns the access token and the refresh cookie (recorded as secrets). */
  async function signIn(user: PlatformUserFixture, password: string = user.password) {
    const res = await login(user.email, password).expect(200);
    const cookie = refreshCookie(res)!;
    secrets.push(res.body.accessToken, cookie);
    return { accessToken: res.body.accessToken as string, cookie, res };
  }

  /** A live refresh token inserted directly (no sign-in request — keeps the per-identifier rate limit free). */
  async function insertRefreshToken(userId: string, data: { familyId?: string; expiresAt?: Date } = {}): Promise<string> {
    const issued = app.get(PlatformTokenService).newRefreshToken();
    secrets.push(issued.token);
    await platformTestDb().platformRefreshToken.create({
      data: {
        userId,
        tokenHash: issued.hash,
        expiresAt: data.expiresAt ?? new Date(Date.now() + DAY_MS),
        ...(data.familyId ? { familyId: data.familyId } : {}),
      },
    });
    return issued.token;
  }

  beforeAll(async () => {
    app = await createPlatformTestApp();
    firstMark = await auditMark();
    superAdmin = await fixture({ role: 'super_admin' });
    support = await fixture({ role: 'support' });
  });

  afterAll(async () => {
    await app?.close();
    await deletePlatformUserFixtures(fixtureIds);
    await closePlatformTestDb();
  });

  it('session cycle: login → me → refresh rotates in the family → replaying the old cookie revokes the family → logout', async () => {
    const mark0 = await auditMark();
    const { accessToken, cookie: c1, res } = await signIn(superAdmin);
    expect(res.body).toEqual({
      tokenType: 'Bearer',
      accessToken: expect.any(String),
      expiresIn: app.get(ConfigService<PlatformEnv, true>).get('PLATFORM_JWT_ACCESS_TTL_SECONDS'),
      user: { id: superAdmin.id, email: superAdmin.email, fullName: superAdmin.fullName, role: 'super_admin', status: 'active' },
    });
    // Neither a hash, a password nor the refresh token is ever in a body (the access token is a random JWT, so keys are checked).
    expect([...Object.keys(res.body), ...Object.keys(res.body.user)].join(',')).not.toMatch(/hash|password|refresh/i);
    const line = cookieLine(res);
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/SameSite=Strict/i);
    expect(line).toMatch(/Path=\/api\/auth/);
    expect(setCookies(res).some((cookie) => cookie.startsWith(`${REFRESH_COOKIE_NAME}=`))).toBe(false);
    const login0 = await eventsSince(mark0, superAdmin.id);
    expect(login0).toEqual([
      {
        action: 'platform.auth.login.succeeded',
        actorPlatformUserId: superAdmin.id,
        entityType: 'platform_users',
        metadata: { via: 'password', familyId: expect.stringMatching(UUID) },
      },
    ]);
    const familyId = (login0[0]!.metadata as { familyId: string }).familyId;

    const who = await me(accessToken).expect(200);
    expect(who.body).toEqual({ id: superAdmin.id, email: superAdmin.email, fullName: superAdmin.fullName, role: 'super_admin', status: 'active' });

    // A foreign Origin never reaches the sign-in.
    await api().post('/api/auth/login').set('Origin', 'https://evil.example').send({ identifier: superAdmin.email, password: superAdmin.password }).expect(403);

    const mark1 = await auditMark();
    const rotated = await refresh(c1).expect(200);
    const c2 = refreshCookie(rotated)!;
    secrets.push(rotated.body.accessToken, c2);
    expect(c2).not.toBe(c1);
    expect(rotated.body.user).toMatchObject({ id: superAdmin.id, role: 'super_admin' });
    await me(rotated.body.accessToken).expect(200);
    const tokens = app.get(PlatformTokenService);
    const oldRow = await platformTestDb().platformRefreshToken.findUnique({ where: { tokenHash: tokens.hashRefreshToken(c1) } });
    const newRow = await platformTestDb().platformRefreshToken.findUnique({ where: { tokenHash: tokens.hashRefreshToken(c2) } });
    expect(oldRow).toMatchObject({ familyId, replacedById: newRow!.id, revokedAt: expect.any(Date) });
    expect(newRow).toMatchObject({ familyId, revokedAt: null, replacedById: null });
    expect(newRow!.expiresAt.getTime()).toBeLessThanOrEqual(tokens.familyDeadline(familyId)!.getTime());
    expect(await eventsSince(mark1, superAdmin.id)).toEqual([]);

    // Replay of the rotated token: the whole family is revoked, the cookie cleared, one event.
    const mark2 = await auditMark();
    const replay = await refresh(c1).expect(401);
    expect(replay.body).toMatchObject({ statusCode: 401, code: 'refresh_reused' });
    expect(cookieCleared(replay)).toBe(true);
    const afterKill = await refresh(c2).expect(401);
    expect(afterKill.body.code).toBe('refresh_reused');
    expect(await eventsSince(mark2, superAdmin.id)).toEqual([
      {
        action: 'platform.auth.refresh.reuse_detected',
        actorPlatformUserId: null,
        entityType: 'platform_users',
        metadata: { familyId, revokedSessions: 1 },
      },
    ]);

    // Logout revokes this device's family (one event), and is silent after that.
    const { cookie: c3 } = await signIn(superAdmin);
    const mark3 = await auditMark();
    const out = await api().post('/api/auth/logout').set('Origin', PLATFORM_TEST_ORIGIN).set('Cookie', `${PLATFORM_REFRESH_COOKIE_NAME}=${c3}`).expect(204);
    expect(cookieCleared(out)).toBe(true);
    expect((await refresh(c3).expect(401)).body.code).toBe('refresh_reused');
    await api().post('/api/auth/logout').set('Cookie', `${PLATFORM_REFRESH_COOKIE_NAME}=${c3}`).expect(204);
    await api().post('/api/auth/logout').expect(204);
    const outEvents = await eventsSince(mark3, superAdmin.id);
    expect(outEvents).toEqual([
      {
        action: 'platform.auth.logout',
        actorPlatformUserId: superAdmin.id,
        entityType: 'platform_users',
        metadata: { scope: 'device', familyId: expect.stringMatching(UUID) },
      },
    ]);

    // Refusals without a cookie or with an unknown one; me without a token.
    expect((await api().post('/api/auth/refresh').expect(401)).body.code).toBe('refresh_missing');
    expect((await refresh('not-a-platform-token').expect(401)).body.code).toBe('refresh_invalid');
    expect((await api().get('/api/auth/me').expect(401)).body.code).toBe('unauthenticated');
  });

  it('refresh past the family’s absolute lifetime or the token’s expiry is 401 refresh_expired and retires the token', async () => {
    const maxDays = app.get(ConfigService<PlatformEnv, true>).get('PLATFORM_REFRESH_FAMILY_MAX_DAYS');
    const oldFamily = await insertRefreshToken(support.id, { familyId: uuidV7At(new Date(Date.now() - (maxDays + 1) * DAY_MS)) });
    const expired = await insertRefreshToken(support.id, { expiresAt: new Date(Date.now() - 1000) });
    const mark = await auditMark();
    for (const token of [oldFamily, expired]) {
      const res = await refresh(token).expect(401);
      expect(res.body.code).toBe('refresh_expired');
      expect(cookieCleared(res)).toBe(true);
      const row = await platformTestDb().platformRefreshToken.findUnique({
        where: { tokenHash: app.get(PlatformTokenService).hashRefreshToken(token) },
      });
      expect(row?.revokedAt).toBeInstanceOf(Date);
    }
    expect(await eventsSince(mark, support.id)).toEqual([]);
  });

  it('wrong password × PLATFORM_LOCKOUT_THRESHOLD locks the account (423); the lock blocks new sign-ins only', async () => {
    const config = app.get(ConfigService<PlatformEnv, true>);
    const threshold = config.get('PLATFORM_LOCKOUT_THRESHOLD');
    const lockSeconds = config.get('PLATFORM_LOCKOUT_MINUTES') * 60;
    // threshold + 2 sign-ins of one identifier must stay under the 10-per-15-minutes limit.
    expect(threshold + 2).toBeLessThanOrEqual(10);
    const lockee = await fixture({ role: 'support' });
    const runningSession = await platformAccessTokenFor(app, lockee);
    const runningCookie = await insertRefreshToken(lockee.id);

    const mark = await auditMark();
    for (let attempt = 1; attempt < threshold; attempt += 1) {
      const res = await login(lockee.email, `wrong-${attempt}-${lockee.password}`).expect(401);
      expect(res.body.code).toBe('invalid_credentials');
    }
    const locking = await login(lockee.email, 'wrong-again-and-again').expect(423);
    expect(locking.body).toMatchObject({ code: 'account_locked', retryAfterSeconds: lockSeconds });
    const stillLocked = await login(lockee.email, lockee.password).expect(423);
    expect(stillLocked.body.code).toBe('account_locked');
    expect(stillLocked.body.retryAfterSeconds).toBeGreaterThan(lockSeconds - 30);
    expect(refreshCookie(stillLocked)).toBeUndefined();

    // The running session is not ended by the lock (the academy rule).
    await me(runningSession).expect(200);
    const refreshed = await refresh(runningCookie).expect(200);
    secrets.push(refreshed.body.accessToken, refreshCookie(refreshed)!);

    const events = await eventsSince(mark, lockee.id);
    expect(events).toEqual([
      ...Array.from({ length: threshold }, (_, index) => ({
        action: 'platform.auth.login.failed',
        actorPlatformUserId: null,
        entityType: 'platform_users',
        metadata: { reason: 'invalid_password', failedAttempts: index + 1, locked: index + 1 === threshold },
      })),
      { action: 'platform.auth.login.failed', actorPlatformUserId: null, entityType: 'platform_users', metadata: { reason: 'locked' } },
    ]);
    expect(await platformTestDb().platformUser.findUnique({ where: { id: lockee.id }, select: { failedLoginCount: true, lockedUntil: true } })).toEqual({
      failedLoginCount: 0,
      lockedUntil: expect.any(Date),
    });

    // Once the lock has passed, the right password signs in and clears the lock.
    await platformTestDb().platformUser.update({ where: { id: lockee.id }, data: { lockedUntil: new Date(Date.now() - 1000), failedLoginCount: 2 } });
    await signIn(lockee);
    expect(await platformTestDb().platformUser.findUnique({ where: { id: lockee.id }, select: { failedLoginCount: true, lockedUntil: true, lastLoginAt: true } })).toEqual({
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: expect.any(Date),
    });
  });

  it('an unknown e-mail looks like a wrong password, records nothing, and the 11th sign-in of one identifier in 15 minutes is 429 rate_limited', async () => {
    const nobody = `${PLATFORM_TEST_RUN}-nobody@example.test`;
    const mark = await auditMark();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const res = await login(attempt % 2 === 0 ? nobody : `  ${nobody.toUpperCase()} `, 'irrelevant-password').expect(401);
      expect(res.body.code).toBe('invalid_credentials');
    }
    const limited = await login(nobody, 'irrelevant-password').expect(429);
    expect(limited.body).toMatchObject({ statusCode: 429, code: 'rate_limited' });
    const anonymous = await platformTestDb().platformAuditLog.count({
      where: { action: 'platform.auth.login.failed', entityId: null, ...(mark ? { id: { gt: mark } } : {}) },
    });
    expect(anonymous).toBe(0);
  });

  it('a suspended account: refused at sign-in only after the password matched (403), at refresh and with its access tokens', async () => {
    const suspended = await fixture({ role: 'support', status: 'suspended' });
    const cookie = await insertRefreshToken(suspended.id);
    const mark = await auditMark();
    expect((await login(suspended.email, 'not-the-password').expect(401)).body.code).toBe('invalid_credentials');
    const refused = await login(suspended.email, suspended.password).expect(403);
    expect(refused.body).toMatchObject({ statusCode: 403, code: 'account_suspended' });
    expect(refreshCookie(refused)).toBeUndefined();

    const r = await refresh(cookie).expect(403);
    expect(r.body.code).toBe('account_suspended');
    expect(cookieCleared(r)).toBe(true);
    const row = await platformTestDb().platformRefreshToken.findUnique({ where: { tokenHash: app.get(PlatformTokenService).hashRefreshToken(cookie) } });
    expect(row?.revokedAt).toBeInstanceOf(Date);
    expect((await me(await platformAccessTokenFor(app, suspended)).expect(403)).body.code).toBe('account_suspended');

    expect(await eventsSince(mark, suspended.id)).toEqual([
      {
        action: 'platform.auth.login.failed',
        actorPlatformUserId: null,
        entityType: 'platform_users',
        metadata: { reason: 'invalid_password', failedAttempts: 1, locked: false },
      },
      { action: 'platform.auth.login.failed', actorPlatformUserId: null, entityType: 'platform_users', metadata: { reason: 'suspended' } },
    ]);
  });

  it('academy credentials are refused: an academy access token (401 token_invalid) and an academy aca_refresh cookie (401 refresh_missing)', async () => {
    const academyToken = await academyAccessToken();
    const viaToken = await me(academyToken).expect(401);
    expect(viaToken.body.code).toBe('token_invalid');

    const live = await insertRefreshToken(support.id);
    // The VALUE of a live platform token under the academy's cookie name is not read at all.
    const wrongName = await refresh(live, REFRESH_COOKIE_NAME).expect(401);
    expect(wrongName.body.code).toBe('refresh_missing');
    // An academy-shaped value under the platform's name is unknown.
    expect((await refresh(randomBytes(32).toString('base64url')).expect(401)).body.code).toBe('refresh_invalid');
    // The same value under pla_refresh is a real session.
    const ok = await refresh(live).expect(200);
    secrets.push(ok.body.accessToken, refreshCookie(ok)!);
    expect(ok.body.user.role).toBe('support');
  });

  it('password change: refuses a wrong or weak password, then kills older access tokens and the other sessions; this device refreshes on', async () => {
    const holder = await fixture({ role: 'super_admin' });
    const a = await signIn(holder);
    const b = await signIn(holder);
    // An access token issued in an earlier second than the change (iat has second precision).
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const change = (body: Record<string, unknown>) =>
      api()
        .post('/api/auth/password')
        .set('Origin', PLATFORM_TEST_ORIGIN)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('Cookie', `${PLATFORM_REFRESH_COOKIE_NAME}=${a.cookie}`)
        .send(body);

    const mark = await auditMark();
    expect((await change({ currentPassword: 'wrong-current-pw', newPassword: NEW_PASSWORD }).expect(400)).body.code).toBe('password_invalid');
    const weak = await change({ currentPassword: holder.password, newPassword: 'too-short' }).expect(400);
    expect(weak.body).toMatchObject({ code: 'password_weak', problems: ['at least 12 characters'] });
    const same = await change({ currentPassword: holder.password, newPassword: holder.password }).expect(400);
    expect(same.body).toMatchObject({ code: 'password_weak', problems: ['different from the current password'] });
    expect(await eventsSince(mark, holder.id)).toEqual([]);

    await change({ currentPassword: holder.password, newPassword: NEW_PASSWORD }).expect(204);
    expect(await eventsSince(mark, holder.id)).toEqual([
      {
        action: 'platform.auth.password.changed',
        actorPlatformUserId: holder.id,
        entityType: 'platform_users',
        metadata: { revokedSessions: 1 },
      },
    ]);

    expect((await me(a.accessToken).expect(401)).body.code).toBe('token_invalid');
    expect((await refresh(b.cookie).expect(401)).body.code).toBe('refresh_reused');
    const onward = await refresh(a.cookie).expect(200);
    secrets.push(onward.body.accessToken, refreshCookie(onward)!);
    await me(onward.body.accessToken).expect(200);

    expect((await login(holder.email, holder.password).expect(401)).body.code).toBe('invalid_credentials');
    await signIn(holder, NEW_PASSWORD);
  });

  it('support and super_admin both sign in; logout-all revokes every session of the caller', async () => {
    const one = await signIn(support);
    expect(one.res.body.user).toMatchObject({ id: support.id, role: 'support', status: 'active' });
    const two = await signIn(support);
    const mark = await auditMark();
    const out = await api()
      .post('/api/auth/logout-all')
      .set('Origin', PLATFORM_TEST_ORIGIN)
      .set('Authorization', `Bearer ${two.accessToken}`)
      .expect(204);
    expect(cookieCleared(out)).toBe(true);
    for (const cookie of [one.cookie, two.cookie]) {
      expect((await refresh(cookie).expect(401)).body.code).toBe('refresh_reused');
    }
    const events = await eventsSince(mark, support.id);
    expect(events).toEqual([
      {
        action: 'platform.auth.logout',
        actorPlatformUserId: support.id,
        entityType: 'platform_users',
        metadata: { scope: 'all', revokedSessions: expect.any(Number) },
      },
    ]);
    // At least the two sessions of this test (earlier tests may have left live support sessions).
    expect((events[0]!.metadata as { revokedSessions: number }).revokedSessions).toBeGreaterThanOrEqual(2);
    // logout-all needs a signed-in caller.
    expect((await api().post('/api/auth/logout-all').expect(401)).body.code).toBe('unauthenticated');
  });

  it('CLI functions: create-user records platform.users.created { role, via: cli }; the bootstrap refuses while a super admin exists', async () => {
    const passwords = new PasswordService();
    const email = `${PLATFORM_TEST_RUN}-cli@example.test`;
    const password = `cli-${randomBytes(12).toString('base64url')}`;
    secrets.push(password);
    const mark = await auditMark();

    const created = await createPlatformUser(platformTestDb(), { email: ` ${email.toUpperCase()} `, fullName: ' CLI Fixture ', password, role: 'support' }, passwords);
    expect(created.outcome).toBe('created');
    const userId = (created as { userId: string }).userId;
    fixtureIds.push(userId);
    expect(await platformTestDb().platformUser.findUnique({ where: { id: userId }, select: { email: true, fullName: true, role: true, status: true } })).toEqual({
      email,
      fullName: 'CLI Fixture',
      role: 'support',
      status: 'active',
    });
    expect(await eventsSince(mark, userId)).toEqual([
      { action: 'platform.users.created', actorPlatformUserId: null, entityType: 'platform_users', metadata: { role: 'support', via: 'cli' } },
    ]);
    const signed = await login(email, password).expect(200);
    secrets.push(signed.body.accessToken, refreshCookie(signed)!);
    expect(signed.body.user).toMatchObject({ id: userId, role: 'support' });

    expect(await createPlatformUser(platformTestDb(), { email, fullName: 'Again', password, role: 'super_admin' }, passwords)).toEqual({
      outcome: 'refused',
      reason: 'email_in_use',
    });
    await expect(createPlatformUser(platformTestDb(), { email: 'nope', fullName: 'X', password: 'short', role: 'support' }, passwords)).rejects.toThrow(
      /email must be a valid address/,
    );

    // This suite's fixture super admin exists, so the bootstrap can only refuse (no real super admin is ever created here).
    const otherEmail = `${PLATFORM_TEST_RUN}-boot@example.test`;
    expect(await bootstrapFirstPlatformAdmin(platformTestDb(), { email: otherEmail, fullName: 'Second Admin', password }, passwords)).toEqual({
      outcome: 'refused',
      reason: 'super_admin_exists',
    });
    expect(await platformTestDb().platformUser.findUnique({ where: { email: otherEmail } })).toBeNull();
    expect(await bootstrapFirstPlatformAdmin(platformTestDb(), { email: superAdmin.email, fullName: 'Anyone', password }, passwords)).toEqual({
      outcome: 'already_bootstrapped',
      userId: superAdmin.id,
    });
    expect(await eventsSince(mark, superAdmin.id)).toEqual([]);
  });

  it('no secret in any audit row of this run', async () => {
    const rows = await platformTestDb().platformAuditLog.findMany({
      where: { entityId: { in: fixtureIds }, ...(firstMark ? { id: { gt: firstMark } } : {}) },
      select: { action: true, metadata: true },
    });
    expect(rows.length).toBeGreaterThan(10);
    const keys = (value: unknown): string[] =>
      value && typeof value === 'object' ? Object.entries(value).flatMap(([key, inner]) => [key, ...keys(inner)]) : [];
    for (const row of rows) {
      expect(row.action).toMatch(/^platform\.(auth|users)\./);
      for (const key of keys(row.metadata)) expect(key).not.toMatch(/password|token|hash|secret|cookie|identifier|email/i);
      const text = JSON.stringify(row.metadata);
      for (const secret of secrets) expect(text).not.toContain(secret);
    }
  });
});
