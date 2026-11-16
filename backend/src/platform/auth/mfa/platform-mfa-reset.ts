// PMFA-T04 (roadmap §4o, D-R117) — resetting the two-step verification of a
// PLATFORM account from the server. v1 has no HTTP route that manages platform
// users (they are created out of band — platform-bootstrap.ts), so the reset is
// a command too: scripts/platform-reset-mfa.ts → npm run platform:reset-mfa.
// The logic lives here so TEST-234 calls it directly; the script only reads its
// input. The academy model is API-212 (UsersService.resetMfa() of
// src/users/users.service.ts). Rules:
//   - the account is found by its login e-mail, normalised as the platform
//     stores it (normalizePlatformEmail()); an unknown e-mail is refused
//     (`user_not_found`), whatever the account's status otherwise;
//   - everything runs in ONE transaction behind a `FOR NO KEY UPDATE` lock on
//     the `platform_users` row (never `FOR UPDATE` — KI-079), the lock order of
//     PlatformMfaCore.lockUser();
//   - an account with neither MFA on (`mfa_secret`) nor a setup in progress
//     (`mfa_pending_secret`) is a no-op: `{ reset: false }`, no write, no event;
//   - otherwise the five MFA columns are cleared, the recovery codes deleted,
//     the open sign-in challenges marked consumed and EVERY live refresh token
//     of the account revoked (the account signs in again with its password
//     alone), with exactly one `platform.users.mfa_reset { revokedSessions,
//     reason? }` — actor NULL (the operator is the server, nobody is signed in),
//     like `platform.users.created` of the bootstrap;
//   - it never opens or seals a secret, so it needs no PLATFORM_MFA_ENCRYPTION_KEY:
//     it is the way out after a lost or rotated key. It is not a Nest provider
//     and uses plain Prisma calls on the platform client (ADR-073).
import { assertNoSecrets } from '../../../audit/audit-metadata.js';
import type { PrismaClient } from '../../../generated/platform/client.js';
import { PLATFORM_USERS_ENTITY, isPlatformEmail, normalizePlatformEmail } from '../platform-session.rules.js';

/** The event of a reset (master doc 12.4). */
export const PLATFORM_USERS_MFA_RESET_EVENT = 'platform.users.mfa_reset';

/** The optional reason, trimmed: 1..500 characters (the academy's API-212 limit). */
export const PLATFORM_MFA_RESET_REASON_MAX_LENGTH = 500;

export interface PlatformMfaResetInput {
  /** The account's login e-mail (trimmed and lower-cased here). */
  email: string;
  /** Why the operator resets it; blank = no reason (as the academy's textParam). */
  reason?: string;
}

export interface PlatformMfaResetResult {
  userId: string;
  /** true when MFA (or a setup awaiting confirmation) was cleared; false = nothing to reset, nothing written. */
  reset: boolean;
  /** Live refresh tokens revoked (0 when nothing was reset). */
  revokedSessions: number;
}

export type PlatformMfaResetErrorCode = 'input_invalid' | 'user_not_found';

/** A refused reset: invalid input (`problems`) or no platform account with that e-mail. Nothing was written. */
export class PlatformMfaResetError extends Error {
  constructor(
    readonly code: PlatformMfaResetErrorCode,
    message: string,
    readonly problems: readonly string[] = [],
  ) {
    super(message);
    this.name = 'PlatformMfaResetError';
  }
}

/** The stored reason: trimmed, absent when blank. */
function normalizeReason(reason: string | undefined): string | undefined {
  if (reason === undefined) return undefined;
  const trimmed = reason.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Validation problems of the input (empty when acceptable). */
export function platformMfaResetInputProblems(input: PlatformMfaResetInput): string[] {
  const problems: string[] = [];
  if (!isPlatformEmail(normalizePlatformEmail(input.email))) problems.push('email must be a valid address');
  const reason = normalizeReason(input.reason);
  if (reason !== undefined) {
    // Counted in code points, like the length check of the academy's DTO.
    if ([...reason].length > PLATFORM_MFA_RESET_REASON_MAX_LENGTH) {
      problems.push(`reason must have at most ${PLATFORM_MFA_RESET_REASON_MAX_LENGTH} characters`);
    }
    // PostgreSQL text and jsonb cannot hold U+0000 (KI-078 on the HTTP side).
    if (reason.includes('\u0000')) problems.push('reason must not contain a NUL character');
  }
  return problems;
}

/**
 * Resets the two-step verification of the platform account with this e-mail.
 * Throws PlatformMfaResetError (`input_invalid`, `user_not_found`) before any
 * write; any other error is the database's.
 */
export async function resetPlatformUserMfa(db: PrismaClient, input: PlatformMfaResetInput): Promise<PlatformMfaResetResult> {
  const problems = platformMfaResetInputProblems(input);
  if (problems.length > 0) {
    throw new PlatformMfaResetError('input_invalid', `Platform MFA reset input is invalid: ${problems.join('; ')}`, problems);
  }
  const email = normalizePlatformEmail(input.email);
  const reason = normalizeReason(input.reason);
  const notFound = () => new PlatformMfaResetError('user_not_found', 'No platform account has this e-mail');

  return db.$transaction(async (tx) => {
    const owner = await tx.platformUser.findUnique({ where: { email }, select: { id: true } });
    if (!owner) throw notFound();
    const userId = owner.id;
    // The row lock of PlatformMfaCore.lockUser(): serialises the reset with the holder's own MFA writes and sign-in step.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM platform_users WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
    if (locked.length === 0) throw notFound();
    const state = await tx.platformUser.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, mfaPendingSecret: true },
    });
    if (!state) throw notFound();
    if (state.mfaSecret === null && state.mfaPendingSecret === null) {
      return { userId, reset: false, revokedSessions: 0 };
    }

    const now = new Date();
    await tx.platformUser.update({
      where: { id: userId },
      data: { mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaPendingSecret: null, mfaPendingAt: null },
    });
    await tx.platformMfaRecoveryCode.deleteMany({ where: { userId } });
    await tx.platformMfaChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
    const revoked = await tx.platformRefreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    const revokedSessions = revoked.count;
    // The number of ended sessions and the operator's reason — never a secret, a code, a challenge or a hash.
    const metadata = { revokedSessions, ...(reason !== undefined ? { reason } : {}) };
    assertNoSecrets(metadata);
    await tx.platformAuditLog.create({
      data: {
        action: PLATFORM_USERS_MFA_RESET_EVENT,
        actorPlatformUserId: null,
        entityType: PLATFORM_USERS_ENTITY,
        entityId: userId,
        metadata,
      },
    });
    return { userId, reset: true, revokedSessions };
  });
}
