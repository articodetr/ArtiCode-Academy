import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { bearerToken } from '../../auth/cookies.js';
import { IS_PUBLIC_KEY } from '../../auth/decorators.js';
import { platformAuthError } from '../platform.errors.js';
import { PlatformPrincipalService } from './platform-principal.service.js';
import type { PlatformAuthenticatedRequest } from './platform-principal.js';
import { PlatformTokenService } from './platform-token.service.js';

/**
 * Global guard of the platform app (APP_GUARD, after OriginGuard): every route
 * needs a valid platform Bearer token unless marked with the shared @Public().
 * The token is verified with the PLATFORM secret, issuer and audience (an
 * academy token is `401 token_invalid`), then the user's row is read on every
 * request (PlatformPrincipalService), so a suspension or a password change
 * applies at once (a temporary sign-in lock does not end a session — T03).
 * The principal goes to `request.platformUser`. On a
 * public route a token, if present, is resolved best-effort.
 */
@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: PlatformTokenService,
    private readonly principals: PlatformPrincipalService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<PlatformAuthenticatedRequest>();
    const token = bearerToken(request);

    if (!token) {
      if (isPublic) return true;
      throw platformAuthError.unauthenticated();
    }

    try {
      const claims = await this.tokens.verifyAccessToken(token);
      request.platformUser = await this.principals.principalFor(claims);
      return true;
    } catch (error) {
      if (isPublic) return true;
      throw error;
    }
  }
}
