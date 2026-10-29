import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthThrottlerGuard } from './auth-throttler.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { PermissionsGuard } from './permissions.guard.js';
import { TokenService } from './token.service.js';

/**
 * MOD-01 — authentication and session management. Registers the global
 * AuthGuard (then PermissionsGuard) so every route is protected unless
 * decorated with @Public().
 */
@Module({
  controllers: [AuthController],
  providers: [
    PasswordService,
    TokenService,
    AuthService,
    AuthThrottlerGuard,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [PasswordService, TokenService, AuthService],
})
export class AuthModule {}
