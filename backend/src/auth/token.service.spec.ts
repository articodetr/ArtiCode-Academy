import type { ConfigService } from '@nestjs/config';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { validateEnv } from '../config/env.schema.js';
import type { Env } from '../config/env.schema.js';
import { AuthHttpException } from './auth.errors.js';
import { TokenService } from './token.service.js';

const SECRET = 'unit-test-secret-'.repeat(3);

function configFor(overrides: Record<string, string> = {}): ConfigService<Env, true> {
  const env = validateEnv({ JWT_SECRET: SECRET, ...overrides });
  return {
    get: (key: keyof Env) => env[key],
  } as unknown as ConfigService<Env, true>;
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => error instanceof AuthHttpException && error.code === code,
    `expected auth error ${code}`,
  );
}

describe('TokenService', () => {
  it('signs access tokens with subject, roles, issuer, audience, jti and expiry', async () => {
    const service = new TokenService(configFor({ JWT_ACCESS_TTL_SECONDS: '120' }));
    const signed = await service.signAccessToken({ userId: 'user-1', roles: ['teacher', 'staff'] });
    expect(signed.expiresIn).toBe(120);
    const claims = await service.verifyAccessToken(signed.token);
    expect(claims.sub).toBe('user-1');
    expect(claims.roles).toEqual(['teacher', 'staff']);
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(claims.exp - claims.iat).toBe(120);
  });

  it('rejects expired, tampered, foreign-issuer and foreign-audience tokens', async () => {
    const service = new TokenService(configFor());
    const expired = await service.signAccessToken({ userId: 'u', roles: [] }, -30);
    await expectCode(service.verifyAccessToken(expired.token), 'token_expired');

    const good = await service.signAccessToken({ userId: 'u', roles: [] });
    const [header, payload] = good.token.split('.');
    await expectCode(service.verifyAccessToken(`${header}.${payload}.AAAA`), 'token_invalid');
    await expectCode(service.verifyAccessToken('garbage'), 'token_invalid');

    const key = new TextEncoder().encode(SECRET);
    const foreignIssuer = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u')
      .setIssuer('someone-else')
      .setAudience(service.audience)
      .setJti('x')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
    await expectCode(service.verifyAccessToken(foreignIssuer), 'token_invalid');

    const foreignAudience = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u')
      .setIssuer(service.issuer)
      .setAudience('other-api')
      .setJti('x')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
    await expectCode(service.verifyAccessToken(foreignAudience), 'token_invalid');

    const otherSecret = new TokenService(configFor({ JWT_SECRET: 'another-secret-'.repeat(3) }));
    await expectCode(otherSecret.verifyAccessToken(good.token), 'token_invalid');
  });

  it('generates random refresh tokens and stores only their SHA-256 hash', () => {
    const service = new TokenService(configFor({ AUTH_REFRESH_TTL_DAYS: '7' }));
    const a = service.generateRefreshToken();
    const b = service.generateRefreshToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(43);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(service.hashRefreshToken(a.token));
    expect(a.hash).not.toBe(b.hash);
    const from = new Date('2026-01-01T00:00:00Z');
    expect(service.refreshExpiry(from).toISOString()).toBe('2026-01-08T00:00:00.000Z');
  });
});
