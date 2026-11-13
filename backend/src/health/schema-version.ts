// MOD-17-T03 — the readiness check knows the schema version (roadmap §4l.8).
// The build ships `prisma/migrations`; its newest migration is the schema the
// code expects. The database is ready for this build once that migration is
// finished (and not rolled back) in `_prisma_migrations`. The decisions are
// pure; reading the folder is the only I/O here (the database read lives in
// PrismaService.appliedMigrations()).
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppliedMigrations } from '../prisma/prisma.service.js';

/** Injection token of the migrations folder (tests point it elsewhere). */
export const MIGRATIONS_DIR = Symbol('MIGRATIONS_DIR');

/**
 * The folder Prisma's CLI reads, relative to the working directory: `backend/`
 * in development and e2e, `/app` in the runtime image (WORKDIR, where the
 * Dockerfile copies `prisma/migrations`).
 */
export function defaultMigrationsDir(): string {
  return join(process.cwd(), 'prisma', 'migrations');
}

/** A migration folder name as `prisma migrate dev` writes it: `YYYYMMDDhhmmss_name`. */
export const MIGRATION_NAME_PATTERN = /^\d{14}_[A-Za-z0-9_]+$/;

export const SCHEMA_STATUSES = [
  'current',
  'ahead',
  'outdated',
  'unchecked',
  'error',
] as const;
export type SchemaStatus = (typeof SCHEMA_STATUSES)[number];

export const READINESS_REASONS = [
  'database_unavailable',
  'schema_outdated',
  'schema_unverified',
] as const;
export type ReadinessReason = (typeof READINESS_REASONS)[number];

export interface SchemaCheck {
  status: SchemaStatus;
  /** Newest migration shipped with this build; null when none is found. */
  expected: string | null;
  /** Newest finished, not rolled-back migration of the database; null when none (or not read). */
  applied: string | null;
  /** Driver message when the migrations table could not be read. */
  error?: string;
}

/** The greatest name (Prisma applies migrations in folder-name order); null for none. */
function greatest(names: readonly string[]): string | null {
  let best: string | null = null;
  for (const name of names) if (best === null || name > best) best = name;
  return best;
}

/** The newest well-formed migration name among `names`; null when there is none. */
export function newestMigration(names: readonly string[]): string | null {
  return greatest(names.filter((name) => MIGRATION_NAME_PATTERN.test(name)));
}

/**
 * Where the database stands against the build's newest migration:
 * `unchecked` without an expected migration, `outdated` while it is not
 * applied (an empty list = no migrations table yet), `current` when it is the
 * newest applied one, `ahead` when a newer one is applied too (an older build
 * during an upgrade — still ready).
 */
export function schemaStatus(
  expected: string | null,
  appliedNames: readonly string[],
): Exclude<SchemaStatus, 'error'> {
  if (expected === null) return 'unchecked';
  if (!appliedNames.includes(expected)) return 'outdated';
  return greatest(appliedNames) === expected ? 'current' : 'ahead';
}

/**
 * The `checks.schema` report. `applied` is null when the database was not
 * read (it is not up, or there is nothing to compare with).
 */
export function schemaCheck(
  expected: string | null,
  applied: AppliedMigrations | null,
): SchemaCheck {
  if (expected === null || applied === null)
    return { status: 'unchecked', expected, applied: null };
  if (!applied.ok)
    return { status: 'error', expected, applied: null, error: applied.error };
  return {
    status: schemaStatus(expected, applied.names),
    expected,
    applied: greatest(applied.names),
  };
}

/** Why the API is not ready; null when it is. The database comes first. */
export function readinessReason(
  databaseUp: boolean,
  schema: SchemaStatus,
): ReadinessReason | null {
  if (!databaseUp) return 'database_unavailable';
  if (schema === 'outdated') return 'schema_outdated';
  if (schema === 'error') return 'schema_unverified';
  return null;
}

/**
 * The newest migration folder under `dir`: a well-formed name that holds a
 * `migration.sql` file (`migration_lock.toml`, stray files and empty folders
 * are ignored). Null when the folder is missing, unreadable or holds none.
 * Never throws.
 */
export async function readNewestMigration(dir: string): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !MIGRATION_NAME_PATTERN.test(entry.name))
      continue;
    if (await isFile(join(dir, entry.name, 'migration.sql')))
      names.push(entry.name);
  }
  return newestMigration(names);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
