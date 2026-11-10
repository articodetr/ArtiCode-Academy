import { Module } from '@nestjs/common';
import { ClassExamsController, ExamsController } from './exams.controller.js';
import { ExamsService } from './exams.service.js';

/**
 * MOD-09 — exams whose results a teacher records (roadmap §4h, D-R42/D-R47):
 * the exams since T03 (`/api/exams`, `/api/classes/:id/exams`); the results
 * sheet and «my exams» follow in T04. Relies on the global guards
 * (AuthModule), PrismaModule and the global AuditModule; uses the MOD-09
 * error dictionary of grades/grades.errors.ts, the class visibility rule of
 * classes/classes.policy.ts (D-R16), the instant helpers of
 * lessons/lessons.time.ts and the display-zone rule of
 * schedule/timetable.policy.ts (D-R41).
 */
@Module({
  controllers: [ClassExamsController, ExamsController],
  providers: [ExamsService],
  exports: [ExamsService],
})
export class ExamsModule {}
