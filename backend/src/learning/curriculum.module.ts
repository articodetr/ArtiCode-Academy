import { Module } from '@nestjs/common';
import { CurriculumController } from './curriculum.controller.js';
import { CurriculumService } from './curriculum.service.js';

/**
 * MOD-20 «My School» (roadmap §4q): the course curriculum for authors —
 * API-226..228 (`/api/courses/:id/curriculum`). Relies on the global guards
 * (AuthModule), PrismaModule and the global AuditModule; the MOD-04 error
 * dictionary and permission keys come from courses/, the MOD-20 ones from
 * learning.errors.ts.
 */
@Module({
  controllers: [CurriculumController],
  providers: [CurriculumService],
  exports: [CurriculumService],
})
export class CurriculumModule {}
