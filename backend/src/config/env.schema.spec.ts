import { validateEnv } from './env.schema.js';

/** 48 characters: long enough for the production rule, obviously not a real secret. */
const PRODUCTION_SECRET = 'test-secret-'.repeat(4);

describe('validateEnv', () => {
  it('applies defaults when nothing is set', () => {
    expect(validateEnv({})).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      API_PREFIX: 'api',
      CORS_ORIGIN: ['http://localhost:5173'],
      SWAGGER_ENABLED: true,
      JWT_ISSUER: 'articode-academy',
      JWT_AUDIENCE: 'articode-academy-api',
      JWT_ACCESS_TTL_SECONDS: 900,
      AUTH_REFRESH_TTL_DAYS: 14,
      AUTH_COOKIE_SECURE: false,
      AUTH_LOCKOUT_THRESHOLD: 5,
      AUTH_LOCKOUT_MINUTES: 15,
      AUTH_INVITATION_TTL_HOURS: 48,
      AUTH_PASSWORD_RESET_TTL_MINUTES: 30,
      AUTH_SELF_SERVICE_RESET_ENABLED: false,
      MAIL_TRANSPORT: 'none',
    });
  });

  it('parses the MOD-03 account lifecycle settings and rejects values out of range', () => {
    const env = validateEnv({
      AUTH_INVITATION_TTL_HOURS: '72',
      AUTH_PASSWORD_RESET_TTL_MINUTES: '15',
      AUTH_SELF_SERVICE_RESET_ENABLED: 'true',
      // The self-service route needs a transport (D-R08); `log` is fine outside production.
      MAIL_TRANSPORT: 'log',
      APP_PUBLIC_URL: 'https://academy.example/',
    });
    expect(env.AUTH_INVITATION_TTL_HOURS).toBe(72);
    expect(env.AUTH_PASSWORD_RESET_TTL_MINUTES).toBe(15);
    expect(env.AUTH_SELF_SERVICE_RESET_ENABLED).toBe(true);
    expect(env.APP_PUBLIC_URL).toBe('https://academy.example');

    // Empty assignments fall back to the defaults; APP_PUBLIC_URL has none.
    const empty = validateEnv({
      AUTH_INVITATION_TTL_HOURS: '',
      AUTH_PASSWORD_RESET_TTL_MINUTES: '',
      AUTH_SELF_SERVICE_RESET_ENABLED: '',
      APP_PUBLIC_URL: '',
    });
    expect(empty.AUTH_INVITATION_TTL_HOURS).toBe(48);
    expect(empty.AUTH_PASSWORD_RESET_TTL_MINUTES).toBe(30);
    expect(empty.AUTH_SELF_SERVICE_RESET_ENABLED).toBe(false);
    expect(empty.APP_PUBLIC_URL).toBeUndefined();

    expect(() => validateEnv({ AUTH_INVITATION_TTL_HOURS: '0' })).toThrow(/AUTH_INVITATION_TTL_HOURS/);
    expect(() => validateEnv({ AUTH_INVITATION_TTL_HOURS: '721' })).toThrow(/AUTH_INVITATION_TTL_HOURS/);
    expect(() => validateEnv({ AUTH_PASSWORD_RESET_TTL_MINUTES: '4' })).toThrow(/AUTH_PASSWORD_RESET_TTL_MINUTES/);
    expect(() => validateEnv({ AUTH_PASSWORD_RESET_TTL_MINUTES: '1.5' })).toThrow(/AUTH_PASSWORD_RESET_TTL_MINUTES/);
    expect(() => validateEnv({ AUTH_SELF_SERVICE_RESET_ENABLED: 'yes' })).toThrow(/AUTH_SELF_SERVICE_RESET_ENABLED/);
    expect(() => validateEnv({ APP_PUBLIC_URL: 'academy.example' })).toThrow(/APP_PUBLIC_URL/);
    expect(() => validateEnv({ APP_PUBLIC_URL: 'ftp://academy.example' })).toThrow(/APP_PUBLIC_URL/);
  });

  it('selects the mail transport and refuses development-only mail settings in production (D-R08)', () => {
    expect(validateEnv({}).MAIL_TRANSPORT).toBe('none');
    expect(validateEnv({ MAIL_TRANSPORT: '' }).MAIL_TRANSPORT).toBe('none');
    expect(validateEnv({ MAIL_TRANSPORT: 'log' }).MAIL_TRANSPORT).toBe('log');
    expect(() => validateEnv({ MAIL_TRANSPORT: 'smtp' })).toThrow(/MAIL_TRANSPORT/);

    const production = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@db:5432/app',
      JWT_SECRET: PRODUCTION_SECRET,
    };
    expect(validateEnv(production).MAIL_TRANSPORT).toBe('none');
    expect(() => validateEnv({ ...production, MAIL_TRANSPORT: 'log' })).toThrow(/MAIL_TRANSPORT.*production/);

    // A self-service password reset needs a transport that reaches the user — in every environment.
    expect(() => validateEnv({ AUTH_SELF_SERVICE_RESET_ENABLED: 'true' })).toThrow(
      /AUTH_SELF_SERVICE_RESET_ENABLED.*MAIL_TRANSPORT=none/,
    );
    expect(() => validateEnv({ ...production, AUTH_SELF_SERVICE_RESET_ENABLED: 'true' })).toThrow(
      /AUTH_SELF_SERVICE_RESET_ENABLED/,
    );
    expect(
      validateEnv({ AUTH_SELF_SERVICE_RESET_ENABLED: 'true', MAIL_TRANSPORT: 'log' }).AUTH_SELF_SERVICE_RESET_ENABLED,
    ).toBe(true);
  });

  it('coerces PORT, parses the CORS list and the Swagger flag', () => {
    const env = validateEnv({
      NODE_ENV: 'production',
      PORT: '4000',
      API_PREFIX: 'api/v1',
      CORS_ORIGIN: 'http://a.test, http://b.test ,',
      SWAGGER_ENABLED: 'false',
      DATABASE_URL: 'postgresql://u:p@db:5432/app',
      JWT_SECRET: PRODUCTION_SECRET,
    });
    expect(env.NODE_ENV).toBe('production');
    expect(env.PORT).toBe(4000);
    expect(env.API_PREFIX).toBe('api/v1');
    expect(env.CORS_ORIGIN).toEqual(['http://a.test', 'http://b.test']);
    expect(env.SWAGGER_ENABLED).toBe(false);
  });

  it('rejects invalid values and names the variable in the error', () => {
    expect(() => validateEnv({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => validateEnv({ PORT: '70000' })).toThrow(/PORT/);
    expect(() => validateEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
    expect(() => validateEnv({ API_PREFIX: '/api/' })).toThrow(/API_PREFIX/);
    expect(() => validateEnv({ SWAGGER_ENABLED: 'yes' })).toThrow(
      /SWAGGER_ENABLED/,
    );
  });

  it('drops variables that are not part of the schema', () => {
    const env = validateEnv({ HOME: '/tmp', PORT: '3001' });
    expect(env).not.toHaveProperty('HOME');
    expect(env.PORT).toBe(3001);
  });

  it('keeps DATABASE_URL optional outside production and treats an empty value as absent', () => {
    expect(validateEnv({}).DATABASE_URL).toBeUndefined();
    expect(validateEnv({ DATABASE_URL: '' }).DATABASE_URL).toBeUndefined();
    expect(
      validateEnv({ DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db' })
        .DATABASE_URL,
    ).toBe('postgresql://u:p@127.0.0.1:5432/db');
  });

  it('rejects a DATABASE_URL that is not a postgresql:// string', () => {
    expect(() => validateEnv({ DATABASE_URL: 'mysql://u:p@h/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('requires DATABASE_URL in production', () => {
    expect(() => validateEnv({ NODE_ENV: 'production', JWT_SECRET: PRODUCTION_SECRET })).toThrow(
      /DATABASE_URL.*production/,
    );
    expect(
      validateEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@db:5432/app',
        JWT_SECRET: PRODUCTION_SECRET,
      }).DATABASE_URL,
    ).toBe('postgresql://u:p@db:5432/app');
  });

  it('requires a JWT_SECRET of at least 32 characters in production only', () => {
    expect(() =>
      validateEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@db:5432/app' }),
    ).toThrow(/JWT_SECRET.*production/);
    expect(() => validateEnv({ JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
    expect(validateEnv({}).JWT_SECRET).toBeUndefined();
    expect(validateEnv({ JWT_SECRET: '' }).JWT_SECRET).toBeUndefined();
    expect(validateEnv({ JWT_SECRET: PRODUCTION_SECRET }).JWT_SECRET).toBe(PRODUCTION_SECRET);
  });

  it('parses the auth settings and defaults the cookie Secure flag per environment', () => {
    const env = validateEnv({
      JWT_ACCESS_TTL_SECONDS: '600',
      AUTH_REFRESH_TTL_DAYS: '30',
      AUTH_LOCKOUT_THRESHOLD: '3',
      AUTH_LOCKOUT_MINUTES: '5',
      AUTH_COOKIE_SECURE: 'true',
    });
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(600);
    expect(env.AUTH_REFRESH_TTL_DAYS).toBe(30);
    expect(env.AUTH_LOCKOUT_THRESHOLD).toBe(3);
    expect(env.AUTH_LOCKOUT_MINUTES).toBe(5);
    expect(env.AUTH_COOKIE_SECURE).toBe(true);
    expect(
      validateEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@db:5432/app',
        JWT_SECRET: PRODUCTION_SECRET,
      }).AUTH_COOKIE_SECURE,
    ).toBe(true);
    expect(() => validateEnv({ JWT_ACCESS_TTL_SECONDS: '10' })).toThrow(/JWT_ACCESS_TTL_SECONDS/);
    expect(() => validateEnv({ AUTH_COOKIE_SECURE: 'yes' })).toThrow(/AUTH_COOKIE_SECURE/);
  });

  it('derives DATABASE_URL for the application role from the variables shared with compose.yaml', () => {
    const defaults = validateEnv({ DB_APP_PASSWORD: 'p@ss:w/rd%' });
    expect(defaults.DATABASE_URL).toBe(
      'postgresql://articode_app:p%40ss%3Aw%2Frd%25@127.0.0.1:5432/articode_academy',
    );
    // The inputs are consumed by the derivation and never exposed to feature code.
    expect(defaults).not.toHaveProperty('DB_APP_PASSWORD');
    expect(defaults).not.toHaveProperty('DB_APP_USER');
    expect(defaults).not.toHaveProperty('POSTGRES_PORT');

    expect(
      validateEnv({
        DB_HOST: 'postgres',
        POSTGRES_PORT: '5433',
        POSTGRES_DB: 'academy_a',
        DB_APP_USER: 'app_a',
        DB_APP_PASSWORD: 'x',
      }).DATABASE_URL,
    ).toBe('postgresql://app_a:x@postgres:5433/academy_a');
  });

  it('prefers an explicit DATABASE_URL over the derived one', () => {
    expect(
      validateEnv({
        DATABASE_URL: 'postgresql://u:p@db:5432/app',
        DB_APP_PASSWORD: 'ignored',
      }).DATABASE_URL,
    ).toBe('postgresql://u:p@db:5432/app');
  });

  it('derives nothing without DB_APP_PASSWORD, treating empty derivation inputs as defaults', () => {
    expect(validateEnv({ DB_APP_USER: 'svc' }).DATABASE_URL).toBeUndefined();
    expect(validateEnv({ DB_APP_PASSWORD: '' }).DATABASE_URL).toBeUndefined();
    expect(
      validateEnv({ DB_APP_PASSWORD: 'x', DB_HOST: '', POSTGRES_PORT: '', POSTGRES_DB: '' })
        .DATABASE_URL,
    ).toBe('postgresql://articode_app:x@127.0.0.1:5432/articode_academy');
  });

  it('accepts a derived URL in production and rejects an invalid POSTGRES_PORT', () => {
    expect(
      validateEnv({ NODE_ENV: 'production', DB_APP_PASSWORD: 'x', JWT_SECRET: PRODUCTION_SECRET })
        .DATABASE_URL,
    ).toMatch(/^postgresql:\/\/articode_app:x@/);
    expect(() => validateEnv({ POSTGRES_PORT: 'abc' })).toThrow(/POSTGRES_PORT/);
    expect(() => validateEnv({ POSTGRES_PORT: '0' })).toThrow(/POSTGRES_PORT/);
  });
});
