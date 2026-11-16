// TEST-207 (unit) — MOD-18-T02 the platform environment schema.
import { describe, expect, it } from 'vitest';
import { validatePlatformEnv } from './platform.env.schema.js';

/** 48 characters: long enough for the production rule, obviously not a real secret. */
const PLATFORM_SECRET = 'platform-test-secret-'.repeat(3);

describe('validatePlatformEnv', () => {
  it('applies the defaults and derives the generic keys of the shared HTTP setup', () => {
    expect(validatePlatformEnv({})).toEqual({
      NODE_ENV: 'development',
      PLATFORM_PORT: 3100,
      API_PREFIX: 'api',
      PLATFORM_CORS_ORIGIN: ['http://localhost:5174'],
      TRUST_PROXY: false,
      PLATFORM_DATABASE_URL: undefined,
      PLATFORM_JWT_ISSUER: 'articode-platform',
      PLATFORM_JWT_AUDIENCE: 'articode-platform-api',
      PLATFORM_JWT_ACCESS_TTL_SECONDS: 900,
      PLATFORM_REFRESH_TTL_DAYS: 7,
      PLATFORM_REFRESH_FAMILY_MAX_DAYS: 14,
      PLATFORM_COOKIE_SECURE: false,
      PLATFORM_LOCKOUT_THRESHOLD: 5,
      PLATFORM_LOCKOUT_MINUTES: 15,
      PLATFORM_MFA_ENCRYPTION_KEY: undefined,
      PLATFORM_PROBE_TIMEOUT_MS: 5000,
      PLATFORM_PROBE_INTERVAL_SECONDS: 300,
      // configureApp() and OriginGuard read these.
      PORT: 3100,
      CORS_ORIGIN: ['http://localhost:5174'],
      SWAGGER_ENABLED: true,
    });
  });

  it('never reads the academy PORT, CORS_ORIGIN, DATABASE_URL or JWT settings', () => {
    const env = validatePlatformEnv({
      PORT: '3000',
      CORS_ORIGIN: 'http://localhost:5173',
      DATABASE_URL: 'postgresql://articode_app:x@127.0.0.1:5432/articode_academy',
      DB_APP_PASSWORD: 'academy-password',
      JWT_ISSUER: 'articode-academy',
      JWT_SECRET: 'academy-secret-'.repeat(3),
      PLATFORM_PORT: '3200',
      PLATFORM_CORS_ORIGIN: 'https://admin.example, https://ops.example',
    });
    expect(env.PORT).toBe(3200);
    expect(env.CORS_ORIGIN).toEqual(['https://admin.example', 'https://ops.example']);
    expect(env.PLATFORM_DATABASE_URL).toBeUndefined();
    expect(env.PLATFORM_JWT_ISSUER).toBe('articode-platform');
    expect(Object.keys(env)).not.toContain('DATABASE_URL');
    expect(Object.keys(env)).not.toContain('JWT_SECRET');
    expect(Object.keys(env)).not.toContain('JWT_ISSUER');
  });

  it('derives PLATFORM_DATABASE_URL from the platform role variables, and an explicit URL wins', () => {
    const derived = validatePlatformEnv({
      DB_HOST: 'db.internal',
      POSTGRES_PORT: '5433',
      PLATFORM_DB_APP_USER: 'platform_app',
      PLATFORM_DB_APP_PASSWORD: 'p@ss word',
    });
    expect(derived.PLATFORM_DATABASE_URL).toBe('postgresql://platform_app:p%40ss%20word@db.internal:5433/articode_platform');
    expect(Object.keys(derived)).not.toContain('PLATFORM_DB_APP_PASSWORD');

    const explicit = validatePlatformEnv({
      PLATFORM_DATABASE_URL: 'postgresql://u:p@h:5432/other',
      PLATFORM_DB_APP_PASSWORD: 'ignored',
    });
    expect(explicit.PLATFORM_DATABASE_URL).toBe('postgresql://u:p@h:5432/other');
  });

  it('requires PLATFORM_JWT_SECRET and the database in production, and switches the production defaults', () => {
    expect(() => validatePlatformEnv({ NODE_ENV: 'production', PLATFORM_DB_APP_PASSWORD: 'x' })).toThrow(
      /PLATFORM_JWT_SECRET: is required when NODE_ENV=production/,
    );
    expect(() => validatePlatformEnv({ NODE_ENV: 'production', PLATFORM_JWT_SECRET: PLATFORM_SECRET })).toThrow(
      /PLATFORM_DATABASE_URL: is required when NODE_ENV=production/,
    );
    const env = validatePlatformEnv({
      NODE_ENV: 'production',
      PLATFORM_JWT_SECRET: PLATFORM_SECRET,
      PLATFORM_DB_APP_PASSWORD: 'x',
    });
    expect(env.PLATFORM_COOKIE_SECURE).toBe(true);
    expect(env.SWAGGER_ENABLED).toBe(false);
    expect(validatePlatformEnv({ NODE_ENV: 'production', PLATFORM_JWT_SECRET: PLATFORM_SECRET, PLATFORM_DB_APP_PASSWORD: 'x', SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED).toBe(true);
  });

  it('refuses a short secret, a secret shared with the academy API and a family cap below the refresh lifetime', () => {
    expect(() => validatePlatformEnv({ PLATFORM_JWT_SECRET: 'short' })).toThrow(/at least 32 characters/);
    expect(() => validatePlatformEnv({ PLATFORM_JWT_SECRET: PLATFORM_SECRET, JWT_SECRET: PLATFORM_SECRET })).toThrow(
      /PLATFORM_JWT_SECRET: must differ from JWT_SECRET/,
    );
    expect(() => validatePlatformEnv({ PLATFORM_REFRESH_TTL_DAYS: '10', PLATFORM_REFRESH_FAMILY_MAX_DAYS: '5' })).toThrow(
      /PLATFORM_REFRESH_FAMILY_MAX_DAYS: must be at least PLATFORM_REFRESH_TTL_DAYS/,
    );
  });

  it('parses TRUST_PROXY with the academy rules and treats empty assignments as absent', () => {
    expect(validatePlatformEnv({ TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(() => validatePlatformEnv({ TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/);
    const env = validatePlatformEnv({ PLATFORM_PORT: '', PLATFORM_JWT_SECRET: '', PLATFORM_CORS_ORIGIN: '' });
    expect(env.PORT).toBe(3100);
    expect(env.PLATFORM_JWT_SECRET).toBeUndefined();
    expect(env.CORS_ORIGIN).toEqual(['http://localhost:5174']);
  });

  it('never prints a value in its error message', () => {
    try {
      validatePlatformEnv({ PLATFORM_JWT_SECRET: 'too-short-secret-value' });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('too-short-secret-value');
    }
  });
});

// TEST-231 (unit) — PMFA-T01 (roadmap §4o, D-R114): ENV-91, the key that seals the TOTP secrets of platform accounts.
describe('validatePlatformEnv — PLATFORM_MFA_ENCRYPTION_KEY (TEST-231)', () => {
  // Fixed, obviously fake bytes: 0xfb encodes to `+/v7` in base64 and `-_v7` in base64url, so both alphabets are exercised.
  const KEY_BYTES = Buffer.alloc(32, 0xfb);
  const BASE64 = KEY_BYTES.toString('base64');
  const BASE64URL = KEY_BYTES.toString('base64url');
  /** Another fake key, standing for the academy's AUTH_MFA_ENCRYPTION_KEY. */
  const ACADEMY_KEY = Buffer.alloc(32, 7).toString('base64');

  /** The boot error for an environment, which must never repeat a value. */
  function bootError(raw: Record<string, unknown>): string {
    try {
      validatePlatformEnv(raw);
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error(`expected ${Object.keys(raw).join(', ')} to be refused`);
  }

  it('is optional: absent or empty means no key (MFA off), in production too', () => {
    expect(validatePlatformEnv({}).PLATFORM_MFA_ENCRYPTION_KEY).toBeUndefined();
    expect(validatePlatformEnv({ PLATFORM_MFA_ENCRYPTION_KEY: '' }).PLATFORM_MFA_ENCRYPTION_KEY).toBeUndefined();
    const production = { NODE_ENV: 'production', PLATFORM_JWT_SECRET: PLATFORM_SECRET, PLATFORM_DB_APP_PASSWORD: 'x' };
    expect(validatePlatformEnv(production).PLATFORM_MFA_ENCRYPTION_KEY).toBeUndefined();
    expect(validatePlatformEnv({ ...production, PLATFORM_MFA_ENCRYPTION_KEY: BASE64URL }).PLATFORM_MFA_ENCRYPTION_KEY).toBe(
      BASE64URL,
    );
  });

  it('accepts 32 bytes as padded base64, unpadded base64 and base64url, and keeps the text as given', () => {
    expect(BASE64).toMatch(/[+/]/);
    expect(BASE64URL).toMatch(/[-_]/);
    for (const key of [BASE64, BASE64.replace(/=$/, ''), BASE64URL, Buffer.alloc(32).toString('base64')]) {
      expect(validatePlatformEnv({ PLATFORM_MFA_ENCRYPTION_KEY: key }).PLATFORM_MFA_ENCRYPTION_KEY, key).toBe(key);
    }
    // A different academy key is fine, and is never kept in the platform config.
    const env = validatePlatformEnv({ PLATFORM_MFA_ENCRYPTION_KEY: BASE64, AUTH_MFA_ENCRYPTION_KEY: ACADEMY_KEY });
    expect(env.PLATFORM_MFA_ENCRYPTION_KEY).toBe(BASE64);
    expect(Object.keys(env)).not.toContain('AUTH_MFA_ENCRYPTION_KEY');
    expect(Object.values(env)).not.toContain(ACADEMY_KEY);
  });

  it('refuses garbage, another length (31, 33 or 16 bytes, 64 hex characters) and a mixed or non-canonical encoding', () => {
    const zeros = 'A'.repeat(43);
    for (const key of [
      'not a key at all, just words!',
      Buffer.alloc(31, 0xfb).toString('base64'),
      Buffer.alloc(31, 0xfb).toString('base64url'),
      Buffer.alloc(33, 0xfb).toString('base64'),
      Buffer.alloc(16, 0xfb).toString('base64'),
      KEY_BYTES.toString('hex'),
      `${BASE64.slice(0, 20)} ${BASE64.slice(20)}`,
      `${BASE64URL}==`,
      // Both alphabets at once: 32 bytes to Buffer.from(…, 'base64'), but parseMfaKey() (PlatformMfaCore's parser) refuses it.
      `+_${'A'.repeat(41)}`,
      // Same 32 bytes as `zeros`, but the last character carries stray low bits.
      `${zeros.slice(0, 42)}B`,
    ]) {
      expect(bootError({ PLATFORM_MFA_ENCRYPTION_KEY: key }), key).toMatch(
        /PLATFORM_MFA_ENCRYPTION_KEY: must be 32 random bytes encoded as base64 or base64url/,
      );
    }
    expect(validatePlatformEnv({ PLATFORM_MFA_ENCRYPTION_KEY: zeros }).PLATFORM_MFA_ENCRYPTION_KEY).toBe(zeros);
  });

  it('refuses the academy key, also written in the other alphabet or without padding', () => {
    for (const academy of [BASE64, BASE64.replace(/=$/, ''), BASE64URL]) {
      for (const platform of [BASE64, BASE64URL]) {
        expect(bootError({ PLATFORM_MFA_ENCRYPTION_KEY: platform, AUTH_MFA_ENCRYPTION_KEY: academy }), `${platform} / ${academy}`).toMatch(
          /PLATFORM_MFA_ENCRYPTION_KEY: must differ from AUTH_MFA_ENCRYPTION_KEY/,
        );
      }
    }
    // An academy value that is no key at all is not the platform's concern (the academy API refuses it at its own boot).
    expect(
      validatePlatformEnv({ PLATFORM_MFA_ENCRYPTION_KEY: BASE64, AUTH_MFA_ENCRYPTION_KEY: 'not-a-key' }).PLATFORM_MFA_ENCRYPTION_KEY,
    ).toBe(BASE64);
    // Without a platform key there is nothing to compare: the academy key alone never blocks the platform.
    expect(validatePlatformEnv({ AUTH_MFA_ENCRYPTION_KEY: ACADEMY_KEY }).PLATFORM_MFA_ENCRYPTION_KEY).toBeUndefined();
  });

  it('never repeats a value in the boot error', () => {
    const almost = Buffer.alloc(31, 0xa5).toString('base64');
    for (const raw of [
      { PLATFORM_MFA_ENCRYPTION_KEY: almost },
      { PLATFORM_MFA_ENCRYPTION_KEY: 'Zm9vYmFyLWdhcmJhZ2Uta2V5LXZhbHVl!!' },
      { PLATFORM_MFA_ENCRYPTION_KEY: KEY_BYTES.toString('hex') },
      { PLATFORM_MFA_ENCRYPTION_KEY: BASE64, AUTH_MFA_ENCRYPTION_KEY: BASE64URL },
    ]) {
      const message = bootError(raw);
      expect(message).toMatch(/PLATFORM_MFA_ENCRYPTION_KEY/);
      for (const value of Object.values(raw)) {
        expect(message.includes(value), value).toBe(false);
        // Not even a long piece of it.
        expect(message.includes(value.slice(0, 12)), value).toBe(false);
      }
    }
  });
});
