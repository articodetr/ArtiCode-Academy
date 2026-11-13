import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { OriginGuard } from '../../auth/origin.guard.js';
import { PasswordService } from '../../auth/password.service.js';
import { PlatformAuthGuard } from './platform-auth.guard.js';
import { PlatformPrincipalService } from './platform-principal.service.js';
import { PlatformRolesGuard } from './platform-roles.guard.js';
import { PlatformTokenService } from './platform-token.service.js';

/**
 * MOD-18-T02 — the authentication core of the platform app (the session
 * routes of T03 join it). Registers the global guards in order: the shared
 * OriginGuard (state-changing requests need an Origin on PLATFORM_CORS_ORIGIN,
 * the request's own origin, or loopback outside production — MOD-01-H02),
 * then PlatformAuthGuard, then PlatformRolesGuard, so every platform route is
 * protected unless decorated with @Public(). Global: the token service, the
 * principal service and the shared Argon2id PasswordService are injectable in
 * every platform module.
 */
@Global()
@Module({
  providers: [
    PasswordService,
    PlatformTokenService,
    PlatformPrincipalService,
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: PlatformAuthGuard },
    { provide: APP_GUARD, useClass: PlatformRolesGuard },
  ],
  exports: [PasswordService, PlatformTokenService, PlatformPrincipalService],
})
export class PlatformAuthModule {}
