import { Module } from '@nestjs/common';
import { PlatformHealthController } from './platform-health.controller.js';
import { PLATFORM_MIGRATIONS_DIR, PlatformHealthService, defaultPlatformMigrationsDir } from './platform-health.service.js';

/** API-176/177 — liveness and readiness of the platform API (both @Public()). */
@Module({
  controllers: [PlatformHealthController],
  providers: [
    PlatformHealthService,
    // The shipped platform migrations readiness compares with; e2e suites override it.
    { provide: PLATFORM_MIGRATIONS_DIR, useFactory: defaultPlatformMigrationsDir },
  ],
})
export class PlatformHealthModule {}
