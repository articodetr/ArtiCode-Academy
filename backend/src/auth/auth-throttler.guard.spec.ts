// KI-098 (D-R140) — the limits of the session refresh in AuthThrottlerGuard:
// per (IP, cookie digest) on `login`, a refresh without the cookie never counted
// per client, and the per-IP ceiling `refresh_ip` on that route and no other.
// The guard runs against a recording storage (no Nest app, no database).
import { createHash } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { describe, expect, it, vi } from 'vitest';
import {
  AuthThrottlerGuard,
  isRefreshRoute,
  REFRESH_CLIENT_LIMIT,
  REFRESH_IP_LIMIT,
  REFRESH_IP_THROTTLER,
  REFRESH_IP_THROTTLER_OPTIONS,
  REFRESH_TTL_MS,
  refreshClientTracker,
  RefreshThrottle,
} from './auth-throttler.guard.js';
import { AuthHttpException } from './auth.errors.js';
import { REFRESH_COOKIE_NAME } from './cookies.js';

// Shaped like a real token (43 base64url characters) and full of characters no hex digest can hold.
const COOKIE = 'Zq9-xK_pRwTyUvLmNoQsJiHgFeDcBaZyXwVuTsRqPoN';
const OTHER_COOKIE = 'Yp8-wJ_oQvSxTuKlMnPrIhGfEdCbAzYxWvUtSrQpOnM';
const LOGIN_DEFINITION = { name: 'login', ttl: 15 * 60 * 1000, limit: 10 };

const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);

class FakeController {
  @RefreshThrottle()
  refresh(): void {}

  @Throttle({ login: { limit: 10, ttl: 15 * 60 * 1000 } })
  login(): void {}

  @Throttle({ login: { limit: 60, ttl: 60 * 1000 } })
  publicRead(): void {}

  @SkipThrottle({ login: true })
  me(): void {}
}

type Handler = 'refresh' | 'login' | 'publicRead' | 'me';

interface Hit {
  name: string;
  key: string;
  limit: number;
  ttl: number;
}

function contextFor(handler: Handler, req: Record<string, any>) {
  const res = { header: vi.fn() };
  const context = {
    getHandler: () => FakeController.prototype[handler],
    getClass: () => FakeController,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res, getNext: () => undefined }),
  } as unknown as ExecutionContext;
  return { context, res };
}

/** The guard with the app's two throttlers and a storage that records every count; `blocked` names refuse. */
async function harness(blocked: string[] = []) {
  const hits: Hit[] = [];
  const storage: ThrottlerStorage = {
    increment: async (key, ttl, limit, _blockDuration, name) => {
      hits.push({ name, key, limit, ttl });
      const isBlocked = blocked.includes(name);
      return { totalHits: isBlocked ? limit + 1 : 1, timeToExpire: 60, isBlocked, timeToBlockExpire: isBlocked ? 42 : 0 };
    },
  };
  const guard = new AuthThrottlerGuard(
    {
      throttlers: [LOGIN_DEFINITION, REFRESH_IP_THROTTLER_OPTIONS],
      // A readable storage key `<throttler>#<tracker>` (the library hashes it).
      generateKey: (_context, tracker, name) => `${name}#${tracker}`,
    },
    storage,
    new Reflector(),
  );
  await guard.onModuleInit();
  return { guard, hits };
}

function request(ip: string, cookie?: string, body?: Record<string, unknown>): Record<string, any> {
  return { ip, headers: cookie === undefined ? {} : { cookie }, body };
}

