// TEST-207 (unit) — MOD-18-T02 PlatformAuditService (no database: fake clients).
import { describe, expect, it, vi } from 'vitest';
import type { PlatformPrismaService, PlatformTransaction } from '../prisma/platform-prisma.service.js';
import { PlatformAuditService } from './platform-audit.service.js';

function fakeClient(create = vi.fn(async () => ({}))) {
  return { client: { platformAuditLog: { create } }, create };
}

const ACTOR = '019a7d00-0000-7000-8000-000000000001';
const ENTITY = '019a7d00-0000-7000-8000-000000000002';

describe('PlatformAuditService.record', () => {
  it('writes one row through the given transaction with the request context', async () => {
    const own = fakeClient();
    const tx = fakeClient();
    const service = new PlatformAuditService({ db: own.client } as unknown as PlatformPrismaService);
    await service.record(tx.client as unknown as PlatformTransaction, {
      actorId: ACTOR,
      action: 'platform.academies.created',
      entityType: 'academies',
      entityId: ENTITY,
      metadata: { slug: 'demo', fields: ['name'] },
      ctx: { ip: '127.0.0.1', userAgent: 'vitest' },
    });
    expect(own.create).not.toHaveBeenCalled();
    expect(tx.create).toHaveBeenCalledWith({
      data: {
        action: 'platform.academies.created',
        actorPlatformUserId: ACTOR,
        entityType: 'academies',
        entityId: ENTITY,
        metadata: { slug: 'demo', fields: ['name'] },
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      },
    });
  });

  it('refuses credential-like metadata keys (also nested) before writing', async () => {
    const tx = fakeClient();
    const service = new PlatformAuditService({ db: tx.client } as unknown as PlatformPrismaService);
    for (const metadata of [{ password: 'x' }, { refreshTokenHash: 'x' }, { nested: { apiSecret: 'x' } }]) {
      await expect(service.record(null, { actorId: null, action: 'platform.auth.login.failed', metadata })).rejects.toThrow(
        /must not contain credentials/,
      );
    }
    expect(tx.create).not.toHaveBeenCalled();
  });

  it('inside a transaction a failure throws; on its own it is logged and swallowed', async () => {
    const failing = vi.fn(async () => {
      throw new Error('boom');
    });
    const tx = fakeClient(failing);
    const service = new PlatformAuditService({ db: tx.client } as unknown as PlatformPrismaService);
    await expect(
      service.record(tx.client as unknown as PlatformTransaction, { actorId: null, action: 'platform.auth.logout' }),
    ).rejects.toThrow('boom');
    await expect(service.record(null, { actorId: null, action: 'platform.auth.logout' })).resolves.toBeUndefined();
    expect(failing).toHaveBeenCalledTimes(2);
    expect(failing).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ metadata: undefined, entityType: null, entityId: null, ipAddress: null, userAgent: null }),
    });
  });
});
