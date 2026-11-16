// MOD-01-H06 — the shared core of two-step verification (roadmap §4n): the
// sealing key, the second-factor checks with their replay guards, recovery
// codes, the sign-in challenge and session revocation. Used by the account
// routes (MFA-T02), the two-step sign-in (T03) and the administrative reset
// (T04); it has no route of its own. Every write runs in the CALLER's
// transaction, after `lockUser()`.
import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { authError } from '../auth.errors.js';
import { TokenService } from '../token.service.js';
import { deriveRecoveryCodeKey, generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from './recovery-codes.js';
import { openSecret, parseMfaKey, sealSecret } from './secret-box.js';
import { matchTotp } from './totp.js';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService['db'];

/** A setup (API-207) must be confirmed (API-208) within 10 minutes (D-R108). */
export const MFA_SETUP_TTL_MS = 10 * 60 * 1000;
/** The sign-in challenge lives 5 minutes and allows 5 wrong codes (D-R109). */
export const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const MFA_CHALLENGE_MAX_ATTEMPTS = 5;
/** 256 random bits; base64url of 32 bytes is exactly 43 characters. */
export const MFA_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** The MFA columns of a `users` row (never returned to a client). */
export const MFA_USER_SELECT = {
  id: true,
  mfaSecret: true,
  mfaEnabledAt: true,
  mfaLastStep: true,
  mfaPendingSecret: true,
  mfaPendingAt: true,
} satisfies Prisma.UserSelect;

export type MfaUserState = Prisma.UserGetPayload<{ select: typeof MFA_USER_SELECT }>;

/** The metadata of a `verification_tokens` row with purpose `mfa_challenge`. */
export interface MfaChallengeMetadata {
  attempts: number;
}

export interface IssuedMfaChallenge {
  /** Handed to the client once; only its SHA-256 is stored. */
  challenge: string;
  expiresAt: Date;
}

@Injectable()
export class MfaCore {
  private readonly logger = new Logger(MfaCore.name);
  private readonly key: Buffer | null;
  /** HMAC key of the recovery codes, derived from `key` (HKDF) — never the sealing key itself. */
  private readonly recoveryKey: Buffer | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    config: ConfigService<Env, true>,
  ) {
    const raw = config.get('AUTH_MFA_ENCRYPTION_KEY', { infer: true });
    this.key = raw ? parseMfaKey(raw) : null;
    // validateEnv() refuses such a value at boot with the same parser; never fall back silently to 'MFA off'.
    if (raw && !this.key) throw new Error('AUTH_MFA_ENCRYPTION_KEY is set but is not 32 bytes of base64 or base64url');
    this.recoveryKey = this.key ? deriveRecoveryCodeKey(this.key) : null;
  }

  /** True when `AUTH_MFA_ENCRYPTION_KEY` is configured (D-R107). */
  get available(): boolean {
    return this.key !== null;
  }

  /** Throws `503 mfa_unavailable` when the server cannot seal or open secrets. */
  assertAvailable(): void {
    this.requireKey();
  }

  private requireKey(): Buffer {
    if (!this.key) throw authError.mfaUnavailable();
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
      this.logger.error(`The MFA secret of user ${userId} does not open with AUTH_MFA_ENCRYPTION_KEY`);
      throw authError.mfaUnavailable();
    }
    return secret;
  }

  /** Locks the user's row for an MFA write. `FOR NO KEY UPDATE` — never `FOR UPDATE` on `users` (KI-079). */
  async lockUser(tx: Tx, userId: string): Promise<MfaUserState | null> {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
    return tx.user.findUnique({ where: { id: userId }, select: MFA_USER_SELECT });
  }

  /** True while a setup started at `pendingAt` can still be confirmed. */
  setupIsFresh(state: Pick<MfaUserState, 'mfaPendingSecret' | 'mfaPendingAt'>, now: Date = new Date()): boolean {
    return (
      state.mfaPendingSecret !== null &&
      state.mfaPendingAt !== null &&
      now.getTime() - state.mfaPendingAt.getTime() < MFA_SETUP_TTL_MS
    );
  }

  /** The TOTP step a code matches on the PENDING secret (API-208), or null. No write. */
  matchPending(state: Pick<MfaUserState, 'id' | 'mfaPendingSecret'>, code: string, nowMs: number = Date.now()): number | null {
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
    state: Pick<MfaUserState, 'id' | 'mfaSecret' | 'mfaLastStep'>,
    code: string,
    nowMs: number = Date.now(),
  ): Promise<boolean> {
    if (state.mfaSecret === null) return false;
    const lastStep = state.mfaLastStep === null ? null : Number(state.mfaLastStep);
    const step = matchTotp(this.open(state.id, state.mfaSecret), code, nowMs, lastStep);
    if (step === null) return false;
    const advanced = await tx.user.updateMany({
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
   * The stored form of a recovery code typed by the user (keyed and bound to the
   * user — `hashRecoveryCode()`), or null when it is not shaped like a code.
   * Needs the key: `503 mfa_unavailable` without it.
   */
  recoveryCodeHash(userId: string, input: string): string | null {
    if (!this.recoveryKey) throw authError.mfaUnavailable();
    const normalized = normalizeRecoveryCode(input);
    return normalized === null ? null : hashRecoveryCode(this.recoveryKey, userId, normalized);
  }

  /**
   * Uses one unused recovery code of the user; returns how many are left, or
   * null when the code is not one of them. Conditional on `used_at IS NULL`, so
   * of two simultaneous uses only one wins; `used_at` is the database clock, the
   * clock of `created_at` (`ck_mfa_recovery_codes_used_after_created`).
   */
  async consumeRecoveryCode(tx: Tx, userId: string, input: string): Promise<number | null> {
    const codeHash = this.recoveryCodeHash(userId, input);
    if (codeHash === null) return null;
    const used = await tx.$executeRaw`UPDATE mfa_recovery_codes SET used_at = now() WHERE user_id = ${userId}::uuid AND code_hash = ${codeHash} AND used_at IS NULL`;
    if (used !== 1) return null;
    return tx.mfaRecoveryCode.count({ where: { userId, usedAt: null } });
  }

  /** Replaces every recovery code of the user; the new codes are returned in plain text once and stored hashed. */
  async replaceRecoveryCodes(tx: Tx, userId: string): Promise<string[]> {
    const codes = generateRecoveryCodes();
    await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
    await tx.mfaRecoveryCode.createMany({
      data: codes.map((code) => ({ userId, codeHash: this.recoveryCodeHash(userId, code)! })),
    });
    return codes;
  }

  /** Unused recovery codes of the user. */
  recoveryCodesLeft(db: Db, userId: string): Promise<number> {
    return db.mfaRecoveryCode.count({ where: { userId, usedAt: null } });
  }

  /** Clears MFA from the row and drops its recovery codes and open challenges (API-209 disable, API-212 reset). */
  async clear(tx: Tx, userId: string, now: Date = new Date()): Promise<void> {
    await tx.user.update({
      where: { id: userId },
      data: { mfaSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaPendingSecret: null, mfaPendingAt: null },
    });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
    await this.retireChallenges(tx, userId, now);
  }

  /** The refresh-token family of the caller's own cookie, or null (unknown token, or another user's). */
  async familyOf(userId: string, refreshToken: string | undefined): Promise<string | null> {
    if (!refreshToken) return null;
    const stored = await this.prisma.db.refreshToken.findUnique({
      where: { tokenHash: this.tokens.hashRefreshToken(refreshToken) },
      select: { familyId: true, userId: true },
    });
    return stored && stored.userId === userId ? stored.familyId : null;
  }

  /** Revokes the user's live refresh tokens, except those of `keepFamilyId` (D-R111); returns how many were revoked. */
  async revokeSessions(tx: Tx, userId: string, keepFamilyId: string | null, now: Date = new Date()): Promise<number> {
    const result = await tx.refreshToken.updateMany({
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
   * Issues the sign-in challenge of a user whose password was just accepted
   * (D-R109): retires the user's older open challenges and stores the new
   * one's hash with `{ attempts: 0 }`.
   */
  async issueChallenge(db: Db, userId: string, now: Date = new Date()): Promise<IssuedMfaChallenge> {
    const challenge = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + MFA_CHALLENGE_TTL_MS);
    const metadata: MfaChallengeMetadata = { attempts: 0 };
    const write = async (tx: Tx): Promise<void> => {
      await this.retireChallenges(tx, userId, now);
      await tx.verificationToken.create({
        data: { userId, purpose: 'mfa_challenge', tokenHash: this.hashChallenge(challenge), expiresAt, metadata: { ...metadata } },
      });
    };
    // A transaction client also has $transaction in Prisma 7 (a nested savepoint): run inside the caller's transaction when given one.
    if (db === this.prisma.db) await this.prisma.db.$transaction(write);
    else await write(db as Tx);
    return { challenge, expiresAt };
  }

  /** Marks every open challenge of the user as consumed. */
  async retireChallenges(tx: Tx, userId: string, now: Date = new Date()): Promise<void> {
    await tx.verificationToken.updateMany({
      where: { userId, purpose: 'mfa_challenge', consumedAt: null },
      data: { consumedAt: now },
    });
  }
}
