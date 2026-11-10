import { Module } from '@nestjs/common';
import { GradeSchemesController } from './grade-schemes.controller.js';
import { GradeSchemesService } from './grade-schemes.service.js';

/**
 * MOD-09 — grades (roadmap §4h): grade schemes since T02 (`/api/grade-schemes`);
 * the gradebook, final grades and «my grades» follow in T05/T06. Relies on the
 * global guards (AuthModule), PrismaModule and the global AuditModule; reuses
 * the D1 localized-text DTO of roles/ and the raw-body transforms of courses/.
 * The MOD-09 error dictionary (`grades.errors.ts`) also serves exams/.
 */
@Module({
  controllers: [GradeSchemesController],
  providers: [GradeSchemesService],
  exports: [GradeSchemesService],
})
export class GradesModule {}
