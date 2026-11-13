import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformRole } from '../../generated/platform/client.js';
import { platformAuthError } from '../platform.errors.js';
import { PLATFORM_ROLES_KEY } from './platform.decorators.js';
import type { PlatformAuthenticatedRequest } from './platform-principal.js';

/** `super_admin` holds every platform role (D-R100). */
export const SUPER_ADMIN_ROLE: PlatformRole = 'super_admin';

/** Pure decision of PlatformRolesGuard: may `role` pass a route that requires one of `required`? */
export function platformRoleAllows(role: PlatformRole, required: readonly PlatformRole[]): boolean {
  return required.length === 0 || role === SUPER_ADMIN_ROLE || required.includes(role);
}

/**
 * Global guard of the platform app (runs after PlatformAuthGuard): a route
 * decorated with @PlatformRoles(...) needs one of the listed roles —
 * `super_admin` passes every check — else `403 role_forbidden { required }`.
 * A route without the decorator only needs a signed-in platform user (or none,
 * when @Public()).
 */
@Injectable()
export class PlatformRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PlatformRole[] | undefined>(PLATFORM_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { platformUser } = context.switchToHttp().getRequest<PlatformAuthenticatedRequest>();
    if (!platformUser) throw platformAuthError.unauthenticated();
    if (!platformRoleAllows(platformUser.role, required)) throw platformAuthError.roleForbidden(required);
    return true;
  }
}
