import {
  PLATFORM_DEFAULTS,
  POSTGRES_DEFAULTS,
  buildPostgresUrl,
  platformPostgresUrlFromEnv,
  postgresUrlFromEnv,
} from './database-url.js';

describe('buildPostgresUrl', () => {
  it('assembles the URL and percent-encodes the credentials and database name', () => {
    expect(
      buildPostgresUrl({
        user: 'svc user',
        password: 'p@ss:w/rd%#?',
        host: 'db.internal',
        port: 5433,
        database: 'academy a',
      }),
    ).toBe('postgresql://svc%20user:p%40ss%3Aw%2Frd%25%23%3F@db.internal:5433/academy%20a');
  });

  it('leaves URL-safe passwords untouched', () => {
    expect(
      buildPostgresUrl({
        user: 'articode_app',
        password: 'abc-DEF_123',
        host: '127.0.0.1',
        port: 5432,
        database: 'articode_academy',
      }),
    ).toBe('postgresql://articode_app:abc-DEF_123@127.0.0.1:5432/articode_academy');
  });
});

describe('postgresUrlFromEnv', () => {
  it('returns undefined when the role password is missing or empty', () => {
    expect(postgresUrlFromEnv({}, 'app')).toBeUndefined();
    expect(postgresUrlFromEnv({ DB_APP_PASSWORD: '' }, 'app')).toBeUndefined();
    expect(postgresUrlFromEnv({ DB_APP_PASSWORD: 'x' }, 'migrator')).toBeUndefined();
  });

  it('applies the shared defaults for host, port, database and user names', () => {
    expect(postgresUrlFromEnv({ DB_APP_PASSWORD: 'a' }, 'app')).toBe(
      `postgresql://${POSTGRES_DEFAULTS.appUser}:a@127.0.0.1:5432/articode_academy`,
    );
    expect(postgresUrlFromEnv({ DB_MIGRATOR_PASSWORD: 'm' }, 'migrator')).toBe(
      `postgresql://${POSTGRES_DEFAULTS.migratorUser}:m@127.0.0.1:5432/articode_academy`,
    );
  });

  it('reads the role-specific user and the shared POSTGRES_* / DB_HOST variables', () => {
    const env = {
      DB_HOST: 'postgres',
      POSTGRES_PORT: '5433',
      POSTGRES_DB: 'academy_a',
      DB_APP_USER: 'app_a',
      DB_APP_PASSWORD: 'pa',
      DB_MIGRATOR_USER: 'mig_a',
      DB_MIGRATOR_PASSWORD: 'pm',
    };
    expect(postgresUrlFromEnv(env, 'app')).toBe('postgresql://app_a:pa@postgres:5433/academy_a');
    expect(postgresUrlFromEnv(env, 'migrator')).toBe(
      'postgresql://mig_a:pm@postgres:5433/academy_a',
    );
  });

  it('rejects a POSTGRES_PORT that is not a port number', () => {
    expect(() => postgresUrlFromEnv({ DB_APP_PASSWORD: 'a', POSTGRES_PORT: 'abc' }, 'app')).toThrow(
      /POSTGRES_PORT/,
    );
  });
});

describe('platformPostgresUrlFromEnv (MOD-18-T01)', () => {
  it('returns undefined without the platform role password — the academy variables never count', () => {
    expect(platformPostgresUrlFromEnv({}, 'app')).toBeUndefined();
    expect(platformPostgresUrlFromEnv({ PLATFORM_DB_APP_PASSWORD: '' }, 'app')).toBeUndefined();
    expect(platformPostgresUrlFromEnv({ PLATFORM_DB_APP_PASSWORD: 'x' }, 'migrator')).toBeUndefined();
    expect(
      platformPostgresUrlFromEnv({ DB_APP_PASSWORD: 'a', DB_MIGRATOR_PASSWORD: 'm' }, 'app'),
    ).toBeUndefined();
    expect(
      platformPostgresUrlFromEnv({ DB_APP_PASSWORD: 'a', DB_MIGRATOR_PASSWORD: 'm' }, 'migrator'),
    ).toBeUndefined();
  });

  it('applies the platform defaults on the shared host and port', () => {
    expect(PLATFORM_DEFAULTS).toEqual({
      database: 'articode_platform',
      appUser: 'platform_app',
      migratorUser: 'platform_migrator',
    });
    expect(platformPostgresUrlFromEnv({ PLATFORM_DB_APP_PASSWORD: 'a' }, 'app')).toBe(
      'postgresql://platform_app:a@127.0.0.1:5432/articode_platform',
    );
    expect(platformPostgresUrlFromEnv({ PLATFORM_DB_MIGRATOR_PASSWORD: 'm' }, 'migrator')).toBe(
      'postgresql://platform_migrator:m@127.0.0.1:5432/articode_platform',
    );
  });

  it('reads PLATFORM_DB_* for the roles and the database, DB_HOST / POSTGRES_PORT for the server — never POSTGRES_DB', () => {
    const env = {
      DB_HOST: 'postgres',
      POSTGRES_PORT: '5433',
      POSTGRES_DB: 'academy_a',
      DB_APP_USER: 'app_a',
      DB_APP_PASSWORD: 'pa',
      PLATFORM_DB_NAME: 'platform x',
      PLATFORM_DB_APP_USER: 'papp',
      PLATFORM_DB_APP_PASSWORD: 'p@ss',
      PLATFORM_DB_MIGRATOR_USER: 'pmig',
      PLATFORM_DB_MIGRATOR_PASSWORD: 'pm',
    };
    expect(platformPostgresUrlFromEnv(env, 'app')).toBe('postgresql://papp:p%40ss@postgres:5433/platform%20x');
    expect(platformPostgresUrlFromEnv(env, 'migrator')).toBe('postgresql://pmig:pm@postgres:5433/platform%20x');
    // The academy derivation is unchanged by the platform variables.
    expect(postgresUrlFromEnv(env, 'app')).toBe('postgresql://app_a:pa@postgres:5433/academy_a');
  });

  it('rejects a POSTGRES_PORT that is not a port number', () => {
    expect(() =>
      platformPostgresUrlFromEnv({ PLATFORM_DB_APP_PASSWORD: 'a', POSTGRES_PORT: '70000' }, 'app'),
    ).toThrow(/POSTGRES_PORT/);
  });
});
