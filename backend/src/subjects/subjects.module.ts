import { Module } from '@nestjs/common';
import { SubjectsController } from './subjects.controller.js';
import { SubjectsService } from './subjects.service.js';

/**
 * PORTAL-04 — the school subjects of the courses (`/api/subjects`), a mirror
 * of LevelsModule. Relies on the global guards (AuthModule), PrismaModule and
 * the global AuditModule; shares the MOD-04 error dictionary, permission keys
 * and code rule in courses/ and the D1 localized-text DTO of roles/.
 */
@Module({
  controllers: [SubjectsController],
  providers: [SubjectsService],
  exports: [SubjectsService],
})
export class SubjectsModule {}
