import { validateEnv } from './env.schema.js';

describe('validateEnv', () => {
  it('applies defaults when nothing is set', () => {
    expect(validateEnv({})).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      API_PREFIX: 'api',
      CORS_ORIGIN: ['http://localhost:5173'],
      SWAGGER_ENABLED: true,
    });
  });

  it('coerces PORT, parses the CORS list and the Swagger flag', () => {
    const env = validateEnv({
      NODE_ENV: 'production',
      PORT: '4000',
      API_PREFIX: 'api/v1',
      CORS_ORIGIN: 'http://a.test, http://b.test ,',
      SWAGGER_ENABLED: 'false',
      DATABASE_URL: 'postgresql://u:p@db:5432/app',
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
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(
      /DATABASE_URL.*production/,
    );
    expect(
      validateEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@db:5432/app',
      }).DATABASE_URL,
    ).toBe('postgresql://u:p@db:5432/app');
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
      validateEnv({ NODE_ENV: 'production', DB_APP_PASSWORD: 'x' }).DATABASE_URL,
    ).toMatch(/^postgresql:\/\/articode_app:x@/);
    expect(() => validateEnv({ POSTGRES_PORT: 'abc' })).toThrow(/POSTGRES_PORT/);
    expect(() => validateEnv({ POSTGRES_PORT: '0' })).toThrow(/POSTGRES_PORT/);
  });
});
