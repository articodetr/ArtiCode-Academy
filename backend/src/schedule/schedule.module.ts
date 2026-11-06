import { Module } from '@nestjs/common';
import { ClassScheduleController } from './class-schedule.controller.js';
import { ClassScheduleService } from './class-schedule.service.js';
import { RoomsController } from './rooms.controller.js';
import { RoomsService } from './rooms.service.js';

/**
 * MOD-07 (O9) — scheduling: the rooms (`/api/rooms`, T02), the weekly class
 * schedule (`/api/classes/:id/schedule`, T03) and, from T04, the academy and
 * «my schedule» readings. Relies on the global guards (AuthModule),
 * PrismaModule and the global AuditModule; reuses the code rule of courses/,
 * the D1 localized-text DTO of roles/ and the class visibility rule of
 * classes/classes.policy.ts (D-R16).
 */
@Module({
  controllers: [RoomsController, ClassScheduleController],
  providers: [RoomsService, ClassScheduleService],
  exports: [RoomsService, ClassScheduleService],
})
export class ScheduleModule {}
