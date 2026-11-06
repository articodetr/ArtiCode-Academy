import { Module } from '@nestjs/common';
import { ClassScheduleController } from './class-schedule.controller.js';
import { ClassScheduleService } from './class-schedule.service.js';
import { RoomsController } from './rooms.controller.js';
import { RoomsService } from './rooms.service.js';
import { AcademyScheduleController, MyScheduleController } from './timetable.controller.js';
import { TimetableService } from './timetable.service.js';

/**
 * MOD-07 (O9) — scheduling: the rooms (`/api/rooms`, T02), the weekly class
 * schedule (`/api/classes/:id/schedule`, T03) and the timetable readings
 * (`/api/schedule` for the academy's managers and `/api/me/schedule` by
 * ownership, T04). Relies on the global guards (AuthModule), PrismaModule
 * and the global AuditModule; reuses the code rule of courses/, the D1
 * localized-text DTO of roles/, the class visibility rule of
 * classes/classes.policy.ts (D-R16) and the ownership rules of
 * enrollments/my-classes.policy.ts.
 */
@Module({
  controllers: [RoomsController, ClassScheduleController, AcademyScheduleController, MyScheduleController],
  providers: [RoomsService, ClassScheduleService, TimetableService],
  exports: [RoomsService, ClassScheduleService, TimetableService],
})
export class ScheduleModule {}
