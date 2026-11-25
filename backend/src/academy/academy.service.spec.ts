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

function makeService(row: typeof ROW | null, mailTransport = 'none', env: Record<string, string> = {}) {
  const findFirst = vi.fn().mockResolvedValue(row);
  const transaction = vi.fn();
  const record = vi.fn();
  const prisma = { db: { academy: { findFirst }, $transaction: transaction } };
  const values: Record<string, string> = { API_PREFIX: 'api', ...env, MAIL_TRANSPORT: mailTransport };
  const config = { get: vi.fn((key: string) => values[key]) };
  const service = new AcademyService(prisma as never, { record } as never, config as never);
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
    expect(dto.settings).toEqual({
      scheduling: { weekStartsOn: 6, workingDays: null },
      certificates: { serialPrefix: null },
      learning: { videoCompletionPercent: null },
      catalog: { publicBrowsing: null },
      selfRegistration: { enabled: null },
    });

    const same = await service.update({ currency: 'SAR', name: { ar: 'أكاديمية آرتي كود', en: 'ArtiCode Academy' }, logoUrl: null }, CALLER, CTX);
    expect(same).toEqual(dto);
    // The same settings value (TEST-068) is no change either.
    expect(await service.update({ settings: { scheduling: { weekStartsOn: 6 } } }, CALLER, CTX)).toEqual(dto);
    expect(transaction).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('API-205 answers catalogPublic true only when settings.catalog.publicBrowsing is exactly true (MOD-20, TEST-248)', async () => {
    const cases: Array<[unknown, boolean]> = [
      [{}, false],
      [{ catalog: { publicBrowsing: false } }, false],
      [{ catalog: { publicBrowsing: 'true' } }, false],
      [{ catalog: { publicBrowsing: true } }, true],
    ];
    for (const [settings, expected] of cases) {
      const { service } = makeService({ ...ROW, settings: settings as typeof ROW.settings });
      const dto = await service.getPublic();
      expect(Object.keys(dto).sort()).toEqual(['catalogPublic', 'defaultLocale', 'googleSignIn', 'googleSignUp', 'homepageImages', 'logoUrl', 'name', 'selfRegistration']);
      expect(dto.catalogPublic, JSON.stringify(settings)).toBe(expected);
    }
  });

  it('API-205 answers selfRegistration true only with the setting exactly true AND a mail transport (PORTAL-03, TEST-320)', async () => {
    const cases: Array<[unknown, string, boolean]> = [
      [{}, 'resend', false],
      [{ selfRegistration: { enabled: false } }, 'resend', false],
      [{ selfRegistration: { enabled: 'true' } }, 'resend', false],
      [{ selfRegistration: { enabled: true } }, 'none', false],
      [{ selfRegistration: { enabled: true } }, 'log', true],
      [{ selfRegistration: { enabled: true } }, 'resend', true],
    ];
    for (const [settings, transport, expected] of cases) {
      const { service } = makeService({ ...ROW, settings: settings as typeof ROW.settings }, transport);
      expect((await service.getPublic()).selfRegistration, `${JSON.stringify(settings)} ${transport}`).toBe(expected);
    }
  });

  it('API-205 answers googleSignIn when both Google client values are set, and googleSignUp only with the self-registration setting too — no mail transport needed (PORTAL-04)', async () => {
    const both = { GOOGLE_OAUTH_CLIENT_ID: 'client.apps.googleusercontent.com', GOOGLE_OAUTH_CLIENT_SECRET: 'test-only-secret' };
    const cases: Array<[unknown, Record<string, string>, boolean, boolean]> = [
      [{ selfRegistration: { enabled: true } }, {}, false, false],
      [{ selfRegistration: { enabled: true } }, { GOOGLE_OAUTH_CLIENT_ID: both.GOOGLE_OAUTH_CLIENT_ID }, false, false],
      [{}, both, true, false],
      [{ selfRegistration: { enabled: false } }, both, true, false],
      [{ selfRegistration: { enabled: 'true' } }, both, true, false],
      [{ selfRegistration: { enabled: true } }, both, true, true],
    ];
    for (const [settings, env, signIn, signUp] of cases) {
      // MAIL_TRANSPORT=none: Google sign-up does not depend on a transport, the e-mail sign-up does.
      const { service } = makeService({ ...ROW, settings: settings as typeof ROW.settings }, 'none', env);
      const dto = await service.getPublic();
      const label = `${JSON.stringify(settings)} ${Object.keys(env).join(',')}`;
      expect(dto.googleSignIn, label).toBe(signIn);
      expect(dto.googleSignUp, label).toBe(signUp);
      expect(dto.selfRegistration, label).toBe(false);
    }
  });

  it('API-205 answers the public URL of each homepage image, null for a default or a corrupt reference — nothing else about the files', async () => {
    const file = 'ab'.repeat(16) + '.png';
    const settings = {
      homepageImages: {
        heroStudent: { file, contentType: 'image/png', width: 760, height: 981, bytes: 1234, updatedAt: '2026-11-24T10:00:00.000Z' },
        aboutLearners: { file: '../etc/passwd', contentType: 'image/png', width: 1, height: 1, bytes: 1, updatedAt: '2026-11-24T10:00:00.000Z' },
      },
    };
    const { service } = makeService({ ...ROW, settings: settings as unknown as typeof ROW.settings });
    const dto = await service.getPublic();
    expect(dto.homepageImages).toEqual({ heroStudent: `/api/academy/media/${file}`, aboutLearners: null, promoTraining: null, whyClassroom: null });
  });
});
