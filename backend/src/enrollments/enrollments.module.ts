import { Module } from '@nestjs/common';
import { EnrollmentsController } from './enrollments.controller.js';
import { EnrollmentsService } from './enrollments.service.js';
import { MyClassesController } from './my-classes.controller.js';
import { MyClassesService } from './my-classes.service.js';
import { StudentEnrollmentsController } from './student-enrollments.controller.js';
import { StudentEnrollmentsService } from './student-enrollments.service.js';

/**
 * MOD-05-T04/T05 — enrollments (`/api/classes/:id/enrollments`,
 * `/api/enrollments/:id/status`), the caller's classes (`/api/me/classes`) and,
 * since CH-0226, one student's enrollments (`/api/users/:id/enrollments`, API-200).
 * A separate module next to ClassesModule so T03 and T04 could be written in
 * parallel; it shares the MOD-05 error dictionary (classes/classes.errors.ts)
 * and permission keys (classes/classes.policy.ts) and relies on the global
 * guards, PrismaModule and AuditModule.
 */
@Module({
  controllers: [EnrollmentsController, MyClassesController, StudentEnrollmentsController],
  providers: [EnrollmentsService, MyClassesService, StudentEnrollmentsService],
})
export class EnrollmentsModule {}
