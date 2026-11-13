import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { MIGRATIONS_DIR, defaultMigrationsDir } from './schema-version.js';

@Module({
  controllers: [HealthController],
  providers: [
    HealthService,
    // The shipped migrations the readiness check compares with (MOD-17-T03);
    // e2e suites override it with a folder of their own.
    { provide: MIGRATIONS_DIR, useFactory: defaultMigrationsDir },
  ],
})
export class HealthModule {}
