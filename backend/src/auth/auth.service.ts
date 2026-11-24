import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isPendingSelfRegistration } from '../account/registration.rules.js';
import { AuditService } from '../audit/audit.service.js';
import type { Env } from '../config/env.schema.js';
import type { Prisma, User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { authError } from './auth.errors.js';
import { MFA_CHALLENGE_MAX_ATTEMPTS, MFA_CHALLENGE_PATTERN, MFA_CHALLENGE_TTL_MS, MfaCore } from './mfa/mfa-core.service.js';
import {
  afterWrongAttempt,
  challengeAttempts,
  challengeOutlivedPassword,
  pickMfaFactor,
} from './mfa-login.rules.js';
import type { PendingMfaSignIn } from './mfa-login.rules.js';
import { PasswordService, passwordProblems } from './password.service.js';
import type { AuthPrincipal, RequestContext } from './principal.js';
import type { AccessTokenClaims, GeneratedRefreshToken } from './token.service.js';
import { TokenService } from './token.service.js';

/** Access token plus the opaque refresh token that goes into the cookie. */
export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  /** Expiry of `refreshToken` — never past the family's deadline (MOD-01-H03); the cookie lives as long. */
  refreshExpiresAt: Date;
  user: AuthPrincipal;
}

/** A session opened by a one-time token instead of a password (invitation MOD-03-T03, password reset T05). */
export type TokenSessionOrigin = 'invitation' | 'password_reset' | 'google';

/**
 * How a session that did not start with the password alone was opened
 * (recorded as `via` in `auth.login.succeeded`): a one-time token, or the
 * second step of a two-step sign-in (MFA-T03 — a TOTP code or a recovery code).
 */
export type SessionOrigin = TokenSessionOrigin | 'mfa' | 'recovery_code';

/** What a sign-in answers: a session, or — for an account with MFA (D-R109) — the challenge of the second step. */
export type LoginOutcome = IssuedSession | PendingMfaSignIn;

type UserWithAccess = Prisma.UserGetPayload<{ include: typeof ACCESS_INCLUDE }>;
type Tx = Prisma.TransactionClient;

/** A refresh token generated for a session that is about to be written. */
interface PreparedSession {
  refresh: GeneratedRefreshToken;
  refreshExpiresAt: Date;
}

/** The outcome of the factor transaction of API-211: a written session, or an error to throw once the refusal's writes are committed. */
type MfaStepResult = { kind: 'session'; prepared: PreparedSession } | { kind: 'refused'; error: Error };

const ACCESS_INCLUDE = {
  roles: {
    include: {
      role: {
        include: { permissions: { include: { permission: { select: { deprecatedAt: true } } } } },
      },
    },
  },
} satisfies Prisma.UserInclude;

export const AUDIT_ACTIONS = {
  loginSucceeded: 'auth.login.succeeded',
  loginFailed: 'auth.login.failed',
  loginLocked: 'auth.login.locked',
  loginRejected: 'auth.login.rejected',
  refreshReuse: 'auth.refresh.reuse_detected',
  logout: 'auth.logout',
  logoutAll: 'auth.logout_all',
  passwordChanged: 'auth.password.changed',
  bootstrapAdmin: 'auth.bootstrap.admin_created',
} as const;

function normalizeIdentifier(raw: string): string {
  return raw.trim().toLowerCase();
}

function toPrincipal(user: UserWithAccess, tokenId: string): AuthPrincipal {
  const permissions = new Set<string>();
  for (const grant of user.roles) {
    for (const link of grant.role.permissions) {
      if (link.permission.deprecatedAt === null) permissions.add(link.permissionKey);
    }
  }
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    fullName: user.fullName,
    displayName: user.displayName,
    locale: user.locale,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    emailVerifiedAt: user.emailVerifiedAt,
    roles: user.roles.map((grant) => grant.role.key),
    permissions: [...permissions].sort(),
    tokenId,
  };
}

