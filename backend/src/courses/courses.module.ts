import { Module } from '@nestjs/common';
import { CoursesController } from './courses.controller.js';
import { CoursesService } from './courses.service.js';
import { SyllabusController } from './syllabus.controller.js';
import { SyllabusService } from './syllabus.service.js';

/**
 * MOD-04-T03 — courses (`/api/courses`). Relies on the global guards
 * (AuthModule), PrismaModule and the global AuditModule; the MOD-04 error
 * dictionary, permission keys and code rules live next to it (courses/) and
 * are shared with LevelsModule; the keyset cursor lives in common/.
 */
@Module({
  // MOD-04-T04 (CH-0050): the syllabus routes /api/courses/:id/syllabus live in the same module.
  controllers: [CoursesController, SyllabusController],
  providers: [CoursesService, SyllabusService],
  exports: [CoursesService, SyllabusService],
})
export class CoursesModule {}
