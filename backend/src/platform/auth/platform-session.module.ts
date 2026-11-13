import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { PlatformSessionController } from './platform-session.controller.js';
import { PlatformSessionService } from './platform-session.service.js';
import { PLATFORM_AUTH_THROTTLER, PlatformThrottlerGuard } from './platform-throttler.guard.js';

/**
 * MOD-18-T03 — the session routes of the platform API (API-178..182 and
 * logout-all). The token, principal and password services come from the
 * global PlatformAuthModule (T02), the audit service from PlatformAuditModule.
 *
 * The named limiter of the platform (in memory, per process): only the routes
 * that use PlatformThrottlerGuard are limited, each with its own @Throttle.
 * ThrottlerModule is global, so another platform module may use the guard
 * with the same limiter name.
 */
@Module({
  imports: [ThrottlerModule.forRoot({ throttlers: [{ name: PLATFORM_AUTH_THROTTLER, ttl: 15 * 60 * 1000, limit: 10 }] })],
  controllers: [PlatformSessionController],
  providers: [PlatformSessionService, PlatformThrottlerGuard],
  exports: [PlatformSessionService],
})
export class PlatformSessionModule {}
