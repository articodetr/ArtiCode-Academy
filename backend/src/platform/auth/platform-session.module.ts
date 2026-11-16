import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { PlatformMfaCore } from './mfa/platform-mfa-core.service.js';
import { PlatformMfaController } from './mfa/platform-mfa.controller.js';
import { PlatformMfaService } from './mfa/platform-mfa.service.js';
import { PlatformSessionController } from './platform-session.controller.js';
import { PlatformSessionService } from './platform-session.service.js';
import { PlatformSessionsController } from './platform-sessions.controller.js';
import { PlatformSessionsService } from './platform-sessions.service.js';
import { PLATFORM_AUTH_THROTTLER, PlatformThrottlerGuard } from './platform-throttler.guard.js';

/**
 * MOD-18-T03 — the session routes of the platform API (API-178..182 and
 * logout-all) and, since MOD-01-H06, the sessions list and revoking one
 * session (API-203/204 — PlatformSessionsController), and since PMFA (§4o) the
 * shared core of two-step verification (PlatformMfaCore) and the caller's own
 * MFA routes (API-213..217 — PlatformMfaController, PMFA-T02). The token, principal
 * and password services come from the global PlatformAuthModule (T02), the
 * audit service from PlatformAuditModule.
 *
 * The named limiter of the platform (in memory, per process): only the routes
 * that use PlatformThrottlerGuard are limited, each with its own @Throttle.
 * ThrottlerModule is global, so another platform module may use the guard
 * with the same limiter name.
 */
@Module({
  imports: [ThrottlerModule.forRoot({ throttlers: [{ name: PLATFORM_AUTH_THROTTLER, ttl: 15 * 60 * 1000, limit: 10 }] })],
  controllers: [PlatformSessionController, PlatformSessionsController, PlatformMfaController],
  providers: [PlatformSessionService, PlatformSessionsService, PlatformMfaCore, PlatformMfaService, PlatformThrottlerGuard],
  exports: [PlatformSessionService, PlatformMfaCore],
})
export class PlatformSessionModule {}
