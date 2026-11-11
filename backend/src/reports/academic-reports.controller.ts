import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthErrorDto } from '../auth/auth.dto.js';
import { RequirePermissions } from '../auth/decorators.js';
import {
  AcademicAssignmentsQueryDto,
  AcademicClassesQueryDto,
  AcademicExamsQueryDto,
  AssignmentSubmissionsReportDto,
  ClassPerformanceReportDto,
  ExamResultsReportDto,
} from './academic-reports.dto.js';
import { AcademicReportsService } from './academic-reports.service.js';
import { REPORTS_ACADEMIC_PERMISSION } from './reports.policy.js';

/**
 * MOD-13-T02 — academic reports (API-158..160). `reports.academic.view`
 * (academy_admin by seed; granted to others from the roles screen),
 * academy-wide; read-only, never audited.
 */
@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports/academic')
@RequirePermissions(REPORTS_ACADEMIC_PERMISSION)
@ApiUnauthorizedResponse({ type: AuthErrorDto, description: 'unauthenticated | token_expired | token_invalid | session_invalid' })
@ApiForbiddenResponse({ type: AuthErrorDto, description: 'permission_denied — `{ missing: ["reports.academic.view"] }`' })
@ApiBadRequestResponse({ description: '`report_range_invalid { from, to, maxDays }` or a validation failure' })
export class AcademicReportsController {
  constructor(private readonly reports: AcademicReportsService) {}

  @Get('classes')
  @ApiOperation({
    summary: 'Class and course performance',
    description:
      'The final grades finalized in the period (`finalized_at`, days in the academy’s zone): per class and per course the count, the mean percentage, the passed count and rate, and per class the counts of each band as frozen in the grades. Filters `courseId`, `classId`.',
  })
  @ApiOkResponse({ type: ClassPerformanceReportDto })
  classes(@Query() query: AcademicClassesQueryDto): Promise<ClassPerformanceReportDto> {
    return this.reports.classes(query);
  }

  @Get('assignments')
  @ApiOperation({
    summary: 'Assignment submissions',
    description:
      'The non-draft assignments due in the period (an undated one counts on its publish day): students, submitted on time and late, not submitted, the latest attempt’s state, the submission and on-time rates and the mean of the latest graded attempts after the late penalty (the gradebook’s rule). Filters `courseId`, `classId`, `status`.',
  })
  @ApiOkResponse({ type: AssignmentSubmissionsReportDto })
  assignments(@Query() query: AcademicAssignmentsQueryDto): Promise<AssignmentSubmissionsReportDto> {
    return this.reports.assignments(query);
  }

  @Get('exams')
  @ApiOperation({
    summary: 'Exam results',
    description:
      'The published exams scheduled in the period (else on their publish day): students, scored, absent, excused and missing results, the mean percentage (absent = 0, excused left out — the gradebook’s rule), the lowest and highest scored percentage and the pass rate against `passScore`. Filters `courseId`, `classId`, `type`.',
  })
  @ApiOkResponse({ type: ExamResultsReportDto })
  exams(@Query() query: AcademicExamsQueryDto): Promise<ExamResultsReportDto> {
    return this.reports.exams(query);
  }
}
