import { Module } from '@nestjs/common';
import { EnrollmentsController } from './enrollments.controller.js';
import { EnrollmentsService } from './enrollments.service.js';

/**
 * MOD-05-T04 — enrollments (`/api/classes/:id/enrollments`,
 * `/api/enrollments/:id/status`). A separate module next to ClassesModule so
 * T03 and T04 could be written in parallel; it shares the MOD-05 error
 * dictionary (classes/classes.errors.ts) and permission keys
 * (classes/classes.policy.ts) and relies on the global guards, PrismaModule
 * and AuditModule.
 */
@Module({
  controllers: [EnrollmentsController],
  providers: [EnrollmentsService],
})
export class EnrollmentsModule {}
