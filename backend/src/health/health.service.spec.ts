import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PACKAGE_VERSION, SERVICE_NAME } from '../common/package-info.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  AppliedMigrations,
  DatabasePing,
} from '../prisma/prisma.service.js';
import { HealthService } from './health.service.js';
import { MIGRATIONS_DIR } from './schema-version.js';

const OLD = '20261029150949_init_identity_academy';
const NEW = '20261112083749_mod12_notifications';

let migrationsDir: string;
let noMigrationsDir: string;

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), 'articode-health-'));
  migrationsDir = join(root, 'migrations');
  for (const name of [OLD, NEW]) {
    await mkdir(join(migrationsDir, name), { recursive: true });
    await writeFile(join(migrationsDir, name, 'migration.sql'), 'SELECT 1;');
  }
  noMigrationsDir = join(root, 'missing');
});

afterAll(async () => {
  await rm(join(migrationsDir, '..'), { recursive: true, force: true });
});

async function buildService(
  ping: DatabasePing,
  applied: AppliedMigrations = { ok: true, names: [OLD, NEW] },
  dir: string = migrationsDir,
) {
  const appliedMigrations = vi.fn(async () => applied);
  const moduleRef = await Test.createTestingModule({
    providers: [
      HealthService,
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) => (key === 'NODE_ENV' ? 'test' : undefined),
        },
      },
      {
        provide: PrismaService,
        useValue: { ping: async () => ping, appliedMigrations },
      },
      { provide: MIGRATIONS_DIR, useValue: dir },
    ],
  }).compile();
  return { service: moduleRef.get(HealthService), appliedMigrations };
}

describe('HealthService', () => {
  it('check() reports ok with the package version and the environment', async () => {
    const { service } = await buildService({ ok: true, latencyMs: 1 });
    const report = service.check();

    expect(report.status).toBe('ok');
    expect(report.service).toBe(SERVICE_NAME);
    expect(report.version).toBe(PACKAGE_VERSION);
    expect(report.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(report.environment).toBe('test');
    expect(Number.isNaN(Date.parse(report.timestamp))).toBe(false);
    expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('readiness() is ready when the database answers and holds the shipped migration', async () => {
    const { service } = await buildService({ ok: true, latencyMs: 4 });
    const report = await service.readiness();

    expect(report.status).toBe('ready');
    expect(report).not.toHaveProperty('reason');
    expect(report.checks.database).toEqual({ status: 'up', latencyMs: 4 });
    expect(report.checks.schema).toEqual({
      status: 'current',
      expected: NEW,
      applied: NEW,
    });
  });

  it('readiness() is not ready when the database is down, keeping the driver error, and does not read the migrations table', async () => {
    const { service, appliedMigrations } = await buildService({
      ok: false,
      configured: true,
      error: 'connect ECONNREFUSED 127.0.0.1:5432',
    });
    const report = await service.readiness();

    expect(report.status).toBe('not_ready');
    expect(report.reason).toBe('database_unavailable');
    expect(report.checks.database).toEqual({
      status: 'down',
      error: 'connect ECONNREFUSED 127.0.0.1:5432',
    });
    expect(report.checks.schema).toEqual({
      status: 'unchecked',
      expected: NEW,
      applied: null,
    });
    expect(appliedMigrations).not.toHaveBeenCalled();
  });

  it('readiness() distinguishes a missing DATABASE_URL from an outage', async () => {
    const { service } = await buildService({ ok: false, configured: false });
    const report = await service.readiness();

    expect(report.status).toBe('not_ready');
    expect(report.reason).toBe('database_unavailable');
    expect(report.checks.database).toEqual({ status: 'not_configured' });
  });

  it('readiness() is not ready (schema_outdated) while the shipped migration is not applied', async () => {
    const outdated = await buildService(
      { ok: true, latencyMs: 2 },
      { ok: true, names: [OLD] },
    );
    const report = await outdated.service.readiness();
    expect(report.status).toBe('not_ready');
    expect(report.reason).toBe('schema_outdated');
    expect(report.checks.schema).toEqual({
      status: 'outdated',
      expected: NEW,
      applied: OLD,
    });

    // no _prisma_migrations yet (a fresh database before migrate deploy)
    const fresh = await buildService(
      { ok: true, latencyMs: 2 },
      { ok: true, names: [] },
    );
    expect((await fresh.service.readiness()).checks.schema).toEqual({
      status: 'outdated',
      expected: NEW,
      applied: null,
    });
  });

  it('readiness() stays ready when the database is ahead of the build (an upgrade in progress)', async () => {
    const newer = '20261201000000_future_module';
    const { service } = await buildService(
      { ok: true, latencyMs: 2 },
      { ok: true, names: [OLD, NEW, newer] },
    );
    const report = await service.readiness();
    expect(report.status).toBe('ready');
    expect(report.checks.schema).toEqual({
      status: 'ahead',
      expected: NEW,
      applied: newer,
    });
  });

  it('readiness() is not ready (schema_unverified) when the migrations table cannot be read', async () => {
    const { service } = await buildService(
      { ok: true, latencyMs: 2 },
      { ok: false, error: 'timed out after 5000 ms' },
    );
    const report = await service.readiness();
    expect(report.status).toBe('not_ready');
    expect(report.reason).toBe('schema_unverified');
    expect(report.checks.schema).toEqual({
      status: 'error',
      expected: NEW,
      applied: null,
      error: 'timed out after 5000 ms',
    });
  });

  it('readiness() does not check the schema without shipped migrations, and reads the folder once', async () => {
    const { service, appliedMigrations } = await buildService(
      { ok: true, latencyMs: 2 },
      { ok: true, names: [] },
      noMigrationsDir,
    );
    const first = await service.readiness();
    expect(first.status).toBe('ready');
    expect(first.checks.schema).toEqual({
      status: 'unchecked',
      expected: null,
      applied: null,
    });
    expect(appliedMigrations).not.toHaveBeenCalled();

    // the folder appearing later changes nothing: the build's migrations are read once
    await mkdir(join(noMigrationsDir, NEW), { recursive: true });
    await writeFile(join(noMigrationsDir, NEW, 'migration.sql'), 'SELECT 1;');
    expect((await service.readiness()).checks.schema.expected).toBeNull();
  });
});
