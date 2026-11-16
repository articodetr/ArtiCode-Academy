// TEST-221 (e2e) — MOD-01-H06 for the PLATFORM API: the caller's active
// sessions (API-203 GET /api/auth/sessions) and revoking one of them (API-204
// DELETE /api/auth/sessions/:id), the academy TEST-220 (test/sessions.e2e-spec.ts)
// on the platform's accounts, `platform_refresh_tokens` and the `pla_refresh`
// cookie.
//
// Skipped when the platform database is unreachable (./helpers.ts). Fixture
// accounts are deleted in afterAll (their tokens cascade; the actor of their
// append-only audit rows becomes NULL). Events are counted above an id
// watermark and by the fixture account they name, so other clients of the
// shared dev platform DB never pollute the counts.
import { randomBytes, randomInt } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REFRESH_COOKIE_NAME } from '../../src/auth/cookies.js';
import { uuidV7Time } from '../../src/auth/refresh-family.js';
import { TokenService } from '../../src/auth/token.service.js';
import { validateEnv } from '../../src/config/env.schema.js';
import type { Env } from '../../src/config/env.schema.js';
import { PLATFORM_REFRESH_COOKIE_NAME } from '../../src/platform/auth/platform-cookies.js';
import { PlatformTokenService } from '../../src/platform/auth/platform-token.service.js';
import type { PlatformEnv } from '../../src/platform/platform.env.schema.js';
import {
  PLATFORM_TEST_ORIGIN,
  closePlatformTestDb,
  createPlatformTestApp,
  createPlatformUserFixture,
  deletePlatformUserFixtures,
  platformAccessTokenFor,
  platformDbReachable,
  platformTestDb,
} from './helpers.js';
import type { PlatformUserFixture } from './helpers.js';

const available = await platformDbReachable();

const LOGIN = '/api/auth/login';
const REFRESH = '/api/auth/refresh';
const SESSIONS = '/api/auth/sessions';
const REVOKED = 'platform.auth.session.revoked';
const DAY_MS = 24 * 60 * 60 * 1000;
const ITEM_KEYS = ['current', 'expiresAt', 'id', 'ipAddress', 'lastActiveAt', 'startedAt', 'userAgent'];

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
  if (!line) return undefined;
  const value = line.split(';')[0]!.slice(PLATFORM_REFRESH_COOKIE_NAME.length + 1);
  return value.length > 0 ? value : undefined;
}

