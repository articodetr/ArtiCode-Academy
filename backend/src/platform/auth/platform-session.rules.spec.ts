// TEST-208 (unit) — MOD-18-T03 the pure rules of the platform sessions and
// account creation, and the platform refresh cookie.
import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { describe, expect, it } from 'vitest';
import { REFRESH_COOKIE_NAME, readRefreshCookie } from '../../auth/cookies.js';
import { validatePlatformEnv } from '../platform.env.schema.js';
import type { PlatformEnv } from '../platform.env.schema.js';
import { bootstrapDecision, platformUserInputProblems } from './platform-bootstrap.js';
import {
  PLATFORM_REFRESH_COOKIE_NAME,
  platformRefreshCookieOptions,
  presentPlatformSession,
  readPlatformRefreshCookie,
} from './platform-cookies.js';
import {
  failedLoginLocks,
  isPlatformEmail,
  lockRemainingSeconds,
  normalizePlatformEmail,
  platformNewPasswordProblems,
  platformPasswordProblems,
  refreshVerdict,
} from './platform-session.rules.js';

const STRONG = 'a-strong-platform-pass';

describe('platform password and e-mail rules', () => {
  it('needs 12 to 128 characters, not only whitespace, and a new password different from the current one', () => {
    expect(platformPasswordProblems(STRONG)).toEqual([]);
    expect(platformPasswordProblems('short-pass1')).toEqual(['at least 12 characters']);
    expect(platformPasswordProblems(' '.repeat(12))).toEqual(['not only whitespace']);
    expect(platformPasswordProblems('x'.repeat(129))).toEqual(['at most 128 characters']);
    expect(platformNewPasswordProblems(STRONG, STRONG)).toEqual(['different from the current password']);
    expect(platformNewPasswordProblems(`${STRONG}!`, STRONG)).toEqual([]);
  });

  it('normalizes the login e-mail like the CHECK of platform_users and validates it', () => {
    expect(normalizePlatformEmail('  Ops@Example.COM ')).toBe('ops@example.com');
    expect(isPlatformEmail('ops@example.com')).toBe(true);
    expect(isPlatformEmail('ops@localhost')).toBe(false);
    expect(isPlatformEmail('not an e-mail')).toBe(false);
    expect(isPlatformEmail(`${'a'.repeat(310)}@example.com`)).toBe(false);
  });
});

describe('lock and failed sign-ins', () => {
  const now = new Date('2026-11-13T10:00:00Z');

  it('a lock in the future reports the seconds left, rounded up; a passed or missing lock is null', () => {
    expect(lockRemainingSeconds(new Date('2026-11-13T10:01:30.200Z'), now)).toBe(91);
    expect(lockRemainingSeconds(new Date('2026-11-13T10:00:00Z'), now)).toBeNull();
    expect(lockRemainingSeconds(new Date('2026-11-13T09:59:00Z'), now)).toBeNull();
    expect(lockRemainingSeconds(null, now)).toBeNull();
  });

  it('the attempt that reaches the threshold locks', () => {
    expect(failedLoginLocks(4, 5)).toBe(false);
    expect(failedLoginLocks(5, 5)).toBe(true);
    expect(failedLoginLocks(6, 5)).toBe(true);
  });
});

describe('refreshVerdict', () => {
  const now = new Date('2026-11-13T10:00:00Z');
  const live = { revokedAt: null, replacedById: null, expiresAt: new Date('2026-11-14T00:00:00Z') };
  const deadline = new Date('2026-11-20T00:00:00Z');

  it('rotates a live token inside its family deadline', () => {
    expect(refreshVerdict(live, deadline, now)).toBe('rotate');
  });

  it('a rotated or revoked token is reuse — before any expiry check', () => {
    expect(refreshVerdict({ ...live, replacedById: '019a7d00-0000-7000-8000-000000000001' }, deadline, now)).toBe('reused');
    expect(refreshVerdict({ ...live, revokedAt: now, expiresAt: new Date('2026-11-01T00:00:00Z') }, null, now)).toBe('reused');
  });

  it('expired: its own expiry, the family deadline, or a family id that is not a UUIDv7 (fail closed)', () => {
    expect(refreshVerdict({ ...live, expiresAt: now }, deadline, now)).toBe('expired');
    expect(refreshVerdict(live, now, now)).toBe('expired');
    expect(refreshVerdict(live, null, now)).toBe('expired');
  });
});

