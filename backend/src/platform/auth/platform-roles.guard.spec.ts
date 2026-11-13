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
  const now = new Date('2026-11-13T10:00:00Z');

  it('accepts an active, unlocked account and one whose lock has passed', () => {
    expect(platformSessionGate({ status: 'active', lockedUntil: null }, now)).toBeNull();
    expect(platformSessionGate({ status: 'active', lockedUntil: new Date('2026-11-13T09:59:59Z') }, now)).toBeNull();
  });

  it('refuses a suspended account (403) and a locked one (423 with retryAfterSeconds)', () => {
    expect(platformSessionGate({ status: 'suspended', lockedUntil: null }, now)?.getResponse()).toMatchObject({
      statusCode: 403,
      code: 'account_suspended',
    });
    const locked = platformSessionGate({ status: 'active', lockedUntil: new Date('2026-11-13T10:01:30.200Z') }, now);
    expect(locked?.getStatus()).toBe(423);
    expect(locked?.getResponse()).toMatchObject({ code: 'account_locked', retryAfterSeconds: 91 });
  });

  it('kills tokens issued in a second before the last password change, keeps same-second ones', () => {
    const changed = new Date('2026-11-13T10:00:00.700Z');
    const second = Math.floor(changed.getTime() / 1000);
    expect(issuedBeforePasswordChange(second - 1, changed)).toBe(true);
    expect(issuedBeforePasswordChange(second, changed)).toBe(false);
    expect(issuedBeforePasswordChange(second - 1, null)).toBe(false);
  });
});
