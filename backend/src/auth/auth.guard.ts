import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { authError } from './auth.errors.js';
import { AuthService } from './auth.service.js';
import { bearerToken } from './cookies.js';
import { IS_PUBLIC_KEY } from './decorators.js';
import type { AuthenticatedRequest } from './principal.js';
import { TokenService } from './token.service.js';

/**
 * Global guard (APP_GUARD): every route needs a valid Bearer access token
 * unless marked with @Public(). The principal (roles + permissions) is read
 * from the database on each request, so suspensions and role changes apply
 * immediately. On public routes a token, if present, is resolved best-effort.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request);

    if (!token) {
      if (isPublic) return true;
      throw authError.unauthenticated();
    }

    try {
      const claims = await this.tokens.verifyAccessToken(token);
      request.user = await this.auth.principalFor(claims);
      return true;
    } catch (error) {
      if (isPublic) return true;
      throw error;
    }
  }
}
