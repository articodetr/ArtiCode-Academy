import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';
import { ClassLessonsController, LessonsController } from './lessons.controller.js';
import { LessonsService } from './lessons.service.js';

/**
 * MOD-06 — lessons and attendance: the lessons (`/api/lessons`,
 * `/api/classes/:id/lessons`, T02), the attendance sheet (`/api/lessons/:id/attendance`,
 * T03) and, from T04, «my lessons». Relies on the global guards (AuthModule), PrismaModule and the
 * global AuditModule; reuses the class visibility rule of
 * classes/classes.policy.ts (D-R16), the room/teacher DTOs of schedule/ and
 * the write-conflict retry of schedule/class-schedule.service.ts (KI-071).
 * `LessonsService.createLessons()` is exported for MOD-07-T05 (D-R31).
 */
@Module({
  controllers: [ClassLessonsController, LessonsController, AttendanceController],
  providers: [LessonsService, AttendanceService],
  exports: [LessonsService],
})
export class LessonsModule {}
