// TEST-220 — MOD-01-H06: the caller's active sessions (API-201 GET
// /api/auth/sessions) and revoking one of them (API-202 DELETE
// /api/auth/sessions/:id) against the live development database. Skipped when
// no database is reachable. Fixture users carry a unique suffix and are
// deleted at the end (cascade removes their tokens; their audit rows stay —
// the log is append-only). Events are counted by fixture actor, so other
// clients of the shared dev DB never pollute the counts.
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
import { REFRESH_COOKIE_NAME } from '../src/auth/cookies.js';
import { PasswordService } from '../src/auth/password.service.js';
import { uuidV7Time } from '../src/auth/refresh-family.js';
import { TokenService } from '../src/auth/token.service.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'Correct-Horse-Battery-9';
const LOGIN = '/api/auth/login';
const REFRESH = '/api/auth/refresh';
const SESSIONS = '/api/auth/sessions';
const REVOKED = 'auth.session.revoked';
const DAY_MS = 24 * 60 * 60 * 1000;
const ITEM_KEYS = ['current', 'expiresAt', 'id', 'ipAddress', 'lastActiveAt', 'startedAt', 'userAgent'];

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

function setCookieLine(res: SupertestResponse): string {
  const header = res.headers['set-cookie'];
  const cookies: string[] = Array.isArray(header) ? header : header ? [header] : [];
  return cookies.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE_NAME}=`)) ?? '';
}

/** The refresh cookie value from a response, or undefined when cleared/absent. */
function refreshCookie(res: SupertestResponse): string | undefined {
  const line = setCookieLine(res);
  if (!line) return undefined;
  const value = line.split(';')[0]!.slice(REFRESH_COOKIE_NAME.length + 1);
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

describe.skipIf(!available)('MOD-01-H06 active sessions (e2e, TEST-220)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let passwords: PasswordService;
  let tokens: TokenService;
  let passwordHash: string;
  const createdUserIds: string[] = [];

  const api = () => request(app.getHttpServer());
  const cookieHeader = (cookie: string) => `${REFRESH_COOKIE_NAME}=${cookie}`;

  async function createUser(name: string): Promise<{ id: string; email: string }> {
    const user = await prisma.user.create({
      data: { email: `${name}-${RUN}@example.test`, fullName: `Sessions ${name}`, passwordHash, status: 'active' },
      select: { id: true, email: true },
    });
    createdUserIds.push(user.id);
    return { id: user.id, email: user.email! };
  }

  async function signIn(email: string, userAgent = 'sessions-e2e'): Promise<SignedIn> {
    const res = await api().post(LOGIN).set('User-Agent', userAgent).send({ identifier: email, password: PASSWORD }).expect(200);
    const cookie = refreshCookie(res)!;
    const row = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: tokens.hashRefreshToken(cookie) },
      select: { familyId: true },
    });
    return { bearer: `Bearer ${res.body.accessToken}`, cookie, familyId: row.familyId };
  }

  function listSessions(bearer: string, cookie?: string) {
    const req = api().get(SESSIONS).set('Authorization', bearer);
    return cookie ? req.set('Cookie', cookieHeader(cookie)) : req;
  }

  function revokeSession(bearer: string, id: string, cookie?: string) {
    const req = api().delete(`${SESSIONS}/${id}`).set('Authorization', bearer);
    return cookie ? req.set('Cookie', cookieHeader(cookie)) : req;
  }

  async function sessionsOf(session: SignedIn, cookie?: string): Promise<SessionItem[]> {
    return (await listSessions(session.bearer, cookie).expect(200)).body.items as SessionItem[];
  }

  function revokedEvents(actorUserId: string) {
    return prisma.auditLog.findMany({
      where: { actorUserId, action: REVOKED },
      orderBy: { id: 'asc' },
      select: { entityType: true, entityId: true, metadata: true },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
    configureApp(app);
    await app.init();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    passwords = new PasswordService();
    tokens = app.get(TokenService);
    passwordHash = await passwords.hash(PASSWORD);
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma?.$disconnect();
    await app?.close();
  });

  it('lists one session per sign-in, marks the one of the cookie as current, and never shows a token or a hash; reads record nothing', async () => {
    const user = await createUser('list');
    const a = await signIn(user.email, 'sessions-e2e/device-a');
    const b = await signIn(user.email, 'sessions-e2e/device-b');
    const eventsBefore = await prisma.auditLog.count({ where: { actorUserId: user.id } });

    const res = await listSessions(a.bearer, a.cookie).expect(200);
    expect(Object.keys(res.body)).toEqual(['items']);
    const items = res.body.items as SessionItem[];
    expect(items.map((item) => item.id)).toEqual([b.familyId, a.familyId]); // newest activity first
    for (const item of items) expect(Object.keys(item).sort()).toEqual(ITEM_KEYS);
    const itemA = items.find((item) => item.id === a.familyId)!;
    const itemB = items.find((item) => item.id === b.familyId)!;
    expect(itemA.current).toBe(true);
    expect(itemB.current).toBe(false);
    expect(itemA.userAgent).toBe('sessions-e2e/device-a');
    expect(itemB.userAgent).toBe('sessions-e2e/device-b');
    expect(itemA.ipAddress === null || typeof itemA.ipAddress === 'string').toBe(true);
    expect(itemA.startedAt).toBe(uuidV7Time(a.familyId)!.toISOString());

    const rowA = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: tokens.hashRefreshToken(a.cookie) } });
    expect(itemA.lastActiveAt).toBe(rowA.createdAt.toISOString());
    expect(itemA.expiresAt).toBe(rowA.expiresAt.toISOString());

    // No key names a token, a hash or the rotation chain; no value leaks the cookie or its hash.
    expect(keysOf(res.body).filter((key) => /hash|token|replaced/i.test(key))).toEqual([]);
    const body = JSON.stringify(res.body);
    for (const secret of [a.cookie, b.cookie, rowA.tokenHash]) expect(body).not.toContain(secret);

    // The current flag follows the cookie, not the access token; no cookie → nothing is current.
    expect((await sessionsOf(a, b.cookie)).find((item) => item.current)?.id).toBe(b.familyId);
    expect((await sessionsOf(a)).every((item) => !item.current)).toBe(true);
    // Another user's cookie in the same browser (KI-046) marks nothing.
    const other = await signIn((await createUser('list-other')).email);
    expect((await sessionsOf(a, other.cookie)).every((item) => !item.current)).toBe(true);

    expect(await prisma.auditLog.count({ where: { actorUserId: user.id } })).toBe(eventsBefore);
  });

  it('keeps the same session through a refresh and moves its lastActiveAt', async () => {
    const user = await createUser('refresh');
    const a = await signIn(user.email, 'sessions-e2e/before-refresh');
    const [before] = await sessionsOf(a, a.cookie);
    expect(before).toMatchObject({ id: a.familyId, current: true, userAgent: 'sessions-e2e/before-refresh' });

    await new Promise((resolve) => setTimeout(resolve, 20));
    const refreshed = await api().post(REFRESH).set('User-Agent', 'sessions-e2e/after-refresh').set('Cookie', cookieHeader(a.cookie)).expect(200);
    const nextCookie = refreshCookie(refreshed)!;
    expect(nextCookie).not.toBe(a.cookie);

    const after = await sessionsOf({ ...a, bearer: `Bearer ${refreshed.body.accessToken}` }, nextCookie);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: a.familyId, startedAt: before!.startedAt, current: true, userAgent: 'sessions-e2e/after-refresh' });
    expect(new Date(after[0]!.lastActiveAt).getTime()).toBeGreaterThan(new Date(before!.lastActiveAt).getTime());
  });

  it('revokes another session: 204 without touching the cookie, one event, and that device can no longer refresh', async () => {
    const user = await createUser('revoke-other');
    const a = await signIn(user.email);
    const b = await signIn(user.email);

    const res = await revokeSession(a.bearer, b.familyId, a.cookie).expect(204);
    expect(res.text).toBe('');
    expect(setCookieLine(res)).toBe('');

    // A revoked family answers what a revoked refresh token always answers.
    expect((await api().post(REFRESH).set('Cookie', cookieHeader(b.cookie)).expect(401)).body.code).toBe('refresh_reused');
    expect((await sessionsOf(a, a.cookie)).map((item) => item.id)).toEqual([a.familyId]);
    expect(await prisma.refreshToken.count({ where: { familyId: b.familyId, revokedAt: null } })).toBe(0);
    await api().post(REFRESH).set('Cookie', cookieHeader(a.cookie)).expect(200);

    const events = await revokedEvents(user.id);
    expect(events).toEqual([{ entityType: 'users', entityId: user.id, metadata: { familyId: b.familyId, current: false, revokedCount: 1 } }]);
    expect(keysOf(events).filter((key) => /hash|token/i.test(key))).toEqual([]);
  });

  it('revoking the current session clears the cookie; the access token keeps working until it expires', async () => {
    const user = await createUser('revoke-current');
    const a = await signIn(user.email);

    // ParseUUIDPipe accepts upper case; the session is found all the same.
    const res = await revokeSession(a.bearer, a.familyId.toUpperCase(), a.cookie).expect(204);
    const line = setCookieLine(res);
    expect(line).toMatch(/^aca_refresh=;/);
    expect(line).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(line).toMatch(/Path=\/api\/auth/);
    expect(line).toMatch(/HttpOnly/i);

    expect((await api().post(REFRESH).set('Cookie', cookieHeader(a.cookie)).expect(401)).body.code).toBe('refresh_reused');
    // Like logout: the refresh side ends now, the 15-minute access token does not.
    expect(await sessionsOf(a, a.cookie)).toEqual([]);

    expect(await revokedEvents(user.id)).toEqual([
      { entityType: 'users', entityId: user.id, metadata: { familyId: a.familyId, current: true, revokedCount: 1 } },
    ]);
  });

  it('answers 404 session_not_found for another user’s, an unknown, a revoked, an expired or an over-age session, and 400 for a malformed id — without an event', async () => {
    const user = await createUser('not-found');
    const stranger = await createUser('stranger');
    const a = await signIn(user.email);
    const theirs = await signIn(stranger.email);

    const refused = async (id: string) => {
      const res = await revokeSession(a.bearer, id, a.cookie).expect(404);
      expect(res.body).toMatchObject({ statusCode: 404, code: 'session_not_found' });
      expect(setCookieLine(res)).toBe('');
    };

    await refused(theirs.familyId);
    expect((await sessionsOf(theirs, theirs.cookie)).map((item) => item.id)).toEqual([theirs.familyId]);
    await refused(uuidV7At(new Date()));

    const revoked = await signIn(user.email);
    await revokeSession(a.bearer, revoked.familyId).expect(204);
    await refused(revoked.familyId);

    const expired = await signIn(user.email);
    await prisma.refreshToken.updateMany({ where: { familyId: expired.familyId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await refused(expired.familyId);

    // Past the family's absolute deadline (MOD-01-H03) although the token itself is still valid.
    const overAge = await signIn(user.email);
    const oldFamily = uuidV7At(new Date(Date.now() - tokens.refreshFamilyMaxMs - DAY_MS));
    await prisma.refreshToken.updateMany({ where: { familyId: overAge.familyId }, data: { familyId: oldFamily } });
    await refused(oldFamily);

    // None of them is listed; only the session of `a` is.
    expect((await sessionsOf(a, a.cookie)).map((item) => item.id)).toEqual([a.familyId]);

    const malformed = await revokeSession(a.bearer, 'not-a-uuid', a.cookie).expect(400);
    expect(JSON.stringify(malformed.body)).toMatch(/uuid/i);

    // Exactly one event: the successful revoke above.
    expect(await revokedEvents(user.id)).toEqual([
      { entityType: 'users', entityId: user.id, metadata: { familyId: revoked.familyId, current: false, revokedCount: 1 } },
    ]);
    expect(await revokedEvents(stranger.id)).toEqual([]);
  });

  it('leaves no session after logout-all', async () => {
    const user = await createUser('logout-all');
    const a = await signIn(user.email);
    await signIn(user.email);
    expect(await sessionsOf(a, a.cookie)).toHaveLength(2);

    await api().post('/api/auth/logout-all').set('Authorization', a.bearer).expect(204);
    expect(await sessionsOf(a, a.cookie)).toEqual([]);
  });

  it('needs a signed-in caller, an acceptable Origin to revoke, and is never rate-limited', async () => {
    const user = await createUser('guards');
    const a = await signIn(user.email);

    expect((await api().get(SESSIONS).expect(401)).body.code).toBe('unauthenticated');
    expect((await api().delete(`${SESSIONS}/${a.familyId}`).expect(401)).body.code).toBe('unauthenticated');
    const foreign = await revokeSession(a.bearer, a.familyId).set('Origin', 'https://evil.example').expect(403);
    expect(foreign.body.code).toBe('origin_forbidden');
    expect(await sessionsOf(a)).toHaveLength(1);

    // 12 > the "login" throttler's 10 per 15 minutes (KI-082): these routes are not under AuthThrottlerGuard.
    for (let call = 1; call <= 12; call += 1) {
      const res = await listSessions(a.bearer);
      expect(res.status, `GET ${SESSIONS} call ${call}`).toBe(200);
    }
    expect(await revokedEvents(user.id)).toEqual([]);
  });

  it(
    'documents both routes in OpenAPI',
    async () => {
      const docs = await api().get('/api/docs-json').expect(200);
      const list = docs.body.paths[SESSIONS];
      const revoke = docs.body.paths[`${SESSIONS}/{id}`];
      expect(Object.keys(list)).toEqual(['get']);
      expect(Object.keys(revoke)).toEqual(['delete']);
      expect(list.get.tags).toEqual(['auth']);
      expect(list.get.security).toEqual([{ bearer: [] }]);
      expect(revoke.delete.security).toEqual([{ bearer: [] }]);
      expect(Object.keys(list.get.responses).sort()).toEqual(['200', '401']);
      expect(Object.keys(revoke.delete.responses).sort()).toEqual(['204', '400', '401', '403', '404']);
      const item = docs.body.components.schemas.SessionItemDto;
      expect(Object.keys(item.properties).sort()).toEqual(ITEM_KEYS);
      expect(item.properties.userAgent).toMatchObject({ type: 'string', nullable: true });
      expect(item.properties.ipAddress).toMatchObject({ type: 'string', nullable: true });
      expect(item.properties.lastActiveAt).toMatchObject({ type: 'string', format: 'date-time' });
      expect(docs.body.components.schemas.SessionListDto.properties.items).toMatchObject({ type: 'array' });
    },
    20_000, // the OpenAPI document is slow under a parallel e2e run (KI-040)
  );
});
