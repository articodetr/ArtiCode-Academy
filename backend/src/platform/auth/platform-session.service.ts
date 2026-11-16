// MOD-18-T03 (D-R100; roadmap §4m.5) — the sessions of the platform accounts
// (`platform_users`, `platform_refresh_tokens`), modelled on the academy MOD-01
// AuthService (src/auth/auth.service.ts, ADR-024): Argon2id passwords, a
// temporary lock after PLATFORM_LOCKOUT_THRESHOLD failed sign-ins, refresh
// tokens rotated on every use with reuse detection (a replayed rotated token
// revokes its whole family) and the family's absolute lifetime read from its
// UUIDv7 `family_id` (PLATFORM_REFRESH_FAMILY_MAX_DAYS — MOD-01-H03, ADR-063).
//
// Differences from the academy, on purpose:
//  - a sign-in lock blocks NEW sign-ins only; it never ends a running session
//    or a refresh (platformSessionGate() of platform-principal.service.ts);
//  - the failed-attempt counter is incremented atomically in the database;
//  - a refresh that loses a race against a concurrent refresh of the same
//    token is `401 refresh_invalid` and creates nothing (no forked family);
//  - every event names the account as its entity (`platform_users`, id); the
//    actor is NULL when the caller has not proved who they are (a failed
//    sign-in, a replayed refresh token);
//  - no event without an effective write, except the refused sign-ins.
//
// Since PMFA-T03 (roadmap §4o, as the academy MFA-T03 / D-R109): for an account
// with two-step verification the password opens NO session — API-178 answers
// the challenge of the second step, and API-218 (`loginWithMfa()`) opens the
// session with a TOTP code or a recovery code (PlatformMfaCore).
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PasswordService } from '../../auth/password.service.js';
import type { RequestContext } from '../../auth/principal.js';
import type { PlatformRole, PlatformUserStatus } from '../../generated/platform/client.js';
import { PlatformAuditService } from '../audit/platform-audit.service.js';
import type { PlatformEnv } from '../platform.env.schema.js';
import { platformAuthError } from '../platform.errors.js';
import { PlatformPrismaService } from '../prisma/platform-prisma.service.js';
import type { PlatformTransaction } from '../prisma/platform-prisma.service.js';
import {
  PLATFORM_MFA_CHALLENGE_MAX_ATTEMPTS,
  PLATFORM_MFA_CHALLENGE_PATTERN,
  PLATFORM_MFA_CHALLENGE_TTL_MS,
  PlatformMfaCore,
} from './mfa/platform-mfa-core.service.js';
import type { IssuedPlatformSession } from './platform-cookies.js';
import {
  afterWrongPlatformAttempt,
  challengeExhausted,
  challengeOutlivedPassword,
  pickPlatformMfaFactor,
} from './platform-mfa-login.rules.js';
import type { PendingPlatformMfaSignIn, PlatformSessionVia } from './platform-mfa-login.rules.js';
import { platformSessionGate } from './platform-principal.service.js';
import type { PlatformPrincipal } from './platform-principal.js';
import type { PlatformUserDto } from './platform-session.dto.js';
import {
  PLATFORM_AUTH_EVENTS,
  PLATFORM_USERS_ENTITY,
  failedLoginLocks,
  lockRemainingSeconds,
  normalizePlatformEmail,
  platformNewPasswordProblems,
  refreshVerdict,
} from './platform-session.rules.js';
import { PlatformTokenService } from './platform-token.service.js';

/** The public columns of a platform account (never the hash or the counters). */
export const PLATFORM_USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  status: true,
} as const;

/** What a sign-in reads: the public columns plus the hash, the lock state and whether MFA is on (the sealed secret — never returned). */
const LOGIN_SELECT = {
  ...PLATFORM_USER_SELECT,
  passwordHash: true,
  lockedUntil: true,
  mfaSecret: true,
} as const;

/** What the second sign-in step reads of the account: the public columns plus the lock and the password's age. */
const MFA_STEP_ACCOUNT_SELECT = {
  ...PLATFORM_USER_SELECT,
  lockedUntil: true,
  passwordChangedAt: true,
} as const;

