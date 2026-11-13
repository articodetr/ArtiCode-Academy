import { createParamDecorator, SetMetadata } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { PlatformRole } from '../../generated/platform/client.js';
import type { PlatformAuthenticatedRequest, PlatformPrincipal } from './platform-principal.js';

// Routes reachable without a platform token use the SAME @Public() as the
// academy API (src/auth/decorators.ts) — re-exported for convenience.
export { Public } from '../../auth/decorators.js';

export const PLATFORM_ROLES_KEY = 'platform:roles';

/**
 * The caller's platform role must be one of `roles`; `super_admin` passes
 * every role check. Without the decorator any signed-in platform user passes.
 */
export const PlatformRoles = (...roles: PlatformRole[]) => SetMetadata(PLATFORM_ROLES_KEY, roles);

/** Injects the platform principal set by PlatformAuthGuard (undefined on a public route without a token). */
export const CurrentPlatformUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PlatformPrincipal | undefined =>
    context.switchToHttp().getRequest<PlatformAuthenticatedRequest>().platformUser,
);
