// TEST-204 (e2e part) — MOD-17-T05 (D-R93): the daily maintenance against the
// real database. Fixture tokens sit on both sides of each boundary (exactly at
// the cutoff stays, one millisecond older goes); the run deletes exactly the
// expected rows (AC1), leaves the e-mail verification rate limit of API-165
// as it was (AC2), finds nothing on a second run (AC3), deletes nothing with
// dryRun, and records no audit event. Every call passes `onlyUserIds` with the
// fixture users, so the shared dev database keeps everyone else's tokens.
// Skipped when no database is reachable.
import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadDotenv } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EMAIL_VERIFICATION_REQUEST_LIMIT,
  EMAIL_VERIFICATION_WINDOW_MS,
} from '../src/account/account.service.js';
import { postgresUrlFromEnv } from '../src/config/database-url.js';
import { ENV_FILE_PATHS } from '../src/config/env-files.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { TokenPurpose } from '../src/generated/prisma/client.js';
import { pruneExpiredTokens } from '../src/maintenance/maintenance.js';
import {
  minUuidV7,
  refreshFamilyCutoff,
  verificationTokenCutoff,
} from '../src/maintenance/maintenance.rules.js';

loadDotenv({ path: [...ENV_FILE_PATHS], quiet: true });

const DATABASE_URL =
  process.env['DATABASE_URL'] || postgresUrlFromEnv(process.env, 'app');
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const FAMILY_MAX_DAYS = 30;

async function canConnect(url: string): Promise<boolean> {
  const client = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url,
      connectionTimeoutMillis: 3000,
    }),
  });
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.$disconnect();
  }
}

const available = DATABASE_URL ? await canConnect(DATABASE_URL) : false;