interface PublicUserRow {
  id: string;
  email: string;
  fullName: string;
  role: PlatformRole;
  status: PlatformUserStatus;
}

/** Why a sign-in of a KNOWN account was refused (`platform.auth.login.failed { reason }`). */
export type PlatformLoginFailure = 'invalid_password' | 'locked' | 'no_password' | 'suspended' | 'invalid_mfa_code';

/** What API-178 answers: a session, or — for an account with MFA — the challenge of the second step (API-218). */
export type PlatformLoginOutcome = IssuedPlatformSession | PendingPlatformMfaSignIn;

/** A refresh token generated for a session that is about to be written. */
interface PreparedPlatformSession {
  refresh: { token: string; hash: string };
  refreshExpiresAt: Date;
}

/** The outcome of the factor transaction of API-218: a written session, or an error to throw once the refusal's writes are committed. */
type MfaStepResult =
  | { kind: 'session'; prepared: PreparedPlatformSession; user: PublicUserRow }
  | { kind: 'refused'; error: Error };

export function toPlatformUserDto(user: PublicUserRow): PlatformUserDto {
  return { id: user.id, email: user.email, fullName: user.fullName, role: user.role, status: user.status };
}

@Injectable()
export class PlatformSessionService {
  private readonly lockoutThreshold: number;
  private readonly lockoutMs: number;

  constructor(
    private readonly prisma: PlatformPrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: PlatformTokenService,
    private readonly audit: PlatformAuditService,
    private readonly mfa: PlatformMfaCore,
    config: ConfigService<PlatformEnv, true>,
  ) {
    this.lockoutThreshold = config.get('PLATFORM_LOCKOUT_THRESHOLD', { infer: true });
    this.lockoutMs = config.get('PLATFORM_LOCKOUT_MINUTES', { infer: true }) * 60 * 1000;
  }

  // ---------------------------------------------------------------- login

  /**
   * API-178. An unknown e-mail looks exactly like a wrong password (`401
   * invalid_credentials`, the same Argon2 time, no event); a locked account is
   * `423 account_locked { retryAfterSeconds }` before the password is checked;
   * the attempt that reaches the threshold locks the account and answers 423;
   * the status is checked only after the password matched (`403
   * account_suspended`), so it is never revealed to a guesser.
   *
   * PMFA-T03: for an account with MFA a correct password is only the first
   * step — the answer is `{ mfaRequired, challenge, expiresAt }` (older open
   * challenges retired), with no cookie and no event, and the failed-sign-in
   * counter deliberately NOT reset (else a holder of the password could clear
   * it between guesses of the code; the second step resets it). Without
   * PLATFORM_MFA_ENCRYPTION_KEY, or when the account's secret does not open
   * with it, `503 mfa_unavailable` — never a session without the second factor.
   */
  async login(identifierRaw: string, password: string, ctx: RequestContext): Promise<PlatformLoginOutcome> {
    const email = normalizePlatformEmail(identifierRaw);
    const user = await this.prisma.db.platformUser.findUnique({ where: { email }, select: LOGIN_SELECT });
    if (!user) {
      await this.passwords.verifyDummy(password);
      throw platformAuthError.invalidCredentials();
    }

    const now = new Date();
    const lockSeconds = lockRemainingSeconds(user.lockedUntil, now);
    if (lockSeconds !== null) {
      await this.recordRefusedLogin(user.id, 'locked', ctx);
      throw platformAuthError.accountLocked(lockSeconds);
    }

    if (!user.passwordHash) {
      await this.passwords.verifyDummy(password);
      await this.recordRefusedLogin(user.id, 'no_password', ctx);
      throw platformAuthError.invalidCredentials();
    }

    if (!(await this.passwords.verify(user.passwordHash, password))) {
      const { locked } = await this.registerFailedLogin(user.id, ctx);
      if (locked) throw platformAuthError.accountLocked(Math.ceil(this.lockoutMs / 1000));
      throw platformAuthError.invalidCredentials();
    }

    const gate = platformSessionGate(user);
    if (gate) {
      await this.recordRefusedLogin(user.id, 'suspended', ctx);
      throw gate;
    }

    if (user.mfaSecret !== null) return this.issueMfaChallenge(user.id, user.mfaSecret, now);

    return this.openSession(user, now, ctx);
  }

