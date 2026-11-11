import { Module } from '@nestjs/common';
import { AttendanceReportsController } from './attendance-reports.controller.js';
import { AttendanceReportsService } from './attendance-reports.service.js';

/**
 * MOD-13 — reports (roadmap §4k; owner decisions D-R66..D-R73): read-only
 * reports computed on request from the tables of MOD-05..MOD-11 — attendance
 * since T01 (`/api/reports/attendance/*`). No tables, no writes, no audit
 * events; one error dictionary for the whole module (`reports.errors.ts`).
 */
@Module({
  controllers: [AttendanceReportsController],
  providers: [AttendanceReportsService],
})
export class ReportsModule {}