/** A UUIDv7 whose timestamp is `at` (RFC 9562 layout, random bits from crypto). */
function uuidV7At(at: Date): string {
  const random = (digits: number) => randomBytes(digits).toString('hex').slice(0, digits);
  const hex = `${at.getTime().toString(16).padStart(12, '0')}7${random(3)}${(8 + randomInt(4)).toString(16)}${random(15)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Every object key in a JSON value, at any depth. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  }
  return [];
}

/** An access token of the ACADEMY API (its own secret, issuer and audience) — never valid here. */
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

/** Every event naming one fixture account (as entity or actor) written after `mark`, oldest first. */
async function eventsSince(mark: string | null, userId: string) {
  return platformTestDb().platformAuditLog.findMany({
    where: {
      OR: [{ entityId: userId }, { actorPlatformUserId: userId }],
      ...(mark ? { id: { gt: mark } } : {}),
    },
    orderBy: { id: 'asc' },
    select: { action: true, actorPlatformUserId: true, entityType: true, entityId: true, metadata: true },
  });
}

/** The `platform.auth.session.revoked` events of one fixture account after `mark`. */
async function revokedSince(mark: string | null, userId: string) {
  return (await eventsSince(mark, userId)).filter((event) => event.action === REVOKED);
}

interface SignedIn {
  bearer: string;
  cookie: string;
  familyId: string;
}

interface SessionItem {
  id: string;
  startedAt: string;
  lastActiveAt: string;
  expiresAt: string;
  userAgent: string | null;
  ipAddress: string | null;
  current: boolean;
}

describe.skipIf(!available)('MOD-01-H06 platform sessions — API-203/204 (e2e, TEST-221)', () => {
  let app: NestExpressApplication;
  let tokens: PlatformTokenService;
  const fixtureIds: string[] = [];
  /** Every password, token and cookie value of this run — none may appear in an audit row. */
  const secrets: string[] = [];
  let firstMark: string | null;

  const api = () => request(app.getHttpServer());
  const cookieHeader = (cookie: string) => `${PLATFORM_REFRESH_COOKIE_NAME}=${cookie}`;

  async function fixture(input: Parameters<typeof createPlatformUserFixture>[0]): Promise<PlatformUserFixture> {
    const user = await createPlatformUserFixture(input);
    fixtureIds.push(user.id);
    secrets.push(user.password);
    return user;
  }

  /** Signs in through API-178 (at most 10 per 15 minutes per identifier — keep it under that per fixture). */
  async function signIn(user: PlatformUserFixture, userAgent = 'platform-sessions-e2e'): Promise<SignedIn> {
    const res = await api()
      .post(LOGIN)
      .set('Origin', PLATFORM_TEST_ORIGIN)
      .set('User-Agent', userAgent)
      .send({ identifier: user.email, password: user.password })
      .expect(200);
    const cookie = refreshCookie(res)!;
    secrets.push(res.body.accessToken, cookie);
    const row = await platformTestDb().platformRefreshToken.findUniqueOrThrow({
      where: { tokenHash: tokens.hashRefreshToken(cookie) },
      select: { familyId: true },
    });
    return { bearer: `Bearer ${res.body.accessToken}`, cookie, familyId: row.familyId };
  }

  function refresh(cookie: string) {
    return api().post(REFRESH).set('Origin', PLATFORM_TEST_ORIGIN).set('Cookie', cookieHeader(cookie));
  }

  function listSessions(bearer: string, cookie?: string) {
    const req = api().get(SESSIONS).set('Authorization', bearer);
    return cookie ? req.set('Cookie', cookieHeader(cookie)) : req;
  }

  function revokeSession(bearer: string, id: string, cookie?: string) {
    const req = api().delete(`${SESSIONS}/${id}`).set('Origin', PLATFORM_TEST_ORIGIN).set('Authorization', bearer);
    return cookie ? req.set('Cookie', cookieHeader(cookie)) : req;
  }

  async function sessionsOf(session: SignedIn, cookie?: string): Promise<SessionItem[]> {
    return (await listSessions(session.bearer, cookie).expect(200)).body.items as SessionItem[];
  }

  beforeAll(async () => {
    app = await createPlatformTestApp();
    tokens = app.get(PlatformTokenService);
    firstMark = await auditMark();
  });

  afterAll(async () => {
    await app?.close();
    await deletePlatformUserFixtures(fixtureIds);
    await closePlatformTestDb();
  });

  it('lists one session per sign-in for either platform role, marks the one of the pla_refresh cookie as current, never shows a token or a hash; reads record nothing', async () => {
    const user = await fixture({ role: 'support' });
    const a = await signIn(user, 'platform-sessions-e2e/device-a');
    const b = await signIn(user, 'platform-sessions-e2e/device-b');
    const mark = await auditMark();

    const res = await listSessions(a.bearer, a.cookie).expect(200);
    expect(Object.keys(res.body)).toEqual(['items']);
    const items = res.body.items as SessionItem[];
    expect(items.map((item) => item.id)).toEqual([b.familyId, a.familyId]); // newest activity first
    for (const item of items) expect(Object.keys(item).sort()).toEqual(ITEM_KEYS);
    const itemA = items.find((item) => item.id === a.familyId)!;
    const itemB = items.find((item) => item.id === b.familyId)!;
    expect(itemA.current).toBe(true);
    expect(itemB.current).toBe(false);
    expect(itemA.userAgent).toBe('platform-sessions-e2e/device-a');
    expect(itemB.userAgent).toBe('platform-sessions-e2e/device-b');
    expect(itemA.ipAddress === null || typeof itemA.ipAddress === 'string').toBe(true);
    expect(itemA.startedAt).toBe(uuidV7Time(a.familyId)!.toISOString());

    const rowA = await platformTestDb().platformRefreshToken.findUniqueOrThrow({ where: { tokenHash: tokens.hashRefreshToken(a.cookie) } });
    expect(itemA.lastActiveAt).toBe(rowA.createdAt.toISOString());
    expect(itemA.expiresAt).toBe(rowA.expiresAt.toISOString());

    // No key names a token, a hash or the rotation chain; no value leaks a cookie or its hash.
    expect(keysOf(res.body).filter((key) => /hash|token|replaced/i.test(key))).toEqual([]);
    const body = JSON.stringify(res.body);
    for (const secret of [a.cookie, b.cookie, rowA.tokenHash]) expect(body).not.toContain(secret);

    // The current flag follows the cookie, not the access token; no cookie → nothing is current.
    expect((await sessionsOf(a, b.cookie)).find((item) => item.current)?.id).toBe(b.familyId);
    expect((await sessionsOf(a)).every((item) => !item.current)).toBe(true);
    // The same value under the academy cookie name is not read (the platform reads pla_refresh only).
    const academyNamed = await listSessions(a.bearer).set('Cookie', `${REFRESH_COOKIE_NAME}=${a.cookie}`).expect(200);
    expect((academyNamed.body.items as SessionItem[]).every((item) => !item.current)).toBe(true);
    // Another account's cookie in the same browser marks nothing; a super admin lists only their own.
    const admin = await fixture({ role: 'super_admin' });
    const adminSession = await signIn(admin);
    expect((await sessionsOf(a, adminSession.cookie)).every((item) => !item.current)).toBe(true);
    expect((await sessionsOf(adminSession, adminSession.cookie)).map((item) => [item.id, item.current])).toEqual([[adminSession.familyId, true]]);

    expect(await eventsSince(mark, user.id)).toEqual([]);
  });

  it('keeps the same session through a refresh and moves its lastActiveAt', async () => {
    const user = await fixture({ role: 'super_admin' });
    const a = await signIn(user, 'platform-sessions-e2e/before-refresh');
    const [before] = await sessionsOf(a, a.cookie);
    expect(before).toMatchObject({ id: a.familyId, current: true, userAgent: 'platform-sessions-e2e/before-refresh' });

    await new Promise((resolve) => setTimeout(resolve, 20));
    const refreshed = await refresh(a.cookie).set('User-Agent', 'platform-sessions-e2e/after-refresh').expect(200);
    const nextCookie = refreshCookie(refreshed)!;
    secrets.push(refreshed.body.accessToken, nextCookie);
    expect(nextCookie).not.toBe(a.cookie);

    const after = await sessionsOf({ ...a, bearer: `Bearer ${refreshed.body.accessToken}` }, nextCookie);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: a.familyId, startedAt: before!.startedAt, current: true, userAgent: 'platform-sessions-e2e/after-refresh' });
    expect(new Date(after[0]!.lastActiveAt).getTime()).toBeGreaterThan(new Date(before!.lastActiveAt).getTime());
  });

  it('revokes another session: 204 without touching the cookie, exactly one event, and that device can no longer refresh', async () => {
    const user = await fixture({ role: 'super_admin' });
    const a = await signIn(user);
    const b = await signIn(user);
    const mark = await auditMark();

    const res = await revokeSession(a.bearer, b.familyId, a.cookie).expect(204);
    expect(res.text).toBe('');
    expect(cookieLine(res)).toBe('');

    // A revoked family answers what a revoked refresh token always answers (and records nothing more: nothing is left to revoke).
    expect((await refresh(b.cookie).expect(401)).body.code).toBe('refresh_reused');
    expect((await sessionsOf(a, a.cookie)).map((item) => item.id)).toEqual([a.familyId]);
    expect(await platformTestDb().platformRefreshToken.count({ where: { familyId: b.familyId, revokedAt: null } })).toBe(0);
    const stillGood = await refresh(a.cookie).expect(200);
    secrets.push(stillGood.body.accessToken, refreshCookie(stillGood)!);

    const events = await eventsSince(mark, user.id);
    expect(events).toEqual([
      {
        action: REVOKED,
        actorPlatformUserId: user.id,
        entityType: 'platform_users',
        entityId: user.id,
        metadata: { familyId: b.familyId, current: false, revokedCount: 1 },
      },
    ]);
    expect(keysOf(events).filter((key) => /hash|token/i.test(key))).toEqual([]);
  });

  it('revoking the current session clears the pla_refresh cookie like logout; the access token keeps working until it expires', async () => {
    const user = await fixture({ role: 'support' });
    const a = await signIn(user);
    const mark = await auditMark();

    // ParseUUIDPipe accepts upper case; the session is found all the same.
    const res = await revokeSession(a.bearer, a.familyId.toUpperCase(), a.cookie).expect(204);
    const line = cookieLine(res);
    expect(line).toMatch(/^pla_refresh=;/);
    expect(line).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(line).toMatch(/Path=\/api\/auth/);
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/SameSite=Strict/i);
    // The same attributes as the logout's clearing line (API-180).
    const second = await signIn(user);
    const logout = await api().post('/api/auth/logout').set('Origin', PLATFORM_TEST_ORIGIN).set('Cookie', cookieHeader(second.cookie)).expect(204);
    expect(line).toBe(cookieLine(logout));
    expect(setCookies(res).some((cookie) => cookie.startsWith(`${REFRESH_COOKIE_NAME}=`))).toBe(false);

    expect((await refresh(a.cookie).expect(401)).body.code).toBe('refresh_reused');
    // Like logout: the refresh side ends now, the short-lived access token does not.
    expect(await sessionsOf(a, a.cookie)).toEqual([]);

    expect(await revokedSince(mark, user.id)).toEqual([
      {
        action: REVOKED,
        actorPlatformUserId: user.id,
        entityType: 'platform_users',
        entityId: user.id,
        metadata: { familyId: a.familyId, current: true, revokedCount: 1 },
      },
    ]);
  });

  it('answers 404 session_not_found for another account’s, an unknown, a revoked, an expired or an over-age session, and 400 for a malformed id — without an event', async () => {
    const user = await fixture({ role: 'support' });
    const stranger = await fixture({ role: 'super_admin' });
    const a = await signIn(user);
    const theirs = await signIn(stranger);
    const revoked = await signIn(user);
    const expired = await signIn(user);
    const overAge = await signIn(user);
    const maxDays = app.get(ConfigService<PlatformEnv, true>).get('PLATFORM_REFRESH_FAMILY_MAX_DAYS');

    await revokeSession(a.bearer, revoked.familyId).expect(204);
    await platformTestDb().platformRefreshToken.updateMany({ where: { familyId: expired.familyId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    // Past the family's absolute deadline although the token itself is still valid.
    const oldFamily = uuidV7At(new Date(Date.now() - (maxDays + 1) * DAY_MS));
    await platformTestDb().platformRefreshToken.updateMany({ where: { familyId: overAge.familyId }, data: { familyId: oldFamily } });

    const mark = await auditMark();
    const refused = async (id: string) => {
      const res = await revokeSession(a.bearer, id, a.cookie).expect(404);
      expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found', code: 'session_not_found' });
      expect(cookieLine(res)).toBe('');
    };

    await refused(theirs.familyId);
    expect((await sessionsOf(theirs, theirs.cookie)).map((item) => item.id)).toEqual([theirs.familyId]);
    await refused(uuidV7At(new Date()));
    await refused(revoked.familyId);
    await refused(expired.familyId);
    await refused(oldFamily);
    const malformed = await revokeSession(a.bearer, 'not-a-uuid', a.cookie).expect(400);
    expect(JSON.stringify(malformed.body)).toMatch(/uuid/i);
    expect(cookieLine(malformed)).toBe('');

    // None of them is listed; only the session of `a` is.
    expect((await sessionsOf(a, a.cookie)).map((item) => item.id)).toEqual([a.familyId]);

    // No event for any refusal, for either account.
    expect(await eventsSince(mark, user.id)).toEqual([]);
    expect(await eventsSince(mark, stranger.id)).toEqual([]);
    // In the whole run, the only revoke event of `user` is the successful one above.
    expect((await revokedSince(firstMark, user.id)).map((event) => event.metadata)).toEqual([
      { familyId: revoked.familyId, current: false, revokedCount: 1 },
    ]);
  });

  it('leaves no session after logout-all', async () => {
    const user = await fixture({ role: 'support' });
    const a = await signIn(user);
    await signIn(user);
    expect(await sessionsOf(a, a.cookie)).toHaveLength(2);

    await api().post('/api/auth/logout-all').set('Origin', PLATFORM_TEST_ORIGIN).set('Authorization', a.bearer).expect(204);
    expect(await sessionsOf(a, a.cookie)).toEqual([]);
  });

  it('needs a signed-in, active platform account and an acceptable Origin to revoke, and is never rate-limited', async () => {
    const user = await fixture({ role: 'support' });
    const a = await signIn(user);
    const mark = await auditMark();

    expect((await api().get(SESSIONS).expect(401)).body.code).toBe('unauthenticated');
    expect((await api().delete(`${SESSIONS}/${a.familyId}`).expect(401)).body.code).toBe('unauthenticated');
    // An academy access token never verifies here.
    const academy = `Bearer ${await academyAccessToken()}`;
    expect((await listSessions(academy).expect(401)).body.code).toBe('token_invalid');
    // A suspended account is refused before its sessions are read.
    const suspended = await fixture({ role: 'support', status: 'suspended' });
    const suspendedBearer = `Bearer ${await platformAccessTokenFor(app, suspended)}`;
    expect((await listSessions(suspendedBearer).expect(403)).body.code).toBe('account_suspended');
    expect((await revokeSession(suspendedBearer, a.familyId).expect(403)).body.code).toBe('account_suspended');

    const foreign = await revokeSession(a.bearer, a.familyId).set('Origin', 'https://evil.example').expect(403);
    expect(foreign.body.code).toBe('origin_forbidden');
    expect(await sessionsOf(a)).toHaveLength(1);

    // 12 > the platform_auth limiter's 10 per 15 minutes: these routes are not under PlatformThrottlerGuard.
    for (let call = 1; call <= 12; call += 1) {
      const res = await listSessions(a.bearer);
      expect(res.status, `GET ${SESSIONS} call ${call}`).toBe(200);
    }
    expect(await eventsSince(mark, user.id)).toEqual([]);
  });

  it('writes no secret into any audit row of this run', async () => {
    const rows = await platformTestDb().platformAuditLog.findMany({
      where: { entityId: { in: fixtureIds }, ...(firstMark ? { id: { gt: firstMark } } : {}) },
      select: { metadata: true },
    });
    expect(rows.length).toBeGreaterThan(0);
    const dump = JSON.stringify(rows);
    for (const secret of secrets) expect(dump).not.toContain(secret);
    expect(keysOf(rows).filter((key) => /token|hash|password/i.test(key))).toEqual([]);
  });

  it('documents both routes in the platform OpenAPI document', async () => {
    const docs = await api().get('/api/docs-json').expect(200);
    const list = docs.body.paths[SESSIONS];
    const revoke = docs.body.paths[`${SESSIONS}/{id}`];
    expect(Object.keys(list)).toEqual(['get']);
    expect(Object.keys(revoke)).toEqual(['delete']);
    expect(list.get.tags).toEqual(['auth']);
    expect(list.get.security).toEqual([{ bearer: [] }]);
    expect(revoke.delete.security).toEqual([{ bearer: [] }]);
    expect(Object.keys(list.get.responses).sort()).toEqual(['200', '401', '403']);
    expect(Object.keys(revoke.delete.responses).sort()).toEqual(['204', '400', '401', '403', '404']);
    const item = docs.body.components.schemas.PlatformSessionItemDto;
    expect(Object.keys(item.properties).sort()).toEqual(ITEM_KEYS);
    expect(item.properties.userAgent).toMatchObject({ type: 'string', nullable: true });
    expect(item.properties.ipAddress).toMatchObject({ type: 'string', nullable: true });
    expect(item.properties.lastActiveAt).toMatchObject({ type: 'string', format: 'date-time' });
    expect(docs.body.components.schemas.PlatformSessionListDto.properties.items).toMatchObject({ type: 'array' });
  });
});