describe('account creation rules', () => {
  it('lists every problem of the input and never echoes the password', () => {
    expect(platformUserInputProblems({ email: 'ops@example.com', fullName: 'Ops Person', password: STRONG, role: 'support' })).toEqual([]);
    const problems = platformUserInputProblems({ email: 'nope', fullName: ' x ', password: 'tiny-secret', role: 'owner' });
    expect(problems).toEqual([
      'email must be a valid address',
      'full name must have at least 2 characters',
      'role must be one of super_admin, support',
      'password must be at least 12 characters',
    ]);
    expect(problems.join(' ')).not.toContain('tiny-secret');
  });

  it('bootstrapDecision: refuses a second super admin, is a no-op for the same e-mail, refuses an e-mail in use, else creates', () => {
    const admin = { id: 'a1', email: 'first@example.com' };
    expect(bootstrapDecision([admin], 'other@example.com', null)).toEqual({ outcome: 'refused', reason: 'super_admin_exists' });
    expect(bootstrapDecision([admin], 'first@example.com', 'a1')).toEqual({ outcome: 'already_bootstrapped', userId: 'a1' });
    expect(bootstrapDecision([], 'support@example.com', 's1')).toEqual({ outcome: 'refused', reason: 'email_in_use' });
    expect(bootstrapDecision([], 'first@example.com', null)).toEqual({ outcome: 'create' });
  });
});

describe('the platform refresh cookie', () => {
  function config(overrides: Record<string, string> = {}): ConfigService<PlatformEnv, true> {
    const env = validatePlatformEnv(overrides);
    return { get: (key: keyof PlatformEnv) => env[key] } as unknown as ConfigService<PlatformEnv, true>;
  }

  it('is named pla_refresh — the platform never reads aca_refresh and the academy never reads pla_refresh', () => {
    expect(PLATFORM_REFRESH_COOKIE_NAME).toBe('pla_refresh');
    expect(PLATFORM_REFRESH_COOKIE_NAME).not.toBe(REFRESH_COOKIE_NAME);
    const academyOnly = { headers: { cookie: `${REFRESH_COOKIE_NAME}=academy-token` } };
    const platformOnly = { headers: { cookie: `${PLATFORM_REFRESH_COOKIE_NAME}=platform-token` } };
    const both = { headers: { cookie: `${REFRESH_COOKIE_NAME}=academy-token; ${PLATFORM_REFRESH_COOKIE_NAME}=platform-token` } };
    expect(readPlatformRefreshCookie(academyOnly)).toBeUndefined();
    expect(readPlatformRefreshCookie(platformOnly)).toBe('platform-token');
    expect(readPlatformRefreshCookie(both)).toBe('platform-token');
    expect(readRefreshCookie(platformOnly as never)).toBeUndefined();
    expect(readRefreshCookie(both as never)).toBe('academy-token');
    expect(readPlatformRefreshCookie({ headers: { cookie: `${PLATFORM_REFRESH_COOKIE_NAME}=` } })).toBeUndefined();
  });

  it('takes Secure from PLATFORM_COOKIE_SECURE (default: production only) and the path /<prefix>/auth', () => {
    const tokens = { refreshTtlMs: 7 * 86_400_000 };
    expect(platformRefreshCookieOptions(config(), tokens)).toEqual({ secure: false, path: '/api/auth', maxAgeMs: tokens.refreshTtlMs });
    expect(platformRefreshCookieOptions(config({ PLATFORM_COOKIE_SECURE: 'true' }), tokens).secure).toBe(true);
    expect(platformRefreshCookieOptions(config({ API_PREFIX: 'api/v1' }), tokens).path).toBe('/api/v1/auth');
  });

  it('presentPlatformSession sets an httpOnly SameSite=Strict cookie capped at the token expiry and returns no refresh token', () => {
    const set: { name: string; value: string; options: Record<string, unknown> }[] = [];
    const res = {
      cookie: (name: string, value: string, options: Record<string, unknown>) => set.push({ name, value, options }),
    } as unknown as Response;
    const user = { id: 'u1', email: 'ops@example.com', fullName: 'Ops', role: 'support' as const, status: 'active' as const };
    const body = presentPlatformSession(
      res,
      { accessToken: 'access', expiresIn: 900, refreshToken: 'refresh', refreshExpiresAt: new Date(Date.now() + 60_000), user },
      { secure: true, path: '/api/auth', maxAgeMs: 7 * 86_400_000 },
    );
    expect(body).toEqual({ tokenType: 'Bearer', accessToken: 'access', expiresIn: 900, user });
    expect(JSON.stringify(body)).not.toContain('refresh');
    expect(set).toHaveLength(1);
    expect(set[0]).toMatchObject({ name: 'pla_refresh', value: 'refresh', options: { httpOnly: true, secure: true, sameSite: 'strict', path: '/api/auth' } });
    expect(set[0]!.options['maxAge']).toBeLessThanOrEqual(60_000);
    expect(set[0]!.options['maxAge']).toBeGreaterThan(55_000);
  });
});
