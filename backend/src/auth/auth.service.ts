import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service.js';
import type { Env } from '../config/env.schema.js';
import type { Prisma, User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { authError } from './auth.errors.js';
import { PasswordService, passwordProblems } from './password.service.js';
import type { AuthPrincipal, RequestContext } from './principal.js';
import type { AccessTokenClaims } from './token.service.js';
import { TokenService } from './token.service.js';

/** Access token plus the opaque refresh token that goes into the cookie. */
export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  user: AuthPrincipal;
}

type UserWithAccess = Prisma.UserGetPayload<{ include: typeof ACCESS_INCLUDE }>;

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
    config: ConfigService<Env, true>,
  ) {
    this.lockoutThreshold = config.get('AUTH_LOCKOUT_THRESHOLD', { infer: true });
    this.lockoutMs = config.get('AUTH_LOCKOUT_MINUTES', { infer: true }) * 60 * 1000;
  }

  // ---------------------------------------------------------------- login

  async login(identifierRaw: string, password: string, ctx: RequestContext): Promise<IssuedSession> {
    const identifier = normalizeIdentifier(identifierRaw);
    const db = this.prisma.db;
    const user = await db.user.findFirst({
      where: identifier.includes('@') ? { email: identifier } : { username: identifier },
      include: ACCESS_INCLUDE,
    });

    // Unknown, archived or soft-deleted accounts look exactly like a wrong password.
    if (!user || user.deletedAt !== null || user.status === 'archived') {
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

    const refresh = this.tokens.generateRefreshToken();
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
      });
      const created = await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: refresh.hash,
          expiresAt: this.tokens.refreshExpiry(now),
          userAgent: ctx.userAgent,
          ipAddress: ctx.ip,
        },
        select: { familyId: true },
      });
      await this.audit.record(
        { action: AUDIT_ACTIONS.loginSucceeded, actorUserId: user.id, entityType: 'users', entityId: user.id, metadata: { familyId: created.familyId }, ...ctx },
        tx,
      );
    });

    const access = await this.tokens.signAccessToken({ userId: user.id, roles: user.roles.map((g) => g.role.key) });
    const claims = await this.tokens.verifyAccessToken(access.token);
    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: refresh.token,
      user: toPrincipal(user, claims.jti),
    };
  }

  /** Counts a failed attempt; the attempt that reaches the threshold locks the account. */
  private async registerFailedLogin(user: User, ctx: RequestContext): Promise<{ locked: boolean }> {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= this.lockoutThreshold;
    await this.prisma.db.$transaction(async (tx) => {
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
          metadata: { failedAttempts: failed, locked: lock },
          ...ctx,
        },
        tx,
      );
    });
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
        await tx.refreshToken.updateMany({
          where: { familyId: stored.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
        await this.audit.record(
          { action: AUDIT_ACTIONS.refreshReuse, actorUserId: stored.userId, entityType: 'users', entityId: stored.userId, metadata: { familyId: stored.familyId }, ...ctx },
          tx,
        );
      });
      throw authError.refreshReused();
    }

    if (stored.expiresAt <= now) {
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
    await db.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({
        data: {
          userId: user.id,
          familyId: stored.familyId,
          tokenHash: next.hash,
          expiresAt: this.tokens.refreshExpiry(now),
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
    return { accessToken: access.token, expiresIn: access.expiresIn, refreshToken: next.token, user: toPrincipal(user, claims.jti) };
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