describe('AuthThrottlerGuard — the session refresh (KI-098, D-R140)', () => {
  it('counts a refresh with a cookie per (IP, cookie digest) and in the per-IP ceiling — never the cookie itself', async () => {
    const { guard, hits } = await harness();
    // A body identifier does not choose the key of a refresh (the route has its own tracker).
    const req = request('203.0.113.7', `theme=dark; ${REFRESH_COOKIE_NAME}=${COOKIE}`, { identifier: 'someone@example.test' });
    await expect(guard.canActivate(contextFor('refresh', req).context)).resolves.toBe(true);

    expect(hits).toEqual([
      { name: REFRESH_IP_THROTTLER, key: `${REFRESH_IP_THROTTLER}#203.0.113.7`, limit: REFRESH_IP_LIMIT, ttl: REFRESH_TTL_MS },
      { name: 'login', key: `login#203.0.113.7|refresh:${digest(COOKIE)}`, limit: REFRESH_CLIENT_LIMIT, ttl: REFRESH_TTL_MS },
    ]);
    expect(refreshClientTracker(req)).toBe(`203.0.113.7|refresh:${digest(COOKIE)}`);
    expect(JSON.stringify(hits)).not.toContain(COOKIE);
    expect(refreshClientTracker(req)).not.toContain(COOKIE);
  });

  it('gives every presented cookie its own budget, while the ceiling stays one per IP', async () => {
    const { guard, hits } = await harness();
    for (const cookie of [COOKIE, OTHER_COOKIE]) {
      await guard.canActivate(contextFor('refresh', request('203.0.113.7', `${REFRESH_COOKIE_NAME}=${cookie}`)).context);
    }
    const login = hits.filter((hit) => hit.name === 'login').map((hit) => hit.key);
    const ceiling = hits.filter((hit) => hit.name === REFRESH_IP_THROTTLER).map((hit) => hit.key);
    expect(login).toEqual([`login#203.0.113.7|refresh:${digest(COOKIE)}`, `login#203.0.113.7|refresh:${digest(OTHER_COOKIE)}`]);
    expect(ceiling).toEqual([`${REFRESH_IP_THROTTLER}#203.0.113.7`, `${REFRESH_IP_THROTTLER}#203.0.113.7`]);
  });

  it('never counts a refresh without the cookie per client — only in the per-IP ceiling', async () => {
    const { guard, hits } = await harness();
    for (const cookie of [undefined, `${REFRESH_COOKIE_NAME}=`, 'theme=dark']) {
      await expect(guard.canActivate(contextFor('refresh', request('203.0.113.7', cookie)).context)).resolves.toBe(true);
    }
    expect(hits.map((hit) => hit.name)).toEqual([REFRESH_IP_THROTTLER, REFRESH_IP_THROTTLER, REFRESH_IP_THROTTLER]);
    expect(hits.every((hit) => hit.key === `${REFRESH_IP_THROTTLER}#203.0.113.7`)).toBe(true);
  });

  it('counts the ceiling per IP: an IPv4-mapped address as IPv4, an IPv6 address by its /64', async () => {
    const { context } = contextFor('refresh', {});
    const tracker = REFRESH_IP_THROTTLER_OPTIONS.getTracker!;
    expect(await tracker({ ip: '::ffff:198.51.100.4' }, context)).toBe('198.51.100.4');
    expect(await tracker({ ip: '2001:db8:1:2:aaaa:bbbb:cccc:dddd' }, context)).toBe('2001:db8:1:2::/64');
    expect(await tracker({ ip: '2001:db8:1:2:1:1:1:1', headers: { cookie: `${REFRESH_COOKIE_NAME}=${COOKIE}` } }, context)).toBe('2001:db8:1:2::/64');
  });

  it('leaves every other route exactly as it was: the ceiling never counts or marks it', async () => {
    const { guard, hits } = await harness();
    const login = contextFor('login', request('203.0.113.7', `${REFRESH_COOKIE_NAME}=${COOKIE}`, { identifier: ' Admin@Example.TEST ' }));
    await guard.canActivate(login.context);
    const read = contextFor('publicRead', request('203.0.113.7'));
    await guard.canActivate(read.context);
    const me = contextFor('me', request('203.0.113.7', `${REFRESH_COOKIE_NAME}=${COOKIE}`));
    await guard.canActivate(me.context);

    expect(hits).toEqual([
      { name: 'login', key: 'login#203.0.113.7|admin@example.test', limit: 10, ttl: 15 * 60 * 1000 },
      { name: 'login', key: 'login#203.0.113.7', limit: 60, ttl: 60 * 1000 },
    ]);
    const headers = [login, read, me].flatMap(({ res }) => res.header.mock.calls.map((call) => String(call[0])));
    expect(headers.filter((name) => name.includes(REFRESH_IP_THROTTLER))).toEqual([]);
    for (const handler of ['login', 'publicRead', 'me'] as const) {
      expect(isRefreshRoute(contextFor(handler, {}).context)).toBe(false);
    }
    expect(isRefreshRoute(contextFor('refresh', {}).context)).toBe(true);
  });

  it.each([
    [REFRESH_IP_THROTTLER, `${REFRESH_COOKIE_NAME}=${COOKIE}`, 'Retry-After-refresh_ip'],
    [REFRESH_IP_THROTTLER, undefined, 'Retry-After-refresh_ip'],
    ['login', `${REFRESH_COOKIE_NAME}=${COOKIE}`, 'Retry-After-login'],
  ])('answers a refusal of %s (cookie %s) with 429 rate_limited and the %s header', async (name, cookie, header) => {
    const { guard } = await harness([name]);
    const { context, res } = contextFor('refresh', request('203.0.113.7', cookie));
    const failure = await guard.canActivate(context).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AuthHttpException);
    expect((failure as AuthHttpException).getStatus()).toBe(429);
    expect((failure as AuthHttpException).getResponse()).toMatchObject({ statusCode: 429, code: 'rate_limited' });
    expect(res.header).toHaveBeenCalledWith(header, 42);
  });
});
