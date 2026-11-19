import { Module } from '@nestjs/common';
import { LearningReportsController } from './learning-reports.controller.js';
import { LearningReportsService } from './learning-reports.service.js';

/**
 * MOD-20 «My School» (roadmap §4q): the class learning progress for teachers
 * and the office — API-235 (`GET /api/classes/:id/learning-progress`).
 * Relies on the global guards and PrismaModule; read-only, no audit.
 */
@Module({
  controllers: [LearningReportsController],
  providers: [LearningReportsService],
})
export class LearningReportsModule {}
