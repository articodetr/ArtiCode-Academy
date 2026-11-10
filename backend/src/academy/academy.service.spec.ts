// TEST-036 (unit part) — AcademyService without a database: the missing row
// answers 503 `academy_not_configured` on both routes, an empty PATCH is
// refused before any query, and an idempotent PATCH neither writes nor
// records an event.
import type { AuthPrincipal } from '../auth/principal.js';
import { AcademyHttpException } from './academy.errors.js';
import { AcademyService } from './academy.service.js';

const ROW = {
  id: '0192f0b0-0000-7000-8000-00000000a001',
  slug: 'articode',
  name: { ar: 'أكاديمية آرتي كود', en: 'ArtiCode Academy' },
  logoUrl: null,
  defaultLocale: 'ar',
  timezone: 'Asia/Riyadh',
  currency: 'SAR',
  contactEmail: null,
  contactPhone: null,
  settings: { scheduling: { weekStartsOn: 6 } },
  createdAt: new Date('2026-10-29T12:00:00.000Z'),
  updatedAt: new Date('2026-10-29T12:00:00.000Z'),
};

const CALLER = { id: 'user-1', permissions: ['academy.settings.manage'] } as unknown as AuthPrincipal;
const CTX = { ip: '127.0.0.1', userAgent: 'vitest' };

function makeService(row: typeof ROW | null) {
  const findFirst = vi.fn().mockResolvedValue(row);
  const transaction = vi.fn();
  const record = vi.fn();
  const prisma = { db: { academy: { findFirst }, $transaction: transaction } };
  const service = new AcademyService(prisma as never, { record } as never);
  return { service, findFirst, transaction, record };
}

async function codeOf(promise: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AcademyHttpException) return { status: error.getStatus(), code: error.code };
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('AcademyService', () => {
  it('answers 503 academy_not_configured when the row is missing, on read and on update', async () => {
    const { service, transaction } = makeService(null);
    expect(await codeOf(service.get())).toEqual({ status: 503, code: 'academy_not_configured' });
    expect(await codeOf(service.update({ currency: 'TRY' }, CALLER, CTX))).toEqual({ status: 503, code: 'academy_not_configured' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuses an empty body with 400 nothing_to_update before touching the database', async () => {
    const { service, findFirst } = makeService(ROW);
    expect(await codeOf(service.update({}, CALLER, CTX))).toEqual({ status: 400, code: 'nothing_to_update' });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('returns the row as a DTO (settings read through the schema; no platformAcademyId or singleton) and writes nothing for an idempotent PATCH', async () => {
    const { service, transaction, record } = makeService(ROW);
    const dto = await service.get();
    expect(Object.keys(dto).sort()).toEqual([
      'contactEmail',
      'contactPhone',
      'createdAt',
      'currency',
      'defaultLocale',
      'id',
      'logoUrl',
      'name',
      'settings',
      'slug',
      'timezone',
      'updatedAt',
    ]);
    expect(dto.createdAt).toBe('2026-10-29T12:00:00.000Z');
    expect(dto.settings).toEqual({ scheduling: { weekStartsOn: 6, workingDays: null }, certificates: { serialPrefix: null } });

    const same = await service.update({ currency: 'SAR', name: { ar: 'أكاديمية آرتي كود', en: 'ArtiCode Academy' }, logoUrl: null }, CALLER, CTX);
    expect(same).toEqual(dto);
    // The same settings value (TEST-068) is no change either.
    expect(await service.update({ settings: { scheduling: { weekStartsOn: 6 } } }, CALLER, CTX)).toEqual(dto);
    expect(transaction).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
