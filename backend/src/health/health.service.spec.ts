import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PACKAGE_VERSION, SERVICE_NAME } from '../common/package-info.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { DatabasePing } from '../prisma/prisma.service.js';
import { HealthService } from './health.service.js';

async function buildService(ping: DatabasePing): Promise<HealthService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      HealthService,
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) => (key === 'NODE_ENV' ? 'test' : undefined),
        },
      },
      { provide: PrismaService, useValue: { ping: async () => ping } },
    ],
  }).compile();
  return moduleRef.get(HealthService);
}

describe('HealthService', () => {
  it('check() reports ok with the package version and the environment', async () => {
    const service = await buildService({ ok: true, latencyMs: 1 });
    const report = service.check();

    expect(report.status).toBe('ok');
    expect(report.service).toBe(SERVICE_NAME);
    expect(report.version).toBe(PACKAGE_VERSION);
    expect(report.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(report.environment).toBe('test');
    expect(Number.isNaN(Date.parse(report.timestamp))).toBe(false);
    expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('readiness() is ready when the database answers', async () => {
    const service = await buildService({ ok: true, latencyMs: 4 });
    const report = await service.readiness();

    expect(report.status).toBe('ready');
    expect(report.checks.database).toEqual({ status: 'up', latencyMs: 4 });
  });

  it('readiness() is not ready when the database is down, keeping the driver error', async () => {
    const service = await buildService({
      ok: false,
      configured: true,
      error: 'connect ECONNREFUSED 127.0.0.1:5432',
    });
    const report = await service.readiness();

    expect(report.status).toBe('not_ready');
    expect(report.checks.database).toEqual({
      status: 'down',
      error: 'connect ECONNREFUSED 127.0.0.1:5432',
    });
  });

  it('readiness() distinguishes a missing DATABASE_URL from an outage', async () => {
    const service = await buildService({ ok: false, configured: false });
    const report = await service.readiness();

    expect(report.status).toBe('not_ready');
    expect(report.checks.database).toEqual({ status: 'not_configured' });
  });
});
