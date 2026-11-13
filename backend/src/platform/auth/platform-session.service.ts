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
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PasswordService } from '../../auth/password.service.js';
import type { RequestContext } from '../../auth/principal.js';
import type { PlatformRole, PlatformUserStatus } from '../../generated/platform/client.js';
import { PlatformAuditService } from '../audit/platform-audit.service.js';
import type { PlatformEnv } from '../platform.env.schema.js';
import { platformAuthError } from '../platform.errors.js';
import { PlatformPrismaService } from '../prisma/platform-prisma.service.js';
import type { IssuedPlatformSession } from './platform-cookies.js';
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

/** What a sign-in reads: the public columns plus the hash and the lock state. */
const LOGIN_SELECT = {
  ...PLATFORM_USER_SELECT,
  passwordHash: true,
  lockedUntil: true,
} as const;

interface PublicUserRow {
  id: string;
  email: string;
  fullName: string;
  role: PlatformRole;
  status: PlatformUserStatus;
}

/** Why a sign-in of a KNOWN account was refused (`platform.auth.login.failed { reason }`). */
export type PlatformLoginFailure = 'invalid_password' | 'locked' | 'no_password' | 'suspended';

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
   */
  async login(identifierRaw: string, password: string, ctx: RequestContext): Promise<IssuedPlatformSession> {
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

    return this.openSession(user, now, ctx);
  }

  /** Clears the lock counters, opens a refresh-token family and records `platform.auth.login.succeeded`. */
  private async openSession(user: PublicUserRow, now: Date, ctx: RequestContext): Promise<IssuedPlatformSession> {
    const refresh = this.tokens.newRefreshToken();
    // A new family starts now; PLATFORM_REFRESH_FAMILY_MAX_DAYS ≥ PLATFORM_REFRESH_TTL_DAYS, so the first token gets its full lifetime.
    const refreshExpiresAt = this.tokens.refreshExpiry(now);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.platformUser.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
      });
      const created = await tx.platformRefreshToken.create({
        data: {
          userId: user.id,
          tokenHash: refresh.hash,
          expiresAt: refreshExpiresAt,
          userAgent: ctx.userAgent,
          ipAddress: ctx.ip,
        },
        select: { familyId: true },
      });
      await this.audit.record(tx, {
        actorId: user.id,
        action: PLATFORM_AUTH_EVENTS.loginSucceeded,
        entityType: PLATFORM_USERS_ENTITY,
        entityId: user.id,
        metadata: { via: 'password', familyId: created.familyId },
        ctx,
      });
    });
    const access = await this.tokens.signAccessToken({ userId: user.id, role: user.role });
    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: refresh.token,
      refreshExpiresAt,
      user: toPlatformUserDto(user),
    };
  }

  /**
   * Counts a failed password atomically (concurrent guesses never lose an
   * increment); the attempt that reaches the threshold locks the account for
   * PLATFORM_LOCKOUT_MINUTES and restarts the counter. One event, in the same
   * transaction.
   */
  private async registerFailedLogin(userId: string, ctx: RequestContext): Promise<{ locked: boolean }> {
    return this.prisma.db.$transaction(async (tx) => {
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
        metadata: { reason: 'invalid_password' satisfies PlatformLoginFailure, failedAttempts: failedLoginCount, locked },
        ctx,
      });
      return { locked };
    });
  }

  /** A refused sign-in of a known account that changes nothing (locked, no password, suspended). */
  private async recordRefusedLogin(userId: string, reason: PlatformLoginFailure, ctx: RequestContext): Promise<void> {
    await this.audit.record(null, {
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
