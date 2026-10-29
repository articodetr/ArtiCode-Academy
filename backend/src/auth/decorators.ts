import { createParamDecorator, SetMetadata } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { AuthPrincipal, AuthenticatedRequest } from './principal.js';

export const IS_PUBLIC_KEY = 'auth:public';
export const PERMISSIONS_KEY = 'auth:permissions';

/** Marks a route (or controller) as reachable without an access token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Every listed permission key must be held by the caller (ADR-023). */
export const RequirePermissions = (...keys: string[]) => SetMetadata(PERMISSIONS_KEY, keys);

/** Injects the authenticated principal set by AuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPrincipal | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
