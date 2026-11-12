import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AssignmentsController, ClassAssignmentsController } from './assignments.controller.js';
import { AssignmentsService } from './assignments.service.js';
import { MyAssignmentsController } from './my-assignments.controller.js';
import { MyAssignmentsService } from './my-assignments.service.js';
import { AssignmentSubmissionsController, SubmissionsController } from './submissions.controller.js';
import { SubmissionsService } from './submissions.service.js';

/**
 * MOD-08 — assignments: the assignments (`/api/assignments`,
 * `/api/classes/:id/assignments`, T02), the submissions and their review
 * (`/api/assignments/:id/submissions`, `/api/submissions/:id` and its
 * `review`, T03) and «my assignments» (`/api/me/assignments`, T04 — ownership,
 * no key, the ownerships of lessons/my-lessons.policy.ts). Relies on
 * the global guards (AuthModule), PrismaModule and the global AuditModule;
 * reuses the class visibility rule of classes/classes.policy.ts (D-R16), the
 * instant helpers of lessons/lessons.time.ts and the display-zone rule of
 * schedule/timetable.policy.ts (D-R41). Since MOD-12-T03 publishing an
 * assignment and reviewing a submission notify through NotificationsModule
 * (`assignment.published`, `submission.graded`, `submission.returned`).
 */
@Module({
  imports: [NotificationsModule],
  controllers: [ClassAssignmentsController, AssignmentsController, AssignmentSubmissionsController, SubmissionsController, MyAssignmentsController],
  providers: [AssignmentsService, SubmissionsService, MyAssignmentsService],
})
export class AssignmentsModule {}
