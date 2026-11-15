import { describe, expect, it, vi } from 'vitest';
import { DatabaseTimeoutError, isTimeout, withTimeout } from '../prisma/database-checks.js';
import { ReadinessFailureLog, databaseErrorCode, schemaErrorCode } from './readiness-errors.js';

// TEST-213 (KI-084): a public readiness answer names a fixed code, and the
// driver's message reaches the server log once per distinct failure.
describe('readiness error codes', () => {
  it('names a timeout apart from any other failure', () => {
    expect(databaseErrorCode({ timedOut: true })).toBe('database_timeout');
    expect(databaseErrorCode({ timedOut: false })).toBe('database_unreachable');
    expect(databaseErrorCode({})).toBe('database_unreachable');
    expect(schemaErrorCode({ timedOut: true })).toBe('migrations_timeout');
    expect(schemaErrorCode({})).toBe('migrations_unreadable');
  });

  it('withTimeout() rejects with an error isTimeout() recognises, and only then', async () => {
    const late = await withTimeout(new Promise(() => undefined), 5).catch((error: unknown) => error);
    expect(late).toBeInstanceOf(DatabaseTimeoutError);
    expect(isTimeout(late)).toBe(true);
    expect(isTimeout(new Error('timed out after 5 ms'))).toBe(false);
    await expect(withTimeout(Promise.resolve(1), 1000)).resolves.toBe(1);
  });
});

describe('ReadinessFailureLog', () => {
  it('logs a failure when it starts and when its detail changes, never twice in a row, and once on recovery', () => {
    const logger = { warn: vi.fn(), log: vi.fn() };
    const failures = new ReadinessFailureLog(logger);

    failures.record('database', null); // passing from the start: nothing
    failures.record('database', 'password authentication failed for user "articode_app"');
    failures.record('database', 'password authentication failed for user "articode_app"');
    failures.record('database', 'connect ECONNREFUSED 10.0.0.5:5432');
    failures.record('schema', 'permission denied for table _prisma_migrations');
    failures.record('database', null);
    failures.record('database', null);

    expect(logger.warn.mock.calls.map(([line]) => line)).toEqual([
      'Readiness: the database check fails — password authentication failed for user "articode_app"',
      'Readiness: the database check fails — connect ECONNREFUSED 10.0.0.5:5432',
      'Readiness: the schema check fails — permission denied for table _prisma_migrations',
    ]);
    expect(logger.log.mock.calls.map(([line]) => line)).toEqual(['Readiness: the database check passes again']);
  });
});
