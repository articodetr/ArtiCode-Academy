// Shapes and driver helpers of the readiness round trips, shared by the
// academy PrismaService and the platform's PlatformPrismaService (MOD-18-T02).
// No Prisma client import: each service runs its own queries on its own
// generated client and hands the outcome to these helpers.

export type DatabasePing =
  | { ok: true; latencyMs: number }
  | { ok: false; configured: boolean; error?: string };

/**
 * The migrations the database has finished and not rolled back, for the
 * readiness check (MOD-17-T03): `names` is empty while `_prisma_migrations`
 * does not exist yet (a fresh database before `migrate deploy`).
 */
export type AppliedMigrations =
  | { ok: true; names: string[] }
  | { ok: false; error: string };

/** PostgreSQL `undefined_table`. */
const UNDEFINED_TABLE = '42P01';

interface DriverCause {
  originalCode?: unknown;
  originalMessage?: unknown;
  kind?: unknown;
}

/**
 * The driver's own error of a failed raw query: Prisma 7 with the pg adapter
 * reports it as P2010 with the SQLSTATE and message under
 * `meta.driverAdapterError.cause` (KI-036) — e.g. a missing table is
 * `{ originalCode: '42P01', kind: 'TableDoesNotExist' }`.
 */
function driverCauseOf(error: unknown): DriverCause | undefined {
  const meta = (error as { meta?: Record<string, unknown> } | null)?.meta;
  const adapterError = meta?.['driverAdapterError'] as
    | { cause?: DriverCause }
    | undefined;
  return adapterError?.cause;
}

export function isUndefinedTable(error: unknown): boolean {
  const cause = driverCauseOf(error);
  return (
    cause?.originalCode === UNDEFINED_TABLE ||
    cause?.kind === 'TableDoesNotExist' ||
    (error as { code?: unknown } | null)?.code === 'P2021'
  );
}

export function errorMessageOf(error: unknown): string {
  const original = driverCauseOf(error)?.originalMessage;
  if (typeof original === 'string' && original) return original;
  return error instanceof Error ? error.message : String(error);
}

/** Upper bound for a connection attempt or the readiness round trip. */
export const DB_TIMEOUT_MS = 5000;

export function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
