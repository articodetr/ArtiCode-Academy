import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { EnrollmentRequestsController } from './enrollment-requests.controller.js';
import { EnrollmentRequestsService } from './enrollment-requests.service.js';
import { EnrollmentRequestsWriter } from './enrollment-requests.writer.js';
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
  // MOD-19 (CH-0301): the request writer needs the invoices and the notification engine; the catalog module reuses it.
  imports: [FinanceModule, NotificationsModule],
  controllers: [EnrollmentsController, MyClassesController, StudentEnrollmentsController, EnrollmentRequestsController],
  providers: [EnrollmentsService, MyClassesService, StudentEnrollmentsService, EnrollmentRequestsService, EnrollmentRequestsWriter],
  exports: [EnrollmentRequestsWriter, EnrollmentRequestsService],
})
export class EnrollmentsModule {}
