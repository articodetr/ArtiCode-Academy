import { Injectable } from '@nestjs/common';
import type { PlatformUser } from '../../generated/platform/client.js';
import { platformAuthError } from '../platform.errors.js';
import type { PlatformHttpException } from '../platform.errors.js';
import { PlatformPrismaService } from '../prisma/platform-prisma.service.js';
import type { PlatformPrincipal } from './platform-principal.js';
import type { PlatformAccessTokenClaims } from './platform-token.service.js';

/** The columns a principal and its gate need (never the password hash). */
export const PLATFORM_PRINCIPAL_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  status: true,
  lockedUntil: true,
  passwordChangedAt: true,
} as const;

export type PlatformPrincipalRow = Pick<
  PlatformUser,
  'id' | 'email' | 'fullName' | 'role' | 'status' | 'lockedUntil' | 'passwordChangedAt'
>;

/**
 * Why a platform account may not use (or open) a session right now, or null:
 * `403 account_suspended` for a suspended account, `423 account_locked
 * { retryAfterSeconds }` while `locked_until` is in the future. Pure.
 */
export function platformSessionGate(
  user: Pick<PlatformUser, 'status' | 'lockedUntil'>,
  now: Date = new Date(),
): PlatformHttpException | null {
  if (user.status !== 'active') return platformAuthError.accountSuspended();
  if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
    return platformAuthError.accountLocked(Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000));
  }
  return null;
}

/**
 * True when the token was issued before the last password change: such tokens
 * are dead (`iat` has second precision, so same-second tokens are kept — the
 * academy rule of AuthService.principalFor()).
 */
export function issuedBeforePasswordChange(iat: number, passwordChangedAt: Date | null): boolean {
  return passwordChangedAt !== null && iat < Math.floor(passwordChangedAt.getTime() / 1000);
}

export function toPlatformPrincipal(user: Pick<PlatformUser, 'id' | 'email' | 'fullName' | 'role'>, tokenId: string): PlatformPrincipal {
  return { id: user.id, email: user.email, fullName: user.fullName, role: user.role, tokenId };
}

/** Resolves a verified token to the CURRENT state of its platform user. */
@Injectable()
export class PlatformPrincipalService {
  constructor(private readonly prisma: PlatformPrismaService) {}

  /**
   * `401 session_invalid` for an unknown user, the gate's error for a
   * suspended or locked one, `401 token_invalid` for a token issued before the
   * last password change; otherwise the principal (role read from the row,
   * not from the token).
   */
  async principalFor(claims: PlatformAccessTokenClaims): Promise<PlatformPrincipal> {
    const user = await this.prisma.db.platformUser.findUnique({
      where: { id: claims.sub },
      select: PLATFORM_PRINCIPAL_SELECT,
    });
    if (!user) throw platformAuthError.sessionInvalid();
    const gate = platformSessionGate(user);
    if (gate) throw gate;
    if (issuedBeforePasswordChange(claims.iat, user.passwordChangedAt)) throw platformAuthError.tokenInvalid();
    return toPlatformPrincipal(user, claims.jti);
  }
}
