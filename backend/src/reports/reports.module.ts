import { Module } from '@nestjs/common';
import { AcademicReportsController } from './academic-reports.controller.js';
import { AcademicReportsService } from './academic-reports.service.js';
import { AttendanceReportsController } from './attendance-reports.controller.js';
import { AttendanceReportsService } from './attendance-reports.service.js';
import { FinancialReportsController } from './financial-reports.controller.js';
import { FinancialReportsService } from './financial-reports.service.js';
import { OverviewController } from './overview.controller.js';
import { OverviewService } from './overview.service.js';

/**
 * MOD-13 — reports (roadmap §4k; owner decisions D-R66..D-R73): read-only
 * reports computed on request from the tables of MOD-05..MOD-11 — attendance
 * since T01 (`/api/reports/attendance/*`), academic since T02
 * (`/api/reports/academic/*`), financial since T03 (`/api/reports/financial/*`)
 * and the dashboard overview since T04 (`/api/reports/overview`, built from
 * the three report services). No tables, no writes, no audit events; one error
 * dictionary for the whole module (`reports.errors.ts`).
 */
@Module({
  controllers: [AttendanceReportsController, AcademicReportsController, FinancialReportsController, OverviewController],
  providers: [AttendanceReportsService, AcademicReportsService, FinancialReportsService, OverviewService],
})
export class ReportsModule {}
