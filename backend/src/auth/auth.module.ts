import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthThrottlerGuard } from './auth-throttler.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { OriginGuard } from './origin.guard.js';
import { PasswordService } from './password.service.js';
import { PermissionsGuard } from './permissions.guard.js';
import { TokenService } from './token.service.js';

/**
 * MOD-01 — authentication and session management. Registers the global guards
 * in order: OriginGuard (state-changing requests need an acceptable Origin /
 * Fetch Metadata — MOD-01-H02), then AuthGuard, then PermissionsGuard, so every
 * route is protected unless decorated with @Public().
 */
@Module({
  controllers: [AuthController],
  providers: [
    PasswordService,
    TokenService,
    AuthService,
    AuthThrottlerGuard,
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  // AuthThrottlerGuard is exported for the public account routes (MOD-03-T03).
  exports: [PasswordService, TokenService, AuthService, AuthThrottlerGuard],
})
export class AuthModule {}
