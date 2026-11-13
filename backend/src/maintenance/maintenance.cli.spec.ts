// TEST-204 (unit part) — MOD-17-T05: the command line of the daily maintenance
// (arguments, environment, env files, output lines).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  environmentWithFiles,
  errorLine,
  parseMaintenanceArgs,
  readMaintenanceEnv,
  resultLine,
} from './maintenance.cli.js';

describe('maintenance command line (TEST-204)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'articode-maintenance-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('takes --dry-run and --help only', () => {
    expect(parseMaintenanceArgs([])).toEqual({ help: false, dryRun: false });
    expect(parseMaintenanceArgs(['--dry-run'])).toEqual({
      help: false,
      dryRun: true,
    });
    expect(parseMaintenanceArgs(['--help'])).toEqual({ help: true });
    expect(() => parseMaintenanceArgs(['--force'])).toThrow(
      /unknown argument "--force"/,
    );
    expect(() => parseMaintenanceArgs(['--only-user', 'x'])).toThrow(
      /unknown argument/,
    );
  });

  it('runs in production without JWT_SECRET, on the application role derived like the API', () => {
    const env = readMaintenanceEnv({
      NODE_ENV: 'production',
      DB_APP_PASSWORD: 'p@ss word',
      DB_HOST: 'db',
      POSTGRES_PORT: '5432',
      POSTGRES_DB: 'articode_academy',
    });
    expect(env).toEqual({
      nodeEnv: 'production',
      databaseUrl:
        'postgresql://articode_app:p%40ss%20word@db:5432/articode_academy',
      familyMaxDays: 30,
    });
  });

  it('prefers DATABASE_URL and reads AUTH_REFRESH_FAMILY_MAX_DAYS with the API rules', () => {
    const url = 'postgresql://someone:secret@127.0.0.1:5432/academy';
    expect(
      readMaintenanceEnv({
        DATABASE_URL: url,
        DB_APP_PASSWORD: 'other',
        AUTH_REFRESH_FAMILY_MAX_DAYS: '45',
      }),
    ).toEqual({ nodeEnv: 'development', databaseUrl: url, familyMaxDays: 45 });
    expect(
      readMaintenanceEnv({
        DATABASE_URL: url,
        AUTH_REFRESH_FAMILY_MAX_DAYS: '',
      }).familyMaxDays,
    ).toBe(30);
    for (const days of ['0', '366', '1.5', 'thirty']) {
      expect(() =>
        readMaintenanceEnv({
          DATABASE_URL: url,
          AUTH_REFRESH_FAMILY_MAX_DAYS: days,
        }),
      ).toThrow(/AUTH_REFRESH_FAMILY_MAX_DAYS/);
    }
  });

  it('refuses to start without a database and never echoes a value', () => {
    expect(() => readMaintenanceEnv({ NODE_ENV: 'production' })).toThrow(
      /no database/,
    );
    let message = '';
    try {
      readMaintenanceEnv({ DATABASE_URL: 'mysql://u:hunter2-secret@h/db' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).not.toContain('hunter2-secret');
  });

  it('reads the env files like ConfigModule: the first file wins, the process beats every file', () => {
    const first = join(dir, 'first.env');
    const second = join(dir, 'second.env');
    writeFileSync(first, 'DB_APP_PASSWORD=from-first\nPOSTGRES_DB=first_db\n');
    writeFileSync(
      second,
      'DB_APP_PASSWORD=from-second\nPOSTGRES_PORT=6543\nDB_HOST=from-second\n',
    );
    const env = environmentWithFiles({ DB_HOST: 'from-process' }, [
      join(dir, 'missing.env'),
      first,
      second,
    ]);
    expect(env['DB_APP_PASSWORD']).toBe('from-first');
    expect(env['POSTGRES_DB']).toBe('first_db');
    expect(env['POSTGRES_PORT']).toBe('6543');
    expect(env['DB_HOST']).toBe('from-process');
    expect(environmentWithFiles({ A: '1' }, [])).toEqual({ A: '1' });
  });

  it('prints one JSON line on success and one masked line on failure', () => {
    const line = resultLine(
      {
        verificationTokens: 3,
        refreshTokens: 12,
        verificationCutoff: new Date('2026-10-14T09:00:00.000Z'),
        refreshFamilyCutoff: new Date('2026-10-07T09:00:00.000Z'),
        dryRun: false,
      },
      41.6,
    );
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({
      event: 'maintenance.pruned',
      verificationTokens: 3,
      refreshTokens: 12,
      verificationCutoff: '2026-10-14T09:00:00.000Z',
      refreshFamilyCutoff: '2026-10-07T09:00:00.000Z',
      dryRun: false,
      durationMs: 42,
    });

    const failure = errorLine(
      new Error(
        'connect failed\n  for postgresql://articode_app:s3cr3t@db:5432/x (password s3cr3t)',
      ),
      ['s3cr3t'],
    );
    expect(failure).toBe(
      'maintenance failed: connect failed for postgresql://*** (password ***)',
    );
    expect(errorLine('boom')).toBe('maintenance failed: boom');
  });
});