@Injectable()
export class AuthService {
  private readonly lockoutThreshold: number;
  private readonly lockoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly mfa: MfaCore,
    config: ConfigService<Env, true>,
  ) {
    this.lockoutThreshold = config.get('AUTH_LOCKOUT_THRESHOLD', { infer: true });
    this.lockoutMs = config.get('AUTH_LOCKOUT_MINUTES', { infer: true }) * 60 * 1000;
  }

  // ---------------------------------------------------------------- login

  /**
   * API-005. A session for an account without MFA; for an account with MFA
   * (D-R109) the password alone opens nothing — the answer is the challenge of
   * the second step (API-211), with no cookie and no event.
   */
  async login(identifierRaw: string, password: string, ctx: RequestContext): Promise<LoginOutcome> {
    const identifier = normalizeIdentifier(identifierRaw);
    const db = this.prisma.db;
    const user = await db.user.findFirst({
      where: identifier.includes('@') ? { email: identifier } : { username: identifier },
      include: ACCESS_INCLUDE,
    });

    // Unknown, archived or soft-deleted accounts look exactly like a wrong password — and so does a
    // self-registered account whose holder has not opened the e-mailed link yet (`pending` without a
    // password, PORTAL-03): anybody can register any address, so its existence is never revealed
    // (no `account_not_activated`, no event, the same dummy verification as an unknown address).
    if (!user || user.deletedAt !== null || user.status === 'archived' || isPendingSelfRegistration(user)) {
      await this.passwords.verifyDummy(password);
      throw authError.invalidCredentials();
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      await this.audit.record({ action: AUDIT_ACTIONS.loginLocked, actorUserId: user.id, entityType: 'users', entityId: user.id, ...ctx });
      throw authError.accountLocked(Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000));
    }

    if (!user.passwordHash) {
      await this.passwords.verifyDummy(password);
      await this.audit.record({ action: AUDIT_ACTIONS.loginRejected, actorUserId: user.id, entityType: 'users', entityId: user.id, metadata: { reason: 'not_activated' }, ...ctx });
      throw authError.accountNotActivated();
    }

    if (!(await this.passwords.verify(user.passwordHash, password))) {
      const { locked } = await this.registerFailedLogin(user, ctx);
      if (locked) throw authError.accountLocked(Math.ceil(this.lockoutMs / 1000));
      throw authError.invalidCredentials();
    }

    // Status is checked only after the password matched, so it is not revealed to guessers.
    if (user.status === 'pending') {
      await this.audit.record({ action: AUDIT_ACTIONS.loginRejected, actorUserId: user.id, entityType: 'users', entityId: user.id, metadata: { reason: 'pending' }, ...ctx });
      throw authError.accountPending();
    }
    if (user.status === 'suspended') {
      await this.audit.record({ action: AUDIT_ACTIONS.loginRejected, actorUserId: user.id, entityType: 'users', entityId: user.id, metadata: { reason: 'suspended' }, ...ctx });
      throw authError.accountSuspended();
    }
    if (user.status !== 'active') {
      await this.audit.record({ action: AUDIT_ACTIONS.loginRejected, actorUserId: user.id, entityType: 'users', entityId: user.id, metadata: { reason: user.status }, ...ctx });
      throw authError.accountNotActivated();
    }

    // D-R109: a correct password is only the first step for an account with MFA. The failed-login
    // counter is deliberately NOT reset here — else a holder of the password could clear it between
    // guesses of the code; the second step resets it when it opens the session.
    if (user.mfaSecret !== null) return this.issueMfaChallenge(user.id, user.mfaSecret, now);

    return this.createSession(user, now, ctx);
  }

  /**
   * API-211 — the second step of a two-step sign-in (D-R109): the challenge
   * from the password step plus exactly one factor, a TOTP code or a recovery
   * code. Checks in order: `400 mfa_factor_required`; `401
   * mfa_challenge_invalid` (malformed, unknown, used, expired, issued before
   * the last password change, the account deleted or archived, or MFA turned
   * off — that challenge is consumed); `423 account_locked` (records
   * `auth.login.locked`); the status gates; `503 mfa_unavailable`; then the
   * factor under the user-row lock. A wrong factor counts in the challenge
   * (consumed at its 5th) AND in the account's lockout — those writes are
   * committed before the 401/423 is thrown. A right one consumes the challenge
   * and opens the session in the same transaction.
   */
  async loginWithMfa(
    challengeRaw: string,
    input: { code?: string | null; recoveryCode?: string | null },
    ctx: RequestContext,
  ): Promise<IssuedSession> {
    const factor = pickMfaFactor(input);
    if (!factor) throw authError.mfaFactorRequired();
    if (typeof challengeRaw !== 'string' || !MFA_CHALLENGE_PATTERN.test(challengeRaw)) throw authError.mfaChallengeInvalid();

    const db = this.prisma.db;
    const now = new Date();
    const row = await db.verificationToken.findUnique({
      where: { tokenHash: this.mfa.hashChallenge(challengeRaw) },
      select: { id: true, purpose: true, expiresAt: true, consumedAt: true, user: { include: ACCESS_INCLUDE } },
    });
    if (!row || row.purpose !== 'mfa_challenge' || row.consumedAt !== null || row.expiresAt <= now) {
      throw authError.mfaChallengeInvalid();
    }
    const user = row.user;
    if (user.deletedAt !== null || user.status === 'archived') throw authError.mfaChallengeInvalid();
    if (challengeOutlivedPassword(row.expiresAt, user.passwordChangedAt, MFA_CHALLENGE_TTL_MS)) {
      throw authError.mfaChallengeInvalid();
    }
    if (user.mfaSecret === null) {
      // MFA was turned off after the password step: this challenge leads nowhere any more.
      await db.verificationToken.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: now } });
      throw authError.mfaChallengeInvalid();
    }
    if (user.lockedUntil && user.lockedUntil > now) {
      await this.audit.record({ action: AUDIT_ACTIONS.loginLocked, actorUserId: user.id, entityType: 'users', entityId: user.id, metadata: { stage: 'mfa' }, ...ctx });
      throw authError.accountLocked(Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000));
    }
    const gate = this.sessionGate(user);
    if (gate) throw gate;
    this.mfa.assertAvailable();

    const via: SessionOrigin = factor.kind === 'code' ? 'mfa' : 'recovery_code';
    const result = await db.$transaction(async (tx): Promise<MfaStepResult> => {
      // Every second step of this account runs one at a time from here on: the lock serialises the
      // replay guard, the recovery codes, the challenge's attempts and the lockout counter.
      const state = await this.mfa.lockUser(tx, user.id);
      const account = await tx.user.findUnique({
        where: { id: user.id },
        select: { failedLoginCount: true, lockedUntil: true, status: true, deletedAt: true, passwordChangedAt: true },
      });
      const challenge = await tx.verificationToken.findUnique({
        where: { id: row.id },
        select: { consumedAt: true, expiresAt: true, metadata: true },
      });
      // Re-checked under the lock: a parallel request may have used the challenge or changed the account meanwhile.
      if (!state || !account || !challenge || challenge.consumedAt !== null || challenge.expiresAt <= now) {
        throw authError.mfaChallengeInvalid();
      }
      if (account.deletedAt !== null || account.status === 'archived') throw authError.mfaChallengeInvalid();
      if (challengeOutlivedPassword(challenge.expiresAt, account.passwordChangedAt, MFA_CHALLENGE_TTL_MS)) {
        throw authError.mfaChallengeInvalid();
      }
      if (state.mfaSecret === null) {
        await this.mfa.retireChallenges(tx, user.id, now);
        return { kind: 'refused', error: authError.mfaChallengeInvalid() };
      }
      if (account.lockedUntil && account.lockedUntil > now) {
        await this.audit.record({ action: AUDIT_ACTIONS.loginLocked, actorUserId: user.id, entityType: 'users', entityId: user.id, metadata: { stage: 'mfa' }, ...ctx }, tx);
        return { kind: 'refused', error: authError.accountLocked(Math.ceil((account.lockedUntil.getTime() - now.getTime()) / 1000)) };
      }
      const accountGate = this.sessionGate(account);
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
        // limit) and one more failure on the account, through the same lockout as the password.
        const next = afterWrongAttempt(challengeAttempts(challenge.metadata, MFA_CHALLENGE_MAX_ATTEMPTS), MFA_CHALLENGE_MAX_ATTEMPTS);
        await tx.verificationToken.update({
          where: { id: row.id },
          data: { metadata: { attempts: next.attempts }, ...(next.exhausted ? { consumedAt: now } : {}) },
        });
        const { locked } = await this.registerFailedLogin({ id: user.id, failedLoginCount: account.failedLoginCount }, ctx, { tx, stage: 'mfa' });
        return {
          kind: 'refused',
          error: locked ? authError.accountLocked(Math.ceil(this.lockoutMs / 1000)) : authError.mfaCodeInvalid(HttpStatus.UNAUTHORIZED),
        };
      }

      // Of two simultaneous right answers only one consumes the challenge (and so gets a session).
      const consumed = await tx.verificationToken.updateMany({
        where: { id: row.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw authError.mfaChallengeInvalid();
      const prepared = this.prepareSession(now);
      await this.writeSession(
        tx,
        user.id,
        prepared,
        now,
        ctx,
        via === 'recovery_code' ? { via, recoveryCodesLeft } : { via },
      );
      return { kind: 'session', prepared };
    });

    if (result.kind === 'refused') throw result.error;
    return this.signSession(user, result.prepared);
  }

  /**
   * Opens a session for an account whose holder has just proved themself with
   * a one-time token — invitation acceptance (MOD-03-T03) or password reset
   * (T05) — so there is no password to check here. The account must be usable
   * (same gate as refresh); the login event records how the session started.
   * An account with MFA never gets a session this way (D-R109): a reset goes
   * through `beginSession()`, and an invited account cannot have MFA yet.
   */
  async openSession(userId: string, via: TokenSessionOrigin, ctx: RequestContext): Promise<IssuedSession> {
    const user = await this.prisma.db.user.findUnique({ where: { id: userId }, include: ACCESS_INCLUDE });
    if (!user) throw authError.sessionInvalid();
    const gate = this.sessionGate(user);
    if (gate) throw gate;
    if (user.mfaSecret !== null) throw authError.sessionInvalid();
    return this.createSession(user, new Date(), ctx, via);
  }

  /**
   * Like `openSession()` after a confirmed password reset (API-020), but for an
   * account with MFA it answers the sign-in challenge instead of a session
   * (D-R109): the reset is done, the second factor is still required.
   */
  async beginSession(userId: string, via: TokenSessionOrigin, ctx: RequestContext): Promise<LoginOutcome> {
    const user = await this.prisma.db.user.findUnique({ where: { id: userId }, include: ACCESS_INCLUDE });
    if (!user) throw authError.sessionInvalid();
    const gate = this.sessionGate(user);
    if (gate) throw gate;
    const now = new Date();
    if (user.mfaSecret !== null) return this.issueMfaChallenge(user.id, user.mfaSecret, now);
    return this.createSession(user, now, ctx, via);
  }

  /**
   * The challenge of the second step (no event). Without the server key — or
   * when the account's secret does not open with it — `503 mfa_unavailable`:
   * never a session without the second factor (D-R107), and never a challenge
   * that no code could answer.
   */
  private async issueMfaChallenge(userId: string, sealedSecret: string, now: Date): Promise<PendingMfaSignIn> {
    this.mfa.assertAvailable();
    this.mfa.open(userId, sealedSecret);
    const issued = await this.mfa.issueChallenge(this.prisma.db, userId, now);
    return { mfaRequired: true, challenge: issued.challenge, expiresAt: issued.expiresAt };
  }

  /** Resets the lock counters, opens a refresh-token family, records `auth.login.succeeded` and signs the access token. */
  private async createSession(user: UserWithAccess, now: Date, ctx: RequestContext, via?: SessionOrigin): Promise<IssuedSession> {
    const prepared = this.prepareSession(now);
    await this.prisma.db.$transaction((tx) => this.writeSession(tx, user.id, prepared, now, ctx, via ? { via } : {}));
    return this.signSession(user, prepared);
  }

  /** A fresh refresh token; a new family starts now and AUTH_REFRESH_FAMILY_MAX_DAYS ≥ AUTH_REFRESH_TTL_DAYS, so it gets its full lifetime. */
  private prepareSession(now: Date): PreparedSession {
    return { refresh: this.tokens.generateRefreshToken(), refreshExpiresAt: this.tokens.refreshExpiry(now) };
  }

  /**
   * The writes of a new session inside the caller's transaction: lock counters
   * reset, `last_login_at`, the first refresh token of a new family, and
   * `auth.login.succeeded { familyId, ...details }`.
   */
  private async writeSession(
    tx: Tx,
    userId: string,
    prepared: PreparedSession,
    now: Date,
    ctx: RequestContext,
    details: { via?: SessionOrigin; recoveryCodesLeft?: number | null },
  ): Promise<void> {
    await tx.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
    const created = await tx.refreshToken.create({
      data: {
        userId,
        tokenHash: prepared.refresh.hash,
        expiresAt: prepared.refreshExpiresAt,
        userAgent: ctx.userAgent,
        ipAddress: ctx.ip,
      },
      select: { familyId: true },
    });
    await this.audit.record(
      {
        action: AUDIT_ACTIONS.loginSucceeded,
        actorUserId: userId,
        entityType: 'users',
        entityId: userId,
        metadata: { familyId: created.familyId, ...details },
        ...ctx,
      },
      tx,
    );
  }

  /** Signs the access token of a session whose writes are committed. */
  private async signSession(user: UserWithAccess, prepared: PreparedSession): Promise<IssuedSession> {
    const access = await this.tokens.signAccessToken({ userId: user.id, roles: user.roles.map((g) => g.role.key) });
    const claims = await this.tokens.verifyAccessToken(access.token);
    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: prepared.refresh.token,
      refreshExpiresAt: prepared.refreshExpiresAt,
      user: toPrincipal(user, claims.jti),
    };
  }

  /**
   * Counts a failed attempt — the one place that does, for the password step
   * and the MFA step alike; the attempt that reaches the threshold locks the
   * account. The password step's event metadata is `{ failedAttempts, locked }`;
   * the MFA step adds `stage: 'mfa'` and passes its own transaction (it holds
   * the user-row lock, so `failedLoginCount` is current).
   */
  private async registerFailedLogin(
    user: Pick<User, 'id' | 'failedLoginCount'>,
    ctx: RequestContext,
    options: { tx?: Tx; stage?: 'mfa' } = {},
  ): Promise<{ locked: boolean }> {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= this.lockoutThreshold;
    const write = async (tx: Tx): Promise<void> => {
      await tx.user.update({
        where: { id: user.id },
        data: lock
          ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + this.lockoutMs) }
          : { failedLoginCount: failed },
      });
      await this.audit.record(
        {
          action: lock ? AUDIT_ACTIONS.loginLocked : AUDIT_ACTIONS.loginFailed,
          actorUserId: user.id,
          entityType: 'users',
          entityId: user.id,
          metadata: options.stage ? { stage: options.stage, failedAttempts: failed, locked: lock } : { failedAttempts: failed, locked: lock },
          ...ctx,
        },
        tx,
      );
    };
    if (options.tx) await write(options.tx);
    else await this.prisma.db.$transaction(write);
    return { locked: lock };
  }

  // -------------------------------------------------------------- refresh

  /** Rotates the refresh token; a replayed (already rotated or revoked) token revokes its whole family. */
  async refresh(refreshToken: string, ctx: RequestContext): Promise<IssuedSession> {
    const db = this.prisma.db;
    const now = new Date();
    const stored = await db.refreshToken.findUnique({
      where: { tokenHash: this.tokens.hashRefreshToken(refreshToken) },
      include: { user: { include: ACCESS_INCLUDE } },
    });
    if (!stored) throw authError.refreshInvalid();

    if (stored.revokedAt !== null || stored.replacedById !== null) {
      // Reuse of a rotated token: someone else holds a copy. Kill the family.
      await db.$transaction(async (tx) => {
        const revoked = await tx.refreshToken.updateMany({
          where: { familyId: stored.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
        // KI-098 follow-up: a family that revoked live tokens now (the theft signal) is recorded every time.
        // A family that was already dead is recorded only while it has no reuse event yet — the first replay
        // after a deliberate revocation (logout-all, MFA enable, a password change…) stays visible, but
        // replaying its rotated tokens in a loop cannot write one append-only row per request (each cookie
        // has its own refresh budget since D-R140, so only the 1200/min per-IP ceiling would bound it).
        // The lookup is served by the (entity_type, entity_id) index of audit_logs. Two replays racing on a
        // dead family may both record — accepted. The platform records only when live tokens were revoked
        // (platform-session.service.ts); the academy keeps that first sign of reuse.
        if (revoked.count === 0) {
          const recorded = await tx.auditLog.findFirst({
            where: {
              action: AUDIT_ACTIONS.refreshReuse,
              entityType: 'users',
              entityId: stored.userId,
              metadata: { path: ['familyId'], equals: stored.familyId },
            },
            select: { id: true },
          });
          if (recorded) return;
        }
        await this.audit.record(
          { action: AUDIT_ACTIONS.refreshReuse, actorUserId: stored.userId, entityType: 'users', entityId: stored.userId, metadata: { familyId: stored.familyId }, ...ctx },
          tx,
        );
      });
      throw authError.refreshReused();
    }

    // MOD-01-H03: past the family's absolute deadline the session ends even if this token is still valid
    // (tokens issued before the cap, or a lowered AUTH_REFRESH_FAMILY_MAX_DAYS). A family id that is not a
    // UUIDv7 has no known start and is treated as expired.
    const deadline = this.tokens.familyDeadline(stored.familyId);
    if (stored.expiresAt <= now || deadline === null || deadline <= now) {
      await db.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: now } });
      throw authError.refreshExpired();
    }

    const user = stored.user;
    const usable = this.sessionGate(user);
    if (usable) {
      await db.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: now } });
      throw usable;
    }

    const next = this.tokens.generateRefreshToken();
    const refreshExpiresAt = this.tokens.refreshExpiry(now, deadline);
    await db.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({
        data: {
          userId: user.id,
          familyId: stored.familyId,
          tokenHash: next.hash,
          expiresAt: refreshExpiresAt,
          userAgent: ctx.userAgent,
          ipAddress: ctx.ip,
        },
        select: { id: true },
      });
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: now, replacedById: created.id },
      });
    });

    const access = await this.tokens.signAccessToken({ userId: user.id, roles: user.roles.map((g) => g.role.key) });
    const claims = await this.tokens.verifyAccessToken(access.token);
    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: next.token,
      refreshExpiresAt,
      user: toPrincipal(user, claims.jti),
    };
  }

  // -------------------------------------------------------------- logout

  /** Revokes the session behind a refresh token (no error when it is unknown). */
  async logout(refreshToken: string | undefined, ctx: RequestContext): Promise<void> {
    if (!refreshToken) return;
    const db = this.prisma.db;
    const stored = await db.refreshToken.findUnique({
      where: { tokenHash: this.tokens.hashRefreshToken(refreshToken) },
      select: { id: true, userId: true, familyId: true, revokedAt: true },
    });
    if (!stored) return;
    await db.$transaction(async (tx) => {
      await tx.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        { action: AUDIT_ACTIONS.logout, actorUserId: stored.userId, entityType: 'users', entityId: stored.userId, metadata: { familyId: stored.familyId }, ...ctx },
        tx,
      );
    });
  }

  /** Revokes every refresh token of the user (all devices). */
  async logoutAll(userId: string, ctx: RequestContext): Promise<number> {
    let revoked = 0;
    await this.prisma.db.$transaction(async (tx) => {
      const result = await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      revoked = result.count;
      await this.audit.record(
        { action: AUDIT_ACTIONS.logoutAll, actorUserId: userId, entityType: 'users', entityId: userId, metadata: { revokedSessions: revoked }, ...ctx },
        tx,
      );
    });
    return revoked;
  }

  // ------------------------------------------------------------ password

  /** Changes the caller's password and revokes every other session; the current cookie family survives. */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    currentRefreshToken: string | undefined,
    ctx: RequestContext,
  ): Promise<void> {
    const db = this.prisma.db;
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash || !(await this.passwords.verify(user.passwordHash, currentPassword))) {
      await this.passwords.verifyDummy(currentPassword);
      throw authError.passwordInvalid();
    }
    const problems = passwordProblems(newPassword);
    if (newPassword === currentPassword) problems.push('different from the current password');
    if (problems.length > 0) throw authError.passwordWeak(problems);

    const keepFamily = currentRefreshToken
      ? (await db.refreshToken.findUnique({
          where: { tokenHash: this.tokens.hashRefreshToken(currentRefreshToken) },
          select: { familyId: true, userId: true },
        }))
      : null;
    const passwordHash = await this.passwords.hash(newPassword);
    const now = new Date();
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, passwordChangedAt: now, mustChangePassword: false },
      });
      const result = await tx.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
          ...(keepFamily && keepFamily.userId === userId ? { familyId: { not: keepFamily.familyId } } : {}),
        },
        data: { revokedAt: now },
      });
      await this.audit.record(
        { action: AUDIT_ACTIONS.passwordChanged, actorUserId: userId, entityType: 'users', entityId: userId, metadata: { revokedOtherSessions: result.count }, ...ctx },
        tx,
      );
    });
  }

  // ----------------------------------------------------------- principal

  /** Resolves the caller of a verified access token; rejects sessions of unusable accounts. */
  async principalFor(claims: AccessTokenClaims): Promise<AuthPrincipal> {
    const user = await this.prisma.db.user.findUnique({ where: { id: claims.sub }, include: ACCESS_INCLUDE });
    if (!user) throw authError.sessionInvalid();
    const gate = this.sessionGate(user);
    if (gate) throw gate;
    // Tokens issued in a second before the last password change are dead
    // (`iat` has second precision, so same-second tokens are kept).
    if (user.passwordChangedAt && claims.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
      throw authError.tokenInvalid();
    }
    return toPrincipal(user, claims.jti);
  }

  /** Why an existing session may not continue, or null when the account is usable. */
  private sessionGate(user: Pick<User, 'deletedAt' | 'status' | 'lockedUntil'>): Error | null {
    if (user.deletedAt !== null || user.status === 'archived') return authError.sessionInvalid();
    if (user.status === 'suspended') return authError.accountSuspended();
    if (user.status === 'pending') return authError.accountPending();
    if (user.status !== 'active') return authError.accountNotActivated();
    return null;
  }
}
