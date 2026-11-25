import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthThrottlerGuard } from './auth-throttler.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { GoogleAuthController } from './google/google-auth.controller.js';
import { GoogleAuthService } from './google/google-auth.service.js';
import { GOOGLE_JWKS, GoogleOidcClient, googleRemoteKeySet } from './google/google-oidc.client.js';
import { GOOGLE_OAUTH_CONFIG, googleEnvFrom, googleOAuthConfigOf } from './google/google.config.js';
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
 * own MFA routes (MfaController, MFA-T02). PORTAL-04 adds Google sign-in
 * (GoogleAuthController: OpenID Connect with PKCE; off unless GOOGLE_OAUTH_CLIENT_ID
 * and GOOGLE_OAUTH_CLIENT_SECRET are set).
 */
@Module({
  controllers: [AuthController, SessionsController, MfaController, GoogleAuthController],
  providers: [
    PasswordService,
    TokenService,
    AuthService,
    SessionsService,
    MfaCore,
    MfaService,
    AuthThrottlerGuard,
    {
      provide: GOOGLE_OAUTH_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => googleOAuthConfigOf(googleEnvFrom({ get: (key) => config.get(key) })),
    },
    // Google's published keys, one remote key set per process (jose caches and refetches them).
    { provide: GOOGLE_JWKS, useFactory: googleRemoteKeySet },
    GoogleOidcClient,
    GoogleAuthService,
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  // AuthThrottlerGuard is exported for the public account routes (MOD-03-T03).
  exports: [PasswordService, TokenService, AuthService, MfaCore, AuthThrottlerGuard],
})
export class AuthModule {}
