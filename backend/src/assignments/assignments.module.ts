import { Module } from '@nestjs/common';
import { AssignmentsController, ClassAssignmentsController } from './assignments.controller.js';
import { AssignmentsService } from './assignments.service.js';
import { AssignmentSubmissionsController, SubmissionsController } from './submissions.controller.js';
import { SubmissionsService } from './submissions.service.js';

/**
 * MOD-08 — assignments: the assignments (`/api/assignments`,
 * `/api/classes/:id/assignments`, T02), the submissions and their review
 * (`/api/assignments/:id/submissions`, `/api/submissions/:id` and its
 * `review`, T03); «my assignments» (`/api/me/assignments`, T04) joins it next. Relies on
 * the global guards (AuthModule), PrismaModule and the global AuditModule;
 * reuses the class visibility rule of classes/classes.policy.ts (D-R16), the
 * instant helpers of lessons/lessons.time.ts and the display-zone rule of
 * schedule/timetable.policy.ts (D-R41).
 */
@Module({
  controllers: [ClassAssignmentsController, AssignmentsController, AssignmentSubmissionsController, SubmissionsController],
  providers: [AssignmentsService, SubmissionsService],
})
export class AssignmentsModule {}
