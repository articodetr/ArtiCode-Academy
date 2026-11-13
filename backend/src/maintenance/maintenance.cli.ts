// MOD-17-T05: the command-line side of the daily maintenance — arguments, the
// few environment variables it needs, the env files outside production, and the
// one output line. main.ts wires them; nothing here runs on import.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { buildPostgresUrl } from '../config/database-url.js';
import { envSchema } from '../config/env.schema.js';
import type { PruneResult } from './maintenance.js';

export const MAINTENANCE_USAGE =
  'usage: node dist/maintenance/main.js [--dry-run | --help]\n' +
  '  Deletes verification tokens consumed or expired more than 30 days ago and the\n' +
  '  refresh tokens of families older than AUTH_REFRESH_FAMILY_MAX_DAYS + 7 days,\n' +
  '  then prints one JSON line with the counts. --dry-run counts without deleting.';

export type MaintenanceArgs = { help: true } | { help: false; dryRun: boolean };

export function parseMaintenanceArgs(argv: readonly string[]): MaintenanceArgs {
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--dry-run') dryRun = true;
    else
      throw new Error(
        `unknown argument "${arg}" (${MAINTENANCE_USAGE.split('\n')[0]})`,
      );
  }
  return { help: false, dryRun };
}

/**
 * The variables the command reads, with the API's own definitions (env.schema.ts),
 * so a value the API refuses is refused here too. JWT_SECRET and the mail
 * settings are not read: the command runs with NODE_ENV=production without them.
 */
const maintenanceEnvSchema = envSchema.in.pick({
  NODE_ENV: true,
  DATABASE_URL: true,
  DB_HOST: true,
  POSTGRES_PORT: true,
  POSTGRES_DB: true,
  DB_APP_USER: true,
  DB_APP_PASSWORD: true,
  AUTH_REFRESH_FAMILY_MAX_DAYS: true,
});

export interface MaintenanceEnv {
  nodeEnv: 'development' | 'test' | 'production';
  /** The APPLICATION role (DML only — ADR-019): DATABASE_URL, else derived like the API does. */
  databaseUrl: string;
  familyMaxDays: number;
}

export function readMaintenanceEnv(
  raw: Record<string, string | undefined>,
): MaintenanceEnv {
  const result = maintenanceEnvSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`invalid environment: ${problems}`);
  }
  const env = result.data;
  const databaseUrl =
    env.DATABASE_URL ??
    (env.DB_APP_PASSWORD === undefined
      ? undefined
      : buildPostgresUrl({
          user: env.DB_APP_USER,
          password: env.DB_APP_PASSWORD,
          host: env.DB_HOST,
          port: env.POSTGRES_PORT,
          database: env.POSTGRES_DB,
        }));
  if (!databaseUrl) {
    throw new Error(
      'no database: set DATABASE_URL, or DB_APP_PASSWORD to derive it (application role)',
    );
  }
  return {
    nodeEnv: env.NODE_ENV,
    databaseUrl,
    familyMaxDays: env.AUTH_REFRESH_FAMILY_MAX_DAYS,
  };
}

/**
 * The environment the command reads: the process variables over the env files,
 * where the first file that defines a variable wins (as ConfigModule does —
 * src/config/env-files.ts). Missing files are skipped. Pass no paths to read
 * the process variables alone (production: no env file in the image).
 */
export function environmentWithFiles(
  processEnv: Record<string, string | undefined>,
  paths: readonly string[],
): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = {};
  for (const path of paths) {
    let content: string;
    try {
      content = readFileSync(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw new Error(
        `cannot read an env file (${(error as NodeJS.ErrnoException).code ?? 'error'})`,
      );
    }
    for (const [key, value] of Object.entries(parseEnv(content))) {
      if (merged[key] === undefined) merged[key] = value;
    }
  }
  for (const [key, value] of Object.entries(processEnv)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

/** The one JSON line printed on success. */
export function resultLine(result: PruneResult, durationMs: number): string {
  return JSON.stringify({
    event: 'maintenance.pruned',
    verificationTokens: result.verificationTokens,
    refreshTokens: result.refreshTokens,
    verificationCutoff: result.verificationCutoff.toISOString(),
    refreshFamilyCutoff: result.refreshFamilyCutoff.toISOString(),
    dryRun: result.dryRun,
    durationMs: Math.round(durationMs),
  });
}

const CONNECTION_STRING = /postgres(?:ql)?:\/\/\S+/gi;

/**
 * The one line printed on stderr for a failure: the message on one line, any
 * connection string and every given secret (the URL, the password) masked.
 */
export function errorLine(
  error: unknown,
  secrets: readonly (string | undefined)[] = [],
): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join('***');
  }
  message = message
    .replace(CONNECTION_STRING, 'postgresql://***')
    .replace(/\s+/g, ' ')
    .trim();
  if (message.length > 500) message = `${message.slice(0, 497)}...`;
  return `maintenance failed: ${message || 'unknown error'}`;
}
