import { Module } from '@nestjs/common';
import { RoomsController } from './rooms.controller.js';
import { RoomsService } from './rooms.service.js';

/**
 * MOD-07 (O9) — scheduling: the rooms (`/api/rooms`, T02) and, from T03, the
 * weekly class schedules and their readings. Relies on the global guards
 * (AuthModule), PrismaModule and the global AuditModule; reuses the code rule
 * of courses/ and the D1 localized-text DTO of roles/.
 */
@Module({
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class ScheduleModule {}
