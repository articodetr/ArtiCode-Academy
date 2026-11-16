// PMFA (roadmap §4o, D-R113..D-R120) — the shared core of two-step verification
// for PLATFORM users: the sealing key, the second-factor checks with their
// replay guards, recovery codes, the sign-in challenge and session revocation.
// A copy of the academy's MfaCore (src/auth/mfa/mfa-core.service.ts) on the
// platform client: since D-R120 (ADR-076) the platform shares the PURE helpers
// of src/auth/mfa/ (node:crypto only) and never an academy service, module or
// the academy Prisma client (ADR-073). Keep the two cores in step. Used by the
// platform MFA routes (PMFA-T02), the two-step sign-in (T03) and the reset
// command (T04); every write runs in the CALLER's transaction after lockUser().
import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { deriveRecoveryCodeKey, generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from '../../../auth/mfa/recovery-codes.js';
import { openSecret, parseMfaKey, sealSecret } from '../../../auth/mfa/secret-box.js';
import { matchTotp } from '../../../auth/mfa/totp.js';
import type { Prisma } from '../../../generated/platform/client.js';
import type { PlatformEnv } from '../../platform.env.schema.js';
import { platformAuthError } from '../../platform.errors.js';
import { PlatformPrismaService } from '../../prisma/platform-prisma.service.js';
import { PlatformTokenService } from '../platform-token.service.js';

type Tx = Prisma.TransactionClient;
type Db = Tx | PlatformPrismaService['db'];

/** A setup must be confirmed within 10 minutes (D-R115, as D-R108). */
export const PLATFORM_MFA_SETUP_TTL_MS = 10 * 60 * 1000;
/** The sign-in challenge lives 5 minutes and allows 5 wrong codes (as D-R109). */
export const PLATFORM_MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const PLATFORM_MFA_CHALLENGE_MAX_ATTEMPTS = 5;
/** A challenge that ended (consumed or expired) more than this long ago is deleted at the user's next sign-in. */
export const PLATFORM_MFA_CHALLENGE_PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;
/** 256 random bits; base64url of 32 bytes is exactly 43 characters. */
export const PLATFORM_MFA_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** The MFA columns of a `platform_users` row (never returned to a client). */
export const PLATFORM_MFA_USER_SELECT = {
  id: true,
  mfaSecret: true,
  mfaEnabledAt: true,
  mfaLastStep: true,
  mfaPendingSecret: true,
  mfaPendingAt: true,
} satisfies Prisma.PlatformUserSelect;

export type PlatformMfaUserState = Prisma.PlatformUserGetPayload<{ select: typeof PLATFORM_MFA_USER_SELECT }>;

export interface IssuedPlatformMfaChallenge {
  /** Handed to the client once; only its SHA-256 is stored. */
  challenge: string;
  expiresAt: Date;
}

@Injectable()
export class PlatformMfaCore {
  private readonly logger = new Logger(PlatformMfaCore.name);
  private readonly key: Buffer | null;
  /** HMAC key of the recovery codes, derived from `key` (HKDF) — never the sealing key itself. */
  private readonly recoveryKey: Buffer | null;

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly tokens: PlatformTokenService,
    config: ConfigService<PlatformEnv, true>,
  ) {
    const raw = config.get('PLATFORM_MFA_ENCRYPTION_KEY', { infer: true });
    this.key = raw ? parseMfaKey(raw) : null;
    // validatePlatformEnv() refuses such a value at boot with the same parser; never fall back silently to 'MFA off'.
    if (raw && !this.key) throw new Error('PLATFORM_MFA_ENCRYPTION_KEY is set but is not 32 bytes of base64 or base64url');
    this.recoveryKey = this.key ? deriveRecoveryCodeKey(this.key) : null;
  }

  /** True when `PLATFORM_MFA_ENCRYPTION_KEY` is configured (D-R114). */
  get available(): boolean {
    return this.key !== null;
  }

  /** Throws `503 mfa_unavailable` when the server cannot seal or open secrets. */
  assertAvailable(): void {
    this.requireKey();
  }

  private requireKey(): Buffer {
    if (!this.key) throw platformAuthError.mfaUnavailable();
    return this.key;
  }

  /** Seals a Base32 TOTP secret for the user's row (the user id is the AAD — a secret copied to another row does not open). */
  seal(userId: string, secretBase32: string): string {
    return sealSecret(this.requireKey(), secretBase32, userId);
  }

  /**
   * Opens a sealed secret. A secret that does not open with the configured key
   * (a rotated or wrong key, a tampered row) makes MFA unavailable for that
   * account — never a bypass of the second factor.
   */
  open(userId: string, sealed: string): string {
    const secret = openSecret(this.requireKey(), sealed, userId);
    if (secret === null) {
      this.logger.error(`The MFA secret of platform user ${userId} does not open with PLATFORM_MFA_ENCRYPTION_KEY`);
      throw platformAuthError.mfaUnavailable();
    }
    return secret;
  }

  /** Locks the user's row for an MFA write. `FOR NO KEY UPDATE` — never `FOR UPDATE` (KI-079). */
  async lockUser(tx: Tx, userId: string): Promise<PlatformMfaUserState | null> {
    await tx.$queryRaw`SELECT id FROM platform_users WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
    return tx.platformUser.findUnique({ where: { id: userId }, select: PLATFORM_MFA_USER_SELECT });
  }

  /** True while a setup started at `pendingAt` can still be confirmed. */
  setupIsFresh(state: Pick<PlatformMfaUserState, 'mfaPendingSecret' | 'mfaPendingAt'>, now: Date = new Date()): boolean {
    return (
      state.mfaPendingSecret !== null &&
      state.mfaPendingAt !== null &&
      now.getTime() - state.mfaPendingAt.getTime() < PLATFORM_MFA_SETUP_TTL_MS
    );
  }

  /** The TOTP step a code matches on the PENDING secret, or null. No write. */
  matchPending(state: Pick<PlatformMfaUserState, 'id' | 'mfaPendingSecret'>, code: string, nowMs: number = Date.now()): number | null {
    if (state.mfaPendingSecret === null) return null;
    return matchTotp(this.open(state.id, state.mfaPendingSecret), code, nowMs, null);
  }

  /**
   * Checks a TOTP code on the ACTIVE secret and, on a match, advances
   * `mfa_last_step` conditionally — a code is accepted once in its window, and
   * of two simultaneous requests with the same code only one wins.
   */
  async acceptCode(
    tx: Tx,
    state: Pick<PlatformMfaUserState, 'id' | 'mfaSecret' | 'mfaLastStep'>,
    code: string,
    nowMs: number = Date.now(),
  ): Promise<boolean> {
    if (state.mfaSecret === null) return false;
    const lastStep = state.mfaLastStep === null ? null : Number(state.mfaLastStep);
    const step = matchTotp(this.open(state.id, state.mfaSecret), code, nowMs, lastStep);
    if (step === null) return false;
    const advanced = await tx.platformUser.updateMany({
      where: {
        id: state.id,
        mfaSecret: state.mfaSecret,
        OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: BigInt(step) } }],
      },
      data: { mfaLastStep: BigInt(step) },
    });
    return advanced.count === 1;
  }

  /**
   * The stored form of a recovery code typed by the user (HMAC under a key
   * derived from the platform key, bound to the user), or null when it is not
   * shaped like a code. Needs the key: `503 mfa_unavailable` without it.
   */
  recoveryCodeHash(userId: string, input: string): string | null {
    if (!this.recoveryKey) throw platformAuthError.mfaUnavailable();
    const normalized = normalizeRecoveryCode(input);
    return normalized === null ? null : hashRecoveryCode(this.recoveryKey, userId, normalized);
  }

  /**
   * Uses one unused recovery code of the user; returns how many are left, or
   * null when the code is not one of them. Conditional on `used_at IS NULL`
   * (of two simultaneous uses only one wins); `used_at` is the database clock.
   */
  async consumeRecoveryCode(tx: Tx, userId: string, input: string): Promise<number | null> {
    const codeHash = this.recoveryCodeHash(userId, input);
    if (codeHash === null) return null;
    const used = await tx.$executeRaw`UPDATE platform_mfa_recovery_codes SET used_at = now() WHERE user_id = ${userId}::uuid AND code_hash = ${codeHash} AND used_at IS NULL`;
    if (used !== 1) return null;
    return tx.platformMfaRecoveryCode.count({ where: { userId, usedAt: null } });
  }

  /** Replaces every recovery code of the user; the new codes are returned in plain text once and stored hashed. */
  async replaceRecoveryCodes(tx: Tx, userId: string): Promise<string[]> {
    const codes = generateRecoveryCodes();
    await tx.platformMfaRecoveryCode.deleteMany({ where: { userId } });
    await tx.platformMfaRecoveryCode.createMany({
      data: codes.map((code) => ({ userId, codeHash: this.recoveryCodeHash(userId, code)! })),
    });
    return codes;
  }

  /** Unused recovery codes of the user. */
  recoveryCodesLeft(db: Db, userId: string): Promise<number> {
    return db.platformMfaRecoveryCode.count({ where: { userId, usedAt: null } });
  }

  /** Clears MFA from the row and drops its recovery codes and open challenges (disable, reset). */
  async clear(tx: Tx, userId: string, now: Date = new Date()): Promise<void> {
    await tx.platformUser.update({
      where: { id: userId },
      data: { mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaPendingSecret: null, mfaPendingAt: null },
    });
    await tx.platformMfaRecoveryCode.deleteMany({ where: { userId } });
    await this.retireChallenges(tx, userId, now);
  }

  /** The refresh-token family of the caller's own `pla_refresh` cookie, or null (unknown token, or another user's). */
  async familyOf(userId: string, refreshToken: string | undefined): Promise<string | null> {
    if (!refreshToken) return null;
    const stored = await this.prisma.db.platformRefreshToken.findUnique({
      where: { tokenHash: this.tokens.hashRefreshToken(refreshToken) },
      select: { familyId: true, userId: true },
    });
    return stored && stored.userId === userId ? stored.familyId : null;
  }

  /** Revokes the user's live refresh tokens, except those of `keepFamilyId` (D-R118); returns how many were revoked. */
  async revokeSessions(tx: Tx, userId: string, keepFamilyId: string | null, now: Date = new Date()): Promise<number> {
    const result = await tx.platformRefreshToken.updateMany({
      where: { userId, revokedAt: null, ...(keepFamilyId ? { familyId: { not: keepFamilyId } } : {}) },
      data: { revokedAt: now },
    });
    return result.count;
  }

  // ------------------------------------------------------------ challenge

  /** SHA-256 hex of a challenge — the only thing stored. */
  hashChallenge(challenge: string): string {
    return createHash('sha256').update(challenge).digest('hex');
  }

  /**
   * Issues the sign-in challenge of a user whose password was just accepted:
   * retires the user's older open challenges and stores the new one's hash in
   * `platform_mfa_challenges` (attempts 0). Runs its own transaction when given
   * the root client, inside the caller's otherwise.
   */
  async issueChallenge(db: Db, userId: string, now: Date = new Date()): Promise<IssuedPlatformMfaChallenge> {
    const challenge = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + PLATFORM_MFA_CHALLENGE_TTL_MS);
    const write = async (tx: Tx): Promise<void> => {
      await this.retireChallenges(tx, userId, now);
      // The platform has no maintenance service (the academy's prunes verification_tokens): drop this
      // user's challenges that ended more than a day ago, so the table does not grow with every sign-in.
      const dayAgo = new Date(now.getTime() - PLATFORM_MFA_CHALLENGE_PRUNE_AFTER_MS);
      await tx.platformMfaChallenge.deleteMany({
        where: { userId, OR: [{ consumedAt: { lt: dayAgo } }, { expiresAt: { lt: dayAgo } }] },
      });
      await tx.platformMfaChallenge.create({ data: { userId, tokenHash: this.hashChallenge(challenge), expiresAt } });
    };
    // A transaction client also has $transaction in Prisma 7 (a nested savepoint): run inside the caller's transaction when given one.
    if (db === this.prisma.db) await this.prisma.db.$transaction(write);
    else await write(db as Tx);
    return { challenge, expiresAt };
  }

  /** Marks every open challenge of the user as consumed. */
  async retireChallenges(tx: Tx, userId: string, now: Date = new Date()): Promise<void> {
    await tx.platformMfaChallenge.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
  }
}