  /**
   * API-218 — the second step of a two-step sign-in (PMFA-T03, the academy
   * API-211): the challenge from the password step plus exactly one factor, a
   * TOTP code or a recovery code. Checks in order: `400 mfa_factor_required`;
   * `401 mfa_challenge_invalid` (malformed, unknown, used, expired, worn out,
   * issued before the last password change, or MFA turned off — that
   * challenge is consumed); `423 account_locked` (records
   * `platform.auth.login.failed { reason: 'locked' }`, as the password step);
   * `403 account_suspended`; `503 mfa_unavailable`; then the factor under the
   * user-row lock (`FOR NO KEY UPDATE`), every check repeated there. A wrong,
   * replayed or used factor counts in the challenge (consumed at its 5th) AND
   * in the account's lockout (`platform.auth.login.failed { reason:
   * 'invalid_mfa_code', failedAttempts, locked }`) — those writes are
   * committed before the 401/423 is thrown. A right one consumes the challenge
   * and opens the session in the same transaction
   * (`platform.auth.login.succeeded { via: 'mfa' | 'recovery_code', familyId,
   * recoveryCodesLeft? }`).
   */
  async loginWithMfa(
    challengeRaw: string,
    input: { code?: string | null; recoveryCode?: string | null },
    ctx: RequestContext,
  ): Promise<IssuedPlatformSession> {
    const factor = pickPlatformMfaFactor(input);
    if (!factor) throw platformAuthError.mfaFactorRequired();
    if (typeof challengeRaw !== 'string' || !PLATFORM_MFA_CHALLENGE_PATTERN.test(challengeRaw)) {
      throw platformAuthError.mfaChallengeInvalid();
    }

    const db = this.prisma.db;
    const now = new Date();
    const row = await db.platformMfaChallenge.findUnique({
      where: { tokenHash: this.mfa.hashChallenge(challengeRaw) },
      select: {
        id: true,
        expiresAt: true,
        consumedAt: true,
        attempts: true,
        user: { select: { ...MFA_STEP_ACCOUNT_SELECT, mfaSecret: true } },
      },
    });
    if (!row || !this.challengeUsable(row, row.user.passwordChangedAt, now)) throw platformAuthError.mfaChallengeInvalid();
    const user = row.user;
    if (user.mfaSecret === null) {
      // MFA was turned off after the password step: this challenge leads nowhere any more.
      await db.platformMfaChallenge.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: now } });
      throw platformAuthError.mfaChallengeInvalid();
    }
    const lockSeconds = lockRemainingSeconds(user.lockedUntil, now);
    if (lockSeconds !== null) {
      await this.recordRefusedLogin(user.id, 'locked', ctx);
      throw platformAuthError.accountLocked(lockSeconds);
    }
    const gate = platformSessionGate(user);
    if (gate) throw gate;
    this.mfa.assertAvailable();

    const via: PlatformSessionVia = factor.kind === 'code' ? 'mfa' : 'recovery_code';
    const result = await db.$transaction(async (tx): Promise<MfaStepResult> => {
      // Every second step of this account runs one at a time from here on: the lock serialises the
      // replay guard, the recovery codes, the challenge's attempts and the lockout counter.
      const state = await this.mfa.lockUser(tx, user.id);
      const account = await tx.platformUser.findUnique({ where: { id: user.id }, select: MFA_STEP_ACCOUNT_SELECT });
      const challenge = await tx.platformMfaChallenge.findUnique({
        where: { id: row.id },
        select: { expiresAt: true, consumedAt: true, attempts: true },
      });
      // Re-checked under the lock: a parallel request may have used the challenge or changed the account meanwhile.
      if (!state || !account || !challenge || !this.challengeUsable(challenge, account.passwordChangedAt, now)) {
        throw platformAuthError.mfaChallengeInvalid();
      }
      if (state.mfaSecret === null) {
        await this.mfa.retireChallenges(tx, user.id, now);
        return { kind: 'refused', error: platformAuthError.mfaChallengeInvalid() };
      }
      const lockedFor = lockRemainingSeconds(account.lockedUntil, now);
      if (lockedFor !== null) {
        await this.recordRefusedLogin(user.id, 'locked', ctx, tx);
        return { kind: 'refused', error: platformAuthError.accountLocked(lockedFor) };
      }
      const accountGate = platformSessionGate(account);
      if (accountGate) throw accountGate;

      let recoveryCodesLeft: number | null = null;
      let accepted: boolean;
      if (factor.kind === 'code') {
        accepted = await this.mfa.acceptCode(tx, state, factor.value, now.getTime());
      } else {
        recoveryCodesLeft = await this.mfa.consumeRecoveryCode(tx, user.id, factor.value);
        accepted = recoveryCodesLeft !== null;
      }

      if (!accepted) {
        // A wrong, replayed or used-up factor: one more attempt on the challenge (consumed at the
        // limit — never above it, the CHECK allows 0..5) and one more failure on the account,
        // through the same lockout as the password.
        const next = afterWrongPlatformAttempt(challenge.attempts, PLATFORM_MFA_CHALLENGE_MAX_ATTEMPTS);
        await tx.platformMfaChallenge.update({
          where: { id: row.id },
          data: { attempts: next.attempts, ...(next.exhausted ? { consumedAt: now } : {}) },
        });
        const { locked } = await this.registerFailedLogin(user.id, ctx, { tx, reason: 'invalid_mfa_code' });
        return {
          kind: 'refused',
          error: locked
            ? platformAuthError.accountLocked(Math.ceil(this.lockoutMs / 1000))
            : platformAuthError.mfaCodeInvalid(HttpStatus.UNAUTHORIZED),
        };
      }

      // Of two simultaneous right answers only one consumes the challenge (and so gets a session).
      const consumed = await tx.platformMfaChallenge.updateMany({
        where: { id: row.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw platformAuthError.mfaChallengeInvalid();
      const prepared = this.prepareSession(now);
      await this.writeSession(tx, user.id, prepared, now, ctx, via === 'recovery_code' ? { via, recoveryCodesLeft } : { via });
      return { kind: 'session', prepared, user: account };
    });

    if (result.kind === 'refused') throw result.error;
    return this.signSession(result.user, result.prepared);
  }

  /**
   * True while a challenge can still be answered: not used, not expired, not
   * worn out by wrong factors, and issued after the account's last password
   * change (the issue time is `expiresAt − TTL`).
   */
  private challengeUsable(
    challenge: { expiresAt: Date; consumedAt: Date | null; attempts: number },
    passwordChangedAt: Date | null,
    now: Date,
  ): boolean {
    return (
      challenge.consumedAt === null &&
      challenge.expiresAt.getTime() > now.getTime() &&
      !challengeExhausted(challenge.attempts, PLATFORM_MFA_CHALLENGE_MAX_ATTEMPTS) &&
      !challengeOutlivedPassword(challenge.expiresAt, passwordChangedAt, PLATFORM_MFA_CHALLENGE_TTL_MS)
    );
  }

  /**
   * The challenge of the second step (no event). Without the server key — or
   * when the account's secret does not open with it — `503 mfa_unavailable`:
   * never a session without the second factor, and never a challenge that no
   * code could answer.
   */
  private async issueMfaChallenge(userId: string, sealedSecret: string, now: Date): Promise<PendingPlatformMfaSignIn> {
    this.mfa.assertAvailable();
    this.mfa.open(userId, sealedSecret);
    const issued = await this.mfa.issueChallenge(this.prisma.db, userId, now);
    return { mfaRequired: true, challenge: issued.challenge, expiresAt: issued.expiresAt };
  }

  /** Clears the lock counters, opens a refresh-token family and records `platform.auth.login.succeeded { via: 'password' }`. */
  private async openSession(user: PublicUserRow, now: Date, ctx: RequestContext): Promise<IssuedPlatformSession> {
    const prepared = this.prepareSession(now);
    await this.prisma.db.$transaction((tx) => this.writeSession(tx, user.id, prepared, now, ctx, { via: 'password' }));
    return this.signSession(user, prepared);
  }

  /** A fresh refresh token; a new family starts now and PLATFORM_REFRESH_FAMILY_MAX_DAYS ≥ PLATFORM_REFRESH_TTL_DAYS, so it gets its full lifetime. */
  private prepareSession(now: Date): PreparedPlatformSession {
    return { refresh: this.tokens.newRefreshToken(), refreshExpiresAt: this.tokens.refreshExpiry(now) };
  }

  /**
   * The writes of a new session inside the caller's transaction: lock counters
   * reset, `last_login_at`, the first refresh token of a new family, and
   * `platform.auth.login.succeeded { via, familyId, recoveryCodesLeft? }`.
   */
  private async writeSession(
    tx: PlatformTransaction,
    userId: string,
    prepared: PreparedPlatformSession,
    now: Date,
    ctx: RequestContext,
    details: { via: PlatformSessionVia; recoveryCodesLeft?: number | null },
  ): Promise<void> {
    await tx.platformUser.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
    const created = await tx.platformRefreshToken.create({
      data: {
        userId,
        tokenHash: prepared.refresh.hash,
        expiresAt: prepared.refreshExpiresAt,
        userAgent: ctx.userAgent,
        ipAddress: ctx.ip,
      },
      select: { familyId: true },
    });
    const metadata: Record<string, unknown> = { via: details.via, familyId: created.familyId };
    if (details.recoveryCodesLeft !== undefined) metadata['recoveryCodesLeft'] = details.recoveryCodesLeft;
    await this.audit.record(tx, {
      actorId: userId,
      action: PLATFORM_AUTH_EVENTS.loginSucceeded,
      entityType: PLATFORM_USERS_ENTITY,
      entityId: userId,
      metadata,
      ctx,
    });
  }

  /** Signs the access token of a session whose writes are committed. */
  private async signSession(user: PublicUserRow, prepared: PreparedPlatformSession): Promise<IssuedPlatformSession> {
    const access = await this.tokens.signAccessToken({ userId: user.id, role: user.role });
    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: prepared.refresh.token,
      refreshExpiresAt: prepared.refreshExpiresAt,
      user: toPlatformUserDto(user),
    };
  }

  /**
   * Counts a failed attempt atomically (concurrent guesses never lose an
   * increment) — the one place that does, for the password step and the MFA
   * step alike; the attempt that reaches the threshold locks the account for
   * PLATFORM_LOCKOUT_MINUTES and restarts the counter. One event, in the same
   * transaction: `{ reason, failedAttempts, locked }` — `invalid_password`, or
   * `invalid_mfa_code` from the MFA step, which passes its own transaction (it
   * holds the user-row lock).
   */
  private async registerFailedLogin(
    userId: string,
    ctx: RequestContext,
    options: { tx?: PlatformTransaction; reason?: Extract<PlatformLoginFailure, 'invalid_password' | 'invalid_mfa_code'> } = {},
  ): Promise<{ locked: boolean }> {
    const reason = options.reason ?? 'invalid_password';
    const write = async (tx: PlatformTransaction): Promise<{ locked: boolean }> => {
      const { failedLoginCount } = await tx.platformUser.update({
        where: { id: userId },
        data: { failedLoginCount: { increment: 1 } },
        select: { failedLoginCount: true },
      });
      const locked = failedLoginLocks(failedLoginCount, this.lockoutThreshold);
      if (locked) {
        await tx.platformUser.update({
          where: { id: userId },
          data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + this.lockoutMs) },
        });
      }
      await this.audit.record(tx, {
        actorId: null,
        action: PLATFORM_AUTH_EVENTS.loginFailed,
        entityType: PLATFORM_USERS_ENTITY,
        entityId: userId,
        metadata: { reason, failedAttempts: failedLoginCount, locked },
        ctx,
      });
      return { locked };
    };
    return options.tx ? write(options.tx) : this.prisma.db.$transaction(write);
  }

  /**
   * A refused sign-in of a known account that changes nothing (locked, no
   * password, suspended). Written on its own (`tx` null), or inside the MFA
   * step's transaction when the lock is found under the user-row lock.
   */
  private async recordRefusedLogin(
    userId: string,
    reason: PlatformLoginFailure,
    ctx: RequestContext,
    tx: PlatformTransaction | null = null,
  ): Promise<void> {
    await this.audit.record(tx, {
      actorId: null,
      action: PLATFORM_AUTH_EVENTS.loginFailed,
      entityType: PLATFORM_USERS_ENTITY,
      entityId: userId,
      metadata: { reason },
      ctx,
    });
  }

  // -------------------------------------------------------------- refresh

  /**
   * API-179. Retires the presented token and issues its successor in the same
   * family. A token that was already rotated or revoked revokes every live
   * token of its family (`401 refresh_reused`, one event when something was
   * revoked); past its expiry or the family's deadline it is `401
   * refresh_expired`; a suspended account is `403 account_suspended` (both
   * retire the token). A temporary sign-in lock does not stop a refresh.
   */
  async refresh(refreshToken: string, ctx: RequestContext): Promise<IssuedPlatformSession> {
    const db = this.prisma.db;
    const now = new Date();
    const stored = await db.platformRefreshToken.findUnique({
      where: { tokenHash: this.tokens.hashRefreshToken(refreshToken) },
      select: {
        id: true,
        userId: true,
        familyId: true,
        expiresAt: true,
        revokedAt: true,
        replacedById: true,
        user: { select: PLATFORM_USER_SELECT },
      },
    });
    if (!stored) throw platformAuthError.refreshInvalid();

    const deadline = this.tokens.familyDeadline(stored.familyId);
    const verdict = refreshVerdict(stored, deadline, now);

    if (verdict === 'reused') {
      // Someone else may hold a copy of this token: end every live session of the family.
      await db.$transaction(async (tx) => {
        const revoked = await tx.platformRefreshToken.updateMany({
          where: { familyId: stored.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
        if (revoked.count === 0) return;
        await this.audit.record(tx, {
          actorId: null,
          action: PLATFORM_AUTH_EVENTS.refreshReused,
          entityType: PLATFORM_USERS_ENTITY,
          entityId: stored.userId,
          metadata: { familyId: stored.familyId, revokedSessions: revoked.count },
          ctx,
        });
      });
      throw platformAuthError.refreshReused();
    }

    if (verdict === 'expired') {
      await this.retire(stored.id, now);
      throw platformAuthError.refreshExpired();
    }

    const gate = platformSessionGate(stored.user);
    if (gate) {
      await this.retire(stored.id, now);
      throw gate;
    }

    const next = this.tokens.newRefreshToken();
    const refreshExpiresAt = this.tokens.refreshExpiry(now, deadline);
    await db.$transaction(async (tx) => {
      const created = await tx.platformRefreshToken.create({
        data: {
          userId: stored.userId,
          familyId: stored.familyId,
          tokenHash: next.hash,
          expiresAt: refreshExpiresAt,
          userAgent: ctx.userAgent,
          ipAddress: ctx.ip,
        },
        select: { id: true },
      });
      // Conditional: of two concurrent refreshes of one token only one retires it;
      // the other rolls back (its successor is never created) and is refused.
      const retired = await tx.platformRefreshToken.updateMany({
        where: { id: stored.id, revokedAt: null, replacedById: null },
        data: { revokedAt: now, replacedById: created.id },
      });
      if (retired.count !== 1) throw platformAuthError.refreshInvalid();
    });

    const access = await this.tokens.signAccessToken({ userId: stored.userId, role: stored.user.role });
    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: next.token,
      refreshExpiresAt,
      user: toPlatformUserDto(stored.user),
    };
  }

  private async retire(tokenId: string, now: Date): Promise<void> {
    await this.prisma.db.platformRefreshToken.updateMany({
      where: { id: tokenId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  // -------------------------------------------------------------- logout

  /**
   * API-180. Revokes the family behind the refresh cookie (this device's
   * session). Silent for a missing or unknown token; one
   * `platform.auth.logout { scope: 'device', familyId }` when a live token was
   * revoked.
   */
  async logout(refreshToken: string | undefined, ctx: RequestContext): Promise<void> {
    if (!refreshToken) return;
    const db = this.prisma.db;
    const stored = await db.platformRefreshToken.findUnique({
      where: { tokenHash: this.tokens.hashRefreshToken(refreshToken) },
      select: { userId: true, familyId: true },
    });
    if (!stored) return;
    await db.$transaction(async (tx) => {
      const revoked = await tx.platformRefreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count === 0) return;
      await this.audit.record(tx, {
        actorId: stored.userId,
        action: PLATFORM_AUTH_EVENTS.logout,
        entityType: PLATFORM_USERS_ENTITY,
        entityId: stored.userId,
        metadata: { scope: 'device', familyId: stored.familyId },
        ctx,
      });
    });
  }

  /**
   * API-180b `POST /api/auth/logout-all`. Revokes every live refresh token of
   * the caller (every device); one `platform.auth.logout { scope: 'all',
   * revokedSessions }` when something was revoked. Returns the count.
   */
  async logoutAll(userId: string, ctx: RequestContext): Promise<number> {
    return this.prisma.db.$transaction(async (tx) => {
      const revoked = await tx.platformRefreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count > 0) {
        await this.audit.record(tx, {
          actorId: userId,
          action: PLATFORM_AUTH_EVENTS.logout,
          entityType: PLATFORM_USERS_ENTITY,
          entityId: userId,
          metadata: { scope: 'all', revokedSessions: revoked.count },
          ctx,
        });
      }
      return revoked.count;
    });
  }

  // ------------------------------------------------------------------ me

  /** API-181. The caller's account as stored now (`401 session_invalid` if it vanished since the guard read it). */
  async me(principal: PlatformPrincipal): Promise<PlatformUserDto> {
    const user = await this.prisma.db.platformUser.findUnique({
      where: { id: principal.id },
      select: PLATFORM_USER_SELECT,
    });
    if (!user) throw platformAuthError.sessionInvalid();
    return toPlatformUserDto(user);
  }

  // ------------------------------------------------------------ password

  /**
   * API-182. Checks the current password (`400 password_invalid`), the policy
   * (`400 password_weak { problems }`), stores the new Argon2id hash and
   * `password_changed_at` — every access token issued in an earlier second
   * dies at its next request — and revokes every other refresh family of the
   * caller; the family of the presented `pla_refresh` cookie (if it is the
   * caller's) survives, so this device refreshes into a new access token. One
   * `platform.auth.password.changed { revokedSessions }`.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    currentRefreshToken: string | undefined,
    ctx: RequestContext,
  ): Promise<void> {
    const db = this.prisma.db;
    const user = await db.platformUser.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user?.passwordHash) {
      await this.passwords.verifyDummy(currentPassword);
      throw platformAuthError.passwordInvalid();
    }
    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
      throw platformAuthError.passwordInvalid();
    }
    const problems = platformNewPasswordProblems(newPassword, currentPassword);
    if (problems.length > 0) throw platformAuthError.passwordWeak(problems);

    const current = currentRefreshToken
      ? await db.platformRefreshToken.findUnique({
          where: { tokenHash: this.tokens.hashRefreshToken(currentRefreshToken) },
          select: { userId: true, familyId: true },
        })
      : null;
    const keepFamily = current && current.userId === userId ? current.familyId : null;
    const passwordHash = await this.passwords.hash(newPassword);
    const now = new Date();
    await db.$transaction(async (tx) => {
      await tx.platformUser.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: now } });
      const revoked = await tx.platformRefreshToken.updateMany({
        where: { userId, revokedAt: null, ...(keepFamily ? { familyId: { not: keepFamily } } : {}) },
        data: { revokedAt: now },
      });
      await this.audit.record(tx, {
        actorId: userId,
        action: PLATFORM_AUTH_EVENTS.passwordChanged,
        entityType: PLATFORM_USERS_ENTITY,
        entityId: userId,
        metadata: { revokedSessions: revoked.count },
        ctx,
      });
    });
  }
}
