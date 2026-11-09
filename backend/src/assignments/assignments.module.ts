import { Module } from '@nestjs/common';
import { AssignmentsController, ClassAssignmentsController } from './assignments.controller.js';
import { AssignmentsService } from './assignments.service.js';

/**
 * MOD-08 — assignments: the assignments (`/api/assignments`,
 * `/api/classes/:id/assignments`, T02); submissions and review (T03) and
 * «my assignments» (`/api/me/assignments`, T04) join this module. Relies on
 * the global guards (AuthModule), PrismaModule and the global AuditModule;
 * reuses the class visibility rule of classes/classes.policy.ts (D-R16), the
 * instant helpers of lessons/lessons.time.ts and the display-zone rule of
 * schedule/timetable.policy.ts (D-R41).
 */
@Module({
  controllers: [ClassAssignmentsController, AssignmentsController],
  providers: [AssignmentsService],
})
export class AssignmentsModule {}
