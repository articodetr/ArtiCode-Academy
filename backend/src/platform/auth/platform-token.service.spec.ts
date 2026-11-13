// TEST-207 (unit) — MOD-18-T02 PlatformTokenService.
import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { TokenService } from '../../auth/token.service.js';
import { validateEnv } from '../../config/env.schema.js';
import type { Env } from '../../config/env.schema.js';
import { validatePlatformEnv } from '../platform.env.schema.js';
import type { PlatformEnv } from '../platform.env.schema.js';
import { PlatformHttpException } from '../platform.errors.js';
import { PlatformTokenService } from './platform-token.service.js';

const PLATFORM_SECRET = 'platform-unit-secret-'.repeat(3);
const ACADEMY_SECRET = 'academy-unit-secret-'.repeat(3);

function platformConfig(overrides: Record<string, string> = {}): ConfigService<PlatformEnv, true> {
  const env = validatePlatformEnv({ PLATFORM_JWT_SECRET: PLATFORM_SECRET, ...overrides });
  return { get: (key: keyof PlatformEnv) => env[key] } as unknown as ConfigService<PlatformEnv, true>;
}

function academyTokens(secret: string): TokenService {
  const env = validateEnv({ JWT_SECRET: secret });
  return new TokenService({ get: (key: keyof Env) => env[key] } as unknown as ConfigService<Env, true>);
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => error instanceof PlatformHttpException && error.code === code && error.getStatus() === 401,
    `expected platform error ${code}`,
  );
}

describe('PlatformTokenService', () => {
  it('signs access tokens with subject, role, the platform issuer and audience, a jti and an expiry', async () => {
    const service = new PlatformTokenService(platformConfig({ PLATFORM_JWT_ACCESS_TTL_SECONDS: '120' }));
    const userId = randomUUID();
    const signed = await service.signAccessToken({ userId, role: 'support' });
    expect(signed.expiresIn).toBe(120);
    const claims = await service.verifyAccessToken(signed.token);
    expect(claims).toMatchObject({ sub: userId, role: 'support' });
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(claims.exp - claims.iat).toBe(120);
    expect(service.issuer).toBe('articode-platform');
    expect(service.audience).toBe('articode-platform-api');
  });

  it('rejects an academy access token — with another secret, and even with the same secret (issuer and audience)', async () => {
    const service = new PlatformTokenService(platformConfig());
    const fromAcademy = await academyTokens(ACADEMY_SECRET).signAccessToken({ userId: randomUUID(), roles: ['academy_admin'] });
    await expectCode(service.verifyAccessToken(fromAcademy.token), 'token_invalid');

    const sameSecret = await academyTokens(PLATFORM_SECRET).signAccessToken({ userId: randomUUID(), roles: ['academy_admin'] });
    await expectCode(service.verifyAccessToken(sameSecret.token), 'token_invalid');
  });

  it('a platform token is rejected by the academy TokenService', async () => {
    const platformToken = await new PlatformTokenService(platformConfig()).signAccessToken({ userId: randomUUID(), role: 'super_admin' });
    await expect(academyTokens(PLATFORM_SECRET).verifyAccessToken(platformToken.token)).rejects.toMatchObject({ code: 'token_invalid' });
  });

  it('rejects expired, tampered, wrong-audience, wrong-issuer and malformed tokens', async () => {
    const service = new PlatformTokenService(platformConfig());
    const userId = randomUUID();
    const expired = await service.signAccessToken({ userId, role: 'super_admin' }, -30);
    await expectCode(service.verifyAccessToken(expired.token), 'token_expired');

    const good = await service.signAccessToken({ userId, role: 'super_admin' });
    const [header, payload] = good.token.split('.');
    await expectCode(service.verifyAccessToken(`${header}.${payload}.AAAA`), 'token_invalid');
    await expectCode(service.verifyAccessToken('garbage'), 'token_invalid');

    const key = new TextEncoder().encode(PLATFORM_SECRET);
    const sign = (claims: Record<string, unknown>, issuer: string, audience: string, subject: string = userId) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(subject)
        .setIssuer(issuer)
        .setAudience(audience)
        .setJti(randomUUID())
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(key);
    await expectCode(service.verifyAccessToken(await sign({ role: 'super_admin' }, 'articode-platform', 'articode-academy-api')), 'token_invalid');
    await expectCode(service.verifyAccessToken(await sign({ role: 'super_admin' }, 'articode-academy', 'articode-platform-api')), 'token_invalid');
    // Claims the platform does not issue: no role, an unknown role, a subject that is not a uuid.
    await expectCode(service.verifyAccessToken(await sign({}, 'articode-platform', 'articode-platform-api')), 'token_invalid');
    await expectCode(service.verifyAccessToken(await sign({ role: 'academy_admin' }, 'articode-platform', 'articode-platform-api')), 'token_invalid');
    await expectCode(service.verifyAccessToken(await sign({ role: 'support' }, 'articode-platform', 'articode-platform-api', 'user-1')), 'token_invalid');
    // Another algorithm with the same key.
    const hs512 = await new SignJWT({ role: 'super_admin' })
      .setProtectedHeader({ alg: 'HS512' })
      .setSubject(userId)
      .setIssuer('articode-platform')
      .setAudience('articode-platform-api')
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(PLATFORM_SECRET.repeat(2)));
    await expectCode(service.verifyAccessToken(hs512), 'token_invalid');
  });

  it('an ephemeral key (no PLATFORM_JWT_SECRET) does not verify the tokens of another process', async () => {
    const first = new PlatformTokenService(platformConfig({ PLATFORM_JWT_SECRET: '' }));
    const second = new PlatformTokenService(platformConfig({ PLATFORM_JWT_SECRET: '' }));
    const token = await first.signAccessToken({ userId: randomUUID(), role: 'support' });
    await expect(first.verifyAccessToken(token.token)).resolves.toMatchObject({ role: 'support' });
    await expectCode(second.verifyAccessToken(token.token), 'token_invalid');
  });

  it('refresh helpers: a random token with its SHA-256 hash, the expiry capped by the family deadline', () => {
    const service = new PlatformTokenService(platformConfig({ PLATFORM_REFRESH_TTL_DAYS: '7', PLATFORM_REFRESH_FAMILY_MAX_DAYS: '14' }));
    const a = service.newRefreshToken();
    const b = service.newRefreshToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(service.hashRefreshToken(a.token)).toBe(a.hash);

    const from = new Date('2026-11-13T10:00:00Z');
    expect(service.refreshExpiry(from).toISOString()).toBe('2026-11-20T10:00:00.000Z');
    const deadline = new Date('2026-11-15T00:00:00Z');
    expect(service.refreshExpiry(from, deadline).toISOString()).toBe(deadline.toISOString());
    // 019a7d00-0000-7000-8000-000000000000 starts at 0x019a7d000000 ms.
    const familyId = '019a7d00-0000-7000-8000-000000000000';
    expect(service.familyDeadline(familyId)?.getTime()).toBe(0x019a7d000000 + 14 * 24 * 60 * 60 * 1000);
    expect(service.familyDeadline('not-a-uuid')).toBeNull();
  });
});
