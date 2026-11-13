// TEST-207 (unit) — MOD-18-T02 PlatformRolesGuard and the session gate.
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import type { PlatformRole } from '../../generated/platform/client.js';
import { PlatformHttpException } from '../platform.errors.js';
import { PlatformRoles } from './platform.decorators.js';
import { issuedBeforePasswordChange, platformSessionGate } from './platform-principal.service.js';
import type { PlatformPrincipal } from './platform-principal.js';
import { PlatformRolesGuard, platformRoleAllows } from './platform-roles.guard.js';

class Routes {
  @PlatformRoles('super_admin')
  write(): void {}

  @PlatformRoles('support')
  supportOnly(): void {}

  open(): void {}
}

function contextFor(handler: keyof Routes, platformUser?: Partial<PlatformPrincipal>): ExecutionContext {
  return {
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => ({ platformUser }) }),
  } as unknown as ExecutionContext;
}

function caught(fn: () => unknown): PlatformHttpException | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    if (error instanceof PlatformHttpException) return error;
    throw error;
  }
}

describe('platformRoleAllows', () => {
  it('lets super_admin pass every role check and a role pass its own', () => {
    const cases: [PlatformRole, PlatformRole[], boolean][] = [
      ['super_admin', ['super_admin'], true],
      ['super_admin', ['support'], true],
      ['support', ['support'], true],
      ['support', ['super_admin'], false],
      ['support', [], true],
    ];
    for (const [role, required, allowed] of cases) expect(platformRoleAllows(role, required)).toBe(allowed);
  });
});

describe('PlatformRolesGuard', () => {
  const guard = new PlatformRolesGuard(new Reflector());

  it('passes a route without @PlatformRoles for any caller (authentication is PlatformAuthGuard’s job)', () => {
    expect(guard.canActivate(contextFor('open'))).toBe(true);
    expect(guard.canActivate(contextFor('open', { role: 'support' }))).toBe(true);
  });

  it('refuses support on a super_admin route with 403 role_forbidden { required }', () => {
    const error = caught(() => guard.canActivate(contextFor('write', { role: 'support' })));
    expect(error?.getStatus()).toBe(403);
    expect(error?.getResponse()).toMatchObject({ code: 'role_forbidden', required: ['super_admin'] });
  });

  it('lets super_admin through a support-only route and support through its own', () => {
    expect(guard.canActivate(contextFor('write', { role: 'super_admin' }))).toBe(true);
    expect(guard.canActivate(contextFor('supportOnly', { role: 'super_admin' }))).toBe(true);
    expect(guard.canActivate(contextFor('supportOnly', { role: 'support' }))).toBe(true);
  });

  it('answers 401 unauthenticated on a role route without a principal', () => {
    const error = caught(() => guard.canActivate(contextFor('write')));
    expect(error?.getStatus()).toBe(401);
    expect(error?.code).toBe('unauthenticated');
  });
});

describe('platformSessionGate / issuedBeforePasswordChange', () => {
  it('accepts an active account — also while a sign-in lock is running (a lock blocks new sign-ins only, T03)', () => {
    expect(platformSessionGate({ status: 'active' })).toBeNull();
    const lockedRow = { status: 'active' as const, lockedUntil: new Date(Date.now() + 10 * 60_000) };
    expect(platformSessionGate(lockedRow)).toBeNull();
  });

  it('refuses a suspended account with 403 account_suspended', () => {
    const refused = platformSessionGate({ status: 'suspended' });
    expect(refused?.getStatus()).toBe(403);
    expect(refused?.getResponse()).toMatchObject({ statusCode: 403, code: 'account_suspended' });
  });

  it('kills tokens issued in a second before the last password change, keeps same-second ones', () => {
    const changed = new Date('2026-11-13T10:00:00.700Z');
    const second = Math.floor(changed.getTime() / 1000);
    expect(issuedBeforePasswordChange(second - 1, changed)).toBe(true);
    expect(issuedBeforePasswordChange(second, changed)).toBe(false);
    expect(issuedBeforePasswordChange(second - 1, null)).toBe(false);
  });
});