/** A UUIDv7 of the millisecond `ms`; `tail` = 19 hex digits of "random" bits (the variant bits are forced). */
function uuidV7(ms: number, tail = randomBytes(10).toString('hex')): string {
  const hex = ms.toString(16).padStart(12, '0');
  const rand = tail.padEnd(19, '0').slice(0, 19);
  const variant = ((Number.parseInt(rand[3]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${rand.slice(0, 3)}-${variant}${rand.slice(4, 7)}-${rand.slice(7, 19)}`;
}

const hash = () => randomBytes(32).toString('hex');

describe.skipIf(!available)(
  'MOD-17-T05 daily maintenance (e2e, TEST-204)',
  () => {
    let prisma: PrismaClient;
    // One fixed instant for every run of the suite, so the boundaries are exact.
    const NOW = new Date();
    const V = verificationTokenCutoff(NOW).getTime();
    const R = refreshFamilyCutoff(NOW, FAMILY_MAX_DAYS).getTime();

    const users: Record<'main' | 'second' | 'outsider', string> = {
      main: '',
      second: '',
      outsider: '',
    };
    /** The users the runs may touch — the outsider is left out on purpose. */
    const scope = () => [users.main, users.second];
    const allUserIds = () => Object.values(users).filter((id) => id !== '');

    const verification: Record<string, string> = {};
    const refresh: Record<string, string> = {};
    const expectedGoneVerification = [
      'supersededLongAgo',
      'consumedAndExpired',
      'expiredLongAgo',
    ];
    const expectedGoneRefresh = ['dead1', 'dead2', 'deadSecond'];

    const prune = (dryRun = false) =>
      pruneExpiredTokens(prisma, NOW, {
        familyMaxDays: FAMILY_MAX_DAYS,
        dryRun,
        onlyUserIds: scope(),
      });

    async function remainingVerification(): Promise<string[]> {
      const rows = await prisma.verificationToken.findMany({
        where: { id: { in: Object.values(verification) } },
        select: { id: true },
      });
      const ids = new Set(rows.map((row) => row.id));
      return Object.keys(verification)
        .filter((name) => ids.has(verification[name]!))
        .sort();
    }

    async function remainingRefresh(): Promise<string[]> {
      const rows = await prisma.refreshToken.findMany({
        where: { id: { in: Object.values(refresh) } },
        select: { id: true },
      });
      const ids = new Set(rows.map((row) => row.id));
      return Object.keys(refresh)
        .filter((name) => ids.has(refresh[name]!))
        .sort();
    }

    /** The count API-165 makes before issuing a confirmation e-mail (account.service.ts). */
    const recentEmailVerifications = () =>
      prisma.verificationToken.count({
        where: {
          userId: users.main,
          purpose: 'email_verification',
          createdAt: {
            gte: new Date(Date.now() - EMAIL_VERIFICATION_WINDOW_MS),
          },
        },
      });

    async function addVerification(
      name: string,
      userId: string,
      purpose: TokenPurpose,
      times: { createdAt: number; expiresAt: number; consumedAt?: number },
    ) {
      const row = await prisma.verificationToken.create({
        data: {
          userId,
          purpose,
          tokenHash: hash(),
          createdAt: new Date(times.createdAt),
          expiresAt: new Date(times.expiresAt),
          consumedAt:
            times.consumedAt === undefined ? null : new Date(times.consumedAt),
        },
        select: { id: true },
      });
      verification[name] = row.id;
    }

    async function addRefresh(
      name: string,
      userId: string,
      familyId: string,
      times: { createdAt: number; expiresAt: number; revokedAt?: number },
    ) {
      const row = await prisma.refreshToken.create({
        data: {
          userId,
          familyId,
          tokenHash: hash(),
          createdAt: new Date(times.createdAt),
          expiresAt: new Date(times.expiresAt),
          revokedAt:
            times.revokedAt === undefined ? null : new Date(times.revokedAt),
        },
        select: { id: true },
      });
      refresh[name] = row.id;
    }

    beforeAll(async () => {
      prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: DATABASE_URL! }),
      });
      for (const name of Object.keys(users) as (keyof typeof users)[]) {
        const user = await prisma.user.create({
          data: {
            email: `maint-${name}-${RUN}@example.test`,
            fullName: `Fixture maintenance ${name}`,
            locale: 'en',
          },
          select: { id: true },
        });
        users[name] = user.id;
      }
      const { main, second, outsider } = users;

      // verification_tokens — cutoff V = NOW − 30 days.
      // A superseded token is retired with consumed_at (account.service.ts).
      await addVerification('supersededLongAgo', main, 'email_verification', {
        createdAt: V - DAY,
        expiresAt: V + DAY,
        consumedAt: V - 1,
      });
      await addVerification('consumedAtCutoff', main, 'invitation', {
        createdAt: V - DAY,
        expiresAt: V + DAY,
        consumedAt: V,
      });
      await addVerification('consumedAndExpired', main, 'password_reset', {
        createdAt: V - 3 * DAY,
        expiresAt: V - 2 * DAY,
        consumedAt: V - 2 * DAY - HOUR,
      });
      await addVerification('expiredLongAgo', main, 'password_reset', {
        createdAt: V - HOUR,
        expiresAt: V - 1,
      });
      await addVerification('expiredAtCutoff', main, 'password_reset', {
        createdAt: V - HOUR,
        expiresAt: V,
      });
      await addVerification('expiredRecently', main, 'invitation', {
        createdAt: NOW.getTime() - 3 * DAY,
        expiresAt: NOW.getTime() - DAY,
      });
      await addVerification('pending', main, 'invitation', {
        createdAt: NOW.getTime() - HOUR,
        expiresAt: NOW.getTime() + 47 * HOUR,
      });
      // Three confirmation e-mails in the last 15 minutes: the rate limit of API-165.
      // The first two were superseded by the next request, the third is pending.
      await addVerification('fresh1', main, 'email_verification', {
        createdAt: NOW.getTime() - 10 * MINUTE,
        expiresAt: NOW.getTime() - 10 * MINUTE + 48 * HOUR,
        consumedAt: NOW.getTime() - 6 * MINUTE,
      });
      await addVerification('fresh2', main, 'email_verification', {
        createdAt: NOW.getTime() - 6 * MINUTE,
        expiresAt: NOW.getTime() - 6 * MINUTE + 48 * HOUR,
        consumedAt: NOW.getTime() - 2 * MINUTE,
      });
      await addVerification('fresh3', main, 'email_verification', {
        createdAt: NOW.getTime() - 2 * MINUTE,
        expiresAt: NOW.getTime() - 2 * MINUTE + 48 * HOUR,
      });
      // Old enough, but outside the runs' scope.
      await addVerification('outsiderOld', outsider, 'invitation', {
        createdAt: V - 3 * DAY,
        expiresAt: V - DAY,
        consumedAt: V - 2 * DAY,
      });

      // refresh_tokens — families that started before R = NOW − (30 + 7) days are dead.
      const deadFamily = uuidV7(R - 1, 'fffffffffffffffffff'); // the largest id of the millisecond before R
      await addRefresh('dead2', main, deadFamily, {
        createdAt: R + DAY,
        expiresAt: R + 15 * DAY,
      });
      await addRefresh('dead1', main, deadFamily, {
        createdAt: R,
        expiresAt: R + 14 * DAY,
        revokedAt: R + DAY,
      });
      await prisma.refreshToken.update({
        where: { id: refresh['dead1']! },
        data: { replacedById: refresh['dead2']! },
      });
      await addRefresh('deadSecond', second, uuidV7(R - DAY), {
        createdAt: R - DAY,
        expiresAt: R + 13 * DAY,
      });
      // The smallest id of R's own millisecond: a family of that millisecond stays.
      await addRefresh('atCutoff', main, minUuidV7(new Date(R)), {
        createdAt: R,
        expiresAt: R + 14 * DAY,
      });
      await addRefresh(
        'justInside',
        second,
        uuidV7(R + 1, '0000000000000000000'),
        { createdAt: R + 1, expiresAt: R + 14 * DAY },
      );
      await addRefresh('live', main, uuidV7(NOW.getTime() - DAY), {
        createdAt: NOW.getTime() - DAY,
        expiresAt: NOW.getTime() + 13 * DAY,
      });
      await addRefresh('outsiderDead', outsider, uuidV7(R - 30 * DAY), {
        createdAt: R - 30 * DAY,
        expiresAt: R - 16 * DAY,
      });
    });

    afterAll(async () => {
      if (!prisma) return;
      const ids = allUserIds();
      if (ids.length > 0) {
        await prisma.refreshToken.deleteMany({
          where: { userId: { in: ids } },
        });
        await prisma.verificationToken.deleteMany({
          where: { userId: { in: ids } },
        });
        await prisma.user.deleteMany({ where: { id: { in: ids } } });
      }
      await prisma.$disconnect();
    });

    it('dry run: counts the rows past each boundary and deletes nothing', async () => {
      const result = await prune(true);
      expect(result).toEqual({
        verificationTokens: expectedGoneVerification.length,
        refreshTokens: expectedGoneRefresh.length,
        verificationCutoff: new Date(V),
        refreshFamilyCutoff: new Date(R),
        dryRun: true,
      });
      expect(await remainingVerification()).toEqual(
        Object.keys(verification).sort(),
      );
      expect(await remainingRefresh()).toEqual(Object.keys(refresh).sort());
    });

    it('AC1/AC2: deletes exactly the rows strictly past each cutoff and leaves the API-165 rate limit as it was', async () => {
      expect(await recentEmailVerifications()).toBe(
        EMAIL_VERIFICATION_REQUEST_LIMIT,
      );

      const result = await prune();
      expect(result).toMatchObject({
        verificationTokens: expectedGoneVerification.length,
        refreshTokens: expectedGoneRefresh.length,
        dryRun: false,
      });

      expect(await remainingVerification()).toEqual(
        Object.keys(verification)
          .filter((name) => !expectedGoneVerification.includes(name))
          .sort(),
      );
      expect(await remainingRefresh()).toEqual(
        Object.keys(refresh)
          .filter((name) => !expectedGoneRefresh.includes(name))
          .sort(),
      );
      // The three recent requests still count: a fourth would still be refused.
      expect(await recentEmailVerifications()).toBe(
        EMAIL_VERIFICATION_REQUEST_LIMIT,
      );
    });

    it('AC3: a second run right after finds nothing to delete', async () => {
      const before = [await remainingVerification(), await remainingRefresh()];
      expect(await prune()).toMatchObject({
        verificationTokens: 0,
        refreshTokens: 0,
        dryRun: false,
      });
      expect(await prune(true)).toMatchObject({
        verificationTokens: 0,
        refreshTokens: 0,
        dryRun: true,
      });
      expect([await remainingVerification(), await remainingRefresh()]).toEqual(
        before,
      );
    });

    it('records no audit event and leaves the users in place', async () => {
      const ids = allUserIds();
      expect(
        await prisma.auditLog.count({
          where: {
            OR: [{ actorUserId: { in: ids } }, { entityId: { in: ids } }],
          },
        }),
      ).toBe(0);
      expect(await prisma.user.count({ where: { id: { in: ids } } })).toBe(
        ids.length,
      );
    });
  },
);
