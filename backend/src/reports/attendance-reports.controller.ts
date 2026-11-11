import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { RequirePermissions } from '../auth/decorators.js';
import { AttendanceClassesQueryDto, AttendanceClassesReportDto, AttendanceStudentsQueryDto, AttendanceStudentsReportDto } from './attendance-reports.dto.js';
import { AttendanceReportsService } from './attendance-reports.service.js';
import { REPORTS_ATTENDANCE_PERMISSION } from './reports.policy.js';

/**
 * MOD-13-T01 — attendance reports (API-156/157). `reports.attendance.view`
 * (academy_admin and staff by seed), academy-wide; read-only, never audited.
 */
@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports/attendance')
@RequirePermissions(REPORTS_ATTENDANCE_PERMISSION)
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
@ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `{ missing: ["reports.attendance.view"] }`' })
@ApiBadRequestResponse({ description: '`report_range_invalid { from, to, maxDays }` (from after to, or more than 366 days) or a validation failure (not a calendar day, a bad uuid, an unknown parameter)' })
export class AttendanceReportsController {
  constructor(private readonly reports: AttendanceReportsService) {}

  @Get('classes')
  @ApiOperation({
    summary: 'Attendance by class',
    description:
      'One row per class with lessons that start in the period (days in the academy’s zone; default the last 30 days) and are not cancelled: the lessons, the completed ones, those with attendance taken, the completed ones without it, the records by status and the attendance rate ' +
      '((present + late) ÷ (present + late + absent) — excused left out). Filters `courseId`, `classId`, `classStatus`. By course code then class code; at most 5,000 rows (`truncated`); totals over every matching row.',
  })
  @ApiOkResponse({ type: AttendanceClassesReportDto })
  classes(@Query() query: AttendanceClassesQueryDto): Promise<AttendanceClassesReportDto> {
    return this.reports.classes(query);
  }

  @Get('students')
  @ApiOperation({
    summary: 'Attendance by student',
    description:
      'One row per (student × class) with records in the period’s non-cancelled lessons: the records by status, the attendance and absence rates and the enrollment’s status now; the student by identity only. Filters `courseId`, `classId`, ' +
      '`minAbsences` (≥ 1) and `minAbsenceRate` (0..100). Most absences first; at most 5,000 rows (`truncated`); totals over every matching row.',
  })
  @ApiOkResponse({ type: AttendanceStudentsReportDto })
  students(@Query() query: AttendanceStudentsQueryDto): Promise<AttendanceStudentsReportDto> {
    return this.reports.students(query);
  }
}
