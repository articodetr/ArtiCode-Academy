// KI-098 (D-R140) — the limits of the session refresh (API-006 POST
// /api/auth/refresh) against the live development database: the `login`
// throttler counts a refresh per (IP, digest of the presented cookie), a
// refresh without the cookie is not counted per client, and the second named
// throttler `refresh_ip` caps every refresh of one IP — on that route only.
// Every request comes from 127.0.0.1, as every client behind one school NAT
// would. A replayed rotated token records at most one reuse event for a family
// that is already dead (the KI-098 follow-up). Skipped when no database is
// reachable. The fixture users carry a unique suffix and are deleted at the end
// (cascade removes their tokens; their audit rows stay — the log is append-only).
import { randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import request from 'supertest';
import type { Response as SupertestResponse } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_CREATE_OPTIONS, configureApp } from '../src/app.setup.js';
import { REFRESH_CLIENT_LIMIT, REFRESH_IP_LIMIT, REFRESH_IP_THROTTLER } from '../src/auth/auth-throttler.guard.js';
import { REFRESH_COOKIE_NAME } from '../src/auth/cookies.js';
import { PasswordService } from '../src/auth/password.service.js';
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
const ACADEMY_PUBLIC = '/api/academy/public';
const CEILING_HEADER = `x-ratelimit-limit-${REFRESH_IP_THROTTLER}`;
const REUSE_EVENT = 'auth.refresh.reuse_detected';

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

/** A fresh app — and with it a fresh in-memory throttler storage — listening on 127.0.0.1. */
async function bootApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>(APP_CREATE_OPTIONS);
  configureApp(app);
  // Listening first: concurrent supertest requests then share this address
  // instead of each calling listen() on the same server.
  await app.listen(0, '127.0.0.1');
  return app;
}

/** A value shaped like a real refresh token (32 random bytes, base64url) that matches no session. */
const randomCookie = () => randomBytes(32).toString('base64url');

/** The refresh cookie value from a response, or undefined when cleared/absent. */
function refreshCookie(res: SupertestResponse): string | undefined {
  const header = res.headers['set-cookie'];
  const cookies: string[] = Array.isArray(header) ? header : header ? [header] : [];
  const line = cookies.find((cookie) => cookie.startsWith(`${REFRESH_COOKIE_NAME}=`));
  const value = line?.split(';')[0]!.slice(REFRESH_COOKIE_NAME.length + 1);
  return value ? value : undefined;
}

interface Outcome {
  status: number;
  code: unknown;
}

/** Sends `count` requests, `concurrency` at a time; the outcomes in request order. */
async function inParallel(count: number, concurrency: number, send: (index: number) => Promise<SupertestResponse>): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  let next = 0;
  const worker = async () => {
    while (next < count) {
      const index = next;
      next += 1;
      const res = await send(index);
      outcomes[index] = { status: res.status, code: (res.body as { code?: unknown }).code };
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, count) }, worker));
  return outcomes;
}

