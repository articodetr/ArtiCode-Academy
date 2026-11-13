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
