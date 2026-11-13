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
  passwordChangedAt: true,
} as const;

export type PlatformPrincipalRow = Pick<
  PlatformUser,
  'id' | 'email' | 'fullName' | 'role' | 'status' | 'passwordChangedAt'
>;

/**
 * Why a platform account may not use (or keep) a session right now, or null:
 * `403 account_suspended` for an account that is not active. Pure.
 *
 * A temporary lock (`locked_until`, set by failed sign-ins) is NOT checked
 * here: it blocks NEW sign-ins only (`423 account_locked` from POST
 * /api/auth/login — MOD-18-T03, platform-session.service.ts) and never ends an
 * existing session or a refresh — the academy rule (AuthService.sessionGate()),
 * otherwise anyone guessing a password could lock a signed-in super admin out.
 */
export function platformSessionGate(user: Pick<PlatformUser, 'status'>): PlatformHttpException | null {
  if (user.status !== 'active') return platformAuthError.accountSuspended();
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
   * suspended one (a temporary lock does not end a session), `401 token_invalid` for a token issued before the
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
