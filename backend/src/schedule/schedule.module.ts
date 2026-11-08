import { Module } from '@nestjs/common';
import { LessonsModule } from '../lessons/lessons.module.js';
import { ClassScheduleController } from './class-schedule.controller.js';
import { ClassScheduleService } from './class-schedule.service.js';
import { LessonGenerationController } from './lesson-generation.controller.js';
import { LessonGenerationService } from './lesson-generation.service.js';
import { RoomsController } from './rooms.controller.js';
import { RoomsService } from './rooms.service.js';
import { AcademyScheduleController, MyScheduleController } from './timetable.controller.js';
import { TimetableService } from './timetable.service.js';

/**
 * MOD-07 (O9) — scheduling: the rooms (`/api/rooms`, T02), the weekly class
 * schedule (`/api/classes/:id/schedule`, T03), the timetable readings
 * (`/api/schedule` for the academy's managers and `/api/me/schedule` by
 * ownership, T04) and the lessons generated from the weekly slots
 * (`POST /api/classes/:id/schedule/generate`, T05 — written through the
 * exported LessonsService of MOD-06, D-R29/D-R31). Relies on the global
 * guards (AuthModule), PrismaModule and the global AuditModule; reuses the
 * code rule of courses/, the D1 localized-text DTO of roles/, the class
 * visibility rule of classes/classes.policy.ts (D-R16) and the ownership
 * rules of enrollments/my-classes.policy.ts.
 */
@Module({
  imports: [LessonsModule],
  controllers: [RoomsController, ClassScheduleController, AcademyScheduleController, MyScheduleController, LessonGenerationController],
  providers: [RoomsService, ClassScheduleService, TimetableService, LessonGenerationService],
  exports: [RoomsService, ClassScheduleService, TimetableService],
})
export class ScheduleModule {}
