import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { authError } from './auth.errors.js';
import { PERMISSIONS_KEY } from './decorators.js';
import type { AuthenticatedRequest } from './principal.js';

/**
 * Global guard (runs after AuthGuard): routes decorated with
 * @RequirePermissions(...) need every listed key in the principal's permission
 * set (ADR-023). Routes without the decorator only need authentication.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) throw authError.unauthenticated();

    const missing = required.filter((key) => !user.permissions.includes(key));
    if (missing.length > 0) throw authError.permissionDenied(missing);
    return true;
  }
}
