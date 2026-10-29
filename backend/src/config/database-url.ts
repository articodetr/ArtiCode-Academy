// Builds PostgreSQL connection URLs from the variables of the repository root
// .env (the file compose.yaml reads), so database credentials are declared once
// (ADR-019). Used by src/config/env.schema.ts for the APPLICATION role and by
// prisma.config.ts for the MIGRATOR role. No framework imports: the Prisma CLI
// loads this file outside NestJS.

/** Defaults that match compose.yaml and .env.example at the repository root. */
export const POSTGRES_DEFAULTS = {
  host: '127.0.0.1',
  port: 5432,
  database: 'articode_academy',
  appUser: 'articode_app',
  migratorUser: 'articode_migrator',
} as const;

export interface PostgresConnection {
  user: string;
  password: string;
  /** Hostname or IPv4 address (an IPv6 literal would need brackets). */
  host: string;
  port: number;
  database: string;
}

/**
 * `postgresql://user:password@host:port/database` with the credentials and the
 * database name percent-encoded, so a password may contain any character.
 * Both `pg` (runtime) and the Prisma CLI decode this form.
 */
export function buildPostgresUrl(connection: PostgresConnection): string {
  const { user, password, host, port, database } = connection;
  const credentials = `${encodeURIComponent(user)}:${encodeURIComponent(password)}`;
  return `postgresql://${credentials}@${host}:${port}/${encodeURIComponent(database)}`;
}

/** The two database roles with their own credentials (KI-024). */
export type DatabaseRole = 'app' | 'migrator';

const ROLE_VARIABLES: Record<
  DatabaseRole,
  { user: string; password: string; defaultUser: string }
> = {
  app: {
    user: 'DB_APP_USER',
    password: 'DB_APP_PASSWORD',
    defaultUser: POSTGRES_DEFAULTS.appUser,
  },
  migrator: {
    user: 'DB_MIGRATOR_USER',
    password: 'DB_MIGRATOR_PASSWORD',
    defaultUser: POSTGRES_DEFAULTS.migratorUser,
  },
};

/**
 * Derives one role's URL from raw environment values (`DB_<ROLE>_USER`,
 * `DB_<ROLE>_PASSWORD`, `DB_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`).
 * Returns undefined when that role's password is not set. The runtime validates
 * the same variables with zod first (env.schema.ts); this unvalidated variant is
 * for the Prisma CLI.
 */
export function postgresUrlFromEnv(
  env: Record<string, string | undefined>,
  role: DatabaseRole,
): string | undefined {
  const variables = ROLE_VARIABLES[role];
  const password = env[variables.password];
  if (!password) return undefined;

  const port = Number(env['POSTGRES_PORT'] || POSTGRES_DEFAULTS.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`POSTGRES_PORT must be a port number, got "${env['POSTGRES_PORT']}"`);
  }

  return buildPostgresUrl({
    user: env[variables.user] || variables.defaultUser,
    password,
    host: env['DB_HOST'] || POSTGRES_DEFAULTS.host,
    port,
    database: env['POSTGRES_DB'] || POSTGRES_DEFAULTS.database,
  });
}
