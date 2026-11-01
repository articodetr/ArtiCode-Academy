import { Module } from '@nestjs/common';
import { LevelsController } from './levels.controller.js';
import { LevelsService } from './levels.service.js';

/**
 * MOD-04-T02 — course levels (`/api/levels`). Relies on the global guards
 * (AuthModule), PrismaModule and the global AuditModule; shares the MOD-04
 * error dictionary and permission keys in courses/ and the D1 localized-text
 * DTO of roles/.
 */
@Module({
  controllers: [LevelsController],
  providers: [LevelsService],
  exports: [LevelsService],
})
export class LevelsModule {}
