import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppliedMigrations, DatabasePing } from '../../prisma/database-checks.js';
import { PlatformPrismaService } from '../prisma/platform-prisma.service.js';
import { PLATFORM_MIGRATIONS_DIR, PlatformHealthService } from './platform-health.service.js';

// TEST-213 (KI-084): the platform readiness answer (API-177) is public too —
// fixed codes only, never the driver's message.
const NEWEST = '20261113182048_platform_init';
let migrationsDir: string;

beforeAll(async () => {
  migrationsDir = await mkdtemp(join(tmpdir(), 'articode-platform-health-'));
  await mkdir(join(migrationsDir, NEWEST));
  await writeFile(join(migrationsDir, NEWEST, 'migration.sql'), 'SELECT 1;');
});

afterAll(async () => {
  await rm(migrationsDir, { recursive: true, force: true });
});

async function readiness(ping: DatabasePing, applied: AppliedMigrations = { ok: true, names: [NEWEST] }) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      PlatformHealthService,
      { provide: ConfigService, useValue: { get: (key: string) => (key === 'NODE_ENV' ? 'test' : undefined) } },
      { provide: PlatformPrismaService, useValue: { ping: async () => ping, appliedMigrations: async () => applied } },
      { provide: PLATFORM_MIGRATIONS_DIR, useValue: migrationsDir },
    ],
  }).compile();
  return moduleRef.get(PlatformHealthService).readiness();
}

describe('PlatformHealthService.readiness()', () => {
  it('names a fixed code while the database is down, never the driver message', async () => {
    const report = await readiness({
      ok: false,
      configured: true,
      error: 'password authentication failed for user "platform_app"',
    });
    expect(report.status).toBe('not_ready');
    expect(report.checks.database).toEqual({ status: 'down', error: 'database_unreachable' });
    expect(JSON.stringify(report)).not.toContain('platform_app');

    const late = await readiness({ ok: false, configured: true, error: 'timed out after 5000 ms', timedOut: true });
    expect(late.checks.database).toEqual({ status: 'down', error: 'database_timeout' });
  });

  it('names a fixed code when the migrations table cannot be read', async () => {
    const report = await readiness(
      { ok: true, latencyMs: 1 },
      { ok: false, error: 'permission denied for table _prisma_migrations' },
    );
    expect(report.reason).toBe('schema_unverified');
    expect(report.checks.schema).toEqual({
      status: 'error',
      expected: NEWEST,
      applied: null,
      error: 'migrations_unreadable',
    });
  });
});