describe.skipIf(!available)('KI-098 session-refresh limits (e2e, D-R140)', () => {
  describe('per client', () => {
    let app: NestExpressApplication;
    let prisma: PrismaClient;
    const createdUserIds: string[] = [];

    const api = () => request(app.getHttpServer());
    const refresh = (cookie?: string) => {
      const req = api().post(REFRESH);
      return cookie === undefined ? req : req.set('Cookie', `${REFRESH_COOKIE_NAME}=${cookie}`);
    };

    beforeAll(async () => {
      app = await bootApp();
      prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
    });

    afterAll(async () => {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await prisma?.$disconnect();
      await app?.close();
    });

    it('still refreshes and rotates a real session; login keeps its own limit and never meets the ceiling', async () => {
      const passwordHash = await new PasswordService().hash(PASSWORD);
      const user = await prisma.user.create({
        data: { email: `refresh-throttle-${RUN}@example.test`, fullName: 'Refresh Throttle', passwordHash, status: 'active' },
        select: { id: true, email: true },
      });
      createdUserIds.push(user.id);

      const login = await api().post(LOGIN).send({ identifier: user.email, password: PASSWORD }).expect(200);
      expect(login.headers['x-ratelimit-limit-login']).toBe('10');
      expect(login.headers[CEILING_HEADER]).toBeUndefined();
      const first = refreshCookie(login)!;

      const rotated = await refresh(first).expect(200);
      const second = refreshCookie(rotated)!;
      expect(second).toBeDefined();
      expect(second).not.toBe(first);
      expect(rotated.body.user.id).toBe(user.id);
      expect(rotated.headers['x-ratelimit-limit-login']).toBe(String(REFRESH_CLIENT_LIMIT));
      expect(rotated.headers[CEILING_HEADER]).toBe(String(REFRESH_IP_LIMIT));
      // The rotated cookie is a new client key: it refreshes again at once.
      const again = await refresh(second).expect(200);
      expect(again.headers['x-ratelimit-remaining-login']).toBe(String(REFRESH_CLIENT_LIMIT - 1));
    });

    it(`answers 429 rate_limited once one cookie has refreshed ${REFRESH_CLIENT_LIMIT} times in a minute — and no other client`, async () => {
      const looping = randomCookie();
      const outcomes: Outcome[] = [];
      for (let attempt = 1; attempt <= REFRESH_CLIENT_LIMIT + 1; attempt += 1) {
        const res = await refresh(looping);
        outcomes.push({ status: res.status, code: res.body.code });
        if (attempt === REFRESH_CLIENT_LIMIT + 1) expect(res.headers['retry-after-login']).toBeDefined();
      }
      expect(outcomes.slice(0, REFRESH_CLIENT_LIMIT)).toEqual(Array(REFRESH_CLIENT_LIMIT).fill({ status: 401, code: 'refresh_invalid' }));
      expect(outcomes[REFRESH_CLIENT_LIMIT]).toEqual({ status: 429, code: 'rate_limited' });

      // The same address with another cookie, or with none, is untouched.
      expect((await refresh(randomCookie()).expect(401)).body.code).toBe('refresh_invalid');
      expect((await refresh().expect(401)).body.code).toBe('refresh_missing');
    });

    it('never answers 429 to 40 clients behind one address with a cookie each (one school NAT)', async () => {
      const outcomes = await inParallel(40, 10, () => refresh(randomCookie()));
      expect(outcomes.filter((outcome) => outcome.status === 429)).toEqual([]);
      expect(outcomes).toEqual(Array(40).fill({ status: 401, code: 'refresh_invalid' }));
    });

    it('never answers 429 to 40 refreshes without a cookie from one address', async () => {
      const outcomes = await inParallel(40, 10, () => refresh());
      expect(outcomes.filter((outcome) => outcome.status === 429)).toEqual([]);
      expect(outcomes).toEqual(Array(40).fill({ status: 401, code: 'refresh_missing' }));
    });

    it('leaves the other routes behind AuthThrottlerGuard without the ceiling', async () => {
      const read = await api().get(ACADEMY_PUBLIC);
      expect(read.status).not.toBe(429);
      expect(read.headers['x-ratelimit-limit-login']).toBe('60');
      expect(Object.keys(read.headers).filter((name) => name.includes(REFRESH_IP_THROTTLER))).toEqual([]);
    });
  });

  // KI-098 follow-up: with a refresh budget per cookie, replaying rotated tokens in a loop must not write
  // one append-only audit row per request — at most one `auth.refresh.reuse_detected` per dead family.
  describe('refresh-token reuse events', () => {
    let app: NestExpressApplication;
    let prisma: PrismaClient;
    let tokens: TokenService;
    let passwordHash: string;
    const createdUserIds: string[] = [];

    const api = () => request(app.getHttpServer());
    const refresh = (cookie: string) => api().post(REFRESH).set('Cookie', `${REFRESH_COOKIE_NAME}=${cookie}`);

    async function signIn(name: string): Promise<{ userId: string; cookie: string; familyId: string }> {
      const user = await prisma.user.create({
        data: { email: `refresh-reuse-${name}-${RUN}@example.test`, fullName: `Refresh Reuse ${name}`, passwordHash, status: 'active' },
        select: { id: true, email: true },
      });
      createdUserIds.push(user.id);
      const res = await api().post(LOGIN).send({ identifier: user.email, password: PASSWORD }).expect(200);
      const cookie = refreshCookie(res)!;
      const row = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: tokens.hashRefreshToken(cookie) }, select: { familyId: true } });
      return { userId: user.id, cookie, familyId: row.familyId };
    }

    async function rotate(cookie: string): Promise<string> {
      return refreshCookie(await refresh(cookie).expect(200))!;
    }

    /** The reuse events of one family (metadata.familyId), whatever else the user's log holds. */
    async function reuseEvents(userId: string, familyId: string) {
      const events = await prisma.auditLog.findMany({
        where: { action: REUSE_EVENT, entityType: 'users', entityId: userId },
        select: { metadata: true },
      });
      return events.filter((event) => (event.metadata as { familyId?: unknown } | null)?.familyId === familyId);
    }

    async function liveTokens(familyId: string): Promise<number> {
      return prisma.refreshToken.count({ where: { familyId, revokedAt: null } });
    }

    beforeAll(async () => {
      app = await bootApp();
      prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL! }) });
      tokens = app.get(TokenService);
      passwordHash = await new PasswordService().hash(PASSWORD);
    });

    afterAll(async () => {
      if (createdUserIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await prisma?.$disconnect();
      await app?.close();
    });

    it('records the replay that kills a family with live tokens once, and none of the replays after it', async () => {
      const session = await signIn('live');
      const second = await rotate(session.cookie);
      const third = await rotate(second);
      expect(await liveTokens(session.familyId)).toBe(1);

      // The first replay revokes the live token: the theft signal, recorded.
      expect((await refresh(session.cookie).expect(401)).body.code).toBe('refresh_reused');
      expect(await liveTokens(session.familyId)).toBe(0);
      expect(await reuseEvents(session.userId, session.familyId)).toEqual([{ metadata: { familyId: session.familyId } }]);

      // The family is dead now: replaying any of its tokens again answers the same and records nothing more.
      for (const cookie of [session.cookie, session.cookie, second, third]) {
        expect((await refresh(cookie).expect(401)).body.code).toBe('refresh_reused');
      }
      expect(await reuseEvents(session.userId, session.familyId)).toHaveLength(1);
    });

    it('records the first replay into a family ended on purpose exactly once, however often it is replayed', async () => {
      const session = await signIn('dead');
      const second = await rotate(session.cookie);
      // A deliberate end of the session: nothing is live any more when the rotated token is replayed.
      await api().post('/api/auth/logout').set('Cookie', `${REFRESH_COOKIE_NAME}=${second}`).expect(204);
      expect(await liveTokens(session.familyId)).toBe(0);

      for (let replay = 1; replay <= 5; replay += 1) {
        expect((await refresh(session.cookie).expect(401)).body.code).toBe('refresh_reused');
      }
      expect((await refresh(second).expect(401)).body.code).toBe('refresh_reused');
      // The first sign of reuse after the logout stays visible; the loop adds no row.
      expect(await reuseEvents(session.userId, session.familyId)).toEqual([{ metadata: { familyId: session.familyId } }]);
    });
  });

  describe('the per-IP ceiling', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await bootApp();
    });

    afterAll(async () => {
      await app?.close();
    });

    it(
      `answers 429 rate_limited once one address has refreshed ${REFRESH_IP_LIMIT} times in a minute, whatever its cookie`,
      async () => {
        const api = () => request(app.getHttpServer());
        const startedAt = Date.now();
        // Every fifth with a forged cookie (one database lookup each), the others with none.
        const outcomes = await inParallel(REFRESH_IP_LIMIT, 25, (index) =>
          index % 5 === 0 ? api().post(REFRESH).set('Cookie', `${REFRESH_COOKIE_NAME}=${randomCookie()}`) : api().post(REFRESH),
        );
        // Every count above happened inside the one-minute window.
        expect(Date.now() - startedAt).toBeLessThan(55_000);
        expect(outcomes.filter((outcome) => outcome.status !== 401)).toEqual([]);

        const limited = await api().post(REFRESH);
        expect(limited.status).toBe(429);
        expect(limited.body).toMatchObject({ statusCode: 429, code: 'rate_limited' });
        expect(limited.headers[`retry-after-${REFRESH_IP_THROTTLER}`]).toBeDefined();
        // The ceiling stops a fresh cookie of the same address too.
        const fresh = await api().post(REFRESH).set('Cookie', `${REFRESH_COOKIE_NAME}=${randomCookie()}`);
        expect(fresh.status).toBe(429);
        expect(fresh.body.code).toBe('rate_limited');
      },
      90_000,
    );
  });
});
