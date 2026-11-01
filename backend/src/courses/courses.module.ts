import { Module } from '@nestjs/common';
import { CoursesController } from './courses.controller.js';
import { CoursesService } from './courses.service.js';

/**
 * MOD-04-T03 — courses (`/api/courses`). Relies on the global guards
 * (AuthModule), PrismaModule and the global AuditModule; the MOD-04 error
 * dictionary, permission keys and code rules live next to it (courses/) and
 * are shared with LevelsModule; the keyset cursor lives in common/.
 */
@Module({
  controllers: [CoursesController],
  providers: [CoursesService],
  exports: [CoursesService],
})
export class CoursesModule {}
