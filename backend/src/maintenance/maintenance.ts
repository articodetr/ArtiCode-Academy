// MOD-17-T05 (D-R93): the daily maintenance — deletes the old dead tokens of
// verification_tokens and refresh_tokens, and nothing else. It records no audit
// event (the run prints its counts — main.ts) and never touches audit_logs,
// notifications or any other table.
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { maintenanceCutoffs } from './maintenance.rules.js';

export interface PruneOptions {
  /** AUTH_REFRESH_FAMILY_MAX_DAYS — the absolute lifetime of a refresh-token family. */
  familyMaxDays: number;
  /** Count what would be deleted without deleting it. */
  dryRun?: boolean;
  /**
   * TESTS ONLY: restrict both deletes to the tokens of these users, so an e2e
   * suite never deletes rows of the shared dev database it did not create.
   * Not exposed on the command line.
   */
  onlyUserIds?: readonly string[];
}

export interface PruneResult {
  /** verification_tokens deleted (or that would be, with dryRun). */
  verificationTokens: number;
  /** refresh_tokens deleted (or that would be, with dryRun). */
  refreshTokens: number;
  verificationCutoff: Date;
  refreshFamilyCutoff: Date;
  dryRun: boolean;
}

/** The rows of verification_tokens the run deletes: consumed or expired strictly before the cutoff. */
export function expiredVerificationTokensWhere(
  cutoff: Date,
  onlyUserIds?: readonly string[],
): Prisma.VerificationTokenWhereInput {
  return {
    OR: [{ consumedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }],
    ...(onlyUserIds ? { userId: { in: [...onlyUserIds] } } : {}),
  };
}

/** The rows of refresh_tokens the run deletes: every row of a family whose UUIDv7 started before the bound. */
export function deadRefreshFamiliesWhere(
  familyBound: string,
  onlyUserIds?: readonly string[],
): Prisma.RefreshTokenWhereInput {
  return {
    familyId: { lt: familyBound },
    ...(onlyUserIds ? { userId: { in: [...onlyUserIds] } } : {}),
  };
}

/**
 * One run. Both deletes go in one batch transaction, so a failure deletes
 * nothing; a second run right after finds nothing left (the rules only depend
 * on `now`). A token can only go once it was consumed or expired 30 days ago,
 * so it was created long before the 15-minute window of the e-mail
 * verification rate limit (API-165), which is therefore unaffected.
 */
export async function pruneExpiredTokens(
  db: PrismaClient,
  now: Date,
  options: PruneOptions,
): Promise<PruneResult> {
  const dryRun = options.dryRun ?? false;
  const cutoffs = maintenanceCutoffs(now, options.familyMaxDays);
  const verificationWhere = expiredVerificationTokensWhere(
    cutoffs.verificationCutoff,
    options.onlyUserIds,
  );
  const refreshWhere = deadRefreshFamiliesWhere(
    cutoffs.refreshFamilyBound,
    options.onlyUserIds,
  );

  let verificationTokens: number;
  let refreshTokens: number;
  if (dryRun) {
    [verificationTokens, refreshTokens] = await db.$transaction([
      db.verificationToken.count({ where: verificationWhere }),
      db.refreshToken.count({ where: refreshWhere }),
    ]);
  } else {
    const [verification, refresh] = await db.$transaction([
      db.verificationToken.deleteMany({ where: verificationWhere }),
      db.refreshToken.deleteMany({ where: refreshWhere }),
    ]);
    verificationTokens = verification.count;
    refreshTokens = refresh.count;
  }

  return {
    verificationTokens,
    refreshTokens,
    verificationCutoff: cutoffs.verificationCutoff,
    refreshFamilyCutoff: cutoffs.refreshFamilyCutoff,
    dryRun,
  };
}
