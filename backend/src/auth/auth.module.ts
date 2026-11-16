import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthThrottlerGuard } from './auth-throttler.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { MfaCore } from './mfa/mfa-core.service.js';
import { MfaController } from './mfa/mfa.controller.js';
import { MfaService } from './mfa/mfa.service.js';
import { OriginGuard } from './origin.guard.js';
import { PasswordService } from './password.service.js';
import { PermissionsGuard } from './permissions.guard.js';
import { SessionsController } from './sessions.controller.js';
import { SessionsService } from './sessions.service.js';
import { TokenService } from './token.service.js';

/**
 * MOD-01 — authentication and session management. Registers the global guards
 * in order: OriginGuard (state-changing requests need an acceptable Origin /
 * Fetch Metadata — MOD-01-H02), then AuthGuard, then PermissionsGuard, so every
 * route is protected unless decorated with @Public(). MOD-01-H06 adds the
 * caller's session list and per-session revocation (SessionsController) and the
 * shared core of two-step verification (MfaCore, roadmap §4n) and the caller's
 * own MFA routes (MfaController, MFA-T02).
 */
@Module({
  controllers: [AuthController, SessionsController, MfaController],
  providers: [
    PasswordService,
    TokenService,
    AuthService,
    SessionsService,
    MfaCore,
    MfaService,
    AuthThrottlerGuard,
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  // AuthThrottlerGuard is exported for the public account routes (MOD-03-T03).
  exports: [PasswordService, TokenService, AuthService, MfaCore, AuthThrottlerGuard],
})
export class AuthModule {}
