// What a failed readiness check may say in public (KI-084, CH-0224).
//
// The readiness answers — API-004 `GET /api/health/ready` of an academy and
// API-177 of the platform — are `@Public()`, served through Caddy on the
// academy's own origin (MOD-17) and read by the platform's probes (MOD-18-T05),
// which store them. The driver's message of a failed round trip can name the
// host, the port or the database role («password authentication failed for
// user …»), so a response carries a fixed code only and the message goes to the
// server log, once per distinct failure.
//
// No Prisma client import: shared by the academy and the platform health
// services, like `prisma/database-checks.ts`.

/** `checks.database.error` while the database is `down`. */
export const DATABASE_ERROR_CODES = ['database_timeout', 'database_unreachable'] as const;
export type DatabaseErrorCode = (typeof DATABASE_ERROR_CODES)[number];

/** `checks.schema.error` while the schema status is `error`. */
export const SCHEMA_ERROR_CODES = ['migrations_timeout', 'migrations_unreadable'] as const;
export type SchemaErrorCode = (typeof SCHEMA_ERROR_CODES)[number];

export function databaseErrorCode(failure: { timedOut?: boolean }): DatabaseErrorCode {
  return failure.timedOut ? 'database_timeout' : 'database_unreachable';
}

export function schemaErrorCode(failure: { timedOut?: boolean }): SchemaErrorCode {
  return failure.timedOut ? 'migrations_timeout' : 'migrations_unreadable';
}

export type ReadinessCheckName = 'database' | 'schema';

interface ReadinessLogger {
  warn(message: string): void;
  log(message: string): void;
}

/**
 * Writes the raw detail of a failing check to the log when it starts failing
 * or its detail changes, and one line when it passes again — a health check
 * that asks every few seconds during an outage does not flood the log.
 */
export class ReadinessFailureLog {
  private readonly current = new Map<ReadinessCheckName, string>();

  constructor(private readonly logger: ReadinessLogger) {}

  /** `detail` is the driver's message of a failure, null when the check passed. */
  record(check: ReadinessCheckName, detail: string | null): void {
    const previous = this.current.get(check);
    if (detail === null) {
      if (previous === undefined) return;
      this.current.delete(check);
      this.logger.log(`Readiness: the ${check} check passes again`);
      return;
    }
    if (previous === detail) return;
    this.current.set(check, detail);
    this.logger.warn(`Readiness: the ${check} check fails — ${detail}`);
  }
}
